/**
 * Contacts page — with tag filtering and tag management
 */
import { state, openChat, avatarEl, showToast } from '../app.js';
import { renderUserProfile } from './userProfile.js';
import { api } from '../api.js';
import { t } from '../i18n.js';
import { openTagManager, openFriendTagPicker } from '../components/tagManager.js';
import { startScan, scanIconSvg } from '../components/qrUI.js';

export function renderContacts(root) {
  root.innerHTML = `
    <div class="topbar">
      <button class="scan-btn" id="contacts-scan-btn" title="${t('scan')}">${scanIconSvg()}</button>
      <div class="topbar-title">${t('contactsTitle')}</div>
      <button class="topbar-btn topbar-action" id="add-btn" title="${t('add')}">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
          <path d="M15 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm-9-2V7H4v3H1v2h3v3h2v-3h3v-2H6zm9 4c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
        </svg>
      </button>
    </div>
    <div class="tag-filter-bar" id="tag-filter-bar"></div>
    <div class="search-wrap">
      <input class="search-input" id="contact-search" placeholder="${t('searchUsers')}">
    </div>
    <div id="contact-list"></div>
    <div id="search-results" class="hidden"></div>
  `;

  const listEl = root.querySelector('#contact-list');
  const resultsEl = root.querySelector('#search-results');
  const searchInput = root.querySelector('#contact-search');
  const filterBar = root.querySelector('#tag-filter-bar');

  root.querySelector('#contacts-scan-btn').addEventListener('click', startScan);

  let activeTagId = null; // null = all
  let tags = [];

  // ── Load tags for filter bar ──────────────────────────────────
  async function loadTags() {
    try {
      tags = await api.tags();
    } catch { tags = []; }
    renderFilterBar();
  }

  function renderFilterBar() {
    filterBar.innerHTML = '';
    // "All" pill
    const allPill = document.createElement('button');
    allPill.className = `tag-pill${activeTagId === null ? ' tag-pill-active' : ''}`;
    allPill.textContent = t('allContacts');
    allPill.onclick = () => { activeTagId = null; renderFilterBar(); renderFriendList(); };
    filterBar.appendChild(allPill);

    // Tag pills
    tags.forEach(tag => {
      const pill = document.createElement('button');
      pill.className = `tag-pill${activeTagId === tag.id ? ' tag-pill-active' : ''}`;
      pill.innerHTML = `<span class="tag-pill-dot" style="background:${tag.color}"></span>${esc(tag.name)}`;
      pill.onclick = () => {
        activeTagId = activeTagId === tag.id ? null : tag.id;
        renderFilterBar();
        renderFriendList();
      };
      filterBar.appendChild(pill);
    });

    // Manage button
    const mgrBtn = document.createElement('button');
    mgrBtn.className = 'tag-pill tag-manage-btn';
    mgrBtn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34a.996.996 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>`;
    mgrBtn.title = t('manageTags');
    mgrBtn.onclick = () => {
      openTagManager(async () => {
        // Refresh tags and contact tags
        await loadTags();
        state.contacts = await api.friends();
        renderFriendList();
      });
    };
    filterBar.appendChild(mgrBtn);
  }

  // ── Friend requests ─────────────────────────────────────────────
  async function loadRequests() {
    try {
      const reqs = await api.friendRequests();
      if (!reqs.length) return;
      const sec = document.createElement('div');
      sec.innerHTML = `
        <div class="section-header">${t('friendRequests')} <span style="color:var(--red)">(${reqs.length})</span></div>`;
      reqs.forEach(r => {
        const item = document.createElement('div');
        item.className = 'list-item';
        item.style.cssText = 'align-items:flex-start;';
        const av = avatarEl(r.nickname || r.username, r.avatar, 'avatar-sm');
        item.appendChild(av);
        const info = document.createElement('div');
        info.className = 'flex-1';
        let msgHtml = '';
        if (r.message) {
          msgHtml = `<div class="friend-req-msg">${esc(r.message)}</div>`;
        }
        info.innerHTML = `
          <div style="font-size:15px;font-weight:500">${esc(r.nickname || r.username)}</div>
          <div class="text-muted" style="font-size:13px">@${esc(r.username)}</div>
          ${msgHtml}`;
        item.appendChild(info);
        const btn = document.createElement('button');
        btn.className = 'btn-pill btn-green';
        btn.textContent = t('accept');
        btn.style.flexShrink = '0';
        btn.onclick = async e => {
          e.stopPropagation();
          try {
            await api.acceptFriend(r.id);
            state.contacts = await api.friends();
            showToast(t('friendAdded'));
            item.remove();
          } catch { showToast(t('opFail')); }
        };
        item.appendChild(btn);
        sec.appendChild(item);
      });
      listEl.prepend(sec);
    } catch {}
  }

  // ── Friend list ─────────────────────────────────────────────────
  function renderFriendList() {
    listEl.innerHTML = '';
    let friends = [...state.contacts];

    // Filter by tag if active
    if (activeTagId !== null) {
      friends = friends.filter(f =>
        f.tags && f.tags.some(t => Number(t.id) === Number(activeTagId))
      );
    }

    if (!friends.length) {
      listEl.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon"><svg viewBox="0 0 24 24" width="48" height="48" fill="currentColor" opacity=".5"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg></div>
          <div class="empty-title">${activeTagId !== null ? t('noResults') : t('noContacts')}</div>
          <div class="empty-hint">${activeTagId !== null ? '' : t('noContactsHint')}</div>
        </div>`;
      return;
    }

    const sorted = friends.sort((a, b) =>
      (a.nickname || a.username).localeCompare(b.nickname || b.username));

    sorted.forEach(f => {
      const item = document.createElement('div');
      item.className = 'list-item';
      const avWrap = document.createElement('div');
      avWrap.className = 'avatar-wrap';
      avWrap.appendChild(avatarEl(f.nickname || f.username, f.avatar));
      if (f.is_online) {
        const dot = document.createElement('div');
        dot.className = 'online-dot';
        avWrap.appendChild(dot);
      }
      item.appendChild(avWrap);

      const info = document.createElement('div');
      info.className = 'flex-1';
      let tagHtml = '';
      if (f.tags && f.tags.length) {
        tagHtml = '<div class="friend-tags">' +
          f.tags.map(t => `<span class="friend-tag-badge" style="background:${t.color}20;color:${t.color}">${esc(t.name)}</span>`).join('') +
          '</div>';
      }
      info.innerHTML = `
        <div style="font-size:16px;font-weight:500">${esc(f.nickname || f.username)}</div>
        <div class="text-muted" style="font-size:13px">@${esc(f.username)}${f.is_online ? ` · <span style="color:var(--green)">${t('online')}</span>` : ''}</div>
        ${tagHtml}`;
      item.appendChild(info);

      // Tag button
      const tagBtn = document.createElement('button');
      tagBtn.className = 'friend-tag-btn icon-btn';
      tagBtn.title = t('setTags');
      tagBtn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" opacity=".5">
        <path d="M21.41 11.58l-9-9C12.05 2.22 11.55 2 11 2H4c-1.1 0-2 .9-2 2v7c0 .55.22 1.05.59 1.42l9 9c.36.36.86.58 1.41.58.55 0 1.05-.22 1.41-.59l7-7c.37-.36.59-.86.59-1.41 0-.55-.23-1.06-.59-1.42zM5.5 7C4.67 7 4 6.33 4 5.5S4.67 4 5.5 4 7 4.67 7 5.5 6.33 7 5.5 7z"/>
      </svg>`;
      tagBtn.onclick = (e) => {
        e.stopPropagation();
        openFriendTagPicker(f, async () => {
          state.contacts = await api.friends();
          await loadTags();
          renderFriendList();
        });
      };
      item.appendChild(tagBtn);

      item.onclick = () => {
        const appEl = document.getElementById('app');
        const page = document.createElement('div');
        page.className = 'page';
        renderUserProfile(page, f);
        appEl.innerHTML = '';
        appEl.appendChild(page);
      };
      listEl.appendChild(item);
    });
  }

  // ── Search ───────────────────────────────────────────────────────
  let searchTimer;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const q = searchInput.value.trim();
    if (!q) {
      resultsEl.classList.add('hidden');
      listEl.classList.remove('hidden');
      filterBar.style.display = '';
      return;
    }
    listEl.classList.add('hidden');
    filterBar.style.display = 'none';
    resultsEl.classList.remove('hidden');
    resultsEl.innerHTML = `<div class="section-header">${t('searchUsers')}</div>`;

    searchTimer = setTimeout(async () => {
      try {
        const users = await api.search(q);
        if (!users.length) {
          resultsEl.innerHTML += `<div class="empty-state" style="padding:32px"><div class="empty-icon" style="font-size:36px"><svg viewBox="0 0 24 24" width="36" height="36" fill="currentColor" opacity=".5"><path d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg></div><div class="empty-hint">${t('noResults')}</div></div>`;
          return;
        }
        users.forEach(u => {
          const isFriend = state.contacts.some(c => c.id === u.id);
          const item = document.createElement('div');
          item.className = 'list-item';
          item.appendChild(avatarEl(u.nickname || u.username, u.avatar));
          const info = document.createElement('div');
          info.className = 'flex-1';
          info.innerHTML = `
            <div style="font-size:16px;font-weight:500">${esc(u.nickname || u.username)}</div>
            <div class="text-muted" style="font-size:13px">@${esc(u.username)}</div>`;
          item.appendChild(info);
          if (isFriend) {
            const tag = document.createElement('span');
            tag.className = 'text-muted';
            tag.style.fontSize = '13px';
            tag.textContent = t('alreadyFriend');
            item.appendChild(tag);
          } else {
            const btn = document.createElement('button');
            btn.className = 'btn-pill btn-green';
            btn.textContent = t('add');
            btn.onclick = e => {
              e.stopPropagation();
              showFriendRequestModal(u, btn);
            };
            item.appendChild(btn);
          }
          resultsEl.appendChild(item);
        });
      } catch { resultsEl.innerHTML += `<div class="empty-state" style="padding:32px"><div class="empty-hint">${t('searchFailed')}</div></div>`; }
    }, 380);
  });

  renderFriendList();
  loadRequests();
  loadTags();
}

function showFriendRequestModal(user, addBtn) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-card" style="width:88%;max-width:380px;">
      <div class="modal-header">
        <div style="min-width:44px"></div>
        <div class="topbar-title" style="font-size:16px">${t('friendRequestTitle')}</div>
        <div style="min-width:44px"></div>
      </div>
      <div style="padding:16px;">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;">
          <div style="font-size:15px;font-weight:500">${esc(user.nickname || user.username)}</div>
          <div class="text-muted" style="font-size:13px">@${esc(user.username)}</div>
        </div>
        <textarea id="fr-message" rows="4" maxlength="512"
          placeholder="${t('friendRequestPlaceholder')}"
          style="width:100%;box-sizing:border-box;border-radius:10px;border:1px solid var(--border);padding:10px 12px;font-size:14px;resize:none;background:var(--surface-2);color:var(--text);font-family:inherit;"></textarea>
        <div style="text-align:right;margin-top:4px;">
          <span id="fr-counter" class="text-muted" style="font-size:12px;">0/512</span>
        </div>
        <div style="display:flex;gap:10px;margin-top:14px;">
          <button id="fr-cancel" class="btn-pill btn-outline" style="flex:1">${t('cancel')}</button>
          <button id="fr-send" class="btn-pill btn-green" style="flex:1">${t('sendRequest')}</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };

  const textarea = overlay.querySelector('#fr-message');
  const counter = overlay.querySelector('#fr-counter');
  const cancelBtn = overlay.querySelector('#fr-cancel');
  const sendBtn = overlay.querySelector('#fr-send');

  textarea.addEventListener('input', () => {
    counter.textContent = `${textarea.value.length}/512`;
  });
  textarea.focus();

  cancelBtn.onclick = () => overlay.remove();
  sendBtn.onclick = async () => {
    sendBtn.disabled = true;
    sendBtn.textContent = '...';
    try {
      await api.sendRequest(user.id, textarea.value.trim());
      showToast(t('requestSent'));
      addBtn.textContent = t('sent');
      addBtn.disabled = true;
      addBtn.className = 'btn-pill btn-outline';
      overlay.remove();
    } catch (err) {
      showToast(err.message);
      sendBtn.disabled = false;
      sendBtn.textContent = t('sendRequest');
    }
  };
}

function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
