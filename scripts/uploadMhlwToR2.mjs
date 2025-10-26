#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import zlib from 'node:zlib';

const DEFAULT_JSON_PATH = path.resolve('tmp/mhlw-facilities.json');
const DEFAULT_API_BASE = 'https://ncd-app.altry.workers.dev';
const DEFAULT_OBJECT_KEY = 'mhlw/facilities.json';

function printHelp() {
  console.log(`Upload MHLW dataset to R2 and refresh metadata\n\n` +
`Usage:\n  node scripts/uploadMhlwToR2.mjs [options]\n\n` +
`Options:\n  --json <path>          Path to the generated facilities JSON (default: ${DEFAULT_JSON_PATH})\n  --object-key <key>     R2 object key (default: ${DEFAULT_OBJECT_KEY})\n  --gzip                 Compress JSON with gzip before uploading\n  --api-base <url>       Worker API base URL (default: ${DEFAULT_API_BASE})\n  --token <token>        systemRoot access token (or set SYSTEM_ROOT_TOKEN env)\n  --help                 Show this message\n`);
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return `${bytes}`;
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 'KB';
  for (const candidate of units) {
    value /= 1024;
    unit = candidate;
    if (value < 1024) break;
  }
  return `${value.toFixed(1)} ${unit}`;
}

function computeStats(jsonPath) {
  const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  if (!data || !Array.isArray(data.facilities)) {
    throw new Error('Invalid JSON structure: expected { facilities: [...] }');
  }
  const facilityCount = Number(data.count ?? data.facilities.length);
  let scheduleCount = 0;
  for (const facility of data.facilities) {
    if (Array.isArray(facility?.scheduleEntries)) {
      scheduleCount += facility.scheduleEntries.length;
    }
  }
  return { facilityCount, scheduleCount };
}

function ensureFile(pathStr) {
  if (!fs.existsSync(pathStr)) {
    throw new Error(`File not found: ${pathStr}`);
  }
}

async function refreshMeta({ apiBase, token, facilityCount, scheduleCount }) {
  if (!token) {
    console.warn('No token provided; skipping meta refresh.');
    return;
  }
  const res = await fetch(`${apiBase.replace(/\/+$/, '')}/api/admin/mhlw/refreshMeta`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ facilityCount, scheduleCount }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to refresh metadata (HTTP ${res.status}): ${text}`);
  }
  const payload = await res.json();
  console.log('Metadata refreshed:', payload.meta);
}

async function main() {
  const args = process.argv.slice(2);
  const options = {
    json: DEFAULT_JSON_PATH,
    objectKey: DEFAULT_OBJECT_KEY,
    gzip: false,
    apiBase: process.env.API_BASE || DEFAULT_API_BASE,
    token: process.env.SYSTEM_ROOT_TOKEN || '',
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      printHelp();
      return;
    }
    if (arg === '--json') {
      options.json = path.resolve(args[++i]);
    } else if (arg === '--object-key') {
      options.objectKey = args[++i];
    } else if (arg === '--gzip') {
      options.gzip = true;
    } else if (arg === '--api-base') {
      options.apiBase = args[++i];
    } else if (arg === '--token') {
      options.token = args[++i];
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  ensureFile(options.json);
  const stats = computeStats(options.json);
  console.log(`Facility count: ${stats.facilityCount}`);
  console.log(`Schedule entries: ${stats.scheduleCount}`);

  let uploadPath = options.json;
  let contentType = 'application/json';
  const extraArgs = [];

  if (options.gzip) {
    const gzipPath = `${options.json}.gz`;
    console.log(`Compressing JSON to ${gzipPath} ...`);
    const source = fs.createReadStream(options.json);
    const destination = fs.createWriteStream(gzipPath);
    const gzip = zlib.createGzip();
    await new Promise((resolve, reject) => {
      destination.on('finish', resolve);
      destination.on('error', reject);
      gzip.on('error', reject);
      source.on('error', reject);
      source.pipe(gzip).pipe(destination);
    });
    uploadPath = gzipPath;
    extraArgs.push('--content-encoding', 'gzip');
    try {
      await upload();
    } finally {
      fs.unlinkSync(gzipPath);
    }
    return;
  }

  await upload();

  async function upload() {
    const size = fs.statSync(uploadPath).size;
    console.log(`Uploading ${formatBytes(size)} to R2 key "${options.objectKey}" ...`);

    const args = [
      'wrangler',
      'r2',
      'object',
      'put',
      options.objectKey,
      '--file',
      uploadPath,
      '--content-type',
      contentType,
      ...extraArgs,
    ];

    const result = spawnSync('npx', args, { stdio: 'inherit' });
    if (result.status !== 0) {
      throw new Error(`wrangler r2 object put failed with status ${result.status}`);
    }

   await refreshMeta({
     apiBase: options.apiBase,
     token: options.token,
     facilityCount: stats.facilityCount,
     scheduleCount: stats.scheduleCount,
   });

   console.log('Upload and metadata refresh completed successfully.');
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
