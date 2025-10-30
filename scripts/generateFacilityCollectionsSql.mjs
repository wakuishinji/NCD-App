#!/usr/bin/env node
/**
 * Generate SQL for facility collection tables (departments, beds, access, modes,
 * vaccinations, checkups, extra) based on clinic v2 JSON/JSONL data.
 *
 * Typical usage:
 *   node scripts/generateFacilityCollectionsSql.mjs \
 *     --input tmp/clinics-v2.jsonl \
 *     --output tmp/facility-collections.sql \
 *     --chunk-size 100
 *
 * オプションで `--execute --db MASTERS_D1` を指定すると、生成した SQL を
 * `wrangler d1 execute` で即時適用する。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const DEFAULT_OUTPUT = path.resolve('tmp', 'facility-collections.sql');

function usage() {
  console.log(`generateFacilityCollectionsSql

Usage:
  node scripts/generateFacilityCollectionsSql.mjs --input <file> [options]

Options:
  --input <file>          v2 clinics JSON/JSONL ファイル（必須）
  --output <file>         生成する SQL ファイル（既定: tmp/facility-collections.sql）
  --chunk-size <n>        1 トランザクション内の施設数（既定: 100）
  --organization <id>     既定の organizationId（施設側の指定がなければ適用）
  --execute               生成した SQL を wrangler d1 execute で実行
  --db <binding>          wrangler.toml の D1 バインド名（--execute 時に必須）
  --no-remote             wrangler d1 execute から --remote を除外（プレビュー DB 用）
  --help                  このメッセージを表示
`);
}

function parseArgs(argv) {
  const options = {
    input: null,
    output: DEFAULT_OUTPUT,
    chunkSize: 100,
    organizationId: null,
    execute: false,
    db: null,
    useRemote: true,
    help: false,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--input':
        options.input = argv[++i];
        break;
      case '--output':
        options.output = argv[++i];
        break;
      case '--chunk-size': {
        const next = Number(argv[++i]);
        if (Number.isFinite(next) && next > 0) {
          options.chunkSize = Math.max(1, Math.floor(next));
        }
        break;
      }
      case '--organization':
        options.organizationId = argv[++i] || null;
        break;
      case '--execute':
        options.execute = true;
        break;
      case '--db':
        options.db = argv[++i];
        break;
      case '--no-remote':
        options.useRemote = false;
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

export async function loadClinicsFromFile(filePath) {
  if (!filePath) {
    throw new Error('input file path is required');
  }
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`input file not found: ${resolved}`);
  }
  const content = await readFile(resolved, 'utf8');
  if (resolved.endsWith('.json')) {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed?.clinics)) return parsed.clinics;
    throw new Error('JSON ファイルは配列、または { clinics: [...] } 形式にしてください。');
  }
  const items = [];
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    items.push(JSON.parse(trimmed));
  }
  return items;
}

function nk(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function sanitizeKeySegment(value) {
  if (!value) return '';
  return nk(value)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, '');
}

function departmentCodeFromName(name) {
  const slug = sanitizeKeySegment(name);
  if (!slug) return null;
  return `department:${slug}`;
}

function sqlLiteral(value) {
  if (value === undefined || value === null) return 'NULL';
  if (typeof value === 'number') {
    if (Number.isFinite(value)) return String(value);
    return 'NULL';
  }
  if (typeof value === 'boolean') return value ? '1' : '0';
  const text = String(value);
  return `'${text.replace(/'/g, "''")}'`;
}

function sqlJSON(value) {
  return sqlLiteral(JSON.stringify(value ?? {}));
}

function generateCollectionId(facilityId, type, seed = '') {
  if (seed && typeof seed === 'string' && seed.trim()) {
    return `${facilityId}:${type}:${seed.trim()}`;
  }
  return `${facilityId}:${type}:${crypto.randomUUID()}`;
}

function ensureArray(input) {
  if (!input) return [];
  if (Array.isArray(input)) return input;
  return [input];
}

function normalizeStringArray(input) {
  const output = [];
  const seen = new Set();
  ensureArray(input).forEach((value) => {
    const text = nk(value);
    if (!text) return;
    if (seen.has(text)) return;
    seen.add(text);
    output.push(text);
  });
  return output;
}

function computeAccessSummary(access) {
  const summary = nk(access?.summary);
  if (summary) return summary;
  const station = normalizeStringArray(access?.nearestStation)[0] || '';
  const bus = normalizeStringArray(access?.bus)[0] || '';
  const notes = nk(access?.notes);
  return [station, bus, notes].filter(Boolean).join(' / ');
}

function resolveFacilityId(clinic) {
  return (
    nk(clinic?.id)
    || nk(clinic?.clinicId)
    || nk(clinic?.facilityId)
    || nk(clinic?.uuid)
    || ''
  );
}

function resolveOrganizationId(clinic, fallbackOrg) {
  return nk(clinic?.organizationId || clinic?.organization_id || fallbackOrg) || null;
}

function collectDepartmentRows(clinic) {
  const rows = [];
  const seen = new Set();
  const departments = clinic?.departments;
  const master = normalizeStringArray(departments?.master || departments);
  const others = normalizeStringArray(departments?.others);
  const sourceLabel = nk(departments?.source) || 'manual';
  master.forEach((name, index) => {
    const code = departmentCodeFromName(name);
    const key = `manual:${code || name}`;
    if (seen.has(key)) return;
    seen.add(key);
    rows.push({
      name,
      code,
      isPrimary: index === 0 ? 1 : 0,
      source: sourceLabel,
    });
  });
  others.forEach((name) => {
    const key = `manual-other:${name}`;
    if (seen.has(key)) return;
    seen.add(key);
    rows.push({
      name,
      code: null,
      isPrimary: 0,
      source: 'manual-other',
    });
  });
  normalizeStringArray(clinic?.mhlwDepartments).forEach((name) => {
    const code = departmentCodeFromName(name);
    const key = `mhlw:${code || name}`;
    if (seen.has(key)) return;
    seen.add(key);
    rows.push({
      name,
      code,
      isPrimary: 0,
      source: 'mhlw',
    });
  });
  return rows;
}

function collectBedRows(clinic) {
  const rows = [];
  const seen = new Set();
  const append = (type, count, source, notes) => {
    const normalizedType = nk(type) || 'general';
    const numeric = Number(count);
    if (!Number.isFinite(numeric)) return;
    const key = `${normalizedType}:${source || ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    rows.push({
      type: normalizedType,
      count: Math.max(0, Math.trunc(numeric)),
      source: source || null,
      notes: nk(notes) || null,
    });
  };
  ensureArray(clinic?.beds).forEach((entry) => {
    if (!entry || typeof entry !== 'object') return;
    append(entry.type || entry.bedType, entry.count, entry.source || 'manual', entry.notes);
  });
  const attr = clinic?.facilityAttributes;
  if (attr && typeof attr === 'object') {
    const count = Number(attr.bedCount);
    if (Number.isFinite(count)) {
      append('total', count, 'manual', attr.bedNotes);
    }
  }
  const mhlw = clinic?.mhlwBedCounts;
  if (mhlw && typeof mhlw === 'object') {
    Object.entries(mhlw).forEach(([type, count]) => {
      append(type, count, 'mhlw');
    });
  }
  return rows;
}

function joinLines(values) {
  const items = normalizeStringArray(values);
  return items.length ? items.join('\n') : null;
}

function buildAccessRow(clinic) {
  const access = clinic?.access;
  if (!access || typeof access !== 'object') return null;
  const parking = access.parking && typeof access.parking === 'object' ? access.parking : {};
  const parkingAvailable = Object.prototype.hasOwnProperty.call(parking, 'available')
    ? (parking.available ? 1 : 0)
    : null;
  const parkingCapacity = Number(parking.capacity);
  return {
    nearestStation: joinLines(access.nearestStation),
    bus: joinLines(access.bus),
    parkingAvailable,
    parkingCapacity: Number.isFinite(parkingCapacity) ? Math.trunc(parkingCapacity) : null,
    parkingNotes: nk(parking.notes) || null,
    barrierFree: joinLines(access.barrierFree),
    notes: nk(access.notes) || null,
    summary: computeAccessSummary(access) || null,
    source: nk(access.source) || 'manual',
  };
}

function collectModesRows(clinic) {
  const modes = clinic?.modes;
  if (!modes || !Array.isArray(modes.selected) || !modes.selected.length) return [];
  const meta = modes.meta && typeof modes.meta === 'object' ? modes.meta : {};
  return modes.selected
    .map((code) => {
      const slug = nk(code);
      if (!slug) return null;
      const entry = meta[slug] && typeof meta[slug] === 'object' ? meta[slug] : {};
      const order = Number(entry.order);
      return {
        code: slug,
        label: nk(entry.label) || slug,
        icon: nk(entry.icon) || null,
        color: nk(entry.color) || null,
        order: Number.isFinite(order) ? order : null,
        notes: nk(entry.notes) || null,
        source: nk(modes.source) || 'manual',
      };
    })
    .filter(Boolean);
}

function collectSelectionRows(entries, sourceFallback, type) {
  if (!entries || !Array.isArray(entries.selected) || !entries.selected.length) return [];
  const meta = entries.meta && typeof entries.meta === 'object' ? entries.meta : {};
  const source = nk(entries.source) || sourceFallback || 'manual';
  return entries.selected
    .map((slug) => {
      const code = nk(slug);
      if (!code) return null;
      const entry = meta[code] && typeof meta[code] === 'object' ? meta[code] : {};
      return {
        code,
        name: nk(entry.name) || code,
        category: nk(entry.category) || null,
        description: nk(entry.desc) || null,
        referenceUrl: nk(entry.referenceUrl) || null,
        notes: nk(entry.notes) || null,
        source,
      };
    })
    .filter(Boolean)
    .map((row) => ({ ...row, type }));
}

function buildExtraPayload(clinic) {
  const extra = clinic?.extra;
  if (!extra || typeof extra !== 'object') return null;
  const clone = JSON.parse(JSON.stringify(extra));
  return clone;
}

function buildDeleteStatements(facilityId) {
  return [
    `DELETE FROM facility_departments WHERE facility_id = ${sqlLiteral(facilityId)};`,
    `DELETE FROM facility_beds WHERE facility_id = ${sqlLiteral(facilityId)};`,
    `DELETE FROM facility_access_info WHERE facility_id = ${sqlLiteral(facilityId)};`,
    `DELETE FROM facility_modes WHERE facility_id = ${sqlLiteral(facilityId)};`,
    `DELETE FROM facility_vaccinations WHERE facility_id = ${sqlLiteral(facilityId)};`,
    `DELETE FROM facility_checkups WHERE facility_id = ${sqlLiteral(facilityId)};`,
    `DELETE FROM facility_extra WHERE facility_id = ${sqlLiteral(facilityId)};`,
  ];
}

function buildInsertStatements(clinic, organizationId) {
  const facilityId = resolveFacilityId(clinic);
  if (!facilityId) return [];
  const stmts = [];

  collectDepartmentRows(clinic).forEach((row) => {
    const id = generateCollectionId(facilityId, 'department');
    stmts.push(
      `INSERT INTO facility_departments (id, facility_id, organization_id, department_code, name, category, is_primary, source, notes)\n` +
        `VALUES (${sqlLiteral(id)}, ${sqlLiteral(facilityId)}, ${sqlLiteral(organizationId)}, ${sqlLiteral(row.code)}, ${sqlLiteral(row.name)}, NULL, ${sqlLiteral(row.isPrimary)}, ${sqlLiteral(row.source)}, NULL)\n` +
        `ON CONFLICT(id) DO UPDATE SET department_code=excluded.department_code, name=excluded.name, is_primary=excluded.is_primary, source=excluded.source, organization_id=excluded.organization_id, updated_at=strftime('%s','now');`,
    );
  });

  collectBedRows(clinic).forEach((row) => {
    const id = generateCollectionId(facilityId, 'bed', row.type);
    stmts.push(
      `INSERT INTO facility_beds (id, facility_id, organization_id, bed_type, count, source, notes)\n` +
        `VALUES (${sqlLiteral(id)}, ${sqlLiteral(facilityId)}, ${sqlLiteral(organizationId)}, ${sqlLiteral(row.type)}, ${sqlLiteral(row.count)}, ${sqlLiteral(row.source)}, ${sqlLiteral(row.notes)})\n` +
        `ON CONFLICT(id) DO UPDATE SET bed_type=excluded.bed_type, count=excluded.count, source=excluded.source, notes=excluded.notes, organization_id=excluded.organization_id, updated_at=strftime('%s','now');`,
    );
  });

  const access = buildAccessRow(clinic);
  if (access) {
    stmts.push(
      `INSERT INTO facility_access_info (facility_id, organization_id, nearest_station, bus, parking_available, parking_capacity, parking_notes, barrier_free, notes, summary, source)\n` +
        `VALUES (${sqlLiteral(facilityId)}, ${sqlLiteral(organizationId)}, ${sqlLiteral(access.nearestStation)}, ${sqlLiteral(access.bus)}, ${sqlLiteral(access.parkingAvailable)}, ${sqlLiteral(access.parkingCapacity)}, ${sqlLiteral(access.parkingNotes)}, ${sqlLiteral(access.barrierFree)}, ${sqlLiteral(access.notes)}, ${sqlLiteral(access.summary)}, ${sqlLiteral(access.source)})\n` +
        `ON CONFLICT(facility_id) DO UPDATE SET nearest_station=excluded.nearest_station, bus=excluded.bus, parking_available=excluded.parking_available, parking_capacity=excluded.parking_capacity, parking_notes=excluded.parking_notes, barrier_free=excluded.barrier_free, notes=excluded.notes, summary=excluded.summary, source=excluded.source, organization_id=excluded.organization_id, updated_at=strftime('%s','now');`,
    );
  }

  collectModesRows(clinic).forEach((row) => {
    const id = generateCollectionId(facilityId, 'mode', row.code);
    stmts.push(
      `INSERT INTO facility_modes (id, facility_id, organization_id, code, label, icon, color, display_order, notes, source)\n` +
        `VALUES (${sqlLiteral(id)}, ${sqlLiteral(facilityId)}, ${sqlLiteral(organizationId)}, ${sqlLiteral(row.code)}, ${sqlLiteral(row.label)}, ${sqlLiteral(row.icon)}, ${sqlLiteral(row.color)}, ${sqlLiteral(row.order)}, ${sqlLiteral(row.notes)}, ${sqlLiteral(row.source)})\n` +
        `ON CONFLICT(id) DO UPDATE SET code=excluded.code, label=excluded.label, icon=excluded.icon, color=excluded.color, display_order=excluded.display_order, notes=excluded.notes, source=excluded.source, organization_id=excluded.organization_id, updated_at=strftime('%s','now');`,
    );
  });

  collectSelectionRows(clinic?.vaccinations, 'manual', 'vaccination').forEach((row) => {
    const id = generateCollectionId(facilityId, 'vaccination', row.code);
    stmts.push(
      `INSERT INTO facility_vaccinations (id, facility_id, organization_id, vaccine_code, name, category, description, reference_url, notes, source)\n` +
        `VALUES (${sqlLiteral(id)}, ${sqlLiteral(facilityId)}, ${sqlLiteral(organizationId)}, ${sqlLiteral(row.code)}, ${sqlLiteral(row.name)}, ${sqlLiteral(row.category)}, ${sqlLiteral(row.description)}, ${sqlLiteral(row.referenceUrl)}, ${sqlLiteral(row.notes)}, ${sqlLiteral(row.source)})\n` +
        `ON CONFLICT(id) DO UPDATE SET vaccine_code=excluded.vaccine_code, name=excluded.name, category=excluded.category, description=excluded.description, reference_url=excluded.reference_url, notes=excluded.notes, source=excluded.source, organization_id=excluded.organization_id, updated_at=strftime('%s','now');`,
    );
  });

  collectSelectionRows(clinic?.checkups, 'manual', 'checkup').forEach((row) => {
    const id = generateCollectionId(facilityId, 'checkup', row.code);
    stmts.push(
      `INSERT INTO facility_checkups (id, facility_id, organization_id, checkup_code, name, category, description, reference_url, notes, source)\n` +
        `VALUES (${sqlLiteral(id)}, ${sqlLiteral(facilityId)}, ${sqlLiteral(organizationId)}, ${sqlLiteral(row.code)}, ${sqlLiteral(row.name)}, ${sqlLiteral(row.category)}, ${sqlLiteral(row.description)}, ${sqlLiteral(row.referenceUrl)}, ${sqlLiteral(row.notes)}, ${sqlLiteral(row.source)})\n` +
        `ON CONFLICT(id) DO UPDATE SET checkup_code=excluded.checkup_code, name=excluded.name, category=excluded.category, description=excluded.description, reference_url=excluded.reference_url, notes=excluded.notes, source=excluded.source, organization_id=excluded.organization_id, updated_at=strftime('%s','now');`,
    );
  });

  const extraPayload = buildExtraPayload(clinic);
  if (extraPayload && Object.keys(extraPayload).length) {
    const source = nk(extraPayload.source) || 'manual';
    stmts.push(
      `INSERT INTO facility_extra (facility_id, organization_id, payload, source)\n` +
        `VALUES (${sqlLiteral(facilityId)}, ${sqlLiteral(organizationId)}, ${sqlJSON(extraPayload)}, ${sqlLiteral(source)})\n` +
        `ON CONFLICT(facility_id) DO UPDATE SET payload=excluded.payload, source=excluded.source, organization_id=excluded.organization_id, updated_at=strftime('%s','now');`,
    );
  }

  return stmts;
}

function buildSql(clinics, { chunkSize, organizationId, useTransactions }) {
  const blocks = [];
  for (let offset = 0; offset < clinics.length; offset += chunkSize) {
    const chunk = clinics.slice(offset, offset + chunkSize);
    const stmts = [];
    chunk.forEach((clinic) => {
      const facilityId = resolveFacilityId(clinic);
      if (!facilityId) return;
      buildDeleteStatements(facilityId).forEach((stmt) => stmts.push(stmt));
      const orgId = resolveOrganizationId(clinic, organizationId);
      buildInsertStatements(clinic, orgId).forEach((stmt) => stmts.push(stmt));
    });
    if (!stmts.length) continue;
    if (useTransactions) {
      blocks.push(`BEGIN TRANSACTION;\n${stmts.join('\n')}\nCOMMIT;`);
    } else {
      blocks.push(stmts.join('\n'));
    }
  }
  return blocks.join('\n');
}

export function generateFacilityCollectionsSql(clinics, {
  chunkSize = 100,
  organizationId = null,
  useTransactions = true,
} = {}) {
  if (!Array.isArray(clinics)) {
    throw new Error('clinics must be an array');
  }
  if (!clinics.length) return '';
  return buildSql(clinics, { chunkSize, organizationId, useTransactions });
}

async function executeSql(db, sql, { useRemote }) {
  const tempFile = path.join(os.tmpdir(), `facility-collections-${Date.now()}.sql`);
  await writeFile(tempFile, sql, 'utf8');
  const args = ['d1', 'execute', db, '--file', tempFile];
  if (useRemote) {
    args.push('--remote');
  }
  await new Promise((resolve, reject) => {
    const proc = spawn('wrangler', args, { stdio: 'inherit' });
    proc.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`wrangler d1 execute exited with code ${code}`));
    });
  }).finally(() => {
    fs.promises.unlink(tempFile).catch(() => {});
  });
}

async function main() {
  const options = parseArgs(process.argv);
  if (options.help) {
    usage();
    process.exit(0);
  }
  if (!options.input) {
    console.error('Error: --input is required.\n');
    usage();
    process.exit(1);
  }
  const clinics = await loadClinicsFromFile(options.input);
  if (!Array.isArray(clinics) || clinics.length === 0) {
    throw new Error('クリニックデータが空です。');
  }
  console.log(`Loaded ${clinics.length.toLocaleString()} clinic record(s).`);

  const sql = generateFacilityCollectionsSql(clinics, {
    chunkSize: options.chunkSize,
    organizationId: options.organizationId,
    useTransactions: !options.useRemote,
  });

  if (!sql.trim()) {
    console.warn('No SQL statements were generated. Check input data.');
  }

  if (options.output) {
    const outPath = path.resolve(options.output);
    await mkdir(path.dirname(outPath), { recursive: true });
    const outputSql = sql.endsWith('\n') ? sql : `${sql}\n`;
    await writeFile(outPath, outputSql, 'utf8');
    console.log(`SQL written to ${outPath}`);
  }

  if (options.execute) {
    if (!options.db) {
      throw new Error('--execute requires --db <binding>');
    }
    console.log(`Executing SQL via wrangler d1 execute ${options.db}...`);
    await executeSql(options.db, sql, { useRemote: options.useRemote });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('[generateFacilityCollectionsSql] failed:', err);
    process.exit(1);
  });
}
