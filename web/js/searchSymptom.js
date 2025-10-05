(function(){
  const DEFAULT_API_BASE = 'https://ncd-app.altry.workers.dev';
  const API_BASE = (() => {
    try {
      return localStorage.getItem('ncdApiBase') || localStorage.getItem('ncdApiBaseUrl') || DEFAULT_API_BASE;
    } catch (_) {
      return DEFAULT_API_BASE;
    }
  })();

  const els = {};
  const state = {
    symptoms: [],
    filteredSymptoms: [],
    categories: [],
    selected: null,
    result: null,
    bodySiteMap: new Map()
  };

  function nk(value) {
    return (value || '').trim();
  }

  function sanitizeSegment(value) {
    if (!value) return '';
    return value.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, '');
  }

  function normalizeBodySiteRef(ref) {
    if (!ref) return null;
    let raw = ref.trim();
    if (!raw) return null;
    const lower = raw.toLowerCase();
    if (lower.startsWith('bodysite:')) {
      raw = raw.substring('bodysite:'.length);
    }
    const normalized = sanitizeSegment(raw);
    if (!normalized) return null;
    return `bodysite:${normalized}`;
  }

  function bodySiteRefCandidates(item) {
    const refs = new Set();
    if (!item || typeof item !== 'object') return refs;
    const values = [item.canonical_name, item.name, item.category];
    for (const value of values) {
      const normalized = normalizeBodySiteRef(value);
      if (normalized) refs.add(normalized);
    }
    return refs;
  }

  function parseMasterKey(raw) {
    if (!raw) return null;
    let key = raw.trim();
    if (!key) return null;
    if (key.startsWith('master:')) {
      key = key.substring(7);
    }
    const typeSep = key.indexOf(':');
    if (typeSep === -1) return null;
    const type = key.substring(0, typeSep);
    const rest = key.substring(typeSep + 1);
    const nameSep = rest.indexOf('|');
    if (nameSep === -1) return null;
    const category = rest.substring(0, nameSep);
    const name = rest.substring(nameSep + 1);
    return { type, category, name };
  }

  async function fetchJson(path) {
    const res = await fetch(`${API_BASE}${path}`);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status} ${text}`);
    }
    return res.json();
  }

  function populateCategoryFilter() {
    els.categoryFilter.innerHTML = '';
    const optionAll = document.createElement('option');
    optionAll.value = '';
    optionAll.textContent = 'すべて';
    els.categoryFilter.appendChild(optionAll);

    state.categories.forEach(category => {
      const option = document.createElement('option');
      option.value = category;
      option.textContent = category;
      els.categoryFilter.appendChild(option);
    });
  }

  function groupSymptoms(symptoms) {
    const groups = new Map();
    symptoms.forEach(symptom => {
      const category = symptom.category || '分類未設定';
      if (!groups.has(category)) groups.set(category, []);
      groups.get(category).push(symptom);
    });
    for (const [, list] of groups) {
      list.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ja'));
    }
    return groups;
  }

  function renderSymptomList() {
    els.symptomList.innerHTML = '';
    if (!state.filteredSymptoms.length) {
      const empty = document.createElement('div');
      empty.className = 'p-4 text-sm text-slate-500';
      empty.textContent = '該当する症状がありません。キーワードや分類を調整してください。';
      els.symptomList.appendChild(empty);
      return;
    }

    const groups = groupSymptoms(state.filteredSymptoms);
    for (const [category, items] of groups) {
      const section = document.createElement('div');
      section.className = 'py-2';
      const heading = document.createElement('div');
      heading.className = 'px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 bg-slate-100';
      heading.textContent = category;
      section.appendChild(heading);

      items.forEach(item => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'w-full text-left px-4 py-3 text-sm transition flex flex-col gap-1';
        const isSelected = state.selected && (state.selected._key ? state.selected._key === item._key : state.selected === item);
        if (isSelected) {
          button.classList.add('bg-blue-50', 'font-semibold');
        } else {
          button.classList.add('hover:bg-blue-50');
        }

        const title = document.createElement('div');
        title.className = 'text-slate-800';
        title.textContent = item.name || '名称未設定';
        button.appendChild(title);

        if (item.patientLabel) {
          const subtitle = document.createElement('div');
          subtitle.className = 'text-xs text-slate-500';
          subtitle.textContent = item.patientLabel;
          button.appendChild(subtitle);
        }

        button.addEventListener('click', () => {
          state.selected = item;
          state.result = null;
          renderSymptomList();
          renderSymptomDetail();
          hideResults();
        });

        section.appendChild(button);
      });

      els.symptomList.appendChild(section);
    }
  }

  function applyFilters() {
    const keyword = nk(els.searchInput.value).toLowerCase();
    const category = els.categoryFilter.value;
    state.filteredSymptoms = state.symptoms.filter(symptom => {
      if (category && symptom.category !== category) return false;
      if (!keyword) return true;
      const haystack = [symptom.name, symptom.patientLabel]
        .concat(Array.isArray(symptom.synonyms) ? symptom.synonyms : [])
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(keyword);
    });
    renderSymptomList();
  }

  function createInfoCard(label) {
    const card = document.createElement('div');
    card.className = 'rounded border border-slate-200 bg-white/80 px-4 py-3 shadow-sm';
    const title = document.createElement('div');
    title.className = 'text-xs font-semibold text-slate-500';
    title.textContent = label;
    const body = document.createElement('div');
    body.className = 'mt-1 text-sm text-slate-700 flex flex-wrap gap-2';
    card.append(title, body);
    return { card, body };
  }

  function renderChipList(container, values, emptyText) {
    container.innerHTML = '';
    if (!values || !values.length) {
      const span = document.createElement('span');
      span.className = 'text-xs text-slate-400';
      span.textContent = emptyText;
      container.appendChild(span);
      return;
    }
    values.forEach(value => {
      const badge = document.createElement('span');
      badge.className = 'inline-flex items-center rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 border border-blue-200';
      badge.textContent = value;
      container.appendChild(badge);
    });
  }

  function resolveBodySites(symptom) {
    if (state.result && state.result.symptom && Array.isArray(state.result.symptom.bodySites)) {
      return state.result.symptom.bodySites;
    }
    const refs = Array.isArray(symptom.bodySiteRefs) ? symptom.bodySiteRefs : [];
    return refs.map(ref => {
      const normalized = normalizeBodySiteRef(ref);
      const info = normalized ? state.bodySiteMap.get(normalized) : null;
      return {
        ref,
        normalized,
        name: info?.name || null,
        patientLabel: info?.patientLabel || null,
        category: info?.category || null,
        canonical: info?.canonical_name || null,
        laterality: info?.laterality || null
      };
    });
  }

  function parseRecommendation(keys, expectedType) {
    if (!Array.isArray(keys)) return [];
    const items = [];
    keys.forEach(raw => {
      const parsed = parseMasterKey(raw);
      if (parsed && parsed.type === expectedType) {
        items.push({ key: raw, category: parsed.category, name: parsed.name });
      }
    });
    return items;
  }

  function renderRecommendationList(container, list, emptyText) {
    container.innerHTML = '';
    if (!list.length) {
      const li = document.createElement('li');
      li.className = 'text-xs text-slate-400';
      li.textContent = emptyText;
      container.appendChild(li);
      return;
    }
    list.forEach(item => {
      const li = document.createElement('li');
      li.className = 'rounded border border-slate-200 bg-white/70 px-3 py-2 text-sm';
      li.textContent = `${item.category || '分類未設定'} / ${item.name || ''}`;
      container.appendChild(li);
    });
  }

  function renderBodySiteList(container, sites) {
    container.innerHTML = '';
    if (!sites.length) {
      const li = document.createElement('li');
      li.className = 'text-xs text-slate-400';
      li.textContent = '関連部位は設定されていません';
      container.appendChild(li);
      return;
    }
    sites.forEach(site => {
      const li = document.createElement('li');
      li.className = 'rounded border border-slate-200 bg-white/70 px-3 py-2 text-sm';
      const name = site.name || site.ref || '（名称未登録）';
      const subtitle = site.patientLabel ? `（${site.patientLabel}）` : '';
      const category = site.category ? ` / ${site.category}` : '';
      li.textContent = `${name}${subtitle}${category}`;
      container.appendChild(li);
    });
  }

  function renderSymptomDetail() {
    if (!state.selected) {
      els.symptomInfo.classList.add('hidden');
      els.symptomEmpty.classList.remove('hidden');
      return;
    }

    const base = state.selected;
    const enriched = state.result?.symptom;
    const name = enriched?.name || base.name || '名称未設定';
    const patientLabel = enriched?.patientLabel || base.patientLabel;

    els.symptomEmpty.classList.add('hidden');
    els.symptomInfo.classList.remove('hidden');
    els.symptomTitle.textContent = name;
    els.symptomSubtitle.textContent = patientLabel ? `患者向け表現: ${patientLabel}` : '';
    els.symptomSubtitle.classList.toggle('hidden', !patientLabel);

    const metaContainer = els.symptomMeta;
    metaContainer.innerHTML = '';

    const categoryCard = createInfoCard('分類');
    categoryCard.body.textContent = enriched?.category || base.category || '未設定';
    metaContainer.appendChild(categoryCard.card);

    const severityCard = createInfoCard('重症度タグ');
    renderChipList(severityCard.body, enriched?.severityTags || base.severityTags || [], '設定なし');
    metaContainer.appendChild(severityCard.card);

    const icdCard = createInfoCard('ICD10');
    renderChipList(icdCard.body, enriched?.icd10 || base.icd10 || [], '未設定');
    metaContainer.appendChild(icdCard.card);

    const tagContainer = els.symptomTags;
    tagContainer.innerHTML = '';
    const synonyms = enriched?.synonyms || base.synonyms || [];
    if (synonyms.length) {
      const block = document.createElement('div');
      const title = document.createElement('div');
      title.className = 'text-xs font-semibold text-slate-500';
      title.textContent = '同義語';
      const body = document.createElement('div');
      body.className = 'mt-1 flex flex-wrap gap-2';
      synonyms.forEach(value => {
        const badge = document.createElement('span');
        badge.className = 'inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-700';
        badge.textContent = value;
        body.appendChild(badge);
      });
      block.append(title, body);
      tagContainer.appendChild(block);
    }

    if (enriched?.notes || base.notes) {
      const block = document.createElement('div');
      const title = document.createElement('div');
      title.className = 'text-xs font-semibold text-slate-500';
      title.textContent = '備考';
      const body = document.createElement('div');
      body.className = 'mt-1 text-sm text-slate-600 whitespace-pre-wrap';
      body.textContent = enriched?.notes || base.notes;
      block.append(title, body);
      tagContainer.appendChild(block);
    }

    const bodySites = resolveBodySites(enriched || base);
    renderBodySiteList(els.symptomBodySites, bodySites);

    const recommendedServices = state.result?.recommendedServices && state.result.recommendedServices.length
      ? state.result.recommendedServices
      : parseRecommendation(base.defaultServices, 'service');
    const recommendedTests = state.result?.recommendedTests && state.result.recommendedTests.length
      ? state.result.recommendedTests
      : parseRecommendation(base.defaultTests, 'test');

    renderRecommendationList(els.recommendedServices, recommendedServices, '推奨診療メニューは未設定です');
    renderRecommendationList(els.recommendedTests, recommendedTests, '推奨検査は未設定です');
  }

  function hideResults() {
    els.resultsSection.classList.add('hidden');
    els.missingRecommendations.classList.add('hidden');
    els.resultsList.innerHTML = '';
    els.resultCount.textContent = '';
  }

  function renderResults() {
    if (!state.result || !state.result.ok) {
      hideResults();
      if (state.result && state.result.error) {
        alert(state.result.error);
      }
      return;
    }

    const clinics = Array.isArray(state.result.clinics) ? state.result.clinics : [];
    els.resultsList.innerHTML = '';
    els.resultCount.textContent = `${clinics.length} 件`;

    if (!clinics.length) {
      const empty = document.createElement('div');
      empty.className = 'rounded border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500';
      empty.textContent = '推奨される診療メニュー・検査に対応する診療所は現在登録されていません。';
      els.resultsList.appendChild(empty);
    } else {
      clinics.forEach(clinic => {
        const card = document.createElement('article');
        card.className = 'rounded-xl border border-slate-200 bg-white/90 p-5 shadow-sm space-y-3';

        const header = document.createElement('div');
        header.className = 'flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between';

        const title = document.createElement('h4');
        title.className = 'text-lg font-semibold text-blue-900';
        title.textContent = clinic.clinicName || '名称未登録';
        header.appendChild(title);

        if (typeof clinic.score === 'number') {
          const badge = document.createElement('span');
          badge.className = 'inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 border border-emerald-200';
          badge.textContent = `適合度 ${clinic.score}`;
          header.appendChild(badge);
        }

        card.appendChild(header);

        if (clinic.address || clinic.phone || clinic.url) {
          const info = document.createElement('div');
          info.className = 'text-sm text-slate-600 space-y-1';
          if (clinic.address) {
            const row = document.createElement('div');
            row.innerHTML = `<span class="text-xs text-slate-500">住所</span> ${clinic.address}`;
            info.appendChild(row);
          }
          if (clinic.phone) {
            const row = document.createElement('div');
            row.innerHTML = `<span class="text-xs text-slate-500">電話</span> ${clinic.phone}`;
            info.appendChild(row);
          }
          if (clinic.url) {
            const row = document.createElement('div');
            const link = document.createElement('a');
            link.href = clinic.url;
            link.target = '_blank';
            link.rel = 'noopener';
            link.className = 'text-blue-600 hover:underline break-words';
            link.textContent = clinic.url;
            const label = document.createElement('span');
            label.className = 'text-xs text-slate-500 mr-1';
            label.textContent = 'WEB';
            row.append(label, link);
            info.appendChild(row);
          }
          card.appendChild(info);
        }

        const matchedServices = Array.isArray(clinic.matchedServices) ? clinic.matchedServices : [];
        const matchedTests = Array.isArray(clinic.matchedTests) ? clinic.matchedTests : [];

        if (matchedServices.length) {
          const block = document.createElement('div');
          const label = document.createElement('div');
          label.className = 'text-xs font-semibold text-slate-500';
          label.textContent = '対応診療メニュー';
          const list = document.createElement('ul');
          list.className = 'mt-1 space-y-1 text-sm text-slate-700';
          matchedServices.forEach(item => {
            const li = document.createElement('li');
            li.textContent = `${item.category || '分類未設定'} / ${item.name || ''}`;
            list.appendChild(li);
          });
          block.append(label, list);
          card.appendChild(block);
        }

        if (matchedTests.length) {
          const block = document.createElement('div');
          const label = document.createElement('div');
          label.className = 'text-xs font-semibold text-slate-500';
          label.textContent = '対応検査';
          const list = document.createElement('ul');
          list.className = 'mt-1 space-y-1 text-sm text-slate-700';
          matchedTests.forEach(item => {
            const li = document.createElement('li');
            li.textContent = `${item.category || '分類未設定'} / ${item.name || ''}`;
            list.appendChild(li);
          });
          block.append(label, list);
          card.appendChild(block);
        }

        els.resultsList.appendChild(card);
      });
    }

    const missingServices = Array.isArray(state.result.missingServices) ? state.result.missingServices : [];
    const missingTests = Array.isArray(state.result.missingTests) ? state.result.missingTests : [];
    els.missingRecommendations.innerHTML = '';
    if (missingServices.length || missingTests.length) {
      els.missingRecommendations.classList.remove('hidden');
      const card = document.createElement('div');
      card.className = 'rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3 text-sm text-amber-800 shadow-sm';
      const title = document.createElement('div');
      title.className = 'font-semibold mb-2';
      title.textContent = '未対応の推奨項目';
      card.appendChild(title);

      if (missingServices.length) {
        const list = document.createElement('ul');
        list.className = 'list-disc list-inside mb-1';
        missingServices.forEach(item => {
          const li = document.createElement('li');
          li.textContent = `診療: ${item.category || '分類未設定'} / ${item.name || ''}`;
          list.appendChild(li);
        });
        card.appendChild(list);
      }

      if (missingTests.length) {
        const list = document.createElement('ul');
        list.className = 'list-disc list-inside';
        missingTests.forEach(item => {
          const li = document.createElement('li');
          li.textContent = `検査: ${item.category || '分類未設定'} / ${item.name || ''}`;
          list.appendChild(li);
        });
        card.appendChild(list);
      }

      els.missingRecommendations.appendChild(card);
    } else {
      els.missingRecommendations.classList.add('hidden');
    }

    els.resultsSection.classList.remove('hidden');
  }

  async function searchClinicsForSelected() {
    if (!state.selected) {
      alert('先に症状を選択してください。');
      return;
    }
    const key = state.selected._key || `master:symptom:${state.selected.category || ''}|${state.selected.name || ''}`;
    try {
      const data = await wrapWithLoading(async () => {
        const res = await fetch(`${API_BASE}/api/searchClinicsBySymptom?key=${encodeURIComponent(key)}`);
        if (!res.ok) {
          const text = await res.text();
          throw new Error(`HTTP ${res.status} ${text}`);
        }
        return res.json();
      }, '検索中...', els.resultsSection);
      state.result = data;
      renderSymptomDetail();
      renderResults();
    } catch (err) {
      console.error(err);
      alert(`検索に失敗しました: ${err.message}`);
    }
  }

  async function loadBodySites() {
    try {
      const data = await fetchJson('/api/listMaster?type=bodySite&status=approved');
      const items = Array.isArray(data.items) ? data.items : [];
      const map = new Map();
      items.forEach(item => {
        bodySiteRefCandidates(item).forEach(ref => {
          if (ref && !map.has(ref)) {
            map.set(ref, item);
          }
        });
      });
      state.bodySiteMap = map;
    } catch (err) {
      console.warn('failed to load body site master', err);
      state.bodySiteMap = new Map();
    }
  }

  async function loadSymptoms() {
    const data = await wrapWithLoading(
      () => fetchJson('/api/listMaster?type=symptom&status=approved'),
      '症状を読み込み中...',
      els.symptomList
    );
    const items = Array.isArray(data.items) ? data.items : [];
    items.sort((a, b) => {
      const catDiff = (a.category || '').localeCompare(b.category || '', 'ja');
      if (catDiff !== 0) return catDiff;
      return (a.name || '').localeCompare(b.name || '', 'ja');
    });
    state.symptoms = items;
    state.categories = Array.from(new Set(items.map(item => item.category).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'ja'));
    populateCategoryFilter();
    state.filteredSymptoms = [...state.symptoms];
    renderSymptomList();
  }

  function bindElements() {
    els.searchInput = document.getElementById('symptomSearch');
    els.categoryFilter = document.getElementById('symptomCategoryFilter');
    els.symptomList = document.getElementById('symptomList');
    els.symptomEmpty = document.getElementById('symptomEmpty');
    els.symptomInfo = document.getElementById('symptomInfo');
    els.symptomTitle = document.getElementById('symptomTitle');
    els.symptomSubtitle = document.getElementById('symptomSubtitle');
    els.symptomMeta = document.getElementById('symptomMeta');
    els.symptomTags = document.getElementById('symptomTags');
    els.symptomBodySites = document.getElementById('symptomBodySites');
    els.recommendedServices = document.getElementById('recommendedServices');
    els.recommendedTests = document.getElementById('recommendedTests');
    els.resultsSection = document.getElementById('searchResults');
    els.resultCount = document.getElementById('resultCount');
    els.resultsList = document.getElementById('resultsList');
    els.missingRecommendations = document.getElementById('missingRecommendations');
    els.searchButton = document.getElementById('searchClinics');

    els.searchInput.addEventListener('input', applyFilters);
    els.categoryFilter.addEventListener('change', applyFilters);
    els.searchButton.addEventListener('click', searchClinicsForSelected);
  }

  async function init() {
    bindElements();
    await loadBodySites();
    await loadSymptoms();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
