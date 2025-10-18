import { describe, expect, it } from 'vitest';
import {
  createToken,
  verifyToken,
  invalidateSession,
  isSessionRevoked,
  decodeToken,
} from '../../functions/lib/auth/jwt.js';

class MemoryKv {
  private store = new Map<string, { value: string; expiresAt?: number }>();

  async put(key: string, value: string, options?: { expirationTtl?: number }) {
    const expiresAt = options?.expirationTtl
      ? Date.now() + options.expirationTtl * 1000
      : undefined;
    this.store.set(key, { value, expiresAt });
  }

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt && entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async delete(key: string) {
    this.store.delete(key);
  }
}

const env = {
  JWT_SECRET: 'super-secret-value',
  AUTH_SESSIONS: new MemoryKv(),
};

describe('JWT helpers', () => {
  it('creates and verifies an access token', async () => {
    const payload = {
      sub: 'account:123',
      role: 'clinicAdmin',
      membershipIds: ['membership:xyz'],
    };
    const { token, sessionId, expiresAt } = await createToken(payload, {
      env,
      ttlSeconds: 60,
    });

    expect(token).toBeTypeOf('string');
    expect(sessionId).toMatch(/^.{8,}$/);
    expect(expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));

    const { payload: verified } = await verifyToken(token, { env });
    expect(verified.sub).toBe(payload.sub);
    expect(verified.role).toBe(payload.role);
    expect(verified.membershipIds).toEqual(payload.membershipIds);
    expect(verified.sessionId).toBe(sessionId);
  });

  it('rejects expired tokens by default', async () => {
    const payload = { sub: 'account:expired', role: 'clinicStaff' };
    const pastIssuedAt = Math.floor(Date.now() / 1000) - 3600;
    const { token } = await createToken(payload, {
      env,
      ttlSeconds: 60,
      issuedAt: pastIssuedAt,
    });

    await expect(verifyToken(token, { env })).rejects.toThrowError(/expired/i);
    const decoded = decodeToken(token);
    expect(decoded.payload.sub).toBe(payload.sub);
  });

  it('allows verifying expired tokens when allowExpired is true', async () => {
    const payload = { sub: 'account:expired', role: 'clinicStaff' };
    const pastIssuedAt = Math.floor(Date.now() / 1000) - 3600;
    const { token } = await createToken(payload, {
      env,
      ttlSeconds: 10,
      issuedAt: pastIssuedAt,
    });

    const { payload: verified } = await verifyToken(token, {
      env,
      allowExpired: true,
    });
    expect(verified.sub).toBe(payload.sub);
  });

  it('revokes sessions and prevents verification', async () => {
    const payload = { sub: 'account:revoke', role: 'clinicAdmin' };
    const { token, sessionId } = await createToken(payload, { env });

    expect(await isSessionRevoked(sessionId, { env })).toBe(false);

    await invalidateSession(sessionId, { env, ttlSeconds: 120 });
    expect(await isSessionRevoked(sessionId, { env })).toBe(true);

    await expect(verifyToken(token, { env })).rejects.toThrowError(/revoked/i);
  });
});
