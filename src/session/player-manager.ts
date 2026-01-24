/**
 * Player state management for sessions.
 */

import {
	PlayerConnectionState,
	type PlayerId,
	type PlayerInfo,
	PlayerRole,
	type Tick,
} from "../types.js";

/**
 * Manages player state within a session.
 *
 * Centralizes player tracking, connection state, and lifecycle operations.
 */
export class PlayerManager implements Iterable<PlayerInfo> {
	private readonly players: Map<PlayerId, PlayerInfo> = new Map();

	/**
	 * Add a new player to the session.
	 *
	 * @param info - The player info to add
	 */
	addPlayer(info: PlayerInfo): void {
		this.players.set(info.id, info);
	}

	/**
	 * Remove a player from the session.
	 *
	 * @param playerId - The player ID to remove
	 * @returns The removed player info, or undefined if not found
	 */
	removePlayer(playerId: PlayerId): PlayerInfo | undefined {
		const player = this.players.get(playerId);
		if (player) {
			this.players.delete(playerId);
		}
		return player;
	}

	/**
	 * Get a player by ID.
	 *
	 * @param playerId - The player ID to look up
	 * @returns The player info, or undefined if not found
	 */
	getPlayer(playerId: PlayerId): PlayerInfo | undefined {
		return this.players.get(playerId);
	}

	/**
	 * Check if a player exists.
	 *
	 * @param playerId - The player ID to check
	 */
	hasPlayer(playerId: PlayerId): boolean {
		return this.players.has(playerId);
	}

	/**
	 * Mark a player as disconnected.
	 *
	 * @param playerId - The player ID to mark
	 * @param leaveTick - The tick when they disconnected (optional)
	 * @returns The updated player info, or undefined if not found
	 */
	markDisconnected(
		playerId: PlayerId,
		leaveTick?: Tick,
	): PlayerInfo | undefined {
		const player = this.players.get(playerId);
		if (player) {
			player.connectionState = PlayerConnectionState.Disconnected;
			if (leaveTick !== undefined) {
				player.leaveTick = leaveTick;
			}
		}
		return player;
	}

	/**
	 * Mark a player as connected.
	 *
	 * @param playerId - The player ID to mark
	 * @returns The updated player info, or undefined if not found
	 */
	markConnected(playerId: PlayerId): PlayerInfo | undefined {
		const player = this.players.get(playerId);
		if (player) {
			player.connectionState = PlayerConnectionState.Connected;
		}
		return player;
	}

	/**
	 * Get all players that are currently active (connected and role is Player).
	 *
	 * @returns Array of active player infos
	 */
	getActivePlayers(): PlayerInfo[] {
		return Array.from(this.players.values()).filter(
			(p) =>
				p.role === PlayerRole.Player &&
				p.connectionState === PlayerConnectionState.Connected,
		);
	}

	/**
	 * Get all connected players (any role).
	 *
	 * @returns Array of connected player infos
	 */
	getConnectedPlayers(): PlayerInfo[] {
		return Array.from(this.players.values()).filter(
			(p) => p.connectionState === PlayerConnectionState.Connected,
		);
	}

	/**
	 * Get the count of active players.
	 */
	getActivePlayerCount(): number {
		let count = 0;
		for (const player of this.players.values()) {
			if (
				player.role === PlayerRole.Player &&
				player.connectionState === PlayerConnectionState.Connected
			) {
				count++;
			}
		}
		return count;
	}

	/**
	 * Find the host player.
	 *
	 * @returns The host player info, or undefined if no host
	 */
	findHost(): PlayerInfo | undefined {
		for (const player of this.players.values()) {
			if (player.isHost) {
				return player;
			}
		}
		return undefined;
	}

	/**
	 * Get all player IDs.
	 */
	getPlayerIds(): PlayerId[] {
		return Array.from(this.players.keys());
	}

	/**
	 * Get all player infos as an array.
	 */
	getAllPlayers(): PlayerInfo[] {
		return Array.from(this.players.values());
	}

	/**
	 * Clear all players.
	 */
	clear(): void {
		this.players.clear();
	}

	/**
	 * Number of players in the session.
	 */
	get size(): number {
		return this.players.size;
	}

	/**
	 * Iterate over all players.
	 */
	[Symbol.iterator](): Iterator<PlayerInfo> {
		return this.players.values();
	}

	/**
	 * Get players as a readonly map (for compatibility with existing code).
	 */
	asReadonlyMap(): ReadonlyMap<PlayerId, PlayerInfo> {
		return this.players;
	}
}
