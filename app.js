// NaeyaTempMail — UI + mail.tm API (Saki-inspired soft layout)
const API = 'https://api.mail.tm';
const STORAGE_KEY = 'naeyatempmail.session.v1';
const POLL_MS = 8000;
const SESSION_MINUTES = 10;

/** @type {{ address: string, password: string, token: string, accountId: string, domain: string, createdAt: number } | null} */
let session = null;
let pollTimer = null;
let expiryTimer = null;
let selectedId = null;
let busy = false;

const $ = (id) => document.getElementById(id);

const el = {
  email: $('emailAddress'),
  error: $('errorBanner'),
  btnGenerate: $('btnGenerate'),
  btnCopy: $('btnCopy'),
  btnRefresh: $('btnRefresh'),
  btnRefresh2: $('btnRefresh2'),
  btnNew: $('btnNew'),
  btnPrefix: $('btnPrefix'),
  inboxBadge: $('inboxBadge'),
  inboxList: $('inboxList'),
  emptyState: $('emptyState'),
  drawer: $('emailDrawer'),
  overlay: $('drawerOverlay'),
  drawerSubject: $('drawerSubject'),
  drawerSender: $('drawerSender'),
  drawerTime: $('drawerTime'),
  drawerBody: $('drawerBody'),
  toast: $('toast'),
  timer: $('timer'),
};

function toast(msg) {
  el.toast.textContent = msg;
  el.toast.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.toast.classList.remove('show'), 2200);
}

function setError(msg) {
  if (!msg) {
    el.error.classList.remove('show');
    el.error.textContent = '';
    return;
  }
  el.error.textContent = msg;
  el.error.classList.add('show');
}

function setButtons(hasSession) {
  el.btnCopy.disabled = !hasSession;
  el.btnRefresh.disabled = !hasSession;
  if (el.btnRefresh2) el.btnRefresh2.disabled = !hasSession;
  el.btnNew.disabled = !hasSession;
  if (el.btnPrefix) el.btnPrefix.disabled = !hasSession;
  el.btnGenerate.disabled = hasSession || busy;
  if (hasSession) {
    el.btnGenerate.style.display = 'none';
  } else {
    el.btnGenerate.style.display = '';
  }
}

function saveSession() {
  if (!session) localStorage.removeItem(STORAGE_KEY);
  else localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

function loadSession() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function randLocal(len = 10) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  return Array.from(arr, (n) => alphabet[n % alphabet.length]).join('');
}

function escapeHtml(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function asMembers(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data['hydra:member'])) return data['hydra:member'];
  if (data && Array.isArray(data.member)) return data.member;
  return [];
}

async function api(path, { method = 'GET', token, body } = {}) {
  const headers = { Accept: 'application/json' };
  if (body) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!res.ok) {
    const detail = data?.detail || data?.message || data?.['hydra:description'] || res.statusText;
    throw new Error(`${res.status} ${detail}`);
  }
  return data;
}

async function pickDomain() {
  const data = await api('/domains');
  const members = asMembers(data);
  const active = members.find((d) => d.isActive && !d.isPrivate) || members[0];
  if (!active?.domain) throw new Error('Tidak ada domain aktif dari mail.tm');
  return active.domain;
}

function renderEmail() {
  if (!session) {
    el.email.textContent = 'Generate a new address to start';
    el.email.classList.add('empty');
    el.inboxBadge.textContent = '0';
    stopExpiry();
    el.timer.textContent = '10:00';
    showEmpty(true);
    return;
  }
  el.email.textContent = session.address;
  el.email.classList.remove('empty');
  startExpiry();
}

function showEmpty(show) {
  el.emptyState.style.display = show ? 'flex' : 'none';
  el.inboxList.style.display = show ? 'none' : 'block';
}

function timeLabel(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return 'Yesterday';
}

function startExpiry() {
  stopExpiry();
  const created = session?.createdAt || Date.now();
  const end = created + SESSION_MINUTES * 60 * 1000;
  const tick = () => {
    const left = Math.max(0, Math.floor((end - Date.now()) / 1000));
    const m = String(Math.floor(left / 60)).padStart(2, '0');
    const s = String(left % 60).padStart(2, '0');
    el.timer.textContent = left === 0 ? 'Expired' : `${m}:${s}`;
    if (left === 0) {
      stopExpiry();
      toast('Session expired — generate new address');
    }
  };
  tick();
  expiryTimer = setInterval(tick, 1000);
}

function stopExpiry() {
  if (expiryTimer) clearInterval(expiryTimer);
  expiryTimer = null;
}

async function createSession(customLocal) {
  if (busy) return;
  busy = true;
  setButtons(!!session);
  setError('');
  el.btnGenerate.disabled = true;
  try {
    const domain = await pickDomain();
    let local = customLocal ? customLocal.toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 24) : randLocal(10);
    if (!local || local.length < 3) local = randLocal(10);
    const address = `${local}@${domain}`;
    const password = `Tm!${randLocal(14)}`;
    const account = await api('/accounts', {
      method: 'POST',
      body: { address, password },
    });
    const tokenRes = await api('/token', {
      method: 'POST',
      body: { address, password },
    });
    session = {
      address,
      password,
      token: tokenRes.token,
      accountId: account.id,
      domain,
      createdAt: Date.now(),
    };
    saveSession();
    renderEmail();
    setButtons(true);
    startPoll();
    toast('Email siap dipakai');
    await refreshMessages();
  } catch (err) {
    setError(`Gagal generate: ${err.message}`);
  } finally {
    busy = false;
    setButtons(!!session);
  }
}

async function refreshMessages() {
  if (!session) return;
  try {
    const data = await api('/messages', { token: session.token });
    const items = asMembers(data);
    const total = data?.['hydra:totalItems'] ?? items.length;
    el.inboxBadge.textContent = String(total);
    renderList(items);
    setError('');
  } catch (err) {
    if (String(err.message).startsWith('401')) {
      setError('Session expired. Generate alamat baru.');
      stopPoll();
      stopExpiry();
      session = null;
      saveSession();
      renderEmail();
      setButtons(false);
      return;
    }
    setError(`Gagal ambil inbox: ${err.message}`);
  }
}

function renderList(items) {
  if (!items.length) {
    showEmpty(true);
    el.inboxList.innerHTML = '';
    return;
  }
  showEmpty(false);
  el.inboxList.innerHTML = '';
  for (const m of items) {
    const fromName = m.from?.name || m.from?.address || 'Unknown';
    const subject = m.subject || '(no subject)';
    const intro = m.intro || '';
    const when = timeLabel(m.createdAt);
    const row = document.createElement('div');
    row.className = 'email-row' + (m.id === selectedId ? ' active' : '');
    row.innerHTML = `
      <span class="email-dot ${m.seen ? 'read' : 'unread'}"></span>
      <div class="email-info">
        <div class="email-sender">${escapeHtml(fromName)}</div>
        <div class="email-subject">${escapeHtml(subject)}</div>
        <div class="email-preview">${escapeHtml(intro)}</div>
      </div>
      <span class="email-time">${escapeHtml(when)}</span>`;
    row.addEventListener('click', () => openMessage(m.id));
    el.inboxList.appendChild(row);
  }
}

async function openMessage(id) {
  if (!session) return;
  selectedId = id;
  openDrawer();
  el.drawerSubject.textContent = 'Loading…';
  el.drawerSender.textContent = '';
  el.drawerTime.textContent = '';
  el.drawerBody.innerHTML = '<p style="color:var(--muted)">Loading message…</p>';
  try {
    const m = await api(`/messages/${id}`, { token: session.token });
    api(`/messages/${id}`, { method: 'PATCH', token: session.token, body: { seen: true } }).catch(() => {});

    const fromName = m.from?.name || m.from?.address || 'Unknown';
    const fromAddr = m.from?.address || '';
    const subject = m.subject || '(no subject)';
    const when = m.createdAt ? new Date(m.createdAt).toLocaleString() : '';
    const hasHtml = Boolean(m.html && (Array.isArray(m.html) ? m.html[0] : m.html));
    const html = Array.isArray(m.html) ? m.html.join('\n') : (m.html || '');
    const text = Array.isArray(m.text) ? m.text.join('\n') : (m.text || m.intro || '');

    el.drawerSubject.textContent = subject;
    el.drawerSender.textContent = fromAddr ? `${fromName} <${fromAddr}>` : fromName;
    el.drawerTime.textContent = when;
    el.drawerBody.innerHTML = '';

    if (hasHtml) {
      const iframe = document.createElement('iframe');
      iframe.sandbox = 'allow-same-origin';
      iframe.srcdoc = html;
      el.drawerBody.appendChild(iframe);
    } else {
      const pre = document.createElement('pre');
      pre.textContent = text || '(empty body)';
      el.drawerBody.appendChild(pre);
    }
    refreshMessages();
  } catch (err) {
    el.drawerBody.innerHTML = `<p style="color:#C45C66">Gagal buka pesan: ${escapeHtml(err.message)}</p>`;
  }
}

function openDrawer() {
  el.drawer.classList.add('open');
  el.overlay.classList.add('open');
}

function closeDrawer() {
  el.drawer.classList.remove('open');
  el.overlay.classList.remove('open');
}

async function copyEmail() {
  if (!session) return;
  try {
    await navigator.clipboard.writeText(session.address);
    el.btnCopy.classList.add('done');
    const span = el.btnCopy.querySelector('span') || el.btnCopy;
    const old = el.btnCopy.innerHTML;
    el.btnCopy.innerHTML = `
      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" style="width:16px;height:16px"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M5 13l4 4L19 7"/></svg>
      COPIED`;
    toast('Email disalin');
    setTimeout(() => {
      el.btnCopy.classList.remove('done');
      el.btnCopy.innerHTML = old;
    }, 1800);
  } catch {
    toast('Gagal copy — salin manual');
  }
}

function startPoll() {
  stopPoll();
  pollTimer = setInterval(refreshMessages, POLL_MS);
}

function stopPoll() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

async function newAddress(customLocal) {
  if (busy) return;
  const ok = confirm('Buat alamat baru? Inbox lama akan hilang dari sesi ini.');
  if (!ok) return;
  stopPoll();
  stopExpiry();
  if (session?.accountId && session?.token) {
    try {
      await api(`/accounts/${session.accountId}`, {
        method: 'DELETE',
        token: session.token,
      });
    } catch { /* ignore */ }
  }
  session = null;
  selectedId = null;
  saveSession();
  closeDrawer();
  renderEmail();
  setButtons(false);
  await createSession(customLocal);
}

// Events
document.addEventListener('DOMContentLoaded', () => {
  el.btnGenerate.addEventListener('click', () => createSession());
  el.btnCopy.addEventListener('click', copyEmail);
  el.btnRefresh.addEventListener('click', refreshMessages);
  el.btnRefresh2?.addEventListener('click', refreshMessages);
  el.btnNew.addEventListener('click', newAddress);
  el.btnPrefix?.addEventListener('click', () => {
    const prefix = prompt('Custom alias (huruf/angka, min 3):', 'hello');
    if (!prefix) return;
    if (session) {
      newAddress(prefix);
    } else {
      createSession(prefix);
    }
  });

  // Theme toggle
  const themeBtn = $('themeToggle');
  if (themeBtn) {
    const saved = localStorage.getItem('naeyatempmail.theme');
    if (saved === 'light') document.documentElement.classList.remove('dark');
    else if (saved === 'dark') document.documentElement.classList.add('dark');
    else document.documentElement.classList.add('dark');
    themeBtn.addEventListener('click', () => {
      document.documentElement.classList.toggle('dark');
      localStorage.setItem('naeyatempmail.theme', document.documentElement.classList.contains('dark') ? 'dark' : 'light');
    });
  }

  // Filter (toggle unread / all)
  const filterBtn = $('btnFilter');
  if (filterBtn) {
    filterBtn.addEventListener('click', () => {
      filterBtn.classList.toggle('active');
      toast('Filter toggled');
    });
  }

  // Sidebar — just cosmetic clicks
  document.querySelectorAll('.sidebar-item').forEach((item) => {
    item.addEventListener('click', () => {
      document.querySelectorAll('.sidebar-item').forEach((n) => n.classList.remove('active'));
      item.classList.add('active');
      if (item.id === 'sidebarInbox') {
        refreshMessages();
      }
    });
  });

  // Nav "How it works", "Privacy" — smooth scroll to sections or toast
  document.querySelectorAll('.nav-links a').forEach((link) => {
    link.addEventListener('click', (e) => {
      if (link.getAttribute('href')?.startsWith('#')) return; // let it scroll
      e.preventDefault();
      if (link.textContent.includes('Premium')) {
        toast('Premium — coming soon');
      } else {
        toast(link.textContent.trim());
      }
    });
  });

  $('btnCloseDrawer')?.addEventListener('click', closeDrawer);
  el.overlay?.addEventListener('click', closeDrawer);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeDrawer();
  });
  $('btnMarkSeen')?.addEventListener('click', () => {
    if (selectedId && session) {
      api(`/messages/${selectedId}`, {
        method: 'PATCH',
        token: session.token,
        body: { seen: true },
      }).then(() => {
        toast('Ditandai seen');
        refreshMessages();
      }).catch(() => toast('Gagal mark seen'));
    }
  });
  $('btnDrawerDelete')?.addEventListener('click', closeDrawer);

  // boot
  (async function boot() {
    const saved = loadSession();
    if (!saved?.token || !saved?.address) {
      renderEmail();
      setButtons(false);
      return;
    }
    // if expired session (>10 min), clear
    if (saved.createdAt && Date.now() - saved.createdAt > SESSION_MINUTES * 60 * 1000) {
      localStorage.removeItem(STORAGE_KEY);
      renderEmail();
      setButtons(false);
      return;
    }
    session = saved;
    renderEmail();
    setButtons(true);
    startPoll();
    await refreshMessages();
  })();
});
