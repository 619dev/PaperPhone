/**
 * Profile / Settings page — i18n v2
 */
import { state, showToast, avatarEl } from '../app.js';
import { api, clearToken } from '../api.js';
import { uploadFileWithRing } from '../uploadProgress.js';
import { disconnect } from '../socket.js';
import { t, getLang, getLangName, getLangFlag, getSupportedLangs, setLang, onLangChange, offLangChange } from '../i18n.js';
import { isPushSupported, isPushSubscribed, subscribePush, unsubscribePush, getPermissionState } from '../services/pushNotification.js';

export function renderProfile(root) {
  const u = state.user;

  function buildPage() {
    root.innerHTML = `
      <div class="topbar">
        <div style="min-width:44px"></div>
        <div class="topbar-title">${t('profileTitle')}</div>
        <div style="min-width:44px"></div>
      </div>

      <!-- Hero card -->
      <div class="profile-hero">
        <div class="avatar-upload-wrap" id="avatar-upload-trigger">
          <div id="av-wrap"></div>
          <div class="avatar-camera-badge"><svg viewBox="0 0 24 24" width="14" height="14" fill="#fff"><path d="M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4z"/><path d="M9 2L7.17 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2h-3.17L15 2H9zm3 15c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5z"/></svg></div>
        </div>
        <input type="file" id="avatar-file-input" accept="image/*" class="hidden">
        <div class="profile-info">
          <div class="profile-name">${esc(u.nickname || u.username)}</div>
          <div class="profile-username">@${esc(u.username)}</div>
          <div class="profile-enc-badge"><svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" style="margin-right:3px"><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zM9 8V6c0-1.66 1.34-3 3-3s3 1.34 3 3v2H9z"/></svg> E2E</div>
        </div>
        <span class="profile-arrow">›</span>
      </div>

      <!-- Settings groups -->
      <div class="section-header" style="padding-top:12px"></div>

      <div class="card-group" id="g-identity">
        <div class="settings-item" id="change-avatar">
          <div class="settings-icon" style="background:#FF9500"><svg viewBox="0 0 24 24" width="18" height="18" fill="#fff"><path d="M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4z"/><path d="M9 2L7.17 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2h-3.17L15 2H9zm3 15c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5z"/></svg></div>
          <span class="settings-label">${t('changeAvatar')}</span>
          <span class="settings-chevron">›</span>
        </div>
        <div class="settings-item" id="change-nickname">
          <div class="settings-icon" style="background:#07C160"><svg viewBox="0 0 24 24" width="18" height="18" fill="#fff"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34a.996.996 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg></div>
          <span class="settings-label">${t('changeNickname')}</span>
          <span class="settings-value" id="cur-nickname">${esc(u.nickname || u.username)}</span>
          <span class="settings-chevron">›</span>
        </div>
      </div>

      <div class="card-group" id="g-security">
        <div class="settings-item">
          <div class="settings-icon" style="background:#007AFF"><svg viewBox="0 0 24 24" width="18" height="18" fill="#fff"><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zM9 8V6c0-1.66 1.34-3 3-3s3 1.34 3 3v2H9z"/></svg></div>
          <span class="settings-label">${t('e2eLabel')}</span>
          <span class="settings-value">${t('e2eValue')}</span>
        </div>
        <div class="settings-item">
          <div class="settings-icon" style="background:#AF52DE"><svg viewBox="0 0 24 24" width="18" height="18" fill="#fff"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.94-.49-7-3.85-7-7.93 0-.62.08-1.22.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg></div>
          <span class="settings-label">${t('pqLabel')}</span>
          <span class="settings-value">${t('pqValue')}</span>
        </div>
        <div class="settings-item" id="export-keys">
          <div class="settings-icon" style="background:#FF9500"><svg viewBox="0 0 24 24" width="18" height="18" fill="#fff"><path d="M12.65 10A5.99 5.99 0 0 0 7 6c-3.31 0-6 2.69-6 6s2.69 6 6 6a5.99 5.99 0 0 0 5.65-4H17v4h4v-4h2v-4H12.65zM7 14c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z"/></svg></div>
          <span class="settings-label">${t('keyFingerprint')}</span>
          <span class="settings-chevron">›</span>
        </div>
        <div class="settings-item" id="devices-btn">
          <div class="settings-icon" style="background:#5856D6"><svg viewBox="0 0 24 24" width="18" height="18" fill="#fff"><path d="M21 2H3c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h7l-2 3v1h8v-1l-2-3h7c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 12H3V4h18v10z"/></svg></div>
          <span class="settings-label">${t('devices')}</span>
          <span class="settings-chevron">›</span>
        </div>
        <div class="settings-item" id="totp-2fa-btn">
          <div class="settings-icon" style="background:#34C759"><svg viewBox="0 0 24 24" width="18" height="18" fill="#fff"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm-2 16l-4-4 1.41-1.41L10 14.17l6.59-6.59L18 9l-8 8z"/></svg></div>
          <span class="settings-label">${t('twoFactorAuth')}</span>
          <span class="settings-value" id="totp-status">...</span>
          <span class="settings-chevron">›</span>
        </div>
      </div>

      <div class="card-group" id="g-prefs">
        <div class="settings-item" id="push-toggle" style="${isPushSupported() ? '' : 'display:none'}">
          <div class="settings-icon" style="background:#FF3B30"><svg viewBox="0 0 24 24" width="18" height="18" fill="#fff"><path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.89 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z"/></svg></div>
          <span class="settings-label">${t('pushNotifications')}</span>
          <span class="settings-value" id="push-status">...</span>
          <span class="settings-chevron">›</span>
        </div>
        <div class="settings-item" id="lang-btn">
          <div class="settings-icon" style="background:#34C759"><svg viewBox="0 0 24 24" width="18" height="18" fill="#fff"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zm6.93 6h-2.95a15.65 15.65 0 0 0-1.38-3.56A8.03 8.03 0 0 1 18.92 8zM12 4.04c.83 1.2 1.48 2.53 1.91 3.96h-3.82c.43-1.43 1.08-2.76 1.91-3.96zM4.26 14C4.1 13.36 4 12.69 4 12s.1-1.36.26-2h3.38c-.08.66-.14 1.32-.14 2s.06 1.34.14 2H4.26zm.82 2h2.95c.32 1.25.78 2.45 1.38 3.56A7.99 7.99 0 0 1 5.08 16zm2.95-8H5.08a7.99 7.99 0 0 1 4.33-3.56A15.65 15.65 0 0 0 8.03 8zM12 19.96c-.83-1.2-1.48-2.53-1.91-3.96h3.82c-.43 1.43-1.08 2.76-1.91 3.96zM14.34 14H9.66c-.09-.66-.16-1.32-.16-2s.07-1.35.16-2h4.68c.09.65.16 1.32.16 2s-.07 1.34-.16 2zm.25 5.56c.6-1.11 1.06-2.31 1.38-3.56h2.95a8.03 8.03 0 0 1-4.33 3.56zM16.36 14c.08-.66.14-1.32.14-2s-.06-1.34-.14-2h3.38c.16.64.26 1.31.26 2s-.1 1.36-.26 2h-3.38z"/></svg></div>
          <span class="settings-label">${t('language')}</span>
          <span class="settings-value">${getLangName(getLang())}</span>
          <span class="settings-chevron">›</span>
        </div>
        <div class="settings-item">
          <div class="settings-icon" style="background:#636366"><svg viewBox="0 0 24 24" width="18" height="18" fill="#fff"><path d="M11 7h2v2h-2zm0 4h2v6h-2zm1-9C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z"/></svg></div>
          <span class="settings-label">${t('version')}</span>
          <span class="settings-value">PaperPhone v1.1</span>
        </div>
        <div class="settings-item" id="pwa-install">
          <div class="settings-icon" style="background:#FF3B30"><svg viewBox="0 0 24 24" width="18" height="18" fill="#fff"><path d="M15.5 1h-8A2.5 2.5 0 0 0 5 3.5v17A2.5 2.5 0 0 0 7.5 23h8a2.5 2.5 0 0 0 2.5-2.5v-17A2.5 2.5 0 0 0 15.5 1zm-4 21c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm4.5-4H7V4h9v14z"/></svg></div>
          <span class="settings-label">${t('addHomescreen')}</span>
          <span class="settings-chevron">›</span>
        </div>
      </div>

      <div class="card-group" style="margin-top:8px">
        <div class="settings-item" id="logout-btn" style="justify-content:center">
          <span style="color:var(--red);font-size:16px;font-weight:500">${t('logout')}</span>
        </div>
      </div>

      <div style="height:24px"></div>
    `;

    // Avatar
    root.querySelector('#av-wrap').appendChild(avatarEl(u.nickname || u.username, u.avatar, 'avatar-lg'));

    // Avatar upload — hero click or settings item click
    const avatarFileInput = root.querySelector('#avatar-file-input');
    const triggerAvatarUpload = () => avatarFileInput.click();
    root.querySelector('#avatar-upload-trigger').onclick = triggerAvatarUpload;
    root.querySelector('#change-avatar').onclick = triggerAvatarUpload;
    avatarFileInput.addEventListener('change', async () => {
      const file = avatarFileInput.files[0];
      if (!file) return;
      try {
        const { url } = await uploadFileWithRing(api, file, t('uploading'));
        await api.updateMe({ avatar: url });
        state.user.avatar = url;
        showToast(t('avatarUpdated'));
        buildPage(); // re-render to show new avatar
      } catch { showToast(t('avatarFailed')); }
      avatarFileInput.value = '';
    });

    // Change nickname
    root.querySelector('#change-nickname').onclick = async () => {
      const nn = prompt(t('nicknamePrompt'), u.nickname || u.username);
      if (nn && nn.trim()) {
        try {
          await api.updateMe({ nickname: nn.trim() });
          state.user.nickname = nn.trim();
          root.querySelector('#cur-nickname').textContent = nn.trim();
          root.querySelector('.profile-name').textContent = nn.trim();
          showToast(t('nicknameUpdated'));
        } catch { showToast(t('updateFailed')); }
      }
    };

    // Key fingerprint
    root.querySelector('#export-keys').onclick = async () => {
      const { getKey } = await import('../crypto/keystore.js');
      const ik = await getKey('ik');
      if (ik) {
        const fp = ik.publicKey.slice(0, 24).replace(/(.{4})/g, '$1 ').trim();
        alert(`${t('fpLabel')}:\n${fp}\n\n${t('fpWarning')}`);
      } else {
        showToast(t('noKey'));
      }
    };

    // Devices page
    root.querySelector('#devices-btn').onclick = () => {
      import('./devices.js').then(m => {
        const appEl = document.getElementById('app');
        // Push the devices sub-page over the current content
        const page = document.createElement('div');
        page.className = 'page';
        m.renderDevices(page);
        appEl.innerHTML = '';
        appEl.appendChild(page);
      });
    };

    // ── TOTP 2FA ──────────────────────────────────────────────────────
    const totpStatusEl = root.querySelector('#totp-status');
    (async () => {
      try {
        const { enabled } = await api.totpStatus();
        totpStatusEl.textContent = enabled ? t('totpEnabled') : t('totpDisabled');
      } catch { totpStatusEl.textContent = '-'; }
    })();

    root.querySelector('#totp-2fa-btn').onclick = () => open2FAPage(buildPage);

    // Push notification toggle — async check & toggle
    const pushToggleEl = root.querySelector('#push-toggle');
    const pushStatusEl = root.querySelector('#push-status');
    if (pushToggleEl && pushStatusEl) {
      // Async state check
      (async () => {
        const sub = await isPushSubscribed();
        const perm = getPermissionState();
        if (perm === 'denied') {
          pushStatusEl.textContent = t('pushDenied');
          pushToggleEl.style.opacity = '0.5';
        } else if (sub) {
          pushStatusEl.textContent = t('pushEnabled');
        } else {
          pushStatusEl.textContent = t('pushDisabled');
        }
      })();

      pushToggleEl.onclick = async () => {
        const perm = getPermissionState();
        if (perm === 'denied') {
          showToast(t('pushDeniedHint'));
          return;
        }
        const sub = await isPushSubscribed();
        if (sub) {
          const ok = await unsubscribePush();
          if (ok) {
            pushStatusEl.textContent = t('pushDisabled');
            showToast(t('pushTurnedOff'));
          }
        } else {
          pushStatusEl.textContent = '...';
          const ok = await subscribePush();
          if (ok) {
            pushStatusEl.textContent = t('pushEnabled');
            showToast(t('pushTurnedOn'));
          } else {
            pushStatusEl.textContent = t('pushDisabled');
            if (getPermissionState() === 'denied') {
              showToast(t('pushDeniedHint'));
            } else {
              showToast(t('pushFailed'));
            }
          }
        }
      };
    }

    // Language picker
    root.querySelector('#lang-btn').onclick = () => openLangPicker(buildPage);

    // iOS PWA
    root.querySelector('#pwa-install').onclick = () => {
      alert(`${t('iosInstallTitle')}\n\n${t('iosInstallSteps')}`);
    };

    // Logout
    root.querySelector('#logout-btn').onclick = () => {
      if (!confirm(t('logoutConfirm'))) return;
      clearToken();
      disconnect();
      // Clear all persisted crypto keys from every storage tier
      try {
        for (const k of Object.keys(localStorage)) {
          if (k.startsWith('ppkl_') || k.startsWith('ppk_')) localStorage.removeItem(k);
        }
        for (const k of Object.keys(sessionStorage)) {
          if (k.startsWith('ppkl_') || k.startsWith('ppk_')) sessionStorage.removeItem(k);
        }
      } catch {}
      state.user = null;
      state.chats = [];
      state.contacts = [];
      window.location.reload();
    };
  }

  buildPage();

  // Re-render if language changes while page is open
  const handler = () => buildPage();
  onLangChange(handler);
  root._cleanup = () => offLangChange(handler);
}

function openLangPicker(onClose) {
  const picker = document.createElement('div');
  picker.className = 'lang-picker';
  picker.innerHTML = `
    <div class="lang-picker-backdrop"></div>
    <div class="lang-picker-sheet">
      <div class="lang-picker-handle"></div>
      <div class="lang-picker-title">${t('language')}</div>
      ${getSupportedLangs().map(code => `
        <div class="lang-option ${code === getLang() ? 'selected' : ''}" data-code="${code}">
          <span class="lang-flag">${getLangFlag(code)}</span>
          <span class="lang-name">${getLangName(code)}</span>
          ${code === getLang() ? '<span class="lang-check"><svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/></svg></span>' : ''}
        </div>
      `).join('')}
    </div>
  `;
  const close = () => { picker.remove(); onClose?.(); };
  picker.querySelector('.lang-picker-backdrop').onclick = close;
  picker.querySelectorAll('.lang-option').forEach(el => {
    el.onclick = () => { setLang(el.dataset.code); close(); };
  });
  document.body.appendChild(picker);
}

function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

/**
 * Full-page 2FA management
 */
async function open2FAPage(onBack) {
  const appEl = document.getElementById('app');
  const page = document.createElement('div');
  page.className = 'page';

  let step = 'loading'; // loading | setup | confirm | recovery | enabled

  async function render() {
    page.innerHTML = `
      <div class="topbar">
        <div class="topbar-back" id="totp-back">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>
        </div>
        <div class="topbar-title">${t('twoFactorAuth')}</div>
        <div style="min-width:44px"></div>
      </div>
      <div id="totp-content" style="padding:16px;padding-top:calc(var(--topbar-h) + 16px);max-width:420px;margin:0 auto"></div>
    `;

    appEl.innerHTML = '';
    appEl.appendChild(page);

    page.querySelector('#totp-back').onclick = () => {
      const pg = document.createElement('div');
      pg.className = 'page';
      renderProfile(pg);
      appEl.innerHTML = '';
      appEl.appendChild(pg);
    };

    const content = page.querySelector('#totp-content');

    if (step === 'loading') {
      content.innerHTML = `<div style="text-align:center;padding:48px 0;color:var(--subtext)">${t('loading') || '...'}</div>`;
      try {
        const { enabled } = await api.totpStatus();
        step = enabled ? 'enabled' : 'setup';
        render();
      } catch {
        content.innerHTML = `<div style="text-align:center;padding:48px 0;color:var(--red)">${t('opFailed')}</div>`;
      }
      return;
    }

    if (step === 'enabled') {
      content.innerHTML = `
        <div class="totp-status-card">
          <div class="totp-status-icon totp-enabled">
            <svg viewBox="0 0 24 24" width="48" height="48" fill="currentColor">
              <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm-2 16l-4-4 1.41-1.41L10 14.17l6.59-6.59L18 9l-8 8z"/>
            </svg>
          </div>
          <div class="totp-status-text">${t('totpEnabledDesc')}</div>
        </div>

        <div class="card-group" style="margin-top:24px">
          <div class="settings-item" id="totp-disable-btn" style="justify-content:center">
            <span style="color:var(--red);font-size:16px;font-weight:500">${t('totpDisable')}</span>
          </div>
        </div>
      `;

      content.querySelector('#totp-disable-btn').onclick = async () => {
        const code = prompt(t('totpDisablePrompt'));
        if (!code) return;
        try {
          await api.totpDisable(code.trim());
          showToast(t('totpDisabledSuccess'));
          step = 'setup';
          render();
        } catch (err) {
          showToast(err.message || t('opFailed'));
        }
      };
      return;
    }

    if (step === 'setup') {
      content.innerHTML = `
        <div class="totp-setup-intro">
          <div class="totp-status-icon" style="color:var(--subtext)">
            <svg viewBox="0 0 24 24" width="48" height="48" fill="currentColor">
              <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z"/>
            </svg>
          </div>
          <h3 style="margin:12px 0 8px;color:var(--text)">${t('totpSetupTitle')}</h3>
          <p style="color:var(--subtext);font-size:14px;line-height:1.5">${t('totpSetupDesc')}</p>
        </div>

        <button class="auth-btn" id="totp-start-btn" style="margin-top:20px;width:100%">${t('totpStartSetup')}</button>
      `;

      content.querySelector('#totp-start-btn').onclick = async () => {
        const btn = content.querySelector('#totp-start-btn');
        btn.disabled = true;
        btn.textContent = '...';
        try {
          const setupData = await api.totpSetup();
          step = 'confirm';
          renderConfirm(setupData);
        } catch (err) {
          showToast(err.message || t('opFailed'));
          btn.disabled = false;
          btn.textContent = t('totpStartSetup');
        }
      };
      return;
    }
  }

  function renderConfirm(setupData) {
    const content = page.querySelector('#totp-content');
    content.innerHTML = `
      <div class="totp-qr-section">
        <p style="color:var(--subtext);font-size:14px;margin-bottom:16px;text-align:center">${t('totpScanQR')}</p>
        <div class="totp-qr-wrap">
          <img src="${setupData.qrDataUrl}" alt="QR Code" class="totp-qr-image">
        </div>
        <div class="totp-secret-wrap">
          <span class="totp-secret-label">${t('totpManualKey')}</span>
          <code class="totp-secret-code" id="totp-secret-text">${setupData.secret}</code>
          <button class="totp-copy-btn" id="totp-copy-secret" title="Copy">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>
          </button>
        </div>
      </div>

      <form id="totp-confirm-form" autocomplete="off" style="margin-top:20px">
        <div class="auth-field">
          <input class="auth-input totp-input" id="inp-totp-confirm" type="text"
            inputmode="numeric" pattern="[0-9]*" maxlength="6"
            placeholder="${t('totpCodePlaceholder')}" autocomplete="one-time-code"
            style="text-align:center;font-size:24px;letter-spacing:8px;font-weight:600">
        </div>
        <div class="auth-error" id="totp-confirm-err"></div>
        <button class="auth-btn" id="totp-confirm-btn" type="submit" style="width:100%">${t('totpConfirmSetup')}</button>
      </form>
    `;

    // Copy secret
    content.querySelector('#totp-copy-secret').onclick = () => {
      navigator.clipboard?.writeText(setupData.secret).then(() => showToast(t('copied') || 'Copied'));
    };

    // Auto-focus
    setTimeout(() => content.querySelector('#inp-totp-confirm')?.focus(), 100);

    // Confirm form
    content.querySelector('#totp-confirm-form').onsubmit = async (e) => {
      e.preventDefault();
      const errEl = content.querySelector('#totp-confirm-err');
      const btn = content.querySelector('#totp-confirm-btn');
      const code = content.querySelector('#inp-totp-confirm').value.trim();
      errEl.textContent = '';
      if (!code) { errEl.textContent = t('enterCode'); return; }

      btn.disabled = true;
      btn.textContent = t('verifying');

      try {
        const result = await api.totpVerifySetup(code);
        renderRecoveryCodes(result.recoveryCodes);
      } catch (err) {
        errEl.textContent = err.message || t('opFailed');
        btn.disabled = false;
        btn.textContent = t('totpConfirmSetup');
      }
    };
  }

  function renderRecoveryCodes(codes) {
    const content = page.querySelector('#totp-content');
    content.innerHTML = `
      <div class="totp-recovery-section">
        <div class="totp-status-icon totp-enabled" style="margin-bottom:12px">
          <svg viewBox="0 0 24 24" width="48" height="48" fill="currentColor">
            <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm-2 16l-4-4 1.41-1.41L10 14.17l6.59-6.59L18 9l-8 8z"/>
          </svg>
        </div>
        <h3 style="color:var(--text);margin:0 0 8px;text-align:center">${t('totpSetupComplete')}</h3>
        <p style="color:var(--subtext);font-size:14px;line-height:1.5;text-align:center;margin-bottom:16px">${t('totpRecoveryDesc')}</p>

        <div class="totp-recovery-grid">
          ${codes.map((c, i) => `<div class="totp-recovery-code"><span class="totp-recovery-num">${i + 1}</span>${c}</div>`).join('')}
        </div>

        <div style="display:flex;gap:8px;margin-top:16px">
          <button class="auth-btn totp-secondary-btn" id="totp-copy-codes" style="flex:1">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" style="margin-right:4px"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>
            ${t('copyRecoveryCodes')}
          </button>
        </div>

        <button class="auth-btn" id="totp-done-btn" style="width:100%;margin-top:12px">${t('totpDone')}</button>

        <p class="totp-recovery-warning">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" style="margin-right:4px;vertical-align:-2px"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg>
          ${t('totpRecoveryWarning')}
        </p>
      </div>
    `;

    content.querySelector('#totp-copy-codes').onclick = () => {
      const text = codes.join('\n');
      navigator.clipboard?.writeText(text).then(() => showToast(t('copied') || 'Copied'));
    };

    content.querySelector('#totp-done-btn').onclick = () => {
      const pg = document.createElement('div');
      pg.className = 'page';
      renderProfile(pg);
      appEl.innerHTML = '';
      appEl.appendChild(pg);
    };
  }

  render();
}
