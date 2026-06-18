import type { GameSession, Preferences } from "./types";

const DB_NAME = "parlour-game-room";
const STORE = "sessions";
const PREFS = "parlour-preferences";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE))
        db.createObjectStore(STORE, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveSession(session: GameSession) {
  const db = await openDb();
  return new Promise<void>((resolve, reject) => {
    const request = db.transaction(STORE, "readwrite").objectStore(STORE).put(session);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function loadSessions(): Promise<GameSession[]> {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const request = db.transaction(STORE).objectStore(STORE).getAll();
      request.onsuccess = () => resolve((request.result as GameSession[]).sort((a, b) => b.updatedAt - a.updatedAt));
      request.onerror = () => reject(request.error);
    });
  } catch {
    return [];
  }
}

export async function deleteSession(id: string) {
  const db = await openDb();
  db.transaction(STORE, "readwrite").objectStore(STORE).delete(id);
}

export function loadPreferences(): Preferences {
  try {
    return { theme: "light", sound: true, flipped: false, animations: true, ...JSON.parse(localStorage.getItem(PREFS) || "{}") };
  } catch {
    return { theme: "light", sound: true, flipped: false, animations: true };
  }
}

export function savePreferences(value: Preferences) {
  localStorage.setItem(PREFS, JSON.stringify(value));
}
