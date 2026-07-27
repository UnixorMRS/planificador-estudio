# Planificador de estudio

Aplicación web sencilla para organizar asignaturas y tareas de estudio. Esta
primera versión contiene únicamente la estructura visual y queda preparada para
incorporar interacciones en futuras iteraciones.

## Estructura del proyecto

```text
.
├── index.html  # Estructura semántica de la página
├── styles.css  # Estilos, distribución adaptable y variables visuales
├── app.js      # Punto de entrada para la futura lógica de la aplicación
└── README.md   # Documentación del proyecto
```

- **`index.html`** incluye la cabecera, el área de asignaturas, el resumen de
  próximas tareas y el pie de página. También enlaza la hoja de estilos y el
  archivo JavaScript.
- **`styles.css`** define la apariencia base, los paneles y el comportamiento
  adaptable para pantallas pequeñas.
- **`app.js`** reserva el punto de entrada para añadir las interacciones sin
  incorporar todavía lógica compleja.

## Cómo abrir el proyecto

No requiere instalación ni dependencias. Abre `index.html` directamente en el
navegador o sirve la carpeta con un servidor web local, por ejemplo:

```bash
python3 -m http.server 8000
```

Después, visita `http://localhost:8000`.
