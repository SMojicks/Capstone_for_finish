// Import the functions you need from the SDKs you need
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-auth.js";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyDOPz-t3f_xRKiy3o614-gbzRp7V9YWQXU",
  authDomain: "cafesync-5f6fa.firebaseapp.com",
  projectId: "cafesync-5f6fa",
  storageBucket: "cafesync-5f6fa.firebasestorage.app",
  messagingSenderId: "638004757461",
  appId: "1:638004757461:web:752bfd898bd2b25bf3b35c",
  measurementId: "G-56DGL7YGRY"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
// Export for use in other scripts
export { db, auth };

