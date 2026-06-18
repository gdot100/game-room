import type { GameId, OnlineCommandResult, OnlineRoom, Player } from "./types";

const disabled = () => Promise.reject(new Error("Firebase rooms are not available in the GitHub Pages build."));

export function firebaseConfigured() {
  return false;
}

export function getFirebaseServices(): never {
  throw new Error("Firebase rooms are not available in the GitHub Pages build.");
}

export function ensureAnonymousUser(): Promise<string> {
  return disabled();
}

export function createOnlineRoom(_gameId: GameId, _rules: unknown, _name: string): Promise<OnlineCommandResult> {
  return disabled();
}

export function joinOnlineRoom(_roomId: string, _name: string): Promise<OnlineCommandResult> {
  return disabled();
}

export function sendOnlineMove(_roomId: string, _move: unknown, _expectedRevision: number): Promise<OnlineCommandResult> {
  return disabled();
}

export function resignOnlineRoom(_roomId: string): Promise<OnlineCommandResult> {
  return disabled();
}

export function requestOnlineUndo(_roomId: string, _targetNodeId: string, _expectedRevision: number): Promise<OnlineCommandResult> {
  return disabled();
}

export function respondOnlineUndo(_roomId: string, _approve: boolean, _expectedRevision: number): Promise<OnlineCommandResult> {
  return disabled();
}

export function claimDisconnectWin(_roomId: string): Promise<OnlineCommandResult> {
  return disabled();
}

export function subscribeToRoom(_roomId: string, _callback: (room: OnlineRoom | null) => void) {
  return () => undefined;
}

export function attachPresence(_roomId: string, _player: Player): Promise<void> {
  return disabled();
}
