# NCD-App 仕様サマリ（最新）

このドキュメントは、現在の本番構成・UI・APIの仕様サマリです。最新の運用で決まった事項を随時ここに反映します。

## アプリ概要
- 目的: 中野区診療所データベース（Nakano Clinic Database, NCD）を構築・更新するための入力・管理アプリ。
- フロントエンド: `web/` 以下の静的HTML + Tailwind CSS + Font Awesome。
- バックエンド: Cloudflare Workers（`functions/index.js`）+ KV `env.SETTINGS`。
- ホスティング: IIS サイト `NCD`（物理パス `C:\ncd-app\web`）。

## フロントエンド（主要画面）
- `index.html`: トップ。抽象的な青系グラデのヒーローにタイトル/CTAを配置。右上に「管理」リンク（`/admin/admin.html`）。
- `register.html`: 診療所の新規登録。登録後に `selectedClinic` を localStorage に保存し、詳細へ。
- `list.html`: 登録済み診療所の一覧と「選択」ボタン。選択で localStorage へ保存し `clinicHome.html` へ遷移。
- `clinicHome.html`: 選択中施設の概要表示と詳細/資格/検査/診療へのハブ。
- `clinicDetail.html`: 基本情報（名称・住所・医師数・診療時間）を入力し保存。
- `clinicQualifications.html` / `clinicServices.html` / `clinicTests.html`: 資格・診療・検査の入力/閲覧。承認済みマスター参照、簡易エクスポート、AI説明生成をサポート。
- `admin/admin.html`: タブ式の管理ダッシュボード（ヘッダーのTopリンクは `/index.html`）。
- `admin/todo.html`: 運用ToDoの閲覧/保存（Workersの `/api/todo/*` と連携）。

共通UI方針
- 全ページで青系グラデの共通ヘッダーを適用（Topリンクは絶対 `/index.html`）。
- トップのヒーロー背景は外部画像を使わず CSS グラデ + SVG パターンで安定表示。

## バックエンド/API（Cloudflare Workers）
一般
- CORS: `Access-Control-Allow-Origin: *`（GET/POST/OPTIONS）。
- ルーティング: `/api/...` と `/api/v1/...` を同一実装にマッピング。
- KV: 主に `env.SETTINGS` を利用。診療所データは新形式キー `clinic:id:{uuid}` + 互換キーを併用。

主要エンドポイント（抜粋）
- 診療所
  - `POST /api/registerClinic` 新規登録（旧形式からの移行補助あり）
  - `GET /api/listClinics` 一覧（旧→新の自動移行を内包）
  - `POST /api/updateClinic` 上書き保存
  - `GET /api/exportClinics?format=json|csv&limit&offset`
- マスター（検査/診療/資格）
  - `POST /api/addMasterItem`, `GET /api/listMaster`, `POST /api/updateMasterItem`, `GET /api/exportMaster`
- カテゴリ
  - `GET /api/listCategories`, `POST /api/addCategory`, `POST /api/renameCategory`, `POST /api/deleteCategory`
- AI関連
  - `GET/POST /api/settings`, `POST /api/generate`, `POST /api/reembedMaster`, `GET /api/aiDuplicates`
- ToDo（実装済み）
  - `GET /api/todo/list`, `POST /api/todo/save`（サーバー側で正規化してKV保存）

## サーバー/IIS 構成（本番）
- サイト: `NCD`（`C:\ncd-app\web`）。
- URL Rewrite（`web/web.config`）
  - HTTP→HTTPS リダイレクト。
  - `/api/v1/*`, `/api/*` を Cloudflare Workers へ Temporary リダイレクト（302）。
    - 事情によりPOSTのメソッド維持が必要になった場合は、ARRによるリバースプロキシ（Rewrite）方式に切替可。
  - `^github-webhook$` を `http://localhost:3000/github-webhook` へ Rewrite（PM2のNodeへ中継）。
- Webhook/自動反映
  - GitHub Push → IIS → Node(PM2) → `git pull` を実行。OUT/ERR ログで動作確認済み。
  - PM2 ログ: `C:\Users\Administrator\.pm2\logs\ncd-webhook-*.log`。

## 運用・ワークフロー
- 変更は GitHub `main` にプッシュ → Webhook により本番へ反映（静的ファイル更新）。
- 本番での `web.config` 変更は、時刻付きバックアップを作成しつつコミット（例: `web/web.config.bak-YYYYMMDD-HHMMSS`）。
- PM2 常駐: `ncd-webhook`（fork, online）。ログ監視で到達/エラーを確認可能。

## 既知事項/今後の改善候補
- Webhook セキュリティ強化: 送信元IP制限と `X-Hub-Signature-256` の検証を導入。
- ログ保守: PM2 logrotate を導入しログ肥大を防止。
- IIS アプリプール: `DefaultAppPool` から専用プールへ分離、最小権限化。
- `/api/*` 転送方式: 現状は302リダイレクト。クライアント互換やメソッド保持の観点で必要ならARR + Rewriteへ。

## 運用ルール
- 本ファイルは日本語で記述し、合意事項を確定版として反映する。
- 重要な設定変更・運用上の方針は本ファイルに追記していく。

