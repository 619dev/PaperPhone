/**
 * PaperPhone E2EE Crypto v2
 *
 * Stateless per-message encryption using libsodium:
 *   - Curve25519 ECDH key exchange (crypto_box_keypair / crypto_scalarmult)
 *   - XSalsa20-Poly1305 authenticated encryption (crypto_secretbox_easy)
 *   - BLAKE2b for KDF
 *
 * Protocol (per message):
 *   Sender:
 *     1. Generate ephemeral Curve25519 keypair (EK)
 *     2. sharedKey = KDF( DH(EK_priv, recipient_IK_pub) )
 *     3. ciphertext = secretbox(plaintext, nonce, sharedKey)
 *     4. Send { ciphertext: nonce+ct (b64), header: { ek_pub } }
 *
 *   Receiver:
 *     1. sharedKey = KDF( DH(my_IK_priv, EK_pub) )
 *     2. plaintext = open_secretbox(ciphertext, nonce, sharedKey)
 *
 * Each message is independently encrypted — no session state needed.
 * Forward secrecy comes from ephemeral keys (a fresh EK per message).
 */

// libsodium is loaded globally via <script> in index.html
function sodium() {
  if (!window._sodium) throw new Error('libsodium not ready');
  return window._sodium;
}

// ── Helpers ────────────────────────────────────────────────────────────────

export function b64encode(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}
export function b64decode(str) {
  if (!str || typeof str !== 'string') throw new TypeError('b64decode: expected base64 string, got ' + typeof str);
  return Uint8Array.from(atob(str), c => c.charCodeAt(0));
}

function concat(...arrays) {
  const total = arrays.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrays) { out.set(a, off); off += a.length; }
  return out;
}

function kdf(ikm) {
  const na = sodium();
  const salt = new Uint8Array(32);
  const info = new TextEncoder().encode('PaperPhone-E2EE-v2');
  return na.crypto_generichash(32, concat(ikm, info), salt);
}

// ── Key Generation ─────────────────────────────────────────────────────────

export async function generateIdentityKeyPair() {
  await window._sodiumPromise;
  const na = sodium();
  const kp = na.crypto_box_keypair();
  return { publicKey: b64encode(kp.publicKey), privateKey: b64encode(kp.privateKey) };
}

export async function generateSignedPreKey(ikPrivateKey) {
  await window._sodiumPromise;
  const na = sodium();
  const kp = na.crypto_box_keypair();
  const ikPrivBytes = b64decode(ikPrivateKey);
  const sig = na.crypto_generichash(64, concat(ikPrivBytes, kp.publicKey));
  return {
    publicKey: b64encode(kp.publicKey),
    privateKey: b64encode(kp.privateKey),
    signature: b64encode(sig),
  };
}

export async function generateOneTimePreKey() {
  await window._sodiumPromise;
  const na = sodium();
  const kp = na.crypto_box_keypair();
  return { publicKey: b64encode(kp.publicKey), privateKey: b64encode(kp.privateKey) };
}

// ── Encrypt (stateless, per-message) ──────────────────────────────────────

/**
 * Encrypt plaintext for a recipient.
 * @param {string} recipientIkPub  - Recipient's identity public key (base64)
 * @param {string} plaintext       - UTF-8 message text
 * @returns {{ ciphertext: string, header: { ek_pub: string } }}
 */
export async function encryptMessage(recipientIkPub, plaintext) {
  await window._sodiumPromise;
  const na = sodium();

  // Ephemeral keypair — fresh for every message
  const EK = na.crypto_box_keypair();
  const recipientPub = b64decode(recipientIkPub);

  // ECDH shared secret
  const dh = na.crypto_scalarmult(EK.privateKey, recipientPub);
  const sharedKey = kdf(dh);

  // Encrypt
  const nonce = na.randombytes_buf(24);
  const ct = na.crypto_secretbox_easy(new TextEncoder().encode(plaintext), nonce, sharedKey);

  return {
    ciphertext: b64encode(concat(nonce, ct)),
    header: { ek_pub: b64encode(EK.publicKey) },
  };
}

// ── Dual Encrypt (for both recipient AND sender) ──────────────────────────

/**
 * Encrypt plaintext for both recipient and sender (so sender can decrypt own history).
 * @param {string} recipientIkPub  - Recipient's identity public key (base64)
 * @param {string} senderIkPub     - Sender's own identity public key (base64)
 * @param {string} plaintext       - UTF-8 message text
 * @returns {{ ciphertext, header, self_ciphertext, self_header }}
 */
export async function encryptMessageDual(recipientIkPub, senderIkPub, plaintext) {
  const forRecipient = await encryptMessage(recipientIkPub, plaintext);
  const forSelf = await encryptMessage(senderIkPub, plaintext);
  return {
    ciphertext: forRecipient.ciphertext,
    header: forRecipient.header,
    self_ciphertext: forSelf.ciphertext,
    self_header: forSelf.header,
  };
}

// ── Decrypt (stateless, per-message) ──────────────────────────────────────

/**
 * Decrypt a message.
 * @param {{ privateKey: string }} myIK - My identity key (with privateKey field)
 * @param {{ ek_pub: string }} header   - Message header from sender
 * @param {string} ciphertextB64        - base64 nonce+ciphertext
 * @returns {string} plaintext
 */
export async function decryptMessage(myIK, header, ciphertextB64) {
  await window._sodiumPromise;
  const na = sodium();

  if (!header || !header.ek_pub) throw new Error('Missing ek_pub in header');

  const ekPub = b64decode(header.ek_pub);
  const myPriv = b64decode(myIK.privateKey);

  // ECDH shared secret (mirrors sender's computation)
  const dh = na.crypto_scalarmult(myPriv, ekPub);
  const sharedKey = kdf(dh);

  // Decrypt
  const raw = b64decode(ciphertextB64);
  const nonce = raw.slice(0, 24);
  const ct = raw.slice(24);
  const plaintext = na.crypto_secretbox_open_easy(ct, nonce, sharedKey);
  if (!plaintext) throw new Error('Decryption failed (authentication error)');

  return new TextDecoder().decode(plaintext);
}

// ── Legacy stubs (kept for compatibility with login.js key generation) ────
// These are no longer used for message crypto but are called during registration.

export async function x3dhSend() { throw new Error('x3dhSend is deprecated'); }
export async function x3dhReceive() { throw new Error('x3dhReceive is deprecated'); }
export async function ratchetInit() { throw new Error('ratchetInit is deprecated'); }
export async function ratchetEncrypt() { throw new Error('ratchetEncrypt is deprecated'); }
export async function ratchetDecrypt() { throw new Error('ratchetDecrypt is deprecated'); }
