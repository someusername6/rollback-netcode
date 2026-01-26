/**
 * WebRTC transport implementation.
 *
 * Provides peer-to-peer communication using WebRTC DataChannels.
 * Uses dual channels: reliable (ordered, guaranteed) and unreliable (best-effort).
 *
 * This implementation is signaling-agnostic - you must provide your own signaling
 * mechanism (WebSocket, HTTP, etc.) to exchange SDP offers/answers and ICE candidates.
 */

import type { ConnectionMetrics, TransportAdapter } from "./adapter.js";

/** Delay in ms before treating a disconnected state as failed */
const DISCONNECT_DETECTION_DELAY_MS = 5000;

/** Default maximum reconnection attempts */
const DEFAULT_MAX_RECONNECT_ATTEMPTS = 3;

/** Default delay between reconnection attempts in ms */
const DEFAULT_RECONNECT_DELAY_MS = 1000;

/** Maximum delay between reconnection attempts in ms */
const MAX_RECONNECT_DELAY_MS = 30000;

/** Jitter factor for reconnection delay (0.2 = 20% random variance) */
const RECONNECT_JITTER_FACTOR = 0.2;

/** Number of RTT samples to keep for jitter calculation */
const RTT_SAMPLE_COUNT = 10;

/** Default keepalive interval in milliseconds */
const DEFAULT_KEEPALIVE_INTERVAL_MS = 5000;

/** Maximum time without response before considering peer dead (in ms) */
const DEFAULT_KEEPALIVE_TIMEOUT_MS = 15000;

/** Default timeout for connection establishment (in ms) */
const DEFAULT_CONNECTION_TIMEOUT_MS = 30000;

/**
 * Configuration for the WebRTC transport.
 */
export interface WebRTCTransportConfig {
	/** RTCPeerConnection configuration (STUN/TURN servers, etc.) */
	rtcConfiguration?: RTCConfiguration;

	/** Configuration for the reliable data channel */
	reliableChannelConfig?: RTCDataChannelInit;

	/** Configuration for the unreliable data channel */
	unreliableChannelConfig?: RTCDataChannelInit;

	/** Maximum reconnection attempts before giving up */
	maxReconnectAttempts?: number;

	/** Delay between reconnection attempts in milliseconds */
	reconnectDelay?: number;

	/** Interval for sending keepalive pings (0 to disable, default: 5000ms) */
	keepaliveInterval?: number;

	/** Time without response before considering peer dead (default: 15000ms) */
	keepaliveTimeout?: number;

	/** Timeout for connection establishment (default: 30000ms) */
	connectionTimeout?: number;
}

/**
 * A signaling message to be sent to a remote peer.
 * This is a discriminated union - check the `type` field to determine the payload.
 */
export type SignalMessage =
	| { type: "description"; description: RTCSessionDescriptionInit }
	| { type: "candidate"; candidate: RTCIceCandidateInit };

/**
 * Callbacks for signaling integration.
 * You must implement this to handle WebRTC signaling exchange.
 *
 * The unified `onSignal` callback receives all signaling messages (SDP and ICE),
 * making it easier to route through a single signaling path.
 */
export interface SignalingCallbacks {
	/**
	 * Called when a signaling message needs to be sent to a peer.
	 * The message should be serialized and sent through your signaling server.
	 *
	 * @param peerId - The target peer's ID
	 * @param signal - The signal message (either a description or candidate)
	 *
	 * @example
	 * ```typescript
	 * transport.setSignalingCallbacks({
	 *   onSignal: (peerId, signal) => {
	 *     websocket.send(JSON.stringify({ to: peerId, signal }));
	 *   }
	 * });
	 *
	 * // On the receiving side, parse and call:
	 * if (signal.type === 'description') {
	 *   transport.handleRemoteDescription(fromPeerId, signal.description);
	 * } else {
	 *   transport.handleRemoteCandidate(fromPeerId, signal.candidate);
	 * }
	 * ```
	 */
	onSignal: (peerId: string, signal: SignalMessage) => void;
}

/**
 * Connection state for a single peer.
 */
interface PeerConnection {
	/** The RTCPeerConnection instance */
	connection: RTCPeerConnection;

	/** Reliable data channel (ordered, guaranteed delivery) */
	reliableChannel: RTCDataChannel | null;

	/** Unreliable data channel (unordered, best-effort) */
	unreliableChannel: RTCDataChannel | null;

	/** Whether this peer initiated the connection (created the offer) */
	isInitiator: boolean;

	/** Number of reconnection attempts */
	reconnectAttempts: number;

	/** Whether the connection is fully established (both channels open) */
	isConnected: boolean;

	/** Promise that resolves when connection is ready */
	connectionPromise: Promise<void> | null;

	/** Resolver for connection promise */
	connectionResolve: (() => void) | null;

	/** Rejector for connection promise */
	connectionReject: ((error: Error) => void) | null;

	/** Connection timeout timer */
	connectionTimer: ReturnType<typeof setTimeout> | null;

	/** Disconnect detection timer (waits before declaring disconnect) */
	disconnectTimer: ReturnType<typeof setTimeout> | null;

	/** Reconnection attempt timer */
	reconnectTimer: ReturnType<typeof setTimeout> | null;
}

/**
 * Internal metrics tracking data for a peer.
 */
interface PeerMetricsData {
	/** Recent RTT samples for averaging and jitter calculation */
	rttSamples: number[];

	/** Current average RTT */
	rtt: number;

	/** Current jitter (standard deviation of RTT) */
	jitter: number;

	/** Estimated packet loss rate */
	packetLoss: number;

	/** Last time metrics were updated */
	lastUpdated: number;

	/** Pending ping timestamps (timestamp -> sentAt) */
	pendingPings: Map<number, number>;

	/** Last time we received any response from this peer */
	lastResponseTime: number;
}

/**
 * Default RTCPeerConnection configuration.
 */
const DEFAULT_RTC_CONFIG: RTCConfiguration = {
	iceServers: [
		{ urls: "stun:stun.l.google.com:19302" },
		{ urls: "stun:stun1.l.google.com:19302" },
	],
};

/**
 * Default reliable channel configuration.
 */
const DEFAULT_RELIABLE_CHANNEL_CONFIG: RTCDataChannelInit = {
	ordered: true,
};

/**
 * Default unreliable channel configuration.
 */
const DEFAULT_UNRELIABLE_CHANNEL_CONFIG: RTCDataChannelInit = {
	ordered: false,
	maxRetransmits: 0,
};

/**
 * WebRTC transport implementation.
 */
export class WebRTCTransport implements TransportAdapter {
	public readonly localPeerId: string;

	private readonly rtcConfig: RTCConfiguration;
	private readonly reliableChannelConfig: RTCDataChannelInit;
	private readonly unreliableChannelConfig: RTCDataChannelInit;
	private readonly maxReconnectAttempts: number;
	private readonly reconnectDelay: number;
	private readonly keepaliveInterval: number;
	private readonly keepaliveTimeout: number;
	private readonly connectionTimeout: number;

	private readonly peers: Map<string, PeerConnection> = new Map();
	private readonly _connectedPeers: Set<string> = new Set();
	private readonly peerMetrics: Map<string, PeerMetricsData> = new Map();

	private signalingCallbacks: SignalingCallbacks | null = null;
	private keepaliveTimer: ReturnType<typeof setInterval> | null = null;

	/** Callback for keepalive ping - set by Session to send Ping messages */
	onKeepalivePing: ((peerId: string) => void) | null = null;

	onMessage: ((peerId: string, message: Uint8Array) => void) | null = null;
	onConnect: ((peerId: string) => void) | null = null;
	onDisconnect: ((peerId: string) => void) | null = null;
	onError:
		| ((peerId: string | null, error: Error, context: string) => void)
		| null = null;

	/**
	 * Create a new WebRTC transport.
	 *
	 * @param localPeerId - Unique identifier for this peer
	 * @param config - Optional configuration
	 */
	constructor(localPeerId: string, config: WebRTCTransportConfig = {}) {
		this.localPeerId = localPeerId;

		this.rtcConfig = config.rtcConfiguration ?? DEFAULT_RTC_CONFIG;
		this.reliableChannelConfig =
			config.reliableChannelConfig ?? DEFAULT_RELIABLE_CHANNEL_CONFIG;
		this.unreliableChannelConfig =
			config.unreliableChannelConfig ?? DEFAULT_UNRELIABLE_CHANNEL_CONFIG;
		this.maxReconnectAttempts =
			config.maxReconnectAttempts ?? DEFAULT_MAX_RECONNECT_ATTEMPTS;
		this.reconnectDelay = config.reconnectDelay ?? DEFAULT_RECONNECT_DELAY_MS;
		this.keepaliveInterval =
			config.keepaliveInterval ?? DEFAULT_KEEPALIVE_INTERVAL_MS;
		this.keepaliveTimeout =
			config.keepaliveTimeout ?? DEFAULT_KEEPALIVE_TIMEOUT_MS;
		this.connectionTimeout =
			config.connectionTimeout ?? DEFAULT_CONNECTION_TIMEOUT_MS;

		// Note: Keepalive timer is started when first peer connects, not here
	}

	/**
	 * Set of currently connected peer IDs.
	 */
	get connectedPeers(): ReadonlySet<string> {
		return this._connectedPeers;
	}

	/**
	 * Set signaling callbacks for SDP and ICE candidate exchange.
	 * Must be called before initiating or accepting connections.
	 *
	 * @param callbacks - Signaling callbacks
	 */
	setSignalingCallbacks(callbacks: SignalingCallbacks): void {
		this.signalingCallbacks = callbacks;
	}

	/**
	 * Connect to a peer by creating an offer.
	 * This initiates the WebRTC connection handshake.
	 *
	 * @param peerId - The peer's ID
	 */
	async connect(peerId: string): Promise<void> {
		if (this._connectedPeers.has(peerId)) {
			return; // Already connected
		}

		const peer = this.getOrCreatePeer(peerId, true);

		if (peer.connectionPromise) {
			return peer.connectionPromise;
		}

		peer.connectionPromise = new Promise((resolve, reject) => {
			peer.connectionResolve = resolve;
			peer.connectionReject = reject;

			// Set connection timeout
			if (this.connectionTimeout > 0) {
				peer.connectionTimer = setTimeout(() => {
					if (!peer.isConnected && peer.connectionReject) {
						peer.connectionReject(
							new Error(`Connection to ${peerId} timed out`),
						);
						peer.connectionResolve = null;
						peer.connectionReject = null;
						peer.connectionTimer = null;
						this.cleanupPeer(peerId, peer);
					}
				}, this.connectionTimeout);
			}
		});

		try {
			await this.createOffer(peerId);
		} catch (error) {
			// If offer creation fails, reject the connection promise and clean up
			if (peer.connectionReject) {
				peer.connectionReject(
					error instanceof Error ? error : new Error(String(error)),
				);
				peer.connectionResolve = null;
				peer.connectionReject = null;
			}
			if (peer.connectionTimer) {
				clearTimeout(peer.connectionTimer);
				peer.connectionTimer = null;
			}
			this.cleanupPeer(peerId, peer);
			// Don't re-throw - the promise rejection is sufficient
		}

		return peer.connectionPromise;
	}

	/**
	 * Create and send an offer to a peer.
	 *
	 * @param peerId - The peer's ID
	 */
	async createOffer(peerId: string): Promise<void> {
		if (!this.signalingCallbacks) {
			throw new Error("Signaling callbacks not set");
		}

		const peer = this.getOrCreatePeer(peerId, true);

		// Create data channels (initiator creates them)
		peer.reliableChannel = peer.connection.createDataChannel(
			"reliable",
			this.reliableChannelConfig,
		);
		peer.unreliableChannel = peer.connection.createDataChannel(
			"unreliable",
			this.unreliableChannelConfig,
		);

		this.setupDataChannel(peerId, peer.reliableChannel, true);
		this.setupDataChannel(peerId, peer.unreliableChannel, false);

		// Create and set local description
		const offer = await peer.connection.createOffer();
		await peer.connection.setLocalDescription(offer);

		// Send offer through signaling
		this.signalingCallbacks.onSignal(peerId, {
			type: "description",
			description: offer,
		});
	}

	/**
	 * Handle a remote SDP description (offer or answer).
	 *
	 * @param peerId - The peer's ID
	 * @param description - The SDP description
	 */
	async handleRemoteDescription(
		peerId: string,
		description: RTCSessionDescriptionInit,
	): Promise<void> {
		if (!this.signalingCallbacks) {
			throw new Error("Signaling callbacks not set");
		}

		const isOffer = description.type === "offer";
		const peer = this.getOrCreatePeer(peerId, !isOffer);

		await peer.connection.setRemoteDescription(description);

		// If we received an offer, create and send an answer
		if (isOffer) {
			const answer = await peer.connection.createAnswer();
			await peer.connection.setLocalDescription(answer);

			this.signalingCallbacks.onSignal(peerId, {
				type: "description",
				description: answer,
			});
		}
	}

	/**
	 * Handle a remote ICE candidate.
	 *
	 * @param peerId - The peer's ID
	 * @param candidate - The ICE candidate
	 */
	async handleRemoteCandidate(
		peerId: string,
		candidate: RTCIceCandidateInit,
	): Promise<void> {
		const peer = this.peers.get(peerId);
		if (!peer) {
			return; // Unknown peer, ignore
		}

		try {
			await peer.connection.addIceCandidate(candidate);
		} catch (error) {
			const err = error instanceof Error ? error : new Error(String(error));
			console.warn(`Failed to add ICE candidate for peer ${peerId}:`, error);
			this.onError?.(peerId, err, "addIceCandidate");
		}
	}

	/**
	 * Disconnect from a peer.
	 *
	 * @param peerId - The peer's ID
	 */
	disconnect(peerId: string): void {
		const peer = this.peers.get(peerId);
		if (!peer) {
			return;
		}

		this.cleanupPeer(peerId, peer);
	}

	/**
	 * Disconnect from all peers.
	 */
	disconnectAll(): void {
		for (const peerId of [...this.peers.keys()]) {
			this.disconnect(peerId);
		}
		this.stopKeepaliveTimer();
	}

	/**
	 * Destroy the transport and clean up all resources.
	 */
	destroy(): void {
		this.disconnectAll();
		this.stopKeepaliveTimer();
		this.peerMetrics.clear();
	}

	/**
	 * Send a message to a peer.
	 *
	 * @param peerId - The peer's ID
	 * @param message - The message data
	 * @param reliable - Whether to use the reliable channel
	 */
	send(peerId: string, message: Uint8Array, reliable: boolean): void {
		const peer = this.peers.get(peerId);
		if (!peer || !peer.isConnected) {
			return; // Not connected
		}

		const channel = reliable ? peer.reliableChannel : peer.unreliableChannel;
		if (!channel || channel.readyState !== "open") {
			return;
		}

		try {
			// RTCDataChannel.send accepts Uint8Array at runtime, but TypeScript's
			// strict types complain about SharedArrayBuffer. Cast to satisfy types.
			channel.send(message as unknown as ArrayBufferView<ArrayBuffer>);
		} catch (error) {
			const err = error instanceof Error ? error : new Error(String(error));
			console.warn(`Failed to send message to peer ${peerId}:`, error);
			this.onError?.(peerId, err, "send");
		}
	}

	/**
	 * Broadcast a message to all connected peers.
	 *
	 * @param message - The message data
	 * @param reliable - Whether to use the reliable channel
	 */
	broadcast(message: Uint8Array, reliable: boolean): void {
		for (const peerId of this._connectedPeers) {
			this.send(peerId, message, reliable);
		}
	}

	/**
	 * Get connection statistics for a peer.
	 *
	 * @param peerId - The peer's ID
	 * @returns Connection stats or null if not connected
	 */
	async getConnectionStats(peerId: string): Promise<RTCStatsReport | null> {
		const peer = this.peers.get(peerId);
		if (!peer) {
			return null;
		}

		return peer.connection.getStats();
	}

	/**
	 * Get or create a peer connection.
	 */
	private getOrCreatePeer(
		peerId: string,
		isInitiator: boolean,
	): PeerConnection {
		let peer = this.peers.get(peerId);
		if (peer) {
			return peer;
		}

		const connection = new RTCPeerConnection(this.rtcConfig);

		peer = {
			connection,
			reliableChannel: null,
			unreliableChannel: null,
			isInitiator,
			reconnectAttempts: 0,
			isConnected: false,
			connectionPromise: null,
			connectionResolve: null,
			connectionReject: null,
			connectionTimer: null,
			disconnectTimer: null,
			reconnectTimer: null,
		};

		this.setupPeerConnection(peerId, peer);
		this.peers.set(peerId, peer);

		return peer;
	}

	/**
	 * Set up event handlers for a peer connection.
	 */
	private setupPeerConnection(peerId: string, peer: PeerConnection): void {
		const connection = peer.connection;

		// Handle ICE candidates
		connection.onicecandidate = (event) => {
			if (event.candidate && this.signalingCallbacks) {
				this.signalingCallbacks.onSignal(peerId, {
					type: "candidate",
					candidate: event.candidate,
				});
			}
		};

		// Handle ICE connection state changes
		connection.oniceconnectionstatechange = () => {
			const state = connection.iceConnectionState;

			if (state === "failed") {
				this.handleConnectionFailure(peerId, peer);
			} else if (state === "disconnected") {
				// Might recover, wait a bit before declaring disconnection
				// Clear any existing disconnect timer
				if (peer.disconnectTimer) {
					clearTimeout(peer.disconnectTimer);
				}
				peer.disconnectTimer = setTimeout(() => {
					peer.disconnectTimer = null;
					if (connection.iceConnectionState === "disconnected") {
						this.handleConnectionFailure(peerId, peer);
					}
				}, DISCONNECT_DETECTION_DELAY_MS);
			} else if (state === "closed") {
				this.cleanupPeer(peerId, peer);
			}
		};

		// Handle data channels (for non-initiator)
		connection.ondatachannel = (event) => {
			const channel = event.channel;
			const isReliable = channel.label === "reliable";

			if (isReliable) {
				peer.reliableChannel = channel;
			} else {
				peer.unreliableChannel = channel;
			}

			this.setupDataChannel(peerId, channel, isReliable);
		};
	}

	/**
	 * Set up event handlers for a data channel.
	 */
	private setupDataChannel(
		peerId: string,
		channel: RTCDataChannel,
		isReliable: boolean,
	): void {
		channel.binaryType = "arraybuffer";

		channel.onopen = () => {
			this.checkConnectionReady(peerId);
		};

		channel.onclose = () => {
			const peer = this.peers.get(peerId);
			if (peer?.isConnected) {
				this.handleConnectionFailure(peerId, peer);
			}
		};

		channel.onerror = (event) => {
			const channelType = isReliable ? "reliable" : "unreliable";
			console.warn(
				`DataChannel error for peer ${peerId} (${channelType}):`,
				event,
			);
			// RTCErrorEvent has an error property, but the type might be just Event
			const rtcEvent = event as RTCErrorEvent;
			const error =
				rtcEvent.error ?? new Error(`DataChannel error (${channelType})`);
			this.onError?.(peerId, error, `dataChannel.${channelType}`);
		};

		channel.onmessage = (event) => {
			if (this.onMessage && event.data instanceof ArrayBuffer) {
				this.onMessage(peerId, new Uint8Array(event.data));
			}
		};
	}

	/**
	 * Check if both data channels are ready and mark connection as established.
	 */
	private checkConnectionReady(peerId: string): void {
		const peer = this.peers.get(peerId);
		if (!peer) {
			return;
		}

		const reliableReady = peer.reliableChannel?.readyState === "open";
		const unreliableReady = peer.unreliableChannel?.readyState === "open";

		if (reliableReady && unreliableReady && !peer.isConnected) {
			peer.isConnected = true;
			peer.reconnectAttempts = 0;

			// Start keepalive timer when first peer connects
			const wasEmpty = this._connectedPeers.size === 0;
			this._connectedPeers.add(peerId);
			if (wasEmpty && this.keepaliveInterval > 0) {
				this.startKeepaliveTimer();
			}

			// Clear connection timeout
			if (peer.connectionTimer) {
				clearTimeout(peer.connectionTimer);
				peer.connectionTimer = null;
			}

			// Resolve connection promise
			if (peer.connectionResolve) {
				peer.connectionResolve();
				peer.connectionResolve = null;
				peer.connectionReject = null;
			}

			this.onConnect?.(peerId);
		}
	}

	/**
	 * Handle a connection failure.
	 */
	private handleConnectionFailure(peerId: string, peer: PeerConnection): void {
		const wasConnected = peer.isConnected;
		peer.isConnected = false;
		this._connectedPeers.delete(peerId);

		// Stop keepalive timer when last peer disconnects
		if (this._connectedPeers.size === 0) {
			this.stopKeepaliveTimer();
		}

		// Reject connection promise if pending
		if (peer.connectionReject) {
			peer.connectionReject(new Error("Connection failed"));
			peer.connectionResolve = null;
			peer.connectionReject = null;
		}

		// Notify disconnection
		if (wasConnected) {
			this.onDisconnect?.(peerId);
		}

		// Attempt reconnection if we were the initiator
		if (
			peer.isInitiator &&
			peer.reconnectAttempts < this.maxReconnectAttempts
		) {
			peer.reconnectAttempts++;
			const delay = this.getReconnectDelayWithJitter(peer.reconnectAttempts);
			// Clear any existing reconnect timer
			if (peer.reconnectTimer) {
				clearTimeout(peer.reconnectTimer);
			}
			peer.reconnectTimer = setTimeout(() => {
				peer.reconnectTimer = null;
				this.attemptReconnect(peerId);
			}, delay);
		} else {
			this.cleanupPeer(peerId, peer);
		}
	}

	/**
	 * Calculate reconnection delay with exponential backoff.
	 *
	 * @param attempt - The reconnection attempt number (1-based)
	 * @returns The base delay in milliseconds
	 */
	private getReconnectDelay(attempt: number): number {
		// Exponential backoff: baseDelay * 2^(attempt-1)
		const delay = this.reconnectDelay * 2 ** (attempt - 1);
		return Math.min(delay, MAX_RECONNECT_DELAY_MS);
	}

	/**
	 * Calculate reconnection delay with exponential backoff and jitter.
	 * Jitter prevents multiple peers from reconnecting at exactly the same time.
	 *
	 * @param attempt - The reconnection attempt number (1-based)
	 * @returns The delay in milliseconds with random jitter applied
	 */
	private getReconnectDelayWithJitter(attempt: number): number {
		const baseDelay = this.getReconnectDelay(attempt);
		const jitter = baseDelay * RECONNECT_JITTER_FACTOR * Math.random();
		return Math.floor(baseDelay + jitter);
	}

	/**
	 * Attempt to reconnect to a peer.
	 */
	private async attemptReconnect(peerId: string): Promise<void> {
		const peer = this.peers.get(peerId);
		if (!peer) {
			return;
		}

		// Close old connection
		peer.connection.close();

		// Create new connection
		const connection = new RTCPeerConnection(this.rtcConfig);
		peer.connection = connection;
		peer.reliableChannel = null;
		peer.unreliableChannel = null;

		this.setupPeerConnection(peerId, peer);

		try {
			await this.createOffer(peerId);
		} catch (error) {
			const err = error instanceof Error ? error : new Error(String(error));
			console.warn(`Reconnection attempt failed for peer ${peerId}:`, error);
			this.onError?.(peerId, err, "reconnect");
		}
	}

	/**
	 * Clean up a peer connection.
	 */
	private cleanupPeer(peerId: string, peer: PeerConnection): void {
		const wasConnected = peer.isConnected;

		// Clear all pending timers
		if (peer.connectionTimer) {
			clearTimeout(peer.connectionTimer);
			peer.connectionTimer = null;
		}
		if (peer.disconnectTimer) {
			clearTimeout(peer.disconnectTimer);
			peer.disconnectTimer = null;
		}
		if (peer.reconnectTimer) {
			clearTimeout(peer.reconnectTimer);
			peer.reconnectTimer = null;
		}

		peer.reliableChannel?.close();
		peer.unreliableChannel?.close();
		peer.connection.close();

		peer.isConnected = false;
		this._connectedPeers.delete(peerId);
		this.peers.delete(peerId);
		this.peerMetrics.delete(peerId);

		// Stop keepalive timer when last peer disconnects
		if (this._connectedPeers.size === 0) {
			this.stopKeepaliveTimer();
		}

		// Reject connection promise if pending
		if (peer.connectionReject) {
			peer.connectionReject(new Error("Connection closed"));
			peer.connectionResolve = null;
			peer.connectionReject = null;
		}

		if (wasConnected) {
			this.onDisconnect?.(peerId);
		}
	}

	/**
	 * Get connection quality metrics for a peer.
	 *
	 * @param peerId - The peer's ID
	 * @returns Connection metrics or null if not available
	 */
	getConnectionMetrics(peerId: string): ConnectionMetrics | null {
		const metrics = this.peerMetrics.get(peerId);
		if (!metrics) {
			return null;
		}

		return {
			rtt: metrics.rtt,
			jitter: metrics.jitter,
			packetLoss: metrics.packetLoss,
			lastUpdated: metrics.lastUpdated,
		};
	}

	/**
	 * Record a ping sent to a peer for RTT tracking.
	 * Call this when sending a Ping message.
	 *
	 * @param peerId - The peer's ID
	 * @param timestamp - The timestamp sent in the ping
	 */
	recordPingSent(peerId: string, timestamp: number): void {
		const metrics = this.getOrCreateMetrics(peerId);
		metrics.pendingPings.set(timestamp, Date.now());
	}

	/**
	 * Record a pong received from a peer for RTT calculation.
	 * Call this when receiving a Pong message.
	 *
	 * @param peerId - The peer's ID
	 * @param timestamp - The timestamp from the pong (originally from our ping)
	 */
	recordPongReceived(peerId: string, timestamp: number): void {
		const metrics = this.getOrCreateMetrics(peerId);
		const sentAt = metrics.pendingPings.get(timestamp);

		if (sentAt !== undefined) {
			// Clamp RTT to non-negative (can be negative with clock skew)
			const rtt = Math.max(0, Date.now() - sentAt);
			this.updateRttMetrics(metrics, rtt);
			metrics.pendingPings.delete(timestamp);
		}
	}

	/**
	 * Update packet loss estimate.
	 * Call this when detecting gaps in received input acks.
	 *
	 * @param peerId - The peer's ID
	 * @param received - Number of packets received
	 * @param expected - Number of packets expected
	 */
	updatePacketLoss(peerId: string, received: number, expected: number): void {
		if (expected <= 0) return;

		const metrics = this.getOrCreateMetrics(peerId);
		const lossRate = Math.max(0, Math.min(1, 1 - received / expected));

		// Exponential moving average
		metrics.packetLoss = metrics.packetLoss * 0.8 + lossRate * 0.2;
		metrics.lastUpdated = Date.now();
	}

	/**
	 * Get or create metrics data for a peer.
	 */
	private getOrCreateMetrics(peerId: string): PeerMetricsData {
		let metrics = this.peerMetrics.get(peerId);
		if (!metrics) {
			const now = Date.now();
			metrics = {
				rttSamples: [],
				rtt: 0,
				jitter: 0,
				packetLoss: 0,
				lastUpdated: now,
				pendingPings: new Map(),
				lastResponseTime: now,
			};
			this.peerMetrics.set(peerId, metrics);
		}
		return metrics;
	}

	/**
	 * Start the keepalive timer.
	 */
	private startKeepaliveTimer(): void {
		if (this.keepaliveTimer) {
			return;
		}

		this.keepaliveTimer = setInterval(() => {
			this.checkKeepalives();
		}, this.keepaliveInterval);

		// Unref to not block process exit (important for tests)
		if (this.keepaliveTimer.unref) {
			this.keepaliveTimer.unref();
		}
	}

	/**
	 * Stop the keepalive timer.
	 */
	private stopKeepaliveTimer(): void {
		if (this.keepaliveTimer) {
			clearInterval(this.keepaliveTimer);
			this.keepaliveTimer = null;
		}
	}

	/**
	 * Check keepalive status for all connected peers.
	 * Sends pings and detects dead connections.
	 */
	private checkKeepalives(): void {
		const now = Date.now();

		for (const peerId of this._connectedPeers) {
			const metrics = this.peerMetrics.get(peerId);

			// Check for timeout
			if (metrics && now - metrics.lastResponseTime > this.keepaliveTimeout) {
				// Peer is dead - trigger disconnect
				const peer = this.peers.get(peerId);
				if (peer) {
					this.handleConnectionFailure(peerId, peer);
				}
				continue;
			}

			// Send keepalive ping via callback
			if (this.onKeepalivePing) {
				this.onKeepalivePing(peerId);
			}
		}
	}

	/**
	 * Record that we received a response from a peer.
	 * Call this when any message is received from a peer.
	 *
	 * @param peerId - The peer's ID
	 */
	recordPeerResponse(peerId: string): void {
		const metrics = this.getOrCreateMetrics(peerId);
		metrics.lastResponseTime = Date.now();
	}

	/**
	 * Update RTT metrics with a new sample.
	 */
	private updateRttMetrics(metrics: PeerMetricsData, rtt: number): void {
		// Add sample to buffer
		metrics.rttSamples.push(rtt);
		if (metrics.rttSamples.length > RTT_SAMPLE_COUNT) {
			metrics.rttSamples.shift();
		}

		// Calculate average RTT
		const sum = metrics.rttSamples.reduce((a, b) => a + b, 0);
		metrics.rtt = sum / metrics.rttSamples.length;

		// Calculate jitter (standard deviation)
		if (metrics.rttSamples.length > 1) {
			const squaredDiffs = metrics.rttSamples.map(
				(sample) => (sample - metrics.rtt) ** 2,
			);
			const avgSquaredDiff =
				squaredDiffs.reduce((a, b) => a + b, 0) / squaredDiffs.length;
			metrics.jitter = Math.sqrt(avgSquaredDiff);
		}

		metrics.lastUpdated = Date.now();
	}
}
