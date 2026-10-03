// Firebase infrastructure entry point for clients outside the scoring app's
// module graph (device-harness/script.js imports `db` from here). The scoring
// app itself imports the firebase/ modules directly.
//
// This module only initialises and exposes Firebase. Changeover UI behaviour,
// which used to live here, is now owned by scoring/changeover.js.
export { app, db, usingEmulator } from "./firebase/client.js";

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
} from "./firebase/firestore.js";
