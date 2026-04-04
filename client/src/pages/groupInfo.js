/**
 * Group Info page — view members, manage group
 */
import { state, avatarEl, showToast, goBack, navigateTo } from '../app.js';
import { api } from '../api.js';
import { t } from '../i18n.js';
import { uploadFileWithRing } from '../uploadProgress.js';
import { refreshGroupList, } from './groups.js';
import { refreshChatList } from './chats.js';
import { showGroupQRCode, qrCodeIconSvg } from '../components/qrUI.js';

const esc = s => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

export async function renderGroupInfo(root, groupId) {
  root.innerHTML = '';
  root.style.cssText = 'display:flex;flex-direction:column;height:100dvh;';

  // Top bar
  const topbar = document.createElement('div');
  topbar.className = 'topbar';
  topbar.innerHTML = `
    <button class="topbar-btn topbar-back" id="gi-back">
      <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
        <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/>
      </svg>
    </button>
    <div class="topbar-title">${t('groupInfo')}</div>
    <div style="min-width:44px"></div>
  `;
  root.appendChild(topbar);
  topbar.querySelector('#gi-back').onclick = goBack;

  const content = document.createElement('div');
  content.className = 'page-scroll';
  content.style.cssText = 'flex:1;overflow-y:auto;padding-bottom:env(safe-area-inset-bottom, 16px);';
  content.innerHTML = `<div style="padding:40px 0;text-align:center;" class="text-muted">...</div>`;
  root.appendChild(content);

  // Load group info
  let info;
  try {
    info = await api.groupInfo(groupId);
  } catch (err) {
    content.innerHTML = `<div style="padding:40px 0;text-align:center;" class="text-muted">${esc(err.message)}</div>`;
    return;
  }

  const isOwner = info.owner_id === state.user.id;
  const myRole = info.members.find(m => m.id === state.user.id)?.role || 'member';
  const isAdmin = myRole === 'owner' || myRole === 'admin';

  content.innerHTML = '';

  // ── Group header card ──
  const header = document.createElement('div');
  header.className = 'group-info-header';
  header.style.cssText = 'display:flex;flex-direction:column;align-items:center;padding:24px 16px 16px;';

  // Avatar — owner can click to change
  const avWrap = document.createElement('div');
  avWrap.style.cssText = 'position:relative;cursor:' + (isOwner ? 'pointer' : 'default') + ';';

  const av = avatarEl(info.name, info.avatar, 'avatar-lg');
  av.style.cssText = 'width:72px;height:72px;font-size:28px;border-radius:20px;margin-bottom:12px;';
  av.id = 'gi-avatar-img';
  avWrap.appendChild(av);

  if (isOwner) {
    // Camera badge overlay
    const badge = document.createElement('div');
    badge.className = 'avatar-camera-badge';
    badge.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="#fff"><path d="M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4z"/><path d="M9 2L7.17 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2h-3.17L15 2H9zm3 15c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5z"/></svg>`;
    avWrap.appendChild(badge);

    // Hidden file input
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.className = 'hidden';
    fileInput.id = 'gi-avatar-file';
    avWrap.appendChild(fileInput);

    avWrap.onclick = () => fileInput.click();
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files[0];
      if (!file) return;
      try {
        const { url } = await uploadFileWithRing(api, file, t('uploading'));
        await api.updateGroup(groupId, { avatar: url });
        info.avatar = url;
        // Update local state
        const groupEntry = (state.groupsList || []).find(g => g.id === groupId);
        if (groupEntry) groupEntry.avatar = url;
        const chatEntry = state.chats.find(c => c.id === groupId);
        if (chatEntry) chatEntry.avatar = url;
        refreshGroupList();
        refreshChatList();
        // Replace avatar in the header
        const oldAvEl = avWrap.querySelector('#gi-avatar-img');
        const newAv = avatarEl(info.name, url, 'avatar-lg');
        newAv.style.cssText = 'width:72px;height:72px;font-size:28px;border-radius:20px;margin-bottom:12px;';
        newAv.id = 'gi-avatar-img';
        avWrap.replaceChild(newAv, oldAvEl);
        showToast(t('groupAvatarUpdated'));
      } catch { showToast(t('groupAvatarFailed')); }
      fileInput.value = '';
    });
  }

  header.appendChild(avWrap);

  const nameEl = document.createElement('div');
  nameEl.id = 'gi-group-name';
  nameEl.style.cssText = 'font-size:20px;font-weight:600;margin-bottom:4px;';
  nameEl.textContent = info.name;
  header.appendChild(nameEl);

  const countEl = document.createElement('div');
  countEl.className = 'text-muted';
  countEl.style.fontSize = '14px';
  countEl.textContent = `${info.member_count} ${t('nMembers')}`;
  header.appendChild(countEl);
  content.appendChild(header);

  // ── Owner Settings (change name / avatar) ──
  if (isOwner) {
    const ownerSection = document.createElement('div');
    ownerSection.className = 'settings-section';

    // Change avatar row
    const avatarRow = document.createElement('div');
    avatarRow.className = 'list-item';
    avatarRow.style.cursor = 'pointer';
    avatarRow.innerHTML = `
      <div style="flex:1;display:flex;align-items:center;gap:10px;">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="var(--text-muted)">
          <path d="M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4z"/>
          <path d="M9 2L7.17 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2h-3.17L15 2H9zm3 15c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5z"/>
        </svg>
        <span style="font-size:15px;font-weight:500;">${t('changeGroupAvatar')}</span>
      </div>
      <span style="color:var(--text-muted);font-size:16px;">›</span>
    `;
    avatarRow.onclick = () => {
      const fi = avWrap.querySelector('#gi-avatar-file');
      if (fi) fi.click();
    };
    ownerSection.appendChild(avatarRow);

    // Change name row
    const nameRow = document.createElement('div');
    nameRow.className = 'list-item';
    nameRow.style.cursor = 'pointer';
    nameRow.innerHTML = `
      <div style="flex:1;display:flex;align-items:center;gap:10px;">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="var(--text-muted)">
          <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34a.996.996 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
        </svg>
        <span style="font-size:15px;font-weight:500;">${t('changeGroupName')}</span>
      </div>
      <span id="gi-cur-name" class="text-muted" style="font-size:14px;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(info.name)}</span>
      <span style="color:var(--text-muted);font-size:16px;margin-left:4px;">›</span>
    `;
    nameRow.onclick = async () => {
      const newName = prompt(t('groupNamePrompt'), info.name);
      if (newName && newName.trim() && newName.trim() !== info.name) {
        try {
          await api.updateGroup(groupId, { name: newName.trim() });
          info.name = newName.trim();
          // Update local state
          const groupEntry = (state.groupsList || []).find(g => g.id === groupId);
          if (groupEntry) groupEntry.name = newName.trim();
          const chatEntry = state.chats.find(c => c.id === groupId);
          if (chatEntry) chatEntry.name = newName.trim();
          refreshGroupList();
          refreshChatList();
          // Update UI
          nameEl.textContent = newName.trim();
          const curNameEl = nameRow.querySelector('#gi-cur-name');
          if (curNameEl) curNameEl.textContent = newName.trim();
          showToast(t('groupNameUpdated'));
        } catch { showToast(t('groupUpdateFailed')); }
      }
    };
    ownerSection.appendChild(nameRow);

    content.appendChild(ownerSection);
  }

  // ── Group QR Code ──
  const qrSection = document.createElement('div');
  qrSection.className = 'settings-section';
  const qrRow = document.createElement('div');
  qrRow.className = 'list-item';
  qrRow.style.cursor = 'pointer';
  qrRow.innerHTML = `
    <div style="flex:1;display:flex;align-items:center;gap:10px;">
      <div class="settings-icon" style="background:#007AFF;width:28px;height:28px;border-radius:8px;">${qrCodeIconSvg()}</div>
      <span style="font-size:15px;font-weight:500;">${t('groupQRCode')}</span>
    </div>
    <span style="color:var(--text-muted);font-size:16px;">›</span>
  `;
  qrRow.onclick = () => showGroupQRCode(groupId, info.name, info.avatar, isAdmin);
  qrSection.appendChild(qrRow);
  content.appendChild(qrSection);

  // ── Notice ──
  const noticeSection = document.createElement('div');
  noticeSection.className = 'settings-section';
  noticeSection.innerHTML = `
    <div class="section-header">${t('groupNotice')}</div>
    <div class="list-item" style="padding:12px 16px;">
      <span class="text-muted" style="font-size:14px;white-space:pre-wrap;">${esc(info.notice || t('groupNoNotice'))}</span>
    </div>
  `;
  content.appendChild(noticeSection);

  // ── Mute (Do Not Disturb) Toggle ──
  const myGroupEntry = (state.groupsList || []).find(g => g.id === groupId);
  let isMuted = !!myGroupEntry?.muted;

  const muteSection = document.createElement('div');
  muteSection.className = 'settings-section';
  const muteRow = document.createElement('div');
  muteRow.className = 'list-item';
  muteRow.style.cssText = 'cursor:pointer;';
  muteRow.innerHTML = `
    <div style="flex:1;display:flex;align-items:center;gap:10px;">
      <svg viewBox="0 0 24 24" width="20" height="20" fill="var(--text-muted)">
        <path d="M12 22c1.1 0 2-.9 2-2h-4a2 2 0 0 0 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z"/>
      </svg>
      <span style="font-size:15px;font-weight:500;">${t('muteGroup')}</span>
    </div>
    <div class="mute-toggle ${isMuted ? 'mute-toggle-on' : ''}" id="mute-toggle">
      <div class="mute-toggle-knob"></div>
    </div>
  `;
  muteRow.onclick = async () => {
    const newVal = !isMuted;
    const toggle = muteRow.querySelector('#mute-toggle');
    toggle.classList.toggle('mute-toggle-on', newVal);
    try {
      await api.muteGroup(groupId, newVal);
      isMuted = newVal;
      // Update local state
      if (myGroupEntry) myGroupEntry.muted = newVal ? 1 : 0;
      const chatEntry = state.chats.find(c => c.id === groupId);
      if (chatEntry) chatEntry.muted = newVal;
      showToast(newVal ? t('muteEnabled') : t('muteDisabled'));
    } catch (err) {
      toggle.classList.toggle('mute-toggle-on', !newVal);
      showToast(err.message);
    }
  };
  muteSection.appendChild(muteRow);
  content.appendChild(muteSection);

  // ── Auto-Delete Setting ──
  const autoDeleteLabels = {
    0: t('autoDeleteNever'), 86400: t('autoDelete1d'),
    259200: t('autoDelete3d'), 604800: t('autoDelete7d'),
    2592000: t('autoDelete30d'),
  };
  const groupAutoDelete = info.auto_delete ?? 604800;

  const adSection = document.createElement('div');
  adSection.className = 'settings-section';
  const adRow = document.createElement('div');
  adRow.className = 'list-item';
  adRow.style.cssText = isOwner ? 'cursor:pointer;' : '';
  adRow.innerHTML = `
    <div style="flex:1;display:flex;align-items:center;gap:10px;">
      <svg viewBox="0 0 24 24" width="20" height="20" fill="var(--text-muted)">
        <path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z"/>
      </svg>
      <span style="font-size:15px;font-weight:500;">${t('autoDeleteTitle')}</span>
    </div>
    <span id="ad-value" class="text-muted" style="font-size:14px;">${autoDeleteLabels[groupAutoDelete] || autoDeleteLabels[604800]}</span>
  `;
  if (isOwner) {
    adRow.onclick = () => {
      showGroupAutoDeletePicker(groupAutoDelete, async (val) => {
        try {
          await api.setGroupAutoDelete(groupId, val);
          adRow.querySelector('#ad-value').textContent = autoDeleteLabels[val];
          showToast(t('autoDeleteUpdated'));
        } catch (err) { showToast(err.message); }
      });
    };
  }
  adSection.appendChild(adRow);
  if (!isOwner) {
    const hint = document.createElement('div');
    hint.style.cssText = 'padding:4px 16px 8px;font-size:12px;color:var(--text-muted);';
    hint.textContent = t('autoDeleteOwnerOnly');
    adSection.appendChild(hint);
  }
  content.appendChild(adSection);

  // ── Members ──
  const membersSection = document.createElement('div');
  membersSection.className = 'settings-section';
  membersSection.innerHTML = `<div class="section-header">${t('groupMembers')} (${info.members.length})</div>`;

  // Add member button (if admin/owner)
  if (isAdmin) {
    const addRow = document.createElement('div');
    addRow.className = 'list-item';
    addRow.style.cursor = 'pointer';
    addRow.innerHTML = `
      <div class="avatar avatar-sm" style="background:var(--green);display:flex;align-items:center;justify-content:center;">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="#fff"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
      </div>
      <span style="margin-left:12px;font-size:15px;font-weight:500;">${t('addMembers')}</span>
    `;
    addRow.onclick = () => showAddMemberModal(groupId, info.members.map(m => m.id), content, membersSection);
    membersSection.appendChild(addRow);
  }

  info.members.forEach(m => {
    const item = document.createElement('div');
    item.className = 'list-item';
    item.appendChild(avatarEl(m.nickname || m.username, m.avatar, 'avatar-sm'));
    const info2 = document.createElement('div');
    info2.className = 'flex-1';
    info2.style.marginLeft = '12px';
    let roleTag = '';
    if (m.role === 'owner') roleTag = `<span class="role-badge role-owner">${t('groupOwner')}</span>`;
    else if (m.role === 'admin') roleTag = `<span class="role-badge role-admin">${t('groupAdmin')}</span>`;
    info2.innerHTML = `
      <div style="font-size:15px;font-weight:500;">${esc(m.nickname || m.username)} ${roleTag}</div>
      <div class="text-muted" style="font-size:13px;">@${esc(m.username)}</div>
    `;
    item.appendChild(info2);

    // Remove button for admins (can't remove owner)
    if (isAdmin && m.role !== 'owner' && m.id !== state.user.id) {
      const removeBtn = document.createElement('button');
      removeBtn.className = 'btn-pill btn-outline';
      removeBtn.style.cssText = 'color:var(--red);border-color:var(--red);font-size:12px;padding:4px 10px;';
      removeBtn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M19 13H5v-2h14v2z"/></svg>`;
      removeBtn.onclick = async (e) => {
        e.stopPropagation();
        if (!confirm(t('removeMemberConfirm'))) return;
        try {
          await api.removeMember(groupId, m.id);
          item.remove();
          showToast('✓');
        } catch (err) { showToast(err.message); }
      };
      item.appendChild(removeBtn);
    }
    membersSection.appendChild(item);
  });
  content.appendChild(membersSection);

  // ── Actions ──
  const actionsSection = document.createElement('div');
  actionsSection.className = 'settings-section';
  actionsSection.style.paddingBottom = '32px';

  if (!isOwner) {
    const leaveBtn = document.createElement('div');
    leaveBtn.className = 'list-item danger-action';
    leaveBtn.style.cssText = 'justify-content:center;color:var(--red);cursor:pointer;font-weight:500;';
    leaveBtn.textContent = t('leaveGroup');
    leaveBtn.onclick = async () => {
      if (!confirm(t('leaveGroupConfirm'))) return;
      try {
        await api.leaveGroup(groupId);
        // Remove from local state
        state.groupsList = (state.groupsList || []).filter(g => g.id !== groupId);
        state.chats = state.chats.filter(c => c.id !== groupId);
        showToast('✓');
        navigateTo('groups');
      } catch (err) { showToast(err.message); }
    };
    actionsSection.appendChild(leaveBtn);
  }

  if (isOwner) {
    const disbandBtn = document.createElement('div');
    disbandBtn.className = 'list-item danger-action';
    disbandBtn.style.cssText = 'justify-content:center;color:var(--red);cursor:pointer;font-weight:600;';
    disbandBtn.textContent = t('disbandGroup');
    disbandBtn.onclick = async () => {
      if (!confirm(t('disbandGroupConfirm'))) return;
      try {
        await api.disbandGroup(groupId);
        state.groupsList = (state.groupsList || []).filter(g => g.id !== groupId);
        state.chats = state.chats.filter(c => c.id !== groupId);
        showToast('✓');
        navigateTo('groups');
      } catch (err) { showToast(err.message); }
    };
    actionsSection.appendChild(disbandBtn);
  }

  content.appendChild(actionsSection);
}

function showAddMemberModal(groupId, existingIds, contentEl, membersSection) {
  const friends = (state.contacts || []).filter(f => !existingIds.includes(f.id));
  if (!friends.length) { showToast(t('noContacts')); return; }

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-card" style="width:90%;max-width:420px;max-height:70vh;display:flex;flex-direction:column;">
      <div class="modal-header">
        <button class="topbar-btn" id="add-cancel">${t('cancel')}</button>
        <div class="topbar-title" style="font-size:16px">${t('addMembers')}</div>
        <div style="min-width:44px"></div>
      </div>
      <div id="add-picker" style="padding:8px 0;flex:1;overflow-y:auto;"></div>
    </div>
  `;
  document.body.appendChild(overlay);

  const pickerEl = overlay.querySelector('#add-picker');
  overlay.querySelector('#add-cancel').onclick = () => overlay.remove();
  overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };

  friends.forEach(f => {
    const item = document.createElement('div');
    item.className = 'list-item';
    item.style.cursor = 'pointer';
    item.appendChild(avatarEl(f.nickname || f.username, f.avatar, 'avatar-sm'));
    const info = document.createElement('span');
    info.style.cssText = 'font-size:15px;font-weight:500;margin-left:12px;flex:1;';
    info.textContent = f.nickname || f.username;
    item.appendChild(info);
    const addBtn = document.createElement('button');
    addBtn.className = 'btn-pill btn-green';
    addBtn.textContent = t('add');
    addBtn.onclick = async (e) => {
      e.stopPropagation();
      addBtn.disabled = true;
      try {
        await api.addMember(groupId, f.id);
        addBtn.textContent = '✓';
        addBtn.className = 'btn-pill btn-outline';
        existingIds.push(f.id);
      } catch (err) {
        showToast(err.message);
        addBtn.disabled = false;
      }
    };
    item.appendChild(addBtn);
    pickerEl.appendChild(item);
  });
}

function showGroupAutoDeletePicker(current, onSelect) {
  const options = [
    { value: 0,       label: t('autoDeleteNever') },
    { value: 86400,   label: t('autoDelete1d') },
    { value: 259200,  label: t('autoDelete3d') },
    { value: 604800,  label: t('autoDelete7d') },
    { value: 2592000, label: t('autoDelete30d') },
  ];
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-card" style="width:85%;max-width:360px;">
      <div class="modal-header">
        <div style="min-width:44px"></div>
        <div class="topbar-title" style="font-size:16px">${t('autoDeleteTitle')}</div>
        <div style="min-width:44px"></div>
      </div>
      <div id="ad-options" style="padding:8px 0;"></div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };

  const list = overlay.querySelector('#ad-options');
  options.forEach(opt => {
    const row = document.createElement('div');
    row.className = 'list-item';
    row.style.cssText = 'cursor:pointer;justify-content:space-between;padding:14px 20px;';
    const isActive = current === opt.value;
    row.innerHTML = `
      <span style="font-size:15px;font-weight:${isActive ? '600' : '400'};color:${isActive ? 'var(--green)' : 'var(--text)'};">${opt.label}</span>
      ${isActive ? '<svg viewBox="0 0 24 24" width="20" height="20" fill="var(--green)"><path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z"/></svg>' : ''}
    `;
    row.onclick = () => {
      overlay.remove();
      if (opt.value !== current) onSelect(opt.value);
    };
    list.appendChild(row);
  });
}
