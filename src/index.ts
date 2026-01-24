/**
 * Rollback Netcode Library
 *
 * A TypeScript library for P2P rollback netcode in browser-based multiplayer games.
 *
 * @example
 * ```typescript
 * import { createSession, WebRTCTransport } from 'rollback-netcode';
 *
 * // Game implements this interface
 * const game: Game = {
 *   serialize: () => { ... },
 *   deserialize: (data) => { ... },
 *   step: (inputs) => { ... },
 *   hash: () => { ... },
 * };
 *
 * // Create session
 * const session = createSession({
 *   game,
 *   transport: new WebRTCTransport('player-1'),
 * });
 *
 * // Host creates room
 * const roomId = await session.createRoom();
 *
 * // Others join
 * await session.joinRoom(roomId, 'host-peer-id');
 *
 * // Game loop
 * function tick() {
 *   const localInput = captureInput();
 *   session.tick(localInput);
 *   render(game);
 *   requestAnimationFrame(tick);
 * }
 * ```
 *
 * @packageDocumentation
 */

// Core session management
export { createSession, Session } from "./session/session.js";
export type { CreateSessionOptions } from "./session/session.js";

// Rollback engine (for advanced use cases)
export { RollbackEngine } from "./rollback/engine.js";
export type { RollbackEngineConfig } from "./rollback/engine.js";

// Transport adapters
export type { TransportAdapter } from "./transport/adapter.js";
export {
	LocalTransport,
	createLocalTransportGroup,
} from "./transport/local.js";
export type { LocalTransportConfig } from "./transport/local.js";
export { WebRTCTransport } from "./transport/webrtc.js";
export type {
	WebRTCTransportConfig,
	SignalingCallbacks,
} from "./transport/webrtc.js";

// Protocol encoding (for custom transport implementations)
export { encodeMessage, decodeMessage } from "./protocol/encoding.js";
export { MessageType } from "./protocol/messages.js";
export type { Message } from "./protocol/messages.js";

// Core types
export type {
	Game,
	PlayerId,
	Tick,
	TickResult,
	SessionConfig,
	SessionState,
	SessionEvents,
	PlayerInfo,
	InputPredictor,
	Snapshot,
	PlayerTimeline,
} from "./types.js";

export {
	asPlayerId,
	asTick,
	DEFAULT_SESSION_CONFIG,
	DEFAULT_INPUT_PREDICTOR,
} from "./types.js";
