/**
 * Chats list page — i18n v2
 */
import { state, openChat, avatarEl, formatTime } from '../app.js';
import { t } from '../i18n.js';
import { startScan, scanIconSvg } from '../components/qrUI.js';

// Module-level reference so refreshChatList() can update the list from outside
let _listEl = null;
let _searchEl = null;

export function renderChats(root) {
  root.innerHTML = `
    <div class="topbar">
      <button class="scan-btn" id="chats-scan-btn" title="${t('scan')}">${scanIconSvg()}</button>
      <div class="topbar-title">${t('chatsTitle')}</div>
      <button class="topbar-btn topbar-action" id="new-chat-btn" title="Edit">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
          <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
        </svg>
      </button>
    </div>
    <div class="search-wrap">
      <input class="search-input" id="chats-search" placeholder="${t('searchPlaceholder')}">
    </div>
    <div id="chat-list"></div>
  `;

  _listEl = root.querySelector('#chat-list');
  _searchEl = root.querySelector('#chats-search');

  root.querySelector('#chats-scan-btn').addEventListener('click', startScan);

  renderList(getSorted());

  // Local filter search
  _searchEl.addEventListener('input', () => {
    const q = _searchEl.value.trim().toLowerCase();
    const sorted = getSorted();
    renderList(q ? sorted.filter(c => (c.name || '').toLowerCase().includes(q)) : sorted);
  });
}

/** Sort chats by latest message timestamp descending. */
function getSorted() {
  return [...state.chats].sort((a, b) => (b.lastTs || 0) - (a.lastTs || 0));
}

/**
 * Re-render the chat list in-place.
 * Safe to call from anywhere — no-ops if the chats page isn't mounted.
 */
export function refreshChatList() {
  if (!_listEl || !document.body.contains(_listEl)) return;
  const q = _searchEl?.value.trim().toLowerCase() || '';
  const sorted = getSorted();
  renderList(q ? sorted.filter(c => (c.name || '').toLowerCase().includes(q)) : sorted);
}

function renderList(items) {
  if (!_listEl) return;
  _listEl.innerHTML = '';
  if (!items.length) {
    _listEl.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon"><svg viewBox="0 0 24 24" width="48" height="48" fill="currentColor" opacity=".5"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg></div>
        <div class="empty-title">${t('noChats')}</div>
        <div class="empty-hint">${t('noChatsHint')}</div>
      </div>`;
    return;
  }

  items.forEach(chat => {
    const item = document.createElement('div');
    item.className = 'list-item';

    const av = avatarEl(chat.name, chat.avatar);
    const meta = document.createElement('div');
    meta.className = 'chat-meta';
    meta.innerHTML = `
      <div class="chat-name-row">
        <span class="chat-name">${esc(chat.name)}</span>
        <span class="chat-time">${chat.lastTs ? formatTime(chat.lastTs) : ''}</span>
      </div>
      <div class="chat-preview-row">
        <span class="chat-preview">${esc(chat.lastMsg || t('tapToChat'))}</span>
        ${chat.unread > 0 ? `<span class="badge">${chat.unread > 99 ? '99+' : chat.unread}</span>` : ''}
      </div>`;

    item.appendChild(av);
    item.appendChild(meta);
    item.addEventListener('click', () => { chat.unread = 0; openChat(chat); });
    _listEl.appendChild(item);
  });
}

function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
