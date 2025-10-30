#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import zlib from 'node:zlib';

const PREFECTURES = [
  { code: '01', name: '北海道' },
  { code: '02', name: '青森県' },
  { code: '03', name: '岩手県' },
  { code: '04', name: '宮城県' },
  { code: '05', name: '秋田県' },
  { code: '06', name: '山形県' },
  { code: '07', name: '福島県' },
  { code: '08', name: '茨城県' },
  { code: '09', name: '栃木県' },
  { code: '10', name: '群馬県' },
  { code: '11', name: '埼玉県' },
  { code: '12', name: '千葉県' },
  { code: '13', name: '東京都' },
  { code: '14', name: '神奈川県' },
  { code: '15', name: '新潟県' },
  { code: '16', name: '富山県' },
  { code: '17', name: '石川県' },
  { code: '18', name: '福井県' },
  { code: '19', name: '山梨県' },
  { code: '20', name: '長野県' },
  { code: '21', name: '岐阜県' },
  { code: '22', name: '静岡県' },
  { code: '23', name: '愛知県' },
  { code: '24', name: '三重県' },
  { code: '25', name: '滋賀県' },
  { code: '26', name: '京都府' },
  { code: '27', name: '大阪府' },
  { code: '28', name: '兵庫県' },
  { code: '29', name: '奈良県' },
  { code: '30', name: '和歌山県' },
  { code: '31', name: '鳥取県' },
  { code: '32', name: '島根県' },
  { code: '33', name: '岡山県' },
  { code: '34', name: '広島県' },
  { code: '35', name: '山口県' },
  { code: '36', name: '徳島県' },
  { code: '37', name: '香川県' },
  { code: '38', name: '愛媛県' },
  { code: '39', name: '高知県' },
  { code: '40', name: '福岡県' },
  { code: '41', name: '佐賀県' },
  { code: '42', name: '長崎県' },
  { code: '43', name: '熊本県' },
  { code: '44', name: '大分県' },
  { code: '45', name: '宮崎県' },
  { code: '46', name: '鹿児島県' },
  { code: '47', name: '沖縄県' },
];

const FACILITY_FIELD_ALIASES = {
  facilityId: ['ID', '"ID"', '医療機関コード', 'medicalinstitutioncode'],
  officialName: ['正式名称'],
  officialNameKana: ['正式名称（フリガナ）', '正式名称(フリガナ)'],
  shortName: ['略称'],
  shortNameKana: ['略称（フリガナ）', '略称(フリガナ)'],
  englishName: ['英語表記（ローマ字表記）', '英語表記', '英語表記(ローマ字表記)'],
  facilityCategory: ['機関区分'],
  prefectureCode: ['都道府県コード'],
  cityCode: ['市区町村コード'],
  address: ['所在地'],
  latitude: ['所在地座標（緯度）', '緯度'],
  longitude: ['所在地座標（経度）', '経度'],
  homepageUrl: ['案内用ホームページアドレス', '案内用ホームページ', 'ホームページアドレス'],
  weeklyClosedMon: ['毎週決まった曜日に休診（月）'],
  weeklyClosedTue: ['毎週決まった曜日に休診（火）'],
  weeklyClosedWed: ['毎週決まった曜日に休診（水）'],
  weeklyClosedThu: ['毎週決まった曜日に休診（木）'],
  weeklyClosedFri: ['毎週決まった曜日に休診（金）'],
  weeklyClosedSat: ['毎週決まった曜日に休診（土）'],
  weeklyClosedSun: ['毎週決まった曜日に休診（日）'],
  periodicClosedWeek1Mon: ['決まった週に休診（定期週）第1週（月）'],
  periodicClosedWeek1Tue: ['決まった週に休診（定期週）第1週（火）'],
  periodicClosedWeek1Wed: ['決まった週に休診（定期週）第1週（水）'],
  periodicClosedWeek1Thu: ['決まった週に休診（定期週）第1週（木）'],
  periodicClosedWeek1Fri: ['決まった週に休診（定期週）第1週（金）'],
  periodicClosedWeek1Sat: ['決まった週に休診（定期週）第1週（土）'],
  periodicClosedWeek1Sun: ['決まった週に休診（定期週）第1週（日）'],
  periodicClosedWeek2Mon: ['決まった週に休診（定期週）第2週（月）'],
  periodicClosedWeek2Tue: ['決まった週に休診（定期週）第2週（火）'],
  periodicClosedWeek2Wed: ['決まった週に休診（定期週）第2週（水）'],
  periodicClosedWeek2Thu: ['決まった週に休診（定期週）第2週（木）'],
  periodicClosedWeek2Fri: ['決まった週に休診（定期週）第2週（金）'],
  periodicClosedWeek2Sat: ['決まった週に休診（定期週）第2週（土）'],
  periodicClosedWeek2Sun: ['決まった週に休診（定期週）第2週（日）'],
  periodicClosedWeek3Mon: ['決まった週に休診（定期週）第3週（月）'],
  periodicClosedWeek3Tue: ['決まった週に休診（定期週）第3週（火）'],
  periodicClosedWeek3Wed: ['決まった週に休診（定期週）第3週（水）'],
  periodicClosedWeek3Thu: ['決まった週に休診（定期週）第3週（木）'],
  periodicClosedWeek3Fri: ['決まった週に休診（定期週）第3週（金）'],
  periodicClosedWeek3Sat: ['決まった週に休診（定期週）第3週（土）'],
  periodicClosedWeek3Sun: ['決まった週に休診（定期週）第3週（日）'],
  periodicClosedWeek4Mon: ['決まった週に休診（定期週）第4週（月）'],
  periodicClosedWeek4Tue: ['決まった週に休診（定期週）第4週（火）'],
  periodicClosedWeek4Wed: ['決まった週に休診（定期週）第4週（水）'],
  periodicClosedWeek4Thu: ['決まった週に休診（定期週）第4週（木）'],
  periodicClosedWeek4Fri: ['決まった週に休診（定期週）第4週（金）'],
  periodicClosedWeek4Sat: ['決まった週に休診（定期週）第4週（土）'],
  periodicClosedWeek4Sun: ['決まった週に休診（定期週）第4週（日）'],
  periodicClosedWeek5Mon: ['決まった週に休診（定期週）第5週（月）'],
  periodicClosedWeek5Tue: ['決まった週に休診（定期週）第5週（火）'],
  periodicClosedWeek5Wed: ['決まった週に休診（定期週）第5週（水）'],
  periodicClosedWeek5Thu: ['決まった週に休診（定期週）第5週（木）'],
  periodicClosedWeek5Fri: ['決まった週に休診（定期週）第5週（金）'],
  periodicClosedWeek5Sat: ['決まった週に休診（定期週）第5週（土）'],
  periodicClosedWeek5Sun: ['決まった週に休診（定期週）第5週（日）'],
  holidayClosed: ['祝日に休診'],
  otherClosedNote: ['その他の休診日（gw、お盆等）', 'その他の休診日'],
  bedsGeneral: ['一般病床'],
  bedsLongTerm: ['療養病床'],
  bedsLongTermMedical: ['療養病床のうち医療保険適用'],
  bedsLongTermCare: ['療養病床のうち介護保険適用'],
  bedsPsychiatric: ['精神病床'],
  bedsTuberculosis: ['結核病床'],
  bedsInfectious: ['感染症病床'],
  bedsTotal: ['合計病床数'],
};

const WEEKDAY_DEFS = [
  { key: 'mon', alias: 'Mon' },
  { key: 'tue', alias: 'Tue' },
  { key: 'wed', alias: 'Wed' },
  { key: 'thu', alias: 'Thu' },
  { key: 'fri', alias: 'Fri' },
  { key: 'sat', alias: 'Sat' },
  { key: 'sun', alias: 'Sun' },
];

const PERIODIC_WEEK_DEFS = [
  { key: 'week1', alias: 'Week1' },
  { key: 'week2', alias: 'Week2' },
  { key: 'week3', alias: 'Week3' },
  { key: 'week4', alias: 'Week4' },
  { key: 'week5', alias: 'Week5' },
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

async function importFacilityFile(filePath, facilityType, limit) {
  const facilities = [];
  let headers = [];
  let headerParsed = false;
  let count = 0;
  const normalizedType = normalizeFacilityType(facilityType);
  for await (const line of readCsvLines(filePath)) {
    if (!headerParsed) {
      headers = parseCsvLine(line).map((header) => normalizeHeaderName(header));
      headerParsed = true;
      continue;
    }
    const columns = parseCsvLine(line);
    if (!columns || columns.length === 0) continue;
    const canonicalRow = buildCanonicalRow(headers, columns);
    const facility = buildFacilityFromRow(canonicalRow, normalizedType);
    if (!facility) continue;
    facilities.push(facility);
    count += 1;
    if (limit && count >= limit) {
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
    const entries = await importFacilityFile(source.file, source.facilityType, remaining);
    facilities.push(...entries);
    processed += entries.length;
  }
  return facilities;
}

function normalizeHeaderName(header) {
  return (header ?? '')
    .toString()
    .replace(/^\ufeff/, '')
    .replace(/^"+|"+$/g, '')
    .trim();
}

function canonicalizeHeaderName(header) {
  return normalizeHeaderName(header)
    .replace(/[\"'“”]/g, '')
    .replace(/（/g, '(')
    .replace(/）/g, ')')
    .replace(/[＿]/g, '_')
    .replace(/[\s　]/g, '')
    .toLowerCase();
}

function buildCanonicalRow(headers, columns) {
  const row = {};
  headers.forEach((header, index) => {
    const key = canonicalizeHeaderName(header);
    if (key) {
      row[key] = columns[index] ?? '';
    }
  });
  return row;
}

function extractValue(canonicalRow, aliases, { trim = true } = {}) {
  if (!aliases || aliases.length === 0) return '';
  for (const alias of aliases) {
    const key = canonicalizeHeaderName(alias);
    if (Object.prototype.hasOwnProperty.call(canonicalRow, key)) {
      const raw = canonicalRow[key];
      if (raw == null) continue;
      const value = trim ? toNormalizedValue(raw) : raw;
      if (value !== '') return value;
    }
  }
  return '';
}

function parseBooleanFlag(value) {
  const normalized = toNormalizedValue(value).toLowerCase();
  if (!normalized) return false;
  return normalized === '1' || normalized === 'true' || normalized === '○' || normalized === '◯';
}

function parseNumber(value) {
  const normalized = toNormalizedValue(value);
  if (!normalized) return null;
  const numeric = Number(normalized.replace(/,/g, ''));
  return Number.isFinite(numeric) ? numeric : null;
}

function derivePrefectureName(prefCode, address) {
  const normalizedCode = (prefCode || '').toString().padStart(2, '0');
  const prefecture = PREFECTURES.find((item) => item.code === normalizedCode);
  if (prefecture) return prefecture.name;
  if (address) {
    const match = PREFECTURES.find((item) => address.startsWith(item.name));
    if (match) return match.name;
  }
  return '';
}

function deriveCityName(prefectureName, address) {
  if (!address) return '';
  let rest = address.trim();
  if (prefectureName && rest.startsWith(prefectureName)) {
    rest = rest.slice(prefectureName.length);
  }
  rest = rest.trim();
  if (!rest) return '';

  let result = '';
  for (let i = 0; i < rest.length; i += 1) {
    const char = rest[i];
    if ('市区町村'.includes(char)) {
      result = rest.slice(0, i + 1);
    } else if (char === '郡') {
      const match = rest.match(/^(.+郡.+?[町村])/);
      if (match) {
        result = match[1];
      } else {
        result = rest.slice(0, i + 1);
      }
    }
  }
  return toNormalizedValue(result);
}

function buildWeeklyClosedDays(row) {
  const out = {};
  for (const def of WEEKDAY_DEFS) {
    const aliases = FACILITY_FIELD_ALIASES[`weeklyClosed${def.alias}`] || [];
    out[def.key] = parseBooleanFlag(extractValue(row, aliases));
  }
  return out;
}

function buildPeriodicClosedMap(row) {
  const result = {};
  for (const week of PERIODIC_WEEK_DEFS) {
    const dayMap = {};
    for (const day of WEEKDAY_DEFS) {
      const aliasKey = `periodicClosed${week.alias}${day.alias}`;
      const aliases = FACILITY_FIELD_ALIASES[aliasKey] || [];
      dayMap[day.key] = parseBooleanFlag(extractValue(row, aliases));
    }
    result[week.key] = dayMap;
  }
  return result;
}

function buildBedCounts(row) {
  const mapping = {
    general: 'bedsGeneral',
    longTerm: 'bedsLongTerm',
    longTermMedical: 'bedsLongTermMedical',
    longTermCare: 'bedsLongTermCare',
    psychiatric: 'bedsPsychiatric',
    tuberculosis: 'bedsTuberculosis',
    infectious: 'bedsInfectious',
    total: 'bedsTotal',
  };
  const out = {};
  for (const [key, aliasKey] of Object.entries(mapping)) {
    const aliases = FACILITY_FIELD_ALIASES[aliasKey] || [];
    const value = parseNumber(extractValue(row, aliases));
    if (value !== null) {
      out[key] = value;
    }
  }
  return out;
}

function buildFacilityFromRow(canonicalRow, facilityType) {
  const facilityIdRaw = extractValue(canonicalRow, FACILITY_FIELD_ALIASES.facilityId);
  const facilityId = normalizeFacilityId(facilityIdRaw);
  if (!facilityId) return null;

  const officialName = extractValue(canonicalRow, FACILITY_FIELD_ALIASES.officialName);
  const officialNameKana = normalizeKana(extractValue(canonicalRow, FACILITY_FIELD_ALIASES.officialNameKana));
  const shortName = extractValue(canonicalRow, FACILITY_FIELD_ALIASES.shortName);
  const shortNameKana = normalizeKana(extractValue(canonicalRow, FACILITY_FIELD_ALIASES.shortNameKana));
  const englishName = extractValue(canonicalRow, FACILITY_FIELD_ALIASES.englishName);
  const facilityCategoryValue = extractValue(canonicalRow, FACILITY_FIELD_ALIASES.facilityCategory);
  const facilityCategory = facilityCategoryValue ? Number(facilityCategoryValue) : undefined;

  const prefectureCodeRaw = extractValue(canonicalRow, FACILITY_FIELD_ALIASES.prefectureCode);
  const prefectureCode = prefectureCodeRaw ? prefectureCodeRaw.toString().padStart(2, '0') : '';
  const cityCodeRaw = extractValue(canonicalRow, FACILITY_FIELD_ALIASES.cityCode);
  const cityCode = cityCodeRaw ? cityCodeRaw.toString().padStart(5, '0') : '';

  const address = normalizeAddress(extractValue(canonicalRow, FACILITY_FIELD_ALIASES.address));
  const latitudeValue = parseNumber(extractValue(canonicalRow, FACILITY_FIELD_ALIASES.latitude));
  const longitudeValue = parseNumber(extractValue(canonicalRow, FACILITY_FIELD_ALIASES.longitude));
  const homepageUrl = extractValue(canonicalRow, FACILITY_FIELD_ALIASES.homepageUrl);

  const prefectureName = derivePrefectureName(prefectureCode, address);
  const cityName = deriveCityName(prefectureName, address);

  const weeklyClosedDays = buildWeeklyClosedDays(canonicalRow);
  const periodicClosedDays = buildPeriodicClosedMap(canonicalRow);
  const holidayClosed = parseBooleanFlag(extractValue(canonicalRow, FACILITY_FIELD_ALIASES.holidayClosed));
  const otherClosedNote = extractValue(canonicalRow, FACILITY_FIELD_ALIASES.otherClosedNote);

  const bedCounts = buildBedCounts(canonicalRow);
  const totalBedCount = bedCounts.total ?? bedCounts.general ?? null;

  const latitude = latitudeValue !== null ? latitudeValue : undefined;
  const longitude = longitudeValue !== null ? longitudeValue : undefined;

  return {
    facilityId,
    facilityType,
    name: officialName,
    nameKana: officialNameKana,
    officialName,
    officialNameKana,
    shortName,
    shortNameKana,
    englishName,
    facilityCategory: Number.isFinite(facilityCategory) ? facilityCategory : undefined,
    prefectureCode,
    prefecture: prefectureName,
    prefectureName,
    cityCode,
    city: cityName,
    cityName,
    address,
    postalCode: '', // 現行 CSV には郵便番号が含まれていない
    phone: '',
    fax: '',
    homepageUrl,
    latitude,
    longitude,
    weeklyClosedDays,
    periodicClosedDays,
    holidayClosed,
    otherClosedNote,
    bedCounts,
    bedCount: totalBedCount !== null ? totalBedCount : undefined,
    scheduleEntries: [],
    mhlwDepartments: [],
  };
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

export {
  importFacilitySources,
  importScheduleSources,
  mergeFacilitiesAndSchedules,
  normalizeFacilityId,
  normalizeFacilityType,
};
