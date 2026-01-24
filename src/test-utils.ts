/**
 * Shared test utilities for the rollback netcode library.
 *
 * These utilities are used across multiple test files and provide
 * common testing infrastructure.
 */

import { type Session, createSession } from "./session/session.js";
import { LocalTransport } from "./transport/local.js";
import type { LocalTransportConfig } from "./transport/local.js";
import type { Game, PlayerId } from "./types.js";

/**
 * Simple test game that tracks x/y position.
 *
 * Input format: [x_delta + 128, y_delta + 128]
 * - Value 128 = no movement
 * - Value > 128 = positive movement (e.g., 138 = +10)
 * - Value < 128 = negative movement (e.g., 118 = -10)
 */
export class TestGame implements Game {
	x = 0;
	y = 0;

	serialize(): Uint8Array {
		const buffer = new ArrayBuffer(8);
		const view = new DataView(buffer);
		view.setInt32(0, this.x);
		view.setInt32(4, this.y);
		return new Uint8Array(buffer);
	}

	deserialize(data: Uint8Array): void {
		const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
		this.x = view.getInt32(0);
		this.y = view.getInt32(4);
	}

	step(inputs: Map<PlayerId, Uint8Array>): void {
		for (const [, input] of inputs) {
			if (input.length >= 2) {
				this.x += (input[0] ?? 0) - 128;
				this.y += (input[1] ?? 0) - 128;
			}
		}
	}

	hash(): number {
		return this.x * 10000 + this.y;
	}
}

/**
 * Options for creating a test session.
 */
export interface CreateTestSessionOptions {
	/** Peer ID for this session */
	peerId: string;
	/** Game instance (creates a new TestGame if not provided) */
	game?: TestGame;
	/** Transport configuration */
	transportConfig?: LocalTransportConfig;
}

/**
 * Result of creating a test session.
 */
export interface TestSessionResult {
	/** The created session */
	session: Session;
	/** The transport used by the session */
	transport: LocalTransport;
	/** The game instance */
	game: TestGame;
}

/**
 * Create a test session with a LocalTransport.
 * Useful for unit testing session behavior.
 */
export function createTestSession(
	options: CreateTestSessionOptions,
): TestSessionResult {
	const game = options.game ?? new TestGame();
	const transport = new LocalTransport(options.peerId, options.transportConfig);
	const session = createSession({ game, transport });

	return { session, transport, game };
}

/**
 * Create an input for the test game.
 *
 * @param dx - X delta (default: 0)
 * @param dy - Y delta (default: 0)
 * @returns Input bytes
 */
export function createTestInput(dx = 0, dy = 0): Uint8Array {
	return new Uint8Array([128 + dx, 128 + dy]);
}

/**
 * Number of flush iterations to handle multi-hop message propagation.
 * With star topology, a message may need to go: sender -> host -> recipient,
 * requiring multiple flush cycles to fully propagate.
 */
const FLUSH_ITERATIONS = 3;

/**
 * Flush all transports in a group, delivering all pending messages.
 * Repeats flushing to handle multi-hop message propagation (e.g., star topology).
 *
 * @param transports - Map or array of transports to flush
 */
export function flushAllTransports(
	transports: Map<string, LocalTransport> | LocalTransport[],
): void {
	const transportArray =
		transports instanceof Map ? Array.from(transports.values()) : transports;

	for (let i = 0; i < FLUSH_ITERATIONS; i++) {
		for (const transport of transportArray) {
			transport.flush();
		}
	}
}
