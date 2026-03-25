/**
 * Chat Window — full screen with E2E encrypted messaging
 */
import { state, avatarEl, goBack, showToast, formatTime } from '../app.js';
import { api } from '../api.js';
import { send, onEvent, offEvent } from '../socket.js';
import { getKey, setKey } from '../crypto/keystore.js';
import {
  x3dhSend, x3dhReceive, ratchetInit, ratchetEncrypt, ratchetDecrypt
} from '../crypto/ratchet.js';

const esc = s => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

export async function renderChat(root, chat) {
  root.innerHTML = '';
  root.style.display = 'flex';
  root.style.flexDirection = 'column';
  root.style.height = '100dvh';

  // ── Top bar ─────────────────────────────────────────────────
  const topbar = document.createElement('div');
  topbar.className = 'topbar';
  topbar.innerHTML = `
    <button class="topbar-btn topbar-back" id="back-btn">
      <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>
      返回
    </button>
    <div class="topbar-title" id="chat-title">${esc(chat.name)}</div>
    <div class="topbar-action" style="min-width:44px"></div>
  `;
  root.appendChild(topbar);
  topbar.querySelector('#back-btn').onclick = goBack;

  // ── Messages area ────────────────────────────────────────────
  const msgArea = document.createElement('div');
  msgArea.className = 'chat-messages';
  root.appendChild(msgArea);

  // ── Typing indicator ─────────────────────────────────────────
  const typingEl = document.createElement('div');
  typingEl.className = 'typing-indicator hidden';
  typingEl.innerHTML = `<div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div>`;
  root.appendChild(typingEl);

  // ── Input toolbar ─────────────────────────────────────────────
  const toolbar = document.createElement('div');
  toolbar.className = 'input-toolbar';
  toolbar.innerHTML = `
    <button class="input-toolbar-btn" id="mic-btn" title="语音">🎙</button>
    <textarea id="chat-input" rows="1" placeholder="发送消息..." aria-label="消息输入框"></textarea>
    <button class="input-toolbar-btn" id="emoji-btn" title="表情">😊</button>
    <button class="input-toolbar-btn" id="img-btn" title="图片">🖼</button>
    <button class="send-btn hidden" id="send-btn" aria-label="发送">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
    </button>
    <input type="file" id="file-input" accept="image/*,audio/*,video/*" class="hidden">
  `;
  root.appendChild(toolbar);

  // ── Session state ─────────────────────────────────────────────
  let ratchetState = await getKey(`session_${chat.id}`);

  // ── Render a message bubble ───────────────────────────────────
  function addBubble(text, fromMe, ts, msgType = 'text', extra = {}) {
    const row = document.createElement('div');
    row.className = `msg-row ${fromMe ? 'out' : 'in'}`;

    let content = '';
    if (msgType === 'image') {
      content = `<img class="bubble-image" src="${esc(extra.url || text)}" alt="图片">`;
    } else if (msgType === 'voice') {
      content = `<div class="bubble-voice">
        <span class="voice-icon" data-src="${esc(extra.url || text)}">🔊</span>
        <span class="voice-dur">${extra.duration || '?'}″</span>
      </div>`;
    } else {
      content = esc(text);
    }

    if (!fromMe) {
      const av = avatarEl(chat.name, chat.avatar, 'avatar-sm');
      row.appendChild(av);
    }
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.innerHTML = content;

    if (msgType === 'image') {
      bubble.querySelector('.bubble-image').addEventListener('click', e => showImageViewer(e.target.src));
    }
    if (msgType === 'voice') {
      bubble.querySelector('.voice-icon').addEventListener('click', e => {
        const audio = new Audio(e.target.dataset.src);
        audio.play();
      });
    }

    row.appendChild(bubble);
    msgArea.appendChild(row);
    msgArea.scrollTop = msgArea.scrollHeight;
  }

  // ── Load history (ciphertext decoded client-side) ─────────────
  try {
    const history = chat.type === 'group'
      ? await api.groupHistory(chat.id)
      : await api.privateHistory(chat.id);

    for (const row of history) {
      const fromMe = row.from_id === state.user.id;
      let text = '🔒 加密消息';
      if (ratchetState) {
        try {
          const res = await ratchetDecrypt(ratchetState, row.ciphertext, JSON.parse(row.header || '{}'));
          text = res.plaintext;
          ratchetState = res.newState;
        } catch {}
      }
      addBubble(text, fromMe, row.created_at, row.msg_type);
    }
    if (ratchetState) await setKey(`session_${chat.id}`, ratchetState);
  } catch {}

  // ── Init session if new chat ──────────────────────────────────
  async function ensureSession() {
    if (ratchetState) return;
    if (chat.type !== 'private') return; // Group: symmetric handled differently

    try {
      await window._sodiumPromise;
      const bundle = await api.prekeys(chat.id);
      const ik = await getKey('ik');
      const { sharedSecret, header: x3dhHeader } = await x3dhSend(ik, bundle);
      ratchetState = await ratchetInit(sharedSecret, 'sender');
      ratchetState._x3dhHeader = x3dhHeader;
      await setKey(`session_${chat.id}`, ratchetState);
    } catch (err) {
      showToast('建立安全通道失败: ' + err.message);
    }
  }

  // ── Send a message ────────────────────────────────────────────
  async function sendMessage(text, msgType = 'text') {
    if (!text.trim() && msgType === 'text') return;
    await ensureSession();

    let ciphertext = text, header = null;
    if (ratchetState) {
      try {
        const res = await ratchetEncrypt(ratchetState, text);
        ciphertext = res.ciphertext;
        header = JSON.stringify({ ...res.header, ...(ratchetState._x3dhHeader || {}) });
        ratchetState = res.newState;
        ratchetState._x3dhHeader = null;
        await setKey(`session_${chat.id}`, ratchetState);
      } catch (err) {
        showToast('加密失败: ' + err.message);
        return;
      }
    }

    addBubble(text, true, Date.now(), msgType);

    send({
      type: 'message',
      to: chat.type === 'private' ? chat.id : undefined,
      group_id: chat.type === 'group' ? chat.id : undefined,
      msg_type: msgType,
      ciphertext,
      header,
    });

    // Update chat list
    const c = state.chats.find(s => s.id === chat.id);
    if (c) { c.lastMsg = msgType === 'text' ? text : '[图片]'; c.lastTs = Date.now(); }
  }

  // ── Send button logic ─────────────────────────────────────────
  const inputEl = toolbar.querySelector('#chat-input');
  const sendBtn = toolbar.querySelector('#send-btn');
  const emojiBtn = toolbar.querySelector('#emoji-btn');
  const imgBtn  = toolbar.querySelector('#img-btn');
  const fileInput = toolbar.querySelector('#file-input');

  inputEl.addEventListener('input', () => {
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + 'px';
    sendBtn.classList.toggle('hidden', !inputEl.value.trim());
    emojiBtn.classList.toggle('hidden', !!inputEl.value.trim());

    // Typing indicator
    send({ type: 'typing', to: chat.type === 'private' ? chat.id : undefined, group_id: chat.type === 'group' ? chat.id : undefined });
  });

  inputEl.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const text = inputEl.value.trim();
      if (text) { sendMessage(text); inputEl.value = ''; inputEl.style.height = 'auto'; sendBtn.classList.add('hidden'); emojiBtn.classList.remove('hidden'); }
    }
  });

  sendBtn.addEventListener('click', () => {
    const text = inputEl.value.trim();
    if (text) { sendMessage(text); inputEl.value = ''; inputEl.style.height = 'auto'; sendBtn.classList.add('hidden'); emojiBtn.classList.remove('hidden'); }
  });

  // ── Image send ────────────────────────────────────────────────
  imgBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    try {
      showToast('上传中...');
      const { url } = await api.upload(file);
      addBubble(url, true, Date.now(), file.type.startsWith('image') ? 'image' : 'file', { url });
      send({ type: 'message', to: chat.type === 'private' ? chat.id : undefined,
        group_id: chat.type === 'group' ? chat.id : undefined,
        msg_type: file.type.startsWith('image') ? 'image' : 'file',
        ciphertext: url, header: null });
    } catch { showToast('上传失败'); }
    fileInput.value = '';
  });

  // ── Voice recording ───────────────────────────────────────────
  let mediaRec, recChunks = [], recStart;
  const micBtn = toolbar.querySelector('#mic-btn');
  let voiceOverlay = null;

  micBtn.addEventListener('mousedown', startVoice);
  micBtn.addEventListener('touchstart', e => { e.preventDefault(); startVoice(); });
  document.addEventListener('mouseup', stopVoice);
  document.addEventListener('touchend', stopVoice);

  async function startVoice() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRec = new MediaRecorder(stream);
      recChunks = [];
      recStart = Date.now();
      mediaRec.ondataavailable = e => recChunks.push(e.data);
      mediaRec.start();
      voiceOverlay = document.createElement('div');
      voiceOverlay.className = 'voice-overlay';
      voiceOverlay.innerHTML = `<div class="voice-pulse">🎙</div><p>松手发送</p>`;
      document.body.appendChild(voiceOverlay);
    } catch { showToast('无法访问麦克风'); }
  }

  async function stopVoice() {
    if (!mediaRec || mediaRec.state === 'inactive') return;
    mediaRec.stop();
    voiceOverlay?.remove();
    const duration = Math.round((Date.now() - recStart) / 1000);
    mediaRec.onstop = async () => {
      const blob = new Blob(recChunks, { type: 'audio/webm' });
      const file = new File([blob], `voice_${Date.now()}.webm`, { type: 'audio/webm' });
      try {
        showToast('发送中...');
        const { url } = await api.upload(file);
        addBubble(url, true, Date.now(), 'voice', { url, duration });
        send({ type: 'message', to: chat.type === 'private' ? chat.id : undefined,
          group_id: chat.type === 'group' ? chat.id : undefined,
          msg_type: 'voice', ciphertext: url, header: null });
      } catch { showToast('语音发送失败'); }
    };
    mediaRec.stream.getTracks().forEach(t => t.stop());
  }

  // ── Emoji picker (simple) ─────────────────────────────────────
  const emojis = ['😊','😂','🥰','😎','👍','🎉','❤️','🔥','😭','🙏','💪','✨','😅','🤣','😍'];
  let emojiPanel = null;
  emojiBtn.addEventListener('click', () => {
    if (emojiPanel) { emojiPanel.remove(); emojiPanel = null; return; }
    emojiPanel = document.createElement('div');
    emojiPanel.style.cssText = `
      position:absolute;bottom:70px;left:0;right:0;background:var(--surface);
      border-top:.5px solid var(--border);padding:12px;
      display:flex;flex-wrap:wrap;gap:8px;z-index:200;`;
    emojis.forEach(em => {
      const btn = document.createElement('button');
      btn.textContent = em;
      btn.style.cssText = 'background:none;border:none;font-size:24px;cursor:pointer;padding:4px;border-radius:6px;';
      btn.onclick = () => { inputEl.value += em; inputEl.dispatchEvent(new Event('input')); };
      emojiPanel.appendChild(btn);
    });
    root.appendChild(emojiPanel);
  });

  // ── Incoming messages ─────────────────────────────────────────
  async function handleIncoming(msg) {
    const matchId = msg.group_id || msg.from;
    if (matchId !== chat.id) return;

    let text = '🔒 加密消息';
    if (ratchetState && msg.ciphertext) {
      // First message — may need X3DH receive
      if (msg.header && !ratchetState.DHr) {
        try {
          const h = JSON.parse(msg.header);
          const ik = await getKey('ik');
          const spk = await getKey('spk');
          const sharedSecret = await x3dhReceive({ ik, spk }, h);
          ratchetState = await ratchetInit(sharedSecret, 'receiver');
          ratchetState.DHr = h.dh || null;
          await setKey(`session_${chat.id}`, ratchetState);
        } catch {}
      }
      try {
        const h = msg.header ? JSON.parse(msg.header) : {};
        const res = await ratchetDecrypt(ratchetState, msg.ciphertext, h);
        text = res.plaintext;
        ratchetState = res.newState;
        await setKey(`session_${chat.id}`, ratchetState);
      } catch {}
    }
    addBubble(text, false, msg.ts, msg.msg_type || 'text');
  }

  onEvent('message', handleIncoming);

  // Typing
  let typingTimer;
  onEvent('typing', ({ from }) => {
    if (from !== chat.id && from !== state.user.id) return;
    typingEl.classList.remove('hidden');
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => typingEl.classList.add('hidden'), 3000);
  });

  // Cleanup on navigate away
  root._cleanup = () => {
    offEvent('message', handleIncoming);
    clearTimeout(typingTimer);
  };
}

function showImageViewer(src) {
  const viewer = document.createElement('div');
  viewer.className = 'img-viewer';
  viewer.innerHTML = `
    <span class="img-viewer-close">✕</span>
    <img src="${src}" alt="图片">
  `;
  viewer.querySelector('.img-viewer-close').onclick = () => viewer.remove();
  viewer.onclick = e => { if (e.target === viewer) viewer.remove(); };
  document.body.appendChild(viewer);
}
