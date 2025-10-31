(function setupMhlwSync(global) {
  const DEFAULT_API_BASE = 'https://ncd-app.altry.workers.dev';
  const LOCAL_CACHE_KEY = 'mhlwFacilityCache';
  const LOCAL_CACHE_TS_KEY = 'mhlwFacilityCacheTimestamp';
  const LOCAL_CACHE_TTL_MS = 1000 * 60 * 60; // 1 hour
  const DEFAULT_CACHE_CONTROL = 'public, max-age=600, stale-while-revalidate=3600';
  const UTF8_DECODER = new TextDecoder('utf-8');
  const facilityCache = new Map();
  const PREFECTURE_OPTIONS = [
    { code: '01', name: '北海道' },
    { code: '02', name: '青森県' },
    { code: '03', name: '岩手県' },
    { code: '04', name: '宮城県' },
    { code: '05', name: '秋田県' },
    { code: '06', name: '山形県' },
    { code: '07', name: '福島県' },
    { code: '08', name: '茨城県' },
    { code: '09', name: '栃木県' },
    { code: '10', name: '群馬県' },
    { code: '11', name: '埼玉県' },
    { code: '12', name: '千葉県' },
    { code: '13', name: '東京都' },
    { code: '14', name: '神奈川県' },
    { code: '15', name: '新潟県' },
    { code: '16', name: '富山県' },
    { code: '17', name: '石川県' },
    { code: '18', name: '福井県' },
    { code: '19', name: '山梨県' },
    { code: '20', name: '長野県' },
    { code: '21', name: '岐阜県' },
    { code: '22', name: '静岡県' },
    { code: '23', name: '愛知県' },
    { code: '24', name: '三重県' },
    { code: '25', name: '滋賀県' },
    { code: '26', name: '京都府' },
    { code: '27', name: '大阪府' },
    { code: '28', name: '兵庫県' },
    { code: '29', name: '奈良県' },
    { code: '30', name: '和歌山県' },
    { code: '31', name: '鳥取県' },
    { code: '32', name: '島根県' },
    { code: '33', name: '岡山県' },
    { code: '34', name: '広島県' },
    { code: '35', name: '山口県' },
    { code: '36', name: '徳島県' },
    { code: '37', name: '香川県' },
    { code: '38', name: '愛媛県' },
    { code: '39', name: '高知県' },
    { code: '40', name: '福岡県' },
    { code: '41', name: '佐賀県' },
    { code: '42', name: '長崎県' },
    { code: '43', name: '熊本県' },
    { code: '44', name: '大分県' },
    { code: '45', name: '宮崎県' },
    { code: '46', name: '鹿児島県' },
    { code: '47', name: '沖縄県' },
  ];
  const PREVIEW_DEFAULT_PREFECTURE = '東京都';
  const MHLW_STATUS_LABELS = {
    pending: '未同期',
    linked: '同期済み',
    manual: '手動入力',
    not_found: '未掲載',
  };
  const MHLW_STATUS_STYLES = {
    pending: 'rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700',
    linked: 'rounded bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700',
    manual: 'rounded bg-purple-100 px-2 py-0.5 text-xs font-semibold text-purple-700',
    not_found: 'rounded bg-rose-100 px-2 py-0.5 text-xs font-semibold text-rose-700',
  };

  function escapeHtml(value) {
    return (value ?? '').toString()
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function normalizeSyncStatus(status) {
    const normalized = (status || '').toString().toLowerCase();
    if (Object.prototype.hasOwnProperty.call(MHLW_STATUS_LABELS, normalized)) {
      return normalized;
    }
    return 'pending';
  }

  function renderStatusBadge(status) {
    const normalized = normalizeSyncStatus(status);
    const label = MHLW_STATUS_LABELS[normalized] || MHLW_STATUS_LABELS.pending;
    const style = MHLW_STATUS_STYLES[normalized] || MHLW_STATUS_STYLES.pending;
    return `<span class="${style}">${label}</span>`;
  }

  function isManualSyncStatus(status) {
    const normalized = normalizeSyncStatus(status);
    return normalized === 'manual' || normalized === 'not_found';
  }

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

  function normalizePrefectureName(value) {
    const trimmed = (value || '').toString().trim();
    if (!trimmed) return '';
    const match = PREFECTURE_OPTIONS.find((item) => {
      return item.name === trimmed || item.code === trimmed || trimmed.startsWith(item.name);
    });
    return match ? match.name : '';
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

  async function fetchMhlwSearch({
    keyword = '',
    facilityId = '',
    facilityType = '',
    prefecture = '',
    city = '',
    limit = 20,
  } = {}) {
    const apiBase = resolveApiBase();
    const params = new URLSearchParams();
    if (keyword) params.set('q', keyword);
    if (facilityId) params.set('facilityId', sanitizeFacilityId(facilityId));
    if (facilityType) params.set('facilityType', facilityType);
    if (prefecture) params.set('prefecture', prefecture);
    if (city) params.set('city', city);
    params.set('limit', String(Math.max(1, Math.min(Number(limit) || 20, 100))));

    const headers = new Headers();
    const authHeader = await getAuthHeader();
    if (authHeader) headers.set('Authorization', authHeader);

    const res = await fetch(`${apiBase}/api/mhlw/search?${params.toString()}`, { headers, cache: 'no-cache' });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      const error = new Error(payload?.message || `Search failed (${res.status})`);
      error.status = res.status;
      error.payload = payload;
      throw error;
    }
    const results = Array.isArray(payload?.results) ? payload.results : [];
    results.forEach((facility) => {
      const id = sanitizeFacilityId(facility?.facilityId);
      if (id) facilityCache.set(id, facility);
    });
    return results;
  }

  async function loadMhlwFacilities({ bypassCache = false } = {}) {
    if (bypassCache) {
      try {
        localStorage.removeItem(LOCAL_CACHE_KEY);
        localStorage.removeItem(LOCAL_CACHE_TS_KEY);
      } catch (_) {}
      facilityCache.clear();
    }
    try {
      const previewPrefecture = normalizePrefectureName(PREVIEW_DEFAULT_PREFECTURE) || PREFECTURE_OPTIONS[0]?.name || '';
      const sampleKeyword = previewPrefecture ? previewPrefecture[0] : 'クリニック';
      const results = await fetchMhlwSearch({ prefecture: previewPrefecture, keyword: sampleKeyword, limit: 25 });
      const dataset = {};
      results.forEach((facility) => {
        const id = sanitizeFacilityId(facility?.facilityId);
        if (id) {
          facilityCache.set(id, facility);
          dataset[id] = facility;
        }
      });
      storeCachedMhlwData(dataset);
      return dataset;
    } catch (err) {
      console.warn('[mhlwSync] failed to load facilities sample', err);
      const error = new Error('厚労省施設データの取得に失敗しました。');
      error.cause = err;
      throw error;
    }
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

  async function fetchClinicDetail(clinicId) {
    if (!clinicId) return null;
    const apiBase = resolveApiBase();
    const headers = new Headers();
    const authHeader = await getAuthHeader();
    if (authHeader) headers.set('Authorization', authHeader);
    const url = `${apiBase}/api/clinicDetail?id=${encodeURIComponent(clinicId)}`;
    const res = await fetch(url, { headers, cache: 'no-cache' }).catch((err) => {
      console.warn('[mhlwSync] failed to fetch clinic detail', clinicId, err);
      return null;
    });
    if (!res) return null;
    if (!res.ok) {
      console.warn('[mhlwSync] clinic detail request failed', clinicId, res.status);
      return null;
    }
    const payload = await res.json().catch(() => null);
    if (payload && typeof payload === 'object' && payload.clinic) {
      return payload.clinic;
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

  const CORPORATE_PREFIXES = [
    '医療法人社団',
    '医療法人財団',
    '社会医療法人',
    '社会福祉法人',
    '特定医療法人',
    '公益社団法人',
    '公益財団法人',
    '一般社団法人',
    '一般財団法人',
    '学校法人',
    '国立研究開発法人',
    '地方独立行政法人',
    '医療法人',
    '医療生協',
  ].sort((a, b) => b.length - a.length);

  function trimLeadingPunctuation(text) {
    return text.replace(/^[\s\u3000・･,、。()（）［］「」『』【】]+/, '');
  }

  function removeLeadingCorporateDesignators(name) {
    let result = name.trim();
    let changed = false;
    let loop = true;
    while (loop && result) {
      loop = false;
      result = trimLeadingPunctuation(result);
      for (const prefix of CORPORATE_PREFIXES) {
        if (result.startsWith(prefix)) {
          result = trimLeadingPunctuation(result.slice(prefix.length));
          changed = true;
          loop = true;
          break;
        }
        if (result.startsWith(`(${prefix})`)) {
          result = trimLeadingPunctuation(result.slice(prefix.length + 2));
          changed = true;
          loop = true;
          break;
        }
        if (result.startsWith(`（${prefix}）`)) {
          result = trimLeadingPunctuation(result.slice(prefix.length + 2));
          changed = true;
          loop = true;
          break;
        }
      }
    }
    return changed ? result.trim() : null;
  }

  function generateCorporateNameVariants(value) {
    if (typeof value !== 'string') return [];
    const trimmed = value.trim();
    if (!trimmed) return [];
    const variants = new Set();

    const leadingRemoved = removeLeadingCorporateDesignators(trimmed);
    if (leadingRemoved && leadingRemoved !== trimmed) {
      variants.add(leadingRemoved);
      const afterSpace = leadingRemoved.replace(/^[^\s\u3000]+[\s\u3000]+/, '').trim();
      if (afterSpace && afterSpace !== leadingRemoved) {
        variants.add(afterSpace);
      }
    }

    const bracketRemoved = trimmed.replace(
      /[（(]\s*(?:医療法人(?:社団|財団)?|社会医療法人|社会福祉法人|特定医療法人|公益(?:社団|財団)法人|一般(?:社団|財団)法人|学校法人|地方独立行政法人|国立研究開発法人)[^）)]*[）)]/g,
      '',
    ).trim();
    if (bracketRemoved && bracketRemoved !== trimmed) {
      variants.add(bracketRemoved);
    }

    const afterSpaceOriginal = trimmed.replace(/^[^\s\u3000]+[\s\u3000]+/, '').trim();
    if (afterSpaceOriginal && afterSpaceOriginal !== trimmed) {
      variants.add(afterSpaceOriginal);
    }

    return Array.from(variants).filter(Boolean);
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
    const nameVariantSet = new Set();
    const shortNameVariantSet = new Set();
    const nameCandidates = [
      facility?.name,
      facility?.officialName,
      facility?.officialNameKana,
      facility?.shortName,
      facility?.shortNameKana,
      facility?.englishName,
      facility?.nameKana,
    ];

    const recordVariant = (text, targetSet) => {
      if (typeof text !== 'string') return;
      const trimmed = text.trim();
      if (!trimmed) return;
      stringSet.add(trimmed);
      const normalized = normalizeForSimilarity(trimmed);
      if (normalized) targetSet.add(normalized);
    };

    const recordNameVariant = (text) => recordVariant(text, nameVariantSet);
    const recordShortVariant = (text) => recordVariant(text, shortNameVariantSet);
    const recordBothVariants = (text) => {
      recordNameVariant(text);
      recordShortVariant(text);
    };

    for (const value of nameCandidates) {
      if (typeof value !== 'string') continue;
      recordNameVariant(value);
      generateCorporateNameVariants(value).forEach(recordNameVariant);
    }

    [facility?.shortName, facility?.shortNameKana].forEach((value) => {
      if (typeof value !== 'string') return;
      recordBothVariants(value);
      generateCorporateNameVariants(value).forEach(recordBothVariants);
    });

    if (facility && typeof facility === 'object') {
      for (const key of Object.keys(facility)) {
        const value = facility[key];
        if (typeof value === 'string' && value.trim()) {
          recordNameVariant(value);
          generateCorporateNameVariants(value).forEach(recordNameVariant);
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
      `${facility?.prefectureName || ''}${facility?.cityName || ''}`,
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
      nameVariants: Array.from(nameVariantSet),
      shortNameVariants: Array.from(shortNameVariantSet),
      addressTokens,
      addressNormalized: normalizeForSimilarity(facility?.address || facility?.fullAddress || ''),
      prefectureToken: normalizeFuzzy(facility?.prefecture || ''),
      cityToken: normalizeFuzzy(facility?.city || ''),
      postalCode,
    };
  }

  function pickFacilityDisplayName(facility) {
    const candidates = [
      facility?.shortName,
      facility?.officialName,
      facility?.name,
      facility?.prefecture,
      facility?.city,
      facility?.englishName,
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

  function sanitizeFacilityId(value) {
    if (!value) return '';
    return String(value).trim().replace(/[^0-9A-Za-z]/g, '').toUpperCase();
  }

  function getCachedFacility(facilityId) {
    const id = sanitizeFacilityId(facilityId);
    if (!id) return null;
    return facilityCache.get(id) || null;
  }

  async function ensureFacilityCached(facilityId) {
    const id = sanitizeFacilityId(facilityId);
    if (!id) return null;
    const existing = facilityCache.get(id);
    if (existing) return existing;
    const results = await fetchMhlwSearch({ facilityId: id, limit: 1 });
    const facility = results.find((entry) => sanitizeFacilityId(entry?.facilityId) === id) || null;
    if (facility) {
      facilityCache.set(id, facility);
    }
    return facility;
  }

  function variantMatchesQuery(variants, querySet) {
    if (!Array.isArray(variants) || !variants.length || !querySet.size) return false;
    for (const variant of variants) {
      if (!variant) continue;
      for (const queryVariant of querySet) {
        if (!queryVariant) continue;
        if (variant === queryVariant) return true;
        if (variant.includes(queryVariant)) return true;
        if (queryVariant.includes(variant) && variant.length >= 2) return true;
      }
    }
    return false;
  }

  function findMhlwCandidates({ entries, clinic, query, limit = 8 }) {
    if (!Array.isArray(entries) || !entries.length) return [];

    const trimmedQuery = (query || '').trim();
    const queryVariantSet = new Set();
    const normalizedQuery = normalizeForSimilarity(trimmedQuery);
    if (normalizedQuery) queryVariantSet.add(normalizedQuery);
    generateCorporateNameVariants(trimmedQuery).forEach((variant) => {
      const normalizedVariant = normalizeForSimilarity(variant);
      if (normalizedVariant) queryVariantSet.add(normalizedVariant);
    });
    const nameQueries = Array.from(queryVariantSet).filter(Boolean);
    const rawPostal = (clinic?.postalCode || '').toString().replace(/[^0-9]/g, '');
    const postalCandidates = new Set();
    if (rawPostal) postalCandidates.add(rawPostal);
    const clinicPrefToken = normalizeFuzzy(clinic?.prefecture || clinic?.prefectureName || '');
    const clinicCityToken = normalizeFuzzy(clinic?.city || clinic?.cityName || '');
    const clinicAddressTokens = new Set();
    const clinicAddressPieces = [
      clinic?.address,
      `${clinic?.prefecture || ''}${clinic?.city || ''}`,
      `${clinic?.prefectureName || ''}${clinic?.cityName || ''}`,
    ];
    clinicAddressPieces.forEach((piece) => {
      tokenizeForSearch(piece).forEach((token) => {
        if (token) clinicAddressTokens.add(token);
      });
    });

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
      const facilityVariants = (cache.nameVariants && cache.nameVariants.length)
        ? cache.nameVariants
        : (facilityName ? [facilityName] : []);
      if (!facilityVariants.length) continue;

      const facilityPrefToken = cache.prefectureToken || '';
      const facilityCityToken = cache.cityToken || '';
      if (clinicPrefToken && facilityPrefToken && clinicPrefToken !== facilityPrefToken) {
        continue;
      }

      let score = 1000;
      const facilityIdUpper = cache.facilityIdUpper || '';
      for (const q of nameQueries) {
        if (!q) continue;
        if (facilityIdUpper && facilityIdUpper.includes(q.toUpperCase())) {
          score += 80;
        }
      }

      const shortNameVariants = cache.shortNameVariants || [];
      const nameVariants = cache.nameVariants || [];
      const shortMatched = variantMatchesQuery(shortNameVariants, queryVariantSet);
      const nameMatched = variantMatchesQuery(nameVariants, queryVariantSet);
      if (queryVariantSet.size) {
        if (shortMatched) {
          score += 220;
        } else if (nameMatched) {
          score += 140;
        } else {
          // Penalize but still allow if other attributes (住所等) strongly match.
          score -= 120;
        }
      }

      if (clinicPrefToken && facilityPrefToken && clinicPrefToken === facilityPrefToken) {
        score += 160;
      }
      if (clinicCityToken && facilityCityToken) {
        if (clinicCityToken === facilityCityToken) {
          score += 140;
        } else {
          score -= 40;
        }
      }

      const facilityPostal = cache.postalCode || '';
      const postalMatch = rawPostal && facilityPostal === rawPostal;
      if (postalMatch) {
        score += 400;
      } else if (rawPostal && facilityPostal && facilityPostal.startsWith(rawPostal.slice(0, 3))) {
        score += 120;
      }

      if (clinicAddressTokens.size && cache.addressTokens instanceof Set) {
        let addressMatches = 0;
        clinicAddressTokens.forEach((token) => {
          if (cache.addressTokens.has(token)) addressMatches += 1;
        });
        if (addressMatches) {
          score += addressMatches * 60;
        }
      }

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

  function createMhlwCandidateSection({
    clinic,
    searchFn,
    keywordCandidates = [],
    initialKeyword = '',
    onCandidateSelected,
    onSetStatus,
    labels = {},
  } = {}) {
    const section = document.createElement('div');
    section.className = 'mt-4 space-y-3 rounded border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600';

    const header = document.createElement('div');
    header.className = 'flex flex-col gap-1';

    const title = document.createElement('span');
    title.className = 'text-sm font-semibold text-slate-700';
    title.textContent = labels.title || '厚労省データ候補';
    header.appendChild(title);

    const hint = document.createElement('p');
    hint.textContent = labels.hint || '都道府県を選択してから、厚労省公開データの施設名（略称・正式名称）で検索してください。';
    header.appendChild(hint);

    section.appendChild(header);

    const regionControls = document.createElement('div');
    regionControls.className = 'grid gap-2 md:grid-cols-3';

    const prefectureWrap = document.createElement('div');
    prefectureWrap.className = 'flex flex-col';
    const prefectureLabel = document.createElement('label');
    prefectureLabel.className = 'block text-xs font-medium text-slate-600';
    prefectureLabel.textContent = '都道府県';
    prefectureWrap.appendChild(prefectureLabel);
    const prefectureSelect = document.createElement('select');
    prefectureSelect.className = 'mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm';
    prefectureSelect.innerHTML = '<option value="">都道府県を選択</option>';
    PREFECTURE_OPTIONS.forEach((pref) => {
      const option = document.createElement('option');
      option.value = pref.name;
      option.textContent = pref.name;
      prefectureSelect.appendChild(option);
    });
    prefectureWrap.appendChild(prefectureSelect);
    regionControls.appendChild(prefectureWrap);

    const cityWrap = document.createElement('div');
    cityWrap.className = 'flex flex-col';
    const cityLabel = document.createElement('label');
    cityLabel.className = 'block text-xs font-medium text-slate-600';
    cityLabel.textContent = '市区町村（任意）';
    cityWrap.appendChild(cityLabel);
    const cityInput = document.createElement('input');
    cityInput.type = 'text';
    cityInput.className = 'mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm';
    cityInput.placeholder = '例: 中野区';
    cityWrap.appendChild(cityInput);
    regionControls.appendChild(cityWrap);

    const typeWrap = document.createElement('div');
    typeWrap.className = 'flex flex-col';
    const typeLabel = document.createElement('label');
    typeLabel.className = 'block text-xs font-medium text-slate-600';
    typeLabel.textContent = '施設種別';
    typeWrap.appendChild(typeLabel);
    const facilityTypeSelect = document.createElement('select');
    facilityTypeSelect.className = 'mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm';
    facilityTypeSelect.innerHTML = `
      <option value="">指定なし</option>
      <option value="clinic">診療所</option>
      <option value="hospital">病院</option>
    `;
    typeWrap.appendChild(facilityTypeSelect);
    regionControls.appendChild(typeWrap);

    section.appendChild(regionControls);

    const controls = document.createElement('div');
    controls.className = 'flex flex-col gap-2 md:flex-row md:items-end';

    const inputWrap = document.createElement('div');
    inputWrap.className = 'flex-1';

    const inputLabel = document.createElement('label');
    inputLabel.className = 'block text-xs font-medium text-slate-600';
    inputLabel.textContent = labels.searchLabel || '施設名で検索';
    inputWrap.appendChild(inputLabel);

    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.className = 'mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm';
    searchInput.placeholder = labels.searchPlaceholder || '厚労省データの施設名・略称などを入力';
    inputWrap.appendChild(searchInput);

    controls.appendChild(inputWrap);

    const buttonGroup = document.createElement('div');
    buttonGroup.className = 'flex gap-2';

    const searchButton = document.createElement('button');
    searchButton.type = 'button';
    searchButton.className = 'inline-flex items-center gap-2 rounded bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700';
    searchButton.textContent = labels.searchButton || '候補を検索';
    buttonGroup.appendChild(searchButton);

    const resetButton = document.createElement('button');
    resetButton.type = 'button';
    resetButton.className = 'inline-flex items-center gap-2 rounded border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-800 transition hover:border-blue-300 hover:bg-blue-100';
    resetButton.textContent = labels.resetButton || 'NCD名称で再検索';
    buttonGroup.appendChild(resetButton);

    controls.appendChild(buttonGroup);
    section.appendChild(controls);

    const infoLine = document.createElement('p');
    infoLine.className = 'text-[11px] text-slate-500';
    section.appendChild(infoLine);

    const list = document.createElement('div');
    list.className = 'space-y-2';
    section.appendChild(list);

    const getSelectedPrefecture = () => normalizePrefectureName(prefectureSelect.value);
    const getSelectedCity = () => cityInput.value.trim();
    const getSelectedFacilityType = () => facilityTypeSelect.value;
    const ensurePrefectureSelected = () => {
      const selected = getSelectedPrefecture();
      if (!selected) {
        list.innerHTML = '';
        const empty = document.createElement('p');
        empty.className = 'text-xs text-slate-500';
        empty.textContent = '都道府県を選択してください。';
        list.appendChild(empty);
        infoLine.textContent = '都道府県を選択すると候補を表示できます。';
        return false;
      }
      return true;
    };

    const defaultPrefecture = normalizePrefectureName(clinic?.prefecture || clinic?.prefectureName);
    const defaultCity = (clinic?.cityName || clinic?.city || '').trim();
    const defaultFacilityType = (clinic?.facilityType || '').toLowerCase();
    if (defaultPrefecture) {
      prefectureSelect.value = defaultPrefecture;
    }
    if (defaultCity) {
      cityInput.value = defaultCity;
    }
    if (['clinic', 'hospital'].includes(defaultFacilityType)) {
      facilityTypeSelect.value = defaultFacilityType;
    }

    const combinedKeywords = Array.from(new Set([
      initialKeyword,
      ...keywordCandidates,
      clinic?.shortName,
      clinic?.name,
      clinic?.displayName,
      clinic?.officialName,
      clinic?.alias,
      clinic?.corporationName,
      clinic?.nameKana,
    ].filter((value) => typeof value === 'string' && value.trim())));

    const resolvedInitialKeyword = combinedKeywords[0] || '';
    searchInput.value = resolvedInitialKeyword;

    const updateStatus = (message, variant = 'info') => {
      if (typeof onSetStatus === 'function') {
        onSetStatus(message, variant);
      }
    };

    const highlightCandidate = (element) => {
      list.querySelectorAll('[data-candidate]').forEach((node) => {
        node.classList.remove('ring-2', 'ring-blue-200');
      });
      if (element) {
        element.classList.add('ring-2', 'ring-blue-200');
      }
    };

    const updateSearchButtonState = () => {
      const hasPrefecture = !!getSelectedPrefecture();
      searchButton.disabled = !hasPrefecture;
      if (!hasPrefecture) {
        infoLine.textContent = '都道府県を選択すると候補を表示できます。';
      }
    };

    let currentSearchToken = 0;

    const renderCandidates = async (keyword, { fallback = false } = {}) => {
      const token = ++currentSearchToken;
      list.innerHTML = '';
      const trimmed = (keyword || '').trim();
      const loading = document.createElement('p');
      loading.className = 'text-xs text-slate-500';
      loading.textContent = '候補を検索しています…';
      list.appendChild(loading);

      if (typeof searchFn !== 'function') {
        loading.textContent = '厚労省検索関数が利用できません。';
        infoLine.textContent = trimmed ? `検索キーワード: 「${trimmed}」` : '検索キーワード: （未入力）';
        return;
      }

      if (!ensurePrefectureSelected()) {
        updateSearchButtonState();
        return;
      }

      const selectedPrefecture = getSelectedPrefecture();
      const selectedCity = getSelectedCity();
      const selectedFacilityType = getSelectedFacilityType();

      const tried = new Set();
      const attempts = [];
      const queue = [];
      if (trimmed) queue.push(trimmed);
      combinedKeywords.forEach((term) => {
        if (term && !queue.includes(term)) queue.push(term);
      });

      const runSearchForTerm = async (term) => {
        const remoteEntries = await searchFn({
          keyword: term,
          fallback,
          clinic,
          prefecture: selectedPrefecture,
          city: selectedCity,
          facilityType: selectedFacilityType || clinic?.facilityType || '',
        });
        if (token !== currentSearchToken) return true; // another request is in-flight, stop rendering
        const results = findMhlwCandidates({
          entries: Array.isArray(remoteEntries) ? remoteEntries : [],
          clinic,
          query: term,
          limit: 8,
        });
        if (!results.length) return false;
        list.innerHTML = '';
        results.forEach(({ facility, score }) => {
          const item = document.createElement('div');
          item.className = 'rounded border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600 transition';
          item.dataset.candidate = 'true';

          const headerRow = document.createElement('div');
          headerRow.className = 'flex flex-wrap items-center justify-between gap-2';

          const nameEl = document.createElement('div');
          nameEl.className = 'text-sm font-semibold text-slate-800';
          nameEl.textContent = pickFacilityDisplayName(facility);
          headerRow.appendChild(nameEl);

          const idBadge = document.createElement('span');
          idBadge.className = 'rounded bg-blue-100 px-2 py-0.5 text-[11px] font-semibold text-blue-700';
          idBadge.textContent = facility.facilityId || '-';
          headerRow.appendChild(idBadge);

          item.appendChild(headerRow);

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
          applyButton.textContent = labels.applyButton || 'このIDをセット';
          applyButton.addEventListener('click', () => {
            const rawFacilityId = facility?.facilityId || '';
            const facilityId = sanitizeFacilityId(rawFacilityId);
            if (!facilityId) {
              updateStatus('候補の厚労省IDが取得できませんでした。', 'error');
              return;
            }
            if (typeof onCandidateSelected === 'function') {
              onCandidateSelected({ facility, facilityId, rawFacilityId, score, query: term });
            }
            highlightCandidate(item);
            updateStatus(`候補ID ${facilityId} を入力欄にセットしました。保存ボタンで確定してください。`, 'info');
          });
          actions.appendChild(applyButton);

          item.addEventListener('dblclick', () => applyButton.click());

          item.appendChild(actions);
          list.appendChild(item);
        });
        return true;
      };

      for (const term of queue) {
        const normalized = (term || '').trim();
        if (!normalized || tried.has(normalized)) continue;
        tried.add(normalized);
        if (searchInput.value !== normalized) {
          searchInput.value = normalized;
        }
        attempts.push(normalized);
        const rendered = await runSearchForTerm(normalized).catch((err) => {
          if (token !== currentSearchToken) return false;
          console.warn('[mhlwSync] search error', err);
          list.innerHTML = '';
          const errorEl = document.createElement('p');
          errorEl.className = 'text-xs text-red-600';
          errorEl.textContent = err?.message || '候補検索に失敗しました。';
          list.appendChild(errorEl);
          return true;
        });
        if (token !== currentSearchToken) return;
        if (rendered) {
          const infoParts = [`検索キーワード: 「${normalized}」`, `都道府県: ${selectedPrefecture}`];
          if (selectedCity) infoParts.push(`市区町村: ${selectedCity}`);
          infoLine.textContent = infoParts.join(' / ');
          return;
        }
        if (!fallback) break;
      }

      list.innerHTML = '';
      const empty = document.createElement('p');
      empty.className = 'text-xs text-slate-500';
      empty.textContent = '候補が見つかりませんでした。キーワードを調整してください。';
      list.appendChild(empty);
      infoLine.textContent = attempts.length
        ? `検索キーワード: 「${attempts[0]}」では一致する候補が見つかりませんでした。（都道府県: ${selectedPrefecture}${selectedCity ? ` / 市区町村: ${selectedCity}` : ''}）`
        : (trimmed
          ? `検索キーワード: 「${trimmed}」 / 都道府県: ${selectedPrefecture}`
          : `都道府県: ${selectedPrefecture} / 検索キーワード: （未入力）`);
    };

    searchButton.addEventListener('click', () => {
      if (!ensurePrefectureSelected()) {
        updateSearchButtonState();
        return;
      }
      void renderCandidates(searchInput.value, { fallback: true });
    });

    resetButton.addEventListener('click', () => {
      searchInput.value = resolvedInitialKeyword;
      prefectureSelect.value = defaultPrefecture || '';
      cityInput.value = defaultCity || '';
      facilityTypeSelect.value = ['clinic', 'hospital'].includes(defaultFacilityType) ? defaultFacilityType : '';
      updateSearchButtonState();
      if (getSelectedPrefecture()) {
        void renderCandidates(resolvedInitialKeyword, { fallback: true });
      } else {
        ensurePrefectureSelected();
      }
    });

    searchInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        if (!ensurePrefectureSelected()) {
          updateSearchButtonState();
          return;
        }
        void renderCandidates(searchInput.value, { fallback: true });
      }
    });

    prefectureSelect.addEventListener('change', () => {
      updateSearchButtonState();
      if (getSelectedPrefecture()) {
        void renderCandidates(searchInput.value, { fallback: true });
      } else {
        ensurePrefectureSelected();
      }
    });

    facilityTypeSelect.addEventListener('change', () => {
      if (getSelectedPrefecture()) {
        void renderCandidates(searchInput.value, { fallback: true });
      }
    });

    cityInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        if (!ensurePrefectureSelected()) {
          updateSearchButtonState();
          return;
        }
        void renderCandidates(searchInput.value, { fallback: true });
      }
    });

    updateSearchButtonState();
    if (getSelectedPrefecture()) {
      void renderCandidates(searchInput.value, { fallback: true });
    } else {
      ensurePrefectureSelected();
    }

    return {
      element: section,
      render: (keyword, options) => { void renderCandidates(keyword, options); },
      focus: () => searchInput.focus(),
      getKeywords: () => combinedKeywords.slice(),
    };
  }

  function buildClinicCard(clinic, mhlwService, options = {}) {
    const searchKeyword = typeof options.searchKeyword === 'string' ? options.searchKeyword : '';
    const onLinked = typeof options.onLinked === 'function' ? options.onLinked : null;
    const syncStatus = normalizeSyncStatus(clinic.mhlwSyncStatus);
    const showSyncButton = options.showSyncButton !== undefined ? options.showSyncButton : Boolean(clinic.mhlwFacilityId);
    const showDetailsLink = options.showDetailsLink !== undefined ? options.showDetailsLink : Boolean(clinic.mhlwFacilityId);

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
    const clinicName = escapeHtml(clinic.name || '名称未設定');
    const clinicIdLabel = escapeHtml(clinic.id || '未設定');
    const clinicTypeBadge = `<span class="rounded bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">${escapeHtml(clinicTypeLabel)}</span>`;
    const statusBadge = renderStatusBadge(syncStatus);
    const facilityIdDisplay = escapeHtml(currentFacilityId || '未設定');
    const updatedAtDisplay = clinic.updated_at ? new Date(clinic.updated_at * 1000).toISOString().slice(0, 19) : '-';
    title.innerHTML = `
      <div>
        <h3 class="text-lg font-semibold text-slate-900 flex items-center gap-2 flex-wrap">
          <span>${clinicName}</span>
          ${clinicTypeBadge}
          ${statusBadge}
        </h3>
        <p class="text-xs text-slate-500">ID: ${clinicIdLabel}</p>
      </div>
      <div class="text-xs text-slate-500 text-right space-y-1">
        <div>厚労省ID: <span class="font-semibold">${facilityIdDisplay}</span></div>
        <div>最終更新: ${escapeHtml(updatedAtDisplay)}</div>
      </div>
    `;
    wrapper.appendChild(title);

    const form = document.createElement('form');
    form.className = 'mt-4 grid gap-3 md:grid-cols-2';
    form.innerHTML = `
      <div class="space-y-1">
        <label class="block text-sm font-medium text-slate-700" for="facilityId-${clinic.id}">厚労省施設ID</label>
        <input id="facilityId-${clinic.id}" name="facilityId" type="text" value="${escapeHtml(currentFacilityId)}" class="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm" placeholder="例: 1311400001" />
      </div>
      <div class="flex flex-wrap items-end gap-2">
        <button type="submit" class="inline-flex items-center gap-2 rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700">IDを登録</button>
        <button type="button" class="inline-flex items-center gap-2 rounded border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-800 transition hover:border-blue-300 hover:bg-blue-100" data-action="sync">公開データから同期</button>
        <button type="button" class="inline-flex items-center gap-2 rounded border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-700 transition hover:border-rose-300 hover:bg-rose-100" data-action="mark-missing">未掲載として記録</button>
      </div>
      <div class="md:col-span-2 text-xs text-slate-500" data-status></div>
    `;
    wrapper.appendChild(form);

    if (clinic.mhlwManualNote) {
      const noteEl = document.createElement('p');
      noteEl.className = 'mt-3 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700';
      noteEl.innerHTML = `<span class="font-semibold">補足メモ:</span> ${escapeHtml(clinic.mhlwManualNote)}`;
      wrapper.appendChild(noteEl);
    }

    if (clinic.address) {
      const addr = document.createElement('p');
      addr.className = 'mt-3 text-sm text-slate-600';
      addr.textContent = `登録住所: ${clinic.address}`;
      wrapper.appendChild(addr);
    }

    const lookupFacility = (facilityId) => {
      if (typeof mhlwService?.lookup === 'function') {
        return mhlwService.lookup(facilityId);
      }
      return getCachedFacility(facilityId);
    };

    const renderFacilitySummary = (facility) => {
      if (!facility || !facility.facilityId) return null;
      const mhlwTypeLabel = facility.facilityType === 'hospital'
        ? '病院'
        : facility.facilityType === 'clinic'
          ? '診療所'
          : facility.facilityType || '-';
      const box = document.createElement('div');
      box.className = 'mt-3 rounded border border-dashed border-slate-200 bg-slate-50 p-3 text-xs text-slate-600';
      box.innerHTML = `
        <div class="font-semibold text-slate-700">厚労省データ概要</div>
        <dl class="mt-1 grid grid-cols-1 gap-1 sm:grid-cols-2">
          <div><dt class="font-medium">厚労省ID</dt><dd>${facility.facilityId || '-'}</dd></div>
          <div><dt class="font-medium">名称</dt><dd>${pickFacilityDisplayName(facility)}</dd></div>
          <div><dt class="font-medium">住所</dt><dd>${pickFacilityAddress(facility) || '-'}</dd></div>
          <div><dt class="font-medium">種別</dt><dd>${mhlwTypeLabel}</dd></div>
          <div><dt class="font-medium">郵便番号</dt><dd>${facility.postalCode || '-'}</dd></div>
        </dl>
      `;
      return box;
    };

    let summaryBox = null;
    let mhlwInfo = currentFacilityId ? lookupFacility(currentFacilityId) : null;
    if (mhlwInfo) {
      summaryBox = renderFacilitySummary(mhlwInfo);
      if (summaryBox) wrapper.appendChild(summaryBox);
    } else if (currentFacilityId && typeof mhlwService?.ensure === 'function') {
      mhlwService.ensure(currentFacilityId).then((facility) => {
        if (!facility || sanitizeFacilityId(facility.facilityId) !== currentFacilityId) return;
        if (summaryBox) summaryBox.remove();
        summaryBox = renderFacilitySummary(facility);
        if (summaryBox) wrapper.appendChild(summaryBox);
      }).catch((err) => {
        console.warn('[mhlwSync] failed to fetch facility summary', err);
      });
    }

    const statusEl = form.querySelector('[data-status]');
    const facilityIdInput = form.querySelector('input[name="facilityId"]');
    const markMissingButton = form.querySelector('[data-action="mark-missing"]');

    const setStatus = (message, variant = 'info') => {
      if (!statusEl) return;
      statusEl.textContent = message || '';
      const baseClass = 'md:col-span-2 text-xs';
      statusEl.className = baseClass;
      if (variant === 'error') {
        statusEl.classList.add('text-red-600');
      } else if (variant === 'success') {
        statusEl.classList.add('text-emerald-600');
      } else if (variant === 'info') {
        statusEl.classList.add('text-slate-500');
      } else {
        statusEl.classList.add(variant);
      }
    };

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      setStatus('', 'info');
      const facilityId = sanitizeFacilityId(facilityIdInput.value);
      facilityIdInput.value = facilityId;
      if (!facilityId) {
        setStatus('厚労省施設IDを入力してください。', 'error');
        return;
      }
      const apiBase = resolveApiBase();
      const authHeader = await getAuthHeader();
      try {
        await fetchJson(`${apiBase}/api/updateClinic`, {
          method: 'POST',
          headers: authHeader ? { Authorization: authHeader } : {},
          body: { id: clinic.id, name: clinic.name, mhlwFacilityId: facilityId },
        });
        setStatus('厚労省IDを登録しました。データを更新します…', 'info');
        if (typeof onLinked === 'function') {
          onLinked({ facilityId, clinicId: clinic.id, status: 'linked' });
        }
        const refreshed = await refreshClinicFromServer(clinic.id);
        if (refreshed) {
          setStatus('厚労省IDを登録し、最新の情報に更新しました。', 'success');
        } else {
          setStatus('厚労省IDを登録しました。必要に応じてページを再読み込みしてください。', 'info');
        }
      } catch (error) {
        console.error('[mhlwSync] failed to update clinic', error);
        setStatus(error?.payload?.message || error.message || '更新に失敗しました。', 'error');
      }
    });

    const syncButton = form.querySelector('[data-action="sync"]');
    const updateSyncVisibility = () => {
      if (!syncButton) return;
      const hasId = !!sanitizeFacilityId(facilityIdInput.value);
      if (!showSyncButton || !hasId || syncStatus === 'not_found') {
        syncButton.classList.add('hidden');
        syncButton.disabled = true;
      } else {
        syncButton.classList.remove('hidden');
        syncButton.disabled = false;
      }
      if (markMissingButton) {
        if (hasId) {
          markMissingButton.classList.add('hidden');
          markMissingButton.disabled = true;
        } else {
          markMissingButton.classList.remove('hidden');
          markMissingButton.disabled = false;
        }
      }
    };
    updateSyncVisibility();

    if (syncButton) {
      syncButton.addEventListener('click', async () => {
        setStatus('', 'info');
        const facilityId = sanitizeFacilityId(facilityIdInput.value);
        facilityIdInput.value = facilityId;
        if (!facilityId) {
          setStatus('まず厚労省IDを登録してください。', 'error');
          return;
        }
        let facility = lookupFacility(facilityId);
        if (!facility && typeof mhlwService?.ensure === 'function') {
          try {
            facility = await mhlwService.ensure(facilityId);
          } catch (err) {
            console.warn('[mhlwSync] failed to fetch facility for sync', err);
          }
        }
        if (!facility) {
          setStatus(`厚労省データにID ${facilityId} が見つかりません。`, 'error');
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
          setStatus('厚労省データから同期しました。データを更新します…', 'info');
          if (typeof onLinked === 'function') {
            onLinked({ facility, facilityId, clinicId: clinic.id, status: 'linked' });
          }
          const refreshed = await refreshClinicFromServer(clinic.id);
          if (refreshed) {
            setStatus('厚労省データから同期し、最新情報を反映しました。', 'success');
          } else {
            setStatus('厚労省データから同期しました。必要に応じてページを再読み込みしてください。', 'info');
          }
        } catch (error) {
          console.error('[mhlwSync] sync failed', error);
          setStatus(error?.payload?.message || error.message || '同期に失敗しました。', 'error');
        }
      });
    }

    if (markMissingButton) {
      markMissingButton.addEventListener('click', async () => {
        setStatus('', 'info');
        const apiBase = resolveApiBase();
        const authHeader = await getAuthHeader();
        const promptDefault = typeof clinic.mhlwManualNote === 'string' ? clinic.mhlwManualNote : '';
        const noteInput = window.prompt('厚労省データに未掲載の場合は理由や補足を入力してください。（任意）', promptDefault);
        if (noteInput === null) {
          return;
        }
        try {
          const payload = {
            id: clinic.id,
            name: clinic.name,
            mhlwFacilityId: null,
            mhlwSyncStatus: 'not_found',
            mhlwManualNote: noteInput,
          };
          await fetchJson(`${apiBase}/api/updateClinic`, {
            method: 'POST',
            headers: authHeader ? { Authorization: authHeader } : {},
            body: payload,
          });
          facilityIdInput.value = '';
          if (summaryBox) {
            summaryBox.remove();
            summaryBox = null;
          }
          updateSyncVisibility();
          setStatus('厚労省データに未掲載として記録しました。データを更新します…', 'info');
          if (typeof onLinked === 'function') {
            onLinked({ facilityId: null, clinicId: clinic.id, status: 'not_found', manualNote: noteInput });
          }
          const refreshed = await refreshClinicFromServer(clinic.id);
          if (refreshed) {
            setStatus('未掲載として記録し、一覧を更新しました。', 'success');
          } else {
            setStatus('未掲載として記録しました。必要に応じてページを再読み込みしてください。', 'info');
          }
        } catch (error) {
          console.error('[mhlwSync] failed to mark clinic as not found', error);
          setStatus(error?.payload?.message || error.message || '未掲載登録に失敗しました。', 'error');
        }
      });
    }


    const keywordSources = [
      searchKeyword,
      clinic.shortName,
      clinic.name,
      clinic.displayName,
      clinic.officialName,
      clinic.alias,
      clinic.corporationName,
      clinic.nameKana,
    ].filter((value) => typeof value === 'string' && value.trim());

    const performSearch = async ({
      keyword = '',
      fallback = false,
      prefecture = '',
      city = '',
      facilityType = '',
    } = {}) => {
      const params = {
        keyword,
        limit: fallback ? 50 : 25,
        prefecture,
        city,
      };
      if (!params.keyword && !facilityType && !clinic?.facilityType) {
        params.keyword = 'クリ';
      }
      if (facilityType && facilityType !== 'all') {
        params.facilityType = facilityType;
      } else if (clinic?.facilityType) {
        params.facilityType = clinic.facilityType;
      }
      if (!params.prefecture) {
        const fallbackPref = normalizePrefectureName(clinic?.prefecture || clinic?.prefectureName);
        if (fallbackPref) params.prefecture = fallbackPref;
      }
      if (!params.city && clinic?.city) {
        params.city = clinic.city;
      }
      if (typeof mhlwService?.search === 'function') {
        return mhlwService.search(params);
      }
      return fetchMhlwSearch(params);
    };

    const candidateSectionControl = createMhlwCandidateSection({
      clinic,
      searchFn: performSearch,
      keywordCandidates: keywordSources,
      initialKeyword: keywordSources[0] || '',
      onSetStatus: (message, variant) => {
        setStatus(message || '', variant);
      },
      onCandidateSelected: ({ facilityId }) => {
        if (!facilityId) return;
        facilityIdInput.value = facilityId;
        facilityIdInput.focus();
      },
    });
    wrapper.appendChild(candidateSectionControl.element);

    facilityIdInput.addEventListener('input', () => {
      updateSyncVisibility();
    });

    if (showDetailsLink && clinic.id) {
      const footer = document.createElement('div');
      footer.className = 'mt-3 flex flex-wrap items-center gap-3';

      const detailLink = document.createElement('a');
      detailLink.href = `/clinicDetail.html?id=${encodeURIComponent(clinic.id)}`;
      detailLink.className = 'inline-flex items-center gap-2 rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100';
      detailLink.target = '_blank';
      detailLink.rel = 'noopener noreferrer';
      detailLink.textContent = '診療所詳細を開く';

      footer.appendChild(detailLink);
      wrapper.appendChild(footer);
    }

    return wrapper;

  }

  global.MhlwFacilitySearch = global.MhlwFacilitySearch || {};
  Object.assign(global.MhlwFacilitySearch, {
    createCandidateSection: createMhlwCandidateSection,
    findCandidates: (options) => findMhlwCandidates(options),
  });

  function init() {
    const clinicList = document.getElementById('clinicList');
    const clinicListStatus = document.getElementById('clinicListStatus');
    const manualClinicList = document.getElementById('manualClinicList');
    const manualClinicListStatus = document.getElementById('manualClinicListStatus');
    const linkedClinicList = document.getElementById('linkedClinicList');
    const linkedClinicListStatus = document.getElementById('linkedClinicListStatus');
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
    let clinicsCache = null;
    let clinicsLoading = false;

    function updateClinicCache(clinicId, updater = {}) {
      if (!Array.isArray(clinicsCache) || !clinicId) return;
      const index = clinicsCache.findIndex((item) => item && item.id === clinicId);
      if (index === -1) return;
      const next = { ...clinicsCache[index], ...updater };
      clinicsCache.splice(index, 1, next);
    }

    function moveClinicBetweenLists(clinicId, updater = {}) {
      updateClinicCache(clinicId, updater);
      renderClinicLists();
    }
    async function refreshClinicFromServer(clinicId) {
      if (!clinicId) return null;
      const refreshed = await fetchClinicDetail(clinicId);
      if (!refreshed) return null;
      moveClinicBetweenLists(clinicId, refreshed);
      return refreshed;
    }
    const mhlwService = {
      lookup: getCachedFacility,
      ensure: ensureFacilityCached,
      search: (params) => fetchMhlwSearch(params),
    };

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
      const updatedLabel = meta.updatedAt ? formatTimestamp(meta.updatedAt) : '不明';
      parts.push(`<span class="font-semibold">${updatedLabel}</span>`);
      if (typeof meta.facilityCount === 'number') {
        parts.push(`施設件数: ${meta.facilityCount.toLocaleString()} 件`);
      }
      if (typeof meta.scheduleCount === 'number') {
        parts.push(`診療時間レコード: ${meta.scheduleCount.toLocaleString()} 件`);
      }
      if (typeof meta.size === 'number') {
        parts.push(`サイズ: ${formatBytes(meta.size)}`);
      }
      if (meta.etag) {
        parts.push(`ETag: ${meta.etag}`);
      }
      if (meta.sourceType) {
        const sourceLabel = meta.sourceType === 'd1' ? 'D1' : meta.sourceType;
        parts.push(`ソース: ${sourceLabel}`);
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

    function renderClinicLists() {
      if (clinicList) clinicList.innerHTML = '';
      if (manualClinicList) manualClinicList.innerHTML = '';
      if (linkedClinicList) linkedClinicList.innerHTML = '';

      if (clinicsLoading) {
        if (clinicListStatus) clinicListStatus.textContent = '未紐付けの診療所を読み込み中です…';
        if (manualClinicListStatus) manualClinicListStatus.textContent = '未掲載として登録済みの診療所を読み込み中です…';
        if (linkedClinicListStatus) linkedClinicListStatus.textContent = '厚労省ID設定済みの診療所を読み込み中です…';
        return;
      }

      if (!Array.isArray(clinicsCache)) {
        if (clinicListStatus) clinicListStatus.textContent = '診療所一覧を取得できませんでした。再読み込みをお試しください。';
        if (manualClinicListStatus) manualClinicListStatus.textContent = '診療所一覧を取得できませんでした。';
        if (linkedClinicListStatus) linkedClinicListStatus.textContent = '診療所一覧を取得できませんでした。';
        return;
      }

      const pending = [];
      const manualResolved = [];
      const linked = [];
      clinicsCache.forEach((clinic) => {
        const hasId = Boolean(sanitizeFacilityId(clinic.mhlwFacilityId));
        const status = normalizeSyncStatus(clinic.mhlwSyncStatus);
        if (hasId) {
          linked.push(clinic);
        } else if (isManualSyncStatus(status)) {
          manualResolved.push(clinic);
        } else {
          pending.push(clinic);
        }
      });

      if (pending.length === 0) {
        if (clinicListStatus) clinicListStatus.textContent = '厚労省ID未登録の診療所はありません。';
      } else {
        pending.sort((a, b) => (a?.name || '').localeCompare(b?.name || '', 'ja'));
        if (clinicListStatus) clinicListStatus.textContent = `厚労省ID未設定の診療所: ${pending.length} 件`;
        if (clinicList) {
          pending.forEach((clinic) => {
            clinicList.appendChild(buildClinicCard(
              clinic,
              mhlwService,
              {
                searchKeyword: clinic?.name || '',
                onLinked: ({ facilityId, status, manualNote }) => {
                  const normalizedId = sanitizeFacilityId(facilityId);
                  const update = {
                    mhlwFacilityId: normalizedId || null,
                    mhlwSyncStatus: status ? normalizeSyncStatus(status) : (normalizedId ? 'linked' : normalizeSyncStatus(clinic.mhlwSyncStatus)),
                    updated_at: Math.floor(Date.now() / 1000),
                  };
                  if (manualNote !== undefined) {
                    update.mhlwManualNote = manualNote;
                  } else if (normalizedId) {
                    update.mhlwManualNote = null;
                  }
                  moveClinicBetweenLists(clinic.id, update);
                },
                showSyncButton: false,
                showDetailsLink: false,
              },
            ));
          });
        }
      }

      if (manualResolved.length === 0) {
        if (manualClinicListStatus) manualClinicListStatus.textContent = '厚労省データ未掲載として登録済みの診療所はありません。';
      } else {
        manualResolved.sort((a, b) => (a?.name || '').localeCompare(b?.name || '', 'ja'));
        if (manualClinicListStatus) manualClinicListStatus.textContent = `厚労省データ未掲載扱い: ${manualResolved.length} 件`;
        if (manualClinicList) {
          manualResolved.forEach((clinic) => {
            manualClinicList.appendChild(buildClinicCard(
              clinic,
              mhlwService,
              {
                searchKeyword: clinic?.name || '',
                onLinked: ({ facilityId, status, manualNote }) => {
                  const normalizedId = sanitizeFacilityId(facilityId);
                  const update = {
                    mhlwFacilityId: normalizedId || null,
                    mhlwSyncStatus: status ? normalizeSyncStatus(status) : normalizeSyncStatus(clinic.mhlwSyncStatus),
                    updated_at: Math.floor(Date.now() / 1000),
                  };
                  if (manualNote !== undefined) {
                    update.mhlwManualNote = manualNote;
                  } else if (normalizedId) {
                    update.mhlwManualNote = null;
                  }
                  moveClinicBetweenLists(clinic.id, update);
                },
                showSyncButton: true,
                showDetailsLink: false,
              },
            ));
          });
        }
      }

      if (linked.length === 0) {
        if (linkedClinicListStatus) linkedClinicListStatus.textContent = '厚労省ID設定済みの診療所はありません。';
      } else {
        linked.sort((a, b) => (a?.name || '').localeCompare(b?.name || '', 'ja'));
        if (linkedClinicListStatus) linkedClinicListStatus.textContent = `厚労省ID設定済み: ${linked.length} 件`;
        if (linkedClinicList) {
          linked.forEach((clinic) => {
            linkedClinicList.appendChild(buildClinicCard(
              clinic,
              mhlwService,
              {
                searchKeyword: clinic?.name || '',
                onLinked: ({ facility, facilityId, status, manualNote }) => {
                  const normalizedId = sanitizeFacilityId(facilityId || clinic.mhlwFacilityId);
                  const update = {
                    mhlwFacilityId: normalizedId || null,
                    mhlwSyncStatus: status ? normalizeSyncStatus(status) : normalizeSyncStatus(clinic.mhlwSyncStatus),
                    updated_at: Math.floor(Date.now() / 1000),
                  };
                  if (manualNote !== undefined) {
                    update.mhlwManualNote = manualNote;
                  } else if (normalizedId) {
                    update.mhlwManualNote = null;
                  }
                  if (facility?.facilityId) {
                    update.mhlwFacilityId = sanitizeFacilityId(facility.facilityId);
                  }
                  moveClinicBetweenLists(clinic.id, update);
                },
                showSyncButton: true,
                showDetailsLink: true,
              },
            ));
          });
        }
      }
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
        if (previewEl) {
          previewEl.classList.remove('text-red-600', 'bg-red-50');
        }
        renderMhlwPreview(mhlwDict, previewEl);
      } catch (err) {
        mhlwDict = {};
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
      renderClinicLists();
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
      renderClinicLists();
      try {
        const clinics = await fetchClinics(force ? '' : undefined);
        clinicsCache = Array.isArray(clinics) ? clinics : [];
      } catch (err) {
        console.error('[mhlwSync] failed to fetch clinics', err);
        clinicsCache = null;
        if (clinicListStatus) {
          clinicListStatus.textContent = err?.message || '診療所一覧の取得に失敗しました。';
        }
        if (linkedClinicListStatus) {
          linkedClinicListStatus.textContent = err?.message || '診療所一覧の取得に失敗しました。';
        }
      } finally {
        clinicsLoading = false;
        renderClinicLists();
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

        const jsonParts = [];
        jsonParts.push(`{"count":${facilityCount},"facilities":[`);
        dataset.facilities.forEach((facility, index) => {
          jsonParts.push(JSON.stringify(facility));
          if (index !== dataset.facilities.length - 1) {
            jsonParts.push(',');
          }
        });
        jsonParts.push(']}');
        const rawBlob = new Blob(jsonParts, { type: 'application/json' });

        let directPayloadPromise = null;
        const getDirectPayload = () => {
          if (!directPayloadPromise) {
            directPayloadPromise = prepareDirectUploadPayload(null, rawBlob);
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
