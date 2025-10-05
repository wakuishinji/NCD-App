#!/usr/bin/env node

const BASE = 'https://ncd-app.altry.workers.dev';

const SYMPTOMS = [
  {
    category: '消化器症状',
    name: '腹痛',
    patientLabel: 'おなかの痛み',
    bodySiteRefs: ['bodySite:abdomen', 'bodySite:upper-abdomen'],
    severityTags: ['急性', '慢性'],
    icd10: ['R10'],
    synonyms: ['腹部痛', 'みぞおちの痛み'],
    defaultServices: ['master:service:消化器|胃腸内科外来'],
    defaultTests: ['master:test:消化器検査|腹部超音波検査'],
    thesaurusRefs: ['thesaurus:腹痛'],
    status: 'candidate'
  },
  {
    category: '呼吸器症状',
    name: '咳嗽',
    patientLabel: 'せき',
    bodySiteRefs: ['bodySite:thorax', 'bodySite:lung'],
    severityTags: ['急性'],
    icd10: ['R05'],
    synonyms: ['咳', '長引くせき'],
    defaultServices: ['master:service:呼吸器|呼吸器内科外来'],
    defaultTests: ['master:test:呼吸器検査|胸部X線検査'],
    thesaurusRefs: ['thesaurus:咳'],
    status: 'candidate'
  },
  {
    category: '循環器症状',
    name: '動悸',
    patientLabel: '胸がドキドキする',
    bodySiteRefs: ['bodySite:thorax'],
    severityTags: ['急性'],
    icd10: ['R00'],
    synonyms: ['胸の動悸', '心臓がバクバクする'],
    defaultServices: ['master:service:循環器|循環器内科外来'],
    defaultTests: ['master:test:循環器検査|心電図'],
    thesaurusRefs: ['thesaurus:動悸'],
    status: 'candidate'
  },
  {
    category: '内分泌・代謝症状',
    name: '倦怠感',
    patientLabel: 'だるさ',
    bodySiteRefs: ['bodySite:全身'],
    severityTags: ['慢性'],
    synonyms: ['全身倦怠感', '疲れやすい'],
    defaultServices: ['master:service:内分泌・代謝（糖尿病等）|内分泌代謝科外来'],
    defaultTests: ['master:test:内分泌・代謝検査|血液検査'],
    thesaurusRefs: ['thesaurus:倦怠感'],
    status: 'candidate'
  },
  {
    category: '神経症状',
    name: 'めまい',
    patientLabel: 'ふらつき',
    bodySiteRefs: ['bodySite:head-neck'],
    severityTags: ['急性', '慢性'],
    icd10: ['R42'],
    synonyms: ['ふらふらする', '立ちくらみ'],
    defaultServices: ['master:service:神経内科|神経内科外来', 'master:service:耳鼻咽喉科|耳鼻咽喉科外来'],
    defaultTests: ['master:test:神経内科系検査|頭部MRI検査', 'master:test:耳鼻咽喉科検査|平衡機能検査'],
    thesaurusRefs: ['thesaurus:めまい'],
    status: 'candidate'
  },
  {
    category: '循環器症状',
    name: '胸痛',
    patientLabel: '胸の痛み',
    bodySiteRefs: ['bodySite:thorax'],
    severityTags: ['急性'],
    icd10: ['R07'],
    synonyms: ['胸が締め付けられる', '胸部違和感'],
    defaultServices: ['master:service:循環器|循環器内科外来'],
    defaultTests: ['master:test:循環器検査|心電図検査', 'master:test:循環器検査|心エコー検査'],
    thesaurusRefs: ['thesaurus:胸痛'],
    status: 'candidate'
  },
  {
    category: '呼吸器症状',
    name: '呼吸困難',
    patientLabel: '息苦しさ',
    bodySiteRefs: ['bodySite:thorax', 'bodySite:lung'],
    severityTags: ['急性'],
    icd10: ['R06'],
    synonyms: ['息が吸いにくい', '息切れ'],
    defaultServices: ['master:service:呼吸器|呼吸器内科外来'],
    defaultTests: ['master:test:呼吸器検査|胸部X線検査', 'master:test:呼吸器検査|スパイロメトリー検査'],
    thesaurusRefs: ['thesaurus:呼吸困難'],
    status: 'candidate'
  },
  {
    category: '消化器症状',
    name: '下痢',
    patientLabel: 'お腹をこわす',
    bodySiteRefs: ['bodySite:abdomen', 'bodySite:lower-abdomen'],
    severityTags: ['急性', '慢性'],
    icd10: ['R19'],
    synonyms: ['便がゆるい', '水様便'],
    defaultServices: ['master:service:消化器|消化器内科外来'],
    defaultTests: ['master:test:消化器検査|便培養検査', 'master:test:消化器検査|腹部超音波検査'],
    thesaurusRefs: ['thesaurus:下痢'],
    status: 'candidate'
  },
  {
    category: '整形外科症状',
    name: '関節痛',
    patientLabel: '関節が痛い',
    bodySiteRefs: ['bodySite:upper-limb', 'bodySite:lower-limb'],
    severityTags: ['慢性'],
    icd10: ['M255'],
    synonyms: ['関節のこわばり', '関節の違和感'],
    defaultServices: ['master:service:整形外科|整形外科外来'],
    defaultTests: ['master:test:整形外科系検査|X線検査', 'master:test:整形外科系検査|血液検査'],
    thesaurusRefs: ['thesaurus:関節痛'],
    status: 'candidate'
  }
];

function trim(value) {
  return (value ?? '').trim();
}

function keyFor(entry) {
  return `${trim(entry.category)}|${trim(entry.name)}`;
}

async function listExisting() {
  const res = await fetch(`${BASE}/api/listMaster?type=symptom&includeSimilar=false`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to list symptom master: HTTP ${res.status} ${text}`);
  }
  const data = await res.json();
  const items = Array.isArray(data.items) ? data.items : [];
  return new Map(items.map(item => [keyFor(item), item]));
}

async function upsert(entry) {
  const payload = {
    type: 'symptom',
    category: entry.category,
    name: entry.name,
    status: entry.status || 'candidate',
    patientLabel: entry.patientLabel,
    bodySiteRefs: entry.bodySiteRefs,
    severityTags: entry.severityTags,
    icd10: entry.icd10,
    synonyms: entry.synonyms,
    defaultServices: entry.defaultServices,
    defaultTests: entry.defaultTests,
    thesaurusRefs: entry.thesaurusRefs
  };

  const res = await fetch(`${BASE}/api/addMasterItem`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to add symptom ${entry.name}: HTTP ${res.status} ${text}`);
  }
}

async function main() {
  console.log('Seeding symptom master entries...');
  const existing = await listExisting();
  let added = 0;

  for (const entry of SYMPTOMS) {
    const key = keyFor(entry);
    if (existing.has(key)) {
      console.log(`Skip (exists): ${entry.category} / ${entry.name}`);
      continue;
    }
    try {
      await upsert(entry);
      console.log(`Added: ${entry.category} / ${entry.name}`);
      added += 1;
    } catch (err) {
      console.error(`Failed to add ${entry.name}:`, err.message);
    }
  }

  console.log(`Done. Added ${added} entries.`);
}

main().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});
