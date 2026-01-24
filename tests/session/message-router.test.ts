import assert from "node:assert";
import { describe, it } from "node:test";
import { encodeMessage } from "../../src/protocol/encoding.js";
import { type Message, MessageType } from "../../src/protocol/messages.js";
import { PlayerRole, asPlayerId, asTick } from "../../src/types.js";
import { type MessageHandlers, MessageRouter } from "../../src/session/message-router.js";

describe("MessageRouter", () => {
	describe("route", () => {
		it("should decode and dispatch Input message", () => {
			let receivedType: MessageType | null = null;
			let receivedPeerId: string | null = null;

			const handlers: MessageHandlers = {
				onInput: (msg, peerId) => {
					receivedType = msg.type;
					receivedPeerId = peerId;
				},
			};

			const router = new MessageRouter(handlers, () => {});

			const message: Message = {
				type: MessageType.Input,
				playerId: asPlayerId("player1"),
				inputs: [{ tick: asTick(0), input: new Uint8Array([1, 2, 3]) }],
			};

			router.route("peer1", encodeMessage(message));

			assert.strictEqual(receivedType, MessageType.Input);
			assert.strictEqual(receivedPeerId, "peer1");
		});

		it("should decode and dispatch Hash message", () => {
			let received = false;

			const handlers: MessageHandlers = {
				onHash: () => {
					received = true;
				},
			};

			const router = new MessageRouter(handlers, () => {});

			const message: Message = {
				type: MessageType.Hash,
				playerId: asPlayerId("player1"),
				tick: asTick(100),
				hash: 12345,
			};

			router.route("peer1", encodeMessage(message));

			assert.strictEqual(received, true);
		});

		it("should decode and dispatch Sync message", () => {
			let received = false;

			const handlers: MessageHandlers = {
				onSync: () => {
					received = true;
				},
			};

			const router = new MessageRouter(handlers, () => {});

			const message: Message = {
				type: MessageType.Sync,
				tick: asTick(100),
				state: new Uint8Array([1, 2, 3]),
				hash: 12345,
				playerTimeline: [],
			};

			router.route("peer1", encodeMessage(message));

			assert.strictEqual(received, true);
		});

		it("should decode and dispatch StateSync message", () => {
			let received = false;

			const handlers: MessageHandlers = {
				onSync: () => {
					received = true;
				},
			};

			const router = new MessageRouter(handlers, () => {});

			const message: Message = {
				type: MessageType.StateSync,
				tick: asTick(100),
				state: new Uint8Array([1, 2, 3]),
				hash: 12345,
				playerTimeline: [],
			};

			router.route("peer1", encodeMessage(message));

			assert.strictEqual(received, true);
		});

		it("should decode and dispatch JoinRequest message", () => {
			let receivedPeerId: string | null = null;

			const handlers: MessageHandlers = {
				onJoinRequest: (_msg, peerId) => {
					receivedPeerId = peerId;
				},
			};

			const router = new MessageRouter(handlers, () => {});

			const message: Message = {
				type: MessageType.JoinRequest,
				playerId: asPlayerId("player1"),
				role: PlayerRole.Player,
			};

			router.route("peer1", encodeMessage(message));

			assert.strictEqual(receivedPeerId, "peer1");
		});

		it("should decode and dispatch Ping message", () => {
			let receivedTimestamp: number | null = null;

			const handlers: MessageHandlers = {
				onPing: (msg) => {
					receivedTimestamp = msg.timestamp;
				},
			};

			const router = new MessageRouter(handlers, () => {});

			const message: Message = {
				type: MessageType.Ping,
				timestamp: 123456789,
			};

			router.route("peer1", encodeMessage(message));

			assert.strictEqual(receivedTimestamp, 123456789);
		});

		it("should decode and dispatch Pong message", () => {
			let receivedTimestamp: number | null = null;

			const handlers: MessageHandlers = {
				onPong: (msg) => {
					receivedTimestamp = msg.timestamp;
				},
			};

			const router = new MessageRouter(handlers, () => {});

			const message: Message = {
				type: MessageType.Pong,
				timestamp: 123456789,
			};

			router.route("peer1", encodeMessage(message));

			assert.strictEqual(receivedTimestamp, 123456789);
		});

		it("should call error handler on decode failure", () => {
			let errorReceived: Error | null = null;
			let errorPeerId: string | null = null;
			let errorDataLength: number | null = null;

			const router = new MessageRouter({}, (error, peerId, dataLength) => {
				errorReceived = error;
				errorPeerId = peerId;
				errorDataLength = dataLength;
			});

			const invalidData = new Uint8Array([0xff, 0xff, 0xff]);
			router.route("peer1", invalidData);

			assert.ok(errorReceived);
			assert.strictEqual(errorPeerId, "peer1");
			assert.strictEqual(errorDataLength, 3);
		});

		it("should handle missing handler gracefully", () => {
			const router = new MessageRouter({}, () => {});

			const message: Message = {
				type: MessageType.Input,
				playerId: asPlayerId("player1"),
				inputs: [],
			};

			// Should not throw
			router.route("peer1", encodeMessage(message));
		});
	});

	describe("dispatch", () => {
		it("should dispatch Pause message", () => {
			let received = false;

			const handlers: MessageHandlers = {
				onPause: () => {
					received = true;
				},
			};

			const router = new MessageRouter(handlers, () => {});

			const message: Message = {
				type: MessageType.Pause,
				playerId: asPlayerId("player1"),
				pauseTick: asTick(100),
				reason: 0,
			};

			router.dispatch(message, "peer1");

			assert.strictEqual(received, true);
		});

		it("should dispatch Resume message", () => {
			let received = false;

			const handlers: MessageHandlers = {
				onResume: () => {
					received = true;
				},
			};

			const router = new MessageRouter(handlers, () => {});

			const message: Message = {
				type: MessageType.Resume,
				playerId: asPlayerId("player1"),
				resumeTick: asTick(100),
			};

			router.dispatch(message, "peer1");

			assert.strictEqual(received, true);
		});

		it("should dispatch PlayerJoined message", () => {
			let received = false;

			const handlers: MessageHandlers = {
				onPlayerJoined: () => {
					received = true;
				},
			};

			const router = new MessageRouter(handlers, () => {});

			const message: Message = {
				type: MessageType.PlayerJoined,
				playerId: asPlayerId("player1"),
				joinTick: asTick(100),
				role: PlayerRole.Player,
			};

			router.dispatch(message, "peer1");

			assert.strictEqual(received, true);
		});

		it("should dispatch PlayerLeft message", () => {
			let received = false;

			const handlers: MessageHandlers = {
				onPlayerLeft: () => {
					received = true;
				},
			};

			const router = new MessageRouter(handlers, () => {});

			const message: Message = {
				type: MessageType.PlayerLeft,
				playerId: asPlayerId("player1"),
				leaveTick: asTick(100),
			};

			router.dispatch(message, "peer1");

			assert.strictEqual(received, true);
		});

		it("should dispatch LagReport message", () => {
			let received = false;

			const handlers: MessageHandlers = {
				onLagReport: () => {
					received = true;
				},
			};

			const router = new MessageRouter(handlers, () => {});

			const message: Message = {
				type: MessageType.LagReport,
				laggyPlayerId: asPlayerId("player1"),
				ticksBehind: 50,
			};

			router.dispatch(message, "peer1");

			assert.strictEqual(received, true);
		});

		it("should dispatch DisconnectReport message", () => {
			let received = false;

			const handlers: MessageHandlers = {
				onDisconnectReport: () => {
					received = true;
				},
			};

			const router = new MessageRouter(handlers, () => {});

			const message: Message = {
				type: MessageType.DisconnectReport,
				disconnectedPeerId: asPlayerId("player1"),
			};

			router.dispatch(message, "peer1");

			assert.strictEqual(received, true);
		});

		it("should dispatch DropPlayer message", () => {
			let received = false;

			const handlers: MessageHandlers = {
				onDropPlayer: () => {
					received = true;
				},
			};

			const router = new MessageRouter(handlers, () => {});

			const message: Message = {
				type: MessageType.DropPlayer,
				playerId: asPlayerId("player1"),
			};

			router.dispatch(message, "peer1");

			assert.strictEqual(received, true);
		});

		it("should dispatch ResumeCountdown message", () => {
			let receivedSeconds: number | null = null;

			const handlers: MessageHandlers = {
				onResumeCountdown: (msg) => {
					receivedSeconds = msg.secondsRemaining;
				},
			};

			const router = new MessageRouter(handlers, () => {});

			const message: Message = {
				type: MessageType.ResumeCountdown,
				secondsRemaining: 5,
			};

			router.dispatch(message, "peer1");

			assert.strictEqual(receivedSeconds, 5);
		});

		it("should ignore InputAck messages", () => {
			// InputAck has no handler, should not throw
			const router = new MessageRouter({}, () => {});

			const message: Message = {
				type: MessageType.InputAck,
				playerId: asPlayerId("player1"),
				ackedTick: asTick(100),
			};

			// Should not throw
			router.dispatch(message, "peer1");
		});
	});
});
