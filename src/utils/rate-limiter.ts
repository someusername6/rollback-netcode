/**
 * Generic rate limiter for request throttling.
 *
 * Uses a sliding window algorithm to track requests per key.
 */

/**
 * Configuration for the rate limiter.
 */
export interface RateLimiterConfig {
	/** Maximum number of requests allowed within the window */
	maxRequests: number;
	/** Time window in milliseconds */
	windowMs: number;
	/** Optional custom time source for testing (defaults to Date.now) */
	getNow?: () => number;
}

/**
 * A generic rate limiter that tracks requests per key.
 *
 * Uses a sliding window approach: requests older than windowMs are discarded.
 */
export class RateLimiter {
	private readonly maxRequests: number;
	private readonly windowMs: number;
	private readonly requests: Map<string, number[]> = new Map();
	private readonly getNow: () => number;

	constructor(config: RateLimiterConfig) {
		if (config.maxRequests <= 0) {
			throw new Error("maxRequests must be greater than 0");
		}
		if (config.windowMs <= 0) {
			throw new Error("windowMs must be greater than 0");
		}
		this.maxRequests = config.maxRequests;
		this.windowMs = config.windowMs;
		this.getNow = config.getNow ?? (() => Date.now());
	}

	/**
	 * Check if a key is currently rate limited.
	 *
	 * @param key - The key to check (e.g., peer ID)
	 * @returns true if the key has exceeded the rate limit
	 */
	isLimited(key: string): boolean {
		const now = this.getNow();
		const timestamps = this.requests.get(key) ?? [];

		// Filter to only recent timestamps within the window
		const recentTimestamps = timestamps.filter((t) => now - t < this.windowMs);
		this.requests.set(key, recentTimestamps);

		return recentTimestamps.length >= this.maxRequests;
	}

	/**
	 * Record a request for a key.
	 *
	 * @param key - The key to record (e.g., peer ID)
	 */
	record(key: string): void {
		const timestamps = this.requests.get(key) ?? [];
		timestamps.push(this.getNow());
		this.requests.set(key, timestamps);
	}

	/**
	 * Check if limited and record in one operation.
	 * Returns true if the request should be rejected.
	 *
	 * @param key - The key to check and record
	 * @returns true if the key is rate limited (request should be rejected)
	 */
	checkAndRecord(key: string): boolean {
		const now = this.getNow();
		const timestamps = this.requests.get(key) ?? [];
		const recentTimestamps = timestamps.filter((t) => now - t < this.windowMs);

		if (recentTimestamps.length >= this.maxRequests) {
			this.requests.set(key, recentTimestamps);
			return true;
		}

		recentTimestamps.push(now);
		this.requests.set(key, recentTimestamps);
		return false;
	}

	/**
	 * Clean up stale entries to prevent memory growth.
	 * Call this periodically (e.g., every minute).
	 */
	cleanup(): void {
		const now = this.getNow();
		for (const [key, timestamps] of this.requests) {
			const recentTimestamps = timestamps.filter(
				(t) => now - t < this.windowMs,
			);
			if (recentTimestamps.length === 0) {
				this.requests.delete(key);
			} else {
				this.requests.set(key, recentTimestamps);
			}
		}
	}

	/**
	 * Clear all rate limit entries.
	 */
	clear(): void {
		this.requests.clear();
	}
}
