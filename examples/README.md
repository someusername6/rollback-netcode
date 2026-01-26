# Examples

This directory contains example implementations demonstrating how to use rollback-netcode.

## Local Transport Demo

**Location:** `local-transport/`

A browser-based demo that simulates multiple players locally using `LocalTransport`. No server required - everything runs in a single browser tab.

**Features:**
- Add/remove players dynamically
- Switch between Star and Mesh topologies
- Adjust simulated latency and jitter
- Induce desyncs to see detection/recovery
- View RTT and rollback statistics

**Running:**
```bash
# From the repository root
npm run build        # Build the library
npm run serve:demo   # Build demo and start HTTP server on port 3000
```

Then open http://localhost:3000 in your browser.

**Live demo:** https://someusername6.github.io/rollback-netcode

---

## WebRTC Demo

**Location:** `webrtc/`

A real-network demo using WebRTC for peer-to-peer connections. Requires a signaling server to establish connections, then uses `WebRTCTransport` for game traffic.

**Features:**
- Real WebRTC connections between browser tabs
- Minimal WebSocket signaling server (~130 lines)
- Create/join rooms with room IDs
- Demonstrates `WebRTCTransport` integration

**Running:**
```bash
# From the repository root
npm run build        # Build the library

# From examples/webrtc/
cd examples/webrtc
npm install          # Install ws dependency
npm start            # Build client and start signaling server on port 8080
```

Then open `examples/webrtc/index.html` in multiple browser tabs:
1. First tab: Click "Create Room" - note the room ID
2. Other tabs: Enter the room ID and click "Join"

The game starts automatically when 2 players are connected.
