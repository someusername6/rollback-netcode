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
	type ErrorContext,
	type Game,
	type InputPredictor,
	type PlayerId,
	type PlayerInfo,
	type SessionConfig,
	type SessionEvents,
	type SessionState,
	type Tick,
	type TickResult,
	asPlayerId,
	asTick,
	validateSessionConfig,
} from "../types.js";

/** Number of ticks of input to include in each message for redundancy */
const DEFAULT_INPUT_REDUNDANCY = 3;
import { decodeMessage, encodeMessage } from "../protocol/encoding.js";
import {
	type Message,
	MessageType,
	isHashMessage,
	isInputMessage,
	isJoinAcceptMessage,
	isJoinRejectMessage,
	isJoinRequestMessage,
	isPauseMessage,
	isPingMessage,
	isPlayerJoinedMessage,
	isPlayerLeftMessage,
	isPongMessage,
	isReliableMessage,
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
import { type DebugLogger, createDebugLogger } from "../debug.js";

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
 * Generate a random room ID.
 */
function generateRoomId(): string {
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

	private _state: SessionState = "disconnected";
	private _isHost = false;
	private _roomId: string | null = null;
	private readonly _players: Map<PlayerId, PlayerInfo> = new Map();
	private lastHashBroadcastTick: Tick = asTick(-1);
	private inputRedundancy = DEFAULT_INPUT_REDUNDANCY;

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
			connectionState: "connected",
			joinTick: null,
			leaveTick: null,
			isHost: false,
		});

		// Setup transport callbacks
		this.transport.onMessage = this.handleMessage.bind(this);
		this.transport.onConnect = this.handlePeerConnect.bind(this);
		this.transport.onDisconnect = this.handlePeerDisconnect.bind(this);
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
	 * Create a new room and become the host.
	 *
	 * @param options - Room options
	 * @returns The room ID
	 */
	async createRoom(options?: { maxPlayers?: number }): Promise<string> {
		if (this._state !== "disconnected") {
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

		this.setState("lobby");
		return this._roomId;
	}

	/**
	 * Join an existing room.
	 *
	 * @param roomId - The room ID to join
	 * @param hostPeerId - The host's peer ID
	 */
	async joinRoom(roomId: string, hostPeerId: string): Promise<void> {
		if (this._state !== "disconnected") {
			throw new Error("Already in a room or connecting");
		}

		this._roomId = roomId;
		this._isHost = false;
		this.setState("connecting");

		// Connect to host
		await this.transport.connect(hostPeerId);

		// Send join request
		const joinRequest: Message = {
			type: MessageType.JoinRequest,
			playerId: this.localPlayerId,
		};
		this.sendToHost(joinRequest);
	}

	/**
	 * Leave the current room.
	 */
	leaveRoom(): void {
		if (this._state === "disconnected") {
			return;
		}

		// Notify other players
		if (this._state === "playing") {
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
			connectionState: "connected",
			joinTick: null,
			leaveTick: null,
			isHost: false,
		});

		this.setState("disconnected");
	}

	/**
	 * Start the game (host only).
	 * Transitions from lobby to playing state.
	 */
	start(): void {
		if (!this._isHost) {
			throw new Error("Only the host can start the game");
		}
		if (this._state !== "lobby") {
			throw new Error("Can only start from lobby state");
		}

		// Set join ticks for all players
		const startTick = asTick(0);
		for (const player of this._players.values()) {
			player.joinTick = startTick;
			this.engine.addPlayer(player.id, startTick);
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

		this.setState("playing");
		this.emit("gameStart");
	}

	/**
	 * Pause the game (host only).
	 */
	pause(): void {
		if (!this._isHost) {
			throw new Error("Only the host can pause");
		}
		if (this._state !== "playing") {
			return;
		}

		const pauseMsg: Message = {
			type: MessageType.Pause,
			playerId: this.localPlayerId,
			pauseTick: this.engine.currentTick,
		};
		this.broadcast(pauseMsg, true);

		this.setState("paused");
	}

	/**
	 * Resume the game (host only).
	 */
	resume(): void {
		if (!this._isHost) {
			throw new Error("Only the host can resume");
		}
		if (this._state !== "paused") {
			return;
		}

		const resumeMsg: Message = {
			type: MessageType.Resume,
			playerId: this.localPlayerId,
			resumeTick: this.engine.currentTick,
		};
		this.broadcast(resumeMsg, true);

		this.setState("playing");
	}

	/**
	 * Advance the simulation by one tick.
	 * Call this at your game's tick rate (e.g., 60 times per second).
	 *
	 * @param localInput - The local player's input for this tick
	 * @returns Tick result with rollback info
	 */
	tick(localInput: Uint8Array): TickResult {
		if (this._state !== "playing") {
			return {
				tick: this.engine.currentTick,
				rolledBack: false,
			};
		}

		const currentTick = this.engine.currentTick;

		// Set local input
		this.engine.setLocalInput(currentTick, localInput);

		// Broadcast local input to all peers
		this.broadcastInput(currentTick, localInput);

		// Run the engine tick
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
								source: "session",
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
		let message: Message;
		try {
			message = decodeMessage(data);
		} catch (error) {
			this.emitError(
				error instanceof Error ? error : new Error(String(error)),
				{
					source: "protocol",
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
			player.connectionState = "connected";
		}
	}

	/**
	 * Handle peer disconnection.
	 */
	private handlePeerDisconnect(peerId: string): void {
		this.debug.log("Peer disconnected", { peerId });

		const playerId = asPlayerId(peerId);
		const player = this._players.get(playerId);

		if (player) {
			player.connectionState = "disconnected";

			if (this._state === "playing") {
				player.leaveTick = this.engine.currentTick;
				this.engine.removePlayer(playerId, player.leaveTick);
				this.emit("playerLeft", player);
			}
		}
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
					connectionState: "connected",
					joinTick: entry.joinTick,
					leaveTick: entry.leaveTick,
					isHost: false,
				});
			}
		}

		if (this._state === "connecting" || this._state === "lobby") {
			this.setState("playing");
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
	 * Handle join request (host only).
	 */
	private handleJoinRequest(
		peerId: string,
		message: Message & { type: MessageType.JoinRequest },
	): void {
		if (!this._isHost) return;

		const playerId = message.playerId;

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
			roomId: this._roomId!,
			config: {
				tickRate: this.config.tickRate,
				maxPlayers: this.config.maxPlayers,
			},
			players: Array.from(this._players.keys()),
		};
		this.sendToPeer(peerId, acceptMsg, true);

		// Add player
		const playerInfo: PlayerInfo = {
			id: playerId,
			connectionState: "connected",
			joinTick: this._state === "playing" ? this.engine.currentTick : null,
			leaveTick: null,
			isHost: false,
		};
		this._players.set(playerId, playerInfo);

		if (this._state === "playing" && playerInfo.joinTick !== null) {
			this.engine.addPlayer(playerId, playerInfo.joinTick);
		}

		// Notify other players
		if (this._state === "playing" && playerInfo.joinTick !== null) {
			const joinedMsg: Message = {
				type: MessageType.PlayerJoined,
				playerId,
				joinTick: playerInfo.joinTick,
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
		this.setState("lobby");

		// Add existing players
		for (const playerId of message.players) {
			if (!this._players.has(playerId)) {
				this._players.set(playerId, {
					id: playerId,
					connectionState: "connected",
					joinTick: null,
					leaveTick: null,
					isHost: playerId === message.players[0], // First player is host
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
		this.setState("disconnected");
		this.emitError(new Error(`Join rejected: ${message.reason}`), {
			source: "session",
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
			connectionState: "connected",
			joinTick: message.joinTick,
			leaveTick: null,
			isHost: false,
		};
		this._players.set(message.playerId, playerInfo);
		this.engine.addPlayer(message.playerId, message.joinTick);
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
			player.connectionState = "disconnected";
			this.engine.removePlayer(message.playerId, message.leaveTick);
			this.emit("playerLeft", player);
		}
	}

	/**
	 * Handle pause message.
	 */
	private handlePause(_message: Message & { type: MessageType.Pause }): void {
		this.setState("paused");
	}

	/**
	 * Handle resume message.
	 */
	private handleResume(_message: Message & { type: MessageType.Resume }): void {
		this.setState("playing");
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

			const hashMsg: Message = {
				type: MessageType.Hash,
				playerId: this.localPlayerId,
				tick: currentTick,
				hash: this.engine.getCurrentHash(),
			};

			this.broadcast(hashMsg, true);
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
