const encoder = new TextEncoder();

function getCrypto() {
  if (!globalThis.crypto?.subtle) {
    throw new Error('Web Crypto API is required for token utilities.');
  }
  return globalThis.crypto;
}

function randomBytes(size = 32) {
  const crypto = getCrypto();
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  return bytes;
}

function toBase64Url(bytes) {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64url');
  }
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function generateTokenString(size = 32) {
  return toBase64Url(randomBytes(size));
}

export function generateInviteToken() {
  return generateTokenString(48);
}
