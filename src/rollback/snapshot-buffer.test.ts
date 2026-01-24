import { describe, it } from "node:test";
import assert from "node:assert";
import { SnapshotBuffer } from "./snapshot-buffer.js";
import { asTick } from "../types.js";

describe("SnapshotBuffer", () => {
	describe("constructor", () => {
		it("should create buffer with specified capacity", () => {
			const buffer = new SnapshotBuffer(10);
			assert.strictEqual(buffer.capacity, 10);
			assert.strictEqual(buffer.size, 0);
		});

		it("should throw on zero capacity", () => {
			assert.throws(() => new SnapshotBuffer(0), /Capacity must be positive/);
		});

		it("should throw on negative capacity", () => {
			assert.throws(() => new SnapshotBuffer(-1), /Capacity must be positive/);
		});
	});

	describe("save and get", () => {
		it("should save and retrieve a single snapshot", () => {
			const buffer = new SnapshotBuffer(5);
			const state = new Uint8Array([1, 2, 3]);
			const tick = asTick(10);

			buffer.save(tick, state, 123);

			const snapshot = buffer.get(tick);
			assert.ok(snapshot);
			assert.strictEqual(snapshot.tick, 10);
			assert.deepStrictEqual(snapshot.state, new Uint8Array([1, 2, 3]));
			assert.strictEqual(snapshot.hash, 123);
		});

		it("should copy state to prevent external mutation", () => {
			const buffer = new SnapshotBuffer(5);
			const state = new Uint8Array([1, 2, 3]);
			buffer.save(asTick(0), state, 0);

			// Mutate original state
			state[0] = 99;

			// Buffer should have original value
			const snapshot = buffer.get(asTick(0));
			assert.ok(snapshot);
			assert.strictEqual(snapshot.state[0], 1);
		});

		it("should save and retrieve multiple snapshots", () => {
			const buffer = new SnapshotBuffer(5);

			buffer.save(asTick(0), new Uint8Array([0]), 0);
			buffer.save(asTick(1), new Uint8Array([1]), 1);
			buffer.save(asTick(2), new Uint8Array([2]), 2);

			assert.strictEqual(buffer.size, 3);

			const s0 = buffer.get(asTick(0));
			const s1 = buffer.get(asTick(1));
			const s2 = buffer.get(asTick(2));

			assert.ok(s0);
			assert.ok(s1);
			assert.ok(s2);
			assert.deepStrictEqual(s0.state, new Uint8Array([0]));
			assert.deepStrictEqual(s1.state, new Uint8Array([1]));
			assert.deepStrictEqual(s2.state, new Uint8Array([2]));
		});

		it("should return undefined for non-existent tick", () => {
			const buffer = new SnapshotBuffer(5);
			buffer.save(asTick(5), new Uint8Array([1]), 1);

			assert.strictEqual(buffer.get(asTick(0)), undefined);
			assert.strictEqual(buffer.get(asTick(10)), undefined);
		});

		it("should return undefined from empty buffer", () => {
			const buffer = new SnapshotBuffer(5);
			assert.strictEqual(buffer.get(asTick(0)), undefined);
		});
	});

	describe("ring buffer wrap-around", () => {
		it("should evict oldest when full", () => {
			const buffer = new SnapshotBuffer(3);

			buffer.save(asTick(0), new Uint8Array([0]), 0);
			buffer.save(asTick(1), new Uint8Array([1]), 1);
			buffer.save(asTick(2), new Uint8Array([2]), 2);
			assert.strictEqual(buffer.size, 3);

			// This should evict tick 0
			buffer.save(asTick(3), new Uint8Array([3]), 3);
			assert.strictEqual(buffer.size, 3);

			assert.strictEqual(buffer.get(asTick(0)), undefined);
			assert.ok(buffer.get(asTick(1)));
			assert.ok(buffer.get(asTick(2)));
			assert.ok(buffer.get(asTick(3)));
		});

		it("should correctly wrap multiple times", () => {
			const buffer = new SnapshotBuffer(3);

			// Fill buffer twice
			for (let i = 0; i < 6; i++) {
				buffer.save(asTick(i), new Uint8Array([i]), i);
			}

			assert.strictEqual(buffer.size, 3);
			assert.strictEqual(buffer.get(asTick(0)), undefined);
			assert.strictEqual(buffer.get(asTick(1)), undefined);
			assert.strictEqual(buffer.get(asTick(2)), undefined);

			const s3 = buffer.get(asTick(3));
			const s4 = buffer.get(asTick(4));
			const s5 = buffer.get(asTick(5));

			assert.ok(s3);
			assert.ok(s4);
			assert.ok(s5);
			assert.deepStrictEqual(s3.state, new Uint8Array([3]));
			assert.deepStrictEqual(s4.state, new Uint8Array([4]));
			assert.deepStrictEqual(s5.state, new Uint8Array([5]));
		});
	});

	describe("getOldest and getNewest", () => {
		it("should return undefined on empty buffer", () => {
			const buffer = new SnapshotBuffer(5);
			assert.strictEqual(buffer.getOldest(), undefined);
			assert.strictEqual(buffer.getNewest(), undefined);
		});

		it("should return same snapshot for single element", () => {
			const buffer = new SnapshotBuffer(5);
			buffer.save(asTick(10), new Uint8Array([10]), 10);

			const oldest = buffer.getOldest();
			const newest = buffer.getNewest();

			assert.ok(oldest);
			assert.ok(newest);
			assert.strictEqual(oldest.tick, 10);
			assert.strictEqual(newest.tick, 10);
		});

		it("should return correct oldest and newest", () => {
			const buffer = new SnapshotBuffer(5);
			buffer.save(asTick(5), new Uint8Array([5]), 5);
			buffer.save(asTick(10), new Uint8Array([10]), 10);
			buffer.save(asTick(15), new Uint8Array([15]), 15);

			assert.strictEqual(buffer.getOldest()?.tick, 5);
			assert.strictEqual(buffer.getNewest()?.tick, 15);
		});

		it("should update after wrap-around", () => {
			const buffer = new SnapshotBuffer(2);
			buffer.save(asTick(0), new Uint8Array([0]), 0);
			buffer.save(asTick(1), new Uint8Array([1]), 1);
			buffer.save(asTick(2), new Uint8Array([2]), 2);

			assert.strictEqual(buffer.getOldest()?.tick, 1);
			assert.strictEqual(buffer.getNewest()?.tick, 2);
		});
	});

	describe("oldestTick and newestTick", () => {
		it("should be undefined on empty buffer", () => {
			const buffer = new SnapshotBuffer(5);
			assert.strictEqual(buffer.oldestTick, undefined);
			assert.strictEqual(buffer.newestTick, undefined);
		});

		it("should track oldest and newest ticks", () => {
			const buffer = new SnapshotBuffer(5);
			buffer.save(asTick(10), new Uint8Array([1]), 1);
			assert.strictEqual(buffer.oldestTick, 10);
			assert.strictEqual(buffer.newestTick, 10);

			buffer.save(asTick(20), new Uint8Array([2]), 2);
			assert.strictEqual(buffer.oldestTick, 10);
			assert.strictEqual(buffer.newestTick, 20);
		});

		it("should update on wrap-around", () => {
			const buffer = new SnapshotBuffer(2);
			buffer.save(asTick(0), new Uint8Array([0]), 0);
			buffer.save(asTick(1), new Uint8Array([1]), 1);

			assert.strictEqual(buffer.oldestTick, 0);
			assert.strictEqual(buffer.newestTick, 1);

			buffer.save(asTick(2), new Uint8Array([2]), 2);

			assert.strictEqual(buffer.oldestTick, 1);
			assert.strictEqual(buffer.newestTick, 2);
		});
	});

	describe("clear", () => {
		it("should remove all snapshots", () => {
			const buffer = new SnapshotBuffer(5);
			buffer.save(asTick(0), new Uint8Array([0]), 0);
			buffer.save(asTick(1), new Uint8Array([1]), 1);
			buffer.save(asTick(2), new Uint8Array([2]), 2);

			buffer.clear();

			assert.strictEqual(buffer.size, 0);
			assert.strictEqual(buffer.oldestTick, undefined);
			assert.strictEqual(buffer.newestTick, undefined);
			assert.strictEqual(buffer.get(asTick(0)), undefined);
			assert.strictEqual(buffer.get(asTick(1)), undefined);
			assert.strictEqual(buffer.get(asTick(2)), undefined);
		});

		it("should allow reuse after clear", () => {
			const buffer = new SnapshotBuffer(3);
			buffer.save(asTick(0), new Uint8Array([0]), 0);
			buffer.save(asTick(1), new Uint8Array([1]), 1);
			buffer.clear();

			buffer.save(asTick(100), new Uint8Array([100]), 100);

			assert.strictEqual(buffer.size, 1);
			assert.strictEqual(buffer.oldestTick, 100);
			assert.ok(buffer.get(asTick(100)));
		});
	});

	describe("getAtOrBefore", () => {
		it("should return undefined for empty buffer", () => {
			const buffer = new SnapshotBuffer(5);
			assert.strictEqual(buffer.getAtOrBefore(asTick(10)), undefined);
		});

		it("should return exact match", () => {
			const buffer = new SnapshotBuffer(5);
			buffer.save(asTick(10), new Uint8Array([10]), 10);
			buffer.save(asTick(20), new Uint8Array([20]), 20);

			const result = buffer.getAtOrBefore(asTick(20));
			assert.ok(result);
			assert.strictEqual(result.tick, 20);
		});

		it("should return closest snapshot before target", () => {
			const buffer = new SnapshotBuffer(5);
			buffer.save(asTick(10), new Uint8Array([10]), 10);
			buffer.save(asTick(20), new Uint8Array([20]), 20);
			buffer.save(asTick(30), new Uint8Array([30]), 30);

			const result = buffer.getAtOrBefore(asTick(25));
			assert.ok(result);
			assert.strictEqual(result.tick, 20);
		});

		it("should return undefined if all snapshots are after target", () => {
			const buffer = new SnapshotBuffer(5);
			buffer.save(asTick(20), new Uint8Array([20]), 20);
			buffer.save(asTick(30), new Uint8Array([30]), 30);

			assert.strictEqual(buffer.getAtOrBefore(asTick(10)), undefined);
		});
	});

	describe("pruneBeforeTick", () => {
		it("should do nothing on empty buffer", () => {
			const buffer = new SnapshotBuffer(5);
			buffer.pruneBeforeTick(asTick(10));
			assert.strictEqual(buffer.size, 0);
		});

		it("should remove snapshots before given tick", () => {
			const buffer = new SnapshotBuffer(5);
			buffer.save(asTick(0), new Uint8Array([0]), 0);
			buffer.save(asTick(1), new Uint8Array([1]), 1);
			buffer.save(asTick(2), new Uint8Array([2]), 2);
			buffer.save(asTick(3), new Uint8Array([3]), 3);

			buffer.pruneBeforeTick(asTick(2));

			assert.strictEqual(buffer.size, 2);
			assert.strictEqual(buffer.get(asTick(0)), undefined);
			assert.strictEqual(buffer.get(asTick(1)), undefined);
			assert.ok(buffer.get(asTick(2)));
			assert.ok(buffer.get(asTick(3)));
			assert.strictEqual(buffer.oldestTick, 2);
		});

		it("should remove all snapshots if all are before tick", () => {
			const buffer = new SnapshotBuffer(5);
			buffer.save(asTick(0), new Uint8Array([0]), 0);
			buffer.save(asTick(1), new Uint8Array([1]), 1);

			buffer.pruneBeforeTick(asTick(10));

			assert.strictEqual(buffer.size, 0);
			assert.strictEqual(buffer.oldestTick, undefined);
			assert.strictEqual(buffer.newestTick, undefined);
		});
	});

	describe("has", () => {
		it("should return false for empty buffer", () => {
			const buffer = new SnapshotBuffer(5);
			assert.strictEqual(buffer.has(asTick(0)), false);
		});

		it("should return true for existing tick", () => {
			const buffer = new SnapshotBuffer(5);
			buffer.save(asTick(10), new Uint8Array([10]), 10);
			assert.strictEqual(buffer.has(asTick(10)), true);
		});

		it("should return false for non-existing tick", () => {
			const buffer = new SnapshotBuffer(5);
			buffer.save(asTick(10), new Uint8Array([10]), 10);
			assert.strictEqual(buffer.has(asTick(5)), false);
		});
	});

	describe("getTicks", () => {
		it("should return empty array for empty buffer", () => {
			const buffer = new SnapshotBuffer(5);
			assert.deepStrictEqual(buffer.getTicks(), []);
		});

		it("should return ticks in order", () => {
			const buffer = new SnapshotBuffer(5);
			buffer.save(asTick(5), new Uint8Array([5]), 5);
			buffer.save(asTick(10), new Uint8Array([10]), 10);
			buffer.save(asTick(15), new Uint8Array([15]), 15);

			assert.deepStrictEqual(buffer.getTicks(), [5, 10, 15]);
		});

		it("should maintain order after wrap-around", () => {
			const buffer = new SnapshotBuffer(3);
			buffer.save(asTick(0), new Uint8Array([0]), 0);
			buffer.save(asTick(1), new Uint8Array([1]), 1);
			buffer.save(asTick(2), new Uint8Array([2]), 2);
			buffer.save(asTick(3), new Uint8Array([3]), 3);
			buffer.save(asTick(4), new Uint8Array([4]), 4);

			assert.deepStrictEqual(buffer.getTicks(), [2, 3, 4]);
		});
	});

	describe("edge cases", () => {
		it("should handle capacity of 1", () => {
			const buffer = new SnapshotBuffer(1);

			buffer.save(asTick(0), new Uint8Array([0]), 0);
			assert.strictEqual(buffer.size, 1);
			assert.ok(buffer.get(asTick(0)));

			buffer.save(asTick(1), new Uint8Array([1]), 1);
			assert.strictEqual(buffer.size, 1);
			assert.strictEqual(buffer.get(asTick(0)), undefined);
			assert.ok(buffer.get(asTick(1)));
		});

		it("should handle large tick values", () => {
			const buffer = new SnapshotBuffer(5);
			const largeTick = asTick(Number.MAX_SAFE_INTEGER);

			buffer.save(largeTick, new Uint8Array([255]), 999);

			const snapshot = buffer.get(largeTick);
			assert.ok(snapshot);
			assert.strictEqual(snapshot.tick, Number.MAX_SAFE_INTEGER);
		});

		it("should handle empty state", () => {
			const buffer = new SnapshotBuffer(5);
			buffer.save(asTick(0), new Uint8Array(0), 0);

			const snapshot = buffer.get(asTick(0));
			assert.ok(snapshot);
			assert.strictEqual(snapshot.state.length, 0);
		});

		it("should handle large state", () => {
			const buffer = new SnapshotBuffer(5);
			const largeState = new Uint8Array(1024 * 1024); // 1MB
			largeState.fill(42);

			buffer.save(asTick(0), largeState, 42);

			const snapshot = buffer.get(asTick(0));
			assert.ok(snapshot);
			assert.strictEqual(snapshot.state.length, 1024 * 1024);
			assert.strictEqual(snapshot.state[0], 42);
		});
	});
});
