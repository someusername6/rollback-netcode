# Requirements

## Functional Requirements

### FR-1: Game Interface

The library must define a minimal interface that games implement.

#### FR-1.1: State Serialization
- Game must provide `serialize(): Uint8Array` to capture full state
- Game must provide `deserialize(data: Uint8Array): void` to restore state
- Serialization must be deterministic (same state produces same bytes)

#### FR-1.2: Simulation Step
- Game must provide `step(inputs: Map<PlayerId, Input>): void`
- Step must be deterministic given the same inputs
- Step must not depend on wall-clock time, only tick count

#### FR-1.3: State Hashing
- Game must provide `hash(): number` for desync detection
- Hash should be fast (computed every tick for snapshots)
- Hash collisions acceptable but should be rare

#### FR-1.4: Input Encoding
- Game defines its own input type
- Library treats inputs as opaque `Uint8Array`
- Game responsible for encoding/decoding

### FR-2: Session Management

#### FR-2.1: Session Creation
- Host can create a session with configuration (max players, topology, etc.)
- Session generates a unique identifier for joining

#### FR-2.2: Session Joining
- Players can join via session ID
- Players can join during active gameplay (late join)
- Late joiners receive full state sync before participating

#### FR-2.3: Session Leaving
- Players can leave voluntarily at any time
- System detects involuntary disconnects (timeout)
- Remaining players continue without interruption
- Leaving player's entities can be removed or converted to AI (game decides)

#### FR-2.4: Player Management
- Track connected players and their status
- Assign stable player IDs (persist across reconnects if desired)
- Handle graceful disconnects
- Handle unexpected disconnects (timeout detection)
- Notify game when players join/leave for entity management

#### FR-2.5: Session States
- `LOBBY` - Waiting for players, not simulating
- `PLAYING` - Active simulation
- `PAUSED` - Simulation halted (disconnect, user pause)
- Transitions must be synchronized across all peers

### FR-2B: Dynamic Join/Leave

#### FR-2B.1: Late Join Flow
1. New player connects to host (or all peers in mesh)
2. Host pauses simulation briefly (configurable: pause vs continue)
3. Host sends current authoritative state to new player
4. New player initializes state and begins participating
5. All peers add new player to their input tracking
6. Game receives `onPlayerJoin` callback to spawn player entity

#### FR-2B.2: Leave Flow
1. Player disconnects (graceful or timeout)
2. All peers receive leave notification
3. Peers stop expecting inputs from that player
4. Game receives `onPlayerLeave` callback to handle entity (remove, AI takeover, etc.)
5. Rollback may be needed if predictions existed for the leaving player

#### FR-2B.3: Reconnection
- Player can reconnect using same player ID
- On reconnect, treated as late join (full state sync)
- Game can restore player's previous entity if desired

#### FR-2B.4: Join/Leave Synchronization
- Join/leave events tied to specific ticks
- All peers must agree on which tick a player joined/left
- Input buffers track which players were active at each tick

### FR-3: Rollback Netcode

#### FR-3.1: Input Collection
- Collect local player input each tick
- Broadcast inputs to all peers
- Buffer received inputs by tick number

#### FR-3.2: Input Prediction
- Predict remote player inputs when not yet received
- Default strategy: repeat last confirmed input
- Prediction strategy must be pluggable

#### FR-3.3: State Snapshots
- Save game state after each simulation tick
- Store in ring buffer with configurable capacity
- Snapshots include: tick number, serialized state, hash

#### FR-3.4: Misprediction Detection
- Compare confirmed inputs against predicted inputs used
- Track earliest mispredicted tick

#### FR-3.5: Rollback and Resimulation
- Restore snapshot from mispredicted tick
- Resimulate forward to current tick with corrected inputs
- Resimulation must skip rendering (fast-forward)

#### FR-3.6: Synchronization Limits
- Configurable maximum speculation window
- Pause simulation if any peer falls too far behind
- Resume when caught up or peer is dropped

### FR-4: Desync Detection and Recovery

#### FR-4.1: Periodic Hash Comparison
- Compute state hash at configurable intervals
- Broadcast hashes to peers (or host in star topology)
- Compare hashes for same tick across all peers

#### FR-4.2: Desync Recovery
- Detect hash mismatches
- Request full state from authoritative source
- Restore state and continue simulation

#### FR-4.3: Authoritative Source
- Star topology: host is authoritative
- Mesh topology: majority vote determines correct state

### FR-5: Transport Layer

#### FR-5.1: Transport Abstraction
- Define `TransportAdapter` interface
- Library core must not depend on specific transport

#### FR-5.2: WebRTC Transport
- Default implementation using WebRTC DataChannels
- Support both reliable and unreliable channels
- Handle ICE connection lifecycle

#### FR-5.3: Local Transport
- In-memory transport for testing
- Configurable latency, jitter, packet loss

#### FR-5.4: Signaling
- Library does NOT provide signaling
- Document integration points for user-provided signaling

### FR-6: Topology Support

#### FR-6.1: Star Topology
- All traffic routes through host
- Host relays inputs between clients
- Simpler, fewer connections

#### FR-6.2: Mesh Topology (Stretch Goal)
- Direct connections between all peers
- Each peer sends inputs to all others
- Lower latency, more connections

### FR-7: Events and Callbacks

#### FR-7.1: Session Events
- `onPlayerJoin(playerId, tick)` - Player joined at specific tick
- `onPlayerLeave(playerId, tick, reason)` - Player left at specific tick
- `onSessionStateChange(state)` - Session state changed (lobby, playing, paused)

#### FR-7.2: Network Events
- `onConnect(peerId)`
- `onDisconnect(peerId)`
- `onLatencyUpdate(peerId, latency)`

#### FR-7.3: Sync Events
- `onRollback(fromTick, toTick)`
- `onDesyncDetected(tick, localHash, remoteHashes)`
- `onDesyncRecovered(tick)`

---

## Non-Functional Requirements

### NFR-1: Performance

#### NFR-1.1: Tick Rate
- Support 60 ticks/second without frame drops
- Rollback + resimulation must complete within 16ms budget

#### NFR-1.2: Memory Usage
- Snapshot buffer should use < 10MB for typical games
- No memory leaks over extended sessions

#### NFR-1.3: Bandwidth
- Input messages < 50 bytes each
- Baseline bandwidth < 5 KB/s per player at 60 ticks/sec

### NFR-2: Latency

#### NFR-2.1: Local Input
- Zero additional latency on local inputs
- Player's own actions feel instant

#### NFR-2.2: Network Tolerance
- Handle up to 200ms one-way latency gracefully
- Graceful degradation beyond 200ms (more rollbacks, not failure)

### NFR-3: Reliability

#### NFR-3.1: Desync Recovery
- Recover from any desync within 5 seconds
- No permanent desyncs that require restart

#### NFR-3.2: Disconnect Handling
- Detect disconnects within 5 seconds
- Allow session to continue with remaining players

### NFR-4: Compatibility

#### NFR-4.1: Browser Support
- Chrome 80+
- Firefox 75+
- Safari 14+
- Edge 80+

#### NFR-4.2: Module Format
- ESM (ES Modules) primary
- TypeScript source with type definitions
- No CommonJS (modern browsers only)

### NFR-5: Developer Experience

#### NFR-5.1: Type Safety
- Full TypeScript with strict mode
- No `any` types in public API

#### NFR-5.2: Documentation
- JSDoc comments on all public APIs
- Usage examples for common scenarios
- Architecture documentation

#### NFR-5.3: Error Messages
- Descriptive error messages
- Suggest fixes where possible

### NFR-6: Testing

#### NFR-6.1: Unit Tests
- Core logic fully unit tested
- Mock transport for isolation

#### NFR-6.2: Integration Tests
- Multi-peer scenarios with LocalTransport
- Desync injection and recovery tests

#### NFR-6.3: Determinism Tests
- Verify same inputs produce same state
- Detect floating-point or timing issues

---

## Out of Scope (v1)

- **Matchmaking** - Users provide their own lobby/matchmaking
- **Authentication** - Users handle auth before creating sessions
- **Host migration** - If host disconnects, session ends
- **Spectator mode** - All participants are players
- **State compression** - Games handle their own compression
- **Voice/video chat** - Separate concern from game netcode

---

## Glossary

| Term | Definition |
|------|------------|
| **Tick** | One simulation step (e.g., 1/60th of a second) |
| **Input** | Player's actions for one tick (encoded as bytes) |
| **Snapshot** | Serialized game state at a specific tick |
| **Rollback** | Restoring a previous snapshot |
| **Resimulation** | Replaying ticks after rollback with corrected inputs |
| **Misprediction** | When predicted input differs from actual input |
| **Desync** | When two peers have different state for the same tick |
| **Confirmed tick** | Highest tick where all inputs are known |
| **Speculation** | Simulating beyond confirmed tick using predictions |
| **Star topology** | All traffic routes through one host |
| **Mesh topology** | All peers connected directly to each other |
