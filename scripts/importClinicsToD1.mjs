#!/usr/bin/env node
/**
 * Import clinic records (schema v2 JSON) into the D1 `facilities` table.
 *
 * Usage:
 *   node scripts/importClinicsToD1.mjs \
 *     --input tmp/clinics-v2.jsonl \
 *     --db MASTERS_D1 \
 *     --output tmp/clinics-import.sql \
 *     --execute
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';

const DEFAULT_OUTPUT = path.resolve('tmp', 'clinics-import.sql');

function usage() {
  console.log(`importClinicsToD1

Usage:
  node scripts/importClinicsToD1.mjs --input <file> --db <binding> [options]

Options:
  --input <file>          v2 clinics JSON/JSONL ファイル（必須）
  --db <binding>          wrangler.toml の D1 バインド名（必須）
  --output <file>         生成する SQL ファイル（既定: tmp/clinics-import.sql）
  --execute               生成した SQL を wrangler d1 execute --remote で実行
  --no-remote             ローカル D1 (preview) へ実行したい場合に指定
  --chunk-size <n>        1 トランザクション内のレコード数（既定: 100）
  --help                  このメッセージを表示
`);
}

function parseArgs(argv) {
  const options = {
    input: null,
    db: null,
    output: DEFAULT_OUTPUT,
    execute: false,
    useRemote: true,
    chunkSize: 100,
    help: false,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--input':
        options.input = argv[++i];
        break;
      case '--db':
        options.db = argv[++i];
        break;
      case '--output':
        options.output = argv[++i];
        break;
      case '--execute':
        options.execute = true;
        break;
      case '--no-remote':
        options.useRemote = false;
        break;
      case '--chunk-size': {
        const next = Number(argv[++i]);
        if (Number.isFinite(next) && next > 0) {
          options.chunkSize = Math.max(1, Math.floor(next));
        }
        break;
      }
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

async function loadClinics(filePath) {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`input file not found: ${resolved}`);
  }
  if (resolved.endsWith('.json')) {
    const data = JSON.parse(await readFile(resolved, 'utf8'));
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.clinics)) return data.clinics;
    throw new Error('JSON file must be an array or { clinics: [...] }');
  }
  const items = [];
  const content = await readFile(resolved, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    items.push(JSON.parse(trimmed));
  }
  return items;
}

function sqlLiteral(value) {
  if (value === undefined || value === null) return 'NULL';
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return `'${String(value).replace(/'/g, "''")}'`;
}

function normalizeString(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function extractBasics(clinic) {
  const basic = clinic?.basic || {};
  return {
    name: normalizeString(basic.name),
    shortName: normalizeString(basic.shortName || basic.short_name),
    address: normalizeString(basic.address),
    postalCode: normalizeString(basic.postalCode || basic.postal_code),
    phone: normalizeString(basic.phone),
    fax: normalizeString(basic.fax),
    email: normalizeString(basic.email),
    website: normalizeString(basic.website),
  };
}

function extractLocation(clinic) {
  const loc = clinic?.location || {};
  const lat = Number(loc.lat ?? loc.latitude);
  const lng = Number(loc.lng ?? loc.longitude);
  return {
    lat: Number.isFinite(lat) ? lat : null,
    lng: Number.isFinite(lng) ? lng : null,
  };
}

function buildInsertStatements(clinics) {
  const statements = [];
  const columns = [
    'id',
    'external_id',
    'name',
    'short_name',
    'official_name',
    'prefecture',
    'city',
    'address',
    'postal_code',
    'latitude',
    'longitude',
    'facility_type',
    'phone',
    'fax',
    'email',
    'website',
    'metadata',
  ];
  for (const clinic of clinics) {
    const basics = extractBasics(clinic);
    const location = extractLocation(clinic);
    const cityInfo = clinic?.basic?.city || '';
    const externalIdRaw = normalizeString(
      clinic.mhlwFacilityId || clinic.mhlwId || clinic.facilityId || clinic.externalId,
    );

    const row = {
      id: normalizeString(clinic.id || clinic.clinicId),
      external_id: externalIdRaw || null,
      name: basics.name || normalizeString(clinic.displayName),
      short_name: basics.shortName,
      official_name: normalizeString(clinic.basic?.officialName || basics.name),
      prefecture: normalizeString(clinic.basic?.prefecture || clinic.basic?.prefectureName),
      city: normalizeString(cityInfo),
      address: basics.address,
      postal_code: basics.postalCode,
      latitude: location.lat,
      longitude: location.lng,
      facility_type: normalizeString(clinic.clinicType || clinic.facilityType || 'clinic'),
      phone: basics.phone,
      fax: basics.fax,
      email: basics.email,
      website: basics.website,
      metadata: JSON.stringify(clinic),
    };

    const values = columns.map((col) => sqlLiteral(row[col]));
    const assignments = columns
      .filter((col) => col !== 'id')
      .map((col) => `${col} = excluded.${col}`)
      .join(', ');

    statements.push(`INSERT INTO facilities (${columns.join(', ')}) VALUES (${values.join(', ')}) ON CONFLICT(id) DO UPDATE SET ${assignments};`);

    const facilityIdLiteral = sqlLiteral(row.id);
    statements.push(`DELETE FROM facility_services WHERE facility_id = ${facilityIdLiteral};`);
    statements.push(`DELETE FROM facility_tests WHERE facility_id = ${facilityIdLiteral};`);
    statements.push(`DELETE FROM facility_qualifications WHERE facility_id = ${facilityIdLiteral};`);

    const makeRecordId = (seed) => {
      const normalized = normalizeString(seed);
      if (normalized) return normalized;
      return crypto.randomUUID();
    };

    const sqlInsert = (table, record, updateColumns = []) => {
      const cols = Object.keys(record);
      const vals = cols.map((key) => sqlLiteral(record[key]));
      let statement = `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${vals.join(', ')})`;
      if (updateColumns.length) {
        const setClause = updateColumns.map((col) => `${col} = excluded.${col}`).join(', ');
        statement += ` ON CONFLICT(id) DO UPDATE SET ${setClause}`;
      }
      statement += ';';
      return statement;
    };

    const services = Array.isArray(clinic.services) ? clinic.services : [];
    services.forEach((svc) => {
      const record = {
        id: makeRecordId(svc.id || `${clinic.id}:service:${svc.masterId || svc.name || crypto.randomUUID()}`),
        facility_id: row.id,
        master_id: normalizeString(svc.masterId || svc.masterKey || ''),
        name: normalizeString(svc.name || svc.masterName || ''),
        category: normalizeString(svc.category || svc.type || ''),
        source: normalizeString(svc.source || ''),
        notes: normalizeString(svc.notes || ''),
      };
      if (!record.name && !record.master_id) return;
      statements.push(sqlInsert('facility_services', record, ['facility_id', 'master_id', 'name', 'category', 'source', 'notes']));
    });

    const tests = Array.isArray(clinic.tests) ? clinic.tests : [];
    tests.forEach((test) => {
      const record = {
        id: makeRecordId(test.id || `${clinic.id}:test:${test.masterId || test.name || crypto.randomUUID()}`),
        facility_id: row.id,
        master_id: normalizeString(test.masterId || test.masterKey || ''),
        name: normalizeString(test.name || test.masterName || ''),
        category: normalizeString(test.category || test.type || ''),
        source: normalizeString(test.source || ''),
        notes: normalizeString(test.notes || ''),
      };
      if (!record.name && !record.master_id) return;
      statements.push(sqlInsert('facility_tests', record, ['facility_id', 'master_id', 'name', 'category', 'source', 'notes']));
    });

    const quals = Array.isArray(clinic.qualifications) ? clinic.qualifications : [];
    quals.forEach((qual) => {
      const record = {
        id: makeRecordId(qual.id || `${clinic.id}:qual:${qual.masterId || qual.name || crypto.randomUUID()}`),
        facility_id: row.id,
        master_id: normalizeString(qual.masterId || qual.masterKey || ''),
        name: normalizeString(qual.name || qual.masterName || ''),
        issuer: normalizeString(qual.issuer || qual.organization || ''),
        obtained_at: normalizeString(qual.obtainedAt || ''),
        notes: normalizeString(qual.notes || ''),
      };
      if (!record.name && !record.master_id) return;
      statements.push(sqlInsert('facility_qualifications', record, ['facility_id', 'master_id', 'name', 'issuer', 'obtained_at', 'notes']));
    });
  }
  return statements;
}

async function writeSqlFile(targetPath, statements, chunkSize, { useTransactions = true } = {}) {
  const resolved = path.resolve(targetPath);
  await mkdir(path.dirname(resolved), { recursive: true });
  const chunks = [];
  for (let i = 0; i < statements.length; i += chunkSize) {
    const slice = statements.slice(i, i + chunkSize);
    if (useTransactions) {
      chunks.push(`BEGIN TRANSACTION;\n${slice.join('\n')}\nCOMMIT;`);
    } else {
      chunks.push(slice.join('\n'));
    }
  }
  await fs.promises.writeFile(resolved, `${chunks.join('\n\n')}\n`, 'utf8');
  return resolved;
}

async function executeSql(dbBinding, filePath, useRemote = true) {
  const args = ['d1', 'execute', dbBinding, '--file', filePath];
  if (useRemote) args.splice(3, 0, '--remote');
  await new Promise((resolve, reject) => {
    const proc = spawn('wrangler', args, { stdio: 'inherit' });
    proc.on('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`wrangler exited with code ${code}`));
      } else {
        resolve();
      }
    });
  });
}

async function main() {
  const options = parseArgs(process.argv);
  if (options.help || !options.input || !options.db) {
    usage();
    if (!options.help) process.exitCode = 1;
    return;
  }

  console.log(`[info] Loading clinics from ${options.input}`);
  const clinics = await loadClinics(options.input);
  console.log(`[info] Loaded ${clinics.length} records.`);

  const statements = buildInsertStatements(clinics);
  if (!statements.length) {
    console.log('[warn] No statements generated.');
    return;
  }

  const sqlPath = await writeSqlFile(
    options.output,
    statements,
    options.chunkSize,
    { useTransactions: !options.useRemote },
  );
  console.log(`[info] SQL written to ${sqlPath}`);

  if (!options.execute) {
    console.log('[info] Dry run finished. Use --execute to run wrangler d1 execute.');
    return;
  }

  const tempPath = sqlPath || path.join(os.tmpdir(), `clinics-import-${Date.now()}.sql`);
  console.log(`[info] Executing SQL via wrangler (remote=${options.useRemote}) …`);
  await executeSql(options.db, tempPath, options.useRemote);
  console.log('[info] Import completed.');
}

main().catch((err) => {
  console.error(`[error] ${err.message}`);
  process.exitCode = 1;
});
