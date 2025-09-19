# NCD-App 仕様サマリ

## アプリ概要
- 中野区診療所データベース（Nakano Clinic Database, NCD）を構築するための入力・管理用アプリ。
- フロントエンドは `web/` 以下の静的HTML（Tailwind CSS使用）で構成され、Cloudflare Workers（`functions/index.js`）とKVストア `env.SETTINGS` をAPI経由で利用。
- 主な利用者は診療所の医師（情報入力）と管理担当者（全体管理・マスター整備）。

## フロントエンド（web/）
- `index.html`: アプリ入口。新規登録/施設一覧/管理ダッシュボードへの導線を提供。
- `register.html`: 診療所名の重複チェック付き登録。成功時にローカルストレージへ保存し詳細入力へ遷移。
- `list.html` / `clinicList.html`: Cloudflare APIから施設一覧を取得し、選択した施設をローカルストレージに格納。
- `clinicDetail.html`: 基本情報（住所・医師数）、診療時間パターン/曜日設定を入力し `/api/updateClinic` へ送信。
- `clinicHome.html`: 選択中施設の概要表示と詳細/資格/検査/診療入力へのハブ。
- `clinicQualifications.html` / `clinicServices.html` / `clinicTests.html`: 資格・診療・検査を分類別に登録し、承認済みマスターの選択やAI説明生成（`/api/generate`）をサポート。
- `admin/admin.html`: タブ式管理ダッシュボード。診療所一覧の管理、マスター（test/service/qual）の閲覧・ステータス更新、分類のCRUD、AI設定、エクスポート（JSON/CSV）を提供。
- `admin/todo.html`: 将来予定のToDo管理UI（`/api/todo/save` は未実装）。
- ブラウザ側では `localStorage` を活用し、選択中施設や入力補助情報を保持。

## バックエンド（functions/index.js）
- Cloudflare Workersで動作。全エンドポイントは `/api/` または `/api/v1/` プレフィックスを許容しCORSを全許可。
- データ保存はKV（`env.SETTINGS`）をキー設計に基づいて実施。旧形式キーから新形式（`clinic:id:{uuid}`）への移行ロジックを内包。

### 主要API
- **診療所**
  - `POST /api/registerClinic`: 重複チェック後に新規作成。旧データ存在時は移行して返却。
  - `GET /api/listClinics`: 必要に応じ旧形式を移行しつつ一覧を返却。
  - `POST /api/updateClinic`: 指定名称の診療所を上書き保存。
  - `GET /api/exportClinics`: JSON/CSVで出力（limit/offset対応）。
  - `POST /api/deleteClinic`（別実装）: id/name指定で関連キーを削除。
- **マスター（検査/診療/資格）**
  - `POST /api/addMasterItem`: `type(test|service)`、分類、名称等を集計。重複時はカウント・サンプル説明・出典を更新。
  - `GET /api/listMaster`: type・statusでフィルタして一覧取得。
  - `POST /api/updateMasterItem`: ステータスや代表名（canonical_name）を更新。
  - `GET /api/exportMaster`: JSON/CSVエクスポート。
- **分類管理**
  - `GET /api/listCategories`: `type`（test/service/qual）ごとに分類一覧を取得。未定義時はデフォルトセットを自動投入。
  - `POST /api/addCategory` / `renameCategory` / `deleteCategory`: 分類の追加・改名・削除。
- **AI関連**
  - `GET /api/settings` / `POST /api/settings`: モデル名・systemプロンプト・検査/診療用プロンプトをKVに保存。
  - `POST /api/generate`: OpenAI Chat Completions（`model`/`prompt` は保存値を利用）を呼び出しフロントへ返却。
  - `POST /api/reembedMaster`: 指定typeのマスターにEmbeddings（`text-embedding-3-small`）を再計算し付与。
  - `GET /api/aiDuplicates`: Embedding＋コサイン類似度で重複候補グループを抽出。
- **シードユーティリティ**
  - `POST /api/_seedQualifications`: 資格分類・主要資格マスターを初期投入（forceで上書き）。本番では削除推奨。

## データモデル
- **診療所**: `{ id, name, address, doctors: { fulltime, parttime, qualifications }, schedule: { patterns, days }, schema_version, created_at, updated_at }`。`clinic:name:{name}` と `clinic:id:{uuid}` の両インデックスを保持。
- **マスター項目**: `{ type, category, name, desc, sources[], count, status(cand/approved/archived), canonical_name, created_at, updated_at, embedding? }`。
- **分類**: `categories:{type}` に配列保存（test/service/qual）。
- **AI設定**: `model`, `prompt`, `prompt_exam`, `prompt_diagnosis` キーに格納。

## 外部連携
- OpenAI API
  - Chat Completions: 施設入力画面と管理画面から説明文生成。
  - Embeddings: マスター項目の重複検出向けベクトル化。
- Cloudflare Workers KV: 永続データストアとして全レコードを保存。

## 管理・運用メモ
- `wrangler.toml` を利用したWorkersデプロイ想定（KV Namespace: SETTINGS）。
- エクスポートAPIはJSON/CSVをダウンロードリンクで利用。
- 未実装API（例: `/api/todo/save`）はUI側のみ存在し、今後の拡張対象。

## 今後の拡張候補
- 外部DBやClaris/FileMakerとのデータ同期。
- 管理画面への認証追加とアクセス制御強化。
- 承認フローの操作ログ保存。
- AI生成結果の履歴管理・再利用。

## 運用ルール
- 本ファイルに記載された内容を常に遵守すること。
- このファイルは日本語で記述すること。
- ユーザーがこのチャットを通じて指示した事項を本ファイルに追記し、その内容を遵守すること。
