// Mete datos en el estado de un usuario desde fuera de la app. Llega cifrado:
// { email, add?: { lista: [...] }, patch?: { lista: [...] }, plan? }
// - add: elementos con id fijo; si se importa dos veces, se actualiza en vez de duplicarse
//   (así se cargó el horario de clases desde una foto, y así mete sus tareas el «Plan Séneca»).
// - patch: cambia solo algunos campos de elementos que ya existen (ver notify/aplicar.mjs).
// - plan: { date, text, points[], frog } se guarda en users/{uid}.plan (tarjeta en Inicio) y avisa al móvil.
import admin from 'firebase-admin';
import { abrir } from './caja.mjs';
import { aplicar, limpiarPlan } from './aplicar.mjs';

const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || 'null');
if (!sa) { console.error('Falta el secreto FIREBASE_SERVICE_ACCOUNT en GitHub.'); process.exit(1); }
const raw = (process.env.DATOS || '').trim();
if (!raw) { console.error('Faltan los datos cifrados.'); process.exit(1); }

const data = abrir(raw, sa.private_key);
admin.initializeApp({ credential: admin.credential.cert(sa) });
const user = await admin.auth().getUserByEmail(data.email);
const ref = admin.firestore().doc(`users/${user.uid}`);
const plan = limpiarPlan(data.plan);

const res = await admin.firestore().runTransaction(async (tx) => {
  const snap = await tx.get(ref);
  const state = snap.exists && snap.data().state ? JSON.parse(snap.data().state) : {};
  const now = Date.now();
  const out = aplicar(state, data, now);
  tx.set(ref, { state: JSON.stringify(state), t: now, ...(plan ? { plan } : {}) }, { merge: true });
  return out;
});
console.log('Importado:', res.join(', ') || 'nada');

if (plan) {
  const tokens = Object.keys((await ref.get()).data()?.push?.tokens || {});
  if (tokens.length) {
    await admin.messaging().sendEachForMulticast({
      tokens,
      data: {
        title: 'Tu plan está listo',
        body: plan.frog ? `Sapo: ${plan.frog}` : 'Ábrelo en Séneca.',
        tag: `plan:${plan.date}`, url: './?v=inicio',
      },
      webpush: { headers: { Urgency: 'normal', TTL: '36000' } },
    });
  }
  console.log(`Plan del ${plan.date} guardado · dispositivos avisados: ${tokens.length}`);
}
