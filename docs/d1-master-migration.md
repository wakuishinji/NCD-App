# D1 マスター移行手順

既存の Cloudflare KV に蓄積されたマスター（診療・検査・資格など）を Cloudflare D1 に移行し、Workers API から D1 を参照できるようにする手順をまとめる。\
2025-11-08 以降は **D1 が唯一の正本** であり、`functions/lib/masterStore.js` は D1 バインド (`MASTERS_D1` or `DB`) が存在しないと即座に例外を投げる実装になっている。必ず最初にバインドを設定した上で以下を進める。

## 前提条件

- Node.js 18 以降と `npm install` 済みのリポジトリ
- Cloudflare Wrangler (`npm install -g wrangler`)
- Cloudflare アカウント権限（D1 の作成・バインド変更が可能であること）
- 既存マスターが `wrangler dev` や本番 API から取得できる状態であること

## 1. 既存マスターを JSON へエクスポート（バックアップ）

`scripts/exportMastersFromApi.mjs` は `/api/listMaster` と `/api/listCategories` を呼び出し、D1 へそのまま投入できる JSON を生成する。\
**作業日のバックアップ** を `tmp/backups/YYYYMMDD-masters.json` のようなパスで必ず保管し、コミット対象外にしておく。

```bash
# 本番 API から取得する場合の例
node scripts/exportMastersFromApi.mjs \
  --base-url https://ncd-app.altry.workers.dev \
  --output tmp/masters-export.json \
  --pretty
```

- `--types` で対象種別を絞り込める（デフォルトは test/service/qual/... すべて）。
- 説明 API が未対応の種別は自動的にスキップし、警告のみ表示する。\
  特定種別だけ差し替える場合は `--types service,test` のように指定。

バックアップ後、`git status` と同ディレクトリにメモを残し「いつ」「どの環境から」取得した JSON なのかを分かるようにしておく。

## 2. D1 データベースを作成（未作成の場合）

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

- `--organization <id>` を指定すると、特定テナントのマスターとして保存できる。複数テナントを扱う場合はジョブを分け、投入順をメモする。  
- `--dry-run` を外すと自動的に `wrangler d1 execute` が走る。結果 SQL を残したい場合は `--output tmp/migrations/<type>-YYYYMMDD.sql` を併用。

## 5. 差分検証

投入後は **件数と内容を必ず確認** する。少なくとも以下を実施:

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

一致しない種別があると、データセットと D1 の件数差分が表示される。差分が出たタイプは `--types` を絞って再移行するか、D1 内の対象レコードを削除→再投入する。\
必要に応じて `master_item_aliases` や特定 ID の内容も個別に `wrangler d1 execute` で確認する。

## 6. キャッシュの再生成

Workers はレスポンス高速化のため `KV (SETTINGS)` に `mastercache:*` を短期保存している。D1 を更新したら必ずキャッシュを無効化する。

1. 任意の管理者アカウントで `/api/listMaster?type=<type>`（または UI から対象画面）を叩いて最新値でキャッシュを再生成する。  
2. もしくは `functions/index.js` の `invalidateMasterCache` を使う API が走るよう、最新マスターを保存する（保存後に自動削除）。  

> **メモ:** 旧 `maintenance/masterCleanup` は KV/legacy ポインタの整理専用エンドポイント。マスターの正本が D1 に統一されたため、通常運用では使用しない（レガシーキーの削除が必要になった時だけ実行）。

## 7. 動作確認

バインドを追加した Worker で `/api/listMaster` と `/api/listCategories` を呼び出し、D1 側の内容が反映されることを確認。Playwright や既存の UI で診療科選択、症状検索など D1 依存の画面を開いて整合性をチェックする。

### 推奨チェックリスト
- `npm run dev`（または Staging）で管理画面のマスター編集 UI を開き、一覧・検索・保存が機能するか。
- `node scripts/exportMastersFromApi.mjs --base-url http://localhost:8787` を実行し、件数が D1 の `COUNT(*)` と一致するか。
- `api/listCategories?type=test` 等でカテゴリが D1 由来の並び順で返ってくるか。

## 8. レガシー KV の整理

1. `wrangler kv:key list --binding SETTINGS --prefix master:` で残存している `master:{type}:` キーや `mastercache:` キーを確認。  
2. `scripts/cleanupLegacyMasterKeys.mjs`（`maintenance/masterCleanup` API 相当）を dry-run → 本実行し、`legacyKeys` が 0 になるまで繰り返す。  
3. `node scripts/reportMasterKvOrphans.mjs --api-base <環境URL>` を実行し、`reports/master-kv-orphans.json` に残件のサマリ（カテゴリ名・キー名）を出力しておく。  
   - `npm run report:master-orphans -- --api-base https://ncd-app.altry.workers.dev` で同等のレポートを生成可能。  
4. 完了後は `reports/master-kv-orphans.json` を共有し、再発した場合にすぐ洗い出せるようにする。

---

これでマスターの読み出し・書き込みは D1 のみを経由する。以降はスクリプトや API からの新規登録・編集も D1 を正本とし、KV 側はキャッシュ用途 (`mastercache:*`) とレガシーポインタ洗い替え時のみ利用する。***
