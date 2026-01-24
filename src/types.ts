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
 * A unique player identifier.
 */
export type PlayerId = string & { readonly __brand: "PlayerId" };

/**
 * Helper to create a Tick value.
 */
export function asTick(n: number): Tick {
  return n as Tick;
}

/**
 * Helper to create a PlayerId value.
 */
export function asPlayerId(s: string): PlayerId {
  return s as PlayerId;
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
 * - 'mesh': All players connect to each other directly
 * - 'star': All players connect through a host
 */
export type Topology = "mesh" | "star";

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
}

/**
 * Default session configuration values.
 */
export const DEFAULT_SESSION_CONFIG: SessionConfig = {
  tickRate: 60,
  maxPlayers: 4,
  topology: "star",
  snapshotHistorySize: 120,
  maxSpeculationTicks: 60,
  hashInterval: 60,
  disconnectTimeout: 5000,
};

// =============================================================================
// Session State
// =============================================================================

/**
 * Possible states of a session.
 */
export type SessionState =
  | "disconnected"
  | "connecting"
  | "lobby"
  | "playing"
  | "paused";

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
    lastConfirmed: TInput | undefined
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
    lastConfirmed: Uint8Array | undefined
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
export type PlayerConnectionState =
  | "connecting"
  | "connected"
  | "disconnected";

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

  /** Fired on errors */
  error: (error: Error) => void;
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
