# Configuration Tuning Guide

This guide explains how to tune the rollback netcode configuration for your specific game and network conditions.

## Configuration Options

```typescript
import { Topology, DesyncAuthority } from 'rollback-netcode';

interface SessionConfig {
  tickRate: number;              // Simulation ticks per second (default: 60)
  maxPlayers: number;            // Maximum players allowed (default: 4)
  topology: Topology;            // Topology.Star or Topology.Mesh (default: Star)
  snapshotHistorySize: number;   // Snapshots to keep (default: 120)
  maxSpeculationTicks: number;   // Max ticks ahead without confirmed inputs (default: 60)
  hashInterval: number;          // Ticks between desync checks (default: 60)
  disconnectTimeout: number;     // Ms before disconnecting idle peer (default: 5000)
  debug: boolean;                // Enable debug logging (default: false)
  desyncAuthority: DesyncAuthority;  // Who resolves desyncs (default: Peer)
  lagReportThreshold: number;    // Ticks behind before reporting lag (default: 30)
  inputRedundancy: number;       // Inputs per message for reliability (default: 3)
  joinRateLimitRequests: number; // Max join requests per window (default: 3)
  joinRateLimitWindowMs: number; // Rate limit window in ms (default: 10000)
}
```

## Trade-offs

### Tick Rate

| Higher Tick Rate | Lower Tick Rate |
|-----------------|-----------------|
| Smoother gameplay | Less CPU usage |
| More bandwidth | Less bandwidth |
| Lower input latency | Higher input latency |
| More rollbacks | Fewer rollbacks |

**Recommendations:**
- **Action games:** 60 ticks/second for responsive controls
- **Strategy games:** 20-30 ticks/second is often sufficient
- **Turn-based:** 10 ticks/second or lower

### Snapshot History Size vs Memory

Each snapshot stores your serialized game state. Memory usage is approximately:

```
Memory = snapshotHistorySize × (gameStateSize + overhead)
```

| Snapshot History | Memory (1KB state) | Memory (10KB state) |
|-----------------|-------------------|---------------------|
| 60 snapshots | ~70 KB | ~650 KB |
| 120 snapshots | ~140 KB | ~1.3 MB |
| 240 snapshots | ~280 KB | ~2.6 MB |

**Recommendations:**
- `snapshotHistorySize` must be ≥ `maxSpeculationTicks`
- For 60 tick rate: 120 snapshots = 2 seconds of history
- For high-latency networks: increase to 180-240 snapshots

### Max Speculation Ticks vs Latency

This controls how far the simulation can advance without confirmed inputs.

| More Speculation | Less Speculation |
|-----------------|------------------|
| Smoother with high latency | More accurate simulation |
| More potential rollbacks | May pause waiting for inputs |
| Higher memory usage | Lower memory usage |

**Recommendations:**
- **Local network (< 20ms):** 15-30 ticks
- **Regional (20-80ms):** 30-60 ticks
- **Global (80-200ms):** 60-120 ticks

**Formula:** `maxSpeculationTicks ≈ (expectedLatencyMs / 1000) × tickRate × 2`

### Hash Interval vs Desync Detection

How often to broadcast state hashes for desync detection.

| Frequent Hashing | Infrequent Hashing |
|-----------------|-------------------|
| Faster desync detection | Slower detection |
| More bandwidth | Less bandwidth |
| More CPU for hashing | Less CPU overhead |

**Recommendations:**
- **Development:** 30 ticks (0.5 seconds) for quick desync detection
- **Production:** 60-120 ticks (1-2 seconds) to reduce overhead
- Increase if hash computation is expensive

### Topology: Star vs Mesh

| Star Topology | Mesh Topology |
|--------------|---------------|
| Fewer connections (N-1) | More connections (N×(N-1)/2) |
| Higher latency (2× for clients) | Lower latency (direct) |
| Host can relay inputs | Each peer sends to all others |
| Better for 4+ players | Better for 2-3 players |

**Player count and connections:**

| Players | Star Connections | Mesh Connections |
|---------|-----------------|------------------|
| 2 | 1 | 1 |
| 3 | 2 | 3 |
| 4 | 3 | 6 |
| 6 | 5 | 15 |
| 8 | 7 | 28 |

**Recommendations:**
- **2-3 players:** Mesh for lower latency
- **4+ players:** Star for connection simplicity
- **Mobile/constrained:** Star (fewer connections = less battery)

### Input Redundancy

Each input message includes the last N inputs for reliability on lossy connections.

| Higher Redundancy | Lower Redundancy |
|------------------|------------------|
| Better packet loss recovery | Less bandwidth |
| More bandwidth | More rollbacks on loss |

**Recommendations:**
- **Reliable networks:** 1-2
- **Typical networks:** 3 (default)
- **Lossy networks (mobile):** 4-5

## TransformingTransport

For games with large state (>16KB), use `TransformingTransport` to add compression and message segmentation:

```typescript
import { TransformingTransport, WebRTCTransport } from 'rollback-netcode';

const webrtc = new WebRTCTransport(localPeerId, { onSignal });
const transport = new TransformingTransport(webrtc, {
  compression: 'auto',        // 'auto' | 'always' | 'never'
  compressionThreshold: 128,  // Only compress messages > 128 bytes
  maxSegmentSize: 16000,      // WebRTC DataChannel limit
  reassemblyTimeout: 5000,    // Timeout for incomplete messages
});
```

**When to use:**
- State sync messages exceed 16KB
- Bandwidth is constrained and state is compressible
- Playing over unreliable connections

**Compression modes:**
- `'auto'` (default): Compress only if result is smaller
- `'always'`: Always compress (good for text-heavy state)
- `'never'`: Skip compression (if state is already compressed)

## Example Configurations

### Fast-Paced Fighting Game
```typescript
import { Topology } from 'rollback-netcode';

const config = {
  tickRate: 60,
  maxPlayers: 2,
  topology: Topology.Mesh,     // Direct connection for lowest latency
  snapshotHistorySize: 120,
  maxSpeculationTicks: 30,     // Low latency priority
  hashInterval: 120,
  inputRedundancy: 2,          // Minimal redundancy for low bandwidth
};
```

### 4-Player Party Game
```typescript
import { Topology } from 'rollback-netcode';

const config = {
  tickRate: 30,
  maxPlayers: 4,
  topology: Topology.Star,     // Simpler with more players
  snapshotHistorySize: 90,
  maxSpeculationTicks: 45,
  hashInterval: 60,
  inputRedundancy: 3,
};
```

### 8-Player Strategy Game
```typescript
import { Topology } from 'rollback-netcode';

const config = {
  tickRate: 20,
  maxPlayers: 8,
  topology: Topology.Star,
  snapshotHistorySize: 60,
  maxSpeculationTicks: 40,
  hashInterval: 40,
  inputRedundancy: 4,          // Higher for reliability
};
```

### High-Latency Global Game
```typescript
import { Topology } from 'rollback-netcode';

const config = {
  tickRate: 60,
  maxPlayers: 4,
  topology: Topology.Star,
  snapshotHistorySize: 240,    // 4 seconds of history
  maxSpeculationTicks: 120,    // Allow 2 seconds ahead
  hashInterval: 60,
  disconnectTimeout: 10000,    // Longer timeout for high latency
  inputRedundancy: 5,          // Higher redundancy for reliability
};
```

## Monitoring and Adjustment

### Key Metrics to Watch

1. **Rollback frequency:** If > 10% of ticks cause rollbacks, increase `maxSpeculationTicks`
2. **Rollback depth:** If rollbacks exceed 30 ticks, consider reducing tick rate
3. **Memory usage:** If snapshots consume too much memory, reduce `snapshotHistorySize` or optimize serialization
4. **Desync frequency:** If desyncs occur, ensure game logic is deterministic

### Debug Mode

Enable debug logging to monitor rollbacks and network events:

```typescript
const session = createSession({
  game,
  transport,
  config: { debug: true },
});
```

### Session Events

Listen for events to monitor performance:

```typescript
session.on('rollback', (fromTick, toTick) => {
  console.log(`Rolled back ${fromTick - toTick} ticks`);
});

session.on('desync', (tick, localHash, remoteHash) => {
  console.warn(`Desync at tick ${tick}`);
});

session.on('lagReport', (playerId, ticksBehind) => {
  console.warn(`Player ${playerId} is ${ticksBehind} ticks behind`);
});
```

### Running Benchmarks

Use the included benchmarks to measure performance:

```bash
npm run benchmark
```

This helps identify if encoding, snapshot saving, or engine ticks are bottlenecks.

## Optimizing Game State Size

Smaller game state = faster serialization, less memory, less bandwidth.

**Tips:**
1. Only serialize what changes (delta compression)
2. Use fixed-point instead of floating-point where possible
3. Pack booleans into bitfields
4. Exclude derived state (recalculate after deserialize)
5. Use appropriate integer sizes (uint8 vs uint32)

**Example: Position optimization**
```typescript
// Before: 24 bytes per entity (3 × 8-byte floats)
{ x: number, y: number, z: number }

// After: 6 bytes per entity (3 × 2-byte fixed-point)
// Store as 1/100 units, range ±327 meters
{ x: int16, y: int16, z: int16 }
```

## Large State Handling

For games with large state (complex simulations, many entities):

1. **Use TransformingTransport** for automatic compression
2. **Optimize serialization** - binary formats, not JSON
3. **Consider delta sync** - only send changes (not built-in, game-level optimization)
4. **Reduce snapshot frequency** - if rollbacks are rare

```typescript
import { TransformingTransport, WebRTCTransport } from 'rollback-netcode';

// Wrap transport with compression for large states
const transport = new TransformingTransport(
  new WebRTCTransport(peerId, { onSignal }),
  {
    compression: 'auto',
    maxSegmentSize: 14000,  // Leave headroom for WebRTC overhead
  }
);
```
