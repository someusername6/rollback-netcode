import assert from "node:assert";
import { describe, it } from "node:test";
import {
	DesyncAuthority,
	Topology,
	ValidationError,
	asPlayerId,
	asTick,
	validateSessionConfig,
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
