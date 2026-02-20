from __future__ import annotations

import asyncio
import json
import os
import smtplib
import socketserver
import sqlite3
import threading
import time
from dataclasses import dataclass
from email.mime.text import MIMEText
from pathlib import Path
from typing import Any

from flask import Flask, jsonify, render_template, request
import websockets

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "network_events.sqlite3"
HTTP_PORT = int(os.getenv("HUB_HTTP_PORT", "5100"))
WS_PORT = int(os.getenv("HUB_WS_PORT", "8767"))
TCP_PORT = int(os.getenv("HUB_TCP_PORT", "5090"))

SEVERITY_LEVELS = ["info", "warning", "error", "critical"]

app = Flask(__name__)

state_lock = threading.Lock()
metrics: dict[str, Any] = {
    "tcp_messages": 0,
    "http_messages": 0,
    "email_sent_ok": 0,
    "email_sent_fail": 0,
}

ws_loop: asyncio.AbstractEventLoop | None = None
ws_clients: set[Any] = set()
ws_lock = threading.Lock()


@dataclass
class EventPayload:
    source: str
    severity: str
    message: str
    channel: str
    raw_payload: str


def db_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    conn = db_conn()
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            created_at TEXT NOT NULL,
            source TEXT NOT NULL,
            severity TEXT NOT NULL,
            message TEXT NOT NULL,
            channel TEXT NOT NULL,
            raw_payload TEXT
        );

        CREATE TABLE IF NOT EXISTS email_alerts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            event_id INTEGER NOT NULL,
            created_at TEXT NOT NULL,
            recipient TEXT,
            status TEXT NOT NULL,
            detail TEXT,
            FOREIGN KEY(event_id) REFERENCES events(id)
        );
        """
    )
    conn.commit()
    conn.close()


def now_text() -> str:
    return time.strftime("%Y-%m-%d %H:%M:%S")


def normalize_severity(value: str) -> str:
    v = value.strip().lower()
    if v not in SEVERITY_LEVELS:
        return "info"
    return v


def insert_event(payload: EventPayload) -> int:
    conn = db_conn()
    cur = conn.execute(
        """
        INSERT INTO events (created_at, source, severity, message, channel, raw_payload)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (
            now_text(),
            payload.source,
            payload.severity,
            payload.message,
            payload.channel,
            payload.raw_payload,
        ),
    )
    conn.commit()
    event_id = int(cur.lastrowid)
    conn.close()
    return event_id


def insert_email_log(event_id: int, recipient: str | None, status: str, detail: str) -> None:
    conn = db_conn()
    conn.execute(
        """
        INSERT INTO email_alerts (event_id, created_at, recipient, status, detail)
        VALUES (?, ?, ?, ?, ?)
        """,
        (event_id, now_text(), recipient, status, detail),
    )
    conn.commit()
    conn.close()


async def _broadcast(payload: dict[str, Any]) -> None:
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


def broadcast(payload: dict[str, Any]) -> None:
    if ws_loop is None or not ws_loop.is_running():
        return
    asyncio.run_coroutine_threadsafe(_broadcast(payload), ws_loop)


def send_email_alert(event_id: int, event_data: dict[str, Any]) -> None:
    smtp_host = os.getenv("SMTP_HOST")
    smtp_port = int(os.getenv("SMTP_PORT", "587"))
    smtp_user = os.getenv("SMTP_USER")
    smtp_pass = os.getenv("SMTP_PASS")
    smtp_to = os.getenv("SMTP_TO")
    smtp_from = os.getenv("SMTP_FROM", smtp_user or "")

    if not all([smtp_host, smtp_user, smtp_pass, smtp_to, smtp_from]):
        insert_email_log(event_id, smtp_to, "skipped", "SMTP no configurado")
        with state_lock:
            metrics["email_sent_fail"] += 1
        return

    subject = f"[NetworkAlertHub] Alerta {event_data['severity'].upper()}"
    body = (
        f"Evento: #{event_id}\n"
        f"Fecha: {event_data['created_at']}\n"
        f"Origen: {event_data['source']}\n"
        f"Canal: {event_data['channel']}\n"
        f"Severidad: {event_data['severity']}\n\n"
        f"Mensaje:\n{event_data['message']}\n"
    )

    msg = MIMEText(body, "plain", "utf-8")
    msg["Subject"] = subject
    msg["From"] = smtp_from
    msg["To"] = smtp_to

    try:
        with smtplib.SMTP(smtp_host, smtp_port, timeout=10) as server:
            server.starttls()
            server.login(smtp_user, smtp_pass)
            server.sendmail(smtp_from, [smtp_to], msg.as_string())

        insert_email_log(event_id, smtp_to, "sent", "Enviado correctamente")
        with state_lock:
            metrics["email_sent_ok"] += 1
    except Exception as exc:
        insert_email_log(event_id, smtp_to, "failed", str(exc))
        with state_lock:
            metrics["email_sent_fail"] += 1


def register_event(payload: EventPayload) -> dict[str, Any]:
    event_id = insert_event(payload)
    event_data = {
        "id": event_id,
        "created_at": now_text(),
        "source": payload.source,
        "severity": payload.severity,
        "message": payload.message,
        "channel": payload.channel,
    }

    with state_lock:
        if payload.channel == "tcp_socket":
            metrics["tcp_messages"] += 1
        if payload.channel == "http_api":
            metrics["http_messages"] += 1

    broadcast({"type": "event", "data": event_data})

    if payload.severity in ("error", "critical"):
        threading.Thread(target=send_email_alert, args=(event_id, event_data), daemon=True).start()

    return event_data


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
            response = json.dumps({"ok": True, "event_id": created["id"]}, ensure_ascii=False)
            self.wfile.write((response + "\n").encode("utf-8"))


class ThreadedTCPServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    allow_reuse_address = True
    daemon_threads = True


async def ws_handler(websocket):
    with ws_lock:
        ws_clients.add(websocket)

    await websocket.send(
        json.dumps(
            {
                "type": "hello",
                "message": "Conectado a Network Alert Hub",
                "timestamp": now_text(),
            },
            ensure_ascii=False,
        )
    )

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
        try:
            async with websockets.serve(ws_handler, "0.0.0.0", WS_PORT):
                await asyncio.Future()
        except OSError as exc:
            print(f"[WS] No se pudo iniciar en :{WS_PORT} — {exc}")

    loop.run_until_complete(runner())


def tcp_server_thread() -> None:
    try:
        with ThreadedTCPServer(("0.0.0.0", TCP_PORT), TCPEventHandler) as server:
            server.serve_forever()
    except OSError as exc:
        print(f"[TCP] No se pudo iniciar en :{TCP_PORT} — {exc}")


def start_background_servers() -> None:
    t1 = threading.Thread(target=ws_server_thread, daemon=True)
    t1.start()

    t2 = threading.Thread(target=tcp_server_thread, daemon=True)
    t2.start()


@app.get("/")
def index() -> str:
    return render_template("index.html", ws_port=WS_PORT, tcp_port=TCP_PORT)


@app.get("/api/events")
def get_events():
    limit = int(request.args.get("limit", 80))
    limit = max(1, min(limit, 200))

    conn = db_conn()
    rows = conn.execute(
        """
        SELECT id, created_at, source, severity, message, channel
        FROM events
        ORDER BY id DESC
        LIMIT ?
        """,
        (limit,),
    ).fetchall()

    email_rows = conn.execute(
        """
        SELECT id, event_id, created_at, recipient, status, detail
        FROM email_alerts
        ORDER BY id DESC
        LIMIT 40
        """
    ).fetchall()
    conn.close()

    return jsonify(
        {
            "ok": True,
            "items": [dict(r) for r in rows],
            "email_logs": [dict(r) for r in email_rows],
        }
    )


@app.get("/api/stats")
def get_stats():
    conn = db_conn()
    by_sev = conn.execute(
        """
        SELECT severity, COUNT(*) as total
        FROM events
        GROUP BY severity
        """
    ).fetchall()
    total_events = conn.execute("SELECT COUNT(*) as total FROM events").fetchone()["total"]
    conn.close()

    sev_map = {r["severity"]: r["total"] for r in by_sev}
    with state_lock:
        snap = dict(metrics)

    return jsonify(
        {
            "ok": True,
            "total_events": total_events,
            "severity": {
                "info": sev_map.get("info", 0),
                "warning": sev_map.get("warning", 0),
                "error": sev_map.get("error", 0),
                "critical": sev_map.get("critical", 0),
            },
            "channels": {
                "tcp_socket": snap["tcp_messages"],
                "http_api": snap["http_messages"],
            },
            "email": {
                "ok": snap["email_sent_ok"],
                "fail": snap["email_sent_fail"],
            },
        }
    )


@app.post("/api/events")
def create_event():
    payload = request.get_json(silent=True) or {}
    source = str(payload.get("source", "panel-web"))[:80]
    severity = normalize_severity(str(payload.get("severity", "info")))
    message = str(payload.get("message", "Evento manual"))[:300]

    event_data = register_event(
        EventPayload(
            source=source,
            severity=severity,
            message=message,
            channel="http_api",
            raw_payload=json.dumps(payload, ensure_ascii=False),
        )
    )

    return jsonify({"ok": True, "event": event_data})


@app.get("/api/config")
def config():
    return jsonify(
        {
            "ok": True,
            "ws_url": f"ws://127.0.0.1:{WS_PORT}",
            "tcp_host": "127.0.0.1",
            "tcp_port": TCP_PORT,
            "http_port": HTTP_PORT,
        }
    )


if __name__ == "__main__":
    init_db()
    start_background_servers()
    app.run(host="127.0.0.1", port=HTTP_PORT, debug=True)
