/**
 * Minimal WebSocket signaling server for WebRTC peer connections.
 *
 * This server relays signaling messages (offers, answers, ICE candidates)
 * between peers to establish WebRTC connections.
 *
 * Run with: npx tsx server.ts
 */

import { WebSocketServer, WebSocket } from "ws";

const PORT = 8080;

interface Peer {
  id: string;
  ws: WebSocket;
  room: string | null;
}

interface SignalMessage {
  type: "join" | "leave" | "signal" | "peers";
  room?: string;
  peerId?: string;
  targetPeerId?: string;
  signal?: unknown;
  peers?: string[];
}

const peers = new Map<WebSocket, Peer>();
const rooms = new Map<string, Set<string>>();

function broadcast(room: string, message: SignalMessage, exclude?: string) {
  const roomPeers = rooms.get(room);
  if (!roomPeers) return;

  const data = JSON.stringify(message);
  for (const peerId of roomPeers) {
    if (peerId === exclude) continue;
    for (const [ws, peer] of peers) {
      if (peer.id === peerId && ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    }
  }
}

function sendTo(ws: WebSocket, message: SignalMessage) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

function findPeerSocket(peerId: string): WebSocket | null {
  for (const [ws, peer] of peers) {
    if (peer.id === peerId) return ws;
  }
  return null;
}

const wss = new WebSocketServer({ port: PORT });

wss.on("connection", (ws) => {
  console.log("New connection");

  ws.on("message", (data) => {
    let msg: SignalMessage;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      console.error("Invalid JSON");
      return;
    }

    if (msg.type === "join" && msg.room && msg.peerId) {
      // Register peer
      const peer: Peer = { id: msg.peerId, ws, room: msg.room };
      peers.set(ws, peer);

      // Add to room
      if (!rooms.has(msg.room)) {
        rooms.set(msg.room, new Set());
      }
      const room = rooms.get(msg.room)!;

      // Send existing peers to the new peer
      sendTo(ws, { type: "peers", peers: Array.from(room) });

      // Add new peer to room and notify others
      room.add(msg.peerId);
      broadcast(msg.room, { type: "join", peerId: msg.peerId }, msg.peerId);

      console.log(`${msg.peerId} joined room ${msg.room} (${room.size} peers)`);
    } else if (msg.type === "signal" && msg.targetPeerId && msg.signal) {
      // Relay signal to target peer
      const sender = peers.get(ws);
      if (!sender) return;

      const targetWs = findPeerSocket(msg.targetPeerId);
      if (targetWs) {
        sendTo(targetWs, {
          type: "signal",
          peerId: sender.id,
          signal: msg.signal,
        });
      }
    }
  });

  ws.on("close", () => {
    const peer = peers.get(ws);
    if (peer) {
      peers.delete(ws);
      if (peer.room) {
        const room = rooms.get(peer.room);
        if (room) {
          room.delete(peer.id);
          broadcast(peer.room, { type: "leave", peerId: peer.id });
          console.log(`${peer.id} left room ${peer.room} (${room.size} peers)`);
          if (room.size === 0) {
            rooms.delete(peer.room);
          }
        }
      }
    }
  });
});

console.log(`Signaling server running on ws://localhost:${PORT}`);
