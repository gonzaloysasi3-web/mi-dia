// Aplica al estado lo que trae notify/importar.mjs. Sin red: se puede probar con datos de ejemplo.
const LISTS = ['items', 'habits', 'focus', 'counters', 'library', 'wallet', 'classes', 'accounts'];
const PATCHABLE = { items: ['abc', 'rank', 'dur', 'date', 'time', 'tags'] };
const prioOf = (abc) => (abc === 'A' ? 2 : abc === 'B' ? 1 : 0);

// add: elementos con id fijo (se crean o se sustituyen). patch: solo algunos campos de elementos
// que ya existen, sin tocar los borrados ni los hechos. Devuelve un resumen de lo hecho.
export function aplicar(state, data, now = Date.now()) {
  const out = [];
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
    out.push(`${xs.length} añadidos en ${list}`);
  }
  for (const [list, xs] of Object.entries(data.patch || {})) {
    if (!PATCHABLE[list] || !Array.isArray(xs)) continue;
    let n = 0;
    for (const x of xs) {
      const cur = (state[list] || []).find((y) => y.id === x?.id && !y.del && !y.done);
      if (!cur) continue;
      for (const k of PATCHABLE[list]) if (k in x) cur[k] = x[k];
      if ('abc' in x) { cur.prio = prioOf(x.abc); if (x.abc !== 'A') delete cur.rank; }
      cur.u = now; n++;
    }
    out.push(`${n} cambiados en ${list}`);
  }
  return out;
}

// Alta inicial que prepara el Claude de un usuario nuevo (entrevista): tareas, exámenes, citas, horario y hábitos.
// Solo ids «alta-…», campos conocidos y formatos válidos. Devuelve { errs } o { add } listo para aplicar().
export function limpiarAlta(a) {
  const DATE = /^\d{4}-\d{2}-\d{2}$/, TIME = /^\d{2}:\d{2}$/, ID = /^alta-[\w-]{1,40}$/;
  const str = (v, n) => String(v ?? '').trim().slice(0, n);
  const errs = [], add = { items: [], classes: [], habits: [] };
  for (const x of a?.items || []) {
    if (!ID.test(x?.id || '')) { errs.push(`id inválido: ${x?.id} (usa alta-…)`); continue; }
    if (!['task', 'exam', 'event'].includes(x.type)) errs.push(`tipo inválido en ${x.id} (task, exam o event)`);
    if (!str(x.title, 120)) errs.push(`falta el título en ${x.id}`);
    if (!DATE.test(x.date || '')) errs.push(`fecha inválida en ${x.id}`);
    if (x.time && !TIME.test(x.time)) errs.push(`hora inválida en ${x.id}`);
    const abc = 'ABCDE'.includes(x.abc || '-') ? x.abc : x.type === 'task' ? 'B' : undefined;
    add.items.push({
      id: x.id, type: x.type, title: str(x.title, 120), date: x.date, time: x.time || '', place: str(x.place, 80), done: false,
      tags: (Array.isArray(x.tags) ? x.tags : []).map((t) => str(t, 30)).filter(Boolean).slice(0, 5),
      ...(x.type === 'task' ? { abc, prio: abc === 'A' ? 2 : abc === 'B' ? 1 : 0, ...(abc === 'A' && x.rank ? { rank: Number(x.rank) || 1 } : {}), ...(x.dur ? { dur: Math.min(600, Number(x.dur) || 0) } : {}) } : { prio: 1 }),
      subs: (Array.isArray(x.subs) ? x.subs : []).slice(0, 40).map((s, n) => ({ id: `${x.id}-s${n}`, t: str(typeof s === 'string' ? s : s?.t, 120), done: false })).filter((s) => s.t),
    });
  }
  for (const c of a?.classes || []) {
    if (!ID.test(c?.id || '')) { errs.push(`id de clase inválido: ${c?.id}`); continue; }
    const days = (Array.isArray(c.days) ? c.days : []).map(Number).filter((d) => d >= 0 && d <= 6);
    if (!str(c.name, 80) || !days.length || !TIME.test(c.start || '') || !TIME.test(c.end || '') || c.end <= c.start) errs.push(`clase incompleta: ${c.id} (name, days 0-6 con 0 = domingo, start y end HH:MM)`);
    add.classes.push({ id: c.id, name: str(c.name, 80), days, start: c.start, end: c.end, place: str(c.place, 80), ...(DATE.test(c.until || '') ? { until: c.until } : {}) });
  }
  for (const h of a?.habits || []) {
    if (!ID.test(h?.id || '') || !str(h.name, 60)) { errs.push(`hábito incompleto: ${h?.id}`); continue; }
    add.habits.push({ id: h.id, name: str(h.name, 60), log: {} });
  }
  if (!add.items.length && !add.classes.length && !add.habits.length) errs.push('el alta está vacía');
  return errs.length ? { errs } : { add };
}

// Resumen de correo recortado y ordenado: universidad primero y siempre importante
export function limpiarCorreo(list, max = 40) {
  const str = (v, n) => String(v ?? '').slice(0, n);
  const items = (Array.isArray(list) ? list : []).slice(0, max).map((x) => ({
    p: [0, 1, 2].includes(x?.p) ? x.p : 1,
    from: str(x?.from, 80), subject: str(x?.subject, 160), summary: str(x?.summary, 240),
    thread: /^[\w-]{1,40}$/.test(x?.thread || '') ? x.thread : '',
    uni: !!x?.uni,
  }));
  for (const x of items) if (x.uni) x.p = 2;
  return items.sort((a, z) => z.p - a.p || z.uni - a.uni);
}

// El plan del día para la tarjeta de Inicio, recortado a lo que la app pinta
export function limpiarPlan(p, now = Date.now()) {
  if (!p || !/^\d{4}-\d{2}-\d{2}$/.test(p.date || '')) return null;
  const str = (v, n) => String(v ?? '').slice(0, n);
  return {
    at: now, date: p.date, text: str(p.text, 700), frog: str(p.frog, 160),
    points: (Array.isArray(p.points) ? p.points : []).slice(0, 8).map((x) => str(x, 220)).filter(Boolean),
  };
}
