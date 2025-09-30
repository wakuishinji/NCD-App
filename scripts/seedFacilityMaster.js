#!/usr/bin/env node

const BASE = 'https://ncd-app.altry.workers.dev';
const SEEDS = [
  {
    category: '学会認定',
    name: '日本医療機能評価機構 認定病院',
    notes: '日本医療機能評価機構'
  },
  {
    category: '学会認定',
    name: '日本消化器病学会 認定施設',
    notes: '日本消化器病学会'
  },
  {
    category: '行政・公費',
    name: '地域医療支援病院',
    notes: '都道府県知事指定'
  },
  {
    category: '行政・公費',
    name: '災害拠点病院',
    notes: '都道府県知事指定'
  },
  {
    category: '地域・在宅',
    name: '在宅療養支援診療所',
    notes: '厚生労働省'
  },
  {
    category: '地域・在宅',
    name: '地域包括ケア病棟入院料届出',
    notes: '厚生労働省'
  }
];

function trim(value) {
  return (value || '').trim();
}

async function masterExists(category, name) {
  const res = await fetch(`${BASE}/api/listMaster?type=facility&includeSimilar=false`);
  if (!res.ok) {
    throw new Error(`Failed to fetch listMaster: HTTP ${res.status}`);
  }
  const data = await res.json();
  const items = Array.isArray(data.items) ? data.items : [];
  return items.some(item => trim(item.category) === category && trim(item.name) === name);
}

async function addSeed(seed) {
  const payload = {
    type: 'facility',
    category: seed.category,
    name: seed.name,
    notes: seed.notes,
    desc: seed.notes,
    status: 'approved',
    source: 'seed'
  };
  const res = await fetch(`${BASE}/api/addMasterItem`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status} ${text}`);
  }
}

async function main() {
  console.log('Checking existing facility master entries...');
  const existingRes = await fetch(`${BASE}/api/listMaster?type=facility&includeSimilar=false`);
  if (!existingRes.ok) {
    throw new Error(`Failed to fetch listMaster: HTTP ${existingRes.status}`);
  }
  const existingData = await existingRes.json();
  const existingItems = Array.isArray(existingData.items) ? existingData.items : [];
  const existingKeys = new Set(existingItems.map(item => `${trim(item.category)}|${trim(item.name)}`));

  let added = 0;
  for (const seed of SEEDS) {
    const key = `${seed.category}|${seed.name}`;
    if (existingKeys.has(key)) {
      console.log(`Skip (already exists): ${seed.name}`);
      continue;
    }
    try {
      await addSeed(seed);
      console.log(`Added: ${seed.name}`);
      added += 1;
    } catch (error) {
      console.error(`Failed to add ${seed.name}:`, error.message);
    }
  }

  if (!added) {
    console.log('No new facility entries were added.');
  }
}

main().catch(err => {
  console.error('Seeding failed:', err);
  process.exit(1);
});
