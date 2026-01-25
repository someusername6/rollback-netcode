import assert from "node:assert";
import { describe, it } from "node:test";
import { PauseReason, PlayerRole, asPlayerId, asTick } from "../../src/types.js";
import { DecodeError, EncodeError, decodeMessage, encodeMessage } from "../../src/protocol/encoding.js";
import { MessageType } from "../../src/protocol/messages.js";

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
				assert.deepStrictEqual(
					decoded.inputs[0]?.input,
					new Uint8Array([1, 2, 3]),
				);
				assert.strictEqual(decoded.inputs[1]?.tick, 9);
				assert.deepStrictEqual(
					decoded.inputs[1]?.input,
					new Uint8Array([4, 5]),
				);
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

		it("should throw EncodeError when inputs exceed 255", () => {
			// Create message with 256 inputs (exceeds Uint8 max)
			const inputs = Array.from({ length: 256 }, (_, i) => ({
				tick: asTick(i),
				input: new Uint8Array([1]),
			}));

			const msg = {
				type: MessageType.Input as const,
				playerId: asPlayerId("player-1"),
				inputs,
			};

			assert.throws(
				() => encodeMessage(msg),
				(error: unknown) => {
					assert.ok(error instanceof EncodeError);
					assert.strictEqual(error.field, "inputs.length");
					assert.strictEqual(error.maxValue, 255);
					assert.strictEqual(error.actualValue, 256);
					return true;
				},
			);
		});

		it("should throw EncodeError when single input exceeds MAX_INPUT_SIZE_PER_FRAME", () => {
			// MAX_INPUT_SIZE_PER_FRAME is 1024 bytes
			const largeInput = new Uint8Array(1025);
			const msg = {
				type: MessageType.Input as const,
				playerId: asPlayerId("player-1"),
				inputs: [{ tick: asTick(0), input: largeInput }],
			};

			assert.throws(
				() => encodeMessage(msg),
				(error: unknown) => {
					assert.ok(error instanceof EncodeError);
					assert.ok(error.field.includes("input.length"));
					assert.strictEqual(error.maxValue, 1024);
					assert.strictEqual(error.actualValue, 1025);
					return true;
				},
			);
		});

		it("should throw EncodeError when total message size exceeds MAX_INPUT_MESSAGE_SIZE", () => {
			// MAX_INPUT_MESSAGE_SIZE is 65536 bytes
			// Create many small inputs that exceed total size
			const inputs = Array.from({ length: 255 }, (_, i) => ({
				tick: asTick(i),
				input: new Uint8Array(300), // 255 * 300 + overhead > 65536
			}));

			const msg = {
				type: MessageType.Input as const,
				playerId: asPlayerId("player-1"),
				inputs,
			};

			assert.throws(
				() => encodeMessage(msg),
				(error: unknown) => {
					assert.ok(error instanceof EncodeError);
					assert.strictEqual(error.field, "totalSize");
					assert.strictEqual(error.maxValue, 65536);
					return true;
				},
			);
		});

		it("should throw DecodeError when decoding message with oversized input frame", () => {
			// Manually craft a malicious message with a large inputLen field
			// Format: type(1) + playerIdLen(2) + playerId + inputCount(1) + [tick(4) + inputLen(2) + input]*
			const playerId = "p1";
			const playerIdBytes = new TextEncoder().encode(playerId);

			// Create a buffer that claims to have a 2000-byte input (exceeds 1024 limit)
			const maliciousSize = 2000;
			const buffer = new Uint8Array(
				1 + 2 + playerIdBytes.length + 1 + 4 + 2 + maliciousSize
			);
			const view = new DataView(buffer.buffer);

			let offset = 0;
			view.setUint8(offset++, MessageType.Input);
			view.setUint16(offset, playerIdBytes.length);
			offset += 2;
			buffer.set(playerIdBytes, offset);
			offset += playerIdBytes.length;
			view.setUint8(offset++, 1); // 1 input
			view.setInt32(offset, 0); // tick 0
			offset += 4;
			view.setUint16(offset, maliciousSize); // Oversized input length
			offset += 2;
			// Fill with zeros (actual data)

			assert.throws(
				() => decodeMessage(buffer),
				(error: unknown) => {
					assert.ok(error instanceof DecodeError);
					assert.ok(error.message.includes("exceeds maximum size"));
					return true;
				},
			);
		});

		it("should throw DecodeError when decoding oversized message", () => {
			// Create a message larger than MAX_INPUT_MESSAGE_SIZE
			const oversizedBuffer = new Uint8Array(70000);
			oversizedBuffer[0] = MessageType.Input;

			assert.throws(
				() => decodeMessage(oversizedBuffer),
				(error: unknown) => {
					assert.ok(error instanceof DecodeError);
					assert.ok(error.message.includes("exceeds maximum size"));
					return true;
				},
			);
		});

		it("should accept input at exactly MAX_INPUT_SIZE_PER_FRAME", () => {
			const maxInput = new Uint8Array(1024);
			const msg = {
				type: MessageType.Input as const,
				playerId: asPlayerId("p1"),
				inputs: [{ tick: asTick(0), input: maxInput }],
			};

			// Should not throw
			const encoded = encodeMessage(msg);
			const decoded = decodeMessage(encoded);

			assert.strictEqual(decoded.type, MessageType.Input);
			if (decoded.type === MessageType.Input) {
				assert.strictEqual(decoded.inputs[0]?.input.length, 1024);
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

		it("should handle large unsigned hash values", () => {
			// Hash values are unsigned (game.hash() returns h >>> 0)
			// Test with a value > 2^31-1 to ensure unsigned handling
			const largeHash = 3742115636; // This caused signed/unsigned bugs previously
			const original = {
				type: MessageType.Hash as const,
				playerId: asPlayerId("p1"),
				tick: asTick(1),
				hash: largeHash,
			};

			const encoded = encodeMessage(original);
			const decoded = decodeMessage(encoded);

			assert.strictEqual(decoded.type, MessageType.Hash);
			if (decoded.type === MessageType.Hash) {
				assert.strictEqual(decoded.hash, largeHash);
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
					{
						playerId: asPlayerId("p2"),
						joinTick: asTick(10),
						leaveTick: asTick(40),
					},
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
				reason: PauseReason.PlayerRequest,
			};

			const encoded = encodeMessage(original);
			const decoded = decodeMessage(encoded);

			assert.strictEqual(decoded.type, MessageType.Pause);
			if (decoded.type === MessageType.Pause) {
				assert.strictEqual(decoded.playerId, "host");
				assert.strictEqual(decoded.pauseTick, 200);
				assert.strictEqual(decoded.reason, PauseReason.PlayerRequest);
			}
		});

		it("should encode all pause reasons", () => {
			const reasons = [
				PauseReason.PlayerRequest,
				PauseReason.PlayerDisconnect,
				PauseReason.ExcessiveLag,
			];
			for (const reason of reasons) {
				const original = {
					type: MessageType.Pause as const,
					playerId: asPlayerId("host"),
					pauseTick: asTick(100),
					reason,
				};
				const encoded = encodeMessage(original);
				const decoded = decodeMessage(encoded);
				if (decoded.type === MessageType.Pause) {
					assert.strictEqual(decoded.reason, reason);
				}
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

		it("should encode buffer with correct size", () => {
			const playerId = "test-player";
			const reason = "Game already started";
			const original = {
				type: MessageType.JoinReject as const,
				playerId: asPlayerId(playerId),
				reason,
			};

			const encoded = encodeMessage(original);

			// Expected size: type(1) + playerIdLen(2) + playerId + reasonLen(2) + reason
			const expectedSize = 1 + 2 + playerId.length + 2 + reason.length;
			assert.strictEqual(
				encoded.length,
				expectedSize,
				`Buffer should be exactly ${expectedSize} bytes`,
			);
		});

		it("should handle long player ID and reason", () => {
			const playerId = "very-long-player-id-that-exceeds-typical-length";
			const reason =
				"This is a very detailed rejection reason that explains exactly why the player was not allowed to join the game session";
			const original = {
				type: MessageType.JoinReject as const,
				playerId: asPlayerId(playerId),
				reason,
			};

			const encoded = encodeMessage(original);
			const decoded = decodeMessage(encoded);

			assert.strictEqual(decoded.type, MessageType.JoinReject);
			if (decoded.type === MessageType.JoinReject) {
				assert.strictEqual(decoded.playerId, playerId);
				assert.strictEqual(decoded.reason, reason);
			}
		});

		it("should handle empty reason", () => {
			const original = {
				type: MessageType.JoinReject as const,
				playerId: asPlayerId("player"),
				reason: "",
			};

			const encoded = encodeMessage(original);
			const decoded = decodeMessage(encoded);

			assert.strictEqual(decoded.type, MessageType.JoinReject);
			if (decoded.type === MessageType.JoinReject) {
				assert.strictEqual(decoded.reason, "");
			}
		});

		it("should handle unicode in reason", () => {
			const original = {
				type: MessageType.JoinReject as const,
				playerId: asPlayerId("player"),
				reason: "部屋がいっぱいです",
			};

			const encoded = encodeMessage(original);
			const decoded = decodeMessage(encoded);

			assert.strictEqual(decoded.type, MessageType.JoinReject);
			if (decoded.type === MessageType.JoinReject) {
				assert.strictEqual(decoded.reason, "部屋がいっぱいです");
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
		it("should round-trip encode/decode player", () => {
			const original = {
				type: MessageType.PlayerJoined as const,
				playerId: asPlayerId("player-3"),
				joinTick: asTick(50),
				role: PlayerRole.Player,
			};

			const encoded = encodeMessage(original);
			const decoded = decodeMessage(encoded);

			assert.strictEqual(decoded.type, MessageType.PlayerJoined);
			if (decoded.type === MessageType.PlayerJoined) {
				assert.strictEqual(decoded.playerId, "player-3");
				assert.strictEqual(decoded.joinTick, 50);
				assert.strictEqual(decoded.role, PlayerRole.Player);
			}
		});

		it("should round-trip encode/decode spectator", () => {
			const original = {
				type: MessageType.PlayerJoined as const,
				playerId: asPlayerId("spectator-1"),
				joinTick: asTick(100),
				role: PlayerRole.Spectator,
			};

			const encoded = encodeMessage(original);
			const decoded = decodeMessage(encoded);

			assert.strictEqual(decoded.type, MessageType.PlayerJoined);
			if (decoded.type === MessageType.PlayerJoined) {
				assert.strictEqual(decoded.playerId, "spectator-1");
				assert.strictEqual(decoded.joinTick, 100);
				assert.strictEqual(decoded.role, PlayerRole.Spectator);
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

	describe("LagReportMessage", () => {
		it("should round-trip encode/decode", () => {
			const original = {
				type: MessageType.LagReport as const,
				laggyPlayerId: asPlayerId("slow-player"),
				ticksBehind: 45,
			};

			const encoded = encodeMessage(original);
			const decoded = decodeMessage(encoded);

			assert.strictEqual(decoded.type, MessageType.LagReport);
			if (decoded.type === MessageType.LagReport) {
				assert.strictEqual(decoded.laggyPlayerId, "slow-player");
				assert.strictEqual(decoded.ticksBehind, 45);
			}
		});
	});

	describe("DisconnectReportMessage", () => {
		it("should round-trip encode/decode", () => {
			const original = {
				type: MessageType.DisconnectReport as const,
				disconnectedPeerId: asPlayerId("disconnected-player"),
			};

			const encoded = encodeMessage(original);
			const decoded = decodeMessage(encoded);

			assert.strictEqual(decoded.type, MessageType.DisconnectReport);
			if (decoded.type === MessageType.DisconnectReport) {
				assert.strictEqual(decoded.disconnectedPeerId, "disconnected-player");
			}
		});

		it("should encode buffer with correct size", () => {
			const peerId = "peer-123";
			const original = {
				type: MessageType.DisconnectReport as const,
				disconnectedPeerId: asPlayerId(peerId),
			};

			const encoded = encodeMessage(original);

			// Expected size: type(1) + peerIdLen(2) + peerId
			const expectedSize = 1 + 2 + peerId.length;
			assert.strictEqual(
				encoded.length,
				expectedSize,
				`Buffer should be exactly ${expectedSize} bytes`,
			);
		});

		it("should handle long peer ID", () => {
			const peerId = "very-long-peer-identifier-that-might-be-a-uuid-or-similar-format-12345";
			const original = {
				type: MessageType.DisconnectReport as const,
				disconnectedPeerId: asPlayerId(peerId),
			};

			const encoded = encodeMessage(original);
			const decoded = decodeMessage(encoded);

			assert.strictEqual(decoded.type, MessageType.DisconnectReport);
			if (decoded.type === MessageType.DisconnectReport) {
				assert.strictEqual(decoded.disconnectedPeerId, peerId);
			}
		});

		it("should handle short peer ID", () => {
			const original = {
				type: MessageType.DisconnectReport as const,
				disconnectedPeerId: asPlayerId("p1"),
			};

			const encoded = encodeMessage(original);
			const decoded = decodeMessage(encoded);

			assert.strictEqual(decoded.type, MessageType.DisconnectReport);
			if (decoded.type === MessageType.DisconnectReport) {
				assert.strictEqual(decoded.disconnectedPeerId, "p1");
			}
		});
	});

	describe("ResumeCountdownMessage", () => {
		it("should round-trip encode/decode", () => {
			const original = {
				type: MessageType.ResumeCountdown as const,
				secondsRemaining: 5,
			};

			const encoded = encodeMessage(original);
			const decoded = decodeMessage(encoded);

			assert.strictEqual(decoded.type, MessageType.ResumeCountdown);
			if (decoded.type === MessageType.ResumeCountdown) {
				assert.strictEqual(decoded.secondsRemaining, 5);
			}
		});
	});

	describe("DropPlayerMessage", () => {
		it("should round-trip encode/decode without metadata", () => {
			const original = {
				type: MessageType.DropPlayer as const,
				playerId: asPlayerId("dropped-player"),
			};

			const encoded = encodeMessage(original);
			const decoded = decodeMessage(encoded);

			assert.strictEqual(decoded.type, MessageType.DropPlayer);
			if (decoded.type === MessageType.DropPlayer) {
				assert.strictEqual(decoded.playerId, "dropped-player");
				assert.strictEqual(decoded.metadata, undefined);
			}
		});

		it("should round-trip encode/decode with metadata", () => {
			const original = {
				type: MessageType.DropPlayer as const,
				playerId: asPlayerId("dropped-player"),
				metadata: new Uint8Array([1, 2, 3, 4, 5]),
			};

			const encoded = encodeMessage(original);
			const decoded = decodeMessage(encoded);

			assert.strictEqual(decoded.type, MessageType.DropPlayer);
			if (decoded.type === MessageType.DropPlayer) {
				assert.strictEqual(decoded.playerId, "dropped-player");
				assert.deepStrictEqual(decoded.metadata, original.metadata);
			}
		});

		it("should encode buffer with correct size without metadata", () => {
			const playerId = "player-to-drop";
			const original = {
				type: MessageType.DropPlayer as const,
				playerId: asPlayerId(playerId),
			};

			const encoded = encodeMessage(original);

			// Expected size: type(1) + playerIdLen(2) + playerId + hasMetadata(1)
			const expectedSize = 1 + 2 + playerId.length + 1;
			assert.strictEqual(
				encoded.length,
				expectedSize,
				`Buffer should be exactly ${expectedSize} bytes`,
			);
		});

		it("should encode buffer with correct size with metadata", () => {
			const playerId = "player-to-drop";
			const metadata = new Uint8Array([10, 20, 30, 40, 50]);
			const original = {
				type: MessageType.DropPlayer as const,
				playerId: asPlayerId(playerId),
				metadata,
			};

			const encoded = encodeMessage(original);

			// Expected size: type(1) + playerIdLen(2) + playerId + hasMetadata(1) + metadataLen(4) + metadata
			const expectedSize = 1 + 2 + playerId.length + 1 + 4 + metadata.length;
			assert.strictEqual(
				encoded.length,
				expectedSize,
				`Buffer should be exactly ${expectedSize} bytes`,
			);
		});

		it("should handle large metadata", () => {
			const largeMetadata = new Uint8Array(1000);
			for (let i = 0; i < largeMetadata.length; i++) {
				largeMetadata[i] = i % 256;
			}

			const original = {
				type: MessageType.DropPlayer as const,
				playerId: asPlayerId("player"),
				metadata: largeMetadata,
			};

			const encoded = encodeMessage(original);
			const decoded = decodeMessage(encoded);

			assert.strictEqual(decoded.type, MessageType.DropPlayer);
			if (decoded.type === MessageType.DropPlayer) {
				assert.deepStrictEqual(decoded.metadata, largeMetadata);
			}
		});

		it("should handle empty metadata", () => {
			const original = {
				type: MessageType.DropPlayer as const,
				playerId: asPlayerId("player"),
				metadata: new Uint8Array(0),
			};

			const encoded = encodeMessage(original);
			const decoded = decodeMessage(encoded);

			assert.strictEqual(decoded.type, MessageType.DropPlayer);
			if (decoded.type === MessageType.DropPlayer) {
				assert.deepStrictEqual(decoded.metadata, new Uint8Array(0));
			}
		});

		it("should handle long player ID with metadata", () => {
			const playerId = "very-long-player-identifier-for-testing-purposes";
			const metadata = new Uint8Array([1, 2, 3]);

			const original = {
				type: MessageType.DropPlayer as const,
				playerId: asPlayerId(playerId),
				metadata,
			};

			const encoded = encodeMessage(original);
			const decoded = decodeMessage(encoded);

			assert.strictEqual(decoded.type, MessageType.DropPlayer);
			if (decoded.type === MessageType.DropPlayer) {
				assert.strictEqual(decoded.playerId, playerId);
				assert.deepStrictEqual(decoded.metadata, metadata);
			}
		});
	});

	describe("JoinRequestMessage with role", () => {
		it("should round-trip encode/decode with player role", () => {
			const original = {
				type: MessageType.JoinRequest as const,
				playerId: asPlayerId("player-1"),
				role: PlayerRole.Player,
			};

			const encoded = encodeMessage(original);
			const decoded = decodeMessage(encoded);

			assert.strictEqual(decoded.type, MessageType.JoinRequest);
			if (decoded.type === MessageType.JoinRequest) {
				assert.strictEqual(decoded.playerId, "player-1");
				assert.strictEqual(decoded.role, PlayerRole.Player);
			}
		});

		it("should round-trip encode/decode with spectator role", () => {
			const original = {
				type: MessageType.JoinRequest as const,
				playerId: asPlayerId("spectator-1"),
				role: PlayerRole.Spectator,
			};

			const encoded = encodeMessage(original);
			const decoded = decodeMessage(encoded);

			assert.strictEqual(decoded.type, MessageType.JoinRequest);
			if (decoded.type === MessageType.JoinRequest) {
				assert.strictEqual(decoded.playerId, "spectator-1");
				assert.strictEqual(decoded.role, PlayerRole.Spectator);
			}
		});

		it("should round-trip encode/decode without role", () => {
			const original = {
				type: MessageType.JoinRequest as const,
				playerId: asPlayerId("player-1"),
			};

			const encoded = encodeMessage(original);
			const decoded = decodeMessage(encoded);

			assert.strictEqual(decoded.type, MessageType.JoinRequest);
			if (decoded.type === MessageType.JoinRequest) {
				assert.strictEqual(decoded.playerId, "player-1");
				assert.strictEqual(decoded.role, undefined);
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

	describe("DecodeError", () => {
		it("should include message type in error message when provided", () => {
			const error = new DecodeError("Test error", MessageType.Input, 10, 20, 5);
			assert.ok(error.message.includes(`message type: ${MessageType.Input}`));
			assert.strictEqual(error.messageType, MessageType.Input);
			assert.strictEqual(error.offset, 10);
			assert.strictEqual(error.expected, 20);
			assert.strictEqual(error.actual, 5);
			assert.strictEqual(error.name, "DecodeError");
		});

		it("should handle undefined message type", () => {
			const error = new DecodeError("Test error", undefined, 0, 10, 5);
			assert.ok(!error.message.includes("message type:"));
		});
	});

	describe("bounds checking - truncated packets", () => {
		it("should throw DecodeError for empty packet", () => {
			assert.throws(
				() => decodeMessage(new Uint8Array(0)),
				(error: unknown) => {
					assert.ok(error instanceof DecodeError);
					assert.strictEqual(error.offset, 0);
					assert.strictEqual(error.expected, 1);
					assert.strictEqual(error.actual, 0);
					return true;
				},
			);
		});

		it("should throw DecodeError for invalid message type", () => {
			assert.throws(
				() => decodeMessage(new Uint8Array([255])),
				(error: unknown) => {
					assert.ok(error instanceof DecodeError);
					assert.ok(error.message.includes("Unknown message type: 255"));
					return true;
				},
			);
		});

		it("should throw DecodeError when Input message truncated mid-playerId", () => {
			// Message type + start of playerId length but no content
			const encoded = new Uint8Array([MessageType.Input, 0, 10]); // Says playerId is 10 chars but buffer ends
			assert.throws(
				() => decodeMessage(encoded),
				(error: unknown) => {
					assert.ok(error instanceof DecodeError);
					assert.ok(error.messageType === MessageType.Input);
					return true;
				},
			);
		});

		it("should throw DecodeError when Input message truncated at input count", () => {
			// Valid playerId but no input count byte
			const encoded = new Uint8Array([MessageType.Input, 0, 2, 0x70, 0x31]); // "p1" but no input count
			assert.throws(
				() => decodeMessage(encoded),
				(error: unknown) => {
					assert.ok(error instanceof DecodeError);
					return true;
				},
			);
		});

		it("should throw DecodeError when InputAck truncated before tick", () => {
			const encoded = new Uint8Array([MessageType.InputAck, 0, 2, 0x70, 0x31]); // "p1" but no tick
			assert.throws(
				() => decodeMessage(encoded),
				(error: unknown) => {
					assert.ok(error instanceof DecodeError);
					return true;
				},
			);
		});

		it("should throw DecodeError when Hash message truncated", () => {
			const encoded = new Uint8Array([
				MessageType.Hash,
				0,
				2,
				0x70,
				0x31, // "p1"
				0,
				0,
				0,
				10, // tick
				// missing hash
			]);
			assert.throws(
				() => decodeMessage(encoded),
				(error: unknown) => {
					assert.ok(error instanceof DecodeError);
					return true;
				},
			);
		});

		it("should throw DecodeError when Ping message truncated", () => {
			const encoded = new Uint8Array([MessageType.Ping, 0, 0, 0]); // Only 4 bytes instead of 8
			assert.throws(
				() => decodeMessage(encoded),
				(error: unknown) => {
					assert.ok(error instanceof DecodeError);
					return true;
				},
			);
		});

		it("should throw DecodeError when Pong message truncated", () => {
			const encoded = new Uint8Array([MessageType.Pong, 0, 0]); // Only 3 bytes instead of 8
			assert.throws(
				() => decodeMessage(encoded),
				(error: unknown) => {
					assert.ok(error instanceof DecodeError);
					return true;
				},
			);
		});

		it("should throw DecodeError when Sync message state is truncated", () => {
			const encoded = new Uint8Array([
				MessageType.Sync,
				0,
				0,
				0,
				0, // tick
				0,
				0,
				0,
				0, // hash
				0,
				0,
				0,
				100, // state length says 100 bytes
				1,
				2,
				3, // but only 3 bytes of state
			]);
			assert.throws(
				() => decodeMessage(encoded),
				(error: unknown) => {
					assert.ok(error instanceof DecodeError);
					return true;
				},
			);
		});

		it("should throw DecodeError when JoinAccept player list is truncated", () => {
			const encoded = new Uint8Array([
				MessageType.JoinAccept,
				0,
				2,
				0x70,
				0x31, // playerId "p1"
				0,
				4,
				0x72,
				0x6f,
				0x6f,
				0x6d, // roomId "room"
				0,
				60, // tickRate
				4, // maxPlayers
				5, // playerCount says 5 players
				// but no player data
			]);
			assert.throws(
				() => decodeMessage(encoded),
				(error: unknown) => {
					assert.ok(error instanceof DecodeError);
					return true;
				},
			);
		});
	});

	describe("offset tracking - byte-level verification", () => {
		// These tests verify that all fields are written at correct byte positions.
		// They would catch bugs where offset isn't incremented after writing a field.

		it("JoinReject should write reason at correct offset", () => {
			const playerId = "abc";
			const reason = "test";
			const original = {
				type: MessageType.JoinReject as const,
				playerId: asPlayerId(playerId),
				reason,
			};

			const encoded = encodeMessage(original);
			const view = new DataView(encoded.buffer, encoded.byteOffset, encoded.byteLength);

			// Verify structure: type(1) + playerIdLen(2) + playerId(3) + reasonLen(2) + reason(4)
			assert.strictEqual(view.getUint8(0), MessageType.JoinReject, "type byte");
			assert.strictEqual(view.getUint16(1), 3, "playerId length");
			// playerId "abc" at offset 3
			assert.strictEqual(view.getUint16(6), 4, "reason length at correct offset");
			// reason "test" at offset 8
			const reasonBytes = encoded.slice(8, 12);
			assert.deepStrictEqual(
				reasonBytes,
				new TextEncoder().encode("test"),
				"reason bytes at correct position",
			);
		});

		it("DisconnectReport should write peerId at correct offset", () => {
			const peerId = "peer1";
			const original = {
				type: MessageType.DisconnectReport as const,
				disconnectedPeerId: asPlayerId(peerId),
			};

			const encoded = encodeMessage(original);
			const view = new DataView(encoded.buffer, encoded.byteOffset, encoded.byteLength);

			// Verify structure: type(1) + peerIdLen(2) + peerId(5)
			assert.strictEqual(view.getUint8(0), MessageType.DisconnectReport, "type byte");
			assert.strictEqual(view.getUint16(1), 5, "peerId length");
			const peerIdBytes = encoded.slice(3, 8);
			assert.deepStrictEqual(
				peerIdBytes,
				new TextEncoder().encode("peer1"),
				"peerId bytes at correct position",
			);
		});

		it("DropPlayer should write metadata at correct offset", () => {
			const playerId = "p1";
			const metadata = new Uint8Array([0xaa, 0xbb, 0xcc]);
			const original = {
				type: MessageType.DropPlayer as const,
				playerId: asPlayerId(playerId),
				metadata,
			};

			const encoded = encodeMessage(original);
			const view = new DataView(encoded.buffer, encoded.byteOffset, encoded.byteLength);

			// Verify structure: type(1) + playerIdLen(2) + playerId(2) + hasMetadata(1) + metadataLen(4) + metadata(3)
			assert.strictEqual(view.getUint8(0), MessageType.DropPlayer, "type byte");
			assert.strictEqual(view.getUint16(1), 2, "playerId length");
			// playerId "p1" at offset 3
			assert.strictEqual(view.getUint8(5), 1, "hasMetadata flag at correct offset");
			assert.strictEqual(view.getUint32(6), 3, "metadata length at correct offset");
			const metadataBytes = encoded.slice(10, 13);
			assert.deepStrictEqual(
				metadataBytes,
				metadata,
				"metadata bytes at correct position",
			);
		});

		it("DropPlayer without metadata should have hasMetadata=0 at correct offset", () => {
			const playerId = "player";
			const original = {
				type: MessageType.DropPlayer as const,
				playerId: asPlayerId(playerId),
			};

			const encoded = encodeMessage(original);
			const view = new DataView(encoded.buffer, encoded.byteOffset, encoded.byteLength);

			// Verify structure: type(1) + playerIdLen(2) + playerId(6) + hasMetadata(1)
			assert.strictEqual(view.getUint8(0), MessageType.DropPlayer, "type byte");
			assert.strictEqual(view.getUint16(1), 6, "playerId length");
			assert.strictEqual(view.getUint8(9), 0, "hasMetadata flag should be 0");
			assert.strictEqual(encoded.length, 10, "buffer should end after hasMetadata flag");
		});
	});

	describe("boundary values", () => {
		it("should handle tick value 0", () => {
			const message = {
				type: MessageType.Hash as const,
				playerId: asPlayerId("p"),
				tick: asTick(0),
				hash: 0,
			};

			const encoded = encodeMessage(message);
			const decoded = decodeMessage(encoded);

			assert.strictEqual(decoded.type, MessageType.Hash);
			if (decoded.type === MessageType.Hash) {
				assert.strictEqual(decoded.tick, 0);
				assert.strictEqual(decoded.hash, 0);
			}
		});

		it("should handle maximum int32 tick value", () => {
			const message = {
				type: MessageType.Hash as const,
				playerId: asPlayerId("p"),
				tick: asTick(2147483647),
				hash: 2147483647,
			};

			const encoded = encodeMessage(message);
			const decoded = decodeMessage(encoded);

			assert.deepStrictEqual(decoded, message);
		});

		it("should handle unicode player IDs", () => {
			const message = {
				type: MessageType.JoinRequest as const,
				playerId: asPlayerId("プレイヤー1"),
			};

			const encoded = encodeMessage(message);
			const decoded = decodeMessage(encoded);

			assert.deepStrictEqual(decoded, message);
		});

		it("should handle empty string player ID", () => {
			const message = {
				type: MessageType.JoinRequest as const,
				playerId: asPlayerId(""),
			};

			const encoded = encodeMessage(message);
			const decoded = decodeMessage(encoded);

			assert.deepStrictEqual(decoded, message);
		});

		it("should handle large state in Sync message", () => {
			const largeState = new Uint8Array(10000);
			for (let i = 0; i < largeState.length; i++) {
				largeState[i] = i % 256;
			}

			const message = {
				type: MessageType.Sync as const,
				tick: asTick(100),
				hash: 999,
				state: largeState,
				playerTimeline: [],
			};

			const encoded = encodeMessage(message);
			const decoded = decodeMessage(encoded);

			assert.strictEqual(decoded.type, MessageType.Sync);
			if (decoded.type === MessageType.Sync) {
				assert.deepStrictEqual(decoded.state, largeState);
			}
		});

		it("should handle large timestamp in Ping", () => {
			const message = {
				type: MessageType.Ping as const,
				timestamp: Number.MAX_SAFE_INTEGER,
			};

			const encoded = encodeMessage(message);
			const decoded = decodeMessage(encoded);

			assert.deepStrictEqual(decoded, message);
		});
	});
});
