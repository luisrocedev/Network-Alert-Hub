from __future__ import annotations

import json
import random
import socket
import time

HOST = "127.0.0.1"
PORT = 5090
SOURCES = ["sensor-a", "sensor-b", "router-core", "switch-planta2"]
SEVERITIES = ["info", "warning", "error", "critical"]
MESSAGES = [
    "Heartbeat OK",
    "Latencia elevada detectada",
    "Microcorte de conectividad",
    "Uso de CPU superior al umbral",
    "Error de autenticación repetido",
]


def build_event() -> dict[str, str]:
    return {
        "source": random.choice(SOURCES),
        "severity": random.choices(SEVERITIES, weights=[50, 28, 16, 6], k=1)[0],
        "message": random.choice(MESSAGES),
    }


def main() -> None:
    print(f"Conectando a {HOST}:{PORT}...")
    with socket.create_connection((HOST, PORT), timeout=5) as sock:
        for _ in range(12):
            event = build_event()
            payload = json.dumps(event, ensure_ascii=False) + "\n"
            sock.sendall(payload.encode("utf-8"))
            response = sock.recv(1024).decode("utf-8", errors="ignore").strip()
            print("Enviado:", event, "->", response)
            time.sleep(0.4)


if __name__ == "__main__":
    main()
