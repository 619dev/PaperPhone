/**
 * WebRTC Call Manager — PaperPhone
 * Handles both 1:1 and multi-party (mesh) calls.
 *
 * Usage:
 *   import { CallManager } from './services/webrtc.js';
 *   const cm = new CallManager(send);   // send = socket send fn
 *   cm.startCall({ peerId, name, avatar, isVideo, isGroup, groupId, peerIds });
 */

import { api } from '../api.js';
import { send } from '../socket.js';

// ── ICE Config Cache ────────────────────────────────────────────────────────
let _iceServers = null;
async function getIceServers() {
  if (_iceServers) return _iceServers;
  try {
    const data = await api.turnCredentials();
    _iceServers = data.iceServers;
  } catch {
    _iceServers = [
      { urls: 'stun:stun.cloudflare.com:3478' },
      { urls: 'stun:stun.l.google.com:19302' },
    ];
  }
  return _iceServers;
}

// ── CallManager Class ───────────────────────────────────────────────────────
export class CallManager {
  constructor() {
    /**
     * peers: Map<peerId, RTCPeerConnection>
     * For 1:1: one entry
     * For group: one entry per remote peer
     */
    this.peers   = new Map();
    this.streams = new Map(); // peerId -> MediaStream (remote)

    this.localStream   = null;
    this.callInfo      = null;  // { peerId, name, avatar, isVideo, isGroup, groupId, peerIds }
    this.state         = 'idle'; // idle | calling | ringing | active | ended
    this._onStateChange = null;
    this._onRemoteStream = null;
    this._onLocalStream  = null;
  }

  // ── Callbacks ─────────────────────────────────────────────────────────────
  onStateChange(fn)   { this._onStateChange    = fn; }
  onRemoteStream(fn)  { this._onRemoteStream   = fn; }
  onLocalStream(fn)   { this._onLocalStream    = fn; }

  _setState(s) {
    this.state = s;
    this._onStateChange?.(s, this.callInfo);
  }

  // ── Media ─────────────────────────────────────────────────────────────────
  async _getLocalStream(isVideo) {
    if (this.localStream) return this.localStream;
    this.localStream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: isVideo ? { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' } : false,
    });
    this._onLocalStream?.(this.localStream);
    return this.localStream;
  }

  async _switchCamera() {
    if (!this.localStream) return;
    const videoTrack = this.localStream.getVideoTracks()[0];
    if (!videoTrack) return;
    const settings = videoTrack.getSettings();
    const newFacing = settings.facingMode === 'user' ? 'environment' : 'user';
    const newStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: newFacing },
      audio: false,
    });
    const newTrack = newStream.getVideoTracks()[0];
    this.peers.forEach(pc => {
      const sender = pc.getSenders().find(s => s.track?.kind === 'video');
      if (sender) sender.replaceTrack(newTrack);
    });
    this.localStream.removeTrack(videoTrack);
    videoTrack.stop();
    this.localStream.addTrack(newTrack);
    this._onLocalStream?.(this.localStream);
  }

  toggleMute() {
    if (!this.localStream) return;
    this.localStream.getAudioTracks().forEach(t => { t.enabled = !t.enabled; });
    return !this.localStream.getAudioTracks()[0]?.enabled;
  }

  toggleCamera() {
    if (!this.localStream) return;
    this.localStream.getVideoTracks().forEach(t => { t.enabled = !t.enabled; });
    return !this.localStream.getVideoTracks()[0]?.enabled;
  }

  switchCamera() { return this._switchCamera(); }

  // ── PeerConnection Factory ────────────────────────────────────────────────
  async _createPeer(peerId) {
    const iceServers = await getIceServers();
    const pc = new RTCPeerConnection({ iceServers, iceCandidatePoolSize: 10 });

    // Add local tracks
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => pc.addTrack(track, this.localStream));
    }

    // Remote stream
    const remoteStream = new MediaStream();
    this.streams.set(peerId, remoteStream);
    pc.ontrack = ({ track }) => {
      remoteStream.addTrack(track);
      this._onRemoteStream?.(peerId, remoteStream);
    };

    // ICE candidates
    pc.onicecandidate = ({ candidate }) => {
      if (!candidate) return;
      send({
        type: 'ice_candidate',
        to: peerId,
        candidate: candidate.toJSON(),
        call_id: this.callInfo?.callId,
      });
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        this._peerLeft(peerId);
      }
    };

    this.peers.set(peerId, pc);
    return pc;
  }

  _peerLeft(peerId) {
    const pc = this.peers.get(peerId);
    if (pc) { pc.close(); this.peers.delete(peerId); }
    this.streams.delete(peerId);
    this._onRemoteStream?.(peerId, null);  // null = peer left
    if (this.peers.size === 0) this._setState('ended');
  }

  // ── Outgoing Call ─────────────────────────────────────────────────────────
  async startCall({ peerId, name, avatar, isVideo = true, isGroup = false, groupId, peerIds = [] }) {
    if (this.state !== 'idle') return;
    const callId = crypto.randomUUID();
    this.callInfo = { peerId, name, avatar, isVideo, isGroup, groupId, peerIds, callId };

    await this._getLocalStream(isVideo);
    this._setState('calling');

    if (isGroup) {
      // Invite all group members
      send({ type: 'call_invite', group_id: groupId, call_id: callId, is_video: isVideo });
      // Create offers to each peer
      for (const pid of peerIds) {
        await this._sendOffer(pid, callId, isVideo);
      }
    } else {
      await this._sendOffer(peerId, callId, isVideo);
    }
  }

  async _sendOffer(peerId, callId, isVideo) {
    const pc = await this._createPeer(peerId);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    send({
      type: 'call_offer',
      to: peerId,
      sdp: offer.sdp,
      call_id: callId,
      is_video: isVideo,
    });
  }

  // ── Accept Incoming Call ──────────────────────────────────────────────────
  async acceptCall(isVideo) {
    if (this.state !== 'ringing' || !this.callInfo) return;
    this.callInfo.isVideo = isVideo;
    await this._getLocalStream(isVideo);
    this._setState('active');
    // Answer is sent in handleOffer, this just opens media
  }

  // ── Reject / Cancel / End ─────────────────────────────────────────────────
  rejectCall() {
    if (!this.callInfo) return;
    const { peerId, groupId, isGroup, callId } = this.callInfo;
    if (isGroup) {
      send({ type: 'call_reject', group_id: groupId, call_id: callId });
    } else {
      send({ type: 'call_reject', to: peerId, call_id: callId });
    }
    this._cleanup();
    this._setState('idle');
  }

  hangup() {
    if (!this.callInfo) return;
    const { peerId, groupId, isGroup, callId, peerIds } = this.callInfo;
    const targets = isGroup ? (peerIds || []) : [peerId];
    targets.forEach(pid => send({ type: 'call_end', to: pid, call_id: callId }));
    this._cleanup();
    this._setState('idle');
  }

  _cleanup() {
    this.peers.forEach(pc => pc.close());
    this.peers.clear();
    this.streams.clear();
    if (this.localStream) {
      this.localStream.getTracks().forEach(t => t.stop());
      this.localStream = null;
    }
    this.callInfo = null;
  }

  // ── Signaling Handlers ────────────────────────────────────────────────────
  async handleOffer({ from, sdp, call_id, is_video, name, avatar }) {
    if (this.state === 'idle') {
      // Incoming call — set ringing state, UI shows incoming call screen
      this.callInfo = { peerId: from, name, avatar, isVideo: is_video, callId: call_id, isGroup: false };
      this._setState('ringing');
      // Store the offer sdp temporarily so we can answer later
      this._pendingOffer = { from, sdp, is_video };
    } else if (this.state === 'active') {
      // Group call: new peer joined
      await this._answerOffer(from, sdp, call_id);
    }
  }

  async answerPendingOffer() {
    // Called after user accepts call
    if (!this._pendingOffer) return;
    const { from, sdp, is_video } = this._pendingOffer;
    this._pendingOffer = null;
    await this._getLocalStream(is_video);
    await this._answerOffer(from, sdp, this.callInfo.callId);
    this._setState('active');
  }

  async _answerOffer(peerId, sdp, callId) {
    const pc = await this._createPeer(peerId);
    await pc.setRemoteDescription({ type: 'offer', sdp });
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    send({ type: 'call_answer', to: peerId, sdp: answer.sdp, call_id: callId });
  }

  async handleAnswer({ from, sdp }) {
    const pc = this.peers.get(from);
    if (!pc) return;
    if (pc.signalingState === 'have-local-offer') {
      await pc.setRemoteDescription({ type: 'answer', sdp });
      this._setState('active');
    }
  }

  async handleIceCandidate({ from, candidate }) {
    const pc = this.peers.get(from);
    if (!pc || !candidate) return;
    try { await pc.addIceCandidate(candidate); } catch {}
  }

  handleCallInvite({ from, call_id, is_video, group_id, name, avatar }) {
    if (this.state !== 'idle') return;
    this.callInfo = { peerId: from, name, avatar, isVideo: is_video, callId: call_id, isGroup: true, groupId: group_id };
    this._setState('ringing');
  }

  handleCallEnd({ from }) {
    this._peerLeft(from);
    if (this.peers.size === 0) {
      this._cleanup();
      this._setState('idle');
    }
  }

  handleCallReject({ from }) {
    this._peerLeft(from);
    if (this.peers.size === 0) {
      this._cleanup();
      this._setState('idle');
    }
  }

  handleCallCancel() {
    this._cleanup();
    this._setState('idle');
  }
}

// Singleton
export const callManager = new CallManager();
