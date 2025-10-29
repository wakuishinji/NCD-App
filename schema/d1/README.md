# D1 スキーマ概要

このディレクトリは NCD プラットフォームの Cloudflare D1 スキーマを管理します。`schema.sql` を `wrangler d1 execute` で適用することで、基本テーブル・インデックス・トリガーをまとめて作成できます。

## テーブル概要

- **facilities**  
  施設の正本情報。厚労省 ID や所在地、種別、同期ステータスを保持します。`external_id` は厚労省 ID など外部キーを格納する想定です。

- **facility_mhlw_snapshot**  
  厚労省同期時のスナップショットを JSON で保持します。

- **facility_schedule**  
  施設の診療時間。曜日（0=日曜〜6=土曜）と時間帯、診療科コードを保持します。

- **accounts / practitioners / memberships**  
  アカウントと医療者、施設所属の情報を格納します。`memberships` は役割や所属期間を管理できるようユニーク制約を組み込んでいます。

- **mhlw_imports**  
  CSV 取り込みの履歴。R2 に保存した整形 JSON のキーなどを記録し、失敗時の再実行に備えます。

- **audit_log**  
  重要操作の監査ログ。API から操作した際に差分を JSON 形式で保存します。

- **master_categories / master_items / master_item_aliases**  
  検査・診療・資格などの各種マスター本体。`organization_id` を持たせることで将来的なテナント別マスターを収容できるようにしています。  
  - `master_categories` … 種別ごとの分類ラベルと並び順を保持。  
  - `master_items` … マスター項目本体。説明文・備考・類義語など既存 KV スキーマの主要フィールドを JSON テキストで保持。`legacy_key`/`legacy_aliases`/`comparable_key` で旧キー互換を確保。  
  - `master_item_aliases` … 旧来の `legacyKey` や別名を `alias → item_id` で解決するルックアップテーブル。

- **master_explanations**  
  サービス/検査マスター向けの長文説明やバージョン履歴を格納。`tags` や `source_facility_ids` は JSON 文字列で保持し、従来の KV 格納形式と互換です。

## マイグレーション支援ツール

- `scripts/migrateMhlwToD1.mjs` — 厚労省 CSV を取り込み、施設テーブルへ投入する CLI。
- `scripts/migrateMastersToD1.mjs` — `listMaster`/`listCategories` の JSON を読み取り、`master_*` テーブルへ SQL を生成・実行する CLI。  
  - `--dataset export.json` で集約ファイルを読み込み、`--master type:path` で種別ごとの JSON を上書きできます。  
  - `--organization <id>` を指定すると、テナント別マスターとして `organization_id` 列に保存されます。省略時は共通マスター (`NULL`) として扱います。  
  - `--truncate` を付けると指定 `organization_id` の既存レコードを削除してから投入します（FK により alias も自動削除）。
- `scripts/exportMastersFromApi.mjs` — 既存 Workers API からマスター情報を一括取得し、`migrateMastersToD1.mjs` へ渡せる JSON を生成します。  
  - `--types` で対象種別を絞り込み、`--pretty` で整形 JSON を保存できます。  
  - 説明文 API が未対応の種別は自動でスキップし、警告のみ出力します。
- `scripts/verifyMastersInD1.mjs` — エクスポートした JSON と D1 上の件数を比較し、移行後の差分を確認する CLI。

## 適用コマンド例

```bash
wrangler d1 execute <DATABASE_NAME> --file schema/d1/schema.sql
```

## 今後の拡張
1. 施設・医療者以外のマスター（診療メニュー、資格、カテゴリなど）も D1 に移行する場合は、このディレクトリにテーブル追加 DDL を追記してください。
2. マイグレーションを細かく管理する場合は `schema/d1/migrations/` 以下に順序付きファイルを追加してください（例: `002_facilities_extras.sql` で基本カラム追加、`003_facility_service_tables.sql` でサービス／検査／資格テーブルを正規化）。
3. テーブル構造を変更した際は、Playwright や API テストを更新し、`docs/roadmap.md` のデータ基盤計画を最新化してください。

詳しい移行・セットアップ手順は `docs/d1-master-migration.md` を参照。
