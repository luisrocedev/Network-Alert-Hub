# Paso 4 · Actividad y entrega

**DNI:** 53945291X  
**Curso:** DAM2 - Programación de procesos y servicios  
**Lección:** `301-Actividades final de unidad - Segundo trimestre/002-Actividad conexion por red, email, sockets`

## 1) Descripción del ejercicio personal

Se desarrolla un proyecto propio llamado **Network Alert Hub**, manteniendo la temática base de clase (comunicación por sockets/WebSockets con mensajes JSON) y ampliándolo a un escenario profesional de monitorización y alertas.

## 2) Modificaciones estéticas y visuales (calado alto)

- Rediseño completo a interfaz tipo dashboard técnico.
- Tarjetas KPI para métricas en tiempo real.
- Tablas diferenciadas para eventos y trazas de envío de correo.
- Estados visuales de severidad (`info`, `warning`, `error`, `critical`) con código de color.
- Estado de conexión WebSocket visible y reconexión automática.

## 3) Modificaciones funcionales y de base de datos (calado alto)

- Implementación simultánea de:
  - **Socket TCP** (ingesta síncrona de eventos).
  - **WebSocket** (difusión asíncrona en vivo al frontend).
  - **SMTP** (alertas por email para incidencias severas).
- Persistencia en **SQLite** con dos tablas:
  - `events` (histórico de eventos)
  - `email_alerts` (auditoría de envíos, fallos y saltos)
- API REST (`/api/events`, `/api/stats`, `/api/config`) para integración y pruebas.
- Cliente de simulación (`tcp_event_client.py`) para generar carga de red real.

## 4) Justificación de cumplimiento de rúbrica

- Se demuestra comunicación en red con protocolos y patrones diferentes (TCP, WS, SMTP).
- Las mejoras visuales son amplias y evidentes respecto al ejemplo base.
- Las mejoras funcionales afectan arquitectura, concurrencia, persistencia y flujo de negocio.
- Se entrega solución completa ejecutable, documentada y validable con pruebas.
