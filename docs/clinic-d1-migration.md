# クリニックデータ D1 移行計画（Draft）

2025-10-29 時点でのクリニック（施設）データを Cloudflare D1 に移行するための設計メモ。  
`schema/d1/schema.sql` では `facilities` テーブルなど基礎構造が用意されているが、既存スキーマ v1 → v2 → D1 への切り替えには追加作業が必要。

---

## 1. 現状整理
- **保存場所**: クリニック情報は KV (`SETTINGS` name/index) に schema v1 のまま保存されている。Workers の `saveClinic` は `SCHEMA_VERSION=1` を維持。  
- **変換ツール**: `scripts/exportClinicsV1.mjs` → `scripts/migrateClinicsToV2.mjs` → `scripts/verifyClinicsV2.mjs` で v2 JSONL を生成・検証できる。  
- **D1 スキーマ**: `facilities` テーブルには `name`, `address`, `postal_code`, `latitude`, `longitude`, `facility_type` など基本属性のみ定義。電話・メール・診療メニュー等の詳細フィールドは未整備。  
- **整合性**: v2 JSON には `basic.*`（電話・メールを含む）、`services/tests/qualifications` といった配列、`metadata`、`searchFacets` が含まれる。D1 へ保存するにはテーブル拡張または別テーブルが必要。

---

## 2. D1 スキーマ拡張案
最小構成として以下の列を `facilities` に追加することを想定。

| カラム | 型 | 用途 |
|--------|----|------|
| `phone` | TEXT | `basic.phone` |
| `fax` | TEXT | `basic.fax` |
| `email` | TEXT | `basic.email` |
| `website` | TEXT | `basic.website` を正規化して保存 |
| `metadata` | TEXT | v2 JSON 全体を格納するバックアップ（JSON string） |

> 将来的には `services/tests/qualifications` を正規化するテーブルを別途用意し、検索・集計で活用できるようにする。

追加列を反映するには `ALTER TABLE facilities ADD COLUMN ...` を用いたマイグレーションを作成する（例: `schema/d1/migrations/002_facilities_extras.sql`）。

---

## 3. 移行 Runbook（案）
1. **事前準備**  
   - `wrangler d1 execute MASTERS_D1 --remote --file schema/d1/schema.sql` で基礎テーブルを適用済みであることを確認。  
   - 追加列を含むマイグレーション SQL を作成し、`wrangler d1 execute` で本番/プレビューへ適用。  
2. **データ抽出・整形**  
   - `node scripts/exportClinicsV1.mjs --output tmp/clinics-v1.jsonl` で安全なバックアップを取得。  
   - `node scripts/migrateClinicsToV2.mjs --input tmp/clinics-v1.jsonl --output tmp/clinics-v2.jsonl` で v2 形式へ変換。  
   - `node scripts/verifyClinicsV2.mjs --input tmp/clinics-v2.jsonl --report tmp/clinics-v2-report.json` で必須項目＆マスタ参照を検証。警告・欠損をレビュー。  
3. **D1 への投入**  
   - 新規スクリプト `scripts/importClinicsToD1.mjs`（作成予定）を用意し、v2 JSONL を読み込んで `facilities` テーブルへ `INSERT ... ON CONFLICT(id) DO UPDATE`。  
   - `metadata` に v2 JSON を丸ごと保存しておき、テーブル列へのマッピングは必要項目から順次追加する。  
   - データ確定後 `wrangler d1 execute ... --command "SELECT COUNT(*) FROM facilities;"` で件数を確認。  
4. **Workers 側の切り替え**  
   - `saveClinic` / `getClinic*` を D1 参照に変更 (`SCHEMA_VERSION = 2`)。  
   - KV には `clinic:name:*` / `clinic:id:*` を参照用キャッシュとして残し、書き込みは D1 → KV 反映 or D1 単独へ段階的に移行。  
   - API レスポンスを v2 JSON に統一し、UI 側で `basic.*` / `services.*` を参照できるように調整。  
5. **フォローアップ**  
   - D1 から v2 JSON を再構成するヘルパーを実装し、`metadata` を戻り値に活用（暫定）。  
   - 多テナント運用向けに `organization_id` 列を追加し、 clínicas を医師会単位でフィルタできるようにする。

---

## 4. 差分管理と QA
- 変換・検証・投入の各ステップで JSONL / report を保存し、`docs/kv-backup-policy.md` に沿って R2 バックアップを残す。  
- QA 環境で全手順を実施し、`verifyClinicsV2` の警告が 0 になるようデータ補正（住所・郵便番号など）を行う。  
- 本番投入後、旧 KV データと D1 データの差分を比較する CLI（`scripts/diffClinicsKvVsD1.mjs` など）を作成し、移行完了を証明。

---

## 4.1 施設関連テーブルの正規化案

| テーブル | 目的 | 主なカラム | 備考 |
|----------|------|------------|------|
| `facility_services` | 施設が提供する診療・サービス | `facility_id`, `service_id`, `name`, `category`, `source`, `notes`, `created_at` | `service_id` は `master_items.id` と連携。名称のみ登録された項目は `service_id` を null で保持。 |
| `facility_tests` | 実施検査の一覧 | `facility_id`, `test_id`, `name`, `category`, `source`, `notes`, `created_at` | `master_items` の `type = 'test'` を参照。 |
| `facility_qualifications` | 保有資格 | `facility_id`, `qualification_id`, `name`, `issuer`, `obtained_at`, `notes`, `created_at` | 医師個人の資格ではなく、施設が公開する資格タグとして扱う。 |
| `facility_staff_lookup` | スタッフと施設の紐付け | `facility_id`, `account_id`, `membership_id`, `roles`, `status`, `created_at` | `memberships` を横断的に参照し、検索／同期用キャッシュとして利用。 |

実装ステップ案:
1. `schema/d1/migrations/003_facility_service_tables.sql` を作成し、上記テーブルを追加。FK 制約は `ON DELETE CASCADE` を採用して施設削除時に連鎖削除。  
2. `scripts/importClinicsToD1.mjs` で `clinic.services/tests/qualifications` を分割保存するロジックを追加し、`metadata` には従来どおり v2 JSON を格納。  
3. Workers 側で `clinicFromD1Row` から復元する際、テーブル結合でリストを再構築する（暫定的に `SELECT ... FROM facility_services WHERE facility_id = ?`）。  
4. `listClinics` では JOIN が増えるため、`LIMIT`/`OFFSET` で施設一覧を取得後に `Promise.all` で個別ロードするか、要約情報のみ返す API を追加してキャッシュを活用する。

段階的に導入できるよう、`metadata` → 正規化テーブルの二重保存期間を設け、整合性確認後に `metadata` の冗長項目を削除する。

---

## 5. 今後のタスク
1. `schema/d1/migrations/002_facilities_extras.sql` を本番/プレビューへ適用する。（電話・メール・サイト等の列追加）  
2. `schema/d1/migrations/003_facility_service_tables.sql` を適用し、サービス／検査／資格テーブルを作成する。  
3. `node scripts/importClinicsToD1.mjs --input tmp/clinics-v2.jsonl --db MASTERS_D1 --output tmp/clinics-import.sql --execute` で D1 へ投入する。  
4. Workers の `saveClinic` / `getClinic*` を D1 対応に書き換え、`SCHEMA_VERSION = 2` へ更新。  
5. UI/API テストを v2 スキーマに合わせて更新（Playwright/Vitest）。  
6. `node scripts/assignOrganizationToClinics.mjs --db <binding> --organization <id>` で既存施設へ `organizationId` を付与する。  
7. 多テナント化用の Runbook を整備し、API/UI 側の組織切替を実装する。

---

> このドキュメントはドラフトです。マイグレーション SQL やインポートスクリプトの実装を完了させた後、正式版として更新してください。
