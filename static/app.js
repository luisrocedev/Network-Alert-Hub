const el = {
  source: document.getElementById('source'),
  severity: document.getElementById('severity'),
  message: document.getElementById('message'),
  sendBtn: document.getElementById('sendBtn'),
  reloadBtn: document.getElementById('reloadBtn'),
  liveState: document.getElementById('liveState'),
  eventsBody: document.getElementById('eventsBody'),
  emailsBody: document.getElementById('emailsBody'),
  kpiTotal: document.getElementById('kpiTotal'),
  kpiCritical: document.getElementById('kpiCritical'),
  kpiError: document.getElementById('kpiError'),
  kpiEmail: document.getElementById('kpiEmail'),
};

let ws = null;

function sevClass(s) {
  return `sev-${String(s || 'info').toLowerCase()}`;
}

function upsertEventRow(item) {
  const row = document.createElement('tr');
  row.innerHTML = `
    <td>${item.id}</td>
    <td>${item.created_at}</td>
    <td>${item.source}</td>
    <td><span class="pill ${sevClass(item.severity)}">${item.severity}</span></td>
    <td>${item.channel}</td>
    <td>${item.message}</td>
  `;
  el.eventsBody.prepend(row);

  while (el.eventsBody.children.length > 80) {
    el.eventsBody.removeChild(el.eventsBody.lastChild);
  }
}

function renderEvents(items) {
  el.eventsBody.innerHTML = '';
  items.forEach((item) => upsertEventRow(item));
}

function renderEmailLogs(items) {
  el.emailsBody.innerHTML = (items || []).map((it) => `
    <tr>
      <td>${it.id}</td>
      <td>${it.event_id}</td>
      <td>${it.created_at}</td>
      <td>${it.status}</td>
      <td>${it.recipient || '—'}</td>
      <td>${it.detail || ''}</td>
    </tr>
  `).join('');
}

function updateKpis(stats) {
  el.kpiTotal.textContent = stats.total_events;
  el.kpiCritical.textContent = stats.severity.critical;
  el.kpiError.textContent = stats.severity.error;
  el.kpiEmail.textContent = `${stats.email.ok} / ${stats.email.fail}`;
}

async function loadAll() {
  const [eventsRes, statsRes] = await Promise.all([
    fetch('/api/events?limit=80'),
    fetch('/api/stats'),
  ]);
  if (!eventsRes.ok || !statsRes.ok) return;

  const eventsData = await eventsRes.json();
  const statsData = await statsRes.json();
  renderEvents(eventsData.items || []);
  renderEmailLogs(eventsData.email_logs || []);
  updateKpis(statsData);
}

async function postManualEvent() {
  const payload = {
    source: el.source.value.trim() || 'panel-web',
    severity: el.severity.value,
    message: el.message.value.trim() || 'Evento manual',
  };

  const res = await fetch('/api/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error('No se pudo crear el evento');
  return res.json();
}

function connectWs() {
  const host = window.location.hostname || '127.0.0.1';
  const wsUrl = `ws://${host}:${window.APP_CONFIG.wsPort}`;
  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    el.liveState.textContent = `WS conectado · ${wsUrl}`;
    el.liveState.classList.add('ok');
  };

  ws.onclose = () => {
    el.liveState.textContent = 'WS desconectado (reintentando...)';
    el.liveState.classList.remove('ok');
    setTimeout(connectWs, 1200);
  };

  ws.onerror = () => {
    el.liveState.textContent = 'WS error';
    el.liveState.classList.remove('ok');
  };

  ws.onmessage = async (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'event' && data.data) {
        upsertEventRow(data.data);
        const statsRes = await fetch('/api/stats');
        if (statsRes.ok) {
          const stats = await statsRes.json();
          updateKpis(stats);
        }
      }
    } catch {
      // no-op
    }
  };
}

el.sendBtn.addEventListener('click', async () => {
  el.sendBtn.disabled = true;
  try {
    await postManualEvent();
    await loadAll();
  } finally {
    el.sendBtn.disabled = false;
  }
});

el.reloadBtn.addEventListener('click', loadAll);

connectWs();
loadAll();
