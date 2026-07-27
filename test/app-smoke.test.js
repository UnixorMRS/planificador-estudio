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
