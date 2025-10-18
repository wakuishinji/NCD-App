import { describe, expect, it } from 'vitest';
import worker from '../../functions/index.js';
import { hashPassword } from '../../functions/lib/auth/password.js';
import { verifyToken } from '../../functions/lib/auth/jwt.js';

class KVNamespaceStub {
  constructor() {
    this.store = new Map();
  }

  async get(key) {
    return this.store.has(key) ? this.store.get(key) : null;
  }

  async put(key, value) {
    this.store.set(key, value);
  }

  async delete(key) {
    this.store.delete(key);
  }

  async list({ prefix = '', cursor } = {}) {
    const allKeys = Array.from(this.store.keys())
      .filter((key) => key.startsWith(prefix))
      .sort();
    const start = cursor ? Number(cursor) : 0;
    const pageSize = 1000;
    const slice = allKeys.slice(start, start + pageSize);
    const nextIndex = start + slice.length;
    return {
      keys: slice.map((name) => ({ name })),
      list_complete: nextIndex >= allKeys.length,
      cursor: nextIndex < allKeys.length ? String(nextIndex) : undefined,
    };
  }
}

function createEnv() {
  return {
    SETTINGS: new KVNamespaceStub(),
    JWT_SECRET: 'test-secret',
  };
}

function jsonRequest(url, method, body) {
  return new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

function jsonAuthRequest(url, method, body, token) {
  return new Request(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

async function seedAccount(env, {
  accountId = '11111111-1111-1111-1111-111111111111',
  loginId = 'admin',
  email = 'admin@example.com',
  role = 'systemAdmin',
  password = 'Passw0rd!',
} = {}) {
  const passwordHash = await hashPassword(password);
  const accountRecord = {
    id: `account:${accountId}`,
    loginId,
    primaryEmail: email,
    role,
    status: 'active',
    passwordHash,
    membershipIds: [],
    profile: {
      displayName: 'Admin User',
    },
  };
  await env.SETTINGS.put(`account:id:${accountId}`, JSON.stringify(accountRecord));
  await env.SETTINGS.put(`account:login:${loginId.toLowerCase()}`, accountId);
  await env.SETTINGS.put(`account:email:${email.toLowerCase()}`, accountId);
  return { accountRecord, password };
}

describe('auth API', () => {
  it('requires auth for facility admin registration', async () => {
    const env = createEnv();
    await env.SETTINGS.put('clinic:id:clinic-1', JSON.stringify({
      id: 'clinic-1',
      name: 'テスト診療所',
      schema_version: 1,
    }));

    const res = await worker.fetch(
      jsonRequest('https://example.com/api/auth/registerFacilityAdmin', 'POST', {
        clinicId: 'clinic-1',
        email: 'manager@example.com',
      }),
      env,
    );
    expect(res.status).toBe(401);
  });

  it('creates facility admin invite', async () => {
    const env = createEnv();
    await env.SETTINGS.put('clinic:id:clinic-1', JSON.stringify({
      id: 'clinic-1',
      name: 'テスト診療所',
      schema_version: 1,
      pendingInvites: [],
    }));

    await seedAccount(env);

    const loginRes = await worker.fetch(
      jsonRequest('https://example.com/api/auth/login', 'POST', {
        identifier: 'admin',
        password: 'Passw0rd!',
      }),
      env,
    );
    const loginPayload = await loginRes.json();
    const { accessToken } = loginPayload.tokens;

    const inviteRes = await worker.fetch(
      jsonAuthRequest('https://example.com/api/auth/registerFacilityAdmin', 'POST', {
        clinicId: 'clinic-1',
        email: 'manager@example.com',
        displayName: '管理 太郎',
      }, accessToken),
      env,
    );
    expect(inviteRes.ok).toBe(true);
    const invitePayload = await inviteRes.json();
    expect(invitePayload.ok).toBe(true);
    expect(invitePayload.invite.email).toBe('manager@example.com');
    expect(typeof invitePayload.token).toBe('string');

    const storedInvite = await env.SETTINGS.get(`invite:${invitePayload.invite.id}`);
    expect(storedInvite).not.toBeNull();

    const clinicRaw = await env.SETTINGS.get('clinic:id:clinic-1');
    const clinic = JSON.parse(clinicRaw);
    expect(Array.isArray(clinic.pendingInvites)).toBe(true);
    expect(clinic.pendingInvites.length).toBe(1);
    expect(clinic.pendingInvites[0].email).toBe('manager@example.com');
  });

  it('accepts facility admin invite and creates account', async () => {
    const env = createEnv();
    await env.SETTINGS.put('clinic:id:clinic-1', JSON.stringify({
      id: 'clinic-1',
      name: 'テスト診療所',
      schema_version: 1,
      pendingInvites: [],
      managerAccounts: [],
      staffMemberships: [],
    }));

    await seedAccount(env);

    const loginRes = await worker.fetch(
      jsonRequest('https://example.com/api/auth/login', 'POST', {
        identifier: 'admin',
        password: 'Passw0rd!',
      }),
      env,
    );
    const loginPayload = await loginRes.json();
    const { accessToken } = loginPayload.tokens;

    const inviteRes = await worker.fetch(
      jsonAuthRequest('https://example.com/api/auth/registerFacilityAdmin', 'POST', {
        clinicId: 'clinic-1',
        email: 'manager@example.com',
        displayName: '管理 太郎',
      }, accessToken),
      env,
    );
    const invitePayload = await inviteRes.json();

    const acceptRes = await worker.fetch(
      jsonRequest('https://example.com/api/auth/acceptInvite', 'POST', {
        token: invitePayload.token,
        password: 'ManagerPass1!',
        passwordConfirm: 'ManagerPass1!',
        displayName: '管理 太郎',
      }),
      env,
    );
    expect(acceptRes.ok).toBe(true);
    const accepted = await acceptRes.json();
    expect(accepted.ok).toBe(true);
    expect(accepted.account.role).toBe('clinicAdmin');
    expect(accepted.tokens.accessToken).toBeTypeOf('string');

    const pointer = await env.SETTINGS.get('account:email:manager@example.com');
    expect(pointer).toBeTypeOf('string');
    const accountRaw = await env.SETTINGS.get(`account:id:${pointer}`);
    const accountRecord = JSON.parse(accountRaw);
    expect(accountRecord.role).toBe('clinicAdmin');
    expect(Array.isArray(accountRecord.membershipIds)).toBe(true);
    expect(accountRecord.membershipIds.length).toBe(1);

    const membershipId = accountRecord.membershipIds[0];
    const membershipRaw = await env.SETTINGS.get(membershipId);
    expect(membershipRaw).not.toBeNull();
    const membershipRecord = JSON.parse(membershipRaw);
    expect(membershipRecord.clinicId).toBe('clinic-1');
    expect(membershipRecord.roles).toContain('clinicAdmin');

    const clinicRaw = await env.SETTINGS.get('clinic:id:clinic-1');
    const clinic = JSON.parse(clinicRaw);
    expect(new Set(clinic.managerAccounts)).toContain(accountRecord.id);
    expect(new Set(clinic.staffMemberships)).toContain(membershipId);
    expect(clinic.pendingInvites.length).toBe(0);

    const inviteStore = await env.SETTINGS.get(`invite:${invitePayload.invite.id}`);
    const inviteRecord = JSON.parse(inviteStore);
    expect(inviteRecord.status).toBe('accepted');

    const inviteTokens = await env.SETTINGS.list({ prefix: 'inviteToken:' });
    expect(inviteTokens.keys.length).toBe(0);
  });

  it('invites staff as system admin', async () => {
    const env = createEnv();
    await env.SETTINGS.put('clinic:id:clinic-2', JSON.stringify({
      id: 'clinic-2',
      name: 'スタッフ診療所',
      schema_version: 1,
      pendingInvites: [],
      managerAccounts: [],
      staffMemberships: [],
    }));

    await seedAccount(env);

    const loginRes = await worker.fetch(
      jsonRequest('https://example.com/api/auth/login', 'POST', {
        identifier: 'admin',
        password: 'Passw0rd!',
      }),
      env,
    );
    const loginPayload = await loginRes.json();
    const { accessToken } = loginPayload.tokens;

    const inviteRes = await worker.fetch(
      jsonAuthRequest('https://example.com/api/auth/inviteStaff', 'POST', {
        clinicId: 'clinic-2',
        email: 'staff@example.com',
        displayName: 'スタッフ 花子',
      }, accessToken),
      env,
    );
    expect(inviteRes.ok).toBe(true);
    const invitePayload = await inviteRes.json();
    expect(invitePayload.invite.role).toBe('clinicStaff');

    const clinicRaw = await env.SETTINGS.get('clinic:id:clinic-2');
    const clinic = JSON.parse(clinicRaw);
    expect(clinic.pendingInvites.length).toBe(1);
    expect(clinic.pendingInvites[0].email).toBe('staff@example.com');
  });

  it('requests password reset and issues token', async () => {
    const env = createEnv();
    env.RETURN_RESET_TOKEN = '1';
    await seedAccount(env);

    const res = await worker.fetch(
      jsonRequest('https://example.com/api/auth/requestPasswordReset', 'POST', {
        email: 'admin@example.com',
      }),
      env,
    );
    expect(res.ok).toBe(true);
    const payload = await res.json();
    expect(payload.ok).toBe(true);
    expect(payload.token).toBeTypeOf('string');

    const list = await env.SETTINGS.list({ prefix: 'passwordReset:' });
    expect(list.keys.length).toBe(1);
  });

  it('resets password and allows new login', async () => {
    const env = createEnv();
    env.RETURN_RESET_TOKEN = '1';
    await seedAccount(env);

    const requestRes = await worker.fetch(
      jsonRequest('https://example.com/api/auth/requestPasswordReset', 'POST', {
        email: 'admin@example.com',
      }),
      env,
    );
    const requestPayload = await requestRes.json();
    const token = requestPayload.token;
    expect(token).toBeTypeOf('string');

    const resetRes = await worker.fetch(
      jsonRequest('https://example.com/api/auth/resetPassword', 'POST', {
        token,
        password: 'NewPass123!',
        passwordConfirm: 'NewPass123!',
      }),
      env,
    );
    expect(resetRes.ok).toBe(true);

    const oldLogin = await worker.fetch(
      jsonRequest('https://example.com/api/auth/login', 'POST', {
        identifier: 'admin',
        password: 'Passw0rd!',
      }),
      env,
    );
    expect(oldLogin.status).toBe(401);

    const newLogin = await worker.fetch(
      jsonRequest('https://example.com/api/auth/login', 'POST', {
        identifier: 'admin',
        password: 'NewPass123!',
      }),
      env,
    );
    expect(newLogin.ok).toBe(true);
  });

  it('logs in and returns tokens', async () => {
    const env = createEnv();
    await seedAccount(env);

    const res = await worker.fetch(
      jsonRequest('https://example.com/api/auth/login', 'POST', {
        identifier: 'admin',
        password: 'Passw0rd!',
      }),
      env,
    );
    expect(res.ok).toBe(true);
    const payload = await res.json();
    expect(payload.ok).toBe(true);
    expect(payload.account.role).toBe('systemAdmin');
    expect(payload.tokens.accessToken).toBeTypeOf('string');
    expect(payload.tokens.refreshToken).toBeTypeOf('string');
    expect(payload.tokens.sessionId).toBeTypeOf('string');
  });

  it('rejects invalid credentials', async () => {
    const env = createEnv();
    await seedAccount(env);

    const res = await worker.fetch(
      jsonRequest('https://example.com/api/auth/login', 'POST', {
        identifier: 'admin',
        password: 'wrong-password',
      }),
      env,
    );
    expect(res.status).toBe(401);
    const payload = await res.json();
    expect(payload.error).toBe('AUTH_FAILED');
  });

  it('refreshes token and revokes previous session', async () => {
    const env = createEnv();
    await seedAccount(env);

    const loginRes = await worker.fetch(
      jsonRequest('https://example.com/api/auth/login', 'POST', {
        identifier: 'admin@example.com',
        password: 'Passw0rd!',
        remember: true,
      }),
      env,
    );
    const loginPayload = await loginRes.json();
    const { refreshToken, sessionId } = loginPayload.tokens;

    const refreshRes = await worker.fetch(
      jsonRequest('https://example.com/api/auth/refresh', 'POST', {
        refreshToken,
      }),
      env,
    );
    expect(refreshRes.ok).toBe(true);
    const refreshed = await refreshRes.json();
    expect(refreshed.tokens.sessionId).not.toBe(sessionId);

    // old refresh token should now be invalid
    const res2 = await worker.fetch(
      jsonRequest('https://example.com/api/auth/refresh', 'POST', {
        refreshToken,
      }),
      env,
    );
    expect(res2.status).toBe(401);
  });

  it('logs out and revokes session', async () => {
    const env = createEnv();
    await seedAccount(env);

    const loginRes = await worker.fetch(
      jsonRequest('https://example.com/api/auth/login', 'POST', {
        identifier: 'admin',
        password: 'Passw0rd!',
      }),
      env,
    );
    const loginPayload = await loginRes.json();
    const { accessToken, sessionId } = loginPayload.tokens;

    const logoutRes = await worker.fetch(
      jsonRequest('https://example.com/api/auth/logout', 'POST', {
        sessionId,
      }),
      env,
    );
    expect(logoutRes.ok).toBe(true);

    await expect(
      verifyToken(accessToken, {
        env,
        sessionStore: env.SETTINGS,
      }),
    ).rejects.toThrowError(/revoked/i);
  });
});
