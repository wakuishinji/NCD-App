#!/usr/bin/env node
/**
 * Export master data (items, categories, explanations) from the public Workers API.
 *
 * Usage:
 *   node scripts/exportMastersFromApi.mjs --output tmp/masters.json
 *   node scripts/exportMastersFromApi.mjs --output tmp/masters.json --base-url https://staging.example.com --types service,test
 */
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_BASE_URL = 'https://ncd-app.altry.workers.dev';
const DEFAULT_TYPES = [
  'test',
  'service',
  'qual',
  'department',
  'facility',
  'symptom',
  'bodySite',
  'society',
  'vaccination',
  'vaccinationType',
  'checkup',
  'checkupType',
];

const CATEGORY_SUPPORTED_TYPES = new Set([
  'test',
  'service',
  'qual',
  'department',
  'facility',
  'symptom',
  'bodySite',
  'vaccinationType',
  'checkupType',
]);

const EXPLANATION_SUPPORTED_TYPES = new Set([
  'service',
  'test',
]);

function usage() {
  console.log(`exportMastersFromApi

Usage:
  node scripts/exportMastersFromApi.mjs --output <path> [options]

Options:
  --output <path>        出力先 JSON ファイル（必須）
  --base-url <url>       API ベース URL (既定: ${DEFAULT_BASE_URL})
  --types t1,t2,...      エクスポートする master type のカンマ区切りリスト
  --pretty               JSON をインデント付きで保存
  --skip-explanations    /api/explanations を呼び出さず、listMaster の explanations のみ出力
  --help                 このメッセージを表示
`);
}

function parseArgs(argv) {
  const options = {
    output: null,
    baseUrl: DEFAULT_BASE_URL,
    types: DEFAULT_TYPES,
    pretty: false,
    skipExplanations: false,
    help: false,
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--output':
        options.output = argv[++i];
        break;
      case '--base-url':
        options.baseUrl = argv[++i] || DEFAULT_BASE_URL;
        break;
      case '--types':
        options.types = (argv[++i] || '')
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean);
        break;
      case '--pretty':
        options.pretty = true;
        break;
      case '--skip-explanations':
        options.skipExplanations = true;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        console.warn(`Unknown argument: ${arg}`);
        break;
    }
  }

  if (!options.types.length) {
    options.types = DEFAULT_TYPES;
  }
  return options;
}

function ensureAbsoluteUrl(base, pathFragment) {
  const normalizedBase = base.replace(/\/+$/, '');
  const normalizedPath = pathFragment.startsWith('/') ? pathFragment : `/${pathFragment}`;
  return `${normalizedBase}${normalizedPath}`;
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'exportMastersFromApi/1.0',
      Accept: 'application/json',
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HTTP ${res.status} for ${url}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

async function fetchMasterItems(baseUrl, type) {
  const url = ensureAbsoluteUrl(baseUrl, `/api/listMaster?type=${encodeURIComponent(type)}`);
  const data = await fetchJson(url);
  if (!data || !Array.isArray(data.items)) {
    throw new Error(`Unexpected master response for type=${type}`);
  }
  return data.items;
}

async function fetchCategories(baseUrl, type) {
  if (!CATEGORY_SUPPORTED_TYPES.has(type)) {
    console.log(`[export] skipping categories for type=${type} (not supported)`);
    return [];
  }
  const url = ensureAbsoluteUrl(baseUrl, `/api/listCategories?type=${encodeURIComponent(type)}`);
  try {
    const data = await fetchJson(url);
    if (data && Array.isArray(data.categories)) {
      return data.categories;
    }
    return [];
  } catch (err) {
    console.warn(`[warn] failed to load categories for type=${type}: ${err.message}`);
    return [];
  }
}

async function fetchExplanations(baseUrl, type) {
  if (!EXPLANATION_SUPPORTED_TYPES.has(type)) {
    console.log(`[export] skipping explanations for type=${type} (not supported)`);
    return [];
  }
  const url = ensureAbsoluteUrl(baseUrl, `/api/explanations?type=${encodeURIComponent(type)}`);
  try {
    const data = await fetchJson(url);
    if (data && Array.isArray(data.explanations)) {
      return data.explanations;
    }
    return [];
  } catch (err) {
    console.warn(`[warn] failed to load explanations for type=${type}: ${err.message}`);
    return [];
  }
}

async function main() {
  const options = parseArgs(process.argv);
  if (options.help || !options.output) {
    usage();
    if (!options.output) {
      process.exitCode = 1;
    }
    return;
  }

  const result = {
    exportedAt: new Date().toISOString(),
    baseUrl: options.baseUrl,
    types: options.types,
    masterItems: {},
    categories: {},
    explanations: {},
  };

  for (const type of options.types) {
    console.log(`[export] fetching master items for type=${type}`);
    result.masterItems[type] = await fetchMasterItems(options.baseUrl, type);

    console.log(`[export] fetching categories for type=${type}`);
    result.categories[type] = await fetchCategories(options.baseUrl, type);

    if (!options.skipExplanations) {
      console.log(`[export] fetching explanations for type=${type}`);
      result.explanations[type] = await fetchExplanations(options.baseUrl, type);
    }
  }

  const outPath = options.output;
  const outDir = path.dirname(outPath);
  await fs.promises.mkdir(outDir, { recursive: true });
  const json = options.pretty ? JSON.stringify(result, null, 2) : JSON.stringify(result);
  await fs.promises.writeFile(outPath, json, 'utf8');

  console.log(`[export] wrote ${outPath}`);
}

main().catch((err) => {
  console.error('[export] failed:', err);
  process.exitCode = 1;
});
