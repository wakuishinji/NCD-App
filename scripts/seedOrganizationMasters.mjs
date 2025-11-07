#!/usr/bin/env node
/**
 * Seed organization-specific master data (departments / committees / groups / positions)
 * by calling the public /api/addMasterItem endpoint.
 *
 * Usage:
 *   npm run seed:org-masters -- --apply --base https://ncd-app.altry.workers.dev
 *
 * Flags:
 *   --apply        Actually send write requests (otherwise dry-run)
 *   --base <url>   Override API base (default: https://ncd-app.altry.workers.dev)
 *   --token <jwt>  Optional bearer token for authenticated environments
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_API_BASE = 'https://ncd-app.altry.workers.dev';

const argv = process.argv.slice(2);
let apiBase = (process.env.API_BASE || DEFAULT_API_BASE).replace(/\/$/, '');
let token = process.env.AUTH_TOKEN || '';
let apply = false;

for (let i = 0; i < argv.length; i += 1) {
  const arg = argv[i];
  if (arg === '--apply') {
    apply = true;
    continue;
  }
  if (arg === '--base' && argv[i + 1]) {
    apiBase = argv[i + 1].replace(/\/$/, '');
    i += 1;
    continue;
  }
  if (arg === '--token' && argv[i + 1]) {
    token = argv[i + 1];
    i += 1;
    continue;
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const datasetPath = path.resolve(__dirname, '../data/organization-masters.json');

const SECTION_CONFIG = {
  departments: { type: 'department', label: '部署' },
  committees: { type: 'committee', label: '委員会' },
  groups: { type: 'group', label: 'グループ' },
  positions: { type: 'position', label: '役職' },
};

async function loadDataset() {
  const raw = await fs.readFile(datasetPath, 'utf8');
  return JSON.parse(raw);
}

async function addMasterItem(payload) {
  if (!apply) {
    console.log('[dry-run]', payload.type, payload.category, payload.name);
    return { ok: true, dryRun: true };
  }
  const res = await fetch(`${apiBase}/api/addMasterItem`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to add ${payload.type}/${payload.category}/${payload.name}: HTTP ${res.status} ${text}`);
  }
  return res.json().catch(() => ({ ok: true }));
}

async function run() {
  const dataset = await loadDataset();
  const tasks = [];
  for (const [orgType, sections] of Object.entries(dataset)) {
    for (const [sectionName, names] of Object.entries(sections)) {
      const config = SECTION_CONFIG[sectionName];
      if (!config) continue;
      const uniqueNames = Array.from(new Set(names));
      uniqueNames.forEach((name) => {
        const trimmed = (name || '').trim();
        if (!trimmed) return;
        tasks.push({
          type: config.type,
          category: `${orgType}:${sectionName}`,
          name: trimmed,
          status: 'approved',
          source: 'orgTemplate',
          desc: `${orgType} 向け${config.label}テンプレート`,
        });
      });
    }
  }

  console.log(`Seeding ${tasks.length} master items to ${apiBase} (${apply ? 'apply' : 'dry-run'})`);
  let success = 0;
  for (const task of tasks) {
    try {
      await addMasterItem(task);
      success += 1;
    } catch (err) {
      console.error('Failed to seed item:', task.type, task.category, task.name);
      throw err;
    }
  }
  console.log(`Completed seeding. success=${success}, mode=${apply ? 'apply' : 'dry-run'}`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
