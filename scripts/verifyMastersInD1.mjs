#!/usr/bin/env node
/**
 * Compare a master dataset (JSON) against the counts stored in Cloudflare D1.
 *
 * Usage:
 *   node scripts/verifyMastersInD1.mjs --dataset tmp/masters-export.json --db MASTERS_D1
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

function usage() {
  console.log(`verifyMastersInD1

Usage:
  node scripts/verifyMastersInD1.mjs --dataset <path> --db <binding> [options]

Options:
  --dataset <path>        エクスポート済みマスター JSON（必須）
  --db <binding>          wrangler.toml に定義した D1 バインド名（必須）
  --organization <id>     テナント ID（NULL=共通を比較、既定: null）
  --types t1,t2,...       対象 master type を絞り込み
  --help                  このメッセージを表示
`);
}

function parseArgs(argv) {
  const options = {
    dataset: null,
    db: null,
    organizationId: null,
    types: null,
    help: false,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--dataset':
        options.dataset = argv[++i];
        break;
      case '--db':
        options.db = argv[++i];
        break;
      case '--organization':
        options.organizationId = argv[++i] ?? null;
        break;
      case '--types':
        options.types = (argv[++i] || '')
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean);
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
  return options;
}

function loadDataset(filePath, selectedTypes) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed = JSON.parse(raw);
  const masterItems = parsed.masterItems || parsed.masters || parsed.items || {};
  const categories = parsed.categories || {};
  const discoveredTypes = Array.from(
    new Set([
      ...Object.keys(masterItems || {}),
      ...Object.keys(categories || {}),
    ]),
  ).filter(Boolean);
  const types = selectedTypes || discoveredTypes;

  const itemCounts = new Map();
  const categoryCounts = new Map();

  for (const type of types) {
    const items = masterItems[type];
    if (Array.isArray(items)) {
      itemCounts.set(type, items.length);
    }
    const list = categories[type];
    if (Array.isArray(list)) {
      categoryCounts.set(type, list.length);
    } else if (list && Array.isArray(list.items)) {
      categoryCounts.set(type, list.items.length);
    }
  }

  return { itemCounts, categoryCounts, types };
}

function runWrangler(db, sql, { json = true } = {}) {
  return new Promise((resolve, reject) => {
    const args = ['d1', 'execute', '--remote', db, '--command', sql];
    if (json) args.push('--json');
    const proc = spawn('wrangler', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    proc.on('exit', (code) => {
      if (code !== 0) {
        reject(new Error(stderr || `wrangler exited with code ${code}`));
        return;
      }
      if (!json) {
        resolve(stdout);
        return;
      }
      try {
        const parsed = JSON.parse(stdout);
        let rows = parsed;
        if (Array.isArray(parsed)) {
          if (parsed.length && Array.isArray(parsed[0]?.results)) {
            rows = parsed[0].results;
          }
        } else if (parsed?.result?.rows) {
          rows = parsed.result.rows;
        } else if (Array.isArray(parsed?.results)) {
          rows = parsed.results;
        }
        resolve(rows ?? []);
      } catch (err) {
        reject(new Error(`failed to parse wrangler JSON output: ${err.message}\n${stdout}`));
      }
    });
  });
}

function mapRows(rows, keyField = 'type') {
  const map = new Map();
  if (!Array.isArray(rows)) return map;
  rows.forEach((row) => {
    if (!row) return;
    const key = row[keyField];
    if (key === undefined || key === null) return;
    map.set(String(key), Number(row.cnt ?? row.count ?? row.COUNT ?? 0));
  });
  return map;
}

function diffCounts(datasetMap, d1Map) {
  const out = [];
  const keys = new Set([...datasetMap.keys(), ...d1Map.keys()]);
  for (const key of keys) {
    const expected = datasetMap.get(key) ?? 0;
    const actual = d1Map.get(key) ?? 0;
    if (expected !== actual) {
      out.push({ key, expected, actual, delta: actual - expected });
    }
  }
  return out.sort((a, b) => a.key.localeCompare(b.key, 'ja'));
}

async function main() {
  const options = parseArgs(process.argv);
  if (options.help || !options.dataset || !options.db) {
    usage();
    if (!options.dataset || !options.db) process.exitCode = 1;
    return;
  }

  const datasetPath = path.resolve(options.dataset);
  if (!fs.existsSync(datasetPath)) {
    console.error(`dataset not found: ${datasetPath}`);
    process.exitCode = 1;
    return;
  }

  const { itemCounts, categoryCounts, types } = loadDataset(datasetPath, options.types);
  console.log(`[verify] Dataset types: ${Array.from(types).join(', ')}`);

  const orgCondition = options.organizationId === null ? 'IS NULL' : `= '${options.organizationId}'`;

  const itemRows = await runWrangler(
    options.db,
    `SELECT type, COUNT(*) AS cnt FROM master_items WHERE organization_id ${orgCondition} GROUP BY type;`,
  );
  const categoryRows = await runWrangler(
    options.db,
    `SELECT type, COUNT(*) AS cnt FROM master_categories WHERE organization_id ${orgCondition} GROUP BY type;`,
  );

  const itemMap = mapRows(itemRows);
  const categoryMap = mapRows(categoryRows);

  const itemDiffs = diffCounts(itemCounts, itemMap);
  const categoryDiffs = diffCounts(categoryCounts, categoryMap);

  console.log('\n=== Master Item Counts ===');
  if (!itemDiffs.length) {
    console.log('All item counts match.');
  } else {
    itemDiffs.forEach((entry) => {
      console.log(`- ${entry.key}: dataset=${entry.expected}, d1=${entry.actual} (Δ ${entry.delta >= 0 ? '+' : ''}${entry.delta})`);
    });
  }

  console.log('\n=== Category Counts ===');
  if (!categoryDiffs.length) {
    console.log('All category counts match.');
  } else {
    categoryDiffs.forEach((entry) => {
      console.log(`- ${entry.key}: dataset=${entry.expected}, d1=${entry.actual} (Δ ${entry.delta >= 0 ? '+' : ''}${entry.delta})`);
    });
  }
}

main().catch((err) => {
  console.error('[verify] failed:', err.message);
  process.exitCode = 1;
});
