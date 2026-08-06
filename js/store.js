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

const clone = (o) => JSON.parse(JSON.stringify(o));

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
    this.authError = null;   // último fallo de acceso, para mostrarlo en pantalla

    this.data = {
      members:    [],
      portfolios: [],
      projects:   [],
      activities: [],
      history:    [],
      sessions:   [],
      sprints:    []
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

    /* Si volvemos de un signInWithRedirect, aquí aparece el error.
       Sin esto, un fallo en la redirección es invisible: el usuario
       vuelve a la pantalla de acceso sin explicación. */
    const veniaDeRedirect = sessionStorage.getItem('pomomomo.redirecting') === '1';
    sessionStorage.removeItem('pomomomo.redirecting');
    try {
      await authMod.getRedirectResult(auth);
    } catch (e) {
      this.authError = {
        code: e?.code || 'desconocido',
        message: Store.authMessage(e?.code) || e?.message || 'Falló el acceso por redirección.'
      };
      console.error('[PomoMomo] Redirect:', e);
    }
    if (veniaDeRedirect && !auth.currentUser && !this.authError) {
      this.authError = {
        code: 'auth/redirect-sin-sesion',
        message: 'La redirección volvió sin sesión. Suele pasar cuando el navegador bloquea cookies de terceros: prueba con la ventana emergente o desactiva el bloqueo para este sitio.'
      };
    }

    authMod.onAuthStateChanged(auth, async (u) => {
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
    const { doc, getDoc, setDoc, serverTimestamp, collection, getDocs, limit, query, deleteDoc } = fsMod;
    const wsRef = doc(db, 'workspaces', WORKSPACE_ID);
    const meRef = doc(db, 'workspaces', WORKSPACE_ID, 'members', this.user.uid);

    try {
      const me = await getDoc(meRef);
      if (me.exists()) return true;

      // ¿Hay invitación para este correo?
      const invRef = doc(db, 'workspaces', WORKSPACE_ID, 'invites', (this.user.email || '').toLowerCase());
      const inv = await getDoc(invRef);

      // ¿El espacio está vacío? El primero en entrar se vuelve owner.
      let isFirst = false;
      if (!inv.exists()) {
        try {
          const snap = await getDocs(query(collection(db, 'workspaces', WORKSPACE_ID, 'members'), limit(1)));
          isFirst = snap.empty;
        } catch { isFirst = false; }
      }

      if (!inv.exists() && !isFirst) return false;

      await setDoc(meRef, {
        uid: this.user.uid,
        displayName: this.user.displayName || '',
        email: (this.user.email || '').toLowerCase(),
        photoURL: this.user.photoURL || '',
        role: isFirst ? 'owner' : (inv.data()?.role || 'member'),
        joinedAt: serverTimestamp()
      });

      if (isFirst) {
        try { await setDoc(wsRef, { name: 'Espacio principal', ownerUid: this.user.uid, createdAt: serverTimestamp() }, { merge: true }); }
        catch { /* opcional */ }
      }
      if (inv.exists()) { try { await deleteDoc(invRef); } catch { /* opcional */ } }
      return true;
    } catch (e) {
      console.error('[PomoMomo] membresía:', e);
      return false;
    }
  }

  _resetData() {
    this.data = { members: [], portfolios: [], projects: [], activities: [], history: [], sessions: [], sprints: [] };
    this.emit('data', this.data);
  }

  _attachListeners() {
    const { db, fsMod } = this._fb;
    const { collection, onSnapshot, query, orderBy, limit } = fsMod;
    const colls = ['members', 'portfolios', 'projects', 'activities', 'sprints'];

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
        (err) => { console.error(`[${name}]`, err); if (pending > 0) settle(); }
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
      (err) => { console.error('[history]', err); if (pending > 0) settle(); }
    );
    this._unsubs.push(unH);

    // Sesiones de pomodoro (últimas 400)
    const sRef = query(
      collection(db, 'workspaces', WORKSPACE_ID, 'sessions'),
      orderBy('endedAt', 'desc'), limit(400)
    );
    this._unsubs.push(onSnapshot(sRef,
      (snap) => { this.data.sessions = snap.docs.map(d => ({ id: d.id, ...d.data() })); this.emit('data', this.data); },
      (err) => console.error('[sessions]', err)
    ));
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
      await setDoc(doc(db, 'workspaces', WORKSPACE_ID, coll, id), payload, { merge: true });
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
      await fsMod.deleteDoc(fsMod.doc(db, 'workspaces', WORKSPACE_ID, coll, id));
    } else {
      this.data[coll] = this.data[coll].filter(x => x.id !== id);
      this._persistLocal();
    }
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

    const rec = await this._put('activities', {
      ...a,
      pomosDone:   a.pomosDone ?? prev?.pomosDone ?? 0,
      createdAt:   a.createdAt || prev?.createdAt || nowISO(),
      createdBy:   a.createdBy || prev?.createdBy || this.user?.uid || '',
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

  async addPomodoro(activityId, minutes) {
    const a = this.data.activities.find(x => x.id === activityId);
    if (a) {
      await this._put('activities', { ...a, pomosDone: (a.pomosDone || 0) + 1, updatedAt: nowISO() });
      await this.log(activityId, 'pomodoro', { text: `${minutes} min` });
    }
    await this._put('sessions', {
      uid: this.user?.uid || 'local',
      activityId: activityId || '',
      projectId: a?.projectId || '',
      minutes,
      endedAt: nowISO()
    });
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
