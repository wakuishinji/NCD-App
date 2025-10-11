import { describe, expect, it } from 'vitest';
import worker from '../../functions/index.js';

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

describe('clinic API storage', () => {
  it('cleans legacy name indexes when a clinic is renamed', async () => {
    const env = createEnv();
    const registerResponse = await worker.fetch(
      jsonRequest('https://example.com/api/registerClinic', 'POST', { name: '旧名称クリニック' }),
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
        schema_version: 1,
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
