export default {
  async fetch(request, env) {
    try {
      // GETの場合 → 確認用レスポンスを返す
      if (request.method === "GET") {
        return new Response("Worker is running! Send a POST request with JSON.", {
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
      }

      // POSTの場合 → JSONを処理
      if (request.method === "POST") {
        // KVから設定を取得
        const model = await env.SETTINGS.get("model") || "gpt-4o-mini";
        const prompt = await env.SETTINGS.get("prompt") || "医療説明用のサンプルを作ってください";

        // リクエスト本文を取得
        const { messages = [] } = await request.json();

        // OpenAI API に問い合わせ
        const response = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${env.OPENAI_API_KEY}`,
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: "system", content: prompt },
              ...messages,
            ],
          }),
        });

        const data = await response.json();

        return new Response(JSON.stringify(data), {
          headers: { "Content-Type": "application/json; charset=utf-8" },
        });
      }

      // それ以外のメソッドは405
      return new Response("Method Not Allowed", { status: 405 });

    } catch (err) {
      return new Response("Error: " + err.message, { status: 500 });
    }
  },
};