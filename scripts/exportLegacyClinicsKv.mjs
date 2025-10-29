#!/usr/bin/env node
/**
 * Export clinic KV records (legacy storage) to a JSON file and optionally delete them.
 *
 * Usage:
 *   node scripts/exportLegacyClinicsKv.mjs --binding SETTINGS --prefix clinic:id: --output tmp/clinic-kv-backup.json
 *
 * Optional flags:
 *   --delete             Delete exported keys after backup (dangerous; requires confirmation)
 *   --dry-run            List matching keys but do not fetch values
 *   --batch <n>          Fetch/delete in batches (default: 200)
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

function usage() {
  console.log(`Export clinic KV data

Options:
  --binding <name>       wrangler.toml で定義した KV バインディング名（必須）
  --prefix <prefix>      取得対象の KV プレフィックス（既定: clinic:id:])
  --output <file>        出力先 JSON ファイル（既定: tmp/clinic-kv-backup.json）
  --dry-run              キー一覧のみ表示し、値は取得しない
  --delete               バックアップ後に対象キーを削除（dry-run と同時指定不可）
  --batch <n>            まとめて処理するキー数（既定: 200）
  --help                 このメッセージを表示
`);
}

function parseArgs(argv) {
  const options = {
    binding: '',
    prefix: 'clinic:id:',
    output: path.resolve('tmp', 'clinic-kv-backup.json'),
    dryRun: false,
    deleteAfter: false,
    batchSize: 200,
    help: false,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--binding':
        options.binding = argv[++i] || '';
        break;
      case '--prefix':
        options.prefix = argv[++i] || '';
        break;
      case '--output':
        options.output = path.resolve(argv[++i]);
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--delete':
        options.deleteAfter = true;
        break;
      case '--batch':
        options.batchSize = Number(argv[++i]) || options.batchSize;
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

function runWrangler(args) {
  return new Promise((resolve, reject) => {
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
      resolve(stdout);
    });
  });
}

async function listKeys(binding, prefix) {
  const args = ['kv', 'key', 'list', '--binding', binding];
  if (prefix) args.push('--prefix', prefix);
  const output = await runWrangler(args);
  let parsed;
  try {
    parsed = JSON.parse(output);
  } catch (err) {
    throw new Error(`Failed to parse wrangler list output: ${err.message}`);
  }
  if (Array.isArray(parsed)) {
    return parsed.map((entry) => entry.name || entry);
  }
  if (Array.isArray(parsed?.keys)) {
    return parsed.keys.map((entry) => entry.name);
  }
  return [];
}

async function getValue(binding, key) {
  const args = ['kv', 'key', 'get', '--binding', binding, key];
  return runWrangler(args);
}

async function deleteKey(binding, key) {
  const args = ['kv', 'key', 'delete', '--binding', binding, key];
  await runWrangler(args);
}

async function main() {
  const options = parseArgs(process.argv);
  if (options.help || !options.binding) {
    usage();
    if (!options.binding) process.exitCode = 1;
    return;
  }
  if (options.dryRun && options.deleteAfter) {
    console.error('Cannot combine --dry-run and --delete.');
    process.exitCode = 1;
    return;
  }

  console.log(`[info] Listing keys from binding=${options.binding}, prefix=${options.prefix || '(none)'}`);
  const keys = await listKeys(options.binding, options.prefix);
  console.log(`[info] Found ${keys.length} keys.`);

  if (!keys.length) {
    console.log('[info] Nothing to export.');
    return;
  }

  if (options.dryRun) {
    keys.slice(0, 20).forEach((key) => console.log(`  ${key}`));
    if (keys.length > 20) console.log(`  ... (${keys.length - 20} more)`);
    return;
  }

  const records = [];
  for (let i = 0; i < keys.length; i += options.batchSize) {
    const slice = keys.slice(i, i + options.batchSize);
    const batch = await Promise.all(slice.map(async (key) => {
      try {
        const value = await getValue(options.binding, key);
        return { key, value };
      } catch (err) {
        console.warn(`[warn] Failed to fetch ${key}: ${err.message}`);
        return null;
      }
    }));
    records.push(...batch.filter(Boolean));
    console.log(`[info] Fetched ${Math.min(i + options.batchSize, keys.length)}/${keys.length}`);
  }

  await fs.promises.mkdir(path.dirname(options.output), { recursive: true });
  await fs.promises.writeFile(options.output, `${JSON.stringify(records, null, 2)}\n`, 'utf8');
  console.log(`[info] Wrote backup to ${options.output}`);

  if (!options.deleteAfter) {
    console.log('[info] Completed without deletion.');
    return;
  }

  console.log('[warn] Deleting keys from KV…');
  for (let i = 0; i < keys.length; i += options.batchSize) {
    const slice = keys.slice(i, i + options.batchSize);
    await Promise.all(slice.map(async (key) => {
      try {
        await deleteKey(options.binding, key);
      } catch (err) {
        console.warn(`[warn] Failed to delete ${key}: ${err.message}`);
      }
    }));
    console.log(`[info] Deleted ${Math.min(i + options.batchSize, keys.length)}/${keys.length}`);
  }
  console.log('[info] Deletion completed.');
}

main().catch((err) => {
  console.error(`[error] ${err.message}`);
  process.exitCode = 1;
});
