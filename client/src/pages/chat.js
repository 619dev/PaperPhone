/**
 * Chat Window — i18n v2 + full E2E encryption
 */
import { state, avatarEl, goBack, showToast, formatTime } from '../app.js';
import { api } from '../api.js';
import { send, onEvent, offEvent } from '../socket.js';
import { getKey, setKey } from '../crypto/keystore.js';
import { x3dhSend, x3dhReceive, ratchetInit, ratchetEncrypt, ratchetDecrypt } from '../crypto/ratchet.js';
import { t } from '../i18n.js';
import { callManager } from '../services/webrtc.js';

const esc = s => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

export async function renderChat(root, chat) {
  root.innerHTML = '';
  root.style.cssText = 'display:flex;flex-direction:column;height:100dvh;';

  // ── Top bar ──────────────────────────────────────────────────
  const topbar = document.createElement('div');
  topbar.className = 'topbar';
  topbar.innerHTML = `
    <button class="topbar-btn topbar-back" id="back-btn">
      <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
        <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/>
      </svg>
    </button>
    <div class="topbar-title" id="chat-title">${esc(chat.name)}</div>
    <div class="topbar-call-btns">
      <button class="topbar-btn" id="voice-call-btn" title="${t('callVoice')}">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
          <path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.27-.27.67-.36 1.02-.23 1.12.45 2.34.68 3.58.68.55 0 1 .45 1 1V20c0 .55-.45 1-1 1C10.3 21 3 13.7 3 4.5c0-.55.45-1 1-1H8c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.1.35.02.74-.22 1.02L6.6 10.8z"/>
        </svg>
      </button>
      ${chat.type === 'private' ? `
      <button class="topbar-btn" id="video-call-btn" title="${t('callVideo')}">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
          <path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/>
        </svg>
      </button>` : ''}
    </div>
  `;
  root.appendChild(topbar);
  topbar.querySelector('#back-btn').onclick = goBack;

  // Call buttons
  topbar.querySelector('#voice-call-btn').onclick = async () => {
    if (callManager.state !== 'idle') { showToast(t('callBusy')); return; }
    try {
      await callManager.startCall({
        peerId: chat.id, name: chat.name, avatar: chat.avatar,
        isVideo: false,
        isGroup: chat.type === 'group', groupId: chat.id,
        peerIds: chat.type === 'group' ? (state.contacts.map(c => c.id)) : [],
      });
    } catch (err) { showToast(t('callMediaFailed') + ': ' + err.message); }
  };
  topbar.querySelector('#video-call-btn')?.addEventListener('click', async () => {
    if (callManager.state !== 'idle') { showToast(t('callBusy')); return; }
    try {
      await callManager.startCall({
        peerId: chat.id, name: chat.name, avatar: chat.avatar,
        isVideo: true, isGroup: false,
      });
    } catch (err) { showToast(t('callMediaFailed') + ': ' + err.message); }
  });

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
    <button class="input-toolbar-btn" id="mic-btn" title="${t('voiceHint')}">
      <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
        <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.91-3c-.49 0-.9.36-.98.85A6.01 6.01 0 0 1 11 17.92V20H9v-2.08A6.01 6.01 0 0 1 3.07 11.85c-.08-.49-.49-.85-.97-.85-.61 0-1.07.54-.98 1.14C1.78 16.47 5.5 20 10 20.93V22h4v-1.07c4.5-.93 8.22-4.46 8.88-9A1 1 0 0 0 17.91 11z"/>
      </svg>
    </button>
    <textarea id="chat-input" rows="1" placeholder="${t('inputPlaceholder')}" aria-label="${t('inputPlaceholder')}"></textarea>
    <button class="input-toolbar-btn" id="emoji-btn" title="Emoji">
      <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
        <path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm3.5-9c.83 0 1.5-.67 1.5-1.5S16.33 8 15.5 8 14 8.67 14 9.5s.67 1.5 1.5 1.5zm-7 0c.83 0 1.5-.67 1.5-1.5S9.33 8 8.5 8 7 8.67 7 9.5 7.67 11 8.5 11zm3.5 6.5c2.33 0 4.31-1.46 5.11-3.5H6.89c.8 2.04 2.78 3.5 5.11 3.5z"/>
      </svg>
    </button>
    <button class="input-toolbar-btn" id="img-btn" title="${t('uploading')}">
      <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
        <path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/>
      </svg>
    </button>
    <button class="send-btn hidden" id="send-btn" aria-label="${t('inputPlaceholder')}">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
        <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
      </svg>
    </button>
    <input type="file" id="file-input" accept="image/*,audio/*,video/*" class="hidden">
  `;
  root.appendChild(toolbar);

  // ── Session state ─────────────────────────────────────────────
  let ratchetState = await getKey(`session_${chat.id}`);

  // ── Render bubble ─────────────────────────────────────────────
  let _msgIdMap = {};  // msgId -> row element (for ack updates)

  function addBubble(text, fromMe, ts, msgType = 'text', extra = {}) {
    const row = document.createElement('div');
    row.className = `msg-row ${fromMe ? 'out' : 'in'}`;
    if (extra.msgId) _msgIdMap[extra.msgId] = row;

    let content = '';
    if (msgType === 'image') {
      content = `<img class="bubble-image" src="${esc(extra.url || text)}" alt="image">`;
    } else if (msgType === 'voice') {
      content = `<div class="bubble-voice">
        <button class="voice-play-btn" data-src="${esc(extra.url || text)}">▶</button>
        <span class="voice-dur">${extra.duration || '?'}″</span>
      </div>`;
    } else {
      content = esc(text);
    }

    if (!fromMe) row.appendChild(avatarEl(chat.name, chat.avatar, 'avatar-sm'));
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.innerHTML = content;

    if (msgType === 'image') {
      bubble.querySelector('.bubble-image').addEventListener('click', e => showImageViewer(e.target.src));
    }
    if (msgType === 'voice') {
      bubble.querySelector('.voice-play-btn').addEventListener('click', e => {
        const audio = new Audio(e.currentTarget.dataset.src);
        audio.play();
      });
    }

    row.appendChild(bubble);

    // Timestamp + status
    const timeEl = document.createElement('div');
    timeEl.className = `bubble-ts${fromMe ? ' bubble-ts-out' : ''}`;
    const d = ts ? new Date(ts) : new Date();
    timeEl.textContent = d.toTimeString().slice(0, 5);
    if (fromMe) {
      const statusEl = document.createElement('span');
      statusEl.className = 'msg-status msg-status-sent';
      statusEl.textContent = '✓';
      if (extra.msgId) statusEl.dataset.ackId = extra.msgId;
      timeEl.appendChild(statusEl);
    }
    row.appendChild(timeEl);

    msgArea.appendChild(row);
    msgArea.scrollTop = msgArea.scrollHeight;
  }

  // ── Load history ──────────────────────────────────────────────
  try {
    const history = chat.type === 'group'
      ? await api.groupHistory(chat.id)
      : await api.privateHistory(chat.id);

    for (const row of history) {
      const fromMe = row.from_id === state.user.id;
      let text = t('encryptedMsg');
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

  // ── Init session ──────────────────────────────────────────────
  async function ensureSession() {
    if (ratchetState || chat.type !== 'private') return;
    try {
      await window._sodiumPromise;
      const bundle = await api.prekeys(chat.id);
      const ik = await getKey('ik');
      const { sharedSecret, header: x3dhHeader } = await x3dhSend(ik, bundle);
      ratchetState = await ratchetInit(sharedSecret, 'sender');
      ratchetState._x3dhHeader = x3dhHeader;
      await setKey(`session_${chat.id}`, ratchetState);
    } catch (err) {
      showToast(t('sessionFailed') + ': ' + err.message);
    }
  }

  // ── Send message ──────────────────────────────────────────────
  async function sendMessage(text, msgType = 'text') {
    if (!text.trim() && msgType === 'text') return;
    await ensureSession();

    let ciphertext = text, header = null, msgId = crypto.randomUUID();
    if (ratchetState) {
      try {
        const res = await ratchetEncrypt(ratchetState, text);
        ciphertext = res.ciphertext;
        header = JSON.stringify({ ...res.header, ...(ratchetState._x3dhHeader || {}) });
        ratchetState = res.newState;
        ratchetState._x3dhHeader = null;
        await setKey(`session_${chat.id}`, ratchetState);
      } catch (err) { showToast(t('encFailed') + ': ' + err.message); return; }
    }

    addBubble(text, true, Date.now(), msgType, { msgId });
    send({
      type: 'message',
      to: chat.type === 'private' ? chat.id : undefined,
      group_id: chat.type === 'group' ? chat.id : undefined,
      msg_type: msgType, ciphertext, header,
      client_id: msgId,
    });
    const c = state.chats.find(s => s.id === chat.id);
    if (c) { c.lastMsg = msgType === 'text' ? text : t('imageLabel'); c.lastTs = Date.now(); }
  }

  // ── Input events ──────────────────────────────────────────────
  const inputEl = toolbar.querySelector('#chat-input');
  const sendBtn = toolbar.querySelector('#send-btn');
  const emojiBtn = toolbar.querySelector('#emoji-btn');
  const imgBtn = toolbar.querySelector('#img-btn');
  const fileInput = toolbar.querySelector('#file-input');

  inputEl.addEventListener('input', () => {
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(inputEl.scrollHeight, 130) + 'px';
    const hasText = !!inputEl.value.trim();
    sendBtn.classList.toggle('hidden', !hasText);
    emojiBtn.classList.toggle('hidden', hasText);
    // Send typing indicator (debounced)
    clearTimeout(inputEl._typingTimer);
    if (hasText) {
      send({ type: 'typing',
        to: chat.type === 'private' ? chat.id : undefined,
        group_id: chat.type === 'group' ? chat.id : undefined,
      });
      inputEl._typingTimer = setTimeout(() => {}, 3000);
    }
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

  // Image upload
  imgBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    try {
      showToast(t('uploading'));
      const { url } = await api.upload(file);
      const isImg = file.type.startsWith('image');
      addBubble(url, true, Date.now(), isImg ? 'image' : 'file', { url });
      send({ type: 'message', to: chat.type === 'private' ? chat.id : undefined,
        group_id: chat.type === 'group' ? chat.id : undefined,
        msg_type: isImg ? 'image' : 'file', ciphertext: url, header: null });
    } catch { showToast(t('uploadFailed')); }
    fileInput.value = '';
  });

  // Voice recording
  let mediaRec, recChunks = [], recStart, voiceOverlay = null;
  const micBtn = toolbar.querySelector('#mic-btn');
  micBtn.addEventListener('mousedown', startVoice);
  micBtn.addEventListener('touchstart', e => { e.preventDefault(); startVoice(); }, { passive: false });
  document.addEventListener('mouseup', stopVoice);
  document.addEventListener('touchend', stopVoice);

  async function startVoice() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRec = new MediaRecorder(stream);
      recChunks = []; recStart = Date.now();
      mediaRec.ondataavailable = e => recChunks.push(e.data);
      mediaRec.start();
      voiceOverlay = document.createElement('div');
      voiceOverlay.className = 'voice-overlay';
      voiceOverlay.innerHTML = `<div class="voice-pulse">🎙</div><p>${t('voiceHint')}</p>`;
      document.body.appendChild(voiceOverlay);
    } catch { showToast(t('micFailed')); }
  }
  async function stopVoice() {
    if (!mediaRec || mediaRec.state === 'inactive') return;
    mediaRec.stop();
    voiceOverlay?.remove(); voiceOverlay = null;
    const duration = Math.round((Date.now() - recStart) / 1000);
    mediaRec.onstop = async () => {
      const blob = new Blob(recChunks, { type: 'audio/webm' });
      const file = new File([blob], `voice_${Date.now()}.webm`, { type: 'audio/webm' });
      try {
        showToast(t('sendingVoice'));
        const { url } = await api.upload(file);
        addBubble(url, true, Date.now(), 'voice', { url, duration });
        send({ type: 'message', to: chat.type === 'private' ? chat.id : undefined,
          group_id: chat.type === 'group' ? chat.id : undefined,
          msg_type: 'voice', ciphertext: url, header: null });
      } catch { showToast(t('uploadFailed')); }
    };
    mediaRec.stream.getTracks().forEach(t => t.stop());
  }

  // Emoji picker
  const EMOJIS = [
    // Smileys
    '😊','😂','🥰','😎','😭','😅','😇','🤣','😍','😘','🥳','😁','🤗','😜','🤩','🥺',
    // Gestures / People
    '👍','👎','👏','🙌','🙏','💪','🤝','✌️','🤙','🫶','❤️','💔','💕','💯','🔥','✨',
    // Objects / Nature
    '🎉','🎊','🎁','🎈','🎶','🎵','📸','💡','🌟','⭐','🌈','☀️','🌙','❄️','🍕','🍜',
    // Symbols
    '😈','👻','🤖','💩','🐱','🐶','🌸','🌺','🍀','🦋','💎','🚀','⚡','🌊','🏆','🎯',
  ];
  const EMOJI_LABELS = ['😊', '👍', '🎉', '😈'];
  let emojiPanel = null;
  emojiBtn.addEventListener('click', () => {
    if (emojiPanel) { emojiPanel.remove(); emojiPanel = null; return; }
    emojiPanel = document.createElement('div');
    // Toolbar is at the bottom; place the panel just above it
    const toolbarRect = toolbar.getBoundingClientRect();
    emojiPanel.style.cssText = `
      position:fixed;
      bottom:${window.innerHeight - toolbarRect.top}px;
      left:0;right:0;
      background:var(--surface);
      border-top:.5px solid var(--border);
      padding:8px 12px 12px;
      z-index:200;
      box-shadow:var(--shadow-lg);
      max-height:180px;
      overflow-y:auto;
    `;
    // Category tabs (simple labels)
    const cats = document.createElement('div');
    cats.style.cssText = 'display:flex;gap:8px;margin-bottom:8px;overflow-x:auto;';
    const all = ['all', ...EMOJI_LABELS];
    const rows = [EMOJIS.slice(0,16), EMOJIS.slice(16,32), EMOJIS.slice(32,48), EMOJIS.slice(48)];
    all.forEach((lbl, i) => {
      const btn = document.createElement('button');
      btn.textContent = i === 0 ? '⊞' : lbl;
      btn.style.cssText = 'background:var(--surface-2);border:none;border-radius:8px;padding:4px 8px;font-size:14px;cursor:pointer;';
      btn.onclick = () => {
        grid.innerHTML = '';
        const subset = i === 0 ? EMOJIS : rows[i - 1];
        subset.forEach(em => addEmojiBtn(em));
      };
      cats.appendChild(btn);
    });
    emojiPanel.appendChild(cats);
    const grid = document.createElement('div');
    grid.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;';
    function addEmojiBtn(em) {
      const btn = document.createElement('button');
      btn.textContent = em;
      btn.style.cssText = 'background:none;border:none;font-size:26px;cursor:pointer;padding:4px;border-radius:8px;line-height:1;';
      btn.onclick = () => { inputEl.value += em; inputEl.dispatchEvent(new Event('input')); emojiPanel.remove(); emojiPanel = null; };
      grid.appendChild(btn);
    }
    EMOJIS.forEach(em => addEmojiBtn(em));
    emojiPanel.appendChild(grid);
    document.body.appendChild(emojiPanel);
  });

  // ── Incoming messages ─────────────────────────────────────────
  async function handleIncoming(msg) {
    const matchId = msg.group_id || msg.from;
    if (matchId !== chat.id) return;

    let text = t('encryptedMsg');
    if (ratchetState && msg.ciphertext) {
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
    // Update chat list last message time
    const c = state.chats.find(s => s.id === chat.id);
    if (c) c.lastTs = msg.ts;
  }

  onEvent('message', handleIncoming);

  // Handle ack — mark message as delivered
  onEvent('ack', ({ msg_id }) => {
    const statusEl = document.querySelector(`[data-ack-id="${CSS.escape(msg_id)}"]`);
    if (statusEl) {
      statusEl.textContent = '✓✓';
      statusEl.classList.replace('msg-status-sent', 'msg-status-delivered');
    }
  });

  let typingTimer;
  onEvent('typing', ({ from }) => {
    if (from !== chat.id) return;
    typingEl.classList.remove('hidden');
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => typingEl.classList.add('hidden'), 3000);
  });

  root._cleanup = () => {
    offEvent('message', handleIncoming);
    clearTimeout(typingTimer);
    voiceOverlay?.remove();
    if (emojiPanel) { emojiPanel.remove(); emojiPanel = null; }
    document.removeEventListener('mouseup', stopVoice);
    document.removeEventListener('touchend', stopVoice);
  };
}

function showImageViewer(src) {
  const viewer = document.createElement('div');
  viewer.className = 'img-viewer';
  viewer.innerHTML = `
    <div class="img-viewer-close">✕</div>
    <img src="${src}" alt="image">
  `;
  viewer.querySelector('.img-viewer-close').onclick = () => viewer.remove();
  viewer.onclick = e => { if (e.target === viewer) viewer.remove(); };
  document.body.appendChild(viewer);
}
