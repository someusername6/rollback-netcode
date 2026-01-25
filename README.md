# Rollback Netcode

A TypeScript library for P2P rollback netcode in browser-based multiplayer games. Supports 4+ players with WebRTC—no dedicated server required.

## Features

- **Rollback netcode** - Simulate optimistically, rollback and resimulate on misprediction
- **N-player support** - 4+ players, not hardcoded to 2
- **P2P networking** - WebRTC DataChannels, works in any modern browser
- **Dynamic join/leave** - Players can join or leave during gameplay
- **Transport-agnostic** - WebRTC default, or bring your own transport
- **Topology options** - P2P mesh or star-through-host
- **Desync detection** - Periodic state hashing with automatic recovery
- **Large message support** - Built-in compression and segmentation for state sync

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
session.on('playerJoined', (playerId) => console.log(`${playerId} joined`));
session.on('playerLeft', (playerId) => console.log(`${playerId} left`));
session.on('desync', () => console.log('Desync detected, recovering...'));
```

### 3. Host or Join a Room

```typescript
// Host creates a room
const roomId = await session.createRoom({ maxPlayers: 4 });
console.log(`Room created: ${roomId}`);

// Other players join
await session.joinRoom(roomId, hostPeerId);
```

### 4. Run the Game Loop

```typescript
// Host starts the game when ready
session.startGame();

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
session.createRoom(options?)     // Host a new room
session.joinRoom(roomId, hostPeerId)  // Join existing room
session.startGame()              // Begin gameplay (host only)
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
session.on('playerJoined', (playerId, playerInfo) => {});
session.on('playerLeft', (playerId, reason) => {});
session.on('gameStart', (tick) => {});
session.on('desync', (tick, localHash, remoteHash) => {});
session.on('rollback', (fromTick, toTick) => {});
session.on('error', (error, context) => {});
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
const [t1, t2, t3] = createLocalTransportGroup(['p1', 'p2', 'p3'], {
  latency: 50,      // Simulated latency (ms)
  jitter: 10,       // Latency variation (ms)
  packetLoss: 0.01  // 1% packet loss
});

// TransformingTransport for large messages
import { TransformingTransport } from 'rollback-netcode';
const transport = new TransformingTransport(innerTransport, {
  compression: 'auto',
  maxSegmentSize: 16000
});
```

## Testing Your Game

The library provides utilities for testing:

```typescript
import {
  TestGame,
  createTestSession,
  LocalTransport,
  createLocalTransportGroup,
  flushAllTransports
} from 'rollback-netcode';

// Create linked transports
const [t1, t2] = createLocalTransportGroup(['host', 'client']);

// Create sessions
const hostSession = createTestSession({ transport: t1 });
const clientSession = createTestSession({ transport: t2 });

// Set up game
await hostSession.session.createRoom();
await clientSession.session.joinRoom('room', 'host');
hostSession.session.startGame();

// Simulate ticks
for (let i = 0; i < 100; i++) {
  hostSession.session.tick(new Uint8Array([1]));
  clientSession.session.tick(new Uint8Array([2]));
  flushAllTransports([t1, t2]);
}

// Verify state matches
const hostHash = hostSession.game.hash();
const clientHash = clientSession.game.hash();
assert(hostHash === clientHash, 'States should match');
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

### Can I use this with my favorite game framework?

Yes. The library is framework-agnostic. It works with:
- Vanilla Canvas/WebGL
- PixiJS
- Phaser
- Three.js
- Any framework that supports a fixed timestep

## Requirements

- Node.js >= 22.0.0 (for development)
- Modern browser with WebRTC support (for production)

### Dependencies

- **[pako](https://github.com/nodeca/pako)** - Used by `TransformingTransport` for gzip compression

## Documentation

- [Architecture](docs/architecture.md) - Technical design and components
- [Configuration Tuning](docs/configuration-tuning.md) - Performance tuning guide

## License

MIT
