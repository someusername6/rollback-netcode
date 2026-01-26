/**
 * DotGame - A simple game for demonstrating rollback netcode.
 *
 * Each player controls a colored dot. The world state is a collection
 * of all player dots with their positions and colors.
 *
 * KEY IMPLEMENTATION NOTES:
 *
 * 1. GAME INTERFACE: Your game must implement the Game interface:
 *    - serialize(): Convert state to bytes for network transmission
 *    - deserialize(): Restore state from bytes (used during rollback)
 *    - step(): Advance simulation by one tick given player inputs
 *    - hash(): Return a number representing current state (for desync detection)
 *
 * 2. DETERMINISM: The step() function MUST be deterministic!
 *    - Same inputs must always produce same outputs
 *    - No Math.random(), Date.now(), or external state
 *    - Use fixed-point math if floats cause issues
 *
 * 3. SERIALIZATION: Must capture ALL game state needed for rollback
 *    - If you forget something, rollbacks will produce wrong results
 *    - Include: positions, velocities, timers, any game variables
 *
 * 4. PLAYER MANAGEMENT: Handle dynamic join/leave in step()
 *    - Players may join mid-game (state sync handles initial state)
 *    - Auto-add unknown players if input arrives for them
 */

import type { Game, PlayerId } from "../src/types.js";

/** Player state: position and color */
export interface DotState {
  x: number;
  y: number;
  color: string;
}

/** Input bitmask for arrow keys */
export const Input = {
  LEFT: 0x01,
  RIGHT: 0x02,
  UP: 0x04,
  DOWN: 0x08,
} as const;

/** Movement speed in pixels per tick */
const MOVE_SPEED = 3;

/** Canvas dimensions */
export const CANVAS_WIDTH = 300;
export const CANVAS_HEIGHT = 200;

/** Dot radius */
const DOT_RADIUS = 10;

/** Colors for players (cycles if more than available) */
const PLAYER_COLORS = [
  "#e74c3c", // red
  "#3498db", // blue
  "#2ecc71", // green
  "#f39c12", // orange
  "#9b59b6", // purple
  "#1abc9c", // teal
  "#e91e63", // pink
  "#00bcd4", // cyan
];

/**
 * DotGame implements the Game interface for the rollback netcode library.
 * Each player has their own dot with position and color.
 */
export class DotGame implements Game {
  private players: Map<string, DotState> = new Map();
  private playerOrder: string[] = []; // Track order for deterministic color assignment

  /**
   * Add a player to the game.
   * @param id - Player ID
   * @param spawnX - Optional spawn X position (defaults to center)
   * @param spawnY - Optional spawn Y position (defaults to center)
   */
  addPlayer(id: string, spawnX?: number, spawnY?: number): void {
    if (this.players.has(id)) return;

    const colorIndex = this.playerOrder.length % PLAYER_COLORS.length;
    this.players.set(id, {
      x: spawnX ?? CANVAS_WIDTH / 2,
      y: spawnY ?? CANVAS_HEIGHT / 2,
      color: PLAYER_COLORS[colorIndex]!,
    });
    this.playerOrder.push(id);
  }

  /**
   * Remove a player from the game.
   */
  removePlayer(id: string): void {
    this.players.delete(id);
    const index = this.playerOrder.indexOf(id);
    if (index !== -1) {
      this.playerOrder.splice(index, 1);
    }
  }

  /**
   * Get a player's state.
   */
  getPlayer(id: string): DotState | undefined {
    return this.players.get(id);
  }

  /**
   * Get all players.
   */
  getAllPlayers(): Map<string, DotState> {
    return this.players;
  }

  /**
   * Serialize the game state to bytes.
   * Format: [playerCount, ...players]
   * Each player: [idLength, ...idBytes, x (int16), y (int16), colorIndex (uint8)]
   */
  serialize(): Uint8Array {
    const data: number[] = [this.players.size];

    for (const id of this.playerOrder) {
      const state = this.players.get(id);
      if (!state) continue;

      const idBytes = new TextEncoder().encode(id);
      data.push(idBytes.length);
      data.push(...idBytes);

      // x and y as signed int16
      const x = Math.round(state.x);
      const y = Math.round(state.y);
      data.push((x >> 8) & 0xff, x & 0xff);
      data.push((y >> 8) & 0xff, y & 0xff);

      // Color index
      const colorIndex = PLAYER_COLORS.indexOf(state.color);
      data.push(colorIndex >= 0 ? colorIndex : 0);
    }

    return new Uint8Array(data);
  }

  /**
   * Deserialize the game state from bytes.
   */
  deserialize(data: Uint8Array): void {
    this.players.clear();
    this.playerOrder = [];

    if (data.length === 0) return;

    let offset = 0;
    const count = data[offset++]!;

    for (let i = 0; i < count; i++) {
      const idLen = data[offset++]!;
      const id = new TextDecoder().decode(data.slice(offset, offset + idLen));
      offset += idLen;

      let x = (data[offset]! << 8) | data[offset + 1]!;
      let y = (data[offset + 2]! << 8) | data[offset + 3]!;
      // Sign extend from 16-bit
      if (x >= 0x8000) x -= 0x10000;
      if (y >= 0x8000) y -= 0x10000;
      offset += 4;

      const colorIndex = data[offset++]!;
      const color = PLAYER_COLORS[colorIndex % PLAYER_COLORS.length]!;

      this.players.set(id, { x, y, color });
      this.playerOrder.push(id);
    }
  }

  /**
   * Advance the simulation by one tick.
   * Processes each player's input to move their dot.
   *
   * IMPORTANT: This function must be DETERMINISTIC.
   * Given the same inputs, it must always produce the same state changes.
   */
  step(inputs: Map<PlayerId, Uint8Array>): void {
    for (const [playerId, input] of inputs) {
      // IMPORTANT PATTERN: Auto-add player if not present.
      // During rollback resimulation, players may not exist yet at earlier ticks.
      // The library will provide their inputs, so we need to handle this gracefully.
      if (!this.players.has(playerId)) {
        this.addPlayer(playerId);
      }

      const player = this.players.get(playerId);
      if (!player || input.length === 0) continue;

      const keys = input[0]!;

      if (keys & Input.LEFT) player.x -= MOVE_SPEED;
      if (keys & Input.RIGHT) player.x += MOVE_SPEED;
      if (keys & Input.UP) player.y -= MOVE_SPEED;
      if (keys & Input.DOWN) player.y += MOVE_SPEED;

      // Clamp to canvas bounds
      player.x = Math.max(DOT_RADIUS, Math.min(CANVAS_WIDTH - DOT_RADIUS, player.x));
      player.y = Math.max(DOT_RADIUS, Math.min(CANVAS_HEIGHT - DOT_RADIUS, player.y));
    }
  }

  /**
   * Compute a hash of the current game state for desync detection.
   *
   * REQUIREMENTS:
   * - Must be deterministic (same state = same hash)
   * - Must include ALL state that affects gameplay
   * - Iteration order must be consistent (use sorted keys or track order)
   *
   * TIP: Use playerOrder array for deterministic iteration over Map.
   * Maps don't guarantee iteration order across different JS engines.
   */
  hash(): number {
    let h = 0;
    // Use playerOrder for deterministic iteration (Map order is not guaranteed)
    for (const id of this.playerOrder) {
      const state = this.players.get(id);
      if (!state) continue;

      // Hash the player ID
      for (let i = 0; i < id.length; i++) {
        h = ((h << 5) - h + id.charCodeAt(i)) | 0;
      }
      // Hash position (rounded to avoid float issues)
      h = ((h << 5) - h + Math.round(state.x)) | 0;
      h = ((h << 5) - h + Math.round(state.y)) | 0;
    }
    return h >>> 0;
  }

  /**
   * Render the game state to a canvas.
   * @param ctx - Canvas 2D rendering context
   * @param highlightPlayerId - Optional player ID to highlight (local player)
   */
  draw(ctx: CanvasRenderingContext2D, highlightPlayerId?: string): void {
    // Clear canvas
    ctx.fillStyle = "#1a1a2e";
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Draw all dots
    for (const [id, state] of this.players) {
      ctx.beginPath();
      ctx.arc(state.x, state.y, DOT_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = state.color;
      ctx.fill();

      // Highlight local player with a ring
      if (id === highlightPlayerId) {
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
  }

  /**
   * Induce a desync by directly modifying state without going through step().
   * Used for testing desync detection.
   */
  induceDesync(): void {
    // Add random offset to all players
    for (const player of this.players.values()) {
      const offsetX = Math.floor(Math.random() * 60) - 30; // -30 to +30
      const offsetY = Math.floor(Math.random() * 60) - 30;
      player.x += offsetX;
      player.y += offsetY;
      // Clamp to canvas bounds
      player.x = Math.max(DOT_RADIUS, Math.min(CANVAS_WIDTH - DOT_RADIUS, player.x));
      player.y = Math.max(DOT_RADIUS, Math.min(CANVAS_HEIGHT - DOT_RADIUS, player.y));
    }
  }
}
