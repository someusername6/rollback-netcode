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
 */
export class SnapshotBuffer {
  private readonly buffer: (Snapshot | undefined)[];
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
   * If the buffer is full, the oldest snapshot is evicted.
   * The state is copied to prevent external mutation.
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

    // If buffer is full, we're overwriting the oldest
    if (this.count === this.capacity) {
      // The slot at head contains the oldest snapshot
      this.buffer[this.head] = snapshot;
      this.head = (this.head + 1) % this.capacity;
      // Update oldest tick to the new oldest
      const oldestSnapshot = this.buffer[this.head];
      this._oldestTick = oldestSnapshot?.tick;
    } else {
      // Buffer not full, just append
      const writePos = (this.head + this.count) % this.capacity;
      this.buffer[writePos] = snapshot;
      this.count++;
      if (this.count === 1) {
        this._oldestTick = tick;
      }
    }

    this._newestTick = tick;
  }

  /**
   * Get a snapshot at a specific tick.
   *
   * @param tick - The tick to retrieve
   * @returns The snapshot at that tick, or undefined if not found
   */
  get(tick: Tick): Snapshot | undefined {
    if (this.count === 0) {
      return undefined;
    }

    // Search for the snapshot with matching tick
    for (let i = 0; i < this.count; i++) {
      const idx = (this.head + i) % this.capacity;
      const snapshot = this.buffer[idx];
      if (snapshot?.tick === tick) {
        return snapshot;
      }
    }

    return undefined;
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
    this.head = 0;
    this.count = 0;
    this._oldestTick = undefined;
    this._newestTick = undefined;
  }

  /**
   * Get the snapshot at or before a given tick.
   * Useful for finding the closest snapshot for rollback.
   *
   * @param tick - The target tick
   * @returns The snapshot at or before that tick, or undefined if none exists
   */
  getAtOrBefore(tick: Tick): Snapshot | undefined {
    if (this.count === 0) {
      return undefined;
    }

    let best: Snapshot | undefined;

    for (let i = 0; i < this.count; i++) {
      const idx = (this.head + i) % this.capacity;
      const snapshot = this.buffer[idx];
      if (snapshot && snapshot.tick <= tick) {
        if (!best || snapshot.tick > best.tick) {
          best = snapshot;
        }
      }
    }

    return best;
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
