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
          <div class="discover-icon" style="background:linear-gradient(135deg,#0BD46A,#07C160)"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="4"/><line x1="21.17" y1="8" x2="12" y2="8"/><line x1="3.95" y1="6.06" x2="8.54" y2="14"/><line x1="10.88" y1="21.94" x2="15.46" y2="14"/></svg></div>
          <span class="discover-label">${t('moments')}</span>
          <span class="discover-chevron"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg></span>
        </div>
      </div>
    </div>
  `;

  root.querySelector('#moments-item').addEventListener('click', () => {
    renderMoments(root);
  });
}
