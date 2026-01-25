import assert from "node:assert";
import { describe, it } from "node:test";
import { LocalTransport } from "../../src/transport/local.js";
import {
	TransformingTransport,
	DEFAULT_TRANSFORMING_TRANSPORT_CONFIG,
} from "../../src/transport/transforming.js";

/**
 * Helper to create a linked pair of transports with TransformingTransport wrapper.
 */
function createTransformingPair(
	configOverrides?: Partial<typeof DEFAULT_TRANSFORMING_TRANSPORT_CONFIG>,
) {
	const local1 = new LocalTransport("peer-1");
	const local2 = new LocalTransport("peer-2");
	LocalTransport.link(local1, local2);

	const t1 = new TransformingTransport(local1, configOverrides);
	const t2 = new TransformingTransport(local2, configOverrides);

	return { t1, t2, local1, local2 };
}

/**
 * Generate test data of specified size.
 * Uses a pattern that compresses well.
 */
function generateCompressibleData(size: number): Uint8Array {
	const data = new Uint8Array(size);
	for (let i = 0; i < size; i++) {
		data[i] = i % 256;
	}
	return data;
}

/**
 * Generate random data that doesn't compress well.
 */
function generateIncompressibleData(size: number): Uint8Array {
	const data = new Uint8Array(size);
	// Use pseudo-random but deterministic values
	let seed = 12345;
	for (let i = 0; i < size; i++) {
		seed = (seed * 1664525 + 1013904223) >>> 0;
		data[i] = seed & 0xff;
	}
	return data;
}

describe("TransformingTransport", () => {
	describe("pass-through mode", () => {
		it("should pass messages through when both compression and segmentation are disabled", async () => {
			const { t1, t2, local1 } = createTransformingPair({
				compression: "never",
				segmentation: false,
			});

			const received: { peerId: string; message: Uint8Array }[] = [];
			t2.onMessage = (peerId, message) => {
				received.push({ peerId, message });
			};

			await t1.connect("peer-2");
			const original = new Uint8Array([1, 2, 3, 4, 5]);
			t1.send("peer-2", original, true);
			local1.flush();

			assert.strictEqual(received.length, 1);
			assert.strictEqual(received[0]?.peerId, "peer-1");
			assert.deepStrictEqual(received[0]?.message, original);

			t1.dispose();
			t2.dispose();
		});

		it("should forward connection events", async () => {
			const { t1, t2 } = createTransformingPair();

			const connects1: string[] = [];
			const connects2: string[] = [];

			t1.onConnect = (peerId) => connects1.push(peerId);
			t2.onConnect = (peerId) => connects2.push(peerId);

			await t1.connect("peer-2");

			assert.deepStrictEqual(connects1, ["peer-2"]);
			assert.deepStrictEqual(connects2, ["peer-1"]);

			t1.dispose();
			t2.dispose();
		});

		it("should forward disconnection events", async () => {
			const { t1, t2 } = createTransformingPair();

			const disconnects1: string[] = [];
			const disconnects2: string[] = [];

			t1.onDisconnect = (peerId) => disconnects1.push(peerId);
			t2.onDisconnect = (peerId) => disconnects2.push(peerId);

			await t1.connect("peer-2");
			t1.disconnect("peer-2");

			assert.deepStrictEqual(disconnects1, ["peer-2"]);
			assert.deepStrictEqual(disconnects2, ["peer-1"]);

			t1.dispose();
			t2.dispose();
		});
	});

	describe("compression", () => {
		it("should not compress when compression is 'never'", async () => {
			const { t1, t2, local1 } = createTransformingPair({
				compression: "never",
				segmentation: false,
			});

			const received: Uint8Array[] = [];
			t2.onMessage = (_, msg) => received.push(msg);

			await t1.connect("peer-2");
			const original = generateCompressibleData(1000);
			t1.send("peer-2", original, true);
			local1.flush();

			assert.strictEqual(received.length, 1);
			assert.deepStrictEqual(received[0], original);

			t1.dispose();
			t2.dispose();
		});

		it("should always compress when compression is 'always'", async () => {
			const { t1, t2, local1 } = createTransformingPair({
				compression: "always",
				segmentation: false,
			});

			const received: Uint8Array[] = [];
			t2.onMessage = (_, msg) => received.push(msg);

			await t1.connect("peer-2");
			const original = generateCompressibleData(1000);
			t1.send("peer-2", original, true);
			local1.flush();

			assert.strictEqual(received.length, 1);
			assert.deepStrictEqual(received[0], original);

			t1.dispose();
			t2.dispose();
		});

		it("should only compress when beneficial in 'auto' mode", async () => {
			const { t1, t2, local1 } = createTransformingPair({
				compression: "auto",
				compressionThreshold: 0, // Try compression on all messages
				segmentation: false,
			});

			const received: Uint8Array[] = [];
			t2.onMessage = (_, msg) => received.push(msg);

			await t1.connect("peer-2");

			// Compressible data should be compressed
			const compressible = generateCompressibleData(1000);
			t1.send("peer-2", compressible, true);
			local1.flush();

			assert.strictEqual(received.length, 1);
			assert.deepStrictEqual(received[0], compressible);

			t1.dispose();
			t2.dispose();
		});

		it("should skip compression in 'auto' mode when result is larger", async () => {
			const { t1, t2, local1 } = createTransformingPair({
				compression: "auto",
				compressionThreshold: 0,
				segmentation: false,
			});

			const received: Uint8Array[] = [];
			t2.onMessage = (_, msg) => received.push(msg);

			await t1.connect("peer-2");

			// Random data doesn't compress well
			const incompressible = generateIncompressibleData(100);
			t1.send("peer-2", incompressible, true);
			local1.flush();

			assert.strictEqual(received.length, 1);
			assert.deepStrictEqual(received[0], incompressible);

			t1.dispose();
			t2.dispose();
		});

		it("should respect compression threshold", async () => {
			const { t1, t2, local1 } = createTransformingPair({
				compression: "auto",
				compressionThreshold: 500,
				segmentation: false,
			});

			const received: Uint8Array[] = [];
			t2.onMessage = (_, msg) => received.push(msg);

			await t1.connect("peer-2");

			// Small message below threshold
			const small = new Uint8Array([1, 2, 3]);
			t1.send("peer-2", small, true);
			local1.flush();

			assert.strictEqual(received.length, 1);
			assert.deepStrictEqual(received[0], small);

			t1.dispose();
			t2.dispose();
		});
	});

	describe("segmentation", () => {
		it("should send small messages as single segment", async () => {
			const { t1, t2, local1 } = createTransformingPair({
				compression: "never",
				segmentation: true,
				maxSegmentSize: 1000,
			});

			const received: Uint8Array[] = [];
			t2.onMessage = (_, msg) => received.push(msg);

			await t1.connect("peer-2");
			const original = new Uint8Array([1, 2, 3, 4, 5]);
			t1.send("peer-2", original, true);
			local1.flush();

			assert.strictEqual(received.length, 1);
			assert.deepStrictEqual(received[0], original);

			t1.dispose();
			t2.dispose();
		});

		it("should segment large messages", async () => {
			const maxSegmentSize = 100;
			const { t1, t2, local1 } = createTransformingPair({
				compression: "never",
				segmentation: true,
				maxSegmentSize,
			});

			const received: Uint8Array[] = [];
			t2.onMessage = (_, msg) => received.push(msg);

			await t1.connect("peer-2");

			// Create message larger than segment size
			// Account for compression header (1 byte) and segment header (8 bytes)
			const payloadSize = (maxSegmentSize - 8) * 3; // Should create ~4 segments
			const original = generateCompressibleData(payloadSize);
			t1.send("peer-2", original, true);
			local1.flush();

			assert.strictEqual(received.length, 1);
			assert.deepStrictEqual(received[0], original);

			t1.dispose();
			t2.dispose();
		});

		it("should handle out-of-order segment arrival", async () => {
			// We need to manually test this by intercepting and reordering
			const local1 = new LocalTransport("peer-1");
			const local2 = new LocalTransport("peer-2");
			LocalTransport.link(local1, local2);

			const intercepted: Uint8Array[] = [];

			// Intercept messages on local2 before wrapping
			local2.onMessage = (_peerId, msg) => {
				intercepted.push(new Uint8Array(msg));
			};

			const t1 = new TransformingTransport(local1, {
				compression: "never",
				segmentation: true,
				maxSegmentSize: 50, // Small segments
			});

			await local1.connect("peer-2");

			// Create a large message
			const original = generateCompressibleData(200);
			t1.send("peer-2", original, true);
			local1.flush();

			// We should have multiple segments intercepted
			assert.ok(intercepted.length > 1, `Expected multiple segments, got ${intercepted.length}`);

			// Now create a fresh t2 and deliver segments in reverse order
			local2.onMessage = null;
			const t2 = new TransformingTransport(local2, {
				compression: "never",
				segmentation: true,
				maxSegmentSize: 50,
			});

			const received: Uint8Array[] = [];
			t2.onMessage = (_, msg) => received.push(msg);

			// Simulate connection
			(t2 as { onConnect: ((peerId: string) => void) | null }).onConnect?.("peer-1");

			// Deliver in reverse order
			for (let i = intercepted.length - 1; i >= 0; i--) {
				const segment = intercepted[i];
				if (segment) {
					// Manually trigger onMessage through inner transport callback
					(local2.onMessage as ((peerId: string, message: Uint8Array) => void))?.("peer-1", segment);
				}
			}

			// Should still reassemble correctly
			assert.strictEqual(received.length, 1);
			assert.deepStrictEqual(received[0], original);

			t1.dispose();
			t2.dispose();
		});

		it("should handle duplicate segments", async () => {
			const local1 = new LocalTransport("peer-1");
			const local2 = new LocalTransport("peer-2");
			LocalTransport.link(local1, local2);

			const intercepted: Uint8Array[] = [];

			// Intercept messages
			local2.onMessage = (_peerId, msg) => {
				intercepted.push(new Uint8Array(msg));
			};

			const t1 = new TransformingTransport(local1, {
				compression: "never",
				segmentation: true,
				maxSegmentSize: 50,
			});

			await local1.connect("peer-2");

			const original = generateCompressibleData(100);
			t1.send("peer-2", original, true);
			local1.flush();

			// Now deliver with duplicates
			local2.onMessage = null;
			const t2 = new TransformingTransport(local2, {
				compression: "never",
				segmentation: true,
				maxSegmentSize: 50,
			});

			const received: Uint8Array[] = [];
			t2.onMessage = (_, msg) => received.push(msg);

			// Deliver each segment twice
			for (const segment of intercepted) {
				if (segment) {
					(local2.onMessage as ((peerId: string, message: Uint8Array) => void))?.("peer-1", segment);
					(local2.onMessage as ((peerId: string, message: Uint8Array) => void))?.("peer-1", segment);
				}
			}

			// Should only receive message once
			assert.strictEqual(received.length, 1);
			assert.deepStrictEqual(received[0], original);

			t1.dispose();
			t2.dispose();
		});
	});

	describe("combined compression and segmentation", () => {
		it("should compress then segment large messages", async () => {
			const { t1, t2, local1 } = createTransformingPair({
				compression: "always",
				segmentation: true,
				maxSegmentSize: 100,
			});

			const received: Uint8Array[] = [];
			t2.onMessage = (_, msg) => received.push(msg);

			await t1.connect("peer-2");

			// Large compressible message
			const original = generateCompressibleData(1000);
			t1.send("peer-2", original, true);
			local1.flush();

			assert.strictEqual(received.length, 1);
			assert.deepStrictEqual(received[0], original);

			t1.dispose();
			t2.dispose();
		});

		it("should handle full round-trip with all transforms", async () => {
			const { t1, t2, local1, local2 } = createTransformingPair({
				compression: "auto",
				compressionThreshold: 50,
				segmentation: true,
				maxSegmentSize: 200,
			});

			const received1: Uint8Array[] = [];
			const received2: Uint8Array[] = [];

			t1.onMessage = (_, msg) => received1.push(msg);
			t2.onMessage = (_, msg) => received2.push(msg);

			await t1.connect("peer-2");

			// Send from both directions
			const msg1 = generateCompressibleData(500);
			const msg2 = generateCompressibleData(300);

			t1.send("peer-2", msg1, true);
			t2.send("peer-1", msg2, true);

			local1.flush();
			local2.flush();

			assert.strictEqual(received1.length, 1);
			assert.strictEqual(received2.length, 1);
			assert.deepStrictEqual(received1[0], msg2);
			assert.deepStrictEqual(received2[0], msg1);

			t1.dispose();
			t2.dispose();
		});
	});

	describe("timeout and cleanup", () => {
		it("should clean up state on peer disconnect", async () => {
			const { t1, t2 } = createTransformingPair();

			await t1.connect("peer-2");
			t1.disconnect("peer-2");

			// State should be cleaned up (we can't directly verify internal state,
			// but we can verify no errors occur on subsequent operations)
			t1.dispose();
			t2.dispose();
		});

		it("should clean up state on dispose", async () => {
			const { t1, t2 } = createTransformingPair();

			await t1.connect("peer-2");
			t1.dispose();
			t2.dispose();

			// No errors should occur
		});

		it("should clean up state on disconnectAll", async () => {
			const { t1, t2 } = createTransformingPair();

			await t1.connect("peer-2");
			t1.disconnectAll();

			t1.dispose();
			t2.dispose();
		});
	});

	describe("edge cases", () => {
		it("should handle empty message", async () => {
			const { t1, t2, local1 } = createTransformingPair({
				compression: "never",
				segmentation: false,
			});

			const received: Uint8Array[] = [];
			t2.onMessage = (_, msg) => received.push(msg);

			await t1.connect("peer-2");
			t1.send("peer-2", new Uint8Array(0), true);
			local1.flush();

			assert.strictEqual(received.length, 1);
			assert.strictEqual(received[0]?.length, 0);

			t1.dispose();
			t2.dispose();
		});

		it("should handle single byte message", async () => {
			const { t1, t2, local1 } = createTransformingPair({
				compression: "auto",
				segmentation: true,
			});

			const received: Uint8Array[] = [];
			t2.onMessage = (_, msg) => received.push(msg);

			await t1.connect("peer-2");
			t1.send("peer-2", new Uint8Array([42]), true);
			local1.flush();

			assert.strictEqual(received.length, 1);
			assert.deepStrictEqual(received[0], new Uint8Array([42]));

			t1.dispose();
			t2.dispose();
		});

		it("should handle message at exact compression threshold", async () => {
			const threshold = 128;
			const { t1, t2, local1 } = createTransformingPair({
				compression: "auto",
				compressionThreshold: threshold,
				segmentation: false,
			});

			const received: Uint8Array[] = [];
			t2.onMessage = (_, msg) => received.push(msg);

			await t1.connect("peer-2");

			// Message at exact threshold
			const original = generateCompressibleData(threshold);
			t1.send("peer-2", original, true);
			local1.flush();

			assert.strictEqual(received.length, 1);
			assert.deepStrictEqual(received[0], original);

			t1.dispose();
			t2.dispose();
		});

		it("should handle message at exact segment size", async () => {
			const maxSegmentSize = 100;
			// Account for segment header (8) and compression header (1)
			const payloadSize = maxSegmentSize - 8 - 1;

			const { t1, t2, local1 } = createTransformingPair({
				compression: "never",
				segmentation: true,
				maxSegmentSize,
			});

			const received: Uint8Array[] = [];
			t2.onMessage = (_, msg) => received.push(msg);

			await t1.connect("peer-2");

			const original = generateCompressibleData(payloadSize);
			t1.send("peer-2", original, true);
			local1.flush();

			assert.strictEqual(received.length, 1);
			assert.deepStrictEqual(received[0], original);

			t1.dispose();
			t2.dispose();
		});

		it("should ignore invalid segments (too short)", async () => {
			const local1 = new LocalTransport("peer-1");
			const local2 = new LocalTransport("peer-2");
			LocalTransport.link(local1, local2);

			const t2 = new TransformingTransport(local2, {});

			const received: Uint8Array[] = [];
			t2.onMessage = (_, msg) => received.push(msg);

			await local1.connect("peer-2");

			// Send invalid segment (too short for header)
			local1.send("peer-2", new Uint8Array([1, 2, 3]), true);
			local1.flush();

			// Should be ignored
			assert.strictEqual(received.length, 0);

			t2.dispose();
		});

		it("should ignore segments with mismatched total", async () => {
			const local1 = new LocalTransport("peer-1");
			const local2 = new LocalTransport("peer-2");
			LocalTransport.link(local1, local2);

			const t2 = new TransformingTransport(local2, {});

			const received: Uint8Array[] = [];
			t2.onMessage = (_, msg) => received.push(msg);

			await local1.connect("peer-2");

			// Create two segments with same messageId but different total
			const segment1 = new Uint8Array(20);
			const view1 = new DataView(segment1.buffer);
			view1.setUint32(0, 1, true); // messageId
			view1.setUint16(4, 0, true); // index
			view1.setUint16(6, 2, true); // total = 2

			const segment2 = new Uint8Array(20);
			const view2 = new DataView(segment2.buffer);
			view2.setUint32(0, 1, true); // same messageId
			view2.setUint16(4, 1, true); // index = 1
			view2.setUint16(6, 3, true); // different total = 3

			local1.send("peer-2", segment1, true);
			local1.send("peer-2", segment2, true);
			local1.flush();

			// Should not reassemble (mismatched totals)
			assert.strictEqual(received.length, 0);

			t2.dispose();
		});

		it("should ignore segments with index >= total", async () => {
			const local1 = new LocalTransport("peer-1");
			const local2 = new LocalTransport("peer-2");
			LocalTransport.link(local1, local2);

			const t2 = new TransformingTransport(local2, {});

			const received: Uint8Array[] = [];
			t2.onMessage = (_, msg) => received.push(msg);

			await local1.connect("peer-2");

			// Create segment with invalid index (index >= total)
			const segment = new Uint8Array(20);
			const view = new DataView(segment.buffer);
			view.setUint32(0, 1, true); // messageId
			view.setUint16(4, 5, true); // index = 5 (invalid: >= total)
			view.setUint16(6, 3, true); // total = 3

			local1.send("peer-2", segment, true);
			local1.flush();

			// Should be ignored
			assert.strictEqual(received.length, 0);

			t2.dispose();
		});

		it("should ignore segments with excessive total", async () => {
			const local1 = new LocalTransport("peer-1");
			const local2 = new LocalTransport("peer-2");
			LocalTransport.link(local1, local2);

			const t2 = new TransformingTransport(local2, {});

			const received: Uint8Array[] = [];
			t2.onMessage = (_, msg) => received.push(msg);

			await local1.connect("peer-2");

			// Create segment with excessive total (> MAX_SEGMENTS_PER_MESSAGE)
			const segment = new Uint8Array(20);
			const view = new DataView(segment.buffer);
			view.setUint32(0, 1, true); // messageId
			view.setUint16(4, 0, true); // index = 0
			view.setUint16(6, 10000, true); // total = 10000 (exceeds limit of 4096)

			local1.send("peer-2", segment, true);
			local1.flush();

			// Should be ignored
			assert.strictEqual(received.length, 0);

			t2.dispose();
		});
	});

	describe("broadcast", () => {
		it("should broadcast to multiple peers with unique message IDs", async () => {
			const local1 = new LocalTransport("peer-1");
			const local2 = new LocalTransport("peer-2");
			const local3 = new LocalTransport("peer-3");

			LocalTransport.link(local1, local2);
			LocalTransport.link(local1, local3);
			LocalTransport.link(local2, local3);

			const t1 = new TransformingTransport(local1, {
				compression: "never",
				segmentation: true,
				maxSegmentSize: 50,
			});
			const t2 = new TransformingTransport(local2, {
				compression: "never",
				segmentation: true,
				maxSegmentSize: 50,
			});
			const t3 = new TransformingTransport(local3, {
				compression: "never",
				segmentation: true,
				maxSegmentSize: 50,
			});

			const received2: Uint8Array[] = [];
			const received3: Uint8Array[] = [];

			t2.onMessage = (_, msg) => received2.push(msg);
			t3.onMessage = (_, msg) => received3.push(msg);

			await t1.connect("peer-2");
			await t1.connect("peer-3");

			const original = generateCompressibleData(100);
			t1.broadcast(original, true);

			local1.flush();

			assert.strictEqual(received2.length, 1);
			assert.strictEqual(received3.length, 1);
			assert.deepStrictEqual(received2[0], original);
			assert.deepStrictEqual(received3[0], original);

			t1.dispose();
			t2.dispose();
			t3.dispose();
		});
	});

	describe("multiple concurrent messages", () => {
		it("should handle multiple concurrent large messages", async () => {
			const { t1, t2, local1 } = createTransformingPair({
				compression: "never",
				segmentation: true,
				maxSegmentSize: 50,
			});

			const received: Uint8Array[] = [];
			t2.onMessage = (_, msg) => received.push(msg);

			await t1.connect("peer-2");

			// Send multiple large messages
			const msg1 = generateCompressibleData(100);
			const msg2 = generateCompressibleData(150);
			const msg3 = generateCompressibleData(80);

			t1.send("peer-2", msg1, true);
			t1.send("peer-2", msg2, true);
			t1.send("peer-2", msg3, true);

			local1.flush();

			// All messages should be received (order may vary due to reassembly timing)
			assert.strictEqual(received.length, 3);

			// Helper to check if a message is present in received array
			const hasMessage = (expected: Uint8Array) =>
				received.some(
					(r) =>
						r.length === expected.length &&
						r.every((b, i) => b === expected[i]),
				);

			assert.ok(hasMessage(msg1), "msg1 should be received");
			assert.ok(hasMessage(msg2), "msg2 should be received");
			assert.ok(hasMessage(msg3), "msg3 should be received");

			t1.dispose();
			t2.dispose();
		});
	});

	describe("properties", () => {
		it("should expose connectedPeers from inner transport", async () => {
			const { t1, t2 } = createTransformingPair();

			assert.strictEqual(t1.connectedPeers.size, 0);
			await t1.connect("peer-2");
			assert.strictEqual(t1.connectedPeers.size, 1);
			assert.ok(t1.connectedPeers.has("peer-2"));

			t1.dispose();
			t2.dispose();
		});

		it("should expose localPeerId from inner transport", () => {
			const { t1, t2 } = createTransformingPair();

			assert.strictEqual(t1.localPeerId, "peer-1");
			assert.strictEqual(t2.localPeerId, "peer-2");

			t1.dispose();
			t2.dispose();
		});
	});

	describe("default configuration", () => {
		it("should have sensible defaults", () => {
			assert.strictEqual(DEFAULT_TRANSFORMING_TRANSPORT_CONFIG.compression, "auto");
			assert.strictEqual(DEFAULT_TRANSFORMING_TRANSPORT_CONFIG.compressionThreshold, 128);
			assert.strictEqual(DEFAULT_TRANSFORMING_TRANSPORT_CONFIG.segmentation, true);
			assert.strictEqual(DEFAULT_TRANSFORMING_TRANSPORT_CONFIG.maxSegmentSize, 16000);
			assert.strictEqual(DEFAULT_TRANSFORMING_TRANSPORT_CONFIG.reassemblyTimeout, 5000);
		});
	});
});
