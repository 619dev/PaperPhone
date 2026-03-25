/**
 * KeyStore — four-tier key persistence
 *
 * Tier 1: In-memory cache  — fastest, survives current page load only
 * Tier 2: localStorage     — SYNCHRONOUS write, survives tab close/kill/reload
 * Tier 3: sessionStorage   — survives reload, cleared on tab close
 * Tier 4: IndexedDB        — indexed DB, async, may be restricted on some WebViews
 *
 * DESIGN DECISION: localStorage is written SYNCHRONOUSLY (first, not fire-and-forget)
 * so it is guaranteed to complete before any subsequent window.location.reload().
 * This is the fallback of last resort that works on every Android browser including
 * Via, Chrome, WebView-based PWAs.
 *
 * Security note: localStorage is accessible to same-origin JS only.
 * For a self-hosted app this is an acceptable tradeoff vs. no encryption at all.
 */

const DB_NAME  = 'paperphone_keys';
const DB_VER   = 1;
const STORE    = 'keystore';
const LS_PFX   = 'ppk_';  // localStorage / sessionStorage prefix

// ── In-memory cache ────────────────────────────────────────────────────────
const _mem = new Map();

// ── localStorage (synchronous, tier 2) ────────────────────────────────────
function lsSet(k, v) { try { localStorage.setItem(LS_PFX + k, JSON.stringify(v)); } catch {} }
function lsGet(k)    { try { const s = localStorage.getItem(LS_PFX + k); return s ? JSON.parse(s) : null; } catch { return null; } }
function lsDel(k)    { try { localStorage.removeItem(LS_PFX + k); } catch {} }

// ── sessionStorage (synchronous, tier 3) ──────────────────────────────────
function ssSet(k, v) { try { sessionStorage.setItem(LS_PFX + k, JSON.stringify(v)); } catch {} }
function ssGet(k)    { try { const s = sessionStorage.getItem(LS_PFX + k); return s ? JSON.parse(s) : null; } catch { return null; } }
function ssDel(k)    { try { sessionStorage.removeItem(LS_PFX + k); } catch {} }

// ── IndexedDB (async, tier 4) ──────────────────────────────────────────────
let _dbp = null;
function _openDb() {
  if (_dbp) return _dbp;
  _dbp = new Promise((res, rej) => {
    try {
      const r = indexedDB.open(DB_NAME, DB_VER);
      r.onupgradeneeded = e => e.target.result.createObjectStore(STORE);
      r.onsuccess = e => res(e.target.result);
      r.onerror   = e => { _dbp = null; rej(e.target.error); };
    } catch(e) { _dbp = null; rej(e); }
  });
  return _dbp;
}
async function idbGet(k) {
  const db = await _openDb();
  return new Promise((res, rej) => {
    const r = db.transaction(STORE, 'readonly').objectStore(STORE).get(k);
    r.onsuccess = e => res(e.target.result ?? null);
    r.onerror   = e => rej(e.target.error);
  });
}
async function idbSet(k, v) {
  const db = await _openDb();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(v, k);
    tx.oncomplete = res;
    tx.onerror = e => rej(e.target.error);
  });
}
async function idbDel(k) {
  const db = await _openDb();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(k);
    tx.oncomplete = res;
    tx.onerror = e => rej(e.target.error);
  });
}

// ── Public API ─────────────────────────────────────────────────────────────

export async function setKey(name, value) {
  // Tier 1: memory (instant)
  _mem.set(name, value);
  // Tier 2: localStorage — SYNCHRONOUS so it always completes before any reload()
  lsSet(name, value);
  // Tier 3: sessionStorage — synchronous backup
  ssSet(name, value);
  // Tier 4: IndexedDB — async, best-effort (don't await, don't let failure block)
  idbSet(name, value).catch(() => {});
}

export async function getKey(name) {
  // Tier 1: memory
  if (_mem.has(name)) return _mem.get(name);

  // Tier 2: localStorage
  const lv = lsGet(name);
  if (lv !== null) { _mem.set(name, lv); return lv; }

  // Tier 3: sessionStorage
  const sv = ssGet(name);
  if (sv !== null) { _mem.set(name, sv); return sv; }

  // Tier 4: IndexedDB
  try {
    const iv = await idbGet(name);
    if (iv !== null && iv !== undefined) {
      _mem.set(name, iv);
      // Promote to localStorage for next time
      lsSet(name, iv);
      return iv;
    }
  } catch {}

  return undefined;
}

export async function deleteKey(name) {
  _mem.delete(name);
  lsDel(name);
  ssDel(name);
  idbDel(name).catch(() => {});
}
