/**
 * Main App Router — PaperPhone
 * Single-page app with 5-tab navigation
 */
import { getToken, clearToken, api } from './api.js';
import { connect, disconnect, onEvent } from './socket.js';
import { renderLogin } from './pages/login.js';
import { renderChats, refreshChatList } from './pages/chats.js';
import { renderGroups, refreshGroupList } from './pages/groups.js';
import { renderContacts } from './pages/contacts.js';
import { renderDiscover } from './pages/discover.js';
import { renderProfile } from './pages/profile.js';
import { t, onLangChange } from './i18n.js';
import { callManager } from './services/webrtc.js';
import { initCallUI } from './pages/call.js';
import { tryAutoSubscribe } from './services/pushNotification.js';

// ── Global State ──────────────────────────────────────────────────────────
export const state = {
  user: null,
  chats: [],          // [{ id, type, name, avatar, lastMsg, lastTs, unread }]
  sessions: {},       // userId/groupId -> ratchet state
  contacts: [],
  groupsList: [],     // [{ id, name, avatar, notice, owner_id, role, member_count }]
  activeTab: 'chats',
  chatView: null,     // { id, type } or null
  groupInfoView: null, // groupId or null
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
    { id: 'groups',   label: t('tabGroups'),   icon: groupIcon() },
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
  state.groupInfoView = null;
  render();
  if (data) window._navData = data;
}

export function openChat(chat) {
  state.chatView = chat;
  state.groupInfoView = null;
  render();
}

export function openGroupInfo(groupId) {
  state.groupInfoView = groupId;
  state.chatView = null;
  render();
}

export function goBack() {
  // Cleanup chat listeners before going back
  const appEl = document.getElementById('app');
  if (appEl?._cleanup) { appEl._cleanup(); appEl._cleanup = null; }
  if (state.groupInfoView) {
    state.groupInfoView = null;
    render();
    return;
  }
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
    state.groupsList = groups;
    state.chats = [
      ...friends.map(f => ({
        id: f.id, type: 'private', name: f.nickname || f.username, avatar: f.avatar,
        lastMsg: '', lastTs: 0, unread: 0,
      })),
      ...groups.map(g => ({
        id: g.id, type: 'group', name: g.name, avatar: g.avatar,
        lastMsg: '', lastTs: 0, unread: 0, muted: !!g.muted,
      })),
    ];
  } catch { /* continue with empty lists */ }
  render();
  initCallUI();
  tryAutoSubscribe().catch(() => {});
  _checkIncomingCallFromHash();
  _listenServiceWorkerMessages();
}

function render() {
  root.innerHTML = '';
  if (!state.user) {
    renderLogin(root);
    return;
  }

  if (state.groupInfoView) {
    import('./pages/groupInfo.js').then(m => m.renderGroupInfo(root, state.groupInfoView));
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
    case 'groups':   renderGroups(page); break;
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
      // Skip unread increment for muted groups
      if (!chat.muted) {
        chat.unread = (chat.unread || 0) + 1;
      }
      chat.lastMsg = msg.group_id ? (msg.ciphertext || '').slice(0, 30) : t('encryptedMsg');
      chat.lastTs = msg.ts;
      // re-render tab bar badge + chat list
      const tabBar = root.querySelector('.tabbar');
      if (tabBar) root.replaceChild(buildTabBar(state.activeTab), tabBar);
      refreshChatList();
    } else if (!chat) {
      // New conversation — try to find sender in contacts for display name
      const contact = state.contacts.find(c => c.id === key);
      state.chats.unshift({
        id: key,
        type: msg.group_id ? 'group' : 'private',
        name: contact ? (contact.nickname || contact.username) : (msg.from_nickname || t('newMessage')),
        avatar: contact?.avatar || null,
        lastMsg: msg.group_id ? (msg.ciphertext || '').slice(0, 30) : t('encryptedMsg'),
        lastTs: msg.ts,
        unread: 1,
      });
      // re-render tab bar badge + chat list
      const tabBar = root.querySelector('.tabbar');
      if (tabBar) root.replaceChild(buildTabBar(state.activeTab), tabBar);
      refreshChatList();
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

  // ── Group events ────────────────────────────────────────────────────
  onEvent('group_created', ({ group }) => {
    if (!state.groupsList) state.groupsList = [];
    if (!state.groupsList.find(g => g.id === group.id)) {
      state.groupsList.push(group);
    }
    if (!state.chats.find(c => c.id === group.id)) {
      state.chats.push({
        id: group.id, type: 'group', name: group.name, avatar: group.avatar || null,
        lastMsg: '', lastTs: Date.now(), unread: 0,
      });
    }
    refreshGroupList();
    refreshChatList();
  });
  onEvent('group_disbanded', ({ group_id }) => {
    state.groupsList = (state.groupsList || []).filter(g => g.id !== group_id);
    state.chats = state.chats.filter(c => c.id !== group_id);
    refreshGroupList();
    refreshChatList();
    if (state.chatView?.id === group_id || state.groupInfoView === group_id) {
      navigateTo('groups');
    }
  });
  onEvent('group_member_removed', ({ group_id, user_id }) => {
    if (user_id === state.user.id) {
      state.groupsList = (state.groupsList || []).filter(g => g.id !== group_id);
      state.chats = state.chats.filter(c => c.id !== group_id);
      refreshGroupList();
      refreshChatList();
      if (state.chatView?.id === group_id || state.groupInfoView === group_id) {
        navigateTo('groups');
      }
    }
  });

  // ── Auto-delete setting changed by other party ───────────────────────
  onEvent('auto_delete_changed', ({ chat_id, chat_type, auto_delete }) => {
    if (chat_type === 'private') {
      const contact = state.contacts.find(c => c.id === chat_id);
      if (contact) contact.auto_delete = auto_delete;
    } else {
      const group = (state.groupsList || []).find(g => g.id === chat_id);
      if (group) group.auto_delete = auto_delete;
    }
  });

  // ── Session Revoked (device kicked by another session) ───────────────
  onEvent('session_revoked', () => {
    clearToken();
    disconnect();
    try {
      for (const k of Object.keys(localStorage)) {
        if (k.startsWith('ppkl_') || k.startsWith('ppk_')) localStorage.removeItem(k);
      }
    } catch {}
    state.user = null;
    state.chats = [];
    state.contacts = [];
    state.groupsList = [];
    alert(t('sessionRevoked'));
    window.location.reload();
  });

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
    state.groupsList = groups;
    state.chats = [
      ...friends.map(f => ({
        id: f.id, type: 'private', name: f.nickname || f.username, avatar: f.avatar,
        lastMsg: '', lastTs: 0, unread: 0,
      })),
      ...groups.map(g => ({
        id: g.id, type: 'group', name: g.name, avatar: g.avatar,
        lastMsg: '', lastTs: 0, unread: 0, muted: !!g.muted,
      })),
    ];
  } catch {
    localStorage.removeItem('pp_token');
    render();
    return;
  }

  render();
  initCallUI();
  tryAutoSubscribe().catch(() => {});

  // ── Restore incoming call from push notification click ───────────────
  _checkIncomingCallFromHash();
  _listenServiceWorkerMessages();

  // Always check for missing keys AFTER render (never inside a try that swallows errors)
  try {
    const { getKey, setKey: setK } = await import('./crypto/keystore.js');
    const ikCheck = await getKey('ik');
    if (!ikCheck) _showKeyRepairBanner(getKey, setK);
  } catch { /* keystore unavailable */ }
}

/**
 * Check URL hash for incoming call data passed by the Service Worker.
 * Format: #incoming_call?call_from=...&call_id=...&is_video=0|1
 */
function _checkIncomingCallFromHash() {
  const hash = window.location.hash;
  if (!hash.startsWith('#incoming_call?')) return;

  const paramStr = hash.replace('#incoming_call?', '');
  const params = new URLSearchParams(paramStr);
  const from = params.get('call_from');
  const callId = params.get('call_id');
  const isVideo = params.get('is_video') === '1';

  // Clear the hash so it doesn't re-trigger on refresh
  history.replaceState(null, '', window.location.pathname + window.location.search);

  if (!from || !callId) return;

  // Find the caller in contacts for name/avatar
  const contact = state.contacts.find(c => c.id === from);
  const callerName = contact ? (contact.nickname || contact.username) : from;
  const callerAvatar = contact?.avatar || null;

  // Only trigger ringing if callManager is idle (no active call)
  if (callManager.state === 'idle') {
    callManager.callInfo = {
      peerId: from,
      name: callerName,
      avatar: callerAvatar,
      isVideo,
      callId: callId,
      isGroup: false,
    };
    callManager._setState('ringing');
  }
}

/**
 * Listen for messages from the Service Worker (e.g. notification click).
 * Restores the incoming call ringing UI when user taps a call notification
 * while the app is already open in the background.
 */
let _swListenerRegistered = false;
function _listenServiceWorkerMessages() {
  if (_swListenerRegistered) return;
  _swListenerRegistered = true;
  if (!('serviceWorker' in navigator)) return;

  navigator.serviceWorker.addEventListener('message', (event) => {
    const data = event.data;
    if (!data) return;

    if (data.type === 'incoming_call_clicked') {
      const { from, call_id, is_video } = data;
      if (!from || !call_id) return;

      const contact = state.contacts.find(c => c.id === from);
      const callerName = contact ? (contact.nickname || contact.username) : from;
      const callerAvatar = contact?.avatar || null;

      // If callManager is already ringing for this call, just ensure UI is shown
      if (callManager.state === 'ringing' && callManager.callInfo?.callId === call_id) {
        // Already ringing — UI should already be visible
        return;
      }

      // If callManager is idle, restore the ringing state
      if (callManager.state === 'idle') {
        callManager.callInfo = {
          peerId: from,
          name: callerName,
          avatar: callerAvatar,
          isVideo: !!is_video,
          callId: call_id,
          isGroup: false,
        };
        callManager._setState('ringing');
      }
    }

    if (data.type === 'incoming_call_declined') {
      // User declined from the notification — reject the call if we are ringing
      if (callManager.state === 'ringing' && callManager.callInfo?.callId === data.call_id) {
        callManager.rejectCall();
      }
    }
  });
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
    <span><svg viewBox="0 0 24 24" width="16" height="16" fill="#fff" style="vertical-align:middle;margin-right:4px"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg> 本地密钥丢失，无法加密消息</span>
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
      showToast(t('keysRegenerated') || '密钥已生成并上传');
    } catch (e) {
      banner.innerHTML = `<span><svg viewBox="0 0 24 24" width="16" height="16" fill="#fff" style="vertical-align:middle;margin-right:4px"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg> 修复失败: ${e.message}</span>`;
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
function groupIcon() {
  return `<svg viewBox="0 0 24 24"><path d="M12 12.75c1.63 0 3.07.39 4.24.9 1.08.48 1.76 1.56 1.76 2.73V18H6v-1.61c0-1.18.68-2.26 1.76-2.73 1.17-.52 2.61-.91 4.24-.91zM4 13c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm1.13 1.1c-.37-.06-.74-.1-1.13-.1-.99 0-1.93.21-2.78.58C.48 14.9 0 15.62 0 16.43V18h4.5v-1.61c0-.83.23-1.61.63-2.29zM20 13c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm3.78 1.58c-.85-.37-1.79-.58-2.78-.58-.39 0-.76.04-1.13.1.4.68.63 1.46.63 2.29V18H24v-1.57c0-.81-.48-1.53-1.22-1.85zM12 12c1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3 1.34 3 3 3z"/></svg>`;
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
