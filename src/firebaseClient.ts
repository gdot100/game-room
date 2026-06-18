import { initializeApp, type FirebaseApp } from "firebase/app";
import { getAuth, onAuthStateChanged, signInAnonymously, type Auth } from "firebase/auth";
import { getDatabase, onDisconnect, onValue, ref, set, serverTimestamp, type Database } from "firebase/database";
import { getFunctions, httpsCallable, type Functions } from "firebase/functions";
import type { GameId, OnlineCommandResult, OnlineRoom, Player } from "./types";
import { roomPath } from "./onlineShared";

interface FirebaseServices {
  app: FirebaseApp;
  auth: Auth;
  db: Database;
  functions: Functions;
}

let services: FirebaseServices | null = null;

function firebaseAuthError(error: unknown) {
  const code = typeof error === "object" && error && "code" in error ? String((error as { code?: unknown }).code) : "";
  if (code === "auth/configuration-not-found") {
    return new Error("Firebase Anonymous Auth is not enabled for this project. In Firebase Console, open Authentication > Sign-in method and enable Anonymous.");
  }
  return error;
}

export function firebaseConfigured() {
  return Boolean(import.meta.env.VITE_FIREBASE_API_KEY && import.meta.env.VITE_FIREBASE_DATABASE_URL);
}

export function getFirebaseServices(): FirebaseServices {
  if (!firebaseConfigured()) throw new Error("Firebase is not configured. Add the VITE_FIREBASE_* values from .env.example.");
  services ??= (() => {
    const app = initializeApp({
      apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
      authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
      databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
      projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
      storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
      messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
      appId: import.meta.env.VITE_FIREBASE_APP_ID,
      measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID
    });
    return { app, auth: getAuth(app), db: getDatabase(app), functions: getFunctions(app) };
  })();
  return services;
}

export function ensureAnonymousUser(): Promise<string> {
  const { auth } = getFirebaseServices();
  return new Promise((resolve, reject) => {
    const unsubscribe = onAuthStateChanged(auth, async user => {
      unsubscribe();
      if (user) resolve(user.uid);
      else {
        try {
          const credential = await signInAnonymously(auth);
          resolve(credential.user.uid);
        } catch (error) {
          reject(firebaseAuthError(error));
        }
      }
    }, reject);
  });
}

export async function createOnlineRoom(gameId: GameId, rules: unknown, name: string) {
  await ensureAnonymousUser();
  const callable = httpsCallable<{ gameId: GameId; rules: unknown; name: string }, OnlineCommandResult>(
    getFirebaseServices().functions,
    "createRoom"
  );
  return (await callable({ gameId, rules, name })).data;
}

export async function joinOnlineRoom(roomId: string, name: string) {
  await ensureAnonymousUser();
  const callable = httpsCallable<{ roomId: string; name: string }, OnlineCommandResult>(
    getFirebaseServices().functions,
    "joinRoom"
  );
  return (await callable({ roomId, name })).data;
}

export async function sendOnlineMove(roomId: string, move: unknown, expectedRevision: number) {
  const callable = httpsCallable<{ roomId: string; move: unknown; expectedRevision: number }, OnlineCommandResult>(
    getFirebaseServices().functions,
    "submitMove"
  );
  return (await callable({ roomId, move, expectedRevision })).data;
}

export async function resignOnlineRoom(roomId: string) {
  const callable = httpsCallable<{ roomId: string }, OnlineCommandResult>(getFirebaseServices().functions, "resignRoom");
  return (await callable({ roomId })).data;
}

export async function requestOnlineUndo(roomId: string, targetNodeId: string, expectedRevision: number) {
  const callable = httpsCallable<{ roomId: string; targetNodeId: string; expectedRevision: number }, OnlineCommandResult>(
    getFirebaseServices().functions,
    "requestUndo"
  );
  return (await callable({ roomId, targetNodeId, expectedRevision })).data;
}

export async function respondOnlineUndo(roomId: string, approve: boolean, expectedRevision: number) {
  const callable = httpsCallable<{ roomId: string; approve: boolean; expectedRevision: number }, OnlineCommandResult>(
    getFirebaseServices().functions,
    "respondUndo"
  );
  return (await callable({ roomId, approve, expectedRevision })).data;
}

export async function claimDisconnectWin(roomId: string) {
  const callable = httpsCallable<{ roomId: string }, OnlineCommandResult>(getFirebaseServices().functions, "claimDisconnectWin");
  return (await callable({ roomId })).data;
}

export function subscribeToRoom(roomId: string, callback: (room: OnlineRoom | null) => void) {
  const roomRef = ref(getFirebaseServices().db, roomPath(roomId));
  return onValue(roomRef, snapshot => callback(snapshot.val() as OnlineRoom | null));
}

export async function attachPresence(roomId: string, player: Player) {
  const uid = await ensureAnonymousUser();
  const presenceRef = ref(getFirebaseServices().db, `${roomPath(roomId)}/players/${player}`);
  await set(ref(getFirebaseServices().db, `${roomPath(roomId)}/players/${player}/connected`), true);
  await set(ref(getFirebaseServices().db, `${roomPath(roomId)}/players/${player}/lastSeen`), serverTimestamp());
  await onDisconnect(presenceRef).update({ connected: false, lastSeen: serverTimestamp() });
}
