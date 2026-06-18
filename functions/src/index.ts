import { initializeApp } from "firebase-admin/app";
import { getDatabase, type Database } from "firebase-admin/database";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { applyOnlineMove, createInitialRoom, currentRoomState, DISCONNECT_GRACE_MS, finishRoomUpdate, playerForUid, publicRoomId, roomPath } from "../../src/onlineShared";
import type { GameId, OnlineRoom, OnlineSeat, Player } from "../../src/types";

function firebaseConfigProjectId() {
  try {
    const config = JSON.parse(process.env.FIREBASE_CONFIG || "{}") as { projectId?: string; databaseURL?: string };
    return { projectId: config.projectId, databaseURL: config.databaseURL };
  } catch {
    return {};
  }
}

function databaseUrl() {
  const config = firebaseConfigProjectId();
  return process.env.FIREBASE_DATABASE_URL
    || config.databaseURL
    || `https://${process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || config.projectId || "game-36891"}-default-rtdb.firebaseio.com`;
}

const adminApp = initializeApp({ databaseURL: databaseUrl() });
let cachedDb: Database | null = null;

function db() {
  cachedDb ??= getDatabase(adminApp);
  return cachedDb;
}

function requireUid(request: { auth?: { uid: string } }) {
  if (!request.auth?.uid) throw new HttpsError("unauthenticated", "Sign in anonymously first.");
  return request.auth.uid;
}

function displayName(value: unknown) {
  return String(value || "Player").trim().slice(0, 32) || "Player";
}

function callableError(error: unknown): HttpsError {
  if (error instanceof HttpsError) return error;
  return new HttpsError("failed-precondition", error instanceof Error ? error.message : "Command failed.");
}

async function transactRoom(roomId: string, update: (room: OnlineRoom) => OnlineRoom) {
  const ref = db().ref(roomPath(roomId));
  let committedRoom: OnlineRoom | null = null;
  const result = await ref.transaction((current: OnlineRoom | null) => {
    if (!current) throw new HttpsError("not-found", "Room not found.");
    const room = current as OnlineRoom;
    if (room.expiresAt < Date.now()) throw new HttpsError("failed-precondition", "Room has expired.");
    committedRoom = update(room);
    return committedRoom;
  }, undefined, false);
  if (!result.committed || !committedRoom) throw new HttpsError("aborted", "Room changed. Try again.");
  return committedRoom;
}

export const createRoom = onCall(async request => {
  const uid = requireUid(request);
  const gameId = request.data.gameId as GameId;
  const now = Date.now();
  const seat: OnlineSeat = { uid, name: displayName(request.data.name), connected: true, lastSeen: now };
  for (let attempt = 0; attempt < 5; attempt++) {
    const roomId = publicRoomId();
    const room = createInitialRoom(roomId, gameId, request.data.rules, seat, now);
    const result = await db().ref(roomPath(roomId)).transaction((current: OnlineRoom | null) => current ? undefined : room, undefined, false);
    if (result.committed) return { roomId, room };
  }
  throw new HttpsError("resource-exhausted", "Could not allocate a room code.");
});

export const joinRoom = onCall(async request => {
  const uid = requireUid(request);
  const roomId = String(request.data.roomId || "");
  const now = Date.now();
  const room = await transactRoom(roomId, current => {
    const existing = playerForUid(current, uid);
    if (existing) {
      return finishRoomUpdate({
        ...current,
        players: { ...current.players, [existing]: { ...current.players[existing]!, connected: true, lastSeen: now } }
      }, current.result, now);
    }
    if (current.players[2]) throw new HttpsError("permission-denied", "Room is full.");
    return finishRoomUpdate({
      ...current,
      status: "playing",
      players: { ...current.players, 2: { uid, name: displayName(request.data.name), connected: true, lastSeen: now } }
    }, current.result, now);
  });
  return { roomId, room };
});

export const submitMove = onCall(async request => {
  const uid = requireUid(request);
  const roomId = String(request.data.roomId || "");
  try {
    const room = await transactRoom(roomId, current =>
      applyOnlineMove(current, uid, request.data.move, Number(request.data.expectedRevision), Date.now())
    );
    return { roomId, room };
  } catch (error) {
    throw callableError(error);
  }
});

export const resignRoom = onCall(async request => {
  const uid = requireUid(request);
  const roomId = String(request.data.roomId || "");
  const now = Date.now();
  const room = await transactRoom(roomId, current => {
    const player = playerForUid(current, uid);
    if (!player) throw new HttpsError("permission-denied", "You are not seated in this room.");
    const winner = (player === 1 ? 2 : 1) as Player;
    return finishRoomUpdate({ ...current, status: "resigned", result: { winner, reason: "Resignation" } }, { winner, reason: "Resignation" }, now);
  });
  return { roomId, room };
});

export const requestUndo = onCall(async request => {
  const uid = requireUid(request);
  const roomId = String(request.data.roomId || "");
  const now = Date.now();
  const room = await transactRoom(roomId, current => {
    if (current.revision !== Number(request.data.expectedRevision)) throw new HttpsError("aborted", "Room changed. Try again.");
    const player = playerForUid(current, uid);
    if (!player) throw new HttpsError("permission-denied", "You are not seated in this room.");
    const targetNodeId = String(request.data.targetNodeId || "");
    if (!current.nodes[targetNodeId]) throw new HttpsError("invalid-argument", "Undo target is not in this room.");
    return finishRoomUpdate({ ...current, undoRequest: { id: crypto.randomUUID(), requester: player, targetNodeId, status: "pending", createdAt: now } }, current.result, now);
  });
  return { roomId, room };
});

export const respondUndo = onCall(async request => {
  const uid = requireUid(request);
  const roomId = String(request.data.roomId || "");
  const now = Date.now();
  const room = await transactRoom(roomId, current => {
    if (current.revision !== Number(request.data.expectedRevision)) throw new HttpsError("aborted", "Room changed. Try again.");
    const player = playerForUid(current, uid);
    if (!player || !current.undoRequest || current.undoRequest.requester === player) throw new HttpsError("permission-denied", "No undo response is available.");
    if (!request.data.approve) return finishRoomUpdate({ ...current, undoRequest: { ...current.undoRequest, status: "declined" } }, current.result, now);
    if (!current.nodes[current.undoRequest.targetNodeId]) throw new HttpsError("invalid-argument", "Undo target is no longer available.");
    return finishRoomUpdate({ ...current, activeNodeId: current.undoRequest.targetNodeId, undoRequest: { ...current.undoRequest, status: "approved" }, result: null, status: "playing" }, null, now);
  });
  return { roomId, room };
});

export const claimDisconnectWin = onCall(async request => {
  const uid = requireUid(request);
  const roomId = String(request.data.roomId || "");
  const now = Date.now();
  const room = await transactRoom(roomId, current => {
    const player = playerForUid(current, uid);
    if (!player) throw new HttpsError("permission-denied", "You are not seated in this room.");
    const opponent = current.players[player === 1 ? 2 : 1];
    if (!opponent || opponent.connected || now - opponent.lastSeen < DISCONNECT_GRACE_MS) throw new HttpsError("failed-precondition", "Opponent is still within the reconnect window.");
    if (currentRoomState(current).result) throw new HttpsError("failed-precondition", "Game is already complete.");
    return finishRoomUpdate({ ...current, status: "completed", result: { winner: player, reason: "Opponent disconnected" } }, { winner: player, reason: "Opponent disconnected" }, now);
  });
  return { roomId, room };
});
