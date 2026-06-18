/// <reference lib="webworker" />
import { adapters } from "./games";
import type { GameId, Player } from "./types";

interface Request {
  id: string;
  gameId: GameId;
  state: string;
  rules: unknown;
  difficulty: number;
}

let latestId = "";
const scope = self as unknown as DedicatedWorkerGlobalScope;

function search(request: Request) {
  const adapter = adapters[request.gameId];
  const root = adapter.deserialize(request.state);
  const player = root.turn as Player;
  const legal = adapter.legalMoves(root, request.rules);
  if (!legal.length) return null;

  const difficulty = Math.max(1, Math.min(100, request.difficulty));
  const budget = 100 + Math.round(difficulty * difficulty * 0.55);
  const maxDepth = difficulty < 15 ? 2 : difficulty < 35 ? 3 : difficulty < 55 ? 4 : difficulty < 75 ? 5 : difficulty < 90 ? 7 : 9;
  const deadline = performance.now() + budget;
  let best = legal[0];
  let bestValue = -Infinity;
  let reachedDepth = 0;
  let nodes = 0;
  const transpositions = new Map<string, { depth: number; value: number }>();

  const nearbyMoves = (state: any, moves: any[]) => {
    if (!["gomoku", "go", "hex"].includes(request.gameId) || !state.board) return moves;
    const occupied: { row: number; col: number }[] = [];
    state.board.forEach((row: number[], r: number) => row.forEach((cell, c) => { if (cell) occupied.push({ row: r, col: c }); }));
    if (!occupied.length) {
      const middle = Math.floor(state.board.length / 2);
      return moves.filter(move => "pass" in move || (move.row === middle && move.col === middle));
    }
    const radius = request.gameId === "gomoku" ? 2 : 1;
    const local = moves.filter(move => "pass" in move || occupied.some(point => Math.abs(point.row - move.row) <= radius && Math.abs(point.col - move.col) <= radius));
    return local.length ? local : moves;
  };

  const orderedMoves = (state: any, moves: any[], maximizing: boolean) => {
    const candidates = nearbyMoves(state, moves).map(move => {
      const child = adapter.applyMove(state, move, request.rules);
      const terminal = child.result?.winner === player ? 1_000_000 : child.result ? -1_000_000 : 0;
      return { move, child, score: terminal || adapter.evaluate(child, player, request.rules) };
    }).sort((a, b) => maximizing ? b.score - a.score : a.score - b.score);
    const cap = request.gameId === "gomoku"
      ? Math.round(8 + difficulty / 4)
      : request.gameId === "go" || request.gameId === "hex"
        ? Math.round(10 + difficulty / 3)
        : request.gameId === "dots"
          ? Math.round(12 + difficulty / 2)
          : 1000;
    return candidates.slice(0, cap);
  };

  const minimax = (state: any, depth: number, alpha: number, beta: number): number => {
    nodes++;
    if (performance.now() >= deadline || request.id !== latestId) throw new Error("stop");
    if (depth === 0 || state.result) return adapter.evaluate(state, player, request.rules);
    const moves = adapter.legalMoves(state, request.rules);
    if (!moves.length) return adapter.evaluate(state, player, request.rules);
    const maximizing = state.turn === player;
    const cacheKey = `${adapter.serialize(state)}|${depth}|${maximizing ? 1 : 0}`;
    const cached = transpositions.get(cacheKey);
    if (cached && cached.depth >= depth) return cached.value;
    let value = maximizing ? -Infinity : Infinity;
    let cutoff = false;
    for (const { child } of orderedMoves(state, moves, maximizing)) {
      const score = minimax(child, depth - 1, alpha, beta);
      if (maximizing) {
        value = Math.max(value, score); alpha = Math.max(alpha, value);
      } else {
        value = Math.min(value, score); beta = Math.min(beta, value);
      }
      if (beta <= alpha) { cutoff = true; break; }
    }
    if (!cutoff) transpositions.set(cacheKey, { depth, value });
    return value;
  };

  const rootMoves = orderedMoves(root, legal, true);
  const immediateWin = rootMoves.find(({ child }) => child.result?.winner === player);
  if (immediateWin) return { move: immediateWin.move, evaluation: 1_000_000, depth: 1, nodes: rootMoves.length };

  for (let depth = 1; depth <= maxDepth; depth++) {
    try {
      const scored = rootMoves.map(({ move, child }) => ({
        move, value: minimax(child, depth - 1, -Infinity, Infinity)
      })).sort((a, b) => b.value - a.value);
      if (performance.now() >= deadline) break;
      bestValue = scored[0].value;
      const tolerance = difficulty < 20 ? 12 : difficulty < 45 ? 4 : difficulty < 70 ? 1 : 0;
      const choices = scored.filter((x: { value: number }) => x.value >= bestValue - tolerance);
      best = choices[Math.floor(Math.random() * choices.length)].move;
      reachedDepth = depth;
    } catch {
      break;
    }
  }
  return { move: best, evaluation: bestValue, depth: reachedDepth, nodes };
}

scope.onmessage = (event: MessageEvent<Request | { cancel: string }>) => {
  if ("cancel" in event.data) {
    latestId = event.data.cancel;
    return;
  }
  latestId = event.data.id;
  const result = search(event.data);
  if (result && event.data.id === latestId)
    scope.postMessage({ id: event.data.id, ...result });
};
