/**
 * WebRTC Local Demo - Client
 *
 * This demonstrates how to use WebRTCTransport with a signaling server.
 * Open multiple browser tabs to simulate multiple players.
 *
 * Usage:
 * 1. Start the signaling server: npx tsx server.ts
 * 2. Open index.html in multiple browser tabs
 * 3. First tab creates the room (becomes host)
 * 4. Other tabs join by entering the room ID
 */

import {
  createSession,
  WebRTCTransport,
  type Session,
  type Game,
  type PlayerId,
} from "../../dist/index.js";

// =============================================================================
// Game Implementation (same as main demo)
// =============================================================================

const CANVAS_WIDTH = 300;
const CANVAS_HEIGHT = 200;
const PLAYER_COLORS = ["#e74c3c", "#3498db", "#2ecc71", "#f1c40f"];
const MOVE_SPEED = 3;

interface PlayerState {
  x: number;
  y: number;
  color: string;
}

class DotGame implements Game {
  players: Map<PlayerId, PlayerState> = new Map();
  private playerOrder: PlayerId[] = [];

  addPlayer(playerId: PlayerId): void {
    if (this.players.has(playerId)) return;
    const colorIndex = this.players.size % PLAYER_COLORS.length;
    this.players.set(playerId, {
      x: 50 + Math.random() * (CANVAS_WIDTH - 100),
      y: 50 + Math.random() * (CANVAS_HEIGHT - 100),
      color: PLAYER_COLORS[colorIndex]!,
    });
    this.playerOrder.push(playerId);
    this.playerOrder.sort();
  }

  removePlayer(playerId: PlayerId): void {
    this.players.delete(playerId);
    this.playerOrder = this.playerOrder.filter((id) => id !== playerId);
  }

  serialize(): Uint8Array {
    const playerCount = this.players.size;
    const buffer = new ArrayBuffer(1 + playerCount * 6);
    const view = new DataView(buffer);
    view.setUint8(0, playerCount);

    let offset = 1;
    for (const id of this.playerOrder) {
      const state = this.players.get(id);
      if (!state) continue;
      const idNum = parseInt(id.replace("player-", ""), 10) || 0;
      view.setUint8(offset, idNum);
      view.setInt16(offset + 1, Math.round(state.x));
      view.setInt16(offset + 3, Math.round(state.y));
      view.setUint8(offset + 5, PLAYER_COLORS.indexOf(state.color));
      offset += 6;
    }
    return new Uint8Array(buffer);
  }

  deserialize(data: Uint8Array): void {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const playerCount = view.getUint8(0);

    this.players.clear();
    this.playerOrder = [];

    let offset = 1;
    for (let i = 0; i < playerCount; i++) {
      const idNum = view.getUint8(offset);
      const x = view.getInt16(offset + 1);
      const y = view.getInt16(offset + 3);
      const colorIndex = view.getUint8(offset + 5);

      const playerId = `player-${idNum}` as PlayerId;
      this.players.set(playerId, {
        x,
        y,
        color: PLAYER_COLORS[colorIndex] ?? "#ffffff",
      });
      this.playerOrder.push(playerId);
      offset += 6;
    }
    this.playerOrder.sort();
  }

  step(inputs: Map<PlayerId, Uint8Array>): void {
    for (const [playerId, input] of inputs) {
      const state = this.players.get(playerId);
      if (!state || input.length === 0) continue;

      const byte = input[0]!;
      if (byte & 0x01) state.x = Math.max(10, state.x - MOVE_SPEED);
      if (byte & 0x02) state.x = Math.min(CANVAS_WIDTH - 10, state.x + MOVE_SPEED);
      if (byte & 0x04) state.y = Math.max(10, state.y - MOVE_SPEED);
      if (byte & 0x08) state.y = Math.min(CANVAS_HEIGHT - 10, state.y + MOVE_SPEED);
    }
  }

  hash(): number {
    let hash = 0;
    for (const id of this.playerOrder) {
      const state = this.players.get(id);
      if (state) {
        hash = (hash * 31 + Math.round(state.x)) | 0;
        hash = (hash * 31 + Math.round(state.y)) | 0;
      }
    }
    return hash;
  }
}

// =============================================================================
// Signaling Client
// =============================================================================

class SignalingClient {
  private ws: WebSocket | null = null;
  private peerId: string;

  onPeers: ((peers: string[]) => void) | null = null;
  onPeerJoined: ((peerId: string) => void) | null = null;
  onPeerLeft: ((peerId: string) => void) | null = null;
  onSignal: ((fromPeerId: string, signal: unknown) => void) | null = null;

  constructor(peerId: string) {
    this.peerId = peerId;
  }

  connect(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(url);
      this.ws.onopen = () => resolve();
      this.ws.onerror = () => reject(new Error("WebSocket connection failed"));
      this.ws.onmessage = (e) => this.handleMessage(e.data);
    });
  }

  private handleMessage(data: string) {
    const msg = JSON.parse(data);
    switch (msg.type) {
      case "peers":
        this.onPeers?.(msg.peers);
        break;
      case "join":
        this.onPeerJoined?.(msg.peerId);
        break;
      case "leave":
        this.onPeerLeft?.(msg.peerId);
        break;
      case "signal":
        this.onSignal?.(msg.peerId, msg.signal);
        break;
    }
  }

  joinRoom(room: string) {
    this.ws?.send(JSON.stringify({ type: "join", room, peerId: this.peerId }));
  }

  sendSignal(targetPeerId: string, signal: unknown) {
    this.ws?.send(JSON.stringify({ type: "signal", targetPeerId, signal }));
  }

  close() {
    this.ws?.close();
  }
}

// =============================================================================
// Demo Manager
// =============================================================================

class WebRTCDemo {
  private peerId: string;
  private game: DotGame;
  private session: Session | null = null;
  private transport: WebRTCTransport | null = null;
  private signaling: SignalingClient;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private statusEl: HTMLElement;
  private roomEl: HTMLElement;
  private keys = { left: false, right: false, up: false, down: false };
  private running = false;
  private lastTime = 0;
  private accumulator = 0;
  private readonly TICK_MS = 1000 / 60;

  constructor() {
    this.peerId = `player-${Math.floor(Math.random() * 10000)}`;
    this.game = new DotGame();
    this.signaling = new SignalingClient(this.peerId);

    this.canvas = document.getElementById("game-canvas") as HTMLCanvasElement;
    this.ctx = this.canvas.getContext("2d")!;
    this.statusEl = document.getElementById("status")!;
    this.roomEl = document.getElementById("room-id")!;

    this.setupUI();
    this.setupKeyboard();
  }

  private setupUI() {
    document.getElementById("create-btn")!.addEventListener("click", () => this.createRoom());
    document.getElementById("join-btn")!.addEventListener("click", () => this.joinRoom());
    document.getElementById("peer-id")!.textContent = this.peerId;
  }

  private setupKeyboard() {
    window.addEventListener("keydown", (e) => {
      if (e.key === "ArrowLeft" || e.key === "a") this.keys.left = true;
      if (e.key === "ArrowRight" || e.key === "d") this.keys.right = true;
      if (e.key === "ArrowUp" || e.key === "w") this.keys.up = true;
      if (e.key === "ArrowDown" || e.key === "s") this.keys.down = true;
    });
    window.addEventListener("keyup", (e) => {
      if (e.key === "ArrowLeft" || e.key === "a") this.keys.left = false;
      if (e.key === "ArrowRight" || e.key === "d") this.keys.right = false;
      if (e.key === "ArrowUp" || e.key === "w") this.keys.up = false;
      if (e.key === "ArrowDown" || e.key === "s") this.keys.down = false;
    });
  }

  private setStatus(text: string) {
    this.statusEl.textContent = text;
  }

  private async initTransportAndSession() {
    // Create WebRTC transport
    this.transport = new WebRTCTransport(this.peerId, {
      onSignal: (targetPeerId, signal) => {
        this.signaling.sendSignal(targetPeerId, signal);
      },
    });

    // Handle signals from signaling server
    this.signaling.onSignal = (fromPeerId, signal) => {
      this.transport!.handleSignal(fromPeerId, signal as RTCSessionDescriptionInit | RTCIceCandidateInit);
    };

    // Create session
    this.session = createSession({
      game: this.game,
      transport: this.transport,
    });

    // Session event handlers
    this.session.on("playerJoined", (player) => {
      console.log(`Player joined: ${player.id}`);
      this.game.addPlayer(player.id);
    });

    this.session.on("playerLeft", (player) => {
      console.log(`Player left: ${player.id}`);
      this.game.removePlayer(player.id);
    });

    this.session.on("gameStart", () => {
      console.log("Game started!");
      this.setStatus("Playing");
      this.startGameLoop();
    });

    this.session.on("error", (error, context) => {
      console.error(`Error (${context}):`, error);
    });
  }

  async createRoom() {
    try {
      this.setStatus("Connecting to signaling server...");
      await this.signaling.connect("ws://localhost:8080");

      await this.initTransportAndSession();

      const roomId = await this.session!.createRoom();
      this.roomEl.textContent = roomId;
      this.setStatus("Waiting for players... (you are host)");

      // Join signaling room
      this.signaling.joinRoom(roomId);

      // Handle new peers connecting
      this.signaling.onPeerJoined = (peerId) => {
        console.log(`Peer joined signaling: ${peerId}`);
        // Initiate WebRTC connection to new peer
        this.transport!.connect(peerId);
      };

      // Add host as player
      this.game.addPlayer(this.session!.localPlayerId);

      // Auto-start when another player joins
      this.session!.on("playerJoined", () => {
        if (!this.running && this.session!.players.size >= 2) {
          setTimeout(() => {
            if (this.session!.state === "lobby") {
              this.session!.start();
            }
          }, 500);
        }
      });
    } catch (err) {
      this.setStatus(`Error: ${err}`);
    }
  }

  async joinRoom() {
    const roomInput = document.getElementById("room-input") as HTMLInputElement;
    const roomId = roomInput.value.trim();
    if (!roomId) {
      alert("Please enter a room ID");
      return;
    }

    try {
      this.setStatus("Connecting to signaling server...");
      await this.signaling.connect("ws://localhost:8080");

      await this.initTransportAndSession();

      // Join signaling room first to get peer list
      this.signaling.joinRoom(roomId);

      // When we get the peer list, connect to each peer
      this.signaling.onPeers = async (peers) => {
        console.log("Existing peers:", peers);
        for (const peerId of peers) {
          this.transport!.connect(peerId);
        }

        // Wait for WebRTC connections, then join the game session
        setTimeout(async () => {
          try {
            const hostPeerId = peers[0]; // First peer is host
            if (hostPeerId) {
              await this.session!.joinRoom(roomId, hostPeerId);
              this.roomEl.textContent = roomId;
              this.setStatus("Joined room, waiting for host to start...");
            }
          } catch (err) {
            this.setStatus(`Error joining: ${err}`);
          }
        }, 1000);
      };

      // Handle new peers
      this.signaling.onPeerJoined = (peerId) => {
        console.log(`Peer joined signaling: ${peerId}`);
      };
    } catch (err) {
      this.setStatus(`Error: ${err}`);
    }
  }

  private startGameLoop() {
    this.running = true;
    this.lastTime = performance.now();
    requestAnimationFrame((t) => this.gameLoop(t));
  }

  private gameLoop(now: number) {
    if (!this.running) return;

    const delta = now - this.lastTime;
    this.lastTime = now;
    this.accumulator += delta;

    while (this.accumulator >= this.TICK_MS) {
      this.tick();
      this.accumulator -= this.TICK_MS;
    }

    this.render();
    requestAnimationFrame((t) => this.gameLoop(t));
  }

  private tick() {
    const input = new Uint8Array([
      (this.keys.left ? 0x01 : 0) |
        (this.keys.right ? 0x02 : 0) |
        (this.keys.up ? 0x04 : 0) |
        (this.keys.down ? 0x08 : 0),
    ]);
    this.session?.tick(input);
  }

  private render() {
    this.ctx.fillStyle = "#1a1a2e";
    this.ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    for (const [, state] of this.game.players) {
      this.ctx.beginPath();
      this.ctx.arc(state.x, state.y, 10, 0, Math.PI * 2);
      this.ctx.fillStyle = state.color;
      this.ctx.fill();
    }
  }
}

// Start the demo
new WebRTCDemo();
