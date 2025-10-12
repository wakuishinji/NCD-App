import { ensureUniqueId, normalizeSlug, randomSlug } from './idUtils.js';

const MASTER_TYPE_LIST = ['test', 'service', 'qual', 'department', 'facility', 'symptom', 'bodySite', 'society'];
const MASTER_ALLOWED_TYPES = new Set(MASTER_TYPE_LIST);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // 共通CORSヘッダー
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    // ===== OPTIONS (CORSプリフライト)
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    if (url.pathname.startsWith('/assets/')) {
      if (!env.MEDIA) {
        return new Response('R2 bucket is not configured.', { status: 500 });
      }
      const key = decodeURIComponent(url.pathname.replace(/^\/assets\//, ''));
      if (!key) {
        return new Response('Bad Request', { status: 400 });
      }
      const object = await env.MEDIA.get(key);
      if (!object) {
        return new Response('Not Found', { status: 404 });
      }
      const headers = new Headers({
        'Cache-Control': 'public, max-age=86400',
      });
      if (object.httpMetadata?.contentType) {
        headers.set('Content-Type', object.httpMetadata.contentType);
      }
      if (object.httpMetadata?.contentDisposition) {
        headers.set('Content-Disposition', object.httpMetadata.contentDisposition);
      }
      return new Response(object.body, { headers });
    }

    // ============================================================
    // <<< START: UTILS >>>
    // ============================================================
    const SCHEMA_VERSION = 1; // 施設スキーマのバージョン

    function nk(s) { return (s || "").trim(); }

    function optionalString(value) {
      const trimmed = nk(value);
      return trimmed ? trimmed : null;
    }

    function normalizeStringArray(value) {
      if (Array.isArray(value)) {
        return Array.from(new Set(value.map(v => nk(v)).filter(Boolean)));
      }
      if (typeof value === "string") {
        const single = nk(value);
        return single ? [single] : [];
      }
      return [];
    }

    const EXPLANATION_STATUS_SET = new Set(["draft", "published", "archived"]);

    function sanitizeExplanationStatus(value) {
      const raw = (value || "").toString().trim().toLowerCase();
      if (EXPLANATION_STATUS_SET.has(raw)) {
        return raw;
      }
      return "draft";
    }

    function ensureExplanationArray(item) {
      if (!item || typeof item !== "object") return [];
      if (!Array.isArray(item.explanations)) {
        item.explanations = [];
      }
      return item.explanations;
    }

    function sanitizeExistingExplanation(raw, fallbackStatus = "draft") {
      if (!raw || typeof raw !== "object") return null;
      const text = nk(raw.text || raw.baseText || raw.desc);
      if (!text) return null;
      const id = nk(raw.id);
      const now = Math.floor(Date.now() / 1000);
      const createdAtNum = Number(raw.createdAt);
      const updatedAtNum = Number(raw.updatedAt);
      const audience = nk(raw.audience);
      const context = nk(raw.context);
      const source = nk(raw.source);
      return {
        id: id || crypto.randomUUID(),
        text,
        status: sanitizeExplanationStatus(raw.status || fallbackStatus),
        audience: audience || null,
        context: context || null,
        source: source || null,
        createdAt: Number.isFinite(createdAtNum) ? createdAtNum : now,
        updatedAt: Number.isFinite(updatedAtNum) ? updatedAtNum : now,
      };
    }

    function normalizeItemExplanations(item, { fallbackStatus = "draft" } = {}) {
      if (!item || typeof item !== "object") return [];
      const explanations = ensureExplanationArray(item);
      const sanitized = [];
      const seenTexts = new Set();
      const now = Math.floor(Date.now() / 1000);

      for (const entry of explanations) {
        const sanitizedEntry = sanitizeExistingExplanation(entry, fallbackStatus);
        if (!sanitizedEntry) continue;
        const key = sanitizedEntry.text;
        if (seenTexts.has(key)) {
          const existing = sanitized.find(e => e.text === key);
          if (existing) {
            existing.updatedAt = Math.max(existing.updatedAt, sanitizedEntry.updatedAt || now);
            if (!existing.audience && sanitizedEntry.audience) existing.audience = sanitizedEntry.audience;
            if (!existing.context && sanitizedEntry.context) existing.context = sanitizedEntry.context;
            if (!existing.source && sanitizedEntry.source) existing.source = sanitizedEntry.source;
            if (sanitizedEntry.status === "published" && existing.status !== "published") {
              existing.status = "published";
            }
          }
          continue;
        }
        seenTexts.add(key);
        sanitized.push(sanitizedEntry);
      }

      // 旧データへのフォールバック: desc や desc_samples から生成
      if (!sanitized.length) {
        const candidates = [];
        if (typeof item.desc === "string" && item.desc.trim()) {
          candidates.push(item.desc.trim());
        }
        if (Array.isArray(item.desc_samples)) {
          for (const sample of item.desc_samples) {
            if (typeof sample === "string" && sample.trim()) {
              candidates.push(sample.trim());
            }
          }
        }
        for (const candidate of candidates) {
          if (seenTexts.has(candidate)) continue;
          seenTexts.add(candidate);
          sanitized.push({
            id: crypto.randomUUID(),
            text: candidate,
            status: fallbackStatus,
            audience: null,
            context: null,
            source: null,
            createdAt: now,
            updatedAt: now,
          });
        }
      }

      item.explanations = sanitized;
      if (!Array.isArray(item.desc_samples)) {
        item.desc_samples = [];
      }

      const sampleSet = new Set(item.desc_samples.filter(s => typeof s === "string" && s));
      for (const entry of sanitized) {
        if (!sampleSet.has(entry.text)) {
          item.desc_samples.push(entry.text);
          sampleSet.add(entry.text);
        }
      }

      if (!nk(item.desc) && sanitized.length) {
        const published = sanitized.find(s => s.status === "published");
        item.desc = (published || sanitized[0]).text;
      }

      return item.explanations;
    }

    function addExplanationToItem(item, payload = {}, options = {}) {
      if (!item || typeof item !== "object") return null;
      const text = nk(payload.text || payload.baseText || payload.desc);
      if (!text) return null;
      const status = sanitizeExplanationStatus(payload.status || options.defaultStatus || "draft");
      const audience = nk(payload.audience);
      const context = nk(payload.context);
      const source = nk(payload.source);
      const explanations = ensureExplanationArray(item);
      const now = Math.floor(Date.now() / 1000);

      const existing = explanations.find(entry => nk(entry.text) === text);
      if (existing) {
        existing.updatedAt = now;
        existing.status = sanitizeExplanationStatus(payload.status || existing.status);
        if (audience) existing.audience = audience;
        if (context) existing.context = context;
        if (source && !existing.source) existing.source = source;
        return existing;
      }

      const entry = {
        id: crypto.randomUUID(),
        text,
        status,
        audience: audience || null,
        context: context || null,
        source: source || null,
        createdAt: now,
        updatedAt: now,
      };
      explanations.push(entry);
      if (!Array.isArray(item.desc_samples)) {
        item.desc_samples = [];
      }
      if (!item.desc_samples.includes(text)) {
        item.desc_samples.push(text);
      }
      if (!nk(item.desc)) {
        item.desc = text;
      }
      return entry;
    }

    function syncExplanationDerivedFields(item) {
      if (!item || typeof item !== "object") return;
      const explanations = normalizeItemExplanations(item);
      if (!Array.isArray(explanations) || !explanations.length) {
        return;
      }
      const published = explanations.find(entry => entry.status === "published");
      if (!nk(item.desc)) {
        item.desc = (published || explanations[0]).text;
      }
      if (!Array.isArray(item.desc_samples)) {
        item.desc_samples = [];
      }
      const sampleSet = new Set(item.desc_samples.filter(s => typeof s === 'string' && s));
      explanations.forEach(entry => {
        if (!sampleSet.has(entry.text)) {
          item.desc_samples.push(entry.text);
          sampleSet.add(entry.text);
        }
      });
    }

    // 正規化キー（マスター用）
    function normalizeKey(type, category, name) {
      const zenkakuToHankaku = (s) => s.normalize("NFKC");
      const clean = (s) =>
        zenkakuToHankaku((s || "").trim().toLowerCase().replace(/\s+/g, ""));
      return `master:${type}:${clean(category)}|${clean(name)}`;
    }

    function normalizeForSimilarity(s) {
      return (s || "")
        .normalize("NFKC")
        .toLowerCase()
        .replace(/[\s\u3000・･\-ー（）()]/g, "");
    }

    function normalizeThesaurusTerm(s) {
      return (s || "")
        .normalize("NFKC")
        .trim()
        .toLowerCase();
    }

    function sanitizeKeySegment(value) {
      if (!value) return '';
      return value
        .normalize('NFKC')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '');
    }

    function comparableMasterKey(type, category, name) {
      const t = sanitizeKeySegment(type);
      const c = sanitizeKeySegment(category);
      const n = sanitizeKeySegment(name);
      if (!t || !c || !n) return null;
      return `${t}:${c}|${n}`;
    }

    function parseMasterKeyLoose(key) {
      if (!key) return null;
      let raw = key.trim();
      if (raw.startsWith('master:')) {
        raw = raw.substring(7);
      }
      const typeSep = raw.indexOf(':');
      if (typeSep === -1) return null;
      const type = raw.substring(0, typeSep);
      const rest = raw.substring(typeSep + 1);
      const nameSep = rest.indexOf('|');
      if (nameSep === -1) return null;
      const category = rest.substring(0, nameSep);
      const name = rest.substring(nameSep + 1);
      const comparable = comparableMasterKey(type, category, name);
      return comparable ? { type, category, name, comparable } : null;
    }

    async function loadMasterItemsRaw(env, type) {
      const prefix = `master:${type}:` ;
      let cursor = undefined;
      const out = [];
      do {
        const page = await env.SETTINGS.list({ prefix, cursor });
        for (const entry of page.keys || []) {
          const key = entry.name;
          if (!key) continue;
          const raw = await env.SETTINGS.get(key);
          if (!raw) continue;
          try {
            const obj = JSON.parse(raw);
            obj._key = key;
            if (!obj.type) obj.type = type;
            out.push(obj);
          } catch (err) {
            console.warn('failed to parse master item (raw)', key, err);
          }
        }
        cursor = page.cursor;
        if (page.list_complete) break;
      } while (cursor);
      return out;
    }

    function masterKeyFromParts(type, category, name) {
      if (!type || !category || !name) return null;
      return `master:${type}:${category}|${name}`;
    }

    function collectMasterKeyCandidates(entry, fallbackType) {
      if (!entry || typeof entry !== 'object') return [];
      const keys = [];
      const possibleProps = ['masterKey', 'masterkey', 'master_key'];
      for (const prop of possibleProps) {
        const value = entry[prop];
        if (typeof value === 'string' && value.trim()) {
          keys.push(value.trim());
        }
      }
      const type = typeof entry.type === 'string' && entry.type ? entry.type : fallbackType;
      const category = entry.category;
      const name = entry.name;
      if (type && category && name) {
        keys.push(`master:${type}:${category}|${name}`);
      }
      return keys;
    }

    function extractComparableKeys(entry, fallbackType) {
      const keys = new Set();
      for (const candidate of collectMasterKeyCandidates(entry, fallbackType)) {
        const parsed = parseMasterKeyLoose(candidate);
        if (!parsed) continue;
        const expectedType = fallbackType || parsed.type;
        if (expectedType && parsed.type !== expectedType) continue;
        if (parsed.comparable) {
          keys.add(parsed.comparable);
        }
      }
      return Array.from(keys);
    }

    function normalizeBodySiteRef(ref) {
      if (!ref) return null;
      let raw = ref.trim();
      if (!raw) return null;
      const lower = raw.toLowerCase();
      if (lower.startsWith('bodysite:')) {
        raw = raw.substring('bodysite:'.length);
      }
      const normalized = sanitizeKeySegment(raw);
      if (!normalized) return null;
      return `bodysite:${normalized}`;
    }

    function bodySiteRefCandidates(item) {
      const refs = new Set();
      if (!item || typeof item !== 'object') return Array.from(refs);
      const values = [item.canonical_name, item.name, item.category];
      for (const value of values) {
        const normalized = normalizeBodySiteRef(value);
        if (normalized) refs.add(normalized);
      }
      return Array.from(refs);
    }

    function extractNameAndNote(name) {
      const value = nk(name);
      if (!value) {
        return { base: "", note: "" };
      }
      const match = value.match(/^(.*?)[(（]([^()（）]+)[)）]\s*$/);
      if (!match) {
        return { base: value, note: "" };
      }
      const base = nk(match[1]);
      const note = nk(match[2]);
      return { base: base || value, note };
    }

    function mergeNotes(...inputs) {
      const collected = [];
      for (const input of inputs) {
        if (!input) continue;
        if (Array.isArray(input)) {
          for (const value of input) {
            const trimmed = nk(value);
            if (trimmed) collected.push(trimmed);
          }
        } else {
          const trimmed = nk(input);
          if (trimmed) collected.push(trimmed);
        }
      }
      const unique = Array.from(new Set(collected));
      return unique.join(' / ');
    }

    function inferQualClassification(category, current) {
      const existing = nk(current);
      if (existing) return existing;
      const cat = nk(category);
      if (/看護/.test(cat)) return '看護';
      if (/療法|リハビリ|技師|技術/.test(cat)) return 'コメディカル';
      if (/事務|管理/.test(cat)) return '事務';
      return '医師';
    }

    function jaroWinkler(a, b) {
      if (!a || !b) return 0;
      if (a === b) return 1;
      const matchDistance = Math.floor(Math.max(a.length, b.length) / 2) - 1;
      const aMatches = new Array(a.length).fill(false);
      const bMatches = new Array(b.length).fill(false);
      let matches = 0;
      let transpositions = 0;

      for (let i = 0; i < a.length; i++) {
        const start = Math.max(0, i - matchDistance);
        const end = Math.min(i + matchDistance + 1, b.length);
        for (let j = start; j < end; j++) {
          if (bMatches[j]) continue;
          if (a[i] !== b[j]) continue;
          aMatches[i] = true;
          bMatches[j] = true;
          matches++;
          break;
        }
      }

      if (matches === 0) return 0;

      let k = 0;
      for (let i = 0; i < a.length; i++) {
        if (!aMatches[i]) continue;
        while (!bMatches[k]) k++;
        if (a[i] !== b[k]) transpositions++;
        k++;
      }

      const m = matches;
      const jaro = (m / a.length + m / b.length + (m - transpositions / 2) / m) / 3;

      let prefix = 0;
      for (let i = 0; i < Math.min(4, a.length, b.length); i++) {
        if (a[i] === b[i]) prefix++;
        else break;
      }
      return jaro + prefix * 0.1 * (1 - jaro);
    }

    // KV JSONユーティリティ
    async function kvGetJSON(env, key) {
      const raw = await env.SETTINGS.get(key);
      if (!raw) return null;
      try { return JSON.parse(raw); } catch { return null; }
    }
    async function kvPutJSON(env, key, obj) {
      return env.SETTINGS.put(key, JSON.stringify(obj));
    }

    // 施設: 取得/保存
    async function getClinicById(env, id) {
      return kvGetJSON(env, `clinic:id:${id}`);
    }
    async function getClinicByName(env, name) {
      const idx = await env.SETTINGS.get(`clinic:name:${name}`);
      if (idx) return getClinicById(env, idx);
      // 互換: 旧キー
      return kvGetJSON(env, `clinic:${name}`);
    }
    async function saveClinic(env, clinic) {
      const now = Math.floor(Date.now()/1000);
      clinic.schema_version = SCHEMA_VERSION;
      clinic.updated_at = now;
      let existing = null;
      if (clinic.id) {
        existing = await getClinicById(env, clinic.id);
      }
      if (!clinic.id && clinic.name) {
        existing = await getClinicByName(env, clinic.name);
        if (existing?.id) {
          clinic.id = existing.id;
        }
      }
      if (!clinic.id) {
        clinic.id = crypto.randomUUID();
        clinic.created_at = now;
      } else if (!clinic.created_at && existing?.created_at) {
        clinic.created_at = existing.created_at;
      }
      if (existing?.name && existing.name !== clinic.name) {
        await env.SETTINGS.delete(`clinic:name:${existing.name}`).catch(() => {});
        await env.SETTINGS.delete(`clinic:${existing.name}`).catch(() => {});
      }
      if (clinic.name) {
        await env.SETTINGS.put(`clinic:name:${clinic.name}`, clinic.id);
        await kvPutJSON(env, `clinic:${clinic.name}`, clinic); // 互換
      }
      await kvPutJSON(env, `clinic:id:${clinic.id}`, clinic);
      return clinic;
    }
    async function listClinicsKV(env, {limit=2000, offset=0} = {}) {
      const prefix = "clinic:id:";
      const ids = [];
      let cursor;
      do {
        const page = await env.SETTINGS.list({ prefix, cursor });
        const batchIds = page.keys.map(k => k.name.replace(prefix, ""));
        ids.push(...batchIds);
        cursor = page.cursor || null;
      } while (cursor);
      const total = ids.length;
      const start = Math.max(0, offset);
      const end = Math.max(start, start + limit);
      const pageIds = ids.slice(start, end);
      const values = await Promise.all(pageIds.map(id => getClinicById(env, id)));
      const out = values.filter(Boolean);
      return { items: out, total };
    }
    // <<< END: UTILS >>>

    const TODO_KEY = "todo:list";
    const MASTER_CACHE_PREFIX = 'mastercache:';
    const MASTER_CACHE_TTL_SECONDS = 300;
    const PERSONAL_QUAL_CLASSIFICATIONS = ["医師", "看護", "コメディカル", "事務", "その他"];
    const FACILITY_ACCREDITATION_TYPES = ["学会認定", "行政・公費", "地域・在宅"];

    function masterCacheKey(type, status) {
      const normalizedType = type || '__all__';
      const normalizedStatus = status || '__all__';
      return `${MASTER_CACHE_PREFIX}${normalizedType}:${normalizedStatus}`;
    }

    async function getMasterCache(env, type, status) {
      try {
        const key = masterCacheKey(type, status);
        const cachedStr = await env.SETTINGS.get(key);
        if (!cachedStr) return null;
        const cached = JSON.parse(cachedStr);
        if (!cached || typeof cached !== 'object') return null;
        const age = Date.now() - (cached.ts || 0);
        if (age > MASTER_CACHE_TTL_SECONDS * 1000) {
          return null;
        }
        if (!Array.isArray(cached.items)) {
          return null;
        }
        return cached.items;
      } catch (err) {
        console.warn('failed to read master cache', err);
        return null;
      }
    }

    async function setMasterCache(env, type, status, items) {
      try {
        const key = masterCacheKey(type, status);
        await env.SETTINGS.put(key, JSON.stringify({ ts: Date.now(), items }), {
          expirationTtl: MASTER_CACHE_TTL_SECONDS,
        });
      } catch (err) {
        console.warn('failed to write master cache', err);
      }
    }

    async function invalidateMasterCache(env, type) {
      const prefix = type ? `${MASTER_CACHE_PREFIX}${type}:` : MASTER_CACHE_PREFIX;
      const list = await env.SETTINGS.list({ prefix });
      await Promise.all(list.keys.map(k => env.SETTINGS.delete(k.name).catch(() => {})));
    }
    const DEFAULT_TODOS = [
      {
        category: "フロントエンド",
        title: "フォームバリデーション実装",
        status: "open",
        priority: "P1",
        createdAt: "2025-01-01T09:00:00+09:00",
      },
      {
        category: "サーバー",
        title: "Let’s Encrypt 自動更新",
        status: "done",
        priority: "P2",
        createdAt: "2025-01-05T09:00:00+09:00",
      },
    ];

    // ============================================================
    // <<< START: ROUTE_MATCH >>>
    // ============================================================
    // /api/... と /api/v1/... を同一処理へマッピング
    function routeMatch(url, method, pathNoVer) {
      if (request.method !== method) return false;
      return (
        url.pathname === `/api/${pathNoVer}` ||
        url.pathname === `/api/v1/${pathNoVer}`
      );
    }
    // <<< END: ROUTE_MATCH >>>

    const MEDIA_SLOTS = new Set(["logoSmall", "logoLarge", "facade"]);
    const MODE_MASTER_PREFIX = 'master:mode:';
    const MODE_ID_MAX_LENGTH = 64;
    const MASTER_ID_MAX_LENGTH = 80;
    const LEGACY_POINTER_PREFIX = 'legacyPointer:';

    const normalizeModeId = (value) => normalizeSlug(value, { maxLength: MODE_ID_MAX_LENGTH });
    const SERVICE_EXPLANATION_PREFIX = 'master:serviceExplanation:';
    const TEST_EXPLANATION_PREFIX = 'master:testExplanation:';

    const legacyPointerKey = (alias) => `${LEGACY_POINTER_PREFIX}${alias}`;

    async function listModes(env) {
      const prefix = MODE_MASTER_PREFIX;
      const list = await env.SETTINGS.list({ prefix });
      const out = [];
      for (const key of list.keys) {
        try {
          const raw = await env.SETTINGS.get(key.name);
          if (!raw) continue;
          const obj = JSON.parse(raw);
          if (!obj || typeof obj !== 'object') continue;
          obj.id = key.name.replace(prefix, '');
          out.push(obj);
        } catch (err) {
          console.warn('failed to parse mode master', key.name, err);
        }
      }
      out.sort((a, b) => {
        const oa = Number.isFinite(a.order) ? a.order : 999;
        const ob = Number.isFinite(b.order) ? b.order : 999;
        if (oa !== ob) return oa - ob;
        return (a.label || '').localeCompare(b.label || '', 'ja');
      });
      return out;
    }

    async function sanitizeModePayload(env, payload = {}) {
      if (!payload || typeof payload !== 'object') {
        throw new Error('payload is required');
      }
      const label = nk(payload.label);
      if (!label) {
        throw new Error('label is required');
      }
      const description = nk(payload.description);
      const icon = nk(payload.icon);
      const orderValue = Number(payload.order);
      const active = payload.active !== false;
      const color = nk(payload.color);
      const tags = Array.isArray(payload.tags)
        ? Array.from(new Set(payload.tags.map((item) => nk(item)).filter(Boolean)))
        : [];

      const providedIdRaw = nk(payload.id || payload.slug);
      const normalizedProvidedId = normalizeModeId(providedIdRaw);
      const isUpdate = Boolean(payload.id);
      let slug = normalizedProvidedId;

      if (isUpdate) {
        if (!slug) {
          throw new Error('id is required');
        }
      } else {
        const baseCandidate = slug || normalizeModeId(label) || normalizeModeId(payload.slug);
        slug = await ensureUniqueId({
          kv: env.SETTINGS,
          prefix: MODE_MASTER_PREFIX,
          candidate: baseCandidate,
          normalize: normalizeModeId,
          fallback: () => normalizeModeId(randomSlug(MODE_ID_MAX_LENGTH)),
          randomLength: MODE_ID_MAX_LENGTH,
        });
      }

      if (!slug) {
        slug = await ensureUniqueId({
          kv: env.SETTINGS,
          prefix: MODE_MASTER_PREFIX,
          candidate: normalizeModeId(randomSlug(MODE_ID_MAX_LENGTH)),
          normalize: normalizeModeId,
          randomLength: MODE_ID_MAX_LENGTH,
        });
      }

      return {
        slug,
        label,
        description,
        icon,
        order: Number.isFinite(orderValue) ? orderValue : null,
        active,
        color,
        tags,
      };
    }

    const masterPrefix = (type) => `master:${type}:`;

    const masterIdKey = (type, id) => `${masterPrefix(type)}${id}`;

    async function migrateLegacyPointer(env, alias, pointerRaw) {
      if (!alias) return;
      await env.SETTINGS.put(legacyPointerKey(alias), pointerRaw);
      await env.SETTINGS.delete(alias).catch(() => {});
    }

    async function getLegacyPointer(env, alias) {
      if (!alias) return null;
      const raw = await env.SETTINGS.get(legacyPointerKey(alias));
      if (!raw) return null;
      try {
        const obj = JSON.parse(raw);
        return isLegacyPointer(obj) ? obj : null;
      } catch (_) {
        return null;
      }
    }

    function ensureLegacyAlias(record, alias) {
      if (!alias) return;
      if (!Array.isArray(record.legacyAliases)) {
        record.legacyAliases = [];
      }
      if (!record.legacyAliases.includes(alias)) {
        record.legacyAliases.push(alias);
      }
    }

    async function writeLegacyPointer(env, type, alias, record) {
      if (!alias) return;
      const pointer = {
        legacy: true,
        type,
        id: record.id,
        name: record.name,
        category: record.category,
        updatedAt: record.updated_at || Math.floor(Date.now() / 1000),
      };
      await migrateLegacyPointer(env, alias, JSON.stringify(pointer));
    }

    async function writeMasterRecord(env, type, record) {
      if (!record || typeof record !== 'object' || !record.id) {
        throw new Error('record id is required');
      }
      const key = masterIdKey(type, record.id);
      const aliasSet = new Set();
      if (record.legacyKey) aliasSet.add(record.legacyKey);
      if (Array.isArray(record.legacyAliases)) {
        for (const alias of record.legacyAliases) {
          if (alias) aliasSet.add(alias);
        }
      }
      const aliases = Array.from(aliasSet);
      const payload = { ...record, type, legacyAliases: aliases };
      record.legacyAliases = aliases;
      await env.SETTINGS.put(key, JSON.stringify(payload));
      for (const alias of aliases) {
        await writeLegacyPointer(env, type, alias, payload);
      }
    }

    async function loadMasterById(env, type, id) {
      if (!id) return null;
      const raw = await env.SETTINGS.get(masterIdKey(type, id));
      if (!raw) return null;
      try {
        const obj = JSON.parse(raw);
        if (obj && !obj.id) {
          obj.id = id;
        }
        return obj;
      } catch (_) {
        return null;
      }
    }

    function isLegacyPointer(obj) {
      return obj && typeof obj === 'object' && obj.legacy === true && typeof obj.id === 'string';
    }

    function masterIdCandidate(category, name) {
      const parts = [
        normalizeSlug(category, { maxLength: 32 }),
        normalizeSlug(name, { maxLength: 48 }),
      ].filter(Boolean);
      return parts.join('-');
    }

    async function promoteLegacyMasterRecord(env, type, legacyKey, legacyRecord) {
      if (!legacyRecord || typeof legacyRecord !== 'object') {
        return null;
      }
      const candidate = masterIdCandidate(legacyRecord.category, legacyRecord.name);
      const stableId = await ensureUniqueId({
        kv: env.SETTINGS,
        prefix: masterPrefix(type),
        candidate,
        normalize: (value) => normalizeSlug(value, { maxLength: MASTER_ID_MAX_LENGTH }),
        fallback: () => normalizeSlug(randomSlug(16), { maxLength: MASTER_ID_MAX_LENGTH }),
        randomLength: MASTER_ID_MAX_LENGTH,
      });
      const now = Math.floor(Date.now() / 1000);
      const record = {
        ...legacyRecord,
        id: stableId,
        type: legacyRecord.type || type,
        legacyKey,
        legacyAliases: Array.isArray(legacyRecord.legacyAliases)
          ? Array.from(new Set([...legacyRecord.legacyAliases, legacyKey]))
          : (legacyKey ? [legacyKey] : []),
      };
      if (!record.created_at) {
        record.created_at = now;
      }
      record.updated_at = now;
      await writeMasterRecord(env, type, record);
      return record;
    }

    async function getMasterRecordByLegacy(env, type, legacyKey) {
      if (!legacyKey) return null;
      const pointerNew = await getLegacyPointer(env, legacyKey);
      if (pointerNew) {
        return loadMasterById(env, type, pointerNew.id);
      }
      const raw = await env.SETTINGS.get(legacyKey);
      if (!raw) return null;
      let parsed = null;
      try {
        parsed = JSON.parse(raw);
      } catch (_) {
        return null;
      }
      if (isLegacyPointer(parsed)) {
        await migrateLegacyPointer(env, legacyKey, raw);
        return loadMasterById(env, type, parsed.id);
      }
      return promoteLegacyMasterRecord(env, type, legacyKey, parsed);
    }

    async function getOrCreateMasterRecord(env, { type, category, name }) {
      const legacyKeyCurrent = normalizeKey(type, category, name);
      let record = await getMasterRecordByLegacy(env, type, legacyKeyCurrent);
      let created = false;
      if (!record) {
        const candidate = masterIdCandidate(category, name);
        const id = await ensureUniqueId({
          kv: env.SETTINGS,
          prefix: masterPrefix(type),
          candidate,
          normalize: (value) => normalizeSlug(value, { maxLength: MASTER_ID_MAX_LENGTH }),
          fallback: () => normalizeSlug(randomSlug(16), { maxLength: MASTER_ID_MAX_LENGTH }),
          randomLength: MASTER_ID_MAX_LENGTH,
        });
        const now = Math.floor(Date.now() / 1000);
        record = {
          id,
          type,
          category,
          name,
          legacyKey: legacyKeyCurrent,
          legacyAliases: legacyKeyCurrent ? [legacyKeyCurrent] : [],
          desc_samples: [],
          sources: [],
          count: 0,
          status: 'candidate',
          canonical_name: null,
          created_at: now,
          updated_at: now,
        };
        await writeMasterRecord(env, type, record);
        created = true;
      }
      ensureLegacyAlias(record, legacyKeyCurrent);
      return { record, legacyKey: legacyKeyCurrent, created };
    }

    async function loadMastersByType(env, type) {
      const prefix = masterPrefix(type);
      const keys = await env.SETTINGS.list({ prefix });
      const map = new Map();
      const keyEntries = keys.keys || [];
      const keyNames = keyEntries.map(entry => entry.name).filter(Boolean);
      const rawValues = await Promise.all(keyNames.map(name => env.SETTINGS.get(name)));

      for (let i = 0; i < keyNames.length; i++) {
        const keyName = keyNames[i];
        const raw = rawValues[i];
        if (!keyName || !raw) continue;

        if (keyName.includes('|')) {
          try {
            const parsed = JSON.parse(raw);
            if (isLegacyPointer(parsed)) {
              await migrateLegacyPointer(env, keyName, raw);
              if (parsed.id) {
                const promotedRecord = await loadMasterById(env, type, parsed.id);
                if (promotedRecord && promotedRecord.id) {
                  map.set(promotedRecord.id, promotedRecord);
                }
              }
            } else {
              const promoted = await promoteLegacyMasterRecord(env, type, keyName, parsed);
              if (promoted && promoted.id) {
                map.set(promoted.id, promoted);
              }
            }
          } catch (err) {
            console.warn('failed to migrate legacy master record', keyName, err);
          }
          continue;
        }

        try {
          const obj = JSON.parse(raw);
          const id = keyName.slice(prefix.length);
          if (!obj || typeof obj !== 'object') continue;
          obj.id = obj.id || id;
          obj.type = obj.type || type;
          if (!Array.isArray(obj.legacyAliases)) {
            obj.legacyAliases = [];
          }
          if (!obj.legacyKey && obj.category && obj.name) {
            obj.legacyKey = normalizeKey(type, obj.category, obj.name);
          }
          if (obj.legacyKey) {
            ensureLegacyAlias(obj, obj.legacyKey);
          }
          normalizeItemExplanations(obj, { fallbackStatus: obj.status === 'approved' ? 'published' : 'draft' });
          map.set(obj.id, obj);
        } catch (err) {
          console.warn('failed to parse master record', keyName, err);
        }
      }
      return Array.from(map.values());
    }

    async function cleanupLegacyMasterKeys(env, types, { dryRun = false, batchSize = 1000 } = {}) {
      const summary = {
        types: [],
        totalLegacyKeys: 0,
        migratedRecords: 0,
        migratedPointers: 0,
        deletedLegacyKeys: 0,
        errors: [],
        dryRun,
      };

      for (const type of types) {
        if (!MASTER_ALLOWED_TYPES.has(type)) continue;
        const typeSummary = {
          type,
          legacyKeys: 0,
          migratedRecords: 0,
          migratedPointers: 0,
          deleted: 0,
        };
        let cursor;
        do {
          const list = await env.SETTINGS.list({ prefix: masterPrefix(type), cursor, limit: batchSize });
          cursor = list.cursor;
          const keyEntries = list.keys || [];
          const legacyEntries = keyEntries.filter(entry => entry.name && entry.name.includes('|'));
          if (!legacyEntries.length) continue;

          const valuePromises = legacyEntries.map(entry => env.SETTINGS.get(entry.name));
          const values = await Promise.all(valuePromises);

          for (let i = 0; i < legacyEntries.length; i++) {
            const keyName = legacyEntries[i].name;
            const raw = values[i];
            typeSummary.legacyKeys += 1;
            summary.totalLegacyKeys += 1;

            if (!raw) {
              if (!dryRun) {
                await env.SETTINGS.delete(keyName).catch(() => {});
              }
              typeSummary.deleted += 1;
              summary.deletedLegacyKeys += 1;
              continue;
            }

            try {
              const parsed = JSON.parse(raw);
              if (isLegacyPointer(parsed)) {
                if (!dryRun) {
                  await migrateLegacyPointer(env, keyName, raw);
                }
                typeSummary.migratedPointers += 1;
                summary.migratedPointers += 1;
                continue;
              }

              if (!dryRun) {
                const promoted = await promoteLegacyMasterRecord(env, type, keyName, parsed);
                if (promoted && promoted.id) {
                  await env.SETTINGS.delete(keyName).catch(() => {});
                }
              }
              typeSummary.migratedRecords += 1;
              summary.migratedRecords += 1;
            } catch (err) {
              summary.errors.push({ key: keyName, error: err.message || String(err) });
            }
          }
        } while (cursor);
        summary.types.push(typeSummary);
      }
      return summary;
    }

    async function saveMode(env, mode) {
      const key = `${MODE_MASTER_PREFIX}${mode.slug}`;
      const payload = { ...mode };
      delete payload.slug;
      await env.SETTINGS.put(key, JSON.stringify(payload));
      return { id: mode.slug, ...payload };
    }

    async function deleteMode(env, slug) {
      const key = `${MODE_MASTER_PREFIX}${slug}`;
      const existing = await env.SETTINGS.get(key);
      if (!existing) {
        throw new Error('mode not found');
      }
      await env.SETTINGS.delete(key);
    }

    function normalizeExplanationType(type) {
      const value = (type || '').toLowerCase();
      if (value === 'service' || value === 'test') return value;
      throw new Error('invalid explanation type');
    }

    function resolveExplanationPrefix(type) {
      return type === 'service' ? SERVICE_EXPLANATION_PREFIX : TEST_EXPLANATION_PREFIX;
    }

    function buildExplanationKey(type, id) {
      return `${resolveExplanationPrefix(type)}${id}`;
    }

    function sanitizeExplanationPayload(payload, { requireId = false } = {}) {
      if (!payload || typeof payload !== 'object') {
        throw new Error('payload is required');
      }
      const type = normalizeExplanationType(payload.type || payload.explanationType);
      const targetSlug = nk(payload.targetSlug || payload.slug || payload.serviceSlug || payload.testSlug);
      if (!targetSlug) {
        throw new Error('targetSlug is required');
      }
      const baseText = nk(payload.baseText || payload.text);
      if (!baseText) {
        throw new Error('baseText is required');
      }
      const idRaw = nk(payload.id);
      if (requireId && !idRaw) {
        throw new Error('id is required');
      }
      const id = idRaw || `${type}-${Date.now()}-${crypto.randomUUID()}`;
      const audience = nk(payload.audience);
      const context = nk(payload.context);
      const inheritFrom = nk(payload.inheritFrom);
      const status = (payload.status || 'draft').toLowerCase();
      const allowedStatus = new Set(['draft', 'review', 'published']);
      if (!allowedStatus.has(status)) {
        throw new Error('invalid status');
      }
      const tags = Array.isArray(payload.tags)
        ? Array.from(new Set(payload.tags.map((tag) => nk(tag)).filter(Boolean)))
        : [];
      return {
        id,
        type,
        targetSlug,
        baseText,
        audience,
        context,
        inheritFrom: inheritFrom || null,
        status,
        tags,
        sourceFacilityIds: Array.isArray(payload.sourceFacilityIds)
          ? Array.from(new Set(payload.sourceFacilityIds.map((id) => nk(id)).filter(Boolean)))
          : [],
      };
    }

    async function listExplanations(env, { type, targetSlug, status }) {
      const normalizedType = normalizeExplanationType(type);
      const prefix = resolveExplanationPrefix(normalizedType);
      const list = await env.SETTINGS.list({ prefix });
      const out = [];
      for (const key of list.keys) {
        try {
          const raw = await env.SETTINGS.get(key.name);
          if (!raw) continue;
          const obj = JSON.parse(raw);
          if (!obj || typeof obj !== 'object') continue;
          const item = {
            id: key.name.replace(prefix, ''),
            type: normalizedType,
            targetSlug: obj.targetSlug || obj.slug || '',
            baseText: obj.baseText || '',
            audience: obj.audience || '',
            context: obj.context || '',
            inheritFrom: obj.inheritFrom || null,
            status: obj.status || 'draft',
            tags: Array.isArray(obj.tags) ? obj.tags : [],
            sourceFacilityIds: Array.isArray(obj.sourceFacilityIds) ? obj.sourceFacilityIds : [],
            versions: Array.isArray(obj.versions) ? obj.versions : [],
            createdAt: obj.createdAt || null,
            updatedAt: obj.updatedAt || null,
          };
          if (targetSlug && item.targetSlug !== targetSlug) continue;
          if (status && item.status !== status) continue;
          out.push(item);
        } catch (err) {
          console.warn('failed to parse explanation', key.name, err);
        }
      }
      out.sort((a, b) => {
        const au = Number.isFinite(a.updatedAt) ? a.updatedAt : 0;
        const bu = Number.isFinite(b.updatedAt) ? b.updatedAt : 0;
        if (bu !== au) return bu - au;
        return (a.targetSlug || '').localeCompare(b.targetSlug || '', 'ja');
      });
      return out;
    }

    async function saveExplanation(env, payload, { requireId = false } = {}) {
      const sanitized = sanitizeExplanationPayload(payload, { requireId });
      const now = Date.now();
      const key = buildExplanationKey(sanitized.type, sanitized.id);
      const existingRaw = await env.SETTINGS.get(key);
      let existing = null;
      if (existingRaw) {
        try {
          existing = JSON.parse(existingRaw);
        } catch (err) {
          existing = null;
        }
      }
      const record = {
        targetSlug: sanitized.targetSlug,
        baseText: sanitized.baseText,
        audience: sanitized.audience,
        context: sanitized.context,
        inheritFrom: sanitized.inheritFrom,
        status: sanitized.status,
        tags: sanitized.tags,
        sourceFacilityIds: sanitized.sourceFacilityIds,
        versions: Array.isArray(existing?.versions) ? existing.versions : [],
        createdAt: existing?.createdAt || now,
        updatedAt: now,
      };
      // append history entry
      const versionEntry = {
        text: sanitized.baseText,
        status: sanitized.status,
        audience: sanitized.audience,
        context: sanitized.context,
        inheritFrom: sanitized.inheritFrom,
        tags: sanitized.tags,
        updatedAt: now,
      };
      record.versions = [...record.versions, versionEntry].slice(-20); // keep last 20 entries
      await env.SETTINGS.put(key, JSON.stringify(record));
      return {
        id: sanitized.id,
        type: sanitized.type,
        targetSlug: sanitized.targetSlug,
        baseText: sanitized.baseText,
        audience: sanitized.audience,
        context: sanitized.context,
        inheritFrom: sanitized.inheritFrom,
        status: sanitized.status,
        tags: sanitized.tags,
        sourceFacilityIds: sanitized.sourceFacilityIds,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      };
    }

    async function deleteExplanation(env, { type, id }) {
      const normalizedType = normalizeExplanationType(type);
      const slug = nk(id);
      if (!slug) {
        throw new Error('id is required');
      }
      const key = buildExplanationKey(normalizedType, slug);
      const existing = await env.SETTINGS.get(key);
      if (!existing) {
        throw new Error('explanation not found');
      }
      await env.SETTINGS.delete(key);
    }

    function inferExtension(contentType) {
      switch (contentType) {
        case "image/png": return "png";
        case "image/jpeg":
        case "image/jpg": return "jpg";
        case "image/webp": return "webp";
        case "image/gif": return "gif";
        default: return "";
      }
    }

    function sanitizeAlt(value) {
      return typeof value === "string" ? value.trim().slice(0, 200) : "";
    }

    async function createClinicMediaUpload(env, payload) {
      if (!env.MEDIA) {
        throw new Error("R2 bucket is not configured");
      }
      if (typeof env.MEDIA.createPresignedUrl !== "function") {
        throw new Error("presigned upload is not supported");
      }
      const { clinicId, slot, contentType } = payload;
      if (typeof clinicId !== "string" || !clinicId.trim()) {
        throw new Error("clinicId is required");
      }
      if (!MEDIA_SLOTS.has(slot)) {
        throw new Error("Invalid slot");
      }
      if (typeof contentType !== "string" || !contentType.trim()) {
        throw new Error("contentType is required");
      }
      const extension = inferExtension(contentType.trim().toLowerCase());
      if (!extension) {
        throw new Error("Unsupported content type");
      }
      const unique = crypto.randomUUID();
      const key = `clinic/${clinicId}/${slot}/${Date.now()}-${unique}.${extension}`;
      const presigned = await env.MEDIA.createPresignedUrl({
        key,
        method: "PUT",
        expiration: 300,
        conditions: [["content-length-range", 0, 5 * 1024 * 1024]],
      });
      return {
        key,
        uploadUrl: presigned.url,
        headers: presigned.headers || {},
      };
    }

    async function saveClinicMediaRecord(env, clinicId, slot, mediaRecord) {
      const clinic = await getClinicById(env, clinicId);
      if (!clinic) {
        throw new Error("clinic not found");
      }
      const media = clinic.media && typeof clinic.media === "object" ? clinic.media : {};
      media[slot] = {
        key: mediaRecord.key,
        contentType: mediaRecord.contentType || "",
        width: mediaRecord.width ?? null,
        height: mediaRecord.height ?? null,
        fileSize: mediaRecord.fileSize ?? null,
        alt: sanitizeAlt(mediaRecord.alt),
        uploadedAt: Math.floor(Date.now() / 1000),
      };
      clinic.media = media;
      await saveClinic(env, clinic);
      return media[slot];
    }

    async function deleteClinicMedia(env, clinicId, slot) {
      const clinic = await getClinicById(env, clinicId);
      if (!clinic) {
        throw new Error("clinic not found");
      }
      const media = clinic.media && typeof clinic.media === "object" ? clinic.media : {};
      const current = media[slot];
      if (!current) {
        return { deleted: false };
      }
      if (current.key && env.MEDIA) {
        try {
          await env.MEDIA.delete(current.key);
        } catch (err) {
          console.warn("failed to delete R2 object", current.key, err);
        }
      }
      delete media[slot];
      clinic.media = media;
      await saveClinic(env, clinic);
      return { deleted: true };
    }

    if (routeMatch(url, "POST", "media/upload-url")) {
      try {
        const payload = await request.json();
        const result = await createClinicMediaUpload(env, payload || {});
        return new Response(JSON.stringify({ ok: true, ...result }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (err) {
        return new Response(JSON.stringify({ ok: false, error: err.message }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    if (routeMatch(url, "POST", "media/upload")) {
      try {
        if (!env.MEDIA) {
          throw new Error("R2 bucket is not configured");
        }
        const form = await request.formData();
        const clinicId = form.get("clinicId");
        const slot = form.get("slot");
        const alt = form.get("alt");
        const widthRaw = form.get("width");
        const heightRaw = form.get("height");
        const file = form.get("file");

        if (typeof clinicId !== "string" || !clinicId.trim()) {
          throw new Error("clinicId is required");
        }
        if (typeof slot !== "string" || !MEDIA_SLOTS.has(slot)) {
          throw new Error("Invalid slot");
        }
        if (!(file instanceof File)) {
          throw new Error("file is required");
        }
        if (file.size > 5 * 1024 * 1024) {
          throw new Error("file size exceeds 5MB limit");
        }
        const contentType = file.type || "application/octet-stream";
        let extension = inferExtension(contentType.toLowerCase());
        if (!extension) {
          const name = typeof file.name === "string" ? file.name : "";
          const guessed = name.includes('.') ? name.split('.').pop() : "";
          if (guessed) {
            extension = guessed.toLowerCase();
          } else {
            throw new Error("Unsupported content type");
          }
        }

        const unique = crypto.randomUUID();
        const key = `clinic/${clinicId}/${slot}/${Date.now()}-${unique}.${extension}`;
        await env.MEDIA.put(key, file.stream(), {
          httpMetadata: {
            contentType,
          },
        });

        const width = widthRaw ? Number(widthRaw) : null;
        const height = heightRaw ? Number(heightRaw) : null;

        const record = await saveClinicMediaRecord(env, clinicId.trim(), slot, {
          key,
          contentType,
          width: Number.isFinite(width) ? width : null,
          height: Number.isFinite(height) ? height : null,
          fileSize: file.size,
          alt,
        });

        return new Response(JSON.stringify({ ok: true, media: record }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (err) {
        const status = err.message === "clinic not found" ? 404 : 400;
        return new Response(JSON.stringify({ ok: false, error: err.message }), {
          status,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    if (routeMatch(url, "POST", "media/commit")) {
      try {
        const payload = await request.json();
        const { clinicId, slot, objectKey, contentType, width, height, fileSize, alt } = payload || {};
        if (typeof clinicId !== "string" || !clinicId.trim()) {
          throw new Error("clinicId is required");
        }
        if (!MEDIA_SLOTS.has(slot)) {
          throw new Error("Invalid slot");
        }
        if (typeof objectKey !== "string" || !objectKey.trim()) {
          throw new Error("objectKey is required");
        }
        const record = await saveClinicMediaRecord(env, clinicId.trim(), slot, {
          key: objectKey.trim(),
          contentType,
          width,
          height,
          fileSize,
          alt,
        });
        return new Response(JSON.stringify({ ok: true, media: record }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (err) {
        const status = err.message === "clinic not found" ? 404 : 400;
        return new Response(JSON.stringify({ ok: false, error: err.message }), {
          status,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    if (routeMatch(url, "POST", "media/delete")) {
      try {
        const payload = await request.json();
        const { clinicId, slot } = payload || {};
        if (typeof clinicId !== "string" || !clinicId.trim()) {
          throw new Error("clinicId is required");
        }
        if (!MEDIA_SLOTS.has(slot)) {
          throw new Error("Invalid slot");
        }
        const result = await deleteClinicMedia(env, clinicId.trim(), slot);
        return new Response(JSON.stringify({ ok: true, ...result }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (err) {
        const status = err.message === "clinic not found" ? 404 : 400;
        return new Response(JSON.stringify({ ok: false, error: err.message }), {
          status,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    if (routeMatch(url, "GET", "client-config")) {
      const googleMapsApiKey =
        typeof env.GOOGLE_MAPS_API_KEY === "string"
          ? env.GOOGLE_MAPS_API_KEY.trim()
          : "";
      return new Response(JSON.stringify({ googleMapsApiKey }), {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      });
    }

    if (routeMatch(url, 'GET', 'modes')) {
      try {
        const modes = await listModes(env);
        return new Response(JSON.stringify({ ok: true, modes }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      } catch (err) {
        return new Response(JSON.stringify({ ok: false, error: err.message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    if (routeMatch(url, 'POST', 'modes/add')) {
      try {
        const payload = await request.json();
        const sanitized = await sanitizeModePayload(env, payload || {});
        const saved = await saveMode(env, sanitized);
        return new Response(JSON.stringify({ ok: true, mode: saved }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      } catch (err) {
        const status = /required|Unsupported/.test(err.message) ? 400 : 500;
        return new Response(JSON.stringify({ ok: false, error: err.message }), {
          status,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    if (routeMatch(url, 'POST', 'modes/update')) {
      try {
        const payload = await request.json();
        const sanitized = await sanitizeModePayload(env, payload || {});
        const originalSlug = normalizeModeId(nk(payload?.id || payload?.slug));
        if (!originalSlug) {
          throw new Error('id is required');
        }
        if (originalSlug !== sanitized.slug) {
          throw new Error('changing id is not supported');
        }
        const existing = await env.SETTINGS.get(`${MODE_MASTER_PREFIX}${sanitized.slug}`);
        if (!existing) {
          throw new Error('mode not found');
        }
        const mode = await saveMode(env, sanitized);
        return new Response(JSON.stringify({ ok: true, mode }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      } catch (err) {
        const status = /required|Unsupported|not found/.test(err.message) ? (/not found/.test(err.message) ? 404 : 400) : 500;
        return new Response(JSON.stringify({ ok: false, error: err.message }), {
          status,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    if (routeMatch(url, 'POST', 'modes/delete')) {
      try {
        const payload = await request.json();
        const slug = nk(payload?.id || payload?.slug);
        if (!slug) {
          throw new Error('id is required');
        }
        await deleteMode(env, slug);
        return new Response(JSON.stringify({ ok: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      } catch (err) {
        const status = err.message === 'mode not found' ? 404 : /required/.test(err.message) ? 400 : 500;
        return new Response(JSON.stringify({ ok: false, error: err.message }), {
          status,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    if (routeMatch(url, 'GET', 'explanations')) {
      try {
        const type = url.searchParams.get('type');
        const targetSlug = url.searchParams.get('targetSlug') || url.searchParams.get('slug');
        const status = url.searchParams.get('status');
        const items = await listExplanations(env, { type, targetSlug, status });
        return new Response(JSON.stringify({ ok: true, explanations: items }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      } catch (err) {
        const status = /invalid/.test(err.message) ? 400 : 500;
        return new Response(JSON.stringify({ ok: false, error: err.message }), {
          status,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    if (routeMatch(url, 'POST', 'explanations/add')) {
      try {
        const payload = await request.json();
        const saved = await saveExplanation(env, payload || {});
        return new Response(JSON.stringify({ ok: true, explanation: saved }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      } catch (err) {
        const status = /required|invalid/.test(err.message) ? 400 : 500;
        return new Response(JSON.stringify({ ok: false, error: err.message }), {
          status,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    if (routeMatch(url, 'POST', 'explanations/update')) {
      try {
        const payload = await request.json();
        const saved = await saveExplanation(env, payload || {}, { requireId: true });
        return new Response(JSON.stringify({ ok: true, explanation: saved }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      } catch (err) {
        const status = /required|invalid/.test(err.message) ? 400 : 500;
        return new Response(JSON.stringify({ ok: false, error: err.message }), {
          status,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    if (routeMatch(url, 'POST', 'explanations/delete')) {
      try {
        const payload = await request.json();
        const type = payload?.type;
        const id = payload?.id;
        await deleteExplanation(env, { type, id });
        return new Response(JSON.stringify({ ok: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      } catch (err) {
        const status = err.message === 'explanation not found' ? 404 : /required|invalid/.test(err.message) ? 400 : 500;
        return new Response(JSON.stringify({ ok: false, error: err.message }), {
          status,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    function normalizeTodoEntry(raw) {
      if (!raw || typeof raw !== "object") return null;
      const category = nk(raw.category);
      const title = nk(raw.title);
      if (!category || !title) return null;
      const status = raw.status === "done" ? "done" : "open";
      const priority = ["P1", "P2", "P3"].includes(raw.priority) ? raw.priority : "P3";
      const createdAt = typeof raw.createdAt === "string" && raw.createdAt
        ? raw.createdAt
        : new Date().toISOString();
      return { category, title, status, priority, createdAt };
    }

    // ============================================================
    // <<< START: AI_GENERATE >>>
    // ============================================================
    if (routeMatch(url, "POST", "generate")) {
      try {
        const body = await request.json();
        const model = (await env.SETTINGS.get("model")) || "gpt-4o-mini";
        const prompt =
          (await env.SETTINGS.get("prompt")) ||
          "医療説明用のサンプルを作ってください";

        const response = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${env.OPENAI_API_KEY}`,
          },
          body: JSON.stringify({
            model,
            messages: [{ role: "system", content: prompt }, ...(body.messages || [])],
          }),
        });

        const data = await response.json();
        return new Response(JSON.stringify(data), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (err) {
        return new Response("Error: " + err.message, {
          status: 500,
          headers: corsHeaders,
        });
      }
    }
    // <<< END: AI_GENERATE >>>

    // ============================================================
    // <<< START: SETTINGS >>>
    // ============================================================
    if (routeMatch(url, "GET", "settings")) {
      const prompt_exam = await env.SETTINGS.get("prompt_exam");
      const prompt_diagnosis = await env.SETTINGS.get("prompt_diagnosis");
      const model = await env.SETTINGS.get("model");
      const prompt = await env.SETTINGS.get("prompt");
      return new Response(
        JSON.stringify({ model, prompt, prompt_exam, prompt_diagnosis }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (routeMatch(url, "POST", "settings")) {
      const body = await request.json();
      if (typeof body.model === "string") {
        await env.SETTINGS.put("model", body.model.trim());
      }
      if (typeof body.prompt === "string") {
        await env.SETTINGS.put("prompt", body.prompt);
      }
      if (typeof body.prompt_exam === "string") {
        await env.SETTINGS.put("prompt_exam", body.prompt_exam);
      }
      if (typeof body.prompt_diagnosis === "string") {
        await env.SETTINGS.put("prompt_diagnosis", body.prompt_diagnosis);
      }
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // <<< END: SETTINGS >>>

    // ============================================================
    // 施設：登録・一覧・更新・削除・出力
    // ============================================================

    // <<< START: CLINIC_REGISTER >>>
if (routeMatch(url, "POST", "registerClinic")) {
  try {
    const body = await request.json();
    const name = nk(body?.name);
    if (!name) {
      return new Response(JSON.stringify({ error: "診療所名が必要です" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 1) 既に新形式（name→id索引）がある場合は、そのレコードを返す
    const existingNew = await env.SETTINGS.get(`clinic:name:${name}`);
    if (existingNew) {
      const clinic = await kvGetJSON(env, `clinic:id:${existingNew}`);
      return new Response(JSON.stringify({ ok: true, clinic }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2) 旧形式（clinic:{name}）がある場合は「その場で移行」して返す
    const legacy = await env.SETTINGS.get(`clinic:${name}`);
    if (legacy) {
      let obj = {};
      try { obj = JSON.parse(legacy) || {}; } catch(_) {}
      // nameが無ければ補完
      if (!obj.name) obj.name = name;
      const migrated = await saveClinic(env, obj); // id付与＋索引作成
      return new Response(JSON.stringify({ ok: true, clinic: migrated, migrated: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 3) 完全新規
    const clinic = await saveClinic(env, { name });
    return new Response(JSON.stringify({ ok: true, clinic }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response("Error: " + err.message, { status: 500, headers: corsHeaders });
  }
}
// <<< END: CLINIC_REGISTER >>>

    // <<< START: CLINIC_LIST >>>
if (routeMatch(url, "GET", "listClinics")) {
  // まず新形式の件数を確認
  const idKeys = await env.SETTINGS.list({ prefix: "clinic:id:" });
  // 新形式がゼロなら、旧形式をスキャンして自動移行
  if ((idKeys.keys || []).length === 0) {
    const legacyKeys = await env.SETTINGS.list({ prefix: "clinic:" });
    for (const k of legacyKeys.keys) {
      const key = k.name;
      // 旧形式の本体のみ対象（インデックスは除外）
      if (key.startsWith("clinic:id:")) continue;
      if (key.startsWith("clinic:name:")) continue;

      const val = await env.SETTINGS.get(key);
      if (!val) continue;
      let obj = null;
      try { obj = JSON.parse(val); } catch(_) { obj = null; }
      if (!obj || typeof obj !== "object") continue;

      // name が無ければキーから復元
      if (!obj.name && key.startsWith("clinic:")) {
        obj.name = key.substring("clinic:".length);
      }
      if (!obj.name) continue;

      // idが無い旧データを新形式へ保存（id付与＋索引作成）
      await saveClinic(env, obj);
      // 旧キーは互換のため残す（すぐに消さない）
      // ※完全に整理したい場合はここで env.SETTINGS.delete(key) しても良い
    }
  }

  // 最終的に新形式から一覧を取得
  const { items } = await listClinicsKV(env, { limit: 2000, offset: 0 });
  return new Response(JSON.stringify({ ok: true, clinics: items }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
// <<< END: CLINIC_LIST >>>

    // ============================================================
    // <<< START: CLINIC_DETAIL >>>
    // ============================================================
    if (routeMatch(url, "GET", "clinicDetail")) {
      const idParam = (url.searchParams.get("id") || "").trim();
      const nameParam = nk(url.searchParams.get("name"));
      if (!idParam && !nameParam) {
        return new Response(JSON.stringify({ error: "id または name が必要です" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      let clinic = null;
      if (idParam) {
        clinic = await getClinicById(env, idParam);
      }
      if (!clinic && nameParam) {
        clinic = await getClinicByName(env, nameParam);
      }
      if (clinic && !clinic.id && clinic.name) {
        clinic = await saveClinic(env, { ...clinic, name: clinic.name });
      }

      if (!clinic) {
        return new Response(JSON.stringify({ ok: false, error: "clinic not found" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ ok: true, clinic }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // <<< END: CLINIC_DETAIL >>>

    // <<< START: CLINIC_UPDATE >>>
    if (routeMatch(url, "POST", "updateClinic")) {
      try {
        const body = await request.json();
        const name = nk(body?.name);
        if (!name) {
          return new Response(JSON.stringify({ error: "診療所名が必要です" }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        let clinicData = await getClinicByName(env, name) || {};
        clinicData = { ...clinicData, ...body, name };
        const saved = await saveClinic(env, clinicData);
        return new Response(JSON.stringify({ ok: true, clinic: saved }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (err) {
        return new Response("Error: " + err.message, { status: 500, headers: corsHeaders });
      }
    }
    // <<< END: CLINIC_UPDATE >>>

    // <<< START: CLINIC_EXPORT >>>
    if (routeMatch(url, "GET", "exportClinics")) {
      const format = (url.searchParams.get("format") || "json").toLowerCase();
      const limit = parseInt(url.searchParams.get("limit") || "500", 10);
      const offset = parseInt(url.searchParams.get("offset") || "0", 10);
      const { items, total } = await listClinicsKV(env, { limit, offset });

      if (format === "csv") {
        const header = [
          "id","name","address",
          "doctors.fulltime","doctors.parttime","doctors.qualifications",
          "schema_version","created_at","updated_at"
        ].join(",");
        const rows = items.map(o => [
          o.id||"", o.name||"", o.address||"",
          o.doctors?.fulltime ?? "", o.doctors?.parttime ?? "", (o.doctors?.qualifications||""),
          o.schema_version ?? "", o.created_at ?? "", o.updated_at ?? ""
        ].map(x => `"${String(x).replace(/"/g,'""')}"`).join(","));
        return new Response([header, ...rows].join("\n"), {
          headers: { ...corsHeaders, "Content-Type":"text/csv; charset=utf-8" }
        });
      }
      return new Response(JSON.stringify({ ok:true, total, items }), {
        headers: { ...corsHeaders, "Content-Type":"application/json" }
      });
    }
    // <<< END: CLINIC_EXPORT >>>

    // <<< START: CLINIC_DELETE >>>
    if (routeMatch(url, "POST", "deleteClinic")) {
      try {
        const body = await request.json();
        const id = nk(body?.id);
        const name = nk(body?.name);

        let target = null;
        if (id) {
          target = await env.SETTINGS.get(`clinic:id:${id}`);
        } else if (name) {
          const idx = await env.SETTINGS.get(`clinic:name:${name}`);
          if (idx) target = await env.SETTINGS.get(`clinic:id:${idx}`);
          if (!target) target = await env.SETTINGS.get(`clinic:${name}`); // 互換
        }
        if (!target) {
          return new Response(JSON.stringify({ error: "対象が見つかりません" }), {
            status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const obj = JSON.parse(target);
        const _id = obj.id;
        const _name = obj.name;

        if (_id) await env.SETTINGS.delete(`clinic:id:${_id}`);
        if (_name) {
          await env.SETTINGS.delete(`clinic:name:${_name}`);
          await env.SETTINGS.delete(`clinic:${_name}`); // 旧互換キー
        }

        return new Response(JSON.stringify({ ok: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (err) {
        return new Response("Error: " + err.message, { status: 500, headers: corsHeaders });
      }
    }
    // <<< END: CLINIC_DELETE >>>

    // ============================================================
    // マスター収集・管理API（検査/診療）
    // ============================================================

    // <<< START: MASTER_ADD >>>
    if (routeMatch(url, "POST", "addMasterItem")) {
      try {
        const body = await request.json();
        const { type, category, name, desc, source, status } = body || {};
        if (!type || !category || !name) {
          return new Response(JSON.stringify({ error: "type, category, name は必須です" }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        if (!MASTER_ALLOWED_TYPES.has(type)) {
          return new Response(JSON.stringify({ error: "type は test / service / qual / department / facility / symptom / bodySite / society" }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const normalizedCategory = nk(category);
        const normalizedName = nk(name);
        const { record } = await getOrCreateMasterRecord(env, { type, category: normalizedCategory, name: normalizedName });
        const now = Math.floor(Date.now() / 1000);

        record.category = normalizedCategory;
        record.name = normalizedName;
        record.legacyKey = normalizeKey(type, normalizedCategory, normalizedName);
        ensureLegacyAlias(record, record.legacyKey);

        record.count = Number(record.count || 0) + 1;
        record.updated_at = now;
        if (!record.created_at) {
          record.created_at = now;
        }

        const classification = nk(body?.classification);
        const notes = nk(body?.notes);
        const medicalField = nk(body?.medicalField);

        if (type === 'qual') {
          const fallback = record.classification || classification || PERSONAL_QUAL_CLASSIFICATIONS[0];
          record.classification = classification || fallback;
        } else if (classification) {
          record.classification = classification;
        }

        if (type === 'society') {
          if (medicalField) {
            record.medicalField = medicalField;
          } else if (!record.medicalField) {
            record.medicalField = null;
          }
        }

        if (status && ["candidate", "approved", "archived"].includes(status)) {
          record.status = status;
        }

        normalizeItemExplanations(record, { fallbackStatus: record.status === 'approved' ? 'published' : 'draft' });

        if (desc) {
          record.desc_samples = Array.from(new Set([desc, ...(record.desc_samples || [])])).slice(0, 5);
          record.desc = desc;
          addExplanationToItem(record, {
            text: desc,
            status: record.status === 'approved' ? 'published' : 'draft',
            source,
          });
        }
        if (source) {
          record.sources = Array.from(new Set([...(record.sources || []), source]));
        }

        if (notes) {
          record.notes = notes;
          record.desc = notes;
        } else if (record.desc && !record.notes) {
          record.notes = record.desc;
        }

        if (typeof body?.canonical_name === 'string') {
          record.canonical_name = optionalString(body.canonical_name);
        }
        if (Object.prototype.hasOwnProperty.call(body || {}, 'sortGroup')) {
          const trimmed = optionalString(body.sortGroup);
          record.sortGroup = trimmed;
        }
        if (Object.prototype.hasOwnProperty.call(body || {}, 'sortOrder')) {
          const num = Number(body.sortOrder);
          record.sortOrder = Number.isFinite(num) ? num : null;
        }

        if (type === 'symptom') {
          if (Object.prototype.hasOwnProperty.call(body, 'patientLabel')) {
            record.patientLabel = optionalString(body.patientLabel);
          }
          if (Object.prototype.hasOwnProperty.call(body, 'bodySiteRefs')) {
            record.bodySiteRefs = normalizeStringArray(body.bodySiteRefs);
          }
          if (Object.prototype.hasOwnProperty.call(body, 'severityTags')) {
            record.severityTags = normalizeStringArray(body.severityTags);
          }
          if (Object.prototype.hasOwnProperty.call(body, 'icd10')) {
            record.icd10 = normalizeStringArray(body.icd10).map(code => code.toUpperCase());
          }
          if (Object.prototype.hasOwnProperty.call(body, 'synonyms')) {
            record.synonyms = normalizeStringArray(body.synonyms);
          }
          if (Object.prototype.hasOwnProperty.call(body, 'defaultServices')) {
            record.defaultServices = normalizeStringArray(body.defaultServices);
          }
          if (Object.prototype.hasOwnProperty.call(body, 'defaultTests')) {
            record.defaultTests = normalizeStringArray(body.defaultTests);
          }
          if (Object.prototype.hasOwnProperty.call(body, 'thesaurusRefs')) {
            record.thesaurusRefs = normalizeStringArray(body.thesaurusRefs);
          }
        }

        if (type === 'bodySite') {
          if (Object.prototype.hasOwnProperty.call(body, 'anatomicalSystem')) {
            record.anatomicalSystem = optionalString(body.anatomicalSystem);
          }
          if (Object.prototype.hasOwnProperty.call(body, 'patientLabel')) {
            record.patientLabel = optionalString(body.patientLabel);
          }
          if (Object.prototype.hasOwnProperty.call(body, 'canonical_name')) {
            record.canonical_name = optionalString(body.canonical_name);
          }
          if (Object.prototype.hasOwnProperty.call(body, 'parentKey')) {
            record.parentKey = optionalString(body.parentKey);
          }
          if (Object.prototype.hasOwnProperty.call(body, 'laterality')) {
            record.laterality = optionalString(body.laterality);
          }
          if (Object.prototype.hasOwnProperty.call(body, 'aliases')) {
            record.aliases = normalizeStringArray(body.aliases);
          }
          if (Object.prototype.hasOwnProperty.call(body, 'thesaurusRefs')) {
            record.thesaurusRefs = normalizeStringArray(body.thesaurusRefs);
          }
        }

        syncExplanationDerivedFields(record);

        await writeMasterRecord(env, type, record);
        await invalidateMasterCache(env, type);
        return new Response(JSON.stringify({ ok: true, item: record }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (err) {
        return new Response("Error: " + err.message, { status: 500, headers: corsHeaders });
      }
    }
    // <<< END: MASTER_ADD >>>

    // <<< START: MASTER_LIST >>>
    if (routeMatch(url, "GET", "listMaster")) {
      const type = url.searchParams.get("type");
      const status = url.searchParams.get("status");
      const includeSimilar = url.searchParams.get("includeSimilar") === "true";
      let items = await getMasterCache(env, type, status);

      if (!items) {
        const typesToLoad = type ? [type] : Array.from(MASTER_ALLOWED_TYPES);
        const aggregated = [];
        for (const t of typesToLoad) {
          const subset = await loadMastersByType(env, t);
          aggregated.push(...subset);
        }
        items = aggregated;
        if (status) {
          items = items.filter(item => item.status === status);
        }
        await setMasterCache(env, type, status, items);
      } else {
        items = items.map(item => ({ ...item }));
      }

      const collator = new Intl.Collator('ja');
      items.sort((a, b) => {
        const ao = typeof a.sortOrder === 'number' ? a.sortOrder : Number.MAX_SAFE_INTEGER;
        const bo = typeof b.sortOrder === 'number' ? b.sortOrder : Number.MAX_SAFE_INTEGER;
        if (ao !== bo) return ao - bo;
        const ag = a.sortGroup || '';
        const bg = b.sortGroup || '';
        const gcmp = collator.compare(ag, bg);
        if (gcmp !== 0) return gcmp;
        return collator.compare(a.name || '', b.name || '');
      });

      if (includeSimilar && items.length > 1) {
        const collected = items.map(obj => ({ obj, norm: normalizeForSimilarity(obj.canonical_name || obj.name) }));
        for (const entry of collected) {
          if (!entry.norm) continue;
          const matches = [];
          for (const other of collected) {
            if (entry === other) continue;
            if (!other.norm) continue;
            const score = jaroWinkler(entry.norm, other.norm);
            if (score >= 0.92) {
              matches.push({
                name: other.obj.name,
                canonical_name: other.obj.canonical_name || null,
                status: other.obj.status || null,
                similarity: Number(score.toFixed(3)),
              });
            }
          }
          if (matches.length) {
            entry.obj.similarMatches = matches;
          } else {
            delete entry.obj.similarMatches;
          }
        }
      }

      items.sort((a, b) => (b.count || 0) - (a.count || 0));
      return new Response(JSON.stringify({ ok: true, items }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // <<< END: MASTER_LIST >>>

    // <<< START: MASTER_UPDATE >>>
    if (routeMatch(url, "POST", "updateMasterItem")) {
      try {
        const body = await request.json();
        const { type, category, name, status, canonical_name, sortGroup, sortOrder, newCategory, newName, desc, notes, classification, medicalField } = body || {};
        if (!type || !category || !name) {
          return new Response(JSON.stringify({ error: "type, category, name は必須です" }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        if (!MASTER_ALLOWED_TYPES.has(type)) {
          return new Response(JSON.stringify({ error: "type は test / service / qual / department / facility / symptom / bodySite / society" }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const legacyKeyCurrent = normalizeKey(type, category, name);
        let record = await getMasterRecordByLegacy(env, type, legacyKeyCurrent);
        if (!record) {
          return new Response(JSON.stringify({ error: "対象が見つかりません" }), {
            status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const now = Math.floor(Date.now() / 1000);
        const targetCategory = nk(newCategory) || nk(category);
        const targetName = nk(newName) || nk(name);
        record.category = targetCategory;
        record.name = targetName;
        record.legacyKey = normalizeKey(type, targetCategory, targetName);
        ensureLegacyAlias(record, record.legacyKey);

        if (status) {
          record.status = status;
        }
        if (typeof canonical_name === 'string') {
          record.canonical_name = canonical_name || null;
        }
        if (typeof sortGroup === 'string') {
          const trimmed = sortGroup.trim();
          record.sortGroup = trimmed || null;
        }
        if (Object.prototype.hasOwnProperty.call(body, 'sortOrder')) {
          const num = Number(sortOrder);
          record.sortOrder = Number.isFinite(num) ? num : null;
        }
        if (typeof desc === 'string') {
          record.desc = desc;
          if (desc) {
            record.desc_samples = Array.from(new Set([desc, ...(record.desc_samples || [])])).slice(0, 5);
            addExplanationToItem(record, {
              text: desc,
              status: record.status === 'approved' ? 'published' : 'draft',
            });
          } else if (Array.isArray(record.desc_samples) && record.desc_samples.length && !record.desc) {
            record.desc = record.desc_samples[0];
          }
        }
        if (typeof notes === 'string') {
          const trimmedNotes = notes.trim();
          record.notes = trimmedNotes || null;
          if (!desc && trimmedNotes) {
            record.desc = trimmedNotes;
          }
        }
        if (typeof classification === 'string') {
          const trimmedClass = classification.trim();
          if (trimmedClass) {
            record.classification = trimmedClass;
          } else if (record.type === 'qual') {
            record.classification = PERSONAL_QUAL_CLASSIFICATIONS[0];
          } else {
            record.classification = null;
          }
        }
        if (Object.prototype.hasOwnProperty.call(body, 'medicalField')) {
          const trimmedField = typeof medicalField === 'string' ? medicalField.trim() : '';
          record.medicalField = trimmedField || null;
        }

        if (Array.isArray(body?.explanations)) {
          const fallbackStatus = record.status === 'approved' ? 'published' : 'draft';
          const next = [];
          const seenText = new Set();
          const existingMap = new Map();
          if (Array.isArray(record.explanations)) {
            for (const entry of record.explanations) {
              const sanitized = sanitizeExistingExplanation(entry, fallbackStatus);
              if (sanitized) {
                existingMap.set(sanitized.id, sanitized);
              }
            }
          }

          for (const entry of body.explanations) {
            if (!entry || typeof entry !== 'object') continue;
            const base = entry.id && existingMap.get(entry.id) ? existingMap.get(entry.id) : null;
            const merged = sanitizeExistingExplanation({
              ...(base || {}),
              id: entry.id || base?.id,
              text: entry.text || entry.baseText || entry.desc || base?.text,
              status: entry.status || base?.status || fallbackStatus,
              audience: entry.audience ?? base?.audience ?? null,
              context: entry.context ?? base?.context ?? null,
              source: entry.source ?? base?.source ?? null,
              createdAt: entry.createdAt ?? base?.createdAt,
              updatedAt: entry.updatedAt ?? base?.updatedAt,
            }, fallbackStatus);
            if (!merged) continue;
            if (base && base.createdAt && !Number.isFinite(Number(entry.createdAt))) {
              merged.createdAt = base.createdAt;
            }
            if (!Number.isFinite(Number(merged.createdAt))) {
              merged.createdAt = Math.floor(Date.now() / 1000);
            }
            if (!Number.isFinite(Number(merged.updatedAt))) {
              merged.updatedAt = Math.floor(Date.now() / 1000);
            }
            if (seenText.has(merged.text)) {
              continue;
            }
            seenText.add(merged.text);
            next.push(merged);
          }

          record.explanations = next;
        }

        if (type === 'symptom') {
          if (Object.prototype.hasOwnProperty.call(body, 'patientLabel')) {
            record.patientLabel = optionalString(body.patientLabel);
          }
          if (Object.prototype.hasOwnProperty.call(body, 'bodySiteRefs')) {
            record.bodySiteRefs = normalizeStringArray(body.bodySiteRefs);
          }
          if (Object.prototype.hasOwnProperty.call(body, 'severityTags')) {
            record.severityTags = normalizeStringArray(body.severityTags);
          }
          if (Object.prototype.hasOwnProperty.call(body, 'icd10')) {
            record.icd10 = normalizeStringArray(body.icd10).map(code => code.toUpperCase());
          }
          if (Object.prototype.hasOwnProperty.call(body, 'synonyms')) {
            record.synonyms = normalizeStringArray(body.synonyms);
          }
          if (Object.prototype.hasOwnProperty.call(body, 'defaultServices')) {
            record.defaultServices = normalizeStringArray(body.defaultServices);
          }
          if (Object.prototype.hasOwnProperty.call(body, 'defaultTests')) {
            record.defaultTests = normalizeStringArray(body.defaultTests);
          }
          if (Object.prototype.hasOwnProperty.call(body, 'thesaurusRefs')) {
            record.thesaurusRefs = normalizeStringArray(body.thesaurusRefs);
          }
        }

        if (type === 'bodySite') {
          if (Object.prototype.hasOwnProperty.call(body, 'anatomicalSystem')) {
            record.anatomicalSystem = optionalString(body.anatomicalSystem);
          }
          if (Object.prototype.hasOwnProperty.call(body, 'patientLabel')) {
            record.patientLabel = optionalString(body.patientLabel);
          }
          if (Object.prototype.hasOwnProperty.call(body, 'canonical_name')) {
            record.canonical_name = optionalString(body.canonical_name);
          }
          if (Object.prototype.hasOwnProperty.call(body, 'parentKey')) {
            record.parentKey = optionalString(body.parentKey);
          }
          if (Object.prototype.hasOwnProperty.call(body, 'laterality')) {
            record.laterality = optionalString(body.laterality);
          }
          if (Object.prototype.hasOwnProperty.call(body, 'aliases')) {
            record.aliases = normalizeStringArray(body.aliases);
          }
          if (Object.prototype.hasOwnProperty.call(body, 'thesaurusRefs')) {
            record.thesaurusRefs = normalizeStringArray(body.thesaurusRefs);
          }
        }

        syncExplanationDerivedFields(record);
        record.updated_at = now;
        if (!record.created_at) {
          record.created_at = now;
        }

        await writeMasterRecord(env, type, record);
        await invalidateMasterCache(env, type);
        return new Response(JSON.stringify({ ok: true, item: record }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (err) {
        return new Response("Error: " + err.message, { status: 500, headers: corsHeaders });
      }
    }
    // <<< END: MASTER_UPDATE >>>

    if (routeMatch(url, "POST", "master/addExplanation")) {
      try {
        const payload = await request.json();
        const { type, category, name, text, status, audience, context, source } = payload || {};
        if (!type || !category || !name) {
          return new Response(JSON.stringify({ ok: false, error: "type, category, name は必須です" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        if (!MASTER_ALLOWED_TYPES.has(type)) {
          return new Response(JSON.stringify({ ok: false, error: "type は test / service / qual / department / facility / symptom / bodySite" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        const record = await getMasterRecordByLegacy(env, type, normalizeKey(type, category, name));
        if (!record) {
          return new Response(JSON.stringify({ ok: false, error: "対象が見つかりません" }), {
            status: 404,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const defaultStatus = record.status === 'approved' ? 'published' : 'draft';
        const entry = addExplanationToItem(record, {
          text,
          status: status || defaultStatus,
          audience,
          context,
          source,
        }, { defaultStatus });
        if (!entry) {
          return new Response(JSON.stringify({ ok: false, error: "説明本文が必要です" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        record.updated_at = Math.floor(Date.now() / 1000);
        syncExplanationDerivedFields(record);

        await writeMasterRecord(env, type, record);
        await invalidateMasterCache(env, type);

        const sanitizedEntry = sanitizeExistingExplanation(entry, defaultStatus);
        return new Response(JSON.stringify({ ok: true, explanation: sanitizedEntry, item: record }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (err) {
        return new Response(JSON.stringify({ ok: false, error: err.message || "unexpected error" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // <<< START: MASTER_DELETE >>>
    if (routeMatch(url, "POST", "deleteMasterItem")) {
      try {
        const body = await request.json();
        const { type, category, name } = body || {};
        if (!type || !category || !name) {
          return new Response(JSON.stringify({ error: "type, category, name は必須です" }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        if (!MASTER_ALLOWED_TYPES.has(type)) {
          return new Response(JSON.stringify({ error: "type は test / service / qual / department / facility / symptom / bodySite" }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        const legacyKeyCurrent = normalizeKey(type, category, name);
        const record = await getMasterRecordByLegacy(env, type, legacyKeyCurrent);
        if (!record) {
          return new Response(JSON.stringify({ error: "対象が見つかりません" }), {
            status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        await env.SETTINGS.delete(masterIdKey(type, record.id));
        if (Array.isArray(record.legacyAliases)) {
          await Promise.all(record.legacyAliases.map(alias => env.SETTINGS.delete(alias).catch(() => {})));
        } else {
          await env.SETTINGS.delete(legacyKeyCurrent).catch(() => {});
        }
        await invalidateMasterCache(env, type);
        return new Response(JSON.stringify({ ok: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (err) {
        return new Response("Error: " + err.message, { status: 500, headers: corsHeaders });
      }
    }
    // <<< END: MASTER_DELETE >>>

    // <<< START: MASTER_EXPORT >>>
    if (routeMatch(url, "GET", "exportMaster")) {
      const type = url.searchParams.get("type"); // 任意
      const format = (url.searchParams.get("format") || "json").toLowerCase();
      if (type && !MASTER_ALLOWED_TYPES.has(type)) {
        return new Response(JSON.stringify({ ok: false, error: "unknown master type" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const typesToLoad = type ? [type] : Array.from(MASTER_ALLOWED_TYPES);
      let items = [];
      for (const t of typesToLoad) {
        const subset = await loadMastersByType(env, t);
        items = items.concat(subset);
      }

      if (format === "csv") {
        const header = ["分類","名称","説明"].join(",");
        const rows = items.map(o =>
          [o.category, o.name, o.desc || ""]
            .map(x => `"${String(x ?? '').replace(/"/g,'""')}"`).join(",")
        );
        return new Response([header, ...rows].join("\n"), {
          headers: { ...corsHeaders, "Content-Type":"text/csv; charset=utf-8" }
        });
      }

      return new Response(JSON.stringify({ ok: true, items }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // <<< END: MASTER_EXPORT >>>

    if (routeMatch(url, 'POST', 'maintenance/masterCleanup')) {
      try {
        let body = {};
        try {
          body = await request.json();
        } catch (_) {}
        let types = Array.isArray(body?.types) ? body.types.filter(t => MASTER_ALLOWED_TYPES.has(t)) : [];
        if (!types.length) {
          types = MASTER_TYPE_LIST.slice();
        }
        const dryRun = body?.dryRun !== false && body?.dryRun !== 'false';
        const batchSizeRaw = Number(body?.batchSize);
        const batchSize = Number.isFinite(batchSizeRaw) && batchSizeRaw > 0 ? Math.min(batchSizeRaw, 1000) : 1000;
        const summary = await cleanupLegacyMasterKeys(env, types, { dryRun, batchSize });
        return new Response(JSON.stringify({ ok: true, summary }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      } catch (err) {
        return new Response(JSON.stringify({ ok: false, error: err.message || 'unexpected error' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // ============================================================
    // 分類マスター（検査/診療 別管理）
    // ============================================================

    const DEFAULT_CATEGORIES_TEST = [
      "内科一般検査","循環器検査","呼吸器検査","消化器検査","内分泌・代謝検査",
      "腎臓・泌尿器検査","神経内科系検査","整形外科系検査","皮膚科検査","アレルギー検査",
      "小児科検査","耳鼻咽喉科検査","眼科検査","産婦人科検査","精神科・心理検査",
      "在宅医療関連検査","健診・予防関連検査"
    ];
    const DEFAULT_CATEGORIES_SERVICE = [
      "内科一般","循環器","呼吸器","消化器","内分泌・代謝（糖尿病等）",
      "腎臓","神経内科","整形外科","皮膚科","アレルギー科",
      "小児科","耳鼻咽喉科","眼科","泌尿器科","精神科・心療内科",
      "在宅医療・訪問診療","リハビリテーション","健診・予防接種","禁煙外来","睡眠医療"
    ];
    const DEFAULT_CATEGORIES_QUAL = [
      "内科基盤","総合診療領域","循環器領域","呼吸器領域","消化器領域","内分泌・代謝領域",
      "腎臓領域","血液領域","神経領域","感染症領域","アレルギー・膠原病領域",
      "小児科領域","産婦人科領域","皮膚科領域","眼科領域","耳鼻咽喉科領域","精神科領域",
      "外科領域","心臓血管外科領域","整形外科領域","脳神経外科領域","泌尿器領域",
      "放射線科領域","麻酔科領域","病理領域","臨床検査領域","リハビリテーション領域"
    ];
    const DEFAULT_CATEGORIES_DEPARTMENT = ["標榜診療科"];
    const DEFAULT_CATEGORIES_FACILITY = ["学会認定","行政・公費","地域・在宅"];
    const DEFAULT_CATEGORIES_SYMPTOM = [
      "消化器症状","呼吸器症状","循環器症状","内分泌・代謝症状","神経症状","整形外科症状","皮膚症状","耳鼻咽喉症状","眼科症状","泌尿器症状","産婦人科症状","小児科症状","精神・心理症状"
    ];
    const DEFAULT_CATEGORIES_BODYSITE = [
      "頭頸部","胸部","腹部","骨盤","背部","上肢","下肢","皮膚","体幹","全身"
    ];

    async function getCategories(env, type) {
      const key = `categories:${type}`;
      const raw = await env.SETTINGS.get(key);
      if (raw) { try { return JSON.parse(raw); } catch(_) {} }
      return null;
    }
    async function putCategories(env, type, arr) {
      const key = `categories:${type}`;
      await env.SETTINGS.put(key, JSON.stringify(arr));
    }
    function defaultsFor(type){
      switch(type){
        case "test": return [...DEFAULT_CATEGORIES_TEST];
        case "service": return [...DEFAULT_CATEGORIES_SERVICE];
        case "qual": return [...DEFAULT_CATEGORIES_QUAL];
        case "department": return [...DEFAULT_CATEGORIES_DEPARTMENT];
        case "facility": return [...DEFAULT_CATEGORIES_FACILITY];
        case "symptom": return [...DEFAULT_CATEGORIES_SYMPTOM];
        case "bodySite": return [...DEFAULT_CATEGORIES_BODYSITE];
        default: return [];
      }
    }

    // <<< START: CATEGORIES_LIST >>>
      if (routeMatch(url, "GET", "listCategories")) {
    const type = url.searchParams.get("type");
    if (!type || !["test","service","qual","department","facility","symptom","bodySite"].includes(type)) {
      return new Response(JSON.stringify({ error: "type は test / service / qual / department / facility / symptom / bodySite" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    let cats = await getCategories(env, type);
    if (!cats) { cats = defaultsFor(type); await putCategories(env, type, cats); }

    return new Response(JSON.stringify({ ok: true, categories: cats }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
    // <<< END: CATEGORIES_LIST >>>

    // <<< START: CATEGORIES_ADD >>>
        if (routeMatch(url, "POST", "addCategory")) {
      const body = await request.json();
      const type = body?.type;
      const name = (body?.name || "").trim();
      if (!type || !["test","service","qual","department","facility","symptom","bodySite"].includes(type) || !name) {
        return new Response(JSON.stringify({ error: "type/name 不正（type は test / service / qual / department / facility / symptom / bodySite）" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
      const cats = (await getCategories(env, type)) || [];
      if (!cats.includes(name)) cats.push(name);
      await putCategories(env, type, cats);
      return new Response(JSON.stringify({ ok:true, categories: cats }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
    // <<< END: CATEGORIES_ADD >>>

    // <<< START: CATEGORIES_RENAME >>>
        if (routeMatch(url, "POST", "renameCategory")) {
      const body = await request.json();
      const type = body?.type;
      const oldName = (body?.oldName || "").trim();
      const newName = (body?.newName || "").trim();
      if (!type || !["test","service","qual","department","facility","symptom","bodySite"].includes(type) || !oldName || !newName) {
        return new Response(JSON.stringify({ error: "パラメータ不正（type は test / service / qual / department / facility / symptom / bodySite）" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
      let cats = (await getCategories(env, type)) || [];
      cats = cats.map(c => c === oldName ? newName : c);
      await putCategories(env, type, cats);
      return new Response(JSON.stringify({ ok:true, categories: cats }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
    // <<< END: CATEGORIES_RENAME >>>

    // <<< START: CATEGORIES_DELETE >>>
        if (routeMatch(url, "POST", "deleteCategory")) {
      const body = await request.json();
      const type = body?.type;
      const name = (body?.name || "").trim();
      if (!type || !["test","service","qual","department","facility","symptom","bodySite"].includes(type) || !name) {
        return new Response(JSON.stringify({ error: "パラメータ不正（type は test / service / qual / department / facility / symptom / bodySite）" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
      let cats = (await getCategories(env, type)) || [];
      cats = cats.filter(c => c !== name);
      await putCategories(env, type, cats);
      return new Response(JSON.stringify({ ok:true, categories: cats }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
    // <<< END: CATEGORIES_DELETE >>>

    // ============================================================
    // Thesaurus API
    // ============================================================

    if (routeMatch(url, "GET", "thesaurus")) {
      const normalizedParam = optionalString(url.searchParams.get("normalized"));
      const termParam = optionalString(url.searchParams.get("term"));
      const contextParam = optionalString(url.searchParams.get("context"));
      const prefix = "thesaurus:";
      let items = [];

      if (normalizedParam) {
        const key = `${prefix}${normalizeThesaurusTerm(normalizedParam)}`;
        const raw = await env.SETTINGS.get(key);
        if (raw) {
          try { items.push(JSON.parse(raw)); } catch (_) {}
        }
      } else {
        const list = await env.SETTINGS.list({ prefix });
        const values = await Promise.all(list.keys.map(k => env.SETTINGS.get(k.name)));
        for (const raw of values) {
          if (!raw) continue;
          try { items.push(JSON.parse(raw)); } catch (_) {}
        }
      }

      if (termParam) {
        const normalizedTerm = normalizeThesaurusTerm(termParam);
        items = items.filter(entry => {
          if (!entry) return false;
          const base = normalizeThesaurusTerm(entry.term || "");
          if (base.includes(normalizedTerm)) return true;
          const variants = Array.isArray(entry.variants) ? entry.variants : [];
          return variants.some(v => normalizeThesaurusTerm(v).includes(normalizedTerm));
        });
      }

      if (contextParam) {
        const target = contextParam;
        items = items.filter(entry => {
          if (!entry) return false;
          const ctx = Array.isArray(entry.context) ? entry.context : entry.context ? [entry.context] : [];
          return ctx.includes(target);
        });
      }

      return new Response(JSON.stringify({ ok: true, items }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (routeMatch(url, "GET", "searchClinicsBySymptom")) {
      try {
        const keyParam = nk(url.searchParams.get("key"));
        const queryParam = nk(url.searchParams.get("symptom") || url.searchParams.get("q"));
        const includeServices = url.searchParams.get("includeServices") !== "false";
        const includeTests = url.searchParams.get("includeTests") !== "false";
        if (!keyParam && !queryParam) {
          return new Response(JSON.stringify({ ok: false, error: "symptom または key を指定してください" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const allSymptomsRaw = await loadMasterItemsRaw(env, 'symptom');
        const symptoms = allSymptomsRaw.filter(item => item && item.status !== 'archived');
        if (!symptoms.length) {
          return new Response(JSON.stringify({ ok: false, error: "症状マスターが見つかりません" }), {
            status: 404,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const bodySiteItems = await loadMasterItemsRaw(env, 'bodySite');
        const bodySiteMap = new Map();
        for (const site of bodySiteItems) {
          for (const ref of bodySiteRefCandidates(site)) {
            if (ref && !bodySiteMap.has(ref)) {
              bodySiteMap.set(ref, site);
            }
          }
        }

        let target = null;
        if (keyParam) {
          const parsedKey = parseMasterKeyLoose(keyParam);
          const comparableKeyValue = parsedKey && parsedKey.type === 'symptom' ? parsedKey.comparable : null;
          const directKey = keyParam.startsWith('master:') ? keyParam : `master:symptom:${keyParam}`;
          target = symptoms.find(sym => sym._key === directKey);
          if (!target && comparableKeyValue) {
            target = symptoms.find(sym => comparableMasterKey('symptom', sym.category, sym.name) === comparableKeyValue);
          }
        }

        if (!target && queryParam) {
          const normalizedQuery = normalizeForSimilarity(queryParam);
          let best = null;
          let bestScore = 0;
          for (const sym of symptoms) {
            const candidates = [sym.name, sym.patientLabel];
            if (Array.isArray(sym.synonyms)) {
              candidates.push(...sym.synonyms);
            }
            let localBest = 0;
            for (const candidate of candidates) {
              if (!candidate) continue;
              const score = jaroWinkler(normalizedQuery, normalizeForSimilarity(candidate));
              if (score > localBest) {
                localBest = score;
              }
            }
            if (localBest > bestScore) {
              bestScore = localBest;
              best = sym;
            }
          }
          if (best && bestScore >= 0.72) {
            target = best;
          }
        }

        if (!target) {
          return new Response(JSON.stringify({ ok: false, error: "該当する症状が見つかりません" }), {
            status: 404,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const symptomKey = target._key || masterKeyFromParts('symptom', target.category || '', target.name || '');
        const targetComparable = comparableMasterKey('symptom', target.category || '', target.name || '');

        const recommendedServicesRaw = Array.isArray(target.defaultServices) ? target.defaultServices : [];
        const recommendedTestsRaw = Array.isArray(target.defaultTests) ? target.defaultTests : [];

        const serviceInfos = [];
        const serviceKeyMap = new Map();
        for (const raw of recommendedServicesRaw) {
          const parsed = parseMasterKeyLoose(raw);
          if (!parsed || parsed.type !== 'service' || !parsed.comparable) continue;
          if (serviceKeyMap.has(parsed.comparable)) continue;
          const info = { key: raw, type: parsed.type, category: parsed.category, name: parsed.name, comparable: parsed.comparable };
          serviceInfos.push(info);
          serviceKeyMap.set(parsed.comparable, info);
        }

        const testInfos = [];
        const testKeyMap = new Map();
        for (const raw of recommendedTestsRaw) {
          const parsed = parseMasterKeyLoose(raw);
          if (!parsed || parsed.type !== 'test' || !parsed.comparable) continue;
          if (testKeyMap.has(parsed.comparable)) continue;
          const info = { key: raw, type: parsed.type, category: parsed.category, name: parsed.name, comparable: parsed.comparable };
          testInfos.push(info);
          testKeyMap.set(parsed.comparable, info);
        }

        const clinicsResult = await listClinicsKV(env, { limit: 5000, offset: 0 });
        const clinics = Array.isArray(clinicsResult.items) ? clinicsResult.items : [];

        const matches = [];
        const matchedServiceKeys = new Set();
        const matchedTestKeys = new Set();

        for (const clinic of clinics) {
          const matchedServices = [];
          const matchedTests = [];

          if (includeServices && serviceKeyMap.size) {
            const services = Array.isArray(clinic.services) ? clinic.services : [];
            for (const svc of services) {
              const comparables = extractComparableKeys(svc, 'service');
              let matchedInfo = null;
              for (const comp of comparables) {
                const info = serviceKeyMap.get(comp);
                if (info) {
                  matchedInfo = info;
                  matchedServiceKeys.add(info.comparable);
                  break;
                }
              }
              if (matchedInfo) {
                matchedServices.push({
                  category: svc.category || matchedInfo.category,
                  name: svc.name || matchedInfo.name,
                  desc: svc.desc || null,
                  source: svc.source || null,
                  masterKey: matchedInfo.key
                });
              }
            }
          }

          if (includeTests && testKeyMap.size) {
            const tests = Array.isArray(clinic.tests) ? clinic.tests : [];
            for (const tst of tests) {
              const comparables = extractComparableKeys(tst, 'test');
              let matchedInfo = null;
              for (const comp of comparables) {
                const info = testKeyMap.get(comp);
                if (info) {
                  matchedInfo = info;
                  matchedTestKeys.add(info.comparable);
                  break;
                }
              }
              if (matchedInfo) {
                matchedTests.push({
                  category: tst.category || matchedInfo.category,
                  name: tst.name || matchedInfo.name,
                  desc: tst.desc || null,
                  source: tst.source || null,
                  masterKey: matchedInfo.key
                });
              }
            }
          }

          const score = matchedServices.length * 2 + matchedTests.length;
          if (score > 0 || (!serviceKeyMap.size && !testKeyMap.size)) {
            matches.push({
              clinicId: clinic.id || null,
              clinicName: clinic.name || '',
              address: clinic.address || '',
              phone: clinic.phone || clinic.phoneNumber || null,
              url: clinic.homepage || clinic.website || null,
              matchedServices,
              matchedTests,
              score
            });
          }
        }

        matches.sort((a, b) => {
          if (b.score !== a.score) return b.score - a.score;
          return (a.clinicName || '').localeCompare(b.clinicName || '', 'ja');
        });

        const missingServices = serviceInfos.filter(info => !matchedServiceKeys.has(info.comparable));
        const missingTests = testInfos.filter(info => !matchedTestKeys.has(info.comparable));

        const rawBodyRefs = Array.isArray(target.bodySiteRefs) ? target.bodySiteRefs : [];
        const resolvedBodySites = rawBodyRefs.map(ref => {
          const normalized = normalizeBodySiteRef(ref);
          const site = normalized ? bodySiteMap.get(normalized) : null;
          return {
            ref,
            normalized,
            name: site?.name || null,
            patientLabel: site?.patientLabel || null,
            category: site?.category || null,
            canonical: site?.canonical_name || null,
            laterality: site?.laterality || null
          };
        });

        const responseBody = {
          ok: true,
          symptom: {
            key: symptomKey,
            comparableKey: targetComparable,
            name: target.name || '',
            patientLabel: target.patientLabel || '',
            category: target.category || '',
            severityTags: target.severityTags || [],
            icd10: target.icd10 || [],
            synonyms: target.synonyms || [],
            bodySites: resolvedBodySites,
            notes: target.notes || null
          },
          recommendedServices: serviceInfos.map(info => ({ key: info.key, category: info.category, name: info.name })),
          recommendedTests: testInfos.map(info => ({ key: info.key, category: info.category, name: info.name })),
          clinics: matches,
          missingServices: missingServices.map(info => ({ key: info.key, category: info.category, name: info.name })),
          missingTests: missingTests.map(info => ({ key: info.key, category: info.category, name: info.name }))
        };

        return new Response(JSON.stringify(responseBody), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (err) {
        console.error('searchClinicsBySymptom failed', err);
        return new Response(JSON.stringify({ ok: false, error: err.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }


    if (routeMatch(url, "POST", "thesaurus")) {
      let payload;
      try {
        payload = await request.json();
      } catch (err) {
        return new Response(JSON.stringify({ error: "Invalid JSON" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const term = optionalString(payload?.term);
      const normalizedInput = optionalString(payload?.normalized);
      const normalized = normalizeThesaurusTerm(normalizedInput || term || "");
      if (!normalized) {
        return new Response(JSON.stringify({ error: "normalized または term が必要です" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const key = `thesaurus:${normalized}`;
      const existing = await env.SETTINGS.get(key);
      const now = new Date().toISOString();

      let entry = null;
      if (existing) {
        try { entry = JSON.parse(existing); } catch (_) { entry = null; }
      }
      if (!entry || typeof entry !== "object") {
        entry = { normalized, created_at: now };
      }

      if (term) {
        entry.term = term;
      } else if (!entry.term) {
        entry.term = normalized;
      }

      if (Object.prototype.hasOwnProperty.call(payload || {}, "variants")) {
        entry.variants = normalizeStringArray(payload.variants);
      }
      if (Object.prototype.hasOwnProperty.call(payload || {}, "context")) {
        if (Array.isArray(payload.context)) {
          entry.context = normalizeStringArray(payload.context);
        } else if (typeof payload.context === "string") {
          entry.context = normalizeStringArray([payload.context]);
        } else {
          entry.context = [];
        }
      }
      if (Object.prototype.hasOwnProperty.call(payload || {}, "locale")) {
        entry.locale = optionalString(payload.locale);
      }
      if (Object.prototype.hasOwnProperty.call(payload || {}, "notes")) {
        entry.notes = optionalString(payload.notes);
      }
      if (Object.prototype.hasOwnProperty.call(payload || {}, "source")) {
        entry.source = optionalString(payload.source);
      }

      entry.updated_at = now;

      await env.SETTINGS.put(key, JSON.stringify(entry));
      return new Response(JSON.stringify({ ok: true, entry }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }


// ===== /api/deleteClinic =====
if (url.pathname === "/api/deleteClinic" && request.method === "POST") {
  try {
    const body = await request.json();
    const id = (body?.id || "").trim();
    const name = (body?.name || "").trim();

    if (!id && !name) {
      return new Response(JSON.stringify({ error: "id か name を指定してください" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 1) 新レイアウト優先（idベース）
    if (id) {
      const rec = await env.SETTINGS.get(`clinic:id:${id}`);
      if (rec) {
        const obj = JSON.parse(rec);
        const nm = obj?.name;
        // 連動削除（id / name-index / 互換キー）
        await env.SETTINGS.delete(`clinic:id:${id}`);
        if (nm) {
          await env.SETTINGS.delete(`clinic:name:${nm}`);
          await env.SETTINGS.delete(`clinic:${nm}`); // 互換キー（旧形式）
        }
        return new Response(JSON.stringify({ ok: true, deleted: { id, name: nm || null } }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // 2) name 指定（レガシーデータ含む）
    if (name) {
      // 新形式の name→id インデックスがあれば id レコードも削除
      const idxId = await env.SETTINGS.get(`clinic:name:${name}`);
      if (idxId) {
        await env.SETTINGS.delete(`clinic:id:${idxId}`);
      }
      // name インデックス自体を削除
      await env.SETTINGS.delete(`clinic:name:${name}`);
      // 旧形式（互換）キーを削除
      await env.SETTINGS.delete(`clinic:${name}`);

      return new Response(JSON.stringify({ ok: true, deleted: { name } }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ここに落ちることは基本無い
    return new Response(JSON.stringify({ error: "対象が見つかりません" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response("Error: " + err.message, {
      status: 500,
      headers: corsHeaders,
    });
  }
}
// ============================================================
// AI重複検出（Embeddings）ユーティリティ
// ============================================================

async function openaiEmbed(env, text) {
  // OpenAI text-embedding-3-small を使用（日本語OK、コスト安）
  const body = {
    input: text,
    model: "text-embedding-3-small"
  };
  const r = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify(body)
  });
  if (!r.ok) throw new Error("Embedding API error");
  const d = await r.json();
  return d.data[0].embedding;
}

function cosine(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na  += a[i] * a[i];
    nb  += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function normalizeJP(s) {
  if (!s) return "";
  return s.normalize("NFKC")
          .replace(/[\u3000\s]+/g, " ")
          .trim();
}

/**
 * 指定type(test/service)のマスター一覧をKVから取得
 * 既存の /api/listMaster と同じ構造を返すことを想定
 */
async function loadMasterAll(env, type) {
  if (!MASTER_ALLOWED_TYPES.has(type)) {
    return [];
  }
  const prefix = `master:${type}:`;
  const list = await env.SETTINGS.list({ prefix });
  const results = [];
  for (const entry of list.keys) {
    const keyName = entry.name;
    if (keyName.includes('|')) continue;
    const raw = await env.SETTINGS.get(keyName);
    if (!raw) continue;
    try {
      const obj = JSON.parse(raw);
      if (obj && typeof obj === 'object') {
        obj.id = obj.id || keyName.slice(prefix.length);
        results.push(obj);
      }
    } catch (_) {}
  }
  return results;
}

/**
 * まだ埋め込みが無いアイテムに付与して保存
 * keyは既存の masterキーを使い、item.embedding に配列として格納
 */
async function backfillEmbeddings(env, type) {
  const prefix = `master:${type}:`;
  const list = await env.SETTINGS.list({ prefix });
  for (const k of list.keys) {
    const val = await env.SETTINGS.get(k.name);
    if (!val) continue;
    let item;
    try { item = JSON.parse(val); } catch(_) { continue; }
    if (item && !item.embedding) {
      const basis = normalizeJP(`${item.category}｜${item.name}｜${item.canonical_name||""}｜${item.desc||""}`);
      try {
        const emb = await openaiEmbed(env, basis);
        item.embedding = emb;
        await env.SETTINGS.put(k.name, JSON.stringify(item));
      } catch(e) {
        // 埋め込み失敗はスキップ（後で再試行）
      }
    }
  }
}

/**
 * 類似グループ化（コサイン類似度）
 * - 同じ category 内でのみグループ化
 * - threshold 以上を1グループにして返す
 * 返り値: [{ category, members:[{name, canonical_name, status, score, ...}] }]
 */
function buildGroupsByEmbedding(items, threshold) {
  const byCat = new Map();
  items.forEach(it => {
    const arr = byCat.get(it.category) || [];
    arr.push(it);
    byCat.set(it.category, arr);
  });

  const groups = [];
  byCat.forEach(arr => {
    const used = new Array(arr.length).fill(false);

    for (let i = 0; i < arr.length; i++) {
      if (used[i]) continue;
      const base = arr[i];
      if (!base.embedding) continue;

      const g = [{...base, score: 1}];
      used[i] = true;

      for (let j = i + 1; j < arr.length; j++) {
        if (used[j]) continue;
        const cand = arr[j];
        if (!cand.embedding) continue;
        const sim = cosine(base.embedding, cand.embedding);
        if (sim >= threshold) {
          g.push({...cand, score: sim});
          used[j] = true;
        }
      }
      if (g.length >= 2) {
        // categoryは同一なので代表から借用
        groups.push({ category: base.category, members: g.sort((a,b)=>(b.score||0)-(a.score||0)) });
      }
    }
  });
  return groups;
}

    // ============================================================
    // <<< START: TODO_MANAGEMENT >>>
    // ============================================================
    if (routeMatch(url, "GET", "todo/list")) {
      const raw = await kvGetJSON(env, TODO_KEY);
      let updatedAt = null;
      let items = [];
      if (Array.isArray(raw)) {
        items = raw.map(normalizeTodoEntry).filter(Boolean);
      } else if (raw && typeof raw === "object") {
        if (Array.isArray(raw.todos)) {
          items = raw.todos.map(normalizeTodoEntry).filter(Boolean);
        }
        if (raw.updatedAt) {
          updatedAt = raw.updatedAt;
        }
      }
      if (!items.length) {
        items = DEFAULT_TODOS.map(normalizeTodoEntry).filter(Boolean);
      }
      return new Response(JSON.stringify({ ok: true, todos: items, updatedAt }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (routeMatch(url, "POST", "todo/save")) {
      let payload;
      try {
        payload = await request.json();
      } catch (err) {
        return new Response(JSON.stringify({ error: "Invalid JSON" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const source = Array.isArray(payload)
        ? payload
        : (Array.isArray(payload?.todos) ? payload.todos : null);

      if (!source) {
        return new Response(JSON.stringify({ error: "todos array is required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const todos = source.map(normalizeTodoEntry).filter(Boolean);
      const updatedAt = new Date().toISOString();
      await kvPutJSON(env, TODO_KEY, { updatedAt, todos });

      return new Response(JSON.stringify({ ok: true, todos, updatedAt }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // ============================================================
    // <<< END: TODO_MANAGEMENT >>>

// ------------------------------------------------------------
// API: AI埋め込みの再計算（バックフィル）
//   POST /api/reembedMaster  { type: "test" | "service" }
// ------------------------------------------------------------
if (url.pathname === "/api/reembedMaster" && request.method === "POST") {
  try {
    const body = await request.json();
    const type = (body?.type === "service") ? "service" : "test";
    // 全件バックフィル
    await backfillEmbeddings(env, type);
    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response("Error: " + err.message, { status: 500, headers: corsHeaders });
  }
}

// ------------------------------------------------------------
// API: AI重複候補の取得（埋め込み＋コサイン類似）
//   GET /api/aiDuplicates?type=test&threshold=0.83
// ------------------------------------------------------------
if (url.pathname === "/api/aiDuplicates" && request.method === "GET") {
  try {
    const type = url.searchParams.get("type") === "service" ? "service" : "test";
    const threshold = Math.max(0, Math.min(0.99, Number(url.searchParams.get("threshold") || "0.83")));

    // 1) 全件取得
    const items = await loadMasterAll(env, type);

    // 2) 埋め込みの無いものに付与（必要に応じて）
    const needEmbed = items.some(it => !it.embedding);
    if (needEmbed) {
      await backfillEmbeddings(env, type);
      // 再読み込み
      const items2 = await loadMasterAll(env, type);
      // 3) グループ化
      const groups = buildGroupsByEmbedding(items2, threshold);
      return new Response(JSON.stringify({ ok: true, groups }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } else {
      // 3) グループ化
      const groups = buildGroupsByEmbedding(items, threshold);
      return new Response(JSON.stringify({ ok: true, groups }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  } catch (err) {
    return new Response("Error: " + err.message, { status: 500, headers: corsHeaders });
  }
}
// ============================================================
// SEED: Qualifications (categories:qual / master:qual)
//   POST /api/_seedQualifications        … 未投入なら投入
//   POST /api/_seedQualifications?force=1 … 強制上書き
//   ※本番投入後はこのエンドポイントを削除/コメントアウト推奨
// ============================================================
if (url.pathname === "/api/_seedQualifications" && request.method === "POST") {
  try {
    const force = url.searchParams.get("force") === "1";

    // ---- 初期カテゴリ（日本の主要領域をベースにした実用セット）----
    const qualCategories = [
      "内科基盤","総合診療領域",
      "循環器領域","呼吸器領域","消化器領域","内分泌・代謝領域","腎臓領域","血液領域","神経領域","感染症領域","アレルギー・膠原病領域",
      "小児科領域","産婦人科領域","皮膚科領域","眼科領域","耳鼻咽喉科領域","精神科領域",
      "外科領域","心臓血管外科領域","整形外科領域","脳神経外科領域","泌尿器領域","放射線科領域","麻酔科領域","病理領域","臨床検査領域","リハビリテーション領域"
    ];

    // 既に categories:qual があればスキップ（force以外）
    const catKey = "categories:qual";
    const catExists = await env.SETTINGS.get(catKey);
    if (catExists && !force) {
      return new Response(JSON.stringify({ ok:true, skipped:true, reason:"categories:qual exists" }), {
        headers: { ...corsHeaders, "Content-Type":"application/json" }
      });
    }

    // ---- 資格マスター（主要資格のseed：name / issuer / status=approved など）----
    // ※実運用で随時追加/修正できるよう、canonical_name や code は空でも可。
    const masterItems = [
      // 内科基盤・総合診療
      { category:"内科基盤", name:"内科専門医", issuer:"日本内科学会/日本専門医機構", status:"approved" },
      { category:"内科基盤", name:"総合内科専門医", issuer:"日本内科学会", status:"approved" },
      { category:"総合診療領域", name:"総合診療専門医", issuer:"日本専門医機構", status:"approved" },

      // 循環器
      { category:"循環器領域", name:"循環器内科専門医", issuer:"日本循環器学会/日本専門医機構", status:"approved" },
      { category:"循環器領域", name:"循環器専門医（旧制度）", issuer:"日本循環器学会", status:"candidate" },
      { category:"循環器領域", name:"不整脈専門医", issuer:"日本不整脈心電学会", status:"approved" },

      // 呼吸器
      { category:"呼吸器領域", name:"呼吸器専門医", issuer:"日本呼吸器学会", status:"approved" },
      { category:"呼吸器領域", name:"呼吸器内視鏡専門医", issuer:"日本呼吸器内視鏡学会", status:"approved" },

      // 消化器
      { category:"消化器領域", name:"消化器病専門医", issuer:"日本消化器病学会", status:"approved" },
      { category:"消化器領域", name:"消化器内視鏡専門医", issuer:"日本消化器内視鏡学会", status:"approved" },
      { category:"消化器領域", name:"肝臓専門医", issuer:"日本肝臓学会", status:"approved" },

      // 代謝・内分泌
      { category:"内分泌・代謝領域", name:"内分泌代謝科専門医", issuer:"日本内分泌学会/日本糖尿病学会 等", status:"approved" },
      { category:"内分泌・代謝領域", name:"糖尿病専門医", issuer:"日本糖尿病学会", status:"approved" },

      // 腎臓・血液・神経・感染症・膠原病
      { category:"腎臓領域", name:"腎臓専門医", issuer:"日本腎臓学会", status:"approved" },
      { category:"血液領域", name:"血液専門医", issuer:"日本血液学会", status:"approved" },
      { category:"神経領域", name:"神経内科専門医", issuer:"日本神経学会", status:"approved" },
      { category:"感染症領域", name:"感染症専門医", issuer:"日本感染症学会", status:"approved" },
      { category:"アレルギー・膠原病領域", name:"リウマチ専門医", issuer:"日本リウマチ学会", status:"approved" },
      { category:"アレルギー・膠原病領域", name:"アレルギー専門医", issuer:"日本アレルギー学会", status:"approved" },

      // 小児・産婦人科・皮膚・眼・耳鼻・精神
      { category:"小児科領域", name:"小児科専門医", issuer:"日本小児科学会/日本専門医機構", status:"approved" },
      { category:"産婦人科領域", name:"産婦人科専門医", issuer:"日本産科婦人科学会/日本専門医機構", status:"approved" },
      { category:"皮膚科領域", name:"皮膚科専門医", issuer:"日本皮膚科学会/日本専門医機構", status:"approved" },
      { category:"眼科領域", name:"眼科専門医", issuer:"日本眼科学会/日本専門医機構", status:"approved" },
      { category:"耳鼻咽喉科領域", name:"耳鼻咽喉科専門医", issuer:"日本耳鼻咽喉科頭頸部外科学会/日本専門医機構", status:"approved" },
      { category:"精神科領域", name:"精神科専門医", issuer:"日本精神神経学会/日本専門医機構", status:"approved" },

      // 外科・心外・整形・脳外・泌尿
      { category:"外科領域", name:"外科専門医", issuer:"日本外科学会/日本専門医機構", status:"approved" },
      { category:"心臓血管外科領域", name:"心臓血管外科専門医", issuer:"心臓血管外科専門医認定機構", status:"approved" },
      { category:"整形外科領域", name:"整形外科専門医", issuer:"日本整形外科学会/日本専門医機構", status:"approved" },
      { category:"脳神経外科領域", name:"脳神経外科専門医", issuer:"日本脳神経外科学会/日本専門医機構", status:"approved" },
      { category:"泌尿器領域", name:"泌尿器科専門医", issuer:"日本泌尿器科学会/日本専門医機構", status:"approved" },

      // 画像・麻酔・病理・検査・リハ
      { category:"放射線科領域", name:"放射線科専門医", issuer:"日本医学放射線学会/日本専門医機構", status:"approved" },
      { category:"麻酔科領域", name:"麻酔科専門医", issuer:"日本麻酔科学会/日本専門医機構", status:"approved" },
      { category:"病理領域", name:"病理専門医", issuer:"日本病理学会/日本専門医機構", status:"approved" },
      { category:"臨床検査領域", name:"臨床検査専門医", issuer:"日本臨床検査医学会", status:"approved" },
      { category:"リハビリテーション領域", name:"リハビリテーション科専門医", issuer:"日本リハビリテーション医学会/日本専門医機構", status:"approved" }
    ];

    // カテゴリ保存
    await env.SETTINGS.put(catKey, JSON.stringify(qualCategories));

    // マスター保存（prefix: master:qual:<sha> などでも良いが、ここでは連番）
    // 既存を一旦クリアしたい場合は、force時のみ旧prefixをリスト→delete しても良い（ここでは上書き保存）。
    let putCount = 0;
    for (const it of masterItems) {
      // key例：master:qual:<category>:<name>
      const k = `master:qual:${it.category}:${it.name}`;
      await env.SETTINGS.put(k, JSON.stringify({
        category: it.category,
        name: it.name,
        issuer: it.issuer || "",
        status: it.status || "approved",
        canonical_name: it.canonical_name || "",
        sources: it.sources || []
      }));
      putCount++;
    }

    return new Response(JSON.stringify({ ok:true, categories: qualCategories.length, items: putCount }), {
      headers: { ...corsHeaders, "Content-Type":"application/json" }
    });

  } catch (e) {
    return new Response("Error: " + e.message, { status: 500, headers: corsHeaders });
  }
}

    // ============================================================
    // <<< START: NOT_FOUND >>>
    // ============================================================
    return new Response("Not Found", {
      status: 404,
      headers: corsHeaders,
    });
    // <<< END: NOT_FOUND >>>
  },
};
