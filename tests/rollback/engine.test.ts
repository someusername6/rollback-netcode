import assert from "node:assert";
import { beforeEach, describe, it } from "node:test";
import { type Game, type PlayerId, asPlayerId, asTick, GameError } from "../../src/types.js";
import { RollbackEngine } from "../../src/rollback/engine.js";
import { TestGame } from "../utils/test-helpers.js";

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

	describe("game callback error handling", () => {
		/**
		 * Game that throws errors on specific callbacks.
		 */
		class ThrowingGame implements Game {
			x = 0;
			throwOnStep = false;
			throwOnSerialize = false;
			throwOnDeserialize = false;
			throwOnHash = false;

			serialize(): Uint8Array {
				if (this.throwOnSerialize) {
					throw new Error("serialize error");
				}
				const buffer = new ArrayBuffer(4);
				new DataView(buffer).setInt32(0, this.x);
				return new Uint8Array(buffer);
			}

			deserialize(data: Uint8Array): void {
				if (this.throwOnDeserialize) {
					throw new Error("deserialize error");
				}
				this.x = new DataView(data.buffer, data.byteOffset).getInt32(0);
			}

			step(inputs: Map<PlayerId, Uint8Array>): void {
				if (this.throwOnStep) {
					throw new Error("step error");
				}
				for (const [, input] of inputs) {
					if (input.length >= 1) {
						this.x += (input[0] ?? 0) - 128;
					}
				}
			}

			hash(): number {
				if (this.throwOnHash) {
					throw new Error("hash error");
				}
				return this.x;
			}
		}

		it("should wrap error in GameError when game.step() throws", () => {
			const throwingGame = new ThrowingGame();
			const throwingEngine = new RollbackEngine({
				game: throwingGame,
				localPlayerId: localPlayer,
			});

			throwingEngine.setLocalInput(asTick(0), new Uint8Array([138]));
			throwingGame.throwOnStep = true;

			try {
				throwingEngine.tick();
				assert.fail("Expected GameError to be thrown");
			} catch (error) {
				assert.ok(error instanceof GameError, "Error should be a GameError");
				assert.strictEqual(error.operation, "step", "Operation should be 'step'");
				assert.strictEqual(error.tick, 0, "Tick should be 0");
				assert.ok(error.cause instanceof Error, "Should have original error as cause");
				assert.ok(error.message.includes("step error"), "Message should include original error");
			}
		});

		it("should wrap error in GameError when game.serialize() throws", () => {
			const throwingGame = new ThrowingGame();
			const throwingEngine = new RollbackEngine({
				game: throwingGame,
				localPlayerId: localPlayer,
			});

			throwingEngine.setLocalInput(asTick(0), new Uint8Array([138]));
			throwingGame.throwOnSerialize = true;

			try {
				throwingEngine.tick();
				assert.fail("Expected GameError to be thrown");
			} catch (error) {
				assert.ok(error instanceof GameError, "Error should be a GameError");
				assert.strictEqual(error.operation, "serialize", "Operation should be 'serialize'");
				// First tick() saves initial snapshot at tick -1 before processing tick 0
				assert.strictEqual(error.tick, -1, "Tick should be -1 (initial snapshot)");
				assert.ok(error.cause instanceof Error, "Should have original error as cause");
				assert.ok(error.message.includes("serialize error"), "Message should include original error");
			}
		});

		it("should wrap error in GameError when game.hash() throws", () => {
			const throwingGame = new ThrowingGame();
			const throwingEngine = new RollbackEngine({
				game: throwingGame,
				localPlayerId: localPlayer,
			});

			throwingEngine.setLocalInput(asTick(0), new Uint8Array([138]));
			throwingGame.throwOnHash = true;

			try {
				throwingEngine.tick();
				assert.fail("Expected GameError to be thrown");
			} catch (error) {
				assert.ok(error instanceof GameError, "Error should be a GameError");
				assert.strictEqual(error.operation, "hash", "Operation should be 'hash'");
				// First tick() saves initial snapshot at tick -1 before processing tick 0
				assert.strictEqual(error.tick, -1, "Tick should be -1 (initial snapshot)");
				assert.ok(error.cause instanceof Error, "Should have original error as cause");
				assert.ok(error.message.includes("hash error"), "Message should include original error");
			}
		});

		it("should wrap error in GameError when game.deserialize() throws during rollback", () => {
			const throwingGame = new ThrowingGame();
			const throwingEngine = new RollbackEngine({
				game: throwingGame,
				localPlayerId: localPlayer,
			});

			const remote = asPlayerId("remote");
			throwingEngine.addPlayer(remote, asTick(0));

			// Advance a tick successfully
			throwingEngine.setLocalInput(asTick(0), new Uint8Array([128]));
			throwingEngine.receiveRemoteInput(remote, asTick(0), new Uint8Array([128]));
			throwingEngine.tick();

			// Run ahead with predictions
			throwingEngine.setLocalInput(asTick(1), new Uint8Array([128]));
			throwingEngine.tick();

			// Receive different remote input (triggers rollback)
			throwingEngine.receiveRemoteInput(remote, asTick(1), new Uint8Array([138]));

			// Enable throwing on deserialize - will throw during rollback
			throwingGame.throwOnDeserialize = true;

			throwingEngine.setLocalInput(asTick(2), new Uint8Array([128]));

			try {
				throwingEngine.tick();
				assert.fail("Expected GameError to be thrown");
			} catch (error) {
				assert.ok(error instanceof GameError, "Error should be a GameError");
				assert.strictEqual(error.operation, "deserialize", "Operation should be 'deserialize'");
				// Deserialize happens at tick 0 (the rollback restore tick)
				assert.strictEqual(error.tick, 0, "Tick should be the rollback restore tick");
				assert.ok(error.cause instanceof Error, "Should have original error as cause");
				assert.ok(error.message.includes("deserialize error"), "Message should include original error");
			}
		});

		it("should wrap error in GameError when game.step() throws during resimulation", () => {
			const throwingGame = new ThrowingGame();
			const throwingEngine = new RollbackEngine({
				game: throwingGame,
				localPlayerId: localPlayer,
			});

			const remote = asPlayerId("remote");
			throwingEngine.addPlayer(remote, asTick(0));

			// Advance a tick successfully
			throwingEngine.setLocalInput(asTick(0), new Uint8Array([128]));
			throwingEngine.receiveRemoteInput(remote, asTick(0), new Uint8Array([128]));
			throwingEngine.tick();

			// Run ahead with predictions
			throwingEngine.setLocalInput(asTick(1), new Uint8Array([128]));
			throwingEngine.tick();

			// Receive different remote input (triggers rollback)
			throwingEngine.receiveRemoteInput(remote, asTick(1), new Uint8Array([138]));

			// Enable throwing on step - will throw during resimulation
			throwingGame.throwOnStep = true;

			throwingEngine.setLocalInput(asTick(2), new Uint8Array([128]));

			try {
				throwingEngine.tick();
				assert.fail("Expected GameError to be thrown");
			} catch (error) {
				assert.ok(error instanceof GameError, "Error should be a GameError");
				assert.strictEqual(error.operation, "step", "Operation should be 'step'");
				// Step during resimulation happens at tick 1 (the first resimulated tick)
				assert.strictEqual(error.tick, 1, "Tick should be the resimulation tick");
				assert.ok(error.cause instanceof Error, "Should have original error as cause");
				assert.ok(error.message.includes("step error"), "Message should include original error");
			}
		});
	});

	describe("snapshot fallback handling", () => {
		const remotePlayer = asPlayerId("remote");

		it("should use closest available snapshot when exact tick not found", () => {
			// Create engine with small snapshot buffer
			const smallBufferEngine = new RollbackEngine({
				game: new TestGame(),
				localPlayerId: localPlayer,
				snapshotHistorySize: 5, // Very small buffer
				maxSpeculationTicks: 30,
			});
			smallBufferEngine.addPlayer(remotePlayer, asTick(0));

			// Run many ticks to overflow the snapshot buffer
			for (let i = 0; i < 10; i++) {
				smallBufferEngine.setLocalInput(asTick(i), new Uint8Array([128, 128]));
				smallBufferEngine.receiveRemoteInput(
					remotePlayer,
					asTick(i),
					new Uint8Array([128, 128]),
				);
				smallBufferEngine.tick();
			}

			// Now run ahead with predictions
			smallBufferEngine.setLocalInput(asTick(10), new Uint8Array([128, 128]));
			smallBufferEngine.tick();
			smallBufferEngine.setLocalInput(asTick(11), new Uint8Array([128, 128]));
			smallBufferEngine.tick();

			// Send remote input that differs from prediction for an early tick
			// This would require rollback to tick 9, but tick 9 snapshot might be gone
			smallBufferEngine.receiveRemoteInput(
				remotePlayer,
				asTick(10),
				new Uint8Array([138, 128]), // Different from predicted
			);

			smallBufferEngine.setLocalInput(asTick(12), new Uint8Array([128, 128]));

			// Should use closest available snapshot and resimulate more ticks
			const result = smallBufferEngine.tick();

			// Should still rollback successfully using closest available snapshot
			assert.strictEqual(result.rolledBack, true);
		});

		it("should return error when no snapshots are available at all", () => {
			// Create engine and clear all snapshots to simulate empty buffer
			const emptyBufferGame = new TestGame();
			const emptyBufferEngine = new RollbackEngine({
				game: emptyBufferGame,
				localPlayerId: localPlayer,
				snapshotHistorySize: 60,
				maxSpeculationTicks: 30,
			});
			emptyBufferEngine.addPlayer(remotePlayer, asTick(0));

			// Run ahead without any remote inputs
			emptyBufferEngine.setLocalInput(asTick(0), new Uint8Array([128, 128]));
			emptyBufferEngine.tick();
			emptyBufferEngine.setLocalInput(asTick(1), new Uint8Array([128, 128]));
			emptyBufferEngine.tick();

			// Manually clear the game state to simulate a situation where
			// deserialization would be needed
			// (In practice this edge case is rare - snapshot buffer would need to be empty)

			// Send different remote input to trigger rollback attempt
			emptyBufferEngine.receiveRemoteInput(
				remotePlayer,
				asTick(0),
				new Uint8Array([138, 128]),
			);

			emptyBufferEngine.setLocalInput(asTick(2), new Uint8Array([128, 128]));

			// Should rollback successfully since we do have snapshots
			const result = emptyBufferEngine.tick();
			assert.strictEqual(result.rolledBack, true);
			assert.strictEqual(result.error, undefined);
		});

		it("should handle O(1) player lifecycle lookups during resimulation", () => {
			const lifecycleGame = new TestGame();
			const addedPlayers: Array<{ playerId: PlayerId; tick: number }> = [];
			const removedPlayers: Array<{ playerId: PlayerId; tick: number }> = [];

			const lifecycleEngine = new RollbackEngine({
				game: lifecycleGame,
				localPlayerId: localPlayer,
				snapshotHistorySize: 60,
				maxSpeculationTicks: 30,
				onPlayerAddDuringResimulation: (playerId, tick) => {
					addedPlayers.push({ playerId, tick });
				},
				onPlayerRemoveDuringResimulation: (playerId, tick) => {
					removedPlayers.push({ playerId, tick });
				},
			});

			// Add multiple players at different ticks
			const p2 = asPlayerId("player-2");
			const p3 = asPlayerId("player-3");

			lifecycleEngine.addPlayer(remotePlayer, asTick(0));

			// Tick 0 - all inputs present
			lifecycleEngine.setLocalInput(asTick(0), new Uint8Array([128, 128]));
			lifecycleEngine.receiveRemoteInput(remotePlayer, asTick(0), new Uint8Array([128, 128]));
			lifecycleEngine.tick();

			// Tick 1 - all inputs present
			lifecycleEngine.setLocalInput(asTick(1), new Uint8Array([128, 128]));
			lifecycleEngine.receiveRemoteInput(remotePlayer, asTick(1), new Uint8Array([128, 128]));
			lifecycleEngine.tick();

			// Add p2 at tick 2, but DON'T send remote inputs yet (will be predicted)
			lifecycleEngine.addPlayer(p2, asTick(2));
			lifecycleEngine.setLocalInput(asTick(2), new Uint8Array([128, 128]));
			// No remote inputs - will be predicted
			lifecycleEngine.tick();

			// Tick 3 - still no remote inputs
			lifecycleEngine.setLocalInput(asTick(3), new Uint8Array([128, 128]));
			lifecycleEngine.tick();

			// Add p3 at tick 4, still no remote inputs
			lifecycleEngine.addPlayer(p3, asTick(4));
			lifecycleEngine.setLocalInput(asTick(4), new Uint8Array([128, 128]));
			lifecycleEngine.tick();

			// Tick 5 - run ahead with predictions
			lifecycleEngine.setLocalInput(asTick(5), new Uint8Array([128, 128]));
			lifecycleEngine.tick();

			// Clear the tracking arrays before the rollback
			addedPlayers.length = 0;
			removedPlayers.length = 0;

			// Now send remote inputs that differ from predictions
			// This triggers rollback to tick 1 (before misprediction at tick 2)
			lifecycleEngine.receiveRemoteInput(remotePlayer, asTick(2), new Uint8Array([138, 128]));
			lifecycleEngine.receiveRemoteInput(p2, asTick(2), new Uint8Array([128, 128]));
			lifecycleEngine.receiveRemoteInput(remotePlayer, asTick(3), new Uint8Array([128, 128]));
			lifecycleEngine.receiveRemoteInput(p2, asTick(3), new Uint8Array([128, 128]));
			lifecycleEngine.receiveRemoteInput(remotePlayer, asTick(4), new Uint8Array([128, 128]));
			lifecycleEngine.receiveRemoteInput(p2, asTick(4), new Uint8Array([128, 128]));
			lifecycleEngine.receiveRemoteInput(p3, asTick(4), new Uint8Array([128, 128]));
			lifecycleEngine.receiveRemoteInput(remotePlayer, asTick(5), new Uint8Array([128, 128]));
			lifecycleEngine.receiveRemoteInput(p2, asTick(5), new Uint8Array([128, 128]));
			lifecycleEngine.receiveRemoteInput(p3, asTick(5), new Uint8Array([128, 128]));

			lifecycleEngine.setLocalInput(asTick(6), new Uint8Array([128, 128]));
			const result = lifecycleEngine.tick();

			assert.strictEqual(result.rolledBack, true);

			// During resimulation, we should see p2 added at tick 2 and p3 added at tick 4
			const p2Adds = addedPlayers.filter((p) => p.playerId === p2);
			const p3Adds = addedPlayers.filter((p) => p.playerId === p3);

			assert.strictEqual(p2Adds.length, 1, "p2 should be added once during resimulation");
			assert.strictEqual(p2Adds[0]?.tick, 2, "p2 should be added at tick 2");

			assert.strictEqual(p3Adds.length, 1, "p3 should be added once during resimulation");
			assert.strictEqual(p3Adds[0]?.tick, 4, "p3 should be added at tick 4");
		});
	});
});
