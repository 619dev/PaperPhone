/**
 * Login / Register page — i18n v2
 */
import { api, setToken } from '../api.js';
import { state, showToast } from '../app.js';
import { connect } from '../socket.js';
import { generateIdentityKeyPair, generateSignedPreKey, generateOneTimePreKey } from '../crypto/ratchet.js';
import { setKey } from '../crypto/keystore.js';
import { t, getLang, getSupportedLangs, getLangFlag, getLangName, setLang } from '../i18n.js';

export function renderLogin(root) {
  let isRegister = false;

  function build() {
    root.innerHTML = '';
    const screen = document.createElement('div');
    screen.className = 'auth-screen';

    screen.innerHTML = `
      <div class="auth-logo-wrap">
        <img src="/public/icons/icon-192.png" alt="PaperPhone"
          style="width:56px;height:56px;border-radius:12px;object-fit:cover;"
          onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
        <span style="display:none;font-size:44px">📱</span>
      </div>

      <div class="auth-title">${t('appName')}</div>
      <div class="auth-tagline">${t('appTagline')}</div>

      <form class="auth-form" id="auth-form" autocomplete="off">
        <div class="auth-field" id="field-nickname" class="${isRegister ? '' : 'hidden'}">
          <input class="auth-input" id="inp-nickname" type="text"
            placeholder="${t('nickname')}" autocomplete="nickname">
        </div>
        <div class="auth-field">
          <input class="auth-input" id="inp-user" type="text"
            placeholder="${t('username')}" autocomplete="username">
        </div>
        <div class="auth-field">
          <input class="auth-input" id="inp-pass" type="password"
            placeholder="${t('password')}" autocomplete="current-password">
        </div>
        <div class="auth-error" id="auth-err"></div>
        <button class="auth-btn" id="auth-submit" type="submit">
          ${isRegister ? t('register') : t('login')}
        </button>
      </form>

      <div class="auth-toggle" id="auth-toggle">
        ${isRegister ? t('hasAccount') : t('noAccount')}
        <span>${isRegister ? t('loginLink') : t('registerLink')}</span>
      </div>

      <div class="auth-notice">${t('keyNotice')}</div>

      <div style="position:absolute;top:max(16px,var(--safe-top));right:16px">
        <button id="lang-btn" style="
          background:var(--surface);border:1.5px solid var(--border);
          border-radius:20px;padding:5px 12px;font-size:13px;cursor:pointer;
          color:var(--text);display:flex;align-items:center;gap:6px;
          box-shadow:var(--shadow-sm)">
          ${getLangFlag(getLang())} ${getLangName(getLang())}
        </button>
      </div>
    `;
    root.appendChild(screen);

    // Hide nickname if login mode
    const nickField = screen.querySelector('#field-nickname');
    if (!isRegister) nickField?.classList.add('hidden');

    // Lang picker
    screen.querySelector('#lang-btn').addEventListener('click', () => openLangPicker(build));

    // Toggle login/register
    screen.querySelector('#auth-toggle').addEventListener('click', () => {
      isRegister = !isRegister;
      build();
    });

    // Form submit
    screen.querySelector('#auth-form').addEventListener('submit', async e => {
      e.preventDefault();
      const errEl = document.getElementById('auth-err');
      const submitBtn = document.getElementById('auth-submit');
      errEl.textContent = '';

      const username = document.getElementById('inp-user').value.trim();
      const password = document.getElementById('inp-pass').value;
      const nickname = document.getElementById('inp-nickname')?.value.trim() || username;

      if (!username || !password) { errEl.textContent = t('fillFields'); return; }

      submitBtn.disabled = true;
      submitBtn.textContent = isRegister ? t('registering') : t('loggingIn');

      try {
        await window._sodiumPromise;

        // Step 1: Generate keys
        submitBtn.textContent = t('registering');
        const ik  = await generateIdentityKeyPair();
        const spk = await generateSignedPreKey(ik.privateKey);
        const opks = await Promise.all(
          Array.from({ length: 10 }, (_, i) =>
            generateOneTimePreKey().then(k => ({ key_id: i, opk_pub: k.publicKey, _priv: k.privateKey }))
          )
        );

        // Step 2: Persist keys to IndexedDB and verify they are actually readable
        await setKey('ik', ik);
        await setKey('spk', spk);
        for (const opk of opks) await setKey(`opk_${opk.key_id}`, { privateKey: opk._priv });

        // Verify IK is readable before proceeding (catches silent IndexedDB failures)
        const { getKey } = await import('../crypto/keystore.js');
        const ikVerify = await getKey('ik');
        if (!ikVerify || !ikVerify.privateKey) {
          throw new Error('密钥存储失败，请检查浏览器是否允许存储数据（无痕/隐私模式不支持持久化）');
        }

        const keysPayload = {
          ik_pub: ik.publicKey, spk_pub: spk.publicKey, spk_sig: spk.signature,
          kem_pub: ik.publicKey,
          prekeys: opks.map(({ key_id, opk_pub }) => ({ key_id, opk_pub })),
        };

        // Step 3: Authenticate with server
        let data;
        if (isRegister) {
          data = await api.register({ username, nickname, password, ...keysPayload });
          setToken(data.token);
        } else {
          data = await api.login({ username, password });
          setToken(data.token);
          // Upload new device's keys to server — retry once on failure
          try {
            await api.uploadKeys(keysPayload);
          } catch {
            await new Promise(r => setTimeout(r, 1000));
            await api.uploadKeys(keysPayload);
          }
        }

        state.user = data.user;
        connect();
        // Small delay to ensure all async writes fully flush before reload
        await new Promise(r => setTimeout(r, 300));
        window.location.reload();
      } catch (err) {
        errEl.textContent = err.message || t('opFailed');
        submitBtn.disabled = false;
        submitBtn.textContent = isRegister ? t('register') : t('login');
      }
    });
  }

  build();
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

export { openLangPicker };
