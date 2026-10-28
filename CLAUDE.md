# Mi día

Dashboard personal de organización diaria (tareas, citas, exámenes, estudio, hábitos, contadores, biblioteca de libros y juegos, cartera de ingresos y gastos, horario de clases). Es una PWA en español que se usa en móvil y ordenador.

- Web publicada: https://mi-dia-467b1.web.app
- Repositorio: https://github.com/gonzaloysasi3-web/mi-dia
- Proyecto Firebase: `mi-dia-467b1` (plan gratuito Spark)
- El usuario escribe en español y quiere respuestas en español.

## Cómo está hecho

HTML, CSS y JavaScript sin framework ni compilación. Los módulos ES se cargan directamente en el navegador.

| Archivo | Qué hace |
|---|---|
| `index.html` | Estructura, sprite de iconos SVG, hoja de edición (`#sheet`), hoja de biblioteca (`#libSheet`), barra de Pomodoro (`#focus`) |
| `styles.css` | Estilos. Tokens de color en `:root` con su versión oscura en `prefers-color-scheme: dark` |
| `app.js` | Toda la app: estado, vistas, acciones, Pomodoro, avisos dentro de la app, Google Calendar |
| `quick.js` | Analizador de frases en español ("examen métodos 20 nov 9:00 aula A3") y lógica de repeticiones (`occurs`, `itemsOn`) |
| `dates.js` | Fechas locales en formato `AAAA-MM-DD` |
| `sync.js` | Sincronización con Firebase (Auth de Google + Firestore), permiso de Google Calendar y registro para avisos push |
| `firebase-config.js` | Configuración web de Firebase y clave pública VAPID. No es secreta |
| `sw.js` | Service worker: caché sin conexión, avisos push y clic en avisos |
| `notify/` | Script de servidor para avisos con la app cerrada (`plan.mjs` decide, `send.mjs` envía por FCM) |
| `.github/workflows/avisos.yml` | Ejecuta `notify/send.mjs` cada 10 min |
| `.github/workflows/publicar.yml` | Publica en Firebase Hosting al subir a `main` |
| `.github/workflows/correo.yml` | Recibe el resumen de Gmail cifrado y lo guarda (`notify/correo.mjs`) |

### Vistas

`inicio`, `hoy`, `semana`, `examenes`, `horario`, `habitos`, `biblioteca`, `cartera`, `contadores`, `revision`, `ajustes`, `mas`. Cada una es una función `viewX()` en `app.js` que devuelve `{ title, sub, html }`; `render()` pinta la actual. Las acciones van por delegación de eventos con `data-act` en `#view`.

En móvil la barra inferior muestra Inicio, Hoy, Semana, Exámenes y Más; el resto (`.nav-extra`) va dentro de Más. En escritorio (≥ 880 px) todo está en la barra lateral.

### Datos

Estado local en `localStorage` (`midia.v1`) con siete listas: `items`, `habits`, `focus`, `counters`, `library`, `wallet`, `classes`. Cada elemento tiene `id` y `u` (marca de tiempo). Los borrados se marcan con `del: true` y se purgan a los 30 días. Al sincronizar se fusiona por elemento y gana el `u` más reciente.

- `items`: `type` (`task` | `event` | `exam`), `title`, `date`, `time`, `place`, `prio` (0-2), `done`, `tags[]`, `repeat` (`{ f: 'day'|'weekdays'|'week'|'month', n, days[] }`), `doneOn{fecha:1}` para repetidas, `subs[]` (subtareas o temas de examen, con `done` y `doneAt`).
- `classes`: horario `{ name, days: [0-6], start, end, place, until? }`. `classesOn()` (en `quick.js`, compartido con `notify/plan.mjs`) las convierte en elementos virtuales de tipo `class` para cada día: salen en Hoy, Semana, Inicio y la lista del calendario (sin punto en la cuadrícula), tienen aviso antes como las citas y su color sigue al nombre (`tagSlot`). No cuentan en «Semana: N elementos».
- Elementos virtuales que no se guardan: `study` y `review` (plan de estudio que reparte los temas de cada examen) y `gcal` (eventos de Google Calendar, en caché en `midia.gcal`).
- `focus`: registros de Pomodoro `{ ref, label, date, min }`.
- `counters`: `{ name, unit, step, goal, log{fecha:cantidad} }`.
- `library`: `{ kind: 'book'|'game', title, by, status: 'now'|'todo'|'done'|'dropped', total, cur, hours, pct, rating, notes, start, end }`.
- `wallet`: movimientos `{ kind: 'in'|'out', amount, title, cat, date, monthly }`. Los `monthly` se repiten cada mes desde su fecha (mismo día o el último del mes), ver `walletMonth()`. Mismo formato que el artefacto Wallet, del que se importaron los datos (Cartera → Importar movimientos acepta su JSON). En Inicio sale un gráfico circular de ingresos (`--c-in`, azul) contra gastos (`--c-out`, naranja): no se usa verde/rojo por daltonismo.

En Firestore todo va en el documento `users/{uid}`: el campo `state` (JSON del estado) y el mapa `push` (`tokens` por dispositivo con su zona horaria, y `sent` para no repetir avisos). Escribe siempre con `{ merge: true }` para no borrar `push`. Si añades una lista nueva, añádela también a `LISTS` en `app.js` y en `sync.js`.

## Reglas al editar

- Interfaz en español, estilo limpio tipo Apple, modo claro y oscuro automáticos. Fuente del sistema. Iconos SVG del sprite de `index.html` (sin emojis).
- Colores siempre desde los tokens de `styles.css`. Los colores de tipo (`--c-task`, `--c-event`, `--c-exam`) y de etiqueta (`--t0`…`--t7`) son una paleta validada para daltonismo: no los cambies sin volver a validarla.
- Zonas táctiles de al menos 44 px. Textos de usuario siempre escapados con `esc()`; en tooltips, con `textContent`.
- **Cada vez que cambies un archivo de la app, sube la versión de `CACHE` en `sw.js`** (`midia-vN`). Si no, los móviles siguen con la versión antigua. Con la versión subida, la app se actualiza sola: al volver a ella busca el `sw.js` nuevo y recarga una vez (si hay una hoja abierta, espera a que se cierre). Si añades un archivo que la app necesita, añádelo a `SHELL`.
- Si añades archivos que no deben publicarse, añádelos a `ignore` en `firebase.json`.
- Cuidado con nombres de clase repetidos: `.seg` ya es el selector Tarea/Cita/Examen de la hoja.
- Un `<input>` elimina los saltos de línea al asignar `value`: para texto con varias líneas, procésalo antes.
- Para probar el analizador o la lógica de avisos sin navegador: `node` importando `quick.js` o `notify/plan.mjs` (el `package.json` de la raíz marca el proyecto como ES modules).

## Publicar

Al subir a `main`, el workflow `publicar.yml` despliega en Firebase Hosting usando el secreto `FIREBASE_SERVICE_ACCOUNT`. Desde un ordenador con sesión iniciada en Firebase también vale `npx firebase-tools deploy --only hosting --project mi-dia-467b1`.

## Avisos con la app cerrada

1. En Ajustes el usuario activa los avisos; `sync.enablePush()` guarda el token FCM del dispositivo en `users/{uid}.push.tokens`.
2. `avisos.yml` ejecuta `notify/send.mjs` cada 10 min con el secreto `FIREBASE_SERVICE_ACCOUNT`.
3. `notify/plan.mjs` decide: hasta 20 min antes de lo que tenga hora (GitHub retrasa a veces el cron), el día antes de un examen desde las 9:00 y un resumen de 7:00 a 10:00 en la zona horaria del usuario.
4. `sw.js` muestra el aviso. Mientras un dispositivo tenga token, la app no duplica avisos desde dentro (`notifyCheck`).

## Resumen de correo

1. La tarea programada de Claude «Correo Mi día» (7:18 y 19:18, hora de Madrid) lee Gmail, clasifica cada hilo en `p` 2 (importante), 1 (para leer) o 0 (puede esperar) y escribe `{ email, items: [{ p, from, subject, summary, thread }] }`.
2. Lo cifra con `notify/cifrar.mjs` y `notify/correo-publica.pem` (RSA-OAEP + AES-256-GCM): el repositorio es público y el input del workflow se ve.
3. Lanza `correo.yml` con el input `datos`. `notify/correo.mjs` descifra con la clave privada de `FIREBASE_SERVICE_ACCOUNT`, busca el usuario por email, guarda `users/{uid}.mail = { at, items }` y manda un aviso.
4. La app lo recibe en `sync.js` (`hooks.mail`), lo guarda en `midia.mail` y lo pinta en Inicio (`mailHtml()`). Clases `m0`-`m2`, no `p2` (ya existe para prioridad).

Si cambia la cuenta de servicio, vuelve a sacar la clave pública lanzando `correo.yml` sin datos y sustituye `notify/correo-publica.pem`.

## Estado y pendiente

Hecho y publicado: todo lo de la tabla de arriba.

Pendiente de comprobar (a 28 oct 2026). Los workflows ya usan Node 24 (checkout@v5, setup-node@v5):
- ~~Workflow Avisos~~: funciona (secreto correcto, cron activo) y el móvil del usuario está registrado (28 oct 2026). Falta que confirme que le llega un aviso con la app cerrada.
- ~~Despliegue automático~~: funciona desde el 28 oct 2026 (a la cuenta de servicio le faltaba el rol «Consumidor de Service Usage», ya añadido).
- Avisos push y Google Calendar con la cuenta real del usuario en su móvil (necesitan que active la API de Google Calendar en Google Cloud, enlace en Ajustes).

- La tarea programada «Correo Mi día» necesita que el usuario le añada el conector de Gmail desde claude.ai (creada sin conectores). El recorrido completo se probó a mano el 28 oct 2026 y funciona.

Ideas que el usuario ha visto y aún no ha pedido: widget real de iOS (no es posible en una PWA; se usa un atajo de la app Atajos).
