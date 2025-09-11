export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // /settings のルートのみ対応
    if (url.pathname === "/settings") {
      if (request.method === "GET") {
        // KVから設定を取得
        const prompt_exam = await env.SETTINGS.get("prompt_exam");
        const prompt_diagnosis = await env.SETTINGS.get("prompt_diagnosis");

        return new Response(
          JSON.stringify({
            prompt_exam,
            prompt_diagnosis
          }),
          { headers: { "Content-Type": "application/json" } }
        );
      }

      if (request.method === "POST") {
        const body = await request.json();
        if (body.prompt_exam) {
          await env.SETTINGS.put("prompt_exam", body.prompt_exam);
        }
        if (body.prompt_diagnosis) {
          await env.SETTINGS.put("prompt_diagnosis", body.prompt_diagnosis);
        }

        return new Response(
          JSON.stringify({ ok: true }),
          { headers: { "Content-Type": "application/json" } }
        );
      }

      return new Response("Method Not Allowed", { status: 405 });
    }

    return new Response("Not Found", { status: 404 });
  }
}