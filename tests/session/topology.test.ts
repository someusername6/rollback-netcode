import assert from "node:assert";
import { describe, it } from "node:test";
import {
	StarTopology,
	MeshTopology,
	createTopologyStrategy,
} from "../../src/session/topology.js";
import { Topology as TopologyType } from "../../src/types.js";

describe("Topology", () => {
	describe("StarTopology", () => {
		it("should have type Star", () => {
			const topology = new StarTopology();
			assert.strictEqual(topology.type, TopologyType.Star);
		});

		describe("shouldRelayInput", () => {
			it("should return true when current session is host", () => {
				const topology = new StarTopology();
				assert.strictEqual(
					topology.shouldRelayInput("peer1", true),
					true,
					"Host should relay inputs",
				);
			});

			it("should return false when current session is not host", () => {
				const topology = new StarTopology();
				assert.strictEqual(
					topology.shouldRelayInput("peer1", false),
					false,
					"Non-host should not relay inputs",
				);
			});

			it("should return true for any peer when host", () => {
				const topology = new StarTopology();
				assert.strictEqual(topology.shouldRelayInput("peer1", true), true);
				assert.strictEqual(topology.shouldRelayInput("peer2", true), true);
				assert.strictEqual(topology.shouldRelayInput("host", true), true);
			});
		});

		describe("getRelayTargets", () => {
			it("should return all peers except the sender", () => {
				const topology = new StarTopology();
				const allPeers = new Set(["peer1", "peer2", "peer3"]);

				const targets = topology.getRelayTargets("peer1", allPeers);

				assert.deepStrictEqual(targets.sort(), ["peer2", "peer3"]);
			});

			it("should return empty array when sender is only peer", () => {
				const topology = new StarTopology();
				const allPeers = new Set(["peer1"]);

				const targets = topology.getRelayTargets("peer1", allPeers);

				assert.deepStrictEqual(targets, []);
			});

			it("should return all peers when sender not in list", () => {
				const topology = new StarTopology();
				const allPeers = new Set(["peer2", "peer3"]);

				const targets = topology.getRelayTargets("peer1", allPeers);

				assert.deepStrictEqual(targets.sort(), ["peer2", "peer3"]);
			});

			it("should handle empty peer set", () => {
				const topology = new StarTopology();
				const allPeers = new Set<string>();

				const targets = topology.getRelayTargets("peer1", allPeers);

				assert.deepStrictEqual(targets, []);
			});

			it("should handle many peers", () => {
				const topology = new StarTopology();
				const allPeers = new Set(["p1", "p2", "p3", "p4", "p5", "p6"]);

				const targets = topology.getRelayTargets("p1", allPeers);

				assert.strictEqual(targets.length, 5);
				assert.ok(!targets.includes("p1"));
			});
		});
	});

	describe("MeshTopology", () => {
		it("should have type Mesh", () => {
			const topology = new MeshTopology();
			assert.strictEqual(topology.type, TopologyType.Mesh);
		});

		describe("shouldRelayInput", () => {
			it("should always return false (no relaying in mesh)", () => {
				const topology = new MeshTopology();

				// Neither host nor non-host should relay
				assert.strictEqual(
					topology.shouldRelayInput("peer1", true),
					false,
					"Host should not relay in mesh",
				);
				assert.strictEqual(
					topology.shouldRelayInput("peer1", false),
					false,
					"Non-host should not relay in mesh",
				);
			});

			it("should return false for any peer", () => {
				const topology = new MeshTopology();
				assert.strictEqual(topology.shouldRelayInput("peer1", true), false);
				assert.strictEqual(topology.shouldRelayInput("peer2", false), false);
				assert.strictEqual(topology.shouldRelayInput("host", true), false);
			});
		});

		describe("getRelayTargets", () => {
			it("should always return empty array (no relaying in mesh)", () => {
				const topology = new MeshTopology();
				const allPeers = new Set(["peer1", "peer2", "peer3"]);

				const targets = topology.getRelayTargets("peer1", allPeers);

				assert.deepStrictEqual(targets, []);
			});

			it("should return empty array regardless of peer count", () => {
				const topology = new MeshTopology();
				const manyPeers = new Set(["p1", "p2", "p3", "p4", "p5"]);

				assert.deepStrictEqual(topology.getRelayTargets("p1", manyPeers), []);
				assert.deepStrictEqual(
					topology.getRelayTargets("p1", new Set<string>()),
					[],
				);
			});
		});
	});

	describe("createTopologyStrategy", () => {
		it("should create StarTopology for Star type", () => {
			const strategy = createTopologyStrategy(TopologyType.Star);

			assert.ok(strategy instanceof StarTopology);
			assert.strictEqual(strategy.type, TopologyType.Star);
		});

		it("should create MeshTopology for Mesh type", () => {
			const strategy = createTopologyStrategy(TopologyType.Mesh);

			assert.ok(strategy instanceof MeshTopology);
			assert.strictEqual(strategy.type, TopologyType.Mesh);
		});

		it("should throw for unknown topology type", () => {
			// Force an invalid type to test the exhaustive check
			const invalidType = "invalid" as TopologyType;

			assert.throws(
				() => createTopologyStrategy(invalidType),
				/Unknown topology/,
			);
		});
	});

	describe("topology comparison", () => {
		it("Star topology should relay while Mesh should not", () => {
			const star = createTopologyStrategy(TopologyType.Star);
			const mesh = createTopologyStrategy(TopologyType.Mesh);
			const peers = new Set(["p1", "p2", "p3"]);

			// Star relays when host
			assert.strictEqual(star.shouldRelayInput("p1", true), true);
			assert.deepStrictEqual(star.getRelayTargets("p1", peers).sort(), [
				"p2",
				"p3",
			]);

			// Mesh never relays
			assert.strictEqual(mesh.shouldRelayInput("p1", true), false);
			assert.deepStrictEqual(mesh.getRelayTargets("p1", peers), []);
		});
	});
});
