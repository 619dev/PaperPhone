/**
 * Profile / Settings page
 */
import { state, showToast, avatarEl } from '../app.js';
import { api, clearToken } from '../api.js';
import { disconnect } from '../socket.js';

export function renderProfile(root) {
  const u = state.user;
  root.innerHTML = `
    <div class="topbar">
      <div style="min-width:44px"></div>
      <div class="topbar-title">我</div>
      <div style="min-width:44px"></div>
    </div>

    <div class="profile-card">
      <div id="av-wrap"></div>
      <div class="profile-info">
        <div class="profile-name">${esc(u.nickname || u.username)}</div>
        <div class="profile-sub">@${esc(u.username)}</div>
        <div class="profile-sub" style="margin-top:4px;font-size:11px;color:var(--green)">🔐 端对端加密 · 前向保密</div>
      </div>
      <span style="color:var(--text-muted);font-size:20px">›</span>
    </div>

    <div style="padding:0 0 8px">
      <div class="settings-group">
        <div class="settings-item" id="change-nickname">
          <div class="settings-icon" style="background:#07C160;">✏️</div>
          <span class="settings-label">更改昵称</span>
          <span class="settings-value" id="cur-nickname">${esc(u.nickname || u.username)}</span>
          <span class="settings-chevron">›</span>
        </div>
      </div>

      <div class="settings-group">
        <div class="settings-item">
          <div class="settings-icon" style="background:#1485EE;">🔒</div>
          <span class="settings-label">加密信息</span>
          <span class="settings-value">X3DH + Double Ratchet</span>
        </div>
        <div class="settings-item">
          <div class="settings-icon" style="background:#9B59B6;">⚛️</div>
          <span class="settings-label">抗量子</span>
          <span class="settings-value">ML-KEM-768</span>
        </div>
        <div class="settings-item" id="export-keys">
          <div class="settings-icon" style="background:#F39C12;">🗝️</div>
          <span class="settings-label">查看设备密钥指纹</span>
          <span class="settings-chevron">›</span>
        </div>
      </div>

      <div class="settings-group">
        <div class="settings-item">
          <div class="settings-icon" style="background:#2ECC71;">📦</div>
          <span class="settings-label">版本</span>
          <span class="settings-value">PaperPhone v1.0</span>
        </div>
        <div class="settings-item" id="pwa-install">
          <div class="settings-icon" style="background:#E74C3C;">📱</div>
          <span class="settings-label">添加到主屏幕 (iOS)</span>
          <span class="settings-chevron">›</span>
        </div>
      </div>

      <div class="settings-group" style="margin-top:16px">
        <div class="settings-item" id="logout-btn" style="justify-content:center">
          <span style="color:var(--red);font-size:16px;font-weight:500">退出登录</span>
        </div>
      </div>
    </div>
  `;

  // Avatar
  const avWrap = root.querySelector('#av-wrap');
  avWrap.appendChild(avatarEl(u.nickname || u.username, u.avatar, 'avatar-lg'));

  // Change nickname
  root.querySelector('#change-nickname').onclick = async () => {
    const nn = prompt('请输入新昵称', u.nickname || u.username);
    if (nn && nn.trim()) {
      try {
        await api.updateMe({ nickname: nn.trim() });
        state.user.nickname = nn.trim();
        root.querySelector('#cur-nickname').textContent = nn.trim();
        root.querySelector('.profile-name').textContent = nn.trim();
        showToast('昵称已更新');
      } catch { showToast('更新失败'); }
    }
  };

  // Show key fingerprint
  root.querySelector('#export-keys').onclick = async () => {
    const { getKey } = await import('../crypto/keystore.js');
    const ik = await getKey('ik');
    if (ik) {
      const fp = ik.publicKey.slice(0, 16).replace(/(.{4})/g, '$1 ');
      alert(`密钥指纹 (IK):\n${fp}\n\n⚠️ 与好友核对指纹可以验证无中间人攻击`);
    } else {
      showToast('本地无密钥，请重新登录');
    }
  };

  // iOS PWA install instructions
  root.querySelector('#pwa-install').onclick = () => {
    alert('iOS添加到主屏幕：\n\n1. 用Safari打开本页\n2. 点击底部分享按钮 ⬆️\n3. 选择"添加到主屏幕"\n4. 点击"添加"\n\n之后即可像原生App一样使用，无需企业证书！');
  };

  // Logout
  root.querySelector('#logout-btn').onclick = () => {
    if (!confirm('确定退出登录？')) return;
    clearToken();
    disconnect();
    state.user = null;
    state.chats = [];
    state.contacts = [];
    window.location.reload();
  };
}

function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
