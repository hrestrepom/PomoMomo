/* ==========================================================================
   PomoMomo — Utilidades de interfaz
   Iconos, formateo, hojas modales, menús, toasts y diálogos.
   ========================================================================== */

/* ==========================================================================
   Iconos (trazo, estilo SF Symbols)
   ========================================================================== */
const P = {
  today:      '<path d="M8 2v3M16 2v3M3.5 9h17M5 4.5h14a1.5 1.5 0 0 1 1.5 1.5v13A1.5 1.5 0 0 1 19 20.5H5A1.5 1.5 0 0 1 3.5 19V6A1.5 1.5 0 0 1 5 4.5Z"/><path d="M8 13h2.5"/>',
  timer:      '<circle cx="12" cy="13" r="8"/><path d="M12 9.5V13l2.2 2.2M9.5 2h5"/>',
  folder:     '<path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2.2h7A1.5 1.5 0 0 1 19 9.7v8.3a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 3 18Z"/>',
  briefcase:  '<rect x="2.5" y="7" width="19" height="12.5" rx="2"/><path d="M8.5 7V5.5A1.5 1.5 0 0 1 10 4h4a1.5 1.5 0 0 1 1.5 1.5V7M2.5 12h19"/>',
  checklist:  '<path d="M9 6h11M9 12h11M9 18h11M4 5.6 5 6.7l1.8-2M4 11.6l1 1.1 1.8-2M4 17.6l1 1.1 1.8-2"/>',
  chart:      '<path d="M4 20V4"/><path d="M4 20h16"/><path d="M8 16v-4M12 16V8M16 16v-6M20 16v-9"/>',
  people:     '<circle cx="9" cy="8" r="3.2"/><path d="M2.8 19.4a6.4 6.4 0 0 1 12.4 0"/><path d="M16.5 5.6a3.2 3.2 0 0 1 0 6.1M18 14.4a6.4 6.4 0 0 1 3.2 5"/>',
  gear:       '<circle cx="12" cy="12" r="3.1"/><path d="M12 2.6h0a1.6 1.6 0 0 1 1.6 1.6v.5a1.6 1.6 0 0 0 2.4 1.4l.4-.2a1.6 1.6 0 0 1 2.2.6l.3.5a1.6 1.6 0 0 1-.6 2.2l-.4.2a1.6 1.6 0 0 0 0 2.8l.4.2a1.6 1.6 0 0 1 .6 2.2l-.3.5a1.6 1.6 0 0 1-2.2.6l-.4-.2a1.6 1.6 0 0 0-2.4 1.4v.5a1.6 1.6 0 0 1-1.6 1.6h-.6a1.6 1.6 0 0 1-1.6-1.6v-.5a1.6 1.6 0 0 0-2.4-1.4l-.4.2a1.6 1.6 0 0 1-2.2-.6l-.3-.5a1.6 1.6 0 0 1 .6-2.2l.4-.2a1.6 1.6 0 0 0 0-2.8l-.4-.2a1.6 1.6 0 0 1-.6-2.2l.3-.5a1.6 1.6 0 0 1 2.2-.6l.4.2A1.6 1.6 0 0 0 9.8 4.7v-.5a1.6 1.6 0 0 1 1.6-1.6Z"/>',
  plus:       '<path d="M12 5v14M5 12h14"/>',
  search:     '<circle cx="10.8" cy="10.8" r="6.3"/><path d="m15.4 15.4 4.1 4.1"/>',
  more:       '<circle cx="5.5" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="18.5" cy="12" r="1.4" fill="currentColor" stroke="none"/>',
  chevR:      '<path d="m9.5 5.5 6.5 6.5-6.5 6.5"/>',
  chevL:      '<path d="M14.5 5.5 8 12l6.5 6.5"/>',
  chevD:      '<path d="m5.5 9.5 6.5 6.5 6.5-6.5"/>',
  close:      '<path d="M6 6l12 12M18 6 6 18"/>',
  check:      '<path d="m5 12.5 4.5 4.5L19 7"/>',
  play:       '<path d="M8 5.2v13.6a.6.6 0 0 0 .92.5l10.5-6.8a.6.6 0 0 0 0-1l-10.5-6.8a.6.6 0 0 0-.92.5Z" fill="currentColor" stroke="none"/>',
  pause:      '<rect x="7" y="5" width="3.6" height="14" rx="1.3" fill="currentColor" stroke="none"/><rect x="13.4" y="5" width="3.6" height="14" rx="1.3" fill="currentColor" stroke="none"/>',
  reset:      '<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1"/><path d="M3.2 4.2v4.4h4.4"/>',
  skip:       '<path d="M6 5.3v13.4a.5.5 0 0 0 .78.42l9.6-6.7a.5.5 0 0 0 0-.84l-9.6-6.7A.5.5 0 0 0 6 5.3Z" fill="currentColor" stroke="none"/><rect x="17" y="5" width="2.8" height="14" rx="1.2" fill="currentColor" stroke="none"/>',
  calendar:   '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M8 2.6v4M16 2.6v4M3.5 10h17"/>',
  clock:      '<circle cx="12" cy="12" r="8.6"/><path d="M12 7.2V12l3.2 2"/>',
  flag:       '<path d="M5.5 21V4M5.5 5h10.8l-1.7 3.6 1.7 3.6H5.5"/>',
  pencil:     '<path d="M16.6 3.9a2 2 0 0 1 2.9 2.9L8.4 17.9l-3.9 1 1-3.9Z"/><path d="m14.5 6 3.5 3.5"/>',
  trash:      '<path d="M4.5 6.5h15M9.5 6.5V4.8A1.3 1.3 0 0 1 10.8 3.5h2.4a1.3 1.3 0 0 1 1.3 1.3v1.7"/><path d="M6.5 6.5 7.4 19a1.5 1.5 0 0 0 1.5 1.4h6.2a1.5 1.5 0 0 0 1.5-1.4l.9-12.5"/><path d="M10.5 10v6.5M13.5 10v6.5"/>',
  grid:       '<rect x="3.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.6"/>',
  columns:    '<rect x="3" y="4.5" width="5.2" height="15" rx="1.6"/><rect x="9.4" y="4.5" width="5.2" height="15" rx="1.6"/><rect x="15.8" y="4.5" width="5.2" height="15" rx="1.6"/>',
  list:       '<path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4.2" cy="6" r="1.2" fill="currentColor" stroke="none"/><circle cx="4.2" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="4.2" cy="18" r="1.2" fill="currentColor" stroke="none"/>',
  rocket:     '<path d="M12 2.8c3.2 2.2 5 5.6 5 9.4l-1.9 4.2H8.9L7 12.2c0-3.8 1.8-7.2 5-9.4Z"/><circle cx="12" cy="10.4" r="1.9"/><path d="M8.9 16.4 6.4 19v2.2l2.8-1.3M15.1 16.4l2.5 2.6v2.2l-2.8-1.3"/>',
  target:     '<circle cx="12" cy="12" r="8.6"/><circle cx="12" cy="12" r="4.8"/><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none"/>',
  code:       '<path d="m8.5 8.5-4 3.5 4 3.5M15.5 8.5l4 3.5-4 3.5M13.6 5l-3.2 14"/>',
  sparkles:   '<path d="M12 3.2 13.6 8 18.4 9.6 13.6 11.2 12 16l-1.6-4.8L5.6 9.6 10.4 8Z"/><path d="M18.2 15.4 19 17.4l2 .8-2 .8-.8 2-.8-2-2-.8 2-.8Z"/>',
  book:       '<path d="M4 4.6h6a3 3 0 0 1 3 3v12a2.4 2.4 0 0 0-2.4-2.4H4Z"/><path d="M20 4.6h-6a3 3 0 0 0-3 3v12a2.4 2.4 0 0 1 2.4-2.4H20Z"/>',
  beaker:     '<path d="M9.5 3.5v6L4.6 18a2 2 0 0 0 1.7 3h11.4a2 2 0 0 0 1.7-3l-4.9-8.5v-6"/><path d="M8 3.5h8M7 14h10"/>',
  google:     '<path fill="#4285F4" stroke="none" d="M21.6 12.23c0-.74-.07-1.45-.19-2.14H12v4.05h5.38a4.6 4.6 0 0 1-2 3.02v2.5h3.23c1.89-1.74 2.99-4.3 2.99-7.43Z"/><path fill="#34A853" stroke="none" d="M12 22c2.7 0 4.97-.9 6.62-2.42l-3.23-2.5c-.9.6-2.05.95-3.39.95-2.6 0-4.81-1.76-5.6-4.13H3.06v2.59A10 10 0 0 0 12 22Z"/><path fill="#FBBC05" stroke="none" d="M6.4 13.9a6 6 0 0 1 0-3.82V7.5H3.06a10 10 0 0 0 0 9L6.4 13.9Z"/><path fill="#EA4335" stroke="none" d="M12 5.95c1.47 0 2.79.5 3.83 1.5l2.86-2.86C16.96 2.99 14.7 2 12 2a10 10 0 0 0-8.94 5.5L6.4 10.1c.79-2.37 3-4.14 5.6-4.14Z"/>',
  comment:    '<path d="M20.5 11.6a7.6 7.6 0 0 1-8.2 7.6L6.5 21l1.1-3.6a7.6 7.6 0 1 1 12.9-5.8Z"/>',
  history:    '<path d="M3.6 12a8.5 8.5 0 1 0 2.5-6"/><path d="M3.3 4.4v4.3h4.3"/><path d="M12 7.6V12l3 1.9"/>',
  cloud:      '<path d="M7 18.5a4.2 4.2 0 0 1-.5-8.37 5.6 5.6 0 0 1 10.7-1.4A3.9 3.9 0 0 1 17.5 18.5Z"/>',
  cloudOff:   '<path d="M7 18.5a4.2 4.2 0 0 1-.5-8.37 5.6 5.6 0 0 1 2-3.1M11 5.6a5.6 5.6 0 0 1 6.2 3.1 3.9 3.9 0 0 1 1 7.4"/><path d="m3.5 3.5 17 17"/>',
  logout:     '<path d="M15 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h7a2 2 0 0 0 2-2v-2"/><path d="M19.5 12H9.5M16.5 9l3 3-3 3"/>',
  user:       '<circle cx="12" cy="8.2" r="3.6"/><path d="M4.6 20.2a7.4 7.4 0 0 1 14.8 0"/>',
  bell:       '<path d="M18 9a6 6 0 0 0-12 0c0 5-2 6.5-2 6.5h16S18 14 18 9Z"/><path d="M13.7 19a2 2 0 0 1-3.4 0"/>',
  filter:     '<path d="M3.5 5.5h17l-6.6 7.6v5.6l-3.8 2v-7.6Z"/>',
  arrowUp:    '<path d="M12 19V5M6 11l6-6 6 6"/>',
  arrowDown:  '<path d="M12 5v14M6 13l6 6 6-6"/>',
  info:       '<circle cx="12" cy="12" r="8.6"/><path d="M12 11v5.4M12 7.8v.2"/>',
  warning:    '<path d="M10.3 3.9 2.6 17.2A2 2 0 0 0 4.3 20.2h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 16.4v.2"/>',
  link:       '<path d="M9.5 14.5a3.5 3.5 0 0 0 5 0l3-3a3.54 3.54 0 0 0-5-5l-1 1"/><path d="M14.5 9.5a3.5 3.5 0 0 0-5 0l-3 3a3.54 3.54 0 0 0 5 5l1-1"/>',
  download:   '<path d="M12 3.5v11M8 11l4 4 4-4"/><path d="M4 16.5v2A2 2 0 0 0 6 20.5h12a2 2 0 0 0 2-2v-2"/>',
  share:      '<path d="M12 15.5V3.8M8.2 7.2 12 3.4l3.8 3.8"/><path d="M5 13v6.2a1.6 1.6 0 0 0 1.6 1.6h10.8a1.6 1.6 0 0 0 1.6-1.6V13"/>',
  inbox:      '<path d="M3.5 13.5h4l1.5 3h6l1.5-3h4"/><path d="M5.6 4.8h12.8l2.1 8.7v4a2 2 0 0 1-2 2H5.5a2 2 0 0 1-2-2v-4Z"/>',
  fire:       '<path d="M12 21c3.6 0 6.2-2.5 6.2-6 0-4.4-4-5.6-3.2-10.6C11.6 5.6 9 9 9 11.5c0 1.3.6 2.2 1.2 2.8-.4-2.4-1-3.6-1-3.6-2.4 1.9-3.4 3.9-3.4 6.3 0 3.5 2.6 6 6.2 6Z"/>',
  bolt:       '<path d="M13.2 2.5 4.8 13.2h5.6L10 21.5l8.6-10.9h-5.7Z"/>',
  layers:     '<path d="m12 3.2 8.4 4.3-8.4 4.3-8.4-4.3Z"/><path d="m3.6 12.2 8.4 4.3 8.4-4.3M3.6 16.6l8.4 4.3 8.4-4.3"/>',
  dot:        '<circle cx="12" cy="12" r="4" fill="currentColor" stroke="none"/>'
};

export function icon(name, size = 18, cls = '') {
  const d = P[name] || P.dot;
  return `<svg class="ic ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"
    aria-hidden="true">${d}</svg>`;
}

/* ==========================================================================
   Formateo
   ========================================================================== */
export const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function dayKey(dateLike) {
  const d = dateLike instanceof Date ? dateLike : new Date(dateLike);
  if (isNaN(d)) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return dayKey(d);
}

export function daysBetween(a, b) {
  const d1 = new Date(a + 'T12:00:00'), d2 = new Date(b + 'T12:00:00');
  return Math.round((d2 - d1) / 86400000);
}

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** Fecha corta: "12 mar" o "12 mar 2024" si es otro año */
export function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso.length <= 10 ? iso + 'T12:00:00' : iso);
  if (isNaN(d)) return '';
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return `${d.getDate()} ${MONTHS[d.getMonth()]}${sameYear ? '' : ' ' + d.getFullYear()}`;
}

/** Fecha relativa amable: "hoy", "mañana", "hace 3 d", "en 5 d" */
export function fmtDue(iso) {
  if (!iso) return '';
  const diff = daysBetween(todayISO(), iso.slice(0, 10));
  if (diff === 0) return 'hoy';
  if (diff === 1) return 'mañana';
  if (diff === -1) return 'ayer';
  if (diff > 1 && diff <= 7) return `en ${diff} d`;
  if (diff < -1) return `hace ${Math.abs(diff)} d`;
  return fmtDate(iso);
}

/** Tono del vencimiento */
export function dueTone(iso, status) {
  if (!iso || status === 'done') return 'gray';
  const diff = daysBetween(todayISO(), iso.slice(0, 10));
  if (diff < 0) return 'red';
  if (diff === 0) return 'orange';
  if (diff <= 2) return 'blue';
  return 'gray';
}

/** Tiempo relativo para el historial */
export function fmtAgo(iso) {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (isNaN(t)) return '';
  const s = Math.floor((Date.now() - t) / 1000);
  if (s < 60) return 'ahora';
  const m = Math.floor(s / 60);
  if (m < 60) return `hace ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `hace ${d} d`;
  return fmtDate(iso);
}

export function fmtTime(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
}

export const mmss = (secs) => {
  const s = Math.max(0, Math.round(secs));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

export function fmtDuration(minutes) {
  const m = Math.round(minutes || 0);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}

export function initials(name = '') {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts[1]?.[0] || '')).toUpperCase();
}

/** Color estable derivado del texto */
export function colorFor(str = '') {
  const palette = ['#007AFF', '#34C759', '#FF9500', '#AF52DE', '#FF2D55', '#30B0C7', '#5856D6', '#A2845E'];
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}

/** Avatar HTML */
export function avatar(member, size = 'sm') {
  const cls = size === 'sm' ? 'avatar avatar-sm' : size === 'lg' ? 'avatar avatar-lg'
            : size === 'xl' ? 'avatar avatar-xl' : 'avatar';
  if (!member) {
    return `<span class="${cls}" style="background:var(--surface-3);color:var(--label-3)" title="Sin asignar">${icon('user', 13)}</span>`;
  }
  const name = member.displayName || member.email || '?';
  if (member.photoURL) {
    return `<span class="${cls}" title="${esc(name)}"><img src="${esc(member.photoURL)}" alt="${esc(name)}" referrerpolicy="no-referrer"></span>`;
  }
  return `<span class="${cls}" style="background:${colorFor(name)}" title="${esc(name)}">${esc(initials(name))}</span>`;
}

/* ==========================================================================
   DOM
   ========================================================================== */
export const $  = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function html(strings, ...vals) {
  return strings.reduce((out, s, i) => out + s + (vals[i] ?? ''), '');
}

/** Delegación de eventos por atributo data-act */
export function delegate(root, event, selector, handler) {
  root.addEventListener(event, (e) => {
    const t = e.target.closest(selector);
    if (t && root.contains(t)) handler(e, t);
  });
}

/* ==========================================================================
   Toasts
   ========================================================================== */
let toastHost;
export function toast(message, kind = 'info', ms = 2600) {
  toastHost ||= $('#toasts');
  if (!toastHost) return;
  const el = document.createElement('div');
  el.className = `toast ${kind === 'ok' ? 'ok' : kind === 'err' ? 'err' : ''}`;
  const ic = kind === 'ok' ? 'check' : kind === 'err' ? 'warning' : 'info';
  el.innerHTML = `${icon(ic, 16)}<span>${esc(message)}</span>`;
  toastHost.appendChild(el);
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 260);
  }, ms);
}

/* ==========================================================================
   Hojas modales
   ========================================================================== */
let sheetHost, sheetResolve, sheetKeyHandler;

/**
 * openSheet({ title, body, footer, size, onMount })
 * Devuelve una promesa que resuelve con el valor pasado a closeSheet().
 */
export function openSheet({ title = '', body = '', footer = '', size = '', onMount } = {}) {
  sheetHost ||= $('#scrim');
  sheetHost.innerHTML = `
    <div class="sheet ${size === 'lg' ? 'sheet-lg' : ''}" role="dialog" aria-modal="true">
      <div class="grabber"></div>
      <div class="sheet-head">
        <div class="sheet-title grow truncate">${esc(title)}</div>
        <button class="icon-btn" data-sheet-close aria-label="Cerrar">${icon('close', 17)}</button>
      </div>
      <div class="sheet-body">${body}</div>
      ${footer ? `<div class="sheet-foot">${footer}</div>` : ''}
    </div>`;

  sheetHost.classList.add('open');
  document.body.style.overflow = 'hidden';

  const sheetEl = $('.sheet', sheetHost);
  $$('[data-sheet-close]', sheetHost).forEach(b => b.addEventListener('click', () => closeSheet(null)));
  sheetHost.addEventListener('click', onScrimClick);

  sheetKeyHandler = (e) => { if (e.key === 'Escape') closeSheet(null); };
  document.addEventListener('keydown', sheetKeyHandler);

  onMount?.(sheetEl);

  // Enfoca el primer campo
  setTimeout(() => {
    const first = $('input:not([type=hidden]):not([readonly]), textarea', sheetEl);
    if (first && window.innerWidth > 780) first.focus();
  }, 60);

  return new Promise((res) => { sheetResolve = res; });
}

function onScrimClick(e) { if (e.target === sheetHost) closeSheet(null); }

export function closeSheet(value = null) {
  if (!sheetHost) return;
  sheetHost.classList.remove('open');
  sheetHost.removeEventListener('click', onScrimClick);
  document.removeEventListener('keydown', sheetKeyHandler);
  document.body.style.overflow = '';
  const r = sheetResolve; sheetResolve = null;
  setTimeout(() => { if (!sheetHost.classList.contains('open')) sheetHost.innerHTML = ''; }, 320);
  r?.(value);
}

/* ---------- Diálogo de confirmación ---------- */
export function confirmSheet({ title = '¿Continuar?', message = '', confirmText = 'Continuar', danger = false } = {}) {
  return openSheet({
    title,
    body: `<p class="t-body muted" style="line-height:1.5">${esc(message)}</p>`,
    footer: `
      <button class="btn btn-gray" data-x="no">Cancelar</button>
      <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-x="yes">${esc(confirmText)}</button>`,
    onMount(el) {
      $('[data-x="no"]', el).onclick = () => closeSheet(false);
      $('[data-x="yes"]', el).onclick = () => closeSheet(true);
    }
  });
}

/* ---------- Prompt simple ---------- */
export function promptSheet({ title = '', label = '', value = '', placeholder = '', confirmText = 'Guardar' } = {}) {
  return openSheet({
    title,
    body: `<div class="field"><label>${esc(label)}</label>
      <input class="input" id="_p" value="${esc(value)}" placeholder="${esc(placeholder)}"></div>`,
    footer: `<button class="btn btn-gray" data-x="no">Cancelar</button>
             <button class="btn btn-primary" data-x="yes">${esc(confirmText)}</button>`,
    onMount(el) {
      const input = $('#_p', el);
      const ok = () => closeSheet(input.value.trim() || null);
      $('[data-x="no"]', el).onclick = () => closeSheet(null);
      $('[data-x="yes"]', el).onclick = ok;
      input.addEventListener('keydown', e => { if (e.key === 'Enter') ok(); });
    }
  });
}

/* ==========================================================================
   Menú contextual
   ========================================================================== */
let menuEl;
export function openMenu(anchor, items) {
  closeMenu();
  menuEl = document.createElement('div');
  menuEl.className = 'menu';
  menuEl.innerHTML = items.map((it, i) =>
    it === '-' ? '<hr>' :
    `<button data-i="${i}" class="${it.danger ? 'danger' : ''}">
       ${it.icon ? icon(it.icon, 16) : ''}<span>${esc(it.label)}</span>
     </button>`
  ).join('');
  document.body.appendChild(menuEl);

  const r = anchor.getBoundingClientRect();
  const mw = menuEl.offsetWidth, mh = menuEl.offsetHeight;
  let left = Math.min(r.right - mw, window.innerWidth - mw - 10);
  let top = r.bottom + 6;
  if (top + mh > window.innerHeight - 10) top = Math.max(10, r.top - mh - 6);
  menuEl.style.left = `${Math.max(10, left)}px`;
  menuEl.style.top = `${top}px`;

  menuEl.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-i]');
    if (!b) return;
    const item = items[+b.dataset.i];
    closeMenu();
    item?.onClick?.();
  });

  setTimeout(() => {
    document.addEventListener('click', onDocClickMenu, { once: true });
    document.addEventListener('keydown', onEscMenu);
  }, 0);
}

function onDocClickMenu() { closeMenu(); }
function onEscMenu(e) { if (e.key === 'Escape') closeMenu(); }

export function closeMenu() {
  if (!menuEl) return;
  menuEl.remove(); menuEl = null;
  document.removeEventListener('keydown', onEscMenu);
}

/* ==========================================================================
   Anillo de progreso SVG
   ========================================================================== */
export function ring(pct, size = 44, stroke = 4, color = 'var(--blue)') {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const off = c * (1 - Math.max(0, Math.min(1, pct)));
  return `<svg class="ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <circle class="ring-bg" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-width="${stroke}"/>
    <circle class="ring-fg" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-width="${stroke}"
      stroke="${color}" stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${off.toFixed(2)}"/>
  </svg>`;
}

/* ==========================================================================
   Estado vacío
   ========================================================================== */
export function empty(iconName, title, text = '', actionHtml = '') {
  return `<div class="empty">
    ${icon(iconName, 34)}
    <h3>${esc(title)}</h3>
    ${text ? `<p>${esc(text)}</p>` : ''}
    ${actionHtml}
  </div>`;
}

/* ==========================================================================
   Arrastrar y soltar (unificado ratón + táctil)
   ========================================================================== */
export function makeDraggable(el, { data, onDrop }) {
  el.setAttribute('draggable', 'true');

  el.addEventListener('dragstart', (e) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', data);
    el.classList.add('dragging');
    window.__dragData = data;
  });
  el.addEventListener('dragend', () => {
    el.classList.remove('dragging');
    window.__dragData = null;
    $$('.drop').forEach(z => z.classList.remove('drop'));
  });

  /* Táctil: long-press + arrastre */
  let touchTimer, ghost, active = false, lastZone = null;

  el.addEventListener('touchstart', (e) => {
    touchTimer = setTimeout(() => {
      active = true;
      window.__dragData = data;
      if (navigator.vibrate) navigator.vibrate(12);
      const r = el.getBoundingClientRect();
      ghost = el.cloneNode(true);
      Object.assign(ghost.style, {
        position: 'fixed', left: r.left + 'px', top: r.top + 'px',
        width: r.width + 'px', pointerEvents: 'none', zIndex: 999,
        opacity: '.92', transform: 'scale(1.03)', transition: 'none',
        boxShadow: 'var(--sh-lg)'
      });
      document.body.appendChild(ghost);
      el.classList.add('dragging');
    }, 320);
  }, { passive: true });

  el.addEventListener('touchmove', (e) => {
    if (!active) { clearTimeout(touchTimer); return; }
    e.preventDefault();
    const t = e.touches[0];
    if (ghost) {
      const r = el.getBoundingClientRect();
      ghost.style.left = (t.clientX - r.width / 2) + 'px';
      ghost.style.top = (t.clientY - 24) + 'px';
    }
    const under = document.elementFromPoint(t.clientX, t.clientY);
    const zone = under?.closest('[data-dropzone]');
    if (zone !== lastZone) {
      lastZone?.classList.remove('drop');
      zone?.classList.add('drop');
      lastZone = zone;
    }
  }, { passive: false });

  const endTouch = () => {
    clearTimeout(touchTimer);
    if (!active) return;
    active = false;
    ghost?.remove(); ghost = null;
    el.classList.remove('dragging');
    if (lastZone) {
      lastZone.classList.remove('drop');
      onDrop?.(lastZone.dataset.dropzone, data);
      lastZone = null;
    }
    window.__dragData = null;
  };
  el.addEventListener('touchend', endTouch);
  el.addEventListener('touchcancel', endTouch);
}

export function makeDropZone(el, key, onDrop) {
  el.dataset.dropzone = key;
  el.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; el.classList.add('drop'); });
  el.addEventListener('dragleave', (e) => { if (!el.contains(e.relatedTarget)) el.classList.remove('drop'); });
  el.addEventListener('drop', (e) => {
    e.preventDefault();
    el.classList.remove('drop');
    const data = e.dataTransfer.getData('text/plain') || window.__dragData;
    if (data) onDrop(key, data);
  });
}

/* ==========================================================================
   Sonido de fin de temporizador (WebAudio, sin archivos)
   ========================================================================== */
let audioCtx;
export function chime(kind = 'done') {
  try {
    audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const notes = kind === 'done' ? [880, 1174.7, 1318.5] : [659.3, 523.3];
    notes.forEach((f, i) => {
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      const t0 = audioCtx.currentTime + i * 0.14;
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(0.16, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.5);
      o.connect(g); g.connect(audioCtx.destination);
      o.start(t0); o.stop(t0 + 0.55);
    });
  } catch { /* sin audio disponible */ }
}
