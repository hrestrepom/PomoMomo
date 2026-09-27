/* ==========================================================================
   PomoMomo — Aplicación
   ========================================================================== */

import { store, Store, Stats, nowISO } from './store.js';
import {
  FRAMEWORKS, LEVELS, PRACTICES, diagnose, practiceById, practicesByLevel, scoreLabel
} from './practices.js';
import { parse as parseQuick, describeRecur, nextOccurrence, withAnchor, RECUR_OPTIONS } from './quickadd.js';
import * as Chart from './charts.js';
import {
  QUADRANTS, STATUSES, STATUS_ORDER, PALETTE, TILE_ICONS,
  IS_CONFIGURED, DEFAULT_TIMER, APP_VERSION, APP_BUILD
} from './config.js';
import {
  icon, esc, $, $$, toast, openSheet, closeSheet, confirmSheet, promptSheet, openMenu,
  fmtDate, fmtDue, dueTone, fmtAgo, fmtTime, mmss, fmtDuration, todayISO,
  dayKey, addDays, daysBetween, durationDays, fmtDays, workWindow,
  avatar, ring, empty, makeDraggable, makeDropZone,
  chime, colorFor, initials
} from './ui.js';

/* ==========================================================================
   Estado de la aplicación
   ========================================================================== */
const app = {
  route: { name: 'today', params: {} },
  filters: { q: '', projectId: '', portfolioId: '', assignee: '', quadrant: '', status: '' },
  actView: 'list',            // list | matrix | kanban
  metricScope: 'all',         // all | portfolioId | projectId
  sprintId: '',
  mounted: false
};

/* Temporizador (persistente entre navegaciones y recargas) */
const TKEY = 'pomomomo.timer';
let timer = {
  mode: 'focus',
  running: false,
  remaining: DEFAULT_TIMER.focus * 60,
  endsAt: null,
  cycle: 0,
  target: null          // { type: 'activity' | 'deliverable', id }
};
let tickHandle = null;

/* ---------- Objetivo del foco: actividad o entregable ---------- */
function setFocusTarget(type, id) {
  timer.target = id ? { type, id } : null;
  saveTimer();
}

/** Resuelve el objetivo actual a un objeto uniforme, o null si ya no existe. */
function focusTarget() {
  const t = timer.target;
  if (!t?.id) return null;
  if (t.type === 'deliverable') {
    const d = store.deliverable(t.id);
    return d ? { type: 'deliverable', id: d.id, name: d.name, obj: d,
                 projectId: d.projectId, done: !!d.achieved } : null;
  }
  const a = store.activity(t.id);
  return a ? { type: 'activity', id: a.id, name: a.name, obj: a,
               projectId: a.projectId, done: a.status === 'done' } : null;
}

function loadTimer() {
  try {
    const raw = localStorage.getItem(TKEY);
    if (!raw) return;
    const t = JSON.parse(raw);
    timer = { ...timer, ...t };

    // Migración del formato anterior, que solo guardaba actividades
    if (!timer.target && t.activityId) timer.target = { type: 'activity', id: t.activityId };
    delete timer.activityId;

    if (timer.running && timer.endsAt) {
      const left = Math.round((timer.endsAt - Date.now()) / 1000);
      if (left <= 0) {
        /* El tiempo se cumplió mientras la app estaba cerrada. No se puede
           registrar aquí porque el store todavía no está listo: se deja
           pendiente y lo procesa boot(). Antes se descartaba en silencio y
           el pomodoro no aparecía nunca en las métricas. */
        timer.running = false;
        timer.endsAt = null;
        timer.pending = { mode: timer.mode, target: timer.target, at: Date.now() };
        timer.remaining = modeSecs(timer.mode);
      } else {
        timer.remaining = left;
      }
    }
  } catch { /* ignora */ }
}

/** Registra un pomodoro que se completó con la app cerrada. */
async function resolvePendingPomodoro() {
  const p = timer.pending;
  if (!p) return;
  timer.pending = null;
  saveTimer();

  if (p.mode !== 'focus') return;           // los descansos no se registran

  const minutes = store.prefs.focus ?? DEFAULT_TIMER.focus;
  const objetivo = p.target || (p.activityId ? { type: 'activity', id: p.activityId } : null);
  // El contador solo avanza si el registro llegó a guardarse
  const ok = await guardar(() => store.addPomodoro(objetivo, minutes));
  if (!ok) return;
  timer.cycle += 1;
  saveTimer();

  const t = objetivo ? focusTarget() : null;
  toast(`Pomodoro recuperado${t ? ' · ' + t.name : ''}`, 'ok', 3200);
  if (t) pomodoroDoneSheet(objetivo, minutes, { recuperado: true });
}
function saveTimer() {
  try { localStorage.setItem(TKEY, JSON.stringify(timer)); } catch { /* ignora */ }
}
const modeSecs = (m) => (store.prefs[m] ?? DEFAULT_TIMER[m]) * 60;
const MODE_NAME = { focus: 'Enfoque', short: 'Pausa corta', long: 'Pausa larga' };
const MODE_COLOR = { focus: 'var(--red)', short: 'var(--green)', long: 'var(--teal)' };

/* Duraciones de un toque. No todas las tareas piden 25 minutos: hay
   revisiones de 5 y bloques profundos de 40. */
const DURACIONES = {
  focus: [5, 10, 15, 25, 40],
  short: [3, 5, 10],
  long:  [15, 20, 30]
};

/* ==========================================================================
   Navegación
   ========================================================================== */
const NAV = [
  { group: 'Principal', items: [
    { id: 'today',      label: 'Hoy',         icon: 'today' },
    { id: 'focus',      label: 'Foco',        icon: 'timer' }
  ]},
  { group: 'Trabajo', items: [
    { id: 'portfolios', label: 'Portafolios', icon: 'layers' },
    { id: 'projects',   label: 'Proyectos',   icon: 'briefcase' },
    { id: 'activities', label: 'Actividades', icon: 'checklist' }
  ]},
  { group: 'Análisis', items: [
    { id: 'metrics',    label: 'Métricas',    icon: 'chart' },
    { id: 'practices',  label: 'Prácticas',   icon: 'book' }
  ]},
  { group: 'Espacio', items: [
    { id: 'team',       label: 'Equipo',      icon: 'people' },
    { id: 'settings',   label: 'Ajustes',     icon: 'gear' }
  ]}
];

const TABS = [
  { id: 'today',      label: 'Hoy',      icon: 'today' },
  { id: 'activities', label: 'Tareas',   icon: 'checklist' },
  { id: 'focus',      label: 'Foco',     icon: 'timer' },
  { id: 'metrics',    label: 'Métricas', icon: 'chart' },
  { id: '__more',     label: 'Más',      icon: 'more' }
];

function parseHash() {
  const h = (location.hash || '#/today').replace(/^#\/?/, '');
  const [name, id] = h.split('/');
  return { name: name || 'today', params: { id: id || '' } };
}

function go(path) { location.hash = '#/' + path.replace(/^\//, ''); }

/* ==========================================================================
   Arranque
   ========================================================================== */
async function boot() {
  loadTimer();
  store.on('ready', renderAll);
  store.on('auth', renderAll);
  store.on('data', () => { if (app.mounted) renderView(); renderChrome(); });
  window.addEventListener('hashchange', () => { app.route = parseHash(); renderAll(); });
  window.addEventListener('resize', debounce(() => { if (app.route.name === 'metrics') renderView(); }, 220));

  app.route = parseHash();
  renderAll();
  await store.init();
  startTicker();
  await resolvePendingPomodoro();
}

function debounce(fn, ms) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

/**
 * Ejecuta una operación de guardado mostrando el error si falla.
 * Sin esto, un rechazo de Firestore deja el botón aparentemente muerto:
 * la promesa se rechaza, la hoja no se cierra y no aparece ningún aviso.
 * @returns {boolean} true si salió bien
 */
async function guardar(fn, { onError } = {}) {
  try {
    await fn();
    return true;
  } catch (e) {
    const msg = e?.friendly || e?.message || 'No se pudo guardar el cambio.';
    toast(msg, 'err', 6000);
    onError?.(e);
    return false;
  }
}

/* Red de seguridad: cualquier fallo de escritura que no se haya capturado
   explícitamente termina aquí en vez de morir en silencio en la consola. */
window.addEventListener('unhandledrejection', (ev) => {
  const e = ev.reason;
  if (e?.friendly) {
    toast(e.friendly, 'err', 6000);
    ev.preventDefault();
  }
});

/* ==========================================================================
   Render principal
   ========================================================================== */
function renderAll() {
  const root = $('#app');

  if (!store.ready) { root.innerHTML = shellSkeleton(); return; }

  if (store.mode === 'cloud' && store.authState === 'signed-out') { root.innerHTML = signInView(); bindSignIn(); return; }
  if (store.mode === 'cloud' && store.authState === 'no-access')  { root.innerHTML = noAccessView(); bindSignIn(); return; }

  if (!app.mounted || !$('#content')) {
    root.innerHTML = shell();
    app.mounted = true;
    bindChrome();
  }
  renderChrome();
  renderView();
}

function shellSkeleton() {
  return `<div class="signin"><div class="col center g-16">
    <div class="signin-mark">🍅</div>
    <div class="skel" style="width:160px;height:14px"></div>
  </div></div>`;
}

function shell() {
  return `
  <aside class="sidebar">
    <div class="brand">
      <div class="brand-mark">🍅</div>
      <div class="brand-name">PomoMomo</div>
    </div>
    <nav class="nav" id="nav"></nav>
    <div class="sidebar-foot" id="sidebarFoot"></div>
  </aside>

  <main class="main">
    <header class="toolbar" id="toolbar"></header>
    <div class="content" id="content"></div>
  </main>

  <nav class="tabbar" id="tabbar"></nav>`;
}

/* ---------- Barra lateral, toolbar y tabs ---------- */
function renderChrome() {
  const nav = $('#nav');
  if (!nav) return;

  const overdue = store.data.activities.filter(a =>
    a.status !== 'done' && a.dueDate && a.dueDate <= todayISO()).length;

  nav.innerHTML = NAV.map(g => `
    <div class="nav-group">
      <div class="section-label">${g.group}</div>
      ${g.items.map(it => `
        <button class="nav-item ${app.route.name === it.id ? 'active' : ''}" data-go="${it.id}">
          ${icon(it.icon, 17)}
          <span class="grow truncate">${it.label}</span>
          ${it.id === 'today' && overdue ? `<span class="count">${overdue}</span>` : ''}
        </button>`).join('')}
    </div>`).join('');

  const me = store.me;
  $('#sidebarFoot').innerHTML = `
    <button class="user-chip" id="userChip">
      ${avatar(me || { displayName: store.user?.displayName }, 'md')}
      <span class="col grow" style="align-items:flex-start;line-height:1.25;min-width:0">
        <span class="truncate" style="font-size:13px;font-weight:560;max-width:130px">${esc(store.user?.displayName || 'Tú')}</span>
        <span class="truncate" style="font-size:11px;color:var(--label-3);max-width:130px">
          ${store.mode === 'cloud' ? esc(store.user?.email || '') : 'Modo local'}
        </span>
      </span>
      ${icon('more', 15)}
    </button>`;
  $('#userChip').onclick = (e) => userMenu(e.currentTarget);

  $('#tabbar').innerHTML = TABS.map(t => `
    <button class="tab ${app.route.name === t.id ? 'active' : ''}" data-tab="${t.id}">
      ${icon(t.icon, 21)}<span>${t.label}</span>
    </button>`).join('');
}

function bindChrome() {
  $('#app').addEventListener('click', (e) => {
    const g = e.target.closest('[data-go]');
    if (g) { go(g.dataset.go); return; }
    const tb = e.target.closest('[data-tab]');
    if (tb) {
      if (tb.dataset.tab === '__more') moreSheet();
      else go(tb.dataset.tab);
    }
  });

  $('#content').addEventListener('scroll', () => {});
  window.addEventListener('scroll', () => {
    const tb = $('#toolbar');
    if (tb) tb.classList.toggle('scrolled', window.scrollY > 4);
  }, { passive: true });
}

function userMenu(anchor) {
  const items = [
    { label: 'Ajustes', icon: 'gear', onClick: () => go('settings') },
    { label: 'Equipo', icon: 'people', onClick: () => go('team') },
    '-'
  ];
  if (store.mode === 'cloud') {
    items.push({ label: 'Cerrar sesión', icon: 'logout', danger: true, onClick: () => store.signOut() });
  } else {
    items.push({ label: 'Conectar Firebase', icon: 'cloud', onClick: () => go('settings') });
  }
  openMenu(anchor, items);
}

function moreSheet() {
  const links = [
    { id: 'portfolios', label: 'Portafolios', icon: 'layers' },
    { id: 'projects',   label: 'Proyectos',   icon: 'briefcase' },
    { id: 'practices',  label: 'Prácticas',   icon: 'book' },
    { id: 'team',       label: 'Equipo',      icon: 'people' },
    { id: 'settings',   label: 'Ajustes',     icon: 'gear' }
  ];
  openSheet({
    title: 'Más',
    body: `<div class="list">${links.map(l => `
      <button class="list-row" data-more="${l.id}">
        ${icon(l.icon, 19)}<span class="grow">${l.label}</span>${icon('chevR', 15, 'chev')}
      </button>`).join('')}</div>`,
    onMount(el) {
      $$('[data-more]', el).forEach(b => b.onclick = () => { closeSheet(); go(b.dataset.more); });
    }
  });
}

/* ==========================================================================
   Enrutador de vistas
   ========================================================================== */
function renderView() {
  const c = $('#content');
  if (!c) return;
  const { name, params } = app.route;

  const views = {
    today:      viewToday,
    focus:      viewFocus,
    portfolios: viewPortfolios,
    portfolio:  viewPortfolioDetail,
    projects:   viewProjects,
    project:    viewProjectDetail,
    activities: viewActivities,
    metrics:    viewMetrics,
    practices:  viewPractices,
    team:       viewTeam,
    settings:   viewSettings
  };

  const fn = views[name] || viewToday;
  const out = fn(params);

  $('#toolbar').innerHTML = out.toolbar || '';
  c.className = 'content' + (out.wide ? ' wide' : '');
  c.innerHTML = `<div class="view-enter">${out.body}</div>`;

  /* Comportamiento por defecto de "Nueva actividad" (toolbar y cuerpo).
     Se asigna ANTES de mount() para que las vistas puedan sobrescribirlo
     con un proyecto preseleccionado. */
  $$('[data-new-activity]').forEach(b => b.onclick = () => activityEditor());

  out.mount?.(c);
  window.scrollTo({ top: 0 });
}

/* ---------- Toolbar helper ---------- */
function toolbar(title, actionsHtml = '', backTo = null) {
  return `
    ${backTo ? `<button class="icon-btn" data-go="${backTo}" aria-label="Atrás">${icon('chevL', 19)}</button>` : ''}
    <div class="toolbar-title truncate">${esc(title)}</div>
    <div class="toolbar-actions">${actionsHtml}</div>`;
}

const btnNew = (label = 'Nueva actividad') =>
  `<button class="btn btn-primary" data-new-activity>${icon('plus', 15)}<span class="hide-sm">${esc(label)}</span></button>`;

/* ==========================================================================
   Vista: Hoy
   ========================================================================== */
function viewToday() {
  const acts = store.data.activities;
  const today = todayISO();
  const open = acts.filter(a => a.status !== 'done');

  const overdue = open.filter(a => a.dueDate && a.dueDate < today)
    .sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''));
  const dueToday = open.filter(a => a.dueDate === today);
  const inProgress = open.filter(a => a.status === 'inprogress' && !overdue.includes(a) && !dueToday.includes(a));
  const mine = open.filter(a => a.assigneeUid === store.user?.uid);

  const doneToday = acts.filter(a => a.status === 'done' && a.completedAt && dayKey(a.completedAt) === today);
  const pomosToday = store.data.sessions.filter(s => dayKey(s.endedAt) === today);
  const minsToday = pomosToday.reduce((s, x) => s + (x.minutes || 0), 0);

  const foco = focusTarget();
  const delsHoy = store.actionableDeliverables(today);

  /* Aviso anticipado: lo que vence dentro de los próximos N días, para
     no enterarse el mismo día del vencimiento. */
  const avisoDias = store.prefs.remindDays ?? 3;
  const limiteAviso = addDays(today, avisoDias);
  const proximas = open
    .filter(a => a.dueDate && a.dueDate > today && a.dueDate <= limiteAviso)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  /* Próximas repeticiones de las series, calculadas sin crearlas */
  const repeticiones = open
    .filter(a => a.recur && a.dueDate)
    .flatMap(a => Store.occurrencesBetween(a, addDays(today, 1), limiteAviso, nextOccurrence)
      .map(f => ({ a, f })))
    .sort((x, y) => x.f.localeCompare(y.f))
    .slice(0, 8);

  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Buenos días' : hour < 19 ? 'Buenas tardes' : 'Buenas noches';
  const firstName = (store.user?.displayName || '').split(' ')[0] || '';

  const section = (title, list, iconName, tone = '') => {
    if (!list.length) return '';
    return `<section class="mt-24">
      <div class="row between mb-8" style="padding:0 4px">
        <div class="row g-8">
          ${icon(iconName, 16, tone)}
          <span class="t-head">${title}</span>
          <span class="badge badge-gray">${list.length}</span>
        </div>
      </div>
      <div class="list">${list.map(actRow).join('')}</div>
    </section>`;
  };

  const body = `
    <div class="page-head">
      <h1>${greet}${firstName ? ', ' + esc(firstName) : ''}</h1>
      <p>${new Date().toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
    </div>

    ${bannerIfLocal()}

    ${quickAddHtml()}

    <div class="grid grid-stats">
      <div class="stat">
        <span class="stat-label">Pendientes</span>
        <span class="stat-value">${open.length}</span>
        <span class="stat-sub">${mine.length} asignadas a ti</span>
      </div>
      <div class="stat">
        <span class="stat-label">Vencen hoy</span>
        <span class="stat-value" style="color:${dueToday.length ? 'var(--orange)' : 'inherit'}">${dueToday.length}</span>
        <span class="stat-sub">${overdue.length} vencidas</span>
      </div>
      <div class="stat">
        <span class="stat-label">Completadas hoy</span>
        <span class="stat-value" style="color:var(--green)">${doneToday.length}</span>
        <span class="stat-sub">${doneToday.reduce((s, a) => s + (+a.points || 0), 0)} puntos</span>
      </div>
      <div class="stat">
        <span class="stat-label">Tiempo enfocado</span>
        <span class="stat-value">${fmtDuration(minsToday)}</span>
        <span class="stat-sub">${pomosToday.length} pomodoro${pomosToday.length === 1 ? '' : 's'}</span>
      </div>
    </div>

    <div class="card mt-24">
      <div class="row between g-12">
        <div class="row g-12 grow" style="min-width:0">
          ${ring(1 - timer.remaining / Math.max(1, modeSecs(timer.mode)), 46, 4, MODE_COLOR[timer.mode])}
          <div class="col grow" style="min-width:0">
            <div class="row g-8">
              <span class="t-title-3 tnum" id="todayClock">${mmss(timer.remaining)}</span>
              <span class="badge badge-gray">${MODE_NAME[timer.mode]}</span>
            </div>
            <span class="t-foot truncate">${foco ? esc(foco.name) : 'Sin selección'}</span>
          </div>
        </div>
        <div class="row g-8">
          <button class="btn ${timer.running ? 'btn-gray' : 'btn-primary'}" data-timer-toggle>
            ${icon(timer.running ? 'pause' : 'play', 15)}<span>${timer.running ? 'Pausar' : 'Iniciar'}</span>
          </button>
          <button class="icon-btn" data-go="focus" aria-label="Abrir foco">${icon('chevR', 18)}</button>
        </div>
      </div>
    </div>

    ${section('Vencidas', overdue, 'warning', 'danger')}
    ${section('Para hoy', dueToday, 'today')}
    ${section('En progreso', inProgress, 'bolt')}

    ${proximas.length || repeticiones.length ? `
      <section class="mt-24">
        <div class="row between mb-8" style="padding:0 4px">
          <div class="row g-8">
            ${icon('bell', 16)}
            <span class="t-head">Se vienen</span>
            <span class="badge badge-gray">${proximas.length + repeticiones.length}</span>
          </div>
          <button class="btn btn-sm btn-gray" data-remind-cfg>Avisar ${avisoDias} d antes</button>
        </div>
        <div class="list">
          ${proximas.map(a => actRow(a)).join('')}
          ${repeticiones.map(({ a, f }) => `
            <div class="act-row">
              <span class="act-check" style="pointer-events:none;border-style:dashed">${icon('reset', 12)}</span>
              <button class="col grow" style="align-items:flex-start;min-width:0;gap:2px" data-open-act="${a.id}">
                <span class="truncate w-full" style="font-size:14.5px;font-weight:500;text-align:left;color:var(--label-2)">${esc(a.name)}</span>
                <span class="row g-6 wrap" style="font-size:11.5px;color:var(--label-3)">
                  <span class="badge badge-blue">${fmtDue(f)}</span>
                  <span>${esc(describeRecur(a.recur))}</span>
                </span>
              </button>
              <span class="t-cap">próxima</span>
            </div>`).join('')}
        </div>
      </section>` : ''}

    ${delsHoy.length ? `
      <section class="mt-24">
        <div class="row between mb-8" style="padding:0 4px">
          <div class="row g-8">
            ${icon('flag', 16)}
            <span class="t-head">Entregables en juego</span>
            <span class="badge badge-gray">${delsHoy.length}</span>
          </div>
          <span class="t-cap">Los pasos con que cierras tus actividades</span>
        </div>
        <div class="list">${delsHoy.map(x => delivTodayRow(x)).join('')}</div>
      </section>` : ''}

    ${!overdue.length && !dueToday.length && !inProgress.length && !delsHoy.length && !proximas.length ? `
      <div class="card mt-24">
        ${empty('check', 'Todo en orden', 'No tienes actividades vencidas ni programadas para hoy.',
          `<button class="btn btn-tinted mt-8" data-new-activity>${icon('plus', 15)} Nueva actividad</button>`)}
      </div>` : ''}
  `;

  return {
    toolbar: toolbar('Hoy', btnNew()),
    body,
    mount(root) {
      bindQuickAdd(root);
      bindActivityRows(root);
      $$('[data-timer-toggle]', root).forEach(b => b.onclick = () => { toggleTimer(); renderView(); });
      $('[data-remind-cfg]', root)?.addEventListener('click', async () => {
        const v = await promptSheet({
          title: 'Aviso anticipado',
          label: '¿Cuántos días antes quieres ver lo que se vence?',
          value: String(avisoDias), confirmText: 'Aplicar'
        });
        if (v === null) return;
        const n = clampInt(v, 0, 30, -1);
        if (n < 0) return toast('Escribe un número entre 0 y 30', 'err');
        store.savePrefs({ remindDays: n });
        renderView();
        toast(n ? `Avisando ${n} días antes` : 'Aviso anticipado desactivado', 'ok');
      });
    }
  };
}

/* ---------- Fila de entregable en la vista de Hoy ---------- */
function delivTodayRow({ d, motivo, acts }) {
  const pr = store.project(d.projectId);
  const MOTIVO = {
    'vencido':         { txt: 'Vencido', cls: 'badge-red' },
    'hoy':             { txt: 'Para hoy', cls: 'badge-orange' },
    'en-curso':        { txt: 'En curso', cls: 'badge-blue' },
    'actividad-vence': { txt: 'La actividad vence', cls: 'badge-orange' }
  }[motivo] || { txt: '', cls: 'badge-gray' };

  return `<div class="act-row" data-deliv-row="${d.id}">
    <button class="act-check" data-achieve="${d.id}" aria-label="Marcar como logrado">${icon('check', 13)}</button>

    <button class="col grow" style="align-items:flex-start;min-width:0;gap:2px" data-open-deliv="${d.id}">
      <span class="truncate w-full" style="font-size:14.5px;font-weight:500;text-align:left">${esc(d.name)}</span>
      <span class="row g-6 wrap" style="font-size:11.5px;color:var(--label-3)">
        ${pr ? `<span class="row g-4"><i class="dot" style="background:${pr.color || 'var(--gray)'}"></i>${esc(pr.name)}</span>` : ''}
        <span class="badge ${MOTIVO.cls}">${MOTIVO.txt}</span>
        ${d.pomosDone ? `<span>🍅 ${d.pomosDone}</span>` : ''}
        ${acts.length ? `<span>${acts.length} actividad${acts.length === 1 ? '' : 'es'}</span>` : ''}
      </span>
    </button>

    <button class="icon-btn accent" data-focus-deliv="${d.id}" title="Enfocar este entregable">${icon('timer', 16)}</button>
  </div>`;
}

/* ---------- Captura rápida ---------- */
function quickAddHtml() {
  return `
    <div class="card mt-16" style="padding:12px 14px">
      <div class="row g-10">
        <span style="color:var(--label-3);flex:0 0 auto">${icon('plus', 19)}</span>
        <input class="grow" id="qa-input" autocomplete="off"
          placeholder="Anota lo que sea y pulsa Enter…"
          style="border:none;background:none;font-size:15px;min-width:0">
        <button class="btn btn-sm btn-primary hidden" id="qa-save">Agregar</button>
        <button class="icon-btn" id="qa-help" aria-label="Ayuda">${icon('info', 17)}</button>
      </div>
      <div id="qa-preview" class="row g-6 wrap hidden" style="margin-top:8px;padding-left:29px"></div>
    </div>`;
}

function bindQuickAdd(root) {
  const input = $('#qa-input', root);
  const preview = $('#qa-preview', root);
  const saveBtn = $('#qa-save', root);
  if (!input) return;

  const TONO = {
    fecha:       'badge-blue',
    duracion:    'badge-purple',
    proyecto:    'badge-purple',
    prioridad:   'badge-red',
    recurrencia: 'badge-green',
    aviso:       'badge-orange'
  };

  const helpBtn = $('#qa-help', root);

  const refresh = () => {
    const txt = input.value.trim();
    if (!txt) {
      preview.classList.add('hidden');
      saveBtn.classList.add('hidden');
      helpBtn.classList.remove('hidden');
      return;
    }
    const r = parseQuick(txt, store.data.projects);
    saveBtn.classList.remove('hidden');
    // La ayuda solo estorba mientras se escribe, y en móvil el espacio es escaso
    helpBtn.classList.add('hidden');
    if (!r.tokens.length) { preview.classList.add('hidden'); return; }
    preview.classList.remove('hidden');
    preview.innerHTML = r.tokens.map(t => `
      <span class="badge ${TONO[t.tipo] || 'badge-gray'}">
        ${t.tipo === 'fecha' ? icon('calendar', 11)
        : t.tipo === 'duracion' ? icon('clock', 11)
        : t.tipo === 'proyecto' ? icon('briefcase', 11)
        : t.tipo === 'recurrencia' ? icon('reset', 11)
        : t.tipo === 'prioridad' ? icon('fire', 11)
        : icon('warning', 11)}
        ${esc(t.texto)}
      </span>`).join('');
  };

  const submit = async () => {
    const txt = input.value.trim();
    if (!txt) return;
    const r = parseQuick(txt, store.data.projects);
    if (!r.name) { toast('Escribe al menos un nombre', 'err'); return; }

    input.value = '';
    preview.classList.add('hidden');
    saveBtn.classList.add('hidden');
    helpBtn.classList.remove('hidden');

    await store.saveActivity({
      name: r.name,
      projectId: r.projectId,
      startDate: r.startDate || '',
      deliverableIds: [],
      assigneeUid: store.user?.uid || '',
      quadrant: r.quadrant,
      status: 'todo',
      points: 0,
      pomosEstimated: 0,
      dueDate: r.dueDate,
      notes: '',
      recur: r.recur,
      completedAt: null
    });

    const detalles = [
      r.dueDate ? fmtDue(r.dueDate) : null,
      r.durationDays > 1 ? fmtDays(r.durationDays) : null,
      r.projectName || null,
      r.recur ? describeRecur(r.recur) : null
    ].filter(Boolean);
    toast(detalles.length ? `Agregada · ${detalles.join(' · ')}` : 'Agregada', 'ok', 2200);
    input.focus();
  };

  input.addEventListener('input', refresh);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); submit(); }
    if (e.key === 'Escape') { input.value = ''; refresh(); input.blur(); }
  });
  saveBtn.onclick = submit;

  helpBtn.onclick = () => openSheet({
    title: 'Atajos de la captura rápida',
    body: `
      <p class="t-sub mb-16">Escribe normal y agrega estas pistas donde quieras: se detectan
      solas y no quedan en el nombre.</p>
      <div class="list">
        ${[
          ['Fechas',      'hoy · mañana · pasado mañana · el viernes · en 3 días · 15 de marzo · 12/3'],
          ['Duración',    'por 3 días · durante 2 semanas — la fecha detectada pasa a ser el inicio'],
          ['Proyecto',    '#familia · #negocio — busca por el inicio del nombre'],
          ['Urgente',     '! al final lo marca como Q1 (urgente e importante)'],
          ['Se repite',   'cada día · cada semana · cada mes · cada año · cada martes']
        ].map(([k, v]) => `<div class="list-row">
          <span class="col grow" style="align-items:flex-start;gap:2px">
            <span class="t-head">${k}</span>
            <span class="t-foot">${esc(v)}</span>
          </span></div>`).join('')}
      </div>
      <div class="section-label mt-16">Ejemplos</div>
      <div class="tl-note" style="margin-top:0">Sacar la basura cada martes
Pagar arriendo cada mes
Llamar al dentista mañana !
Revisar propuesta #negocio el viernes</div>`,
    footer: `<button class="btn btn-primary" data-x="c">Entendido</button>`,
    onMount(el) { $('[data-x="c"]', el).onclick = () => closeSheet(); }
  });
}

function bannerIfLocal() {
  if (store.mode === 'cloud') return '';
  return `<div class="banner banner-warn mt-16">
    ${icon('cloudOff', 17)}
    <span class="grow">Modo local: los datos viven solo en este dispositivo. Configura Firebase para sincronizar.</span>
    <button class="btn btn-sm btn-gray" data-go="settings">Configurar</button>
  </div>`;
}

/* ---------- Fila de actividad reutilizable ---------- */
function actRow(a) {
  const pr = store.project(a.projectId);
  const q = QUADRANTS[a.quadrant] || QUADRANTS.Q2;
  const m = store.member(a.assigneeUid);
  const tone = dueTone(a.dueDate, a.status);
  const isDone = a.status === 'done';

  return `<div class="act-row ${isDone ? 'is-done' : ''}" data-act="${a.id}">
    <button class="act-check ${isDone ? 'done' : ''}" data-toggle-done="${a.id}" aria-label="Completar">
      ${icon('check', 13)}
    </button>
    <button class="col grow" style="align-items:flex-start;min-width:0;gap:2px" data-open-act="${a.id}">
      <span class="act-title truncate w-full" style="font-size:14.5px;font-weight:500;text-align:left">${esc(a.name)}</span>
      <span class="row g-6 wrap" style="font-size:11.5px;color:var(--label-3)">
        ${pr ? `<span class="row g-4"><i class="dot" style="background:${pr.color || 'var(--gray)'}"></i>${esc(pr.name)}</span>` : ''}
        ${a.dueDate ? `<span class="badge badge-${tone === 'red' ? 'red' : tone === 'orange' ? 'orange' : 'gray'}">${fmtDue(a.dueDate)}</span>` : ''}
        ${(() => { const n = durationDays(a.startDate, a.dueDate);
          return n > 1 ? `<span class="row g-3" title="Del ${fmtDate(a.startDate)} al ${fmtDate(a.dueDate)}">${icon('clock', 11)}${fmtDays(n)}</span>` : ''; })()}
        ${a.recur ? `<span class="row g-3" title="${esc(describeRecur(a.recur))}">${icon('reset', 11)}${esc(describeRecur(a.recur))}</span>` : ''}
        ${a.pomosEstimated ? `<span>🍅 ${a.pomosDone || 0}/${a.pomosEstimated}</span>` : ''}
      </span>
    </button>
    <span class="badge badge-${a.quadrant.toLowerCase()}">${q.key}</span>
    ${avatar(m, 'sm')}
    <button class="icon-btn" data-act-menu="${a.id}" aria-label="Opciones">${icon('more', 16)}</button>
  </div>`;
}

function bindActivityRows(root) {
  $$('[data-toggle-done]', root).forEach(b => b.onclick = async (e) => {
    e.stopPropagation();
    const a = store.activity(b.dataset.toggleDone);
    if (!a) return;
    const eraDone = a.status === 'done';
    const nueva = await store.setActivityStatus(a.id, eraDone ? 'todo' : 'done');
    if (eraDone) toast('Reabierta', 'ok', 1500);
    else if (nueva) toast(`¡Completada! Siguiente: ${fmtDue(nueva.dueDate)}`, 'ok', 2600);
    else toast('¡Completada!', 'ok', 1500);
  });
  $$('[data-open-act]', root).forEach(b => b.onclick = () => activityDetail(b.dataset.openAct));
  $$('[data-act-menu]', root).forEach(b => b.onclick = (e) => {
    e.stopPropagation();
    activityMenu(b, b.dataset.actMenu);
  });

  /* Subtareas que aparecen en Hoy */
  $$('[data-achieve]', root).forEach(b => b.onclick = async (e) => {
    e.stopPropagation();
    const d = store.deliverable(b.dataset.achieve);
    if (!d) return;
    if (!await guardar(() => store.achieveDeliverable(d.id, !d.achieved))) return;
    toast(d.achieved ? 'Logro retirado' : `🎉 ¡Logrado: ${d.name}!`, 'ok', 2200);
  });
  $$('[data-open-deliv]', root).forEach(b => b.onclick = () => deliverableDetail(b.dataset.openDeliv));
  $$('[data-focus-deliv]', root).forEach(b => b.onclick = (e) => {
    e.stopPropagation();
    setFocusTarget('deliverable', b.dataset.focusDeliv);
    go('focus');
  });
}

function activityMenu(anchor, id) {
  const a = store.activity(id);
  if (!a) return;
  openMenu(anchor, [
    { label: 'Ver detalle', icon: 'info', onClick: () => activityDetail(id) },
    { label: 'Editar', icon: 'pencil', onClick: () => activityEditor(a) },
    { label: 'Enfocar ahora', icon: 'timer', onClick: () => { setFocusTarget('activity', id); go('focus'); } },
    '-',
    { label: 'Asignar…', icon: 'user', onClick: () => assignSheet(id) },
    { label: 'Mover a…', icon: 'columns', onClick: () => statusSheet(id) },
    '-',
    { label: 'Eliminar', icon: 'trash', danger: true, onClick: async () => {
      if (await confirmSheet({ title: 'Eliminar actividad', message: `Se eliminará «${a.name}» y su historial.`, confirmText: 'Eliminar', danger: true })) {
        await store.deleteActivity(id);
        toast('Actividad eliminada', 'ok');
      }
    }}
  ]);
}

/* ==========================================================================
   Vista: Foco (Pomodoro)
   ========================================================================== */
function viewFocus() {
  const foco = focusTarget();
  const total = modeSecs(timer.mode);
  const pct = 1 - timer.remaining / Math.max(1, total);
  const longEvery = store.prefs.longEvery || 4;

  const today = todayISO();

  /* La cola mezcla actividades y entregables: los entregables son los
     pasos concretos con los que se cierra una actividad. */
  const acts = store.data.activities
    .filter(a => a.status !== 'done')
    .sort((a, b) => {
      const pa = ['Q1', 'Q3', 'Q2', 'Q4'].indexOf(a.quadrant);
      const pb = ['Q1', 'Q3', 'Q2', 'Q4'].indexOf(b.quadrant);
      if (pa !== pb) return pa - pb;
      return (a.dueDate || '9999').localeCompare(b.dueDate || '9999');
    })
    .slice(0, 12);

  const dels = store.actionableDeliverables(today).slice(0, 10);

  const queue = [
    ...dels.map(x => ({ type: 'deliverable', obj: x.d, motivo: x.motivo, acts: x.acts })),
    ...acts.map(a => ({ type: 'activity', obj: a }))
  ];
  const todaySessions = store.data.sessions.filter(s => dayKey(s.endedAt) === today);

  const body = `
    <div class="page-head"><h1>Foco</h1><p>Trabaja en bloques y registra tu avance</p></div>

    <div class="timer-wrap">
      <div class="timer-card">
        <div class="segmented">
          ${['focus', 'short', 'long'].map(m => `
            <button class="${timer.mode === m ? 'active' : ''}" data-mode="${m}">${MODE_NAME[m]}</button>`).join('')}
        </div>

        <div class="col g-6" style="align-items:center">
          <div class="row g-6 wrap center">
            ${DURACIONES[timer.mode].map(n => `
              <button class="chip ${(store.prefs[timer.mode] ?? DEFAULT_TIMER[timer.mode]) === n ? 'on' : ''}"
                data-dur="${n}" ${timer.running ? 'disabled style="opacity:.4"' : ''}>${n} min</button>`).join('')}
            <button class="chip" data-dur-custom ${timer.running ? 'disabled style="opacity:.4"' : ''}
              title="Otra duración">${icon('pencil', 13)}</button>
          </div>
          ${timer.running ? `<span class="t-cap">Pausa el temporizador para cambiar la duración</span>` : ''}
        </div>

        <div class="timer-ring">
          ${ring(pct, 232, 9, MODE_COLOR[timer.mode])}
          <div class="timer-face">
            <div class="timer-time" id="clock">${mmss(timer.remaining)}</div>
            <div class="timer-mode">${MODE_NAME[timer.mode]}</div>
            ${foco ? `<div class="timer-task truncate">${esc(foco.name)}</div>` : `<div class="timer-task">Sin selección</div>`}
          </div>
        </div>

        <div class="timer-ctrl">
          <button class="icon-btn" data-reset aria-label="Reiniciar">${icon('reset', 19)}</button>
          <button class="btn btn-lg ${timer.running ? 'btn-gray' : 'btn-primary'}" data-toggle style="min-width:132px">
            ${icon(timer.running ? 'pause' : 'play', 17)}
            <span>${timer.running ? 'Pausar' : timer.remaining < total ? 'Reanudar' : 'Iniciar'}</span>
          </button>
          <button class="icon-btn" data-skip aria-label="Saltar">${icon('skip', 19)}</button>
        </div>

        <div class="pomo-track">
          ${Array.from({ length: longEvery }, (_, i) => {
            const done = timer.cycle % longEvery;
            return `<i class="pomo-pip ${i < done ? 'on' : ''} ${i === done && timer.running && timer.mode === 'focus' ? 'now' : ''}"></i>`;
          }).join('')}
        </div>
        <div class="t-foot">${timer.cycle} pomodoro${timer.cycle === 1 ? '' : 's'} · pausa larga cada ${longEvery}</div>
      </div>

      <div class="col g-16">
        <div class="card">
          <div class="card-head">
            <span class="card-title">En foco</span>
            ${foco ? `<button class="icon-btn" data-focus-menu aria-label="Opciones">${icon('more', 16)}</button>` : ''}
          </div>
          ${foco ? focusCard(foco) : `<p class="t-sub">Elige una actividad o un entregable de la lista para registrar los pomodoros en él.</p>`}
        </div>

        <div class="card card-pad-0">
          <div class="row between" style="padding:16px 18px 10px">
            <span class="card-title">Qué trabajar</span>
            <button class="btn btn-sm btn-tinted" data-new-activity>${icon('plus', 14)} Nueva</button>
          </div>
          ${queue.length ? `<div>${queue.map(q => queueRow(q)).join('')}</div>`
            : empty('inbox', 'Nada pendiente')}
        </div>

        <div class="card">
          <div class="card-head"><span class="card-title">Hoy</span>
            <span class="t-foot">${fmtDuration(todaySessions.reduce((s, x) => s + (x.minutes || 0), 0))}</span>
          </div>
          ${todaySessions.length ? `<div class="timeline">${todaySessions.slice(0, 8).map(s => {
            const d = s.deliverableId ? store.deliverable(s.deliverableId) : null;
            const a = !d && s.activityId ? store.activity(s.activityId) : null;
            const nombre = d?.name || a?.name || 'Sesión de enfoque';
            return `<div class="tl-item">
              <span class="tl-dot" style="background:var(--red-t);color:var(--red)">${icon(d ? 'flag' : 'timer', 14)}</span>
              <div class="tl-body">
                <div class="tl-text">${esc(nombre)}</div>
                <div class="tl-meta">${fmtTime(s.endedAt)} · ${s.minutes} min${d ? ' · entregable' : ''}</div>
              </div>
            </div>`;
          }).join('')}</div>` : `<p class="t-sub">Aún no has registrado sesiones hoy.</p>`}
        </div>
      </div>
    </div>`;

  return {
    toolbar: toolbar('Foco', `<button class="icon-btn" data-timer-settings aria-label="Ajustes">${icon('gear', 18)}</button>`),
    body,
    mount(root) {
      $$('[data-mode]', root).forEach(b => b.onclick = () => setMode(b.dataset.mode));

      $$('[data-dur]', root).forEach(b => b.onclick = () => setDuration(+b.dataset.dur));
      $('[data-dur-custom]', root)?.addEventListener('click', async () => {
        if (timer.running) return;
        const v = await promptSheet({
          title: `Duración de ${MODE_NAME[timer.mode].toLowerCase()}`,
          label: 'Minutos',
          value: String(store.prefs[timer.mode] ?? DEFAULT_TIMER[timer.mode]),
          confirmText: 'Aplicar'
        });
        if (v === null) return;
        const n = clampInt(v, 1, 180, 0);
        if (!n) return toast('Escribe un número entre 1 y 180', 'err');
        setDuration(n);
      });
      $('[data-toggle]', root).onclick = () => { toggleTimer(); renderView(); };
      $('[data-reset]', root).onclick = () => { resetTimer(); renderView(); };
      $('[data-skip]', root).onclick = () => { completePhase(true); };
      $$('[data-pick]', root).forEach(b => b.onclick = () => {
        setFocusTarget(b.dataset.pickType || 'activity', b.dataset.pick);
        renderView();
      });

      /* Acciones directas sobre lo que está en foco, sin ir a buscarlo */
      $$('[data-fa]', root).forEach(b => b.onclick = async () => {
        const t = focusTarget();
        if (!t) return;
        const accion = b.dataset.fa;

        if (accion === 'done') {
          if (t.type === 'deliverable') {
            if (!await guardar(() => store.achieveDeliverable(t.id, true))) return;
            setFocusTarget(null, null);
            toast(`🎉 ¡Logrado: ${t.name}!`, 'ok', 2400);
          } else {
            const nueva = await store.setActivityStatus(t.id, 'done');
            setFocusTarget(null, null);
            toast(nueva ? `Completada · siguiente ${fmtDue(nueva.dueDate)}` : '¡Actividad completada!', 'ok', 2400);
          }
          renderView();
        } else if (accion === 'resched') {
          t.type === 'deliverable' ? deliverableEditor(t.obj) : rescheduleSheet(t.id);
        } else {
          t.type === 'deliverable' ? deliverableEditor(t.obj) : activityEditor(t.obj);
        }
      });

      $('[data-focus-menu]', root)?.addEventListener('click', (e) => {
        const t = focusTarget();
        if (!t) return;
        const esDel = t.type === 'deliverable';
        openMenu(e.currentTarget, [
          { label: 'Ver detalle', icon: 'info',
            onClick: () => esDel ? deliverableDetail(t.id) : activityDetail(t.id) },
          { label: 'Editar', icon: 'pencil',
            onClick: () => esDel ? deliverableEditor(t.obj) : activityEditor(t.obj) },
          ...(esDel ? [] : [{ label: 'Reprogramar', icon: 'calendar', onClick: () => rescheduleSheet(t.id) }]),
          '-',
          { label: 'Quitar del foco', icon: 'inbox', onClick: () => {
            setFocusTarget(null, null); renderView();
            toast('Liberado del foco', 'ok', 1600);
          }}
        ]);
      });

      $('[data-timer-settings]')?.addEventListener('click', timerSettingsSheet);
      $$('[data-new-activity]', root).forEach(b => b.onclick = () => activityEditor());
      $$('[data-open-act]', root).forEach(b => b.onclick = () => activityDetail(b.dataset.openAct));
      $$('[data-open-deliv]', root).forEach(b => b.onclick = () => deliverableDetail(b.dataset.openDeliv));
    }
  };
}

/**
 * Fecha en que una actividad realmente termina.
 * En una serie, `dueDate` es la ocurrencia vigente —no el final—, así que
 * el cierre verdadero está en `recur.until`.
 */
function finDe(a) {
  if (!a) return '';
  if (a.recur) return a.recur.until || a.dueDate || a.startDate || '';
  return a.dueDate || a.startDate || '';
}

/**
 * Resumen legible de las fechas, sin etiquetas que engañen.
 * Nunca dice "termina" sobre una fecha que en realidad es de inicio.
 */
function resumenFechas(a) {
  if (!a) return 'sin fechas';
  if (a.recur) {
    const desc = describeRecur(a.recur);
    const desde = a.dueDate || a.startDate;
    return a.recur.until
      ? `${desc} · hasta ${fmtDate(a.recur.until)}`
      : desde ? `${desc} · desde ${fmtDate(desde)}` : desc;
  }
  if (a.startDate && a.dueDate && a.startDate !== a.dueDate)
    return `${fmtDate(a.startDate)} → ${fmtDate(a.dueDate)}`;
  if (a.dueDate)   return `termina ${fmtDate(a.dueDate)}`;
  if (a.startDate) return `empieza ${fmtDate(a.startDate)}`;
  return 'sin fechas';
}

/**
 * Primeras fechas de una serie, para mostrarlas mientras se edita.
 * Se calculan sin crear nada: son solo una previsualización.
 */
function ocurrenciasPrevistas(freq, inicio, hasta, max = 4) {
  if (!freq || !inicio) return [];
  const out = [];
  let f = inicio;
  let guard = 0;
  while (f && out.length < max && guard++ < 200) {
    if (hasta && f > hasta) break;
    out.push(f);
    f = nextOccurrence({ freq, interval: 1, anchorDay: parseInt(inicio.slice(8, 10), 10) }, f);
  }
  return out;
}

/* ---------- Fila de la cola: actividad o entregable ---------- */
function queueRow(q) {
  const on = timer.target?.id === q.obj.id && timer.target?.type === q.type;
  const pr = store.project(q.obj.projectId);
  const estilo = on ? 'background:var(--blue-t)' : '';

  if (q.type === 'deliverable') {
    const d = q.obj;
    const MOTIVO = {
      'vencido':          { txt: 'Vencido', cls: 'badge-red' },
      'hoy':              { txt: 'Para hoy', cls: 'badge-orange' },
      'en-curso':         { txt: 'Actividad en curso', cls: 'badge-blue' },
      'actividad-vence':  { txt: 'La actividad vence', cls: 'badge-orange' }
    }[q.motivo] || { txt: '', cls: 'badge-gray' };

    return `<button class="list-row" data-pick="${d.id}" data-pick-type="deliverable" style="${estilo}">
      <span class="tile-icon" style="width:26px;height:26px;border-radius:8px;background:var(--purple-t);color:var(--purple);flex:0 0 auto">
        ${icon('flag', 14)}</span>
      <span class="col grow" style="align-items:flex-start;min-width:0;gap:1px">
        <span class="truncate w-full" style="font-size:14px;font-weight:500;text-align:left">${esc(d.name)}</span>
        <span class="t-foot truncate w-full" style="text-align:left">
          ${pr ? esc(pr.name) : 'Sin proyecto'}${q.acts.length ? ` · ${q.acts.length} actividad${q.acts.length === 1 ? '' : 'es'}` : ''}
        </span>
      </span>
      <span class="badge ${MOTIVO.cls}">${MOTIVO.txt}</span>
      <span class="t-foot tnum">🍅 ${d.pomosDone || 0}</span>
    </button>`;
  }

  const a = q.obj;
  return `<button class="list-row" data-pick="${a.id}" data-pick-type="activity" style="${estilo}">
    <span class="badge badge-${a.quadrant.toLowerCase()}">${a.quadrant}</span>
    <span class="col grow" style="align-items:flex-start;min-width:0;gap:1px">
      <span class="truncate w-full" style="font-size:14px;font-weight:500;text-align:left">${esc(a.name)}</span>
      <span class="t-foot truncate w-full" style="text-align:left">
        ${pr ? esc(pr.name) : 'Sin proyecto'}${a.dueDate ? ' · ' + fmtDue(a.dueDate) : ''}
      </span>
    </span>
    <span class="t-foot tnum">🍅 ${a.pomosDone || 0}/${a.pomosEstimated || 0}</span>
  </button>`;
}

/* ---------- Tarjeta de lo que está en foco ---------- */
function focusCard(t) {
  return t.type === 'deliverable' ? focusDeliverableCard(t.obj) : focusActCard(t.obj);
}

function focusDeliverableCard(d) {
  const pr = store.project(d.projectId);
  const pf = pr ? store.portfolio(pr.portfolioId) : null;
  const acts = store.activitiesOfDeliverable(d.id);
  const hechas = acts.filter(a => a.status === 'done').length;

  return `
    <div class="col g-12">
      <button class="col g-4" style="align-items:flex-start;text-align:left" data-open-deliv="${d.id}">
        <span class="row g-6">
          <span class="badge badge-purple">${icon('flag', 11)} Entregable</span>
        </span>
        <span class="t-title-3">${esc(d.name)}</span>
        <span class="t-foot">${pf ? esc(pf.name) + ' › ' : ''}${pr ? esc(pr.name) : 'Sin proyecto'}</span>
      </button>

      <div class="row g-6 wrap">
        ${d.targetDate ? `<span class="badge badge-${dueTone(d.targetDate) === 'red' ? 'red' : 'gray'}">${icon('calendar', 11)} ${fmtDue(d.targetDate)}</span>` : ''}
        <span class="badge badge-gray">🍅 ${d.pomosDone || 0} pomodoro${(d.pomosDone || 0) === 1 ? '' : 's'}</span>
        ${acts.length ? `<span class="badge badge-gray">${hechas}/${acts.length} actividad${acts.length === 1 ? '' : 'es'}</span>` : ''}
      </div>

      ${d.desc ? `<div class="tl-note">${esc(d.desc)}</div>` : ''}

      <div class="row g-8 wrap">
        <button class="btn btn-sm btn-tinted" data-fa="done" style="background:var(--green-t);color:#248A3D">
          ${icon('check', 14)} Marcar logrado</button>
        <button class="btn btn-sm btn-gray" data-fa="edit">${icon('pencil', 14)} Editar</button>
      </div>
    </div>`;
}

function focusActCard(a) {
  const pr = store.project(a.projectId);
  const pf = pr ? store.portfolio(pr.portfolioId) : null;
  const m = store.member(a.assigneeUid);
  const pct = a.pomosEstimated ? Math.min(1, (a.pomosDone || 0) / a.pomosEstimated) : 0;
  const dels = store.deliverablesOfActivity(a).filter(d => !d.achieved);
  return `
    <div class="col g-12">
      <button class="col g-4" style="align-items:flex-start;text-align:left" data-open-act="${a.id}">
        <span class="t-title-3">${esc(a.name)}</span>
        <span class="t-foot">${pf ? esc(pf.name) + ' › ' : ''}${pr ? esc(pr.name) : 'Sin proyecto'}</span>
      </button>
      <div class="row g-6 wrap">
        <span class="badge badge-${a.quadrant.toLowerCase()}">${QUADRANTS[a.quadrant]?.name || a.quadrant}</span>
        <span class="badge badge-gray">${STATUSES[a.status]?.name || a.status}</span>
        ${a.dueDate ? `<span class="badge badge-${dueTone(a.dueDate, a.status) === 'red' ? 'red' : 'gray'}">${icon('calendar', 11)} ${fmtDue(a.dueDate)}</span>` : ''}
        ${m ? `<span class="badge badge-gray">${esc((m.displayName || '').split(' ')[0])}</span>` : ''}
      </div>
      ${a.pomosEstimated ? `
        <div class="col g-4">
          <div class="row between t-foot"><span>Pomodoros</span><span class="tnum">${a.pomosDone || 0} / ${a.pomosEstimated}</span></div>
          <div class="progress"><i style="width:${pct * 100}%;background:var(--red)"></i></div>
        </div>` : ''}
      ${a.notes ? `<div class="tl-note">${esc(a.notes)}</div>` : ''}

      ${dels.length ? `
        <div class="col g-4">
          <span class="t-cap">Entregables pendientes · toca para enfocarlo</span>
          <div class="list">
            ${dels.map(d => `<button class="list-row" data-pick="${d.id}" data-pick-type="deliverable">
              ${icon('flag', 14)}
              <span class="grow truncate" style="text-align:left;font-size:13.5px">${esc(d.name)}</span>
              <span class="t-cap tnum">🍅 ${d.pomosDone || 0}</span>
              ${icon('chevR', 13, 'chev')}
            </button>`).join('')}
          </div>
        </div>` : ''}

      <div class="row g-8 wrap">
        <button class="btn btn-sm btn-tinted" data-fa="done" style="background:var(--green-t);color:#248A3D">
          ${icon('check', 14)} Completar</button>
        <button class="btn btn-sm btn-gray" data-fa="resched">${icon('calendar', 14)} Reprogramar</button>
        <button class="btn btn-sm btn-gray" data-fa="edit">${icon('pencil', 14)} Editar</button>
      </div>
    </div>`;
}

/* ---------- Detalle de un entregable ---------- */
function deliverableDetail(id) {
  const d = store.deliverable(id);
  if (!d) return;
  const pr = store.project(d.projectId);
  const acts = store.activitiesOfDeliverable(d.id);
  const hechas = acts.filter(a => a.status === 'done').length;
  const sesiones = store.data.sessions.filter(s => s.deliverableId === d.id);
  const minutos = sesiones.reduce((n, s) => n + (s.minutes || 0), 0);

  openSheet({
    title: 'Entregable',
    size: 'lg',
    body: `
      <div class="t-title" style="line-height:1.3">${esc(d.name)}</div>
      <div class="t-foot mt-4">${pr ? esc(pr.name) : 'Sin proyecto'}</div>

      <div class="row g-6 wrap mt-16">
        ${d.achieved ? `<span class="badge badge-green">${icon('check', 11)} Logrado ${fmtDate(d.achievedAt)}</span>`
                     : `<span class="badge badge-gray">Pendiente</span>`}
        ${d.targetDate ? `<span class="badge badge-${dueTone(d.targetDate, d.achieved ? 'done' : '') === 'red' ? 'red' : 'gray'}">${icon('calendar', 11)} ${fmtDate(d.targetDate)}</span>` : ''}
        <span class="badge badge-gray">🍅 ${d.pomosDone || 0} pomodoro${(d.pomosDone || 0) === 1 ? '' : 's'}</span>
        ${Math.round(minutos) >= 1 ? `<span class="badge badge-gray">${fmtDuration(minutos)} enfocados</span>` : ''}
      </div>

      ${d.desc ? `<div class="section-label mt-16">Descripción</div>
        <div class="tl-note" style="margin-top:0">${esc(d.desc)}</div>` : ''}

      <div class="section-label mt-16">Actividades que contribuyen · ${hechas}/${acts.length}</div>
      ${acts.length ? `<div class="list">${acts.map(a => `
        <button class="list-row" data-da="${a.id}">
          <span class="act-check ${a.status === 'done' ? 'done' : ''}" style="pointer-events:none">${icon('check', 13)}</span>
          <span class="grow truncate" style="text-align:left;font-size:14px">${esc(a.name)}</span>
          <span class="badge badge-gray">${STATUSES[a.status]?.name || a.status}</span>
        </button>`).join('')}</div>`
      : `<p class="t-sub">Ninguna actividad está vinculada todavía.</p>`}`,
    footer: `
      <button class="btn btn-gray" data-x="edit">${icon('pencil', 15)} Editar</button>
      <button class="btn btn-gray" data-x="focus">${icon('timer', 15)} Enfocar</button>
      <button class="btn ${d.achieved ? 'btn-gray' : 'btn-primary'}" data-x="done">
        ${icon('check', 15)} ${d.achieved ? 'Quitar logro' : 'Marcar logrado'}</button>`,
    onMount(el) {
      $$('[data-da]', el).forEach(b => b.onclick = () => { closeSheet(); activityDetail(b.dataset.da); });
      $('[data-x="edit"]', el).onclick = () => { closeSheet(); deliverableEditor(store.deliverable(id)); };
      $('[data-x="focus"]', el).onclick = () => { setFocusTarget('deliverable', id); closeSheet(); go('focus'); };
      $('[data-x="done"]', el).onclick = async () => {
        if (!await guardar(() => store.achieveDeliverable(id, !d.achieved))) return;
        closeSheet();
        toast(d.achieved ? 'Logro retirado' : `🎉 ¡Logrado: ${d.name}!`, 'ok', 2400);
        renderView();
      };
    }
  });
}

/* ---------- Motor del temporizador ---------- */
function startTicker() {
  clearInterval(tickHandle);
  tickHandle = setInterval(() => {
    if (!timer.running) return;
    const left = Math.round((timer.endsAt - Date.now()) / 1000);
    timer.remaining = Math.max(0, left);
    paintClock();
    if (left <= 0) completePhase(false);
  }, 250);
}

function paintClock() {
  const t = mmss(timer.remaining);
  const c = $('#clock'); if (c) c.textContent = t;
  const c2 = $('#todayClock'); if (c2) c2.textContent = t;
  document.title = timer.running ? `${t} · PomoMomo` : 'PomoMomo';

  const fg = $('.timer-ring .ring-fg');
  if (fg) {
    const total = modeSecs(timer.mode);
    const r = +fg.getAttribute('r');
    const circ = 2 * Math.PI * r;
    fg.setAttribute('stroke-dashoffset', (circ * (timer.remaining / Math.max(1, total))).toFixed(2));
  }
}

function toggleTimer() {
  if (timer.running) {
    timer.remaining = Math.max(0, Math.round((timer.endsAt - Date.now()) / 1000));
    timer.running = false;
    timer.endsAt = null;
  } else {
    if (timer.remaining <= 0) timer.remaining = modeSecs(timer.mode);
    timer.endsAt = Date.now() + timer.remaining * 1000;
    timer.running = true;
    try { chime('start'); } catch { /* ignora */ }
  }
  saveTimer();
}

function setMode(mode) {
  timer.mode = mode;
  timer.running = false;
  timer.endsAt = null;
  timer.remaining = modeSecs(mode);
  saveTimer();
  renderView();
}

function resetTimer() {
  timer.running = false;
  timer.endsAt = null;
  timer.remaining = modeSecs(timer.mode);
  saveTimer();
}

/** Cambia la duración del modo actual y reinicia la cuenta. */
function setDuration(minutos) {
  if (timer.running) return;              // no se toca un ciclo en curso
  store.savePrefs({ [timer.mode]: minutos });
  timer.remaining = modeSecs(timer.mode);
  timer.endsAt = null;
  saveTimer();
  renderView();
  toast(`${MODE_NAME[timer.mode]}: ${minutos} min`, 'ok', 1600);
}

async function completePhase(skipped) {
  const wasFocus = timer.mode === 'focus';
  const minutes = store.prefs[timer.mode] ?? DEFAULT_TIMER[timer.mode];

  timer.running = false;
  timer.endsAt = null;

  const objetivoDelPomodoro = timer.target;

  let registrado = false;

  if (wasFocus) {
    if (!skipped) {
      registrado = await guardar(() => store.addPomodoro(objetivoDelPomodoro, minutes));
      if (registrado) timer.cycle += 1;   // solo cuenta lo que quedó guardado
      if (store.prefs.sound) chime('done');
      notify('Pomodoro completado', 'Tómate un descanso 🍅');
      if (!objetivoDelPomodoro && registrado) toast('Pomodoro registrado', 'ok');
    }
    const longEvery = store.prefs.longEvery || 4;
    timer.mode = (timer.cycle % longEvery === 0 && timer.cycle > 0) ? 'long' : 'short';
    timer.remaining = modeSecs(timer.mode);
    if (store.prefs.autoStartBreak && !skipped) {
      timer.endsAt = Date.now() + timer.remaining * 1000;
      timer.running = true;
    }
  } else {
    if (!skipped) {
      if (store.prefs.sound) chime('done');
      notify('Descanso terminado', 'De vuelta al enfoque');
    }
    timer.mode = 'focus';
    timer.remaining = modeSecs('focus');
    if (store.prefs.autoStartFocus && !skipped) {
      timer.endsAt = Date.now() + timer.remaining * 1000;
      timer.running = true;
    }
  }

  saveTimer();
  if (app.route.name === 'focus' || app.route.name === 'today') renderView();

  /* Con una actividad en foco, el cierre ofrece qué hacer con ella.
     El descanso ya arrancó: la hoja no bloquea el temporizador. */
  if (wasFocus && !skipped && registrado && objetivoDelPomodoro) {
    pomodoroDoneSheet(objetivoDelPomodoro, minutes);
  }
}

function notify(title, body) {
  try {
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(title, { body, icon: './icons/icon-192.png', badge: './icons/icon-192.png' });
    }
  } catch { /* ignora */ }
}

/* ==========================================================================
   Cierre del pomodoro — qué hacer con lo que estabas trabajando
   ========================================================================== */
function pomodoroDoneSheet(target, minutes, { recuperado = false } = {}) {
  const t = Store.normalizeTarget(target);
  if (!t) return;

  const esEntregable = t.type === 'deliverable';
  const a = esEntregable ? store.deliverable(t.id) : store.activity(t.id);
  if (!a) return;

  const pr = store.project(a.projectId);
  const hechos = a.pomosDone || 0;
  const est = esEntregable ? 0 : (a.pomosEstimated || 0);
  const pct = est ? Math.min(1, hechos / est) : 0;
  const QUE = esEntregable ? 'el entregable' : 'la actividad';

  const accion = (id, ic, titulo, sub, clase = '') => `
    <button class="list-row" data-pd="${id}">
      <span class="tile-icon ${clase}" style="width:34px;height:34px;border-radius:10px;flex:0 0 auto">${icon(ic, 17)}</span>
      <span class="col grow" style="align-items:flex-start;min-width:0;gap:1px">
        <span style="font-size:14.5px;font-weight:550">${titulo}</span>
        <span class="t-foot">${sub}</span>
      </span>
      ${icon('chevR', 14, 'chev')}
    </button>`;

  openSheet({
    title: recuperado ? 'Pomodoro recuperado' : 'Pomodoro completado',
    body: `
      <div class="col center g-8 mb-16" style="text-align:center">
        <div style="font-size:40px;line-height:1">🍅</div>
        <div class="t-title-3">${minutes} min de enfoque</div>
        <div class="t-sub">${esc(a.name)}${pr ? ` · ${esc(pr.name)}` : ''}</div>
        ${recuperado ? `<div class="badge badge-orange">Se cumplió con la app cerrada</div>` : ''}
      </div>

      ${est ? `
        <div class="col g-4 mb-16">
          <div class="row between t-foot"><span>Pomodoros de esta actividad</span>
            <span class="tnum">${hechos} / ${est}</span></div>
          <div class="progress"><i style="width:${pct * 100}%;background:var(--red)"></i></div>
          ${hechos >= est ? `<span class="t-foot" style="color:var(--orange)">Ya superaste lo estimado. ¿La cierras o reestimas?</span>` : ''}
        </div>`
      : esEntregable ? `
        <div class="row between t-foot mb-16">
          <span>Pomodoros en este entregable</span><span class="tnum">${hechos}</span>
        </div>` : ''}

      <div class="section-label">¿Qué hacer con ${QUE}?</div>
      <div class="list">
        ${esEntregable
          ? accion('done', 'check', 'Marcar como logrado', 'Queda registrado con la fecha de hoy', 'bg-green')
          : accion('done', 'check', 'Completar actividad', 'Queda terminada y sale de la cola', 'bg-green')}
        ${accion('resched', 'calendar', 'Reprogramar',
            (esEntregable ? a.targetDate : a.dueDate) ? `Vence ${fmtDue(esEntregable ? a.targetDate : a.dueDate)}` : 'Sin fecha', 'bg-orange')}
        ${accion('edit', 'pencil', esEntregable ? 'Editar entregable' : 'Editar actividad',
            esEntregable ? 'Cambiar nombre, descripción o fecha' : 'Cambiar puntos, notas, responsable…', 'bg-blue')}
        ${accion('keep', 'timer', 'Seguir con esto', 'Continúa en foco para el siguiente pomodoro', 'bg-gray')}
        ${accion('release', 'inbox', 'Quitarlo del foco', 'El pomodoro queda registrado igual', 'bg-gray')}
      </div>`,
    footer: `<button class="btn btn-gray" data-x="c">Cerrar</button>`,
    onMount(el) {
      $$('.bg-green', el).forEach(x => x.style.background = 'var(--green)');
      $$('.bg-orange', el).forEach(x => x.style.background = 'var(--orange)');
      $$('.bg-blue', el).forEach(x => x.style.background = 'var(--blue)');
      $$('.bg-gray', el).forEach(x => { x.style.background = 'var(--surface-3)'; x.style.color = 'var(--label-2)'; });

      $('[data-x="c"]', el).onclick = () => closeSheet();

      $$('[data-pd]', el).forEach(b => b.onclick = async () => {
        const accion = b.dataset.pd;

        if (accion === 'done') {
          if (esEntregable) {
            const ok = await guardar(() => store.achieveDeliverable(a.id, true));
            if (!ok) return;
            setFocusTarget(null, null);
            closeSheet();
            toast(`🎉 ¡Logrado: ${a.name}!`, 'ok', 2600);
          } else {
            const nueva = await store.setActivityStatus(a.id, 'done');
            setFocusTarget(null, null);
            closeSheet();
            toast(nueva ? `Completada · siguiente ${fmtDue(nueva.dueDate)}` : '¡Actividad completada!', 'ok', 2600);
          }
          renderView();
          return;
        }

        if (accion === 'resched') {
          closeSheet();
          esEntregable ? deliverableEditor(store.deliverable(a.id)) : rescheduleSheet(a.id);
          return;
        }

        if (accion === 'edit') {
          closeSheet();
          esEntregable ? deliverableEditor(store.deliverable(a.id)) : activityEditor(store.activity(a.id));
          return;
        }

        if (accion === 'release') {
          setFocusTarget(null, null);
          closeSheet(); renderView();
          toast('Liberado del foco', 'ok', 1800);
          return;
        }

        closeSheet();   // 'keep': se queda tal cual
      });
    }
  });
}

/* ---------- Reprogramar con opciones rápidas ---------- */
function rescheduleSheet(activityId) {
  const a = store.activity(activityId);
  if (!a) return;
  const hoy = todayISO();

  const opciones = [
    { d: hoy,               label: 'Hoy' },
    { d: addDays(hoy, 1),   label: 'Mañana' },
    { d: addDays(hoy, 2),   label: 'Pasado mañana' },
    { d: addDays(hoy, 7),   label: 'En una semana' }
  ];

  openSheet({
    title: 'Reprogramar',
    body: `
      <p class="t-sub mb-16">${esc(a.name)}${a.dueDate ? ` · vence ${fmtDue(a.dueDate)}` : ' · sin fecha'}</p>
      <div class="list mb-16">
        ${opciones.map(o => `<button class="list-row" data-rs="${o.d}">
          ${icon('calendar', 17)}
          <span class="grow">${o.label}</span>
          <span class="t-foot">${fmtDate(o.d)}</span>
        </button>`).join('')}
        ${a.dueDate ? `<button class="list-row" data-rs="">
          ${icon('close', 17)}<span class="grow">Quitar la fecha</span>
        </button>` : ''}
      </div>
      <div class="field"><label>O elige una fecha</label>
        <input class="input" type="date" id="rs-date" value="${a.dueDate || ''}"></div>`,
    footer: `<button class="btn btn-gray" data-x="c">Cancelar</button>
             <button class="btn btn-primary" data-x="s">Guardar</button>`,
    onMount(el) {
      const aplicar = async (fecha) => {
        const ok = await guardar(() => store.saveActivity({ ...store.activity(activityId), dueDate: fecha }));
        if (!ok) return;
        closeSheet();
        toast(fecha ? `Reprogramada para ${fmtDue(fecha)}` : 'Fecha eliminada', 'ok', 2200);
        renderView();
      };
      $$('[data-rs]', el).forEach(b => b.onclick = () => aplicar(b.dataset.rs));
      $('[data-x="c"]', el).onclick = () => closeSheet();
      $('[data-x="s"]', el).onclick = () => aplicar($('#rs-date', el).value);
    }
  });
}

function timerSettingsSheet() {
  const p = store.prefs;
  openSheet({
    title: 'Ajustes del temporizador',
    body: `
      <div class="grid grid-3" style="gap:12px">
        <div class="field"><label>Enfoque (min)</label><input class="input" type="number" id="s-focus" min="1" max="120" value="${p.focus}"></div>
        <div class="field"><label>Pausa corta</label><input class="input" type="number" id="s-short" min="1" max="60" value="${p.short}"></div>
        <div class="field"><label>Pausa larga</label><input class="input" type="number" id="s-long" min="1" max="90" value="${p.long}"></div>
      </div>
      <div class="field mt-16"><label>Pausa larga cada</label>
        <select class="select" id="s-every">
          ${[2, 3, 4, 5, 6].map(n => `<option value="${n}" ${p.longEvery === n ? 'selected' : ''}>${n} pomodoros</option>`).join('')}
        </select>
      </div>
      <div class="list mt-16">
        ${toggleRow('s-autoBreak', 'Iniciar descansos automáticamente', p.autoStartBreak)}
        ${toggleRow('s-autoFocus', 'Iniciar enfoque automáticamente', p.autoStartFocus)}
        ${toggleRow('s-sound', 'Sonido al terminar', p.sound)}
      </div>
      <button class="btn btn-gray btn-block mt-16" id="s-notif">${icon('bell', 15)} Activar notificaciones del sistema</button>`,
    footer: `<button class="btn btn-gray" data-x="c">Cancelar</button><button class="btn btn-primary" data-x="s">Guardar</button>`,
    onMount(el) {
      bindToggles(el);
      $('#s-notif', el).onclick = async () => {
        if (!('Notification' in window)) return toast('Este navegador no soporta notificaciones', 'err');
        const r = await Notification.requestPermission();
        toast(r === 'granted' ? 'Notificaciones activadas' : 'Permiso denegado', r === 'granted' ? 'ok' : 'err');
      };
      $('[data-x="c"]', el).onclick = () => closeSheet();
      $('[data-x="s"]', el).onclick = () => {
        store.savePrefs({
          focus: clampInt($('#s-focus', el).value, 1, 120, 25),
          short: clampInt($('#s-short', el).value, 1, 60, 5),
          long:  clampInt($('#s-long', el).value, 1, 90, 15),
          longEvery: +$('#s-every', el).value,
          autoStartBreak: $('#s-autoBreak', el).classList.contains('on'),
          autoStartFocus: $('#s-autoFocus', el).classList.contains('on'),
          sound: $('#s-sound', el).classList.contains('on')
        });
        if (!timer.running) { timer.remaining = modeSecs(timer.mode); saveTimer(); }
        closeSheet();
        renderView();
        toast('Ajustes guardados', 'ok');
      };
    }
  });
}

const toggleRow = (id, label, on, sub = '') =>
  `<div class="list-row" data-toggle-row style="cursor:pointer">
     <span class="col grow" style="align-items:flex-start;gap:1px">
       <span>${esc(label)}</span>
       ${sub ? `<span class="t-foot">${esc(sub)}</span>` : ''}
     </span>
     <i class="switch ${on ? 'on' : ''}" id="${id}"></i>
   </div>`;

/**
 * Activa los interruptores de una hoja. Centralizado a propósito:
 * cada hoja que lo reimplementaba se arriesgaba a olvidar el toggle
 * y dejar el control inerte.
 */
function bindToggles(root, onChange) {
  $$('[data-toggle-row]', root).forEach(row => row.onclick = () => {
    const sw = $('.switch', row);
    if (!sw) return;
    sw.classList.toggle('on');
    onChange?.(sw.id, sw.classList.contains('on'));
  });
}

const clampInt = (v, min, max, def) => {
  const n = parseInt(v, 10);
  return isNaN(n) ? def : Math.min(max, Math.max(min, n));
};

/* ==========================================================================
   Vista: Portafolios
   ========================================================================== */
function viewPortfolios() {
  const pfs = store.data.portfolios;

  const body = `
    <div class="page-head"><h1>Portafolios</h1><p>Agrupa proyectos por iniciativa estratégica</p></div>
    ${pfs.length ? `<div class="grid grid-auto">
      ${pfs.map(pf => {
        const projs = store.projectsOf(pf.id);
        const acts = store.activitiesOfPortfolio(pf.id);
        const st = Stats(acts);
        return `<button class="tile" data-open-pf="${pf.id}">
          <div class="row between">
            <div class="tile-icon" style="background:${pf.color || '#007AFF'}">${icon(pf.icon || 'layers', 20)}</div>
            <span class="icon-btn" data-pf-menu="${pf.id}">${icon('more', 16)}</span>
          </div>
          <div>
            <div class="tile-name">${esc(pf.name)}</div>
            <div class="tile-desc clamp-2">${esc(pf.desc || 'Sin descripción')}</div>
          </div>
          <div class="tile-metrics">
            <span class="tile-metric"><b>${projs.length}</b><span>Proyectos</span></span>
            <span class="tile-metric"><b>${st.total}</b><span>Actividades</span></span>
            <span class="tile-metric"><b>${st.pct}%</b><span>Avance</span></span>
          </div>
          <div class="progress"><i style="width:${st.pct}%;background:${pf.color || '#007AFF'}"></i></div>
        </button>`;
      }).join('')}
      <button class="tile-add" data-new-pf>${icon('plus', 22)}<span>Nuevo portafolio</span></button>
    </div>` : `<div class="card">${empty('layers', 'Sin portafolios',
      'Un portafolio agrupa varios proyectos relacionados.',
      `<button class="btn btn-primary mt-8" data-new-pf>${icon('plus', 15)} Crear portafolio</button>`)}</div>`}`;

  return {
    toolbar: toolbar('Portafolios', `<button class="btn btn-primary" data-new-pf>${icon('plus', 15)}<span>Nuevo</span></button>`),
    body,
    mount(root) {
      $$('[data-new-pf]').forEach(b => b.onclick = () => portfolioEditor());
      $$('[data-open-pf]', root).forEach(b => b.onclick = (e) => {
        if (e.target.closest('[data-pf-menu]')) return;
        go('portfolio/' + b.dataset.openPf);
      });
      $$('[data-pf-menu]', root).forEach(b => b.onclick = (e) => {
        e.stopPropagation();
        const id = b.dataset.pfMenu;
        openMenu(b, [
          { label: 'Abrir', icon: 'chevR', onClick: () => go('portfolio/' + id) },
          { label: 'Editar', icon: 'pencil', onClick: () => portfolioEditor(store.portfolio(id)) },
          '-',
          { label: 'Eliminar', icon: 'trash', danger: true, onClick: async () => {
            const pf = store.portfolio(id);
            if (await confirmSheet({ title: 'Eliminar portafolio', message: `Los proyectos de «${pf.name}» quedarán sin portafolio, no se eliminan.`, confirmText: 'Eliminar', danger: true })) {
              await store.deletePortfolio(id); toast('Portafolio eliminado', 'ok');
            }
          }}
        ]);
      });
    }
  };
}

function viewPortfolioDetail({ id }) {
  const pf = store.portfolio(id);
  if (!pf) return { toolbar: toolbar('No encontrado', '', 'portfolios'), body: `<div class="card">${empty('warning', 'Portafolio no encontrado')}</div>` };

  const projs = store.projectsOf(id);
  const acts = store.activitiesOfPortfolio(id);
  const st = Stats(acts);

  const body = `
    <div class="row g-12 mb-16">
      <div class="tile-icon" style="background:${pf.color};width:46px;height:46px;border-radius:13px">${icon(pf.icon || 'layers', 24)}</div>
      <div class="col grow" style="min-width:0">
        <h1 class="t-large" style="font-size:26px">${esc(pf.name)}</h1>
        <p class="t-sub">${esc(pf.desc || 'Sin descripción')}</p>
      </div>
    </div>

    <div class="grid grid-stats mb-24">
      <div class="stat"><span class="stat-label">Proyectos</span><span class="stat-value">${projs.length}</span></div>
      <div class="stat"><span class="stat-label">Actividades</span><span class="stat-value">${st.total}</span><span class="stat-sub">${st.open} abiertas</span></div>
      <div class="stat"><span class="stat-label">Avance</span><span class="stat-value">${st.pct}%</span>
        <div class="progress progress-sm mt-4"><i style="width:${st.pct}%;background:${pf.color}"></i></div></div>
      <div class="stat"><span class="stat-label">Puntos</span><span class="stat-value">${st.donePoints}<span style="font-size:15px;color:var(--label-3)">/${st.points}</span></span></div>
    </div>

    <div class="row between mb-8" style="padding:0 4px">
      <span class="t-head">Proyectos</span>
      <button class="btn btn-sm btn-tinted" data-new-proj>${icon('plus', 14)} Nuevo proyecto</button>
    </div>
    ${projs.length ? `<div class="grid grid-auto">${projs.map(projectTile).join('')}</div>`
      : `<div class="card">${empty('briefcase', 'Sin proyectos', 'Agrega el primer proyecto de este portafolio.',
          `<button class="btn btn-primary mt-8" data-new-proj>${icon('plus', 15)} Nuevo proyecto</button>`)}</div>`}`;

  return {
    toolbar: toolbar(pf.name, `
      <button class="icon-btn" data-edit-pf aria-label="Editar">${icon('pencil', 17)}</button>
      <button class="btn btn-primary" data-new-proj>${icon('plus', 15)}<span>Proyecto</span></button>`, 'portfolios'),
    body,
    mount(root) {
      $$('[data-new-proj]').forEach(b => b.onclick = () => projectEditor({ portfolioId: id }));
      $('[data-edit-pf]')?.addEventListener('click', () => portfolioEditor(pf));
      bindProjectTiles(root);
    }
  };
}

function portfolioEditor(pf = null) {
  const isNew = !pf?.id;
  const cur = { name: '', desc: '', color: PALETTE[0], icon: 'layers', ...pf };

  openSheet({
    title: isNew ? 'Nuevo portafolio' : 'Editar portafolio',
    body: `
      <div class="field"><label>Nombre</label>
        <input class="input" id="pf-name" value="${esc(cur.name)}" placeholder="Ej. Transformación digital"></div>
      <div class="field mt-16"><label>Descripción</label>
        <textarea class="textarea" id="pf-desc" placeholder="¿Qué agrupa este portafolio?">${esc(cur.desc)}</textarea></div>
      <div class="field mt-16"><label>Color</label>${swatches(cur.color)}</div>
      <div class="field mt-16"><label>Icono</label>${iconPicker(cur.icon)}</div>`,
    footer: `<button class="btn btn-gray" data-x="c">Cancelar</button>
             <button class="btn btn-primary" data-x="s">${isNew ? 'Crear' : 'Guardar'}</button>`,
    onMount(el) {
      bindSwatches(el); bindIconPicker(el);
      $('[data-x="c"]', el).onclick = () => closeSheet();
      $('[data-x="s"]', el).onclick = async (ev) => {
        const name = $('#pf-name', el).value.trim();
        if (!name) return toast('Escribe un nombre', 'err');
        const btn = ev.currentTarget;
        btn.disabled = true;
        const ok = await guardar(() => store.savePortfolio({
          ...(pf?.id ? { id: pf.id, createdAt: pf.createdAt } : {}),
          name, desc: $('#pf-desc', el).value.trim(),
          color: $('.sw.on', el)?.dataset.color || cur.color,
          icon: $('.ip.on', el)?.dataset.icon || cur.icon
        }));
        btn.disabled = false;
        if (!ok) return;
        closeSheet(); toast(isNew ? 'Portafolio creado' : 'Guardado', 'ok');
      };
    }
  });
}

/* ==========================================================================
   Vista: Proyectos
   ========================================================================== */
function projectTile(pr) {
  const acts = store.activitiesOf(pr.id);
  const st = Stats(acts);
  const pf = store.portfolio(pr.portfolioId);
  const late = acts.filter(a => a.status !== 'done' && a.dueDate && a.dueDate < todayISO()).length;

  return `<button class="tile" data-open-pr="${pr.id}">
    <div class="row between">
      <div class="tile-icon" style="background:${pr.color || '#007AFF'}">${icon(pr.icon || 'briefcase', 20)}</div>
      <span class="icon-btn" data-pr-menu="${pr.id}">${icon('more', 16)}</span>
    </div>
    <div>
      <div class="tile-name">${esc(pr.name)}</div>
      <div class="t-foot">${pf ? esc(pf.name) : 'Sin portafolio'}</div>
    </div>
    <div class="row g-6 wrap">
      <span class="badge badge-gray">${st.done}/${st.total} actividades</span>
      ${late ? `<span class="badge badge-red">${late} vencida${late === 1 ? '' : 's'}</span>` : ''}
      ${pr.dueDate ? `<span class="badge badge-${dueTone(pr.dueDate) === 'red' ? 'red' : 'gray'}">${fmtDue(pr.dueDate)}</span>` : ''}
    </div>
    <div class="col g-4">
      <div class="row between t-foot"><span>Avance</span><span class="tnum">${st.pct}%</span></div>
      <div class="progress"><i style="width:${st.pct}%;background:${pr.color || '#007AFF'}"></i></div>
    </div>
  </button>`;
}

function bindProjectTiles(root) {
  $$('[data-open-pr]', root).forEach(b => b.onclick = (e) => {
    if (e.target.closest('[data-pr-menu]')) return;
    go('project/' + b.dataset.openPr);
  });
  $$('[data-pr-menu]', root).forEach(b => b.onclick = (e) => {
    e.stopPropagation();
    const id = b.dataset.prMenu;
    openMenu(b, [
      { label: 'Abrir', icon: 'chevR', onClick: () => go('project/' + id) },
      { label: 'Editar', icon: 'pencil', onClick: () => projectEditor(store.project(id)) },
      { label: 'Nueva actividad', icon: 'plus', onClick: () => activityEditor({ projectId: id }) },
      '-',
      { label: 'Eliminar', icon: 'trash', danger: true, onClick: async () => {
        const pr = store.project(id);
        const n = store.activitiesOf(id).length;
        if (await confirmSheet({ title: 'Eliminar proyecto', message: `Se eliminará «${pr.name}» y sus ${n} actividad(es).`, confirmText: 'Eliminar', danger: true })) {
          await store.deleteProject(id); toast('Proyecto eliminado', 'ok');
        }
      }}
    ]);
  });
}

function viewProjects() {
  const pfs = store.data.portfolios;
  const orphan = store.data.projects.filter(p => !p.portfolioId || !store.portfolio(p.portfolioId));

  const groups = [
    ...pfs.map(pf => ({ pf, list: store.projectsOf(pf.id) })),
    ...(orphan.length ? [{ pf: null, list: orphan }] : [])
  ].filter(g => g.list.length);

  const body = `
    <div class="page-head"><h1>Proyectos</h1><p>Todos los proyectos del espacio, agrupados por portafolio</p></div>
    ${groups.length ? groups.map(g => `
      <section class="mb-24">
        <div class="row g-8 mb-8" style="padding:0 4px">
          ${g.pf ? `<i class="dot dot-lg" style="background:${g.pf.color}"></i><span class="t-head">${esc(g.pf.name)}</span>`
                 : `<span class="t-head muted">Sin portafolio</span>`}
          <span class="badge badge-gray">${g.list.length}</span>
        </div>
        <div class="grid grid-auto">${g.list.map(projectTile).join('')}</div>
      </section>`).join('')
      : `<div class="card">${empty('briefcase', 'Sin proyectos', 'Crea tu primer proyecto para empezar a organizar actividades.',
          `<button class="btn btn-primary mt-8" data-new-proj>${icon('plus', 15)} Nuevo proyecto</button>`)}</div>`}`;

  return {
    toolbar: toolbar('Proyectos', `<button class="btn btn-primary" data-new-proj>${icon('plus', 15)}<span>Nuevo</span></button>`),
    body,
    mount(root) {
      $$('[data-new-proj]').forEach(b => b.onclick = () => projectEditor());
      bindProjectTiles(root);
    }
  };
}

function viewProjectDetail({ id }) {
  const pr = store.project(id);
  if (!pr) return { toolbar: toolbar('No encontrado', '', 'projects'), body: `<div class="card">${empty('warning', 'Proyecto no encontrado')}</div>` };

  const pf = store.portfolio(pr.portfolioId);
  const acts = store.activitiesOf(id);
  const st = Stats(acts);

  const byStatus = STATUS_ORDER.map(s => ({ s, list: acts.filter(a => a.status === s) }));

  const body = `
    <div class="row g-12 mb-16">
      <div class="tile-icon" style="background:${pr.color};width:46px;height:46px;border-radius:13px">${icon(pr.icon || 'briefcase', 24)}</div>
      <div class="col grow" style="min-width:0">
        <h1 class="t-large" style="font-size:26px">${esc(pr.name)}</h1>
        <p class="t-sub">${pf ? `<a data-go="portfolio/${pf.id}" style="color:${pf.color};cursor:pointer">${esc(pf.name)}</a> · ` : ''}${esc(pr.desc || '')}</p>
      </div>
    </div>

    <div class="grid grid-stats mb-24">
      <div class="stat"><span class="stat-label">Actividades</span><span class="stat-value">${st.total}</span><span class="stat-sub">${st.open} abiertas</span></div>
      <div class="stat"><span class="stat-label">Avance</span><span class="stat-value">${st.pct}%</span>
        <div class="progress progress-sm mt-4"><i style="width:${st.pct}%;background:${pr.color}"></i></div></div>
      <div class="stat"><span class="stat-label">Puntos</span><span class="stat-value">${st.donePoints}<span style="font-size:15px;color:var(--label-3)">/${st.points}</span></span></div>
      <div class="stat"><span class="stat-label">Pomodoros</span><span class="stat-value">${st.pomos}</span><span class="stat-sub">de ${st.estPomos} estimados</span></div>
    </div>

    ${(() => {
      const conVentana = acts.filter(a => a.startDate && a.dueDate);
      if (!conVentana.length) return '';
      const w = workWindow(conVentana);
      const esfuerzo = conVentana.reduce((n, a) => n + durationDays(a.startDate, a.dueDate), 0);
      const abiertas = conVentana.filter(a => a.status !== 'done');
      const esfuerzoAbierto = abiertas.reduce((n, a) => n + durationDays(a.startDate, a.dueDate), 0);
      /* En los agregados se usan días llanos: comparar "21 d de esfuerzo"
         contra "9 d de ventana" es inmediato; "3 semanas contra 9 días" no. */
      const dias = (n) => n ? `${n} d` : '—';
      return `<div class="card mb-24">
        <div class="card-head"><span class="card-title">Tiempo de trabajo</span>
          <span class="t-foot">${conVentana.length} de ${acts.length} actividades con duración</span></div>
        <div class="row g-24 wrap">
          <span class="tile-metric"><b>${dias(w.days)}</b><span>Ventana de calendario</span></span>
          <span class="tile-metric"><b>${dias(esfuerzo)}</b><span>Esfuerzo acumulado</span></span>
          <span class="tile-metric"><b>${dias(esfuerzoAbierto)}</b><span>Pendiente</span></span>
        </div>
        <p class="t-foot mt-8">${fmtDate(w.start)} → ${fmtDate(w.end)}${
          esfuerzo > w.days ? ` · Solapamiento: ${esfuerzo} días de trabajo dentro de ${w.days} de calendario.` : ''}</p>
      </div>`;
    })()}

    ${pr.startDate || pr.dueDate ? `<div class="card mb-24">
      <div class="row between wrap g-12">
        <span class="t-sub">${icon('calendar', 14)} ${pr.startDate ? fmtDate(pr.startDate) : '—'} → ${pr.dueDate ? fmtDate(pr.dueDate) : '—'}</span>
        ${pr.dueDate ? `<span class="badge badge-${dueTone(pr.dueDate) === 'red' ? 'red' : 'blue'}">${fmtDue(pr.dueDate)}</span>` : ''}
      </div>
    </div>` : ''}

    ${sprintsSection(pr)}

    ${deliverablesSection(pr)}

    <div class="row between mb-8" style="padding:0 4px">
      <span class="t-head">Actividades</span>
      <button class="btn btn-sm btn-tinted" data-new-activity>${icon('plus', 14)} Nueva</button>
    </div>
    ${acts.length ? byStatus.filter(g => g.list.length).map(g => `
      <div class="mb-16">
        <div class="row g-6 mb-4" style="padding:0 6px">
          <i class="dot" style="background:${STATUSES[g.s].color}"></i>
          <span class="t-cap">${STATUSES[g.s].name}</span>
          <span class="t-cap">· ${g.list.length}</span>
        </div>
        <div class="list">${g.list.map(actRow).join('')}</div>
      </div>`).join('')
      : `<div class="card">${empty('checklist', 'Sin actividades', 'Agrega la primera actividad de este proyecto.',
        `<button class="btn btn-primary mt-8" data-new-activity>${icon('plus', 15)} Nueva actividad</button>`)}</div>`}`;

  return {
    toolbar: toolbar(pr.name, `
      <button class="icon-btn" data-edit-pr aria-label="Editar">${icon('pencil', 17)}</button>
      <button class="btn btn-primary" data-new-activity>${icon('plus', 15)}<span>Actividad</span></button>`,
      pf ? 'portfolio/' + pf.id : 'projects'),
    body,
    mount(root) {
      $('[data-edit-pr]')?.addEventListener('click', () => projectEditor(pr));
      $$('[data-new-activity]').forEach(b => b.onclick = () => activityEditor({ projectId: id }));
      $$('[data-new-sprint]', root).forEach(b => b.onclick = () => sprintSheet(null, { projectId: id }));
      $$('[data-open-sprint]', root).forEach(b => b.onclick = () => {
        app.sprintId = b.dataset.openSprint;
        go('metrics');
      });
      bindDeliverables(root, id);
      bindActivityRows(root);
    }
  };
}

/* ==========================================================================
   Sprints de un proyecto
   ========================================================================== */
function sprintsSection(pr) {
  const hoy = todayISO();
  const list = store.data.sprints
    .filter(s => s.projectId === pr.id)
    .sort((a, b) => (b.start || '').localeCompare(a.start || ''));

  if (!list.length) {
    return `<div class="row between mb-16" style="padding:0 4px">
      <span class="t-sub">${icon('timer', 14)} Sin sprints en este proyecto</span>
      <button class="btn btn-sm btn-gray" data-new-sprint>${icon('plus', 14)} Nuevo sprint</button>
    </div>`;
  }

  return `
    <div class="row between mb-8" style="padding:0 4px">
      <span class="row g-8"><span class="t-head">Sprints</span>
        <span class="badge badge-gray">${list.length}</span></span>
      <button class="btn btn-sm btn-tinted" data-new-sprint>${icon('plus', 14)} Nuevo</button>
    </div>
    <div class="list mb-24">
      ${list.map(s => {
        const vigente = s.start <= hoy && s.end >= hoy;
        const acts = sprintActivities(s, store.activitiesOf(pr.id));
        const st = Stats(acts);
        const dias = vigente ? daysBetween(hoy, s.end) : null;
        return `<button class="list-row" data-open-sprint="${s.id}">
          <span class="col grow" style="align-items:flex-start;min-width:0;gap:3px">
            <span class="row g-6">
              <span style="font-size:14.5px;font-weight:550">${esc(s.name)}</span>
              ${vigente ? `<span class="badge badge-green">En curso · ${dias} d</span>`
                : s.end < hoy ? `<span class="badge badge-gray">Cerrado</span>`
                : `<span class="badge badge-blue">Próximo</span>`}
              ${s.autoFit ? `<span class="badge badge-purple" title="Las fechas siguen a sus actividades">${icon('reset', 10)} auto</span>` : ''}
            </span>
            <span class="t-foot">${fmtDate(s.start)} → ${fmtDate(s.end)} · ${acts.length} actividades · ${st.donePoints}/${st.points} pts</span>
            <span class="progress w-full" style="max-width:240px"><i style="width:${st.pctPoints}%;background:${vigente ? 'var(--green)' : 'var(--gray)'}"></i></span>
          </span>
          <span class="t-foot tnum">${st.pctPoints}%</span>
          ${icon('chevR', 14, 'chev')}
        </button>`;
      }).join('')}
    </div>`;
}

/* ==========================================================================
   Entregables — el registro de logros reales
   ========================================================================== */
function deliverablesSection(pr) {
  const todos = store.deliverablesOf(pr.id);
  const entregables = todos.filter(d => (d.kind || 'entregable') === 'entregable');
  const logrados = entregables.filter(d => d.achieved).length;

  return `
    <div class="row between mb-8" style="padding:0 4px">
      <span class="row g-8">
        <span class="t-head">Entregables</span>
        ${entregables.length ? `<span class="badge badge-gray">${logrados}/${entregables.length} logrados</span>` : ''}
      </span>
      <button class="btn btn-sm btn-tinted" data-new-deliv>${icon('plus', 14)} Nuevo</button>
    </div>

    ${entregables.length ? `<div class="list mb-24">${entregables.map(d => deliverableRow(d)).join('')}</div>`
      : `<div class="card mb-24" style="padding:16px">
          <div class="row g-12">
            ${icon('flag', 20)}
            <span class="col grow">
              <span class="t-head">Sin entregables</span>
              <span class="t-sub">Un entregable es una subtarea que deja un resultado tangible:
              «Bici arreglada», «Contrato firmado». Se crean dentro de una actividad o sueltos aquí,
              y sobre cada uno puedes correr pomodoros.</span>
            </span>
            <button class="btn btn-sm btn-primary" data-new-deliv style="flex:0 0 auto">Crear</button>
          </div>
        </div>`}`;
}

function deliverableRow(d) {
  const acts = store.activitiesOfDeliverable(d.id);
  const hechas = acts.filter(a => a.status === 'done').length;
  const pct = acts.length ? Math.round(hechas / acts.length * 100) : 0;
  const tone = dueTone(d.targetDate, d.achieved ? 'done' : '');
  const dueña = d.activityId ? store.activity(d.activityId) : null;

  return `<div class="list-row">
    <button class="act-check ${d.achieved ? 'done' : ''}" data-achieve="${d.id}"
      aria-label="${d.achieved ? 'Quitar logro' : 'Marcar como logrado'}">${icon('check', 13)}</button>

    <button class="col grow" style="align-items:flex-start;min-width:0;gap:3px;text-align:left"
      data-open-deliv="${d.id}">
      <span class="row g-6 w-full">
        <span class="truncate" style="font-size:14.5px;font-weight:550;${d.achieved ? 'color:var(--label-2)' : ''}">${esc(d.name)}</span>
        ${d.achieved ? `<span class="badge badge-green">${icon('check', 10)} ${fmtDate(d.achievedAt)}</span>` : ''}
      </span>
      <span class="row g-6 wrap" style="font-size:11.5px;color:var(--label-3)">
        ${dueña ? `<span class="row g-4">${icon('checklist', 11)} ${esc(dueña.name)}</span>` : ''}
        ${d.pomosDone ? `<span>🍅 ${d.pomosDone}</span>` : ''}
      </span>
      ${acts.length ? `<span class="row g-6 w-full" style="max-width:220px">
          <span class="progress grow" style="height:4px"><i style="width:${pct}%;background:${d.achieved ? 'var(--green)' : 'var(--blue)'}"></i></span>
          <span class="t-cap tnum">${hechas}/${acts.length}</span>
        </span>` : ''}
    </button>

    ${d.targetDate && !d.achieved
      ? `<span class="badge badge-${tone === 'red' ? 'red' : tone === 'orange' ? 'orange' : 'gray'}">${fmtDue(d.targetDate)}</span>`
      : ''}
    ${!d.achieved ? `<button class="icon-btn accent" data-focus-deliv="${d.id}" title="Enfocar">${icon('timer', 15)}</button>` : ''}
    <button class="icon-btn" data-deliv-menu="${d.id}" aria-label="Opciones">${icon('more', 16)}</button>
  </div>`;
}

function bindDeliverables(root, projectId) {
  $$('[data-new-deliv]', root).forEach(b => b.onclick = () => deliverableEditor({ projectId }));

  $$('[data-achieve]', root).forEach(b => b.onclick = async (e) => {
    e.stopPropagation();
    const d = store.deliverable(b.dataset.achieve);
    if (!d) return;
    if (!await guardar(() => store.achieveDeliverable(d.id, !d.achieved))) return;
    toast(d.achieved ? 'Logro retirado' : `🎉 ¡Logrado: ${d.name}!`, 'ok', 2400);
  });

  $$('[data-open-deliv]', root).forEach(b => b.onclick = () => deliverableDetail(b.dataset.openDeliv));
  $$('[data-edit-deliv]', root).forEach(b => b.onclick = () => deliverableEditor(store.deliverable(b.dataset.editDeliv)));
  $$('[data-focus-deliv]', root).forEach(b => b.onclick = (e) => {
    e.stopPropagation();
    setFocusTarget('deliverable', b.dataset.focusDeliv);
    go('focus');
  });

  $$('[data-deliv-menu]', root).forEach(b => b.onclick = (e) => {
    e.stopPropagation();
    const d = store.deliverable(b.dataset.delivMenu);
    if (!d) return;
    openMenu(b, [
      { label: 'Ver detalle', icon: 'info', onClick: () => deliverableDetail(d.id) },
      { label: 'Editar', icon: 'pencil', onClick: () => deliverableEditor(d) },
      { label: 'Enfocar ahora', icon: 'timer', onClick: () => { setFocusTarget('deliverable', d.id); go('focus'); } },
      { label: d.achieved ? 'Quitar logro' : 'Marcar como logrado', icon: 'check',
        onClick: () => store.achieveDeliverable(d.id, !d.achieved) },
      { label: 'Nueva actividad para esto', icon: 'plus',
        onClick: () => activityEditor({ projectId: d.projectId, deliverableIds: [d.id] }) },
      '-',
      { label: 'Eliminar', icon: 'trash', danger: true, onClick: async () => {
        const n = store.activitiesOfDeliverable(d.id).length;
        if (await confirmSheet({
          title: 'Eliminar entregable',
          message: n ? `Se eliminará «${d.name}». Sus ${n} actividad(es) se conservan, solo pierden el vínculo.`
                     : `Se eliminará «${d.name}».`,
          confirmText: 'Eliminar', danger: true
        })) { await store.deleteDeliverable(d.id); toast('Entregable eliminado', 'ok'); }
      }}
    ]);
  });
}

function deliverableEditor(d = null) {
  const isNew = !d?.id;
  const cur = { name: '', desc: '', targetDate: '', projectId: '', activityId: '', kind: 'entregable', ...d };
  const actsProyecto = store.activitiesOf(cur.projectId);

  openSheet({
    title: isNew ? 'Nueva subtarea' : 'Editar subtarea',
    body: `
      <div class="field"><label>Tipo</label>
        <div class="quad-pick">
          <button type="button" class="quad-opt ${cur.kind === 'entregable' ? 'on' : ''}" data-kind="entregable"
            style="--qc:var(--purple);--qt:var(--purple-t)">
            <b>Entregable</b><span>Produce algo tangible. Cuenta como logro.</span>
          </button>
          <button type="button" class="quad-opt ${cur.kind === 'paso' ? 'on' : ''}" data-kind="paso"
            style="--qc:var(--gray);--qt:var(--gray-t)">
            <b>Paso</b><span>Solo un avance intermedio.</span>
          </button>
        </div></div>

      <div class="field mt-16"><label id="dl-label">¿Qué resultado tangible quieres lograr?</label>
        <input class="input" id="dl-name" value="${esc(cur.name)}"
          placeholder="Ej. Bici arreglada · Contrato firmado · Viaje planeado"></div>
      <p class="t-foot mt-4" id="dl-hint">Escríbelo como un resultado ya conseguido, no como una tarea.</p>

      ${actsProyecto.length ? `
        <div class="field mt-16"><label>Pertenece a la actividad <span class="muted-2">(opcional)</span></label>
          <select class="select" id="dl-activity">
            <option value="">Suelta en el proyecto</option>
            ${actsProyecto.map(a => `<option value="${a.id}" ${cur.activityId === a.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}
          </select></div>` : ''}

      <div class="field mt-16"><label>Descripción <span class="muted-2">(opcional)</span></label>
        <textarea class="textarea" id="dl-desc" placeholder="¿Cómo sabrás que está logrado?">${esc(cur.desc)}</textarea></div>

      <div class="field mt-16"><label>Fecha objetivo <span class="muted-2">(opcional)</span></label>
        <input class="input" type="date" id="dl-date" value="${cur.targetDate || ''}"></div>`,
    footer: `<button class="btn btn-gray" data-x="c">Cancelar</button>
             <button class="btn btn-primary" data-x="s">${isNew ? 'Crear' : 'Guardar'}</button>`,
    onMount(el) {
      let kind = cur.kind;
      const label = $('#dl-label', el), hint = $('#dl-hint', el), nombre = $('#dl-name', el);
      const pintarTipo = () => {
        if (kind === 'paso') {
          label.textContent = '¿Qué paso hay que dar?';
          hint.textContent = 'Un paso avanza la actividad pero no deja un resultado registrable.';
          nombre.placeholder = 'Ej. Llamar al proveedor · Revisar el borrador';
        } else {
          label.textContent = '¿Qué resultado tangible quieres lograr?';
          hint.textContent = 'Escríbelo como un resultado ya conseguido, no como una tarea.';
          nombre.placeholder = 'Ej. Bici arreglada · Contrato firmado · Viaje planeado';
        }
      };
      pintarTipo();
      $$('[data-kind]', el).forEach(b => b.onclick = () => {
        kind = b.dataset.kind;
        $$('[data-kind]', el).forEach(x => x.classList.toggle('on', x === b));
        pintarTipo();
      });

      $('[data-x="c"]', el).onclick = () => closeSheet();
      $('[data-x="s"]', el).onclick = async (ev) => {
        const name = nombre.value.trim();
        if (!name) return toast('Escribe el nombre', 'err');

        const btn = ev.currentTarget;
        btn.disabled = true;
        const ok = await guardar(() => store.saveDeliverable({
          ...(d?.id ? { id: d.id } : {}),   // el resto lo conserva saveDeliverable
          projectId: cur.projectId,
          activityId: $('#dl-activity', el)?.value ?? cur.activityId,
          kind,
          name,
          desc: $('#dl-desc', el).value.trim(),
          targetDate: $('#dl-date', el).value
        }));
        btn.disabled = false;
        if (!ok) return;   // se mantiene abierta para no perder lo escrito
        closeSheet();
        toast(isNew ? 'Subtarea creada' : 'Guardado', 'ok');
      };
    }
  });
}

function projectEditor(pr = null) {
  const isNew = !pr?.id;
  const cur = { name: '', desc: '', color: PALETTE[0], icon: 'briefcase', portfolioId: '', startDate: '', dueDate: '', ...pr };
  const pfs = store.data.portfolios;

  openSheet({
    title: isNew ? 'Nuevo proyecto' : 'Editar proyecto',
    body: `
      <div class="field"><label>Nombre</label>
        <input class="input" id="pr-name" value="${esc(cur.name)}" placeholder="Ej. Portal de clientes"></div>
      <div class="field mt-16"><label>Portafolio</label>
        <select class="select" id="pr-pf">
          <option value="">Sin portafolio</option>
          ${pfs.map(p => `<option value="${p.id}" ${cur.portfolioId === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
        </select></div>
      <div class="field mt-16"><label>Descripción</label>
        <textarea class="textarea" id="pr-desc" placeholder="Objetivo del proyecto">${esc(cur.desc)}</textarea></div>
      <div class="grid grid-2 mt-16" style="gap:12px">
        <div class="field"><label>Inicio</label><input class="input" type="date" id="pr-start" value="${cur.startDate || ''}"></div>
        <div class="field"><label>Fin previsto</label><input class="input" type="date" id="pr-due" value="${cur.dueDate || ''}"></div>
      </div>
      <div class="field mt-16"><label>Color</label>${swatches(cur.color)}</div>
      <div class="field mt-16"><label>Icono</label>${iconPicker(cur.icon)}</div>`,
    footer: `<button class="btn btn-gray" data-x="c">Cancelar</button>
             <button class="btn btn-primary" data-x="s">${isNew ? 'Crear' : 'Guardar'}</button>`,
    onMount(el) {
      bindSwatches(el); bindIconPicker(el);
      $('[data-x="c"]', el).onclick = () => closeSheet();
      $('[data-x="s"]', el).onclick = async (ev) => {
        const name = $('#pr-name', el).value.trim();
        if (!name) return toast('Escribe un nombre', 'err');
        const btn = ev.currentTarget;
        btn.disabled = true;
        const ok = await guardar(() => store.saveProject({
          ...(pr?.id ? { id: pr.id, createdAt: pr.createdAt } : {}),
          name,
          portfolioId: $('#pr-pf', el).value,
          desc: $('#pr-desc', el).value.trim(),
          startDate: $('#pr-start', el).value,
          dueDate: $('#pr-due', el).value,
          color: $('.sw.on', el)?.dataset.color || cur.color,
          icon: $('.ip.on', el)?.dataset.icon || cur.icon,
          status: cur.status || 'active'
        }));
        btn.disabled = false;
        if (!ok) return;
        closeSheet(); toast(isNew ? 'Proyecto creado' : 'Guardado', 'ok');
      };
    }
  });
}

/* ---------- Selectores compartidos ---------- */
function swatches(active) {
  return `<div class="row g-8 wrap">${PALETTE.map(c => `
    <button type="button" class="sw ${c === active ? 'on' : ''}" data-color="${c}"
      style="width:28px;height:28px;border-radius:50%;background:${c};
      box-shadow:${c === active ? `0 0 0 2.5px var(--surface),0 0 0 4.5px ${c}` : 'inset 0 0 0 .5px rgba(0,0,0,.08)'}"></button>`).join('')}</div>`;
}
function bindSwatches(el) {
  $$('.sw', el).forEach(b => b.onclick = () => {
    $$('.sw', el).forEach(x => {
      x.classList.remove('on');
      x.style.boxShadow = 'inset 0 0 0 .5px rgba(0,0,0,.08)';
    });
    b.classList.add('on');
    b.style.boxShadow = `0 0 0 2.5px var(--surface),0 0 0 4.5px ${b.dataset.color}`;
  });
}

function iconPicker(active) {
  return `<div class="row g-6 wrap">${TILE_ICONS.map(i => `
    <button type="button" class="ip ${i === active ? 'on' : ''}" data-icon="${i}"
      style="width:36px;height:36px;border-radius:10px;display:grid;place-items:center;
      background:${i === active ? 'var(--blue)' : 'var(--surface-3)'};
      color:${i === active ? '#fff' : 'var(--label-2)'}">${icon(i, 18)}</button>`).join('')}</div>`;
}
function bindIconPicker(el) {
  $$('.ip', el).forEach(b => b.onclick = () => {
    $$('.ip', el).forEach(x => {
      x.classList.remove('on');
      x.style.background = 'var(--surface-3)'; x.style.color = 'var(--label-2)';
    });
    b.classList.add('on');
    b.style.background = 'var(--blue)'; b.style.color = '#fff';
  });
}

/* ==========================================================================
   Vista: Actividades (lista / matriz / kanban)
   ========================================================================== */
function viewActivities() {
  const f = app.filters;
  let acts = store.data.activities;

  if (f.projectId)   acts = acts.filter(a => a.projectId === f.projectId);
  if (f.portfolioId) {
    const ids = new Set(store.projectsOf(f.portfolioId).map(p => p.id));
    acts = acts.filter(a => ids.has(a.projectId));
  }
  if (f.assignee)  acts = acts.filter(a => (a.assigneeUid || '') === f.assignee);
  if (f.quadrant)  acts = acts.filter(a => a.quadrant === f.quadrant);
  if (f.q) {
    const q = f.q.toLowerCase();
    acts = acts.filter(a => a.name.toLowerCase().includes(q) || (a.notes || '').toLowerCase().includes(q));
  }

  const st = Stats(acts);

  const filterBar = `
    <div class="row g-8 wrap mb-16">
      <div class="search" style="max-width:250px;flex:1">
        ${icon('search', 15)}
        <input id="f-q" placeholder="Buscar actividades" value="${esc(f.q)}">
      </div>
      <select class="select" id="f-project" style="width:auto;min-width:160px;height:32px;padding-block:0;font-size:13px">
        <option value="">Todos los proyectos</option>
        ${store.data.portfolios.map(pf => `
          <optgroup label="${esc(pf.name)}">
            ${store.projectsOf(pf.id).map(p => `<option value="${p.id}" ${f.projectId === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
          </optgroup>`).join('')}
        ${store.data.projects.filter(p => !p.portfolioId).map(p => `<option value="${p.id}" ${f.projectId === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
      </select>
      <select class="select" id="f-assignee" style="width:auto;min-width:140px;height:32px;padding-block:0;font-size:13px">
        <option value="">Cualquier persona</option>
        ${store.data.members.map(m => `<option value="${m.uid}" ${f.assignee === m.uid ? 'selected' : ''}>${esc(m.displayName || m.email)}</option>`).join('')}
      </select>
      ${Object.values(QUADRANTS).map(q => `
        <button class="chip ${f.quadrant === q.key ? 'on' : ''}" data-fq="${q.key}">
          <i class="dot" style="background:${f.quadrant === q.key ? '#fff' : q.color}"></i>${q.key}
        </button>`).join('')}
      ${(f.q || f.projectId || f.assignee || f.quadrant) ? `<button class="btn btn-sm btn-gray" data-clear-filters>Limpiar</button>` : ''}
    </div>`;

  let content = '';
  if (app.actView === 'matrix')      content = matrixHtml(acts);
  else if (app.actView === 'kanban') content = kanbanHtml(acts);
  else                               content = listHtml(acts);

  const body = `
    <div class="page-head">
      <h1>Actividades</h1>
      <p>${st.total} actividad${st.total === 1 ? '' : 'es'} · ${st.done} completadas · ${st.pct}% de avance</p>
    </div>
    ${filterBar}
    ${content}`;

  return {
    wide: app.actView === 'kanban',
    toolbar: toolbar('Actividades', `
      <div class="segmented">
        <button class="${app.actView === 'list' ? 'active' : ''}" data-view="list" title="Lista">${icon('list', 15)}</button>
        <button class="${app.actView === 'matrix' ? 'active' : ''}" data-view="matrix" title="Matriz de Eisenhower">${icon('grid', 15)}</button>
        <button class="${app.actView === 'kanban' ? 'active' : ''}" data-view="kanban" title="Kanban">${icon('columns', 15)}</button>
      </div>
      ${btnNew('Nueva')}`),
    body,
    mount(root) {
      $$('[data-view]').forEach(b => b.onclick = () => { app.actView = b.dataset.view; renderView(); });

      const q = $('#f-q', root);
      q.oninput = debounce(() => { app.filters.q = q.value; renderView(); setTimeout(() => { const n = $('#f-q'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 0); }, 260);
      $('#f-project', root).onchange = (e) => { app.filters.projectId = e.target.value; renderView(); };
      $('#f-assignee', root).onchange = (e) => { app.filters.assignee = e.target.value; renderView(); };
      $$('[data-fq]', root).forEach(b => b.onclick = () => {
        app.filters.quadrant = app.filters.quadrant === b.dataset.fq ? '' : b.dataset.fq;
        renderView();
      });
      $('[data-clear-filters]', root)?.addEventListener('click', () => {
        app.filters = { q: '', projectId: '', portfolioId: '', assignee: '', quadrant: '', status: '' };
        renderView();
      });

      bindActivityRows(root);
      if (app.actView === 'matrix') bindMatrix(root);
      if (app.actView === 'kanban') bindKanban(root);
    }
  };
}

function listHtml(acts) {
  if (!acts.length) return `<div class="card">${empty('checklist', 'Sin resultados', 'Ajusta los filtros o crea una nueva actividad.',
    `<button class="btn btn-primary mt-8" data-new-activity>${icon('plus', 15)} Nueva actividad</button>`)}</div>`;

  const groups = STATUS_ORDER.map(s => ({ s, list: acts.filter(a => a.status === s) })).filter(g => g.list.length);
  return groups.map(g => `
    <div class="mb-16">
      <div class="row g-6 mb-4" style="padding:0 6px">
        <i class="dot" style="background:${STATUSES[g.s].color}"></i>
        <span class="t-cap">${STATUSES[g.s].name}</span>
        <span class="t-cap">· ${g.list.length}</span>
      </div>
      <div class="list">${g.list.map(actRow).join('')}</div>
    </div>`).join('');
}

function matrixHtml(acts) {
  return `<div class="matrix">
    ${Object.values(QUADRANTS).map(q => {
      const list = acts.filter(a => a.quadrant === q.key);
      const openN = list.filter(a => a.status !== 'done').length;
      return `<div class="quad" data-quad="${q.key}" style="--qc:${q.color}">
        <div class="quad-head">
          <div class="row between">
            <div>
              <div class="quad-name" style="color:${q.color}">${q.key} · ${q.name}</div>
              <div class="quad-hint">${q.hint}</div>
            </div>
            <span class="badge badge-${q.key.toLowerCase()}">${openN}</span>
          </div>
        </div>
        <div class="quad-body">
          ${list.length ? list.map(a => {
            const pr = store.project(a.projectId);
            const m = store.member(a.assigneeUid);
            return `<div class="mini" data-drag="${a.id}" data-open-act="${a.id}"
              style="${a.status === 'done' ? 'opacity:.5' : ''}">
              <i class="dot" style="background:${pr?.color || 'var(--gray)'}"></i>
              <span class="grow truncate">${esc(a.name)}</span>
              ${a.dueDate ? `<span class="t-cap">${fmtDue(a.dueDate)}</span>` : ''}
              ${avatar(m, 'sm')}
            </div>`;
          }).join('') : `<div class="t-foot" style="padding:8px 10px">Arrastra actividades aquí</div>`}
        </div>
      </div>`;
    }).join('')}
  </div>`;
}

function bindMatrix(root) {
  $$('.quad', root).forEach(z => makeDropZone(z, z.dataset.quad, async (quad, actId) => {
    await store.setQuadrant(actId, quad);
    toast(`Movida a ${QUADRANTS[quad].name}`, 'ok', 1400);
  }));
  $$('[data-drag]', root).forEach(el => {
    makeDraggable(el, {
      data: el.dataset.drag,
      onDrop: async (quad, actId) => { await store.setQuadrant(actId, quad); toast(`Movida a ${QUADRANTS[quad].name}`, 'ok', 1400); }
    });
    el.onclick = (e) => { if (!el.classList.contains('dragging')) activityDetail(el.dataset.drag); };
  });
}

function kanbanHtml(acts) {
  return `<div class="kanban">
    ${STATUS_ORDER.map(s => {
      const list = acts.filter(a => a.status === s);
      const pts = list.reduce((n, a) => n + (+a.points || 0), 0);
      return `<div class="kcol" data-status="${s}">
        <div class="kcol-head">
          <i class="dot" style="background:${STATUSES[s].color}"></i>
          <span class="kcol-title grow">${STATUSES[s].name}</span>
          <span class="kcol-count">${list.length}${pts ? ` · ${pts}p` : ''}</span>
        </div>
        <div class="kcol-body">
          ${list.map(a => {
            const pr = store.project(a.projectId);
            const m = store.member(a.assigneeUid);
            const q = QUADRANTS[a.quadrant] || QUADRANTS.Q2;
            const tone = dueTone(a.dueDate, a.status);
            return `<div class="kcard" data-drag="${a.id}" style="--qc:${q.color}">
              <div class="kcard-title">${esc(a.name)}</div>
              <div class="kcard-meta">
                <span class="badge badge-${a.quadrant.toLowerCase()}">${a.quadrant}</span>
                ${pr ? `<span class="t-cap row g-4"><i class="dot" style="background:${pr.color}"></i>${esc(pr.name)}</span>` : ''}
              </div>
              <div class="row between">
                <span class="row g-6">
                  ${a.dueDate ? `<span class="badge badge-${tone === 'red' ? 'red' : tone === 'orange' ? 'orange' : 'gray'}">${fmtDue(a.dueDate)}</span>` : ''}
                  ${a.pomosEstimated ? `<span class="t-cap tnum">🍅${a.pomosDone || 0}/${a.pomosEstimated}</span>` : ''}
                </span>
                <span class="row g-6">
                  ${a.points ? `<span class="t-cap tnum">${a.points}p</span>` : ''}
                  ${avatar(m, 'sm')}
                </span>
              </div>
            </div>`;
          }).join('')}
          ${!list.length ? `<div class="t-foot" style="padding:10px;text-align:center">—</div>` : ''}
        </div>
      </div>`;
    }).join('')}
  </div>`;
}

function bindKanban(root) {
  $$('.kcol', root).forEach(z => makeDropZone(z, z.dataset.status, async (status, actId) => {
    await store.setActivityStatus(actId, status);
    toast(`Movida a ${STATUSES[status].name}`, 'ok', 1400);
  }));
  $$('.kcard[data-drag]', root).forEach(el => {
    makeDraggable(el, {
      data: el.dataset.drag,
      onDrop: async (status, actId) => { await store.setActivityStatus(actId, status); toast(`Movida a ${STATUSES[status].name}`, 'ok', 1400); }
    });
    el.onclick = () => { if (!el.classList.contains('dragging')) activityDetail(el.dataset.drag); };
  });
}

/* ==========================================================================
   Editor y detalle de actividad
   ========================================================================== */
function activityEditor(a = null) {
  const isNew = !a?.id;
  const cur = {
    name: '', projectId: '', deliverableIds: [], assigneeUid: store.user?.uid || '', quadrant: 'Q2',
    status: 'todo', points: 3, pomosEstimated: 2, startDate: '', dueDate: '', notes: '', recur: null, ...a
  };
  const pfs = store.data.portfolios;
  const loose = store.data.projects.filter(p => !p.portfolioId);

  openSheet({
    title: isNew ? 'Nueva actividad' : 'Editar actividad',
    size: 'lg',
    body: `
      <div class="field"><label>¿Qué hay que hacer?</label>
        <input class="input" id="a-name" value="${esc(cur.name)}" placeholder="Ej. Diseñar la pantalla de inicio"></div>

      <div class="grid grid-2 mt-16" style="gap:12px">
        <div class="field"><label>Proyecto</label>
          <select class="select" id="a-project">
            <option value="">Sin proyecto</option>
            ${pfs.map(pf => {
              const list = store.projectsOf(pf.id);
              return list.length ? `<optgroup label="${esc(pf.name)}">
                ${list.map(p => `<option value="${p.id}" ${cur.projectId === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
              </optgroup>` : '';
            }).join('')}
            ${loose.length ? `<optgroup label="Sin portafolio">
              ${loose.map(p => `<option value="${p.id}" ${cur.projectId === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
            </optgroup>` : ''}
          </select></div>
        <div class="field"><label>Responsable</label>
          <select class="select" id="a-assignee">
            <option value="">Sin asignar</option>
            ${store.data.members.map(m => `<option value="${m.uid}" ${cur.assigneeUid === m.uid ? 'selected' : ''}>${esc(m.displayName || m.email)}</option>`).join('')}
          </select></div>
      </div>

      <div class="field mt-16"><label>Prioridad — Matriz de Eisenhower</label>
        <div class="quad-pick">
          ${Object.values(QUADRANTS).map(q => `
            <button type="button" class="quad-opt ${cur.quadrant === q.key ? 'on' : ''}" data-q="${q.key}"
              style="--qc:${q.color};--qt:${q.tint}">
              <b>${q.key} · ${q.name}</b><span>${q.hint}</span>
            </button>`).join('')}
        </div></div>

      <div class="grid grid-3 mt-16" style="gap:12px">
        <div class="field"><label>Estado</label>
          <select class="select" id="a-status">
            ${STATUS_ORDER.map(s => `<option value="${s}" ${cur.status === s ? 'selected' : ''}>${STATUSES[s].name}</option>`).join('')}
          </select></div>
        <div class="field"><label>Puntos</label>
          <select class="select" id="a-points">
            ${[1, 2, 3, 5, 8, 13, 21].map(n => `<option value="${n}" ${+cur.points === n ? 'selected' : ''}>${n}</option>`).join('')}
          </select></div>
        <div class="field"><label>Pomodoros est.</label>
          <input class="input" type="number" id="a-pomos" min="0" max="400" value="${cur.pomosEstimated}"></div>
      </div>
      <div class="row between g-8 mt-4" id="a-pomo-hint-row">
        <span class="t-foot grow" id="a-pomo-hint"></span>
        <button type="button" class="btn btn-sm btn-tinted hidden" id="a-pomo-fit">Ajustar</button>
      </div>

      <div class="field mt-16"><label>Se repite</label>
        <select class="select" id="a-recur">
          ${RECUR_OPTIONS.map(o => `<option value="${o.value}" ${(cur.recur?.freq || '') === o.value ? 'selected' : ''}>${o.label}</option>`).join('')}
        </select></div>

      <div class="grid grid-3 mt-16" style="gap:12px">
        <div class="field"><label id="a-start-lbl">Inicio</label>
          <input class="input" type="date" id="a-start" value="${cur.startDate || ''}"></div>
        <div class="field"><label id="a-due-lbl">Fecha límite</label>
          <input class="input" type="date" id="a-due"
            value="${cur.recur?.freq ? (cur.recur.until || '') : (cur.dueDate || '')}"></div>
        <div class="field" id="a-days-wrap"><label>Duración (días)</label>
          <input class="input" type="number" id="a-days" min="1" max="999"
            value="${durationDays(cur.startDate, cur.dueDate) || ''}" placeholder="—"></div>
      </div>
      <p class="t-foot mt-4" id="a-span-hint"></p>

      <div class="field mt-16"><label>Depende de <span class="muted-2">(empieza después de…)</span></label>
        <div id="a-deps"></div></div>

      <div class="field mt-16" id="a-deliv-wrap">
        <label>Entregables a los que contribuye <span class="muted-2">(opcional)</span></label>
        <div id="a-deliverables"></div>
      </div>

      <div class="field mt-16"><label>Notas</label>
        <textarea class="textarea" id="a-notes" placeholder="Contexto, criterios de aceptación, enlaces…">${esc(cur.notes)}</textarea></div>`,
    footer: `<button class="btn btn-gray" data-x="c">Cancelar</button>
             <button class="btn btn-primary" data-x="s">${isNew ? 'Crear actividad' : 'Guardar'}</button>`,
    onMount(el) {
      let quad = cur.quadrant;
      $$('[data-q]', el).forEach(b => b.onclick = () => {
        quad = b.dataset.q;
        $$('[data-q]', el).forEach(x => x.classList.toggle('on', x === b));
      });

      /* Una actividad puede contribuir a varios entregables del proyecto */
      const projSel = $('#a-project', el);
      const delivBox = $('#a-deliverables', el);
      const delivWrap = $('#a-deliv-wrap', el);
      let seleccion = new Set(Store.deliverableIdsOf(cur));

      const fillDeliverables = () => {
        const list = store.deliverablesOf(projSel.value);
        delivWrap.classList.toggle('hidden', !projSel.value || !list.length);
        if (!list.length) return;
        // Al cambiar de proyecto se descartan los que ya no aplican
        seleccion = new Set([...seleccion].filter(id => list.some(d => d.id === id)));
        delivBox.innerHTML = `<div class="list">${list.map(d => `
          <button type="button" class="list-row" data-dl="${d.id}">
            <span class="act-check ${seleccion.has(d.id) ? 'done' : ''}">${icon('check', 13)}</span>
            <span class="grow truncate" style="text-align:left;font-size:14px">${esc(d.name)}</span>
            ${d.achieved ? `<span class="badge badge-green">Logrado</span>` : ''}
          </button>`).join('')}</div>`;
        $$('[data-dl]', delivBox).forEach(b => b.onclick = () => {
          const id = b.dataset.dl;
          seleccion.has(id) ? seleccion.delete(id) : seleccion.add(id);
          $('.act-check', b).classList.toggle('done', seleccion.has(id));
        });
      };
      fillDeliverables();
      projSel.addEventListener('change', fillDeliverables);

      /* Inicio, fin y duración se mantienen coherentes entre sí:
         se edita cualquiera de los tres y los otros se ajustan. */
      const inStart = $('#a-start', el);
      const inDue   = $('#a-due', el);
      const inDays  = $('#a-days', el);
      const inRecur = $('#a-recur', el);
      const hint    = $('#a-span-hint', el);
      const daysWrap = $('#a-days-wrap', el);
      const esRepetitiva = () => !!inRecur.value;

      /* En una serie el inicio es la primera repetición y el otro extremo
         es hasta cuándo se repite, no una duración de trabajo. */
      const pintarHint = () => {
        if (esRepetitiva()) {
          $('#a-start-lbl', el).textContent = 'Primera repetición';
          $('#a-due-lbl', el).textContent = 'Repetir hasta';
          daysWrap.classList.add('hidden');
          const desc = describeRecur({ freq: inRecur.value, interval: 1 });
          if (inStart.value) {
            const fechas = ocurrenciasPrevistas(inRecur.value, inStart.value, inDue.value, 4);
            hint.textContent = `Se repite ${desc} desde el ${fmtDate(inStart.value)}`
              + (inDue.value ? ` hasta el ${fmtDate(inDue.value)}` : ' sin fecha de fin')
              + (fechas.length ? `. Próximas: ${fechas.map(f => fmtDate(f)).join(' · ')}` : '.');
          } else {
            hint.textContent = `Indica la primera repetición: ese día aparecerá en Hoy.`;
          }
          return;
        }
        $('#a-start-lbl', el).textContent = 'Inicio';
        $('#a-due-lbl', el).textContent = 'Fecha límite';
        daysWrap.classList.remove('hidden');
        const n = durationDays(inStart.value, inDue.value);
        if (n) hint.textContent = `${fmtDays(n)} de trabajo, del ${fmtDate(inStart.value)} al ${fmtDate(inDue.value)}.`;
        else if (inDue.value && !inStart.value) hint.textContent = 'Solo hay fecha límite. Agrega el inicio para saber cuántos días tomará.';
        else if (inStart.value && !inDue.value) hint.textContent = 'Indica la duración o la fecha límite.';
        else hint.textContent = '';
      };
      inRecur.addEventListener('change', pintarHint);

      const sincronizarDesdeFechas = () => {
        if (esRepetitiva()) { pintarHint(); return; }   // aquí no hay duración que calcular
        if (inStart.value && inDue.value) {
          if (inDue.value < inStart.value) { inDue.value = inStart.value; }
          inDays.value = durationDays(inStart.value, inDue.value) || '';
        }
        pintarHint();
      };

      inStart.addEventListener('change', () => {
        if (esRepetitiva()) { pintarHint(); return; }
        // Con duración ya fijada, mover el inicio arrastra el fin
        const n = parseInt(inDays.value, 10);
        if (inStart.value && n > 0) inDue.value = addDays(inStart.value, n - 1);
        sincronizarDesdeFechas();
      });
      inDue.addEventListener('change', sincronizarDesdeFechas);
      /* Predecesoras: solo del mismo proyecto y sin formar ciclos */
      const depsBox = $('#a-deps', el);
      let deps = new Set(cur.dependsOn || []);
      const pintarDeps = () => {
        const candidatas = store.activitiesOf(projSel.value)
          .filter(x => x.id !== cur.id && (!cur.id || store.canDependOn(cur.id, x.id)));
        deps = new Set([...deps].filter(id => candidatas.some(c => c.id === id)));
        if (!candidatas.length) {
          depsBox.innerHTML = `<p class="t-foot">No hay otras actividades en este proyecto.</p>`;
          return;
        }
        depsBox.innerHTML = `<div class="list" style="max-height:190px;overflow-y:auto">${candidatas.map(x => `
          <button type="button" class="list-row" data-dep="${x.id}">
            <span class="act-check ${deps.has(x.id) ? 'done' : ''}">${icon('check', 13)}</span>
            <span class="col grow" style="align-items:flex-start;min-width:0;gap:1px">
              <span class="truncate w-full" style="text-align:left;font-size:14px">${esc(x.name)}</span>
              <span class="t-foot">${esc(resumenFechas(x))}</span>
            </span>
          </button>`).join('')}</div>
          <p class="t-foot mt-4">Al mover una predecesora, esta actividad se desplaza con ella.</p>`;
        $$('[data-dep]', depsBox).forEach(b => b.onclick = () => {
          const id = b.dataset.dep;
          if (deps.has(id)) deps.delete(id);
          else {
            deps.add(id);
            /* Sin fechas propias, arranca al día siguiente del cierre real
               de la predecesora: en una serie eso es recur.until, no dueDate. */
            const fin = finDe(store.activity(id));
            if (!inStart.value && fin) {
              inStart.value = addDays(fin, 1);
              const n = parseInt(inDays.value, 10) || 1;
              if (!esRepetitiva()) inDue.value = addDays(inStart.value, n - 1);
              sincronizarDesdeFechas();
            }
          }
          $('.act-check', b).classList.toggle('done', deps.has(id));
        });
      };
      pintarDeps();
      projSel.addEventListener('change', pintarDeps);

      /* La estimación no puede quedar por debajo de lo que exige la
         estructura: cada repetición y cada subtarea piden su pomodoro,
         y lo ya invertido tampoco se puede estimar hacia atrás. */
      const inPomos = $('#a-pomos', el);
      const pomoHint = $('#a-pomo-hint', el);
      const pomoFit = $('#a-pomo-fit', el);

      const pisoActual = () => {
        const subs = cur.id ? store.subtasksOf(cur.id) : [];
        const gastados = cur.id ? store.pomosTotal(store.activity(cur.id)) : 0;
        const freq = inRecur.value;
        const reps = freq && inStart.value && inDue.value
          ? ocurrenciasPrevistas(freq, inStart.value, inDue.value, 400).length
          : 0;
        const partes = [
          { n: reps,        txt: `${reps} repeticiones` },
          { n: subs.length, txt: `${subs.length} subtarea${subs.length === 1 ? '' : 's'}` },
          { n: gastados,    txt: `${gastados} ya invertido${gastados === 1 ? '' : 's'}` }
        ].filter(p => p.n > 0).sort((a2, b2) => b2.n - a2.n);
        return { minimo: partes[0]?.n || 0, detalle: partes.map(p => p.txt).join(' · ') };
      };

      const pintarPomos = () => {
        const { minimo, detalle } = pisoActual();
        const actual = parseInt(inPomos.value, 10) || 0;
        if (!minimo) { pomoHint.textContent = ''; pomoFit.classList.add('hidden'); return; }
        if (actual < minimo) {
          pomoHint.innerHTML = `<span style="color:var(--orange)">Mínimo ${minimo} por su estructura</span> · ${esc(detalle)}`;
          pomoFit.textContent = `Subir a ${minimo}`;
          pomoFit.classList.remove('hidden');
        } else {
          pomoHint.textContent = `Cubre su estructura: ${detalle}`;
          pomoFit.classList.add('hidden');
        }
      };
      pomoFit.onclick = () => { inPomos.value = pisoActual().minimo; pintarPomos(); };
      inPomos.addEventListener('input', pintarPomos);
      inRecur.addEventListener('change', pintarPomos);
      inStart.addEventListener('change', pintarPomos);
      inDue.addEventListener('change', pintarPomos);
      pintarPomos();

      inDays.addEventListener('input', () => {
        const n = clampInt(inDays.value, 1, 999, 0);
        if (!n) { pintarHint(); return; }
        if (!inStart.value && inDue.value)      inStart.value = addDays(inDue.value, -(n - 1));
        else if (inStart.value)                 inDue.value   = addDays(inStart.value, n - 1);
        else { inStart.value = todayISO(); inDue.value = addDays(todayISO(), n - 1); }
        pintarHint();
      });
      pintarHint();

      $('[data-x="c"]', el).onclick = () => closeSheet();
      $('[data-x="s"]', el).onclick = async (ev) => {
        const name = $('#a-name', el).value.trim();
        if (!name) return toast('Escribe el nombre de la actividad', 'err');
        const status = $('#a-status', el).value;
        const freq = inRecur.value;

        /* En una serie el campo de fin es "repetir hasta" y la ocurrencia
           vigente vence el mismo día en que empieza. */
        let inicio = inStart.value;
        let due, recur;
        if (freq) {
          if (!inicio) inicio = todayISO();
          due = inicio;
          recur = withAnchor(
            { ...(cur.recur || {}), freq, interval: cur.recur?.interval || 1, until: inDue.value || '' },
            inicio
          );
        } else {
          due = inDue.value;
          recur = null;
        }

        const btn = ev.currentTarget;
        btn.disabled = true;
        let guardada;
        const ok = await guardar(async () => { guardada = await store.saveActivity({
          ...(a?.id ? { id: a.id, createdAt: a.createdAt, completedAt: a.completedAt } : {}),
          name,
          projectId: projSel.value,
          deliverableIds: [...seleccion],
          dependsOn: [...deps],
          assigneeUid: $('#a-assignee', el).value,
          quadrant: quad,
          status,
          points: +$('#a-points', el).value,
          pomosEstimated: clampInt($('#a-pomos', el).value, 0, 40, 0),
          startDate: inicio,
          dueDate: due,
          notes: $('#a-notes', el).value.trim(),
          recur,
          completedAt: status === 'done' ? (a?.completedAt || nowISO()) : null
        }); });
        btn.disabled = false;
        if (!ok) return;                       // la hoja sigue abierta con los datos
        closeSheet();

        const n = guardada?._movidas?.length || 0;
        const sp = guardada?._sprints || [];
        const partes = [];
        if (n) { const d = guardada._delta;
          partes.push(`${n} dependiente${n === 1 ? '' : 's'} ${d > 0 ? '+' : ''}${d} días`); }
        if (sp.length) partes.push(`${sp.length} sprint${sp.length === 1 ? '' : 's'} reencuadrado${sp.length === 1 ? '' : 's'}`);
        toast(partes.length ? `Guardado · ${partes.join(' · ')}`
                            : (isNew ? 'Actividad creada' : 'Cambios guardados'), 'ok', partes.length ? 4200 : 2600);
      };
    }
  });
}

function activityDetail(id) {
  const render = () => {
    const a = store.activity(id);
    if (!a) { closeSheet(); return; }
    const pr = store.project(a.projectId);
    const pf = pr ? store.portfolio(pr.portfolioId) : null;
    const m = store.member(a.assigneeUid);
    const q = QUADRANTS[a.quadrant] || QUADRANTS.Q2;
    const hist = store.historyFor(id);
    const pct = a.pomosEstimated ? Math.min(1, (a.pomosDone || 0) / a.pomosEstimated) : 0;

    return `
      <div class="col g-16">
        <div>
          <div class="t-title" style="line-height:1.3">${esc(a.name)}</div>
          <div class="t-foot mt-4">${pf ? esc(pf.name) + ' › ' : ''}${pr ? esc(pr.name) : 'Sin proyecto'}</div>
        </div>

        <div class="row g-6 wrap">
          <span class="badge badge-${a.quadrant.toLowerCase()}">${q.key} · ${q.name}</span>
          <span class="badge badge-gray"><i class="dot" style="background:${STATUSES[a.status].color}"></i>${STATUSES[a.status].name}</span>
          ${a.points ? `<span class="badge badge-blue">${a.points} puntos</span>` : ''}
          ${a.dueDate ? `<span class="badge badge-${dueTone(a.dueDate, a.status) === 'red' ? 'red' : 'gray'}">${icon('calendar', 11)} ${fmtDate(a.dueDate)} · ${fmtDue(a.dueDate)}</span>` : ''}
          ${(() => { const n = durationDays(a.startDate, a.dueDate);
            return n ? `<span class="badge badge-purple">${icon('clock', 11)} ${fmtDays(n)}</span>` : ''; })()}
        </div>

        ${a.recur ? `
          <div class="list">
            <div class="list-row">
              <span class="grow t-sub">Se repite</span>
              <span style="font-size:13.5px">${esc(describeRecur(a.recur))}${a.recur.until ? ` · hasta ${fmtDate(a.recur.until)}` : ''}</span>
            </div>
          </div>`
        : a.startDate && a.dueDate ? `
          <div class="list">
            <div class="list-row">
              <span class="grow t-sub">Ventana de trabajo</span>
              <span style="font-size:13.5px">${fmtDate(a.startDate)} → ${fmtDate(a.dueDate)}</span>
            </div>
          </div>` : ''}

        ${(() => {
          const pre = store.predecessorsOf(a.id);
          const suc = store.successorsOf(a.id);
          if (!pre.length && !suc.length) return '';
          const fila = (x, ic, rol) => `<button class="list-row" data-dep-go="${x.id}">
            ${icon(ic, 15)}
            <span class="col grow" style="align-items:flex-start;min-width:0;gap:1px">
              <span class="truncate w-full" style="text-align:left;font-size:14px">${esc(x.name)}</span>
              <span class="t-foot">${esc(resumenFechas(x))}</span>
            </span>
            <span class="badge badge-gray">${rol}</span>
          </button>`;
          return `<div>
            <div class="section-label">Encadenamiento</div>
            <div class="list">
              ${pre.map(x => fila(x, 'arrowUp', 'Antes')).join('')}
              ${suc.map(x => fila(x, 'arrowDown', 'Después')).join('')}
            </div>
            <p class="t-foot mt-4">
              ${pre.length ? `Empieza después de ${pre.length} actividad${pre.length === 1 ? '' : 'es'}. ` : ''}
              ${suc.length ? `Al mover esta, ${suc.length} se desplaza${suc.length === 1 ? '' : 'n'} con ella.` : ''}
            </p>
          </div>`;
        })()}

        <div class="list">
          <div class="list-row">
            <span class="grow t-sub">Responsable</span>
            <span class="row g-8">${avatar(m, 'sm')}<span style="font-size:13.5px">${m ? esc(m.displayName || m.email) : 'Sin asignar'}</span></span>
            <button class="btn btn-sm btn-tinted" data-d="assign">Cambiar</button>
          </div>
          <div class="list-row">
            <span class="grow t-sub">Estado</span>
            <span style="font-size:13.5px">${STATUSES[a.status].name}</span>
            <button class="btn btn-sm btn-tinted" data-d="status">Mover</button>
          </div>
          ${(() => {
            const total = store.pomosTotal(a);
            const deSubs = total - (a.pomosDone || 0);
            const piso = store.pomoFloor(a);
            const est = a.pomosEstimated || 0;
            if (!est && !total && !piso.minimo) return '';
            const p = est ? Math.min(1, total / est) : 0;
            return `<div class="list-row">
              <span class="col grow" style="align-items:flex-start;gap:2px">
                <span class="t-sub">Pomodoros</span>
                ${deSubs ? `<span class="t-cap">${a.pomosDone || 0} propio${(a.pomosDone || 0) === 1 ? '' : 's'} + ${deSubs} de subtareas</span>` : ''}
                ${est && piso.minimo > est ? `<span class="t-cap" style="color:var(--orange)">Mínimo ${piso.minimo}: ${esc(piso.razon)}</span>` : ''}
              </span>
              <span class="row g-8" style="width:130px">
                <span class="tnum t-foot">${total}${est ? '/' + est : ''}</span>
                ${est ? `<span class="progress grow"><i style="width:${p * 100}%;background:var(--red)"></i></span>` : ''}
              </span>
            </div>`;
          })()}
        </div>

        ${(() => {
          const subs = store.subtasksOf(a.id);
          const hechas = subs.filter(s => s.achieved).length;
          return `<div>
            <div class="section-label">Subtareas${subs.length ? ` · ${hechas}/${subs.length}` : ''}</div>
            ${subs.length ? `
              <div class="progress progress-sm mb-8"><i style="width:${subs.length ? hechas / subs.length * 100 : 0}%;background:var(--green)"></i></div>
              <div class="list mb-8">${subs.map(s => `
                <div class="list-row">
                  <button class="act-check ${s.achieved ? 'done' : ''}" data-sub-done="${s.id}"
                    aria-label="Completar subtarea">${icon('check', 13)}</button>
                  <button class="col grow" style="align-items:flex-start;min-width:0;gap:1px" data-sub-open="${s.id}">
                    <span class="truncate w-full" style="text-align:left;font-size:14px;${s.achieved ? 'color:var(--label-3);text-decoration:line-through' : ''}">${esc(s.name)}</span>
                    <span class="row g-6" style="font-size:11px;color:var(--label-3)">
                      <span class="badge ${s.kind === 'paso' ? 'badge-gray' : 'badge-purple'}">${s.kind === 'paso' ? 'Paso' : 'Entregable'}</span>
                      ${s.pomosDone ? `<span>🍅 ${s.pomosDone}</span>` : ''}
                      ${s.targetDate ? `<span>${fmtDue(s.targetDate)}</span>` : ''}
                    </span>
                  </button>
                  <button class="icon-btn accent" data-sub-focus="${s.id}" title="Enfocar">${icon('timer', 15)}</button>
                </div>`).join('')}</div>` : ''}
            <div class="row g-8">
              <input class="input grow" id="d-subtask" placeholder="Agregar subtarea y pulsar Enter…">
              <button class="btn btn-primary" data-d="addsub">${icon('plus', 15)}</button>
            </div>
            <p class="t-foot mt-4">Se crea como entregable. Cámbialo a «paso» si no produce nada tangible.</p>
          </div>`;
        })()}

        ${(() => {
          const otros = store.deliverablesOfActivity(a).filter(d => d.activityId !== a.id);
          if (!otros.length) return '';
          return `<div>
            <div class="section-label">Contribuye a</div>
            <div class="list">${otros.map(d => `
              <button class="list-row" data-sub-open="${d.id}">
                <span class="act-check ${d.achieved ? 'done' : ''}" style="pointer-events:none">${icon('check', 13)}</span>
                <span class="grow truncate" style="text-align:left">${esc(d.name)}</span>
                ${d.achieved ? `<span class="badge badge-green">${fmtDate(d.achievedAt)}</span>` : ''}
              </button>`).join('')}</div>
          </div>`;
        })()}

        ${a.notes ? `<div><div class="section-label">Notas</div><div class="tl-note" style="margin-top:0">${esc(a.notes)}</div></div>` : ''}

        <div>
          <div class="section-label">Comentario</div>
          <div class="row g-8">
            <input class="input" id="d-comment" placeholder="Deja una nota para el equipo…">
            <button class="btn btn-primary" data-d="comment">${icon('plus', 15)}</button>
          </div>
        </div>

        <div>
          <div class="section-label">Historial · ${hist.length} evento${hist.length === 1 ? '' : 's'}</div>
          ${hist.length ? `<div class="timeline">${hist.map(historyItem).join('')}</div>`
            : `<p class="t-foot">Sin eventos registrados.</p>`}
        </div>
      </div>`;
  };

  /* Solo lo que vive dentro de .sheet-body, que se regenera en cada refresco. */
  const bindBody = (el) => {
    $('[data-d="assign"]', el)?.addEventListener('click', async () => { closeSheet(); await assignSheet(id); activityDetail(id); });
    $('[data-d="status"]', el)?.addEventListener('click', async () => { closeSheet(); await statusSheet(id); activityDetail(id); });

    const ci = $('#d-comment', el);
    const send = async () => {
      const v = ci.value.trim();
      if (!v) return;
      await store.comment(id, v);
      refresh();
      toast('Comentario agregado', 'ok', 1400);
    };
    $('[data-d="comment"]', el)?.addEventListener('click', send);
    ci?.addEventListener('keydown', e => { if (e.key === 'Enter') send(); });

    /* --- Subtareas --- */
    const si = $('#d-subtask', el);
    const addSub = async () => {
      const v = si.value.trim();
      if (!v) return;
      const a = store.activity(id);
      const ok = await guardar(() => store.saveDeliverable({
        activityId: id, projectId: a?.projectId || '', name: v, kind: 'entregable'
      }));
      if (!ok) return;
      si.value = '';
      refresh();
    };
    $('[data-d="addsub"]', el)?.addEventListener('click', addSub);
    si?.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addSub(); } });

    $$('[data-sub-done]', el).forEach(b => b.onclick = async () => {
      const s = store.deliverable(b.dataset.subDone);
      if (!s) return;
      if (!await guardar(() => store.achieveDeliverable(s.id, !s.achieved))) return;
      refresh();
      if (!s.achieved) toast(`🎉 ${s.name}`, 'ok', 1800);
    });

    $$('[data-sub-open]', el).forEach(b => b.onclick = () => { closeSheet(); deliverableDetail(b.dataset.subOpen); });

    $$('[data-sub-focus]', el).forEach(b => b.onclick = () => {
      setFocusTarget('deliverable', b.dataset.subFocus);
      closeSheet(); go('focus');
    });

    $$('[data-dep-go]', el).forEach(b => b.onclick = () => { closeSheet(); activityDetail(b.dataset.depGo); });
  };

  /* El pie NO se regenera: se vincula una sola vez para no duplicar listeners. */
  const bindFooter = (sheetEl) => {
    $('[data-d="edit"]', sheetEl)?.addEventListener('click', () => { closeSheet(); activityEditor(store.activity(id)); });
    $('[data-d="focus"]', sheetEl)?.addEventListener('click', () => { setFocusTarget('activity', id); closeSheet(); go('focus'); });
    $('[data-d="done"]', sheetEl)?.addEventListener('click', async () => {
      const a = store.activity(id);
      if (!a) return;
      await store.setActivityStatus(id, a.status === 'done' ? 'todo' : 'done');
      refresh();
    });
  };

  const refresh = () => {
    const bodyEl = $('.sheet-body');
    if (!bodyEl) return;
    bodyEl.innerHTML = render();
    bindBody(bodyEl);
    const a = store.activity(id);
    const fb = $('[data-d="done"]');
    if (fb && a) fb.innerHTML = `${icon('check', 15)} ${a.status === 'done' ? 'Reabrir' : 'Completar'}`;
  };

  const a0 = store.activity(id);
  if (!a0) return;

  openSheet({
    title: 'Detalle',
    size: 'lg',
    body: render(),
    footer: `
      <button class="btn btn-gray" data-d="edit">${icon('pencil', 15)} Editar</button>
      <button class="btn btn-gray" data-d="focus">${icon('timer', 15)} Enfocar</button>
      <button class="btn btn-primary" data-d="done">${icon('check', 15)} ${a0.status === 'done' ? 'Reabrir' : 'Completar'}</button>`,
    onMount(sheetEl) {
      bindBody($('.sheet-body', sheetEl));
      bindFooter(sheetEl);
    }
  });
}

function historyItem(h) {
  const M = {
    created:  { ic: 'plus',    color: 'var(--blue)',   tint: 'var(--blue-t)' },
    status:   { ic: 'columns', color: 'var(--purple)', tint: 'var(--purple-t)' },
    assign:   { ic: 'user',    color: 'var(--teal)',   tint: 'var(--teal-t)' },
    quadrant: { ic: 'grid',    color: 'var(--orange)', tint: 'var(--orange-t)' },
    due:      { ic: 'calendar',color: 'var(--gray)',   tint: 'var(--gray-t)' },
    rename:   { ic: 'pencil',  color: 'var(--gray)',   tint: 'var(--gray-t)' },
    pomodoro: { ic: 'timer',   color: 'var(--red)',    tint: 'var(--red-t)' },
    comment:  { ic: 'comment', color: 'var(--green)',  tint: 'var(--green-t)' }
  };
  const cfg = M[h.type] || M.created;
  const who = (h.userName || '').split(' ')[0] || 'Alguien';
  const nameOf = (uid) => store.member(uid)?.displayName?.split(' ')[0] || (uid ? 'alguien' : 'nadie');

  let text = '';
  switch (h.type) {
    case 'created':  text = `<b>${esc(who)}</b> creó la actividad`; break;
    case 'status':   text = `<b>${esc(who)}</b> movió de <b>${STATUSES[h.from]?.name || h.from}</b> a <b>${STATUSES[h.to]?.name || h.to}</b>`; break;
    case 'assign':   text = h.to ? `<b>${esc(who)}</b> asignó a <b>${esc(nameOf(h.to))}</b>` : `<b>${esc(who)}</b> quitó la asignación`; break;
    case 'quadrant': text = `<b>${esc(who)}</b> cambió la prioridad a <b>${QUADRANTS[h.to]?.name || h.to}</b>`; break;
    case 'due':      text = h.to ? `<b>${esc(who)}</b> fijó la fecha límite en <b>${fmtDate(h.to)}</b>` : `<b>${esc(who)}</b> quitó la fecha límite`; break;
    case 'rename':   text = `<b>${esc(who)}</b> renombró la actividad`; break;
    case 'pomodoro': text = `<b>${esc(who)}</b> completó un pomodoro <span class="muted-2">(${esc(h.text || '')})</span>`; break;
    case 'comment':  text = `<b>${esc(who)}</b> comentó`; break;
    default:         text = `<b>${esc(who)}</b> actualizó la actividad`;
  }

  return `<div class="tl-item">
    <span class="tl-dot" style="background:${cfg.tint};color:${cfg.color}">${icon(cfg.ic, 13)}</span>
    <div class="tl-body">
      <div class="tl-text">${text}</div>
      ${h.type === 'comment' && h.text ? `<div class="tl-note">${esc(h.text)}</div>` : ''}
      ${h.type === 'rename' && h.from ? `<div class="tl-meta">antes: «${esc(h.from)}»</div>` : ''}
      <div class="tl-meta">${fmtAgo(h.ts)} · ${fmtTime(h.ts)}</div>
    </div>
  </div>`;
}

function assignSheet(id) {
  const a = store.activity(id);
  return openSheet({
    title: 'Asignar actividad',
    body: `<div class="list">
      <button class="list-row" data-u="">
        ${avatar(null, 'md')}<span class="grow">Sin asignar</span>
        ${!a.assigneeUid ? icon('check', 16) : ''}
      </button>
      ${store.data.members.map(m => `
        <button class="list-row" data-u="${m.uid}">
          ${avatar(m, 'md')}
          <span class="col grow" style="align-items:flex-start;min-width:0">
            <span style="font-size:14px">${esc(m.displayName || m.email)}</span>
            <span class="t-foot truncate">${esc(m.email || '')}</span>
          </span>
          ${a.assigneeUid === m.uid ? icon('check', 16) : ''}
        </button>`).join('')}
    </div>`,
    onMount(el) {
      $$('[data-u]', el).forEach(b => b.onclick = async () => {
        await store.setAssignee(id, b.dataset.u);
        closeSheet();
        toast('Responsable actualizado', 'ok', 1500);
      });
    }
  });
}

function statusSheet(id) {
  const a = store.activity(id);
  return openSheet({
    title: 'Mover actividad',
    body: `<div class="list">
      ${STATUS_ORDER.map(s => `
        <button class="list-row" data-s="${s}">
          <i class="dot dot-lg" style="background:${STATUSES[s].color}"></i>
          <span class="grow">${STATUSES[s].name}</span>
          ${a.status === s ? icon('check', 16) : ''}
        </button>`).join('')}
    </div>`,
    onMount(el) {
      $$('[data-s]', el).forEach(b => b.onclick = async () => {
        await store.setActivityStatus(id, b.dataset.s);
        closeSheet();
        toast(`Movida a ${STATUSES[b.dataset.s].name}`, 'ok', 1500);
      });
    }
  });
}

/* ==========================================================================
   Vista: Métricas
   ========================================================================== */
function viewMetrics() {
  const scope = app.metricScope;
  let acts = store.data.activities;
  let scopeName = 'Todo el espacio';

  if (scope.startsWith('pf:')) {
    const pf = store.portfolio(scope.slice(3));
    if (pf) { acts = store.activitiesOfPortfolio(pf.id); scopeName = pf.name; }
  } else if (scope.startsWith('pr:')) {
    const pr = store.project(scope.slice(3));
    if (pr) { acts = store.activitiesOf(pr.id); scopeName = pr.name; }
  }

  const st = Stats(acts);
  const today = todayISO();

  /* --- Sprint activo --- */
  const sprints = store.data.sprints;
  const sprint = sprints.find(s => s.id === app.sprintId) || sprints[0] || null;

  /* --- Ventana de 14 días --- */
  const days14 = Array.from({ length: 14 }, (_, i) => addDays(today, i - 13));
  const doneByDay = days14.map(d => acts.filter(a => a.completedAt && dayKey(a.completedAt) === d).length);
  const minsByDay = days14.map(d =>
    store.data.sessions.filter(s => dayKey(s.endedAt) === d).reduce((n, s) => n + (s.minutes || 0), 0));

  /* --- Semana actual vs anterior --- */
  const inRange = (iso, from, to) => iso && dayKey(iso) >= from && dayKey(iso) <= to;
  const wStart = addDays(today, -6), pStart = addDays(today, -13), pEnd = addDays(today, -7);
  const doneThisWeek = acts.filter(a => inRange(a.completedAt, wStart, today));
  const donePrevWeek = acts.filter(a => inRange(a.completedAt, pStart, pEnd));
  const ptsThis = doneThisWeek.reduce((n, a) => n + (+a.points || 0), 0);
  const ptsPrev = donePrevWeek.reduce((n, a) => n + (+a.points || 0), 0);
  const trend = ptsPrev === 0 ? (ptsThis > 0 ? 100 : 0) : Math.round((ptsThis - ptsPrev) / ptsPrev * 100);

  /* --- Puntualidad --- */
  const withDue = acts.filter(a => a.status === 'done' && a.dueDate && a.completedAt);
  const onTime = withDue.filter(a => dayKey(a.completedAt) <= a.dueDate).length;
  const onTimePct = withDue.length ? Math.round(onTime / withDue.length * 100) : 100;

  /* --- Vencidas --- */
  const overdue = acts.filter(a => a.status !== 'done' && a.dueDate && a.dueDate < today);

  /* --- Distribución Eisenhower --- */
  const quadSegs = Object.values(QUADRANTS).map(q => ({
    label: q.key,
    value: acts.filter(a => a.quadrant === q.key).length,
    color: { Q1: '#FF3B30', Q2: '#007AFF', Q3: '#FF9500', Q4: '#8E8E93' }[q.key],
    name: q.name
  }));

  /* --- Carga por persona --- */
  const load = store.data.members.map(m => {
    const mine = acts.filter(a => a.assigneeUid === m.uid);
    const openN = mine.filter(a => a.status !== 'done').length;
    return { m, total: mine.length, open: openN, done: mine.length - openN,
             pts: mine.filter(a => a.status !== 'done').reduce((n, a) => n + (+a.points || 0), 0) };
  }).filter(x => x.total > 0).sort((a, b) => b.open - a.open);
  const maxLoad = Math.max(1, ...load.map(x => x.open));

  /* --- Estado por proyecto --- */
  const projRows = store.data.projects.map(pr => {
    const list = store.activitiesOf(pr.id);
    return { pr, st: Stats(list), late: list.filter(a => a.status !== 'done' && a.dueDate && a.dueDate < today).length };
  }).filter(r => r.st.total > 0).sort((a, b) => b.st.total - a.st.total);

  /* --- Datos del burndown --- */
  const bd = buildBurndown(acts, sprint);

  const trendCls = trend > 3 ? 'up' : trend < -3 ? 'down' : 'flat';
  const trendIc  = trend > 3 ? 'arrowUp' : trend < -3 ? 'arrowDown' : 'dot';

  const body = `
    <div class="page-head"><h1>Métricas</h1><p>${esc(scopeName)} · ${st.total} actividades</p></div>

    <div class="row g-8 wrap mb-16">
      <select class="select" id="m-scope" style="width:auto;min-width:200px;height:32px;padding-block:0;font-size:13px">
        <option value="all">Todo el espacio</option>
        ${store.data.portfolios.map(pf => `<option value="pf:${pf.id}" ${scope === 'pf:' + pf.id ? 'selected' : ''}>📁 ${esc(pf.name)}</option>`).join('')}
        ${store.data.projects.map(pr => `<option value="pr:${pr.id}" ${scope === 'pr:' + pr.id ? 'selected' : ''}>— ${esc(pr.name)}</option>`).join('')}
      </select>
    </div>

    <div class="grid grid-stats mb-16">
      <div class="stat">
        <span class="stat-label">Avance general</span>
        <span class="stat-value">${st.pct}%</span>
        <div class="progress progress-sm mt-4"><i style="width:${st.pct}%"></i></div>
        <span class="stat-sub">${st.done} de ${st.total} actividades</span>
      </div>
      <div class="stat">
        <span class="stat-label">Puntos esta semana</span>
        <span class="stat-value">${ptsThis}</span>
        <span class="stat-trend ${trendCls}">${icon(trendIc, 12)} ${trend > 0 ? '+' : ''}${trend}% vs. semana previa</span>
      </div>
      <div class="stat">
        <span class="stat-label">Entrega a tiempo</span>
        <span class="stat-value" style="color:${onTimePct >= 80 ? 'var(--green)' : onTimePct >= 50 ? 'var(--orange)' : 'var(--red)'}">${onTimePct}%</span>
        <span class="stat-sub">${onTime} de ${withDue.length} con fecha</span>
      </div>
      <div class="stat">
        <span class="stat-label">Vencidas</span>
        <span class="stat-value" style="color:${overdue.length ? 'var(--red)' : 'inherit'}">${overdue.length}</span>
        <span class="stat-sub">${st.open} abiertas en total</span>
      </div>
    </div>

    <div class="grid grid-2 mb-16">
      <div class="card">
        <div class="card-head">
          <span class="card-title">Burndown</span>
          <div class="row g-6">
            ${sprints.length ? `<select class="select" id="m-sprint" style="width:auto;max-width:170px;height:28px;padding-block:0;font-size:12px">
              ${sprints.map(s => `<option value="${s.id}" ${sprint?.id === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}
            </select>` : ''}
            ${sprint ? `<button class="icon-btn" id="m-sprint-edit" aria-label="Configurar este sprint">${icon('gear', 16)}</button>` : ''}
            <button class="icon-btn accent" id="m-sprint-new" aria-label="Nuevo sprint" title="Nuevo sprint">${icon('plus', 17)}</button>
          </div>
        </div>
        ${sprint ? `
          <div class="row g-6 wrap mb-8">
            <span class="badge badge-gray">${icon('calendar', 11)} ${fmtDate(sprint.start)} → ${fmtDate(sprint.end)}</span>
            <span class="badge badge-blue">${icon('target', 11)} ${esc(sprintScopeLabel(sprint))}</span>
          </div>
          <div class="chart-box"><canvas id="c-burndown"></canvas></div>
          <div class="legend mt-8">
            <span class="legend-item"><i class="legend-swatch" style="background:var(--gray)"></i>Ideal</span>
            <span class="legend-item"><i class="legend-swatch" style="background:var(--blue)"></i>Real</span>
            <span class="legend-item grow" style="justify-content:flex-end">
              ${bd.status === 'ahead' ? `<span class="badge badge-green">Adelantados ${Math.abs(bd.delta)} pts</span>`
                : bd.status === 'behind' ? `<span class="badge badge-red">Retrasados ${Math.abs(bd.delta)} pts</span>`
                : `<span class="badge badge-blue">En ritmo</span>`}
            </span>
          </div>
          <div class="row g-16 mt-12 wrap">
            <span class="t-foot">Restante: <b class="tnum">${bd.remaining}</b> pts</span>
            <span class="t-foot">Velocidad: <b class="tnum">${bd.velocity}</b> pts/día</span>
            <span class="t-foot">Días restantes: <b class="tnum">${bd.daysLeft}</b></span>
            <span class="t-foot">Proyección: <b>${bd.forecast}</b></span>
          </div>`
          : empty('chart', 'Sin sprint definido',
              'Un sprint es un periodo con fechas. Puedes acotarlo a un proyecto o elegir actividades concretas.',
              `<button class="btn btn-primary mt-8" id="m-sprint-new2">${icon('plus', 15)} Crear sprint</button>`)}
      </div>

      <div class="card">
        <div class="card-head"><span class="card-title">Matriz de Eisenhower</span></div>
        <div class="row g-16" style="align-items:center">
          <div class="chart-box" style="width:160px;flex:0 0 160px">
            <canvas id="c-quad"></canvas>
          </div>
          <div class="col g-8 grow">
            ${quadSegs.map(s => {
              const pct = st.total ? Math.round(s.value / st.total * 100) : 0;
              return `<div class="col g-4">
                <div class="row between t-foot">
                  <span class="row g-6"><i class="legend-swatch round" style="background:${s.color}"></i>${s.label} · ${esc(s.name)}</span>
                  <span class="tnum">${s.value} <span class="muted-2">(${pct}%)</span></span>
                </div>
                <div class="progress progress-sm"><i style="width:${pct}%;background:${s.color}"></i></div>
              </div>`;
            }).join('')}
          </div>
        </div>
        ${quadSegs[0].value > st.total * 0.4 && st.total > 4 ? `
          <div class="banner banner-warn mt-12">${icon('warning', 16)}
            <span>Demasiadas urgencias (Q1). Intenta mover trabajo a Q2 planificando con anticipación.</span></div>` : ''}
      </div>
    </div>

    <div class="grid grid-2 mb-16">
      <div class="card">
        <div class="card-head"><span class="card-title">Actividades completadas · 14 días</span>
          <span class="t-foot">${doneByDay.reduce((a, b) => a + b, 0)} total</span></div>
        <div class="chart-box"><canvas id="c-throughput"></canvas></div>
      </div>
      <div class="card">
        <div class="card-head"><span class="card-title">Tiempo enfocado · 14 días</span>
          <span class="t-foot">${fmtDuration(minsByDay.reduce((a, b) => a + b, 0))}</span></div>
        ${store.listenerErrors?.sessions ? `
          <div class="banner banner-warn">${icon('warning', 16)}
            <span>${esc(store.listenerErrors.sessions.message)}</span></div>`
        : store.data.sessions.length === 0 ? `
          <div class="col center g-8" style="padding:26px 12px;text-align:center">
            ${icon('timer', 30, 'muted-2')}
            <span class="t-head muted">Sin sesiones registradas</span>
            <span class="t-sub" style="max-width:300px">Cada pomodoro que completes en
            <b>Foco</b> queda aquí. Solo cuentan los que llegan al final del tiempo:
            saltarlos con ⏭ no los registra.</span>
            <button class="btn btn-sm btn-tinted mt-4" data-go="focus">${icon('timer', 14)} Ir a Foco</button>
          </div>`
        : `<div class="chart-box"><canvas id="c-focus"></canvas></div>`}
      </div>
    </div>

    ${(() => {
      const conVentana = acts.filter(a => a.startDate && a.dueDate && a.status !== 'done');
      if (!conVentana.length) return '';
      /* Próximos 21 días: cuántas actividades caen sobre cada uno.
         Es lo que revela los días sobrecargados antes de que lleguen. */
      const dias = Array.from({ length: 21 }, (_, i) => addDays(today, i));
      const carga = dias.map(d => conVentana.filter(a => a.startDate <= d && a.dueDate >= d).length);
      const pico = Math.max(...carga);
      const diaPico = dias[carga.indexOf(pico)];
      const ocupados = carga.filter(n => n > 0).length;
      return `<div class="card mb-16">
        <div class="card-head">
          <span class="card-title">Actividades en curso por día · 21 días</span>
          <span class="t-foot">${ocupados} días ocupados · pico de ${pico}</span>
        </div>
        <div class="chart-box"><canvas id="c-carga"></canvas></div>
        ${pico >= 5 ? `<div class="banner banner-warn mt-8">${icon('warning', 16)}
          <span>El ${fmtDate(diaPico)} tienes ${pico} actividades solapadas. Considera escalonarlas.</span></div>` : ''}
      </div>`;
    })()}

    <div class="grid grid-2">
      <div class="card">
        <div class="card-head"><span class="card-title">Carga por persona</span></div>
        ${load.length ? `<div class="col g-12">${load.map(x => `
          <div class="col g-6">
            <div class="row g-8">
              ${avatar(x.m, 'sm')}
              <span class="grow truncate" style="font-size:13.5px">${esc(x.m.displayName || x.m.email)}</span>
              <span class="t-foot tnum">${x.open} abiertas · ${x.pts} pts</span>
            </div>
            <div class="hbar">
              <div class="hbar-track">
                <div class="hbar-fill" style="width:${x.open / maxLoad * 100}%;background:${colorFor(x.m.displayName || x.m.email)}"></div>
              </div>
              <span class="t-cap tnum" style="width:38px;text-align:right">${x.done}/${x.total}</span>
            </div>
          </div>`).join('')}</div>` : `<p class="t-sub">Nadie tiene actividades asignadas todavía.</p>`}
      </div>

      <div class="card card-pad-0">
        <div class="row between" style="padding:16px 18px 10px">
          <span class="card-title">Estado por proyecto</span>
        </div>
        ${projRows.length ? `<div>${projRows.map(r => `
          <button class="list-row" data-go="project/${r.pr.id}">
            <i class="dot dot-lg" style="background:${r.pr.color}"></i>
            <span class="col grow" style="align-items:flex-start;min-width:0;gap:3px">
              <span class="truncate w-full" style="font-size:13.5px;font-weight:520;text-align:left">${esc(r.pr.name)}</span>
              <span class="progress w-full"><i style="width:${r.st.pct}%;background:${r.pr.color}"></i></span>
            </span>
            <span class="col" style="align-items:flex-end;gap:1px">
              <span class="t-foot tnum">${r.st.pct}%</span>
              ${r.late ? `<span class="badge badge-red">${r.late} vencida${r.late === 1 ? '' : 's'}</span>` : `<span class="t-cap">${r.st.open} abiertas</span>`}
            </span>
            ${icon('chevR', 14, 'chev')}
          </button>`).join('')}</div>` : `<div style="padding:0 18px 18px"><p class="t-sub">Sin proyectos con actividades.</p></div>`}
      </div>
    </div>`;

  return {
    body,
    toolbar: toolbar('Métricas'),
    mount(root) {
      $('#m-scope', root).onchange = (e) => { app.metricScope = e.target.value; renderView(); };
      $('#m-sprint', root)?.addEventListener('change', (e) => { app.sprintId = e.target.value; renderView(); });
      $('#m-sprint-edit', root)?.addEventListener('click', () => sprintSheet(sprint));
      $$('#m-sprint-new, #m-sprint-new2', root).forEach(b => b.onclick = () => sprintSheet(null));

      const dayLabels = days14.map(d => d.slice(8) + '/' + d.slice(5, 7));

      /* Se dibuja de forma síncrona: requestAnimationFrame no corre en
         pestañas ocultas y dejaría las gráficas en blanco. */
      const paint = () => {
        const cb = $('#c-burndown');
        if (cb && sprint) Chart.burndown(cb, bd.chart, 250);

        const cq = $('#c-quad');
        if (cq) Chart.donut(cq, quadSegs, 160, String(st.total), 'actividades');

        const ct = $('#c-throughput');
        if (ct) Chart.bars(ct, { labels: dayLabels, values: doneByDay, color: '#34C759' }, 200);

        const cf = $('#c-focus');   // ausente cuando no hay sesiones que mostrar
        if (cf) Chart.area(cf, { labels: dayLabels, values: minsByDay, color: '#FF3B30' }, 200);

        const cc = $('#c-carga');   // solo si hay actividades con duración
        if (cc) {
          const conVentana = acts.filter(a => a.startDate && a.dueDate && a.status !== 'done');
          const dias = Array.from({ length: 21 }, (_, i) => addDays(today, i));
          Chart.bars(cc, {
            labels: dias.map(d => d.slice(8) + '/' + d.slice(5, 7)),
            values: dias.map(d => conVentana.filter(a => a.startDate <= d && a.dueDate >= d).length),
            color: '#5856D6'
          }, 200);
        }
      };

      paint();
      // Segundo pase por si el layout aún no estaba estabilizado
      setTimeout(paint, 60);
    }
  };
}

/**
 * Actividades que cuentan para un sprint.
 * Prioridad: selección explícita → proyecto del sprint → alcance de la vista.
 */
function sprintActivities(sprint, fallbackActs) {
  if (!sprint) return [];
  if (sprint.activityIds?.length) {
    return sprint.activityIds.map(id => store.activity(id)).filter(Boolean);
  }
  if (sprint.projectId) return store.activitiesOf(sprint.projectId);
  return fallbackActs;
}

/** Texto legible del alcance de un sprint */
function sprintScopeLabel(sprint) {
  if (!sprint) return '';
  if (sprint.activityIds?.length) return `${sprint.activityIds.length} actividades elegidas`;
  if (sprint.projectId) return store.project(sprint.projectId)?.name || 'Proyecto eliminado';
  return 'Todo el espacio';
}

/* ---------- Cálculo del burndown ---------- */
function buildBurndown(fallbackActs, sprint) {
  const today = todayISO();
  if (!sprint) return { chart: { labels: [], ideal: [], actual: [], todayIdx: -1 }, remaining: 0, velocity: 0, daysLeft: 0, delta: 0, status: 'ok', forecast: '—' };

  const acts = sprintActivities(sprint, fallbackActs);
  const start = sprint.start, end = sprint.end;
  const n = Math.max(1, daysBetween(start, end)) + 1;
  const days = Array.from({ length: n }, (_, i) => addDays(start, i));

  /* Con selección explícita se respeta tal cual; si no, se descartan las
     creadas después del cierre del sprint. */
  const inSprint = sprint.activityIds?.length ? acts : acts.filter(a => {
    const created = a.createdAt ? dayKey(a.createdAt) : start;
    return created <= end;
  });
  const total = inSprint.reduce((s, a) => s + (+a.points || 0), 0);

  const ideal = days.map((_, i) => Math.max(0, total - (total / Math.max(1, n - 1)) * i));

  const todayIdx = days.indexOf(today);
  const actual = days.map((d, i) => {
    if (todayIdx >= 0 && i > todayIdx) return null;
    if (d > today) return null;
    const burned = inSprint
      .filter(a => a.completedAt && dayKey(a.completedAt) <= d)
      .reduce((s, a) => s + (+a.points || 0), 0);
    return Math.max(0, total - burned);
  });

  const lastIdx = actual.reduce((last, v, i) => (v != null ? i : last), 0);
  const remaining = actual[lastIdx] ?? total;
  const idealNow = ideal[lastIdx] ?? total;
  const delta = Math.round(idealNow - remaining);
  const status = delta > 1 ? 'ahead' : delta < -1 ? 'behind' : 'ok';

  const elapsed = Math.max(1, lastIdx);
  const velocity = +((total - remaining) / elapsed).toFixed(1);
  const daysLeft = Math.max(0, daysBetween(today, end));

  let forecast = '—';
  if (remaining === 0) forecast = 'Completado';
  else if (velocity <= 0) forecast = 'Sin avance';
  else {
    const need = Math.ceil(remaining / velocity);
    forecast = need <= daysLeft ? `A tiempo (${need} d)` : `${need - daysLeft} d de retraso`;
  }

  return {
    chart: { labels: days.map(d => d.slice(8) + '/' + d.slice(5, 7)), ideal, actual, todayIdx },
    remaining: Math.round(remaining), velocity, daysLeft, delta, status, forecast
  };
}

function sprintSheet(sprint, preset = {}) {
  const isNew = !sprint?.id;
  const cur = {
    name: `Sprint ${store.data.sprints.length + 1}`,
    start: todayISO(), end: addDays(todayISO(), 13),
    projectId: '', activityIds: [], autoFit: false,
    ...preset, ...sprint
  };

  const pfs = store.data.portfolios;
  const sueltos = store.data.projects.filter(p => !p.portfolioId);

  openSheet({
    title: isNew ? 'Nuevo sprint' : 'Configurar sprint',
    size: 'lg',
    body: `
      <div class="field"><label>Nombre</label>
        <input class="input" id="sp-name" value="${esc(cur.name)}" placeholder="Ej. Semana del 10"></div>

      <div class="list mt-16">
        ${toggleRow('sp-auto', 'Ajustar fechas a sus actividades', cur.autoFit,
          'El sprint encuadra su alcance y se reajusta cuando alguna se mueve')}
      </div>
      <p class="t-foot mt-4" id="sp-auto-hint"></p>

      <div class="grid grid-2 mt-16" style="gap:12px">
        <div class="field"><label>Inicio</label><input class="input" type="date" id="sp-start" value="${cur.start}"></div>
        <div class="field"><label>Fin</label><input class="input" type="date" id="sp-end" value="${cur.end}"></div>
      </div>

      <div class="field mt-16"><label>Alcance</label>
        <select class="select" id="sp-project">
          <option value="">Todo el espacio</option>
          ${pfs.map(pf => {
            const list = store.projectsOf(pf.id);
            return list.length ? `<optgroup label="${esc(pf.name)}">
              ${list.map(p => `<option value="${p.id}" ${cur.projectId === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
            </optgroup>` : '';
          }).join('')}
          ${sueltos.length ? `<optgroup label="Sin portafolio">
            ${sueltos.map(p => `<option value="${p.id}" ${cur.projectId === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
          </optgroup>` : ''}
        </select></div>

      <div class="field mt-16">
        <div class="row between">
          <label style="margin:0">Actividades incluidas</label>
          <span class="row g-6">
            <button type="button" class="btn btn-sm btn-gray" id="sp-none">Ninguna</button>
            <button type="button" class="btn btn-sm btn-gray" id="sp-all">Todas</button>
          </span>
        </div>
        <p class="t-foot mt-4" id="sp-hint"></p>
        <div id="sp-acts" style="max-height:260px;overflow-y:auto"></div>
      </div>`,
    footer: `${!isNew ? `<button class="btn btn-danger" data-x="d">Eliminar</button>` : ''}
             <button class="btn btn-gray" data-x="c">Cancelar</button>
             <button class="btn btn-primary" data-x="s">${isNew ? 'Crear' : 'Guardar'}</button>`,
    onMount(el) {
      const projSel = $('#sp-project', el);
      const box = $('#sp-acts', el);
      const hint = $('#sp-hint', el);
      let seleccion = new Set(cur.activityIds || []);

      const candidatas = () => {
        const pid = projSel.value;
        return store.data.activities.filter(a => (!pid || a.projectId === pid) && a.status !== 'done');
      };

      const pintar = () => {
        const list = candidatas();
        hint.textContent = seleccion.size
          ? `${seleccion.size} seleccionada(s). El burndown contará solo estas.`
          : 'Ninguna marcada: el burndown incluirá todas las del alcance.';
        if (!list.length) {
          box.innerHTML = `<p class="t-sub">No hay actividades abiertas en este alcance.</p>`;
          return;
        }
        box.innerHTML = `<div class="list">${list.map(a => {
          const pr = store.project(a.projectId);
          return `<button type="button" class="list-row" data-sa="${a.id}">
            <span class="act-check ${seleccion.has(a.id) ? 'done' : ''}">${icon('check', 13)}</span>
            <span class="col grow" style="align-items:flex-start;min-width:0;gap:1px">
              <span class="truncate w-full" style="text-align:left;font-size:14px">${esc(a.name)}</span>
              <span class="t-foot truncate w-full" style="text-align:left">
                ${pr ? esc(pr.name) : 'Sin proyecto'}${a.dueDate ? ' · ' + fmtDue(a.dueDate) : ''}
              </span>
            </span>
            <span class="badge badge-${a.quadrant.toLowerCase()}">${a.quadrant}</span>
            ${a.points ? `<span class="t-cap tnum">${a.points}p</span>` : ''}
          </button>`;
        }).join('')}</div>`;
        $$('[data-sa]', box).forEach(b => b.onclick = () => {
          const id = b.dataset.sa;
          seleccion.has(id) ? seleccion.delete(id) : seleccion.add(id);
          $('.act-check', b).classList.toggle('done', seleccion.has(id));
          hint.textContent = seleccion.size
            ? `${seleccion.size} seleccionada(s). El burndown contará solo estas.`
            : 'Ninguna marcada: el burndown incluirá todas las del alcance.';
          pintarAuto();
        });
      };

      /* Con ajuste automático, las fechas las mandan las actividades */
      const swAuto = $('#sp-auto', el);
      const autoHint = $('#sp-auto-hint', el);
      const inIni = $('#sp-start', el), inFin = $('#sp-end', el);

      const pintarAuto = () => {
        const auto = swAuto.classList.contains('on');
        inIni.disabled = inFin.disabled = auto;
        inIni.style.opacity = inFin.style.opacity = auto ? '.55' : '';
        if (!auto) { autoHint.textContent = 'Las fechas se fijan a mano.'; return; }
        const w = store.sprintWindow({ projectId: projSel.value, activityIds: [...seleccion] });
        if (w) {
          inIni.value = w.start; inFin.value = w.end;
          autoHint.textContent = `Encuadrado a sus actividades: ${fmtDate(w.start)} → ${fmtDate(w.end)}. Se reajusta solo cuando alguna se mueva.`;
        } else {
          autoHint.textContent = 'Ninguna actividad del alcance tiene fechas todavía.';
        }
      };
      bindToggles(el, () => pintarAuto());

      pintar();
      pintarAuto();
      projSel.addEventListener('change', () => {
        // Al cambiar de alcance se descartan las que ya no aplican
        const validas = new Set(candidatas().map(a => a.id));
        seleccion = new Set([...seleccion].filter(id => validas.has(id)));
        pintar();
        pintarAuto();
      });
      $('#sp-all', el).onclick = () => { seleccion = new Set(candidatas().map(a => a.id)); pintar(); };
      $('#sp-none', el).onclick = () => { seleccion = new Set(); pintar(); };

      $('[data-x="c"]', el).onclick = () => closeSheet();
      $('[data-x="d"]', el)?.addEventListener('click', async () => {
        if (await confirmSheet({ title: 'Eliminar sprint', message: 'Esta acción no afecta las actividades.', confirmText: 'Eliminar', danger: true })) {
          if (await guardar(() => store.deleteSprint(sprint.id))) {
            app.sprintId = ''; closeSheet(); toast('Sprint eliminado', 'ok'); renderView();
          }
        }
      });
      $('[data-x="s"]', el).onclick = async (ev) => {
        const start = $('#sp-start', el).value, end = $('#sp-end', el).value;
        if (!start || !end || end < start) return toast('Revisa las fechas', 'err');
        const btn = ev.currentTarget;
        btn.disabled = true;
        let rec;
        const ok = await guardar(async () => {
          rec = await store.saveSprint({
            ...(sprint?.id ? { id: sprint.id, createdAt: sprint.createdAt } : {}),
            name: $('#sp-name', el).value.trim() || 'Sprint',
            start, end,
            autoFit: swAuto.classList.contains('on'),
            projectId: projSel.value,
            activityIds: [...seleccion]
          });
        });
        btn.disabled = false;
        if (!ok) return;
        app.sprintId = rec.id;
        closeSheet(); toast(isNew ? 'Sprint creado' : 'Sprint guardado', 'ok'); renderView();
      };
    }
  });
}

/* ==========================================================================
   Vista: Prácticas
   ========================================================================== */
app.pracTab = 'diagnostico';   // diagnostico | biblioteca | ruta
app.pracFw = '';               // filtro por marco

/* El estado de adopción vive en las preferencias locales.
   Cuando se agreguen registros de riesgos e interesados se migrará
   a Firestore junto con el resto de la estructura. */
const adopted = () => store.prefs.adoptedPractices || {};
function toggleAdopt(id) {
  const cur = { ...adopted() };
  cur[id] = !cur[id];
  store.savePrefs({ adoptedPractices: cur });
}

function viewPractices() {
  const diag = diagnose(store);
  const ad = adopted();
  const nAdopted = PRACTICES.filter(p => ad[p.id]).length;

  let content = '';
  if (app.pracTab === 'diagnostico')      content = diagnosticoHtml(diag);
  else if (app.pracTab === 'biblioteca')  content = bibliotecaHtml(ad);
  else                                    content = rutaHtml(ad);

  const body = `
    <div class="page-head">
      <h1>Prácticas</h1>
      <p>Alinea tu forma de trabajar con marcos probados, a tu ritmo</p>
    </div>

    <div class="segmented mb-16">
      <button class="${app.pracTab === 'diagnostico' ? 'active' : ''}" data-ptab="diagnostico">Diagnóstico</button>
      <button class="${app.pracTab === 'biblioteca' ? 'active' : ''}" data-ptab="biblioteca">Biblioteca</button>
      <button class="${app.pracTab === 'ruta' ? 'active' : ''}" data-ptab="ruta">Ruta</button>
    </div>

    ${content}`;

  return {
    toolbar: toolbar('Prácticas', `<span class="t-foot">${nAdopted}/${PRACTICES.length} adoptadas</span>`),
    body,
    mount(root) {
      $$('[data-ptab]', root).forEach(b => b.onclick = () => { app.pracTab = b.dataset.ptab; renderView(); });
      $$('[data-pfw]', root).forEach(b => b.onclick = () => {
        app.pracFw = app.pracFw === b.dataset.pfw ? '' : b.dataset.pfw;
        renderView();
      });
      $$('[data-practice]', root).forEach(b => b.onclick = (e) => {
        if (e.target.closest('[data-adopt]')) return;
        practiceSheet(b.dataset.practice);
      });
      $$('[data-adopt]', root).forEach(b => b.onclick = (e) => {
        e.stopPropagation();
        toggleAdopt(b.dataset.adopt);
        renderView();
      });
      $$('[data-goto-practice]', root).forEach(b => b.onclick = () => practiceSheet(b.dataset.gotoPractice));
    }
  };
}

/* ---------- Pestaña: Diagnóstico ---------- */
function diagnosticoHtml(diag) {
  if (diag.empty) {
    return `<div class="card">${empty('beaker', 'Aún no hay suficiente información',
      'Crea algunas actividades y vuelve: el diagnóstico se calcula sobre tus datos reales, no sobre teoría.')}</div>`;
  }

  const sl = scoreLabel(diag.score);
  const bySev = { alta: [], media: [], baja: [] };
  diag.findings.forEach(f => bySev[f.sev].push(f));
  const sevMeta = {
    alta:  { label: 'Atender pronto', color: 'var(--red)',    badge: 'badge-red' },
    media: { label: 'Conviene revisar', color: 'var(--orange)', badge: 'badge-orange' },
    baja:  { label: 'Mejora menor',   color: 'var(--gray)',   badge: 'badge-gray' }
  };

  return `
    <div class="card mb-16">
      <div class="row g-20 wrap">
        <div class="row g-16" style="flex:0 0 auto">
          <div class="rel" style="width:96px;height:96px">
            ${ring(diag.score / 100, 96, 8, sl.color)}
            <div class="col center" style="position:absolute;inset:0">
              <span style="font-size:26px;font-weight:700;letter-spacing:-.03em">${diag.score}</span>
              <span class="t-cap">de 100</span>
            </div>
          </div>
          <div class="col g-4">
            <span class="t-title-3" style="color:${sl.color}">${sl.text}</span>
            <span class="t-sub" style="max-width:230px">
              ${diag.findings.length === 0
                ? 'No se detectaron problemas en los 14 chequeos.'
                : `${diag.findings.length} de ${diag.checks} chequeos encontraron algo.`}
            </span>
          </div>
        </div>
        <div class="grow" style="min-width:200px">
          <p class="t-sub">Este puntaje se calcula con tus datos reales: fechas, responsables, tamaño
          de las actividades, equilibrio de la matriz y cadencia. No mide cuánto trabajas,
          mide qué tan predecible es tu forma de trabajar.</p>
        </div>
      </div>
    </div>

    ${diag.findings.length === 0
      ? `<div class="card">${empty('check', 'Todo en orden',
          'Ninguno de los chequeos encontró problemas. Mira la Ruta para el siguiente nivel.')}</div>`
      : ['alta', 'media', 'baja'].filter(s => bySev[s].length).map(s => `
        <div class="mb-16">
          <div class="row g-8 mb-8" style="padding:0 4px">
            <i class="dot dot-lg" style="background:${sevMeta[s].color}"></i>
            <span class="t-head">${sevMeta[s].label}</span>
            <span class="badge badge-gray">${bySev[s].length}</span>
          </div>
          <div class="col g-10">
            ${bySev[s].map(f => findingCard(f, sevMeta[s])).join('')}
          </div>
        </div>`).join('')}`;
}

function findingCard(f, meta) {
  const fw = FRAMEWORKS[f.framework];
  const pr = practiceById(f.practice);
  return `<div class="card" style="border-left:3px solid ${meta.color}">
    <div class="row between g-12 mb-8">
      <span class="t-title-3 grow">${esc(f.title)}</span>
      <span class="badge" style="background:${fw.tint};color:${fw.color}">${fw.short}</span>
    </div>
    <div class="tl-note mb-8" style="margin-top:0"><b>Evidencia:</b> ${esc(f.evidence)}</div>
    <p class="t-sub mb-8">${esc(f.meaning)}</p>
    <div class="row between g-12 wrap">
      <span class="t-body" style="flex:1;min-width:200px"><b>Qué hacer:</b> ${esc(f.action)}</span>
      ${pr ? `<button class="btn btn-sm btn-tinted" data-goto-practice="${pr.id}">
        ${icon('book', 14)} ${esc(pr.name)}</button>` : ''}
    </div>
  </div>`;
}

/* ---------- Pestaña: Biblioteca ---------- */
function bibliotecaHtml(ad) {
  const list = app.pracFw ? PRACTICES.filter(p => p.framework === app.pracFw) : PRACTICES;
  const domains = [...new Set(list.map(p => p.domain))];

  return `
    <div class="row g-6 wrap mb-16">
      <button class="chip ${!app.pracFw ? 'on' : ''}" data-pfw="">Todos</button>
      ${Object.values(FRAMEWORKS).map(f => `
        <button class="chip ${app.pracFw === f.id ? 'on' : ''}" data-pfw="${f.id}">
          <i class="dot" style="background:${app.pracFw === f.id ? '#fff' : f.color}"></i>${f.name}
        </button>`).join('')}
    </div>

    ${domains.map(d => `
      <div class="mb-16">
        <div class="section-label">${esc(d)}</div>
        <div class="grid grid-2">
          ${list.filter(p => p.domain === d).map(p => practiceCard(p, ad)).join('')}
        </div>
      </div>`).join('')}`;
}

function practiceCard(p, ad) {
  const fw = FRAMEWORKS[p.framework];
  const on = !!ad[p.id];
  return `<div class="tile" data-practice="${p.id}" style="cursor:pointer">
    <div class="row between g-8">
      <span class="row g-6 wrap">
        <span class="badge" style="background:${fw.tint};color:${fw.color}">${fw.short}</span>
        <span class="badge badge-gray">Nivel ${p.level}</span>
        ${p.planned ? `<span class="badge badge-purple">En el plan</span>` : ''}
      </span>
      <button class="icon-btn ${on ? 'accent' : ''}" data-adopt="${p.id}"
        title="${on ? 'Adoptada' : 'Marcar como adoptada'}"
        style="${on ? 'background:var(--green-t);color:var(--green)' : ''}">
        ${icon('check', 16)}
      </button>
    </div>
    <div>
      <div class="tile-name">${esc(p.name)}</div>
      <div class="t-sub mt-4">${esc(p.summary)}</div>
    </div>
  </div>`;
}

/* ---------- Pestaña: Ruta ---------- */
function rutaHtml(ad) {
  return `
    <div class="banner banner-info mb-16">
      ${icon('info', 17)}
      <span>La ruta va de la higiene básica al rigor de proyectos complejos. No hace falta
      completar un nivel para tocar el siguiente, pero saltarse el primero suele salir caro.</span>
    </div>

    ${Object.values(LEVELS).map(lv => {
      const list = practicesByLevel(lv.id);
      const done = list.filter(p => ad[p.id]).length;
      const pct = Math.round(done / list.length * 100);
      const color = lv.id === 1 ? 'var(--green)' : lv.id === 2 ? 'var(--blue)' : 'var(--purple)';
      return `<div class="card mb-16">
        <div class="row between g-12 mb-4">
          <span class="row g-8">
            <span class="tile-icon" style="background:${color};width:30px;height:30px;border-radius:9px;font-size:13px;font-weight:700">${lv.id}</span>
            <span class="t-title-3">${esc(lv.name)}</span>
          </span>
          <span class="t-foot tnum">${done}/${list.length}</span>
        </div>
        <p class="t-sub mb-12">${esc(lv.hint)}</p>
        <div class="progress mb-12"><i style="width:${pct}%;background:${color}"></i></div>
        <div class="list">
          ${list.map(p => {
            const fw = FRAMEWORKS[p.framework];
            const on = !!ad[p.id];
            return `<div class="list-row" data-practice="${p.id}" style="cursor:pointer">
              <button class="act-check ${on ? 'done' : ''}" data-adopt="${p.id}"
                aria-label="Marcar como adoptada">${icon('check', 13)}</button>
              <span class="col grow" style="align-items:flex-start;min-width:0;gap:1px">
                <span style="font-size:14px;font-weight:500;${on ? 'color:var(--label-2)' : ''}">${esc(p.name)}</span>
                <span class="t-foot truncate w-full" style="text-align:left">${esc(p.summary)}</span>
              </span>
              <span class="badge" style="background:${fw.tint};color:${fw.color}">${fw.short}</span>
              ${icon('chevR', 14, 'chev')}
            </div>`;
          }).join('')}
        </div>
      </div>`;
    }).join('')}`;
}

/* ---------- Detalle de una práctica ---------- */
function practiceSheet(id) {
  const p = practiceById(id);
  if (!p) return;
  const fw = FRAMEWORKS[p.framework];
  const on = !!adopted()[p.id];

  openSheet({
    title: p.name,
    size: 'lg',
    body: `
      <div class="row g-6 wrap mb-16">
        <span class="badge" style="background:${fw.tint};color:${fw.color}">${fw.name}</span>
        <span class="badge badge-gray">Nivel ${p.level} · ${esc(LEVELS[p.level].name)}</span>
        <span class="badge badge-gray">${esc(p.domain)}</span>
        ${p.inApp ? `<span class="badge badge-green">Ya soportado</span>` : ''}
        ${p.planned ? `<span class="badge badge-purple">En el plan</span>` : ''}
      </div>

      <p class="t-body mb-16" style="font-size:16px;line-height:1.5">${esc(p.summary)}</p>

      <div class="section-label">Por qué importa</div>
      <p class="t-body mb-16" style="line-height:1.55">${esc(p.why)}</p>

      <div class="section-label">Cómo aplicarlo hoy en PomoMomo</div>
      <div class="tl-note mb-16" style="margin-top:0">${esc(p.how)}</div>

      ${p.signals?.length ? `
        <div class="section-label">Señales de que te hace falta</div>
        <div class="list mb-16">
          ${p.signals.map(s => `<div class="list-row">
            ${icon('warning', 15)}<span class="grow t-sub">${esc(s)}</span>
          </div>`).join('')}
        </div>` : ''}`,
    footer: `
      <button class="btn btn-gray" data-x="c">Cerrar</button>
      <button class="btn ${on ? 'btn-gray' : 'btn-primary'}" data-x="a">
        ${icon('check', 15)} ${on ? 'Quitar de adoptadas' : 'Marcar como adoptada'}
      </button>`,
    onMount(el) {
      $('[data-x="c"]', el).onclick = () => closeSheet();
      $('[data-x="a"]', el).onclick = () => {
        toggleAdopt(p.id);
        closeSheet();
        renderView();
        toast(on ? 'Quitada de adoptadas' : 'Práctica adoptada', 'ok', 1600);
      };
    }
  });
}

/* ==========================================================================
   Vista: Equipo
   ========================================================================== */
function viewTeam() {
  const members = store.data.members;
  const acts = store.data.activities;

  const body = `
    <div class="page-head"><h1>Equipo</h1><p>Personas con acceso a este espacio de trabajo</p></div>

    ${store.mode === 'local' ? `<div class="banner banner-warn mb-16">
      ${icon('cloudOff', 17)}<span class="grow">El trabajo en equipo requiere Firebase configurado.</span>
      <button class="btn btn-sm btn-gray" data-go="settings">Configurar</button></div>` : ''}

    <div class="list mb-24">
      ${members.map(m => {
        const mine = acts.filter(a => a.assigneeUid === m.uid);
        const openN = mine.filter(a => a.status !== 'done').length;
        const isMe = m.uid === store.user?.uid;
        return `<div class="list-row">
          ${avatar(m, 'lg')}
          <span class="col grow" style="align-items:flex-start;min-width:0;gap:1px">
            <span class="row g-6">
              <span style="font-size:14.5px;font-weight:550">${esc(m.displayName || m.email)}</span>
              ${isMe ? `<span class="badge badge-blue">Tú</span>` : ''}
              ${m.role === 'owner' ? `<span class="badge badge-purple">Propietario</span>` : ''}
            </span>
            <span class="t-foot truncate">${esc(m.email || 'Sin correo')}</span>
          </span>
          <span class="col" style="align-items:flex-end;gap:1px">
            <span class="t-foot tnum">${openN} abiertas</span>
            <span class="t-cap">${mine.length - openN} completadas</span>
          </span>
          ${store.isOwner && !isMe ? `<button class="icon-btn" data-rm="${m.uid}">${icon('more', 16)}</button>` : ''}
        </div>`;
      }).join('')}
    </div>

    ${store.mode === 'cloud' ? `
      <div class="card">
        <div class="card-head"><span class="card-title">Invitar a alguien</span></div>
        <p class="t-sub mb-12">Escribe el correo de Google de la persona. Al iniciar sesión entrará directo a este espacio.</p>
        <div class="row g-8">
          <input class="input grow" id="inv-email" type="email" placeholder="persona@empresa.com">
          <button class="btn btn-primary" id="inv-btn">${icon('plus', 15)} Invitar</button>
        </div>
      </div>` : ''}`;

  return {
    toolbar: toolbar('Equipo'),
    body,
    mount(root) {
      $('#inv-btn', root)?.addEventListener('click', async () => {
        const email = $('#inv-email', root).value.trim();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return toast('Correo no válido', 'err');
        try {
          await store.invite(email);
          $('#inv-email', root).value = '';
          toast('Invitación creada', 'ok');
        } catch (e) { toast(e.message || 'No se pudo invitar', 'err'); }
      });
      $$('[data-rm]', root).forEach(b => b.onclick = () => openMenu(b, [
        { label: 'Quitar del espacio', icon: 'trash', danger: true, onClick: async () => {
          if (await confirmSheet({ title: 'Quitar miembro', message: 'Perderá el acceso al espacio de trabajo.', confirmText: 'Quitar', danger: true })) {
            await store.removeMember(b.dataset.rm); toast('Miembro removido', 'ok');
          }
        }}
      ]));
    }
  };
}

/* ==========================================================================
   Vista: Ajustes
   ========================================================================== */
function viewSettings() {
  const p = store.prefs;
  const d = store.data;

  const body = `
    <div class="page-head"><h1>Ajustes</h1><p>Configuración de la aplicación y los datos</p></div>

    <div class="card mb-16">
      <div class="card-head"><span class="card-title">Almacenamiento</span></div>
      <div class="row g-12">
        <span class="tile-icon" style="background:${store.mode === 'cloud' ? 'var(--green)' : 'var(--orange)'};width:42px;height:42px">
          ${icon(store.mode === 'cloud' ? 'cloud' : 'cloudOff', 21)}
        </span>
        <div class="col grow">
          <span class="t-head">${store.mode === 'cloud' ? 'Firebase conectado' : 'Modo local'}</span>
          <span class="t-sub">${store.mode === 'cloud'
            ? 'Los datos se sincronizan en tiempo real entre tus dispositivos y tu equipo.'
            : 'Los datos se guardan solo en este navegador. Edita js/config.js para conectar Firebase.'}</span>
        </div>
      </div>
      ${store.mode === 'local' ? `
        <div class="banner banner-info mt-12">
          ${icon('info', 16)}
          <span>Abre <b>js/config.js</b>, pega tu <b>firebaseConfig</b> y recarga la página.</span>
        </div>` : ''}

      ${Object.keys(store.listenerErrors || {}).length ? `
        <div class="banner banner-warn mt-12" style="align-items:flex-start">
          ${icon('warning', 16)}
          <span class="col g-4 grow">
            <b>Hay colecciones que no se pueden leer</b>
            ${Object.entries(store.listenerErrors).map(([k, v]) =>
              `<span>· ${esc(v.message)} <span class="t-cap">(${esc(v.code)})</span></span>`).join('')}
          </span>
        </div>` : ''}
    </div>

    <div class="card mb-16">
      <div class="card-head"><span class="card-title">Temporizador</span>
        <button class="btn btn-sm btn-tinted" id="open-timer">Configurar</button></div>
      <div class="row g-16 wrap">
        <span class="t-sub">Enfoque <b>${p.focus} min</b></span>
        <span class="t-sub">Pausa corta <b>${p.short} min</b></span>
        <span class="t-sub">Pausa larga <b>${p.long} min</b></span>
        <span class="t-sub">Cada <b>${p.longEvery}</b> pomodoros</span>
      </div>
    </div>

    <div class="card mb-16">
      <div class="card-head"><span class="card-title">Datos</span></div>
      <div class="grid grid-stats mb-16" style="gap:10px">
        ${[['Portafolios', d.portfolios.length], ['Proyectos', d.projects.length],
           ['Actividades', d.activities.length], ['Entregables', d.deliverables.length],
           ['Pomodoros', d.sessions.length], ['Eventos', d.history.length]].map(([k, v]) => `
          <div class="stat" style="box-shadow:none;background:var(--surface-2)">
            <span class="stat-label">${k}</span><span class="stat-value" style="font-size:21px">${v}</span>
          </div>`).join('')}
      </div>
      <div class="row g-8 wrap">
        <button class="btn btn-gray" id="btn-export">${icon('download', 15)} Exportar JSON</button>
        <button class="btn btn-gray" id="btn-seed">${icon('sparkles', 15)} Cargar datos de ejemplo</button>
        <button class="btn btn-danger" id="btn-clear">${icon('trash', 15)} Borrar todo</button>
      </div>
    </div>

    <div class="card">
      <div class="card-head"><span class="card-title">Aplicación</span></div>
      <div class="list">
        <div class="list-row">
          <span class="grow t-sub">Versión</span>
          <span class="t-foot tnum">${APP_VERSION} · ${APP_BUILD}</span>
        </div>
        <div class="list-row"><span class="grow t-sub">Modo</span><span class="t-foot">${store.mode === 'cloud' ? 'Nube' : 'Local'}</span></div>
        <div class="list-row"><span class="grow t-sub">Instalable</span><span class="t-foot">${window.matchMedia('(display-mode: standalone)').matches ? 'Instalada' : 'Sí (Compartir → Añadir a inicio)'}</span></div>
      </div>

      <button class="btn btn-primary btn-block mt-12" id="btn-update">
        ${icon('reset', 15)} Forzar actualización
      </button>
      <p class="t-foot mt-4">Borra la caché y recarga. Úsalo si un arreglo reciente no aparece:
      en la app instalada del iPhone no hay recarga forzada del navegador.</p>

      <p class="t-foot mt-12">En iPhone/iPad: abre en Safari, toca <b>Compartir</b> y luego <b>Añadir a pantalla de inicio</b> para usarla como app.</p>
    </div>`;

  return {
    toolbar: toolbar('Ajustes'),
    body,
    mount(root) {
      $('#open-timer', root).onclick = timerSettingsSheet;
      $('#btn-export', root).onclick = () => {
        const blob = new Blob([JSON.stringify(store.data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `pomomomo-${todayISO()}.json`; a.click();
        URL.revokeObjectURL(url);
        toast('Datos exportados', 'ok');
      };
      $('#btn-seed', root).onclick = async () => {
        if (await confirmSheet({ title: 'Cargar ejemplo', message: 'Se agregarán portafolios, proyectos y actividades de muestra.', confirmText: 'Cargar' })) {
          await store.seedDemo(); toast('Datos de ejemplo cargados', 'ok'); renderView();
        }
      };
      $('#btn-update', root).onclick = async (e) => {
        const b = e.currentTarget;
        b.disabled = true; b.innerHTML = 'Actualizando…';
        try {
          for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
          for (const k of await caches.keys()) await caches.delete(k);
        } catch { /* si no hay caché, igual se recarga */ }
        // El parámetro rompe la caché HTTP de los módulos
        location.replace(location.pathname + '?v=' + Date.now() + location.hash);
      };

      $('#btn-clear', root).onclick = async () => {
        if (await confirmSheet({ title: 'Borrar todo', message: 'Se eliminarán portafolios, proyectos, actividades e historial. No se puede deshacer.', confirmText: 'Borrar todo', danger: true })) {
          await store.clearAll(); toast('Datos eliminados', 'ok'); renderView();
        }
      };
    }
  };
}

/* ==========================================================================
   Pantallas de acceso
   ========================================================================== */
function signInView() {
  const e = store.authError;
  return `<div class="signin"><div class="signin-card">
    <div class="signin-mark">🍅</div>
    <h1 class="t-title mb-8">PomoMomo</h1>
    <p class="t-sub mb-24">Portafolios, proyectos y actividades con enfoque Pomodoro.</p>

    <div id="signin-error" class="${e ? '' : 'hidden'}">
      ${e ? signInErrorHtml(e) : ''}
    </div>

    <button class="btn-google" id="btn-google">
      ${icon('google', 19)}<span>Continuar con Google</span>
    </button>

    <button class="btn btn-plain btn-block mt-8 ${e && Store.canRetryWithRedirect?.(e.code) ? '' : 'hidden'}" id="btn-redirect">
      Probar con redirección
    </button>

    <p class="t-foot mt-16">Solo las personas invitadas pueden entrar a este espacio.</p>
  </div></div>`;
}

function signInErrorHtml(e) {
  return `<div class="banner banner-warn mb-16" style="text-align:left;align-items:flex-start">
    ${icon('warning', 17)}
    <span class="col g-4 grow">
      <span>${esc(e.message)}</span>
      <span class="t-cap" style="color:inherit;opacity:.7">Código: ${esc(e.code)}</span>
    </span>
  </div>`;
}

function noAccessView() {
  const err = store.accessError;
  const trace = store.accessTrace || [];
  const esPermiso = err && /permission|insufficient/i.test(err.code + ' ' + err.message);

  return `<div class="signin"><div class="signin-card" style="max-width:460px">
    <div class="signin-mark" style="background:linear-gradient(150deg,#FFB340,#FF9500)">${icon('warning', 28)}</div>
    <h1 class="t-title mb-8">Sin acceso</h1>

    <p class="t-sub mb-16">La cuenta <b>${esc(store.user?.email || '')}</b> no pudo entrar a este espacio.</p>

    ${err ? `
      <div class="banner banner-warn mb-16" style="text-align:left;align-items:flex-start">
        ${icon('info', 17)}
        <span class="col g-4 grow">
          <span><b>Falló en:</b> ${esc(err.paso)}</span>
          <span>${esc(err.message)}</span>
          <span class="t-cap" style="color:inherit;opacity:.75">Código: ${esc(err.code)}</span>
        </span>
      </div>

      ${esPermiso ? `
        <div class="banner banner-info mb-16" style="text-align:left">
          ${icon('warning', 17)}
          <span>Las reglas de Firestore están rechazando la lectura. Verifica que hayas
          pegado el contenido de <b>firestore.rules</b> en Firebase → Firestore Database →
          pestaña <b>Reglas</b>, y que le hayas dado <b>Publicar</b>.</span>
        </div>` : ''}

      ${err.code === 'sin-invitacion' ? `
        <div class="banner banner-info mb-16" style="text-align:left">
          ${icon('info', 17)}
          <span>El espacio ya tiene miembros registrados. Pide al propietario que te
          invite desde <b>Equipo → Invitar</b>.</span>
        </div>` : ''}
    ` : ''}

    ${trace.length ? `
      <details style="text-align:left;margin-bottom:16px">
        <summary class="t-foot" style="cursor:pointer">Ver detalle técnico</summary>
        <div class="tl-note" style="margin-top:8px;font-size:12px">${trace.map(esc).join('\n')}</div>
      </details>` : ''}

    <button class="btn btn-primary btn-block mb-8" id="btn-retry">${icon('reset', 15)} Reintentar</button>
    <button class="btn btn-gray btn-block" id="btn-signout">Usar otra cuenta</button>
  </div></div>`;
}

function bindSignIn() {
  const showError = (err) => {
    store.authError = {
      code: err?.code || 'desconocido',
      message: err?.friendly || err?.message || 'No se pudo iniciar sesión.'
    };
    const box = $('#signin-error');
    if (box) {
      box.innerHTML = signInErrorHtml(store.authError);
      box.classList.remove('hidden');
    }
    $('#btn-redirect')?.classList.toggle('hidden', !Store.canRetryWithRedirect(store.authError.code));
  };

  const attempt = async (btn, via) => {
    btn.disabled = true;
    const original = btn.innerHTML;
    btn.innerHTML = via === 'redirect' ? 'Redirigiendo…' : `${icon('google', 19)}<span>Abriendo Google…</span>`;
    try {
      await store.signIn(via);
      store.authError = null;
    } catch (err) {
      showError(err);
    } finally {
      btn.disabled = false;
      btn.innerHTML = original;
    }
  };

  $('#btn-google')?.addEventListener('click', (ev) => attempt(ev.currentTarget, 'popup'));
  $('#btn-redirect')?.addEventListener('click', (ev) => attempt(ev.currentTarget, 'redirect'));
  $('#btn-signout')?.addEventListener('click', () => store.signOut());
  $('#btn-retry')?.addEventListener('click', () => location.reload());
}

/* ==========================================================================
   Service worker
   ========================================================================== */
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  /* Cuando el nuevo service worker toma el control, se recarga una sola vez.
     Sin esto la pestaña seguía ejecutando el código viejo hasta que el
     usuario adivinara que debía forzar la recarga. */
  let recargando = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (recargando) return;
    recargando = true;
    location.reload();
  });

  window.addEventListener('load', async () => {
    try {
      // updateViaCache:'none' evita que el propio sw.js quede en caché HTTP,
      // así una nueva versión publicada siempre se detecta.
      const reg = await navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' });

      reg.addEventListener('updatefound', () => {
        const sw = reg.installing;
        sw?.addEventListener('statechange', () => {
          if (sw.state === 'installed' && navigator.serviceWorker.controller) {
            toast('Actualizando a la versión nueva…', 'info', 3000);
            sw.postMessage('skipWaiting');   // dispara controllerchange → recarga
          }
        });
      });

      // Busca versión nueva al abrir y cada vez que se vuelve a la app,
      // que en el iPhone instalado es el único momento fiable.
      reg.update().catch(() => {});
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) reg.update().catch(() => {});
      });
    } catch { /* el service worker es opcional */ }
  });
}

/* ==========================================================================
   Arranque
   ========================================================================== */
boot();
