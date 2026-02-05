/**
 * TransformingTransport - Wraps a transport with compression and segmentation.
 *
 * Provides transparent compression (using pako/gzip) and segmentation for large
 * messages that exceed WebRTC DataChannel limits (~16KB).
 */

import type { ConnectionMetrics, TransportAdapter } from "./adapter.js";

/**
 * Lazily-loaded pako module. Resolved on first TransformingTransport
 * construction that requires compression. Kept at module scope so the
 * dynamic import runs at most once.
 */
let pako: typeof import("pako") | undefined;
let pakoLoadPromise: Promise<void> | undefined;

function ensurePakoLoading(): Promise<void> {
	if (!pakoLoadPromise) {
		pakoLoadPromise = import("pako")
			.then((mod) => {
				pako = mod;
			})
			.catch(() => {
				// pako not installed — compression unavailable
			});
	}
	return pakoLoadPromise;
}

/**
 * Configuration for TransformingTransport.
 */
export interface TransformingTransportConfig {
	/**
	 * Compression mode:
	 * - 'auto': Compress if result is smaller than original (default)
	 * - 'always': Always compress
	 * - 'never': Never compress
	 * @default 'auto'
	 */
	compression: "auto" | "always" | "never";

	/**
	 * Minimum message size in bytes before compression is attempted.
	 * Messages smaller than this are sent raw.
	 * @default 128
	 */
	compressionThreshold: number;

	/**
	 * Whether to segment large messages.
	 * @default true
	 */
	segmentation: boolean;

	/**
	 * Maximum size of each segment in bytes (including headers).
	 * WebRTC DataChannels typically have ~16KB limit.
	 * @default 16000
	 */
	maxSegmentSize: number;

	/**
	 * Timeout in milliseconds for reassembling segmented messages.
	 * Incomplete messages are discarded after this timeout.
	 * @default 5000
	 */
	reassemblyTimeout: number;
}

/**
 * Default configuration for TransformingTransport.
 */
export const DEFAULT_TRANSFORMING_TRANSPORT_CONFIG: TransformingTransportConfig =
	{
		compression: "auto",
		compressionThreshold: 128,
		segmentation: true,
		maxSegmentSize: 16000,
		reassemblyTimeout: 5000,
	};

/** Header byte indicating uncompressed data */
const COMPRESSION_HEADER_RAW = 0x00;

/** Header byte indicating gzip-compressed data */
const COMPRESSION_HEADER_GZIP = 0x01;

/** Size of the compression header (1 byte) */
const COMPRESSION_HEADER_SIZE = 1;

/** Size of the segment header (msgId:u32 + idx:u16 + total:u16 = 8 bytes) */
const SEGMENT_HEADER_SIZE = 8;

/** Maximum segments allowed per message (prevents DoS with absurd total values) */
const MAX_SEGMENTS_PER_MESSAGE = 4096; // ~64MB at 16KB segments

/**
 * State for reassembling a single multi-segment message.
 */
interface MessageReassemblyState {
	/** Total number of segments expected */
	total: number;

	/** Received segments indexed by segment index */
	segments: Map<number, Uint8Array>;

	/** Timestamp when first segment was received */
	startTime: number;
}

/**
 * Per-peer reassembly state.
 */
interface PeerReassemblyState {
	/** Pending messages keyed by message ID */
	messages: Map<number, MessageReassemblyState>;
}

/**
 * Wraps a transport with transparent compression and segmentation.
 *
 * Send path: compress -> segment -> send via inner transport
 * Receive path: reassemble -> decompress -> deliver to callback
 */
export class TransformingTransport implements TransportAdapter {
	public onMessage: ((peerId: string, message: Uint8Array) => void) | null =
		null;
	public onConnect: ((peerId: string) => void) | null = null;
	public onDisconnect: ((peerId: string) => void) | null = null;
	public onError:
		| ((peerId: string | null, error: Error, context: string) => void)
		| null = null;

	private readonly inner: TransportAdapter;
	private readonly config: TransformingTransportConfig;

	/** Per-peer message ID counters for outgoing messages */
	private readonly messageIdCounters: Map<string, number> = new Map();

	/** Per-peer reassembly buffers for incoming messages */
	private readonly reassemblyBuffers: Map<string, PeerReassemblyState> =
		new Map();

	/** Timer ID for periodic cleanup */
	private cleanupTimerId: ReturnType<typeof setInterval> | null = null;

	/**
	 * Promise that resolves once the transport is fully initialized
	 * (pako loaded if compression is enabled). Await this before sending
	 * if you need to send immediately after construction.
	 */
	public readonly ready: Promise<void>;

	/**
	 * Create a new TransformingTransport.
	 *
	 * @param inner - The underlying transport to wrap
	 * @param config - Optional configuration (uses defaults for missing values)
	 */
	constructor(
		inner: TransportAdapter,
		config?: Partial<TransformingTransportConfig>,
	) {
		this.inner = inner;
		this.config = {
			...DEFAULT_TRANSFORMING_TRANSPORT_CONFIG,
			...config,
		};

		// Kick off lazy pako load if compression is needed.
		// The ready promise always resolves (never rejects) so that consumers
		// who don't await it won't get an unhandled rejection. If pako fails
		// to load, the error surfaces synchronously at send() time instead.
		if (this.config.compression !== "never" && !pako) {
			this.ready = ensurePakoLoading();
		} else {
			this.ready = Promise.resolve();
		}

		// Wire up inner transport callbacks
		this.inner.onMessage = (peerId, message) => {
			this.handleIncomingMessage(peerId, message);
		};

		this.inner.onConnect = (peerId) => {
			this.onConnect?.(peerId);
		};

		this.inner.onDisconnect = (peerId) => {
			this.cleanupPeerState(peerId);
			this.onDisconnect?.(peerId);
		};

		// Forward errors from inner transport
		this.inner.onError = (peerId, error, context) => {
			this.onError?.(peerId, error, context);
		};

		// Start periodic cleanup for timed-out reassembly buffers
		this.startCleanupTimer();
	}

	/**
	 * Get the set of connected peer IDs.
	 */
	get connectedPeers(): ReadonlySet<string> {
		return this.inner.connectedPeers;
	}

	/**
	 * Get the local peer's ID.
	 */
	get localPeerId(): string {
		return this.inner.localPeerId;
	}

	/**
	 * Connect to a peer.
	 */
	async connect(peerId: string): Promise<void> {
		return this.inner.connect(peerId);
	}

	/**
	 * Disconnect from a peer.
	 */
	disconnect(peerId: string): void {
		this.cleanupPeerState(peerId);
		this.inner.disconnect(peerId);
	}

	/**
	 * Disconnect from all peers.
	 */
	disconnectAll(): void {
		// Clean up all state
		this.messageIdCounters.clear();
		this.reassemblyBuffers.clear();
		this.inner.disconnectAll();
	}

	/**
	 * Send a message to a specific peer.
	 * Applies compression and segmentation as configured.
	 */
	send(peerId: string, message: Uint8Array, reliable: boolean): void {
		const transformed = this.transformOutgoing(message);
		const segments = this.segmentMessage(peerId, transformed);

		for (const segment of segments) {
			this.inner.send(peerId, segment, reliable);
		}
	}

	/**
	 * Broadcast a message to all connected peers.
	 * Each peer receives independently segmented messages with unique message IDs.
	 */
	broadcast(message: Uint8Array, reliable: boolean): void {
		const transformed = this.transformOutgoing(message);

		for (const peerId of this.connectedPeers) {
			const segments = this.segmentMessage(peerId, transformed);
			for (const segment of segments) {
				this.inner.send(peerId, segment, reliable);
			}
		}
	}

	/**
	 * Get connection quality metrics for a peer.
	 */
	getConnectionMetrics?(peerId: string): ConnectionMetrics | null {
		return this.inner.getConnectionMetrics?.(peerId) ?? null;
	}

	/**
	 * Stop the cleanup timer and dispose of the inner transport.
	 * Call this when disposing of the transport.
	 */
	dispose(): void {
		this.stopCleanupTimer();
		this.messageIdCounters.clear();
		this.reassemblyBuffers.clear();
		// Dispose of the wrapped transport to prevent memory leaks
		this.inner.dispose?.();
	}

	/**
	 * Apply compression to outgoing message data.
	 * Returns data with a 1-byte compression header.
	 */
	private transformOutgoing(message: Uint8Array): Uint8Array {
		if (this.config.compression === "never") {
			return this.addCompressionHeader(message, false);
		}

		// Check if message is above threshold
		if (
			this.config.compression === "auto" &&
			message.length < this.config.compressionThreshold
		) {
			return this.addCompressionHeader(message, false);
		}

		if (!pako) {
			throw new Error(
				'TransformingTransport requires the "pako" package for compression. ' +
					"Install it with: npm install pako\n" +
					'Or set compression: "never" to disable compression.',
			);
		}
		const compressed = pako.deflate(message);

		// In auto mode, only use compression if it actually reduces size
		if (
			this.config.compression === "auto" &&
			compressed.length >= message.length
		) {
			return this.addCompressionHeader(message, false);
		}

		return this.addCompressionHeader(compressed, true);
	}

	/**
	 * Add compression header to message data.
	 */
	private addCompressionHeader(
		data: Uint8Array,
		isCompressed: boolean,
	): Uint8Array {
		const result = new Uint8Array(COMPRESSION_HEADER_SIZE + data.length);
		result[0] = isCompressed ? COMPRESSION_HEADER_GZIP : COMPRESSION_HEADER_RAW;
		result.set(data, COMPRESSION_HEADER_SIZE);
		return result;
	}

	/**
	 * Segment a transformed message for sending.
	 * Returns an array of segments, each with an 8-byte header.
	 */
	private segmentMessage(peerId: string, data: Uint8Array): Uint8Array[] {
		// Calculate max payload size per segment
		const maxPayloadSize = this.config.maxSegmentSize - SEGMENT_HEADER_SIZE;

		if (!this.config.segmentation || data.length <= maxPayloadSize) {
			// Single segment
			return [this.createSegment(peerId, data, 0, 1)];
		}

		// Multiple segments
		const segments: Uint8Array[] = [];
		const totalSegments = Math.ceil(data.length / maxPayloadSize);
		const messageId = this.getNextMessageId(peerId);

		for (let i = 0; i < totalSegments; i++) {
			const start = i * maxPayloadSize;
			const end = Math.min(start + maxPayloadSize, data.length);
			const payload = data.slice(start, end);

			segments.push(
				this.createSegmentWithId(messageId, payload, i, totalSegments),
			);
		}

		return segments;
	}

	/**
	 * Create a segment with auto-generated message ID.
	 */
	private createSegment(
		peerId: string,
		payload: Uint8Array,
		index: number,
		total: number,
	): Uint8Array {
		const messageId = this.getNextMessageId(peerId);
		return this.createSegmentWithId(messageId, payload, index, total);
	}

	/**
	 * Create a segment with a specific message ID.
	 */
	private createSegmentWithId(
		messageId: number,
		payload: Uint8Array,
		index: number,
		total: number,
	): Uint8Array {
		const segment = new Uint8Array(SEGMENT_HEADER_SIZE + payload.length);
		const view = new DataView(segment.buffer);

		// Write header: msgId:u32, idx:u16, total:u16
		view.setUint32(0, messageId, true);
		view.setUint16(4, index, true);
		view.setUint16(6, total, true);

		// Write payload
		segment.set(payload, SEGMENT_HEADER_SIZE);

		return segment;
	}

	/**
	 * Get the next message ID for a peer.
	 *
	 * Note: Wraps at 2^32 (~4 billion). Collisions after wrap-around are handled by:
	 * 1. The total-mismatch check in bufferSegment() (rejects segments with wrong total)
	 * 2. The reassembly timeout cleanup (removes stale entries after 5s)
	 * 3. Practical impossibility: at 60 msg/sec, wrap-around takes ~2.2 years
	 */
	private getNextMessageId(peerId: string): number {
		const current = this.messageIdCounters.get(peerId) ?? 0;
		const next = (current + 1) >>> 0; // Keep as unsigned 32-bit
		this.messageIdCounters.set(peerId, next);
		return current;
	}

	/**
	 * Handle an incoming message from the inner transport.
	 */
	private handleIncomingMessage(peerId: string, data: Uint8Array): void {
		if (data.length < SEGMENT_HEADER_SIZE) {
			// Invalid segment, ignore
			return;
		}

		// Parse segment header
		const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
		const messageId = view.getUint32(0, true);
		const index = view.getUint16(4, true);
		const total = view.getUint16(6, true);

		// Extract payload
		const payload = data.slice(SEGMENT_HEADER_SIZE);

		if (total === 0) {
			// Invalid total, ignore
			return;
		}

		if (total === 1) {
			// Fast path: single segment message
			this.deliverMessage(peerId, payload);
			return;
		}

		// Multi-segment message: buffer and reassemble
		this.bufferSegment(peerId, messageId, index, total, payload);
	}

	/**
	 * Buffer a segment and attempt reassembly.
	 */
	private bufferSegment(
		peerId: string,
		messageId: number,
		index: number,
		total: number,
		payload: Uint8Array,
	): void {
		// Validate segment header values
		if (total > MAX_SEGMENTS_PER_MESSAGE || index >= total) {
			return;
		}

		// Get or create peer state
		let peerState = this.reassemblyBuffers.get(peerId);
		if (!peerState) {
			peerState = { messages: new Map() };
			this.reassemblyBuffers.set(peerId, peerState);
		}

		// Get or create message state
		let messageState = peerState.messages.get(messageId);
		if (!messageState) {
			messageState = {
				total,
				segments: new Map(),
				startTime: Date.now(),
			};
			peerState.messages.set(messageId, messageState);
		}

		// Validate total matches
		if (messageState.total !== total) {
			// Mismatched total, discard segment
			return;
		}

		// Ignore duplicate segments
		if (messageState.segments.has(index)) {
			return;
		}

		// Store segment
		messageState.segments.set(index, payload);

		// Check if complete
		if (messageState.segments.size === total) {
			// Reassemble in order
			const reassembled = this.reassembleMessage(messageState);
			peerState.messages.delete(messageId);

			this.deliverMessage(peerId, reassembled);
		}
	}

	/**
	 * Reassemble a complete message from segments.
	 */
	private reassembleMessage(state: MessageReassemblyState): Uint8Array {
		// Calculate total size
		let totalSize = 0;
		for (const segment of state.segments.values()) {
			totalSize += segment.length;
		}

		// Reassemble in order
		const result = new Uint8Array(totalSize);
		let offset = 0;

		for (let i = 0; i < state.total; i++) {
			const segment = state.segments.get(i);
			if (segment) {
				result.set(segment, offset);
				offset += segment.length;
			}
		}

		return result;
	}

	/**
	 * Decompress and deliver a reassembled message.
	 */
	private deliverMessage(peerId: string, data: Uint8Array): void {
		if (data.length < COMPRESSION_HEADER_SIZE) {
			// Invalid message, ignore
			return;
		}

		const compressionByte = data[0];
		const payload = data.slice(COMPRESSION_HEADER_SIZE);

		let decompressed: Uint8Array;

		if (compressionByte === COMPRESSION_HEADER_GZIP) {
			try {
				if (!pako) {
					// Compressed message received but pako not available — drop it
					return;
				}
				decompressed = pako.inflate(payload);
			} catch {
				// Decompression failed, ignore message
				return;
			}
		} else {
			// Raw data
			decompressed = payload;
		}

		this.onMessage?.(peerId, decompressed);
	}

	/**
	 * Clean up state for a disconnected peer.
	 */
	private cleanupPeerState(peerId: string): void {
		this.messageIdCounters.delete(peerId);
		this.reassemblyBuffers.delete(peerId);
	}

	/**
	 * Start the periodic cleanup timer.
	 */
	private startCleanupTimer(): void {
		// Run cleanup every second
		this.cleanupTimerId = setInterval(() => {
			this.cleanupTimedOutMessages();
		}, 1000);

		// Allow process to exit even if timer is running
		if (this.cleanupTimerId.unref) {
			this.cleanupTimerId.unref();
		}
	}

	/**
	 * Stop the cleanup timer.
	 */
	private stopCleanupTimer(): void {
		if (this.cleanupTimerId !== null) {
			clearInterval(this.cleanupTimerId);
			this.cleanupTimerId = null;
		}
	}

	/**
	 * Remove incomplete messages that have timed out.
	 */
	private cleanupTimedOutMessages(): void {
		const now = Date.now();

		for (const [peerId, peerState] of this.reassemblyBuffers) {
			for (const [messageId, messageState] of peerState.messages) {
				if (now - messageState.startTime > this.config.reassemblyTimeout) {
					peerState.messages.delete(messageId);
				}
			}

			// Remove peer state if empty
			if (peerState.messages.size === 0) {
				this.reassemblyBuffers.delete(peerId);
			}
		}
	}
}
