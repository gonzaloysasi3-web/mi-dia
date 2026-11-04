// Saca el estado de un usuario para que la tarea programada de Claude («Plan Séneca») pueda leerlo.
// La petición llega cifrada con la clave pública de la cuenta de servicio: { email, llave }, donde «llave»
// es una clave pública RSA temporal que Claude crea en cada ejecución. El estado sale cifrado con esa llave
// en el log del workflow (que es público): solo la sesión de Claude que tiene la clave privada puede abrirlo.
import admin from 'firebase-admin';
import { createPublicKey } from 'node:crypto';
import { abrir, cerrar } from './caja.mjs';

const LINE = 4000; // el bloque cifrado se parte en líneas para el log
const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || 'null');
if (!sa) { console.error('Falta el secreto FIREBASE_SERVICE_ACCOUNT en GitHub.'); process.exit(1); }
const raw = (process.env.DATOS || '').trim();
if (!raw) { console.error('Faltan los datos cifrados.'); process.exit(1); }

const req = abrir(raw, sa.private_key);
const llave = createPublicKey(String(req.llave || '')); // falla aquí si no es una clave pública válida

admin.initializeApp({ credential: admin.credential.cert(sa) });
const user = await admin.auth().getUserByEmail(req.email);
const doc = (await admin.firestore().doc(`users/${user.uid}`).get()).data() || {};
const state = doc.state ? JSON.parse(doc.state) : {};
for (const k of Object.keys(state)) if (Array.isArray(state[k])) state[k] = state[k].filter((x) => !x.del);
const tz = Object.values(doc.push?.tokens || {}).sort((a, b) => (b.at || 0) - (a.at || 0))[0]?.tz || 'Europe/Madrid';

const box = cerrar({ at: Date.now(), tz, state, mail: doc.mail || null, plan: doc.plan || null }, llave);
console.log('SENECA-INICIO');
for (let i = 0; i < box.length; i += LINE) console.log(box.slice(i, i + LINE));
console.log('SENECA-FIN');
console.log(`Exportado: ${(state.items || []).length} elementos, zona ${tz}`);
