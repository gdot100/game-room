import type { GameId } from "../types";

export default function RuleEditor({ gameId, rules, setRules }: {
  gameId: GameId; rules: any; setRules: (rules: any) => void;
}) {
  const number = (key: string, label: string, min: number, max: number) =>
    <label><span>{label}</span><input type="number" min={min} max={max} value={rules[key]}
      onChange={e => setRules({ ...rules, [key]: Number(e.target.value) })} /></label>;
  const toggle = (key: string, label: string, hint: string) =>
    <label className="toggle-row"><span><strong>{label}</strong><small>{hint}</small></span>
      <input type="checkbox" checked={rules[key]} onChange={e => setRules({ ...rules, [key]: e.target.checked })} /></label>;

  if (gameId === "connect4") return <>{number("rows", "Rows", 4, 8)}{number("cols", "Columns", 4, 10)}{number("target", "Connect", 3, 5)}</>;
  if (gameId === "mancala") return <>{number("pits", "Pits per side", 4, 8)}{number("stones", "Stones per pit", 2, 6)}
    {toggle("capture", "Captures", "Capture opposite stones from an empty home pit.")}
    {toggle("bonusTurn", "Bonus turns", "Landing in your store earns another turn.")}</>;
  if (gameId === "reversi") return <label><span>Board size</span><select value={rules.size} onChange={e => setRules({ ...rules, size: Number(e.target.value) })}>
    {[6, 8, 10].map(x => <option key={x} value={x}>{x} × {x}</option>)}</select></label>;
  if (gameId === "chess") return <>
    <label><span>Starting position</span><select value={rules.variant} onChange={e => setRules({ ...rules, variant: e.target.value })}><option value="standard">Standard</option><option value="chess960">Chess960</option></select></label>
    <label><span>Promotion</span><select value={rules.promotion} onChange={e => setRules({ ...rules, promotion: e.target.value })}><option value="auto">Auto queen</option><option value="manual">Choose piece</option></select></label>
  </>;
  if (gameId === "checkers") return <>
    {toggle("mandatoryCapture", "Mandatory captures", "A capture must be taken when available.")}
    {toggle("maximumCapture", "Maximum capture", "Prefer the line taking the most pieces.")}
    {toggle("promoteDuringCapture", "Crown immediately", "A piece may continue jumping as a king.")}</>;
  if (gameId === "tictactoe") return <>{number("size", "Board size", 3, 5)}{number("target", "In a row", 3, 4)}</>;
  if (gameId === "gomoku") return <>{number("size", "Board size", 9, 15)}{number("target", "In a row", 4, 5)}</>;
  if (gameId === "go") return <>
    <label><span>Board size</span><select value={rules.size} onChange={e => setRules({ ...rules, size: Number(e.target.value) })}>{[5, 7, 9].map(x => <option key={x} value={x}>{x} × {x}</option>)}</select></label>
    <label><span>Komi</span><select value={rules.komi} onChange={e => setRules({ ...rules, komi: Number(e.target.value) })}>{[0, 0.5, 5.5, 6.5, 7.5].map(x => <option key={x} value={x}>{x}</option>)}</select></label>
  </>;
  if (gameId === "hex") return <>{number("size", "Board size", 5, 11)}</>;
  if (gameId === "nim") return <>{number("heaps", "Heaps", 3, 7)}{number("maxHeap", "Largest heap", 3, 15)}</>;
  if (gameId === "breakthrough") return <label><span>Board size</span><select value={rules.size} onChange={e => setRules({ ...rules, size: Number(e.target.value) })}><option value={6}>6 × 6</option><option value={8}>8 × 8</option></select></label>;
  return <>{number("rows", "Box rows", 2, 8)}{number("cols", "Box columns", 2, 8)}
    {toggle("extraTurn", "Extra turn", "Completing a box keeps the turn.")}</>;
}
