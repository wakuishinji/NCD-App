(function () {
  const DEFAULT_API_BASE = 'https://ncd-app.altry.workers.dev';
 const COLOR_OPTIONS = [
   { value: '#0ea5e9', label: 'スカイブルー' },
   { value: '#22c55e', label: 'グリーン' },
   { value: '#f97316', label: 'オレンジ' },
   { value: '#6366f1', label: 'インディゴ' },
   { value: '#ec4899', label: 'ピンク' },
   { value: '#facc15', label: 'イエロー' },
    { value: '#1f2937', label: 'ダークグレー' },
    { value: '#0d9488', label: 'ティール' },
    { value: '#ef4444', label: 'レッド' },
    { value: '#8b5cf6', label: 'バイオレット' },
    { value: '#f472b6', label: 'ローズ' },
    { value: '#14b8a6', label: 'エメラルド' },
    { value: '#94a3b8', label: 'スレート' },
    { value: '#3f6212', label: 'オリーブ' },
  ];
  const DEFAULT_COLOR = COLOR_OPTIONS[0].value;

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
    description: null,
    colorSelect: null,
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

  function buildTags(label) {
    const normalized = nk(label).normalize('NFKC').toLowerCase();
    const replaced = normalized.replace(/[\s\u3000]+/g, '-');
    const cleaned = replaced.replace(/[^a-z0-9\-一-龠ぁ-んァ-ヶー]/g, '');
    const slug = cleaned.replace(/-+/g, '-').replace(/^-|-$/g, '');
    return slug ? [slug] : [];
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

  function displayColor(value) {
    const color = value || DEFAULT_COLOR;
    const label = (COLOR_OPTIONS.find(opt => opt.value === color)?.label) || color;
    return `<span class="inline-flex items-center gap-2"><span class="inline-flex h-5 w-5 rounded-full border border-slate-200" style="background:${color}"></span><span>${label}</span></span>`;
  }

  function renderTable() {
    if (!els.tableBody) return;
    if (!Array.isArray(state.modes) || !state.modes.length) {
      els.tableBody.innerHTML = '<tr><td colspan="6" class="px-3 py-4 text-center text-sm text-slate-500">まだ登録されていません</td></tr>';
      return;
    }
    els.tableBody.innerHTML = state.modes.map((mode, index) => {
      const statusDot = mode.active !== false
        ? '<span class="inline-flex h-2 w-2 rounded-full bg-emerald-500"></span>'
        : '<span class="inline-flex h-2 w-2 rounded-full bg-slate-400"></span>';
      const orderDisplay = Number.isFinite(mode.order) ? mode.order : index;
      const disableUp = index === 0;
      const disableDown = index === state.modes.length - 1;
      const tagsText = Array.isArray(mode.tags) && mode.tags.length ? mode.tags.join(', ') : '—';
      return `
        <tr class="${mode.active !== false ? '' : 'bg-slate-50'}">
          <td class="px-3 py-2 align-top">
            <div class="flex items-center gap-2 text-sm text-blue-900 font-semibold">${statusDot}<span>${mode.label || ''}</span></div>
          </td>
          <td class="px-3 py-2 text-xs text-slate-600 align-top">${mode.description || '—'}</td>
          <td class="px-3 py-2 text-xs text-slate-600 align-top">${displayColor(mode.color)}</td>
          <td class="px-3 py-2 text-xs text-slate-600 align-top">
            <div class="flex items-center gap-2">
              <button type="button" data-mode-up="${mode.id}" class="inline-flex items-center justify-center rounded border border-slate-200 bg-white px-2 text-xs ${disableUp ? 'opacity-30 cursor-not-allowed' : 'hover:bg-slate-100'}" ${disableUp ? 'disabled' : ''}>▲</button>
              <button type="button" data-mode-down="${mode.id}" class="inline-flex items-center justify-center rounded border border-slate-200 bg-white px-2 text-xs ${disableDown ? 'opacity-30 cursor-not-allowed' : 'hover:bg-slate-100'}" ${disableDown ? 'disabled' : ''}>▼</button>
              <span>${orderDisplay}</span>
            </div>
          </td>
          <td class="px-3 py-2 text-xs text-slate-600 align-top">${tagsText}</td>
          <td class="px-3 py-2 text-xs text-blue-700 align-top">
            <button type="button" data-mode-edit="${mode.id}" class="rounded bg-blue-50 px-3 py-1 font-semibold text-blue-700 hover:bg-blue-100">編集</button>
            <button type="button" data-mode-delete="${mode.id}" class="ml-2 rounded bg-red-50 px-3 py-1 font-semibold text-red-600 hover:bg-red-100">削除</button>
          </td>
        </tr>
      `;
    }).join('');
  }

  function populateColorSelect() {
    if (!els.colorSelect) return;
    els.colorSelect.innerHTML = COLOR_OPTIONS.map(opt => `<option value="${opt.value}">${opt.label}</option>`).join('');
  }

  function setColorValue(value) {
    if (!els.colorSelect) return;
    const color = COLOR_OPTIONS.some(opt => opt.value === value) ? value : DEFAULT_COLOR;
    els.colorSelect.value = color;
  }

  function getColorValue() {
    if (!els.colorSelect) return DEFAULT_COLOR;
    const value = els.colorSelect.value;
    return value || DEFAULT_COLOR;
  }

  function resetForm() {
    state.editing = null;
    if (!els.form) return;
    els.form.reset();
    if (els.id) els.id.value = '';
    if (els.description) els.description.value = '';
    if (els.active) els.active.checked = true;
    setColorValue(DEFAULT_COLOR);
    if (els.label) els.label.focus();
  }

  function fillForm(mode) {
    state.editing = mode.id;
    if (els.id) els.id.value = mode.id || '';
    if (els.label) els.label.value = mode.label || '';
    if (els.description) els.description.value = mode.description || '';
    setColorValue(mode.color || DEFAULT_COLOR);
    if (els.active) els.active.checked = mode.active !== false;
    if (els.label) els.label.focus();
  }

  function bindTableActions() {
    if (!els.tableBody) return;
    els.tableBody.addEventListener('click', (event) => {
      const editBtn = event.target.closest('[data-mode-edit]');
      if (editBtn) {
        const slug = editBtn.getAttribute('data-mode-edit');
        const mode = state.modes.find(item => item.id === slug);
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
      const normalized = modes.map((mode) => {
        const color = typeof mode.color === 'string' && mode.color ? mode.color : DEFAULT_COLOR;
        const tags = Array.isArray(mode.tags) && mode.tags.length ? mode.tags : buildTags(mode.label || '');
        return { ...mode, color, tags };
      });
      normalized.sort((a, b) => {
        const ao = Number.isFinite(a.order) ? a.order : 999;
        const bo = Number.isFinite(b.order) ? b.order : 999;
        if (ao !== bo) return ao - bo;
        return (a.label || '').localeCompare(b.label || '', 'ja');
      });
      state.modes = normalized;
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
    const index = state.modes.findIndex(item => item.id === slug);
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
            color: mode.color || DEFAULT_COLOR,
            order: Number.isFinite(mode.order) ? mode.order : null,
            tags: Array.isArray(mode.tags) ? mode.tags : buildTags(mode.label || ''),
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

    const description = nk(els.description?.value);
    const color = getColorValue();
    const tags = buildTags(label);
    const active = Boolean(els.active?.checked);

    const payload = {
      label,
      description,
      color,
      tags,
      active,
    };

    if (state.editing) {
      payload.id = state.editing;
      const current = state.modes.find(item => item.id === state.editing);
      if (current && Number.isFinite(current.order)) {
        payload.order = current.order;
      }
    } else {
      payload.order = state.modes.length;
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
    els.description = document.getElementById('modeDescription');
    els.colorSelect = document.getElementById('modeColorSelect');
    els.active = document.getElementById('modeActive');
    els.reset = document.getElementById('modeReset');

    populateColorSelect();
    setColorValue(DEFAULT_COLOR);

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
