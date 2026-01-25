/**
 * Desync detection and management.
 *
 * Supports both host-authority mode (host collects and compares all hashes)
 * and peer mode (each peer compares independently).
 */

import {
	DesyncAuthority,
	type PlayerId,
	type Tick,
	Topology,
	asTick,
} from "../types.js";

/**
 * Configuration for the desync manager.
 */
export interface DesyncManagerConfig {
	/** Network topology */
	topology: Topology;
	/** Desync authority mode */
	desyncAuthority: DesyncAuthority;
	/** Hash interval for pruning calculations */
	hashInterval: number;
}

/**
 * Result when a desync is detected.
 */
export interface DesyncResult {
	/** The tick where desync was detected */
	tick: Tick;
	/** The player who desynced (in host-authority mode) */
	desyncedPlayerId: PlayerId;
	/** The host/reference hash */
	referenceHash: number;
	/** The player's actual hash */
	playerHash: number;
}

/**
 * Result of checking a hash in peer mode.
 * Returned only when a desync is detected (non-null means desync).
 */
export interface PeerDesyncResult {
	/** The tick where desync was detected */
	tick: Tick;
	/** Local hash */
	localHash: number;
	/** Remote hash */
	remoteHash: number;
	/** Remote player ID */
	remotePlayerId: PlayerId;
}

/**
 * Manages desync detection for both host-authority and peer modes.
 */
export class DesyncManager {
	private readonly topology: Topology;
	private readonly desyncAuthority: DesyncAuthority;
	private readonly hashInterval: number;

	/** Host-authority mode: hashes received from players, keyed by tick then playerId */
	private readonly receivedHashes: Map<Tick, Map<PlayerId, number>> = new Map();

	constructor(config: DesyncManagerConfig) {
		this.topology = config.topology;
		this.desyncAuthority = config.desyncAuthority;
		this.hashInterval = config.hashInterval;
	}

	/**
	 * Whether this is host-authority mode.
	 */
	get isHostAuthority(): boolean {
		// Only Mesh + Host authority uses host-authority mode
		// Star topology and Mesh + Peer use peer-based detection
		return (
			this.topology === Topology.Mesh &&
			this.desyncAuthority === DesyncAuthority.Host
		);
	}

	/**
	 * Record a hash from a player (host-authority mode).
	 *
	 * @param tick - The tick the hash is for
	 * @param playerId - The player who sent the hash
	 * @param hash - The hash value
	 */
	recordHash(tick: Tick, playerId: PlayerId, hash: number): void {
		let tickHashes = this.receivedHashes.get(tick);
		if (!tickHashes) {
			tickHashes = new Map();
			this.receivedHashes.set(tick, tickHashes);
		}
		tickHashes.set(playerId, hash);
	}

	/**
	 * Check if we have all hashes for a tick (host-authority mode).
	 *
	 * @param tick - The tick to check
	 * @param expectedPlayerCount - Number of players expected to submit hashes
	 * @returns true if all hashes have been received
	 */
	hasAllHashes(tick: Tick, expectedPlayerCount: number): boolean {
		const tickHashes = this.receivedHashes.get(tick);
		if (!tickHashes) {
			return false;
		}
		return tickHashes.size >= expectedPlayerCount;
	}

	/**
	 * Check for desyncs at a tick (host-authority mode).
	 * Compares all player hashes against the reference (host) hash.
	 *
	 * @param tick - The tick to check
	 * @param hostPlayerId - The host's player ID
	 * @returns Array of desync results for any desynced players
	 */
	checkDesyncs(tick: Tick, hostPlayerId: PlayerId): DesyncResult[] {
		const tickHashes = this.receivedHashes.get(tick);
		if (!tickHashes) {
			return [];
		}

		const hostHash = tickHashes.get(hostPlayerId);
		if (hostHash === undefined) {
			return [];
		}

		const desyncs: DesyncResult[] = [];
		for (const [playerId, playerHash] of tickHashes) {
			if (playerId === hostPlayerId) {
				continue;
			}
			if (playerHash !== hostHash) {
				desyncs.push({
					tick,
					desyncedPlayerId: playerId,
					referenceHash: hostHash,
					playerHash,
				});
			}
		}

		return desyncs;
	}

	/**
	 * Check for desync in peer mode (comparing local vs remote hash).
	 *
	 * @param tick - The tick to check
	 * @param localHash - Local hash value (or undefined if not available)
	 * @param remoteHash - Remote hash value
	 * @param remotePlayerId - Remote player's ID
	 * @returns Desync result if a desync is detected, null otherwise
	 */
	checkPeerDesync(
		tick: Tick,
		localHash: number | undefined,
		remoteHash: number,
		remotePlayerId: PlayerId,
	): PeerDesyncResult | null {
		if (localHash === undefined) {
			return null;
		}

		if (localHash !== remoteHash) {
			return {
				tick,
				localHash,
				remoteHash,
				remotePlayerId,
			};
		}

		return null;
	}

	/**
	 * Remove old hash entries to prevent memory growth.
	 *
	 * @param currentTick - Current simulation tick
	 */
	pruneOldHashes(currentTick: Tick): void {
		const pruneBelow = asTick(currentTick - this.hashInterval * 2);
		for (const tick of this.receivedHashes.keys()) {
			if (tick < pruneBelow) {
				this.receivedHashes.delete(tick);
			}
		}
	}

	/**
	 * Clear all stored hashes.
	 */
	clear(): void {
		this.receivedHashes.clear();
	}
}
