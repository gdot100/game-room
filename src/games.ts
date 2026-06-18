import { Chess, type Move as ChessJsMove, type Square } from "chess.js";
import type { BaseState, GameAdapter, GameId, GameResult, Player } from "./types";

export type AnyAdapter = GameAdapter<any, any, any>;
const other = (p: Player): Player => (p === 1 ? 2 : 1);
const json = <T>(value: T): string => JSON.stringify(value);
const parse = <T>(value: string): T => JSON.parse(value) as T;
const inRange = (n: number, min: number, max: number) =>
  Number.isInteger(n) && n >= min && n <= max;

function lineWinner(
  board: number[][],
  target: number
): Player | null {
  const rows = board.length;
  const cols = board[0].length;
  const directions = [[0, 1], [1, 0], [1, 1], [1, -1]];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const player = board[r][c] as Player | 0;
      if (!player) continue;
      for (const [dr, dc] of directions) {
        let count = 1;
        while (
          count < target &&
          board[r + dr * count]?.[c + dc * count] === player
        ) count++;
        if (count === target) return player;
      }
    }
  }
  return null;
}

export interface ConnectRules {
  rows: number;
  cols: number;
  target: number;
}
export interface ConnectState extends BaseState {
  board: number[][];
  lastMove?: { row: number; col: number };
}
export const connect4: GameAdapter<ConnectState, number, ConnectRules> = {
  id: "connect4",
  name: "Connect",
  description: "Drop a line before your rival does.",
  accent: "#e59b43",
  defaultRules: { rows: 6, cols: 7, target: 4 },
  validateRules: (r) => [
    ...(!inRange(r.rows, 4, 8) ? ["Rows must be 4-8."] : []),
    ...(!inRange(r.cols, 4, 10) ? ["Columns must be 4-10."] : []),
    ...(!inRange(r.target, 3, 5) || r.target > Math.max(r.rows, r.cols)
      ? ["Target must be 3-5 and fit the board."]
      : [])
  ],
  create: (r) => ({
    board: Array.from({ length: r.rows }, () => Array(r.cols).fill(0)),
    turn: 1, result: null, moveNumber: 0
  }),
  legalMoves: (s) => s.result ? [] : s.board[0].map((v, i) => v === 0 ? i : -1).filter(v => v >= 0),
  applyMove: (s, col, r) => {
    if (!connect4.legalMoves(s, r).includes(col)) return s;
    const board = s.board.map(row => [...row]);
    let row = board.length - 1;
    while (board[row][col]) row--;
    board[row][col] = s.turn;
    const winner = lineWinner(board, r.target);
    const full = board[0].every(Boolean);
    return {
      board,
      turn: other(s.turn),
      result: winner ? { winner, reason: `${r.target} connected` } :
        full ? { winner: 0, reason: "Board full" } : null,
      moveNumber: s.moveNumber + 1,
      lastMove: { row, col }
    };
  },
  notation: (m) => `Column ${m + 1}`,
  evaluate: (s, p, r) => {
    if (s.result) return s.result.winner === p ? 100000 : s.result.winner === 0 ? 0 : -100000;
    let score = 0;
    const center = (r.cols - 1) / 2;
    s.board.forEach(row => row.forEach((v, c) => {
      if (v) score += (v === p ? 1 : -1) * (r.cols - Math.abs(c - center));
    }));
    return score;
  },
  serialize: json,
  deserialize: parse,
  rulesSummary: r => `${r.cols}×${r.rows} board · connect ${r.target}`
};

export interface ReversiRules { size: 6 | 8 | 10 }
export interface CellMove { row: number; col: number }
export interface ReversiState extends BaseState {
  board: number[][];
  lastMove?: CellMove;
}
const directions8 = [-1, 0, 1].flatMap(dr => [-1, 0, 1].map(dc => [dr, dc])).filter(([a, b]) => a || b);
function reversiFlips(s: ReversiState, move: CellMove, p: Player): CellMove[] {
  if (s.board[move.row]?.[move.col] !== 0) return [];
  const all: CellMove[] = [];
  for (const [dr, dc] of directions8) {
    const line: CellMove[] = [];
    let row = move.row + dr, col = move.col + dc;
    while (s.board[row]?.[col] === other(p)) {
      line.push({ row, col }); row += dr; col += dc;
    }
    if (line.length && s.board[row]?.[col] === p) all.push(...line);
  }
  return all;
}
function reversiMoves(s: ReversiState, p = s.turn): CellMove[] {
  const result: CellMove[] = [];
  for (let row = 0; row < s.board.length; row++)
    for (let col = 0; col < s.board.length; col++)
      if (reversiFlips(s, { row, col }, p).length) result.push({ row, col });
  return result;
}
export const reversi: GameAdapter<ReversiState, CellMove, ReversiRules> = {
  id: "reversi", name: "Reversi",
  description: "Turn the board in one clever move.", accent: "#51a477",
  defaultRules: { size: 8 },
  validateRules: r => [6, 8, 10].includes(r.size) ? [] : ["Board must be 6×6, 8×8, or 10×10."],
  create: r => {
    const board = Array.from({ length: r.size }, () => Array(r.size).fill(0));
    const m = r.size / 2;
    board[m - 1][m - 1] = board[m][m] = 2;
    board[m - 1][m] = board[m][m - 1] = 1;
    return { board, turn: 1, result: null, moveNumber: 0 };
  },
  legalMoves: s => s.result ? [] : reversiMoves(s),
  applyMove: (s, move) => {
    const flips = reversiFlips(s, move, s.turn);
    if (!flips.length) return s;
    const board = s.board.map(r => [...r]);
    board[move.row][move.col] = s.turn;
    flips.forEach(({ row, col }) => board[row][col] = s.turn);
    const nextBase: ReversiState = { board, turn: other(s.turn), result: null, moveNumber: s.moveNumber + 1, lastMove: move };
    let nextMoves = reversiMoves(nextBase);
    if (!nextMoves.length) {
      nextBase.turn = s.turn;
      nextMoves = reversiMoves(nextBase);
    }
    if (!nextMoves.length) {
      const counts = board.flat().reduce((a, v) => { if (v) a[v as Player]++; return a; }, { 1: 0, 2: 0 } as Record<Player, number>);
      nextBase.result = { winner: counts[1] === counts[2] ? 0 : counts[1] > counts[2] ? 1 : 2, reason: `${counts[1]}–${counts[2]} discs` };
    }
    return nextBase;
  },
  notation: m => `${String.fromCharCode(65 + m.col)}${m.row + 1}`,
  evaluate: (s, p) => {
    if (s.result) return s.result.winner === p ? 100000 : s.result.winner === 0 ? 0 : -100000;
    let discs = 0;
    s.board.flat().forEach(v => discs += v === p ? 1 : v === other(p) ? -1 : 0);
    const mobility = reversiMoves(s, p).length - reversiMoves(s, other(p)).length;
    const n = s.board.length - 1;
    const corners = [[0, 0], [0, n], [n, 0], [n, n]];
    const cornerScore = corners.reduce((a, [r, c]) => a + (s.board[r][c] === p ? 20 : s.board[r][c] === other(p) ? -20 : 0), 0);
    return discs + mobility * 3 + cornerScore;
  },
  serialize: json, deserialize: parse, rulesSummary: r => `${r.size}×${r.size} board`
};

export interface MancalaRules {
  pits: number; stones: number; capture: boolean; bonusTurn: boolean;
}
export interface MancalaState extends BaseState {
  pits: [number[], number[]];
  stores: [number, number];
  lastMove?: { pit: number };
}
export const mancala: GameAdapter<MancalaState, number, MancalaRules> = {
  id: "mancala", name: "Mancala",
  description: "Sow, capture, and gather the most.", accent: "#c67c52",
  defaultRules: { pits: 6, stones: 4, capture: true, bonusTurn: true },
  validateRules: r => [
    ...(!inRange(r.pits, 4, 8) ? ["Pits must be 4-8."] : []),
    ...(!inRange(r.stones, 2, 6) ? ["Starting stones must be 2-6."] : [])
  ],
  create: r => ({
    pits: [Array(r.pits).fill(r.stones), Array(r.pits).fill(r.stones)],
    stores: [0, 0], turn: 1, result: null, moveNumber: 0
  }),
  legalMoves: s => s.result ? [] : s.pits[s.turn - 1].map((v, i) => v ? i : -1).filter(v => v >= 0),
  applyMove: (s, pit, r) => {
    if (!mancala.legalMoves(s, r).includes(pit)) return s;
    const pits: [number[], number[]] = [[...s.pits[0]], [...s.pits[1]]];
    const stores: [number, number] = [...s.stores];
    const owner = s.turn - 1;
    let stones = pits[owner][pit];
    pits[owner][pit] = 0;
    let side = owner, index = pit + 1, endedStore = false;
    while (stones) {
      if (index === r.pits) {
        if (side === owner) { stores[owner]++; stones--; if (!stones) endedStore = true; }
        side = 1 - side; index = 0; continue;
      }
      pits[side][index]++; stones--;
      if (!stones && r.capture && side === owner && pits[side][index] === 1) {
        const opposite = r.pits - 1 - index;
        if (pits[1 - side][opposite]) {
          stores[owner] += pits[1 - side][opposite] + 1;
          pits[side][index] = pits[1 - side][opposite] = 0;
        }
      }
      index++;
    }
    let turn = r.bonusTurn && endedStore ? s.turn : other(s.turn);
    let result: GameResult | null = null;
    if (pits[0].every(v => !v) || pits[1].every(v => !v)) {
      stores[0] += pits[0].reduce((a, v) => a + v, 0);
      stores[1] += pits[1].reduce((a, v) => a + v, 0);
      pits[0].fill(0); pits[1].fill(0);
      result = { winner: stores[0] === stores[1] ? 0 : stores[0] > stores[1] ? 1 : 2, reason: `${stores[0]}–${stores[1]} stones` };
      turn = other(s.turn);
    }
    return { pits, stores, turn, result, moveNumber: s.moveNumber + 1, lastMove: { pit } };
  },
  notation: m => `Pit ${m + 1}`,
  evaluate: (s, p) => {
    if (s.result) return s.result.winner === p ? 100000 : s.result.winner === 0 ? 0 : -100000;
    return (s.stores[p - 1] - s.stores[other(p) - 1]) * 10 +
      s.pits[p - 1].reduce((a, v) => a + v, 0) - s.pits[other(p) - 1].reduce((a, v) => a + v, 0);
  },
  serialize: json, deserialize: parse,
  rulesSummary: r => `${r.pits} pits · ${r.stones} stones · ${r.capture ? "captures" : "no captures"}`
};

export interface DotsRules { rows: number; cols: number; extraTurn: boolean }
export interface EdgeMove { orientation: "h" | "v"; row: number; col: number }
export interface DotsState extends BaseState {
  h: boolean[][]; v: boolean[][]; boxes: number[][];
  scores: [number, number]; lastMove?: EdgeMove;
}
const edgeKey = (m: EdgeMove) => `${m.orientation}${m.row}-${m.col}`;
function completedBoxes(s: DotsState, move: EdgeMove): CellMove[] {
  const boxes: CellMove[] = [];
  const candidates = move.orientation === "h"
    ? [{ row: move.row - 1, col: move.col }, { row: move.row, col: move.col }]
    : [{ row: move.row, col: move.col - 1 }, { row: move.row, col: move.col }];
  for (const { row, col } of candidates) {
    if (s.boxes[row]?.[col] === 0 && s.h[row]?.[col] && s.h[row + 1]?.[col] && s.v[row]?.[col] && s.v[row]?.[col + 1])
      boxes.push({ row, col });
  }
  return boxes;
}
export const dots: GameAdapter<DotsState, EdgeMove, DotsRules> = {
  id: "dots", name: "Dots & Boxes",
  description: "Close the squares. Claim the room.", accent: "#8f78bb",
  defaultRules: { rows: 4, cols: 4, extraTurn: true },
  validateRules: r => [
    ...(!inRange(r.rows, 2, 8) ? ["Rows must be 2-8."] : []),
    ...(!inRange(r.cols, 2, 8) ? ["Columns must be 2-8."] : [])
  ],
  create: r => ({
    h: Array.from({ length: r.rows + 1 }, () => Array(r.cols).fill(false)),
    v: Array.from({ length: r.rows }, () => Array(r.cols + 1).fill(false)),
    boxes: Array.from({ length: r.rows }, () => Array(r.cols).fill(0)),
    scores: [0, 0], turn: 1, result: null, moveNumber: 0
  }),
  legalMoves: s => {
    if (s.result) return [];
    const moves: EdgeMove[] = [];
    s.h.forEach((row, r) => row.forEach((on, c) => { if (!on) moves.push({ orientation: "h", row: r, col: c }); }));
    s.v.forEach((row, r) => row.forEach((on, c) => { if (!on) moves.push({ orientation: "v", row: r, col: c }); }));
    return moves;
  },
  applyMove: (s, move, r) => {
    if (!dots.legalMoves(s, r).some(m => edgeKey(m) === edgeKey(move))) return s;
    const next: DotsState = {
      ...s, h: s.h.map(x => [...x]), v: s.v.map(x => [...x]),
      boxes: s.boxes.map(x => [...x]), scores: [...s.scores],
      moveNumber: s.moveNumber + 1, lastMove: move
    };
    next[move.orientation][move.row][move.col] = true;
    const made = completedBoxes(next, move);
    made.forEach(({ row, col }) => { next.boxes[row][col] = s.turn; next.scores[s.turn - 1]++; });
    next.turn = made.length && r.extraTurn ? s.turn : other(s.turn);
    if (!dots.legalMoves(next, r).length) {
      next.result = { winner: next.scores[0] === next.scores[1] ? 0 : next.scores[0] > next.scores[1] ? 1 : 2, reason: `${next.scores[0]}–${next.scores[1]} boxes` };
    }
    return next;
  },
  notation: edgeKey,
  evaluate: (s, p) => {
    if (s.result) return s.result.winner === p ? 100000 : s.result.winner === 0 ? 0 : -100000;
    return (s.scores[p - 1] - s.scores[other(p) - 1]) * 20;
  },
  serialize: json, deserialize: parse,
  rulesSummary: r => `${r.cols}×${r.rows} boxes · ${r.extraTurn ? "box earns another turn" : "alternating turns"}`
};

export interface CheckersRules {
  mandatoryCapture: boolean; maximumCapture: boolean; promoteDuringCapture: boolean;
}
export interface CheckerMove { from: CellMove; to: CellMove; captures: CellMove[] }
export interface CheckersState extends BaseState {
  board: number[][]; chainFrom?: CellMove; lastMove?: CheckerMove;
}
const pieceOwner = (v: number): Player | 0 => v ? (Math.abs(v) as Player) : 0;
function checkerJumps(s: CheckersState, from: CellMove, p: Player): CheckerMove[] {
  const piece = s.board[from.row]?.[from.col] || 0;
  if (pieceOwner(piece) !== p) return [];
  const drs = piece < 0 ? [-1, 1] : [p === 1 ? -1 : 1];
  const out: CheckerMove[] = [];
  drs.forEach(dr => [-1, 1].forEach(dc => {
    const mid = { row: from.row + dr, col: from.col + dc };
    const to = { row: from.row + dr * 2, col: from.col + dc * 2 };
    if (s.board[to.row]?.[to.col] === 0 && pieceOwner(s.board[mid.row]?.[mid.col] || 0) === other(p))
      out.push({ from, to, captures: [mid] });
  }));
  return out;
}
function checkerJumpDepth(s: CheckersState, move: CheckerMove, p: Player, rules: CheckersRules): number {
  const board = s.board.map(row => [...row]);
  let piece = board[move.from.row][move.from.col];
  board[move.from.row][move.from.col] = 0;
  move.captures.forEach(x => board[x.row][x.col] = 0);
  const reachesCrown = move.to.row === (p === 1 ? 0 : 7);
  if (reachesCrown && rules.promoteDuringCapture) piece = -p;
  board[move.to.row][move.to.col] = piece;
  if (reachesCrown && !rules.promoteDuringCapture) return 1;
  const next = { ...s, board };
  const following = checkerJumps(next, move.to, p);
  return 1 + (following.length ? Math.max(...following.map(x => checkerJumpDepth(next, x, p, rules))) : 0);
}
function checkerMoves(s: CheckersState, rules: CheckersRules): CheckerMove[] {
  if (s.result) return [];
  const pieces: CellMove[] = [];
  s.board.forEach((row, r) => row.forEach((v, c) => {
    if (pieceOwner(v) === s.turn && (!s.chainFrom || (s.chainFrom.row === r && s.chainFrom.col === c))) pieces.push({ row: r, col: c });
  }));
  let jumps = pieces.flatMap(x => checkerJumps(s, x, s.turn));
  if (rules.maximumCapture && jumps.length > 1) {
    const depths = jumps.map(move => checkerJumpDepth(s, move, s.turn, rules));
    const maximum = Math.max(...depths);
    jumps = jumps.filter((_, index) => depths[index] === maximum);
  }
  if (jumps.length && (rules.mandatoryCapture || s.chainFrom)) return jumps;
  const slides: CheckerMove[] = [];
  if (!s.chainFrom) pieces.forEach(from => {
    const piece = s.board[from.row][from.col];
    const drs = piece < 0 ? [-1, 1] : [s.turn === 1 ? -1 : 1];
    drs.forEach(dr => [-1, 1].forEach(dc => {
      const to = { row: from.row + dr, col: from.col + dc };
      if (s.board[to.row]?.[to.col] === 0) slides.push({ from, to, captures: [] });
    }));
  });
  return rules.mandatoryCapture && jumps.length ? jumps : [...jumps, ...slides];
}
export const checkers: GameAdapter<CheckersState, CheckerMove, CheckersRules> = {
  id: "checkers", name: "Checkers",
  description: "Advance boldly. Crown carefully.", accent: "#d56152",
  defaultRules: { mandatoryCapture: true, maximumCapture: false, promoteDuringCapture: false },
  validateRules: () => [],
  create: () => {
    const board = Array.from({ length: 8 }, () => Array(8).fill(0));
    for (let r = 0; r < 3; r++) for (let c = 0; c < 8; c++) if ((r + c) % 2) board[r][c] = 2;
    for (let r = 5; r < 8; r++) for (let c = 0; c < 8; c++) if ((r + c) % 2) board[r][c] = 1;
    return { board, turn: 1, result: null, moveNumber: 0 };
  },
  legalMoves: checkerMoves,
  applyMove: (s, move, rules) => {
    const legal = checkerMoves(s, rules).find(m => json(m) === json(move));
    if (!legal) return s;
    const board = s.board.map(r => [...r]);
    let piece = board[move.from.row][move.from.col];
    board[move.from.row][move.from.col] = 0;
    move.captures.forEach(x => board[x.row][x.col] = 0);
    const promotionRow = s.turn === 1 ? 0 : 7;
    const reachesCrown = move.to.row === promotionRow;
    if (reachesCrown && (!move.captures.length || rules.promoteDuringCapture)) piece = -s.turn;
    board[move.to.row][move.to.col] = piece;
    const interim: CheckersState = { board, turn: s.turn, result: null, moveNumber: s.moveNumber + 1, lastMove: move };
    const more = move.captures.length ? checkerJumps(interim, move.to, s.turn) : [];
    if (more.length && (!reachesCrown || rules.promoteDuringCapture)) {
      interim.chainFrom = move.to;
      return interim;
    }
    if (reachesCrown) board[move.to.row][move.to.col] = -s.turn;
    interim.turn = other(s.turn);
    const opponentPieces = board.flat().filter(v => pieceOwner(v) === interim.turn).length;
    if (!opponentPieces || !checkerMoves(interim, rules).length)
      interim.result = { winner: s.turn, reason: opponentPieces ? "No legal moves" : "All pieces captured" };
    return interim;
  },
  notation: m => `${String.fromCharCode(65 + m.from.col)}${8 - m.from.row}${m.captures.length ? "×" : "–"}${String.fromCharCode(65 + m.to.col)}${8 - m.to.row}`,
  evaluate: (s, p) => {
    if (s.result) return s.result.winner === p ? 100000 : -100000;
    return s.board.flat().reduce((a, v) => a + (pieceOwner(v) === p ? (v < 0 ? 5 : 3) : pieceOwner(v) ? (v < 0 ? -5 : -3) : 0), 0);
  },
  serialize: json, deserialize: parse,
  rulesSummary: r => `${r.mandatoryCapture ? "forced captures" : "optional captures"} · ${r.promoteDuringCapture ? "crown mid-turn" : "crown after turn"}`
};

export interface ChessRules { variant: "standard" | "chess960"; promotion: "auto" | "manual" }
export interface ChessMove { from: Square; to: Square; promotion?: string }
export interface ChessState extends BaseState { fen: string; lastMove?: ChessMove }
function chessFrom(s: ChessState) { return new Chess(s.fen); }
function chess960Fen(): string {
  // A legal nonstandard Chess960 seed with library-compatible castling files.
  return "rbbqknnr/pppppppp/8/8/8/8/PPPPPPPP/RBBQKNNR w KQkq - 0 1";
}
export const chess: GameAdapter<ChessState, ChessMove, ChessRules> = {
  id: "chess", name: "Chess",
  description: "A quiet room for a deep contest.", accent: "#7387a8",
  defaultRules: { variant: "standard", promotion: "auto" },
  validateRules: r => ["standard", "chess960"].includes(r.variant) ? [] : ["Unknown chess variant."],
  create: r => ({ fen: r.variant === "chess960" ? chess960Fen() : new Chess().fen(), turn: 1, result: null, moveNumber: 0 }),
  legalMoves: s => {
    if (s.result) return [];
    const game = chessFrom(s);
    return game.moves({ verbose: true }).map((m: ChessJsMove) => ({ from: m.from, to: m.to, promotion: m.promotion }));
  },
  applyMove: (s, move) => {
    const game = chessFrom(s);
    try { game.move({ ...move, promotion: move.promotion || "q" }); } catch { return s; }
    let result: GameResult | null = null;
    if (game.isGameOver()) {
      result = game.isCheckmate()
        ? { winner: s.turn, reason: "Checkmate" }
        : { winner: 0, reason: game.isStalemate() ? "Stalemate" : "Draw" };
    }
    return { fen: game.fen(), turn: other(s.turn), result, moveNumber: s.moveNumber + 1, lastMove: move };
  },
  notation: (move, s) => {
    try { return chessFrom(s).move({ ...move, promotion: move.promotion || "q" }).san; } catch { return `${move.from}-${move.to}`; }
  },
  evaluate: (s, p) => {
    if (s.result) return s.result.winner === p ? 100000 : s.result.winner === 0 ? 0 : -100000;
    const values: Record<string, number> = { p: 1, n: 3, b: 3.2, r: 5, q: 9, k: 0 };
    return chessFrom(s).board().flat().reduce((a, x) => x ? a + values[x.type] * ((x.color === "w") === (p === 1) ? 1 : -1) : a, 0);
  },
  serialize: json, deserialize: parse,
  rulesSummary: r => `${r.variant === "chess960" ? "Chess960" : "standard"} · ${r.promotion} promotion`
};

export interface PlacementRules { size: number; target: number }
export interface PlacementState extends BaseState {
  board: number[][];
  lastMove?: CellMove;
}

function placementAdapter(
  id: "tictactoe" | "gomoku",
  name: string,
  description: string,
  accent: string,
  defaults: PlacementRules,
  sizeRange: [number, number],
  targetRange: [number, number]
): GameAdapter<PlacementState, CellMove, PlacementRules> {
  return {
    id, name, description, accent, defaultRules: defaults,
    validateRules: r => [
      ...(!inRange(r.size, ...sizeRange) ? [`Board size must be ${sizeRange[0]}-${sizeRange[1]}.`] : []),
      ...(!inRange(r.target, ...targetRange) || r.target > r.size ? [`Target must be ${targetRange[0]}-${targetRange[1]} and fit the board.`] : [])
    ],
    create: r => ({
      board: Array.from({ length: r.size }, () => Array(r.size).fill(0)),
      turn: 1, result: null, moveNumber: 0
    }),
    legalMoves: s => {
      if (s.result) return [];
      const moves: CellMove[] = [];
      s.board.forEach((row, r) => row.forEach((cell, c) => { if (!cell) moves.push({ row: r, col: c }); }));
      return moves;
    },
    applyMove: (s, move, r) => {
      if (s.board[move.row]?.[move.col] !== 0 || s.result) return s;
      const board = s.board.map(row => [...row]);
      board[move.row][move.col] = s.turn;
      const winner = lineWinner(board, r.target);
      const full = board.every(row => row.every(Boolean));
      return {
        board, turn: other(s.turn), moveNumber: s.moveNumber + 1, lastMove: move,
        result: winner ? { winner, reason: `${r.target} in a row` } : full ? { winner: 0, reason: "Board full" } : null
      };
    },
    notation: m => `${String.fromCharCode(65 + m.col)}${m.row + 1}`,
    evaluate: (s, p, r) => {
      if (s.result) return s.result.winner === p ? 100000 : s.result.winner === 0 ? 0 : -100000;
      const center = (r.size - 1) / 2;
      let score = 0;
      s.board.forEach((row, rr) => row.forEach((cell, cc) => {
        if (cell) score += (cell === p ? 1 : -1) * (r.size - (Math.abs(rr - center) + Math.abs(cc - center)) / 2);
      }));
      const directions = [[0, 1], [1, 0], [1, 1], [1, -1]];
      for (let row = 0; row < r.size; row++) for (let col = 0; col < r.size; col++) {
        for (const [dr, dc] of directions) {
          const cells = Array.from({ length: r.target }, (_, i) => s.board[row + dr * i]?.[col + dc * i]);
          if (cells.some(value => value === undefined)) continue;
          const mine = cells.filter(value => value === p).length;
          const theirs = cells.filter(value => value === other(p)).length;
          if (!theirs && mine) score += Math.pow(7, mine);
          if (!mine && theirs) score -= Math.pow(8, theirs);
        }
      }
      return score;
    },
    serialize: json, deserialize: parse,
    rulesSummary: r => `${r.size}×${r.size} board · ${r.target} in a row`
  };
}

export const tictactoe = placementAdapter(
  "tictactoe", "Tic-Tac-Toe", "Small board, surprisingly sharp choices.", "#be6f8c",
  { size: 3, target: 3 }, [3, 5], [3, 4]
);
export const gomoku = placementAdapter(
  "gomoku", "Gomoku", "Build an unbroken line of five stones.", "#637c56",
  { size: 15, target: 5 }, [9, 15], [4, 5]
);

export interface GoRules { size: 5 | 7 | 9; komi: number }
export type GoMove = CellMove | { pass: true };
export interface GoState extends BaseState {
  board: number[][];
  captures: [number, number];
  previousHash: string | null;
  consecutivePasses: number;
  lastMove?: GoMove;
}
const orthogonal = [[-1, 0], [1, 0], [0, -1], [0, 1]];
function boardHash(board: number[][]) { return board.map(row => row.join("")).join("/"); }
function groupAt(board: number[][], row: number, col: number) {
  const color = board[row]?.[col];
  const stones: CellMove[] = [];
  const liberties = new Set<string>();
  const seen = new Set<string>();
  const stack = [{ row, col }];
  while (stack.length) {
    const point = stack.pop()!;
    const key = `${point.row}-${point.col}`;
    if (seen.has(key)) continue;
    seen.add(key); stones.push(point);
    for (const [dr, dc] of orthogonal) {
      const rr = point.row + dr, cc = point.col + dc;
      if (board[rr]?.[cc] === 0) liberties.add(`${rr}-${cc}`);
      else if (board[rr]?.[cc] === color && !seen.has(`${rr}-${cc}`)) stack.push({ row: rr, col: cc });
    }
  }
  return { stones, liberties: liberties.size };
}
function applyGoPlacement(s: GoState, move: CellMove): { board: number[][]; captured: number } | null {
  if (s.board[move.row]?.[move.col] !== 0) return null;
  const board = s.board.map(row => [...row]);
  board[move.row][move.col] = s.turn;
  let captured = 0;
  for (const [dr, dc] of orthogonal) {
    const rr = move.row + dr, cc = move.col + dc;
    if (board[rr]?.[cc] === other(s.turn)) {
      const group = groupAt(board, rr, cc);
      if (!group.liberties) {
        captured += group.stones.length;
        group.stones.forEach(point => board[point.row][point.col] = 0);
      }
    }
  }
  if (!groupAt(board, move.row, move.col).liberties || boardHash(board) === s.previousHash) return null;
  return { board, captured };
}
function goScore(s: GoState, rules: GoRules): [number, number] {
  const score: [number, number] = [s.captures[0], s.captures[1] + rules.komi];
  const visited = new Set<string>();
  s.board.forEach((row, r) => row.forEach((cell, c) => {
    if (cell) score[cell - 1]++;
    else if (!visited.has(`${r}-${c}`)) {
      const area: CellMove[] = [], borders = new Set<number>(), borderStones = new Set<string>(), stack = [{ row: r, col: c }];
      while (stack.length) {
        const point = stack.pop()!, key = `${point.row}-${point.col}`;
        if (visited.has(key)) continue;
        visited.add(key); area.push(point);
        orthogonal.forEach(([dr, dc]) => {
          const rr = point.row + dr, cc = point.col + dc, value = s.board[rr]?.[cc];
          if (value === 0 && !visited.has(`${rr}-${cc}`)) stack.push({ row: rr, col: cc });
          else if (value) { borders.add(value); borderStones.add(`${rr}-${cc}`); }
        });
      }
      if (borders.size === 1 && borderStones.size >= 2) score[[...borders][0] - 1] += area.length;
    }
  }));
  return score;
}
export const go: GameAdapter<GoState, GoMove, GoRules> = {
  id: "go", name: "Go", description: "Surround territory and capture living groups.", accent: "#9c7548",
  defaultRules: { size: 9, komi: 6.5 },
  validateRules: r => [5, 7, 9].includes(r.size) && r.komi >= 0 && r.komi <= 10 ? [] : ["Use a 5×5, 7×7, or 9×9 board and komi from 0-10."],
  create: r => ({ board: Array.from({ length: r.size }, () => Array(r.size).fill(0)), captures: [0, 0], previousHash: null, consecutivePasses: 0, turn: 1, result: null, moveNumber: 0 }),
  legalMoves: s => {
    if (s.result) return [];
    const moves: GoMove[] = [{ pass: true }];
    s.board.forEach((row, r) => row.forEach((cell, c) => { if (!cell && applyGoPlacement(s, { row: r, col: c })) moves.push({ row: r, col: c }); }));
    return moves;
  },
  applyMove: (s, move, rules) => {
    if ("pass" in move) {
      const next: GoState = { ...s, turn: other(s.turn), consecutivePasses: s.consecutivePasses + 1, moveNumber: s.moveNumber + 1, lastMove: move };
      if (next.consecutivePasses >= 2) {
        const score = goScore(next, rules);
        next.result = { winner: score[0] === score[1] ? 0 : score[0] > score[1] ? 1 : 2, reason: `${score[0]}–${score[1]} territory` };
      }
      return next;
    }
    const placed = applyGoPlacement(s, move);
    if (!placed) return s;
    const captures: [number, number] = [...s.captures];
    captures[s.turn - 1] += placed.captured;
    return { ...s, board: placed.board, captures, previousHash: boardHash(s.board), consecutivePasses: 0, turn: other(s.turn), moveNumber: s.moveNumber + 1, lastMove: move };
  },
  notation: m => "pass" in m ? "Pass" : `${String.fromCharCode(65 + m.col)}${m.row + 1}`,
  evaluate: (s, p, r) => {
    if (s.result) return s.result.winner === p ? 100000 : s.result.winner === 0 ? 0 : -100000;
    const score = goScore(s, r);
    let liberties = 0;
    const seen = new Set<string>();
    s.board.forEach((row, rr) => row.forEach((cell, cc) => {
      if (!cell || seen.has(`${rr}-${cc}`)) return;
      const group = groupAt(s.board, rr, cc);
      group.stones.forEach(point => seen.add(`${point.row}-${point.col}`));
      liberties += (cell === p ? 1 : -1) * Math.min(group.liberties, 5);
    }));
    return (score[p - 1] - score[other(p) - 1]) * 8 + liberties * 2;
  },
  serialize: json, deserialize: parse, rulesSummary: r => `${r.size}×${r.size} board · ${r.komi} komi`
};

export interface HexRules { size: number }
export interface HexState extends BaseState { board: number[][]; lastMove?: CellMove }
function hexConnected(board: number[][], player: Player): boolean {
  const size = board.length, seen = new Set<string>(), stack: CellMove[] = [];
  if (player === 1) for (let c = 0; c < size; c++) if (board[0][c] === player) stack.push({ row: 0, col: c });
  else for (let r = 0; r < size; r++) if (board[r][0] === player) stack.push({ row: r, col: 0 });
  const dirs = [[-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0]];
  while (stack.length) {
    const point = stack.pop()!, key = `${point.row}-${point.col}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if ((player === 1 && point.row === size - 1) || (player === 2 && point.col === size - 1)) return true;
    dirs.forEach(([dr, dc]) => {
      const rr = point.row + dr, cc = point.col + dc;
      if (board[rr]?.[cc] === player && !seen.has(`${rr}-${cc}`)) stack.push({ row: rr, col: cc });
    });
  }
  return false;
}
function hexDistance(board: number[][], player: Player): number {
  const size = board.length;
  const distance = Array.from({ length: size }, () => Array(size).fill(Infinity));
  const queue: CellMove[] = [];
  const addStart = (row: number, col: number) => {
    if (board[row][col] === other(player)) return;
    distance[row][col] = board[row][col] === player ? 0 : 1;
    queue.push({ row, col });
  };
  if (player === 1) for (let col = 0; col < size; col++) addStart(0, col);
  else for (let row = 0; row < size; row++) addStart(row, 0);
  const dirs = [[-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0]];
  while (queue.length) {
    queue.sort((a, b) => distance[a.row][a.col] - distance[b.row][b.col]);
    const point = queue.shift()!;
    for (const [dr, dc] of dirs) {
      const row = point.row + dr, col = point.col + dc;
      if (board[row]?.[col] === undefined || board[row][col] === other(player)) continue;
      const candidate = distance[point.row][point.col] + (board[row][col] === player ? 0 : 1);
      if (candidate < distance[row][col]) {
        distance[row][col] = candidate;
        queue.push({ row, col });
      }
    }
  }
  const finishes = player === 1 ? distance[size - 1] : distance.map(row => row[size - 1]);
  return Math.min(...finishes);
}
export const hex: GameAdapter<HexState, CellMove, HexRules> = {
  id: "hex", name: "Hex", description: "Connect your two sides across a field of hexes.", accent: "#4f8d9d",
  defaultRules: { size: 9 },
  validateRules: r => inRange(r.size, 5, 11) ? [] : ["Board size must be 5-11."],
  create: r => ({ board: Array.from({ length: r.size }, () => Array(r.size).fill(0)), turn: 1, result: null, moveNumber: 0 }),
  legalMoves: s => s.result ? [] : s.board.flatMap((row, r) => row.flatMap((cell, c) => cell ? [] : [{ row: r, col: c }])),
  applyMove: (s, move) => {
    if (s.board[move.row]?.[move.col] !== 0 || s.result) return s;
    const board = s.board.map(row => [...row]); board[move.row][move.col] = s.turn;
    return { board, turn: other(s.turn), moveNumber: s.moveNumber + 1, lastMove: move, result: hexConnected(board, s.turn) ? { winner: s.turn, reason: "Connected both sides" } : null };
  },
  notation: m => `${String.fromCharCode(65 + m.col)}${m.row + 1}`,
  evaluate: (s, p) => {
    if (s.result) return s.result.winner === p ? 100000 : -100000;
    return (hexDistance(s.board, other(p)) - hexDistance(s.board, p)) * 25;
  },
  serialize: json, deserialize: parse, rulesSummary: r => `${r.size}×${r.size} board`
};

export interface NimRules { heaps: number; maxHeap: number }
export interface NimMove { heap: number; count: number }
export interface NimState extends BaseState { heaps: number[]; lastMove?: NimMove }
export const nim: GameAdapter<NimState, NimMove, NimRules> = {
  id: "nim", name: "Nim", description: "Take stones, shape the binary balance, leave the last.", accent: "#b28c36",
  defaultRules: { heaps: 4, maxHeap: 7 },
  validateRules: r => inRange(r.heaps, 3, 7) && inRange(r.maxHeap, r.heaps, 15) ? [] : ["Use 3-7 heaps and a largest heap between the heap count and 15."],
  create: r => ({ heaps: Array.from({ length: r.heaps }, (_, i) => Math.max(1, r.maxHeap - r.heaps + 1 + i)), turn: 1, result: null, moveNumber: 0 }),
  legalMoves: s => s.result ? [] : s.heaps.flatMap((heap, h) => Array.from({ length: heap }, (_, i) => ({ heap: h, count: i + 1 }))),
  applyMove: (s, move) => {
    if (move.count < 1 || move.count > (s.heaps[move.heap] || 0)) return s;
    const heaps = [...s.heaps]; heaps[move.heap] -= move.count;
    const done = heaps.every(x => x === 0);
    return { heaps, turn: other(s.turn), result: done ? { winner: s.turn, reason: "Took the last stone" } : null, moveNumber: s.moveNumber + 1, lastMove: move };
  },
  notation: m => `Heap ${m.heap + 1}: −${m.count}`,
  evaluate: (s, p) => {
    if (s.result) return s.result.winner === p ? 100000 : -100000;
    const xor = s.heaps.reduce((a, h) => a ^ h, 0);
    return (xor !== 0) === (s.turn === p) ? 500 : -500;
  },
  serialize: json, deserialize: parse, rulesSummary: r => `${r.heaps} heaps · largest starts at ${r.maxHeap}`
};

export interface BreakthroughRules { size: 6 | 8 }
export interface BreakthroughState extends BaseState { board: number[][]; lastMove?: CheckerMove }
function breakthroughMoves(s: BreakthroughState): CheckerMove[] {
  if (s.result) return [];
  const moves: CheckerMove[] = [], dr = s.turn === 1 ? -1 : 1;
  s.board.forEach((row, r) => row.forEach((piece, c) => {
    if (piece !== s.turn) return;
    if (s.board[r + dr]?.[c] === 0) moves.push({ from: { row: r, col: c }, to: { row: r + dr, col: c }, captures: [] });
    [-1, 1].forEach(dc => {
      const target = s.board[r + dr]?.[c + dc];
      if (target !== undefined && target !== s.turn) moves.push({ from: { row: r, col: c }, to: { row: r + dr, col: c + dc }, captures: target ? [{ row: r + dr, col: c + dc }] : [] });
    });
  }));
  return moves;
}
export const breakthrough: GameAdapter<BreakthroughState, CheckerMove, BreakthroughRules> = {
  id: "breakthrough", name: "Breakthrough", description: "Race a pawn through the opposing line.", accent: "#7d5d9e",
  defaultRules: { size: 8 },
  validateRules: r => [6, 8].includes(r.size) ? [] : ["Board must be 6×6 or 8×8."],
  create: r => {
    const board = Array.from({ length: r.size }, () => Array(r.size).fill(0));
    for (let row = 0; row < 2; row++) board[row].fill(2);
    for (let row = r.size - 2; row < r.size; row++) board[row].fill(1);
    return { board, turn: 1, result: null, moveNumber: 0 };
  },
  legalMoves: breakthroughMoves,
  applyMove: (s, move) => {
    if (!breakthroughMoves(s).some(candidate => json(candidate) === json(move))) return s;
    const board = s.board.map(row => [...row]); board[move.from.row][move.from.col] = 0; board[move.to.row][move.to.col] = s.turn;
    const reached = move.to.row === (s.turn === 1 ? 0 : board.length - 1);
    const next: BreakthroughState = { board, turn: other(s.turn), result: reached ? { winner: s.turn, reason: "Reached the far rank" } : null, moveNumber: s.moveNumber + 1, lastMove: move };
    if (!next.result && !breakthroughMoves(next).length) next.result = { winner: s.turn, reason: "Opponent has no moves" };
    return next;
  },
  notation: m => `${String.fromCharCode(65 + m.from.col)}${m.from.row + 1}–${String.fromCharCode(65 + m.to.col)}${m.to.row + 1}`,
  evaluate: (s, p) => {
    if (s.result) return s.result.winner === p ? 100000 : -100000;
    return s.board.flatMap((row, r) => row.map(piece => piece === p ? 10 + (p === 1 ? s.board.length - r : r) : piece ? -10 - (p === 1 ? r : s.board.length - r) : 0)).reduce((a, v) => a + v, 0);
  },
  serialize: json, deserialize: parse, rulesSummary: r => `${r.size}×${r.size} board`
};

export const adapters: Record<GameId, AnyAdapter> = {
  connect4, mancala, reversi, chess, checkers, dots, tictactoe, gomoku, go, hex, nim, breakthrough
};

export const gameOrder: GameId[] = ["connect4", "mancala", "reversi", "chess", "checkers", "dots", "tictactoe", "gomoku", "go", "hex", "nim", "breakthrough"];
