// Herramienta de la tarea programada de Claude «Plan Séneca» (planifica el día siguiente cada noche).
//   node notify/planificar.mjs pedir  <carpeta> <email>        → crea una clave temporal en <carpeta> e imprime
//                                                               la petición cifrada para el workflow Exportar
//   node notify/planificar.mjs leer   <carpeta> <log> [fecha]   → saca el bloque cifrado del log de Exportar, lo abre,
//                                                               guarda <carpeta>/estado.json e imprime el resumen
//                                                               del día a planificar (por defecto, mañana)
//   node notify/planificar.mjs enviar <carpeta> <plan.json>     → comprueba el plan e imprime los datos cifrados
//                                                               para el workflow Importar
// plan.json = { email, date, add: { items: [...] }, patch: { items: [...] }, plan: { date, text, points[], frog } }
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { generateKeyPairSync } from 'node:crypto';
import { abrir, cerrar } from './caja.mjs';
import { addDays, parse } from '../dates.js';
import { itemsOn, classesOn, abcOf, abcLabel, abcCmp, frogOf, WEEKDAYS } from '../quick.js';
import { localNow } from './plan.mjs';

const PUB = process.env.SENECA_PUB || new URL('./correo-publica.pem', import.meta.url); // SENECA_PUB: solo para pruebas
const [cmd, dir, arg, arg2] = process.argv.slice(2);
const fail = (m) => { console.error(m); process.exit(1); };
if (!dir) fail('Falta la carpeta de trabajo.');
const DATE = /^\d{4}-\d{2}-\d{2}$/, TIME = /^\d{2}:\d{2}$/;

if (cmd === 'pedir') {
  if (!arg) fail('Falta el email.');
  mkdirSync(dir, { recursive: true });
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 3072 });
  writeFileSync(`${dir}/clave.pem`, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  process.stdout.write(cerrar({ email: arg, llave: publicKey.export({ type: 'spki', format: 'pem' }) }, readFileSync(PUB)));
} else if (cmd === 'leer') {
  // Cada línea del log puede llevar delante la hora de GitHub: el bloque es la última palabra de cada línea
  const log = readFileSync(arg, 'utf8').split('\n').map((l) => l.trim().split(/\s+/).pop());
  const a = log.findIndex((l) => l === 'SENECA-INICIO'), z = log.findIndex((l) => l === 'SENECA-FIN');
  if (a < 0 || z < a) fail('No encuentro el bloque cifrado en el log.');
  const data = abrir(log.slice(a + 1, z).join(''), readFileSync(`${dir}/clave.pem`));
  writeFileSync(`${dir}/estado.json`, JSON.stringify(data, null, 1));
  console.log(digest(data, arg2));
} else if (cmd === 'enviar') {
  const p = JSON.parse(readFileSync(arg, 'utf8'));
  const { state } = JSON.parse(readFileSync(`${dir}/estado.json`, 'utf8'));
  const ids = new Set((state.items || []).map((i) => i.id));
  const errs = [];
  if (!p.email) errs.push('falta email');
  if (!DATE.test(p.plan?.date || '')) errs.push('plan.date no es AAAA-MM-DD');
  for (const x of p.add?.items || []) {
    if (!/^plan-\d{4}-\d{2}-\d{2}-\d+$/.test(x.id || '')) errs.push(`id nuevo inválido: ${x.id} (usa plan-AAAA-MM-DD-n)`);
    if (x.type !== 'task' || !x.title || !DATE.test(x.date || '')) errs.push(`tarea incompleta: ${x.id}`);
    if (x.time && !TIME.test(x.time)) errs.push(`hora inválida en ${x.id}`);
    if (x.abc && !'ABCDE'.includes(x.abc)) errs.push(`abc inválido en ${x.id}`);
    if (x.subs !== undefined && !Array.isArray(x.subs)) errs.push(`subs debe ser lista en ${x.id}`);
  }
  for (const x of p.patch?.items || []) {
    if (!ids.has(x.id)) errs.push(`patch de un id que no existe: ${x.id}`);
    if (x.abc && !'ABCDE'.includes(x.abc)) errs.push(`abc inválido en ${x.id}`);
    if (x.date && !DATE.test(x.date)) errs.push(`fecha inválida en ${x.id}`);
    if (x.time && !TIME.test(x.time)) errs.push(`hora inválida en ${x.id}`);
  }
  // Cómo quedarán las tareas A de ese día (las que ya hay, con los cambios, más las nuevas): sin números repetidos
  const patched = (state.items || []).filter((i) => !i.done && !i.repeat).map((i) => ({ ...i, ...(p.patch?.items || []).find((x) => x.id === i.id) }));
  const all = [...patched.filter((i) => !(p.add?.items || []).some((x) => x.id === i.id)), ...(p.add?.items || [])];
  const ranks = all.filter((x) => x.type === 'task' && abcOf(x) === 'A' && x.date === p.plan?.date).map((x) => x.rank || 0);
  if (new Set(ranks).size !== ranks.length) errs.push(`rangos A repetidos el ${p.plan?.date}: ${ranks.join(', ')}`);
  if (errs.length) fail('Plan con errores:\n- ' + errs.join('\n- '));
  // Completa lo que la app espera en una tarea nueva
  for (const x of p.add?.items || []) {
    Object.assign(x, { place: '', time: '', done: false, tags: ['plan'], subs: [], ...x });
    x.abc ||= 'B'; x.prio = x.abc === 'A' ? 2 : x.abc === 'B' ? 1 : 0;
    if (x.abc !== 'A') delete x.rank;
    if (!x.tags.includes('plan')) x.tags.push('plan');
    x.subs = x.subs.map((s, n) => (typeof s === 'string' ? { id: `${x.id}-s${n}`, t: s, done: false } : s));
  }
  process.stdout.write(cerrar({ email: p.email, add: p.add, patch: p.patch, plan: p.plan }, readFileSync(PUB)));
} else fail('Orden desconocida: usa pedir, leer o enviar.');

// Resumen en Markdown de lo que importa para planificar un día
function digest({ at, tz, state, mail, plan }, target) {
  const now = localNow(tz, new Date(at));
  const D = target || addDays(now.day, 1);
  const items = state.items || [], classes = state.classes || [];
  const wd = (d) => WEEKDAYS[parse(d).getDay()];
  const tag = (i) => (i.tags?.length ? ` #${i.tags.join(' #')}` : '');
  const task = (i) => `[${abcLabel(i)}${i.abc ? '' : ', sin clasificar'}]${i.dur ? ` ${i.dur} min` : ''}`;
  const line = (i) => `- ${i.time ? `${i.time}${i.end ? `–${i.end}` : ''} ` : ''}${i.title}${i.place ? ` · ${i.place}` : ''}`
    + ` (${{ task: 'tarea', event: 'cita', exam: 'EXAMEN', class: 'clase' }[i.type]}${i.type === 'task' ? ` ${task(i)}` : ''}${i.done ? ', hecha' : ''}${i.repeat ? ', repetida' : ''})${tag(i)} {id: ${i.id}}`;
  const sort = (a, b) => (a.time || '99').localeCompare(b.time || '99') || abcCmp(a, b);
  const day = (d) => [...itemsOn(items, d), ...classesOn(classes, d)].sort(sort);
  const L = [];
  L.push(`# Planificar el ${wd(D)} ${D}`, `Datos de Séneca a las ${String(Math.floor(now.min / 60)).padStart(2, '0')}:${String(now.min % 60).padStart(2, '0')} del ${now.day} (${tz}).`);
  const dd = day(D);
  L.push('', `## Lo que ya hay el ${wd(D)} ${D}`, ...(dd.length ? dd.map(line) : ['- Nada']));
  const f = frogOf(dd.filter((i) => !i.done));
  L.push('', f ? `Sapo actual de ese día: ${f.title} (${abcLabel(f)})` : 'Ese día no tiene sapo (ninguna tarea A).');
  const late = items.filter((i) => i.type === 'task' && !i.repeat && !i.done && i.date < D).sort((a, b) => a.date.localeCompare(b.date));
  if (late.length) L.push('', '## Tareas pendientes de días anteriores', ...late.map((i) => `${line(i)} · era el ${i.date}`));
  const loose = items.filter((i) => i.type === 'task' && !i.repeat && !i.done && i.date > D && i.date <= addDays(D, 7));
  if (loose.length) L.push('', '## Tareas de los 7 días siguientes', ...loose.sort((a, b) => a.date.localeCompare(b.date)).map((i) => `${line(i)} · ${wd(i.date)} ${i.date}`));
  const exams = items.filter((i) => i.type === 'exam' && !i.repeat && i.date >= D && i.date <= addDays(D, 45)).sort((a, b) => a.date.localeCompare(b.date));
  if (exams.length) {
    L.push('', '## Exámenes (45 días)');
    for (const e of exams) {
      const subs = e.subs || [], left = subs.filter((s) => !s.done);
      L.push(`- ${e.title}: ${wd(e.date)} ${e.date}${e.time ? ` ${e.time}` : ''} (faltan ${Math.round((parse(e.date) - parse(D)) / 864e5)} días desde ${D})${subs.length ? ` · temario ${subs.length - left.length}/${subs.length}` : ''} {id: ${e.id}}`);
      if (left.length) L.push(`  - Temas pendientes: ${left.map((s) => s.t).join('; ')}`);
    }
  }
  const next = [];
  for (let k = 1; k <= 7; k++) {
    const d = addDays(D, k), its = itemsOn(items, d).filter((i) => i.type !== 'task' || abcOf(i) === 'A');
    if (its.length) next.push(`- ${wd(d)} ${d}: ${its.sort(sort).map((i) => `${i.time ? i.time + ' ' : ''}${i.title}${i.type === 'exam' ? ' (EXAMEN)' : i.type === 'task' ? ' (A)' : ''}`).join('; ')}`);
  }
  if (next.length) L.push('', '## Semana siguiente (citas, exámenes y tareas A)', ...next);
  const cls = classes.filter((c) => !c.until || c.until >= D);
  if (cls.length) L.push('', '## Horario de clases', ...[1, 2, 3, 4, 5, 6, 0].map((w) => {
    const cs = cls.filter((c) => c.days?.includes(w)).sort((a, b) => a.start.localeCompare(b.start));
    return cs.length ? `- ${WEEKDAYS[w]}: ${cs.map((c) => `${c.start}–${c.end} ${c.name}`).join('; ')}` : null;
  }).filter(Boolean));
  const hab = state.habits || [];
  if (hab.length) L.push('', '## Hábitos', ...hab.map((h) => `- ${h.name}: ${Array.from({ length: 7 }, (_, n) => addDays(now.day, -n)).filter((d) => h.log?.[d]).length}/7 últimos días`));
  const focus = (state.focus || []).filter((x) => x.date >= addDays(now.day, -6));
  if (focus.length) {
    const by = {};
    for (const x of focus) by[x.label] = (by[x.label] || 0) + x.min;
    L.push('', '## Estudio de los últimos 7 días (Pomodoro)', ...Object.entries(by).sort((a, b) => b[1] - a[1]).map(([l, m]) => `- ${l}: ${m} min`));
  }
  const imp = (mail?.items || []).filter((x) => x.p === 2);
  if (imp.length) L.push('', '## Correos importantes (último resumen)', ...imp.map((x) => `- ${x.uni ? '[Universidad] ' : ''}${x.from}: ${x.subject}${x.summary ? ` — ${x.summary}` : ''}`));
  const done = items.filter((i) => i.id.startsWith(`plan-${now.day}-`));
  if (done.length) L.push('', `## Cómo fue el plan de hoy (${now.day})`, ...done.map((i) => `- ${i.done ? 'hecha' : 'NO hecha'}: ${i.title}`));
  if (plan) L.push('', `Último plan guardado: ${plan.date}.`);
  return L.join('\n');
}
