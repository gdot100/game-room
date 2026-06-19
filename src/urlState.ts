import { adapters } from "./games";
import type { GameId, GameSession, MoveNode, PlayerConfig } from "./types";

type CompactSharePayload = [GameId, unknown] | [GameId, unknown, unknown];
interface CompactObjectSharePayload {
  v: 2;
  g: GameId;
  s?: string;
  p?: unknown;
  r?: unknown;
}

interface LegacySharePayload {
  session: GameSession;
}

function encodeBase64Url(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeBase64Url(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return new TextDecoder().decode(Uint8Array.from(binary, char => char.charCodeAt(0)));
}

export function encodeSessionState(session: GameSession) {
  const adapter = adapters[session.gameId];
  const snapshot = session.nodes[session.activeNodeId].snapshot;
  const state = JSON.parse(snapshot) as unknown;
  const payload: CompactSharePayload = JSON.stringify(session.rules) === JSON.stringify(adapter.defaultRules)
    ? [session.gameId, state]
    : [session.gameId, state, session.rules];
  return encodeBase64Url(JSON.stringify(payload));
}

export function decodeSessionState(value: string): GameSession {
  const payload = JSON.parse(decodeBase64Url(value)) as CompactSharePayload | CompactObjectSharePayload | LegacySharePayload;
  if ("session" in payload) return decodeLegacySession(payload);
  if (Array.isArray(payload)) return decodeCompactPosition(payload[0], JSON.stringify(payload[1]), payload[2]);
  const snapshot = payload.s ?? JSON.stringify(payload.p);
  if (!payload.g || !snapshot) {
    throw new Error("That shared game link is incomplete.");
  }
  return decodeCompactPosition(payload.g, snapshot, payload.r);
}

export function makeSessionShareUrl(session: GameSession) {
  const url = new URL(window.location.href);
  url.search = "";
  url.searchParams.set("s", encodeSessionState(session));
  return url.toString();
}

function decodeCompactPosition(gameId: GameId, snapshot: string, sharedRules: unknown): GameSession {
  if (!gameId || !snapshot) throw new Error("That shared game link is incomplete.");
  const adapter = adapters[gameId];
  if (!adapter) throw new Error("That shared game link uses an unknown game.");
  const rules = sharedRules ?? structuredClone(adapter.defaultRules);
  const errors = adapter.validateRules(rules);
  if (errors.length) throw new Error(errors.join(" "));
  adapter.deserialize(snapshot);
  const now = Date.now();
  const rootId = crypto.randomUUID();
  const root: MoveNode = {
    id: rootId,
    parentId: null,
    children: [],
    move: null,
    notation: "Shared position",
    snapshot,
    createdAt: now
  };
  return {
    id: crypto.randomUUID(),
    gameId,
    rules,
    players: linkPlayers(),
    nodes: { [rootId]: root },
    rootId,
    activeNodeId: rootId,
    origin: "link",
    createdAt: now,
    updatedAt: Date.now()
  };
}

function decodeLegacySession(payload: LegacySharePayload): GameSession {
  if (!payload.session?.gameId || !payload.session.nodes || !payload.session.activeNodeId) {
    throw new Error("That shared game link is incomplete.");
  }
  return {
    ...payload.session,
    origin: "link",
    updatedAt: Date.now()
  };
}

function linkPlayers(): Record<1 | 2, PlayerConfig> {
  return {
    1: { kind: "human", name: "Player One", difficulty: 55, minMoveMs: 0 },
    2: { kind: "human", name: "Player Two", difficulty: 55, minMoveMs: 0 }
  };
}
