# Rollback Netcode

A TypeScript library for P2P rollback netcode in browser-based multiplayer games.

## Why This Library?

The JavaScript/TypeScript ecosystem lacks a library that combines:
- **Rollback netcode** (not just interpolation/reconciliation)
- **4+ player support** (most libraries are limited to 2)
- **P2P topology** (no dedicated server required)
- **Browser-native** (WebRTC, works in any modern browser)

Existing options either support only 2 players (NetplayJS, Telegraph) or use different sync strategies (Geckos.io, Snowglobe, p2play-js).

## Features

- **Rollback netcode** - Simulate optimistically, rollback on misprediction
- **N-player support** - Not hardcoded to 2 players
- **Dynamic join/leave** - Players can join or leave during gameplay
- **Transport-agnostic core** - WebRTC default, but pluggable
- **Topology options** - P2P mesh or star-through-host
- **Input prediction** - Configurable prediction strategy
- **State snapshots** - Efficient ring buffer storage
- **Desync detection** - Periodic state hashing with recovery

## Design Philosophy

1. **Bring your own game** - Library handles netcode, you handle game logic
2. **Determinism is your responsibility** - Library provides tools, not enforcement
3. **Minimal opinions** - Works with any game framework or none
4. **Browser-first** - Designed for web games, PWAs, and browser-based experiences

## Requirements

Your game must provide:
- **Serializable state** - Save/restore full game state
- **Deterministic simulation** - Same inputs produce same outputs
- **Fixed timestep** - Consistent tick rate (e.g., 60 ticks/sec)
- **Input encoding** - Compact representation of player inputs

## Documentation

- [Architecture](docs/architecture.md) - Technical design and components
- [Requirements](docs/requirements.md) - Detailed functional requirements
- [API Design](docs/api.md) - Planned public interface (TBD)

## Status

**Pre-development** - Architecture and requirements phase.

## License

MIT
