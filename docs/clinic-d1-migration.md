# クリニックデータ D1 移行計画（Draft）

2025-10-29 時点でのクリニック（施設）データを Cloudflare D1 に移行するための設計メモ。  
`schema/d1/schema.sql` では `facilities` テーブルなど基礎構造が用意されているが、既存スキーマ v1 → v2 → D1 への切り替えには追加作業が必要。

---

## 1. 現状整理
- **保存場所**: クリニック情報は KV (`SETTINGS` name/index) に schema v1 のまま保存されている。Workers の `saveClinic` は `SCHEMA_VERSION=1` を維持。  
- **変換ツール**: `scripts/exportClinicsV1.mjs` → `scripts/migrateClinicsToV2.mjs` → `scripts/verifyClinicsV2.mjs` で v2 JSONL を生成・検証できる。  
- **D1 スキーマ**: `facilities` テーブルには `name`, `address`, `postal_code`, `latitude`, `longitude`, `facility_type` など基本属性のみ定義。電話・メール・診療メニュー等の詳細フィールドは未整備。  
- **整合性**: v2 JSON には `basic.*`（電話・メールを含む）、`services/tests/qualifications` といった配列、`metadata`、`searchFacets` が含まれる。D1 へ保存するにはテーブル拡張または別テーブルが必要。

## 実行中のステップ (2025-Q4)
1. `schema/d1/migrations/005_facility_extended_tables.sql` で施設拡張テーブル／列を定義し、既存スキーマとの不整合がないことを確認する。  
2. Workers (`functions/index.js`) の D1 読み書き処理を拡張テーブル向けに実装し、KV との整合を保つ。  
3. 旧 KV（および厚労省インポート）から新テーブルへデータを移行するスクリプト／Runbook の叩き台を作成する。

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
| `facility_services` | 施設が提供する診療・サービス | `facility_id`, `master_id`, `name`, `category`, `source`, `organization_id` | `master_id` は `master_items.id`。`source` で `manual` / `mhlw` を判別。 |
| `facility_tests` | 実施検査 | `facility_id`, `master_id`, `name`, `category`, `source`, `organization_id` | |
| `facility_qualifications` | 施設として掲示する資格 | `facility_id`, `master_id`, `name`, `issuer`, `obtained_at`, `source`, `organization_id` | |
| `facility_departments` | 標榜診療科 | `facility_id`, `department_code`, `name`, `is_primary`, `source`, `organization_id` | 厚労省データと手入力の両方を格納。 |
| `facility_beds` | 病床数 | `facility_id`, `bed_type`, `count`, `source`, `organization_id` | |
| `facility_schedule` | 診療時間 | 既存テーブルを拡張し `source`, `organization_id`, `department_code` を追加 | |
| `facility_access_info` | アクセス情報 | `facility_id`, `nearest_station`, `bus`, `parking_*`, `barrier_free`, `notes`, `summary`, `source`, `organization_id` | JSON ではなく列で保持し検索しやすくする。 |
| `facility_modes` | 診療形態 | `facility_id`, `code`, `label`, `notes`, `source`, `organization_id` | e.g. オンライン診療・往診など。 |
| `facility_vaccinations` | 予防接種対応 | `facility_id`, `vaccine_code`, `name`, `notes`, `source`, `organization_id` | |
| `facility_checkups` | 健診／検診対応 | `facility_id`, `checkup_code`, `name`, `notes`, `source`, `organization_id` | |
| `facility_extra` *(将来設置)* | その他自由項目 | `facility_id`, `payload(JSON)`, `source`, `organization_id` | RAG 用のドキュメント生成にも活用。 |
| `facility_staff_lookup` | スタッフと施設の紐付け | `facility_id`, `account_id`, `membership_id`, `roles`, `status`, `organization_id` | `memberships` からのキャッシュ。チャット・検索用途。 |

実装ステップ案:
1. `schema/d1/migrations/003` / `005` でテーブル追加・既存テーブルへの列追加（`organization_id` / `source` など）を行う。  
2. Workers API（`saveClinic` / `clinicDetail` / `clinicSearch` 等）を D1 正規化テーブルへ完全移行させ、旧 KV からは読まない構造にする。  
3. 旧 KV に残っているアクセス情報や診療形態等は移行スクリプトで D1 へコピーし、`source='legacy'` として記録。  
4. 厚労省インポートパイプラインを D1 正規化テーブルへ直書きするよう更新。`source='mhlw'` または `import_batch_id` で識別。  
5. 検索・RAG 用に施設ドキュメントを生成する仕組み（JSON/テキスト）とベクトル化処理を整備する。  
6. UI は D1 から返った JSON を表示・編集し、保存時は新テーブルへ反映できるようリファクタリングする。

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

---

## 6. 拡張コレクション移行フロー（Draft）

| 手順 | 内容 | 備考 |
|------|------|------|
| 6-1 | `tmp/clinics-v2.jsonl` を最新化し、`clinic.departments` や `clinic.access` など v2 スキーマの配列／オブジェクトが含まれていることを確認する。 | `scripts/exportClinicsV1.mjs` → `scripts/migrateClinicsToV2.mjs` |
| 6-2 | 新規スクリプト `scripts/generateFacilityCollectionsSql.mjs`（作成予定）で JSONL から以下の INSERT を生成する。 | チャンク単位で `BEGIN/COMMIT` を付与し、`tmp/facility-collections.sql` を出力する。 |
| 6-3 | 生成した SQL を `wrangler d1 execute MASTERS_D1 --remote --file tmp/facility-collections.sql` で実行し、`facility_departments` / `facility_access_info` などを更新する。 | まずプレビュー DB で検証し、結果をレビュー後に本番適用する。 |
| 6-4 | `SELECT COUNT(*)` や `SELECT * LIMIT 5` で差し込み結果を目視確認し、UI で診療所詳細を開いて反映状況をチェックする。 | 特に `診療形態` / `予防接種` / `健診` の表示を重点確認。 |
| 6-5 | 厚労省インポートの補完データ（`mhlwDepartments`, `mhlwBedCounts` など）を `source='mhlw'` として同スクリプトで投入する。 | `scripts/importMhlwFacilities.mjs` の出力を再利用する。 |
| 6-6 | Runbook に基づき、移行後の再実行手順／ロールバック手順を記録しておく。 | `docs/ops-runbook.md` に反映予定。 |

### 6.2 で生成するテーブル別マッピング

| D1 テーブル | JSON フィールド | 変換ルール | `source` 列 |
|-------------|-----------------|------------|-------------|
| `facility_departments` | `clinic.departments.master` / `.others` / `clinic.mhlwDepartments` | master: `department_code = department:<slug>`、others: `department_code=NULL`、mhlw: `source='mhlw'` | `manual` / `manual-other` / `mhlw` |
| `facility_beds` | `clinic.beds[]`, `clinic.facilityAttributes.bedCount`, `clinic.mhlwBedCounts` | `bed_type` は種別または `total`、値は整数化 | `manual` / `mhlw` |
| `facility_access_info` | `clinic.access` | 配列は改行区切りで保存、`summary` が無ければサーバー側で自動生成 | `clinic.access.source`（未設定時は `manual`） |
| `facility_modes` | `clinic.modes.selected/meta` | `display_order = meta[slug].order`、`notes = meta[slug].notes` | `clinic.modes.source`（未設定時は `manual`） |
| `facility_vaccinations` | `clinic.vaccinations.selected/meta` | `description = meta[slug].desc`、`reference_url = meta[slug].referenceUrl` | `clinic.vaccinations.source` |
| `facility_checkups` | `clinic.checkups.selected/meta` | `description = meta[slug].desc`、`reference_url = meta[slug].referenceUrl` | `clinic.checkups.source` |
| `facility_extra` | `clinic.extra` | JSON 全体を `payload` に保存し、`extra.source` を `source` 列へ | `extra.source`（未設定時は `manual`） |

> スクリプト実装時は `INSERT ... ON CONFLICT(id) DO UPDATE` を基本とし、移行再実行時にも破壊的にならないようにする。`facility_departments` など ID は `facilityId:collection:uuid` 形式を既存実装と合わせる。

### 関連スクリプト

- [x] `scripts/generateFacilityCollectionsSql.mjs` で v2 JSON → `facility_*` テーブル用 SQL を生成できる。  
  ```bash
  node scripts/generateFacilityCollectionsSql.mjs \
    --input tmp/clinics-v2.jsonl \
    --output tmp/facility-collections.sql \
    --chunk-size 100

  # プレビュー DB で即実行する場合
  node scripts/generateFacilityCollectionsSql.mjs \
    --input tmp/clinics-v2.jsonl \
    --execute --db MASTERS_D1 --no-remote
  ```
- [x] `scripts/importClinicsToD1.mjs` の `--include-collections` フラグで、基礎テーブルと拡張コレクションを同時に SQL 生成／適用できる。  
  ```bash
  node scripts/importClinicsToD1.mjs \
    --input tmp/clinics-v2.jsonl \
    --db MASTERS_D1 \
    --output tmp/clinics-import-all.sql \
    --include-collections
  ```
- [ ] プレビュー DB での検証を自動化するため、主要カラムの件数・NULL 率をチェックするタスク (`npm run verify:collections` など) を整備する。  
