/**
 * High-level session manager that orchestrates the rollback engine and transport.
 *
 * Handles room management, player join/leave, message routing, and desync detection.
 */

import type {
	ConnectionMetrics,
	TransportAdapter,
} from "../transport/adapter.js";
import {
	DEFAULT_SESSION_CONFIG,
	DesyncAuthority,
	type ErrorContext,
	ErrorSource,
	type Game,
	type InputPredictor,
	PauseReason,
	PlayerConnectionState,
	type PlayerId,
	type PlayerInfo,
	PlayerRole,
	type SessionConfig,
	type SessionEvents,
	SessionState,
	type Tick,
	type TickResult,
	Topology,
	asPlayerId,
	asTick,
	validateSessionConfig,
} from "../types.js";

import { type DebugLogger, createDebugLogger } from "../debug.js";
import { decodeMessage, encodeMessage } from "../protocol/encoding.js";
import {
	type Message,
	MessageType,
	isDisconnectReportMessage,
	isDropPlayerMessage,
	isHashMessage,
	isInputMessage,
	isJoinAcceptMessage,
	isJoinRejectMessage,
	isJoinRequestMessage,
	isLagReportMessage,
	isPauseMessage,
	isPingMessage,
	isPlayerJoinedMessage,
	isPlayerLeftMessage,
	isPongMessage,
	isReliableMessage,
	isResumeCountdownMessage,
	isResumeMessage,
	isStateSyncMessage,
	isSyncMessage,
	isSyncRequestMessage,
} from "../protocol/messages.js";
import {
	RollbackEngine,
	type RollbackEngineConfig,
} from "../rollback/engine.js";
import { type TopologyStrategy, createTopologyStrategy } from "./topology.js";

/** Number of ticks of input to include in each message for redundancy */
const DEFAULT_INPUT_REDUNDANCY = 3;

/** Maximum join requests per peer within the rate limit window */
const JOIN_REQUEST_LIMIT = 3;

/** Time window for rate limiting join requests (in milliseconds) */
const JOIN_REQUEST_WINDOW_MS = 10000;

/** Interval for cleaning up stale rate limit entries (in milliseconds) */
const RATE_LIMIT_CLEANUP_INTERVAL_MS = 60000;

/** Minimum interval between lag reports for the same player (in ticks) */
const LAG_REPORT_COOLDOWN_TICKS = 60;

/**
 * Options for creating a session.
 */
export interface CreateSessionOptions {
	/** The game instance to control */
	game: Game;

	/** Transport adapter for network communication */
	transport: TransportAdapter;

	/** Local player's ID (defaults to transport's localPeerId) */
	localPlayerId?: PlayerId;

	/** Session configuration (uses defaults if not specified) */
	config?: Partial<SessionConfig>;

	/** Custom input predictor */
	inputPredictor?: InputPredictor<Uint8Array>;
}

/**
 * Generate a cryptographically random room ID.
 * Uses crypto.randomUUID() for unpredictable room IDs.
 */
function generateRoomId(): string {
	// Use crypto.randomUUID() for secure random IDs
	// Falls back to a less secure method if crypto is unavailable
	if (typeof crypto !== "undefined" && crypto.randomUUID) {
		// Take first 8 characters of UUID for shorter room codes
		return crypto.randomUUID().slice(0, 8);
	}

	// Fallback for environments without crypto.randomUUID
	const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
	let id = "";
	for (let i = 0; i < 8; i++) {
		id += chars[Math.floor(Math.random() * chars.length)];
	}
	return id;
}

/**
 * Session manager that coordinates the rollback engine with network transport.
 */
// Type alias for event handler functions
type EventHandler = (...args: never[]) => void;

export class Session {
	private readonly game: Game;
	private readonly transport: TransportAdapter;
	private readonly config: SessionConfig;
	private readonly engine: RollbackEngine;
	private readonly eventHandlers: Map<keyof SessionEvents, Set<EventHandler>> =
		new Map();
	private readonly _localPlayerId: PlayerId;
	private readonly topologyStrategy: TopologyStrategy;
	private readonly debug: DebugLogger;

	private _state: SessionState = SessionState.Disconnected;
	private _isHost = false;
	private _roomId: string | null = null;
	private _localRole: PlayerRole = PlayerRole.Player;
	private readonly _players: Map<PlayerId, PlayerInfo> = new Map();
	private lastHashBroadcastTick: Tick = asTick(-1);
	private inputRedundancy = DEFAULT_INPUT_REDUNDANCY;

	/** Rate limiting: tracks join request timestamps per peer */
	private readonly joinRequestTimes: Map<string, number[]> = new Map();

	/** Timer for periodic rate limit cleanup */
	private rateLimitCleanupTimer: ReturnType<typeof setInterval> | null = null;

	/** Host-authority desync: hashes received from players, keyed by tick then playerId */
	private readonly receivedHashes: Map<Tick, Map<PlayerId, number>> = new Map();

	/** Last tick when a lag report was sent for each player (to avoid spam) */
	private readonly lastLagReportTick: Map<PlayerId, Tick> = new Map();

	/**
	 * Create a new session.
	 * @throws ValidationError if config values are invalid
	 */
	constructor(options: CreateSessionOptions) {
		this.game = options.game;
		this.transport = options.transport;
		this.config = { ...DEFAULT_SESSION_CONFIG, ...options.config };

		// Validate configuration
		validateSessionConfig(this.config);

		this._localPlayerId =
			options.localPlayerId ?? asPlayerId(this.transport.localPeerId);

		// Create topology strategy
		this.topologyStrategy = createTopologyStrategy(this.config.topology);

		// Create debug logger
		this.debug = createDebugLogger(this.config.debug);

		const engineConfig: RollbackEngineConfig = {
			game: this.game,
			localPlayerId: this._localPlayerId,
			snapshotHistorySize: this.config.snapshotHistorySize,
			maxSpeculationTicks: this.config.maxSpeculationTicks,
		};
		if (options.inputPredictor) {
			engineConfig.inputPredictor = options.inputPredictor;
		}
		this.engine = new RollbackEngine(engineConfig);

		// Initialize local player info
		this._players.set(this._localPlayerId, {
			id: this._localPlayerId,
			connectionState: PlayerConnectionState.Connected,
			joinTick: null,
			leaveTick: null,
			isHost: false,
			role: PlayerRole.Player,
		});

		// Setup transport callbacks
		this.transport.onMessage = this.handleMessage.bind(this);
		this.transport.onConnect = this.handlePeerConnect.bind(this);
		this.transport.onDisconnect = this.handlePeerDisconnect.bind(this);

		// Setup keepalive callback if transport supports it
		const transportWithKeepalive = this.transport as {
			onKeepalivePing?: ((peerId: string) => void) | null;
		};
		if ("onKeepalivePing" in transportWithKeepalive) {
			transportWithKeepalive.onKeepalivePing = (peerId: string) => {
				this.sendPing(peerId);
			};
		}

		// Start periodic rate limit cleanup (unref to not block process exit)
		this.rateLimitCleanupTimer = setInterval(() => {
			this.cleanupRateLimitEntries();
		}, RATE_LIMIT_CLEANUP_INTERVAL_MS);
		if (this.rateLimitCleanupTimer.unref) {
			this.rateLimitCleanupTimer.unref();
		}
	}

	/**
	 * Current session state.
	 */
	get state(): SessionState {
		return this._state;
	}

	/**
	 * Map of all players in the session.
	 */
	get players(): ReadonlyMap<PlayerId, PlayerInfo> {
		return this._players;
	}

	/**
	 * Local player's ID.
	 */
	get localPlayerId(): PlayerId {
		return this._localPlayerId;
	}

	/**
	 * Whether this session is the host.
	 */
	get isHost(): boolean {
		return this._isHost;
	}

	/**
	 * Current room ID (null if not in a room).
	 */
	get roomId(): string | null {
		return this._roomId;
	}

	/**
	 * Local player's role in the session.
	 */
	get localRole(): PlayerRole {
		return this._localRole;
	}

	/**
	 * Set the local player's role.
	 * Must be called before joining a room or starting the game.
	 *
	 * @param role - The role to set ('pilot' or 'spectator')
	 * @throws Error if called while in a room
	 */
	setLocalRole(role: PlayerRole): void {
		if (this._state !== SessionState.Disconnected) {
			throw new Error("Cannot change role while in a room");
		}
		this._localRole = role;
		const localPlayer = this._players.get(this.localPlayerId);
		if (localPlayer) {
			localPlayer.role = role;
		}
	}

	/**
	 * Current tick from the engine.
	 */
	get currentTick(): Tick {
		return this.engine.currentTick;
	}

	/**
	 * Confirmed tick from the engine.
	 */
	get confirmedTick(): Tick {
		return this.engine.confirmedTick;
	}

	/**
	 * Get connection quality metrics for a player.
	 *
	 * @param playerId - The player's ID
	 * @returns Connection metrics or null if not available
	 */
	getPlayerMetrics(playerId: PlayerId): ConnectionMetrics | null {
		// Local player doesn't have network metrics
		if (playerId === this.localPlayerId) {
			return null;
		}

		// Get the peer ID for this player - in this case player ID is the peer ID
		const peerId = playerId as string;

		// Check if transport supports metrics
		if (this.transport.getConnectionMetrics) {
			return this.transport.getConnectionMetrics(peerId);
		}

		return null;
	}

	/**
	 * Destroy the session and clean up resources.
	 * Call this when the session is no longer needed.
	 */
	destroy(): void {
		this.leaveRoom();

		// Stop rate limit cleanup timer
		if (this.rateLimitCleanupTimer) {
			clearInterval(this.rateLimitCleanupTimer);
			this.rateLimitCleanupTimer = null;
		}

		// Clear rate limit entries
		this.joinRequestTimes.clear();

		// Remove transport callbacks
		this.transport.onMessage = null;
		this.transport.onConnect = null;
		this.transport.onDisconnect = null;
	}

	/**
	 * Create a new room and become the host.
	 *
	 * @returns The room ID
	 */
	async createRoom(): Promise<string> {
		if (this._state !== SessionState.Disconnected) {
			throw new Error("Already in a room or connecting");
		}

		this._roomId = generateRoomId();
		this._isHost = true;

		// Update local player to be host
		const localPlayer = this._players.get(this.localPlayerId);
		if (localPlayer) {
			localPlayer.isHost = true;
			localPlayer.joinTick = asTick(0);
		}

		this.setState(SessionState.Lobby);
		return this._roomId;
	}

	/**
	 * Join an existing room.
	 *
	 * @param roomId - The room ID to join
	 * @param hostPeerId - The host's peer ID
	 */
	async joinRoom(roomId: string, hostPeerId: string): Promise<void> {
		if (this._state !== SessionState.Disconnected) {
			throw new Error("Already in a room or connecting");
		}

		this._roomId = roomId;
		this._isHost = false;
		this.setState(SessionState.Connecting);

		// Connect to host
		await this.transport.connect(hostPeerId);

		// Send join request with role
		const joinRequest: Message = {
			type: MessageType.JoinRequest,
			playerId: this.localPlayerId,
			role: this._localRole,
		};
		this.sendToHost(joinRequest);
	}

	/**
	 * Leave the current room.
	 */
	leaveRoom(): void {
		if (this._state === SessionState.Disconnected) {
			return;
		}

		// Notify other players
		if (this._state === SessionState.Playing) {
			const leaveMsg: Message = {
				type: MessageType.PlayerLeft,
				playerId: this.localPlayerId,
				leaveTick: this.engine.currentTick,
			};
			this.broadcast(leaveMsg, true);
		}

		// Disconnect from all peers
		this.transport.disconnectAll();

		// Reset state
		this._roomId = null;
		this._isHost = false;
		this._players.clear();
		this.engine.reset();

		// Re-add local player
		this._players.set(this.localPlayerId, {
			id: this.localPlayerId,
			connectionState: PlayerConnectionState.Connected,
			joinTick: null,
			leaveTick: null,
			isHost: false,
			role: PlayerRole.Player,
		});

		this.setState(SessionState.Disconnected);
	}

	/**
	 * Start the game (host only).
	 * Transitions from lobby to playing state.
	 */
	start(): void {
		if (!this._isHost) {
			throw new Error("Only the host can start the game");
		}
		if (this._state !== SessionState.Lobby) {
			throw new Error("Can only start from lobby state");
		}

		// Set join ticks for all players, but only add players to engine
		const startTick = asTick(0);
		for (const player of this._players.values()) {
			player.joinTick = startTick;
			// Only players contribute inputs - spectators run simulation but don't send inputs
			if (player.role === PlayerRole.Player) {
				this.engine.addPlayer(player.id, startTick);
			}
		}

		// Send state sync to all players
		const state = this.engine.getState();
		const syncMsg: Message = {
			type: MessageType.StateSync,
			tick: state.tick,
			state: state.state,
			hash: this.engine.getCurrentHash(),
			playerTimeline: state.playerTimeline,
		};
		this.broadcast(syncMsg, true);

		this.setState(SessionState.Playing);
		this.emit("gameStart");
	}

	/**
	 * Pause the game (host only).
	 */
	pause(reason: PauseReason = PauseReason.PlayerRequest): void {
		if (!this._isHost) {
			throw new Error("Only the host can pause");
		}
		if (this._state !== SessionState.Playing) {
			return;
		}

		const pauseMsg: Message = {
			type: MessageType.Pause,
			playerId: this.localPlayerId,
			pauseTick: this.engine.currentTick,
			reason,
		};
		this.broadcast(pauseMsg, true);

		this.setState(SessionState.Paused);
	}

	/**
	 * Resume the game (host only).
	 */
	resume(): void {
		if (!this._isHost) {
			throw new Error("Only the host can resume");
		}
		if (this._state !== SessionState.Paused) {
			return;
		}

		const resumeMsg: Message = {
			type: MessageType.Resume,
			playerId: this.localPlayerId,
			resumeTick: this.engine.currentTick,
		};
		this.broadcast(resumeMsg, true);

		this.setState(SessionState.Playing);
	}

	/**
	 * Send a resume countdown to all players (host only).
	 * Use this before calling resume() to give players time to prepare.
	 *
	 * @param secondsRemaining - Number of seconds until resume
	 */
	sendResumeCountdown(secondsRemaining: number): void {
		if (!this._isHost) {
			throw new Error("Only the host can send resume countdown");
		}
		if (this._state !== SessionState.Paused) {
			return;
		}

		const countdownMsg: Message = {
			type: MessageType.ResumeCountdown,
			secondsRemaining,
		};
		this.broadcast(countdownMsg, true);

		// Also emit locally so host's game layer can react
		this.emit("resumeCountdown", secondsRemaining);
	}

	/**
	 * Drop a player from the game (host only).
	 * Use this to remove a disconnected or lagging player and allow the game to continue.
	 *
	 * @param playerId - The player to drop
	 * @param metadata - Optional metadata (e.g., AI replacement info)
	 */
	dropPlayer(playerId: PlayerId, metadata?: Uint8Array): void {
		if (!this._isHost) {
			throw new Error("Only the host can drop players");
		}

		const player = this._players.get(playerId);
		if (!player) {
			return;
		}

		// Mark player as disconnected locally
		this.markPlayerDisconnected(playerId);

		// Broadcast DropPlayer to all other players
		const dropMsg: Message =
			metadata !== undefined
				? { type: MessageType.DropPlayer, playerId, metadata }
				: { type: MessageType.DropPlayer, playerId };
		this.broadcast(dropMsg, true);

		// Emit locally
		this.emit("playerDropped", playerId, metadata);
	}

	/**
	 * Advance the simulation by one tick.
	 * Call this at your game's tick rate (e.g., 60 times per second).
	 *
	 * @param localInput - The local player's input for this tick (required for pilots, ignored for spectators)
	 * @returns Tick result with rollback info
	 */
	tick(localInput?: Uint8Array): TickResult {
		if (this._state !== SessionState.Playing) {
			return {
				tick: this.engine.currentTick,
				rolledBack: false,
			};
		}

		const currentTick = this.engine.currentTick;

		// Only players send inputs
		if (this._localRole === PlayerRole.Player) {
			if (!localInput) {
				throw new Error("Players must provide input");
			}
			// Set local input
			this.engine.setLocalInput(currentTick, localInput);

			// Broadcast local input to all peers
			this.broadcastInput(currentTick, localInput);
		}

		// Run the engine tick (both pilots and spectators run simulation)
		const result = this.engine.tick();

		// Log rollback if it occurred
		if (result.rolledBack && result.rollbackTicks !== undefined) {
			this.debug.log("Rollback triggered", {
				tick: result.tick,
				rollbackTicks: result.rollbackTicks,
			});
		}

		// Periodic hash broadcast for desync detection
		this.maybeBroadcastHash();

		// Periodic lag check and report (guests only, in host-authority mode)
		this.checkAndReportLag();

		return result;
	}

	/**
	 * Request state sync from host (for desync recovery).
	 */
	requestSync(): void {
		if (this._isHost) {
			return; // Host doesn't need to request sync
		}

		const syncRequest: Message = {
			type: MessageType.SyncRequest,
			playerId: this.localPlayerId,
			desyncTick: this.engine.currentTick,
			localHash: this.engine.getCurrentHash(),
		};
		this.sendToHost(syncRequest);
	}

	/**
	 * Register an event handler.
	 */
	on<E extends keyof SessionEvents>(event: E, handler: SessionEvents[E]): void {
		if (!this.eventHandlers.has(event)) {
			this.eventHandlers.set(event, new Set());
		}
		this.eventHandlers.get(event)?.add(handler);
	}

	/**
	 * Remove an event handler.
	 */
	off<E extends keyof SessionEvents>(
		event: E,
		handler: SessionEvents[E],
	): void {
		this.eventHandlers.get(event)?.delete(handler);
	}

	/**
	 * Emit an event to all registered handlers.
	 */
	private emit<E extends keyof SessionEvents>(
		event: E,
		...args: Parameters<SessionEvents[E]>
	): void {
		const handlers = this.eventHandlers.get(event);
		if (handlers) {
			for (const handler of handlers) {
				try {
					(handler as (...args: Parameters<SessionEvents[E]>) => void)(...args);
				} catch (handlerError) {
					// Avoid infinite recursion: don't emit error events for errors in error handlers
					if (event !== "error") {
						this.emitError(
							handlerError instanceof Error
								? handlerError
								: new Error(String(handlerError)),
							{
								source: ErrorSource.Session,
								recoverable: true,
								details: { event },
							},
						);
					}
				}
			}
		}
	}

	/**
	 * Emit an error event with context.
	 */
	private emitError(error: Error, context: ErrorContext): void {
		this.emit("error", error, context);
	}

	/**
	 * Update session state and emit event.
	 */
	private setState(newState: SessionState): void {
		const oldState = this._state;
		if (oldState === newState) return;

		this._state = newState;
		this.emit("stateChange", newState, oldState);
	}

	/**
	 * Handle incoming message from transport.
	 */
	private handleMessage(peerId: string, data: Uint8Array): void {
		// Record peer response for keepalive tracking
		const transportWithMetrics = this.transport as {
			recordPeerResponse?: (peerId: string) => void;
		};
		transportWithMetrics.recordPeerResponse?.(peerId);

		let message: Message;
		try {
			message = decodeMessage(data);
		} catch (error) {
			this.emitError(
				error instanceof Error ? error : new Error(String(error)),
				{
					source: ErrorSource.Protocol,
					recoverable: true,
					details: { peerId, dataLength: data.length },
				},
			);
			return;
		}

		if (isInputMessage(message)) {
			this.handleInputMessage(message);
		} else if (isHashMessage(message)) {
			this.handleHashMessage(message);
		} else if (isSyncMessage(message) || isStateSyncMessage(message)) {
			this.handleSyncMessage(message);
		} else if (isSyncRequestMessage(message)) {
			this.handleSyncRequest(message);
		} else if (isJoinRequestMessage(message)) {
			this.handleJoinRequest(peerId, message);
		} else if (isJoinAcceptMessage(message)) {
			this.handleJoinAccept(message);
		} else if (isJoinRejectMessage(message)) {
			this.handleJoinReject(message);
		} else if (isPlayerJoinedMessage(message)) {
			this.handlePlayerJoined(message);
		} else if (isPlayerLeftMessage(message)) {
			this.handlePlayerLeft(message);
		} else if (isPauseMessage(message)) {
			this.handlePause(message);
		} else if (isResumeMessage(message)) {
			this.handleResume(message);
		} else if (isPingMessage(message)) {
			this.handlePing(peerId, message);
		} else if (isPongMessage(message)) {
			this.handlePong(peerId, message);
		} else if (isDisconnectReportMessage(message)) {
			this.handleDisconnectReport(message);
		} else if (isLagReportMessage(message)) {
			this.handleLagReport(message);
		} else if (isResumeCountdownMessage(message)) {
			this.handleResumeCountdown(message);
		} else if (isDropPlayerMessage(message)) {
			this.handleDropPlayer(message);
		}
	}

	/**
	 * Handle peer connection.
	 */
	private handlePeerConnect(peerId: string): void {
		this.debug.log("Peer connected", { peerId });

		// Update player state if known
		const playerId = asPlayerId(peerId);
		const player = this._players.get(playerId);
		if (player) {
			player.connectionState = PlayerConnectionState.Connected;
		}
	}

	/**
	 * Handle peer disconnection.
	 */
	private handlePeerDisconnect(peerId: string): void {
		this.debug.log("Peer disconnected", { peerId });

		const playerId = asPlayerId(peerId);

		// In mesh + host-authority mode, guests report to host instead of handling locally
		if (
			this.config.topology === Topology.Mesh &&
			this.config.desyncAuthority === DesyncAuthority.Host
		) {
			if (!this._isHost) {
				// Guest: report to host, don't handle locally yet
				const report: Message = {
					type: MessageType.DisconnectReport,
					disconnectedPeerId: playerId,
				};
				this.sendToHost(report);
				return;
			}
			// Host falls through to handle directly
		}

		// Host or star topology or peer mode: handle directly
		this.markPlayerDisconnected(playerId);
	}

	/**
	 * Mark a player as disconnected and handle cleanup.
	 */
	private markPlayerDisconnected(playerId: PlayerId): void {
		const player = this._players.get(playerId);
		if (!player) return;

		player.connectionState = PlayerConnectionState.Disconnected;

		if (this._state === SessionState.Playing) {
			player.leaveTick = this.engine.currentTick;
			// Only remove players from engine (spectators were never added)
			if (player.role === PlayerRole.Player) {
				this.engine.removePlayer(playerId, player.leaveTick);
			}
			this.emit("playerLeft", player);

			// If host in host-authority mode, broadcast PlayerLeft to all
			if (
				this._isHost &&
				this.config.topology === Topology.Mesh &&
				this.config.desyncAuthority === DesyncAuthority.Host
			) {
				const leaveMsg: Message = {
					type: MessageType.PlayerLeft,
					playerId,
					leaveTick: player.leaveTick,
				};
				this.broadcast(leaveMsg, true);
			}
		}
	}

	/**
	 * Handle disconnect report from a guest (host only, mesh+host-authority mode).
	 */
	private handleDisconnectReport(
		message: Message & { type: MessageType.DisconnectReport },
	): void {
		if (!this._isHost) return;
		this.debug.log("Received disconnect report", {
			disconnectedPeerId: message.disconnectedPeerId,
		});
		this.markPlayerDisconnected(message.disconnectedPeerId);
	}

	/**
	 * Handle lag report from a guest (host only).
	 */
	private handleLagReport(
		message: Message & { type: MessageType.LagReport },
	): void {
		if (!this._isHost) return;
		// Emit event for game layer to handle (pause decision, kick UI, etc.)
		this.emit("lagReport", message.laggyPlayerId, message.ticksBehind);
	}

	/**
	 * Check for lagging players and report to host (guests only, when lag threshold is set).
	 */
	private checkAndReportLag(): void {
		// Only guests report lag in host-authority mode
		if (this._isHost) return;
		if (this.config.lagReportThreshold <= 0) return;

		const currentTick = this.engine.currentTick;

		// Check each remote player's confirmed tick
		for (const player of this._players.values()) {
			if (player.id === this.localPlayerId) continue;
			if (player.role !== PlayerRole.Player) continue;
			if (player.connectionState !== PlayerConnectionState.Connected) continue;

			const confirmedTick = this.engine.getConfirmedTickForPlayer(player.id);
			if (confirmedTick === undefined) continue;

			const ticksBehind = currentTick - confirmedTick;

			if (ticksBehind >= this.config.lagReportThreshold) {
				// Check cooldown to avoid spamming
				const lastReport = this.lastLagReportTick.get(player.id);
				if (
					lastReport !== undefined &&
					currentTick - lastReport < LAG_REPORT_COOLDOWN_TICKS
				) {
					continue;
				}

				// Send lag report to host
				const lagReport: Message = {
					type: MessageType.LagReport,
					laggyPlayerId: player.id,
					ticksBehind,
				};
				this.sendToHost(lagReport);
				this.lastLagReportTick.set(player.id, currentTick);

				this.debug.log("Sent lag report", {
					laggyPlayerId: player.id,
					ticksBehind,
				});
			}
		}
	}

	/**
	 * Handle resume countdown message.
	 */
	private handleResumeCountdown(
		message: Message & { type: MessageType.ResumeCountdown },
	): void {
		this.emit("resumeCountdown", message.secondsRemaining);
	}

	/**
	 * Handle drop player message.
	 */
	private handleDropPlayer(
		message: Message & { type: MessageType.DropPlayer },
	): void {
		this.markPlayerDisconnected(message.playerId);
		this.emit("playerDropped", message.playerId, message.metadata);
	}

	/**
	 * Handle input message from remote player.
	 */
	private handleInputMessage(
		message: Message & { type: MessageType.Input },
	): void {
		for (const { tick, input } of message.inputs) {
			this.engine.receiveRemoteInput(message.playerId, tick, input);
		}

		// Log once per message, not per input (reduces noise)
		if (message.inputs.length > 0) {
			this.debug.trace("Inputs received", {
				playerId: message.playerId,
				count: message.inputs.length,
				ticks: message.inputs.map((i) => i.tick),
			});
		}

		// Check if we should relay inputs based on topology
		if (
			this.topologyStrategy.shouldRelayInput(message.playerId, this._isHost)
		) {
			const targets = this.topologyStrategy.getRelayTargets(
				message.playerId,
				this.transport.connectedPeers,
			);
			if (targets.length > 0) {
				const encoded = encodeMessage(message);
				for (const peerId of targets) {
					this.transport.send(peerId, encoded, false);
				}
			}
		}
	}

	/**
	 * Handle hash message for desync detection.
	 */
	private handleHashMessage(
		message: Message & { type: MessageType.Hash },
	): void {
		// Host-authority mode: host collects and compares
		if (
			this.config.topology === Topology.Mesh &&
			this.config.desyncAuthority === DesyncAuthority.Host
		) {
			if (this._isHost) {
				this.recordHashAndCheckDesync(
					message.tick,
					message.playerId,
					message.hash,
				);
			}
			// Guests don't compare hashes in host-authority mode
			return;
		}

		// Peer mode: existing comparison logic
		const localHash = this.engine.getHash(message.tick);

		if (localHash !== undefined && localHash !== message.hash) {
			this.debug.warn("Desync detected", {
				tick: message.tick,
				localHash,
				remoteHash: message.hash,
				remotePlayer: message.playerId,
			});

			this.emit("desync", message.tick, localHash, message.hash);

			// Request sync if we're not the host
			if (!this._isHost) {
				this.requestSync();
			}
		}
	}

	/**
	 * Handle sync message (state synchronization).
	 */
	private handleSyncMessage(
		message:
			| (Message & { type: MessageType.Sync })
			| (Message & { type: MessageType.StateSync }),
	): void {
		this.engine.setState(message.tick, message.state, message.playerTimeline);

		// Update player list
		for (const entry of message.playerTimeline) {
			if (!this._players.has(entry.playerId)) {
				this._players.set(entry.playerId, {
					id: entry.playerId,
					connectionState: PlayerConnectionState.Connected,
					joinTick: entry.joinTick,
					leaveTick: entry.leaveTick,
					isHost: false,
					role: PlayerRole.Player, // Default to player; role info may come from elsewhere
				});
			}
		}

		if (
			this._state === SessionState.Connecting ||
			this._state === SessionState.Lobby
		) {
			this.setState(SessionState.Playing);
			this.emit("gameStart");
		}
	}

	/**
	 * Handle sync request (host only).
	 */
	private handleSyncRequest(
		message: Message & { type: MessageType.SyncRequest },
	): void {
		if (!this._isHost) return;

		const state = this.engine.getState();
		const syncMsg: Message = {
			type: MessageType.Sync,
			tick: state.tick,
			state: state.state,
			hash: this.engine.getCurrentHash(),
			playerTimeline: state.playerTimeline,
		};

		// Send to the requesting player
		this.sendToPeer(message.playerId, syncMsg, true);
	}

	/**
	 * Check if a peer is rate limited for join requests.
	 */
	private isJoinRateLimited(peerId: string): boolean {
		const now = Date.now();
		const times = this.joinRequestTimes.get(peerId) ?? [];

		// Remove timestamps outside the window
		const recentTimes = times.filter((t) => now - t < JOIN_REQUEST_WINDOW_MS);
		this.joinRequestTimes.set(peerId, recentTimes);

		return recentTimes.length >= JOIN_REQUEST_LIMIT;
	}

	/**
	 * Record a join request for rate limiting.
	 */
	private recordJoinRequest(peerId: string): void {
		const times = this.joinRequestTimes.get(peerId) ?? [];
		times.push(Date.now());
		this.joinRequestTimes.set(peerId, times);
	}

	/**
	 * Clean up stale rate limit entries to prevent memory growth.
	 */
	private cleanupRateLimitEntries(): void {
		const now = Date.now();
		for (const [peerId, times] of this.joinRequestTimes) {
			const recentTimes = times.filter((t) => now - t < JOIN_REQUEST_WINDOW_MS);
			if (recentTimes.length === 0) {
				this.joinRequestTimes.delete(peerId);
			} else {
				this.joinRequestTimes.set(peerId, recentTimes);
			}
		}
	}

	/**
	 * Handle join request (host only).
	 */
	private handleJoinRequest(
		peerId: string,
		message: Message & { type: MessageType.JoinRequest },
	): void {
		if (!this._isHost || !this._roomId) return;

		const playerId = message.playerId;

		// Check rate limiting
		if (this.isJoinRateLimited(peerId)) {
			const rejectMsg: Message = {
				type: MessageType.JoinReject,
				playerId,
				reason: "Too many join requests, please wait",
			};
			this.sendToPeer(peerId, rejectMsg, true);
			return;
		}

		// Record this join request
		this.recordJoinRequest(peerId);

		// Check if room is full
		if (this._players.size >= this.config.maxPlayers) {
			const rejectMsg: Message = {
				type: MessageType.JoinReject,
				playerId,
				reason: "Room is full",
			};
			this.sendToPeer(peerId, rejectMsg, true);
			return;
		}

		// Accept the join
		const acceptMsg: Message = {
			type: MessageType.JoinAccept,
			playerId,
			roomId: this._roomId,
			config: {
				tickRate: this.config.tickRate,
				maxPlayers: this.config.maxPlayers,
			},
			players: Array.from(this._players.keys()),
		};
		this.sendToPeer(peerId, acceptMsg, true);

		// Add player
		const playerRole: PlayerRole = message.role ?? PlayerRole.Player;
		const playerInfo: PlayerInfo = {
			id: playerId,
			connectionState: PlayerConnectionState.Connected,
			joinTick:
				this._state === SessionState.Playing ? this.engine.currentTick : null,
			leaveTick: null,
			isHost: false,
			role: playerRole,
		};
		this._players.set(playerId, playerInfo);

		// Only add players to the engine (spectators don't contribute inputs)
		if (
			this._state === SessionState.Playing &&
			playerInfo.joinTick !== null &&
			playerRole === PlayerRole.Player
		) {
			this.engine.addPlayer(playerId, playerInfo.joinTick);
		}

		// Notify other players
		if (this._state === SessionState.Playing && playerInfo.joinTick !== null) {
			const joinedMsg: Message = {
				type: MessageType.PlayerJoined,
				playerId,
				joinTick: playerInfo.joinTick,
				role: playerRole,
			};
			this.broadcast(joinedMsg, true);
		}

		this.emit("playerJoined", playerInfo);
	}

	/**
	 * Handle join accept.
	 */
	private handleJoinAccept(
		message: Message & { type: MessageType.JoinAccept },
	): void {
		this.setState(SessionState.Lobby);

		// Add existing players
		for (const playerId of message.players) {
			if (!this._players.has(playerId)) {
				this._players.set(playerId, {
					id: playerId,
					connectionState: PlayerConnectionState.Connected,
					joinTick: null,
					leaveTick: null,
					isHost: playerId === message.players[0], // First player is host
					role: PlayerRole.Player, // Default; actual role will come from PlayerJoined
				});
			}
		}
	}

	/**
	 * Handle join reject.
	 */
	private handleJoinReject(
		message: Message & { type: MessageType.JoinReject },
	): void {
		this.setState(SessionState.Disconnected);
		this.emitError(new Error(`Join rejected: ${message.reason}`), {
			source: ErrorSource.Session,
			recoverable: false,
			details: { reason: message.reason, playerId: message.playerId },
		});
	}

	/**
	 * Handle player joined notification.
	 */
	private handlePlayerJoined(
		message: Message & { type: MessageType.PlayerJoined },
	): void {
		const playerInfo: PlayerInfo = {
			id: message.playerId,
			connectionState: PlayerConnectionState.Connected,
			joinTick: message.joinTick,
			leaveTick: null,
			isHost: false,
			role: message.role,
		};
		this._players.set(message.playerId, playerInfo);
		// Only add players to the engine (spectators don't contribute inputs)
		if (message.role === PlayerRole.Player) {
			this.engine.addPlayer(message.playerId, message.joinTick);
		}
		this.emit("playerJoined", playerInfo);
	}

	/**
	 * Handle player left notification.
	 */
	private handlePlayerLeft(
		message: Message & { type: MessageType.PlayerLeft },
	): void {
		const player = this._players.get(message.playerId);
		if (player) {
			player.leaveTick = message.leaveTick;
			player.connectionState = PlayerConnectionState.Disconnected;
			this.engine.removePlayer(message.playerId, message.leaveTick);
			this.emit("playerLeft", player);
		}
	}

	/**
	 * Handle pause message.
	 */
	private handlePause(_message: Message & { type: MessageType.Pause }): void {
		this.setState(SessionState.Paused);
	}

	/**
	 * Handle resume message.
	 */
	private handleResume(_message: Message & { type: MessageType.Resume }): void {
		this.setState(SessionState.Playing);
	}

	/**
	 * Handle ping message - respond with pong.
	 */
	private handlePing(
		peerId: string,
		message: Message & { type: MessageType.Ping },
	): void {
		// Respond with pong containing the original timestamp
		const pongMsg: Message = {
			type: MessageType.Pong,
			timestamp: message.timestamp,
		};
		this.transport.send(peerId, encodeMessage(pongMsg), false);
	}

	/**
	 * Handle pong message - record RTT for metrics.
	 */
	private handlePong(
		peerId: string,
		message: Message & { type: MessageType.Pong },
	): void {
		// Record the pong for RTT calculation if transport supports metrics
		if (this.transport.getConnectionMetrics) {
			// The transport needs to track this - call recordPongReceived if available
			const transport = this.transport as {
				recordPongReceived?: (peerId: string, timestamp: number) => void;
			};
			transport.recordPongReceived?.(peerId, message.timestamp);
		}
	}

	/**
	 * Send a ping to a peer for RTT measurement.
	 *
	 * @param peerId - The peer to ping
	 */
	sendPing(peerId: string): void {
		const timestamp = Date.now();
		const pingMsg: Message = {
			type: MessageType.Ping,
			timestamp,
		};
		this.transport.send(peerId, encodeMessage(pingMsg), false);

		// Record the ping for RTT calculation if transport supports metrics
		const transport = this.transport as {
			recordPingSent?: (peerId: string, timestamp: number) => void;
		};
		transport.recordPingSent?.(peerId, timestamp);
	}

	/**
	 * Broadcast input to all peers with redundancy.
	 */
	private broadcastInput(tick: Tick, input: Uint8Array): void {
		const inputs: Array<{ tick: Tick; input: Uint8Array }> = [];

		// Add current tick
		inputs.push({ tick, input });

		// Add previous ticks for redundancy
		for (let i = 1; i < this.inputRedundancy; i++) {
			const prevTick = asTick(tick - i);
			if (prevTick >= 0) {
				const prevInput = this.engine.getLocalInput(prevTick);
				if (prevInput) {
					inputs.push({ tick: prevTick, input: prevInput });
				}
			}
		}

		const inputMsg: Message = {
			type: MessageType.Input,
			playerId: this.localPlayerId,
			inputs,
		};

		this.broadcast(inputMsg, false);
	}

	/**
	 * Maybe broadcast hash for desync detection.
	 */
	private maybeBroadcastHash(): void {
		const currentTick = this.engine.currentTick;

		if (currentTick - this.lastHashBroadcastTick >= this.config.hashInterval) {
			this.lastHashBroadcastTick = currentTick;

			const hash = this.engine.getCurrentHash();
			const hashMsg: Message = {
				type: MessageType.Hash,
				playerId: this.localPlayerId,
				tick: currentTick,
				hash,
			};

			// Host-authority in mesh: guests send to host only, host collects
			if (
				this.config.topology === Topology.Mesh &&
				this.config.desyncAuthority === DesyncAuthority.Host
			) {
				if (this._isHost) {
					// Host records own hash and checks for desync
					this.recordHashAndCheckDesync(currentTick, this.localPlayerId, hash);
				} else {
					// Guest sends hash to host only
					this.sendToHost(hashMsg);
				}
			} else {
				// Peer mode or star topology: broadcast to all
				this.broadcast(hashMsg, true);
			}
		}
	}

	/**
	 * Record a hash from a player and check for desync (host-authority mode).
	 */
	private recordHashAndCheckDesync(
		tick: Tick,
		playerId: PlayerId,
		hash: number,
	): void {
		if (!this._isHost) return;

		// Get or create tick entry
		let tickHashes = this.receivedHashes.get(tick);
		if (!tickHashes) {
			tickHashes = new Map();
			this.receivedHashes.set(tick, tickHashes);
		}
		tickHashes.set(playerId, hash);

		// Check if we have hashes from all active players
		const activePlayers = Array.from(this._players.values()).filter(
			(p) =>
				p.role === PlayerRole.Player &&
				p.connectionState === PlayerConnectionState.Connected,
		);
		if (tickHashes.size < activePlayers.length) {
			return; // Still waiting for more hashes
		}

		// Compare all hashes against host's hash
		const hostHash = tickHashes.get(this.localPlayerId);
		if (hostHash === undefined) return;

		for (const [pid, playerHash] of tickHashes) {
			if (pid === this.localPlayerId) continue;
			if (playerHash !== hostHash) {
				this.debug.warn("Desync detected by host", {
					tick,
					playerId: pid,
					hostHash,
					playerHash,
				});
				this.emit("desync", tick, hostHash, playerHash);

				// Send authoritative state to desynced player
				const state = this.engine.getState();
				const syncMsg: Message = {
					type: MessageType.Sync,
					tick: state.tick,
					state: state.state,
					hash: this.engine.getCurrentHash(),
					playerTimeline: state.playerTimeline,
				};
				this.sendToPeer(pid, syncMsg, true);
			}
		}

		// Cleanup old tick entries
		this.pruneReceivedHashes(tick);
	}

	/**
	 * Remove old hash entries to prevent memory growth.
	 */
	private pruneReceivedHashes(currentTick: Tick): void {
		const pruneBelow = asTick(currentTick - this.config.hashInterval * 2);
		for (const tick of this.receivedHashes.keys()) {
			if (tick < pruneBelow) {
				this.receivedHashes.delete(tick);
			}
		}
	}

	/**
	 * Send a message to all connected peers.
	 */
	private broadcast(message: Message, reliable: boolean): void {
		const encoded = encodeMessage(message);
		this.transport.broadcast(encoded, reliable);
	}

	/**
	 * Send a message to a specific peer.
	 */
	private sendToPeer(
		peerId: string,
		message: Message,
		reliable: boolean,
	): void {
		const encoded = encodeMessage(message);
		this.transport.send(peerId, encoded, reliable);
	}

	/**
	 * Send a message to the host.
	 */
	private sendToHost(message: Message): void {
		// Find the host player
		for (const player of this._players.values()) {
			if (player.isHost && player.id !== this.localPlayerId) {
				this.sendToPeer(player.id, message, isReliableMessage(message));
				return;
			}
		}

		// If we can't find the host by player info, send to first connected peer
		const peers = this.transport.connectedPeers;
		if (peers.size > 0) {
			const hostPeerId = peers.values().next().value as string;
			this.sendToPeer(hostPeerId, message, isReliableMessage(message));
		}
	}
}

/**
 * Convenience function to create a session.
 */
export function createSession(options: CreateSessionOptions): Session {
	return new Session(options);
}
