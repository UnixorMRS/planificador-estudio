import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  aggregateStudyTime,
  canAwardElective,
  createInitialState,
  electiveCredits,
  evaluateCourseAlternatives,
  findConflicts,
  filterTimeHistory,
  generateStudySuggestions,
  getActiveSessions,
  hydrateState,
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

test("el resumen semanal usa las fechas de la semana seleccionada", () => {
  const state = createInitialState(plan);
  state.tasks.push({ courseId: "ec", dueAt: "2026-10-08", estimatedMinutes: 90 });
  state.studySessions.push({ term: 1, courseId: "ec", day: 4, start: 600, end: 660, date: "2026-10-08" });
  state.timeHistory.push({ id: "h1", term: 1, courseId: "ec", date: "2026-10-08", durationMinutes: 45 });
  const selected = aggregateStudyTime(plan, state, { term: 1, weekStart: "2026-10-05" });
  const other = aggregateStudyTime(plan, state, { term: 1, weekStart: "2026-10-12" });
  assert.deepEqual(selected.totals.week, { planned: 60, estimated: 90, actual: 45 });
  assert.deepEqual(other.totals.week, { planned: 0, estimated: 0, actual: 0 });
  assert.deepEqual(other.totals.term, { planned: 60, estimated: 90, actual: 45 });
});

test("el historial se filtra sin eliminar registros de otros cuatrimestres", () => {
  const entries = [
    { id: "a", term: 1, courseId: "ec", date: "2026-10-08" },
    { id: "b", term: 2, courseId: "fr", date: "2027-03-02" },
  ];
  assert.deepEqual(filterTimeHistory(entries, { term: 2 }).map(({ id }) => id), ["b"]);
  assert.equal(entries.length, 2);
});
