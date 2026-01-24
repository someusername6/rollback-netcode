# Architecture

## Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Game Application                            │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │                    Game-Provided Interfaces                    │  │
│  │  - serialize(): Uint8Array      - deserialize(data): void     │  │
│  │  - step(inputs: PlayerInputs)   - hash(): number              │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                  │                                   │
│  ┌───────────────────────────────▼───────────────────────────────┐  │
│  │                     Rollback Netcode Library                   │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌───────────────────────┐  │  │
│  │  │   Session   │  │  Rollback   │  │   Transport Adapter   │  │  │
│  │  │   Manager   │──│   Engine    │──│   (WebRTC default)    │  │  │
│  │  └─────────────┘  └─────────────┘  └───────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

## Core Components

### 1. Session Manager

Manages the multiplayer session lifecycle.

**Responsibilities:**
- Player join/leave handling
- Session state (lobby, playing, paused)
- Host election and migration (if supported)
- Connection health monitoring

**States:**
```
DISCONNECTED → CONNECTING → LOBBY → PLAYING ⇄ PAUSED
                              ↑        │
                              └────────┘ (player join/leave)
```

**Dynamic Join/Leave:**
- Players can join/leave during PLAYING state
- Join: triggers state sync, then player added to simulation
- Leave: player removed, remaining players continue

### 2. Rollback Engine

The core netcode implementation.

**Responsibilities:**
- Input collection and broadcast
- Input prediction for remote players
- State snapshot management (ring buffer)
- Misprediction detection and rollback
- Resimulation with corrected inputs
- Desync detection via state hashing

**Key Data Structures:**

```typescript
// Per-player input buffer
interface InputBuffer {
  // Inputs received from network (may have gaps)
  received: Map<Tick, Input>;

  // Highest tick T where ticks 1..T are contiguous
  confirmedTick: Tick;

  // What input was used when simulating each tick
  usedInputs: Map<Tick, Input>;
}

// State snapshot for rollback
interface Snapshot {
  tick: Tick;
  state: Uint8Array;  // Serialized game state
  hash: number;       // For desync detection
}

// Ring buffer of recent snapshots
interface SnapshotBuffer {
  snapshots: Snapshot[];
  capacity: number;   // e.g., 120 ticks = 2 seconds at 60fps
  oldest: Tick;
  newest: Tick;
}
```

### 3. Transport Adapter

Abstraction over network transport.

**Interface:**
```typescript
interface TransportAdapter {
  // Connection
  connect(peerId: string): Promise<void>;
  disconnect(peerId: string): void;

  // Messaging
  send(peerId: string, message: Uint8Array, reliable: boolean): void;
  onMessage(handler: (peerId: string, message: Uint8Array) => void): void;

  // Events
  onConnect(handler: (peerId: string) => void): void;
  onDisconnect(handler: (peerId: string) => void): void;
}
```

**Implementations:**
- `WebRTCTransport` - Default, uses WebRTC DataChannels
- `LocalTransport` - For testing, simulates network in-memory
- Custom adapters possible for WebSocket fallback, etc.

## Network Topology

### Option A: Star (through host)

```
     Player 2
        │
        ▼
Player 1 ◄──► Host ◄──► Player 3
                │
                ▼
            Player 4
```

- All traffic routes through host
- Simplest implementation
- Host has latency advantage
- If host disconnects, game ends (unless host migration)

### Option B: P2P Mesh

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

- Direct connections between all peers
- Lower latency between any two players
- More connections: n*(n-1)/2 for n players
- More complex, but more resilient

### Recommendation

Support both, with star as default (simpler). Mesh for advanced users who need minimum latency.

## Dynamic Join/Leave

### Player Join (Late Join)

```
New Player                    Host                      Existing Peers
    │                          │                              │
    │──── JOIN_REQUEST ───────>│                              │
    │                          │                              │
    │                          │─── PAUSE (optional) ────────>│
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
    │                          │─── RESUME (if paused) ──────>│
    │                          │                              │
    │<────────── Normal input flow begins ───────────────────>│
```

**Key Points:**
- Join event is tied to a specific tick (all peers agree)
- New player doesn't participate until after that tick
- Existing peers add new player to input tracking at the join tick
- If rollback crosses the join tick, input buffers handle player not existing before then

### Player Leave

```
Leaving Player               Host/Peers
      │                          │
      │                     (disconnect detected or LEAVE sent)
      │                          │
      │                          │─── PLAYER_LEFT ───────────> all peers
      │                          │    (playerId, tick, reason)
      │                          │
      │                          │   (peers remove player from
      │                          │    input tracking at tick)
      │                          │
      │                          │   (game callback: onPlayerLeave)
```

**Key Points:**
- Leave event tied to specific tick
- Inputs after leave tick are not expected/tracked
- Rollback across leave tick: player existed before, not after
- Game decides what happens to player's entities (remove, AI, etc.)

### Input Buffer with Variable Players

```typescript
interface TickInputs {
  tick: Tick;
  activePlayers: Set<PlayerId>;  // Who was in the game at this tick
  inputs: Map<PlayerId, Input>;   // Their inputs
}

interface InputBuffer {
  // Track which players were active at each tick
  playerTimeline: Map<Tick, Set<PlayerId>>;

  // Per-player input tracking
  playerInputs: Map<PlayerId, {
    joinTick: Tick;
    leaveTick: Tick | null;  // null if still active
    received: Map<Tick, Input>;
    confirmedTick: Tick;
    usedInputs: Map<Tick, Input>;
  }>;
}
```

When predicting inputs, check if player was active at that tick:

```typescript
function getInputForTick(playerId: PlayerId, tick: Tick): Input | null {
  const player = playerInputs.get(playerId);
  if (!player) return null;
  if (tick < player.joinTick) return null;
  if (player.leaveTick !== null && tick >= player.leaveTick) return null;

  // Player was active at this tick
  const confirmed = player.received.get(tick);
  if (confirmed !== undefined) return confirmed;

  // Predict based on last confirmed
  return predictInput(playerId, tick);
}
```

## Message Protocol

### Message Types

```typescript
// Input broadcast (every tick, unreliable channel)
interface InputMessage {
  type: 'INPUT';
  tick: Tick;
  playerId: PlayerId;
  input: Uint8Array;  // Game-defined encoding
}

// Input acknowledgment (for reliability layer)
interface InputAckMessage {
  type: 'INPUT_ACK';
  playerId: PlayerId;
  ackedTick: Tick;
}

// State hash for desync detection (periodic, reliable channel)
interface HashMessage {
  type: 'HASH';
  tick: Tick;
  hash: number;
}

// Full state sync (for desync recovery, reliable channel)
interface SyncMessage {
  type: 'SYNC';
  tick: Tick;
  state: Uint8Array;
}

// Session control
interface PauseMessage { type: 'PAUSE'; tick: Tick; reason: string; }
interface ResumeMessage { type: 'RESUME'; tick: Tick; }

// Player join/leave
interface JoinRequestMessage {
  type: 'JOIN_REQUEST';
  playerId: PlayerId;
}

interface JoinAcceptMessage {
  type: 'JOIN_ACCEPT';
  playerId: PlayerId;
  assignedId: PlayerId;  // Host may assign different ID
  players: PlayerId[];   // Current player list
  config: SessionConfig;
}

interface StateSyncMessage {
  type: 'STATE_SYNC';
  tick: Tick;
  state: Uint8Array;
  playerTimeline: Array<{ playerId: PlayerId; joinTick: Tick; leaveTick: Tick | null }>;
}

interface PlayerJoinedMessage {
  type: 'PLAYER_JOINED';
  playerId: PlayerId;
  tick: Tick;  // Tick at which player becomes active
}

interface PlayerLeftMessage {
  type: 'PLAYER_LEFT';
  playerId: PlayerId;
  tick: Tick;  // Tick at which player became inactive
  reason: 'voluntary' | 'timeout' | 'kicked';
}
```

### Channel Strategy

| Message Type | Channel | Rationale |
|--------------|---------|-----------|
| INPUT | Unreliable | High frequency, missing one is OK (predicted) |
| INPUT_ACK | Unreliable | Lost acks just delay confirmation |
| HASH | Reliable | Must arrive to detect desync |
| SYNC | Reliable | Large, must arrive intact |
| Session control | Reliable | Critical, must arrive |

## Rollback Algorithm

### Per-Tick Flow

```
1. Collect local input
2. Broadcast local input to all peers
3. For each remote player:
   a. Check if confirmed inputs arrived
   b. If new confirmed inputs:
      - Update confirmedTick
      - Compare confirmed vs used inputs
      - If mismatch found: mark rollback needed
4. If rollback needed:
   a. Find earliest mispredicted tick
   b. Restore snapshot from that tick
   c. Resimulate forward to current tick with corrected inputs
5. Predict inputs for any remote players without confirmed input
6. Step simulation with all inputs (local + confirmed/predicted)
7. Save snapshot of current state
8. Render (with optional interpolation to smooth corrections)
```

### Input Prediction Strategy

Default: Repeat last confirmed input.

```typescript
function predictInput(player: PlayerId, tick: Tick): Input {
  const buffer = inputBuffers.get(player);
  const lastConfirmed = buffer.received.get(buffer.confirmedTick);
  return lastConfirmed ?? defaultInput;
}
```

Works well for continuous inputs (thrust, turn). Mispredicts on button press/release, causing brief visual corrections.

### Rollback Limits

| Parameter | Default | Rationale |
|-----------|---------|-----------|
| Snapshot history | 120 ticks (2 sec) | Covers 2x worst-case intercontinental RTT |
| Max speculation | 60 ticks (1 sec) | Limits how far ahead before pausing |
| Pause threshold | 30 ticks (0.5 sec) | When to pause waiting for slow peer |
| Hash interval | 60 ticks (1 sec) | Frequency of desync checks |

## Desync Detection and Recovery

### Detection

1. Every `hashInterval` ticks, each peer computes `game.hash()`
2. Hashes are broadcast to all peers (or to host in star topology)
3. Host/peers compare hashes for the same tick
4. If mismatch detected, initiate recovery

### Recovery

**Star topology:**
1. Host sends `SYNC` message with authoritative state
2. Desynced client restores state and continues

**Mesh topology:**
1. Peers vote on correct hash (majority wins)
2. Minority peers request `SYNC` from a majority peer
3. Restore state and continue

## WebRTC Transport Details

### Signaling

Library does NOT include signaling server. Users must provide:
- A way to exchange SDP offers/answers
- A way to exchange ICE candidates

Options:
- Firebase Realtime Database
- Custom WebSocket server
- Copy-paste for testing

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

Users should configure STUN/TURN servers:

```typescript
const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'turn:your-turn-server.com', username: '...', credential: '...' }
  ]
};
```

## Testing Support

### LocalTransport

In-memory transport for deterministic testing:

```typescript
const transport = new LocalTransport({
  latency: 50,        // Simulated one-way latency (ms)
  jitter: 10,         // Random variation (ms)
  packetLoss: 0.01    // 1% packet loss
});
```

### Determinism Verification

Run same inputs on two separate game instances, compare final state hashes. Useful for finding non-determinism bugs.

### Desync Injection

Force a desync to test recovery:

```typescript
session.injectDesync(playerId);  // Corrupts one player's state
// Verify desync is detected and recovered
```
