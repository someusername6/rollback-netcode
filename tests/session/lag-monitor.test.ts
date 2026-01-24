import assert from "node:assert";
import { describe, it } from "node:test";
import { asPlayerId, asTick } from "../../src/types.js";
import { LagMonitor } from "../../src/session/lag-monitor.js";

describe("LagMonitor", () => {
	describe("constructor", () => {
		it("should create lag monitor with valid config", () => {
			const monitor = new LagMonitor({ threshold: 30, cooldownTicks: 60 });
			assert.ok(monitor);
		});
	});

	describe("isEnabled", () => {
		it("should return true when threshold > 0", () => {
			const monitor = new LagMonitor({ threshold: 30, cooldownTicks: 60 });
			assert.strictEqual(monitor.isEnabled, true);
		});

		it("should return false when threshold is 0", () => {
			const monitor = new LagMonitor({ threshold: 0, cooldownTicks: 60 });
			assert.strictEqual(monitor.isEnabled, false);
		});

		it("should return false when threshold is negative", () => {
			const monitor = new LagMonitor({ threshold: -1, cooldownTicks: 60 });
			assert.strictEqual(monitor.isEnabled, false);
		});
	});

	describe("checkPlayer", () => {
		it("should return null when disabled (threshold 0)", () => {
			const monitor = new LagMonitor({ threshold: 0, cooldownTicks: 60 });
			const result = monitor.checkPlayer(
				asPlayerId("player1"),
				100,
				asTick(100),
			);
			assert.strictEqual(result, null);
		});

		it("should return null when not lagging enough", () => {
			const monitor = new LagMonitor({ threshold: 30, cooldownTicks: 60 });
			const result = monitor.checkPlayer(
				asPlayerId("player1"),
				29,
				asTick(100),
			);
			assert.strictEqual(result, null);
		});

		it("should return report when at threshold", () => {
			const monitor = new LagMonitor({ threshold: 30, cooldownTicks: 60 });
			const result = monitor.checkPlayer(
				asPlayerId("player1"),
				30,
				asTick(100),
			);
			assert.ok(result);
			assert.strictEqual(result.laggyPlayerId, asPlayerId("player1"));
			assert.strictEqual(result.ticksBehind, 30);
		});

		it("should return report when over threshold", () => {
			const monitor = new LagMonitor({ threshold: 30, cooldownTicks: 60 });
			const result = monitor.checkPlayer(
				asPlayerId("player1"),
				50,
				asTick(100),
			);
			assert.ok(result);
			assert.strictEqual(result.ticksBehind, 50);
		});

		it("should respect cooldown", () => {
			const monitor = new LagMonitor({ threshold: 30, cooldownTicks: 60 });
			const playerId = asPlayerId("player1");

			// First report should work
			const result1 = monitor.checkPlayer(playerId, 50, asTick(100));
			assert.ok(result1);

			// Second report within cooldown should return null
			const result2 = monitor.checkPlayer(playerId, 50, asTick(150));
			assert.strictEqual(result2, null);

			// Report after cooldown should work
			const result3 = monitor.checkPlayer(playerId, 50, asTick(161));
			assert.ok(result3);
		});

		it("should track players independently", () => {
			const monitor = new LagMonitor({ threshold: 30, cooldownTicks: 60 });

			const result1 = monitor.checkPlayer(
				asPlayerId("player1"),
				50,
				asTick(100),
			);
			const result2 = monitor.checkPlayer(
				asPlayerId("player2"),
				50,
				asTick(100),
			);

			assert.ok(result1);
			assert.ok(result2);
			assert.strictEqual(result1.laggyPlayerId, asPlayerId("player1"));
			assert.strictEqual(result2.laggyPlayerId, asPlayerId("player2"));
		});
	});

	describe("reset", () => {
		it("should clear cooldown for a player", () => {
			const monitor = new LagMonitor({ threshold: 30, cooldownTicks: 60 });
			const playerId = asPlayerId("player1");

			// Trigger cooldown
			monitor.checkPlayer(playerId, 50, asTick(100));
			assert.strictEqual(monitor.checkPlayer(playerId, 50, asTick(110)), null);

			// Reset cooldown
			monitor.reset(playerId);

			// Should be able to report again
			const result = monitor.checkPlayer(playerId, 50, asTick(110));
			assert.ok(result);
		});

		it("should not affect other players", () => {
			const monitor = new LagMonitor({ threshold: 30, cooldownTicks: 60 });

			monitor.checkPlayer(asPlayerId("player1"), 50, asTick(100));
			monitor.checkPlayer(asPlayerId("player2"), 50, asTick(100));

			monitor.reset(asPlayerId("player1"));

			// player1 can report again
			assert.ok(monitor.checkPlayer(asPlayerId("player1"), 50, asTick(110)));
			// player2 still on cooldown
			assert.strictEqual(
				monitor.checkPlayer(asPlayerId("player2"), 50, asTick(110)),
				null,
			);
		});
	});

	describe("clear", () => {
		it("should clear all tracking state", () => {
			const monitor = new LagMonitor({ threshold: 30, cooldownTicks: 60 });

			// Trigger cooldowns
			monitor.checkPlayer(asPlayerId("player1"), 50, asTick(100));
			monitor.checkPlayer(asPlayerId("player2"), 50, asTick(100));

			monitor.clear();

			// Both should be able to report again
			assert.ok(monitor.checkPlayer(asPlayerId("player1"), 50, asTick(110)));
			assert.ok(monitor.checkPlayer(asPlayerId("player2"), 50, asTick(110)));
		});
	});
});
