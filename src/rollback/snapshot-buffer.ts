/**
 * Ring buffer for storing game state snapshots.
 *
 * Used for rollback: when a misprediction is detected, the game state
 * is restored from a snapshot and resimulated forward.
 */

import type { Snapshot, Tick } from "../types.js";
import { asTick } from "../types.js";

/**
 * A ring buffer that stores game state snapshots for rollback.
 *
 * Snapshots are stored at specific ticks and can be retrieved by tick.
 * When the buffer is full, the oldest snapshot is evicted.
 * Uses a tick-to-index map for O(1) lookup performance.
 *
 * INVARIANT: Snapshots must be saved in ascending tick order. This is required
 * for O(log n) binary search in getAtOrBefore(). The invariant is maintained by:
 * - Normal simulation: ticks advance sequentially (0, 1, 2, ...)
 * - Resimulation: existing ticks are updated in-place, preserving order
 *
 * Saving a non-existing tick out of order will corrupt the sort order and
 * cause getAtOrBefore() to return incorrect results.
 */
export class SnapshotBuffer {
	private readonly buffer: (Snapshot | undefined)[];
	private readonly tickToIndex: Map<Tick, number> = new Map();
	private head = 0; // Next write position
	private count = 0;
	private _oldestTick: Tick | undefined;
	private _newestTick: Tick | undefined;

	/**
	 * Create a new snapshot buffer.
	 *
	 * @param capacity - Maximum number of snapshots to store
	 */
	constructor(public readonly capacity: number) {
		if (capacity <= 0) {
			throw new Error("Capacity must be positive");
		}
		this.buffer = new Array(capacity);
	}

	/**
	 * Number of snapshots currently stored.
	 */
	get size(): number {
		return this.count;
	}

	/**
	 * The oldest tick in the buffer, or undefined if empty.
	 */
	get oldestTick(): Tick | undefined {
		return this._oldestTick;
	}

	/**
	 * The newest tick in the buffer, or undefined if empty.
	 */
	get newestTick(): Tick | undefined {
		return this._newestTick;
	}

	/**
	 * Save a snapshot at a specific tick.
	 *
	 * If the tick already exists, updates in-place to maintain sort order.
	 * If the buffer is full, the oldest snapshot is evicted.
	 * The state is copied to prevent external mutation.
	 *
	 * PRECONDITION: New ticks (not already in buffer) must be >= all existing ticks.
	 * Saving an out-of-order new tick corrupts sort order. See class invariant.
	 *
	 * @param tick - The tick this snapshot was taken at
	 * @param state - The serialized game state
	 * @param hash - The hash of the game state
	 */
	save(tick: Tick, state: Uint8Array, hash: number): void {
		// Copy the state to prevent external mutation
		const stateCopy = new Uint8Array(state.length);
		stateCopy.set(state);

		const snapshot: Snapshot = {
			tick,
			state: stateCopy,
			hash,
		};

		// Check if this tick already exists - update in-place to maintain order
		const existingIdx = this.tickToIndex.get(tick);
		if (existingIdx !== undefined) {
			this.buffer[existingIdx] = snapshot;
			return;
		}

		// Warn on invariant violation: new ticks must be >= newest for binary search
		if (this._newestTick !== undefined && tick < this._newestTick) {
			console.error(
				`SnapshotBuffer: tick ${tick} is out of order (newest: ${this._newestTick}). ` +
					`This will corrupt binary search in getAtOrBefore().`,
			);
		}

		// New tick - append or evict oldest
		if (this.count === this.capacity) {
			// Remove old tick from index map
			const oldSnapshot = this.buffer[this.head];
			if (oldSnapshot) {
				this.tickToIndex.delete(oldSnapshot.tick);
			}

			// The slot at head contains the oldest snapshot
			this.buffer[this.head] = snapshot;
			this.tickToIndex.set(tick, this.head);
			this.head = (this.head + 1) % this.capacity;
			// Update oldest tick to the new oldest
			const oldestSnapshot = this.buffer[this.head];
			this._oldestTick = oldestSnapshot?.tick;
		} else {
			// Buffer not full, just append
			const writePos = (this.head + this.count) % this.capacity;
			this.buffer[writePos] = snapshot;
			this.tickToIndex.set(tick, writePos);
			this.count++;
			if (this.count === 1) {
				this._oldestTick = tick;
			}
		}

		this._newestTick = tick;
	}

	/**
	 * Get a snapshot at a specific tick.
	 * Uses O(1) map lookup for performance.
	 *
	 * @param tick - The tick to retrieve
	 * @returns The snapshot at that tick, or undefined if not found
	 */
	get(tick: Tick): Snapshot | undefined {
		const idx = this.tickToIndex.get(tick);
		if (idx === undefined) {
			return undefined;
		}
		return this.buffer[idx];
	}

	/**
	 * Get the oldest snapshot in the buffer.
	 *
	 * @returns The oldest snapshot, or undefined if empty
	 */
	getOldest(): Snapshot | undefined {
		if (this.count === 0) {
			return undefined;
		}
		return this.buffer[this.head];
	}

	/**
	 * Get the newest snapshot in the buffer.
	 *
	 * @returns The newest snapshot, or undefined if empty
	 */
	getNewest(): Snapshot | undefined {
		if (this.count === 0) {
			return undefined;
		}
		const newestIdx = (this.head + this.count - 1) % this.capacity;
		return this.buffer[newestIdx];
	}

	/**
	 * Clear all snapshots from the buffer.
	 */
	clear(): void {
		this.buffer.fill(undefined);
		this.tickToIndex.clear();
		this.head = 0;
		this.count = 0;
		this._oldestTick = undefined;
		this._newestTick = undefined;
	}

	/**
	 * Get the snapshot at or before a given tick.
	 * Useful for finding the closest snapshot for rollback.
	 *
	 * O(log n) binary search. Snapshots are stored in ascending tick order.
	 *
	 * @param tick - The target tick
	 * @returns The snapshot at or before that tick, or undefined if none exists
	 */
	getAtOrBefore(tick: Tick): Snapshot | undefined {
		if (this.count === 0) {
			return undefined;
		}

		// Binary search to find the rightmost snapshot with tick <= target
		// Logical indices: 0 to count-1, physical: (head + logical) % capacity
		let lo = 0;
		let hi = this.count - 1;
		let result: Snapshot | undefined;

		while (lo <= hi) {
			const mid = (lo + hi) >>> 1;
			const idx = (this.head + mid) % this.capacity;
			const snapshot = this.buffer[idx];

			if (snapshot && snapshot.tick <= tick) {
				// This snapshot is valid, but there might be a better one to the right
				result = snapshot;
				lo = mid + 1;
			} else {
				// Snapshot tick is too high, search left
				hi = mid - 1;
			}
		}

		return result;
	}

	/**
	 * Remove all snapshots before a given tick.
	 * Used to clean up old snapshots that are no longer needed.
	 *
	 * @param tick - Remove all snapshots with tick < this value
	 */
	pruneBeforeTick(tick: Tick): void {
		while (this.count > 0) {
			const oldest = this.buffer[this.head];
			if (oldest && oldest.tick < tick) {
				// Remove from index map
				this.tickToIndex.delete(oldest.tick);
				this.buffer[this.head] = undefined;
				this.head = (this.head + 1) % this.capacity;
				this.count--;
				if (this.count === 0) {
					this._oldestTick = undefined;
					this._newestTick = undefined;
				} else {
					this._oldestTick = this.buffer[this.head]?.tick;
				}
			} else {
				break;
			}
		}
	}

	/**
	 * Check if a snapshot exists at a given tick.
	 *
	 * @param tick - The tick to check
	 * @returns true if a snapshot exists at that tick
	 */
	has(tick: Tick): boolean {
		return this.get(tick) !== undefined;
	}

	/**
	 * Get all ticks that have snapshots, in order from oldest to newest.
	 *
	 * @returns Array of ticks with snapshots
	 */
	getTicks(): Tick[] {
		const ticks: Tick[] = [];
		for (let i = 0; i < this.count; i++) {
			const idx = (this.head + i) % this.capacity;
			const snapshot = this.buffer[idx];
			if (snapshot) {
				ticks.push(snapshot.tick);
			}
		}
		return ticks;
	}
}
