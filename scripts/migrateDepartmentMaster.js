#!/usr/bin/env node

const BASE = process.env.NCD_BASE || process.argv[2] || 'http://127.0.0.1:8787';

function trim(value) {
  return (value || '').trim();
}

async function main() {
  console.log('Fetching department master entries...');
  const res = await fetch(`${BASE}/api/listMaster?type=department&includeSimilar=false`);
  if (!res.ok) {
    throw new Error(`Failed to fetch listMaster: HTTP ${res.status}`);
  }
  const data = await res.json();
  const items = Array.isArray(data.items) ? data.items : [];
  console.log(`Found ${items.length} entries.`);

  let updated = 0;
  const failures = [];

  for (const item of items) {
    const category = trim(item.category);
    const name = trim(item.name);
    if (!category || !name) {
      continue;
    }

    const payload = {
      type: 'department',
      category,
      name,
      newCategory: category,
      newName: name,
      status: item.status || 'approved',
      canonical_name: trim(item.canonical_name),
      desc: item.desc || '',
      notes: item.notes || ''
    };

    try {
      const resp = await fetch(`${BASE}/api/updateMasterItem`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`HTTP ${resp.status} ${text}`);
      }
      updated += 1;
      process.stdout.write('.');
    } catch (error) {
      failures.push({ name, error: error.message });
      process.stdout.write('F');
    }
  }

  console.log('\nMigration complete.');
  console.log(`Updated: ${updated}`);
  if (failures.length) {
    console.log('Failures:');
    for (const failure of failures) {
      console.log(` - ${failure.name}: ${failure.error}`);
    }
    process.exitCode = 1;
  }
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
