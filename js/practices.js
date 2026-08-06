/* ==========================================================================
   PomoMomo — Prácticas de gerencia de proyectos
   --------------------------------------------------------------------------
   Biblioteca curada de prácticas de PMBOK 7, PRINCE2, marcos ágiles,
   Google (OKR/DACI) y la ingeniería de proyectos de NASA/SpaceX, más un
   diagnóstico que se calcula sobre los datos reales del espacio.

   El objetivo no es imponer un marco, sino ofrecer el siguiente paso
   razonable a partir de cómo ya trabajas.
   ========================================================================== */

import { todayISO, dayKey, daysBetween } from './ui.js';

/* ---------- Marcos de referencia ---------- */
export const FRAMEWORKS = {
  pmbok:   { id: 'pmbok',   name: 'PMBOK 7',       short: 'PMBOK',   color: '#007AFF', tint: 'rgba(0,122,255,.10)' },
  prince2: { id: 'prince2', name: 'PRINCE2',       short: 'PRINCE2', color: '#AF52DE', tint: 'rgba(175,82,222,.10)' },
  agile:   { id: 'agile',   name: 'Ágil / Scrum',  short: 'Ágil',    color: '#34C759', tint: 'rgba(52,199,89,.12)' },
  google:  { id: 'google',  name: 'Google',        short: 'Google',  color: '#FF9500', tint: 'rgba(255,149,0,.13)' },
  nasa:    { id: 'nasa',    name: 'NASA / SpaceX', short: 'NASA',    color: '#30B0C7', tint: 'rgba(48,176,199,.12)' }
};

/* ---------- Niveles de la ruta de adopción ---------- */
export const LEVELS = {
  1: { id: 1, name: 'Fundamentos',  hint: 'Higiene básica: que nada se pierda y todo tenga dueño y fecha.' },
  2: { id: 2, name: 'Gestión',      hint: 'Control del alcance, el riesgo y el valor: decidir con evidencia.' },
  3: { id: 3, name: 'Ingeniería',   hint: 'Rigor de proyectos complejos: líneas base, revisiones y aprendizaje.' }
};

/* ==========================================================================
   Biblioteca de prácticas
   ========================================================================== */
export const PRACTICES = [

  /* ---------- Nivel 1 — Fundamentos ---------- */
  {
    id: 'single-owner', level: 1, domain: 'Ejecución', framework: 'nasa',
    name: 'Un responsable único por actividad',
    summary: 'Cada tarea tiene una sola persona con la responsabilidad, no un comité.',
    why: 'SpaceX y Amazon lo llaman "single-threaded owner": cuando la responsabilidad se reparte, nadie responde. En RACI es la "R": puede haber muchos consultados, pero un solo responsable.',
    how: 'Asigna responsable en toda actividad. Si no sabes a quién, es señal de que la actividad aún no está lista para ejecutarse.',
    signals: ['Actividades sin responsable', 'Tareas que nadie mueve durante semanas'],
    inApp: true
  },
  {
    id: 'definition-of-done', level: 1, domain: 'Ejecución', framework: 'agile',
    name: 'Definición de Terminado (DoD)',
    summary: 'Un criterio explícito y común de qué significa que algo está realmente hecho.',
    why: 'Sin DoD, "terminado" es opinión. Es la principal fuente de retrabajo y de sorpresas al cierre. Scrum lo considera un compromiso, no un opcional.',
    how: 'Escribe en las notas de cada actividad los criterios de aceptación. Empieza con una regla general para todo el proyecto: por ejemplo "probado, documentado y revisado por alguien más".',
    signals: ['Tareas que vuelven de Revisión a En progreso', 'Discusiones sobre si algo ya está listo'],
    inApp: false
  },
  {
    id: 'wip-limit', level: 1, domain: 'Ejecución', framework: 'agile',
    name: 'Límite de trabajo en curso (WIP)',
    summary: 'Poner un tope de actividades simultáneas por persona. Terminar antes que empezar.',
    why: 'Ley de Little: cuanto más trabajo abierto, más largo el tiempo de ciclo de todo. Multiplicar tareas simultáneas no aumenta la producción, aumenta el retraso y el costo de cambio de contexto.',
    how: 'Fija un tope de 2 o 3 actividades En progreso. Antes de mover una nueva, cierra una. La columna En progreso del Kanban te lo hace visible.',
    signals: ['Muchas actividades En progreso a la vez', 'Cosas que avanzan lento aunque haya actividad'],
    inApp: true
  },
  {
    id: 'small-batches', level: 1, domain: 'Planificación', framework: 'agile',
    name: 'Lotes pequeños (INVEST)',
    summary: 'Dividir el trabajo en piezas de pocos días, cada una con valor propio.',
    why: 'Las tareas grandes esconden riesgo y retrasan el aprendizaje. Una actividad de 13 o 21 puntos casi siempre son varias tareas disfrazadas cuyo alcance nadie ha examinado.',
    how: 'Cuando una actividad supere los 8 puntos, divídela. Pregunta: ¿cuál es la porción más pequeña que aporta algo utilizable?',
    signals: ['Actividades de 13 o más puntos', 'Tareas que llevan semanas En progreso'],
    inApp: true
  },
  {
    id: 'due-dates', level: 1, domain: 'Planificación', framework: 'pmbok',
    name: 'Compromiso de fecha en cada actividad',
    summary: 'Toda actividad activa tiene una fecha límite realista y visible.',
    why: 'Sin fecha no existe cronograma, y sin cronograma no hay forma de detectar un retraso hasta que ya es tarde. Es la base del dominio de Planificación del PMBOK.',
    how: 'Pon fecha límite al menos a todo lo que esté en Por hacer y En progreso. El backlog puede vivir sin fecha.',
    signals: ['Actividades activas sin fecha', 'Sorpresas de última hora'],
    inApp: true
  },
  {
    id: 'timeboxing', level: 1, domain: 'Ejecución', framework: 'agile',
    name: 'Bloques de tiempo protegidos',
    summary: 'Trabajo enfocado en intervalos definidos, sin interrupciones.',
    why: 'El costo de cambiar de contexto es alto y silencioso. Un bloque de enfoque produce más que el doble de tiempo fragmentado.',
    how: 'Ya lo tienes: usa Foco para correr pomodoros sobre la actividad concreta que estés atacando. Los datos alimentan las métricas de tiempo enfocado.',
    signals: ['Días llenos sin avance visible'],
    inApp: true
  },

  /* ---------- Nivel 2 — Gestión ---------- */
  {
    id: 'charter', level: 2, domain: 'Inicio', framework: 'pmbok',
    name: 'Acta de constitución del proyecto',
    summary: 'Un documento breve que autoriza el proyecto y fija objetivo, alcance y responsable.',
    why: 'Es el primer entregable del PMBOK. Sin un enunciado de para qué existe el proyecto, el alcance se expande sin que nadie lo note y no hay criterio para decir que no.',
    how: 'Usa la descripción del proyecto para escribir: propósito, resultado esperado, qué queda fuera, quién decide y fecha objetivo. Media página basta.',
    signals: ['Proyectos sin descripción', 'Discusiones recurrentes sobre qué incluye el proyecto'],
    inApp: false
  },
  {
    id: 'business-case', level: 2, domain: 'Inicio', framework: 'prince2',
    name: 'Justificación de negocio continua',
    summary: 'Cada proyecto declara el beneficio que persigue, y se revisa si sigue vigente.',
    why: 'Es el primer principio de PRINCE2: un proyecto sin justificación vigente debe cerrarse. Evita el sesgo de costo hundido, que es la razón más común por la que se mantienen proyectos muertos.',
    how: 'En la descripción del proyecto, agrega qué beneficio concreto entrega y cómo lo medirás. Revísalo cada mes: si ya no aplica, cierra el proyecto sin culpa.',
    signals: ['Proyectos activos que nadie mueve hace meses'],
    inApp: false
  },
  {
    id: 'risk-register', level: 2, domain: 'Control', framework: 'pmbok',
    name: 'Registro de riesgos',
    summary: 'Lista viva de lo que puede salir mal, con probabilidad, impacto y respuesta.',
    why: 'La gestión de riesgos es lo que distingue administrar un proyecto de reaccionar a él. Un riesgo identificado y con respuesta preparada cuesta una fracción de lo que cuesta la misma sorpresa sin plan.',
    how: 'Por ahora: crea una actividad Q2 llamada "Riesgos de <proyecto>" y lista en sus notas cada riesgo con su respuesta. Es el paso previo a un registro formal en la app.',
    signals: ['Muchas urgencias Q1', 'Retrasos que "no se veían venir"'],
    inApp: false, planned: true
  },
  {
    id: 'stakeholders', level: 2, domain: 'Inicio', framework: 'pmbok',
    name: 'Mapa de interesados',
    summary: 'Quién se ve afectado, cuánto poder tiene y qué espera del proyecto.',
    why: 'Es un dominio de desempeño completo en el PMBOK 7. La mayoría de proyectos no fracasan por lo técnico sino por un interesado que no fue consultado a tiempo.',
    how: 'Por proyecto, lista en la descripción: quién aprueba, quién usa el resultado, quién puede bloquearlo. Clasifícalos por influencia e interés.',
    signals: ['Aprobaciones que llegan tarde', 'Cambios de alcance pedidos al final'],
    inApp: false, planned: true
  },
  {
    id: 'okr', level: 2, domain: 'Inicio', framework: 'google',
    name: 'Objetivos y Resultados Clave (OKR)',
    summary: 'Un objetivo cualitativo con 3 a 5 resultados medibles por trimestre.',
    why: 'Google los usa desde 1999 para alinear esfuerzo con impacto. Obligan a distinguir actividad de resultado: entregar 40 tareas no es un logro si ninguna movió una métrica.',
    how: 'Define el OKR a nivel de portafolio: el objetivo va en la descripción del portafolio y cada resultado clave se vuelve un proyecto o un hito con métrica.',
    signals: ['Mucha actividad sin resultado visible', 'Portafolios sin objetivo declarado'],
    inApp: false, planned: true
  },
  {
    id: 'daci', level: 2, domain: 'Control', framework: 'google',
    name: 'Decisiones con DACI',
    summary: 'Para cada decisión: quién impulsa, quién aprueba, quién contribuye y a quién se informa.',
    why: 'Las decisiones lentas o revisitadas son un costo invisible enorme. DACI nombra un único aprobador y con eso corta los ciclos infinitos de consulta.',
    how: 'Cuando una actividad implique una decisión, escribe en sus notas quién aprueba. Registra la decisión tomada como comentario: queda en el historial.',
    signals: ['Decisiones que se reabren', 'Actividades bloqueadas esperando visto bueno'],
    inApp: false
  },
  {
    id: 'retrospective', level: 2, domain: 'Cierre', framework: 'agile',
    name: 'Retrospectiva por ciclo',
    summary: 'Al cerrar cada sprint, revisar qué funcionó, qué no y qué se cambia.',
    why: 'Es el único mecanismo que hace que un equipo mejore en vez de repetir. Sin retrospectiva, los mismos problemas reaparecen indefinidamente.',
    how: 'Al terminar cada sprint, crea una actividad "Retrospectiva sprint N" y escribe en sus comentarios: qué mantener, qué dejar de hacer, qué probar. Queda en el historial.',
    signals: ['Sprints que terminan sin cierre', 'Problemas que se repiten'],
    inApp: false
  },
  {
    id: 'cadence', level: 2, domain: 'Control', framework: 'agile',
    name: 'Cadencia fija de planificación',
    summary: 'Ciclos de duración constante para planificar, revisar y ajustar.',
    why: 'La cadencia regular convierte la planificación en un hábito en vez de una crisis. Además hace comparable la velocidad entre ciclos, que es lo que permite pronosticar.',
    how: 'Mantén sprints activos de duración fija (1 o 2 semanas). El burndown y la velocidad solo tienen sentido con ciclos comparables.',
    signals: ['Sin sprint activo', 'Sprints de duración variable'],
    inApp: true
  },
  {
    id: 'aging-wip', level: 2, domain: 'Control', framework: 'agile',
    name: 'Vigilar el envejecimiento del trabajo',
    summary: 'Detectar actividades que llevan demasiado tiempo sin moverse.',
    why: 'En Kanban, el envejecimiento predice el retraso mejor que cualquier estimación. Una tarea estancada suele indicar un bloqueo que nadie ha declarado.',
    how: 'Revisa semanalmente lo que lleve más de 10 días En progreso. Pregunta qué la bloquea y decide: desbloquear, dividir o devolver al backlog.',
    signals: ['Actividades En progreso hace semanas'],
    inApp: true
  },
  {
    id: 'tolerances', level: 2, domain: 'Control', framework: 'prince2',
    name: 'Tolerancias y escalamiento por excepción',
    summary: 'Definir cuánta desviación se acepta antes de tener que escalar.',
    why: 'PRINCE2 evita tanto el micromanagement como las sorpresas: mientras el proyecto se mantenga dentro de tolerancia, avanza solo; al salirse, se escala automáticamente.',
    how: 'Define tu umbral: por ejemplo, si el burndown se desvía más del 20% del ideal, se replanifica. La página de Métricas ya te muestra la desviación.',
    signals: ['Retrasos que se informan demasiado tarde'],
    inApp: true
  },

  /* ---------- Nivel 3 — Ingeniería de proyectos ---------- */
  {
    id: 'wbs', level: 3, domain: 'Planificación', framework: 'pmbok',
    name: 'Estructura de desglose por entregables (EDT/WBS)',
    summary: 'Descomponer el proyecto por productos entregables, no por tareas sueltas.',
    why: 'La EDT es la columna vertebral del alcance: si algo no está en ella, no está en el proyecto. Organizar por entregables en vez de por actividades evita el trabajo que no conduce a nada.',
    how: 'Hoy puedes aproximarlo agrupando actividades por entregable en el nombre, por ejemplo "[Portal] Autenticación". El nivel de entregable en la app está en el plan.',
    signals: ['Actividades que no se sabe a qué entregable pertenecen'],
    inApp: false, planned: true
  },
  {
    id: 'baseline-evm', level: 3, domain: 'Control', framework: 'pmbok',
    name: 'Línea base y valor ganado (EVM)',
    summary: 'Congelar el plan inicial y medir avance real contra él con SPI y CPI.',
    why: 'Sin línea base no se puede afirmar que haya retraso: solo se compara contra un plan que se movió. El valor ganado es el estándar de la industria para medir desempeño de forma objetiva.',
    how: 'El burndown actual compara contra un ideal lineal, que es una aproximación. Una línea base congelada al iniciar el sprint es el siguiente paso.',
    signals: ['Fechas que se mueven sin dejar rastro'],
    inApp: false, planned: true
  },
  {
    id: 'stage-gates', level: 3, domain: 'Control', framework: 'nasa',
    name: 'Revisiones por hitos (fases y puntos de decisión)',
    summary: 'Puertas formales donde se decide continuar, corregir o cancelar.',
    why: 'La NASA estructura sus proyectos en fases separadas por Key Decision Points (PDR, CDR). PRINCE2 lo llama gestión por fases. La idea es la misma: no se compromete la fase siguiente hasta comprobar que la actual cumplió.',
    how: 'Define 3 o 4 hitos por proyecto y crea una actividad de revisión en cada uno, con criterios de salida explícitos en las notas.',
    signals: ['Proyectos largos sin puntos de control'],
    inApp: false, planned: true
  },
  {
    id: 'margin', level: 3, domain: 'Planificación', framework: 'nasa',
    name: 'Reserva y margen explícitos',
    summary: 'Presupuestar deliberadamente tiempo de contingencia, en vez de inflar cada estimación.',
    why: 'La NASA gestiona el margen como un recurso que se consume y se reporta. Esconder colchón dentro de cada tarea lo desperdicia, porque el trabajo se expande hasta llenar el tiempo disponible (ley de Parkinson).',
    how: 'Estima las actividades sin colchón y añade una reserva del 15–20% al final del sprint. Si la consumes, es información: tu estimación necesita ajuste.',
    signals: ['Todo se entrega justo en la fecha', 'Estimaciones infladas por costumbre'],
    inApp: false
  },
  {
    id: 'vv', level: 3, domain: 'Control', framework: 'nasa',
    name: 'Verificación y validación',
    summary: 'Verificar que se construyó bien; validar que se construyó lo correcto.',
    why: 'Son preguntas distintas y ambas necesarias. Un entregable puede cumplir la especificación al pie de la letra y aun así no servir para nada.',
    how: 'En los criterios de aceptación separa las dos preguntas: ¿cumple lo especificado? y ¿resuelve el problema del usuario?',
    signals: ['Entregables técnicamente correctos que nadie usa'],
    inApp: false
  },
  {
    id: 'five-steps', level: 3, domain: 'Planificación', framework: 'nasa',
    name: 'Los cinco pasos de simplificación',
    summary: 'Cuestionar el requisito, borrar la parte, simplificar, acelerar y solo entonces automatizar.',
    why: 'El algoritmo de Musk, en ese orden estricto. El error más costoso es optimizar o automatizar algo que no debió existir. Cada requisito debe tener el nombre de una persona, no de un área.',
    how: 'Antes de planificar un sprint, revisa el backlog y pregunta de cada actividad: ¿quién pidió esto y por qué? Borra sin miedo lo que esté en Q4.',
    signals: ['Backlog que solo crece', 'Muchas actividades Q4'],
    inApp: true
  },
  {
    id: 'postmortem', level: 3, domain: 'Cierre', framework: 'google',
    name: 'Postmortem sin culpables',
    summary: 'Tras un fallo, analizar el sistema que lo permitió, no a la persona.',
    why: 'Práctica central de SRE en Google. Cuando buscar culpables es la norma, la información deja de fluir y los mismos fallos se repiten en la oscuridad.',
    how: 'Ante un incidente o un retraso serio, crea una actividad de postmortem: qué pasó, línea de tiempo, causa raíz, qué cambia para que no se repita.',
    signals: ['Fallos que se repiten', 'Incidentes sin análisis posterior'],
    inApp: false
  },
  {
    id: 'lessons', level: 3, domain: 'Cierre', framework: 'prince2',
    name: 'Registro de lecciones aprendidas',
    summary: 'Capturar aprendizajes durante el proyecto, no al final.',
    why: 'Aprender de la experiencia es un principio de PRINCE2. Recogidas al cierre, las lecciones ya no sirven a nadie: hay que capturarlas cuando ocurren.',
    how: 'Usa los comentarios de las actividades para dejar constancia en el momento. El historial de PomoMomo ya conserva todo con autor y fecha.',
    signals: ['Errores repetidos entre proyectos'],
    inApp: true
  },
  {
    id: 'cycle-time', level: 3, domain: 'Control', framework: 'agile',
    name: 'Tiempo de ciclo y pronóstico probabilístico',
    summary: 'Medir cuánto tarda realmente una actividad y pronosticar con esos datos.',
    why: 'El tiempo de ciclo histórico predice mejor que la suma de estimaciones. Permite decir "el 85% de las tareas se terminan en menos de 6 días" en vez de prometer una fecha exacta.',
    how: 'La app ya guarda cuándo se creó y cuándo se completó cada actividad. La medición formal del tiempo de ciclo está en el plan.',
    signals: ['Pronósticos que fallan sistemáticamente'],
    inApp: false, planned: true
  },
  {
    id: 'config-mgmt', level: 3, domain: 'Control', framework: 'nasa',
    name: 'Gestión de configuración y trazabilidad',
    summary: 'Todo cambio queda registrado: qué cambió, quién y cuándo.',
    why: 'En proyectos complejos, la mayoría de los fallos vienen de cambios no rastreados. La trazabilidad es lo que permite reconstruir qué llevó a una situación.',
    how: 'Ya lo tienes: cada actividad conserva su historial completo de cambios de estado, asignaciones y comentarios, con autor y fecha.',
    signals: [],
    inApp: true
  }
];

/* ==========================================================================
   Diagnóstico sobre los datos reales
   ========================================================================== */

const SEV = { alta: 3, media: 2, baja: 1 };

/**
 * Ejecuta los chequeos de salud sobre el espacio de trabajo.
 * @returns {{score:number, findings:Array, checks:number}}
 */
export function diagnose(store) {
  const acts = store.data.activities;
  const projects = store.data.projects;
  const portfolios = store.data.portfolios;
  const sprints = store.data.sprints;
  const today = todayISO();

  const open = acts.filter(a => a.status !== 'done');
  const active = acts.filter(a => a.status === 'todo' || a.status === 'inprogress' || a.status === 'review');
  const inProgress = acts.filter(a => a.status === 'inprogress');
  const findings = [];

  const add = (f) => findings.push(f);
  const pct = (n, d) => (d ? Math.round(n / d * 100) : 0);

  /* Espacio prácticamente vacío: no tiene sentido diagnosticar */
  if (acts.length < 3) {
    return {
      score: null,
      empty: true,
      findings: [],
      checks: 0
    };
  }

  /* --- 1. Equilibrio de la matriz de Eisenhower --- */
  const q1 = acts.filter(a => a.quadrant === 'Q1').length;
  const q1pct = pct(q1, acts.length);
  if (q1pct > 35) {
    add({
      id: 'exceso-q1', sev: 'alta', framework: 'pmbok', practice: 'risk-register',
      title: 'Estás trabajando en modo apagaincendios',
      evidence: `${q1pct}% de tus actividades son Q1 (urgente e importante): ${q1} de ${acts.length}.`,
      meaning: 'Un Q1 alto y sostenido indica que el trabajo llega como crisis en lugar de planificarse. La causa casi siempre está en Q2: lo importante que se posterga hasta volverse urgente.',
      action: 'Revisa qué actividades Q1 pudieron ser Q2 si se hubieran anticipado. Empieza un registro de riesgos.'
    });
  }

  /* --- 2. Trabajo de bajo valor --- */
  const q4 = acts.filter(a => a.quadrant === 'Q4' && a.status !== 'done').length;
  if (q4 >= 3 && pct(q4, open.length) > 20) {
    add({
      id: 'exceso-q4', sev: 'media', framework: 'nasa', practice: 'five-steps',
      title: 'Hay trabajo abierto que quizá no debería existir',
      evidence: `${q4} actividades abiertas están en Q4 (ni urgente ni importante).`,
      meaning: 'El primer paso del algoritmo de simplificación es cuestionar el requisito y borrar la parte. Mantener trabajo de bajo valor en el tablero cuesta atención aunque nunca se ejecute.',
      action: 'Elimina o archiva lo de Q4. Si algo lleva meses ahí sin molestar a nadie, es candidato a borrarse.'
    });
  }

  /* --- 3. Responsable único --- */
  const sinResp = active.filter(a => !a.assigneeUid).length;
  if (sinResp > 0) {
    add({
      id: 'sin-responsable', sev: sinResp > active.length * 0.3 ? 'alta' : 'media',
      framework: 'nasa', practice: 'single-owner',
      title: 'Hay actividades activas sin responsable',
      evidence: `${sinResp} de ${active.length} actividades activas no tienen a nadie asignado.`,
      meaning: 'Sin un responsable único nombrado, la tarea no avanza y nadie la reporta. Es la "R" de RACI y el single-threaded owner de SpaceX.',
      action: 'Asigna responsable a todo lo que esté en Por hacer, En progreso o Revisión.'
    });
  }

  /* --- 4. Fechas comprometidas --- */
  const sinFecha = active.filter(a => !a.dueDate).length;
  if (sinFecha > 0) {
    add({
      id: 'sin-fecha', sev: sinFecha > active.length * 0.4 ? 'alta' : 'media',
      framework: 'pmbok', practice: 'due-dates',
      title: 'Actividades activas sin fecha límite',
      evidence: `${sinFecha} de ${active.length} actividades activas no tienen fecha.`,
      meaning: 'Sin fecha no hay cronograma, y sin cronograma un retraso solo se detecta cuando ya ocurrió. El backlog sí puede vivir sin fechas; lo activo no.',
      action: 'Pon fecha a lo activo. Si no puedes comprometerte a una, probablemente la actividad no esté lista para empezar.'
    });
  }

  /* --- 5. Vencidas --- */
  const vencidas = open.filter(a => a.dueDate && a.dueDate < today);
  if (vencidas.length > 0) {
    const dias = Math.max(...vencidas.map(a => Math.abs(daysBetween(today, a.dueDate))));
    add({
      id: 'vencidas', sev: vencidas.length > 4 ? 'alta' : 'media',
      framework: 'prince2', practice: 'tolerances',
      title: 'Hay compromisos vencidos',
      evidence: `${vencidas.length} actividad(es) pasaron su fecha. La más atrasada lleva ${dias} días.`,
      meaning: 'Las fechas vencidas que se dejan pasar erosionan el valor de todas las demás fechas. PRINCE2 lo maneja con tolerancias: define cuánta desviación aceptas antes de replanificar.',
      action: 'Decide sobre cada una: replanificar con fecha nueva, dividir, o cerrarla. Dejarla vencida no es una opción.'
    });
  }

  /* --- 6. Límite de WIP --- */
  const porPersona = {};
  inProgress.forEach(a => {
    const k = a.assigneeUid || '_sin';
    porPersona[k] = (porPersona[k] || 0) + 1;
  });
  const maxWip = Math.max(0, ...Object.values(porPersona));
  if (maxWip > 3) {
    add({
      id: 'wip-alto', sev: maxWip > 5 ? 'alta' : 'media',
      framework: 'agile', practice: 'wip-limit',
      title: 'Demasiado trabajo simultáneo en curso',
      evidence: `Hay hasta ${maxWip} actividades En progreso a la vez para una misma persona.`,
      meaning: 'Por la ley de Little, más trabajo abierto alarga el tiempo de ciclo de todo lo demás. Multiplicar tareas en paralelo no produce más, produce más tarde.',
      action: 'Fija un tope de 2 o 3 y respétalo: antes de empezar algo nuevo, cierra algo abierto.'
    });
  }

  /* --- 7. Envejecimiento --- */
  const estancadas = inProgress.filter(a => {
    const ref = a.updatedAt || a.createdAt;
    return ref && daysBetween(dayKey(ref), today) > 10;
  });
  if (estancadas.length > 0) {
    add({
      id: 'estancadas', sev: 'media', framework: 'agile', practice: 'aging-wip',
      title: 'Actividades estancadas en progreso',
      evidence: `${estancadas.length} actividad(es) llevan más de 10 días En progreso sin cambios.`,
      meaning: 'El envejecimiento predice el retraso mejor que cualquier estimación. Una tarea detenida casi siempre esconde un bloqueo que nadie ha declarado.',
      action: 'Revisa cada una: ¿qué la bloquea? Desbloquea, divide o devuélvela al backlog.'
    });
  }

  /* --- 8. Tamaño de lote --- */
  const grandes = open.filter(a => (+a.points || 0) >= 13);
  if (grandes.length > 0) {
    add({
      id: 'lotes-grandes', sev: 'media', framework: 'agile', practice: 'small-batches',
      title: 'Hay actividades demasiado grandes',
      evidence: `${grandes.length} actividad(es) abiertas tienen 13 puntos o más.`,
      meaning: 'Una actividad de ese tamaño casi siempre son varias tareas cuyo alcance nadie ha examinado. Esconden riesgo y retrasan el aprendizaje.',
      action: 'Divídelas en piezas de 5 puntos o menos, cada una con valor propio.'
    });
  }

  /* --- 9. Estimación --- */
  const sinPuntos = active.filter(a => !(+a.points)).length;
  if (sinPuntos > active.length * 0.3 && active.length >= 4) {
    add({
      id: 'sin-estimacion', sev: 'baja', framework: 'agile', practice: 'cycle-time',
      title: 'Falta estimación en buena parte del trabajo',
      evidence: `${sinPuntos} de ${active.length} actividades activas no tienen puntos.`,
      meaning: 'Sin estimación no hay velocidad, y sin velocidad el burndown no puede pronosticar nada.',
      action: 'Asigna puntos con la escala 1-2-3-5-8. Lo importante es la consistencia relativa, no la precisión.'
    });
  }

  /* --- 10. Cadencia --- */
  const sprintVigente = sprints.find(s => s.start <= today && s.end >= today);
  if (!sprintVigente) {
    add({
      id: 'sin-cadencia', sev: sprints.length ? 'media' : 'baja',
      framework: 'agile', practice: 'cadence',
      title: 'No hay un sprint vigente',
      evidence: sprints.length
        ? `Tienes ${sprints.length} sprint(s), pero ninguno cubre la fecha de hoy.`
        : 'Todavía no has definido ningún sprint.',
      meaning: 'La cadencia fija convierte la planificación en hábito y hace comparable la velocidad entre ciclos, que es lo que permite pronosticar.',
      action: 'Crea un sprint de 1 o 2 semanas desde Métricas y mantén la duración constante.'
    });
  }

  /* --- 11. Acta / justificación del proyecto --- */
  const sinDesc = projects.filter(p => !(p.desc || '').trim());
  if (sinDesc.length > 0) {
    add({
      id: 'sin-charter', sev: 'media', framework: 'pmbok', practice: 'charter',
      title: 'Proyectos sin objetivo declarado',
      evidence: `${sinDesc.length} de ${projects.length} proyecto(s) no tienen descripción: ${sinDesc.slice(0, 3).map(p => p.name).join(', ')}${sinDesc.length > 3 ? '…' : ''}.`,
      meaning: 'Sin un enunciado de para qué existe el proyecto, el alcance se expande sin que nadie lo note y no hay criterio para rechazar peticiones.',
      action: 'Escribe media página: propósito, resultado esperado, qué queda fuera y fecha objetivo.'
    });
  }

  /* --- 12. Horizonte del proyecto --- */
  const sinPlazo = projects.filter(p => !p.dueDate).length;
  if (sinPlazo > 0 && projects.length > 0) {
    add({
      id: 'sin-plazo-proyecto', sev: 'baja', framework: 'prince2', practice: 'stage-gates',
      title: 'Proyectos sin fecha objetivo',
      evidence: `${sinPlazo} de ${projects.length} proyecto(s) no tienen fecha de fin prevista.`,
      meaning: 'Un proyecto sin horizonte tiende a convertirse en operación permanente. PRINCE2 insiste en que un proyecto es temporal por definición.',
      action: 'Fija fecha objetivo, aunque sea aproximada. Puedes revisarla, pero debe existir.'
    });
  }

  /* --- 13. Estructura de portafolio --- */
  const huerfanos = projects.filter(p => !p.portfolioId).length;
  if (huerfanos > 0 && portfolios.length > 0) {
    add({
      id: 'proyectos-huerfanos', sev: 'baja', framework: 'google', practice: 'okr',
      title: 'Proyectos fuera de todo portafolio',
      evidence: `${huerfanos} proyecto(s) no pertenecen a ningún portafolio.`,
      meaning: 'El portafolio es donde vive el objetivo estratégico. Un proyecto sin portafolio es un proyecto sin una razón declarada de estar en la cartera.',
      action: 'Asígnalos a un portafolio, o pregúntate si deberían existir.'
    });
  }

  /* --- 14. Trazabilidad de decisiones --- */
  const conComentario = new Set(
    store.data.history.filter(h => h.type === 'comment').map(h => h.activityId)
  );
  const relevantes = acts.filter(a => (+a.points || 0) >= 5);
  if (relevantes.length >= 4) {
    const sinNota = relevantes.filter(a => !conComentario.has(a.id)).length;
    if (sinNota > relevantes.length * 0.8) {
      add({
        id: 'sin-trazabilidad', sev: 'baja', framework: 'prince2', practice: 'lessons',
        title: 'Las decisiones no están quedando registradas',
        evidence: `${sinNota} de ${relevantes.length} actividades grandes no tienen ningún comentario.`,
        meaning: 'Las lecciones se capturan cuando ocurren, no al cierre. El historial ya guarda todo con autor y fecha: solo falta usarlo.',
        action: 'Deja un comentario cuando tomes una decisión o descubras algo que valga la pena recordar.'
      });
    }
  }

  /* --- Puntuación de madurez --- */
  const CHECKS = 14;
  const penal = findings.reduce((s, f) => s + SEV[f.sev], 0);
  const maxPenal = CHECKS * SEV.alta;
  const score = Math.max(0, Math.min(100, Math.round(100 - (penal / maxPenal) * 100 * 1.6)));

  findings.sort((a, b) => SEV[b.sev] - SEV[a.sev]);

  return { score, findings, checks: CHECKS, empty: false };
}

/* ---------- Utilidades ---------- */
export const practiceById = (id) => PRACTICES.find(p => p.id === id) || null;

export function practicesByLevel(level) {
  return PRACTICES.filter(p => p.level === level);
}

export function scoreLabel(score) {
  if (score >= 85) return { text: 'Sólido', color: 'var(--green)' };
  if (score >= 65) return { text: 'En camino', color: 'var(--blue)' };
  if (score >= 45) return { text: 'Mejorable', color: 'var(--orange)' };
  return { text: 'Necesita atención', color: 'var(--red)' };
}
