import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  canAwardElective,
  activitiesForWeek,
  createActivity,
  createInitialState,
  electiveCredits,
  evaluateCourseAlternatives,
  findConflicts,
  generateStudySuggestions,
  getActiveSessions,
  hydrateState,
  sortActivitiesByStartTime,
  updateActivity,
  validateImportedState,
} from "../planner-core.js";

const plan = JSON.parse(
  await readFile(new URL("../data/planificacion.json", import.meta.url), "utf8"),
);

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

test("crea actividades con fecha, asignatura, hora y duración válidas", () => {
  const state = createInitialState(plan);
  const activity = createActivity(plan, state, {
    type: "task", term: 1, courseId: "ec", title: "Entrega",
    date: "2026-10-08", startTime: "09:45", estimatedMinutes: 75,
  });
  assert.deepEqual(
    [activity.date, activity.courseId, activity.startTime, activity.estimatedMinutes],
    ["2026-10-08", "ec", "09:45", 75],
  );
});

test("rechaza horas inválidas y duraciones no positivas", () => {
  const state = createInitialState(plan);
  const base = { type: "task", term: 1, courseId: "ec", title: "Entrega", date: "2026-10-08", estimatedMinutes: 30 };
  for (const startTime of ["24:00", "9:30", "12:60", "no-es-hora"]) {
    assert.throws(() => createActivity(plan, state, { ...base, startTime }), /hora inicial/);
  }
  assert.throws(() => createActivity(plan, state, { ...base, startTime: "09:30", estimatedMinutes: 0 }), /duración/);
});

test("ordena actividades por hora de forma estable y deja las que no tienen hora al final", () => {
  const activities = [
    { id: "sin-1", courseId: "ec", startTime: "" },
    { id: "tarde", courseId: "ddsi", startTime: "18:00" },
    { id: "empate-a", courseId: "ec", startTime: "09:00" },
    { id: "empate-b", courseId: "fr", startTime: "09:00" },
    { id: "sin-2", courseId: "ddsi" },
  ];
  assert.deepEqual(sortActivitiesByStartTime(activities).map(({ id }) => id), [
    "empate-a", "empate-b", "tarde", "sin-1", "sin-2",
  ]);
  assert.equal(activities[0].id, "sin-1", "la función no muta la entrada");
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
