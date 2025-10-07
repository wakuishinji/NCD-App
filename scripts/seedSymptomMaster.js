#!/usr/bin/env node

const BASE = process.env.NCD_BASE || process.argv[2] || 'http://127.0.0.1:8787';

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
  },
  {
    category: '神経症状',
    name: '頭痛',
    patientLabel: '頭が痛い',
    bodySiteRefs: ['bodySite:head'],
    severityTags: ['急性', '慢性'],
    icd10: ['R51'],
    synonyms: ['偏頭痛', '頭がズキズキする'],
    defaultServices: ['master:service:神経内科|神経内科外来'],
    defaultTests: ['master:test:神経内科系検査|頭部CT検査', 'master:test:神経内科系検査|頭部MRI検査'],
    thesaurusRefs: ['thesaurus:頭痛'],
    status: 'candidate'
  },
  {
    category: '整形外科症状',
    name: '腰痛',
    patientLabel: '腰が痛い',
    bodySiteRefs: ['bodySite:lower-back'],
    severityTags: ['急性', '慢性'],
    icd10: ['M54.5'],
    synonyms: ['ぎっくり腰', '腰の違和感'],
    defaultServices: ['master:service:整形外科|整形外科外来'],
    defaultTests: ['master:test:整形外科系検査|腰椎X線検査', 'master:test:整形外科系検査|腰部MRI検査'],
    thesaurusRefs: ['thesaurus:腰痛'],
    status: 'candidate'
  },
  {
    category: '全身症状',
    name: '発熱',
    patientLabel: '熱が出る',
    bodySiteRefs: ['bodySite:whole-body'],
    severityTags: ['急性'],
    icd10: ['R50.9'],
    synonyms: ['高熱', '微熱が続く'],
    defaultServices: ['master:service:総合診療|総合診療外来'],
    defaultTests: ['master:test:内分泌・代謝検査|血液検査', 'master:test:呼吸器検査|胸部X線検査'],
    thesaurusRefs: ['thesaurus:発熱'],
    status: 'candidate'
  },
  {
    category: '消化器症状',
    name: '吐き気・嘔吐',
    patientLabel: '吐き気がする',
    bodySiteRefs: ['bodySite:stomach', 'bodySite:upper-abdomen'],
    severityTags: ['急性'],
    icd10: ['R11'],
    synonyms: ['嘔気', 'はきけ'],
    defaultServices: ['master:service:消化器|胃腸内科外来'],
    defaultTests: ['master:test:消化器検査|胃内視鏡検査', 'master:test:消化器検査|腹部超音波検査'],
    thesaurusRefs: ['thesaurus:吐き気'],
    status: 'candidate'
  },
  {
    category: '泌尿器症状',
    name: '排尿痛',
    patientLabel: 'おしっこが痛い',
    bodySiteRefs: ['bodySite:bladder'],
    severityTags: ['急性'],
    icd10: ['R30.0'],
    synonyms: ['排尿時痛', '尿がしみる'],
    defaultServices: ['master:service:泌尿器科|泌尿器科外来'],
    defaultTests: ['master:test:泌尿器科検査|尿検査', 'master:test:泌尿器科検査|尿培養検査'],
    thesaurusRefs: ['thesaurus:排尿痛'],
    status: 'candidate'
  },
  {
    category: '泌尿器症状',
    name: '頻尿',
    patientLabel: 'トイレが近い',
    bodySiteRefs: ['bodySite:bladder'],
    severityTags: ['急性', '慢性'],
    icd10: ['R35'],
    synonyms: ['夜間頻尿', '尿意が我慢できない'],
    defaultServices: ['master:service:泌尿器科|泌尿器科外来'],
    defaultTests: ['master:test:泌尿器科検査|尿検査', 'master:test:泌尿器科検査|残尿量測定'],
    thesaurusRefs: ['thesaurus:頻尿'],
    status: 'candidate'
  },
  {
    category: '婦人科症状',
    name: '月経痛',
    patientLabel: '生理痛がつらい',
    bodySiteRefs: ['bodySite:uterus'],
    severityTags: ['急性', '慢性'],
    icd10: ['N94.4'],
    synonyms: ['生理痛', '下腹部の重さ'],
    defaultServices: ['master:service:産婦人科|婦人科外来'],
    defaultTests: ['master:test:産婦人科検査|骨盤超音波検査'],
    thesaurusRefs: ['thesaurus:生理痛'],
    status: 'candidate'
  },
  {
    category: '耳鼻咽喉科症状',
    name: '鼻閉',
    patientLabel: '鼻がつまる',
    bodySiteRefs: ['bodySite:nasal-cavity'],
    severityTags: ['急性', '慢性'],
    icd10: ['R09.81'],
    synonyms: ['鼻づまり', '鼻が通らない'],
    defaultServices: ['master:service:耳鼻咽喉科|耳鼻咽喉科外来'],
    defaultTests: ['master:test:耳鼻咽喉科検査|鼻咽頭内視鏡検査'],
    thesaurusRefs: ['thesaurus:鼻づまり'],
    status: 'candidate'
  },
  {
    category: '耳鼻咽喉科症状',
    name: '喉の痛み',
    patientLabel: 'のどが痛い',
    bodySiteRefs: ['bodySite:pharynx'],
    severityTags: ['急性'],
    icd10: ['R07.0'],
    synonyms: ['咽頭痛', 'のどの違和感'],
    defaultServices: ['master:service:耳鼻咽喉科|耳鼻咽喉科外来'],
    defaultTests: ['master:test:耳鼻咽喉科検査|咽頭培養検査'],
    thesaurusRefs: ['thesaurus:喉の痛み'],
    status: 'candidate'
  },
  {
    category: '耳鼻咽喉科症状',
    name: '耳鳴',
    patientLabel: '耳なりがする',
    bodySiteRefs: ['bodySite:ear'],
    severityTags: ['慢性'],
    icd10: ['H93.1'],
    synonyms: ['耳鳴り', 'キーンと鳴る'],
    defaultServices: ['master:service:耳鼻咽喉科|耳鼻咽喉科外来'],
    defaultTests: ['master:test:耳鼻咽喉科検査|聴力検査'],
    thesaurusRefs: ['thesaurus:耳鳴り'],
    status: 'candidate'
  },
  {
    category: '眼科症状',
    name: '視力低下',
    patientLabel: '視力が落ちる',
    bodySiteRefs: ['bodySite:eye'],
    severityTags: ['慢性'],
    icd10: ['H54.7'],
    synonyms: ['目がかすむ', '視界がぼやける'],
    defaultServices: ['master:service:眼科|眼科外来'],
    defaultTests: ['master:test:眼科検査|視力検査', 'master:test:眼科検査|眼底検査'],
    thesaurusRefs: ['thesaurus:視力低下'],
    status: 'candidate'
  },
  {
    category: '皮膚症状',
    name: '皮疹',
    patientLabel: '肌にブツブツが出る',
    bodySiteRefs: ['bodySite:skin'],
    severityTags: ['急性'],
    icd10: ['R21'],
    synonyms: ['発疹', '皮膚に発赤'],
    defaultServices: ['master:service:皮膚科|皮膚科外来'],
    defaultTests: ['master:test:皮膚科検査|皮膚生検'],
    thesaurusRefs: ['thesaurus:発疹'],
    status: 'candidate'
  },
  {
    category: '神経症状',
    name: 'しびれ',
    patientLabel: '手足がしびれる',
    bodySiteRefs: ['bodySite:upper-limb', 'bodySite:lower-limb'],
    severityTags: ['急性', '慢性'],
    icd10: ['R20.2'],
    synonyms: ['感覚がない', 'ピリピリする'],
    defaultServices: ['master:service:神経内科|神経内科外来'],
    defaultTests: ['master:test:神経内科系検査|神経伝導検査'],
    thesaurusRefs: ['thesaurus:しびれ'],
    status: 'candidate'
  },
  {
    category: '循環器症状',
    name: '浮腫',
    patientLabel: 'むくみが気になる',
    bodySiteRefs: ['bodySite:lower-limb'],
    severityTags: ['慢性'],
    icd10: ['R60.0'],
    synonyms: ['むくみ', '足がパンパン'],
    defaultServices: ['master:service:循環器|循環器内科外来'],
    defaultTests: ['master:test:循環器検査|心エコー検査', 'master:test:内分泌・代謝検査|血液検査'],
    thesaurusRefs: ['thesaurus:むくみ'],
    status: 'candidate'
  },
  {
    category: '精神科症状',
    name: '不眠',
    patientLabel: '眠れない',
    bodySiteRefs: ['bodySite:whole-body'],
    severityTags: ['慢性'],
    icd10: ['G47.0'],
    synonyms: ['寝つけない', '夜中に目が覚める'],
    defaultServices: ['master:service:精神科|精神科外来'],
    defaultTests: [],
    thesaurusRefs: ['thesaurus:不眠'],
    status: 'candidate'
  },
  {
    category: '乳腺症状',
    name: '乳房のしこり',
    patientLabel: '胸にしこりがある',
    bodySiteRefs: ['bodySite:breast'],
    severityTags: ['慢性'],
    icd10: ['N63'],
    synonyms: ['乳房腫瘤', '胸のしこり'],
    defaultServices: ['master:service:乳腺外科|乳腺外科外来'],
    defaultTests: ['master:test:乳腺検査|乳腺超音波検査', 'master:test:乳腺検査|マンモグラフィ'],
    thesaurusRefs: ['thesaurus:乳房のしこり'],
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
