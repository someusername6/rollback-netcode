/**
 * Binary encoding and decoding utilities for protocol messages.
 *
 * Message format:
 * - Byte 0: Message type
 * - Bytes 1+: Message payload (varies by type)
 */

import { type PlayerId, type Tick, asPlayerId, asTick } from "../types.js";
import {
	type HashMessage,
	type InputAckMessage,
	type InputMessage,
	type JoinAcceptMessage,
	type JoinRejectMessage,
	type JoinRequestMessage,
	type Message,
	MessageType,
	type PauseMessage,
	type PingMessage,
	type PlayerJoinedMessage,
	type PlayerLeftMessage,
	type PongMessage,
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
	const playerIdBytes = textEncoder.encode(msg.playerId);
	let totalSize =
		1 + // type
		2 +
		playerIdBytes.length + // playerId
		1; // input count

	for (const entry of msg.inputs) {
		totalSize += 4 + 2 + entry.input.length; // tick + inputLen + input
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
	view.setInt32(offset, msg.hash);

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
	const hash = view.getInt32(offset);

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
	view.setInt32(offset, msg.hash);
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
	const hash = view.getInt32(offset);
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
	view.setInt32(offset, msg.localHash);

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
	const localHash = view.getInt32(offset);

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
	const buffer = new Uint8Array(1 + 2 + playerIdBytes.length + 4);
	const view = new DataView(buffer.buffer);

	let offset = 0;
	view.setUint8(offset++, MessageType.Pause);
	offset += writeString(view, offset, msg.playerId);
	view.setInt32(offset, msg.pauseTick);

	return buffer;
}

function decodePauseMessage(view: DataView): PauseMessage {
	const msgType = MessageType.Pause;
	let offset = 1;
	const [playerId, playerIdLen] = readString(view, offset, msgType);
	offset += playerIdLen;
	ensureBytes(view, offset, 4, msgType);
	const pauseTick = asTick(view.getInt32(offset));

	return {
		type: MessageType.Pause,
		playerId: asPlayerId(playerId),
		pauseTick,
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
	const buffer = new Uint8Array(1 + 2 + playerIdBytes.length);
	const view = new DataView(buffer.buffer);

	let offset = 0;
	view.setUint8(offset++, MessageType.JoinRequest);
	writeString(view, offset, msg.playerId);

	return buffer;
}

function decodeJoinRequestMessage(view: DataView): JoinRequestMessage {
	const msgType = MessageType.JoinRequest;
	const [playerId] = readString(view, 1, msgType);
	return {
		type: MessageType.JoinRequest,
		playerId: asPlayerId(playerId),
	};
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
	writeString(view, offset, msg.reason);

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
	view.setInt32(offset, msg.hash);
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
	const hash = view.getInt32(offset);
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
	const buffer = new Uint8Array(1 + 2 + playerIdBytes.length + 4);
	const view = new DataView(buffer.buffer);

	let offset = 0;
	view.setUint8(offset++, MessageType.PlayerJoined);
	offset += writeString(view, offset, msg.playerId);
	view.setInt32(offset, msg.joinTick);

	return buffer;
}

function decodePlayerJoinedMessage(view: DataView): PlayerJoinedMessage {
	const msgType = MessageType.PlayerJoined;
	let offset = 1;
	const [playerId, playerIdLen] = readString(view, offset, msgType);
	offset += playerIdLen;
	ensureBytes(view, offset, 4, msgType);
	const joinTick = asTick(view.getInt32(offset));

	return {
		type: MessageType.PlayerJoined,
		playerId: asPlayerId(playerId),
		joinTick,
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
