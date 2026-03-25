/**
 * Chats list page
 */
import { state, openChat, avatarEl, formatTime } from '../app.js';

export function renderChats(root) {
  // Top bar
  root.innerHTML = `
    <div class="topbar">
      <div style="min-width:44px"></div>
      <div class="topbar-title">微信</div>
      <button class="topbar-btn topbar-action" id="new-chat-btn" title="新建">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
          <path d="M19 3H5c-1.1 0-2 .9-2 2v14l4-4h12c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm1 10H6.83L5 14.83V5h15v8z"/>
        </svg>
      </button>
    </div>
    <div class="search-wrap">
      <input class="search-input" placeholder="搜索">
    </div>
    <div id="chat-list"></div>
  `;

  const listEl = root.querySelector('#chat-list');
  const chats = state.chats.sort((a, b) => (b.lastTs || 0) - (a.lastTs || 0));

  if (!chats.length) {
    listEl.innerHTML = `
      <div style="text-align:center;padding:60px 20px;color:var(--text-muted)">
        <div style="font-size:48px;margin-bottom:12px">💬</div>
        <div>暂无会话</div>
        <div style="font-size:13px;margin-top:6px">去通讯录找朋友开始聊天吧</div>
      </div>`;
    return;
  }

  chats.forEach(chat => {
    const item = document.createElement('div');
    item.className = 'list-item';

    const av = avatarEl(chat.name, chat.avatar);
    const meta = document.createElement('div');
    meta.className = 'chat-meta';
    meta.innerHTML = `
      <div class="chat-row">
        <span class="chat-name">${escHtml(chat.name)}</span>
        <span class="chat-time">${chat.lastTs ? formatTime(chat.lastTs) : ''}</span>
      </div>
      <div class="chat-row">
        <span class="chat-preview">${escHtml(chat.lastMsg || '点击开始聊天')}</span>
        ${chat.unread > 0 ? `<span class="badge">${chat.unread > 99 ? '99+' : chat.unread}</span>` : ''}
      </div>`;

    item.appendChild(av);
    item.appendChild(meta);
    item.addEventListener('click', () => {
      chat.unread = 0;
      openChat(chat);
    });
    listEl.appendChild(item);
  });
}

function escHtml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
