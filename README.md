# Planificador de estudio

Aplicación web personal para construir el horario académico 2026/27 sin
confundir solicitudes con adjudicaciones y convertir tareas, exámenes y avance
del temario en sesiones de estudio ajustables.

## Funciones

- Horarios oficiales normalizados por cuatrimestre, grupo y subgrupo.
- Optativas adjudicables en cualquier combinación hasta 24 ECTS.
- Detección de solapes, incluido el conflicto aceptado EC–Análisis Funcional.
- Seguimiento por temas, dificultad y dominio.
- Tareas y exámenes con carga estimada.
- Sugerencias de estudio dentro de los huecos libres configurables.
- Decisión explícita entre conservar o rehacer sesiones al recalcular.
- Persistencia local y exportación/importación JSON.

## Ejecutar

La aplicación carga `data/planificacion.json`, por lo que debe servirse por
HTTP:

```bash
npm run serve
```

Después abre `http://localhost:8000`.

No hay dependencias de ejecución ni proceso de compilación.

## Pruebas

```bash
npm test
```

Las pruebas cubren créditos, adjudicaciones no ligadas a prioridad, subgrupos,
conflictos, generación de sesiones e importación.

## Estructura

```text
.
├── data/planificacion.json   # Fuente estructurada de asignaturas y horarios
├── docs/planificacion.md     # Resumen humano y reglas
├── index.html                # Interfaz
├── styles.css                # Diseño adaptable
├── app.js                    # Estado, renderizado e interacciones
├── planner-core.js           # Motor puro y comprobable
└── test/                     # Pruebas con node:test
```

Los documentos originales permanecen en `docs/fuentes/`.
