import { describe, expect, it } from "vitest";
import { adapters, breakthrough, checkers, connect4, dots, go, gomoku, hex, mancala, nim, reversi, tictactoe } from "./games";
import { applyOnlineMove, createInitialRoom, playerForUid } from "./onlineShared";
import { createSession, goBack, playMove } from "./session";

describe("rule validation", () => {
  it("accepts every standard ruleset", () => {
    Object.values(adapters).forEach(adapter =>
      expect(adapter.validateRules(adapter.defaultRules)).toEqual([])
    );
  });

  it("rejects unsupported board sizes", () => {
    expect(connect4.validateRules({ rows: 3, cols: 7, target: 4 })).not.toHaveLength(0);
    expect(reversi.validateRules({ size: 7 as 8 })).not.toHaveLength(0);
    expect(dots.validateRules({ rows: 9, cols: 4, extraTurn: true })).not.toHaveLength(0);
  });
});

describe("game engines", () => {
  it("wins a connect game", () => {
    const rules = connect4.defaultRules;
    let state = connect4.create(rules);
    [0, 1, 0, 1, 0, 1, 0].forEach(move => state = connect4.applyMove(state, move, rules));
    expect(state.result?.winner).toBe(1);
  });

  it("flips discs in Reversi", () => {
    const rules = reversi.defaultRules;
    const state = reversi.create(rules);
    const move = reversi.legalMoves(state, rules)[0];
    const next = reversi.applyMove(state, move, rules);
    expect(next.board.flat().filter(x => x === 1)).toHaveLength(4);
  });

  it("sows every Mancala stone", () => {
    const rules = mancala.defaultRules;
    const state = mancala.create(rules);
    const total = state.pits.flat().reduce((a, v) => a + v, 0);
    const next = mancala.applyMove(state, 0, rules);
    expect(next.pits.flat().reduce((a, v) => a + v, 0) + next.stores[0] + next.stores[1]).toBe(total);
  });

  it("requires captures in standard checkers", () => {
    const rules = checkers.defaultRules;
    const state = checkers.create(rules);
    state.board = Array.from({ length: 8 }, () => Array(8).fill(0));
    state.board[5][0] = 1;
    state.board[4][1] = 2;
    expect(checkers.legalMoves(state, rules)).toEqual([{ from: { row: 5, col: 0 }, to: { row: 3, col: 2 }, captures: [{ row: 4, col: 1 }] }]);
  });

  it("claims a completed box", () => {
    const rules = { rows: 2, cols: 2, extraTurn: true };
    let state = dots.create(rules);
    [
      { orientation: "h", row: 0, col: 0 },
      { orientation: "v", row: 0, col: 0 },
      { orientation: "h", row: 1, col: 0 },
      { orientation: "v", row: 0, col: 1 }
    ].forEach(move => state = dots.applyMove(state, move as any, rules));
    expect(state.scores[1]).toBe(1);
  });

  it("wins Tic-Tac-Toe across a row", () => {
    const rules = tictactoe.defaultRules;
    let state = tictactoe.create(rules);
    [
      { row: 0, col: 0 }, { row: 1, col: 0 },
      { row: 0, col: 1 }, { row: 1, col: 1 },
      { row: 0, col: 2 }
    ].forEach(move => state = tictactoe.applyMove(state, move, rules));
    expect(state.result?.winner).toBe(1);
  });

  it("supports a configurable Gomoku board", () => {
    const rules = { size: 9, target: 4 };
    const state = gomoku.create(rules);
    expect(state.board).toHaveLength(9);
    expect(gomoku.legalMoves(state, rules)).toHaveLength(81);
  });

  it("captures a surrounded stone in Go", () => {
    const rules = { size: 5 as const, komi: 0 };
    let state = go.create(rules);
    const sequence = [
      { row: 0, col: 1 }, { row: 1, col: 1 },
      { row: 1, col: 0 }, { row: 4, col: 4 },
      { row: 1, col: 2 }, { row: 4, col: 3 },
      { row: 2, col: 1 }
    ];
    sequence.forEach(move => state = go.applyMove(state, move, rules));
    expect(state.board[1][1]).toBe(0);
    expect(state.captures[0]).toBe(1);
  });

  it("detects a completed Hex connection", () => {
    const rules = { size: 5 };
    let state = hex.create(rules);
    for (let row = 0; row < 5; row++) {
      state.board[row][0] = 1;
    }
    state = hex.applyMove({ ...state, board: state.board.map(row => [...row]), turn: 1 }, { row: 4, col: 1 }, rules);
    expect(state.result?.winner).toBe(1);
  });

  it("recognizes the final Nim move", () => {
    const rules = nim.defaultRules;
    const state = { ...nim.create(rules), heaps: [0, 0, 0, 1] };
    expect(nim.applyMove(state, { heap: 3, count: 1 }, rules).result?.winner).toBe(1);
  });

  it("wins Breakthrough on the far rank", () => {
    const rules = { size: 6 as const };
    const state = breakthrough.create(rules);
    state.board = Array.from({ length: 6 }, () => Array(6).fill(0));
    state.board[1][2] = 1;
    const move = breakthrough.legalMoves(state, rules).find(candidate => candidate.to.row === 0)!;
    expect(breakthrough.applyMove(state, move, rules).result?.winner).toBe(1);
  });
});

describe("branching history", () => {
  it("preserves alternate moves", () => {
    let session = createSession("connect4", connect4.defaultRules);
    session = playMove(session, 0);
    session = goBack(session);
    session = playMove(session, 1);
    expect(session.nodes[session.rootId].children).toHaveLength(2);
  });
});

describe("online room validation", () => {
  it("accepts a legal online move and increments revision", () => {
    const room = createInitialRoom("room", "connect4", connect4.defaultRules, { uid: "one", name: "One", connected: true, lastSeen: 1 }, 1);
    room.players[2] = { uid: "two", name: "Two", connected: true, lastSeen: 1 };
    room.status = "playing";
    const next = applyOnlineMove(room, "one", 3, 0, 2);
    expect(next.revision).toBe(1);
    expect(playerForUid(next, "one")).toBe(1);
  });

  it("rejects stale revisions, wrong turns, and illegal moves", () => {
    const room = createInitialRoom("room", "connect4", connect4.defaultRules, { uid: "one", name: "One", connected: true, lastSeen: 1 }, 1);
    room.players[2] = { uid: "two", name: "Two", connected: true, lastSeen: 1 };
    room.status = "playing";
    expect(() => applyOnlineMove(room, "one", 0, 99, 2)).toThrow(/moved on/i);
    expect(() => applyOnlineMove(room, "two", 0, 0, 2)).toThrow(/not your turn/i);
    expect(() => applyOnlineMove(room, "one", 99, 0, 2)).toThrow(/Illegal move/i);
  });
});
