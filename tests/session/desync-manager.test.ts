import assert from "node:assert";
import { describe, it } from "node:test";
import { DesyncAuthority, Topology, asPlayerId, asTick } from "../../src/types.js";
import { DesyncManager } from "../../src/session/desync-manager.js";

describe("DesyncManager", () => {
	describe("isHostAuthority", () => {
		it("should return true for Mesh topology with Host authority", () => {
			const manager = new DesyncManager({
				topology: Topology.Mesh,
				desyncAuthority: DesyncAuthority.Host,
				hashInterval: 60,
			});
			assert.strictEqual(manager.isHostAuthority, true);
		});

		it("should return false for Mesh topology with Peer authority", () => {
			const manager = new DesyncManager({
				topology: Topology.Mesh,
				desyncAuthority: DesyncAuthority.Peer,
				hashInterval: 60,
			});
			assert.strictEqual(manager.isHostAuthority, false);
		});

		it("should return false for Star topology with Host authority", () => {
			const manager = new DesyncManager({
				topology: Topology.Star,
				desyncAuthority: DesyncAuthority.Host,
				hashInterval: 60,
			});
			assert.strictEqual(manager.isHostAuthority, false);
		});

		it("should return false for Star topology with Peer authority", () => {
			const manager = new DesyncManager({
				topology: Topology.Star,
				desyncAuthority: DesyncAuthority.Peer,
				hashInterval: 60,
			});
			assert.strictEqual(manager.isHostAuthority, false);
		});
	});

	describe("recordHash", () => {
		it("should record a hash for a player at a tick", () => {
			const manager = new DesyncManager({
				topology: Topology.Mesh,
				desyncAuthority: DesyncAuthority.Host,
				hashInterval: 60,
			});

			manager.recordHash(asTick(100), asPlayerId("player1"), 12345);

			assert.strictEqual(manager.hasAllHashes(asTick(100), 1), true);
		});

		it("should record hashes from multiple players at same tick", () => {
			const manager = new DesyncManager({
				topology: Topology.Mesh,
				desyncAuthority: DesyncAuthority.Host,
				hashInterval: 60,
			});

			manager.recordHash(asTick(100), asPlayerId("player1"), 12345);
			manager.recordHash(asTick(100), asPlayerId("player2"), 12345);

			assert.strictEqual(manager.hasAllHashes(asTick(100), 2), true);
		});

		it("should record hashes at different ticks", () => {
			const manager = new DesyncManager({
				topology: Topology.Mesh,
				desyncAuthority: DesyncAuthority.Host,
				hashInterval: 60,
			});

			manager.recordHash(asTick(100), asPlayerId("player1"), 12345);
			manager.recordHash(asTick(200), asPlayerId("player1"), 67890);

			assert.strictEqual(manager.hasAllHashes(asTick(100), 1), true);
			assert.strictEqual(manager.hasAllHashes(asTick(200), 1), true);
		});
	});

	describe("hasAllHashes", () => {
		it("should return false when no hashes recorded", () => {
			const manager = new DesyncManager({
				topology: Topology.Mesh,
				desyncAuthority: DesyncAuthority.Host,
				hashInterval: 60,
			});

			assert.strictEqual(manager.hasAllHashes(asTick(100), 2), false);
		});

		it("should return false when fewer hashes than expected", () => {
			const manager = new DesyncManager({
				topology: Topology.Mesh,
				desyncAuthority: DesyncAuthority.Host,
				hashInterval: 60,
			});

			manager.recordHash(asTick(100), asPlayerId("player1"), 12345);

			assert.strictEqual(manager.hasAllHashes(asTick(100), 2), false);
		});

		it("should return true when enough hashes recorded", () => {
			const manager = new DesyncManager({
				topology: Topology.Mesh,
				desyncAuthority: DesyncAuthority.Host,
				hashInterval: 60,
			});

			manager.recordHash(asTick(100), asPlayerId("player1"), 12345);
			manager.recordHash(asTick(100), asPlayerId("player2"), 12345);

			assert.strictEqual(manager.hasAllHashes(asTick(100), 2), true);
		});
	});

	describe("checkDesyncs", () => {
		it("should return empty array when no hashes recorded", () => {
			const manager = new DesyncManager({
				topology: Topology.Mesh,
				desyncAuthority: DesyncAuthority.Host,
				hashInterval: 60,
			});

			const desyncs = manager.checkDesyncs(asTick(100), asPlayerId("host"));

			assert.deepStrictEqual(desyncs, []);
		});

		it("should return empty array when host hash not found", () => {
			const manager = new DesyncManager({
				topology: Topology.Mesh,
				desyncAuthority: DesyncAuthority.Host,
				hashInterval: 60,
			});

			manager.recordHash(asTick(100), asPlayerId("player1"), 12345);

			const desyncs = manager.checkDesyncs(asTick(100), asPlayerId("host"));

			assert.deepStrictEqual(desyncs, []);
		});

		it("should return empty array when all hashes match", () => {
			const manager = new DesyncManager({
				topology: Topology.Mesh,
				desyncAuthority: DesyncAuthority.Host,
				hashInterval: 60,
			});

			manager.recordHash(asTick(100), asPlayerId("host"), 12345);
			manager.recordHash(asTick(100), asPlayerId("player1"), 12345);
			manager.recordHash(asTick(100), asPlayerId("player2"), 12345);

			const desyncs = manager.checkDesyncs(asTick(100), asPlayerId("host"));

			assert.deepStrictEqual(desyncs, []);
		});

		it("should detect desync when hashes differ", () => {
			const manager = new DesyncManager({
				topology: Topology.Mesh,
				desyncAuthority: DesyncAuthority.Host,
				hashInterval: 60,
			});

			manager.recordHash(asTick(100), asPlayerId("host"), 12345);
			manager.recordHash(asTick(100), asPlayerId("player1"), 99999);

			const desyncs = manager.checkDesyncs(asTick(100), asPlayerId("host"));

			assert.strictEqual(desyncs.length, 1);
			const desync = desyncs[0];
			assert.ok(desync);
			assert.strictEqual(desync.tick, asTick(100));
			assert.strictEqual(desync.desyncedPlayerId, asPlayerId("player1"));
			assert.strictEqual(desync.referenceHash, 12345);
			assert.strictEqual(desync.playerHash, 99999);
		});

		it("should detect multiple desyncs", () => {
			const manager = new DesyncManager({
				topology: Topology.Mesh,
				desyncAuthority: DesyncAuthority.Host,
				hashInterval: 60,
			});

			manager.recordHash(asTick(100), asPlayerId("host"), 12345);
			manager.recordHash(asTick(100), asPlayerId("player1"), 11111);
			manager.recordHash(asTick(100), asPlayerId("player2"), 22222);
			manager.recordHash(asTick(100), asPlayerId("player3"), 12345); // matches

			const desyncs = manager.checkDesyncs(asTick(100), asPlayerId("host"));

			assert.strictEqual(desyncs.length, 2);
			const desyncedIds = desyncs.map((d) => d.desyncedPlayerId);
			assert.ok(desyncedIds.includes(asPlayerId("player1")));
			assert.ok(desyncedIds.includes(asPlayerId("player2")));
		});
	});

	describe("checkPeerDesync", () => {
		it("should return null when local hash is undefined", () => {
			const manager = new DesyncManager({
				topology: Topology.Mesh,
				desyncAuthority: DesyncAuthority.Peer,
				hashInterval: 60,
			});

			const result = manager.checkPeerDesync(
				asTick(100),
				undefined,
				12345,
				asPlayerId("remote"),
			);

			assert.strictEqual(result, null);
		});

		it("should return null when hashes match", () => {
			const manager = new DesyncManager({
				topology: Topology.Mesh,
				desyncAuthority: DesyncAuthority.Peer,
				hashInterval: 60,
			});

			const result = manager.checkPeerDesync(
				asTick(100),
				12345,
				12345,
				asPlayerId("remote"),
			);

			assert.strictEqual(result, null);
		});

		it("should return desync result when hashes differ", () => {
			const manager = new DesyncManager({
				topology: Topology.Mesh,
				desyncAuthority: DesyncAuthority.Peer,
				hashInterval: 60,
			});

			const result = manager.checkPeerDesync(
				asTick(100),
				12345,
				99999,
				asPlayerId("remote"),
			);

			assert.ok(result);
			assert.strictEqual(result.tick, asTick(100));
			assert.strictEqual(result.localHash, 12345);
			assert.strictEqual(result.remoteHash, 99999);
			assert.strictEqual(result.remotePlayerId, asPlayerId("remote"));
		});
	});

	describe("pruneOldHashes", () => {
		it("should remove hashes older than 2x hashInterval", () => {
			const manager = new DesyncManager({
				topology: Topology.Mesh,
				desyncAuthority: DesyncAuthority.Host,
				hashInterval: 60,
			});

			manager.recordHash(asTick(0), asPlayerId("player1"), 1);
			manager.recordHash(asTick(60), asPlayerId("player1"), 2);
			manager.recordHash(asTick(120), asPlayerId("player1"), 3);
			manager.recordHash(asTick(180), asPlayerId("player1"), 4);

			// Prune at tick 180, should remove ticks < 60 (180 - 60*2)
			manager.pruneOldHashes(asTick(180));

			assert.strictEqual(manager.hasAllHashes(asTick(0), 1), false);
			assert.strictEqual(manager.hasAllHashes(asTick(60), 1), true);
			assert.strictEqual(manager.hasAllHashes(asTick(120), 1), true);
			assert.strictEqual(manager.hasAllHashes(asTick(180), 1), true);
		});

		it("should handle empty state", () => {
			const manager = new DesyncManager({
				topology: Topology.Mesh,
				desyncAuthority: DesyncAuthority.Host,
				hashInterval: 60,
			});

			// Should not throw
			manager.pruneOldHashes(asTick(1000));
		});
	});

	describe("clear", () => {
		it("should remove all stored hashes", () => {
			const manager = new DesyncManager({
				topology: Topology.Mesh,
				desyncAuthority: DesyncAuthority.Host,
				hashInterval: 60,
			});

			manager.recordHash(asTick(100), asPlayerId("player1"), 12345);
			manager.recordHash(asTick(200), asPlayerId("player1"), 67890);

			manager.clear();

			assert.strictEqual(manager.hasAllHashes(asTick(100), 1), false);
			assert.strictEqual(manager.hasAllHashes(asTick(200), 1), false);
		});
	});
});
