/**
 * WebRTC transport implementation.
 *
 * Provides peer-to-peer communication using WebRTC DataChannels.
 * Uses dual channels: reliable (ordered, guaranteed) and unreliable (best-effort).
 *
 * This implementation is signaling-agnostic - you must provide your own signaling
 * mechanism (WebSocket, HTTP, etc.) to exchange SDP offers/answers and ICE candidates.
 */

import type { TransportAdapter } from "./adapter.js";

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
}

/**
 * Callbacks for signaling integration.
 * You must implement these to handle SDP and ICE candidate exchange.
 */
export interface SignalingCallbacks {
	/** Called when a local SDP description is ready to be sent to a peer */
	onLocalDescription: (
		peerId: string,
		description: RTCSessionDescriptionInit,
	) => void;

	/** Called when a local ICE candidate is ready to be sent to a peer */
	onLocalCandidate: (peerId: string, candidate: RTCIceCandidateInit) => void;
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

	private readonly peers: Map<string, PeerConnection> = new Map();
	private readonly _connectedPeers: Set<string> = new Set();

	private signalingCallbacks: SignalingCallbacks | null = null;

	onMessage: ((peerId: string, message: Uint8Array) => void) | null = null;
	onConnect: ((peerId: string) => void) | null = null;
	onDisconnect: ((peerId: string) => void) | null = null;

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
		this.maxReconnectAttempts = config.maxReconnectAttempts ?? 3;
		this.reconnectDelay = config.reconnectDelay ?? 1000;
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
		});

		await this.createOffer(peerId);

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
		this.signalingCallbacks.onLocalDescription(peerId, offer);
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

			this.signalingCallbacks.onLocalDescription(peerId, answer);
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
			console.warn(`Failed to add ICE candidate for peer ${peerId}:`, error);
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
			channel.send(message);
		} catch (error) {
			console.warn(`Failed to send message to peer ${peerId}:`, error);
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
				this.signalingCallbacks.onLocalCandidate(peerId, event.candidate);
			}
		};

		// Handle ICE connection state changes
		connection.oniceconnectionstatechange = () => {
			const state = connection.iceConnectionState;

			if (state === "failed") {
				this.handleConnectionFailure(peerId, peer);
			} else if (state === "disconnected") {
				// Might recover, wait a bit before declaring disconnection
				setTimeout(() => {
					if (connection.iceConnectionState === "disconnected") {
						this.handleConnectionFailure(peerId, peer);
					}
				}, 5000);
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
			console.warn(
				`DataChannel error for peer ${peerId} (${isReliable ? "reliable" : "unreliable"}):`,
				event,
			);
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
			this._connectedPeers.add(peerId);

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
			setTimeout(() => {
				this.attemptReconnect(peerId);
			}, this.reconnectDelay);
		} else {
			this.cleanupPeer(peerId, peer);
		}
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
			console.warn(`Reconnection attempt failed for peer ${peerId}:`, error);
		}
	}

	/**
	 * Clean up a peer connection.
	 */
	private cleanupPeer(peerId: string, peer: PeerConnection): void {
		const wasConnected = peer.isConnected;

		peer.reliableChannel?.close();
		peer.unreliableChannel?.close();
		peer.connection.close();

		peer.isConnected = false;
		this._connectedPeers.delete(peerId);
		this.peers.delete(peerId);

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
}
