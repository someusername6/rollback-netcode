/**
 * Shared test utilities for rollback-netcode tests.
 */

import type { Game, PlayerId } from "../../src/types.js";

/**
 * Simple test game that tracks x/y position.
 *
 * Input format: 2 bytes [x_delta, y_delta] where 128 is neutral.
 * - Input [138, 128] = move right (+10 x)
 * - Input [118, 128] = move left (-10 x)
 * - Input [128, 138] = move down (+10 y)
 * - Input [128, 118] = move up (-10 y)
 * - Input [128, 128] = no movement (neutral)
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
 * Test game that can be configured to behave non-deterministically.
 * When `nonDeterministic` is true, the step function adds extra value,
 * causing the game to desync from other instances.
 */
export class DesyncableTestGame extends TestGame {
	/** When true, adds extra value to x on each step, causing desync */
	private nonDeterministic = false;

	/** Extra value added when non-deterministic (simulates a bug) */
	private extraValue = 0;

	override step(inputs: Map<PlayerId, Uint8Array>): void {
		super.step(inputs);

		// When non-deterministic, add extra value (simulates a bug)
		if (this.nonDeterministic) {
			this.x += this.extraValue;
		}
	}

	/**
	 * Enable non-deterministic behavior to cause desync.
	 */
	enableDesync(extraValue = 1): void {
		this.nonDeterministic = true;
		this.extraValue = extraValue;
	}

	/**
	 * Disable non-deterministic behavior.
	 */
	disableDesync(): void {
		this.nonDeterministic = false;
		this.extraValue = 0;
	}
}

/**
 * Common input constants for tests.
 */
export const TestInputs = {
	/** Neutral input that causes no movement */
	NEUTRAL: new Uint8Array([128, 128]),
	/** Move right (+10 x) */
	MOVE_RIGHT: new Uint8Array([138, 128]),
	/** Move left (-10 x) */
	MOVE_LEFT: new Uint8Array([118, 128]),
	/** Move up (-10 y) */
	MOVE_UP: new Uint8Array([128, 118]),
	/** Move down (+10 y) */
	MOVE_DOWN: new Uint8Array([128, 138]),
} as const;
