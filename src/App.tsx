import { useCallback, useEffect, useMemo, useState } from "react";
import Board from "./components/Board";
import RuleEditor from "./components/RuleEditor";
import SnapLensConnect4 from "./SnapLensConnect4";
import { AI_ENABLED, cancelAI, requestAIMove } from "./aiClient";
import { adapters, gameOrder } from "./games";
import { onlineRoomToSession, playerForUid, DISCONNECT_GRACE_MS } from "./onlineShared";
import { createSession, goBack, goForward, playMove, removeBranch } from "./session";
import { deleteSession, loadPreferences, loadSessions, savePreferences, saveSession } from "./storage";
import type { GameId, GameSession, OnlineRoom, Player, PlayerConfig, Preferences } from "./types";
import { decodeSessionState, makeSessionShareUrl } from "./urlState";

const MULTIPLAYER_ONLY = import.meta.env.VITE_MULTIPLAYER_ONLY === "true";
const LINK_ONLY = import.meta.env.VITE_LINK_ONLY === "true";
const FIREBASE_CONFIGURED = Boolean(import.meta.env.VITE_FIREBASE_API_KEY && import.meta.env.VITE_FIREBASE_DATABASE_URL);
const onlineClient = () => import("./firebaseClient");

const modePlayers = (mode: "hvh" | "hva" | "ava"): Record<Player, PlayerConfig> => ({
  1: {
    kind: mode === "ava" ? "ai" : "human",
    name: mode === "ava" ? "Iris" : "Player One",
    difficulty: 55, minMoveMs: 550
  },
  2: {
    kind: mode === "hvh" ? "human" : "ai",
    name: mode === "hvh" ? "Player Two" : "The House",
    difficulty: 55, minMoveMs: 650
  }
});

function App() {
  const params = new URLSearchParams(window.location.search);
  return params.get("lens") === "connect4" ? <SnapLensConnect4 /> : <ParlourApp />;
}

function ParlourApp() {
  const [sessions, setSessions] = useState<GameSession[]>([]);
  const [session, setSession] = useState<GameSession | null>(null);
  const [setupGame, setSetupGame] = useState<GameId | null>(null);
  const [prefs, setPrefs] = useState<Preferences>(loadPreferences);
  const [thinking, setThinking] = useState(false);
  const [paused, setPaused] = useState(false);
  const [step, setStep] = useState(false);
  const [showTree, setShowTree] = useState(false);
  const [showAllSessions, setShowAllSessions] = useState(false);
  const [toast, setToast] = useState("");
  const [uid, setUid] = useState<string | null>(null);
  const [onlineRoom, setOnlineRoom] = useState<OnlineRoom | null>(null);
  const [onlineLoading, setOnlineLoading] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sharedState = params.get("s") || params.get("state");
    if (sharedState) {
      try {
        setSession(decodeSessionState(sharedState));
      } catch (error) {
        setToast(error instanceof Error ? error.message : "Could not open that shared game link.");
      }
      return;
    }
    if (!MULTIPLAYER_ONLY) loadSessions().then(setSessions);
  }, []);
  useEffect(() => {
    if (LINK_ONLY || !FIREBASE_CONFIGURED) return;
    onlineClient().then(client => client.ensureAnonymousUser()).then(setUid).catch(() => undefined);
  }, []);
  useEffect(() => {
    const roomId = new URLSearchParams(window.location.search).get("room");
    if (LINK_ONLY || !roomId || !FIREBASE_CONFIGURED || new URLSearchParams(window.location.search).has("state") || new URLSearchParams(window.location.search).has("s")) return;
    setOnlineLoading(true);
    const name = localStorage.getItem("parlour-online-name") || window.prompt("Name for this online room?", "Player") || "Player";
    localStorage.setItem("parlour-online-name", name);
    onlineClient().then(client => client.joinOnlineRoom(roomId, name))
      .then(async ({ room }) => {
        const client = await onlineClient();
        setUid(await client.ensureAnonymousUser());
        setOnlineRoom(room);
      })
      .catch(error => setToast(error instanceof Error ? error.message : "Could not join that room."))
      .finally(() => setOnlineLoading(false));
  }, []);
  useEffect(() => {
    if (!onlineRoom?.id || LINK_ONLY || !FIREBASE_CONFIGURED) return;
    let unsubscribe: (() => void) | undefined;
    onlineClient().then(client => {
      unsubscribe = client.subscribeToRoom(onlineRoom.id, room => {
      setOnlineRoom(room);
      if (room && uid) {
        const onlineSession = onlineRoomToSession(room, uid);
        setSession(onlineSession);
        const player = playerForUid(room, uid);
        if (player) client.attachPresence(room.id, player).catch(() => undefined);
      }
      });
    }).catch(error => setToast(error instanceof Error ? error.message : "Could not subscribe to that room."));
    return () => unsubscribe?.();
  }, [onlineRoom?.id, uid]);
  useEffect(() => {
    document.documentElement.dataset.theme = prefs.theme;
    savePreferences(prefs);
  }, [prefs]);
  useEffect(() => {
    if (!session || session.origin === "online") return;
    const timer = window.setTimeout(() => {
      saveSession(session).then(() =>
        setSessions(old => [session, ...old.filter(x => x.id !== session.id)].sort((a, b) => b.updatedAt - a.updatedAt))
      );
    }, 180);
    return () => window.clearTimeout(timer);
  }, [session]);

  const adapter = session ? adapters[session.gameId] : null;
  const state = useMemo(() => session && adapter
    ? adapter.deserialize(session.nodes[session.activeNodeId].snapshot)
    : null, [session, adapter]);
  const activePlayer = state?.turn as Player | undefined;
  const myOnlinePlayer = onlineRoom && uid ? playerForUid(onlineRoom, uid) : null;
  const isOnline = session?.origin === "online";

  const commitMove = useCallback((move: unknown) => {
    if (session?.origin === "online") {
      onlineClient().then(client => client.sendOnlineMove(session.onlineRoomId!, move, session.revision ?? 0))
        .catch(error => setToast(error instanceof Error ? error.message : "Could not send move."));
      return;
    }
    setSession(current => {
      if (!current) return current;
      const next = playMove(current, move);
      const shouldOfferLink = current.origin === "link"
        || LINK_ONLY
        || (!MULTIPLAYER_ONLY && current.players[1].kind === "human" && current.players[2].kind === "human");
      if (next !== current && shouldOfferLink) {
        window.setTimeout(() => promptForShareLink(next, setToast), 0);
      }
      return next;
    });
    if (prefs.sound) tone();
  }, [prefs.sound, session?.origin, session?.onlineRoomId, session?.revision]);

  useEffect(() => {
    if (!AI_ENABLED || !session || session.origin === "online" || !adapter || !state || state.result || thinking) return;
    const config = session.players[state.turn as Player];
    if (config.kind !== "ai" || (paused && !step)) return;
    let alive = true;
    setThinking(true);
    const started = performance.now();
    requestAIMove(session.gameId, adapter.serialize(state), session.rules, config.difficulty)
      .then(async reply => {
        const wait = Math.max(0, config.minMoveMs - (performance.now() - started));
        await new Promise(resolve => window.setTimeout(resolve, wait));
        if (alive) {
          commitMove(reply.move);
          setStep(false);
        }
      })
      .catch(() => alive && setToast("The AI could not finish that search."))
      .finally(() => alive && setThinking(false));
    return () => { alive = false; cancelAI(); setThinking(false); };
  }, [session?.activeNodeId, session?.id, session?.origin, session?.players, paused, step]);

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (!session || event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        setSession(s => s ? (event.shiftKey ? goForward(s) : goBack(s)) : s);
      }
      if (event.key === " ") { event.preventDefault(); setPaused(x => !x); }
      if (event.key.toLowerCase() === "f") setPrefs(p => ({ ...p, flipped: !p.flipped }));
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [session]);

  const navigate = (next: GameSession) => {
    cancelAI(); setThinking(false); setSession(next);
  };

  if (!session) return <>
    <Header prefs={prefs} setPrefs={setPrefs} />
    <main className="home">
      <section className="hero">
        <p className="eyebrow">A room for good moves</p>
        <h1>Pull up a chair.</h1>
        <p>{LINK_ONLY
          ? "Share a game-state link after each move. No accounts, server, or database required."
          : MULTIPLAYER_ONLY
            ? "Private Firebase rooms backed by the server database for classic tabletop games."
            : "Twelve enduring games, thoughtful computer opponents, and all the space you need to explore a better line."}</p>
      </section>
      {!MULTIPLAYER_ONLY && sessions.length > 0 && <section className="resume-section">
        <div className="section-heading"><div><p className="eyebrow">Saved locally</p><h2>Continue playing</h2></div></div>
        <div className="resume-strip">
          {sessions.slice(0, showAllSessions ? sessions.length : 4).map(saved => {
            const a = adapters[saved.gameId];
            const savedState = safeState(saved);
            return <article className="resume-card" key={saved.id} style={{ "--accent": a.accent } as React.CSSProperties}>
              <button className="resume-main" onClick={() => setSession(saved)}>
                <span className="game-mark">{gameIcon(saved.gameId)}</span>
                <span><strong>{a.name}</strong><small>{savedState?.result ? savedState.result.reason : `Move ${(savedState?.moveNumber ?? 0) + 1}`}</small></span>
                <span className="arrow">→</span>
              </button>
              <button className="icon-button delete" aria-label={`Delete ${a.name} save`} onClick={async () => {
                await deleteSession(saved.id); setSessions(x => x.filter(s => s.id !== saved.id));
              }}>×</button>
            </article>;
          })}
        </div>
        {sessions.length > 4 && <button className="show-more-button" onClick={() => setShowAllSessions(x => !x)}>
          {showAllSessions ? "Show less" : `Show ${sessions.length - 4} more`}
        </button>}
      </section>}
      <section className="library">
        <div className="section-heading"><div><p className="eyebrow">The collection</p><h2>Choose your table</h2></div><span>{LINK_ONLY ? "Game-state links" : MULTIPLAYER_ONLY ? "Server rooms" : FIREBASE_CONFIGURED ? "Local or online" : "All games work offline"}</span></div>
        <div className="game-grid">
          {gameOrder.map((id, index) => {
            const a = adapters[id];
            return <button className="game-card" key={id} style={{ "--accent": a.accent, "--delay": `${index * 45}ms` } as React.CSSProperties} onClick={() => setSetupGame(id)}>
              <span className="card-number">0{index + 1}</span>
              <span className="game-art">{gameIcon(id)}</span>
              <span className="card-copy"><strong>{a.name}</strong><small>{a.description}</small></span>
              <span className="card-arrow">↗</span>
            </button>;
          })}
        </div>
      </section>
      <footer><span>THE PARLOUR</span><span>Saved in this browser · No account needed</span></footer>
    </main>
    {onlineLoading && <div className="toast">Working on online room...</div>}
    {setupGame && <Setup gameId={setupGame} onClose={() => setSetupGame(null)} onStart={newSession => {
      setSetupGame(null); setSession(newSession);
    }} onStartOnline={async (gameId, rules, name) => {
      setOnlineLoading(true);
      try {
        const client = await onlineClient();
        const currentUid = await client.ensureAnonymousUser();
        setUid(currentUid);
        const { room } = await client.createOnlineRoom(gameId, rules, name);
        setSetupGame(null);
        setOnlineRoom(room);
        const url = `${window.location.origin}${window.location.pathname}?room=${room.id}`;
        window.history.replaceState(null, "", url);
        void shareUrl(url, setToast, {
          title: "Join my game room",
          text: "Open this private room link to join my game."
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Could not create online room.";
        setToast(message);
        throw new Error(message);
      } finally {
        setOnlineLoading(false);
      }
    }} />}
  </>;

  if (!adapter || !state || !activePlayer) return null;
  const currentConfig = session.players[activePlayer];
  const aiVsAi = session.players[1].kind === "ai" && session.players[2].kind === "ai";
  const humanCanMove = isOnline
    ? myOnlinePlayer === activePlayer && !state.result && onlineRoom?.status === "playing"
    : currentConfig.kind === "human" && !state.result;

  return <div className="game-page">
    <header className="play-header">
      <button className="brand compact" onClick={() => { cancelAI(); setSession(null); if (isOnline) { setOnlineRoom(null); window.history.replaceState(null, "", window.location.pathname); } }}>THE PARLOUR</button>
      <div className="game-title"><span style={{ color: adapter.accent }}>{gameIcon(session.gameId)}</span><strong>{adapter.name}</strong><small>{adapter.rulesSummary(session.rules)}</small></div>
      <div className="header-actions">
        {session.origin !== "online" && (LINK_ONLY || !MULTIPLAYER_ONLY) && <button className="text-button" onClick={() => promptForShareLink(session, setToast)}>Share state</button>}
        <button className="text-button" onClick={() => setShowTree(x => !x)}>Analysis</button>
        <button className="icon-button" aria-label="Flip board" title="Flip board (F)" onClick={() => setPrefs(p => ({ ...p, flipped: !p.flipped }))}>⇅</button>
        <button className="icon-button" aria-label="Toggle sound" onClick={() => setPrefs(p => ({ ...p, sound: !p.sound }))}>{prefs.sound ? "♪" : "−"}</button>
        <button className="icon-button" aria-label="Toggle move animations" title="Toggle move animations" onClick={() => setPrefs(p => ({ ...p, animations: !p.animations }))}>{prefs.animations ? "◌" : "·"}</button>
      </div>
    </header>
    <main className={`play-layout ${showTree ? "tree-open" : ""}`}>
      <section className="table-area">
        <PlayerBar player={2} config={session.players[2]} active={activePlayer === 2} state={state} thinking={thinking && activePlayer === 2} gameId={session.gameId} />
        <Board gameId={session.gameId} state={state} rules={session.rules} disabled={!humanCanMove || thinking} flipped={prefs.flipped} animations={prefs.animations} onMove={commitMove} />
        <PlayerBar player={1} config={session.players[1]} active={activePlayer === 1} state={state} thinking={thinking && activePlayer === 1} gameId={session.gameId} />
        <div className="mobile-actions">
          <HistoryControls session={session} setSession={navigate} />
        </div>
      </section>
      <aside className={`side-panel ${showTree ? "visible" : ""}`}>
        <button className="panel-close" onClick={() => setShowTree(false)}>×</button>
        <div className="status-card">
          <p className="eyebrow">Current position</p>
          <h2>{onlineRoom ? onlineStatusText(onlineRoom, session, uid, state) : state.result ? resultText(state.result, session) : thinking ? `${currentConfig.name} is thinking…` : `${currentConfig.name} to move`}</h2>
          <p>{state.result ? "Explore another line or begin a fresh game." : helpText(session.gameId, state)}</p>
        </div>
        {isOnline ? <OnlineControls room={onlineRoom} session={session} uid={uid} setToast={setToast} /> : <HistoryControls session={session} setSession={navigate} />}
        {aiVsAi && <div className="ai-controls">
          <p className="panel-label">Exhibition controls</p>
          <div className="button-row">
            <button onClick={() => setPaused(x => !x)}>{paused ? "Play" : "Pause"}</button>
            <button onClick={() => { setPaused(true); setStep(true); }} disabled={!paused || thinking}>Step</button>
          </div>
        </div>}
        {!isOnline && <LiveAIControls session={session} onChange={players => setSession(s => s ? ({ ...s, players, updatedAt: Date.now() }) : s)} />}
        <MoveTree session={session} onNavigate={isOnline && !state.result ? () => undefined : navigate} onDelete={id => !isOnline && setSession(s => s ? removeBranch(s, id) : s)} readonly={isOnline} />
        <div className="rules-note">
          <p className="panel-label">House rules</p>
          <p>{adapter.rulesSummary(session.rules)}</p>
        </div>
        <label className="preference-toggle">
          <span><strong>Move animations</strong><small>Animate newly placed and moved pieces.</small></span>
          <input type="checkbox" checked={prefs.animations} onChange={event => setPrefs(p => ({ ...p, animations: event.target.checked }))} />
        </label>
        <button className="new-game-link" onClick={() => {
          if (confirm("Leave this table and set up a new game? Your position is already saved.")) {
            setSession(null); setSetupGame(session.gameId);
          }
        }}>New game & settings</button>
      </aside>
    </main>
    {toast && <button className="toast" onClick={() => setToast("")}>{toast}</button>}
  </div>;
}

function Setup({ gameId, onClose, onStart, onStartOnline }: {
  gameId: GameId;
  onClose: () => void;
  onStart: (s: GameSession) => void;
  onStartOnline: (gameId: GameId, rules: unknown, name: string) => Promise<void>;
}) {
  const adapter = adapters[gameId];
  const [rules, setRules] = useState(structuredClone(adapter.defaultRules));
  const [mode, setMode] = useState<"hvh" | "hva" | "ava">(AI_ENABLED ? "hva" : "hvh");
  const [onlineName, setOnlineName] = useState(localStorage.getItem("parlour-online-name") || "Player");
  const [players, setPlayers] = useState(modePlayers(AI_ENABLED ? "hva" : "hvh"));
  const [onlineBusy, setOnlineBusy] = useState(false);
  const [onlineError, setOnlineError] = useState("");
  const errors = adapter.validateRules(rules);
  const changeMode = (next: typeof mode) => { setMode(next); setPlayers(modePlayers(next)); };
  const updatePlayer = (player: Player, patch: Partial<PlayerConfig>) =>
    setPlayers(p => ({ ...p, [player]: { ...p[player], ...patch } }));
  return <div className="modal-backdrop" onMouseDown={e => e.target === e.currentTarget && onClose()}>
    <div className="setup-modal" role="dialog" aria-modal="true" aria-labelledby="setup-title">
      <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
      <div className="setup-intro" style={{ "--accent": adapter.accent } as React.CSSProperties}>
        <span className="setup-icon">{gameIcon(gameId)}</span>
        <p className="eyebrow">Set the table</p>
        <h2 id="setup-title">{adapter.name}</h2>
        <p>{adapter.description}</p>
      </div>
      <div className="setup-body">
        <div className="setup-section">
          <div className="setup-heading"><h3>Players</h3></div>
          <div className="segmented">
            <button className={mode === "hvh" ? "active" : ""} onClick={() => changeMode("hvh")}>Two people</button>
            {AI_ENABLED && <button className={mode === "hva" ? "active" : ""} onClick={() => changeMode("hva")}>Play the AI</button>}
            {AI_ENABLED && <button className={mode === "ava" ? "active" : ""} onClick={() => changeMode("ava")}>AI exhibition</button>}
          </div>
          <div className="player-settings">
            {([1, 2] as Player[]).map(player => <div className="player-config" key={player}>
              <div className={`player-dot player-${player}`} /><strong>{players[player].name}</strong><small>{players[player].kind === "human" ? "Human" : "Computer"}</small>
              {players[player].kind === "ai" && <div className="slider-stack">
                <label><span>Difficulty <b>{players[player].difficulty}</b></span><input type="range" min="1" max="100" value={players[player].difficulty} onChange={e => updatePlayer(player, { difficulty: Number(e.target.value) })} /></label>
                <label><span>Minimum move time <b>{(players[player].minMoveMs / 1000).toFixed(1)}s</b></span><input type="range" min="0" max="3000" step="100" value={players[player].minMoveMs} onChange={e => updatePlayer(player, { minMoveMs: Number(e.target.value) })} /></label>
              </div>}
            </div>)}
          </div>
        </div>
        {!LINK_ONLY && <div className="setup-section online-start">
          <div className="setup-heading"><h3>Online room</h3><span>{FIREBASE_CONFIGURED ? "Private link" : "Needs Firebase config"}</span></div>
          <label><span>Your name</span><input value={onlineName} onChange={event => setOnlineName(event.target.value)} /></label>
          {onlineError && <p className="error">{onlineError}</p>}
          <button className="secondary-button" disabled={!FIREBASE_CONFIGURED || errors.length > 0 || onlineBusy} onClick={async () => {
            setOnlineBusy(true);
            setOnlineError("");
            localStorage.setItem("parlour-online-name", onlineName || "Player");
            try {
              await onStartOnline(gameId, rules, onlineName || "Player");
            } catch (error) {
              setOnlineError(error instanceof Error ? error.message : "Could not create online room.");
            } finally {
              setOnlineBusy(false);
            }
          }}>{onlineBusy ? "Creating room..." : "Create private room link"}</button>
        </div>}
        <div className="setup-section">
          <div className="setup-heading"><h3>House rules</h3><button onClick={() => setRules(structuredClone(adapter.defaultRules))}>Reset standard</button></div>
          <div className="rule-grid"><RuleEditor gameId={gameId} rules={rules} setRules={setRules} /></div>
          {errors.map((error: string) => <p className="error" key={error}>{error}</p>)}
        </div>
        {!MULTIPLAYER_ONLY && <button className="primary-button" disabled={errors.length > 0} onClick={() => onStart(createSession(gameId, rules, players))}>Take your seat <span>→</span></button>}
        {LINK_ONLY && <button className="primary-button" disabled={errors.length > 0} onClick={() => {
          const shared = createSession(gameId, rules, modePlayers("hvh"));
          const url = makeSessionShareUrl({ ...shared, origin: "link" });
          void shareUrl(url, message => alert(message), {
            title: "Game state",
            text: "Open this link to play the next move."
          });
        }}>Create game-state link <span>→</span></button>}
      </div>
    </div>
  </div>;
}

function PlayerBar({ player, config, active, thinking, state, gameId }: {
  player: Player; config: PlayerConfig; active: boolean; thinking: boolean; state: any; gameId: GameId;
}) {
  let score = "";
  if (gameId === "reversi") score = String(state.board.flat().filter((x: number) => x === player).length);
  if (gameId === "mancala") score = String(state.stores[player - 1]);
  if (gameId === "dots") score = String(state.scores[player - 1]);
  if (gameId === "go") score = `${state.captures[player - 1]} captures`;
  return <div className={`player-bar ${active ? "active" : ""}`}>
    <span className={`player-token player-${player}`}>{config.kind === "ai" ? "AI" : player}</span>
    <span><strong>{config.name}</strong><small>{config.kind === "ai" ? `Computer · ${difficultyName(config.difficulty)}` : "At the table"}</small></span>
    {thinking && <span className="thinking-dots"><i /><i /><i /></span>}
    {score && <strong className="score">{score}</strong>}
  </div>;
}

function HistoryControls({ session, setSession }: { session: GameSession; setSession: (s: GameSession) => void }) {
  const node = session.nodes[session.activeNodeId];
  return <div className="history-controls">
    <button onClick={() => setSession(goBack(session))} disabled={!node.parentId} aria-label="Undo">← <span>Undo</span></button>
    <button onClick={() => setSession(goForward(session))} disabled={!node.children.length} aria-label="Redo"><span>Redo</span> →</button>
  </div>;
}

function MoveTree({ session, onNavigate, onDelete, readonly = false }: { session: GameSession; onNavigate: (s: GameSession) => void; onDelete: (id: string) => void; readonly?: boolean }) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const rows: { node: any; depth: number; moveNumber: number }[] = [];
  const adapter = adapters[session.gameId];
  const walk = (id: string, depth: number) => {
    const node = session.nodes[id];
    let moveNumber = 0;
    try { moveNumber = adapter.deserialize(node.snapshot).moveNumber; } catch { /* Keep malformed saves navigable. */ }
    rows.push({ node, depth, moveNumber });
    if (!collapsed.has(id)) {
      const childDepth = depth + (node.children.length > 1 ? 1 : 0);
      node.children.forEach((child: string) => walk(child, childDepth));
    }
  };
  walk(session.rootId, 0);
  const toggle = (id: string) => setCollapsed(current => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  return <div className="move-tree">
    <div className="tree-heading"><p className="panel-label">Move tree</p><span>{Object.keys(session.nodes).length - 1} moves</span></div>
    <div className="tree-list">
      {rows.map(({ node, depth, moveNumber }) => <div className={`tree-row ${node.id === session.activeNodeId ? "current" : ""}`} style={{ paddingLeft: `${7 + depth * 16}px` }} key={node.id}>
        {node.children.length ? <button className={`tree-toggle ${collapsed.has(node.id) ? "collapsed" : ""}`} onClick={() => toggle(node.id)} aria-label={collapsed.has(node.id) ? "Expand moves" : "Collapse moves"}>⌄</button> : <span className="tree-toggle-spacer" />}
        <button onClick={() => onNavigate({ ...session, activeNodeId: node.id, updatedAt: Date.now() })} disabled={readonly && node.id !== session.activeNodeId}>
          <span className="move-index">{node.parentId ? moveNumber : "•"}</span><span>{node.notation}</span>{node.children.length > 1 && <small>{node.children.length} lines</small>}
        </button>
        {!readonly && node.parentId && node.id !== session.activeNodeId && <button className="branch-delete" aria-label="Delete branch" onClick={() => onDelete(node.id)}>×</button>}
      </div>)}
    </div>
  </div>;
}

function OnlineControls({ room, session, uid, setToast }: {
  room: OnlineRoom | null; session: GameSession; uid: string | null; setToast: (message: string) => void;
}) {
  const active = session.nodes[session.activeNodeId];
  const player = room && uid ? playerForUid(room, uid) : null;
  const opponent = player ? room?.players[player === 1 ? 2 : 1] : null;
  const disconnectedLongEnough = opponent && !opponent.connected && Date.now() - opponent.lastSeen > DISCONNECT_GRACE_MS;
  const parentId = active.parentId;
  return <div className="online-controls">
    <p className="panel-label">Online room</p>
    <div className="button-row">
      <button onClick={() => void shareUrl(window.location.href, setToast, {
        title: "Join my game room",
        text: "Open this private room link to join my game."
      })}>Share link</button>
      <button onClick={() => room && onlineClient().then(client => client.resignOnlineRoom(room.id)).catch(error => setToast(error instanceof Error ? error.message : "Could not resign."))}>Resign</button>
    </div>
    {parentId && <button className="wide-button" onClick={() => room && onlineClient().then(client => client.requestOnlineUndo(room.id, parentId, session.revision ?? 0)).catch(error => setToast(error instanceof Error ? error.message : "Could not request undo."))}>Request undo</button>}
    {room?.undoRequest?.status === "pending" && room.undoRequest.requester !== player && <div className="undo-request">
      <p>Your opponent requested an undo.</p>
      <div className="button-row">
        <button onClick={() => onlineClient().then(client => client.respondOnlineUndo(room.id, true, session.revision ?? 0)).catch(error => setToast(error instanceof Error ? error.message : "Could not approve undo."))}>Approve</button>
        <button onClick={() => onlineClient().then(client => client.respondOnlineUndo(room.id, false, session.revision ?? 0)).catch(error => setToast(error instanceof Error ? error.message : "Could not decline undo."))}>Decline</button>
      </div>
    </div>}
    {disconnectedLongEnough && <button className="wide-button" onClick={() => onlineClient().then(client => client.claimDisconnectWin(room!.id)).catch(error => setToast(error instanceof Error ? error.message : "Could not claim win."))}>Claim disconnect win</button>}
  </div>;
}

function LiveAIControls({ session, onChange }: {
  session: GameSession; onChange: (players: Record<Player, PlayerConfig>) => void;
}) {
  const aiPlayers = ([1, 2] as Player[]).filter(player => session.players[player].kind === "ai");
  if (!aiPlayers.length) return null;
  const update = (player: Player, minMoveMs: number) =>
    onChange({ ...session.players, [player]: { ...session.players[player], minMoveMs } });
  return <div className="live-ai-controls">
    <p className="panel-label">AI move timing</p>
    {aiPlayers.map(player => <label key={player}>
      <span>{session.players[player].name}<b>{(session.players[player].minMoveMs / 1000).toFixed(1)}s</b></span>
      <input type="range" min="0" max="3000" step="100" value={session.players[player].minMoveMs}
        onChange={event => update(player, Number(event.target.value))} />
    </label>)}
  </div>;
}

function Header({ prefs, setPrefs }: { prefs: Preferences; setPrefs: React.Dispatch<React.SetStateAction<Preferences>> }) {
  return <header className="site-header"><button className="brand">THE PARLOUR</button><nav><span>Classic games, considered.</span>
    <button className="icon-button" onClick={() => setPrefs(p => ({ ...p, theme: p.theme === "light" ? "dark" : "light" }))} aria-label="Toggle theme">{prefs.theme === "light" ? "☾" : "○"}</button>
  </nav></header>;
}

function safeState(session: GameSession) {
  try { return adapters[session.gameId].deserialize(session.nodes[session.activeNodeId].snapshot); } catch { return null; }
}
function difficultyName(n: number) { return n < 25 ? "Gentle" : n < 50 ? "Casual" : n < 75 ? "Club" : n < 92 ? "Expert" : "Master"; }
function resultText(result: any, session: GameSession) {
  return result.winner === 0 ? `Draw · ${result.reason}` : `${session.players[result.winner as Player].name} wins`;
}
function onlineStatusText(room: OnlineRoom, session: GameSession, uid: string | null, state: any) {
  if (state.result || room.result) return resultText((state.result || room.result), session);
  if (room.status === "waiting") return "Waiting for opponent...";
  if (room.status === "resigned") return room.result ? resultText(room.result, session) : "Game resigned";
  const player = uid ? playerForUid(room, uid) : null;
  if (!player) return "Room full";
  const turn = state.turn as Player;
  return player === turn ? "Your move" : `${session.players[turn].name} to move`;
}
function helpText(id: GameId, state: any) {
  if (id === "connect4") return "Choose a column and let your piece fall.";
  if (id === "mancala") return "Choose one of the pits on your side.";
  if (id === "reversi") return "Legal placements are softly marked.";
  if (id === "chess") return "Select a piece, then choose its destination.";
  if (id === "checkers") return state.chainFrom ? "Continue the capture sequence." : "Select a piece, then its destination.";
  if (id === "tictactoe" || id === "gomoku") return "Choose an empty intersection for your next mark.";
  if (id === "go") return "Place a stone to surround territory, or pass.";
  if (id === "hex") return "Connect your two opposite colored sides.";
  if (id === "nim") return "Remove one or more stones from a single heap.";
  if (id === "breakthrough") return "Move forward or diagonally toward the far rank.";
  return "Choose any open line between two dots.";
}
function gameIcon(id: GameId) {
  const icons: Record<GameId, string> = { connect4: "●", mancala: "◉", reversi: "◐", chess: "♞", checkers: "◆", dots: "⁙", tictactoe: "×", gomoku: "⊙", go: "●", hex: "⬡", nim: "∴", breakthrough: "▲" };
  return icons[id];
}
function tone() {
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    const context = new AudioContextClass();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = 260;
    gain.gain.setValueAtTime(0.035, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.08);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(); oscillator.stop(context.currentTime + 0.08);
  } catch { /* Sound is an optional enhancement. */ }
}

function promptForShareLink(session: GameSession, setToast: (message: string) => void) {
  const url = makeSessionShareUrl({ ...session, origin: "link" });
  const shouldShare = window.confirm("Move played. Share the next game-state link with the other player?");
  if (!shouldShare) return;
  void shareUrl(url, setToast, {
    title: "Next game move",
    text: "Open this link to play the next move."
  });
}

async function shareUrl(
  url: string,
  setToast: (message: string) => void,
  options: { title: string; text: string }
) {
  if (navigator.share) {
    try {
      await navigator.share({ ...options, url });
      setToast("Share sheet opened.");
      return;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
    }
  }
  try {
    await navigator.clipboard?.writeText(url);
    setToast("Link copied. Send it to the other player.");
  } catch {
    window.prompt("Copy this link:", url);
  }
}

export default App;
