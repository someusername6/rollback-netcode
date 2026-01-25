/**
 * Tests for mid-game join functionality.
 *
 * Verifies that players joining after the game has started receive
 * the current game state via StateSync.
 */

import assert from "node:assert";
import { describe, it } from "node:test";
import { createSession } from "../../src/session/session.js";
import { LocalTransport } from "../../src/transport/local.js";
import type { Game, PlayerId } from "../../src/types.js";

/**
 * Test game with per-player state.
 * Each player has their own position, tracking who exists in the game.
 */
class MultiPlayerGame implements Game {
  players: Map<string, { x: number; y: number }> = new Map();

  addPlayer(id: string, x = 0, y = 0): void {
    if (!this.players.has(id)) {
      this.players.set(id, { x, y });
    }
  }

  removePlayer(id: string): void {
    this.players.delete(id);
  }

  serialize(): Uint8Array {
    const entries = Array.from(this.players.entries());
    const data: number[] = [entries.length];

    for (const [id, pos] of entries) {
      const idBytes = new TextEncoder().encode(id);
      data.push(idBytes.length);
      data.push(...idBytes);
      // Store x and y as int16
      data.push((pos.x >> 8) & 0xff, pos.x & 0xff);
      data.push((pos.y >> 8) & 0xff, pos.y & 0xff);
    }

    return new Uint8Array(data);
  }

  deserialize(data: Uint8Array): void {
    this.players.clear();
    if (data.length === 0) return;

    let offset = 0;
    const count = data[offset++]!;

    for (let i = 0; i < count; i++) {
      const idLen = data[offset++]!;
      const id = new TextDecoder().decode(data.slice(offset, offset + idLen));
      offset += idLen;
      let x = (data[offset]! << 8) | data[offset + 1]!;
      let y = (data[offset + 2]! << 8) | data[offset + 3]!;
      // Sign extend from 16-bit to handle negative coordinates
      if (x >= 0x8000) x -= 0x10000;
      if (y >= 0x8000) y -= 0x10000;
      offset += 4;
      this.players.set(id, { x, y });
    }
  }

  step(inputs: Map<PlayerId, Uint8Array>): void {
    for (const [playerId, input] of inputs) {
      const player = this.players.get(playerId);
      if (player && input.length >= 2) {
        player.x += input[0]! - 128;
        player.y += input[1]! - 128;
      }
    }
  }

  hash(): number {
    let h = 0;
    for (const [id, pos] of this.players) {
      for (let i = 0; i < id.length; i++) {
        h = ((h << 5) - h) + id.charCodeAt(i);
      }
      h = ((h << 5) - h) + pos.x;
      h = ((h << 5) - h) + pos.y;
    }
    return h >>> 0;
  }
}

function flushTransports(transports: LocalTransport[], iterations = 5): void {
  for (let i = 0; i < iterations; i++) {
    for (const t of transports) {
      t.flush();
    }
  }
}

describe("Mid-game join", () => {
  it("should send StateSync to player joining mid-game", async () => {
    // Setup host
    const hostGame = new MultiPlayerGame();
    const hostTransport = new LocalTransport("host");
    const hostSession = createSession({
      game: hostGame,
      transport: hostTransport,
    });

    // Host adds itself and starts game
    hostSession.on("playerJoined", (info) => {
      hostGame.addPlayer(info.id);
    });

    await hostSession.createRoom();
    hostGame.addPlayer("host", 100, 200); // Host at position (100, 200)
    hostSession.start();

    // Run a few ticks so the game is clearly in progress
    for (let i = 0; i < 10; i++) {
      hostSession.tick(new Uint8Array([128, 128])); // neutral input
    }

    // Setup guest
    const guestGame = new MultiPlayerGame();
    const guestTransport = new LocalTransport("guest");
    const guestSession = createSession({
      game: guestGame,
      transport: guestTransport,
    });

    guestSession.on("playerJoined", (info) => {
      guestGame.addPlayer(info.id);
    });

    // Link transports
    LocalTransport.link(hostTransport, guestTransport);

    // Guest joins mid-game
    await guestSession.joinRoom("room", "host");

    // Flush to process all messages (JoinRequest -> JoinAccept -> StateSync)
    flushTransports([hostTransport, guestTransport]);

    // Guest should now have the host's state via StateSync deserialize
    assert.ok(
      guestGame.players.has("host"),
      "Guest should have host player from StateSync"
    );

    const hostInGuestGame = guestGame.players.get("host");
    assert.strictEqual(
      hostInGuestGame?.x,
      100,
      "Host x position should be synced"
    );
    assert.strictEqual(
      hostInGuestGame?.y,
      200,
      "Host y position should be synced"
    );

    // Guest should also have itself (added via playerJoined event on host,
    // then included in StateSync)
    assert.ok(
      guestGame.players.has("guest"),
      "Guest should have itself from StateSync"
    );

    // Host should have both players
    assert.ok(hostGame.players.has("host"), "Host should have itself");
    assert.ok(hostGame.players.has("guest"), "Host should have guest");

    // Cleanup
    hostSession.destroy();
    guestSession.destroy();
  });

  it("should sync game state including players added before StateSync", async () => {
    // This test verifies that playerJoined is emitted BEFORE StateSync is sent,
    // so the new player is included in the serialized state

    const hostGame = new MultiPlayerGame();
    const hostTransport = new LocalTransport("host");
    const hostSession = createSession({
      game: hostGame,
      transport: hostTransport,
    });

    hostSession.on("playerJoined", (info) => {
      // Add player at a specific position based on their ID
      const pos = info.id === "host" ? { x: 10, y: 20 } : { x: 30, y: 40 };
      hostGame.addPlayer(info.id, pos.x, pos.y);
    });

    await hostSession.createRoom();
    hostGame.addPlayer("host", 10, 20);
    hostSession.start();

    // Setup guest
    const guestGame = new MultiPlayerGame();
    const guestTransport = new LocalTransport("guest");
    const guestSession = createSession({
      game: guestGame,
      transport: guestTransport,
    });

    // Use different position than host's handler - if StateSync works correctly,
    // the guest should have position (30, 40) from host's state, not (999, 999)
    guestSession.on("playerJoined", (info) => {
      guestGame.addPlayer(info.id, 999, 999);
    });

    LocalTransport.link(hostTransport, guestTransport);

    await guestSession.joinRoom("room", "host");
    flushTransports([hostTransport, guestTransport]);

    // The guest player should have been added to host's game via playerJoined,
    // THEN included in StateSync sent to guest
    const guestInGuestGame = guestGame.players.get("guest");
    assert.ok(guestInGuestGame, "Guest should exist in guest's game");
    assert.strictEqual(
      guestInGuestGame?.x,
      30,
      "Guest position should come from host's playerJoined handler via StateSync"
    );

    hostSession.destroy();
    guestSession.destroy();
  });

  it("should preserve mid-game joined players after rollback", async () => {
    // This test verifies that when a rollback occurs past a player's joinTick,
    // the player is re-added during resimulation via the playerJoined callback.

    const hostGame = new MultiPlayerGame();
    const hostTransport = new LocalTransport("host");
    const hostSession = createSession({
      game: hostGame,
      transport: hostTransport,
    });

    // Track playerJoined calls to verify re-emission during resimulation
    let hostPlayerJoinedCount = 0;
    hostSession.on("playerJoined", (info) => {
      hostPlayerJoinedCount++;
      hostGame.addPlayer(info.id);
    });

    await hostSession.createRoom();
    hostGame.addPlayer("host", 50, 50);
    hostSession.start();

    // Host runs ahead - takes snapshots with only host player
    for (let i = 0; i < 20; i++) {
      hostSession.tick(new Uint8Array([128, 128]));
    }

    // Guest joins at tick 20
    const guestGame = new MultiPlayerGame();
    const guestTransport = new LocalTransport("guest");
    const guestSession = createSession({
      game: guestGame,
      transport: guestTransport,
    });

    guestSession.on("playerJoined", (info) => {
      guestGame.addPlayer(info.id);
    });

    LocalTransport.link(hostTransport, guestTransport);
    await guestSession.joinRoom("room", "host");
    flushTransports([hostTransport, guestTransport]);

    // Verify both players exist on host
    assert.ok(hostGame.players.has("host"), "Host should have host player");
    assert.ok(hostGame.players.has("guest"), "Host should have guest player after join");
    const joinedCountAfterJoin = hostPlayerJoinedCount;

    // Now simulate late input arrival that triggers rollback:
    // 1. Host ticks forward WITHOUT receiving guest's inputs
    // 2. Then flush to deliver guest's (now late) inputs
    // 3. This triggers rollback to before guest joined

    // Host ticks forward (predicting guest's inputs)
    for (let i = 0; i < 10; i++) {
      hostSession.tick(new Uint8Array([128, 128]));
      // Only flush host -> guest, not guest -> host
      hostTransport.flush();
    }

    // Guest ticks and sends inputs
    for (let i = 0; i < 10; i++) {
      guestSession.tick(new Uint8Array([130, 130])); // Different input to cause misprediction
      guestTransport.flush();
    }

    // Now deliver guest's late inputs to host - this should trigger rollback
    for (let i = 0; i < 5; i++) {
      hostTransport.flush();
      guestTransport.flush();
    }

    // Host processes the late inputs (causes rollback + resimulation)
    hostSession.tick(new Uint8Array([128, 128]));
    flushTransports([hostTransport, guestTransport]);

    // After rollback and resimulation, host should STILL have both players
    assert.ok(
      hostGame.players.has("host"),
      "Host should still have host player after rollback"
    );
    assert.ok(
      hostGame.players.has("guest"),
      "Host should still have guest player after rollback (re-added during resimulation)"
    );

    // playerJoined should have been called again during resimulation
    assert.ok(
      hostPlayerJoinedCount > joinedCountAfterJoin,
      "playerJoined should be re-emitted during resimulation"
    );

    hostSession.destroy();
    guestSession.destroy();
  });

  it("should emit playerJoined exactly once on initial join", async () => {
    // This test verifies that playerJoined is only emitted once when a
    // player initially joins, without any duplicate from immediate
    // resimulation.

    // Setup host
    const hostGame = new MultiPlayerGame();
    const hostTransport = new LocalTransport("host");
    const hostSession = createSession({
      game: hostGame,
      transport: hostTransport,
    });

    // Track playerJoined events per player to detect duplicates
    const hostPlayerJoinedEvents: string[] = [];
    hostSession.on("playerJoined", (info) => {
      hostPlayerJoinedEvents.push(info.id);
      hostGame.addPlayer(info.id);
    });

    await hostSession.createRoom();
    hostGame.addPlayer("host", 50, 50);
    hostSession.start();

    // Host runs to tick 10
    for (let i = 0; i < 10; i++) {
      hostSession.tick(new Uint8Array([128, 128]));
    }

    // Guest joins at tick 10
    const guestGame = new MultiPlayerGame();
    const guestTransport = new LocalTransport("guest");
    const guestSession = createSession({
      game: guestGame,
      transport: guestTransport,
    });

    guestSession.on("playerJoined", (info) => {
      guestGame.addPlayer(info.id);
    });

    LocalTransport.link(hostTransport, guestTransport);
    await guestSession.joinRoom("room", "host");
    flushTransports([hostTransport, guestTransport]);

    // Guest joins - should emit exactly once on the host
    const guestJoinCount = hostPlayerJoinedEvents.filter(id => id === "guest").length;
    assert.strictEqual(
      guestJoinCount,
      1,
      "Guest playerJoined should be emitted exactly once on initial join"
    );

    hostSession.destroy();
    guestSession.destroy();
  });
});
