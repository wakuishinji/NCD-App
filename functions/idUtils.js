export function transliterateToAscii(value) {
  if (value === null || value === undefined) return '';
  return value
    .toString()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x00-\x7F]/g, ' ');
}

export function normalizeSlug(value, { maxLength = 64 } = {}) {
  if (!value) return '';
  const transliterated = transliterateToAscii(value);
  const lower = transliterated.toLowerCase();
  const replaced = lower.replace(/[^a-z0-9]+/g, '-');
  const compact = replaced.replace(/-+/g, '-').replace(/^-|-$/g, '');
  return compact.slice(0, maxLength);
}

export function randomSlug(length = 12) {
  const raw = crypto.randomUUID().replace(/[^a-z0-9]/gi, '').toLowerCase();
  if (raw.length >= length) {
    return raw.slice(0, length);
  }
  const extra = (Math.random().toString(36) + Math.random().toString(36)).replace(/[^a-z0-9]/gi, '');
  return (raw + extra).slice(0, length) || 'id';
}

export async function ensureUniqueId({
  kv,
  prefix,
  candidate,
  normalize = normalizeSlug,
  exclude,
  fallback,
  maxSuffix = 50,
  randomLength = 12,
}) {
  if (!kv || typeof kv.get !== 'function') {
    throw new Error('kv with get method is required');
  }
  const normalizeValue = (value) => (normalize ? normalize(value) : value);

  const resolveFallback = async () => {
    if (typeof fallback === 'function') {
      const next = await fallback();
      return normalizeValue(next);
    }
    return normalizeValue(randomSlug(randomLength));
  };

  let base = normalizeValue(candidate);
  if (!base) {
    base = await resolveFallback();
  }

  let slug = base;
  let suffix = 2;
  let guard = 0;

  while (slug && slug !== exclude) {
    const exists = await kv.get(`${prefix}${slug}`);
    if (!exists) break;

    slug = normalizeValue(`${base}-${suffix}`);
    suffix += 1;
    guard += 1;

    if (!slug || guard > maxSuffix) {
      base = await resolveFallback();
      slug = base;
      suffix = 2;
      guard = 0;
    }
  }

  if (!slug) {
    slug = await resolveFallback();
  }

  return slug;
}
