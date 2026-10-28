// Configuración de la app web de Firebase (no es secreta: va siempre visible en una web).
// La seguridad real está en las reglas de Firestore, que limitan cada documento a su dueño.
export default {
  apiKey: "AIzaSyCM8LoY82giPm3R3I44qv2I1fVgEx6PArE",
  authDomain: "mi-dia-467b1.firebaseapp.com",
  projectId: "mi-dia-467b1",
  storageBucket: "mi-dia-467b1.firebasestorage.app",
  messagingSenderId: "908084233851",
  appId: "1:908084233851:web:bbc5019b12827c2f5984de",
};

// Clave pública de Web Push (Firebase > Configuración del proyecto > Cloud Messaging > Certificados web push).
// Es pública. Mientras esté vacía, los avisos solo llegan con la app abierta.
export const vapidKey = 'BEVOYZemfslNCQK4_rKCjZXRzUBNykm_2kJs0VNEXLjlsWNjuwb9PbRfZzK6pD6vwsUCUnT-47cgqmXE9PU7yBs';
