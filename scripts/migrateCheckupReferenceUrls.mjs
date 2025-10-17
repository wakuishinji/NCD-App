#!/usr/bin/env node
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';

const argv = process.argv.slice(2);
const options = {
  apiBase: process.env.NCD_API_BASE || 'https://ncd-app.altry.workers.dev',
  dryRun: true,
  delayMs: Number(process.env.NCD_MIGRATE_DELAY_MS || 0),
};

function showHelp() {
  console.log(`Usage: migrateCheckupReferenceUrls [options]

Options:
  --api-base <url>    API base URL (default: ${options.apiBase})
  --dry-run           Preview changes without updating data (default)
  --commit            Apply updates
  --delay <ms>        Delay between write operations
  --help              Show this help message`);
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

function nk(value) {
  return (value ?? '').toString().trim();
}

function sanitizeUrl(value) {
  const trimmed = nk(value);
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  if (/^www\./i.test(trimmed)) {
    return `https://${trimmed}`;
  }
  if (/^[A-Za-z0-9.-]+\.[A-Za-z]{2,}(?:\/.*)?$/.test(trimmed)) {
    return `https://${trimmed}`;
  }
  return trimmed;
}

function extractReference(text) {
  const original = text || '';
  let working = original;
  let url = '';

  const markdownMatch = working.match(/\[[^\]]*?\]\((https?:\/\/[^\s)]+)\)/);
  if (markdownMatch) {
    url = markdownMatch[1];
    working = (working.slice(0, markdownMatch.index) + working.slice(markdownMatch.index + markdownMatch[0].length)).trim();
  }

  if (!url) {
    const directMatch = working.match(/https?:\/\/[^\s)]+/);
    if (directMatch) {
      url = directMatch[0];
      working = working.replace(directMatch[0], '').trim();
    }
  }

  working = working
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([、。，．,\.])/g, '$1')
    .replace(/[（(]\s*[）)]/g, '')
    .trim();

  return { cleaned: working, url };
}

async function migrate() {
  const data = await fetchJson('/api/listMaster?type=checkup');
  const items = Array.isArray(data?.items) ? data.items : [];
  if (!items.length) {
    console.log('No checkup master records found.');
    return;
  }

  let updated = 0;
  for (const item of items) {
    const category = nk(item.category);
    const name = nk(item.name);
    if (!category || !name) continue;

    const referenceExisting = nk(item.referenceUrl || item.reference_url);
    const sourceText = nk(item.desc) || nk(item.notes);
    if (!sourceText) {
      if (!referenceExisting) continue;
      const payload = {
        type: 'checkup',
        category,
        name,
        referenceUrl: '',
      };
      if (options.dryRun) {
        console.log(`[dry-run] clear referenceUrl: ${category} / ${name}`);
      } else {
        await postJson('/api/updateMasterItem', payload);
        if (options.delayMs) await delay(options.delayMs);
      }
      updated += 1;
      continue;
    }

    const { cleaned, url } = extractReference(sourceText);
    const sanitizedUrl = sanitizeUrl(url);
    const cleanedDesc = cleaned || '';

    const shouldUpdateUrl = sanitizedUrl !== referenceExisting;
    const shouldUpdateText = cleanedDesc !== nk(item.desc) || cleanedDesc !== nk(item.notes);

    if (!shouldUpdateUrl && !shouldUpdateText) {
      continue;
    }

    const payload = {
      type: 'checkup',
      category,
      name,
      desc: cleanedDesc,
      referenceUrl: sanitizedUrl,
      notes: cleanedDesc,
    };

    if (options.dryRun) {
      console.log(`[dry-run] update ${category} / ${name}`);
      console.log(`  desc: "${nk(item.desc)}" -> "${cleanedDesc}"`);
      console.log(`  referenceUrl: "${referenceExisting}" -> "${sanitizedUrl}"`);
    } else {
      await postJson('/api/updateMasterItem', payload);
      if (options.delayMs) await delay(options.delayMs);
    }
    updated += 1;
  }

  if (options.dryRun) {
    console.log(`Dry-run complete. ${updated} record(s) would be updated.`);
  } else {
    console.log(`Migration complete. ${updated} record(s) updated.`);
  }
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
