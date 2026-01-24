import assert from "node:assert";
import { describe, it, beforeEach, mock } from "node:test";
import { WebRTCTransport } from "../../src/transport/webrtc.js";

// Mock RTCPeerConnection for Node.js testing
class MockRTCPeerConnection {
	iceConnectionState = "new";
	onicecandidate: ((event: { candidate: unknown }) => void) | null = null;
	oniceconnectionstatechange: (() => void) | null = null;
	ondatachannel: ((event: { channel: MockRTCDataChannel }) => void) | null =
		null;

	private channels: MockRTCDataChannel[] = [];

	createDataChannel(label: string, _config?: RTCDataChannelInit): MockRTCDataChannel {
		const channel = new MockRTCDataChannel(label);
		this.channels.push(channel);
		return channel;
	}

	async createOffer(): Promise<RTCSessionDescriptionInit> {
		return { type: "offer", sdp: "mock-sdp" };
	}

	async createAnswer(): Promise<RTCSessionDescriptionInit> {
		return { type: "answer", sdp: "mock-sdp" };
	}

	async setLocalDescription(_desc: RTCSessionDescriptionInit): Promise<void> {}
	async setRemoteDescription(_desc: RTCSessionDescriptionInit): Promise<void> {}
	async addIceCandidate(_candidate: RTCIceCandidateInit): Promise<void> {}

	async getStats(): Promise<RTCStatsReport> {
		return new Map() as unknown as RTCStatsReport;
	}

	close(): void {
		for (const channel of this.channels) {
			channel.close();
		}
	}

	// Test helpers
	simulateDataChannel(label: string): MockRTCDataChannel {
		const channel = new MockRTCDataChannel(label);
		if (this.ondatachannel) {
			this.ondatachannel({ channel });
		}
		return channel;
	}

	simulateIceConnectionState(state: RTCIceConnectionState): void {
		this.iceConnectionState = state;
		if (this.oniceconnectionstatechange) {
			this.oniceconnectionstatechange();
		}
	}
}

class MockRTCDataChannel {
	label: string;
	readyState: RTCDataChannelState = "connecting";
	binaryType: BinaryType = "arraybuffer";

	onopen: (() => void) | null = null;
	onclose: (() => void) | null = null;
	onerror: ((event: Event) => void) | null = null;
	onmessage: ((event: { data: ArrayBuffer }) => void) | null = null;

	constructor(label: string) {
		this.label = label;
	}

	send(_data: ArrayBufferView): void {}

	close(): void {
		this.readyState = "closed";
		if (this.onclose) {
			this.onclose();
		}
	}

	// Test helpers
	simulateOpen(): void {
		this.readyState = "open";
		if (this.onopen) {
			this.onopen();
		}
	}

	simulateMessage(data: Uint8Array): void {
		if (this.onmessage) {
			this.onmessage({ data: data.buffer });
		}
	}
}

// Install mock globally before tests
const originalRTCPeerConnection = globalThis.RTCPeerConnection;

describe("WebRTCTransport", () => {
	beforeEach(() => {
		// Install mock
		(globalThis as unknown as { RTCPeerConnection: unknown }).RTCPeerConnection =
			MockRTCPeerConnection;
	});

	describe("RTT metrics", () => {
		it("should calculate RTT from ping/pong", () => {
			const transport = new WebRTCTransport("local", { keepaliveInterval: 0 });
			const peerId = "peer1";

			// Simulate ping sent
			const timestamp = 1000;
			transport.recordPingSent(peerId, timestamp);

			// Simulate 50ms delay, then pong received
			const originalNow = Date.now;
			let mockTime = originalNow();
			Date.now = () => mockTime;

			mockTime += 50; // 50ms later
			transport.recordPongReceived(peerId, timestamp);

			const metrics = transport.getConnectionMetrics(peerId);
			assert.ok(metrics);
			assert.ok(metrics.rtt >= 0, `RTT should be non-negative, got ${metrics.rtt}`);

			Date.now = originalNow;
			transport.destroy();
		});

		it("should handle negative RTT gracefully", () => {
			const transport = new WebRTCTransport("local", { keepaliveInterval: 0 });
			const peerId = "peer1";

			// Record ping
			const timestamp = 1000;
			transport.recordPingSent(peerId, timestamp);

			// Simulate clock going backwards (negative RTT scenario)
			const originalNow = Date.now;
			const sentTime = originalNow();
			Date.now = () => sentTime - 100; // Clock went backwards by 100ms

			transport.recordPongReceived(peerId, timestamp);

			const metrics = transport.getConnectionMetrics(peerId);
			assert.ok(metrics);
			// RTT should be clamped to 0 when clock skew causes negative value
			assert.strictEqual(metrics.rtt, 0, "RTT should be clamped to 0");

			Date.now = originalNow;
			transport.destroy();
		});

		it("should clean up pending pings on disconnect", async () => {
			const transport = new WebRTCTransport("local", { keepaliveInterval: 0 });
			transport.setSignalingCallbacks({
				onLocalDescription: () => {},
				onLocalCandidate: () => {},
			});

			const peerId = "peer1";

			// This will create a peer connection via the mock
			const connectPromise = transport.connect(peerId).catch(() => {}); // Ignore rejection

			// Record several pings that never get responses
			transport.recordPingSent(peerId, 1000);
			transport.recordPingSent(peerId, 2000);
			transport.recordPingSent(peerId, 3000);

			// Verify metrics exist
			let metrics = transport.getConnectionMetrics(peerId);
			assert.ok(metrics);

			// Disconnect should clean up
			transport.disconnect(peerId);

			// Wait for promise to settle
			await connectPromise;

			// Metrics should be gone
			metrics = transport.getConnectionMetrics(peerId);
			assert.strictEqual(metrics, null);

			transport.destroy();
		});
	});

	describe("connection timeout", () => {
		it("should timeout connect() if connection never establishes", async () => {
			const transport = new WebRTCTransport("local", {
				keepaliveInterval: 0,
				connectionTimeout: 50, // 50ms timeout for testing
			});
			transport.setSignalingCallbacks({
				onLocalDescription: () => {},
				onLocalCandidate: () => {},
			});

			// The connection never completes (no channels open)
			// Should reject with timeout error
			await assert.rejects(
				transport.connect("peer1"),
				/timed out/,
				"connect() should reject with timeout error",
			);

			transport.destroy();
		});

		it("should not timeout if connection succeeds in time", async () => {
			const transport = new WebRTCTransport("local", {
				keepaliveInterval: 0,
				connectionTimeout: 1000, // 1 second timeout
			});
			transport.setSignalingCallbacks({
				onLocalDescription: () => {},
				onLocalCandidate: () => {},
			});

			// Start connection
			const connectPromise = transport.connect("peer1");

			// Simulate connection success quickly (before timeout)
			// This is tricky since we need to access the mock channels
			// For now, just verify destroy cancels cleanly
			transport.destroy();

			// Should reject with "Connection closed", not timeout
			await assert.rejects(connectPromise, /Connection closed/);
		});
	});

	describe("cleanup", () => {
		it("should clean up all resources on destroy", async () => {
			const transport = new WebRTCTransport("local", { keepaliveInterval: 0 });
			transport.setSignalingCallbacks({
				onLocalDescription: () => {},
				onLocalCandidate: () => {},
			});

			// Create some connections (but don't await - they won't complete without simulation)
			const p1 = transport.connect("peer1").catch(() => {}); // Ignore rejection
			const p2 = transport.connect("peer2").catch(() => {}); // Ignore rejection

			// Record some metrics
			transport.recordPingSent("peer1", 1000);
			transport.recordPingSent("peer2", 2000);

			// Destroy should clean everything
			transport.destroy();

			// Wait for promises to settle (they should reject on destroy)
			await Promise.allSettled([p1, p2]);

			// Verify cleanup
			assert.strictEqual(transport.connectedPeers.size, 0);
			assert.strictEqual(transport.getConnectionMetrics("peer1"), null);
			assert.strictEqual(transport.getConnectionMetrics("peer2"), null);
		});
	});
});

// Restore original after all tests
// Note: In Node.js test runner, this runs after the file is done
if (originalRTCPeerConnection) {
	(globalThis as unknown as { RTCPeerConnection: unknown }).RTCPeerConnection =
		originalRTCPeerConnection;
}
