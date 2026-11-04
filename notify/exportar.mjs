// Saca el estado de un usuario para que la tarea programada de Claude («Plan Séneca») pueda leerlo.
// La petición llega cifrada con la clave pública de la cuenta de servicio: { email, llave }, donde «llave»
// es una clave pública RSA temporal que Claude crea en cada ejecución. El estado sale cifrado con esa llave
// en el archivo <id>.caja de la rama «exportar» (el workflow lo sube): solo la sesión de Claude que tiene la clave privada
// puede abrirlo. El id lo pone Claude en la petición para reconocer su respuesta.
import admin from 'firebase-admin';
import { createPublicKey } from 'node:crypto';
import { writeFileSync, mkdirSync } from 'node:fs';
import { abrir, cerrar } from './caja.mjs';

const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || 'null');
if (!sa) { console.error('Falta el secreto FIREBASE_SERVICE_ACCOUNT en GitHub.'); process.exit(1); }
const raw = (process.env.DATOS || '').trim();
if (!raw) { console.error('Faltan los datos cifrados.'); process.exit(1); }

const req = abrir(raw, sa.private_key);
const llave = createPublicKey(String(req.llave || '')); // falla aquí si no es una clave pública válida
if (!/^[a-z0-9]{8,40}$/.test(req.id || '')) { console.error('Falta el id de la petición.'); process.exit(1); }

admin.initializeApp({ credential: admin.credential.cert(sa) });
const user = await admin.auth().getUserByEmail(req.email);
const doc = (await admin.firestore().doc(`users/${user.uid}`).get()).data() || {};
const state = doc.state ? JSON.parse(doc.state) : {};
for (const k of Object.keys(state)) if (Array.isArray(state[k])) state[k] = state[k].filter((x) => !x.del);
const tz = Object.values(doc.push?.tokens || {}).sort((a, b) => (b.at || 0) - (a.at || 0))[0]?.tz || 'Europe/Madrid';

const box = cerrar({ at: Date.now(), tz, state, mail: doc.mail || null, plan: doc.plan || null }, llave);
mkdirSync('salida', { recursive: true });
writeFileSync(`salida/${req.id}.caja`, box);
console.log(`Exportado: ${(state.items || []).length} elementos, zona ${tz}`);
