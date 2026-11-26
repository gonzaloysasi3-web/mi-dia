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
