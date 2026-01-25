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

// Topology strategies
export {
	StarTopology,
	MeshTopology,
	createTopologyStrategy,
} from "./session/topology.js";
export type { TopologyStrategy } from "./session/topology.js";

// Rollback engine (for advanced use cases)
export { RollbackEngine } from "./rollback/engine.js";
export type { RollbackEngineConfig } from "./rollback/engine.js";

// Transport adapters
export type {
	ConnectionMetrics,
	TransportAdapter,
} from "./transport/adapter.js";
export {
	LocalTransport,
	createLocalTransportGroup,
} from "./transport/local.js";
export type { LocalTransportConfig } from "./transport/local.js";
export { WebRTCTransport } from "./transport/webrtc.js";
export type {
	WebRTCTransportConfig,
	SignalingCallbacks,
	SignalMessage,
} from "./transport/webrtc.js";
export {
	TransformingTransport,
	DEFAULT_TRANSFORMING_TRANSPORT_CONFIG,
} from "./transport/transforming.js";
export type { TransformingTransportConfig } from "./transport/transforming.js";

// Protocol encoding (for custom transport implementations)
export {
	encodeMessage,
	decodeMessage,
	DecodeError,
	DEFAULT_PROTOCOL_LIMITS,
} from "./protocol/encoding.js";
export type { ProtocolLimits } from "./protocol/encoding.js";
export { MessageType } from "./protocol/messages.js";
export type { Message } from "./protocol/messages.js";

// Core types (interfaces and type aliases)
export type {
	Game,
	GameOperation,
	PlayerId,
	Tick,
	TickResult,
	SessionConfig,
	SessionEvents,
	PlayerInfo,
	InputPredictor,
	Snapshot,
	PlayerTimeline,
	ErrorContext,
} from "./types.js";

// Enums and values from types
export {
	Topology,
	DesyncAuthority,
	SessionState,
	PlayerRole,
	ErrorSource,
	PauseReason,
	PlayerConnectionState,
	asPlayerId,
	asTick,
	validatePlayerId,
	validateTick,
	playerIdToPeerId,
	TICK_MIN,
	DEFAULT_SESSION_CONFIG,
	DEFAULT_INPUT_PREDICTOR,
	MAX_PLAYERS_LIMIT,
	RollbackError,
	ValidationError,
	GameError,
	validateSessionConfig,
} from "./types.js";

// Debug utilities
export { createDebugLogger, noopLogger } from "./debug.js";
export type { DebugLogger } from "./debug.js";
