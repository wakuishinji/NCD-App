#!/usr/bin/env node
/**
 * Cloudflare D1 importer for 厚労省（MHLW）医療機関 CSV.
 *
 * 4 つの CSV（病院/診療所の施設票 + 診療科・診療時間票）を読み込み、
 * `mhlw_*` テーブルへ upsert する SQL を生成して実行する。
 *
 * Example:
 *   node scripts/importMhlwToD1.mjs \
 *     --db MASTERS_D1 \
 *     --execute \
 *     --truncate
 *
 * オプションで個別ファイルの指定やプレビュー DB への投入も可能。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

import {
  importFacilitySources,
  importScheduleSources,
  mergeFacilitiesAndSchedules,
  normalizeFacilityId,
} from './importMhlwFacilities.mjs';

const DEFAULT_OUTPUT = path.resolve('tmp', 'mhlw-import.sql');
const DEFAULT_CLINIC_INFO = path.resolve('data/medical-open-data/02-1_clinic_facility_info_20250601.csv');
const DEFAULT_CLINIC_SCHEDULE = path.resolve('data/medical-open-data/02-2_clinic_speciality_hours_20250601.csv');
const DEFAULT_HOSPITAL_INFO = path.resolve('data/medical-open-data/01-1_hospital_facility_info_20250601.csv');
const DEFAULT_HOSPITAL_SCHEDULE = path.resolve('data/medical-open-data/01-2_hospital_speciality_hours_20250601.csv');
const DEFAULT_BATCH_SIZE = 500;

const DAY_OF_WEEK_MAP = new Map([
  ['0', 0], ['月', 0], ['月曜', 0], ['月曜日', 0], ['mon', 0], ['monday', 0],
  ['1', 1], ['火', 1], ['火曜', 1], ['火曜日', 1], ['tue', 1], ['tuesday', 1],
  ['2', 2], ['水', 2], ['水曜', 2], ['水曜日', 2], ['wed', 2], ['wednesday', 2],
  ['3', 3], ['木', 3], ['木曜', 3], ['木曜日', 3], ['thu', 3], ['thursday', 3],
  ['4', 4], ['金', 4], ['金曜', 4], ['金曜日', 4], ['fri', 4], ['friday', 4],
  ['5', 5], ['土', 5], ['土曜', 5], ['土曜日', 5], ['sat', 5], ['saturday', 5],
  ['6', 6], ['日', 6], ['日曜', 6], ['日曜日', 6], ['sun', 6], ['sunday', 6],
]);

const BED_TYPE_LABELS = {
  general: 'general',
  longTerm: 'long_term',
  longTermMedical: 'long_term_medical',
  longTermCare: 'long_term_care',
  psychiatric: 'psychiatric',
  tuberculosis: 'tuberculosis',
  infectious: 'infectious',
  total: 'total',
};

function fileIfExists(filePath) {
  if (!filePath) return null;
  const resolved = path.resolve(filePath);
  return fs.existsSync(resolved) ? resolved : null;
}

function usage() {
  console.log(`importMhlwToD1

Usage:
  node scripts/importMhlwToD1.mjs --db <binding> [options]

Required:
  --db <binding>                wrangler.toml の D1 バインド名

CSV options (既定は data/medical-open-data/*.csv を自動検出):
  --clinic-info <path>          診療所 施設票 CSV
  --clinic-schedule <path>      診療所 診療科・診療時間 CSV
  --hospital-info <path>        病院 施設票 CSV
  --hospital-schedule <path>    病院 診療科・診療時間 CSV
  --skip-clinic                 診療所 CSV を読み込まない
  --skip-hospital               病院 CSV を読み込まない

General options:
  --limit <n>                   読み込む施設数の上限（テスト用）
  --output <path>               生成する SQL ファイル（既定: ${DEFAULT_OUTPUT}）
  --chunk-size <n>              1 チャンクに含める SQL 件数（既定: 250）
  --batch-size <n>              D1 へ投入する施設件数のバッチサイズ（既定: ${DEFAULT_BATCH_SIZE}）
  --truncate                    既存の mhlw_* テーブルを削除してから投入
  --execute                     SQL を wrangler d1 execute で実行
  --no-remote                   プレビュー DB へ実行（既定は --remote）
  --help                        このメッセージを表示
`);
}

function parseArgs(argv) {
  const options = {
    db: null,
    clinicInfo: fileIfExists(DEFAULT_CLINIC_INFO),
    clinicSchedule: fileIfExists(DEFAULT_CLINIC_SCHEDULE),
    hospitalInfo: fileIfExists(DEFAULT_HOSPITAL_INFO),
    hospitalSchedule: fileIfExists(DEFAULT_HOSPITAL_SCHEDULE),
    output: DEFAULT_OUTPUT,
    execute: false,
    useRemote: true,
    truncate: false,
    skipClinic: false,
    skipHospital: false,
    limit: null,
    chunkSize: 250,
    batchSize: DEFAULT_BATCH_SIZE,
    help: false,
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--db':
        options.db = argv[++i];
        break;
      case '--clinic-info': {
        const clinicInfo = argv[++i];
        options.clinicInfo = clinicInfo ? path.resolve(clinicInfo) : null;
        break;
      }
      case '--clinic-schedule': {
        const clinicSchedule = argv[++i];
        options.clinicSchedule = clinicSchedule ? path.resolve(clinicSchedule) : null;
        break;
      }
      case '--hospital-info': {
        const hospitalInfo = argv[++i];
        options.hospitalInfo = hospitalInfo ? path.resolve(hospitalInfo) : null;
        break;
      }
      case '--hospital-schedule': {
        const hospitalSchedule = argv[++i];
        options.hospitalSchedule = hospitalSchedule ? path.resolve(hospitalSchedule) : null;
        break;
      }
      case '--skip-clinic':
        options.skipClinic = true;
        break;
      case '--skip-hospital':
        options.skipHospital = true;
        break;
      case '--limit': {
        const value = Number(argv[++i]);
        if (Number.isFinite(value) && value > 0) {
          options.limit = Math.floor(value);
        }
        break;
      }
      case '--output': {
        const next = argv[++i];
        options.output = next ? path.resolve(next) : DEFAULT_OUTPUT;
        break;
      }
      case '--chunk-size': {
        const value = Number(argv[++i]);
        if (Number.isFinite(value) && value > 0) {
          options.chunkSize = Math.max(1, Math.floor(value));
        }
        break;
      }
      case '--batch-size': {
        const value = Number(argv[++i]);
        if (Number.isFinite(value) && value > 0) {
          options.batchSize = Math.max(1, Math.floor(value));
        }
        break;
      }
      case '--truncate':
        options.truncate = true;
        break;
      case '--execute':
        options.execute = true;
        break;
      case '--no-remote':
        options.useRemote = false;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        console.warn(`[warn] Unknown argument: ${arg}`);
        break;
    }
  }

  return options;
}

function normalizeString(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function nullableString(value) {
  const normalized = normalizeString(value);
  return normalized === '' ? null : normalized;
}

function nullableNumber(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function sqlLiteral(value) {
  if (value === undefined || value === null) return 'NULL';
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return value ? '1' : '0';
  const str = String(value);
  return `'${str.replace(/'/g, "''")}'`;
}

function buildSearchName(facility) {
  return (
    nullableString(facility.shortName) ||
    nullableString(facility.name) ||
    nullableString(facility.officialName) ||
    nullableString(facility.englishName) ||
    nullableString(facility.facilityId) ||
    null
  );
}

function normalizeForSearch(value) {
  const normalized = normalizeString(value);
  if (!normalized) return '';
  return normalized.normalize('NFKC');
}

function buildSearchTokens(facility) {
  const tokens = new Set();
  const add = (value) => {
    const base = normalizeForSearch(value);
    if (!base) return;
    tokens.add(base);
    const compact = base.replace(/[\s　、，・]/g, '');
    if (compact && compact !== base) tokens.add(compact);
    const ascii = base.replace(/[^\x20-\x7E]/g, '').toLowerCase();
    if (ascii) tokens.add(ascii);
  };

  add(facility.facilityId);
  add(facility.name);
  add(facility.nameKana);
  add(facility.officialName);
  add(facility.officialNameKana);
  add(facility.shortName);
  add(facility.shortNameKana);
  add(facility.englishName);
  add(facility.prefecture);
  add(facility.prefectureName);
  add(facility.city);
  add(facility.cityName);
  add(facility.address);

  const result = Array.from(tokens).filter(Boolean).join(' ');
  return result || null;
}

function toDayOfWeekIndex(label) {
  if (!label) return null;
  const key = normalizeString(label).toLowerCase();
  if (DAY_OF_WEEK_MAP.has(key)) {
    return DAY_OF_WEEK_MAP.get(key);
  }
  const normalized = key.replace(/曜日?$/, '');
  return DAY_OF_WEEK_MAP.get(normalized) ?? null;
}

function collectDepartments(facility, facilityId) {
  const entries = facility.scheduleEntries || [];
  const map = new Map();
  for (const entry of entries) {
    const code = nullableString(entry.departmentCode);
    const name = nullableString(entry.department || entry.departmentName);
    if (!code && !name) continue;
    const key = `${code || ''}::${name || ''}`;
    if (!map.has(key)) {
      map.set(key, { facility_id: facilityId, department_code: code, department_name: name });
    }
  }
  return Array.from(map.values());
}

function collectBeds(facility, facilityId) {
  const result = [];
  const bedCounts = facility.bedCounts || {};
  for (const [key, value] of Object.entries(bedCounts)) {
    const mappedType = BED_TYPE_LABELS[key];
    const numeric = nullableNumber(value);
    if (!mappedType || numeric === null) continue;
    result.push({
      facility_id: facilityId,
      bed_type: mappedType,
      bed_count: numeric,
    });
  }
  return result;
}

function collectSchedules(facility, facilityId) {
  const entries = facility.scheduleEntries || [];
  const rows = [];
  for (const entry of entries) {
    const dayIndex = toDayOfWeekIndex(entry.day);
    if (dayIndex === null) {
      continue; // 祝日など day_of_week(0-6) 以外はスキップ
    }
    rows.push({
      facility_id: facilityId,
      department_code: nullableString(entry.departmentCode),
      department_name: nullableString(entry.department || entry.departmentName),
      slot_type: nullableString(entry.slotType),
      day_of_week: dayIndex,
      start_time: nullableString(entry.startTime),
      end_time: nullableString(entry.endTime),
      reception_start: nullableString(entry.receptionStart),
      reception_end: nullableString(entry.receptionEnd),
    });
  }
  return rows;
}

function buildFacilityRecord(facility) {
  const facilityId = normalizeFacilityId(facility.facilityId);
  const searchName = buildSearchName(facility);
  const searchTokens = buildSearchTokens(facility);
  const rawSnapshot = { ...facility };
  delete rawSnapshot.scheduleEntries;
  delete rawSnapshot.mhlwDepartments;
  if (rawSnapshot.bedCounts && typeof rawSnapshot.bedCounts === 'object') {
    rawSnapshot.bedCounts = { ...rawSnapshot.bedCounts };
  }
  const rawJson = JSON.stringify(rawSnapshot);
  const record = {
    facility_id: facilityId,
    facility_type: nullableString(facility.facilityType),
    name: nullableString(facility.name),
    name_kana: nullableString(facility.nameKana),
    official_name: nullableString(facility.officialName),
    official_name_kana: nullableString(facility.officialNameKana),
    short_name: nullableString(facility.shortName),
    short_name_kana: nullableString(facility.shortNameKana),
    english_name: nullableString(facility.englishName),
    prefecture_code: nullableString(facility.prefectureCode),
    prefecture: nullableString(facility.prefecture || facility.prefectureName),
    city_code: nullableString(facility.cityCode),
    city: nullableString(facility.city || facility.cityName),
    address: nullableString(facility.address),
    postal_code: nullableString(facility.postalCode),
    phone: nullableString(facility.phone),
    fax: nullableString(facility.fax),
    homepage_url: nullableString(facility.homepageUrl),
    latitude: nullableNumber(facility.latitude),
    longitude: nullableNumber(facility.longitude),
    search_name: searchName,
    search_tokens: searchTokens,
    source: 'mhlw',
    raw_json: rawJson,
  };
  return record;
}

function buildFacilityStatements(facility) {
  const statements = [];
  const facilityRecord = buildFacilityRecord(facility);
  const columns = Object.keys(facilityRecord);
  const values = columns.map((key) => sqlLiteral(facilityRecord[key]));
  const assignments = columns
    .filter((key) => key !== 'facility_id')
    .map((key) => `${key} = excluded.${key}`)
    .join(', ');
  statements.push(`INSERT INTO mhlw_facilities (${columns.join(', ')}) VALUES (${values.join(', ')}) ON CONFLICT(facility_id) DO UPDATE SET ${assignments};`);

  const facilityIdLiteral = sqlLiteral(facilityRecord.facility_id);
  statements.push(`DELETE FROM mhlw_facility_departments WHERE facility_id = ${facilityIdLiteral};`);
  statements.push(`DELETE FROM mhlw_facility_schedules WHERE facility_id = ${facilityIdLiteral};`);
  statements.push(`DELETE FROM mhlw_facility_beds WHERE facility_id = ${facilityIdLiteral};`);

  const departments = collectDepartments(facility, facilityRecord.facility_id);
  for (const row of departments) {
    const cols = Object.keys(row);
    const vals = cols.map((key) => sqlLiteral(row[key]));
    statements.push(`INSERT INTO mhlw_facility_departments (${cols.join(', ')}) VALUES (${vals.join(', ')}) ON CONFLICT(facility_id, department_code, department_name) DO UPDATE SET department_name = excluded.department_name;`);
  }

  const beds = collectBeds(facility, facilityRecord.facility_id);
  for (const row of beds) {
    const cols = Object.keys(row);
    const vals = cols.map((key) => sqlLiteral(row[key]));
    statements.push(`INSERT INTO mhlw_facility_beds (${cols.join(', ')}) VALUES (${vals.join(', ')}) ON CONFLICT(facility_id, bed_type) DO UPDATE SET bed_count = excluded.bed_count;`);
  }

  const schedules = collectSchedules(facility, facilityRecord.facility_id);
  for (const row of schedules) {
    const cols = Object.keys(row);
    const vals = cols.map((key) => sqlLiteral(row[key]));
    statements.push(`INSERT INTO mhlw_facility_schedules (${cols.join(', ')}) VALUES (${vals.join(', ')});`);
  }

  return statements;
}

function buildSqlStatementsForFacilities(facilities, { includeTruncate = false } = {}) {
  const statements = [];
  if (includeTruncate) {
    statements.push('DELETE FROM mhlw_facility_schedules;');
    statements.push('DELETE FROM mhlw_facility_departments;');
    statements.push('DELETE FROM mhlw_facility_beds;');
    statements.push('DELETE FROM mhlw_facilities;');
  }
  facilities.forEach((facility) => {
    statements.push(...buildFacilityStatements(facility));
  });
  return statements;
}

function buildSqlText(statements, chunkSize, { useTransactions = false, tailSql = '' } = {}) {
  const chunks = [];
  for (let i = 0; i < statements.length; i += chunkSize) {
    const slice = statements.slice(i, i + chunkSize);
    if (useTransactions) {
      chunks.push(`BEGIN TRANSACTION;\n${slice.join('\n')}\nCOMMIT;`);
    } else {
      chunks.push(slice.join('\n'));
    }
  }
  if (tailSql && tailSql.trim()) {
    chunks.push(tailSql.trim());
  }
  const content = chunks.join('\n\n');
  const finalText = content ? `${content}\n` : '';
  return finalText;
}

async function writeSqlFile(targetPath, statements, chunkSize, options = {}) {
  const resolved = path.resolve(targetPath);
  await fs.promises.mkdir(path.dirname(resolved), { recursive: true });
  const text = buildSqlText(statements, chunkSize, options);
  await fs.promises.writeFile(resolved, text, 'utf8');
  return resolved;
}

async function executeSql(dbBinding, filePath, useRemote = true) {
  const args = ['d1', 'execute', dbBinding, '--file', filePath];
  if (useRemote) args.splice(3, 0, '--remote');
  await new Promise((resolve, reject) => {
    const proc = spawn('wrangler', args, { stdio: 'inherit' });
    proc.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`wrangler exited with code ${code}`));
      }
    });
  });
}

function resolveSources(options) {
  const facilitySources = [];
  const scheduleSources = [];

  if (!options.skipClinic && options.clinicInfo) {
    facilitySources.push({ file: options.clinicInfo, facilityType: 'clinic' });
    if (options.clinicSchedule) {
      scheduleSources.push({ file: options.clinicSchedule, facilityType: 'clinic' });
    }
  }

  if (!options.skipHospital && options.hospitalInfo) {
    facilitySources.push({ file: options.hospitalInfo, facilityType: 'hospital' });
    if (options.hospitalSchedule) {
      scheduleSources.push({ file: options.hospitalSchedule, facilityType: 'hospital' });
    }
  }

  return { facilitySources, scheduleSources };
}

function ensureFilesExist(paths) {
  for (const filePath of paths) {
    if (!filePath) continue;
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }
  }
}

async function main() {
  const options = parseArgs(process.argv);
  if (options.help || !options.db) {
    usage();
    if (!options.help) process.exitCode = 1;
    return;
  }

  const { facilitySources, scheduleSources } = resolveSources(options);
  if (facilitySources.length === 0) {
    console.error('[error] At least one facility CSV must be specified.');
    process.exitCode = 1;
    return;
  }

  ensureFilesExist(facilitySources.map((item) => item.file));
  ensureFilesExist(scheduleSources.map((item) => item.file));

  console.log(`[info] Loading facilities from ${facilitySources.length} CSV file(s)…`);
  const facilities = await importFacilitySources({ sources: facilitySources, limit: options.limit });
  console.log(`[info] Loaded ${facilities.length} facilities.`);

  const facilityIds = new Set(facilities.map((f) => f.facilityId));

  let schedules = [];
  if (scheduleSources.length) {
    console.log(`[info] Loading schedules from ${scheduleSources.length} CSV file(s)…`);
    const rawSchedules = await importScheduleSources({ sources: scheduleSources });
    schedules = rawSchedules.filter((entry) => facilityIds.has(entry.facilityId));
    console.log(`[info] Loaded ${schedules.length} schedule entries linked to facilities.`);
  }

  const merged = mergeFacilitiesAndSchedules(facilities, schedules);
  console.log(`[info] Merged dataset contains ${merged.length} facilities.`);

  if (!merged.length) {
    console.warn('[warn] No facilities to process.');
    return;
  }

  const batchSize = Math.max(1, options.batchSize);
  const total = merged.length;
  const useTransactions = false;
  const outputPath = options.output ? path.resolve(options.output) : null;
  if (outputPath) {
    await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.promises.writeFile(outputPath, '', 'utf8');
  }

  let processed = 0;
  let chunkIndex = 0;

  for (let offset = 0; offset < merged.length; offset += batchSize) {
    const chunk = merged.slice(offset, offset + batchSize);
    const start = offset + 1;
    const end = offset + chunk.length;
    console.log(`[info] Preparing chunk ${chunkIndex + 1}: facilities ${start}-${end} / ${total}`);

    const statements = buildSqlStatementsForFacilities(chunk, {
      includeTruncate: options.truncate && offset === 0,
    });
    if (!statements.length) {
      console.log(`[info] Chunk ${chunkIndex + 1} generated no statements (skipping).`);
      chunkIndex += 1;
      processed += chunk.length;
      continue;
    }

    const sqlText = buildSqlText(statements, options.chunkSize, { useTransactions });
    if (!sqlText.trim()) {
      console.log(`[info] Chunk ${chunkIndex + 1} produced empty SQL (skipping).`);
      chunkIndex += 1;
      processed += chunk.length;
      continue;
    }

    if (outputPath) {
      await fs.promises.writeFile(outputPath, sqlText, { encoding: 'utf8', flag: 'a' });
    }

    if (options.execute) {
      const tempPath = path.join(os.tmpdir(), `mhlw-import-chunk-${Date.now()}-${chunkIndex}.sql`);
      await fs.promises.writeFile(tempPath, sqlText, 'utf8');
      console.log(`[info] Executing chunk ${chunkIndex + 1} via wrangler (remote=${options.useRemote})…`);
      await executeSql(options.db, tempPath, options.useRemote);
      await fs.promises.unlink(tempPath).catch(() => {});
    }

    chunkIndex += 1;
    processed += chunk.length;
  }

  if (outputPath) {
    console.log(`[info] SQL written to ${outputPath}`);
  }

  if (options.execute) {
    console.log('[info] Import completed.');
  } else {
    console.log('[info] Dry run finished. Use --execute to run wrangler d1 execute.');
  }
}

main().catch((err) => {
  console.error(`[error] ${err.message}`);
  process.exitCode = 1;
});
