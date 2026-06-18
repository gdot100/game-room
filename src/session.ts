import { adapters } from "./games";
import type { GameId, GameSession, MoveNode, PlayerConfig } from "./types";

const defaultPlayers: Record<1 | 2, PlayerConfig> = {
  1: { kind: "human", name: "Player One", difficulty: 55, minMoveMs: 450 },
  2: { kind: "ai", name: "The House", difficulty: 55, minMoveMs: 650 }
};

export function createSession(
  gameId: GameId,
  rules: unknown,
  players: Record<1 | 2, PlayerConfig> = defaultPlayers
): GameSession {
  const adapter = adapters[gameId];
  const state = adapter.create(rules);
  const rootId = crypto.randomUUID();
  const root: MoveNode = {
    id: rootId, parentId: null, children: [], move: null, notation: "Start",
    snapshot: adapter.serialize(state), createdAt: Date.now()
  };
  return {
    id: crypto.randomUUID(), gameId, rules, players,
    nodes: { [rootId]: root }, rootId, activeNodeId: rootId,
    createdAt: Date.now(), updatedAt: Date.now()
  };
}

export function playMove(session: GameSession, move: unknown): GameSession {
  const adapter = adapters[session.gameId];
  const active = session.nodes[session.activeNodeId];
  const state = adapter.deserialize(active.snapshot);
  const existing = active.children.map(id => session.nodes[id]).find(n => JSON.stringify(n.move) === JSON.stringify(move));
  if (existing) return { ...session, activeNodeId: existing.id, updatedAt: Date.now() };
  const nextState = adapter.applyMove(state, move, session.rules);
  if (nextState === state) return session;
  const id = crypto.randomUUID();
  const child: MoveNode = {
    id, parentId: active.id, children: [], move,
    notation: adapter.notation(move, state, session.rules),
    snapshot: adapter.serialize(nextState), createdAt: Date.now()
  };
  return {
    ...session,
    nodes: {
      ...session.nodes,
      [active.id]: { ...active, children: [...active.children, id] },
      [id]: child
    },
    activeNodeId: id,
    updatedAt: Date.now()
  };
}

export function goBack(session: GameSession): GameSession {
  const parent = session.nodes[session.activeNodeId].parentId;
  return parent ? { ...session, activeNodeId: parent, updatedAt: Date.now() } : session;
}

export function goForward(session: GameSession): GameSession {
  const children = session.nodes[session.activeNodeId].children;
  return children.length ? { ...session, activeNodeId: children[children.length - 1], updatedAt: Date.now() } : session;
}

export function removeBranch(session: GameSession, nodeId: string): GameSession {
  const node = session.nodes[nodeId];
  if (!node?.parentId || nodeId === session.activeNodeId) return session;
  const ids = new Set<string>();
  const collect = (id: string) => { ids.add(id); session.nodes[id].children.forEach(collect); };
  collect(nodeId);
  const nodes = Object.fromEntries(Object.entries(session.nodes).filter(([id]) => !ids.has(id)));
  nodes[node.parentId] = { ...nodes[node.parentId], children: nodes[node.parentId].children.filter((id: string) => id !== nodeId) };
  return { ...session, nodes, updatedAt: Date.now() };
}
