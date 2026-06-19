import { useMemo, useState } from "react";
import { connect4, type ConnectState } from "./games";
import type { Player } from "./types";

const rules = connect4.defaultRules;

function playerName(player: Player) {
  return player === 1 ? "Red" : "Blue";
}

function statusText(state: ConnectState) {
  if (state.result?.winner) return `${playerName(state.result.winner)} wins`;
  if (state.result) return "Draw game";
  return `${playerName(state.turn)} to drop`;
}

export default function SnapLensConnect4() {
  const [state, setState] = useState<ConnectState>(() => connect4.create(rules));
  const legalMoves = useMemo(() => connect4.legalMoves(state, rules), [state]);
  const heights = useMemo(() => rules.cols
    ? Array.from({ length: rules.cols }, (_, col) =>
      state.board.findIndex(row => row[col] !== 0)
    ).map(firstFilled => firstFilled === -1 ? 0 : rules.rows - firstFilled)
    : [], [state]);

  const playColumn = (col: number) => {
    if (!legalMoves.includes(col)) return;
    setState(current => connect4.applyMove(current, col, rules));
  };

  const reset = () => setState(connect4.create(rules));

  return <main className="lens-connect4-page">
    <section className="lens-stage" aria-label="Connect 4 Snapchat Lens game">
      <div className="lens-scorebar">
        <span className={`lens-player player-1 ${state.turn === 1 && !state.result ? "active" : ""}`}>
          <i />Red
        </span>
        <strong>{statusText(state)}</strong>
        <span className={`lens-player player-2 ${state.turn === 2 && !state.result ? "active" : ""}`}>
          <i />Blue
        </span>
      </div>

      <div className="lens-column-controls" aria-label="Drop piece controls">
        {Array.from({ length: rules.cols }, (_, col) =>
          <button
            key={col}
            className="lens-drop-button"
            disabled={!legalMoves.includes(col)}
            onClick={() => playColumn(col)}
            aria-label={`Drop in column ${col + 1}`}
            title={`Column ${col + 1}`}
          >
            <span>{heights[col]}</span>
          </button>
        )}
      </div>

      <div className="lens-connect-board" style={{ gridTemplateColumns: `repeat(${rules.cols}, 1fr)` }}>
        {state.board.flatMap((row, rowIndex) => row.map((cell, colIndex) =>
          <button
            key={`${rowIndex}-${colIndex}`}
            className={`lens-connect-cell player-${cell || "empty"} ${state.lastMove?.row === rowIndex && state.lastMove?.col === colIndex ? "last" : ""}`}
            disabled={!legalMoves.includes(colIndex)}
            onClick={() => playColumn(colIndex)}
            aria-label={`Column ${colIndex + 1}, row ${rowIndex + 1}`}
          >
            <span />
          </button>
        ))}
      </div>

      <div className="lens-footer">
        <span>Pass-and-play</span>
        <button onClick={reset}>{state.result ? "Play again" : "Reset"}</button>
      </div>
    </section>
  </main>;
}
