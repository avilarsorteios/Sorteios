/**
 * Firebase Configuration & Initialization
 * ----------------------------------------
 * Replace the placeholder values below with your actual Firebase project credentials.
 * You can find these in: Firebase Console > Project Settings > General > Your apps > Config
 *
 * Required Firebase services:
 * - Authentication (Email/Password provider enabled)
 * - Cloud Firestore (database for lotes, users, purchases)
 * - Cloud Functions (for PIX payment creation and draw execution)
 * - Hosting (optional, for deployment)
 */

const firebaseConfig = {
  apiKey: "AIzaSyCxMTsZNsYeoAQVGyYQwGEOkwqeV1zWA68",
  authDomain: "sorteio-705ff.firebaseapp.com",
  projectId: "sorteio-705ff",
  storageBucket: "sorteio-705ff.firebasestorage.app",
  messagingSenderId: "75860261315",
  appId: "1:75860261315:web:0f04e5d45bd5a8473e2576"
};

// Mercado Pago Public Key (usado apenas para referencia no frontend)
const MERCADO_PAGO_PUBLIC_KEY = "APP_USR-83aac87a-aa70-4f69-b712-4e6e343ed561";

// Initialize Firebase App
firebase.initializeApp(firebaseConfig);

// Initialize Firebase services and export references
const auth = firebase.auth();
const db = firebase.firestore();
const functions = (typeof firebase.functions === 'function') ? firebase.functions() : null;

// Optional: Connect to emulators in development
// Uncomment the lines below if using Firebase Local Emulator Suite
// if (location.hostname === 'localhost') {
//   auth.useEmulator('http://localhost:9099');
//   db.useEmulator('localhost', 8080);
//   functions.useEmulator('localhost', 5001);
// }

// Optional: Enable Firestore offline persistence
// db.enablePersistence().catch(err => {
//   console.warn('Firestore persistence not available:', err.code);
// });
