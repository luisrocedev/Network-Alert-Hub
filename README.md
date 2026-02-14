# Network Alert Hub (PSP · DAM2)

Proyecto final para la actividad de **conexión por red, email y sockets**.

La solución parte del enfoque de clase (chat/socket y WebSocket JSON) y evoluciona a un sistema de monitorización con arquitectura completa:

- **Socket TCP síncrono** para ingesta de eventos (`source`, `severity`, `message`).
- **WebSocket asíncrono** para difusión en tiempo real al panel web.
- **SMTP** para alertas automáticas en eventos `error` y `critical`.
- **SQLite** para persistencia de eventos e histórico de correos.
- **Dashboard** con rediseño visual, KPIs y tablas de seguimiento.

## Estructura

- `app.py`: backend Flask + socket TCP + WebSocket + SMTP + SQLite.
- `templates/index.html`: panel de control visual.
- `static/app.js`: cliente frontend con tiempo real.
- `static/styles.css`: rediseño estético completo.
- `tcp_event_client.py`: generador de eventos TCP de prueba.
- `.env.example`: plantilla de configuración.

## Requisitos

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Ejecución

```bash
python app.py
```

Servicios levantados por defecto:

- HTTP panel: `http://127.0.0.1:5060`
- WebSocket live: `ws://127.0.0.1:8767`
- TCP ingest: `127.0.0.1:5090`

## Prueba rápida con cliente TCP

Con el servidor ejecutándose:

```bash
python tcp_event_client.py
```

Se verán eventos en el panel y, para severidades altas, intentos de envío SMTP registrados en base de datos.

## SMTP opcional

Copia `.env.example` a `.env` y define credenciales válidas para activar envíos reales.

Variables:

- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USER`
- `SMTP_PASS`
- `SMTP_FROM`
- `SMTP_TO`

Si no están configuradas, el sistema no se rompe: registra el intento como `skipped`.
