import assert from "node:assert";
import { describe, it } from "node:test";
import {
	PlayerConnectionState,
	type PlayerInfo,
	PlayerRole,
	asPlayerId,
	asTick,
} from "../../src/types.js";
import { PlayerManager } from "../../src/session/player-manager.js";

function createPlayerInfo(
	id: string,
	overrides: Partial<PlayerInfo> = {},
): PlayerInfo {
	return {
		id: asPlayerId(id),
		connectionState: PlayerConnectionState.Connected,
		joinTick: asTick(0),
		leaveTick: null,
		isHost: false,
		role: PlayerRole.Player,
		...overrides,
	};
}

describe("PlayerManager", () => {
	describe("addPlayer", () => {
		it("should add a player", () => {
			const manager = new PlayerManager();
			const player = createPlayerInfo("player1");

			manager.addPlayer(player);

			assert.strictEqual(manager.size, 1);
			assert.strictEqual(manager.getPlayer(asPlayerId("player1")), player);
		});

		it("should overwrite existing player with same id", () => {
			const manager = new PlayerManager();
			const player1 = createPlayerInfo("player1", { isHost: false });
			const player2 = createPlayerInfo("player1", { isHost: true });

			manager.addPlayer(player1);
			manager.addPlayer(player2);

			assert.strictEqual(manager.size, 1);
			assert.strictEqual(
				manager.getPlayer(asPlayerId("player1"))?.isHost,
				true,
			);
		});
	});

	describe("removePlayer", () => {
		it("should remove an existing player", () => {
			const manager = new PlayerManager();
			const player = createPlayerInfo("player1");
			manager.addPlayer(player);

			const removed = manager.removePlayer(asPlayerId("player1"));

			assert.strictEqual(removed, player);
			assert.strictEqual(manager.size, 0);
			assert.strictEqual(manager.getPlayer(asPlayerId("player1")), undefined);
		});

		it("should return undefined for non-existent player", () => {
			const manager = new PlayerManager();
			const removed = manager.removePlayer(asPlayerId("nonexistent"));
			assert.strictEqual(removed, undefined);
		});
	});

	describe("getPlayer", () => {
		it("should return player if exists", () => {
			const manager = new PlayerManager();
			const player = createPlayerInfo("player1");
			manager.addPlayer(player);

			assert.strictEqual(manager.getPlayer(asPlayerId("player1")), player);
		});

		it("should return undefined if not exists", () => {
			const manager = new PlayerManager();
			assert.strictEqual(manager.getPlayer(asPlayerId("player1")), undefined);
		});
	});

	describe("hasPlayer", () => {
		it("should return true if player exists", () => {
			const manager = new PlayerManager();
			manager.addPlayer(createPlayerInfo("player1"));

			assert.strictEqual(manager.hasPlayer(asPlayerId("player1")), true);
		});

		it("should return false if player does not exist", () => {
			const manager = new PlayerManager();
			assert.strictEqual(manager.hasPlayer(asPlayerId("player1")), false);
		});
	});

	describe("markDisconnected", () => {
		it("should mark player as disconnected", () => {
			const manager = new PlayerManager();
			manager.addPlayer(createPlayerInfo("player1"));

			manager.markDisconnected(asPlayerId("player1"));

			const player = manager.getPlayer(asPlayerId("player1"));
			assert.strictEqual(
				player?.connectionState,
				PlayerConnectionState.Disconnected,
			);
		});

		it("should set leaveTick if provided", () => {
			const manager = new PlayerManager();
			manager.addPlayer(createPlayerInfo("player1"));

			manager.markDisconnected(asPlayerId("player1"), asTick(100));

			const player = manager.getPlayer(asPlayerId("player1"));
			assert.strictEqual(player?.leaveTick, asTick(100));
		});

		it("should not set leaveTick if not provided", () => {
			const manager = new PlayerManager();
			manager.addPlayer(createPlayerInfo("player1", { leaveTick: null }));

			manager.markDisconnected(asPlayerId("player1"));

			const player = manager.getPlayer(asPlayerId("player1"));
			assert.strictEqual(player?.leaveTick, null);
		});

		it("should return undefined for non-existent player", () => {
			const manager = new PlayerManager();
			const result = manager.markDisconnected(asPlayerId("nonexistent"));
			assert.strictEqual(result, undefined);
		});
	});

	describe("markConnected", () => {
		it("should mark player as connected", () => {
			const manager = new PlayerManager();
			manager.addPlayer(
				createPlayerInfo("player1", {
					connectionState: PlayerConnectionState.Disconnected,
				}),
			);

			manager.markConnected(asPlayerId("player1"));

			const player = manager.getPlayer(asPlayerId("player1"));
			assert.strictEqual(
				player?.connectionState,
				PlayerConnectionState.Connected,
			);
		});

		it("should return undefined for non-existent player", () => {
			const manager = new PlayerManager();
			const result = manager.markConnected(asPlayerId("nonexistent"));
			assert.strictEqual(result, undefined);
		});
	});

	describe("getActivePlayers", () => {
		it("should return empty array when no players", () => {
			const manager = new PlayerManager();
			assert.deepStrictEqual(manager.getActivePlayers(), []);
		});

		it("should return only connected players with Player role", () => {
			const manager = new PlayerManager();
			manager.addPlayer(createPlayerInfo("player1")); // connected, player
			manager.addPlayer(
				createPlayerInfo("player2", { role: PlayerRole.Spectator }),
			); // connected, spectator
			manager.addPlayer(
				createPlayerInfo("player3", {
					connectionState: PlayerConnectionState.Disconnected,
				}),
			); // disconnected, player

			const active = manager.getActivePlayers();

			assert.strictEqual(active.length, 1);
			assert.ok(active[0]);
			assert.strictEqual(active[0].id, asPlayerId("player1"));
		});
	});

	describe("getConnectedPlayers", () => {
		it("should return all connected players regardless of role", () => {
			const manager = new PlayerManager();
			manager.addPlayer(createPlayerInfo("player1"));
			manager.addPlayer(
				createPlayerInfo("spectator1", { role: PlayerRole.Spectator }),
			);
			manager.addPlayer(
				createPlayerInfo("disconnected", {
					connectionState: PlayerConnectionState.Disconnected,
				}),
			);

			const connected = manager.getConnectedPlayers();

			assert.strictEqual(connected.length, 2);
			const ids = connected.map((p) => p.id);
			assert.ok(ids.includes(asPlayerId("player1")));
			assert.ok(ids.includes(asPlayerId("spectator1")));
		});
	});

	describe("getActivePlayerCount", () => {
		it("should return count of active players", () => {
			const manager = new PlayerManager();
			manager.addPlayer(createPlayerInfo("player1"));
			manager.addPlayer(createPlayerInfo("player2"));
			manager.addPlayer(
				createPlayerInfo("spectator", { role: PlayerRole.Spectator }),
			);

			assert.strictEqual(manager.getActivePlayerCount(), 2);
		});

		it("should return 0 for empty manager", () => {
			const manager = new PlayerManager();
			assert.strictEqual(manager.getActivePlayerCount(), 0);
		});
	});

	describe("findHost", () => {
		it("should return host player", () => {
			const manager = new PlayerManager();
			manager.addPlayer(createPlayerInfo("player1"));
			manager.addPlayer(createPlayerInfo("host", { isHost: true }));
			manager.addPlayer(createPlayerInfo("player2"));

			const host = manager.findHost();

			assert.ok(host);
			assert.strictEqual(host.id, asPlayerId("host"));
		});

		it("should return undefined if no host", () => {
			const manager = new PlayerManager();
			manager.addPlayer(createPlayerInfo("player1"));
			manager.addPlayer(createPlayerInfo("player2"));

			assert.strictEqual(manager.findHost(), undefined);
		});

		it("should return undefined for empty manager", () => {
			const manager = new PlayerManager();
			assert.strictEqual(manager.findHost(), undefined);
		});
	});

	describe("getPlayerIds", () => {
		it("should return all player ids", () => {
			const manager = new PlayerManager();
			manager.addPlayer(createPlayerInfo("player1"));
			manager.addPlayer(createPlayerInfo("player2"));

			const ids = manager.getPlayerIds();

			assert.strictEqual(ids.length, 2);
			assert.ok(ids.includes(asPlayerId("player1")));
			assert.ok(ids.includes(asPlayerId("player2")));
		});

		it("should return empty array for empty manager", () => {
			const manager = new PlayerManager();
			assert.deepStrictEqual(manager.getPlayerIds(), []);
		});
	});

	describe("getAllPlayers", () => {
		it("should return all players", () => {
			const manager = new PlayerManager();
			const player1 = createPlayerInfo("player1");
			const player2 = createPlayerInfo("player2");
			manager.addPlayer(player1);
			manager.addPlayer(player2);

			const all = manager.getAllPlayers();

			assert.strictEqual(all.length, 2);
		});
	});

	describe("clear", () => {
		it("should remove all players", () => {
			const manager = new PlayerManager();
			manager.addPlayer(createPlayerInfo("player1"));
			manager.addPlayer(createPlayerInfo("player2"));

			manager.clear();

			assert.strictEqual(manager.size, 0);
			assert.strictEqual(manager.getPlayer(asPlayerId("player1")), undefined);
		});
	});

	describe("size", () => {
		it("should return number of players", () => {
			const manager = new PlayerManager();
			assert.strictEqual(manager.size, 0);

			manager.addPlayer(createPlayerInfo("player1"));
			assert.strictEqual(manager.size, 1);

			manager.addPlayer(createPlayerInfo("player2"));
			assert.strictEqual(manager.size, 2);
		});
	});

	describe("iteration", () => {
		it("should be iterable", () => {
			const manager = new PlayerManager();
			manager.addPlayer(createPlayerInfo("player1"));
			manager.addPlayer(createPlayerInfo("player2"));

			const players = [...manager];

			assert.strictEqual(players.length, 2);
		});

		it("should work with for-of", () => {
			const manager = new PlayerManager();
			manager.addPlayer(createPlayerInfo("player1"));
			manager.addPlayer(createPlayerInfo("player2"));

			const ids: string[] = [];
			for (const player of manager) {
				ids.push(player.id);
			}

			assert.strictEqual(ids.length, 2);
		});
	});

	describe("asReadonlyMap", () => {
		it("should return a readonly map view", () => {
			const manager = new PlayerManager();
			const player = createPlayerInfo("player1");
			manager.addPlayer(player);

			const map = manager.asReadonlyMap();

			assert.strictEqual(map.size, 1);
			assert.strictEqual(map.get(asPlayerId("player1")), player);
		});
	});
});
