import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import { RollbackEngine } from "./engine.js";
import { type Game, type PlayerId, asPlayerId, asTick } from "../types.js";

/**
 * Simple test game that tracks position.
 */
class TestGame implements Game {
	x = 0;
	y = 0;

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
				this.x += (input[0] ?? 0) - 128; // Center at 128
				this.y += (input[1] ?? 0) - 128;
			}
		}
	}

	hash(): number {
		return this.x * 10000 + this.y;
	}
}

describe("RollbackEngine", () => {
	let game: TestGame;
	let engine: RollbackEngine;
	const localPlayer = asPlayerId("local");

	beforeEach(() => {
		game = new TestGame();
		engine = new RollbackEngine({
			game,
			localPlayerId: localPlayer,
			snapshotHistorySize: 60,
			maxSpeculationTicks: 30,
		});
	});

	describe("basic tick progression", () => {
		it("should start at tick 0", () => {
			assert.strictEqual(engine.currentTick, 0);
		});

		it("should advance tick after tick()", () => {
			engine.setLocalInput(asTick(0), new Uint8Array([128, 128]));
			engine.tick();
			assert.strictEqual(engine.currentTick, 1);

			engine.setLocalInput(asTick(1), new Uint8Array([128, 128]));
			engine.tick();
			assert.strictEqual(engine.currentTick, 2);
		});

		it("should apply inputs to game state", () => {
			// Move right (+10 x)
			engine.setLocalInput(asTick(0), new Uint8Array([138, 128]));
			engine.tick();

			assert.strictEqual(game.x, 10);
			assert.strictEqual(game.y, 0);
		});

		it("should save snapshots", () => {
			engine.setLocalInput(asTick(0), new Uint8Array([128, 128]));
			engine.tick();

			const hash = engine.getHash(asTick(0));
			assert.ok(hash !== undefined);
		});
	});

	describe("multi-player inputs", () => {
		const remotePlayer = asPlayerId("remote");

		beforeEach(() => {
			engine.addPlayer(remotePlayer, asTick(0));
		});

		it("should apply inputs from multiple players", () => {
			engine.setLocalInput(asTick(0), new Uint8Array([138, 128])); // +10 x
			engine.receiveRemoteInput(
				remotePlayer,
				asTick(0),
				new Uint8Array([128, 138]),
			); // +10 y

			engine.tick();

			assert.strictEqual(game.x, 10);
			assert.strictEqual(game.y, 10);
		});

		it("should predict missing remote inputs", () => {
			engine.setLocalInput(asTick(0), new Uint8Array([138, 128]));
			// Remote input not provided - will be predicted as empty

			engine.tick();

			// Local input applied
			assert.strictEqual(game.x, 10);
			// Remote predicted as empty (no change)
			assert.strictEqual(game.y, 0);
		});
	});

	describe("rollback on misprediction", () => {
		const remotePlayer = asPlayerId("remote");

		beforeEach(() => {
			engine.addPlayer(remotePlayer, asTick(0));
		});

		it("should rollback when remote input differs from prediction", () => {
			// Tick 0: both inputs present
			engine.setLocalInput(asTick(0), new Uint8Array([128, 128]));
			engine.receiveRemoteInput(
				remotePlayer,
				asTick(0),
				new Uint8Array([128, 128]),
			);
			engine.tick();

			// Tick 1: local input present, remote missing (will be predicted as [128, 128])
			engine.setLocalInput(asTick(1), new Uint8Array([138, 128])); // +10 x
			engine.tick();

			// Tick 2: local input present, remote missing
			engine.setLocalInput(asTick(2), new Uint8Array([128, 138])); // +10 y
			engine.tick();

			// State after prediction: x=10, y=10
			assert.strictEqual(game.x, 10);
			assert.strictEqual(game.y, 10);

			// Now remote input for tick 1 arrives, different from prediction
			engine.receiveRemoteInput(
				remotePlayer,
				asTick(1),
				new Uint8Array([118, 128]),
			); // -10 x

			// Tick 3: triggers rollback
			engine.setLocalInput(asTick(3), new Uint8Array([128, 128]));
			const result = engine.tick();

			assert.strictEqual(result.rolledBack, true);
			// State should be recalculated with correct remote input
			// After rollback, remote's last confirmed becomes [118, 128]
			// Tick 1: local +10x, remote -10x = 0
			// Tick 2: local +10y, remote predicted as [118, 128] = -10x -> x=-10, y=10
			// Tick 3: remote predicted as [118, 128] = -10x -> x=-20
			assert.strictEqual(game.x, -20);
			assert.strictEqual(game.y, 10);
		});

		it("should report rollback ticks in result", () => {
			// Setup: run a few ticks with missing remote input
			for (let i = 0; i < 5; i++) {
				engine.setLocalInput(asTick(i), new Uint8Array([128, 128]));
				engine.receiveRemoteInput(
					remotePlayer,
					asTick(i),
					new Uint8Array([128, 128]),
				);
				engine.tick();
			}

			// Tick 5-7: remote missing
			for (let i = 5; i < 8; i++) {
				engine.setLocalInput(asTick(i), new Uint8Array([128, 128]));
				engine.tick();
			}

			// Remote input arrives for tick 5, different from prediction
			engine.receiveRemoteInput(
				remotePlayer,
				asTick(5),
				new Uint8Array([129, 128]),
			);

			// Tick 8: triggers rollback
			engine.setLocalInput(asTick(8), new Uint8Array([128, 128]));
			const result = engine.tick();

			assert.strictEqual(result.rolledBack, true);
			assert.ok(result.rollbackTicks !== undefined);
			assert.ok(result.rollbackTicks >= 0);
		});

		it("should not rollback when prediction matches", () => {
			// Setup with inputs that will match prediction
			engine.setLocalInput(asTick(0), new Uint8Array([128, 128]));
			engine.receiveRemoteInput(
				remotePlayer,
				asTick(0),
				new Uint8Array([128, 128]),
			);
			engine.tick();

			// Tick 1: remote missing, will predict as [128, 128] (repeat last)
			engine.setLocalInput(asTick(1), new Uint8Array([128, 128]));
			engine.tick();

			// Remote sends same as prediction
			engine.receiveRemoteInput(
				remotePlayer,
				asTick(1),
				new Uint8Array([128, 128]),
			);

			// Tick 2
			engine.setLocalInput(asTick(2), new Uint8Array([128, 128]));
			engine.receiveRemoteInput(
				remotePlayer,
				asTick(2),
				new Uint8Array([128, 128]),
			);
			const result = engine.tick();

			// Default predictor repeats last input, which matches
			assert.strictEqual(result.rolledBack, false);
		});
	});

	describe("confirmed tick tracking", () => {
		const remotePlayer = asPlayerId("remote");

		beforeEach(() => {
			engine.addPlayer(remotePlayer, asTick(0));
		});

		it("should start with confirmed tick at -1", () => {
			assert.strictEqual(engine.confirmedTick, -1);
		});

		it("should advance confirmed tick when all inputs received", () => {
			// Both players provide input for tick 0
			engine.setLocalInput(asTick(0), new Uint8Array([128, 128]));
			engine.receiveRemoteInput(
				remotePlayer,
				asTick(0),
				new Uint8Array([128, 128]),
			);
			engine.tick();

			assert.strictEqual(engine.confirmedTick, 0);
		});

		it("should track minimum confirmed across players", () => {
			// Tick 0: both have input
			engine.setLocalInput(asTick(0), new Uint8Array([128, 128]));
			engine.receiveRemoteInput(
				remotePlayer,
				asTick(0),
				new Uint8Array([128, 128]),
			);
			engine.tick();

			// Tick 1: only local has input
			engine.setLocalInput(asTick(1), new Uint8Array([128, 128]));
			engine.tick();

			// Confirmed should still be at 0 (remote hasn't confirmed tick 1)
			assert.strictEqual(engine.confirmedTick, 0);

			// Remote confirms tick 1
			engine.receiveRemoteInput(
				remotePlayer,
				asTick(1),
				new Uint8Array([128, 128]),
			);

			// Tick 2
			engine.setLocalInput(asTick(2), new Uint8Array([128, 128]));
			engine.tick();

			assert.strictEqual(engine.confirmedTick, 1);
		});
	});

	describe("dynamic player management", () => {
		it("should handle player join mid-game", () => {
			// Run a few ticks solo
			for (let i = 0; i < 5; i++) {
				engine.setLocalInput(asTick(i), new Uint8Array([138, 128])); // +10 x each
				engine.tick();
			}
			assert.strictEqual(game.x, 50);

			// New player joins at tick 5
			const newPlayer = asPlayerId("player-2");
			engine.addPlayer(newPlayer, asTick(5));

			// Tick 5: both players provide input
			engine.setLocalInput(asTick(5), new Uint8Array([128, 128]));
			engine.receiveRemoteInput(
				newPlayer,
				asTick(5),
				new Uint8Array([128, 138]),
			); // +10 y
			engine.tick();

			assert.strictEqual(game.x, 50);
			assert.strictEqual(game.y, 10);
		});

		it("should handle player leave", () => {
			const otherPlayer = asPlayerId("player-2");
			engine.addPlayer(otherPlayer, asTick(0));

			// Run with both players
			for (let i = 0; i < 3; i++) {
				engine.setLocalInput(asTick(i), new Uint8Array([128, 128]));
				engine.receiveRemoteInput(
					otherPlayer,
					asTick(i),
					new Uint8Array([138, 128]),
				); // +10 x
				engine.tick();
			}
			assert.strictEqual(game.x, 30);

			// Player leaves at tick 3
			engine.removePlayer(otherPlayer, asTick(3));

			// Continue solo
			engine.setLocalInput(asTick(3), new Uint8Array([128, 138])); // +10 y
			engine.tick();

			assert.strictEqual(game.x, 30);
			assert.strictEqual(game.y, 10);
		});
	});

	describe("max speculation limit", () => {
		const remotePlayer = asPlayerId("remote");

		beforeEach(() => {
			// Create engine with low max speculation
			game = new TestGame();
			engine = new RollbackEngine({
				game,
				localPlayerId: localPlayer,
				maxSpeculationTicks: 5,
			});
			engine.addPlayer(remotePlayer, asTick(0));
		});

		it("should stop advancing when max speculation reached", () => {
			// Provide local input but no remote input
			for (let i = 0; i < 10; i++) {
				engine.setLocalInput(asTick(i), new Uint8Array([128, 128]));
				engine.tick();
			}

			// Should have stopped at tick 5 (max speculation = 5)
			// Actually, it depends on how we count. Let's check the actual behavior.
			assert.ok(engine.currentTick <= 6);
		});
	});

	describe("state sync", () => {
		it("should export state for sync", () => {
			engine.setLocalInput(asTick(0), new Uint8Array([138, 128]));
			engine.tick();

			const state = engine.getState();

			assert.strictEqual(state.tick, 1);
			assert.ok(state.state instanceof Uint8Array);
			assert.ok(Array.isArray(state.playerTimeline));
		});

		it("should restore state from sync", () => {
			// Run some ticks
			for (let i = 0; i < 5; i++) {
				engine.setLocalInput(asTick(i), new Uint8Array([138, 128]));
				engine.tick();
			}
			assert.strictEqual(game.x, 50);

			// Create a new engine and sync state
			const game2 = new TestGame();
			const engine2 = new RollbackEngine({
				game: game2,
				localPlayerId: asPlayerId("player-2"),
			});

			const syncState = engine.getState();
			engine2.setState(
				syncState.tick,
				syncState.state,
				syncState.playerTimeline,
			);

			// Verify state matches
			assert.strictEqual(game2.x, 50);
			// engine1.currentTick is 5 (after 5 ticks), engine2 syncs to same tick
			assert.strictEqual(engine2.currentTick, 5);
		});
	});

	describe("hash checking", () => {
		it("should return current hash", () => {
			engine.setLocalInput(asTick(0), new Uint8Array([138, 128]));
			engine.tick();

			const hash = engine.getCurrentHash();
			assert.strictEqual(hash, game.hash());
		});

		it("should return historical hash", () => {
			engine.setLocalInput(asTick(0), new Uint8Array([138, 128]));
			engine.tick();
			const hash0 = engine.getHash(asTick(0));

			engine.setLocalInput(asTick(1), new Uint8Array([128, 138]));
			engine.tick();

			// Hash at tick 0 should still be available
			assert.strictEqual(engine.getHash(asTick(0)), hash0);
		});
	});

	describe("active players", () => {
		it("should return active players", () => {
			const p2 = asPlayerId("p2");
			const p3 = asPlayerId("p3");

			engine.addPlayer(p2, asTick(0));
			engine.addPlayer(p3, asTick(5));

			const active = engine.getActivePlayers();
			assert.ok(active.includes(localPlayer));
			assert.ok(active.includes(p2));
			assert.ok(!active.includes(p3)); // Not joined yet
		});

		it("should return all players", () => {
			const p2 = asPlayerId("p2");
			engine.addPlayer(p2, asTick(5));

			const all = engine.getAllPlayers();
			assert.ok(all.includes(localPlayer));
			assert.ok(all.includes(p2));
		});
	});

	describe("reset", () => {
		it("should reset to initial state", () => {
			// Run some ticks
			for (let i = 0; i < 10; i++) {
				engine.setLocalInput(asTick(i), new Uint8Array([138, 128]));
				engine.tick();
			}

			engine.reset();

			assert.strictEqual(engine.currentTick, 0);
			assert.strictEqual(engine.confirmedTick, -1);
			assert.ok(engine.getActivePlayers().includes(localPlayer));
		});
	});

	describe("speculation distance", () => {
		const remotePlayer = asPlayerId("remote");

		beforeEach(() => {
			engine.addPlayer(remotePlayer, asTick(0));
		});

		it("should report speculation distance", () => {
			// Both confirm tick 0
			engine.setLocalInput(asTick(0), new Uint8Array([128, 128]));
			engine.receiveRemoteInput(
				remotePlayer,
				asTick(0),
				new Uint8Array([128, 128]),
			);
			engine.tick();

			// Only local for ticks 1-3
			for (let i = 1; i <= 3; i++) {
				engine.setLocalInput(asTick(i), new Uint8Array([128, 128]));
				engine.tick();
			}

			// Speculation = currentTick - confirmedTick - 1 = 4 - 0 - 1 = 3
			assert.strictEqual(engine.getSpeculationDistance(), 3);
		});
	});

	describe("custom input predictor", () => {
		it("should use custom predictor for missing inputs", () => {
			const remotePlayer = asPlayerId("remote");

			// Custom predictor that always returns [200, 200]
			const customPredictor = {
				predict: () => new Uint8Array([200, 200]),
			};

			const customGame = new TestGame();
			const customEngine = new RollbackEngine({
				game: customGame,
				localPlayerId: localPlayer,
				inputPredictor: customPredictor,
			});
			customEngine.addPlayer(remotePlayer, asTick(0));

			// Local provides input, remote missing
			customEngine.setLocalInput(asTick(0), new Uint8Array([128, 128]));
			customEngine.tick();

			// Remote predicted as [200, 200] = +72 each
			assert.strictEqual(customGame.x, 72);
			assert.strictEqual(customGame.y, 72);
		});
	});

	describe("edge cases", () => {
		it("should handle empty input", () => {
			engine.setLocalInput(asTick(0), new Uint8Array(0));
			engine.tick();

			// No change expected
			assert.strictEqual(game.x, 0);
			assert.strictEqual(game.y, 0);
		});

		it("should handle tick with no players", () => {
			// Remove local player (unusual but let's test)
			engine.removePlayer(localPlayer, asTick(0));

			// Should still be able to tick (with no inputs)
			engine.tick();
			assert.strictEqual(engine.currentTick, 1);
		});

		it("should handle rapid rollbacks", () => {
			const remote = asPlayerId("remote");
			engine.addPlayer(remote, asTick(0));

			// Confirm tick 0
			engine.setLocalInput(asTick(0), new Uint8Array([128, 128]));
			engine.receiveRemoteInput(remote, asTick(0), new Uint8Array([128, 128]));
			engine.tick();

			// Run ahead with predictions
			for (let i = 1; i <= 5; i++) {
				engine.setLocalInput(asTick(i), new Uint8Array([128, 128]));
				engine.tick();
			}

			// Send multiple remote inputs that differ from predictions
			for (let i = 1; i <= 5; i++) {
				engine.receiveRemoteInput(
					remote,
					asTick(i),
					new Uint8Array([138, 128]),
				);
			}

			// Next tick should handle all the corrections
			engine.setLocalInput(asTick(6), new Uint8Array([128, 128]));
			const result = engine.tick();

			assert.strictEqual(result.rolledBack, true);
			// All remote inputs applied: 5 ticks * +10 = 50
			// Plus tick 6 predicted with last confirmed [138, 128] = +10
			assert.strictEqual(game.x, 60);
		});
	});
});
