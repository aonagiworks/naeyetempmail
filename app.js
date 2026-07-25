// NaeyaTempMail — UI + mail.tm API controller
const API = 'https://api.mail.tm';
const STORAGE_KEY = 'naeyatempmail.session.v1';
const THEME_KEY = 'naeyatempmail.theme';
const POLL_MS = 8000;

/** @type {{ address: string, password: string, token: string, accountId: string, domain: string } | null} */
let session = null;
let pollTimer = null;
let selectedId = null;
let busy = false;

const $ = (id) => document.getElementById(id);

const el = {
  email: $('emailAddress'),
  badge: $('liveBadge'),
  liveDot: $('liveDot'),
  liveText: $('liveText'),
  error: $('errorBanner'),
  btnGenerate: $('btnGenerate'),
  btnCopy: $('btnCopy'),
  btnRefresh: $('btnRefresh'),
  btnNew: $('btnNew'),
  domainInfo: $('domainInfo'),
  mailCount: $('mailCount'),
  pollInfo: $('pollInfo'),
  inboxList: $('inboxList'),
  emptyState: $('emptyState'),
  drawer: $('emailDrawer'),
  overlay: $('drawerOverlay'),
  drawerSubject: $('drawerSubject'),
  drawerSender: $('drawerSender'),
  drawerEmail: $('drawerEmail'),
  drawerTime: $('drawerTime'),
  drawerBody: $('drawerBody'),
  toast: $('toast'),
  themeToggle: $('themeToggle'),
};

function toast(msg) {
  el.toast.textContent = msg;
  el.toast.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.toast.classList.remove('show'), 2200);
}

function setError(msg) {
  if (!msg) {
    el.error.classList.add('hidden');
    el.error.textContent = '';
    return;
  }
  el.error.textContent = msg;
  el.error.classList.remove('hidden');
}

function setLive(live, text) {
  el.liveText.textContent = text;
  el.liveDot.className = `w-2 h-2 rounded-full ${live ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'}`;
  el.badge.className = live
    ? 'flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-xs font-medium'
    : 'flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-500/10 border border-slate-500/20 text-slate-500 dark:text-slate-400 text-xs font-medium';
}

function setButtons(hasSession) {
  el.btnCopy.disabled = !hasSession;
  el.btnRefresh.disabled = !hasSession;
  el.btnNew.disabled = !hasSession;
  el.btnGenerate.disabled = hasSession || busy;
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
    el.email.value = '';
    el.email.placeholder = 'Tekan Generate untuk buat email...';
    el.domainInfo.textContent = '—';
    el.mailCount.textContent = '0 Message';
    el.pollInfo.textContent = 'off';
    setLive(false, 'Idle');
    showEmpty(true);
    return;
  }
  el.email.value = session.address;
  el.domainInfo.textContent = session.domain;
  setLive(true, 'Live Sync');
  el.pollInfo.textContent = `every ${POLL_MS / 1000}s`;
}

function showEmpty(show) {
  el.emptyState.classList.toggle('hidden', !show);
  el.emptyState.classList.toggle('flex', show);
  el.inboxList.classList.toggle('hidden', show);
}

function timeAgo(iso) {
  if (!iso) return '';
  const diff = Math.max(0, Date.now() - new Date(iso).getTime());
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(iso).toLocaleString();
}

async function createSession() {
  if (busy) return;
  busy = true;
  setButtons(!!session);
  setError('');
  setLive(false, 'Creating…');
  el.btnGenerate.disabled = true;
  try {
    const domain = await pickDomain();
    const address = `${randLocal(10)}@${domain}`;
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
    };
    saveSession();
    renderEmail();
    setButtons(true);
    startPoll();
    toast('Email siap dipakai');
    await refreshMessages();
  } catch (err) {
    setError(`Gagal generate: ${err.message}`);
    setLive(false, 'Error');
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
    el.mailCount.textContent = `${total} Message${total === 1 ? '' : 's'}`;
    renderList(items);
    setLive(true, 'Live Sync');
    setError('');
  } catch (err) {
    if (String(err.message).startsWith('401')) {
      setError('Session expired. Generate alamat baru.');
      stopPoll();
      session = null;
      saveSession();
      renderEmail();
      setButtons(false);
      return;
    }
    setError(`Gagal ambil inbox: ${err.message}`);
    setLive(false, 'Error');
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
    const fromAddr = m.from?.address || '';
    const subject = m.subject || '(no subject)';
    const intro = m.intro || '';
    const when = timeAgo(m.createdAt);
    const row = document.createElement('div');
    row.className = `p-4 sm:px-6 hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer transition-colors flex items-center justify-between gap-4 ${m.id === selectedId ? 'bg-indigo-50/60 dark:bg-indigo-950/20' : ''}`;
    row.innerHTML = `
      <div class="flex items-start gap-3 min-w-0">
        <span class="w-2.5 h-2.5 mt-1.5 rounded-full ${m.seen ? 'bg-slate-300 dark:bg-slate-600' : 'bg-indigo-600'} shrink-0"></span>
        <div class="min-w-0">
          <div class="flex items-center gap-2">
            <h4 class="text-sm font-semibold truncate">${escapeHtml(fromName)}</h4>
            <span class="text-xs text-slate-400 truncate hidden sm:inline">&lt;${escapeHtml(fromAddr)}&gt;</span>
          </div>
          <p class="text-xs font-medium text-slate-800 dark:text-slate-200 truncate mt-0.5">${escapeHtml(subject)}</p>
          <p class="text-xs text-slate-400 truncate mt-0.5">${escapeHtml(intro)}</p>
        </div>
      </div>
      <span class="text-xs text-slate-400 whitespace-nowrap shrink-0">${escapeHtml(when)}</span>`;
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
  el.drawerEmail.textContent = '';
  el.drawerTime.textContent = '';
  el.drawerBody.innerHTML = '<p class="text-slate-400">Loading message…</p>';
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
    el.drawerSender.textContent = fromName;
    el.drawerEmail.textContent = fromAddr ? `<${fromAddr}>` : '';
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
    // re-render list to update seen dots / active
    refreshMessages();
  } catch (err) {
    el.drawerBody.innerHTML = `<p class="text-red-500">Gagal buka pesan: ${escapeHtml(err.message)}</p>`;
  }
}

function openDrawer() {
  el.drawer.classList.remove('translate-x-full');
  el.overlay.classList.remove('opacity-0', 'pointer-events-none');
  el.overlay.classList.add('opacity-100');
}

function closeDrawer() {
  el.drawer.classList.add('translate-x-full');
  el.overlay.classList.add('opacity-0', 'pointer-events-none');
  el.overlay.classList.remove('opacity-100');
}

async function copyEmail() {
  if (!session) return;
  try {
    await navigator.clipboard.writeText(session.address);
    const original = el.btnCopy.innerHTML;
    el.btnCopy.classList.replace('bg-indigo-600', 'bg-emerald-600');
    el.btnCopy.classList.replace('hover:bg-indigo-700', 'hover:bg-emerald-700');
    el.btnCopy.innerHTML = `
      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>
      <span>Copied!</span>`;
    toast('Email disalin');
    setTimeout(() => {
      el.btnCopy.classList.replace('bg-emerald-600', 'bg-indigo-600');
      el.btnCopy.classList.replace('hover:bg-emerald-700', 'hover:bg-indigo-700');
      el.btnCopy.innerHTML = original;
    }, 1800);
  } catch {
    toast('Gagal copy — salin manual');
  }
}

function startPoll() {
  stopPoll();
  pollTimer = setInterval(refreshMessages, POLL_MS);
  el.pollInfo.textContent = `every ${POLL_MS / 1000}s`;
  setLive(true, 'Live Sync');
}

function stopPoll() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
  el.pollInfo.textContent = 'off';
}

async function newAddress() {
  if (busy) return;
  const ok = confirm('Buat alamat baru? Inbox lama akan hilang dari sesi ini.');
  if (!ok) return;
  stopPoll();
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
  await createSession();
}

function initTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === 'light') document.documentElement.classList.remove('dark');
  else if (saved === 'dark') document.documentElement.classList.add('dark');
  // default stays dark from html class
}

// Events
document.addEventListener('DOMContentLoaded', () => {
  initTheme();

  el.themeToggle?.addEventListener('click', () => {
    document.documentElement.classList.toggle('dark');
    localStorage.setItem(
      THEME_KEY,
      document.documentElement.classList.contains('dark') ? 'dark' : 'light',
    );
  });

  el.btnGenerate.addEventListener('click', createSession);
  el.btnCopy.addEventListener('click', copyEmail);
  el.btnRefresh.addEventListener('click', refreshMessages);
  el.btnNew.addEventListener('click', newAddress);
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

  // boot
  (async function boot() {
    const saved = loadSession();
    if (!saved?.token || !saved?.address) {
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
