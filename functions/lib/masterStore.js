import { normalizeSlug } from '../idUtils.js';

function resolveD1Binding(env) {
  if (env && typeof env.MASTERS_D1?.prepare === 'function') {
    return env.MASTERS_D1;
  }
  if (env && typeof env.DB?.prepare === 'function') {
    return env.DB;
  }
  return null;
}

export function hasD1MasterStore(env) {
  return Boolean(resolveD1Binding(env));
}

function parseJson(value, fallback) {
  if (!value) return fallback;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch (_) {
      return fallback;
    }
  }
  if (typeof value === 'object') return value;
  return fallback;
}

function parseJsonArray(value) {
  const parsed = parseJson(value, []);
  return Array.isArray(parsed) ? parsed : [];
}

function parseJsonObject(value) {
  const parsed = parseJson(value, {});
  return parsed && typeof parsed === 'object' ? parsed : {};
}

function normalizeNfkc(value) {
  return typeof value === 'string' ? value.normalize('NFKC') : '';
}

function mapMetadataToFields(record) {
  const metadata = record.metadata && typeof record.metadata === 'object' ? record.metadata : {};
  if (!metadata) return;
  if (Array.isArray(metadata.synonyms) && !record.synonyms) {
    record.synonyms = metadata.synonyms.slice();
  }
  if (Array.isArray(metadata.defaultServices) && !record.defaultServices) {
    record.defaultServices = metadata.defaultServices.slice();
  }
  if (Array.isArray(metadata.defaultTests) && !record.defaultTests) {
    record.defaultTests = metadata.defaultTests.slice();
  }
  if (Array.isArray(metadata.bodySiteRefs) && !record.bodySiteRefs) {
    record.bodySiteRefs = metadata.bodySiteRefs.slice();
  }
  if (Array.isArray(metadata.severityTags) && !record.severityTags) {
    record.severityTags = metadata.severityTags.slice();
  }
  if (Array.isArray(metadata.icd10) && !record.icd10) {
    record.icd10 = metadata.icd10.slice();
  }
  if (Array.isArray(metadata.icd10Codes) && !record.icd10Codes) {
    record.icd10Codes = metadata.icd10Codes.slice();
  }
  if (typeof metadata.patientLabel === 'string' && !record.patientLabel) {
    record.patientLabel = metadata.patientLabel;
  }
  if (metadata.extra && typeof metadata.extra === 'object') {
    record.extra = { ...metadata.extra };
  }
}

function mapMasterRow(row, type) {
  const metadata = parseJsonObject(row.metadata);
  const explanations = parseJsonArray(row.explanations);
  const legacyAliases = parseJsonArray(row.legacy_aliases);
  const sources = parseJsonArray(row.sources);
  const descSamples = parseJsonArray(row.desc_samples);

  const record = {
    _source: 'd1',
    _key: row.legacy_key || `master:${type}:${row.id}`,
    id: row.id,
    type: row.type || type,
    organizationId: row.organization_id || null,
    category: row.category || '',
    name: row.name || '',
    canonical_name: row.canonical_name || null,
    status: row.status || 'candidate',
    classification: row.classification || null,
    medicalField: row.medical_field || null,
    sortGroup: row.sort_group || null,
    sortOrder: Number.isFinite(row.sort_order) ? row.sort_order : Number(row.sort_order),
    desc: row.description || null,
    notes: row.notes || null,
    referenceUrl: row.reference_url || null,
    count: Number.isFinite(row.count) ? row.count : Number(row.count) || 0,
    sources,
    desc_samples: descSamples,
    explanations,
    metadata,
    legacyKey: row.legacy_key || null,
    legacyAliases,
    comparableKey: row.comparable_key || null,
    normalizedName: row.normalized_name || null,
    normalizedCategory: row.normalized_category || null,
    created_at: Number.isFinite(row.created_at) ? row.created_at : null,
    updated_at: Number.isFinite(row.updated_at) ? row.updated_at : null,
  };

  mapMetadataToFields(record);

  if (!record.synonyms) record.synonyms = [];
  if (!record.defaultServices) record.defaultServices = [];
  if (!record.defaultTests) record.defaultTests = [];
  if (!record.bodySiteRefs) record.bodySiteRefs = [];
  if (!record.severityTags) record.severityTags = [];
  if (!record.icd10) record.icd10 = [];
  if (!record.icd10Codes) record.icd10Codes = [];

  return record;
}

export async function listMasterItemsD1(env, { type, status = null, organizationId = null } = {}) {
  const d1 = resolveD1Binding(env);
  if (!d1 || !type) return null;

  const orgParam = organizationId ?? null;
  const statusParam = status ?? null;
  const sql = `
SELECT *
FROM master_items
WHERE type = ?1
  AND (
    (?2 IS NULL AND organization_id IS NULL)
    OR organization_id = ?2
  )
  AND (?3 IS NULL OR status = ?3)
ORDER BY
  CASE WHEN organization_id = ?2 THEN 0 ELSE 1 END,
  CASE WHEN sort_order IS NULL THEN 1 ELSE 0 END,
  sort_order,
  name COLLATE NOCASE
`;

  const statement = d1.prepare(sql).bind(type, orgParam, statusParam);
  const { results, error } = await statement.all();
  if (error) {
    console.warn('[masterStore] failed to read master_items from D1', error);
    return null;
  }

  const seen = new Set();
  const items = [];
  for (const row of results || []) {
    const record = mapMasterRow(row, type);
    const key = record.id || normalizeSlug(record.name || '', { maxLength: 80 });
    if (seen.has(key)) continue;
    seen.add(key);
    if (!record._key) {
      record._key = `master:${type}:${record.id || key}`;
    }
    items.push(record);
  }
  return items;
}

export async function listMasterCategoriesD1(env, { type, organizationId = null } = {}) {
  const d1 = resolveD1Binding(env);
  if (!d1 || !type) return null;

  const orgParam = organizationId ?? null;
  const sql = `
SELECT name, organization_id, display_order
FROM master_categories
WHERE type = ?1
  AND (
    (?2 IS NULL AND organization_id IS NULL)
    OR organization_id = ?2
  )
ORDER BY
  CASE WHEN organization_id = ?2 THEN 0 ELSE 1 END,
  CASE WHEN display_order IS NULL THEN 1 ELSE 0 END,
  display_order,
  name COLLATE NOCASE
`;

  const statement = d1.prepare(sql).bind(type, orgParam);
  const { results, error } = await statement.all();
  if (error) {
    console.warn('[masterStore] failed to read master_categories from D1', error);
    return null;
  }

  const seen = new Set();
  const categories = [];
  for (const row of results || []) {
    const name = (row.name || '').trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    categories.push(name);
  }
  return categories;
}

async function fetchSingleMasterRow(statement, fallbackType) {
  try {
    const row = await statement.first();
    if (!row) return null;
    const inferredType = row.type || fallbackType || null;
    return mapMasterRow(row, inferredType);
  } catch (error) {
    console.warn('[masterStore] failed to fetch master item from D1', error);
    return null;
  }
}

export async function getMasterItemByIdD1(env, id) {
  const d1 = resolveD1Binding(env);
  if (!d1 || !id) return null;
  const statement = d1.prepare('SELECT * FROM master_items WHERE id = ?1 LIMIT 1').bind(id);
  return fetchSingleMasterRow(statement);
}

export async function getMasterItemByLegacyKeyD1(env, legacyKey) {
  const d1 = resolveD1Binding(env);
  if (!d1 || !legacyKey) return null;
  const statement = d1.prepare('SELECT * FROM master_items WHERE legacy_key = ?1 LIMIT 1').bind(legacyKey);
  return fetchSingleMasterRow(statement);
}

export async function getMasterItemByAliasD1(env, alias) {
  const d1 = resolveD1Binding(env);
  if (!d1 || !alias) return null;
  try {
    const row = await d1.prepare('SELECT item_id FROM master_item_aliases WHERE alias = ?1 LIMIT 1').bind(alias).first();
    if (!row?.item_id) return null;
    return getMasterItemByIdD1(env, row.item_id);
  } catch (error) {
    console.warn('[masterStore] failed to resolve alias in D1', error);
    return null;
  }
}

export async function getMasterItemByComparableD1(env, { type, category, name }) {
  const d1 = resolveD1Binding(env);
  if (!d1 || !type) return null;
  const comparable = comparableKey(type, category, name);
  if (!comparable) return null;
  const statement = d1.prepare('SELECT * FROM master_items WHERE comparable_key = ?1 LIMIT 1').bind(comparable);
  return fetchSingleMasterRow(statement, type);
}

function normalizeSegment(value) {
  const normalized = normalizeNfkc(value).trim().toLowerCase();
  if (!normalized) return '';
  return normalized.replace(/\s+/g, '');
}

function normalizeForComparable(value) {
  return normalizeNfkc(value)
    .toLowerCase()
    .replace(/[\s\u3000・･\-ー（）()]/g, '');
}

function comparableKey(type, category, name) {
  const t = normalizeSegment(type);
  const c = normalizeSegment(category);
  const n = normalizeSegment(name);
  if (!t || !c || !n) return null;
  return `${t}:${c}|${n}`;
}

function legacyKeyFromParts(type, category, name) {
  const comparable = comparableKey(type, category, name);
  return comparable ? `master:${comparable}` : null;
}

function buildMetadata(record) {
  const base = record.metadata && typeof record.metadata === 'object' ? { ...record.metadata } : {};
  const assignIfArray = (key, value) => {
    if (!Array.isArray(value) || !value.length) {
      delete base[key];
      return;
    }
    base[key] = Array.from(new Set(value.map((entry) => (typeof entry === 'string' ? entry.trim() : entry)).filter(Boolean)));
  };
  const assignIfValue = (key, value) => {
    if (value === null || value === undefined || value === '') {
      delete base[key];
      return;
    }
    base[key] = value;
  };

  assignIfArray('synonyms', record.synonyms);
  assignIfArray('defaultServices', record.defaultServices);
  assignIfArray('defaultTests', record.defaultTests);
  assignIfArray('bodySiteRefs', record.bodySiteRefs);
  assignIfArray('severityTags', record.severityTags);
  assignIfArray('icd10', record.icd10);
  assignIfArray('icd10Codes', record.icd10Codes);
  assignIfArray('aliases', record.aliases);
  assignIfArray('thesaurusRefs', record.thesaurusRefs);
  assignIfValue('patientLabel', record.patientLabel);
  assignIfValue('anatomicalSystem', record.anatomicalSystem);
  assignIfValue('issuer', record.issuer);
  assignIfValue('qualificationCode', record.qualificationCode);
  assignIfValue('code', record.code);
  assignIfValue('unit', record.unit);
  assignIfValue('duration', record.duration);
  assignIfValue('notesMeta', record.notesMeta);
  assignIfValue('extra', record.extra && typeof record.extra === 'object' ? record.extra : undefined);

  return base;
}

function normalizeForSearch(value) {
  return normalizeNfkc(value)
    .toLowerCase()
    .replace(/[\s\u3000・･\-ー（）()]/g, '');
}

export async function upsertMasterItemD1(env, record) {
  const d1 = resolveD1Binding(env);
  if (!d1) return false;
  if (!record || typeof record !== 'object') return false;
  const { id, type } = record;
  if (!id || !type) return false;

  const organizationId = record.organizationId ?? null;
  const category = record.category ?? '';
  const name = record.name ?? '';

  const legacyAliases = Array.isArray(record.legacyAliases)
    ? Array.from(new Set(record.legacyAliases.filter(Boolean)))
    : [];
  if (record.legacyKey && !legacyAliases.includes(record.legacyKey)) {
    legacyAliases.push(record.legacyKey);
  }

  const metadata = buildMetadata(record);
  const metadataJson = Object.keys(metadata).length ? JSON.stringify(metadata) : null;
  const sourcesJson = Array.isArray(record.sources) && record.sources.length ? JSON.stringify(record.sources) : null;
  const descSamplesJson = Array.isArray(record.desc_samples) && record.desc_samples.length ? JSON.stringify(record.desc_samples) : null;
  const explanationsJson = Array.isArray(record.explanations) && record.explanations.length ? JSON.stringify(record.explanations) : null;
  const legacyAliasesJson = legacyAliases.length ? JSON.stringify(legacyAliases) : null;

  const comparable = record.comparableKey || comparableKey(type, category, name);
  const normalizedName = record.normalizedName || normalizeForComparable(name);
  const normalizedCategory = record.normalizedCategory || normalizeForComparable(category);
  const legacyKey = record.legacyKey || legacyKeyFromParts(type, category, name);

  const now = Math.floor(Date.now() / 1000);
  const createdAt = Number.isFinite(record.created_at) ? record.created_at : now;
  const updatedAt = now;

  await d1.prepare(`
INSERT INTO master_items (
  id, organization_id, type, category, name, canonical_name, status, classification,
  medical_field, sort_group, sort_order, description, notes, reference_url, count,
  sources, desc_samples, explanations, metadata, legacy_key, legacy_aliases,
  comparable_key, normalized_name, normalized_category, created_at, updated_at
) VALUES (
  ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
)
ON CONFLICT(id) DO UPDATE SET
  organization_id = excluded.organization_id,
  type = excluded.type,
  category = excluded.category,
  name = excluded.name,
  canonical_name = excluded.canonical_name,
  status = excluded.status,
  classification = excluded.classification,
  medical_field = excluded.medical_field,
  sort_group = excluded.sort_group,
  sort_order = excluded.sort_order,
  description = excluded.description,
  notes = excluded.notes,
  reference_url = excluded.reference_url,
  count = excluded.count,
  sources = excluded.sources,
  desc_samples = excluded.desc_samples,
  explanations = excluded.explanations,
  metadata = excluded.metadata,
  legacy_key = excluded.legacy_key,
  legacy_aliases = excluded.legacy_aliases,
  comparable_key = excluded.comparable_key,
  normalized_name = excluded.normalized_name,
  normalized_category = excluded.normalized_category,
  updated_at = excluded.updated_at
`).bind(
    id,
    organizationId,
    type,
    category,
    name,
    record.canonical_name ?? null,
    record.status ?? 'candidate',
    record.classification ?? null,
    record.medicalField ?? null,
    record.sortGroup ?? null,
    Number.isFinite(record.sortOrder) ? record.sortOrder : null,
    record.desc ?? null,
    record.notes ?? null,
    record.referenceUrl ?? null,
    Number.isFinite(record.count) ? record.count : 0,
    sourcesJson,
    descSamplesJson,
    explanationsJson,
    metadataJson,
    legacyKey,
    legacyAliasesJson,
    comparable,
    normalizedName,
    normalizedCategory,
    createdAt,
    updatedAt
  ).run();
  await d1.prepare(`DELETE FROM master_item_aliases WHERE item_id = ?`).bind(id).run();
  for (const alias of legacyAliases) {
    const normalizedAlias = normalizeForComparable(alias);
    await d1.prepare(`
INSERT INTO master_item_aliases (alias, item_id, normalized_alias, source)
VALUES (?, ?, ?, ?)
ON CONFLICT(alias) DO UPDATE SET
  item_id = excluded.item_id,
  normalized_alias = excluded.normalized_alias,
  source = excluded.source
`).bind(alias, id, normalizedAlias || null, alias === legacyKey ? 'legacy' : 'alias').run();
  }
  return true;
}

export async function replaceMasterCategoriesD1(env, { type, categories, organizationId = null } = {}) {
  const d1 = resolveD1Binding(env);
  if (!d1 || !type) return false;
  const list = Array.isArray(categories) ? categories : [];
  const statements = [];

  if (organizationId === null) {
    statements.push(d1.prepare('DELETE FROM master_categories WHERE type = ? AND organization_id IS NULL').bind(type));
  } else {
    statements.push(d1.prepare('DELETE FROM master_categories WHERE type = ? AND organization_id = ?').bind(type, organizationId));
  }

  list.forEach((name, index) => {
    if (typeof name !== 'string') return;
    const trimmed = name.trim();
    if (!trimmed) return;
    const stmt = d1.prepare(`
INSERT INTO master_categories (organization_id, type, name, display_order, is_default, metadata)
VALUES (?, ?, ?, ?, 1, NULL)
ON CONFLICT(organization_id, type, name) DO UPDATE SET
  display_order = excluded.display_order,
  is_default = excluded.is_default
`).bind(organizationId, type, trimmed, index);
    statements.push(stmt);
  });

  await d1.batch(statements);
  return true;
}

export async function deleteMasterItemD1(env, { id }) {
  const d1 = resolveD1Binding(env);
  if (!d1 || !id) return false;
  const statements = [
    d1.prepare('DELETE FROM master_item_aliases WHERE item_id = ?').bind(id),
    d1.prepare('DELETE FROM master_items WHERE id = ?').bind(id),
  ];
  await d1.batch(statements);
  return true;
}
