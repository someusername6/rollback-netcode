/**
 * Performance benchmarks for the rollback netcode library.
 *
 * Run with: npx tsx src/benchmark.ts
 *
 * These benchmarks help track performance regressions and validate
 * that optimizations are effective.
 */

import { decodeMessage, encodeMessage } from "./protocol/encoding.js";
import { MessageType } from "./protocol/messages.js";
import { RollbackEngine } from "./rollback/engine.js";
import { InputBuffer } from "./rollback/input-buffer.js";
import { SnapshotBuffer } from "./rollback/snapshot-buffer.js";
import { type Game, type PlayerId, asPlayerId, asTick } from "./types.js";

// =============================================================================
// Benchmark Utilities
// =============================================================================

interface BenchmarkResult {
	name: string;
	opsPerSecond: number;
	avgTimeMs: number;
	iterations: number;
}

function benchmark(
	name: string,
	fn: () => void,
	iterations = 10000,
): BenchmarkResult {
	// Warmup
	for (let i = 0; i < Math.min(1000, iterations / 10); i++) {
		fn();
	}

	const start = performance.now();
	for (let i = 0; i < iterations; i++) {
		fn();
	}
	const end = performance.now();

	const totalMs = end - start;
	const avgTimeMs = totalMs / iterations;
	const opsPerSecond = 1000 / avgTimeMs;

	return { name, opsPerSecond, avgTimeMs, iterations };
}

function formatResult(result: BenchmarkResult): string {
	const ops =
		result.opsPerSecond >= 1000000
			? `${(result.opsPerSecond / 1000000).toFixed(2)}M`
			: result.opsPerSecond >= 1000
				? `${(result.opsPerSecond / 1000).toFixed(2)}K`
				: result.opsPerSecond.toFixed(2);

	const time =
		result.avgTimeMs >= 1
			? `${result.avgTimeMs.toFixed(3)}ms`
			: `${(result.avgTimeMs * 1000).toFixed(3)}µs`;

	return `${result.name.padEnd(40)} ${ops.padStart(10)} ops/s  ${time.padStart(12)}/op`;
}

// =============================================================================
// Test Game for Benchmarks
// =============================================================================

class BenchmarkGame implements Game {
	private state = new Uint8Array(1024); // 1KB state

	serialize(): Uint8Array {
		const copy = new Uint8Array(this.state.length);
		copy.set(this.state);
		return copy;
	}

	deserialize(data: Uint8Array): void {
		this.state.set(data);
	}

	step(inputs: Map<PlayerId, Uint8Array>): void {
		// Simulate some game logic
		for (const [, input] of inputs) {
			const firstByte = input[0];
			const stateByte = this.state[0];
			if (
				input.length > 0 &&
				firstByte !== undefined &&
				stateByte !== undefined
			) {
				this.state[0] = (stateByte + firstByte) & 0xff;
			}
		}
	}

	hash(): number {
		let h = 0;
		for (let i = 0; i < this.state.length; i++) {
			const byte = this.state[i] ?? 0;
			h = ((h << 5) - h + byte) | 0;
		}
		return h;
	}
}

// =============================================================================
// Benchmarks
// =============================================================================

function runSnapshotBufferBenchmarks(): BenchmarkResult[] {
	const results: BenchmarkResult[] = [];

	// Snapshot buffer save
	const buffer = new SnapshotBuffer(120);
	const state = new Uint8Array(1024);
	let tick = 0;
	results.push(
		benchmark("SnapshotBuffer.save (1KB state)", () => {
			buffer.save(asTick(tick++ % 1000), state, tick);
		}),
	);

	// Snapshot buffer get (O(1) lookup)
	const getBuffer = new SnapshotBuffer(120);
	for (let i = 0; i < 120; i++) {
		getBuffer.save(asTick(i), state, i);
	}
	results.push(
		benchmark("SnapshotBuffer.get (O(1) lookup)", () => {
			getBuffer.get(asTick(60));
		}),
	);

	return results;
}

function runInputBufferBenchmarks(): BenchmarkResult[] {
	const results: BenchmarkResult[] = [];

	const inputBuffer = new InputBuffer();
	const playerId = asPlayerId("player-1");
	inputBuffer.addPlayer(playerId, asTick(0));
	const input = new Uint8Array([128, 128]);

	let tick = 0;
	results.push(
		benchmark("InputBuffer.receiveInput", () => {
			inputBuffer.receiveInput(playerId, asTick(tick++ % 1000), input);
		}),
	);

	results.push(
		benchmark("InputBuffer.getInput", () => {
			inputBuffer.getInput(playerId, asTick(50));
		}),
	);

	return results;
}

function runEncodingBenchmarks(): BenchmarkResult[] {
	const results: BenchmarkResult[] = [];

	// Input message encoding
	const inputMsg = {
		type: MessageType.Input as const,
		playerId: asPlayerId("player-1"),
		inputs: [
			{ tick: asTick(100), input: new Uint8Array([128, 128]) },
			{ tick: asTick(99), input: new Uint8Array([128, 128]) },
			{ tick: asTick(98), input: new Uint8Array([128, 128]) },
		],
	};
	results.push(
		benchmark("encodeMessage (Input, 3 ticks)", () => {
			encodeMessage(inputMsg);
		}),
	);

	const encodedInput = encodeMessage(inputMsg);
	results.push(
		benchmark("decodeMessage (Input, 3 ticks)", () => {
			decodeMessage(encodedInput);
		}),
	);

	// Sync message encoding (larger payload)
	const syncMsg = {
		type: MessageType.Sync as const,
		tick: asTick(100),
		hash: 12345,
		state: new Uint8Array(1024),
		playerTimeline: [
			{
				playerId: asPlayerId("player-1"),
				joinTick: asTick(0),
				leaveTick: null,
			},
			{
				playerId: asPlayerId("player-2"),
				joinTick: asTick(0),
				leaveTick: null,
			},
			{
				playerId: asPlayerId("player-3"),
				joinTick: asTick(10),
				leaveTick: null,
			},
			{
				playerId: asPlayerId("player-4"),
				joinTick: asTick(20),
				leaveTick: null,
			},
		],
	};
	results.push(
		benchmark("encodeMessage (Sync, 1KB state, 4 players)", () => {
			encodeMessage(syncMsg);
		}),
	);

	const encodedSync = encodeMessage(syncMsg);
	results.push(
		benchmark("decodeMessage (Sync, 1KB state, 4 players)", () => {
			decodeMessage(encodedSync);
		}),
	);

	return results;
}

function runEngineBenchmarks(): BenchmarkResult[] {
	const results: BenchmarkResult[] = [];

	// Engine tick without rollback
	const game = new BenchmarkGame();
	const engine = new RollbackEngine({
		game,
		localPlayerId: asPlayerId("player-1"),
		snapshotHistorySize: 120,
		maxSpeculationTicks: 60,
	});

	const input = new Uint8Array([128, 128]);
	results.push(
		benchmark(
			"RollbackEngine.tick (no rollback)",
			() => {
				engine.setLocalInput(engine.currentTick, input);
				engine.tick();
			},
			5000,
		),
	);

	// Engine tick with rollback (simulate misprediction)
	const gameWithRollback = new BenchmarkGame();
	const engineWithRollback = new RollbackEngine({
		game: gameWithRollback,
		localPlayerId: asPlayerId("player-1"),
		snapshotHistorySize: 120,
		maxSpeculationTicks: 60,
	});

	const player2 = asPlayerId("player-2");
	engineWithRollback.addPlayer(player2, asTick(0));

	// Pre-run some ticks
	for (let i = 0; i < 30; i++) {
		engineWithRollback.setLocalInput(engineWithRollback.currentTick, input);
		engineWithRollback.tick();
	}

	results.push(
		benchmark(
			"RollbackEngine.tick (with rollback)",
			() => {
				// Receive late input that causes rollback
				const rollbackTick = asTick(engineWithRollback.currentTick - 5);
				engineWithRollback.receiveRemoteInput(
					player2,
					rollbackTick,
					new Uint8Array([138, 128]),
				);
				engineWithRollback.setLocalInput(engineWithRollback.currentTick, input);
				engineWithRollback.tick();
			},
			1000,
		),
	);

	return results;
}

// =============================================================================
// Main
// =============================================================================

function main(): void {
	console.log("=".repeat(70));
	console.log("Rollback Netcode Library - Performance Benchmarks");
	console.log("=".repeat(70));
	console.log();

	console.log("Snapshot Buffer:");
	console.log("-".repeat(70));
	for (const result of runSnapshotBufferBenchmarks()) {
		console.log(formatResult(result));
	}
	console.log();

	console.log("Input Buffer:");
	console.log("-".repeat(70));
	for (const result of runInputBufferBenchmarks()) {
		console.log(formatResult(result));
	}
	console.log();

	console.log("Protocol Encoding:");
	console.log("-".repeat(70));
	for (const result of runEncodingBenchmarks()) {
		console.log(formatResult(result));
	}
	console.log();

	console.log("Rollback Engine:");
	console.log("-".repeat(70));
	for (const result of runEngineBenchmarks()) {
		console.log(formatResult(result));
	}
	console.log();

	console.log("=".repeat(70));
	console.log("Benchmark complete.");
}

main();
