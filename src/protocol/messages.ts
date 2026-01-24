/**
 * Message type definitions for the rollback netcode protocol.
 */

import type {
	PauseReason,
	PlayerId,
	PlayerRole,
	PlayerTimeline,
	Tick,
} from "../types.js";

// =============================================================================
// Message Type Enum
// =============================================================================

/**
 * All possible message types in the protocol.
 */
export enum MessageType {
	// Input messages (unreliable)
	Input = 0x01,
	InputAck = 0x02,

	// Sync messages (reliable)
	Hash = 0x10,
	Sync = 0x11,
	SyncRequest = 0x12,

	// Session control (reliable)
	Pause = 0x20,
	Resume = 0x21,
	LagReport = 0x22,
	DisconnectReport = 0x23,
	ResumeCountdown = 0x24,
	DropPlayer = 0x25,

	// Room management (reliable)
	JoinRequest = 0x30,
	JoinAccept = 0x31,
	JoinReject = 0x32,
	StateSync = 0x33,
	PlayerJoined = 0x34,
	PlayerLeft = 0x35,

	// Ping/Pong for RTT measurement (unreliable)
	Ping = 0x40,
	Pong = 0x41,
}

// =============================================================================
// Input Messages
// =============================================================================

/**
 * Per-tick input broadcast. Sent unreliably every tick.
 * May include multiple ticks of input for redundancy.
 */
export interface InputMessage {
	type: MessageType.Input;
	/** Sender's player ID */
	playerId: PlayerId;
	/** Array of (tick, input) pairs, newest first */
	inputs: Array<{ tick: Tick; input: Uint8Array }>;
}

/**
 * Acknowledgment of received inputs.
 * Allows sender to know which inputs have been received.
 */
export interface InputAckMessage {
	type: MessageType.InputAck;
	/** Player ID whose inputs are being acknowledged */
	playerId: PlayerId;
	/** Highest consecutive tick that has been received */
	ackedTick: Tick;
}

// =============================================================================
// Sync Messages
// =============================================================================

/**
 * Periodic hash broadcast for desync detection.
 */
export interface HashMessage {
	type: MessageType.Hash;
	/** Player ID of the sender */
	playerId: PlayerId;
	/** Tick the hash was computed at */
	tick: Tick;
	/** State hash at that tick */
	hash: number;
}

/**
 * Full state synchronization (for desync recovery or late join).
 */
export interface SyncMessage {
	type: MessageType.Sync;
	/** Tick the state was captured at */
	tick: Tick;
	/** Serialized game state */
	state: Uint8Array;
	/** State hash for verification */
	hash: number;
	/** Timeline of all players */
	playerTimeline: PlayerTimeline;
}

/**
 * Request for state sync (sent by client that detected desync).
 */
export interface SyncRequestMessage {
	type: MessageType.SyncRequest;
	/** Player ID requesting sync */
	playerId: PlayerId;
	/** Tick where desync was detected */
	desyncTick: Tick;
	/** Local hash at desync tick */
	localHash: number;
}

// =============================================================================
// Session Control Messages
// =============================================================================

/**
 * Pause the game.
 */
export interface PauseMessage {
	type: MessageType.Pause;
	/** Player ID who initiated the pause */
	playerId: PlayerId;
	/** Tick at which to pause */
	pauseTick: Tick;
	/** Reason for the pause */
	reason: PauseReason;
}

/**
 * Resume the game.
 */
export interface ResumeMessage {
	type: MessageType.Resume;
	/** Player ID who initiated the resume */
	playerId: PlayerId;
	/** Tick at which to resume */
	resumeTick: Tick;
}

// =============================================================================
// Room Management Messages
// =============================================================================

/**
 * Request to join a room.
 */
export interface JoinRequestMessage {
	type: MessageType.JoinRequest;
	/** Player ID requesting to join */
	playerId: PlayerId;
	/** Requested role (defaults to 'pilot' if not specified) */
	role?: PlayerRole;
}

/**
 * Accept a join request.
 */
export interface JoinAcceptMessage {
	type: MessageType.JoinAccept;
	/** The player being accepted */
	playerId: PlayerId;
	/** Room ID */
	roomId: string;
	/** Current session configuration */
	config: {
		tickRate: number;
		maxPlayers: number;
	};
	/** List of currently connected player IDs */
	players: PlayerId[];
}

/**
 * Reject a join request.
 */
export interface JoinRejectMessage {
	type: MessageType.JoinReject;
	/** The player being rejected */
	playerId: PlayerId;
	/** Reason for rejection */
	reason: string;
}

/**
 * State sync message sent to newly joined players.
 */
export interface StateSyncMessage {
	type: MessageType.StateSync;
	/** Current tick */
	tick: Tick;
	/** Serialized game state */
	state: Uint8Array;
	/** State hash */
	hash: number;
	/** Timeline of all players */
	playerTimeline: PlayerTimeline;
}

/**
 * Broadcast when a player joins.
 */
export interface PlayerJoinedMessage {
	type: MessageType.PlayerJoined;
	/** The player who joined */
	playerId: PlayerId;
	/** Tick at which they joined */
	joinTick: Tick;
	/** Player's role */
	role: PlayerRole;
}

/**
 * Broadcast when a player leaves.
 */
export interface PlayerLeftMessage {
	type: MessageType.PlayerLeft;
	/** The player who left */
	playerId: PlayerId;
	/** Tick at which they left */
	leaveTick: Tick;
}

// =============================================================================
// Ping/Pong Messages
// =============================================================================

/**
 * Ping message for RTT measurement.
 */
export interface PingMessage {
	type: MessageType.Ping;
	/** Timestamp when ping was sent */
	timestamp: number;
}

/**
 * Pong response.
 */
export interface PongMessage {
	type: MessageType.Pong;
	/** Original timestamp from ping */
	timestamp: number;
}

// =============================================================================
// Lag and Disconnect Reports
// =============================================================================

/**
 * Report that a player is lagging.
 * Sent by peers to the host when they detect a player falling behind.
 */
export interface LagReportMessage {
	type: MessageType.LagReport;
	/** The player who is lagging */
	laggyPlayerId: PlayerId;
	/** How many ticks behind they are */
	ticksBehind: number;
}

/**
 * Report that a peer has disconnected.
 * In mesh topology with host authority, guests send this to host
 * instead of handling disconnects locally.
 */
export interface DisconnectReportMessage {
	type: MessageType.DisconnectReport;
	/** The peer that disconnected */
	disconnectedPeerId: PlayerId;
}

/**
 * Countdown before resuming the game.
 * Sent by host to give players time to prepare.
 */
export interface ResumeCountdownMessage {
	type: MessageType.ResumeCountdown;
	/** Seconds remaining before resume */
	secondsRemaining: number;
}

/**
 * Drop a player and optionally replace with AI or transfer control.
 * Sent by host to all players.
 */
export interface DropPlayerMessage {
	type: MessageType.DropPlayer;
	/** The player being dropped */
	playerId: PlayerId;
	/** Game-defined metadata (e.g., AI config, replacement info) */
	metadata?: Uint8Array;
}

// =============================================================================
// Union Type
// =============================================================================

/**
 * Union of all message types.
 */
export type Message =
	| InputMessage
	| InputAckMessage
	| HashMessage
	| SyncMessage
	| SyncRequestMessage
	| PauseMessage
	| ResumeMessage
	| JoinRequestMessage
	| JoinAcceptMessage
	| JoinRejectMessage
	| StateSyncMessage
	| PlayerJoinedMessage
	| PlayerLeftMessage
	| PingMessage
	| PongMessage
	| LagReportMessage
	| DisconnectReportMessage
	| ResumeCountdownMessage
	| DropPlayerMessage;

// =============================================================================
// Type Guards
// =============================================================================

export function isInputMessage(msg: Message): msg is InputMessage {
	return msg.type === MessageType.Input;
}

export function isInputAckMessage(msg: Message): msg is InputAckMessage {
	return msg.type === MessageType.InputAck;
}

export function isHashMessage(msg: Message): msg is HashMessage {
	return msg.type === MessageType.Hash;
}

export function isSyncMessage(msg: Message): msg is SyncMessage {
	return msg.type === MessageType.Sync;
}

export function isSyncRequestMessage(msg: Message): msg is SyncRequestMessage {
	return msg.type === MessageType.SyncRequest;
}

export function isPauseMessage(msg: Message): msg is PauseMessage {
	return msg.type === MessageType.Pause;
}

export function isResumeMessage(msg: Message): msg is ResumeMessage {
	return msg.type === MessageType.Resume;
}

export function isJoinRequestMessage(msg: Message): msg is JoinRequestMessage {
	return msg.type === MessageType.JoinRequest;
}

export function isJoinAcceptMessage(msg: Message): msg is JoinAcceptMessage {
	return msg.type === MessageType.JoinAccept;
}

export function isJoinRejectMessage(msg: Message): msg is JoinRejectMessage {
	return msg.type === MessageType.JoinReject;
}

export function isStateSyncMessage(msg: Message): msg is StateSyncMessage {
	return msg.type === MessageType.StateSync;
}

export function isPlayerJoinedMessage(
	msg: Message,
): msg is PlayerJoinedMessage {
	return msg.type === MessageType.PlayerJoined;
}

export function isPlayerLeftMessage(msg: Message): msg is PlayerLeftMessage {
	return msg.type === MessageType.PlayerLeft;
}

export function isPingMessage(msg: Message): msg is PingMessage {
	return msg.type === MessageType.Ping;
}

export function isPongMessage(msg: Message): msg is PongMessage {
	return msg.type === MessageType.Pong;
}

export function isLagReportMessage(msg: Message): msg is LagReportMessage {
	return msg.type === MessageType.LagReport;
}

export function isDisconnectReportMessage(
	msg: Message,
): msg is DisconnectReportMessage {
	return msg.type === MessageType.DisconnectReport;
}

export function isResumeCountdownMessage(
	msg: Message,
): msg is ResumeCountdownMessage {
	return msg.type === MessageType.ResumeCountdown;
}

export function isDropPlayerMessage(msg: Message): msg is DropPlayerMessage {
	return msg.type === MessageType.DropPlayer;
}

// =============================================================================
// Reliability
// =============================================================================

/**
 * Returns whether a message type should be sent reliably.
 */
export function isReliableMessage(msg: Message): boolean {
	switch (msg.type) {
		case MessageType.Input:
		case MessageType.InputAck:
		case MessageType.Ping:
		case MessageType.Pong:
			return false;
		default:
			return true;
	}
}
