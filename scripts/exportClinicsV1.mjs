#!/usr/bin/env node
/**
 * Export existing clinic records (schema v1) from the public API into
 * a JSON Lines file for backup / migration.
 */

import fs from 'node:fs';
import { dirname, resolve } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import process from 'node:process';

const argv = process.argv.slice(2);
const defaults = {
  apiBase: process.env.NCD_API_BASE || 'https://ncd-app.altry.workers.dev',
  outputDir: process.env.NCD_EXPORT_DIR || './tmp',
  fileName: '',
  pretty: false,
};

function showHelp() {
  console.log(`Usage: exportClinicsV1 [options]

Options:
  --api-base <url>        API base URL (default: ${defaults.apiBase})
  --output <file>         Output file path (default: tmp/clinics-v1-YYYYMMDD-HHmmss.jsonl)
  --pretty                Output pretty-printed JSON (1 clinic per file, .json)
  --help                  Show this help text
`);
}

const options = { ...defaults };

for (let i = 0; i < argv.length; i += 1) {
  const arg = argv[i];
  if (arg === '--api-base' && argv[i + 1]) {
    options.apiBase = argv[++i];
  } else if (arg === '--output' && argv[i + 1]) {
    options.fileName = argv[++i];
  } else if (arg === '--pretty') {
    options.pretty = true;
  } else if (arg === '--help' || arg === '-h') {
    showHelp();
    process.exit(0);
  } else {
    console.error(`[warn] Unknown argument: ${arg}`);
  }
}

function nowString() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
}

function normalizeApiBase(url) {
  return url.replace(/\/+$/, '');
}

async function requestJson(path) {
  const base = normalizeApiBase(options.apiBase);
  const res = await fetch(`${base}${path.startsWith('/') ? path : `/${path}`}`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status} ${res.statusText}: ${text}`);
  }
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    throw new Error(`Unexpected content-type: ${contentType}`);
  }
  return res.json();
}

async function exportClinics() {
  console.log(`[info] API base: ${options.apiBase}`);
  console.log('[info] Fetching clinics…');
  const data = await requestJson('/api/listClinics');
  const clinics = Array.isArray(data?.clinics) ? data.clinics : [];
  console.log(`[info] Retrieved ${clinics.length} clinics.`);

  const ts = nowString();
  const targetPath = options.fileName
    ? resolve(options.fileName)
    : resolve(options.outputDir, options.pretty ? `clinics-v1-${ts}.json` : `clinics-v1-${ts}.jsonl`);

  await mkdir(dirname(targetPath), { recursive: true });

  if (options.pretty) {
    const contents = JSON.stringify(clinics, null, 2);
    await writeFile(targetPath, `${contents}\n`, 'utf8');
    console.log(`[info] Wrote pretty JSON to ${targetPath}`);
    return;
  }

  // JSON Lines output for streaming-friendly processing.
  const stream = fs.createWriteStream(targetPath, { encoding: 'utf8' });
  await new Promise((resolveStream, rejectStream) => {
    stream.on('error', rejectStream);
    stream.on('finish', resolveStream);
    for (const clinic of clinics) {
      stream.write(`${JSON.stringify(clinic)}\n`);
    }
    stream.end();
  });
  console.log(`[info] Wrote JSON Lines to ${targetPath}`);
}

exportClinics().catch((err) => {
  console.error(`[error] ${err.message}`);
  process.exitCode = 1;
});
