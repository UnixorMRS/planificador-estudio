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
export const ACTIVITY_TYPES = ["task", "homework", "practice", "exam"];

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value ?? "") && !Number.isNaN(Date.parse(`${value}T12:00:00`));
}

export function dateToDay(value) {
  const day = new Date(`${value}T12:00:00`).getDay();
  return day || 7;
}

export function startOfWeek(value = new Date()) {
  const date = new Date(value);
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() - ((date.getDay() || 7) - 1));
  return date.toISOString().slice(0, 10);
}

export function dateForWeekDay(weekStart, day) {
  const date = new Date(`${weekStart}T12:00:00`);
  date.setDate(date.getDate() + Number(day) - 1);
  return date.toISOString().slice(0, 10);
}

export function normalizeActivity(plan, activity, fallbackTerm = 1) {
  const course = plan.courses.find(({ id }) => id === activity?.courseId);
  const date = activity?.date ?? activity?.dueAt ?? "";
  return {
    ...activity,
    type: ACTIVITY_TYPES.includes(activity?.type) ? activity.type : "task",
    term: Number(activity?.term ?? course?.term ?? fallbackTerm),
    date,
    dueAt: date,
    startTime: /^\d{2}:\d{2}$/.test(activity?.startTime ?? "") ? activity.startTime : "",
    estimatedMinutes: Math.max(1, Number(activity?.estimatedMinutes ?? 120)),
    completed: Boolean(activity?.completed),
    courseId: activity?.courseId ?? "",
    scheduledMinutes: Math.max(0, Number(activity?.scheduledMinutes ?? 0)),
  };
}

export function validateActivity(plan, activity) {
  const normalized = normalizeActivity(plan, activity);
  const course = plan.courses.find(({ id }) => id === normalized.courseId);
  if (!course) throw new Error("Selecciona una asignatura válida.");
  if (course.term !== normalized.term) {
    throw new Error("La asignatura no pertenece al cuatrimestre indicado.");
  }
  if (!validDate(normalized.date)) throw new Error("La fecha de la actividad no es válida.");
  if (!normalized.title?.trim()) throw new Error("La actividad necesita un título.");
  if (!ACTIVITY_TYPES.includes(normalized.type)) throw new Error("El tipo de actividad no es válido.");
  if (normalized.startTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(normalized.startTime)) {
    throw new Error("La hora inicial no es válida.");
  }
  return normalized;
}

export function createActivity(plan, state, values) {
  const activity = validateActivity(plan, {
    ...values,
    id: values.id ?? cryptoSafeId("activity"),
    completed: values.completed ?? false,
    scheduledMinutes: values.scheduledMinutes ?? 0,
  });
  state.tasks.push(activity);
  return activity;
}

export function updateActivity(plan, state, id, changes) {
  const index = state.tasks.findIndex((activity) => activity.id === id);
  if (index < 0) throw new Error("No se encontró la actividad.");
  const updated = validateActivity(plan, { ...state.tasks[index], ...changes, id });
  state.tasks[index] = updated;
  return updated;
}

export function activitiesForWeek(state, weekStart, term = state.term) {
  const end = dateForWeekDay(weekStart, 7);
  return state.tasks.filter((activity) =>
    activity.term === term && activity.date >= weekStart && activity.date <= end
  );
}

const DAY_MS = 86_400_000;

/** Parse and format calendar dates without depending on the browser timezone. */
export function parseISODate(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

export function toISODate(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

export function addCalendarDays(value, amount) {
  const date = typeof value === "string" ? parseISODate(value) : new Date(value);
  date.setUTCDate(date.getUTCDate() + amount);
  return toISODate(date);
}

export function startOfWeek(value) {
  const date = typeof value === "string" ? parseISODate(value) : new Date(value);
  const mondayOffset = (date.getUTCDay() + 6) % 7;
  return addCalendarDays(date, -mondayOffset);
}

export function getWeekDates(value) {
  const monday = startOfWeek(value);
  return Array.from({ length: 7 }, (_, index) => addCalendarDays(monday, index));
}

export function getMonthBounds(monthValue) {
  const month = parseISODate(`${monthValue.slice(0, 7)}-01`);
  const start = toISODate(month);
  month.setUTCMonth(month.getUTCMonth() + 1);
  month.setUTCDate(0);
  return { start, end: toISODate(month) };
}

/** Complete Monday-to-Sunday rows covering the visible month. */
export function getCalendarWeeks(monthValue) {
  const { start, end } = getMonthBounds(monthValue);
  const first = startOfWeek(start);
  const last = addCalendarDays(startOfWeek(end), 6);
  const count = Math.round((parseISODate(last) - parseISODate(first)) / DAY_MS) + 1;
  return Array.from({ length: count / 7 }, (_, week) =>
    getWeekDates(addCalendarDays(first, week * 7)),
  );
}

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
  validatePlan(plan);
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
    calendarWeeks: Object.fromEntries(
      plan.academicTerms.map((term) => [term.id, firstWeekOfTerm(term)]),
    ),
    selections,
    acceptedConflictIds: ["af-friday::ec-b2-practice"],
    topics: [],
    tasks: [],
    studySessions: [],
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
  if (!saved || typeof saved !== "object") return initial;
  if (![2, STATE_VERSION].includes(saved.version)) return initial;

  const selections = { ...initial.selections };
  for (const course of plan.courses) {
    if (saved.selections?.[course.id]) {
      selections[course.id] = {
        ...selections[course.id],
        ...saved.selections[course.id],
      };
    }
  }

  const hydrated = {
    ...initial,
    ...saved,
    selections,
    availability: { ...initial.availability, ...saved.availability },
    version: STATE_VERSION,
    calendarWeeks: Object.fromEntries(
      plan.academicTerms.map((term) => [
        term.id,
        clampWeekToTerm(
          term,
          saved.calendarWeeks?.[term.id] ?? firstWeekOfTerm(term),
        ),
      ]),
    ),
  };
  hydrated.tasks = Array.isArray(saved.tasks)
    ? saved.tasks.map((task) => normalizeActivity(plan, task, saved.term ?? 1))
    : [];
  hydrated.studySessions = Array.isArray(saved.studySessions) ? saved.studySessions : [];
  hydrated.suggestions = [];
  return hydrated;
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
  const due = new Date(`${task.date ?? task.dueAt}T23:59:59`);
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
  const weekStart = options.weekStart ?? startOfWeek(now);
  const weekEnd = dateForWeekDay(weekStart, 7);
  const weekStart = options.weekStart ? startOfWeek(options.weekStart) : null;
  const accepted =
    options.preserveAccepted === false
      ? []
      : state.studySessions.filter(
          (session) => session.term === term && (!session.date || startOfWeek(new Date(`${session.date}T12:00:00`)) === weekStart),
        );
  const classes = getActiveSessions(plan, state, term);
  const busy = [...classes, ...accepted];
  const free = DAYS.flatMap(({ id }) =>
    freeIntervalsForDay(id, state.availability[id], busy).map((interval) => ({
      ...interval,
      date: dateForWeekDay(weekStart, id),
    })),
  ).filter((interval) => interval.end - interval.start >= duration && interval.date <= weekEnd);

  const activeCourseIds = new Set(
    plan.courses
      .filter((course) => course.term === term && state.selections[course.id]?.active)
      .map(({ id }) => id),
  );
  const taskCandidates = state.tasks
    .filter(
      (task) =>
        !task.completed &&
        Number(task.term ?? plan.courses.find(({ id }) => id === task.courseId)?.term) === term &&
        activeCourseIds.has(task.courseId) &&
        new Date(`${task.date ?? task.dueAt}T23:59:59`) >= now &&
        (task.date ?? task.dueAt) >= weekStart,
    )
    .map((task) => ({
      sourceType: "task",
      sourceId: task.id,
      deadline: task.date ?? task.dueAt,
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
      if (candidate.deadline && slot.date > candidate.deadline) continue;
      const sessionDuration = Math.min(
        duration,
        candidate.remaining,
        slot.end - slot.start,
      );
      suggestions.push({
        id: cryptoSafeId("suggestion"),
        day: slot.day,
        date: slot.date,
        date: weekStart ? addCalendarDays(weekStart, slot.day - 1) : undefined,
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
          date: slot.date,
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
