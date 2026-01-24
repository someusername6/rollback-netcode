/**
 * Message routing for session communication.
 *
 * Decodes incoming messages and routes them to the appropriate handlers.
 */

import { decodeMessage } from "../protocol/encoding.js";
import {
	type DisconnectReportMessage,
	type DropPlayerMessage,
	type HashMessage,
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
} from "../protocol/messages.js";

/**
 * Handler callbacks for each message type.
 *
 * Each handler receives the decoded message and the peer ID of the sender.
 */
export interface MessageHandlers {
	onInput?: (msg: InputMessage, peerId: string) => void;
	onHash?: (msg: HashMessage, peerId: string) => void;
	onSync?: (msg: SyncMessage | StateSyncMessage, peerId: string) => void;
	onSyncRequest?: (msg: SyncRequestMessage, peerId: string) => void;
	onJoinRequest?: (msg: JoinRequestMessage, peerId: string) => void;
	onJoinAccept?: (msg: JoinAcceptMessage, peerId: string) => void;
	onJoinReject?: (msg: JoinRejectMessage, peerId: string) => void;
	onPlayerJoined?: (msg: PlayerJoinedMessage, peerId: string) => void;
	onPlayerLeft?: (msg: PlayerLeftMessage, peerId: string) => void;
	onPause?: (msg: PauseMessage, peerId: string) => void;
	onResume?: (msg: ResumeMessage, peerId: string) => void;
	onPing?: (msg: PingMessage, peerId: string) => void;
	onPong?: (msg: PongMessage, peerId: string) => void;
	onDisconnectReport?: (msg: DisconnectReportMessage, peerId: string) => void;
	onLagReport?: (msg: LagReportMessage, peerId: string) => void;
	onResumeCountdown?: (msg: ResumeCountdownMessage, peerId: string) => void;
	onDropPlayer?: (msg: DropPlayerMessage, peerId: string) => void;
}

/**
 * Error handler callback.
 */
export type DecodeErrorHandler = (
	error: Error,
	peerId: string,
	dataLength: number,
) => void;

/**
 * Routes decoded messages to their appropriate handlers.
 *
 * Centralizes message dispatch logic and error handling for decode failures.
 */
export class MessageRouter {
	private readonly handlers: MessageHandlers;
	private readonly onDecodeError: DecodeErrorHandler;

	constructor(handlers: MessageHandlers, onDecodeError: DecodeErrorHandler) {
		this.handlers = handlers;
		this.onDecodeError = onDecodeError;
	}

	/**
	 * Route a raw message from a peer.
	 *
	 * Decodes the message and dispatches to the appropriate handler.
	 *
	 * @param peerId - The peer ID of the sender
	 * @param data - The raw message bytes
	 */
	route(peerId: string, data: Uint8Array): void {
		let message: Message;
		try {
			message = decodeMessage(data);
		} catch (error) {
			this.onDecodeError(
				error instanceof Error ? error : new Error(String(error)),
				peerId,
				data.length,
			);
			return;
		}

		this.dispatch(message, peerId);
	}

	/**
	 * Dispatch a decoded message to the appropriate handler.
	 *
	 * @param message - The decoded message
	 * @param peerId - The peer ID of the sender
	 */
	dispatch(message: Message, peerId: string): void {
		switch (message.type) {
			case MessageType.Input:
				this.handlers.onInput?.(message, peerId);
				break;

			case MessageType.Hash:
				this.handlers.onHash?.(message, peerId);
				break;

			case MessageType.Sync:
			case MessageType.StateSync:
				this.handlers.onSync?.(message, peerId);
				break;

			case MessageType.SyncRequest:
				this.handlers.onSyncRequest?.(message, peerId);
				break;

			case MessageType.JoinRequest:
				this.handlers.onJoinRequest?.(message, peerId);
				break;

			case MessageType.JoinAccept:
				this.handlers.onJoinAccept?.(message, peerId);
				break;

			case MessageType.JoinReject:
				this.handlers.onJoinReject?.(message, peerId);
				break;

			case MessageType.PlayerJoined:
				this.handlers.onPlayerJoined?.(message, peerId);
				break;

			case MessageType.PlayerLeft:
				this.handlers.onPlayerLeft?.(message, peerId);
				break;

			case MessageType.Pause:
				this.handlers.onPause?.(message, peerId);
				break;

			case MessageType.Resume:
				this.handlers.onResume?.(message, peerId);
				break;

			case MessageType.Ping:
				this.handlers.onPing?.(message, peerId);
				break;

			case MessageType.Pong:
				this.handlers.onPong?.(message, peerId);
				break;

			case MessageType.DisconnectReport:
				this.handlers.onDisconnectReport?.(message, peerId);
				break;

			case MessageType.LagReport:
				this.handlers.onLagReport?.(message, peerId);
				break;

			case MessageType.ResumeCountdown:
				this.handlers.onResumeCountdown?.(message, peerId);
				break;

			case MessageType.DropPlayer:
				this.handlers.onDropPlayer?.(message, peerId);
				break;

			// InputAck is not currently handled by Session
			case MessageType.InputAck:
				break;
		}
	}
}
