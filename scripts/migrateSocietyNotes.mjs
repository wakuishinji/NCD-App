#!/usr/bin/env node
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';

const argv = process.argv.slice(2);
const options = {
  apiBase: process.env.NCD_API_BASE || 'https://ncd-app.altry.workers.dev',
  dryRun: true,
  delayMs: Number(process.env.NCD_MIGRATE_DELAY_MS || 0),
};
const collator = new Intl.Collator('ja');

function showHelp() {
  console.log(`Usage: migrateSocietyNotes [options]\n\n` +
    `Options:\n` +
    `  --api-base <url>    API base URL (default: ${options.apiBase})\n` +
    `  --dry-run           Preview changes without updating data (default)\n` +
    `  --commit            Apply updates\n` +
    `  --delay <ms>        Delay between write operations\n` +
    `  --help              Show this help text`);
}

for (let i = 0; i < argv.length; i += 1) {
  const arg = argv[i];
  if (arg === '--api-base' && argv[i + 1]) {
    options.apiBase = argv[++i];
  } else if (arg === '--delay' && argv[i + 1]) {
    options.delayMs = Number(argv[++i]) || 0;
  } else if (arg === '--commit') {
    options.dryRun = false;
  } else if (arg === '--dry-run') {
    options.dryRun = true;
  } else if (arg === '--help' || arg === '-h') {
    showHelp();
    process.exit(0);
  }
}

function joinUrl(base, path) {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${base.replace(/\/$/, '')}${normalized}`;
}

function nk(value) {
  return (value ?? '')
    .toString()
    .trim();
}

function addSocietyPair(map, classification, name) {
  const cls = nk(classification);
  const society = nk(name);
  if (!society) return;
  if (!map.has(cls)) {
    map.set(cls, new Set());
  }
  map.get(cls).add(society);
}

function societyKey(classification, name) {
  return `${nk(classification)}::${nk(name)}`;
}

async function requestJson(path, init = {}) {
  const headers = { ...(init.headers || {}) };
  if (init.body && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(joinUrl(options.apiBase, path), {
    ...init,
    headers,
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

async function fetchJson(path) {
  return requestJson(path);
}

async function postJson(path, payload) {
  return requestJson(path, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

function extractParenthetical(text) {
  const value = nk(text);
  if (!value) return { base: '', notes: '' };
  const match = value.match(/^(.*?)[（(]([^（）()]+)[）)]$/);
  if (!match) return { base: value, notes: '' };
  return { base: nk(match[1]), notes: nk(match[2]) };
}

function deriveSocietyName(entry) {
  if (!entry || typeof entry !== 'object') return '';
  const direct = nk(entry.societyName || entry.society);
  if (direct) return direct;
  const notes = nk(entry.notes);
  if (notes) return notes;
  const issuer = nk(entry.issuer);
  if (issuer) return issuer;
  const { notes: extracted } = extractParenthetical(entry.name);
  return nk(extracted);
}

async function loadExistingSocieties() {
  const existing = new Set();
  try {
    const data = await fetchJson('/api/listMaster?type=society');
    const items = Array.isArray(data?.items) ? data.items : [];
    items.forEach(item => {
      const name = nk(item?.name);
      if (!name) return;
      const classification = nk(item?.category || item?.classification || '');
      existing.add(societyKey(classification, name));
    });
  } catch (err) {
    console.warn('[warn] failed to load society master:', err.message);
  }
  return existing;
}

async function loadQualificationSocieties() {
  const societies = new Map();
  try {
    const data = await fetchJson('/api/listMaster?type=qual');
    const items = Array.isArray(data?.items) ? data.items : [];
    items.forEach(item => {
      const name = nk(item?.notes || item?.issuer);
      if (!name) return;
      const classification = nk(item?.classification || item?.category || '');
      addSocietyPair(societies, classification, name);
    });
  } catch (err) {
    console.warn('[warn] failed to load qualification master:', err.message);
  }
  return societies;
}

async function migrateClinics(societies) {
  const updatedSocietyKeys = new Set();
  const result = await fetchJson('/api/listClinics');
  const clinics = Array.isArray(result?.clinics) ? result.clinics : [];
  let updatedCount = 0;

  for (const clinic of clinics) {
    if (!clinic || typeof clinic !== 'object') continue;
    const { name } = clinic;
    if (!name) continue;
    const personalList = Array.isArray(clinic.personalQualifications)
      ? clinic.personalQualifications
      : Array.isArray(clinic.qualifications)
        ? clinic.qualifications
        : [];

    if (!personalList.length) continue;

    let changed = false;
    const transformed = personalList.map(item => {
      if (!item || typeof item !== 'object') return item;
      const next = { ...item };
      const societyName = deriveSocietyName(next);
      const classification = nk(next.classification || next.qualType || next.type || '');
      if (societyName) {
        const key = societyKey(classification, societyName);
        updatedSocietyKeys.add(key);
        addSocietyPair(societies, classification, societyName);
      }
      const normalized = societyName;
      if (normalized && next.notes !== normalized) {
        next.notes = normalized;
        changed = true;
      }
      if (normalized && next.issuer !== normalized) {
        next.issuer = normalized;
        changed = true;
      }
      if (normalized && next.societyName !== normalized) {
        next.societyName = normalized;
        changed = true;
      }
      if (normalized && !next.societySource) {
        next.societySource = 'legacy';
        changed = true;
      }
      if (!normalized && next.societyName) {
        delete next.societyName;
        changed = true;
      }
      return next;
    });

    if (!changed) continue;

    updatedCount += 1;
    if (options.dryRun) {
      console.log(`[dry-run] would update clinic: ${name}`);
      continue;
    }

    const payload = {
      id: clinic.id,
      name,
      personalQualifications: transformed,
      qualifications: transformed,
    };

    await postJson('/api/updateClinic', payload);
    if (options.delayMs > 0) {
      await delay(options.delayMs);
    }
    console.log(`[updated] clinic: ${name}`);
  }

  return { clinicsProcessed: clinics.length, clinicsUpdated: updatedCount, societies: updatedSocietyKeys };
}

async function registerSocieties(values, existing) {
  const toRegister = [];
  for (const [classification, names] of values.entries()) {
    for (const name of names) {
      const key = societyKey(classification, name);
      if (existing.has(key)) continue;
      toRegister.push({ classification: nk(classification), name: nk(name) });
    }
  }

  if (!toRegister.length) {
    console.log('[info] no new society names to register.');
    return;
  }

  toRegister.sort((a, b) => {
    const clsCompare = collator.compare(a.classification, b.classification);
    if (clsCompare !== 0) return clsCompare;
    return collator.compare(a.name, b.name);
  });

  console.log(`[info] registering ${toRegister.length} society master entries${options.dryRun ? ' (dry-run)' : ''}.`);
  for (const entry of toRegister) {
    const { classification, name } = entry;
    const key = societyKey(classification, name);
    if (options.dryRun) {
      console.log(`[dry-run] would register society master: [${classification || '未分類'}] ${name}`);
      continue;
    }
    try {
      await postJson('/api/addMasterItem', {
        type: 'society',
        category: classification,
        classification,
        name,
        source: 'migrateSocietyNotes',
        status: 'candidate',
      });
      existing.add(key);
      if (options.delayMs > 0) {
        await delay(options.delayMs);
      }
      console.log(`[registered] society master: [${classification || '未分類'}] ${name}`);
    } catch (err) {
      console.warn(`[warn] failed to register society master "${name}": ${err.message}`);
      if (err.message.includes('type は') && err.message.includes('bodySite')) {
        console.warn('[warn] API does not yet support type "society". Aborting further registrations.');
        break;
      }
    }
  }
}


async function main() {
  console.log(`[info] API base: ${options.apiBase}`);
  console.log(`[info] mode: ${options.dryRun ? 'dry-run' : 'commit'}`);
  const existingSocieties = await loadExistingSocieties();
  const collectedSocieties = await loadQualificationSocieties();
  const migrationResult = await migrateClinics(collectedSocieties);

  console.log(`[info] processed clinics: ${migrationResult.clinicsProcessed}`);
  console.log(`[info] clinics needing update: ${migrationResult.clinicsUpdated}`);
  console.log(`[info] societies observed in migrations: ${migrationResult.societies.size}`);

  if (!options.dryRun) {
    console.log('[info] refreshing qualification list after updates...');
    // reload qualification master to include any notes added via updates
    try {
      const latest = await loadQualificationSocieties();
      for (const [classification, names] of latest.entries()) {
        names.forEach(name => addSocietyPair(collectedSocieties, classification, name));
      }
    } catch (_) {
      // already logged in helper
    }
  }

  await registerSocieties(collectedSocieties, existingSocieties);
}

main().catch(err => {
  console.error('[error]', err);
  process.exitCode = 1;
});
