// Entrada rápida en español ("examen métodos 20 nov 9:00 aula A3") y repeticiones.
import { ymd, parse, today, addDays, diffDays } from './dates.js';

export const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const WD = '(?:lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bados?|domingos?)';
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const wdIndex = (w) => ({ lu: 1, ma: 2, mi: 3, ju: 4, vi: 5, sa: 6, do: 0 })[w.toLowerCase().slice(0, 2)];
const nextWeekday = (base, w, skipToday = false) => {
  let n = (w - parse(base).getDay() + 7) % 7;
  if (n === 0 && skipToday) n = 7;
  return addDays(base, n);
};

/* ---------- Repeticiones ---------- */
// repeat = { f: 'day' | 'weekdays' | 'week' | 'month', n?: número, days?: [0-6] }
export function occurs(it, d) {
  if (!it.repeat) return it.date === d;
  if (d < it.date) return false;
  const { f, n = 1, days } = it.repeat;
  const w = parse(d).getDay();
  if (f === 'day') return diffDays(d, it.date) % n === 0;
  if (f === 'weekdays') return w >= 1 && w <= 5;
  if (f === 'week') return days?.length ? days.includes(w) : diffDays(d, it.date) % (7 * n) === 0;
  if (f === 'month') return parse(d).getDate() === parse(it.date).getDate();
  return false;
}

// Instancias de un día: las repetidas llevan su propio "hecho" por fecha.
export const itemsOn = (items, d) => items
  .filter((i) => occurs(i, d))
  .map((i) => (i.repeat ? { ...i, date: d, done: !!i.doneOn?.[d] } : i));

export function repeatLabel(r) {
  if (!r) return '';
  const n = r.n || 1;
  if (r.f === 'day') return n === 1 ? 'Cada día' : `Cada ${n} días`;
  if (r.f === 'weekdays') return 'Días laborables';
  if (r.f === 'week') {
    if (r.days?.length) return 'Cada ' + r.days.map((d) => WEEKDAYS[d]).join(' y ');
    return n === 1 ? 'Cada semana' : `Cada ${n} semanas`;
  }
  if (r.f === 'month') return 'Cada mes';
  return '';
}

export const encodeRepeat = (r) => (r ? `${r.f}:${r.n || 1}${r.days?.length ? ':' + r.days.join(',') : ''}` : '');
export function decodeRepeat(v) {
  if (!v) return null;
  const [f, n, days] = v.split(':');
  const r = { f, n: Number(n) || 1 };
  if (days) r.days = days.split(',').map(Number);
  return r;
}

/* ---------- Analizador ---------- */
export function parseQuick(text, base = today()) {
  let s = ` ${text.trim().replace(/^[-*•]\s+/, '')} `;
  const out = {};
  const take = (re, fn) => {
    const m = s.match(re);
    if (!m) return false;
    fn(m);
    s = s.replace(m[0], ' ');
    return true;
  };

  // Etiquetas: #uni #personal
  const tags = [];
  s = s.replace(/\s#([\p{L}\d_-]+)/gu, (_, t) => { tags.push(t.toLowerCase()); return ' '; });
  if (tags.length) out.tags = [...new Set(tags)];

  // Prioridad
  take(/\s(?:prioridad\s+alta|urgente|importante|!+)(?=\s)/i, () => { out.prio = 2; })
    || take(/\sprioridad\s+(media|baja)(?=\s)/i, (m) => { out.prio = m[1].toLowerCase() === 'baja' ? 0 : 1; });

  // Tipo
  if (take(/\sexamen(?:\s+de)?(?=\s)/i, () => {})) out.type = 'exam';
  else if (/\s(?:parcial|final|recuperaci[oó]n)(?=\s)/i.test(s)) out.type = 'exam';
  else if (take(/\scita(?=\s)/i, () => {})) out.type = 'event';
  else if (/\s(?:m[eé]dico|dentista|reuni[oó]n|tutor[ií]a|consulta|quedada|cumplea[nñ]os|entrevista)(?=\s)/i.test(s)) out.type = 'event';

  // Repetición (antes que las fechas: "cada lunes" lleva un día de la semana)
  const wdList = (str) => str.split(/\s*(?:,|\by\b)\s*/i).map(wdIndex).filter((x) => x !== undefined);
  take(/\s(?:cada\s+d[ií]a|todos\s+los\s+d[ií]as|a\s+diario|diariamente|diario)(?=\s)/i, () => { out.repeat = { f: 'day', n: 1 }; })
    || take(/\scada\s+(\d+)\s+d[ií]as(?=\s)/i, (m) => { out.repeat = { f: 'day', n: Number(m[1]) }; })
    || take(/\s(?:d[ií]as\s+laborables|entre\s+semana|de\s+lunes\s+a\s+viernes)(?=\s)/i, () => { out.repeat = { f: 'weekdays', n: 1 }; })
    || take(new RegExp(`\\s(?:cada|todos\\s+los)\\s+(${WD}(?:\\s*(?:,|y)\\s*${WD})*)(?=\\s)`, 'i'), (m) => { out.repeat = { f: 'week', n: 1, days: [...new Set(wdList(m[1]))].sort() }; })
    || take(/\scada\s+(\d+)\s+semanas(?=\s)/i, (m) => { out.repeat = { f: 'week', n: Number(m[1]) }; })
    || take(/\s(?:cada\s+semana|semanalmente|semanal)(?=\s)/i, () => { out.repeat = { f: 'week', n: 1 }; })
    || take(/\s(?:cada\s+mes|mensualmente|mensual)(?=\s)/i, () => { out.repeat = { f: 'month', n: 1 }; });

  // Momento del día (antes de "mañana" como fecha)
  let pm = false, am = false;
  take(/\s(?:de|por)\s+la\s+(?:tarde|noche)(?=\s)/i, () => { pm = true; })
    || take(/\s(?:de|por)\s+la\s+ma[nñ]ana(?=\s)/i, () => { am = true; });

  // Fecha
  const withYear = (y, m, d) => {
    let date = ymd(new Date(y ?? parse(base).getFullYear(), m, d));
    if (y == null && date < base) date = ymd(new Date(parse(base).getFullYear() + 1, m, d));
    return date;
  };
  take(/\spasado\s+ma[nñ]ana(?=\s)/i, () => { out.date = addDays(base, 2); })
    || take(/\sma[nñ]ana(?=\s)/i, () => { out.date = addDays(base, 1); })
    || take(/\shoy(?=\s)/i, () => { out.date = base; })
    || take(/\s(?:el\s+)?(\d{1,2})\s+(?:de\s+)?(ene|feb|mar|abr|may|jun|jul|ago|sep|set|oct|nov|dic)\p{L}*\.?(?:\s+(?:de\s+)?(\d{4}))?(?=\s)/iu, (m) => {
      const mi = MONTHS.indexOf(m[2].toLowerCase().replace('set', 'sep'));
      out.date = withYear(m[3] ? Number(m[3]) : null, mi, Number(m[1]));
    })
    || take(/\s(?:el\s+)?(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?(?=\s)/, (m) => {
      const y = m[3] ? Number(m[3].length === 2 ? '20' + m[3] : m[3]) : null;
      out.date = withYear(y, Number(m[2]) - 1, Number(m[1]));
    })
    || take(/\sen\s+(\d+)\s+d[ií]as(?=\s)/i, (m) => { out.date = addDays(base, Number(m[1])); })
    || take(/\s(?:la\s+)?(?:semana\s+que\s+viene|pr[oó]xima\s+semana)(?=\s)/i, () => { out.date = nextWeekday(base, 1, true); })
    || take(new RegExp(`\\s(?:el\\s+)?(pr[oó]ximo\\s+)?(${WD})(\\s+que\\s+viene)?(?=\\s)`, 'i'), (m) => {
      out.date = nextWeekday(base, wdIndex(m[2]), !!(m[1] || m[3]));
    });
  if (!out.date && out.repeat?.days?.length) {
    out.date = out.repeat.days.map((w) => nextWeekday(base, w)).sort()[0];
  }

  // Hora
  let h = null, mm = 0;
  take(/\s(?:a\s+las?\s+)?(\d{1,2})[:.h](\d{2})\s*(?:h|hrs?)?(?=\s)/i, (m) => { h = Number(m[1]); mm = Number(m[2]); })
    || take(/\s(\d{1,2})\s*(am|pm)(?=\s)/i, (m) => { h = Number(m[1]); if (m[2].toLowerCase() === 'pm') pm = true; else am = true; })
    || take(/\sa\s+las?\s+(\d{1,2})(?:\s*h)?(?=\s)/i, (m) => { h = Number(m[1]); })
    || take(/\s(\d{1,2})\s*(?:h|hrs?|horas)(?=\s)/i, (m) => { h = Number(m[1]); });
  if (h !== null) {
    if (pm && h < 12) h += 12;
    if (am && h === 12) h = 0;
    if (h < 24 && mm < 60) out.time = `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  }

  // Lugar
  take(/\s@\s*([^#@]+?)\s*$/u, (m) => { out.place = m[1].trim(); })
    || take(/\s((?:aula|sala|despacho|laboratorio|lab|edificio)\s+[\p{L}\d.-]+)(?=\s)/iu, (m) => { out.place = m[1]; })
    || (out.type && take(/\sen\s+(?:el|la|los|las)\s+([^#@]+?)\s*$/iu, (m) => { out.place = m[1].trim(); }));
  if (out.place) out.place = out.place.charAt(0).toUpperCase() + out.place.slice(1);

  // Título: lo que queda, sin palabras sueltas al principio o al final
  let title = s.replace(/\s+/g, ' ').trim()
    .replace(/^(?:(?:con|de|del|para|el|la|los|las|al|a|y)\s+)+/i, '')
    .replace(/(?:\s+(?:el|la|a|de|del|y|en|para))+$/i, '')
    .replace(/[,.;]+$/, '');
  if (title) out.title = title.charAt(0).toUpperCase() + title.slice(1);
  return out;
}
