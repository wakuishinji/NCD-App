(function () {
  const BASE = 'https://ncd-app.altry.workers.dev';

  const state = {
    items: [],
    editing: null,
    filterType: 'service',
    filterStatus: '',
    filterSlug: '',
  };

  const els = {};

  function nk(value) {
    return (value || '').trim();
  }

  function formatDateTime(epoch) {
    if (!Number.isFinite(epoch)) return '';
    const date = new Date(epoch);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString('ja-JP', { hour12: false });
  }

  async function fetchJson(path, init) {
    const res = await fetch(`${BASE}${path}`, init);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status} ${text}`);
    }
    return res.json();
  }

  async function withLoading(message, runner) {
    if (typeof window.wrapWithLoading === 'function') {
      return window.wrapWithLoading(runner, message, els.panel);
    }
    return runner();
  }

  function renderStatusBadge(status) {
    const map = {
      draft: 'bg-amber-50 text-amber-700 border border-amber-200',
      review: 'bg-indigo-50 text-indigo-700 border border-indigo-200',
      published: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
    };
    const cls = map[status] || 'bg-slate-50 text-slate-600 border border-slate-200';
    return `<span class="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${cls}">${status || 'draft'}</span>`;
  }

  function renderTable() {
    if (!els.table) return;
    if (!Array.isArray(state.items) || !state.items.length) {
      els.table.innerHTML = '<tr><td colspan="5" class="px-3 py-4 text-center text-sm text-slate-500">該当するテンプレートがありません</td></tr>';
      return;
    }
    els.table.innerHTML = state.items.map((item) => {
      const label = item.targetSlug || '-';
      const status = renderStatusBadge(item.status);
      const updated = formatDateTime(item.updatedAt);
      const audience = item.audience || '';
      const context = item.context || '';
      return `
        <tr class="hover:bg-slate-50">
          <td class="px-3 py-2 align-top">
            <div class="text-sm font-semibold text-blue-900">${label}</div>
            <div class="text-xs text-slate-500">${item.type === 'service' ? '診療' : '検査'} / ${audience || '読者未設定'} / ${context || '用途未設定'}</div>
          </td>
          <td class="px-3 py-2 align-top">${status}</td>
          <td class="px-3 py-2 align-top text-xs text-slate-600">${item.tags && item.tags.length ? item.tags.join(', ') : ''}</td>
          <td class="px-3 py-2 align-top text-xs text-slate-600">${updated}</td>
          <td class="px-3 py-2 align-top text-xs text-blue-700">
            <button type="button" class="rounded bg-blue-50 px-3 py-1 font-semibold text-blue-700 hover:bg-blue-100" data-edit="${item.id}">編集</button>
            <button type="button" class="ml-2 rounded bg-red-50 px-3 py-1 font-semibold text-red-600 hover:bg-red-100" data-delete="${item.id}">削除</button>
          </td>
        </tr>
      `;
    }).join('');
  }

  function resetForm() {
    state.editing = null;
    els.form.reset();
    els.id.value = '';
    els.type.value = state.filterType || 'service';
    els.status.value = 'draft';
    els.tags.value = '';
    els.inherit.value = '';
    els.duplicateBtn.classList.add('hidden');
  }

  function fillForm(item) {
    state.editing = item.id;
    els.id.value = item.id || '';
    els.type.value = item.type || 'service';
    els.target.value = item.targetSlug || '';
    els.audience.value = item.audience || '';
    els.context.value = item.context || '';
    els.status.value = item.status || 'draft';
    els.tags.value = Array.isArray(item.tags) ? item.tags.join(', ') : '';
    els.inherit.value = item.inheritFrom || '';
    els.text.value = item.baseText || '';
    els.duplicateBtn.classList.remove('hidden');
    els.text.focus();
  }

  function getCurrentSlug() {
    return nk(els.filterSlug?.value);
  }

  async function loadItems() {
    const { filterType, filterStatus, filterSlug } = state;
    await withLoading('テンプレートを読み込み中...', async () => {
      const params = new URLSearchParams();
      params.set('type', filterType);
      if (filterStatus) params.set('status', filterStatus);
      if (filterSlug) params.set('targetSlug', filterSlug);
      const data = await fetchJson(`/api/explanations?${params.toString()}`);
      state.items = Array.isArray(data?.explanations) ? data.explanations : [];
      renderTable();
    });
  }

  async function saveItem(payload) {
    const path = state.editing ? '/api/explanations/update' : '/api/explanations/add';
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
      alert('保存しました');
      resetForm();
      await loadItems();
    });
  }

  async function deleteItem(id) {
    if (!window.confirm('このテンプレートを削除しますか？')) return;
    await withLoading('削除しています...', async () => {
      const res = await fetch(`${BASE}/api/explanations/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, type: state.filterType })
      });
      const data = await res.json();
      if (!res.ok || data?.ok === false) {
        throw new Error(data?.error || `HTTP ${res.status}`);
      }
      alert('削除しました');
      if (state.editing === id) {
        resetForm();
      }
      await loadItems();
    });
  }

  function handleSubmit(event) {
    event.preventDefault();
    const payload = {
      id: state.editing || undefined,
      type: els.type.value,
      targetSlug: els.target.value.trim(),
      audience: els.audience.value.trim(),
      context: els.context.value.trim(),
      status: els.status.value,
      tags: els.tags.value.split(',').map((tag) => nk(tag)).filter(Boolean),
      inheritFrom: els.inherit.value.trim() || undefined,
      baseText: els.text.value.trim(),
    };
    if (!payload.targetSlug) {
      alert('対象スラッグを入力してください');
      els.target.focus();
      return;
    }
    if (!payload.baseText) {
      alert('テンプレート本文を入力してください');
      els.text.focus();
      return;
    }
    saveItem(payload).catch((err) => {
      console.error(err);
      alert(`保存に失敗しました: ${err.message}`);
    });
  }

  function handleDuplicate() {
    if (!state.editing) return;
    const item = state.items.find((mode) => mode.id === state.editing);
    if (!item) return;
    state.editing = null;
    els.id.value = '';
    els.status.value = 'draft';
    els.text.focus();
  }

  function bindEvents() {
  const reload = () => {
    state.filterType = els.filterType.value;
    state.filterStatus = els.filterStatus.value;
    state.filterSlug = els.filterSlug.value.trim();
    loadItems().catch((err) => {
      console.error(err);
      alert(`読み込みに失敗しました: ${err.message}`);
    });
  };
  els.reloadBtn.addEventListener('click', reload);
  els.filterType.addEventListener('change', reload);
    els.table.addEventListener('click', (event) => {
      const editBtn = event.target.closest('[data-edit]');
      if (editBtn) {
        const id = editBtn.getAttribute('data-edit');
        const item = state.items.find((entry) => entry.id === id);
        if (item) {
          fillForm(item);
        }
        return;
      }
      const deleteBtn = event.target.closest('[data-delete]');
      if (deleteBtn) {
        const id = deleteBtn.getAttribute('data-delete');
        deleteItem(id).catch((err) => {
          console.error(err);
          alert(`削除に失敗しました: ${err.message}`);
        });
      }
    });
  }

  function init() {
    els.panel = document.getElementById('explanationPanel');
    els.table = document.getElementById('explanationTable');
    els.form = document.getElementById('explanationForm');
    els.id = document.getElementById('explanationId');
    els.type = document.getElementById('explanationType');
    els.target = document.getElementById('explanationTarget');
    els.audience = document.getElementById('explanationAudience');
    els.context = document.getElementById('explanationContext');
    els.status = document.getElementById('explanationStatus');
    els.tags = document.getElementById('explanationTags');
    els.inherit = document.getElementById('explanationInherit');
    els.text = document.getElementById('explanationText');
    els.reset = document.getElementById('explanationReset');
    els.duplicateBtn = document.getElementById('explanationDuplicate');
    els.filterType = document.getElementById('filterType');
    els.filterStatus = document.getElementById('filterStatus');
    els.filterSlug = document.getElementById('filterSlug');
    els.reloadBtn = document.getElementById('reloadBtn');

    state.filterType = els.filterType.value || 'service';
    state.filterStatus = els.filterStatus.value || '';
    state.filterSlug = els.filterSlug.value.trim();

    els.form.addEventListener('submit', handleSubmit);
    els.reset.addEventListener('click', () => {
      resetForm();
      loadItems().catch((err) => {
        console.error(err);
        alert(`読み込みに失敗しました: ${err.message}`);
      });
    });
    els.duplicateBtn.addEventListener('click', handleDuplicate);
    bindEvents();
    loadItems().catch((err) => {
      console.error(err);
      alert(`読み込みに失敗しました: ${err.message}`);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
