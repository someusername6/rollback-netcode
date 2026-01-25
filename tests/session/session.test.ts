import assert from "node:assert";
import { beforeEach, describe, it } from "node:test";
import {
	LocalTransport,
	createLocalTransportGroup,
} from "../../src/transport/local.js";
import {
	SessionState,
	asPlayerId,
	asTick,
} from "../../src/types.js";
import { type Session, createSession } from "../../src/session/session.js";
import { TestGame } from "../utils/test-game.js";

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
 * Helper to get room ID with assertion.
 */
function getRoomId(session: Session): string {
	const roomId = session.roomId;
	assert.ok(roomId, "Room ID should exist");
	return roomId;
}

describe("Session", () => {
	describe("room creation", () => {
		it("should create a room and become host", async () => {
			const transport = new LocalTransport("host");
			const game = new TestGame();
			const session = createSession({ game, transport });

			const roomId = await session.createRoom();

			assert.ok(roomId);
			assert.strictEqual(session.isHost, true);
			assert.strictEqual(session.state, SessionState.Lobby);
			assert.strictEqual(session.roomId, roomId);
		});

		it("should throw when creating room while already in one", async () => {
			const transport = new LocalTransport("host");
			const game = new TestGame();
			const session = createSession({ game, transport });

			await session.createRoom();

			await assert.rejects(() => session.createRoom(), /Already in a room/);
		});
	});

	describe("joining rooms", () => {
		it("should join an existing room", async () => {
			const transports = createLocalTransportGroup(["host", "client"]);
			const hostTransport = getTransport(transports, "host");
			const clientTransport = getTransport(transports, "client");

			const hostGame = new TestGame();
			const clientGame = new TestGame();

			const hostSession = createSession({
				game: hostGame,
				transport: hostTransport,
			});
			const clientSession = createSession({
				game: clientGame,
				transport: clientTransport,
			});

			const roomId = await hostSession.createRoom();
			await clientSession.joinRoom(roomId, "host");

			// Flush messages: client sends JoinRequest, host receives and sends JoinAccept
			clientTransport.flush(); // Deliver JoinRequest to host
			hostTransport.flush(); // Deliver JoinAccept to client

			assert.strictEqual(clientSession.state, SessionState.Lobby);
			assert.strictEqual(clientSession.isHost, false);
		});
	});

	describe("starting game", () => {
		it("should start game from lobby", async () => {
			const transports = createLocalTransportGroup(["host", "client"]);
			const hostTransport = getTransport(transports, "host");
			const clientTransport = getTransport(transports, "client");

			const hostGame = new TestGame();
			const clientGame = new TestGame();

			const hostSession = createSession({
				game: hostGame,
				transport: hostTransport,
			});
			const clientSession = createSession({
				game: clientGame,
				transport: clientTransport,
			});

			await hostSession.createRoom();
			await clientSession.joinRoom(getRoomId(hostSession), "host");
			clientTransport.flush();
			hostTransport.flush();

			// Start game
			hostSession.start();
			hostTransport.flush(); // Host sends StateSync
			clientTransport.flush(); // Client receives it

			assert.strictEqual(hostSession.state, SessionState.Playing);
			assert.strictEqual(clientSession.state, SessionState.Playing);
		});

		it("should throw when non-host tries to start", async () => {
			const transports = createLocalTransportGroup(["host", "client"]);
			const hostTransport = getTransport(transports, "host");
			const clientTransport = getTransport(transports, "client");

			const hostGame = new TestGame();
			const clientGame = new TestGame();

			const hostSession = createSession({
				game: hostGame,
				transport: hostTransport,
			});
			const clientSession = createSession({
				game: clientGame,
				transport: clientTransport,
			});

			await hostSession.createRoom();
			await clientSession.joinRoom(getRoomId(hostSession), "host");
			clientTransport.flush();
			hostTransport.flush();

			assert.throws(() => clientSession.start(), /Only the host/);
		});
	});

	describe("ticking", () => {
		it("should advance simulation with tick()", async () => {
			const transport = new LocalTransport("host");
			const game = new TestGame();
			const session = createSession({ game, transport });

			await session.createRoom();
			session.start();

			const result = session.tick(new Uint8Array([138, 128])); // +10 x

			assert.strictEqual(result.tick, 0);
			assert.strictEqual(session.currentTick, 1);
			assert.strictEqual(game.x, 10);
		});

		it("should sync between two players", async () => {
			const transports = createLocalTransportGroup(["host", "client"]);
			const hostTransport = getTransport(transports, "host");
			const clientTransport = getTransport(transports, "client");

			const hostGame = new TestGame();
			const clientGame = new TestGame();

			const hostSession = createSession({
				game: hostGame,
				transport: hostTransport,
			});
			const clientSession = createSession({
				game: clientGame,
				transport: clientTransport,
			});

			await hostSession.createRoom();
			await clientSession.joinRoom(getRoomId(hostSession), "host");
			clientTransport.flush(); // JoinRequest to host
			hostTransport.flush(); // JoinAccept to client

			hostSession.start();
			hostTransport.flush(); // StateSync to client

			// Verify both sessions are at the same starting tick
			assert.strictEqual(hostSession.currentTick, clientSession.currentTick);

			// Both players tick with same input
			for (let i = 0; i < 10; i++) {
				hostSession.tick(new Uint8Array([138, 128])); // +10 x
				clientSession.tick(new Uint8Array([128, 138])); // +10 y

				// Exchange messages (both directions)
				hostTransport.flush();
				clientTransport.flush();
			}

			// Run extra ticks with no movement to allow final rollbacks
			for (let i = 0; i < 5; i++) {
				hostSession.tick(new Uint8Array([128, 128]));
				clientSession.tick(new Uint8Array([128, 128]));
				hostTransport.flush();
				clientTransport.flush();
			}

			// Games should be in sync
			// 10 ticks with: host +10x, client +10y = x+100, y+100
			assert.strictEqual(hostGame.x, 100);
			assert.strictEqual(hostGame.y, 100);
			assert.strictEqual(clientGame.x, 100);
			assert.strictEqual(clientGame.y, 100);
		});
	});

	describe("pause and resume", () => {
		it("should pause game", async () => {
			const transport = new LocalTransport("host");
			const game = new TestGame();
			const session = createSession({ game, transport });

			await session.createRoom();
			session.start();
			session.pause();

			assert.strictEqual(session.state, SessionState.Paused);
		});

		it("should resume game", async () => {
			const transport = new LocalTransport("host");
			const game = new TestGame();
			const session = createSession({ game, transport });

			await session.createRoom();
			session.start();
			session.pause();
			session.resume();

			assert.strictEqual(session.state, SessionState.Playing);
		});

		it("should not advance during pause", async () => {
			const transport = new LocalTransport("host");
			const game = new TestGame();
			const session = createSession({ game, transport });

			await session.createRoom();
			session.start();
			session.tick(new Uint8Array([138, 128]));
			assert.strictEqual(session.currentTick, 1);

			session.pause();
			session.tick(new Uint8Array([138, 128])); // Should be ignored

			assert.strictEqual(session.currentTick, 1); // No change
		});
	});

	describe("leaving room", () => {
		it("should leave room and reset state", async () => {
			const transport = new LocalTransport("host");
			const game = new TestGame();
			const session = createSession({ game, transport });

			await session.createRoom();
			session.start();
			session.tick(new Uint8Array([138, 128]));

			session.leaveRoom();

			assert.strictEqual(session.state, SessionState.Disconnected);
			assert.strictEqual(session.roomId, null);
			assert.strictEqual(session.isHost, false);
			assert.strictEqual(session.currentTick, 0);
		});
	});

	describe("events", () => {
		it("should emit stateChange events", async () => {
			const transport = new LocalTransport("host");
			const game = new TestGame();
			const session = createSession({ game, transport });

			const stateChanges: SessionState[] = [];
			session.on("stateChange", (newState) => {
				stateChanges.push(newState);
			});

			await session.createRoom();
			session.start();
			session.pause();
			session.resume();
			session.leaveRoom();

			assert.deepStrictEqual(stateChanges, [
				SessionState.Lobby,
				SessionState.Playing,
				SessionState.Paused,
				SessionState.Playing,
				SessionState.Disconnected,
			]);
		});

		it("should emit playerJoined events", async () => {
			const transports = createLocalTransportGroup(["host", "client"]);
			const hostTransport = getTransport(transports, "host");
			const clientTransport = getTransport(transports, "client");

			const hostGame = new TestGame();
			const clientGame = new TestGame();

			const hostSession = createSession({
				game: hostGame,
				transport: hostTransport,
			});
			const clientSession = createSession({
				game: clientGame,
				transport: clientTransport,
			});

			const joinedPlayers: PlayerId[] = [];
			hostSession.on("playerJoined", (player) => {
				joinedPlayers.push(player.id);
			});

			await hostSession.createRoom();
			await clientSession.joinRoom(getRoomId(hostSession), "host");
			clientTransport.flush();
			hostTransport.flush();

			assert.strictEqual(joinedPlayers.length, 1);
			assert.strictEqual(joinedPlayers[0], "client");
		});

		it("should emit gameStart events", async () => {
			const transport = new LocalTransport("host");
			const game = new TestGame();
			const session = createSession({ game, transport });

			let started = false;
			session.on("gameStart", () => {
				started = true;
			});

			await session.createRoom();
			session.start();

			assert.strictEqual(started, true);
		});

		it("should remove all listeners for a specific event", async () => {
			const transport = new LocalTransport("host");
			const game = new TestGame();
			const session = createSession({ game, transport });

			let callCount = 0;
			session.on("gameStart", () => {
				callCount++;
			});
			session.on("gameStart", () => {
				callCount++;
			});

			// Remove all gameStart listeners
			session.removeAllListeners("gameStart");

			await session.createRoom();
			session.start();

			// Neither handler should have been called
			assert.strictEqual(callCount, 0);
		});

		it("should remove all listeners when no event specified", async () => {
			const transport = new LocalTransport("host");
			const game = new TestGame();
			const session = createSession({ game, transport });

			let gameStartCalled = false;
			let stateChangeCalled = false;

			session.on("gameStart", () => {
				gameStartCalled = true;
			});
			session.on("stateChange", () => {
				stateChangeCalled = true;
			});

			// Remove all listeners
			session.removeAllListeners();

			await session.createRoom();
			session.start();

			// No handlers should have been called
			assert.strictEqual(gameStartCalled, false);
			assert.strictEqual(stateChangeCalled, false);
		});
	});

	describe("multi-player sync", () => {
		it("should handle 3-player game", async () => {
			const transports = createLocalTransportGroup(["p1", "p2", "p3"]);
			const games = new Map<string, TestGame>();
			const sessions = new Map<string, Session>();

			// Helper to flush all transports multiple times for full propagation
			const flushAll = () => {
				for (let i = 0; i < 3; i++) {
					for (const t of transports.values()) t.flush();
				}
			};

			for (const [peerId, transport] of transports) {
				const game = new TestGame();
				games.set(peerId, game);
				sessions.set(peerId, createSession({ game, transport }));
			}

			// P1 creates room
			const p1Session = sessions.get("p1");
			assert.ok(p1Session, "P1 session should exist");
			await p1Session.createRoom();

			// P2 and P3 join
			for (const peerId of ["p2", "p3"]) {
				const session = sessions.get(peerId);
				assert.ok(session, `Session for ${peerId} should exist`);
				await session.joinRoom(getRoomId(p1Session), "p1");
				flushAll();
			}

			// Start game
			p1Session.start();
			flushAll();

			// Verify all sessions are playing
			for (const session of sessions.values()) {
				assert.strictEqual(session.state, SessionState.Playing);
			}

			// Run 5 ticks
			for (let i = 0; i < 5; i++) {
				sessions.get("p1")?.tick(new Uint8Array([138, 128])); // +10 x
				sessions.get("p2")?.tick(new Uint8Array([128, 138])); // +10 y
				sessions.get("p3")?.tick(new Uint8Array([128, 128])); // no movement

				flushAll();
			}

			// Run a few more ticks to allow final rollbacks
			for (let i = 0; i < 3; i++) {
				for (const session of sessions.values()) {
					session.tick(new Uint8Array([128, 128]));
				}
				flushAll();
			}

			// All games should have same state
			const expectedX = 50;
			const expectedY = 50;

			for (const [, game] of games) {
				assert.strictEqual(game.x, expectedX);
				assert.strictEqual(game.y, expectedY);
			}
		});
	});

	describe("rollback in multiplayer", () => {
		it("should rollback when inputs arrive late", async () => {
			const transports = createLocalTransportGroup(["host", "client"], {
				latency: 50, // 50ms latency
			});
			const hostTransport = getTransport(transports, "host");
			const clientTransport = getTransport(transports, "client");

			const hostGame = new TestGame();
			const clientGame = new TestGame();

			const hostSession = createSession({
				game: hostGame,
				transport: hostTransport,
			});
			const clientSession = createSession({
				game: clientGame,
				transport: clientTransport,
			});

			await hostSession.createRoom();
			await clientSession.joinRoom(getRoomId(hostSession), "host");

			// Flush initial messages (need to alternate to handle request/response)
			clientTransport.tick(100); // JoinRequest to host
			hostTransport.tick(100); // JoinAccept to client

			hostSession.start();
			hostTransport.tick(100); // StateSync to client

			// Run ticks with latency
			let rollbackOccurred = false;
			for (let i = 0; i < 20; i++) {
				const hostResult = hostSession.tick(new Uint8Array([138, 128]));
				const clientResult = clientSession.tick(new Uint8Array([118, 128]));

				if (hostResult.rolledBack || clientResult.rolledBack) {
					rollbackOccurred = true;
				}

				// Advance time to deliver messages
				hostTransport.tick(20);
				clientTransport.tick(20);
			}

			// Due to latency, rollbacks should occur
			assert.strictEqual(rollbackOccurred, true);

			// Final state should still be in sync (eventually)
			// Deliver remaining messages
			hostTransport.tick(200);
			clientTransport.tick(200);

			assert.strictEqual(hostGame.x, clientGame.x);
			assert.strictEqual(hostGame.y, clientGame.y);
		});
	});

	describe("createSession factory", () => {
		it("should create session with custom config", async () => {
			const transport = new LocalTransport("host");
			const game = new TestGame();
			const session = createSession({
				game,
				transport,
				config: {
					tickRate: 30,
					maxPlayers: 8,
				},
			});

			await session.createRoom();
			assert.strictEqual(session.state, SessionState.Lobby);
		});
	});

	describe("request sync", () => {
		it("should allow requesting sync from host", async () => {
			const transports = createLocalTransportGroup(["host", "client"]);
			const hostTransport = getTransport(transports, "host");
			const clientTransport = getTransport(transports, "client");

			const hostGame = new TestGame();
			const clientGame = new TestGame();

			const hostSession = createSession({
				game: hostGame,
				transport: hostTransport,
			});
			const clientSession = createSession({
				game: clientGame,
				transport: clientTransport,
			});

			await hostSession.createRoom();
			await clientSession.joinRoom(getRoomId(hostSession), "host");
			clientTransport.flush(); // JoinRequest
			hostTransport.flush(); // JoinAccept

			hostSession.start();
			hostTransport.flush(); // StateSync

			// Host advances
			for (let i = 0; i < 5; i++) {
				hostSession.tick(new Uint8Array([138, 128]));
				hostTransport.flush();
			}

			// Client requests sync
			clientSession.requestSync();
			clientTransport.flush();
			clientTransport.flush();
			hostTransport.flush();

			// Client should now be synced
			assert.strictEqual(clientGame.x, hostGame.x);
		});
	});

	describe("error handling", () => {
		it("should throw when joining while already in room", async () => {
			const transport = new LocalTransport("test");
			const session = createSession({
				game: new TestGame(),
				transport,
			});

			await session.createRoom();

			// Can't join while already in a room
			await assert.rejects(
				session.joinRoom("other-room", "other-host"),
				/Already in a room/,
				"Joining while in room should throw descriptive error",
			);
		});

		it("should throw when starting from wrong state", async () => {
			const transport = new LocalTransport("host");
			const session = createSession({
				game: new TestGame(),
				transport,
			});

			// Create room, start, then try to start again
			await session.createRoom();
			session.start();

			// Already playing - can't start again
			assert.throws(
				() => session.start(),
				/Can only start from lobby state/,
				"Starting while already playing should throw descriptive error",
			);
		});

		it("should throw when non-host tries to pause", async () => {
			const transports = createLocalTransportGroup(["host", "client"]);
			const hostTransport = getTransport(transports, "host");
			const clientTransport = getTransport(transports, "client");

			const hostSession = createSession({
				game: new TestGame(),
				transport: hostTransport,
			});
			const clientSession = createSession({
				game: new TestGame(),
				transport: clientTransport,
			});

			await hostSession.createRoom();
			await clientSession.joinRoom(getRoomId(hostSession), "host");
			clientTransport.flush();
			hostTransport.flush();

			hostSession.start();
			hostTransport.flush();

			// Client trying to pause should throw
			assert.throws(
				() => clientSession.pause(),
				/Only the host can pause/,
				"Non-host pause should throw descriptive error",
			);
		});

		it("should emit error event for malformed messages", async () => {
			const transport = new LocalTransport("host");
			const session = createSession({
				game: new TestGame(),
				transport,
			});

			let errorReceived = false;
			session.on("error", () => {
				errorReceived = true;
			});

			await session.createRoom();

			// Simulate receiving a malformed message
			const malformedData = new Uint8Array([0xff, 0xff, 0xff]);

			// Access internal message handling through transport callback
			if (transport.onMessage) {
				transport.onMessage("fake-peer", malformedData);
			}

			assert.strictEqual(
				errorReceived,
				true,
				"Error event should be emitted for malformed messages",
			);
		});
	});
});
