// JWT utility helpers for Cloudflare Workers / Node ESM runtimes.
// Supports HS256 signing, session revocation via KV, and basic payload validation.

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const DEFAULT_ALGORITHM = 'HS256';
const DEFAULT_ACCESS_TTL = 60 * 15; // 15 minutes
const DEFAULT_CLOCK_TOLERANCE = 60; // seconds
const DEFAULT_REVOCATION_TTL = 60 * 60 * 24 * 8; // 8 days

const secretCache = new Map();

function getCrypto() {
  if (globalThis.crypto?.subtle) {
    return globalThis.crypto;
  }
  throw new Error('Web Crypto API is not available in this runtime.');
}

function normalizeSecret(secret) {
  if (!secret || typeof secret !== 'string' || !secret.trim()) {
    throw new Error('JWT secret is not configured.');
  }
  return secret;
}

async function importHmacKey(secret) {
  const normalized = normalizeSecret(secret);
  if (secretCache.has(normalized)) {
    return secretCache.get(normalized);
  }
  const crypto = getCrypto();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(normalized),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
  secretCache.set(normalized, key);
  return key;
}

function toBase64Url(buffer) {
  let base64;
  if (typeof Buffer !== 'undefined') {
    base64 = Buffer.from(buffer).toString('base64');
  } else {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 1) {
      binary += String.fromCharCode(bytes[i]);
    }
    base64 = btoa(binary);
  }
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(str) {
  const normalized = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = normalized.length % 4 ? 4 - (normalized.length % 4) : 0;
  const base64 = normalized + '='.repeat(pad);
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(base64, 'base64');
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function jsonEncode(obj) {
  return encoder.encode(JSON.stringify(obj));
}

function jsonDecode(buffer) {
  if (buffer instanceof Uint8Array || ArrayBuffer.isView(buffer)) {
    return JSON.parse(decoder.decode(buffer));
  }
  if (typeof buffer === 'string') {
    return JSON.parse(buffer);
  }
  if (buffer instanceof Buffer) {
    return JSON.parse(buffer.toString('utf8'));
  }
  return JSON.parse(String(buffer));
}

function ensureSessionStore({ env, sessionStore } = {}) {
  return sessionStore || env?.AUTH_SESSIONS || null;
}

function sessionKey(sessionId) {
  return `session:${sessionId}`;
}

export function getJwtDefaults(overrides = {}) {
  return {
    algorithm: DEFAULT_ALGORITHM,
    accessTtlSeconds: DEFAULT_ACCESS_TTL,
    clockToleranceSeconds: DEFAULT_CLOCK_TOLERANCE,
    revocationTtlSeconds: DEFAULT_REVOCATION_TTL,
    ...overrides,
  };
}

export async function createToken(payload, {
  env,
  secret = env?.JWT_SECRET,
  ttlSeconds = DEFAULT_ACCESS_TTL,
  algorithm = DEFAULT_ALGORITHM,
  issuedAt = Math.floor(Date.now() / 1000),
  sessionId,
} = {}) {
  if (algorithm !== 'HS256') {
    throw new Error(`Unsupported JWT algorithm: ${algorithm}`);
  }
  const jwtSecret = normalizeSecret(secret);
  const header = { alg: algorithm, typ: 'JWT' };
  const session = sessionId || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : cryptoRandomUuid());
  const payloadEnvelope = {
    ...payload,
    sessionId: payload?.sessionId || session,
    iat: issuedAt,
    exp: issuedAt + ttlSeconds,
  };

  const key = await importHmacKey(jwtSecret);
  const signingInput = `${toBase64Url(jsonEncode(header))}.${toBase64Url(jsonEncode(payloadEnvelope))}`;
  const signature = await getCrypto().subtle.sign('HMAC', key, encoder.encode(signingInput));
  const token = `${signingInput}.${toBase64Url(new Uint8Array(signature))}`;

  return {
    token,
    sessionId: payloadEnvelope.sessionId,
    expiresAt: payloadEnvelope.exp,
    issuedAt: payloadEnvelope.iat,
  };
}

export async function verifyToken(token, {
  env,
  secret = env?.JWT_SECRET,
  algorithm = DEFAULT_ALGORITHM,
  clockToleranceSeconds = DEFAULT_CLOCK_TOLERANCE,
  allowExpired = false,
  sessionStore,
} = {}) {
  if (typeof token !== 'string' || !token.includes('.')) {
    throw new Error('Invalid token format.');
  }
  const [encodedHeader, encodedPayload, encodedSignature] = token.split('.');
  if (!encodedHeader || !encodedPayload || !encodedSignature) {
    throw new Error('Token must contain header, payload, and signature segments.');
  }

  const header = jsonDecode(fromBase64Url(encodedHeader));
  if (!header || header.alg !== algorithm) {
    throw new Error(`Unexpected JWT algorithm: ${header?.alg}`);
  }

  const payload = jsonDecode(fromBase64Url(encodedPayload));
  if (payload == null || typeof payload !== 'object') {
    throw new Error('Token payload must be an object.');
  }

  const key = await importHmacKey(secret || '');
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signatureBytes = fromBase64Url(encodedSignature);
  const verified = await getCrypto().subtle.verify('HMAC', key, signatureBytes, encoder.encode(signingInput));
  if (!verified) {
    throw new Error('Invalid token signature.');
  }

  const now = Math.floor(Date.now() / 1000);
  if (!allowExpired) {
    if (typeof payload.exp !== 'number') {
      throw new Error('Token payload missing exp claim.');
    }
    if (payload.exp + (clockToleranceSeconds || 0) < now) {
      throw new Error('Token has expired.');
    }
  }

  if (typeof payload.iat !== 'number') {
    payload.iat = now;
  }

  if (payload.sessionId) {
    const revoked = await isSessionRevoked(payload.sessionId, { env, sessionStore });
    if (revoked) {
      throw new Error('Token session has been revoked.');
    }
  }

  return { header, payload };
}

export async function invalidateSession(sessionId, {
  env,
  sessionStore,
  ttlSeconds = DEFAULT_REVOCATION_TTL,
} = {}) {
  if (!sessionId) return;
  const store = ensureSessionStore({ env, sessionStore });
  if (!store?.put) return;
  const data = JSON.stringify({
    status: 'revoked',
    revokedAt: new Date().toISOString(),
  });
  if (ttlSeconds) {
    await store.put(sessionKey(sessionId), data, { expirationTtl: ttlSeconds });
  } else {
    await store.put(sessionKey(sessionId), data);
  }
}

export async function isSessionRevoked(sessionId, {
  env,
  sessionStore,
} = {}) {
  if (!sessionId) return false;
  const store = ensureSessionStore({ env, sessionStore });
  if (!store?.get) return false;
  const value = await store.get(sessionKey(sessionId));
  return Boolean(value);
}

export async function cleanupSession(sessionId, {
  env,
  sessionStore,
} = {}) {
  if (!sessionId) return;
  const store = ensureSessionStore({ env, sessionStore });
  if (!store?.delete) return;
  await store.delete(sessionKey(sessionId));
}

function cryptoRandomUuid() {
  const crypto = getCrypto();
  if (crypto.randomUUID) return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0'));
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`;
}

export function decodeToken(token) {
  if (typeof token !== 'string' || !token.includes('.')) {
    throw new Error('Invalid token format.');
  }
  const [encodedHeader, encodedPayload] = token.split('.', 2);
  const header = jsonDecode(fromBase64Url(encodedHeader));
  const payload = jsonDecode(fromBase64Url(encodedPayload));
  return { header, payload };
}
