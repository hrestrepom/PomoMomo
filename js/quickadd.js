/* ==========================================================================
   PomoMomo — Captura rápida
   Convierte una línea de texto en una actividad, detectando fecha,
   proyecto, urgencia y recurrencia sin que haya que abrir un formulario.

   Ejemplos:
     "Llamar al dentista mañana !"
     "Pagar arriendo cada mes"
     "Revisar propuesta #negocio viernes"
     "Sacar la basura cada martes"
   ========================================================================== */

import { todayISO, addDays } from './ui.js';

/* Quita acentos para comparar: "miércoles" y "miercoles" deben coincidir. */
const norm = (s) => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

const DIAS = {
  domingo: 0, lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6,
  dom: 0, lun: 1, mar: 2, mie: 3, jue: 4, vie: 5, sab: 6
};

const MESES = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7,
  agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12
};

const FREQ_LABEL = {
  daily:   'cada día',
  weekly:  'cada semana',
  monthly: 'cada mes',
  yearly:  'cada año'
};

/* ---------- Fechas ---------- */
function proximoDia(targetDow, desdeISO) {
  const hoy = new Date(desdeISO + 'T12:00:00');
  const actual = hoy.getDay();
  let delta = (targetDow - actual + 7) % 7;
  if (delta === 0) delta = 7;          // "el lunes" dicho un lunes = el siguiente
  return addDays(desdeISO, delta);
}

function fechaValida(y, m, d) {
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

/**
 * Analiza el texto y devuelve la actividad propuesta.
 * @param {string} raw
 * @param {Array} projects  lista de proyectos para resolver #etiquetas
 * @returns {{name, dueDate, projectId, projectName, quadrant, recur, tokens}}
 */
export function parse(raw, projects = []) {
  let texto = ' ' + (raw || '').trim() + ' ';
  const hoy = todayISO();
  const tokens = [];

  let dueDate = '';
  let projectId = '';
  let projectName = '';
  let quadrant = 'Q2';
  let recur = null;

  const consumir = (regex, fn) => {
    const m = texto.match(regex);
    if (!m) return false;
    const ok = fn(m);
    if (ok !== false) texto = texto.replace(m[0], ' ');
    return ok !== false;
  };

  /* --- Recurrencia (antes que las fechas: "cada martes" no es "el martes") --- */
  consumir(/\bcada\s+(\d+\s+)?(d[ií]as?|semanas?|mes(?:es)?|a[nñ]os?|lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bados?|domingos?)\b/i, (m) => {
    const n = m[1] ? parseInt(m[1], 10) : 1;
    const unidad = norm(m[2]);

    if (DIAS[unidad.replace(/s$/, '')] !== undefined || DIAS[unidad] !== undefined) {
      const dow = DIAS[unidad] ?? DIAS[unidad.replace(/s$/, '')];
      recur = { freq: 'weekly', interval: 1, weekday: dow };
      if (!dueDate) dueDate = proximoDia(dow, hoy);
      tokens.push({ tipo: 'recurrencia', texto: `cada ${m[2]}` });
      return true;
    }
    if (/^dias?$/.test(unidad))          recur = { freq: 'daily',   interval: n };
    else if (/^semanas?$/.test(unidad))  recur = { freq: 'weekly',  interval: n };
    else if (/^mes(es)?$/.test(unidad))  recur = { freq: 'monthly', interval: n };
    else if (/^a[nñ]os?$/.test(unidad))  recur = { freq: 'yearly',  interval: n };
    else return false;

    tokens.push({ tipo: 'recurrencia', texto: n > 1 ? `cada ${n} ${m[2]}` : FREQ_LABEL[recur.freq] });
    return true;
  });

  /* --- Fechas relativas --- */
  if (!dueDate) {
    consumir(/\bpasado\s+ma[nñ]ana\b/i, () => {
      dueDate = addDays(hoy, 2);
      tokens.push({ tipo: 'fecha', texto: 'pasado mañana' });
    });
  }
  if (!dueDate) {
    consumir(/\bma[nñ]ana\b/i, () => {
      dueDate = addDays(hoy, 1);
      tokens.push({ tipo: 'fecha', texto: 'mañana' });
    });
  }
  if (!dueDate) {
    consumir(/\bhoy\b/i, () => {
      dueDate = hoy;
      tokens.push({ tipo: 'fecha', texto: 'hoy' });
    });
  }
  if (!dueDate) {
    consumir(/\ben\s+(\d+)\s+(d[ií]as?|semanas?|mes(?:es)?)\b/i, (m) => {
      const n = parseInt(m[1], 10);
      const u = norm(m[2]);
      const dias = /^semanas?$/.test(u) ? n * 7 : /^mes(es)?$/.test(u) ? n * 30 : n;
      dueDate = addDays(hoy, dias);
      tokens.push({ tipo: 'fecha', texto: `en ${n} ${m[2]}` });
    });
  }
  if (!dueDate) {
    consumir(/\b(?:el\s+)?(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)\b/i, (m) => {
      const dow = DIAS[norm(m[1])];
      if (dow === undefined) return false;
      dueDate = proximoDia(dow, hoy);
      tokens.push({ tipo: 'fecha', texto: m[1].toLowerCase() });
    });
  }
  /* "15 de marzo" */
  if (!dueDate) {
    consumir(/\b(\d{1,2})\s+de\s+([a-záéíóú]+)\b/i, (m) => {
      const d = parseInt(m[1], 10);
      const mes = MESES[norm(m[2])];
      if (!mes || !fechaValida(new Date().getFullYear(), mes, d)) return false;
      const y = new Date().getFullYear();
      const cand = `${y}-${String(mes).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      dueDate = cand < hoy ? `${y + 1}-${String(mes).padStart(2, '0')}-${String(d).padStart(2, '0')}` : cand;
      tokens.push({ tipo: 'fecha', texto: `${d} de ${m[2]}` });
    });
  }
  /* "12/3" o "12/03" */
  if (!dueDate) {
    consumir(/\b(\d{1,2})\/(\d{1,2})\b/, (m) => {
      const d = parseInt(m[1], 10), mes = parseInt(m[2], 10);
      const y = new Date().getFullYear();
      if (!fechaValida(y, mes, d)) return false;
      const cand = `${y}-${String(mes).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      dueDate = cand < hoy ? `${y + 1}-${String(mes).padStart(2, '0')}-${String(d).padStart(2, '0')}` : cand;
      tokens.push({ tipo: 'fecha', texto: `${d}/${mes}` });
    });
  }

  /* --- Proyecto con #etiqueta --- */
  consumir(/#([^\s#]+)/, (m) => {
    const clave = norm(m[1]);
    const hit = projects.find(p => norm(p.name).replace(/\s+/g, '').startsWith(clave))
             || projects.find(p => norm(p.name).includes(clave));
    if (!hit) {
      tokens.push({ tipo: 'aviso', texto: `no hay proyecto «${m[1]}»` });
      return true;   // se consume igual, para que no ensucie el nombre
    }
    projectId = hit.id;
    projectName = hit.name;
    tokens.push({ tipo: 'proyecto', texto: hit.name });
  });

  /* --- Urgencia --- */
  consumir(/\s!(?=\s)/, () => {
    quadrant = 'Q1';
    tokens.push({ tipo: 'prioridad', texto: 'urgente e importante' });
  });

  /* Una tarea que se repite necesita un ancla: sin fecha nunca aparecería
     en Hoy y la siguiente ocurrencia no tendría desde dónde contar. */
  if (recur && !dueDate) {
    dueDate = hoy;
    tokens.push({ tipo: 'fecha', texto: 'empieza hoy' });
  }

  recur = withAnchor(recur, dueDate);

  const name = texto.replace(/\s+/g, ' ').trim();
  return { name, dueDate, projectId, projectName, quadrant, recur, tokens };
}

/* ==========================================================================
   Recurrencia
   ========================================================================== */

export function describeRecur(recur) {
  if (!recur) return '';
  const n = recur.interval || 1;
  if (recur.freq === 'weekly' && recur.weekday !== undefined) {
    const nombres = ['domingos', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábados'];
    return `cada ${nombres[recur.weekday]}`;
  }
  if (n === 1) return FREQ_LABEL[recur.freq] || '';
  const plural = { daily: 'días', weekly: 'semanas', monthly: 'meses', yearly: 'años' };
  return `cada ${n} ${plural[recur.freq]}`;
}

const fmt = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * Calcula la fecha de la siguiente ocurrencia.
 *
 * Para las mensuales y anuales se usa `recur.anchorDay`, el día del mes
 * original. Sin él la fecha se degrada: un vencimiento el 31 de enero
 * pasaría al 28 de febrero y se quedaría en el 28 para siempre, en vez
 * de volver al 31 en los meses que sí lo tienen.
 */
export function nextOccurrence(recur, desdeISO) {
  if (!recur) return '';
  const base = desdeISO || todayISO();
  const n = recur.interval || 1;

  if (recur.freq === 'daily')  return addDays(base, n);
  if (recur.freq === 'weekly') return addDays(base, 7 * n);

  const d = new Date(base + 'T12:00:00');
  const ancla = recur.anchorDay || d.getDate();

  if (recur.freq === 'monthly') {
    d.setDate(1);
    d.setMonth(d.getMonth() + n);
  } else if (recur.freq === 'yearly') {
    d.setDate(1);
    d.setFullYear(d.getFullYear() + n);
  } else {
    return fmt(d);
  }

  // Si el mes destino no tiene ese día (31 en abril), toma el último
  const ultimo = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(ancla, ultimo));
  return fmt(d);
}

/** Añade el día ancla a una recurrencia mensual o anual. */
export function withAnchor(recur, dueDate) {
  if (!recur || !dueDate) return recur;
  if (recur.freq !== 'monthly' && recur.freq !== 'yearly') return recur;
  if (recur.anchorDay) return recur;
  return { ...recur, anchorDay: parseInt(dueDate.slice(8, 10), 10) };
}

export const RECUR_OPTIONS = [
  { value: '',        label: 'No se repite' },
  { value: 'daily',   label: 'Cada día' },
  { value: 'weekly',  label: 'Cada semana' },
  { value: 'monthly', label: 'Cada mes' },
  { value: 'yearly',  label: 'Cada año' }
];
