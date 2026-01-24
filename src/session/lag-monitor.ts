/**
 * Lag monitoring for detecting and reporting players that fall behind.
 */

import type { PlayerId, Tick } from "../types.js";

/**
 * Configuration for the lag monitor.
 */
export interface LagMonitorConfig {
	/**
	 * Number of ticks behind before a player is considered lagging.
	 * Set to 0 to disable lag monitoring.
	 */
	threshold: number;

	/**
	 * Minimum ticks between lag reports for the same player.
	 * Prevents spam when a player is consistently lagging.
	 */
	cooldownTicks: number;
}

/**
 * Result when a player is detected as lagging.
 */
export interface LagReport {
	/** The player who is lagging */
	laggyPlayerId: PlayerId;
	/** How many ticks behind they are */
	ticksBehind: number;
}

/**
 * Default cooldown between lag reports for the same player.
 */
export const DEFAULT_LAG_REPORT_COOLDOWN_TICKS = 60;

/**
 * Monitors player lag and generates reports when players fall too far behind.
 *
 * Uses a cooldown system to prevent flooding the host with lag reports
 * for persistently lagging players.
 */
export class LagMonitor {
	private readonly threshold: number;
	private readonly cooldownTicks: number;
	private readonly lastReportTick: Map<PlayerId, Tick> = new Map();

	constructor(config: LagMonitorConfig) {
		this.threshold = config.threshold;
		this.cooldownTicks = config.cooldownTicks;
	}

	/**
	 * Check if a player is lagging and should be reported.
	 *
	 * @param playerId - The player to check
	 * @param ticksBehind - How many ticks behind the player is
	 * @param currentTick - The current simulation tick
	 * @returns A LagReport if the player is lagging and cooldown has passed, null otherwise
	 */
	checkPlayer(
		playerId: PlayerId,
		ticksBehind: number,
		currentTick: Tick,
	): LagReport | null {
		// Disabled if threshold is 0 or negative
		if (this.threshold <= 0) {
			return null;
		}

		// Not lagging enough
		if (ticksBehind < this.threshold) {
			return null;
		}

		// Check cooldown
		const lastReport = this.lastReportTick.get(playerId);
		if (
			lastReport !== undefined &&
			currentTick - lastReport < this.cooldownTicks
		) {
			return null;
		}

		// Record this report and return
		this.lastReportTick.set(playerId, currentTick);
		return {
			laggyPlayerId: playerId,
			ticksBehind,
		};
	}

	/**
	 * Reset the cooldown for a player.
	 * Use this when a player recovers from lag.
	 *
	 * @param playerId - The player to reset
	 */
	reset(playerId: PlayerId): void {
		this.lastReportTick.delete(playerId);
	}

	/**
	 * Clear all lag tracking state.
	 */
	clear(): void {
		this.lastReportTick.clear();
	}

	/**
	 * Whether lag monitoring is enabled.
	 */
	get isEnabled(): boolean {
		return this.threshold > 0;
	}
}
