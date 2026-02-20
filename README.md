<p align="center">
  <img src="https://img.shields.io/badge/Network_Alert_Hub-v2.0-7c3aed?style=for-the-badge" alt="Network Alert Hub v2.0" />
  <img src="https://img.shields.io/badge/Python-3.12+-3776AB?style=for-the-badge&logo=python&logoColor=white" alt="Python" />
  <img src="https://img.shields.io/badge/Flask-3.x-000?style=for-the-badge&logo=flask" alt="Flask" />
  <img src="https://img.shields.io/badge/WebSocket-4.x-4353ff?style=for-the-badge" alt="WebSocket" />
  <img src="https://img.shields.io/badge/SQLite-003B57?style=for-the-badge&logo=sqlite&logoColor=white" alt="SQLite" />
  <img src="https://img.shields.io/badge/License-MIT-green?style=for-the-badge" alt="MIT" />
</p>

<h1 align="center">📡 Network Alert Hub</h1>

<p align="center">
  <strong>Plataforma de monitorización de eventos de red en tiempo real</strong><br/>
  TCP Socket · WebSocket · SMTP · Alertas por email · Dashboard interactivo · Dark mode
</p>

---

## 🚀 ¿Qué es Network Alert Hub?

**Network Alert Hub** es un centro de operaciones de red que unifica la **ingesta de eventos** vía socket TCP, la **difusión en tiempo real** por WebSocket y las **alertas automáticas por email** (SMTP) en una única plataforma con persistencia en SQLite y dashboard web profesional.

El sistema recibe eventos de cualquier fuente externa (sensores, routers, scripts de monitorización), los clasifica por severidad, los almacena, los difunde al panel web en milisegundos y, si la severidad es `error` o `critical`, envía automáticamente una alerta por correo electrónico.

> **Ideal para:** formación en redes y servicios, laboratorios de ciberseguridad, prototipos de NOC (Network Operations Center) y demos técnicas de comunicación multitransporte.

---

## ✨ Características principales

| Categoría | Funcionalidad |
|---|---|
| 📡 **Socket TCP** | Ingesta síncrona de eventos JSON desde cualquier cliente TCP |
| 🔌 **WebSocket** | Difusión asíncrona en tiempo real al panel web con reconexión automática |
| 📧 **SMTP** | Alertas automáticas por email para eventos `error` y `critical` con auditoría |
| 🗄️ **Persistencia** | SQLite con tablas `events` + `email_alerts` y trazabilidad completa |
| 📊 **Dashboard** | 5 pestañas: Dashboard · Crear evento · Eventos · Alertas email · Auditoría |
| 🎯 **6 KPIs** | Total · Critical · Error · Warning · Info · Email OK/Fail con bordes semánticos |
| 🌙 **Dark mode** | Toggle en toolbar con persistencia en `localStorage` |
| 🔔 **Toasts** | Notificaciones contextuales: success · error · warning · info |
| ⚠️ **Confirm overlay** | Diálogo personalizado con `backdrop-filter` para acciones destructivas |
| 📦 **Export JSON** | Descarga completa de eventos + alertas email + estadísticas |
| 📥 **Import JSON** | Restauración de eventos desde archivo con validación |
| 🎲 **Seed de datos** | 5 eventos de demostración inyectados con un clic |
| 🔎 **Búsqueda en vivo** | Filtro instantáneo en tablas de eventos y alertas email |
| 🏷️ **Badges semánticos** | Pills de severidad (info/warning/error/critical) + badges de canal (TCP/HTTP) |
| 📡 **Status dot** | Indicador de salud del backend con heartbeat automático |
| 📱 **Responsive** | 3 breakpoints: escritorio (6 KPIs) · tablet (3) · móvil (2) |
| ♻️ **Auto-refresh** | Refresco automático cada 4 segundos |

---

## 🏗️ Arquitectura

```
┌──────────────────────────────────────────────────────┐
│                        FRONTEND                       │
│  ┌───────────┬───────────┬──────────┬──────────────┐ │
│  │ Dashboard │  Crear    │ Eventos  │ Email/Audit  │ │
│  └───────────┴───────────┴──────────┴──────────────┘ │
│         app.js · styles.css · Dark Mode · Tabs        │
└──────────────┬─────────────────────┬─────────────────┘
               │ REST API            │ WebSocket :8767
┌──────────────▼─────────────────────▼─────────────────┐
│                    FLASK :5060                         │
│  EventPayload ──▶ register_event()                    │
│  insert_event() ──▶ SQLite (events + email_alerts)    │
│  broadcast()    ──▶ WebSocket clients                 │
│  send_email()   ──▶ SMTP (starttls)                   │
└──────────────────────────┬───────────────────────────┘
                           │ TCP Socket :5090
┌──────────────────────────▼───────────────────────────┐
│          THREADED TCP SERVER (multihilo)               │
│  TCPEventHandler ──▶ JSON parse + register_event()    │
│  Clientes: sensores, routers, scripts de monitorización│
└──────────────────────────────────────────────────────┘
```

---

## 📡 API REST

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| `GET` | `/api/events?limit=80` | Historial de eventos + logs de email |
| `POST` | `/api/events` | Crear evento manual (source, severity, message) |
| `GET` | `/api/stats` | KPIs: total, por severidad, por canal, email OK/fail |
| `GET` | `/api/config` | Configuración de puertos WS/TCP/HTTP |

---

## 🛠️ Mejoras v2 implementadas

| # | Mejora | Detalle |
|---|--------|---------|
| 1 | 🌙 Dark mode | Toggle + persistencia en `localStorage` |
| 2 | 🔔 Toasts | 4 tonos: success, error, warning, info |
| 3 | ⚠️ Confirm overlay | `nousConfirm()` con Promise y backdrop-filter |
| 4 | 📊 Dashboard con KPIs | 6 indicadores con borde lateral semántico |
| 5 | 📡 Status dot | Heartbeat automático cada 5s |
| 6 | 🏷️ Badges semánticos | Pills de severidad + badges de canal TCP/HTTP |
| 7 | 🔢 Contador de caracteres | Feedback visual al redactar mensajes |
| 8 | 📦 Export JSON | Backup completo de eventos + emails + stats |
| 9 | 📥 Import JSON | Restauración con validación y confirm |
| 10 | 🎲 Seed de datos | 5 eventos demo con un clic |
| 11 | 🔎 Búsqueda en vivo | Filtro instantáneo en eventos y alertas |
| 12 | 📱 Responsive | 3 breakpoints: 1100px · 700px |
| 13 | 🫙 Empty states | Mensajes informativos en tablas vacías |
| 14 | ♻️ Auto-refresh | `setInterval` cada 4 segundos |

---

## ⚡ Inicio rápido

```bash
# 1 · Clonar
git clone https://github.com/luisrocedev/Network-Alert-Hub.git
cd Network-Alert-Hub

# 2 · Instalar dependencias
pip install -r requirements.txt

# 3 · Arrancar
python app.py
# ─▸ HTTP   http://127.0.0.1:5060
# ─▸ WS     ws://127.0.0.1:8767
# ─▸ TCP    127.0.0.1:5090

# 4 · (Opcional) Simular eventos TCP
python tcp_event_client.py
```

### 📧 SMTP opcional

Copia `.env.example` a `.env` y define credenciales válidas para activar el envío real de alertas por email:

```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=tu_email@gmail.com
SMTP_PASS=tu_app_password
SMTP_FROM=tu_email@gmail.com
SMTP_TO=destinatario@example.com
```

> Sin SMTP configurado, el sistema no falla: registra el intento como `skipped` en la tabla de auditoría.

---

## 📂 Estructura del proyecto

```
Network-Alert-Hub/
├── app.py                   # Backend Flask + TCP + WebSocket + SMTP + SQLite
├── tcp_event_client.py      # Cliente TCP de prueba (12 eventos aleatorios)
├── demo_simple.py           # Lanzador rápido
├── requirements.txt         # Flask + websockets
├── templates/
│   └── index.html           # SPA con 5 tabs + toolbar + dark mode
├── static/
│   ├── app.js               # Lógica frontend completa (v2)
│   └── styles.css           # Design tokens + dark mode + responsive
└── docs/
    └── Actividad_Conexion_Red_Email_Sockets_53945291X.md
```

---

## 🧪 Stack tecnológico

| Capa | Tecnología |
|------|------------|
| **Backend** | Python 3.12 · Flask 3.x · SQLite 3 · `socketserver.ThreadingMixIn` |
| **WebSocket** | `websockets` (asyncio) con reconexión automática en frontend |
| **Email** | `smtplib` (SMTP/STARTTLS) con auditoría en SQLite |
| **Frontend** | HTML5 · CSS3 (custom properties) · JavaScript ES2022 (vanilla) |
| **Protocolo TCP** | JSON de una línea: `{"source":"...","severity":"...","message":"..."}` |

---

## 👤 Autor

**Luis Rodríguez Cedeño** — DAM2 · Actividad PSP-002  
[github.com/luisrocedev](https://github.com/luisrocedev)

---

<p align="center"><em>Network Alert Hub — Eventos, alertas, control total en tiempo real.</em></p>
