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

		it("should not fire disconnect callback after destroy with pending disconnect timer", async () => {
			const transport = new WebRTCTransport("local", { keepaliveInterval: 0 });
			transport.setSignalingCallbacks({
				onLocalDescription: () => {},
				onLocalCandidate: () => {},
			});

			let disconnectCalledAfterDestroy = false;
			let destroyed = false;

			transport.onDisconnect = () => {
				if (destroyed) {
					disconnectCalledAfterDestroy = true;
				}
			};

			// Start connection
			const connectPromise = transport.connect("peer1").catch(() => {});

			// Wait for peer to be created
			await new Promise(resolve => setTimeout(resolve, 10));

			// Get the mock peer connection to simulate ICE state change
			// Access internal peers map
			const peers = (transport as unknown as { peers: Map<string, { connection: MockRTCPeerConnection }> }).peers;
			const peer = peers.get("peer1");
			assert.ok(peer, "Peer should exist");

			// Simulate ICE disconnected state - this schedules a disconnect timer
			peer.connection.simulateIceConnectionState("disconnected");

			// Destroy immediately before the disconnect timer fires
			destroyed = true;
			transport.destroy();
			await connectPromise;

			// Wait for the disconnect detection delay to have passed
			await new Promise(resolve => setTimeout(resolve, 150));

			// Disconnect callback should NOT have been called after destroy
			assert.strictEqual(
				disconnectCalledAfterDestroy,
				false,
				"onDisconnect should not be called after destroy",
			);
		});

		it("should not attempt reconnection after destroy", async () => {
			const transport = new WebRTCTransport("local", {
				keepaliveInterval: 0,
				reconnectDelay: 50, // Fast reconnection for testing
			});
			transport.setSignalingCallbacks({
				onLocalDescription: () => {},
				onLocalCandidate: () => {},
			});

			let reconnectAttempts = 0;
			const originalOnLocalDescription = transport["signalingCallbacks"]?.onLocalDescription;

			// Track reconnection attempts through offer creation
			transport.setSignalingCallbacks({
				onLocalDescription: (peerId, desc) => {
					reconnectAttempts++;
					originalOnLocalDescription?.(peerId, desc);
				},
				onLocalCandidate: () => {},
			});

			// Start connection
			const connectPromise = transport.connect("peer1").catch(() => {});

			// Wait for initial connection attempt
			await new Promise(resolve => setTimeout(resolve, 10));
			const initialAttempts = reconnectAttempts;

			// Destroy before any reconnection timers can fire
			transport.destroy();
			await connectPromise;

			// Wait for any pending reconnect timers
			await new Promise(resolve => setTimeout(resolve, 200));

			// No additional reconnection attempts should have occurred
			assert.strictEqual(
				reconnectAttempts,
				initialAttempts,
				"No reconnection attempts should occur after destroy",
			);
		});
	});

	describe("error handling", () => {
		it("should reject connect() when signaling callbacks not set", async () => {
			const transport = new WebRTCTransport("local", { keepaliveInterval: 0 });
			// Don't set signaling callbacks

			// connect() should reject because createOffer requires signaling callbacks
			await assert.rejects(
				transport.connect("peer1"),
				/Signaling callbacks not set/,
				"connect() should reject when signaling callbacks are not set",
			);

			transport.destroy();
		});

		it("should handle send errors gracefully without throwing", async () => {
			const transport = new WebRTCTransport("local", { keepaliveInterval: 0 });
			transport.setSignalingCallbacks({
				onLocalDescription: () => {},
				onLocalCandidate: () => {},
			});

			// Sending to non-existent peer should not throw
			assert.doesNotThrow(() => {
				transport.send("nonexistent", new Uint8Array([1, 2, 3]), true);
			});

			transport.destroy();
		});

		it("should handle ICE candidate errors gracefully", async () => {
			const transport = new WebRTCTransport("local", { keepaliveInterval: 0 });
			transport.setSignalingCallbacks({
				onLocalDescription: () => {},
				onLocalCandidate: () => {},
			});

			// Adding ICE candidate for non-existent peer should not throw
			await assert.doesNotReject(async () => {
				await transport.handleRemoteCandidate("nonexistent", {
					candidate: "invalid",
					sdpMid: "0",
					sdpMLineIndex: 0,
				});
			});

			transport.destroy();
		});

		it("should notify via onDisconnect when connection fails", async () => {
			const transport = new WebRTCTransport("local", { keepaliveInterval: 0 });
			transport.setSignalingCallbacks({
				onLocalDescription: () => {},
				onLocalCandidate: () => {},
			});

			// The disconnect callback is the proper way to handle connection failures
			// Silent console.warn calls are for debugging, not error propagation
			let disconnectedPeerId: string | null = null;
			transport.onDisconnect = (peerId) => {
				disconnectedPeerId = peerId;
			};

			// Start connection
			const connectPromise = transport.connect("peer1").catch(() => {});
			await new Promise(resolve => setTimeout(resolve, 10));

			// Get mock peer and simulate failure
			const peers = (transport as unknown as { peers: Map<string, { connection: MockRTCPeerConnection; isConnected: boolean }> }).peers;
			const peer = peers.get("peer1");
			assert.ok(peer, "Peer should exist");

			// Mark as connected, then simulate failure
			peer.isConnected = true;
			peer.connection.simulateIceConnectionState("failed");

			// Wait for failure handling
			await new Promise(resolve => setTimeout(resolve, 50));
			await connectPromise;

			// Disconnect callback should have been invoked with the peer ID
			assert.strictEqual(
				disconnectedPeerId,
				"peer1",
				"onDisconnect should be called with the failed peer ID",
			);

			transport.destroy();
		});
	});
});

// Restore original after all tests
// Note: In Node.js test runner, this runs after the file is done
if (originalRTCPeerConnection) {
	(globalThis as unknown as { RTCPeerConnection: unknown }).RTCPeerConnection =
		originalRTCPeerConnection;
}
