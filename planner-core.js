export const DAYS = [
  { id: 1, short: "Lun", label: "Lunes" },
  { id: 2, short: "Mar", label: "Martes" },
  { id: 3, short: "Mié", label: "Miércoles" },
  { id: 4, short: "Jue", label: "Jueves" },
  { id: 5, short: "Vie", label: "Viernes" },
  { id: 6, short: "Sáb", label: "Sábado" },
  { id: 7, short: "Dom", label: "Domingo" },
];

export const STORAGE_KEY = "planificador-estudio:v2";
export const STATE_VERSION = 3;

export function timeToMinutes(value) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

export function minutesToTime(value) {
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export function createInitialState(plan) {
  const selections = Object.fromEntries(
    plan.courses.map((course) => [
      course.id,
      {
        active: course.initialActive,
        enrollment: course.initialEnrollment,
        optionId: course.initialOptionId ?? "",
      },
    ]),
  );

  return {
    version: STATE_VERSION,
    term: 1,
    selections,
    acceptedConflictIds: ["af-friday::ec-b2-practice"],
    topics: [],
    tasks: [],
    studySessions: [],
    timeEntries: [],
    suggestions: [],
    availability: Object.fromEntries(
      DAYS.map(({ id }) => [
        id,
        { enabled: true, start: "08:00", end: "21:30" },
      ]),
    ),
    needsRegeneration: false,
  };
}

export function hydrateState(plan, saved) {
  const initial = createInitialState(plan);
  if (!saved) return initial;
  const migrated = migrateState(saved);
  if (migrated.version !== STATE_VERSION) return initial;

  const selections = { ...initial.selections };
  for (const course of plan.courses) {
    if (migrated.selections?.[course.id]) {
      selections[course.id] = {
        ...selections[course.id],
        ...migrated.selections[course.id],
      };
    }
  }

  return {
    ...initial,
    ...migrated,
    selections,
    timeEntries: Array.isArray(migrated.timeEntries) ? migrated.timeEntries : [],
    availability: { ...initial.availability, ...migrated.availability },
  };
}

/** Explicit v2 → v3 migration. Planned sessions deliberately create no time. */
export function migrateState(saved) {
  if (!saved || typeof saved !== "object") return saved;
  if (saved.version === 2) {
    return { ...saved, version: STATE_VERSION, timeEntries: [] };
  }
  return saved;
}

export function isIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? "")) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function validateTimeEntry(plan, entry) {
  const course = plan.courses.find(({ id }) => id === entry?.courseId);
  if (!entry?.id) throw new Error("El registro necesita un identificador.");
  if (!course) throw new Error("El registro contiene una asignatura desconocida.");
  if (![1, 2].includes(Number(entry.term)) || course.term !== Number(entry.term)) {
    throw new Error("La asignatura no pertenece al cuatrimestre del registro.");
  }
  if (!isIsoDate(entry.date)) throw new Error("La fecha del registro no es válida.");
  if (!Number.isFinite(Number(entry.minutes)) || Number(entry.minutes) <= 0) {
    throw new Error("Los minutos deben ser positivos.");
  }
  if (!entry.createdAt || !Number.isFinite(Date.parse(entry.createdAt)) ||
      !entry.updatedAt || !Number.isFinite(Date.parse(entry.updatedAt))) {
    throw new Error("Las fechas de creación y actualización no son válidas.");
  }
  return { ...entry, term: Number(entry.term), minutes: Number(entry.minutes), note: String(entry.note ?? "") };
}

export function createTimeEntry(plan, input, now = new Date()) {
  const timestamp = now.toISOString();
  return validateTimeEntry(plan, {
    id: input.id ?? cryptoSafeId("time"),
    courseId: input.courseId,
    term: Number(input.term),
    date: input.date,
    minutes: Number(input.minutes),
    ...(input.sourceSessionId ? { sourceSessionId: input.sourceSessionId } : {}),
    note: input.note ?? "",
    createdAt: input.createdAt ?? timestamp,
    updatedAt: timestamp,
  });
}

export function elapsedMinutes(start, end) {
  const duration = end - start;
  return duration > 0 ? duration : duration + 24 * 60;
}

function sumEntries(entries) {
  return entries.reduce((total, { minutes }) => total + Number(minutes), 0);
}

function groupMinutes(entries, keyFor) {
  return entries.reduce((result, entry) => {
    const key = keyFor(entry);
    result[key] = (result[key] ?? 0) + Number(entry.minutes);
    return result;
  }, {});
}

export function aggregateTimeByCourse(entries) {
  return groupMinutes(entries, ({ courseId }) => courseId);
}

export function isoWeekKey(dateValue) {
  const date = new Date(`${dateValue}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const year = date.getUTCFullYear();
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const week = Math.ceil((((date - yearStart) / 86_400_000) + 1) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

export function aggregateTimeByIsoWeek(entries) {
  return groupMinutes(entries, ({ date }) => isoWeekKey(date));
}

export function aggregateTimeByDateRange(entries, start, end) {
  if (!isIsoDate(start) || !isIsoDate(end) || start > end) {
    throw new Error("El intervalo de fechas no es válido.");
  }
  return sumEntries(entries.filter(({ date }) => date >= start && date <= end));
}

export function aggregateTimeByTerm(entries) {
  return groupMinutes(entries, ({ term }) => String(term));
}

export function getCourseSessions(course, selection) {
  if (!selection?.active) return [];
  const option = course.options?.find(({ id }) => id === selection.optionId);
  return [
    ...(course.commonSessions ?? []),
    ...(option?.sessions ?? []),
  ].map((session) => ({
    ...session,
    courseId: course.id,
    courseName: course.name,
    abbreviation: course.abbreviation,
    color: course.color,
    kind: "class",
  }));
}

export function getActiveSessions(plan, state, term = state.term) {
  return plan.courses
    .filter((course) => course.term === term)
    .flatMap((course) =>
      getCourseSessions(course, state.selections[course.id]),
    );
}

export function electiveCredits(plan, state) {
  return plan.courses
    .filter(
      (course) =>
        course.type === "elective" &&
        state.selections[course.id]?.active &&
        state.selections[course.id]?.enrollment === "awarded",
    )
    .reduce((total, course) => total + course.credits, 0);
}

export function conflictId(first, second) {
  return [first.id, second.id].sort().join("::");
}

export function findConflicts(sessions, acceptedIds = []) {
  const conflicts = [];
  for (let index = 0; index < sessions.length; index += 1) {
    for (let other = index + 1; other < sessions.length; other += 1) {
      const first = sessions[index];
      const second = sessions[other];
      if (
        first.day !== second.day ||
        first.courseId === second.courseId ||
        first.start >= second.end ||
        second.start >= first.end
      ) {
        continue;
      }
      const id = conflictId(first, second);
      conflicts.push({
        id,
        first,
        second,
        accepted: acceptedIds.includes(id),
        start: Math.max(first.start, second.start),
        end: Math.min(first.end, second.end),
      });
    }
  }
  return conflicts;
}

/**
 * Describe every possible group for a course without changing the current
 * selection. Conflicts are limited to overlaps introduced by the evaluated
 * course, so an unrelated clash elsewhere in the timetable is not attributed
 * to each alternative.
 */
export function evaluateCourseAlternatives(
  plan,
  state,
  courseId,
  term = state.term,
) {
  const course = plan.courses.find(({ id }) => id === courseId);
  if (!course || course.term !== term) return [];

  const otherSessions = plan.courses
    .filter(({ id, term: courseTerm }) => id !== courseId && courseTerm === term)
    .flatMap((otherCourse) =>
      getCourseSessions(otherCourse, state.selections[otherCourse.id]),
    );

  return (course.options ?? []).map((option) => {
    const sessions = getCourseSessions(course, {
      ...state.selections[courseId],
      active: true,
      optionId: option.id,
    });
    const conflicts = findConflicts(
      [...otherSessions, ...sessions],
      state.acceptedConflictIds,
    ).filter(
      ({ first, second }) =>
        first.courseId === courseId || second.courseId === courseId,
    );
    return { ...option, sessions: option.sessions ?? [], conflicts };
  });
}

export function canAwardElective(plan, state, courseId) {
  const course = plan.courses.find(({ id }) => id === courseId);
  if (!course || course.type !== "elective") return false;
  if (state.selections[courseId]?.active) return true;
  return electiveCredits(plan, state) + course.credits <= plan.maxElectiveCredits;
}

function sessionBusyInterval(session) {
  return {
    day: session.day,
    start: session.start,
    end: session.end,
  };
}

function freeIntervalsForDay(day, availability, busy) {
  if (!availability?.enabled) return [];
  const start = timeToMinutes(availability.start);
  const end = timeToMinutes(availability.end);
  const intervals = busy
    .filter((item) => item.day === day)
    .map(sessionBusyInterval)
    .sort((a, b) => a.start - b.start);

  const free = [];
  let cursor = start;
  for (const interval of intervals) {
    if (interval.end <= cursor || interval.start >= end) continue;
    if (interval.start > cursor) {
      free.push({ day, start: cursor, end: Math.min(interval.start, end) });
    }
    cursor = Math.max(cursor, interval.end);
  }
  if (cursor < end) free.push({ day, start: cursor, end });
  return free;
}

export function scoreTask(task, now = new Date()) {
  const due = new Date(task.dueAt);
  const days = Math.max(0.25, (due - now) / 86_400_000);
  const urgency = 30 / days;
  const typeBoost = task.type === "exam" ? 8 : 0;
  return urgency + Number(task.importance ?? 3) * 4 + typeBoost;
}

export function generateStudySuggestions(plan, state, options = {}) {
  const now = options.now ?? new Date();
  const term = options.term ?? state.term;
  const maxSuggestions = options.maxSuggestions ?? 8;
  const duration = options.duration ?? 60;
  const accepted =
    options.preserveAccepted === false
      ? []
      : state.studySessions.filter((session) => session.term === term);
  const classes = getActiveSessions(plan, state, term);
  const busy = [...classes, ...accepted];
  const free = DAYS.flatMap(({ id }) =>
    freeIntervalsForDay(id, state.availability[id], busy),
  ).filter((interval) => interval.end - interval.start >= duration);

  const activeCourseIds = new Set(
    plan.courses
      .filter((course) => state.selections[course.id]?.active)
      .map(({ id }) => id),
  );
  const taskCandidates = state.tasks
    .filter(
      (task) =>
        !task.completed &&
        activeCourseIds.has(task.courseId) &&
        new Date(task.dueAt) >= now,
    )
    .map((task) => ({
      sourceType: "task",
      sourceId: task.id,
      courseId: task.courseId,
      title: task.title,
      remaining: Math.max(
        duration,
        Number(task.estimatedMinutes ?? duration) -
          Number(task.scheduledMinutes ?? 0),
      ),
      score: scoreTask(task, now),
      reason:
        task.type === "exam"
          ? "Examen próximo y trabajo pendiente"
          : "Entrega próxima y trabajo pendiente",
    }));
  const topicCandidates = state.topics
    .filter(
      (topic) =>
        activeCourseIds.has(topic.courseId) && Number(topic.mastery) < 4,
    )
    .map((topic) => ({
      sourceType: "topic",
      sourceId: topic.id,
      courseId: topic.courseId,
      title: `Repasar: ${topic.name}`,
      remaining: duration,
      score:
        (4 - Number(topic.mastery)) * 6 + Number(topic.difficulty ?? 3) * 3,
      reason: "Dominio bajo o tema difícil",
    }));
  const queue = [...taskCandidates, ...topicCandidates].sort(
    (a, b) => b.score - a.score,
  );

  const suggestions = [];
  for (const candidate of queue) {
    while (
      candidate.remaining > 0 &&
      free.length &&
      suggestions.length < maxSuggestions
    ) {
      const slot = free.shift();
      const sessionDuration = Math.min(
        duration,
        candidate.remaining,
        slot.end - slot.start,
      );
      suggestions.push({
        id: cryptoSafeId("suggestion"),
        day: slot.day,
        start: slot.start,
        end: slot.start + sessionDuration,
        courseId: candidate.courseId,
        title: candidate.title,
        reason: candidate.reason,
        sourceType: candidate.sourceType,
        sourceId: candidate.sourceId,
        kind: "suggestion",
      });
      candidate.remaining -= sessionDuration;
      if (slot.end - (slot.start + sessionDuration) >= duration) {
        free.push({
          day: slot.day,
          start: slot.start + sessionDuration,
          end: slot.end,
        });
        free.sort((a, b) => a.day - b.day || a.start - b.start);
      }
    }
    if (suggestions.length >= maxSuggestions) break;
  }
  return suggestions;
}

export function cryptoSafeId(prefix = "item") {
  const value =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${value}`;
}

export function validateImportedState(plan, value) {
  if (!value || typeof value !== "object") {
    throw new Error("El archivo no contiene un estado válido.");
  }
  if (![2, STATE_VERSION].includes(value.version)) {
    throw new Error("La versión de la copia no es compatible.");
  }
  const hydrated = hydrateState(plan, value);
  const sourceSessionIds = new Set();
  hydrated.timeEntries = hydrated.timeEntries.map((entry) => {
    const validated = validateTimeEntry(plan, entry);
    if (validated.sourceSessionId) {
      if (sourceSessionIds.has(validated.sourceSessionId)) {
        throw new Error("Una sesión de estudio aparece contabilizada más de una vez.");
      }
      sourceSessionIds.add(validated.sourceSessionId);
    }
    return validated;
  });
  for (const course of plan.courses) {
    const selection = hydrated.selections[course.id];
    const optionIsValid =
      !selection.optionId ||
      course.options?.some((option) => option.id === selection.optionId);
    if (!optionIsValid) {
      throw new Error(`La copia contiene un subgrupo desconocido para ${course.abbreviation}.`);
    }
  }
  for (const day of DAYS) {
    const availability = hydrated.availability[day.id];
    if (
      !availability ||
      !/^\d{2}:\d{2}$/.test(availability.start) ||
      !/^\d{2}:\d{2}$/.test(availability.end) ||
      timeToMinutes(availability.start) >= timeToMinutes(availability.end)
    ) {
      throw new Error(`La disponibilidad de ${day.label} no es válida.`);
    }
  }
  if (electiveCredits(plan, hydrated) > plan.maxElectiveCredits) {
    throw new Error("La copia supera el máximo de créditos optativos.");
  }
  return hydrated;
}
