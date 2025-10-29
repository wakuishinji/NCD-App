# 多テナント対応 設計メモ（ドラフト）

2025-10-xx / 和久井さんレビュー前提のドラフト。中野区医師会専用だった NCD Core を複数の医師会・施設グループが利用できるようにするための第一段階の整理。

## 1. ゴール
- 1つの Workers プロジェクト上で複数医師会（=テナント）が並存できる。
- 施設・スタッフ・マスター等のデータは `organizationId` を境界に論理分離し、他テナントから閲覧できない。
- systemRoot 以外の運用者は自テナントのデータだけを見られる。
- 将来的に SkilBank や Medical Orchestra とシームレスに紐づけられるよう、共通 ID を準備する。

## 2. 新規エンティティ
| エンティティ | 役割 |
|--------------|------|
| `organization` | 医師会・自治体ブロックなどの最上位テナント。`id` は `organization:<uuid>`、`slug` (例: `nakano-med`) を付与。名称・住所・連絡先・状態(Active/Trial/Suspended)。|
| `organizationSettings` | マスター差し替え・ロゴ・公開カラー・メール送信先などテナント固有設定。KV では `org:<slug>:settings` のようなキーを想定。|
| `organizationUserRole` *(将来候補)* | systemAdmin より粒度の高い権限。初期は `systemAdmin` を「全テナント参照可」（グローバル運用者）、`organizationAdmin` をテナント内運用者として導入する計画。|

## 3. 既存レコードへの `organizationId` 追加
| レコード | 追加フィールド | 備考 |
|----------|----------------|------|
| `clinic` | `organizationId` (必須)、`mhlwFacilityId` | 施設が所属する医師会。`mhlwFacilityId` は厚労省公開データの施設コード。キーインデックス `organization:<id>:clinics` と `clinic:mhlw:<code>` で管理。|
| `membership` | `organizationId` | `clinicId` から自動設定。施設横断メンバー（委員会など）も扱えるよう、組織単位での役割 (`roles: ['clinicAdmin', 'committeeMember']` など) を将来拡張。|
| `account` | `primaryOrganizationIds` (配列) | 所属組織の一覧。JWT には `memberships` と共に `organizations` を含める。|
| `invite` | `organizationId` | 招待された施設の所属に揃える。JWT 付与前にチェック。|
| `adminRequest` | `organizationId` | 医師会事務が処理する単位。`GET /api/admin/accessRequests` は同一 `organizationId` のみ取得可能にする。|
| `clinicMaster` 系 | `organizationId` or `scope` | マスター値をテナント別に差し替えるための準備（病院向け診療科、検査分類など）。|
| `sessionMeta` | `organizationIds` | ログイン中に参照できるテナント一覧。UI で切り替えられるようにする。|

## 4. キー構造案（KV）
- 既存 `clinic:id:<uuid>` に加え `org:<orgId>:clinic:<uuid>` を用意し `list` 取得を最適化。
- `account:id:<uuid>` はそのまま。`org:<orgId>:account:<uuid>` を追加し、組織単位でメンバーを探索可能にする。
- マスター類 (`master:test:*`) も `org:<orgId>:master:<type>:<id>` を許容し、未設定時はデフォルト（共通マスター）を参照。
- Admin Request, Invite, Membership も同様に `org:<orgId>:` プレフィックスを持つサブキーを持たせる。

## 5. 認証・トークン
- JWT Payload (access/refresh) を以下の形に拡張：
  ```json
  {
    "sub": "account:...",
    "role": "systemAdmin",
    "memberships": [
      {
        "id": "membership:...",
        "clinicId": "clinic:...",
        "organizationId": "organization:...",
        "roles": ["clinicAdmin"],
        "status": "active"
      }
    ],
    "organizations": [
      { "id": "organization:...", "slug": "nakano-med", "name": "中野区医師会" }
    ],
    "tokenType": "access"
  }
  ```
- `systemAdmin` は全テナントを横断できるロールとして残し、テナント管理者は `organizationAdmin` + `clinicAdmin` の組み合わせで運用予定。
- SDK (`web/js/auth.js`) の `roleIncludes` / `requireRole` に `organizationId` を受け取るオプションを追加し、UI からテナントを切り替えるときに限定アクセスできるようにする。

## 6. API 改修ポイント
| API | 対応内容 |
|-----|----------|
| `GET /api/listClinics` | 呼び出し元のロールに応じ、`organizationId` でフィルタ。`systemRoot` のみ全件。|
| `GET /api/clinicDetail` / `POST /api/updateClinic` | `organizationId` チェックを行い、他組織の施設は編集不可。|
| `POST /api/admin/accessRequests*` | `organizationId` が一致する申請のみ取得/承認対象。|
| `POST /api/auth/registerFacilityAdmin` / `acceptInvite` | `clinic.organizationId` に自動紐付けし、招待されたアカウントにも `organizationId` を追加。|
| `GET /api/master/*` | `organizationId` をクエリで受け取り、なければ共通マスターを返す。テナント個別マスターを優先。|

## 7. UI 影響
- ログイン直後に「所属組織を選択」する画面（すでに1つなら自動選択）。`localStorage` に `ncdOrganization` を保持し、一覧 API をフィルタ。
- 管理ダッシュボード上部に現在の組織名・切り替えメニューを配置。`systemRoot` は全組織にスイッチ可能。
- 施設一覧・検索ページに組織切り替えを反映。URL クエリで `org=<slug>` を扱う検討。
- 管理者申請フォーム（`request-admin.html`）に組織セレクトを追加し、正しいテナントへ申請が届くようにする。

## 8. データ移行ステップ（中野区→多テナント）
1. `organization:nakano-med` を作成し、名称・ドメイン・ロゴ設定を登録。
2. 既存 `clinic:id:*` に `organizationId = organization:nakano-med` を付与するスクリプト (`scripts/migrateClinicsToMultitenant.mjs` 仮称)。
3. `membership:*`、`adminRequest:*`、`invite:*`、`session:meta:*` にも同じ ID を追加。
4. マスター設定で中野区用のデフォルト値を `org:nakano-med:*` に書き出す。
5. JWT 発行・解釈に `organizationId` を含める改修を行い、既存セッションを再発行。
6. UI 更新後に QA（複数組織のダミーデータで確認）。

## 9. 実装順序案
1. **スキーマ整備**: KV スクリプトで `organization` レコードを作り、既存施設・メンバーに `organizationId` を追加。`docs/` に Runbook を作る。
2. **APIガード**: Workers 側で `organizationId` チェックを導入し、JWT・セッションに含める。`systemAdmin` の権限整理。
3. **フロント導線**: 組織切り替え UI と API フィルタ。ログイン後のリダイレクト調整。
4. **マスター/設定**: 組織別マスター参照の仕組みを追加。共通マスター fallback。
5. **テスト & 移行**: 自動テストの追加、既存データ移行、QA。
6. **追加機能**: SkilBank との共通アカウント化、Medical Orchestra 連携など次フェーズへ進む。

## 10. 懸念・ ToDo
- `systemAdmin` の役割が「グローバル運用者」になるため、テナント別の運用者ロール（`organizationAdmin`）を新設する必要がある。ロール名整理を別途検討。
- KV での一覧取得コスト。`org:<id>:clinic:<uuid>` のような二重保存で読み込みを最適化する。大規模になる場合は D1/PostgreSQL 移行も視野に入れる。
- Secrets（メール送信、API Keyなど）をテナントごとに切り替える運用手順を整える。`organizationSettings` にて管理。
- 多言語ドメイン（`ncd-app.jp` など）との組み合わせ時に URL で組織を識別する方法（サブドメイン/パス）を決める必要がある。

---

## 11. `organizationId` 移行 Runbook（草案）
1. **現行データの確認**  
   - `wrangler d1 execute MASTERS_D1 --remote --command "SELECT COUNT(*) FROM facilities WHERE organization_id IS NOT NULL;"` で未移行状態を確認。  
   - 旧 KV の `clinic:id:*` に `organizationId` が存在するかサンプリングする（大半は未設定の想定）。
2. **初期テナント登録**  
   - `organization` テーブル（`schema/d1/schema.sql` へ追記予定）に `organization:nakano-med` を投入。  
   - `scripts/organizationSeed.mjs`（作成予定）で名称・住所・連絡先をD1へ登録し、`org:nakano-med:settings` KV を初期化。
3. **施設レコードへの付与**  
   - `node scripts/assignOrganizationToClinics.mjs --db MASTERS_D1 --organization organization:nakano-med --dry-run` で対象件数を確認し、問題なければ `--dry-run` を外して実行する。  
   - 併せて KV 互換キー（`clinic:id:<id>`）/`metadata` 内の JSON にも `organizationId` を追記する。  
   - 実行前に `tmp/clinics-before.jsonl` と `tmp/clinics-after.jsonl` を出力し、差分レビューを行う。
4. **API/Workers 更新**  
   - `saveClinic` が `organizationId` を受け取り、未指定の場合はログインユーザーのデフォルト組織を設定する仕組みを導入。  
   - `listClinics` / `clinicDetail` に `organizationId` フィルタを追加し、JWT の `memberships` からアクセス範囲を制限。  
   - UI 側で現在の組織を選択する導線を実装し、API リクエストに `organizationId` を付与。
5. **整合性チェック**  
   - `SELECT organization_id, COUNT(*) FROM facilities GROUP BY organization_id;` を確認し、null が残っていないかを確認。  
   - KV 側で `org:<slug>:clinic:<id>` のようなインデックスを用意し、`scripts/exportLegacyClinicsKv.mjs` でバックアップを取得後、旧インデックスとの整合性を確認。
6. **段階的ロールアウト**  
   - QA → ステージング → 本番の順で適用し、各段階で Playwright/E2E テストを実行。  
   - 移行完了後、旧仕様に依存する UI/Script を洗い出し `organizationId` 必須化を宣言する。

---
このドラフトをベースに、詳細仕様・マイグレーションスクリプトのチケット化を進める。
