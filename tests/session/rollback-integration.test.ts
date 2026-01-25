import assert from "node:assert";
import { afterEach, describe, it } from "node:test";
import {
	type LocalTransport,
	createLocalTransportGroup,
} from "../../src/transport/local.js";
import {
	DesyncAuthority,
	Topology,
} from "../../src/types.js";
import { type Session, createSession } from "../../src/session/session.js";
import { TestGame, TestInputs, getTransport } from "../utils/test-helpers.js";

describe("Rollback Integration Tests", () => {
	// Track sessions for cleanup
	let activeSessions: Session[] = [];

	afterEach(() => {
		// Destroy all sessions created during the test
		for (const session of activeSessions) {
			session.destroy();
		}
		activeSessions = [];
	});

	/**
	 * Helper to create and track a session for automatic cleanup.
	 */
	function createTrackedSession(
		...args: Parameters<typeof createSession>
	): Session {
		const session = createSession(...args);
		activeSessions.push(session);
		return session;
	}

	describe("2-player rollback across topologies", () => {
		const topologies = [
			{ topology: Topology.Star, name: "Star" },
			{ topology: Topology.Mesh, name: "Mesh" },
		];

		const authorities = [
			{ authority: DesyncAuthority.Peer, name: "Peer" },
			{ authority: DesyncAuthority.Host, name: "Host" },
		];

		for (const { topology, name: topologyName } of topologies) {
			for (const { authority, name: authorityName } of authorities) {
				it(`should rollback when inputs arrive late (${topologyName} + ${authorityName})`, async () => {
					// 50ms latency at 60Hz tick rate means inputs arrive ~3 ticks late,
					// which should reliably trigger rollbacks when players send different inputs
					const transports = createLocalTransportGroup(["host", "client"], {
						latency: 50,
					});
					const hostTransport = getTransport(transports, "host");
					const clientTransport = getTransport(transports, "client");

					const hostGame = new TestGame();
					const clientGame = new TestGame();

					const config = {
						topology,
						desyncAuthority: authority,
					};

					const hostSession = createTrackedSession({
						game: hostGame,
						transport: hostTransport,
						config,
					});
					const clientSession = createTrackedSession({
						game: clientGame,
						transport: clientTransport,
						config,
					});

					await hostSession.createRoom();
					await clientSession.joinRoom(hostSession.roomId!, "host");

					// Flush initial handshake messages
					clientTransport.tick(100); // JoinRequest to host
					hostTransport.tick(100); // JoinAccept to client

					hostSession.start();
					hostTransport.tick(100); // StateSync to client

					// Run ticks with latency - different inputs will force rollbacks
					let hostRollbacks = 0;
					let clientRollbacks = 0;

					for (let i = 0; i < 20; i++) {
						const hostResult = hostSession.tick(TestInputs.MOVE_RIGHT);
						const clientResult = clientSession.tick(TestInputs.MOVE_LEFT);

						if (hostResult.rolledBack) hostRollbacks++;
						if (clientResult.rolledBack) clientRollbacks++;

						// Advance time to deliver messages (20ms per tick at 60Hz is ~1.2x real time)
						hostTransport.tick(20);
						clientTransport.tick(20);
					}

					// With 50ms latency and different inputs, we expect significant rollbacks.
					// At minimum, each side should rollback when the other's inputs arrive.
					const totalRollbacks = hostRollbacks + clientRollbacks;
					assert.ok(
						totalRollbacks >= 2,
						`${topologyName}+${authorityName}: Should have at least 2 rollbacks due to 50ms latency, got ${totalRollbacks}`,
					);

					// Deliver remaining messages
					hostTransport.tick(200);
					clientTransport.tick(200);

					// Run neutral ticks to let states converge
					for (let i = 0; i < 10; i++) {
						hostSession.tick(TestInputs.NEUTRAL);
						clientSession.tick(TestInputs.NEUTRAL);
						hostTransport.tick(20);
						clientTransport.tick(20);
					}

					// Final state should be in sync
					assert.strictEqual(
						hostGame.x,
						clientGame.x,
						`${topologyName}+${authorityName}: X positions should match after rollback`,
					);
					assert.strictEqual(
						hostGame.y,
						clientGame.y,
						`${topologyName}+${authorityName}: Y positions should match after rollback`,
					);
				});

				it(`should correctly resimulate state after rollback (${topologyName} + ${authorityName})`, async () => {
					// 30ms latency ensures some rollbacks while keeping test fast
					const transports = createLocalTransportGroup(["host", "client"], {
						latency: 30,
					});
					const hostTransport = getTransport(transports, "host");
					const clientTransport = getTransport(transports, "client");

					const hostGame = new TestGame();
					const clientGame = new TestGame();

					const config = {
						topology,
						desyncAuthority: authority,
					};

					const hostSession = createTrackedSession({
						game: hostGame,
						transport: hostTransport,
						config,
					});
					const clientSession = createTrackedSession({
						game: clientGame,
						transport: clientTransport,
						config,
					});

					await hostSession.createRoom();
					await clientSession.joinRoom(hostSession.roomId!, "host");
					clientTransport.tick(100);
					hostTransport.tick(100);

					hostSession.start();
					hostTransport.tick(100);

					// Host moves right 10 times, client moves down 10 times
					for (let i = 0; i < 10; i++) {
						hostSession.tick(TestInputs.MOVE_RIGHT);
						clientSession.tick(TestInputs.MOVE_DOWN);
						hostTransport.tick(20);
						clientTransport.tick(20);
					}

					// Flush remaining messages and let states converge
					for (let i = 0; i < 10; i++) {
						hostTransport.tick(50);
						clientTransport.tick(50);
						hostSession.tick(TestInputs.NEUTRAL);
						clientSession.tick(TestInputs.NEUTRAL);
					}

					// Both games should have:
					// - x = 10 * 10 = 100 (host's right movements)
					// - y = 10 * 10 = 100 (client's down movements)
					assert.strictEqual(
						hostGame.x,
						clientGame.x,
						`${topologyName}+${authorityName}: X should match`,
					);
					assert.strictEqual(
						hostGame.y,
						clientGame.y,
						`${topologyName}+${authorityName}: Y should match`,
					);
					assert.strictEqual(
						hostGame.x,
						100,
						`${topologyName}+${authorityName}: X should be 100`,
					);
					assert.strictEqual(
						hostGame.y,
						100,
						`${topologyName}+${authorityName}: Y should be 100`,
					);
				});
			}
		}
	});

	describe("3-player rollback across topologies", () => {
		const testCases = [
			{ topology: Topology.Star, authority: DesyncAuthority.Peer, name: "Star+Peer" },
			{ topology: Topology.Star, authority: DesyncAuthority.Host, name: "Star+Host" },
			{ topology: Topology.Mesh, authority: DesyncAuthority.Peer, name: "Mesh+Peer" },
			{ topology: Topology.Mesh, authority: DesyncAuthority.Host, name: "Mesh+Host" },
		];

		for (const { topology, authority, name } of testCases) {
			it(`should rollback correctly with 3 players (${name})`, async () => {
				// 40ms latency with 3 players creates more complex rollback scenarios
				const transports = createLocalTransportGroup(["host", "p2", "p3"], {
					latency: 40,
				});
				const hostTransport = getTransport(transports, "host");
				const p2Transport = getTransport(transports, "p2");
				const p3Transport = getTransport(transports, "p3");

				const hostGame = new TestGame();
				const p2Game = new TestGame();
				const p3Game = new TestGame();

				const config = {
					topology,
					desyncAuthority: authority,
				};

				const hostSession = createTrackedSession({
					game: hostGame,
					transport: hostTransport,
					config,
				});
				const p2Session = createTrackedSession({
					game: p2Game,
					transport: p2Transport,
					config,
				});
				const p3Session = createTrackedSession({
					game: p3Game,
					transport: p3Transport,
					config,
				});

				// Set up room
				await hostSession.createRoom();

				await p2Session.joinRoom(hostSession.roomId!, "host");
				p2Transport.tick(100);
				hostTransport.tick(100);
				p2Transport.tick(100);

				await p3Session.joinRoom(hostSession.roomId!, "host");
				p3Transport.tick(100);
				hostTransport.tick(100);
				p3Transport.tick(100);

				// For Mesh topology, establish peer-to-peer connections between non-host players
				if (topology === Topology.Mesh) {
					await p2Transport.connect("p3");
					await p3Transport.connect("p2");
					p2Transport.tick(100);
					p3Transport.tick(100);
				}

				hostSession.start();
				hostTransport.tick(100);
				p2Transport.tick(100);
				p3Transport.tick(100);

				// Run ticks with different inputs per player
				let totalRollbacks = 0;

				for (let i = 0; i < 15; i++) {
					const r1 = hostSession.tick(TestInputs.MOVE_RIGHT); // +10 x
					const r2 = p2Session.tick(TestInputs.MOVE_LEFT); // -10 x
					const r3 = p3Session.tick(TestInputs.MOVE_DOWN); // +10 y

					if (r1.rolledBack) totalRollbacks++;
					if (r2.rolledBack) totalRollbacks++;
					if (r3.rolledBack) totalRollbacks++;

					hostTransport.tick(20);
					p2Transport.tick(20);
					p3Transport.tick(20);
				}

				// With 3 players and 40ms latency, we expect multiple rollbacks
				assert.ok(
					totalRollbacks >= 3,
					`${name}: Should have at least 3 rollbacks with 3 players and 40ms latency, got ${totalRollbacks}`,
				);

				// Flush remaining messages
				for (let i = 0; i < 15; i++) {
					hostTransport.tick(50);
					p2Transport.tick(50);
					p3Transport.tick(50);
					hostSession.tick(TestInputs.NEUTRAL);
					p2Session.tick(TestInputs.NEUTRAL);
					p3Session.tick(TestInputs.NEUTRAL);
				}

				// All games should be in sync
				assert.strictEqual(
					hostGame.x,
					p2Game.x,
					`${name}: host.x should equal p2.x`,
				);
				assert.strictEqual(
					hostGame.x,
					p3Game.x,
					`${name}: host.x should equal p3.x`,
				);
				assert.strictEqual(
					hostGame.y,
					p2Game.y,
					`${name}: host.y should equal p2.y`,
				);
				assert.strictEqual(
					hostGame.y,
					p3Game.y,
					`${name}: host.y should equal p3.y`,
				);

				// Verify expected final position
				// Host: 15 * (+10) = +150 x
				// P2: 15 * (-10) = -150 x
				// P3: 15 * (+10) = +150 y
				// Net: x = 0, y = 150
				assert.strictEqual(hostGame.x, 0, `${name}: Final x should be 0`);
				assert.strictEqual(hostGame.y, 150, `${name}: Final y should be 150`);
			});

			it(`should handle rapid input changes and rollbacks (${name})`, async () => {
				// 25ms latency with 10ms jitter creates variable rollback timing
				const transports = createLocalTransportGroup(["host", "p2", "p3"], {
					latency: 25,
					jitter: 10,
				});
				const hostTransport = getTransport(transports, "host");
				const p2Transport = getTransport(transports, "p2");
				const p3Transport = getTransport(transports, "p3");

				const hostGame = new TestGame();
				const p2Game = new TestGame();
				const p3Game = new TestGame();

				const config = {
					topology,
					desyncAuthority: authority,
				};

				const hostSession = createTrackedSession({
					game: hostGame,
					transport: hostTransport,
					config,
				});
				const p2Session = createTrackedSession({
					game: p2Game,
					transport: p2Transport,
					config,
				});
				const p3Session = createTrackedSession({
					game: p3Game,
					transport: p3Transport,
					config,
				});

				await hostSession.createRoom();

				await p2Session.joinRoom(hostSession.roomId!, "host");
				p2Transport.tick(100);
				hostTransport.tick(100);
				p2Transport.tick(100);

				await p3Session.joinRoom(hostSession.roomId!, "host");
				p3Transport.tick(100);
				hostTransport.tick(100);
				p3Transport.tick(100);

				if (topology === Topology.Mesh) {
					await p2Transport.connect("p3");
					await p3Transport.connect("p2");
					p2Transport.tick(100);
					p3Transport.tick(100);
				}

				hostSession.start();
				hostTransport.tick(100);
				p2Transport.tick(100);
				p3Transport.tick(100);

				// Alternate inputs rapidly to stress rollback - each player uses a
				// different phase offset so inputs change unpredictably
				const inputs = [TestInputs.MOVE_RIGHT, TestInputs.MOVE_LEFT, TestInputs.MOVE_DOWN, TestInputs.NEUTRAL];
				let totalRollbacks = 0;

				for (let i = 0; i < 30; i++) {
					const r1 = hostSession.tick(inputs[i % 4]!);
					const r2 = p2Session.tick(inputs[(i + 1) % 4]!);
					const r3 = p3Session.tick(inputs[(i + 2) % 4]!);

					if (r1.rolledBack) totalRollbacks++;
					if (r2.rolledBack) totalRollbacks++;
					if (r3.rolledBack) totalRollbacks++;

					hostTransport.tick(15);
					p2Transport.tick(15);
					p3Transport.tick(15);
				}

				// With rapid input changes and latency, rollbacks should occur
				assert.ok(
					totalRollbacks >= 1,
					`${name}: Should have rollbacks with rapid input changes, got ${totalRollbacks}`,
				);

				// Flush and converge
				for (let i = 0; i < 20; i++) {
					hostTransport.tick(50);
					p2Transport.tick(50);
					p3Transport.tick(50);
					hostSession.tick(TestInputs.NEUTRAL);
					p2Session.tick(TestInputs.NEUTRAL);
					p3Session.tick(TestInputs.NEUTRAL);
				}

				// All games should be in sync after convergence
				assert.strictEqual(
					hostGame.hash(),
					p2Game.hash(),
					`${name}: host and p2 should have same hash after rapid changes`,
				);
				assert.strictEqual(
					hostGame.hash(),
					p3Game.hash(),
					`${name}: host and p3 should have same hash after rapid changes`,
				);
			});
		}
	});

	describe("4-player rollback (Star topology)", () => {
		it("should rollback correctly with 4 players", async () => {
			// Test with 4 players to verify scaling beyond 3
			const transports = createLocalTransportGroup(["host", "p2", "p3", "p4"], {
				latency: 35,
			});
			const hostTransport = getTransport(transports, "host");
			const p2Transport = getTransport(transports, "p2");
			const p3Transport = getTransport(transports, "p3");
			const p4Transport = getTransport(transports, "p4");

			const hostGame = new TestGame();
			const p2Game = new TestGame();
			const p3Game = new TestGame();
			const p4Game = new TestGame();

			const config = {
				topology: Topology.Star,
				desyncAuthority: DesyncAuthority.Peer,
			};

			const hostSession = createTrackedSession({
				game: hostGame,
				transport: hostTransport,
				config,
			});
			const p2Session = createTrackedSession({
				game: p2Game,
				transport: p2Transport,
				config,
			});
			const p3Session = createTrackedSession({
				game: p3Game,
				transport: p3Transport,
				config,
			});
			const p4Session = createTrackedSession({
				game: p4Game,
				transport: p4Transport,
				config,
			});

			// Set up room
			await hostSession.createRoom();

			await p2Session.joinRoom(hostSession.roomId!, "host");
			p2Transport.tick(100);
			hostTransport.tick(100);
			p2Transport.tick(100);

			await p3Session.joinRoom(hostSession.roomId!, "host");
			p3Transport.tick(100);
			hostTransport.tick(100);
			p3Transport.tick(100);

			await p4Session.joinRoom(hostSession.roomId!, "host");
			p4Transport.tick(100);
			hostTransport.tick(100);
			p4Transport.tick(100);

			hostSession.start();
			hostTransport.tick(100);
			p2Transport.tick(100);
			p3Transport.tick(100);
			p4Transport.tick(100);

			// Each player moves in a different direction
			let totalRollbacks = 0;

			for (let i = 0; i < 12; i++) {
				const r1 = hostSession.tick(TestInputs.MOVE_RIGHT); // +10 x
				const r2 = p2Session.tick(TestInputs.MOVE_LEFT);   // -10 x
				const r3 = p3Session.tick(TestInputs.MOVE_DOWN);   // +10 y
				const r4 = p4Session.tick(TestInputs.MOVE_UP);     // -10 y

				if (r1.rolledBack) totalRollbacks++;
				if (r2.rolledBack) totalRollbacks++;
				if (r3.rolledBack) totalRollbacks++;
				if (r4.rolledBack) totalRollbacks++;

				hostTransport.tick(20);
				p2Transport.tick(20);
				p3Transport.tick(20);
				p4Transport.tick(20);
			}

			// With 4 players and latency, rollbacks are expected
			assert.ok(
				totalRollbacks >= 4,
				`Should have at least 4 rollbacks with 4 players, got ${totalRollbacks}`,
			);

			// Flush and converge
			for (let i = 0; i < 15; i++) {
				hostTransport.tick(50);
				p2Transport.tick(50);
				p3Transport.tick(50);
				p4Transport.tick(50);
				hostSession.tick(TestInputs.NEUTRAL);
				p2Session.tick(TestInputs.NEUTRAL);
				p3Session.tick(TestInputs.NEUTRAL);
				p4Session.tick(TestInputs.NEUTRAL);
			}

			// All games should be in sync
			assert.strictEqual(hostGame.hash(), p2Game.hash(), "host and p2 should match");
			assert.strictEqual(hostGame.hash(), p3Game.hash(), "host and p3 should match");
			assert.strictEqual(hostGame.hash(), p4Game.hash(), "host and p4 should match");

			// Verify expected final position
			// Host: 12 * (+10) = +120 x, P2: 12 * (-10) = -120 x -> net x = 0
			// P3: 12 * (+10) = +120 y, P4: 12 * (-10) = -120 y -> net y = 0
			assert.strictEqual(hostGame.x, 0, "Final x should be 0");
			assert.strictEqual(hostGame.y, 0, "Final y should be 0");
		});
	});

	describe("rollback edge cases", () => {
		it("should handle rollback at simulation start", async () => {
			// 30ms latency can trigger rollbacks even in early ticks
			const transports = createLocalTransportGroup(["host", "client"], {
				latency: 30,
			});
			const hostTransport = getTransport(transports, "host");
			const clientTransport = getTransport(transports, "client");

			const hostGame = new TestGame();
			const clientGame = new TestGame();

			const hostSession = createTrackedSession({
				game: hostGame,
				transport: hostTransport,
			});
			const clientSession = createTrackedSession({
				game: clientGame,
				transport: clientTransport,
			});

			await hostSession.createRoom();
			await clientSession.joinRoom(hostSession.roomId!, "host");
			clientTransport.tick(100);
			hostTransport.tick(100);

			hostSession.start();
			hostTransport.tick(100);

			// First few ticks with different inputs - may trigger early rollback
			for (let i = 0; i < 5; i++) {
				hostSession.tick(TestInputs.MOVE_RIGHT);
				clientSession.tick(TestInputs.MOVE_LEFT);
				hostTransport.tick(20);
				clientTransport.tick(20);
			}

			// Converge
			for (let i = 0; i < 10; i++) {
				hostTransport.tick(50);
				clientTransport.tick(50);
				hostSession.tick(TestInputs.NEUTRAL);
				clientSession.tick(TestInputs.NEUTRAL);
			}

			// Should be in sync
			assert.strictEqual(hostGame.x, clientGame.x, "X should match");
			assert.strictEqual(hostGame.y, clientGame.y, "Y should match");
		});

		it("should handle multiple consecutive rollbacks", async () => {
			// 100ms latency at 60Hz means inputs arrive ~6 ticks late,
			// which should cause consecutive rollbacks when inputs differ
			const transports = createLocalTransportGroup(["host", "client"], {
				latency: 100,
			});
			const hostTransport = getTransport(transports, "host");
			const clientTransport = getTransport(transports, "client");

			const hostGame = new TestGame();
			const clientGame = new TestGame();

			const hostSession = createTrackedSession({
				game: hostGame,
				transport: hostTransport,
			});
			const clientSession = createTrackedSession({
				game: clientGame,
				transport: clientTransport,
			});

			await hostSession.createRoom();
			await clientSession.joinRoom(hostSession.roomId!, "host");
			clientTransport.tick(150);
			hostTransport.tick(150);

			hostSession.start();
			hostTransport.tick(150);

			let consecutiveHostRollbacks = 0;
			let maxConsecutive = 0;
			let totalRollbacks = 0;

			for (let i = 0; i < 40; i++) {
				const hostResult = hostSession.tick(TestInputs.MOVE_RIGHT);
				const clientResult = clientSession.tick(TestInputs.MOVE_LEFT);

				if (hostResult.rolledBack) {
					totalRollbacks++;
					consecutiveHostRollbacks++;
					maxConsecutive = Math.max(maxConsecutive, consecutiveHostRollbacks);
				} else {
					consecutiveHostRollbacks = 0;
				}
				if (clientResult.rolledBack) {
					totalRollbacks++;
				}

				// 10ms tick time with 100ms latency means significant message queueing
				hostTransport.tick(10);
				clientTransport.tick(10);
			}

			// With 100ms latency and different inputs, we expect rollbacks.
			// The exact number depends on timing, but we should have at least some.
			assert.ok(
				totalRollbacks >= 1,
				`Should have at least 1 rollback with 100ms latency, got ${totalRollbacks}`,
			);

			// Converge - give extra time for high latency
			for (let i = 0; i < 30; i++) {
				hostTransport.tick(150);
				clientTransport.tick(150);
				hostSession.tick(TestInputs.NEUTRAL);
				clientSession.tick(TestInputs.NEUTRAL);
			}

			// The critical test: states must match after rollbacks complete
			assert.strictEqual(hostGame.x, clientGame.x, "X should match after consecutive rollbacks");
			assert.strictEqual(hostGame.y, clientGame.y, "Y should match after consecutive rollbacks");
		});

		it("should preserve determinism through rollback cycles", async () => {
			// Run the same scenario twice and verify identical results.
			// This validates that rollback + resimulation is deterministic.
			const runScenario = async () => {
				const transports = createLocalTransportGroup(["host", "client"], {
					latency: 40,
				});
				const hostTransport = getTransport(transports, "host");
				const clientTransport = getTransport(transports, "client");

				const hostGame = new TestGame();
				const clientGame = new TestGame();

				const hostSession = createTrackedSession({
					game: hostGame,
					transport: hostTransport,
				});
				const clientSession = createTrackedSession({
					game: clientGame,
					transport: clientTransport,
				});

				await hostSession.createRoom();
				await clientSession.joinRoom(hostSession.roomId!, "host");
				clientTransport.tick(100);
				hostTransport.tick(100);

				hostSession.start();
				hostTransport.tick(100);

				// Fixed input pattern - deterministic sequence
				const hostInputs = [TestInputs.MOVE_RIGHT, TestInputs.MOVE_RIGHT, TestInputs.MOVE_LEFT, TestInputs.NEUTRAL, TestInputs.MOVE_DOWN];
				const clientInputs = [TestInputs.MOVE_LEFT, TestInputs.MOVE_DOWN, TestInputs.MOVE_DOWN, TestInputs.MOVE_RIGHT, TestInputs.NEUTRAL];

				for (let i = 0; i < 20; i++) {
					hostSession.tick(hostInputs[i % hostInputs.length]!);
					clientSession.tick(clientInputs[i % clientInputs.length]!);
					hostTransport.tick(20);
					clientTransport.tick(20);
				}

				// Converge
				for (let i = 0; i < 15; i++) {
					hostTransport.tick(50);
					clientTransport.tick(50);
					hostSession.tick(TestInputs.NEUTRAL);
					clientSession.tick(TestInputs.NEUTRAL);
				}

				return { x: hostGame.x, y: hostGame.y, hash: hostGame.hash() };
			};

			const result1 = await runScenario();
			const result2 = await runScenario();

			assert.strictEqual(result1.x, result2.x, "X should be deterministic across runs");
			assert.strictEqual(result1.y, result2.y, "Y should be deterministic across runs");
			assert.strictEqual(result1.hash, result2.hash, "Hash should be deterministic across runs");
		});
	});

	describe("rollback with zero latency", () => {
		it("should minimize rollbacks when messages arrive immediately", async () => {
			const transports = createLocalTransportGroup(["host", "client"], {
				latency: 0,
			});
			const hostTransport = getTransport(transports, "host");
			const clientTransport = getTransport(transports, "client");

			const hostGame = new TestGame();
			const clientGame = new TestGame();

			const hostSession = createTrackedSession({
				game: hostGame,
				transport: hostTransport,
			});
			const clientSession = createTrackedSession({
				game: clientGame,
				transport: clientTransport,
			});

			await hostSession.createRoom();
			await clientSession.joinRoom(hostSession.roomId!, "host");
			hostTransport.flush();
			clientTransport.flush();

			hostSession.start();
			hostTransport.flush();
			clientTransport.flush();

			let rollbackCount = 0;

			for (let i = 0; i < 20; i++) {
				// Flush before each tick to ensure instant delivery
				hostTransport.flush();
				clientTransport.flush();

				const r1 = hostSession.tick(TestInputs.MOVE_RIGHT);
				hostTransport.flush();
				clientTransport.flush();

				const r2 = clientSession.tick(TestInputs.MOVE_LEFT);
				hostTransport.flush();
				clientTransport.flush();

				if (r1.rolledBack || r2.rolledBack) rollbackCount++;
			}

			// With zero latency and flushing between every operation, rollbacks
			// can still occur due to tick ordering (host ticks before client's
			// input arrives for that tick). However, they should be minimal.
			// We allow up to 10 rollbacks (50%) as a reasonable upper bound -
			// the key property is that states converge correctly.
			assert.ok(
				rollbackCount <= 10,
				`With zero latency, rollbacks should be limited, got ${rollbackCount}/20`,
			);

			// Games should be in sync - this is the critical assertion
			assert.strictEqual(hostGame.x, clientGame.x, "X should match");
			assert.strictEqual(hostGame.y, clientGame.y, "Y should match");
		});
	});
});
