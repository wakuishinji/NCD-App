# D1 Schema Overview

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

## 適用コマンド例

```bash
wrangler d1 execute <DATABASE_NAME> --file schema/d1/schema.sql
```

## 今後の拡張

1. Facilities/Practitioners 以外のマスター（診療メニュー、資格、カテゴリなど）も D1 に移行する場合は、このディレクトリにテーブル追加 DDL を追記してください。
2. マイグレーションを細かく管理する場合は `schema/d1/migrations/001_initial.sql` のような形に分割し、CI で適用順を管理する運用に切り替える予定です。
3. テーブル構造を変更した際は、Playwright や API テストを更新し、`docs/roadmap.md` のデータ基盤計画を最新化してください。

