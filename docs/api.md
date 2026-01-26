# API Reference

## Session

```typescript
import { createSession } from 'rollback-netcode';

const session = createSession({
  game: Game,                    // Your game implementation
  transport: TransportAdapter,   // WebRTCTransport, LocalTransport, etc.
  config?: SessionConfig,        // Optional configuration
});
```

### Methods

| Method | Description |
|--------|-------------|
| `createRoom()` | Host a new room. Returns room ID. |
| `joinRoom(roomId, hostPeerId)` | Join an existing room. |
| `start()` | Begin gameplay (host only). |
| `tick(localInput)` | Advance simulation by one tick. |
| `pause()` | Pause the game (host only). |
| `resume()` | Resume the game (host only). |
| `leaveRoom()` | Leave the current room. |

### Properties

| Property | Type | Description |
|----------|------|-------------|
| `state` | `'disconnected' \| 'lobby' \| 'playing' \| 'paused'` | Current session state |
| `isHost` | `boolean` | Whether local player is the host |
| `localPlayerId` | `PlayerId` | Local player's ID |
| `players` | `Map<PlayerId, PlayerInfo>` | Connected players |
| `currentTick` | `number` | Current simulation tick |

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

## Configuration

```typescript
const session = createSession({
  game,
  transport,
  config: {
    maxPlayers: 4,              // Maximum players allowed (default: 4)
    tickRate: 60,               // Ticks per second (default: 60)
    snapshotHistorySize: 120,   // Ticks of history to keep (default: 120)
    hashInterval: 60,           // Ticks between hash checks (default: 60)
    disconnectTimeout: 5000,    // Ms before disconnecting idle peer (default: 5000)
    topology: Topology.Star,    // Star (through host) or Mesh (direct)
    desyncAuthority: DesyncAuthority.Host,  // Who detects desyncs
  }
});
```

## Transports

### WebRTCTransport

For production use with real network connections.

```typescript
import { WebRTCTransport } from 'rollback-netcode';

const transport = new WebRTCTransport(localPeerId, {
  onSignal: async (peerId, signal) => {
    // Send signal to peer via your signaling server
    await signalingServer.send(peerId, signal);
  },
  rtcConfig: {
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
  }
});

// Handle incoming signals from your signaling server
signalingServer.onSignal((fromPeerId, signal) => {
  transport.handleSignal(fromPeerId, signal);
});

// Initiate connection to a peer
transport.connect(remotePeerId);
```

### LocalTransport

For testing without real network connections.

```typescript
import { createLocalTransportGroup } from 'rollback-netcode';

// Create linked transports with simulated network conditions
const transports = createLocalTransportGroup(['p1', 'p2', 'p3'], {
  latency: 50,      // Simulated one-way latency (ms)
  jitter: 10,       // Latency variation (ms)
  packetLoss: 0.01  // 1% packet loss
});

const t1 = transports.get('p1')!;
const t2 = transports.get('p2')!;
const t3 = transports.get('p3')!;

// In your test loop, advance time to deliver messages
t1.tick(16);  // Simulate 16ms passing
t2.tick(16);
t3.tick(16);
```

### TransformingTransport

Wraps another transport to add compression and message segmentation. Use this for games with large state (>16KB).

```typescript
import { WebRTCTransport, TransformingTransport } from 'rollback-netcode';

const webrtc = new WebRTCTransport('my-player-id', { onSignal });

const transport = new TransformingTransport(webrtc, {
  compression: 'auto',        // 'auto' | 'always' | 'never'
  compressionThreshold: 128,  // Only compress messages > 128 bytes
  maxSegmentSize: 16000,      // Split messages larger than this
});

const session = createSession({ game, transport });
```

## Testing Your Game

Use `LocalTransport` for deterministic testing:

```typescript
import {
  createSession,
  createLocalTransportGroup,
} from 'rollback-netcode';

// Create linked transports with simulated latency
const transports = createLocalTransportGroup(['host', 'client'], {
  latency: 50,
});
const t1 = transports.get('host')!;
const t2 = transports.get('client')!;

// Create sessions
const hostGame = new MyGame();
const clientGame = new MyGame();
const hostSession = createSession({ game: hostGame, transport: t1 });
const clientSession = createSession({ game: clientGame, transport: t2 });

// Set up room
await hostSession.createRoom();
await clientSession.joinRoom('room', 'host');
hostSession.start();

// Simulate ticks
for (let i = 0; i < 100; i++) {
  hostSession.tick(new Uint8Array([1]));
  clientSession.tick(new Uint8Array([2]));
  t1.tick(16);
  t2.tick(16);
}

// Verify state matches
assert(hostGame.hash() === clientGame.hash());
```
