import assert from "node:assert";
import { describe, it } from "node:test";
import { asPlayerId, asTick } from "../../src/types.js";
import { InputBuffer } from "../../src/rollback/input-buffer.js";

describe("InputBuffer", () => {
	describe("addPlayer and removePlayer", () => {
		it("should add a player", () => {
			const buffer = new InputBuffer();
			const p1 = asPlayerId("player-1");

			buffer.addPlayer(p1, asTick(0));

			assert.strictEqual(buffer.isPlayerActive(p1, asTick(0)), true);
			assert.strictEqual(buffer.getJoinTick(p1), 0);
		});

		it("should remove a player", () => {
			const buffer = new InputBuffer();
			const p1 = asPlayerId("player-1");

			buffer.addPlayer(p1, asTick(0));
			buffer.removePlayer(p1, asTick(10));

			assert.strictEqual(buffer.isPlayerActive(p1, asTick(5)), true);
			assert.strictEqual(buffer.isPlayerActive(p1, asTick(10)), false);
			assert.strictEqual(buffer.getLeaveTick(p1), 10);
		});

		it("should handle player rejoin", () => {
			const buffer = new InputBuffer();
			const p1 = asPlayerId("player-1");

			buffer.addPlayer(p1, asTick(0));
			buffer.removePlayer(p1, asTick(10));
			buffer.addPlayer(p1, asTick(20));

			assert.strictEqual(buffer.isPlayerActive(p1, asTick(5)), false); // Left
			assert.strictEqual(buffer.isPlayerActive(p1, asTick(15)), false); // Between
			assert.strictEqual(buffer.isPlayerActive(p1, asTick(20)), true); // Rejoined
			assert.strictEqual(buffer.getJoinTick(p1), 20);
			assert.strictEqual(buffer.getLeaveTick(p1), null);
		});
	});

	describe("isPlayerActive", () => {
		it("should return false for unknown player", () => {
			const buffer = new InputBuffer();
			assert.strictEqual(
				buffer.isPlayerActive(asPlayerId("unknown"), asTick(0)),
				false,
			);
		});

		it("should return false before join tick", () => {
			const buffer = new InputBuffer();
			const p1 = asPlayerId("player-1");
			buffer.addPlayer(p1, asTick(10));

			assert.strictEqual(buffer.isPlayerActive(p1, asTick(5)), false);
			assert.strictEqual(buffer.isPlayerActive(p1, asTick(9)), false);
			assert.strictEqual(buffer.isPlayerActive(p1, asTick(10)), true);
		});

		it("should return false at and after leave tick", () => {
			const buffer = new InputBuffer();
			const p1 = asPlayerId("player-1");
			buffer.addPlayer(p1, asTick(0));
			buffer.removePlayer(p1, asTick(10));

			assert.strictEqual(buffer.isPlayerActive(p1, asTick(9)), true);
			assert.strictEqual(buffer.isPlayerActive(p1, asTick(10)), false);
			assert.strictEqual(buffer.isPlayerActive(p1, asTick(11)), false);
		});
	});

	describe("getActivePlayers", () => {
		it("should return empty array when no players", () => {
			const buffer = new InputBuffer();
			assert.deepStrictEqual(buffer.getActivePlayers(asTick(0)), []);
		});

		it("should return active players at a given tick", () => {
			const buffer = new InputBuffer();
			const p1 = asPlayerId("p1");
			const p2 = asPlayerId("p2");
			const p3 = asPlayerId("p3");

			buffer.addPlayer(p1, asTick(0));
			buffer.addPlayer(p2, asTick(5));
			buffer.addPlayer(p3, asTick(10));
			buffer.removePlayer(p1, asTick(8));

			const at0 = buffer.getActivePlayers(asTick(0));
			const at5 = buffer.getActivePlayers(asTick(5));
			const at10 = buffer.getActivePlayers(asTick(10));

			assert.deepStrictEqual(at0.sort(), ["p1"]);
			assert.deepStrictEqual(at5.sort(), ["p1", "p2"]);
			assert.deepStrictEqual(at10.sort(), ["p2", "p3"]);
		});
	});

	describe("receiveInput and getInput", () => {
		it("should store and retrieve input", () => {
			const buffer = new InputBuffer();
			const p1 = asPlayerId("player-1");
			buffer.addPlayer(p1, asTick(0));

			buffer.receiveInput(p1, asTick(5), new Uint8Array([1, 2, 3]));

			const input = buffer.getInput(p1, asTick(5));
			assert.ok(input);
			assert.deepStrictEqual(input, new Uint8Array([1, 2, 3]));
		});

		it("should copy input to prevent mutation", () => {
			const buffer = new InputBuffer();
			const p1 = asPlayerId("player-1");
			buffer.addPlayer(p1, asTick(0));

			const original = new Uint8Array([1, 2, 3]);
			buffer.receiveInput(p1, asTick(0), original);
			original[0] = 99;

			const stored = buffer.getInput(p1, asTick(0));
			assert.ok(stored);
			assert.strictEqual(stored[0], 1);
		});

		it("should ignore input for unknown player", () => {
			const buffer = new InputBuffer();
			buffer.receiveInput(
				asPlayerId("unknown"),
				asTick(0),
				new Uint8Array([1]),
			);
			assert.strictEqual(
				buffer.getInput(asPlayerId("unknown"), asTick(0)),
				undefined,
			);
		});

		it("should ignore input before join tick", () => {
			const buffer = new InputBuffer();
			const p1 = asPlayerId("player-1");
			buffer.addPlayer(p1, asTick(10));

			buffer.receiveInput(p1, asTick(5), new Uint8Array([1]));

			assert.strictEqual(buffer.getInput(p1, asTick(5)), undefined);
		});

		it("should ignore input after leave tick", () => {
			const buffer = new InputBuffer();
			const p1 = asPlayerId("player-1");
			buffer.addPlayer(p1, asTick(0));
			buffer.removePlayer(p1, asTick(10));

			buffer.receiveInput(p1, asTick(10), new Uint8Array([1]));

			assert.strictEqual(buffer.getInput(p1, asTick(10)), undefined);
		});
	});

	describe("confirmedTick", () => {
		it("should start at joinTick - 1", () => {
			const buffer = new InputBuffer();
			const p1 = asPlayerId("player-1");
			buffer.addPlayer(p1, asTick(5));

			assert.strictEqual(buffer.getConfirmedTick(p1), 4);
		});

		it("should advance as consecutive inputs are received", () => {
			const buffer = new InputBuffer();
			const p1 = asPlayerId("player-1");
			buffer.addPlayer(p1, asTick(0));

			buffer.receiveInput(p1, asTick(0), new Uint8Array([0]));
			assert.strictEqual(buffer.getConfirmedTick(p1), 0);

			buffer.receiveInput(p1, asTick(1), new Uint8Array([1]));
			assert.strictEqual(buffer.getConfirmedTick(p1), 1);

			buffer.receiveInput(p1, asTick(2), new Uint8Array([2]));
			assert.strictEqual(buffer.getConfirmedTick(p1), 2);
		});

		it("should not advance with gaps", () => {
			const buffer = new InputBuffer();
			const p1 = asPlayerId("player-1");
			buffer.addPlayer(p1, asTick(0));

			buffer.receiveInput(p1, asTick(0), new Uint8Array([0]));
			buffer.receiveInput(p1, asTick(2), new Uint8Array([2])); // Gap at tick 1

			assert.strictEqual(buffer.getConfirmedTick(p1), 0);

			// Fill the gap
			buffer.receiveInput(p1, asTick(1), new Uint8Array([1]));
			assert.strictEqual(buffer.getConfirmedTick(p1), 2);
		});

		it("should handle out-of-order reception", () => {
			const buffer = new InputBuffer();
			const p1 = asPlayerId("player-1");
			buffer.addPlayer(p1, asTick(0));

			// Receive in reverse order
			buffer.receiveInput(p1, asTick(4), new Uint8Array([4]));
			buffer.receiveInput(p1, asTick(3), new Uint8Array([3]));
			buffer.receiveInput(p1, asTick(2), new Uint8Array([2]));
			buffer.receiveInput(p1, asTick(1), new Uint8Array([1]));
			buffer.receiveInput(p1, asTick(0), new Uint8Array([0]));

			assert.strictEqual(buffer.getConfirmedTick(p1), 4);
		});
	});

	describe("setConfirmedTickForSync", () => {
		it("should set confirmed tick for all active players", () => {
			const buffer = new InputBuffer();
			const p1 = asPlayerId("p1");
			const p2 = asPlayerId("p2");

			buffer.addPlayer(p1, asTick(0));
			buffer.addPlayer(p2, asTick(0));

			// Initially confirmed tick is joinTick - 1 = -1
			assert.strictEqual(buffer.getConfirmedTick(p1), -1);
			assert.strictEqual(buffer.getConfirmedTick(p2), -1);

			// Set confirmed tick for sync at tick 10
			// This should set confirmedTick to 9 (tick - 1)
			buffer.setConfirmedTickForSync(asTick(10));

			assert.strictEqual(buffer.getConfirmedTick(p1), 9);
			assert.strictEqual(buffer.getConfirmedTick(p2), 9);
		});

		it("should not update if tick is 0 (underflow guard)", () => {
			const buffer = new InputBuffer();
			const p1 = asPlayerId("p1");

			buffer.addPlayer(p1, asTick(5));
			// Initial confirmed tick is 4 (joinTick - 1)
			assert.strictEqual(buffer.getConfirmedTick(p1), 4);

			// Calling with tick 0 should be a no-op
			buffer.setConfirmedTickForSync(asTick(0));

			// Confirmed tick should remain unchanged
			assert.strictEqual(buffer.getConfirmedTick(p1), 4);
		});

		it("should not update if new confirmed tick is less than current", () => {
			const buffer = new InputBuffer();
			const p1 = asPlayerId("p1");

			buffer.addPlayer(p1, asTick(0));

			// Receive inputs to advance confirmed tick to 10
			for (let i = 0; i <= 10; i++) {
				buffer.receiveInput(p1, asTick(i), new Uint8Array([i]));
			}
			assert.strictEqual(buffer.getConfirmedTick(p1), 10);

			// Setting sync at tick 5 should not lower confirmed tick
			buffer.setConfirmedTickForSync(asTick(5));

			assert.strictEqual(buffer.getConfirmedTick(p1), 10);
		});

		it("should not update players that left before the sync tick", () => {
			const buffer = new InputBuffer();
			const p1 = asPlayerId("p1");
			const p2 = asPlayerId("p2");

			buffer.addPlayer(p1, asTick(0));
			buffer.addPlayer(p2, asTick(0));
			buffer.removePlayer(p2, asTick(5)); // p2 leaves at tick 5

			// Set sync at tick 10 - p2 had already left
			buffer.setConfirmedTickForSync(asTick(10));

			// p1 should be updated
			assert.strictEqual(buffer.getConfirmedTick(p1), 9);
			// p2 should not be updated (was not active at tick 10)
			assert.strictEqual(buffer.getConfirmedTick(p2), -1);
		});
	});

	describe("usedInputs and misprediction", () => {
		it("should record and retrieve used inputs", () => {
			const buffer = new InputBuffer();
			const p1 = asPlayerId("player-1");
			buffer.addPlayer(p1, asTick(0));

			buffer.recordUsedInput(p1, asTick(5), new Uint8Array([1, 2]));

			const used = buffer.getUsedInput(p1, asTick(5));
			assert.ok(used);
			assert.deepStrictEqual(used, new Uint8Array([1, 2]));
		});

		it("should detect misprediction when used differs from received", () => {
			const buffer = new InputBuffer();
			const p1 = asPlayerId("player-1");
			buffer.addPlayer(p1, asTick(0));

			// Simulate: we predicted [0] but actual was [1]
			buffer.recordUsedInput(p1, asTick(0), new Uint8Array([0]));
			buffer.receiveInput(p1, asTick(0), new Uint8Array([1]));

			const mispredictTick = buffer.findMisprediction(p1, asTick(0));
			assert.strictEqual(mispredictTick, 0);
		});

		it("should not detect misprediction when inputs match", () => {
			const buffer = new InputBuffer();
			const p1 = asPlayerId("player-1");
			buffer.addPlayer(p1, asTick(0));

			buffer.recordUsedInput(p1, asTick(0), new Uint8Array([1, 2, 3]));
			buffer.receiveInput(p1, asTick(0), new Uint8Array([1, 2, 3]));

			assert.strictEqual(buffer.findMisprediction(p1, asTick(0)), undefined);
		});

		it("should find first misprediction in range", () => {
			const buffer = new InputBuffer();
			const p1 = asPlayerId("player-1");
			buffer.addPlayer(p1, asTick(0));

			// Ticks 0-2 match, tick 3 mispredicts
			for (let i = 0; i <= 4; i++) {
				buffer.recordUsedInput(p1, asTick(i), new Uint8Array([i]));
				buffer.receiveInput(p1, asTick(i), new Uint8Array([i === 3 ? 99 : i]));
			}

			assert.strictEqual(buffer.findMisprediction(p1, asTick(0)), 3);
		});

		it("should check hasMisprediction in range", () => {
			const buffer = new InputBuffer();
			const p1 = asPlayerId("player-1");
			buffer.addPlayer(p1, asTick(0));

			// Mismatch at tick 5
			for (let i = 0; i <= 10; i++) {
				buffer.recordUsedInput(p1, asTick(i), new Uint8Array([i]));
				buffer.receiveInput(p1, asTick(i), new Uint8Array([i === 5 ? 99 : i]));
			}

			assert.strictEqual(
				buffer.hasMisprediction(p1, asTick(0), asTick(4)),
				false,
			);
			assert.strictEqual(
				buffer.hasMisprediction(p1, asTick(5), asTick(10)),
				true,
			);
			assert.strictEqual(
				buffer.hasMisprediction(p1, asTick(6), asTick(10)),
				false,
			);
		});
	});

	describe("getLastConfirmedInput", () => {
		it("should return undefined when no inputs", () => {
			const buffer = new InputBuffer();
			const p1 = asPlayerId("player-1");
			buffer.addPlayer(p1, asTick(0));

			assert.strictEqual(buffer.getLastConfirmedInput(p1), undefined);
		});

		it("should return input at confirmedTick, not highest received tick", () => {
			const buffer = new InputBuffer();
			const p1 = asPlayerId("player-1");
			buffer.addPlayer(p1, asTick(0));

			// Receive inputs with gaps: 0, 1 (consecutive), then skip to 5
			buffer.receiveInput(p1, asTick(0), new Uint8Array([0]));
			buffer.receiveInput(p1, asTick(1), new Uint8Array([1]));
			buffer.receiveInput(p1, asTick(5), new Uint8Array([5])); // Gap at 2, 3, 4

			// confirmedTick should be 1 (highest consecutive)
			assert.strictEqual(buffer.getConfirmedTick(p1), 1);

			// getLastConfirmedInput should return input at tick 1, NOT tick 5
			const last = buffer.getLastConfirmedInput(p1);
			assert.ok(last);
			assert.deepStrictEqual(
				last,
				new Uint8Array([1]),
				"Should return confirmed input at tick 1, not unconfirmed input at tick 5",
			);
		});

		it("should return last consecutive input when all inputs are confirmed", () => {
			const buffer = new InputBuffer();
			const p1 = asPlayerId("player-1");
			buffer.addPlayer(p1, asTick(0));

			// Receive consecutive inputs
			buffer.receiveInput(p1, asTick(0), new Uint8Array([0]));
			buffer.receiveInput(p1, asTick(1), new Uint8Array([1]));
			buffer.receiveInput(p1, asTick(2), new Uint8Array([2]));

			// confirmedTick should be 2
			assert.strictEqual(buffer.getConfirmedTick(p1), 2);

			const last = buffer.getLastConfirmedInput(p1);
			assert.ok(last);
			assert.deepStrictEqual(last, new Uint8Array([2]));
		});
	});

	describe("pruneBeforeTick", () => {
		it("should remove old inputs", () => {
			const buffer = new InputBuffer();
			const p1 = asPlayerId("player-1");
			buffer.addPlayer(p1, asTick(0));

			for (let i = 0; i < 10; i++) {
				buffer.receiveInput(p1, asTick(i), new Uint8Array([i]));
				buffer.recordUsedInput(p1, asTick(i), new Uint8Array([i]));
			}

			buffer.pruneBeforeTick(asTick(5));

			// Old inputs should be gone
			for (let i = 0; i < 5; i++) {
				assert.strictEqual(buffer.getInput(p1, asTick(i)), undefined);
				assert.strictEqual(buffer.getUsedInput(p1, asTick(i)), undefined);
			}

			// New inputs should remain
			for (let i = 5; i < 10; i++) {
				assert.ok(buffer.getInput(p1, asTick(i)));
				assert.ok(buffer.getUsedInput(p1, asTick(i)));
			}
		});
	});

	describe("clearUsedInputsFrom", () => {
		it("should clear used inputs from a tick onwards", () => {
			const buffer = new InputBuffer();
			const p1 = asPlayerId("player-1");
			buffer.addPlayer(p1, asTick(0));

			for (let i = 0; i < 10; i++) {
				buffer.recordUsedInput(p1, asTick(i), new Uint8Array([i]));
			}

			buffer.clearUsedInputsFrom(p1, asTick(5));

			// Used inputs before tick 5 should remain
			for (let i = 0; i < 5; i++) {
				assert.ok(buffer.getUsedInput(p1, asTick(i)));
			}

			// Used inputs from tick 5 onwards should be cleared
			for (let i = 5; i < 10; i++) {
				assert.strictEqual(buffer.getUsedInput(p1, asTick(i)), undefined);
			}
		});
	});

	describe("getMinConfirmedTick", () => {
		it("should return undefined when no active players", () => {
			const buffer = new InputBuffer();
			assert.strictEqual(buffer.getMinConfirmedTick(asTick(0)), undefined);
		});

		it("should return minimum confirmed tick among active players", () => {
			const buffer = new InputBuffer();
			const p1 = asPlayerId("p1");
			const p2 = asPlayerId("p2");
			const p3 = asPlayerId("p3");

			buffer.addPlayer(p1, asTick(0));
			buffer.addPlayer(p2, asTick(0));
			buffer.addPlayer(p3, asTick(0));

			// p1 confirmed to tick 5
			for (let i = 0; i <= 5; i++) {
				buffer.receiveInput(p1, asTick(i), new Uint8Array([i]));
			}

			// p2 confirmed to tick 3
			for (let i = 0; i <= 3; i++) {
				buffer.receiveInput(p2, asTick(i), new Uint8Array([i]));
			}

			// p3 confirmed to tick 7
			for (let i = 0; i <= 7; i++) {
				buffer.receiveInput(p3, asTick(i), new Uint8Array([i]));
			}

			assert.strictEqual(buffer.getMinConfirmedTick(asTick(0)), 3);
		});

		it("should only consider active players at given tick", () => {
			const buffer = new InputBuffer();
			const p1 = asPlayerId("p1");
			const p2 = asPlayerId("p2");

			buffer.addPlayer(p1, asTick(0));
			buffer.addPlayer(p2, asTick(5));

			for (let i = 0; i <= 10; i++) {
				buffer.receiveInput(p1, asTick(i), new Uint8Array([i]));
			}
			for (let i = 5; i <= 7; i++) {
				buffer.receiveInput(p2, asTick(i), new Uint8Array([i]));
			}

			// At tick 3, only p1 is active
			assert.strictEqual(buffer.getMinConfirmedTick(asTick(3)), 10);

			// At tick 6, both are active
			assert.strictEqual(buffer.getMinConfirmedTick(asTick(6)), 7);
		});
	});

	describe("hasAllInputsForTick", () => {
		it("should return true when no active players", () => {
			const buffer = new InputBuffer();
			assert.strictEqual(buffer.hasAllInputsForTick(asTick(0)), true);
		});

		it("should return true when all active players have input", () => {
			const buffer = new InputBuffer();
			const p1 = asPlayerId("p1");
			const p2 = asPlayerId("p2");

			buffer.addPlayer(p1, asTick(0));
			buffer.addPlayer(p2, asTick(0));

			buffer.receiveInput(p1, asTick(5), new Uint8Array([1]));
			buffer.receiveInput(p2, asTick(5), new Uint8Array([2]));

			assert.strictEqual(buffer.hasAllInputsForTick(asTick(5)), true);
		});

		it("should return false when any active player is missing input", () => {
			const buffer = new InputBuffer();
			const p1 = asPlayerId("p1");
			const p2 = asPlayerId("p2");

			buffer.addPlayer(p1, asTick(0));
			buffer.addPlayer(p2, asTick(0));

			buffer.receiveInput(p1, asTick(5), new Uint8Array([1]));
			// p2 missing input for tick 5

			assert.strictEqual(buffer.hasAllInputsForTick(asTick(5)), false);
		});

		it("should not consider inactive players", () => {
			const buffer = new InputBuffer();
			const p1 = asPlayerId("p1");
			const p2 = asPlayerId("p2");

			buffer.addPlayer(p1, asTick(0));
			buffer.addPlayer(p2, asTick(10)); // Not active at tick 5

			buffer.receiveInput(p1, asTick(5), new Uint8Array([1]));

			assert.strictEqual(buffer.hasAllInputsForTick(asTick(5)), true);
		});
	});

	describe("clear and clearPlayer", () => {
		it("should clear all data for a player", () => {
			const buffer = new InputBuffer();
			const p1 = asPlayerId("p1");
			const p2 = asPlayerId("p2");

			buffer.addPlayer(p1, asTick(0));
			buffer.addPlayer(p2, asTick(0));
			buffer.receiveInput(p1, asTick(0), new Uint8Array([1]));
			buffer.receiveInput(p2, asTick(0), new Uint8Array([2]));

			buffer.clearPlayer(p1);

			assert.strictEqual(buffer.isPlayerActive(p1, asTick(0)), false);
			assert.strictEqual(buffer.isPlayerActive(p2, asTick(0)), true);
		});

		it("should clear all players", () => {
			const buffer = new InputBuffer();
			buffer.addPlayer(asPlayerId("p1"), asTick(0));
			buffer.addPlayer(asPlayerId("p2"), asTick(0));

			buffer.clear();

			assert.deepStrictEqual(buffer.getAllPlayers(), []);
		});
	});

	describe("multiple players", () => {
		it("should handle multiple players independently", () => {
			const buffer = new InputBuffer();
			const p1 = asPlayerId("p1");
			const p2 = asPlayerId("p2");
			const p3 = asPlayerId("p3");

			buffer.addPlayer(p1, asTick(0));
			buffer.addPlayer(p2, asTick(0));
			buffer.addPlayer(p3, asTick(0));

			buffer.receiveInput(p1, asTick(0), new Uint8Array([1]));
			buffer.receiveInput(p2, asTick(0), new Uint8Array([2]));
			buffer.receiveInput(p3, asTick(0), new Uint8Array([3]));

			assert.deepStrictEqual(
				buffer.getInput(p1, asTick(0)),
				new Uint8Array([1]),
			);
			assert.deepStrictEqual(
				buffer.getInput(p2, asTick(0)),
				new Uint8Array([2]),
			);
			assert.deepStrictEqual(
				buffer.getInput(p3, asTick(0)),
				new Uint8Array([3]),
			);
		});

		it("should track mispredictions per player", () => {
			const buffer = new InputBuffer();
			const p1 = asPlayerId("p1");
			const p2 = asPlayerId("p2");

			buffer.addPlayer(p1, asTick(0));
			buffer.addPlayer(p2, asTick(0));

			// Provide consecutive inputs so confirmedTick advances to 2
			for (let i = 0; i <= 2; i++) {
				buffer.receiveInput(p1, asTick(i), new Uint8Array([i === 2 ? 1 : i])); // p1 receives [1] at tick 2
				buffer.receiveInput(p2, asTick(i), new Uint8Array([i === 2 ? 5 : i])); // p2 receives [5] at tick 2
			}

			// p1 used [0] at tick 2 but received [1] - misprediction
			buffer.recordUsedInput(p1, asTick(2), new Uint8Array([0]));

			// p2 used [5] at tick 2 and received [5] - no misprediction
			buffer.recordUsedInput(p2, asTick(2), new Uint8Array([5]));

			assert.strictEqual(buffer.findMisprediction(p1, asTick(0)), 2);
			assert.strictEqual(buffer.findMisprediction(p2, asTick(0)), undefined);
		});
	});
});
