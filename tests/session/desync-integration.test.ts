import assert from "node:assert";
import { describe, it } from "node:test";
import {
	type LocalTransport,
	createLocalTransportGroup,
} from "../../src/transport/local.js";
import { type Game, type PlayerId, type Tick } from "../../src/types.js";
import { createSession } from "../../src/session/session.js";

/**
 * Neutral input that causes no movement (128 - 128 = 0 for both axes).
 */
const NEUTRAL_INPUT = new Uint8Array([128, 128]);

/**
 * Test game that can be configured to behave non-deterministically.
 * When `nonDeterministic` is true, the step function adds extra value,
 * causing the game to desync from other instances.
 *
 * By default, behaves deterministically (can be used as a normal test game).
 */
class TestGame implements Game {
	x = 0;
	y = 0;

	/** When true, adds extra value to x on each step, causing desync */
	private nonDeterministic = false;

	/** Extra value added when non-deterministic (simulates a bug) */
	private extraValue = 0;

	serialize(): Uint8Array {
		const buffer = new ArrayBuffer(8);
		const view = new DataView(buffer);
		view.setInt32(0, this.x);
		view.setInt32(4, this.y);
		return new Uint8Array(buffer);
	}

	deserialize(data: Uint8Array): void {
		const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
		this.x = view.getInt32(0);
		this.y = view.getInt32(4);
	}

	step(inputs: Map<PlayerId, Uint8Array>): void {
		for (const [, input] of inputs) {
			if (input.length >= 2) {
				this.x += (input[0] ?? 0) - 128;
				this.y += (input[1] ?? 0) - 128;
			}
		}

		// When non-deterministic, add extra value (simulates a bug)
		if (this.nonDeterministic) {
			this.x += this.extraValue;
		}
	}

	hash(): number {
		return this.x * 10000 + this.y;
	}

	/**
	 * Enable non-deterministic behavior to cause desync.
	 */
	enableDesync(extraValue = 1): void {
		this.nonDeterministic = true;
		this.extraValue = extraValue;
	}

	/**
	 * Disable non-deterministic behavior.
	 */
	disableDesync(): void {
		this.nonDeterministic = false;
		this.extraValue = 0;
	}
}

/**
 * Helper to get a transport from the map with assertion.
 */
function getTransport(
	transports: Map<string, LocalTransport>,
	peerId: string,
): LocalTransport {
	const transport = transports.get(peerId);
	assert.ok(transport, `Transport for ${peerId} should exist`);
	return transport;
}

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
});
