(function () {
  const DEFAULT_API_BASE = 'https://ncd-app.altry.workers.dev';

  const ICON_OPTIONS = [
    { value: '', label: '（なし）', icon: '' },
    { value: 'fa-video', label: 'オンライン診療', icon: 'fa-solid fa-video' },
    { value: 'fa-house-medical', label: '訪問診療', icon: 'fa-solid fa-house-medical' },
    { value: 'fa-clock', label: '時間外', icon: 'fa-solid fa-clock' },
    { value: 'fa-sun', label: '休日（日中）', icon: 'fa-solid fa-sun' },
    { value: 'fa-moon', label: '夜間診療', icon: 'fa-solid fa-moon' },
    { value: 'fa-ambulance', label: '救急対応', icon: 'fa-solid fa-ambulance' },
    { value: 'fa-comments', label: 'オンライン相談', icon: 'fa-solid fa-comments' },
    { value: '__custom', label: 'その他（手入力）', icon: '' },
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
    selectedIcon: '',
    selectedColor: '#0ea5e9',
    selectedTags: [],
  };

  const els = {
    panel: null,
    tableBody: null,
    form: null,
    id: null,
    label: null,
    slug: null,
    description: null,
    iconOptions: null,
    iconCustom: null,
    iconPreview: null,
    colorOptions: null,
    colorCustom: null,
    colorPreview: null,
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

  function iconOptionTemplate(option, selected) {
    const isCustom = option.value === '__custom';
    const classes = [
      'inline-flex',
      'items-center',
      'gap-2',
      'rounded',
      'border',
      'border-slate-200',
      'px-3',
      'py-2',
      'text-sm',
      'transition',
      selected ? 'bg-blue-50 border-blue-400 text-blue-700 shadow-sm' : 'bg-white hover:bg-slate-100',
    ].join(' ');
    const iconMarkup = option.icon ? `<span class="inline-flex h-8 w-8 items-center justify-center rounded-full bg-blue-50 text-blue-700"><i class="${option.icon}"></i></span>` : '<span class="inline-flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-500">—</span>';
    return `<button type="button" class="${classes}" data-icon-value="${option.value}">${iconMarkup}<span>${option.label}</span></button>`;
  }

  function colorOptionTemplate(option, selected) {
    const isCustom = option.value === '__custom';
    const classes = [
      'inline-flex',
      'items-center',
      'gap-2',
      'rounded',
      'border',
      'border-slate-200',
      'px-3',
      'py-2',
      'text-sm',
      'transition',
      selected ? 'bg-blue-50 border-blue-400 text-blue-700 shadow-sm' : 'bg-white hover:bg-slate-100',
    ].join(' ');
    const swatch = option.value && option.value !== '__custom'
      ? `<span class="inline-flex h-6 w-6 rounded-full border border-slate-200" style="background:${option.value}"></span>`
      : '<span class="inline-flex h-6 w-6 rounded-full border border-slate-200 bg-slate-100"></span>';
    return `<button type="button" class="${classes}" data-color-value="${option.value}">${swatch}<span>${option.label}</span></button>`;
  }

  function displayIcon(value) {
    if (!value) return '—';
    const label = ICON_LABEL_MAP.get(value) || value;
    const option = ICON_OPTIONS.find(opt => opt.value === value);
    const iconClass = option?.icon || `fa-solid ${value}`;
    return `<span class="inline-flex items-center gap-1"><span class="inline-flex h-7 w-7 items-center justify-center rounded-full bg-blue-50 text-blue-700"><i class="${iconClass}"></i></span><span>${label}</span></span>`;
  }

  function displayColor(value) {
    if (!value) return '—';
    const label = COLOR_LABEL_MAP.get(value) || value;
    return `<span class="inline-flex items-center gap-2"><span class="inline-flex h-5 w-5 rounded-full border border-slate-200" style="background:${value}"></span><span>${label}</span></span>`;
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
      const orderDisplay = Number.isFinite(mode.order) ? mode.order : index;
      const disableUp = index === 0;
      const disableDown = index === state.modes.length - 1;
      return `
        <tr class="${mode.active !== false ? '' : 'bg-slate-50'}">
          <td class="px-3 py-2 align-top">
            <div class="flex items-center gap-2 text-sm text-blue-900 font-semibold">${statusDot}<span>${mode.label || ''}</span></div>
            ${mode.description ? `<div class="mt-1 text-xs text-slate-500">${mode.description}</div>` : ''}
          </td>
          <td class="px-3 py-2 text-xs text-slate-600 align-top">${mode.description || '—'}</td>
          <td class="px-3 py-2 text-xs text-slate-600 align-top">${displayIcon(mode.icon)}</td>
          <td class="px-3 py-2 text-xs text-slate-600 align-top">${displayColor(mode.color)}</td>
          <td class="px-3 py-2 text-xs text-slate-600 align-top">
            <div class="flex items-center gap-2">
              <button type="button" data-mode-up="${mode.id}" class="inline-flex items-center justify-center rounded border border-slate-200 bg-white px-2 text-xs ${disableUp ? 'opacity-30 cursor-not-allowed' : 'hover:bg-slate-100'}" ${disableUp ? 'disabled' : ''}>▲</button>
              <button type="button" data-mode-down="${mode.id}" class="inline-flex items-center justify-center rounded border border-slate-200 bg-white px-2 text-xs ${disableDown ? 'opacity-30 cursor-not-allowed' : 'hover:bg-slate-100'}" ${disableDown ? 'disabled' : ''}>▼</button>
              <span>${orderDisplay}</span>
            </div>
          </td>
          <td class="px-3 py-2 text-xs text-slate-600 align-top">${Array.isArray(mode.tags) && mode.tags.length ? mode.tags.join(', ') : '—'}</td>
          <td class="px-3 py-2 text-xs text-blue-700 align-top">
            <button type="button" data-mode-edit="${mode.id}" class="rounded bg-blue-50 px-3 py-1 font-semibold text-blue-700 hover:bg-blue-100">編集</button>
            <button type="button" data-mode-delete="${mode.id}" class="ml-2 rounded bg-red-50 px-3 py-1 font-semibold text-red-600 hover:bg-red-100">削除</button>
          </td>
        </tr>
      `;
    }).join('');
  }

  function renderIconOptions() {
    if (!els.iconOptions) return;
    els.iconOptions.innerHTML = ICON_OPTIONS.map(opt => iconOptionTemplate(opt, state.selectedIcon === opt.value)).join('');
    updateIconPreview();
  }

  function renderColorOptions() {
    if (!els.colorOptions) return;
    els.colorOptions.innerHTML = COLOR_OPTIONS.map(opt => colorOptionTemplate(opt, state.selectedColor === opt.value)).join('');
    updateColorPreview();
  }

  function updateIconPreview() {
    if (!els.iconPreview) return;
    const span = els.iconPreview.querySelector('span');
    if (!span) return;
    span.innerHTML = '';
    const iconValue = getIconValue();
    if (iconValue) {
      const option = ICON_OPTIONS.find(opt => opt.value === iconValue);
      const iconClass = option?.icon || `fa-solid ${iconValue}`;
      span.innerHTML = `<i class="${iconClass}"></i>`;
    } else {
      span.textContent = '—';
    }
  }

  function updateColorPreview() {
    if (!els.colorPreview) return;
    const span = els.colorPreview.querySelector('span');
    if (!span) return;
    const colorValue = getColorValue();
    span.style.background = colorValue || '#e5e7eb';
  }

  function setIconValue(value) {
    state.selectedIcon = value || '';
    renderIconOptions();
    if (value && !ICON_OPTIONS.some(opt => opt.value === value)) {
      state.selectedIcon = '__custom';
      renderIconOptions();
      if (els.iconCustom) {
        els.iconCustom.value = value;
        els.iconCustom.classList.remove('hidden');
      }
    } else if (els.iconCustom) {
      els.iconCustom.value = '';
      if (state.selectedIcon !== '__custom') {
        els.iconCustom.classList.add('hidden');
      }
    }
    updateIconPreview();
  }

  function getIconValue() {
    if (state.selectedIcon === '__custom') {
      return nk(els.iconCustom?.value);
    }
    return state.selectedIcon;
  }

  function setColorValue(value) {
    state.selectedColor = value || '#0ea5e9';
    renderColorOptions();
    if (value && !COLOR_OPTIONS.some(opt => opt.value === value)) {
      state.selectedColor = '__custom';
      renderColorOptions();
      if (els.colorCustom) {
        els.colorCustom.value = value;
        els.colorCustom.classList.remove('hidden');
      }
    } else if (els.colorCustom) {
      els.colorCustom.value = '';
      if (state.selectedColor !== '__custom') {
        els.colorCustom.classList.add('hidden');
      }
    }
    updateColorPreview();
  }

  function getColorValue() {
    if (state.selectedColor === '__custom') {
      return nk(els.colorCustom?.value);
    }
    return state.selectedColor;
  }

  function setTagsValue(tags) {
    if (!els.tagsSelect) return;
    const existingValues = new Set(Array.from(els.tagsSelect.options).map(opt => opt.value));
    tags.forEach((tag) => {
      if (tag && !existingValues.has(tag)) {
        const option = document.createElement('option');
        option.value = tag;
        option.textContent = tag;
        option.selected = true;
        els.tagsSelect.appendChild(option);
        existingValues.add(tag);
      }
    });
    Array.from(els.tagsSelect.options).forEach((option) => {
      option.selected = tags.includes(option.value);
    });
    state.selectedTags = tags.slice();
  }

  function getSelectedTags() {
    if (!els.tagsSelect) return [];
    return Array.from(els.tagsSelect.selectedOptions).map(opt => opt.value).filter(Boolean);
  }

  function resetForm() {
    state.editing = null;
    state.selectedIcon = '';
    state.selectedColor = '#0ea5e9';
    state.selectedTags = [];
    if (!els.form) return;
    els.form.reset();
    if (els.id) els.id.value = '';
    if (els.slug) els.slug.value = '';
    if (els.description) els.description.value = '';
    if (els.active) els.active.checked = true;
    setIconValue('');
    setColorValue('#0ea5e9');
    setTagsValue([]);
    if (els.label) els.label.focus();
  }

  function fillForm(mode) {
    state.editing = mode.id;
    if (els.id) els.id.value = mode.id || '';
    if (els.label) els.label.value = mode.label || '';
    if (els.slug) els.slug.value = mode.id || '';
    if (els.description) els.description.value = mode.description || '';
    setIconValue(mode.icon || '');
    setColorValue(mode.color || '#0ea5e9');
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

  async function loadModes(opts = {}) {
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
    if (opts.silent) {
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
    } catch (err) {
      console.error(err);
      showToast(`表示順の更新に失敗しました: ${err.message}`);
      await loadModes({ silent: true });
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
    els.iconOptions = document.getElementById('modeIconOptions');
    els.iconCustom = document.getElementById('modeIconCustom');
    els.iconPreview = document.getElementById('modeIconPreview');
    els.colorOptions = document.getElementById('modeColorOptions');
    els.colorCustom = document.getElementById('modeColorCustom');
    els.colorPreview = document.getElementById('modeColorPreview');
    els.tagsSelect = document.getElementById('modeTagsSelect');
    els.active = document.getElementById('modeActive');
    els.reset = document.getElementById('modeReset');

    renderIconOptions();
    renderColorOptions();
    if (els.tagsSelect) {
      els.tagsSelect.innerHTML = TAG_OPTIONS.map(opt => `<option value="${opt.value}">${opt.label}</option>`).join('');
    }

    if (els.iconOptions) {
      els.iconOptions.addEventListener('click', (event) => {
        const button = event.target.closest('[data-icon-value]');
        if (!button) return;
        const value = button.getAttribute('data-icon-value');
        state.selectedIcon = value;
        if (value === '__custom') {
          els.iconCustom?.classList.remove('hidden');
          els.iconCustom?.focus();
        } else if (els.iconCustom) {
          els.iconCustom.classList.add('hidden');
          els.iconCustom.value = '';
        }
        renderIconOptions();
      });
    }

    if (els.colorOptions) {
      els.colorOptions.addEventListener('click', (event) => {
        const button = event.target.closest('[data-color-value]');
        if (!button) return;
        const value = button.getAttribute('data-color-value');
        state.selectedColor = value;
        if (value === '__custom') {
          els.colorCustom?.classList.remove('hidden');
          els.colorCustom?.focus();
        } else if (els.colorCustom) {
          els.colorCustom.classList.add('hidden');
          els.colorCustom.value = '';
        }
        renderColorOptions();
      });
    }

    if (els.iconCustom) {
      els.iconCustom.addEventListener('input', () => {
        updateIconPreview();
      });
    }
    if (els.colorCustom) {
      els.colorCustom.addEventListener('input', () => {
        updateColorPreview();
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
