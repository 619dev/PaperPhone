/**
 * Discover page — i18n v2
 */
import { showToast } from '../app.js';
import { t } from '../i18n.js';

export function renderDiscover(root) {
  root.innerHTML = `
    <div class="topbar">
      <div style="min-width:44px"></div>
      <div class="topbar-title">${t('discoverTitle')}</div>
      <div style="min-width:44px"></div>
    </div>
    <div style="padding:16px 0">

      <div class="discover-group">
        <div class="discover-item" data-feature="moments">
          <div class="discover-icon" style="background:#07C160">🌐</div>
          <span class="discover-label">${t('moments')}</span>
          <span class="discover-chevron">›</span>
        </div>
      </div>

      <div class="discover-group">
        <div class="discover-item" data-feature="search">
          <div class="discover-icon" style="background:#007AFF">🔍</div>
          <span class="discover-label">${t('searchFn')}</span>
          <span class="discover-chevron">›</span>
        </div>
        <div class="discover-item" data-feature="news">
          <div class="discover-icon" style="background:#FF9500">📰</div>
          <span class="discover-label">${t('news')}</span>
          <span class="discover-chevron">›</span>
        </div>
      </div>

      <div class="discover-group">
        <div class="discover-item" data-feature="games">
          <div class="discover-icon" style="background:#AF52DE">🎮</div>
          <span class="discover-label">${t('games')}</span>
          <span class="discover-chevron">›</span>
        </div>
        <div class="discover-item" data-feature="nearby">
          <div class="discover-icon" style="background:#FF3B30">📍</div>
          <span class="discover-label">${t('nearby')}</span>
          <span class="discover-chevron">›</span>
        </div>
      </div>

      <div class="discover-group">
        <div class="discover-item" data-feature="shopping">
          <div class="discover-icon" style="background:#34C759">🛍</div>
          <span class="discover-label">${t('shopping')}</span>
          <span class="discover-chevron">›</span>
        </div>
      </div>

    </div>
  `;

  // All items show a coming-soon toast
  root.querySelectorAll('.discover-item').forEach(el => {
    el.addEventListener('click', () => showToast(t('comingSoon')));
  });
}
