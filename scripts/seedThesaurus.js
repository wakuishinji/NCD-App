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
    term: '頭痛',
    variants: ['頭が痛い', '偏頭痛', 'ズキズキする頭痛'],
    context: ['symptom'],
    locale: 'ja-JP'
  },
  {
    term: '腰痛',
    variants: ['腰が痛い', 'ぎっくり腰', '腰の違和感'],
    context: ['symptom'],
    locale: 'ja-JP'
  },
  {
    term: '発熱',
    variants: ['熱が出る', '高熱', '微熱'],
    context: ['symptom'],
    locale: 'ja-JP'
  },
  {
    term: '吐き気',
    variants: ['吐き気がする', '嘔気', '気持ち悪い'],
    context: ['symptom'],
    locale: 'ja-JP'
  },
  {
    term: '排尿痛',
    variants: ['おしっこが痛い', '排尿時痛', '尿がしみる'],
    context: ['symptom'],
    locale: 'ja-JP'
  },
  {
    term: '頻尿',
    variants: ['トイレが近い', '夜間頻尿', '尿が近い'],
    context: ['symptom'],
    locale: 'ja-JP'
  },
  {
    term: '生理痛',
    variants: ['月経痛', '生理がつらい', '下腹部の重さ'],
    context: ['symptom'],
    locale: 'ja-JP'
  },
  {
    term: '鼻づまり',
    variants: ['鼻閉', '鼻がつまる', '鼻が通らない'],
    context: ['symptom'],
    locale: 'ja-JP'
  },
  {
    term: '喉の痛み',
    variants: ['咽頭痛', 'のどが痛い', 'のどの違和感'],
    context: ['symptom'],
    locale: 'ja-JP'
  },
  {
    term: '耳鳴り',
    variants: ['耳鳴', '耳なりがする', 'キーンと鳴る'],
    context: ['symptom'],
    locale: 'ja-JP'
  },
  {
    term: '視力低下',
    variants: ['視力が落ちる', '目がかすむ', '視界がぼやける'],
    context: ['symptom'],
    locale: 'ja-JP'
  },
  {
    term: '発疹',
    variants: ['皮疹', '肌にブツブツ', '皮膚に発赤'],
    context: ['symptom'],
    locale: 'ja-JP'
  },
  {
    term: 'しびれ',
    variants: ['手足がしびれる', '感覚がない', 'ピリピリする'],
    context: ['symptom'],
    locale: 'ja-JP'
  },
  {
    term: 'むくみ',
    variants: ['浮腫', '足がパンパン', 'むくみが気になる'],
    context: ['symptom'],
    locale: 'ja-JP'
  },
  {
    term: '不眠',
    variants: ['眠れない', '寝つけない', '夜中に目が覚める'],
    context: ['symptom'],
    locale: 'ja-JP'
  },
  {
    term: '乳房のしこり',
    variants: ['胸のしこり', '乳房腫瘤', '胸にしこりがある'],
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
