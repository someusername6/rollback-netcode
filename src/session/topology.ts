/**
 * Network topology handling for multiplayer sessions.
 *
 * Topology determines how messages are routed between peers:
 * - Star: All messages go through the host
 * - Mesh: Peers send directly to each other
 */

import { Topology as TopologyType } from "../types.js";

/**
 * Interface for topology implementations.
 * Handles message routing decisions based on network topology.
 */
export interface TopologyStrategy {
	/** The topology type */
	readonly type: TopologyType;

	/**
	 * Determine if input should be relayed to other peers.
	 *
	 * @param fromPeerId - The peer that sent the input
	 * @param isHost - Whether the current session is the host
	 * @returns true if the input should be relayed
	 */
	shouldRelayInput(fromPeerId: string, isHost: boolean): boolean;

	/**
	 * Get the peers to relay a message to.
	 *
	 * @param fromPeerId - The peer that sent the original message
	 * @param allPeers - Set of all connected peer IDs
	 * @returns Array of peer IDs to relay to
	 */
	getRelayTargets(fromPeerId: string, allPeers: ReadonlySet<string>): string[];
}

/**
 * Star topology: all messages go through the host.
 *
 * In star topology:
 * - Clients send inputs to the host
 * - Host relays inputs to all other clients
 * - This reduces the number of connections but increases latency slightly
 */
export class StarTopology implements TopologyStrategy {
	readonly type: TopologyType = TopologyType.Star;

	shouldRelayInput(fromPeerId: string, isHost: boolean): boolean {
		// Only the host relays inputs in star topology
		return isHost;
	}

	getRelayTargets(fromPeerId: string, allPeers: ReadonlySet<string>): string[] {
		// Relay to all peers except the original sender
		const targets: string[] = [];
		for (const peerId of allPeers) {
			if (peerId !== fromPeerId) {
				targets.push(peerId);
			}
		}
		return targets;
	}
}

/**
 * Mesh topology: peers send directly to each other.
 *
 * In mesh topology:
 * - Every peer sends inputs to every other peer
 * - No relaying is needed
 * - Lower latency but more connections required
 */
export class MeshTopology implements TopologyStrategy {
	readonly type: TopologyType = TopologyType.Mesh;

	shouldRelayInput(_fromPeerId: string, _isHost: boolean): boolean {
		// No relaying in mesh topology - peers communicate directly
		return false;
	}

	getRelayTargets(
		_fromPeerId: string,
		_allPeers: ReadonlySet<string>,
	): string[] {
		// No relay targets in mesh topology
		return [];
	}
}

/**
 * Create a topology strategy based on the topology type.
 *
 * @param topology - The topology type
 * @returns The corresponding topology strategy
 */
export function createTopologyStrategy(
	topology: TopologyType,
): TopologyStrategy {
	switch (topology) {
		case TopologyType.Star:
			return new StarTopology();
		case TopologyType.Mesh:
			return new MeshTopology();
		default: {
			// TypeScript exhaustiveness check
			const _exhaustiveCheck: never = topology;
			throw new Error(`Unknown topology: ${_exhaustiveCheck}`);
		}
	}
}
