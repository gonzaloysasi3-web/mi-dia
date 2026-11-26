// Herramienta de la tarea programada de Claude «Plan Séneca» (planifica el día siguiente cada noche).
//   node notify/planificar.mjs pedir  <carpeta> <email>        → crea una clave temporal en <carpeta> e imprime
//                                                               la petición cifrada para el workflow Exportar
//   node notify/planificar.mjs leer   <carpeta> [fecha]         → baja la rama «exportar» (git fetch), abre su respuesta,
//                                                               guarda <carpeta>/estado.json e imprime el resumen
//                                                               del día a planificar (por defecto, mañana).
//                                                               Si aún no está, sale con código 2: espera y repite
//   node notify/planificar.mjs enviar <carpeta> <plan.json>     → comprueba el plan e imprime los datos cifrados
//                                                               para el workflow Importar
// plan.json = { email, date, add: { items: [...] }, patch: { items: [...] }, plan: { date, text, points[], frog } }
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { abrir, cerrar } from './caja.mjs';
import { checkPlan, digest } from './planlib.mjs';

const PUB = process.env.SENECA_PUB || new URL('./correo-publica.pem', import.meta.url); // SENECA_PUB: solo para pruebas
const [cmd, dir, arg, arg2] = process.argv.slice(2);
const fail = (m) => { console.error(m); process.exit(1); };
if (!dir) fail('Falta la carpeta de trabajo.');

if (cmd === 'pedir') {
  if (!arg) fail('Falta el email.');
  mkdirSync(dir, { recursive: true });
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 3072 });
  const id = randomBytes(10).toString('hex');
  writeFileSync(`${dir}/clave.pem`, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  writeFileSync(`${dir}/id`, id);
  process.stdout.write(cerrar({ email: arg, id, llave: publicKey.export({ type: 'spki', format: 'pem' }) }, readFileSync(PUB)));
} else if (cmd === 'leer') {
  const id = readFileSync(`${dir}/id`, 'utf8').trim();
  const git = (...a) => execFileSync('git', a, { cwd: new URL('..', import.meta.url), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  let raw;
  try {
    git('fetch', '-q', 'origin', '+refs/heads/exportar:refs/remotes/origin/exportar');
    raw = git('show', `origin/exportar:${id}.caja`);
  } catch {
    console.error('Aún no está la respuesta del workflow Exportar. Espera unos segundos y repite.');
    process.exit(2);
  }
  const data = abrir(raw.trim(), readFileSync(`${dir}/clave.pem`));
  writeFileSync(`${dir}/estado.json`, JSON.stringify(data, null, 1));
  console.log(digest(data, arg));
} else if (cmd === 'enviar') {
  const p = JSON.parse(readFileSync(arg, 'utf8'));
  const { state } = JSON.parse(readFileSync(`${dir}/estado.json`, 'utf8'));
  if (!p.email) fail('Falta email en el plan.');
  const r = checkPlan(p, state);
  if (r.errs) fail('Plan con errores:\n- ' + r.errs.join('\n- '));
  process.stdout.write(cerrar({ email: p.email, ...r.out }, readFileSync(PUB)));
} else fail('Orden desconocida: usa pedir, leer o enviar.');

