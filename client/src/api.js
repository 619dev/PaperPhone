/**
 * API client — all calls over HTTPS, JWT attached
 */

const BASE = (() => {
  const loc = window.location;
  // In dev, backend on port 3000; in production, same origin
  if (loc.port === '8080' || loc.port === '5173') return `http://${loc.hostname}:3000`;
  return '';
})();

let _token = localStorage.getItem('pp_token');

export function setToken(t) { _token = t; localStorage.setItem('pp_token', t); }
export function clearToken() { _token = null; localStorage.removeItem('pp_token'); }
export function getToken() { return _token; }

async function req(method, path, body, isForm = false) {
  const headers = {};
  if (_token) headers['Authorization'] = `Bearer ${_token}`;
  if (!isForm) headers['Content-Type'] = 'application/json';

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: isForm ? body : (body ? JSON.stringify(body) : undefined),
  });

  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { const j = await res.json(); msg = j.error || msg; } catch {}
    throw new Error(msg);
  }
  return res.json();
}

export const api = {
  // Auth
  register: d => req('POST', '/api/auth/register', d),
  login:    d => req('POST', '/api/auth/login', d),

  // Users
  me:          ()  => req('GET',   '/api/users/me'),
  updateMe:    d   => req('PATCH', '/api/users/me', d),
  search:      q   => req('GET',   `/api/users/search?q=${encodeURIComponent(q)}`),
  prekeys:     uid => req('GET',   `/api/users/${uid}/prekeys`),
  identityKey: uid => req('GET',   `/api/users/${uid}/ik`),
  uploadOPKs:  d   => req('POST',  '/api/users/prekeys', d),
  uploadKeys:  d   => req('PUT',   '/api/users/keys', d),

  // Friends
  friends:        ()  => req('GET',  '/api/friends'),
  friendRequests: ()  => req('GET',  '/api/friends/requests'),
  sendRequest:    (id, msg) => req('POST', '/api/friends/request', { friend_id: id, message: msg || null }),
  acceptFriend:   uid => req('POST', '/api/friends/accept', { user_id: uid }),
  removeFriend:   id  => req('DELETE', `/api/friends/${id}`),

  // Groups
  groups:       ()  => req('GET',  '/api/groups'),
  groupInfo:    id  => req('GET',  `/api/groups/${id}`),
  createGroup:  d   => req('POST', '/api/groups', d),
  updateGroup:  (id, d) => req('PATCH', `/api/groups/${id}`, d),
  addMember:    (gid, uid) => req('POST', `/api/groups/${gid}/members`, { user_id: uid }),
  removeMember: (gid, uid) => req('DELETE', `/api/groups/${gid}/members/${uid}`),
  leaveGroup:   id  => req('DELETE', `/api/groups/${id}/members/me`),
  disbandGroup: id  => req('DELETE', `/api/groups/${id}`),
  muteGroup:    (id, muted) => req('PATCH', `/api/groups/${id}/mute`, { muted }),
  setAutoDelete:      (friendId, val) => req('PATCH', `/api/friends/${friendId}/auto-delete`, { auto_delete: val }),
  setGroupAutoDelete: (groupId, val)  => req('PATCH', `/api/groups/${groupId}/auto-delete`, { auto_delete: val }),

  // Messages
  privateHistory: pid => req('GET', `/api/messages/private/${pid}`),
  groupHistory:   gid => req('GET', `/api/messages/group/${gid}`),

  // Calls / TURN
  turnCredentials: () => req('GET', '/api/calls/turn'),

  // Upload
  upload: file => {
    const fd = new FormData();
    fd.append('file', file);
    return req('POST', '/api/upload', fd, true);
  },

  /**
   * Upload with progress callback — uses XHR for upload progress events.
   * @param {File} file
   * @param {(pct: number) => void} onProgress  — 0..100
   * @returns {Promise<{url: string, name: string, size: number, type: string}>}
   */
  uploadWithProgress: (file, onProgress) => {
    return new Promise((resolve, reject) => {
      const fd = new FormData();
      fd.append('file', file);
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${BASE}/api/upload`);
      if (_token) xhr.setRequestHeader('Authorization', `Bearer ${_token}`);
      xhr.upload.onprogress = e => {
        if (e.lengthComputable && onProgress) {
          onProgress(Math.round((e.loaded / e.total) * 100));
        }
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try { resolve(JSON.parse(xhr.responseText)); } catch { resolve({}); }
        } else {
          let msg = `HTTP ${xhr.status}`;
          try { const j = JSON.parse(xhr.responseText); msg = j.error || msg; } catch {}
          reject(new Error(msg));
        }
      };
      xhr.onerror = () => reject(new Error('Network error'));
      xhr.send(fd);
    });
  },

  // Moments (朋友圈)
  momentsFeed:      (before) => req('GET', `/api/moments${before ? `?before=${before}` : ''}`),
  createMoment:     (d)      => req('POST', '/api/moments', d),
  deleteMoment:     (id)     => req('DELETE', `/api/moments/${id}`),
  likeMoment:       (id)     => req('POST', `/api/moments/${id}/like`),
  addComment:       (id, text) => req('POST', `/api/moments/${id}/comments`, { text }),
  deleteComment:    (mid, cid) => req('DELETE', `/api/moments/${mid}/comments/${cid}`),
  userMoments:      (uid, before) => req('GET', `/api/moments/user/${uid}${before ? `?before=${before}` : ''}`),
  getMomentPrivacy: (uid) => req('GET', `/api/moments/privacy/${uid}`),
  setMomentPrivacy: (uid, d) => req('PUT', `/api/moments/privacy/${uid}`, d),

  // Timeline (时间线)
  timelineFeed:       (before) => req('GET', `/api/timeline${before ? `?before=${before}` : ''}`),
  timelineDetail:     (id)     => req('GET', `/api/timeline/${id}`),
  createTimelinePost: (d)      => req('POST', '/api/timeline', d),
  deleteTimelinePost: (id)     => req('DELETE', `/api/timeline/${id}`),
  likeTimelinePost:   (id)     => req('POST', `/api/timeline/${id}/like`),
  addTimelineComment: (id, text, is_anonymous) => req('POST', `/api/timeline/${id}/comments`, { text, is_anonymous }),
  deleteTimelineComment: (pid, cid) => req('DELETE', `/api/timeline/${pid}/comments/${cid}`),

  // Friend Tags
  tags:            ()         => req('GET',    '/api/tags'),
  createTag:       (d)        => req('POST',   '/api/tags', d),
  updateTag:       (id, d)    => req('PATCH',  `/api/tags/${id}`, d),
  deleteTag:       (id)       => req('DELETE', `/api/tags/${id}`),
  tagFriends:      (id, d)    => req('POST',   `/api/tags/${id}/friends`, d),
  untagFriend:     (id, fid)  => req('DELETE', `/api/tags/${id}/friends/${fid}`),
  tagFriendList:   (id)       => req('GET',    `/api/tags/${id}/friends`),

  // Push Notifications
  vapidKey:        ()    => req('GET',    '/api/push/vapid-key'),
  pushSubscribe:   (sub) => req('POST',   '/api/push/subscribe', sub),
  pushUnsubscribe: (endpoint) => req('DELETE', '/api/push/subscribe', { endpoint }),
  registerOneSignal: (player_id, platform) => req('POST', '/api/push/onesignal', { player_id, platform }),

  // Sessions (Device Management)
  sessions:       ()   => req('GET',    '/api/sessions'),
  revokeSession:  (id) => req('DELETE', `/api/sessions/${id}`),
  revokeAllOther: ()   => req('DELETE', '/api/sessions'),

  // Stickers (Telegram proxy)
  stickerPacks:  ()     => req('GET', '/api/stickers/packs'),
  stickerSet:    (name) => req('GET', `/api/stickers/set/${encodeURIComponent(name)}`),
  stickerFileUrl: (fileId) => `${BASE}/api/stickers/file/${encodeURIComponent(fileId)}`,

  // TOTP 2FA
  totpStatus:      ()    => req('GET',  '/api/totp/status'),
  totpSetup:       ()    => req('POST', '/api/totp/setup'),
  totpVerifySetup: (code) => req('POST', '/api/totp/verify-setup', { code }),
  totpDisable:     (code) => req('POST', '/api/totp/disable', { code }),
  totpVerifyLogin: (code, loginToken) => {
    return fetch(`${BASE}/api/totp/verify-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, login_token: loginToken }),
    }).then(async r => {
      if (!r.ok) {
        let msg = `HTTP ${r.status}`;
        try { const j = await r.json(); msg = j.error || msg; } catch {}
        throw new Error(msg);
      }
      return r.json();
    });
  },
};

export const WS_URL = (() => {
  const loc = window.location;
  const proto = loc.protocol === 'https:' ? 'wss' : 'ws';
  // Dev: direct to backend port 3000
  if (loc.port === '8080' || loc.port === '5173') {
    return `${proto}://${loc.hostname}:3000`;
  }
  // Production: same origin via nginx /ws proxy
  return `${proto}://${loc.host}/ws`;
})();
