# Claude Code Instructions

## Project Overview

This is a TypeScript library for P2P rollback netcode in browser-based multiplayer games. The goal is to fill a gap in the ecosystem: no existing JS/TS library combines rollback netcode with 4+ player support.

## Key Documents

- `README.md` - Project overview, quick start, and API reference
- `docs/architecture.md` - Technical design, components, data structures
- `docs/configuration-tuning.md` - Performance tuning guide

**Read these documents before implementing.**

## Development Guidelines

### Code Style
- TypeScript with strict mode
- ESM only (no CommonJS)
- Use Biome for formatting: `npm run lint` and `npm run format`
- No `any` types in public API

### Testing
- Use Node.js built-in test runner (`node:test`)
- Test files: `*.test.ts` alongside source files
- Use `LocalTransport` for deterministic network simulation in tests

### Architecture Principles
1. **Transport-agnostic core** - Rollback engine should not know about WebRTC
2. **Bring your own game** - Library doesn't know about game logic
3. **Minimal interface** - Games implement small interface (serialize, deserialize, step, hash)
4. **Pluggable strategies** - Input prediction, topology, etc. should be configurable
5. **Dynamic players** - Support join/leave during gameplay, not fixed player count

### File Organization

```
src/
  index.ts              # Public API exports
  types.ts              # Shared type definitions
  debug.ts              # Debug logging utilities
  benchmark.ts          # Performance benchmarks
  session/
    session.ts          # Session manager
    topology.ts         # Star/Mesh topology strategies
    player-manager.ts   # Player tracking
    message-router.ts   # Message dispatching
    message-builders.ts # Message construction helpers
    desync-manager.ts   # Desync detection and recovery
    lag-monitor.ts      # Lag detection and reporting
  rollback/
    engine.ts           # Rollback engine
    snapshot-buffer.ts  # Ring buffer for snapshots
    input-buffer.ts     # Per-player input tracking
  transport/
    adapter.ts          # Transport interface
    webrtc.ts           # WebRTC implementation
    local.ts            # Local/mock transport for testing
    transforming.ts     # Compression/segmentation wrapper
  protocol/
    messages.ts         # Message type definitions
    encoding.ts         # Binary encoding/decoding
  utils/
    rate-limiter.ts     # Rate limiting for join requests

tests/
  *.test.ts             # Test files organized by component
  utils/
    test-game.ts        # Test game implementation
    test-helpers.ts     # Shared test utilities

demo/
  index.html            # Demo page
  demo.ts               # Demo logic
  game.ts               # DotGame implementation
  styles.css            # Styling
```

## Implementation Order

Suggested order based on dependencies:

1. **Types and interfaces** - `types.ts`, `protocol/messages.ts`
2. **Snapshot buffer** - `rollback/snapshot-buffer.ts` (no network dependencies)
3. **Input buffer** - `rollback/input-buffer.ts` (no network dependencies)
4. **Local transport** - `transport/local.ts` (for testing)
5. **Rollback engine** - `rollback/engine.ts` (uses buffers, transport interface)
6. **Session manager** - `session/session.ts` (orchestrates everything)
7. **WebRTC transport** - `transport/webrtc.ts` (real network)

## Testing Strategy

### Unit Tests
- Snapshot buffer: save, restore, ring buffer overflow
- Input buffer: receive inputs, track confirmed tick, handle out-of-order
- Rollback engine: detect misprediction, rollback, resimulate

### Integration Tests
- Two "players" with LocalTransport, verify sync
- Inject latency, verify rollback occurs
- Inject packet loss, verify recovery
- Inject desync, verify detection and recovery

### Determinism Tests
- Run identical inputs on two separate engine instances
- Compare final state hashes
- Useful for finding non-determinism bugs

## API Design Notes

The public API should be simple. Example usage:

```typescript
import { createSession, WebRTCTransport } from 'rollback-netcode';

// Game implements this interface
const game: Game = {
  serialize: () => { /* return Uint8Array */ },
  deserialize: (data) => { /* restore state */ },
  step: (inputs) => { /* advance simulation */ },
  hash: () => { /* return number */ },
};

// Create transport with signaling
const transport = new WebRTCTransport('player-1', {
  onSignal: async (peerId, signal) => {
    // Send signal to peer via your signaling server
  }
});

// Create session
const session = createSession({ game, transport });

// Host creates room
const roomId = await session.createRoom();

// Others join
await session.joinRoom(roomId, hostPeerId);

// Host starts the game
session.start();

// Game loop
function tick() {
  const localInput = captureInput();
  session.tick(localInput);  // Handles broadcast, rollback, etc.
  render(game);
  requestAnimationFrame(tick);
}
```

## Research References

This library is inspired by:
- [GGPO](https://www.ggpo.net/) - Industry-standard rollback netcode (C++)
- [NetplayJS](https://github.com/rameshvarun/netplayjs) - Browser rollback, but 2-player only
- [Telegraph](https://github.com/thomasboyt/telegraph) - GGPO TypeScript port, archived
- [Matchbox](https://github.com/johanhelsing/matchbox) + [GGRS](https://github.com/gschup/ggrs) - Rust/WASM ecosystem
