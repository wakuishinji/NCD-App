# Cloudflare Pages ステージング構築手順

アプリのフロントエンド（`web/` ディレクトリ）を Cloudflare Pages へデプロイし、`.pages.dev` ドメインで検証できるようにするためのメモ。テスト利用中のため、短時間のダウンタイムは許容される前提。

---

## 1. 事前準備

1. **Cloudflare アカウント**  
   - Workers で利用しているアカウントにログイン。`wrangler login` が済んでいない端末では実行しておく。
2. **プロジェクト名の決定**  
   - ここでは `ncd-app` を Pages プロジェクト名として使用（既存と衝突する場合は変更）。  
   - Production ブランチは `main`, Staging ブランチは `staging` を想定。

---

## 2. Pages プロジェクトの作成

```bash
# まだプロジェクトが無い場合
wrangler pages project create ncd-app \
  --production-branch main \
  --build-command "" \
  --build-output-dir "./web"
```

- ビルド不要（プレーン HTML 配置）なので `build-command` は空に設定。  
- `wrangler pages project list` で作成済みか確認できる。

---

## 3. ステージング用デプロイ

package.json に以下のスクリプトを追加済み:

```json
"pages:dev": "wrangler pages dev ./web --local true",
"deploy:pages:staging": "wrangler pages deploy ./web --project-name ncd-app --branch staging",
"deploy:pages:production": "wrangler pages deploy ./web --project-name ncd-app --branch main"
```

### ローカルプレビュー

```bash
npm run pages:dev
# → http://127.0.0.1:8788/ で確認。API は localStorage の override で切り替え可能。
```

### ステージングブランチへデプロイ

```bash
git checkout staging   # 無い場合は main から作成
npm run deploy:pages:staging
# デプロイ後に https://<hash>.staging.ncd-app.pages.dev/ が発行される
```

> 本番反映は `npm run deploy:pages:production` を使用。ただし DNS 切替までは `.pages.dev` のままで OK。

---

## 4. API ベース URL の設定

- 既存のフロントコードは `window.API_BASE_OVERRIDE` または `localStorage.ncdApiBase` で API エンドポイントを切り替えられる。  
- Pages の環境変数を使う場合は、プロジェクト設定 > Variables に `NCD_API_BASE` を追加し、Pages Functions で script を注入するか、SSR で `window.__CF_PAGES_ENV.NCD_API_BASE` を参照するよう JS を追記する。  
- 当面は以下の手順で十分:
  1. ステージング URL を開く。  
  2. ブラウザコンソールで `localStorage.setItem('ncdApiBase', 'https://staging-ncd-app.altry.workers.dev')` を実行。  
  3. リロード後、その API を向くようになる。

---

## 5. Secrets / 環境変数

- Pages 側に `NCD_API_BASE`, `ENV_LABEL`, `SENTRY_DSN` など必要な値を追加できる。  
- 今後 Pages Functions を導入する場合、`wrangler pages deploy` 時に `--env` は不要だが、Workers 側と同じバインド名を使うように注意。

---

## 6. デプロイ後チェック

1. `.pages.dev` URL を開いて、主要画面（トップ、分類管理、施設ホームなど）が表示されるか確認。  
2. DevTools Network で API が `staging-ncd-app.altry.workers.dev` を向いているかチェック。  
3. `categoriesAdmin.html` の操作（追加/改名/削除）が成功するかを試す。  
4. 問題がなければ URL を和久井さんと共有し、次フェーズ（Workers 環境統合 → DNS 切替）へ進む。

---

## 7. TODO

- API ベース URL を `window.__CF_PAGES_ENV` 経由で自動設定できるよう JS を共通化。  
- GitHub Actions で `staging` ブランチ push → Pages デプロイを自動化。  
- 本番ドメイン（`ncd-app.altry.workers.dev`）を Pages プロジェクトに割り当てる手順を Runbook に追記。

