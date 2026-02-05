import assert from "node:assert";
import { describe, it } from "node:test";
import { LocalTransport, createLocalTransportGroup } from "../../src/transport/local.js";

describe("LocalTransport", () => {
	describe("basic messaging", () => {
		it("should send and receive messages between linked transports", async () => {
			const t1 = new LocalTransport("peer-1");
			const t2 = new LocalTransport("peer-2");
			LocalTransport.link(t1, t2);

			const received: { peerId: string; message: Uint8Array }[] = [];
			t2.onMessage = (peerId, message) => {
				received.push({ peerId, message });
			};

			// Connect and send
			await t1.connect("peer-2");
			t1.send("peer-2", new Uint8Array([1, 2, 3]), true);
			t1.flush();

			assert.strictEqual(received.length, 1);
			assert.strictEqual(received[0]?.peerId, "peer-1");
			assert.deepStrictEqual(received[0]?.message, new Uint8Array([1, 2, 3]));
		});

		it("should require linking before connecting", async () => {
			const t1 = new LocalTransport("peer-1");

			await assert.rejects(() => t1.connect("peer-2"), /not linked/);
		});

		it("should not send to unconnected peers", () => {
			const t1 = new LocalTransport("peer-1");
			const t2 = new LocalTransport("peer-2");
			LocalTransport.link(t1, t2);

			const received: Uint8Array[] = [];
			t2.onMessage = (_, msg) => received.push(msg);

			// Send without connecting
			t1.send("peer-2", new Uint8Array([1]), true);
			t1.flush();

			assert.strictEqual(received.length, 0);
		});
	});

	describe("connection lifecycle", () => {
		it("should fire onConnect callbacks on both sides", async () => {
			const t1 = new LocalTransport("peer-1");
			const t2 = new LocalTransport("peer-2");
			LocalTransport.link(t1, t2);

			const connects1: string[] = [];
			const connects2: string[] = [];

			t1.onConnect = (peerId) => connects1.push(peerId);
			t2.onConnect = (peerId) => connects2.push(peerId);

			await t1.connect("peer-2");

			assert.deepStrictEqual(connects1, ["peer-2"]);
			assert.deepStrictEqual(connects2, ["peer-1"]);
		});

		it("should update connectedPeers on both sides", async () => {
			const t1 = new LocalTransport("peer-1");
			const t2 = new LocalTransport("peer-2");
			LocalTransport.link(t1, t2);

			await t1.connect("peer-2");

			assert.strictEqual(t1.connectedPeers.has("peer-2"), true);
			assert.strictEqual(t2.connectedPeers.has("peer-1"), true);
		});

		it("should fire onDisconnect callbacks on disconnect", async () => {
			const t1 = new LocalTransport("peer-1");
			const t2 = new LocalTransport("peer-2");
			LocalTransport.link(t1, t2);

			const disconnects1: string[] = [];
			const disconnects2: string[] = [];

			t1.onDisconnect = (peerId) => disconnects1.push(peerId);
			t2.onDisconnect = (peerId) => disconnects2.push(peerId);

			await t1.connect("peer-2");
			t1.disconnect("peer-2");

			assert.deepStrictEqual(disconnects1, ["peer-2"]);
			assert.deepStrictEqual(disconnects2, ["peer-1"]);
		});

		it("should clear connectedPeers on disconnect", async () => {
			const t1 = new LocalTransport("peer-1");
			const t2 = new LocalTransport("peer-2");
			LocalTransport.link(t1, t2);

			await t1.connect("peer-2");
			t1.disconnect("peer-2");

			assert.strictEqual(t1.connectedPeers.has("peer-2"), false);
			assert.strictEqual(t2.connectedPeers.has("peer-1"), false);
		});

		it("should disconnect all peers with disconnectAll", async () => {
			const t1 = new LocalTransport("peer-1");
			const t2 = new LocalTransport("peer-2");
			const t3 = new LocalTransport("peer-3");
			LocalTransport.link(t1, t2);
			LocalTransport.link(t1, t3);

			await t1.connect("peer-2");
			await t1.connect("peer-3");

			assert.strictEqual(t1.connectedPeers.size, 2);

			t1.disconnectAll();

			assert.strictEqual(t1.connectedPeers.size, 0);
			assert.strictEqual(t2.connectedPeers.size, 0);
			assert.strictEqual(t3.connectedPeers.size, 0);
		});
	});

	describe("broadcast", () => {
		it("should send to all connected peers", async () => {
			const t1 = new LocalTransport("peer-1");
			const t2 = new LocalTransport("peer-2");
			const t3 = new LocalTransport("peer-3");
			LocalTransport.link(t1, t2);
			LocalTransport.link(t1, t3);

			const received2: Uint8Array[] = [];
			const received3: Uint8Array[] = [];

			t2.onMessage = (_, msg) => received2.push(msg);
			t3.onMessage = (_, msg) => received3.push(msg);

			await t1.connect("peer-2");
			await t1.connect("peer-3");

			t1.broadcast(new Uint8Array([42]), true);
			t1.flush();

			assert.strictEqual(received2.length, 1);
			assert.strictEqual(received3.length, 1);
			assert.deepStrictEqual(received2[0], new Uint8Array([42]));
			assert.deepStrictEqual(received3[0], new Uint8Array([42]));
		});
	});

	describe("latency simulation", () => {
		it("should delay messages based on latency config", async () => {
			const t1 = new LocalTransport("peer-1", { latency: 50 });
			const t2 = new LocalTransport("peer-2");
			LocalTransport.link(t1, t2);

			const received: Uint8Array[] = [];
			t2.onMessage = (_, msg) => received.push(msg);

			await t1.connect("peer-2");
			t1.send("peer-2", new Uint8Array([1]), true);

			// Message should be pending
			assert.strictEqual(received.length, 0);
			assert.strictEqual(t1.getPendingMessageCount(), 1);

			// Advance time partially
			t1.tick(25);
			assert.strictEqual(received.length, 0);

			// Advance time past latency
			t1.tick(30);
			assert.strictEqual(received.length, 1);
		});

		it("should deliver messages in order based on timing", async () => {
			const t1 = new LocalTransport("peer-1", { latency: 50 });
			const t2 = new LocalTransport("peer-2");
			LocalTransport.link(t1, t2);

			const received: number[] = [];
			t2.onMessage = (_, msg) => received.push(msg[0] ?? 0);

			await t1.connect("peer-2");

			t1.send("peer-2", new Uint8Array([1]), true);
			t1.tick(20);
			t1.send("peer-2", new Uint8Array([2]), true);
			t1.tick(20);
			t1.send("peer-2", new Uint8Array([3]), true);

			// At t=40, message 1 should be pending (due at 50), 2 at 70, 3 at 90
			assert.strictEqual(received.length, 0);

			t1.tick(15); // t=55
			assert.deepStrictEqual(received, [1]);

			t1.tick(20); // t=75
			assert.deepStrictEqual(received, [1, 2]);

			t1.tick(20); // t=95
			assert.deepStrictEqual(received, [1, 2, 3]);
		});
	});

	describe("packet loss simulation", () => {
		it("should drop unreliable packets based on loss rate", async () => {
			const t1 = new LocalTransport("peer-1", {
				packetLoss: 0.5,
				deterministic: true,
				seed: 42,
			});
			const t2 = new LocalTransport("peer-2");
			LocalTransport.link(t1, t2);

			const received: Uint8Array[] = [];
			t2.onMessage = (_, msg) => received.push(msg);

			await t1.connect("peer-2");

			// Send many unreliable messages
			for (let i = 0; i < 100; i++) {
				t1.send("peer-2", new Uint8Array([i]), false);
			}
			t1.flush();

			// Should lose roughly half due to 50% packet loss
			assert.ok(received.length > 30 && received.length < 70);
		});

		it("should not drop reliable packets regardless of loss rate", async () => {
			const t1 = new LocalTransport("peer-1", {
				packetLoss: 0.9,
				deterministic: true,
				seed: 42,
			});
			const t2 = new LocalTransport("peer-2");
			LocalTransport.link(t1, t2);

			const received: Uint8Array[] = [];
			t2.onMessage = (_, msg) => received.push(msg);

			await t1.connect("peer-2");

			// Send reliable messages
			for (let i = 0; i < 100; i++) {
				t1.send("peer-2", new Uint8Array([i]), true);
			}
			t1.flush();

			// All should arrive
			assert.strictEqual(received.length, 100);
		});
	});

	describe("deterministic mode", () => {
		it("should produce same results with same seed", async () => {
			const runTest = async (seed: number): Promise<number[]> => {
				const t1 = new LocalTransport("peer-1", {
					packetLoss: 0.5,
					deterministic: true,
					seed,
				});
				const t2 = new LocalTransport("peer-2");
				LocalTransport.link(t1, t2);

				const received: number[] = [];
				t2.onMessage = (_, msg) => received.push(msg[0] ?? 0);

				await t1.connect("peer-2");

				for (let i = 0; i < 20; i++) {
					t1.send("peer-2", new Uint8Array([i]), false);
				}
				t1.flush();

				return received;
			};

			const result1 = await runTest(12345);
			const result2 = await runTest(12345);
			const result3 = await runTest(99999);

			// Same seed should produce same results
			assert.deepStrictEqual(result1, result2);

			// Different seed should produce different results (with high probability)
			assert.notDeepStrictEqual(result1, result3);
		});
	});

	describe("message copying", () => {
		it("should copy messages to prevent external mutation", async () => {
			const t1 = new LocalTransport("peer-1");
			const t2 = new LocalTransport("peer-2");
			LocalTransport.link(t1, t2);

			let receivedMessage: Uint8Array | null = null;
			t2.onMessage = (_, msg) => {
				receivedMessage = msg;
			};

			await t1.connect("peer-2");

			const original = new Uint8Array([1, 2, 3]);
			t1.send("peer-2", original, true);

			// Mutate original before delivery
			original[0] = 99;

			t1.flush();

			assert.ok(receivedMessage);
			assert.strictEqual(receivedMessage[0], 1); // Should be original value
		});
	});

	describe("multiple peers", () => {
		it("should handle 4-player mesh network", async () => {
			const transports = createLocalTransportGroup(["p1", "p2", "p3", "p4"]);

			const received = new Map<string, number[]>();
			for (const [peerId, transport] of transports) {
				received.set(peerId, []);
				transport.onMessage = (fromPeerId, msg) => {
					received.get(peerId)?.push(msg[0] ?? 0);
				};
			}

			// Connect all peers
			for (const [peerId, transport] of transports) {
				for (const otherPeerId of transports.keys()) {
					if (peerId !== otherPeerId) {
						await transport.connect(otherPeerId);
					}
				}
			}

			// p1 broadcasts
			const p1 = transports.get("p1");
			assert.ok(p1, "p1 transport should exist");
			p1.broadcast(new Uint8Array([42]), true);
			p1.flush();

			// Others should receive
			assert.strictEqual(received.get("p1")?.length, 0);
			assert.deepStrictEqual(received.get("p2"), [42]);
			assert.deepStrictEqual(received.get("p3"), [42]);
			assert.deepStrictEqual(received.get("p4"), [42]);
		});
	});

	describe("unlinking", () => {
		it("should prevent messaging after unlink", async () => {
			const t1 = new LocalTransport("peer-1");
			const t2 = new LocalTransport("peer-2");
			LocalTransport.link(t1, t2);

			await t1.connect("peer-2");

			LocalTransport.unlink(t1, t2);

			// Connection still exists but messaging won't work
			// because deliverMessage checks linkedTransports
			const received: Uint8Array[] = [];
			t2.onMessage = (_, msg) => received.push(msg);

			t1.send("peer-2", new Uint8Array([1]), true);
			t1.flush();

			// Message delivered but peer check fails
			assert.strictEqual(received.length, 0);
		});
	});

	describe("createLocalTransportGroup", () => {
		it("should create linked transports", async () => {
			const transports = createLocalTransportGroup(["a", "b", "c"]);

			assert.strictEqual(transports.size, 3);
			assert.ok(transports.has("a"));
			assert.ok(transports.has("b"));
			assert.ok(transports.has("c"));

			// Should be able to connect any pair
			const a = transports.get("a");
			assert.ok(a, "a transport should exist");
			await a.connect("b");
			await a.connect("c");

			assert.strictEqual(a.connectedPeers.size, 2);
		});

		it("should apply shared config", async () => {
			const transports = createLocalTransportGroup(["a", "b"], {
				latency: 100,
			});

			const received: Uint8Array[] = [];
			const b = transports.get("b");
			assert.ok(b, "b transport should exist");
			b.onMessage = (_, msg) => received.push(msg);

			const a = transports.get("a");
			assert.ok(a, "a transport should exist");
			await a.connect("b");
			a.send("b", new Uint8Array([1]), true);

			// Should have latency
			assert.strictEqual(received.length, 0);

			a.tick(150);
			assert.strictEqual(received.length, 1);
		});
	});

	describe("edge cases", () => {
		it("should handle connecting to already connected peer", async () => {
			const t1 = new LocalTransport("peer-1");
			const t2 = new LocalTransport("peer-2");
			LocalTransport.link(t1, t2);

			let connectCount = 0;
			t2.onConnect = () => connectCount++;

			await t1.connect("peer-2");
			await t1.connect("peer-2"); // Second connect

			// Should only trigger once
			assert.strictEqual(connectCount, 1);
		});

		it("should handle disconnecting from non-connected peer", () => {
			const t1 = new LocalTransport("peer-1");

			// Should not throw
			t1.disconnect("peer-2");
		});

		it("should handle empty messages", async () => {
			const t1 = new LocalTransport("peer-1");
			const t2 = new LocalTransport("peer-2");
			LocalTransport.link(t1, t2);

			const received: Uint8Array[] = [];
			t2.onMessage = (_, msg) => received.push(msg);

			await t1.connect("peer-2");
			t1.send("peer-2", new Uint8Array(0), true);
			t1.flush();

			assert.strictEqual(received.length, 1);
			assert.strictEqual(received[0]?.length, 0);
		});
	});
});
