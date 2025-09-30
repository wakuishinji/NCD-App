#!/usr/bin/env node

const BASE = 'https://ncd-app.altry.workers.dev';

function sanitize(str) {
  return (str || '').trim();
}

function extractFromName(name) {
  const original = sanitize(name);
  if (!original) {
    return { cleanName: '', note: '' };
  }
  const patterns = [
    /^(.*?)[(（]([^()（）]+)[)）]\s*$/,
  ];
  for (const pattern of patterns) {
    const match = original.match(pattern);
    if (match) {
      const cleanName = sanitize(match[1]);
      const note = sanitize(match[2]);
      if (cleanName) {
        return { cleanName, note };
      }
    }
  }
  return { cleanName: original, note: '' };
}

function uniquify(values) {
  return Array.from(new Set(values.filter(Boolean).map(v => sanitize(v)).filter(Boolean)));
}

function inferClassification(item, fallback = '医師') {
  const existing = sanitize(item.classification);
  if (existing) return existing;
  const category = sanitize(item.category);
  if (/看護/.test(category)) return '看護';
  if (/療法|リハビリ|技師|技術/.test(category)) return 'コメディカル';
  if (/事務|管理/.test(category)) return '事務';
  return fallback;
}

async function main() {
  console.log('Fetching current qualification master list...');
  const listRes = await fetch(`${BASE}/api/listMaster?type=qual&includeSimilar=false`);
  if (!listRes.ok) {
    throw new Error(`Failed to fetch listMaster: HTTP ${listRes.status}`);
  }
  const listData = await listRes.json();
  if (!listData?.items || !Array.isArray(listData.items)) {
    throw new Error('Unexpected listMaster response');
  }

  const items = listData.items;
  console.log(`Fetched ${items.length} qualification entries.`);

  // Build target name counts per category to avoid collisions.
  const nameCounts = new Map();
  for (const item of items) {
    const category = sanitize(item.category);
    const { cleanName } = extractFromName(item.name);
    const key = `${category}|${cleanName}`;
    nameCounts.set(key, (nameCounts.get(key) || 0) + 1);
  }

  let updated = 0;
  const skipped = [];
  const failures = [];

  for (const item of items) {
    const originalName = sanitize(item.name);
    const originalCategory = sanitize(item.category);
    if (!originalName || !originalCategory) {
      skipped.push({ item, reason: 'missing name/category' });
      continue;
    }

    const { cleanName, note } = extractFromName(originalName);
    const key = `${originalCategory}|${cleanName}`;
    const hasCollision = nameCounts.get(key) > 1 && cleanName !== originalName;
    const finalName = hasCollision ? originalName : cleanName;

    const noteCandidates = uniquify([
      item.notes,
      item.issuer,
      note
    ]);
    const finalNotes = noteCandidates.join(' / ');
    const finalDesc = finalNotes || sanitize(item.desc);
    const classification = inferClassification(item);

    const payload = {
      type: 'qual',
      category: originalCategory,
      name: originalName,
      newCategory: originalCategory,
      newName: finalName,
      status: item.status || 'candidate',
      canonical_name: sanitize(item.canonical_name),
      desc: finalDesc,
      notes: finalNotes,
      classification
    };

    try {
      const res = await fetch(`${BASE}/api/updateMasterItem`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`HTTP ${res.status} ${text}`);
      }
      updated += 1;
      process.stdout.write('.');
    } catch (error) {
      failures.push({ item: originalName, error: error.message });
      process.stdout.write('F');
    }
  }

  console.log('\nMigration complete.');
  console.log(`Updated: ${updated}`);
  if (skipped.length) {
    console.log(`Skipped: ${skipped.length}`);
  }
  if (failures.length) {
    console.log('Failures:');
    for (const failure of failures) {
      console.log(` - ${failure.item}: ${failure.error}`);
    }
    process.exitCode = 1;
  }
}

main().catch(error => {
  console.error('Migration failed:', error);
  process.exit(1);
});
