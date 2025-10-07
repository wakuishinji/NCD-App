#!/usr/bin/env node

const BASE = process.env.NCD_BASE || process.argv[2] || 'http://127.0.0.1:8787';

const BODY_SITES = [
  {
    category: '頭頸部',
    name: '頭頸部',
    canonical_name: 'head-neck',
    anatomicalSystem: '頭頸部',
    patientLabel: '頭や首',
    aliases: ['頭部', '頸部'],
    status: 'approved'
  },
  {
    category: '胸部',
    name: '胸部',
    canonical_name: 'thorax',
    anatomicalSystem: '胸部',
    patientLabel: '胸',
    aliases: ['胸郭'],
    status: 'approved'
  },
  {
    category: '腹部',
    name: '腹部',
    canonical_name: 'abdomen',
    anatomicalSystem: '腹部',
    patientLabel: 'おなか',
    aliases: ['お腹'],
    status: 'approved'
  },
  {
    category: '腹部',
    name: '上腹部',
    canonical_name: 'upper-abdomen',
    anatomicalSystem: '腹部',
    parentKey: 'bodySite:abdomen',
    patientLabel: 'みぞおち',
    aliases: ['心窩部'],
    status: 'approved'
  },
  {
    category: '腹部',
    name: '下腹部',
    canonical_name: 'lower-abdomen',
    anatomicalSystem: '腹部',
    parentKey: 'bodySite:abdomen',
    patientLabel: '下腹部',
    aliases: ['下腹部'],
    status: 'approved'
  },
  {
    category: '胸部',
    name: '肺',
    canonical_name: 'lung',
    anatomicalSystem: '呼吸器',
    parentKey: 'bodySite:thorax',
    patientLabel: '肺',
    aliases: ['両肺'],
    laterality: 'bilateral',
    status: 'candidate'
  },
  {
    category: '全身',
    name: '全身',
    canonical_name: 'whole-body',
    anatomicalSystem: '全身',
    patientLabel: '全身',
    aliases: ['全身'],
    status: 'approved'
  },
  {
    category: '全身',
    name: '体幹',
    canonical_name: 'body-trunk',
    anatomicalSystem: '筋骨格系',
    patientLabel: '体幹',
    parentKey: 'bodySite:whole-body',
    aliases: ['胴体'],
    status: 'candidate'
  },
  {
    category: '全身',
    name: '上肢',
    canonical_name: 'upper-limb',
    anatomicalSystem: '筋骨格系',
    patientLabel: '腕',
    parentKey: 'bodySite:whole-body',
    aliases: ['上肢'],
    status: 'candidate'
  },
  {
    category: '全身',
    name: '下肢',
    canonical_name: 'lower-limb',
    anatomicalSystem: '筋骨格系',
    patientLabel: '脚',
    parentKey: 'bodySite:whole-body',
    aliases: ['下肢'],
    status: 'candidate'
  },
  {
    category: '体幹',
    name: '腰部',
    canonical_name: 'lower-back',
    anatomicalSystem: '筋骨格系',
    patientLabel: '腰',
    parentKey: 'bodySite:body-trunk',
    aliases: ['腰回り', 'ローアバック'],
    status: 'candidate'
  },
  {
    category: '骨盤',
    name: '骨盤',
    canonical_name: 'pelvis',
    anatomicalSystem: '骨格',
    patientLabel: '骨盤',
    parentKey: 'bodySite:body-trunk',
    aliases: ['骨盤部'],
    status: 'candidate'
  },
  {
    category: '上肢',
    name: '肩関節',
    canonical_name: 'shoulder-joint',
    anatomicalSystem: '筋骨格系',
    patientLabel: '肩',
    parentKey: 'bodySite:upper-limb',
    aliases: ['肩甲骨周囲', '肩周り'],
    laterality: 'bilateral',
    status: 'candidate'
  },
  {
    category: '下肢',
    name: '膝関節',
    canonical_name: 'knee-joint',
    anatomicalSystem: '筋骨格系',
    patientLabel: 'ひざ',
    parentKey: 'bodySite:lower-limb',
    aliases: ['膝'],
    laterality: 'bilateral',
    status: 'candidate'
  },
  {
    category: '頭頸部',
    name: '頭部',
    canonical_name: 'head',
    anatomicalSystem: '神経系',
    patientLabel: '頭',
    parentKey: 'bodySite:head-neck',
    aliases: ['頭頂部', '頭全体'],
    status: 'candidate'
  },
  {
    category: '頭頸部',
    name: '顔面',
    canonical_name: 'face',
    anatomicalSystem: '皮膚',
    parentKey: 'bodySite:head-neck',
    patientLabel: '顔',
    aliases: ['顔周り'],
    status: 'candidate'
  },
  {
    category: '頭頸部',
    name: '眼',
    canonical_name: 'eye',
    anatomicalSystem: '視覚器',
    parentKey: 'bodySite:head',
    patientLabel: '目',
    aliases: ['眼球'],
    laterality: 'bilateral',
    status: 'candidate'
  },
  {
    category: '頭頸部',
    name: '耳',
    canonical_name: 'ear',
    anatomicalSystem: '聴覚器',
    parentKey: 'bodySite:head',
    patientLabel: '耳',
    aliases: ['耳介'],
    laterality: 'bilateral',
    status: 'candidate'
  },
  {
    category: '頭頸部',
    name: '鼻腔',
    canonical_name: 'nasal-cavity',
    anatomicalSystem: '呼吸器',
    parentKey: 'bodySite:head-neck',
    patientLabel: '鼻の中',
    aliases: ['鼻の奥', '鼻腔'],
    status: 'candidate'
  },
  {
    category: '頭頸部',
    name: '咽頭',
    canonical_name: 'pharynx',
    anatomicalSystem: '呼吸器',
    parentKey: 'bodySite:head-neck',
    patientLabel: 'のど',
    aliases: ['咽喉'],
    status: 'candidate'
  },
  {
    category: '胸部',
    name: '心臓',
    canonical_name: 'heart',
    anatomicalSystem: '循環器',
    parentKey: 'bodySite:thorax',
    patientLabel: '心臓',
    aliases: ['心'],
    status: 'candidate'
  },
  {
    category: '胸部',
    name: '乳房',
    canonical_name: 'breast',
    anatomicalSystem: '乳腺',
    parentKey: 'bodySite:thorax',
    patientLabel: '乳房',
    aliases: ['乳腺'],
    laterality: 'bilateral',
    status: 'candidate'
  },
  {
    category: '腹部',
    name: '胃',
    canonical_name: 'stomach',
    anatomicalSystem: '消化器',
    parentKey: 'bodySite:upper-abdomen',
    patientLabel: '胃',
    aliases: ['胃袋'],
    status: 'candidate'
  },
  {
    category: '腹部',
    name: '肝臓',
    canonical_name: 'liver',
    anatomicalSystem: '消化器',
    parentKey: 'bodySite:upper-abdomen',
    patientLabel: '肝臓',
    aliases: ['肝'],
    status: 'candidate'
  },
  {
    category: '泌尿器',
    name: '泌尿器系',
    canonical_name: 'urinary-system',
    anatomicalSystem: '泌尿器',
    patientLabel: '泌尿器',
    aliases: ['尿路系'],
    status: 'candidate'
  },
  {
    category: '泌尿器',
    name: '腎臓',
    canonical_name: 'kidney',
    anatomicalSystem: '泌尿器',
    parentKey: 'bodySite:urinary-system',
    patientLabel: 'じんぞう',
    aliases: ['腎'],
    laterality: 'bilateral',
    status: 'candidate'
  },
  {
    category: '泌尿器',
    name: '膀胱',
    canonical_name: 'bladder',
    anatomicalSystem: '泌尿器',
    parentKey: 'bodySite:urinary-system',
    patientLabel: 'ぼうこう',
    aliases: ['膀胱'],
    status: 'candidate'
  },
  {
    category: '骨盤',
    name: '子宮',
    canonical_name: 'uterus',
    anatomicalSystem: '女性生殖器',
    parentKey: 'bodySite:pelvis',
    patientLabel: '子宮',
    aliases: ['しきゅう'],
    status: 'candidate'
  },
  {
    category: '皮膚',
    name: '皮膚',
    canonical_name: 'skin',
    anatomicalSystem: '皮膚',
    parentKey: 'bodySite:whole-body',
    patientLabel: '肌',
    aliases: ['皮ふ'],
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
  const res = await fetch(`${BASE}/api/listMaster?type=bodySite&includeSimilar=false`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to list bodySite master: HTTP ${res.status} ${text}`);
  }
  const data = await res.json();
  const items = Array.isArray(data.items) ? data.items : [];
  return new Map(items.map(item => [keyFor(item), item]));
}

async function upsert(entry) {
  const payload = {
    type: 'bodySite',
    category: entry.category,
    name: entry.name,
    status: entry.status || 'candidate',
    canonical_name: entry.canonical_name,
    anatomicalSystem: entry.anatomicalSystem,
    parentKey: entry.parentKey,
    patientLabel: entry.patientLabel,
    aliases: entry.aliases,
    laterality: entry.laterality,
    thesaurusRefs: entry.thesaurusRefs
  };

  const res = await fetch(`${BASE}/api/addMasterItem`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to add bodySite ${entry.name}: HTTP ${res.status} ${text}`);
  }
}

async function main() {
  console.log('Seeding bodySite master entries...');
  const existing = await listExisting();
  let added = 0;

  for (const entry of BODY_SITES) {
    const key = keyFor(entry);
    if (existing.has(key)) {
      console.log(`Skip (already exists): ${entry.category} / ${entry.name}`);
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

  if (!added) {
    console.log('No new bodySite entries were added.');
  }
}

main().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});
