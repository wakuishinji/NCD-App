#!/usr/bin/env node
import process from 'node:process';

const DEFAULT_TYPES = ['service', 'test', 'qual', 'facility', 'department', 'symptom', 'bodySite'];

const argv = process.argv.slice(2);
const options = {
  apiBase: process.env.NCD_API_BASE || 'https://ncd-app.altry.workers.dev',
  dryRun: true,
  batchSize: 1000,
  types: DEFAULT_TYPES,
};

for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if ((arg === '--api-base' || arg === '--apiBase') && argv[i + 1]) {
    options.apiBase = argv[++i];
  } else if (arg === '--no-dry-run' || arg === '--apply') {
    options.dryRun = false;
  } else if (arg === '--dry-run') {
    options.dryRun = true;
  } else if (arg === '--batch-size' && argv[i + 1]) {
    const n = Number(argv[++i]);
    if (Number.isFinite(n) && n > 0) {
      options.batchSize = n;
    }
  } else if (arg === '--types' && argv[i + 1]) {
    const raw = argv[++i];
    options.types = raw.split(',').map(s => s.trim()).filter(Boolean);
  }
}

function joinUrl(base, path) {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${base.replace(/\/$/, '')}${normalized}`;
}

async function postJson(path, payload) {
  const res = await fetch(joinUrl(options.apiBase, path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status} ${res.statusText}: ${text}`);
  }
  return res.json();
}

(async () => {
  try {
    console.log(`Using API base: ${options.apiBase}`);
    console.log(`Dry run: ${options.dryRun}`);
    const payload = {
      types: options.types,
      dryRun: options.dryRun,
      batchSize: options.batchSize,
    };
    const response = await postJson('/api/maintenance/masterCleanup', payload);
    console.dir(response, { depth: null });
    if (options.dryRun) {
      console.log('\nNext step: rerun with --no-dry-run to apply changes.');
    }
  } catch (err) {
    console.error('Cleanup failed:', err);
    process.exitCode = 1;
  }
})();
