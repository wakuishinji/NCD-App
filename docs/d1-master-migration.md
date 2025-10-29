# D1 マスター移行手順

既存の Cloudflare KV に蓄積されたマスター（診療・検査・資格など）を Cloudflare D1 に移行し、Workers API から D1 を参照できるようにする手順をまとめる。2025-10 時点で `functions/index.js` は D1 バインドが存在すれば自動的に D1 を優先し、未設定の場合は従来どおり KV を参照する。

## 前提条件

- Node.js 18 以降と `npm install` 済みのリポジトリ
- Cloudflare Wrangler (`npm install -g wrangler`)
- Cloudflare アカウント権限（D1 の作成・バインド変更が可能であること）
- 既存マスターが `wrangler dev` や本番 API から取得できる状態であること

## 1. 既存マスターを JSON へエクスポート

`scripts/exportMastersFromApi.mjs` は `/api/listMaster` と `/api/listCategories` を呼び出し、D1 へそのまま投入できる JSON を生成する。

```bash
# 本番 API から取得する場合の例
node scripts/exportMastersFromApi.mjs \
  --base-url https://ncd-app.altry.workers.dev \
  --output tmp/masters-export.json \
  --pretty
```

- `--types` で対象種別を絞り込める（デフォルトは test/service/qual/... すべて）。
- 説明 API が未対応の種別は自動的にスキップし、警告のみ表示する。

## 2. D1 データベースを作成

```bash
wrangler d1 create ncd-masters
```

コマンド結果に表示される `database_id` / `preview_database_id` を控えておく。

## 3. `wrangler.toml` に D1 バインドを追加

アプリが D1 を認識できるよう、`wrangler.toml` にバインドを追記する。バインド名は `functions/lib/masterStore.js` が参照する `MASTERS_D1` を推奨。

```toml
[[d1_databases]]
binding = "MASTERS_D1"
database_name = "ncd-masters"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
preview_database_id = "yyyyyyyy-yyyy-yyyy-yyyy-yyyyyyyyyyyy"
```

バインドを追加したら `wrangler dev` / `wrangler publish` などで Workers に反映する。

## 4. D1 へマスターを投入

エクスポート済みファイルを `scripts/migrateMastersToD1.mjs` に渡す。`--truncate` を付けると対象組織（未指定時は共通）に存在する既存データを削除してから投入する。

```bash
node scripts/migrateMastersToD1.mjs \
  --dataset tmp/masters-export.json \
  --db MASTERS_D1 \
  --truncate
```

- `--organization <id>` を指定すると、特定テナントのマスターとして保存できる。
- `--dry-run` を外すと自動的に `wrangler d1 execute` が走る。結果 SQL を残したい場合は `--output tmp/masters-migration.sql` を併用。

## 5. データ確認

投入後、件数を確認しておくと安心。

```bash
wrangler d1 execute MASTERS_D1 \
  --command "SELECT type, COUNT(*) AS cnt FROM master_items GROUP BY type;"

wrangler d1 execute MASTERS_D1 \
  --command "SELECT type, COUNT(*) AS cnt FROM master_categories GROUP BY type;"
```

必要に応じて `master_item_aliases` の件数や、特定 ID のレコードを確認する。

スクリプトで差分をまとめて確認したい場合は、エクスポート済み JSON と D1 を突き合わせる `scripts/verifyMastersInD1.mjs` を利用できる。

```bash
node scripts/verifyMastersInD1.mjs \
  --dataset tmp/masters-export.json \
  --db MASTERS_D1
```

一致しない種別があると、データセットと D1 の件数差分が表示される。

## 6. Workers 側キャッシュを更新

Workers ではマスターを KV キャッシュ (`mastercache:*`) へ保存している。D1 へ切り替え後は以下のいずれかでキャッシュを更新する。

1. `/api/listMaster?type=<type>&force=1` など、新しい種別で API を呼び出して自動更新を誘発する。
2. `POST /api/maintenance/masterCleanup` を実行し、古いレガシーキーを整理する（必要に応じて）。

## 7. 動作確認

バインドを追加した Worker で `/api/listMaster` と `/api/listCategories` を呼び出し、D1 側の内容が反映されることを確認。Playwright や既存の UI で診療科選択、症状検索など D1 依存の画面を開いて整合性をチェックする。

---

これでマスターの読み出し・書き込みは D1 を経由するようになる。以降はスクリプトや API からの新規登録・編集も D1 と KV の両方へ書き込まれるが、KV は互換保持用のバックアップ扱いとなるため、最終的には D1 のみを正本とする計画（KV 側の整理）は別途進める想定。***
