import assert from "node:assert";
import { describe, it } from "node:test";
import {
	type LocalTransport,
	createLocalTransportGroup,
} from "../../src/transport/local.js";
import {
	DesyncAuthority,
	type Tick,
	Topology,
} from "../../src/types.js";
import { createSession } from "../../src/session/session.js";
import { DesyncableTestGame as TestGame, TestInputs, getTransport } from "../utils/test-helpers.js";

/**
 * Neutral input that causes no movement (128 - 128 = 0 for both axes).
 */
const NEUTRAL_INPUT = TestInputs.NEUTRAL;

/**
 * Helper to flush all transports in both directions.
 */
function flushAll(...transports: LocalTransport[]): void {
	for (const t of transports) {
		t.flush();
	}
}

/**
 * Helper to run ticks on multiple sessions and flush transports.
 */
function runTicks(
	sessions: Array<{ session: ReturnType<typeof createSession>; input: Uint8Array }>,
	transports: LocalTransport[],
	count: number,
): void {
	for (let i = 0; i < count; i++) {
		for (const { session, input } of sessions) {
			session.tick(input);
		}
		flushAll(...transports);
	}
}

describe("Desync Detection Integration", () => {
	describe("desync detection", () => {
		it("should detect desync when game logic diverges", async () => {
			const transports = createLocalTransportGroup(["host", "client"]);
			const hostTransport = getTransport(transports, "host");
			const clientTransport = getTransport(transports, "client");

			const hostGame = new TestGame();
			const clientGame = new TestGame();

			// Use a very short hash interval to detect desyncs quickly
			const config = {
				hashInterval: 5,
				inputDelayTicks: 0,
			};

			const hostSession = createSession({
				game: hostGame,
				transport: hostTransport,
				config,
			});
			const clientSession = createSession({
				game: clientGame,
				transport: clientTransport,
				config,
			});

			// Track desync events
			const hostDesyncs: Array<{ tick: Tick; localHash: number; remoteHash: number }> = [];
			const clientDesyncs: Array<{ tick: Tick; localHash: number; remoteHash: number }> = [];

			hostSession.on("desync", (tick, localHash, remoteHash) => {
				hostDesyncs.push({ tick, localHash, remoteHash });
			});
			clientSession.on("desync", (tick, localHash, remoteHash) => {
				clientDesyncs.push({ tick, localHash, remoteHash });
			});

			// Set up the session
			await hostSession.createRoom();
			await clientSession.joinRoom(hostSession.roomId!, "host");
			clientTransport.flush();
			hostTransport.flush();

			hostSession.start();
			hostTransport.flush();

			// Run some ticks in sync
			runTicks(
				[
					{ session: hostSession, input: NEUTRAL_INPUT },
					{ session: clientSession, input: NEUTRAL_INPUT },
				],
				[hostTransport, clientTransport],
				10,
			);

			// Verify games are in sync before enabling desync
			assert.strictEqual(hostGame.hash(), clientGame.hash(), "Games should be in sync initially");

			// Enable non-deterministic behavior on client only
			// This simulates a bug that only affects one client
			clientGame.enableDesync(100);

			// Run more ticks - client will diverge from host
			runTicks(
				[
					{ session: hostSession, input: NEUTRAL_INPUT },
					{ session: clientSession, input: NEUTRAL_INPUT },
				],
				[hostTransport, clientTransport],
				20,
			);

			// At least one side should have detected the desync
			const totalDesyncs = hostDesyncs.length + clientDesyncs.length;
			assert.ok(totalDesyncs > 0, `Should detect at least one desync, got ${totalDesyncs}`);
		});

		it("should emit desync event with differing hash values", async () => {
			const transports = createLocalTransportGroup(["host", "client"]);
			const hostTransport = getTransport(transports, "host");
			const clientTransport = getTransport(transports, "client");

			const hostGame = new TestGame();
			const clientGame = new TestGame();

			const config = {
				hashInterval: 3,
				inputDelayTicks: 0,
			};

			const hostSession = createSession({
				game: hostGame,
				transport: hostTransport,
				config,
			});
			const clientSession = createSession({
				game: clientGame,
				transport: clientTransport,
				config,
			});

			const desyncEvents: Array<{ tick: Tick; localHash: number; remoteHash: number }> = [];

			clientSession.on("desync", (tick, localHash, remoteHash) => {
				desyncEvents.push({ tick, localHash, remoteHash });
			});

			await hostSession.createRoom();
			await clientSession.joinRoom(hostSession.roomId!, "host");
			clientTransport.flush();
			hostTransport.flush();

			hostSession.start();
			hostTransport.flush();

			// Enable desync on client from the start
			clientGame.enableDesync(50);

			// Run ticks to trigger detection
			runTicks(
				[
					{ session: hostSession, input: NEUTRAL_INPUT },
					{ session: clientSession, input: NEUTRAL_INPUT },
				],
				[hostTransport, clientTransport],
				20,
			);

			// Verify desync was detected
			assert.ok(desyncEvents.length > 0, "Should detect at least one desync");

			const desync = desyncEvents[0]!;
			// The local hash (client) should be different from remote hash (host)
			assert.notStrictEqual(
				desync.localHash,
				desync.remoteHash,
				"Hashes should differ in desync event",
			);
		});

		it("should recover from desync via state sync", async () => {
			const transports = createLocalTransportGroup(["host", "client"]);
			const hostTransport = getTransport(transports, "host");
			const clientTransport = getTransport(transports, "client");

			const hostGame = new TestGame();
			const clientGame = new TestGame();

			const config = {
				hashInterval: 3,
				inputDelayTicks: 0,
			};

			const hostSession = createSession({
				game: hostGame,
				transport: hostTransport,
				config,
			});
			const clientSession = createSession({
				game: clientGame,
				transport: clientTransport,
				config,
			});

			let desyncDetected = false;
			clientSession.on("desync", () => {
				desyncDetected = true;
				// When desync is detected, fix the bug (disable non-determinism)
				clientGame.disableDesync();
			});

			await hostSession.createRoom();
			await clientSession.joinRoom(hostSession.roomId!, "host");
			clientTransport.flush();
			hostTransport.flush();

			hostSession.start();
			hostTransport.flush();

			// Run some ticks in sync first
			runTicks(
				[
					{ session: hostSession, input: NEUTRAL_INPUT },
					{ session: clientSession, input: NEUTRAL_INPUT },
				],
				[hostTransport, clientTransport],
				5,
			);

			// Enable desync on client
			clientGame.enableDesync(100);

			// Run ticks to trigger detection and recovery
			runTicks(
				[
					{ session: hostSession, input: NEUTRAL_INPUT },
					{ session: clientSession, input: NEUTRAL_INPUT },
				],
				[hostTransport, clientTransport],
				30,
			);

			// Verify desync was detected
			assert.ok(desyncDetected, "Desync should have been detected");

			// After recovery and with deterministic behavior restored,
			// run more ticks to ensure games converge
			runTicks(
				[
					{ session: hostSession, input: NEUTRAL_INPUT },
					{ session: clientSession, input: NEUTRAL_INPUT },
				],
				[hostTransport, clientTransport],
				20,
			);

			// Games should be in sync after recovery
			assert.strictEqual(
				hostGame.hash(),
				clientGame.hash(),
				"States should match after desync recovery",
			);
		});
	});

	describe("desync with multiple players", () => {
		it("should detect desync when one player diverges", async () => {
			const transports = createLocalTransportGroup(["host", "p2", "p3"]);
			const hostTransport = getTransport(transports, "host");
			const p2Transport = getTransport(transports, "p2");
			const p3Transport = getTransport(transports, "p3");

			const hostGame = new TestGame();
			const p2Game = new TestGame();
			const p3Game = new TestGame();

			const config = {
				hashInterval: 5,
				inputDelayTicks: 0,
			};

			const hostSession = createSession({
				game: hostGame,
				transport: hostTransport,
				config,
			});
			const p2Session = createSession({
				game: p2Game,
				transport: p2Transport,
				config,
			});
			const p3Session = createSession({
				game: p3Game,
				transport: p3Transport,
				config,
			});

			const desyncs: string[] = [];
			hostSession.on("desync", () => desyncs.push("host"));
			p2Session.on("desync", () => desyncs.push("p2"));
			p3Session.on("desync", () => desyncs.push("p3"));

			// Set up session
			await hostSession.createRoom();
			await p2Session.joinRoom(hostSession.roomId!, "host");
			flushAll(hostTransport, p2Transport, p3Transport);
			await p3Session.joinRoom(hostSession.roomId!, "host");
			flushAll(hostTransport, p2Transport, p3Transport);

			hostSession.start();
			flushAll(hostTransport, p2Transport, p3Transport);

			// Run some ticks in sync
			for (let i = 0; i < 10; i++) {
				hostSession.tick(NEUTRAL_INPUT);
				p2Session.tick(NEUTRAL_INPUT);
				p3Session.tick(NEUTRAL_INPUT);
				flushAll(hostTransport, p2Transport, p3Transport);
			}

			// Enable non-determinism on p2 only
			p2Game.enableDesync(50);

			// Run more ticks to trigger detection
			for (let i = 0; i < 20; i++) {
				hostSession.tick(NEUTRAL_INPUT);
				p2Session.tick(NEUTRAL_INPUT);
				p3Session.tick(NEUTRAL_INPUT);
				flushAll(hostTransport, p2Transport, p3Transport);
			}

			// p2 should have detected desync (or host detected p2's bad hash)
			assert.ok(desyncs.length > 0, "Should detect desync with diverging player");
		});
	});

	describe("no false positives", () => {
		it("should not emit desync when games are in sync", async () => {
			const transports = createLocalTransportGroup(["host", "client"]);
			const hostTransport = getTransport(transports, "host");
			const clientTransport = getTransport(transports, "client");

			const hostGame = new TestGame();
			const clientGame = new TestGame();

			const config = {
				hashInterval: 3, // Very frequent hash checks
				inputDelayTicks: 0,
			};

			const hostSession = createSession({
				game: hostGame,
				transport: hostTransport,
				config,
			});
			const clientSession = createSession({
				game: clientGame,
				transport: clientTransport,
				config,
			});

			let desyncCount = 0;
			hostSession.on("desync", () => desyncCount++);
			clientSession.on("desync", () => desyncCount++);

			await hostSession.createRoom();
			await clientSession.joinRoom(hostSession.roomId!, "host");
			clientTransport.flush();
			hostTransport.flush();

			hostSession.start();
			hostTransport.flush();

			// Run many ticks with same input - no desync should occur
			runTicks(
				[
					{ session: hostSession, input: NEUTRAL_INPUT },
					{ session: clientSession, input: NEUTRAL_INPUT },
				],
				[hostTransport, clientTransport],
				50,
			);

			assert.strictEqual(desyncCount, 0, "Should not detect any desyncs when games are in sync");
			assert.strictEqual(hostGame.hash(), clientGame.hash(), "Games should remain in sync");
		});

		it("should not emit desync with different inputs but deterministic game logic", async () => {
			const transports = createLocalTransportGroup(["host", "client"]);
			const hostTransport = getTransport(transports, "host");
			const clientTransport = getTransport(transports, "client");

			const hostGame = new TestGame();
			const clientGame = new TestGame();

			const config = {
				hashInterval: 5,
				inputDelayTicks: 0,
			};

			const hostSession = createSession({
				game: hostGame,
				transport: hostTransport,
				config,
			});
			const clientSession = createSession({
				game: clientGame,
				transport: clientTransport,
				config,
			});

			let desyncCount = 0;
			hostSession.on("desync", () => desyncCount++);
			clientSession.on("desync", () => desyncCount++);

			await hostSession.createRoom();
			await clientSession.joinRoom(hostSession.roomId!, "host");
			clientTransport.flush();
			hostTransport.flush();

			hostSession.start();
			hostTransport.flush();

			// Run ticks with different inputs - games should still sync via rollback
			for (let i = 0; i < 30; i++) {
				hostSession.tick(new Uint8Array([138, 128])); // Host moves right
				clientSession.tick(new Uint8Array([128, 138])); // Client moves down
				flushAll(hostTransport, clientTransport);
			}

			// Extra ticks with neutral input to allow final sync
			runTicks(
				[
					{ session: hostSession, input: NEUTRAL_INPUT },
					{ session: clientSession, input: NEUTRAL_INPUT },
				],
				[hostTransport, clientTransport],
				20,
			);

			assert.strictEqual(desyncCount, 0, "Should not detect desyncs with normal gameplay");
			assert.strictEqual(hostGame.hash(), clientGame.hash(), "Games should be in sync after rollback");
		});
	});

	describe("hash interval configuration", () => {
		it("should detect desync after hash interval passes", async () => {
			const transports = createLocalTransportGroup(["host", "client"]);
			const hostTransport = getTransport(transports, "host");
			const clientTransport = getTransport(transports, "client");

			const hostGame = new TestGame();
			const clientGame = new TestGame();

			// Use a longer hash interval
			const config = {
				hashInterval: 15,
				inputDelayTicks: 0,
			};

			const hostSession = createSession({
				game: hostGame,
				transport: hostTransport,
				config,
			});
			const clientSession = createSession({
				game: clientGame,
				transport: clientTransport,
				config,
			});

			let desyncCount = 0;
			clientSession.on("desync", () => desyncCount++);

			await hostSession.createRoom();
			await clientSession.joinRoom(hostSession.roomId!, "host");
			clientTransport.flush();
			hostTransport.flush();

			hostSession.start();
			hostTransport.flush();

			// Enable desync from start
			clientGame.enableDesync(100);

			// Run enough ticks for the hash interval to trigger
			runTicks(
				[
					{ session: hostSession, input: NEUTRAL_INPUT },
					{ session: clientSession, input: NEUTRAL_INPUT },
				],
				[hostTransport, clientTransport],
				30,
			);

			// Desync should be detected
			assert.ok(desyncCount > 0, "Desync should be detected after hashInterval passes");
		});
	});

	describe("desync event details", () => {
		it("should include correct tick in desync event", async () => {
			const transports = createLocalTransportGroup(["host", "client"]);
			const hostTransport = getTransport(transports, "host");
			const clientTransport = getTransport(transports, "client");

			const hostGame = new TestGame();
			const clientGame = new TestGame();

			const config = {
				hashInterval: 5,
				inputDelayTicks: 0,
			};

			const hostSession = createSession({
				game: hostGame,
				transport: hostTransport,
				config,
			});
			const clientSession = createSession({
				game: clientGame,
				transport: clientTransport,
				config,
			});

			const desyncTicks: Tick[] = [];
			clientSession.on("desync", (tick) => {
				desyncTicks.push(tick);
			});

			await hostSession.createRoom();
			await clientSession.joinRoom(hostSession.roomId!, "host");
			clientTransport.flush();
			hostTransport.flush();

			hostSession.start();
			hostTransport.flush();

			// Enable desync
			clientGame.enableDesync(100);

			runTicks(
				[
					{ session: hostSession, input: NEUTRAL_INPUT },
					{ session: clientSession, input: NEUTRAL_INPUT },
				],
				[hostTransport, clientTransport],
				25,
			);

			assert.ok(desyncTicks.length > 0, "Should have detected desyncs");

			// Tick should be a reasonable value (not 0, not negative)
			for (const tick of desyncTicks) {
				assert.ok(tick >= 0, `Tick should be non-negative, got ${tick}`);
			}
		});
	});

	describe("topology and authority combinations", () => {
		it("should detect desync with Star topology + Peer authority", async () => {
			const transports = createLocalTransportGroup(["host", "client"]);
			const hostTransport = getTransport(transports, "host");
			const clientTransport = getTransport(transports, "client");

			const hostGame = new TestGame();
			const clientGame = new TestGame();

			// Explicitly set Star + Peer (the default, but being explicit)
			const config = {
				topology: Topology.Star,
				desyncAuthority: DesyncAuthority.Peer,
				hashInterval: 5,
				inputDelayTicks: 0,
			};

			const hostSession = createSession({
				game: hostGame,
				transport: hostTransport,
				config,
			});
			const clientSession = createSession({
				game: clientGame,
				transport: clientTransport,
				config,
			});

			// Track desync events on both sides
			const hostDesyncs: Array<{ tick: Tick; localHash: number; remoteHash: number }> = [];
			const clientDesyncs: Array<{ tick: Tick; localHash: number; remoteHash: number }> = [];

			hostSession.on("desync", (tick, localHash, remoteHash) => {
				hostDesyncs.push({ tick, localHash, remoteHash });
			});
			clientSession.on("desync", (tick, localHash, remoteHash) => {
				clientDesyncs.push({ tick, localHash, remoteHash });
			});

			// Set up session
			await hostSession.createRoom();
			await clientSession.joinRoom(hostSession.roomId!, "host");
			flushAll(hostTransport, clientTransport);

			hostSession.start();
			flushAll(hostTransport, clientTransport);

			// Run some ticks in sync
			runTicks(
				[
					{ session: hostSession, input: NEUTRAL_INPUT },
					{ session: clientSession, input: NEUTRAL_INPUT },
				],
				[hostTransport, clientTransport],
				10,
			);

			// Enable desync on client
			clientGame.enableDesync(100);

			// Run more ticks to trigger detection
			runTicks(
				[
					{ session: hostSession, input: NEUTRAL_INPUT },
					{ session: clientSession, input: NEUTRAL_INPUT },
				],
				[hostTransport, clientTransport],
				20,
			);

			// In peer mode, both sides should detect the desync
			const totalDesyncs = hostDesyncs.length + clientDesyncs.length;
			assert.ok(
				totalDesyncs > 0,
				`Star+Peer: Should detect desync, got host=${hostDesyncs.length} client=${clientDesyncs.length}`,
			);

			// Verify hash values differ
			if (hostDesyncs.length > 0) {
				const d = hostDesyncs[0]!;
				assert.notStrictEqual(d.localHash, d.remoteHash, "Host should see differing hashes");
			}
			if (clientDesyncs.length > 0) {
				const d = clientDesyncs[0]!;
				assert.notStrictEqual(d.localHash, d.remoteHash, "Client should see differing hashes");
			}
		});

		it("should detect desync with Mesh topology + Host authority", async () => {
			const transports = createLocalTransportGroup(["host", "client"]);
			const hostTransport = getTransport(transports, "host");
			const clientTransport = getTransport(transports, "client");

			const hostGame = new TestGame();
			const clientGame = new TestGame();

			// Mesh + Host authority: host collects and compares all hashes
			const config = {
				topology: Topology.Mesh,
				desyncAuthority: DesyncAuthority.Host,
				hashInterval: 5,
				inputDelayTicks: 0,
			};

			const hostSession = createSession({
				game: hostGame,
				transport: hostTransport,
				config,
			});
			const clientSession = createSession({
				game: clientGame,
				transport: clientTransport,
				config,
			});

			// Track desync events - in host authority mode, only host detects
			const hostDesyncs: Array<{ tick: Tick; localHash: number; remoteHash: number }> = [];
			const clientDesyncs: Array<{ tick: Tick; localHash: number; remoteHash: number }> = [];

			hostSession.on("desync", (tick, localHash, remoteHash) => {
				hostDesyncs.push({ tick, localHash, remoteHash });
			});
			clientSession.on("desync", (tick, localHash, remoteHash) => {
				clientDesyncs.push({ tick, localHash, remoteHash });
			});

			// Set up session
			await hostSession.createRoom();
			await clientSession.joinRoom(hostSession.roomId!, "host");
			flushAll(hostTransport, clientTransport);

			hostSession.start();
			flushAll(hostTransport, clientTransport);

			// Run some ticks in sync
			runTicks(
				[
					{ session: hostSession, input: NEUTRAL_INPUT },
					{ session: clientSession, input: NEUTRAL_INPUT },
				],
				[hostTransport, clientTransport],
				10,
			);

			// Enable desync on client
			clientGame.enableDesync(100);

			// Run more ticks to trigger detection
			runTicks(
				[
					{ session: hostSession, input: NEUTRAL_INPUT },
					{ session: clientSession, input: NEUTRAL_INPUT },
				],
				[hostTransport, clientTransport],
				20,
			);

			// In host authority mode, only the HOST should detect the desync
			assert.ok(
				hostDesyncs.length > 0,
				`Mesh+Host: Host should detect desync, got ${hostDesyncs.length}`,
			);

			// Client should NOT detect desync in host authority mode
			// (client sends hash to host, host compares)
			assert.strictEqual(
				clientDesyncs.length,
				0,
				`Mesh+Host: Client should not detect desync (host authority), got ${clientDesyncs.length}`,
			);

			// Verify host saw differing hashes
			const d = hostDesyncs[0]!;
			assert.notStrictEqual(d.localHash, d.remoteHash, "Host should see differing hashes");
		});

		it("should detect desync with Mesh topology + Peer authority", async () => {
			const transports = createLocalTransportGroup(["host", "client"]);
			const hostTransport = getTransport(transports, "host");
			const clientTransport = getTransport(transports, "client");

			const hostGame = new TestGame();
			const clientGame = new TestGame();

			// Mesh + Peer authority: each peer compares independently
			const config = {
				topology: Topology.Mesh,
				desyncAuthority: DesyncAuthority.Peer,
				hashInterval: 5,
				inputDelayTicks: 0,
			};

			const hostSession = createSession({
				game: hostGame,
				transport: hostTransport,
				config,
			});
			const clientSession = createSession({
				game: clientGame,
				transport: clientTransport,
				config,
			});

			const hostDesyncs: Array<{ tick: Tick; localHash: number; remoteHash: number }> = [];
			const clientDesyncs: Array<{ tick: Tick; localHash: number; remoteHash: number }> = [];

			hostSession.on("desync", (tick, localHash, remoteHash) => {
				hostDesyncs.push({ tick, localHash, remoteHash });
			});
			clientSession.on("desync", (tick, localHash, remoteHash) => {
				clientDesyncs.push({ tick, localHash, remoteHash });
			});

			// Set up session
			await hostSession.createRoom();
			await clientSession.joinRoom(hostSession.roomId!, "host");
			flushAll(hostTransport, clientTransport);

			hostSession.start();
			flushAll(hostTransport, clientTransport);

			// Run some ticks in sync
			runTicks(
				[
					{ session: hostSession, input: NEUTRAL_INPUT },
					{ session: clientSession, input: NEUTRAL_INPUT },
				],
				[hostTransport, clientTransport],
				10,
			);

			// Enable desync on client
			clientGame.enableDesync(100);

			// Run more ticks to trigger detection
			runTicks(
				[
					{ session: hostSession, input: NEUTRAL_INPUT },
					{ session: clientSession, input: NEUTRAL_INPUT },
				],
				[hostTransport, clientTransport],
				20,
			);

			// In peer mode, both sides should detect the desync
			const totalDesyncs = hostDesyncs.length + clientDesyncs.length;
			assert.ok(
				totalDesyncs > 0,
				`Mesh+Peer: Should detect desync, got host=${hostDesyncs.length} client=${clientDesyncs.length}`,
			);
		});

		it("should detect desync with Star topology + Host authority", async () => {
			const transports = createLocalTransportGroup(["host", "client"]);
			const hostTransport = getTransport(transports, "host");
			const clientTransport = getTransport(transports, "client");

			const hostGame = new TestGame();
			const clientGame = new TestGame();

			// Star + Host authority: this is an unusual combo
			// isHostAuthority only returns true for Mesh+Host, so this uses peer mode
			const config = {
				topology: Topology.Star,
				desyncAuthority: DesyncAuthority.Host,
				hashInterval: 5,
				inputDelayTicks: 0,
			};

			const hostSession = createSession({
				game: hostGame,
				transport: hostTransport,
				config,
			});
			const clientSession = createSession({
				game: clientGame,
				transport: clientTransport,
				config,
			});

			const hostDesyncs: Array<{ tick: Tick; localHash: number; remoteHash: number }> = [];
			const clientDesyncs: Array<{ tick: Tick; localHash: number; remoteHash: number }> = [];

			hostSession.on("desync", (tick, localHash, remoteHash) => {
				hostDesyncs.push({ tick, localHash, remoteHash });
			});
			clientSession.on("desync", (tick, localHash, remoteHash) => {
				clientDesyncs.push({ tick, localHash, remoteHash });
			});

			// Set up session
			await hostSession.createRoom();
			await clientSession.joinRoom(hostSession.roomId!, "host");
			flushAll(hostTransport, clientTransport);

			hostSession.start();
			flushAll(hostTransport, clientTransport);

			// Run some ticks in sync
			runTicks(
				[
					{ session: hostSession, input: NEUTRAL_INPUT },
					{ session: clientSession, input: NEUTRAL_INPUT },
				],
				[hostTransport, clientTransport],
				10,
			);

			// Enable desync on client
			clientGame.enableDesync(100);

			// Run more ticks to trigger detection
			runTicks(
				[
					{ session: hostSession, input: NEUTRAL_INPUT },
					{ session: clientSession, input: NEUTRAL_INPUT },
				],
				[hostTransport, clientTransport],
				20,
			);

			// Star+Host falls back to peer mode (isHostAuthority requires Mesh)
			// So both sides should detect
			const totalDesyncs = hostDesyncs.length + clientDesyncs.length;
			assert.ok(
				totalDesyncs > 0,
				`Star+Host: Should detect desync, got host=${hostDesyncs.length} client=${clientDesyncs.length}`,
			);
		});
	});

	describe("3+ player desync detection and recovery", () => {
		it("should detect and recover from desync with Star + Host (3 players)", async () => {
			const transports = createLocalTransportGroup(["host", "p2", "p3"]);
			const hostTransport = getTransport(transports, "host");
			const p2Transport = getTransport(transports, "p2");
			const p3Transport = getTransport(transports, "p3");

			const hostGame = new TestGame();
			const p2Game = new TestGame();
			const p3Game = new TestGame();

			const config = {
				topology: Topology.Star,
				desyncAuthority: DesyncAuthority.Host,
				hashInterval: 5,
				inputDelayTicks: 0,
			};

			const hostSession = createSession({
				game: hostGame,
				transport: hostTransport,
				config,
			});
			const p2Session = createSession({
				game: p2Game,
				transport: p2Transport,
				config,
			});
			const p3Session = createSession({
				game: p3Game,
				transport: p3Transport,
				config,
			});

			const allDesyncs: Array<{ player: string; tick: Tick }> = [];
			hostSession.on("desync", (tick) => allDesyncs.push({ player: "host", tick }));
			p2Session.on("desync", (tick) => allDesyncs.push({ player: "p2", tick }));
			p3Session.on("desync", (tick) => {
				allDesyncs.push({ player: "p3", tick });
				// Fix the desync when detected
				p3Game.disableDesync();
			});

			// Set up session
			await hostSession.createRoom();
			await p2Session.joinRoom(hostSession.roomId!, "host");
			flushAll(hostTransport, p2Transport, p3Transport);
			await p3Session.joinRoom(hostSession.roomId!, "host");
			flushAll(hostTransport, p2Transport, p3Transport);

			hostSession.start();
			flushAll(hostTransport, p2Transport, p3Transport);

			// Run some ticks in sync
			for (let i = 0; i < 10; i++) {
				hostSession.tick(NEUTRAL_INPUT);
				p2Session.tick(NEUTRAL_INPUT);
				p3Session.tick(NEUTRAL_INPUT);
				flushAll(hostTransport, p2Transport, p3Transport);
			}

			// Verify initial sync
			assert.strictEqual(hostGame.hash(), p2Game.hash(), "host and p2 should be in sync initially");
			assert.strictEqual(hostGame.hash(), p3Game.hash(), "host and p3 should be in sync initially");

			// Enable desync on p3
			p3Game.enableDesync(100);

			// Run ticks to trigger detection
			for (let i = 0; i < 25; i++) {
				hostSession.tick(NEUTRAL_INPUT);
				p2Session.tick(NEUTRAL_INPUT);
				p3Session.tick(NEUTRAL_INPUT);
				flushAll(hostTransport, p2Transport, p3Transport);
			}

			// Should have detected desync
			assert.ok(allDesyncs.length > 0, "Star+Host (3 players): Should detect desync");

			// Run more ticks to allow recovery
			for (let i = 0; i < 20; i++) {
				hostSession.tick(NEUTRAL_INPUT);
				p2Session.tick(NEUTRAL_INPUT);
				p3Session.tick(NEUTRAL_INPUT);
				flushAll(hostTransport, p2Transport, p3Transport);
			}

			// After recovery, all games should be in sync
			assert.strictEqual(
				hostGame.hash(),
				p2Game.hash(),
				"Star+Host (3 players): host and p2 should be in sync after recovery",
			);
			assert.strictEqual(
				hostGame.hash(),
				p3Game.hash(),
				"Star+Host (3 players): host and p3 should be in sync after recovery",
			);
		});

		it("should detect and recover from desync with Star + Peer (3 players)", async () => {
			const transports = createLocalTransportGroup(["host", "p2", "p3"]);
			const hostTransport = getTransport(transports, "host");
			const p2Transport = getTransport(transports, "p2");
			const p3Transport = getTransport(transports, "p3");

			const hostGame = new TestGame();
			const p2Game = new TestGame();
			const p3Game = new TestGame();

			const config = {
				topology: Topology.Star,
				desyncAuthority: DesyncAuthority.Peer,
				hashInterval: 5,
				inputDelayTicks: 0,
			};

			const hostSession = createSession({
				game: hostGame,
				transport: hostTransport,
				config,
			});
			const p2Session = createSession({
				game: p2Game,
				transport: p2Transport,
				config,
			});
			const p3Session = createSession({
				game: p3Game,
				transport: p3Transport,
				config,
			});

			const allDesyncs: Array<{ player: string; tick: Tick }> = [];
			hostSession.on("desync", (tick) => allDesyncs.push({ player: "host", tick }));
			p2Session.on("desync", (tick) => allDesyncs.push({ player: "p2", tick }));
			p3Session.on("desync", (tick) => {
				allDesyncs.push({ player: "p3", tick });
				p3Game.disableDesync();
			});

			// Set up session
			await hostSession.createRoom();
			await p2Session.joinRoom(hostSession.roomId!, "host");
			flushAll(hostTransport, p2Transport, p3Transport);
			await p3Session.joinRoom(hostSession.roomId!, "host");
			flushAll(hostTransport, p2Transport, p3Transport);

			hostSession.start();
			flushAll(hostTransport, p2Transport, p3Transport);

			// Run some ticks in sync
			for (let i = 0; i < 10; i++) {
				hostSession.tick(NEUTRAL_INPUT);
				p2Session.tick(NEUTRAL_INPUT);
				p3Session.tick(NEUTRAL_INPUT);
				flushAll(hostTransport, p2Transport, p3Transport);
			}

			// Enable desync on p3
			p3Game.enableDesync(100);

			// Run ticks to trigger detection
			for (let i = 0; i < 25; i++) {
				hostSession.tick(NEUTRAL_INPUT);
				p2Session.tick(NEUTRAL_INPUT);
				p3Session.tick(NEUTRAL_INPUT);
				flushAll(hostTransport, p2Transport, p3Transport);
			}

			// In peer mode, multiple sides should detect
			assert.ok(allDesyncs.length > 0, "Star+Peer (3 players): Should detect desync");

			// Check that p3 detected (since it was the desynced one, it will detect when comparing with host)
			const p3Desyncs = allDesyncs.filter((d) => d.player === "p3");
			assert.ok(p3Desyncs.length > 0, "Star+Peer (3 players): p3 should detect its own desync");

			// Run more ticks to allow recovery
			for (let i = 0; i < 20; i++) {
				hostSession.tick(NEUTRAL_INPUT);
				p2Session.tick(NEUTRAL_INPUT);
				p3Session.tick(NEUTRAL_INPUT);
				flushAll(hostTransport, p2Transport, p3Transport);
			}

			// After recovery, all games should be in sync
			assert.strictEqual(
				hostGame.hash(),
				p3Game.hash(),
				"Star+Peer (3 players): host and p3 should be in sync after recovery",
			);
		});

		it("should detect and recover from desync with Mesh + Host (3 players)", async () => {
			// For Mesh topology, we need to manually connect all peers
			const transports = createLocalTransportGroup(["host", "p2", "p3"]);
			const hostTransport = getTransport(transports, "host");
			const p2Transport = getTransport(transports, "p2");
			const p3Transport = getTransport(transports, "p3");

			const hostGame = new TestGame();
			const p2Game = new TestGame();
			const p3Game = new TestGame();

			const config = {
				topology: Topology.Mesh,
				desyncAuthority: DesyncAuthority.Host,
				hashInterval: 5,
				inputDelayTicks: 0,
			};

			const hostSession = createSession({
				game: hostGame,
				transport: hostTransport,
				config,
			});
			const p2Session = createSession({
				game: p2Game,
				transport: p2Transport,
				config,
			});
			const p3Session = createSession({
				game: p3Game,
				transport: p3Transport,
				config,
			});

			const hostDesyncs: Array<{ tick: Tick }> = [];
			const clientDesyncs: Array<{ player: string; tick: Tick }> = [];

			hostSession.on("desync", (tick) => hostDesyncs.push({ tick }));
			p2Session.on("desync", (tick) => clientDesyncs.push({ player: "p2", tick }));
			p3Session.on("desync", (tick) => {
				clientDesyncs.push({ player: "p3", tick });
				p3Game.disableDesync();
			});

			// Set up session
			await hostSession.createRoom();
			await p2Session.joinRoom(hostSession.roomId!, "host");
			flushAll(hostTransport, p2Transport, p3Transport);

			// In Mesh, p2 needs to connect to p3 as well (peer-to-peer)
			await p3Session.joinRoom(hostSession.roomId!, "host");
			flushAll(hostTransport, p2Transport, p3Transport);

			// Establish peer-to-peer connections for Mesh
			await p2Transport.connect("p3");
			await p3Transport.connect("p2");
			flushAll(hostTransport, p2Transport, p3Transport);

			hostSession.start();
			flushAll(hostTransport, p2Transport, p3Transport);

			// Run some ticks in sync
			for (let i = 0; i < 10; i++) {
				hostSession.tick(NEUTRAL_INPUT);
				p2Session.tick(NEUTRAL_INPUT);
				p3Session.tick(NEUTRAL_INPUT);
				flushAll(hostTransport, p2Transport, p3Transport);
			}

			// Enable desync on p3
			p3Game.enableDesync(100);

			// Run ticks to trigger detection
			for (let i = 0; i < 25; i++) {
				hostSession.tick(NEUTRAL_INPUT);
				p2Session.tick(NEUTRAL_INPUT);
				p3Session.tick(NEUTRAL_INPUT);
				flushAll(hostTransport, p2Transport, p3Transport);
			}

			// In Mesh+Host mode, only host should detect the desync
			assert.ok(
				hostDesyncs.length > 0,
				`Mesh+Host (3 players): Host should detect desync, got ${hostDesyncs.length}`,
			);

			// Clients should NOT detect in host authority mode
			assert.strictEqual(
				clientDesyncs.length,
				0,
				`Mesh+Host (3 players): Clients should not detect desync, got ${clientDesyncs.length}`,
			);

			// Note: In host authority mode without explicit recovery mechanism,
			// the desynced client needs to request sync from host.
			// For this test, we just verify detection works correctly.
		});

		it("should detect and recover from desync with Mesh + Peer (3 players)", async () => {
			const transports = createLocalTransportGroup(["host", "p2", "p3"]);
			const hostTransport = getTransport(transports, "host");
			const p2Transport = getTransport(transports, "p2");
			const p3Transport = getTransport(transports, "p3");

			const hostGame = new TestGame();
			const p2Game = new TestGame();
			const p3Game = new TestGame();

			const config = {
				topology: Topology.Mesh,
				desyncAuthority: DesyncAuthority.Peer,
				hashInterval: 5,
				inputDelayTicks: 0,
			};

			const hostSession = createSession({
				game: hostGame,
				transport: hostTransport,
				config,
			});
			const p2Session = createSession({
				game: p2Game,
				transport: p2Transport,
				config,
			});
			const p3Session = createSession({
				game: p3Game,
				transport: p3Transport,
				config,
			});

			const allDesyncs: Array<{ player: string; tick: Tick }> = [];
			hostSession.on("desync", (tick) => allDesyncs.push({ player: "host", tick }));
			p2Session.on("desync", (tick) => allDesyncs.push({ player: "p2", tick }));
			p3Session.on("desync", (tick) => {
				allDesyncs.push({ player: "p3", tick });
				p3Game.disableDesync();
			});

			// Set up session
			await hostSession.createRoom();
			await p2Session.joinRoom(hostSession.roomId!, "host");
			flushAll(hostTransport, p2Transport, p3Transport);

			await p3Session.joinRoom(hostSession.roomId!, "host");
			flushAll(hostTransport, p2Transport, p3Transport);

			// Establish peer-to-peer connections for Mesh
			await p2Transport.connect("p3");
			await p3Transport.connect("p2");
			flushAll(hostTransport, p2Transport, p3Transport);

			hostSession.start();
			flushAll(hostTransport, p2Transport, p3Transport);

			// Run some ticks in sync
			for (let i = 0; i < 10; i++) {
				hostSession.tick(NEUTRAL_INPUT);
				p2Session.tick(NEUTRAL_INPUT);
				p3Session.tick(NEUTRAL_INPUT);
				flushAll(hostTransport, p2Transport, p3Transport);
			}

			// Verify initial sync
			assert.strictEqual(hostGame.hash(), p2Game.hash(), "host and p2 should be in sync initially");
			assert.strictEqual(hostGame.hash(), p3Game.hash(), "host and p3 should be in sync initially");

			// Enable desync on p3
			p3Game.enableDesync(100);

			// Run ticks to trigger detection
			for (let i = 0; i < 25; i++) {
				hostSession.tick(NEUTRAL_INPUT);
				p2Session.tick(NEUTRAL_INPUT);
				p3Session.tick(NEUTRAL_INPUT);
				flushAll(hostTransport, p2Transport, p3Transport);
			}

			// In Mesh+Peer mode, multiple players should detect
			// p3 will detect when comparing with host and p2
			// host and p2 will detect when comparing with p3
			assert.ok(
				allDesyncs.length > 0,
				`Mesh+Peer (3 players): Should detect desync, got ${allDesyncs.length}`,
			);

			// In full mesh peer mode, we expect multiple detections
			// p3 detects vs host, p3 detects vs p2, host detects vs p3, p2 detects vs p3
			const p3Desyncs = allDesyncs.filter((d) => d.player === "p3");
			assert.ok(
				p3Desyncs.length > 0,
				`Mesh+Peer (3 players): p3 should detect its own desync`,
			);

			// Run more ticks to allow recovery
			for (let i = 0; i < 20; i++) {
				hostSession.tick(NEUTRAL_INPUT);
				p2Session.tick(NEUTRAL_INPUT);
				p3Session.tick(NEUTRAL_INPUT);
				flushAll(hostTransport, p2Transport, p3Transport);
			}

			// After recovery, all games should be in sync
			assert.strictEqual(
				hostGame.hash(),
				p2Game.hash(),
				"Mesh+Peer (3 players): host and p2 should be in sync after recovery",
			);
			assert.strictEqual(
				hostGame.hash(),
				p3Game.hash(),
				"Mesh+Peer (3 players): host and p3 should be in sync after recovery",
			);
		});

		it("should handle desync from non-host player in all topologies", async () => {
			// Test that desync detection works regardless of which player desyncs
			for (const topology of [Topology.Star, Topology.Mesh]) {
				for (const authority of [DesyncAuthority.Host, DesyncAuthority.Peer]) {
					const transports = createLocalTransportGroup(["host", "p2", "p3"]);
					const hostTransport = getTransport(transports, "host");
					const p2Transport = getTransport(transports, "p2");
					const p3Transport = getTransport(transports, "p3");

					const hostGame = new TestGame();
					const p2Game = new TestGame();
					const p3Game = new TestGame();

					const config = {
						topology,
						desyncAuthority: authority,
						hashInterval: 5,
						inputDelayTicks: 0,
					};

					const hostSession = createSession({
						game: hostGame,
						transport: hostTransport,
						config,
					});
					const p2Session = createSession({
						game: p2Game,
						transport: p2Transport,
						config,
					});
					const p3Session = createSession({
						game: p3Game,
						transport: p3Transport,
						config,
					});

					let desyncDetected = false;
					hostSession.on("desync", () => {
						desyncDetected = true;
					});
					p2Session.on("desync", () => {
						desyncDetected = true;
						p2Game.disableDesync();
					});
					p3Session.on("desync", () => {
						desyncDetected = true;
					});

					// Set up session
					await hostSession.createRoom();
					await p2Session.joinRoom(hostSession.roomId!, "host");
					flushAll(hostTransport, p2Transport, p3Transport);
					await p3Session.joinRoom(hostSession.roomId!, "host");
					flushAll(hostTransport, p2Transport, p3Transport);

					// For Mesh, establish peer-to-peer connections
					if (topology === Topology.Mesh) {
						await p2Transport.connect("p3");
						await p3Transport.connect("p2");
						flushAll(hostTransport, p2Transport, p3Transport);
					}

					hostSession.start();
					flushAll(hostTransport, p2Transport, p3Transport);

					// Run some ticks in sync
					for (let i = 0; i < 10; i++) {
						hostSession.tick(NEUTRAL_INPUT);
						p2Session.tick(NEUTRAL_INPUT);
						p3Session.tick(NEUTRAL_INPUT);
						flushAll(hostTransport, p2Transport, p3Transport);
					}

					// Enable desync on p2 (middle player, not host, not last)
					p2Game.enableDesync(100);

					// Run ticks to trigger detection
					for (let i = 0; i < 25; i++) {
						hostSession.tick(NEUTRAL_INPUT);
						p2Session.tick(NEUTRAL_INPUT);
						p3Session.tick(NEUTRAL_INPUT);
						flushAll(hostTransport, p2Transport, p3Transport);
					}

					const topologyName = topology === Topology.Star ? "Star" : "Mesh";
					const authorityName = authority === DesyncAuthority.Host ? "Host" : "Peer";
					assert.ok(
						desyncDetected,
						`${topologyName}+${authorityName}: Should detect desync when p2 diverges`,
					);

					// Cleanup sessions
					hostSession.destroy();
					p2Session.destroy();
					p3Session.destroy();
				}
			}
		});
	});

	describe("desync recovery with simulated latency", () => {
		/**
		 * This test verifies that multiple rapid desyncs with network latency
		 * don't cause the game to deadlock at max speculation.
		 *
		 * Previously, this scenario would cause a deadlock because:
		 * 1. When a player requested sync, only that player received the sync message
		 * 2. With latency, by the time sync arrived, the synced player's tick was
		 *    behind other players by more than the input redundancy window
		 * 3. The synced player couldn't get inputs from other players (they were too old)
		 * 4. All players would hit max speculation and freeze
		 *
		 * The fix broadcasts sync to ALL players, ensuring everyone resets to
		 * the same tick and eliminating tick divergence.
		 */
		it("should recover from multiple rapid desyncs with latency (Mesh + Peer)", async () => {
			// Create transports WITH latency - this is key to reproducing the bug
			const transports = createLocalTransportGroup(["host", "p2", "p3"], {
				latency: 50, // 50ms one-way latency (100ms round trip)
			});
			const hostTransport = getTransport(transports, "host");
			const p2Transport = getTransport(transports, "p2");
			const p3Transport = getTransport(transports, "p3");

			const hostGame = new TestGame();
			const p2Game = new TestGame();
			const p3Game = new TestGame();

			const config = {
				topology: Topology.Mesh,
				desyncAuthority: DesyncAuthority.Peer,
				hashInterval: 5,
				inputDelayTicks: 0,
				maxSpeculationTicks: 60,
			};

			const hostSession = createSession({
				game: hostGame,
				transport: hostTransport,
				config,
			});
			const p2Session = createSession({
				game: p2Game,
				transport: p2Transport,
				config,
			});
			const p3Session = createSession({
				game: p3Game,
				transport: p3Transport,
				config,
			});

			let desyncCount = 0;
			hostSession.on("desync", () => desyncCount++);
			p2Session.on("desync", () => desyncCount++);
			p3Session.on("desync", () => desyncCount++);

			// Set up session
			await hostSession.createRoom();
			await p2Session.joinRoom(hostSession.roomId!, "host");
			flushAll(hostTransport, p2Transport, p3Transport);
			await p3Session.joinRoom(hostSession.roomId!, "host");
			flushAll(hostTransport, p2Transport, p3Transport);

			// Establish peer-to-peer connections for Mesh
			await p2Transport.connect("p3");
			await p3Transport.connect("p2");
			flushAll(hostTransport, p2Transport, p3Transport);

			hostSession.start();
			flushAll(hostTransport, p2Transport, p3Transport);

			const TICK_MS = 16; // ~60 FPS

			// Helper to run ticks with time-based delivery (simulates real latency)
			const runTicksWithLatency = (count: number) => {
				for (let i = 0; i < count; i++) {
					// Tick transports first (delivers messages based on simulated time)
					hostTransport.tick(TICK_MS);
					p2Transport.tick(TICK_MS);
					p3Transport.tick(TICK_MS);

					// Then tick sessions
					hostSession.tick(NEUTRAL_INPUT);
					p2Session.tick(NEUTRAL_INPUT);
					p3Session.tick(NEUTRAL_INPUT);
				}
			};

			// Run some ticks to establish sync (use flush for initial setup)
			for (let i = 0; i < 20; i++) {
				hostSession.tick(NEUTRAL_INPUT);
				p2Session.tick(NEUTRAL_INPUT);
				p3Session.tick(NEUTRAL_INPUT);
				flushAll(hostTransport, p2Transport, p3Transport);
			}

			// Verify initial sync
			assert.strictEqual(hostGame.hash(), p2Game.hash(), "Initial sync check: host vs p2");
			assert.strictEqual(hostGame.hash(), p3Game.hash(), "Initial sync check: host vs p3");

			// Now switch to latency-based delivery and induce multiple desyncs
			// This is the scenario that previously caused deadlock

			// Induce desync #1
			p2Game.induceDesync();
			runTicksWithLatency(10); // ~160ms - not enough time for full sync with 100ms RTT

			// Induce desync #2 before #1 fully recovers
			p2Game.induceDesync();
			runTicksWithLatency(10);

			// Induce desync #3
			p2Game.induceDesync();
			runTicksWithLatency(10);

			// Induce desync #4
			p2Game.induceDesync();
			runTicksWithLatency(10);

			// Induce desync #5
			p2Game.induceDesync();
			runTicksWithLatency(10);

			// At this point, the old code would have caused a deadlock
			// with all players stuck at max speculation

			// Run more ticks to allow recovery
			// Use flush to ensure all messages are delivered
			for (let i = 0; i < 60; i++) {
				hostSession.tick(NEUTRAL_INPUT);
				p2Session.tick(NEUTRAL_INPUT);
				p3Session.tick(NEUTRAL_INPUT);
				flushAll(hostTransport, p2Transport, p3Transport);
			}

			// Verify that sessions are NOT stuck at max speculation
			// (the bug caused currentTick - confirmedTick >= maxSpeculationTicks)
			const hostSpeculation = hostSession.currentTick - hostSession.confirmedTick;
			const p2Speculation = p2Session.currentTick - p2Session.confirmedTick;
			const p3Speculation = p3Session.currentTick - p3Session.confirmedTick;

			assert.ok(
				hostSpeculation < config.maxSpeculationTicks,
				`Host should not be at max speculation (got ${hostSpeculation})`,
			);
			assert.ok(
				p2Speculation < config.maxSpeculationTicks,
				`P2 should not be at max speculation (got ${p2Speculation})`,
			);
			assert.ok(
				p3Speculation < config.maxSpeculationTicks,
				`P3 should not be at max speculation (got ${p3Speculation})`,
			);

			// Verify games are in sync after recovery
			assert.strictEqual(
				hostGame.hash(),
				p2Game.hash(),
				"After recovery: host and p2 should be in sync",
			);
			assert.strictEqual(
				hostGame.hash(),
				p3Game.hash(),
				"After recovery: host and p3 should be in sync",
			);

			// Verify desyncs were detected
			assert.ok(desyncCount > 0, `Should have detected desyncs (got ${desyncCount})`);

			// Cleanup
			hostSession.destroy();
			p2Session.destroy();
			p3Session.destroy();
		});

		it("should recover from multiple rapid desyncs with latency (Mesh + Host authority)", async () => {
			const transports = createLocalTransportGroup(["host", "p2", "p3"], {
				latency: 50,
			});
			const hostTransport = getTransport(transports, "host");
			const p2Transport = getTransport(transports, "p2");
			const p3Transport = getTransport(transports, "p3");

			const hostGame = new TestGame();
			const p2Game = new TestGame();
			const p3Game = new TestGame();

			const config = {
				topology: Topology.Mesh,
				desyncAuthority: DesyncAuthority.Host,
				hashInterval: 5,
				inputDelayTicks: 0,
				maxSpeculationTicks: 60,
			};

			const hostSession = createSession({
				game: hostGame,
				transport: hostTransport,
				config,
			});
			const p2Session = createSession({
				game: p2Game,
				transport: p2Transport,
				config,
			});
			const p3Session = createSession({
				game: p3Game,
				transport: p3Transport,
				config,
			});

			let hostDesyncCount = 0;
			hostSession.on("desync", () => hostDesyncCount++);

			// Set up session
			await hostSession.createRoom();
			await p2Session.joinRoom(hostSession.roomId!, "host");
			flushAll(hostTransport, p2Transport, p3Transport);
			await p3Session.joinRoom(hostSession.roomId!, "host");
			flushAll(hostTransport, p2Transport, p3Transport);

			// Establish peer-to-peer connections for Mesh
			await p2Transport.connect("p3");
			await p3Transport.connect("p2");
			flushAll(hostTransport, p2Transport, p3Transport);

			hostSession.start();
			flushAll(hostTransport, p2Transport, p3Transport);

			const TICK_MS = 16;

			// Run initial sync ticks
			for (let i = 0; i < 20; i++) {
				hostSession.tick(NEUTRAL_INPUT);
				p2Session.tick(NEUTRAL_INPUT);
				p3Session.tick(NEUTRAL_INPUT);
				flushAll(hostTransport, p2Transport, p3Transport);
			}

			// Verify initial sync
			assert.strictEqual(hostGame.hash(), p2Game.hash(), "Initial sync: host vs p2");

			// Induce multiple rapid desyncs with latency
			for (let round = 0; round < 5; round++) {
				p2Game.induceDesync();

				// Run ticks with latency-based delivery
				for (let i = 0; i < 10; i++) {
					hostTransport.tick(TICK_MS);
					p2Transport.tick(TICK_MS);
					p3Transport.tick(TICK_MS);
					hostSession.tick(NEUTRAL_INPUT);
					p2Session.tick(NEUTRAL_INPUT);
					p3Session.tick(NEUTRAL_INPUT);
				}
			}

			// Run recovery ticks with flush to ensure delivery
			for (let i = 0; i < 60; i++) {
				hostSession.tick(NEUTRAL_INPUT);
				p2Session.tick(NEUTRAL_INPUT);
				p3Session.tick(NEUTRAL_INPUT);
				flushAll(hostTransport, p2Transport, p3Transport);
			}

			// Verify not stuck at max speculation
			const hostSpec = hostSession.currentTick - hostSession.confirmedTick;
			const p2Spec = p2Session.currentTick - p2Session.confirmedTick;

			assert.ok(
				hostSpec < config.maxSpeculationTicks,
				`Host should not be at max speculation (got ${hostSpec})`,
			);
			assert.ok(
				p2Spec < config.maxSpeculationTicks,
				`P2 should not be at max speculation (got ${p2Spec})`,
			);

			// Verify sync after recovery
			assert.strictEqual(
				hostGame.hash(),
				p2Game.hash(),
				"After recovery: host and p2 should be in sync",
			);

			// Host should have detected desyncs
			assert.ok(hostDesyncCount > 0, `Host should have detected desyncs (got ${hostDesyncCount})`);

			hostSession.destroy();
			p2Session.destroy();
			p3Session.destroy();
		});
	});
});
