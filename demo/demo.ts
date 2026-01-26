/**
 * Demo page for rollback-netcode library.
 *
 * Simulates multiple players locally to demonstrate the library's features
 * without requiring real network connections.
 *
 * KEY CONCEPTS DEMONSTRATED:
 *
 * 1. TOPOLOGY (Star vs Mesh):
 *    - Star: All clients connect to host only. Host relays messages.
 *      Simpler, lower bandwidth, but host is single point of failure.
 *    - Mesh: All clients connect to each other directly.
 *      More bandwidth, but more resilient.
 *
 * 2. DESYNC AUTHORITY (Host vs Peer):
 *    - Host: Only the host checks for desyncs by comparing hashes.
 *      Clients trust the host's state as authoritative.
 *    - Peer: All peers check for desyncs independently.
 *      More robust detection but more network traffic.
 *
 * 3. ROLLBACK:
 *    When a player's input arrives late, the library:
 *    a) Restores game state from a snapshot (before the late input)
 *    b) Re-simulates forward with the correct inputs
 *    c) This happens automatically - you just see the corrected state
 *
 * 4. HASH INTERVAL:
 *    How often (in ticks) to send state hashes for desync detection.
 *    Lower = faster detection but more bandwidth. 30 = every 0.5s at 60Hz.
 *
 * 5. TRANSPORT FLUSHING:
 *    LocalTransport queues messages. flush() delivers them.
 *    Multiple flushes handle multi-hop delivery (A→Host→B in Star topology).
 */

import {
  createSession,
  LocalTransport,
  Topology,
  DesyncAuthority,
  asPlayerId,
} from "../src/index.js";
import type { Session, PlayerId } from "../src/index.js";
import { DotGame, Input, CANVAS_WIDTH, CANVAS_HEIGHT } from "./game.js";

/** Tick rate in Hz - how many simulation steps per second */
const TICK_RATE = 60;
/** Milliseconds per tick */
const TICK_MS = 1000 / TICK_RATE;
/** How often to send state hashes for desync detection (every N ticks) */
const HASH_INTERVAL = 30; // = 0.5 seconds at 60Hz
/** Number of transport flush iterations for multi-hop message delivery */
const FLUSH_ITERATIONS = 5;
/** Jitter as percentage of latency (20% is realistic for internet) */
const JITTER_RATIO = 0.2;
/** How often to trigger keepalive pings (in ticks) */
const KEEPALIVE_INTERVAL_TICKS = 30; // every 0.5s at 60Hz

/**
 * Predefined spawn positions as fractions of canvas size.
 * Ordered so that 2 players are diagonal, 4 players are in corners, etc.
 */
const SPAWN_POSITIONS = [
  { x: 0.25, y: 0.25 }, // top-left quadrant
  { x: 0.75, y: 0.75 }, // bottom-right quadrant (diagonal from first)
  { x: 0.75, y: 0.25 }, // top-right quadrant
  { x: 0.25, y: 0.75 }, // bottom-left quadrant
  { x: 0.5, y: 0.15 },  // top center
  { x: 0.5, y: 0.85 },  // bottom center
  { x: 0.12, y: 0.5 },  // left center
  { x: 0.88, y: 0.5 },  // right center
  { x: 0.15, y: 0.15 }, // corner positions for 9-12
  { x: 0.85, y: 0.85 },
  { x: 0.85, y: 0.15 },
  { x: 0.15, y: 0.85 },
  { x: 0.4, y: 0.35 },  // inner positions for 13-16
  { x: 0.6, y: 0.65 },
  { x: 0.6, y: 0.35 },
  { x: 0.4, y: 0.65 },
];

interface PlayerEntry {
  id: PlayerId;
  session: Session;
  game: DotGame;
  transport: LocalTransport;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  panel: HTMLElement;
  /** DOM element displaying stats (rollbacks, latency) */
  statsEl: HTMLElement;
  /** Total rollback count for this session */
  rollbackCount: number;
}

/**
 * Manages the demo, orchestrating multiple local players.
 */
/** Maximum players allowed in the demo */
const MAX_PLAYERS = 16;

class DemoManager {
  players: Map<PlayerId, PlayerEntry> = new Map();
  activePlayerId: PlayerId | null = null;
  private pressedKeys: Set<string> = new Set();
  private playerCounter = 0;
  private lastTickTime = 0;
  private accumulator = 0;
  private running = false;
  private tickCounter = 0;

  private topology: Topology = Topology.Star;
  private desyncAuthority: DesyncAuthority = DesyncAuthority.Host;
  private simulatedLatency: number = 0;
  private addPlayerBtn: HTMLButtonElement | null = null;

  constructor() {
    this.setupControls();
    this.setupKeyboardInput();
  }

  /**
   * Set up the control panel event handlers.
   */
  private setupControls(): void {
    const topologySelect = document.getElementById("topology") as HTMLSelectElement;
    const authoritySelect = document.getElementById("authority") as HTMLSelectElement;
    const latencySelect = document.getElementById("latency") as HTMLSelectElement;
    this.addPlayerBtn = document.getElementById("add-player") as HTMLButtonElement;

    topologySelect.addEventListener("change", () => {
      this.topology = topologySelect.value === "mesh" ? Topology.Mesh : Topology.Star;
      this.reset();
    });

    authoritySelect.addEventListener("change", () => {
      this.desyncAuthority = authoritySelect.value === "peer"
        ? DesyncAuthority.Peer
        : DesyncAuthority.Host;
      this.reset();
    });

    latencySelect.addEventListener("change", () => {
      this.simulatedLatency = parseInt(latencySelect.value, 10);
      this.reset();
    });

    this.addPlayerBtn.addEventListener("click", () => {
      this.addPlayer();
    });
  }

  /**
   * Update the Add Player button enabled state based on current player count.
   */
  private updateAddPlayerButton(): void {
    if (this.addPlayerBtn) {
      this.addPlayerBtn.disabled = this.players.size >= MAX_PLAYERS;
    }
  }

  /**
   * Set up keyboard input handling.
   */
  private setupKeyboardInput(): void {
    window.addEventListener("keydown", (e) => {
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
        e.preventDefault();
        this.pressedKeys.add(e.key);
      }
    });

    window.addEventListener("keyup", (e) => {
      this.pressedKeys.delete(e.key);
    });
  }

  /**
   * Reset the demo (remove all players).
   */
  private reset(): void {
    // Destroy all sessions
    for (const player of this.players.values()) {
      player.session.destroy();
      player.panel.remove();
    }
    this.players.clear();
    this.activePlayerId = null;
    this.playerCounter = 0;
    this.updateAddPlayerButton();
  }

  /**
   * Get the current input as a byte based on pressed keys.
   */
  private getInput(): Uint8Array {
    let input = 0;
    if (this.pressedKeys.has("ArrowLeft")) input |= Input.LEFT;
    if (this.pressedKeys.has("ArrowRight")) input |= Input.RIGHT;
    if (this.pressedKeys.has("ArrowUp")) input |= Input.UP;
    if (this.pressedKeys.has("ArrowDown")) input |= Input.DOWN;
    return new Uint8Array([input]);
  }

  /**
   * Add a new player to the demo.
   *
   * This demonstrates the typical flow for adding a player:
   * 1. Create a transport (LocalTransport for testing, WebRTCTransport for production)
   * 2. Link transports based on topology
   * 3. Create game instance
   * 4. Create session with game + transport
   * 5. Register event handlers
   * 6. Host creates room, others join
   */
  addPlayer(): void {
    const playerId = asPlayerId(`player-${++this.playerCounter}`);
    const isHost = this.players.size === 0;

    // Create transport with simulated latency
    // In production, you'd use WebRTCTransport instead of LocalTransport
    const transport = new LocalTransport(playerId, {
      latency: this.simulatedLatency,
      jitter: Math.floor(this.simulatedLatency * JITTER_RATIO),
    });

    // Link transport based on topology
    // Star: only connect to host (host relays messages)
    // Mesh: connect to all peers (direct P2P)
    if (!isHost) {
      const hostEntry = this.getHostEntry();
      if (!hostEntry) {
        this.showError("Cannot add player: no host found");
        return;
      }
      LocalTransport.link(transport, hostEntry.transport);

      if (this.topology === Topology.Mesh) {
        // In mesh, also link to all other non-host players
        for (const [id, entry] of this.players) {
          if (id !== hostEntry.id) {
            LocalTransport.link(transport, entry.transport);
          }
        }
      }
    }

    // Create game instance - each player has their own local copy
    // The rollback library keeps them in sync
    const game = new DotGame();

    // Create session - this is the main interface to the rollback library
    const session = createSession({
      game,
      transport,
      localPlayerId: playerId,
      config: {
        topology: this.topology,
        desyncAuthority: this.desyncAuthority,
        tickRate: TICK_RATE,
        // hashInterval: How often to send state hashes for desync detection
        // Lower = faster detection, higher = less bandwidth
        hashInterval: HASH_INTERVAL,
        maxPlayers: MAX_PLAYERS,
      },
    });

    // Handle player join/leave events
    // IMPORTANT: Your game must handle these to add/remove players from game state
    session.on("playerJoined", (info) => {
      const spawn = this.getSpawnPosition(info.id);
      game.addPlayer(info.id, spawn.x, spawn.y);
    });

    session.on("playerLeft", (info) => {
      game.removePlayer(info.id);
    });

    // Handle desync detection
    // This fires when the library detects state mismatch between players
    session.on("desync", (tick, localHash, remoteHash) => {
      this.showDesyncFeedback(playerId, tick, localHash, remoteHash);
    });

    // Create UI
    const { panel, canvas, ctx, statsEl } = this.createPlayerPanel(playerId, isHost);

    // Store player entry
    const entry: PlayerEntry = {
      id: playerId,
      session,
      game,
      transport,
      canvas,
      ctx,
      panel,
      statsEl,
      rollbackCount: 0,
    };
    this.players.set(playerId, entry);
    this.updateAddPlayerButton();

    // Set up room - host creates, others join
    if (isHost) {
      session.createRoom()
        .then(() => {
          const spawn = this.getSpawnPosition(playerId);
          game.addPlayer(playerId, spawn.x, spawn.y);
          session.start();
          this.startGameLoop();
        })
        .catch((error) => {
          this.showError(`Failed to create room: ${error.message}`);
          this.removePlayer(playerId);
        });
    } else {
      const hostEntry = this.getHostEntry();
      if (!hostEntry) {
        this.showError("Cannot join: no host found");
        this.removePlayer(playerId);
        return;
      }
      const hostRoomId = hostEntry.session.roomId;
      if (!hostRoomId) {
        this.showError("Host room ID not available yet");
        this.removePlayer(playerId);
        return;
      }
      session.joinRoom(hostRoomId, hostEntry.id)
        .then(async () => {
          // In Mesh topology, also connect to all other peers (not just host)
          if (this.topology === Topology.Mesh) {
            for (const [id, otherEntry] of this.players) {
              if (id !== hostEntry.id && id !== playerId) {
                // Connect both ways for peer-to-peer
                await transport.connect(id);
                await otherEntry.transport.connect(playerId);
              }
            }
          }
          // Flush transports to complete handshake
          // Multiple flushes needed for multi-hop delivery in Star topology
          this.flushAllTransports();
        })
        .catch((error) => {
          this.showError(`Failed to join room: ${error.message}`);
          this.removePlayer(playerId);
        });
    }

    // Set as active if first player
    if (isHost) {
      this.setActivePlayer(playerId);
    }
  }

  /**
   * Get the host player entry (first player added).
   */
  private getHostEntry(): PlayerEntry | undefined {
    return this.players.values().next().value;
  }

  /**
   * Get spawn position for a player based on their ID.
   * Player IDs are "player-N" where N is 1-indexed.
   */
  private getSpawnPosition(playerId: string): { x: number; y: number } {
    // Parse player number from ID (e.g., "player-3" -> 3)
    const match = playerId.match(/player-(\d+)/);
    const playerNum = match ? parseInt(match[1], 10) : 1;
    // Convert to 0-indexed and wrap around spawn positions array
    const index = (playerNum - 1) % SPAWN_POSITIONS.length;
    const pos = SPAWN_POSITIONS[index];
    return {
      x: pos.x * CANVAS_WIDTH,
      y: pos.y * CANVAS_HEIGHT,
    };
  }

  /**
   * Show an error message to the user.
   */
  private showError(message: string): void {
    console.error(message);
    // Could also show a toast/modal in a production app
    alert(message);
  }

  /**
   * Remove a player from the demo.
   */
  removePlayer(playerId: string): void {
    const entry = this.players.get(playerId);
    if (!entry) return;

    // Check if removing host
    const isHost = this.players.values().next().value?.id === playerId;

    // Destroy session and clean up
    entry.session.destroy();
    entry.panel.remove();
    this.players.delete(playerId);

    // Unlink transport from all others
    for (const other of this.players.values()) {
      LocalTransport.unlink(entry.transport, other.transport);
    }

    // If host was removed, reset everything
    if (isHost) {
      this.reset();
      return;
    }

    // Update active player if needed
    if (this.activePlayerId === playerId) {
      const firstPlayer = this.players.keys().next().value;
      if (firstPlayer) {
        this.setActivePlayer(firstPlayer);
      } else {
        this.activePlayerId = null;
      }
    }

    // Flush to propagate leave messages
    this.flushAllTransports();
    this.updateAddPlayerButton();
  }

  /**
   * Create the UI panel for a player.
   */
  private createPlayerPanel(playerId: string, isHost: boolean): {
    panel: HTMLElement;
    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;
    statsEl: HTMLElement;
  } {
    const container = document.getElementById("players-container")!;

    const panel = document.createElement("div");
    panel.className = "player-panel";
    panel.dataset.playerId = playerId;

    const header = document.createElement("div");
    header.className = "player-header";
    header.innerHTML = `
      <div class="player-info">
        <span class="player-name">${playerId}${isHost ? " (host)" : ""}</span>
        <span class="player-stats"></span>
      </div>
      <div class="player-buttons">
        <button class="btn-desync">Desync</button>
        <button class="btn-disconnect">Disconnect</button>
      </div>
    `;

    const statsEl = header.querySelector(".player-stats") as HTMLElement;

    const canvas = document.createElement("canvas");
    canvas.width = CANVAS_WIDTH;
    canvas.height = CANVAS_HEIGHT;
    canvas.className = "game-canvas";

    // Click to make active
    canvas.addEventListener("click", () => {
      this.setActivePlayer(playerId);
    });

    // Button handlers
    header.querySelector(".btn-desync")!.addEventListener("click", (e) => {
      e.stopPropagation();
      this.induceDesync(playerId);
    });

    header.querySelector(".btn-disconnect")!.addEventListener("click", (e) => {
      e.stopPropagation();
      this.removePlayer(playerId);
    });

    panel.appendChild(header);
    panel.appendChild(canvas);
    container.appendChild(panel);

    const ctx = canvas.getContext("2d")!;

    return { panel, canvas, ctx, statsEl };
  }

  /**
   * Set the active player (receives keyboard input).
   */
  private setActivePlayer(playerId: string): void {
    // Remove active class from all panels
    document.querySelectorAll(".player-panel").forEach((p) => {
      p.classList.remove("active");
    });

    // Add active class to selected panel
    const entry = this.players.get(playerId);
    if (entry) {
      entry.panel.classList.add("active");
      this.activePlayerId = playerId;
    }
  }

  /**
   * Induce a desync on a player's game instance.
   */
  private induceDesync(playerId: string): void {
    const entry = this.players.get(playerId);
    if (entry) {
      entry.game.induceDesync();
    }
  }

  /**
   * Show visual feedback when a desync is detected.
   */
  private showDesyncFeedback(
    playerId: string,
    tick: number,
    localHash: number,
    remoteHash: number
  ): void {
    const entry = this.players.get(playerId);
    if (!entry) return;

    // Flash the panel red
    entry.panel.classList.add("desync");
    setTimeout(() => {
      entry.panel.classList.remove("desync");
    }, 500);

    // Log to console
    console.warn(
      `Desync detected for ${playerId} at tick ${tick}: local=${localHash}, remote=${remoteHash}`
    );
  }

  /**
   * Flush all transports to deliver pending messages.
   *
   * Multiple iterations are needed because in Star topology, a message
   * from player A to player B goes: A → Host → B (2 hops).
   * Each flush() only delivers messages queued at that moment.
   */
  private flushAllTransports(): void {
    for (let i = 0; i < FLUSH_ITERATIONS; i++) {
      for (const entry of this.players.values()) {
        entry.transport.flush();
      }
    }
  }

  /**
   * Start the game loop.
   */
  private startGameLoop(): void {
    if (this.running) return;
    this.running = true;
    this.lastTickTime = performance.now();
    requestAnimationFrame((t) => this.gameLoop(t));
  }

  /**
   * Main game loop with fixed timestep.
   */
  private gameLoop(currentTime: number): void {
    if (!this.running || this.players.size === 0) {
      this.running = false;
      return;
    }

    const deltaTime = currentTime - this.lastTickTime;
    this.lastTickTime = currentTime;
    this.accumulator += deltaTime;

    // Fixed timestep updates
    while (this.accumulator >= TICK_MS) {
      this.tick();
      this.accumulator -= TICK_MS;
    }

    // Render
    this.render();

    requestAnimationFrame((t) => this.gameLoop(t));
  }

  /**
   * Advance all sessions by one tick.
   *
   * When latency is 0, we interleave flushes between player ticks to ensure
   * zero-latency message delivery. When latency is configured, we use
   * time-based delivery to simulate realistic network conditions.
   */
  private tick(): void {
    const input = this.getInput();
    this.tickCounter++;

    // Trigger keepalive pings periodically for RTT measurement
    const shouldPing = this.tickCounter % KEEPALIVE_INTERVAL_TICKS === 0;

    if (this.simulatedLatency === 0) {
      // Zero-latency mode: interleave flushes for instant delivery
      this.flushAllTransportsOnce();

      for (const entry of this.players.values()) {
        const playerInput = entry.id === this.activePlayerId ? input : new Uint8Array([0]);
        const result = entry.session.tick(playerInput);
        this.trackRollback(entry, result);
        this.flushAllTransportsOnce();
      }

      // Send pings for RTT measurement (RTT will be ~0 in zero-latency mode)
      if (shouldPing) {
        this.sendPingsToHost();
        this.flushAllTransportsOnce();
      }
    } else {
      // Simulated latency mode: use time-based delivery
      // Advance transport time and deliver due messages
      for (const entry of this.players.values()) {
        entry.transport.tick(TICK_MS);
      }

      // Send pings for RTT measurement
      if (shouldPing) {
        this.sendPingsToHost();
      }

      // Tick all sessions
      for (const entry of this.players.values()) {
        const playerInput = entry.id === this.activePlayerId ? input : new Uint8Array([0]);
        const result = entry.session.tick(playerInput);
        this.trackRollback(entry, result);
      }
    }
  }

  /**
   * Track rollback events and update stats.
   */
  private trackRollback(
    entry: PlayerEntry,
    result: { rolledBack: boolean; rollbackTicks?: number }
  ): void {
    if (result.rolledBack) {
      entry.rollbackCount++;
    }
  }

  /**
   * Send pings from all non-host players to the host for RTT measurement.
   */
  private sendPingsToHost(): void {
    const hostEntry = this.getHostEntry();
    if (!hostEntry) return;

    for (const entry of this.players.values()) {
      if (entry.id !== hostEntry.id) {
        // Non-host players ping the host
        entry.session.sendPing(hostEntry.id);
      }
    }
  }

  /**
   * Flush all transports once (single pass).
   */
  private flushAllTransportsOnce(): void {
    for (const entry of this.players.values()) {
      entry.transport.flush();
    }
  }

  /**
   * Render all game views and update stats.
   */
  private render(): void {
    for (const entry of this.players.values()) {
      entry.game.draw(entry.ctx, entry.id);
      this.updateStats(entry);
    }
  }

  /**
   * Update the stats display for a player.
   * Always shows two lines: RTT and Rollbacks.
   */
  private updateStats(entry: PlayerEntry): void {
    const hostEntry = this.getHostEntry();
    const isHost = hostEntry?.id === entry.id;

    // Line 1: RTT (host shows "-", clients show actual RTT or "-" if not yet measured)
    let rttText: string;
    if (isHost) {
      rttText = "RTT: -";
    } else if (hostEntry) {
      const rtt = entry.session.getRtt(hostEntry.id);
      rttText = rtt > 0 ? `RTT: ${Math.round(rtt)}ms` : "RTT: -";
    } else {
      rttText = "RTT: -";
    }

    // Line 2: Rollbacks (always show, even if 0)
    const rollbackText = `Rollbacks: ${entry.rollbackCount}`;

    entry.statsEl.innerHTML = `${rttText}<br>${rollbackText}`;
  }
}

// Initialize demo when DOM is ready
document.addEventListener("DOMContentLoaded", () => {
  const dm = new DemoManager();
  // Expose for debugging
  (window as any).dm = dm;
});
