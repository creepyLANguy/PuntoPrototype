import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import
{
  getFirestore,
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