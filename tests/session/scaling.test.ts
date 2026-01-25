/**
 * Tests for multi-player scaling.
 *
 * Verifies that the library handles 5+ players correctly.
 */

import assert from "node:assert";
import { describe, it } from "node:test";
import { createSession } from "../../src/session/session.js";
import { LocalTransport } from "../../src/transport/local.js";
import { Topology } from "../../src/types.js";
import { flushTransports, MultiPlayerGame } from "../utils/test-helpers.js";

interface PlayerSetup {
	game: MultiPlayerGame;
	transport: LocalTransport;
	session: ReturnType<typeof createSession>;
}

/**
 * Create a multi-player session with the specified number of players.
 * @param playerCount - Number of players to create
 * @param topology - Network topology (default: Star)
 * @param maxPlayers - Max players for the session (default: playerCount)
 */
async function createMultiPlayerSession(
	playerCount: number,
	topology: Topology = Topology.Star,
	maxPlayers?: number,
): Promise<PlayerSetup[]> {
	const players: PlayerSetup[] = [];
	const effectiveMaxPlayers = maxPlayers ?? playerCount;

	// Create host
	const hostGame = new MultiPlayerGame();
	const hostTransport = new LocalTransport("host");
	const hostSession = createSession({
		game: hostGame,
		transport: hostTransport,
		config: {
			topology,
			maxPlayers: effectiveMaxPlayers,
		},
	});

	hostSession.on("playerJoined", (info) => hostGame.addPlayer(info.id));
	hostSession.on("playerLeft", (info) => hostGame.removePlayer(info.id));

	players.push({ game: hostGame, transport: hostTransport, session: hostSession });

	await hostSession.createRoom();
	hostGame.addPlayer("host");
	hostSession.start();

	// Create guests - must join one at a time with flush between each
	// to ensure StateSync is delivered before next player joins
	for (let i = 1; i < playerCount; i++) {
		const guestId = `player${i}`;
		const guestGame = new MultiPlayerGame();
		const guestTransport = new LocalTransport(guestId);
		const guestSession = createSession({
			game: guestGame,
			transport: guestTransport,
			config: {
				topology,
				maxPlayers: effectiveMaxPlayers,
			},
		});

		guestSession.on("playerJoined", (info) => guestGame.addPlayer(info.id));
		guestSession.on("playerLeft", (info) => guestGame.removePlayer(info.id));

		// Link to host (Star topology - all connect to host)
		LocalTransport.link(hostTransport, guestTransport);

		await guestSession.joinRoom("room", "host");

		players.push({ game: guestGame, transport: guestTransport, session: guestSession });

		// Flush after each join to ensure StateSync is delivered before next player joins
		// This prevents message ordering issues where PlayerJoined events are processed
		// before the joining player's StateSync arrives
		flushTransports(players.map((p) => p.transport), 5);
	}

	return players;
}

function cleanupPlayers(players: PlayerSetup[]): void {
	for (const player of players) {
		player.session.destroy();
	}
}

describe("Multi-player scaling", () => {
	it("should handle 6 players in Star topology", async () => {
		const players = await createMultiPlayerSession(6, Topology.Star);

		try {
			// Verify all players see 6 players
			for (const player of players) {
				assert.strictEqual(
					player.game.players.size,
					6,
					`Each player should see 6 players, but ${player.transport.localPeerId} sees ${player.game.players.size}`,
				);
			}

			// Run 30 ticks with all players sending different inputs
			for (let tick = 0; tick < 30; tick++) {
				for (let i = 0; i < players.length; i++) {
					// Each player moves in a different direction based on their index
					const dx = ((i % 3) - 1) + 128; // -1, 0, or 1 + 128
					const dy = (Math.floor(i / 3) - 1) + 128;
					players[i]!.session.tick(new Uint8Array([dx, dy]));
				}
				flushTransports(players.map((p) => p.transport));
			}

			// Verify all players are in sync
			const referenceHash = players[0]!.game.hash();
			for (let i = 1; i < players.length; i++) {
				assert.strictEqual(
					players[i]!.game.hash(),
					referenceHash,
					`Player ${i} should have same hash as host`,
				);
			}
		} finally {
			cleanupPlayers(players);
		}
	});

	it("should handle 8 players in Star topology", async () => {
		const players = await createMultiPlayerSession(8, Topology.Star);

		try {
			// Verify all players see 8 players
			for (const player of players) {
				assert.strictEqual(
					player.game.players.size,
					8,
					`Each player should see 8 players`,
				);
			}

			// Run 20 ticks
			for (let tick = 0; tick < 20; tick++) {
				for (let i = 0; i < players.length; i++) {
					players[i]!.session.tick(new Uint8Array([128 + (i % 2), 128]));
				}
				flushTransports(players.map((p) => p.transport));
			}

			// Verify sync
			const referenceHash = players[0]!.game.hash();
			for (let i = 1; i < players.length; i++) {
				assert.strictEqual(
					players[i]!.game.hash(),
					referenceHash,
					`Player ${i} should be in sync with host`,
				);
			}
		} finally {
			cleanupPlayers(players);
		}
	});

	it("should handle player joining 6-player game mid-session", async () => {
		// Start with 5 players, but allow for 6 max
		const players = await createMultiPlayerSession(5, Topology.Star, 6);

		try {
			// Run some ticks
			for (let tick = 0; tick < 15; tick++) {
				for (const player of players) {
					player.session.tick(new Uint8Array([129, 128]));
				}
				flushTransports(players.map((p) => p.transport));
			}

			// Add 6th player mid-game
			const newGame = new MultiPlayerGame();
			const newTransport = new LocalTransport("player5");
			const newSession = createSession({
				game: newGame,
				transport: newTransport,
				config: {
					topology: Topology.Star,
					maxPlayers: 6,
				},
			});

			newSession.on("playerJoined", (info) => newGame.addPlayer(info.id));
			newSession.on("playerLeft", (info) => newGame.removePlayer(info.id));

			LocalTransport.link(players[0]!.transport, newTransport);
			await newSession.joinRoom("room", "host");

			const allPlayers = [...players, { game: newGame, transport: newTransport, session: newSession }];
			flushTransports(allPlayers.map((p) => p.transport), 10);

			// All should now see 6 players
			for (const player of allPlayers) {
				assert.strictEqual(
					player.game.players.size,
					6,
					`Each player should see 6 players after late join`,
				);
			}

			// Continue gameplay
			for (let tick = 0; tick < 15; tick++) {
				for (const player of allPlayers) {
					player.session.tick(new Uint8Array([128, 129]));
				}
				flushTransports(allPlayers.map((p) => p.transport));
			}

			// Verify sync
			const referenceHash = allPlayers[0]!.game.hash();
			for (let i = 1; i < allPlayers.length; i++) {
				assert.strictEqual(
					allPlayers[i]!.game.hash(),
					referenceHash,
					`Player ${i} should be in sync after late join`,
				);
			}

			newSession.destroy();
		} finally {
			cleanupPlayers(players);
		}
	});

	it("should handle player leaving 6-player game", async () => {
		const players = await createMultiPlayerSession(6, Topology.Star);

		try {
			// Run some ticks
			for (let tick = 0; tick < 10; tick++) {
				for (const player of players) {
					player.session.tick(new Uint8Array([128, 128]));
				}
				flushTransports(players.map((p) => p.transport));
			}

			// Player 3 leaves
			players[3]!.session.leaveRoom();
			// Must flush ALL transports including the leaving player to deliver PlayerLeft
			flushTransports(players.map((p) => p.transport));
			const remainingPlayers = players.filter((_, i) => i !== 3);

			// Run more ticks
			for (let tick = 0; tick < 10; tick++) {
				for (const player of remainingPlayers) {
					player.session.tick(new Uint8Array([129, 128]));
				}
				flushTransports(remainingPlayers.map((p) => p.transport));
			}

			// Remaining players should have 5 players and be in sync
			for (const player of remainingPlayers) {
				assert.strictEqual(
					player.game.players.size,
					5,
					`Remaining players should see 5 players`,
				);
			}

			const referenceHash = remainingPlayers[0]!.game.hash();
			for (let i = 1; i < remainingPlayers.length; i++) {
				assert.strictEqual(
					remainingPlayers[i]!.game.hash(),
					referenceHash,
					`Player ${i} should be in sync after player leave`,
				);
			}
		} finally {
			cleanupPlayers(players);
		}
	});

	it("should maintain sync with varying input patterns across 6 players", async () => {
		const players = await createMultiPlayerSession(6, Topology.Star);

		try {
			// Run with varied input patterns
			for (let tick = 0; tick < 50; tick++) {
				for (let i = 0; i < players.length; i++) {
					// Create varied inputs: some players move, some don't
					const isMoving = (tick + i) % 3 !== 0;
					const dx = isMoving ? 128 + ((tick + i) % 3) - 1 : 128;
					const dy = isMoving ? 128 + ((tick - i) % 3) - 1 : 128;
					players[i]!.session.tick(new Uint8Array([dx, dy]));
				}
				flushTransports(players.map((p) => p.transport));
			}

			// Convergence phase: run neutral ticks to allow final inputs to be
			// processed by the rollback system. This is necessary because the
			// tick-then-flush pattern means the last tick's inputs aren't
			// processed until a subsequent tick triggers rollback detection.
			for (let tick = 0; tick < 10; tick++) {
				for (const player of players) {
					player.session.tick(new Uint8Array([128, 128]));
				}
				flushTransports(players.map((p) => p.transport));
			}

			// All players should still be in sync
			const referenceHash = players[0]!.game.hash();
			for (let i = 1; i < players.length; i++) {
				assert.strictEqual(
					players[i]!.game.hash(),
					referenceHash,
					`Player ${i} should be in sync after varied inputs`,
				);
			}
		} finally {
			cleanupPlayers(players);
		}
	});
});
