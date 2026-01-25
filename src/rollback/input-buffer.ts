/**
 * Per-player input tracking with support for dynamic join/leave.
 *
 * Tracks received inputs, confirmed ticks, and used (predicted) inputs
 * to enable misprediction detection during rollback.
 */

import type { PlayerId, Tick } from "../types.js";
import { asTick } from "../types.js";

/** Number of ticks to keep before the confirmed tick when pruning */
const PRUNE_BUFFER_TICKS = 10;

/**
 * State for a single player's inputs.
 */
interface PlayerInputState {
	/** Tick when the player joined */
	joinTick: Tick;

	/** Tick when the player left (null if still active) */
	leaveTick: Tick | null;

	/** Map of tick -> received input */
	received: Map<Tick, Uint8Array>;

	/** Highest consecutive tick for which we have confirmed input */
	confirmedTick: Tick;

	/** Map of tick -> input that was actually used in simulation (may be predicted) */
	usedInputs: Map<Tick, Uint8Array>;
}

/**
 * Compares two Uint8Arrays for equality.
 */
function inputsEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) {
		if (a[i] !== b[i]) return false;
	}
	return true;
}

/**
 * Buffer for tracking inputs from all players.
 *
 * Supports:
 * - Dynamic player join/leave
 * - Out-of-order input reception
 * - Misprediction detection
 * - Confirmed tick tracking
 */
export class InputBuffer {
	private readonly players: Map<PlayerId, PlayerInputState> = new Map();

	/** Index of players by their join tick for O(1) lookup */
	private readonly joinsByTick: Map<Tick, Set<PlayerId>> = new Map();

	/** Index of players by their leave tick for O(1) lookup */
	private readonly leavesByTick: Map<Tick, Set<PlayerId>> = new Map();

	/**
	 * Add a player to the buffer.
	 *
	 * @param playerId - The player's ID
	 * @param joinTick - The tick at which the player joins
	 */
	addPlayer(playerId: PlayerId, joinTick: Tick): void {
		const existing = this.players.get(playerId);
		if (existing) {
			// If player is rejoining, update join tick and clear leave tick
			if (existing.leaveTick !== null) {
				// Remove from old join tick index
				this.removeFromTickIndex(this.joinsByTick, existing.joinTick, playerId);
				// Remove from leave tick index
				this.removeFromTickIndex(this.leavesByTick, existing.leaveTick, playerId);

				existing.joinTick = joinTick;
				existing.leaveTick = null;
				existing.confirmedTick = asTick(joinTick - 1);
				existing.received.clear();
				existing.usedInputs.clear();

				// Add to new join tick index
				this.addToTickIndex(this.joinsByTick, joinTick, playerId);
			}
			return;
		}

		this.players.set(playerId, {
			joinTick,
			leaveTick: null,
			received: new Map(),
			confirmedTick: asTick(joinTick - 1), // No inputs confirmed yet
			usedInputs: new Map(),
		});

		// Add to join tick index
		this.addToTickIndex(this.joinsByTick, joinTick, playerId);
	}

	/**
	 * Mark a player as having left.
	 *
	 * @param playerId - The player's ID
	 * @param leaveTick - The tick at which the player leaves
	 */
	removePlayer(playerId: PlayerId, leaveTick: Tick): void {
		const player = this.players.get(playerId);
		if (player) {
			// Remove from old leave tick index if they had one
			if (player.leaveTick !== null) {
				this.removeFromTickIndex(this.leavesByTick, player.leaveTick, playerId);
			}

			player.leaveTick = leaveTick;

			// Add to leave tick index
			this.addToTickIndex(this.leavesByTick, leaveTick, playerId);
		}
	}

	/**
	 * Set the confirmed tick for all active players to a specific value.
	 * Used after a state sync to indicate that all inputs up to that tick
	 * are implicitly confirmed by the synced state.
	 *
	 * @param tick - The tick to set as confirmed for all active players
	 */
	setConfirmedTickForSync(tick: Tick): void {
		// Guard against underflow when tick is 0 or negative
		if (tick <= 0) {
			return;
		}
		const confirmedTick = asTick(tick - 1);
		for (const player of this.players.values()) {
			// Only update if the player was active at or before this tick
			if (player.leaveTick === null || player.leaveTick > tick) {
				// Set confirmed tick to tick-1 (the state represents confirmed state)
				if (player.confirmedTick < confirmedTick) {
					player.confirmedTick = confirmedTick;
				}
			}
		}
	}

	/**
	 * Check if a player is active at a given tick.
	 *
	 * @param playerId - The player's ID
	 * @param tick - The tick to check
	 * @returns true if the player is active at that tick
	 */
	isPlayerActive(playerId: PlayerId, tick: Tick): boolean {
		const player = this.players.get(playerId);
		if (!player) return false;

		if (tick < player.joinTick) return false;
		if (player.leaveTick !== null && tick >= player.leaveTick) return false;

		return true;
	}

	/**
	 * Get all players that are active at a given tick.
	 *
	 * @param tick - The tick to check
	 * @returns Array of active player IDs
	 */
	getActivePlayers(tick: Tick): PlayerId[] {
		const active: PlayerId[] = [];
		for (const [playerId] of this.players) {
			if (this.isPlayerActive(playerId, tick)) {
				active.push(playerId);
			}
		}
		return active;
	}

	/**
	 * Get all player IDs (active or not).
	 *
	 * @returns Array of all player IDs
	 */
	getAllPlayers(): PlayerId[] {
		return Array.from(this.players.keys());
	}

	/**
	 * Receive an input from a player.
	 * The input is copied to prevent external mutation.
	 *
	 * @param playerId - The player's ID
	 * @param tick - The tick the input is for
	 * @param input - The input data
	 */
	receiveInput(playerId: PlayerId, tick: Tick, input: Uint8Array): void {
		const player = this.players.get(playerId);
		if (!player) return;

		// Don't accept inputs for ticks before the player joined
		if (tick < player.joinTick) return;

		// Don't accept inputs for ticks after the player left
		if (player.leaveTick !== null && tick >= player.leaveTick) return;

		// Copy input to prevent external mutation
		const inputCopy = new Uint8Array(input.length);
		inputCopy.set(input);

		player.received.set(tick, inputCopy);

		// Update confirmed tick (highest consecutive tick with input)
		this.updateConfirmedTick(player);
	}

	/**
	 * Update the confirmed tick for a player.
	 * Confirmed tick is the highest tick where all ticks from joinTick
	 * to that tick have received inputs.
	 */
	private updateConfirmedTick(player: PlayerInputState): void {
		let tick = player.confirmedTick + 1;
		while (player.received.has(asTick(tick))) {
			tick++;
		}
		player.confirmedTick = asTick(tick - 1);
	}

	/**
	 * Get the received input for a player at a specific tick.
	 *
	 * @param playerId - The player's ID
	 * @param tick - The tick to get input for
	 * @returns The input, or undefined if not received
	 */
	getInput(playerId: PlayerId, tick: Tick): Uint8Array | undefined {
		const player = this.players.get(playerId);
		if (!player) return undefined;
		return player.received.get(tick);
	}

	/**
	 * Get the confirmed tick for a player.
	 * This is the highest consecutive tick for which we have received input.
	 *
	 * @param playerId - The player's ID
	 * @returns The confirmed tick, or undefined if player not found
	 */
	getConfirmedTick(playerId: PlayerId): Tick | undefined {
		const player = this.players.get(playerId);
		if (!player) return undefined;
		return player.confirmedTick;
	}

	/**
	 * Get the join tick for a player.
	 *
	 * @param playerId - The player's ID
	 * @returns The join tick, or undefined if player not found
	 */
	getJoinTick(playerId: PlayerId): Tick | undefined {
		const player = this.players.get(playerId);
		return player?.joinTick;
	}

	/**
	 * Get the leave tick for a player.
	 *
	 * @param playerId - The player's ID
	 * @returns The leave tick, or null/undefined if player hasn't left or not found
	 */
	getLeaveTick(playerId: PlayerId): Tick | null | undefined {
		const player = this.players.get(playerId);
		return player?.leaveTick;
	}

	/**
	 * Record the input that was actually used for a player at a tick.
	 * This may be the real input or a predicted input.
	 *
	 * @param playerId - The player's ID
	 * @param tick - The tick
	 * @param input - The input that was used
	 */
	recordUsedInput(playerId: PlayerId, tick: Tick, input: Uint8Array): void {
		const player = this.players.get(playerId);
		if (!player) return;

		// Copy input
		const inputCopy = new Uint8Array(input.length);
		inputCopy.set(input);

		player.usedInputs.set(tick, inputCopy);
	}

	/**
	 * Get the input that was used for a player at a tick.
	 *
	 * @param playerId - The player's ID
	 * @param tick - The tick
	 * @returns The used input, or undefined if not recorded
	 */
	getUsedInput(playerId: PlayerId, tick: Tick): Uint8Array | undefined {
		const player = this.players.get(playerId);
		if (!player) return undefined;
		return player.usedInputs.get(tick);
	}

	/**
	 * Find the first tick where a misprediction occurred for a player.
	 * A misprediction is when we used a predicted input that differs
	 * from the actual received input.
	 *
	 * @param playerId - The player's ID
	 * @param fromTick - Start searching from this tick
	 * @returns The tick of the first misprediction, or undefined if none found
	 */
	findMisprediction(playerId: PlayerId, fromTick: Tick): Tick | undefined {
		const player = this.players.get(playerId);
		if (!player) return undefined;

		// Check each tick from fromTick up to confirmedTick
		for (let tick = fromTick; tick <= player.confirmedTick; tick++) {
			const received = player.received.get(asTick(tick));
			const used = player.usedInputs.get(asTick(tick));

			// If we have both received and used inputs, compare them
			if (received !== undefined && used !== undefined) {
				if (!inputsEqual(received, used)) {
					return asTick(tick);
				}
			}
		}

		return undefined;
	}

	/**
	 * Check if there are any mispredictions for a player in a tick range.
	 *
	 * @param playerId - The player's ID
	 * @param fromTick - Start of range (inclusive)
	 * @param toTick - End of range (inclusive)
	 * @returns true if any misprediction found
	 */
	hasMisprediction(playerId: PlayerId, fromTick: Tick, toTick: Tick): boolean {
		const player = this.players.get(playerId);
		if (!player) return false;

		for (let tick = fromTick; tick <= toTick; tick++) {
			const received = player.received.get(asTick(tick));
			const used = player.usedInputs.get(asTick(tick));

			if (received !== undefined && used !== undefined) {
				if (!inputsEqual(received, used)) {
					return true;
				}
			}
		}

		return false;
	}

	/**
	 * Get the last confirmed input for a player.
	 * Useful for input prediction.
	 *
	 * @param playerId - The player's ID
	 * @returns The last confirmed input, or undefined if none
	 */
	getLastConfirmedInput(playerId: PlayerId): Uint8Array | undefined {
		const player = this.players.get(playerId);
		if (!player) return undefined;

		// Return input at confirmedTick, not just any received input
		// confirmedTick is the highest consecutive tick with input
		if (player.confirmedTick >= player.joinTick) {
			return player.received.get(player.confirmedTick);
		}

		return undefined;
	}

	/**
	 * Remove all data before a given tick.
	 * Used to clean up old inputs that are no longer needed.
	 *
	 * @param tick - Remove all data for ticks < this value
	 */
	pruneBeforeTick(tick: Tick): void {
		for (const player of this.players.values()) {
			// Remove old received inputs
			for (const t of player.received.keys()) {
				if (t < tick) {
					player.received.delete(t);
				}
			}

			// Remove old used inputs
			for (const t of player.usedInputs.keys()) {
				if (t < tick) {
					player.usedInputs.delete(t);
				}
			}
		}
	}

	/**
	 * Clear used inputs for a player from a given tick onwards.
	 * Called during rollback to allow re-recording inputs.
	 *
	 * @param playerId - The player's ID
	 * @param fromTick - Clear from this tick onwards
	 */
	clearUsedInputsFrom(playerId: PlayerId, fromTick: Tick): void {
		const player = this.players.get(playerId);
		if (!player) return;

		for (const tick of player.usedInputs.keys()) {
			if (tick >= fromTick) {
				player.usedInputs.delete(tick);
			}
		}
	}

	/**
	 * Clear all used inputs from a given tick onwards for all players.
	 *
	 * @param fromTick - Clear from this tick onwards
	 */
	clearAllUsedInputsFrom(fromTick: Tick): void {
		for (const playerId of this.players.keys()) {
			this.clearUsedInputsFrom(playerId, fromTick);
		}
	}

	/**
	 * Get the minimum confirmed tick across all active players at a given tick.
	 *
	 * @param tick - The reference tick for determining active players
	 * @returns The minimum confirmed tick, or undefined if no active players
	 */
	getMinConfirmedTick(tick: Tick): Tick | undefined {
		let minTick: Tick | undefined;

		for (const [playerId, player] of this.players) {
			if (this.isPlayerActive(playerId, tick)) {
				if (minTick === undefined || player.confirmedTick < minTick) {
					minTick = player.confirmedTick;
				}
			}
		}

		return minTick;
	}

	/**
	 * Check if we have all inputs for a given tick from all active players.
	 *
	 * @param tick - The tick to check
	 * @returns true if all inputs are available
	 */
	hasAllInputsForTick(tick: Tick): boolean {
		for (const [playerId] of this.players) {
			if (this.isPlayerActive(playerId, tick)) {
				if (!this.getInput(playerId, tick)) {
					return false;
				}
			}
		}
		return true;
	}

	/**
	 * Clear all data for a player.
	 *
	 * @param playerId - The player's ID
	 */
	clearPlayer(playerId: PlayerId): void {
		const player = this.players.get(playerId);
		if (player) {
			// Remove from tick indexes
			this.removeFromTickIndex(this.joinsByTick, player.joinTick, playerId);
			if (player.leaveTick !== null) {
				this.removeFromTickIndex(this.leavesByTick, player.leaveTick, playerId);
			}
		}
		this.players.delete(playerId);
	}

	/**
	 * Clear all players and data.
	 */
	clear(): void {
		this.players.clear();
		this.joinsByTick.clear();
		this.leavesByTick.clear();
	}

	/**
	 * Get all players that join at a specific tick.
	 * O(1) lookup using tick-indexed map.
	 *
	 * @param tick - The tick to check
	 * @returns Array of player IDs joining at this tick
	 */
	getPlayersJoiningAtTick(tick: Tick): PlayerId[] {
		const players = this.joinsByTick.get(tick);
		return players ? Array.from(players) : [];
	}

	/**
	 * Get all players that leave at a specific tick.
	 * O(1) lookup using tick-indexed map.
	 *
	 * @param tick - The tick to check
	 * @returns Array of player IDs leaving at this tick
	 */
	getPlayersLeavingAtTick(tick: Tick): PlayerId[] {
		const players = this.leavesByTick.get(tick);
		return players ? Array.from(players) : [];
	}

	/**
	 * Add a player to a tick index.
	 */
	private addToTickIndex(
		index: Map<Tick, Set<PlayerId>>,
		tick: Tick,
		playerId: PlayerId,
	): void {
		let players = index.get(tick);
		if (!players) {
			players = new Set();
			index.set(tick, players);
		}
		players.add(playerId);
	}

	/**
	 * Remove a player from a tick index.
	 */
	private removeFromTickIndex(
		index: Map<Tick, Set<PlayerId>>,
		tick: Tick,
		playerId: PlayerId,
	): void {
		const players = index.get(tick);
		if (players) {
			players.delete(playerId);
			if (players.size === 0) {
				index.delete(tick);
			}
		}
	}
}
