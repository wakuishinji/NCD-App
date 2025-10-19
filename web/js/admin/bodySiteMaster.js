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
    bodySites: [],
    categories: [],
    selected: null,
    isNew: false,
    symptoms: []
  };

  function nk(value) { return (value || '').trim(); }

  function parseCsv(value) {
    return Array.from(new Set((value || '').split(',').map(v => nk(v)).filter(Boolean)));
  }

  function joinCsv(values) {
    return Array.isArray(values) ? values.filter(Boolean).join(',') : '';
  }

  function getApi(path) {
    return `${API_BASE}${path}`;
  }

  async function fetchJson(path, options = {}) {
    const res = await fetch(getApi(path), options);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status} ${text}`);
    }
    return res.json();
  }

  function populateCategorySelect() {
    const select = els.bodyCategory;
    const filter = els.categoryFilter;
    select.innerHTML = '';
    filter.innerHTML = '';

    const selectPlaceholder = document.createElement('option');
    selectPlaceholder.value = '';
    selectPlaceholder.textContent = '分類を選択';
    select.appendChild(selectPlaceholder);

    const manualOption = document.createElement('option');
    manualOption.value = '__manual__';
    manualOption.textContent = '直接入力';

    const filterPlaceholder = document.createElement('option');
    filterPlaceholder.value = '';
    filterPlaceholder.textContent = 'すべて';
    filter.appendChild(filterPlaceholder);

    for (const cat of state.categories) {
      const option = document.createElement('option');
      option.value = cat;
      option.textContent = cat;
      select.appendChild(option.cloneNode(true));
      filter.appendChild(option.cloneNode(true));
    }
    select.appendChild(manualOption);
  }

  function populateParentSelect() {
    const select = els.bodyParent;
    select.innerHTML = '';
    const option = document.createElement('option');
    option.value = '';
    option.textContent = '（なし）';
    select.appendChild(option);

    const items = [...state.bodySites].sort((a,b)=> (a.category || '').localeCompare(b.category || '', 'ja') || (a.name || '').localeCompare(b.name || '', 'ja'));
    for (const item of items) {
      const opt = document.createElement('option');
      opt.value = parentKeyValue(item);
      opt.textContent = `${item.category || ''} / ${item.name}`.replace(/^\s*\/\s*/, '');
      select.appendChild(opt);
    }
  }

  function renderBodySiteList() {
    const container = els.bodySiteList;
    container.innerHTML = '';
    const keyword = nk(els.search.value).toLowerCase();
    const categoryFilter = els.categoryFilter.value;
    const matches = state.bodySites.filter(item => {
      if (categoryFilter && item.category !== categoryFilter) return false;
      if (!keyword) return true;
      const haystack = [item.name, item.patientLabel, ...(item.aliases || [])]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(keyword);
    });

    if (!matches.length) {
      container.innerHTML = '<div class="p-4 text-sm text-slate-500">該当する部位がありません。</div>';
      return;
    }

    const grouped = new Map();
    for (const item of matches) {
      const cat = item.category || '分類未設定';
      if (!grouped.has(cat)) grouped.set(cat, []);
      grouped.get(cat).push(item);
    }

    for (const [category, items] of grouped) {
      const section = document.createElement('div');
      section.className = 'py-2';
      const header = document.createElement('div');
      header.className = 'px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 bg-slate-100';
      header.textContent = category;
      section.appendChild(header);

      items.sort((a,b)=> (a.name || '').localeCompare(b.name || '', 'ja'));
      for (const item of items) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'w-full text-left px-4 py-3 text-sm hover:bg-emerald-50 transition flex flex-col gap-1';
        if (state.selected && state.selected._key === item._key) button.classList.add('bg-emerald-50');
        const title = document.createElement('div');
        title.className = 'font-semibold text-slate-800';
        title.textContent = item.name;
        const subtitle = document.createElement('div');
        subtitle.className = 'text-xs text-slate-500';
        subtitle.textContent = item.patientLabel || '';
        button.appendChild(title);
        button.appendChild(subtitle);
        button.addEventListener('click', () => selectBodySite(item));
        section.appendChild(button);
      }
      container.appendChild(section);
    }
  }

  function parentKeyValue(item) {
    const canonical = nk(item.canonical_name);
    if (canonical) return `bodySite:${canonical}`;
    return `bodySite:${slugify(item.name || item.category || '')}`;
  }

  function slugify(value) {
    return nk(value).normalize('NFKC').replace(/\s+/g, '-').toLowerCase();
  }

  function showForm(bodySite, isNew) {
    state.selected = bodySite;
    state.isNew = Boolean(isNew);

    els.detailEmpty.classList.add('hidden');
    els.form.classList.remove('hidden');

    els.formTitle.textContent = isNew ? '新規部位を登録' : '部位を編集';
    els.formMeta.textContent = isNew ? 'まだ保存されていません。' : `更新日時: ${formatTimestamp(bodySite.updated_at)} / 回数: ${bodySite.count ?? 0}`;
    els.deleteButton.classList.toggle('hidden', isNew);

    const categories = new Set(state.categories);
    if (bodySite.category && !categories.has(bodySite.category)) {
      state.categories.push(bodySite.category);
      populateCategorySelect();
    }

    const categoryValue = state.categories.includes(bodySite.category) ? bodySite.category : '__manual__';
    els.bodyCategory.value = categoryValue;
    els.bodyCategoryManual.value = categoryValue === '__manual__' ? (bodySite.category || '') : '';
    toggleManualCategory();

    els.bodyStatus.value = bodySite.status || 'approved';
    els.bodyName.value = bodySite.name || '';
    els.bodyPatientLabel.value = bodySite.patientLabel || '';
    els.bodySystem.value = bodySite.anatomicalSystem || '';
    els.bodyCanonical.value = bodySite.canonical_name || '';
    els.bodyLaterality.value = bodySite.laterality || '';
    els.bodyAliases.value = joinCsv(bodySite.aliases);
    els.bodyThesaurus.value = joinCsv(bodySite.thesaurusRefs);
    els.bodyNotes.value = bodySite.notes || '';

    populateParentSelect();
    els.bodyParent.value = bodySite.parentKey || '';

    renderRelatedSymptoms(bodySite);
  }

  function renderRelatedSymptoms(bodySite) {
    const list = els.relatedSymptoms;
    list.innerHTML = '';
    if (!state.symptoms.length) {
      const li = document.createElement('li');
      li.textContent = '症状マスターが未取得です';
      list.appendChild(li);
      return;
    }
    const key = parentKeyValue(bodySite);
    const matches = state.symptoms.filter(symptom => Array.isArray(symptom.bodySiteRefs) && symptom.bodySiteRefs.includes(key));
    if (!matches.length) {
      const li = document.createElement('li');
      li.textContent = '現在紐付く症状はありません';
      list.appendChild(li);
      return;
    }
    matches.sort((a,b)=> a.name.localeCompare(b.name, 'ja'));
    for (const symptom of matches) {
      const li = document.createElement('li');
      li.textContent = `${symptom.name}${symptom.patientLabel ? `（${symptom.patientLabel}）` : ''}`;
      list.appendChild(li);
    }
  }

  function clearForm() {
    showForm({
      category: state.categories[0] || '',
      status: 'approved',
      name: '',
      patientLabel: '',
      anatomicalSystem: '',
      canonical_name: '',
      parentKey: '',
      laterality: '',
      aliases: [],
      thesaurusRefs: [],
      notes: ''
    }, true);
  }

  function selectBodySite(item) {
    showForm(item, false);
    renderBodySiteList();
  }

  function gatherFormPayload() {
    const manual = els.bodyCategory.value === '__manual__';
    const category = manual ? nk(els.bodyCategoryManual.value) : els.bodyCategory.value;
    if (!category) throw new Error('カテゴリを入力してください');
    const name = nk(els.bodyName.value);
    if (!name) throw new Error('名称を入力してください');

    return {
      category,
      name,
      status: els.bodyStatus.value,
      patientLabel: nk(els.bodyPatientLabel.value),
      anatomicalSystem: nk(els.bodySystem.value),
      canonical_name: nk(els.bodyCanonical.value),
      parentKey: nk(els.bodyParent.value),
      laterality: nk(els.bodyLaterality.value),
      aliases: parseCsv(els.bodyAliases.value),
      thesaurusRefs: parseCsv(els.bodyThesaurus.value),
      notes: nk(els.bodyNotes.value)
    };
  }

  async function saveBodySite(event) {
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
              type: 'bodySite',
              category: payload.category,
              name: payload.name,
              status: payload.status,
              patientLabel: payload.patientLabel,
              anatomicalSystem: payload.anatomicalSystem,
              canonical_name: payload.canonical_name,
              parentKey: payload.parentKey,
              laterality: payload.laterality,
              aliases: payload.aliases,
              thesaurusRefs: payload.thesaurusRefs,
              notes: payload.notes
            })
          });
        }, '部位を保存中...', els.detailPanel);
      } else {
        await wrapWithLoading(async () => {
          await fetchJson('/api/updateMasterItem', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type: 'bodySite',
              category: state.selected.category,
              name: state.selected.name,
              status: payload.status,
              newCategory: payload.category !== state.selected.category ? payload.category : undefined,
              newName: payload.name !== state.selected.name ? payload.name : undefined,
              patientLabel: payload.patientLabel,
              anatomicalSystem: payload.anatomicalSystem,
              canonical_name: payload.canonical_name,
              parentKey: payload.parentKey,
              laterality: payload.laterality,
              aliases: payload.aliases,
              thesaurusRefs: payload.thesaurusRefs,
              notes: payload.notes
            })
          });
        }, '部位を更新中...', els.detailPanel);
      }

      await loadBodySites();
      const updated = state.bodySites.find(item => item.name === payload.name && item.category === payload.category);
      if (updated) {
        selectBodySite(updated);
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

  async function deleteBodySite() {
    if (!state.selected || state.isNew) return;
    const hasRelation = state.symptoms.some(symptom => Array.isArray(symptom.bodySiteRefs) && symptom.bodySiteRefs.includes(parentKeyValue(state.selected)));
    if (hasRelation && !confirm('この部位に紐付く症状があります。本当に削除しますか？')) return;
    if (!hasRelation && !confirm('削除しますか？')) return;
    try {
      await wrapWithLoading(async () => {
        await fetchJson('/api/deleteMasterItem', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'bodySite',
            category: state.selected.category,
            name: state.selected.name
          })
        });
      }, '削除中...', els.detailPanel);
      await loadBodySites();
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
      const data = await fetchJson('/api/listCategories?type=bodySite');
      state.categories = Array.isArray(data.categories) ? data.categories : [];
    } catch (err) {
      console.error('failed to load bodySite categories', err);
      state.categories = [];
    }
    populateCategorySelect();
  }

  async function loadBodySites() {
    const data = await wrapWithLoading(() => fetchJson('/api/listMaster?type=bodySite'), '部位を読み込み中...', els.bodySiteList);
    state.bodySites = Array.isArray(data.items) ? data.items : [];
    populateParentSelect();
    renderBodySiteList();
  }

  async function loadSymptoms() {
    try {
      const data = await fetchJson('/api/listMaster?type=symptom');
      state.symptoms = Array.isArray(data.items) ? data.items : [];
    } catch (err) {
      console.error('failed to load symptom master for reference', err);
      state.symptoms = [];
    }
  }

  function formatTimestamp(ts) {
    if (!ts) return '-';
    const date = new Date(ts * 1000);
    if (Number.isNaN(date.getTime())) return String(ts);
    return date.toLocaleString('ja-JP');
  }

  function toggleManualCategory() {
    const useManual = els.bodyCategory.value === '__manual__';
    els.bodyCategoryManual.classList.toggle('hidden', !useManual);
  }

  function bindElements() {
    els.bodySiteList = document.getElementById('bodySiteList');
    els.search = document.getElementById('bodySearch');
    els.categoryFilter = document.getElementById('bodyCategoryFilter');
    els.createButton = document.getElementById('createBodySite');
    els.reloadButton = document.getElementById('reloadBodySite');
    els.detailPanel = document.getElementById('bodyDetailPanel');
    els.detailEmpty = document.getElementById('bodyDetailEmpty');
    els.form = document.getElementById('bodySiteForm');
    els.formTitle = document.getElementById('bodyFormTitle');
    els.formMeta = document.getElementById('bodyFormMeta');
    els.deleteButton = document.getElementById('deleteBodySite');

    els.bodyCategory = document.getElementById('bodyCategory');
    els.bodyCategoryManual = document.getElementById('bodyCategoryManual');
    els.bodyStatus = document.getElementById('bodyStatus');
    els.bodyName = document.getElementById('bodyName');
    els.bodyPatientLabel = document.getElementById('bodyPatientLabel');
    els.bodySystem = document.getElementById('bodySystem');
    els.bodyCanonical = document.getElementById('bodyCanonical');
    els.bodyParent = document.getElementById('bodyParent');
    els.bodyLaterality = document.getElementById('bodyLaterality');
    els.bodyAliases = document.getElementById('bodyAliases');
    els.bodyThesaurus = document.getElementById('bodyThesaurus');
    els.bodyNotes = document.getElementById('bodyNotes');
    els.relatedSymptoms = document.getElementById('bodyRelatedSymptoms');

    els.search.addEventListener('input', () => renderBodySiteList());
    els.categoryFilter.addEventListener('change', () => renderBodySiteList());
    els.reloadButton.addEventListener('click', () => loadBodySites());
    els.createButton.addEventListener('click', () => clearForm());
    els.form.addEventListener('submit', saveBodySite);
    els.deleteButton.addEventListener('click', deleteBodySite);
    els.bodyCategory.addEventListener('change', toggleManualCategory);
  }

  async function init() {
    bindElements();
    await Promise.all([
      loadCategories(),
      loadBodySites(),
      loadSymptoms()
    ]);
  }

  if (window.NcdSessionGuard && window.NcdSessionGuard.ready) {
    window.NcdSessionGuard.ready.then(() => init()).catch(() => {});
  } else {
    document.addEventListener('DOMContentLoaded', init);
  }
})();
