# Local Transport Demo

A browser-based demo that simulates multiple players locally using `LocalTransport`. No server required—everything runs in a single browser tab.

See [examples/README.md](../README.md) for quick start instructions.

**Live demo:** https://someusername6.github.io/rollback-netcode

## Features

- Add/remove players dynamically (up to 16)
- Switch between Star and Mesh topologies
- Adjust simulated latency and jitter in real-time
- Induce desyncs to observe detection and recovery
- View RTT and rollback statistics per player

## How It Works

This demo uses `LocalTransport` to simulate network connections between players without actual network traffic. Messages are queued and delivered after a configurable delay to simulate latency.

### Key Concepts Demonstrated

1. **Topology (Star vs Mesh)**
   - *Star*: All clients connect only to the host. Host relays messages. Lower bandwidth but host is single point of failure.
   - *Mesh*: All clients connect to each other directly. More bandwidth but more resilient.

2. **Desync Authority (Host vs Peer)**
   - *Host*: Only the host checks for desyncs by comparing state hashes.
   - *Peer*: All peers check for desyncs independently.

3. **Rollback**
   - When a player's input arrives late, the library restores a snapshot, re-simulates with correct inputs, and continues. This happens automatically.

4. **Simulated Latency**
   - Adjust the latency slider to see how the rollback system handles delayed inputs. Higher latency = more rollbacks.

## Files

- `demo.ts` - Main demo logic (DemoManager class)
- `game.ts` - DotGame implementation (colored dots that move with arrow keys)
- `index.html` - UI with control panel
- `styles.css` - Styling
