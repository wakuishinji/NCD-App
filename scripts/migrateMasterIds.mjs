#!/usr/bin/env node
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';

const MASTER_TYPES = ['service', 'test', 'qual', 'facility', 'department', 'symptom', 'bodySite'];

function normalizeSegment(value) {
  return (value ?? '')
    .toString()
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');
}

function legacyKey(type, category, name) {
  return `master:${type}:${normalizeSegment(category)}|${normalizeSegment(name)}`;
}

function aliasFromId(type, id) {
  return `id:${type}:${id}`;
}

function parseAlias(alias) {
  if (typeof alias !== 'string' || !alias.startsWith('master:')) return null;
  const body = alias.slice('master:'.length);
  const typeEnd = body.indexOf(':');
  if (typeEnd === -1) return null;
  const type = body.slice(0, typeEnd);
  const rest = body.slice(typeEnd + 1);
  const nameSep = rest.indexOf('|');
  if (nameSep === -1) return null;
  const category = rest.slice(0, nameSep);
  const name = rest.slice(nameSep + 1);
  return { type, category, name, comparable: legacyKey(type, category, name) };
}

const argv = process.argv.slice(2);
const options = {
  apiBase: process.env.NCD_API_BASE || 'https://ncd-app.altry.workers.dev',
  dryRun: false,
  delayMs: Number(process.env.NCD_MIGRATE_DELAY_MS || 0),
};
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (arg === '--api-base' && argv[i + 1]) {
    options.apiBase = argv[++i];
  } else if (arg === '--dry-run') {
    options.dryRun = true;
  } else if (arg === '--delay' && argv[i + 1]) {
    options.delayMs = Number(argv[++i]) || 0;
  }
}

function joinUrl(base, path) {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${base.replace(/\/$/, '')}${normalized}`;
}

async function fetchJson(path, init = {}) {
  const res = await fetch(joinUrl(options.apiBase, path), {
    headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
    ...init,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status} ${res.statusText}: ${text}`);
  }
  return res.json();
}

async function loadMasterMaps() {
  const aliasMap = new Map();
  const idMap = new Map();
  for (const type of MASTER_TYPES) {
    const data = await fetchJson(`/api/listMaster?type=${encodeURIComponent(type)}`);
    const items = Array.isArray(data?.items) ? data.items : [];
    for (const item of items) {
      if (!item || typeof item !== 'object' || !item.id) continue;
      const record = { type, id: item.id, category: item.category, name: item.name, legacyKey: item.legacyKey }; // minimal snapshot
      idMap.set(aliasFromId(type, item.id), record);
      const aliases = new Set([item.legacyKey, ...(Array.isArray(item.legacyAliases) ? item.legacyAliases : [])]);
      for (const alias of aliases) {
        if (!alias) continue;
        aliasMap.set(alias, record);
        const parsed = parseAlias(alias);
        if (parsed && parsed.comparable) {
          aliasMap.set(parsed.comparable, record);
        }
      }
      if (item.category && item.name) {
        aliasMap.set(legacyKey(type, item.category, item.name), record);
      }
    }
  }
  return { aliasMap, idMap };
}

function findMasterRecord(type, entry, maps) {
  if (!entry || typeof entry !== 'object') return null;
  const candidates = new Set();
  const { aliasMap, idMap } = maps;

  if (typeof entry.masterId === 'string' && entry.masterId.trim()) {
    const alias = aliasFromId(type, entry.masterId.trim());
    if (idMap.has(alias)) {
      return idMap.get(alias);
    }
  }

  const possibleKeys = ['masterId', 'master_id', 'masterIdSlug'];
  for (const prop of possibleKeys) {
    const value = entry[prop];
    if (typeof value === 'string' && value.trim()) {
      const alias = aliasFromId(type, value.trim());
      if (idMap.has(alias)) {
        return idMap.get(alias);
      }
    }
  }

  const masterKeyProps = ['masterKey', 'masterkey', 'master_key'];
  for (const prop of masterKeyProps) {
    const value = entry[prop];
    if (typeof value === 'string' && value.trim()) {
      candidates.add(value.trim());
    }
  }

  if (entry.category && entry.name) {
    candidates.add(legacyKey(type, entry.category, entry.name));
  }

  for (const candidate of candidates) {
    const direct = aliasMap.get(candidate);
    if (direct) return direct;
    const parsed = parseAlias(candidate);
    if (parsed && parsed.comparable) {
      const comparable = aliasMap.get(parsed.comparable);
      if (comparable) return comparable;
    }
  }

  return null;
}

function updateEntries(entries, type, maps) {
  if (!Array.isArray(entries)) return { changed: false, entries };
  let changed = false;
  const updated = entries.map((entry) => {
    if (!entry || typeof entry !== 'object') return entry;
    const record = findMasterRecord(type, entry, maps);
    if (!record) return entry;
    const next = { ...entry };
    if (next.masterId !== record.id) {
      next.masterId = record.id;
      changed = true;
    }
    if (next.masterKey !== record.legacyKey) {
      next.masterKey = record.legacyKey;
      changed = true;
    }
    return next;
  });
  return { changed, entries: updated };
}

async function migrateClinics(maps) {
  const data = await fetchJson('/api/listClinics');
  const clinics = Array.isArray(data?.clinics) ? data.clinics : [];
  let updatedCount = 0;
  for (const clinic of clinics) {
    if (!clinic || typeof clinic !== 'object' || !clinic.name) continue;
    let changed = false;
    const nextClinic = { ...clinic };

    const targets = [
      { field: 'services', type: 'service' },
      { field: 'tests', type: 'test' },
      { field: 'personalQualifications', type: 'qual' },
      { field: 'facilityAccreditations', type: 'facility' },
      { field: 'departments', type: 'department' },
    ];

    for (const target of targets) {
      const src = Array.isArray(nextClinic[target.field]) ? nextClinic[target.field] : [];
      const { changed: entryChanged, entries } = updateEntries(src, target.type, maps);
      if (entryChanged) {
        nextClinic[target.field] = entries;
        changed = true;
      }
    }

    if (!changed) continue;

    updatedCount += 1;
    if (options.dryRun) {
      console.log(`[dry-run] would update clinic: ${clinic.name}`);
      continue;
    }

    const payload = { ...nextClinic, name: nextClinic.name };
    await fetchJson('/api/updateClinic', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    if (options.delayMs > 0) {
      await delay(options.delayMs);
    }
    console.log(`[updated] ${clinic.name}`);
  }
  console.log(`Processed ${clinics.length} clinics, updated ${updatedCount}.`);
}

(async () => {
  try {
    console.log(`Using API base: ${options.apiBase}`);
    const maps = await loadMasterMaps();
    console.log(`Loaded ${maps.aliasMap.size} master aliases.`);
    await migrateClinics(maps);
  } catch (err) {
    console.error('Migration failed:', err);
    process.exitCode = 1;
  }
})();
