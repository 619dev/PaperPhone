/**
 * QR Scanner — Camera-based QR code scanning using canvas + jsQR-style decoder
 * Also supports scanning from image files.
 */
import { parseQRData } from './qrcode.js';
import { t } from '../i18n.js';

/**
 * Open the full-screen scanner overlay.
 * @param {(result: {type: 'user'|'group', id: string}) => void} onResult — called with parsed QR data
 */
export function openScanner(onResult) {
  // Create overlay
  const overlay = document.createElement('div');
  overlay.className = 'scanner-overlay';
  overlay.innerHTML = `
    <div class="scanner-topbar">
      <button class="scanner-close-btn" id="scanner-close">
        <svg viewBox="0 0 24 24" width="24" height="24" fill="#fff"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
      </button>
      <span class="scanner-title">${t('scanTitle')}</span>
      <button class="scanner-album-btn" id="scanner-album">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="#fff"><path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/></svg>
      </button>
    </div>
    <div class="scanner-viewport">
      <video class="scanner-video" id="scanner-video" autoplay playsinline></video>
      <div class="scanner-frame">
        <div class="scanner-corner scanner-corner-tl"></div>
        <div class="scanner-corner scanner-corner-tr"></div>
        <div class="scanner-corner scanner-corner-bl"></div>
        <div class="scanner-corner scanner-corner-br"></div>
        <div class="scanner-line"></div>
      </div>
      <div class="scanner-hint">${t('scanHint')}</div>
    </div>
    <canvas id="scanner-canvas" style="display:none"></canvas>
    <input type="file" accept="image/*" id="scanner-file-input" style="display:none">
  `;
  document.body.appendChild(overlay);

  const video = overlay.querySelector('#scanner-video');
  const canvas = overlay.querySelector('#scanner-canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const fileInput = overlay.querySelector('#scanner-file-input');
  let stream = null;
  let animFrame = null;
  let closed = false;

  function cleanup() {
    closed = true;
    if (animFrame) cancelAnimationFrame(animFrame);
    if (stream) stream.getTracks().forEach(tr => tr.stop());
    overlay.remove();
  }

  overlay.querySelector('#scanner-close').onclick = cleanup;
  overlay.querySelector('#scanner-album').onclick = () => fileInput.click();

  // ── Album scanning ──────────────────────────────────────────────
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    try {
      const img = await loadImage(file);
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQRDecode(imageData.data, imageData.width, imageData.height);
      if (code) {
        const parsed = parseQRData(code);
        if (parsed) {
          cleanup();
          onResult(parsed);
          return;
        }
      }
      showScannerToast(overlay, t('scanFailed'));
    } catch {
      showScannerToast(overlay, t('scanFailed'));
    }
  });

  // ── Camera scanning ─────────────────────────────────────────────
  (async () => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 480 } }
      });
      video.srcObject = stream;
      await video.play();
      scan();
    } catch {
      showScannerToast(overlay, t('cameraFailed'));
    }
  })();

  function scan() {
    if (closed) return;
    if (video.readyState === video.HAVE_ENOUGH_DATA) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQRDecode(imageData.data, imageData.width, imageData.height);
      if (code) {
        const parsed = parseQRData(code);
        if (parsed) {
          cleanup();
          onResult(parsed);
          return;
        }
      }
    }
    animFrame = requestAnimationFrame(scan);
  }
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

function showScannerToast(overlay, msg) {
  const existing = overlay.querySelector('.scanner-toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.className = 'scanner-toast';
  toast.textContent = msg;
  overlay.appendChild(toast);
  setTimeout(() => toast.remove(), 2500);
}

// ── Minimal jsQR decoder (simplified) ─────────────────────────────────────
// For production quality we dynamically load the jsQR library from CDN
// but provide a fallback that returns null if load fails.
let _jsQR = null;
let _jsQRLoaded = false;

(async () => {
  try {
    // Try to load jsQR from CDN
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js';
    script.async = true;
    script.onload = () => { _jsQR = window.jsQR; _jsQRLoaded = true; };
    document.head.appendChild(script);
  } catch { /* ignore */ }
})();

function jsQRDecode(data, width, height) {
  if (_jsQR) {
    const result = _jsQR(data, width, height, { inversionAttempts: 'dontInvert' });
    return result?.data || null;
  }
  return null;
}
