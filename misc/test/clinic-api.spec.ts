import { describe, expect, it } from 'vitest';
import worker from '../../functions/index.js';
import { hashPassword } from '../../functions/lib/auth/password.js';

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

async function seedSystemRoot(env, {
  accountId = '11111111-1111-1111-1111-111111111112',
  loginId = 'root',
  email = 'root@example.com',
  password = 'Passw0rd!',
} = {}) {
  const passwordHash = await hashPassword(password);
  const record = {
    id: `account:${accountId}`,
    loginId,
    primaryEmail: email,
    role: 'systemRoot',
    status: 'active',
    passwordHash,
    membershipIds: [],
    profile: { displayName: 'System Root' },
  };
  await env.SETTINGS.put(`account:id:${accountId}`, JSON.stringify(record));
  await env.SETTINGS.put(`account:login:${loginId}`, accountId);
  await env.SETTINGS.put(`account:email:${email}`, accountId);
  return { record, password };
}

describe('clinic API storage', () => {
  it('cleans legacy name indexes when a clinic is renamed', async () => {
    const env = createEnv();
    const registerResponse = await worker.fetch(
      jsonRequest('https://example.com/api/registerClinic', 'POST', { name: '旧名称クリニック', mhlwFacilityId: '1311423456' }),
      env,
    );
    expect(registerResponse.ok).toBe(true);
    const registered = await registerResponse.json();
    const clinic = registered.clinic;

    expect(await env.SETTINGS.get(`clinic:name:旧名称クリニック`)).toBe(clinic.id);
    expect(await env.SETTINGS.get(`clinic:旧名称クリニック`)).not.toBeNull();

    const updateResponse = await worker.fetch(
      jsonRequest('https://example.com/api/updateClinic', 'POST', {
        id: clinic.id,
        name: '新名称クリニック',
        address: '東京都中野区例町1-2-3',
        mhlwFacilityId: '1311423456',
      }),
      env,
    );
    expect(updateResponse.ok).toBe(true);

    expect(await env.SETTINGS.get(`clinic:name:旧名称クリニック`)).toBeNull();
    expect(await env.SETTINGS.get(`clinic:旧名称クリニック`)).toBeNull();
    expect(await env.SETTINGS.get(`clinic:name:新名称クリニック`)).toBe(clinic.id);
  });

  it('lists more than the default KV page size of clinics', async () => {
    const env = createEnv();
    const total = 1500;
    for (let i = 0; i < total; i += 1) {
      const id = `clinic-${String(i).padStart(4, '0')}`;
      const record = {
        id,
        name: `テスト診療所${i}`,
        basic: {
          name: `テスト診療所${i}`,
          address: `東京都中野区${i}丁目`,
          postalCode: '1650000',
        },
        schemaVersion: 2,
        schema_version: 2,
        created_at: 1700000000 + i,
        updated_at: 1700000000 + i,
      };
      await env.SETTINGS.put(`clinic:id:${id}`, JSON.stringify(record));
    }

    const res = await worker.fetch(new Request('https://example.com/api/listClinics'), env);
    expect(res.ok).toBe(true);
    const payload = await res.json();
    expect(payload.ok).toBe(true);
    expect(Array.isArray(payload.clinics)).toBe(true);
    expect(payload.clinics.length).toBe(total);
  });
});

describe('clinic MHLW facility ID handling', () => {
  it('prevents duplicate mhlwFacilityId registration', async () => {
    const env = createEnv();
    const first = await worker.fetch(
      jsonRequest('https://example.com/api/registerClinic', 'POST', { name: 'テスト診療所A', mhlwFacilityId: '1311400001' }),
      env,
    );
    expect(first.ok).toBe(true);

    const second = await worker.fetch(
      jsonRequest('https://example.com/api/registerClinic', 'POST', { name: 'テスト診療所B', mhlwFacilityId: '1311400001' }),
      env,
    );
    expect(second.status).toBe(409);
    const payload = await second.json();
    expect(payload.error).toBe('MHLW_FACILITY_ID_CONFLICT');
  });

  it('syncs clinic data from MHLW dataset via admin endpoint', async () => {
    const env = createEnv();
    env.JWT_SECRET = 'test-secret';
    env.AUTH_SESSIONS = env.SETTINGS;

    await seedSystemRoot(env);

    const loginRes = await worker.fetch(
      jsonRequest('https://example.com/api/auth/login', 'POST', {
        identifier: 'root',
        password: 'Passw0rd!',
      }),
      env,
    );
    expect(loginRes.ok).toBe(true);
    const loginPayload = await loginRes.json();
    const accessToken = loginPayload.tokens.accessToken;

    const registerRes = await worker.fetch(
      jsonAuthRequest('https://example.com/api/registerClinic', 'POST', {
        name: '中野テスト診療所',
        mhlwFacilityId: '1311400999',
      }, accessToken),
      env,
    );
    expect(registerRes.ok).toBe(true);
    const registerPayload = await registerRes.json();
    const clinic = registerPayload.clinic;

    const syncRes = await worker.fetch(
      jsonAuthRequest('https://example.com/api/admin/clinic/syncFromMhlw', 'POST', {
        facilityId: '1311400999',
        clinicId: clinic.id,
        facilityData: {
          facilityId: '1311400999',
          name: '中野テスト診療所（厚労省）',
          address: '東京都中野区中央1-1-1',
          postalCode: '1640001',
          phone: '0312345678',
          prefecture: '東京都',
          city: '中野区',
          latitude: 35.7062,
          longitude: 139.6659,
          facilityType: 'clinic',
        },
      }, accessToken),
      env,
    );
    expect(syncRes.ok).toBe(true);
    const syncPayload = await syncRes.json();
    expect(syncPayload.ok).toBe(true);
    expect(syncPayload.clinic.address).toBe('東京都中野区中央1-1-1');
    expect(syncPayload.clinic.postalCode).toBe('1640001');
    expect(syncPayload.clinic.phone).toBe('0312345678');
    expect(syncPayload.clinic.mhlwSnapshot.address).toBe('東京都中野区中央1-1-1');
    expect(syncPayload.clinic.facilityType).toBe('clinic');
  });
});
