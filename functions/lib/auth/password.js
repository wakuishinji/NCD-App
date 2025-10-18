// Password hashing utilities using WebCrypto PBKDF2 + SHA-256.

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const DEFAULT_ITERATIONS = 150000;
const DEFAULT_KEY_LENGTH = 32; // bytes

function getCrypto() {
  if (!globalThis.crypto?.subtle) {
    throw new Error('Web Crypto API is required for password hashing.');
  }
  return globalThis.crypto;
}

function toBase64Url(buffer) {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(buffer).toString('base64url');
  }
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(str) {
  if (!str) return new Uint8Array();
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(str, 'base64url'));
  }
  const normalized = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = normalized.length % 4 ? 4 - (normalized.length % 4) : 0;
  const base64 = normalized + '='.repeat(pad);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function randomSalt(size = 16) {
  const crypto = getCrypto();
  const buf = new Uint8Array(size);
  crypto.getRandomValues(buf);
  return buf;
}

function normalizeIterations(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 50000) {
    return DEFAULT_ITERATIONS;
  }
  return Math.min(num, 500000);
}

export async function hashPassword(password, {
  salt,
  iterations = DEFAULT_ITERATIONS,
  keyLength = DEFAULT_KEY_LENGTH,
} = {}) {
  if (typeof password !== 'string' || !password) {
    throw new Error('Password must be a non-empty string.');
  }
  const saltBytes = salt instanceof Uint8Array ? salt : salt ? fromBase64Url(salt) : randomSalt();
  const crypto = getCrypto();
  const baseKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits', 'deriveKey'],
  );
  const params = { name: 'PBKDF2', salt: saltBytes, iterations: normalizeIterations(iterations), hash: 'SHA-256' };
  const derived = await crypto.subtle.deriveBits(params, baseKey, keyLength * 8);
  return {
    algorithm: 'pbkdf2-sha256',
    iterations: params.iterations,
    salt: toBase64Url(saltBytes),
    hash: toBase64Url(new Uint8Array(derived)),
    keyLength,
  };
}

export async function verifyPassword(password, stored) {
  if (!stored || typeof stored !== 'object') return false;
  if (stored.algorithm && stored.algorithm !== 'pbkdf2-sha256') return false;
  const { hash, salt, iterations, keyLength } = stored;
  if (!hash || !salt) return false;
  const computed = await hashPassword(password, { salt, iterations, keyLength });
  return timingSafeEqual(computed.hash, hash);
}

function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
