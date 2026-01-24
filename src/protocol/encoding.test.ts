import { describe, it } from "node:test";
import assert from "node:assert";
import { decodeMessage, encodeMessage } from "./encoding.js";
import { MessageType } from "./messages.js";
import { asPlayerId, asTick } from "../types.js";

describe("Message Encoding/Decoding", () => {
  describe("InputMessage", () => {
    it("should round-trip encode/decode", () => {
      const original = {
        type: MessageType.Input as const,
        playerId: asPlayerId("player-1"),
        inputs: [
          { tick: asTick(10), input: new Uint8Array([1, 2, 3]) },
          { tick: asTick(9), input: new Uint8Array([4, 5]) },
        ],
      };

      const encoded = encodeMessage(original);
      const decoded = decodeMessage(encoded);

      assert.deepStrictEqual(decoded.type, original.type);
      assert.strictEqual(decoded.type, MessageType.Input);
      if (decoded.type === MessageType.Input) {
        assert.strictEqual(decoded.playerId, original.playerId);
        assert.strictEqual(decoded.inputs.length, 2);
        assert.strictEqual(decoded.inputs[0]?.tick, 10);
        assert.deepStrictEqual(decoded.inputs[0]?.input, new Uint8Array([1, 2, 3]));
        assert.strictEqual(decoded.inputs[1]?.tick, 9);
        assert.deepStrictEqual(decoded.inputs[1]?.input, new Uint8Array([4, 5]));
      }
    });

    it("should handle empty inputs array", () => {
      const original = {
        type: MessageType.Input as const,
        playerId: asPlayerId("p1"),
        inputs: [],
      };

      const encoded = encodeMessage(original);
      const decoded = decodeMessage(encoded);

      assert.strictEqual(decoded.type, MessageType.Input);
      if (decoded.type === MessageType.Input) {
        assert.strictEqual(decoded.inputs.length, 0);
      }
    });
  });

  describe("InputAckMessage", () => {
    it("should round-trip encode/decode", () => {
      const original = {
        type: MessageType.InputAck as const,
        playerId: asPlayerId("player-2"),
        ackedTick: asTick(42),
      };

      const encoded = encodeMessage(original);
      const decoded = decodeMessage(encoded);

      assert.strictEqual(decoded.type, MessageType.InputAck);
      if (decoded.type === MessageType.InputAck) {
        assert.strictEqual(decoded.playerId, original.playerId);
        assert.strictEqual(decoded.ackedTick, 42);
      }
    });
  });

  describe("HashMessage", () => {
    it("should round-trip encode/decode", () => {
      const original = {
        type: MessageType.Hash as const,
        playerId: asPlayerId("player-1"),
        tick: asTick(100),
        hash: 0x12345678,
      };

      const encoded = encodeMessage(original);
      const decoded = decodeMessage(encoded);

      assert.strictEqual(decoded.type, MessageType.Hash);
      if (decoded.type === MessageType.Hash) {
        assert.strictEqual(decoded.playerId, original.playerId);
        assert.strictEqual(decoded.tick, 100);
        assert.strictEqual(decoded.hash, original.hash);
      }
    });

    it("should handle negative hash values", () => {
      const original = {
        type: MessageType.Hash as const,
        playerId: asPlayerId("p1"),
        tick: asTick(1),
        hash: -12345,
      };

      const encoded = encodeMessage(original);
      const decoded = decodeMessage(encoded);

      assert.strictEqual(decoded.type, MessageType.Hash);
      if (decoded.type === MessageType.Hash) {
        assert.strictEqual(decoded.hash, -12345);
      }
    });
  });

  describe("SyncMessage", () => {
    it("should round-trip encode/decode", () => {
      const original = {
        type: MessageType.Sync as const,
        tick: asTick(50),
        state: new Uint8Array([10, 20, 30, 40]),
        hash: 999,
        playerTimeline: [
          { playerId: asPlayerId("p1"), joinTick: asTick(0), leaveTick: null },
          { playerId: asPlayerId("p2"), joinTick: asTick(10), leaveTick: asTick(40) },
        ],
      };

      const encoded = encodeMessage(original);
      const decoded = decodeMessage(encoded);

      assert.strictEqual(decoded.type, MessageType.Sync);
      if (decoded.type === MessageType.Sync) {
        assert.strictEqual(decoded.tick, 50);
        assert.deepStrictEqual(decoded.state, original.state);
        assert.strictEqual(decoded.hash, 999);
        assert.strictEqual(decoded.playerTimeline.length, 2);
        assert.strictEqual(decoded.playerTimeline[0]?.playerId, "p1");
        assert.strictEqual(decoded.playerTimeline[0]?.joinTick, 0);
        assert.strictEqual(decoded.playerTimeline[0]?.leaveTick, null);
        assert.strictEqual(decoded.playerTimeline[1]?.playerId, "p2");
        assert.strictEqual(decoded.playerTimeline[1]?.joinTick, 10);
        assert.strictEqual(decoded.playerTimeline[1]?.leaveTick, 40);
      }
    });
  });

  describe("SyncRequestMessage", () => {
    it("should round-trip encode/decode", () => {
      const original = {
        type: MessageType.SyncRequest as const,
        playerId: asPlayerId("player-1"),
        desyncTick: asTick(75),
        localHash: 0xabcdef,
      };

      const encoded = encodeMessage(original);
      const decoded = decodeMessage(encoded);

      assert.strictEqual(decoded.type, MessageType.SyncRequest);
      if (decoded.type === MessageType.SyncRequest) {
        assert.strictEqual(decoded.playerId, original.playerId);
        assert.strictEqual(decoded.desyncTick, 75);
        assert.strictEqual(decoded.localHash, original.localHash);
      }
    });
  });

  describe("PauseMessage", () => {
    it("should round-trip encode/decode", () => {
      const original = {
        type: MessageType.Pause as const,
        playerId: asPlayerId("host"),
        pauseTick: asTick(200),
      };

      const encoded = encodeMessage(original);
      const decoded = decodeMessage(encoded);

      assert.strictEqual(decoded.type, MessageType.Pause);
      if (decoded.type === MessageType.Pause) {
        assert.strictEqual(decoded.playerId, "host");
        assert.strictEqual(decoded.pauseTick, 200);
      }
    });
  });

  describe("ResumeMessage", () => {
    it("should round-trip encode/decode", () => {
      const original = {
        type: MessageType.Resume as const,
        playerId: asPlayerId("host"),
        resumeTick: asTick(210),
      };

      const encoded = encodeMessage(original);
      const decoded = decodeMessage(encoded);

      assert.strictEqual(decoded.type, MessageType.Resume);
      if (decoded.type === MessageType.Resume) {
        assert.strictEqual(decoded.playerId, "host");
        assert.strictEqual(decoded.resumeTick, 210);
      }
    });
  });

  describe("JoinRequestMessage", () => {
    it("should round-trip encode/decode", () => {
      const original = {
        type: MessageType.JoinRequest as const,
        playerId: asPlayerId("new-player"),
      };

      const encoded = encodeMessage(original);
      const decoded = decodeMessage(encoded);

      assert.strictEqual(decoded.type, MessageType.JoinRequest);
      if (decoded.type === MessageType.JoinRequest) {
        assert.strictEqual(decoded.playerId, "new-player");
      }
    });
  });

  describe("JoinAcceptMessage", () => {
    it("should round-trip encode/decode", () => {
      const original = {
        type: MessageType.JoinAccept as const,
        playerId: asPlayerId("new-player"),
        roomId: "room-abc-123",
        config: { tickRate: 60, maxPlayers: 4 },
        players: [asPlayerId("host"), asPlayerId("player-2")],
      };

      const encoded = encodeMessage(original);
      const decoded = decodeMessage(encoded);

      assert.strictEqual(decoded.type, MessageType.JoinAccept);
      if (decoded.type === MessageType.JoinAccept) {
        assert.strictEqual(decoded.playerId, "new-player");
        assert.strictEqual(decoded.roomId, "room-abc-123");
        assert.strictEqual(decoded.config.tickRate, 60);
        assert.strictEqual(decoded.config.maxPlayers, 4);
        assert.deepStrictEqual(decoded.players, ["host", "player-2"]);
      }
    });
  });

  describe("JoinRejectMessage", () => {
    it("should round-trip encode/decode", () => {
      const original = {
        type: MessageType.JoinReject as const,
        playerId: asPlayerId("rejected-player"),
        reason: "Room is full",
      };

      const encoded = encodeMessage(original);
      const decoded = decodeMessage(encoded);

      assert.strictEqual(decoded.type, MessageType.JoinReject);
      if (decoded.type === MessageType.JoinReject) {
        assert.strictEqual(decoded.playerId, "rejected-player");
        assert.strictEqual(decoded.reason, "Room is full");
      }
    });
  });

  describe("StateSyncMessage", () => {
    it("should round-trip encode/decode", () => {
      const original = {
        type: MessageType.StateSync as const,
        tick: asTick(100),
        state: new Uint8Array([1, 2, 3, 4, 5]),
        hash: 12345,
        playerTimeline: [
          { playerId: asPlayerId("p1"), joinTick: asTick(0), leaveTick: null },
        ],
      };

      const encoded = encodeMessage(original);
      const decoded = decodeMessage(encoded);

      assert.strictEqual(decoded.type, MessageType.StateSync);
      if (decoded.type === MessageType.StateSync) {
        assert.strictEqual(decoded.tick, 100);
        assert.deepStrictEqual(decoded.state, original.state);
        assert.strictEqual(decoded.hash, 12345);
        assert.strictEqual(decoded.playerTimeline.length, 1);
      }
    });
  });

  describe("PlayerJoinedMessage", () => {
    it("should round-trip encode/decode", () => {
      const original = {
        type: MessageType.PlayerJoined as const,
        playerId: asPlayerId("player-3"),
        joinTick: asTick(50),
      };

      const encoded = encodeMessage(original);
      const decoded = decodeMessage(encoded);

      assert.strictEqual(decoded.type, MessageType.PlayerJoined);
      if (decoded.type === MessageType.PlayerJoined) {
        assert.strictEqual(decoded.playerId, "player-3");
        assert.strictEqual(decoded.joinTick, 50);
      }
    });
  });

  describe("PlayerLeftMessage", () => {
    it("should round-trip encode/decode", () => {
      const original = {
        type: MessageType.PlayerLeft as const,
        playerId: asPlayerId("player-2"),
        leaveTick: asTick(75),
      };

      const encoded = encodeMessage(original);
      const decoded = decodeMessage(encoded);

      assert.strictEqual(decoded.type, MessageType.PlayerLeft);
      if (decoded.type === MessageType.PlayerLeft) {
        assert.strictEqual(decoded.playerId, "player-2");
        assert.strictEqual(decoded.leaveTick, 75);
      }
    });
  });

  describe("PingMessage", () => {
    it("should round-trip encode/decode", () => {
      const original = {
        type: MessageType.Ping as const,
        timestamp: Date.now(),
      };

      const encoded = encodeMessage(original);
      const decoded = decodeMessage(encoded);

      assert.strictEqual(decoded.type, MessageType.Ping);
      if (decoded.type === MessageType.Ping) {
        assert.strictEqual(decoded.timestamp, original.timestamp);
      }
    });
  });

  describe("PongMessage", () => {
    it("should round-trip encode/decode", () => {
      const original = {
        type: MessageType.Pong as const,
        timestamp: Date.now(),
      };

      const encoded = encodeMessage(original);
      const decoded = decodeMessage(encoded);

      assert.strictEqual(decoded.type, MessageType.Pong);
      if (decoded.type === MessageType.Pong) {
        assert.strictEqual(decoded.timestamp, original.timestamp);
      }
    });
  });

  describe("Error handling", () => {
    it("should throw on empty message", () => {
      assert.throws(() => {
        decodeMessage(new Uint8Array(0));
      }, /Empty message/);
    });

    it("should throw on unknown message type", () => {
      assert.throws(() => {
        decodeMessage(new Uint8Array([0xff]));
      }, /Unknown message type/);
    });
  });
});
