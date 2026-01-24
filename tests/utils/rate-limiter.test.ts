import assert from "node:assert";
import { describe, it } from "node:test";
import { RateLimiter } from "../../src/utils/rate-limiter.js";

describe("RateLimiter", () => {
	describe("constructor", () => {
		it("should create rate limiter with valid config", () => {
			const limiter = new RateLimiter({ maxRequests: 3, windowMs: 1000 });
			assert.ok(limiter);
		});

		it("should throw on zero maxRequests", () => {
			assert.throws(
				() => new RateLimiter({ maxRequests: 0, windowMs: 1000 }),
				/maxRequests must be greater than 0/,
			);
		});

		it("should throw on negative maxRequests", () => {
			assert.throws(
				() => new RateLimiter({ maxRequests: -1, windowMs: 1000 }),
				/maxRequests must be greater than 0/,
			);
		});

		it("should throw on zero windowMs", () => {
			assert.throws(
				() => new RateLimiter({ maxRequests: 3, windowMs: 0 }),
				/windowMs must be greater than 0/,
			);
		});

		it("should throw on negative windowMs", () => {
			assert.throws(
				() => new RateLimiter({ maxRequests: 3, windowMs: -1 }),
				/windowMs must be greater than 0/,
			);
		});
	});

	describe("isLimited", () => {
		it("should return false when no requests recorded", () => {
			const limiter = new RateLimiter({ maxRequests: 3, windowMs: 1000 });
			assert.strictEqual(limiter.isLimited("peer1"), false);
		});

		it("should return false when under limit", () => {
			const limiter = new RateLimiter({ maxRequests: 3, windowMs: 1000 });
			limiter.record("peer1");
			limiter.record("peer1");
			assert.strictEqual(limiter.isLimited("peer1"), false);
		});

		it("should return true when at limit", () => {
			const limiter = new RateLimiter({ maxRequests: 3, windowMs: 1000 });
			limiter.record("peer1");
			limiter.record("peer1");
			limiter.record("peer1");
			assert.strictEqual(limiter.isLimited("peer1"), true);
		});

		it("should return true when over limit", () => {
			const limiter = new RateLimiter({ maxRequests: 3, windowMs: 1000 });
			limiter.record("peer1");
			limiter.record("peer1");
			limiter.record("peer1");
			limiter.record("peer1");
			assert.strictEqual(limiter.isLimited("peer1"), true);
		});

		it("should track keys independently", () => {
			const limiter = new RateLimiter({ maxRequests: 2, windowMs: 1000 });
			limiter.record("peer1");
			limiter.record("peer1");
			limiter.record("peer2");

			assert.strictEqual(limiter.isLimited("peer1"), true);
			assert.strictEqual(limiter.isLimited("peer2"), false);
		});
	});

	describe("record", () => {
		it("should record a request for a new key", () => {
			const limiter = new RateLimiter({ maxRequests: 3, windowMs: 1000 });
			limiter.record("peer1");
			// After 1 record, 2 more allowed before limit
			limiter.record("peer1");
			limiter.record("peer1");
			assert.strictEqual(limiter.isLimited("peer1"), true);
		});
	});

	describe("checkAndRecord", () => {
		it("should return false and record when not limited", () => {
			const limiter = new RateLimiter({ maxRequests: 3, windowMs: 1000 });
			assert.strictEqual(limiter.checkAndRecord("peer1"), false);
			assert.strictEqual(limiter.checkAndRecord("peer1"), false);
			assert.strictEqual(limiter.checkAndRecord("peer1"), false);
			// Now at limit
			assert.strictEqual(limiter.checkAndRecord("peer1"), true);
		});

		it("should return true without recording when limited", () => {
			const limiter = new RateLimiter({ maxRequests: 1, windowMs: 1000 });
			assert.strictEqual(limiter.checkAndRecord("peer1"), false);
			// Now limited
			assert.strictEqual(limiter.checkAndRecord("peer1"), true);
			assert.strictEqual(limiter.checkAndRecord("peer1"), true);
		});
	});

	describe("cleanup", () => {
		it("should remove keys with no recent requests", () => {
			const limiter = new RateLimiter({ maxRequests: 3, windowMs: 10 });
			limiter.record("peer1");

			// Wait for window to expire
			const start = Date.now();
			while (Date.now() - start < 20) {
				// busy wait
			}

			limiter.cleanup();
			// After cleanup, peer1 should no longer be limited
			assert.strictEqual(limiter.isLimited("peer1"), false);
		});

		it("should keep keys with recent requests", () => {
			const limiter = new RateLimiter({ maxRequests: 1, windowMs: 10000 });
			limiter.record("peer1");
			limiter.cleanup();
			// Should still be limited
			assert.strictEqual(limiter.isLimited("peer1"), true);
		});
	});

	describe("clear", () => {
		it("should remove all entries", () => {
			const limiter = new RateLimiter({ maxRequests: 1, windowMs: 1000 });
			limiter.record("peer1");
			limiter.record("peer2");

			limiter.clear();

			assert.strictEqual(limiter.isLimited("peer1"), false);
			assert.strictEqual(limiter.isLimited("peer2"), false);
		});
	});

	describe("window expiry", () => {
		it("should not count expired requests", () => {
			const limiter = new RateLimiter({ maxRequests: 2, windowMs: 10 });
			limiter.record("peer1");
			limiter.record("peer1");
			assert.strictEqual(limiter.isLimited("peer1"), true);

			// Wait for window to expire
			const start = Date.now();
			while (Date.now() - start < 20) {
				// busy wait
			}

			// Old requests should have expired
			assert.strictEqual(limiter.isLimited("peer1"), false);
		});
	});
});
