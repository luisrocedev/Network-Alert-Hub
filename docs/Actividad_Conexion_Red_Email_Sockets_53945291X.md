# Actividad PSP-002 · Conexión por red, email y sockets

**Alumno:** Luis Rodríguez Cedeño  
**DNI:** 53945291X  
**Curso:** DAM2 — Programación de Servicios y Procesos  
**Lección:** 301-Actividades final de unidad · Segundo trimestre / 002-Conexión por red, email y sockets  
**Proyecto:** Network Alert Hub

---

## 1. Introducción breve y contextualización

### 1.1 Contexto de la actividad

La presente actividad se enmarca dentro del módulo de **Programación de Servicios y Procesos** (PSP) del segundo curso de Desarrollo de Aplicaciones Multiplataforma (DAM2). Su objetivo es demostrar el dominio de las comunicaciones en red mediante distintos protocolos de transporte, la integración de servicios de correo electrónico y el uso de sockets como mecanismo de comunicación entre procesos.

El ejercicio parte de una base propuesta en clase (chat por sockets con mensajes JSON y WebSocket) y se extiende hacia un escenario profesional de **monitorización de eventos de red**, donde múltiples fuentes externas (sensores, routers, scripts) reportan incidencias a un centro de operaciones que las clasifica, persiste, difunde en tiempo real y escala automáticamente por email cuando la severidad lo requiere.

### 1.2 Objetivo del proyecto

**Network Alert Hub** es una plataforma integral de monitorización de eventos de red que unifica tres transportes distintos en un único sistema cohesivo:

- **TCP Socket síncrono** — Para la ingesta de eventos desde cualquier cliente de red.
- **WebSocket asíncrono** — Para la difusión en tiempo real hacia el panel web.
- **SMTP** — Para el envío automatizado de alertas por correo electrónico.

Todo ello con persistencia en **SQLite**, una API REST documentada y un dashboard web interactivo con diseño profesional.

### 1.3 Justificación técnica

La elección de Python como lenguaje se justifica por su soporte nativo para sockets (`socket`, `socketserver`), su ecosistema de WebSocket (`websockets`, `asyncio`) y su módulo estándar de correo (`smtplib`, `email.mime`). Flask se selecciona como framework HTTP por su ligereza y su capacidad para convivir con servidores de socket en hilos secundarios.

La arquitectura multitransporte permite demostrar simultáneamente:

| Concepto PSP | Implementación |
|---|---|
| Comunicación TCP | `socketserver.ThreadingMixIn` + `StreamRequestHandler` |
| Comunicación asíncrona | `websockets.serve()` + `asyncio` event loop |
| Envío de email | `smtplib.SMTP` con STARTTLS y autenticación |
| Concurrencia | Hilos daemon para TCP, WS y SMTP |
| Persistencia | SQLite con modelo relacional (events ↔ email_alerts) |

### 1.4 Tecnologías utilizadas

| Capa | Stack |
|---|---|
| Backend | Python 3.12 · Flask 3.x · SQLite 3 |
| Sockets | `socketserver.ThreadingMixIn` · `socketserver.StreamRequestHandler` |
| WebSocket | `websockets` 12.x · `asyncio` |
| Email | `smtplib` · `email.mime.text.MIMEText` · STARTTLS |
| Frontend | HTML5 · CSS3 (custom properties, dark mode) · JavaScript ES2022 |

---

## 2. Desarrollo detallado y preciso

### 2.1 Modelo de datos (SQLite)

El sistema utiliza dos tablas principales con relación `1:N`:

```sql
CREATE TABLE IF NOT EXISTS events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at  TEXT NOT NULL,
    source      TEXT NOT NULL,
    severity    TEXT NOT NULL,          -- info | warning | error | critical
    message     TEXT NOT NULL,
    channel     TEXT NOT NULL,          -- tcp_socket | http_api
    raw_payload TEXT
);

CREATE TABLE IF NOT EXISTS email_alerts (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id   INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    recipient  TEXT,
    status     TEXT NOT NULL,           -- sent | failed | skipped
    detail     TEXT,
    FOREIGN KEY(event_id) REFERENCES events(id)
);
```

- **events**: Almacena cada evento recibido (tanto por TCP como por HTTP API) con su origen, severidad, canal y payload raw.
- **email_alerts**: Auditoría de cada intento de envío de email vinculado a un evento. Los estados posibles son `sent` (enviado), `failed` (error SMTP) y `skipped` (SMTP no configurado).

### 2.2 Servidor TCP multihilo

El servidor TCP utiliza `socketserver.ThreadingMixIn` para atender múltiples conexiones simultáneas. Cada cliente envía eventos como líneas JSON:

```python
class TCPEventHandler(socketserver.StreamRequestHandler):
    def handle(self) -> None:
        while True:
            line = self.rfile.readline()
            if not line:
                break
            try:
                data = json.loads(line.decode("utf-8", errors="ignore"))
            except json.JSONDecodeError:
                self.wfile.write(b'{"ok":false,"error":"invalid_json"}\n')
                continue

            source = str(data.get("source", self.client_address[0]))[:80]
            severity = normalize_severity(str(data.get("severity", "info")))
            message = str(data.get("message", "(sin mensaje)"))[:300]

            created = register_event(
                EventPayload(
                    source=source,
                    severity=severity,
                    message=message,
                    channel="tcp_socket",
                    raw_payload=json.dumps(data, ensure_ascii=False),
                )
            )
            response = json.dumps({"ok": True, "event_id": created["id"]})
            self.wfile.write((response + "\n").encode("utf-8"))


class ThreadedTCPServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    allow_reuse_address = True
    daemon_threads = True
```

**Protocolo**: cada línea es un objeto JSON independiente (`{"source":"...","severity":"...","message":"..."}`). El servidor responde con `{"ok":true,"event_id":N}` por cada evento procesado.

### 2.3 Servidor WebSocket asíncrono

La difusión en tiempo real se realiza mediante un servidor WebSocket sobre `asyncio`:

```python
async def ws_handler(websocket):
    with ws_lock:
        ws_clients.add(websocket)

    await websocket.send(json.dumps({
        "type": "hello",
        "message": "Conectado a Network Alert Hub",
        "timestamp": now_text(),
    }, ensure_ascii=False))

    try:
        async for message in websocket:
            if message == "ping":
                await websocket.send(json.dumps({"type": "pong", "ts": time.time()}))
    finally:
        with ws_lock:
            ws_clients.discard(websocket)


def ws_server_thread() -> None:
    global ws_loop
    loop = asyncio.new_event_loop()
    ws_loop = loop
    asyncio.set_event_loop(loop)

    async def runner() -> None:
        async with websockets.serve(ws_handler, "0.0.0.0", WS_PORT):
            await asyncio.Future()

    loop.run_until_complete(runner())
```

La función `broadcast()` usa `asyncio.run_coroutine_threadsafe()` para enviar datos desde hilos síncronos al event loop del WebSocket:

```python
async def _broadcast(payload: dict) -> None:
    message = json.dumps(payload, ensure_ascii=False)
    stale = []
    with ws_lock:
        clients = list(ws_clients)

    for client in clients:
        try:
            await client.send(message)
        except Exception:
            stale.append(client)

    if stale:
        with ws_lock:
            for client in stale:
                ws_clients.discard(client)


def broadcast(payload: dict) -> None:
    if ws_loop is None or not ws_loop.is_running():
        return
    asyncio.run_coroutine_threadsafe(_broadcast(payload), ws_loop)
```

### 2.4 Sistema de alertas por email (SMTP)

Cuando se registra un evento con severidad `error` o `critical`, se lanza un hilo daemon que envía un email de alerta:

```python
def send_email_alert(event_id: int, event_data: dict) -> None:
    smtp_host = os.getenv("SMTP_HOST")
    smtp_port = int(os.getenv("SMTP_PORT", "587"))
    smtp_user = os.getenv("SMTP_USER")
    smtp_pass = os.getenv("SMTP_PASS")
    smtp_to   = os.getenv("SMTP_TO")
    smtp_from = os.getenv("SMTP_FROM", smtp_user or "")

    if not all([smtp_host, smtp_user, smtp_pass, smtp_to, smtp_from]):
        insert_email_log(event_id, smtp_to, "skipped", "SMTP no configurado")
        return

    subject = f"[NetworkAlertHub] Alerta {event_data['severity'].upper()}"
    body = (
        f"Evento: #{event_id}\n"
        f"Fecha: {event_data['created_at']}\n"
        f"Origen: {event_data['source']}\n"
        f"Severidad: {event_data['severity']}\n\n"
        f"Mensaje:\n{event_data['message']}\n"
    )

    msg = MIMEText(body, "plain", "utf-8")
    msg["Subject"] = subject
    msg["From"]    = smtp_from
    msg["To"]      = smtp_to

    try:
        with smtplib.SMTP(smtp_host, smtp_port, timeout=10) as server:
            server.starttls()
            server.login(smtp_user, smtp_pass)
            server.sendmail(smtp_from, [smtp_to], msg.as_string())
        insert_email_log(event_id, smtp_to, "sent", "Enviado correctamente")
    except Exception as exc:
        insert_email_log(event_id, smtp_to, "failed", str(exc))
```

**Auditoría completa**: Cada intento de envío (exitoso, fallido o saltado) queda registrado en la tabla `email_alerts` con trazabilidad hacia el evento original.

### 2.5 Flujo de registro de eventos

La función central `register_event()` orquesta todo el pipeline:

```python
def register_event(payload: EventPayload) -> dict:
    event_id = insert_event(payload)                      # 1. Persistir en SQLite
    event_data = { ... }                                  # 2. Construir respuesta
    # 3. Actualizar métricas en memoria
    with state_lock:
        if payload.channel == "tcp_socket": metrics["tcp_messages"] += 1
        if payload.channel == "http_api":   metrics["http_messages"] += 1
    # 4. Difundir por WebSocket
    broadcast({"type": "event", "data": event_data})
    # 5. Escalar por email si severidad alta
    if payload.severity in ("error", "critical"):
        threading.Thread(target=send_email_alert, args=(event_id, event_data), daemon=True).start()
    return event_data
```

### 2.6 API REST (Flask)

| Endpoint | Método | Descripción |
|---|---|---|
| `/api/events?limit=N` | GET | Últimos N eventos + historial de emails |
| `/api/events` | POST | Crear evento manual (JSON: source, severity, message) |
| `/api/stats` | GET | KPIs: total, por severidad, por canal, email OK/fail |
| `/api/config` | GET | Puertos configurados (HTTP, WS, TCP) |

### 2.7 Cliente TCP de prueba

El archivo `tcp_event_client.py` genera 12 eventos aleatorios con distribución ponderada de severidades:

```python
def build_event() -> dict:
    return {
        "source": random.choice(SOURCES),
        "severity": random.choices(
            SEVERITIES, weights=[50, 28, 16, 6], k=1
        )[0],
        "message": random.choice(MESSAGES),
    }

def main() -> None:
    with socket.create_connection((HOST, PORT), timeout=5) as sock:
        for _ in range(12):
            event = build_event()
            payload = json.dumps(event) + "\n"
            sock.sendall(payload.encode("utf-8"))
            response = sock.recv(1024).decode("utf-8").strip()
            print("Enviado:", event, "->", response)
            time.sleep(0.4)
```

Las ponderaciones `[50, 28, 16, 6]` simulan un escenario realista donde la mayoría de eventos son informativos y los críticos son poco frecuentes.

### 2.8 Frontend v2: dashboard interactivo

El frontend se divide en **5 pestañas** con un sistema de tabs por `data-tab`:

| Pestaña | Contenido |
|---|---|
| **Dashboard** | Mini-tablas de últimos 5 eventos y últimas 5 alertas email |
| **Crear evento** | Formulario con origen, severidad, mensaje + contador de caracteres |
| **Eventos** | Tabla completa con búsqueda en vivo + badges de canal y severidad |
| **Alertas email** | Historial de envíos SMTP con estado (sent/failed/skipped) |
| **Auditoría** | Cards con distribución numérica por severidad, canal y estado email |

**14 mejoras v2 implementadas:**

| # | Mejora | Implementación |
|---|---|---|
| 1 | Dark mode | Toggle + `data-theme` + `localStorage` |
| 2 | Toasts | 4 tonos con animación slideDown + fadeOut |
| 3 | Confirm overlay | Promise-based con `backdrop-filter: blur(4px)` |
| 4 | Dashboard con KPIs | 6 tarjetas con borde semántico (purple/red/amber/green/cyan/blue) |
| 5 | Status dot | Heartbeat cada 5s con clase `online`/`offline` + animación pulse |
| 6 | Badges semánticos | Pills de severidad + badges de canal (TCP azul, HTTP verde) |
| 7 | Contador de caracteres | `input` event sobre textarea con feedback `0 / 300` |
| 8 | Export JSON | Blob + `URL.createObjectURL` + descarga automática |
| 9 | Import JSON | FileReader + confirm + creación secuencial de eventos |
| 10 | Seed de datos | 5 eventos predefinidos con severidades variadas |
| 11 | Búsqueda en vivo | Filtro por texto sobre arrays cacheados |
| 12 | Responsive | 3 breakpoints: 1100px (tablet), 700px (móvil) |
| 13 | Empty states | Mensajes informativos cuando las tablas no tienen datos |
| 14 | Auto-refresh | `setInterval(loadAll, 4000)` |

---

## 3. Aplicación práctica

### 3.1 Escenario de uso: NOC (Network Operations Center)

Imaginemos una pequeña empresa con 4 dispositivos de red monitorizados: dos sensores (A y B), un router core y un switch de planta. Cada dispositivo ejecuta un script que envía eventos al **Network Alert Hub** por TCP socket.

#### Paso 1: Arranque del sistema

```bash
python app.py
```

Se inician tres servicios simultáneamente:
- HTTP panel en `http://127.0.0.1:5060`
- WebSocket en `ws://127.0.0.1:8767`
- TCP ingesta en `127.0.0.1:5090`

#### Paso 2: Simulación de eventos TCP

```bash
python tcp_event_client.py
```

El cliente genera 12 eventos con severidades ponderadas y los envía al servidor TCP. La salida en terminal muestra cada evento con su respuesta:

```
Conectando a 127.0.0.1:5090...
Enviado: {'source': 'sensor-a', 'severity': 'info', 'message': 'Heartbeat OK'} -> {"ok":true,"event_id":1}
Enviado: {'source': 'router-core', 'severity': 'warning', 'message': 'Latencia elevada detectada'} -> {"ok":true,"event_id":2}
Enviado: {'source': 'switch-planta2', 'severity': 'error', 'message': 'Microcorte de conectividad'} -> {"ok":true,"event_id":3}
...
```

#### Paso 3: Visualización en tiempo real

Al abrir el panel web, se observa:
- Los **KPIs se actualizan** automáticamente con los contadores por severidad.
- La tabla de **eventos muestra en tiempo real** cada nuevo evento recibido por WS.
- Los eventos de severidad `error` y `critical` disparan intentos de email registrados en la pestaña de alertas.

#### Paso 4: Creación manual de evento

Desde la pestaña "Crear evento" se puede enviar un evento `critical` manualmente:

```json
{
  "source": "admin-manual",
  "severity": "critical",
  "message": "Reinicio de emergencia del router principal"
}
```

Este evento:
1. Se persiste en SQLite.
2. Se difunde a todos los clientes WS conectados.
3. Dispara un intento de email (registrado como `sent`, `failed` o `skipped`).

#### Paso 5: Exportación y backup

El botón 📦 genera un archivo JSON con todo el estado actual:

```json
{
  "events": [ ... ],
  "email_logs": [ ... ],
  "stats": { "total_events": 12, "severity": { ... }, ... },
  "exported_at": "2026-02-20T10:30:00.000Z"
}
```

### 3.2 Diagrama de flujo del evento

```
Cliente TCP / HTTP API
        │
        ▼
  register_event()
        │
   ┌────┴────┐
   │         │
   ▼         ▼
 SQLite   broadcast()──▶ WS clients ──▶ Dashboard
   │
   ├─ severity ∈ {error, critical}?
   │       │
   │       ▼
   │  send_email_alert() ──▶ SMTP ──▶ destinatario
   │       │
   │       ▼
   │  email_alerts (auditoría)
   │
   └─ response ──▶ cliente
```

### 3.3 Protocolo TCP: formato de mensajes

**Request** (cliente → servidor, una línea JSON):
```json
{"source":"router-core","severity":"warning","message":"Latencia elevada en eth0"}
```

**Response** (servidor → cliente, una línea JSON):
```json
{"ok":true,"event_id":42}
```

**Error**:
```json
{"ok":false,"error":"invalid_json"}
```

### 3.4 Configuración SMTP para entornos reales

El sistema lee variables de entorno para la configuración SMTP:

| Variable | Ejemplo | Descripción |
|---|---|---|
| `SMTP_HOST` | `smtp.gmail.com` | Servidor SMTP |
| `SMTP_PORT` | `587` | Puerto (STARTTLS) |
| `SMTP_USER` | `admin@empresa.com` | Usuario de autenticación |
| `SMTP_PASS` | `app_password` | Contraseña o App Password |
| `SMTP_FROM` | `alertas@empresa.com` | Remitente |
| `SMTP_TO` | `noc@empresa.com` | Destinatario de alertas |

Si alguna variable falta, el sistema registra el intento como `skipped` sin interrumpir el servicio.

### 3.5 Concurrencia y seguridad entre hilos

El sistema gestiona tres hilos daemon principales:

| Hilo | Función | Comunicación |
|---|---|---|
| `tcp_server_thread` | Sirve conexiones TCP entrantes | `register_event()` → `state_lock` |
| `ws_server_thread` | Event loop asyncio para WS | `broadcast()` → `ws_lock` |
| Hilos SMTP (bajo demanda) | Envío de emails | `insert_email_log()` → `state_lock` |

Se utilizan dos locks:
- **`state_lock`** (`threading.Lock`) — Protege las métricas en memoria (`tcp_messages`, `http_messages`, `email_sent_ok`, `email_sent_fail`).
- **`ws_lock`** (`threading.Lock`) — Protege el conjunto de clientes WebSocket conectados.

---

## 4. Conclusión breve

### 4.1 Objetivos alcanzados

El proyecto **Network Alert Hub** cumple integralmente con los requisitos de la actividad:

1. **Comunicación por red**: Se implementan tres protocolos distintos (TCP, WebSocket, SMTP) demostrando el dominio de la comunicación en red con Python.
2. **Sockets**: El servidor TCP multihilo (`ThreadingMixIn`) demuestra la creación de servidores concurrentes con el módulo `socketserver`.
3. **Email**: La integración SMTP con STARTTLS, auditoría completa y degradación elegante (sin SMTP configurado no falla) demuestra un manejo profesional del envío de correo.
4. **Persistencia**: SQLite con modelo relacional (FK entre `events` y `email_alerts`) demuestra el almacenamiento estructurado de datos.
5. **Interfaz web**: El dashboard con 14 mejoras v2 supera ampliamente el diseño base, incluyendo dark mode, toasts, búsqueda en vivo, export/import y responsive design.

### 4.2 Competencias demostradas

| Competencia | Evidencia |
|---|---|
| Programación de sockets | TCP `StreamRequestHandler` + WebSocket `asyncio` |
| Concurrencia | 3 hilos daemon + 2 locks + hilos SMTP bajo demanda |
| Servicios de red | Integración SMTP con STARTTLS y auditoría |
| Persistencia de datos | SQLite con modelo relacional y trazabilidad |
| Desarrollo web full-stack | Flask REST API + SPA con JS vanilla |
| Diseño UI/UX | Dark mode, responsive, toasts, confirm, badges semánticos |

### 4.3 Posibles extensiones futuras

- **Cifrado TLS** para el canal TCP (actualmente texto plano).
- **Autenticación JWT** en la API REST.
- **Dashboard con gráficas** (Chart.js o similar) para visualizar tendencias de severidad.
- **Rate limiting** para proteger contra inundación de eventos.
- **Webhooks** como canal adicional de notificación.
- **Docker Compose** para despliegue con PostgreSQL en producción.

### 4.4 Valoración personal

Este proyecto ha sido especialmente enriquecedor por la necesidad de coordinar tres transportes completamente distintos (TCP síncrono, WebSocket asíncrono y SMTP) dentro de un mismo proceso Python. La gestión de concurrencia con locks, la convivencia de `asyncio` con hilos estándar y la construcción de un pipeline de eventos completo (ingesta → persistencia → difusión → escalado) reflejan patrones que se encuentran en sistemas de monitorización profesionales reales.

---

## Anexo: Tabla resumen de mejoras v2

| # | Mejora | Archivo | Técnica |
|---|---|---|---|
| 1 | Dark mode | styles.css + app.js | `[data-theme="dark"]` + `localStorage` |
| 2 | Toasts | styles.css + app.js | Animaciones CSS + DOM dinámico |
| 3 | Confirm overlay | index.html + app.js | Promise + `backdrop-filter` |
| 4 | 6 KPIs semánticos | index.html + styles.css | `border-left-color` por categoría |
| 5 | Status dot | styles.css + app.js | `fetch('/api/stats')` + clase toggle |
| 6 | Badges canal/severidad | styles.css + app.js | `.badge-channel` + `.pill` |
| 7 | Char counter | index.html + app.js | `input` event sobre `<textarea>` |
| 8 | Export JSON | app.js | `Blob` + `URL.createObjectURL` |
| 9 | Import JSON | app.js | `FileReader` + `nousConfirm` |
| 10 | Seed data | app.js | Array predefinido + POST secuencial |
| 11 | Búsqueda en vivo | app.js | `Array.filter` sobre caché |
| 12 | Responsive | styles.css | `@media` 1100px + 700px |
| 13 | Empty states | app.js + styles.css | `.empty-state` centrado |
| 14 | Auto-refresh | app.js | `setInterval(loadAll, 4000)` |
