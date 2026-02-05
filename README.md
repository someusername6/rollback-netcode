# Rollback Netcode

[![npm version](https://img.shields.io/npm/v/rollback-netcode)](https://www.npmjs.com/package/rollback-netcode)
[![license](https://img.shields.io/npm/l/rollback-netcode)](https://github.com/someusername6/rollback-netcode/blob/main/LICENSE)

> **Note:** This library is under active development. APIs may change.

A TypeScript library for P2P rollback netcode in browser-based multiplayer games. Supports 4+ players with WebRTC—no dedicated server required.

**[Live Demo](https://someusername6.github.io/rollback-netcode)** | **[API Reference](docs/api.md)** | **[FAQ](docs/faq.md)**

## Features

- **Rollback netcode** - Simulate optimistically, rollback and resimulate on misprediction
- **N-player support** - 4+ players, not limited to 2
- **P2P networking** - WebRTC DataChannels, works in any modern browser
- **Dynamic join/leave** - Players can join or leave during gameplay
- **Desync detection** - Periodic state hashing with automatic recovery
- **Transport-agnostic** - WebRTC included, or bring your own

## Installation

```bash
npm install rollback-netcode
```

## Quick Start

### 1. Implement the Game Interface

Your game must implement four methods:

```typescript
import type { Game, PlayerId } from 'rollback-netcode';

class MyGame implements Game {
  private state = { x: 100, y: 100 };

  serialize(): Uint8Array {
    const buffer = new ArrayBuffer(8);
    const view = new DataView(buffer);
    view.setFloat32(0, this.state.x);
    view.setFloat32(4, this.state.y);
    return new Uint8Array(buffer);
  }

  deserialize(data: Uint8Array): void {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    this.state.x = view.getFloat32(0);
    this.state.y = view.getFloat32(4);
  }

  step(inputs: Map<PlayerId, Uint8Array>): void {
    for (const [, input] of inputs) {
      if (input[0] & 0x01) this.state.x -= 5;  // left
      if (input[0] & 0x02) this.state.x += 5;  // right
      if (input[0] & 0x04) this.state.y -= 5;  // up
      if (input[0] & 0x08) this.state.y += 5;  // down
    }
  }

  hash(): number {
    return Math.floor(this.state.x * 1000 + this.state.y);
  }
}
```

### 2. Create a Session

```typescript
import { createSession, WebRTCTransport } from 'rollback-netcode';

const transport = new WebRTCTransport('my-player-id');

transport.setSignalingCallbacks({
  onSignal: (peerId, signal) => {
    // Send signal to peer via your signaling server
    signalingServer.send(peerId, signal);
  }
});

// Handle incoming signals from your signaling server
signalingServer.onSignal((fromPeerId, signal) => {
  if (signal.type === 'description') {
    transport.handleRemoteDescription(fromPeerId, signal.description);
  } else {
    transport.handleRemoteCandidate(fromPeerId, signal.candidate);
  }
});

const session = createSession({ game: new MyGame(), transport });

session.on('playerJoined', (player) => console.log(`${player.id} joined`));
session.on('desync', () => console.log('Desync detected, recovering...'));
```

### 3. Host or Join

```typescript
// Host creates a room
const roomId = await session.createRoom();

// Others join
await session.joinRoom(roomId, hostPeerId);
```

### 4. Game Loop

```typescript
session.start();  // Host only

function gameLoop() {
  const input = new Uint8Array([
    (keys.left  ? 0x01 : 0) |
    (keys.right ? 0x02 : 0) |
    (keys.up    ? 0x04 : 0) |
    (keys.down  ? 0x08 : 0)
  ]);

  session.tick(input);
  render(game);
  requestAnimationFrame(gameLoop);
}
```

## Examples

See the [`examples/`](examples/) directory:

- **[local-transport](examples/local-transport/)** - Browser demo using simulated network (no server needed)
- **[webrtc](examples/webrtc/)** - Real WebRTC connections with a minimal signaling server

## Documentation

- [API Reference](docs/api.md) - Full API documentation
- [FAQ](docs/faq.md) - Common questions answered
- [Architecture](docs/architecture.md) - Technical design and components
- [Configuration Tuning](docs/configuration-tuning.md) - Performance tuning guide

## Requirements

- Node.js >= 22.0.0 (development)
- Modern browser with WebRTC (Chrome 56+, Firefox 44+, Safari 11+, Edge 79+)

## License

[MIT](LICENSE)
