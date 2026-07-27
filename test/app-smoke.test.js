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


test("el glosario separa teoría y prácticas y conserva el color de asignatura", async () => {
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

test("renderiza las guías en un contenedor accesible con enlaces externos seguros", async () => {
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

  assert.match(html, /<h2 id="guide-section-title">Guías docentes y temarios<\/h2>/);
  assert.match(html, /<div id="guide-list" class="guide-list"><\/div>/);
  assert.match(source, /guideList:\s*document\.querySelector\("#guide-list"\)/);
  assert.match(source, /function normalizeGuideUrl\(value\)/);
  assert.match(source, /url\.protocol === "https:" \? url\.href : null/);
  assert.match(source, /function renderGuides\(\)/);
  assert.match(source, /course\.term === state\.term/);
  assert.match(source, /target="_blank"/);
  assert.match(source, /rel="noopener noreferrer"/);
  assert.match(source, /`Abrir la guía docente de \$\{course\.name\} en la web de la UGR`/);
});
