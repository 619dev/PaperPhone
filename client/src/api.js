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
  sendRequest:    id  => req('POST', '/api/friends/request', { friend_id: id }),
  acceptFriend:   uid => req('POST', '/api/friends/accept', { user_id: uid }),
  removeFriend:   id  => req('DELETE', `/api/friends/${id}`),

  // Groups
  groups:     ()  => req('GET',  '/api/groups'),
  groupInfo:  id  => req('GET',  `/api/groups/${id}`),
  createGroup: d  => req('POST', '/api/groups', d),
  addMember:  (gid, uid) => req('POST', `/api/groups/${gid}/members`, { user_id: uid }),

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

  // Moments (朋友圈)
  momentsFeed:      (before) => req('GET', `/api/moments${before ? `?before=${before}` : ''}`),
  createMoment:     (d)      => req('POST', '/api/moments', d),
  deleteMoment:     (id)     => req('DELETE', `/api/moments/${id}`),
  likeMoment:       (id)     => req('POST', `/api/moments/${id}/like`),
  addComment:       (id, text) => req('POST', `/api/moments/${id}/comments`, { text }),
  deleteComment:    (mid, cid) => req('DELETE', `/api/moments/${mid}/comments/${cid}`),
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
