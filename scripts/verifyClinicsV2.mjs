#!/usr/bin/env node
/**
 * Validate converted clinic records (schema v2) for required fields and
 * master references. Emits a summary and optionally a JSON report.
 */

import fs from 'node:fs';
import { createInterface } from 'node:readline';
import { dirname, resolve } from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import process from 'node:process';

const argv = process.argv.slice(2);
const defaults = {
  apiBase: process.env.NCD_API_BASE || 'https://ncd-app.altry.workers.dev',
  inputPath: '',
  reportPath: '',
  warnOnly: false,
  fromApi: false,
};

function showHelp() {
  console.log(`Usage: verifyClinicsV2 [options]

Options:
  --input <file>          Clinics JSON/JSONL file (required unless --from-api)
  --from-api              Fetch clinics via API instead of a local file
  --api-base <url>        API base URL (default: ${defaults.apiBase})
  --report <file>         Output JSON report path (default: none)
  --warn-only             Do not exit with error even if validation fails
  --help                  Show this help text
`);
}

const options = { ...defaults };

for (let i = 0; i < argv.length; i += 1) {
  const arg = argv[i];
  if (arg === '--api-base' && argv[i + 1]) {
    options.apiBase = argv[++i];
  } else if (arg === '--input' && argv[i + 1]) {
    options.inputPath = argv[++i];
  } else if (arg === '--from-api') {
    options.fromApi = true;
  } else if (arg === '--report' && argv[i + 1]) {
    options.reportPath = argv[++i];
  } else if (arg === '--warn-only') {
    options.warnOnly = true;
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

function isStringArray(value) {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
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

async function loadClinics() {
  if (options.fromApi) {
    console.log('[info] Fetching clinics from API…');
    const res = await fetch(`${normalizeApiBase(options.apiBase)}/api/listClinics`);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status} ${res.statusText}: ${text}`);
    }
    const data = await res.json();
    return Array.isArray(data?.clinics) ? data.clinics : [];
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

async function fetchMaster(type) {
  const url = `${normalizeApiBase(options.apiBase)}/api/listMaster?type=${encodeURIComponent(type)}&includeSimilar=false`;
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to fetch ${type} master: HTTP ${res.status} ${text}`);
  }
  const data = await res.json();
  const items = Array.isArray(data?.items) ? data.items : [];
  const ids = new Set();
  for (const item of items) {
    if (item.id) ids.add(String(item.id));
    if (item.masterId) ids.add(String(item.masterId));
    if (typeof item.legacyKey === 'string') ids.add(item.legacyKey);
    if (Array.isArray(item.legacyAliases)) {
      for (const alias of item.legacyAliases) {
        if (alias) ids.add(String(alias));
      }
    }
  }
  return ids;
}

async function loadMasters() {
  console.log('[info] Fetching master references…');
  const [service, test, qual] = await Promise.all([
    fetchMaster('service').catch((err) => {
      console.warn(`[warn] ${err.message}`);
      return new Set();
    }),
    fetchMaster('test').catch((err) => {
      console.warn(`[warn] ${err.message}`);
      return new Set();
    }),
    fetchMaster('qual').catch((err) => {
      console.warn(`[warn] ${err.message}`);
      return new Set();
    }),
  ]);
  return { service, test, qual };
}

function recordIssue(collector, clinic, level, message, path = '') {
  const entry = {
    clinicId: clinic?.id || clinic?.basic?.name || '(unknown)',
    clinicName: clinic?.basic?.name || '',
    level,
    message,
    path,
  };
  collector.items.push(entry);
  collector.counts[level] = (collector.counts[level] || 0) + 1;
}

function validateClinic(clinic, masters, collector) {
  if (!clinic || typeof clinic !== 'object') {
    recordIssue(collector, { id: '(unknown)' }, 'error', 'Clinic record is not an object');
    return;
  }

  if (!nk(clinic.id)) {
    recordIssue(collector, clinic, 'error', 'Missing clinic.id');
  }

  if (clinic.schemaVersion !== 2) {
    recordIssue(collector, clinic, 'error', `schemaVersion must be 2 (received: ${clinic.schemaVersion})`);
  }

  if (!clinic.basic || typeof clinic.basic !== 'object') {
    recordIssue(collector, clinic, 'error', 'basic object is required', 'basic');
  } else {
    if (!nk(clinic.basic.name)) {
      recordIssue(collector, clinic, 'error', 'basic.name is required', 'basic.name');
    }
    if (!nk(clinic.basic.address)) {
      recordIssue(collector, clinic, 'warn', 'basic.address is empty', 'basic.address');
    }
    if (!nk(clinic.basic.postalCode)) {
      recordIssue(collector, clinic, 'warn', 'basic.postalCode is empty', 'basic.postalCode');
    }
  }

  if (clinic.location && typeof clinic.location === 'object') {
    const { lat, lng } = clinic.location;
    if (lat !== undefined && !Number.isFinite(lat)) {
      recordIssue(collector, clinic, 'warn', 'location.lat is not a finite number', 'location.lat');
    }
    if (lng !== undefined && !Number.isFinite(lng)) {
      recordIssue(collector, clinic, 'warn', 'location.lng is not a finite number', 'location.lng');
    }
  }

  const statusWhitelist = new Set(['active', 'inactive', 'pending']);
  if (clinic.status && !statusWhitelist.has(clinic.status)) {
    recordIssue(collector, clinic, 'error', `Unknown clinic status: ${clinic.status}`, 'status');
  }

  if (!Array.isArray(clinic.managerAccounts)) {
    recordIssue(collector, clinic, 'warn', 'managerAccounts should be an array of account IDs', 'managerAccounts');
  } else if (!isStringArray(clinic.managerAccounts)) {
    recordIssue(collector, clinic, 'warn', 'managerAccounts should only contain strings', 'managerAccounts');
  }

  if (!Array.isArray(clinic.staffMemberships)) {
    recordIssue(collector, clinic, 'warn', 'staffMemberships should be an array of membership IDs', 'staffMemberships');
  } else if (!isStringArray(clinic.staffMemberships)) {
    recordIssue(collector, clinic, 'warn', 'staffMemberships should only contain strings', 'staffMemberships');
  }

  if (!Array.isArray(clinic.searchFacets) || !clinic.searchFacets.every((v) => typeof v === 'string')) {
    recordIssue(collector, clinic, 'warn', 'searchFacets should be an array of strings', 'searchFacets');
  }

  const checkEntries = (entries, type, masterSet, basePath) => {
    if (!Array.isArray(entries)) return;
    entries.forEach((entry, index) => {
      if (!entry || typeof entry !== 'object') {
        recordIssue(collector, clinic, 'warn', `${type} entry must be an object`, `${basePath}[${index}]`);
        return;
      }
      if (!nk(entry.name) && !nk(entry.masterId)) {
        recordIssue(collector, clinic, 'warn', `${type} entry missing name/masterId`, `${basePath}[${index}]`);
      }
      if (entry.masterId && masterSet && masterSet.size && !masterSet.has(entry.masterId)) {
        recordIssue(collector, clinic, 'error', `${type} masterId not found: ${entry.masterId}`, `${basePath}[${index}].masterId`);
      }
    });
  };

  checkEntries(clinic.services, 'service', masters.service, 'services');
  checkEntries(clinic.tests, 'test', masters.test, 'tests');
  checkEntries(clinic.qualifications, 'qualification', masters.qual, 'qualifications');
}

async function main() {
  console.log(`[info] API base: ${options.apiBase}`);
  const clinics = await loadClinics();
  console.log(`[info] Loaded ${clinics.length} clinic records.`);

  const masters = await loadMasters();

  const collector = { items: [], counts: { error: 0, warn: 0 } };
  clinics.forEach((clinic) => validateClinic(clinic, masters, collector));

  const { items, counts } = collector;
  if (items.length === 0) {
    console.log('[info] No issues found.');
  } else {
    console.log(`[info] Detected ${items.length} issues (errors: ${counts.error}, warnings: ${counts.warn}).`);
    const grouped = new Map();
    for (const issue of items) {
      const key = issue.clinicId;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(issue);
    }
    for (const [clinicId, issues] of grouped) {
      console.log(`- Clinic ${clinicId}${issues[0]?.clinicName ? ` (${issues[0].clinicName})` : ''}`);
      for (const issue of issues) {
        console.log(`    [${issue.level}] ${issue.path ? `${issue.path}: ` : ''}${issue.message}`);
      }
    }
  }

  if (options.reportPath) {
    const reportTarget = resolve(options.reportPath);
    await mkdir(dirname(reportTarget), { recursive: true });
    await writeFile(reportTarget, JSON.stringify({ summary: counts, issues: items }, null, 2), 'utf8');
    console.log(`[info] Wrote report to ${reportTarget}`);
  }

  if (collector.counts.error > 0 && !options.warnOnly) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(`[error] ${err.message}`);
  process.exit(1);
});

