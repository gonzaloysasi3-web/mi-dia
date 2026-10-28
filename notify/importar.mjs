// Añade elementos al estado de un usuario desde fuera de la app (por ejemplo, su horario de clases
// pasado por Claude a partir de una foto). Llega cifrado: { email, add: { classes: [...] } }.
// Cada elemento lleva un id fijo: si se importa dos veces, se actualiza en vez de duplicarse.
import admin from 'firebase-admin';
import { abrir } from './caja.mjs';

const LISTS = ['items', 'habits', 'focus', 'counters', 'library', 'wallet', 'classes'];
const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || 'null');
if (!sa) { console.error('Falta el secreto FIREBASE_SERVICE_ACCOUNT en GitHub.'); process.exit(1); }
const raw = (process.env.DATOS || '').trim();
if (!raw) { console.error('Faltan los datos cifrados.'); process.exit(1); }

const data = abrir(raw, sa.private_key);
admin.initializeApp({ credential: admin.credential.cert(sa) });
const user = await admin.auth().getUserByEmail(data.email);
const ref = admin.firestore().doc(`users/${user.uid}`);

const res = await admin.firestore().runTransaction(async (tx) => {
  const snap = await tx.get(ref);
  const state = snap.exists && snap.data().state ? JSON.parse(snap.data().state) : {};
  const now = Date.now();
  const counts = {};
  for (const [list, xs] of Object.entries(data.add || {})) {
    if (!LISTS.includes(list) || !Array.isArray(xs)) continue;
    const cur = state[list] || [];
    for (const x of xs) {
      if (typeof x?.id !== 'string' || !x.id) continue;
      const i = cur.findIndex((y) => y.id === x.id);
      const obj = { ...x, u: now };
      if (i < 0) cur.push(obj); else cur[i] = obj;
    }
    state[list] = cur;
    counts[list] = xs.length;
  }
  tx.set(ref, { state: JSON.stringify(state), t: now }, { merge: true });
  return counts;
});
console.log('Importado:', Object.entries(res).map(([k, n]) => `${n} en ${k}`).join(', ') || 'nada');
