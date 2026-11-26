// Lo ejecuta GitHub Actions cada 10 minutos: lee los datos de cada usuario en Firestore
// y envía por Firebase Cloud Messaging los avisos que toquen.
import admin from 'firebase-admin';
import { due, localNow, prune } from './plan.mjs';
import { aplicar, limpiarPlan, limpiarCorreo } from './aplicar.mjs';

const key = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!key) {
  console.error('Falta el secreto FIREBASE_SERVICE_ACCOUNT en GitHub.');
  process.exit(1);
}
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(key)) });
const db = admin.firestore();
const DEAD = new Set(['messaging/registration-token-not-registered', 'messaging/invalid-registration-token']);

// Buzones: lo que el Claude de cada usuario deja con su clave (notify/buzon.mjs). La copia espejo/<clave>
// dice a qué usuario pertenece (solo él puede escribirla). Se aplica, se avisa y se vacía el buzón.
const push = async (ref, title, body, tag) => {
  const tokens = Object.keys((await ref.get()).data()?.push?.tokens || {});
  if (tokens.length) await admin.messaging().sendEachForMulticast({ tokens, data: { title, body, tag, url: './?v=inicio' }, webpush: { headers: { Urgency: 'normal', TTL: '36000' } } });
};
try { for (const box of (await db.collection('buzon').get()).docs) {
  const b = box.data();
  const esp = await db.doc(`espejo/${box.id}`).get();
  const uid = esp.exists ? esp.data().uid : null;
  if (!uid || !(await db.doc(`users/${uid}`).get()).exists) {
    if (Date.now() - (b.at || 0) > 3 * 864e5) await box.ref.delete(); // buzón sin dueño: se borra a los 3 días
    continue;
  }
  const ref = db.doc(`users/${uid}`);
  try {
    if (b.correo) {
      const items = limpiarCorreo(JSON.parse(b.correo).items);
      await ref.set({ mail: { at: Date.now(), items } }, { merge: true });
      const top = items.filter((x) => x.p === 2).length;
      await push(ref, 'Resumen de correo', items.length ? `${items.length} correos nuevos${top ? `, ${top} importantes` : ''}` : 'No hay correos nuevos', 'mail');
      console.log(`Buzón: correo guardado (${items.length})`);
    }
    if (b.plan) {
      const data = JSON.parse(b.plan);
      // Por el buzón solo entran tareas del plan (id plan-…) en items, y los cambios permitidos de aplicar()
      const add = { items: (data.add?.items || []).filter((x) => /^plan-\d{4}-\d{2}-\d{2}-\d+$/.test(x?.id || '') && x.type === 'task') };
      const plan = limpiarPlan(data.plan);
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const state = snap.data()?.state ? JSON.parse(snap.data().state) : {};
        aplicar(state, { add, patch: { items: data.patch?.items || [] } });
        tx.set(ref, { state: JSON.stringify(state), t: Date.now(), ...(plan ? { plan } : {}) }, { merge: true });
      });
      if (plan) await push(ref, 'Tu plan está listo', plan.frog ? `Sapo: ${plan.frog}` : 'Ábrelo en Séneca.', `plan:${plan.date}`);
      console.log(`Buzón: plan del ${plan?.date} aplicado (${add.items.length} tareas)`);
    }
    await box.ref.delete();
  } catch (e) {
    console.error(`Buzón con datos no válidos: ${e.message}`);
    await box.ref.delete();
  }
} } catch (e) { console.error(`No se pudieron leer los buzones: ${e.message}`); } // nunca debe parar los avisos

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
