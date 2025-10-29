#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';

function parseArgs(argv) {
  const args = {
    dataset: null,
    db: null,
    output: null,
    chunkSize: 200,
    dryRun: false,
    facilityFiles: [],
    scheduleFiles: [],
  };
  const rest = [];
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--dataset':
        args.dataset = argv[++i];
        break;
      case '--db':
        args.db = argv[++i];
        break;
      case '--output':
        args.output = argv[++i];
        break;
      case '--chunk':
      case '--chunk-size':
        args.chunkSize = Number(argv[++i]) || args.chunkSize;
        break;
      case '--dry-run':
        args.dryRun = true;
        break;
      case '--file':
        args.facilityFiles.push(argv[++i]);
        break;
      case '--schedule':
        args.scheduleFiles.push(argv[++i]);
        break;
      default:
        rest.push(arg);
        break;
    }
  }
  args.rest = rest;
  return args;
}

async function runImport(tempPath, facilityFiles, scheduleFiles) {
  if (!facilityFiles.length) {
    throw new Error('At least one --file clinic:csv is required when --dataset is not provided.');
  }
  const args = ['scripts/importMhlwFacilities.mjs'];
  facilityFiles.forEach((entry) => {
    args.push('--file', entry);
  });
  scheduleFiles.forEach((entry) => {
    args.push('--schedule', entry);
  });
  args.push('--outfile', tempPath);
  await new Promise((resolve, reject) => {
    const proc = spawn('node', args, { stdio: 'inherit' });
    proc.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`importMhlwFacilities.mjs exited with code ${code}`));
    });
  });
}

function readDataset(datasetPath) {
  const raw = fs.readFileSync(datasetPath, 'utf8');
  const parsed = JSON.parse(raw);
  if (!parsed || !Array.isArray(parsed.facilities)) {
    throw new Error('Dataset JSON must contain { facilities: [...] }');
  }
  return parsed;
}

function sqlLiteral(value) {
  if (value === undefined || value === null || Number.isNaN(value)) return 'NULL';
  if (typeof value === 'number') return value.toString();
  return `'${String(value).replace(/'/g, "''")}'`;
}

function mapDayOfWeek(label) {
  switch ((label || '').trim()) {
    case '日曜': return 0;
    case '月曜': return 1;
    case '火曜': return 2;
    case '水曜': return 3;
    case '木曜': return 4;
    case '金曜': return 5;
    case '土曜': return 6;
    default: return null;
  }
}

function formatFacilityRow(facility) {
  const id = facility.facilityId || facility.externalId || crypto.randomUUID();
  const data = {
    id,
    external_id: facility.facilityId || null,
    name: facility.officialName || facility.name || '',
    short_name: facility.shortName || null,
    official_name: facility.officialName || null,
    kana_name: facility.officialNameKana || facility.nameKana || null,
    kana_short_name: facility.shortNameKana || null,
    prefecture_code: facility.prefectureCode || null,
    prefecture: facility.prefectureName || facility.prefecture || null,
    city_code: facility.cityCode || null,
    city: facility.cityName || facility.city || null,
    address: facility.address || facility.fullAddress || null,
    postal_code: facility.postalCode || null,
    latitude: Number.isFinite(facility.latitude) ? facility.latitude : null,
    longitude: Number.isFinite(facility.longitude) ? facility.longitude : null,
    facility_type: facility.facilityType || null,
    source: 'mhlw',
    mhlw_sync_status: 'synced',
  };
  return { id, data };
}

function buildSqlChunks(dataset, { chunkSize }) {
  const statements = [];
  const facilities = dataset.facilities || [];
  for (let i = 0; i < facilities.length; i += chunkSize) {
    const chunk = facilities.slice(i, i + chunkSize);
    const parts = ['BEGIN TRANSACTION;'];
    chunk.forEach((facility) => {
      if (!facility || !facility.facilityId) return;
      const { id, data } = formatFacilityRow(facility);
      const columns = Object.keys(data);
      const values = columns.map((key) => sqlLiteral(data[key]));
      parts.push(`INSERT OR REPLACE INTO facilities (${columns.join(', ')}) VALUES (${values.join(', ')});`);
      const payload = sqlLiteral(JSON.stringify(facility));
      parts.push(`INSERT OR REPLACE INTO facility_mhlw_snapshot (facility_id, synced_at, payload) VALUES (${sqlLiteral(id)}, strftime('%s','now'), ${payload});`);
      parts.push(`DELETE FROM facility_schedule WHERE facility_id = ${sqlLiteral(id)};`);
      if (Array.isArray(facility.scheduleEntries)) {
        facility.scheduleEntries.forEach((entry) => {
          const day = mapDayOfWeek(entry.day);
          if (day === null) return;
          const schedValues = [
            sqlLiteral(id),
            sqlLiteral(entry.departmentCode || null),
            sqlLiteral(entry.department || null),
            sqlLiteral(entry.slotType || null),
            day,
            sqlLiteral(entry.startTime || null),
            sqlLiteral(entry.endTime || null),
            sqlLiteral(entry.receptionStart || null),
            sqlLiteral(entry.receptionEnd || null),
          ];
          parts.push(`INSERT INTO facility_schedule (facility_id, department_code, department_name, slot_type, day_of_week, start_time, end_time, reception_start, reception_end) VALUES (${schedValues.join(', ')});`);
        });
      }
    });
    parts.push('COMMIT;');
    statements.push(parts.join('\n'));
  }
  return statements;
}

async function executeSql(db, sql, index) {
  const tempFile = path.join(os.tmpdir(), `mhlw-d1-${Date.now()}-${index}.sql`);
  await fs.promises.writeFile(tempFile, sql, 'utf8');
  try {
    await new Promise((resolve, reject) => {
      const proc = spawn('wrangler', ['d1', 'execute', db, '--file', tempFile], { stdio: 'inherit' });
      proc.on('exit', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`wrangler d1 execute exited with code ${code}`));
      });
    });
  } finally {
    fs.promises.unlink(tempFile).catch(() => {});
  }
}

async function main() {
  const options = parseArgs(process.argv);
  let datasetPath = options.dataset;
  let cleanupTemp = false;
  try {
    if (!datasetPath) {
      datasetPath = path.join(os.tmpdir(), `mhlw-dataset-${Date.now()}.json`);
      await runImport(datasetPath, options.facilityFiles, options.scheduleFiles);
      cleanupTemp = true;
    }
    const dataset = readDataset(datasetPath);
    console.log(`Loaded dataset with ${dataset.facilities.length.toLocaleString()} facilities.`);
    const sqlChunks = buildSqlChunks(dataset, options);
    console.log(`Prepared ${sqlChunks.length} SQL chunk(s).`);

    if (options.output) {
      const dir = path.dirname(options.output);
      await fs.promises.mkdir(dir, { recursive: true });
      await fs.promises.writeFile(options.output, sqlChunks.join('\n\n'), 'utf8');
      console.log(`SQL statements written to ${options.output}`);
    }

    if (options.db && !options.dryRun) {
      for (let i = 0; i < sqlChunks.length; i += 1) {
        console.log(`Executing chunk ${i + 1}/${sqlChunks.length} on ${options.db}...`);
        await executeSql(options.db, sqlChunks[i], i);
      }
    } else if (!options.db) {
      console.log('No --db specified, skipping execution. Use --db <binding-name> to apply to D1.');
    }

    console.log('Done.');
  } catch (err) {
    console.error('[migrateMhlwToD1] failed:', err.message);
    process.exitCode = 1;
  } finally {
    if (cleanupTemp && datasetPath) {
      fs.promises.unlink(datasetPath).catch(() => {});
    }
  }
}

main();
