import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  aggregateTimeByCourse,
  aggregateTimeByDateRange,
  aggregateTimeByIsoWeek,
  aggregateTimeByTerm,
  canAwardElective,
  activitiesForWeek,
  createActivity,
  createInitialState,
  createTimeEntry,
  elapsedMinutes,
  electiveCredits,
  evaluateCourseAlternatives,
  findConflicts,
  generateStudySuggestions,
  getCalendarWeeks,
  getMonthBounds,
  getWeekDates,
  getActiveSessions,
  hydrateState,
  validateTimeEntry,
  updateActivity,
  canCreateAcademicSession,
  clampWeekToTerm,
  getAcademicTerm,
  isDateInTerm,
  nonTeachingPeriodForDate,
  validateImportedState,
  validatePlan,
  weekDatesForTerm,
} from "../planner-core.js";

test("calcula una semana completa de lunes a domingo", () => {
  assert.deepEqual(getWeekDates("2026-07-27"), [
    "2026-07-27", "2026-07-28", "2026-07-29", "2026-07-30",
    "2026-07-31", "2026-08-01", "2026-08-02",
  ]);
});

test("calcula los límites exactos de meses normales y bisiestos", () => {
  assert.deepEqual(getMonthBounds("2026-02"), { start: "2026-02-01", end: "2026-02-28" });
  assert.deepEqual(getMonthBounds("2028-02"), { start: "2028-02-01", end: "2028-02-29" });
});

test("la cuadrícula incluye semanas que atraviesan dos meses", () => {
  const weeks = getCalendarWeeks("2026-08");
  assert.deepEqual(weeks[0], [
    "2026-07-27", "2026-07-28", "2026-07-29", "2026-07-30",
    "2026-07-31", "2026-08-01", "2026-08-02",
  ]);
  assert.deepEqual(weeks.at(-1), [
    "2026-08-31", "2026-09-01", "2026-09-02", "2026-09-03",
    "2026-09-04", "2026-09-05", "2026-09-06",
  ]);
});

const plan = JSON.parse(
  await readFile(new URL("../data/planificacion.json", import.meta.url), "utf8"),
);

test("el calendario oficial tiene límites inclusivos", () => {
  validatePlan(plan);
  const first = getAcademicTerm(plan, 1);
  assert.equal(isDateInTerm(first, "2026-09-14"), true);
  assert.equal(isDateInTerm(first, "2026-12-22"), true);
  assert.equal(isDateInTerm(first, "2026-09-13"), false);
  assert.equal(isDateInTerm(first, "2026-12-23"), false);
});

test("una semana parcial conserva los días visibles y marca los que quedan fuera", () => {
  const second = getAcademicTerm(plan, 2);
  const dates = weekDatesForTerm(second, "2027-06-04");
  assert.deepEqual(dates.map(({ date }) => date), [
    "2027-05-31", "2027-06-01", "2027-06-02", "2027-06-03",
    "2027-06-04", "2027-06-05", "2027-06-06",
  ]);
  assert.deepEqual(dates.map(({ inTerm }) => inTerm), [true, true, true, true, true, false, false]);
  assert.equal(clampWeekToTerm(second, "2027-08-01"), "2027-05-31");
});

test("los periodos no lectivos se identifican sin sacarlos del cuatrimestre", () => {
  const second = getAcademicTerm(plan, 2);
  assert.equal(isDateInTerm(second, "2027-03-24"), true);
  assert.match(nonTeachingPeriodForDate(second, "2027-03-24").label, /Santa/);
  assert.equal(nonTeachingPeriodForDate(second, "2027-04-05"), undefined);
});

test("crear una sesión fuera del cuatrimestre exige confirmación expresa", () => {
  assert.equal(canCreateAcademicSession(plan, 2, "2027-06-04"), true);
  assert.equal(canCreateAcademicSession(plan, 2, "2027-06-05"), false);
  assert.equal(canCreateAcademicSession(plan, 2, "2027-06-05", true), true);
});

test("la validación rechaza fechas imposibles, orden inverso y solapamientos", () => {
  const invalidDate = structuredClone(plan);
  invalidDate.academicTerms[0].classStart = "2026-02-30";
  assert.throws(() => validatePlan(invalidDate), /ISO no válidas/);
  const inverse = structuredClone(plan);
  inverse.academicTerms[0].classEnd = inverse.academicTerms[0].classStart;
  assert.throws(() => validatePlan(inverse), /debe preceder/);
  const overlap = structuredClone(plan);
  overlap.academicTerms[1].classStart = "2026-12-20";
  assert.throws(() => validatePlan(overlap), /no solaparse/);
});

test("el estado inicial no adjudica ninguna optativa", () => {
  const state = createInitialState(plan);
  assert.equal(electiveCredits(plan, state), 0);
  assert.equal(state.selections.diu.active, false);
  assert.equal(state.selections.pw.active, false);
});

test("la prioridad no impide adjudicar una optativa inferior", () => {
  const state = createInitialState(plan);
  state.selections.pw.active = true;
  state.selections.pw.enrollment = "awarded";
  assert.equal(electiveCredits(plan, state), 6);
  assert.equal(state.selections.diu.active, false);
});

test("el límite se aplica por créditos y admite cuatro optativas de 6 ECTS", () => {
  const state = createInitialState(plan);
  for (const id of ["diu", "abd", "sibw", "estcomp"]) {
    state.selections[id].active = true;
    state.selections[id].enrollment = "awarded";
  }
  assert.equal(electiveCredits(plan, state), 24);
  assert.equal(canAwardElective(plan, state, "mh"), false);
});

test("EC B2 y Análisis Funcional conservan su conflicto aceptado", () => {
  const state = createInitialState(plan);
  const conflicts = findConflicts(
    getActiveSessions(plan, state, 1),
    state.acceptedConflictIds,
  );
  const conflict = conflicts.find(
    ({ id }) => id === "af-friday::ec-b2-practice",
  );
  assert.ok(conflict);
  assert.equal(conflict.accepted, true);
  assert.equal(conflict.start, 690);
  assert.equal(conflict.end, 720);
});

test("IS no añade teoría cuando el subgrupo sigue pendiente", () => {
  const state = createInitialState(plan);
  state.term = 2;
  const sessions = getActiveSessions(plan, state, 2).filter(
    ({ courseId }) => courseId === "ise",
  );
  assert.deepEqual(sessions, []);
});

test("un subgrupo de IS añade solamente su práctica", () => {
  const state = createInitialState(plan);
  state.selections.ise.optionId = "a2";
  const sessions = getActiveSessions(plan, state, 2).filter(
    ({ courseId }) => courseId === "ise",
  );
  assert.equal(sessions.length, 1);
  assert.match(sessions[0].component, /Práctica/);
});

test("las alternativas conservan todas las sesiones de un grupo", () => {
  const state = createInitialState(plan);
  const alternatives = evaluateCourseAlternatives(plan, state, "ddsi", 1);
  const a2 = alternatives.find(({ id }) => id === "a2");
  assert.equal(a2.sessions.length, 2);
  assert.equal(new Set(a2.sessions.map(({ day }) => day)).size, 2);
});

test("una asignatura sin alternativas devuelve una lista vacía", () => {
  const state = createInitialState(plan);
  assert.deepEqual(
    evaluateCourseAlternatives(plan, state, "functional-analysis", 1),
    [],
  );
});

test("evalúa conflictos potenciales sin modificar la selección", () => {
  const state = createInitialState(plan);
  const selectedBefore = state.selections.ec.optionId;
  const [alternative] = evaluateCourseAlternatives(plan, state, "ec", 1);
  assert.ok(
    alternative.conflicts.some(
      ({ id }) => id === "af-friday::ec-b2-practice",
    ),
  );
  assert.equal(state.selections.ec.optionId, selectedBefore);
});

test("el generador evita clases y usa tareas de asignaturas activas", () => {
  const state = createInitialState(plan);
  state.term = 1;
  state.tasks.push({
    id: "task-1",
    type: "exam",
    courseId: "ec",
    title: "Parcial",
    dueAt: "2026-09-20",
    estimatedMinutes: 120,
    scheduledMinutes: 0,
    importance: 5,
    completed: false,
  });
  const suggestions = generateStudySuggestions(plan, state, {
    now: new Date("2026-09-01T10:00:00"),
    maxSuggestions: 2,
  });
  assert.equal(suggestions.length, 2);
  const classes = getActiveSessions(plan, state, 1);
  for (const suggestion of suggestions) {
    assert.equal(
      classes.some(
        (session) =>
          session.day === suggestion.day &&
          session.start < suggestion.end &&
          suggestion.start < session.end,
      ),
      false,
    );
  }
});

test("la importación rechaza estados que superen 24 ECTS", () => {
  const state = createInitialState(plan);
  for (const id of ["diu", "abd", "sibw", "estcomp", "mh"]) {
    state.selections[id].active = true;
    state.selections[id].enrollment = "awarded";
  }
  assert.throws(
    () => validateImportedState(plan, state),
    /máximo de créditos/,
  );
});

test("la hidratación añade nuevas asignaturas sin perder datos compatibles", () => {
  const saved = createInitialState(plan);
  saved.topics.push({ id: "topic-1", courseId: "ec", name: "Caché" });
  delete saved.selections.fr;
  const hydrated = hydrateState(plan, saved);
  assert.equal(hydrated.topics.length, 1);
  assert.ok(hydrated.selections.fr);
});

test("migra explícitamente el estado v2 sin contabilizar sesiones planificadas", () => {
  const old = createInitialState(plan);
  old.version = 2;
  delete old.timeEntries;
  old.studySessions.push({ id: "study-old", courseId: "ec", term: 1 });
  const hydrated = hydrateState(plan, old);
  assert.equal(hydrated.version, 3);
  assert.deepEqual(hydrated.timeEntries, []);
});

test("suma registros parciales confirmados sin usar la duración planificada", () => {
  const entries = [
    createTimeEntry(plan, { id: "a", courseId: "ec", term: 1, date: "2026-09-07", minutes: 20 }),
    createTimeEntry(plan, { id: "b", courseId: "ec", term: 1, date: "2026-09-07", minutes: 35 }),
  ];
  assert.deepEqual(aggregateTimeByCourse(entries), { ec: 55 });
  assert.equal(aggregateTimeByDateRange(entries, "2026-09-07", "2026-09-07"), 55);
});

test("calcula la duración real de una sesión que cruza medianoche", () => {
  assert.equal(elapsedMinutes(23 * 60 + 40, 20), 40);
});

test("agrega por semana ISO y por cuatrimestre", () => {
  const entries = [
    createTimeEntry(plan, { id: "a", courseId: "ec", term: 1, date: "2027-01-03", minutes: 25 }),
    createTimeEntry(plan, { id: "b", courseId: "ac", term: 2, date: "2027-01-04", minutes: 45 }),
  ];
  assert.deepEqual(aggregateTimeByIsoWeek(entries), { "2026-W53": 25, "2027-W01": 45 });
  assert.deepEqual(aggregateTimeByTerm(entries), { 1: 25, 2: 45 });
});

test("permite corregir un registro conservando su creación", () => {
  const original = createTimeEntry(plan, { id: "a", courseId: "ec", term: 1, date: "2026-09-07", minutes: 20 }, new Date("2026-09-08T10:00:00Z"));
  const corrected = validateTimeEntry(plan, { ...original, minutes: 30, updatedAt: "2026-09-08T11:00:00Z" });
  assert.equal(corrected.minutes, 30);
  assert.equal(corrected.createdAt, original.createdAt);
});

test("rechaza asignaturas de otro cuatrimestre y doble contabilización", () => {
  assert.throws(() => createTimeEntry(plan, { courseId: "ac", term: 1, date: "2026-09-07", minutes: 20 }), /cuatrimestre/);
  const state = createInitialState(plan);
  state.timeEntries = [
    createTimeEntry(plan, { id: "a", courseId: "ec", term: 1, date: "2026-09-07", minutes: 20, sourceSessionId: "study-1" }),
    createTimeEntry(plan, { id: "b", courseId: "ec", term: 1, date: "2026-09-08", minutes: 10, sourceSessionId: "study-1" }),
  ];
  assert.throws(() => validateImportedState(plan, state), /más de una vez/);
test("crea y edita una actividad conservando fecha y duración", () => {
  const state = createInitialState(plan);
  const activity = createActivity(plan, state, {
    type: "practice", term: 1, courseId: "ec", title: "Práctica 1",
    date: "2026-09-16", startTime: "16:30", estimatedMinutes: 90,
  });
  updateActivity(plan, state, activity.id, { title: "Práctica revisada", completed: true });
  assert.equal(state.tasks[0].date, "2026-09-16");
  assert.equal(state.tasks[0].estimatedMinutes, 90);
  assert.equal(state.tasks[0].completed, true);
});

test("rechaza una asignatura de otro cuatrimestre", () => {
  const state = createInitialState(plan);
  assert.throws(() => createActivity(plan, state, {
    type: "homework", term: 1, courseId: "ise", title: "Entrega",
    date: "2026-10-01", estimatedMinutes: 60,
  }), /cuatrimestre/);
});

test("migra tareas v2 sin descartarlas y conserva el tipo task", () => {
  const saved = createInitialState(plan);
  saved.version = 2;
  saved.tasks = [{ id: "legacy", type: "task", courseId: "ec", title: "Antigua", dueAt: "2026-09-20", estimatedMinutes: 45 }];
  const migrated = hydrateState(plan, saved);
  assert.equal(migrated.version, 3);
  assert.equal(migrated.tasks[0].date, "2026-09-20");
  assert.equal(migrated.tasks[0].type, "task");
  assert.equal(migrated.tasks[0].term, 1);
});

test("filtra actividades por semana y cuatrimestre", () => {
  const state = createInitialState(plan);
  state.tasks = [
    { id: "a", term: 1, date: "2026-09-14" },
    { id: "b", term: 1, date: "2026-09-21" },
    { id: "c", term: 2, date: "2026-09-16" },
  ];
  assert.deepEqual(activitiesForWeek(state, "2026-09-14", 1).map(({ id }) => id), ["a"]);
});

test("no sugiere sesiones posteriores a la entrega ni fuera de la semana", () => {
  const state = createInitialState(plan);
  state.availability = Object.fromEntries(Object.entries(state.availability).map(([day, value]) => [day, { ...value, start: "18:00", end: "20:00" }]));
  state.tasks.push({ id: "deadline", type: "exam", term: 1, courseId: "ec", title: "Parcial", date: "2026-09-16", estimatedMinutes: 600, scheduledMinutes: 0, importance: 5, completed: false });
  const suggestions = generateStudySuggestions(plan, state, { now: new Date("2026-09-14T08:00:00"), weekStart: "2026-09-14", maxSuggestions: 8 });
  assert.ok(suggestions.length > 0);
  assert.ok(suggestions.every(({ date }) => date >= "2026-09-14" && date <= "2026-09-16"));
});
