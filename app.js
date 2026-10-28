import * as sync from './sync.js';
import { pad, ymd, parse, today, addDays, diffDays } from './dates.js';
import { parseQuick, itemsOn, repeatLabel, encodeRepeat, decodeRepeat } from './quick.js';

const KEY = 'midia.v1';
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icon = (n) => `<svg class="i" aria-hidden="true"><use href="#i-${n}"/></svg>`;

/* ---------- Fechas ---------- */
const nowHM = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const fmt = (o) => { const f = new Intl.DateTimeFormat('es-ES', o); return (s) => f.format(parse(s)); };
const fLong = fmt({ weekday: 'long', day: 'numeric', month: 'long' });
const fDay = fmt({ weekday: 'long', day: 'numeric' });
const fShort = fmt({ day: 'numeric', month: 'short' });
const fWeekdayShort = fmt({ weekday: 'short', day: 'numeric' });
const fNarrow = fmt({ weekday: 'narrow' });
const fWd = fmt({ weekday: 'long' });
const mondayOf = (s) => addDays(s, -((parse(s).getDay() + 6) % 7));

/* ---------- Estado (local primero; la sincronización es opcional) ---------- */
const uid = () => crypto.randomUUID?.() ?? Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const LISTS = ['items', 'habits', 'focus', 'counters', 'library', 'wallet'];
const empty = () => Object.fromEntries(LISTS.map((k) => [k, []]));

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && Array.isArray(s.items) && Array.isArray(s.habits)) return { ...empty(), ...s };
  } catch {}
  return empty();
}
function persist() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {} }
function getPref(k, d) { try { return localStorage.getItem('midia.' + k) || d; } catch { return d; } }
function setPref(k, v) { try { localStorage.setItem('midia.' + k, v); } catch {} }

let state = load();
let view = getPref('view', 'inicio');
let calMonth = today().slice(0, 7);
let calSel = today();
let weekStart = mondayOf(today());
let editing = null;
let popId = null;
let tagFilter = '';
let subs = [];

const live = (a) => a.filter((x) => !x.del);
function upsert(list, obj) {
  obj.u = Date.now();
  const i = list.findIndex((x) => x.id === obj.id);
  if (i < 0) list.push(obj); else list[i] = obj;
}
function commit() { persist(); render(); sync.push(state); }

// Fusiona por elemento: gana el más reciente. Los borrados se guardan 30 días para que se propaguen.
function mergeList(a, b) {
  const m = new Map();
  for (const x of [...a, ...b]) {
    const y = m.get(x.id);
    if (!y || x.u > y.u) m.set(x.id, x);
  }
  return [...m.values()].filter((x) => !x.del || Date.now() - x.u < 30 * 864e5);
}
function mergeRemote(remote) {
  if (remote) state = Object.fromEntries(LISTS.map((k) => [k, mergeList(state[k] || [], remote[k] || [])]));
  persist();
  render();
  return state;
}

/* ---------- Piezas de interfaz ---------- */
function sortDay(a, b) {
  if (!!a.time !== !!b.time) return a.time ? 1 : -1;
  if (a.time !== b.time) return a.time < b.time ? -1 : 1;
  return (b.prio || 0) - (a.prio || 0) || a.title.localeCompare(b.title, 'es');
}

// Plan de estudio: reparte los temas pendientes de cada examen entre hoy y el día antes,
// que queda para repaso. Se recalcula siempre, así lo que no estudies hoy pasa a los días siguientes.
let PLAN = {};
function studyPlan(items) {
  const t = today();
  const plan = {};
  const push = (d, x) => (plan[d] ||= []).push(x);
  for (const ex of items) {
    if (ex.type !== 'exam' || ex.repeat || !ex.subs?.length || ex.date <= t) continue;
    const base = { exam: ex, time: '', prio: 0 };
    for (const s of ex.subs) {
      if (s.done && s.doneAt === t) push(t, { ...base, id: `${ex.id}:${s.id}`, type: 'study', topic: s.id, title: `Estudiar ${s.t}`, date: t, done: true });
    }
    const pending = ex.subs.filter((s) => !s.done);
    const days = diffDays(ex.date, t);
    const review = days >= 2;
    const slots = review ? days - 1 : days;
    pending.forEach((s, k) => {
      const d = addDays(t, Math.floor((k * slots) / pending.length));
      push(d, { ...base, id: `${ex.id}:${s.id}`, type: 'study', topic: s.id, title: `Estudiar ${s.t}`, date: d, done: false });
    });
    if (review) push(addDays(ex.date, -1), { ...base, id: `${ex.id}:rev`, type: 'review', title: 'Repaso general', date: addDays(ex.date, -1) });
  }
  return plan;
}
let GCAL = {};
const dayItems = (items, d, withPlan = true) => (withPlan ? [...itemsOn(items, d), ...(PLAN[d] || []), ...(GCAL[d] || [])] : itemsOn(items, d));
const isTodo = (i) => (i.type === 'task' || i.type === 'study') && !i.done;

// tt: texto de la columna de hora; null = sin columna
function row(it, tt) {
  if (it.type === 'study' || it.type === 'review') return studyRow(it, tt);
  if (it.type === 'gcal') {
    return `<li class="row${tt === null ? ' notime' : ''}">
      ${tt === null ? '' : `<span class="time">${tt}</span>`}<span class="lead gcal">${icon('event')}</span>
      <a class="body" href="${esc(it.link || '#')}" target="_blank" rel="noopener"><span class="title">${esc(it.title)}</span><span class="meta">${['Google Calendar', it.place && esc(it.place)].filter(Boolean).join(' · ')}</span></a>
    </li>`;
  }
  const task = it.type === 'task';
  const lead = task
    ? `<button type="button" class="check${it.done ? ' on' : ''}${popId === it.id && it.done ? ' pop' : ''}" data-act="toggle" data-id="${it.id}" data-date="${it.date}" role="checkbox" aria-checked="${!!it.done}" aria-label="${esc(it.title)}">${icon('check')}</button>`
    : `<span class="lead">${icon(it.type === 'exam' ? 'exam' : 'event')}</span>`;
  const meta = [];
  if (it.type === 'exam') meta.push('Examen');
  if (task && it.prio === 2) meta.push('<span class="p2">Prioridad alta</span>');
  if (it.place) meta.push(esc(it.place));
  if (it.repeat) meta.push(repeatLabel(it.repeat));
  if (it.subs?.length) meta.push(`${it.subs.filter((s) => s.done).length}/${it.subs.length} subtareas`);
  if (it.tags?.length) meta.push(it.tags.map(tagHtml).join(' '));
  return `<li class="row${tt === null ? ' notime' : ''}${it.done ? ' done' : ''}">
    ${tt === null ? '' : `<span class="time">${tt}</span>`}${lead}
    <button type="button" class="body" data-act="edit" data-id="${it.id}"><span class="title">${esc(it.title)}</span>${meta.length ? `<span class="meta">${meta.join(' · ')}</span>` : ''}</button>
  </li>`;
}

// Etiquetas: el color sigue al nombre, siempre el mismo para la misma etiqueta
const tagSlot = (t) => [...t].reduce((s, c) => s + c.charCodeAt(0), 0) % 8;
const tagHtml = (t) => `<span class="tag"><i style="background:var(--t${tagSlot(t)})"></i>${esc(t)}</span>`;
const allTags = () => [...new Set(live(state.items).flatMap((i) => i.tags || []))].sort();
const byTag = (items) => (tagFilter ? items.filter((i) => i.tags?.includes(tagFilter)) : items);
function tagFilters() {
  const tags = allTags();
  if (!tags.length) return '';
  if (tagFilter && !tags.includes(tagFilter)) tagFilter = '';
  const chip = (t, label) => `<button type="button" class="chip small" data-act="tag" data-tag="${esc(t)}" aria-pressed="${tagFilter === t}">${label}</button>`;
  return `<div class="chips filters" role="group" aria-label="Filtrar por etiqueta">${chip('', 'Todas')}${tags.map((t) => chip(t, tagHtml(t))).join('')}</div>`;
}

function studyRow(it, tt) {
  const ex = it.exam;
  const lead = it.type === 'study'
    ? `<button type="button" class="check${it.done ? ' on' : ''}${popId === it.id && it.done ? ' pop' : ''}" data-act="topic" data-id="${ex.id}" data-topic="${it.topic}" role="checkbox" aria-checked="${!!it.done}" aria-label="${esc(it.title)}">${icon('check')}</button>`
    : `<span class="lead">${icon('exam')}</span>`;
  return `<li class="row${tt === null ? ' notime' : ''}${it.done ? ' done' : ''}">
    ${tt === null ? '' : `<span class="time">${tt}</span>`}${lead}
    <button type="button" class="body" data-act="edit" data-id="${ex.id}"><span class="title">${esc(it.title)}</span><span class="meta">Para ${esc(ex.title)} · ${countLabel(ex.date).t.toLowerCase()}</span></button>
  </li>`;
}

const nowRow = (t) => `<li class="now" aria-hidden="true"><span class="time">${t}</span><span class="now-line"></span></li>`;

function dayRows(items, isToday) {
  const sorted = [...items].sort(sortDay);
  const now = nowHM();
  const hasTimed = sorted.some((i) => i.time);
  let out = '', placed = false;
  for (const it of sorted) {
    if (isToday && hasTimed && !placed && it.time && it.time > now) { out += nowRow(now); placed = true; }
    out += row(it, it.time || '');
  }
  if (isToday && hasTimed && !placed) out += nowRow(now);
  return out;
}

function countLabel(date) {
  const d = diffDays(date, today());
  if (d < 0) return { t: `Hace ${-d} ${-d === 1 ? 'día' : 'días'}`, c: 'past' };
  if (d === 0) return { t: 'Hoy', c: 'hot' };
  if (d === 1) return { t: 'Mañana', c: 'hot' };
  return { t: `En ${d} días`, c: d <= 3 ? 'hot' : '' };
}

function examRow(it) {
  const c = countLabel(it.date);
  const meta = [fLong(it.date), it.time, it.place && esc(it.place)].filter(Boolean).join(' · ');
  let prog = '';
  if (it.subs?.length) {
    const d = it.subs.filter((s) => s.done).length;
    const p = Math.round((d / it.subs.length) * 100);
    prog = `<span class="prog"><span class="prog-track" aria-hidden="true"><span style="width:${p}%"></span></span><span class="prog-txt">${d}/${it.subs.length} temas · ${p} %</span></span>`;
  }
  return `<li class="row notime">
    <span class="lead">${icon('exam')}</span>
    <button type="button" class="body" data-act="edit" data-id="${it.id}"><span class="title">${esc(it.title)}</span><span class="meta">${meta}</span>${prog}</button>
    <span class="count ${c.c}">${c.t}</span>
  </li>`;
}

function streak(h) {
  let d = today();
  if (!h.log[d]) d = addDays(d, -1);
  let n = 0;
  while (h.log[d]) { n++; d = addDays(d, -1); }
  return n;
}

/* ---------- Vistas ---------- */
function viewHoy() {
  const t = today(), now = nowHM();
  const items = byTag(live(state.items));
  const todays = dayItems(items, t, !tagFilter);
  const pending = todays.filter(isTodo).length;
  const next = todays.filter((i) => i.time && i.time >= now && !i.done).sort(sortDay)[0];
  const bits = [];
  bits.push(pending ? `${pending} por hacer` : todays.length ? 'Todo hecho' : 'Sin planes');
  if (next) bits.push(`siguiente a las ${next.time}`);

  const overdue = items.filter((i) => i.type === 'task' && !i.repeat && !i.done && i.date < t).sort((a, b) => a.date.localeCompare(b.date));
  const exams = items.filter((i) => i.type === 'exam' && !i.repeat && diffDays(i.date, t) >= 1 && diffDays(i.date, t) <= 30).sort((a, b) => a.date.localeCompare(b.date) || sortDay(a, b)).slice(0, 4);
  const habits = live(state.habits);

  let html = tagFilters() + `<div class="tabs" role="group" aria-label="Vista de hoy">
    <button type="button" data-act="hoymode" data-mode="list" aria-pressed="${hoyMode === 'list'}">Lista</button>
    <button type="button" data-act="hoymode" data-mode="blocks" aria-pressed="${hoyMode === 'blocks'}">Bloques de tiempo</button></div>`;
  if (hoyMode === 'blocks') return { title: 'Hoy', sub: [fLong(t), bits.join(' · ')], html: html + blocksHtml(todays) };
  if (overdue.length) {
    html += `<h2 class="sec sec-first">Atrasadas</h2><ul class="group">${overdue.map((i) => row(i, fShort(i.date))).join('')}</ul>`;
  }
  html += `<h2 class="sec${overdue.length ? '' : ' sec-first'}">Agenda</h2>`;
  html += todays.length
    ? `<ul class="group">${dayRows(todays, true)}</ul>`
    : `<div class="group empty"><p>Nada planeado para hoy.</p><button type="button" class="btn" data-act="add">${icon('plus')}Añadir</button></div>`;
  if (exams.length) html += `<h2 class="sec">Próximos exámenes</h2><ul class="group">${exams.map(examRow).join('')}</ul>`;
  if (habits.length) {
    html += `<h2 class="sec">Hábitos de hoy</h2><div class="chips">${habits.map((h) => {
      const on = !!h.log[t];
      return `<button type="button" class="chip" aria-pressed="${on}" data-act="hab" data-id="${h.id}" data-date="${t}">${on ? icon('check') : ''}${esc(h.name)}</button>`;
    }).join('')}</div>`;
  }
  return { title: 'Hoy', sub: [fLong(t), bits.join(' · ')], html };
}

function viewSemana() {
  const t = today();
  const end = addDays(weekStart, 6);
  const items = byTag(live(state.items));
  let html = tagFilters() + `<div class="weeknav">
    <button type="button" class="icon-btn" data-act="week" data-d="-7" aria-label="Semana anterior">${icon('prev')}</button>
    <button type="button" class="text-btn" data-act="week" data-d="0">Esta semana</button>
    <button type="button" class="icon-btn" data-act="week" data-d="7" aria-label="Semana siguiente">${icon('next')}</button>
  </div>`;
  for (let k = 0; k < 7; k++) {
    const d = addDays(weekStart, k);
    const its = dayItems(items, d, !tagFilter);
    html += `<div class="dayhead"><h2 class="${d === t ? 'today' : ''}">${fDay(d)}</h2>
      <button type="button" class="icon-btn small" data-act="addday" data-date="${d}" aria-label="Añadir el ${fDay(d)}">${icon('plus')}</button></div>`;
    html += its.length ? `<ul class="group">${dayRows(its, d === t)}</ul>` : `<p class="free">Libre</p>`;
  }
  return { title: 'Semana', sub: `${fShort(weekStart)} – ${fShort(end)}`, html };
}

function viewExamenes() {
  const t = today();
  const exams = live(state.items).filter((i) => i.type === 'exam' && !i.repeat).sort((a, b) => a.date.localeCompare(b.date) || sortDay(a, b));
  const up = exams.filter((i) => i.date >= t);
  const past = exams.filter((i) => i.date < t).reverse();
  let html = up.length
    ? `<ul class="group">${up.map(examRow).join('')}</ul>`
    : `<div class="group empty"><p>No hay exámenes próximos.</p><button type="button" class="btn" data-act="add" data-type="exam">${icon('plus')}Añadir examen</button></div>`;
  if (past.length) html += `<details class="past"><summary>Pasados (${past.length})</summary><ul class="group">${past.map(examRow).join('')}</ul></details>`;
  const n = up.length;
  return { title: 'Exámenes', sub: n ? `${n} ${n === 1 ? 'próximo' : 'próximos'}` : 'Todo despejado', html };
}

function viewHabitos() {
  const t = today();
  const habits = live(state.habits);
  const days = [-6, -5, -4, -3, -2, -1, 0].map((n) => addDays(t, n));
  let html = habits.length
    ? `<div class="group">${habits.map((h) => `<div class="habit">
        <span class="name">${esc(h.name)}</span>
        <button type="button" class="icon-btn small" data-act="habdel" data-id="${h.id}" aria-label="Eliminar ${esc(h.name)}">${icon('trash')}</button>
        <span class="streak">${streak(h) ? `Racha de ${streak(h)} ${streak(h) === 1 ? 'día' : 'días'}` : 'Sin racha'}</span>
        <div class="dots">${days.map((d) => {
          const on = !!h.log[d];
          return `<button type="button" class="dot${d === t ? ' today' : ''}" aria-pressed="${on}" data-act="hab" data-id="${h.id}" data-date="${d}" aria-label="${esc(h.name)}, ${fWd(d)} ${parse(d).getDate()}"><span>${on ? icon('check') : fNarrow(d).toUpperCase()}</span></button>`;
        }).join('')}</div>
        ${habitStatsHtml(h)}
      </div>`).join('')}</div>`
    : `<div class="group empty"><p>Aún no sigues ningún hábito.</p></div>`;
  html += `<form class="add-habit" data-form="habit"><input name="name" required maxlength="60" placeholder="Nuevo hábito, p. ej. Leer 20 min" aria-label="Nuevo hábito"><button type="submit" class="btn">Añadir</button></form>`;
  return { title: 'Hábitos', sub: 'Últimos 7 días', html };
}

/* ---------- Inicio: apartados, calendario, gráficas y listas ---------- */
const TYPES = { task: ['tarea', 'tareas'], event: ['cita', 'citas'], exam: ['examen', 'exámenes'] };
const plural = (n, [s, p]) => `${n} ${n === 1 ? s : p}`;
const fMonth = (ym) => new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric' }).format(parse(`${ym}-01`));
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function calendarHtml(items) {
  const t = today();
  const first = `${calMonth}-01`;
  let cells = '';
  for (let d = mondayOf(first); ; d = addDays(d, 1)) {
    if (d.slice(0, 7) > calMonth && parse(d).getDay() === 1) break;
    const its = dayItems(items, d).map((i) => (i.type === 'study' || i.type === 'review' ? { ...i, type: 'task' } : i.type === 'gcal' ? { ...i, type: 'event' } : i));
    const types = Object.keys(TYPES).filter((tp) => its.some((i) => i.type === tp));
    const label = fLong(d) + (types.length ? ': ' + types.map((tp) => plural(its.filter((i) => i.type === tp).length, TYPES[tp])).join(', ') : '');
    cells += `<button type="button" class="cal-day${d.slice(0, 7) !== calMonth ? ' out' : ''}${d === t ? ' today' : ''}" data-act="calday" data-date="${d}" aria-pressed="${d === calSel}" aria-label="${label}">
      <span class="n">${parse(d).getDate()}</span><span class="marks">${types.map((tp) => `<i class="mk mk-${tp}"></i>`).join('')}</span></button>`;
  }
  const sel = dayItems(items, calSel);
  return `<div class="group cal">
      <div class="cal-head">
        <h3>${cap(fMonth(calMonth))}</h3>
        <div class="cal-nav">
          <button type="button" class="icon-btn small" data-act="cal" data-d="-1" aria-label="Mes anterior">${icon('prev')}</button>
          <button type="button" class="text-btn" data-act="cal" data-d="0">Hoy</button>
          <button type="button" class="icon-btn small" data-act="cal" data-d="1" aria-label="Mes siguiente">${icon('next')}</button>
        </div>
      </div>
      <div class="cal-grid" role="group" aria-label="${fMonth(calMonth)}">
        ${['L', 'M', 'X', 'J', 'V', 'S', 'D'].map((w) => `<span class="wd" aria-hidden="true">${w}</span>`).join('')}${cells}
      </div>
      <ul class="legend" aria-hidden="true"><li><i class="mk mk-task"></i>Tarea</li><li><i class="mk mk-event"></i>Cita</li><li><i class="mk mk-exam"></i>Examen</li></ul>
    </div>
    <div class="dayhead"><h2>${fDay(calSel)}</h2>
      <button type="button" class="icon-btn small" data-act="addday" data-date="${calSel}" aria-label="Añadir el ${fDay(calSel)}">${icon('plus')}</button></div>
    ${sel.length ? `<ul class="group">${dayRows(sel, calSel === today())}</ul>` : '<p class="free">Libre</p>'}`;
}

function tasksChart(items) {
  const t = today();
  const data = [-6, -5, -4, -3, -2, -1, 0].map((n) => {
    const d = addDays(t, n);
    const ts = itemsOn(items, d).filter((i) => i.type === 'task');
    return { d, done: ts.filter((i) => i.done).length, pend: ts.filter((i) => !i.done).length };
  });
  const total = data.reduce((s, x) => s + x.done + x.pend, 0);
  if (!total) return '<div class="group chart"><p class="free">No hay tareas en los últimos 7 días.</p></div>';
  const done = data.reduce((s, x) => s + x.done, 0);
  const max = Math.max(...data.map((x) => x.done + x.pend));
  const cols = data.map((x) => {
    const tot = x.done + x.pend;
    const day = cap(fWeekdayShort(x.d));
    return `<div class="col" tabindex="0" data-tip="${plural(x.done, ['hecha', 'hechas'])} · ${plural(x.pend, ['pendiente', 'pendientes'])}" data-tip-title="${day}" aria-label="${day}: ${plural(x.done, ['hecha', 'hechas'])}, ${plural(x.pend, ['pendiente', 'pendientes'])}">
      <div class="col-plot"><span class="col-val">${tot || ''}</span>
        <div class="col-bar" style="height:${Math.round((tot / max) * 112)}px">${x.pend ? `<span class="bseg bseg-pend" style="flex:${x.pend}"></span>` : ''}${x.done ? `<span class="bseg bseg-done" style="flex:${x.done}"></span>` : ''}</div>
      </div>
      <span class="col-x${x.d === t ? ' now-x' : ''}">${fNarrow(x.d).toUpperCase()}<b>${parse(x.d).getDate()}</b></span>
    </div>`;
  }).join('');
  return `<div class="group chart">
      <p class="chart-sum">${done} de ${total} hechas <span>(${Math.round((done / total) * 100)} %)</span></p>
      <ul class="legend"><li><i class="sw sw-done"></i>Hechas</li><li><i class="sw sw-pend"></i>Pendientes</li></ul>
      <div class="cols">${cols}</div>
      <details class="tbl"><summary>Ver tabla</summary><table>
        <thead><tr><th scope="col">Día</th><th scope="col">Hechas</th><th scope="col">Pendientes</th></tr></thead>
        <tbody>${data.map((x) => `<tr><th scope="row">${cap(fWeekdayShort(x.d))}</th><td>${x.done}</td><td>${x.pend}</td></tr>`).join('')}</tbody>
      </table></details>
    </div>`;
}

function habitsChart(habits) {
  if (!habits.length) return `<div class="group chart empty"><p>Añade hábitos para ver su progreso.</p><button type="button" class="text-btn" data-act="go" data-view="habitos">Ir a Hábitos</button></div>`;
  const days = Array.from({ length: 30 }, (_, n) => addDays(today(), -n));
  return `<div class="group chart">${habits.map((h) => {
    const n = days.filter((d) => h.log[d]).length;
    const pct = Math.round((n / 30) * 100);
    return `<div class="hbar" tabindex="0" data-tip="${n} de 30 días" data-tip-title="${esc(h.name)}" aria-label="${esc(h.name)}: ${pct} %, ${n} de 30 días">
      <span class="hname">${esc(h.name)}</span><span class="track"><span class="fill" style="width:${pct}%"></span></span><span class="hpct">${pct} %</span></div>`;
  }).join('')}</div>`;
}

const hm = (m) => (m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}` : `${m} min`);
function focusChart() {
  const t = today(), from = addDays(t, -6);
  const logs = live(state.focus).filter((f) => f.date >= from && f.date <= t);
  if (!logs.length) return '<div class="group chart"><p class="free">Pulsa «Concentrarme» al editar una tarea o un examen para registrar tu tiempo de estudio.</p></div>';
  const by = {};
  for (const f of logs) by[f.label] = (by[f.label] || 0) + f.min;
  const rows = Object.entries(by).sort((x, y) => y[1] - x[1]);
  const total = rows.reduce((s, r) => s + r[1], 0);
  return `<div class="group chart"><p class="chart-sum">${hm(total)} <span>en total</span></p>${rows.map(([l, m]) => `
    <div class="hbar wide-val" tabindex="0" data-tip="${hm(m)}" data-tip-title="${esc(l)}" aria-label="${esc(l)}: ${hm(m)}">
      <span class="hname">${esc(l)}</span><span class="track"><span class="fill" style="width:${Math.round((m / rows[0][1]) * 100)}%"></span></span><span class="hpct">${hm(m)}</span></div>`).join('')}</div>`;
}

function viewInicio() {
  const t = today(), now = nowHM();
  const items = live(state.items);
  const habits = live(state.habits);
  const todays = dayItems(items, t);
  const pending = todays.filter(isTodo).length;
  const wk = mondayOf(t);
  const weekCount = [0, 1, 2, 3, 4, 5, 6].reduce((s, k) => s + dayItems(items, addDays(wk, k)).length, 0);
  const exams = items.filter((i) => i.type === 'exam' && !i.repeat && i.date >= t).sort((a, b) => a.date.localeCompare(b.date) || sortDay(a, b));
  const habitsDone = habits.filter((h) => h.log[t]).length;
  const next = todays.filter((i) => !i.done && (!i.time || i.time >= now)).sort(sortDay).slice(0, 5);

  const tiles = [
    ['hoy', 'hoy', 'Hoy', pending ? `${pending} por hacer` : todays.length ? 'Todo hecho' : 'Sin planes'],
    ['semana', 'semana', 'Semana', weekCount ? plural(weekCount, ['elemento', 'elementos']) : 'Libre'],
    ['examenes', 'exam', 'Exámenes', exams.length ? plural(exams.length, ['próximo', 'próximos']) : 'Ninguno'],
    ['habitos', 'habitos', 'Hábitos', habits.length ? `${habitsDone} de ${habits.length} hoy` : 'Sin hábitos'],
    ['biblioteca', 'library', 'Biblioteca', libSummary()],
    ['contadores', 'counter', 'Contadores', plural(live(state.counters).length, ['contador', 'contadores'])],
  ];
  const h = new Date().getHours();
  const hello = h < 6 ? 'Buenas noches' : h < 14 ? 'Buenos días' : h < 21 ? 'Buenas tardes' : 'Buenas noches';

  const sunday = parse(t).getDay() === 0;
  const nowLib = live(state.library).filter((x) => x.status === 'now').sort((x, y) => y.u - x.u).slice(0, 4);
  const html = `${sunday ? `<div class="banner"><p>Es domingo: buen momento para tu revisión semanal.</p><button type="button" class="text-btn" data-act="go" data-view="revision">Abrir revisión</button></div>` : ''}
    <nav class="tiles" aria-label="Apartados">${tiles.map(([v, ic, name, sum]) => `
      <button type="button" class="tile" data-act="go" data-view="${v}">${icon(ic)}<span class="tile-name">${name}</span><span class="tile-sum">${sum}</span></button>`).join('')}
    </nav>
    <div class="dash"><div class="dash-col">
      <section class="p-next" aria-labelledby="h-next"><h2 class="sec" id="h-next">A continuación</h2>
        ${next.length ? `<ul class="group">${next.map((i) => row(i, i.time || '')).join('')}</ul>`
          : `<div class="group empty"><p>${todays.length ? 'Nada más por hoy.' : 'Nada planeado para hoy.'}</p><button type="button" class="btn" data-act="add">${icon('plus')}Añadir</button></div>`}
      </section>
      <section class="p-exam" aria-labelledby="h-exam"><h2 class="sec" id="h-exam">Próximos exámenes</h2>
        ${exams.length ? `<ul class="group">${exams.slice(0, 4).map(examRow).join('')}</ul>` : '<p class="free">No hay exámenes próximos.</p>'}
      </section>
      <section class="p-tasks" aria-labelledby="h-tasks"><h2 class="sec" id="h-tasks">Tareas, últimos 7 días</h2>${tasksChart(items)}</section>
      <section class="p-lib" aria-labelledby="h-lib"><h2 class="sec" id="h-lib">Leyendo y jugando</h2>
        ${nowLib.length ? `<ul class="group">${nowLib.map(libRow).join('')}</ul>`
          : `<div class="group empty"><p>Añade lo que estás leyendo o jugando.</p><button type="button" class="text-btn" data-act="go" data-view="biblioteca">Ir a la biblioteca</button></div>`}
      </section>
    </div><div class="dash-col">
      <section class="p-wallet" aria-labelledby="h-wallet"><h2 class="sec" id="h-wallet">Cartera, ${fMonth(t.slice(0, 7))}</h2>
        ${live(state.wallet).length ? `<button type="button" class="group chart w-link" data-act="go" data-view="cartera" aria-label="Abrir Cartera">${walletDonut(t.slice(0, 7))}</button>`
          : `<div class="group empty"><p>Apunta tus ingresos y gastos para ver el mes de un vistazo.</p><button type="button" class="text-btn" data-act="go" data-view="cartera">Ir a Cartera</button></div>`}
      </section>
      <section class="p-cal" aria-labelledby="h-cal"><h2 class="sec" id="h-cal">Calendario</h2>${calendarHtml(items)}</section>
      <section class="p-hab" aria-labelledby="h-hab"><h2 class="sec" id="h-hab">Hábitos, últimos 30 días</h2>${habitsChart(habits)}</section>
      <section class="p-focus" aria-labelledby="h-focus"><h2 class="sec" id="h-focus">Estudio, últimos 7 días</h2>${focusChart()}</section>
    </div></div>`;
  return { title: 'Inicio', sub: [`${hello}. ${cap(fLong(t))}.`], html };
}

/* ---------- Hoy: bloques de tiempo ---------- */
let hoyMode = getPref('hoyMode', 'list');
let blockSel = null;
const fixedBlock = (i) => i.type === 'study' || i.type === 'review' || i.type === 'gcal';

function blocksHtml(todays) {
  const loose = todays.filter((i) => !i.time && !i.done && !fixedBlock(i));
  const timed = todays.filter((i) => i.time);
  const first = Math.min(7, ...timed.map((i) => Number(i.time.slice(0, 2))));
  const chip = (i, label) => `<button type="button" class="block${i.done ? ' done' : ''}" draggable="true" data-act="bsel" data-id="${i.id}" aria-pressed="${blockSel === i.id}">${label}</button>`;
  let html = `<p class="note">Arrastra una tarea a una hora, o tócala y después toca la hora. Si tocas una hora sin elegir nada, creas algo nuevo a esa hora.</p>
    <h2 class="sec">Sin hora</h2>
    <div class="loose" data-drop="">${loose.length ? loose.map((i) => chip(i, esc(i.title))).join('') : '<span class="free">Todo tiene hora.</span>'}</div>
    <ol class="hours">`;
  for (let h = first; h <= 23; h++) {
    const hh = `${pad(h)}:00`;
    const at = timed.filter((i) => i.time.slice(0, 2) === pad(h)).sort(sortDay);
    html += `<li class="hour" data-drop="${hh}">
      <button type="button" class="hour-btn" data-act="bput" data-time="${hh}" aria-label="${blockSel ? 'Mover a las' : 'Añadir a las'} ${hh}">${hh}</button>
      <div class="hour-items">${at.map((i) => (fixedBlock(i) ? `<span class="block fixed">${i.time} ${esc(i.title)}</span>` : chip(i, `${i.time} ${esc(i.title)}`))).join('')}</div>
    </li>`;
  }
  html += '</ol>';
  if (blockSel) html += `<button type="button" class="text-btn" data-act="bput" data-time="">Quitar la hora</button>`;
  return html;
}

function setTime(id, time) {
  const it = state.items.find((x) => x.id === id);
  if (!it) return;
  upsert(state.items, { ...it, time });
  blockSel = null;
  commit();
}

$('#view').addEventListener('dragstart', (e) => {
  const el = e.target.closest('[draggable][data-id]');
  if (el) e.dataTransfer.setData('text/plain', el.dataset.id);
});
$('#view').addEventListener('dragover', (e) => {
  const z = e.target.closest('[data-drop]');
  if (!z) return;
  e.preventDefault();
  document.querySelectorAll('.drop-on').forEach((x) => x !== z && x.classList.remove('drop-on'));
  z.classList.add('drop-on');
});
$('#view').addEventListener('dragleave', (e) => { e.target.closest('[data-drop]')?.classList.remove('drop-on'); });
$('#view').addEventListener('drop', (e) => {
  const z = e.target.closest('[data-drop]');
  const id = e.dataTransfer.getData('text/plain');
  if (!z || !id) return;
  e.preventDefault();
  setTime(id, z.dataset.drop);
});

/* ---------- Hábitos: estadísticas ---------- */
function habitStatsHtml(h) {
  const t = today();
  let month = 0, year = 0;
  for (let k = 0; k < 365; k++) if (h.log[addDays(t, -k)]) { year++; if (k < 30) month++; }
  let best = 0, run = 0, prev = null;
  for (const d of Object.keys(h.log).sort()) {
    run = prev && diffDays(d, prev) === 1 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  const start = mondayOf(addDays(t, -7 * 52));
  let cells = '';
  for (let d = start; d <= t; d = addDays(d, 1)) cells += `<i class="hm${h.log[d] ? ' on' : ''}"></i>`;
  return `<p class="h-stats">30 días: ${Math.round((month / 30) * 100)} % · Último año: ${plural(year, ['día', 'días'])} · Mejor racha: ${plural(best, ['día', 'días'])}</p>
    <div class="hm-wrap"><div class="hm-grid" role="img" aria-label="${esc(h.name)}: cumplido ${year} de los últimos 365 días">${cells}</div></div>`;
}

/* ---------- Biblioteca: libros y juegos ---------- */
let libTab = getPref('libTab', 'book');
const LIB = {
  book: { one: 'libro', by: 'Autor', st: { now: 'Leyendo', todo: 'Pendiente', done: 'Leído', dropped: 'Abandonado' } },
  game: { one: 'juego', by: 'Plataforma', st: { now: 'Jugando', todo: 'Pendiente', done: 'Completado', dropped: 'Abandonado' } },
};
const libPct = (x) => (x.kind === 'book' ? (x.total ? Math.min(100, Math.round(((x.cur || 0) / x.total) * 100)) : 0) : x.pct || 0);
function libSummary() {
  const lib = live(state.library).filter((x) => x.status === 'now');
  const b = lib.filter((x) => x.kind === 'book').length, g = lib.filter((x) => x.kind === 'game').length;
  return b || g ? `${b} leyendo · ${g} jugando` : 'Libros y juegos';
}

function libRow(x) {
  const L = LIB[x.kind];
  const pct = libPct(x);
  const meta = [x.by && esc(x.by), L.st[x.status], x.kind === 'game' && x.hours ? hm(Math.round(x.hours * 60)) + ' jugadas' : '', x.rating ? `Valoración ${x.rating}/5` : ''].filter(Boolean).join(' · ');
  const progTxt = x.kind === 'book' ? (x.total ? `Pág. ${x.cur || 0} de ${x.total} · ${pct} %` : '') : pct ? `${pct} % completado` : '';
  const quick = x.status !== 'now' ? ''
    : x.kind === 'book'
      ? `<button type="button" class="mini-btn" data-act="libplus" data-id="${x.id}" aria-label="Sumar 10 páginas a ${esc(x.title)}">+10 págs</button>`
      : `<button type="button" class="mini-btn" data-act="libplus" data-id="${x.id}" aria-label="Sumar 1 hora a ${esc(x.title)}">+1 h</button>`;
  return `<li class="row notime"><span class="lead">${icon(x.kind)}</span>
    <button type="button" class="body" data-act="libedit" data-id="${x.id}"><span class="title">${esc(x.title)}</span><span class="meta">${meta}</span>
    ${progTxt ? `<span class="prog"><span class="prog-track" aria-hidden="true"><span style="width:${pct}%"></span></span><span class="prog-txt">${progTxt}</span></span>` : ''}</button>${quick}</li>`;
}

function viewBiblioteca() {
  const L = LIB[libTab];
  const all = live(state.library).filter((x) => x.kind === libTab);
  let html = `<div class="tabs" role="group" aria-label="Tipo">
    <button type="button" data-act="libtab" data-tab="book" aria-pressed="${libTab === 'book'}">Libros</button>
    <button type="button" data-act="libtab" data-tab="game" aria-pressed="${libTab === 'game'}">Juegos</button></div>`;
  for (const st of ['now', 'todo', 'done', 'dropped']) {
    const xs = all.filter((x) => x.status === st).sort((x, y) => y.u - x.u);
    if (!xs.length) continue;
    const list = `<ul class="group">${xs.map(libRow).join('')}</ul>`;
    html += st === 'done' || st === 'dropped'
      ? `<details class="past"><summary>${L.st[st]} (${xs.length})</summary>${list}</details>`
      : `<h2 class="sec">${L.st[st]}</h2>${list}`;
  }
  if (!all.length) html += `<div class="group empty"><p>Aún no has añadido ningún ${L.one}.</p></div>`;
  html += `<button type="button" class="btn lib-add" data-act="libnew">${icon('plus')}Añadir ${L.one}</button>`;
  const n = all.filter((x) => x.status === 'now').length;
  return { title: 'Biblioteca', sub: libTab === 'book' ? `${n} leyendo ahora` : `${n} jugando ahora`, html };
}

const libDlg = $('#libSheet');
const libForm = $('#libForm');
let libEditing = null;
function openLib(x) {
  libEditing = x;
  libForm.reset();
  const kind = x?.kind || libTab;
  const L = LIB[kind];
  libForm.dataset.kind = kind;
  $('#libTitle').textContent = x ? `Editar ${L.one}` : `Nuevo ${L.one}`;
  $('#lblBy').textContent = L.by;
  libForm.status.innerHTML = Object.entries(L.st).map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
  libForm.title.value = x?.title || '';
  libForm.by.value = x?.by || '';
  libForm.status.value = x?.status || 'now';
  libForm.total.value = x?.total || '';
  libForm.cur.value = x?.cur || '';
  libForm.hours.value = x?.hours || '';
  libForm.pct.value = x?.pct || '';
  libForm.rating.value = String(x?.rating || 0);
  libForm.notes.value = x?.notes || '';
  $('#fldBook').hidden = kind !== 'book';
  $('#fldGame').hidden = kind !== 'game';
  $('#libDel').hidden = !x;
  libDlg.showModal();
  if (!x) libForm.title.focus();
}
libForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const f = new FormData(libForm);
  const title = String(f.get('title')).trim();
  if (!title) return;
  const kind = libForm.dataset.kind;
  const status = f.get('status');
  const num = (k) => { const v = parseFloat(String(f.get(k)).replace(',', '.')); return Number.isFinite(v) && v >= 0 ? v : 0; };
  const x = libEditing ? { ...libEditing } : { id: uid(), kind };
  Object.assign(x, { title, by: String(f.get('by')).trim(), status, rating: Number(f.get('rating')), notes: String(f.get('notes')).trim() });
  if (kind === 'book') {
    x.total = Math.round(num('total'));
    x.cur = Math.min(Math.round(num('cur')), x.total || Infinity);
    if (status === 'done' && x.total) x.cur = x.total;
  } else {
    x.hours = Math.round(num('hours') * 10) / 10;
    x.pct = Math.min(100, Math.round(num('pct')));
    if (status === 'done') x.pct = 100;
  }
  if (status === 'now' && !x.start) x.start = today();
  if (status === 'done' && !x.end) x.end = today();
  upsert(state.library, x);
  libDlg.close();
  commit();
});
$('#libDel').addEventListener('click', () => {
  const x = state.library.find((y) => y.id === libEditing.id);
  libDlg.close();
  remove(state.library, x, 'Eliminado de la biblioteca');
});
libDlg.addEventListener('click', (e) => { if (e.target === libDlg || e.target.closest('[data-close]')) libDlg.close(); });

/* ---------- Contadores ---------- */
const num0 = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace('.', ','));
const counterTotal = (c, from) => Object.entries(c.log || {}).reduce((s, [d, v]) => (!from || d >= from ? s + v : s), 0);
function viewContadores() {
  const cs = live(state.counters);
  const wk = mondayOf(today());
  let html = cs.length ? `<div class="group">${cs.map((c) => {
    const tot = counterTotal(c), week = counterTotal(c, wk);
    const u = c.unit ? ' ' + esc(c.unit) : '';
    const pct = c.goal ? Math.min(100, Math.round((tot / c.goal) * 100)) : 0;
    return `<div class="counter">
      <div class="c-main">
        <span class="name">${esc(c.name)}</span>
        <span class="c-val">${num0(Math.round(tot * 100) / 100)}${u}</span>
        <span class="streak">Esta semana: ${num0(Math.round(week * 100) / 100)}${u}${c.goal ? ` · Meta ${num0(c.goal)}${u} (${pct} %)` : ''}</span>
        ${c.goal ? `<span class="prog-track c-goal" aria-hidden="true"><span style="width:${pct}%"></span></span>` : ''}
      </div>
      <div class="c-btns">
        <button type="button" class="c-btn" data-act="cnt" data-id="${c.id}" data-d="-1" aria-label="Restar ${num0(c.step)} a ${esc(c.name)}">${icon('minus')}</button>
        <button type="button" class="c-btn c-plus" data-act="cnt" data-id="${c.id}" data-d="1" aria-label="Sumar ${num0(c.step)} a ${esc(c.name)}">${icon('plus')}</button>
        <button type="button" class="icon-btn small" data-act="cntdel" data-id="${c.id}" aria-label="Eliminar ${esc(c.name)}">${icon('trash')}</button>
      </div>
    </div>`;
  }).join('')}</div>` : '<div class="group empty"><p>Crea un contador para el gimnasio, el ahorro de un viaje o lo que quieras llevar.</p></div>';
  html += `<h2 class="sec">Nuevo contador</h2>
    <form class="group c-form" data-form="counter">
      <label class="field"><span>Nombre</span><input name="name" required maxlength="50" placeholder="Ahorro viaje"></label>
      <div class="two">
        <label class="field"><span>Unidad</span><input name="unit" maxlength="12" placeholder="€, sesiones…"></label>
        <label class="field"><span>Cada toque suma</span><input name="step" inputmode="decimal" value="1"></label>
      </div>
      <label class="field"><span>Meta (opcional)</span><input name="goal" inputmode="decimal" placeholder="600"></label>
      <button type="submit" class="btn">Crear contador</button>
    </form>`;
  return { title: 'Contadores', sub: 'Gimnasio, ahorro y lo que quieras llevar', html };
}
function addCounter(e) {
  e.preventDefault();
  const f = new FormData(e.target);
  const n = (k) => { const v = parseFloat(String(f.get(k)).replace(',', '.')); return Number.isFinite(v) && v > 0 ? v : 0; };
  const name = String(f.get('name')).trim();
  if (!name) return;
  upsert(state.counters, { id: uid(), name, unit: String(f.get('unit')).trim(), step: n('step') || 1, goal: n('goal'), log: {} });
  commit();
}

/* ---------- Cartera: ingresos y gastos ---------- */
const WCATS = {
  in: ['Nómina', 'Cobro', 'Bizum', 'Reembolso', 'Otros'],
  out: ['Alquiler', 'Comida', 'Transporte', 'Ocio', 'Suscripciones', 'Salud', 'Compras', 'Facturas', 'Otros'],
};
let walMonth = today().slice(0, 7);
const eur = (n) => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: n % 1 ? 2 : 0 }).format(n);
const r2 = (n) => Math.round(n * 100) / 100;

// Movimientos de un mes (AAAA-MM). Los mensuales se repiten desde su mes de inicio, el mismo día (o el último del mes).
function walletMonth(ym) {
  const [y, m] = ym.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  const out = [];
  for (const x of live(state.wallet)) {
    if (x.monthly) {
      if (x.date.slice(0, 7) <= ym) out.push({ ...x, day: `${ym}-${pad(Math.min(Number(x.date.slice(8, 10)), last))}` });
    } else if (x.date.slice(0, 7) === ym) out.push({ ...x, day: x.date });
  }
  return out.sort((a, b) => b.day.localeCompare(a.day) || b.u - a.u);
}
function walletTotals(ym) {
  const xs = walletMonth(ym);
  const sum = (k) => r2(xs.filter((x) => x.kind === k).reduce((s, x) => s + x.amount, 0));
  const inc = sum('in'), exp = sum('out');
  return { xs, inc, exp, bal: r2(inc - exp) };
}

// Gráfico circular: ingresos contra gastos, con el saldo en el centro.
function walletDonut(ym) {
  const { inc, exp, bal } = walletTotals(ym);
  const tot = inc + exp;
  const a = tot ? (inc / tot) * 100 : 0;
  const seg = (cls, len, off) => (len > 0 ? `<circle class="${cls}" cx="21" cy="21" r="15.915" pathLength="100" stroke-dasharray="${len} ${100 - len}" stroke-dashoffset="${-off}"/>` : '');
  return `<div class="w-sum">
    <svg class="donut" viewBox="0 0 42 42" role="img" aria-label="Ingresos ${eur(inc)}, gastos ${eur(exp)}, saldo ${eur(bal)}">
      <circle class="d-track" cx="21" cy="21" r="15.915"/>${seg('d-in', a, 0)}${seg('d-out', tot ? 100 - a : 0, a)}
      <text x="21" y="20" class="d-lbl">Saldo</text><text x="21" y="25.5" class="d-val">${eur(bal)}</text>
    </svg>
    <dl class="w-legend">
      <div><dt><i class="w-dot in"></i>Ingresos</dt><dd>${eur(inc)}</dd></div>
      <div><dt><i class="w-dot out"></i>Gastos</dt><dd>${eur(exp)}</dd></div>
      <div class="w-bal"><dt>Saldo</dt><dd class="${bal < 0 ? 'neg' : ''}">${eur(bal)}</dd></div>
    </dl>
  </div>`;
}
function walletSummary() {
  const { inc, exp, bal } = walletTotals(today().slice(0, 7));
  return inc || exp ? `Saldo del mes ${eur(bal)}` : 'Ingresos y gastos';
}

function walletRow(x) {
  const sign = x.kind === 'in' ? '+' : '−';
  const meta = [cap(fShort(x.day)), esc(x.cat), x.monthly ? 'Cada mes' : ''].filter(Boolean).join(' · ');
  return `<li class="row notime"><span class="lead w-${x.kind}">${icon(x.kind === 'in' ? 'plus' : 'minus')}</span>
    <button type="button" class="body" data-act="walledit" data-id="${x.id}"><span class="title">${esc(x.title || x.cat)}</span><span class="meta">${meta}</span></button>
    <b class="w-amt ${x.kind}">${sign}${eur(x.amount)}</b></li>`;
}

function viewCartera() {
  const { xs, inc, exp } = walletTotals(walMonth);
  const cats = {};
  for (const x of xs) if (x.kind === 'out') cats[x.cat] = r2((cats[x.cat] || 0) + x.amount);
  const top = Object.entries(cats).sort((a, b) => b[1] - a[1]);
  let html = `<div class="w-month">
    <button type="button" class="icon-btn" data-act="walmonth" data-d="-1" aria-label="Mes anterior">${icon('prev')}</button>
    <h2>${cap(fMonth(walMonth))}</h2>
    <button type="button" class="icon-btn" data-act="walmonth" data-d="1" aria-label="Mes siguiente">${icon('next')}</button>
    ${walMonth !== today().slice(0, 7) ? `<button type="button" class="text-btn" data-act="walmonth" data-d="0">Este mes</button>` : ''}
  </div>
  <div class="group chart">${walletDonut(walMonth)}</div>`;
  if (top.length) html += `<h2 class="sec">Gastos por categoría</h2><div class="group chart">${top.map(([c, v]) => `
    <div class="hbar wide-val" tabindex="0" aria-label="${esc(c)}: ${eur(v)}">
      <span class="hname">${esc(c)}</span><span class="track"><span class="fill w-fill" style="width:${Math.round((v / top[0][1]) * 100)}%"></span></span><span class="hpct">${eur(v)}</span></div>`).join('')}</div>`;
  html += `<h2 class="sec">Movimientos</h2>` + (xs.length ? `<ul class="group">${xs.map(walletRow).join('')}</ul>`
    : `<div class="group empty"><p>No hay movimientos este mes.</p></div>`);
  html += `<button type="button" class="btn lib-add" data-act="walnew">${icon('plus')}Añadir movimiento</button>
  <details class="past w-import"><summary>Importar movimientos</summary>
    <form class="group c-form" data-form="walimport">
      <label class="field"><span>Pega aquí el texto exportado de Wallet o elige el archivo</span>
        <textarea name="json" rows="4" placeholder='[{"kind":"out","amount":12,"title":"Sushi","cat":"Comida","date":"2026-10-16"}]'></textarea></label>
      <input type="file" name="file" accept=".json,application/json" aria-label="Archivo de movimientos">
      <button type="submit" class="btn">Importar</button>
    </form>
  </details>`;
  return { title: 'Cartera', sub: inc || exp ? `${eur(inc)} de ingresos · ${eur(exp)} de gastos` : cap(fMonth(walMonth)), html };
}

// Importa movimientos con el formato de Wallet. Los que ya existen (mismo id) se actualizan, no se duplican.
function importWallet(list) {
  if (!Array.isArray(list)) throw new Error('formato');
  let n = 0;
  for (const e of list) {
    const amount = Number(e?.amount);
    if (!['in', 'out'].includes(e?.kind) || !(amount > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(e?.date)) continue;
    upsert(state.wallet, {
      id: typeof e.id === 'string' && e.id ? e.id : uid(), kind: e.kind, amount: r2(amount),
      title: String(e.title || '').slice(0, 120), cat: String(e.cat || 'Otros').slice(0, 40), date: e.date, monthly: !!e.monthly,
    });
    n++;
  }
  return n;
}
async function onWalletImport(e) {
  e.preventDefault();
  const f = e.target;
  const file = f.file.files[0];
  try {
    const n = importWallet(JSON.parse(file ? await file.text() : f.json.value));
    if (!n) return toast('No había movimientos válidos para importar.');
    walMonth = today().slice(0, 7);
    commit();
    toast(`${plural(n, ['movimiento importado', 'movimientos importados'])}.`);
  } catch { toast('No se pudo leer. Comprueba que el texto está completo.'); }
}

const walDlg = $('#walSheet');
const walForm = $('#walForm');
let walEditing = null;
function walCats(kind, sel) {
  walForm.cat.innerHTML = WCATS[kind].map((c) => `<option>${esc(c)}</option>`).join('');
  walForm.cat.value = WCATS[kind].includes(sel) ? sel : WCATS[kind][0];
}
function openWallet(x) {
  walEditing = x;
  walForm.reset();
  const kind = x?.kind || 'out';
  $('#walTitle').textContent = x ? 'Editar movimiento' : 'Nuevo movimiento';
  walForm.kind.value = kind;
  walCats(kind, x?.cat);
  walForm.amount.value = x ? String(x.amount).replace('.', ',') : '';
  walForm.title.value = x?.title || '';
  walForm.date.value = x?.date || (walMonth === today().slice(0, 7) ? today() : `${walMonth}-01`);
  walForm.monthly.checked = !!x?.monthly;
  $('#walDel').hidden = !x;
  walDlg.showModal();
  if (!x) walForm.amount.focus();
}
walForm.addEventListener('change', (e) => { if (e.target.name === 'kind') walCats(e.target.value); });
walForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const f = new FormData(walForm);
  const amount = r2(parseFloat(String(f.get('amount')).replace(',', '.')));
  if (!(amount > 0)) { walForm.amount.focus(); return toast('Escribe un importe mayor que 0.'); }
  const x = walEditing ? { ...walEditing } : { id: uid() };
  Object.assign(x, { kind: f.get('kind'), amount, title: String(f.get('title')).trim(), cat: f.get('cat'), date: f.get('date') || today(), monthly: f.get('monthly') === 'on' });
  upsert(state.wallet, x);
  walDlg.close();
  commit();
});
$('#walDel').addEventListener('click', () => {
  const x = state.wallet.find((y) => y.id === walEditing.id);
  walDlg.close();
  remove(state.wallet, x, 'Movimiento eliminado');
});
walDlg.addEventListener('click', (e) => { if (e.target === walDlg || e.target.closest('[data-close]')) walDlg.close(); });

/* ---------- Revisión semanal ---------- */
const overdueTasks = () => live(state.items).filter((i) => i.type === 'task' && !i.repeat && !i.done && i.date < today()).sort((a, b) => a.date.localeCompare(b.date));
function viewRevision() {
  const t = today(), from = addDays(t, -6);
  const items = live(state.items);
  let done = 0, tot = 0;
  for (let k = 0; k < 7; k++) {
    const ts = itemsOn(items, addDays(from, k)).filter((i) => i.type === 'task');
    tot += ts.length;
    done += ts.filter((i) => i.done).length;
  }
  const mins = live(state.focus).filter((f) => f.date >= from && f.date <= t).reduce((s, f) => s + f.min, 0);
  const habits = live(state.habits);
  const hDone = habits.reduce((s, h) => s + [0, 1, 2, 3, 4, 5, 6].filter((k) => h.log[addDays(from, k)]).length, 0);
  const libDone = live(state.library).filter((x) => x.end && x.end >= from).length;
  const overdue = overdueTasks();
  const exams = items.filter((i) => i.type === 'exam' && !i.repeat && i.date > t && diffDays(i.date, t) <= 14).sort((a, b) => a.date.localeCompare(b.date));

  let html = `<h2 class="sec sec-first">Últimos 7 días</h2><ul class="group stats">
    <li><span>Tareas hechas</span><strong>${done} de ${tot}</strong></li>
    <li><span>Tiempo de estudio</span><strong>${hm(mins)}</strong></li>
    <li><span>Hábitos cumplidos</span><strong>${habits.length ? Math.round((hDone / (habits.length * 7)) * 100) + ' %' : 'Sin hábitos'}</strong></li>
    <li><span>Libros y juegos terminados</span><strong>${libDone}</strong></li>
  </ul>`;
  html += `<h2 class="sec">Atrasadas</h2>`;
  html += overdue.length
    ? `<ul class="group">${overdue.map((i) => row(i, fShort(i.date))).join('')}</ul><button type="button" class="text-btn" data-act="moveall">Pasar todas a hoy</button>`
    : '<p class="free">Nada atrasado.</p>';
  html += `<h2 class="sec">Próximos 7 días</h2><ul class="group stats">`;
  for (let k = 1; k <= 7; k++) {
    const d = addDays(t, k);
    const its = dayItems(items, d);
    const parts = Object.keys(TYPES).map((tp) => {
      const n = its.filter((i) => (i.type === 'study' || i.type === 'review' ? 'task' : i.type === 'gcal' ? 'event' : i.type) === tp).length;
      return n ? plural(n, TYPES[tp]) : '';
    }).filter(Boolean);
    html += `<li><span>${cap(fDay(d))}</span><strong>${parts.join(', ') || 'Libre'}</strong></li>`;
  }
  html += '</ul>';
  if (exams.length) html += `<h2 class="sec">Exámenes en las próximas 2 semanas</h2><ul class="group">${exams.map(examRow).join('')}</ul>`;
  return { title: 'Revisión semanal', sub: `${fShort(from)} – ${fShort(t)}`, html };
}

/* ---------- Ajustes: avisos, Google Calendar y atajos ---------- */
function pushNote(on) {
  if (!on) return 'Al activarlos, llegan también con la app cerrada si has iniciado sesión con la nube.';
  if (getPref('pushToken', '')) return 'Activados en este dispositivo, también con la app cerrada. Pueden llegar con unos minutos de retraso.';
  if (!sync.pushReady) return 'Ahora llegan con la app abierta o en segundo plano. Para recibirlos con la app cerrada falta configurar el servidor.';
  if (syncInfo.state !== 'on') return 'Ahora llegan con la app abierta. Inicia sesión con la nube para recibirlos también con la app cerrada.';
  return 'Ahora llegan con la app abierta. Desactiva y vuelve a activar el interruptor para recibirlos también con la app cerrada.';
}

function viewAjustes() {
  const perm = 'Notification' in window ? Notification.permission : 'unsupported';
  const notifOn = getPref('notify', '0') === '1' && perm === 'granted';
  const g = gcalStatus();
  const appUrl = location.origin + location.pathname;
  const gText = {
    nosync: 'Primero activa la sincronización con el icono de la nube.',
    off: 'No conectado.',
    on: `Conectado. ${plural((gcalCache().events || []).length, ['evento', 'eventos'])} cargados.`,
    expired: 'Google pide reconectar cada hora. Tus eventos siguen guardados.',
  }[g];
  const gBtn = g === 'on'
    ? '<button type="button" class="text-btn" data-act="gcaloff">Desconectar</button>'
    : g === 'nosync' ? '' : `<button type="button" class="btn" data-act="gcal">${g === 'expired' ? 'Reconectar' : 'Conectar'}</button>`;
  const html = `<h2 class="sec sec-first">Avisos</h2>
    <div class="group setting">
      <div class="set-row">
        <div><p class="title">Avisos de citas y exámenes</p>
          <p class="meta">10 minutos antes de lo que tenga hora, el día antes de cada examen y un resumen por la mañana.</p></div>
        <button type="button" class="switch" role="switch" aria-checked="${notifOn}" data-act="notify" aria-label="Avisos de citas y exámenes" ${perm === 'unsupported' ? 'disabled' : ''}></button>
      </div>
      <p class="note">${pushNote(notifOn)}</p>
      ${perm === 'denied' ? '<p class="note warn">El navegador tiene los avisos bloqueados para esta web. Actívalos en los ajustes del navegador.</p>' : ''}
      ${perm === 'unsupported' ? '<p class="note warn">Este navegador no permite avisos. En iPhone hay que instalar la app en la pantalla de inicio primero.</p>' : ''}
    </div>
    <h2 class="sec">Google Calendar</h2>
    <div class="group setting">
      <div class="set-row"><div><p class="title">Ver mis eventos de Google</p><p class="meta">${gText}</p></div>${gBtn}</div>
      <p class="note">Solo lectura: tus eventos aparecen en Hoy, Semana y el calendario, sin duplicarse. La primera vez, activa la API de Google Calendar en tu proyecto:
        <a href="https://console.cloud.google.com/apis/library/calendar-json.googleapis.com?project=mi-dia-467b1" target="_blank" rel="noopener">abrir Google Cloud y pulsar «Habilitar»</a>.
        Google mostrará un aviso de «app no verificada»: es tu propia app, puedes continuar.</p>
    </div>
    <h2 class="sec">Atajos</h2>
    <div class="group setting">
      <p class="note">En Android, mantén pulsado el icono de la app para ver los atajos Hoy, Añadir y Semana.</p>
      <p class="note">En iPhone, abre la app Atajos, crea un atajo con la acción «Abrir URL» y una de estas direcciones. Después añádelo a la pantalla de inicio o como widget de Atajos.</p>
      <ul class="urls">
        <li><span>Hoy</span><code>${esc(appUrl)}?v=hoy</code></li>
        <li><span>Añadir</span><code>${esc(appUrl)}?add=1</code></li>
        <li><span>Semana</span><code>${esc(appUrl)}?v=semana</code></li>
      </ul>
    </div>
    <h2 class="sec">Sincronización</h2>
    <div class="group setting"><p class="note">${!sync.enabled ? 'No configurada.' : syncInfo.state === 'on' ? `Sincronizado como ${esc(syncInfo.name)}.` : 'Pulsa el icono de la nube, arriba, para iniciar sesión con Google.'}</p></div>`;
  return { title: 'Ajustes', sub: 'Avisos, calendario y atajos', html };
}

/* ---------- Más ---------- */
const MORE_VIEWS = ['habitos', 'biblioteca', 'cartera', 'contadores', 'revision', 'ajustes', 'mas'];
function navRow(v, ic, name, sum) {
  return `<li class="row notime"><span class="lead">${icon(ic)}</span>
    <button type="button" class="body" data-act="go" data-view="${v}"><span class="title">${name}</span>${sum ? `<span class="meta">${sum}</span>` : ''}</button>
    <span class="chev" aria-hidden="true">${icon('next')}</span></li>`;
}
function viewMas() {
  const habits = live(state.habits);
  const html = `<ul class="group">
    ${navRow('habitos', 'habitos', 'Hábitos', habits.length ? `${habits.filter((h) => h.log[today()]).length} de ${habits.length} hoy` : 'Sin hábitos')}
    ${navRow('biblioteca', 'library', 'Biblioteca', libSummary())}
    ${navRow('cartera', 'wallet', 'Cartera', walletSummary())}
    ${navRow('contadores', 'counter', 'Contadores', plural(live(state.counters).length, ['contador', 'contadores']))}
    ${navRow('revision', 'review', 'Revisión semanal', 'Lo que pasó y lo que viene')}
    ${navRow('ajustes', 'settings', 'Ajustes', 'Avisos, Google Calendar y atajos')}
  </ul>`;
  return { title: 'Más', sub: 'Todos los apartados', html };
}

const views = {
  inicio: viewInicio, hoy: viewHoy, semana: viewSemana, examenes: viewExamenes, habitos: viewHabitos,
  biblioteca: viewBiblioteca, cartera: viewCartera, contadores: viewContadores, revision: viewRevision, ajustes: viewAjustes, mas: viewMas,
};

/* ---------- Avisos (mientras la app está abierta) ---------- */
function readJSON(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } }
function writeJSON(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }

async function toggleNotify() {
  if (getPref('notify', '0') === '1' && Notification.permission === 'granted') {
    setPref('notify', '0');
    const tok = getPref('pushToken', '');
    if (tok) { try { localStorage.removeItem('midia.pushToken'); } catch {} sync.disablePush(tok); }
    return render();
  }
  const p = await Notification.requestPermission();
  setPref('notify', p === 'granted' ? '1' : '0');
  if (p === 'granted') {
    await registerPush();
    showNote('Avisos activados', 'Te avisaré de tus citas y exámenes.');
    notifyCheck();
  }
  render();
}

// Con la app cerrada: el token de este dispositivo se guarda en Firebase y el script de GitHub Actions envía los avisos.
async function registerPush() {
  if (!sync.pushReady || syncInfo.state !== 'on' || !('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    setPref('pushToken', await sync.enablePush(reg));
  } catch {
    toast('No se pudieron activar los avisos con la app cerrada. Seguirán llegando con la app abierta.');
  }
}
async function showNote(title, body) {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    const opts = { body, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: title };
    if (reg) await reg.showNotification(title, opts); else new Notification(title, opts);
  } catch {}
}
function notifyCheck() {
  if (getPref('notify', '0') !== '1' || !('Notification' in window) || Notification.permission !== 'granted') return;
  if (getPref('pushToken', '')) return;
  const sent = readJSON('midia.notified', {});
  const t = today();
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const items = live(state.items);
  const todays = dayItems(items, t);
  const fire = (key, title, body) => { if (!sent[key]) { sent[key] = t; showNote(title, body); } };
  for (const i of todays) {
    if (!i.time || i.done) continue;
    const [h, m] = i.time.split(':').map(Number);
    const diff = h * 60 + m - nowMin;
    if (diff >= 0 && diff <= 10) fire(`pre:${i.id}:${t}`, i.title, [diff ? `En ${diff} min` : 'Ahora', i.time, i.place].filter(Boolean).join(' · '));
  }
  if (nowMin >= 9 * 60) {
    for (const e of items.filter((i) => i.type === 'exam' && !i.repeat && i.date === addDays(t, 1))) {
      fire(`exam:${e.id}`, `Mañana tienes examen de ${e.title}`, [e.time, e.place].filter(Boolean).join(' · ') || 'Repasa hoy lo que te falte.');
    }
  }
  if (nowMin >= 7 * 60 && nowMin < 12 * 60 && todays.length) {
    const parts = Object.keys(TYPES).map((tp) => {
      const n = todays.filter((i) => (i.type === 'study' || i.type === 'review' ? 'task' : i.type === 'gcal' ? 'event' : i.type) === tp).length;
      return n ? plural(n, TYPES[tp]) : '';
    }).filter(Boolean);
    const first = todays.filter((i) => i.time).sort(sortDay)[0];
    fire(`morning:${t}`, 'Tu día', parts.join(', ') + (first ? `. Lo primero, a las ${first.time}: ${first.title}.` : '.'));
  }
  for (const k in sent) if (sent[k] < addDays(t, -2)) delete sent[k];
  writeJSON('midia.notified', sent);
}

/* ---------- Google Calendar (solo lectura) ---------- */
function gcalToken() {
  try { const g = JSON.parse(sessionStorage.getItem('midia.gtoken')); return g && g.exp > Date.now() ? g.token : null; } catch { return null; }
}
const gcalCache = () => readJSON('midia.gcal', {});
function gcalIndex() {
  GCAL = {};
  for (const e of gcalCache().events || []) (GCAL[e.date] ||= []).push(e);
}
function gcalStatus() {
  if (!sync.enabled || syncInfo.state !== 'on') return 'nosync';
  if (gcalToken()) return 'on';
  return gcalCache().events ? 'expired' : 'off';
}
async function gcalConnect() {
  try {
    const token = await sync.connectCalendar();
    if (!token) throw new Error('sin token');
    try { sessionStorage.setItem('midia.gtoken', JSON.stringify({ token, exp: Date.now() + 55 * 60000 })); } catch {}
    await gcalFetch();
  } catch {
    toast('No se pudo conectar con Google Calendar.');
  }
}
function gcalDisconnect() {
  try { sessionStorage.removeItem('midia.gtoken'); localStorage.removeItem('midia.gcal'); } catch {}
  gcalIndex();
  render();
}
async function gcalFetch() {
  const token = gcalToken();
  if (!token) return;
  const from = parse(addDays(today(), -30)).toISOString();
  const to = parse(addDays(today(), 120)).toISOString();
  const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?singleEvents=true&orderBy=startTime&maxResults=500&timeMin=${encodeURIComponent(from)}&timeMax=${encodeURIComponent(to)}`;
  try {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (r.status === 401) { try { sessionStorage.removeItem('midia.gtoken'); } catch {} render(); return; }
    if (!r.ok) {
      toast(r.status === 403 ? 'Falta activar la API de Google Calendar. Mira Ajustes.' : 'No se pudo leer Google Calendar.');
      return;
    }
    const j = await r.json();
    const events = (j.items || []).filter((e) => e.status !== 'cancelled' && e.start).map((e) => {
      const allDay = !!e.start.date;
      const s = allDay ? null : new Date(e.start.dateTime);
      return {
        id: 'g:' + e.id, type: 'gcal', title: e.summary || '(Sin título)',
        date: allDay ? e.start.date : ymd(s), time: allDay ? '' : `${pad(s.getHours())}:${pad(s.getMinutes())}`,
        place: e.location || '', link: e.htmlLink || '', prio: 0,
      };
    });
    writeJSON('midia.gcal', { at: Date.now(), events });
    gcalIndex();
    render();
  } catch {
    toast('No se pudo leer Google Calendar.');
  }
}


/* Tooltip de las gráficas: el texto viene de datos del usuario, así que va con textContent */
const tip = $('#tip');
function showTip(el) {
  tip.replaceChildren();
  const v = document.createElement('strong'); v.textContent = el.dataset.tip;
  const l = document.createElement('span'); l.textContent = el.dataset.tipTitle;
  tip.append(v, l);
  tip.hidden = false;
  const r = el.getBoundingClientRect();
  const w = tip.offsetWidth;
  tip.style.left = `${Math.min(Math.max(8, r.left + r.width / 2 - w / 2), innerWidth - w - 8)}px`;
  tip.style.top = `${Math.max(8, r.top - tip.offsetHeight - 8)}px`;
}
const hideTip = () => { tip.hidden = true; };
$('#view').addEventListener('pointerover', (e) => { const el = e.target.closest('[data-tip]'); if (el) showTip(el); });
$('#view').addEventListener('pointerout', (e) => { if (e.target.closest('[data-tip]')) hideTip(); });
$('#view').addEventListener('focusin', (e) => { if (e.target.dataset.tip) showTip(e.target); });
$('#view').addEventListener('focusout', hideTip);
addEventListener('scroll', hideTip, { passive: true });

function render() {
  const keep = document.activeElement?.dataset;
  PLAN = studyPlan(live(state.items));
  const v = (views[view] || viewHoy)();
  $('#title').textContent = v.title;
  $('#sub').innerHTML = [].concat(v.sub).map((s) => `<span>${esc(s)}</span>`).join('');
  $('#view').innerHTML = v.html;
  $('#main').classList.toggle('wide', view === 'inicio');
  hideTip();
  document.title = v.title === 'Inicio' ? 'Mi día' : `${v.title} · Mi día`;
  document.querySelectorAll('.nav button').forEach((b) => {
    const on = b.dataset.view === view || (b.dataset.view === 'mas' && MORE_VIEWS.includes(view));
    if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  document.querySelectorAll('.hm-wrap').forEach((el) => { el.scrollLeft = el.scrollWidth; });
  popId = null;
  if (keep?.act && (keep.id || keep.date)) {
    const sel = `[data-act="${keep.act}"]` + (keep.id ? `[data-id="${keep.id}"]` : '') + (keep.date ? `[data-date="${keep.date}"]` : '');
    $(sel)?.focus({ preventScroll: true });
  }
}

/* ---------- Hoja de edición ---------- */
const dlg = $('#sheet');
const form = $('#form');
const LABELS = {
  task: { title: 'Tarea', place: null },
  event: { title: 'Cita', place: 'Lugar' },
  exam: { title: 'Asignatura o examen', place: 'Aula o lugar' },
};

function syncFields() {
  const type = form.type.value;
  const L = LABELS[type];
  $('#lblTitle').textContent = L.title;
  $('#fldPlace').hidden = !L.place;
  if (L.place) $('#lblPlace').textContent = L.place;
  $('#fldPrio').hidden = type !== 'task';
  $('#fldRepeat').hidden = type === 'exam';
  $('#fldSubs').hidden = type === 'event';
  $('#lblSubs').textContent = type === 'exam' ? 'Temas' : 'Subtareas';
  $('#subsHint').hidden = type !== 'exam';
  $('#subInput').placeholder = type === 'exam' ? 'Añadir tema (puedes pegar varios, uno por línea)' : 'Añadir subtarea';
  $('#subInput').setAttribute('aria-label', type === 'exam' ? 'Nuevo tema' : 'Nueva subtarea');
  $('#focusBtn').hidden = !editing || type === 'event';
}

function setRepeat(r) {
  const sel = form.repeat;
  const v = encodeRepeat(r);
  sel.querySelector('option[data-custom]')?.remove();
  if (v && ![...sel.options].some((o) => o.value === v)) {
    const o = new Option(repeatLabel(r), v);
    o.dataset.custom = '1';
    sel.add(o);
  }
  sel.value = v;
}

function paintSubs() {
  $('#subList').innerHTML = subs.map((s, k) => `<li>
    <input type="checkbox" id="sub${k}" data-k="${k}" ${s.done ? 'checked' : ''}><label for="sub${k}">${esc(s.t)}</label>
    <button type="button" class="icon-btn small" data-subdel="${k}" aria-label="Quitar ${esc(s.t)}">${icon('trash')}</button></li>`).join('');
}
function addSub(text) {
  const inp = $('#subInput');
  const parts = (text ?? inp.value).split(/\n|;/).map((x) => x.trim()).filter(Boolean);
  if (!parts.length) return;
  for (const t of parts) subs.push({ id: uid(), t, done: false });
  inp.value = '';
  paintSubs();
}
$('#subAddBtn').addEventListener('click', () => addSub());
$('#subInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addSub(); } });
$('#subInput').addEventListener('paste', (e) => {
  const text = e.clipboardData?.getData('text') || '';
  if (!text.includes('\n')) return;
  e.preventDefault();
  addSub(text);
});
$('#subList').addEventListener('change', (e) => {
  const k = e.target.dataset.k;
  if (k === undefined) return;
  subs[k].done = e.target.checked;
  if (subs[k].done) subs[k].doneAt = today(); else delete subs[k].doneAt;
});
$('#subList').addEventListener('click', (e) => { const b = e.target.closest('[data-subdel]'); if (b) { subs.splice(Number(b.dataset.subdel), 1); paintSubs(); } });

const TYPE_LABEL = { task: 'Tarea', event: 'Cita', exam: 'Examen' };
const quickLines = () => form.quick.value.split('\n').map((l) => l.trim()).filter(Boolean);
const withDefaults = (p) => ({ type: 'task', date: today(), time: '', place: '', prio: 1, ...p });
function summary(p) {
  const x = withDefaults(p);
  return [TYPE_LABEL[x.type], x.title || '(sin título)', fShort(x.date), x.time, x.place, repeatLabel(x.repeat), (x.tags || []).map((t) => '#' + t).join(' ')].filter(Boolean).join(' · ');
}
function onQuick() {
  const lines = quickLines();
  const hint = $('#quickHint');
  form.title.required = lines.length < 2;
  if (lines.length > 1) {
    hint.innerHTML = `<strong>Se crearán ${lines.length} elementos:</strong>` + lines.map((l) => `<span>${esc(summary(parseQuick(l)))}</span>`).join('');
    return;
  }
  if (!lines.length) { hint.textContent = ''; return; }
  const p = withDefaults(parseQuick(lines[0]));
  form.type.value = p.type;
  form.title.value = p.title || '';
  form.date.value = p.date;
  form.time.value = p.time;
  form.place.value = p.place;
  form.prio.value = String(p.prio);
  form.tags.value = (p.tags || []).join(', ');
  setRepeat(p.type === 'exam' ? null : p.repeat);
  syncFields();
  hint.textContent = summary(p);
}
form.quick.addEventListener('input', onQuick);

function openSheet(item, defaults = {}) {
  editing = item;
  form.reset();
  const src = item || { type: 'task', date: today(), time: '', place: '', prio: 1, ...defaults };
  form.type.value = src.type;
  form.title.value = item ? item.title : '';
  form.date.value = src.date;
  form.time.value = src.time || '';
  form.place.value = src.place || '';
  form.prio.value = String(src.prio ?? 1);
  form.tags.value = (src.tags || []).join(', ');
  form.quick.value = '';
  form.title.required = true;
  $('#quickHint').textContent = '';
  $('#fldQuick').hidden = !!item;
  setRepeat(src.repeat);
  subs = (src.subs || []).map((s) => ({ ...s }));
  paintSubs();
  $('#sheetTitle').textContent = item ? 'Editar' : 'Nuevo';
  $('#delBtn').hidden = !item;
  syncFields();
  dlg.showModal();
  if (!item) form.quick.focus();
}

form.addEventListener('change', (e) => { if (e.target.name === 'type') syncFields(); });
form.addEventListener('submit', (e) => {
  e.preventDefault();
  const lines = quickLines();
  if (!editing && lines.length > 1) {
    const made = lines.map((l) => withDefaults(parseQuick(l))).filter((p) => p.title);
    for (const p of made) {
      upsert(state.items, {
        id: uid(), done: false, ...p,
        place: p.type === 'task' ? '' : p.place,
        prio: p.type === 'task' ? p.prio : 0,
        repeat: p.type === 'exam' ? null : p.repeat || null,
      });
    }
    dlg.close();
    commit();
    toast(plural(made.length, ['elemento creado', 'elementos creados']));
    return;
  }
  const f = new FormData(form);
  const type = f.get('type');
  const title = String(f.get('title')).trim();
  if (!title) return;
  const it = editing ? { ...editing } : { id: uid(), done: false };
  const tags = [...new Set(String(f.get('tags')).toLowerCase().split(/[\s,#]+/).filter(Boolean))];
  Object.assign(it, {
    type, title,
    date: f.get('date') || today(),
    time: f.get('time') || '',
    place: type === 'task' ? '' : String(f.get('place')).trim(),
    prio: type === 'task' ? Number(f.get('prio')) : 0,
    tags,
    repeat: type === 'exam' ? null : decodeRepeat(f.get('repeat')),
    subs: type === 'event' ? [] : subs,
  });
  if (type !== 'task') it.done = false;
  if (!it.repeat) delete it.doneOn;
  upsert(state.items, it);
  dlg.close();
  commit();
});
$('#delBtn').addEventListener('click', () => {
  const it = state.items.find((x) => x.id === editing.id);
  dlg.close();
  remove(state.items, it, 'Eliminado');
});
dlg.addEventListener('click', (e) => { if (e.target === dlg || e.target.closest('[data-close]')) dlg.close(); });

/* ---------- Pomodoro ---------- */
const FOCUS_MIN = 25;
let run = null;
try { run = JSON.parse(getPref('focus', 'null')); } catch {}
const subjectOf = (it) => (it.type === 'task' && it.tags?.length ? '#' + it.tags[0] : it.title);
const leftMs = () => (run.endAt ? Math.max(0, run.endAt - Date.now()) : run.left);
function saveRun() { if (run) setPref('focus', JSON.stringify(run)); else try { localStorage.removeItem('midia.focus'); } catch {} }

function startFocus(it) {
  if (run) return toast('Ya tienes un Pomodoro en marcha.');
  const dur = FOCUS_MIN * 60000;
  run = { ref: it.id, label: subjectOf(it), dur, endAt: Date.now() + dur, left: null };
  saveRun();
  paintFocus();
}
function finishFocus(completed) {
  const min = Math.round((run.dur - leftMs()) / 60000);
  const label = run.label;
  if (min >= 1) {
    upsert(state.focus, { id: uid(), ref: run.ref, label, date: today(), min });
  }
  run = null;
  saveRun();
  paintFocus();
  commit();
  if (completed) { navigator.vibrate?.(300); toast(`Pomodoro completado: ${hm(min)} de ${label}.`); }
  else toast(min >= 1 ? `Guardado: ${hm(min)} de ${label}.` : 'Pomodoro cancelado.');
}
function paintFocus() {
  const el = $('#focus');
  if (!run) { el.hidden = true; return; }
  el.hidden = false;
  const playing = !!run.endAt;
  el.innerHTML = `<div class="focus-info"><span class="focus-label">${esc(run.label)}</span><span class="focus-time"></span></div>
    <button type="button" class="icon-btn" data-f="toggle" aria-label="${playing ? 'Pausar' : 'Seguir'}">${icon(playing ? 'pause' : 'play')}</button>
    <button type="button" class="icon-btn" data-f="stop" aria-label="Terminar y guardar">${icon('stop')}</button>`;
  tickFocus();
}
function tickFocus() {
  if (!run) return;
  const left = leftMs();
  const el = $('#focus .focus-time');
  if (el) el.textContent = `${pad(Math.floor(left / 60000))}:${pad(Math.floor((left % 60000) / 1000))}`;
  if (run.endAt && left === 0) finishFocus(true);
}
$('#focus').addEventListener('click', (e) => {
  const b = e.target.closest('[data-f]');
  if (!b || !run) return;
  if (b.dataset.f === 'stop') return finishFocus(false);
  if (run.endAt) { run.left = leftMs(); run.endAt = null; } else { run.endAt = Date.now() + run.left; run.left = null; }
  saveRun();
  paintFocus();
  $('#focus [data-f="toggle"]').focus();
});
setInterval(tickFocus, 1000);
$('#focusBtn').addEventListener('click', () => {
  const it = editing;
  dlg.close();
  startFocus(it);
});

/* ---------- Aviso con deshacer ---------- */
let toastTimer;
function toast(msg, undo) {
  const el = $('#toast');
  el.innerHTML = `<span>${esc(msg)}</span>${undo ? '<button type="button">Deshacer</button>' : ''}`;
  el.hidden = false;
  if (undo) el.querySelector('button').onclick = () => { undo(); el.hidden = true; };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, undo ? 6000 : 3500);
}
function remove(list, obj, msg) {
  upsert(list, { ...obj, del: true });
  commit();
  toast(msg, () => { upsert(list, { ...obj, del: false }); commit(); });
}

/* ---------- Eventos ---------- */
$('#view').addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const { act, id, date } = b.dataset;
  if (act === 'go') setView(b.dataset.view);
  else if (act === 'libtab') { libTab = b.dataset.tab; setPref('libTab', libTab); render(); }
  else if (act === 'libnew') openLib(null);
  else if (act === 'walnew') openWallet(null);
  else if (act === 'walledit') openWallet(state.wallet.find((x) => x.id === id));
  else if (act === 'walmonth') {
    if (b.dataset.d === '0') walMonth = today().slice(0, 7);
    else { const [y, m] = walMonth.split('-').map(Number); walMonth = ymd(new Date(y, m - 1 + Number(b.dataset.d), 1)).slice(0, 7); }
    render();
  }
  else if (act === 'libedit') openLib(state.library.find((x) => x.id === id));
  else if (act === 'libplus') {
    const x = state.library.find((y) => y.id === id);
    if (x.kind === 'book') {
      const cur = Math.min((x.cur || 0) + 10, x.total || Infinity);
      upsert(state.library, { ...x, cur });
      if (x.total && cur >= x.total) toast(`Has llegado al final de ${x.title}. Márcalo como leído cuando quieras.`);
    } else upsert(state.library, { ...x, hours: Math.round(((x.hours || 0) + 1) * 10) / 10 });
    commit();
  } else if (act === 'cnt') {
    const c = state.counters.find((x) => x.id === id);
    const t = today();
    const log = { ...c.log };
    const v = Math.round(((log[t] || 0) + Number(b.dataset.d) * c.step) * 100) / 100;
    if (v) log[t] = v; else delete log[t];
    upsert(state.counters, { ...c, log });
    commit();
  } else if (act === 'cntdel') remove(state.counters, state.counters.find((x) => x.id === id), 'Contador eliminado');
  else if (act === 'moveall') {
    const t = today();
    for (const i of overdueTasks()) upsert(state.items, { ...i, date: t });
    commit();
    toast('Tareas atrasadas pasadas a hoy.');
  } else if (act === 'hoymode') { hoyMode = b.dataset.mode; blockSel = null; setPref('hoyMode', hoyMode); render(); }
  else if (act === 'bsel') { blockSel = blockSel === id ? null : id; render(); }
  else if (act === 'bput') {
    if (!blockSel) { if (b.dataset.time) openSheet(null, { time: b.dataset.time }); return; }
    setTime(blockSel, b.dataset.time);
  } else if (act === 'notify') toggleNotify();
  else if (act === 'gcal') gcalConnect();
  else if (act === 'gcaloff') gcalDisconnect();
  else if (act === 'tag') { tagFilter = b.dataset.tag; render(); }
  else if (act === 'topic') {
    const ex = state.items.find((x) => x.id === id);
    const tp = b.dataset.topic;
    const list = ex.subs.map((s) => {
      if (s.id !== tp) return s;
      const { doneAt, ...rest } = s;
      return s.done ? { ...rest, done: false } : { ...rest, done: true, doneAt: today() };
    });
    upsert(state.items, { ...ex, subs: list });
    popId = `${id}:${tp}`;
    commit();
  }
  else if (act === 'calday') { calSel = date; if (date.slice(0, 7) !== calMonth) calMonth = date.slice(0, 7); render(); }
  else if (act === 'cal') {
    if (b.dataset.d === '0') { calMonth = today().slice(0, 7); calSel = today(); } else {
      const [y, m] = calMonth.split('-').map(Number);
      calMonth = ymd(new Date(y, m - 1 + Number(b.dataset.d), 1)).slice(0, 7);
    }
    render();
  } else if (act === 'toggle') {
    const it = state.items.find((x) => x.id === id);
    if (it.repeat) {
      const doneOn = { ...it.doneOn };
      if (doneOn[date]) delete doneOn[date]; else doneOn[date] = 1;
      upsert(state.items, { ...it, doneOn });
    } else upsert(state.items, { ...it, done: !it.done });
    popId = id;
    commit();
  } else if (act === 'edit') openSheet(state.items.find((x) => x.id === id));
  else if (act === 'add') openSheet(null, b.dataset.type ? { type: b.dataset.type } : {});
  else if (act === 'addday') openSheet(null, { date });
  else if (act === 'week') { weekStart = b.dataset.d === '0' ? mondayOf(today()) : addDays(weekStart, Number(b.dataset.d)); render(); }
  else if (act === 'hab') {
    const h = state.habits.find((x) => x.id === id);
    const log = { ...h.log };
    if (log[date]) delete log[date]; else log[date] = 1;
    upsert(state.habits, { ...h, log });
    commit();
  } else if (act === 'habdel') {
    remove(state.habits, state.habits.find((x) => x.id === id), 'Hábito eliminado');
  }
});

$('#view').addEventListener('submit', (e) => {
  if (e.target.dataset.form === 'counter') return addCounter(e);
  if (e.target.dataset.form === 'walimport') return onWalletImport(e);
  if (e.target.dataset.form !== 'habit') return;
  e.preventDefault();
  const name = e.target.name.value.trim();
  if (!name) return;
  upsert(state.habits, { id: uid(), name, log: {} });
  commit();
  $('.add-habit input')?.focus();
});

function setView(v) {
  view = v;
  setPref('view', view);
  render();
  scrollTo({ top: 0 });
}
document.querySelectorAll('.nav button').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
$('#addBtn').addEventListener('click', () => openSheet(null));
$('#fab').addEventListener('click', () => openSheet(null));

/* ---------- Sincronización ---------- */
let syncInfo = { state: 'off' };
function paintSync() {
  const b = $('#syncBtn');
  const on = syncInfo.state === 'on';
  b.classList.toggle('on', on);
  b.setAttribute('aria-label', on ? `Sincronizado como ${syncInfo.name}. Pulsa para cerrar sesión` : 'Sincronizar entre dispositivos');
}
$('#syncBtn').addEventListener('click', async () => {
  if (!sync.enabled) return toast('La sincronización no está configurada todavía. Mira LEEME.md.');
  if (syncInfo.state === 'on') {
    if (confirm(`¿Cerrar la sesión de ${syncInfo.name}? Tus datos seguirán en este dispositivo.`)) sync.signOut();
    return;
  }
  try { await sync.signIn(); } catch (err) { toast('No se pudo iniciar sesión.'); }
});

/* ---------- Arranque ---------- */
const qs = new URLSearchParams(location.search);
if (views[qs.get('v')]) view = qs.get('v');
gcalIndex();
render();
paintFocus();
if (qs.has('add')) openSheet(null);
if (location.search) history.replaceState(null, '', location.pathname);
sync.start({
  merge: mergeRemote,
  onStatus: (s) => {
    syncInfo = s;
    paintSync();
    if (s.state === 'on' && getPref('notify', '0') === '1' && 'Notification' in window && Notification.permission === 'granted') registerPush();
    if (s.state === 'error') toast('Sin conexión con la nube. Tus datos están a salvo en este dispositivo.');
  },
});

setInterval(() => { if (!dlg.open && !libDlg.open && !['habitos', 'contadores', 'biblioteca', 'ajustes'].includes(view)) render(); }, 60000);
setInterval(notifyCheck, 30000);
setInterval(() => { if (gcalToken()) gcalFetch(); }, 15 * 60000);
setTimeout(() => { notifyCheck(); if (gcalToken() && Date.now() - (gcalCache().at || 0) > 15 * 60000) gcalFetch(); }, 1500);
document.addEventListener('visibilitychange', () => { if (!document.hidden && !dlg.open && !libDlg.open) { render(); notifyCheck(); } });

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
