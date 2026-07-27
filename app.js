import {
  DAYS,
  STORAGE_KEY,
  activitiesForWeek,
  canAwardElective,
  createInitialState,
  createActivity,
  cryptoSafeId,
  electiveCredits,
  evaluateCourseAlternatives,
  findConflicts,
  generateStudySuggestions,
  getActiveSessions,
  hydrateState,
  dateForWeekDay,
  dateToDay,
  minutesToTime,
  topicProgress,
  timeToMinutes,
  startOfWeek,
  sortActivitiesByStartTime,
  updateActivity,
  validateImportedState,
} from "./planner-core.js";

function normalizeGuideUrl(value) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

const plan = await fetch("./data/planificacion.json").then(async (response) => {
  if (!response.ok) throw new Error("No se pudo cargar la planificación.");
  const data = await response.json();
  data.courses = data.courses.map((course) => ({
    ...course,
    guideUrl: normalizeGuideUrl(course.guideUrl),
  }));
  return data;
});

const elements = {
  courseList: document.querySelector("#course-list"),
  guideList: document.querySelector("#guide-list"),
  calendars: {
    1: document.querySelector("#calendar-term-1"),
    2: document.querySelector("#calendar-term-2"),
  },
  conflictSummary: document.querySelector("#conflict-summary"),
  notice: document.querySelector("#notice"),
  topicForm: document.querySelector("#topic-form"),
  topicList: document.querySelector("#topic-list"),
  topicGlossaryList: document.querySelector("#topic-glossary-list"),
  officialLinkList: document.querySelector("#official-link-list"),
  taskForm: document.querySelector("#task-form"),
  taskList: document.querySelector("#task-list"),
  suggestionList: document.querySelector("#suggestion-list"),
  generateButton: document.querySelector("#generate-button"),
  regenerationBanner: document.querySelector("#regeneration-banner"),
  settingsDialog: document.querySelector("#settings-dialog"),
  recalcDialog: document.querySelector("#recalc-dialog"),
  availabilityFields: document.querySelector("#availability-fields"),
  termMonths: {
    1: document.querySelector("#months-term-1"),
    2: document.querySelector("#months-term-2"),
  },
  calendarActivityForm: document.querySelector("#calendar-activity-form"),
};

const ACADEMIC_MONTHS = {
  1: [[2026, 8], [2026, 9], [2026, 10], [2026, 11], [2027, 0], [2027, 1]],
  2: [[2027, 1], [2027, 2], [2027, 3], [2027, 4], [2027, 5], [2027, 6]],
};

let calendarView = "classes";
let state = loadState();
let selectedWeek = startOfWeek(new Date());
const activityLabels = {
  task: "Tarea",
  homework: "Deberes",
  practice: "Práctica",
  exam: "Examen",
};

function loadState() {
  try {
    return hydrateState(plan, JSON.parse(localStorage.getItem(STORAGE_KEY)));
  } catch {
    return createInitialState(plan);
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function syncTermInterface() {
  document.querySelectorAll(".term-switch button[data-term]").forEach((button) => {
    const active = Number(button.dataset.term) === state.term;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  document.querySelectorAll("[data-term-overview]").forEach((overview) => {
    const active = Number(overview.dataset.termOverview) === state.term;
    overview.hidden = !active;
    overview.classList.toggle("is-active", active);
  });
}

function selectTerm(term) {
  state.term = Number(term);
  syncTermInterface();
  renderCourses();
  renderGuides();
  renderForms();
  renderMetrics();
  saveState();
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function courseById(id) {
  return plan.courses.find((course) => course.id === id);
}

function announce(message, tone = "warning") {
  elements.notice.hidden = false;
  elements.notice.textContent = message;
  elements.notice.dataset.tone = tone;
  window.clearTimeout(announce.timeout);
  announce.timeout = window.setTimeout(() => {
    elements.notice.hidden = true;
  }, 5000);
}

function markForRegeneration() {
  if (state.suggestions.length || state.studySessions.length) {
    state.needsRegeneration = true;
  }
}

function update(mutator, { regenerate = false } = {}) {
  mutator();
  if (regenerate) markForRegeneration();
  saveState();
  render();
}

function certaintyLabel(course) {
  if (course.id === "ec") return ["planned", "Cambio planificado"];
  if (course.certainty === "confirmed") return ["confirmed", "Confirmado"];
  return ["pending", "Pendiente"];
}

function renderCourses() {
  const courses = plan.courses.filter((course) => course.term === state.term);
  elements.courseList.innerHTML = courses
    .map((course) => {
      const selection = state.selections[course.id];
      const [tagType, tagText] = certaintyLabel(course);
      const isElective = course.type === "elective";
      const checked = selection.active ? "checked" : "";
      const disabled = !isElective ? "disabled" : "";
      const optionSelect = course.options?.length
        ? `<select class="course-select" data-course-option="${course.id}" aria-label="Subgrupo de ${escapeHtml(course.name)}">
            <option value="">Subgrupo pendiente</option>
            ${course.options
              .map(
                (option) =>
                  `<option value="${option.id}" ${selection.optionId === option.id ? "selected" : ""}>${escapeHtml(option.label)}</option>`,
              )
              .join("")}
          </select>`
        : "";
      const alternatives =
        course.type === "required"
          ? evaluateCourseAlternatives(plan, state, course.id)
          : [];
      const optionList = alternatives.length
        ? `<ul class="course-options" aria-label="Opciones de ${escapeHtml(course.name)}">
            ${alternatives
              .map((option) => {
                const selected = selection.optionId === option.id;
                return `<li class="course-option ${selected ? "is-selected" : ""}">
                  <div class="course-option__heading">
                    <strong>${escapeHtml(option.label)}</strong>
                    ${selected ? '<span class="course-option__selected">Seleccionada</span>' : ""}
                    ${option.conflicts.length ? `<span class="course-option__conflict" role="status" aria-label="Esta opción provoca ${option.conflicts.length} ${option.conflicts.length === 1 ? "solape" : "solapes"}">⚠ ${option.conflicts.length === 1 ? "Solape" : `${option.conflicts.length} solapes`}</span>` : ""}
                  </div>
                  <ul class="course-option__sessions">
                    ${option.sessions
                      .map((session) => {
                        const day = DAYS.find(({ id }) => id === session.day);
                        return `<li>${escapeHtml(day?.short ?? "Día")} · ${minutesToTime(session.start)}–${minutesToTime(session.end)} · ${escapeHtml(session.room ?? "Aula por confirmar")}</li>`;
                      })
                      .join("")}
                  </ul>
                </li>`;
              })
              .join("")}
          </ul>`
        : course.type === "required" &&
            (course.commonSessions ?? []).some((session) =>
              session.component?.toLocaleLowerCase("es").includes("práctica"),
            )
          ? '<p class="course-options-empty">Sin grupos alternativos; práctica común</p>'
          : "";
      return `
        <article class="course-card">
          <div class="course-head">
            <input type="checkbox" data-course-active="${course.id}" ${checked} ${disabled}
              aria-label="${isElective ? "Marcar como adjudicada" : "Asignatura incluida"}: ${escapeHtml(course.name)}" />
            <div class="course-main">
              <div class="course-title">
                <strong>${escapeHtml(course.abbreviation)}</strong>
                <small>${course.credits} ECTS${course.priority ? ` · prioridad ${course.priority}` : ""}</small>
              </div>
              <p class="course-name" title="${escapeHtml(course.name)}">${escapeHtml(course.name)}</p>
              <div class="course-meta">
                <span class="tag tag--${tagType}">${tagText}</span>
                ${isElective ? `<span class="tag tag--elective">${selection.active ? "Adjudicada" : "Solicitada"}</span>` : ""}
              </div>
              ${selection.active ? `${optionSelect}${optionList}` : ""}
            </div>
          </div>
        </article>`;
    })
    .join("");
}

function renderGuides() {
  const term = plan.academicTerms.find(({ id }) => id === state.term);
  const courses = plan.courses.filter((course) => course.term === state.term);

  elements.guideList.innerHTML = `<section class="guide-group" aria-labelledby="guide-term-${state.term}">
    <h3 id="guide-term-${state.term}">${escapeHtml(term?.name ?? `Cuatrimestre ${state.term}`)}</h3>
    <ul>
      ${courses
        .map((course) => {
          const label = `Abrir la guía docente de ${course.name} en la web de la UGR`;
          const link = course.guideUrl
            ? `<a href="${escapeHtml(course.guideUrl)}" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(label)}">Consultar guía <span aria-hidden="true">↗</span></a>`
            : '<span class="guide-unavailable">Guía no disponible</span>';
          return `<li class="guide-item">
            <div><strong>${escapeHtml(course.abbreviation)}</strong><span>${escapeHtml(course.name)}</span></div>
            ${link}
          </li>`;
        })
        .join("")}
    </ul>
  </section>`;
}

function sessionsForTerm(term) {
  const classes = getActiveSessions(plan, state, term);
  const studies = state.studySessions
    .filter((session) => session.term === term)
    .map((session) => ({
      ...session,
      abbreviation: courseById(session.courseId)?.abbreviation ?? "EST",
      component: session.title,
      color: "#2d8a5e",
      kind: "study",
    }));
  return calendarView === "all" ? [...classes, ...studies] : classes;
}

function renderTermCalendar(term) {
  const calendar = elements.calendars[term];
  const sessions = sessionsForTerm(term);
  const classes = getActiveSessions(plan, state, term);
  const conflicts = findConflicts(classes, state.acceptedConflictIds);
  const conflictSessionIds = new Set(
    conflicts.flatMap(({ first, second }) => [first.id, second.id]),
  );
  const start = 480;
  const end = 1290;
  const pixelsPerMinute = 42 / 30;

  calendar.innerHTML = `
    <div class="calendar-header"></div>
    ${DAYS.slice(0, 5).map((day) => `<div class="calendar-header">${day.label}</div>`).join("")}
    <div class="time-axis">
      ${Array.from({ length: (end - start) / 60 + 1 }, (_, index) => {
        const minute = start + index * 60;
        return `<span style="top:${(minute - start) * pixelsPerMinute}px">${minutesToTime(minute)}</span>`;
      }).join("")}
    </div>
    ${DAYS.slice(0, 5).map((day) => `<div class="day-column" data-day="${day.id}">
      ${sessions.filter((session) => session.day === day.id).map((session) => {
        const top = (session.start - start) * pixelsPerMinute;
        const height = Math.max(32, (session.end - session.start) * pixelsPerMinute - 4);
        return `<div class="calendar-event ${session.kind === "study" ? "calendar-event--study" : ""} ${conflictSessionIds.has(session.id) ? "calendar-event--conflict" : ""}"
          style="top:${top}px;height:${height}px;--event-color:${session.color}"
          title="${escapeHtml(session.courseName ?? session.title)} · ${minutesToTime(session.start)}–${minutesToTime(session.end)}">
          <strong>${escapeHtml(session.abbreviation)}</strong>
          <span>${minutesToTime(session.start)}–${minutesToTime(session.end)} · ${escapeHtml(session.component)}${session.room ? ` · ${escapeHtml(session.room)}` : ""}</span>
        </div>`;
      }).join("")}
    </div>`).join("")}`;

  if (!sessions.length) {
    calendar.insertAdjacentHTML("beforeend", '<p class="calendar-empty">Selecciona una asignatura o un grupo para mostrar sus clases.</p>');
  }
  return conflicts;
}

function monthDates(year, month) {
  const first = new Date(year, month, 1, 12);
  const gridStart = new Date(first);
  gridStart.setDate(first.getDate() - ((first.getDay() || 7) - 1));
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);
    return date;
  });
}

function renderTermMonths(term) {
  if (elements.termMonths[term].contains(elements.calendarActivityForm)) {
    document.querySelector(".academic-overview").append(elements.calendarActivityForm);
    elements.calendarActivityForm.hidden = true;
  }
  const academicTerm = plan.academicTerms.find(({ id }) => id === term);
  const months = ACADEMIC_MONTHS[term];
  const dayHeaders = DAYS.map(({ short }) => `<span class="month-weekday">${short.slice(0, 1)}</span>`).join("");
  elements.termMonths[term].innerHTML = months.map(([year, month]) => {
    const title = new Intl.DateTimeFormat("es-ES", { month: "long", year: "numeric" }).format(new Date(year, month, 1));
    const days = monthDates(year, month).map((date) => {
      const iso = date.toISOString().slice(0, 10);
      const items = sortActivitiesByStartTime(state.tasks.filter((item) => item.term === term && item.date === iso));
      const noClass = academicTerm.nonTeachingPeriods.some((period) => iso >= period.start && iso <= period.end);
      const outside = date.getMonth() !== month;
      const strips = items.map((activity) => {
        const course = courseById(activity.courseId);
        const start = activity.startTime ? timeToMinutes(activity.startTime) : null;
        const end = start === null ? null : start + Number(activity.estimatedMinutes ?? 0);
        const schedule = activity.startTime
          ? ` · ${activity.startTime}–${end < 24 * 60 ? minutesToTime(end) : "fin del día"}`
          : " · Sin hora";
        const description = `${activity.title} · ${course?.name ?? "Asignatura"}${schedule}`;
        return `<span class="activity-strip" style="--activity-color:${escapeHtml(course?.color ?? "#667085")}" title="${escapeHtml(description)}" aria-label="${escapeHtml(description)}"><span>${escapeHtml(activity.startTime || "—")}</span> ${escapeHtml(activity.title)}</span>`;
      }).join("");
      return `<button type="button" class="month-day ${outside ? "is-outside" : ""} ${noClass ? "is-holiday" : ""}" data-date="${iso}" data-activity-date="${iso}" data-activity-term="${term}" ${outside ? "aria-disabled=\"true\"" : ""} title="${outside ? "Día de otro mes" : noClass ? "Periodo no lectivo" : "Añadir actividad"}">
        <strong>${date.getDate()}</strong>${strips ? `<span class="activity-strips">${strips}</span>` : ""}
      </button>`;
    }).join("");
    return `<section class="month-card"><h4>${title}</h4><div class="month-calendar">${dayHeaders}${days}</div></section>`;
  }).join("");
}

function activeCourseOptionsForTerm(term) {
  return plan.courses
    .filter((course) => course.term === term && state.selections[course.id]?.active)
    .map((course) => `<option value="${course.id}">${escapeHtml(course.abbreviation)} · ${escapeHtml(course.name)}</option>`)
    .join("");
}

function openCalendarActivityForm(dayButton) {
  const form = elements.calendarActivityForm;
  const term = Number(dayButton.dataset.activityTerm);
  selectTerm(term);
  document.querySelectorAll(".month-day.is-selected").forEach((day) => day.classList.remove("is-selected"));
  dayButton.classList.add("is-selected");
  form.reset();
  form.elements.term.value = term;
  form.elements.date.value = dayButton.dataset.date;
  form.elements.estimatedMinutes.value = 60;
  form.elements.courseId.innerHTML = `<option value="">Selecciona una asignatura</option>${activeCourseOptionsForTerm(term)}`;
  dayButton.closest(".month-card").insertAdjacentElement("afterend", form);
  form.hidden = false;
  form.elements.title.focus({ preventScroll: true });
}

function closeCalendarActivityForm() {
  elements.calendarActivityForm.hidden = true;
  document.querySelectorAll(".month-day.is-selected").forEach((day) => day.classList.remove("is-selected"));
}

function renderCalendar() {
  const conflicts = [...renderTermCalendar(1), ...renderTermCalendar(2)];
  renderTermMonths(1);
  renderTermMonths(2);
  renderConflicts(conflicts.filter((conflict) =>
    conflict.first.courseId && courseById(conflict.first.courseId)?.term === state.term
  ));
}

function renderConflicts(conflicts) {
  if (!conflicts.length) {
    elements.conflictSummary.innerHTML = "";
    return;
  }
  elements.conflictSummary.innerHTML = `<div class="conflict-box">
    ${conflicts
      .map(
        (conflict) => `<button type="button" class="conflict-chip ${conflict.accepted ? "is-accepted" : ""}"
          data-${conflict.accepted ? "reopen" : "accept"}-conflict="${conflict.id}"
          title="${conflict.accepted ? "Volver a abrir el conflicto" : "Aceptar conscientemente el conflicto"}">
          ${escapeHtml(conflict.first.abbreviation)} × ${escapeHtml(conflict.second.abbreviation)}
          · ${minutesToTime(conflict.start)}–${minutesToTime(conflict.end)}
          ${conflict.accepted ? "· aceptado" : ""}
        </button>`,
      )
      .join("")}
  </div>`;
}

function courseOptions() {
  return plan.courses
    .filter((course) => course.term === state.term && state.selections[course.id]?.active)
    .map(
      (course) =>
        `<option value="${course.id}">${escapeHtml(course.abbreviation)} · ${escapeHtml(course.name)}</option>`,
    )
    .join("");
}

function renderForms() {
  const options = courseOptions();
  const topicSelect = elements.topicForm.elements.courseId;
  const taskSelect = elements.taskForm.elements.courseId;
  const topicValue = topicSelect.value;
  const taskValue = taskSelect.value;
  topicSelect.innerHTML = options;
  taskSelect.innerHTML = options;
  if ([...topicSelect.options].some((option) => option.value === topicValue)) {
    topicSelect.value = topicValue;
  }
  if ([...taskSelect.options].some((option) => option.value === taskValue)) {
    taskSelect.value = taskValue;
  }
}

function renderTopics() {
  if (!state.topics.length) {
    elements.topicList.className = "item-list empty-copy";
    elements.topicList.textContent = "Aún no hay temas.";
    return;
  }
  elements.topicList.className = "item-list";
  elements.topicList.innerHTML = state.topics
    .map((topic) => {
      const course = courseById(topic.courseId);
      return `<div class="list-item">
        <div>
          <strong>${escapeHtml(topic.name)}</strong>
          <small>${escapeHtml(course?.abbreviation ?? "")} · ${topic.component === "practice" ? "Práctica" : "Teoría"} · dificultad ${topic.difficulty}/5</small>
        </div>
        <div class="mastery">
          <label>Dominio
            <select data-topic-mastery="${topic.id}">
              ${["0 · Nuevo", "1 · Inicial", "2 · En proceso", "3 · Sólido", "4 · Dominado"]
                .map((label, value) => `<option value="${value}" ${Number(topic.mastery) === value ? "selected" : ""}>${label}</option>`)
                .join("")}
            </select>
          </label>
          <button class="icon-button" data-delete-topic="${topic.id}" aria-label="Eliminar tema">×</button>
        </div>
      </div>`;
    })
    .join("");
}

function renderOfficialLinks() {
  elements.officialLinkList.innerHTML = plan.sources.map((source) =>
    `<a href="${escapeHtml(source.url)}" target="_blank" rel="noreferrer">${escapeHtml(source.name)} <span aria-hidden="true">↗</span></a>`,
  ).join("");
}

function renderTopicGlossaries() {
  const courses = plan.courses.filter((course) => course.term === state.term);
  elements.topicGlossaryList.innerHTML = courses.map((course) => {
    const topics = state.topics.filter((topic) => topic.courseId === course.id);
    const progress = topicProgress(topics);
    const component = (kind, title) => {
      const items = topics.filter((topic) => topic.component === kind);
      return `<section class="glossary-component" data-topic-component="${kind}"><h4>${title} <span>${items.length}</span></h4>${items.length
        ? `<ul>${items.map((topic) => `<li><span>${escapeHtml(topic.name)}</span><span class="mastery-status" data-mastery="${topic.mastery}">${topic.mastery}/4 · ${["Nuevo", "Inicial", "En proceso", "Sólido", "Dominado"][topic.mastery]}</span></li>`).join("")}</ul>`
        : `<p class="glossary-empty">Sin elementos de ${title.toLowerCase()}.</p>`}</section>`;
    };
    return `<article class="glossary-card" style="--course-color: ${escapeHtml(course.color)}" data-course-color="${escapeHtml(course.color)}">
      <header><span class="course-color-marker" aria-hidden="true"></span><div><strong>${escapeHtml(course.name)}</strong><small>${escapeHtml(course.abbreviation)}</small></div><b>${progress}%</b></header>
      <div class="progress-label"><span>Dominio agregado</span><span>${progress} de 100</span></div>
      <div class="progress-track" role="progressbar" aria-label="Dominio de ${escapeHtml(course.name)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress}"><span style="width:${progress}%"></span></div>
      <div class="glossary-components">${component("theory", "Teoría")}${component("practice", "Prácticas")}</div>
    </article>`;
  }).join("");
}

function renderTasks() {
  const sorted = state.tasks.filter((task) => task.term === state.term).sort(
    (first, second) => new Date(first.date) - new Date(second.date),
  );
  if (!sorted.length) {
    elements.taskList.className = "item-list empty-copy";
    elements.taskList.textContent = "Aún no hay tareas ni exámenes.";
    return;
  }
  elements.taskList.className = "item-list";
  elements.taskList.innerHTML = sorted
    .map((task) => {
      const course = courseById(task.courseId);
      const date = new Intl.DateTimeFormat("es-ES", {
        day: "numeric",
        month: "short",
      }).format(new Date(`${task.date}T12:00:00`));
      return `<div class="list-item">
        <div>
          <strong>${escapeHtml(task.title)}</strong>
          <small>${activityLabels[task.type] ?? "Tarea"} · ${escapeHtml(course?.abbreviation ?? "")} · ${date}${task.startTime ? `, ${task.startTime}` : ""} · ${task.estimatedMinutes} min</small>
        </div>
        <div class="item-actions">
          <button class="button button--small ${task.completed ? "button--ghost" : ""}" data-toggle-task="${task.id}">
            ${task.completed ? "Reabrir" : "Completar"}
          </button>
          <button class="button button--small button--ghost" data-edit-task="${task.id}">Editar</button>
          <button class="icon-button" data-delete-task="${task.id}" aria-label="Eliminar tarea">×</button>
        </div>
      </div>`;
    })
    .join("");
}

function suggestionCard(session, accepted = false) {
  const course = courseById(session.courseId);
  const day = DAYS.find(({ id }) => id === session.day);
  return `<article class="suggestion-card ${accepted ? "is-accepted" : ""}">
    <h3>${escapeHtml(session.title)}</h3>
    <p>${escapeHtml(course?.abbreviation ?? "")} · ${escapeHtml(session.reason ?? "Sesión aceptada")}</p>
    <footer>
      <time>${day?.short} ${minutesToTime(session.start)}–${minutesToTime(session.end)}</time>
      <span class="item-actions">
        ${
          accepted
            ? `<button class="button button--small button--ghost" data-edit-session="${session.id}">Editar</button>
               <button class="icon-button" data-delete-session="${session.id}" aria-label="Eliminar sesión">×</button>`
            : `<button class="button button--small" data-accept-suggestion="${session.id}">Aceptar</button>
               <button class="icon-button" data-dismiss-suggestion="${session.id}" aria-label="Descartar sugerencia">×</button>`
        }
      </span>
    </footer>
  </article>`;
}

function renderSuggestions() {
  const content = [
    ...state.studySessions.map((session) => suggestionCard(session, true)),
    ...state.suggestions.map((session) => suggestionCard(session, false)),
  ];
  elements.suggestionList.className = content.length
    ? "suggestion-grid"
    : "suggestion-grid empty-copy";
  elements.suggestionList.innerHTML =
    content.join("") ||
    "Añade temas o tareas para generar bloques de estudio.";
  elements.regenerationBanner.hidden = !state.needsRegeneration;
}

function renderMetrics() {
  const activeCourses = plan.courses.filter(
    (course) =>
      course.term === state.term && state.selections[course.id]?.active,
  );
  const conflicts = findConflicts(
    getActiveSessions(plan, state),
    state.acceptedConflictIds,
  );
  document.querySelector("#metric-active").textContent = activeCourses.length;
  document.querySelector("#metric-credits").textContent =
    `${electiveCredits(plan, state)}/${plan.maxElectiveCredits}`;
  document.querySelector("#metric-conflicts").textContent = conflicts.filter(
    (conflict) => !conflict.accepted,
  ).length;
  document.querySelector("#metric-tasks").textContent = state.tasks.filter(
    (task) => !task.completed,
  ).length;
  document.querySelector("#term-state").textContent = activeCourses.some(
    (course) =>
      course.certainty !== "confirmed" ||
      (course.options?.length && !state.selections[course.id]?.optionId),
  )
    ? "Provisional"
    : "Definitivo";
}

function renderAvailability() {
  elements.availabilityFields.innerHTML = DAYS.map((day) => {
    const value = state.availability[day.id];
    return `<div class="availability-row">
      <input type="checkbox" data-availability-enabled="${day.id}" ${value.enabled ? "checked" : ""} aria-label="Habilitar ${day.label}" />
      <label>${day.label}</label>
      <input type="time" data-availability-start="${day.id}" value="${value.start}" aria-label="Inicio ${day.label}" />
      <input type="time" data-availability-end="${day.id}" value="${value.end}" aria-label="Fin ${day.label}" />
    </div>`;
  }).join("");
}

function render() {
  syncTermInterface();
  renderCourses();
  renderGuides();
  renderCalendar();
  renderForms();
  renderTopics();
  renderTopicGlossaries();
  renderOfficialLinks();
  renderTasks();
  renderSuggestions();
  renderMetrics();
  renderAvailability();
}

document.addEventListener("click", (event) => {
  const editTask = event.target.closest("[data-edit-task]");
  if (editTask) {
    beginTaskEdit(editTask.dataset.editTask);
    return;
  }

  const activityDate = event.target.closest("[data-activity-date]");
  if (activityDate) {
    if (activityDate.classList.contains("is-outside")) return;
    openCalendarActivityForm(activityDate);
    return;
  }

  const manageTerm = event.target.closest("[data-manage-term]");
  if (manageTerm) {
    selectTerm(manageTerm.dataset.manageTerm);
    document.querySelector("#planning-options").scrollIntoView({ behavior: "smooth" });
    return;
  }
  const jumpTarget = event.target.closest("[data-jump-to]");
  if (jumpTarget) {
    document.querySelector(`#${jumpTarget.dataset.jumpTo}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }

  const termButton = event.target.closest("[data-term]");
  if (termButton) {
    selectTerm(termButton.dataset.term);
    return;
  }

  const viewButton = event.target.closest("[data-view]");
  if (viewButton) {
    calendarView = viewButton.dataset.view;
    document.querySelectorAll("[data-view]").forEach((button) => {
      button.classList.toggle("is-active", button === viewButton);
    });
    renderCalendar();
    return;
  }

  const deleteTopic = event.target.closest("[data-delete-topic]");
  if (deleteTopic) {
    update(
      () => {
        state.topics = state.topics.filter(
          ({ id }) => id !== deleteTopic.dataset.deleteTopic,
        );
      },
      { regenerate: true },
    );
    return;
  }

  const toggleTask = event.target.closest("[data-toggle-task]");
  if (toggleTask) {
    update(
      () => {
        const task = state.tasks.find(
          ({ id }) => id === toggleTask.dataset.toggleTask,
        );
        task.completed = !task.completed;
      },
      { regenerate: true },
    );
    return;
  }

  const deleteTask = event.target.closest("[data-delete-task]");
  if (deleteTask) {
    update(
      () => {
        state.tasks = state.tasks.filter(
          ({ id }) => id !== deleteTask.dataset.deleteTask,
        );
      },
      { regenerate: true },
    );
    return;
  }

  const accept = event.target.closest("[data-accept-suggestion]");
  if (accept) {
    update(() => {
      const session = state.suggestions.find(
        ({ id }) => id === accept.dataset.acceptSuggestion,
      );
      if (!session) return;
      state.suggestions = state.suggestions.filter(({ id }) => id !== session.id);
      state.studySessions.push({
        ...session,
        id: cryptoSafeId("study"),
        term: state.term,
        kind: "study",
      });
      const task = state.tasks.find(({ id }) => id === session.sourceId);
      if (task) {
        task.scheduledMinutes =
          Number(task.scheduledMinutes ?? 0) + (session.end - session.start);
      }
    });
    return;
  }

  const dismiss = event.target.closest("[data-dismiss-suggestion]");
  if (dismiss) {
    update(() => {
      state.suggestions = state.suggestions.filter(
        ({ id }) => id !== dismiss.dataset.dismissSuggestion,
      );
    });
    return;
  }

  const deleteSession = event.target.closest("[data-delete-session]");
  if (deleteSession) {
    update(() => {
      const session = state.studySessions.find(
        ({ id }) => id === deleteSession.dataset.deleteSession,
      );
      const task = state.tasks.find(({ id }) => id === session?.sourceId);
      if (task && session) {
        task.scheduledMinutes = Math.max(
          0,
          Number(task.scheduledMinutes ?? 0) - (session.end - session.start),
        );
      }
      state.studySessions = state.studySessions.filter(
        ({ id }) => id !== deleteSession.dataset.deleteSession,
      );
    });
    return;
  }

  const editSession = event.target.closest("[data-edit-session]");
  if (editSession) editStudySession(editSession.dataset.editSession);

  const acceptConflict = event.target.closest("[data-accept-conflict]");
  if (acceptConflict) {
    update(() => {
      state.acceptedConflictIds.push(acceptConflict.dataset.acceptConflict);
    });
    return;
  }

  const reopenConflict = event.target.closest("[data-reopen-conflict]");
  if (reopenConflict) {
    update(() => {
      state.acceptedConflictIds = state.acceptedConflictIds.filter(
        (id) => id !== reopenConflict.dataset.reopenConflict,
      );
    });
  }
});

function prepareTaskForm(date, startTime = "") {
  elements.taskForm.reset();
  elements.taskForm.elements.id.value = "";
  elements.taskForm.elements.date.value = date;
  elements.taskForm.elements.startTime.value = startTime;
  elements.taskForm.elements.estimatedMinutes.value = 120;
  elements.taskForm.elements.importance.value = 3;
  elements.taskForm.querySelector("[data-task-submit]").textContent = "Añadir";
  elements.taskForm.querySelector("[data-cancel-task-edit]").hidden = true;
  elements.taskForm.scrollIntoView({ behavior: "smooth", block: "center" });
  elements.taskForm.elements.title.focus({ preventScroll: true });
}

function beginTaskEdit(id) {
  const task = state.tasks.find((item) => item.id === id);
  if (!task) return;
  for (const field of ["id", "type", "courseId", "title", "date", "startTime", "estimatedMinutes", "importance"]) {
    if (elements.taskForm.elements[field]) elements.taskForm.elements[field].value = task[field] ?? "";
  }
  elements.taskForm.querySelector("[data-task-submit]").textContent = "Guardar";
  elements.taskForm.querySelector("[data-cancel-task-edit]").hidden = false;
  elements.taskForm.scrollIntoView({ behavior: "smooth", block: "center" });
}

elements.taskForm.querySelector("[data-cancel-task-edit]").addEventListener("click", () => prepareTaskForm(""));
elements.calendarActivityForm.querySelector("[data-cancel-calendar-activity]").addEventListener("click", closeCalendarActivityForm);
elements.calendarActivityForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  try {
    const term = Number(data.get("term"));
    createActivity(plan, state, {
      type: "task",
      term,
      date: data.get("date"),
      courseId: data.get("courseId"),
      title: data.get("title").trim(),
      startTime: data.get("startTime"),
      estimatedMinutes: Number(data.get("estimatedMinutes")),
      importance: 3,
    });
    state.term = term;
    saveState();
    closeCalendarActivityForm();
    render();
    announce("Actividad guardada.", "success");
  } catch (error) {
    announce(error.message);
  }
});
elements.courseList.addEventListener("change", (event) => {
  const activeId = event.target.dataset.courseActive;
  if (activeId) {
    const course = courseById(activeId);
    if (course.type !== "elective") return;
    const shouldActivate = event.target.checked;
    if (shouldActivate && !canAwardElective(plan, state, activeId)) {
      event.target.checked = false;
      announce("No se pueden superar los 24 créditos optativos.");
      return;
    }
    update(
      () => {
        state.selections[activeId].active = shouldActivate;
        state.selections[activeId].enrollment = shouldActivate
          ? "awarded"
          : "requested";
        if (!shouldActivate) state.selections[activeId].optionId = "";
      },
      { regenerate: true },
    );
    return;
  }

  const optionId = event.target.dataset.courseOption;
  if (optionId) {
    update(
      () => {
        state.selections[optionId].optionId = event.target.value;
      },
      { regenerate: true },
    );
  }
});

elements.topicList.addEventListener("change", (event) => {
  const topicId = event.target.dataset.topicMastery;
  if (!topicId) return;
  update(
    () => {
      state.topics.find(({ id }) => id === topicId).mastery = Number(
        event.target.value,
      );
    },
    { regenerate: true },
  );
});

elements.topicForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  update(
    () => {
      state.topics.push({
        id: cryptoSafeId("topic"),
        courseId: data.get("courseId"),
        name: data.get("name").trim(),
        difficulty: Number(data.get("difficulty")),
        component: data.get("component"),
        mastery: 0,
      });
      event.currentTarget.reset();
    },
    { regenerate: true },
  );
});

elements.taskForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  try {
    update(
      () => {
        const values = {
        type: data.get("type"),
        term: state.term,
        courseId: data.get("courseId"),
        title: data.get("title").trim(),
        date: data.get("date"),
        startTime: data.get("startTime"),
        estimatedMinutes: Number(data.get("estimatedMinutes")),
        importance: Number(data.get("importance")),
        };
        const id = data.get("id");
        if (id) updateActivity(plan, state, id, values);
        else createActivity(plan, state, values);
        event.currentTarget.reset();
        event.currentTarget.elements.estimatedMinutes.value = 120;
        event.currentTarget.elements.importance.value = 3;
        event.currentTarget.querySelector("[data-task-submit]").textContent = "Añadir";
        event.currentTarget.querySelector("[data-cancel-task-edit]").hidden = true;
      },
      { regenerate: true },
    );
  } catch (error) {
    announce(error.message);
  }
});

function runGenerator(preserveAccepted) {
  update(() => {
    if (!preserveAccepted) {
      state.studySessions = state.studySessions.filter(
        (session) => session.term !== state.term,
      );
      state.tasks.forEach((task) => {
        task.scheduledMinutes = state.studySessions
          .filter((session) => session.sourceId === task.id)
          .reduce((total, session) => total + session.end - session.start, 0);
      });
    }
    state.suggestions = generateStudySuggestions(plan, state, {
      preserveAccepted,
      term: state.term,
      weekStart: selectedWeek,
    });
    state.needsRegeneration = false;
  });
  if (!state.suggestions.length) {
    announce("Añade tareas pendientes o temas con dominio inferior a 4.");
  }
}

elements.generateButton.addEventListener("click", () => {
  if (state.studySessions.length || state.suggestions.length) {
    elements.recalcDialog.showModal();
  } else {
    runGenerator(true);
  }
});
document.querySelector("#recalculate-button").addEventListener("click", () => {
  elements.recalcDialog.showModal();
});
document.querySelector("#keep-sessions").addEventListener("click", () => {
  elements.recalcDialog.close();
  runGenerator(true);
});
document.querySelector("#rebuild-sessions").addEventListener("click", () => {
  elements.recalcDialog.close();
  runGenerator(false);
});
document.querySelector("#cancel-recalc").addEventListener("click", () => {
  elements.recalcDialog.close();
});

function editStudySession(id) {
  const session = state.studySessions.find((item) => item.id === id);
  if (!session) return;
  const current = `${session.day},${minutesToTime(session.start)},${minutesToTime(session.end)}`;
  const value = window.prompt(
    "Introduce día (1–7), inicio y fin separados por comas:",
    current,
  );
  if (!value) return;
  const [dayValue, startValue, endValue] = value.split(",").map((part) => part.trim());
  const day = Number(dayValue);
  const start = timeToMinutes(startValue);
  const end = timeToMinutes(endValue);
  if (
    !Number.isInteger(day) ||
    day < 1 ||
    day > 7 ||
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start >= end
  ) {
    announce("La sesión no tiene un día u horario válido.");
    return;
  }
  update(() => {
    session.day = day;
    session.start = start;
    session.end = end;
  });
}

document.querySelector("#settings-button").addEventListener("click", () => {
  renderAvailability();
  elements.settingsDialog.showModal();
});
document.querySelector("#save-settings").addEventListener("click", (event) => {
  event.preventDefault();
  const values = Object.fromEntries(
    DAYS.map(({ id }) => {
      const start = document.querySelector(
        `[data-availability-start="${id}"]`,
      ).value;
      const end = document.querySelector(
        `[data-availability-end="${id}"]`,
      ).value;
      return [
        id,
        {
          enabled: document.querySelector(
            `[data-availability-enabled="${id}"]`,
          ).checked,
          start,
          end,
        },
      ];
    }),
  );
  const invalid = DAYS.find(
    ({ id }) =>
      !values[id].start ||
      !values[id].end ||
      timeToMinutes(values[id].start) >= timeToMinutes(values[id].end),
  );
  if (invalid) {
    announce(`Revisa la disponibilidad del ${invalid.label.toLowerCase()}.`);
    return;
  }
  update(
    () => {
      state.availability = values;
      elements.settingsDialog.close();
    },
    { regenerate: true },
  );
});

document.querySelector("#export-button").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], {
    type: "application/json",
  });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `plan-estudio-${plan.academicYear.replace("/", "-")}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
});

document.querySelector("#import-input").addEventListener("change", async (event) => {
  const [file] = event.target.files;
  if (!file) return;
  try {
    const imported = validateImportedState(plan, JSON.parse(await file.text()));
    state = imported;
    saveState();
    render();
    announce("Copia importada correctamente.", "success");
  } catch (error) {
    announce(error.message);
  } finally {
    event.target.value = "";
  }
});

document.querySelector("#reset-button").addEventListener("click", () => {
  if (!window.confirm("¿Restaurar la planificación inicial y borrar tus avances?")) {
    return;
  }
  state = createInitialState(plan);
  saveState();
  render();
});

render();
