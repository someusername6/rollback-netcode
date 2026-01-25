/**
 * Shared test utilities for the rollback netcode library.
 *
 * These utilities are used across multiple test files and provide
 * common testing infrastructure.
 */

import { type Session, createSession } from "../../src/session/session.js";
import { LocalTransport } from "../../src/transport/local.js";
import type { LocalTransportConfig } from "../../src/transport/local.js";
import type { Game, PlayerId } from "../../src/types.js";

// Re-export test game utilities from test-game.ts
export { TestGame, DesyncableTestGame, TestInputs } from "./test-game.js";

/**
 * Test game with per-player state.
 *
 * Each player has their own position. Useful for testing multi-player
 * scenarios like mid-game join, scaling, and player leave.
 *
 * Input format: [x_delta + 128, y_delta + 128]
 * - Value 128 = no movement
 * - Value > 128 = positive movement
 * - Value < 128 = negative movement
 */
export class MultiPlayerGame implements Game {
	players: Map<string, { x: number; y: number }> = new Map();

	addPlayer(id: string, x = 0, y = 0): void {
		if (!this.players.has(id)) {
			this.players.set(id, { x, y });
		}
	}

	removePlayer(id: string): void {
		this.players.delete(id);
	}

	serialize(): Uint8Array {
		const entries = Array.from(this.players.entries());
		const data: number[] = [entries.length];

		for (const [id, pos] of entries) {
			const idBytes = new TextEncoder().encode(id);
			data.push(idBytes.length);
			data.push(...idBytes);
			// Store x and y as int16
			data.push((pos.x >> 8) & 0xff, pos.x & 0xff);
			data.push((pos.y >> 8) & 0xff, pos.y & 0xff);
		}

		return new Uint8Array(data);
	}

	deserialize(data: Uint8Array): void {
		this.players.clear();
		if (data.length === 0) return;

		let offset = 0;
		const count = data[offset++]!;

		for (let i = 0; i < count; i++) {
			const idLen = data[offset++]!;
			const id = new TextDecoder().decode(data.slice(offset, offset + idLen));
			offset += idLen;
			let x = (data[offset]! << 8) | data[offset + 1]!;
			let y = (data[offset + 2]! << 8) | data[offset + 3]!;
			// Sign extend from 16-bit to handle negative coordinates
			if (x >= 0x8000) x -= 0x10000;
			if (y >= 0x8000) y -= 0x10000;
			offset += 4;
			this.players.set(id, { x, y });
		}
	}

	step(inputs: Map<PlayerId, Uint8Array>): void {
		for (const [playerId, input] of inputs) {
			const player = this.players.get(playerId);
			if (player && input.length >= 2) {
				player.x += input[0]! - 128;
				player.y += input[1]! - 128;
			}
		}
	}

	hash(): number {
		let h = 0;
		for (const [id, pos] of this.players) {
			for (let i = 0; i < id.length; i++) {
				h = ((h << 5) - h) + id.charCodeAt(i);
			}
			h = ((h << 5) - h) + pos.x;
			h = ((h << 5) - h) + pos.y;
		}
		return h >>> 0;
	}
}

// Import TestGame for use in createTestSession
import { TestGame } from "./test-game.js";

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
 * Flush an array of transports multiple times to handle multi-hop message propagation.
 *
 * In star topology, messages may need to traverse: sender -> host -> recipient,
 * requiring multiple flush cycles to fully propagate.
 *
 * @param transports - Array of transports to flush
 * @param iterations - Number of flush iterations (default: 5)
 */
export function flushTransports(
	transports: LocalTransport[],
	iterations = 5,
): void {
	for (let i = 0; i < iterations; i++) {
		for (const t of transports) {
			t.flush();
		}
	}
}

/**
 * Flush all transports in a group, delivering all pending messages.
 * Repeats flushing to handle multi-hop message propagation (e.g., star topology).
 *
 * @param transports - Map or array of transports to flush
 * @param iterations - Number of flush iterations (default: 3)
 */
export function flushAllTransports(
	transports: Map<string, LocalTransport> | LocalTransport[],
	iterations = 3,
): void {
	const transportArray =
		transports instanceof Map ? Array.from(transports.values()) : transports;

	for (let i = 0; i < iterations; i++) {
		for (const transport of transportArray) {
			transport.flush();
		}
	}
}

/**
 * Helper to get a transport from a map with assertion.
 * Useful for integration tests that use createLocalTransportGroup.
 *
 * @param transports - Map of peer ID to transport
 * @param peerId - Peer ID to look up
 * @returns The transport for that peer
 * @throws AssertionError if transport doesn't exist
 */
export function getTransport(
	transports: Map<string, LocalTransport>,
	peerId: string,
): LocalTransport {
	const transport = transports.get(peerId);
	if (!transport) {
		throw new Error(`Transport for ${peerId} should exist`);
	}
	return transport;
}
