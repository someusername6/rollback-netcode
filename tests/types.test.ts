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

		it("should throw ValidationError for negative ticks below TICK_MIN", () => {
			try {
				validateTick(-2);
				assert.fail("Expected ValidationError");
			} catch (error) {
				assert.ok(error instanceof ValidationError);
				assert.strictEqual(error.field, "tick");
				assert.strictEqual(error.value, -2);
			}

			try {
				validateTick(-100);
				assert.fail("Expected ValidationError");
			} catch (error) {
				assert.ok(error instanceof ValidationError);
				assert.strictEqual(error.field, "tick");
				assert.strictEqual(error.value, -100);
			}
		});

		it("should throw ValidationError for non-integer values", () => {
			try {
				validateTick(1.5);
				assert.fail("Expected ValidationError");
			} catch (error) {
				assert.ok(error instanceof ValidationError);
				assert.strictEqual(error.field, "tick");
				assert.strictEqual(error.value, 1.5);
			}

			try {
				validateTick(0.1);
				assert.fail("Expected ValidationError");
			} catch (error) {
				assert.ok(error instanceof ValidationError);
				assert.strictEqual(error.field, "tick");
			}
		});

		it("should throw ValidationError for NaN", () => {
			try {
				validateTick(NaN);
				assert.fail("Expected ValidationError");
			} catch (error) {
				assert.ok(error instanceof ValidationError);
				assert.strictEqual(error.field, "tick");
			}
		});

		it("should throw ValidationError for Infinity", () => {
			try {
				validateTick(Infinity);
				assert.fail("Expected ValidationError");
			} catch (error) {
				assert.ok(error instanceof ValidationError);
				assert.strictEqual(error.field, "tick");
			}

			try {
				validateTick(-Infinity);
				assert.fail("Expected ValidationError");
			} catch (error) {
				assert.ok(error instanceof ValidationError);
				assert.strictEqual(error.field, "tick");
			}
		});
	});

	describe("validatePlayerId", () => {
		it("should accept valid player IDs", () => {
			assert.doesNotThrow(() => validatePlayerId("player-1"));
			assert.doesNotThrow(() => validatePlayerId("a"));
			assert.doesNotThrow(() => validatePlayerId("player:123@test.com"));
		});

		it("should throw ValidationError for empty string", () => {
			try {
				validatePlayerId("");
				assert.fail("Expected ValidationError");
			} catch (error) {
				assert.ok(error instanceof ValidationError);
				assert.strictEqual(error.field, "playerId");
				assert.strictEqual(error.value, "");
				assert.ok(error.message.includes("non-empty string"));
			}
		});

		it("should throw with descriptive message", () => {
			try {
				validatePlayerId("");
			} catch (e) {
				assert.ok(e instanceof ValidationError);
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

		it("should throw on zero maxSpeculationTicks", () => {
			assert.throws(
				() => validateSessionConfig({ ...validConfig, maxSpeculationTicks: 0 }),
				ValidationError,
			);
		});

		it("should throw on negative maxSpeculationTicks", () => {
			assert.throws(
				() =>
					validateSessionConfig({ ...validConfig, maxSpeculationTicks: -1 }),
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
