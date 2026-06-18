import type { AIResponse } from "./ai";
import type { GameId } from "./types";

export const AI_ENABLED = import.meta.env.VITE_DISABLE_AI !== "true";
let aiModule: Promise<typeof import("./ai")> | null = null;

function loadAI() {
  if (!AI_ENABLED) throw new Error("AI is disabled in this build.");
  aiModule ??= import("./ai");
  return aiModule;
}

export async function requestAIMove(gameId: GameId, state: string, rules: unknown, difficulty: number): Promise<AIResponse> {
  const ai = await loadAI();
  return ai.requestAIMove(gameId, state, rules, difficulty);
}

export function cancelAI() {
  if (!AI_ENABLED || !aiModule) return;
  aiModule.then(ai => ai.cancelAI()).catch(() => undefined);
}
