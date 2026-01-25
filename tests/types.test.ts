import assert from "node:assert";
import { describe, it } from "node:test";
import {
	DesyncAuthority,
	TICK_MIN,
	Topology,
	ValidationError,
	asPlayerId,
	asTick,
	validatePlayerId,
	validateSessionConfig,
	validateTick,
} from "../src/types.js";

describe("types", () => {
	describe("asTick", () => {
		it("should convert number to Tick", () => {
			const tick = asTick(42);
			assert.strictEqual(tick, 42);
		});

		it("should work with zero", () => {
			const tick = asTick(0);
			assert.strictEqual(tick, 0);
		});

		it("should work with negative numbers", () => {
			const tick = asTick(-1);
			assert.strictEqual(tick, -1);
		});
	});

	describe("asPlayerId", () => {
		it("should convert string to PlayerId", () => {
			const id = asPlayerId("player-1");
			assert.strictEqual(id, "player-1");
		});

		it("should work with empty string", () => {
			const id = asPlayerId("");
			assert.strictEqual(id, "");
		});

		it("should work with special characters", () => {
			const id = asPlayerId("player:123@test.com");
			assert.strictEqual(id, "player:123@test.com");
		});
	});

	describe("TICK_MIN", () => {
		it("should be -1", () => {
			assert.strictEqual(TICK_MIN, -1);
		});
	});

	describe("validateTick", () => {
		it("should accept valid tick values", () => {
			assert.doesNotThrow(() => validateTick(0));
			assert.doesNotThrow(() => validateTick(1));
			assert.doesNotThrow(() => validateTick(100));
			assert.doesNotThrow(() => validateTick(1000000));
		});

		it("should accept TICK_MIN (-1)", () => {
			assert.doesNotThrow(() => validateTick(-1));
			assert.doesNotThrow(() => validateTick(TICK_MIN));
		});

		it("should throw for negative ticks below TICK_MIN", () => {
			assert.throws(
				() => validateTick(-2),
				/Invalid tick: -2/,
			);
			assert.throws(
				() => validateTick(-100),
				/Invalid tick/,
			);
		});

		it("should throw for non-integer values", () => {
			assert.throws(
				() => validateTick(1.5),
				/Invalid tick: 1.5/,
			);
			assert.throws(
				() => validateTick(0.1),
				/Invalid tick/,
			);
		});

		it("should throw for NaN", () => {
			assert.throws(
				() => validateTick(NaN),
				/Invalid tick/,
			);
		});

		it("should throw for Infinity", () => {
			assert.throws(
				() => validateTick(Infinity),
				/Invalid tick/,
			);
			assert.throws(
				() => validateTick(-Infinity),
				/Invalid tick/,
			);
		});
	});

	describe("validatePlayerId", () => {
		it("should accept valid player IDs", () => {
			assert.doesNotThrow(() => validatePlayerId("player-1"));
			assert.doesNotThrow(() => validatePlayerId("a"));
			assert.doesNotThrow(() => validatePlayerId("player:123@test.com"));
		});

		it("should throw for empty string", () => {
			assert.throws(
				() => validatePlayerId(""),
				/Invalid player ID: ""/,
			);
		});

		it("should throw with descriptive message", () => {
			try {
				validatePlayerId("");
			} catch (e) {
				assert.ok(e instanceof Error);
				assert.ok(e.message.includes("must be a non-empty string"));
			}
		});
	});

	describe("ValidationError", () => {
		it("should create error with message and field", () => {
			const error = new ValidationError("Invalid value", "testField", 123);
			assert.strictEqual(error.name, "ValidationError");
			assert.strictEqual(error.field, "testField");
			assert.strictEqual(error.value, 123);
			assert.ok(error.message.includes("Invalid value"));
		});

		it("should be instance of Error", () => {
			const error = new ValidationError("test", "field", 0);
			assert.ok(error instanceof Error);
			assert.ok(error instanceof ValidationError);
		});
	});

	describe("validateSessionConfig", () => {
		const validConfig = {
			tickRate: 60,
			maxPlayers: 4,
			topology: Topology.Star,
			snapshotHistorySize: 120,
			maxSpeculationTicks: 60,
			hashInterval: 60,
			disconnectTimeout: 5000,
			debug: false,
			desyncAuthority: DesyncAuthority.Peer,
			lagReportThreshold: 30,
			inputRedundancy: 3,
			joinRateLimitRequests: 3,
			joinRateLimitWindowMs: 10000,
		};

		it("should accept valid config", () => {
			assert.doesNotThrow(() => validateSessionConfig(validConfig));
		});

		it("should throw on zero tickRate", () => {
			assert.throws(
				() => validateSessionConfig({ ...validConfig, tickRate: 0 }),
				ValidationError,
			);
		});

		it("should throw on negative tickRate", () => {
			assert.throws(
				() => validateSessionConfig({ ...validConfig, tickRate: -1 }),
				ValidationError,
			);
		});

		it("should throw on zero maxPlayers", () => {
			assert.throws(
				() => validateSessionConfig({ ...validConfig, maxPlayers: 0 }),
				ValidationError,
			);
		});

		it("should throw on maxPlayers exceeding limit", () => {
			assert.throws(
				() => validateSessionConfig({ ...validConfig, maxPlayers: 100 }),
				ValidationError,
			);
		});

		it("should throw when snapshotHistorySize < maxSpeculationTicks", () => {
			assert.throws(
				() =>
					validateSessionConfig({
						...validConfig,
						snapshotHistorySize: 30,
						maxSpeculationTicks: 60,
					}),
				ValidationError,
			);
		});

		it("should throw on zero hashInterval", () => {
			assert.throws(
				() => validateSessionConfig({ ...validConfig, hashInterval: 0 }),
				ValidationError,
			);
		});

		it("should throw on zero disconnectTimeout", () => {
			assert.throws(
				() => validateSessionConfig({ ...validConfig, disconnectTimeout: 0 }),
				ValidationError,
			);
		});

		it("should throw on negative lagReportThreshold", () => {
			assert.throws(
				() => validateSessionConfig({ ...validConfig, lagReportThreshold: -1 }),
				ValidationError,
			);
		});

		it("should accept zero lagReportThreshold (disables lag reporting)", () => {
			assert.doesNotThrow(() =>
				validateSessionConfig({ ...validConfig, lagReportThreshold: 0 }),
			);
		});

		it("should throw on zero inputRedundancy", () => {
			assert.throws(
				() => validateSessionConfig({ ...validConfig, inputRedundancy: 0 }),
				ValidationError,
			);
		});

		it("should throw on zero joinRateLimitRequests", () => {
			assert.throws(
				() =>
					validateSessionConfig({ ...validConfig, joinRateLimitRequests: 0 }),
				ValidationError,
			);
		});

		it("should throw on zero joinRateLimitWindowMs", () => {
			assert.throws(
				() =>
					validateSessionConfig({ ...validConfig, joinRateLimitWindowMs: 0 }),
				ValidationError,
			);
		});
	});
});
