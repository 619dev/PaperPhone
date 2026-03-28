/**
 * Tag Manager Component — Modal for creating/editing/deleting tags
 * Also used for assigning tags to friends
 */
import { api } from '../api.js';
import { showToast, avatarEl } from '../app.js';
import { t } from '../i18n.js';

const TAG_COLORS = [
  '#2196F3', '#E91E63', '#9C27B0', '#FF5722',
  '#009688', '#FF9800', '#795548', '#607D8B',
  '#4CAF50', '#00BCD4', '#3F51B5', '#F44336',
];

/**
 * Open full tag manager modal
 * @param {Function} onClose — callback when modal closes (tags may have changed)
 */
export function openTagManager(onClose) {
  const modal = document.createElement('div');
  modal.className = 'tag-manager-overlay';

  const sheet = document.createElement('div');
  sheet.className = 'tag-manager-sheet';

  sheet.innerHTML = `
    <div class="tm-header">
      <button class="tm-close-btn" id="tm-close">${t('cancel')}</button>
      <span class="tm-title">${t('manageTags')}</span>
      <button class="tm-add-btn" id="tm-add">${t('newTag')}</button>
    </div>
    <div class="tm-list" id="tm-list"></div>
  `;

  modal.appendChild(sheet);
  document.body.appendChild(modal);
  requestAnimationFrame(() => sheet.classList.add('tm-sheet-open'));

  const listEl = sheet.querySelector('#tm-list');

  async function loadTags() {
    try {
      const tags = await api.tags();
      renderTagList(tags);
    } catch { showToast(t('opFailed') || 'Failed'); }
  }

  function renderTagList(tags) {
    listEl.innerHTML = '';
    if (!tags.length) {
      listEl.innerHTML = `<div class="tm-empty">${t('noTags')}</div>`;
      return;
    }
    tags.forEach(tag => {
      const row = document.createElement('div');
      row.className = 'tm-row';
      row.innerHTML = `
        <div class="tm-color-dot" style="background:${tag.color}"></div>
        <div class="tm-row-info">
          <div class="tm-row-name">${esc(tag.name)}</div>
          <div class="tm-row-count">${tag.friend_count} ${t('nMembers') || ''}</div>
        </div>
        <div class="tm-row-actions">
          <button class="tm-edit-btn icon-btn" title="${t('editTag')}">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34a.996.996 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
          </button>
          <button class="tm-del-btn icon-btn" title="${t('deleteTag')}">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
          </button>
        </div>
      `;
      row.querySelector('.tm-edit-btn').onclick = () => openTagEdit(tag, loadTags);
      row.querySelector('.tm-del-btn').onclick = async () => {
        if (!confirm(t('tagDelConfirm'))) return;
        try {
          await api.deleteTag(tag.id);
          showToast(t('tagDeleted'));
          loadTags();
        } catch { showToast(t('opFailed') || 'Failed'); }
      };
      listEl.appendChild(row);
    });
  }

  // Add tag
  sheet.querySelector('#tm-add').onclick = () => openTagEdit(null, loadTags);

  // Close
  const dismiss = () => {
    sheet.classList.remove('tm-sheet-open');
    setTimeout(() => { modal.remove(); if (onClose) onClose(); }, 280);
  };
  sheet.querySelector('#tm-close').onclick = dismiss;
  modal.addEventListener('click', e => { if (e.target === modal) dismiss(); });

  loadTags();
}

/**
 * Open tag create/edit inline form
 */
function openTagEdit(existingTag, onSave) {
  const modal = document.createElement('div');
  modal.className = 'tag-edit-overlay';

  const card = document.createElement('div');
  card.className = 'tag-edit-card';

  const isEdit = !!existingTag;
  let selectedColor = existingTag?.color || TAG_COLORS[0];

  card.innerHTML = `
    <div class="te-title">${isEdit ? t('editTag') : t('newTag')}</div>
    <input class="te-name-input" id="te-name" maxlength="32"
      placeholder="${t('tagNamePlaceholder')}" value="${isEdit ? esc(existingTag.name) : ''}">
    <div class="te-color-label">${t('tagColor')}</div>
    <div class="te-color-grid" id="te-colors"></div>
    <div class="te-actions">
      <button class="te-cancel" id="te-cancel">${t('cancel')}</button>
      <button class="te-save" id="te-save">${t('confirm')}</button>
    </div>
  `;

  modal.appendChild(card);
  document.body.appendChild(modal);

  const colorsEl = card.querySelector('#te-colors');
  TAG_COLORS.forEach(c => {
    const dot = document.createElement('div');
    dot.className = `te-color-opt${c === selectedColor ? ' te-color-active' : ''}`;
    dot.style.background = c;
    dot.onclick = () => {
      selectedColor = c;
      colorsEl.querySelectorAll('.te-color-opt').forEach(d => d.classList.remove('te-color-active'));
      dot.classList.add('te-color-active');
    };
    colorsEl.appendChild(dot);
  });

  card.querySelector('#te-cancel').onclick = () => modal.remove();
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });

  card.querySelector('#te-save').onclick = async () => {
    const name = card.querySelector('#te-name').value.trim();
    if (!name) return;
    try {
      if (isEdit) {
        await api.updateTag(existingTag.id, { name, color: selectedColor });
        showToast(t('tagUpdated'));
      } else {
        await api.createTag({ name, color: selectedColor });
        showToast(t('tagCreated'));
      }
      modal.remove();
      onSave();
    } catch (err) {
      if (err.message.includes('409') || err.message.includes('exists')) {
        showToast(t('tagExists'));
      } else {
        showToast(t('opFailed') || 'Failed');
      }
    }
  };
}

/**
 * Open friend tag picker — let user assign/unassign tags for a friend
 * @param {Object} friend — { id, nickname, username, avatar, tags: [] }
 * @param {Function} onDone — callback when done
 */
export async function openFriendTagPicker(friend, onDone) {
  const modal = document.createElement('div');
  modal.className = 'tag-picker-overlay';

  const card = document.createElement('div');
  card.className = 'tag-picker-card';

  card.innerHTML = `
    <div class="tp-header">
      <div class="tp-title">${t('setTags')}</div>
      <div class="tp-friend-name">${esc(friend.nickname || friend.username)}</div>
    </div>
    <div class="tp-list" id="tp-list">
      <div class="tm-empty" style="padding:24px"><div class="spinner"></div></div>
    </div>
    <div class="tp-footer">
      <button class="te-cancel" id="tp-cancel">${t('cancel')}</button>
      <button class="te-save" id="tp-save">${t('confirm')}</button>
    </div>
  `;

  modal.appendChild(card);
  document.body.appendChild(modal);

  const listEl = card.querySelector('#tp-list');
  const friendTagIds = new Set((friend.tags || []).map(t => Number(t.id)));
  let allTags = [];

  try {
    allTags = await api.tags();
  } catch { showToast(t('opFailed') || 'Failed'); }

  if (!allTags.length) {
    listEl.innerHTML = `<div class="tm-empty">${t('noTags')}<br><small style="opacity:.6">${t('manageTags')}</small></div>`;
  } else {
    listEl.innerHTML = '';
    allTags.forEach(tag => {
      const row = document.createElement('label');
      row.className = 'tp-row';
      const checked = friendTagIds.has(Number(tag.id));
      row.innerHTML = `
        <div class="tm-color-dot" style="background:${tag.color}"></div>
        <span class="tp-row-name">${esc(tag.name)}</span>
        <input type="checkbox" class="tp-checkbox" data-tag-id="${tag.id}" ${checked ? 'checked' : ''}>
        <span class="tp-check-mark"></span>
      `;
      listEl.appendChild(row);
    });
  }

  card.querySelector('#tp-cancel').onclick = () => modal.remove();
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });

  card.querySelector('#tp-save').onclick = async () => {
    const checks = listEl.querySelectorAll('.tp-checkbox');
    const newTagIds = new Set();
    checks.forEach(cb => { if (cb.checked) newTagIds.add(Number(cb.dataset.tagId)); });

    try {
      // Add to new tags
      for (const tagId of newTagIds) {
        if (!friendTagIds.has(tagId)) {
          await api.tagFriends(tagId, { friend_ids: [friend.id] });
        }
      }
      // Remove from unchecked tags
      for (const tagId of friendTagIds) {
        if (!newTagIds.has(tagId)) {
          await api.untagFriend(tagId, friend.id);
        }
      }
      modal.remove();
      if (onDone) onDone();
    } catch { showToast(t('opFailed') || 'Failed'); }
  };
}

/**
 * Open visibility picker for moment compose
 * @param {Object} currentSettings - { visibility, visible_tags, visible_users, invisible_tags, invisible_users }
 * @param {Array} contacts - friend list
 * @param {Function} onDone - callback with new settings
 */
export async function openVisibilityPicker(currentSettings, contacts, onDone) {
  const modal = document.createElement('div');
  modal.className = 'vis-picker-overlay';

  const sheet = document.createElement('div');
  sheet.className = 'vis-picker-sheet';

  let mode = currentSettings.visibility || 'public';
  let selectedTagIds = new Set(currentSettings.visible_tags || currentSettings.invisible_tags || []);
  let selectedUserIds = new Set(currentSettings.visible_users || currentSettings.invisible_users || []);
  let allTags = [];

  try { allTags = await api.tags(); } catch {}

  function render() {
    sheet.innerHTML = `
      <div class="vp-header">
        <button class="tm-close-btn" id="vp-close">${t('cancel')}</button>
        <span class="tm-title">${t('whoCanSee')}</span>
        <button class="tm-add-btn" id="vp-done">${t('confirm')}</button>
      </div>
      <div class="vp-modes" id="vp-modes"></div>
      <div class="vp-select-area" id="vp-select" style="display:${mode === 'public' ? 'none' : ''}"></div>
    `;

    const modesEl = sheet.querySelector('#vp-modes');
    const selectArea = sheet.querySelector('#vp-select');

    // Mode buttons
    const modes = [
      { id: 'public', icon: '🌍', label: t('visibilityPublic'), desc: t('visibilityPublicDesc') },
      { id: 'whitelist', icon: '👁', label: t('visibilityWhitelist'), desc: t('visibilityWhitelistDesc') },
      { id: 'blacklist', icon: '🚫', label: t('visibilityBlacklist'), desc: t('visibilityBlacklistDesc') },
    ];
    modes.forEach(m => {
      const btn = document.createElement('div');
      btn.className = `vp-mode-btn${mode === m.id ? ' vp-mode-active' : ''}`;
      btn.innerHTML = `
        <div class="vp-mode-icon">${m.icon}</div>
        <div class="vp-mode-info">
          <div class="vp-mode-label">${m.label}</div>
          <div class="vp-mode-desc">${m.desc}</div>
        </div>
        <div class="vp-mode-check">${mode === m.id ? '<svg viewBox="0 0 24 24" width="20" height="20" fill="var(--accent)"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>' : ''}</div>
      `;
      btn.onclick = () => {
        mode = m.id;
        if (mode === 'public') {
          selectedTagIds.clear();
          selectedUserIds.clear();
        }
        render();
      };
      modesEl.appendChild(btn);
    });

    // Selection area (for whitelist/blacklist)
    if (mode !== 'public') {
      // Tags section
      if (allTags.length) {
        const tagSec = document.createElement('div');
        tagSec.className = 'vp-section';
        tagSec.innerHTML = `<div class="vp-section-title">${t('selectTags')}</div>`;
        allTags.forEach(tag => {
          const row = document.createElement('label');
          row.className = 'vp-select-row';
          row.innerHTML = `
            <div class="tm-color-dot" style="background:${tag.color}"></div>
            <span class="vp-row-name">${esc(tag.name)}</span>
            <span class="vp-row-count">${tag.friend_count}</span>
            <input type="checkbox" class="tp-checkbox" data-type="tag" data-id="${tag.id}" ${selectedTagIds.has(Number(tag.id)) ? 'checked' : ''}>
            <span class="tp-check-mark"></span>
          `;
          row.querySelector('.tp-checkbox').onchange = (e) => {
            if (e.target.checked) selectedTagIds.add(Number(tag.id));
            else selectedTagIds.delete(Number(tag.id));
          };
          tagSec.appendChild(row);
        });
        selectArea.appendChild(tagSec);
      }

      // Friends section
      const friendSec = document.createElement('div');
      friendSec.className = 'vp-section';
      friendSec.innerHTML = `<div class="vp-section-title">${t('selectFriends')}</div>`;
      contacts.forEach(f => {
        const row = document.createElement('label');
        row.className = 'vp-select-row';
        const av = avatarEl(f.nickname || f.username, f.avatar, 'vp-avatar');
        row.appendChild(av);
        const nameSpan = document.createElement('span');
        nameSpan.className = 'vp-row-name';
        nameSpan.textContent = f.nickname || f.username;
        row.appendChild(nameSpan);
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.className = 'tp-checkbox';
        cb.dataset.type = 'user';
        cb.dataset.id = f.id;
        cb.checked = selectedUserIds.has(f.id);
        cb.onchange = () => {
          if (cb.checked) selectedUserIds.add(f.id);
          else selectedUserIds.delete(f.id);
        };
        row.appendChild(cb);
        const mark = document.createElement('span');
        mark.className = 'tp-check-mark';
        row.appendChild(mark);
        friendSec.appendChild(row);
      });
      selectArea.appendChild(friendSec);
    }

    // Actions
    sheet.querySelector('#vp-close').onclick = () => dismiss();
    sheet.querySelector('#vp-done').onclick = () => {
      const result = { visibility: mode };
      if (mode === 'whitelist') {
        result.visible_tags = [...selectedTagIds];
        result.visible_users = [...selectedUserIds];
      } else if (mode === 'blacklist') {
        result.invisible_tags = [...selectedTagIds];
        result.invisible_users = [...selectedUserIds];
      }
      dismiss();
      if (onDone) onDone(result);
    };
  }

  modal.appendChild(sheet);
  document.body.appendChild(modal);
  requestAnimationFrame(() => sheet.classList.add('vis-sheet-open'));

  const dismiss = () => {
    sheet.classList.remove('vis-sheet-open');
    setTimeout(() => modal.remove(), 280);
  };
  modal.addEventListener('click', e => { if (e.target === modal) dismiss(); });

  render();
}

function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
