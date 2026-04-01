/**
 * Upload Progress Ring — reusable circular percentage indicator
 * 
 * Usage:
 *   import { showUploadRing, updateUploadRing, hideUploadRing } from './uploadProgress.js';
 * 
 *   const ring = showUploadRing();                  // show fullscreen overlay
 *   const ring = showUploadRing(containerEl);       // show inside a specific element
 *   const ring = showUploadRing(null, '上传中...');  // custom label
 *   updateUploadRing(ring, 42);                     // set to 42%
 *   updateUploadRing(ring, 100, '完成!');            // update with new label
 *   hideUploadRing(ring);                           // dismiss
 */

const RING_SIZE = 72;
const RING_STROKE = 5;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRCUM = 2 * Math.PI * RING_RADIUS;

/**
 * Show a circular upload progress ring.
 * @param {HTMLElement|null} container — if null, creates a fullscreen overlay
 * @param {string} label — optional label text below the ring
 * @returns {HTMLElement} the ring element (pass to update/hide)
 */
export function showUploadRing(container = null, label = '') {
  const el = document.createElement('div');
  el.className = container ? 'upload-ring-inline' : 'upload-ring-overlay';
  el.innerHTML = `
    <div class="upload-ring-content">
      <div class="upload-ring-circle">
        <svg viewBox="0 0 ${RING_SIZE} ${RING_SIZE}" width="${RING_SIZE}" height="${RING_SIZE}">
          <circle class="upload-ring-bg"
            cx="${RING_SIZE/2}" cy="${RING_SIZE/2}" r="${RING_RADIUS}"
            fill="none" stroke-width="${RING_STROKE}"/>
          <circle class="upload-ring-fg"
            cx="${RING_SIZE/2}" cy="${RING_SIZE/2}" r="${RING_RADIUS}"
            fill="none" stroke-width="${RING_STROKE}"
            stroke-dasharray="${RING_CIRCUM}"
            stroke-dashoffset="${RING_CIRCUM}"
            stroke-linecap="round"
            transform="rotate(-90 ${RING_SIZE/2} ${RING_SIZE/2})"/>
        </svg>
        <span class="upload-ring-pct">0%</span>
      </div>
      ${label ? `<div class="upload-ring-label">${label}</div>` : ''}
    </div>
  `;

  if (container) {
    // Position relative to container
    container.style.position = 'relative';
    container.appendChild(el);
  } else {
    document.body.appendChild(el);
  }

  // Animate entrance
  requestAnimationFrame(() => el.classList.add('upload-ring-visible'));
  return el;
}

/**
 * Update the ring progress value.
 * @param {HTMLElement} ring — returned by showUploadRing
 * @param {number} pct — 0..100
 * @param {string} [newLabel] — optionally update label text
 */
export function updateUploadRing(ring, pct, newLabel) {
  if (!ring) return;
  const clamped = Math.max(0, Math.min(100, pct));
  const offset = RING_CIRCUM - (clamped / 100) * RING_CIRCUM;

  const fg = ring.querySelector('.upload-ring-fg');
  if (fg) fg.style.strokeDashoffset = offset;

  const pctEl = ring.querySelector('.upload-ring-pct');
  if (pctEl) pctEl.textContent = `${Math.round(clamped)}%`;

  if (newLabel !== undefined) {
    const lbl = ring.querySelector('.upload-ring-label');
    if (lbl) lbl.textContent = newLabel;
  }
}

/**
 * Dismiss the ring (with a short exit animation).
 * @param {HTMLElement} ring
 */
export function hideUploadRing(ring) {
  if (!ring) return;
  ring.classList.remove('upload-ring-visible');
  ring.classList.add('upload-ring-hide');
  setTimeout(() => ring.remove(), 300);
}

/**
 * Convenience: Upload a file with a fullscreen progress ring.
 * Returns the upload result (e.g. { url, name, size, type }).
 * @param {import('./api.js').api} apiObj
 * @param {File} file
 * @param {string} [label]
 * @returns {Promise<any>}
 */
export async function uploadFileWithRing(apiObj, file, label = '') {
  const ring = showUploadRing(null, label);
  try {
    const res = await apiObj.uploadWithProgress(file, pct => {
      updateUploadRing(ring, pct);
    });
    updateUploadRing(ring, 100);
    await new Promise(r => setTimeout(r, 200)); // brief flash of 100%
    hideUploadRing(ring);
    return res;
  } catch (e) {
    hideUploadRing(ring);
    throw e;
  }
}
