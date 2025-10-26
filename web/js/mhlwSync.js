(function setupMhlwSync(global) {
  const DEFAULT_API_BASE = 'https://ncd-app.altry.workers.dev';
  const LOCAL_CACHE_KEY = 'mhlwFacilityCache';
  const LOCAL_CACHE_TS_KEY = 'mhlwFacilityCacheTimestamp';
  const LOCAL_CACHE_TTL_MS = 1000 * 60 * 60; // 1 hour

  function resolveApiBase() {
    if (global.NcdAuth && typeof global.NcdAuth.resolveApiBase === 'function') {
      return global.NcdAuth.resolveApiBase();
    }
    return DEFAULT_API_BASE;
  }

  async function fetchJson(url, options = {}) {
    const headers = new Headers(options.headers || {});
    if (!headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    const init = { ...options, headers };
    if (init.body && typeof init.body !== 'string') {
      init.body = JSON.stringify(init.body);
    }
    const res = await fetch(url, init);
    if (!res.ok) {
      const errPayload = await res.json().catch(() => ({}));
      const error = new Error(errPayload.message || `Request failed: ${res.status}`);
      error.payload = errPayload;
      error.status = res.status;
      throw error;
    }
    if (res.status === 204) return null;
    return res.json();
  }

  async function getAuthHeader() {
    if (global.NcdAuth && typeof global.NcdAuth.getAuthHeader === 'function') {
      return global.NcdAuth.getAuthHeader();
    }
    return undefined;
  }

  function loadCachedMhlwData() {
    try {
      const ts = Number(localStorage.getItem(LOCAL_CACHE_TS_KEY) || '0');
      if (!ts || Date.now() - ts > LOCAL_CACHE_TTL_MS) {
        return null;
      }
      const raw = localStorage.getItem(LOCAL_CACHE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (_) {
      return null;
    }
  }

  function storeCachedMhlwData(data) {
    try {
      localStorage.setItem(LOCAL_CACHE_KEY, JSON.stringify(data));
      localStorage.setItem(LOCAL_CACHE_TS_KEY, String(Date.now()));
    } catch (_) {}
  }

  async function loadMhlwFacilities() {
    const cached = loadCachedMhlwData();
    if (cached) return cached;

    try {
      const res = await fetch('/tmp/mhlw-facilities.json');
      if (!res.ok) throw new Error('MHLW facilities JSON not found.');
      const data = await res.json();
      const facilities = Array.isArray(data?.facilities) ? data.facilities : data;
      const map = new Map();
      for (const entry of facilities) {
        if (!entry?.facilityId) continue;
        map.set(entry.facilityId.toUpperCase(), entry);
      }
      const jsonable = Array.from(map.entries()).reduce((acc, [key, value]) => {
        acc[key] = value;
        return acc;
      }, {});
      storeCachedMhlwData(jsonable);
      return jsonable;
    } catch (err) {
      console.warn('[mhlwSync] failed to load facilities JSON', err);
      return {};
    }
  }

  function renderMhlwPreview(data, element) {
    if (!element) return;
    const entries = Object.values(data).slice(0, 5);
    if (!entries.length) {
      element.textContent = 'データが読み込まれていません。`tmp/mhlw-facilities.json` を配置してください。';
      return;
    }
    element.textContent = JSON.stringify(entries, null, 2);
  }

  function buildClinicCard(clinic, mhlwDict) {
    const wrapper = document.createElement('div');
    wrapper.className = 'rounded border border-slate-200 bg-white p-4 shadow-sm';

    const clinicTypeLabel = clinic.facilityType === 'hospital'
      ? '病院'
      : clinic.facilityType === 'clinic'
        ? '診療所'
        : clinic.facilityType || '未設定';

    const title = document.createElement('div');
    title.className = 'flex items-start justify-between gap-3';
    title.innerHTML = `
      <div>
        <h3 class="text-lg font-semibold text-slate-900 flex items-center gap-2">
          <span>${clinic.name || '名称未設定'}</span>
          <span class="rounded bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">${clinicTypeLabel}</span>
        </h3>
        <p class="text-xs text-slate-500">ID: ${clinic.id || '未設定'}</p>
      </div>
      <div class="text-xs text-slate-500 text-right">
        <div>厚労省ID: <span class="font-semibold">${clinic.mhlwFacilityId || '未設定'}</span></div>
        <div>最終更新: ${clinic.updated_at ? new Date(clinic.updated_at * 1000).toISOString().slice(0, 19) : '-'}</div>
      </div>
    `;
    wrapper.appendChild(title);

    const form = document.createElement('form');
    form.className = 'mt-4 grid gap-3 md:grid-cols-2';
    form.innerHTML = `
      <div>
        <label class="block text-sm font-medium text-slate-700" for="facilityId-${clinic.id}">厚労省施設ID</label>
        <input id="facilityId-${clinic.id}" name="facilityId" type="text" value="${clinic.mhlwFacilityId || ''}" class="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm" placeholder="例: 1311400001" required />
      </div>
      <div class="flex items-end gap-2">
        <button type="submit" class="inline-flex items-center gap-2 rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700">IDを登録</button>
        <button type="button" class="inline-flex items-center gap-2 rounded border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-800 transition hover:border-blue-300 hover:bg-blue-100" data-action="sync">公開データから同期</button>
      </div>
      <div class="md:col-span-2 text-xs text-slate-500" data-status></div>
    `;
    wrapper.appendChild(form);

    if (clinic.address) {
      const addr = document.createElement('p');
      addr.className = 'mt-3 text-sm text-slate-600';
      addr.textContent = `登録住所: ${clinic.address}`;
      wrapper.appendChild(addr);
    }

    const mhlwInfo = clinic.mhlwFacilityId ? mhlwDict?.[clinic.mhlwFacilityId] : null;
    if (mhlwInfo) {
      const mhlwTypeLabel = mhlwInfo.facilityType === 'hospital'
        ? '病院'
        : mhlwInfo.facilityType === 'clinic'
          ? '診療所'
          : mhlwInfo.facilityType || '-';
      const box = document.createElement('div');
      box.className = 'mt-3 rounded border border-dashed border-slate-200 bg-slate-50 p-3 text-xs text-slate-600';
      box.innerHTML = `
        <div class="font-semibold text-slate-700">厚労省データ概要</div>
        <dl class="mt-1 grid grid-cols-1 gap-1 sm:grid-cols-2">
          <div><dt class="font-medium">名称</dt><dd>${mhlwInfo.name || '-'}</dd></div>
          <div><dt class="font-medium">住所</dt><dd>${mhlwInfo.address || '-'}</dd></div>
          <div><dt class="font-medium">種別</dt><dd>${mhlwTypeLabel}</dd></div>
          <div><dt class="font-medium">電話</dt><dd>${mhlwInfo.phone || '-'}</dd></div>
          <div><dt class="font-medium">郵便番号</dt><dd>${mhlwInfo.postalCode || '-'}</dd></div>
        </dl>
      `;
      wrapper.appendChild(box);
    }

   form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const statusEl = form.querySelector('[data-status]');
      statusEl.textContent = '';
      const facilityIdInput = form.querySelector('input[name="facilityId"]');
      const facilityId = (facilityIdInput.value || '').trim();
      if (!facilityId) {
        statusEl.textContent = '厚労省施設IDを入力してください。';
        statusEl.className = 'text-xs text-red-600';
        return;
      }
      const apiBase = resolveApiBase();
      const authHeader = await getAuthHeader();
      try {
       await fetchJson(`${apiBase}/api/updateClinic`, {
          method: 'POST',
          headers: authHeader ? { Authorization: authHeader } : {},
          body: { name: clinic.name, mhlwFacilityId: facilityId },
        });
        statusEl.textContent = '厚労省IDを登録しました。再読み込みしてください。';
        statusEl.className = 'text-xs text-emerald-600';
      } catch (error) {
        console.error('[mhlwSync] failed to update clinic', error);
        statusEl.textContent = error?.payload?.message || error.message || '更新に失敗しました。';
        statusEl.className = 'text-xs text-red-600';
      }
    });

    form.querySelector('[data-action="sync"]').addEventListener('click', async () => {
      const statusEl = form.querySelector('[data-status]');
      statusEl.textContent = '';
      const facilityId = (form.querySelector('input[name="facilityId"]').value || '').trim().toUpperCase();
      if (!facilityId) {
        statusEl.textContent = 'まず厚労省IDを登録してください。';
        statusEl.className = 'text-xs text-red-600';
        return;
      }
      const facility = mhlwDict?.[facilityId];
      if (!facility) {
        statusEl.textContent = `厚労省データにID ${facilityId} が見つかりません。CSVが最新か確認してください。`;
        statusEl.className = 'text-xs text-red-600';
        return;
      }
      const apiBase = resolveApiBase();
      const authHeader = await getAuthHeader();
      try {
        await fetchJson(`${apiBase}/api/admin/clinic/syncFromMhlw`, {
          method: 'POST',
          headers: authHeader ? { Authorization: authHeader } : {},
          body: {
            facilityId,
            clinicId: clinic.id,
            facilityData: facility,
          },
        });
        statusEl.textContent = '厚労省データから同期しました。再読み込みしてください。';
        statusEl.className = 'text-xs text-emerald-600';
      } catch (error) {
        console.error('[mhlwSync] sync failed', error);
        statusEl.textContent = error?.payload?.message || error.message || '同期に失敗しました。';
        statusEl.className = 'text-xs text-red-600';
      }
    });

    return wrapper;
  }

  async function searchClinics(keyword) {
    const apiBase = resolveApiBase();
    const authHeader = await getAuthHeader();
    const params = new URLSearchParams();
    if (keyword) params.set('keyword', keyword);
    const url = `${apiBase}/api/listClinics?${params.toString()}`;
    const res = await fetchJson(url, {
      method: 'GET',
      headers: authHeader ? { Authorization: authHeader } : {},
    });
    return Array.isArray(res?.clinics) ? res.clinics : [];
  }

  function init() {
    const searchForm = document.getElementById('searchForm');
    const searchStatus = document.getElementById('searchStatus');
    const clinicList = document.getElementById('clinicList');
    const previewEl = document.getElementById('mhlwPreview');
    const reloadBtn = document.getElementById('reloadMhlwDict');

    if (!searchForm || !clinicList) return;

    let mhlwDict = {};

    async function loadDictAndPreview(force = false) {
      if (force) {
        try {
          localStorage.removeItem(LOCAL_CACHE_KEY);
          localStorage.removeItem(LOCAL_CACHE_TS_KEY);
        } catch (_) {}
      }
      mhlwDict = await loadMhlwFacilities();
      renderMhlwPreview(mhlwDict, previewEl);
    }

    loadDictAndPreview(false);

    reloadBtn?.addEventListener('click', () => {
      loadDictAndPreview(true).then(() => {
        if (previewEl) {
          previewEl.textContent = '再読み込みが完了しました。';
        }
      });
    });

    searchForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const keyword = document.getElementById('clinicKeyword').value.trim();
      if (!keyword) {
        searchStatus.textContent = '検索キーワードを入力してください。';
        searchStatus.className = 'text-sm text-red-600';
        return;
      }
      searchStatus.textContent = '検索中…';
      searchStatus.className = 'text-sm text-slate-500';
      clinicList.innerHTML = '';
      try {
        const clinics = await searchClinics(keyword);
        if (!clinics.length) {
          searchStatus.textContent = '該当する診療所が見つかりませんでした。';
          searchStatus.className = 'text-sm text-slate-500';
          return;
        }
        searchStatus.textContent = `${clinics.length}件ヒットしました。`; 
        searchStatus.className = 'text-sm text-slate-500';
        clinics.forEach((clinic) => {
          clinicList.appendChild(buildClinicCard(clinic, mhlwDict));
        });
      } catch (error) {
        console.error('[mhlwSync] search failed', error);
        searchStatus.textContent = error.message || '検索に失敗しました。';
        searchStatus.className = 'text-sm text-red-600';
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})(window);
