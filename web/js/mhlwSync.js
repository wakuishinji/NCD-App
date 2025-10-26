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
    const entries = Object.values(data || {}).slice(0, 5);
    if (!entries.length) {
      element.textContent = 'データが読み込まれていません。`tmp/mhlw-facilities.json` を配置してください。';
      return;
    }
    element.textContent = JSON.stringify(entries, null, 2);
  }

  function toHiragana(text) {
    if (text == null) return '';
    return String(text).replace(/[ァ-ヶ]/g, (char) => {
      const code = char.charCodeAt(0);
      if (char === 'ヵ') return 'か';
      if (char === 'ヶ') return 'け';
      return String.fromCharCode(code - 0x60);
    });
  }

  function normalizeFuzzy(text) {
    if (text == null) return '';
    const hiragana = toHiragana(String(text));
    return hiragana
      .toLowerCase()
      .replace(/[０-９]/g, (digit) => String.fromCharCode(digit.charCodeAt(0) - 0xfee0))
      .replace(/[\s\u3000・･,、。;；:：\/／\\()（）［］｛｝「」『』【】<>＜＞=＋+!?？＆&\-＿―─‐〜～·・]/g, '')
      .replace(/[‐‑‒–—―]/g, '');
  }

  function tokenizeForSearch(text) {
    if (text == null) return [];
    return String(text)
      .split(/[\s\u3000・･,、。;；:：\/／\\()（）［］｛｝「」『』【】<>＜＞=＋+!?？＆&\-＿―─‐〜～·・]/)
      .map((token) => normalizeFuzzy(token))
      .filter(Boolean);
  }

  function buildFacilitySearchCache(facility) {
    const stringSet = new Set();
    if (facility && typeof facility === 'object') {
      for (const key of Object.keys(facility)) {
        const value = facility[key];
        if (typeof value === 'string' && value.trim()) {
          stringSet.add(value.trim());
        }
      }
    }
    const normalizedStrings = [];
    const tokenSet = new Set();
    for (const value of stringSet) {
      const normalized = normalizeFuzzy(value);
      if (normalized) normalizedStrings.push(normalized);
      tokenizeForSearch(value).forEach((token) => {
        if (token) tokenSet.add(token);
      });
    }
    return {
      normalizedStrings,
      tokens: tokenSet,
      facilityIdUpper: (facility?.facilityId || '').toString().toUpperCase(),
    };
  }

  function pickFacilityDisplayName(facility) {
    const candidates = [
      facility?.prefecture,
      facility?.city,
      facility?.officialName,
      facility?.name,
      facility?.corporationName,
    ];
    for (const value of candidates) {
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }
    }
    return (facility?.facilityId || '').toString() || '名称未設定';
  }

  function pickFacilityAddress(facility) {
    const candidates = [
      facility?.fullAddress,
      facility?.address,
      facility?.location,
      facility?.phone,
      facility?.prefectureAddress,
    ];
    for (const value of candidates) {
      if (typeof value !== 'string') continue;
      const trimmed = value.trim();
      if (!trimmed) continue;
      if (trimmed === '0.0') continue;
      if (/^\d[\d\-]+$/.test(trimmed)) continue;
      if (/[都道府県市区町村郡町村村丁目番地]/.test(trimmed) || /[0-9０-９]/.test(trimmed)) {
        return trimmed;
      }
    }
    return '';
  }

  function describeMatchLevel(score) {
    if (score >= 180) return '一致度: 非常に高';
    if (score >= 120) return '一致度: 高';
    if (score >= 80) return '一致度: 中';
    return '一致度: 参考';
  }

  function findMhlwCandidates({ entries, clinic, query, limit = 8 }) {
    if (!Array.isArray(entries) || !entries.length) return [];

    const trimmedQuery = (query || '').trim();
    const normalizedQuery = normalizeFuzzy(trimmedQuery);
    const normalizedQueryTokens = tokenizeForSearch(trimmedQuery);
    const numericQuery = trimmedQuery.replace(/\s+/g, '').toUpperCase();

    const clinicNameNorm = normalizeFuzzy(clinic?.name || clinic?.displayName || clinic?.officialName || '');
    const clinicNameTokens = tokenizeForSearch(clinic?.name || clinic?.displayName || clinic?.officialName || '');
    const clinicAddressTokens = tokenizeForSearch(clinic?.address || '');

    const results = [];

    for (const facility of entries) {
      if (!facility) continue;
      let cache = facility.__searchCache;
      if (!cache) {
        cache = buildFacilitySearchCache(facility);
        Object.defineProperty(facility, '__searchCache', {
          value: cache,
          enumerable: false,
          configurable: false,
          writable: false,
        });
      }

      let score = 0;

      if (numericQuery) {
        if (cache.facilityIdUpper === numericQuery) {
          score += 250;
        } else if (cache.facilityIdUpper.startsWith(numericQuery)) {
          const diff = Math.max(1, cache.facilityIdUpper.length - numericQuery.length);
          score += 150 - diff * 8;
        }
      }

      if (normalizedQuery) {
        for (const value of cache.normalizedStrings) {
          if (!value) continue;
          if (value === normalizedQuery) {
            score += 140;
            break;
          }
          if (value.includes(normalizedQuery)) {
            const ratio = normalizedQuery.length / Math.max(value.length, 1);
            score += Math.max(30, Math.min(100, Math.floor(ratio * 100)));
            break;
          }
        }
        if (score === 0 && normalizedQueryTokens.length) {
          let tokenMatches = 0;
          for (const token of normalizedQueryTokens) {
            if (token.length < 2) continue;
            if (cache.tokens.has(token)) tokenMatches += 1;
          }
          if (tokenMatches) score += 30 * tokenMatches;
        }
      }

      if (!normalizedQuery && clinicNameNorm && cache.normalizedStrings.some((value) => value.includes(clinicNameNorm))) {
        score += 60;
      }

      if (clinicNameTokens.length) {
        let matched = 0;
        for (const token of clinicNameTokens) {
          if (token.length < 2) continue;
          if (cache.tokens.has(token)) matched += 1;
        }
        if (matched) score += 25 * matched;
      }

      if (clinicAddressTokens.length) {
        let matched = 0;
        for (const token of clinicAddressTokens) {
          if (token.length < 2) continue;
          if (cache.tokens.has(token)) matched += 1;
        }
        if (matched) score += 15 * matched;
      }

      if (score === 0 && normalizedQuery) {
        const short = normalizedQuery.slice(0, Math.min(6, normalizedQuery.length));
        if (short.length >= 2 && cache.normalizedStrings.some((value) => value.includes(short))) {
          score = 12;
        }
      }

      if (score === 0 && clinicNameNorm) {
        const short = clinicNameNorm.slice(0, Math.min(6, clinicNameNorm.length));
        if (short.length >= 2 && cache.normalizedStrings.some((value) => value.includes(short))) {
          score = 12;
        }
      }

      if (score <= 0) continue;
      results.push({ facility, score });
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }

  function buildClinicCard(clinic, mhlwSource) {
    const dict = (mhlwSource && mhlwSource.dict) || mhlwSource || {};
    const entries = Array.isArray(mhlwSource?.entries)
      ? mhlwSource.entries
      : (dict && typeof dict === 'object' ? Object.values(dict) : []);

    const wrapper = document.createElement('div');
    wrapper.className = 'rounded border border-slate-200 bg-white p-4 shadow-sm';

    const clinicTypeLabel = clinic.facilityType === 'hospital'
      ? '病院'
      : clinic.facilityType === 'clinic'
        ? '診療所'
        : clinic.facilityType || '未設定';

    const currentFacilityIdRaw = (clinic.mhlwFacilityId || '').toString().trim();
    const currentFacilityId = currentFacilityIdRaw.toUpperCase();

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
        <div>厚労省ID: <span class="font-semibold">${currentFacilityId || '未設定'}</span></div>
        <div>最終更新: ${clinic.updated_at ? new Date(clinic.updated_at * 1000).toISOString().slice(0, 19) : '-'}</div>
      </div>
    `;
    wrapper.appendChild(title);

    const form = document.createElement('form');
    form.className = 'mt-4 grid gap-3 md:grid-cols-2';
    form.innerHTML = `
      <div>
        <label class="block text-sm font-medium text-slate-700" for="facilityId-${clinic.id}">厚労省施設ID</label>
        <input id="facilityId-${clinic.id}" name="facilityId" type="text" value="${currentFacilityId}" class="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm" placeholder="例: 1311400001" required />
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

    const lookupFacility = (facilityId) => {
      if (!facilityId) return null;
      const normalized = facilityId.toUpperCase();
      return dict[normalized] || dict[facilityId] || null;
    };

    const mhlwInfo = lookupFacility(currentFacilityId);
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
          <div><dt class="font-medium">名称</dt><dd>${pickFacilityDisplayName(mhlwInfo)}</dd></div>
          <div><dt class="font-medium">住所</dt><dd>${pickFacilityAddress(mhlwInfo) || '-'}</dd></div>
          <div><dt class="font-medium">種別</dt><dd>${mhlwTypeLabel}</dd></div>
          <div><dt class="font-medium">郵便番号</dt><dd>${mhlwInfo.postalCode || '-'}</dd></div>
        </dl>
      `;
      wrapper.appendChild(box);
    }

    const statusEl = form.querySelector('[data-status]');
    const facilityIdInput = form.querySelector('input[name="facilityId"]');

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      statusEl.textContent = '';
      statusEl.className = 'md:col-span-2 text-xs text-slate-500';
      const rawValue = (facilityIdInput.value || '').trim();
      if (!rawValue) {
        statusEl.textContent = '厚労省施設IDを入力してください。';
        statusEl.classList.add('text-red-600');
        return;
      }
      const facilityId = rawValue.toUpperCase();
      facilityIdInput.value = facilityId;
      const apiBase = resolveApiBase();
      const authHeader = await getAuthHeader();
      try {
        await fetchJson(`${apiBase}/api/updateClinic`, {
          method: 'POST',
          headers: authHeader ? { Authorization: authHeader } : {},
          body: { name: clinic.name, mhlwFacilityId: facilityId },
        });
        statusEl.textContent = '厚労省IDを登録しました。再読み込みしてください。';
        statusEl.className = 'md:col-span-2 text-xs text-emerald-600';
      } catch (error) {
        console.error('[mhlwSync] failed to update clinic', error);
        statusEl.textContent = error?.payload?.message || error.message || '更新に失敗しました。';
        statusEl.className = 'md:col-span-2 text-xs text-red-600';
      }
    });

    const syncButton = form.querySelector('[data-action="sync"]');
    if (syncButton) {
      syncButton.addEventListener('click', async () => {
        statusEl.textContent = '';
        statusEl.className = 'md:col-span-2 text-xs text-slate-500';
        const facilityId = (facilityIdInput.value || '').trim().toUpperCase();
        if (!facilityId) {
          statusEl.textContent = 'まず厚労省IDを登録してください。';
          statusEl.classList.add('text-red-600');
          return;
        }
        const facility = lookupFacility(facilityId);
        if (!facility) {
          statusEl.textContent = `厚労省データにID ${facilityId} が見つかりません。CSVが最新か確認してください。`;
          statusEl.classList.add('text-red-600');
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
          statusEl.className = 'md:col-span-2 text-xs text-emerald-600';
        } catch (error) {
          console.error('[mhlwSync] sync failed', error);
          statusEl.textContent = error?.payload?.message || error.message || '同期に失敗しました。';
          statusEl.className = 'md:col-span-2 text-xs text-red-600';
        }
      });
    }

    const candidateSection = document.createElement('div');
    candidateSection.className = 'mt-4 space-y-3 rounded border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600';

    const candidateHeader = document.createElement('div');
    candidateHeader.className = 'flex flex-col gap-1';
    const candidateTitle = document.createElement('span');
    candidateTitle.className = 'text-sm font-semibold text-slate-700';
    candidateTitle.textContent = '厚労省データ候補';
    candidateHeader.appendChild(candidateTitle);
    const candidateHint = document.createElement('p');
    candidateHint.textContent = '施設名・住所・厚労省IDで候補を検索し、入力欄にセットできます。';
    candidateHeader.appendChild(candidateHint);
    candidateSection.appendChild(candidateHeader);

    const candidateControls = document.createElement('div');
    candidateControls.className = 'flex flex-col gap-2 md:flex-row md:items-end';

    const candidateInputWrap = document.createElement('div');
    candidateInputWrap.className = 'flex-1';
    const candidateLabel = document.createElement('label');
    candidateLabel.className = 'block text-xs font-medium text-slate-600';
    candidateLabel.textContent = '候補検索キーワード';
    candidateInputWrap.appendChild(candidateLabel);
    const candidateInput = document.createElement('input');
    candidateInput.type = 'text';
    candidateInput.className = 'mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm';
    candidateInput.placeholder = '施設名・住所・厚労省IDで検索';
    candidateInputWrap.appendChild(candidateInput);
    candidateControls.appendChild(candidateInputWrap);

    const candidateButtons = document.createElement('div');
    candidateButtons.className = 'flex gap-2';

    const searchButton = document.createElement('button');
    searchButton.type = 'button';
    searchButton.className = 'inline-flex items-center gap-2 rounded bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700';
    searchButton.textContent = '候補を検索';
    candidateButtons.appendChild(searchButton);

    const resetButton = document.createElement('button');
    resetButton.type = 'button';
    resetButton.className = 'inline-flex items-center gap-2 rounded border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-800 transition hover:border-blue-300 hover:bg-blue-100';
    resetButton.textContent = 'NCD名称で再検索';
    candidateButtons.appendChild(resetButton);

    candidateControls.appendChild(candidateButtons);
    candidateSection.appendChild(candidateControls);

    const candidateList = document.createElement('div');
    candidateList.className = 'space-y-2';
    candidateSection.appendChild(candidateList);

    wrapper.appendChild(candidateSection);

    const defaultKeyword = [
      clinic.name,
      clinic.displayName,
      clinic.officialName,
      clinic.shortName,
      clinic.address,
    ]
      .map((value) => (typeof value === 'string' ? value.trim() : ''))
      .find((value) => Boolean(value)) || '';

    candidateInput.value = defaultKeyword;

    function highlightCandidate(element) {
      candidateList.querySelectorAll('[data-candidate]').forEach((node) => {
        node.classList.remove('ring-2', 'ring-blue-200');
      });
      if (element) {
        element.classList.add('ring-2', 'ring-blue-200');
      }
    }

    function renderCandidates(keyword) {
      candidateList.innerHTML = '';
      if (!Array.isArray(entries) || !entries.length) {
        const empty = document.createElement('p');
        empty.className = 'text-xs text-red-600';
        empty.textContent = '厚労省データが読み込まれていません。CSVを再読込してください。';
        candidateList.appendChild(empty);
        return;
      }
      const searchKeyword = (keyword || '').trim() || defaultKeyword;
      if (!searchKeyword) {
        const empty = document.createElement('p');
        empty.className = 'text-xs text-slate-500';
        empty.textContent = '検索キーワードを入力すると候補が表示されます。';
        candidateList.appendChild(empty);
        return;
      }
      const results = findMhlwCandidates({ entries, clinic, query: searchKeyword, limit: 8 });
      if (!results.length) {
        const empty = document.createElement('p');
        empty.className = 'text-xs text-slate-500';
        empty.textContent = '候補が見つかりませんでした。キーワードを調整してください。';
        candidateList.appendChild(empty);
        return;
      }

      results.forEach(({ facility, score }) => {
        const item = document.createElement('div');
        item.className = 'rounded border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600 transition';
        item.dataset.candidate = 'true';

        const header = document.createElement('div');
        header.className = 'flex flex-wrap items-center justify-between gap-2';

        const nameEl = document.createElement('div');
        nameEl.className = 'text-sm font-semibold text-slate-800';
        nameEl.textContent = pickFacilityDisplayName(facility);
        header.appendChild(nameEl);

        const idBadge = document.createElement('span');
        idBadge.className = 'rounded bg-blue-100 px-2 py-0.5 text-[11px] font-semibold text-blue-700';
        idBadge.textContent = facility.facilityId || '-';
        header.appendChild(idBadge);

        item.appendChild(header);

        const addressText = pickFacilityAddress(facility);
        if (addressText) {
          const addressEl = document.createElement('p');
          addressEl.className = 'mt-1 text-xs text-slate-600';
          addressEl.textContent = addressText;
          item.appendChild(addressEl);
        }

        const metaLine = document.createElement('div');
        metaLine.className = 'mt-1 text-[11px] text-slate-500';
        const typeLabel = facility.facilityType === 'hospital'
          ? '病院'
          : facility.facilityType === 'clinic'
            ? '診療所'
            : facility.facilityType || '-';
        metaLine.textContent = `種別: ${typeLabel} / 郵便番号: ${facility.postalCode || '-'}`;
        item.appendChild(metaLine);

        const actions = document.createElement('div');
        actions.className = 'mt-2 flex flex-wrap items-center gap-3';

        const scoreLabel = document.createElement('span');
        scoreLabel.className = 'text-[11px] text-slate-500';
        scoreLabel.textContent = describeMatchLevel(score);
        actions.appendChild(scoreLabel);

        const applyButton = document.createElement('button');
        applyButton.type = 'button';
        applyButton.className = 'inline-flex items-center gap-2 rounded bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700';
        applyButton.textContent = 'このIDをセット';
        applyButton.addEventListener('click', () => {
          const facilityId = (facility.facilityId || '').toUpperCase();
          facilityIdInput.value = facilityId;
          facilityIdInput.focus();
          highlightCandidate(item);
          statusEl.textContent = `候補ID ${facilityId} を入力欄にセットしました。保存ボタンで確定してください。`;
          statusEl.className = 'md:col-span-2 text-xs text-blue-600';
        });
        actions.appendChild(applyButton);

        item.addEventListener('dblclick', () => applyButton.click());

        item.appendChild(actions);
        candidateList.appendChild(item);
      });
    }

    searchButton.addEventListener('click', () => {
      renderCandidates(candidateInput.value);
    });

    resetButton.addEventListener('click', () => {
      candidateInput.value = defaultKeyword;
      renderCandidates(defaultKeyword);
    });

    candidateInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        renderCandidates(candidateInput.value);
      }
    });

    renderCandidates(candidateInput.value);

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
    let mhlwEntries = [];

    async function loadDictAndPreview(force = false) {
      if (force) {
        try {
          localStorage.removeItem(LOCAL_CACHE_KEY);
          localStorage.removeItem(LOCAL_CACHE_TS_KEY);
        } catch (_) {}
      }
      mhlwDict = await loadMhlwFacilities();
      mhlwEntries = mhlwDict && typeof mhlwDict === 'object' ? Object.values(mhlwDict) : [];
      renderMhlwPreview(mhlwDict, previewEl);
    }

    loadDictAndPreview(false);

    reloadBtn?.addEventListener('click', () => {
      if (previewEl) {
        previewEl.textContent = 'CSVを再読込しています…';
      }
      loadDictAndPreview(true);
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
          clinicList.appendChild(buildClinicCard(clinic, { dict: mhlwDict, entries: mhlwEntries }));
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
