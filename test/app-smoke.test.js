import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("la interfaz no contiene identificadores HTML duplicados", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);

  assert.deepEqual([...new Set(duplicates)], []);
});

test("el módulo principal mantiene una única declaración por importación", async () => {
  const source = await readFile(new URL("../app.js", import.meta.url), "utf8");
  const importBlock = source.match(/import\s*\{([\s\S]*?)\}\s*from/);

  assert.ok(importBlock, "app.js debe importar el motor del planificador");
  const imports = importBlock[1]
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  assert.equal(new Set(imports).size, imports.length);
});

test("declara seis meses por cuatrimestre y el panel contextual completo", async () => {
  const [html, source] = await Promise.all([
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../app.js", import.meta.url), "utf8"),
  ]);
  assert.match(source, /1:\s*\[\[2026, 8\].*\[2027, 1\]\]/s);
  assert.match(source, /2:\s*\[\[2027, 1\].*\[2027, 6\]\]/s);
  assert.match(html, /id="calendar-activity-form"/);
  for (const name of ["date", "courseId", "title", "startTime", "estimatedMinutes"]) {
    assert.match(html, new RegExp(`name="${name}"`));
  }
  assert.match(html, /data-cancel-calendar-activity/);
});

test("enlaza los selectores de cuatrimestre y los días mensuales", async () => {
  const source = await readFile(new URL("../app.js", import.meta.url), "utf8");
  assert.match(source, /function selectTerm\(term\)/);
  assert.match(source, /\.term-switch button\[data-term\]/);
  assert.match(source, /data-date=/);
  assert.match(source, /openCalendarActivityForm\(activityDate\)/);
});

test("el cambio de cuatrimestre vuelve a renderizar el glosario con sus asignaturas", async () => {
  const [source, plan] = await Promise.all([
    readFile(new URL("../app.js", import.meta.url), "utf8"),
    readFile(new URL("../data/planificacion.json", import.meta.url), "utf8").then(JSON.parse),
  ]);
  const functionSource = (name) => {
    const start = source.indexOf(`function ${name}(`);
    assert.notEqual(start, -1, `falta la función ${name}`);
    const bodyStart = source.indexOf("{", start);
    let depth = 0;
    for (let index = bodyStart; index < source.length; index += 1) {
      if (source[index] === "{") depth += 1;
      if (source[index] === "}") depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
    assert.fail(`no se pudo extraer la función ${name}`);
  };
  const topicGlossaryList = { innerHTML: "" };
  const selectTerm = Function(
    "plan",
    "state",
    "elements",
    "topicProgress",
    "escapeHtml",
    "syncTermInterface",
    "renderCourses",
    "renderGuides",
    "renderForms",
    "renderMetrics",
    "saveState",
    `${functionSource("renderTopicGlossaries")}\n${functionSource("selectTerm")}\nreturn selectTerm;`,
  )(
    plan,
    { term: 1, topics: [] },
    { topicGlossaryList },
    () => 0,
    (value = "") => String(value),
    () => {},
    () => {},
    () => {},
    () => {},
    () => {},
    () => {},
  );

  for (const term of [2, 1]) {
    selectTerm(term);
    const visibleCourses = plan.courses.filter((course) => course.term === term);
    const hiddenCourses = plan.courses.filter((course) => course.term !== term);
    assert.equal(
      [...topicGlossaryList.innerHTML.matchAll(/class="glossary-card"/g)].length,
      visibleCourses.length,
    );
    for (const course of visibleCourses) {
      assert.ok(topicGlossaryList.innerHTML.includes(`>${course.name}<`));
    }
    for (const course of hiddenCourses) {
      assert.ok(!topicGlossaryList.innerHTML.includes(`>${course.name}<`));
    }
  }
});

test("todas las asignaturas ofrecen una guía HTTPS oficial de la UGR", async () => {
  const data = JSON.parse(
    await readFile(new URL("../data/planificacion.json", import.meta.url), "utf8"),
  );

  assert.ok(data.courses.length > 0);
  for (const course of data.courses) {
    assert.equal(typeof course.guideUrl, "string", `${course.id} no tiene guideUrl`);
    const guideUrl = new URL(course.guideUrl);
    assert.equal(guideUrl.protocol, "https:", `${course.id} no usa HTTPS`);
    assert.ok(
      guideUrl.hostname === "ugr.es" || guideUrl.hostname.endsWith(".ugr.es"),
      `${course.id} no enlaza a un dominio oficial de la UGR`,
    );
  }
});

test("las obligatorias enlazan al doble grado salvo Estructura de Computadores", async () => {
  const data = JSON.parse(
    await readFile(new URL("../data/planificacion.json", import.meta.url), "utf8"),
  );
  const requiredCourses = data.courses.filter((course) => course.type === "required");
  const doubleDegreeCourses = requiredCourses.filter((course) => course.id !== "ec");

  assert.ok(doubleDegreeCourses.length > 0, "debe haber obligatorias propias del doble grado");
  for (const course of doubleDegreeCourses) {
    const guideUrl = new URL(course.guideUrl);
    assert.equal(guideUrl.hostname, "grados.ugr.es", `${course.id} no usa el portal oficial de grados`);
    assert.ok(
      guideUrl.pathname.startsWith("/informaticaymatematicas/docencia/plan-estudios/"),
      `${course.id} no enlaza al plan del doble grado`,
    );
  }

  const ec = requiredCourses.find((course) => course.id === "ec");
  assert.ok(ec, "falta la asignatura obligatoria EC");
  assert.equal(
    ec.guideUrl,
    "https://grados.ugr.es/informatica/docencia/plan-estudios/estructura-computadores/guia-docente",
    "EC debe conservar la guía del Grado en Ingeniería Informática",
  );
  assert.doesNotMatch(ec.guideUrl, /\/informaticaymatematicas\//);
});

test("el glosario separa teoría y prácticas y conserva el color de asignatura", async () => {
  const [html, source] = await Promise.all([
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../app.js", import.meta.url), "utf8"),
  ]);
  assert.match(html, /id="topic-glossary-list"/);
  assert.match(html, /name="component"/);
  assert.match(source, /data-topic-component="\$\{kind\}"/);
  assert.match(source, /component\("theory", "Teoría"\)/);
  assert.match(source, /component\("practice", "Prácticas"\)/);
  assert.match(source, /--course-color: \$\{escapeHtml\(course.color\)\}/);
  assert.match(source, /data-course-color="\$\{escapeHtml\(course.color\)\}"/);
});

test("sitúa las guías antes del glosario y de una única zona de planificación", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const guidePosition = html.indexOf('id="guide-list"');
  const glossaryPosition = html.indexOf('id="topic-glossary-list"');
  const planningMatches = [...html.matchAll(/id="planning-options"/g)];

  assert.ok(guidePosition >= 0, "falta el listado de guías");
  assert.ok(guidePosition < glossaryPosition, "las guías deben preceder al glosario");
  assert.equal(planningMatches.length, 1, "debe existir una sola zona de planificación");
  assert.ok(guidePosition < planningMatches[0].index, "las guías deben preceder a las herramientas");
  assert.doesNotMatch(html, /official-links|official-link-list/);
});

test("renderiza para el cuatrimestre visible una guía segura por asignatura", async () => {
  const [html, source, data] = await Promise.all([
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../app.js", import.meta.url), "utf8"),
    readFile(new URL("../data/planificacion.json", import.meta.url), "utf8").then(JSON.parse),
  ]);
  assert.match(html, /<h2 id="guide-section-title">Guías docentes y temarios<\/h2>/);
  assert.match(html, /<div id="guide-list" class="guide-list"><\/div>/);
  assert.match(source, /guideList:\s*document\.querySelector\("#guide-list"\)/);
  assert.match(source, /function normalizeGuideUrl\(value\)/);
  assert.match(source, /url\.protocol === "https:" \? url\.href : null/);
  assert.match(source, /function renderGuides\(\)/);
  assert.match(source, /plan\.courses\.filter\(\(course\) => course\.term === state\.term\)/);
  assert.match(source, /href="\$\{escapeHtml\(course\.guideUrl\)\}"/);
  assert.match(source, /\$\{escapeHtml\(course\.abbreviation\)\}/);
  assert.match(source, /\$\{escapeHtml\(course\.name\)\}/);
  assert.match(source, /target="_blank"/);
  assert.match(source, /rel="noopener noreferrer"/);
  assert.match(source, /`Abrir la guía docente de \$\{course\.name\} en la web de la UGR`/);
  assert.doesNotMatch(source, /renderOfficialLinks|officialLinkList/);

  for (const term of data.academicTerms) {
    const visibleCourses = data.courses.filter((course) => course.term === term.id);
    assert.ok(visibleCourses.length > 0, `${term.name} no tiene asignaturas visibles`);
    for (const course of visibleCourses) {
      assert.ok(course.guideUrl, `${course.name} generaría un enlace sin guideUrl`);
    }
  }
  assert.doesNotMatch(source, /href="undefined"/);
});
