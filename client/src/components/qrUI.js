/**
 * QR UI Helpers — shared modals for showing QR codes and handling scan results
 */
import { generateQRSvg, userQRData, groupQRData } from '../services/qrcode.js';
import { openScanner } from '../services/scanner.js';
import { api } from '../api.js';
import { state, showToast, avatarEl, navigateTo } from '../app.js';
import { refreshGroupList } from '../pages/groups.js';
import { refreshChatList } from '../pages/chats.js';
import { t } from '../i18n.js';

const esc = s => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

const COLORS = ['#2196F3','#E91E63','#9C27B0','#FF5722','#607D8B','#009688','#795548'];
function nameColor(name) { return COLORS[(name || '').charCodeAt(0) % COLORS.length]; }

/**
 * Show user's personal QR code modal
 */
export function showMyQRCode(user) {
  const data = userQRData(user.id);
  const svg = generateQRSvg(data, { size: 200, fg: '#0D0D0D', bg: '#FFFFFF' });

  const overlay = document.createElement('div');
  overlay.className = 'qr-modal-overlay';
  overlay.innerHTML = `
    <div class="qr-modal-card">
      <div class="qr-modal-header">
        <div id="qr-modal-av"></div>
        <div class="qr-modal-info">
          <div class="qr-modal-name">${esc(user.nickname || user.username)}</div>
          <div class="qr-modal-username">@${esc(user.username)}</div>
        </div>
      </div>
      <div class="qr-modal-body">
        <div class="qr-modal-svg-wrap">${svg}</div>
        <div class="qr-modal-desc">${t('myQRCodeDesc')}</div>
      </div>
      <button class="qr-modal-close-btn" id="qr-close">${t('confirm')}</button>
    </div>
  `;
  document.body.appendChild(overlay);

  // Insert avatar
  const avWrap = overlay.querySelector('#qr-modal-av');
  if (user.avatar) {
    const img = document.createElement('img');
    img.className = 'qr-modal-avatar';
    img.src = user.avatar;
    img.alt = user.nickname || user.username;
    avWrap.appendChild(img);
  } else {
    const ph = document.createElement('div');
    ph.className = 'qr-modal-avatar-placeholder';
    ph.style.background = nameColor(user.nickname || user.username);
    ph.textContent = (user.nickname || user.username || '?')[0].toUpperCase();
    avWrap.appendChild(ph);
  }

  overlay.querySelector('#qr-close').onclick = () => overlay.remove();
  overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };
}

/**
 * Show group QR code modal with duration picker
 */
export async function showGroupQRCode(groupId, groupName, groupAvatar, isAdmin = false) {
  const overlay = document.createElement('div');
  overlay.className = 'qr-modal-overlay';
  overlay.innerHTML = `
    <div class="qr-modal-card">
      <div class="qr-modal-header">
        <div id="grp-qr-av"></div>
        <div class="qr-modal-info">
          <div class="qr-modal-name">${esc(groupName)}</div>
          <div class="qr-modal-username">${t('groupQRCode')}</div>
        </div>
      </div>
      <div class="qr-modal-body">
        <div class="qr-modal-svg-wrap" id="grp-qr-svg">
          <div style="color:var(--text-muted);font-size:14px">${t('qrGenerating')}</div>
        </div>
        <div class="qr-modal-desc">${t('groupQRCodeDesc')}</div>
        <div class="qr-modal-expires" id="grp-qr-expires"></div>
        ${isAdmin ? `
          <div class="qr-duration-picker" id="grp-qr-duration">
            <button class="qr-duration-option active" data-d="1w">${t('qrOneWeek')}</button>
            <button class="qr-duration-option" data-d="1m">${t('qrOneMonth')}</button>
            <button class="qr-duration-option" data-d="3m">${t('qrThreeMonths')}</button>
          </div>
        ` : ''}
      </div>
      <button class="qr-modal-close-btn" id="grp-qr-close">${t('confirm')}</button>
    </div>
  `;
  document.body.appendChild(overlay);

  // Avatar
  const avWrap = overlay.querySelector('#grp-qr-av');
  if (groupAvatar) {
    const img = document.createElement('img');
    img.className = 'qr-modal-avatar';
    img.src = groupAvatar;
    img.alt = groupName;
    avWrap.appendChild(img);
  } else {
    const ph = document.createElement('div');
    ph.className = 'qr-modal-avatar-placeholder';
    ph.style.background = nameColor(groupName);
    ph.textContent = (groupName || '?')[0].toUpperCase();
    avWrap.appendChild(ph);
  }

  overlay.querySelector('#grp-qr-close').onclick = () => overlay.remove();
  overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };

  let selectedDuration = '1w';

  async function generateInvite(duration) {
    const svgWrap = overlay.querySelector('#grp-qr-svg');
    const expiresEl = overlay.querySelector('#grp-qr-expires');
    svgWrap.innerHTML = `<div style="color:var(--text-muted);font-size:14px">${t('qrGenerating')}</div>`;
    expiresEl.textContent = '';
    try {
      const { invite_id, expires_at } = await api.createGroupInvite(groupId, duration);
      const data = groupQRData(invite_id);
      const svg = generateQRSvg(data, { size: 200, fg: '#0D0D0D', bg: '#FFFFFF' });
      svgWrap.innerHTML = svg;
      const expDate = new Date(expires_at);
      expiresEl.innerHTML = `
        <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z"/></svg>
        ${t('qrExpires')}: ${expDate.toLocaleDateString()} ${expDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
      `;
    } catch (err) {
      svgWrap.innerHTML = `<div style="color:var(--red);font-size:14px">${err.message}</div>`;
    }
  }

  // Duration picker
  if (isAdmin) {
    const picker = overlay.querySelector('#grp-qr-duration');
    picker.querySelectorAll('.qr-duration-option').forEach(btn => {
      btn.onclick = () => {
        picker.querySelectorAll('.qr-duration-option').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        selectedDuration = btn.dataset.d;
        generateInvite(selectedDuration);
      };
    });
  }

  generateInvite(selectedDuration);
}

/**
 * Handle a scanned QR result
 */
export async function handleScanResult(result) {
  if (result.type === 'user') {
    await handleUserScan(result.id);
  } else if (result.type === 'group') {
    await handleGroupScan(result.id);
  } else {
    showToast(t('qrInvalidCode'));
  }
}

async function handleUserScan(userId) {
  // Check if it's self
  if (userId === state.user?.id) {
    showToast(t('qrInvalidCode'));
    return;
  }
  // Check if already friends
  const isFriend = state.contacts.some(c => c.id === userId);
  if (isFriend) {
    showToast(t('qrAlreadyFriend'));
    return;
  }
  // Send friend request
  try {
    const { user } = await api.addFriendById(userId);
    showConfirmModal({
      name: user.nickname || user.username,
      username: user.username,
      avatar: user.avatar,
      title: t('qrAddFriend'),
      subtitle: `@${user.username}`,
      confirmText: t('requestSent'),
      isResult: true,
    });
  } catch (err) {
    if (err.message.includes('Already friends')) {
      showToast(t('qrAlreadyFriend'));
    } else if (err.message.includes('not found')) {
      showToast(t('qrUserNotFound'));
    } else {
      showToast(err.message);
    }
  }
}

async function handleGroupScan(inviteId) {
  try {
    const info = await api.getGroupInvite(inviteId);
    showGroupJoinConfirm(inviteId, info);
  } catch (err) {
    if (err.message.includes('expired') || err.message.includes('410')) {
      showToast(t('qrExpired'));
    } else {
      showToast(t('qrGroupNotFound'));
    }
  }
}

function showGroupJoinConfirm(inviteId, info) {
  const overlay = document.createElement('div');
  overlay.className = 'qr-confirm-overlay';
  overlay.innerHTML = `
    <div class="qr-confirm-card">
      <div class="qr-confirm-avatar-wrap" id="confirm-av"></div>
      <div class="qr-confirm-title">${esc(info.group_name)}</div>
      <div class="qr-confirm-subtitle">${info.member_count} ${t('nMembers')}</div>
      <div class="qr-confirm-extra">${t('qrJoinGroupConfirm')}</div>
      <div class="qr-confirm-actions">
        <button class="qr-confirm-btn qr-confirm-cancel" id="confirm-cancel">${t('cancel')}</button>
        <button class="qr-confirm-btn qr-confirm-ok" id="confirm-join">${t('qrJoinGroup')}</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const avWrap = overlay.querySelector('#confirm-av');
  const av = avatarEl(info.group_name, info.group_avatar, 'avatar-lg');
  avWrap.appendChild(av);

  overlay.querySelector('#confirm-cancel').onclick = () => overlay.remove();
  overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };

  overlay.querySelector('#confirm-join').onclick = async () => {
    const btn = overlay.querySelector('#confirm-join');
    btn.disabled = true;
    btn.textContent = '...';
    try {
      const { group } = await api.joinGroupByInvite(inviteId);
      // Add to local state
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
      overlay.remove();
      showToast(t('qrJoinedGroup'));
      navigateTo('groups');
    } catch (err) {
      if (err.message.includes('Already a member')) {
        showToast(t('qrAlreadyMember'));
        overlay.remove();
      } else if (err.message.includes('expired')) {
        showToast(t('qrExpired'));
        overlay.remove();
      } else {
        showToast(err.message);
        btn.disabled = false;
        btn.textContent = t('qrJoinGroup');
      }
    }
  };
}

function showConfirmModal({ name, username, avatar, title, subtitle, confirmText, isResult }) {
  const overlay = document.createElement('div');
  overlay.className = 'qr-confirm-overlay';
  overlay.innerHTML = `
    <div class="qr-confirm-card">
      <div class="qr-confirm-avatar-wrap" id="result-av"></div>
      <div class="qr-confirm-title">${esc(name)}</div>
      <div class="qr-confirm-subtitle">${esc(subtitle)}</div>
      <div class="qr-confirm-extra">${esc(confirmText)}</div>
      <div class="qr-confirm-actions">
        <button class="qr-confirm-btn qr-confirm-ok" id="result-ok" style="flex:1">${t('confirm')}</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const avWrap = overlay.querySelector('#result-av');
  avWrap.appendChild(avatarEl(name, avatar, 'avatar-lg'));

  overlay.querySelector('#result-ok').onclick = () => overlay.remove();
  overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };
}

/**
 * Open scanner and handle result
 */
export function startScan() {
  openScanner(handleScanResult);
}

/**
 * SVG icon for the scan button
 */
export function scanIconSvg() {
  return `<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
    <path d="M3 5v4h2V5h4V3H5C3.9 3 3 3.9 3 5zm2 10H3v4c0 1.1.9 2 2 2h4v-2H5v-4zm14 4h-4v2h4c1.1 0 2-.9 2-2v-4h-2v4zm0-16h-4v2h4v4h2V5c0-1.1-.9-2-2-2z"/>
    <path d="M12 15c1.65 0 3-1.35 3-3s-1.35-3-3-3-3 1.35-3 3 1.35 3 3 3zm0-4c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1z"/>
  </svg>`;
}

/**
 * QR code icon for settings items
 */
export function qrCodeIconSvg() {
  return `<svg viewBox="0 0 24 24" width="18" height="18" fill="#fff">
    <path d="M3 11h8V3H3v8zm2-6h4v4H5V5zm8-2v8h8V3h-8zm6 6h-4V5h4v4zM3 21h8v-8H3v8zm2-6h4v4H5v-4zm13-2h-2v3h-3v2h3v3h2v-3h3v-2h-3v-3zm-5 0h2v2h-2v-2zm4 4h2v2h-2v-2z"/>
  </svg>`;
}
