# FAQ

## Do I need a signaling server?

Yes. WebRTC requires a signaling mechanism to exchange connection information between peers. The library does not include a signaling server—you provide one. Options include:

- Firebase Realtime Database
- A simple WebSocket server
- Any pub/sub service (Pusher, Ably, etc.)

See [`examples/webrtc/`](../examples/webrtc/) for a minimal signaling server implementation.

## Does my game need to be deterministic?

Yes. Given the same inputs, your game must produce the same state on all clients. Common sources of non-determinism:

- **`Math.random()`** - Use a seeded PRNG instead
- **`Date.now()`** - Use tick count for timing
- **Object iteration order** - Use `Map` for consistent ordering
- **Floating point differences** - Usually not an issue in JavaScript

## What happens if a player has high latency?

The rollback algorithm handles latency automatically. High-latency players will see more frequent rollbacks (visual corrections) but gameplay continues smoothly for everyone. If a player falls too far behind, the game can pause to let them catch up.

## How large can my game state be?

With `TransformingTransport`, states up to ~64MB are supported (compressed and segmented). For best performance, keep serialized state under a few hundred KB. Consider delta compression for large states.

## How much bandwidth does it use?

During normal gameplay, only player inputs are transmitted—not world state. This keeps bandwidth proportional to player count, not world complexity.

Full state is only sent during:
- Initial state sync when a player joins
- Desync recovery (rare with deterministic simulation)

## Can I use this with my favorite game framework?

Yes. The library is framework-agnostic. It works with:

- Vanilla Canvas/WebGL
- PixiJS
- Phaser
- Three.js
- Any framework that supports a fixed timestep

## What browsers are supported?

Any modern browser with WebRTC support:

- Chrome 56+
- Firefox 44+
- Safari 11+
- Edge 79+
