/**
 * Core type definitions for the rollback netcode library.
 */

// =============================================================================
// Branded Types
// =============================================================================

/**
 * A simulation tick number. Used as a logical timestamp for game state.
 */
export type Tick = number & { readonly __brand: "Tick" };

/**
 * Minimum valid tick value (-1 represents initial state before tick 0).
 */
export const TICK_MIN = -1;

/**
 * A unique player identifier.
 *
 * Note: In the current implementation, PlayerId and PeerId (transport layer identifier)
 * are the same string value. The default behavior is to use the transport's localPeerId
 * as the localPlayerId. This means `playerId as string` can be used as a peer ID for
 * transport operations, and vice versa with `asPlayerId(peerId)`.
 */
export type PlayerId = string & { readonly __brand: "PlayerId" };

/**
 * Helper to create a Tick value.
 * This is a simple cast - use validateTick() for validation.
 *
 * @param n - The tick number
 */
export function asTick(n: number): Tick {
	return n as Tick;
}

/**
 * Validate that a number is a valid tick value.
 *
 * @param n - The number to validate
 * @throws Error if the value is not a valid tick (must be integer >= -1)
 */
export function validateTick(n: number): void {
	if (!Number.isInteger(n) || n < TICK_MIN) {
		throw new Error(
			`Invalid tick: ${n}. Tick must be an integer >= ${TICK_MIN}`,
		);
	}
}

/**
 * Helper to create a PlayerId value.
 * This is a simple cast - use validatePlayerId() for validation.
 *
 * @param s - The player ID string
 */
export function asPlayerId(s: string): PlayerId {
	return s as PlayerId;
}

/**
 * Validate that a string is a valid player ID.
 *
 * @param s - The string to validate
 * @throws Error if the value is not a valid player ID (must be non-empty string)
 */
export function validatePlayerId(s: string): void {
	if (typeof s !== "string" || s.length === 0) {
		throw new Error(
			`Invalid player ID: "${s}". Player ID must be a non-empty string`,
		);
	}
}

/**
 * Convert a PlayerId to a transport peer ID string.
 *
 * In the current implementation, these are the same value,
 * but this function makes the intent explicit in code.
 */
export function playerIdToPeerId(playerId: PlayerId): string {
	return playerId;
}

// =============================================================================
// Game Interface
// =============================================================================

/**
 * Interface that games must implement to use the rollback netcode library.
 *
 * @typeParam TInput - The type of input data. Defaults to Uint8Array.
 */
export interface Game<TInput = Uint8Array> {
	/**
	 * Serialize the current game state to a byte array.
	 * This is called to create snapshots for rollback.
	 */
	serialize(): Uint8Array;

	/**
	 * Restore game state from a byte array.
	 * This is called during rollback to restore a previous state.
	 */
	deserialize(data: Uint8Array): void;

	/**
	 * Advance the simulation by one tick with the given inputs.
	 * @param inputs - Map of player ID to their input for this tick
	 */
	step(inputs: Map<PlayerId, TInput>): void;

	/**
	 * Compute a hash of the current game state.
	 * Used for desync detection.
	 */
	hash(): number;
}

// =============================================================================
// Session Configuration
// =============================================================================

/**
 * Network topology for the session.
 */
export enum Topology {
	/** All players connect to each other directly */
	Mesh = 0,
	/** All players connect through a host */
	Star = 1,
}

/**
 * Authority model for desync resolution.
 */
export enum DesyncAuthority {
	/** Host is authoritative; guests send hashes to host only */
	Host = 0,
	/** Each peer compares independently */
	Peer = 1,
}

/**
 * Player role in the session.
 */
export enum PlayerRole {
	/** Active player who sends inputs */
	Player = 0,
	/** Observer who runs simulation but doesn't send inputs */
	Spectator = 1,
}

/**
 * Reason for pausing the game.
 */
export enum PauseReason {
	PlayerRequest = 0,
	PlayerDisconnect = 1,
	ExcessiveLag = 2,
}

/**
 * Configuration options for a session.
 */
export interface SessionConfig {
	/**
	 * Simulation ticks per second.
	 * @default 60
	 */
	tickRate: number;

	/**
	 * Maximum number of players allowed in the session.
	 * @default 4
	 */
	maxPlayers: number;

	/**
	 * Network topology.
	 * @default 'star'
	 */
	topology: Topology;

	/**
	 * Number of snapshots to keep in history for rollback.
	 * @default 120
	 */
	snapshotHistorySize: number;

	/**
	 * Maximum number of ticks to speculate ahead without confirmed inputs.
	 * @default 60
	 */
	maxSpeculationTicks: number;

	/**
	 * How often to broadcast state hashes for desync detection (in ticks).
	 * @default 60
	 */
	hashInterval: number;

	/**
	 * Time in milliseconds before considering a player disconnected.
	 * @default 5000
	 */
	disconnectTimeout: number;

	/**
	 * Enable debug logging for troubleshooting.
	 * @default false
	 */
	debug: boolean;

	/**
	 * Authority model for desync resolution in mesh topology.
	 * - 'host': Host is authoritative; guests send hashes to host only
	 * - 'peer': Each peer compares independently (default behavior)
	 * Only applies when topology is 'mesh'.
	 * @default 'peer'
	 */
	desyncAuthority: DesyncAuthority;

	/**
	 * Threshold (in ticks) before reporting a player as lagging.
	 * When a remote player's confirmed tick falls this far behind,
	 * a LagReport is sent to the host.
	 * Set to 0 to disable lag reporting.
	 * @default 30
	 */
	lagReportThreshold: number;

	/**
	 * Number of ticks of input to include in each message for redundancy.
	 * Higher values improve reliability on lossy connections but increase bandwidth.
	 * @default 3
	 */
	inputRedundancy: number;

	/**
	 * Maximum join requests allowed per peer within the rate limit window.
	 * @default 3
	 */
	joinRateLimitRequests: number;

	/**
	 * Time window in milliseconds for join request rate limiting.
	 * @default 10000
	 */
	joinRateLimitWindowMs: number;
}

/**
 * Default session configuration values.
 */
export const DEFAULT_SESSION_CONFIG: SessionConfig = {
	tickRate: 60,
	maxPlayers: 4,
	topology: Topology.Star,
	snapshotHistorySize: 120,
	maxSpeculationTicks: 60,
	hashInterval: 60,
	disconnectTimeout: 5000,
	debug: false,
	desyncAuthority: DesyncAuthority.Peer,
	lagReportThreshold: 30,
	inputRedundancy: 3,
	joinRateLimitRequests: 3,
	joinRateLimitWindowMs: 10000,
};

/** Maximum allowed players in a session */
export const MAX_PLAYERS_LIMIT = 16;

/**
 * Validate session configuration values.
 * @throws ValidationError if any values are invalid
 */
export function validateSessionConfig(config: SessionConfig): void {
	if (config.tickRate <= 0) {
		throw new ValidationError(
			"tickRate must be greater than 0",
			"tickRate",
			config.tickRate,
		);
	}

	if (config.maxPlayers < 1 || config.maxPlayers > MAX_PLAYERS_LIMIT) {
		throw new ValidationError(
			`maxPlayers must be between 1 and ${MAX_PLAYERS_LIMIT}`,
			"maxPlayers",
			config.maxPlayers,
		);
	}

	if (config.snapshotHistorySize < config.maxSpeculationTicks) {
		throw new ValidationError(
			"snapshotHistorySize must be >= maxSpeculationTicks to support rollback",
			"snapshotHistorySize",
			config.snapshotHistorySize,
		);
	}

	if (config.hashInterval <= 0) {
		throw new ValidationError(
			"hashInterval must be greater than 0",
			"hashInterval",
			config.hashInterval,
		);
	}

	if (config.disconnectTimeout <= 0) {
		throw new ValidationError(
			"disconnectTimeout must be greater than 0",
			"disconnectTimeout",
			config.disconnectTimeout,
		);
	}

	if (config.topology !== Topology.Mesh && config.topology !== Topology.Star) {
		throw new ValidationError(
			"topology must be Topology.Mesh or Topology.Star",
			"topology",
			config.topology,
		);
	}

	if (
		config.desyncAuthority !== DesyncAuthority.Host &&
		config.desyncAuthority !== DesyncAuthority.Peer
	) {
		throw new ValidationError(
			"desyncAuthority must be DesyncAuthority.Host or DesyncAuthority.Peer",
			"desyncAuthority",
			config.desyncAuthority,
		);
	}

	if (config.lagReportThreshold < 0) {
		throw new ValidationError(
			"lagReportThreshold must be >= 0",
			"lagReportThreshold",
			config.lagReportThreshold,
		);
	}

	if (config.inputRedundancy < 1) {
		throw new ValidationError(
			"inputRedundancy must be >= 1",
			"inputRedundancy",
			config.inputRedundancy,
		);
	}

	if (config.joinRateLimitRequests < 1) {
		throw new ValidationError(
			"joinRateLimitRequests must be >= 1",
			"joinRateLimitRequests",
			config.joinRateLimitRequests,
		);
	}

	if (config.joinRateLimitWindowMs <= 0) {
		throw new ValidationError(
			"joinRateLimitWindowMs must be > 0",
			"joinRateLimitWindowMs",
			config.joinRateLimitWindowMs,
		);
	}
}

// =============================================================================
// Session State
// =============================================================================

/**
 * Possible states of a session.
 */
export enum SessionState {
	Disconnected = 0,
	Connecting = 1,
	Lobby = 2,
	Playing = 3,
	Paused = 4,
}

// =============================================================================
// Input Prediction
// =============================================================================

/**
 * Strategy for predicting remote player inputs.
 *
 * @typeParam TInput - The type of input data.
 */
export interface InputPredictor<TInput = Uint8Array> {
	/**
	 * Predict what input a player will use for a given tick.
	 *
	 * @param playerId - The player to predict input for
	 * @param tick - The tick to predict input for
	 * @param lastConfirmed - The last confirmed input from this player, if any
	 * @returns The predicted input
	 */
	predict(
		playerId: PlayerId,
		tick: Tick,
		lastConfirmed: TInput | undefined,
	): TInput;
}

/**
 * Default input predictor that repeats the last confirmed input,
 * or returns an empty Uint8Array if no input is available.
 */
export const DEFAULT_INPUT_PREDICTOR: InputPredictor<Uint8Array> = {
	predict(
		_playerId: PlayerId,
		_tick: Tick,
		lastConfirmed: Uint8Array | undefined,
	): Uint8Array {
		return lastConfirmed ?? new Uint8Array(0);
	},
};

// =============================================================================
// Player Information
// =============================================================================

/**
 * Connection state of a player.
 */
export enum PlayerConnectionState {
	Connecting = 0,
	Connected = 1,
	Disconnected = 2,
}

/**
 * Information about a player in the session.
 */
export interface PlayerInfo {
	/** Unique player identifier */
	id: PlayerId;

	/** Connection state */
	connectionState: PlayerConnectionState;

	/** Tick when the player joined the game */
	joinTick: Tick | null;

	/** Tick when the player left the game (null if still active) */
	leaveTick: Tick | null;

	/** Whether this player is the host */
	isHost: boolean;

	/** Round-trip time in milliseconds (if available) */
	rtt?: number;

	/** Player's role in the session. Defaults to 'pilot'. */
	role: PlayerRole;
}

// =============================================================================
// Player Timeline (for state sync)
// =============================================================================

/**
 * Timeline entry for a player's join/leave events.
 */
export interface PlayerTimelineEntry {
	playerId: PlayerId;
	joinTick: Tick;
	leaveTick: Tick | null;
}

/**
 * Complete timeline of all players for state synchronization.
 */
export type PlayerTimeline = PlayerTimelineEntry[];

// =============================================================================
// Tick Result
// =============================================================================

/**
 * Result of a tick operation.
 */
export interface TickResult {
	/** The tick that was just processed */
	tick: Tick;

	/** Whether a rollback occurred */
	rolledBack: boolean;

	/** Number of ticks that were resimulated (if rollback occurred) */
	rollbackTicks?: number;

	/** Error that occurred during the tick (if any) */
	error?: RollbackError;
}

// =============================================================================
// Errors
// =============================================================================

/**
 * Source of an error in the rollback netcode system.
 */
export enum ErrorSource {
	Engine = 0,
	Transport = 1,
	Protocol = 2,
	Session = 3,
}

/**
 * Context information for an error event.
 */
export interface ErrorContext {
	/** The source component where the error occurred */
	source: ErrorSource;
	/** Whether the error is recoverable (non-fatal) */
	recoverable: boolean;
	/** Additional details about the error */
	details?: Record<string, unknown>;
}

/**
 * Error thrown when a rollback operation fails.
 */
export class RollbackError extends Error {
	constructor(
		message: string,
		public readonly tick: Tick,
		originalError?: Error,
	) {
		super(message, { cause: originalError });
		this.name = "RollbackError";
	}
}

/**
 * Error thrown when session validation fails.
 */
export class ValidationError extends Error {
	constructor(
		message: string,
		public readonly field: string,
		public readonly value: unknown,
	) {
		super(message);
		this.name = "ValidationError";
	}
}

/**
 * Game operations that can fail.
 */
export type GameOperation = "step" | "serialize" | "deserialize" | "hash";

/**
 * Error thrown when a game callback fails.
 * Wraps the original error with context about which operation failed and at which tick.
 */
export class GameError extends Error {
	constructor(
		/** The game operation that failed */
		public readonly operation: GameOperation,
		/** The tick at which the error occurred */
		public readonly tick: Tick,
		/** The original error from the game */
		cause: Error,
	) {
		super(`Game ${operation}() failed at tick ${tick}: ${cause.message}`, {
			cause,
		});
		this.name = "GameError";
	}
}

// =============================================================================
// Events
// =============================================================================

/**
 * Session-level events.
 */
export interface SessionEvents {
	/** Fired when the session state changes */
	stateChange: (newState: SessionState, oldState: SessionState) => void;

	/** Fired when a player joins the session */
	playerJoined: (player: PlayerInfo) => void;

	/** Fired when a player leaves the session */
	playerLeft: (player: PlayerInfo) => void;

	/** Fired when a desync is detected */
	desync: (tick: Tick, localHash: number, remoteHash: number) => void;

	/** Fired when the game starts */
	gameStart: () => void;

	/** Fired on errors with context */
	error: (error: Error, context: ErrorContext) => void;

	/** Fired when a lag report is received (host only) */
	lagReport: (laggyPlayerId: PlayerId, ticksBehind: number) => void;

	/** Fired when a resume countdown is received */
	resumeCountdown: (secondsRemaining: number) => void;

	/** Fired when a player is dropped and replaced */
	playerDropped: (playerId: PlayerId, metadata?: Uint8Array) => void;
}

/**
 * Network-level events.
 */
export interface NetworkEvents {
	/** Fired when connected to a peer */
	peerConnected: (peerId: string) => void;

	/** Fired when disconnected from a peer */
	peerDisconnected: (peerId: string) => void;

	/** Fired when a message is received */
	messageReceived: (peerId: string, data: Uint8Array) => void;
}

/**
 * Sync-related events.
 */
export interface SyncEvents {
	/** Fired when a rollback occurs */
	rollback: (fromTick: Tick, toTick: Tick) => void;

	/** Fired when inputs are confirmed for a tick */
	inputConfirmed: (tick: Tick) => void;

	/** Fired when state is synchronized */
	stateSync: (tick: Tick) => void;
}

// =============================================================================
// Snapshot
// =============================================================================

/**
 * A snapshot of game state at a specific tick.
 */
export interface Snapshot {
	/** The tick this snapshot was taken at */
	tick: Tick;

	/** Serialized game state */
	state: Uint8Array;

	/** Hash of the game state for desync detection */
	hash: number;
}
