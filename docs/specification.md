# 機能仕様書（NCD-App）

NCD-App は診療所のマスタ管理と運用補助を行う Web アプリケーションである。フロントエンドは静的ページ（`web/` 配下）、バックエンドは Cloudflare Workers（`functions/index.js`）が担当する。本書では主要画面と機能の挙動、入出力、API 呼び出しを整理する。

---

## 1. 一般ユーザー向けフロー

### 1.1 トップページ `index.html`
- **目的**: 入口ページ。登録／一覧／検索／管理の導線をまとめる。
- **主な要素**
  - 新規登録 `register.html`
  - 施設を選ぶ（旧 UI）`list.html`
  - テスト：地図から検索 `searchMap.html`
  - テスト：症状で検索 `searchSymptom.html`
  - 管理ダッシュボード `admin/admin.html`
- **API**: 直接の API 呼び出しはなし。リンク遷移のみ。

### 1.2 新規登録 `register.html`
- **目的**: 診療所名だけで仮登録し、詳細入力画面へ誘導する。
- **UI**: 1 フィールド（診療所名）＋登録ボタン。
- **API**: `POST /api/registerClinic`
  - 成功時はレスポンスの `clinic` を `localStorage.selectedClinic` に保存し `clinicDetail.html` へ遷移。
  - 失敗時はメッセージ領域にエラー表示（重複など）。
- **備考**: 旧仕様に記載されていた住所や電話などの入力欄は現状存在しない。

### 1.3 施設一覧（旧 UI）`list.html`
- **目的**: 既存診療所をテーブル表示し、検索・選択できるようにする。
- **機能**:
  - `GET /api/listClinics` で一覧取得。
  - 施設名検索（入力イベントでフィルタ）。
  - 選択時は `localStorage.selectedClinic` に保存し `clinicHome.html` へ遷移。

### 1.4 施設カード一覧（新 UI）`clinicList.html`
- **目的**: モバイル想定のカードレイアウトで診療所を選択する。
- **機能**:
  - `wrapWithLoading` を用いたローディング表示。
  - `GET /api/listClinics` の結果を名称昇順で整列。
  - 選択後は `clinicHome.html` へ遷移。

### 1.5 施設ホーム `clinicHome.html`
- **目的**: 選択済み診療所の概要と詳細入力画面への導線をまとめる。
- **データ取得**: `GET /api/clinicDetail?id=...`
- **主なセクション**: 基本情報、診療形態タグ、所在地、資格・サービス・検査ページへのリンク。

---

## 2. 施設データ入力画面

### 2.1 基本情報 `clinicDetail.html`
- **目的**: 診療所の基本情報、診療形態、メディア（ロゴ／外観）を編集。
- **主要機能**
  - `GET /api/clinicDetail` で初期データ取得。
  - `POST /api/updateClinic` で保存。名称変更時は旧名称インデックスが自動削除される。
  - 診療形態マスター `GET /api/modes` を反映し、タグを追加・並べ替え。
  - メディアアップロード (`POST /api/media/upload-url` → R2 PUT → `POST /api/media/commit`)
  - 住所検索（ZipCloud API）と Google Maps 描画（`client-config` 経由で API Key 取得）。

### 2.2 資格・施設認定 `clinicQualifications.html`
- **目的**: 個人資格・施設認定を管理。
- **データ取得**
  - 医療分野マスター `GET /api/listCategories?type=qual`
  - 個人資格・施設認定マスター `GET /api/listMaster?type=qual|facility`
  - 診療所データ `GET /api/clinicDetail`
- **保存**: `POST /api/updateClinic`
- **特徴**: マスターから選択／手入力を切り替え。分類や備考のヒントを表示。リストは分類・名称で自動整列。

### 2.3 診療サービス `clinicServices.html`
- **目的**: 提供する診療サービスを管理。
- **データ取得**: `GET /api/listMaster?type=service`
- **保存**: `POST /api/updateClinic`
- **機能**
  - サービス名はマスター選択 or 手入力。
  - 説明テンプレートを読み込み、診療所固有説明として保存。
  - テンプレート一覧の部分読み込み、検索、複数選択に対応。

### 2.4 検査情報 `clinicTests.html`
- **目的**: 実施可能な検査を管理。
- **データ取得**: `GET /api/listMaster?type=test`
- **保存**: `POST /api/updateClinic`
- **特徴**: サービス画面と同等の UI コンポーネント（カテゴリ・テンプレート選択・説明編集）。

---

## 3. 検索・公開系画面

### 3.1 症状検索 `searchSymptom.html`
- **目的**: 症状マスターから症状を検索し、関連サービス・検査・診療所を表示。
- **データ**:
  - 症状マスター `GET /api/listMaster?type=symptom`
  - 体部位マスター `GET /api/listMaster?type=bodySite`（症状と紐付く）
  - その他サービス・検査マスターで補完。
- **機能**: キーワード／分類フィルタ、症状選択で詳細表示、紐付くサービス・検査・推奨診療科を表示。

### 3.2 地図検索 `searchMap.html`
- **目的**: Google Maps 上で診療所を表示。
- **データ取得**:
  - 診療所一覧 `GET /api/listClinics`
  - Google Maps API Key `GET /api/client-config`
  - 診療形態マスター `GET /api/modes`
- **機能**: ピン表示、診療形態バッジ、絞り込み（症状タグなどは次段階対応）。

### 3.3 概要ページ `clinicSummary.html`
- **目的**: 外部公開用の診療所サマリー（マップ含む）。
- **データ**: `GET /api/clinicDetail?id=<id>`
- **機能**: 基本情報、サービス・検査一覧、診療形態タグ、Google Maps 上での位置表示。

---

## 4. 管理者向け画面

### 4.1 管理ハブ `admin/admin.html`
- **目的**: 管理業務への入口。カード形式で各ページへ遷移。
- **カテゴリ**
  - 診療所リスト、標榜診療科マスター、診療形態マスター
  - 個人資格／医療分野、施設認定
  - 検査・診療マスター、運用 ToDo、設定 等

### 4.2 管理用診療所リスト `admin/clinicList.html`
- **機能**
  - `GET /api/listClinics`
  - 並び替え（更新日時・名称）
  - JSON/CSV エクスポートリンク
  - 選択（`localStorage.selectedClinic` に保存）／削除（`POST /api/deleteClinic`）
  - `wrapWithLoading` を使用したローディング表示

### 4.3 個人資格マスター `admin/personalQualifications.html`
- **目的**: マスター項目（医療分野＋資格）を編集。
- **バックエンド**
  - `GET /api/listMaster?type=qual`
  - `POST /api/addMasterItem` / `POST /api/updateMasterItem`
  - CSV インポート／エクスポート。
- **UI**: 共通 `initMasterPage` コンポーネントを使用（カテゴリフィルタ、ステータス変更、検索）。

### 4.4 施設認定マスター `admin/facilityAccreditations.html`
- **目的**: 施設認定の種類・名称・備考管理。
- **API**: `type=facility` のマスター系エンドポイント。
- **備考**: 選択肢追加はカテゴリマスター（種類）と連携。

### 4.5 分類マスター `categoriesAdmin.html`
- **目的**: マスターで利用する分類ラベル（検査／診療／資格／施設／標榜診療科）を編集。
- **API**
  - `GET /api/listCategories`
  - `POST /api/addCategory`
  - `POST /api/renameCategory`
  - `POST /api/deleteCategory`
- **特記事項**: 標榜診療科の場合はサブテーブルを表示し、個別科目を追加できる。

### 4.6 診療形態マスター `admin/clinicModes.html`
- **目的**: 夜間診療・オンライン診療などのタグを管理。
- **API**:
  - `GET /api/modes`
  - `POST /api/modes/add|update|delete`
- **UI**: 色選択、順序変更（▲/▼ボタン）、タグ候補の自動生成。

### 4.7 運用 ToDo `admin/todo.html`
- **目的**: チーム内タスクの共有。
- **API**:
  - `GET /api/todo/list`
  - `POST /api/todo/save`
- **UI**: カテゴリ別セクション、優先度（P1〜P3）、完了チェックボックス、追加入力欄。

### 4.8 設定画面 `admin/settings.html`
- **目的**: AI 設定（モデル・プロンプト）を編集。
- **API**:
  - `GET /api/settings`
  - `POST /api/settings`
- **ローディング**: `wrapWithLoading` で進捗表示。

---

## 5. 共通コンポーネント
- **API ベース解決**: すべての新規ページは `window.API_BASE_OVERRIDE` → `localStorage.ncdApiBase` → `DEFAULT_API_BASE` の順で API ベース URL を決定し、`window.NCD_API_BASE` にキャッシュする。
- **ローディングオーバーレイ**: `web/js/loading.js` の `LoadingManager` を利用。ページ全体またはパネル単位でのインジケーター表示が可能。
- **マスター共通 UI**: `web/js/masterPage.js` を用いて、資格／検査／診療などの CRUD・検索・CSV インポートを統一実装。
- **診療形態・症状マスター**: `web/js/clinicModes.js`, `web/js/admin/symptomMaster.js`, `web/js/admin/bodySiteMaster.js` が SPA に近い UI を提供。

---

## 6. データ保持
- **ローカルストレージ**
  - `selectedClinic`: 現在編集対象の診療所。
  - `ncdApiBase`, `ncdAssetBase`: API／アセットのカスタムベース URL。
  - その他、ページ固有の状態（例: 診療形態テンプレート選択）を保持。
- **KV（Cloudflare Workers）**
  - 施設データ: `clinic:id:{uuid}`, `clinic:name:{name}`, 旧互換 `clinic:{name}`。
  - マスター: `master:{type}:{category}|{name}`。
  - 分類: `category:{type}:{name}`。
  - ToDo: `todo:list`。
  - 設定: `model`, `prompt`, `prompt_exam`, `prompt_diagnosis` 等。
  - シソーラス: `thesaurus:{normalized}`。

---

## 7. 既知の課題・改善予定
1. **ユーザー認証**: 管理画面が公開状態のため、Auth0 などによる保護が必須。
2. **ドラフト保存**: 現状は即時保存のみ。編集中のドラフト領域追加を検討。
3. **バッチ投入**: マスターの CSV インポートはあるが、診療所データの一括投入機構が未実装。
4. **公開サイト連携**: 症状／地図検索はテスト UI。公開サイトとの統合設計が必要。
5. **アクセシビリティ**: 色コントラストやキーボード操作の QA が未実施。

---

## 8. 参考ファイル
- `web/js/loading.js`: ローディング UI 共通モジュール。
- `web/js/masterPage.js`: マスター管理ページの基盤クラス。
- `web/js/googleMapsLoader.js`: Google Maps API 読み込み＆キー解決。
- `web/js/searchSymptom.js`, `web/js/searchMap.js`: 公開検索 UI ロジック。
- `functions/index.js`: Workers すべてのルーティングとビジネスロジック。

---

本仕様書は 2025-10 時点の挙動を反映している。画面や API を更新した際は、本ファイルと `docs/api.md` をセットで改訂すること。
