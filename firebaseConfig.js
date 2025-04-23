// Import necessary Firebase SDKs
import { initializeApp } from "firebase/app";
import { 
  getAuth, 
  getReactNativePersistence, 
  initializeAuth 
} from 'firebase/auth';
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getFirestore, collection } from 'firebase/firestore';
import { getStorage } from "firebase/storage"; // ✅ Added Firebase Storage

// Firebase Configuration
const firebaseConfig = {
  apiKey: "AIzaSyASiFLgdRE5-cuGS3Z6yH3uRaNB6T91aFg",
  authDomain: "gabay-5e92c.firebaseapp.com",
  projectId: "gabay-5e92c",
  storageBucket: "gabay-5e92c.appspot.com",  // ✅ Corrected domain
  messagingSenderId: "886508395969",
  appId: "1:886508395969:web:3e2716a7e978fa3b64e340",
  measurementId: "G-3HVE87ZJ1S"
};

// Initialize Firebase App
const app = initializeApp(firebaseConfig);

// Initialize Firebase Authentication with AsyncStorage Persistence
export const auth = initializeAuth(app, {
    persistence: getReactNativePersistence(AsyncStorage)
});

// Initialize Firestore Database
export const db = getFirestore(app);
export const usersRef = collection(db, 'users');
export const roomRef = collection(db, 'rooms');

// ✅ Initialize Firebase Storage for image uploads
export const storage = getStorage(app);

export default app;
