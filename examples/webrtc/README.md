# WebRTC Demo

Demonstrates `WebRTCTransport` with a minimal WebSocket signaling server.

See [examples/README.md](../README.md) for quick start instructions.

## Files

- `server.ts` - WebSocket signaling server (relays WebRTC offers/answers/ICE candidates)
- `client.ts` - Browser client with DotGame implementation
- `index.html` - UI for creating/joining rooms

## How It Works

### Signaling Flow

1. Host creates a room and joins the signaling server
2. Client joins the same room, receives list of existing peers
3. Client initiates WebRTC connection to host (creates offer)
4. Signaling server relays offer to host
5. Host creates answer, signaling server relays it back
6. ICE candidates are exchanged via signaling server
7. Once WebRTC data channel is open, game session handshake begins

### Key Integration Points

```typescript
// Create WebRTC transport
const transport = new WebRTCTransport(peerId);

// Set signaling callback
transport.setSignalingCallbacks({
  onSignal: (targetPeerId, signal) => {
    signalingClient.sendSignal(targetPeerId, signal);
  },
});

// Handle incoming signals from signaling server
signalingClient.onSignal = (fromPeerId, signal) => {
  if (signal.type === 'description') {
    transport.handleRemoteDescription(fromPeerId, signal.description);
  } else {
    transport.handleRemoteCandidate(fromPeerId, signal.candidate);
  }
};

// Initiate connection to a peer (call after signaling is ready)
transport.connect(remotePeerId);
```
