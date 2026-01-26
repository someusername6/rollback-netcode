# Rollback Netcode

[![npm version](https://img.shields.io/npm/v/rollback-netcode)](https://www.npmjs.com/package/rollback-netcode)
[![license](https://img.shields.io/npm/l/rollback-netcode)](https://github.com/someusername6/rollback-netcode/blob/main/LICENSE)

> **Note:** This library is under active development. APIs may change.

A TypeScript library for P2P rollback netcode in browser-based multiplayer games. Supports 4+ players with WebRTC—no dedicated server required.

**Written in TypeScript with full type definitions included.**

**[Live Demo](https://someusername6.github.io/rollback-netcode)** - Try the library without installing anything

## Features

- **Rollback netcode** - Simulate optimistically, rollback and resimulate on misprediction
- **N-player support** - 4+ players, not hardcoded to 2
- **P2P networking** - WebRTC DataChannels, works in any modern browser
- **Dynamic join/leave** - Players can join or leave during gameplay
- **Transport-agnostic** - WebRTC default, or bring your own transport
- **Topology options** - P2P mesh or star-through-host
- **Desync detection** - Periodic state hashing with automatic recovery
- **Large message support** - Built-in compression and segmentation for state sync
- **Bandwidth efficient** - Only inputs transmitted during gameplay; state sync only on join/desync

## Installation

```bash
npm install rollback-netcode
```

## Quick Start

### 1. Implement the Game Interface

Your game must implement four methods:

```typescript
import { Game, PlayerId } from 'rollback-netcode';

class MyGame implements Game {
  private state = { x: 100, y: 100 };

  // Save game state to bytes
  serialize(): Uint8Array {
    const buffer = new ArrayBuffer(8);
    const view = new DataView(buffer);
    view.setFloat32(0, this.state.x);
    view.setFloat32(4, this.state.y);
    return new Uint8Array(buffer);
  }

  // Restore game state from bytes
  deserialize(data: Uint8Array): void {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    this.state.x = view.getFloat32(0);
    this.state.y = view.getFloat32(4);
  }

  // Advance simulation by one tick
  step(inputs: Map<PlayerId, Uint8Array>): void {
    for (const [playerId, input] of inputs) {
      // input[0] could be a bitmask of pressed keys
      if (input[0] & 0x01) this.state.x -= 5;  // left
      if (input[0] & 0x02) this.state.x += 5;  // right
      if (input[0] & 0x04) this.state.y -= 5;  // up
      if (input[0] & 0x08) this.state.y += 5;  // down
    }
  }

  // Hash state for desync detection
  hash(): number {
    return Math.floor(this.state.x * 1000 + this.state.y);
  }
}
```

### 2. Create a Session

```typescript
import { createSession, WebRTCTransport } from 'rollback-netcode';

const game = new MyGame();

// Create transport with signaling callbacks
const transport = new WebRTCTransport('my-player-id', {
  onSignal: async (peerId, signal) => {
    // Send signal to peer via your signaling server
    await signalingServer.send(peerId, signal);
  }
});

// Handle incoming signals from your signaling server
signalingServer.onSignal((fromPeerId, signal) => {
  transport.handleSignal(fromPeerId, signal);
});

// Create session
const session = createSession({ game, transport });

// Listen for events
session.on('playerJoined', (player) => console.log(`${player.id} joined`));
session.on('playerLeft', (player) => console.log(`${player.id} left`));
session.on('desync', () => console.log('Desync detected, recovering...'));
```

### 3. Host or Join a Room

```typescript
// Host creates a room
const roomId = await session.createRoom();
console.log(`Room created: ${roomId}`);

// Other players join (need to know the host's peer ID)
await session.joinRoom(roomId, hostPeerId);
```

### 4. Run the Game Loop

```typescript
// Host starts the game when ready
session.start();

// Game loop (call at your tick rate, e.g., 60 FPS)
function gameLoop() {
  // Capture local input
  const input = new Uint8Array([
    (keys.left  ? 0x01 : 0) |
    (keys.right ? 0x02 : 0) |
    (keys.up    ? 0x04 : 0) |
    (keys.down  ? 0x08 : 0)
  ]);

  // Advance simulation (handles networking, rollback, etc.)
  session.tick(input);

  // Render your game
  render(game);

  requestAnimationFrame(gameLoop);
}

gameLoop();
```

## Using TransformingTransport

For games with large state (>16KB), wrap your transport with `TransformingTransport` to add compression and message segmentation:

```typescript
import {
  createSession,
  WebRTCTransport,
  TransformingTransport
} from 'rollback-netcode';

const webrtc = new WebRTCTransport('my-player-id', { onSignal });

// Wrap with compression and segmentation
const transport = new TransformingTransport(webrtc, {
  compression: 'auto',        // 'auto' | 'always' | 'never'
  compressionThreshold: 128,  // Only compress messages > 128 bytes
  maxSegmentSize: 16000,      // Split messages larger than this
});

const session = createSession({ game, transport });
```

## API Overview

### Session

```typescript
// Create a session
const session = createSession({
  game: Game,                    // Your game implementation
  transport: TransportAdapter,   // WebRTCTransport, LocalTransport, etc.
  config?: SessionConfig,        // Optional configuration
});

// Session methods
session.createRoom()             // Host a new room
session.joinRoom(roomId, hostPeerId)  // Join existing room
session.start()                  // Begin gameplay (host only)
session.tick(localInput)         // Advance simulation
session.pause()                  // Pause game (host only)
session.resume()                 // Resume game (host only)
session.leaveRoom()              // Leave current room

// Session properties
session.state                    // 'disconnected' | 'lobby' | 'playing' | 'paused'
session.isHost                   // Whether local player is host
session.localPlayerId            // Local player's ID
session.players                  // Map of connected players
session.currentTick              // Current simulation tick
```

### Events

```typescript
session.on('stateChange', (newState, oldState) => {});
session.on('playerJoined', (playerInfo) => {});
session.on('playerLeft', (playerInfo) => {});
session.on('gameStart', () => {});
session.on('desync', (tick, localHash, remoteHash) => {});
session.on('error', (error, context) => {});
session.on('lagReport', (laggyPlayerId, ticksBehind) => {});
session.on('resumeCountdown', (secondsRemaining) => {});
session.on('playerDropped', (playerId, metadata?) => {});
```

### Configuration

```typescript
const session = createSession({
  game,
  transport,
  config: {
    maxPlayers: 4,              // Maximum players allowed
    tickRate: 60,               // Ticks per second
    snapshotHistorySize: 120,   // Ticks of history to keep
    hashInterval: 60,           // Ticks between hash checks
    disconnectTimeout: 5000,    // Ms before disconnecting idle peer
    topology: Topology.Star,    // Star (through host) or Mesh (direct)
  }
});
```

### Transports

```typescript
// WebRTC for production
import { WebRTCTransport } from 'rollback-netcode';
const transport = new WebRTCTransport(localPeerId, {
  onSignal: async (peerId, signal) => { /* send via signaling server */ },
  rtcConfig: {
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
  }
});

// LocalTransport for testing
import { LocalTransport, createLocalTransportGroup } from 'rollback-netcode';
const transports = createLocalTransportGroup(['p1', 'p2', 'p3'], {
  latency: 50,      // Simulated latency (ms)
  jitter: 10,       // Latency variation (ms)
  packetLoss: 0.01  // 1% packet loss
});
const t1 = transports.get('p1')!;
const t2 = transports.get('p2')!;
const t3 = transports.get('p3')!;

// TransformingTransport for large messages
import { TransformingTransport } from 'rollback-netcode';
const transport = new TransformingTransport(innerTransport, {
  compression: 'auto',
  maxSegmentSize: 16000
});
```

## Testing Your Game

Use `LocalTransport` for deterministic testing without real network connections:

```typescript
import {
  createSession,
  LocalTransport,
  createLocalTransportGroup,
} from 'rollback-netcode';

// Create linked transports with simulated latency
const transports = createLocalTransportGroup(['host', 'client'], {
  latency: 50,  // 50ms one-way latency
});
const t1 = transports.get('host')!;
const t2 = transports.get('client')!;

// Create your game instances
const hostGame = new MyGame();
const clientGame = new MyGame();

// Create sessions
const hostSession = createSession({ game: hostGame, transport: t1 });
const clientSession = createSession({ game: clientGame, transport: t2 });

// Set up room
await hostSession.createRoom();
await clientSession.joinRoom('room', 'host');
hostSession.start();

// Simulate ticks - flush transports to deliver messages
for (let i = 0; i < 100; i++) {
  hostSession.tick(new Uint8Array([1]));
  clientSession.tick(new Uint8Array([2]));
  // Advance time and deliver messages
  t1.tick(16);  // Simulate 16ms passing
  t2.tick(16);
}

// Verify state matches
assert(hostGame.hash() === clientGame.hash(), 'States should match');
```

## FAQ

### Do I need a signaling server?

Yes. WebRTC requires a signaling mechanism to exchange connection information between peers. The library does not include a signaling server—you provide one. Options include:

- Firebase Realtime Database
- A simple WebSocket server
- Any pub/sub service (Pusher, Ably, etc.)

### Does my game need to be deterministic?

Yes. Given the same inputs, your game must produce the same state on all clients. Common sources of non-determinism:
- `Math.random()` - Use a seeded PRNG instead
- `Date.now()` - Use tick count for timing
- Object iteration order - Use `Map` for consistent ordering
- Floating point differences - Usually not an issue in JavaScript

### What happens if a player has high latency?

The rollback algorithm handles latency automatically. High-latency players will see more frequent rollbacks (visual corrections) but gameplay continues smoothly for everyone. If a player falls too far behind, the game can pause to let them catch up.

### How large can my game state be?

With `TransformingTransport`, states up to ~64MB are supported (compressed and segmented). For best performance, keep serialized state under a few hundred KB. Consider delta compression for large states.

### How much bandwidth does it use?

During normal gameplay, only player inputs are transmitted—not world state. This keeps bandwidth proportional to player count, not world complexity (number of entities, physics objects, etc.). Full state is only sent during:
- Initial state sync when a player joins
- Desync recovery (rare with deterministic simulation)

### Can I use this with my favorite game framework?

Yes. The library is framework-agnostic. It works with:
- Vanilla Canvas/WebGL
- PixiJS
- Phaser
- Three.js
- Any framework that supports a fixed timestep

## Requirements

- Node.js >= 22.0.0 (for development)
- Modern browser with WebRTC support (for production):
  - Chrome 56+
  - Firefox 44+
  - Safari 11+
  - Edge 79+

### Dependencies

- **[pako](https://github.com/nodeca/pako)** - Used by `TransformingTransport` for gzip compression

## Documentation

- [Architecture](docs/architecture.md) - Technical design and components
- [Configuration Tuning](docs/configuration-tuning.md) - Performance tuning guide

## License

MIT
