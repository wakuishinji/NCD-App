# NCD-App 仕様サマリ（最新）

このドキュメントは、現在の本番構成・UI・APIの仕様サマリです。最新の運用で決まった事項を随時ここに反映します。

## 2025-10-11 Codex 作業ログ
### 状況サマリ
- Git `main` は origin と一致しているが、`.dev.vars` など未追跡ファイルが残存。
- Google Maps API キーは再発行され、Cloudflare Workers の Secret に登録済み。旧 `.dev.vars` は削除済み。
- ローカル検証用サーバー（`simple_server.py` / `simple_test_server.py`）は修正済みで、`/admin/todo.html` まで自動で開けることを確認済み（2025-10-11）。
- `web/web.config` の API リダイレクトが 302 のままで、POST 時にメソッドが変わるリスクあり。
- `node_modules/` など生成物がコミット対象になっている形跡があり、今後の整理が望ましい。

### 直近 ToDo（優先順）
1. ✅ `.dev.vars` を秘匿化し、`.gitignore` に追加したうえで API キーのローテーションを促す（2025-10-11 対応済み）。
2. ✅ テスト用サーバースクリプトを修正（CORS ヘッダー順序、Todo API モック、`Content-Length` 未指定時のハンドリング）（2025-10-11 対応済み）。
3. ⏸ `web/web.config` のリダイレクト種別を 307 に変更するか、別途検討用メモを残す。
4. ⏸ `node_modules/` など生成物の扱い方針を整理し、必要であれば除外設定を検討。

## 将来展望（2025-10-11 更新）
- クリニック入力画面で収集するマスター候補を拡充し、選択主体で情報を登録できるようにする。整備したマスターは検索時のタグ・絞り込み条件として活用する。
- 検索導線は最終的に利用者別に分離（患者向け: 予約/検索、病院向け: 逆紹介・紹介状作成、診療所向け: 他院紹介）し、それぞれに専用ページを用意する。
- 医師プロフィールを閲覧・検索できるようにし、将来的には特定医師の予約まで可能にする。クリニック管理者/所属医師のアカウント管理を導入し、認証したユーザーのみが所属医師情報を編集できるようにする。
- クリニック管理者は所属医師を招待・登録し、医師ごとにアカウントと権限を付与する。医師は専門領域・検査・診療・資格・学会・論文など詳細プロフィールと個人用メモを保持し、入力内容から履歴書を自動生成する仕組みを整備する（公開情報と非公開メモを分離）。
- 既存の「クリニックの個人資格」は徐々に医師プロフィールから集約される読み取り専用ビューへ移行し、所属医師が公開した資格・学会情報をクリニック画面でも自動反映する方針。
- 学会マスターで分類×学会名・医療分野を一元管理し、個人資格マスター／クリニック入力／医師プロフィールで共通の候補リストを利用できるようにする。
- 住所保存時に緯度・経度を自動取得し、地図検索へ反映させる。
- Cloudflare Workers 側で学会マスター（`type=society`）対応を本番へデプロイし、学会名登録のAPIエラーを解消する。
- アカウント種別（システム管理者／施設管理者／スタッフ）ごとのロールに基づき、Slack 風チャット・議題管理・ファイル共有を備えたコラボレーション機能を実装し、グループ単位の議事録と参照ドキュメントを SkilBank と連携させる。
- 全体構想は次の4モジュールで構成する想定: ①医療施設データベース（現行開発中、将来的に病院も包含）、②医療者データベース（医師・看護師等のスキル/経歴管理と履歴書/ポートフォリオ生成、複数施設所属可）、③医療者向けチャット・オンライン会議（施設内/外チャットと議題・ファイル共有、委員会等のグループ運営）、④医療施設検索・紹介サイト（病院⇔診療所⇔患者の多方向検索・オンライン予約・紹介状作成）。現時点では①を中心に実装を進め、②以降は認証基盤とデータ構造を共有しながら段階的に拡張する。

### 作業メモ
- [x] 2025-10-12 Codex: クリニック保存時に Google Geocoding API で座標を自動取得し、地図検索にピン表示されるよう改善。重複登録チェックで既存施設に遷移。
- [x] 2025-10-12 Codex: 学会マスターに医療分野列を追加し、管理画面/スクリプト/Workers を更新して本番データへ反映。
- [x] 2025-10-11 Codex: 現状サマリと直近 ToDo を追記。
- [x] 2025-10-11 Codex: `.dev.vars` を削除し `.gitignore` に追加、キーのローテーションが必要である旨を把握。
- [x] 2025-10-11 Codex: `simple_server.py` / `simple_test_server.py` を更新し、CORS・Todo API・`Content-Length` 未指定時の動作を改善。
- [x] 2025-10-11 User: Google Maps API キーを再発行し Cloudflare Workers Secret へ登録（旧キーは無効化）。
- [x] 2025-10-11 Codex: `scripts/launch_test_env.command admin` を実行し、ポート9000での Todo 画面表示と API 応答を確認（favicon 404 のみ残存、その後プロセス停止済み）。
- [x] 2025-10-11 Codex: 個人資格入力の「備考」ラベルを「学会名」に改名し、将来の学会マスター整備方針を `agent.md` / `docs` に反映。
- [x] 2025-10-11 Codex: 個人資格の学会名入力をマスター候補プルダウン＋手入力併用に刷新し、`scripts/migrateSocietyNotes.mjs` で既存データを学会名へ正規化。
- [x] 2025-10-12 Codex: 学会マスター `admin/societyMaster.html` と個人資格マスターの学会プルダウンを実装、スクリプトを分類×学会名対応に拡張し Workers へデプロイ済み。

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
- `clinicQualifications.html` / `clinicServices.html` / `clinicTests.html`: 個人資格・施設認定／診療／検査の入力・閲覧。承認済みマスター参照、簡易エクスポート、AI説明生成をサポート。
- `admin/admin.html`: カード型の管理ハブ。診療所リスト／標榜診療科／個人資格／検査／診療／施設認定／運用補助の各カードから専用画面へ遷移。
- `admin/clinicList.html`: 管理者向けの診療所一覧（検索・並べ替え・エクスポート・削除）。
- `admin/personalQualifications.html`, `admin/testsMaster.html`, `admin/servicesMaster.html`, `admin/facilityAccreditations.html`: 各マスターの専用管理画面。分類フィルタ・CSV取込・ステータス変更・備考編集を共通UIで提供。
- `categoriesAdmin.html?type=department`: 標榜診療科の分類ラベルを共通UIで管理（追加・改名・削除）。
- `admin/settings.html`: AIモデル・プロンプト等の共通設定を編集。
- `admin/todo.html`: 運用ToDoの閲覧/保存（Workersの `/api/todo/*` と連携）。

個人資格・施設認定の入力仕様
- 個人資格は「分類（医師/看護/コメディカル/事務/その他）」「医療分野」「名称」「学会名（発行団体など）」で構成し、旧データは自動的に分類=医師・医療分野=旧分類・学会名=括弧書き/issuerに正規化。
- 医療分野マスターは既存の「資格分類」カテゴリを改名し、`/api/listCategories?type=qual` で提供。
- 施設認定は「種類（学会認定/行政・公費/地域・在宅）」「名称」「備考（指定元等）」で管理し、クリニックデータには `facilityAccreditations`（互換のため `facilityRecognitions` も併記）として保存。初期マスターには代表的な6件（医療機能評価機構認定、地域医療支援病院 など）を投入済み。

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
- マスター（個人資格/施設認定/検査/診療）
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

## ローカルテスト手順メモ
- 自動テスト: `npm install` → `npm test`（Vitest）。
- 手動テスト（管理画面向け）: `./scripts/launch_test_env.command admin` を実行し、ポート9000で `admin/todo.html` などを確認。終了時は `kill $(cat tmp/admin_server.pid)`。
- 手動テスト（簡易モード）: `./scripts/launch_test_env.command simple` を実行し、ポート7000で一般ユーザー向け画面を確認。終了時は `kill $(cat tmp/simple_server.pid)`。
- 起動中のアクセスログは `tmp/admin_server.log` に記録される。必要に応じてブラウザで任意のHTMLに直接アクセスする。
- ユーザーから「手動テストしたい」と依頼された場合、Codex は自動的に `./scripts/launch_test_env.command admin` を実行し、確認後にサーバーを停止する。

## 運用ルール
- 本ファイルは日本語で記述し、合意事項を確定版として反映する。
- 重要な設定変更・運用上の方針は本ファイルに追記していく。
- 作業開始時（セッションが変わるたび）には Codex が必ず `agent.md` を読み直し、ルールを再確認する。
- 変更を加えた場合は、内容に応じて `agent.md` を更新し、やったこと/決まったことをここへ追記する。
- 本番以外でコードを変更した場合も基本的に毎回 `git push` まで行い、自動 `git pull`（ncd.altry.net 上の仕組み）で本番へ反映させる。push が難しい事情があるときは事前に相談する。
  - 本番確認は `https://ncd.altry.net/` を優先し、必要に応じて Cloudflare Workers のテストドメイン（`https://ncd-app.altry.workers.dev/`）も併用する。
  - GitHub `main` へ push すると本番サーバーが自動で `git pull` する仕組みが稼働中（これまで何度も利用実績あり）。手動コピー無しで反映されるため、この前提を維持する。
- 2025-10-09: Cloudflare Worker の `/api/listMaster` `/api/listClinics` を並列取得＋キャッシュ延長で高速化済み。初回呼び出し後は100ms前後で応答する想定。
- 2025-10-09: 旧 `master:type:category|name` キーを整理するクリーナー（`npm run cleanup:legacy-masters`）を追加。初回は `--dry-run` で内容を確認し、問題なければ `--no-dry-run` で実行する。
- 2025-10-09: 現時点で残存する legacy マスターキーは 0 件（クリーナー実行結果より）。
- 2025-10-09: 診療形態マスター管理UIを改善（スラッグ非表示・アイコン/カラー/タグのプルダウン化・表示順の上下ボタン対応）。
- ローカルで実行できる作業（ビルド・デプロイ・移行スクリプトなど）は原則 Codex が担当し、結果を共有する。
- Codex とユーザーの会話は必ず日本語で行い、初心者にもわかるよう丁寧に説明する。
- ユーザーに作業をお願いする際は、ステップバイステップで手順を示し、コードはコピーしやすい形で提示する。
- セッションが切り替わったあと、ユーザーから「はじめましょう」と言われたら、リポジトリ全体を読み込み、問題点やToDoをリストアップして報告する。

## 本日確認・決定事項（2025-09-25）

### 1. 本番APIの配置とルーティング
- 本番で利用するCloudflare Workersは「ncd-app」を正とする。
- IISのURL Rewriteで以下を設定済み（メソッド保持のため 307 Temporary Redirect）。
  - `/api/*`   → `https://ncd-app.altry.workers.dev/api/{R:1}`（Redirect: 307, Append query string: ON）
  - `/api/v1/*`→ `https://ncd-app.altry.workers.dev/api/v1/{R:1}`（Redirect: 307, Append query string: ON）
- 将来的にブラウザのURLを変えたくない、またはCORS制御をIIS側に寄せたい場合は、ARR（アプリケーション リクエスト ルーティング）によるRewrite方式へ切替可能。
  - 例: `action type="Rewrite"` / `url="https://ncd-app.altry.workers.dev/api/{R:1}"`
  - Server Variables の例: `X-Forwarded-For={REMOTE_ADDR}`, `X-Forwarded-Proto=https`

### 2. Cloudflare Workers側の設定（ncd-app）
- Secrets:
  - `OPENAI_API_KEY` を「Secret（機密変数）」として登録済み（値はダッシュボード上でマスク表示）。
- KV Bindings:
  - KV Namespace `SETTINGS` を Variable name `SETTINGS` でバインド済み。
- Git接続（自動デプロイ）:
  - GitHub `wakuishinji/NCD-App` の `main` ブランチと接続。
  - main にマージ/プッシュすると自動で ncd-app Worker にデプロイ。
  - PRプレビューは必要に応じて有効化（Preview環境にもSecretが必要な場合は別途設定）。

### 3. セキュリティと構成の変更点
- `wrangler.toml` から `OPENAI_API_KEY` を削除し、Secrets運用へ移行（漏洩防止・履歴に残さない）。
- ローカル開発でAI機能を試す場合は、一時的に環境変数で起動:
  - mac/linux: `OPENAI_API_KEY=sk-xxxx npx wrangler pages dev web --port 3000`
  - Windows PowerShell: `$Env:OPENAI_API_KEY='sk-xxxx'; npx wrangler pages dev web --port 3000`
- `.gitignore` に `.wrangler/` を追加し、開発キャッシュをリポジトリに含めない。

### 4. 開発/実装メモ
- Workers実装（`functions/index.js`）はフル機能のAPIを提供。
- Pages Functions（`functions/api/[[route]].js`）は現在サブセットのみ（`settings`/`listClinics` 等）。
  - 今後、WorkersのAPI群（マスター/カテゴリ/ToDo/AI重複検出など）をPages Functionsへ段階移植予定。
- ローカル動作:
  - 静的フロントは `npx wrangler pages dev web --port 3000` で確認可能。
  - 一部APIは簡易Pythonサーバ（`simple_server.py` / `test_server.py`）でスタブ応答可能。

### 5. 動作確認コマンド（例）
- 設定保存（シークレット不要）:
  - `POST https://ncd-app.altry.workers.dev/api/settings`
    - body: `{ "model":"gpt-4o-mini", "prompt":"医療説明用のサンプルを作ってください" }`
- 設定取得（シークレット不要）:
  - `GET  https://ncd-app.altry.workers.dev/api/settings`
- 生成（シークレット必須・課金注意）:
  - `POST https://ncd-app.altry.workers.dev/api/generate`
    - body: `{ "messages":[{"role":"user","content":"テスト。短く返答してください。"}] }`
- カテゴリ（デフォルト初期化される想定）:
  - `GET  https://ncd-app.altry.workers.dev/api/listCategories?type=test`

### 6. 運用フロー（サマリ）
1. 開発ブランチ（`genspark_ai_developer` 等）で変更 → 直後にコミット。
2. PR作成/更新 → レビュー。
3. main にマージ → Cloudflare（ncd-app）が自動デプロイ。
4. IIS は `/api/*` を ncd-app へ転送するため、フロント（IIS）+ API（Workers）の構成で即時反映。

### 7. 注意事項
- APIキーは必ずSecrets管理。リポジトリやPR本文に貼らない。
- `/api/generate` はOpenAI課金が発生するため、テストは短文・最小回数で。
- 404が出る場合: 叩いているURLがPages側になっていないか、まず `*.workers.dev` を直叩きで動作を確認。

### Secrets / APIキー設定手順（Cloudflare Workers）
- 必要なSecrets: `GOOGLE_MAPS_API_KEY`（フロント地図用）、`OPENAI_API_KEY`（WorkerのAI生成用）。
- 前提: Cloudflare CLI `wrangler` が利用可能で、`wrangler.toml` と同じディレクトリで実行する。
- 本番（デフォルト環境）反映手順:
  1. `npx wrangler secret put GOOGLE_MAPS_API_KEY`
  2. `npx wrangler secret put OPENAI_API_KEY`
  3. プロンプトが出たら取得済みのキーを貼り付けてEnter。
- ステージング等で別環境を使う場合は `--env <name>` を付ける（例: `npx wrangler secret put GOOGLE_MAPS_API_KEY --env staging`）。`wrangler.toml` に該当envセクションを定義してから実行する。
- 反映確認:
  - Google Maps: `GET /api/client-config` を叩いて `{ "googleMapsApiKey":"***" }` が返ること。
  - OpenAI: `npx wrangler dev --remote` で `POST /api/generate` を短文で叩き、エラーが出ないこと。
- ローカルで静的HTMLを直開きする場合のみ、暫定的に以下のいずれかでAPIキーを渡す。
  - ブラウザDevToolsで `localStorage.setItem('ncdGoogleMapsApiKey', '...')`
  - `<meta name="ncd-google-maps-key" content="...">` を一時的にHTMLへ直書き（管理者のみ確認用途）。
  - Workers経由の動作確認に切り替えたら、上記暫定設定は必ず削除する。

### 画像/アクセス情報拡張（計画メモ）
- 目的: 診療所詳細ページにロゴ・施設外観画像、アクセス情報、診療形態タグを追加。
- 画像: `logoSmall`（正方形）/`logoLarge`（横長）/`facade`（外観）を管理。
  - Cloudflare R2 バケット `ncd-clinic-media` を使用。キーは `clinic/<clinicId>/<slot>/<uuid>.webp` 形式。
  - Worker `MEDIA` バインディング追加。署名付きアップロードURLを発行する `/api/media/upload-url`、保存 `/api/media/commit`、削除 `/api/media/delete` を実装。
  - 表示時には Worker 経由の `/assets/<key>?w=...&h=...` エンドポイントで `cf.image` を使いリサイズ。
  - KV 保存例:
    ```json
    "media": {
      "logoSmall": {
        "key": "clinic/xxx/logo-small/20251007.webp",
        "contentType": "image/webp",
        "width": 512,
        "height": 512,
        "fileSize": 39214,
        "alt": "医院ロゴ",
        "uploadedAt": 1759871234
      },
      "logoLarge": { ... },
      "facade": { ... }
    }
    ```
- アクセス情報:
  ```json
  "access": {
    "nearestStation": "JR中野駅 北口 徒歩5分",
    "bus": "区内循環1番 停留所 徒歩2分",
    "parking": { "available": true, "capacity": 5, "notes": "提携Pあり" },
    "barrierFree": ["入口段差なし", "多目的トイレ"],
    "notes": "クリニック前は一方通行"
  }
  ```
- 診療形態: `modes` フィールドに boolean で保存（オンライン/夜間/休日/在宅/救急など）。
- 管理画面: 診療所編集画面にアップローダー・アクセス情報入力欄・診療形態チェックボックスを追加。
- 公開側: 画像ギャラリー、アクセス情報カード、診療形態バッジを表示。
- 後続検討: 施設ごとの認証（パスワード/魔法リンクなど）導入時は媒体アップロードもアクセス制御する。

#### 運用メモ
- アップロード手順
  1. 管理画面 `clinicDetail.html` で対象施設を表示。
  2. 「画像管理」枠の各ボタンから 5MB 以下の PNG/JPEG/WebP/GIF を選択。
  3. アップロード完了後にプレビュー・メタ情報が更新される。保存ボタンでテキスト項目/診療形態も反映。
  4. 削除ボタンで R2 からも削除される。
- アクセス情報・診療形態は保存時に `access` / `modes` として Worker の KV に保存。
- 公開側表示
  - `clinicSummary.html`：ロゴ、外観画像、診療形態バッジ、アクセスリスト／マップを表示。
  - `searchMap.html`：一覧にロゴサムネイル・診療形態バッジ・アクセスサマリを追加。
- バックエンド API
  - `POST /api/media/upload` … multipart upload（最大5MB）。利用者は認証済み管理画面を想定。
  - `POST /api/media/delete` … 対象スロットの R2 オブジェクト削除 + KV 更新。
  - `GET /assets/<key>` … R2 から画像配信。Google Maps 等から直接参照可能。

### 認定・資格マスター: 備考フィールド再設計（承認待ち）
- 目的: 資格マスターの備考を「学会・発行元」、施設認定の備考を「指定元」に改名し、マスター参照に移行する。
- マスター構成案:
  - `master:issuer:{slug}` … ラベル、略称、種別（学会/研究会/協会 等）、URL、ステータス。
  - `master:designatedBy:{slug}` … 行政機関/自治体/団体などの指定元情報。
- 対応フロー:
  1. 管理UI (`issuerMaster.html`, `designatedByMaster.html`) を作成し、CRUD + CSV + 候補ステータスを実装。
  2. `clinicDetail` や `personalQualifications.html` / `facilityAccreditations.html` でセレクト + 自由入力併用のUIへ差し替え（未登録は候補登録）。
  3. 既存データをマイグレーションスクリプトで抽出し、新マスターに候補として投入後、管理者が承認。
  4. クリニックデータ側では `issuer: { selected: [...], meta: {...} }` 形式へ移行。表示時はマスター表示名を優先し、fallbackに従来テキストを表示。
- 作業はユーザー許可後に着手する。

### 検査・診療マスター: 説明重複対策（設計検討中）
1. **バージョン管理**
   - エントリは `slug`（分類+名称）で一意。
   - `versions[]` に説明テキスト・作成者・日時・公開ステータスを保持。`currentVersion` で公開中を指定。
   - 過去バージョンの閲覧・ロールバックが可能。（履歴は D1 などで保持する案も検討）
2. **用途別説明ブロック**
   - `explanations[]` に `{ audience: '患者/医療者', context: '紹介状/診療所パンフ' }` 等を付与。説明だけ違うケースを一レコード内に集約。
   - フロントは audience/context に応じた説明を選択表示。
3. **派生エントリ (alias/inherit)**
   - `inheritFrom` で親エントリを参照し、差分のみ上書き。施設固有の注意事項や検査セット等を追加する場合に有効。
   - 親更新時に派生へ通知する仕組みも検討。
4. **重複検出**
   - 説明作成時に既存テキストと embedding 類似度・N-gram などで重複候補を提示。意図せぬ複製を抑制。
5. **レビュー/公開フロー**
 - 説明（およびバージョン）に `status = draft/review/published` を設定し、公開前レビューを運用。
  - 変更理由・レビューログを記録して追跡可能にする。

#### 具体的な仕組み案（実装予定）
- **テンプレート分離**: `master:serviceExplanation:*` / `master:testExplanation:*` を新設し、`{ slug, baseText, audience, context, tags, status, sourceFacilityIds, inheritFrom }` を保存してテンプレートを独立管理する。
- **編集フロー**:
  1. 分類→名称を選択すると関連テンプレート一覧を取得。
  2. テンプレートを複数選択し本文エディタへ取り込み（コピーされた本文は自由に加筆修正可）。
  3. エディタで統合・編集した最終説明を保存。
  4. 保存時に診療所レコードへ `finalText` と `usedTemplates`（使用テンプレートID）を保持し、加筆結果を `status=draft` の新テンプレート候補として `master:*Explanation` に登録。
- **テンプレート承認とバージョン**: 管理画面で候補テンプレートを承認すると `status=published` に昇格。既存テンプレートの改訂は `versions[]` に履歴を追加し、公開中に切り替える。
- **派生（inherit）**: 施設固有のカスタム説明は `inheritFrom` で親テンプレートを参照し、差分のみ保持。親更新時に派生へ通知する仕組みも検討。
- **重複検出**: 新テンプレート登録時に既存テンプレートとテキスト類似度を比較し、類似候補を提示して再利用を促す。

### マスターID再設計（進行中）
- 目的: すべてのマスターで表示名や分類を変更しても参照が壊れないよう、安定した内部 ID（`stableId`）を導入する。
- 主キー: `master:{type}:{stableId}` 形式で保存。`stableId` は Worker 側で英数字+ハイフンのユニーク値を自動採番し、衝突時はサフィックス（`-2` など）や UUID fallback を付与する。
- 互換キー: これまでの `master:{type}:{normalizedCategory}|{normalizedName}` は `legacyKey` として併存させ、旧データ・CSV・参照用に保持する。必要に応じて `legacyAliases[]` へ複数登録し、表記揺れの吸収に使う。
- レコード構成: `{ id: stableId, legacyKey, legacyAliases: [], name, category, ... }` とし、今後追加するメタ情報（`synonyms`, `canonical_name` など）と合わせて保存。
- 既存データ移行フロー:
  1. KV の現行マスターを全走査し `stableId` を採番して新主キーへ書き込み。
  2. `legacyKey -> stableId` のマッピングを `masterLegacy:{type}:{hash}` などに保存して逆引き可能にする。
  3. クリニックレコードに含まれるマスター参照（services/tests/qualifications/facility/departments 等）を一括更新するスクリプト（`scripts/migrateMasterIds.mjs`）を実行。
     - 実行例: `npm run migrate:master-ids -- --api-base https://ncd-app.altry.workers.dev --dry-run`
  4. API/フロントは `stableId` を基本としつつ、旧キーでリクエストが来た場合は互換マップで解決して保存時に `stableId` へ置き換える。
- 新規マスター登録: UI で表示名・カテゴリなどを入力 → Worker が `stableId` を自動生成。管理画面には ID を参照用に表示するが編集は任意。`legacyKey` と `legacyAliases` は自動生成し、AI による案出しや CSV 取り込み時の照合に活用する。
- マスター案管理: `docs/master-proposals/` 以下に種別別の候補リスト（Markdown/CSV）を作成・共有し、Codex が案を追記→人間が確認→`scripts/bulkUpsertMaster.js`（新規作成予定）で一括登録する運用とする。提案履歴は Git で残し、必要に応じてコメントでディスカッション。
- 新規マスターもこの方式を必須ルールとし、表示名変更時は `legacyAliases` を更新して互換性を維持する。

### 診療形態マスター化（新規作業計画）
1. データモデル
   - 主キー: `master:mode:{stableId}`。フィールド例: `{ id, label, description, icon, color, order, active, tags, legacyKey, legacyAliases }`。
   - 互換性のため `clinic.modes` は `modes.selected`（`stableId` 配列）+ `modes.meta`（キャッシュ）に移行し、旧スラッグや表示名は `modes.legacy` に保持する。
2. API
   - Workers に `/api/listModes`, `/api/modes/add`, `/api/modes/update`, `/api/modes/delete` を実装。保存時は `stableId` を自動採番し、`legacyKey` を更新。
   - `listClinics`, `clinicDetail`, `updateClinic` で新フィールドへ対応し、リクエストの旧キーを互換解決する。
3. 管理UI
   - `web/admin/clinicModes.html` は ID 入力を不要にし、表示名変更時も `stableId` を維持。必要に応じて ID をコピーできるよう表示のみ行う。
   - `clinicDetail.html` はチェックボックスで `stableId` を扱い、`legacy` 情報をメタに保持する。
4. 公開側
   - `clinicSummary.js` / `searchMap.js` で `stableId` を参照しつつ、互換表示名も考慮。表示ラベル・カラー・アイコンをマスターに合わせて統一。
5. 運用
   - マスター追加時は `docs/master-proposals/modes.md` に案を追記 → 承認後に一括登録スクリプトを実行 → `agent.md` へ反映する。

## 今後の方針（データテーブル別）

### Clinics
- 現状: KV `clinic:id:*` に基礎情報と `services/tests/personalQualifications/facilityAccreditations/departments/schedule` を配列で保持しており、多くが自由入力で揺れが残る。
- 短期: 既存配列要素へ `masterKey`（`master:type:category|name`）を保存する仕組みを入れて、選択式登録→再保存で文字列揺れを除去する。
- 短期: 住所マスター（都道府県・市区町村・郵便番号）と緯度経度を付与し、病院→診療所検索で距離ソートできるようにする。
- 中期: フォローアップ可否タグ（例: `followup:癌化学療法後`）や受け入れ条件（年齢区分・訪問診療・外国語対応など）をタグとして管理する。
- 中期: 患者向け説明文 `patientFacingNotes` を分離保持し、患→診検索時の表示に活用する。

### Service/Test Masters
- 現状: `master:service:*` と `master:test:*` は `category/name/desc/sources/status` を持つが、臨床的な紐付け情報が未整備。
- 短期: 診療報酬・JLAC10 等の標準コードや `canonical_name` を整備し、クリニック保存時はID参照を基本とする。
- 短期: `followupTags` や `requiredEquipments` をマスター側へ追加し、病→診・診→診検索条件に利用する。
- 中期: 症状・部位マスターとのリンクテーブルで「どの症状/部位から推奨される診療・検査か」を保持する。
- 中期: `patientLabel` や `aka` など患者向け語彙フィールドを追加し、患→診検索で同義語を展開する。

### Qualification / Facility / Department Masters
- 現状: `master:qual` `master:facility` `master:department` は分類＋名称で管理し、クリニック配下に配列保存。資格分類は推測補完で分類を設定している。
- 短期: 標榜診療科は厚労省コードを付与し、クリニック保存もコード参照に移行する。
- 短期: 個人資格・施設認定に `validUntil` `issuerUrl` などのメタ情報を追加し、更新漏れチェックを容易にする。
- 中期: 診療科とサービス/検査マスターをクロスリファレンスし、標準提供すべきサービス・検査をレコメンドできるようにする。
- 中期: 逆紹介で重要な基準（地域医療支援病院協力診療所等）をタグ化し、検索フィルタへ反映する。

### Categories
- 現状: `categories:type` に JSON 配列を保存し、UIで自由追加できるため表記揺れや順序が統一されていない。
- 短期: 表示順 `sortOrder` と患者向け別名を持たせ、マスター登録時も選択制で統制する。
- 短期: 住所・症状など新規マスターにも同一仕組みを流用できるようカテゴリ管理UIを拡張する。
- 中期: カテゴリの階層化（大分類→中分類）を導入し、検索UIで段階的に絞り込めるようにする。
- 中期: カテゴリ名称変更時に関連マスター/クリニックデータをまとめて移行するスクリプトを用意する。

### Symptom / Body Masters（新設）
- 新設: `master:symptom:*` に医療者向け名称・患者向け名称・関連診療領域・緊急度タグを保持する。
- 新設: `master:bodySite:*` で部位階層（系統→器官→部位）と左右・前後などの属性を管理する。
- 新設: `link:symptom_service` / `link:symptom_test`（symptomId, masterKey, evidenceLevel 等）で症状⇔診療/検査の推奨関係を記録する。
- 短期: 既存サービス/検査の `desc` から頻出語を抽出し、症状・部位マスター候補の初期リストを生成する。
- 中期: 症状→推奨診療/検査の優先度や患者向け説明文を保持し、検索結果表示に活用する。

### Search / Vocabulary
- 新設: `clinic_geo_index`（clinicId, lat, lng, areaCode）を整備し、距離検索を高速化する。
- 新設: `thesaurus`（term, normalized, context）で医療用語と患者語の同義語マップを保持し、患→診検索で活用する。
- 短期: クリニック・サービス・検査の全文検索用に `search_index`（token, targetId, weight）を用意する。
- 中期: 病→診 / 診→診 / 患→診 それぞれの検索パターンを定義し、必要フィールドを agent.md に追記していく。
- 中期: 更新監査用に `revision_log`（table, recordId, field, old, new, editor, timestamp）を追加し、マスター整備の進捗を可視化する。

### Symptom / Body / Thesaurus 初期定義案
- 2025-10-05: `web/admin/symptomMaster.html` と `web/admin/bodySiteMaster.html` を追加し、症状・部位の専用管理UIと連動するJS (`web/js/admin/*.js`) を実装。診療/検査/部位マスターを横断した紐付け編集が可能に。
- 2025-10-05: `/api/searchClinicsBySymptom` を実装し、`web/searchSymptom.html` から症状→診療・検査→診療所を横断検索できるようにした（関連マスター・未対応項目の可視化を含む）。
- 2025-10-05: トップページの症状検索ボタンはテスト向け (`テスト 症状で検索`) に変更予定。本番利用は患者向け検索ページ（症状・地図など）で提供する方針。同様に `テスト 地図から検索` 導線も暫定で追加する。
- 2025-10-06: 症状・部位マスターの種別を拡充（めまい/胸痛/呼吸困難/下痢/関節痛、腰部/骨盤/肩関節/膝関節など）し、`scripts/seedSymptomMaster.js` と `scripts/seedBodySiteMaster.js` を更新。
- 2025-10-07: `web/searchMap.html` と `web/clinicSummary.html` を刷新し、フロント側でクリニック一覧と詳細ページへ遷移できる検索/サマリーUIを追加。Leafletベースで暫定マップ表示を実装しつつ、Google Maps Platform への置き換え方針と比較検討結果を整理（下記メモ参照）。
- 2025-10-08: 地図UIを Google Maps JavaScript API へ移行。`web/js/googleMapsLoader.js` で API キー（`meta[name="ncd-google-maps-key"]` / `localStorage.ncdGoogleMapsApiKey` / `window.NCD_GOOGLE_MAPS_API_KEY`）を解決し、`searchMap.js` / `clinicSummary.js` は Google Maps でピン表示・InfoWindow を提供。緯度経度が未登録の場合はメッセージ表示でフォールバック。

#### Frontend Search/Map メモ (2025-10-07)
- 現状: Leaflet + OSM で暫定表示中。症状検索ページからはクリニック検索API結果に基づきサマリーページへ遷移可能。
- 地図検索: `/api/listClinics` の結果をそのまま利用し、住所ありクリニックはすべてピン表示が望ましい。現在は緯度経度が欠けており、`FALLBACK_COORDS` で野方クリニックのみハードコード表示。
- サマリー画面: `/api/clinicDetail` を表示。Leafletでマップにピン表示するが、座標未設定の場合はメッセージを表示。
- TODO（確定方針）:
  - Google Maps Platform の Geocoding / Places 連携は未実装。住所検索・現在地センタリング・緯度経度キャッシュ生成を次ステップで対応する。
  - API キー管理（フロント/バック別）、課金監視設定、利用制限（ドメイン/IP）を設定して運用する。
- 留意点: Google APIキー管理（フロント/バック別）、課金監視設定、規約遵守（ロゴ表示/キャッシュ禁止）を導入すること。

- Symptom Master（`master:symptom:<category>|<name>`）: 共通フィールドに加えて `patientLabel`（患者向け名称）、`bodySiteRefs`（`bodySite:<slug>`配列）、`severityTags`、`icd10`、`synonyms`、`defaultServices`（関連サービスの`masterKey`配列）を格納する。初期カテゴリは「消化器症状」「呼吸器症状」「循環器症状」など診療領域別に設定。
- Body Site Master（`master:bodySite:<system>|<name>`）: `anatomicalSystem`（器官系）、`canonical_name`（半角キー）、`parentKey`（上位部位）、`laterality`（左右/両側など）、`aliases`、`patientLabel` を保持し階層化する。トップ階層は「頭頸部」「胸部」「腹部」「四肢」「体幹」「皮膚」などを想定。
- Thesaurus（`thesaurus:<normalized>`）: `term`、`normalized`、`variants`（同義語配列）、`context`（`symptom`/`service`/`test`等）、`locale` を保持し、患→診の語彙変換に利用する。Symptom/Bodyの`patientLabel`や`synonyms`から自動生成する。
- 例: Symptom レコード
  ```json
  {
    "type": "symptom",
    "category": "消化器症状",
    "name": "腹痛",
    "patientLabel": "おなかの痛み",
    "bodySiteRefs": ["bodySite:abdomen"],
    "severityTags": ["急性", "慢性"],
    "icd10": ["R10"],
    "synonyms": ["腹部痛", "みぞおちの痛み"],
    "defaultServices": ["master:service:消化器|胃腸内科外来"],
    "status": "candidate"
  }
  ```
- 初期データ投入案:
  - `scripts/seedBodySiteMaster.js`: 頭頸部→腹部→上腹部といった階層を親子関係付きで登録。
  - `scripts/seedSymptomMaster.js`: 主要症状（腹痛・発熱・咳・呼吸困難 など）を bodySite と関連付けて投入。
  - `scripts/seedThesaurus.js`: Symptom/Bodyの`patientLabel`/`synonyms`からvariantsを生成し、患→診検索用辞書を作成。
- Workers側対応:
  - `addMasterItem` / `listMaster` の許可タイプに `symptom` `bodySite` を追加し、`bodySiteRefs`など追加フィールドを透過保存できるようにする。
  - 新規prefix `thesaurus:` の `GET/POST /api/thesaurus` エンドポイントを実装し、UIや検索インデックス生成スクリプトから参照できるようにする。
- UI/インデックス検討:
  - 管理画面に症状・部位マスターの管理タブを追加し、患者向け名称や紐付くサービス/検査を編集可能にする。
  - 検索インデックス生成時に Symptom→Service/Test のリンクを flatten し、病→診/患→診検索クエリに利用する。
