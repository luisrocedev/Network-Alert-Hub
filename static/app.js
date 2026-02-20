/* ═══════════════════════════════════════════════════
   Network Alert Hub · Frontend v2                    
   ═══════════════════════════════════════════════════ */

/* ─── DOM cache ─── */
const el = {
  source:        document.getElementById('source'),
  severity:      document.getElementById('severity'),
  message:       document.getElementById('message'),
  charCount:     document.getElementById('charCount'),
  sendBtn:       document.getElementById('sendBtn'),
  liveState:     document.getElementById('liveState'),
  eventsBody:    document.getElementById('eventsBody'),
  emailsBody:    document.getElementById('emailsBody'),
  dashEventsBody:document.getElementById('dashEventsBody'),
  dashEmailsBody:document.getElementById('dashEmailsBody'),
  auditGrid:     document.getElementById('auditGrid'),
  kpiTotal:      document.getElementById('kpiTotal'),
  kpiCritical:   document.getElementById('kpiCritical'),
  kpiError:      document.getElementById('kpiError'),
  kpiWarning:    document.getElementById('kpiWarning'),
  kpiInfo:       document.getElementById('kpiInfo'),
  kpiEmail:      document.getElementById('kpiEmail'),
  statusDot:     document.getElementById('statusDot'),
  darkToggle:    document.getElementById('darkToggle'),
  exportBtn:     document.getElementById('exportBtn'),
  importFile:    document.getElementById('importFile'),
  seedBtn:       document.getElementById('seedBtn'),
  searchEvents:  document.getElementById('searchEvents'),
  searchEmails:  document.getElementById('searchEmails'),
  toastBox:      document.getElementById('toastBox'),
  confirmOverlay:document.getElementById('confirmOverlay'),
  confirmMsg:    document.getElementById('confirmMsg'),
  confirmYes:    document.getElementById('confirmYes'),
  confirmNo:     document.getElementById('confirmNo'),
};

let ws = null;
let cachedEvents = [];
let cachedEmails = [];
let cachedStats  = null;

/* ═══ Dark mode ═══ */
(function initTheme() {
  const saved = localStorage.getItem('nah-theme');
  if (saved === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
})();

el.darkToggle.addEventListener('click', () => {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  if (isDark) {
    document.documentElement.removeAttribute('data-theme');
    localStorage.setItem('nah-theme', 'light');
  } else {
    document.documentElement.setAttribute('data-theme', 'dark');
    localStorage.setItem('nah-theme', 'dark');
  }
});

/* ═══ Tabs ═══ */
document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    const panel = document.getElementById('tab-' + btn.dataset.tab);
    if (panel) panel.classList.add('active');
  });
});

/* ═══ Toasts ═══ */
function toast(msg, tone = 'info') {
  const div = document.createElement('div');
  div.className = `toast toast-${tone}`;
  div.textContent = msg;
  el.toastBox.appendChild(div);
  setTimeout(() => { div.classList.add('out'); }, 2800);
  setTimeout(() => { div.remove(); }, 3200);
}

/* ═══ Confirm overlay ═══ */
function nousConfirm(msg) {
  return new Promise(resolve => {
    el.confirmMsg.textContent = msg;
    el.confirmOverlay.classList.remove('hidden');
    const clean = (val) => { el.confirmOverlay.classList.add('hidden'); resolve(val); };
    el.confirmYes.onclick = () => clean(true);
    el.confirmNo.onclick  = () => clean(false);
  });
}

/* ═══ Status dot ═══ */
async function checkHealth() {
  try {
    const r = await fetch('/api/stats');
    el.statusDot.classList.toggle('online', r.ok);
    el.statusDot.classList.toggle('offline', !r.ok);
  } catch {
    el.statusDot.classList.remove('online');
    el.statusDot.classList.add('offline');
  }
}
setInterval(checkHealth, 5000);
checkHealth();

/* ═══ Char counter ═══ */
el.message.addEventListener('input', () => {
  el.charCount.textContent = `${el.message.value.length} / 300`;
});

/* ═══ Helpers ═══ */
function sevClass(s) { return `sev-${String(s || 'info').toLowerCase()}`; }

function channelBadge(ch) {
  if (ch === 'tcp_socket') return '<span class="badge-channel ch-tcp">TCP</span>';
  if (ch === 'http_api')   return '<span class="badge-channel ch-http">HTTP</span>';
  return ch;
}

function emptyRow(cols, msg) {
  return `<tr><td colspan="${cols}" class="empty-state">${msg}</td></tr>`;
}

/* ═══ Render events ═══ */
function renderEvents(items, query) {
  const q = (query || '').toLowerCase();
  const filtered = q ? items.filter(i =>
    (i.message + i.source + i.severity + i.channel).toLowerCase().includes(q)
  ) : items;

  if (!filtered.length) {
    el.eventsBody.innerHTML = emptyRow(6, 'No hay eventos registrados.');
    return;
  }
  el.eventsBody.innerHTML = filtered.map(i => `
    <tr>
      <td>${i.id}</td>
      <td>${i.created_at}</td>
      <td>${i.source}</td>
      <td><span class="pill ${sevClass(i.severity)}">${i.severity}</span></td>
      <td>${channelBadge(i.channel)}</td>
      <td>${i.message}</td>
    </tr>
  `).join('');
}

/* ═══ Render email logs ═══ */
function renderEmails(items, query) {
  const q = (query || '').toLowerCase();
  const filtered = q ? items.filter(i =>
    (i.status + i.detail + i.recipient + String(i.event_id)).toLowerCase().includes(q)
  ) : items;

  if (!filtered.length) {
    el.emailsBody.innerHTML = emptyRow(6, 'No hay alertas de email.');
    return;
  }
  el.emailsBody.innerHTML = filtered.map(i => `
    <tr>
      <td>${i.id}</td>
      <td>${i.event_id}</td>
      <td>${i.created_at}</td>
      <td><span class="pill ${i.status === 'sent' ? 'sev-info' : i.status === 'skipped' ? 'sev-warning' : 'sev-error'}">${i.status}</span></td>
      <td>${i.recipient || '—'}</td>
      <td>${i.detail || ''}</td>
    </tr>
  `).join('');
}

/* ═══ Render dashboard mini-tables ═══ */
function renderDashboard() {
  const last5 = cachedEvents.slice(0, 5);
  el.dashEventsBody.innerHTML = last5.length ? last5.map(i => `
    <tr>
      <td>${i.id}</td>
      <td>${i.created_at}</td>
      <td><span class="pill ${sevClass(i.severity)}">${i.severity}</span></td>
      <td>${channelBadge(i.channel)}</td>
      <td>${i.message}</td>
    </tr>
  `).join('') : emptyRow(5, 'Sin eventos aún.');

  const last5e = cachedEmails.slice(0, 5);
  el.dashEmailsBody.innerHTML = last5e.length ? last5e.map(i => `
    <tr>
      <td>${i.event_id}</td>
      <td>${i.created_at}</td>
      <td><span class="pill ${i.status === 'sent' ? 'sev-info' : 'sev-warning'}">${i.status}</span></td>
      <td>${i.detail || ''}</td>
    </tr>
  `).join('') : emptyRow(4, 'Sin alertas email.');
}

/* ═══ Render audit ═══ */
function renderAudit(stats) {
  if (!stats) return;
  const cards = [
    { label: 'Info',     value: stats.severity.info,     color: 'var(--info)' },
    { label: 'Warning',  value: stats.severity.warning,  color: 'var(--warning)' },
    { label: 'Error',    value: stats.severity.error,    color: 'var(--error)' },
    { label: 'Critical', value: stats.severity.critical, color: 'var(--critical)' },
    { label: 'TCP',      value: stats.channels.tcp_socket, color: '#06b6d4' },
    { label: 'HTTP',     value: stats.channels.http_api,   color: 'var(--success)' },
    { label: 'Email OK', value: stats.email.ok,   color: 'var(--success)' },
    { label: 'Email Fail', value: stats.email.fail, color: 'var(--error)' },
  ];
  el.auditGrid.innerHTML = cards.map(c => `
    <div class="audit-card">
      <div class="label">${c.label}</div>
      <span class="value" style="color:${c.color}">${c.value}</span>
    </div>
  `).join('');
}

/* ═══ Update KPIs ═══ */
function updateKpis(stats) {
  el.kpiTotal.textContent    = stats.total_events;
  el.kpiCritical.textContent = stats.severity.critical;
  el.kpiError.textContent    = stats.severity.error;
  el.kpiWarning.textContent  = stats.severity.warning;
  el.kpiInfo.textContent     = stats.severity.info;
  el.kpiEmail.textContent    = `${stats.email.ok} / ${stats.email.fail}`;
}

/* ═══ Load all data ═══ */
async function loadAll() {
  try {
    const [eventsRes, statsRes] = await Promise.all([
      fetch('/api/events?limit=80'),
      fetch('/api/stats'),
    ]);
    if (!eventsRes.ok || !statsRes.ok) return;

    const eventsData = await eventsRes.json();
    const statsData  = await statsRes.json();

    cachedEvents = eventsData.items || [];
    cachedEmails = eventsData.email_logs || [];
    cachedStats  = statsData;

    renderEvents(cachedEvents, el.searchEvents.value);
    renderEmails(cachedEmails, el.searchEmails.value);
    renderDashboard();
    renderAudit(cachedStats);
    updateKpis(cachedStats);
  } catch { /* silently retry next cycle */ }
}

/* ═══ Live search ═══ */
el.searchEvents.addEventListener('input', () => renderEvents(cachedEvents, el.searchEvents.value));
el.searchEmails.addEventListener('input', () => renderEmails(cachedEmails, el.searchEmails.value));

/* ═══ Post manual event ═══ */
async function postManualEvent() {
  const payload = {
    source:   el.source.value.trim() || 'panel-web',
    severity: el.severity.value,
    message:  el.message.value.trim() || 'Evento manual',
  };
  const res = await fetch('/api/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error('No se pudo crear el evento');
  return res.json();
}

el.sendBtn.addEventListener('click', async () => {
  el.sendBtn.disabled = true;
  try {
    await postManualEvent();
    toast('Evento creado correctamente', 'success');
    el.message.value = '';
    el.charCount.textContent = '0 / 300';
    await loadAll();
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    el.sendBtn.disabled = false;
  }
});

/* ═══ WebSocket ═══ */
function connectWs() {
  const host  = window.location.hostname || '127.0.0.1';
  const wsUrl = `ws://${host}:${window.APP_CONFIG.wsPort}`;
  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    el.liveState.textContent = `WS conectado · ${wsUrl}`;
    el.liveState.classList.add('ok');
  };

  ws.onclose = () => {
    el.liveState.textContent = 'WS desconectado (reintentando…)';
    el.liveState.classList.remove('ok');
    setTimeout(connectWs, 1500);
  };

  ws.onerror = () => {
    el.liveState.textContent = 'WS error';
    el.liveState.classList.remove('ok');
  };

  ws.onmessage = async (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'event' && data.data) {
        await loadAll();
      }
    } catch { /* ignore malformed */ }
  };
}

/* ═══ Export JSON ═══ */
el.exportBtn.addEventListener('click', async () => {
  try {
    const [evR, stR] = await Promise.all([
      fetch('/api/events?limit=200'),
      fetch('/api/stats'),
    ]);
    const evData = await evR.json();
    const stData = await stR.json();
    const blob = new Blob([JSON.stringify({
      events: evData.items,
      email_logs: evData.email_logs,
      stats: stData,
      exported_at: new Date().toISOString(),
    }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `network-alert-hub-export-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast('Datos exportados', 'success');
  } catch {
    toast('Error al exportar', 'error');
  }
});

/* ═══ Import JSON ═══ */
el.importFile.addEventListener('change', async () => {
  const file = el.importFile.files[0];
  if (!file) return;
  const ok = await nousConfirm('¿Importar datos desde archivo JSON? Se crearán como eventos nuevos.');
  if (!ok) { el.importFile.value = ''; return; }

  try {
    const text = await file.text();
    const data = JSON.parse(text);
    const events = data.events || [];
    let created = 0;
    for (const ev of events) {
      await fetch('/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: ev.source, severity: ev.severity, message: ev.message }),
      });
      created++;
    }
    toast(`Importados ${created} eventos`, 'success');
    await loadAll();
  } catch {
    toast('Error al importar archivo', 'error');
  }
  el.importFile.value = '';
});

/* ═══ Seed data ═══ */
const SEED_EVENTS = [
  { source: 'sensor-a',      severity: 'info',     message: 'Heartbeat OK — todos los servicios operativos' },
  { source: 'router-core',   severity: 'warning',  message: 'Latencia elevada detectada en interfaz eth0' },
  { source: 'switch-planta2',severity: 'error',    message: 'Pérdida de paquetes superior al 15% durante 30s' },
  { source: 'firewall-dmz',  severity: 'critical', message: 'Intento de acceso no autorizado desde IP externa' },
  { source: 'sensor-b',      severity: 'info',     message: 'Certificado SSL renovado correctamente' },
];

el.seedBtn.addEventListener('click', async () => {
  const ok = await nousConfirm('¿Generar 5 eventos de demostración?');
  if (!ok) return;
  let n = 0;
  for (const ev of SEED_EVENTS) {
    try {
      await fetch('/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ev),
      });
      n++;
    } catch { /* skip */ }
  }
  toast(`Seed completado: ${n} eventos`, 'success');
  await loadAll();
});

/* ═══ Auto-refresh ═══ */
setInterval(loadAll, 4000);

/* ═══ Init ═══ */
connectWs();
loadAll();
