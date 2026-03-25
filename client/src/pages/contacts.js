/**
 * Contacts page — friend list, requests, search
 */
import { state, openChat, avatarEl, showToast } from '../app.js';
import { api } from '../api.js';

export function renderContacts(root) {
  root.innerHTML = `
    <div class="topbar">
      <div style="min-width:44px"></div>
      <div class="topbar-title">通讯录</div>
      <button class="topbar-btn topbar-action" id="add-btn">➕</button>
    </div>
    <div class="search-wrap">
      <input class="search-input" id="contact-search" placeholder="搜索用户名">
    </div>
    <div id="contact-list"></div>
    <div id="search-results" class="hidden"></div>
  `;

  const listEl = root.querySelector('#contact-list');
  const resultsEl = root.querySelector('#search-results');
  const searchInput = root.querySelector('#contact-search');

  // ── Friend requests section ───────────────────────────────────
  async function loadRequests() {
    try {
      const reqs = await api.friendRequests();
      if (!reqs.length) return;
      const sec = document.createElement('div');
      sec.innerHTML = `<div class="section-header">好友申请 ${reqs.length ? `<span style="color:var(--red)">(${reqs.length})</span>` : ''}</div>`;
      reqs.forEach(r => {
        const item = document.createElement('div');
        item.className = 'list-item';
        item.appendChild(avatarEl(r.nickname || r.username, r.avatar, 'avatar-sm'));
        item.innerHTML += `
          <div class="flex-1">
            <div style="font-size:15px;font-weight:500">${r.nickname || r.username}</div>
            <div class="text-muted" style="font-size:13px">@${r.username}</div>
          </div>
          <button class="topbar-btn" data-id="${r.id}" style="background:var(--green);color:#fff;border-radius:6px;font-size:13px;padding:6px 12px">接受</button>
        `;
        item.querySelector('button').onclick = async e => {
          e.stopPropagation();
          try {
            await api.acceptFriend(r.id);
            state.contacts = await api.friends();
            showToast('已添加好友');
            item.remove();
          } catch { showToast('操作失败'); }
        };
        sec.appendChild(item);
      });
      listEl.prepend(sec);
    } catch {}
  }

  // ── Friend list ───────────────────────────────────────────────
  function renderFriendList() {
    listEl.innerHTML = '';
    if (!state.contacts.length) {
      listEl.innerHTML = `<div style="text-align:center;padding:60px 20px;color:var(--text-muted)">
        <div style="font-size:48px;margin-bottom:12px">👥</div>
        <div>还没有好友</div>
        <div style="font-size:13px;margin-top:6px">搜索用户名添加好友</div>
      </div>`;
      return;
    }
    const sorted = [...state.contacts].sort((a, b) =>
      (a.nickname || a.username).localeCompare(b.nickname || b.username, 'zh'));

    sorted.forEach(f => {
      const item = document.createElement('div');
      item.className = 'list-item';
      item.appendChild(avatarEl(f.nickname || f.username, f.avatar));
      item.innerHTML += `
        <div class="flex-1">
          <div class="chat-name">${f.nickname || f.username}</div>
          <div class="text-muted" style="font-size:13px">@${f.username} ${f.is_online ? '🟢' : ''}</div>
        </div>`;
      item.onclick = () => openChat({ id: f.id, type: 'private', name: f.nickname || f.username, avatar: f.avatar });
      listEl.appendChild(item);
    });
  }

  // ── Search ────────────────────────────────────────────────────
  let searchTimer;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const q = searchInput.value.trim();
    if (!q) { resultsEl.classList.add('hidden'); listEl.classList.remove('hidden'); return; }
    listEl.classList.add('hidden');
    resultsEl.classList.remove('hidden');
    resultsEl.innerHTML = '<div class="section-header">搜索结果</div>';

    searchTimer = setTimeout(async () => {
      try {
        const users = await api.search(q);
        if (!users.length) { resultsEl.innerHTML += '<div style="text-align:center;padding:20px;color:var(--text-muted)">未找到用户</div>'; return; }
        users.forEach(u => {
          const isFriend = state.contacts.some(c => c.id === u.id);
          const item = document.createElement('div');
          item.className = 'list-item';
          item.appendChild(avatarEl(u.nickname || u.username, u.avatar));
          item.innerHTML += `
            <div class="flex-1">
              <div class="chat-name">${u.nickname || u.username}</div>
              <div class="text-muted" style="font-size:13px">@${u.username}</div>
            </div>
            ${isFriend
              ? `<span style="color:var(--text-muted);font-size:13px">已是好友</span>`
              : `<button class="topbar-btn" data-id="${u.id}" style="background:var(--green);color:#fff;border-radius:6px;font-size:13px;padding:6px 12px">添加</button>`}
          `;
          if (!isFriend) {
            item.querySelector('button').onclick = async e => {
              e.stopPropagation();
              try { await api.sendRequest(u.id); showToast('好友申请已发送'); e.target.textContent = '已发送'; e.target.disabled = true; }
              catch (err) { showToast(err.message); }
            };
          }
          resultsEl.appendChild(item);
        });
      } catch { resultsEl.innerHTML += '<div style="text-align:center;padding:20px;color:var(--text-muted)">搜索失败</div>'; }
    }, 400);
  });

  renderFriendList();
  loadRequests();
}
