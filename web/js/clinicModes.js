(function () {
  const BASE = 'https://ncd-app.altry.workers.dev';

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
    icon: null,
    color: null,
    order: null,
    tags: null,
    active: null,
    reset: null,
  };

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
    const res = await fetch(`${BASE}${path}`, init);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status} ${text}`);
    }
    return res.json();
  }

  function renderTable() {
    if (!els.tableBody) return;
    if (!Array.isArray(state.modes) || !state.modes.length) {
      els.tableBody.innerHTML = '<tr><td colspan="8" class="px-3 py-4 text-center text-sm text-slate-500">まだ登録されていません</td></tr>';
      return;
    }
    els.tableBody.innerHTML = state.modes.map((mode) => {
      const statusDot = mode.active !== false
        ? '<span class="inline-flex h-2 w-2 rounded-full bg-emerald-500"></span>'
        : '<span class="inline-flex h-2 w-2 rounded-full bg-slate-400"></span>';
      const colorPreview = mode.color ? `<span class="inline-flex h-4 w-4 rounded-full border border-slate-200" style="background:${mode.color}"></span>` : '';
      const tags = Array.isArray(mode.tags) && mode.tags.length ? mode.tags.join(', ') : '';
      return `
        <tr class="${mode.active !== false ? '' : 'bg-slate-50'}">
          <td class="px-3 py-2 align-top">
            <div class="flex items-center gap-2 text-sm text-blue-900 font-semibold">${statusDot}<span>${mode.label || ''}</span></div>
            ${mode.description ? `<div class="mt-1 text-xs text-slate-500">${mode.description}</div>` : ''}
          </td>
          <td class="px-3 py-2 text-xs text-slate-500 align-top">${mode.id || ''}</td>
          <td class="px-3 py-2 text-xs text-slate-600 align-top">${mode.description || ''}</td>
          <td class="px-3 py-2 text-xs text-slate-600 align-top">${mode.icon || ''}</td>
          <td class="px-3 py-2 text-xs text-slate-600 align-top">${colorPreview} ${mode.color || ''}</td>
          <td class="px-3 py-2 text-xs text-slate-600 align-top">${Number.isFinite(mode.order) ? mode.order : ''}</td>
          <td class="px-3 py-2 text-xs text-slate-600 align-top">${tags}</td>
          <td class="px-3 py-2 text-xs text-blue-700 align-top">
            <button type="button" data-mode-edit="${mode.id}" class="rounded bg-blue-50 px-3 py-1 font-semibold text-blue-700 hover:bg-blue-100">編集</button>
            <button type="button" data-mode-delete="${mode.id}" class="ml-2 rounded bg-red-50 px-3 py-1 font-semibold text-red-600 hover:bg-red-100">削除</button>
          </td>
        </tr>
      `;
    }).join('');
  }

  function resetForm() {
    state.editing = null;
    if (!els.form) return;
    els.form.reset();
    if (els.id) els.id.value = '';
    if (els.active) els.active.checked = true;
    if (els.tags) els.tags.value = '';
    if (els.order) els.order.value = '';
    if (els.color) els.color.value = '';
    if (els.icon) els.icon.value = '';
    if (els.description) els.description.value = '';
    if (els.slug) els.slug.value = '';
    if (els.label) els.label.focus();
  }

  function fillForm(mode) {
    state.editing = mode.id;
    if (els.id) els.id.value = mode.id || '';
    if (els.label) els.label.value = mode.label || '';
    if (els.slug) els.slug.value = mode.id || '';
    if (els.description) els.description.value = mode.description || '';
    if (els.icon) els.icon.value = mode.icon || '';
    if (els.color) els.color.value = mode.color || '';
    if (els.order) els.order.value = Number.isFinite(mode.order) ? mode.order : '';
    if (els.tags) els.tags.value = Array.isArray(mode.tags) ? mode.tags.join(', ') : '';
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
      }
    });
  }

  async function loadModes() {
    await withLoading('診療形態を読み込み中...', async () => {
      const data = await fetchJson('/api/modes');
      state.modes = Array.isArray(data?.modes) ? data.modes : [];
      renderTable();
    });
  }

  async function saveMode(payload) {
    const path = state.editing ? '/api/modes/update' : '/api/modes/add';
    await withLoading('保存しています...', async () => {
      const res = await fetch(`${BASE}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok || data?.ok === false) {
        throw new Error(data?.error || `HTTP ${res.status}`);
      }
      showToast('保存しました');
      resetForm();
      await loadModes();
    });
  }

  async function deleteMode(slug) {
    await withLoading('削除しています...', async () => {
      const res = await fetch(`${BASE}/api/modes/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: slug })
      });
      const data = await res.json();
      if (!res.ok || data?.ok === false) {
        throw new Error(data?.error || `HTTP ${res.status}`);
      }
      showToast('削除しました');
      if (state.editing === slug) {
        resetForm();
      }
      await loadModes();
    });
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
    const icon = nk(els.icon?.value);
    const color = nk(els.color?.value);
    const orderValue = nk(els.order?.value);
    const order = orderValue ? Number(orderValue) : null;
    const tagsValue = nk(els.tags?.value);
    const tags = tagsValue ? tagsValue.split(',').map((item) => nk(item)).filter(Boolean) : [];
    const active = Boolean(els.active?.checked);

    const payload = {
      label,
      description,
      icon,
      color,
      order: Number.isFinite(order) ? order : null,
      tags,
      active,
    };
    if (state.editing) {
      payload.id = state.editing;
    } else if (slugInput) {
      payload.id = slugInput.toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
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
    els.icon = document.getElementById('modeIcon');
    els.color = document.getElementById('modeColor');
    els.order = document.getElementById('modeOrder');
    els.tags = document.getElementById('modeTags');
    els.active = document.getElementById('modeActive');
    els.reset = document.getElementById('modeReset');

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
