import { adapters } from "./games";
import type { GameId, GameResult, MoveNode, OnlineRoom, OnlineSeat, Player } from "./types";

export const ROOM_TTL_MS = 24 * 60 * 60 * 1000;
export const DISCONNECT_GRACE_MS = 5 * 60 * 1000;

export function roomPath(roomId: string) {
  return `rooms/${roomId}`;
}

export function publicRoomId(bytes = 12) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const values = new Uint8Array(bytes);
  crypto.getRandomValues(values);
  return Array.from(values, value => alphabet[value % alphabet.length]).join("");
}

export function makeOnlineSessionPlayers(room: OnlineRoom, currentUid?: string) {
  return {
    1: seatToPlayer(room.players[1], currentUid),
    2: seatToPlayer(room.players[2], currentUid)
  } as const;
}

function seatToPlayer(seat: OnlineSeat | undefined, currentUid?: string) {
  return {
    kind: "online" as const,
    name: seat?.name || "Waiting...",
    difficulty: 55,
    minMoveMs: 0,
    uid: seat?.uid,
    connected: seat?.uid === currentUid ? true : seat?.connected ?? false
  };
}

export function onlineRoomToSession(room: OnlineRoom, currentUid?: string) {
  return {
    id: room.id,
    gameId: room.gameId,
    rules: room.rules,
    players: makeOnlineSessionPlayers(room, currentUid),
    nodes: room.nodes,
    rootId: room.rootId,
    activeNodeId: room.activeNodeId,
    createdAt: room.createdAt,
    updatedAt: room.updatedAt,
    origin: "online" as const,
    onlineRoomId: room.id,
    revision: room.revision
  };
}

export function createInitialRoom(
  roomId: string,
  gameId: GameId,
  rules: unknown,
  host: OnlineSeat,
  now: number
): OnlineRoom {
  const adapter = adapters[gameId];
  const errors = adapter.validateRules(rules);
  if (errors.length) throw new Error(errors.join(" "));
  const rootId = crypto.randomUUID();
  const root: MoveNode = {
    id: rootId,
    parentId: null,
    children: [],
    move: null,
    notation: "Start",
    snapshot: adapter.serialize(adapter.create(rules)),
    createdAt: now
  };
  return {
    id: roomId,
    gameId,
    rules,
    players: { 1: host },
    nodes: { [rootId]: root },
    rootId,
    activeNodeId: rootId,
    revision: 0,
    status: "waiting",
    result: null,
    undoRequest: null,
    createdAt: now,
    updatedAt: now,
    expiresAt: now + ROOM_TTL_MS
  };
}

export function playerForUid(room: OnlineRoom, uid: string): Player | null {
  if (room.players[1]?.uid === uid) return 1;
  if (room.players[2]?.uid === uid) return 2;
  return null;
}

export function currentRoomState(room: OnlineRoom) {
  return adapters[room.gameId].deserialize(room.nodes[room.activeNodeId].snapshot);
}

export function applyOnlineMove(room: OnlineRoom, uid: string, move: unknown, expectedRevision: number, now: number): OnlineRoom {
  if (room.revision !== expectedRevision) throw new Error("This room has moved on. Refreshing position.");
  if (room.status !== "playing") throw new Error("This room is not ready for moves.");
  const player = playerForUid(room, uid);
  if (!player) throw new Error("You are not seated in this room.");
  const adapter = adapters[room.gameId];
  const active = room.nodes[room.activeNodeId];
  const state = adapter.deserialize(active.snapshot);
  if (state.result) throw new Error("This game is already complete.");
  if (state.turn !== player) throw new Error("It is not your turn.");
  const legal = adapter.legalMoves(state, room.rules);
  if (!legal.some(candidate => JSON.stringify(candidate) === JSON.stringify(move))) throw new Error("Illegal move.");
  const existing = active.children.map(id => room.nodes[id]).find(node => JSON.stringify(node.move) === JSON.stringify(move));
  if (existing) {
    const nextState = adapter.deserialize(existing.snapshot);
    return finishRoomUpdate({ ...room, activeNodeId: existing.id }, nextState.result, now);
  }
  const nextState = adapter.applyMove(state, move, room.rules);
  const nodeId = crypto.randomUUID();
  const child: MoveNode = {
    id: nodeId,
    parentId: active.id,
    children: [],
    move,
    notation: adapter.notation(move, state, room.rules),
    snapshot: adapter.serialize(nextState),
    createdAt: now
  };
  return finishRoomUpdate({
    ...room,
    activeNodeId: nodeId,
    nodes: {
      ...room.nodes,
      [active.id]: { ...active, children: [...active.children, nodeId] },
      [nodeId]: child
    },
    undoRequest: null
  }, nextState.result, now);
}

export function finishRoomUpdate(room: OnlineRoom, result: GameResult | null, now: number): OnlineRoom {
  return {
    ...room,
    result,
    status: result ? "completed" : room.status === "waiting" && room.players[1] && room.players[2] ? "playing" : room.status,
    revision: room.revision + 1,
    updatedAt: now,
    expiresAt: now + ROOM_TTL_MS
  };
}
