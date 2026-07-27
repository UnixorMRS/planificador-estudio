import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  canAwardElective,
  createInitialState,
  electiveCredits,
  evaluateCourseAlternatives,
  findConflicts,
  generateStudySuggestions,
  getActiveSessions,
  hydrateState,
  canCreateAcademicSession,
  clampWeekToTerm,
  getAcademicTerm,
  isDateInTerm,
  nonTeachingPeriodForDate,
  validateImportedState,
  validatePlan,
  weekDatesForTerm,
} from "../planner-core.js";

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
