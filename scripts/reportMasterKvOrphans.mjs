#!/usr/bin/env node
/**
 * Generate a JSON report of legacy master entries that still live in KV.
 *
 * This script calls /api/maintenance/masterCleanup in dry-run mode with
 * includeKeys enabled, then writes the response summary to reports/master-kv-orphans.json.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const args = process.argv.slice(2);
const options = {
  apiBase: process.env.NCD_API_BASE || 'https://ncd-app.altry.workers.dev',
  types: null,
  batchSize: 1000,
  maxKeysPerType: 200,
  output: path.resolve('reports', 'master-kv-orphans.json'),
};

for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if ((arg === '--api-base' || arg === '--apiBase') && args[i + 1]) {
    options.apiBase = args[++i];
  } else if (arg === '--types' && args[i + 1]) {
    options.types = args[++i].split(',').map((v) => v.trim()).filter(Boolean);
  } else if (arg === '--batch-size' && args[i + 1]) {
    const num = Number(args[++i]);
    if (Number.isFinite(num) && num > 0) {
      options.batchSize = Math.min(Math.floor(num), 1000);
    }
  } else if (arg === '--max-keys-per-type' && args[i + 1]) {
    const num = Number(args[++i]);
    if (Number.isFinite(num) && num > 0) {
      options.maxKeysPerType = Math.min(Math.floor(num), 5000);
    }
  } else if (arg === '--output' && args[i + 1]) {
    options.output = path.resolve(args[++i]);
  } else if (arg === '--help' || arg === '-h') {
    printHelp();
    process.exit(0);
  }
}

function printHelp() {
  console.log(`reportMasterKvOrphans

Usage:
  node scripts/reportMasterKvOrphans.mjs [options]

Options:
  --api-base <url>           API base URL (default: ${options.apiBase})
  --types <csv>              Limit master types (e.g. service,test,qual)
  --batch-size <n>           KV list batch size (default: 1000, max 1000)
  --max-keys-per-type <n>    Maximum sample keys per type (default: 200)
  --output <path>            Output JSON path (default: reports/master-kv-orphans.json)
  --help                     Show this help

The script runs /api/maintenance/masterCleanup in dry-run mode with includeKeys=true
and writes the summary (including sample legacy records) to the specified output file.
`);
}

function joinUrl(base, pathname) {
  const normalizedPath = pathname.startsWith('/') ? pathname : `/${pathname}`;
  return `${base.replace(/\/$/, '')}${normalizedPath}`;
}

async function postJson(url, payload) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} ${res.statusText}: ${text}`);
  }
  return res.json();
}

(async () => {
  try {
    const payload = {
      types: options.types,
      dryRun: true,
      batchSize: options.batchSize,
      includeKeys: true,
      maxKeysPerType: options.maxKeysPerType,
    };
    console.log(`[report] calling ${options.apiBase} (batchSize=${options.batchSize}, maxKeys=${options.maxKeysPerType})`);
    const response = await postJson(joinUrl(options.apiBase, '/api/maintenance/masterCleanup'), payload);
    if (!response?.summary) {
      throw new Error('API response missing summary');
    }
    const report = {
      generatedAt: new Date().toISOString(),
      apiBase: options.apiBase,
      params: { ...payload, types: payload.types || 'ALL' },
      summary: response.summary,
    };
    await fs.mkdir(path.dirname(options.output), { recursive: true });
    await fs.writeFile(options.output, JSON.stringify(report, null, 2), 'utf8');
    console.log(`[report] wrote ${options.output}`);
    for (const typeSummary of response.summary.types || []) {
      const pending = typeSummary.legacyKeys
        - (typeSummary.migratedRecords + typeSummary.migratedPointers + typeSummary.deleted);
      console.log(`  ${typeSummary.type}: legacy=${typeSummary.legacyKeys}, pending=${pending}`);
    }
    if (response.summary.errors?.length) {
      console.warn('[report] encountered errors:\n', response.summary.errors);
    }
  } catch (err) {
    console.error('[report] failed:', err);
    process.exitCode = 1;
  }
})();
