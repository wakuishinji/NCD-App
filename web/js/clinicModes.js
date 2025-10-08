(function () {
  const DEFAULT_API_BASE = 'https://ncd-app.altry.workers.dev';

  const ICON_OPTIONS = [
    { value: '', label: '（なし）' },
    { value: 'fa-video', label: 'オンライン診療（fa-video）' },
    { value: 'fa-house-medical', label: '在宅・訪問（fa-house-medical）' },
    { value: 'fa-clock', label: '時間外（fa-clock）' },
    { value: 'fa-sun', label: '休日（日中）（fa-sun）' },
    { value: 'fa-moon', label: '夜間（fa-moon）' },
    { value: 'fa-ambulance', label: '救急対応（fa-ambulance）' },
    { value: 'fa-comments', label: 'オンライン相談（fa-comments）' },
    { value: '__custom', label: 'その他（手入力）' },
  ];

  const COLOR_OPTIONS = [
    { value: '#0ea5e9', label: 'スカイブルー' },
    { value: '#22c55e', label: 'グリーン' },
    { value: '#f97316', label: 'オレンジ' },
    { value: '#6366f1', label: 'インディゴ' },
    { value: '#ec4899', label: 'ピンク' },
    { value: '#facc15', label: 'イエロー' },
    { value: '#1f2937', label: 'ダークグレー' },
    { value: '__custom', label: 'その他（手入力）' },
  ];

  const TAG_OPTIONS = [
    { value: 'telemedicine', label: 'オンライン診療' },
    { value: 'night', label: '夜間対応' },
    { value: 'holiday', label: '休日診療' },
    { value: 'home-visit', label: '訪問診療' },
    { value: 'emergency', label: '救急対応' },
    { value: 'pediatrics', label: '小児対応' },
    { value: 'chronic-care', label: '慢性疾患フォロー' },
    { value: 'specialized', label: '専門外来' },
  ];

  const ICON_LABEL_MAP = new Map(ICON_OPTIONS.filter(opt => opt.value && opt.value !== '__custom').map(opt => [opt.value, opt.label]));
  const COLOR_LABEL_MAP = new Map(COLOR_OPTIONS.filter(opt => opt.value && opt.value !== '__custom').map(opt => [opt.value, opt.label]));

  const state = {
    modes: [],
    editing: null,
  };

  const els = {
    panel: null,
    tableBody: null,
    form: null,
    id: null,
    label: null,
    slug: null,
    description: null,
    iconSelect: null,
    iconCustom: null,
    colorSelect: null,
    colorCustom: null,
    tagsSelect: null,
    active: null,
    reset: null,
  };

  function resolveApiBase() {
    if (typeof window !== 'undefined' && typeof window.API_BASE_OVERRIDE === 'string') {
      const override = window.API_BASE_OVERRIDE.trim();
      if (override) {
        return override.replace(/\/$/, '');
      }
    }
    try {
      const stored = localStorage.getItem('ncdApiBase') || localStorage.getItem('ncdApiBaseUrl');
      if (typeof stored === 'string' && stored.trim()) {
        return stored.trim().replace(/\/$/, '');
      }
    } catch (_) {}
    return DEFAULT_API_BASE;
  }

  const API_BASE = resolveApiBase();
  window.NCD_API_BASE = window.NCD_API_BASE || API_BASE;

  function apiUrl(path) {
    const normalized = path.startsWith('/') ? path : `/${path}`;
    return API_BASE ? `${API_BASE}${normalized}` : normalized;
  }

  function nk(value) {
    return (value || '').trim();
  }

  function showToast(message) {
    window.alert(message);
  }

  async function withLoading(message, runner) {
    if (typeof window.wrapWithLoading === 'function') {
      return window.wrapWithLoading(runner, message, els.panel);
    }
    return runner();
  }

  async function fetchJson(path, init) {
    const res = await fetch(apiUrl(path), init);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status} ${text}`);
    }
    return res.json();
  }

  function displayIcon(value) {
    if (!value) return '—';
    return ICON_LABEL_MAP.get(value) || value;
  }

  function displayColor(value) {
    if (!value) return '—';
    return COLOR_LABEL_MAP.get(value) || value;
  }

  function renderTable() {
    if (!els.tableBody) return;
    if (!Array.isArray(state.modes) || !state.modes.length) {
      els.tableBody.innerHTML = '<tr><td colspan="7" class="px-3 py-4 text-center text-sm text-slate-500">まだ登録されていません</td></tr>';
      return;
    }
    els.tableBody.innerHTML = state.modes.map((mode, index) => {
      const statusDot = mode.active !== false
        ? '<span class="inline-flex h-2 w-2 rounded-full bg-emerald-500"></span>'
        : '<span class="inline-flex h-2 w-2 rounded-full bg-slate-400"></span>';
      const colorPreview = mode.color ? `<span class="inline-flex h-4 w-4 rounded-full border border-slate-200" style="background:${mode.color}"></span>` : '';
      const tags = Array.isArray(mode.tags) && mode.tags.length ? mode.tags.join(', ') : '';
      const orderDisplay = Number.isFinite(mode.order) ? mode.order : index;
      const disableUp = index === 0 ? 'opacity-30 cursor-not-allowed' : 'hover:bg-slate-100';
      const disableDown = index === state.modes.length - 1 ? 'opacity-30 cursor-not-allowed' : 'hover:bg-slate-100';
      return `
        <tr class="${mode.active !== false ? '' : 'bg-slate-50'}">
          <td class="px-3 py-2 align-top">
            <div class="flex items-center gap-2 text-sm text-blue-900 font-semibold">${statusDot}<span>${mode.label || ''}</span></div>
          </td>
          <td class="px-3 py-2 text-xs text-slate-600 align-top">${mode.description || ''}</td>
          <td class="px-3 py-2 text-xs text-slate-600 align-top">${displayIcon(mode.icon)}</td>
          <td class="px-3 py-2 text-xs text-slate-600 align-top">${colorPreview} ${displayColor(mode.color)}</td>
          <td class="px-3 py-2 text-xs text-slate-600 align-top">
            <div class="flex items-center gap-2">
              <button type="button" data-mode-up="${mode.id}" class="inline-flex items-center justify-center rounded border border-slate-200 bg-white px-2 text-xs ${disableUp}">▲</button>
              <button type="button" data-mode-down="${mode.id}" class="inline-flex items-center justify-center rounded border border-slate-200 bg-white px-2 text-xs ${disableDown}">▼</button>
              <span>${orderDisplay}</span>
            </div>
          </td>
          <td class="px-3 py-2 text-xs text-slate-600 align-top">${tags}</td>
          <td class="px-3 py-2 text-xs text-blue-700 align-top">
            <button type="button" data-mode-edit="${mode.id}" class="rounded bg-blue-50 px-3 py-1 font-semibold text-blue-700 hover:bg-blue-100">編集</button>
            <button type="button" data-mode-delete="${mode.id}" class="ml-2 rounded bg-red-50 px-3 py-1 font-semibold text-red-600 hover:bg-red-100">削除</button>
          </td>
        </tr>
      `;
    }).join('');
  }

  function populateSelect(selectEl, options) {
    if (!selectEl) return;
    selectEl.innerHTML = options.map(opt => `<option value="${opt.value}">${opt.label}</option>`).join('');
  }

  function toggleIconCustom(show) {
    if (!els.iconCustom) return;
    if (show) {
      els.iconCustom.classList.remove('hidden');
    } else {
      els.iconCustom.classList.add('hidden');
      els.iconCustom.value = '';
    }
  }

  function toggleColorCustom(show) {
    if (!els.colorCustom) return;
    if (show) {
      els.colorCustom.classList.remove('hidden');
    } else {
      els.colorCustom.classList.add('hidden');
      els.colorCustom.value = '';
    }
  }

  function setIconValue(value) {
    if (!els.iconSelect) return;
    const optionValues = ICON_OPTIONS.map(opt => opt.value);
    if (value && !optionValues.includes(value)) {
      els.iconSelect.value = '__custom';
      if (els.iconCustom) {
        els.iconCustom.value = value;
        toggleIconCustom(true);
      }
    } else {
      els.iconSelect.value = value || '';
      toggleIconCustom(false);
    }
  }

  function getIconValue() {
    if (!els.iconSelect) return '';
    if (els.iconSelect.value === '__custom') {
      return nk(els.iconCustom?.value);
    }
    return nk(els.iconSelect.value);
  }

  function setColorValue(value) {
    if (!els.colorSelect) return;
    const optionValues = COLOR_OPTIONS.map(opt => opt.value);
    if (value && !optionValues.includes(value)) {
      els.colorSelect.value = '__custom';
      if (els.colorCustom) {
        els.colorCustom.value = value;
        toggleColorCustom(true);
      }
    } else {
      els.colorSelect.value = value && optionValues.includes(value) ? value : '#0ea5e9';
      toggleColorCustom(false);
    }
  }

  function getColorValue() {
    if (!els.colorSelect) return '';
    if (els.colorSelect.value === '__custom') {
      return nk(els.colorCustom?.value);
    }
    return nk(els.colorSelect.value);
  }

  function setTagsValue(tags) {
    if (!els.tagsSelect) return;
    const existing = new Set(Array.from(els.tagsSelect.options).map(opt => opt.value));
    tags.forEach((tag) => {
      if (tag && !existing.has(tag)) {
        const option = document.createElement('option');
        option.value = tag;
        option.textContent = tag;
        option.selected = true;
        els.tagsSelect.appendChild(option);
        existing.add(tag);
      }
    });
    Array.from(els.tagsSelect.options).forEach((option) => {
      option.selected = tags.includes(option.value);
    });
  }

  function getSelectedTags() {
    if (!els.tagsSelect) return [];
    return Array.from(els.tagsSelect.selectedOptions).map(option => option.value).filter(Boolean);
  }

  function resetForm() {
    state.editing = null;
    if (!els.form) return;
    els.form.reset();
    if (els.id) els.id.value = '';
    if (els.active) els.active.checked = true;
    if (els.iconSelect) {
      els.iconSelect.value = '';
      toggleIconCustom(false);
    }
    if (els.colorSelect) {
      els.colorSelect.value = '#0ea5e9';
      toggleColorCustom(false);
    }
    if (els.tagsSelect) {
      Array.from(els.tagsSelect.options).forEach(option => {
        option.selected = false;
      });
    }
    if (els.slug) els.slug.value = '';
    if (els.description) els.description.value = '';
    if (els.label) els.label.focus();
  }

  function fillForm(mode) {
    state.editing = mode.id;
    if (els.id) els.id.value = mode.id || '';
    if (els.label) els.label.value = mode.label || '';
    if (els.slug) els.slug.value = mode.id || '';
    if (els.description) els.description.value = mode.description || '';
    setIconValue(mode.icon || '');
    setColorValue(mode.color || '');
    setTagsValue(Array.isArray(mode.tags) ? mode.tags : []);
    if (els.active) els.active.checked = mode.active !== false;
    if (els.label) els.label.focus();
  }

  function bindTableActions() {
    if (!els.tableBody) return;
    els.tableBody.addEventListener('click', (event) => {
      const editBtn = event.target.closest('[data-mode-edit]');
      if (editBtn) {
        const slug = editBtn.getAttribute('data-mode-edit');
        const mode = state.modes.find((item) => item.id === slug);
        if (mode) {
          fillForm(mode);
        }
        return;
      }
      const deleteBtn = event.target.closest('[data-mode-delete]');
      if (deleteBtn) {
        const slug = deleteBtn.getAttribute('data-mode-delete');
        if (window.confirm('この診療形態を削除しますか？')) {
          deleteMode(slug);
        }
        return;
      }
      const moveUpBtn = event.target.closest('[data-mode-up]');
      if (moveUpBtn) {
        const slug = moveUpBtn.getAttribute('data-mode-up');
        reorderMode(slug, -1);
        return;
      }
      const moveDownBtn = event.target.closest('[data-mode-down]');
      if (moveDownBtn) {
        const slug = moveDownBtn.getAttribute('data-mode-down');
        reorderMode(slug, 1);
      }
    });
  }

  async function loadModes({ silent = false } = {}) {
    const runner = async () => {
      const data = await fetchJson('/api/modes');
      const modes = Array.isArray(data?.modes) ? data.modes : [];
      modes.sort((a, b) => {
        const ao = Number.isFinite(a.order) ? a.order : 999;
        const bo = Number.isFinite(b.order) ? b.order : 999;
        if (ao !== bo) return ao - bo;
        return (a.label || '').localeCompare(b.label || '', 'ja');
      });
      state.modes = modes;
      renderTable();
    };
    if (silent) {
      return runner();
    }
    await withLoading('診療形態を読み込み中...', runner);
  }

  async function saveMode(payload) {
    const path = state.editing ? '/api/modes/update' : '/api/modes/add';
    await withLoading('保存しています...', async () => {
      const res = await fetch(apiUrl(path), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || data?.ok === false) {
        throw new Error(data?.error || `HTTP ${res.status}`);
      }
      showToast('保存しました');
      resetForm();
      await loadModes({ silent: true });
      renderTable();
    });
  }

  async function deleteMode(slug) {
    await withLoading('削除しています...', async () => {
      const res = await fetch(apiUrl('/api/modes/delete'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: slug }),
      });
      const data = await res.json();
      if (!res.ok || data?.ok === false) {
        throw new Error(data?.error || `HTTP ${res.status}`);
      }
      showToast('削除しました');
      if (state.editing === slug) {
        resetForm();
      }
      await loadModes({ silent: true });
      renderTable();
    });
  }

  async function reorderMode(slug, delta) {
    const index = state.modes.findIndex((item) => item.id === slug);
    if (index === -1) return;
    const targetIndex = index + delta;
    if (targetIndex < 0 || targetIndex >= state.modes.length) return;

    const reordered = [...state.modes];
    const [moved] = reordered.splice(index, 1);
    reordered.splice(targetIndex, 0, moved);
    reordered.forEach((mode, idx) => {
      mode.order = idx;
    });
    state.modes = reordered;
    renderTable();

    try {
      await withLoading('表示順を保存しています...', async () => {
        for (const mode of reordered) {
          const payload = {
            id: mode.id,
            label: mode.label || '',
            description: mode.description || '',
            icon: mode.icon || '',
            color: mode.color || '',
            order: Number.isFinite(mode.order) ? mode.order : null,
            tags: Array.isArray(mode.tags) ? mode.tags : [],
            active: mode.active !== false,
          };
          const res = await fetch(apiUrl('/api/modes/update'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          const data = await res.json();
          if (!res.ok || data?.ok === false) {
            throw new Error(data?.error || `HTTP ${res.status}`);
          }
        }
      });
      await loadModes({ silent: true });
      renderTable();
    } catch (err) {
      console.error(err);
      showToast(`表示順の更新に失敗しました: ${err.message}`);
      await loadModes({ silent: true });
      renderTable();
    }
  }

  function handleSubmit(event) {
    event.preventDefault();
    const label = nk(els.label?.value);
    if (!label) {
      showToast('表示名を入力してください');
      els.label?.focus();
      return;
    }

    const slugInput = nk(els.slug?.value);
    const description = nk(els.description?.value);
    const icon = getIconValue();
    const color = getColorValue();
    const tags = getSelectedTags();
    const active = Boolean(els.active?.checked);

    const payload = {
      label,
      description,
      icon,
      color,
      tags,
      active,
    };

    if (state.editing) {
      payload.id = state.editing;
      const current = state.modes.find((item) => item.id === state.editing);
      if (current && Number.isFinite(current.order)) {
        payload.order = current.order;
      }
    } else {
      payload.order = state.modes.length;
      if (slugInput) {
        payload.id = slugInput.toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
      }
    }

    saveMode(payload).catch((err) => {
      console.error(err);
      showToast(`保存に失敗しました: ${err.message}`);
    });
  }

  function init() {
    els.panel = document.getElementById('modePanel');
    els.tableBody = document.getElementById('modeTableBody');
    els.form = document.getElementById('modeForm');
    els.id = document.getElementById('modeId');
    els.label = document.getElementById('modeLabel');
    els.slug = document.getElementById('modeSlug');
    els.description = document.getElementById('modeDescription');
    els.iconSelect = document.getElementById('modeIconSelect');
    els.iconCustom = document.getElementById('modeIconCustom');
    els.colorSelect = document.getElementById('modeColorSelect');
    els.colorCustom = document.getElementById('modeColorCustom');
    els.tagsSelect = document.getElementById('modeTagsSelect');
    els.active = document.getElementById('modeActive');
    els.reset = document.getElementById('modeReset');

    populateSelect(els.iconSelect, ICON_OPTIONS);
    populateSelect(els.colorSelect, COLOR_OPTIONS);
    if (els.tagsSelect) {
      els.tagsSelect.innerHTML = TAG_OPTIONS.map(opt => `<option value="${opt.value}">${opt.label}</option>`).join('');
    }

    if (els.iconSelect) {
      els.iconSelect.addEventListener('change', () => {
        if (els.iconSelect.value === '__custom') {
          toggleIconCustom(true);
          els.iconCustom?.focus();
        } else {
          toggleIconCustom(false);
        }
      });
    }

    if (els.colorSelect) {
      els.colorSelect.addEventListener('change', () => {
        if (els.colorSelect.value === '__custom') {
          toggleColorCustom(true);
          els.colorCustom?.focus();
        } else {
          toggleColorCustom(false);
        }
      });
    }

    if (els.form) {
      els.form.addEventListener('submit', handleSubmit);
    }
    if (els.reset) {
      els.reset.addEventListener('click', resetForm);
    }
    bindTableActions();
    loadModes().catch((err) => {
      console.error(err);
      showToast(`診療形態の取得に失敗しました: ${err.message}`);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
