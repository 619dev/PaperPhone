/**
 * Moments (朋友圈) Page
 * WeChat-style social feed: text + up to 9 images, likes, comments
 */
import { api } from '../api.js';
import { state, showToast, avatarEl, formatTime } from '../app.js';
import { t } from '../i18n.js';

export function renderMoments(root) {
  root.innerHTML = '';

  // ── Shell ────────────────────────────────────────────────────────────────
  const page = document.createElement('div');
  page.className = 'page-moments';
  page.innerHTML = `
    <div class="topbar moments-topbar">
      <button class="icon-btn" id="moments-back">‹</button>
      <div class="topbar-title">${t('moments')}</div>
      <button class="icon-btn" id="moments-compose">✏️</button>
    </div>
    <div id="moments-feed" class="moments-feed"></div>
    <div id="moments-loading" class="moments-loading" style="display:none">
      <div class="spinner"></div>
    </div>
  `;
  root.appendChild(page);

  const feed = page.querySelector('#moments-feed');
  const loading = page.querySelector('#moments-loading');
  let oldestTs = null;
  let exhausted = false;
  let fetchLock = false;

  // Back button
  page.querySelector('#moments-back').onclick = () => {
    import('../app.js').then(({ state, render }) => {
      state.activeTab = 'discover';
      render ? render() : window.location.reload();
    });
  };

  // Compose button
  page.querySelector('#moments-compose').onclick = () => openCompose();

  // ── Load feed ─────────────────────────────────────────────────────────
  async function loadFeed(append = false) {
    if (fetchLock || exhausted) return;
    fetchLock = true;
    loading.style.display = 'flex';
    try {
      const items = await api.momentsFeed(append ? oldestTs : null);
      if (!append) feed.innerHTML = '';
      if (items.length === 0) {
        exhausted = true;
        if (!append) {
          feed.innerHTML = `<div class="moments-empty">
            <div style="font-size:48px;margin-bottom:12px">🌐</div>
            <div style="color:var(--text-secondary)">${t('noMoments') || '暂无动态，快去发布吧'}</div>
          </div>`;
        }
      } else {
        items.forEach(m => feed.appendChild(buildCard(m)));
        oldestTs = items[items.length - 1].created_at;
        if (items.length < 20) exhausted = true;
      }
    } catch {
      showToast(t('opFailed') || '加载失败');
    } finally {
      fetchLock = false;
      loading.style.display = 'none';
    }
  }

  // infinite scroll
  page.querySelector('#moments-feed').addEventListener('scroll', () => {
    const el = feed;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 200) loadFeed(true);
  }, { passive: true });
  // Listen on window scroll too in case feed isn't scrollable
  const scrollHandler = () => {
    if (root.scrollTop + root.clientHeight >= root.scrollHeight - 200) loadFeed(true);
  };
  root.addEventListener('scroll', scrollHandler, { passive: true });
  root._cleanup = () => root.removeEventListener('scroll', scrollHandler);

  loadFeed();

  // ── Build moment card ──────────────────────────────────────────────────
  function buildCard(m) {
    const isMine = m.user_id === state.user?.id;
    const card = document.createElement('div');
    card.className = 'moment-card';
    card.dataset.id = m.id;

    // Header
    const av = avatarEl(m.nickname || m.username, m.avatar, 'moment-avatar');
    const header = document.createElement('div');
    header.className = 'moment-header';
    header.appendChild(av);
    const meta = document.createElement('div');
    meta.className = 'moment-meta';
    meta.innerHTML = `<div class="moment-name">${m.nickname || m.username}</div>
      <div class="moment-time">${formatTime(new Date(m.created_at).getTime())}</div>`;
    header.appendChild(meta);
    if (isMine) {
      const del = document.createElement('button');
      del.className = 'moment-delete-btn icon-btn';
      del.textContent = '🗑';
      del.title = '删除';
      del.onclick = async () => {
        if (!confirm(t('deleteConfirm') || '确认删除这条动态？')) return;
        try { await api.deleteMoment(m.id); card.remove(); } catch { showToast('删除失败'); }
      };
      header.appendChild(del);
    }
    card.appendChild(header);

    // Text
    if (m.text_content) {
      const txt = document.createElement('div');
      txt.className = 'moment-text';
      txt.textContent = m.text_content;
      card.appendChild(txt);
    }

    // Images grid
    if (m.images && m.images.length > 0) {
      const grid = document.createElement('div');
      grid.className = `moment-images count-${m.images.length}`;
      m.images.forEach((url, i) => {
        const img = document.createElement('img');
        img.src = url;
        img.className = 'moment-img';
        img.loading = 'lazy';
        img.onclick = () => openLightbox(m.images, i);
        grid.appendChild(img);
      });
      card.appendChild(grid);
    }

    // Actions bar
    const actions = document.createElement('div');
    actions.className = 'moment-actions';
    const likeBtn = document.createElement('button');
    likeBtn.className = `moment-like-btn${m.viewerLiked ? ' liked' : ''}`;
    likeBtn.innerHTML = `${m.viewerLiked ? '❤️' : '🤍'} ${m.likes || 0}`;
    likeBtn.onclick = async () => {
      try {
        const r = await api.likeMoment(m.id);
        m.viewerLiked = r.liked;
        m.likes = r.liked ? (m.likes || 0) + 1 : Math.max(0, (m.likes || 0) - 1);
        likeBtn.className = `moment-like-btn${m.viewerLiked ? ' liked' : ''}`;
        likeBtn.innerHTML = `${m.viewerLiked ? '❤️' : '🤍'} ${m.likes}`;
      } catch { showToast('操作失败'); }
    };
    const cmtBtn = document.createElement('button');
    cmtBtn.className = 'moment-comment-btn';
    cmtBtn.textContent = `💬 ${(m.comments || []).length}`;
    actions.appendChild(likeBtn);
    actions.appendChild(cmtBtn);
    card.appendChild(actions);

    // Comments section
    const cmtSection = document.createElement('div');
    cmtSection.className = 'moment-comments';
    renderComments(cmtSection, m, cmtBtn);
    card.appendChild(cmtSection);

    cmtBtn.onclick = () => {
      const inp = cmtSection.querySelector('.moment-comment-input');
      if (inp) inp.focus();
      else {
        const inputRow = buildCommentInput(m, cmtSection, cmtBtn);
        cmtSection.appendChild(inputRow);
        inputRow.querySelector('input').focus();
      }
    };

    return card;
  }

  function renderComments(container, m, cmtBtn) {
    container.querySelectorAll('.moment-comment-item').forEach(e => e.remove());
    (m.comments || []).forEach(c => {
      const row = document.createElement('div');
      row.className = 'moment-comment-item';
      const isMine = c.user_id === state.user?.id;
      row.innerHTML = `<span class="comment-author">${c.nickname || c.username}:</span>
        <span class="comment-text">${c.text_content}</span>
        ${isMine ? `<button class="comment-del-btn icon-btn" data-cid="${c.id}" title="删除">✕</button>` : ''}`;
      if (isMine) {
        row.querySelector('.comment-del-btn').onclick = async () => {
          try {
            await api.deleteComment(m.id, c.id);
            m.comments = m.comments.filter(x => x.id !== c.id);
            row.remove();
            cmtBtn.textContent = `💬 ${m.comments.length}`;
          } catch { showToast('删除失败'); }
        };
      }
      container.appendChild(row);
    });
  }

  function buildCommentInput(m, cmtSection, cmtBtn) {
    const row = document.createElement('div');
    row.className = 'moment-comment-input-row';
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.className = 'moment-comment-input';
    inp.maxLength = 512;
    inp.placeholder = '说点什么...';
    const send = document.createElement('button');
    send.className = 'moment-comment-send';
    send.textContent = '发送';
    send.onclick = async () => {
      const txt = inp.value.trim();
      if (!txt) return;
      try {
        const r = await api.addComment(m.id, txt);
        m.comments = m.comments || [];
        m.comments.push({ id: r.id, user_id: state.user.id, text_content: txt,
          nickname: state.user.nickname, username: state.user.username });
        renderComments(cmtSection, m, cmtBtn);
        cmtBtn.textContent = `💬 ${m.comments.length}`;
        row.remove();
      } catch { showToast('发送失败'); }
    };
    inp.onkeydown = e => { if (e.key === 'Enter') send.click(); };
    row.appendChild(inp);
    row.appendChild(send);
    return row;
  }

  // ── Lightbox ───────────────────────────────────────────────────────────
  function openLightbox(urls, startIndex) {
    let idx = startIndex;
    const overlay = document.createElement('div');
    overlay.className = 'lightbox-overlay';
    const img = document.createElement('img');
    img.className = 'lightbox-img';
    const prev = document.createElement('button');
    prev.className = 'lightbox-btn';  prev.textContent = '‹';
    const next = document.createElement('button');
    next.className = 'lightbox-btn';  next.textContent = '›';
    const close = document.createElement('button');
    close.className = 'lightbox-close';  close.textContent = '✕';
    overlay.append(close, prev, img, next);
    document.body.appendChild(overlay);

    const show = () => { img.src = urls[idx]; prev.style.display = idx > 0 ? '' : 'none'; next.style.display = idx < urls.length - 1 ? '' : 'none'; };
    prev.onclick = () => { idx--; show(); };
    next.onclick = () => { idx++; show(); };
    close.onclick = overlay.onclick = (e) => { if (e.target === overlay || e.target === close) overlay.remove(); };
    show();
  }

  // ── Compose ───────────────────────────────────────────────────────────
  function openCompose() {
    const modal = document.createElement('div');
    modal.className = 'compose-modal';
    modal.innerHTML = `
      <div class="compose-sheet">
        <div class="compose-header">
          <button class="icon-btn" id="compose-cancel">${t('cancel') || '取消'}</button>
          <span style="font-weight:600">${t('newMoment') || '发动态'}</span>
          <button class="icon-btn compose-submit" id="compose-submit" style="color:var(--blue);font-weight:600">${t('publish') || '发布'}</button>
        </div>
        <textarea id="compose-text" class="compose-textarea" maxlength="1024"
          placeholder="${t('momentPlaceholder') || '这一刻，想和大家分享什么...'}"></textarea>
        <div class="compose-char-count"><span id="compose-char-cur">0</span>/1024</div>
        <div id="compose-images" class="compose-images"></div>
        <button id="compose-add-img" class="compose-add-img-btn">
          <span>📷</span><span>${t('addPhoto') || '添加图片'}</span>
        </button>
        <input type="file" id="compose-file-input" accept="image/*" multiple style="display:none">
      </div>
    `;
    document.body.appendChild(modal);

    const textarea = modal.querySelector('#compose-text');
    const charCur = modal.querySelector('#compose-char-cur');
    const imagesDiv = modal.querySelector('#compose-images');
    const fileInput = modal.querySelector('#compose-file-input');
    let uploadedUrls = [];

    textarea.oninput = () => { charCur.textContent = textarea.value.length; };
    modal.querySelector('#compose-cancel').onclick = () => modal.remove();

    // Add images
    modal.querySelector('#compose-add-img').onclick = () => {
      if (uploadedUrls.length >= 9) { showToast('最多选择 9 张图片'); return; }
      fileInput.click();
    };
    fileInput.onchange = async () => {
      const files = Array.from(fileInput.files);
      const remaining = 9 - uploadedUrls.length;
      const toUpload = files.slice(0, remaining);
      for (const file of toUpload) {
        try {
          showToast('上传中...');
          const { url } = await api.upload(file);
          uploadedUrls.push(url);
          const thumb = document.createElement('div');
          thumb.className = 'compose-thumb';
          const img = document.createElement('img');
          img.src = url;
          const rm = document.createElement('button');
          rm.className = 'compose-thumb-rm';
          rm.textContent = '✕';
          rm.onclick = () => { uploadedUrls = uploadedUrls.filter(u => u !== url); thumb.remove(); };
          thumb.append(img, rm);
          imagesDiv.appendChild(thumb);
        } catch { showToast(t('uploadFailed') || '上传失败'); }
      }
      fileInput.value = '';
    };

    // Publish
    modal.querySelector('#compose-submit').onclick = async () => {
      const text = textarea.value.trim();
      if (!text && uploadedUrls.length === 0) { showToast('请输入内容或添加图片'); return; }
      try {
        modal.querySelector('#compose-submit').disabled = true;
        await api.createMoment({ text, images: uploadedUrls });
        modal.remove();
        // Reload feed
        exhausted = false;
        oldestTs = null;
        loadFeed(false);
      } catch { showToast(t('opFailed') || '发布失败'); modal.querySelector('#compose-submit').disabled = false; }
    };
  }
}
