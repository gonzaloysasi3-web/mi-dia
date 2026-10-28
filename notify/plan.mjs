// Decide qué avisos tocan ahora para un usuario. No toca la red: se puede probar con datos de ejemplo.
import { addDays } from '../dates.js';
import { itemsOn } from '../quick.js';

const LEAD_MIN = 20; // GitHub Actions puede retrasarse unos minutos: se avisa en los 20 min previos

// Fecha (AAAA-MM-DD) y minuto del día en la zona horaria del usuario
export function localNow(tz, date = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, min: Number(p.hour) * 60 + Number(p.minute) };
}

const plural = (n, s, p) => `${n} ${n === 1 ? s : p}`;

// Devuelve [{ key, title, body }] que aún no se han enviado (sent: { key: día })
export function due(state, tz, sent = {}, date = new Date()) {
  const { day, min } = localNow(tz, date);
  const items = (state.items || []).filter((i) => !i.del);
  const todays = itemsOn(items, day);
  const out = [];
  const add = (key, title, body) => { if (!sent[key]) out.push({ key, title, body }); };

  for (const i of todays) {
    if (!i.time || i.done) continue;
    const [h, m] = i.time.split(':').map(Number);
    const left = h * 60 + m - min;
    if (left >= 0 && left <= LEAD_MIN) {
      add(`pre:${i.id}:${day}`, i.title, [left ? `En ${left} min` : 'Ahora', i.time, i.place].filter(Boolean).join(' · '));
    }
  }

  if (min >= 9 * 60) {
    for (const e of items.filter((i) => i.type === 'exam' && !i.repeat && i.date === addDays(day, 1))) {
      add(`exam:${e.id}`, `Mañana tienes examen de ${e.title}`, [e.time, e.place].filter(Boolean).join(' · ') || 'Repasa hoy lo que te falte.');
    }
  }

  if (min >= 7 * 60 && min < 10 * 60 && todays.length) {
    const n = (tp) => todays.filter((i) => i.type === tp).length;
    const parts = [
      n('task') && plural(n('task'), 'tarea', 'tareas'),
      n('event') && plural(n('event'), 'cita', 'citas'),
      n('exam') && plural(n('exam'), 'examen', 'exámenes'),
    ].filter(Boolean);
    const first = todays.filter((i) => i.time).sort((a, b) => (a.time < b.time ? -1 : 1))[0];
    add(`morning:${day}`, 'Tu día', parts.join(', ') + (first ? `. Lo primero, a las ${first.time}: ${first.title}.` : '.'));
  }
  return out;
}

// Quita del registro los avisos de hace más de 2 días
export function prune(sent, day) {
  const limit = addDays(day, -2);
  return Object.fromEntries(Object.entries(sent).filter(([, d]) => d >= limit));
}
