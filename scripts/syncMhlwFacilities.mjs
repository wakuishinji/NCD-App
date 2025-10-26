#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import http from 'node:http';

const DEFAULT_API_BASE = process.env.API_BASE || 'https://ncd-app.altry.workers.dev';
const DEFAULT_JSON_PATH = path.resolve('tmp/mhlw-facilities.json');
const DEFAULT_OUTPUT = path.resolve('tmp/mhlw-sync-report.json');

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--api-base') {
      args.apiBase = argv[++i];
    } else if (arg === '--token') {
      args.token = argv[++i];
    } else if (arg === '--json') {
      args.json = argv[++i];
    } else if (arg === '--outfile') {
      args.outfile = argv[++i];
    } else if (arg === '--dry-run') {
      args.dryRun = true;
    } else if (arg === '--limit') {
      args.limit = Number(argv[++i]);
    } else if (arg === '--force') {
      args.force = true;
    } else if (arg === '--help' || arg === '-h') {
      args.help = true;
    }
  }
  return args;
}

function printHelp() {
  console.log(`syncMhlwFacilities\n\n` +
    `Usage:\n  node scripts/syncMhlwFacilities.mjs [options]\n\n` +
    `Options:\n  --api-base   API base URL (default: ${DEFAULT_API_BASE})\n  --token      Bearer token (systemRoot access token)\n  --json       Path to mhlw-facilities JSON (default: ${DEFAULT_JSON_PATH})\n  --outfile    Path for report JSON (default: ${DEFAULT_OUTPUT})\n  --dry-run    Do not call APIs, just show matches\n  --limit      Limit number of clinics processed (for testing)\n  --force      Overwrite existing mhlwFacilityId (default: false)\n`);
}

function toNormalized(str) {
  return (str || '').toString().trim();
}

function normalizeName(str) {
  return toNormalized(str).replace(/[\s　]/g, '').toLowerCase();
}

function normalizeAddress(str) {
  return toNormalized(str).replace(/[\s　]/g, '').toLowerCase();
}

function matchFacility(clinic, facilities) {
  const normalizedName = normalizeName(clinic.name);
  const normalizedAddress = normalizeAddress(clinic.address);
  const clinicType = (clinic.facilityType || '').toLowerCase();
  let bestMatch = null;
  let bestScore = 0;
  for (const entry of facilities) {
    let scoreType = 0;
    if (clinicType && entry.facilityType) {
      scoreType = entry.facilityType.toLowerCase() === clinicType ? 0.2 : 0;
    }
    const scoreName = normalizedName && normalizeName(entry.name) === normalizedName ? 0.7 : 0;
    const scoreAddress = normalizedAddress && normalizeAddress(entry.address) === normalizedAddress ? 0.3 : 0;
    const score = scoreName + scoreAddress + scoreType;
    if (score > bestScore) {
      bestScore = score;
      bestMatch = entry;
    }
  }
  if (bestScore >= 0.7) {
    return { match: bestMatch, score: bestScore };
  }
  return null;
}

function makeRequest(url, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const isHttps = parsed.protocol === 'https:';
    const options = {
      method,
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname + parsed.search,
      headers,
    };
    const req = (isHttps ? https : http).request(options, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: data,
        });
      });
    });
    req.on('error', reject);
    if (body) {
      req.write(body);
    }
    req.end();
  });
}

async function fetchJson(url, options = {}) {
  const headers = options.headers || {};
  if (options.body && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  const body = options.body && typeof options.body !== 'string' ? JSON.stringify(options.body) : options.body;
  const response = await makeRequest(url, { ...options, headers, body });
  if (!response.status || response.status < 200 || response.status >= 300) {
    let payload = {};
    try {
      payload = JSON.parse(response.body || '{}');
    } catch (_) {}
    const error = new Error(payload.message || `Request failed: ${response.status}`);
    error.payload = payload;
    error.status = response.status;
    throw error;
  }
  if (!response.body) return null;
  return JSON.parse(response.body);
}

async function loadMhlwFacilities(jsonPath) {
  const raw = await fs.promises.readFile(jsonPath, 'utf8');
  let data;
  try {
    data = JSON.parse(raw);
  } catch (_) {
    data = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch (err) {
          console.warn('[syncMhlwFacilities] failed to parse JSONL line:', err);
          return null;
        }
      })
      .filter(Boolean);
  }
  const facilities = Array.isArray(data?.facilities) ? data.facilities : Array.isArray(data) ? data : [];
  return facilities.map((entry) => ({
    facilityId: toNormalized(entry.facilityId),
    name: toNormalized(entry.name || entry.facilityName),
    address: toNormalized(entry.address),
    postalCode: toNormalized(entry.postalCode),
    phone: toNormalized(entry.phone),
    prefecture: toNormalized(entry.prefecture),
    city: toNormalized(entry.city),
    latitude: entry.latitude !== undefined ? Number(entry.latitude) : undefined,
    longitude: entry.longitude !== undefined ? Number(entry.longitude) : undefined,
    facilityType: (toNormalized(entry.facilityType || entry.type || '').toLowerCase() || 'clinic'),
    scheduleEntries: Array.isArray(entry.scheduleEntries) ? entry.scheduleEntries : [],
    mhlwDepartments: Array.isArray(entry.mhlwDepartments) ? entry.mhlwDepartments : [],
  })).filter((entry) => entry.facilityId);
}

async function loadClinics(apiBase, token) {
  const url = `${apiBase}/api/listClinics`;
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const payload = await fetchJson(url, { method: 'GET', headers });
  return Array.isArray(payload?.clinics) ? payload.clinics : [];
}

async function updateClinicFacilityId(apiBase, token, clinicName, facilityId, dryRun) {
  if (dryRun) {
    return { ok: true, dryRun: true };
  }
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetchJson(`${apiBase}/api/updateClinic`, {
    method: 'POST',
    headers,
    body: { name: clinicName, mhlwFacilityId: facilityId },
  });
}

async function syncClinicFromFacility(apiBase, token, clinic, facility, dryRun) {
  if (dryRun) {
    return { ok: true, dryRun: true };
  }
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetchJson(`${apiBase}/api/admin/clinic/syncFromMhlw`, {
    method: 'POST',
    headers,
    body: {
      facilityId: facility.facilityId,
      clinicId: clinic.id,
      facilityData: facility,
    },
  });
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    process.exit(0);
    return;
  }
  const apiBase = args.apiBase || DEFAULT_API_BASE;
  const jsonPath = args.json || DEFAULT_JSON_PATH;
  const outfile = args.outfile || DEFAULT_OUTPUT;
  const token = args.token || process.env.MHLW_SYNC_TOKEN;
  const dryRun = Boolean(args.dryRun);
  const limit = args.limit ? Number(args.limit) : undefined;
  const force = Boolean(args.force);

  if (!fs.existsSync(jsonPath)) {
    console.error(`MHLW facilities JSON not found at ${jsonPath}`);
    process.exit(1);
  }

  if (!token) {
    console.warn('Warning: Bearer token not provided. Provide via --token or environment variable MHLW_SYNC_TOKEN. Requests may fail.');
  }

  try {
  const facilities = await loadMhlwFacilities(jsonPath);
  console.log(`Loaded ${facilities.length} facilities from ${jsonPath}`);

    const clinics = await loadClinics(apiBase, token);
    console.log(`Fetched ${clinics.length} clinics from API.`);

    const report = {
      timestamp: new Date().toISOString(),
      apiBase,
      totalClinics: clinics.length,
      processed: 0,
      matched: 0,
      updated: [],
      skipped: [],
      errors: [],
      dryRun,
    };

  const facilityIndex = facilities.reduce((acc, entry) => {
      acc[entry.facilityId.toUpperCase()] = entry;
      return acc;
    }, {});

    for (const clinic of clinics) {
      if (limit && report.processed >= limit) {
        break;
      }
      report.processed += 1;

      const alreadyHasId = clinic.mhlwFacilityId && clinic.mhlwFacilityId.trim();
      if (alreadyHasId && !force) {
        report.skipped.push({ clinicId: clinic.id, reason: 'alreadyHasId', facilityId: clinic.mhlwFacilityId });
        continue;
      }

      let facility = null;
      if (clinic.mhlwFacilityId) {
        facility = facilityIndex[clinic.mhlwFacilityId.toUpperCase()] || null;
      }
      if (!facility) {
        const match = matchFacility(clinic, facilities);
        if (match?.match) {
          facility = match.match;
        }
      }

      if (!facility) {
        report.skipped.push({ clinicId: clinic.id, reason: 'noMatch', name: clinic.name });
        continue;
      }

      report.matched += 1;
      try {
        if (!dryRun) {
          await updateClinicFacilityId(apiBase, token, clinic.name, facility.facilityId, dryRun);
          await syncClinicFromFacility(apiBase, token, clinic, facility, dryRun);
        }
        report.updated.push({ clinicId: clinic.id, facilityId: facility.facilityId, facilityName: facility.name, facilityType: facility.facilityType });
      } catch (error) {
        report.errors.push({ clinicId: clinic.id, message: error.message, payload: error.payload });
        console.error('[syncMhlwFacilities] failed', error);
      }
    }

    fs.mkdirSync(path.dirname(outfile), { recursive: true });
    fs.writeFileSync(outfile, JSON.stringify(report, null, 2));
    console.log(`Report written to ${outfile}`);

  } catch (error) {
    console.error('Sync failed:', error);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
