/**
 * Local/in-memory transport for testing.
 *
 * Allows connecting multiple LocalTransport instances together
 * with simulated network conditions (latency, jitter, packet loss).
 */

import type { TransportAdapter } from "./adapter.js";

/**
 * Configuration for network simulation.
 */
export interface LocalTransportConfig {
	/**
	 * One-way latency in milliseconds.
	 * @default 0
	 */
	latency?: number;

	/**
	 * Random variation in latency (jitter) in milliseconds.
	 * @default 0
	 */
	jitter?: number;

	/**
	 * Probability of packet loss (0-1).
	 * @default 0
	 */
	packetLoss?: number;

	/**
	 * Whether to use deterministic mode (seeded random).
	 * @default false
	 */
	deterministic?: boolean;

	/**
	 * Seed for deterministic mode.
	 * @default 12345
	 */
	seed?: number;
}

/**
 * A pending message waiting to be delivered.
 */
interface PendingMessage {
	/** Target peer ID */
	targetPeerId: string;
	/** Message data */
	message: Uint8Array;
	/** Simulated time when this message should be delivered */
	deliverAt: number;
	/** Whether this is a reliable message */
	reliable: boolean;
}

/**
 * Simple seeded random number generator for deterministic testing.
 */
class SeededRandom {
	private seed: number;

	constructor(seed: number) {
		this.seed = seed;
	}

	/**
	 * Returns a random number between 0 and 1.
	 */
	next(): number {
		// Simple LCG
		this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
		return this.seed / 0xffffffff;
	}
}

/**
 * In-memory transport for testing.
 *
 * Features:
 * - Connect multiple LocalTransport instances together
 * - Simulated network conditions (latency, jitter, packet loss)
 * - Deterministic mode for reproducible tests
 * - Manual time control via tick() method
 */
export class LocalTransport implements TransportAdapter {
	public onMessage: ((peerId: string, message: Uint8Array) => void) | null =
		null;
	public onConnect: ((peerId: string) => void) | null = null;
	public onDisconnect: ((peerId: string) => void) | null = null;

	private readonly _connectedPeers: Set<string> = new Set();
	private readonly linkedTransports: Map<string, LocalTransport> = new Map();
	private readonly pendingMessages: PendingMessage[] = [];
	private readonly config: Required<LocalTransportConfig>;
	private readonly random: SeededRandom | null;
	private currentTime = 0;

	/**
	 * Create a new LocalTransport.
	 *
	 * @param localPeerId - Unique ID for this transport
	 * @param config - Network simulation configuration
	 */
	constructor(
		public readonly localPeerId: string,
		config?: LocalTransportConfig,
	) {
		this.config = {
			latency: config?.latency ?? 0,
			jitter: config?.jitter ?? 0,
			packetLoss: config?.packetLoss ?? 0,
			deterministic: config?.deterministic ?? false,
			seed: config?.seed ?? 12345,
		};

		this.random = this.config.deterministic
			? new SeededRandom(this.config.seed)
			: null;
	}

	/**
	 * Get the set of connected peer IDs.
	 */
	get connectedPeers(): ReadonlySet<string> {
		return this._connectedPeers;
	}

	/**
	 * Link two LocalTransport instances together.
	 * Creates a bidirectional connection.
	 *
	 * @param a - First transport
	 * @param b - Second transport
	 */
	static link(a: LocalTransport, b: LocalTransport): void {
		a.linkedTransports.set(b.localPeerId, b);
		b.linkedTransports.set(a.localPeerId, a);
	}

	/**
	 * Unlink two LocalTransport instances.
	 *
	 * @param a - First transport
	 * @param b - Second transport
	 */
	static unlink(a: LocalTransport, b: LocalTransport): void {
		a.linkedTransports.delete(b.localPeerId);
		b.linkedTransports.delete(a.localPeerId);
	}

	/**
	 * Connect to a peer.
	 * The peer must be linked via LocalTransport.link().
	 */
	async connect(peerId: string): Promise<void> {
		const peer = this.linkedTransports.get(peerId);
		if (!peer) {
			throw new Error(`Peer ${peerId} is not linked`);
		}

		if (this._connectedPeers.has(peerId)) {
			return; // Already connected
		}

		// Add to connected peers on both sides
		this._connectedPeers.add(peerId);
		peer._connectedPeers.add(this.localPeerId);

		// Notify both sides
		this.onConnect?.(peerId);
		peer.onConnect?.(this.localPeerId);
	}

	/**
	 * Disconnect from a peer.
	 */
	disconnect(peerId: string): void {
		if (!this._connectedPeers.has(peerId)) {
			return;
		}

		const peer = this.linkedTransports.get(peerId);

		// Remove from connected peers on both sides
		this._connectedPeers.delete(peerId);
		if (peer) {
			peer._connectedPeers.delete(this.localPeerId);
			peer.onDisconnect?.(this.localPeerId);
		}

		this.onDisconnect?.(peerId);
	}

	/**
	 * Disconnect from all peers.
	 */
	disconnectAll(): void {
		const peers = Array.from(this._connectedPeers);
		for (const peerId of peers) {
			this.disconnect(peerId);
		}
	}

	/**
	 * Send a message to a specific peer.
	 */
	send(peerId: string, message: Uint8Array, reliable: boolean): void {
		if (!this._connectedPeers.has(peerId)) {
			return; // Not connected, silently drop
		}

		// Check for packet loss (unreliable only)
		if (!reliable && this.shouldDropPacket()) {
			return;
		}

		// Calculate delivery time with latency and jitter
		const deliverAt = this.currentTime + this.calculateDelay();

		// Copy message to prevent external mutation
		const messageCopy = new Uint8Array(message.length);
		messageCopy.set(message);

		this.pendingMessages.push({
			targetPeerId: peerId,
			message: messageCopy,
			deliverAt,
			reliable,
		});

		// Sort by delivery time (stable sort preserves order for same time)
		this.pendingMessages.sort((a, b) => a.deliverAt - b.deliverAt);
	}

	/**
	 * Broadcast a message to all connected peers.
	 */
	broadcast(message: Uint8Array, reliable: boolean): void {
		for (const peerId of this._connectedPeers) {
			this.send(peerId, message, reliable);
		}
	}

	/**
	 * Process all pending messages immediately, ignoring simulated delay.
	 * Useful for synchronous tests.
	 */
	flush(): void {
		while (this.pendingMessages.length > 0) {
			const pending = this.pendingMessages.shift();
			if (pending !== undefined) {
				this.deliverMessage(pending);
			}
		}
	}

	/**
	 * Advance simulated time and deliver any messages due.
	 *
	 * @param deltaMs - Time to advance in milliseconds
	 */
	tick(deltaMs: number): void {
		this.currentTime += deltaMs;
		this.deliverDueMessages();
	}

	/**
	 * Get the current simulated time.
	 */
	getCurrentTime(): number {
		return this.currentTime;
	}

	/**
	 * Set the current simulated time.
	 */
	setCurrentTime(time: number): void {
		this.currentTime = time;
		this.deliverDueMessages();
	}

	/**
	 * Get the number of pending messages.
	 */
	getPendingMessageCount(): number {
		return this.pendingMessages.length;
	}

	/**
	 * Deliver all messages that are due based on current time.
	 */
	private deliverDueMessages(): void {
		while (this.pendingMessages.length > 0) {
			const first = this.pendingMessages[0];
			if (first === undefined || first.deliverAt > this.currentTime) {
				break;
			}
			this.pendingMessages.shift();
			this.deliverMessage(first);
		}
	}

	/**
	 * Deliver a single message to its target peer.
	 */
	private deliverMessage(pending: PendingMessage): void {
		const peer = this.linkedTransports.get(pending.targetPeerId);
		if (peer?._connectedPeers.has(this.localPeerId)) {
			peer.onMessage?.(this.localPeerId, pending.message);
		}
	}

	/**
	 * Calculate delay for a message based on latency and jitter.
	 */
	private calculateDelay(): number {
		let delay = this.config.latency;

		if (this.config.jitter > 0) {
			const jitterAmount = this.getRandomValue() * this.config.jitter * 2;
			delay += jitterAmount - this.config.jitter;
		}

		return Math.max(0, delay);
	}

	/**
	 * Determine if a packet should be dropped.
	 */
	private shouldDropPacket(): boolean {
		if (this.config.packetLoss <= 0) {
			return false;
		}
		return this.getRandomValue() < this.config.packetLoss;
	}

	/**
	 * Get a random value between 0 and 1.
	 */
	private getRandomValue(): number {
		if (this.random) {
			return this.random.next();
		}
		return Math.random();
	}
}

/**
 * Create a group of linked LocalTransport instances.
 *
 * @param peerIds - Array of peer IDs to create
 * @param config - Optional shared configuration
 * @returns Map of peer ID to LocalTransport
 */
export function createLocalTransportGroup(
	peerIds: string[],
	config?: LocalTransportConfig,
): Map<string, LocalTransport> {
	const transports = new Map<string, LocalTransport>();

	// Create all transports
	for (const peerId of peerIds) {
		transports.set(peerId, new LocalTransport(peerId, config));
	}

	// Link all transports together (full mesh)
	const transportArray = Array.from(transports.values());
	for (let i = 0; i < transportArray.length; i++) {
		for (let j = i + 1; j < transportArray.length; j++) {
			LocalTransport.link(transportArray[i]!, transportArray[j]!);
		}
	}

	return transports;
}
