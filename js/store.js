/* ==========================================================================
   PomoMomo — Capa de datos
   Dos backends con la misma API:
     · cloud  → Firebase Firestore + Google Sign-In (tiempo real, multi-dispositivo)
     · local  → localStorage (funciona sin configurar Firebase)
   ========================================================================== */

import { FIREBASE_CONFIG, WORKSPACE_ID, FIREBASE_SDK, IS_CONFIGURED, DEFAULT_TIMER } from './config.js';

const LS_KEY   = 'pomomomo.v2';
const LS_PREFS = 'pomomomo.prefs';

/* ---------- Utilidades ---------- */
export const uid = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 9);

export const nowISO = () => new Date().toISOString();

/** Fecha local en formato AAAA-MM-DD (no UTC: importa cerca de medianoche). */
export const dayISO = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Suma días a una fecha AAAA-MM-DD */
export const shiftISO = (iso, n) => {
  if (!iso) return iso;
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return dayISO(d);
};

/** Días entre dos fechas AAAA-MM-DD */
export const diffISO = (a, b) =>
  Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 86400000);

const clone = (o) => JSON.parse(JSON.stringify(o));

/**
 * Elimina los `undefined` en cualquier nivel: Firestore los rechaza con
 * "Unsupported field value: undefined" y tumba la escritura entera.
 * Con merge:true, omitir un campo conserva su valor anterior, que es
 * justo lo que significa "no especificado". `null` sí es válido y se
 * respeta, porque es la forma de borrar un valor a propósito.
 */
function sanitize(value) {
  if (Array.isArray(value)) {
    return value.filter(v => v !== undefined).map(sanitize);
  }
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (v === undefined) continue;
      out[k] = sanitize(v);
    }
    return out;
  }
  return value;
}

/* ---------- Emisor de eventos ---------- */
class Emitter {
  constructor() { this._h = {}; }
  on(evt, fn) {
    (this._h[evt] ||= []).push(fn);
    return () => this.off(evt, fn);
  }
  off(evt, fn) { this._h[evt] = (this._h[evt] || []).filter(f => f !== fn); }
  emit(evt, payload) { (this._h[evt] || []).forEach(fn => { try { fn(payload); } catch (e) { console.error(e); } }); }
}

/* ==========================================================================
   Store
   ========================================================================== */
export class Store extends Emitter {
  constructor() {
    super();
    this.mode = 'local';          // 'local' | 'cloud'
    this.ready = false;
    this.authState = 'loading';   // 'loading' | 'signed-out' | 'signed-in' | 'no-access'
    this.user = null;
    this.error = null;
    this.authError = null;      // último fallo de acceso, para mostrarlo en pantalla
    this.listenerErrors = {};   // colecciones que no se pudieron leer

    this.data = {
      members:      [],
      portfolios:   [],
      projects:     [],
      deliverables: [],
      activities:   [],
      history:      [],
      sessions:     [],
      sprints:      []
    };

    this.prefs = { ...DEFAULT_TIMER };
    this._fb = null;              // handles de Firebase
    this._unsubs = [];
    this._loadPrefs();
  }

  /* ---------- Preferencias (siempre locales, por dispositivo) ---------- */
  _loadPrefs() {
    try {
      const raw = localStorage.getItem(LS_PREFS);
      if (raw) this.prefs = { ...DEFAULT_TIMER, ...JSON.parse(raw) };
    } catch { /* ignora */ }
  }
  savePrefs(patch) {
    this.prefs = { ...this.prefs, ...patch };
    try { localStorage.setItem(LS_PREFS, JSON.stringify(this.prefs)); } catch { /* ignora */ }
    this.emit('prefs', this.prefs);
  }

  /* ======================================================================
     Arranque
     ====================================================================== */
  async init() {
    if (IS_CONFIGURED) {
      try {
        await this._initCloud();
        return;
      } catch (err) {
        console.error('[PomoMomo] Falló Firebase, usando modo local:', err);
        this.error = err?.message || String(err);
      }
    }
    this._initLocal();
  }

  /* ---------- Modo local ---------- */
  _initLocal() {
    this.mode = 'local';
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) Object.assign(this.data, JSON.parse(raw));
    } catch { /* ignora */ }

    this.user = { uid: 'local', displayName: 'Tú', email: '', photoURL: '', local: true };
    if (!this.data.members.length) {
      this.data.members = [{
        id: 'local', uid: 'local', displayName: 'Tú',
        email: '', photoURL: '', role: 'owner', joinedAt: nowISO()
      }];
    }
    this.authState = 'signed-in';
    this.ready = true;
    this.emit('auth', this);
    this.emit('data', this.data);
    this.emit('ready', this);
  }

  _persistLocal() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(this.data)); } catch { /* ignora */ }
    this.emit('data', this.data);
  }

  /* ---------- Modo nube ---------- */
  async _initCloud() {
    const base = `https://www.gstatic.com/firebasejs/${FIREBASE_SDK}`;
    const [appMod, authMod, fsMod] = await Promise.all([
      import(`${base}/firebase-app.js`),
      import(`${base}/firebase-auth.js`),
      import(`${base}/firebase-firestore.js`)
    ]);

    const app = appMod.initializeApp(FIREBASE_CONFIG);
    const auth = authMod.getAuth(app);

    /* Caché offline: permite trabajar sin señal (iPhone en el metro, avión…)
       y sincroniza al reconectar. persistentMultipleTabManager evita que se
       peleen varias pestañas abiertas. */
    let db;
    try {
      db = fsMod.initializeFirestore(app, {
        localCache: fsMod.persistentLocalCache({
          tabManager: fsMod.persistentMultipleTabManager()
        })
      });
    } catch (e) {
      // Navegador sin IndexedDB (o modo privado): sigue funcionando en memoria
      console.warn('[PomoMomo] Sin caché offline:', e?.message || e);
      db = fsMod.getFirestore(app);
    }

    this._fb = { app, auth, db, authMod, fsMod };
    this.mode = 'cloud';

    /* Recoge el resultado de un signInWithRedirect SIN bloquear el arranque.
       Si se espera con await antes de registrar onAuthStateChanged y la
       promesa no resuelve, la app se queda colgada en la pantalla de carga. */
    const veniaDeRedirect = sessionStorage.getItem('pomomomo.redirecting') === '1';
    sessionStorage.removeItem('pomomomo.redirecting');

    authMod.getRedirectResult(auth)
      .then(() => {
        if (veniaDeRedirect && !auth.currentUser) {
          this.authError = {
            code: 'auth/redirect-sin-sesion',
            message: 'La redirección volvió sin sesión. Suele pasar cuando el navegador bloquea cookies de terceros: prueba con la ventana emergente o permite cookies para este sitio.'
          };
          this.emit('auth', this);
        }
      })
      .catch((e) => {
        this.authError = {
          code: e?.code || 'desconocido',
          message: Store.authMessage(e?.code) || e?.message || 'Falló el acceso por redirección.'
        };
        console.error('[PomoMomo] Redirect:', e);
        this.emit('auth', this);
      });

    /* Red de seguridad: si en 12 s no hubo respuesta de Firebase, se muestra
       la pantalla de acceso con el aviso en vez de dejar el spinner eterno. */
    const watchdog = setTimeout(() => {
      if (this.ready) return;
      this.authState = 'signed-out';
      this.ready = true;
      this.authError = {
        code: 'sin-respuesta',
        message: 'Firebase no respondió a tiempo. Revisa tu conexión y vuelve a intentarlo.'
      };
      console.warn('[PomoMomo] Watchdog: Firebase no respondió en 12 s');
      this.emit('auth', this);
      this.emit('ready', this);
    }, 12000);
    this._watchdog = watchdog;

    authMod.onAuthStateChanged(auth, async (u) => {
      clearTimeout(this._watchdog);
      this._teardownListeners();
      if (!u) {
        this.user = null;
        this.authState = 'signed-out';
        this.ready = true;
        this._resetData();
        this.emit('auth', this);
        this.emit('ready', this);
        return;
      }

      this.user = {
        uid: u.uid, displayName: u.displayName || u.email, email: u.email,
        photoURL: u.photoURL || ''
      };

      const ok = await this._ensureMembership();
      if (!ok) {
        this.authState = 'no-access';
        this.ready = true;
        this.emit('auth', this);
        this.emit('ready', this);
        return;
      }

      this.authState = 'signed-in';
      this.emit('auth', this);
      this._attachListeners();
    });
  }

  /* Crea el doc de miembro si el usuario está invitado o es el primero (bootstrap) */
  async _ensureMembership() {
    const { db, fsMod } = this._fb;
    const { doc, getDoc, serverTimestamp, collection, getDocs, limit, query, deleteDoc, writeBatch } = fsMod;
    const wsRef = doc(db, 'workspaces', WORKSPACE_ID);
    const meRef = doc(db, 'workspaces', WORKSPACE_ID, 'members', this.user.uid);

    const email = (this.user.email || '').toLowerCase();
    const invRef = doc(db, 'workspaces', WORKSPACE_ID, 'invites', email);

    /* Cada paso se registra para poder mostrar en pantalla DONDE falló.
       Antes cualquier error devolvia false y el usuario solo veia
       "Sin acceso" sin ninguna pista de la causa. */
    this.accessTrace = [];
    const paso = (nombre, detalle) => {
      this.accessTrace.push(`${nombre}: ${detalle}`);
      console.info('[PomoMomo] membresía →', nombre, detalle);
    };
    const fallo = (nombre, e) => {
      const code = e?.code || 'desconocido';
      this.accessError = { paso: nombre, code, message: e?.message || String(e) };
      this.accessTrace.push(`${nombre}: ERROR ${code}`);
      console.error('[PomoMomo] membresía ✗', nombre, e);
      return false;
    };

    this.accessError = null;

    // 1) ¿Ya soy miembro?
    let me;
    try {
      me = await getDoc(meRef);
      paso('leer mi ficha de miembro', me.exists() ? 'ya existe' : 'no existe todavía');
    } catch (e) { return fallo('leer mi ficha de miembro', e); }
    if (me.exists()) return true;

    // 2) ¿Tengo invitación?
    let inv = null;
    try {
      inv = await getDoc(invRef);
      paso('buscar invitación', inv.exists() ? 'encontrada' : 'sin invitación');
    } catch (e) { return fallo('buscar invitación', e); }

    // 3) ¿El espacio está sin dueño? El primero en entrar se vuelve propietario.
    let isFirst = false;
    if (!inv.exists()) {
      try {
        const snap = await getDocs(query(collection(db, 'workspaces', WORKSPACE_ID, 'members'), limit(1)));
        isFirst = snap.empty;
        paso('revisar si el espacio está vacío', isFirst ? 'vacío → serás propietario' : 'ya tiene miembros');
      } catch (e) { return fallo('revisar si el espacio está vacío', e); }
    }

    if (!inv.exists() && !isFirst) {
      this.accessError = {
        paso: 'autorización',
        code: 'sin-invitacion',
        message: 'El espacio ya tiene miembros y esta cuenta no tiene invitación.'
      };
      return false;
    }

    // 4) Alta atómica: ficha de miembro + documento del espacio en un solo lote.
    //    Si se hicieran por separado y fallara el segundo, el espacio quedaría
    //    "reclamado" sin propietario y nadie podría volver a entrar.
    try {
      const batch = writeBatch(db);
      batch.set(meRef, {
        uid: this.user.uid,
        displayName: this.user.displayName || '',
        email,
        photoURL: this.user.photoURL || '',
        role: isFirst ? 'owner' : (inv.data()?.role || 'member'),
        joinedAt: serverTimestamp()
      });
      if (isFirst) {
        batch.set(wsRef, {
          name: 'Espacio principal',
          ownerUid: this.user.uid,
          createdAt: serverTimestamp()
        }, { merge: true });
      }
      await batch.commit();
      paso('registrar acceso', isFirst ? 'creado como propietario' : 'creado como miembro');
    } catch (e) { return fallo('registrar acceso', e); }

    if (inv?.exists()) { try { await deleteDoc(invRef); } catch { /* la invitación sobrante no estorba */ } }
    return true;
  }

  _resetData() {
    this.data = { members: [], portfolios: [], projects: [], deliverables: [], activities: [], history: [], sessions: [], sprints: [] };
    this.emit('data', this.data);
  }

  _attachListeners() {
    const { db, fsMod } = this._fb;
    const { collection, onSnapshot, query, orderBy, limit } = fsMod;
    const colls = ['members', 'portfolios', 'projects', 'deliverables', 'activities', 'sprints'];

    let pending = colls.length + 1;
    const settle = () => {
      if (--pending === 0) { this.ready = true; this.emit('ready', this); }
    };

    colls.forEach((name) => {
      const ref = collection(db, 'workspaces', WORKSPACE_ID, name);
      const un = onSnapshot(ref,
        (snap) => {
          this.data[name] = snap.docs.map(d => ({ id: d.id, ...d.data() }));
          this.emit('data', this.data);
          if (pending > 0) settle();
        },
        (err) => { this._listenerFailed(name, err); if (pending > 0) settle(); }
      );
      this._unsubs.push(un);
    });

    // Historial: últimos 500 eventos
    const hRef = query(
      collection(db, 'workspaces', WORKSPACE_ID, 'history'),
      orderBy('ts', 'desc'), limit(500)
    );
    const unH = onSnapshot(hRef,
      (snap) => {
        this.data.history = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        this.emit('data', this.data);
        if (pending > 0) settle();
      },
      (err) => { this._listenerFailed('history', err); if (pending > 0) settle(); }
    );
    this._unsubs.push(unH);

    // Sesiones de pomodoro (últimas 400)
    const sRef = query(
      collection(db, 'workspaces', WORKSPACE_ID, 'sessions'),
      orderBy('endedAt', 'desc'), limit(400)
    );
    this._unsubs.push(onSnapshot(sRef,
      (snap) => {
        this.data.sessions = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        delete this.listenerErrors.sessions;
        this.emit('data', this.data);
      },
      (err) => this._listenerFailed('sessions', err)
    ));
  }

  /**
   * Un listener que falla dejaba su colección vacía sin ninguna señal:
   * la interfaz mostraba cero datos como si no hubiera nada guardado.
   */
  _listenerFailed(coll, err) {
    const code = err?.code || 'desconocido';
    this.listenerErrors[coll] = {
      code,
      message: code === 'permission-denied'
        ? `Firestore no deja leer «${coll}». Falta publicar la regla de esa colección.`
        : (err?.message || 'No se pudo leer la colección.')
    };
    console.error(`[PomoMomo] Lectura de ${coll}:`, code, err);
    this.emit('data', this.data);
  }

  _teardownListeners() {
    this._unsubs.forEach(u => { try { u(); } catch { /* ignora */ } });
    this._unsubs = [];
  }

  /* ---------- Autenticación ---------- */

  /** Mensajes legibles para los códigos de error de Firebase Auth. */
  static authMessage(code) {
    const M = {
      'auth/popup-blocked':            'El navegador bloqueó la ventana emergente. Permite las ventanas emergentes para este sitio, o usa el modo redirección.',
      'auth/popup-closed-by-user':     'Cerraste la ventana de Google antes de terminar.',
      'auth/cancelled-popup-request':  'Se abrió otra ventana de acceso. Cierra las ventanas de Google y vuelve a intentarlo.',
      'auth/unauthorized-domain':      'Este dominio no está autorizado en Firebase. Agrégalo en Authentication → Settings → Dominios autorizados.',
      'auth/operation-not-supported-in-this-environment': 'Este navegador no admite ventanas emergentes. Usa el modo redirección.',
      'auth/network-request-failed':   'Falló la conexión de red. Revisa tu internet e inténtalo de nuevo.',
      'auth/internal-error':           'Error interno de Firebase. Verifica que el proveedor Google esté habilitado en Authentication.',
      'auth/operation-not-allowed':    'El acceso con Google no está habilitado. Actívalo en Firebase → Authentication → Sign-in method.',
      'auth/too-many-requests':        'Demasiados intentos. Espera un momento antes de reintentar.',
      'auth/web-storage-unsupported':  'El navegador bloquea el almacenamiento web. Desactiva el modo privado o permite cookies para este sitio.'
    };
    return M[code] || '';
  }

  /**
   * @param {'popup'|'redirect'} via  Método de acceso.
   * Los errores se propagan SIEMPRE con .code y .friendly para que la
   * interfaz pueda mostrarlos: fallar en silencio deja al usuario atascado.
   */
  async signIn(via = 'popup') {
    if (this.mode !== 'cloud') throw new Error('Firebase no está configurado.');
    const { auth, authMod } = this._fb;
    const provider = new authMod.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });

    const decorate = (e) => {
      const err = e instanceof Error ? e : new Error(String(e));
      err.code = e?.code || 'desconocido';
      err.friendly = Store.authMessage(err.code) || e?.message || 'No se pudo iniciar sesión.';
      console.error('[PomoMomo] Auth:', err.code, e);
      return err;
    };

    if (via === 'redirect') {
      try {
        sessionStorage.setItem('pomomomo.redirecting', '1');
        await authMod.signInWithRedirect(auth, provider);
      } catch (e) {
        sessionStorage.removeItem('pomomomo.redirecting');
        throw decorate(e);
      }
      return;
    }

    try {
      await authMod.signInWithPopup(auth, provider);
    } catch (e) {
      throw decorate(e);
    }
  }

  /** ¿Conviene ofrecer el modo redirección para este código de error? */
  static canRetryWithRedirect(code) {
    return ['auth/popup-blocked', 'auth/cancelled-popup-request',
            'auth/operation-not-supported-in-this-environment'].includes(code);
  }

  async signOut() {
    if (this.mode !== 'cloud') return;
    await this._fb.authMod.signOut(this._fb.auth);
  }

  /* ======================================================================
     CRUD genérico
     ====================================================================== */
  async _put(coll, obj) {
    const isNew = !obj.id;
    const id = obj.id || uid();
    const rec = { ...obj, id };

    if (this.mode === 'cloud') {
      const { db, fsMod } = this._fb;
      const { doc, setDoc } = fsMod;
      const { id: _drop, ...payload } = rec;
      try {
        await setDoc(doc(db, 'workspaces', WORKSPACE_ID, coll, id), sanitize(payload), { merge: true });
      } catch (e) { throw Store.writeError(e, coll); }
    } else {
      const arr = this.data[coll];
      const i = arr.findIndex(x => x.id === id);
      if (i >= 0) arr[i] = { ...arr[i], ...rec }; else arr.push(rec);
      this._persistLocal();
    }
    return { ...rec, _isNew: isNew };
  }

  async _del(coll, id) {
    if (this.mode === 'cloud') {
      const { db, fsMod } = this._fb;
      try {
        await fsMod.deleteDoc(fsMod.doc(db, 'workspaces', WORKSPACE_ID, coll, id));
      } catch (e) { throw Store.writeError(e, coll); }
    } else {
      this.data[coll] = this.data[coll].filter(x => x.id !== id);
      this._persistLocal();
    }
  }

  /**
   * Convierte un error de Firestore en algo accionable.
   * Sin esto, un rechazo de reglas deja los botones aparentemente muertos.
   */
  static writeError(e, coll) {
    const code = e?.code || 'desconocido';
    const NOMBRES = {
      deliverables: 'entregables', activities: 'actividades', projects: 'proyectos',
      portfolios: 'portafolios', sprints: 'sprints', history: 'historial', sessions: 'sesiones'
    };
    const nombre = NOMBRES[coll] || coll;

    let friendly;
    if (code === 'permission-denied') {
      friendly = `Firestore rechazó la escritura en «${nombre}». Falta publicar la regla de esa colección en Firebase → Firestore → Reglas.`;
    } else if (code === 'unavailable') {
      friendly = 'Sin conexión con Firestore. El cambio se guardará al reconectar.';
    } else if (code === 'unauthenticated') {
      friendly = 'Tu sesión expiró. Vuelve a iniciar sesión.';
    } else {
      friendly = e?.message || 'No se pudo guardar el cambio.';
    }

    const err = e instanceof Error ? e : new Error(friendly);
    err.code = code;
    err.collection = coll;
    err.friendly = friendly;
    console.error(`[PomoMomo] Escritura en ${coll}:`, code, e);
    return err;
  }

  /* ======================================================================
     Portafolios
     ====================================================================== */
  async savePortfolio(p) {
    const isNew = !p.id;
    const rec = await this._put('portfolios', {
      ...p,
      createdAt: p.createdAt || nowISO(),
      createdBy: p.createdBy || this.user?.uid || ''
    });
    return rec;
  }

  async deletePortfolio(id) {
    // Desvincula proyectos en lugar de borrarlos
    const projs = this.data.projects.filter(p => p.portfolioId === id);
    for (const p of projs) await this._put('projects', { ...p, portfolioId: '' });
    await this._del('portfolios', id);
  }

  /* ======================================================================
     Proyectos
     ====================================================================== */
  async saveProject(p) {
    return this._put('projects', {
      ...p,
      createdAt: p.createdAt || nowISO(),
      createdBy: p.createdBy || this.user?.uid || ''
    });
  }

  async deleteProject(id) {
    const acts = this.data.activities.filter(a => a.projectId === id);
    for (const a of acts) await this._del('activities', a.id);
    await this._del('projects', id);
  }

  /* ======================================================================
     Actividades
     ====================================================================== */
  async saveActivity(a) {
    const isNew = !a.id;
    const prev = isNew ? null : this.data.activities.find(x => x.id === a.id);

    const { _noCascade, ...limpio } = a;
    const rec = await this._put('activities', {
      ...limpio,
      dependsOn:   limpio.dependsOn ?? prev?.dependsOn ?? [],
      pomosDone:   limpio.pomosDone ?? prev?.pomosDone ?? 0,
      createdAt:   limpio.createdAt || prev?.createdAt || nowISO(),
      createdBy:   limpio.createdBy || prev?.createdBy || this.user?.uid || '',
      updatedAt:   nowISO()
    });

    /* --- Memoria de la tarea --- */
    if (isNew) {
      await this.log(rec.id, 'created', { text: rec.name });
      if (rec.assigneeUid) await this.log(rec.id, 'assign', { to: rec.assigneeUid });
    } else if (prev) {
      if (prev.status !== rec.status)
        await this.log(rec.id, 'status', { from: prev.status, to: rec.status });
      if ((prev.assigneeUid || '') !== (rec.assigneeUid || ''))
        await this.log(rec.id, 'assign', { from: prev.assigneeUid || '', to: rec.assigneeUid || '' });
      if (prev.quadrant !== rec.quadrant)
        await this.log(rec.id, 'quadrant', { from: prev.quadrant, to: rec.quadrant });
      if ((prev.dueDate || '') !== (rec.dueDate || ''))
        await this.log(rec.id, 'due', { from: prev.dueDate || '', to: rec.dueDate || '' });
      if (prev.name !== rec.name)
        await this.log(rec.id, 'rename', { from: prev.name, to: rec.name });
    }

    /* Si la actividad se movió en el calendario, arrastra a sus sucesoras
       para que el encadenamiento conserve la separación planeada.
       `_noCascade` lo evita cuando el propio arrastre es quien guarda. */
    if (prev && !isNew && !a._noCascade) {
      const antes = prev.dueDate || prev.startDate;
      const ahora = rec.dueDate || rec.startDate;
      if (antes && ahora && antes !== ahora) {
        const delta = diffISO(antes, ahora);
        if (delta) {
          rec._movidas = await this.cascadeShift(rec.id, delta, { motivo: `arrastre desde «${rec.name}»` });
          rec._delta = delta;
        }
      }
    }
    return rec;
  }

  async setActivityStatus(id, status) {
    const a = this.data.activities.find(x => x.id === id);
    if (!a || a.status === status) return;
    const patch = {
      ...a, status,
      completedAt: status === 'done' ? (a.completedAt || nowISO()) : null,
      updatedAt: nowISO()
    };
    await this._put('activities', patch);
    await this.log(id, 'status', { from: a.status, to: status });

    // Al completar una actividad recurrente se engendra la siguiente ocurrencia
    if (status === 'done' && a.recur) return this._spawnNextOccurrence(a);
  }

  /**
   * Crea la siguiente ocurrencia de una actividad recurrente.
   * @returns {object|null} la nueva actividad, para poder avisar en la interfaz
   */
  async _spawnNextOccurrence(a) {
    const { nextOccurrence } = await import('./quickadd.js');
    const base = a.dueDate || a.startDate || dayISO();
    let next = nextOccurrence(a.recur, base);

    // Si la fecha calculada ya pasó (tarea atrasada), avanza hasta el futuro
    let guard = 0;
    while (next && next < dayISO() && guard++ < 60) {
      next = nextOccurrence(a.recur, next);
    }
    // La serie termina en recur.until: ahí no se engendra nada más
    if (a.recur.until && next > a.recur.until) return null;

    const nueva = await this._put('activities', {
      name: a.name,
      projectId: a.projectId || '',
      deliverableIds: Store.deliverableIdsOf(a),
      dependsOn: a.dependsOn || [],
      assigneeUid: a.assigneeUid || '',
      quadrant: a.quadrant,
      status: 'todo',
      points: a.points || 0,
      pomosEstimated: a.pomosEstimated || 0,
      pomosDone: 0,
      // En una serie, cada ocurrencia es de un día: empieza y vence el mismo
      startDate: next,
      dueDate: next,
      notes: a.notes || '',
      recur: a.recur,
      recurOf: a.recurOf || a.id,
      createdAt: nowISO(),
      createdBy: this.user?.uid || '',
      completedAt: null
    });
    await this.log(nueva.id, 'created', { text: `Repetición de «${a.name}»` });
    return nueva;
  }

  /**
   * Fechas en que una serie caería dentro de un rango, para poder
   * anticipar las próximas repeticiones sin tener que engendrarlas.
   */
  static occurrencesBetween(a, desde, hasta, nextFn, limite = 60) {
    if (!a?.recur) return [];
    const fin = a.recur.until && a.recur.until < hasta ? a.recur.until : hasta;
    const out = [];
    let f = a.dueDate || a.startDate;
    let guard = 0;
    while (f && f <= fin && guard++ < limite) {
      if (f >= desde) out.push(f);
      f = nextFn(a.recur, f);
    }
    return out;
  }

  /* ======================================================================
     Entregables — resultados tangibles que se marcan como logrados
     ====================================================================== */
  /**
   * Subtarea de una actividad. `kind` distingue las dos formas:
   *   entregable → produce algo tangible y cuenta como logro
   *   paso       → solo un paso para avanzar
   * `activityId` vacío = subtarea suelta a nivel de proyecto.
   */
  async saveDeliverable(d) {
    const prev = d.id ? this.deliverable(d.id) : null;
    return this._put('deliverables', {
      ...d,
      kind:       d.kind ?? prev?.kind ?? 'entregable',
      activityId: d.activityId ?? prev?.activityId ?? '',
      desc:       d.desc ?? prev?.desc ?? '',
      targetDate: d.targetDate ?? prev?.targetDate ?? '',
      achieved:   d.achieved ?? prev?.achieved ?? false,
      achievedAt: d.achievedAt ?? prev?.achievedAt ?? null,
      order:      d.order ?? prev?.order ?? Date.now(),
      createdAt:  d.createdAt || prev?.createdAt || nowISO(),
      createdBy:  d.createdBy || prev?.createdBy || this.user?.uid || ''
    });
  }

  /* ======================================================================
     Dependencias entre actividades
     ====================================================================== */

  /** Predecesoras declaradas de una actividad */
  predecessorsOf(id) {
    const a = this.activity(id);
    return (a?.dependsOn || []).map(x => this.activity(x)).filter(Boolean);
  }

  /** Actividades que declaran depender de esta */
  successorsOf(id) {
    return this.data.activities.filter(a => (a.dependsOn || []).includes(id));
  }

  /** Todas las sucesoras, directas e indirectas */
  successorsClosure(id, acc = new Set()) {
    this.successorsOf(id).forEach(s => {
      if (acc.has(s.id)) return;      // corta ciclos si los hubiera
      acc.add(s.id);
      this.successorsClosure(s.id, acc);
    });
    return acc;
  }

  /** ¿Puede `id` depender de `candidateId` sin formar un ciclo? */
  canDependOn(id, candidateId) {
    if (id === candidateId) return false;
    return !this.successorsClosure(id).has(candidateId);
  }

  /**
   * Desplaza en cascada las sucesoras de una actividad.
   * Se llama después de mover la predecesora, para que el resto del
   * encadenamiento conserve la misma separación en el calendario.
   * @returns {Array} actividades movidas
   */
  async cascadeShift(fromId, deltaDays, { motivo = '' } = {}) {
    if (!deltaDays) return [];
    const movidas = [];
    const vistas = new Set([fromId]);

    const recorrer = async (id) => {
      for (const s of this.successorsOf(id)) {
        if (vistas.has(s.id)) continue;
        vistas.add(s.id);
        const patch = { ...s, updatedAt: nowISO() };
        if (s.startDate) patch.startDate = shiftISO(s.startDate, deltaDays);
        if (s.dueDate)   patch.dueDate   = shiftISO(s.dueDate, deltaDays);
        if (s.recur?.until) patch.recur = { ...s.recur, until: shiftISO(s.recur.until, deltaDays) };
        delete patch._movidas; delete patch._delta;
        await this._put('activities', patch);
        await this.log(s.id, 'shift', {
          text: `${deltaDays > 0 ? '+' : ''}${deltaDays} días${motivo ? ` · ${motivo}` : ''}`
        });
        movidas.push(s);
        await recorrer(s.id);
      }
    };

    await recorrer(fromId);
    return movidas;
  }

  /** Subtareas de una actividad, ordenadas */
  subtasksOf(activityId) {
    return this.data.deliverables
      .filter(d => d.activityId === activityId)
      .sort((a, b) => (a.order || 0) - (b.order || 0));
  }

  async achieveDeliverable(id, achieved = true) {
    const d = this.data.deliverables.find(x => x.id === id);
    if (!d) return;
    await this._put('deliverables', {
      ...d,
      achieved,
      achievedAt: achieved ? (d.achievedAt || nowISO()) : null,
      achievedBy: achieved ? (this.user?.uid || '') : ''
    });
  }

  async deleteDeliverable(id) {
    // Las actividades vinculadas no se borran: solo pierden el vínculo
    const acts = this.activitiesOfDeliverable(id);
    for (const a of acts) {
      await this._put('activities', { ...a, deliverableIds: Store.deliverableIdsOf(a).filter(x => x !== id) });
    }
    await this._del('deliverables', id);
  }

  deliverablesOf(projectId) {
    return this.data.deliverables.filter(d => d.projectId === projectId);
  }

  deliverable(id) {
    return this.data.deliverables.find(d => d.id === id) || null;
  }

  /**
   * Entregables de una actividad, siempre como lista.
   * Acepta el campo antiguo `deliverableId` para no romper lo ya guardado.
   */
  static deliverableIdsOf(a) {
    if (Array.isArray(a?.deliverableIds)) return a.deliverableIds.filter(Boolean);
    return a?.deliverableId ? [a.deliverableId] : [];
  }

  /**
   * Actividades relacionadas con un entregable: la dueña (si es subtarea)
   * más las que declararon contribuir a él.
   */
  activitiesOfDeliverable(id) {
    const d = this.deliverable(id);
    const vistos = new Set();
    const out = [];
    if (d?.activityId) {
      const dueña = this.activity(d.activityId);
      if (dueña) { out.push(dueña); vistos.add(dueña.id); }
    }
    this.data.activities.forEach(a => {
      if (!vistos.has(a.id) && Store.deliverableIdsOf(a).includes(id)) out.push(a);
    });
    return out;
  }

  /** Objetos de entregable vinculados a una actividad */
  deliverablesOfActivity(a) {
    return Store.deliverableIdsOf(a).map(id => this.deliverable(id)).filter(Boolean);
  }

  /**
   * Entregables pendientes que ya son trabajo del día, con el motivo por
   * el que aparecen. Un entregable entra si tiene fecha objetivo vencida
   * o de hoy, o si alguna actividad que lo empuja está activa o vence ya.
   * @param {string} hoy  fecha AAAA-MM-DD
   */
  actionableDeliverables(hoy) {
    return this.data.deliverables
      .filter(d => !d.achieved)
      .map(d => {
        const acts = this.activitiesOfDeliverable(d.id).filter(a => a.status !== 'done');
        const enCurso = acts.filter(a => a.status === 'inprogress');
        const vencen = acts.filter(a => a.dueDate && a.dueDate <= hoy);

        if (d.targetDate && d.targetDate < hoy) return { d, motivo: 'vencido', acts };
        if (d.targetDate === hoy)               return { d, motivo: 'hoy', acts };
        if (enCurso.length)                     return { d, motivo: 'en-curso', acts };
        if (vencen.length)                      return { d, motivo: 'actividad-vence', acts };
        return null;
      })
      .filter(Boolean);
  }

  async setAssignee(id, assigneeUid) {
    const a = this.data.activities.find(x => x.id === id);
    if (!a || (a.assigneeUid || '') === (assigneeUid || '')) return;
    await this._put('activities', { ...a, assigneeUid, updatedAt: nowISO() });
    await this.log(id, 'assign', { from: a.assigneeUid || '', to: assigneeUid || '' });
  }

  async setQuadrant(id, quadrant) {
    const a = this.data.activities.find(x => x.id === id);
    if (!a || a.quadrant === quadrant) return;
    await this._put('activities', { ...a, quadrant, updatedAt: nowISO() });
    await this.log(id, 'quadrant', { from: a.quadrant, to: quadrant });
  }

  async deleteActivity(id) {
    await this._del('activities', id);
    if (this.mode === 'local') {
      this.data.history = this.data.history.filter(h => h.activityId !== id);
      this._persistLocal();
    }
  }

  /**
   * Registra un pomodoro contra una actividad o un entregable.
   * @param {string|{type:'activity'|'deliverable',id:string}|null} target
   *        Se acepta un id suelto por compatibilidad con lo ya guardado.
   */
  async addPomodoro(target, minutes) {
    const t = Store.normalizeTarget(target);

    let activityId = '', deliverableId = '', projectId = '';

    if (t?.type === 'deliverable') {
      const d = this.deliverable(t.id);
      if (d) {
        deliverableId = d.id;
        projectId = d.projectId || '';
        await this._put('deliverables', { ...d, pomosDone: (d.pomosDone || 0) + 1, updatedAt: nowISO() });
      }
    } else if (t?.type === 'activity') {
      const a = this.activity(t.id);
      if (a) {
        activityId = a.id;
        projectId = a.projectId || '';
        await this._put('activities', { ...a, pomosDone: (a.pomosDone || 0) + 1, updatedAt: nowISO() });
        await this.log(a.id, 'pomodoro', { text: `${minutes} min` });
      }
    }

    await this._put('sessions', {
      uid: this.user?.uid || 'local',
      activityId,
      deliverableId,
      projectId,
      minutes,
      endedAt: nowISO()
    });
  }

  /** Acepta id suelto (actividad) u objeto {type,id} */
  static normalizeTarget(target) {
    if (!target) return null;
    if (typeof target === 'string') return { type: 'activity', id: target };
    return target.id ? { type: target.type || 'activity', id: target.id } : null;
  }

  async comment(activityId, text) {
    if (!text?.trim()) return;
    return this.log(activityId, 'comment', { text: text.trim() });
  }

  /* ---------- Memoria / historial ---------- */
  async log(activityId, type, extra = {}) {
    const entry = {
      activityId, type,
      ts: nowISO(),
      uid: this.user?.uid || 'local',
      userName: this.user?.displayName || 'Tú',
      ...extra
    };
    return this._put('history', entry);
  }

  historyFor(activityId) {
    return this.data.history
      .filter(h => h.activityId === activityId)
      .sort((a, b) => (b.ts || '').localeCompare(a.ts || ''));
  }

  /* ======================================================================
     Sprints
     ====================================================================== */
  async saveSprint(s) {
    return this._put('sprints', { ...s, createdAt: s.createdAt || nowISO() });
  }
  async deleteSprint(id) { return this._del('sprints', id); }

  /* ======================================================================
     Equipo
     ====================================================================== */
  async invite(email, role = 'member') {
    if (this.mode !== 'cloud') throw new Error('Las invitaciones requieren Firebase configurado.');
    const { db, fsMod } = this._fb;
    const key = email.trim().toLowerCase();
    await fsMod.setDoc(
      fsMod.doc(db, 'workspaces', WORKSPACE_ID, 'invites', key),
      { email: key, role, invitedBy: this.user.uid, invitedAt: nowISO() }
    );
  }

  async removeMember(uidToRemove) {
    if (this.mode !== 'cloud') return;
    await this._del('members', uidToRemove);
  }

  member(uidOrId) {
    if (!uidOrId) return null;
    return this.data.members.find(m => m.uid === uidOrId || m.id === uidOrId) || null;
  }

  get me() { return this.member(this.user?.uid); }
  get isOwner() { return this.me?.role === 'owner'; }

  /* ======================================================================
     Selectores
     ====================================================================== */
  portfolio(id)  { return this.data.portfolios.find(p => p.id === id) || null; }
  project(id)    { return this.data.projects.find(p => p.id === id) || null; }
  activity(id)   { return this.data.activities.find(a => a.id === id) || null; }

  projectsOf(portfolioId) {
    return this.data.projects.filter(p => p.portfolioId === portfolioId);
  }

  activitiesOf(projectId) {
    return this.data.activities.filter(a => a.projectId === projectId);
  }

  /* Actividades de un portafolio (a través de sus proyectos) */
  activitiesOfPortfolio(portfolioId) {
    const ids = new Set(this.projectsOf(portfolioId).map(p => p.id));
    return this.data.activities.filter(a => ids.has(a.projectId));
  }

  /* Estadísticas de un conjunto de actividades */
  static stats(acts) {
    const total = acts.length;
    const done = acts.filter(a => a.status === 'done').length;
    const points = acts.reduce((s, a) => s + (Number(a.points) || 0), 0);
    const donePoints = acts.filter(a => a.status === 'done').reduce((s, a) => s + (Number(a.points) || 0), 0);
    const pomos = acts.reduce((s, a) => s + (Number(a.pomosDone) || 0), 0);
    const estPomos = acts.reduce((s, a) => s + (Number(a.pomosEstimated) || 0), 0);
    return {
      total, done, open: total - done,
      pct: total ? Math.round(done / total * 100) : 0,
      points, donePoints,
      pctPoints: points ? Math.round(donePoints / points * 100) : 0,
      pomos, estPomos
    };
  }

  /* ======================================================================
     Datos de ejemplo
     ====================================================================== */
  async seedDemo() {
    const meUid = this.user?.uid || 'local';
    const today = new Date();
    const dayOff = (n) => {
      const d = new Date(today); d.setDate(d.getDate() + n);
      return d.toISOString().slice(0, 10);
    };
    const isoOff = (n) => {
      const d = new Date(today); d.setDate(d.getDate() + n);
      return d.toISOString();
    };

    const p1 = await this.savePortfolio({ name: 'Transformación Digital', desc: 'Iniciativas de modernización tecnológica', color: '#007AFF', icon: 'rocket' });
    const p2 = await this.savePortfolio({ name: 'Operaciones', desc: 'Mantenimiento y mejora continua', color: '#34C759', icon: 'briefcase' });

    const pr1 = await this.saveProject({ portfolioId: p1.id, name: 'Portal de clientes', desc: 'Nuevo portal web de autoservicio', color: '#007AFF', icon: 'code', status: 'active', startDate: dayOff(-14), dueDate: dayOff(30) });
    const pr2 = await this.saveProject({ portfolioId: p1.id, name: 'App móvil', desc: 'Aplicación iOS y Android', color: '#AF52DE', icon: 'sparkles', status: 'active', startDate: dayOff(-7), dueDate: dayOff(60) });
    const pr3 = await this.saveProject({ portfolioId: p2.id, name: 'Mejora de procesos', desc: 'Automatización de tareas repetitivas', color: '#34C759', icon: 'target', status: 'active', startDate: dayOff(-21), dueDate: dayOff(14) });

    const demo = [
      { projectId: pr1.id, name: 'Diseñar la pantalla de inicio',      quadrant: 'Q1', status: 'inprogress', points: 5, pomosEstimated: 4, pomosDone: 2, dueDate: dayOff(2) },
      { projectId: pr1.id, name: 'Implementar autenticación',          quadrant: 'Q1', status: 'todo',       points: 8, pomosEstimated: 6, pomosDone: 0, dueDate: dayOff(5) },
      { projectId: pr1.id, name: 'Definir arquitectura de datos',      quadrant: 'Q2', status: 'done',       points: 5, pomosEstimated: 4, pomosDone: 4, dueDate: dayOff(-3), completedAt: isoOff(-4) },
      { projectId: pr1.id, name: 'Configurar CI/CD',                   quadrant: 'Q2', status: 'done',       points: 3, pomosEstimated: 3, pomosDone: 3, dueDate: dayOff(-1), completedAt: isoOff(-2) },
      { projectId: pr1.id, name: 'Responder correos del cliente',      quadrant: 'Q3', status: 'todo',       points: 1, pomosEstimated: 1, pomosDone: 0, dueDate: dayOff(0) },
      { projectId: pr2.id, name: 'Prototipo de navegación',            quadrant: 'Q2', status: 'review',     points: 5, pomosEstimated: 5, pomosDone: 5, dueDate: dayOff(3) },
      { projectId: pr2.id, name: 'Integrar notificaciones push',       quadrant: 'Q2', status: 'backlog',    points: 8, pomosEstimated: 7, pomosDone: 0, dueDate: dayOff(20) },
      { projectId: pr2.id, name: 'Revisar dependencias obsoletas',     quadrant: 'Q4', status: 'backlog',    points: 2, pomosEstimated: 2, pomosDone: 0, dueDate: '' },
      { projectId: pr3.id, name: 'Automatizar reporte semanal',        quadrant: 'Q2', status: 'inprogress', points: 5, pomosEstimated: 4, pomosDone: 1, dueDate: dayOff(4) },
      { projectId: pr3.id, name: 'Atender incidencia de facturación',  quadrant: 'Q1', status: 'done',       points: 3, pomosEstimated: 2, pomosDone: 2, dueDate: dayOff(-2), completedAt: isoOff(-1) },
      { projectId: pr3.id, name: 'Ordenar carpeta compartida',         quadrant: 'Q4', status: 'backlog',    points: 1, pomosEstimated: 1, pomosDone: 0, dueDate: '' },
      { projectId: pr3.id, name: 'Actualizar manual de usuario',       quadrant: 'Q3', status: 'todo',       points: 2, pomosEstimated: 2, pomosDone: 0, dueDate: dayOff(7) }
    ];

    for (const a of demo) {
      await this.saveActivity({ ...a, assigneeUid: meUid, notes: '', createdAt: isoOff(-10) });
    }

    await this.saveSprint({ name: 'Sprint actual', start: dayOff(-7), end: dayOff(7) });
  }

  async clearAll() {
    if (this.mode === 'local') {
      this.data = { members: this.data.members, portfolios: [], projects: [], activities: [], history: [], sessions: [], sprints: [] };
      this._persistLocal();
      return;
    }
    for (const coll of ['activities', 'projects', 'portfolios', 'history', 'sessions', 'sprints']) {
      for (const item of [...this.data[coll]]) await this._del(coll, item.id);
    }
  }
}

export const store = new Store();
export const Stats = Store.stats;
