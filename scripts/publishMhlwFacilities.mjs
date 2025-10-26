#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const DEFAULT_JSON_PATH = path.resolve('tmp/mhlw-facilities.json');
const DEFAULT_API_BASE = 'https://ncd-app.altry.workers.dev';
const DEFAULT_CONTENT_TYPE = 'application/json';
const DEFAULT_CACHE_CONTROL = 'public, max-age=600, stale-while-revalidate=3600';

function printHelp() {
  console.log(`Usage: node scripts/publishMhlwFacilities.mjs [options]

Options:
  --json <path>         Path to facilities JSON (default: ${DEFAULT_JSON_PATH})
  --api-base <url>      API base URL (default: ${DEFAULT_API_BASE})
  --token <token>       Bearer token (systemRoot access token) [required]
  --content-type <type> Content-Type header (default: ${DEFAULT_CONTENT_TYPE})
  --cache-control <cc>  Cache-Control header (default: ${DEFAULT_CACHE_CONTROL})
  --help                Show this help message

Environment variables:
  API_BASE              Overrides --api-base
  SYSTEM_ROOT_TOKEN     Access token if --token is omitted
`);
}

function parseArgs(argv) {
  const args = {
    json: DEFAULT_JSON_PATH,
    apiBase: process.env.API_BASE || DEFAULT_API_BASE,
    token: process.env.SYSTEM_ROOT_TOKEN || '',
    contentType: DEFAULT_CONTENT_TYPE,
    cacheControl: DEFAULT_CACHE_CONTROL,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
      break;
    }
    if (arg === '--json') {
      args.json = argv[++i];
    } else if (arg === '--api-base') {
      args.apiBase = argv[++i];
    } else if (arg === '--token') {
      args.token = argv[++i];
    } else if (arg === '--content-type') {
      args.contentType = argv[++i];
    } else if (arg === '--cache-control') {
      args.cacheControl = argv[++i];
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    process.exit(0);
  }

  if (!args.json) {
    throw new Error('JSON path is required.');
  }
  const jsonPath = path.resolve(args.json);
  if (!fs.existsSync(jsonPath)) {
    throw new Error(`JSON file not found: ${jsonPath}`);
  }

  const token = (args.token || '').trim();
  if (!token) {
    throw new Error('System root access token is required. Provide via --token or SYSTEM_ROOT_TOKEN env.');
  }

  const apiBase = (args.apiBase || DEFAULT_API_BASE).replace(/\/+$/, '');
  const stats = fs.statSync(jsonPath);
  const stream = fs.createReadStream(jsonPath);

  const headers = {
    'Content-Type': args.contentType || DEFAULT_CONTENT_TYPE,
    'Cache-Control': args.cacheControl || DEFAULT_CACHE_CONTROL,
    'Content-Length': String(stats.size),
    Authorization: `Bearer ${token}`,
  };

  const response = await fetch(`${apiBase}/api/admin/mhlw/facilities`, {
    method: 'PUT',
    headers,
    body: stream,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Upload failed (${response.status}): ${text}`);
  }

  const resultText = await response.text();
  let result;
  try {
    result = resultText ? JSON.parse(resultText) : {};
  } catch (err) {
    result = { raw: resultText };
  }

  console.log('Upload completed.');
  if (result?.meta) {
    console.log(`Updated at: ${result.meta.updatedAt}`);
    if (result.meta.size != null) {
      console.log(`Size: ${result.meta.size} bytes`);
    }
    if (result.meta.etag) {
      console.log(`ETag: ${result.meta.etag}`);
    }
  } else {
    console.log(result);
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
