export type GameId =
  | "connect4"
  | "mancala"
  | "reversi"
  | "chess"
  | "checkers"
  | "dots"
  | "tictactoe"
  | "gomoku"
  | "go"
  | "hex"
  | "nim"
  | "breakthrough";

export type Player = 1 | 2;
export type PlayerKind = "human" | "ai" | "online";

export interface PlayerConfig {
  kind: PlayerKind;
  name: string;
  difficulty: number;
  minMoveMs: number;
  uid?: string;
  connected?: boolean;
}

export interface GameResult {
  winner: Player | 0 | null;
  reason: string;
}

export interface BaseState {
  turn: Player;
  result: GameResult | null;
  moveNumber: number;
  lastMove?: unknown;
}

export interface GameAdapter<S extends BaseState = BaseState, M = unknown, R = unknown> {
  id: GameId;
  name: string;
  description: string;
  accent: string;
  defaultRules: R;
  validateRules(rules: R): string[];
  create(rules: R): S;
  legalMoves(state: S, rules: R): M[];
  applyMove(state: S, move: M, rules: R): S;
  notation(move: M, state: S, rules: R): string;
  evaluate(state: S, player: Player, rules: R): number;
  serialize(state: S): string;
  deserialize(value: string): S;
  rulesSummary(rules: R): string;
}

export interface MoveNode {
  id: string;
  parentId: string | null;
  children: string[];
  move: unknown | null;
  notation: string;
  label?: string;
  snapshot: string;
  createdAt: number;
}

export interface GameSession {
  id: string;
  gameId: GameId;
  rules: unknown;
  players: Record<Player, PlayerConfig>;
  nodes: Record<string, MoveNode>;
  rootId: string;
  activeNodeId: string;
  createdAt: number;
  updatedAt: number;
  origin?: "local" | "online" | "link";
  onlineRoomId?: string;
  revision?: number;
}

export interface OnlineSeat {
  uid: string;
  name: string;
  connected: boolean;
  lastSeen: number;
}

export interface UndoRequest {
  id: string;
  requester: Player;
  targetNodeId: string;
  status: "pending" | "approved" | "declined";
  createdAt: number;
}

export interface OnlineRoom {
  id: string;
  gameId: GameId;
  rules: unknown;
  players: Partial<Record<Player, OnlineSeat>>;
  nodes: Record<string, MoveNode>;
  rootId: string;
  activeNodeId: string;
  revision: number;
  status: "waiting" | "playing" | "completed" | "resigned" | "closed";
  result: GameResult | null;
  undoRequest?: UndoRequest | null;
  rematchRequestedBy?: Player | null;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
}

export interface OnlineCommandResult {
  roomId: string;
  room: OnlineRoom;
}

export interface Preferences {
  theme: "light" | "dark";
  sound: boolean;
  flipped: boolean;
  animations: boolean;
}
