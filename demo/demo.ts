/**
 * Demo page for rollback-netcode library.
 *
 * Simulates multiple players locally to demonstrate the library's features
 * without requiring real network connections.
 */

import { createSession, LocalTransport, Topology, DesyncAuthority } from "../src/index.js";
import type { Session } from "../src/session/session.js";
import { DotGame, Input, CANVAS_WIDTH, CANVAS_HEIGHT } from "./game.js";

/** Tick rate in Hz */
const TICK_RATE = 60;
const TICK_MS = 1000 / TICK_RATE;

interface PlayerEntry {
  id: string;
  session: Session;
  game: DotGame;
  transport: LocalTransport;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  panel: HTMLElement;
}

/**
 * Manages the demo, orchestrating multiple local players.
 */
class DemoManager {
  players: Map<string, PlayerEntry> = new Map();
  activePlayerId: string | null = null;
  private pressedKeys: Set<string> = new Set();
  private playerCounter = 0;
  private lastTickTime = 0;
  private accumulator = 0;
  private running = false;

  private topology: Topology = Topology.Star;
  private desyncAuthority: DesyncAuthority = DesyncAuthority.Host;
  private simulatedLatency: number = 0;

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
    const addPlayerBtn = document.getElementById("add-player") as HTMLButtonElement;

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

    addPlayerBtn.addEventListener("click", () => {
      this.addPlayer();
    });
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
   */
  addPlayer(): void {
    const playerId = `player-${++this.playerCounter}`;
    const isHost = this.players.size === 0;

    // Create transport with simulated latency
    const transport = new LocalTransport(playerId, {
      latency: this.simulatedLatency,
      jitter: Math.floor(this.simulatedLatency * 0.2), // 20% jitter
    });

    // Link transport based on topology
    if (!isHost) {
      const hostEntry = this.players.values().next().value as PlayerEntry;
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

    // Create game instance
    const game = new DotGame();

    // Create session
    const session = createSession({
      game,
      transport,
      localPlayerId: playerId as any,
      config: {
        topology: this.topology,
        desyncAuthority: this.desyncAuthority,
        tickRate: TICK_RATE,
        hashInterval: 30,
      },
    });

    // Handle player join/leave events
    session.on("playerJoined", (info) => {
      game.addPlayer(info.id);
    });

    session.on("playerLeft", (info) => {
      game.removePlayer(info.id);
    });

    // Handle desync detection
    session.on("desync", (tick, localHash, remoteHash) => {
      this.showDesyncFeedback(playerId, tick, localHash, remoteHash);
    });

    // Create UI
    const { panel, canvas, ctx } = this.createPlayerPanel(playerId, isHost);

    // Store player entry
    const entry: PlayerEntry = {
      id: playerId,
      session,
      game,
      transport,
      canvas,
      ctx,
      panel,
    };
    this.players.set(playerId, entry);

    // Set up room
    if (isHost) {
      session.createRoom().then(() => {
        game.addPlayer(playerId);
        session.start();
        this.startGameLoop();
      });
    } else {
      const hostEntry = this.players.values().next().value as PlayerEntry;
      const hostRoomId = hostEntry.session.roomId;
      if (!hostRoomId) {
        console.error("Host room ID not available");
        return;
      }
      session.joinRoom(hostRoomId, hostEntry.id).then(async () => {
        // In Mesh topology, also connect to all other peers (not just host)
        if (this.topology === Topology.Mesh) {
          for (const [id, entry] of this.players) {
            if (id !== hostEntry.id && id !== playerId) {
              // Connect both ways for peer-to-peer
              await transport.connect(id);
              await entry.transport.connect(playerId);
            }
          }
        }
        // Flush transports to complete handshake
        this.flushAllTransports();
      });
    }

    // Set as active if first player
    if (isHost) {
      this.setActivePlayer(playerId);
    }
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
  }

  /**
   * Create the UI panel for a player.
   */
  private createPlayerPanel(playerId: string, isHost: boolean): {
    panel: HTMLElement;
    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;
  } {
    const container = document.getElementById("players-container")!;

    const panel = document.createElement("div");
    panel.className = "player-panel";
    panel.dataset.playerId = playerId;

    const header = document.createElement("div");
    header.className = "player-header";
    header.innerHTML = `
      <span class="player-name">${playerId}${isHost ? " (host)" : ""}</span>
      <div class="player-buttons">
        <button class="btn-desync">Induce Desync</button>
        <button class="btn-disconnect">Disconnect</button>
      </div>
    `;

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

    return { panel, canvas, ctx };
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
   */
  private flushAllTransports(): void {
    for (let i = 0; i < 5; i++) {
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
    if (this.simulatedLatency === 0) {
      // Zero-latency mode: interleave flushes for instant delivery
      this.flushAllTransportsOnce();

      const input = this.getInput();
      for (const entry of this.players.values()) {
        const playerInput = entry.id === this.activePlayerId ? input : new Uint8Array([0]);
        entry.session.tick(playerInput);
        this.flushAllTransportsOnce();
      }
    } else {
      // Simulated latency mode: use time-based delivery
      // Advance transport time and deliver due messages
      for (const entry of this.players.values()) {
        entry.transport.tick(TICK_MS);
      }

      // Tick all sessions
      const input = this.getInput();
      for (const entry of this.players.values()) {
        const playerInput = entry.id === this.activePlayerId ? input : new Uint8Array([0]);
        entry.session.tick(playerInput);
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
   * Render all game views.
   */
  private render(): void {
    for (const entry of this.players.values()) {
      entry.game.draw(entry.ctx, entry.id);
    }
  }
}

// Initialize demo when DOM is ready
document.addEventListener("DOMContentLoaded", () => {
  const dm = new DemoManager();
  // Expose for debugging
  (window as any).dm = dm;
});
