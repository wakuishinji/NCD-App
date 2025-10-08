import { describe, expect, it } from 'vitest';
import { ensureUniqueId, normalizeSlug } from '../../functions/idUtils.js';

function createKV(initial: Record<string, string | null> = {}) {
  const store = new Map<string, string | null>(Object.entries(initial));
  return {
    async get(key: string) {
      return store.has(key) ? store.get(key) : null;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
    async delete(key: string) {
      store.delete(key);
    },
  };
}

describe('idUtils', () => {
  it('normalizes ASCII strings into URL-safe slugs', async () => {
    const kv = createKV();
    const slug = await ensureUniqueId({
      kv,
      prefix: 'master:mode:',
      candidate: 'Primary Care',
      normalize: (value) => normalizeSlug(value, { maxLength: 32 }),
    });
    expect(slug).toBe('primary-care');
  });

  it('appends numeric suffix when candidate already exists', async () => {
    const kv = createKV({ 'master:mode:telemedicine': '{}' });
    const slug = await ensureUniqueId({
      kv,
      prefix: 'master:mode:',
      candidate: 'Telemedicine',
      normalize: (value) => normalizeSlug(value, { maxLength: 32 }),
    });
    expect(slug).toBe('telemedicine-2');
  });

  it('falls back to provided generator when normalization results in empty value', async () => {
    const kv = createKV();
    const slug = await ensureUniqueId({
      kv,
      prefix: 'master:mode:',
      candidate: 'オンライン診療',
      normalize: (value) => normalizeSlug(value, { maxLength: 32 }),
      fallback: () => 'fallback-value',
    });
    expect(slug).toBe('fallback-value');
  });
});
