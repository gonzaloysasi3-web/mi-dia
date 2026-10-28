// Sincronización opcional con Firebase (plan gratuito Spark). Sin configurar, la app funciona solo en local.
import cfg, { vapidKey } from './firebase-config.js';

const CDN = 'https://www.gstatic.com/firebasejs/10.14.1/';
export const enabled = !!cfg;
export const pushReady = !!(cfg && vapidKey);

let fb, auth, db, user, unsub, timer, hooks, application;

const stable = (v) => Array.isArray(v) ? v.map(stable)
  : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, stable(v[k])]))
  : v;
const byId = (a, b) => (a.id < b.id ? -1 : 1);
const LISTS = ['items', 'habits', 'focus', 'counters', 'library', 'wallet', 'classes'];
const canon = (s) => JSON.stringify(stable(Object.fromEntries(LISTS.map((k) => [k, [...(s[k] || [])].sort(byId)]))));

export async function start(h) {
  hooks = h;
  if (!enabled) return;
  try {
    const [app, a, f] = await Promise.all([
      import(CDN + 'firebase-app.js'),
      import(CDN + 'firebase-auth.js'),
      import(CDN + 'firebase-firestore.js'),
    ]);
    fb = { ...a, ...f };
    application = app.initializeApp(cfg);
    auth = a.getAuth(application);
    db = f.getFirestore(application);
    a.onAuthStateChanged(auth, (u) => {
      unsub?.(); unsub = null; user = u;
      hooks.onStatus(u ? { state: 'on', name: u.displayName || u.email } : { state: 'off' });
      if (u) listen(u);
    });
  } catch {
    hooks.onStatus({ state: 'error' });
  }
}

function listen(u) {
  const ref = fb.doc(db, 'users', u.uid);
  unsub = fb.onSnapshot(ref, (snap) => {
    const remote = snap.exists() && snap.data().state ? JSON.parse(snap.data().state) : null;
    if (snap.exists()) hooks.mail?.(snap.data().mail || null);
    const merged = hooks.merge(remote);
    if (!remote || canon(merged) !== canon(remote)) push(merged);
  }, () => hooks.onStatus({ state: 'error' }));
}

export function push(state) {
  if (!user) return;
  clearTimeout(timer);
  timer = setTimeout(() => {
    fb.setDoc(fb.doc(db, 'users', user.uid), { state: JSON.stringify(state), t: Date.now() }, { merge: true })
      .catch(() => hooks.onStatus({ state: 'error' }));
  }, 800);
}

export async function signIn() {
  const provider = new fb.GoogleAuthProvider();
  try {
    await fb.signInWithPopup(auth, provider);
  } catch (e) {
    if (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment') {
      await fb.signInWithRedirect(auth, provider);
    } else throw e;
  }
}

export const signOut = () => fb.signOut(auth);

// Pide permiso de solo lectura para Google Calendar y devuelve un token de acceso (dura una hora).
export async function connectCalendar() {
  if (!auth) throw new Error('sync off');
  const provider = new fb.GoogleAuthProvider();
  provider.addScope('https://www.googleapis.com/auth/calendar.readonly');
  if (auth.currentUser?.email) provider.setCustomParameters({ login_hint: auth.currentUser.email });
  const res = await fb.signInWithPopup(auth, provider);
  return fb.GoogleAuthProvider.credentialFromResult(res)?.accessToken || null;
}

// Avisos con la app cerrada: registra este dispositivo en Firebase Cloud Messaging.
// El aviso lo envía el script de GitHub Actions (carpeta notify/), que lee el token guardado aquí.
export async function enablePush(registration) {
  if (!user || !pushReady) throw new Error('push off');
  const m = await import(CDN + 'firebase-messaging.js');
  const token = await m.getToken(m.getMessaging(application), { vapidKey, serviceWorkerRegistration: registration });
  if (!token) throw new Error('sin token');
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  await fb.setDoc(fb.doc(db, 'users', user.uid), { push: { tokens: { [token]: { tz, at: Date.now() } } } }, { merge: true });
  return token;
}

export async function disablePush(token) {
  if (!user || !token) return;
  const m = await import(CDN + 'firebase-messaging.js');
  await m.deleteToken(m.getMessaging(application)).catch(() => {});
  await fb.updateDoc(fb.doc(db, 'users', user.uid), new fb.FieldPath('push', 'tokens', token), fb.deleteField()).catch(() => {});
}
