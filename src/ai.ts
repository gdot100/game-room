import type { GameId } from "./types";

interface StockfishEngine {
  addMessageListener(listener: (line: string) => void): void;
  removeMessageListener(listener: (line: string) => void): void;
  postMessage(command: string): void;
}

declare global {
  interface Window {
    Stockfish?: () => Promise<StockfishEngine>;
  }
}

export interface AIResponse {
  id: string;
  move: unknown;
  evaluation: number;
  depth: number;
  nodes: number;
}

let worker: Worker | null = null;
let activeId = "";
let stockfish: Promise<StockfishEngine> | null = null;

function getWorker() {
  worker ??= new Worker(new URL("./ai.worker.ts", import.meta.url), { type: "module" });
  return worker;
}

export function cancelAI() {
  activeId = crypto.randomUUID();
  worker?.postMessage({ cancel: activeId });
  stockfish?.then(engine => engine.postMessage("stop")).catch(() => undefined);
}

async function requestStockfishMove(
  id: string,
  state: string,
  rules: any,
  difficulty: number
): Promise<AIResponse> {
  if (!window.Stockfish || !crossOriginIsolated || typeof SharedArrayBuffer === "undefined")
    throw new Error("Stockfish WASM is unavailable");
  stockfish ??= window.Stockfish();
  const engine = await stockfish;
  const parsed = JSON.parse(state) as { fen: string };
  const moveTime = 70 + difficulty * 9;
  return new Promise((resolve, reject) => {
    const listener = (line: string) => {
      if (!line.startsWith("bestmove ")) return;
      engine.removeMessageListener(listener);
      if (activeId !== id) return reject(new Error("cancelled"));
      const uci = line.split(" ")[1];
      if (!uci || uci === "(none)") return reject(new Error("No Stockfish move"));
      resolve({
        id,
        move: { from: uci.slice(0, 2), to: uci.slice(2, 4), ...(uci[4] ? { promotion: uci[4] } : {}) },
        evaluation: 0,
        depth: Math.max(1, Math.round(difficulty / 10)),
        nodes: 0
      });
    };
    engine.addMessageListener(listener);
    engine.postMessage("stop");
    engine.postMessage(`setoption name UCI_Chess960 value ${rules.variant === "chess960" ? "true" : "false"}`);
    engine.postMessage(`setoption name Skill Level value ${Math.max(0, Math.min(20, Math.round(difficulty / 5)))}`);
    engine.postMessage(`position fen ${parsed.fen}`);
    engine.postMessage(`go movetime ${moveTime}`);
    window.setTimeout(() => {
      engine.removeMessageListener(listener);
      reject(new Error("Stockfish timed out"));
    }, 12000);
  });
}

async function requestWorkerMove(
  id: string,
  gameId: GameId,
  state: string,
  rules: unknown,
  difficulty: number
): Promise<AIResponse> {
  const current = getWorker();
  return new Promise((resolve, reject) => {
    const onMessage = (event: MessageEvent<AIResponse>) => {
      if (event.data.id !== id) return;
      current.removeEventListener("message", onMessage);
      resolve(event.data);
    };
    current.addEventListener("message", onMessage);
    current.postMessage({ id, gameId, state, rules, difficulty });
    window.setTimeout(() => {
      current.removeEventListener("message", onMessage);
      if (activeId === id) reject(new Error("AI search timed out"));
    }, 15000);
  });
}

export async function requestAIMove(
  gameId: GameId,
  state: string,
  rules: unknown,
  difficulty: number
): Promise<AIResponse> {
  cancelAI();
  const id = crypto.randomUUID();
  activeId = id;
  if (gameId === "chess") {
    try {
      return await requestStockfishMove(id, state, rules, difficulty);
    } catch {
      if (activeId !== id) throw new Error("cancelled");
    }
  }
  return requestWorkerMove(id, gameId, state, rules, difficulty);
}
