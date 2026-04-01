/**
 * Timeline page — Xiaohongshu-style public feed with masonry layout
 */
import { t } from '../i18n.js';
import { api } from '../api.js';
import { showUploadRing, updateUploadRing, hideUploadRing } from '../uploadProgress.js';
import { state } from '../app.js';

let _root, _posts = [], _loading = false, _noMore = false;

export function renderTimeline(root) {
  _root = root;
  _posts = [];
  _loading = false;
  _noMore = false;

  root.innerHTML = `
    <div class="page-timeline">
      <div class="topbar topbar-glass">
        <button class="topbar-back" id="tl-back"><i class="fi fi-rr-arrow-left"></i></button>
        <div class="topbar-title">${t('timeline')}</div>
        <button class="topbar-back" id="tl-compose-btn" style="color:var(--green)">
          <i class="fi fi-rr-plus" style="font-size:20px"></i>
        </button>
      </div>
      <div class="tl-scroll" id="tl-scroll">
        <div class="tl-masonry" id="tl-masonry"></div>
        <div class="tl-load-more" id="tl-load-more" style="display:none">
          <div class="spinner-small"></div>
        </div>
        <div class="tl-empty" id="tl-empty" style="display:none">
          <i class="fi fi-rr-document" style="font-size:48px;opacity:.3"></i>
          <p style="margin-top:12px;color:var(--text-muted)">${t('noTimeline')}</p>
        </div>
      </div>
    </div>
  `;

  root.querySelector('#tl-back').onclick = () => {
    const { renderDiscover } = require('./discover.js');
    renderDiscover(root);
  };
  root.querySelector('#tl-compose-btn').onclick = () => openCompose();

  const scroll = root.querySelector('#tl-scroll');
  scroll.addEventListener('scroll', () => {
    if (_loading || _noMore) return;
    if (scroll.scrollTop + scroll.clientHeight >= scroll.scrollHeight - 300) {
      loadFeed();
    }
  });

  loadFeed();
}

async function loadFeed() {
  if (_loading || _noMore) return;
  _loading = true;
  const loadMore = _root.querySelector('#tl-load-more');
  if (loadMore) loadMore.style.display = 'flex';

  try {
    const before = _posts.length ? _posts[_posts.length - 1].id : null;
    const data = await api.timelineFeed(before);
    if (!data.length || data.length < 20) _noMore = true;
    _posts.push(...data);
    renderCards(data);
    if (!_posts.length) {
      _root.querySelector('#tl-empty').style.display = 'flex';
    }
  } catch (e) {
    console.error('Timeline feed error:', e);
  }
  _loading = false;
  if (loadMore) loadMore.style.display = 'none';
}

function renderCards(newPosts) {
  const grid = _root.querySelector('#tl-masonry');
  if (!grid) return;

  for (const post of newPosts) {
    const card = document.createElement('div');
    card.className = 'tl-card';
    card.dataset.id = post.id;

    const coverUrl = post.cover?.url || '';
    const isVideo = post.cover?.media_type === 'video';
    const thumb = post.cover?.thumbnail || coverUrl;
    const mediaCount = post.media_count || 0;
    const textPreview = post.text_content?.substring(0, 80) || '';
    const nickname = post.is_anonymous ? t('anonymousUser') : (post.nickname || '?');
    const avatar = post.is_anonymous ? null : post.avatar;

    card.innerHTML = `
      <div class="tl-card-cover">
        ${coverUrl ? `<img src="${thumb}" alt="" loading="lazy" onerror="this.style.display='none'">` : `<div class="tl-card-no-cover"><i class="fi fi-rr-document" style="font-size:32px;opacity:.3"></i></div>`}
        ${isVideo ? '<div class="tl-card-play"><i class="fi fi-sr-play"></i></div>' : ''}
        ${mediaCount > 1 ? `<div class="tl-card-count"><i class="fi fi-rr-layers" style="font-size:10px"></i> ${mediaCount}</div>` : ''}
      </div>
      ${textPreview ? `<div class="tl-card-text">${escHtml(textPreview)}</div>` : ''}
      <div class="tl-card-footer">
        <div class="tl-card-user">
          ${avatar ? `<img class="tl-card-avatar" src="${avatar}" alt="">` : `<div class="tl-card-avatar tl-card-avatar-anon"><i class="fi fi-rr-user" style="font-size:10px"></i></div>`}
          <span class="tl-card-nick">${escHtml(nickname)}</span>
        </div>
        <div class="tl-card-like ${post.liked ? 'tl-liked' : ''}">
          <i class="fi ${post.liked ? 'fi-sr-heart' : 'fi-rr-heart'}"></i>
          ${post.like_count || ''}
        </div>
      </div>
    `;

    // Open detail on click
    card.querySelector('.tl-card-cover').onclick = () => openDetail(post.id);
    card.querySelector('.tl-card-text')?.addEventListener('click', () => openDetail(post.id));

    // Like toggle on card
    const likeBtn = card.querySelector('.tl-card-like');
    likeBtn.onclick = async (e) => {
      e.stopPropagation();
      try {
        const res = await api.likeTimelinePost(post.id);
        post.liked = res.liked;
        post.like_count = res.like_count;
        likeBtn.classList.toggle('tl-liked', res.liked);
        likeBtn.innerHTML = `<i class="fi ${res.liked ? 'fi-sr-heart' : 'fi-rr-heart'}"></i> ${res.like_count || ''}`;
      } catch (e) { console.error(e); }
    };

    grid.appendChild(card);
  }
}

// ── Detail View ────────────────────────────────────────────────────────
async function openDetail(postId) {
  try {
    const post = await api.timelineDetail(postId);
    showDetailOverlay(post);
  } catch (e) { console.error(e); }
}

function showDetailOverlay(post) {
  const nickname = post.is_anonymous ? t('anonymousUser') : (post.nickname || '?');
  const avatar = post.is_anonymous ? null : post.avatar;
  const isOwn = post.user_id === state.user?.id || (post.is_anonymous && !post.user_id);
  const realOwn = _posts.find(p => p.id === post.id);

  const overlay = document.createElement('div');
  overlay.className = 'tl-detail-overlay';
  overlay.innerHTML = `
    <div class="tl-detail-sheet">
      <div class="tl-detail-header">
        <button class="tl-detail-close" id="tl-detail-close"><i class="fi fi-rr-cross-small" style="font-size:20px"></i></button>
        <div class="tl-detail-author">
          ${avatar ? `<img class="tl-detail-avatar" src="${avatar}" alt="">` : `<div class="tl-detail-avatar tl-card-avatar-anon"><i class="fi fi-rr-user" style="font-size:12px"></i></div>`}
          <span class="tl-detail-nick">${escHtml(nickname)}</span>
        </div>
        ${isOwn || (realOwn && !realOwn.is_anonymous) ? '' : ''}
      </div>

      <div class="tl-detail-body" id="tl-detail-body">
        ${post.media?.length ? `
          <div class="tl-detail-media-scroll">
            ${post.media.map((m, i) => {
              if (m.media_type === 'video') {
                return `<div class="tl-detail-media-item">
                  <video src="${m.url}" controls playsinline poster="${m.thumbnail || ''}" preload="metadata"></video>
                </div>`;
              }
              return `<div class="tl-detail-media-item">
                <img src="${m.url}" alt="" loading="${i < 3 ? 'eager' : 'lazy'}">
              </div>`;
            }).join('')}
          </div>
          <div class="tl-detail-media-counter">${post.media.length} ${post.media.length > 1 ? 'items' : 'item'}</div>
        ` : ''}

        ${post.text_content ? `<div class="tl-detail-text">${escHtml(post.text_content)}</div>` : ''}

        <div class="tl-detail-meta">
          ${new Date(post.created_at).toLocaleString()}
        </div>

        <div class="tl-detail-actions">
          <button class="tl-detail-action-btn" id="tl-detail-like">
            <i class="fi ${post.liked ? 'fi-sr-heart' : 'fi-rr-heart'}"></i>
            <span>${post.like_count || 0}</span>
          </button>
          <button class="tl-detail-action-btn">
            <i class="fi fi-rr-comment-dots"></i>
            <span>${post.comments?.length || 0}</span>
          </button>
          ${post.user_id === state.user?.id ? `<button class="tl-detail-action-btn tl-detail-delete" id="tl-detail-delete"><i class="fi fi-rr-trash"></i></button>` : ''}
        </div>

        <div class="tl-detail-comments" id="tl-detail-comments">
          ${(post.comments || []).map(c => buildCommentHtml(c)).join('')}
        </div>
      </div>

      <div class="tl-detail-input-bar">
        <input type="text" class="tl-detail-input" id="tl-comment-input" placeholder="${t('addComment') || 'Add a comment...'}" maxlength="512">
        <button class="tl-detail-send" id="tl-comment-send"><i class="fi fi-rr-paper-plane-top"></i></button>
      </div>
    </div>
  `;

  _root.appendChild(overlay);
  setTimeout(() => overlay.classList.add('tl-detail-open'), 10);

  // Close
  overlay.querySelector('#tl-detail-close').onclick = () => {
    overlay.classList.remove('tl-detail-open');
    setTimeout(() => overlay.remove(), 300);
  };
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      overlay.classList.remove('tl-detail-open');
      setTimeout(() => overlay.remove(), 300);
    }
  });

  // Like
  const likeBtn = overlay.querySelector('#tl-detail-like');
  likeBtn.onclick = async () => {
    try {
      const res = await api.likeTimelinePost(post.id);
      post.liked = res.liked;
      post.like_count = res.like_count;
      likeBtn.innerHTML = `<i class="fi ${res.liked ? 'fi-sr-heart' : 'fi-rr-heart'}"></i><span>${res.like_count}</span>`;
      // Update card in grid
      const card = _root.querySelector(`.tl-card[data-id="${post.id}"] .tl-card-like`);
      if (card) {
        card.classList.toggle('tl-liked', res.liked);
        card.innerHTML = `<i class="fi ${res.liked ? 'fi-sr-heart' : 'fi-rr-heart'}"></i> ${res.like_count || ''}`;
      }
    } catch (e) { console.error(e); }
  };

  // Delete
  const delBtn = overlay.querySelector('#tl-detail-delete');
  if (delBtn) {
    delBtn.onclick = async () => {
      if (!confirm(t('deleteConfirm') || 'Delete this post?')) return;
      try {
        await api.deleteTimelinePost(post.id);
        _posts = _posts.filter(p => p.id !== post.id);
        const cardEl = _root.querySelector(`.tl-card[data-id="${post.id}"]`);
        if (cardEl) cardEl.remove();
        overlay.classList.remove('tl-detail-open');
        setTimeout(() => overlay.remove(), 300);
      } catch (e) { console.error(e); }
    };
  }

  // Send comment
  const input = overlay.querySelector('#tl-comment-input');
  const sendBtn = overlay.querySelector('#tl-comment-send');
  sendBtn.onclick = () => sendComment(post, input, overlay);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendComment(post, input, overlay); }
  });
}

async function sendComment(post, input, overlay) {
  const text = input.value.trim();
  if (!text) return;
  try {
    const c = await api.addTimelineComment(post.id, text, false);
    input.value = '';
    const container = overlay.querySelector('#tl-detail-comments');
    container.insertAdjacentHTML('beforeend', buildCommentHtml(c));
    container.scrollTop = container.scrollHeight;
  } catch (e) { console.error(e); }
}

function buildCommentHtml(c) {
  const nick = c.is_anonymous ? t('anonymousUser') : (c.nickname || '?');
  const av = c.is_anonymous ? null : c.avatar;
  const time = new Date(c.created_at).toLocaleString();
  const canDel = c.user_id === state.user?.id;
  return `
    <div class="tl-comment" data-cid="${c.id}">
      <div class="tl-comment-left">
        ${av ? `<img class="tl-comment-avatar" src="${av}" alt="">` : `<div class="tl-comment-avatar tl-card-avatar-anon"><i class="fi fi-rr-user" style="font-size:9px"></i></div>`}
      </div>
      <div class="tl-comment-body">
        <span class="tl-comment-nick">${escHtml(nick)}</span>
        <span class="tl-comment-text">${escHtml(c.text_content)}</span>
        <span class="tl-comment-time">${time}</span>
      </div>
    </div>
  `;
}

// ── Compose Panel ──────────────────────────────────────────────────────
function openCompose() {
  const overlay = document.createElement('div');
  overlay.className = 'tl-compose-overlay';
  overlay.innerHTML = `
    <div class="tl-compose-sheet">
      <div class="tl-compose-header">
        <button class="tl-compose-cancel" id="tl-compose-cancel">${t('cancel') || 'Cancel'}</button>
        <span class="tl-compose-title">${t('newPost')}</span>
        <button class="tl-compose-publish" id="tl-compose-publish">${t('publish') || 'Publish'}</button>
      </div>

      <div class="tl-compose-body">
        <textarea class="tl-compose-text" id="tl-compose-text" placeholder="${t('textPlaceholder')}" maxlength="2000"></textarea>
        <div class="tl-compose-char-count" id="tl-compose-count">0 / 2000</div>

        <div class="tl-compose-media-grid" id="tl-compose-media-grid"></div>
        <button class="tl-compose-add-media" id="tl-compose-add-media">
          <i class="fi fi-rr-plus" style="font-size:20px"></i>
          <span>${t('addMedia')}</span>
          <span class="tl-compose-media-hint">${t('mediaLimit')}</span>
        </button>

        <div class="tl-compose-option">
          <div class="up-toggle-info">
            <div class="up-toggle-label">${t('anonymous')}</div>
            <div class="up-toggle-desc">${t('anonymousDesc')}</div>
          </div>
          <label class="up-toggle-switch">
            <input type="checkbox" class="up-toggle-input" id="tl-compose-anon">
            <span class="up-toggle-slider"></span>
          </label>
        </div>
      </div>

      <input type="file" id="tl-file-input" multiple accept="image/*,video/*" style="display:none">
    </div>
  `;

  _root.appendChild(overlay);
  setTimeout(() => overlay.classList.add('tl-compose-open'), 10);

  const mediaFiles = []; // { file, url, media_type, thumbnail, duration }
  const textarea = overlay.querySelector('#tl-compose-text');
  const charCount = overlay.querySelector('#tl-compose-count');
  const mediaGrid = overlay.querySelector('#tl-compose-media-grid');
  const fileInput = overlay.querySelector('#tl-file-input');

  textarea.addEventListener('input', () => {
    charCount.textContent = `${textarea.value.length} / 2000`;
  });

  // Close
  overlay.querySelector('#tl-compose-cancel').onclick = () => {
    overlay.classList.remove('tl-compose-open');
    setTimeout(() => overlay.remove(), 300);
  };

  // Add media
  overlay.querySelector('#tl-compose-add-media').onclick = () => fileInput.click();
  fileInput.onchange = async () => {
    const files = Array.from(fileInput.files);
    const remaining = 50 - mediaFiles.length;
    const toAdd = files.slice(0, remaining);

    for (const file of toAdd) {
      const isVideo = file.type.startsWith('video/');
      const objUrl = URL.createObjectURL(file);
      const item = { file, localUrl: objUrl, media_type: isVideo ? 'video' : 'image', uploading: false, url: null };

      // Generate thumbnail for video
      if (isVideo) {
        item.thumbnail = await generateVideoThumb(file);
        item.duration = await getVideoDuration(file);
      }

      mediaFiles.push(item);
      renderMediaGrid(mediaGrid, mediaFiles);
    }
    fileInput.value = '';
  };

  // Publish
  overlay.querySelector('#tl-compose-publish').onclick = async () => {
    const text = textarea.value.trim();
    if (!text && !mediaFiles.length) return;

    const publishBtn = overlay.querySelector('#tl-compose-publish');
    publishBtn.disabled = true;
    publishBtn.textContent = '...';

    try {
      // Upload all media files
      const uploadedMedia = [];
      const ring = showUploadRing(null, `0 / ${mediaFiles.length}`);
      for (let i = 0; i < mediaFiles.length; i++) {
        const item = mediaFiles[i];
        updateUploadRing(ring, 0, `${i + 1} / ${mediaFiles.length}`);
        const res = await api.uploadWithProgress(item.file, pct => {
          const overall = ((i + pct / 100) / mediaFiles.length) * 100;
          updateUploadRing(ring, overall, `${i + 1} / ${mediaFiles.length}`);
        });
        uploadedMedia.push({
          url: res.url,
          media_type: item.media_type,
          thumbnail: item.thumbnail || null,
          duration: item.duration || 0,
        });
      }
      hideUploadRing(ring);

      await api.createTimelinePost({
        text_content: text,
        media: uploadedMedia,
        is_anonymous: overlay.querySelector('#tl-compose-anon').checked,
      });

      overlay.classList.remove('tl-compose-open');
      setTimeout(() => overlay.remove(), 300);

      // Refresh feed
      _posts = [];
      _noMore = false;
      const grid = _root.querySelector('#tl-masonry');
      if (grid) grid.innerHTML = '';
      loadFeed();
    } catch (e) {
      console.error('Publish error:', e);
      publishBtn.disabled = false;
      publishBtn.textContent = t('publish') || 'Publish';
    }
  };
}

function renderMediaGrid(container, items) {
  container.innerHTML = items.map((item, i) => `
    <div class="tl-compose-media-item" data-idx="${i}">
      ${item.media_type === 'video'
        ? `<video src="${item.localUrl}" muted></video>`
        : `<img src="${item.localUrl}" alt="">`
      }
      <button class="tl-compose-media-remove" data-idx="${i}"><i class="fi fi-rr-cross-small"></i></button>
      ${item.media_type === 'video' ? '<div class="tl-compose-media-badge"><i class="fi fi-rr-play"></i></div>' : ''}
    </div>
  `).join('');

  container.querySelectorAll('.tl-compose-media-remove').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const idx = Number(btn.dataset.idx);
      URL.revokeObjectURL(items[idx].localUrl);
      items.splice(idx, 1);
      renderMediaGrid(container, items);
    };
  });
}

function generateVideoThumb(file) {
  return new Promise(resolve => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.src = URL.createObjectURL(file);
    video.currentTime = 1;
    video.onloadeddata = () => {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext('2d').drawImage(video, 0, 0);
      resolve(canvas.toDataURL('image/jpeg', 0.7));
      URL.revokeObjectURL(video.src);
    };
    video.onerror = () => resolve(null);
  });
}

function getVideoDuration(file) {
  return new Promise(resolve => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.src = URL.createObjectURL(file);
    video.onloadedmetadata = () => {
      resolve(Math.round(video.duration));
      URL.revokeObjectURL(video.src);
    };
    video.onerror = () => resolve(0);
  });
}

function escHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}
