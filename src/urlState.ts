import type { GameSession } from "./types";

interface SharePayload {
  session: GameSession;
}

function encodeBase64Url(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeBase64Url(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return new TextDecoder().decode(Uint8Array.from(binary, char => char.charCodeAt(0)));
}

export function encodeSessionState(session: GameSession) {
  const payload: SharePayload = {
    session: {
      ...session,
      origin: "link",
      onlineRoomId: undefined,
      revision: undefined
    }
  };
  return encodeBase64Url(JSON.stringify(payload));
}

export function decodeSessionState(value: string): GameSession {
  const payload = JSON.parse(decodeBase64Url(value)) as SharePayload;
  if (!payload.session?.gameId || !payload.session.nodes || !payload.session.activeNodeId) {
    throw new Error("That shared game link is incomplete.");
  }
  return {
    ...payload.session,
    origin: "link",
    updatedAt: Date.now()
  };
}

export function makeSessionShareUrl(session: GameSession) {
  const url = new URL(window.location.href);
  url.search = "";
  url.searchParams.set("state", encodeSessionState(session));
  return url.toString();
}
