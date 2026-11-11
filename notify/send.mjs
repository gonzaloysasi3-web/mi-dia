// Lo ejecuta GitHub Actions cada 10 minutos: lee los datos de cada usuario en Firestore
// y envía por Firebase Cloud Messaging los avisos que toquen.
import admin from 'firebase-admin';
import { due, localNow, prune } from './plan.mjs';

const key = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!key) {
  console.error('Falta el secreto FIREBASE_SERVICE_ACCOUNT en GitHub.');
  process.exit(1);
}
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(key)) });
const db = admin.firestore();
const DEAD = new Set(['messaging/registration-token-not-registered', 'messaging/invalid-registration-token']);

const users = await db.collection('users').get();
let total = 0;
let devices = 0;
for (const doc of users.docs) {
  const data = doc.data();
  const tokens = Object.entries(data.push?.tokens || {});
  if (!tokens.length || !data.state) continue;
  devices += tokens.length;

  const tz = tokens[0][1].tz || 'Europe/Madrid';
  const state = JSON.parse(data.state);
  const sent = { ...(data.push?.sent || {}) };
  const notes = due(state, tz, sent);
  const dead = new Set();

  for (const n of notes) {
    const res = await admin.messaging().sendEachForMulticast({
      tokens: tokens.map(([t]) => t),
      data: { title: n.title, body: n.body, tag: n.key },
      webpush: { headers: { Urgency: 'high', TTL: '3600' } },
    });
    res.responses.forEach((r, k) => { if (!r.success && DEAD.has(r.error?.code)) dead.add(tokens[k][0]); });
    sent[n.key] = localNow(tz).day;
    total += res.successCount;
  }

  // update() no admite mezclar un objeto con pares campo/valor: todo va en pares.
  // El token lleva caracteres como ':' que no valen en una ruta con puntos, por eso FieldPath.
  const args = [new admin.firestore.FieldPath('push', 'sent'), prune(sent, localNow(tz).day)];
  for (const t of dead) args.push(new admin.firestore.FieldPath('push', 'tokens', t), admin.firestore.FieldValue.delete());
  if (notes.length || dead.size) {
    try {
      await doc.ref.update(...args);
      if (dead.size) console.log(`Tokens caducados borrados: ${dead.size}`);
    } catch (e) {
      console.error(`No se pudo guardar el estado de avisos de ${doc.id}: ${e.message}`);
      process.exitCode = 1;
    }
  }
}
console.log(`Dispositivos con avisos activados: ${devices} · Avisos enviados: ${total}`);
