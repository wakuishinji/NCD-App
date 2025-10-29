#!/usr/bin/env node
/**
 * Cloudflare D1 migration helper for master data (tests/services/qualifications/etc.).
 *
 * このスクリプトは既存 KV からエクスポートしたマスター JSON を
 * Cloudflare D1 に投入できる SQL へ変換し、必要に応じて実行します。
 *
 * 使い方の例:
 *
 *   node scripts/migrateMastersToD1.mjs \
 *     --dataset tmp/masters-export.json \
 *     --organization default \
 *     --output tmp/masters.sql
 *
 *   node scripts/migrateMastersToD1.mjs \
 *     --master service:exports/master-service.json \
 *     --master test:exports/master-test.json \
 *     --category service:exports/categories-service.json \
 *     --db NCD_D1 \
 *     --truncate
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';

const DEFAULT_CHUNK_SIZE = 200;

function usage() {
  console.log(`migrateMastersToD1\n
Usage:
  node scripts/migrateMastersToD1.mjs [options]

Options:
  --dataset <path>          集約済み JSON (masterItems/categories/explanations を含む)
  --master type:path        listMaster API の結果 (複数可、type は service/test/... )
  --category type:path      listCategories API の結果 (複数可)
  --explanation type:path   master explanations JSON (複数可)
  --organization <id>       対象 organizationId (省略時は NULL=共通マスター)
  --db <binding>            wrangler d1 execute へ適用
  --output <path>           生成された SQL を保存
  --chunk-size <n>          1 トランザクション内の最大ステートメント数 (既定: ${DEFAULT_CHUNK_SIZE})
  --truncate                既存データを organizationId 単位で削除してから投入
  --skip-items              master_items への INSERT をスキップ
  --skip-categories         master_categories への INSERT をスキップ
  --skip-explanations       master_explanations への INSERT をスキップ
  --dry-run                 SQL を生成するが wrangler 実行を行わない
  --help                    このメッセージを表示
`);
}

function parseArgs(argv) {
  const options = {
    dataset: null,
    masterFiles: [],
    categoryFiles: [],
    explanationFiles: [],
    organizationId: null,
    dbBinding: null,
    output: null,
    chunkSize: DEFAULT_CHUNK_SIZE,
    truncate: false,
    skipItems: false,
    skipCategories: false,
    skipExplanations: false,
    dryRun: false,
    useRemote: true,
    usePreview: false,
    help: false,
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--dataset':
        options.dataset = argv[++i];
        break;
      case '--master': {
        const value = argv[++i];
        const [type, file] = splitTypedPath(value);
        options.masterFiles.push({ type, file });
        break;
      }
      case '--category': {
        const value = argv[++i];
        const [type, file] = splitTypedPath(value);
        options.categoryFiles.push({ type, file });
        break;
      }
      case '--explanation': {
        const value = argv[++i];
        const [type, file] = splitTypedPath(value);
        options.explanationFiles.push({ type, file });
        break;
      }
      case '--organization':
        options.organizationId = argv[++i] ?? null;
        break;
      case '--db':
        options.dbBinding = argv[++i];
        break;
      case '--output':
        options.output = argv[++i];
        break;
      case '--chunk':
      case '--chunk-size': {
        const size = Number(argv[++i]);
        if (Number.isFinite(size) && size > 0) {
          options.chunkSize = Math.max(1, Math.floor(size));
        }
        break;
      }
      case '--truncate':
        options.truncate = true;
        break;
      case '--skip-items':
        options.skipItems = true;
        break;
      case '--skip-categories':
        options.skipCategories = true;
        break;
      case '--skip-explanations':
        options.skipExplanations = true;
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--remote':
        options.useRemote = true;
        break;
      case '--local':
      case '--no-remote':
        options.useRemote = false;
        break;
      case '--preview':
        options.usePreview = true;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        console.warn(`Unknown argument: ${arg}`);
        break;
    }
  }
  return options;
}

function splitTypedPath(value) {
  if (!value) return [null, null];
  const idx = value.indexOf(':');
  if (idx === -1) {
    return [null, value];
  }
  const type = value.slice(0, idx) || null;
  const file = value.slice(idx + 1);
  return [type, file];
}

function sqlLiteral(value) {
  if (value === undefined || value === null) return 'NULL';
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return value ? '1' : '0';
  return `'${String(value).replace(/'/g, "''")}'`;
}

function normalizeKeys(record) {
  if (!record || typeof record !== 'object') return {};
  const out = {};
  for (const [key, value] of Object.entries(record)) {
    const camel = key
      .replace(/[_-]+([a-z])/gi, (_, ch) => ch.toUpperCase())
      .replace(/^[A-Z]/, (ch) => ch.toLowerCase());
    out[camel] = value;
  }
  return out;
}

function normalizeNfkc(value) {
  if (typeof value !== 'string') return '';
  return value.normalize('NFKC');
}

function normalizeSegment(value) {
  const normalized = normalizeNfkc(value).trim().toLowerCase();
  if (!normalized) return '';
  return normalized.replace(/\s+/g, '');
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

function normalizeForSearch(value) {
  const normalized = normalizeNfkc(value).toLowerCase();
  return normalized.replace(/[\s\u3000・･\-ー（）()]/g, '');
}

function normalizeAlias(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return normalizeForSearch(trimmed);
}

function coerceTimestamp(value, fallback) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value > 1e12) {
      return Math.floor(value / 1000);
    }
    return Math.floor(value);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return fallback;
    const num = Number(trimmed);
    if (Number.isFinite(num)) {
      return coerceTimestamp(num, fallback);
    }
    const parsed = Date.parse(trimmed);
    if (!Number.isNaN(parsed)) {
      return Math.floor(parsed / 1000);
    }
  }
  return fallback;
}

function ensureStringArray(input) {
  if (!input) return [];
  if (Array.isArray(input)) {
    return Array.from(
      new Set(
        input
          .map((entry) => (typeof entry === 'string' ? entry.trim() : String(entry || '')))
          .filter(Boolean),
      ),
    );
  }
  if (typeof input === 'string') {
    return [input.trim()].filter(Boolean);
  }
  return [];
}

function sanitizeUrl(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith('//')) return `https:${trimmed}`;
  return trimmed;
}

function sanitizeExplanations(list) {
  const fallback = [];
  if (!Array.isArray(list)) return fallback;
  const result = [];
  const seen = new Set();
  const now = Math.floor(Date.now() / 1000);
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    const src = normalizeKeys(entry);
    const text = typeof src.text === 'string' ? src.text.trim() : typeof src.baseText === 'string' ? src.baseText.trim() : typeof src.desc === 'string' ? src.desc.trim() : '';
    if (!text) continue;
    const key = text;
    if (seen.has(key)) continue;
    seen.add(key);
    const id = typeof src.id === 'string' && src.id ? src.id : crypto.randomUUID();
    result.push({
      id,
      text,
      status: typeof src.status === 'string' && src.status ? src.status : 'draft',
      audience: typeof src.audience === 'string' && src.audience ? src.audience : null,
      context: typeof src.context === 'string' && src.context ? src.context : null,
      source: typeof src.source === 'string' && src.source ? src.source : null,
      createdAt: coerceTimestamp(src.createdAt, now),
      updatedAt: coerceTimestamp(src.updatedAt, now),
    });
  }
  return result;
}

async function executeSql(db, sql, index, { useRemote = true, usePreview = false } = {}) {
  const tempFile = path.join(os.tmpdir(), `masters-d1-${Date.now()}-${index}.sql`);
  await fs.promises.writeFile(tempFile, sql, 'utf8');
  try {
    await new Promise((resolve, reject) => {
      const args = ['d1', 'execute'];
      if (useRemote) {
        args.push('--remote');
      } else {
        args.push('--local');
      }
      if (usePreview) {
        args.push('--preview');
      }
      args.push(db, '--yes', '--file', tempFile);
      const proc = spawn('wrangler', args, { stdio: 'inherit' });
      proc.on('exit', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`wrangler d1 execute exited with code ${code}`));
      });
    });
  } finally {
    fs.promises.unlink(tempFile).catch(() => {});
  }
}

function chunkStatements(statements, chunkSize) {
  if (!statements.length) return [];
  const chunks = [];
  for (let i = 0; i < statements.length; i += chunkSize) {
    const chunk = statements.slice(i, i + chunkSize);
    chunks.push(chunk.join('\n'));
  }
  return chunks;
}

function loadJson(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

function applyAggregatedDataset(target, dataset) {
  if (!dataset || typeof dataset !== 'object') return;

  if (dataset.masterItems && typeof dataset.masterItems === 'object') {
    for (const [type, items] of Object.entries(dataset.masterItems)) {
      if (!Array.isArray(items)) continue;
      target.masterItems.set(type, items);
    }
  }
  if (dataset.masters && typeof dataset.masters === 'object') {
    for (const [type, items] of Object.entries(dataset.masters)) {
      if (!Array.isArray(items)) continue;
      target.masterItems.set(type, items);
    }
  }
  if (dataset.items && typeof dataset.items === 'object') {
    for (const [type, items] of Object.entries(dataset.items)) {
      if (Array.isArray(items)) {
        target.masterItems.set(type, items);
      }
    }
  }

  if (dataset.categories && typeof dataset.categories === 'object') {
    for (const [type, categories] of Object.entries(dataset.categories)) {
      if (!categories) continue;
      if (Array.isArray(categories)) {
        target.categories.set(type, categories);
      } else if (typeof categories === 'object' && Array.isArray(categories.items)) {
        target.categories.set(type, categories.items);
      }
    }
  }

  if (dataset.explanations && typeof dataset.explanations === 'object') {
    for (const [type, items] of Object.entries(dataset.explanations)) {
      if (!Array.isArray(items)) continue;
      target.explanations.set(type, items);
    }
  }
}

function loadDatasets(options) {
  const masterItems = new Map();
  const categories = new Map();
  const explanations = new Map();

  if (options.dataset) {
    const aggregated = loadJson(options.dataset);
    applyAggregatedDataset({ masterItems, categories, explanations }, aggregated);
  }

  for (const entry of options.masterFiles) {
    const data = loadJson(entry.file);
    const items = Array.isArray(data) ? data : Array.isArray(data.items) ? data.items : [];
    if (!entry.type) {
      console.warn(`[warn] --master ${entry.file} に type が指定されていません。dataset 内の type を利用します。`);
      if (Array.isArray(data.masterItems)) {
        applyAggregatedDataset({ masterItems, categories, explanations }, { masterItems: data.masterItems });
        continue;
      }
    }
    if (!entry.type) continue;
    masterItems.set(entry.type, items);
  }

  for (const entry of options.categoryFiles) {
    const data = loadJson(entry.file);
    const list = Array.isArray(data) ? data : Array.isArray(data.categories) ? data.categories : [];
    if (!entry.type) {
      console.warn(`[warn] --category ${entry.file} に type が指定されていません。スキップします。`);
      continue;
    }
    categories.set(entry.type, list);
  }

  for (const entry of options.explanationFiles) {
    const data = loadJson(entry.file);
    const list = Array.isArray(data) ? data : Array.isArray(data.items) ? data.items : [];
    if (!entry.type) {
      console.warn(`[warn] --explanation ${entry.file} に type が指定されていません。スキップします。`);
      continue;
    }
    explanations.set(entry.type, list);
  }

  return { masterItems, categories, explanations };
}

function buildCategoryStatements(categories, organizationId) {
  const statements = [];
  let count = 0;
  for (const [type, list] of categories.entries()) {
    const entries = Array.isArray(list) ? list : [];
    entries.forEach((nameRaw, index) => {
      if (!nameRaw) return;
      const name = String(nameRaw).trim();
      if (!name) return;
      const metadata = null;
      const sql = `INSERT INTO master_categories (organization_id, type, name, display_order, is_default, metadata)
VALUES (${sqlLiteral(organizationId)}, ${sqlLiteral(type)}, ${sqlLiteral(name)}, ${sqlLiteral(index)}, 1, ${sqlLiteral(metadata)})
ON CONFLICT(organization_id, type, name) DO UPDATE SET
  display_order = excluded.display_order,
  is_default = excluded.is_default,
  metadata = excluded.metadata;`;
      statements.push(sql);
      count += 1;
    });
  }
  return { statements, count };
}

function buildItemStatements(masterItems, organizationId) {
  const statements = [];
  const aliasStatements = [];
  let itemCount = 0;
  let aliasCount = 0;
  const usedIds = new Set();

  for (const [type, items] of masterItems.entries()) {
    const list = Array.isArray(items) ? items : [];
    for (const rawItem of list) {
      const src = normalizeKeys(rawItem);
      let id = typeof src.id === 'string' && src.id.trim() ? src.id.trim() : crypto.randomUUID();
      if (usedIds.has(id)) {
        id = crypto.randomUUID();
      }
      usedIds.add(id);
      const category = typeof src.category === 'string' ? src.category.trim() : '';
      const name = typeof src.name === 'string' ? src.name.trim() : '';
      if (!type || !category || !name) continue;

      const canonicalName = typeof src.canonicalName === 'string' ? src.canonicalName.trim() : null;
      const status = typeof src.status === 'string' && src.status.trim() ? src.status.trim() : 'candidate';
      const classification = typeof src.classification === 'string' && src.classification.trim() ? src.classification.trim() : null;
      const medicalField = typeof src.medicalField === 'string' && src.medicalField.trim() ? src.medicalField.trim() : null;
      const sortGroup = typeof src.sortGroup === 'string' && src.sortGroup.trim() ? src.sortGroup.trim() : null;
      const sortOrder = Number.isFinite(Number(src.sortOrder)) ? Number(src.sortOrder) : null;
      const description = typeof src.desc === 'string' ? src.desc : typeof src.description === 'string' ? src.description : null;
      const notes = typeof src.notes === 'string' ? src.notes : null;
      const referenceUrl = sanitizeUrl(src.referenceUrl);
      const count = Number.isFinite(Number(src.count)) ? Number(src.count) : 0;
      const sources = ensureStringArray(src.sources);
      const descSamples = ensureStringArray(src.descSamples || src.desc_samples);
      const explanations = sanitizeExplanations(src.explanations);
      const legacyKey = typeof src.legacyKey === 'string' && src.legacyKey.trim() ? src.legacyKey.trim() : legacyKeyFromParts(type, category, name);
      const comparable = comparableKey(type, category, name);
      const normalizedName = normalizeForSearch(name);
      const normalizedCategory = normalizeForSearch(category);
      const createdAt = coerceTimestamp(src.createdAt || src.created_at, Math.floor(Date.now() / 1000));

      const metadata = {};
      const setMeta = (key, value) => {
        if (value === null || value === undefined) return;
        if (Array.isArray(value) && !value.length) return;
        metadata[key] = value;
      };

      setMeta('synonyms', ensureStringArray(src.synonyms));
      setMeta('defaultServices', ensureStringArray(src.defaultServices));
      setMeta('defaultTests', ensureStringArray(src.defaultTests));
      if (typeof src.patientLabel === 'string' && src.patientLabel.trim()) {
        metadata.patientLabel = src.patientLabel.trim();
      }
      setMeta('bodySiteRefs', ensureStringArray(src.bodySiteRefs));
      setMeta('severityTags', ensureStringArray(src.severityTags));
      setMeta('icd10', ensureStringArray(src.icd10));
      setMeta('icd10Codes', ensureStringArray(src.icd10Codes));
      setMeta('aliases', ensureStringArray(src.aliases));
      setMeta('thesaurusRefs', ensureStringArray(src.thesaurusRefs));
      if (typeof src.issuer === 'string' && src.issuer.trim()) {
        metadata.issuer = src.issuer.trim();
      }
      if (typeof src.qualificationCode === 'string' && src.qualificationCode.trim()) {
        metadata.qualificationCode = src.qualificationCode.trim();
      }
      if (typeof src.code === 'string' && src.code.trim()) {
        metadata.code = src.code.trim();
      }
      if (typeof src.unit === 'string' && src.unit.trim()) {
        metadata.unit = src.unit.trim();
      }
      if (typeof src.duration === 'string' && src.duration.trim()) {
        metadata.duration = src.duration.trim();
      }
      if (typeof src.notesMeta === 'string' && src.notesMeta.trim()) {
        metadata.notesMeta = src.notesMeta.trim();
      }
      if (typeof src.extra === 'object' && src.extra) {
        metadata.extra = src.extra;
      }
      if (typeof src.metadata === 'object' && src.metadata) {
        metadata.originalMetadata = src.metadata;
      }

      const legacyAliases = ensureStringArray(src.legacyAliases || src.legacy_aliases || src.aliases);
      if (legacyKey && !legacyAliases.includes(legacyKey)) {
        legacyAliases.push(legacyKey);
      }
      if (legacyAliases.length) {
        metadata.legacyAliases = legacyAliases;
      }

      const metadataLiteral = Object.keys(metadata).length ? sqlLiteral(JSON.stringify(metadata)) : 'NULL';
      const sourcesLiteral = sources.length ? sqlLiteral(JSON.stringify(sources)) : 'NULL';
      const descSamplesLiteral = descSamples.length ? sqlLiteral(JSON.stringify(descSamples)) : 'NULL';
      const explanationsLiteral = explanations.length ? sqlLiteral(JSON.stringify(explanations)) : 'NULL';
      const legacyAliasesLiteral = legacyAliases.length ? sqlLiteral(JSON.stringify(legacyAliases)) : 'NULL';

      const sql = `INSERT INTO master_items (
  id, organization_id, type, category, name, canonical_name, status, classification, medical_field,
  sort_group, sort_order, description, notes, reference_url, count, sources, desc_samples, explanations,
  metadata, legacy_key, legacy_aliases, comparable_key, normalized_name, normalized_category, created_at
) VALUES (
  ${sqlLiteral(id)}, ${sqlLiteral(organizationId)}, ${sqlLiteral(type)}, ${sqlLiteral(category)}, ${sqlLiteral(name)},
  ${sqlLiteral(canonicalName)}, ${sqlLiteral(status)}, ${sqlLiteral(classification)}, ${sqlLiteral(medicalField)},
  ${sqlLiteral(sortGroup)}, ${sqlLiteral(sortOrder)}, ${sqlLiteral(description)}, ${sqlLiteral(notes)}, ${sqlLiteral(referenceUrl)},
  ${sqlLiteral(count)}, ${sourcesLiteral}, ${descSamplesLiteral}, ${explanationsLiteral},
  ${metadataLiteral}, ${sqlLiteral(legacyKey)}, ${legacyAliasesLiteral}, ${sqlLiteral(comparable)},
  ${sqlLiteral(normalizedName)}, ${sqlLiteral(normalizedCategory)}, ${sqlLiteral(createdAt)}
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
  created_at = COALESCE(master_items.created_at, excluded.created_at);`;

      statements.push(sql);
      itemCount += 1;

      const aliasCandidates = new Set(legacyAliases);
      const explicitAliases = ensureStringArray(src.aliases);
      explicitAliases.forEach((alias) => aliasCandidates.add(alias));

      for (const alias of aliasCandidates) {
        if (!alias) continue;
        const normalizedAlias = normalizeAlias(alias);
        const sourceLabel = alias === legacyKey ? 'legacy' : legacyAliases.includes(alias) ? 'legacyAlias' : 'import';
        const aliasSql = `INSERT INTO master_item_aliases (alias, item_id, normalized_alias, source)
VALUES (${sqlLiteral(alias)}, ${sqlLiteral(id)}, ${sqlLiteral(normalizedAlias)}, ${sqlLiteral(sourceLabel)})
ON CONFLICT(alias) DO UPDATE SET
  item_id = excluded.item_id,
  normalized_alias = excluded.normalized_alias,
  source = excluded.source;`;
        aliasStatements.push(aliasSql);
        aliasCount += 1;
      }
    }
  }

  return { statements, aliasStatements, itemCount, aliasCount };
}

function buildExplanationStatements(explanations, organizationId) {
  const statements = [];
  let count = 0;
  for (const [type, entries] of explanations.entries()) {
    const list = Array.isArray(entries) ? entries : [];
    for (const entry of list) {
      if (!entry || typeof entry !== 'object') continue;
      const src = normalizeKeys(entry);
      const baseTextRaw = typeof src.baseText === 'string' ? src.baseText : typeof src.text === 'string' ? src.text : '';
      const baseText = baseTextRaw.trim();
      if (!baseText) continue;
      const id = typeof src.id === 'string' && src.id.trim() ? src.id.trim() : crypto.randomUUID();
      const targetSlug = typeof src.targetSlug === 'string' ? src.targetSlug.trim() : '';
      if (!targetSlug) continue;
      const audience = typeof src.audience === 'string' && src.audience.trim() ? src.audience.trim() : null;
      const context = typeof src.context === 'string' && src.context.trim() ? src.context.trim() : null;
      const inheritFrom = typeof src.inheritFrom === 'string' && src.inheritFrom.trim() ? src.inheritFrom.trim() : null;
      const status = typeof src.status === 'string' && src.status.trim() ? src.status.trim() : 'draft';
      const tags = ensureStringArray(src.tags);
      const sourceFacilityIds = ensureStringArray(src.sourceFacilityIds);
      const versions = Array.isArray(src.versions) ? src.versions : [];
      const createdAt = coerceTimestamp(src.createdAt, Math.floor(Date.now() / 1000));

      const tagsLiteral = tags.length ? sqlLiteral(JSON.stringify(tags)) : 'NULL';
      const sourceFacilitiesLiteral = sourceFacilityIds.length ? sqlLiteral(JSON.stringify(sourceFacilityIds)) : 'NULL';
      const versionsLiteral = versions.length ? sqlLiteral(JSON.stringify(versions)) : 'NULL';

      const sql = `INSERT INTO master_explanations (
  id, organization_id, type, target_slug, base_text, audience, context, inherit_from,
  status, tags, source_facility_ids, versions, created_at
) VALUES (
  ${sqlLiteral(id)}, ${sqlLiteral(organizationId)}, ${sqlLiteral(type)}, ${sqlLiteral(targetSlug)}, ${sqlLiteral(baseText)},
  ${sqlLiteral(audience)}, ${sqlLiteral(context)}, ${sqlLiteral(inheritFrom)},
  ${sqlLiteral(status)}, ${tagsLiteral}, ${sourceFacilitiesLiteral}, ${versionsLiteral}, ${sqlLiteral(createdAt)}
)
ON CONFLICT(id) DO UPDATE SET
  organization_id = excluded.organization_id,
  type = excluded.type,
  target_slug = excluded.target_slug,
  base_text = excluded.base_text,
  audience = excluded.audience,
  context = excluded.context,
  inherit_from = excluded.inherit_from,
  status = excluded.status,
  tags = excluded.tags,
  source_facility_ids = excluded.source_facility_ids,
  versions = excluded.versions,
  created_at = COALESCE(master_explanations.created_at, excluded.created_at);`;
      statements.push(sql);
      count += 1;
    }
  }
  return { statements, count };
}

function buildTruncateStatements(organizationId) {
  const condition = organizationId === null ? 'IS NULL' : `= ${sqlLiteral(organizationId)}`;
  return [
    `DELETE FROM master_item_aliases WHERE item_id IN (SELECT id FROM master_items WHERE organization_id ${condition});`,
    `DELETE FROM master_items WHERE organization_id ${condition};`,
    `DELETE FROM master_categories WHERE organization_id ${condition};`,
    `DELETE FROM master_explanations WHERE organization_id ${condition};`,
  ];
}

async function main() {
  const options = parseArgs(process.argv);
  if (options.help) {
    usage();
    return;
  }

  if (!options.dataset && !options.masterFiles.length && !options.categoryFiles.length && !options.explanationFiles.length) {
    console.error('Error: インポート対象が指定されていません。--dataset もしくは --master/--category を指定してください。');
    process.exitCode = 1;
    return;
  }

  const dataset = loadDatasets(options);
  const orgIdLog = options.organizationId === null ? '(global)' : options.organizationId;

  console.log(`[masters] loaded dataset for organization ${orgIdLog}`);
  console.log(`[masters] master types: ${Array.from(dataset.masterItems.keys()).join(', ') || '(none)'}`);
  console.log(`[masters] category types: ${Array.from(dataset.categories.keys()).join(', ') || '(none)'}`);
  console.log(`[masters] explanation types: ${Array.from(dataset.explanations.keys()).join(', ') || '(none)'}`);

  const statements = [];
  let categoriesCount = 0;
  let itemsCount = 0;
  let aliasCount = 0;
  let explanationsCount = 0;

  if (options.truncate) {
    statements.push(...buildTruncateStatements(options.organizationId));
  }

  if (!options.skipCategories) {
    const { statements: categoryStatements, count } = buildCategoryStatements(dataset.categories, options.organizationId);
    statements.push(...categoryStatements);
    categoriesCount = count;
  }

  if (!options.skipItems) {
    const { statements: itemStatements, aliasStatements, itemCount, aliasCount: aliasTotal } = buildItemStatements(
      dataset.masterItems,
      options.organizationId,
    );
    statements.push(...itemStatements, ...aliasStatements);
    itemsCount = itemCount;
    aliasCount = aliasTotal;
  }

  if (!options.skipExplanations) {
    const { statements: explanationStatements, count } = buildExplanationStatements(dataset.explanations, options.organizationId);
    statements.push(...explanationStatements);
    explanationsCount = count;
  }

  if (!statements.length) {
    console.warn('[masters] No SQL statements generated. Nothing to do.');
    return;
  }

  const sqlChunks = chunkStatements(statements, options.chunkSize);
  console.log(`[masters] Prepared ${sqlChunks.length} transaction chunk(s).`);
  console.log(`[masters] Categories: ${categoriesCount}, Items: ${itemsCount}, Aliases: ${aliasCount}, Explanations: ${explanationsCount}`);

  if (options.output) {
    const outDir = path.dirname(options.output);
    await fs.promises.mkdir(outDir, { recursive: true });
    await fs.promises.writeFile(options.output, sqlChunks.join('\n\n'), 'utf8');
    console.log(`[masters] SQL written to ${options.output}`);
  }

  if (options.dbBinding && !options.dryRun) {
    for (let i = 0; i < sqlChunks.length; i += 1) {
      console.log(`[masters] Executing chunk ${i + 1}/${sqlChunks.length} on ${options.dbBinding}...`);
      await executeSql(options.dbBinding, sqlChunks[i], i, options);
    }
  } else if (!options.dbBinding) {
    console.log('[masters] --db が指定されていないため SQL 実行をスキップしました。');
  } else {
    console.log('[masters] dry-run モードのため SQL 実行をスキップしました。');
  }

  console.log('[masters] Done.');
}

main().catch((err) => {
  console.error('[masters] failed:', err);
  process.exitCode = 1;
});
