#!/usr/bin/env node
import { execSync } from 'node:child_process';

const API_URL = process.env.NCD_API_BASE || 'https://ncd-app.altry.workers.dev';

function shellEscape(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

async function main() {
  const url = new URL('/api/listMaster', API_URL);
  url.searchParams.set('type', 'society');
  url.searchParams.set('includeSimilar', '1');
  const res = await fetch(url.toString());
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`failed to fetch master list: ${res.status} ${body}`);
  }
  const data = await res.json();
  const items = Array.isArray(data?.items) ? data.items : [];
  console.log(`[society] fetched ${items.length} items from API`);
  let writtenRecords = 0;
  let writtenPointers = 0;
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const id = item.id;
    const key = `master:society:${id}`;
    const aliases = Array.isArray(item.legacyAliases) ? Array.from(new Set(item.legacyAliases.filter(Boolean))) : [];
    const payload = { ...item };
    delete payload._key;
    delete payload._source;
    const jsonValue = JSON.stringify(payload);
    execSync(`npx wrangler kv key put --binding=SETTINGS --preview false --remote ${shellEscape(key)} ${shellEscape(jsonValue)}`, { stdio: 'inherit' });
    writtenRecords += 1;
    const pointerBase = {
      legacy: true,
      type: 'society',
      id,
      name: item.name,
      category: item.category,
      updatedAt: item.updated_at || Math.floor(Date.now() / 1000),
    };
    for (const alias of aliases) {
      const pointerKey = `legacyPointer:${alias}`;
      const pointerJson = JSON.stringify(pointerBase);
      execSync(`npx wrangler kv key put --binding=SETTINGS --preview false --remote ${shellEscape(pointerKey)} ${shellEscape(pointerJson)}`, { stdio: 'inherit' });
      writtenPointers += 1;
    }
  }
  console.log(`[society] KV updated: ${writtenRecords} records, ${writtenPointers} pointers`);
}

main().catch((err) => {
  console.error('[society] failed:', err);
  process.exit(1);
});
