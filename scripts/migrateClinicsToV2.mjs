#!/usr/bin/env node
/**
 * Convert exported clinic records (schema v1) to schema v2 and optionally
 * submit them back to the API.
 */

import fs from 'node:fs';
import { createInterface } from 'node:readline';
import { dirname, resolve } from 'node:path';
import { mkdir, readFile } from 'node:fs/promises';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';

const argv = process.argv.slice(2);
const defaults = {
  apiBase: process.env.NCD_API_BASE || 'https://ncd-app.altry.workers.dev',
  inputPath: '',
  outputPath: '',
  dryRun: true,
  delayMs: Number(process.env.NCD_MIGRATE_DELAY_MS || 0),
};

function showHelp() {
  console.log(`Usage: migrateClinicsToV2 [options]

Options:
  --input <file>          Exported clinics JSON/JSONL file (required unless --from-api)
  --output <file>         Output JSONL (default: tmp/clinics-v2-<timestamp>.jsonl)
  --api-base <url>        API base URL (default: ${defaults.apiBase})
  --from-api              Fetch clinics directly via API instead of file input
  --commit                Submit converted clinics via API (POST /api/updateClinic)
  --delay <ms>            Wait between API calls when --commit
  --help                  Show this help text
`);
}

const options = { ...defaults, fromApi: false };

for (let i = 0; i < argv.length; i += 1) {
  const arg = argv[i];
  if (arg === '--api-base' && argv[i + 1]) {
    options.apiBase = argv[++i];
  } else if (arg === '--input' && argv[i + 1]) {
    options.inputPath = argv[++i];
  } else if (arg === '--output' && argv[i + 1]) {
    options.outputPath = argv[++i];
  } else if (arg === '--from-api') {
    options.fromApi = true;
  } else if (arg === '--commit') {
    options.dryRun = false;
  } else if (arg === '--delay' && argv[i + 1]) {
    options.delayMs = Number(argv[++i]) || 0;
  } else if (arg === '--help' || arg === '-h') {
    showHelp();
    process.exit(0);
  } else {
    console.error(`[warn] Unknown argument: ${arg}`);
  }
}

function normalizeApiBase(url) {
  return url.replace(/\/+$/, '');
}

function nk(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function safeNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
}

function toIso(value) {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'number') {
    if (value > 1e12) return new Date(value).toISOString();
    if (value > 1e9) return new Date(value * 1000).toISOString();
    return undefined;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    if (/^\d+$/.test(trimmed)) {
      return toIso(Number(trimmed));
    }
    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
    return trimmed;
  }
  return undefined;
}

function ensureArray(input) {
  if (!input) return [];
  if (Array.isArray(input)) return input;
  return [input];
}

function objectLabel(obj) {
  if (!obj || typeof obj !== 'object') return '';
  const preferredKeys = ['name', 'label', 'title', 'value', 'displayName', 'text', 'masterName'];
  for (const key of preferredKeys) {
    const val = obj[key];
    if (val !== undefined && val !== null && String(val).trim()) {
      return nk(val);
    }
  }
  if (typeof obj.id === 'string' && obj.id.trim()) {
    return obj.id.trim();
  }
  return '';
}

function collectStrings(value) {
  const result = new Set();
  const visit = (item) => {
    if (item === null || item === undefined) return;
    if (Array.isArray(item)) {
      item.forEach(visit);
      return;
    }
    if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') {
      const str = nk(item);
      if (str) result.add(str);
      return;
    }
    if (typeof item === 'object') {
      const label = objectLabel(item);
      if (label) result.add(label);
      for (const key of Object.keys(item)) {
        visit(item[key]);
      }
    }
  };
  visit(value);
  return Array.from(result);
}

function collectDepartments(v1) {
  const sources = [
    v1.departments,
    v1.departments?.master,
    v1.departments?.others,
    v1.departmentList,
    v1.basic?.departments,
    v1.facilityAttributes?.departments,
  ];
  const result = new Set();
  for (const source of sources) {
    for (const value of collectStrings(source)) {
      if (value) result.add(value);
    }
  }
  return Array.from(result);
}

function cleanObject(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  for (const key of Object.keys(obj)) {
    const value = obj[key];
    if (value === '' || value === null || value === undefined || (Array.isArray(value) && value.length === 0)) {
      delete obj[key];
    }
  }
  return obj;
}

function extractLocation(v1) {
  const source = v1.location || {};
  const lat = safeNumber(v1.latitude ?? source.lat ?? source.latitude);
  const lng = safeNumber(v1.longitude ?? source.lng ?? source.lon ?? source.longitude);
  const formattedAddress = nk(source.formattedAddress || v1.formattedAddress || '');
  const payload = {};
  if (lat !== undefined) payload.lat = lat;
  if (lng !== undefined) payload.lng = lng;
  if (formattedAddress) payload.formattedAddress = formattedAddress;
  if (nk(source.source)) payload.source = source.source;
  if (nk(source.geocodedAt)) payload.geocodedAt = source.geocodedAt;
  if (nk(source.geocodeStatus)) payload.geocodeStatus = source.geocodeStatus;
  return Object.keys(payload).length ? payload : undefined;
}

function buildSearchFacets(v1, v2) {
  const set = new Set();
  const departments = collectDepartments(v1);
  for (const dept of departments) {
    set.add(`department:${dept}`);
  }
  for (const svc of v2?.services || []) {
    if (svc.masterId) set.add(`service:${svc.masterId}`);
    else if (svc.name) set.add(`service:${svc.name}`);
    if (svc.category) set.add(`serviceCategory:${svc.category}`);
  }
  for (const test of v2?.tests || []) {
    if (test.masterId) set.add(`test:${test.masterId}`);
    else if (test.name) set.add(`test:${test.name}`);
    if (test.category) set.add(`testCategory:${test.category}`);
  }
  for (const qual of v2?.qualifications || []) {
    if (qual.masterId) set.add(`qualification:${qual.masterId}`);
    else if (qual.name) set.add(`qualification:${qual.name}`);
  }
  const homeCare = v2?.facilityAttributes?.homeCare;
  if (homeCare) set.add('homeCare:true');
  if (v2?.clinicType) set.add(`clinicType:${v2.clinicType}`);
  return Array.from(set).sort();
}

function transformClinic(v1) {
  const id = v1.id || v1.clinicId || v1.uuid || v1.key;
  const createdAt = toIso(v1.createdAt ?? v1.created_at);
  const updatedAt = toIso(v1.updatedAt ?? v1.updated_at);
  const createdBy = nk(v1.createdBy ?? v1.created_by ?? '');
  const updatedBy = nk(v1.updatedBy ?? v1.updated_by ?? '');
  const basic = {
    name: nk(v1.name || v1.basic?.name || ''),
    nameKana: nk(v1.nameKana || v1.basic?.nameKana || ''),
    postalCode: nk(v1.postalCode || v1.basic?.postalCode || ''),
    address: nk(v1.address || v1.basic?.address || ''),
    phone: nk(v1.phone || v1.tel || v1.basic?.phone || ''),
    fax: nk(v1.fax || v1.basic?.fax || ''),
    website: nk(v1.website || v1.url || v1.basic?.website || ''),
    email: nk(v1.email || v1.basic?.email || ''),
  };
  if (!basic.name) basic.name = nk(v1.displayName || '');
  const location = extractLocation(v1);
  const homeCareRaw = v1.homeCare ?? v1.home_visit_medical ?? v1.homeCareFlag;
  let homeCareValue;
  if (typeof homeCareRaw === 'boolean') {
    homeCareValue = homeCareRaw;
  } else if (typeof homeCareRaw === 'number') {
    homeCareValue = homeCareRaw === 1;
  } else if (typeof homeCareRaw === 'string') {
    const normalized = homeCareRaw.trim().toLowerCase();
    homeCareValue = ['true', '1', 'yes', 'y'].includes(normalized);
  }

  let facilityAttributes = {
    bedCount: safeNumber(v1.bedCount ?? v1.beds),
    departments: collectDepartments(v1).sort(),
    homeCare: homeCareValue ? true : undefined,
    emergencyLevel: nk(v1.emergencyLevel || v1.emergency || ''),
  };
  cleanObject(facilityAttributes);
  if (!Object.keys(facilityAttributes).length) {
    facilityAttributes = undefined;
  }

  const services = ensureArray(v1.services).map((svc) => cleanObject({
    masterId: nk(svc?.masterId || svc?.masterKey || svc?.id || ''),
    name: nk(svc?.name || objectLabel(svc)),
    category: nk(svc?.category || svc?.type || ''),
    description: nk(svc?.desc || svc?.description || ''),
    notes: nk(svc?.notes || ''),
    source: nk(svc?.source || ''),
  })).filter((svc) => svc.masterId || svc.name);

  const tests = ensureArray(v1.tests).map((test) => cleanObject({
    masterId: nk(test?.masterId || test?.masterKey || test?.id || ''),
    name: nk(test?.name || objectLabel(test)),
    category: nk(test?.category || test?.type || ''),
    description: nk(test?.desc || test?.description || ''),
    notes: nk(test?.notes || ''),
    source: nk(test?.source || ''),
  })).filter((test) => test.masterId || test.name);

  const qualifications = ensureArray(v1.qualifications || v1.personalQualifications).map((qual) => cleanObject({
    masterId: nk(qual?.masterId || qual?.masterKey || qual?.id || ''),
    name: nk(qual?.name || objectLabel(qual)),
    issuer: nk(qual?.issuer || qual?.organization || qual?.societyName || ''),
    notes: nk(qual?.notes || qual?.memo || ''),
    obtainedAt: toIso(qual?.obtainedAt || qual?.issuedAt),
  })).filter((qual) => qual.masterId || qual.name);

  const managerAccounts = ensureArray(v1.managerAccounts).map((accountId) => nk(accountId)).filter(Boolean);
  const staffMemberships = ensureArray(v1.staffMemberships).map((membershipId) => nk(membershipId)).filter(Boolean);

  const v2 = {
    id,
    schemaVersion: 2,
    basic,
    location,
    clinicType: nk(v1.clinicType || 'clinic'),
    facilityAttributes,
    services,
    tests,
    qualifications,
    managerAccounts,
    staffMemberships,
    status: nk(v1.status || 'active') || 'active',
    auditTrail: {
      lastUpdatedAt: updatedAt || toIso(v1.lastUpdatedAt ?? v1.last_updated_at),
      lastUpdatedBy: nk(v1.updatedBy || v1.lastUpdatedBy || ''),
      lastAction: nk(v1.lastAction || ''),
    },
    metadata: {
      createdAt: createdAt || null,
      createdBy: createdBy || null,
      updatedAt: updatedAt || null,
      updatedBy: updatedBy || null,
      notes: nk(v1.notes || ''),
    },
    reserved: {
      parentOrganizationId: v1.parentOrganizationId || null,
      groupCodes: ensureArray(v1.groupCodes || v1.groupCode).filter(Boolean),
    },
  };

  v2.searchFacets = buildSearchFacets(v1, v2);

  cleanObject(v2.auditTrail);
  if (!v2.auditTrail || !Object.keys(v2.auditTrail).length) delete v2.auditTrail;

  cleanObject(v2.metadata);
  if (!v2.metadata || !Object.keys(v2.metadata).length) delete v2.metadata;

  if (v2.facilityAttributes) {
    cleanObject(v2.facilityAttributes);
    if (!Object.keys(v2.facilityAttributes).length) delete v2.facilityAttributes;
  }

  cleanObject(v2.reserved);
  if (!v2.reserved || !Object.keys(v2.reserved).length) delete v2.reserved;

  if (!v2.managerAccounts.length && v2.status === 'active') {
    v2.status = 'pending';
  }

  return v2;
}

async function readJsonLines(path) {
  const items = [];
  const stream = fs.createReadStream(path, { encoding: 'utf8' });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    items.push(JSON.parse(trimmed));
  }
  return items;
}

async function fetchClinicsFromApi() {
  const res = await fetch(`${normalizeApiBase(options.apiBase)}/api/listClinics`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status} ${res.statusText}: ${text}`);
  }
  const data = await res.json();
  return Array.isArray(data?.clinics) ? data.clinics : [];
}

async function loadClinics() {
  if (options.fromApi) {
    console.log('[info] Fetching clinics from API…');
    return fetchClinicsFromApi();
  }
  if (!options.inputPath) {
    throw new Error('Input file is required unless --from-api is specified.');
  }
  const resolved = resolve(options.inputPath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Input file not found: ${resolved}`);
  }
  if (resolved.endsWith('.json')) {
    const content = await readFile(resolved, 'utf8');
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed?.clinics)) return parsed.clinics;
    throw new Error('JSON file must be an array or object with clinics array.');
  }
  return readJsonLines(resolved);
}

function nowString() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
}

async function writeJsonLines(path, items) {
  const resolved = resolve(path);
  await mkdir(dirname(resolved), { recursive: true });
  const stream = fs.createWriteStream(resolved, { encoding: 'utf8' });
  await new Promise((resolveStream, rejectStream) => {
    stream.on('error', rejectStream);
    stream.on('finish', resolveStream);
    for (const item of items) {
      stream.write(`${JSON.stringify(item)}\n`);
    }
    stream.end();
  });
}

async function requestJson(path, init = {}) {
  const res = await fetch(`${normalizeApiBase(options.apiBase)}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status} ${res.statusText}: ${text}`);
  }
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return res.json();
  }
  return res.text();
}

async function main() {
  console.log(`[info] API base: ${options.apiBase}`);
  console.log(`[info] mode: ${options.dryRun ? 'dry-run' : 'commit'}`);
  if (options.fromApi) {
    console.log('[info] Input mode: API');
  } else {
    console.log(`[info] Input file: ${options.inputPath}`);
  }

  const clinicsV1 = await loadClinics();
  console.log(`[info] Loaded ${clinicsV1.length} clinic records.`);

  const converted = clinicsV1.map((clinic) => transformClinic(clinic));
  const outputPath = options.outputPath
    ? resolve(options.outputPath)
    : resolve('./tmp', `clinics-v2-${nowString()}.jsonl`);
  await writeJsonLines(outputPath, converted);
  console.log(`[info] Wrote converted JSONL to ${outputPath}`);

  if (options.dryRun) {
    console.log('[info] Dry run complete. Use --commit to push updates.');
    return;
  }

  console.log('[info] Submitting converted clinics to API…');
  let success = 0;
  for (const clinic of converted) {
    try {
      await requestJson('/api/updateClinic', {
        method: 'POST',
        body: JSON.stringify(clinic),
      });
      success += 1;
      console.log(`[updated] ${clinic.id || clinic.basic?.name}`);
      if (options.delayMs > 0) {
        await delay(options.delayMs);
      }
    } catch (err) {
      console.error(`[error] Failed to update ${clinic.id || clinic.basic?.name}: ${err.message}`);
    }
  }
  console.log(`[info] Finished submitting clinics. Success: ${success}/${converted.length}`);
}

main().catch((err) => {
  console.error(`[error] ${err.message}`);
  process.exitCode = 1;
});
