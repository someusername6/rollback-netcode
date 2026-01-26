// src/types.ts
function asTick(n) {
  return n;
}
function asPlayerId(s) {
  return s;
}
function validatePlayerId(s) {
  if (typeof s !== "string" || s.length === 0) {
    throw new ValidationError(
      "Player ID must be a non-empty string",
      "playerId",
      s
    );
  }
}
function playerIdToPeerId(playerId) {
  return playerId;
}
var DEFAULT_SESSION_CONFIG = {
  tickRate: 60,
  maxPlayers: 4,
  topology: 1 /* Star */,
  snapshotHistorySize: 120,
  maxSpeculationTicks: 60,
  hashInterval: 60,
  disconnectTimeout: 5e3,
  debug: false,
  desyncAuthority: 1 /* Peer */,
  lagReportThreshold: 30,
  inputRedundancy: 3,
  joinRateLimitRequests: 3,
  joinRateLimitWindowMs: 1e4
};
var MAX_PLAYERS_LIMIT = 16;
function validateSessionConfig(config) {
  if (config.tickRate <= 0) {
    throw new ValidationError(
      "tickRate must be greater than 0",
      "tickRate",
      config.tickRate
    );
  }
  if (config.maxPlayers < 1 || config.maxPlayers > MAX_PLAYERS_LIMIT) {
    throw new ValidationError(
      `maxPlayers must be between 1 and ${MAX_PLAYERS_LIMIT}`,
      "maxPlayers",
      config.maxPlayers
    );
  }
  if (config.maxSpeculationTicks <= 0) {
    throw new ValidationError(
      "maxSpeculationTicks must be greater than 0",
      "maxSpeculationTicks",
      config.maxSpeculationTicks
    );
  }
  if (config.snapshotHistorySize < config.maxSpeculationTicks) {
    throw new ValidationError(
      "snapshotHistorySize must be >= maxSpeculationTicks to support rollback",
      "snapshotHistorySize",
      config.snapshotHistorySize
    );
  }
  if (config.hashInterval <= 0) {
    throw new ValidationError(
      "hashInterval must be greater than 0",
      "hashInterval",
      config.hashInterval
    );
  }
  if (config.disconnectTimeout <= 0) {
    throw new ValidationError(
      "disconnectTimeout must be greater than 0",
      "disconnectTimeout",
      config.disconnectTimeout
    );
  }
  if (config.topology !== 0 /* Mesh */ && config.topology !== 1 /* Star */) {
    throw new ValidationError(
      "topology must be Topology.Mesh or Topology.Star",
      "topology",
      config.topology
    );
  }
  if (config.desyncAuthority !== 0 /* Host */ && config.desyncAuthority !== 1 /* Peer */) {
    throw new ValidationError(
      "desyncAuthority must be DesyncAuthority.Host or DesyncAuthority.Peer",
      "desyncAuthority",
      config.desyncAuthority
    );
  }
  if (config.lagReportThreshold < 0) {
    throw new ValidationError(
      "lagReportThreshold must be >= 0",
      "lagReportThreshold",
      config.lagReportThreshold
    );
  }
  if (config.inputRedundancy < 1) {
    throw new ValidationError(
      "inputRedundancy must be >= 1",
      "inputRedundancy",
      config.inputRedundancy
    );
  }
  if (config.joinRateLimitRequests < 1) {
    throw new ValidationError(
      "joinRateLimitRequests must be >= 1",
      "joinRateLimitRequests",
      config.joinRateLimitRequests
    );
  }
  if (config.joinRateLimitWindowMs <= 0) {
    throw new ValidationError(
      "joinRateLimitWindowMs must be > 0",
      "joinRateLimitWindowMs",
      config.joinRateLimitWindowMs
    );
  }
}
var SessionState = /* @__PURE__ */ ((SessionState2) => {
  SessionState2[SessionState2["Disconnected"] = 0] = "Disconnected";
  SessionState2[SessionState2["Connecting"] = 1] = "Connecting";
  SessionState2[SessionState2["Lobby"] = 2] = "Lobby";
  SessionState2[SessionState2["Playing"] = 3] = "Playing";
  SessionState2[SessionState2["Paused"] = 4] = "Paused";
  return SessionState2;
})(SessionState || {});
var DEFAULT_INPUT_PREDICTOR = {
  predict(_playerId, _tick, lastConfirmed) {
    return lastConfirmed ?? new Uint8Array(0);
  }
};
var RollbackError = class extends Error {
  constructor(message, tick, originalError) {
    super(message, { cause: originalError });
    this.tick = tick;
    this.name = "RollbackError";
  }
};
var ValidationError = class extends Error {
  constructor(message, field, value) {
    super(message);
    this.field = field;
    this.value = value;
    this.name = "ValidationError";
  }
};
var GameError = class extends Error {
  constructor(operation, tick, cause) {
    super(`Game ${operation}() failed at tick ${tick}: ${cause.message}`, {
      cause
    });
    this.operation = operation;
    this.tick = tick;
    this.name = "GameError";
  }
};

// src/debug.ts
function createDebugLogger(enabled) {
  if (!enabled) {
    return {
      log: () => {
      },
      warn: () => {
      },
      trace: () => {
      }
    };
  }
  return {
    log: (message, data) => {
      if (data !== void 0) {
        console.log("[rollback]", message, data);
      } else {
        console.log("[rollback]", message);
      }
    },
    warn: (message, data) => {
      if (data !== void 0) {
        console.warn("[rollback]", message, data);
      } else {
        console.warn("[rollback]", message);
      }
    },
    trace: (message, data) => {
      if (data !== void 0) {
        console.log("[rollback:trace]", message, data);
      } else {
        console.log("[rollback:trace]", message);
      }
    }
  };
}

// src/protocol/messages.ts
function isReliableMessage(msg) {
  switch (msg.type) {
    case 1 /* Input */:
    case 2 /* InputAck */:
    case 64 /* Ping */:
    case 65 /* Pong */:
      return false;
    default:
      return true;
  }
}

// src/protocol/encoding.ts
var DecodeError = class extends Error {
  constructor(message, messageType, offset, expected, actual) {
    super(
      `${message} at offset ${offset}: expected ${expected} bytes, got ${actual}${messageType !== void 0 ? ` (message type: ${messageType})` : ""}`
    );
    this.messageType = messageType;
    this.offset = offset;
    this.expected = expected;
    this.actual = actual;
    this.name = "DecodeError";
  }
};
var EncodeError = class extends Error {
  constructor(message, field, maxValue, actualValue) {
    super(`${message}: ${field} must be <= ${maxValue}, got ${actualValue}`);
    this.field = field;
    this.maxValue = maxValue;
    this.actualValue = actualValue;
    this.name = "EncodeError";
  }
};
function ensureBytes(view, offset, needed, messageType) {
  const available = view.byteLength - offset;
  if (available < needed) {
    throw new DecodeError(
      "Insufficient bytes in buffer",
      messageType,
      offset,
      needed,
      available
    );
  }
}
var textEncoder = new TextEncoder();
var textDecoder = new TextDecoder();
var MAX_INPUT_SIZE_PER_FRAME = 1024;
var MAX_INPUT_MESSAGE_SIZE = 65536;
var DEFAULT_PROTOCOL_LIMITS = {
  maxStringLength: 1024,
  maxPlayerCount: 256,
  maxStateSize: 1e6
  // 1MB
};
function encodePlayerRole(role) {
  return role;
}
function decodePlayerRole(value) {
  if (value === 1 /* Spectator */) {
    return 1 /* Spectator */;
  }
  return 0 /* Player */;
}
function encodePauseReason(reason) {
  return reason;
}
function decodePauseReason(value) {
  if (value === 1 /* PlayerDisconnect */) {
    return 1 /* PlayerDisconnect */;
  }
  if (value === 2 /* ExcessiveLag */) {
    return 2 /* ExcessiveLag */;
  }
  return 0 /* PlayerRequest */;
}
function writeString(view, offset, str) {
  const bytes = textEncoder.encode(str);
  view.setUint16(offset, bytes.length);
  const uint8View = new Uint8Array(view.buffer, view.byteOffset + offset + 2);
  uint8View.set(bytes);
  return 2 + bytes.length;
}
function readString(view, offset, messageType, maxLength) {
  ensureBytes(view, offset, 2, messageType);
  const length = view.getUint16(offset);
  if (maxLength !== void 0 && length > maxLength) {
    throw new DecodeError(
      `String length exceeds maximum of ${maxLength} bytes`,
      messageType,
      offset,
      maxLength,
      length
    );
  }
  ensureBytes(view, offset + 2, length, messageType);
  const bytes = new Uint8Array(
    view.buffer,
    view.byteOffset + offset + 2,
    length
  );
  return [textDecoder.decode(bytes), 2 + length];
}
function writeBytes(view, offset, data) {
  view.setUint32(offset, data.length);
  const uint8View = new Uint8Array(view.buffer, view.byteOffset + offset + 4);
  uint8View.set(data);
  return 4 + data.length;
}
function readBytes(view, offset, messageType, maxSize) {
  ensureBytes(view, offset, 4, messageType);
  const length = view.getUint32(offset);
  if (maxSize !== void 0 && length > maxSize) {
    throw new DecodeError(
      `Byte array size exceeds maximum of ${maxSize} bytes`,
      messageType,
      offset,
      maxSize,
      length
    );
  }
  ensureBytes(view, offset + 4, length, messageType);
  const data = new Uint8Array(length);
  data.set(new Uint8Array(view.buffer, view.byteOffset + offset + 4, length));
  return [data, 4 + length];
}
function encodeMessage(message) {
  switch (message.type) {
    case 1 /* Input */:
      return encodeInputMessage(message);
    case 2 /* InputAck */:
      return encodeInputAckMessage(message);
    case 16 /* Hash */:
      return encodeHashMessage(message);
    case 17 /* Sync */:
      return encodeSyncMessage(message);
    case 18 /* SyncRequest */:
      return encodeSyncRequestMessage(message);
    case 32 /* Pause */:
      return encodePauseMessage(message);
    case 33 /* Resume */:
      return encodeResumeMessage(message);
    case 48 /* JoinRequest */:
      return encodeJoinRequestMessage(message);
    case 49 /* JoinAccept */:
      return encodeJoinAcceptMessage(message);
    case 50 /* JoinReject */:
      return encodeJoinRejectMessage(message);
    case 51 /* StateSync */:
      return encodeStateSyncMessage(message);
    case 52 /* PlayerJoined */:
      return encodePlayerJoinedMessage(message);
    case 53 /* PlayerLeft */:
      return encodePlayerLeftMessage(message);
    case 64 /* Ping */:
      return encodePingMessage(message);
    case 65 /* Pong */:
      return encodePongMessage(message);
    case 34 /* LagReport */:
      return encodeLagReportMessage(message);
    case 35 /* DisconnectReport */:
      return encodeDisconnectReportMessage(message);
    case 36 /* ResumeCountdown */:
      return encodeResumeCountdownMessage(message);
    case 37 /* DropPlayer */:
      return encodeDropPlayerMessage(message);
  }
}
function decodeMessage(data, limits = DEFAULT_PROTOCOL_LIMITS) {
  if (data.length === 0) {
    throw new DecodeError("Empty message", void 0, 0, 1, 0);
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const type = view.getUint8(0);
  switch (type) {
    case 1 /* Input */:
      return decodeInputMessage(view, limits);
    case 2 /* InputAck */:
      return decodeInputAckMessage(view, limits);
    case 16 /* Hash */:
      return decodeHashMessage(view, limits);
    case 17 /* Sync */:
      return decodeSyncMessage(view, limits);
    case 18 /* SyncRequest */:
      return decodeSyncRequestMessage(view, limits);
    case 32 /* Pause */:
      return decodePauseMessage(view, limits);
    case 33 /* Resume */:
      return decodeResumeMessage(view, limits);
    case 48 /* JoinRequest */:
      return decodeJoinRequestMessage(view, limits);
    case 49 /* JoinAccept */:
      return decodeJoinAcceptMessage(view, limits);
    case 50 /* JoinReject */:
      return decodeJoinRejectMessage(view, limits);
    case 51 /* StateSync */:
      return decodeStateSyncMessage(view, limits);
    case 52 /* PlayerJoined */:
      return decodePlayerJoinedMessage(view, limits);
    case 53 /* PlayerLeft */:
      return decodePlayerLeftMessage(view, limits);
    case 64 /* Ping */:
      return decodePingMessage(view);
    case 65 /* Pong */:
      return decodePongMessage(view);
    case 34 /* LagReport */:
      return decodeLagReportMessage(view, limits);
    case 35 /* DisconnectReport */:
      return decodeDisconnectReportMessage(view, limits);
    case 36 /* ResumeCountdown */:
      return decodeResumeCountdownMessage(view);
    case 37 /* DropPlayer */:
      return decodeDropPlayerMessage(view, limits);
    default:
      throw new DecodeError(
        `Unknown message type: ${type}`,
        type,
        0,
        0,
        data.length
      );
  }
}
function encodeInputMessage(msg) {
  if (msg.inputs.length > 255) {
    throw new EncodeError(
      "Input count exceeds maximum",
      "inputs.length",
      255,
      msg.inputs.length
    );
  }
  for (let i = 0; i < msg.inputs.length; i++) {
    const entry = msg.inputs[i];
    if (entry && entry.input.length > MAX_INPUT_SIZE_PER_FRAME) {
      throw new EncodeError(
        "Individual input size exceeds maximum",
        `inputs[${i}].input.length`,
        MAX_INPUT_SIZE_PER_FRAME,
        entry.input.length
      );
    }
  }
  const playerIdBytes = textEncoder.encode(msg.playerId);
  let totalSize = 1 + // type
  2 + playerIdBytes.length + // playerId
  1;
  for (const entry of msg.inputs) {
    totalSize += 4 + 2 + entry.input.length;
  }
  if (totalSize > MAX_INPUT_MESSAGE_SIZE) {
    throw new EncodeError(
      "Total input message size exceeds maximum",
      "totalSize",
      MAX_INPUT_MESSAGE_SIZE,
      totalSize
    );
  }
  const buffer = new Uint8Array(totalSize);
  const view = new DataView(buffer.buffer);
  let offset = 0;
  view.setUint8(offset++, 1 /* Input */);
  offset += writeString(view, offset, msg.playerId);
  view.setUint8(offset++, msg.inputs.length);
  for (const entry of msg.inputs) {
    view.setInt32(offset, entry.tick);
    offset += 4;
    view.setUint16(offset, entry.input.length);
    offset += 2;
    buffer.set(entry.input, offset);
    offset += entry.input.length;
  }
  return buffer;
}
function decodeInputMessage(view, limits) {
  const msgType = 1 /* Input */;
  if (view.byteLength > MAX_INPUT_MESSAGE_SIZE) {
    throw new DecodeError(
      `Input message exceeds maximum size of ${MAX_INPUT_MESSAGE_SIZE} bytes`,
      msgType,
      0,
      MAX_INPUT_MESSAGE_SIZE,
      view.byteLength
    );
  }
  let offset = 1;
  const [playerId, playerIdLen] = readString(
    view,
    offset,
    msgType,
    limits.maxStringLength
  );
  offset += playerIdLen;
  ensureBytes(view, offset, 1, msgType);
  const inputCount = view.getUint8(offset++);
  const inputs = [];
  for (let i = 0; i < inputCount; i++) {
    ensureBytes(view, offset, 4, msgType);
    const tick = asTick(view.getInt32(offset));
    offset += 4;
    ensureBytes(view, offset, 2, msgType);
    const inputLen = view.getUint16(offset);
    offset += 2;
    if (inputLen > MAX_INPUT_SIZE_PER_FRAME) {
      throw new DecodeError(
        `Input frame ${i} exceeds maximum size of ${MAX_INPUT_SIZE_PER_FRAME} bytes`,
        msgType,
        offset - 2,
        MAX_INPUT_SIZE_PER_FRAME,
        inputLen
      );
    }
    ensureBytes(view, offset, inputLen, msgType);
    const input = new Uint8Array(inputLen);
    input.set(new Uint8Array(view.buffer, view.byteOffset + offset, inputLen));
    offset += inputLen;
    inputs.push({ tick, input });
  }
  return {
    type: 1 /* Input */,
    playerId: asPlayerId(playerId),
    inputs
  };
}
function encodeInputAckMessage(msg) {
  const playerIdBytes = textEncoder.encode(msg.playerId);
  const buffer = new Uint8Array(1 + 2 + playerIdBytes.length + 4);
  const view = new DataView(buffer.buffer);
  let offset = 0;
  view.setUint8(offset++, 2 /* InputAck */);
  offset += writeString(view, offset, msg.playerId);
  view.setInt32(offset, msg.ackedTick);
  return buffer;
}
function decodeInputAckMessage(view, limits) {
  const msgType = 2 /* InputAck */;
  let offset = 1;
  const [playerId, playerIdLen] = readString(
    view,
    offset,
    msgType,
    limits.maxStringLength
  );
  offset += playerIdLen;
  ensureBytes(view, offset, 4, msgType);
  const ackedTick = asTick(view.getInt32(offset));
  return {
    type: 2 /* InputAck */,
    playerId: asPlayerId(playerId),
    ackedTick
  };
}
function encodeHashMessage(msg) {
  const playerIdBytes = textEncoder.encode(msg.playerId);
  const buffer = new Uint8Array(1 + 2 + playerIdBytes.length + 4 + 4);
  const view = new DataView(buffer.buffer);
  let offset = 0;
  view.setUint8(offset++, 16 /* Hash */);
  offset += writeString(view, offset, msg.playerId);
  view.setInt32(offset, msg.tick);
  offset += 4;
  view.setUint32(offset, msg.hash);
  return buffer;
}
function decodeHashMessage(view, limits) {
  const msgType = 16 /* Hash */;
  let offset = 1;
  const [playerId, playerIdLen] = readString(
    view,
    offset,
    msgType,
    limits.maxStringLength
  );
  offset += playerIdLen;
  ensureBytes(view, offset, 4, msgType);
  const tick = asTick(view.getInt32(offset));
  offset += 4;
  ensureBytes(view, offset, 4, msgType);
  const hash = view.getUint32(offset);
  return {
    type: 16 /* Hash */,
    playerId: asPlayerId(playerId),
    tick,
    hash
  };
}
function encodeSyncMessage(msg) {
  let timelineSize = 2;
  for (const entry of msg.playerTimeline) {
    const idBytes = textEncoder.encode(entry.playerId);
    timelineSize += 2 + idBytes.length + 4 + 1 + (entry.leaveTick !== null ? 4 : 0);
  }
  const buffer = new Uint8Array(
    1 + 4 + 4 + 4 + msg.state.length + timelineSize
  );
  const view = new DataView(buffer.buffer);
  let offset = 0;
  view.setUint8(offset++, 17 /* Sync */);
  view.setInt32(offset, msg.tick);
  offset += 4;
  view.setUint32(offset, msg.hash);
  offset += 4;
  offset += writeBytes(view, offset, msg.state);
  view.setUint16(offset, msg.playerTimeline.length);
  offset += 2;
  for (const entry of msg.playerTimeline) {
    offset += writeString(view, offset, entry.playerId);
    view.setInt32(offset, entry.joinTick);
    offset += 4;
    if (entry.leaveTick !== null) {
      view.setUint8(offset++, 1);
      view.setInt32(offset, entry.leaveTick);
      offset += 4;
    } else {
      view.setUint8(offset++, 0);
    }
  }
  return buffer;
}
function decodeSyncMessage(view, limits) {
  const msgType = 17 /* Sync */;
  let offset = 1;
  ensureBytes(view, offset, 4, msgType);
  const tick = asTick(view.getInt32(offset));
  offset += 4;
  ensureBytes(view, offset, 4, msgType);
  const hash = view.getUint32(offset);
  offset += 4;
  const [state, stateLen] = readBytes(
    view,
    offset,
    msgType,
    limits.maxStateSize
  );
  offset += stateLen;
  ensureBytes(view, offset, 2, msgType);
  const playerCount = view.getUint16(offset);
  offset += 2;
  if (playerCount > limits.maxPlayerCount) {
    throw new DecodeError(
      `Player count exceeds maximum of ${limits.maxPlayerCount}`,
      msgType,
      offset - 2,
      limits.maxPlayerCount,
      playerCount
    );
  }
  const playerTimeline = [];
  for (let i = 0; i < playerCount; i++) {
    const [playerId, idLen] = readString(
      view,
      offset,
      msgType,
      limits.maxStringLength
    );
    offset += idLen;
    ensureBytes(view, offset, 4, msgType);
    const joinTick = asTick(view.getInt32(offset));
    offset += 4;
    ensureBytes(view, offset, 1, msgType);
    const hasLeaveTick = view.getUint8(offset++) === 1;
    if (hasLeaveTick) {
      ensureBytes(view, offset, 4, msgType);
    }
    const leaveTick = hasLeaveTick ? asTick(view.getInt32(offset)) : null;
    if (hasLeaveTick) offset += 4;
    playerTimeline.push({
      playerId: asPlayerId(playerId),
      joinTick,
      leaveTick
    });
  }
  return {
    type: 17 /* Sync */,
    tick,
    state,
    hash,
    playerTimeline
  };
}
function encodeSyncRequestMessage(msg) {
  const playerIdBytes = textEncoder.encode(msg.playerId);
  const buffer = new Uint8Array(1 + 2 + playerIdBytes.length + 4 + 4);
  const view = new DataView(buffer.buffer);
  let offset = 0;
  view.setUint8(offset++, 18 /* SyncRequest */);
  offset += writeString(view, offset, msg.playerId);
  view.setInt32(offset, msg.desyncTick);
  offset += 4;
  view.setUint32(offset, msg.localHash);
  return buffer;
}
function decodeSyncRequestMessage(view, limits) {
  const msgType = 18 /* SyncRequest */;
  let offset = 1;
  const [playerId, playerIdLen] = readString(
    view,
    offset,
    msgType,
    limits.maxStringLength
  );
  offset += playerIdLen;
  ensureBytes(view, offset, 4, msgType);
  const desyncTick = asTick(view.getInt32(offset));
  offset += 4;
  ensureBytes(view, offset, 4, msgType);
  const localHash = view.getUint32(offset);
  return {
    type: 18 /* SyncRequest */,
    playerId: asPlayerId(playerId),
    desyncTick,
    localHash
  };
}
function encodePauseMessage(msg) {
  const playerIdBytes = textEncoder.encode(msg.playerId);
  const buffer = new Uint8Array(1 + 2 + playerIdBytes.length + 4 + 1);
  const view = new DataView(buffer.buffer);
  let offset = 0;
  view.setUint8(offset++, 32 /* Pause */);
  offset += writeString(view, offset, msg.playerId);
  view.setInt32(offset, msg.pauseTick);
  offset += 4;
  view.setUint8(offset, encodePauseReason(msg.reason));
  return buffer;
}
function decodePauseMessage(view, limits) {
  const msgType = 32 /* Pause */;
  let offset = 1;
  const [playerId, playerIdLen] = readString(
    view,
    offset,
    msgType,
    limits.maxStringLength
  );
  offset += playerIdLen;
  ensureBytes(view, offset, 5, msgType);
  const pauseTick = asTick(view.getInt32(offset));
  offset += 4;
  const reason = decodePauseReason(view.getUint8(offset));
  return {
    type: 32 /* Pause */,
    playerId: asPlayerId(playerId),
    pauseTick,
    reason
  };
}
function encodeResumeMessage(msg) {
  const playerIdBytes = textEncoder.encode(msg.playerId);
  const buffer = new Uint8Array(1 + 2 + playerIdBytes.length + 4);
  const view = new DataView(buffer.buffer);
  let offset = 0;
  view.setUint8(offset++, 33 /* Resume */);
  offset += writeString(view, offset, msg.playerId);
  view.setInt32(offset, msg.resumeTick);
  return buffer;
}
function decodeResumeMessage(view, limits) {
  const msgType = 33 /* Resume */;
  let offset = 1;
  const [playerId, playerIdLen] = readString(
    view,
    offset,
    msgType,
    limits.maxStringLength
  );
  offset += playerIdLen;
  ensureBytes(view, offset, 4, msgType);
  const resumeTick = asTick(view.getInt32(offset));
  return {
    type: 33 /* Resume */,
    playerId: asPlayerId(playerId),
    resumeTick
  };
}
function encodeJoinRequestMessage(msg) {
  const playerIdBytes = textEncoder.encode(msg.playerId);
  const buffer = new Uint8Array(1 + 2 + playerIdBytes.length + 1);
  const view = new DataView(buffer.buffer);
  let offset = 0;
  view.setUint8(offset++, 48 /* JoinRequest */);
  offset += writeString(view, offset, msg.playerId);
  view.setUint8(
    offset,
    msg.role !== void 0 ? encodePlayerRole(msg.role) : 255
  );
  return buffer;
}
function decodeJoinRequestMessage(view, limits) {
  const msgType = 48 /* JoinRequest */;
  let offset = 1;
  const [playerId, playerIdLen] = readString(
    view,
    offset,
    msgType,
    limits.maxStringLength
  );
  offset += playerIdLen;
  let role;
  if (view.byteLength > offset) {
    const roleValue = view.getUint8(offset);
    if (roleValue !== 255) {
      role = decodePlayerRole(roleValue);
    }
  }
  const result = {
    type: 48 /* JoinRequest */,
    playerId: asPlayerId(playerId)
  };
  if (role !== void 0) {
    result.role = role;
  }
  return result;
}
function encodeJoinAcceptMessage(msg) {
  const playerIdBytes = textEncoder.encode(msg.playerId);
  const roomIdBytes = textEncoder.encode(msg.roomId);
  let playersSize = 1;
  for (const p of msg.players) {
    playersSize += 2 + textEncoder.encode(p).length;
  }
  const buffer = new Uint8Array(
    1 + 2 + playerIdBytes.length + 2 + roomIdBytes.length + 2 + 1 + playersSize
  );
  const view = new DataView(buffer.buffer);
  let offset = 0;
  view.setUint8(offset++, 49 /* JoinAccept */);
  offset += writeString(view, offset, msg.playerId);
  offset += writeString(view, offset, msg.roomId);
  view.setUint16(offset, msg.config.tickRate);
  offset += 2;
  view.setUint8(offset++, msg.config.maxPlayers);
  view.setUint8(offset++, msg.players.length);
  for (const p of msg.players) {
    offset += writeString(view, offset, p);
  }
  return buffer;
}
function decodeJoinAcceptMessage(view, limits) {
  const msgType = 49 /* JoinAccept */;
  let offset = 1;
  const [playerId, playerIdLen] = readString(
    view,
    offset,
    msgType,
    limits.maxStringLength
  );
  offset += playerIdLen;
  const [roomId, roomIdLen] = readString(
    view,
    offset,
    msgType,
    limits.maxStringLength
  );
  offset += roomIdLen;
  ensureBytes(view, offset, 2, msgType);
  const tickRate = view.getUint16(offset);
  offset += 2;
  ensureBytes(view, offset, 2, msgType);
  const maxPlayers = view.getUint8(offset++);
  const playerCount = view.getUint8(offset++);
  if (playerCount > limits.maxPlayerCount) {
    throw new DecodeError(
      `Player count exceeds maximum of ${limits.maxPlayerCount}`,
      msgType,
      offset - 1,
      limits.maxPlayerCount,
      playerCount
    );
  }
  const players = [];
  for (let i = 0; i < playerCount; i++) {
    const [p, pLen] = readString(view, offset, msgType, limits.maxStringLength);
    offset += pLen;
    players.push(asPlayerId(p));
  }
  return {
    type: 49 /* JoinAccept */,
    playerId: asPlayerId(playerId),
    roomId,
    config: { tickRate, maxPlayers },
    players
  };
}
function encodeJoinRejectMessage(msg) {
  const playerIdBytes = textEncoder.encode(msg.playerId);
  const reasonBytes = textEncoder.encode(msg.reason);
  const buffer = new Uint8Array(
    1 + 2 + playerIdBytes.length + 2 + reasonBytes.length
  );
  const view = new DataView(buffer.buffer);
  let offset = 0;
  view.setUint8(offset++, 50 /* JoinReject */);
  offset += writeString(view, offset, msg.playerId);
  offset += writeString(view, offset, msg.reason);
  return buffer;
}
function decodeJoinRejectMessage(view, limits) {
  const msgType = 50 /* JoinReject */;
  let offset = 1;
  const [playerId, playerIdLen] = readString(
    view,
    offset,
    msgType,
    limits.maxStringLength
  );
  offset += playerIdLen;
  const [reason] = readString(view, offset, msgType, limits.maxStringLength);
  return {
    type: 50 /* JoinReject */,
    playerId: asPlayerId(playerId),
    reason
  };
}
function encodeStateSyncMessage(msg) {
  let timelineSize = 2;
  for (const entry of msg.playerTimeline) {
    const idBytes = textEncoder.encode(entry.playerId);
    timelineSize += 2 + idBytes.length + 4 + 1 + (entry.leaveTick !== null ? 4 : 0);
  }
  const buffer = new Uint8Array(
    1 + 4 + 4 + 4 + msg.state.length + timelineSize
  );
  const view = new DataView(buffer.buffer);
  let offset = 0;
  view.setUint8(offset++, 51 /* StateSync */);
  view.setInt32(offset, msg.tick);
  offset += 4;
  view.setUint32(offset, msg.hash);
  offset += 4;
  offset += writeBytes(view, offset, msg.state);
  view.setUint16(offset, msg.playerTimeline.length);
  offset += 2;
  for (const entry of msg.playerTimeline) {
    offset += writeString(view, offset, entry.playerId);
    view.setInt32(offset, entry.joinTick);
    offset += 4;
    if (entry.leaveTick !== null) {
      view.setUint8(offset++, 1);
      view.setInt32(offset, entry.leaveTick);
      offset += 4;
    } else {
      view.setUint8(offset++, 0);
    }
  }
  return buffer;
}
function decodeStateSyncMessage(view, limits) {
  const msgType = 51 /* StateSync */;
  let offset = 1;
  ensureBytes(view, offset, 4, msgType);
  const tick = asTick(view.getInt32(offset));
  offset += 4;
  ensureBytes(view, offset, 4, msgType);
  const hash = view.getUint32(offset);
  offset += 4;
  const [state, stateLen] = readBytes(
    view,
    offset,
    msgType,
    limits.maxStateSize
  );
  offset += stateLen;
  ensureBytes(view, offset, 2, msgType);
  const playerCount = view.getUint16(offset);
  offset += 2;
  if (playerCount > limits.maxPlayerCount) {
    throw new DecodeError(
      `Player count exceeds maximum of ${limits.maxPlayerCount}`,
      msgType,
      offset - 2,
      limits.maxPlayerCount,
      playerCount
    );
  }
  const playerTimeline = [];
  for (let i = 0; i < playerCount; i++) {
    const [playerId, idLen] = readString(
      view,
      offset,
      msgType,
      limits.maxStringLength
    );
    offset += idLen;
    ensureBytes(view, offset, 4, msgType);
    const joinTick = asTick(view.getInt32(offset));
    offset += 4;
    ensureBytes(view, offset, 1, msgType);
    const hasLeaveTick = view.getUint8(offset++) === 1;
    if (hasLeaveTick) {
      ensureBytes(view, offset, 4, msgType);
    }
    const leaveTick = hasLeaveTick ? asTick(view.getInt32(offset)) : null;
    if (hasLeaveTick) offset += 4;
    playerTimeline.push({
      playerId: asPlayerId(playerId),
      joinTick,
      leaveTick
    });
  }
  return {
    type: 51 /* StateSync */,
    tick,
    state,
    hash,
    playerTimeline
  };
}
function encodePlayerJoinedMessage(msg) {
  const playerIdBytes = textEncoder.encode(msg.playerId);
  const buffer = new Uint8Array(1 + 2 + playerIdBytes.length + 4 + 1);
  const view = new DataView(buffer.buffer);
  let offset = 0;
  view.setUint8(offset++, 52 /* PlayerJoined */);
  offset += writeString(view, offset, msg.playerId);
  view.setInt32(offset, msg.joinTick);
  offset += 4;
  view.setUint8(offset, encodePlayerRole(msg.role));
  return buffer;
}
function decodePlayerJoinedMessage(view, limits) {
  const msgType = 52 /* PlayerJoined */;
  let offset = 1;
  const [playerId, playerIdLen] = readString(
    view,
    offset,
    msgType,
    limits.maxStringLength
  );
  offset += playerIdLen;
  ensureBytes(view, offset, 5, msgType);
  const joinTick = asTick(view.getInt32(offset));
  offset += 4;
  const role = decodePlayerRole(view.getUint8(offset));
  return {
    type: 52 /* PlayerJoined */,
    playerId: asPlayerId(playerId),
    joinTick,
    role
  };
}
function encodePlayerLeftMessage(msg) {
  const playerIdBytes = textEncoder.encode(msg.playerId);
  const buffer = new Uint8Array(1 + 2 + playerIdBytes.length + 4);
  const view = new DataView(buffer.buffer);
  let offset = 0;
  view.setUint8(offset++, 53 /* PlayerLeft */);
  offset += writeString(view, offset, msg.playerId);
  view.setInt32(offset, msg.leaveTick);
  return buffer;
}
function decodePlayerLeftMessage(view, limits) {
  const msgType = 53 /* PlayerLeft */;
  let offset = 1;
  const [playerId, playerIdLen] = readString(
    view,
    offset,
    msgType,
    limits.maxStringLength
  );
  offset += playerIdLen;
  ensureBytes(view, offset, 4, msgType);
  const leaveTick = asTick(view.getInt32(offset));
  return {
    type: 53 /* PlayerLeft */,
    playerId: asPlayerId(playerId),
    leaveTick
  };
}
function encodePingMessage(msg) {
  const buffer = new Uint8Array(1 + 8);
  const view = new DataView(buffer.buffer);
  view.setUint8(0, 64 /* Ping */);
  view.setBigUint64(1, BigInt(msg.timestamp));
  return buffer;
}
function decodePingMessage(view) {
  const msgType = 64 /* Ping */;
  ensureBytes(view, 1, 8, msgType);
  const timestamp = Number(view.getBigUint64(1));
  return {
    type: 64 /* Ping */,
    timestamp
  };
}
function encodePongMessage(msg) {
  const buffer = new Uint8Array(1 + 8);
  const view = new DataView(buffer.buffer);
  view.setUint8(0, 65 /* Pong */);
  view.setBigUint64(1, BigInt(msg.timestamp));
  return buffer;
}
function decodePongMessage(view) {
  const msgType = 65 /* Pong */;
  ensureBytes(view, 1, 8, msgType);
  const timestamp = Number(view.getBigUint64(1));
  return {
    type: 65 /* Pong */,
    timestamp
  };
}
function encodeLagReportMessage(msg) {
  const playerIdBytes = textEncoder.encode(msg.laggyPlayerId);
  const buffer = new Uint8Array(1 + 2 + playerIdBytes.length + 4);
  const view = new DataView(buffer.buffer);
  let offset = 0;
  view.setUint8(offset++, 34 /* LagReport */);
  offset += writeString(view, offset, msg.laggyPlayerId);
  view.setInt32(offset, msg.ticksBehind);
  return buffer;
}
function decodeLagReportMessage(view, limits) {
  const msgType = 34 /* LagReport */;
  let offset = 1;
  const [laggyPlayerId, playerIdLen] = readString(
    view,
    offset,
    msgType,
    limits.maxStringLength
  );
  offset += playerIdLen;
  ensureBytes(view, offset, 4, msgType);
  const ticksBehind = view.getInt32(offset);
  return {
    type: 34 /* LagReport */,
    laggyPlayerId: asPlayerId(laggyPlayerId),
    ticksBehind
  };
}
function encodeDisconnectReportMessage(msg) {
  const playerIdBytes = textEncoder.encode(msg.disconnectedPeerId);
  const buffer = new Uint8Array(1 + 2 + playerIdBytes.length);
  const view = new DataView(buffer.buffer);
  let offset = 0;
  view.setUint8(offset++, 35 /* DisconnectReport */);
  offset += writeString(view, offset, msg.disconnectedPeerId);
  return buffer;
}
function decodeDisconnectReportMessage(view, limits) {
  const msgType = 35 /* DisconnectReport */;
  const [disconnectedPeerId] = readString(
    view,
    1,
    msgType,
    limits.maxStringLength
  );
  return {
    type: 35 /* DisconnectReport */,
    disconnectedPeerId: asPlayerId(disconnectedPeerId)
  };
}
function encodeResumeCountdownMessage(msg) {
  const buffer = new Uint8Array(1 + 2);
  const view = new DataView(buffer.buffer);
  view.setUint8(0, 36 /* ResumeCountdown */);
  view.setUint16(1, msg.secondsRemaining);
  return buffer;
}
function decodeResumeCountdownMessage(view) {
  const msgType = 36 /* ResumeCountdown */;
  ensureBytes(view, 1, 2, msgType);
  const secondsRemaining = view.getUint16(1);
  return {
    type: 36 /* ResumeCountdown */,
    secondsRemaining
  };
}
function encodeDropPlayerMessage(msg) {
  const playerIdBytes = textEncoder.encode(msg.playerId);
  const hasMetadata = msg.metadata !== void 0;
  const metadataSize = hasMetadata && msg.metadata ? 4 + msg.metadata.length : 0;
  const buffer = new Uint8Array(
    1 + 2 + playerIdBytes.length + 1 + metadataSize
  );
  const view = new DataView(buffer.buffer);
  let offset = 0;
  view.setUint8(offset++, 37 /* DropPlayer */);
  offset += writeString(view, offset, msg.playerId);
  view.setUint8(offset++, hasMetadata ? 1 : 0);
  if (hasMetadata && msg.metadata) {
    offset += writeBytes(view, offset, msg.metadata);
  }
  return buffer;
}
function decodeDropPlayerMessage(view, limits) {
  const msgType = 37 /* DropPlayer */;
  let offset = 1;
  const [playerId, playerIdLen] = readString(
    view,
    offset,
    msgType,
    limits.maxStringLength
  );
  offset += playerIdLen;
  ensureBytes(view, offset, 1, msgType);
  const hasMetadata = view.getUint8(offset++) === 1;
  const result = {
    type: 37 /* DropPlayer */,
    playerId: asPlayerId(playerId)
  };
  if (hasMetadata) {
    const [data] = readBytes(view, offset, msgType, limits.maxStateSize);
    result.metadata = data;
  }
  return result;
}

// src/rollback/input-buffer.ts
function inputsEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
var InputBuffer = class {
  players = /* @__PURE__ */ new Map();
  /** Index of players by their join tick for O(1) lookup */
  joinsByTick = /* @__PURE__ */ new Map();
  /** Index of players by their leave tick for O(1) lookup */
  leavesByTick = /* @__PURE__ */ new Map();
  /**
   * Add a player to the buffer.
   *
   * @param playerId - The player's ID
   * @param joinTick - The tick at which the player joins
   */
  addPlayer(playerId, joinTick) {
    const existing = this.players.get(playerId);
    if (existing) {
      if (existing.leaveTick !== null) {
        this.removeFromTickIndex(this.joinsByTick, existing.joinTick, playerId);
        this.removeFromTickIndex(
          this.leavesByTick,
          existing.leaveTick,
          playerId
        );
        existing.joinTick = joinTick;
        existing.leaveTick = null;
        existing.confirmedTick = asTick(joinTick - 1);
        existing.received.clear();
        existing.usedInputs.clear();
        this.addToTickIndex(this.joinsByTick, joinTick, playerId);
      }
      return;
    }
    this.players.set(playerId, {
      joinTick,
      leaveTick: null,
      received: /* @__PURE__ */ new Map(),
      confirmedTick: asTick(joinTick - 1),
      // No inputs confirmed yet
      usedInputs: /* @__PURE__ */ new Map()
    });
    this.addToTickIndex(this.joinsByTick, joinTick, playerId);
  }
  /**
   * Mark a player as having left.
   *
   * @param playerId - The player's ID
   * @param leaveTick - The tick at which the player leaves
   */
  removePlayer(playerId, leaveTick) {
    const player = this.players.get(playerId);
    if (player) {
      if (player.leaveTick !== null) {
        this.removeFromTickIndex(this.leavesByTick, player.leaveTick, playerId);
      }
      player.leaveTick = leaveTick;
      this.addToTickIndex(this.leavesByTick, leaveTick, playerId);
    }
  }
  /**
   * Set the confirmed tick for all active players to a specific value.
   * Used after a state sync to indicate that all inputs up to that tick
   * are implicitly confirmed by the synced state.
   *
   * @param tick - The tick to set as confirmed for all active players
   */
  setConfirmedTickForSync(tick) {
    if (tick <= 0) {
      return;
    }
    const confirmedTick = asTick(tick - 1);
    for (const player of this.players.values()) {
      if (player.leaveTick === null || player.leaveTick > tick) {
        if (player.confirmedTick < confirmedTick) {
          player.confirmedTick = confirmedTick;
        }
      }
    }
  }
  /**
   * Check if a player is active at a given tick.
   *
   * @param playerId - The player's ID
   * @param tick - The tick to check
   * @returns true if the player is active at that tick
   */
  isPlayerActive(playerId, tick) {
    const player = this.players.get(playerId);
    if (!player) return false;
    if (tick < player.joinTick) return false;
    if (player.leaveTick !== null && tick >= player.leaveTick) return false;
    return true;
  }
  /**
   * Get all players that are active at a given tick.
   *
   * @param tick - The tick to check
   * @returns Array of active player IDs
   */
  getActivePlayers(tick) {
    const active = [];
    for (const [playerId] of this.players) {
      if (this.isPlayerActive(playerId, tick)) {
        active.push(playerId);
      }
    }
    return active;
  }
  /**
   * Get all player IDs (active or not).
   *
   * @returns Array of all player IDs
   */
  getAllPlayers() {
    return Array.from(this.players.keys());
  }
  /**
   * Receive an input from a player.
   * The input is copied to prevent external mutation.
   *
   * @param playerId - The player's ID
   * @param tick - The tick the input is for
   * @param input - The input data
   */
  receiveInput(playerId, tick, input) {
    const player = this.players.get(playerId);
    if (!player) return;
    if (tick < player.joinTick) return;
    if (player.leaveTick !== null && tick >= player.leaveTick) return;
    const inputCopy = new Uint8Array(input.length);
    inputCopy.set(input);
    player.received.set(tick, inputCopy);
    this.updateConfirmedTick(player);
  }
  /**
   * Update the confirmed tick for a player.
   * Confirmed tick is the highest tick where all ticks from joinTick
   * to that tick have received inputs.
   */
  updateConfirmedTick(player) {
    let tick = player.confirmedTick + 1;
    while (player.received.has(asTick(tick))) {
      tick++;
    }
    player.confirmedTick = asTick(tick - 1);
  }
  /**
   * Get the received input for a player at a specific tick.
   *
   * @param playerId - The player's ID
   * @param tick - The tick to get input for
   * @returns The input, or undefined if not received
   */
  getInput(playerId, tick) {
    const player = this.players.get(playerId);
    if (!player) return void 0;
    return player.received.get(tick);
  }
  /**
   * Get the confirmed tick for a player.
   * This is the highest consecutive tick for which we have received input.
   *
   * @param playerId - The player's ID
   * @returns The confirmed tick, or undefined if player not found
   */
  getConfirmedTick(playerId) {
    const player = this.players.get(playerId);
    if (!player) return void 0;
    return player.confirmedTick;
  }
  /**
   * Get the join tick for a player.
   *
   * @param playerId - The player's ID
   * @returns The join tick, or undefined if player not found
   */
  getJoinTick(playerId) {
    const player = this.players.get(playerId);
    return player?.joinTick;
  }
  /**
   * Get the leave tick for a player.
   *
   * @param playerId - The player's ID
   * @returns The leave tick, or null/undefined if player hasn't left or not found
   */
  getLeaveTick(playerId) {
    const player = this.players.get(playerId);
    return player?.leaveTick;
  }
  /**
   * Record the input that was actually used for a player at a tick.
   * This may be the real input or a predicted input.
   *
   * @param playerId - The player's ID
   * @param tick - The tick
   * @param input - The input that was used
   */
  recordUsedInput(playerId, tick, input) {
    const player = this.players.get(playerId);
    if (!player) return;
    const inputCopy = new Uint8Array(input.length);
    inputCopy.set(input);
    player.usedInputs.set(tick, inputCopy);
  }
  /**
   * Get the input that was used for a player at a tick.
   *
   * @param playerId - The player's ID
   * @param tick - The tick
   * @returns The used input, or undefined if not recorded
   */
  getUsedInput(playerId, tick) {
    const player = this.players.get(playerId);
    if (!player) return void 0;
    return player.usedInputs.get(tick);
  }
  /**
   * Find the first tick where a misprediction occurred for a player.
   * A misprediction is when we used a predicted input that differs
   * from the actual received input.
   *
   * @param playerId - The player's ID
   * @param fromTick - Start searching from this tick
   * @returns The tick of the first misprediction, or undefined if none found
   */
  findMisprediction(playerId, fromTick) {
    const player = this.players.get(playerId);
    if (!player) return void 0;
    for (let tick = fromTick; tick <= player.confirmedTick; tick++) {
      const received = player.received.get(asTick(tick));
      const used = player.usedInputs.get(asTick(tick));
      if (received !== void 0 && used !== void 0) {
        if (!inputsEqual(received, used)) {
          return asTick(tick);
        }
      }
    }
    return void 0;
  }
  /**
   * Check if there are any mispredictions for a player in a tick range.
   *
   * @param playerId - The player's ID
   * @param fromTick - Start of range (inclusive)
   * @param toTick - End of range (inclusive)
   * @returns true if any misprediction found
   */
  hasMisprediction(playerId, fromTick, toTick) {
    const player = this.players.get(playerId);
    if (!player) return false;
    for (let tick = fromTick; tick <= toTick; tick++) {
      const received = player.received.get(asTick(tick));
      const used = player.usedInputs.get(asTick(tick));
      if (received !== void 0 && used !== void 0) {
        if (!inputsEqual(received, used)) {
          return true;
        }
      }
    }
    return false;
  }
  /**
   * Get the last confirmed input for a player.
   * Useful for input prediction.
   *
   * @param playerId - The player's ID
   * @returns The last confirmed input, or undefined if none
   */
  getLastConfirmedInput(playerId) {
    const player = this.players.get(playerId);
    if (!player) return void 0;
    if (player.confirmedTick >= player.joinTick) {
      return player.received.get(player.confirmedTick);
    }
    return void 0;
  }
  /**
   * Remove all data before a given tick.
   * Used to clean up old inputs that are no longer needed.
   *
   * @param tick - Remove all data for ticks < this value
   */
  pruneBeforeTick(tick) {
    for (const player of this.players.values()) {
      for (const t of player.received.keys()) {
        if (t < tick) {
          player.received.delete(t);
        }
      }
      for (const t of player.usedInputs.keys()) {
        if (t < tick) {
          player.usedInputs.delete(t);
        }
      }
    }
  }
  /**
   * Clear used inputs for a player from a given tick onwards.
   * Called during rollback to allow re-recording inputs.
   *
   * @param playerId - The player's ID
   * @param fromTick - Clear from this tick onwards
   */
  clearUsedInputsFrom(playerId, fromTick) {
    const player = this.players.get(playerId);
    if (!player) return;
    for (const tick of player.usedInputs.keys()) {
      if (tick >= fromTick) {
        player.usedInputs.delete(tick);
      }
    }
  }
  /**
   * Clear all used inputs from a given tick onwards for all players.
   *
   * @param fromTick - Clear from this tick onwards
   */
  clearAllUsedInputsFrom(fromTick) {
    for (const playerId of this.players.keys()) {
      this.clearUsedInputsFrom(playerId, fromTick);
    }
  }
  /**
   * Get the minimum confirmed tick across all active players at a given tick.
   *
   * @param tick - The reference tick for determining active players
   * @returns The minimum confirmed tick, or undefined if no active players
   */
  getMinConfirmedTick(tick) {
    let minTick;
    for (const [playerId, player] of this.players) {
      if (this.isPlayerActive(playerId, tick)) {
        if (minTick === void 0 || player.confirmedTick < minTick) {
          minTick = player.confirmedTick;
        }
      }
    }
    return minTick;
  }
  /**
   * Check if we have all inputs for a given tick from all active players.
   *
   * @param tick - The tick to check
   * @returns true if all inputs are available
   */
  hasAllInputsForTick(tick) {
    for (const [playerId] of this.players) {
      if (this.isPlayerActive(playerId, tick)) {
        if (!this.getInput(playerId, tick)) {
          return false;
        }
      }
    }
    return true;
  }
  /**
   * Clear all data for a player.
   *
   * @param playerId - The player's ID
   */
  clearPlayer(playerId) {
    const player = this.players.get(playerId);
    if (player) {
      this.removeFromTickIndex(this.joinsByTick, player.joinTick, playerId);
      if (player.leaveTick !== null) {
        this.removeFromTickIndex(this.leavesByTick, player.leaveTick, playerId);
      }
    }
    this.players.delete(playerId);
  }
  /**
   * Clear all players and data.
   */
  clear() {
    this.players.clear();
    this.joinsByTick.clear();
    this.leavesByTick.clear();
  }
  /**
   * Get all players that join at a specific tick.
   * O(1) lookup using tick-indexed map.
   *
   * @param tick - The tick to check
   * @returns Array of player IDs joining at this tick
   */
  getPlayersJoiningAtTick(tick) {
    const players = this.joinsByTick.get(tick);
    return players ? Array.from(players) : [];
  }
  /**
   * Get all players that leave at a specific tick.
   * O(1) lookup using tick-indexed map.
   *
   * @param tick - The tick to check
   * @returns Array of player IDs leaving at this tick
   */
  getPlayersLeavingAtTick(tick) {
    const players = this.leavesByTick.get(tick);
    return players ? Array.from(players) : [];
  }
  /**
   * Add a player to a tick index.
   */
  addToTickIndex(index, tick, playerId) {
    let players = index.get(tick);
    if (!players) {
      players = /* @__PURE__ */ new Set();
      index.set(tick, players);
    }
    players.add(playerId);
  }
  /**
   * Remove a player from a tick index.
   */
  removeFromTickIndex(index, tick, playerId) {
    const players = index.get(tick);
    if (players) {
      players.delete(playerId);
      if (players.size === 0) {
        index.delete(tick);
      }
    }
  }
};

// src/rollback/snapshot-buffer.ts
var SnapshotBuffer = class {
  /**
   * Create a new snapshot buffer.
   *
   * @param capacity - Maximum number of snapshots to store
   */
  constructor(capacity) {
    this.capacity = capacity;
    if (capacity <= 0) {
      throw new Error("Capacity must be positive");
    }
    this.buffer = new Array(capacity);
  }
  buffer;
  tickToIndex = /* @__PURE__ */ new Map();
  head = 0;
  // Next write position
  count = 0;
  _oldestTick;
  _newestTick;
  /**
   * Number of snapshots currently stored.
   */
  get size() {
    return this.count;
  }
  /**
   * The oldest tick in the buffer, or undefined if empty.
   */
  get oldestTick() {
    return this._oldestTick;
  }
  /**
   * The newest tick in the buffer, or undefined if empty.
   */
  get newestTick() {
    return this._newestTick;
  }
  /**
   * Save a snapshot at a specific tick.
   *
   * If the tick already exists, updates in-place to maintain sort order.
   * If the buffer is full, the oldest snapshot is evicted.
   * The state is copied to prevent external mutation.
   *
   * PRECONDITION: New ticks (not already in buffer) must be >= all existing ticks.
   * Saving an out-of-order new tick corrupts sort order. See class invariant.
   *
   * @param tick - The tick this snapshot was taken at
   * @param state - The serialized game state
   * @param hash - The hash of the game state
   */
  save(tick, state, hash) {
    const stateCopy = new Uint8Array(state.length);
    stateCopy.set(state);
    const snapshot = {
      tick,
      state: stateCopy,
      hash
    };
    const existingIdx = this.tickToIndex.get(tick);
    if (existingIdx !== void 0) {
      this.buffer[existingIdx] = snapshot;
      return;
    }
    if (this._newestTick !== void 0 && tick < this._newestTick) {
      console.error(
        `SnapshotBuffer: tick ${tick} is out of order (newest: ${this._newestTick}). This will corrupt binary search in getAtOrBefore().`
      );
    }
    if (this.count === this.capacity) {
      const oldSnapshot = this.buffer[this.head];
      if (oldSnapshot) {
        this.tickToIndex.delete(oldSnapshot.tick);
      }
      this.buffer[this.head] = snapshot;
      this.tickToIndex.set(tick, this.head);
      this.head = (this.head + 1) % this.capacity;
      const oldestSnapshot = this.buffer[this.head];
      this._oldestTick = oldestSnapshot?.tick;
    } else {
      const writePos = (this.head + this.count) % this.capacity;
      this.buffer[writePos] = snapshot;
      this.tickToIndex.set(tick, writePos);
      this.count++;
      if (this.count === 1) {
        this._oldestTick = tick;
      }
    }
    this._newestTick = tick;
  }
  /**
   * Get a snapshot at a specific tick.
   * Uses O(1) map lookup for performance.
   *
   * @param tick - The tick to retrieve
   * @returns The snapshot at that tick, or undefined if not found
   */
  get(tick) {
    const idx = this.tickToIndex.get(tick);
    if (idx === void 0) {
      return void 0;
    }
    return this.buffer[idx];
  }
  /**
   * Get the oldest snapshot in the buffer.
   *
   * @returns The oldest snapshot, or undefined if empty
   */
  getOldest() {
    if (this.count === 0) {
      return void 0;
    }
    return this.buffer[this.head];
  }
  /**
   * Get the newest snapshot in the buffer.
   *
   * @returns The newest snapshot, or undefined if empty
   */
  getNewest() {
    if (this.count === 0) {
      return void 0;
    }
    const newestIdx = (this.head + this.count - 1) % this.capacity;
    return this.buffer[newestIdx];
  }
  /**
   * Clear all snapshots from the buffer.
   */
  clear() {
    this.buffer.fill(void 0);
    this.tickToIndex.clear();
    this.head = 0;
    this.count = 0;
    this._oldestTick = void 0;
    this._newestTick = void 0;
  }
  /**
   * Get the snapshot at or before a given tick.
   * Useful for finding the closest snapshot for rollback.
   *
   * O(log n) binary search. Snapshots are stored in ascending tick order.
   *
   * @param tick - The target tick
   * @returns The snapshot at or before that tick, or undefined if none exists
   */
  getAtOrBefore(tick) {
    if (this.count === 0) {
      return void 0;
    }
    let lo = 0;
    let hi = this.count - 1;
    let result;
    while (lo <= hi) {
      const mid = lo + hi >>> 1;
      const idx = (this.head + mid) % this.capacity;
      const snapshot = this.buffer[idx];
      if (snapshot && snapshot.tick <= tick) {
        result = snapshot;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return result;
  }
  /**
   * Remove all snapshots before a given tick.
   * Used to clean up old snapshots that are no longer needed.
   *
   * @param tick - Remove all snapshots with tick < this value
   */
  pruneBeforeTick(tick) {
    while (this.count > 0) {
      const oldest = this.buffer[this.head];
      if (oldest && oldest.tick < tick) {
        this.tickToIndex.delete(oldest.tick);
        this.buffer[this.head] = void 0;
        this.head = (this.head + 1) % this.capacity;
        this.count--;
        if (this.count === 0) {
          this._oldestTick = void 0;
          this._newestTick = void 0;
        } else {
          this._oldestTick = this.buffer[this.head]?.tick;
        }
      } else {
        break;
      }
    }
  }
  /**
   * Check if a snapshot exists at a given tick.
   *
   * @param tick - The tick to check
   * @returns true if a snapshot exists at that tick
   */
  has(tick) {
    return this.get(tick) !== void 0;
  }
  /**
   * Get all ticks that have snapshots, in order from oldest to newest.
   *
   * @returns Array of ticks with snapshots
   */
  getTicks() {
    const ticks = [];
    for (let i = 0; i < this.count; i++) {
      const idx = (this.head + i) % this.capacity;
      const snapshot = this.buffer[idx];
      if (snapshot) {
        ticks.push(snapshot.tick);
      }
    }
    return ticks;
  }
};

// src/rollback/engine.ts
var RollbackEngine = class {
  game;
  localPlayerId;
  snapshotBuffer;
  inputBuffer;
  inputPredictor;
  maxSpeculationTicks;
  pruneBufferTicks;
  onPlayerAddDuringResimulation;
  onPlayerRemoveDuringResimulation;
  onRollback;
  _currentTick;
  _confirmedTick;
  localInputs = /* @__PURE__ */ new Map();
  /**
   * Create a new rollback engine.
   */
  constructor(config) {
    this.game = config.game;
    this.localPlayerId = config.localPlayerId;
    this.maxSpeculationTicks = config.maxSpeculationTicks ?? 60;
    this.pruneBufferTicks = config.pruneBufferTicks ?? 10;
    this.inputPredictor = config.inputPredictor ?? DEFAULT_INPUT_PREDICTOR;
    this.onPlayerAddDuringResimulation = config.onPlayerAddDuringResimulation;
    this.onPlayerRemoveDuringResimulation = config.onPlayerRemoveDuringResimulation;
    this.onRollback = config.onRollback;
    this.snapshotBuffer = new SnapshotBuffer(config.snapshotHistorySize ?? 120);
    this.inputBuffer = new InputBuffer();
    this._currentTick = asTick(0);
    this._confirmedTick = asTick(-1);
    this.inputBuffer.addPlayer(this.localPlayerId, asTick(0));
  }
  /**
   * The current simulation tick.
   */
  get currentTick() {
    return this._currentTick;
  }
  /**
   * The lowest confirmed tick across all active players.
   * All inputs up to and including this tick are confirmed.
   */
  get confirmedTick() {
    return this._confirmedTick;
  }
  /**
   * Add a player to the simulation.
   *
   * @param playerId - The player's ID
   * @param joinTick - The tick at which they join
   */
  addPlayer(playerId, joinTick) {
    this.inputBuffer.addPlayer(playerId, joinTick);
  }
  /**
   * Remove a player from the simulation.
   *
   * @param playerId - The player's ID
   * @param leaveTick - The tick at which they leave
   */
  removePlayer(playerId, leaveTick) {
    this.inputBuffer.removePlayer(playerId, leaveTick);
  }
  /**
   * Get the confirmed tick for a specific player.
   * Returns the highest tick for which we have received confirmed input from this player.
   *
   * @param playerId - The player's ID
   * @returns The confirmed tick, or undefined if the player is not tracked
   */
  getConfirmedTickForPlayer(playerId) {
    return this.inputBuffer.getConfirmedTick(playerId);
  }
  /**
   * Set the local player's input for the current tick.
   * Call this before tick() to set what input the local player uses.
   *
   * @param tick - The tick the input is for
   * @param input - The input data
   */
  setLocalInput(tick, input) {
    const inputCopy = new Uint8Array(input.length);
    inputCopy.set(input);
    this.localInputs.set(tick, inputCopy);
    this.inputBuffer.receiveInput(this.localPlayerId, tick, inputCopy);
  }
  /**
   * Receive a remote player's input.
   *
   * @param playerId - The player's ID
   * @param tick - The tick the input is for
   * @param input - The input data
   */
  receiveRemoteInput(playerId, tick, input) {
    this.inputBuffer.receiveInput(playerId, tick, input);
  }
  /**
   * Get the local player's input for a tick.
   *
   * @param tick - The tick to get input for
   * @returns The input, or undefined if not set
   */
  getLocalInput(tick) {
    return this.localInputs.get(tick);
  }
  /**
   * Save the initial snapshot at tick -1.
   * This allows rollback of tick 0 if there's a misprediction.
   * Call this before the first tick() if the engine wasn't initialized via setState().
   */
  saveInitialSnapshot() {
    if (!this.snapshotBuffer.has(asTick(-1))) {
      const tick = asTick(-1);
      const state = this.gameSerialize(tick);
      const hash = this.gameHash(tick);
      this.snapshotBuffer.save(tick, state, hash);
    }
  }
  /**
   * Advance the simulation by one tick.
   *
   * This is the core rollback algorithm:
   * 1. Check for mispredictions among remote players
   * 2. If misprediction found, rollback and resimulate
   * 3. Gather inputs (real or predicted) for all players
   * 4. Step the simulation
   * 5. Save snapshot
   *
   * @returns Result containing tick number and rollback info
   */
  tick() {
    if (this._currentTick === 0) {
      this.saveInitialSnapshot();
    }
    const minConfirmed = this.inputBuffer.getMinConfirmedTick(
      this._currentTick
    );
    if (minConfirmed !== void 0) {
      const speculation = this._currentTick - minConfirmed;
      if (speculation >= this.maxSpeculationTicks) {
        return {
          tick: this._currentTick,
          rolledBack: false
        };
      }
    }
    const rollbackResult = this.checkAndRollback();
    const inputs = this.gatherInputs(this._currentTick);
    this.gameStep(this._currentTick, inputs);
    const state = this.gameSerialize(this._currentTick);
    const hash = this.gameHash(this._currentTick);
    this.snapshotBuffer.save(this._currentTick, state, hash);
    this.updateConfirmedTick();
    const tickResult = this._currentTick;
    this._currentTick = asTick(this._currentTick + 1);
    const result = {
      tick: tickResult,
      rolledBack: rollbackResult.rolledBack
    };
    if (rollbackResult.rollbackTicks !== void 0) {
      result.rollbackTicks = rollbackResult.rollbackTicks;
    }
    if (rollbackResult.error !== void 0) {
      result.error = rollbackResult.error;
    }
    return result;
  }
  /**
   * Check for mispredictions and rollback if found.
   */
  checkAndRollback() {
    let earliestMisprediction;
    const activePlayers = this.inputBuffer.getActivePlayers(this._currentTick);
    for (const playerId of activePlayers) {
      if (playerId === this.localPlayerId) continue;
      const mispredictTick = this.inputBuffer.findMisprediction(
        playerId,
        this._confirmedTick >= 0 ? asTick(this._confirmedTick + 1) : asTick(0)
      );
      if (mispredictTick !== void 0) {
        if (earliestMisprediction === void 0 || mispredictTick < earliestMisprediction) {
          earliestMisprediction = mispredictTick;
        }
      }
    }
    if (earliestMisprediction === void 0) {
      return { rolledBack: false };
    }
    const restoreTick = asTick(earliestMisprediction - 1);
    let snapshot = this.snapshotBuffer.get(restoreTick);
    let actualRestoreTick = restoreTick;
    if (!snapshot) {
      snapshot = this.snapshotBuffer.getAtOrBefore(restoreTick);
      if (!snapshot) {
        return {
          rolledBack: false,
          error: new RollbackError(
            `Cannot rollback to tick ${restoreTick}: no snapshots available in buffer`,
            restoreTick
          )
        };
      }
      actualRestoreTick = snapshot.tick;
    }
    const resimulateFromTick = asTick(actualRestoreTick + 1);
    const ticksToResimulate = this._currentTick - resimulateFromTick;
    this.gameDeserialize(actualRestoreTick, snapshot.state);
    this.onRollback?.(actualRestoreTick);
    this.inputBuffer.clearAllUsedInputsFrom(resimulateFromTick);
    for (let tick = resimulateFromTick; tick < this._currentTick; tick++) {
      const tickAsTick = asTick(tick);
      this.handlePlayerLifecycleAtTick(tickAsTick);
      const inputs = this.gatherInputs(tickAsTick);
      this.gameStep(tickAsTick, inputs);
      const state = this.gameSerialize(tickAsTick);
      const hash = this.gameHash(tickAsTick);
      this.snapshotBuffer.save(tickAsTick, state, hash);
    }
    return {
      rolledBack: true,
      rollbackTicks: ticksToResimulate
    };
  }
  /**
   * Handle player add/remove lifecycle events at a specific tick during resimulation.
   * This ensures the game layer knows about player joins/leaves when replaying history.
   * Uses O(1) tick-indexed lookups instead of iterating all players.
   */
  handlePlayerLifecycleAtTick(tick) {
    if (this.onPlayerAddDuringResimulation) {
      const joiningPlayers = this.inputBuffer.getPlayersJoiningAtTick(tick);
      for (const playerId of joiningPlayers) {
        this.onPlayerAddDuringResimulation(playerId, tick);
      }
    }
    if (this.onPlayerRemoveDuringResimulation) {
      const leavingPlayers = this.inputBuffer.getPlayersLeavingAtTick(tick);
      for (const playerId of leavingPlayers) {
        this.onPlayerRemoveDuringResimulation(playerId, tick);
      }
    }
  }
  /**
   * Gather inputs for all active players at a given tick.
   * Uses real inputs when available, predicts otherwise.
   */
  gatherInputs(tick) {
    const inputs = /* @__PURE__ */ new Map();
    const activePlayers = this.inputBuffer.getActivePlayers(tick);
    for (const playerId of activePlayers) {
      let input;
      if (playerId === this.localPlayerId) {
        input = this.localInputs.get(tick) ?? new Uint8Array(0);
      } else {
        const received = this.inputBuffer.getInput(playerId, tick);
        if (received) {
          input = received;
        } else {
          const lastInput = this.inputBuffer.getLastConfirmedInput(playerId);
          input = this.inputPredictor.predict(playerId, tick, lastInput);
        }
      }
      inputs.set(playerId, input);
      this.inputBuffer.recordUsedInput(playerId, tick, input);
    }
    return inputs;
  }
  /**
   * Update the confirmed tick based on all players' confirmed ticks.
   */
  updateConfirmedTick() {
    const minConfirmed = this.inputBuffer.getMinConfirmedTick(
      this._currentTick
    );
    if (minConfirmed !== void 0 && minConfirmed > this._confirmedTick) {
      this._confirmedTick = minConfirmed;
      if (this._confirmedTick > this.pruneBufferTicks) {
        const pruneBelow = asTick(this._confirmedTick - this.pruneBufferTicks);
        this.inputBuffer.pruneBeforeTick(pruneBelow);
        this.snapshotBuffer.pruneBeforeTick(pruneBelow);
        for (const tick of this.localInputs.keys()) {
          if (tick < pruneBelow) {
            this.localInputs.delete(tick);
          }
        }
      }
    }
  }
  /**
   * Get the hash at a specific tick.
   *
   * @param tick - The tick to get hash for
   * @returns The hash, or undefined if not available
   */
  getHash(tick) {
    return this.snapshotBuffer.get(tick)?.hash;
  }
  /**
   * Get the current game hash.
   */
  getCurrentHash() {
    return this.gameHash(this._currentTick);
  }
  /**
   * Get the current game state and player timeline for sync.
   */
  getState() {
    const players = this.inputBuffer.getAllPlayers();
    const playerTimeline = [];
    for (const playerId of players) {
      const joinTick = this.inputBuffer.getJoinTick(playerId);
      const leaveTick = this.inputBuffer.getLeaveTick(playerId);
      if (joinTick !== void 0) {
        playerTimeline.push({
          playerId,
          joinTick,
          leaveTick: leaveTick ?? null
        });
      }
    }
    return {
      tick: this._currentTick,
      state: this.gameSerialize(this._currentTick),
      playerTimeline
    };
  }
  /**
   * Set the game state from a sync message.
   * Used for late join or desync recovery.
   *
   * @param tick - The tick the state is from
   * @param state - The serialized game state
   * @param playerTimeline - Timeline of player join/leave events
   */
  setState(tick, state, playerTimeline) {
    this.gameDeserialize(tick, state);
    this.snapshotBuffer.clear();
    this.inputBuffer.clear();
    this.localInputs.clear();
    for (const entry of playerTimeline) {
      this.inputBuffer.addPlayer(entry.playerId, entry.joinTick);
      if (entry.leaveTick !== null) {
        this.inputBuffer.removePlayer(entry.playerId, entry.leaveTick);
      }
    }
    this.inputBuffer.setConfirmedTickForSync(tick);
    const snapshotTick = asTick(tick - 1);
    const hash = this.gameHash(snapshotTick);
    this.snapshotBuffer.save(snapshotTick, state, hash);
    this._currentTick = tick;
    this._confirmedTick = asTick(tick - 1);
  }
  /**
   * Reset buffers and tick counters for sync without changing game state.
   *
   * Used by the host when broadcasting sync to all players. The host's game
   * state is already correct, but it needs to reset buffers and tick counters
   * to match the synced state being sent to clients.
   *
   * This is more efficient than setState() when the game state doesn't need
   * to be restored (avoids unnecessary serialize/deserialize round-trip).
   *
   * @param tick - The tick to reset to
   * @param playerTimeline - Timeline of player join/leave events
   */
  resetForSync(tick, playerTimeline) {
    this.snapshotBuffer.clear();
    this.inputBuffer.clear();
    this.localInputs.clear();
    for (const entry of playerTimeline) {
      this.inputBuffer.addPlayer(entry.playerId, entry.joinTick);
      if (entry.leaveTick !== null) {
        this.inputBuffer.removePlayer(entry.playerId, entry.leaveTick);
      }
    }
    this.inputBuffer.setConfirmedTickForSync(tick);
    const snapshotTick = asTick(tick - 1);
    const state = this.gameSerialize(snapshotTick);
    const hash = this.gameHash(snapshotTick);
    this.snapshotBuffer.save(snapshotTick, state, hash);
    this._currentTick = tick;
    this._confirmedTick = asTick(tick - 1);
  }
  /**
   * Check if we have all inputs for a given tick.
   *
   * @param tick - The tick to check
   * @returns true if all inputs are available
   */
  hasAllInputsForTick(tick) {
    return this.inputBuffer.hasAllInputsForTick(tick);
  }
  /**
   * Check if a tick is "settled" - meaning we've simulated past it
   * and have all confirmed inputs for it.
   *
   * A settled tick's state is stable and won't change from future rollbacks,
   * making it safe to compare hashes for desync detection.
   *
   * @param tick - The tick to check
   * @param currentTick - The current simulation tick
   * @returns true if the tick is settled
   */
  isTickSettled(tick, currentTick) {
    if (tick >= currentTick) {
      return false;
    }
    return this.inputBuffer.hasAllInputsForTick(tick);
  }
  /**
   * Get the number of ticks we're speculating ahead.
   */
  getSpeculationDistance() {
    if (this._confirmedTick < 0) {
      return this._currentTick;
    }
    return this._currentTick - this._confirmedTick - 1;
  }
  /**
   * Get all active player IDs at the current tick.
   */
  getActivePlayers() {
    return this.inputBuffer.getActivePlayers(this._currentTick);
  }
  /**
   * Get all player IDs.
   */
  getAllPlayers() {
    return this.inputBuffer.getAllPlayers();
  }
  /**
   * Reset the engine to initial state.
   */
  reset() {
    this.snapshotBuffer.clear();
    this.inputBuffer.clear();
    this.localInputs.clear();
    this._currentTick = asTick(0);
    this._confirmedTick = asTick(-1);
    this.inputBuffer.addPlayer(this.localPlayerId, asTick(0));
  }
  // =========================================================================
  // Game operation wrappers with error handling
  // =========================================================================
  /**
   * Wrap a game operation with error handling.
   * Catches any error and re-throws it wrapped in a GameError with context.
   */
  wrapGameOperation(operation, tick, fn) {
    try {
      return fn();
    } catch (error) {
      throw new GameError(
        operation,
        tick,
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }
  /**
   * Call game.step() with error wrapping.
   */
  gameStep(tick, inputs) {
    this.wrapGameOperation("step", tick, () => this.game.step(inputs));
  }
  /**
   * Call game.serialize() with error wrapping.
   */
  gameSerialize(tick) {
    return this.wrapGameOperation(
      "serialize",
      tick,
      () => this.game.serialize()
    );
  }
  /**
   * Call game.deserialize() with error wrapping.
   */
  gameDeserialize(tick, state) {
    this.wrapGameOperation(
      "deserialize",
      tick,
      () => this.game.deserialize(state)
    );
  }
  /**
   * Call game.hash() with error wrapping.
   */
  gameHash(tick) {
    return this.wrapGameOperation("hash", tick, () => this.game.hash());
  }
};

// src/utils/rate-limiter.ts
var RateLimiter = class {
  maxRequests;
  windowMs;
  requests = /* @__PURE__ */ new Map();
  getNow;
  constructor(config) {
    if (config.maxRequests <= 0) {
      throw new Error("maxRequests must be greater than 0");
    }
    if (config.windowMs <= 0) {
      throw new Error("windowMs must be greater than 0");
    }
    this.maxRequests = config.maxRequests;
    this.windowMs = config.windowMs;
    this.getNow = config.getNow ?? (() => Date.now());
  }
  /**
   * Check if a key is currently rate limited.
   *
   * @param key - The key to check (e.g., peer ID)
   * @returns true if the key has exceeded the rate limit
   */
  isLimited(key) {
    const now = this.getNow();
    const timestamps = this.requests.get(key) ?? [];
    const recentTimestamps = timestamps.filter((t) => now - t < this.windowMs);
    this.requests.set(key, recentTimestamps);
    return recentTimestamps.length >= this.maxRequests;
  }
  /**
   * Record a request for a key.
   *
   * @param key - The key to record (e.g., peer ID)
   */
  record(key) {
    const timestamps = this.requests.get(key) ?? [];
    timestamps.push(this.getNow());
    this.requests.set(key, timestamps);
  }
  /**
   * Check if limited and record in one operation.
   * Returns true if the request should be rejected.
   *
   * @param key - The key to check and record
   * @returns true if the key is rate limited (request should be rejected)
   */
  checkAndRecord(key) {
    const now = this.getNow();
    const timestamps = this.requests.get(key) ?? [];
    const recentTimestamps = timestamps.filter((t) => now - t < this.windowMs);
    if (recentTimestamps.length >= this.maxRequests) {
      this.requests.set(key, recentTimestamps);
      return true;
    }
    recentTimestamps.push(now);
    this.requests.set(key, recentTimestamps);
    return false;
  }
  /**
   * Clean up stale entries to prevent memory growth.
   * Call this periodically (e.g., every minute).
   */
  cleanup() {
    const now = this.getNow();
    for (const [key, timestamps] of this.requests) {
      const recentTimestamps = timestamps.filter(
        (t) => now - t < this.windowMs
      );
      if (recentTimestamps.length === 0) {
        this.requests.delete(key);
      } else {
        this.requests.set(key, recentTimestamps);
      }
    }
  }
  /**
   * Clear all rate limit entries.
   */
  clear() {
    this.requests.clear();
  }
};

// src/session/desync-manager.ts
var DesyncManager = class {
  topology;
  desyncAuthority;
  hashInterval;
  /** Host-authority mode: hashes received from players, keyed by tick then playerId */
  receivedHashes = /* @__PURE__ */ new Map();
  constructor(config) {
    this.topology = config.topology;
    this.desyncAuthority = config.desyncAuthority;
    this.hashInterval = config.hashInterval;
  }
  /**
   * Whether this is host-authority mode.
   */
  get isHostAuthority() {
    return this.topology === 0 /* Mesh */ && this.desyncAuthority === 0 /* Host */;
  }
  /**
   * Record a hash from a player (host-authority mode).
   *
   * @param tick - The tick the hash is for
   * @param playerId - The player who sent the hash
   * @param hash - The hash value
   */
  recordHash(tick, playerId, hash) {
    let tickHashes = this.receivedHashes.get(tick);
    if (!tickHashes) {
      tickHashes = /* @__PURE__ */ new Map();
      this.receivedHashes.set(tick, tickHashes);
    }
    tickHashes.set(playerId, hash);
  }
  /**
   * Check if we have all hashes for a tick (host-authority mode).
   *
   * @param tick - The tick to check
   * @param expectedPlayerCount - Number of players expected to submit hashes
   * @returns true if all hashes have been received
   */
  hasAllHashes(tick, expectedPlayerCount) {
    const tickHashes = this.receivedHashes.get(tick);
    if (!tickHashes) {
      return false;
    }
    return tickHashes.size >= expectedPlayerCount;
  }
  /**
   * Check for desyncs at a tick (host-authority mode).
   * Compares all player hashes against the reference (host) hash.
   *
   * @param tick - The tick to check
   * @param hostPlayerId - The host's player ID
   * @returns Array of desync results for any desynced players
   */
  checkDesyncs(tick, hostPlayerId) {
    const tickHashes = this.receivedHashes.get(tick);
    if (!tickHashes) {
      return [];
    }
    const hostHash = tickHashes.get(hostPlayerId);
    if (hostHash === void 0) {
      return [];
    }
    const desyncs = [];
    for (const [playerId, playerHash] of tickHashes) {
      if (playerId === hostPlayerId) {
        continue;
      }
      if (playerHash !== hostHash) {
        desyncs.push({
          tick,
          desyncedPlayerId: playerId,
          referenceHash: hostHash,
          playerHash
        });
      }
    }
    return desyncs;
  }
  /**
   * Check for desync in peer mode (comparing local vs remote hash).
   *
   * @param tick - The tick to check
   * @param localHash - Local hash value (or undefined if not available)
   * @param remoteHash - Remote hash value
   * @param remotePlayerId - Remote player's ID
   * @returns Desync result if a desync is detected, null otherwise
   */
  checkPeerDesync(tick, localHash, remoteHash, remotePlayerId) {
    if (localHash === void 0) {
      return null;
    }
    if (localHash !== remoteHash) {
      return {
        tick,
        localHash,
        remoteHash,
        remotePlayerId
      };
    }
    return null;
  }
  /**
   * Remove old hash entries to prevent memory growth.
   *
   * @param currentTick - Current simulation tick
   */
  pruneOldHashes(currentTick) {
    const pruneBelow = asTick(currentTick - this.hashInterval * 2);
    for (const tick of this.receivedHashes.keys()) {
      if (tick < pruneBelow) {
        this.receivedHashes.delete(tick);
      }
    }
  }
  /**
   * Clear all stored hashes.
   */
  clear() {
    this.receivedHashes.clear();
  }
};

// src/session/lag-monitor.ts
var DEFAULT_LAG_REPORT_COOLDOWN_TICKS = 60;
var LagMonitor = class {
  threshold;
  cooldownTicks;
  lastReportTick = /* @__PURE__ */ new Map();
  constructor(config) {
    this.threshold = config.threshold;
    this.cooldownTicks = config.cooldownTicks;
  }
  /**
   * Check if a player is lagging and should be reported.
   *
   * @param playerId - The player to check
   * @param ticksBehind - How many ticks behind the player is
   * @param currentTick - The current simulation tick
   * @returns A LagReport if the player is lagging and cooldown has passed, null otherwise
   */
  checkPlayer(playerId, ticksBehind, currentTick) {
    if (this.threshold <= 0) {
      return null;
    }
    if (ticksBehind < this.threshold) {
      return null;
    }
    const lastReport = this.lastReportTick.get(playerId);
    if (lastReport !== void 0 && currentTick - lastReport < this.cooldownTicks) {
      return null;
    }
    this.lastReportTick.set(playerId, currentTick);
    return {
      laggyPlayerId: playerId,
      ticksBehind
    };
  }
  /**
   * Reset the cooldown for a player.
   * Use this when a player recovers from lag.
   *
   * @param playerId - The player to reset
   */
  reset(playerId) {
    this.lastReportTick.delete(playerId);
  }
  /**
   * Clear all lag tracking state.
   */
  clear() {
    this.lastReportTick.clear();
  }
  /**
   * Whether lag monitoring is enabled.
   */
  get isEnabled() {
    return this.threshold > 0;
  }
};

// src/session/message-builders.ts
function createJoinRequest(playerId, role) {
  return {
    type: 48 /* JoinRequest */,
    playerId,
    role
  };
}
function createPlayerLeft(playerId, leaveTick) {
  return {
    type: 53 /* PlayerLeft */,
    playerId,
    leaveTick
  };
}
function createSync(tick, state, hash, playerTimeline) {
  return {
    type: 17 /* Sync */,
    tick,
    state,
    hash,
    playerTimeline
  };
}
function createPause(playerId, pauseTick, reason) {
  return {
    type: 32 /* Pause */,
    playerId,
    pauseTick,
    reason
  };
}
function createResume(playerId, resumeTick) {
  return {
    type: 33 /* Resume */,
    playerId,
    resumeTick
  };
}
function createResumeCountdown(secondsRemaining) {
  return {
    type: 36 /* ResumeCountdown */,
    secondsRemaining
  };
}
function createSyncRequest(playerId, desyncTick, localHash) {
  return {
    type: 18 /* SyncRequest */,
    playerId,
    desyncTick,
    localHash
  };
}
function createDisconnectReport(disconnectedPeerId) {
  return {
    type: 35 /* DisconnectReport */,
    disconnectedPeerId
  };
}
function createLagReport(laggyPlayerId, ticksBehind) {
  return {
    type: 34 /* LagReport */,
    laggyPlayerId,
    ticksBehind
  };
}
function createJoinReject(playerId, reason) {
  return {
    type: 50 /* JoinReject */,
    playerId,
    reason
  };
}
function createJoinAccept(playerId, roomId, config, players) {
  return {
    type: 49 /* JoinAccept */,
    playerId,
    roomId,
    config,
    players
  };
}
function createPlayerJoined(playerId, role, joinTick) {
  return {
    type: 52 /* PlayerJoined */,
    playerId,
    role,
    joinTick
  };
}
function createPing(timestamp) {
  return {
    type: 64 /* Ping */,
    timestamp
  };
}
function createPong(timestamp) {
  return {
    type: 65 /* Pong */,
    timestamp
  };
}
function createInput(playerId, inputs) {
  return {
    type: 1 /* Input */,
    playerId,
    inputs
  };
}
function createHash(playerId, tick, hash) {
  return {
    type: 16 /* Hash */,
    playerId,
    tick,
    hash
  };
}
function createStateSync(tick, state, hash, playerTimeline) {
  return {
    type: 51 /* StateSync */,
    tick,
    state,
    hash,
    playerTimeline
  };
}
function createDropPlayer(playerId, metadata) {
  if (metadata !== void 0) {
    return {
      type: 37 /* DropPlayer */,
      playerId,
      metadata
    };
  }
  return {
    type: 37 /* DropPlayer */,
    playerId
  };
}

// src/session/message-router.ts
var MessageRouter = class {
  handlers;
  onDecodeError;
  constructor(handlers, onDecodeError) {
    this.handlers = handlers;
    this.onDecodeError = onDecodeError;
  }
  /**
   * Route a raw message from a peer.
   *
   * Decodes the message and dispatches to the appropriate handler.
   *
   * @param peerId - The peer ID of the sender
   * @param data - The raw message bytes
   */
  route(peerId, data) {
    let message;
    try {
      message = decodeMessage(data);
    } catch (error) {
      this.onDecodeError(
        error instanceof Error ? error : new Error(String(error)),
        peerId,
        data.length
      );
      return;
    }
    this.dispatch(message, peerId);
  }
  /**
   * Dispatch a decoded message to the appropriate handler.
   *
   * @param message - The decoded message
   * @param peerId - The peer ID of the sender
   */
  dispatch(message, peerId) {
    switch (message.type) {
      case 1 /* Input */:
        this.handlers.onInput?.(message, peerId);
        break;
      case 16 /* Hash */:
        this.handlers.onHash?.(message, peerId);
        break;
      case 17 /* Sync */:
      case 51 /* StateSync */:
        this.handlers.onSync?.(message, peerId);
        break;
      case 18 /* SyncRequest */:
        this.handlers.onSyncRequest?.(message, peerId);
        break;
      case 48 /* JoinRequest */:
        this.handlers.onJoinRequest?.(message, peerId);
        break;
      case 49 /* JoinAccept */:
        this.handlers.onJoinAccept?.(message, peerId);
        break;
      case 50 /* JoinReject */:
        this.handlers.onJoinReject?.(message, peerId);
        break;
      case 52 /* PlayerJoined */:
        this.handlers.onPlayerJoined?.(message, peerId);
        break;
      case 53 /* PlayerLeft */:
        this.handlers.onPlayerLeft?.(message, peerId);
        break;
      case 32 /* Pause */:
        this.handlers.onPause?.(message, peerId);
        break;
      case 33 /* Resume */:
        this.handlers.onResume?.(message, peerId);
        break;
      case 64 /* Ping */:
        this.handlers.onPing?.(message, peerId);
        break;
      case 65 /* Pong */:
        this.handlers.onPong?.(message, peerId);
        break;
      case 35 /* DisconnectReport */:
        this.handlers.onDisconnectReport?.(message, peerId);
        break;
      case 34 /* LagReport */:
        this.handlers.onLagReport?.(message, peerId);
        break;
      case 36 /* ResumeCountdown */:
        this.handlers.onResumeCountdown?.(message, peerId);
        break;
      case 37 /* DropPlayer */:
        this.handlers.onDropPlayer?.(message, peerId);
        break;
      // InputAck is not currently handled by Session
      case 2 /* InputAck */:
        break;
    }
  }
};

// src/session/player-manager.ts
var PlayerManager = class {
  players = /* @__PURE__ */ new Map();
  /**
   * Add a new player to the session.
   *
   * @param info - The player info to add
   */
  addPlayer(info) {
    this.players.set(info.id, info);
  }
  /**
   * Remove a player from the session.
   *
   * @param playerId - The player ID to remove
   * @returns The removed player info, or undefined if not found
   */
  removePlayer(playerId) {
    const player = this.players.get(playerId);
    if (player) {
      this.players.delete(playerId);
    }
    return player;
  }
  /**
   * Get a player by ID.
   *
   * @param playerId - The player ID to look up
   * @returns The player info, or undefined if not found
   */
  getPlayer(playerId) {
    return this.players.get(playerId);
  }
  /**
   * Check if a player exists.
   *
   * @param playerId - The player ID to check
   */
  hasPlayer(playerId) {
    return this.players.has(playerId);
  }
  /**
   * Mark a player as disconnected.
   *
   * @param playerId - The player ID to mark
   * @param leaveTick - The tick when they disconnected (optional)
   * @returns The updated player info, or undefined if not found
   */
  markDisconnected(playerId, leaveTick) {
    const player = this.players.get(playerId);
    if (player) {
      player.connectionState = 2 /* Disconnected */;
      if (leaveTick !== void 0) {
        player.leaveTick = leaveTick;
      }
    }
    return player;
  }
  /**
   * Mark a player as connected.
   *
   * @param playerId - The player ID to mark
   * @returns The updated player info, or undefined if not found
   */
  markConnected(playerId) {
    const player = this.players.get(playerId);
    if (player) {
      player.connectionState = 1 /* Connected */;
    }
    return player;
  }
  /**
   * Get all players that are currently active (connected and role is Player).
   *
   * @returns Array of active player infos
   */
  getActivePlayers() {
    return Array.from(this.players.values()).filter(
      (p) => p.role === 0 /* Player */ && p.connectionState === 1 /* Connected */
    );
  }
  /**
   * Get all connected players (any role).
   *
   * @returns Array of connected player infos
   */
  getConnectedPlayers() {
    return Array.from(this.players.values()).filter(
      (p) => p.connectionState === 1 /* Connected */
    );
  }
  /**
   * Get the count of active players.
   */
  getActivePlayerCount() {
    let count = 0;
    for (const player of this.players.values()) {
      if (player.role === 0 /* Player */ && player.connectionState === 1 /* Connected */) {
        count++;
      }
    }
    return count;
  }
  /**
   * Find the host player.
   *
   * @returns The host player info, or undefined if no host
   */
  findHost() {
    for (const player of this.players.values()) {
      if (player.isHost) {
        return player;
      }
    }
    return void 0;
  }
  /**
   * Get all player IDs.
   */
  getPlayerIds() {
    return Array.from(this.players.keys());
  }
  /**
   * Get all player infos as an array.
   */
  getAllPlayers() {
    return Array.from(this.players.values());
  }
  /**
   * Clear all players.
   */
  clear() {
    this.players.clear();
  }
  /**
   * Number of players in the session.
   */
  get size() {
    return this.players.size;
  }
  /**
   * Iterate over all players.
   */
  [Symbol.iterator]() {
    return this.players.values();
  }
  /**
   * Get players as a readonly map (for compatibility with existing code).
   */
  asReadonlyMap() {
    return this.players;
  }
};

// src/session/topology.ts
var StarTopology = class {
  type = 1 /* Star */;
  shouldRelayInput(fromPeerId, isHost) {
    return isHost;
  }
  getRelayTargets(fromPeerId, allPeers) {
    const targets = [];
    for (const peerId of allPeers) {
      if (peerId !== fromPeerId) {
        targets.push(peerId);
      }
    }
    return targets;
  }
};
var MeshTopology = class {
  type = 0 /* Mesh */;
  shouldRelayInput(_fromPeerId, _isHost) {
    return false;
  }
  getRelayTargets(_fromPeerId, _allPeers) {
    return [];
  }
};
function createTopologyStrategy(topology) {
  switch (topology) {
    case 1 /* Star */:
      return new StarTopology();
    case 0 /* Mesh */:
      return new MeshTopology();
    default: {
      const _exhaustiveCheck = topology;
      throw new Error(`Unknown topology: ${_exhaustiveCheck}`);
    }
  }
}

// src/session/session.ts
var RATE_LIMIT_CLEANUP_INTERVAL_MS = 6e4;
function generateRoomId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID().slice(0, 8);
  }
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let id = "";
  for (let i = 0; i < 8; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}
var Session = class _Session {
  game;
  transport;
  config;
  engine;
  eventHandlers = /* @__PURE__ */ new Map();
  _localPlayerId;
  topologyStrategy;
  debug;
  // Extracted components
  playerManager;
  desyncManager;
  lagMonitor;
  joinRateLimiter;
  messageRouter;
  _state = 0 /* Disconnected */;
  _isHost = false;
  _roomId = null;
  _localRole = 0 /* Player */;
  lastHashBroadcastTick = asTick(-1);
  inputRedundancy;
  /** Timer for periodic rate limit cleanup */
  rateLimitCleanupTimer = null;
  /** Buffer for deferred hash comparison (processed after rollback in tick()) */
  pendingHashMessages = [];
  /** Tracks players whose playerJoined event has been emitted to prevent duplicates during resimulation */
  emittedJoinEvents = /* @__PURE__ */ new Set();
  /** Number of RTT samples to keep for averaging */
  static RTT_SAMPLE_COUNT = 5;
  /** RTT tracking: peerId -> { pendingPings: Map<timestamp, sendTime>, rtt: number } */
  peerRttData = /* @__PURE__ */ new Map();
  /**
   * Create a new session.
   * @throws ValidationError if config values are invalid
   */
  constructor(options) {
    this.game = options.game;
    this.transport = options.transport;
    this.config = { ...DEFAULT_SESSION_CONFIG, ...options.config };
    validateSessionConfig(this.config);
    this._localPlayerId = options.localPlayerId ?? asPlayerId(this.transport.localPeerId);
    validatePlayerId(this._localPlayerId);
    this.topologyStrategy = createTopologyStrategy(this.config.topology);
    this.debug = createDebugLogger(this.config.debug);
    if (this.config.topology === 0 /* Mesh */ && this.config.maxPlayers > 4) {
      console.warn(
        "[rollback-netcode] Mesh topology with >4 players is not recommended. Mesh requires N\xD7(N-1)/2 connections which scales poorly. Consider using Star topology for better performance."
      );
    }
    this.playerManager = new PlayerManager();
    this.desyncManager = new DesyncManager({
      topology: this.config.topology,
      desyncAuthority: this.config.desyncAuthority,
      hashInterval: this.config.hashInterval
    });
    this.lagMonitor = new LagMonitor({
      threshold: this.config.lagReportThreshold,
      cooldownTicks: DEFAULT_LAG_REPORT_COOLDOWN_TICKS
    });
    this.joinRateLimiter = new RateLimiter({
      maxRequests: this.config.joinRateLimitRequests,
      windowMs: this.config.joinRateLimitWindowMs
    });
    this.inputRedundancy = this.config.inputRedundancy;
    this.messageRouter = new MessageRouter(
      this.createMessageHandlers(),
      this.handleDecodeError.bind(this)
    );
    const engineConfig = {
      game: this.game,
      localPlayerId: this._localPlayerId,
      snapshotHistorySize: this.config.snapshotHistorySize,
      maxSpeculationTicks: this.config.maxSpeculationTicks,
      // During resimulation, emit playerJoined when crossing a player's joinTick
      // so the game layer can re-add players that were lost during snapshot restore.
      // Skip if we've already emitted for this player (prevents duplicate events).
      onPlayerAddDuringResimulation: (playerId, _tick) => {
        if (this.emittedJoinEvents.has(playerId)) {
          return;
        }
        const playerInfo = this.playerManager.getPlayer(playerId);
        if (playerInfo) {
          this.emittedJoinEvents.add(playerId);
          this.emit("playerJoined", playerInfo);
        }
      },
      // During resimulation, emit playerLeft when crossing a player's leaveTick
      onPlayerRemoveDuringResimulation: (playerId, _tick) => {
        const playerInfo = this.playerManager.getPlayer(playerId);
        if (playerInfo) {
          this.emit("playerLeft", playerInfo);
        }
      },
      // When rollback occurs, clear emittedJoinEvents for players whose joinTick
      // is after the restore tick, since they need to be re-added during resimulation
      onRollback: (restoreTick) => {
        for (const playerId of this.emittedJoinEvents) {
          const playerInfo = this.playerManager.getPlayer(playerId);
          if (playerInfo && playerInfo.joinTick !== null && playerInfo.joinTick > restoreTick) {
            this.emittedJoinEvents.delete(playerId);
          }
        }
      }
    };
    if (options.inputPredictor) {
      engineConfig.inputPredictor = options.inputPredictor;
    }
    this.engine = new RollbackEngine(engineConfig);
    this.playerManager.addPlayer({
      id: this._localPlayerId,
      connectionState: 1 /* Connected */,
      joinTick: null,
      leaveTick: null,
      isHost: false,
      role: 0 /* Player */
    });
    this.transport.onMessage = this.handleMessage.bind(this);
    this.transport.onConnect = this.handlePeerConnect.bind(this);
    this.transport.onDisconnect = this.handlePeerDisconnect.bind(this);
    const transportWithKeepalive = this.transport;
    if ("onKeepalivePing" in transportWithKeepalive) {
      transportWithKeepalive.onKeepalivePing = (peerId) => {
        this.sendPing(peerId);
      };
    }
    this.rateLimitCleanupTimer = setInterval(() => {
      this.joinRateLimiter.cleanup();
    }, RATE_LIMIT_CLEANUP_INTERVAL_MS);
    if (this.rateLimitCleanupTimer.unref) {
      this.rateLimitCleanupTimer.unref();
    }
  }
  /**
   * Create message handlers bound to this session.
   */
  createMessageHandlers() {
    return {
      onInput: (msg) => this.handleInputMessage(msg),
      onHash: (msg) => this.handleHashMessage(msg),
      onSync: (msg) => this.handleSyncMessage(msg),
      onSyncRequest: (msg) => this.handleSyncRequest(msg),
      onJoinRequest: (msg, peerId) => this.handleJoinRequest(peerId, msg),
      onJoinAccept: (msg) => this.handleJoinAccept(msg),
      onJoinReject: (msg) => this.handleJoinReject(msg),
      onPlayerJoined: (msg) => this.handlePlayerJoined(msg),
      onPlayerLeft: (msg) => this.handlePlayerLeft(msg),
      onPause: (msg) => this.handlePause(msg),
      onResume: (msg) => this.handleResume(msg),
      onPing: (msg, peerId) => this.handlePing(peerId, msg),
      onPong: (msg, peerId) => this.handlePong(peerId, msg),
      onDisconnectReport: (msg) => this.handleDisconnectReport(msg),
      onLagReport: (msg) => this.handleLagReport(msg),
      onResumeCountdown: (msg) => this.handleResumeCountdown(msg),
      onDropPlayer: (msg) => this.handleDropPlayer(msg)
    };
  }
  /**
   * Current session state.
   */
  get state() {
    return this._state;
  }
  /**
   * Map of all players in the session.
   */
  get players() {
    return this.playerManager.asReadonlyMap();
  }
  /**
   * Local player's ID.
   */
  get localPlayerId() {
    return this._localPlayerId;
  }
  /**
   * Whether this session is the host.
   */
  get isHost() {
    return this._isHost;
  }
  /**
   * Current room ID (null if not in a room).
   */
  get roomId() {
    return this._roomId;
  }
  /**
   * Local player's role in the session.
   */
  get localRole() {
    return this._localRole;
  }
  /**
   * Set the local player's role.
   * Must be called before joining a room or starting the game.
   *
   * @param role - The role to set ('pilot' or 'spectator')
   * @throws Error if called while in a room
   */
  setLocalRole(role) {
    if (this._state !== 0 /* Disconnected */) {
      throw new Error("Cannot change role while in a room");
    }
    this._localRole = role;
    const localPlayer = this.playerManager.getPlayer(this.localPlayerId);
    if (localPlayer) {
      localPlayer.role = role;
    }
  }
  /**
   * Current tick from the engine.
   */
  get currentTick() {
    return this.engine.currentTick;
  }
  /**
   * Confirmed tick from the engine.
   */
  get confirmedTick() {
    return this.engine.confirmedTick;
  }
  /**
   * Get connection quality metrics for a player.
   *
   * @param playerId - The player's ID
   * @returns Connection metrics or null if not available
   */
  getPlayerMetrics(playerId) {
    if (playerId === this.localPlayerId) {
      return null;
    }
    const peerId = playerIdToPeerId(playerId);
    if (this.transport.getConnectionMetrics) {
      return this.transport.getConnectionMetrics(peerId);
    }
    return null;
  }
  /**
   * Destroy the session and clean up resources.
   * Call this when the session is no longer needed.
   */
  destroy() {
    this.leaveRoom();
    if (this.rateLimitCleanupTimer) {
      clearInterval(this.rateLimitCleanupTimer);
      this.rateLimitCleanupTimer = null;
    }
    this.joinRateLimiter.clear();
    this.lagMonitor.clear();
    this.desyncManager.clear();
    this.pendingHashMessages = [];
    this.transport.onMessage = null;
    this.transport.onConnect = null;
    this.transport.onDisconnect = null;
  }
  /**
   * Create a new room and become the host.
   *
   * @returns The room ID
   */
  async createRoom() {
    if (this._state !== 0 /* Disconnected */) {
      throw new Error("Already in a room or connecting");
    }
    this._roomId = generateRoomId();
    this._isHost = true;
    const localPlayer = this.playerManager.getPlayer(this.localPlayerId);
    if (localPlayer) {
      localPlayer.isHost = true;
      localPlayer.joinTick = asTick(0);
    }
    this.setState(2 /* Lobby */);
    return this._roomId;
  }
  /**
   * Join an existing room.
   *
   * @param roomId - The room ID to join
   * @param hostPeerId - The host's peer ID
   */
  async joinRoom(roomId, hostPeerId) {
    if (this._state !== 0 /* Disconnected */) {
      throw new Error("Already in a room or connecting");
    }
    this._roomId = roomId;
    this._isHost = false;
    this.setState(1 /* Connecting */);
    await this.transport.connect(hostPeerId);
    this.sendToHost(createJoinRequest(this.localPlayerId, this._localRole));
  }
  /**
   * Leave the current room.
   */
  leaveRoom() {
    if (this._state === 0 /* Disconnected */) {
      return;
    }
    if (this._state === 3 /* Playing */) {
      this.broadcast(
        createPlayerLeft(this.localPlayerId, this.engine.currentTick),
        true
      );
    }
    this.transport.disconnectAll();
    this._roomId = null;
    this._isHost = false;
    this.playerManager.clear();
    this.emittedJoinEvents.clear();
    this.engine.reset();
    this.playerManager.addPlayer({
      id: this.localPlayerId,
      connectionState: 1 /* Connected */,
      joinTick: null,
      leaveTick: null,
      isHost: false,
      role: 0 /* Player */
    });
    this.setState(0 /* Disconnected */);
  }
  /**
   * Start the game (host only).
   * Transitions from lobby to playing state.
   */
  start() {
    if (!this._isHost) {
      throw new Error("Only the host can start the game");
    }
    if (this._state !== 2 /* Lobby */) {
      throw new Error("Can only start from lobby state");
    }
    const startTick = asTick(0);
    for (const player of this.playerManager) {
      player.joinTick = startTick;
      if (player.role === 0 /* Player */) {
        this.engine.addPlayer(player.id, startTick);
      }
    }
    const state = this.engine.getState();
    this.broadcast(
      createStateSync(
        state.tick,
        state.state,
        this.engine.getCurrentHash(),
        state.playerTimeline
      ),
      true
    );
    this.setState(3 /* Playing */);
    this.emit("gameStart");
  }
  /**
   * Pause the game (host only).
   */
  pause(reason = 0 /* PlayerRequest */) {
    if (!this._isHost) {
      throw new Error("Only the host can pause");
    }
    if (this._state !== 3 /* Playing */) {
      return;
    }
    this.broadcast(
      createPause(this.localPlayerId, this.engine.currentTick, reason),
      true
    );
    this.setState(4 /* Paused */);
  }
  /**
   * Resume the game (host only).
   */
  resume() {
    if (!this._isHost) {
      throw new Error("Only the host can resume");
    }
    if (this._state !== 4 /* Paused */) {
      return;
    }
    this.broadcast(
      createResume(this.localPlayerId, this.engine.currentTick),
      true
    );
    this.setState(3 /* Playing */);
  }
  /**
   * Send a resume countdown to all players (host only).
   * Use this before calling resume() to give players time to prepare.
   *
   * @param secondsRemaining - Number of seconds until resume
   */
  sendResumeCountdown(secondsRemaining) {
    if (!this._isHost) {
      throw new Error("Only the host can send resume countdown");
    }
    if (this._state !== 4 /* Paused */) {
      return;
    }
    this.broadcast(createResumeCountdown(secondsRemaining), true);
    this.emit("resumeCountdown", secondsRemaining);
  }
  /**
   * Drop a player from the game (host only).
   * Use this to remove a disconnected or lagging player and allow the game to continue.
   *
   * @param playerId - The player to drop
   * @param metadata - Optional metadata (e.g., AI replacement info)
   */
  dropPlayer(playerId, metadata) {
    if (!this._isHost) {
      throw new Error("Only the host can drop players");
    }
    const player = this.playerManager.getPlayer(playerId);
    if (!player) {
      return;
    }
    this.markPlayerDisconnected(playerId);
    this.broadcast(createDropPlayer(playerId, metadata), true);
    this.emit("playerDropped", playerId, metadata);
  }
  /**
   * Advance the simulation by one tick.
   * Call this at your game's tick rate (e.g., 60 times per second).
   *
   * @param localInput - The local player's input for this tick (required for pilots, ignored for spectators)
   * @returns Tick result with rollback info
   */
  tick(localInput) {
    if (this._state !== 3 /* Playing */) {
      return {
        tick: this.engine.currentTick,
        rolledBack: false
      };
    }
    const currentTick = this.engine.currentTick;
    if (this._localRole === 0 /* Player */) {
      if (!localInput) {
        throw new Error("Players must provide input");
      }
      this.engine.setLocalInput(currentTick, localInput);
      this.broadcastInput(currentTick, localInput);
    }
    const result = this.engine.tick();
    if (result.error) {
      this.debug.warn("Rollback error", {
        tick: result.tick,
        error: result.error.message
      });
      this.emitError(result.error, {
        source: 0 /* Engine */,
        recoverable: true,
        details: {
          tick: result.tick,
          rollbackTarget: result.error.tick
        }
      });
      if (!this._isHost) {
        this.requestSync();
      }
    }
    if (result.rolledBack && result.rollbackTicks !== void 0) {
      this.debug.log("Rollback triggered", {
        tick: result.tick,
        rollbackTicks: result.rollbackTicks
      });
      const rollbackToTick = asTick(result.tick - result.rollbackTicks);
      this.pendingHashMessages = this.pendingHashMessages.filter(
        (h) => h.tick < rollbackToTick
      );
    }
    this.processPendingHashComparisons();
    this.maybeBroadcastHash();
    this.checkAndReportLag();
    return result;
  }
  /**
   * Request state sync from host (for desync recovery).
   */
  requestSync() {
    if (this._isHost) {
      return;
    }
    this.sendToHost(
      createSyncRequest(
        this.localPlayerId,
        this.engine.currentTick,
        this.engine.getCurrentHash()
      )
    );
  }
  /**
   * Register an event handler.
   */
  on(event, handler) {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, /* @__PURE__ */ new Set());
    }
    this.eventHandlers.get(event)?.add(handler);
  }
  /**
   * Remove an event handler.
   */
  off(event, handler) {
    this.eventHandlers.get(event)?.delete(handler);
  }
  /**
   * Remove all event handlers.
   *
   * Optionally specify an event type to only remove handlers for that event.
   * Call this during cleanup to prevent memory leaks.
   *
   * @param event - Optional event type to clear handlers for
   */
  removeAllListeners(event) {
    if (event !== void 0) {
      this.eventHandlers.delete(event);
    } else {
      this.eventHandlers.clear();
    }
  }
  /**
   * Emit an event to all registered handlers.
   */
  emit(event, ...args) {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(...args);
        } catch (handlerError) {
          if (event !== "error") {
            this.emitError(
              handlerError instanceof Error ? handlerError : new Error(String(handlerError)),
              {
                source: 3 /* Session */,
                recoverable: true,
                details: { event }
              }
            );
          }
        }
      }
    }
  }
  /**
   * Emit an error event with context.
   */
  emitError(error, context) {
    this.emit("error", error, context);
  }
  /**
   * Valid state transitions for the session state machine.
   *
   * State machine:
   * ```
   *   Disconnected ──→ Connecting ──→ Lobby ──→ Playing ⇄ Paused
   *        ↑               │            │         │         │
   *        └───────────────┴────────────┴─────────┴─────────┘
   *                    (any state can go to Disconnected)
   * ```
   */
  static VALID_TRANSITIONS = /* @__PURE__ */ new Map([
    [
      0 /* Disconnected */,
      /* @__PURE__ */ new Set([1 /* Connecting */, 2 /* Lobby */])
    ],
    [
      1 /* Connecting */,
      /* @__PURE__ */ new Set([
        2 /* Lobby */,
        3 /* Playing */,
        0 /* Disconnected */
      ])
    ],
    [
      2 /* Lobby */,
      /* @__PURE__ */ new Set([3 /* Playing */, 0 /* Disconnected */])
    ],
    [
      3 /* Playing */,
      /* @__PURE__ */ new Set([4 /* Paused */, 0 /* Disconnected */])
    ],
    [
      4 /* Paused */,
      /* @__PURE__ */ new Set([3 /* Playing */, 0 /* Disconnected */])
    ]
  ]);
  /**
   * Update session state and emit event.
   * Validates that the transition is allowed by the state machine.
   * @throws Error if the transition is not valid
   */
  setState(newState) {
    const oldState = this._state;
    if (oldState === newState) return;
    const validNextStates = _Session.VALID_TRANSITIONS.get(oldState);
    if (!validNextStates?.has(newState)) {
      throw new Error(
        `Invalid state transition: ${SessionState[oldState]} \u2192 ${SessionState[newState]}`
      );
    }
    this._state = newState;
    this.emit("stateChange", newState, oldState);
  }
  /**
   * Handle decode error from message router.
   */
  handleDecodeError(error, peerId, dataLength) {
    this.emitError(error, {
      source: 2 /* Protocol */,
      recoverable: true,
      details: { peerId, dataLength }
    });
  }
  /**
   * Handle incoming message from transport.
   */
  handleMessage(peerId, data) {
    const transportWithMetrics = this.transport;
    transportWithMetrics.recordPeerResponse?.(peerId);
    this.messageRouter.route(peerId, data);
  }
  /**
   * Handle peer connection.
   */
  handlePeerConnect(peerId) {
    this.debug.log("Peer connected", { peerId });
    const playerId = asPlayerId(peerId);
    this.playerManager.markConnected(playerId);
  }
  /**
   * Handle peer disconnection.
   */
  handlePeerDisconnect(peerId) {
    this.debug.log("Peer disconnected", { peerId });
    this.peerRttData.delete(peerId);
    const playerId = asPlayerId(peerId);
    if (this.desyncManager.isHostAuthority && !this._isHost) {
      this.sendToHost(createDisconnectReport(playerId));
      return;
    }
    this.markPlayerDisconnected(playerId);
  }
  /**
   * Mark a player as disconnected and handle cleanup.
   */
  markPlayerDisconnected(playerId) {
    const player = this.playerManager.getPlayer(playerId);
    if (!player) return;
    player.connectionState = 2 /* Disconnected */;
    if (this._state === 3 /* Playing */) {
      player.leaveTick = this.engine.currentTick;
      if (player.role === 0 /* Player */) {
        this.engine.removePlayer(playerId, player.leaveTick);
      }
      this.emittedJoinEvents.delete(playerId);
      this.emit("playerLeft", player);
      if (this._isHost && this.desyncManager.isHostAuthority) {
        this.broadcast(createPlayerLeft(playerId, player.leaveTick), true);
      }
    }
  }
  /**
   * Handle disconnect report from a guest (host only, mesh+host-authority mode).
   */
  handleDisconnectReport(message) {
    if (!this._isHost) return;
    this.debug.log("Received disconnect report", {
      disconnectedPeerId: message.disconnectedPeerId
    });
    this.markPlayerDisconnected(message.disconnectedPeerId);
  }
  /**
   * Handle lag report from a guest (host only).
   */
  handleLagReport(message) {
    if (!this._isHost) return;
    this.emit("lagReport", message.laggyPlayerId, message.ticksBehind);
  }
  /**
   * Check for lagging players and report to host (guests only, when lag threshold is set).
   */
  checkAndReportLag() {
    if (this._isHost) return;
    if (!this.lagMonitor.isEnabled) return;
    const currentTick = this.engine.currentTick;
    for (const player of this.playerManager) {
      if (player.id === this.localPlayerId) continue;
      if (player.role !== 0 /* Player */) continue;
      if (player.connectionState !== 1 /* Connected */) continue;
      const confirmedTick = this.engine.getConfirmedTickForPlayer(player.id);
      if (confirmedTick === void 0) continue;
      const ticksBehind = currentTick - confirmedTick;
      const lagReport = this.lagMonitor.checkPlayer(
        player.id,
        ticksBehind,
        currentTick
      );
      if (lagReport) {
        this.sendToHost(
          createLagReport(lagReport.laggyPlayerId, lagReport.ticksBehind)
        );
        this.debug.log("Sent lag report", {
          laggyPlayerId: lagReport.laggyPlayerId,
          ticksBehind: lagReport.ticksBehind
        });
      }
    }
  }
  /**
   * Handle resume countdown message.
   */
  handleResumeCountdown(message) {
    this.emit("resumeCountdown", message.secondsRemaining);
  }
  /**
   * Handle drop player message.
   */
  handleDropPlayer(message) {
    this.markPlayerDisconnected(message.playerId);
    this.emit("playerDropped", message.playerId, message.metadata);
  }
  /**
   * Handle input message from remote player.
   */
  handleInputMessage(message) {
    for (const { tick, input } of message.inputs) {
      this.engine.receiveRemoteInput(message.playerId, tick, input);
    }
    if (message.inputs.length > 0) {
      this.debug.trace("Inputs received", {
        playerId: message.playerId,
        count: message.inputs.length,
        ticks: message.inputs.map((i) => i.tick)
      });
    }
    if (this.topologyStrategy.shouldRelayInput(message.playerId, this._isHost)) {
      const targets = this.topologyStrategy.getRelayTargets(
        message.playerId,
        this.transport.connectedPeers
      );
      if (targets.length > 0) {
        const encoded = encodeMessage(message);
        for (const peerId of targets) {
          this.transport.send(peerId, encoded, false);
        }
      }
    }
  }
  /**
   * Handle hash message for desync detection.
   */
  handleHashMessage(message) {
    if (this.desyncManager.isHostAuthority) {
      if (this._isHost) {
        this.recordHashAndCheckDesync(
          message.tick,
          message.playerId,
          message.hash
        );
      }
      return;
    }
    this.pendingHashMessages.push({
      tick: message.tick,
      playerId: message.playerId,
      hash: message.hash
    });
  }
  /**
   * Process pending hash comparisons after rollback has corrected state.
   * Called from tick() after engine.tick() completes.
   */
  processPendingHashComparisons() {
    if (this.pendingHashMessages.length === 0) {
      return;
    }
    const currentTick = this.engine.currentTick;
    const confirmedTick = this.engine.confirmedTick;
    const remaining = [];
    const pruneThreshold = asTick(
      Math.max(0, currentTick - this.config.hashInterval * 2)
    );
    for (const pending of this.pendingHashMessages) {
      if (pending.tick < pruneThreshold) {
        continue;
      }
      if (pending.tick > confirmedTick) {
        remaining.push(pending);
        continue;
      }
      const localHash = this.engine.getHash(pending.tick);
      const desyncResult = this.desyncManager.checkPeerDesync(
        pending.tick,
        localHash,
        pending.hash,
        pending.playerId
      );
      if (desyncResult) {
        this.debug.warn("Desync detected", {
          tick: pending.tick,
          localHash: desyncResult.localHash,
          remoteHash: desyncResult.remoteHash,
          remotePlayer: pending.playerId
        });
        this.emit(
          "desync",
          pending.tick,
          desyncResult.localHash,
          desyncResult.remoteHash
        );
        if (!this._isHost) {
          this.requestSync();
        }
      }
    }
    this.pendingHashMessages = remaining;
  }
  /**
   * Handle sync message (state synchronization).
   */
  handleSyncMessage(message) {
    this.engine.setState(message.tick, message.state, message.playerTimeline);
    this.pendingHashMessages = [];
    for (const entry of message.playerTimeline) {
      const connectionState = entry.leaveTick !== null ? 2 /* Disconnected */ : 1 /* Connected */;
      if (!this.playerManager.hasPlayer(entry.playerId)) {
        this.playerManager.addPlayer({
          id: entry.playerId,
          connectionState,
          joinTick: entry.joinTick,
          leaveTick: entry.leaveTick,
          isHost: false,
          role: 0 /* Player */
          // Default to player; role info may come from elsewhere
        });
      } else {
        const existingPlayer = this.playerManager.getPlayer(entry.playerId);
        if (existingPlayer) {
          existingPlayer.connectionState = connectionState;
          existingPlayer.joinTick = entry.joinTick;
          existingPlayer.leaveTick = entry.leaveTick;
        }
      }
    }
    if (this._state === 1 /* Connecting */ || this._state === 2 /* Lobby */) {
      this.setState(3 /* Playing */);
      this.emit("gameStart");
    }
  }
  /**
   * Handle sync request (host only).
   *
   * IMPORTANT: When a sync is requested, we broadcast the authoritative state
   * to ALL players, not just the requester. This ensures all players are
   * synchronized to the same tick, preventing tick divergence issues that
   * can occur with latency:
   *
   * Without broadcast-to-all:
   * 1. Player-2 desyncs, requests sync from host at tick X
   * 2. With latency, host responds with state at tick X+3
   * 3. Player-2 resets to tick X+3, but player-1/3 are at tick X+6
   * 4. Player-1/3's input redundancy doesn't cover tick X+3
   * 5. Player-2 can't advance confirmedTick -> max speculation -> deadlock
   *
   * With broadcast-to-all:
   * - All players reset to the same tick simultaneously
   * - No tick divergence, no deadlock
   */
  handleSyncRequest(message) {
    if (!this._isHost) return;
    const state = this.engine.getState();
    const syncMsg = createSync(
      state.tick,
      state.state,
      this.engine.getCurrentHash(),
      state.playerTimeline
    );
    this.broadcast(syncMsg, true);
    this.engine.resetForSync(state.tick, state.playerTimeline);
    this.pendingHashMessages = [];
  }
  /**
   * Handle join request (host only).
   */
  handleJoinRequest(peerId, message) {
    if (!this._isHost || !this._roomId) return;
    const playerId = message.playerId;
    if (this.joinRateLimiter.checkAndRecord(peerId)) {
      this.sendToPeer(
        peerId,
        createJoinReject(playerId, "Too many join requests, please wait"),
        true
      );
      return;
    }
    if (this.playerManager.getConnectedPlayers().length >= this.config.maxPlayers) {
      this.sendToPeer(peerId, createJoinReject(playerId, "Room is full"), true);
      return;
    }
    this.sendToPeer(
      peerId,
      createJoinAccept(
        playerId,
        this._roomId,
        { tickRate: this.config.tickRate, maxPlayers: this.config.maxPlayers },
        this.playerManager.getPlayerIds()
      ),
      true
    );
    const playerRole = message.role ?? 0 /* Player */;
    const playerInfo = {
      id: playerId,
      connectionState: 1 /* Connected */,
      joinTick: this._state === 3 /* Playing */ ? this.engine.currentTick : null,
      leaveTick: null,
      isHost: false,
      role: playerRole
    };
    this.playerManager.addPlayer(playerInfo);
    if (this._state === 3 /* Playing */ && playerInfo.joinTick !== null && playerRole === 0 /* Player */) {
      this.engine.addPlayer(playerId, playerInfo.joinTick);
    }
    this.emittedJoinEvents.add(playerId);
    this.emit("playerJoined", playerInfo);
    if (this._state === 3 /* Playing */) {
      const state = this.engine.getState();
      this.sendToPeer(
        peerId,
        createStateSync(
          state.tick,
          state.state,
          this.engine.getCurrentHash(),
          state.playerTimeline
        ),
        true
      );
    }
    if (this._state === 3 /* Playing */ && playerInfo.joinTick !== null) {
      this.broadcast(
        createPlayerJoined(playerId, playerRole, playerInfo.joinTick),
        true
      );
    }
  }
  /**
   * Handle join accept.
   */
  handleJoinAccept(message) {
    if (this._state === 1 /* Connecting */) {
      this.setState(2 /* Lobby */);
    }
    for (const playerId of message.players) {
      if (!this.playerManager.hasPlayer(playerId)) {
        this.playerManager.addPlayer({
          id: playerId,
          connectionState: 1 /* Connected */,
          joinTick: null,
          leaveTick: null,
          isHost: playerId === message.players[0],
          // First player is host
          role: 0 /* Player */
          // Default; actual role will come from PlayerJoined
        });
      }
    }
  }
  /**
   * Handle join reject.
   */
  handleJoinReject(message) {
    this.setState(0 /* Disconnected */);
    this.emitError(new Error(`Join rejected: ${message.reason}`), {
      source: 3 /* Session */,
      recoverable: false,
      details: { reason: message.reason, playerId: message.playerId }
    });
  }
  /**
   * Handle player joined notification.
   */
  handlePlayerJoined(message) {
    const playerInfo = {
      id: message.playerId,
      connectionState: 1 /* Connected */,
      joinTick: message.joinTick,
      leaveTick: null,
      isHost: false,
      role: message.role
    };
    this.playerManager.addPlayer(playerInfo);
    if (message.role === 0 /* Player */) {
      this.engine.addPlayer(message.playerId, message.joinTick);
    }
    this.emittedJoinEvents.add(message.playerId);
    this.emit("playerJoined", playerInfo);
  }
  /**
   * Handle player left notification.
   */
  handlePlayerLeft(message) {
    const player = this.playerManager.getPlayer(message.playerId);
    if (player) {
      player.leaveTick = message.leaveTick;
      player.connectionState = 2 /* Disconnected */;
      this.engine.removePlayer(message.playerId, message.leaveTick);
      this.emittedJoinEvents.delete(message.playerId);
      this.emit("playerLeft", player);
      if (this._isHost && this.config.topology === 1 /* Star */) {
        this.broadcast(
          createPlayerLeft(message.playerId, message.leaveTick),
          true
        );
      }
    }
  }
  /**
   * Handle pause message.
   */
  handlePause(_message) {
    this.setState(4 /* Paused */);
  }
  /**
   * Handle resume message.
   */
  handleResume(_message) {
    this.setState(3 /* Playing */);
  }
  /**
   * Handle ping message - respond with pong.
   */
  handlePing(peerId, message) {
    this.transport.send(
      peerId,
      encodeMessage(createPong(message.timestamp)),
      false
    );
  }
  /**
   * Handle pong message - calculate RTT.
   */
  handlePong(peerId, message) {
    const data = this.peerRttData.get(peerId);
    if (!data) return;
    const sentAt = data.pendingPings.get(message.timestamp);
    if (sentAt === void 0) return;
    const rtt = Date.now() - sentAt;
    data.pendingPings.delete(message.timestamp);
    data.samples.push(rtt);
    if (data.samples.length > _Session.RTT_SAMPLE_COUNT) {
      data.samples.shift();
    }
    data.rtt = data.samples.reduce((a, b) => a + b, 0) / data.samples.length;
  }
  /**
   * Send a ping to a peer for RTT measurement.
   *
   * @param peerId - The peer to ping
   */
  sendPing(peerId) {
    const timestamp = Date.now();
    this.transport.send(peerId, encodeMessage(createPing(timestamp)), false);
    let data = this.peerRttData.get(peerId);
    if (!data) {
      data = { pendingPings: /* @__PURE__ */ new Map(), rtt: 0, samples: [] };
      this.peerRttData.set(peerId, data);
    }
    data.pendingPings.set(timestamp, timestamp);
  }
  /**
   * Get the measured RTT to a peer in milliseconds.
   * Returns 0 if no RTT data is available yet.
   *
   * @param peerId - The peer to get RTT for
   */
  getRtt(peerId) {
    return this.peerRttData.get(peerId)?.rtt ?? 0;
  }
  /**
   * Broadcast input to all peers with redundancy.
   */
  broadcastInput(tick, input) {
    const inputs = [];
    inputs.push({ tick, input });
    for (let i = 1; i < this.inputRedundancy; i++) {
      const prevTick = asTick(tick - i);
      if (prevTick >= 0) {
        const prevInput = this.engine.getLocalInput(prevTick);
        if (prevInput) {
          inputs.push({ tick: prevTick, input: prevInput });
        }
      }
    }
    this.broadcast(createInput(this.localPlayerId, inputs), false);
  }
  /**
   * Maybe broadcast hash for desync detection.
   *
   * IMPORTANT: We only broadcast hashes for CONFIRMED ticks, not just completed ticks.
   * A completed tick may have used predicted inputs that turn out to be wrong.
   * Broadcasting a hash based on predictions would cause false desync detections
   * when compared against a peer who has the actual inputs.
   *
   * We find the most recent hash-interval tick that is confirmed and broadcast that.
   */
  maybeBroadcastHash() {
    const confirmedTick = this.engine.confirmedTick;
    const hashTick = asTick(
      Math.floor(confirmedTick / this.config.hashInterval) * this.config.hashInterval
    );
    if (hashTick > 0 && hashTick !== this.lastHashBroadcastTick) {
      this.lastHashBroadcastTick = hashTick;
      const hash = this.engine.getHash(hashTick);
      if (hash === void 0) {
        return;
      }
      const hashMsg = createHash(this.localPlayerId, hashTick, hash);
      if (this.desyncManager.isHostAuthority) {
        if (this._isHost) {
          this.recordHashAndCheckDesync(hashTick, this.localPlayerId, hash);
        } else {
          this.sendToHost(hashMsg);
        }
      } else {
        this.broadcast(hashMsg, true);
      }
    }
  }
  /**
   * Record a hash from a player and check for desync (host-authority mode).
   */
  recordHashAndCheckDesync(tick, playerId, hash) {
    if (!this._isHost) return;
    this.desyncManager.recordHash(tick, playerId, hash);
    const activePlayers = this.playerManager.getActivePlayers();
    if (!this.desyncManager.hasAllHashes(tick, activePlayers.length)) {
      return;
    }
    const desyncs = this.desyncManager.checkDesyncs(tick, this.localPlayerId);
    if (desyncs.length > 0) {
      for (const desync of desyncs) {
        this.debug.warn("Desync detected by host", {
          tick: desync.tick,
          playerId: desync.desyncedPlayerId,
          hostHash: desync.referenceHash,
          playerHash: desync.playerHash
        });
        this.emit(
          "desync",
          desync.tick,
          desync.referenceHash,
          desync.playerHash
        );
      }
      const state = this.engine.getState();
      const syncMsg = createSync(
        state.tick,
        state.state,
        this.engine.getCurrentHash(),
        state.playerTimeline
      );
      this.broadcast(syncMsg, true);
      this.engine.resetForSync(state.tick, state.playerTimeline);
      this.pendingHashMessages = [];
    }
    this.desyncManager.pruneOldHashes(tick);
  }
  /**
   * Send a message to all connected peers.
   */
  broadcast(message, reliable) {
    const encoded = encodeMessage(message);
    this.transport.broadcast(encoded, reliable);
  }
  /**
   * Send a message to a specific peer.
   */
  sendToPeer(peerId, message, reliable) {
    const encoded = encodeMessage(message);
    this.transport.send(peerId, encoded, reliable);
  }
  /**
   * Send a message to the host.
   */
  sendToHost(message) {
    const host = this.playerManager.findHost();
    if (host && host.id !== this.localPlayerId) {
      this.sendToPeer(host.id, message, isReliableMessage(message));
      return;
    }
    const peers = this.transport.connectedPeers;
    if (peers.size > 0) {
      const hostPeerId = peers.values().next().value;
      this.sendToPeer(hostPeerId, message, isReliableMessage(message));
    }
  }
};
function createSession(options) {
  return new Session(options);
}

// src/transport/local.ts
var MessageHeap = class {
  heap = [];
  /**
   * Get the number of messages in the heap.
   */
  get length() {
    return this.heap.length;
  }
  /**
   * Insert a message into the heap. O(log n)
   */
  push(message) {
    this.heap.push(message);
    this.bubbleUp(this.heap.length - 1);
  }
  /**
   * Remove and return the message with the earliest delivery time. O(log n)
   */
  pop() {
    if (this.heap.length === 0) {
      return void 0;
    }
    const min = this.heap[0];
    const last = this.heap.pop();
    if (this.heap.length > 0 && last !== void 0) {
      this.heap[0] = last;
      this.bubbleDown(0);
    }
    return min;
  }
  /**
   * Peek at the message with the earliest delivery time without removing it.
   */
  peek() {
    return this.heap[0];
  }
  /**
   * Clear all messages from the heap.
   */
  clear() {
    this.heap.length = 0;
  }
  /**
   * Move a node up the heap to maintain heap property.
   */
  bubbleUp(startIndex) {
    let idx = startIndex;
    while (idx > 0) {
      const parentIndex = Math.floor((idx - 1) / 2);
      const parent = this.heap[parentIndex];
      const current = this.heap[idx];
      if (parent === void 0 || current === void 0) break;
      if (parent.deliverAt <= current.deliverAt) break;
      this.heap[parentIndex] = current;
      this.heap[idx] = parent;
      idx = parentIndex;
    }
  }
  /**
   * Move a node down the heap to maintain heap property.
   */
  bubbleDown(startIndex) {
    const length = this.heap.length;
    let idx = startIndex;
    while (true) {
      const leftIndex = 2 * idx + 1;
      const rightIndex = 2 * idx + 2;
      let smallest = idx;
      const current = this.heap[idx];
      const left = this.heap[leftIndex];
      const right = this.heap[rightIndex];
      if (current === void 0) break;
      if (leftIndex < length && left !== void 0 && left.deliverAt < current.deliverAt) {
        smallest = leftIndex;
      }
      const smallestItem = this.heap[smallest];
      if (rightIndex < length && right !== void 0 && smallestItem !== void 0 && right.deliverAt < smallestItem.deliverAt) {
        smallest = rightIndex;
      }
      if (smallest === idx) break;
      const swap = this.heap[smallest];
      if (swap !== void 0) {
        this.heap[smallest] = current;
        this.heap[idx] = swap;
      }
      idx = smallest;
    }
  }
};
var SeededRandom = class {
  seed;
  constructor(seed) {
    this.seed = seed;
  }
  /**
   * Returns a random number between 0 and 1.
   */
  next() {
    this.seed = this.seed * 1664525 + 1013904223 >>> 0;
    return this.seed / 4294967295;
  }
};
var LocalTransport = class {
  /**
   * Create a new LocalTransport.
   *
   * @param localPeerId - Unique ID for this transport
   * @param config - Network simulation configuration
   */
  constructor(localPeerId, config) {
    this.localPeerId = localPeerId;
    this.latency = config?.latency ?? 0;
    this.jitter = config?.jitter ?? 0;
    this.packetLoss = config?.packetLoss ?? 0;
    const deterministic = config?.deterministic ?? false;
    const seed = config?.seed ?? 12345;
    this.random = deterministic ? new SeededRandom(seed) : null;
  }
  onMessage = null;
  onConnect = null;
  onDisconnect = null;
  onError = null;
  /** Callback for keepalive ping - set by Session to send Ping messages */
  onKeepalivePing = null;
  _connectedPeers = /* @__PURE__ */ new Set();
  linkedTransports = /* @__PURE__ */ new Map();
  pendingMessages = new MessageHeap();
  packetLoss;
  random;
  currentTime = 0;
  /** Simulated one-way latency in milliseconds */
  _latency = 0;
  /** Simulated jitter (latency variation) in milliseconds */
  _jitter = 0;
  /**
   * Get the set of connected peer IDs.
   */
  get connectedPeers() {
    return this._connectedPeers;
  }
  /**
   * Link two LocalTransport instances together.
   * Creates a bidirectional connection.
   *
   * @param a - First transport
   * @param b - Second transport
   */
  static link(a, b) {
    a.linkedTransports.set(b.localPeerId, b);
    b.linkedTransports.set(a.localPeerId, a);
  }
  /**
   * Unlink two LocalTransport instances.
   *
   * @param a - First transport
   * @param b - Second transport
   */
  static unlink(a, b) {
    a.linkedTransports.delete(b.localPeerId);
    b.linkedTransports.delete(a.localPeerId);
  }
  /**
   * Connect to a peer.
   * The peer must be linked via LocalTransport.link().
   */
  async connect(peerId) {
    const peer = this.linkedTransports.get(peerId);
    if (!peer) {
      throw new Error(`Peer ${peerId} is not linked`);
    }
    if (this._connectedPeers.has(peerId)) {
      return;
    }
    this._connectedPeers.add(peerId);
    peer._connectedPeers.add(this.localPeerId);
    this.onConnect?.(peerId);
    peer.onConnect?.(this.localPeerId);
  }
  /**
   * Disconnect from a peer.
   */
  disconnect(peerId) {
    if (!this._connectedPeers.has(peerId)) {
      return;
    }
    const peer = this.linkedTransports.get(peerId);
    this._connectedPeers.delete(peerId);
    if (peer) {
      peer._connectedPeers.delete(this.localPeerId);
      peer.onDisconnect?.(this.localPeerId);
    }
    this.onDisconnect?.(peerId);
  }
  /**
   * Disconnect from all peers.
   */
  disconnectAll() {
    const peers = Array.from(this._connectedPeers);
    for (const peerId of peers) {
      this.disconnect(peerId);
    }
  }
  /**
   * Send a message to a specific peer.
   * Uses a min-heap for O(log n) insertion instead of O(n log n) sort.
   */
  send(peerId, message, reliable) {
    if (!this._connectedPeers.has(peerId)) {
      return;
    }
    if (!reliable && this.shouldDropPacket()) {
      return;
    }
    const deliverAt = this.currentTime + this.calculateDelay();
    const messageCopy = new Uint8Array(message.length);
    messageCopy.set(message);
    this.pendingMessages.push({
      targetPeerId: peerId,
      message: messageCopy,
      deliverAt,
      reliable
    });
  }
  /**
   * Broadcast a message to all connected peers.
   */
  broadcast(message, reliable) {
    for (const peerId of this._connectedPeers) {
      this.send(peerId, message, reliable);
    }
  }
  /**
   * Process all pending messages immediately, ignoring simulated delay.
   * Useful for synchronous tests.
   */
  flush() {
    while (this.pendingMessages.length > 0) {
      const pending = this.pendingMessages.pop();
      if (pending !== void 0) {
        this.deliverMessage(pending);
      }
    }
  }
  /**
   * Advance simulated time and deliver any messages due.
   *
   * @param deltaMs - Time to advance in milliseconds
   */
  tick(deltaMs) {
    this.currentTime += deltaMs;
    this.deliverDueMessages();
  }
  /**
   * Get the current simulated time.
   */
  getCurrentTime() {
    return this.currentTime;
  }
  /**
   * Set the current simulated time.
   */
  setCurrentTime(time) {
    this.currentTime = time;
    this.deliverDueMessages();
  }
  /**
   * Get the number of pending messages.
   */
  getPendingMessageCount() {
    return this.pendingMessages.length;
  }
  /**
   * Deliver all messages that are due based on current time.
   * Uses O(k log n) where k is the number of messages delivered.
   */
  deliverDueMessages() {
    while (this.pendingMessages.length > 0) {
      const first = this.pendingMessages.peek();
      if (first === void 0 || first.deliverAt > this.currentTime) {
        break;
      }
      this.pendingMessages.pop();
      this.deliverMessage(first);
    }
  }
  /**
   * Deliver a single message to its target peer.
   * Messages are delivered regardless of current connection state, simulating
   * real networks where messages in flight can arrive after disconnect.
   */
  deliverMessage(pending) {
    const peer = this.linkedTransports.get(pending.targetPeerId);
    if (peer) {
      peer.onMessage?.(this.localPeerId, pending.message);
    }
  }
  /**
   * Calculate delay for a message based on latency and jitter.
   */
  calculateDelay() {
    let delay = this._latency;
    if (this._jitter > 0) {
      const jitterAmount = this.getRandomValue() * this._jitter * 2;
      delay += jitterAmount - this._jitter;
    }
    return Math.max(0, delay);
  }
  /**
   * Determine if a packet should be dropped.
   */
  shouldDropPacket() {
    if (this.packetLoss <= 0) {
      return false;
    }
    return this.getRandomValue() < this.packetLoss;
  }
  /**
   * Get a random value between 0 and 1.
   */
  getRandomValue() {
    if (this.random) {
      return this.random.next();
    }
    return Math.random();
  }
  /**
   * Get the current simulated latency in milliseconds.
   */
  get latency() {
    return this._latency;
  }
  /**
   * Set the simulated latency in milliseconds.
   * Can be changed at any time; affects only new messages.
   */
  set latency(value) {
    this._latency = Math.max(0, value);
  }
  /**
   * Get the current simulated jitter in milliseconds.
   */
  get jitter() {
    return this._jitter;
  }
  /**
   * Set the simulated jitter in milliseconds.
   * Can be changed at any time; affects only new messages.
   */
  set jitter(value) {
    this._jitter = Math.max(0, value);
  }
  /**
   * Trigger keepalive pings for all connected peers.
   * Call this periodically to trigger RTT measurement.
   * The Session will handle the actual Ping/Pong and RTT calculation.
   */
  triggerKeepalive() {
    if (!this.onKeepalivePing) return;
    for (const peerId of this._connectedPeers) {
      this.onKeepalivePing(peerId);
    }
  }
};

// node_modules/pako/dist/pako.esm.mjs
var Z_FIXED$1 = 4;
var Z_BINARY = 0;
var Z_TEXT = 1;
var Z_UNKNOWN$1 = 2;
function zero$1(buf) {
  let len = buf.length;
  while (--len >= 0) {
    buf[len] = 0;
  }
}
var STORED_BLOCK = 0;
var STATIC_TREES = 1;
var DYN_TREES = 2;
var MIN_MATCH$1 = 3;
var MAX_MATCH$1 = 258;
var LENGTH_CODES$1 = 29;
var LITERALS$1 = 256;
var L_CODES$1 = LITERALS$1 + 1 + LENGTH_CODES$1;
var D_CODES$1 = 30;
var BL_CODES$1 = 19;
var HEAP_SIZE$1 = 2 * L_CODES$1 + 1;
var MAX_BITS$1 = 15;
var Buf_size = 16;
var MAX_BL_BITS = 7;
var END_BLOCK = 256;
var REP_3_6 = 16;
var REPZ_3_10 = 17;
var REPZ_11_138 = 18;
var extra_lbits = (
  /* extra bits for each length code */
  new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0])
);
var extra_dbits = (
  /* extra bits for each distance code */
  new Uint8Array([0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13])
);
var extra_blbits = (
  /* extra bits for each bit length code */
  new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 3, 7])
);
var bl_order = new Uint8Array([16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]);
var DIST_CODE_LEN = 512;
var static_ltree = new Array((L_CODES$1 + 2) * 2);
zero$1(static_ltree);
var static_dtree = new Array(D_CODES$1 * 2);
zero$1(static_dtree);
var _dist_code = new Array(DIST_CODE_LEN);
zero$1(_dist_code);
var _length_code = new Array(MAX_MATCH$1 - MIN_MATCH$1 + 1);
zero$1(_length_code);
var base_length = new Array(LENGTH_CODES$1);
zero$1(base_length);
var base_dist = new Array(D_CODES$1);
zero$1(base_dist);
function StaticTreeDesc(static_tree, extra_bits, extra_base, elems, max_length) {
  this.static_tree = static_tree;
  this.extra_bits = extra_bits;
  this.extra_base = extra_base;
  this.elems = elems;
  this.max_length = max_length;
  this.has_stree = static_tree && static_tree.length;
}
var static_l_desc;
var static_d_desc;
var static_bl_desc;
function TreeDesc(dyn_tree, stat_desc) {
  this.dyn_tree = dyn_tree;
  this.max_code = 0;
  this.stat_desc = stat_desc;
}
var d_code = (dist) => {
  return dist < 256 ? _dist_code[dist] : _dist_code[256 + (dist >>> 7)];
};
var put_short = (s, w) => {
  s.pending_buf[s.pending++] = w & 255;
  s.pending_buf[s.pending++] = w >>> 8 & 255;
};
var send_bits = (s, value, length) => {
  if (s.bi_valid > Buf_size - length) {
    s.bi_buf |= value << s.bi_valid & 65535;
    put_short(s, s.bi_buf);
    s.bi_buf = value >> Buf_size - s.bi_valid;
    s.bi_valid += length - Buf_size;
  } else {
    s.bi_buf |= value << s.bi_valid & 65535;
    s.bi_valid += length;
  }
};
var send_code = (s, c, tree) => {
  send_bits(
    s,
    tree[c * 2],
    tree[c * 2 + 1]
    /*.Len*/
  );
};
var bi_reverse = (code, len) => {
  let res = 0;
  do {
    res |= code & 1;
    code >>>= 1;
    res <<= 1;
  } while (--len > 0);
  return res >>> 1;
};
var bi_flush = (s) => {
  if (s.bi_valid === 16) {
    put_short(s, s.bi_buf);
    s.bi_buf = 0;
    s.bi_valid = 0;
  } else if (s.bi_valid >= 8) {
    s.pending_buf[s.pending++] = s.bi_buf & 255;
    s.bi_buf >>= 8;
    s.bi_valid -= 8;
  }
};
var gen_bitlen = (s, desc) => {
  const tree = desc.dyn_tree;
  const max_code = desc.max_code;
  const stree = desc.stat_desc.static_tree;
  const has_stree = desc.stat_desc.has_stree;
  const extra = desc.stat_desc.extra_bits;
  const base = desc.stat_desc.extra_base;
  const max_length = desc.stat_desc.max_length;
  let h;
  let n, m;
  let bits;
  let xbits;
  let f;
  let overflow = 0;
  for (bits = 0; bits <= MAX_BITS$1; bits++) {
    s.bl_count[bits] = 0;
  }
  tree[s.heap[s.heap_max] * 2 + 1] = 0;
  for (h = s.heap_max + 1; h < HEAP_SIZE$1; h++) {
    n = s.heap[h];
    bits = tree[tree[n * 2 + 1] * 2 + 1] + 1;
    if (bits > max_length) {
      bits = max_length;
      overflow++;
    }
    tree[n * 2 + 1] = bits;
    if (n > max_code) {
      continue;
    }
    s.bl_count[bits]++;
    xbits = 0;
    if (n >= base) {
      xbits = extra[n - base];
    }
    f = tree[n * 2];
    s.opt_len += f * (bits + xbits);
    if (has_stree) {
      s.static_len += f * (stree[n * 2 + 1] + xbits);
    }
  }
  if (overflow === 0) {
    return;
  }
  do {
    bits = max_length - 1;
    while (s.bl_count[bits] === 0) {
      bits--;
    }
    s.bl_count[bits]--;
    s.bl_count[bits + 1] += 2;
    s.bl_count[max_length]--;
    overflow -= 2;
  } while (overflow > 0);
  for (bits = max_length; bits !== 0; bits--) {
    n = s.bl_count[bits];
    while (n !== 0) {
      m = s.heap[--h];
      if (m > max_code) {
        continue;
      }
      if (tree[m * 2 + 1] !== bits) {
        s.opt_len += (bits - tree[m * 2 + 1]) * tree[m * 2];
        tree[m * 2 + 1] = bits;
      }
      n--;
    }
  }
};
var gen_codes = (tree, max_code, bl_count) => {
  const next_code = new Array(MAX_BITS$1 + 1);
  let code = 0;
  let bits;
  let n;
  for (bits = 1; bits <= MAX_BITS$1; bits++) {
    code = code + bl_count[bits - 1] << 1;
    next_code[bits] = code;
  }
  for (n = 0; n <= max_code; n++) {
    let len = tree[n * 2 + 1];
    if (len === 0) {
      continue;
    }
    tree[n * 2] = bi_reverse(next_code[len]++, len);
  }
};
var tr_static_init = () => {
  let n;
  let bits;
  let length;
  let code;
  let dist;
  const bl_count = new Array(MAX_BITS$1 + 1);
  length = 0;
  for (code = 0; code < LENGTH_CODES$1 - 1; code++) {
    base_length[code] = length;
    for (n = 0; n < 1 << extra_lbits[code]; n++) {
      _length_code[length++] = code;
    }
  }
  _length_code[length - 1] = code;
  dist = 0;
  for (code = 0; code < 16; code++) {
    base_dist[code] = dist;
    for (n = 0; n < 1 << extra_dbits[code]; n++) {
      _dist_code[dist++] = code;
    }
  }
  dist >>= 7;
  for (; code < D_CODES$1; code++) {
    base_dist[code] = dist << 7;
    for (n = 0; n < 1 << extra_dbits[code] - 7; n++) {
      _dist_code[256 + dist++] = code;
    }
  }
  for (bits = 0; bits <= MAX_BITS$1; bits++) {
    bl_count[bits] = 0;
  }
  n = 0;
  while (n <= 143) {
    static_ltree[n * 2 + 1] = 8;
    n++;
    bl_count[8]++;
  }
  while (n <= 255) {
    static_ltree[n * 2 + 1] = 9;
    n++;
    bl_count[9]++;
  }
  while (n <= 279) {
    static_ltree[n * 2 + 1] = 7;
    n++;
    bl_count[7]++;
  }
  while (n <= 287) {
    static_ltree[n * 2 + 1] = 8;
    n++;
    bl_count[8]++;
  }
  gen_codes(static_ltree, L_CODES$1 + 1, bl_count);
  for (n = 0; n < D_CODES$1; n++) {
    static_dtree[n * 2 + 1] = 5;
    static_dtree[n * 2] = bi_reverse(n, 5);
  }
  static_l_desc = new StaticTreeDesc(static_ltree, extra_lbits, LITERALS$1 + 1, L_CODES$1, MAX_BITS$1);
  static_d_desc = new StaticTreeDesc(static_dtree, extra_dbits, 0, D_CODES$1, MAX_BITS$1);
  static_bl_desc = new StaticTreeDesc(new Array(0), extra_blbits, 0, BL_CODES$1, MAX_BL_BITS);
};
var init_block = (s) => {
  let n;
  for (n = 0; n < L_CODES$1; n++) {
    s.dyn_ltree[n * 2] = 0;
  }
  for (n = 0; n < D_CODES$1; n++) {
    s.dyn_dtree[n * 2] = 0;
  }
  for (n = 0; n < BL_CODES$1; n++) {
    s.bl_tree[n * 2] = 0;
  }
  s.dyn_ltree[END_BLOCK * 2] = 1;
  s.opt_len = s.static_len = 0;
  s.sym_next = s.matches = 0;
};
var bi_windup = (s) => {
  if (s.bi_valid > 8) {
    put_short(s, s.bi_buf);
  } else if (s.bi_valid > 0) {
    s.pending_buf[s.pending++] = s.bi_buf;
  }
  s.bi_buf = 0;
  s.bi_valid = 0;
};
var smaller = (tree, n, m, depth) => {
  const _n2 = n * 2;
  const _m2 = m * 2;
  return tree[_n2] < tree[_m2] || tree[_n2] === tree[_m2] && depth[n] <= depth[m];
};
var pqdownheap = (s, tree, k) => {
  const v = s.heap[k];
  let j = k << 1;
  while (j <= s.heap_len) {
    if (j < s.heap_len && smaller(tree, s.heap[j + 1], s.heap[j], s.depth)) {
      j++;
    }
    if (smaller(tree, v, s.heap[j], s.depth)) {
      break;
    }
    s.heap[k] = s.heap[j];
    k = j;
    j <<= 1;
  }
  s.heap[k] = v;
};
var compress_block = (s, ltree, dtree) => {
  let dist;
  let lc;
  let sx = 0;
  let code;
  let extra;
  if (s.sym_next !== 0) {
    do {
      dist = s.pending_buf[s.sym_buf + sx++] & 255;
      dist += (s.pending_buf[s.sym_buf + sx++] & 255) << 8;
      lc = s.pending_buf[s.sym_buf + sx++];
      if (dist === 0) {
        send_code(s, lc, ltree);
      } else {
        code = _length_code[lc];
        send_code(s, code + LITERALS$1 + 1, ltree);
        extra = extra_lbits[code];
        if (extra !== 0) {
          lc -= base_length[code];
          send_bits(s, lc, extra);
        }
        dist--;
        code = d_code(dist);
        send_code(s, code, dtree);
        extra = extra_dbits[code];
        if (extra !== 0) {
          dist -= base_dist[code];
          send_bits(s, dist, extra);
        }
      }
    } while (sx < s.sym_next);
  }
  send_code(s, END_BLOCK, ltree);
};
var build_tree = (s, desc) => {
  const tree = desc.dyn_tree;
  const stree = desc.stat_desc.static_tree;
  const has_stree = desc.stat_desc.has_stree;
  const elems = desc.stat_desc.elems;
  let n, m;
  let max_code = -1;
  let node;
  s.heap_len = 0;
  s.heap_max = HEAP_SIZE$1;
  for (n = 0; n < elems; n++) {
    if (tree[n * 2] !== 0) {
      s.heap[++s.heap_len] = max_code = n;
      s.depth[n] = 0;
    } else {
      tree[n * 2 + 1] = 0;
    }
  }
  while (s.heap_len < 2) {
    node = s.heap[++s.heap_len] = max_code < 2 ? ++max_code : 0;
    tree[node * 2] = 1;
    s.depth[node] = 0;
    s.opt_len--;
    if (has_stree) {
      s.static_len -= stree[node * 2 + 1];
    }
  }
  desc.max_code = max_code;
  for (n = s.heap_len >> 1; n >= 1; n--) {
    pqdownheap(s, tree, n);
  }
  node = elems;
  do {
    n = s.heap[
      1
      /*SMALLEST*/
    ];
    s.heap[
      1
      /*SMALLEST*/
    ] = s.heap[s.heap_len--];
    pqdownheap(
      s,
      tree,
      1
      /*SMALLEST*/
    );
    m = s.heap[
      1
      /*SMALLEST*/
    ];
    s.heap[--s.heap_max] = n;
    s.heap[--s.heap_max] = m;
    tree[node * 2] = tree[n * 2] + tree[m * 2];
    s.depth[node] = (s.depth[n] >= s.depth[m] ? s.depth[n] : s.depth[m]) + 1;
    tree[n * 2 + 1] = tree[m * 2 + 1] = node;
    s.heap[
      1
      /*SMALLEST*/
    ] = node++;
    pqdownheap(
      s,
      tree,
      1
      /*SMALLEST*/
    );
  } while (s.heap_len >= 2);
  s.heap[--s.heap_max] = s.heap[
    1
    /*SMALLEST*/
  ];
  gen_bitlen(s, desc);
  gen_codes(tree, max_code, s.bl_count);
};
var scan_tree = (s, tree, max_code) => {
  let n;
  let prevlen = -1;
  let curlen;
  let nextlen = tree[0 * 2 + 1];
  let count = 0;
  let max_count = 7;
  let min_count = 4;
  if (nextlen === 0) {
    max_count = 138;
    min_count = 3;
  }
  tree[(max_code + 1) * 2 + 1] = 65535;
  for (n = 0; n <= max_code; n++) {
    curlen = nextlen;
    nextlen = tree[(n + 1) * 2 + 1];
    if (++count < max_count && curlen === nextlen) {
      continue;
    } else if (count < min_count) {
      s.bl_tree[curlen * 2] += count;
    } else if (curlen !== 0) {
      if (curlen !== prevlen) {
        s.bl_tree[curlen * 2]++;
      }
      s.bl_tree[REP_3_6 * 2]++;
    } else if (count <= 10) {
      s.bl_tree[REPZ_3_10 * 2]++;
    } else {
      s.bl_tree[REPZ_11_138 * 2]++;
    }
    count = 0;
    prevlen = curlen;
    if (nextlen === 0) {
      max_count = 138;
      min_count = 3;
    } else if (curlen === nextlen) {
      max_count = 6;
      min_count = 3;
    } else {
      max_count = 7;
      min_count = 4;
    }
  }
};
var send_tree = (s, tree, max_code) => {
  let n;
  let prevlen = -1;
  let curlen;
  let nextlen = tree[0 * 2 + 1];
  let count = 0;
  let max_count = 7;
  let min_count = 4;
  if (nextlen === 0) {
    max_count = 138;
    min_count = 3;
  }
  for (n = 0; n <= max_code; n++) {
    curlen = nextlen;
    nextlen = tree[(n + 1) * 2 + 1];
    if (++count < max_count && curlen === nextlen) {
      continue;
    } else if (count < min_count) {
      do {
        send_code(s, curlen, s.bl_tree);
      } while (--count !== 0);
    } else if (curlen !== 0) {
      if (curlen !== prevlen) {
        send_code(s, curlen, s.bl_tree);
        count--;
      }
      send_code(s, REP_3_6, s.bl_tree);
      send_bits(s, count - 3, 2);
    } else if (count <= 10) {
      send_code(s, REPZ_3_10, s.bl_tree);
      send_bits(s, count - 3, 3);
    } else {
      send_code(s, REPZ_11_138, s.bl_tree);
      send_bits(s, count - 11, 7);
    }
    count = 0;
    prevlen = curlen;
    if (nextlen === 0) {
      max_count = 138;
      min_count = 3;
    } else if (curlen === nextlen) {
      max_count = 6;
      min_count = 3;
    } else {
      max_count = 7;
      min_count = 4;
    }
  }
};
var build_bl_tree = (s) => {
  let max_blindex;
  scan_tree(s, s.dyn_ltree, s.l_desc.max_code);
  scan_tree(s, s.dyn_dtree, s.d_desc.max_code);
  build_tree(s, s.bl_desc);
  for (max_blindex = BL_CODES$1 - 1; max_blindex >= 3; max_blindex--) {
    if (s.bl_tree[bl_order[max_blindex] * 2 + 1] !== 0) {
      break;
    }
  }
  s.opt_len += 3 * (max_blindex + 1) + 5 + 5 + 4;
  return max_blindex;
};
var send_all_trees = (s, lcodes, dcodes, blcodes) => {
  let rank2;
  send_bits(s, lcodes - 257, 5);
  send_bits(s, dcodes - 1, 5);
  send_bits(s, blcodes - 4, 4);
  for (rank2 = 0; rank2 < blcodes; rank2++) {
    send_bits(s, s.bl_tree[bl_order[rank2] * 2 + 1], 3);
  }
  send_tree(s, s.dyn_ltree, lcodes - 1);
  send_tree(s, s.dyn_dtree, dcodes - 1);
};
var detect_data_type = (s) => {
  let block_mask = 4093624447;
  let n;
  for (n = 0; n <= 31; n++, block_mask >>>= 1) {
    if (block_mask & 1 && s.dyn_ltree[n * 2] !== 0) {
      return Z_BINARY;
    }
  }
  if (s.dyn_ltree[9 * 2] !== 0 || s.dyn_ltree[10 * 2] !== 0 || s.dyn_ltree[13 * 2] !== 0) {
    return Z_TEXT;
  }
  for (n = 32; n < LITERALS$1; n++) {
    if (s.dyn_ltree[n * 2] !== 0) {
      return Z_TEXT;
    }
  }
  return Z_BINARY;
};
var static_init_done = false;
var _tr_init$1 = (s) => {
  if (!static_init_done) {
    tr_static_init();
    static_init_done = true;
  }
  s.l_desc = new TreeDesc(s.dyn_ltree, static_l_desc);
  s.d_desc = new TreeDesc(s.dyn_dtree, static_d_desc);
  s.bl_desc = new TreeDesc(s.bl_tree, static_bl_desc);
  s.bi_buf = 0;
  s.bi_valid = 0;
  init_block(s);
};
var _tr_stored_block$1 = (s, buf, stored_len, last) => {
  send_bits(s, (STORED_BLOCK << 1) + (last ? 1 : 0), 3);
  bi_windup(s);
  put_short(s, stored_len);
  put_short(s, ~stored_len);
  if (stored_len) {
    s.pending_buf.set(s.window.subarray(buf, buf + stored_len), s.pending);
  }
  s.pending += stored_len;
};
var _tr_align$1 = (s) => {
  send_bits(s, STATIC_TREES << 1, 3);
  send_code(s, END_BLOCK, static_ltree);
  bi_flush(s);
};
var _tr_flush_block$1 = (s, buf, stored_len, last) => {
  let opt_lenb, static_lenb;
  let max_blindex = 0;
  if (s.level > 0) {
    if (s.strm.data_type === Z_UNKNOWN$1) {
      s.strm.data_type = detect_data_type(s);
    }
    build_tree(s, s.l_desc);
    build_tree(s, s.d_desc);
    max_blindex = build_bl_tree(s);
    opt_lenb = s.opt_len + 3 + 7 >>> 3;
    static_lenb = s.static_len + 3 + 7 >>> 3;
    if (static_lenb <= opt_lenb) {
      opt_lenb = static_lenb;
    }
  } else {
    opt_lenb = static_lenb = stored_len + 5;
  }
  if (stored_len + 4 <= opt_lenb && buf !== -1) {
    _tr_stored_block$1(s, buf, stored_len, last);
  } else if (s.strategy === Z_FIXED$1 || static_lenb === opt_lenb) {
    send_bits(s, (STATIC_TREES << 1) + (last ? 1 : 0), 3);
    compress_block(s, static_ltree, static_dtree);
  } else {
    send_bits(s, (DYN_TREES << 1) + (last ? 1 : 0), 3);
    send_all_trees(s, s.l_desc.max_code + 1, s.d_desc.max_code + 1, max_blindex + 1);
    compress_block(s, s.dyn_ltree, s.dyn_dtree);
  }
  init_block(s);
  if (last) {
    bi_windup(s);
  }
};
var _tr_tally$1 = (s, dist, lc) => {
  s.pending_buf[s.sym_buf + s.sym_next++] = dist;
  s.pending_buf[s.sym_buf + s.sym_next++] = dist >> 8;
  s.pending_buf[s.sym_buf + s.sym_next++] = lc;
  if (dist === 0) {
    s.dyn_ltree[lc * 2]++;
  } else {
    s.matches++;
    dist--;
    s.dyn_ltree[(_length_code[lc] + LITERALS$1 + 1) * 2]++;
    s.dyn_dtree[d_code(dist) * 2]++;
  }
  return s.sym_next === s.sym_end;
};
var _tr_init_1 = _tr_init$1;
var _tr_stored_block_1 = _tr_stored_block$1;
var _tr_flush_block_1 = _tr_flush_block$1;
var _tr_tally_1 = _tr_tally$1;
var _tr_align_1 = _tr_align$1;
var trees = {
  _tr_init: _tr_init_1,
  _tr_stored_block: _tr_stored_block_1,
  _tr_flush_block: _tr_flush_block_1,
  _tr_tally: _tr_tally_1,
  _tr_align: _tr_align_1
};
var adler32 = (adler, buf, len, pos) => {
  let s1 = adler & 65535 | 0, s2 = adler >>> 16 & 65535 | 0, n = 0;
  while (len !== 0) {
    n = len > 2e3 ? 2e3 : len;
    len -= n;
    do {
      s1 = s1 + buf[pos++] | 0;
      s2 = s2 + s1 | 0;
    } while (--n);
    s1 %= 65521;
    s2 %= 65521;
  }
  return s1 | s2 << 16 | 0;
};
var adler32_1 = adler32;
var makeTable = () => {
  let c, table = [];
  for (var n = 0; n < 256; n++) {
    c = n;
    for (var k = 0; k < 8; k++) {
      c = c & 1 ? 3988292384 ^ c >>> 1 : c >>> 1;
    }
    table[n] = c;
  }
  return table;
};
var crcTable = new Uint32Array(makeTable());
var crc32 = (crc, buf, len, pos) => {
  const t = crcTable;
  const end = pos + len;
  crc ^= -1;
  for (let i = pos; i < end; i++) {
    crc = crc >>> 8 ^ t[(crc ^ buf[i]) & 255];
  }
  return crc ^ -1;
};
var crc32_1 = crc32;
var messages = {
  2: "need dictionary",
  /* Z_NEED_DICT       2  */
  1: "stream end",
  /* Z_STREAM_END      1  */
  0: "",
  /* Z_OK              0  */
  "-1": "file error",
  /* Z_ERRNO         (-1) */
  "-2": "stream error",
  /* Z_STREAM_ERROR  (-2) */
  "-3": "data error",
  /* Z_DATA_ERROR    (-3) */
  "-4": "insufficient memory",
  /* Z_MEM_ERROR     (-4) */
  "-5": "buffer error",
  /* Z_BUF_ERROR     (-5) */
  "-6": "incompatible version"
  /* Z_VERSION_ERROR (-6) */
};
var constants$2 = {
  /* Allowed flush values; see deflate() and inflate() below for details */
  Z_NO_FLUSH: 0,
  Z_PARTIAL_FLUSH: 1,
  Z_SYNC_FLUSH: 2,
  Z_FULL_FLUSH: 3,
  Z_FINISH: 4,
  Z_BLOCK: 5,
  Z_TREES: 6,
  /* Return codes for the compression/decompression functions. Negative values
  * are errors, positive values are used for special but normal events.
  */
  Z_OK: 0,
  Z_STREAM_END: 1,
  Z_NEED_DICT: 2,
  Z_ERRNO: -1,
  Z_STREAM_ERROR: -2,
  Z_DATA_ERROR: -3,
  Z_MEM_ERROR: -4,
  Z_BUF_ERROR: -5,
  //Z_VERSION_ERROR: -6,
  /* compression levels */
  Z_NO_COMPRESSION: 0,
  Z_BEST_SPEED: 1,
  Z_BEST_COMPRESSION: 9,
  Z_DEFAULT_COMPRESSION: -1,
  Z_FILTERED: 1,
  Z_HUFFMAN_ONLY: 2,
  Z_RLE: 3,
  Z_FIXED: 4,
  Z_DEFAULT_STRATEGY: 0,
  /* Possible values of the data_type field (though see inflate()) */
  Z_BINARY: 0,
  Z_TEXT: 1,
  //Z_ASCII:                1, // = Z_TEXT (deprecated)
  Z_UNKNOWN: 2,
  /* The deflate compression method */
  Z_DEFLATED: 8
  //Z_NULL:                 null // Use -1 or null inline, depending on var type
};
var { _tr_init, _tr_stored_block, _tr_flush_block, _tr_tally, _tr_align } = trees;
var {
  Z_NO_FLUSH: Z_NO_FLUSH$2,
  Z_PARTIAL_FLUSH,
  Z_FULL_FLUSH: Z_FULL_FLUSH$1,
  Z_FINISH: Z_FINISH$3,
  Z_BLOCK: Z_BLOCK$1,
  Z_OK: Z_OK$3,
  Z_STREAM_END: Z_STREAM_END$3,
  Z_STREAM_ERROR: Z_STREAM_ERROR$2,
  Z_DATA_ERROR: Z_DATA_ERROR$2,
  Z_BUF_ERROR: Z_BUF_ERROR$1,
  Z_DEFAULT_COMPRESSION: Z_DEFAULT_COMPRESSION$1,
  Z_FILTERED,
  Z_HUFFMAN_ONLY,
  Z_RLE,
  Z_FIXED,
  Z_DEFAULT_STRATEGY: Z_DEFAULT_STRATEGY$1,
  Z_UNKNOWN,
  Z_DEFLATED: Z_DEFLATED$2
} = constants$2;
var MAX_MEM_LEVEL = 9;
var MAX_WBITS$1 = 15;
var DEF_MEM_LEVEL = 8;
var LENGTH_CODES = 29;
var LITERALS = 256;
var L_CODES = LITERALS + 1 + LENGTH_CODES;
var D_CODES = 30;
var BL_CODES = 19;
var HEAP_SIZE = 2 * L_CODES + 1;
var MAX_BITS = 15;
var MIN_MATCH = 3;
var MAX_MATCH = 258;
var MIN_LOOKAHEAD = MAX_MATCH + MIN_MATCH + 1;
var PRESET_DICT = 32;
var INIT_STATE = 42;
var GZIP_STATE = 57;
var EXTRA_STATE = 69;
var NAME_STATE = 73;
var COMMENT_STATE = 91;
var HCRC_STATE = 103;
var BUSY_STATE = 113;
var FINISH_STATE = 666;
var BS_NEED_MORE = 1;
var BS_BLOCK_DONE = 2;
var BS_FINISH_STARTED = 3;
var BS_FINISH_DONE = 4;
var OS_CODE = 3;
var err = (strm, errorCode) => {
  strm.msg = messages[errorCode];
  return errorCode;
};
var rank = (f) => {
  return f * 2 - (f > 4 ? 9 : 0);
};
var zero = (buf) => {
  let len = buf.length;
  while (--len >= 0) {
    buf[len] = 0;
  }
};
var slide_hash = (s) => {
  let n, m;
  let p;
  let wsize = s.w_size;
  n = s.hash_size;
  p = n;
  do {
    m = s.head[--p];
    s.head[p] = m >= wsize ? m - wsize : 0;
  } while (--n);
  n = wsize;
  p = n;
  do {
    m = s.prev[--p];
    s.prev[p] = m >= wsize ? m - wsize : 0;
  } while (--n);
};
var HASH_ZLIB = (s, prev, data) => (prev << s.hash_shift ^ data) & s.hash_mask;
var HASH = HASH_ZLIB;
var flush_pending = (strm) => {
  const s = strm.state;
  let len = s.pending;
  if (len > strm.avail_out) {
    len = strm.avail_out;
  }
  if (len === 0) {
    return;
  }
  strm.output.set(s.pending_buf.subarray(s.pending_out, s.pending_out + len), strm.next_out);
  strm.next_out += len;
  s.pending_out += len;
  strm.total_out += len;
  strm.avail_out -= len;
  s.pending -= len;
  if (s.pending === 0) {
    s.pending_out = 0;
  }
};
var flush_block_only = (s, last) => {
  _tr_flush_block(s, s.block_start >= 0 ? s.block_start : -1, s.strstart - s.block_start, last);
  s.block_start = s.strstart;
  flush_pending(s.strm);
};
var put_byte = (s, b) => {
  s.pending_buf[s.pending++] = b;
};
var putShortMSB = (s, b) => {
  s.pending_buf[s.pending++] = b >>> 8 & 255;
  s.pending_buf[s.pending++] = b & 255;
};
var read_buf = (strm, buf, start, size) => {
  let len = strm.avail_in;
  if (len > size) {
    len = size;
  }
  if (len === 0) {
    return 0;
  }
  strm.avail_in -= len;
  buf.set(strm.input.subarray(strm.next_in, strm.next_in + len), start);
  if (strm.state.wrap === 1) {
    strm.adler = adler32_1(strm.adler, buf, len, start);
  } else if (strm.state.wrap === 2) {
    strm.adler = crc32_1(strm.adler, buf, len, start);
  }
  strm.next_in += len;
  strm.total_in += len;
  return len;
};
var longest_match = (s, cur_match) => {
  let chain_length = s.max_chain_length;
  let scan = s.strstart;
  let match;
  let len;
  let best_len = s.prev_length;
  let nice_match = s.nice_match;
  const limit = s.strstart > s.w_size - MIN_LOOKAHEAD ? s.strstart - (s.w_size - MIN_LOOKAHEAD) : 0;
  const _win = s.window;
  const wmask = s.w_mask;
  const prev = s.prev;
  const strend = s.strstart + MAX_MATCH;
  let scan_end1 = _win[scan + best_len - 1];
  let scan_end = _win[scan + best_len];
  if (s.prev_length >= s.good_match) {
    chain_length >>= 2;
  }
  if (nice_match > s.lookahead) {
    nice_match = s.lookahead;
  }
  do {
    match = cur_match;
    if (_win[match + best_len] !== scan_end || _win[match + best_len - 1] !== scan_end1 || _win[match] !== _win[scan] || _win[++match] !== _win[scan + 1]) {
      continue;
    }
    scan += 2;
    match++;
    do {
    } while (_win[++scan] === _win[++match] && _win[++scan] === _win[++match] && _win[++scan] === _win[++match] && _win[++scan] === _win[++match] && _win[++scan] === _win[++match] && _win[++scan] === _win[++match] && _win[++scan] === _win[++match] && _win[++scan] === _win[++match] && scan < strend);
    len = MAX_MATCH - (strend - scan);
    scan = strend - MAX_MATCH;
    if (len > best_len) {
      s.match_start = cur_match;
      best_len = len;
      if (len >= nice_match) {
        break;
      }
      scan_end1 = _win[scan + best_len - 1];
      scan_end = _win[scan + best_len];
    }
  } while ((cur_match = prev[cur_match & wmask]) > limit && --chain_length !== 0);
  if (best_len <= s.lookahead) {
    return best_len;
  }
  return s.lookahead;
};
var fill_window = (s) => {
  const _w_size = s.w_size;
  let n, more, str;
  do {
    more = s.window_size - s.lookahead - s.strstart;
    if (s.strstart >= _w_size + (_w_size - MIN_LOOKAHEAD)) {
      s.window.set(s.window.subarray(_w_size, _w_size + _w_size - more), 0);
      s.match_start -= _w_size;
      s.strstart -= _w_size;
      s.block_start -= _w_size;
      if (s.insert > s.strstart) {
        s.insert = s.strstart;
      }
      slide_hash(s);
      more += _w_size;
    }
    if (s.strm.avail_in === 0) {
      break;
    }
    n = read_buf(s.strm, s.window, s.strstart + s.lookahead, more);
    s.lookahead += n;
    if (s.lookahead + s.insert >= MIN_MATCH) {
      str = s.strstart - s.insert;
      s.ins_h = s.window[str];
      s.ins_h = HASH(s, s.ins_h, s.window[str + 1]);
      while (s.insert) {
        s.ins_h = HASH(s, s.ins_h, s.window[str + MIN_MATCH - 1]);
        s.prev[str & s.w_mask] = s.head[s.ins_h];
        s.head[s.ins_h] = str;
        str++;
        s.insert--;
        if (s.lookahead + s.insert < MIN_MATCH) {
          break;
        }
      }
    }
  } while (s.lookahead < MIN_LOOKAHEAD && s.strm.avail_in !== 0);
};
var deflate_stored = (s, flush) => {
  let min_block = s.pending_buf_size - 5 > s.w_size ? s.w_size : s.pending_buf_size - 5;
  let len, left, have, last = 0;
  let used = s.strm.avail_in;
  do {
    len = 65535;
    have = s.bi_valid + 42 >> 3;
    if (s.strm.avail_out < have) {
      break;
    }
    have = s.strm.avail_out - have;
    left = s.strstart - s.block_start;
    if (len > left + s.strm.avail_in) {
      len = left + s.strm.avail_in;
    }
    if (len > have) {
      len = have;
    }
    if (len < min_block && (len === 0 && flush !== Z_FINISH$3 || flush === Z_NO_FLUSH$2 || len !== left + s.strm.avail_in)) {
      break;
    }
    last = flush === Z_FINISH$3 && len === left + s.strm.avail_in ? 1 : 0;
    _tr_stored_block(s, 0, 0, last);
    s.pending_buf[s.pending - 4] = len;
    s.pending_buf[s.pending - 3] = len >> 8;
    s.pending_buf[s.pending - 2] = ~len;
    s.pending_buf[s.pending - 1] = ~len >> 8;
    flush_pending(s.strm);
    if (left) {
      if (left > len) {
        left = len;
      }
      s.strm.output.set(s.window.subarray(s.block_start, s.block_start + left), s.strm.next_out);
      s.strm.next_out += left;
      s.strm.avail_out -= left;
      s.strm.total_out += left;
      s.block_start += left;
      len -= left;
    }
    if (len) {
      read_buf(s.strm, s.strm.output, s.strm.next_out, len);
      s.strm.next_out += len;
      s.strm.avail_out -= len;
      s.strm.total_out += len;
    }
  } while (last === 0);
  used -= s.strm.avail_in;
  if (used) {
    if (used >= s.w_size) {
      s.matches = 2;
      s.window.set(s.strm.input.subarray(s.strm.next_in - s.w_size, s.strm.next_in), 0);
      s.strstart = s.w_size;
      s.insert = s.strstart;
    } else {
      if (s.window_size - s.strstart <= used) {
        s.strstart -= s.w_size;
        s.window.set(s.window.subarray(s.w_size, s.w_size + s.strstart), 0);
        if (s.matches < 2) {
          s.matches++;
        }
        if (s.insert > s.strstart) {
          s.insert = s.strstart;
        }
      }
      s.window.set(s.strm.input.subarray(s.strm.next_in - used, s.strm.next_in), s.strstart);
      s.strstart += used;
      s.insert += used > s.w_size - s.insert ? s.w_size - s.insert : used;
    }
    s.block_start = s.strstart;
  }
  if (s.high_water < s.strstart) {
    s.high_water = s.strstart;
  }
  if (last) {
    return BS_FINISH_DONE;
  }
  if (flush !== Z_NO_FLUSH$2 && flush !== Z_FINISH$3 && s.strm.avail_in === 0 && s.strstart === s.block_start) {
    return BS_BLOCK_DONE;
  }
  have = s.window_size - s.strstart;
  if (s.strm.avail_in > have && s.block_start >= s.w_size) {
    s.block_start -= s.w_size;
    s.strstart -= s.w_size;
    s.window.set(s.window.subarray(s.w_size, s.w_size + s.strstart), 0);
    if (s.matches < 2) {
      s.matches++;
    }
    have += s.w_size;
    if (s.insert > s.strstart) {
      s.insert = s.strstart;
    }
  }
  if (have > s.strm.avail_in) {
    have = s.strm.avail_in;
  }
  if (have) {
    read_buf(s.strm, s.window, s.strstart, have);
    s.strstart += have;
    s.insert += have > s.w_size - s.insert ? s.w_size - s.insert : have;
  }
  if (s.high_water < s.strstart) {
    s.high_water = s.strstart;
  }
  have = s.bi_valid + 42 >> 3;
  have = s.pending_buf_size - have > 65535 ? 65535 : s.pending_buf_size - have;
  min_block = have > s.w_size ? s.w_size : have;
  left = s.strstart - s.block_start;
  if (left >= min_block || (left || flush === Z_FINISH$3) && flush !== Z_NO_FLUSH$2 && s.strm.avail_in === 0 && left <= have) {
    len = left > have ? have : left;
    last = flush === Z_FINISH$3 && s.strm.avail_in === 0 && len === left ? 1 : 0;
    _tr_stored_block(s, s.block_start, len, last);
    s.block_start += len;
    flush_pending(s.strm);
  }
  return last ? BS_FINISH_STARTED : BS_NEED_MORE;
};
var deflate_fast = (s, flush) => {
  let hash_head;
  let bflush;
  for (; ; ) {
    if (s.lookahead < MIN_LOOKAHEAD) {
      fill_window(s);
      if (s.lookahead < MIN_LOOKAHEAD && flush === Z_NO_FLUSH$2) {
        return BS_NEED_MORE;
      }
      if (s.lookahead === 0) {
        break;
      }
    }
    hash_head = 0;
    if (s.lookahead >= MIN_MATCH) {
      s.ins_h = HASH(s, s.ins_h, s.window[s.strstart + MIN_MATCH - 1]);
      hash_head = s.prev[s.strstart & s.w_mask] = s.head[s.ins_h];
      s.head[s.ins_h] = s.strstart;
    }
    if (hash_head !== 0 && s.strstart - hash_head <= s.w_size - MIN_LOOKAHEAD) {
      s.match_length = longest_match(s, hash_head);
    }
    if (s.match_length >= MIN_MATCH) {
      bflush = _tr_tally(s, s.strstart - s.match_start, s.match_length - MIN_MATCH);
      s.lookahead -= s.match_length;
      if (s.match_length <= s.max_lazy_match && s.lookahead >= MIN_MATCH) {
        s.match_length--;
        do {
          s.strstart++;
          s.ins_h = HASH(s, s.ins_h, s.window[s.strstart + MIN_MATCH - 1]);
          hash_head = s.prev[s.strstart & s.w_mask] = s.head[s.ins_h];
          s.head[s.ins_h] = s.strstart;
        } while (--s.match_length !== 0);
        s.strstart++;
      } else {
        s.strstart += s.match_length;
        s.match_length = 0;
        s.ins_h = s.window[s.strstart];
        s.ins_h = HASH(s, s.ins_h, s.window[s.strstart + 1]);
      }
    } else {
      bflush = _tr_tally(s, 0, s.window[s.strstart]);
      s.lookahead--;
      s.strstart++;
    }
    if (bflush) {
      flush_block_only(s, false);
      if (s.strm.avail_out === 0) {
        return BS_NEED_MORE;
      }
    }
  }
  s.insert = s.strstart < MIN_MATCH - 1 ? s.strstart : MIN_MATCH - 1;
  if (flush === Z_FINISH$3) {
    flush_block_only(s, true);
    if (s.strm.avail_out === 0) {
      return BS_FINISH_STARTED;
    }
    return BS_FINISH_DONE;
  }
  if (s.sym_next) {
    flush_block_only(s, false);
    if (s.strm.avail_out === 0) {
      return BS_NEED_MORE;
    }
  }
  return BS_BLOCK_DONE;
};
var deflate_slow = (s, flush) => {
  let hash_head;
  let bflush;
  let max_insert;
  for (; ; ) {
    if (s.lookahead < MIN_LOOKAHEAD) {
      fill_window(s);
      if (s.lookahead < MIN_LOOKAHEAD && flush === Z_NO_FLUSH$2) {
        return BS_NEED_MORE;
      }
      if (s.lookahead === 0) {
        break;
      }
    }
    hash_head = 0;
    if (s.lookahead >= MIN_MATCH) {
      s.ins_h = HASH(s, s.ins_h, s.window[s.strstart + MIN_MATCH - 1]);
      hash_head = s.prev[s.strstart & s.w_mask] = s.head[s.ins_h];
      s.head[s.ins_h] = s.strstart;
    }
    s.prev_length = s.match_length;
    s.prev_match = s.match_start;
    s.match_length = MIN_MATCH - 1;
    if (hash_head !== 0 && s.prev_length < s.max_lazy_match && s.strstart - hash_head <= s.w_size - MIN_LOOKAHEAD) {
      s.match_length = longest_match(s, hash_head);
      if (s.match_length <= 5 && (s.strategy === Z_FILTERED || s.match_length === MIN_MATCH && s.strstart - s.match_start > 4096)) {
        s.match_length = MIN_MATCH - 1;
      }
    }
    if (s.prev_length >= MIN_MATCH && s.match_length <= s.prev_length) {
      max_insert = s.strstart + s.lookahead - MIN_MATCH;
      bflush = _tr_tally(s, s.strstart - 1 - s.prev_match, s.prev_length - MIN_MATCH);
      s.lookahead -= s.prev_length - 1;
      s.prev_length -= 2;
      do {
        if (++s.strstart <= max_insert) {
          s.ins_h = HASH(s, s.ins_h, s.window[s.strstart + MIN_MATCH - 1]);
          hash_head = s.prev[s.strstart & s.w_mask] = s.head[s.ins_h];
          s.head[s.ins_h] = s.strstart;
        }
      } while (--s.prev_length !== 0);
      s.match_available = 0;
      s.match_length = MIN_MATCH - 1;
      s.strstart++;
      if (bflush) {
        flush_block_only(s, false);
        if (s.strm.avail_out === 0) {
          return BS_NEED_MORE;
        }
      }
    } else if (s.match_available) {
      bflush = _tr_tally(s, 0, s.window[s.strstart - 1]);
      if (bflush) {
        flush_block_only(s, false);
      }
      s.strstart++;
      s.lookahead--;
      if (s.strm.avail_out === 0) {
        return BS_NEED_MORE;
      }
    } else {
      s.match_available = 1;
      s.strstart++;
      s.lookahead--;
    }
  }
  if (s.match_available) {
    bflush = _tr_tally(s, 0, s.window[s.strstart - 1]);
    s.match_available = 0;
  }
  s.insert = s.strstart < MIN_MATCH - 1 ? s.strstart : MIN_MATCH - 1;
  if (flush === Z_FINISH$3) {
    flush_block_only(s, true);
    if (s.strm.avail_out === 0) {
      return BS_FINISH_STARTED;
    }
    return BS_FINISH_DONE;
  }
  if (s.sym_next) {
    flush_block_only(s, false);
    if (s.strm.avail_out === 0) {
      return BS_NEED_MORE;
    }
  }
  return BS_BLOCK_DONE;
};
var deflate_rle = (s, flush) => {
  let bflush;
  let prev;
  let scan, strend;
  const _win = s.window;
  for (; ; ) {
    if (s.lookahead <= MAX_MATCH) {
      fill_window(s);
      if (s.lookahead <= MAX_MATCH && flush === Z_NO_FLUSH$2) {
        return BS_NEED_MORE;
      }
      if (s.lookahead === 0) {
        break;
      }
    }
    s.match_length = 0;
    if (s.lookahead >= MIN_MATCH && s.strstart > 0) {
      scan = s.strstart - 1;
      prev = _win[scan];
      if (prev === _win[++scan] && prev === _win[++scan] && prev === _win[++scan]) {
        strend = s.strstart + MAX_MATCH;
        do {
        } while (prev === _win[++scan] && prev === _win[++scan] && prev === _win[++scan] && prev === _win[++scan] && prev === _win[++scan] && prev === _win[++scan] && prev === _win[++scan] && prev === _win[++scan] && scan < strend);
        s.match_length = MAX_MATCH - (strend - scan);
        if (s.match_length > s.lookahead) {
          s.match_length = s.lookahead;
        }
      }
    }
    if (s.match_length >= MIN_MATCH) {
      bflush = _tr_tally(s, 1, s.match_length - MIN_MATCH);
      s.lookahead -= s.match_length;
      s.strstart += s.match_length;
      s.match_length = 0;
    } else {
      bflush = _tr_tally(s, 0, s.window[s.strstart]);
      s.lookahead--;
      s.strstart++;
    }
    if (bflush) {
      flush_block_only(s, false);
      if (s.strm.avail_out === 0) {
        return BS_NEED_MORE;
      }
    }
  }
  s.insert = 0;
  if (flush === Z_FINISH$3) {
    flush_block_only(s, true);
    if (s.strm.avail_out === 0) {
      return BS_FINISH_STARTED;
    }
    return BS_FINISH_DONE;
  }
  if (s.sym_next) {
    flush_block_only(s, false);
    if (s.strm.avail_out === 0) {
      return BS_NEED_MORE;
    }
  }
  return BS_BLOCK_DONE;
};
var deflate_huff = (s, flush) => {
  let bflush;
  for (; ; ) {
    if (s.lookahead === 0) {
      fill_window(s);
      if (s.lookahead === 0) {
        if (flush === Z_NO_FLUSH$2) {
          return BS_NEED_MORE;
        }
        break;
      }
    }
    s.match_length = 0;
    bflush = _tr_tally(s, 0, s.window[s.strstart]);
    s.lookahead--;
    s.strstart++;
    if (bflush) {
      flush_block_only(s, false);
      if (s.strm.avail_out === 0) {
        return BS_NEED_MORE;
      }
    }
  }
  s.insert = 0;
  if (flush === Z_FINISH$3) {
    flush_block_only(s, true);
    if (s.strm.avail_out === 0) {
      return BS_FINISH_STARTED;
    }
    return BS_FINISH_DONE;
  }
  if (s.sym_next) {
    flush_block_only(s, false);
    if (s.strm.avail_out === 0) {
      return BS_NEED_MORE;
    }
  }
  return BS_BLOCK_DONE;
};
function Config(good_length, max_lazy, nice_length, max_chain, func) {
  this.good_length = good_length;
  this.max_lazy = max_lazy;
  this.nice_length = nice_length;
  this.max_chain = max_chain;
  this.func = func;
}
var configuration_table = [
  /*      good lazy nice chain */
  new Config(0, 0, 0, 0, deflate_stored),
  /* 0 store only */
  new Config(4, 4, 8, 4, deflate_fast),
  /* 1 max speed, no lazy matches */
  new Config(4, 5, 16, 8, deflate_fast),
  /* 2 */
  new Config(4, 6, 32, 32, deflate_fast),
  /* 3 */
  new Config(4, 4, 16, 16, deflate_slow),
  /* 4 lazy matches */
  new Config(8, 16, 32, 32, deflate_slow),
  /* 5 */
  new Config(8, 16, 128, 128, deflate_slow),
  /* 6 */
  new Config(8, 32, 128, 256, deflate_slow),
  /* 7 */
  new Config(32, 128, 258, 1024, deflate_slow),
  /* 8 */
  new Config(32, 258, 258, 4096, deflate_slow)
  /* 9 max compression */
];
var lm_init = (s) => {
  s.window_size = 2 * s.w_size;
  zero(s.head);
  s.max_lazy_match = configuration_table[s.level].max_lazy;
  s.good_match = configuration_table[s.level].good_length;
  s.nice_match = configuration_table[s.level].nice_length;
  s.max_chain_length = configuration_table[s.level].max_chain;
  s.strstart = 0;
  s.block_start = 0;
  s.lookahead = 0;
  s.insert = 0;
  s.match_length = s.prev_length = MIN_MATCH - 1;
  s.match_available = 0;
  s.ins_h = 0;
};
function DeflateState() {
  this.strm = null;
  this.status = 0;
  this.pending_buf = null;
  this.pending_buf_size = 0;
  this.pending_out = 0;
  this.pending = 0;
  this.wrap = 0;
  this.gzhead = null;
  this.gzindex = 0;
  this.method = Z_DEFLATED$2;
  this.last_flush = -1;
  this.w_size = 0;
  this.w_bits = 0;
  this.w_mask = 0;
  this.window = null;
  this.window_size = 0;
  this.prev = null;
  this.head = null;
  this.ins_h = 0;
  this.hash_size = 0;
  this.hash_bits = 0;
  this.hash_mask = 0;
  this.hash_shift = 0;
  this.block_start = 0;
  this.match_length = 0;
  this.prev_match = 0;
  this.match_available = 0;
  this.strstart = 0;
  this.match_start = 0;
  this.lookahead = 0;
  this.prev_length = 0;
  this.max_chain_length = 0;
  this.max_lazy_match = 0;
  this.level = 0;
  this.strategy = 0;
  this.good_match = 0;
  this.nice_match = 0;
  this.dyn_ltree = new Uint16Array(HEAP_SIZE * 2);
  this.dyn_dtree = new Uint16Array((2 * D_CODES + 1) * 2);
  this.bl_tree = new Uint16Array((2 * BL_CODES + 1) * 2);
  zero(this.dyn_ltree);
  zero(this.dyn_dtree);
  zero(this.bl_tree);
  this.l_desc = null;
  this.d_desc = null;
  this.bl_desc = null;
  this.bl_count = new Uint16Array(MAX_BITS + 1);
  this.heap = new Uint16Array(2 * L_CODES + 1);
  zero(this.heap);
  this.heap_len = 0;
  this.heap_max = 0;
  this.depth = new Uint16Array(2 * L_CODES + 1);
  zero(this.depth);
  this.sym_buf = 0;
  this.lit_bufsize = 0;
  this.sym_next = 0;
  this.sym_end = 0;
  this.opt_len = 0;
  this.static_len = 0;
  this.matches = 0;
  this.insert = 0;
  this.bi_buf = 0;
  this.bi_valid = 0;
}
var deflateStateCheck = (strm) => {
  if (!strm) {
    return 1;
  }
  const s = strm.state;
  if (!s || s.strm !== strm || s.status !== INIT_STATE && //#ifdef GZIP
  s.status !== GZIP_STATE && //#endif
  s.status !== EXTRA_STATE && s.status !== NAME_STATE && s.status !== COMMENT_STATE && s.status !== HCRC_STATE && s.status !== BUSY_STATE && s.status !== FINISH_STATE) {
    return 1;
  }
  return 0;
};
var deflateResetKeep = (strm) => {
  if (deflateStateCheck(strm)) {
    return err(strm, Z_STREAM_ERROR$2);
  }
  strm.total_in = strm.total_out = 0;
  strm.data_type = Z_UNKNOWN;
  const s = strm.state;
  s.pending = 0;
  s.pending_out = 0;
  if (s.wrap < 0) {
    s.wrap = -s.wrap;
  }
  s.status = //#ifdef GZIP
  s.wrap === 2 ? GZIP_STATE : (
    //#endif
    s.wrap ? INIT_STATE : BUSY_STATE
  );
  strm.adler = s.wrap === 2 ? 0 : 1;
  s.last_flush = -2;
  _tr_init(s);
  return Z_OK$3;
};
var deflateReset = (strm) => {
  const ret = deflateResetKeep(strm);
  if (ret === Z_OK$3) {
    lm_init(strm.state);
  }
  return ret;
};
var deflateSetHeader = (strm, head) => {
  if (deflateStateCheck(strm) || strm.state.wrap !== 2) {
    return Z_STREAM_ERROR$2;
  }
  strm.state.gzhead = head;
  return Z_OK$3;
};
var deflateInit2 = (strm, level, method, windowBits, memLevel, strategy) => {
  if (!strm) {
    return Z_STREAM_ERROR$2;
  }
  let wrap = 1;
  if (level === Z_DEFAULT_COMPRESSION$1) {
    level = 6;
  }
  if (windowBits < 0) {
    wrap = 0;
    windowBits = -windowBits;
  } else if (windowBits > 15) {
    wrap = 2;
    windowBits -= 16;
  }
  if (memLevel < 1 || memLevel > MAX_MEM_LEVEL || method !== Z_DEFLATED$2 || windowBits < 8 || windowBits > 15 || level < 0 || level > 9 || strategy < 0 || strategy > Z_FIXED || windowBits === 8 && wrap !== 1) {
    return err(strm, Z_STREAM_ERROR$2);
  }
  if (windowBits === 8) {
    windowBits = 9;
  }
  const s = new DeflateState();
  strm.state = s;
  s.strm = strm;
  s.status = INIT_STATE;
  s.wrap = wrap;
  s.gzhead = null;
  s.w_bits = windowBits;
  s.w_size = 1 << s.w_bits;
  s.w_mask = s.w_size - 1;
  s.hash_bits = memLevel + 7;
  s.hash_size = 1 << s.hash_bits;
  s.hash_mask = s.hash_size - 1;
  s.hash_shift = ~~((s.hash_bits + MIN_MATCH - 1) / MIN_MATCH);
  s.window = new Uint8Array(s.w_size * 2);
  s.head = new Uint16Array(s.hash_size);
  s.prev = new Uint16Array(s.w_size);
  s.lit_bufsize = 1 << memLevel + 6;
  s.pending_buf_size = s.lit_bufsize * 4;
  s.pending_buf = new Uint8Array(s.pending_buf_size);
  s.sym_buf = s.lit_bufsize;
  s.sym_end = (s.lit_bufsize - 1) * 3;
  s.level = level;
  s.strategy = strategy;
  s.method = method;
  return deflateReset(strm);
};
var deflateInit = (strm, level) => {
  return deflateInit2(strm, level, Z_DEFLATED$2, MAX_WBITS$1, DEF_MEM_LEVEL, Z_DEFAULT_STRATEGY$1);
};
var deflate$2 = (strm, flush) => {
  if (deflateStateCheck(strm) || flush > Z_BLOCK$1 || flush < 0) {
    return strm ? err(strm, Z_STREAM_ERROR$2) : Z_STREAM_ERROR$2;
  }
  const s = strm.state;
  if (!strm.output || strm.avail_in !== 0 && !strm.input || s.status === FINISH_STATE && flush !== Z_FINISH$3) {
    return err(strm, strm.avail_out === 0 ? Z_BUF_ERROR$1 : Z_STREAM_ERROR$2);
  }
  const old_flush = s.last_flush;
  s.last_flush = flush;
  if (s.pending !== 0) {
    flush_pending(strm);
    if (strm.avail_out === 0) {
      s.last_flush = -1;
      return Z_OK$3;
    }
  } else if (strm.avail_in === 0 && rank(flush) <= rank(old_flush) && flush !== Z_FINISH$3) {
    return err(strm, Z_BUF_ERROR$1);
  }
  if (s.status === FINISH_STATE && strm.avail_in !== 0) {
    return err(strm, Z_BUF_ERROR$1);
  }
  if (s.status === INIT_STATE && s.wrap === 0) {
    s.status = BUSY_STATE;
  }
  if (s.status === INIT_STATE) {
    let header = Z_DEFLATED$2 + (s.w_bits - 8 << 4) << 8;
    let level_flags = -1;
    if (s.strategy >= Z_HUFFMAN_ONLY || s.level < 2) {
      level_flags = 0;
    } else if (s.level < 6) {
      level_flags = 1;
    } else if (s.level === 6) {
      level_flags = 2;
    } else {
      level_flags = 3;
    }
    header |= level_flags << 6;
    if (s.strstart !== 0) {
      header |= PRESET_DICT;
    }
    header += 31 - header % 31;
    putShortMSB(s, header);
    if (s.strstart !== 0) {
      putShortMSB(s, strm.adler >>> 16);
      putShortMSB(s, strm.adler & 65535);
    }
    strm.adler = 1;
    s.status = BUSY_STATE;
    flush_pending(strm);
    if (s.pending !== 0) {
      s.last_flush = -1;
      return Z_OK$3;
    }
  }
  if (s.status === GZIP_STATE) {
    strm.adler = 0;
    put_byte(s, 31);
    put_byte(s, 139);
    put_byte(s, 8);
    if (!s.gzhead) {
      put_byte(s, 0);
      put_byte(s, 0);
      put_byte(s, 0);
      put_byte(s, 0);
      put_byte(s, 0);
      put_byte(s, s.level === 9 ? 2 : s.strategy >= Z_HUFFMAN_ONLY || s.level < 2 ? 4 : 0);
      put_byte(s, OS_CODE);
      s.status = BUSY_STATE;
      flush_pending(strm);
      if (s.pending !== 0) {
        s.last_flush = -1;
        return Z_OK$3;
      }
    } else {
      put_byte(
        s,
        (s.gzhead.text ? 1 : 0) + (s.gzhead.hcrc ? 2 : 0) + (!s.gzhead.extra ? 0 : 4) + (!s.gzhead.name ? 0 : 8) + (!s.gzhead.comment ? 0 : 16)
      );
      put_byte(s, s.gzhead.time & 255);
      put_byte(s, s.gzhead.time >> 8 & 255);
      put_byte(s, s.gzhead.time >> 16 & 255);
      put_byte(s, s.gzhead.time >> 24 & 255);
      put_byte(s, s.level === 9 ? 2 : s.strategy >= Z_HUFFMAN_ONLY || s.level < 2 ? 4 : 0);
      put_byte(s, s.gzhead.os & 255);
      if (s.gzhead.extra && s.gzhead.extra.length) {
        put_byte(s, s.gzhead.extra.length & 255);
        put_byte(s, s.gzhead.extra.length >> 8 & 255);
      }
      if (s.gzhead.hcrc) {
        strm.adler = crc32_1(strm.adler, s.pending_buf, s.pending, 0);
      }
      s.gzindex = 0;
      s.status = EXTRA_STATE;
    }
  }
  if (s.status === EXTRA_STATE) {
    if (s.gzhead.extra) {
      let beg = s.pending;
      let left = (s.gzhead.extra.length & 65535) - s.gzindex;
      while (s.pending + left > s.pending_buf_size) {
        let copy = s.pending_buf_size - s.pending;
        s.pending_buf.set(s.gzhead.extra.subarray(s.gzindex, s.gzindex + copy), s.pending);
        s.pending = s.pending_buf_size;
        if (s.gzhead.hcrc && s.pending > beg) {
          strm.adler = crc32_1(strm.adler, s.pending_buf, s.pending - beg, beg);
        }
        s.gzindex += copy;
        flush_pending(strm);
        if (s.pending !== 0) {
          s.last_flush = -1;
          return Z_OK$3;
        }
        beg = 0;
        left -= copy;
      }
      let gzhead_extra = new Uint8Array(s.gzhead.extra);
      s.pending_buf.set(gzhead_extra.subarray(s.gzindex, s.gzindex + left), s.pending);
      s.pending += left;
      if (s.gzhead.hcrc && s.pending > beg) {
        strm.adler = crc32_1(strm.adler, s.pending_buf, s.pending - beg, beg);
      }
      s.gzindex = 0;
    }
    s.status = NAME_STATE;
  }
  if (s.status === NAME_STATE) {
    if (s.gzhead.name) {
      let beg = s.pending;
      let val;
      do {
        if (s.pending === s.pending_buf_size) {
          if (s.gzhead.hcrc && s.pending > beg) {
            strm.adler = crc32_1(strm.adler, s.pending_buf, s.pending - beg, beg);
          }
          flush_pending(strm);
          if (s.pending !== 0) {
            s.last_flush = -1;
            return Z_OK$3;
          }
          beg = 0;
        }
        if (s.gzindex < s.gzhead.name.length) {
          val = s.gzhead.name.charCodeAt(s.gzindex++) & 255;
        } else {
          val = 0;
        }
        put_byte(s, val);
      } while (val !== 0);
      if (s.gzhead.hcrc && s.pending > beg) {
        strm.adler = crc32_1(strm.adler, s.pending_buf, s.pending - beg, beg);
      }
      s.gzindex = 0;
    }
    s.status = COMMENT_STATE;
  }
  if (s.status === COMMENT_STATE) {
    if (s.gzhead.comment) {
      let beg = s.pending;
      let val;
      do {
        if (s.pending === s.pending_buf_size) {
          if (s.gzhead.hcrc && s.pending > beg) {
            strm.adler = crc32_1(strm.adler, s.pending_buf, s.pending - beg, beg);
          }
          flush_pending(strm);
          if (s.pending !== 0) {
            s.last_flush = -1;
            return Z_OK$3;
          }
          beg = 0;
        }
        if (s.gzindex < s.gzhead.comment.length) {
          val = s.gzhead.comment.charCodeAt(s.gzindex++) & 255;
        } else {
          val = 0;
        }
        put_byte(s, val);
      } while (val !== 0);
      if (s.gzhead.hcrc && s.pending > beg) {
        strm.adler = crc32_1(strm.adler, s.pending_buf, s.pending - beg, beg);
      }
    }
    s.status = HCRC_STATE;
  }
  if (s.status === HCRC_STATE) {
    if (s.gzhead.hcrc) {
      if (s.pending + 2 > s.pending_buf_size) {
        flush_pending(strm);
        if (s.pending !== 0) {
          s.last_flush = -1;
          return Z_OK$3;
        }
      }
      put_byte(s, strm.adler & 255);
      put_byte(s, strm.adler >> 8 & 255);
      strm.adler = 0;
    }
    s.status = BUSY_STATE;
    flush_pending(strm);
    if (s.pending !== 0) {
      s.last_flush = -1;
      return Z_OK$3;
    }
  }
  if (strm.avail_in !== 0 || s.lookahead !== 0 || flush !== Z_NO_FLUSH$2 && s.status !== FINISH_STATE) {
    let bstate = s.level === 0 ? deflate_stored(s, flush) : s.strategy === Z_HUFFMAN_ONLY ? deflate_huff(s, flush) : s.strategy === Z_RLE ? deflate_rle(s, flush) : configuration_table[s.level].func(s, flush);
    if (bstate === BS_FINISH_STARTED || bstate === BS_FINISH_DONE) {
      s.status = FINISH_STATE;
    }
    if (bstate === BS_NEED_MORE || bstate === BS_FINISH_STARTED) {
      if (strm.avail_out === 0) {
        s.last_flush = -1;
      }
      return Z_OK$3;
    }
    if (bstate === BS_BLOCK_DONE) {
      if (flush === Z_PARTIAL_FLUSH) {
        _tr_align(s);
      } else if (flush !== Z_BLOCK$1) {
        _tr_stored_block(s, 0, 0, false);
        if (flush === Z_FULL_FLUSH$1) {
          zero(s.head);
          if (s.lookahead === 0) {
            s.strstart = 0;
            s.block_start = 0;
            s.insert = 0;
          }
        }
      }
      flush_pending(strm);
      if (strm.avail_out === 0) {
        s.last_flush = -1;
        return Z_OK$3;
      }
    }
  }
  if (flush !== Z_FINISH$3) {
    return Z_OK$3;
  }
  if (s.wrap <= 0) {
    return Z_STREAM_END$3;
  }
  if (s.wrap === 2) {
    put_byte(s, strm.adler & 255);
    put_byte(s, strm.adler >> 8 & 255);
    put_byte(s, strm.adler >> 16 & 255);
    put_byte(s, strm.adler >> 24 & 255);
    put_byte(s, strm.total_in & 255);
    put_byte(s, strm.total_in >> 8 & 255);
    put_byte(s, strm.total_in >> 16 & 255);
    put_byte(s, strm.total_in >> 24 & 255);
  } else {
    putShortMSB(s, strm.adler >>> 16);
    putShortMSB(s, strm.adler & 65535);
  }
  flush_pending(strm);
  if (s.wrap > 0) {
    s.wrap = -s.wrap;
  }
  return s.pending !== 0 ? Z_OK$3 : Z_STREAM_END$3;
};
var deflateEnd = (strm) => {
  if (deflateStateCheck(strm)) {
    return Z_STREAM_ERROR$2;
  }
  const status = strm.state.status;
  strm.state = null;
  return status === BUSY_STATE ? err(strm, Z_DATA_ERROR$2) : Z_OK$3;
};
var deflateSetDictionary = (strm, dictionary) => {
  let dictLength = dictionary.length;
  if (deflateStateCheck(strm)) {
    return Z_STREAM_ERROR$2;
  }
  const s = strm.state;
  const wrap = s.wrap;
  if (wrap === 2 || wrap === 1 && s.status !== INIT_STATE || s.lookahead) {
    return Z_STREAM_ERROR$2;
  }
  if (wrap === 1) {
    strm.adler = adler32_1(strm.adler, dictionary, dictLength, 0);
  }
  s.wrap = 0;
  if (dictLength >= s.w_size) {
    if (wrap === 0) {
      zero(s.head);
      s.strstart = 0;
      s.block_start = 0;
      s.insert = 0;
    }
    let tmpDict = new Uint8Array(s.w_size);
    tmpDict.set(dictionary.subarray(dictLength - s.w_size, dictLength), 0);
    dictionary = tmpDict;
    dictLength = s.w_size;
  }
  const avail = strm.avail_in;
  const next = strm.next_in;
  const input = strm.input;
  strm.avail_in = dictLength;
  strm.next_in = 0;
  strm.input = dictionary;
  fill_window(s);
  while (s.lookahead >= MIN_MATCH) {
    let str = s.strstart;
    let n = s.lookahead - (MIN_MATCH - 1);
    do {
      s.ins_h = HASH(s, s.ins_h, s.window[str + MIN_MATCH - 1]);
      s.prev[str & s.w_mask] = s.head[s.ins_h];
      s.head[s.ins_h] = str;
      str++;
    } while (--n);
    s.strstart = str;
    s.lookahead = MIN_MATCH - 1;
    fill_window(s);
  }
  s.strstart += s.lookahead;
  s.block_start = s.strstart;
  s.insert = s.lookahead;
  s.lookahead = 0;
  s.match_length = s.prev_length = MIN_MATCH - 1;
  s.match_available = 0;
  strm.next_in = next;
  strm.input = input;
  strm.avail_in = avail;
  s.wrap = wrap;
  return Z_OK$3;
};
var deflateInit_1 = deflateInit;
var deflateInit2_1 = deflateInit2;
var deflateReset_1 = deflateReset;
var deflateResetKeep_1 = deflateResetKeep;
var deflateSetHeader_1 = deflateSetHeader;
var deflate_2$1 = deflate$2;
var deflateEnd_1 = deflateEnd;
var deflateSetDictionary_1 = deflateSetDictionary;
var deflateInfo = "pako deflate (from Nodeca project)";
var deflate_1$2 = {
  deflateInit: deflateInit_1,
  deflateInit2: deflateInit2_1,
  deflateReset: deflateReset_1,
  deflateResetKeep: deflateResetKeep_1,
  deflateSetHeader: deflateSetHeader_1,
  deflate: deflate_2$1,
  deflateEnd: deflateEnd_1,
  deflateSetDictionary: deflateSetDictionary_1,
  deflateInfo
};
var _has = (obj, key) => {
  return Object.prototype.hasOwnProperty.call(obj, key);
};
var assign = function(obj) {
  const sources = Array.prototype.slice.call(arguments, 1);
  while (sources.length) {
    const source = sources.shift();
    if (!source) {
      continue;
    }
    if (typeof source !== "object") {
      throw new TypeError(source + "must be non-object");
    }
    for (const p in source) {
      if (_has(source, p)) {
        obj[p] = source[p];
      }
    }
  }
  return obj;
};
var flattenChunks = (chunks) => {
  let len = 0;
  for (let i = 0, l = chunks.length; i < l; i++) {
    len += chunks[i].length;
  }
  const result = new Uint8Array(len);
  for (let i = 0, pos = 0, l = chunks.length; i < l; i++) {
    let chunk = chunks[i];
    result.set(chunk, pos);
    pos += chunk.length;
  }
  return result;
};
var common = {
  assign,
  flattenChunks
};
var STR_APPLY_UIA_OK = true;
try {
  String.fromCharCode.apply(null, new Uint8Array(1));
} catch (__) {
  STR_APPLY_UIA_OK = false;
}
var _utf8len = new Uint8Array(256);
for (let q = 0; q < 256; q++) {
  _utf8len[q] = q >= 252 ? 6 : q >= 248 ? 5 : q >= 240 ? 4 : q >= 224 ? 3 : q >= 192 ? 2 : 1;
}
_utf8len[254] = _utf8len[254] = 1;
var string2buf = (str) => {
  if (typeof TextEncoder === "function" && TextEncoder.prototype.encode) {
    return new TextEncoder().encode(str);
  }
  let buf, c, c2, m_pos, i, str_len = str.length, buf_len = 0;
  for (m_pos = 0; m_pos < str_len; m_pos++) {
    c = str.charCodeAt(m_pos);
    if ((c & 64512) === 55296 && m_pos + 1 < str_len) {
      c2 = str.charCodeAt(m_pos + 1);
      if ((c2 & 64512) === 56320) {
        c = 65536 + (c - 55296 << 10) + (c2 - 56320);
        m_pos++;
      }
    }
    buf_len += c < 128 ? 1 : c < 2048 ? 2 : c < 65536 ? 3 : 4;
  }
  buf = new Uint8Array(buf_len);
  for (i = 0, m_pos = 0; i < buf_len; m_pos++) {
    c = str.charCodeAt(m_pos);
    if ((c & 64512) === 55296 && m_pos + 1 < str_len) {
      c2 = str.charCodeAt(m_pos + 1);
      if ((c2 & 64512) === 56320) {
        c = 65536 + (c - 55296 << 10) + (c2 - 56320);
        m_pos++;
      }
    }
    if (c < 128) {
      buf[i++] = c;
    } else if (c < 2048) {
      buf[i++] = 192 | c >>> 6;
      buf[i++] = 128 | c & 63;
    } else if (c < 65536) {
      buf[i++] = 224 | c >>> 12;
      buf[i++] = 128 | c >>> 6 & 63;
      buf[i++] = 128 | c & 63;
    } else {
      buf[i++] = 240 | c >>> 18;
      buf[i++] = 128 | c >>> 12 & 63;
      buf[i++] = 128 | c >>> 6 & 63;
      buf[i++] = 128 | c & 63;
    }
  }
  return buf;
};
var buf2binstring = (buf, len) => {
  if (len < 65534) {
    if (buf.subarray && STR_APPLY_UIA_OK) {
      return String.fromCharCode.apply(null, buf.length === len ? buf : buf.subarray(0, len));
    }
  }
  let result = "";
  for (let i = 0; i < len; i++) {
    result += String.fromCharCode(buf[i]);
  }
  return result;
};
var buf2string = (buf, max) => {
  const len = max || buf.length;
  if (typeof TextDecoder === "function" && TextDecoder.prototype.decode) {
    return new TextDecoder().decode(buf.subarray(0, max));
  }
  let i, out;
  const utf16buf = new Array(len * 2);
  for (out = 0, i = 0; i < len; ) {
    let c = buf[i++];
    if (c < 128) {
      utf16buf[out++] = c;
      continue;
    }
    let c_len = _utf8len[c];
    if (c_len > 4) {
      utf16buf[out++] = 65533;
      i += c_len - 1;
      continue;
    }
    c &= c_len === 2 ? 31 : c_len === 3 ? 15 : 7;
    while (c_len > 1 && i < len) {
      c = c << 6 | buf[i++] & 63;
      c_len--;
    }
    if (c_len > 1) {
      utf16buf[out++] = 65533;
      continue;
    }
    if (c < 65536) {
      utf16buf[out++] = c;
    } else {
      c -= 65536;
      utf16buf[out++] = 55296 | c >> 10 & 1023;
      utf16buf[out++] = 56320 | c & 1023;
    }
  }
  return buf2binstring(utf16buf, out);
};
var utf8border = (buf, max) => {
  max = max || buf.length;
  if (max > buf.length) {
    max = buf.length;
  }
  let pos = max - 1;
  while (pos >= 0 && (buf[pos] & 192) === 128) {
    pos--;
  }
  if (pos < 0) {
    return max;
  }
  if (pos === 0) {
    return max;
  }
  return pos + _utf8len[buf[pos]] > max ? pos : max;
};
var strings = {
  string2buf,
  buf2string,
  utf8border
};
function ZStream() {
  this.input = null;
  this.next_in = 0;
  this.avail_in = 0;
  this.total_in = 0;
  this.output = null;
  this.next_out = 0;
  this.avail_out = 0;
  this.total_out = 0;
  this.msg = "";
  this.state = null;
  this.data_type = 2;
  this.adler = 0;
}
var zstream = ZStream;
var toString$1 = Object.prototype.toString;
var {
  Z_NO_FLUSH: Z_NO_FLUSH$1,
  Z_SYNC_FLUSH,
  Z_FULL_FLUSH,
  Z_FINISH: Z_FINISH$2,
  Z_OK: Z_OK$2,
  Z_STREAM_END: Z_STREAM_END$2,
  Z_DEFAULT_COMPRESSION,
  Z_DEFAULT_STRATEGY,
  Z_DEFLATED: Z_DEFLATED$1
} = constants$2;
function Deflate$1(options) {
  this.options = common.assign({
    level: Z_DEFAULT_COMPRESSION,
    method: Z_DEFLATED$1,
    chunkSize: 16384,
    windowBits: 15,
    memLevel: 8,
    strategy: Z_DEFAULT_STRATEGY
  }, options || {});
  let opt = this.options;
  if (opt.raw && opt.windowBits > 0) {
    opt.windowBits = -opt.windowBits;
  } else if (opt.gzip && opt.windowBits > 0 && opt.windowBits < 16) {
    opt.windowBits += 16;
  }
  this.err = 0;
  this.msg = "";
  this.ended = false;
  this.chunks = [];
  this.strm = new zstream();
  this.strm.avail_out = 0;
  let status = deflate_1$2.deflateInit2(
    this.strm,
    opt.level,
    opt.method,
    opt.windowBits,
    opt.memLevel,
    opt.strategy
  );
  if (status !== Z_OK$2) {
    throw new Error(messages[status]);
  }
  if (opt.header) {
    deflate_1$2.deflateSetHeader(this.strm, opt.header);
  }
  if (opt.dictionary) {
    let dict;
    if (typeof opt.dictionary === "string") {
      dict = strings.string2buf(opt.dictionary);
    } else if (toString$1.call(opt.dictionary) === "[object ArrayBuffer]") {
      dict = new Uint8Array(opt.dictionary);
    } else {
      dict = opt.dictionary;
    }
    status = deflate_1$2.deflateSetDictionary(this.strm, dict);
    if (status !== Z_OK$2) {
      throw new Error(messages[status]);
    }
    this._dict_set = true;
  }
}
Deflate$1.prototype.push = function(data, flush_mode) {
  const strm = this.strm;
  const chunkSize = this.options.chunkSize;
  let status, _flush_mode;
  if (this.ended) {
    return false;
  }
  if (flush_mode === ~~flush_mode) _flush_mode = flush_mode;
  else _flush_mode = flush_mode === true ? Z_FINISH$2 : Z_NO_FLUSH$1;
  if (typeof data === "string") {
    strm.input = strings.string2buf(data);
  } else if (toString$1.call(data) === "[object ArrayBuffer]") {
    strm.input = new Uint8Array(data);
  } else {
    strm.input = data;
  }
  strm.next_in = 0;
  strm.avail_in = strm.input.length;
  for (; ; ) {
    if (strm.avail_out === 0) {
      strm.output = new Uint8Array(chunkSize);
      strm.next_out = 0;
      strm.avail_out = chunkSize;
    }
    if ((_flush_mode === Z_SYNC_FLUSH || _flush_mode === Z_FULL_FLUSH) && strm.avail_out <= 6) {
      this.onData(strm.output.subarray(0, strm.next_out));
      strm.avail_out = 0;
      continue;
    }
    status = deflate_1$2.deflate(strm, _flush_mode);
    if (status === Z_STREAM_END$2) {
      if (strm.next_out > 0) {
        this.onData(strm.output.subarray(0, strm.next_out));
      }
      status = deflate_1$2.deflateEnd(this.strm);
      this.onEnd(status);
      this.ended = true;
      return status === Z_OK$2;
    }
    if (strm.avail_out === 0) {
      this.onData(strm.output);
      continue;
    }
    if (_flush_mode > 0 && strm.next_out > 0) {
      this.onData(strm.output.subarray(0, strm.next_out));
      strm.avail_out = 0;
      continue;
    }
    if (strm.avail_in === 0) break;
  }
  return true;
};
Deflate$1.prototype.onData = function(chunk) {
  this.chunks.push(chunk);
};
Deflate$1.prototype.onEnd = function(status) {
  if (status === Z_OK$2) {
    this.result = common.flattenChunks(this.chunks);
  }
  this.chunks = [];
  this.err = status;
  this.msg = this.strm.msg;
};
function deflate$1(input, options) {
  const deflator = new Deflate$1(options);
  deflator.push(input, true);
  if (deflator.err) {
    throw deflator.msg || messages[deflator.err];
  }
  return deflator.result;
}
function deflateRaw$1(input, options) {
  options = options || {};
  options.raw = true;
  return deflate$1(input, options);
}
function gzip$1(input, options) {
  options = options || {};
  options.gzip = true;
  return deflate$1(input, options);
}
var Deflate_1$1 = Deflate$1;
var deflate_2 = deflate$1;
var deflateRaw_1$1 = deflateRaw$1;
var gzip_1$1 = gzip$1;
var constants$1 = constants$2;
var deflate_1$1 = {
  Deflate: Deflate_1$1,
  deflate: deflate_2,
  deflateRaw: deflateRaw_1$1,
  gzip: gzip_1$1,
  constants: constants$1
};
var BAD$1 = 16209;
var TYPE$1 = 16191;
var inffast = function inflate_fast(strm, start) {
  let _in;
  let last;
  let _out;
  let beg;
  let end;
  let dmax;
  let wsize;
  let whave;
  let wnext;
  let s_window;
  let hold;
  let bits;
  let lcode;
  let dcode;
  let lmask;
  let dmask;
  let here;
  let op;
  let len;
  let dist;
  let from;
  let from_source;
  let input, output;
  const state = strm.state;
  _in = strm.next_in;
  input = strm.input;
  last = _in + (strm.avail_in - 5);
  _out = strm.next_out;
  output = strm.output;
  beg = _out - (start - strm.avail_out);
  end = _out + (strm.avail_out - 257);
  dmax = state.dmax;
  wsize = state.wsize;
  whave = state.whave;
  wnext = state.wnext;
  s_window = state.window;
  hold = state.hold;
  bits = state.bits;
  lcode = state.lencode;
  dcode = state.distcode;
  lmask = (1 << state.lenbits) - 1;
  dmask = (1 << state.distbits) - 1;
  top:
    do {
      if (bits < 15) {
        hold += input[_in++] << bits;
        bits += 8;
        hold += input[_in++] << bits;
        bits += 8;
      }
      here = lcode[hold & lmask];
      dolen:
        for (; ; ) {
          op = here >>> 24;
          hold >>>= op;
          bits -= op;
          op = here >>> 16 & 255;
          if (op === 0) {
            output[_out++] = here & 65535;
          } else if (op & 16) {
            len = here & 65535;
            op &= 15;
            if (op) {
              if (bits < op) {
                hold += input[_in++] << bits;
                bits += 8;
              }
              len += hold & (1 << op) - 1;
              hold >>>= op;
              bits -= op;
            }
            if (bits < 15) {
              hold += input[_in++] << bits;
              bits += 8;
              hold += input[_in++] << bits;
              bits += 8;
            }
            here = dcode[hold & dmask];
            dodist:
              for (; ; ) {
                op = here >>> 24;
                hold >>>= op;
                bits -= op;
                op = here >>> 16 & 255;
                if (op & 16) {
                  dist = here & 65535;
                  op &= 15;
                  if (bits < op) {
                    hold += input[_in++] << bits;
                    bits += 8;
                    if (bits < op) {
                      hold += input[_in++] << bits;
                      bits += 8;
                    }
                  }
                  dist += hold & (1 << op) - 1;
                  if (dist > dmax) {
                    strm.msg = "invalid distance too far back";
                    state.mode = BAD$1;
                    break top;
                  }
                  hold >>>= op;
                  bits -= op;
                  op = _out - beg;
                  if (dist > op) {
                    op = dist - op;
                    if (op > whave) {
                      if (state.sane) {
                        strm.msg = "invalid distance too far back";
                        state.mode = BAD$1;
                        break top;
                      }
                    }
                    from = 0;
                    from_source = s_window;
                    if (wnext === 0) {
                      from += wsize - op;
                      if (op < len) {
                        len -= op;
                        do {
                          output[_out++] = s_window[from++];
                        } while (--op);
                        from = _out - dist;
                        from_source = output;
                      }
                    } else if (wnext < op) {
                      from += wsize + wnext - op;
                      op -= wnext;
                      if (op < len) {
                        len -= op;
                        do {
                          output[_out++] = s_window[from++];
                        } while (--op);
                        from = 0;
                        if (wnext < len) {
                          op = wnext;
                          len -= op;
                          do {
                            output[_out++] = s_window[from++];
                          } while (--op);
                          from = _out - dist;
                          from_source = output;
                        }
                      }
                    } else {
                      from += wnext - op;
                      if (op < len) {
                        len -= op;
                        do {
                          output[_out++] = s_window[from++];
                        } while (--op);
                        from = _out - dist;
                        from_source = output;
                      }
                    }
                    while (len > 2) {
                      output[_out++] = from_source[from++];
                      output[_out++] = from_source[from++];
                      output[_out++] = from_source[from++];
                      len -= 3;
                    }
                    if (len) {
                      output[_out++] = from_source[from++];
                      if (len > 1) {
                        output[_out++] = from_source[from++];
                      }
                    }
                  } else {
                    from = _out - dist;
                    do {
                      output[_out++] = output[from++];
                      output[_out++] = output[from++];
                      output[_out++] = output[from++];
                      len -= 3;
                    } while (len > 2);
                    if (len) {
                      output[_out++] = output[from++];
                      if (len > 1) {
                        output[_out++] = output[from++];
                      }
                    }
                  }
                } else if ((op & 64) === 0) {
                  here = dcode[(here & 65535) + (hold & (1 << op) - 1)];
                  continue dodist;
                } else {
                  strm.msg = "invalid distance code";
                  state.mode = BAD$1;
                  break top;
                }
                break;
              }
          } else if ((op & 64) === 0) {
            here = lcode[(here & 65535) + (hold & (1 << op) - 1)];
            continue dolen;
          } else if (op & 32) {
            state.mode = TYPE$1;
            break top;
          } else {
            strm.msg = "invalid literal/length code";
            state.mode = BAD$1;
            break top;
          }
          break;
        }
    } while (_in < last && _out < end);
  len = bits >> 3;
  _in -= len;
  bits -= len << 3;
  hold &= (1 << bits) - 1;
  strm.next_in = _in;
  strm.next_out = _out;
  strm.avail_in = _in < last ? 5 + (last - _in) : 5 - (_in - last);
  strm.avail_out = _out < end ? 257 + (end - _out) : 257 - (_out - end);
  state.hold = hold;
  state.bits = bits;
  return;
};
var MAXBITS = 15;
var ENOUGH_LENS$1 = 852;
var ENOUGH_DISTS$1 = 592;
var CODES$1 = 0;
var LENS$1 = 1;
var DISTS$1 = 2;
var lbase = new Uint16Array([
  /* Length codes 257..285 base */
  3,
  4,
  5,
  6,
  7,
  8,
  9,
  10,
  11,
  13,
  15,
  17,
  19,
  23,
  27,
  31,
  35,
  43,
  51,
  59,
  67,
  83,
  99,
  115,
  131,
  163,
  195,
  227,
  258,
  0,
  0
]);
var lext = new Uint8Array([
  /* Length codes 257..285 extra */
  16,
  16,
  16,
  16,
  16,
  16,
  16,
  16,
  17,
  17,
  17,
  17,
  18,
  18,
  18,
  18,
  19,
  19,
  19,
  19,
  20,
  20,
  20,
  20,
  21,
  21,
  21,
  21,
  16,
  72,
  78
]);
var dbase = new Uint16Array([
  /* Distance codes 0..29 base */
  1,
  2,
  3,
  4,
  5,
  7,
  9,
  13,
  17,
  25,
  33,
  49,
  65,
  97,
  129,
  193,
  257,
  385,
  513,
  769,
  1025,
  1537,
  2049,
  3073,
  4097,
  6145,
  8193,
  12289,
  16385,
  24577,
  0,
  0
]);
var dext = new Uint8Array([
  /* Distance codes 0..29 extra */
  16,
  16,
  16,
  16,
  17,
  17,
  18,
  18,
  19,
  19,
  20,
  20,
  21,
  21,
  22,
  22,
  23,
  23,
  24,
  24,
  25,
  25,
  26,
  26,
  27,
  27,
  28,
  28,
  29,
  29,
  64,
  64
]);
var inflate_table = (type, lens, lens_index, codes, table, table_index, work, opts) => {
  const bits = opts.bits;
  let len = 0;
  let sym = 0;
  let min = 0, max = 0;
  let root = 0;
  let curr = 0;
  let drop = 0;
  let left = 0;
  let used = 0;
  let huff = 0;
  let incr;
  let fill;
  let low;
  let mask;
  let next;
  let base = null;
  let match;
  const count = new Uint16Array(MAXBITS + 1);
  const offs = new Uint16Array(MAXBITS + 1);
  let extra = null;
  let here_bits, here_op, here_val;
  for (len = 0; len <= MAXBITS; len++) {
    count[len] = 0;
  }
  for (sym = 0; sym < codes; sym++) {
    count[lens[lens_index + sym]]++;
  }
  root = bits;
  for (max = MAXBITS; max >= 1; max--) {
    if (count[max] !== 0) {
      break;
    }
  }
  if (root > max) {
    root = max;
  }
  if (max === 0) {
    table[table_index++] = 1 << 24 | 64 << 16 | 0;
    table[table_index++] = 1 << 24 | 64 << 16 | 0;
    opts.bits = 1;
    return 0;
  }
  for (min = 1; min < max; min++) {
    if (count[min] !== 0) {
      break;
    }
  }
  if (root < min) {
    root = min;
  }
  left = 1;
  for (len = 1; len <= MAXBITS; len++) {
    left <<= 1;
    left -= count[len];
    if (left < 0) {
      return -1;
    }
  }
  if (left > 0 && (type === CODES$1 || max !== 1)) {
    return -1;
  }
  offs[1] = 0;
  for (len = 1; len < MAXBITS; len++) {
    offs[len + 1] = offs[len] + count[len];
  }
  for (sym = 0; sym < codes; sym++) {
    if (lens[lens_index + sym] !== 0) {
      work[offs[lens[lens_index + sym]]++] = sym;
    }
  }
  if (type === CODES$1) {
    base = extra = work;
    match = 20;
  } else if (type === LENS$1) {
    base = lbase;
    extra = lext;
    match = 257;
  } else {
    base = dbase;
    extra = dext;
    match = 0;
  }
  huff = 0;
  sym = 0;
  len = min;
  next = table_index;
  curr = root;
  drop = 0;
  low = -1;
  used = 1 << root;
  mask = used - 1;
  if (type === LENS$1 && used > ENOUGH_LENS$1 || type === DISTS$1 && used > ENOUGH_DISTS$1) {
    return 1;
  }
  for (; ; ) {
    here_bits = len - drop;
    if (work[sym] + 1 < match) {
      here_op = 0;
      here_val = work[sym];
    } else if (work[sym] >= match) {
      here_op = extra[work[sym] - match];
      here_val = base[work[sym] - match];
    } else {
      here_op = 32 + 64;
      here_val = 0;
    }
    incr = 1 << len - drop;
    fill = 1 << curr;
    min = fill;
    do {
      fill -= incr;
      table[next + (huff >> drop) + fill] = here_bits << 24 | here_op << 16 | here_val | 0;
    } while (fill !== 0);
    incr = 1 << len - 1;
    while (huff & incr) {
      incr >>= 1;
    }
    if (incr !== 0) {
      huff &= incr - 1;
      huff += incr;
    } else {
      huff = 0;
    }
    sym++;
    if (--count[len] === 0) {
      if (len === max) {
        break;
      }
      len = lens[lens_index + work[sym]];
    }
    if (len > root && (huff & mask) !== low) {
      if (drop === 0) {
        drop = root;
      }
      next += min;
      curr = len - drop;
      left = 1 << curr;
      while (curr + drop < max) {
        left -= count[curr + drop];
        if (left <= 0) {
          break;
        }
        curr++;
        left <<= 1;
      }
      used += 1 << curr;
      if (type === LENS$1 && used > ENOUGH_LENS$1 || type === DISTS$1 && used > ENOUGH_DISTS$1) {
        return 1;
      }
      low = huff & mask;
      table[low] = root << 24 | curr << 16 | next - table_index | 0;
    }
  }
  if (huff !== 0) {
    table[next + huff] = len - drop << 24 | 64 << 16 | 0;
  }
  opts.bits = root;
  return 0;
};
var inftrees = inflate_table;
var CODES = 0;
var LENS = 1;
var DISTS = 2;
var {
  Z_FINISH: Z_FINISH$1,
  Z_BLOCK,
  Z_TREES,
  Z_OK: Z_OK$1,
  Z_STREAM_END: Z_STREAM_END$1,
  Z_NEED_DICT: Z_NEED_DICT$1,
  Z_STREAM_ERROR: Z_STREAM_ERROR$1,
  Z_DATA_ERROR: Z_DATA_ERROR$1,
  Z_MEM_ERROR: Z_MEM_ERROR$1,
  Z_BUF_ERROR,
  Z_DEFLATED
} = constants$2;
var HEAD = 16180;
var FLAGS = 16181;
var TIME = 16182;
var OS = 16183;
var EXLEN = 16184;
var EXTRA = 16185;
var NAME = 16186;
var COMMENT = 16187;
var HCRC = 16188;
var DICTID = 16189;
var DICT = 16190;
var TYPE = 16191;
var TYPEDO = 16192;
var STORED = 16193;
var COPY_ = 16194;
var COPY = 16195;
var TABLE = 16196;
var LENLENS = 16197;
var CODELENS = 16198;
var LEN_ = 16199;
var LEN = 16200;
var LENEXT = 16201;
var DIST = 16202;
var DISTEXT = 16203;
var MATCH = 16204;
var LIT = 16205;
var CHECK = 16206;
var LENGTH = 16207;
var DONE = 16208;
var BAD = 16209;
var MEM = 16210;
var SYNC = 16211;
var ENOUGH_LENS = 852;
var ENOUGH_DISTS = 592;
var MAX_WBITS = 15;
var DEF_WBITS = MAX_WBITS;
var zswap32 = (q) => {
  return (q >>> 24 & 255) + (q >>> 8 & 65280) + ((q & 65280) << 8) + ((q & 255) << 24);
};
function InflateState() {
  this.strm = null;
  this.mode = 0;
  this.last = false;
  this.wrap = 0;
  this.havedict = false;
  this.flags = 0;
  this.dmax = 0;
  this.check = 0;
  this.total = 0;
  this.head = null;
  this.wbits = 0;
  this.wsize = 0;
  this.whave = 0;
  this.wnext = 0;
  this.window = null;
  this.hold = 0;
  this.bits = 0;
  this.length = 0;
  this.offset = 0;
  this.extra = 0;
  this.lencode = null;
  this.distcode = null;
  this.lenbits = 0;
  this.distbits = 0;
  this.ncode = 0;
  this.nlen = 0;
  this.ndist = 0;
  this.have = 0;
  this.next = null;
  this.lens = new Uint16Array(320);
  this.work = new Uint16Array(288);
  this.lendyn = null;
  this.distdyn = null;
  this.sane = 0;
  this.back = 0;
  this.was = 0;
}
var inflateStateCheck = (strm) => {
  if (!strm) {
    return 1;
  }
  const state = strm.state;
  if (!state || state.strm !== strm || state.mode < HEAD || state.mode > SYNC) {
    return 1;
  }
  return 0;
};
var inflateResetKeep = (strm) => {
  if (inflateStateCheck(strm)) {
    return Z_STREAM_ERROR$1;
  }
  const state = strm.state;
  strm.total_in = strm.total_out = state.total = 0;
  strm.msg = "";
  if (state.wrap) {
    strm.adler = state.wrap & 1;
  }
  state.mode = HEAD;
  state.last = 0;
  state.havedict = 0;
  state.flags = -1;
  state.dmax = 32768;
  state.head = null;
  state.hold = 0;
  state.bits = 0;
  state.lencode = state.lendyn = new Int32Array(ENOUGH_LENS);
  state.distcode = state.distdyn = new Int32Array(ENOUGH_DISTS);
  state.sane = 1;
  state.back = -1;
  return Z_OK$1;
};
var inflateReset = (strm) => {
  if (inflateStateCheck(strm)) {
    return Z_STREAM_ERROR$1;
  }
  const state = strm.state;
  state.wsize = 0;
  state.whave = 0;
  state.wnext = 0;
  return inflateResetKeep(strm);
};
var inflateReset2 = (strm, windowBits) => {
  let wrap;
  if (inflateStateCheck(strm)) {
    return Z_STREAM_ERROR$1;
  }
  const state = strm.state;
  if (windowBits < 0) {
    wrap = 0;
    windowBits = -windowBits;
  } else {
    wrap = (windowBits >> 4) + 5;
    if (windowBits < 48) {
      windowBits &= 15;
    }
  }
  if (windowBits && (windowBits < 8 || windowBits > 15)) {
    return Z_STREAM_ERROR$1;
  }
  if (state.window !== null && state.wbits !== windowBits) {
    state.window = null;
  }
  state.wrap = wrap;
  state.wbits = windowBits;
  return inflateReset(strm);
};
var inflateInit2 = (strm, windowBits) => {
  if (!strm) {
    return Z_STREAM_ERROR$1;
  }
  const state = new InflateState();
  strm.state = state;
  state.strm = strm;
  state.window = null;
  state.mode = HEAD;
  const ret = inflateReset2(strm, windowBits);
  if (ret !== Z_OK$1) {
    strm.state = null;
  }
  return ret;
};
var inflateInit = (strm) => {
  return inflateInit2(strm, DEF_WBITS);
};
var virgin = true;
var lenfix;
var distfix;
var fixedtables = (state) => {
  if (virgin) {
    lenfix = new Int32Array(512);
    distfix = new Int32Array(32);
    let sym = 0;
    while (sym < 144) {
      state.lens[sym++] = 8;
    }
    while (sym < 256) {
      state.lens[sym++] = 9;
    }
    while (sym < 280) {
      state.lens[sym++] = 7;
    }
    while (sym < 288) {
      state.lens[sym++] = 8;
    }
    inftrees(LENS, state.lens, 0, 288, lenfix, 0, state.work, { bits: 9 });
    sym = 0;
    while (sym < 32) {
      state.lens[sym++] = 5;
    }
    inftrees(DISTS, state.lens, 0, 32, distfix, 0, state.work, { bits: 5 });
    virgin = false;
  }
  state.lencode = lenfix;
  state.lenbits = 9;
  state.distcode = distfix;
  state.distbits = 5;
};
var updatewindow = (strm, src, end, copy) => {
  let dist;
  const state = strm.state;
  if (state.window === null) {
    state.wsize = 1 << state.wbits;
    state.wnext = 0;
    state.whave = 0;
    state.window = new Uint8Array(state.wsize);
  }
  if (copy >= state.wsize) {
    state.window.set(src.subarray(end - state.wsize, end), 0);
    state.wnext = 0;
    state.whave = state.wsize;
  } else {
    dist = state.wsize - state.wnext;
    if (dist > copy) {
      dist = copy;
    }
    state.window.set(src.subarray(end - copy, end - copy + dist), state.wnext);
    copy -= dist;
    if (copy) {
      state.window.set(src.subarray(end - copy, end), 0);
      state.wnext = copy;
      state.whave = state.wsize;
    } else {
      state.wnext += dist;
      if (state.wnext === state.wsize) {
        state.wnext = 0;
      }
      if (state.whave < state.wsize) {
        state.whave += dist;
      }
    }
  }
  return 0;
};
var inflate$2 = (strm, flush) => {
  let state;
  let input, output;
  let next;
  let put;
  let have, left;
  let hold;
  let bits;
  let _in, _out;
  let copy;
  let from;
  let from_source;
  let here = 0;
  let here_bits, here_op, here_val;
  let last_bits, last_op, last_val;
  let len;
  let ret;
  const hbuf = new Uint8Array(4);
  let opts;
  let n;
  const order = (
    /* permutation of code lengths */
    new Uint8Array([16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15])
  );
  if (inflateStateCheck(strm) || !strm.output || !strm.input && strm.avail_in !== 0) {
    return Z_STREAM_ERROR$1;
  }
  state = strm.state;
  if (state.mode === TYPE) {
    state.mode = TYPEDO;
  }
  put = strm.next_out;
  output = strm.output;
  left = strm.avail_out;
  next = strm.next_in;
  input = strm.input;
  have = strm.avail_in;
  hold = state.hold;
  bits = state.bits;
  _in = have;
  _out = left;
  ret = Z_OK$1;
  inf_leave:
    for (; ; ) {
      switch (state.mode) {
        case HEAD:
          if (state.wrap === 0) {
            state.mode = TYPEDO;
            break;
          }
          while (bits < 16) {
            if (have === 0) {
              break inf_leave;
            }
            have--;
            hold += input[next++] << bits;
            bits += 8;
          }
          if (state.wrap & 2 && hold === 35615) {
            if (state.wbits === 0) {
              state.wbits = 15;
            }
            state.check = 0;
            hbuf[0] = hold & 255;
            hbuf[1] = hold >>> 8 & 255;
            state.check = crc32_1(state.check, hbuf, 2, 0);
            hold = 0;
            bits = 0;
            state.mode = FLAGS;
            break;
          }
          if (state.head) {
            state.head.done = false;
          }
          if (!(state.wrap & 1) || /* check if zlib header allowed */
          (((hold & 255) << 8) + (hold >> 8)) % 31) {
            strm.msg = "incorrect header check";
            state.mode = BAD;
            break;
          }
          if ((hold & 15) !== Z_DEFLATED) {
            strm.msg = "unknown compression method";
            state.mode = BAD;
            break;
          }
          hold >>>= 4;
          bits -= 4;
          len = (hold & 15) + 8;
          if (state.wbits === 0) {
            state.wbits = len;
          }
          if (len > 15 || len > state.wbits) {
            strm.msg = "invalid window size";
            state.mode = BAD;
            break;
          }
          state.dmax = 1 << state.wbits;
          state.flags = 0;
          strm.adler = state.check = 1;
          state.mode = hold & 512 ? DICTID : TYPE;
          hold = 0;
          bits = 0;
          break;
        case FLAGS:
          while (bits < 16) {
            if (have === 0) {
              break inf_leave;
            }
            have--;
            hold += input[next++] << bits;
            bits += 8;
          }
          state.flags = hold;
          if ((state.flags & 255) !== Z_DEFLATED) {
            strm.msg = "unknown compression method";
            state.mode = BAD;
            break;
          }
          if (state.flags & 57344) {
            strm.msg = "unknown header flags set";
            state.mode = BAD;
            break;
          }
          if (state.head) {
            state.head.text = hold >> 8 & 1;
          }
          if (state.flags & 512 && state.wrap & 4) {
            hbuf[0] = hold & 255;
            hbuf[1] = hold >>> 8 & 255;
            state.check = crc32_1(state.check, hbuf, 2, 0);
          }
          hold = 0;
          bits = 0;
          state.mode = TIME;
        /* falls through */
        case TIME:
          while (bits < 32) {
            if (have === 0) {
              break inf_leave;
            }
            have--;
            hold += input[next++] << bits;
            bits += 8;
          }
          if (state.head) {
            state.head.time = hold;
          }
          if (state.flags & 512 && state.wrap & 4) {
            hbuf[0] = hold & 255;
            hbuf[1] = hold >>> 8 & 255;
            hbuf[2] = hold >>> 16 & 255;
            hbuf[3] = hold >>> 24 & 255;
            state.check = crc32_1(state.check, hbuf, 4, 0);
          }
          hold = 0;
          bits = 0;
          state.mode = OS;
        /* falls through */
        case OS:
          while (bits < 16) {
            if (have === 0) {
              break inf_leave;
            }
            have--;
            hold += input[next++] << bits;
            bits += 8;
          }
          if (state.head) {
            state.head.xflags = hold & 255;
            state.head.os = hold >> 8;
          }
          if (state.flags & 512 && state.wrap & 4) {
            hbuf[0] = hold & 255;
            hbuf[1] = hold >>> 8 & 255;
            state.check = crc32_1(state.check, hbuf, 2, 0);
          }
          hold = 0;
          bits = 0;
          state.mode = EXLEN;
        /* falls through */
        case EXLEN:
          if (state.flags & 1024) {
            while (bits < 16) {
              if (have === 0) {
                break inf_leave;
              }
              have--;
              hold += input[next++] << bits;
              bits += 8;
            }
            state.length = hold;
            if (state.head) {
              state.head.extra_len = hold;
            }
            if (state.flags & 512 && state.wrap & 4) {
              hbuf[0] = hold & 255;
              hbuf[1] = hold >>> 8 & 255;
              state.check = crc32_1(state.check, hbuf, 2, 0);
            }
            hold = 0;
            bits = 0;
          } else if (state.head) {
            state.head.extra = null;
          }
          state.mode = EXTRA;
        /* falls through */
        case EXTRA:
          if (state.flags & 1024) {
            copy = state.length;
            if (copy > have) {
              copy = have;
            }
            if (copy) {
              if (state.head) {
                len = state.head.extra_len - state.length;
                if (!state.head.extra) {
                  state.head.extra = new Uint8Array(state.head.extra_len);
                }
                state.head.extra.set(
                  input.subarray(
                    next,
                    // extra field is limited to 65536 bytes
                    // - no need for additional size check
                    next + copy
                  ),
                  /*len + copy > state.head.extra_max - len ? state.head.extra_max : copy,*/
                  len
                );
              }
              if (state.flags & 512 && state.wrap & 4) {
                state.check = crc32_1(state.check, input, copy, next);
              }
              have -= copy;
              next += copy;
              state.length -= copy;
            }
            if (state.length) {
              break inf_leave;
            }
          }
          state.length = 0;
          state.mode = NAME;
        /* falls through */
        case NAME:
          if (state.flags & 2048) {
            if (have === 0) {
              break inf_leave;
            }
            copy = 0;
            do {
              len = input[next + copy++];
              if (state.head && len && state.length < 65536) {
                state.head.name += String.fromCharCode(len);
              }
            } while (len && copy < have);
            if (state.flags & 512 && state.wrap & 4) {
              state.check = crc32_1(state.check, input, copy, next);
            }
            have -= copy;
            next += copy;
            if (len) {
              break inf_leave;
            }
          } else if (state.head) {
            state.head.name = null;
          }
          state.length = 0;
          state.mode = COMMENT;
        /* falls through */
        case COMMENT:
          if (state.flags & 4096) {
            if (have === 0) {
              break inf_leave;
            }
            copy = 0;
            do {
              len = input[next + copy++];
              if (state.head && len && state.length < 65536) {
                state.head.comment += String.fromCharCode(len);
              }
            } while (len && copy < have);
            if (state.flags & 512 && state.wrap & 4) {
              state.check = crc32_1(state.check, input, copy, next);
            }
            have -= copy;
            next += copy;
            if (len) {
              break inf_leave;
            }
          } else if (state.head) {
            state.head.comment = null;
          }
          state.mode = HCRC;
        /* falls through */
        case HCRC:
          if (state.flags & 512) {
            while (bits < 16) {
              if (have === 0) {
                break inf_leave;
              }
              have--;
              hold += input[next++] << bits;
              bits += 8;
            }
            if (state.wrap & 4 && hold !== (state.check & 65535)) {
              strm.msg = "header crc mismatch";
              state.mode = BAD;
              break;
            }
            hold = 0;
            bits = 0;
          }
          if (state.head) {
            state.head.hcrc = state.flags >> 9 & 1;
            state.head.done = true;
          }
          strm.adler = state.check = 0;
          state.mode = TYPE;
          break;
        case DICTID:
          while (bits < 32) {
            if (have === 0) {
              break inf_leave;
            }
            have--;
            hold += input[next++] << bits;
            bits += 8;
          }
          strm.adler = state.check = zswap32(hold);
          hold = 0;
          bits = 0;
          state.mode = DICT;
        /* falls through */
        case DICT:
          if (state.havedict === 0) {
            strm.next_out = put;
            strm.avail_out = left;
            strm.next_in = next;
            strm.avail_in = have;
            state.hold = hold;
            state.bits = bits;
            return Z_NEED_DICT$1;
          }
          strm.adler = state.check = 1;
          state.mode = TYPE;
        /* falls through */
        case TYPE:
          if (flush === Z_BLOCK || flush === Z_TREES) {
            break inf_leave;
          }
        /* falls through */
        case TYPEDO:
          if (state.last) {
            hold >>>= bits & 7;
            bits -= bits & 7;
            state.mode = CHECK;
            break;
          }
          while (bits < 3) {
            if (have === 0) {
              break inf_leave;
            }
            have--;
            hold += input[next++] << bits;
            bits += 8;
          }
          state.last = hold & 1;
          hold >>>= 1;
          bits -= 1;
          switch (hold & 3) {
            case 0:
              state.mode = STORED;
              break;
            case 1:
              fixedtables(state);
              state.mode = LEN_;
              if (flush === Z_TREES) {
                hold >>>= 2;
                bits -= 2;
                break inf_leave;
              }
              break;
            case 2:
              state.mode = TABLE;
              break;
            case 3:
              strm.msg = "invalid block type";
              state.mode = BAD;
          }
          hold >>>= 2;
          bits -= 2;
          break;
        case STORED:
          hold >>>= bits & 7;
          bits -= bits & 7;
          while (bits < 32) {
            if (have === 0) {
              break inf_leave;
            }
            have--;
            hold += input[next++] << bits;
            bits += 8;
          }
          if ((hold & 65535) !== (hold >>> 16 ^ 65535)) {
            strm.msg = "invalid stored block lengths";
            state.mode = BAD;
            break;
          }
          state.length = hold & 65535;
          hold = 0;
          bits = 0;
          state.mode = COPY_;
          if (flush === Z_TREES) {
            break inf_leave;
          }
        /* falls through */
        case COPY_:
          state.mode = COPY;
        /* falls through */
        case COPY:
          copy = state.length;
          if (copy) {
            if (copy > have) {
              copy = have;
            }
            if (copy > left) {
              copy = left;
            }
            if (copy === 0) {
              break inf_leave;
            }
            output.set(input.subarray(next, next + copy), put);
            have -= copy;
            next += copy;
            left -= copy;
            put += copy;
            state.length -= copy;
            break;
          }
          state.mode = TYPE;
          break;
        case TABLE:
          while (bits < 14) {
            if (have === 0) {
              break inf_leave;
            }
            have--;
            hold += input[next++] << bits;
            bits += 8;
          }
          state.nlen = (hold & 31) + 257;
          hold >>>= 5;
          bits -= 5;
          state.ndist = (hold & 31) + 1;
          hold >>>= 5;
          bits -= 5;
          state.ncode = (hold & 15) + 4;
          hold >>>= 4;
          bits -= 4;
          if (state.nlen > 286 || state.ndist > 30) {
            strm.msg = "too many length or distance symbols";
            state.mode = BAD;
            break;
          }
          state.have = 0;
          state.mode = LENLENS;
        /* falls through */
        case LENLENS:
          while (state.have < state.ncode) {
            while (bits < 3) {
              if (have === 0) {
                break inf_leave;
              }
              have--;
              hold += input[next++] << bits;
              bits += 8;
            }
            state.lens[order[state.have++]] = hold & 7;
            hold >>>= 3;
            bits -= 3;
          }
          while (state.have < 19) {
            state.lens[order[state.have++]] = 0;
          }
          state.lencode = state.lendyn;
          state.lenbits = 7;
          opts = { bits: state.lenbits };
          ret = inftrees(CODES, state.lens, 0, 19, state.lencode, 0, state.work, opts);
          state.lenbits = opts.bits;
          if (ret) {
            strm.msg = "invalid code lengths set";
            state.mode = BAD;
            break;
          }
          state.have = 0;
          state.mode = CODELENS;
        /* falls through */
        case CODELENS:
          while (state.have < state.nlen + state.ndist) {
            for (; ; ) {
              here = state.lencode[hold & (1 << state.lenbits) - 1];
              here_bits = here >>> 24;
              here_op = here >>> 16 & 255;
              here_val = here & 65535;
              if (here_bits <= bits) {
                break;
              }
              if (have === 0) {
                break inf_leave;
              }
              have--;
              hold += input[next++] << bits;
              bits += 8;
            }
            if (here_val < 16) {
              hold >>>= here_bits;
              bits -= here_bits;
              state.lens[state.have++] = here_val;
            } else {
              if (here_val === 16) {
                n = here_bits + 2;
                while (bits < n) {
                  if (have === 0) {
                    break inf_leave;
                  }
                  have--;
                  hold += input[next++] << bits;
                  bits += 8;
                }
                hold >>>= here_bits;
                bits -= here_bits;
                if (state.have === 0) {
                  strm.msg = "invalid bit length repeat";
                  state.mode = BAD;
                  break;
                }
                len = state.lens[state.have - 1];
                copy = 3 + (hold & 3);
                hold >>>= 2;
                bits -= 2;
              } else if (here_val === 17) {
                n = here_bits + 3;
                while (bits < n) {
                  if (have === 0) {
                    break inf_leave;
                  }
                  have--;
                  hold += input[next++] << bits;
                  bits += 8;
                }
                hold >>>= here_bits;
                bits -= here_bits;
                len = 0;
                copy = 3 + (hold & 7);
                hold >>>= 3;
                bits -= 3;
              } else {
                n = here_bits + 7;
                while (bits < n) {
                  if (have === 0) {
                    break inf_leave;
                  }
                  have--;
                  hold += input[next++] << bits;
                  bits += 8;
                }
                hold >>>= here_bits;
                bits -= here_bits;
                len = 0;
                copy = 11 + (hold & 127);
                hold >>>= 7;
                bits -= 7;
              }
              if (state.have + copy > state.nlen + state.ndist) {
                strm.msg = "invalid bit length repeat";
                state.mode = BAD;
                break;
              }
              while (copy--) {
                state.lens[state.have++] = len;
              }
            }
          }
          if (state.mode === BAD) {
            break;
          }
          if (state.lens[256] === 0) {
            strm.msg = "invalid code -- missing end-of-block";
            state.mode = BAD;
            break;
          }
          state.lenbits = 9;
          opts = { bits: state.lenbits };
          ret = inftrees(LENS, state.lens, 0, state.nlen, state.lencode, 0, state.work, opts);
          state.lenbits = opts.bits;
          if (ret) {
            strm.msg = "invalid literal/lengths set";
            state.mode = BAD;
            break;
          }
          state.distbits = 6;
          state.distcode = state.distdyn;
          opts = { bits: state.distbits };
          ret = inftrees(DISTS, state.lens, state.nlen, state.ndist, state.distcode, 0, state.work, opts);
          state.distbits = opts.bits;
          if (ret) {
            strm.msg = "invalid distances set";
            state.mode = BAD;
            break;
          }
          state.mode = LEN_;
          if (flush === Z_TREES) {
            break inf_leave;
          }
        /* falls through */
        case LEN_:
          state.mode = LEN;
        /* falls through */
        case LEN:
          if (have >= 6 && left >= 258) {
            strm.next_out = put;
            strm.avail_out = left;
            strm.next_in = next;
            strm.avail_in = have;
            state.hold = hold;
            state.bits = bits;
            inffast(strm, _out);
            put = strm.next_out;
            output = strm.output;
            left = strm.avail_out;
            next = strm.next_in;
            input = strm.input;
            have = strm.avail_in;
            hold = state.hold;
            bits = state.bits;
            if (state.mode === TYPE) {
              state.back = -1;
            }
            break;
          }
          state.back = 0;
          for (; ; ) {
            here = state.lencode[hold & (1 << state.lenbits) - 1];
            here_bits = here >>> 24;
            here_op = here >>> 16 & 255;
            here_val = here & 65535;
            if (here_bits <= bits) {
              break;
            }
            if (have === 0) {
              break inf_leave;
            }
            have--;
            hold += input[next++] << bits;
            bits += 8;
          }
          if (here_op && (here_op & 240) === 0) {
            last_bits = here_bits;
            last_op = here_op;
            last_val = here_val;
            for (; ; ) {
              here = state.lencode[last_val + ((hold & (1 << last_bits + last_op) - 1) >> last_bits)];
              here_bits = here >>> 24;
              here_op = here >>> 16 & 255;
              here_val = here & 65535;
              if (last_bits + here_bits <= bits) {
                break;
              }
              if (have === 0) {
                break inf_leave;
              }
              have--;
              hold += input[next++] << bits;
              bits += 8;
            }
            hold >>>= last_bits;
            bits -= last_bits;
            state.back += last_bits;
          }
          hold >>>= here_bits;
          bits -= here_bits;
          state.back += here_bits;
          state.length = here_val;
          if (here_op === 0) {
            state.mode = LIT;
            break;
          }
          if (here_op & 32) {
            state.back = -1;
            state.mode = TYPE;
            break;
          }
          if (here_op & 64) {
            strm.msg = "invalid literal/length code";
            state.mode = BAD;
            break;
          }
          state.extra = here_op & 15;
          state.mode = LENEXT;
        /* falls through */
        case LENEXT:
          if (state.extra) {
            n = state.extra;
            while (bits < n) {
              if (have === 0) {
                break inf_leave;
              }
              have--;
              hold += input[next++] << bits;
              bits += 8;
            }
            state.length += hold & (1 << state.extra) - 1;
            hold >>>= state.extra;
            bits -= state.extra;
            state.back += state.extra;
          }
          state.was = state.length;
          state.mode = DIST;
        /* falls through */
        case DIST:
          for (; ; ) {
            here = state.distcode[hold & (1 << state.distbits) - 1];
            here_bits = here >>> 24;
            here_op = here >>> 16 & 255;
            here_val = here & 65535;
            if (here_bits <= bits) {
              break;
            }
            if (have === 0) {
              break inf_leave;
            }
            have--;
            hold += input[next++] << bits;
            bits += 8;
          }
          if ((here_op & 240) === 0) {
            last_bits = here_bits;
            last_op = here_op;
            last_val = here_val;
            for (; ; ) {
              here = state.distcode[last_val + ((hold & (1 << last_bits + last_op) - 1) >> last_bits)];
              here_bits = here >>> 24;
              here_op = here >>> 16 & 255;
              here_val = here & 65535;
              if (last_bits + here_bits <= bits) {
                break;
              }
              if (have === 0) {
                break inf_leave;
              }
              have--;
              hold += input[next++] << bits;
              bits += 8;
            }
            hold >>>= last_bits;
            bits -= last_bits;
            state.back += last_bits;
          }
          hold >>>= here_bits;
          bits -= here_bits;
          state.back += here_bits;
          if (here_op & 64) {
            strm.msg = "invalid distance code";
            state.mode = BAD;
            break;
          }
          state.offset = here_val;
          state.extra = here_op & 15;
          state.mode = DISTEXT;
        /* falls through */
        case DISTEXT:
          if (state.extra) {
            n = state.extra;
            while (bits < n) {
              if (have === 0) {
                break inf_leave;
              }
              have--;
              hold += input[next++] << bits;
              bits += 8;
            }
            state.offset += hold & (1 << state.extra) - 1;
            hold >>>= state.extra;
            bits -= state.extra;
            state.back += state.extra;
          }
          if (state.offset > state.dmax) {
            strm.msg = "invalid distance too far back";
            state.mode = BAD;
            break;
          }
          state.mode = MATCH;
        /* falls through */
        case MATCH:
          if (left === 0) {
            break inf_leave;
          }
          copy = _out - left;
          if (state.offset > copy) {
            copy = state.offset - copy;
            if (copy > state.whave) {
              if (state.sane) {
                strm.msg = "invalid distance too far back";
                state.mode = BAD;
                break;
              }
            }
            if (copy > state.wnext) {
              copy -= state.wnext;
              from = state.wsize - copy;
            } else {
              from = state.wnext - copy;
            }
            if (copy > state.length) {
              copy = state.length;
            }
            from_source = state.window;
          } else {
            from_source = output;
            from = put - state.offset;
            copy = state.length;
          }
          if (copy > left) {
            copy = left;
          }
          left -= copy;
          state.length -= copy;
          do {
            output[put++] = from_source[from++];
          } while (--copy);
          if (state.length === 0) {
            state.mode = LEN;
          }
          break;
        case LIT:
          if (left === 0) {
            break inf_leave;
          }
          output[put++] = state.length;
          left--;
          state.mode = LEN;
          break;
        case CHECK:
          if (state.wrap) {
            while (bits < 32) {
              if (have === 0) {
                break inf_leave;
              }
              have--;
              hold |= input[next++] << bits;
              bits += 8;
            }
            _out -= left;
            strm.total_out += _out;
            state.total += _out;
            if (state.wrap & 4 && _out) {
              strm.adler = state.check = /*UPDATE_CHECK(state.check, put - _out, _out);*/
              state.flags ? crc32_1(state.check, output, _out, put - _out) : adler32_1(state.check, output, _out, put - _out);
            }
            _out = left;
            if (state.wrap & 4 && (state.flags ? hold : zswap32(hold)) !== state.check) {
              strm.msg = "incorrect data check";
              state.mode = BAD;
              break;
            }
            hold = 0;
            bits = 0;
          }
          state.mode = LENGTH;
        /* falls through */
        case LENGTH:
          if (state.wrap && state.flags) {
            while (bits < 32) {
              if (have === 0) {
                break inf_leave;
              }
              have--;
              hold += input[next++] << bits;
              bits += 8;
            }
            if (state.wrap & 4 && hold !== (state.total & 4294967295)) {
              strm.msg = "incorrect length check";
              state.mode = BAD;
              break;
            }
            hold = 0;
            bits = 0;
          }
          state.mode = DONE;
        /* falls through */
        case DONE:
          ret = Z_STREAM_END$1;
          break inf_leave;
        case BAD:
          ret = Z_DATA_ERROR$1;
          break inf_leave;
        case MEM:
          return Z_MEM_ERROR$1;
        case SYNC:
        /* falls through */
        default:
          return Z_STREAM_ERROR$1;
      }
    }
  strm.next_out = put;
  strm.avail_out = left;
  strm.next_in = next;
  strm.avail_in = have;
  state.hold = hold;
  state.bits = bits;
  if (state.wsize || _out !== strm.avail_out && state.mode < BAD && (state.mode < CHECK || flush !== Z_FINISH$1)) {
    if (updatewindow(strm, strm.output, strm.next_out, _out - strm.avail_out)) ;
  }
  _in -= strm.avail_in;
  _out -= strm.avail_out;
  strm.total_in += _in;
  strm.total_out += _out;
  state.total += _out;
  if (state.wrap & 4 && _out) {
    strm.adler = state.check = /*UPDATE_CHECK(state.check, strm.next_out - _out, _out);*/
    state.flags ? crc32_1(state.check, output, _out, strm.next_out - _out) : adler32_1(state.check, output, _out, strm.next_out - _out);
  }
  strm.data_type = state.bits + (state.last ? 64 : 0) + (state.mode === TYPE ? 128 : 0) + (state.mode === LEN_ || state.mode === COPY_ ? 256 : 0);
  if ((_in === 0 && _out === 0 || flush === Z_FINISH$1) && ret === Z_OK$1) {
    ret = Z_BUF_ERROR;
  }
  return ret;
};
var inflateEnd = (strm) => {
  if (inflateStateCheck(strm)) {
    return Z_STREAM_ERROR$1;
  }
  let state = strm.state;
  if (state.window) {
    state.window = null;
  }
  strm.state = null;
  return Z_OK$1;
};
var inflateGetHeader = (strm, head) => {
  if (inflateStateCheck(strm)) {
    return Z_STREAM_ERROR$1;
  }
  const state = strm.state;
  if ((state.wrap & 2) === 0) {
    return Z_STREAM_ERROR$1;
  }
  state.head = head;
  head.done = false;
  return Z_OK$1;
};
var inflateSetDictionary = (strm, dictionary) => {
  const dictLength = dictionary.length;
  let state;
  let dictid;
  let ret;
  if (inflateStateCheck(strm)) {
    return Z_STREAM_ERROR$1;
  }
  state = strm.state;
  if (state.wrap !== 0 && state.mode !== DICT) {
    return Z_STREAM_ERROR$1;
  }
  if (state.mode === DICT) {
    dictid = 1;
    dictid = adler32_1(dictid, dictionary, dictLength, 0);
    if (dictid !== state.check) {
      return Z_DATA_ERROR$1;
    }
  }
  ret = updatewindow(strm, dictionary, dictLength, dictLength);
  if (ret) {
    state.mode = MEM;
    return Z_MEM_ERROR$1;
  }
  state.havedict = 1;
  return Z_OK$1;
};
var inflateReset_1 = inflateReset;
var inflateReset2_1 = inflateReset2;
var inflateResetKeep_1 = inflateResetKeep;
var inflateInit_1 = inflateInit;
var inflateInit2_1 = inflateInit2;
var inflate_2$1 = inflate$2;
var inflateEnd_1 = inflateEnd;
var inflateGetHeader_1 = inflateGetHeader;
var inflateSetDictionary_1 = inflateSetDictionary;
var inflateInfo = "pako inflate (from Nodeca project)";
var inflate_1$2 = {
  inflateReset: inflateReset_1,
  inflateReset2: inflateReset2_1,
  inflateResetKeep: inflateResetKeep_1,
  inflateInit: inflateInit_1,
  inflateInit2: inflateInit2_1,
  inflate: inflate_2$1,
  inflateEnd: inflateEnd_1,
  inflateGetHeader: inflateGetHeader_1,
  inflateSetDictionary: inflateSetDictionary_1,
  inflateInfo
};
function GZheader() {
  this.text = 0;
  this.time = 0;
  this.xflags = 0;
  this.os = 0;
  this.extra = null;
  this.extra_len = 0;
  this.name = "";
  this.comment = "";
  this.hcrc = 0;
  this.done = false;
}
var gzheader = GZheader;
var toString = Object.prototype.toString;
var {
  Z_NO_FLUSH,
  Z_FINISH,
  Z_OK,
  Z_STREAM_END,
  Z_NEED_DICT,
  Z_STREAM_ERROR,
  Z_DATA_ERROR,
  Z_MEM_ERROR
} = constants$2;
function Inflate$1(options) {
  this.options = common.assign({
    chunkSize: 1024 * 64,
    windowBits: 15,
    to: ""
  }, options || {});
  const opt = this.options;
  if (opt.raw && opt.windowBits >= 0 && opt.windowBits < 16) {
    opt.windowBits = -opt.windowBits;
    if (opt.windowBits === 0) {
      opt.windowBits = -15;
    }
  }
  if (opt.windowBits >= 0 && opt.windowBits < 16 && !(options && options.windowBits)) {
    opt.windowBits += 32;
  }
  if (opt.windowBits > 15 && opt.windowBits < 48) {
    if ((opt.windowBits & 15) === 0) {
      opt.windowBits |= 15;
    }
  }
  this.err = 0;
  this.msg = "";
  this.ended = false;
  this.chunks = [];
  this.strm = new zstream();
  this.strm.avail_out = 0;
  let status = inflate_1$2.inflateInit2(
    this.strm,
    opt.windowBits
  );
  if (status !== Z_OK) {
    throw new Error(messages[status]);
  }
  this.header = new gzheader();
  inflate_1$2.inflateGetHeader(this.strm, this.header);
  if (opt.dictionary) {
    if (typeof opt.dictionary === "string") {
      opt.dictionary = strings.string2buf(opt.dictionary);
    } else if (toString.call(opt.dictionary) === "[object ArrayBuffer]") {
      opt.dictionary = new Uint8Array(opt.dictionary);
    }
    if (opt.raw) {
      status = inflate_1$2.inflateSetDictionary(this.strm, opt.dictionary);
      if (status !== Z_OK) {
        throw new Error(messages[status]);
      }
    }
  }
}
Inflate$1.prototype.push = function(data, flush_mode) {
  const strm = this.strm;
  const chunkSize = this.options.chunkSize;
  const dictionary = this.options.dictionary;
  let status, _flush_mode, last_avail_out;
  if (this.ended) return false;
  if (flush_mode === ~~flush_mode) _flush_mode = flush_mode;
  else _flush_mode = flush_mode === true ? Z_FINISH : Z_NO_FLUSH;
  if (toString.call(data) === "[object ArrayBuffer]") {
    strm.input = new Uint8Array(data);
  } else {
    strm.input = data;
  }
  strm.next_in = 0;
  strm.avail_in = strm.input.length;
  for (; ; ) {
    if (strm.avail_out === 0) {
      strm.output = new Uint8Array(chunkSize);
      strm.next_out = 0;
      strm.avail_out = chunkSize;
    }
    status = inflate_1$2.inflate(strm, _flush_mode);
    if (status === Z_NEED_DICT && dictionary) {
      status = inflate_1$2.inflateSetDictionary(strm, dictionary);
      if (status === Z_OK) {
        status = inflate_1$2.inflate(strm, _flush_mode);
      } else if (status === Z_DATA_ERROR) {
        status = Z_NEED_DICT;
      }
    }
    while (strm.avail_in > 0 && status === Z_STREAM_END && strm.state.wrap > 0 && data[strm.next_in] !== 0) {
      inflate_1$2.inflateReset(strm);
      status = inflate_1$2.inflate(strm, _flush_mode);
    }
    switch (status) {
      case Z_STREAM_ERROR:
      case Z_DATA_ERROR:
      case Z_NEED_DICT:
      case Z_MEM_ERROR:
        this.onEnd(status);
        this.ended = true;
        return false;
    }
    last_avail_out = strm.avail_out;
    if (strm.next_out) {
      if (strm.avail_out === 0 || status === Z_STREAM_END) {
        if (this.options.to === "string") {
          let next_out_utf8 = strings.utf8border(strm.output, strm.next_out);
          let tail = strm.next_out - next_out_utf8;
          let utf8str = strings.buf2string(strm.output, next_out_utf8);
          strm.next_out = tail;
          strm.avail_out = chunkSize - tail;
          if (tail) strm.output.set(strm.output.subarray(next_out_utf8, next_out_utf8 + tail), 0);
          this.onData(utf8str);
        } else {
          this.onData(strm.output.length === strm.next_out ? strm.output : strm.output.subarray(0, strm.next_out));
        }
      }
    }
    if (status === Z_OK && last_avail_out === 0) continue;
    if (status === Z_STREAM_END) {
      status = inflate_1$2.inflateEnd(this.strm);
      this.onEnd(status);
      this.ended = true;
      return true;
    }
    if (strm.avail_in === 0) break;
  }
  return true;
};
Inflate$1.prototype.onData = function(chunk) {
  this.chunks.push(chunk);
};
Inflate$1.prototype.onEnd = function(status) {
  if (status === Z_OK) {
    if (this.options.to === "string") {
      this.result = this.chunks.join("");
    } else {
      this.result = common.flattenChunks(this.chunks);
    }
  }
  this.chunks = [];
  this.err = status;
  this.msg = this.strm.msg;
};
function inflate$1(input, options) {
  const inflator = new Inflate$1(options);
  inflator.push(input);
  if (inflator.err) throw inflator.msg || messages[inflator.err];
  return inflator.result;
}
function inflateRaw$1(input, options) {
  options = options || {};
  options.raw = true;
  return inflate$1(input, options);
}
var Inflate_1$1 = Inflate$1;
var inflate_2 = inflate$1;
var inflateRaw_1$1 = inflateRaw$1;
var ungzip$1 = inflate$1;
var constants = constants$2;
var inflate_1$1 = {
  Inflate: Inflate_1$1,
  inflate: inflate_2,
  inflateRaw: inflateRaw_1$1,
  ungzip: ungzip$1,
  constants
};
var { Deflate, deflate, deflateRaw, gzip } = deflate_1$1;
var { Inflate, inflate, inflateRaw, ungzip } = inflate_1$1;

// demo/game.ts
var Input = {
  LEFT: 1,
  RIGHT: 2,
  UP: 4,
  DOWN: 8
};
var MOVE_SPEED = 3;
var CANVAS_WIDTH = 300;
var CANVAS_HEIGHT = 200;
var DOT_RADIUS = 10;
var PLAYER_COLORS = [
  "#e74c3c",
  // red
  "#3498db",
  // blue
  "#2ecc71",
  // green
  "#f39c12",
  // orange
  "#9b59b6",
  // purple
  "#1abc9c",
  // teal
  "#e91e63",
  // pink
  "#00bcd4"
  // cyan
];
var DotGame = class {
  players = /* @__PURE__ */ new Map();
  playerOrder = [];
  // Track order for deterministic color assignment
  /**
   * Add a player to the game.
   * @param id - Player ID
   * @param spawnX - Optional spawn X position (defaults to center)
   * @param spawnY - Optional spawn Y position (defaults to center)
   */
  addPlayer(id, spawnX, spawnY) {
    if (this.players.has(id)) return;
    const colorIndex = this.playerOrder.length % PLAYER_COLORS.length;
    this.players.set(id, {
      x: spawnX ?? CANVAS_WIDTH / 2,
      y: spawnY ?? CANVAS_HEIGHT / 2,
      color: PLAYER_COLORS[colorIndex]
    });
    this.playerOrder.push(id);
  }
  /**
   * Remove a player from the game.
   */
  removePlayer(id) {
    this.players.delete(id);
    const index = this.playerOrder.indexOf(id);
    if (index !== -1) {
      this.playerOrder.splice(index, 1);
    }
  }
  /**
   * Get a player's state.
   */
  getPlayer(id) {
    return this.players.get(id);
  }
  /**
   * Get all players.
   */
  getAllPlayers() {
    return this.players;
  }
  /**
   * Serialize the game state to bytes.
   * Format: [playerCount, ...players]
   * Each player: [idLength, ...idBytes, x (int16), y (int16), colorIndex (uint8)]
   */
  serialize() {
    const data = [this.players.size];
    for (const id of this.playerOrder) {
      const state = this.players.get(id);
      if (!state) continue;
      const idBytes = new TextEncoder().encode(id);
      data.push(idBytes.length);
      data.push(...idBytes);
      const x = Math.round(state.x);
      const y = Math.round(state.y);
      data.push(x >> 8 & 255, x & 255);
      data.push(y >> 8 & 255, y & 255);
      const colorIndex = PLAYER_COLORS.indexOf(state.color);
      data.push(colorIndex >= 0 ? colorIndex : 0);
    }
    return new Uint8Array(data);
  }
  /**
   * Deserialize the game state from bytes.
   */
  deserialize(data) {
    this.players.clear();
    this.playerOrder = [];
    if (data.length === 0) return;
    let offset = 0;
    const count = data[offset++];
    for (let i = 0; i < count; i++) {
      const idLen = data[offset++];
      const id = new TextDecoder().decode(data.slice(offset, offset + idLen));
      offset += idLen;
      let x = data[offset] << 8 | data[offset + 1];
      let y = data[offset + 2] << 8 | data[offset + 3];
      if (x >= 32768) x -= 65536;
      if (y >= 32768) y -= 65536;
      offset += 4;
      const colorIndex = data[offset++];
      const color = PLAYER_COLORS[colorIndex % PLAYER_COLORS.length];
      this.players.set(id, { x, y, color });
      this.playerOrder.push(id);
    }
  }
  /**
   * Advance the simulation by one tick.
   * Processes each player's input to move their dot.
   *
   * IMPORTANT: This function must be DETERMINISTIC.
   * Given the same inputs, it must always produce the same state changes.
   */
  step(inputs) {
    for (const [playerId, input] of inputs) {
      if (!this.players.has(playerId)) {
        this.addPlayer(playerId);
      }
      const player = this.players.get(playerId);
      if (!player || input.length === 0) continue;
      const keys = input[0];
      if (keys & Input.LEFT) player.x -= MOVE_SPEED;
      if (keys & Input.RIGHT) player.x += MOVE_SPEED;
      if (keys & Input.UP) player.y -= MOVE_SPEED;
      if (keys & Input.DOWN) player.y += MOVE_SPEED;
      player.x = Math.max(DOT_RADIUS, Math.min(CANVAS_WIDTH - DOT_RADIUS, player.x));
      player.y = Math.max(DOT_RADIUS, Math.min(CANVAS_HEIGHT - DOT_RADIUS, player.y));
    }
  }
  /**
   * Compute a hash of the current game state for desync detection.
   *
   * REQUIREMENTS:
   * - Must be deterministic (same state = same hash)
   * - Must include ALL state that affects gameplay
   * - Iteration order must be consistent (use sorted keys or track order)
   *
   * TIP: Use playerOrder array for deterministic iteration over Map.
   * Maps don't guarantee iteration order across different JS engines.
   */
  hash() {
    let h = 0;
    for (const id of this.playerOrder) {
      const state = this.players.get(id);
      if (!state) continue;
      for (let i = 0; i < id.length; i++) {
        h = (h << 5) - h + id.charCodeAt(i) | 0;
      }
      h = (h << 5) - h + Math.round(state.x) | 0;
      h = (h << 5) - h + Math.round(state.y) | 0;
    }
    return h >>> 0;
  }
  /**
   * Render the game state to a canvas.
   * @param ctx - Canvas 2D rendering context
   * @param highlightPlayerId - Optional player ID to highlight (local player)
   */
  draw(ctx, highlightPlayerId) {
    ctx.fillStyle = "#1a1a2e";
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    for (const [id, state] of this.players) {
      ctx.beginPath();
      ctx.arc(state.x, state.y, DOT_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = state.color;
      ctx.fill();
      if (id === highlightPlayerId) {
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
  }
  /**
   * Induce a desync by directly modifying state without going through step().
   * Used for testing desync detection.
   */
  induceDesync() {
    for (const player of this.players.values()) {
      const offsetX = Math.floor(Math.random() * 60) - 30;
      const offsetY = Math.floor(Math.random() * 60) - 30;
      player.x += offsetX;
      player.y += offsetY;
      player.x = Math.max(DOT_RADIUS, Math.min(CANVAS_WIDTH - DOT_RADIUS, player.x));
      player.y = Math.max(DOT_RADIUS, Math.min(CANVAS_HEIGHT - DOT_RADIUS, player.y));
    }
  }
};

// demo/demo.ts
var TICK_RATE = 60;
var TICK_MS = 1e3 / TICK_RATE;
var HASH_INTERVAL = 30;
var FLUSH_ITERATIONS = 5;
var JITTER_RATIO = 0.2;
var KEEPALIVE_INTERVAL_TICKS = 30;
var SPAWN_POSITIONS = [
  { x: 0.25, y: 0.25 },
  // top-left quadrant
  { x: 0.75, y: 0.75 },
  // bottom-right quadrant (diagonal from first)
  { x: 0.75, y: 0.25 },
  // top-right quadrant
  { x: 0.25, y: 0.75 },
  // bottom-left quadrant
  { x: 0.5, y: 0.15 },
  // top center
  { x: 0.5, y: 0.85 },
  // bottom center
  { x: 0.12, y: 0.5 },
  // left center
  { x: 0.88, y: 0.5 },
  // right center
  { x: 0.15, y: 0.15 },
  // corner positions for 9-12
  { x: 0.85, y: 0.85 },
  { x: 0.85, y: 0.15 },
  { x: 0.15, y: 0.85 },
  { x: 0.4, y: 0.35 },
  // inner positions for 13-16
  { x: 0.6, y: 0.65 },
  { x: 0.6, y: 0.35 },
  { x: 0.4, y: 0.65 }
];
var MAX_PLAYERS = 16;
var DemoManager = class {
  players = /* @__PURE__ */ new Map();
  activePlayerId = null;
  pressedKeys = /* @__PURE__ */ new Set();
  playerCounter = 0;
  lastTickTime = 0;
  accumulator = 0;
  running = false;
  tickCounter = 0;
  topology = 1 /* Star */;
  desyncAuthority = 0 /* Host */;
  simulatedLatency = 0;
  addPlayerBtn = null;
  constructor() {
    this.setupControls();
    this.setupKeyboardInput();
  }
  /**
   * Set up the control panel event handlers.
   */
  setupControls() {
    const topologySelect = document.getElementById("topology");
    const authoritySelect = document.getElementById("authority");
    const latencySelect = document.getElementById("latency");
    this.addPlayerBtn = document.getElementById("add-player");
    topologySelect.addEventListener("change", () => {
      this.topology = topologySelect.value === "mesh" ? 0 /* Mesh */ : 1 /* Star */;
      this.reset();
    });
    authoritySelect.addEventListener("change", () => {
      this.desyncAuthority = authoritySelect.value === "peer" ? 1 /* Peer */ : 0 /* Host */;
      this.reset();
    });
    latencySelect.addEventListener("change", () => {
      this.simulatedLatency = parseInt(latencySelect.value, 10);
      this.updateTransportLatency();
    });
    this.addPlayerBtn.addEventListener("click", () => {
      this.addPlayer();
    });
  }
  /**
   * Update the Add Player button enabled state based on current player count.
   */
  updateAddPlayerButton() {
    if (this.addPlayerBtn) {
      this.addPlayerBtn.disabled = this.players.size >= MAX_PLAYERS;
    }
  }
  /**
   * Set up keyboard input handling.
   */
  setupKeyboardInput() {
    window.addEventListener("keydown", (e) => {
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
        e.preventDefault();
        this.pressedKeys.add(e.key);
      }
    });
    window.addEventListener("keyup", (e) => {
      this.pressedKeys.delete(e.key);
    });
  }
  /**
   * Reset the demo (remove all players).
   */
  reset() {
    for (const player of this.players.values()) {
      player.session.destroy();
      player.panel.remove();
    }
    this.players.clear();
    this.activePlayerId = null;
    this.playerCounter = 0;
    this.updateAddPlayerButton();
  }
  /**
   * Update the latency settings on all existing transports.
   * Called when the latency dropdown changes.
   */
  updateTransportLatency() {
    const jitter = Math.floor(this.simulatedLatency * JITTER_RATIO);
    for (const entry of this.players.values()) {
      entry.transport.latency = this.simulatedLatency;
      entry.transport.jitter = jitter;
    }
  }
  /**
   * Get the current input as a byte based on pressed keys.
   */
  getInput() {
    let input = 0;
    if (this.pressedKeys.has("ArrowLeft")) input |= Input.LEFT;
    if (this.pressedKeys.has("ArrowRight")) input |= Input.RIGHT;
    if (this.pressedKeys.has("ArrowUp")) input |= Input.UP;
    if (this.pressedKeys.has("ArrowDown")) input |= Input.DOWN;
    return new Uint8Array([input]);
  }
  /**
   * Add a new player to the demo.
   *
   * This demonstrates the typical flow for adding a player:
   * 1. Create a transport (LocalTransport for testing, WebRTCTransport for production)
   * 2. Link transports based on topology
   * 3. Create game instance
   * 4. Create session with game + transport
   * 5. Register event handlers
   * 6. Host creates room, others join
   */
  addPlayer() {
    const playerId = asPlayerId(`player-${++this.playerCounter}`);
    const isHost = this.players.size === 0;
    const transport = new LocalTransport(playerId, {
      latency: this.simulatedLatency,
      jitter: Math.floor(this.simulatedLatency * JITTER_RATIO)
    });
    if (!isHost) {
      const hostEntry = this.getHostEntry();
      if (!hostEntry) {
        this.showError("Cannot add player: no host found");
        return;
      }
      LocalTransport.link(transport, hostEntry.transport);
      if (this.topology === 0 /* Mesh */) {
        for (const [id, entry2] of this.players) {
          if (id !== hostEntry.id) {
            LocalTransport.link(transport, entry2.transport);
          }
        }
      }
    }
    const game = new DotGame();
    const session = createSession({
      game,
      transport,
      localPlayerId: playerId,
      config: {
        topology: this.topology,
        desyncAuthority: this.desyncAuthority,
        tickRate: TICK_RATE,
        // hashInterval: How often to send state hashes for desync detection
        // Lower = faster detection, higher = less bandwidth
        hashInterval: HASH_INTERVAL,
        maxPlayers: MAX_PLAYERS
      }
    });
    session.on("playerJoined", (info) => {
      const spawn = this.getSpawnPosition(info.id);
      game.addPlayer(info.id, spawn.x, spawn.y);
    });
    session.on("playerLeft", (info) => {
      game.removePlayer(info.id);
    });
    session.on("desync", (tick, localHash, remoteHash) => {
      this.showDesyncFeedback(playerId, tick, localHash, remoteHash);
    });
    const { panel, canvas, ctx, statsEl } = this.createPlayerPanel(playerId, isHost);
    const entry = {
      id: playerId,
      session,
      game,
      transport,
      canvas,
      ctx,
      panel,
      statsEl,
      rollbackCount: 0
    };
    this.players.set(playerId, entry);
    this.updateAddPlayerButton();
    if (isHost) {
      session.createRoom().then(() => {
        const spawn = this.getSpawnPosition(playerId);
        game.addPlayer(playerId, spawn.x, spawn.y);
        session.start();
        this.startGameLoop();
      }).catch((error) => {
        this.showError(`Failed to create room: ${error.message}`);
        this.removePlayer(playerId);
      });
    } else {
      const hostEntry = this.getHostEntry();
      if (!hostEntry) {
        this.showError("Cannot join: no host found");
        this.removePlayer(playerId);
        return;
      }
      const hostRoomId = hostEntry.session.roomId;
      if (!hostRoomId) {
        this.showError("Host room ID not available yet");
        this.removePlayer(playerId);
        return;
      }
      session.joinRoom(hostRoomId, hostEntry.id).then(async () => {
        if (this.topology === 0 /* Mesh */) {
          for (const [id, otherEntry] of this.players) {
            if (id !== hostEntry.id && id !== playerId) {
              await transport.connect(id);
              await otherEntry.transport.connect(playerId);
            }
          }
        }
        this.flushAllTransports();
      }).catch((error) => {
        this.showError(`Failed to join room: ${error.message}`);
        this.removePlayer(playerId);
      });
    }
    if (isHost) {
      this.setActivePlayer(playerId);
    }
  }
  /**
   * Get the host player entry (first player added).
   */
  getHostEntry() {
    return this.players.values().next().value;
  }
  /**
   * Get spawn position for a player based on their ID.
   * Player IDs are "player-N" where N is 1-indexed.
   */
  getSpawnPosition(playerId) {
    const match = playerId.match(/player-(\d+)/);
    const playerNum = match ? parseInt(match[1], 10) : 1;
    const index = (playerNum - 1) % SPAWN_POSITIONS.length;
    const pos = SPAWN_POSITIONS[index];
    return {
      x: pos.x * CANVAS_WIDTH,
      y: pos.y * CANVAS_HEIGHT
    };
  }
  /**
   * Show an error message to the user.
   */
  showError(message) {
    console.error(message);
    alert(message);
  }
  /**
   * Remove a player from the demo.
   */
  removePlayer(playerId) {
    const entry = this.players.get(playerId);
    if (!entry) return;
    const isHost = this.players.values().next().value?.id === playerId;
    entry.session.destroy();
    entry.panel.remove();
    this.players.delete(playerId);
    for (const other of this.players.values()) {
      LocalTransport.unlink(entry.transport, other.transport);
    }
    if (isHost) {
      this.reset();
      return;
    }
    if (this.activePlayerId === playerId) {
      const firstPlayer = this.players.keys().next().value;
      if (firstPlayer) {
        this.setActivePlayer(firstPlayer);
      } else {
        this.activePlayerId = null;
      }
    }
    this.flushAllTransports();
    this.updateAddPlayerButton();
  }
  /**
   * Create the UI panel for a player.
   */
  createPlayerPanel(playerId, isHost) {
    const container = document.getElementById("players-container");
    const panel = document.createElement("div");
    panel.className = "player-panel";
    panel.dataset.playerId = playerId;
    const header = document.createElement("div");
    header.className = "player-header";
    header.innerHTML = `
      <div class="player-info">
        <span class="player-name">${playerId}${isHost ? " (host)" : ""}</span>
        <span class="player-stats"></span>
      </div>
      <div class="player-buttons">
        <button class="btn-desync">Desync</button>
        <button class="btn-disconnect">Disconnect</button>
      </div>
    `;
    const statsEl = header.querySelector(".player-stats");
    const canvas = document.createElement("canvas");
    canvas.width = CANVAS_WIDTH;
    canvas.height = CANVAS_HEIGHT;
    canvas.className = "game-canvas";
    canvas.addEventListener("click", () => {
      this.setActivePlayer(playerId);
    });
    header.querySelector(".btn-desync").addEventListener("click", (e) => {
      e.stopPropagation();
      this.induceDesync(playerId);
    });
    header.querySelector(".btn-disconnect").addEventListener("click", (e) => {
      e.stopPropagation();
      this.removePlayer(playerId);
    });
    panel.appendChild(header);
    panel.appendChild(canvas);
    container.appendChild(panel);
    const ctx = canvas.getContext("2d");
    return { panel, canvas, ctx, statsEl };
  }
  /**
   * Set the active player (receives keyboard input).
   */
  setActivePlayer(playerId) {
    document.querySelectorAll(".player-panel").forEach((p) => {
      p.classList.remove("active");
    });
    const entry = this.players.get(playerId);
    if (entry) {
      entry.panel.classList.add("active");
      this.activePlayerId = playerId;
    }
  }
  /**
   * Induce a desync on a player's game instance.
   */
  induceDesync(playerId) {
    const entry = this.players.get(playerId);
    if (entry) {
      entry.game.induceDesync();
    }
  }
  /**
   * Show visual feedback when a desync is detected.
   */
  showDesyncFeedback(playerId, tick, localHash, remoteHash) {
    const entry = this.players.get(playerId);
    if (!entry) return;
    entry.panel.classList.add("desync");
    setTimeout(() => {
      entry.panel.classList.remove("desync");
    }, 500);
    console.warn(
      `Desync detected for ${playerId} at tick ${tick}: local=${localHash}, remote=${remoteHash}`
    );
  }
  /**
   * Flush all transports to deliver pending messages.
   *
   * Multiple iterations are needed because in Star topology, a message
   * from player A to player B goes: A → Host → B (2 hops).
   * Each flush() only delivers messages queued at that moment.
   */
  flushAllTransports() {
    for (let i = 0; i < FLUSH_ITERATIONS; i++) {
      for (const entry of this.players.values()) {
        entry.transport.flush();
      }
    }
  }
  /**
   * Start the game loop.
   */
  startGameLoop() {
    if (this.running) return;
    this.running = true;
    this.lastTickTime = performance.now();
    requestAnimationFrame((t) => this.gameLoop(t));
  }
  /**
   * Main game loop with fixed timestep.
   */
  gameLoop(currentTime) {
    if (!this.running || this.players.size === 0) {
      this.running = false;
      return;
    }
    const deltaTime = currentTime - this.lastTickTime;
    this.lastTickTime = currentTime;
    this.accumulator += deltaTime;
    while (this.accumulator >= TICK_MS) {
      this.tick();
      this.accumulator -= TICK_MS;
    }
    this.render();
    requestAnimationFrame((t) => this.gameLoop(t));
  }
  /**
   * Advance all sessions by one tick.
   *
   * When latency is 0, we interleave flushes between player ticks to ensure
   * zero-latency message delivery. When latency is configured, we use
   * time-based delivery to simulate realistic network conditions.
   */
  tick() {
    const input = this.getInput();
    this.tickCounter++;
    const shouldPing = this.tickCounter % KEEPALIVE_INTERVAL_TICKS === 0;
    if (this.simulatedLatency === 0) {
      this.flushAllTransportsOnce();
      for (const entry of this.players.values()) {
        const playerInput = entry.id === this.activePlayerId ? input : new Uint8Array([0]);
        const result = entry.session.tick(playerInput);
        this.trackRollback(entry, result);
        this.flushAllTransportsOnce();
      }
      if (shouldPing) {
        this.sendPingsToHost();
        this.flushAllTransportsOnce();
      }
    } else {
      for (const entry of this.players.values()) {
        entry.transport.tick(TICK_MS);
      }
      if (shouldPing) {
        this.sendPingsToHost();
      }
      for (const entry of this.players.values()) {
        const playerInput = entry.id === this.activePlayerId ? input : new Uint8Array([0]);
        const result = entry.session.tick(playerInput);
        this.trackRollback(entry, result);
      }
    }
  }
  /**
   * Track rollback events and update stats.
   */
  trackRollback(entry, result) {
    if (result.rolledBack) {
      entry.rollbackCount++;
    }
  }
  /**
   * Send pings from all non-host players to the host for RTT measurement.
   */
  sendPingsToHost() {
    const hostEntry = this.getHostEntry();
    if (!hostEntry) return;
    for (const entry of this.players.values()) {
      if (entry.id !== hostEntry.id) {
        entry.session.sendPing(hostEntry.id);
      }
    }
  }
  /**
   * Flush all transports once (single pass).
   */
  flushAllTransportsOnce() {
    for (const entry of this.players.values()) {
      entry.transport.flush();
    }
  }
  /**
   * Render all game views and update stats.
   */
  render() {
    for (const entry of this.players.values()) {
      entry.game.draw(entry.ctx, entry.id);
      this.updateStats(entry);
    }
  }
  /**
   * Update the stats display for a player.
   * Always shows two lines: RTT and Rollbacks.
   */
  updateStats(entry) {
    const hostEntry = this.getHostEntry();
    const isHost = hostEntry?.id === entry.id;
    let rttText;
    if (isHost) {
      rttText = "RTT: -";
    } else if (hostEntry) {
      const rtt = entry.session.getRtt(hostEntry.id);
      rttText = rtt > 0 ? `RTT: ${Math.round(rtt)}ms` : "RTT: -";
    } else {
      rttText = "RTT: -";
    }
    const rollbackText = `Rollbacks: ${entry.rollbackCount}`;
    entry.statsEl.innerHTML = `${rttText}<br>${rollbackText}`;
  }
};
document.addEventListener("DOMContentLoaded", () => {
  const dm = new DemoManager();
  window.dm = dm;
});
/*! Bundled license information:

pako/dist/pako.esm.mjs:
  (*! pako 2.1.0 https://github.com/nodeca/pako @license (MIT AND Zlib) *)
*/
//# sourceMappingURL=demo.js.map
