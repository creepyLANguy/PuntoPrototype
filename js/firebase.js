// js/firebase.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  updateDoc,
  onSnapshot,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "",
  authDomain: "punto-8888.firebaseapp.com",
  projectId: "punto-8888",
  storageBucket: "punto-8888.firebasestorage.app",
  messagingSenderId: "362458130631",
  appId: "1:362458130631:web:3236b4c130549566d576e2",
  measurementId: "G-671HVQXCR4"
};



const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);

export {
  doc,
  setDoc,
  getDoc,
  updateDoc,
  onSnapshot,
  serverTimestamp
};