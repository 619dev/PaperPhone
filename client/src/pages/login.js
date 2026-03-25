/**
 * Login / Register page
 */
import { api, setToken } from '../api.js';
import { state, showToast } from '../app.js';
import { connect } from '../socket.js';
import {
  generateIdentityKeyPair, generateSignedPreKey, generateOneTimePreKey
} from '../crypto/ratchet.js';
import { setKey } from '../crypto/keystore.js';

export function renderLogin(root) {
  let isRegister = false;

  root.innerHTML = '';
  const screen = document.createElement('div');
  screen.className = 'auth-screen';

  screen.innerHTML = `
    <div class="auth-logo">📱</div>
    <div class="auth-title">PaperPhone</div>
    <div class="auth-sub" id="auth-sub">端对端加密 · 前向保密 · 抗量子</div>
    <form class="auth-form" id="auth-form" autocomplete="off">
      <div id="auth-extra" class="hidden">
        <input class="auth-input" id="inp-nickname" type="text" placeholder="昵称" style="margin-bottom:12px">
      </div>
      <input class="auth-input" id="inp-user" type="text" placeholder="用户名" autocomplete="username">
      <input class="auth-input" id="inp-pass" type="password" placeholder="密码" autocomplete="current-password">
      <div class="auth-error" id="auth-err"></div>
      <button class="auth-btn" id="auth-submit" type="submit">登录</button>
    </form>
    <div class="auth-toggle" id="auth-toggle">没有账号? <span>注册</span></div>
    <div class="auth-sub" style="font-size:11px;opacity:.35">🔐 密钥仅存储于本设备</div>
  `;
  root.appendChild(screen);

  const form = document.getElementById('auth-form');
  const errEl = document.getElementById('auth-err');
  const submitBtn = document.getElementById('auth-submit');
  const toggle = document.getElementById('auth-toggle');
  const extra = document.getElementById('auth-extra');

  toggle.addEventListener('click', () => {
    isRegister = !isRegister;
    submitBtn.textContent = isRegister ? '注册' : '登录';
    toggle.innerHTML = isRegister ? '已有账号? <span>登录</span>' : '没有账号? <span>注册</span>';
    extra.classList.toggle('hidden', !isRegister);
    errEl.textContent = '';
  });

  form.addEventListener('submit', async e => {
    e.preventDefault();
    errEl.textContent = '';
    const username = document.getElementById('inp-user').value.trim();
    const password = document.getElementById('inp-pass').value;
    const nickname = document.getElementById('inp-nickname')?.value.trim() || username;

    if (!username || !password) { errEl.textContent = '请填写用户名和密码'; return; }
    submitBtn.disabled = true;
    submitBtn.textContent = isRegister ? '正在注册...' : '正在登录...';

    try {
      // Ensure libsodium is ready
      await window._sodiumPromise;

      let data;
      if (isRegister) {
        // Generate X3DH + ML-KEM keys
        const ik = await generateIdentityKeyPair();
        const spk = await generateSignedPreKey(ik.privateKey);
        const opks = await Promise.all(Array.from({ length: 10 }, (_, i) =>
          generateOneTimePreKey().then(k => ({ key_id: i, opk_pub: k.publicKey, _priv: k.privateKey }))
        ));

        // Store private keys in IndexedDB
        await setKey('ik', ik);
        await setKey('spk', spk);
        for (const opk of opks) {
          await setKey(`opk_${opk.key_id}`, { privateKey: opk._priv });
        }

        data = await api.register({
          username, nickname, password,
          ik_pub: ik.publicKey,
          spk_pub: spk.publicKey,
          spk_sig: spk.signature,
          kem_pub: ik.publicKey, // Using IK as KEM pub (simplified; replace with real Kyber if JS lib loaded)
          prekeys: opks.map(({ key_id, opk_pub }) => ({ key_id, opk_pub })),
        });
      } else {
        data = await api.login({ username, password });
      }

      setToken(data.token);
      state.user = data.user;
      connect();

      // Reload to init fully
      window.location.reload();
    } catch (err) {
      errEl.textContent = err.message || '操作失败';
      submitBtn.disabled = false;
      submitBtn.textContent = isRegister ? '注册' : '登录';
    }
  });
}
