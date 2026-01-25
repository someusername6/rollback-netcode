/**
 * Binary encoding and decoding utilities for protocol messages.
 *
 * Message format:
 * - Byte 0: Message type
 * - Bytes 1+: Message payload (varies by type)
 */

import {
	PauseReason,
	type PlayerId,
	PlayerRole,
	type Tick,
	asPlayerId,
	asTick,
} from "../types.js";
import {
	type DisconnectReportMessage,
	type DropPlayerMessage,
	type HashMessage,
	type InputAckMessage,
	type InputMessage,
	type JoinAcceptMessage,
	type JoinRejectMessage,
	type JoinRequestMessage,
	type LagReportMessage,
	type Message,
	MessageType,
	type PauseMessage,
	type PingMessage,
	type PlayerJoinedMessage,
	type PlayerLeftMessage,
	type PongMessage,
	type ResumeCountdownMessage,
	type ResumeMessage,
	type StateSyncMessage,
	type SyncMessage,
	type SyncRequestMessage,
} from "./messages.js";

// =============================================================================
// Decode Error
// =============================================================================

/**
 * Error thrown when decoding a message fails.
 */
export class DecodeError extends Error {
	constructor(
		message: string,
		public readonly messageType: number | undefined,
		public readonly offset: number,
		public readonly expected: number,
		public readonly actual: number,
	) {
		super(
			`${message} at offset ${offset}: expected ${expected} bytes, got ${actual}${
				messageType !== undefined ? ` (message type: ${messageType})` : ""
			}`,
		);
		this.name = "DecodeError";
	}
}

/**
 * Error thrown when encoding a message fails due to invalid values.
 */
export class EncodeError extends Error {
	constructor(
		message: string,
		public readonly field: string,
		public readonly maxValue: number,
		public readonly actualValue: number,
	) {
		super(`${message}: ${field} must be <= ${maxValue}, got ${actualValue}`);
		this.name = "EncodeError";
	}
}

/**
 * Ensure the buffer has enough bytes to read.
 * @throws DecodeError if insufficient bytes
 */
function ensureBytes(
	view: DataView,
	offset: number,
	needed: number,
	messageType?: number,
): void {
	const available = view.byteLength - offset;
	if (available < needed) {
		throw new DecodeError(
			"Insufficient bytes in buffer",
			messageType,
			offset,
			needed,
			available,
		);
	}
}

// =============================================================================
// Text Encoder/Decoder (shared instances)
// =============================================================================

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

// =============================================================================
// Protocol Limits
// =============================================================================

/**
 * Maximum size of a single input frame in bytes.
 * This prevents malicious peers from sending excessively large inputs.
 * 1KB is more than sufficient for any reasonable game input.
 */
export const MAX_INPUT_SIZE_PER_FRAME = 1024;

/**
 * Maximum total size of an InputMessage in bytes.
 * This prevents memory exhaustion from malicious messages.
 * 64KB allows for 255 frames × ~250 bytes each with overhead.
 */
export const MAX_INPUT_MESSAGE_SIZE = 65536;

// =============================================================================
// Enum Encoding Helpers
// =============================================================================

/** Encode PlayerRole as a single byte (enum is already numeric) */
function encodePlayerRole(role: PlayerRole): number {
	return role;
}

/** Decode PlayerRole from a single byte */
function decodePlayerRole(value: number): PlayerRole {
	if (value === PlayerRole.Spectator) {
		return PlayerRole.Spectator;
	}
	return PlayerRole.Player;
}

/** Encode PauseReason as a single byte (enum is already numeric) */
function encodePauseReason(reason: PauseReason): number {
	return reason;
}

/** Decode PauseReason from a single byte */
function decodePauseReason(value: number): PauseReason {
	if (value === PauseReason.PlayerDisconnect) {
		return PauseReason.PlayerDisconnect;
	}
	if (value === PauseReason.ExcessiveLag) {
		return PauseReason.ExcessiveLag;
	}
	return PauseReason.PlayerRequest;
}

// =============================================================================
// Encoding Helpers
// =============================================================================

function writeString(view: DataView, offset: number, str: string): number {
	const bytes = textEncoder.encode(str);
	view.setUint16(offset, bytes.length);
	const uint8View = new Uint8Array(view.buffer, view.byteOffset + offset + 2);
	uint8View.set(bytes);
	return 2 + bytes.length;
}

function readString(
	view: DataView,
	offset: number,
	messageType?: number,
): [string, number] {
	ensureBytes(view, offset, 2, messageType);
	const length = view.getUint16(offset);
	ensureBytes(view, offset + 2, length, messageType);
	const bytes = new Uint8Array(
		view.buffer,
		view.byteOffset + offset + 2,
		length,
	);
	return [textDecoder.decode(bytes), 2 + length];
}

function writeBytes(view: DataView, offset: number, data: Uint8Array): number {
	view.setUint32(offset, data.length);
	const uint8View = new Uint8Array(view.buffer, view.byteOffset + offset + 4);
	uint8View.set(data);
	return 4 + data.length;
}

function readBytes(
	view: DataView,
	offset: number,
	messageType?: number,
): [Uint8Array, number] {
	ensureBytes(view, offset, 4, messageType);
	const length = view.getUint32(offset);
	ensureBytes(view, offset + 4, length, messageType);
	const data = new Uint8Array(length);
	data.set(new Uint8Array(view.buffer, view.byteOffset + offset + 4, length));
	return [data, 4 + length];
}

// =============================================================================
// Message Encoding
// =============================================================================

/**
 * Encode a message to a binary format.
 */
export function encodeMessage(message: Message): Uint8Array {
	switch (message.type) {
		case MessageType.Input:
			return encodeInputMessage(message);
		case MessageType.InputAck:
			return encodeInputAckMessage(message);
		case MessageType.Hash:
			return encodeHashMessage(message);
		case MessageType.Sync:
			return encodeSyncMessage(message);
		case MessageType.SyncRequest:
			return encodeSyncRequestMessage(message);
		case MessageType.Pause:
			return encodePauseMessage(message);
		case MessageType.Resume:
			return encodeResumeMessage(message);
		case MessageType.JoinRequest:
			return encodeJoinRequestMessage(message);
		case MessageType.JoinAccept:
			return encodeJoinAcceptMessage(message);
		case MessageType.JoinReject:
			return encodeJoinRejectMessage(message);
		case MessageType.StateSync:
			return encodeStateSyncMessage(message);
		case MessageType.PlayerJoined:
			return encodePlayerJoinedMessage(message);
		case MessageType.PlayerLeft:
			return encodePlayerLeftMessage(message);
		case MessageType.Ping:
			return encodePingMessage(message);
		case MessageType.Pong:
			return encodePongMessage(message);
		case MessageType.LagReport:
			return encodeLagReportMessage(message);
		case MessageType.DisconnectReport:
			return encodeDisconnectReportMessage(message);
		case MessageType.ResumeCountdown:
			return encodeResumeCountdownMessage(message);
		case MessageType.DropPlayer:
			return encodeDropPlayerMessage(message);
	}
}

/**
 * Decode a binary message.
 * @throws DecodeError if the message is malformed or truncated
 */
export function decodeMessage(data: Uint8Array): Message {
	if (data.length === 0) {
		throw new DecodeError("Empty message", undefined, 0, 1, 0);
	}

	const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
	const type = view.getUint8(0) as MessageType;

	switch (type) {
		case MessageType.Input:
			return decodeInputMessage(view);
		case MessageType.InputAck:
			return decodeInputAckMessage(view);
		case MessageType.Hash:
			return decodeHashMessage(view);
		case MessageType.Sync:
			return decodeSyncMessage(view);
		case MessageType.SyncRequest:
			return decodeSyncRequestMessage(view);
		case MessageType.Pause:
			return decodePauseMessage(view);
		case MessageType.Resume:
			return decodeResumeMessage(view);
		case MessageType.JoinRequest:
			return decodeJoinRequestMessage(view);
		case MessageType.JoinAccept:
			return decodeJoinAcceptMessage(view);
		case MessageType.JoinReject:
			return decodeJoinRejectMessage(view);
		case MessageType.StateSync:
			return decodeStateSyncMessage(view);
		case MessageType.PlayerJoined:
			return decodePlayerJoinedMessage(view);
		case MessageType.PlayerLeft:
			return decodePlayerLeftMessage(view);
		case MessageType.Ping:
			return decodePingMessage(view);
		case MessageType.Pong:
			return decodePongMessage(view);
		case MessageType.LagReport:
			return decodeLagReportMessage(view);
		case MessageType.DisconnectReport:
			return decodeDisconnectReportMessage(view);
		case MessageType.ResumeCountdown:
			return decodeResumeCountdownMessage(view);
		case MessageType.DropPlayer:
			return decodeDropPlayerMessage(view);
		default:
			throw new DecodeError(
				`Unknown message type: ${type}`,
				type,
				0,
				0,
				data.length,
			);
	}
}

// =============================================================================
// Input Message
// Format: type(1) + playerId(2+N) + inputCount(1) + [tick(4) + inputLen(2) + input(N)]*
// =============================================================================

function encodeInputMessage(msg: InputMessage): Uint8Array {
	// Validate input count fits in Uint8
	if (msg.inputs.length > 255) {
		throw new EncodeError(
			"Input count exceeds maximum",
			"inputs.length",
			255,
			msg.inputs.length,
		);
	}

	// Validate individual input sizes
	for (let i = 0; i < msg.inputs.length; i++) {
		const entry = msg.inputs[i];
		if (entry && entry.input.length > MAX_INPUT_SIZE_PER_FRAME) {
			throw new EncodeError(
				"Individual input size exceeds maximum",
				`inputs[${i}].input.length`,
				MAX_INPUT_SIZE_PER_FRAME,
				entry.input.length,
			);
		}
	}

	const playerIdBytes = textEncoder.encode(msg.playerId);
	let totalSize =
		1 + // type
		2 +
		playerIdBytes.length + // playerId
		1; // input count

	for (const entry of msg.inputs) {
		totalSize += 4 + 2 + entry.input.length; // tick + inputLen + input
	}

	// Validate total message size
	if (totalSize > MAX_INPUT_MESSAGE_SIZE) {
		throw new EncodeError(
			"Total input message size exceeds maximum",
			"totalSize",
			MAX_INPUT_MESSAGE_SIZE,
			totalSize,
		);
	}

	const buffer = new Uint8Array(totalSize);
	const view = new DataView(buffer.buffer);
	let offset = 0;

	view.setUint8(offset++, MessageType.Input);
	offset += writeString(view, offset, msg.playerId);
	view.setUint8(offset++, msg.inputs.length);

	for (const entry of msg.inputs) {
		view.setInt32(offset, entry.tick);
		offset += 4;
		view.setUint16(offset, entry.input.length);
		offset += 2;
		buffer.set(entry.input, offset);
		offset += entry.input.length;
	}

	return buffer;
}

function decodeInputMessage(view: DataView): InputMessage {
	const msgType = MessageType.Input;

	// Validate total message size first to prevent memory exhaustion
	if (view.byteLength > MAX_INPUT_MESSAGE_SIZE) {
		throw new DecodeError(
			`Input message exceeds maximum size of ${MAX_INPUT_MESSAGE_SIZE} bytes`,
			msgType,
			0,
			MAX_INPUT_MESSAGE_SIZE,
			view.byteLength,
		);
	}

	let offset = 1;
	const [playerId, playerIdLen] = readString(view, offset, msgType);
	offset += playerIdLen;

	ensureBytes(view, offset, 1, msgType);
	const inputCount = view.getUint8(offset++);
	const inputs: Array<{ tick: Tick; input: Uint8Array }> = [];

	for (let i = 0; i < inputCount; i++) {
		ensureBytes(view, offset, 4, msgType);
		const tick = asTick(view.getInt32(offset));
		offset += 4;
		ensureBytes(view, offset, 2, msgType);
		const inputLen = view.getUint16(offset);
		offset += 2;

		// Validate individual input size before allocating
		if (inputLen > MAX_INPUT_SIZE_PER_FRAME) {
			throw new DecodeError(
				`Input frame ${i} exceeds maximum size of ${MAX_INPUT_SIZE_PER_FRAME} bytes`,
				msgType,
				offset - 2,
				MAX_INPUT_SIZE_PER_FRAME,
				inputLen,
			);
		}

		ensureBytes(view, offset, inputLen, msgType);
		const input = new Uint8Array(inputLen);
		input.set(new Uint8Array(view.buffer, view.byteOffset + offset, inputLen));
		offset += inputLen;
		inputs.push({ tick, input });
	}

	return {
		type: MessageType.Input,
		playerId: asPlayerId(playerId),
		inputs,
	};
}

// =============================================================================
// InputAck Message
// Format: type(1) + playerId(2+N) + ackedTick(4)
// =============================================================================

function encodeInputAckMessage(msg: InputAckMessage): Uint8Array {
	const playerIdBytes = textEncoder.encode(msg.playerId);
	const buffer = new Uint8Array(1 + 2 + playerIdBytes.length + 4);
	const view = new DataView(buffer.buffer);

	let offset = 0;
	view.setUint8(offset++, MessageType.InputAck);
	offset += writeString(view, offset, msg.playerId);
	view.setInt32(offset, msg.ackedTick);

	return buffer;
}

function decodeInputAckMessage(view: DataView): InputAckMessage {
	const msgType = MessageType.InputAck;
	let offset = 1;
	const [playerId, playerIdLen] = readString(view, offset, msgType);
	offset += playerIdLen;
	ensureBytes(view, offset, 4, msgType);
	const ackedTick = asTick(view.getInt32(offset));

	return {
		type: MessageType.InputAck,
		playerId: asPlayerId(playerId),
		ackedTick,
	};
}

// =============================================================================
// Hash Message
// Format: type(1) + playerId(2+N) + tick(4) + hash(4)
// =============================================================================

function encodeHashMessage(msg: HashMessage): Uint8Array {
	const playerIdBytes = textEncoder.encode(msg.playerId);
	const buffer = new Uint8Array(1 + 2 + playerIdBytes.length + 4 + 4);
	const view = new DataView(buffer.buffer);

	let offset = 0;
	view.setUint8(offset++, MessageType.Hash);
	offset += writeString(view, offset, msg.playerId);
	view.setInt32(offset, msg.tick);
	offset += 4;
	// Hash is unsigned (game.hash() returns h >>> 0)
	view.setUint32(offset, msg.hash);

	return buffer;
}

function decodeHashMessage(view: DataView): HashMessage {
	const msgType = MessageType.Hash;
	let offset = 1;
	const [playerId, playerIdLen] = readString(view, offset, msgType);
	offset += playerIdLen;
	ensureBytes(view, offset, 4, msgType);
	const tick = asTick(view.getInt32(offset));
	offset += 4;
	ensureBytes(view, offset, 4, msgType);
	// Hash is unsigned (game.hash() returns h >>> 0)
	const hash = view.getUint32(offset);

	return {
		type: MessageType.Hash,
		playerId: asPlayerId(playerId),
		tick,
		hash,
	};
}

// =============================================================================
// Sync Message
// Format: type(1) + tick(4) + hash(4) + state(4+N) + playerTimeline(...)
// =============================================================================

function encodeSyncMessage(msg: SyncMessage): Uint8Array {
	// Calculate size for player timeline
	let timelineSize = 2; // player count
	for (const entry of msg.playerTimeline) {
		const idBytes = textEncoder.encode(entry.playerId);
		timelineSize +=
			2 + idBytes.length + 4 + 1 + (entry.leaveTick !== null ? 4 : 0);
	}

	const buffer = new Uint8Array(
		1 + 4 + 4 + 4 + msg.state.length + timelineSize,
	);
	const view = new DataView(buffer.buffer);

	let offset = 0;
	view.setUint8(offset++, MessageType.Sync);
	view.setInt32(offset, msg.tick);
	offset += 4;
	// Hash is unsigned (game.hash() returns h >>> 0)
	view.setUint32(offset, msg.hash);
	offset += 4;
	offset += writeBytes(view, offset, msg.state);

	// Write player timeline
	view.setUint16(offset, msg.playerTimeline.length);
	offset += 2;
	for (const entry of msg.playerTimeline) {
		offset += writeString(view, offset, entry.playerId);
		view.setInt32(offset, entry.joinTick);
		offset += 4;
		if (entry.leaveTick !== null) {
			view.setUint8(offset++, 1);
			view.setInt32(offset, entry.leaveTick);
			offset += 4;
		} else {
			view.setUint8(offset++, 0);
		}
	}

	return buffer;
}

function decodeSyncMessage(view: DataView): SyncMessage {
	const msgType = MessageType.Sync;
	let offset = 1;
	ensureBytes(view, offset, 4, msgType);
	const tick = asTick(view.getInt32(offset));
	offset += 4;
	ensureBytes(view, offset, 4, msgType);
	// Hash is unsigned (game.hash() returns h >>> 0)
	const hash = view.getUint32(offset);
	offset += 4;
	const [state, stateLen] = readBytes(view, offset, msgType);
	offset += stateLen;

	ensureBytes(view, offset, 2, msgType);
	const playerCount = view.getUint16(offset);
	offset += 2;
	const playerTimeline: SyncMessage["playerTimeline"] = [];

	for (let i = 0; i < playerCount; i++) {
		const [playerId, idLen] = readString(view, offset, msgType);
		offset += idLen;
		ensureBytes(view, offset, 4, msgType);
		const joinTick = asTick(view.getInt32(offset));
		offset += 4;
		ensureBytes(view, offset, 1, msgType);
		const hasLeaveTick = view.getUint8(offset++) === 1;
		if (hasLeaveTick) {
			ensureBytes(view, offset, 4, msgType);
		}
		const leaveTick = hasLeaveTick ? asTick(view.getInt32(offset)) : null;
		if (hasLeaveTick) offset += 4;

		playerTimeline.push({
			playerId: asPlayerId(playerId),
			joinTick,
			leaveTick,
		});
	}

	return {
		type: MessageType.Sync,
		tick,
		state,
		hash,
		playerTimeline,
	};
}

// =============================================================================
// SyncRequest Message
// Format: type(1) + playerId(2+N) + desyncTick(4) + localHash(4)
// =============================================================================

function encodeSyncRequestMessage(msg: SyncRequestMessage): Uint8Array {
	const playerIdBytes = textEncoder.encode(msg.playerId);
	const buffer = new Uint8Array(1 + 2 + playerIdBytes.length + 4 + 4);
	const view = new DataView(buffer.buffer);

	let offset = 0;
	view.setUint8(offset++, MessageType.SyncRequest);
	offset += writeString(view, offset, msg.playerId);
	view.setInt32(offset, msg.desyncTick);
	offset += 4;
	// Hash is unsigned (game.hash() returns h >>> 0)
	view.setUint32(offset, msg.localHash);

	return buffer;
}

function decodeSyncRequestMessage(view: DataView): SyncRequestMessage {
	const msgType = MessageType.SyncRequest;
	let offset = 1;
	const [playerId, playerIdLen] = readString(view, offset, msgType);
	offset += playerIdLen;
	ensureBytes(view, offset, 4, msgType);
	const desyncTick = asTick(view.getInt32(offset));
	offset += 4;
	ensureBytes(view, offset, 4, msgType);
	// Hash is unsigned (game.hash() returns h >>> 0)
	const localHash = view.getUint32(offset);

	return {
		type: MessageType.SyncRequest,
		playerId: asPlayerId(playerId),
		desyncTick,
		localHash,
	};
}

// =============================================================================
// Pause Message
// Format: type(1) + playerId(2+N) + pauseTick(4)
// =============================================================================

function encodePauseMessage(msg: PauseMessage): Uint8Array {
	const playerIdBytes = textEncoder.encode(msg.playerId);
	const buffer = new Uint8Array(1 + 2 + playerIdBytes.length + 4 + 1);
	const view = new DataView(buffer.buffer);

	let offset = 0;
	view.setUint8(offset++, MessageType.Pause);
	offset += writeString(view, offset, msg.playerId);
	view.setInt32(offset, msg.pauseTick);
	offset += 4;
	view.setUint8(offset, encodePauseReason(msg.reason));

	return buffer;
}

function decodePauseMessage(view: DataView): PauseMessage {
	const msgType = MessageType.Pause;
	let offset = 1;
	const [playerId, playerIdLen] = readString(view, offset, msgType);
	offset += playerIdLen;
	ensureBytes(view, offset, 5, msgType); // 4 for tick + 1 for reason
	const pauseTick = asTick(view.getInt32(offset));
	offset += 4;
	const reason = decodePauseReason(view.getUint8(offset));

	return {
		type: MessageType.Pause,
		playerId: asPlayerId(playerId),
		pauseTick,
		reason,
	};
}

// =============================================================================
// Resume Message
// Format: type(1) + playerId(2+N) + resumeTick(4)
// =============================================================================

function encodeResumeMessage(msg: ResumeMessage): Uint8Array {
	const playerIdBytes = textEncoder.encode(msg.playerId);
	const buffer = new Uint8Array(1 + 2 + playerIdBytes.length + 4);
	const view = new DataView(buffer.buffer);

	let offset = 0;
	view.setUint8(offset++, MessageType.Resume);
	offset += writeString(view, offset, msg.playerId);
	view.setInt32(offset, msg.resumeTick);

	return buffer;
}

function decodeResumeMessage(view: DataView): ResumeMessage {
	const msgType = MessageType.Resume;
	let offset = 1;
	const [playerId, playerIdLen] = readString(view, offset, msgType);
	offset += playerIdLen;
	ensureBytes(view, offset, 4, msgType);
	const resumeTick = asTick(view.getInt32(offset));

	return {
		type: MessageType.Resume,
		playerId: asPlayerId(playerId),
		resumeTick,
	};
}

// =============================================================================
// JoinRequest Message
// Format: type(1) + playerId(2+N)
// =============================================================================

function encodeJoinRequestMessage(msg: JoinRequestMessage): Uint8Array {
	const playerIdBytes = textEncoder.encode(msg.playerId);
	// Add 1 byte for role (0xFF means no role specified)
	const buffer = new Uint8Array(1 + 2 + playerIdBytes.length + 1);
	const view = new DataView(buffer.buffer);

	let offset = 0;
	view.setUint8(offset++, MessageType.JoinRequest);
	offset += writeString(view, offset, msg.playerId);
	// Encode role: 0xFF = not specified, otherwise use encodePlayerRole
	view.setUint8(
		offset,
		msg.role !== undefined ? encodePlayerRole(msg.role) : 0xff,
	);

	return buffer;
}

function decodeJoinRequestMessage(view: DataView): JoinRequestMessage {
	const msgType = MessageType.JoinRequest;
	let offset = 1;
	const [playerId, playerIdLen] = readString(view, offset, msgType);
	offset += playerIdLen;

	// Read role if present (backwards compatible: if not enough bytes, default to undefined)
	let role: PlayerRole | undefined;
	if (view.byteLength > offset) {
		const roleValue = view.getUint8(offset);
		if (roleValue !== 0xff) {
			role = decodePlayerRole(roleValue);
		}
	}

	// Build result with optional role only if defined
	const result: JoinRequestMessage = {
		type: MessageType.JoinRequest,
		playerId: asPlayerId(playerId),
	};
	if (role !== undefined) {
		result.role = role;
	}
	return result;
}

// =============================================================================
// JoinAccept Message
// Format: type(1) + playerId(2+N) + roomId(2+N) + tickRate(2) + maxPlayers(1) + playerCount(1) + players(2+N)*
// =============================================================================

function encodeJoinAcceptMessage(msg: JoinAcceptMessage): Uint8Array {
	const playerIdBytes = textEncoder.encode(msg.playerId);
	const roomIdBytes = textEncoder.encode(msg.roomId);

	let playersSize = 1;
	for (const p of msg.players) {
		playersSize += 2 + textEncoder.encode(p).length;
	}

	const buffer = new Uint8Array(
		1 + 2 + playerIdBytes.length + 2 + roomIdBytes.length + 2 + 1 + playersSize,
	);
	const view = new DataView(buffer.buffer);

	let offset = 0;
	view.setUint8(offset++, MessageType.JoinAccept);
	offset += writeString(view, offset, msg.playerId);
	offset += writeString(view, offset, msg.roomId);
	view.setUint16(offset, msg.config.tickRate);
	offset += 2;
	view.setUint8(offset++, msg.config.maxPlayers);
	view.setUint8(offset++, msg.players.length);

	for (const p of msg.players) {
		offset += writeString(view, offset, p);
	}

	return buffer;
}

function decodeJoinAcceptMessage(view: DataView): JoinAcceptMessage {
	const msgType = MessageType.JoinAccept;
	let offset = 1;
	const [playerId, playerIdLen] = readString(view, offset, msgType);
	offset += playerIdLen;
	const [roomId, roomIdLen] = readString(view, offset, msgType);
	offset += roomIdLen;
	ensureBytes(view, offset, 2, msgType);
	const tickRate = view.getUint16(offset);
	offset += 2;
	ensureBytes(view, offset, 2, msgType);
	const maxPlayers = view.getUint8(offset++);
	const playerCount = view.getUint8(offset++);

	const players: PlayerId[] = [];
	for (let i = 0; i < playerCount; i++) {
		const [p, pLen] = readString(view, offset, msgType);
		offset += pLen;
		players.push(asPlayerId(p));
	}

	return {
		type: MessageType.JoinAccept,
		playerId: asPlayerId(playerId),
		roomId,
		config: { tickRate, maxPlayers },
		players,
	};
}

// =============================================================================
// JoinReject Message
// Format: type(1) + playerId(2+N) + reason(2+N)
// =============================================================================

function encodeJoinRejectMessage(msg: JoinRejectMessage): Uint8Array {
	const playerIdBytes = textEncoder.encode(msg.playerId);
	const reasonBytes = textEncoder.encode(msg.reason);
	const buffer = new Uint8Array(
		1 + 2 + playerIdBytes.length + 2 + reasonBytes.length,
	);
	const view = new DataView(buffer.buffer);

	let offset = 0;
	view.setUint8(offset++, MessageType.JoinReject);
	offset += writeString(view, offset, msg.playerId);
	offset += writeString(view, offset, msg.reason);

	return buffer;
}

function decodeJoinRejectMessage(view: DataView): JoinRejectMessage {
	const msgType = MessageType.JoinReject;
	let offset = 1;
	const [playerId, playerIdLen] = readString(view, offset, msgType);
	offset += playerIdLen;
	const [reason] = readString(view, offset, msgType);

	return {
		type: MessageType.JoinReject,
		playerId: asPlayerId(playerId),
		reason,
	};
}

// =============================================================================
// StateSync Message
// Format: type(1) + tick(4) + hash(4) + state(4+N) + playerTimeline(...)
// =============================================================================

function encodeStateSyncMessage(msg: StateSyncMessage): Uint8Array {
	// Calculate size for player timeline
	let timelineSize = 2;
	for (const entry of msg.playerTimeline) {
		const idBytes = textEncoder.encode(entry.playerId);
		timelineSize +=
			2 + idBytes.length + 4 + 1 + (entry.leaveTick !== null ? 4 : 0);
	}

	const buffer = new Uint8Array(
		1 + 4 + 4 + 4 + msg.state.length + timelineSize,
	);
	const view = new DataView(buffer.buffer);

	let offset = 0;
	view.setUint8(offset++, MessageType.StateSync);
	view.setInt32(offset, msg.tick);
	offset += 4;
	// Hash is unsigned (game.hash() returns h >>> 0)
	view.setUint32(offset, msg.hash);
	offset += 4;
	offset += writeBytes(view, offset, msg.state);

	view.setUint16(offset, msg.playerTimeline.length);
	offset += 2;
	for (const entry of msg.playerTimeline) {
		offset += writeString(view, offset, entry.playerId);
		view.setInt32(offset, entry.joinTick);
		offset += 4;
		if (entry.leaveTick !== null) {
			view.setUint8(offset++, 1);
			view.setInt32(offset, entry.leaveTick);
			offset += 4;
		} else {
			view.setUint8(offset++, 0);
		}
	}

	return buffer;
}

function decodeStateSyncMessage(view: DataView): StateSyncMessage {
	const msgType = MessageType.StateSync;
	let offset = 1;
	ensureBytes(view, offset, 4, msgType);
	const tick = asTick(view.getInt32(offset));
	offset += 4;
	ensureBytes(view, offset, 4, msgType);
	// Hash is unsigned (game.hash() returns h >>> 0)
	const hash = view.getUint32(offset);
	offset += 4;
	const [state, stateLen] = readBytes(view, offset, msgType);
	offset += stateLen;

	ensureBytes(view, offset, 2, msgType);
	const playerCount = view.getUint16(offset);
	offset += 2;
	const playerTimeline: StateSyncMessage["playerTimeline"] = [];

	for (let i = 0; i < playerCount; i++) {
		const [playerId, idLen] = readString(view, offset, msgType);
		offset += idLen;
		ensureBytes(view, offset, 4, msgType);
		const joinTick = asTick(view.getInt32(offset));
		offset += 4;
		ensureBytes(view, offset, 1, msgType);
		const hasLeaveTick = view.getUint8(offset++) === 1;
		if (hasLeaveTick) {
			ensureBytes(view, offset, 4, msgType);
		}
		const leaveTick = hasLeaveTick ? asTick(view.getInt32(offset)) : null;
		if (hasLeaveTick) offset += 4;

		playerTimeline.push({
			playerId: asPlayerId(playerId),
			joinTick,
			leaveTick,
		});
	}

	return {
		type: MessageType.StateSync,
		tick,
		state,
		hash,
		playerTimeline,
	};
}

// =============================================================================
// PlayerJoined Message
// Format: type(1) + playerId(2+N) + joinTick(4)
// =============================================================================

function encodePlayerJoinedMessage(msg: PlayerJoinedMessage): Uint8Array {
	const playerIdBytes = textEncoder.encode(msg.playerId);
	const buffer = new Uint8Array(1 + 2 + playerIdBytes.length + 4 + 1);
	const view = new DataView(buffer.buffer);

	let offset = 0;
	view.setUint8(offset++, MessageType.PlayerJoined);
	offset += writeString(view, offset, msg.playerId);
	view.setInt32(offset, msg.joinTick);
	offset += 4;
	view.setUint8(offset, encodePlayerRole(msg.role));

	return buffer;
}

function decodePlayerJoinedMessage(view: DataView): PlayerJoinedMessage {
	const msgType = MessageType.PlayerJoined;
	let offset = 1;
	const [playerId, playerIdLen] = readString(view, offset, msgType);
	offset += playerIdLen;
	ensureBytes(view, offset, 5, msgType); // 4 for tick + 1 for role
	const joinTick = asTick(view.getInt32(offset));
	offset += 4;
	const role = decodePlayerRole(view.getUint8(offset));

	return {
		type: MessageType.PlayerJoined,
		playerId: asPlayerId(playerId),
		joinTick,
		role,
	};
}

// =============================================================================
// PlayerLeft Message
// Format: type(1) + playerId(2+N) + leaveTick(4)
// =============================================================================

function encodePlayerLeftMessage(msg: PlayerLeftMessage): Uint8Array {
	const playerIdBytes = textEncoder.encode(msg.playerId);
	const buffer = new Uint8Array(1 + 2 + playerIdBytes.length + 4);
	const view = new DataView(buffer.buffer);

	let offset = 0;
	view.setUint8(offset++, MessageType.PlayerLeft);
	offset += writeString(view, offset, msg.playerId);
	view.setInt32(offset, msg.leaveTick);

	return buffer;
}

function decodePlayerLeftMessage(view: DataView): PlayerLeftMessage {
	const msgType = MessageType.PlayerLeft;
	let offset = 1;
	const [playerId, playerIdLen] = readString(view, offset, msgType);
	offset += playerIdLen;
	ensureBytes(view, offset, 4, msgType);
	const leaveTick = asTick(view.getInt32(offset));

	return {
		type: MessageType.PlayerLeft,
		playerId: asPlayerId(playerId),
		leaveTick,
	};
}

// =============================================================================
// Ping Message
// Format: type(1) + timestamp(8)
// =============================================================================

function encodePingMessage(msg: PingMessage): Uint8Array {
	const buffer = new Uint8Array(1 + 8);
	const view = new DataView(buffer.buffer);

	view.setUint8(0, MessageType.Ping);
	view.setBigUint64(1, BigInt(msg.timestamp));

	return buffer;
}

function decodePingMessage(view: DataView): PingMessage {
	const msgType = MessageType.Ping;
	ensureBytes(view, 1, 8, msgType);
	const timestamp = Number(view.getBigUint64(1));
	return {
		type: MessageType.Ping,
		timestamp,
	};
}

// =============================================================================
// Pong Message
// Format: type(1) + timestamp(8)
// =============================================================================

function encodePongMessage(msg: PongMessage): Uint8Array {
	const buffer = new Uint8Array(1 + 8);
	const view = new DataView(buffer.buffer);

	view.setUint8(0, MessageType.Pong);
	view.setBigUint64(1, BigInt(msg.timestamp));

	return buffer;
}

function decodePongMessage(view: DataView): PongMessage {
	const msgType = MessageType.Pong;
	ensureBytes(view, 1, 8, msgType);
	const timestamp = Number(view.getBigUint64(1));
	return {
		type: MessageType.Pong,
		timestamp,
	};
}

// =============================================================================
// LagReport Message
// Format: type(1) + laggyPlayerId(2+N) + ticksBehind(4)
// =============================================================================

function encodeLagReportMessage(msg: LagReportMessage): Uint8Array {
	const playerIdBytes = textEncoder.encode(msg.laggyPlayerId);
	const buffer = new Uint8Array(1 + 2 + playerIdBytes.length + 4);
	const view = new DataView(buffer.buffer);

	let offset = 0;
	view.setUint8(offset++, MessageType.LagReport);
	offset += writeString(view, offset, msg.laggyPlayerId);
	view.setInt32(offset, msg.ticksBehind);

	return buffer;
}

function decodeLagReportMessage(view: DataView): LagReportMessage {
	const msgType = MessageType.LagReport;
	let offset = 1;
	const [laggyPlayerId, playerIdLen] = readString(view, offset, msgType);
	offset += playerIdLen;
	ensureBytes(view, offset, 4, msgType);
	const ticksBehind = view.getInt32(offset);

	return {
		type: MessageType.LagReport,
		laggyPlayerId: asPlayerId(laggyPlayerId),
		ticksBehind,
	};
}

// =============================================================================
// DisconnectReport Message
// Format: type(1) + disconnectedPeerId(2+N)
// =============================================================================

function encodeDisconnectReportMessage(
	msg: DisconnectReportMessage,
): Uint8Array {
	const playerIdBytes = textEncoder.encode(msg.disconnectedPeerId);
	const buffer = new Uint8Array(1 + 2 + playerIdBytes.length);
	const view = new DataView(buffer.buffer);

	let offset = 0;
	view.setUint8(offset++, MessageType.DisconnectReport);
	offset += writeString(view, offset, msg.disconnectedPeerId);

	return buffer;
}

function decodeDisconnectReportMessage(
	view: DataView,
): DisconnectReportMessage {
	const msgType = MessageType.DisconnectReport;
	const [disconnectedPeerId] = readString(view, 1, msgType);

	return {
		type: MessageType.DisconnectReport,
		disconnectedPeerId: asPlayerId(disconnectedPeerId),
	};
}

// =============================================================================
// ResumeCountdown Message
// Format: type(1) + secondsRemaining(2)
// =============================================================================

function encodeResumeCountdownMessage(msg: ResumeCountdownMessage): Uint8Array {
	const buffer = new Uint8Array(1 + 2);
	const view = new DataView(buffer.buffer);

	view.setUint8(0, MessageType.ResumeCountdown);
	view.setUint16(1, msg.secondsRemaining);

	return buffer;
}

function decodeResumeCountdownMessage(view: DataView): ResumeCountdownMessage {
	const msgType = MessageType.ResumeCountdown;
	ensureBytes(view, 1, 2, msgType);
	const secondsRemaining = view.getUint16(1);

	return {
		type: MessageType.ResumeCountdown,
		secondsRemaining,
	};
}

// =============================================================================
// DropPlayer Message
// Format: type(1) + playerId(2+N) + hasMetadata(1) + [metadata(4+N)]
// =============================================================================

function encodeDropPlayerMessage(msg: DropPlayerMessage): Uint8Array {
	const playerIdBytes = textEncoder.encode(msg.playerId);
	const hasMetadata = msg.metadata !== undefined;
	const metadataSize =
		hasMetadata && msg.metadata ? 4 + msg.metadata.length : 0;
	const buffer = new Uint8Array(
		1 + 2 + playerIdBytes.length + 1 + metadataSize,
	);
	const view = new DataView(buffer.buffer);

	let offset = 0;
	view.setUint8(offset++, MessageType.DropPlayer);
	offset += writeString(view, offset, msg.playerId);
	view.setUint8(offset++, hasMetadata ? 1 : 0);
	if (hasMetadata && msg.metadata) {
		offset += writeBytes(view, offset, msg.metadata);
	}

	return buffer;
}

function decodeDropPlayerMessage(view: DataView): DropPlayerMessage {
	const msgType = MessageType.DropPlayer;
	let offset = 1;
	const [playerId, playerIdLen] = readString(view, offset, msgType);
	offset += playerIdLen;
	ensureBytes(view, offset, 1, msgType);
	const hasMetadata = view.getUint8(offset++) === 1;

	// Build result with optional metadata only if present
	const result: DropPlayerMessage = {
		type: MessageType.DropPlayer,
		playerId: asPlayerId(playerId),
	};
	if (hasMetadata) {
		const [data] = readBytes(view, offset, msgType);
		result.metadata = data;
	}
	return result;
}
