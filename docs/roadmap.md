# クリニック/医師拡張計画（案）

将来的に「一休.com のように多条件でクリニックと医師を検索できるサイト」を実現するための基礎設計メモ。現行仕様（`docs/specification.md` / `docs/api.md` / `agent.md`）を前提に、段階的な拡張方針を整理する。

---

## 1. 目標像
- クリニックと所属医師の詳細情報を登録し、複数条件での絞り込み検索を可能にする。
- クリニック管理者と所属医師がそれぞれログインし、権限範囲内でデータを編集できる。
- エンドユーザーは症状・診療科・設備・医師スキルなどで柔軟に検索できる。

---

## 2. 現状整理
- **データ格納**: Cloudflare Workers KV に `clinic:<uuid>` などの JSON を保存。医師データは未実装。
- **マスター類**: `functions/index.js` の `MASTER_TYPE_LIST` によるシンプルな種別管理（検査/診療/資格/施設認定/症状/体部位など）。
- **認証**: 管理者向け API は無認証。ユーザー/医師用アカウントは存在しない。
- **検索 UI**: `searchMap.html` と `searchSymptom.html` が暫定実装。高度なフィルタやスコアリングは未対応。

---

## 3. データモデル拡張案

### 3.1 主要エンティティ
| エンティティ | 主キー | 主なフィールド | 補足 |
|--------------|--------|----------------|------|
| `clinic` | `clinic:<uuid>` | 基本プロフィール（名称/住所/診療形態/設備/対応サービス等）、`managerAccounts`、`physicianRefs`、`searchFacets` | 現行フィールドを踏まえて拡張。`searchFacets` にフィルタ用正規化値を保持。 |
| `physician` | `physician:<uuid>` | 氏名（漢字/ローマ字）、職種、資格、専門領域、担当サービス/検査、プロフィール文、`clinicIds` | 医師単独の公開/検索用データを保持。複数クリニック所属を許容。 |
| `account` | `account:<uuid>` | ログイン情報（メール/電話、パスワードハッシュ or 外部ID）、アカウント種別（`clinicAdmin`/`clinicStaff`/`systemAdmin`/`physician`）、`clinicRoles` | 認証/認可テーブル。Workers KV でも運用できるが、D1 等 RDB 検討余地。 |
| `invitation` | `invite:<uuid>` | 招待先メール、招待者、ロール、期限、状態 | クリニック管理者が所属医師・スタッフを招待するフロー向け。 |
| `physicianProfileDraft` | `physician:draft:<uuid>` | 医師本人だけが編集可能な下書き情報（履歴書メモ、公開前データ） | 公開情報と非公開メモを分離するためのストレージ候補。 |
| `society` | `master:society:<classification>|<name>` | 分類（医師/看護/コメディカル 等）と学会名、承認ステータス、ソース | 学会候補を一元管理し、個人資格・医師プロフィール登録時のプルダウンへ供給する。 |

### 3.2 リレーション設計メモ
- `clinic.managerAccounts` に clinicAdmin の `accountId` を保持。所属スタッフは `clinic.staffAccounts` or `clinicMembers` 配列で管理。
- `physician.clinicIds` と `clinic.physicianRefs` を双方向で張り、検索時に整合性チェックを行う。
- 医師プロフィールと資格マスター（`master:qual:*`）、学会マスターを紐付け、`physician.qualifications`、`physician.societyMemberships` を `masterKey` ベースで保持。
- 学会マスター（`master:society:<classification>|<name>`）を整備し、個人資格マスターやクリニック入力時の「学会名」プルダウンはこのデータを参照する。分類×学会名の重複排除と承認フローを実装する。
- 医師の履歴書テンプレート生成に必要な学歴・職歴・研究業績・論文リストなども構造化し、公開可否フラグを付与。下書き用データは `physicianProfileDraft` に保存して本人のみ閲覧可能とする。
- フィルタリング高速化のため、シリアライズ時に `searchFacets`（例: `["department:内科","service:糖尿病外来","qualification:認定内科医","physicianSkill:消化器内視鏡"]`）を precompute。
- クリニック表示用の資格・所属学会は、所属医師の公開プロフィールから集計して `clinic.aggregateQualifications` のようなビュー生成を行う。既存のクリニック側 `personalQualifications` は最終的に医師プロファイル由来の読み取り専用フィールドへ移行。

### 3.3 スキーマバージョン管理
- 既存の `clinic.schema_version` を流用し、医師対応で `schema_version=2` へ移行。
- 医師スキーマにも `schema_version` を持たせ、将来の拡張（例: スケジュール、言語対応、履歴書テンプレート変更）に備える。
- KV 以外のストレージ検討時でも、スキーマ変換スクリプト（`scripts/migrateClinicSchemaV2.mjs` など）を用意する。

---

## 4. 認証・認可方針（案）

- **アカウント登録**: 現在の single-admin 前提に加え、`systemAdmin` が招待リンクを発行し `clinicAdmin` が初期ログインする流れを追加。
- **認証方式**: 初期は Workers での JWT + KV セッションストアを想定。将来的には Cloudflare Access / Turnstile / 外部 IdP も選択肢。
- **権限モデル**:
  - `systemAdmin`: 全クリニック・全マスターを操作可能（現行アプリ管理者）。
  - `clinicAdmin`: 自院のクリニックプロフィール／所属医師／診療サービス編集、医師アカウント招待・権限管理が可能。
  - `clinicStaff`: 自院の医師情報編集や特定セクション（例: 設備、診療メニュー）の更新のみ許可するなど細分化。
  - `physician`: 自分のプロフィール・履歴書情報・メモスペースの編集が可能（公開範囲をセルフコントロール）。
- **認可実装**: `functions/index.js` をエンドポイント単位で `requireRole(['clinicAdmin'])` のように拡張し、リクエストコンテキストにアカウント情報を付与するミドルウェア層を検討。
- **監査ログ**: 変更履歴を KV/R2 に保存 or Cloudflare Analytics に記録し、誰がどの項目をいつ変更したかトレースできるようにする。

---

## 5. 検索・インデックス戦略
- **フェーズ1（KVのみ）**: クリニック・医師データ保存時に `searchFacets` を生成し、Cloudflare Workers 内でフィルタリングロジックを実装。医師検索では専門領域/資格/検査/診療タグを重視。件数が少ないうちは KV + メモリで処理可能。
- **フェーズ2（インデックス強化）**: 
  - Cloudflare D1 or Supabase/PostgreSQL などを併用し、条件検索を SQL で処理。
  - もしくは Algolia/MeiliSearch などの検索 SaaS へシンクするバッチを実装。
- **フェーズ3（ランキング/UX）**: ユーザーのキーワードや予約ニーズに応じてスコアリング・並び替え（レビュー評価、診療時間、アクセス）を導入。
- **UI 拡張**:
  - `searchMap.html`: 医師・サービス・設備フィルタ、検索結果ハイライト、地図とリストの連動。
  - `searchSymptom.html`: 関連医師・専門領域の表示、症状→サービス→医師→クリニックのナビゲーション。

---

## 6. 移行・開発ステップ（案）
1. **データモデル確定**: 上記エンティティ・フィールドをさらに詳細化し、`docs/specification.md` に反映。
2. **バックエンド準備**:
   - Workers のストレージ抽象化 (`dataStore.getClinic`, `dataStore.savePhysician` など) を整備。
   - 認証ミドルウェアとアカウント API (`/api/auth/register`, `/api/auth/login`, `/api/accounts/invite`) を実装。
3. **フロントエンド改修**:
   - 管理者用 UI にアカウント管理、医師プロフィール編集画面を追加。
   - クリニック/医師検索 UI のワイヤーフレーム作成と段階的実装。
   - 既存の個人資格入力フォームでは「学会名」フィールドを中心に学会マスター候補を収集し、医師プロフィールと同期する。
   - 学会マスター管理ページ（`admin/societyMaster.html`）で分類×学会名を直接メンテナンスできるようにする。
4. **マイグレーション/テスト**:
   - 既存クリニックデータのスキーマ移行スクリプトを作成 (`scripts/migrateClinicSchemaV2.mjs`)。
   - Vitest などで新 API の単体テストと E2E テスト（Playwright/Selenium 等）を整備。
   - `scripts/migrateSocietyNotes.mjs` で既存「備考」を学会名へ正規化し、分類×医療分野のマスタ候補を収集・投入する。
   - 住所入力時に Google Geocoding API で緯度経度を自動計測し、検索マップに反映する。必要に応じて `scripts/geocodeClinics.mjs` で既存データを一括補完する。
5. **リリース準備**:
   - 招待フローと権限分離を検証環境で確認。
   - 検索性能/UX を検証し、ロードマップに基づいてトラック化。

---

## 7. 残課題
- `web/web.config` のリダイレクト方式や `node_modules/` 整理といった既存ToDoを処理し、将来の開発環境整備を進める。
- セキュリティ（パスワードハッシュ、レート制御、監査ログ）とコンプライアンス（個人情報保護）の要件定義を追加する必要がある。
- 医師プロフィール公開範囲やユーザー評価機能など、フェーズ分けした UX 要件をユーザーと合意してから実装に入る。
- 学会マスターの承認フローや分類ポリシー（医師/看護 等）の整備、重複エントリの整理を継続的に行う。

---

## 8. コラボレーション機能構想（SkilBank / NCD 共通）
- **チャット基盤**: NCD 内に Slack 風のリアルタイムチャットを実装し、組織や診療科単位でグループを作成できるようにする。アカウント登録済みユーザー（システム管理者／施設管理者／スタッフ）が参加し、権限に応じたグループ可視性を制御する。
- **議題管理**: グループ内で議題（トピック）を登録し、チャットタイムラインと紐づけて議事録を残す。議題ごとに参照ドキュメントやリンクを設定し、いつでも履歴を振り返られるようにする。
- **ファイル共有**: グループ専用のファイル倉庫を用意し、チャットで共有されたファイルを自動的に整理・保存する。アクセス制御はグループメンバーと権限ロールに連動させる。
- **SkilBank 連携**: スタッフプロフィールやスキル情報とチャットの議題／タスクを連携し、議論中に参照すべき個人スキル・履歴書を即座に開ける導線を整備する。
- **監査・アーカイブ**: 医療情報を扱う前提で監査ログ、履歴保存、エクスポート手段を整備し、退職者のアカウントや共有ファイルの扱いも含めたガバナンスを定義する。

---

## 9. モジュール別実装フェーズ整理
- **フェーズA: 施設データベース基盤（①）**  
  - 目的: 診療所中心の入力・管理フローを完成させ、病院データ拡張の土台を整える。  
  - 機能範囲: 新規施設登録→施設管理者初期アカウント発行、施設詳細/設備/サービス/検査入力、マスター管理、Schema Version 2 への移行スクリプト。  
  - データ/インフラ: Cloudflare Workers + KV を継続利用しつつ、病院向け追加フィールド（病床数、診療科構成など）を設計。認証基盤にアカウント種別（システム管理者／施設管理者／スタッフ）を導入。  
  - 検証/出口: 施設管理者が自施設データを一通り更新でき、既存診療所データがマイグレーション後も整合すること。監査ログの最小実装とユニット/E2E テストを整備。
  - タスク詳細:
    - データモデル更新: `clinic` スキーマに病院対応フィールド・`managerAccounts`・スタッフ参照を追加し、スキーマバージョン2の整合チェックを実装。
    - 認証/権限: ログインAPIとミドルウェアを刷新し、システム管理者/施設管理者/スタッフのロール判定とトークン管理を実装。トップ画面→管理者ログイン動線を更新。
    - UI/UX: 新規施設登録後の施設管理者アカウント作成フォーム（氏名・生年月日・職種・初期PW）を追加。施設ホームでスタッフカードから登録導線を整備。
    - API拡張: 施設管理者によるスタッフCRUD API、初期パスワード発行、スタッフ一覧取得、施設データの編集履歴保存を追加。
    - マイグレーション: 既存施設データをスキーマ2へ変換するスクリプトとバックアップ手順を整備。テストデータで移行検証。
    - QA/モニタリング: 主要シナリオのE2Eテスト、権限別アクセス制御テスト、監査ログ検証。Workersのログとアラート設定を更新。
  - 詳細設計メモ:
    - `clinic` スキーマ v2 主要フィールド  
      - `id`（UUID）、`schemaVersion`（固定 2）、`basic`（名称・住所・連絡先・位置情報）、`clinicType`（診療所/病院など）、`facilityAttributes`（病床数、診療科構成、在宅対応等）、`services/tests/qualifications`（既存配列）、`searchFacets`（絞り込み用キャッシュ）。  
      - 管理関連: `managerAccounts`（アカウントID配列）、`staffMemberships`（membershipId配列）、`status`（active/inactive/pending）、`auditTrail`（最新変更のサマリ）。  
      - メタデータ: `createdAt/updatedAt`, `createdBy/updatedBy`, `notes`. 将来の病院連携に備え `parentOrganizationId` や `groupCodes` を予約フィールドとして定義。
    - `clinic` スキーマ v2 詳細  
      - 構造概要  
        | フィールド | 型 | 概要 |
        |------------|----|------|
        | `id` | string(UUID) | 施設固有ID。 |
        | `schemaVersion` | number | 常に `2` を保持。 |
        | `basic` | object | 名称・名称カナ・住所・連絡先・URL 等の基本情報。 |
        | `location` | object | 緯度経度・座標精度・住所正規化情報。 |
        | `clinicType` | string | `clinic` / `hospital` / `dental` 等。 |
        | `facilityAttributes` | object | 病床数、診療科構成、在宅対応、救急区分など。 |
        | `services` / `tests` / `qualifications` | array | 既存のマスター参照リスト。 |
        | `managerAccounts` | string[] | 施設管理者アカウントID。 |
        | `staffMemberships` | string[] | `membership:<uuid>` リスト。 |
        | `status` | string | `active` / `inactive` / `pending`。 |
        | `searchFacets` | string[] | 検索用キャッシュ（`department:内科` 等）。 |
        | `auditTrail` | object | 最新変更の概要（`lastUpdatedBy` / `lastUpdatedAt` / `lastAction`）。 |
        | `metadata` | object | `createdAt` / `updatedAt` / `createdBy` / `updatedBy` / 備考。 |
        | `reserved` | object | 将来用の `parentOrganizationId` / `groupCodes` 等。 |
      - サンプル
      ```json
      {
        "id": "clinic:3f7c9b90-3b77-4b9f-9e42-6c0e88dba4d5",
        "schemaVersion": 2,
        "basic": {
          "name": "なかのクリニック",
          "nameKana": "ナカノクリニック",
          "postalCode": "1640001",
          "address": "東京都中野区中野1-1-1",
          "phone": "03-0000-0000",
          "fax": "03-0000-0001",
          "website": "https://example-clinic.jp",
          "openingHours": [
            {"day": "mon", "am": "09:00-12:00", "pm": "14:00-17:30"}
          ]
        },
        "location": {
          "lat": 35.706,
          "lng": 139.665,
          "geocodeStatus": "ok",
          "geocodeSource": "google",
          "rawAddress": "東京都中野区中野1-1-1"
        },
        "clinicType": "clinic",
        "facilityAttributes": {
          "bedCount": 0,
          "departments": ["内科", "小児科"],
          "homeCare": true,
          "emergencyLevel": "none"
        },
        "services": [
          {"masterId": "service:diabetes", "notes": "糖尿病専門外来"}
        ],
        "tests": [],
        "qualifications": [],
        "managerAccounts": ["account:1b2c3d"],
        "staffMemberships": ["membership:89ab"],
        "status": "active",
        "searchFacets": [
          "department:内科",
          "service:糖尿病専門外来",
          "homeCare:true"
        ],
        "auditTrail": {
          "lastUpdatedBy": "account:1b2c3d",
          "lastUpdatedAt": "2025-10-15T09:00:00Z",
          "lastAction": "CLINIC_UPDATE"
        },
        "metadata": {
          "createdAt": "2025-01-10T05:00:00Z",
          "createdBy": "account:sysadmin",
          "updatedAt": "2025-10-15T09:00:00Z",
          "updatedBy": "account:1b2c3d",
          "notes": "在宅診療エリア拡張予定"
        },
        "reserved": {
          "parentOrganizationId": null,
          "groupCodes": []
        }
      }
      ```
    - `account` エンティティ  
      - キー: `account:<uuid>`。  
      - フィールド: `primaryEmail`（必須）、`loginId`（施設向けID重複防止用）、`role`（`systemAdmin` / `clinicAdmin` / `clinicStaff`）、`passwordHash`、`passwordVersion`（ハッシュアルゴリズム管理）、`status`（active/locked/invited）、`profile`（氏名・氏名カナ・生年月日・職種）、`mfa` 設定、`createdAt/updatedAt`。  
      - システム管理者のみが複数施設を跨るロールを直接付与できる。施設管理者は自施設限定でスタッフを作成。スタッフは `clinicStaff` ロール固定。
      - サンプル
      ```json
      {
        "id": "account:1b2c3d",
        "role": "clinicAdmin",
        "primaryEmail": "manager@example-clinic.jp",
        "loginId": "nakano-admin",
        "passwordHash": "$argon2id$v=19$m=4096,t=3,p=1$...",
        "passwordVersion": "argon2id_v19",
        "status": "active",
        "profile": {
          "displayName": "中野 太郎",
          "displayNameKana": "ナカノ タロウ",
          "birthDate": "1980-04-12",
          "profession": "hospitalAdministrator",
          "phone": "03-0000-0000"
        },
        "mfa": {
          "methods": ["totp"],
          "totpEnrolled": true
        },
        "membershipIds": ["membership:89ab"],
        "createdAt": "2025-02-01T00:00:00Z",
        "updatedAt": "2025-07-05T12:30:00Z"
      }
      ```
    - `staffMembership`（施設との紐付け中間テーブル）  
      - キー: `membership:<uuid>`。  
      - フィールド: `clinicId`, `accountId`, `roles`（`["editor"]` など）、`invitedBy`, `invitedAt`, `joinedAt`, `initialPasswordSet`（bool）、`employmentStatus`（active/onLeave/retired）、`metadata`（所属部署、肩書）。  
      - 複数施設所属を許容し、施設側の削除で membership を退職扱いに更新。SkilBank 連携時に `skillProfileId` を紐付け予定。
      - サンプル
      ```json
      {
        "id": "membership:89ab",
        "clinicId": "clinic:3f7c9b90-3b77-4b9f-9e42-6c0e88dba4d5",
        "accountId": "account:1b2c3d",
        "roles": ["clinicAdmin"],
        "invitedBy": "account:sysadmin",
        "invitedAt": "2025-02-01T00:00:00Z",
        "joinedAt": "2025-02-02T03:00:00Z",
        "initialPasswordSet": true,
        "employmentStatus": "active",
        "metadata": {
          "department": "事務",
          "title": "事務長"
        }
      }
      ```
    - `auditLog`（監査ログ）  
      - 最小構成として KV または R2 に `audit:<date>:<uuid>` 形式で保存。  
      - 主要フィールド: `actorAccountId`, `actorRole`, `clinicId`, `actionType`（`CLINIC_UPDATE`/`STAFF_CREATE` 等）、`diff`（変更内容サマリ）、`ipAddress`, `userAgent`, `timestamp`.  
      - 将来的にBI/分析用にエクスポートできるよう JSON Lines を想定。
    - 役割と権限  
      - `systemAdmin`: 全施設・アカウント・マスター・監査ログの閲覧/編集。  
      - `clinicAdmin`: 自施設の `clinic`／`staffMembership`／`skill` 関連APIのフルアクセス、招待リンク/初期PW設定、監査ログの自施設分閲覧。  
      - `clinicStaff`: 自施設データの編集可否はロールタグで制御（例: `["profileEditor","skillEditor"]`）。初期実装では `clinicStaff` は閲覧＋一部項目編集まで。  
      - 認証トークン: JWT で `sub`=accountId、`role`、`membershipIds` を埋め込み、Workers のミドルウェアで検証。`X-Clinic-Context` ヘッダーで操作対象施設を指定し、権限検査時に membership を確認。
    - スキーマ移行手順  
      - スクリプトで既存 `clinic` レコードを走査し、v1→v2 変換（`schemaVersion` 更新、`managerAccounts` 初期化、住所正規化等）。  
      - マスターや検索キャッシュが未設定の場合はデフォルト値を補完。変換前後の JSON を R2 にバックアップ。  
      - マイグレーション後に整合性チェック API (`GET /api/admin/validateClinics`) を実装し、欠損や重複を検出。
    - スキーマ移行計画  
      - スクリプト構成:  
        1. `scripts/exportClinicsV1.mjs` で既存データをR2へバックアップ（JSON Lines形式）。  
        2. `scripts/migrateClinicsToV2.mjs` でフィールド補完・正規化を実行し、Dry Runモード（`--dry-run`）で差分レポートを出力。  
        3. 成功後に `scripts/verifyClinicsV2.mjs` で schemaVersion/必須フィールド/参照整合性を検証し、レポート（`--report`）を出力。  
      - バリデーション:  
        - `basic.name/nameKana` 未設定チェック、住所必須検証、緯度経度欠損時の警告。  
        - `managerAccounts` 空の場合は `pending` ステータスを自動付与。  
        - `services/tests/qualifications` の `masterId` がマスタに存在するかクロスチェック。  
      - ロールバック:  
        - 変換前バックアップから `scripts/restoreClinicsFromBackup.mjs` を用意し、`schemaVersion` を1へ戻すオプションを実装。  
        - Cloudflare KV では一括復旧が難しいため、Backup→Purge→復元の順序をドキュメント化し、処理中はWorkersをメンテナンスモードに切り替える。  
      - 運用手順:  
        - ステージング環境で移行 → `verify` → E2Eテスト → 本番で同手順を実行。  
        - 実行ログはすべて R2 `logs/migration/<timestamp>.log` に保存し、異常時に即座に復旧できるよう手順書（Runbook）を用意。
    - 認証/認可ミドルウェア実装チェックリスト  
      - 新規: `/api/auth/registerFacilityAdmin`, `/api/auth/login`, `/api/auth/logout`, `/api/auth/refresh`。  
      - JWT発行ロジック: role / membershipIds / expiry を署名し、Workers KV にセッションブラックリストを管理。  
      - `requireRole` ヘルパー: ハンドラー単位で `requireRole(["systemAdmin"])` のように宣言できるデコレータ型関数を実装。  
      - `resolveClinicContext` ミドルウェア: `X-Clinic-Context` ヘッダーまたはURLパラメータを解析し、対象施設の membership 権限を検証。  
      - エラーハンドリング: 未認証（401）・権限不足（403）・施設不一致（409）を明示。  
      - 監査ログ: 認証イベント（ログイン成功/失敗、パスワード変更）を `auditLog` に保存。  
      - テスト: ロール別アクセス、セッション失効、初期パスワード更新、CSRF/リプレイ対策の単体テストとE2Eテストを準備。
    - 認証・権限タスクチケット（優先順）  
      1. **AUTH-01** 高: JWT発行・検証モジュール作成（HS/RS鍵管理、失効リスト、`requireRole` ヘルパー実装）。  
      2. **AUTH-02** 高: `/api/auth/login` `/api/auth/logout` `/api/auth/refresh` エンドポイント実装とテスト。（2025-10-16 実装済み）  
      3. **AUTH-03** 高: `/api/auth/registerFacilityAdmin`（新規施設登録後の管理者招待API）・`/api/auth/inviteStaff`・`/api/auth/acceptInvite`・`/api/auth/requestPasswordReset`・`/api/auth/resetPassword`。ステータス: API 実装済み（メール送信は `lib/mail` 経由、UI接続は今後対応）。  
      4. **AUTH-04** 中: `resolveClinicContext` ミドルウェア + 施設対象APIへの適用。  
      5. **AUTH-05** 中: 監査ログ書き込みユーティリティとログビューアAPI。  
      6. **AUTH-06** 中: E2Eテスト（システム管理者/施設管理者/スタッフ）と権限逸脱時の検証。  
      7. **AUTH-07** 低: MFA/TOTP登録UIとバックエンド（余裕があればフェーズA後半で対応）。  
    - 施設管理者/スタッフ招待フロー  
      - 診療所一覧：管理者列を追加し、`未設定` / `招待中` / `〇〇さん`（複数表示可）で状態を明示。システム管理者はここから招待モーダルを開き、メールアドレスを入力すると有効期限付きの招待リンクを送信。  
      - 施設ホーム：カードをモード切替。管理者未設定時は「管理者アカウントを設定」カードとして招待を発行。管理者が設定済みになれば「スタッフアカウントを招待」カードに切り替え、施設管理者が自施設スタッフを招待できる。  
      - 招待メール：ワンタイムURL（初回のみ使用可、24時間程度で失効）を送付。受信者はリンク経由で氏名・パスワード設定・利用規約同意を完了するとアカウントが有効化される。  
      - パスワードリセット：ログイン画面から「パスワードを忘れた」→メールアドレス入力→ワンタイムリンク発行→新パスワード設定。トークンは短期有効（30分～1時間）、使用後即失効。  
      - 監査ログ：招待発行・初回ログイン・パスワードリセットなどのイベントを `auditLog` へ記録し、必要に応じてシステム管理者へ通知。  
      - 今後の拡張：MFA（TOTP/SMS）、複数管理者の権限分担（主担当/副担当）やスタッフロール細分化を見越し、UIとデータ構造を汎用的に設計する。
    - 実装タスク分解（管理者/スタッフ招待 + パスワードリセット）  
      - **API**: 招待発行(`/api/auth/registerFacilityAdmin`, `/api/auth/inviteStaff`)、招待受諾(`/api/auth/acceptInvite`)、パスワード再設定(`/api/auth/requestPasswordReset`, `/api/auth/resetPassword`)、現状確認(`/api/auth/me`) を実装。  
      - **データ/KV**: `invite:<uuid>` にメール・施設ID・ロール・期限を保存、トークンは `AUTH_SESSIONS` や専用KVで管理。既存施設データには管理者ステータス表示用フィールドを追加。  
      - **フロント**: 診療所一覧に管理者列と招待ボタン、施設ホームで管理者未設定時は「管理者設定」モード、設定後は「スタッフ招待」モードを表示。招待受諾/パスワード再設定ページを用意。  
    - **メール/通知**: 招待・再設定メールテンプレート、期限切れ時の再招待、送信失敗アラートを整備。  
    - **テスト/移行**: 既存施設に仮管理者を投入するスクリプト、API単体テストとE2E（招待→承認→ログイン→スタッフ招待）、トークン失効のセキュリティ検証。
    - メール配送方針  
      - 配信手段: Cloudflare Workers から直接 SMTP を叩く場合は SendGrid などの API 経由が現実的。代替案として自前サーバーに Webhook を送り、そこからメール送信する構成も検討。  
      - テンプレート: 招待メール（管理者用/スタッフ用）、招待再送メール、パスワードリセット、失効通知を HTML + プレーンテキストのマルチパートで用意。URL には https 強制＋トラッキング無効化。  
      - 差出人/送信元: 共通の `no-reply@ncd.local`（仮）を想定。Reply-To をシステム管理者メールに設定し、ユーザーが直接問い合わせできるようにする。  
      - ログとリトライ: 送信結果を KV へ保存（成功/失敗、送信ID、宛先）。失敗時はリトライキューに入れ、一定回数失敗したらシステム管理者へアラート。  
      - セキュリティ: 招待/リセット用リンクは 1 回のみ使用可・短期有効。URL にはトークンのみ含め、個人情報を載せない。  
    - UI 接続案  
      - 診療所一覧: 管理者列に「未設定」「招待中（再送）」ボタンを配置。クリックで招待モーダルを開き、招待成功後にトースト表示。  
      - 施設ホーム: 管理者未設定モードではガイド文を表示し、招待が存在するときはステータスと再送/取消リンクを出す。  
      - 招待受諾画面: Token 付き URL にアクセスすると、施設名・担当者名を表示→パスワード設定フォーム→完了後にダッシュボードへリダイレクト。  
      - 失効時のUX: 期限切れ表示を出し、「再招待を依頼」ボタンからシステム管理者宛に通知（メール or API）を送る導線を検討。
      - フロント実装メモ:  
        - `web/admin/clinicList.html` に管理者列とモーダルを追加。API疎通は Fetch で `/api/auth/registerFacilityAdmin` を呼び、結果に応じてリストを再読込。  
        - `web/clinicHome.html` のカードを状態で切替（管理者未設定時: 招待フォーム／設定済み時: スタッフ招待フォーム）。招待一覧は `pendingInvites` を表示し、再送・取消ボタンを配置。  
        - `web/auth/accept-invite.html`（新規ページ）を作成し、トークン入力画面 → フォーム送信で `/api/auth/acceptInvite`。成功時は `localStorage` にトークン保存＆ダッシュボードへ遷移。  
        - `web/auth/reset-password.html`（新規）でパスワードリセットを実施。`requestPasswordReset` / `resetPassword` の結果をハンドリングし、完了時に案内を表示。  
        - 共通JSモジュールにトースト通知・エラーハンドリングの共通化を加え、認証失敗時はログインページへ誘導。  
        - メールリンクでアクセスした際、トークンをURLから取り出し、存在しない・失効済みならエラーメッセージ＋再依頼導線を表示。
      - API連携メモ:  
        - 管理者招待/スタッフ招待は Bearer トークン必須。システム管理者は `/api/auth/registerFacilityAdmin`、施設管理者は `/api/auth/inviteStaff` を使用。レスポンスの `mailStatus` をチェックして再送エラーを表示。  
        - 招待受諾後に返却される access/refresh トークンは既存ログイン処理と同様に保存（`localStorage` or `sessionStorage`）。  
        - パスワード再設定はメール入力後に常に成功レスポンスを返すため、UI では「送信しました」と表示し続ける。トークンが無効/期限切れの場合は API のエラーコードに応じてメッセージを切替。  
        - API通信は共通 `fetchJSON` ラッパーで行い、401/403 時はログイン画面へ、429/500 はトースト通知や再試行案内を出す。  
        - ログイン後の状態は `me` エンドポイント（将来追加予定）で再同期できるよう、クライアント側にフックポイントを用意しておく。
    - パスワードリセット設計  
      - フロー: `requestPasswordReset` でメールアドレスを受け付け → 有効なアカウントならリセットトークンを生成しメール送信（宛先が存在しなくても「送信した」と返す） → トークン付きリンクから `resetPassword` で新パスワードを設定。  
      - トークン処理: `resetToken:<hash>` キーに招待と同様のハッシュを保存、30分程度で失効、1回使用で即削除。  
      - UI: ログイン画面に「パスワードを忘れた」リンク → メール送信完了ページ → リンク先では新パスワード入力＋確認欄。成功後はログイン画面 or 自動ログインに遷移。  
      - セキュリティ: パスワードは8文字以上＋英数混在など基本ポリシーをガイド。トークンは 6 桁コード併用も検討。短時間に連続利用された場合はレート制限を導入。  
      - 通知: リセットが実行された場合、登録メール宛に「パスワードが更新されました」通知を送付。未実施なら警告に利用できる。  
      - 監査ログ: リセットリクエスト、成功/失敗を `auditLog` に記録し、不審な連続試行のモニタリングに活用。
    - 実装タスク（メール連携・パスワードリセット）  
      - メール送信モジュール: `lib/mail` を作成し、プロバイダAPIクライアント（SendGrid想定）とダミー送信（開発用ロガー）を切り替え可能にする。Secrets へ API キーを追加、`.env` に説明を記載し `wrangler.toml` は触らない。  
      - 招待メール統合: `/api/auth/registerFacilityAdmin` / `/api/auth/inviteStaff` でトークンを発行後、メールテンプレートへ差し込み、失敗時はログに残してシステム管理者へ通知。再送API／失効APIも検討。  
      - パスワードリセットAPI: `/api/auth/requestPasswordReset`, `/api/auth/resetPassword` を実装し、トークン保管・失効処理・通知メール送信を組み込む。成功後は既存セッションを無効化。  
      - UI改修: ログイン画面の「パスワードを忘れた」導線、招待受諾フォーム、診療所一覧／施設ホームでの状態表示と再送ボタンを開発。  
      - テスト: メール送信をスタブ化したユニットテスト、リセット・招待エンドポイントの統合テスト、E2Eで招待→受諾→ログイン→リセットを検証。  
      - 運用: メール送信失敗時のリトライ戦略とダッシュボード通知、監査ログの項目拡張、送信統計（成功/失敗件数）を簡易閲覧できるようにする。
    - JWT モジュール仕様（AUTH-01）  
      - 署名方式: HS256 を初期実装とし、Secret は Cloudflare KV Secret `JWT_SECRET` から取得（Workers 環境変数）。将来的な RS256 切替に備え、アルゴリズム指定を設定ファイルで切替可能にする。  
      - トークン形式:  
        - `sub`: `account:<uuid>`  
        - `role`: `systemAdmin` / `clinicAdmin` / `clinicStaff`  
        - `membershipIds`: 所属中 `membership:<uuid>` 配列  
        - `sessionId`: 失効リスト用の UUID  
        - `iat` / `exp`: 発行時間と有効期限（アクセス 15分、リフレッシュ 7日を基本）  
      - ライブラリ構成: `functions/lib/auth/jwt.js` に `createToken(payload, options)` / `verifyToken(token, { allowExpired, type })` / `invalidateSession(sessionId)` / `isSessionRevoked(sessionId)` を実装。  
      - 失効管理: KV Namespace `AUTH_SESSIONS` を使用し、`session:<uuid>` をキーに `{"status":"revoked","revokedAt":...}` を保存。TTL はトークン期限+1日。ログアウト時・パスワードリセット時に登録。  
      - エラーハンドリング: 検証失敗時は `AppError('AUTH_INVALID_TOKEN', 401)` を投げ、Cloudflare Worker 全体で捕捉。  
      - ログ: 失敗トークンは `console.warn` に `sessionId`/`accountId` を最小限出力。監査ログ統合時に `auditLog` へ委譲。  
      - テスト方針: Mini Vitest で `createToken` / `verifyToken` の往復、失効後の拒否、タイムスキュー許容（±60秒）を検証。
- **フェーズB: 医療者データベース / SkilBank（②）**  
  - 目的: 医療従事者の個人情報・スキル・経歴を登録し、複数施設所属や履歴書生成が可能な SkilBank を構築。  
  - 機能範囲: 医療者アカウント登録・所属管理、職種マスター整備、スキル・資格・学歴・業績入力UI、履歴書/デジタルポートフォリオ生成、施設管理者によるスタッフ招待・初期パスワード設定。  
  - データ/インフラ: 医療者テーブルと施設・医療者の中間エンティティを追加。Cloudflare Workers 上で API を拡張しつつ、将来的なRDB移行を見据えた抽象化レイヤーを用意。個人情報保護対策（アクセス制御・暗号化方針）を策定。  
  - 検証/出口: 施設管理者がスタッフを登録→SkilBankに誘導→本人がプロフィールを更新→履歴書を出力できる一連の導線が成立。複数施設所属時の表示整合性とアクセス権限が確認できる。
- **フェーズC: コラボレーション機能（③）**  
  - 目的: 施設内外で利用できるチャット・議題管理・ファイル共有を提供し、医療者同士の協働を支援。  
  - 機能範囲: グループ作成（施設内/外）、議題登録と紐づくチャットタイムライン、ファイルアップロードとグループ別ストレージ、議事録の自動整理、参照ドキュメント設定、通知機能。  
  - データ/インフラ: Durable Objects や独立したリアルタイムサーバーを導入検討。ファイル保存は Cloudflare R2 などオブジェクトストレージを利用し、アクセス制御は共通認証と連携。ログ監査・メッセージ保持期間ポリシーを定義。  
  - 検証/出口: パイロットグループでの運用を通じて、1) メッセージやファイルの遅延が許容範囲、2) 権限逸脱がない、3) 議事録と参照資料が継続利用可能、を確認。SLA/障害時対応を決めてベータ公開。
- **フェーズD: 医療施設検索・紹介サイト（④）**  
  - 目的: 病院⇔診療所⇔患者の三者が施設・医療者を検索し、予約や紹介状作成まで完結できる公開サイトを構築。  
  - 機能範囲: パブリック検索UI、条件フィルタ（診療科・設備・医療者スキル等）、施設・医療者の詳細ページ、オンライン予約/仮予約、紹介状テンプレート生成・送信、アクセス解析。  
  - データ/インフラ: 検索性能向上のため Algolia / Meilisearch / D1 などの検索基盤を導入。公開APIを別ワークロードとして切り出し、施設/医療者データと非公開フィールドを適切に分離。予約・紹介状はトランザクション管理を考慮し、必要に応じて専用バックエンドを追加。  
  - 検証/出口: 想定利用者（病院紹介担当・診療所事務・患者）が主要シナリオを完了できることをUXテストで確認。SEO・パフォーマンス指標を満たし、公開後の運用体制（サポート/監視）を確立。
- **共通施策**: 認証・アカウント管理、監査ログ、権限モデル、通知/チャットID管理、CI/CD、インフラ監視はフェーズ横断で統一ポリシーを整備。各フェーズ開始時にスキーマ互換性と移行スクリプトを用意する。

---

本ドキュメントは初期たたき台。詳細設計に合わせて随時アップデートする。

---

## 10. 将来ビジョン・ブランド・ドメイン戦略の再整理

### 10.1 医療施設データベース（NCDコア）の拡張
- **対象拡大**: 現在は中野区医師会所属診療所が対象だが、病院や他医師会（多地域）へ横展開できるよう多テナント構成を前提にデータモデルを整備する。  
- **マルチテナント方針**: `organizationId` を施設・医療者レコードに追加し、医師会単位で分離。自治体や医師会ごとのポリシー差異を `organizationSettings` で吸収。  
- **インフラ分離案**:  
  - API: Cloudflare Workers（`ncd-app`）をコアAPIとして維持。地域拡大に合わせてKV/Workers Namespaceを組織単位で分けるか、D1/R2へ段階的に移行。  
  - 管理UI: `admin.ncd-app.jp` のような統合管理画面を `systemRoot` のみアクセス可にし、医師会向けポータルをサブドメインで用意。  
  - 公開サイト: 施設検索は将来Medical Orchestraと統合するため、REST/GraphQL APIのスキーマを公開用に分離する。

### 10.2 医療者データベース「SkilBank」構想
- **サービス名とドメイン**: `skill-bank.jp` をメインドメインとして確保済み。ブランド名称は「SkilBank」。  
- **アカウント階層**: 最高権限 `systemRoot`（和久井さん）・通常 `systemAdmin`・`facilityAdmin`・`staff` を中心に、将来的に「教育機関」「派遣会社」など追加ロールを想定。  
- **データ項目（初期想定）**  
  - 基本情報: 氏名・氏名カナ・生年月日・職種カテゴリ（医師/看護師/薬剤師/理学療法士/栄養士/検査技師/医療事務/看護助手/クラーク/ドクターアシスタント…）。  
  - アカウント: メールアドレス（ログインID）、パスワード、MFA設定。  
  - 所属: 複数施設を登録可能、施設ごとに役職／雇用形態／在籍期間を保持。  
  - 履歴書要素: 学歴・職歴・資格・学会・研究業績・研修・語学・自己PRなどをカテゴリごとに保存。  
  - プライバシー: 項目単位で「公開／限定公開（フレンド・所属施設）／非公開」を切り替えられるメタデータを保持。  
  - フレンド機能: 他施設医療者と「お友達」関係を結び、公開レベルに応じてチャット・履歴書共有が可能。  
  - 住所等の秘匿情報は暗号化した状態で保存し、履歴書出力時のみ一時復号する。  
- **公開/非公開コントロール**:  
  - `visibility` フラグ（`public` / `organization` / `facility` / `friends` / `private`）と、履歴書出力用に許諾トークンを発行する仕組みを追加。  
  - APIレイヤーでは `viewerContext` を評価し、許諾済みか判定する。

### 10.3 コラボレーション基盤「Medical Orchestra」
- **サービス名とドメイン**: `medicalorchestra.com` を使用。チャット・紹介・公開検索を包括するブランド。  
- **範囲**: 将来展望③（チャット）と④（医療施設検索サイト）を統合し、医療者・施設・患者が「オーケストラを組むように連携する」世界観を提供。  
- **機能イメージ**:  
  - 医療者⇔医療者、医療者⇔患者のリアルタイムチャット（友人関係・紹介相談）。  
  - 病院→診療所、診療所→診療所、診療所→病院の紹介導線と、患者→診療所の予約相談チャネル。  
  - SkilBankから連携したスキルタグ・公開範囲を前提に、紹介時に情報閲覧の権限確認を行う。  
  - 公開検索は誰でも利用できるが、施設管理者ログイン時はチャットで紹介依頼や患者情報共有（許諾付き）が可能。  
- **技術的検討**:  
  - リアルタイム処理のため、Cloudflare Durable Objects や専用WebSocketサーバー（Workers + WebSocket, または別サービス）を検討。  
  - メッセージや添付ファイルは R2 へ保存し、`medicalorchestra.com` 配下のAPIでアクセス制御。  
  - 検索は Algolia/Meilisearch など外部検索基盤を活用し、SkilBank/NCDのデータを定期同期する。

### 10.4 転職支援「MedicalDraft」（公開準備は最終フェーズ）
- **サービス名とドメイン**: `medicaldraft.jp` を利用（2026/10/15 まで取得済）。  
- **公開タイミング**: SkilBankとMedical Orchestraが十分なユーザー基盤を獲得した後にクローズドで始動し、利用者数が閾値を超えるまでは非公開（管理画面上も無効化）とする。  
- **機能構想**:  
  - 施設管理者が条件（性別・年齢帯・居住地域・スキルタグなど）で医療者を匿名検索し、自施設のオファー（給与/契約金など）を提示。  
  - 医療者側はチャットでオファーを受け取り、納得すれば「転職用ステータスのお友達」へ昇格。公開レベルは本人が調整可能。  
  - オファーが進むとオンライン面談（ビデオ会議）・契約書作成・締結・運営による監視まで一連のフローを提供。  
  - 契約管理・報酬徴収はアルトライテクノロジーズが担い、B2B/B2C課金モデルへ発展させる。  
- **情報保護**: 個人特定につながらない表示（匿名ID、年齢帯、地域のみ）を徹底し、詳細情報は本人承認後に段階的解放。  
- **運用前提**: 監査ログ・契約進捗・支払状況を管理するバックオフィスUIを別途実装し、法務・労務対応の体制を整える。

### 10.5 その他保有ドメインの活用案
| ドメイン | 役割案 | 備考 |
|----------|--------|------|
| `medicaldraft.jp` | MedicalDraft 本番 | 転職支援サイト。正式公開まではワークスペース内で非公開運用。 |
| `medicalorchestra.com` | Medical Orchestra 本番 | チャット・紹介・公開検索ポータル。 |
| `skill-bank.jp` | SkilBank 本番 | 医療者データベース／プロフィール管理。 |
| `medicalyoutube.com` | メディア/学習コンテンツ配信用 | 医療者向け動画ライブラリやプロモーションに活用予定。 |
| `undistance.jp` | 将来のサブブランド/社内ツール用 | 遠隔医療・オンライン研修など別ブランド展開の候補。 |

### 10.6 サーバーおよびシステム分離方針（案）
- **アイデンティティ統合**: `auth.skill-bank.jp` のような中央認証（IdP）を用意し、SkilBank/Medical Orchestra/MedicalDraft/NCDコアが共通トークンを利用。Workers上に共通Authサービスを配置し、サービスごとにAudienceを分ける。  
- **サービスごとのデプロイ単位**:  
  1. **NCD Core API**（Workers `ncd-app`）: 施設データ、マスター管理、既存UI。  
  2. **SkilBank API**（Workers `skilbank-api` など新規プロジェクト）: 医療者プロフィール・履歴書生成。  
  3. **Medical Orchestra**: チャット/紹介向けリアルタイムサービス（Workers DO or 専用Nodeプロセス）＋公開Web。  
  4. **MedicalDraft**: オファー管理・契約フロー用バックエンド（Workers + D1/PostgreSQLなどトランザクション重視データベース）。  
  5. **共通アセット/CDN**: 静的サイトやマーケティングページはCloudflare Pagesでホストし、ブランドごとにカスタムドメインを割り当て。  
- **データ分離**: 個人情報を扱うSkilBank/MedicalDraftは暗号化された専用Storage（D1 or External DB）に格納し、NCDコアとはAPI経由で連携。アクセス権限はサービス境界で検証し、必要に応じてプライバシー保護のための集約API（PIIマスキング）を用意。  
- **ネットワーク・セキュリティ**: Cloudflare Zero Trust を活用し、管理ポータルは和久井さん含む `systemRoot` のMFA必須。将来的にVPCやSupabase/Neonなど外部DBを利用する場合も、サービス毎にFirewall/Tokenを設定。  
- **監視/ロギング**: 共通監視基盤（Grafana Cloud 等）に集約し、サービス毎にアラートポリシーを設定。リアルタイムサービスはSLOを別途管理。

### 10.7 今後の整理タスク
1. `docs/roadmap.md` 内の各フェーズと、SkilBank/Medical Orchestra/MedicalDraft のロードマップ整合を定期的に見直す。  
2. 役割・権限表に `systemRoot` を追加し、管理画面アクセスの切替タイミングを明記。  
3. ドメイン割当・SSL・DNS設定の棚卸しを行い、リリース順にフェーズ分けしたチェックリストを作成。  
4. Private β 以前に必要となる法的手当（個人情報保護、利用規約、契約書テンプレート）を整理し、MedicalDraft開始時のToDoに追記。  
5. 医師会拡大前に多テナント検証環境を整備し、団体ごとの運用ルールを設定できる管理UIを設計。

---

本章で定義したブランド／ドメイン戦略・サーバー構成案は、今後の要件変更に応じて更新する。必要に応じて各サービスごとの詳細設計書・運用Runbookを別ドキュメントとして切り出す予定。
