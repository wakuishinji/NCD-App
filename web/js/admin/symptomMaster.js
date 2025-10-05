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
  const chipKeyMap = {
    bodySites: 'bodySiteChips',
    services: 'serviceChips',
    tests: 'testChips'
  };

  const state = {
    symptoms: [],
    filtered: [],
    categories: [],
    bodySites: [],
    bodySiteMap: new Map(),
    services: [],
    tests: [],
    selected: null,
    isNew: false,
    selections: {
      bodySites: [],
      services: [],
      tests: []
    },
    picker: {
      open: false,
      type: null,
      candidates: [],
      filtered: [],
      selectedValues: new Set(),
      searchKeyword: ''
    }
  };

  function nk(value) {
    return (value || '').trim();
  }

  function sanitizeSegment(value) {
    if (!value) return '';
    return value.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, '');
  }

  function slugify(value) {
    return sanitizeSegment(value).replace(/[^a-z0-9\-]/g, '-');
  }

  function normalizeBodySiteRef(ref) {
    if (!ref) return null;
    let raw = ref.trim();
    if (!raw) return null;
    if (raw.toLowerCase().startsWith('bodysite:')) {
      raw = raw.slice('bodysite:'.length);
    }
    const normalized = sanitizeSegment(raw);
    if (!normalized) return null;
    return `bodysite:${normalized}`;
  }

  function bodySiteRefCandidates(item) {
    const set = new Set();
    if (!item || typeof item !== 'object') return set;
    [item.canonical_name, item.name, item.category].forEach(value => {
      const normalized = normalizeBodySiteRef(value);
      if (normalized) set.add(normalized);
    });
    return set;
  }

  function bodySiteValue(item) {
    const canonical = nk(item.canonical_name);
    if (canonical) return `bodySite:${canonical}`;
    return `bodySite:${slugify(item.name || item.category || '')}`;
  }

  function serviceValue(item) {
    return `master:service:${item.category || ''}|${item.name}`;
  }

  function testValue(item) {
    return `master:test:${item.category || ''}|${item.name}`;
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

  async function fetchJson(path, options = {}) {
    const res = await fetch(`${API_BASE}${path}`, options);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status} ${text}`);
    }
    return res.json();
  }

  function formatTimestamp(ts) {
    if (!ts) return '-';
    const date = new Date(ts * 1000);
    if (Number.isNaN(date.getTime())) return String(ts);
    return date.toLocaleString('ja-JP');
  }

  function renderSymptomList() {
    const container = els.symptomList;
    if (!container) return;
    container.innerHTML = '';
    if (!state.filtered.length) {
      container.innerHTML = '<div class="p-4 text-sm text-slate-500">該当する症状がありません。キーワードや分類を調整してください。</div>';
      return;
    }

    const grouped = new Map();
    state.filtered.forEach(item => {
      const cat = item.category || '分類未設定';
      if (!grouped.has(cat)) grouped.set(cat, []);
      grouped.get(cat).push(item);
    });

    for (const [category, items] of grouped) {
      const section = document.createElement('div');
      section.className = 'py-2';

      const header = document.createElement('div');
      header.className = 'px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 bg-slate-100';
      header.textContent = category;
      section.appendChild(header);

      items.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ja'));
      items.forEach(item => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'w-full text-left px-4 py-3 text-sm transition flex flex-col gap-1 hover:bg-blue-50';
        if (state.selected && state.selected._key === item._key) {
          button.classList.add('bg-blue-50');
        }
        const title = document.createElement('div');
        title.className = 'font-semibold text-slate-800';
        title.textContent = item.name || '名称未設定';
        button.appendChild(title);
        if (item.patientLabel) {
          const subtitle = document.createElement('div');
          subtitle.className = 'text-xs text-slate-500';
          subtitle.textContent = item.patientLabel;
          button.appendChild(subtitle);
        }
        button.addEventListener('click', () => selectSymptom(item));
        section.appendChild(button);
      });

      container.appendChild(section);
    }
  }

  function applyFilters() {
    const keyword = nk(els.searchInput.value).toLowerCase();
    const category = els.categoryFilter.value;
    state.filtered = state.symptoms.filter(item => {
      if (category && item.category !== category) return false;
      if (!keyword) return true;
      const haystack = [item.name, item.patientLabel]
        .concat(Array.isArray(item.synonyms) ? item.synonyms : [])
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(keyword);
    });
    renderSymptomList();
  }

  function populateCategorySelect() {
    els.fieldCategory.innerHTML = '';
    els.categoryFilter.innerHTML = '';

    const selectPlaceholder = document.createElement('option');
    selectPlaceholder.value = '';
    selectPlaceholder.textContent = '分類を選択';
    els.fieldCategory.appendChild(selectPlaceholder);

    const manualOption = document.createElement('option');
    manualOption.value = '__manual__';
    manualOption.textContent = '直接入力';

    const filterPlaceholder = document.createElement('option');
    filterPlaceholder.value = '';
    filterPlaceholder.textContent = 'すべて';
    els.categoryFilter.appendChild(filterPlaceholder);

    state.categories.forEach(cat => {
      const option = document.createElement('option');
      option.value = cat;
      option.textContent = cat;
      els.fieldCategory.appendChild(option.cloneNode(true));
      els.categoryFilter.appendChild(option);
    });

    els.fieldCategory.appendChild(manualOption);
  }

  function renderSelectedChips(type) {
    const targetKey = chipKeyMap[type];
    const container = targetKey ? els[targetKey] : null;
    const values = state.selections[type] || [];
    container.innerHTML = '';
    if (!values.length) {
      const badge = document.createElement('span');
      badge.className = 'text-xs text-slate-400';
      badge.textContent = '未選択';
      container.appendChild(badge);
      return;
    }

    values.forEach(value => {
      const info = getSelectionInfo(type, value);
      const chip = document.createElement('span');
      chip.className = 'inline-flex items-center gap-2 rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-700 border border-slate-200';
      const label = document.createElement('span');
      label.textContent = info.label;
      chip.appendChild(label);
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'text-slate-400 hover:text-red-600';
      remove.textContent = '×';
      remove.dataset.removeValue = value;
      remove.dataset.removeType = type;
      chip.appendChild(remove);
      container.appendChild(chip);
    });
  }

  function getSelectionInfo(type, value) {
    if (type === 'bodySites') {
      const normalized = normalizeBodySiteRef(value);
      const item = normalized ? state.bodySiteMap.get(normalized) : null;
      if (item) {
        const label = `${item.name || '名称未設定'}${item.patientLabel ? `（${item.patientLabel}）` : ''}`;
        return { label };
      }
      return { label: value };
    }
    if (type === 'services' || type === 'tests') {
      const parsed = parseMasterKey(value);
      const list = type === 'services' ? state.services : state.tests;
      if (parsed && (!parsed.type || parsed.type === (type === 'services' ? 'service' : 'test'))) {
        const match = list.find(item => sanitizeSegment(item.category) === sanitizeSegment(parsed.category) && sanitizeSegment(item.name) === sanitizeSegment(parsed.name));
        if (match) {
          return { label: `${match.category || '分類未設定'} / ${match.name || ''}` };
        }
        return { label: `${parsed.category || '分類未設定'} / ${parsed.name || ''}` };
      }
      return { label: value };
    }
    return { label: value };
  }

  function removeSelection(type, value) {
    const list = state.selections[type];
    const index = list.indexOf(value);
    if (index >= 0) {
      list.splice(index, 1);
      renderSelectedChips(type);
    }
  }

  function openPicker(type) {
    const config = {
      bodySites: {
        title: '関連部位を選択',
        candidates: state.bodySites.map(item => ({
          value: bodySiteValue(item),
          label: item.name || '名称未設定',
          description: item.patientLabel || '',
          category: item.category || ''
        }))
      },
      services: {
        title: '推奨診療メニューを選択',
        candidates: state.services.map(item => ({
          value: serviceValue(item),
          label: item.name || '名称未設定',
          description: item.category || ''
        }))
      },
      tests: {
        title: '推奨検査を選択',
        candidates: state.tests.map(item => ({
          value: testValue(item),
          label: item.name || '名称未設定',
          description: item.category || ''
        }))
      }
    }[type];

    if (!config) return;

    state.picker.type = type;

    const sorted = [...config.candidates].sort((a, b) => {
      const catDiff = (a.category || '').localeCompare(b.category || '', 'ja');
      if (catDiff !== 0) return catDiff;
      return (a.label || '').localeCompare(b.label || '', 'ja');
    });
    state.picker.candidates = sorted;
    state.picker.filtered = sorted;
    state.picker.selectedValues = new Set(state.selections[type] || []);
    state.picker.searchKeyword = '';

    els.pickerTitle.textContent = config.title;
    els.pickerSearch.value = '';
    renderPickerList();

    els.pickerOverlay.classList.remove('hidden');
    els.pickerOverlay.classList.add('flex');
    document.body.classList.add('overflow-hidden');
    state.picker.open = true;
    els.pickerSearch.focus();
  }

  function closePicker() {
    if (!state.picker.open) return;
    state.picker.open = false;
    els.pickerOverlay.classList.add('hidden');
    els.pickerOverlay.classList.remove('flex');
    document.body.classList.remove('overflow-hidden');
  }

  function renderPickerList() {
    const container = els.pickerList;
    container.innerHTML = '';
    const keyword = state.picker.searchKeyword.toLowerCase();

    state.picker.filtered = state.picker.candidates.filter(candidate => {
      if (!keyword) return true;
      const haystack = [candidate.label, candidate.description, candidate.category]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(keyword);
    });

    if (!state.picker.filtered.length) {
      const empty = document.createElement('div');
      empty.className = 'px-3 py-4 text-sm text-slate-500';
      empty.textContent = '該当する項目がありません';
      container.appendChild(empty);
      return;
    }

    state.picker.filtered.forEach(candidate => {
      const row = document.createElement('label');
      row.className = 'flex items-start gap-3 rounded px-3 py-2 hover:bg-blue-50';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'mt-1';
      checkbox.value = candidate.value;
      checkbox.checked = state.picker.selectedValues.has(candidate.value);
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) {
          state.picker.selectedValues.add(candidate.value);
        } else {
          state.picker.selectedValues.delete(candidate.value);
        }
      });
      const content = document.createElement('div');
      content.className = 'flex flex-col text-sm text-slate-700';
      const label = document.createElement('span');
      label.textContent = candidate.label;
      content.appendChild(label);
      if (candidate.description) {
        const desc = document.createElement('span');
        desc.className = 'text-xs text-slate-500';
        desc.textContent = candidate.description;
        content.appendChild(desc);
      }
      row.append(checkbox, content);
      container.appendChild(row);
    });
  }

  function confirmPicker() {
    if (!state.picker.open || !state.picker.type) return;
    state.selections[state.picker.type] = Array.from(state.picker.selectedValues);
    renderSelectedChips(state.picker.type);
    closePicker();
  }

  function showForm(symptom, isNew) {
    state.selected = symptom;
    state.isNew = Boolean(isNew);

    state.selections.bodySites = Array.isArray(symptom.bodySiteRefs) ? [...symptom.bodySiteRefs] : [];
    state.selections.services = Array.isArray(symptom.defaultServices) ? [...symptom.defaultServices] : [];
    state.selections.tests = Array.isArray(symptom.defaultTests) ? [...symptom.defaultTests] : [];

    renderSelectedChips('bodySites');
    renderSelectedChips('services');
    renderSelectedChips('tests');

    els.detailEmpty.classList.add('hidden');
    els.form.classList.remove('hidden');

    els.formTitle.textContent = isNew ? '新規症状を登録' : '症状を編集';
    els.formMeta.textContent = isNew ? 'まだ保存されていません。' : `更新日時: ${formatTimestamp(symptom.updated_at)} / 回数: ${symptom.count ?? 0}`;
    els.deleteButton.classList.toggle('hidden', isNew);

    if (symptom.category && !state.categories.includes(symptom.category)) {
      state.categories.push(symptom.category);
      state.categories.sort((a, b) => a.localeCompare(b, 'ja'));
      populateCategorySelect();
    }

    const categoryValue = state.categories.includes(symptom.category) ? symptom.category : '__manual__';
    els.fieldCategory.value = categoryValue || '';
    els.fieldCategoryManual.value = categoryValue === '__manual__' ? (symptom.category || '') : '';
    toggleManualCategory();

    els.fieldStatus.value = symptom.status || 'candidate';
    els.fieldName.value = symptom.name || '';
    els.fieldPatientLabel.value = symptom.patientLabel || '';
    els.fieldSeverity.value = (symptom.severityTags || []).join(',');
    els.fieldIcd10.value = (symptom.icd10 || []).join(',');
    els.fieldSynonyms.value = (symptom.synonyms || []).join(',');
    els.fieldThesaurus.value = (symptom.thesaurusRefs || []).join(',');
    els.fieldNotes.value = symptom.notes || '';
  }

  function clearForm() {
    showForm({
      category: state.categories[0] || '',
      status: 'candidate',
      name: '',
      patientLabel: '',
      severityTags: [],
      icd10: [],
      synonyms: [],
      bodySiteRefs: [],
      defaultServices: [],
      defaultTests: [],
      thesaurusRefs: [],
      notes: ''
    }, true);
  }

  function selectSymptom(symptom) {
    showForm(symptom, false);
    renderSymptomList();
  }

  function gatherFormPayload() {
    const manual = els.fieldCategory.value === '__manual__';
    const category = manual ? nk(els.fieldCategoryManual.value) : els.fieldCategory.value;
    if (!category) throw new Error('カテゴリを入力してください');
    const name = nk(els.fieldName.value);
    if (!name) throw new Error('名称を入力してください');

    return {
      category,
      name,
      status: els.fieldStatus.value,
      patientLabel: nk(els.fieldPatientLabel.value),
      severityTags: els.fieldSeverity.value ? els.fieldSeverity.value.split(',').map(v => nk(v)).filter(Boolean) : [],
      icd10: els.fieldIcd10.value ? els.fieldIcd10.value.split(',').map(v => nk(v)).filter(Boolean) : [],
      synonyms: els.fieldSynonyms.value ? els.fieldSynonyms.value.split(',').map(v => nk(v)).filter(Boolean) : [],
      thesaurusRefs: els.fieldThesaurus.value ? els.fieldThesaurus.value.split(',').map(v => nk(v)).filter(Boolean) : [],
      bodySiteRefs: [...state.selections.bodySites],
      defaultServices: [...state.selections.services],
      defaultTests: [...state.selections.tests],
      notes: nk(els.fieldNotes.value)
    };
  }

  async function saveSymptom(event) {
    event.preventDefault();
    let payload;
    try {
      payload = gatherFormPayload();
    } catch (err) {
      alert(err.message);
      return;
    }

    try {
      if (state.isNew) {
        await wrapWithLoading(async () => {
          await fetchJson('/api/addMasterItem', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type: 'symptom',
              category: payload.category,
              name: payload.name,
              status: payload.status,
              patientLabel: payload.patientLabel,
              severityTags: payload.severityTags,
              icd10: payload.icd10,
              synonyms: payload.synonyms,
              defaultServices: payload.defaultServices,
              defaultTests: payload.defaultTests,
              bodySiteRefs: payload.bodySiteRefs,
              thesaurusRefs: payload.thesaurusRefs,
              notes: payload.notes
            })
          });
        }, '症状を保存中...', els.detailPanel);
      } else {
        await wrapWithLoading(async () => {
          await fetchJson('/api/updateMasterItem', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type: 'symptom',
              category: state.selected.category,
              name: state.selected.name,
              status: payload.status,
              newCategory: payload.category !== state.selected.category ? payload.category : undefined,
              newName: payload.name !== state.selected.name ? payload.name : undefined,
              patientLabel: payload.patientLabel,
              severityTags: payload.severityTags,
              icd10: payload.icd10,
              synonyms: payload.synonyms,
              defaultServices: payload.defaultServices,
              defaultTests: payload.defaultTests,
              bodySiteRefs: payload.bodySiteRefs,
              thesaurusRefs: payload.thesaurusRefs,
              notes: payload.notes
            })
          });
        }, '症状を更新中...', els.detailPanel);
      }

      await loadSymptoms();
      const updated = state.symptoms.find(item => item.name === payload.name && item.category === payload.category);
      if (updated) {
        selectSymptom(updated);
      } else {
        els.form.classList.add('hidden');
        els.detailEmpty.classList.remove('hidden');
      }
      alert('保存しました');
    } catch (err) {
      console.error(err);
      alert(`保存に失敗しました: ${err.message}`);
    }
  }

  async function deleteSymptom() {
    if (!state.selected || state.isNew) return;
    if (!confirm(`${state.selected.name} を削除しますか？`)) return;
    try {
      await wrapWithLoading(async () => {
        await fetchJson('/api/deleteMasterItem', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'symptom',
            category: state.selected.category,
            name: state.selected.name
          })
        });
      }, '削除中...', els.detailPanel);
      await loadSymptoms();
      els.form.classList.add('hidden');
      els.detailEmpty.classList.remove('hidden');
      alert('削除しました');
    } catch (err) {
      console.error(err);
      alert(`削除に失敗しました: ${err.message}`);
    }
  }

  async function loadCategories() {
    try {
      const data = await fetchJson('/api/listCategories?type=symptom');
      state.categories = Array.isArray(data.categories) ? data.categories : [];
      state.categories.sort((a, b) => a.localeCompare(b, 'ja'));
    } catch (err) {
      console.error('failed to load categories', err);
      state.categories = [];
    }
    populateCategorySelect();
  }

  async function loadBodySites() {
    try {
      const data = await fetchJson('/api/listMaster?type=bodySite&status=approved');
      state.bodySites = Array.isArray(data.items) ? data.items : [];
      const map = new Map();
      state.bodySites.forEach(item => {
        bodySiteRefCandidates(item).forEach(ref => {
          if (ref && !map.has(ref)) {
            map.set(ref, item);
          }
        });
      });
      state.bodySiteMap = map;
    } catch (err) {
      console.error('failed to load body sites', err);
      state.bodySites = [];
      state.bodySiteMap = new Map();
    }
    renderSelectedChips('bodySites');
  }

  async function loadServices() {
    try {
      const data = await fetchJson('/api/listMaster?type=service&status=approved');
      state.services = Array.isArray(data.items) ? data.items : [];
    } catch (err) {
      console.error('failed to load services', err);
      state.services = [];
    }
    renderSelectedChips('services');
  }

  async function loadTests() {
    try {
      const data = await fetchJson('/api/listMaster?type=test&status=approved');
      state.tests = Array.isArray(data.items) ? data.items : [];
    } catch (err) {
      console.error('failed to load tests', err);
      state.tests = [];
    }
    renderSelectedChips('tests');
  }

  async function loadSymptoms() {
    const data = await wrapWithLoading(() => fetchJson('/api/listMaster?type=symptom'), '症状を読み込み中...', els.symptomList);
    state.symptoms = Array.isArray(data.items) ? data.items : [];
    state.symptoms.sort((a, b) => {
      const catDiff = (a.category || '').localeCompare(b.category || '', 'ja');
      if (catDiff !== 0) return catDiff;
      return (a.name || '').localeCompare(b.name || '', 'ja');
    });
    state.categories = Array.from(new Set(state.symptoms.map(item => item.category).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'ja'));
    populateCategorySelect();
    state.filtered = [...state.symptoms];
    renderSymptomList();
  }

  function toggleManualCategory() {
    const useManual = els.fieldCategory.value === '__manual__';
    els.fieldCategoryManual.classList.toggle('hidden', !useManual);
  }

  function bindElements() {
    els.symptomList = document.getElementById('symptomList');
    els.searchInput = document.getElementById('symptomSearch');
    els.categoryFilter = document.getElementById('symptomCategoryFilter');
    els.createButton = document.getElementById('createSymptom');
    els.reloadButton = document.getElementById('reloadSymptom');
    els.detailPanel = document.getElementById('detailPanel');
    els.detailEmpty = document.getElementById('detailEmpty');
    els.form = document.getElementById('symptomForm');
    els.formTitle = document.getElementById('formTitle');
    els.formMeta = document.getElementById('formMeta');
    els.deleteButton = document.getElementById('deleteSymptom');

    els.fieldCategory = document.getElementById('fieldCategory');
    els.fieldCategoryManual = document.getElementById('fieldCategoryManual');
    els.fieldStatus = document.getElementById('fieldStatus');
    els.fieldName = document.getElementById('fieldName');
    els.fieldPatientLabel = document.getElementById('fieldPatientLabel');
    els.fieldSeverity = document.getElementById('fieldSeverity');
    els.fieldIcd10 = document.getElementById('fieldIcd10');
    els.fieldSynonyms = document.getElementById('fieldSynonyms');
    els.fieldThesaurus = document.getElementById('fieldThesaurus');
    els.fieldNotes = document.getElementById('fieldNotes');

    els.bodySiteChips = document.getElementById('bodySiteChips');
    els.serviceChips = document.getElementById('serviceChips');
    els.testChips = document.getElementById('testChips');

    els.openBodySitePicker = document.getElementById('openBodySitePicker');
    els.openServicePicker = document.getElementById('openServicePicker');
    els.openTestPicker = document.getElementById('openTestPicker');

    els.pickerOverlay = document.getElementById('pickerOverlay');
    els.pickerTitle = document.getElementById('pickerTitle');
    els.pickerSearch = document.getElementById('pickerSearch');
    els.pickerList = document.getElementById('pickerList');
    els.pickerConfirm = document.getElementById('pickerConfirm');
    els.pickerCancel = document.getElementById('pickerCancel');
    els.pickerClose = document.getElementById('pickerClose');

    els.searchInput.addEventListener('input', applyFilters);
    els.categoryFilter.addEventListener('change', applyFilters);
    els.createButton.addEventListener('click', clearForm);
    els.reloadButton.addEventListener('click', loadSymptoms);
    els.form.addEventListener('submit', saveSymptom);
    els.deleteButton.addEventListener('click', deleteSymptom);
    els.fieldCategory.addEventListener('change', toggleManualCategory);

    els.bodySiteChips.addEventListener('click', handleChipRemove);
    els.serviceChips.addEventListener('click', handleChipRemove);
    els.testChips.addEventListener('click', handleChipRemove);

    els.openBodySitePicker.addEventListener('click', () => openPicker('bodySites'));
    els.openServicePicker.addEventListener('click', () => openPicker('services'));
    els.openTestPicker.addEventListener('click', () => openPicker('tests'));

    els.pickerSearch.addEventListener('input', () => {
      state.picker.searchKeyword = els.pickerSearch.value.toLowerCase();
      renderPickerList();
    });
    els.pickerConfirm.addEventListener('click', confirmPicker);
    els.pickerCancel.addEventListener('click', closePicker);
    els.pickerClose.addEventListener('click', closePicker);
    els.pickerOverlay.addEventListener('click', (event) => {
      if (event.target === els.pickerOverlay) {
        closePicker();
      }
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && state.picker.open) {
        closePicker();
      }
    });
  }

  function handleChipRemove(event) {
    const button = event.target.closest('button[data-remove-value]');
    if (!button) return;
    const type = button.dataset.removeType;
    const value = button.dataset.removeValue;
    if (type && value) {
      removeSelection(type, value);
    }
  }

  async function init() {
    bindElements();
    await Promise.all([
      loadCategories(),
      loadBodySites(),
      loadServices(),
      loadTests()
    ]);
    await loadSymptoms();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
