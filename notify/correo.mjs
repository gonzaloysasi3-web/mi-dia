// Recibe el resumen de correo cifrado (lo envía la tarea programada de Claude dos veces al día),
// lo descifra con la clave de la cuenta de servicio, lo guarda en users/{uid}.mail y avisa al móvil.
// Sin datos, imprime la clave pública que usa notify/cifrar.mjs.
import admin from 'firebase-admin';
import { createPublicKey } from 'node:crypto';
import { abrir } from './caja.mjs';

const MAX = 40; // correos como mucho por resumen
const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || 'null');
if (!sa) { console.error('Falta el secreto FIREBASE_SERVICE_ACCOUNT en GitHub.'); process.exit(1); }

const raw = (process.env.DATOS || '').trim();
if (!raw) {
  console.log(createPublicKey(sa.private_key).export({ type: 'spki', format: 'pem' }));
  process.exit(0);
}

const data = abrir(raw, sa.private_key);

const str = (v, n) => String(v ?? '').slice(0, n);
const items = (Array.isArray(data.items) ? data.items : []).slice(0, MAX).map((x) => ({
  p: [0, 1, 2].includes(x.p) ? x.p : 1,
  from: str(x.from, 80), subject: str(x.subject, 160), summary: str(x.summary, 240),
  thread: /^[\w-]{1,40}$/.test(x.thread || '') ? x.thread : '',
  uni: !!x.uni,
}));
// Universidad siempre arriba: es importante por definición y va antes que el resto de importantes.
for (const x of items) if (x.uni) x.p = 2;
items.sort((a, z) => z.p - a.p || z.uni - a.uni);

admin.initializeApp({ credential: admin.credential.cert(sa) });
const user = await admin.auth().getUserByEmail(data.email);
const ref = admin.firestore().doc(`users/${user.uid}`);
await ref.set({ mail: { at: Date.now(), items } }, { merge: true });

const tokens = Object.keys((await ref.get()).data()?.push?.tokens || {});
const top = items.filter((x) => x.p === 2).length;
if (tokens.length) {
  await admin.messaging().sendEachForMulticast({
    tokens,
    data: {
      title: 'Resumen de correo',
      body: items.length ? `${items.length} correos nuevos${top ? `, ${top} importantes` : ''}` : 'No hay correos nuevos',
      tag: 'mail', url: './?v=inicio',
    },
    webpush: { headers: { Urgency: 'normal', TTL: '7200' } },
  });
}
console.log(`Resumen guardado: ${items.length} correos (${top} importantes) · dispositivos avisados: ${tokens.length}`);
