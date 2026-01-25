/**
 * Factory functions for creating protocol messages.
 *
 * Centralizes message construction to reduce duplication in Session.ts.
 */

import type { Message } from "../protocol/messages.js";
import { MessageType } from "../protocol/messages.js";
import type {
	PauseReason,
	PlayerId,
	PlayerRole,
	PlayerTimeline,
	Tick,
} from "../types.js";

/**
 * Create a JoinRequest message.
 */
export function createJoinRequest(
	playerId: PlayerId,
	role: PlayerRole,
): Message {
	return {
		type: MessageType.JoinRequest,
		playerId,
		role,
	};
}

/**
 * Create a PlayerLeft message.
 */
export function createPlayerLeft(playerId: PlayerId, leaveTick: Tick): Message {
	return {
		type: MessageType.PlayerLeft,
		playerId,
		leaveTick,
	};
}

/**
 * Create a Sync message for state synchronization.
 */
export function createSync(
	tick: Tick,
	state: Uint8Array,
	hash: number,
	playerTimeline: PlayerTimeline,
): Message {
	return {
		type: MessageType.Sync,
		tick,
		state,
		hash,
		playerTimeline,
	};
}

/**
 * Create a Pause message.
 */
export function createPause(
	playerId: PlayerId,
	pauseTick: Tick,
	reason: PauseReason,
): Message {
	return {
		type: MessageType.Pause,
		playerId,
		pauseTick,
		reason,
	};
}

/**
 * Create a Resume message.
 */
export function createResume(playerId: PlayerId, resumeTick: Tick): Message {
	return {
		type: MessageType.Resume,
		playerId,
		resumeTick,
	};
}

/**
 * Create a ResumeCountdown message.
 */
export function createResumeCountdown(secondsRemaining: number): Message {
	return {
		type: MessageType.ResumeCountdown,
		secondsRemaining,
	};
}

/**
 * Create a SyncRequest message.
 */
export function createSyncRequest(
	playerId: PlayerId,
	desyncTick: Tick,
	localHash: number,
): Message {
	return {
		type: MessageType.SyncRequest,
		playerId,
		desyncTick,
		localHash,
	};
}

/**
 * Create a DisconnectReport message.
 */
export function createDisconnectReport(disconnectedPeerId: PlayerId): Message {
	return {
		type: MessageType.DisconnectReport,
		disconnectedPeerId,
	};
}

/**
 * Create a LagReport message.
 */
export function createLagReport(
	laggyPlayerId: PlayerId,
	ticksBehind: number,
): Message {
	return {
		type: MessageType.LagReport,
		laggyPlayerId,
		ticksBehind,
	};
}

/**
 * Create a JoinReject message.
 */
export function createJoinReject(playerId: PlayerId, reason: string): Message {
	return {
		type: MessageType.JoinReject,
		playerId,
		reason,
	};
}

/**
 * Create a JoinAccept message.
 */
export function createJoinAccept(
	playerId: PlayerId,
	roomId: string,
	config: { tickRate: number; maxPlayers: number },
	players: PlayerId[],
): Message {
	return {
		type: MessageType.JoinAccept,
		playerId,
		roomId,
		config,
		players,
	};
}

/**
 * Create a PlayerJoined message.
 */
export function createPlayerJoined(
	playerId: PlayerId,
	role: PlayerRole,
	joinTick: Tick,
): Message {
	return {
		type: MessageType.PlayerJoined,
		playerId,
		role,
		joinTick,
	};
}

/**
 * Create a Ping message.
 */
export function createPing(timestamp: number): Message {
	return {
		type: MessageType.Ping,
		timestamp,
	};
}

/**
 * Create a Pong message.
 */
export function createPong(timestamp: number): Message {
	return {
		type: MessageType.Pong,
		timestamp,
	};
}

/**
 * Create an Input message.
 */
export function createInput(
	playerId: PlayerId,
	inputs: Array<{ tick: Tick; input: Uint8Array }>,
): Message {
	return {
		type: MessageType.Input,
		playerId,
		inputs,
	};
}

/**
 * Create a Hash message.
 */
export function createHash(
	playerId: PlayerId,
	tick: Tick,
	hash: number,
): Message {
	return {
		type: MessageType.Hash,
		playerId,
		tick,
		hash,
	};
}

/**
 * Create a StateSync message for late-joining players.
 */
export function createStateSync(
	tick: Tick,
	state: Uint8Array,
	hash: number,
	playerTimeline: PlayerTimeline,
): Message {
	return {
		type: MessageType.StateSync,
		tick,
		state,
		hash,
		playerTimeline,
	};
}

/**
 * Create a DropPlayer message.
 */
export function createDropPlayer(
	playerId: PlayerId,
	metadata?: Uint8Array,
): Message {
	if (metadata !== undefined) {
		return {
			type: MessageType.DropPlayer,
			playerId,
			metadata,
		};
	}
	return {
		type: MessageType.DropPlayer,
		playerId,
	};
}
