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
   - `scripts/migrateSocietyNotes.mjs` で既存「備考」を学会名へ正規化し、学会マスタ候補を収集・投入する。
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

本ドキュメントは初期たたき台。詳細設計に合わせて随時アップデートする。
