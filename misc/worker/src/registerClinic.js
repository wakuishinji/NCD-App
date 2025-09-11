export async function onRequestPost({ request, env }) {
  const { name } = await request.json();

  if (!name) {
    return new Response(
      JSON.stringify({ error: "診療所名を入力してください" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // 既存施設を部分一致で確認
  const list = await env.SETTINGS.list({ prefix: "facility:" });
  for (const key of list.keys) {
    const facility = await env.SETTINGS.get(key.name, "json");
    if (facility && (facility.name.includes(name) || name.includes(facility.name))) {
      return new Response(
        JSON.stringify({
          error: "すでに登録されているようです。施設選択画面から選択してください"
        }),
        { status: 409, headers: { "Content-Type": "application/json" } }
      );
    }
  }

  // 新規登録
  const id = crypto.randomUUID();
  const facility = { id, name };
  await env.SETTINGS.put(`facility:${id}`, JSON.stringify(facility));

  // カウンタ更新
  const count = parseInt(await env.SETTINGS.get("facility_count") || "0") + 1;
  await env.SETTINGS.put("facility_count", count.toString());

  return new Response(
    JSON.stringify({ success: true, id, name, count }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}