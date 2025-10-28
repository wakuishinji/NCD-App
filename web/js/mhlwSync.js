(function setupMhlwSync(global) {
  const DEFAULT_API_BASE = 'https://ncd-app.altry.workers.dev';
  const LOCAL_CACHE_KEY = 'mhlwFacilityCache';
  const LOCAL_CACHE_TS_KEY = 'mhlwFacilityCacheTimestamp';
  const LOCAL_CACHE_TTL_MS = 1000 * 60 * 60; // 1 hour
  const DEFAULT_CACHE_CONTROL = 'public, max-age=600, stale-while-revalidate=3600';
  const UTF8_DECODER = new TextDecoder('utf-8');

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

  async function parseJsonResponse(response) {
    // Mostブラウザは Content-Encoding: gzip を自動展開してくれるため、まずは素直に .json() を試す
    try {
      return await response.clone().json();
    } catch (fallbackReason) {
      console.warn('[mhlwSync] response.json() failed, trying manual decode', fallbackReason);
    }

    const encodingHeader = (response.headers.get('Content-Encoding') || '').toLowerCase();
    let isGzip = encodingHeader.includes('gzip');
    const buffer = new Uint8Array(await response.arrayBuffer());
    if (!isGzip && buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b) {
      isGzip = true;
    }

    const tryParse = (text) => {
      if (typeof text !== 'string' || !text) return null;
      try {
        return JSON.parse(text);
      } catch (err) {
        console.warn('[mhlwSync] JSON.parse failed during manual decode', err);
        return null;
      }
    };

    let text = '';

    if (isGzip && globalThis.fflate?.gunzipSync) {
      try {
        const decompressed = globalThis.fflate.gunzipSync(buffer);
        text = UTF8_DECODER.decode(decompressed);
      } catch (err) {
        console.warn('[mhlwSync] fflate gunzip failed, trying fallback', err);
      }
    }

    if (!text && isGzip && typeof DecompressionStream === 'function') {
      try {
        const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'));
        text = await new Response(stream).text();
      } catch (err) {
        console.warn('[mhlwSync] DecompressionStream gunzip failed', err);
      }
    }

    if (!text) {
      text = UTF8_DECODER.decode(buffer);
    }

    const parsed = tryParse(text);
    if (parsed !== null) {
      return parsed;
    }

    const snippet = typeof text === 'string' ? text.slice(0, 256) : '';
    const error = new Error('厚労省データの取得に失敗しました。JSON の解凍または解析ができませんでした。');
    if (snippet) {
      console.warn('[mhlwSync] API response snippet:', snippet);
      error.snippet = snippet;
    }
    throw error;
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

  function normalizeFacilitiesPayload(payload) {
    const entries = [];
    const visit = (value, depth = 0) => {
      if (depth > 3) return;
      if (!value) return;
      if (Array.isArray(value)) {
        for (const item of value) {
          visit(item, depth + 1);
        }
        return;
      }
      if (typeof value === 'object') {
        if (value.facilityId) {
          entries.push(value);
          return;
        }
        for (const key of Object.keys(value)) {
          visit(value[key], depth + 1);
        }
      }
    };
    visit(payload, 0);
    const result = {};
    for (const entry of entries) {
      if (!entry || !entry.facilityId) continue;
      result[String(entry.facilityId).toUpperCase()] = entry;
    }
    return result;
  }

  async function fetchMhlwFacilitiesFromApi({ cacheMode = 'default' } = {}) {
    const apiBase = resolveApiBase();
    const headers = new Headers();
    const authHeader = await getAuthHeader();
    if (authHeader) {
      headers.set('Authorization', authHeader);
    }
    const res = await fetch(`${apiBase}/api/mhlw/facilities`, { headers, cache: cacheMode });
    if (!res.ok) {
      const error = new Error(`Failed to fetch from API (${res.status})`);
      error.status = res.status;
      throw error;
    }
    return parseJsonResponse(res);
  }

  function shouldUseLocalFallback() {
    try {
      const { protocol, hostname } = globalThis.location || {};
      if (!protocol) return false;
      if (protocol === 'file:') return true;
      if (hostname === 'localhost' || hostname === '127.0.0.1') return true;
      if (hostname && hostname.endsWith('.local')) return true;
    } catch (_) {
      // ignore location access failures
    }
    return false;
  }

  async function fetchMhlwFacilitiesFromLocalFile() {
    const res = await fetch('/tmp/mhlw-facilities.json');
    if (!res.ok) {
      const error = new Error('Local mhlw facilities JSON not found.');
      error.status = res.status;
      throw error;
    }
    return parseJsonResponse(res);
  }

  async function loadMhlwFacilities({ bypassCache = false } = {}) {
    const cached = bypassCache ? null : loadCachedMhlwData();
    if (cached) return cached;

    let dataset = null;
    let lastError = null;

    try {
      const apiPayload = await fetchMhlwFacilitiesFromApi({ cacheMode: bypassCache ? 'reload' : 'default' });
      dataset = normalizeFacilitiesPayload(apiPayload);
    } catch (err) {
      lastError = err;
      console.warn('[mhlwSync] failed to load facilities via API', err);
    }

    const shouldFallback = shouldUseLocalFallback();
    if ((!dataset || Object.keys(dataset).length === 0) && shouldFallback) {
      try {
        const localPayload = await fetchMhlwFacilitiesFromLocalFile();
        dataset = normalizeFacilitiesPayload(localPayload);
      } catch (localErr) {
        if (!lastError) lastError = localErr;
        console.warn('[mhlwSync] failed to load facilities from local file', localErr);
      }
    }

    if (dataset && Object.keys(dataset).length) {
      const total = Object.keys(dataset).length;
      console.info('[mhlwSync] facilities dataset loaded', { total });
      storeCachedMhlwData(dataset);
      return dataset;
    }

    if (lastError) {
      console.warn('[mhlwSync] no facilities dataset available', lastError);
      const fallbackNote = shouldFallback ? 'CSV のアップロード状況をご確認のうえ再読込してください。' : 'API から厚労省施設データを取得できませんでした。Workers 側の `/api/mhlw/facilities` 応答を確認してください。';
      const error = new Error(`厚労省施設データが読み込めませんでした。${fallbackNote}`);
      error.cause = lastError;
      throw error;
    }
    return {};
  }

  function renderMhlwPreview(data, element) {
    if (!element) return;
    const entries = Object.values(data || {}).slice(0, 5);
    if (!entries.length) {
      element.textContent = '厚労省施設データが読み込めません。`CSV4種からJSONを生成してR2へアップロード` を実行するか、`scripts/uploadMhlwToR2.mjs` で更新した後に CSV再読込 を押してください。';
      return;
    }
    const previewEntries = entries.map((entry) => ({
      facilityId: entry.facilityId,
      facilityType: entry.facilityType,
      name: entry.name,
      address: entry.address,
      prefecture: entry.prefecture,
      city: entry.city,
      scheduleCount: Array.isArray(entry.scheduleEntries) ? entry.scheduleEntries.length : 0,
    }));
    element.textContent = JSON.stringify(previewEntries, null, 2);
  }

  async function fetchMhlwMeta({ cacheMode = 'default' } = {}) {
    const apiBase = resolveApiBase();
    const headers = new Headers();
    const authHeader = await getAuthHeader();
    if (authHeader) headers.set('Authorization', authHeader);
    const res = await fetch(`${apiBase}/api/mhlw/facilities/meta`, { headers, cache: cacheMode });
    if (res.status === 404) {
      return null;
    }
    if (!res.ok) {
      const error = new Error(`Failed to fetch meta (${res.status})`);
      error.status = res.status;
      error.payload = await res.json().catch(() => ({}));
      throw error;
    }
    const payload = await res.json().catch(() => null);
    if (payload && typeof payload === 'object') {
      return payload.meta || payload;
    }
    return null;
  }

  function formatBytes(bytes) {
    if (typeof bytes !== 'number' || Number.isNaN(bytes)) return '-';
    if (bytes < 1024) return `${bytes} B`;
    const kb = bytes / 1024;
    if (kb < 1024) return `${kb.toFixed(1)} KB`;
    const mb = kb / 1024;
    if (mb < 1024) return `${mb.toFixed(1)} MB`;
    return `${(mb / 1024).toFixed(1)} GB`;
  }

  function formatTimestamp(iso) {
    if (!iso) return '-';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    return new Intl.DateTimeFormat('ja-JP', {
      dateStyle: 'medium',
      timeStyle: 'medium',
      timeZone: 'Asia/Tokyo',
    }).format(date);
  }

  const DEFAULT_PART_SIZE_HINT = 8 * 1024 * 1024;

  async function prepareDirectUploadPayload(rawBytes, rawBlob) {
    if (rawBlob && typeof rawBlob.size === 'number') {
      if (typeof CompressionStream === 'function') {
        try {
          const compressionStream = new CompressionStream('gzip');
          const compressedStream = rawBlob.stream().pipeThrough(compressionStream);
          const compressedBlob = await new Response(compressedStream).blob();
          if (compressedBlob.size < rawBlob.size) {
            console.info('[mhlwSync] gzip via CompressionStream', {
              originalSize: rawBlob.size,
              compressedSize: compressedBlob.size,
            });
            return { blob: compressedBlob, gzip: true };
          }
        } catch (err) {
          console.warn('[mhlwSync] CompressionStream gzip failed, fallback to fflate', err);
        }
      }
    }

    if (rawBytes instanceof Uint8Array && globalThis.fflate?.gzipSync) {
      try {
        const compressed = globalThis.fflate.gzipSync(rawBytes);
        if (compressed && compressed.length < rawBytes.length) {
          console.info('[mhlwSync] gzip via fflate', {
            originalSize: rawBytes.length,
            compressedSize: compressed.length,
          });
          return { blob: new Blob([compressed], { type: 'application/json' }), gzip: true };
        }
      } catch (err) {
        console.warn('[mhlwSync] fflate gzip failed, using raw payload', err);
      }
    }

    return {
      blob: rawBlob || new Blob([rawBytes], { type: 'application/json' }),
      gzip: false,
    };
  }

  async function startMultipartUpload({ facilityCount, scheduleCount, gzip = false }) {
    const apiBase = resolveApiBase();
    const authHeader = await getAuthHeader();
    return fetchJson(`${apiBase}/api/admin/mhlw/initUpload`, {
      method: 'POST',
      headers: authHeader ? { Authorization: authHeader } : {},
      body: { facilityCount, scheduleCount, gzip },
    });
  }

  async function uploadPartChunk(uploadId, partNumber, chunk) {
    const apiBase = resolveApiBase();
    const authHeader = await getAuthHeader();
    const headers = new Headers();
    if (authHeader) headers.set('Authorization', authHeader);
    headers.set('Content-Type', 'application/octet-stream');
    const res = await fetch(`${apiBase}/api/admin/mhlw/uploadPart?uploadId=${encodeURIComponent(uploadId)}&partNumber=${partNumber}`, {
      method: 'PUT',
      headers,
      body: chunk,
    });
    if (!res.ok) {
      let details = '';
      let payload = null;
      try {
        payload = await res.json();
        details = payload?.message ? ` ${payload.message}` : '';
      } catch (_) {}
      const error = new Error(`part ${partNumber} のアップロードに失敗しました (HTTP ${res.status}).${details}`);
      if (payload) error.payload = payload;
      error.status = res.status;
      throw error;
    }
    return res.json();
  }

  async function completeMultipartUpload({ uploadId, parts, facilityCount, scheduleCount }) {
    const apiBase = resolveApiBase();
    const authHeader = await getAuthHeader();
    return fetchJson(`${apiBase}/api/admin/mhlw/completeUpload`, {
      method: 'POST',
      headers: authHeader ? { Authorization: authHeader } : {},
      body: { uploadId, parts, facilityCount, scheduleCount },
    });
  }

  async function uploadJsonDirect({ blob, facilityCount, scheduleCount, gzip = false }) {
    const apiBase = resolveApiBase();
    const authHeader = await getAuthHeader();
    const headers = new Headers();
    if (authHeader) headers.set('Authorization', authHeader);
    headers.set('Content-Type', 'application/json');
    headers.set('Cache-Control', DEFAULT_CACHE_CONTROL);
    if (gzip) headers.set('Content-Encoding', 'gzip');

    console.info('[mhlwSync] direct PUT upload start', {
      size: blob.size,
      facilityCount,
      scheduleCount,
    });

    const res = await fetch(`${apiBase}/api/admin/mhlw/facilities`, {
      method: 'PUT',
      headers,
      body: blob,
    });

    if (!res.ok) {
      let details = '';
      try {
        const payload = await res.json();
        details = payload?.message ? ` ${payload.message}` : '';
      } catch (_) {}
      throw new Error(`厚労省データのアップロードに失敗しました (HTTP ${res.status}).${details}`);
    }

    console.info('[mhlwSync] direct PUT upload done', res.status);

    try {
      await refreshMhlwMeta({ facilityCount, scheduleCount });
    } catch (err) {
      console.warn('[mhlwSync] failed to refresh meta after direct upload', err);
    }

    try {
      return await res.json();
    } catch (_) {
      return null;
    }
  }

  async function refreshMhlwMeta({ facilityCount, scheduleCount }) {
    const apiBase = resolveApiBase();
    const authHeader = await getAuthHeader();
    return fetchJson(`${apiBase}/api/admin/mhlw/refreshMeta`, {
      method: 'POST',
      headers: authHeader ? { Authorization: authHeader } : {},
      body: {
        facilityCount: Number.isFinite(facilityCount) ? facilityCount : null,
        scheduleCount: Number.isFinite(scheduleCount) ? scheduleCount : null,
      },
    });
  }

  async function abortMultipartUpload(uploadId) {
    if (!uploadId) return;
    try {
      const apiBase = resolveApiBase();
      const authHeader = await getAuthHeader();
      const headers = new Headers();
      if (authHeader) headers.set('Authorization', authHeader);
      await fetch(`${apiBase}/api/admin/mhlw/upload?uploadId=${encodeURIComponent(uploadId)}`, {
        method: 'DELETE',
        headers,
      });
    } catch (err) {
      console.warn('[mhlwSync] failed to abort upload', err);
    }
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

  function normalizeForSimilarity(value) {
    if (value == null) return '';
    const base = toHiragana(String(value)).toLowerCase();
    return base.replace(/[\s\u3000・･,、。;；:：\/／\\()（）［］｛｝「」『』【】<>＜＞=＋+!?？＆&\-＿―─‐〜～·・]/g, '');
  }

  function jaroWinklerDistance(a, b) {
    if (!a || !b) return 0;
    if (a === b) return 1;
    const aLen = a.length;
    const bLen = b.length;
    const matchDistance = Math.floor(Math.max(aLen, bLen) / 2) - 1;
    const aMatches = new Array(aLen).fill(false);
    const bMatches = new Array(bLen).fill(false);
    let matches = 0;

    for (let i = 0; i < aLen; i += 1) {
      const start = Math.max(0, i - matchDistance);
      const end = Math.min(i + matchDistance + 1, bLen);
      for (let j = start; j < end; j += 1) {
        if (bMatches[j]) continue;
        if (a[i] !== b[j]) continue;
        aMatches[i] = true;
        bMatches[j] = true;
        matches += 1;
        break;
      }
    }

    if (matches === 0) return 0;

    let transpositions = 0;
    let k = 0;
    for (let i = 0; i < aLen; i += 1) {
      if (!aMatches[i]) continue;
      while (!bMatches[k]) k += 1;
      if (a[i] !== b[k]) transpositions += 1;
      k += 1;
    }

    const m = matches;
    const jaro = (m / aLen + m / bLen + (m - transpositions / 2) / m) / 3;
    let prefix = 0;
    const maxPrefix = 4;
    for (let i = 0; i < Math.min(maxPrefix, aLen, bLen); i += 1) {
      if (a[i] === b[i]) prefix += 1;
      else break;
    }
    return jaro + prefix * 0.1 * (1 - jaro);
  }

  function buildFacilitySearchCache(facility) {
    const stringSet = new Set();
    const nameVariants = [];
    const nameCandidates = [
      facility?.name,
      facility?.officialName,
      facility?.corporationName,
      facility?.nameKana,
    ];
    for (const value of nameCandidates) {
      if (typeof value === 'string' && value.trim()) {
        const trimmed = value.trim();
        stringSet.add(trimmed);
        const normalized = normalizeForSimilarity(trimmed);
        if (normalized) nameVariants.push(normalized);
      }
    }

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
    const addressTokens = new Set();
    const addressPieces = [
      facility?.address,
      facility?.fullAddress,
      `${facility?.prefecture || ''}${facility?.city || ''}`,
    ];
    addressPieces.forEach((piece) => {
      tokenizeForSearch(piece).forEach((token) => {
        if (token) addressTokens.add(token);
      });
    });
    const postalCode = (facility?.postalCode || '').toString().replace(/[^0-9]/g, '');
    return {
      normalizedStrings,
      tokens: tokenSet,
      facilityIdUpper: (facility?.facilityId || '').toString().toUpperCase(),
      nameVariants,
      addressTokens,
      addressNormalized: normalizeForSimilarity(facility?.address || facility?.fullAddress || ''),
      prefectureToken: normalizeFuzzy(facility?.prefecture || ''),
      cityToken: normalizeFuzzy(facility?.city || ''),
      postalCode,
    };
  }

  function pickFacilityDisplayName(facility) {
    const candidates = [
      facility?.name,
      facility?.officialName,
      facility?.corporationName,
      facility?.prefecture,
      facility?.city,
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
    if (score >= 320) return '一致度: 非常に高';
    if (score >= 220) return '一致度: 高';
    if (score >= 120) return '一致度: 中';
    return '一致度: 参考';
  }

  function findMhlwCandidates({ entries, clinic, query, limit = 8 }) {
    if (!Array.isArray(entries) || !entries.length) return [];

    const trimmedQuery = (query || '').trim();
    const normalizedQuery = normalizeFuzzy(trimmedQuery);
    const clinicNameNorm = normalizeFuzzy(clinic?.name || clinic?.displayName || clinic?.officialName || '');
    const nameQueries = [normalizedQuery, clinicNameNorm].filter(Boolean);
    const rawPostal = (clinic?.postalCode || '').toString().replace(/[^0-9]/g, '');
    const postalCandidates = new Set();
    if (rawPostal) postalCandidates.add(rawPostal);

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

      const facilityName = normalizeForSimilarity(facility?.name || facility?.officialName || facility?.corporationName || '');
      if (!facilityName) continue;

      let matched = false;
      for (const q of nameQueries) {
        if (!q) continue;
        if (facilityName.includes(q)) {
          matched = true;
          break;
        }
      }
      if (!matched && nameQueries.length) continue;

      let score = 0;
      if (nameQueries.length) {
        let bestSim = 0;
        for (const q of nameQueries) {
          if (!q) continue;
          const sim = jaroWinklerDistance(q, facilityName);
          if (sim > bestSim) bestSim = sim;
        }
        score += Math.round(bestSim * 400);
      }

      const facilityIdUpper = cache.facilityIdUpper || '';
      for (const q of nameQueries) {
        if (!q) continue;
        if (facilityIdUpper && facilityIdUpper.includes(q.toUpperCase())) {
          score += 80;
        }
      }

      const facilityPostal = cache.postalCode || '';
      const postalMatch = rawPostal && facilityPostal === rawPostal;

      results.push({ facility, score, postalMatch });
    }

    results.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.postalMatch && !b.postalMatch) return -1;
      if (!a.postalMatch && b.postalMatch) return 1;
      return (a.facility?.facilityId || '').localeCompare(b.facility?.facilityId || '');
    });

    return results.slice(0, limit);
  }

  function buildClinicCard(clinic, mhlwSource, options = {}) {
    const dict = (mhlwSource && mhlwSource.dict) || mhlwSource || {};
    const entries = Array.isArray(mhlwSource?.entries)
      ? mhlwSource.entries
      : (dict && typeof dict === 'object' ? Object.values(dict) : []);
    const searchKeyword = typeof options.searchKeyword === 'string' ? options.searchKeyword : '';

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
          <div><dt class="font-medium">厚労省ID</dt><dd>${mhlwInfo.facilityId || '-'}</dd></div>
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
        if (typeof onLinked === 'function') {
          onLinked();
        }
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
          if (typeof onLinked === 'function') {
            onLinked();
          }
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

    const searchCandidates = [];
    if (searchKeyword && searchKeyword.trim()) searchCandidates.push(searchKeyword.trim());
    const defaultKeywordSources = [
      clinic.name,
      clinic.displayName,
      clinic.officialName,
      clinic.shortName,
      clinic.nameKana,
      clinic.address,
    ]
      .map((value) => (typeof value === 'string' ? value.trim() : ''))
      .filter(Boolean);
    searchCandidates.push(...defaultKeywordSources);
    const uniqueKeywords = Array.from(new Set(searchCandidates.filter(Boolean)));
    const initialKeyword = uniqueKeywords[0] || '';
    candidateInput.value = initialKeyword;

    function highlightCandidate(element) {
      candidateList.querySelectorAll('[data-candidate]').forEach((node) => {
        node.classList.remove('ring-2', 'ring-blue-200');
      });
      if (element) {
        element.classList.add('ring-2', 'ring-blue-200');
      }
    }

    const candidateInfo = document.createElement('p');
    candidateInfo.className = 'text-[11px] text-slate-500';
    candidateSection.insertBefore(candidateInfo, candidateList);

    function renderCandidates(keyword, { fallback = false } = {}) {
      candidateList.innerHTML = '';
      const baseKeyword = (keyword || '').trim();
      if (!Array.isArray(entries) || !entries.length) {
        const empty = document.createElement('p');
        empty.className = 'text-xs text-red-600';
        empty.textContent = '厚労省データが読み込まれていません。CSVを再読込してください。';
        candidateList.appendChild(empty);
        candidateInfo.textContent = baseKeyword ? `検索キーワード: 「${baseKeyword}」` : '検索キーワード: （未入力）';
        return;
      }

      const tried = new Set();
      const attempts = [];
      const queue = [];
      if (baseKeyword) queue.push(baseKeyword);
      uniqueKeywords.forEach((term) => {
        if (term && !queue.includes(term)) queue.push(term);
      });

      const renderForTerm = (term) => {
        const results = findMhlwCandidates({ entries, clinic, query: term, limit: 8 });
        if (!results.length) return false;
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
        return true;
      };

      for (const term of queue) {
        const normalizedTerm = (term || '').trim();
        if (!normalizedTerm || tried.has(normalizedTerm)) continue;
        tried.add(normalizedTerm);
        candidateInput.value = normalizedTerm;
        attempts.push(normalizedTerm);
        if (renderForTerm(normalizedTerm)) {
          candidateInfo.textContent = attempts.length === 1
            ? `検索キーワード: 「${normalizedTerm}」`
            : `検索キーワード: 「${attempts[0]}」では一致なし → 「${normalizedTerm}」の候補を表示中`;
          return;
        }
        if (!fallback) break;
      }

      const empty = document.createElement('p');
      empty.className = 'text-xs text-slate-500';
      empty.textContent = '候補が見つかりませんでした。キーワードを調整してください。';
      candidateList.appendChild(empty);
      candidateInfo.textContent = attempts.length
        ? `検索キーワード: 「${attempts[0]}」では一致する候補が見つかりませんでした。`
        : baseKeyword ? `検索キーワード: 「${baseKeyword}」` : '検索キーワード: （未入力）';
    }
    searchButton.addEventListener('click', () => {
      renderCandidates(candidateInput.value, { fallback: true });
    });

    resetButton.addEventListener('click', () => {
      candidateInput.value = initialKeyword;
      renderCandidates(initialKeyword, { fallback: true });
    });

    candidateInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        renderCandidates(candidateInput.value, { fallback: true });
      }
    });

    renderCandidates(candidateInput.value, { fallback: true });

    return wrapper;
  }

  function init() {
    const clinicList = document.getElementById('clinicList');
    const clinicListStatus = document.getElementById('clinicListStatus');
    const refreshClinicsBtn = document.getElementById('refreshClinicList');
    const previewEl = document.getElementById('mhlwPreview');
    const reloadBtn = document.getElementById('reloadMhlwDict');
    const metaInfo = document.getElementById('mhlwMetaInfo');
    const uploadCsvForm = document.getElementById('mhlwUploadCsvForm');
    const uploadCsvStatus = document.getElementById('mhlwUploadCsvStatus');
    const metaRefreshBtn = document.getElementById('mhlwMetaRefresh');

    const clinicFacilityInput = document.getElementById('mhlwClinicFacilityCsv');
    const clinicScheduleInput = document.getElementById('mhlwClinicScheduleCsv');
    const hospitalFacilityInput = document.getElementById('mhlwHospitalFacilityCsv');
    const hospitalScheduleInput = document.getElementById('mhlwHospitalScheduleCsv');

    if (!clinicList) return;

    let mhlwDict = {};
    let mhlwEntries = [];
    let clinicsCache = null;
    let clinicsLoading = false;

    function setStatus(element, message, variant = 'info') {
      if (!element) return;
      element.textContent = message;
      const base = element.dataset?.baseClass || 'text-xs';
      element.className = base;
      element.classList.remove('text-red-600', 'text-emerald-600', 'text-slate-500');
      if (variant === 'error') {
        element.classList.add('text-red-600');
      } else if (variant === 'success') {
        element.classList.add('text-emerald-600');
      } else {
        element.classList.add('text-slate-500');
      }
    }

    function renderMeta(meta) {
      if (!metaInfo) return;
      metaInfo.className = 'text-xs text-slate-500 sm:text-right';
      if (!meta) {
        metaInfo.textContent = '最新データ: 未アップロード';
        return;
      }
      const parts = [];
      parts.push(`<span class="font-semibold">${formatTimestamp(meta.updatedAt)}</span>`);
      if (typeof meta.size === 'number') {
        parts.push(`サイズ: ${formatBytes(meta.size)}`);
      }
      if (meta.etag) {
        parts.push(`ETag: ${meta.etag}`);
      }
      if (meta.cacheControl) {
        parts.push(`Cache-Control: ${meta.cacheControl}`);
      }
      metaInfo.innerHTML = `最新更新: ${parts.join(' / ')}`;
    }

    async function loadMeta(force = false) {
      if (!metaInfo) return;
      metaInfo.className = 'text-xs text-slate-500 sm:text-right';
      metaInfo.textContent = '最新データ情報を取得中…';
      try {
        const meta = await fetchMhlwMeta({ cacheMode: force ? 'reload' : 'default' });
        renderMeta(meta);
      } catch (err) {
        console.warn('[mhlwSync] meta fetch failed', err);
        metaInfo.textContent = err?.payload?.message || err?.message || '最新データ情報の取得に失敗しました。';
        metaInfo.classList.add('text-red-600');
      }
    }

    function renderClinicList() {
      if (!clinicList) return;
      clinicList.innerHTML = '';
      if (clinicsLoading) {
        if (clinicListStatus) clinicListStatus.textContent = '未紐付けの診療所を読み込み中です…';
        return;
      }
      if (!Array.isArray(clinicsCache)) {
        if (clinicListStatus) clinicListStatus.textContent = '診療所一覧を取得できませんでした。再読み込みをお試しください。';
        return;
      }
      const pending = clinicsCache.filter((clinic) => !clinic.mhlwFacilityId);
      if (pending.length === 0) {
        if (clinicListStatus) clinicListStatus.textContent = '厚労省ID未登録の診療所はありません。';
        return;
      }
      pending.sort((a, b) => (a?.name || '').localeCompare(b?.name || '', 'ja'));
      if (clinicListStatus) clinicListStatus.textContent = `厚労省ID未設定の診療所: ${pending.length} 件`;
      pending.forEach((clinic) => {
        clinicList.appendChild(buildClinicCard(
          clinic,
          { dict: mhlwDict, entries: mhlwEntries },
          {
            searchKeyword: clinic?.name || '',
            onLinked: () => loadClinics(true),
          },
        ));
      });
    }

    async function loadDictAndPreview(force = false) {
      if (force) {
        try {
          localStorage.removeItem(LOCAL_CACHE_KEY);
          localStorage.removeItem(LOCAL_CACHE_TS_KEY);
        } catch (_) {}
      }
      if (previewEl) {
        previewEl.classList.remove('text-red-600', 'bg-red-50');
        previewEl.textContent = force ? '厚労省データを再読込しています…' : '厚労省データを読み込み中です…';
      }
      await loadMeta(force);
      try {
        mhlwDict = await loadMhlwFacilities({ bypassCache: force });
        mhlwEntries = mhlwDict && typeof mhlwDict === 'object' ? Object.values(mhlwDict) : [];
        if (previewEl) {
          previewEl.classList.remove('text-red-600', 'bg-red-50');
        }
        renderMhlwPreview(mhlwDict, previewEl);
      } catch (err) {
        mhlwDict = {};
        mhlwEntries = [];
        console.error('[mhlwSync] failed to load MHLW dataset', err);
        if (previewEl) {
          previewEl.classList.add('text-red-600');
          previewEl.classList.add('bg-red-50');
          const messages = [err?.message || '厚労省施設データの読み込みに失敗しました。'];
          if (typeof err?.snippet === 'string' && err.snippet.trim()) {
            messages.push('--- 応答スニペット ---');
            messages.push(err.snippet.trim());
          }
          previewEl.textContent = messages.join('\n');
        }
      }
      renderClinicList();
    }

    async function fetchClinics(keyword) {
      const apiBase = resolveApiBase();
      const authHeader = await getAuthHeader();
      let url = `${apiBase}/api/listClinics`;
      if (keyword) {
        const params = new URLSearchParams({ keyword });
        url = `${url}?${params.toString()}`;
      }
      const res = await fetchJson(url, {
        method: 'GET',
        headers: authHeader ? { Authorization: authHeader } : {},
      });
      return Array.isArray(res?.clinics) ? res.clinics : [];
    }

    async function loadClinics(force = false) {
      clinicsLoading = true;
      renderClinicList();
      try {
        const clinics = await fetchClinics(force ? '' : undefined);
        clinicsCache = Array.isArray(clinics) ? clinics : [];
      } catch (err) {
        console.error('[mhlwSync] failed to fetch clinics', err);
        clinicsCache = null;
        if (clinicListStatus) {
          clinicListStatus.textContent = err?.message || '診療所一覧の取得に失敗しました。';
        }
      } finally {
        clinicsLoading = false;
        renderClinicList();
      }
    }

    loadDictAndPreview(false);
    loadClinics(false);

    reloadBtn?.addEventListener('click', () => {
      if (previewEl) {
        previewEl.textContent = 'CSVを再読込しています…';
      }
      loadDictAndPreview(true);
    });

    refreshClinicsBtn?.addEventListener('click', () => {
      loadClinics(true);
    });

    uploadCsvForm?.addEventListener('submit', async (event) => {
      event.preventDefault();

      if (!global.MhlwCsvUtils?.buildMhlwDatasetFromCsv) {
        setStatus(uploadCsvStatus, 'CSV 解析モジュールが読み込まれていません。ページを再読み込みしてください。', 'error');
        return;
      }

      const requiredInputs = [
        { input: clinicFacilityInput, label: '診療所 施設票 CSV' },
        { input: clinicScheduleInput, label: '診療所 診療科・診療時間票 CSV' },
        { input: hospitalFacilityInput, label: '病院 施設票 CSV' },
        { input: hospitalScheduleInput, label: '病院 診療科・診療時間票 CSV' },
      ];

      for (const { input, label } of requiredInputs) {
        if (!input || !input.files || !input.files.length) {
          setStatus(uploadCsvStatus, `${label} を選択してください。`, 'error');
          return;
        }
      }

      let uploadSession = null;

      try {
        setStatus(uploadCsvStatus, 'CSV を解析中です…', 'info');
        const progressSummary = new Map();
        const describeProgress = () => Array.from(progressSummary.entries()).map(([key, value]) => `${key}: ${value}`).join(' / ');

        const dataset = await global.MhlwCsvUtils.buildMhlwDatasetFromCsv({
          clinicFacilityFile: clinicFacilityInput.files[0],
          clinicScheduleFile: clinicScheduleInput.files[0],
          hospitalFacilityFile: hospitalFacilityInput.files[0],
          hospitalScheduleFile: hospitalScheduleInput.files[0],
        }, {
          onProgress: ({ kind, facilityType, processed, done }) => {
            const labelPrefix = kind === 'facility' ? '施設票' : '診療時間票';
            const typeLabel = facilityType === 'hospital' ? '病院' : '診療所';
            const key = `${labelPrefix} (${typeLabel})`;
            const suffix = done ? `${processed} 行完了` : `${processed} 行処理中…`;
            progressSummary.set(key, suffix);
            setStatus(uploadCsvStatus, `CSV を解析中です… ${describeProgress()}`, 'info');
          },
        });

        const facilityCount = dataset.stats?.facilityCount ?? dataset.facilities.length;
        const scheduleCount = dataset.stats?.scheduleCount ?? 0;

        const jsonPayload = JSON.stringify({ count: facilityCount, facilities: dataset.facilities });
        const encoder = new TextEncoder();
        const rawBytes = encoder.encode(jsonPayload);
        const rawBlob = new Blob([rawBytes], { type: 'application/json' });

        let directPayloadPromise = null;
        const getDirectPayload = () => {
          if (!directPayloadPromise) {
            directPayloadPromise = prepareDirectUploadPayload(rawBytes, rawBlob);
          }
          return directPayloadPromise;
        };

        let useMultipart = true;
        try {
          setStatus(uploadCsvStatus, 'アップロードを初期化しています…', 'info');
          uploadSession = await startMultipartUpload({ facilityCount, scheduleCount });
        } catch (err) {
          if (err?.payload?.error === 'UNSUPPORTED') {
            useMultipart = false;
            console.warn('[mhlwSync] multipart upload unsupported, falling back to single PUT', err);
          } else {
            throw err;
          }
        }

        let uploadedViaFallback = false;

        if (!useMultipart) {
          setStatus(uploadCsvStatus, '環境で multipart upload が利用できないため、単一リクエストでアップロードしています…', 'info');
          const directPayload = await getDirectPayload();
          await uploadJsonDirect({
            blob: directPayload.blob,
            facilityCount,
            scheduleCount,
            gzip: directPayload.gzip,
          });
          setStatus(uploadCsvStatus, `アップロードが完了しました（施設 ${facilityCount} 件、診療時間 ${scheduleCount} 件）。最新データを再読込します…`, 'success');
          uploadedViaFallback = true;
        } else {
          const partSize = Number(uploadSession.partSize) || DEFAULT_PART_SIZE_HINT;
          const totalParts = Math.max(1, Math.ceil(rawBlob.size / partSize));
          const parts = [];

          for (let partNumber = 1; partNumber <= totalParts; partNumber += 1) {
            const start = (partNumber - 1) * partSize;
            const end = Math.min(start + partSize, rawBlob.size);
            const chunk = rawBlob.slice(start, end);
            setStatus(uploadCsvStatus, `整形済み JSON (${formatBytes(rawBlob.size)}) をアップロードしています… (${partNumber}/${totalParts})`, 'info');
            try {
              const { etag } = await uploadPartChunk(uploadSession.uploadId, partNumber, chunk);
              parts.push({ partNumber, etag });
            } catch (err) {
              const payloadError = err?.payload?.error;
              const isUnsupported = payloadError === 'UNSUPPORTED';
              const isUploadPartFailed = payloadError === 'UPLOAD_PART_FAILED';
              const shouldFallback = isUnsupported || isUploadPartFailed || err?.status === 500 || partNumber === 1;
              if (shouldFallback) {
                console.warn('[mhlwSync] uploadPart failed, falling back to single PUT', err);
                if (uploadSession?.uploadId) {
                  await abortMultipartUpload(uploadSession.uploadId);
                  uploadSession = null;
                }
                console.info('[mhlwSync] switching to direct PUT upload');
                setStatus(uploadCsvStatus, '環境で multipart upload が利用できないため、単一リクエストでアップロードしています…', 'info');
                const directPayload = await getDirectPayload();
                await uploadJsonDirect({
                  blob: directPayload.blob,
                  facilityCount,
                  scheduleCount,
                  gzip: directPayload.gzip,
                });
                setStatus(uploadCsvStatus, `アップロードが完了しました（施設 ${facilityCount} 件、診療時間 ${scheduleCount} 件）。最新データを再読込します…`, 'success');
                uploadedViaFallback = true;
                useMultipart = false;
                break;
              }
              throw err;
            }
          }

          if (useMultipart && !uploadedViaFallback) {
            setStatus(uploadCsvStatus, 'アップロードを確定しています…', 'info');
            await completeMultipartUpload({
              uploadId: uploadSession.uploadId,
              parts,
              facilityCount,
              scheduleCount,
            });

            setStatus(uploadCsvStatus, `アップロードが完了しました（施設 ${facilityCount} 件、診療時間 ${scheduleCount} 件）。最新データを再読込します…`, 'success');
          }
        }

        clinicFacilityInput.value = '';
        clinicScheduleInput.value = '';
        hospitalFacilityInput.value = '';
        hospitalScheduleInput.value = '';

        await loadDictAndPreview(true);
      } catch (err) {
        console.error('[mhlwSync] upload failed', err);
        setStatus(uploadCsvStatus, err?.message || 'アップロード処理に失敗しました。', 'error');
        if (uploadSession?.uploadId) {
          await abortMultipartUpload(uploadSession.uploadId);
        }
      }
    });

    metaRefreshBtn?.addEventListener('click', () => {
      if (uploadCsvStatus) {
        setStatus(uploadCsvStatus, '最新データ情報を取得中…', 'info');
      }
      loadMeta(true)
        .then(() => {
          if (uploadCsvStatus) {
            setStatus(uploadCsvStatus, '最新データ情報を取得しました。', 'success');
          }
        })
        .catch((err) => {
          console.error('[mhlwSync] meta refresh failed', err);
          if (uploadCsvStatus) {
            setStatus(uploadCsvStatus, err?.message || '最新データの取得に失敗しました。', 'error');
          }
        });
    });

    // 検索フォームは廃止し、未紐付けの診療所を常に一覧表示する
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})(window);
