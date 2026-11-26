// Herramienta para el Claude de cualquier usuario de Séneca (no hace falta acceso al repositorio ni a GitHub).
// Cada usuario crea su clave en Ajustes → «Tu Claude». Con ella:
//   node notify/buzon.mjs leer   <clave> <carpeta> [fecha]   → baja la copia de sus datos (espejo/<clave>), guarda
//                                                             <carpeta>/estado.json e imprime el resumen del día a planificar
//   node notify/buzon.mjs plan   <clave> <carpeta> <plan.json> → comprueba el plan y lo deja en su buzón
//   node notify/buzon.mjs correo <clave> <resumen.json>      → deja el resumen de correo en su buzón
// plan.json = { date, add: { items: [...] }, patch: { items: [...] }, plan: { date, text, points[], frog } }
// resumen.json = { items: [{ p, uni, from, subject, summary, thread }] }
// El servidor (notify/send.mjs, cada 10 min) recoge el buzón, lo aplica a su cuenta y le avisa al móvil.
// Habla con Firestore por REST con curl (respeta el proxy). Las reglas solo dejan leer la copia y escribir el buzón
// a quien conoce la clave; nadie puede leer el buzón ni tocar los datos de otro.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { checkPlan, digest } from './planlib.mjs';
import { limpiarCorreo } from './aplicar.mjs';

const BASE = 'https://firestore.googleapis.com/v1/projects/mi-dia-467b1/databases/(default)/documents';
const [cmd, clave, a2, a3] = process.argv.slice(2);
const fail = (m, code = 1) => { console.error(m); process.exit(code); };
if (!/^[\w-]{32,}$/.test(clave || '')) fail('Falta la clave o no es válida (cópiala de Séneca → Ajustes → Tu Claude).');

function http(method, url, body) {
  const args = ['-sS', '-X', method, '-H', 'Content-Type: application/json', '-w', '\n%{http_code}', url];
  if (body) args.push('--data-binary', '@-');
  let out;
  try { out = execFileSync('curl', args, { input: body ? JSON.stringify(body) : undefined, encoding: 'utf8', maxBuffer: 20 << 20 }); }
  catch (e) { fail(`No se pudo conectar con Firestore (${String(e.stderr || e.message).trim()}). Si el entorno bloquea firestore.googleapis.com, hay que permitir ese dominio en la red del entorno.`); }
  const i = out.lastIndexOf('\n'), code = Number(out.slice(i + 1));
  return { code, json: (() => { try { return JSON.parse(out.slice(0, i)); } catch { return null; } })(), raw: out.slice(0, i) };
}
const S = (v) => ({ stringValue: String(v) });
function drop(field, value) {
  const r = http('PATCH', `${BASE}/buzon/${clave}?updateMask.fieldPaths=${field}&updateMask.fieldPaths=at`, { fields: { [field]: S(JSON.stringify(value)), at: { integerValue: String(Date.now()) } } });
  if (r.code !== 200) fail(`Firestore no aceptó el envío (HTTP ${r.code}): ${r.raw.slice(0, 300)}`);
}

if (cmd === 'leer') {
  if (!a2) fail('Falta la carpeta de trabajo.');
  const r = http('GET', `${BASE}/espejo/${clave}`);
  if (r.code === 404 || r.code === 403) fail('No encuentro tus datos con esa clave. Abre Séneca con la sesión iniciada (se copian al abrirla) y comprueba la clave en Ajustes → Tu Claude.', 2);
  if (r.code !== 200) fail(`Firestore respondió HTTP ${r.code}: ${r.raw.slice(0, 300)}`);
  const f = r.json.fields || {};
  const data = { at: Number(f.t?.integerValue || Date.now()), tz: f.tz?.stringValue || 'Europe/Madrid', state: JSON.parse(f.state?.stringValue || '{}'), mail: f.mail?.stringValue ? JSON.parse(f.mail.stringValue) : null, plan: null };
  mkdirSync(a2, { recursive: true });
  writeFileSync(`${a2}/estado.json`, JSON.stringify(data, null, 1));
  console.log(digest(data, a3));
} else if (cmd === 'plan') {
  if (!a2 || !a3) fail('Uso: node notify/buzon.mjs plan <clave> <carpeta> <plan.json>');
  const { state } = JSON.parse(readFileSync(`${a2}/estado.json`, 'utf8'));
  const r = checkPlan(JSON.parse(readFileSync(a3, 'utf8')), state);
  if (r.errs) fail('Plan con errores:\n- ' + r.errs.join('\n- '));
  drop('plan', r.out);
  console.log(`Plan del ${r.out.plan.date} enviado: ${(r.out.add?.items || []).length} tareas nuevas, ${(r.out.patch?.items || []).length} cambiadas. Llegará a Séneca en los próximos 10-20 minutos.`);
} else if (cmd === 'correo') {
  if (!a2) fail('Uso: node notify/buzon.mjs correo <clave> <resumen.json>');
  const items = limpiarCorreo(JSON.parse(readFileSync(a2, 'utf8')).items);
  drop('correo', { items });
  console.log(`Resumen enviado: ${items.length} correos (${items.filter((x) => x.p === 2).length} importantes). Llegará a Séneca en los próximos 10-20 minutos.`);
} else fail('Orden desconocida: usa leer, plan o correo.');
