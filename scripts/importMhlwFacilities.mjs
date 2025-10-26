#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import zlib from 'node:zlib';

const FACILITY_COLUMNS = [
  'prefCode',
  'prefName',
  'cityCode',
  'cityName',
  'facilityId',
  'facilityName',
  'facilityNameKana',
  'postalCode',
  'address',
  'phone',
  'fax',
  'longitude',
  'latitude',
  'foundingType',
  'careType',
  'bedCount',
];

function parseArgs(argv) {
  const args = {
    sources: [],
    scheduleSources: [],
  };
  let pendingType = null;
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--file' || arg === '-f') {
      const value = argv[++i];
      let facilityType = pendingType;
      let filePath = value;
      if (value && value.includes(':')) {
        const [maybeType, maybePath] = value.split(':', 2);
        if (maybePath) {
          facilityType = maybeType;
          filePath = maybePath;
        }
      }
      facilityType = normalizeFacilityType(facilityType || guessFacilityType(filePath));
      args.sources.push({ file: filePath, facilityType });
      pendingType = null;
    } else if (arg === '--schedule') {
      const value = argv[++i];
      let facilityType = pendingType;
      let filePath = value;
      if (value && value.includes(':')) {
        const [maybeType, maybePath] = value.split(':', 2);
        if (maybePath) {
          facilityType = maybeType;
          filePath = maybePath;
        }
      }
      facilityType = normalizeFacilityType(facilityType || guessFacilityType(filePath));
      args.scheduleSources.push({ file: filePath, facilityType });
      pendingType = null;
    } else if (arg === '--type') {
      pendingType = argv[++i];
    } else if (arg === '--outfile' || arg === '-o') {
      args.outfile = argv[++i];
    } else if (arg === '--limit') {
      args.limit = Number(argv[++i]);
    } else if (arg === '--jsonl') {
      args.jsonl = true;
    } else if (arg === '--help' || arg === '-h') {
      args.help = true;
    }
  }
  return args;
}

function printHelp() {
  console.log(`MHLW Facility Importer\n\n` +
`Usage:\n  node scripts/importMhlwFacilities.mjs --file [type:]<path> [--schedule [type:]<path>] [--type <type>] [--outfile <path>] [--jsonl] [--limit N]\n\n` +
`Options:\n  --file, -f       施設票CSVのパス (複数指定可)。type:path 形式で種別指定。\n  --schedule       診療科・診療時間票CSVのパス (複数指定可)。type:path 形式で種別指定。\n  --type           次の --file / --schedule に適用する施設種別 (clinic, hospital 等)。\n  --outfile, -o    出力先JSON/JSONL (指定なしは標準出力)。\n  --jsonl          JSON Lines 形式で出力。\n  --limit          取り込み件数の上限 (テスト用途)。\n`);
}

function normalizeFacilityType(type) {
  const normalized = (type || '').toString().trim().toLowerCase();
  if (!normalized) return 'clinic';
  if (['clinic', 'clinics'].includes(normalized)) return 'clinic';
  if (['hospital', 'hospitals'].includes(normalized)) return 'hospital';
  return normalized;
}

function guessFacilityType(filePath) {
  const lower = (filePath || '').toLowerCase();
  if (lower.includes('hospital')) return 'hospital';
  if (lower.includes('clinic')) return 'clinic';
  return 'clinic';
}

function normalizeFacilityId(value) {
  return (value || '').toString().trim().replace(/\s+/g, '').toUpperCase();
}

function normalizePostalCode(value) {
  return (value || '').toString().replace(/[^0-9]/g, '').slice(0, 7);
}

function normalizeKana(value) {
  return (value || '').toString().replace(/\s+/g, '');
}

function normalizeAddress(value) {
  return (value || '').toString().trim();
}

function parseCsvLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      const next = line[i + 1];
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

async function* readCsvLines(filePath) {
  const stream = fs.createReadStream(filePath);
  const isGzip = filePath.endsWith('.gz');
  const inputStream = isGzip ? stream.pipe(zlib.createGunzip()) : stream;
  const rl = readline.createInterface({ input: inputStream, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line) continue;
    yield line;
  }
}

async function importFacilityFile(filePath, facilityType, limit, alreadyProcessed) {
  const facilities = [];
  let headerParsed = false;
  let processed = alreadyProcessed;
  for await (const line of readCsvLines(filePath)) {
    if (!headerParsed) {
      headerParsed = true;
      continue;
    }
    const columns = parseCsvLine(line);
    const record = {};
    for (let i = 0; i < FACILITY_COLUMNS.length; i += 1) {
      record[FACILITY_COLUMNS[i]] = columns[i] ?? '';
    }
    const facilityId = normalizeFacilityId(record.facilityId);
    if (!facilityId) continue;
  const entry = {
    facilityId,
    facilityType,
    name: record.facilityName?.trim() || '',
    nameKana: normalizeKana(record.facilityNameKana),
    postalCode: normalizePostalCode(record.postalCode),
    address: normalizeAddress(record.address),
    prefecture: record.prefName?.trim() || '',
    city: record.cityName?.trim() || '',
    phone: (record.phone || '').trim(),
    fax: (record.fax || '').trim(),
    longitude: record.longitude ? Number(record.longitude) : undefined,
    latitude: record.latitude ? Number(record.latitude) : undefined,
    foundingType: record.foundingType || '',
    careType: record.careType || '',
    bedCount: record.bedCount ? Number(record.bedCount) : undefined,
  };
    facilities.push(entry);
    processed += 1;
    if (limit && processed >= limit) {
      break;
    }
  }
  return facilities;
}

async function importFacilitySources({ sources, limit }) {
  if (!Array.isArray(sources) || sources.length === 0) {
    throw new Error('At least one --file is required');
  }
  const facilities = [];
  let processed = 0;
  for (const source of sources) {
    const remaining = limit ? Math.max(limit - processed, 0) : undefined;
    if (remaining === 0) break;
    const entries = await importFacilityFile(source.file, source.facilityType, remaining, processed);
    facilities.push(...entries);
    processed += entries.length;
  }
  return facilities;
}

function normalizeHeaderName(header) {
  return (header ?? '').toString().replace(/^\ufeff/, '').trim();
}

function detectColumnIndex(headers, keywords) {
  const normalizedHeaders = headers.map((col) => normalizeHeaderName(col).toLowerCase().replace(/\s+/g, ''));
  for (const keyword of keywords) {
    const normalizedKeyword = keyword.toLowerCase().replace(/\s+/g, '');
    const index = normalizedHeaders.findIndex((header) => header.includes(normalizedKeyword));
    if (index !== -1) return index;
  }
  return -1;
}

function toNormalizedValue(value) {
  return (value ?? '').toString().trim();
}

function deriveField(raw, candidateKeys) {
  for (const key of Object.keys(raw)) {
    const normalized = normalizeHeaderName(key).toLowerCase().replace(/\s+/g, '');
    if (candidateKeys.some((target) => normalized.includes(target))) {
      const value = toNormalizedValue(raw[key]);
      if (value) return value;
    }
  }
  return '';
}

function normalizeDayLabel(value) {
  const map = {
    '月': '月曜', '月曜': '月曜', '月曜日': '月曜', 'mon': '月曜',
    '火': '火曜', '火曜': '火曜', '火曜日': '火曜', 'tue': '火曜',
    '水': '水曜', '水曜': '水曜', '水曜日': '水曜', 'wed': '水曜',
    '木': '木曜', '木曜': '木曜', '木曜日': '木曜', 'thu': '木曜',
    '金': '金曜', '金曜': '金曜', '金曜日': '金曜', 'fri': '金曜',
    '土': '土曜', '土曜': '土曜', '土曜日': '土曜', 'sat': '土曜',
    '日': '日曜', '日曜': '日曜', '日曜日': '日曜', 'sun': '日曜',
    '祝': '祝日', 'holiday': '祝日',
  };
  const normalized = (value || '').toString().trim().toLowerCase();
  return map[normalized] || value || '';
}

function normalizeTime(value) {
  const normalized = (value || '').toString().trim();
  if (!normalized) return '';
  const digits = normalized.replace(/[^0-9]/g, '');
  if (digits.length === 4) {
    return `${digits.slice(0, 2)}:${digits.slice(2)}`;
  }
  if (digits.length === 3) {
    return `${digits.slice(0, 1)}:${digits.slice(1).padStart(2, '0')}`;
  }
  if (normalized.includes(':')) return normalized;
  return normalized;
}

async function importScheduleSources({ sources }) {
  if (!Array.isArray(sources) || sources.length === 0) {
    return [];
  }
  const entries = [];
  for (const source of sources) {
    const filePath = source.file;
    const facilityType = normalizeFacilityType(source.facilityType);
    let headerParsed = false;
    let headers = [];
    let facilityIdIndex = -1;
    for await (const line of readCsvLines(filePath)) {
      if (!headerParsed) {
        headers = parseCsvLine(line).map((h) => normalizeHeaderName(h));
        facilityIdIndex = detectColumnIndex(headers, ['facilityid', '医療機関コード', 'medicalinstitutioncode', 'id']);
        headerParsed = true;
        continue;
      }
      const columns = parseCsvLine(line);
      const row = {};
      headers.forEach((header, idx) => {
        row[header] = columns[idx] ?? '';
      });
      const facilityId = facilityIdIndex !== -1
        ? normalizeFacilityId(columns[facilityIdIndex])
        : normalizeFacilityId(row.ID || row.facilityId || row['医療機関コード'] || row['medicalInstitutionCode']);
      if (!facilityId) continue;

      const departmentCode = toNormalizedValue(row['診療科目コード'] || row['診療科コード'] || row.departmentCode || row['departmentCode']);
      const departmentName = toNormalizedValue(row['診療科目名'] || row['診療科名'] || row.department || row['department']);
      const slotType = toNormalizedValue(row['診療時間帯'] || row['区分'] || row['slot'] || row['pattern']);

      const dayDefinitions = [
        { label: '月曜', start: '月_診療開始時間', end: '月_診療終了時間', receptionStart: '月_外来受付開始時間', receptionEnd: '月_外来受付終了時間' },
        { label: '火曜', start: '火_診療開始時間', end: '火_診療終了時間', receptionStart: '火_外来受付開始時間', receptionEnd: '火_外来受付終了時間' },
        { label: '水曜', start: '水_診療開始時間', end: '水_診療終了時間', receptionStart: '水_外来受付開始時間', receptionEnd: '水_外来受付終了時間' },
        { label: '木曜', start: '木_診療開始時間', end: '木_診療終了時間', receptionStart: '木_外来受付開始時間', receptionEnd: '木_外来受付終了時間' },
        { label: '金曜', start: '金_診療開始時間', end: '金_診療終了時間', receptionStart: '金_外来受付開始時間', receptionEnd: '金_外来受付終了時間' },
        { label: '土曜', start: '土_診療開始時間', end: '土_診療終了時間', receptionStart: '土_外来受付開始時間', receptionEnd: '土_外来受付終了時間' },
        { label: '日曜', start: '日_診療開始時間', end: '日_診療終了時間', receptionStart: '日_外来受付開始時間', receptionEnd: '日_外来受付終了時間' },
        { label: '祝日', start: '祝_診療開始時間', end: '祝_診療終了時間', receptionStart: '祝_外来受付開始時間', receptionEnd: '祝_外来受付終了時間' },
      ];

      for (const def of dayDefinitions) {
        const startTime = normalizeTime(row[def.start]);
        const endTime = normalizeTime(row[def.end]);
        const receptionStart = normalizeTime(row[def.receptionStart]);
        const receptionEnd = normalizeTime(row[def.receptionEnd]);
        if (!startTime && !endTime && !receptionStart && !receptionEnd) {
          continue;
        }
        entries.push({
          facilityId,
          facilityType,
          departmentCode,
          department: departmentName,
          slotType,
          day: def.label,
          startTime,
          endTime,
          receptionStart,
          receptionEnd,
        });
      }
    }
  }
  return entries;
}

function mergeFacilitiesAndSchedules(facilities, schedules) {
  const map = new Map();
  for (const facility of facilities) {
    const key = facility.facilityId;
    const existing = map.get(key) || {};
    map.set(key, {
      ...existing,
      ...facility,
      facilityId: key,
      facilityType: facility.facilityType || existing.facilityType || 'clinic',
      scheduleEntries: existing.scheduleEntries || [],
      mhlwDepartments: existing.mhlwDepartments || [],
    });
  }
  for (const schedule of schedules) {
    const key = schedule.facilityId;
    const existing = map.get(key) || { facilityId: key };
    const scheduleEntries = existing.scheduleEntries || [];
    scheduleEntries.push(schedule);
    const facilityType = existing.facilityType || schedule.facilityType || 'clinic';
    const departments = new Set(existing.mhlwDepartments || []);
    if (schedule.department) {
      departments.add(schedule.department);
    }
    map.set(key, {
      ...existing,
      facilityType,
      scheduleEntries,
      mhlwDepartments: Array.from(departments),
    });
  }
  return Array.from(map.values());
}

function writeOutput(facilities, { outfile, jsonl }) {
  const count = facilities.length;
  if (!outfile) {
    if (jsonl) {
      facilities.forEach((row) => process.stdout.write(`${JSON.stringify(row)}\n`));
    } else {
      process.stdout.write(JSON.stringify({ count, facilities }, null, 2) + '\n');
    }
    return;
  }
  fs.mkdirSync(path.dirname(outfile), { recursive: true });
  const stream = fs.createWriteStream(outfile, { encoding: 'utf8' });
  if (jsonl) {
    facilities.forEach((row) => {
      stream.write(`${JSON.stringify(row)}\n`);
    });
  } else {
    stream.write(`{"count":${count},"facilities":[`);
    facilities.forEach((row, index) => {
      stream.write(JSON.stringify(row));
      if (index !== facilities.length - 1) {
        stream.write(',');
      }
    });
    stream.write(']}');
  }
  stream.end();
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help || args.sources.length === 0) {
    printHelp();
    process.exit(args.help ? 0 : 1);
    return;
  }

  try {
    const facilities = await importFacilitySources({ sources: args.sources, limit: args.limit });
    const schedules = await importScheduleSources({ sources: args.scheduleSources });
    const merged = mergeFacilitiesAndSchedules(facilities, schedules);
    writeOutput(merged, { outfile: args.outfile || null, jsonl: args.jsonl });
    console.log(`Imported ${merged.length} facilities (sources: ${args.sources.length}, schedules: ${args.scheduleSources.length}).`);
  } catch (error) {
    console.error('Failed to import facilities:', error);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
