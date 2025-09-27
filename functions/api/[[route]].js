// Cloudflare Pages Functions - Catch-all route handler
// This handles all API routes dynamically

export async function onRequest(context) {
  const { request, env } = context;
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

  // ============================================================
  // <<< START: UTILS >>>
  // ============================================================
  const SCHEMA_VERSION = 1; // 施設スキーマのバージョン

  function nk(s) { return (s || "").trim(); }

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
    if (!clinic.id) {
      clinic.id = crypto.randomUUID();
      clinic.created_at = now;
    }
    if (clinic.name) {
      await env.SETTINGS.put(`clinic:name:${clinic.name}`, clinic.id);
      await kvPutJSON(env, `clinic:${clinic.name}`, clinic); // 互換
    }
    await kvPutJSON(env, `clinic:id:${clinic.id}`, clinic);
    return clinic;
  }
  async function listClinicsKV(env, {limit=2000, offset=0} = {}) {
    const keys = await env.SETTINGS.list({ prefix: "clinic:id:" });
    const ids = keys.keys.map(k => k.name.replace("clinic:id:",""));
    const page = ids.slice(offset, offset+limit);
    const out = [];
    for (const id of page) {
      const c = await getClinicById(env, id);
      if (c) out.push(c);
    }
    return { items: out, total: ids.length };
  }
  // <<< END: UTILS >>>

  const TODO_KEY = "todo:list";
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
      title: "Let's Encrypt 自動更新",
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
  // <<< START: CLINIC_REGISTER >>>
  // ============================================================
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

  // ============================================================
  // <<< START: CLINIC_LIST >>>
  // ============================================================
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
      }
    }

    // 最終的に新形式から一覧を取得
    const { items } = await listClinicsKV(env, { limit: 2000, offset: 0 });
    return new Response(JSON.stringify({ ok: true, clinics: items }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  // <<< END: CLINIC_LIST >>>

  // その他のAPIエンドポイントも同様に実装...

  // ============================================================
  // <<< START: NOT_FOUND >>>
  // ============================================================
  return new Response("Not Found", {
    status: 404,
    headers: corsHeaders,
  });
  // <<< END: NOT_FOUND >>>
}