# Architecture

This document describes the internal architecture of the rollback netcode library. It's intended for contributors and advanced users who want to understand how the library works.

## Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Game Application                            │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │                    Game Interface                              │  │
│  │  - serialize(): Uint8Array      - deserialize(data): void     │  │
│  │  - step(inputs: Map)            - hash(): number              │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                  │                                   │
│  ┌───────────────────────────────▼───────────────────────────────┐  │
│  │                     Rollback Netcode Library                   │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌───────────────────────┐  │  │
│  │  │   Session   │  │  Rollback   │  │   Transport Adapter   │  │  │
│  │  │   Manager   │──│   Engine    │──│   (WebRTC/Local)      │  │  │
│  │  └─────────────┘  └─────────────┘  └───────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

## Core Components

### 1. Session Manager

Manages the multiplayer session lifecycle, player connections, and game state transitions.

**Responsibilities:**
- Room creation and joining
- Player join/leave handling
- Session state management (lobby, playing, paused)
- Host authority and control
- Event dispatching

**States:**
```
DISCONNECTED → CONNECTING → LOBBY → PLAYING ⇄ PAUSED
                              ↑        │
                              └────────┘ (player join/leave)
```

**Key Types:**
```typescript
enum SessionState {
  Disconnected = 0,
  Connecting = 1,
  Lobby = 2,
  Playing = 3,
  Paused = 4,
}

interface SessionEvents {
  stateChange: (newState: SessionState, oldState: SessionState) => void;
  playerJoined: (player: PlayerInfo) => void;
  playerLeft: (player: PlayerInfo) => void;
  desync: (tick: Tick, localHash: number, remoteHash: number) => void;
  gameStart: () => void;
  error: (error: Error, context: ErrorContext) => void;
}
```

### 2. Rollback Engine

The core netcode implementation that handles input synchronization, prediction, and rollback.

**Responsibilities:**
- Input collection and broadcast
- Input prediction for remote players
- State snapshot management (ring buffer)
- Misprediction detection and rollback
- Resimulation with corrected inputs
- Desync detection via state hashing

**Key Data Structures:**

```typescript
// Per-player input tracking
interface InputBuffer {
  // Inputs received from network (may have gaps)
  received: Map<Tick, Uint8Array>;

  // Highest tick T where ticks 1..T are contiguous
  confirmedTick: Tick;

  // What input was used when simulating each tick
  usedInputs: Map<Tick, Uint8Array>;
}

// State snapshot for rollback
interface Snapshot {
  tick: Tick;
  state: Uint8Array;  // Serialized game state
  hash: number;       // For desync detection
}
```

### 3. Transport Adapter

Abstraction over network transport, allowing different implementations.

**Interface:**
```typescript
interface TransportAdapter {
  // Connection management
  connect(peerId: string): Promise<void>;
  disconnect(peerId: string): void;
  disconnectAll(): void;

  // Messaging
  send(peerId: string, message: Uint8Array, reliable: boolean): void;
  broadcast(message: Uint8Array, reliable: boolean): void;

  // Event callbacks (set by library)
  onMessage: ((peerId: string, message: Uint8Array) => void) | null;
  onConnect: ((peerId: string) => void) | null;
  onDisconnect: ((peerId: string) => void) | null;

  // State
  readonly connectedPeers: ReadonlySet<string>;
  readonly localPeerId: string;

  // Optional metrics
  getConnectionMetrics?(peerId: string): ConnectionMetrics | null;
}
```

**Implementations:**

| Transport | Description | Use Case |
|-----------|-------------|----------|
| `WebRTCTransport` | WebRTC DataChannels | Production |
| `LocalTransport` | In-memory, simulated latency | Testing |
| `TransformingTransport` | Wrapper with compression/segmentation | Large states |

### 4. TransformingTransport

A transport wrapper that adds compression and message segmentation for large messages.

```
Session.send(message)
       │
       ▼
┌──────────────────────────────────────┐
│       TransformingTransport          │
│  ┌────────────────────────────────┐  │
│  │  1. Compression (pako/gzip)    │  │
│  │     - Header: 0x00=raw, 0x01=gz│  │
│  └────────────────────────────────┘  │
│  ┌────────────────────────────────┐  │
│  │  2. Segmentation               │  │
│  │     - Header: msgId|idx|total  │  │
│  │     - Reassembly with timeout  │  │
│  └────────────────────────────────┘  │
└──────────────────────────────────────┘
       │
       ▼
  Inner Transport (WebRTC/Local)
```

**Configuration:**
```typescript
interface TransformingTransportConfig {
  compression: 'auto' | 'always' | 'never';  // default: 'auto'
  compressionThreshold: number;               // default: 128 bytes
  segmentation: boolean;                      // default: true
  maxSegmentSize: number;                     // default: 16000 bytes
  reassemblyTimeout: number;                  // default: 5000 ms
}
```

## Network Topology

The library supports two network topologies, each with different tradeoffs.

### Star Topology (Recommended)

```
     Player 2
        │
        ▼
Player 1 ◄──► Host ◄──► Player 3
                │
                ▼
            Player 4
```

All players connect only to the host. The host relays messages between players.

| Aspect | Star |
|--------|------|
| **Connections** | N-1 (linear scaling) |
| **Latency** | Higher between non-host players (relay through host) |
| **Reliability** | Host is single point of failure |
| **Complexity** | Simple connection management |
| **Best for** | 4+ players, typical multiplayer games |

### Mesh Topology

```
Player 1 ◄───────► Player 2
    │ ╲           ╱ │
    │   ╲       ╱   │
    │     ╲   ╱     │
    │       ╳       │
    │     ╱   ╲     │
    │   ╱       ╲   │
    ▼ ╱           ╲ ▼
Player 3 ◄───────► Player 4
```

Every player connects directly to every other player.

| Aspect | Mesh |
|--------|------|
| **Connections** | N×(N-1)/2 (quadratic scaling) |
| **Latency** | Lower between all players (direct connections) |
| **Reliability** | No single point of failure |
| **Complexity** | Complex connection management |
| **Best for** | 2-4 players where latency is critical (e.g., fighting games) |

### Scaling Comparison

| Players | Star Connections | Mesh Connections |
|---------|------------------|------------------|
| 2       | 1                | 1                |
| 4       | 3                | 6                |
| 8       | 7                | 28               |
| 16      | 15               | 120              |

> **Warning:** Mesh topology scales poorly. Each player must maintain connections
> to all other players, and each connection requires WebRTC negotiation, ICE
> candidate exchange, and ongoing keepalive traffic. **Mesh with more than 4
> players is not recommended.** Use Star topology for larger games.

## Dynamic Join/Leave

### Player Join (Late Join)

```
New Player                    Host                      Existing Peers
    │                          │                              │
    │──── JOIN_REQUEST ───────>│                              │
    │                          │                              │
    │<─── JOIN_ACCEPT ─────────│                              │
    │     (playerList, config) │                              │
    │                          │                              │
    │<─── STATE_SYNC ──────────│                              │
    │     (tick, state)        │                              │
    │                          │                              │
    │                          │─── PLAYER_JOINED ───────────>│
    │                          │    (playerId, tick)          │
    │                          │                              │
    │<────────── Normal input flow begins ───────────────────>│
```

**Key Points:**
- Join event is tied to a specific tick (all peers agree)
- New player receives full state sync before participating
- Existing peers add new player to input tracking at the join tick

### Player Leave

```
Leaving Player               Host/Peers
      │                          │
      │                     (disconnect detected or voluntary leave)
      │                          │
      │                          │─── PLAYER_LEFT ───────────> all peers
      │                          │    (playerId, tick, reason)
      │                          │
      │                          │   (peers stop expecting inputs
      │                          │    from player at that tick)
```

## Message Protocol

### Message Types

```typescript
enum MessageType {
  Input = 1,         // Player input for a tick
  InputAck = 2,      // Acknowledgment of received input
  Hash = 3,          // State hash for desync detection
  Sync = 4,          // Request for state sync
  StateSync = 5,     // Full state synchronization
  JoinRequest = 6,   // Request to join session
  JoinAccept = 7,    // Acceptance of join request
  Pause = 8,         // Pause game
  Resume = 9,        // Resume game
  PlayerJoined = 10, // Notification of new player
  PlayerLeft = 11,   // Notification of player leaving
  Ping = 12,         // Latency measurement
  Pong = 13,         // Latency response
  LagReport = 14,    // Report of lagging player
  DisconnectReport = 15,  // Report of disconnection
  DropPlayer = 16,   // Command to drop a player
  ResumeCountdown = 17,   // Countdown to resume
}
```

### Channel Strategy

| Message Type | Channel | Rationale |
|--------------|---------|-----------|
| Input | Unreliable | High frequency, missing one is OK (predicted) |
| InputAck | Unreliable | Lost acks just delay confirmation |
| Hash | Reliable | Must arrive to detect desync |
| StateSync | Reliable | Large, must arrive intact |
| Session control | Reliable | Critical, must arrive |

### Binary Encoding

Messages are encoded in a compact binary format:

```
┌──────────┬──────────────────────────────────────┐
│ Type (1B)│ Payload (variable)                   │
└──────────┴──────────────────────────────────────┘
```

Input messages include redundancy for reliability on lossy connections:

```
┌──────────┬──────────┬──────────┬─────────────────┐
│ Type (1B)│ Tick (4B)│ Count(1B)│ Inputs (N × var)│
└──────────┴──────────┴──────────┴─────────────────┘
```

## Rollback Algorithm

### Per-Tick Flow

```
1. Collect local input
2. Broadcast local input to all peers
3. Process received inputs:
   a. Update confirmed tick for each player
   b. Compare confirmed vs predicted inputs
   c. If mismatch: mark rollback needed
4. If rollback needed:
   a. Find earliest mispredicted tick
   b. Restore snapshot from that tick
   c. Resimulate forward to current tick
5. Predict inputs for players without confirmed input
6. Step simulation with all inputs
7. Save snapshot of current state
8. Return tick result to game for rendering
```

### Input Prediction Strategy

Default: Repeat last confirmed input.

```typescript
const DEFAULT_INPUT_PREDICTOR: InputPredictor = {
  predict(playerId, tick, lastConfirmed) {
    return lastConfirmed ?? new Uint8Array(0);
  }
};
```

This works well for continuous inputs (movement, thrust). Mispredictions occur on button press/release, causing brief visual corrections.

### Rollback Limits

| Parameter | Default | Purpose |
|-----------|---------|---------|
| `snapshotHistorySize` | 120 ticks | How far back we can roll back |
| `maxSpeculationTicks` | 60 ticks | How far ahead without confirmed inputs |
| `hashInterval` | 60 ticks | Frequency of desync checks |

## Desync Detection and Recovery

### Detection

1. Every `hashInterval` ticks, compute `game.hash()`
2. Broadcast hash to peers (or host in star topology)
3. Compare hashes for the same tick
4. If mismatch detected, initiate recovery

### Recovery

**Star topology:**
1. Host sends `StateSync` message with authoritative state
2. Desynced client restores state and continues

**Mesh topology:**
1. Peers compare hashes independently
2. Desynced peer requests `StateSync` from another peer
3. Restore state and continue

## WebRTC Transport Details

### Signaling

The library does NOT include a signaling server. Users must provide a way to exchange:
- SDP offers/answers
- ICE candidates

The `WebRTCTransport` accepts signaling callbacks:

```typescript
const transport = new WebRTCTransport(localPeerId, {
  onSignal: async (peerId, signal) => {
    // Send to peer via your signaling mechanism
  }
});

// Handle incoming signals
transport.handleSignal(fromPeerId, signalData);
```

### DataChannel Configuration

```typescript
// Unreliable channel for inputs
const unreliableConfig = {
  ordered: false,
  maxRetransmits: 0
};

// Reliable channel for sync/control
const reliableConfig = {
  ordered: true
};
```

### NAT Traversal

Configure STUN/TURN servers via `rtcConfig`:

```typescript
const transport = new WebRTCTransport(localPeerId, {
  onSignal,
  rtcConfig: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'turn:your-turn-server.com', username: '...', credential: '...' }
    ]
  }
});
```

## Testing Support

### LocalTransport

In-memory transport for deterministic testing:

```typescript
const [t1, t2] = createLocalTransportGroup(['player-1', 'player-2'], {
  latency: 50,        // Simulated one-way latency (ms)
  jitter: 10,         // Random variation (ms)
  packetLoss: 0.01    // 1% packet loss
});
```

### Test Utilities

```typescript
import { TestGame, createTestSession, flushAllTransports } from 'rollback-netcode';

// Create test sessions with linked transports
const host = createTestSession({ transport: t1 });
const client = createTestSession({ transport: t2 });

// Simulate ticks
host.session.tick(input);
client.session.tick(input);
flushAllTransports([t1, t2]);

// Verify state matches
assert(host.game.hash() === client.game.hash());
```

### Determinism Verification

Run identical inputs on two separate game instances and compare final state hashes. Useful for finding non-determinism bugs in game logic.

## File Organization

```
src/
  index.ts              # Public API exports
  types.ts              # Core type definitions
  session/
    session.ts          # Session manager
    topology.ts         # Star/Mesh topology strategies
    player-manager.ts   # Player tracking
    message-router.ts   # Message dispatching
  rollback/
    engine.ts           # Rollback engine
    snapshot-buffer.ts  # Ring buffer for snapshots
    input-buffer.ts     # Per-player input tracking
  transport/
    adapter.ts          # Transport interface
    webrtc.ts           # WebRTC implementation
    local.ts            # Local/mock transport
    transforming.ts     # Compression/segmentation wrapper
  protocol/
    messages.ts         # Message type definitions
    encoding.ts         # Binary encoding/decoding
```
