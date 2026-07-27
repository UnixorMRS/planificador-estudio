# Planificación académica 2026/27

Fuente humana resumida para sincronizar el planificador. Los datos ejecutables
están en `data/planificacion.json`; no se debe deducir una adjudicación a partir
del orden de preferencia.

## Calendario académico oficial

**Fuente consultada el 27 de julio de 2026:** [Calendario académico oficial de
la Universidad de Granada para 2026/27](https://secretariageneral.ugr.es/informacion/servicios/calendario-academico),
apartado de enseñanzas de Grado. Las fechas siguientes se han transcrito de ese
calendario publicado para 2026/27; no se han proyectado desde otro curso:

| Periodo | Inicio de docencia | Fin de docencia |
| --- | --- | --- |
| Primer cuatrimestre | 14 de septiembre de 2026 | 22 de diciembre de 2026 |
| Segundo cuatrimestre | 15 de febrero de 2027 | 4 de junio de 2027 |

El calendario general retrasa al **21 de septiembre de 2026** el inicio de la
docencia de **primer curso de Grado**. Esa excepción no afecta a este plan, que
contiene asignaturas de cursos posteriores de GII/GIIM y Matemáticas. Los
centros pueden aprobar adaptaciones justificadas para titulaciones con una
organización docente específica; no se encontró una adaptación de ETSIIT ni de
la Facultad de Ciencias que cambie los límites anteriores para las asignaturas
de este plan. Si el centro publica posteriormente una adaptación, deberá
registrarse explícitamente en `academicTerms`, nunca inferirse.

Dentro de esos límites se muestran como no lectivos los festivos y periodos de
interrupción que figuran en el calendario: 12 de octubre, 2 de noviembre y
7–8 de diciembre de 2026; y 1 de marzo, 22 de marzo–2 de abril y 3 de mayo de
2027. Que un día se muestre en la semana no lo convierte en lectivo.

## Reglas

- Las ocho optativas están solicitadas, no adjudicadas.
- El máximo es 24 ECTS optativos. La validación se hace por créditos.
- Las obligatorias usan los horarios de GIIM, salvo Estructura de Computadores.
- EC se planifica provisionalmente como GII B/B2, pendiente de pedir y obtener
  el cambio al inicio del curso.
- Estadística Computacional es la optativa de Matemáticas, grupo A en español.
- Topología I no forma parte del plan.
- DDSI, IG y los subgrupos de las demás asignaturas permanecen pendientes.
- El horario definitivo del segundo cuatrimestre solo incluirá las optativas
  realmente adjudicadas.

## Primer cuatrimestre

- **EC B/B2:** viernes 9:30–11:30 teoría y 11:30–13:30 práctica.
- **Análisis Funcional:** miércoles 12:00–13:00; jueves 12:00–13:00
  práctica y 13:00–14:00; viernes 11:00–12:00.
- **SCD:** teoría jueves 17:30–19:30, subgrupo pendiente.
- **FR:** teoría miércoles 17:30–19:30, subgrupo pendiente.
- **DDSI e IG:** incluidas con las alternativas A1, A2 y A3 del horario GIIM.

El solape de EC con Análisis Funcional del viernes 11:00–12:00 está aceptado:
se asistirá a EC y se faltará a esa hora de Análisis Funcional.

## Segundo cuatrimestre

- **AC e IA:** obligatorias de GIIM con subgrupo pendiente.
- **IS:** solo se cursará la práctica; la teoría ya está aprobada.
- **Optativas por prioridad:** DIU, ABD, SIBW, Estadística Computacional, MH,
  CUIA, AS y PW.

La prioridad se conserva como información, pero cualquier subconjunto de hasta
24 ECTS puede ser el finalmente adjudicado.

## Procedencia

- `Horarios GIIM (26-27).pdf`: obligatorias de Informática del doble grado.
- `Horarios GII (26-27).pdf`: EC B/B2 y optativas de Informática.
- `297_HorarioInformaticaMatematicas2026-27.pdf`: Análisis Funcional.
- Horario oficial del Grado en Matemáticas enlazado desde el documento maestro:
  Estadística Computacional A.
- `Planificacion_curso_2026-27_Manuel.docx`: decisiones, prioridades y estados.
