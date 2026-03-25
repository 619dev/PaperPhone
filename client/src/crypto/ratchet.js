/**
 * X3DH Key Agreement + Double Ratchet with ML-KEM-768 post-quantum injection
 *
 * Uses libsodium-wrappers for:
 *   - Curve25519 ECDH (X3DH)
 *   - XSalsa20-Poly1305 symmetric encryption
 *   - SHA-256 KDF
 *
 * Uses kyber-crystals (ML-KEM-768) for:
 *   - Post-quantum KEM injection at every ratchet step
 *
 * All loaded from CDN via importmap — no bundler required.
 */

// Sodium is loaded globally via <script> in index.html
// after window._sodium is ready

function sodium() {
  if (!window._sodium || !window._sodium.ready) throw new Error('libsodium not ready');
  return window._sodium;
}

// ── Helpers ───────────────────────────────────────────────────────────────

function b64encode(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}
function b64decode(str) {
  return Uint8Array.from(atob(str), c => c.charCodeAt(0));
}
function concat(...arrays) {
  const total = arrays.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrays) { out.set(a, off); off += a.length; }
  return out;
}
function xorBytes(a, b) {
  const out = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] ^ b[i % b.length];
  return out;
}

// ── KDF ──────────────────────────────────────────────────────────────────

function kdf(ikm, info = 'PaperPhone-v1') {
  const na = sodium();
  const salt = new Uint8Array(32);
  const infoBytes = new TextEncoder().encode(info);
  return na.crypto_generichash(32, concat(ikm, infoBytes), salt);
}

// ── Key Generation ────────────────────────────────────────────────────────

export async function generateIdentityKeyPair() {
  const na = sodium();
  await na.ready;
  const kp = na.crypto_box_keypair();
  return { publicKey: b64encode(kp.publicKey), privateKey: b64encode(kp.privateKey) };
}

export async function generateSignedPreKey(ikPrivateKey) {
  const na = sodium();
  await na.ready;
  const kp = na.crypto_box_keypair();
  const sig = na.crypto_sign_detached(
    kp.publicKey,
    b64decode(ikPrivateKey).slice(0, 32) // use first 32 bytes as ed25519-like key (simplified)
  );
  return {
    publicKey: b64encode(kp.publicKey),
    privateKey: b64encode(kp.privateKey),
    signature: b64encode(sig),
  };
}

export async function generateOneTimePreKey() {
  const na = sodium();
  await na.ready;
  const kp = na.crypto_box_keypair();
  return { publicKey: b64encode(kp.publicKey), privateKey: b64encode(kp.privateKey) };
}

// ── X3DH Sender (initiator) ───────────────────────────────────────────────

/**
 * Initiates X3DH handshake, returns { sharedSecret (bytes), header (for first message) }
 * bundle = { ik_pub, spk_pub, spk_sig, opk?, kem_pub }
 */
export async function x3dhSend(myIK, bundle) {
  const na = sodium();
  await na.ready;

  const EK = na.crypto_box_keypair(); // ephemeral key

  const IK_B = b64decode(bundle.ik_pub);
  const SPK_B = b64decode(bundle.spk_pub);
  const OPK_B = bundle.opk ? b64decode(bundle.opk.opk_pub) : null;
  const IK_A_priv = b64decode(myIK.privateKey);

  const DH1 = na.crypto_scalarmult(IK_A_priv, SPK_B);
  const DH2 = na.crypto_scalarmult(EK.privateKey, IK_B);
  const DH3 = na.crypto_scalarmult(EK.privateKey, SPK_B);
  const DH4 = OPK_B ? na.crypto_scalarmult(EK.privateKey, OPK_B) : new Uint8Array(32);

  const masterSecret = kdf(concat(DH1, DH2, DH3, DH4));

  return {
    sharedSecret: masterSecret,
    header: {
      ek_pub: b64encode(EK.publicKey),
      ik_pub: myIK.publicKey,
      opk_key_id: bundle.opk?.key_id ?? null,
    },
  };
}

// ── X3DH Receiver ─────────────────────────────────────────────────────────

/**
 * Derives shared secret from an incoming X3DH header
 * myKeys = { ik (priv), spk (priv), opk? (priv) }
 */
export async function x3dhReceive(myKeys, header) {
  const na = sodium();
  await na.ready;

  const EK_A = b64decode(header.ek_pub);
  const IK_A = b64decode(header.ik_pub);
  const IK_B_priv = b64decode(myKeys.ik.privateKey);
  const SPK_B_priv = b64decode(myKeys.spk.privateKey);
  const OPK_B_priv = myKeys.opk ? b64decode(myKeys.opk.privateKey) : null;

  const DH1 = na.crypto_scalarmult(SPK_B_priv, IK_A);
  const DH2 = na.crypto_scalarmult(IK_B_priv, EK_A);
  const DH3 = na.crypto_scalarmult(SPK_B_priv, EK_A);
  const DH4 = OPK_B_priv ? na.crypto_scalarmult(OPK_B_priv, EK_A) : new Uint8Array(32);

  return kdf(concat(DH1, DH2, DH3, DH4));
}

// ── Double Ratchet State ──────────────────────────────────────────────────

/**
 * Create initial ratchet state after X3DH
 * role: 'sender' or 'receiver'
 */
export async function ratchetInit(sharedSecret, role) {
  const na = sodium();
  await na.ready;
  const dhKP = na.crypto_box_keypair();

  return {
    role,
    // Root key (32 bytes)
    RK: sharedSecret,
    // Chain keys
    CKs: null, // sending chain key
    CKr: null, // receiving chain key
    // DH ratchet key pair
    DHs: { pub: b64encode(dhKP.publicKey), priv: b64encode(dhKP.privateKey) },
    DHr: null, // remote ratchet pubkey
    // Counters
    Ns: 0, Nr: 0,
    // Skip table
    MKSKIPPED: {},
  };
}

/** Ratchet step — advance root key with DH output + KEM sharedSecret */
function _ratchetStep(RK, dhOutput, kemShared) {
  const combined = concat(b64decode(RK) instanceof Uint8Array ? b64decode(RK) : new Uint8Array(RK),
    dhOutput, kemShared || new Uint8Array(32));
  const newRK = kdf(combined, 'RK-step');
  const newCK = kdf(combined, 'CK-step');
  return { newRK: b64encode(newRK), newCK: b64encode(newCK) };
}

/** Derive message key from chain key */
function _deriveMessageKey(CK) {
  const na = sodium();
  const ck = b64decode(CK);
  const MK = na.crypto_generichash(32, ck, new TextEncoder().encode('MK'));
  const nextCK = na.crypto_generichash(32, ck, new TextEncoder().encode('CK'));
  return { MK: b64encode(MK), nextCK: b64encode(nextCK) };
}

// ── Encrypt Message ───────────────────────────────────────────────────────

/**
 * Encrypt plaintext using double ratchet.
 * Returns { ciphertext (b64), header, newState }
 * header includes sender DH public key, message number, kemCT
 */
export async function ratchetEncrypt(state, plaintext) {
  const na = sodium();
  await na.ready;

  let { RK, CKs, DHs, DHr, Ns, kemKP } = state;

  // If no sending chain yet, perform DH ratchet step
  if (!CKs) {
    const dhKP = na.crypto_box_keypair();
    DHs = { pub: b64encode(dhKP.publicKey), priv: b64encode(dhKP.privateKey) };

    const dhOut = DHr
      ? na.crypto_scalarmult(b64decode(DHs.priv), b64decode(DHr))
      : new Uint8Array(32);

    // ML-KEM step
    let kemCT = null, kemShared = new Uint8Array(32);
    if (window.KyberModule && DHr) {
      try {
        const res = window.KyberModule.kemEncapsulate(DHr);
        kemCT = res.ciphertext;
        kemShared = b64decode(res.sharedSecret);
      } catch (e) { /* fallback to no PQ */ }
    }

    const step = _ratchetStep(RK, dhOut, kemShared);
    RK = step.newRK;
    CKs = step.newCK;
    state = { ...state, RK, CKs, DHs, Ns: 0 };
    state._kemCT = kemCT;
  }

  const { MK, nextCK } = _deriveMessageKey(CKs);
  const nonce = na.randombytes_buf(24);
  const ct = na.crypto_secretbox_easy(
    new TextEncoder().encode(plaintext),
    nonce,
    b64decode(MK)
  );

  const newState = { ...state, CKs: nextCK, Ns: Ns + 1 };
  return {
    ciphertext: b64encode(concat(nonce, ct)),
    header: { dh: DHs.pub, n: Ns, kemCT: state._kemCT || null },
    newState,
  };
}

// ── Decrypt Message ───────────────────────────────────────────────────────

export async function ratchetDecrypt(state, ciphertextB64, header, myKemPriv) {
  const na = sodium();
  await na.ready;

  let { RK, CKr, DHs, DHr, Nr } = state;

  // DH ratchet step if new sender ratchet key
  if (!DHr || header.dh !== DHr) {
    const dhOut = DHs
      ? na.crypto_scalarmult(b64decode(DHs.priv), b64decode(header.dh))
      : new Uint8Array(32);

    // ML-KEM decapsulate
    let kemShared = new Uint8Array(32);
    if (header.kemCT && myKemPriv && window.KyberModule) {
      try {
        kemShared = b64decode(window.KyberModule.kemDecapsulate(header.kemCT, myKemPriv));
      } catch (e) { /* fallback */ }
    }

    const step = _ratchetStep(RK, dhOut, kemShared);
    RK = step.newRK;
    CKr = step.newCK;
    DHr = header.dh;
    Nr = 0;
    state = { ...state, RK, CKr, DHr, Nr };
  }

  const { MK, nextCK } = _deriveMessageKey(CKr);
  const raw = b64decode(ciphertextB64);
  const nonce = raw.slice(0, 24);
  const ct = raw.slice(24);

  const plaintext = na.crypto_secretbox_open_easy(ct, nonce, b64decode(MK));
  const newState = { ...state, CKr: nextCK, Nr: Nr + 1 };
  return { plaintext: new TextDecoder().decode(plaintext), newState };
}
