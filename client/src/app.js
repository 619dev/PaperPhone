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

// ── Global State ──────────────────────────────────────────────────────────
export const state = {
  user: null,
  chats: [],          // [{ id, type, name, avatar, lastMsg, lastTs, unread }]
  sessions: {},       // userId/groupId -> ratchet state
  contacts: [],
  activeTab: 'chats',
  chatView: null,     // { id, type } or null
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
  if (diff < 60e3) return '刚刚';
  if (diff < 3600e3) return `${Math.floor(diff / 60e3)}分钟前`;
  if (d.toDateString() === now.toDateString()) return d.toTimeString().slice(0, 5);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

// ── Tab Bar ───────────────────────────────────────────────────────────────
function buildTabBar(active) {
  const tabs = [
    { id: 'chats',    label: '微信',  icon: chatIcon() },
    { id: 'contacts', label: '通讯录', icon: contactIcon() },
    { id: 'discover', label: '发现',  icon: discoverIcon() },
    { id: 'me',       label: '我',   icon: meIcon() },
  ];
  const bar = document.createElement('nav');
  bar.className = 'tabbar';
  tabs.forEach(tab => {
    const item = document.createElement('div');
    item.className = `tab-item ${tab.id === active ? 'active' : ''}`;
    item.id = `tab-${tab.id}`;
    item.innerHTML = `
      <div class="tab-icon-wrap">
        ${tab.icon}
        ${tab.id === 'chats' && state.chats.some(c => c.unread > 0)
          ? `<div class="tab-dot">${state.chats.reduce((n, c) => n + (c.unread || 0), 0)}</div>` : ''}
      </div>
      <span>${tab.label}</span>`;
    item.addEventListener('click', () => navigateTo(tab.id));
    bar.appendChild(item);
  });
  return bar;
}

// ── Navigation ────────────────────────────────────────────────────────────
export function navigateTo(tab, data) {
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
  state.chatView = null;
  render();
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
      chat.lastMsg = '🔒 加密消息';
      chat.lastTs = msg.ts;
      // re-render tab dot
      const tabBar = root.querySelector('.tabbar');
      if (tabBar) root.replaceChild(buildTabBar(state.activeTab), tabBar);
    } else if (!chat) {
      // New conversation appeared
      state.chats.unshift({ id: key, type: msg.group_id ? 'group' : 'private',
        name: msg.from, avatar: null, lastMsg: '🔒 加密消息', lastTs: msg.ts, unread: 1 });
    }
  });
  onEvent('friend_request', () => showToast('收到新的好友请求'));
  onEvent('friend_accepted', () => { showToast('好友请求已接受'); });
}

// ── Bootstrap ─────────────────────────────────────────────────────────────
async function init() {
  if (!getToken()) { render(); return; }

  try {
    state.user = await api.me();
    connect();
    setupGlobalSocketHandlers();

    // Load friends & groups for chat list
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
    // Token expired
    localStorage.removeItem('pp_token');
  }
  render();
}

init();

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
