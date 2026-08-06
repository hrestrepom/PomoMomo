# 🍅 PomoMomo

Gestión de **portafolios → proyectos → actividades** con matriz de Eisenhower,
tablero Kanban, diagrama de burndown, métricas y temporizador Pomodoro.

Interfaz minimalista estilo Apple. Funciona como app instalable (PWA) en
**iPhone, iPad, Mac y PC**, con sincronización en tiempo real vía Firebase.

---

## Estructura

```
PomoMomo/
├── index.html              Punto de entrada
├── manifest.webmanifest    Metadatos PWA
├── sw.js                   Service worker (offline)
├── firestore.rules         Reglas de seguridad de Firebase
├── css/
│   └── app.css             Sistema de diseño
├── js/
│   ├── config.js           ← AQUÍ pegas tu configuración de Firebase
│   ├── store.js            Capa de datos (Firestore | localStorage)
│   ├── ui.js               Iconos, hojas modales, formateo
│   ├── charts.js           Gráficas en canvas
│   └── app.js              Router y vistas
└── icons/                  Iconos de la app
```

**Sin dependencias ni build.** Es HTML, CSS y JavaScript nativo (módulos ES).

---

## Funcionalidades

| Sección | Qué hace |
|---|---|
| **Hoy** | Resumen del día: vencidas, para hoy, en progreso, tiempo enfocado |
| **Foco** | Temporizador Pomodoro con ciclos, pausas automáticas y registro por actividad |
| **Portafolios** | Agrupan proyectos por iniciativa estratégica |
| **Proyectos** | Agrupan actividades; con fechas, color, avance y puntos |
| **Actividades** | Vista **Lista**, **Matriz de Eisenhower** y **Kanban** (arrastrar y soltar) |
| **Métricas** | Burndown, distribución Eisenhower, throughput, carga por persona, puntualidad |
| **Equipo** | Invitar personas por correo y ver su carga de trabajo |
| **Ajustes** | Temporizador, exportar JSON, datos de ejemplo |

**Memoria de tareas:** cada actividad guarda un historial completo — quién la creó,
cambios de estado, reasignaciones, cambios de prioridad, pomodoros y comentarios.

---

## Paso 1 — Probar en local

Los módulos ES no funcionan con `file://`. Necesitas un servidor:

```bash
python -m http.server 5173
```

Luego abre <http://localhost:5173>.

> Sin configurar Firebase la app arranca en **modo local** (localStorage). Todo
> funciona, pero los datos viven solo en ese navegador. Ve a **Ajustes → Cargar
> datos de ejemplo** para explorarla.

---

## Paso 2 — Configurar Firebase

### 2.1 Crear el proyecto

1. Entra a <https://console.firebase.google.com> → **Agregar proyecto**
2. Nombre: `pomomomo` → puedes desactivar Google Analytics
3. Espera a que se cree

### 2.2 Registrar la app web

1. En el panel del proyecto, haz clic en el icono **`</>`** (Web)
2. Apodo: `PomoMomo` → **Registrar app**
3. Copia el objeto `firebaseConfig` que aparece

### 2.3 Pegar la configuración

Abre **`js/config.js`** y reemplaza los valores:

```js
export const FIREBASE_CONFIG = {
  apiKey:            "AIzaSy...",
  authDomain:        "pomomomo.firebaseapp.com",
  projectId:         "pomomomo",
  storageBucket:     "pomomomo.firebasestorage.app",
  messagingSenderId: "123456789012",
  appId:             "1:123456789012:web:abc123..."
};
```

> Estas claves son **públicas por diseño**. La seguridad la dan las reglas de
> Firestore, no ocultar el `apiKey`.

### 2.4 Activar el inicio de sesión con Google

1. **Authentication** → **Comenzar**
2. Pestaña **Sign-in method** → **Google** → **Habilitar**
3. Elige un correo de soporte → **Guardar**
4. Pestaña **Settings** → **Dominios autorizados** → **Agregar dominio**:
   `hrestrepom.github.io`
   (solo el dominio: sin `https://` y sin la ruta del repositorio)

### 2.5 Crear la base de datos

1. **Firestore Database** → **Crear base de datos**
2. Modo **producción** → elige la región más cercana (ej. `southamerica-east1`)
3. Pestaña **Reglas** → borra todo y pega el contenido de **`firestore.rules`**
4. **Publicar**

### 2.6 Primer inicio de sesión

Abre la app y entra con Google. **La primera cuenta que entre se vuelve
propietaria** del espacio automáticamente. Desde ahí, invita al resto desde
**Equipo → Invitar**.

---

## Paso 3 — Publicar en GitHub Pages

```bash
git add .
git commit -m "PomoMomo v2"
git push origin main
```

Luego en GitHub:

1. Tu repositorio → **Settings** → **Pages**
2. **Source**: `Deploy from a branch`
3. **Branch**: `main` → carpeta `/ (root)` → **Save**

En 1–2 minutos estará en:

```
https://hrestrepom.github.io/PomoMomo/
```

> ⚠️ No olvides agregar `hrestrepom.github.io` en **Firebase → Authentication →
> Settings → Dominios autorizados**, o el login fallará. El dominio es el mismo
> aunque renombres el repositorio: solo cambia la ruta después del dominio.

---

## Paso 4 — Instalar en tus dispositivos

### iPhone / iPad
1. Abre la URL en **Safari** (debe ser Safari, no Chrome)
2. Toca **Compartir** (⬆️) → **Añadir a pantalla de inicio**
3. Se instala como app: pantalla completa, sin barra del navegador

### Mac
- **Safari**: menú *Archivo* → *Añadir al Dock*
- **Chrome/Edge**: icono de instalar (⊕) en la barra de direcciones

### Windows
- **Chrome/Edge**: icono de instalar (⊕) en la barra de direcciones

---

## Modelo de datos

```
workspaces/principal/
├── members/{uid}        Personas con acceso
├── invites/{email}      Invitaciones pendientes
├── portfolios/{id}      Portafolios
├── projects/{id}        Proyectos     → portfolioId
├── activities/{id}      Actividades   → projectId, assigneeUid
├── history/{id}         Memoria de tareas → activityId
├── sessions/{id}        Sesiones de pomodoro
└── sprints/{id}         Sprints para el burndown
```

---

## Notas

- **Offline**: la app cachea el código y Firestore mantiene una caché local, así
  que puedes trabajar sin señal; los cambios suben al reconectar.
- **Actualizaciones**: al publicar una versión nueva, el service worker la
  detecta y avisa. Si ves contenido viejo, recarga forzando (`Ctrl+Shift+R`).
- **Datos locales previos**: la versión anterior guardaba en `pomoflow`. Esta usa
  `pomomomo.v2` y no los migra automáticamente.
