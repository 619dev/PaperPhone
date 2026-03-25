/**
 * Main App Router — PaperPhone
 * Single-page app with 4-tab navigation
 */
import { getToken, api } from './api.js';
import { connect, onEvent } from './socket.js';
import { renderLogin } from './pages/login.js';
import { renderChats } from './pages/chats.js';
import { renderContacts } from './pages/contacts.js';
import { renderDiscover } from './pages/discover.js';
import { renderProfile } from './pages/profile.js';
import { t, onLangChange } from './i18n.js';
import { callManager } from './services/webrtc.js';
import { initCallUI } from './pages/call.js';

// ── Global State ──────────────────────────────────────────────────────────
export const state = {
  user: null,
  chats: [],          // [{ id, type, name, avatar, lastMsg, lastTs, unread }]
  sessions: {},       // userId/groupId -> ratchet state
  contacts: [],
  activeTab: 'chats',
  chatView: null,     // { id, type } or null
  contactBadge: 0,    // pending friend requests count
  call: null,         // active call info or null
};

const root = document.getElementById('app');

// ── Toast helper ──────────────────────────────────────────────────────────
export function showToast(msg, ms = 1800) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

// ── Avatar helper ─────────────────────────────────────────────────────────
export function avatarEl(name, url, cls = '') {
  if (url) {
    const img = document.createElement('img');
    img.className = `avatar ${cls}`;
    img.src = url;
    img.alt = name;
    return img;
  }
  const div = document.createElement('div');
  div.className = `avatar ${cls}`;
  div.style.background = nameColor(name);
  div.textContent = (name || '?')[0].toUpperCase();
  return div;
}

const COLORS = ['#2196F3','#E91E63','#9C27B0','#FF5722','#607D8B','#009688','#795548'];
function nameColor(name) { return COLORS[(name || '').charCodeAt(0) % COLORS.length]; }

export function formatTime(ts) {
  const d = new Date(ts), now = new Date();
  const diff = now - d;
  if (diff < 60e3) return '< 1m';
  if (diff < 3600e3) return `${Math.floor(diff / 60e3)}m`;
  if (d.toDateString() === now.toDateString()) return d.toTimeString().slice(0, 5);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

// ── Tab Bar ───────────────────────────────────────────────────────────────
function buildTabBar(active) {
  const tabs = [
    { id: 'chats',    label: t('tabChats'),    icon: chatIcon() },
    { id: 'contacts', label: t('tabContacts'), icon: contactIcon() },
    { id: 'discover', label: t('tabDiscover'), icon: discoverIcon() },
    { id: 'me',       label: t('tabMe'),       icon: meIcon() },
  ];
  const bar = document.createElement('nav');
  bar.className = 'tabbar';
  tabs.forEach(tab => {
    const item = document.createElement('div');
    item.className = `tab-item ${tab.id === active ? 'active' : ''}`;
    item.id = `tab-${tab.id}`;
    const chatUnread = state.chats.reduce((n, c) => n + (c.unread || 0), 0);
    const contactBadge = tab.id === 'contacts' && state.contactBadge > 0;
    item.innerHTML = `
      <div class="tab-icon">
        ${tab.icon}
        ${tab.id === 'chats' && chatUnread > 0
          ? `<div class="tab-badge">${chatUnread > 99 ? '99+' : chatUnread}</div>` : ''}
        ${contactBadge ? '<div class="tab-badge tab-badge-sm"></div>' : ''}
      </div>
      <span class="tab-label">${tab.label}</span>`;
    item.addEventListener('click', () => {
      if (tab.id === 'contacts') state.contactBadge = 0;
      navigateTo(tab.id);
    });
    bar.appendChild(item);
  });
  return bar;
}

// ── Navigation ────────────────────────────────────────────────────────────
export function navigateTo(tab, data) {
  // Cleanup previous chat listeners
  const appEl = document.getElementById('app');
  if (appEl?._cleanup) { appEl._cleanup(); appEl._cleanup = null; }
  state.activeTab = tab;
  state.chatView = null;
  render();
  if (data) window._navData = data;
}

export function openChat(chat) {
  state.chatView = chat;
  render();
}

export function goBack() {
  // Cleanup chat listeners before going back
  const appEl = document.getElementById('app');
  if (appEl?._cleanup) { appEl._cleanup(); appEl._cleanup = null; }
  state.chatView = null;
  render();
}

/**
 * Called by login.js after a successful login/register.
 * Loads initial data and renders the main app WITHOUT reloading the page,
 * so the in-memory key cache (keystore.js _memCache) is preserved.
 */
export async function navigateAfterLogin(userData) {
  state.user = userData;
  connect();
  setupGlobalSocketHandlers();
  try {
    const [friends, groups] = await Promise.all([api.friends(), api.groups()]);
    state.contacts = friends;
    state.chats = [
      ...friends.map(f => ({
        id: f.id, type: 'private', name: f.nickname || f.username, avatar: f.avatar,
        lastMsg: '', lastTs: 0, unread: 0,
      })),
      ...groups.map(g => ({
        id: g.id, type: 'group', name: g.name, avatar: g.avatar,
        lastMsg: '', lastTs: 0, unread: 0,
      })),
    ];
  } catch { /* continue with empty lists */ }
  render();
  initCallUI();
}

function render() {
  root.innerHTML = '';
  if (!state.user) {
    renderLogin(root);
    return;
  }

  if (state.chatView) {
    // Full-screen chat; tabs hidden
    import('./pages/chat.js').then(m => m.renderChat(root, state.chatView));
    return;
  }

  const page = document.createElement('div');
  page.className = 'page';
  const tabbar = buildTabBar(state.activeTab);

  switch (state.activeTab) {
    case 'chats':    renderChats(page); break;
    case 'contacts': renderContacts(page); break;
    case 'discover': renderDiscover(page); break;
    case 'me':       renderProfile(page); break;
  }

  root.appendChild(page);
  root.appendChild(tabbar);
}

// ── Incoming WS messages ──────────────────────────────────────────────────
function setupGlobalSocketHandlers() {
  onEvent('message', msg => {
    // Update chat list unread count
    const key = msg.group_id || msg.from;
    const chat = state.chats.find(c => c.id === key);
    if (chat && state.chatView?.id !== key) {
      chat.unread = (chat.unread || 0) + 1;
      chat.lastMsg = t('encryptedMsg');
      chat.lastTs = msg.ts;
      // re-render tab dot
      const tabBar = root.querySelector('.tabbar');
      if (tabBar) root.replaceChild(buildTabBar(state.activeTab), tabBar);
    } else if (!chat) {
      // New conversation — try to find sender in contacts for display name
      const contact = state.contacts.find(c => c.id === key);
      state.chats.unshift({
        id: key,
        type: msg.group_id ? 'group' : 'private',
        name: contact ? (contact.nickname || contact.username) : t('newMessage'),
        avatar: contact?.avatar || null,
        lastMsg: t('encryptedMsg'),
        lastTs: msg.ts,
        unread: 1,
      });
    }
  });
  onEvent('friend_request', () => {
    showToast(t('newFriendRequest'));
    state.contactBadge++;
    // Re-render tab bar to show badge
    const tabBar = root.querySelector('.tabbar');
    if (tabBar) root.replaceChild(buildTabBar(state.activeTab), tabBar);
  });
  onEvent('friend_accepted', () => showToast(t('friendAccepted')));

  // Real-time online/offline status
  onEvent('online', ({ user_id }) => {
    const contact = state.contacts.find(c => c.id === user_id);
    if (contact) contact.is_online = true;
  });
  onEvent('offline', ({ user_id }) => {
    const contact = state.contacts.find(c => c.id === user_id);
    if (contact) contact.is_online = false;
  });

  // ── Call signaling → callManager ─────────────────────────────────────
  onEvent('call_offer', msg => {
    const contact = state.contacts.find(c => c.id === msg.from);
    callManager.handleOffer({
      ...msg,
      name: contact ? (contact.nickname || contact.username) : msg.from,
      avatar: contact?.avatar || null,
    });
  });
  onEvent('call_answer',       msg => callManager.handleAnswer(msg));
  onEvent('ice_candidate',     msg => callManager.handleIceCandidate(msg));
  onEvent('call_invite',       msg => {
    const contact = state.contacts.find(c => c.id === msg.from);
    callManager.handleCallInvite({
      ...msg,
      name: contact ? (contact.nickname || contact.username) : msg.from,
      avatar: contact?.avatar || null,
    });
  });
  onEvent('call_end',    msg => callManager.handleCallEnd(msg));
  onEvent('call_reject', msg => callManager.handleCallReject(msg));
  onEvent('call_cancel', ()  => callManager.handleCallCancel());
}

// ── Bootstrap ─────────────────────────────────────────────────────────────
async function init() {
  if (!getToken()) { render(); return; }

  try {
    state.user = await api.me();
    connect();
    setupGlobalSocketHandlers();

    const [friends, groups] = await Promise.all([api.friends(), api.groups()]);
    state.contacts = friends;
    state.chats = [
      ...friends.map(f => ({
        id: f.id, type: 'private', name: f.nickname || f.username, avatar: f.avatar,
        lastMsg: '', lastTs: 0, unread: 0,
      })),
      ...groups.map(g => ({
        id: g.id, type: 'group', name: g.name, avatar: g.avatar,
        lastMsg: '', lastTs: 0, unread: 0,
      })),
    ];
  } catch {
    localStorage.removeItem('pp_token');
    render();
    return;
  }

  render();
  initCallUI();

  // Always check for missing keys AFTER render (never inside a try that swallows errors)
  try {
    const { getKey, setKey: setK } = await import('./crypto/keystore.js');
    const ikCheck = await getKey('ik');
    if (!ikCheck) _showKeyRepairBanner(getKey, setK);
  } catch { /* keystore unavailable */ }
}

function _showKeyRepairBanner(getKey, setK) {
  if (document.getElementById('key-repair-banner')) return; // already showing
  const banner = document.createElement('div');
  banner.id = 'key-repair-banner';
  banner.style.cssText = [
    'position:fixed;top:0;left:0;right:0;z-index:9999;',
    'background:#FF3B30;color:#fff;',
    'padding:env(safe-area-inset-top,12px) 16px 12px;',
    'font-size:14px;text-align:center;',
    'display:flex;align-items:center;justify-content:center;gap:10px;',
  ].join('');
  banner.innerHTML = `
    <span>⚠️ 本地密钥丢失，无法加密消息</span>
    <button id="repair-keys-btn" style="
      background:#fff;color:#FF3B30;border:none;
      border-radius:8px;padding:5px 12px;font-size:13px;
      font-weight:600;cursor:pointer;">重新生成密钥</button>
  `;
  document.body.appendChild(banner);

  document.getElementById('repair-keys-btn').onclick = async () => {
    try {
      banner.innerHTML = '<span>⏳ 正在生成密钥...</span>';
      await window._sodiumPromise;
      const { generateIdentityKeyPair, generateSignedPreKey, generateOneTimePreKey } = await import('./crypto/ratchet.js');
      const ik  = await generateIdentityKeyPair();
      const spk = await generateSignedPreKey(ik.privateKey);
      const opks = await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          generateOneTimePreKey().then(k => ({ key_id: i, opk_pub: k.publicKey, _priv: k.privateKey }))
        )
      );
      await setK('ik', ik);
      await setK('spk', spk);
      for (const opk of opks) await setK(`opk_${opk.key_id}`, { privateKey: opk._priv });

      await api.uploadKeys({
        ik_pub: ik.publicKey, spk_pub: spk.publicKey, spk_sig: spk.signature,
        kem_pub: ik.publicKey,
        prekeys: opks.map(({ key_id, opk_pub }) => ({ key_id, opk_pub })),
      });
      banner.remove();
      showToast('✅ 密钥已生成并上传');
    } catch (e) {
      banner.innerHTML = `<span>❌ 修复失败: ${e.message}</span>`;
    }
  };
}

init();

// Re-render tabs when language changes (if not in chat view)
onLangChange(() => {
  if (state.user && !state.chatView) {
    const tabBar = root.querySelector('.tabbar');
    if (tabBar) root.replaceChild(buildTabBar(state.activeTab), tabBar);
  }
});

// ── SVG Icons ─────────────────────────────────────────────────────────────
function chatIcon() {
  return `<svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>`;
}
function contactIcon() {
  return `<svg viewBox="0 0 24 24"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg>`;
}
function discoverIcon() {
  return `<svg viewBox="0 0 24 24"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>`;
}
function meIcon() {
  return `<svg viewBox="0 0 24 24"><path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z"/></svg>`;
}
