/**
 * Transport adapter interface for network communication.
 *
 * This interface abstracts the underlying transport mechanism (WebRTC, WebSocket, etc.)
 * allowing the rollback engine to work with any transport implementation.
 */

/**
 * Connection quality metrics for a peer.
 */
export interface ConnectionMetrics {
	/** Round-trip time in milliseconds */
	rtt: number;

	/** RTT variance (jitter) in milliseconds */
	jitter: number;

	/** Estimated packet loss rate (0-1) */
	packetLoss: number;

	/** Timestamp when metrics were last updated */
	lastUpdated: number;
}

/**
 * Interface that all transport implementations must follow.
 */
export interface TransportAdapter {
	/**
	 * Connect to a peer.
	 *
	 * @param peerId - Unique identifier of the peer to connect to
	 * @returns Promise that resolves when connection is established
	 */
	connect(peerId: string): Promise<void>;

	/**
	 * Disconnect from a peer.
	 *
	 * @param peerId - Unique identifier of the peer to disconnect from
	 */
	disconnect(peerId: string): void;

	/**
	 * Disconnect from all peers.
	 */
	disconnectAll(): void;

	/**
	 * Send a message to a specific peer.
	 *
	 * @param peerId - Unique identifier of the peer to send to
	 * @param message - The message data to send
	 * @param reliable - Whether to send reliably (ordered, guaranteed delivery)
	 */
	send(peerId: string, message: Uint8Array, reliable: boolean): void;

	/**
	 * Broadcast a message to all connected peers.
	 *
	 * @param message - The message data to send
	 * @param reliable - Whether to send reliably
	 */
	broadcast(message: Uint8Array, reliable: boolean): void;

	/**
	 * Callback invoked when a message is received from a peer.
	 */
	onMessage: ((peerId: string, message: Uint8Array) => void) | null;

	/**
	 * Callback invoked when a peer connects.
	 */
	onConnect: ((peerId: string) => void) | null;

	/**
	 * Callback invoked when a peer disconnects.
	 */
	onDisconnect: ((peerId: string) => void) | null;

	/**
	 * Callback invoked when a transport error occurs.
	 * This allows the application layer to be notified of network issues
	 * that might not cause immediate disconnection.
	 *
	 * @param peerId - The peer involved (if applicable, null for general errors)
	 * @param error - The error that occurred
	 * @param context - Additional context about where the error occurred
	 */
	onError?:
		| ((peerId: string | null, error: Error, context: string) => void)
		| null;

	/**
	 * Set of currently connected peer IDs.
	 */
	readonly connectedPeers: ReadonlySet<string>;

	/**
	 * The local peer's ID.
	 */
	readonly localPeerId: string;

	/**
	 * Get connection quality metrics for a peer.
	 *
	 * @param peerId - The peer's ID
	 * @returns Connection metrics or null if not available
	 */
	getConnectionMetrics?(peerId: string): ConnectionMetrics | null;

	/**
	 * Clean up resources when the transport is no longer needed.
	 * Optional - implement if your transport has resources that need cleanup.
	 */
	dispose?(): void;
}
