# systemRoot 資格情報の管理手順

このリポジトリに含まれている `system-root.json` は、Cloudflare Workers の `systemRoot` アカウントを投入するための**テンプレート**です。実運用のパスワードハッシュやメールアドレスなど機微情報は、Cloudflare KV など安全なストアで管理し、Git には保存しません。

## 管理ポリシー
- `system-root.json` は構造を確認するためのサンプル値のみを保持します。
- 本番／プレビューの実値は `wrangler kv:key put --binding SETTINGS system-root` で投入し、KV 上でバージョン管理します。
- ハッシュ生成や更新手順は `functions/lib/auth/password.js` の PBKDF2 設定に合わせ、以下の要領で行います。

## パスワード更新手順
1. 安全な端末で新しいパスワードを決める。
2. Node.js で PBKDF2 (SHA-256、iteration 100000、keyLength 32) を使ってソルトとハッシュを生成する。
   ```bash
   node -e "const crypto=require('crypto');const password=process.argv[1];const salt=crypto.randomBytes(16);crypto.pbkdf2(password,salt,100000,32,'sha256',(err,derived)=>{if(err)throw err;console.log(JSON.stringify({salt:salt.toString('base64url'),hash:derived.toString('base64url')}));});" '新しいパスワード'
   ```
3. 出力した `salt` / `hash` を含む JSON を作成し、`settings` KV へ書き込む。
   ```bash
   wrangler kv:key put --binding SETTINGS system-root @./system-root.secret.json
   ```
4. KV 反映後に `wrangler kv:key get --binding SETTINGS system-root` で確認する。
5. 旧パスワードを失効させ、関係者に新しいパスワードを共有する。

## ローカル開発向け
- 必要に応じて `.dev.vars` にダミーアカウントを記載し、テスト用に `npm run dev` などから参照させる。
- 実際の資格情報を誤ってコミットしないよう、`git status` で `system-root.secret.json` 等が表示されていないか常に確認する。

この手順に沿うことで、最上位権限の資格情報がリポジトリから完全に切り離されます。
