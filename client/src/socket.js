/**
 * WebSocket client — auto-reconnect, message dispatching
 */
import { WS_URL, getToken } from './api.js';

let ws;
let reconnectTimer;
const handlers = new Map();
let _onMessage;

export function onMessage(fn) { _onMessage = fn; }

export function onEvent(type, fn) {
  if (!handlers.has(type)) handlers.set(type, new Set());
  handlers.get(type).add(fn);
}
export function offEvent(type, fn) {
  handlers.get(type)?.delete(fn);
}

function dispatch(msg) {
  if (_onMessage) _onMessage(msg);
  handlers.get(msg.type)?.forEach(fn => fn(msg));
  handlers.get('*')?.forEach(fn => fn(msg));
}

export function connect() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  clearTimeout(reconnectTimer);

  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    console.log('WS connected');
    ws.send(JSON.stringify({ type: 'auth', token: getToken() }));
  };

  ws.onmessage = e => {
    try { dispatch(JSON.parse(e.data)); } catch {}
  };

  ws.onclose = () => {
    console.log('WS closed — reconnecting in 3s');
    reconnectTimer = setTimeout(connect, 3000);
  };

  ws.onerror = err => console.error('WS error', err);
}

export function send(payload) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
    return true;
  }
  return false;
}

export function disconnect() {
  clearTimeout(reconnectTimer);
  if (ws) ws.close();
}
