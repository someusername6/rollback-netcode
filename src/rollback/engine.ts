/**
 * Core rollback netcode engine.
 *
 * Handles the rollback algorithm: detecting mispredictions,
 * restoring state, and resimulating forward.
 */

import type {
	Game,
	InputPredictor,
	PlayerId,
	PlayerTimeline,
	Tick,
	TickResult,
} from "../types.js";
import { DEFAULT_INPUT_PREDICTOR, asTick } from "../types.js";
import { InputBuffer } from "./input-buffer.js";
import { SnapshotBuffer } from "./snapshot-buffer.js";

/**
 * Configuration for the rollback engine.
 */
export interface RollbackEngineConfig {
	/** The game instance to control */
	game: Game;

	/** The local player's ID */
	localPlayerId: PlayerId;

	/** Number of snapshots to keep in history */
	snapshotHistorySize?: number;

	/** Maximum ticks to speculate ahead without confirmed inputs */
	maxSpeculationTicks?: number;

	/** Input predictor for remote players */
	inputPredictor?: InputPredictor<Uint8Array>;
}

/**
 * Core rollback engine that handles prediction, rollback, and resimulation.
 */
export class RollbackEngine {
	private readonly game: Game;
	private readonly localPlayerId: PlayerId;
	private readonly snapshotBuffer: SnapshotBuffer;
	private readonly inputBuffer: InputBuffer;
	private readonly inputPredictor: InputPredictor<Uint8Array>;
	private readonly maxSpeculationTicks: number;

	private _currentTick: Tick;
	private _confirmedTick: Tick;
	private localInputs: Map<Tick, Uint8Array> = new Map();

	/**
	 * Create a new rollback engine.
	 */
	constructor(config: RollbackEngineConfig) {
		this.game = config.game;
		this.localPlayerId = config.localPlayerId;
		this.maxSpeculationTicks = config.maxSpeculationTicks ?? 60;
		this.inputPredictor = config.inputPredictor ?? DEFAULT_INPUT_PREDICTOR;

		this.snapshotBuffer = new SnapshotBuffer(config.snapshotHistorySize ?? 120);
		this.inputBuffer = new InputBuffer();

		this._currentTick = asTick(0);
		this._confirmedTick = asTick(-1);

		// Add local player
		this.inputBuffer.addPlayer(this.localPlayerId, asTick(0));
	}

	/**
	 * The current simulation tick.
	 */
	get currentTick(): Tick {
		return this._currentTick;
	}

	/**
	 * The lowest confirmed tick across all active players.
	 * All inputs up to and including this tick are confirmed.
	 */
	get confirmedTick(): Tick {
		return this._confirmedTick;
	}

	/**
	 * Add a player to the simulation.
	 *
	 * @param playerId - The player's ID
	 * @param joinTick - The tick at which they join
	 */
	addPlayer(playerId: PlayerId, joinTick: Tick): void {
		this.inputBuffer.addPlayer(playerId, joinTick);
	}

	/**
	 * Remove a player from the simulation.
	 *
	 * @param playerId - The player's ID
	 * @param leaveTick - The tick at which they leave
	 */
	removePlayer(playerId: PlayerId, leaveTick: Tick): void {
		this.inputBuffer.removePlayer(playerId, leaveTick);
	}

	/**
	 * Set the local player's input for the current tick.
	 * Call this before tick() to set what input the local player uses.
	 *
	 * @param tick - The tick the input is for
	 * @param input - The input data
	 */
	setLocalInput(tick: Tick, input: Uint8Array): void {
		// Copy input
		const inputCopy = new Uint8Array(input.length);
		inputCopy.set(input);

		this.localInputs.set(tick, inputCopy);

		// Also register with input buffer so it's available for misprediction detection
		this.inputBuffer.receiveInput(this.localPlayerId, tick, inputCopy);
	}

	/**
	 * Receive a remote player's input.
	 *
	 * @param playerId - The player's ID
	 * @param tick - The tick the input is for
	 * @param input - The input data
	 */
	receiveRemoteInput(playerId: PlayerId, tick: Tick, input: Uint8Array): void {
		this.inputBuffer.receiveInput(playerId, tick, input);
	}

	/**
	 * Get the local player's input for a tick.
	 *
	 * @param tick - The tick to get input for
	 * @returns The input, or undefined if not set
	 */
	getLocalInput(tick: Tick): Uint8Array | undefined {
		return this.localInputs.get(tick);
	}

	/**
	 * Save the initial snapshot at tick -1.
	 * This allows rollback of tick 0 if there's a misprediction.
	 * Call this before the first tick() if the engine wasn't initialized via setState().
	 */
	saveInitialSnapshot(): void {
		if (!this.snapshotBuffer.has(asTick(-1))) {
			const state = this.game.serialize();
			const hash = this.game.hash();
			this.snapshotBuffer.save(asTick(-1), state, hash);
		}
	}

	/**
	 * Advance the simulation by one tick.
	 *
	 * This is the core rollback algorithm:
	 * 1. Check for mispredictions among remote players
	 * 2. If misprediction found, rollback and resimulate
	 * 3. Gather inputs (real or predicted) for all players
	 * 4. Step the simulation
	 * 5. Save snapshot
	 *
	 * @returns Result containing tick number and rollback info
	 */
	tick(): TickResult {
		// Ensure we have an initial snapshot for rollback on first tick
		if (this._currentTick === 0) {
			this.saveInitialSnapshot();
		}
		// Check for max speculation limit
		const minConfirmed = this.inputBuffer.getMinConfirmedTick(
			this._currentTick,
		);
		if (minConfirmed !== undefined) {
			const speculation = this._currentTick - minConfirmed;
			if (speculation >= this.maxSpeculationTicks) {
				// Can't advance further - would exceed max speculation
				// Return early without advancing
				return {
					tick: this._currentTick,
					rolledBack: false,
				};
			}
		}

		// Check for mispredictions and rollback if needed
		const rollbackResult = this.checkAndRollback();

		// Gather inputs for current tick
		const inputs = this.gatherInputs(this._currentTick);

		// Step the simulation
		this.game.step(inputs);

		// Save snapshot
		const state = this.game.serialize();
		const hash = this.game.hash();
		this.snapshotBuffer.save(this._currentTick, state, hash);

		// Update confirmed tick
		this.updateConfirmedTick();

		// Advance tick counter
		const tickResult = this._currentTick;
		this._currentTick = asTick(this._currentTick + 1);

		return {
			tick: tickResult,
			rolledBack: rollbackResult.rolledBack,
			rollbackTicks: rollbackResult.rollbackTicks,
		};
	}

	/**
	 * Check for mispredictions and rollback if found.
	 */
	private checkAndRollback(): { rolledBack: boolean; rollbackTicks?: number } {
		// Find the earliest misprediction across all remote players
		let earliestMisprediction: Tick | undefined;

		const activePlayers = this.inputBuffer.getActivePlayers(this._currentTick);
		for (const playerId of activePlayers) {
			if (playerId === this.localPlayerId) continue;

			const mispredictTick = this.inputBuffer.findMisprediction(
				playerId,
				this._confirmedTick >= 0 ? asTick(this._confirmedTick + 1) : asTick(0),
			);

			if (mispredictTick !== undefined) {
				if (
					earliestMisprediction === undefined ||
					mispredictTick < earliestMisprediction
				) {
					earliestMisprediction = mispredictTick;
				}
			}
		}

		if (earliestMisprediction === undefined) {
			return { rolledBack: false };
		}

		// We need to rollback to the tick BEFORE the misprediction
		const restoreTick = asTick(earliestMisprediction - 1);
		const ticksToResimulate = this._currentTick - earliestMisprediction;

		// Find snapshot to restore
		const snapshot = this.snapshotBuffer.get(restoreTick);
		if (!snapshot) {
			// Can't rollback - snapshot not available
			// This shouldn't happen if snapshotHistorySize is large enough
			console.warn(
				`Cannot rollback to tick ${restoreTick}: snapshot not available`,
			);
			return { rolledBack: false };
		}

		// Restore game state
		this.game.deserialize(snapshot.state);

		// Clear used inputs from the misprediction point onwards
		this.inputBuffer.clearAllUsedInputsFrom(earliestMisprediction);

		// Resimulate from misprediction tick to current tick
		for (let tick = earliestMisprediction; tick < this._currentTick; tick++) {
			const inputs = this.gatherInputs(asTick(tick));
			this.game.step(inputs);

			// Update snapshot
			const state = this.game.serialize();
			const hash = this.game.hash();
			this.snapshotBuffer.save(asTick(tick), state, hash);
		}

		return {
			rolledBack: true,
			rollbackTicks: ticksToResimulate,
		};
	}

	/**
	 * Gather inputs for all active players at a given tick.
	 * Uses real inputs when available, predicts otherwise.
	 */
	private gatherInputs(tick: Tick): Map<PlayerId, Uint8Array> {
		const inputs = new Map<PlayerId, Uint8Array>();
		const activePlayers = this.inputBuffer.getActivePlayers(tick);

		for (const playerId of activePlayers) {
			let input: Uint8Array;

			if (playerId === this.localPlayerId) {
				// Local player - use our stored input
				input = this.localInputs.get(tick) ?? new Uint8Array(0);
			} else {
				// Remote player - use received input or predict
				const received = this.inputBuffer.getInput(playerId, tick);
				if (received) {
					input = received;
				} else {
					// Predict based on last confirmed input
					const lastInput = this.inputBuffer.getLastConfirmedInput(playerId);
					input = this.inputPredictor.predict(playerId, tick, lastInput);
				}
			}

			inputs.set(playerId, input);

			// Record what we used for misprediction detection
			this.inputBuffer.recordUsedInput(playerId, tick, input);
		}

		return inputs;
	}

	/**
	 * Update the confirmed tick based on all players' confirmed ticks.
	 */
	private updateConfirmedTick(): void {
		const minConfirmed = this.inputBuffer.getMinConfirmedTick(
			this._currentTick,
		);
		if (minConfirmed !== undefined && minConfirmed > this._confirmedTick) {
			this._confirmedTick = minConfirmed;

			// Prune old data
			const pruneBelow = asTick(this._confirmedTick - 10); // Keep some buffer
			if (pruneBelow > 0) {
				this.inputBuffer.pruneBeforeTick(pruneBelow);
				this.snapshotBuffer.pruneBeforeTick(pruneBelow);

				// Also prune local inputs
				for (const tick of this.localInputs.keys()) {
					if (tick < pruneBelow) {
						this.localInputs.delete(tick);
					}
				}
			}
		}
	}

	/**
	 * Get the hash at a specific tick.
	 *
	 * @param tick - The tick to get hash for
	 * @returns The hash, or undefined if not available
	 */
	getHash(tick: Tick): number | undefined {
		return this.snapshotBuffer.get(tick)?.hash;
	}

	/**
	 * Get the current game hash.
	 */
	getCurrentHash(): number {
		return this.game.hash();
	}

	/**
	 * Get the current game state and player timeline for sync.
	 */
	getState(): {
		tick: Tick;
		state: Uint8Array;
		playerTimeline: PlayerTimeline;
	} {
		const players = this.inputBuffer.getAllPlayers();
		const playerTimeline: PlayerTimeline = [];

		for (const playerId of players) {
			const joinTick = this.inputBuffer.getJoinTick(playerId);
			const leaveTick = this.inputBuffer.getLeaveTick(playerId);

			if (joinTick !== undefined) {
				playerTimeline.push({
					playerId,
					joinTick,
					leaveTick: leaveTick ?? null,
				});
			}
		}

		return {
			tick: this._currentTick,
			state: this.game.serialize(),
			playerTimeline,
		};
	}

	/**
	 * Set the game state from a sync message.
	 * Used for late join or desync recovery.
	 *
	 * @param tick - The tick the state is from
	 * @param state - The serialized game state
	 * @param playerTimeline - Timeline of player join/leave events
	 */
	setState(
		tick: Tick,
		state: Uint8Array,
		playerTimeline: PlayerTimeline,
	): void {
		// Restore game state
		this.game.deserialize(state);

		// Clear buffers
		this.snapshotBuffer.clear();
		this.inputBuffer.clear();
		this.localInputs.clear();

		// Restore player timeline
		for (const entry of playerTimeline) {
			this.inputBuffer.addPlayer(entry.playerId, entry.joinTick);
			if (entry.leaveTick !== null) {
				this.inputBuffer.removePlayer(entry.playerId, entry.leaveTick);
			}
		}

		// Save initial snapshot at tick - 1 (state before any simulation)
		// This is needed so we can rollback tick 0 if there's a misprediction
		const hash = this.game.hash();
		this.snapshotBuffer.save(asTick(tick - 1), state, hash);

		// Set tick counters - currentTick is the next tick to simulate
		this._currentTick = tick;
		this._confirmedTick = asTick(tick - 1);
	}

	/**
	 * Check if we have all inputs for a given tick.
	 *
	 * @param tick - The tick to check
	 * @returns true if all inputs are available
	 */
	hasAllInputsForTick(tick: Tick): boolean {
		return this.inputBuffer.hasAllInputsForTick(tick);
	}

	/**
	 * Get the number of ticks we're speculating ahead.
	 */
	getSpeculationDistance(): number {
		if (this._confirmedTick < 0) {
			return this._currentTick;
		}
		return this._currentTick - this._confirmedTick - 1;
	}

	/**
	 * Get all active player IDs at the current tick.
	 */
	getActivePlayers(): PlayerId[] {
		return this.inputBuffer.getActivePlayers(this._currentTick);
	}

	/**
	 * Get all player IDs.
	 */
	getAllPlayers(): PlayerId[] {
		return this.inputBuffer.getAllPlayers();
	}

	/**
	 * Reset the engine to initial state.
	 */
	reset(): void {
		this.snapshotBuffer.clear();
		this.inputBuffer.clear();
		this.localInputs.clear();
		this._currentTick = asTick(0);
		this._confirmedTick = asTick(-1);

		// Re-add local player
		this.inputBuffer.addPlayer(this.localPlayerId, asTick(0));
	}
}
