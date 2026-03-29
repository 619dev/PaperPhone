/**
 * Discover page — i18n v2
 */
import { t } from '../i18n.js';
import { state } from '../app.js';
import { renderMoments } from './moments.js';

export function renderDiscover(root) {
  root.innerHTML = `
    <div class="topbar">
      <div style="min-width:44px"></div>
      <div class="topbar-title">${t('discoverTitle')}</div>
      <div style="min-width:44px"></div>
    </div>
    <div style="padding:16px 0">
      <div class="discover-group">
        <div class="discover-item" id="moments-item">
          <div class="discover-icon" style="background:linear-gradient(135deg,#0BD46A,#07C160)"><i class="fi fi-sr-apps" style="color:#fff;font-size:18px"></i></div>
          <span class="discover-label">${t('moments')}</span>
          <span class="discover-chevron"><i class="fi fi-rr-angle-right"></i></span>
        </div>
      </div>
    </div>
  `;

  root.querySelector('#moments-item').addEventListener('click', () => {
    renderMoments(root);
  });
}
