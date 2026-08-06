/* ==========================================================================
   PomoMomo — Configuración
   --------------------------------------------------------------------------
   1) Crea un proyecto en https://console.firebase.google.com
   2) Agrega una "App Web" (icono </>) y copia el objeto firebaseConfig
   3) Pega los valores abajo y guarda
   4) En Firebase: Authentication → Sign-in method → habilita Google
   5) En Firebase: Firestore Database → Crear base de datos (modo producción)
   6) Copia el contenido de firestore.rules en la pestaña "Reglas"

   Nota: estas claves son públicas por diseño. La seguridad real la dan
   las reglas de Firestore, no ocultar el apiKey.
   ========================================================================== */

export const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyA0Z9Z0qtSeO51lXyn52GkNOWw1zD4hHYc",
  authDomain:        "pomomomo-72c62.firebaseapp.com",
  projectId:         "pomomomo-72c62",
  storageBucket:     "pomomomo-72c62.firebasestorage.app",
  messagingSenderId: "477966800388",
  appId:             "1:477966800388:web:c8055d77056fd19a0dc751"
};

/* Espacio de trabajo compartido. Todo el equipo usa el mismo id.
   Si más adelante quieres separar equipos, cambia este valor. */
export const WORKSPACE_ID = "principal";

/* Versión del SDK de Firebase servido desde el CDN de Google */
export const FIREBASE_SDK = "11.6.0";

/* Detecta si la configuración ya fue completada */
export const IS_CONFIGURED = !FIREBASE_CONFIG.apiKey.startsWith("PEGA_");

/* Valores por defecto del temporizador (minutos) */
export const DEFAULT_TIMER = {
  focus: 25,
  short: 5,
  long: 15,
  longEvery: 4,
  autoStartBreak: true,
  autoStartFocus: false,
  sound: true
};

/* Catálogos */
export const QUADRANTS = {
  Q1: { key: "Q1", name: "Hacer ya",     hint: "Urgente e importante",       color: "var(--q1)", tint: "var(--q1-t)", urgent: true,  important: true  },
  Q2: { key: "Q2", name: "Planificar",   hint: "Importante, no urgente",     color: "var(--q2)", tint: "var(--q2-t)", urgent: false, important: true  },
  Q3: { key: "Q3", name: "Delegar",      hint: "Urgente, no importante",     color: "var(--q3)", tint: "var(--q3-t)", urgent: true,  important: false },
  Q4: { key: "Q4", name: "Eliminar",     hint: "Ni urgente ni importante",   color: "var(--q4)", tint: "var(--q4-t)", urgent: false, important: false }
};

export const STATUSES = {
  backlog:    { key: "backlog",    name: "Backlog",     color: "var(--gray)"   },
  todo:       { key: "todo",       name: "Por hacer",   color: "var(--orange)" },
  inprogress: { key: "inprogress", name: "En progreso", color: "var(--blue)"   },
  review:     { key: "review",     name: "Revisión",    color: "var(--purple)" },
  done:       { key: "done",       name: "Completado",  color: "var(--green)"  }
};

export const STATUS_ORDER = ["backlog", "todo", "inprogress", "review", "done"];

export const PRIORITY_ORDER = ["Q1", "Q3", "Q2", "Q4"];

/* Paleta para portafolios y proyectos */
export const PALETTE = [
  "#007AFF", "#34C759", "#FF9500", "#FF3B30", "#AF52DE",
  "#5856D6", "#FF2D55", "#30B0C7", "#00C7BE", "#A2845E"
];

/* Iconos disponibles para portafolios/proyectos (claves de ui.js) */
export const TILE_ICONS = [
  "folder", "briefcase", "rocket", "target", "chart",
  "code", "sparkles", "flag", "book", "beaker"
];
