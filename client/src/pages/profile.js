/**
 * Profile / Settings page — i18n v2
 */
import { state, showToast, avatarEl } from '../app.js';
import { api, clearToken } from '../api.js';
import { disconnect } from '../socket.js';
import { t, getLang, getLangName, getLangFlag, getSupportedLangs, setLang, onLangChange, offLangChange } from '../i18n.js';

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
        <div id="av-wrap"></div>
        <div class="profile-info">
          <div class="profile-name">${esc(u.nickname || u.username)}</div>
          <div class="profile-username">@${esc(u.username)}</div>
          <div class="profile-enc-badge">🔐 E2E</div>
        </div>
        <span class="profile-arrow">›</span>
      </div>

      <!-- Settings groups -->
      <div class="section-header" style="padding-top:12px"></div>

      <div class="card-group" id="g-identity">
        <div class="settings-item" id="change-nickname">
          <div class="settings-icon" style="background:#07C160">✏️</div>
          <span class="settings-label">${t('changeNickname')}</span>
          <span class="settings-value" id="cur-nickname">${esc(u.nickname || u.username)}</span>
          <span class="settings-chevron">›</span>
        </div>
      </div>

      <div class="card-group" id="g-security">
        <div class="settings-item">
          <div class="settings-icon" style="background:#007AFF">🔒</div>
          <span class="settings-label">${t('e2eLabel')}</span>
          <span class="settings-value">${t('e2eValue')}</span>
        </div>
        <div class="settings-item">
          <div class="settings-icon" style="background:#AF52DE">⚛️</div>
          <span class="settings-label">${t('pqLabel')}</span>
          <span class="settings-value">${t('pqValue')}</span>
        </div>
        <div class="settings-item" id="export-keys">
          <div class="settings-icon" style="background:#FF9500">🗝️</div>
          <span class="settings-label">${t('keyFingerprint')}</span>
          <span class="settings-chevron">›</span>
        </div>
      </div>

      <div class="card-group" id="g-prefs">
        <div class="settings-item" id="lang-btn">
          <div class="settings-icon" style="background:#34C759">${getLangFlag(getLang())}</div>
          <span class="settings-label">${t('language')}</span>
          <span class="settings-value">${getLangName(getLang())}</span>
          <span class="settings-chevron">›</span>
        </div>
        <div class="settings-item">
          <div class="settings-icon" style="background:#636366">📦</div>
          <span class="settings-label">${t('version')}</span>
          <span class="settings-value">PaperPhone v1.1</span>
        </div>
        <div class="settings-item" id="pwa-install">
          <div class="settings-icon" style="background:#FF3B30">📱</div>
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
          ${code === getLang() ? '<span class="lang-check">✓</span>' : ''}
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
