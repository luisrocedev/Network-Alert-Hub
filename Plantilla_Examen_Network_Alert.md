# Network-Alert-Hub — Plantilla de Examen

**Alumno:** Luis Rodríguez Cedeño · **DNI:** 53945291X  
**Módulo:** Programación de Servicios y Procesos · **Curso:** DAM2 2025/26

---

## 1. Introducción

- **Qué es:** Sistema multi-canal de eventos con TCP socket + WebSocket (broadcast real-time) + SMTP email + HTTP REST
- **Contexto:** Módulo de PSP — sockets (TCP + WS), asyncio, SMTP, multi-threading, eventos en tiempo real
- **Objetivos principales:**
  - 4 canales de comunicación: TCP socket, WebSocket, SMTP email, HTTP REST
  - Broadcast en tiempo real de eventos via WebSocket
  - Alertas email automáticas para eventos error/critical (SMTP+TLS)
  - Servidor TCP multi-hilo para recibir eventos de clientes remotos
  - Dashboard con WebSocket auto-reconnect + live search
- **Tecnologías clave:**
  - Python 3.11, `socketserver` (TCP), `websockets` + `asyncio` (WebSocket)
  - `smtplib` + TLS (email), Flask (HTTP REST), SQLite, `dataclasses`
- **Arquitectura:** `app.py` (289 líneas: TCP + WS + SMTP + Flask) → `tcp_event_client.py` (cliente TCP) → `templates/index.html` (dashboard) → `static/app.js` (WS client + UI)

---

## 2. Desarrollo de las partes

### 2.1 Servidor TCP multi-hilo — Recepción de eventos

- `socketserver.ThreadingTCPServer` → un hilo por conexión entrante
- Protocolo JSON por línea: `{"source":"sensor_01","severity":"warning","message":"..."}`
- Llama a `register_event()` que orquesta todos los canales

```python
import socketserver
import json

class TCPEventHandler(socketserver.StreamRequestHandler):
    """Maneja eventos recibidos por TCP (un hilo por conexión)."""

    def handle(self):
        raw = self.rfile.readline().strip()
        if not raw:
            return
        try:
            payload = json.loads(raw.decode('utf-8'))
            event = EventPayload(
                source=payload.get('source', 'unknown'),
                severity=payload.get('severity', 'info'),
                message=payload.get('message', ''),
                channel='tcp'
            )
            register_event(event)  # Orquestador
            response = json.dumps({"ok": True, "id": event.id})
        except Exception as e:
            response = json.dumps({"ok": False, "error": str(e)})
        self.wfile.write((response + '\n').encode('utf-8'))

class ThreadedTCPServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    allow_reuse_address = True
```

> **Explicación:** `StreamRequestHandler.rfile` lee del socket como un archivo. Se parsea el JSON, se crea un `EventPayload` y se llama al orquestador. `ThreadingMixIn` crea un hilo por conexión para no bloquear otras conexiones.

### 2.2 WebSocket — Broadcast en tiempo real con asyncio

- `websockets.serve()` → servidor WS en asyncio event loop
- Set de clientes conectados → broadcast a todos
- Corre en hilo separado con su propio event loop

```python
import asyncio
import websockets

ws_clients = set()

async def ws_handler(websocket, path):
    """Registrar cliente WS y mantener conexión activa."""
    ws_clients.add(websocket)
    try:
        async for _ in websocket:
            pass  # Solo escucha, no recibe datos
    finally:
        ws_clients.discard(websocket)

async def ws_broadcast(data: dict):
    """Enviar evento a todos los clientes WS conectados."""
    if ws_clients:
        message = json.dumps(data)
        await asyncio.gather(
            *[client.send(message) for client in ws_clients],
            return_exceptions=True
        )

def start_ws_server():
    """Arrancar servidor WS en su propio event loop + hilo."""
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    server = websockets.serve(ws_handler, '0.0.0.0', WS_PORT)
    loop.run_until_complete(server)
    loop.run_forever()

ws_thread = threading.Thread(target=start_ws_server, daemon=True)
ws_thread.start()
```

> **Explicación:** `websockets.serve` acepta conexiones WebSocket. Cada cliente se añade al set `ws_clients`. `ws_broadcast` envía datos a todos los clientes conectados usando `asyncio.gather()`. El servidor WS corre en un hilo daemon con su propio event loop asyncio.

### 2.3 SMTP Email — Alertas automáticas con TLS

- `smtplib.SMTP` + `starttls()` → conexión segura al servidor de correo
- Se dispara para eventos de severidad `error` o `critical`
- `MIMEMultipart` → email con formato HTML

```python
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

def send_email_alert(event: EventPayload):
    """Enviar alerta email para eventos error/critical."""
    if event.severity not in ('error', 'critical'):
        return

    msg = MIMEMultipart()
    msg['From'] = SMTP_USER
    msg['To'] = ALERT_RECIPIENT
    msg['Subject'] = f"[{event.severity.upper()}] Alerta: {event.source}"

    body = f"""
    <h2>Alerta del sistema</h2>
    <p><strong>Fuente:</strong> {event.source}</p>
    <p><strong>Severidad:</strong> {event.severity}</p>
    <p><strong>Mensaje:</strong> {event.message}</p>
    <p><strong>Canal:</strong> {event.channel}</p>
    <p><strong>Timestamp:</strong> {event.created_at}</p>
    """
    msg.attach(MIMEText(body, 'html'))

    try:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server:
            server.starttls()       # Conexión segura TLS
            server.login(SMTP_USER, SMTP_PASS)
            server.send_message(msg)
    except Exception as e:
        print(f"Error enviando email: {e}")
```

> **Explicación:** `starttls()` eleva la conexión a TLS (cifrada). Se construye un email HTML con los detalles del evento. Solo se envía para severidades alta (error/critical). `send_message()` envía el email completo.

### 2.4 Orquestador de eventos — register_event()

- Función central que recibe un evento y lo distribuye por todos los canales
- Flujo: SQLite → WebSocket broadcast → Email (si severity alta)
- Patrón coordinador: un solo punto de entrada para todos los canales

```python
@dataclass
class EventPayload:
    source: str
    severity: str       # 'info', 'warning', 'error', 'critical'
    message: str
    channel: str        # 'tcp', 'http', 'ws'
    id: str = ""
    created_at: str = ""

    def __post_init__(self):
        if not self.id:
            self.id = uuid.uuid4().hex[:12]
        if not self.created_at:
            self.created_at = datetime.now().isoformat()

def register_event(event: EventPayload):
    """Orquestador: guardar + broadcast + email."""
    # 1. Guardar en SQLite
    conn = sqlite3.connect(DB_PATH)
    conn.execute("""
        INSERT INTO events (id, ts, source, severity, message, channel)
        VALUES (?, ?, ?, ?, ?, ?)
    """, (event.id, event.created_at, event.source, event.severity,
          event.message, event.channel))
    conn.commit()
    conn.close()

    # 2. Broadcast WebSocket
    asyncio.run_coroutine_threadsafe(
        ws_broadcast(event.__dict__), ws_loop
    )

    # 3. Email si severidad alta
    send_email_alert(event)
```

> **Explicación:** Punto central que coordina: (1) persiste en SQLite, (2) broadcast a clientes WS en tiempo real vía `run_coroutine_threadsafe` (bridge entre sync y async), (3) envía email si el evento es error/critical.

### 2.5 Cliente WebSocket — Auto-reconnect

- Frontend JS con `new WebSocket()` + auto-reconnect cada 3s
- Eventos recibidos se renderizan en la tabla sin page reload
- Badges de severidad y canal con colores

```javascript
let ws;
function connectWS() {
  ws = new WebSocket(`ws://${location.hostname}:${WS_PORT}`);

  ws.onopen = () => {
    console.log("WS conectado");
    setConnectionBadge("connected");
  };

  ws.onmessage = (e) => {
    const event = JSON.parse(e.data);
    addEventToTable(event); // Render sin reload
    updateKpis();
    showToast(`Nuevo evento: ${event.source}`, event.severity);
  };

  ws.onclose = () => {
    setConnectionBadge("disconnected");
    setTimeout(connectWS, 3000); // Auto-reconnect
  };
}
connectWS();
```

> **Explicación:** Al recibir un mensaje WS, se parsea el JSON y se añade a la tabla en tiempo real (no necesita polling). Si la conexión se cierra, se reintenta cada 3 segundos automáticamente. Esto da una experiencia real-time.

---

## 3. Presentación del proyecto

- **Flujo:** Evento llega (TCP/HTTP) → register_event() → SQLite + WS broadcast + Email → Dashboard actualiza en vivo
- **4 canales:** TCP (socketserver), WebSocket (websockets+asyncio), SMTP (smtplib+TLS), HTTP (Flask)
- **Demo:** `python app.py` → abrir dashboard → enviar evento con `tcp_event_client.py` → ver en vivo
- **Concurrencia:** 3 hilos: Flask + TCP server + WS server (cada uno en su hilo daemon)

---

## 4. Conclusión

- **Competencias:** TCP sockets, WebSocket, asyncio, SMTP+TLS, multi-threading, event-driven architecture
- **Conceptos PSP:** ThreadingMixIn, asyncio event loop en hilo separado, `run_coroutine_threadsafe` bridge
- **Real-time:** WS broadcast permite ver eventos al instante sin polling
- **Extensibilidad:** Nuevo canal = nueva función en register_event() (ej: Telegram, Slack)
- **Valoración:** Sistema multi-canal profesional que demuestra 4 protocolos de comunicación concurrentes
