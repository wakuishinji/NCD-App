#!/usr/bin/env node

const BASE = 'https://ncd-app.altry.workers.dev';

const ENTRIES = [
  {
    term: '腹痛',
    variants: ['腹部痛', 'お腹の痛み', 'みぞおちの痛み'],
    context: ['symptom'],
    locale: 'ja-JP'
  },
  {
    term: '咳',
    variants: ['せき', '咳嗽', '長引くせき'],
    context: ['symptom'],
    locale: 'ja-JP'
  },
  {
    term: '動悸',
    variants: ['胸のドキドキ', '心臓がバクバクする'],
    context: ['symptom'],
    locale: 'ja-JP'
  },
  {
    term: '内視鏡検査',
    variants: ['内視鏡', '胃カメラ'],
    context: ['test'],
    locale: 'ja-JP'
  }
];

function normalize(term) {
  return (term ?? '').normalize('NFKC').trim().toLowerCase();
}

async function fetchEntry(normalized) {
  const res = await fetch(`${BASE}/api/thesaurus?normalized=${encodeURIComponent(normalized)}`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to fetch thesaurus ${normalized}: HTTP ${res.status} ${text}`);
  }
  const data = await res.json();
  const items = Array.isArray(data.items) ? data.items : [];
  return items.length ? items[0] : null;
}

async function upsert(entry) {
  const normalized = normalize(entry.normalized || entry.term);
  if (!normalized) {
    console.warn('Skip entry without term:', entry);
    return false;
  }
  const payload = {
    term: entry.term,
    normalized,
    variants: entry.variants,
    context: entry.context,
    locale: entry.locale,
    notes: entry.notes,
    source: entry.source
  };

  const res = await fetch(`${BASE}/api/thesaurus`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to upsert thesaurus ${entry.term}: HTTP ${res.status} ${text}`);
  }
  return true;
}

async function main() {
  console.log('Seeding thesaurus entries...');
  let inserted = 0;
  for (const entry of ENTRIES) {
    const normalized = normalize(entry.normalized || entry.term);
    if (!normalized) {
      console.log('Skip invalid entry (no term)');
      continue;
    }
    try {
      const exists = await fetchEntry(normalized);
      if (exists) {
        console.log(`Updating: ${entry.term}`);
      } else {
        console.log(`Adding: ${entry.term}`);
      }
      await upsert(entry);
      inserted += 1;
    } catch (err) {
      console.error(`Failed to upsert ${entry.term}:`, err.message);
    }
  }
  console.log(`Done. Processed ${inserted} entries.`);
}

main().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});
