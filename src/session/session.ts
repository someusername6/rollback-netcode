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
	playerIdToPeerId,
	validateSessionConfig,
} from "../types.js";

import { type DebugLogger, createDebugLogger } from "../debug.js";
import { encodeMessage } from "../protocol/encoding.js";
import {
	type Message,
	type MessageType,
	isReliableMessage,
} from "../protocol/messages.js";
import {
	RollbackEngine,
	type RollbackEngineConfig,
} from "../rollback/engine.js";
import { RateLimiter } from "../utils/rate-limiter.js";
import { DesyncManager } from "./desync-manager.js";
import {
	DEFAULT_LAG_REPORT_COOLDOWN_TICKS,
	LagMonitor,
} from "./lag-monitor.js";
import {
	createDisconnectReport,
	createDropPlayer,
	createHash,
	createInput,
	createJoinAccept,
	createJoinReject,
	createJoinRequest,
	createLagReport,
	createPause,
	createPing,
	createPlayerJoined,
	createPlayerLeft,
	createPong,
	createResume,
	createResumeCountdown,
	createStateSync,
	createSync,
	createSyncRequest,
} from "./message-builders.js";
import { type MessageHandlers, MessageRouter } from "./message-router.js";
import { PlayerManager } from "./player-manager.js";
import { type TopologyStrategy, createTopologyStrategy } from "./topology.js";

/** Interval for cleaning up stale rate limit entries (in milliseconds) */
const RATE_LIMIT_CLEANUP_INTERVAL_MS = 60000;

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

// Type alias for event handler functions
type EventHandler = (...args: never[]) => void;

/**
 * Session manager that coordinates the rollback engine with network transport.
 */
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

	// Extracted components
	private readonly playerManager: PlayerManager;
	private readonly desyncManager: DesyncManager;
	private readonly lagMonitor: LagMonitor;
	private readonly joinRateLimiter: RateLimiter;
	private readonly messageRouter: MessageRouter;

	private _state: SessionState = SessionState.Disconnected;
	private _isHost = false;
	private _roomId: string | null = null;
	private _localRole: PlayerRole = PlayerRole.Player;
	private lastHashBroadcastTick: Tick = asTick(-1);
	private readonly inputRedundancy: number;

	/** Timer for periodic rate limit cleanup */
	private rateLimitCleanupTimer: ReturnType<typeof setInterval> | null = null;

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

		// Initialize extracted components
		this.playerManager = new PlayerManager();
		this.desyncManager = new DesyncManager({
			topology: this.config.topology,
			desyncAuthority: this.config.desyncAuthority,
			hashInterval: this.config.hashInterval,
		});
		this.lagMonitor = new LagMonitor({
			threshold: this.config.lagReportThreshold,
			cooldownTicks: DEFAULT_LAG_REPORT_COOLDOWN_TICKS,
		});
		this.joinRateLimiter = new RateLimiter({
			maxRequests: this.config.joinRateLimitRequests,
			windowMs: this.config.joinRateLimitWindowMs,
		});
		this.inputRedundancy = this.config.inputRedundancy;

		// Create message router with handlers
		this.messageRouter = new MessageRouter(
			this.createMessageHandlers(),
			this.handleDecodeError.bind(this),
		);

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
		this.playerManager.addPlayer({
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
			this.joinRateLimiter.cleanup();
		}, RATE_LIMIT_CLEANUP_INTERVAL_MS);
		if (this.rateLimitCleanupTimer.unref) {
			this.rateLimitCleanupTimer.unref();
		}
	}

	/**
	 * Create message handlers bound to this session.
	 */
	private createMessageHandlers(): MessageHandlers {
		return {
			onInput: (msg) => this.handleInputMessage(msg),
			onHash: (msg) => this.handleHashMessage(msg),
			onSync: (msg) => this.handleSyncMessage(msg),
			onSyncRequest: (msg) => this.handleSyncRequest(msg),
			onJoinRequest: (msg, peerId) => this.handleJoinRequest(peerId, msg),
			onJoinAccept: (msg) => this.handleJoinAccept(msg),
			onJoinReject: (msg) => this.handleJoinReject(msg),
			onPlayerJoined: (msg) => this.handlePlayerJoined(msg),
			onPlayerLeft: (msg) => this.handlePlayerLeft(msg),
			onPause: (msg) => this.handlePause(msg),
			onResume: (msg) => this.handleResume(msg),
			onPing: (msg, peerId) => this.handlePing(peerId, msg),
			onPong: (msg, peerId) => this.handlePong(peerId, msg),
			onDisconnectReport: (msg) => this.handleDisconnectReport(msg),
			onLagReport: (msg) => this.handleLagReport(msg),
			onResumeCountdown: (msg) => this.handleResumeCountdown(msg),
			onDropPlayer: (msg) => this.handleDropPlayer(msg),
		};
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
		return this.playerManager.asReadonlyMap();
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
		const localPlayer = this.playerManager.getPlayer(this.localPlayerId);
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

		const peerId = playerIdToPeerId(playerId);

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

		// Clear component state
		this.joinRateLimiter.clear();
		this.lagMonitor.clear();
		this.desyncManager.clear();

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
		const localPlayer = this.playerManager.getPlayer(this.localPlayerId);
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
		this.sendToHost(createJoinRequest(this.localPlayerId, this._localRole));
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
			this.broadcast(
				createPlayerLeft(this.localPlayerId, this.engine.currentTick),
				true,
			);
		}

		// Disconnect from all peers
		this.transport.disconnectAll();

		// Reset state
		this._roomId = null;
		this._isHost = false;
		this.playerManager.clear();
		this.engine.reset();

		// Re-add local player
		this.playerManager.addPlayer({
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
		for (const player of this.playerManager) {
			player.joinTick = startTick;
			// Only players contribute inputs - spectators run simulation but don't send inputs
			if (player.role === PlayerRole.Player) {
				this.engine.addPlayer(player.id, startTick);
			}
		}

		// Send state sync to all players
		const state = this.engine.getState();
		this.broadcast(
			createStateSync(
				state.tick,
				state.state,
				this.engine.getCurrentHash(),
				state.playerTimeline,
			),
			true,
		);

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

		this.broadcast(
			createPause(this.localPlayerId, this.engine.currentTick, reason),
			true,
		);

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

		this.broadcast(
			createResume(this.localPlayerId, this.engine.currentTick),
			true,
		);

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

		this.broadcast(createResumeCountdown(secondsRemaining), true);

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

		const player = this.playerManager.getPlayer(playerId);
		if (!player) {
			return;
		}

		// Mark player as disconnected locally
		this.markPlayerDisconnected(playerId);

		// Broadcast DropPlayer to all other players
		this.broadcast(createDropPlayer(playerId, metadata), true);

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

		this.sendToHost(
			createSyncRequest(
				this.localPlayerId,
				this.engine.currentTick,
				this.engine.getCurrentHash(),
			),
		);
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
	 * Remove all event handlers.
	 *
	 * Optionally specify an event type to only remove handlers for that event.
	 * Call this during cleanup to prevent memory leaks.
	 *
	 * @param event - Optional event type to clear handlers for
	 */
	removeAllListeners<E extends keyof SessionEvents>(event?: E): void {
		if (event !== undefined) {
			this.eventHandlers.delete(event);
		} else {
			this.eventHandlers.clear();
		}
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
	 * Valid state transitions for the session state machine.
	 *
	 * State machine:
	 * ```
	 *   Disconnected ──→ Connecting ──→ Lobby ──→ Playing ⇄ Paused
	 *        ↑               │            │         │         │
	 *        └───────────────┴────────────┴─────────┴─────────┘
	 *                    (any state can go to Disconnected)
	 * ```
	 */
	private static readonly VALID_TRANSITIONS = new Map<
		SessionState,
		Set<SessionState>
	>([
		[
			SessionState.Disconnected,
			new Set([SessionState.Connecting, SessionState.Lobby]),
		],
		[
			SessionState.Connecting,
			new Set([
				SessionState.Lobby,
				SessionState.Playing,
				SessionState.Disconnected,
			]),
		],
		[
			SessionState.Lobby,
			new Set([SessionState.Playing, SessionState.Disconnected]),
		],
		[
			SessionState.Playing,
			new Set([SessionState.Paused, SessionState.Disconnected]),
		],
		[
			SessionState.Paused,
			new Set([SessionState.Playing, SessionState.Disconnected]),
		],
	]);

	/**
	 * Update session state and emit event.
	 * Validates that the transition is allowed by the state machine.
	 */
	private setState(newState: SessionState): void {
		const oldState = this._state;
		if (oldState === newState) return;

		// Validate transition
		const validNextStates = Session.VALID_TRANSITIONS.get(oldState);
		if (!validNextStates?.has(newState)) {
			this.debug.warn("Invalid state transition attempted", {
				from: SessionState[oldState],
				to: SessionState[newState],
			});
			// Still allow the transition for robustness, but log a warning
		}

		this._state = newState;
		this.emit("stateChange", newState, oldState);
	}

	/**
	 * Handle decode error from message router.
	 */
	private handleDecodeError(
		error: Error,
		peerId: string,
		dataLength: number,
	): void {
		this.emitError(error, {
			source: ErrorSource.Protocol,
			recoverable: true,
			details: { peerId, dataLength },
		});
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

		// Route through message router
		this.messageRouter.route(peerId, data);
	}

	/**
	 * Handle peer connection.
	 */
	private handlePeerConnect(peerId: string): void {
		this.debug.log("Peer connected", { peerId });

		// Update player state if known
		const playerId = asPlayerId(peerId);
		this.playerManager.markConnected(playerId);
	}

	/**
	 * Handle peer disconnection.
	 */
	private handlePeerDisconnect(peerId: string): void {
		this.debug.log("Peer disconnected", { peerId });

		const playerId = asPlayerId(peerId);

		// In host-authority mode, guests report to host instead of handling locally
		if (this.desyncManager.isHostAuthority && !this._isHost) {
			this.sendToHost(createDisconnectReport(playerId));
			return;
		}

		// Host or star topology or peer mode: handle directly
		this.markPlayerDisconnected(playerId);
	}

	/**
	 * Mark a player as disconnected and handle cleanup.
	 */
	private markPlayerDisconnected(playerId: PlayerId): void {
		const player = this.playerManager.getPlayer(playerId);
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
			if (this._isHost && this.desyncManager.isHostAuthority) {
				this.broadcast(createPlayerLeft(playerId, player.leaveTick), true);
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
		if (!this.lagMonitor.isEnabled) return;

		const currentTick = this.engine.currentTick;

		// Check each remote player's confirmed tick
		for (const player of this.playerManager) {
			if (player.id === this.localPlayerId) continue;
			if (player.role !== PlayerRole.Player) continue;
			if (player.connectionState !== PlayerConnectionState.Connected) continue;

			const confirmedTick = this.engine.getConfirmedTickForPlayer(player.id);
			if (confirmedTick === undefined) continue;

			const ticksBehind = currentTick - confirmedTick;
			const lagReport = this.lagMonitor.checkPlayer(
				player.id,
				ticksBehind,
				currentTick,
			);

			if (lagReport) {
				this.sendToHost(
					createLagReport(lagReport.laggyPlayerId, lagReport.ticksBehind),
				);

				this.debug.log("Sent lag report", {
					laggyPlayerId: lagReport.laggyPlayerId,
					ticksBehind: lagReport.ticksBehind,
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
		if (this.desyncManager.isHostAuthority) {
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

		// Peer mode: use desync manager for comparison
		const localHash = this.engine.getHash(message.tick);
		const desyncResult = this.desyncManager.checkPeerDesync(
			message.tick,
			localHash,
			message.hash,
			message.playerId,
		);

		if (desyncResult) {
			this.debug.warn("Desync detected", {
				tick: message.tick,
				localHash: desyncResult.localHash,
				remoteHash: desyncResult.remoteHash,
				remotePlayer: message.playerId,
			});

			this.emit(
				"desync",
				message.tick,
				desyncResult.localHash,
				desyncResult.remoteHash,
			);

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
			if (!this.playerManager.hasPlayer(entry.playerId)) {
				this.playerManager.addPlayer({
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
		const syncMsg = createSync(
			state.tick,
			state.state,
			this.engine.getCurrentHash(),
			state.playerTimeline,
		);

		// Send to the requesting player
		this.sendToPeer(message.playerId, syncMsg, true);
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
		if (this.joinRateLimiter.checkAndRecord(peerId)) {
			this.sendToPeer(
				peerId,
				createJoinReject(playerId, "Too many join requests, please wait"),
				true,
			);
			return;
		}

		// Check if room is full
		if (this.playerManager.size >= this.config.maxPlayers) {
			this.sendToPeer(peerId, createJoinReject(playerId, "Room is full"), true);
			return;
		}

		// Accept the join
		this.sendToPeer(
			peerId,
			createJoinAccept(
				playerId,
				this._roomId,
				{ tickRate: this.config.tickRate, maxPlayers: this.config.maxPlayers },
				this.playerManager.getPlayerIds(),
			),
			true,
		);

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
		this.playerManager.addPlayer(playerInfo);

		// Only add players to the engine (spectators don't contribute inputs)
		if (
			this._state === SessionState.Playing &&
			playerInfo.joinTick !== null &&
			playerRole === PlayerRole.Player
		) {
			this.engine.addPlayer(playerId, playerInfo.joinTick);
		}

		// Emit playerJoined BEFORE sending StateSync so the game layer can
		// add the new player to its state before serialization
		this.emit("playerJoined", playerInfo);

		// Send current game state to the joining player if game is in progress
		// This is critical for mid-game joins - the new player needs the full state
		if (this._state === SessionState.Playing) {
			const state = this.engine.getState();
			this.sendToPeer(
				peerId,
				createStateSync(
					state.tick,
					state.state,
					this.engine.getCurrentHash(),
					state.playerTimeline,
				),
				true,
			);
		}

		// Notify other players about the new join
		if (this._state === SessionState.Playing && playerInfo.joinTick !== null) {
			this.broadcast(
				createPlayerJoined(playerId, playerRole, playerInfo.joinTick),
				true,
			);
		}
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
			if (!this.playerManager.hasPlayer(playerId)) {
				this.playerManager.addPlayer({
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
		this.playerManager.addPlayer(playerInfo);
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
		const player = this.playerManager.getPlayer(message.playerId);
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
		this.transport.send(
			peerId,
			encodeMessage(createPong(message.timestamp)),
			false,
		);
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
		this.transport.send(peerId, encodeMessage(createPing(timestamp)), false);

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

		this.broadcast(createInput(this.localPlayerId, inputs), false);
	}

	/**
	 * Maybe broadcast hash for desync detection.
	 * Note: engine.currentTick is the NEXT tick to process, so we broadcast
	 * the hash for currentTick - 1 (the tick we just completed).
	 */
	private maybeBroadcastHash(): void {
		const currentTick = this.engine.currentTick;
		// The tick we just processed and have a snapshot for
		const completedTick = asTick(currentTick - 1);

		if (
			completedTick - this.lastHashBroadcastTick >=
			this.config.hashInterval
		) {
			this.lastHashBroadcastTick = completedTick;

			const hash = this.engine.getCurrentHash();
			const hashMsg = createHash(this.localPlayerId, completedTick, hash);

			// Host-authority in mesh: guests send to host only, host collects
			if (this.desyncManager.isHostAuthority) {
				if (this._isHost) {
					// Host records own hash and checks for desync
					this.recordHashAndCheckDesync(
						completedTick,
						this.localPlayerId,
						hash,
					);
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

		// Record the hash
		this.desyncManager.recordHash(tick, playerId, hash);

		// Check if we have hashes from all active players
		const activePlayers = this.playerManager.getActivePlayers();
		if (!this.desyncManager.hasAllHashes(tick, activePlayers.length)) {
			return; // Still waiting for more hashes
		}

		// Check for desyncs
		const desyncs = this.desyncManager.checkDesyncs(tick, this.localPlayerId);
		for (const desync of desyncs) {
			this.debug.warn("Desync detected by host", {
				tick: desync.tick,
				playerId: desync.desyncedPlayerId,
				hostHash: desync.referenceHash,
				playerHash: desync.playerHash,
			});
			this.emit("desync", desync.tick, desync.referenceHash, desync.playerHash);

			// Send authoritative state to desynced player
			const state = this.engine.getState();
			this.sendToPeer(
				desync.desyncedPlayerId,
				createSync(
					state.tick,
					state.state,
					this.engine.getCurrentHash(),
					state.playerTimeline,
				),
				true,
			);
		}

		// Cleanup old tick entries
		this.desyncManager.pruneOldHashes(tick);
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
		const host = this.playerManager.findHost();
		if (host && host.id !== this.localPlayerId) {
			this.sendToPeer(host.id, message, isReliableMessage(message));
			return;
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
