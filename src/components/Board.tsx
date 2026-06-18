import { useMemo, useState } from "react";
import { Chess, type Square } from "chess.js";
import { adapters, type CheckerMove, type ChessMove, type DotsState, type EdgeMove } from "../games";
import type { GameId, Player } from "../types";

interface Props {
  gameId: GameId;
  state: any;
  rules: any;
  disabled: boolean;
  flipped: boolean;
  animations: boolean;
  onMove: (move: unknown) => void;
}

const playerClass = (player: number) => player ? ` player-${player}` : "";
const keyOf = (x: unknown) => JSON.stringify(x);

export default function Board({ gameId, state, rules, disabled, flipped, animations, onMove }: Props) {
  const adapter = adapters[gameId];
  const legal = useMemo(() => adapter.legalMoves(state, rules), [adapter, state, rules]);
  const [selected, setSelected] = useState<{ row: number; col: number } | null>(null);

  const chooseSquareMove = (row: number, col: number) => {
    if (disabled) return;
    if (selected) {
      const match = legal.find((m: any) =>
        m.from?.row === selected.row && m.from?.col === selected.col &&
        m.to?.row === row && m.to?.col === col
      );
      if (match) { onMove(match); setSelected(null); return; }
    }
    const canStart = legal.some((m: any) => m.from?.row === row && m.from?.col === col);
    setSelected(canStart ? { row, col } : null);
  };

  const chooseChessMove = (row: number, col: number) => {
    const square = `${String.fromCharCode(97 + col)}${8 - row}` as Square;
    if (disabled) return;
    if (selected) {
      const from = `${String.fromCharCode(97 + selected.col)}${8 - selected.row}`;
      const match = legal.find((m: ChessMove) => m.from === from && m.to === square);
      if (match) {
        let move = match;
        if (match.promotion && rules.promotion === "manual") {
          const choice = window.prompt("Promote to queen, rook, bishop, or knight? Enter q, r, b, or n.", "q")?.toLowerCase();
          move = { ...match, promotion: ["q", "r", "b", "n"].includes(choice || "") ? choice : "q" };
        }
        onMove(move); setSelected(null); return;
      }
    }
    const canStart = legal.some((m: ChessMove) => m.from === square);
    setSelected(canStart ? { row, col } : null);
  };

  if (gameId === "connect4") {
    return <div className="board-shell connect-shell" aria-label="Connect board">
      <div className="connect-board" style={{ gridTemplateColumns: `repeat(${rules.cols}, 1fr)` }}>
        {state.board.flatMap((row: number[], r: number) => row.map((cell, c) =>
          <button key={`${r}-${c}`} className={`connect-cell${playerClass(cell)} ${state.lastMove?.row === r && state.lastMove?.col === c ? "last" : ""}`}
            disabled={disabled || !legal.includes(c)} onClick={() => onMove(c)} aria-label={`Column ${c + 1}`}>
            <span />
          </button>
        ))}
      </div>
    </div>;
  }

  if (gameId === "mancala") {
    const order = flipped ? [0, 1] : [1, 0];
    return <div className="board-shell mancala-board" aria-label="Mancala board">
      <div className={`store${playerClass(order[0] + 1)}`}><strong>{state.stores[order[0]]}</strong><span>Store</span></div>
      <div className="pit-field">
        {order.map(side => <div className="pit-row" key={side}>
          {(side === order[0] ? [...state.pits[side]].reverse() : state.pits[side]).map((stones: number, shown: number) => {
            const pit = side === order[0] ? rules.pits - 1 - shown : shown;
            const playable = side === state.turn - 1 && legal.includes(pit);
            return <button key={pit} className={`pit${playerClass(side + 1)} ${state.lastMove?.pit === pit && side === otherSide(state.turn - 1) ? "last" : ""}`}
              disabled={disabled || !playable} onClick={() => onMove(pit)}>
              <strong>{stones}</strong><span>Pit {pit + 1}</span>
            </button>;
          })}
        </div>)}
      </div>
      <div className={`store${playerClass(order[1] + 1)}`}><strong>{state.stores[order[1]]}</strong><span>Store</span></div>
    </div>;
  }

  if (gameId === "reversi") {
    const moves = new Set(legal.map(keyOf));
    return <GridBoard size={rules.size} flipped={flipped} className="reversi-board">
      {state.board.flatMap((row: number[], r: number) => row.map((cell, c) => {
        const move = { row: r, col: c };
        return <button key={`${r}-${c}`} className={`square ${moves.has(keyOf(move)) ? "legal" : ""} ${state.lastMove?.row === r && state.lastMove?.col === c ? "last" : ""}`}
          disabled={disabled || !moves.has(keyOf(move))} onClick={() => onMove(move)} aria-label={`${String.fromCharCode(65 + c)}${r + 1}`}>
          {cell ? <span className={`disc${playerClass(cell)} ${animations && state.lastMove?.row === r && state.lastMove?.col === c ? "move-animated" : ""}`} /> : null}
        </button>;
      }))}
    </GridBoard>;
  }

  if (gameId === "dots") {
    return <DotsBoard state={state} rules={rules} legal={legal} disabled={disabled} onMove={onMove} />;
  }

  if (gameId === "go" || gameId === "hex") {
    const coordinateMoves = legal.filter((move: any) => !("pass" in move));
    const moves = new Set(coordinateMoves.map(keyOf));
    const board = <GridBoard size={rules.size} flipped={flipped} className={`${gameId}-board`}>
      {state.board.flatMap((row: number[], r: number) => row.map((cell, c) => {
        const move = { row: r, col: c }, last = state.lastMove?.row === r && state.lastMove?.col === c;
        return <button key={`${r}-${c}`} className={`square ${moves.has(keyOf(move)) ? "placeable" : ""} ${last ? "last" : ""}`}
          disabled={disabled || !moves.has(keyOf(move))} onClick={() => onMove(move)}>
          {cell ? <span className={`placement-stone${playerClass(cell)} ${animations && last ? "move-animated" : ""}`} /> : null}
        </button>;
      }))}
    </GridBoard>;
    if (gameId === "go") return <div className="board-with-action">{board}<button className="pass-button" disabled={disabled} onClick={() => onMove({ pass: true })}>Pass turn</button></div>;
    return board;
  }

  if (gameId === "nim") {
    return <div className="board-shell nim-board">
      {state.heaps.map((heap: number, h: number) => <div className="nim-heap" key={h}>
        <div className="nim-stones">{Array.from({ length: heap }, (_, i) => <span key={i} />)}</div>
        <strong>Heap {h + 1}</strong><small>{heap} stones</small>
        <div className="nim-actions">{Array.from({ length: heap }, (_, i) => i + 1).map(count =>
          <button key={count} disabled={disabled} onClick={() => onMove({ heap: h, count })}>−{count}</button>
        )}</div>
      </div>)}
    </div>;
  }

  if (gameId === "tictactoe" || gameId === "gomoku") {
    const moves = new Set(legal.map(keyOf));
    return <GridBoard size={rules.size} flipped={flipped} className={`placement-board ${gameId}-board`}>
      {state.board.flatMap((row: number[], r: number) => row.map((cell, c) => {
        const move = { row: r, col: c };
        const last = state.lastMove?.row === r && state.lastMove?.col === c;
        return <button key={`${r}-${c}`} className={`square ${moves.has(keyOf(move)) ? "placeable" : ""} ${last ? "last" : ""}`}
          disabled={disabled || !moves.has(keyOf(move))} onClick={() => onMove(move)} aria-label={`${String.fromCharCode(65 + c)}${r + 1}`}>
          {cell ? <span className={`placement-stone${playerClass(cell)} ${animations && last ? "move-animated" : ""}`}>{gameId === "tictactoe" ? (cell === 1 ? "×" : "○") : ""}</span> : null}
        </button>;
      }))}
    </GridBoard>;
  }

  if (gameId === "checkers" || gameId === "breakthrough") {
    const selectedMoves = legal.filter((m: CheckerMove) => selected && m.from.row === selected.row && m.from.col === selected.col);
    const destinations = new Map(selectedMoves.map((m: CheckerMove) => [`${m.to.row}-${m.to.col}`, m.captures.length > 0]));
    const size = state.board.length;
    return <GridBoard size={size} flipped={flipped} className={gameId === "checkers" ? "checkers-board" : "breakthrough-board"}>
      {state.board.flatMap((row: number[], r: number) => row.map((piece, c) =>
        <button key={`${r}-${c}`} className={`square ${(r + c) % 2 ? "dark" : "light"} ${selected?.row === r && selected?.col === c ? "selected" : ""} ${destinations.has(`${r}-${c}`) ? "legal" : ""} ${destinations.get(`${r}-${c}`) ? "capture-target" : ""}`}
          disabled={disabled} onClick={() => chooseSquareMove(r, c)} aria-label={`${String.fromCharCode(65 + c)}${8 - r}`}>
          {piece ? <span className={`${gameId === "checkers" ? "checker" : "breakthrough-piece"}${playerClass(Math.abs(piece))} ${piece < 0 ? "king" : ""} ${animations && state.lastMove?.to?.row === r && state.lastMove?.to?.col === c ? "move-animated" : ""}`}>{piece < 0 ? "◆" : ""}</span> : null}
        </button>
      ))}
    </GridBoard>;
  }

  const game = new Chess(state.fen);
  const board = game.board();
  const destinations = new Set(legal.filter((m: ChessMove) => {
    const from = `${String.fromCharCode(97 + (selected?.col ?? -1))}${8 - (selected?.row ?? -1)}`;
    return m.from === from;
  }).map((m: ChessMove) => m.to));
  const icons: Record<string, string> = {
    wp: "♙", wn: "♘", wb: "♗", wr: "♖", wq: "♕", wk: "♔",
    bp: "♟", bn: "♞", bb: "♝", br: "♜", bq: "♛", bk: "♚"
  };
  return <GridBoard size={8} flipped={flipped} className="chess-board">
    {board.flatMap((row, r) => row.map((piece, c) => {
      const square = `${String.fromCharCode(97 + c)}${8 - r}`;
      return <button key={square} className={`square ${(r + c) % 2 ? "dark" : "light"} ${selected?.row === r && selected?.col === c ? "selected" : ""} ${destinations.has(square as Square) ? "legal" : ""}`}
        disabled={disabled} onClick={() => chooseChessMove(r, c)} aria-label={square}>
        {piece ? <span className={`chess-piece ${piece.color === "w" ? "white-piece" : "black-piece"} ${animations && state.lastMove?.to === square ? "move-animated" : ""}`}>{icons[piece.color + piece.type]}</span> : null}
      </button>;
    }))}
  </GridBoard>;
}

function GridBoard({ size, flipped, className, children }: { size: number; flipped: boolean; className: string; children: React.ReactNode }) {
  return <div className={`board-shell grid-board ${className} ${flipped ? "flipped" : ""}`} style={{
    gridTemplateColumns: `repeat(${size}, minmax(0, 1fr))`,
    gridTemplateRows: `repeat(${size}, minmax(0, 1fr))`
  }}>{children}</div>;
}

function DotsBoard({ state, rules, legal, disabled, onMove }: {
  state: DotsState; rules: any; legal: EdgeMove[]; disabled: boolean; onMove: (m: EdgeMove) => void;
}) {
  const allowed = new Set(legal.map(keyOf));
  const cells: React.ReactNode[] = [];
  for (let r = 0; r < rules.rows * 2 + 1; r++) {
    for (let c = 0; c < rules.cols * 2 + 1; c++) {
      if (r % 2 === 0 && c % 2 === 0) cells.push(<span key={`${r}-${c}`} className="dot" />);
      else if (r % 2 === 0) {
        const move: EdgeMove = { orientation: "h", row: r / 2, col: (c - 1) / 2 };
        cells.push(<button key={`${r}-${c}`} className={`edge horizontal ${state.h[move.row][move.col] ? "on" : ""}`} disabled={disabled || !allowed.has(keyOf(move))} onClick={() => onMove(move)} />);
      } else if (c % 2 === 0) {
        const move: EdgeMove = { orientation: "v", row: (r - 1) / 2, col: c / 2 };
        cells.push(<button key={`${r}-${c}`} className={`edge vertical ${state.v[move.row][move.col] ? "on" : ""}`} disabled={disabled || !allowed.has(keyOf(move))} onClick={() => onMove(move)} />);
      } else {
        const owner = state.boxes[(r - 1) / 2][(c - 1) / 2];
        cells.push(<span key={`${r}-${c}`} className={`box${playerClass(owner)}`}>{owner || ""}</span>);
      }
    }
  }
  return <div className="board-shell dots-board" style={{
    gridTemplateColumns: `repeat(${rules.cols}, 12px minmax(24px, 1fr)) 12px`,
    gridTemplateRows: `repeat(${rules.rows}, 12px minmax(24px, 1fr)) 12px`,
    aspectRatio: `${rules.cols} / ${rules.rows}`
  }}>{cells}</div>;
}

function otherSide(side: number) { return side ? 0 : 1; }
