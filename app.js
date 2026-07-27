import {
  DAYS,
  STORAGE_KEY,
  addCalendarDays,
  canAwardElective,
  createInitialState,
  cryptoSafeId,
  electiveCredits,
  evaluateCourseAlternatives,
  findConflicts,
  generateStudySuggestions,
  getCalendarWeeks,
  getMonthBounds,
  getWeekDates,
  getActiveSessions,
  hydrateState,
  clampWeekToTerm,
  firstWeekOfTerm,
  formatISODate,
  getAcademicTerm,
  minutesToTime,
  parseISODate,
  startOfWeek,
  timeToMinutes,
  validateImportedState,
  validatePlan,
  weekDatesForTerm,
} from "./planner-core.js";

const plan = await fetch("./data/planificacion.json").then((response) => {
  if (!response.ok) throw new Error("No se pudo cargar la planificación.");
  return response.json();
});
validatePlan(plan);

const elements = {
  courseList: document.querySelector("#course-list"),
  calendar: document.querySelector("#calendar"),
  monthGrid: document.querySelector("#month-grid"),
  monthLabel: document.querySelector("#month-label"),
  selectedWeek: document.querySelector("#selected-week"),
  conflictSummary: document.querySelector("#conflict-summary"),
  notice: document.querySelector("#notice"),
  topicForm: document.querySelector("#topic-form"),
  topicList: document.querySelector("#topic-list"),
  taskForm: document.querySelector("#task-form"),
  taskList: document.querySelector("#task-list"),
  suggestionList: document.querySelector("#suggestion-list"),
  generateButton: document.querySelector("#generate-button"),
  regenerationBanner: document.querySelector("#regeneration-banner"),
  settingsDialog: document.querySelector("#settings-dialog"),
  recalcDialog: document.querySelector("#recalc-dialog"),
  availabilityFields: document.querySelector("#availability-fields"),
  weekPicker: document.querySelector("#week-picker"),
  termDates: document.querySelector("#term-dates"),
};

let calendarView = "classes";
let state = loadState();
const today = new Date();
const todayISO = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
let selectedMonth = todayISO.slice(0, 7);
let selectedWeekStart = startOfWeek(todayISO);

const fullDateFormatter = new Intl.DateTimeFormat("es-ES", {
  weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
});
const monthFormatter = new Intl.DateTimeFormat("es-ES", {
  month: "long", year: "numeric", timeZone: "UTC",
});

function datedActivities() {
  const tasks = state.tasks.map((task) => ({
    ...task,
    date: task.date ?? task.dueAt,
    label: task.title,
    activityType: task.type === "exam" ? "Examen" : "Tarea",
  }));
  const sessions = state.studySessions
    .filter((session) => session.date)
    .map((session) => ({
      ...session,
      label: session.title,
      activityType: "Estudio",
    }));
  return [...tasks, ...sessions].filter(({ date }) => /^\d{4}-\d{2}-\d{2}$/.test(date));
}

function renderSelectedWeek() {
  const dates = getWeekDates(selectedWeekStart);
  const activities = datedActivities();
  document.querySelector("#selected-week-title").textContent =
    `Semana del ${fullDateFormatter.format(parseISODate(dates[0]))}`;
  elements.selectedWeek.innerHTML = dates.map((date) => {
    const items = activities.filter((activity) => activity.date === date);
    return `<article class="selected-week__day ${date === todayISO ? "is-today" : ""}">
      <h4><time datetime="${date}">${fullDateFormatter.format(parseISODate(date))}</time></h4>
      ${items.length ? `<ul>${items.map((item) => `<li><span>${escapeHtml(item.activityType)}</span><strong>${escapeHtml(item.label)}</strong>${item.start != null ? `<small>${minutesToTime(item.start)}–${minutesToTime(item.end)}</small>` : ""}</li>`).join("")}</ul>` : '<p class="muted">Sin actividades</p>'}
    </article>`;
  }).join("");
}

function renderMonthCalendar() {
  const weeks = getCalendarWeeks(selectedMonth);
  const { start, end } = getMonthBounds(selectedMonth);
  const activities = datedActivities();
  elements.monthLabel.textContent = monthFormatter.format(parseISODate(`${selectedMonth}-01`));
  elements.monthGrid.innerHTML = `
    ${DAYS.map(({ label, short }) => `<div class="month-grid__weekday" role="columnheader" aria-label="${label}">${short}</div>`).join("")}
    ${weeks.flatMap((week) => week.map((date) => {
      const count = activities.filter((activity) => activity.date === date).length;
      const selected = week[0] === selectedWeekStart;
      const outside = date < start || date > end;
      return `<button type="button" role="gridcell" class="month-day ${selected ? "is-selected-week" : ""} ${date === todayISO ? "is-today" : ""} ${outside ? "is-outside" : ""}" data-calendar-date="${date}" aria-pressed="${selected}" aria-label="${fullDateFormatter.format(parseISODate(date))}${count ? `, ${count} actividades` : ""}">
        <time datetime="${date}">${Number(date.slice(-2))}</time>${count ? `<span aria-hidden="true">${count}</span>` : ""}
      </button>`;
    })).join("")}`;
  renderSelectedWeek();
}

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

function activeCalendarSessions() {
  const classes = getActiveSessions(plan, state);
  const studies =
    calendarView === "all"
      ? state.studySessions
          .filter((session) => session.term === state.term)
          .map((session) => ({
            ...session,
            abbreviation: courseById(session.courseId)?.abbreviation ?? "EST",
            component: session.title,
            color: "#2d8a5e",
            kind: "study",
          }))
      : [];
  return [...classes, ...studies];
}

function renderCalendar() {
  const term = getAcademicTerm(plan, state.term);
  const weekStart = state.calendarWeeks[state.term];
  const weekDates = weekDatesForTerm(term, weekStart);
  const sessions = activeCalendarSessions();
  const classSessions = getActiveSessions(plan, state);
  const conflicts = findConflicts(classSessions, state.acceptedConflictIds);
  const conflictSessionIds = new Set(
    conflicts.flatMap(({ first, second }) => [first.id, second.id]),
  );
  const visibleDays = calendarView === "all" ? DAYS : DAYS.slice(0, 5);
  const start = 480;
  const end = 1290;
  const pixelsPerMinute = 54 / 30;

  elements.calendar.classList.toggle("is-week", calendarView === "all");
  elements.calendar.innerHTML = `
    <div class="calendar-header"></div>
    ${visibleDays.map((day) => {
      const date = weekDates[day.id - 1];
      const label = new Intl.DateTimeFormat("es-ES", {
        day: "numeric",
        month: "short",
        timeZone: "UTC",
      }).format(parseISODate(date.date));
      return `<div class="calendar-header ${!date.inTerm ? "is-outside-term" : ""} ${date.nonTeachingPeriod ? "is-non-teaching" : ""}">${day.short}<small>${label}</small>${date.nonTeachingPeriod ? `<span>${escapeHtml(date.nonTeachingPeriod.label)}</span>` : ""}</div>`;
    }).join("")}
    <div class="time-axis">
      ${Array.from({ length: (end - start) / 60 + 1 }, (_, index) => {
        const minute = start + index * 60;
        return `<span style="top:${(minute - start) * pixelsPerMinute}px">${minutesToTime(minute)}</span>`;
      }).join("")}
    </div>
    ${visibleDays
      .map(
        (day) => {
          const date = weekDates[day.id - 1];
          return `<div class="day-column ${!date.inTerm ? "is-outside-term" : ""} ${date.nonTeachingPeriod ? "is-non-teaching" : ""}" data-day="${day.id}" data-date="${date.date}">
          ${sessions
            .filter((session) => session.day === day.id && date.inTerm && !date.nonTeachingPeriod)
            .map((session) => {
              const top = (session.start - start) * pixelsPerMinute;
              const height = Math.max(32, (session.end - session.start) * pixelsPerMinute - 4);
              const conflictClass = conflictSessionIds.has(session.id)
                ? "calendar-event--conflict"
                : "";
              return `<div class="calendar-event ${session.kind === "study" ? "calendar-event--study" : ""} ${conflictClass}"
                style="top:${top}px;height:${height}px;--event-color:${session.color}"
                title="${escapeHtml(session.courseName ?? session.title)} · ${minutesToTime(session.start)}–${minutesToTime(session.end)}">
                <strong>${escapeHtml(session.abbreviation)}</strong>
                <span>${escapeHtml(session.component)}${session.room ? ` · ${escapeHtml(session.room)}` : ""}</span>
              </div>`;
            })
            .join("")}
        </div>`;
        },
      )
      .join("")}`;

  if (!sessions.length) {
    elements.calendar.insertAdjacentHTML(
      "beforeend",
      '<p class="calendar-empty">No hay sesiones activas para este cuatrimestre.</p>',
    );
  }
  renderConflicts(conflicts);
}

function renderCalendarNavigation() {
  const term = getAcademicTerm(plan, state.term);
  const first = firstWeekOfTerm(term);
  const last = clampWeekToTerm(term, term.classEnd);
  const current = state.calendarWeeks[state.term];
  elements.weekPicker.min = first;
  elements.weekPicker.max = last;
  elements.weekPicker.value = current;
  document.querySelector("#previous-month").disabled = current === first;
  document.querySelector("#next-month").disabled = current === last;
  elements.termDates.textContent = `Docencia: ${term.classStart}–${term.classEnd}. Los días sombreados son no lectivos o quedan fuera del cuatrimestre.`;
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
    .filter((course) => state.selections[course.id]?.active)
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
          <small>${escapeHtml(course?.abbreviation ?? "")} · dificultad ${topic.difficulty}/5</small>
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

function renderTasks() {
  const sorted = [...state.tasks].sort(
    (first, second) => new Date(first.dueAt) - new Date(second.dueAt),
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
      }).format(new Date(`${task.dueAt}T12:00:00`));
      return `<div class="list-item">
        <div>
          <strong>${escapeHtml(task.title)}</strong>
          <small>${task.type === "exam" ? "Examen" : "Tarea"} · ${escapeHtml(course?.abbreviation ?? "")} · ${date} · ${task.estimatedMinutes / 60} h</small>
        </div>
        <div class="item-actions">
          <button class="button button--small ${task.completed ? "button--ghost" : ""}" data-toggle-task="${task.id}">
            ${task.completed ? "Reabrir" : "Completar"}
          </button>
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
  document.querySelectorAll("[data-term]").forEach((button) => {
    button.classList.toggle("is-active", Number(button.dataset.term) === state.term);
  });
  document.querySelector("#calendar-title").textContent =
    `Horario · ${state.term}.º cuatrimestre`;
  renderCourses();
  renderCalendar();
  renderMonthCalendar();
  renderForms();
  renderTopics();
  renderTasks();
  renderSuggestions();
  renderMetrics();
  renderAvailability();
}

document.addEventListener("click", (event) => {
  const calendarDate = event.target.closest("[data-calendar-date]");
  if (calendarDate) {
    selectedWeekStart = startOfWeek(calendarDate.dataset.calendarDate);
    renderMonthCalendar();
    return;
  }
  const termButton = event.target.closest("[data-term]");
  if (termButton) {
    update(() => {
      state.term = Number(termButton.dataset.term);
      const term = getAcademicTerm(plan, state.term);
      state.calendarWeeks[state.term] = firstWeekOfTerm(term);
    });
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

function moveCalendarMonth(offset) {
  update(() => {
    const term = getAcademicTerm(plan, state.term);
    const date = parseISODate(state.calendarWeeks[state.term]);
    date.setUTCMonth(date.getUTCMonth() + offset);
    state.calendarWeeks[state.term] = clampWeekToTerm(term, formatISODate(date));
  });
}

document
  .querySelector("#previous-month")
  .addEventListener("click", () => moveCalendarMonth(-1));
document
  .querySelector("#next-month")
  .addEventListener("click", () => moveCalendarMonth(1));
elements.weekPicker.addEventListener("change", (event) => {
  update(() => {
    const term = getAcademicTerm(plan, state.term);
    state.calendarWeeks[state.term] = clampWeekToTerm(term, event.target.value);
  });
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
  update(
    () => {
      state.tasks.push({
        id: cryptoSafeId("task"),
        type: data.get("type"),
        courseId: data.get("courseId"),
        title: data.get("title").trim(),
        dueAt: data.get("dueAt"),
        date: data.get("dueAt"),
        estimatedMinutes: Number(data.get("hours")) * 60,
        scheduledMinutes: 0,
        importance: Number(data.get("importance")),
        completed: false,
      });
      event.currentTarget.reset();
      event.currentTarget.elements.hours.value = 2;
      event.currentTarget.elements.importance.value = 3;
    },
    { regenerate: true },
  );
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
      weekStart: selectedWeekStart,
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
    session.date = addCalendarDays(selectedWeekStart, day - 1);
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

function moveMonth(amount) {
  const date = parseISODate(`${selectedMonth}-01`);
  date.setUTCMonth(date.getUTCMonth() + amount);
  selectedMonth = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  selectedWeekStart = startOfWeek(`${selectedMonth}-01`);
  renderMonthCalendar();
}

document.querySelector("#previous-month").addEventListener("click", () => moveMonth(-1));
document.querySelector("#next-month").addEventListener("click", () => moveMonth(1));
elements.monthGrid.addEventListener("keydown", (event) => {
  const button = event.target.closest("[data-calendar-date]");
  if (!button || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
  event.preventDefault();
  const offset = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[event.key];
  const nextDate = addCalendarDays(button.dataset.calendarDate, offset);
  const nextMonth = nextDate.slice(0, 7);
  if (nextMonth !== selectedMonth) selectedMonth = nextMonth;
  selectedWeekStart = startOfWeek(nextDate);
  renderMonthCalendar();
  elements.monthGrid.querySelector(`[data-calendar-date="${nextDate}"]`)?.focus();
});

render();
