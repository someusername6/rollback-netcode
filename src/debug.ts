/**
 * Debug logging utilities for the rollback netcode library.
 *
 * When debug mode is enabled, these utilities provide detailed logging
 * of rollback operations, input handling, and network events.
 */

/**
 * Debug logger interface.
 */
export interface DebugLogger {
	/** Log general information */
	log: (message: string, data?: unknown) => void;

	/** Log warnings */
	warn: (message: string, data?: unknown) => void;

	/** Log detailed trace information */
	trace: (message: string, data?: unknown) => void;
}

/**
 * Create a debug logger that only outputs when enabled.
 *
 * @param enabled - Whether debug logging is enabled
 * @returns A debug logger instance
 */
export function createDebugLogger(enabled: boolean): DebugLogger {
	if (!enabled) {
		return {
			log: () => {},
			warn: () => {},
			trace: () => {},
		};
	}

	return {
		log: (message: string, data?: unknown) => {
			if (data !== undefined) {
				console.log("[rollback]", message, data);
			} else {
				console.log("[rollback]", message);
			}
		},
		warn: (message: string, data?: unknown) => {
			if (data !== undefined) {
				console.warn("[rollback]", message, data);
			} else {
				console.warn("[rollback]", message);
			}
		},
		trace: (message: string, data?: unknown) => {
			if (data !== undefined) {
				console.log("[rollback:trace]", message, data);
			} else {
				console.log("[rollback:trace]", message);
			}
		},
	};
}

/**
 * A no-op logger for when debugging is disabled.
 */
export const noopLogger: DebugLogger = {
	log: () => {},
	warn: () => {},
	trace: () => {},
};
