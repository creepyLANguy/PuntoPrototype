import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import
{
  getFirestore,
  connectFirestoreEmulator,
  doc,
  setDoc,
  getDoc,
  updateDoc,
  onSnapshot,
  serverTimestamp,
  collection,
  getDocs
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import
{
  activeFirebaseEnvironment,
  firebaseConfigs
} from "./firebase-config.js";

const firebaseConfig = firebaseConfigs[activeFirebaseEnvironment];

if (!firebaseConfig)
{
  throw new Error(`Invalid Firebase environment '${activeFirebaseEnvironment}'. Expected 'production' or 'staging'.`);
}

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);

// Served by the Firebase hosting emulator: talk to the local Firestore emulator instead of the cloud project.
const emulatorHosts = ["localhost", "127.0.0.1", "[::1]"];
export const usingEmulator = emulatorHosts.includes(globalThis.location?.hostname);

if (usingEmulator)
{
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
}

export
{
  doc,
  setDoc,
  getDoc,
  updateDoc,
  onSnapshot,
  serverTimestamp,
  collection,
  getDocs
};