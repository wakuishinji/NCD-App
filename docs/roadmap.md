# NCD 全体ロードマップ

中野区診療所データベース（NCD）を起点に、医療施設・医療者・患者が連携できるエコシステムを段階的に構築するためのロードマップを整理する。本資料は和久井さんが提示した将来像と保有ドメインを基に、サービス区分・役割・インフラ構成を再設計した最新版である。

---

## 1. ビジョンとサービスブランド

| フェーズ | サービス名 / ドメイン | 概要 | 主担当データ / ユーザー |
|----------|----------------------|------|-------------------------|
| Phase A | **NCD Core**（`ncd-app` 既存） | 診療所・病院の施設マスタ、マスター管理、管理画面 | 施設データ、診療・検査・資格マスター、医師会担当者 |
| Phase B | **SkilBank**（`skill-bank.jp`） | 医療者プロフィール・履歴書・スキル管理、複数施設所属対応 | 医療者、施設管理者、人事担当 |
| Phase C | **Medical Orchestra**（`medicalorchestra.com`） | 医療者/施設/患者間チャット、紹介・予約、公開検索ポータル | 医療者、患者、紹介担当者 |
| Phase D | **MedicalDraft**（`medicaldraft.jp`） | 医療者スカウト・転職マッチング、契約・監視 | 施設経営層、人事、転職希望医療者 |

補助ドメインとして `medicalyoutube.com`（教育・プロモーション）、`undistance.jp`（遠隔医療/社内ツール候補）を保持し、必要に応じて Pages やランディングに割り当てる。

---

## 2. 現状と直近課題（2025-10 時点）

- NCD Core は中野区医師会所属診療所のデータ入力・管理機能を運用中。施設登録〜詳細編集 UI と Cloudflare Workers API が整備済み。
- 医療者アカウント、認証基盤、監査ログなどは実装中で、職種横断的な医療者管理は未着手。
- 管理画面は誰でもアクセス可能な状態で、将来的には `systemRoot`（和久井さん専用）と通常 `systemAdmin` の二段階制へ切り替える予定。
- データストアは Cloudflare KV/R2 に集中しており、医療者個人情報やチャット履歴を扱う際の分離設計が必要。

---

## 3. フェーズ別ロードマップ

### Phase A: NCD Core 拡張（診療所→病院・他医師会へ）
1. **多テナント化**: 施設・医療者レコードに `organizationId` を追加し、医師会/地域単位で設定を分離。  
   - 2025-11-11: 認証 API・セッションに `organizations` / `organizationIds` を同梱し、アカウント/メンバーシップ作成時に必ず `organizationId` を付与するよう更新。Cloudflare Workers 側で JWT・セッションメタ・invites/adminRequests がテナント境界を尊重するようになった。
2. **ロール強化**: `systemRoot` / `systemAdmin` / `clinicAdmin` / `clinicStaff` の認証・権限を実装し、管理画面へのアクセスを `systemRoot` 限定モードへ切り替える。  
   - 2025-02: 管理者権限を先生方自身が申請できるよう `adminRequest` スキーマと API を追加済み。`adminReviewer` ロールを新設し、医師会事務が申請承認を担当できる体制に移行中。  
   - `POST /api/auth/requestAdminAccess` で申請受付、`GET/POST /api/admin/accessRequests*` で承認・却下を処理。通知メールの宛先は `ADMIN_NOTIFY_EMAILS` 環境変数で管理。  
   - 次段階でフロント導線（申請フォーム、承認UI、トップページのログイン必須化）を整備し、全施設へのロール付与が完了したら「施設を選ぶ」導線を廃止する。  
3. **データ移行**: 既存クリニックデータを schema v2 に統合し、スキーマ変換スクリプト・検証ツール・バックアップ手順を整備。  
4. **マスター整理**: 病院向け項目（病床数、診療科体系、施設属性）を追加し、多地域展開に向けたカテゴリ体系を標準化。  
5. **監査・運用**: 監査ログ、通知、権限逸脱検知を導入。
6. **マスターAPI最適化（2025-11-06 完了）**: マスター更新 API を D1 優先の実装へ移行し、応答時間を短縮。管理 UI に保存／削除ステータスのフィードバックを追加済み。

### Phase B: SkilBank（医療者データベース）
1. **アカウントモデル**: 医療者プロフィール、複数施設所属、友人（フレンド）関係を扱うデータ構造を設計。  
2. **項目定義**: 職種・資格・学会・スキル・学歴・職歴など履歴書項目をカテゴリ化し、項目単位で公開レベルを設定できる UI/API を実装。  
3. **プライバシー**: 住所・連絡先などの秘匿情報は暗号化保存し、公開/限定公開/非公開を制御する `visibility` フラグと許諾トークンを導入。  
4. **履歴書生成**: 登録情報から PDF/共有リンクを生成し、本人許諾者のみ閲覧可能にする。  
5. **SkilBank ↔ NCD 連携**: 施設画面で所属医療者の公開スキル・資格を読み取り専用表示し、検索用途へ活用。

### Phase C: Medical Orchestra（チャット & 紹介プラットフォーム）
1. **リアルタイム基盤**: Workers Durable Objects や専用 WebSocket サービスでチャットルーム・グループを構築。  
2. **紹介フロー**: 病院⇔診療所、診療所⇔診療所、患者⇔診療所の紹介・予約シナリオをテンプレート化し、チャットから紹介状作成・共有まで完結できる UX を提供。  
3. **公開検索**: SkilBank/NCD の公開データを検索エンジン（Algolia/Meilisearch 等）へ連携し、誰でも施設・医療者を探せるポータルを構築。  
4. **権限制御**: チャット参加者や閲覧できる患者情報は `viewerContext` と公開設定で制御し、監査ログに記録。  
5. **ドメイン展開**: `medicalorchestra.com` のトップはマーケティング/Landing、アプリ本体は `app.medicalorchestra.com` のように分離。

### Phase D: MedicalDraft（転職支援）
1. **サービス開始条件**: SkilBank利用者・施設利用者が十分に増えた段階でクローズド β を開始。それまでは内部ロードマップのみで表には出さない。  
2. **匿名検索/オファー**: 施設管理者が性別・年齢帯・地域・スキル条件で匿名検索し、給与/契約金を提示できる UI とAPIを構築。  
3. **チャット連携**: オファーは Medical Orchestra のチャットに届き、医療者が「転職用ステータスのお友達」に昇格させて情報公開レベルを調整できる。  
4. **契約管理**: 面談・契約書作成・締結・運営による履行監視をワークフロー化し、報酬請求やステータス管理をバックオフィスUIで提供。  
5. **法務/課金**: アルトライテクノロジーズ名義での利用規約・契約書テンプレート・料金体系を整備し、決済やインボイス発行まで対応。

---

## 4. 役割・認証・アクセス制御

| ロール | 権限概要 | 備考 |
|--------|----------|------|
| `systemRoot` | 和久井さん専用。全サービスの設定/ユーザー/ドメイン/課金など全権管理。 | 管理画面アクセスの切替タイミングも決定。MFA必須。 |
| `systemAdmin` | 日常運用を担うシステム管理者。施設・医療者・マスター編集、ログ閲覧。 | 転職オファー承認、契約監視など敏感操作は `systemRoot` の承認が必要。 |
| `facilityAdmin` | 自施設の登録・スタッフ招待・患者対応を管理。SkilBankで所属医療者のプロフィール閲覧/承認が可能。 | Medical Orchestra で紹介依頼・患者チャットを担当。 |
| `staff` / `medicalProfessional` | 施設スタッフや医療者。プロフィール更新やチャット参加。公開レベルは本人設定。 | SkilBankで履歴書公開、MedicalDraftでオファー受信。 |

認証は中央IdP（仮称 `auth.skill-bank.jp`）で実装し、各サービスは JWT の Audience / Scope を用いてアクセス制御する。Workers KV (もしくは D1) にセッション・招待・パスワードリセットを保存し、監査ログにはログイン・権限変更・データ閲覧を記録する。

---

## 5. インフラ / システム分離方針

1. **サービス構成**  
   - `ncd-app`（Workers）：NCD Core API。施設データ・マスター管理。  
   - `skilbank-api`（Workers想定）：医療者プロフィール管理。PII は D1/PostgreSQL で暗号化保存。  
   - `orchestra-gateway` & `orchestra-rt`：Medical Orchestra のREST/リアルタイム（DO/WebSocket）。  
   - `draft-backoffice`：MedicalDraft のオファー・契約管理。決済連携が必要になるため、外部DB + Queue を想定。  
   - `static-sites`：Cloudflare Pages でブランド別ランディングをホストし、カスタムドメインを割り当て。  

2. **データ連携**  
   - 各サービスは共通ID（`account:<uuid>` / `clinic:<uuid>` / `skillProfile:<uuid>`）で紐付け、公開情報は Event/Queue 経由で同期。  
 - 個人情報は SkilBank/MedicalDraft 側で保持し、NCD/Orchestra は公開用のキャッシュテーブルを参照。  
 - KV（設定・小規模キャッシュ）と D1 / 外部RDB（履歴・大量データ）を役割分担させ、将来的な移行計画を事前に整備する。  
 - 厚労省公開データなど大容量のオリジナルソースは Git に含めず、取得手順を `data/medical-open-data/README.md` に整理。

### 5.1 データ基盤リデザイン計画（D1 移行）

- **目的**: KV/R2 中心の構造から脱却し、Cloudflare D1 を正本 DB として採用。施設・医療者・厚労省データを正規化して保存し、検索・集計・API をサーバーサイドで完結できるようにする。将来の SkilBank / Medical Orchestra / MedicalDraft とも共通基盤で連携する。

- **主要テーブル（初期案）**
  - `facilities`（施設基本情報：厚労省 ID、名称、所在地、種別、緯度経度、同期ステータス）
  - `facility_mhlw_snapshot`（最新の厚労省スナップショット JSON と同期日時）
  - `facility_schedule`（曜日・時間帯・診療科ごとの診療時間）
  - `accounts` / `practitioners` / `memberships`（アカウント・医療者・所属）
  - `mhlw_imports`（CSV 取り込み履歴とメタ情報）
  - `audit_log`（重要操作の追跡）

- **フロー**
  1. CSV を UI/CLI からアップロード → 整形 JSON を R2 へ保存。
  2. Workers が JSON を D1 に Upsert（施設／スケジュール／スナップショット／履歴）。
  3. `GET /api/facilities`、`GET /api/facilities/:id` 等の REST API を D1 ベースで設計。検索パラメータ（略称、都道府県、市区町村、郵便番号）に対応。
  4. `mhlw-sync.html` や `mhlw-facility-list.html` は全件ロードを廃止し、API でページング表示。Playwright など E2E テストも併せて整備。

- **移行ステップ**
  1. D1 スキーマ作成（SQL 定義・インデックス設計）。
  2. 既存 KV データと厚労省 CSV から D1 へ移行するスクリプトを作成。
  3. Workers API を段階的に D1 参照へリファクタし、フロントを API 検索に切り替える。
  4. 動作確認後、KV 参照を廃止・R2 はバックアップ用途とする。

- **将来展開**
  - SkilBank 医療者データや Medical Orchestra のチャットログも D1 を中心に据え、一括検索・集計を可能にする。
  - データウェアハウス（BigQuery 等）へのエクスポートや AI 活用の基盤を整える。


3. **セキュリティ**  
   - Cloudflare Zero Trust で管理ポータルと API へのアクセスを制限。  
   - Secrets（APIキー・Webhook）は Workers Secrets に保存し、サービス毎に分離。  
   - 監査・アラートは Grafana Cloud 等へ集約し、トークン失効やレートリミットを徹底。  

4. **ドメイン割り当て例**  
   - `ncd-app.jp`（想定）: 医師会向けポータルと既存UI。  
   - `skill-bank.jp`: SkilBank本番 `app.skill-bank.jp`、LP `www.skill-bank.jp`。  
   - `medicalorchestra.com`: LP / アプリ / サポートのサブドメイン分割。  
   - `medicaldraft.jp`: β開始時に `app.medicaldraft.jp` を公開、公開前は社内専用。  

---

## 6. 次のアクション（優先度順）

1. **認証リファクタ**: `systemRoot` 専用アクセス制御を先行実装し、管理画面をロックダウン。  
2. **多テナント準備**: `organizationId` 追加と医師会ごとの設定ファイル化、データ移行計画の策定。  
3. **SkilBank プロトタイプ**: 医療者プロフィールのデータモデルと公開制御の設計、最低限の入力UI試作。  
4. **秘密の質問導入**: 選択式質問と回答文字種（ひらがな/カタカナ）を必須化し、本人確認フローを標準化。詳細は `docs/security-questions.md` を参照。  
5. **Medical Orchestra 設計**: リアルタイム基盤の技術選定とチャット/紹介フローのモック作成。  
5. **ドメイン/DNS 整備**: 各ブランドの DNS・SSL・Pages 連携を洗い出し、リリース順にチェックリスト化。  
6. **法務準備**: MedicalDraft の契約書ひな形・利用規約・個人情報保護方針を整理し、公開タイミングを判断できる材料を集約。  
7. **メール基盤整備**: Cloudflare Workers に `MAIL_PROVIDER=sendgrid` 等の設定を投入し、SendGrid(API Key) や `ADMIN_NOTIFY_EMAILS` を本番環境で管理できるようにする。テスト時はログ出力のみ、運用切替時に Secrets を投入する手順を明文化する。  

---

## 7.1 直近セッションで着手するタスク（メモ）
1. `membership` / `organizationId` 拡張のテクニカル Spike  
   - JWT payload への `memberships` 同梱と `NcdAuth` ヘルパー整理。  
   - メンバーシップで複数部署・委員会・グループを兼務できるよう配列化。  
   - 2025-11-07: Workers 側で `organizationId` / `departments` / `committees` / `groups` を保持し、トークン・`NcdAuth` 双方で利用できるように更新済み。
2. 組織タイプ別マスタの下準備  
   - 診療所／病院／医師会それぞれの「部署」「委員会」「グループ」「役職」テンプレを調査・ドラフト化。  
   - CLI スクリプト（`scripts/`）からマスター登録・更新できるパイプラインを検討。  
   - Codex セッション内でマスター候補を調査→レビュー→CLI 経由で登録する一連のフローをルーチン化し、作業手順書を `docs/` に整備。  
   - 2025-11-07: `docs/organization-master-templates.md` と `npm run seed:org-masters` を追加し、テンプレの投入経路を確立。  
3. Medical Orchestra 向けグルーピング要件の洗い出し  
   - チャット自動参加条件（委員会・部署・施設横断）とデータ構造のメモ作成。  
4. メール運用手順の整備  
   - SendGrid 登録後に Secrets を投入する手順書を `docs/` に切り出し、ステージングで疎通テスト。  

次セッションは上記 1→2→3 の順で対応開始予定。

### 7.2 厚労省データ紐付け UI 改修メモ（2025-10-28）
- 厚労省ID同期画面を「未紐付け施設の一覧」ベースに刷新。カード内検索は施設名部分一致（かな含む）のみを使用し、候補には厚労省ID・住所を明示。
- 「このIDをセット」で登録される値を数値ID（厚労省既定）に統一し、ID登録／同期完了後は一覧を自動再読込。
- 将来的に新規施設登録フローへ転用できるよう、検索コンポーネントを共通化する前提で実装方針を整理済み。
- 厚労省データに存在しない施設向けに「未掲載として記録」導線を追加。`not_found` ステータスと補足メモを保存でき、一覧では専用リストへ移動する。

### 7.3 マスター運用アップデート（2025-11-06）
- マスター更新 API を D1 優先の実装へ切り替え、KV 側のレガシーポインタ書き換えは `ctx.waitUntil` でバックグラウンド処理化。名称変更が無い更新ではポインタ更新をスキップし、平均レスポンスを ~0.9 秒まで短縮。  
- 管理 UI に保存・削除・追加時のスピナおよび完了メッセージを実装し、操作状況が可視化できるように改善。  
- 次のアクション:  
  1. 既存レガシーポインタの整理を進め、KV 依存を段階的に削減する計画を策定。  
  2. `comparable_key` による重複検知やサジェストを UI へ展開する検討を開始。  
  3. D1 クエリのパフォーマンスを継続モニタリングし、必要に応じてインデックス追加やキャッシュ設計の見直しを行う。

### 7.4 説明候補フロー刷新（2025-11-07）
- サービス／検査マスター管理画面から説明入力欄を撤廃し、各カードで説明候補を直接編集できるようにした。CSV 取込は「分類,名称,説明候補」を前提に候補へ反映される。  
- `clinicServices.html` / `clinicTests.html` の入力フォームへ説明候補の複数選択 UI を導入。テンプレ未選択で手入力した説明はドラフト候補として自動登録し、施設データ側も候補メタを保持する。  
- 保存時は新規候補を優先して `desc` に反映するよう `masterPage.js` を整理し、既存データとの互換性を確保。

**残課題**
- 既存マスターで `desc` のみ保持している項目を説明候補へ移行するバッチの要否を検討。  
- 説明候補と手入力を組み合わせた保存パターンの動作確認を進め、必要ならテンプレ自動生成フローを拡張。  
- サービス／検査以外のマスターでも説明候補を利用する場合に備え、共通ユーティリティ化の方針を決める。

### 7.5 施設コレクション同期の安定化（2025-11-07）
- 既存クリニックの診療／検査／資格データが D1 の `facility_*` テーブルに転記されておらず、一覧が空になる事象を確認。D1 の行が存在しない場合はメタデータ（KV / facilities.metadata）から復元し、そのままバックグラウンドでテーブルへ再投入するフォールバックを実装。  
- D1 テーブルに行が存在する場合も、メタデータに保持されている `desc` / `explanations` などの追加情報を失わないようマージ処理を行う。  
- クリニック保存時の大量 DELETE/INSERT を `ctx.waitUntil` で非同期化し、診療・検査の新規作成／削除の体感レスポンスを改善。  
- `scripts/backfillFacilityCollections.mjs` を追加し、API 経由で全施設の `clinicDetail` を叩くことで KV→D1 の一括バックフィルをいつでも再実行できるようにした（`npm run backfill:facilities`）。

**次の対処**
- 未同期の施設をバッチで洗い出し、必要に応じて D1 側の `facility_*` テーブルを再構築するメンテタスクを作成。  
- 施設データの完全移行後は、`facility_services` 等にも `payload` カラムを追加し、説明文やテンプレ参照を D1 側に正規化するロードマップを再検討する。

### 7.6 D1 完全移行計画（2025-11-07）
1. **マスターカテゴリを D1 に統一**  
   - `master_categories` テーブルを正本扱いに切り替え、`/api/listCategories` 系 API から KV フォールバックを撤廃。  
   - 既存の KV カテゴリを D1 へ一括コピーするスクリプトを作成し、移行後は KV 側を破棄。  
2. **施設コレクションの D1 正本化**  
   - `clinic.services/tests/qualifications` を KV に保存しない運用へ変更し、`facility_*` テーブルのみを参照・更新。  
   - `clinicDetail` は D1 からのデータで再構築し、KV メタデータとマージしない形にリファクタ。  
3. **バックアップとバッチ整備**  
   - 既存施設のデータを JSON でアーカイブし、`npm run backfill:facilities` に「指定施設のみ復旧できる」オプションを追加。  
   - D1 への投入・検証フローを `docs/d1-master-migration.md` に追記し、復旧手順を標準化。

### 7.7 マスター D1 完全移行タスク詳細（2025-11-08）

**目的**  
- 診療・検査・資格など全マスターを D1 の単一正本に統一し、KV 依存の残骸を一掃する。  
- API／UI／運用ドキュメントを「D1 前提」で再設計し、将来の多テナント展開や監査要件に備える。

**フェーズ別タスク**
1. **現状棚卸し & バックアップ**  
   - `node scripts/exportMastersFromApi.mjs --pretty` で全タイプの最新 JSON を取得し、`tmp/backups/YYYYMMDD-masters.json` に保存。  
   - `scripts/verifyMastersInD1.mjs` を追加実行し、D1 との件数差分を出力。差分一覧は `docs/d1-master-migration.md` に追記して再現可能にする。  
   - KV にのみ存在するマスター項目（レガシー）を `reports/master-kv-orphans.json` に抽出する簡易スクリプトを用意し、移行対象を可視化。

2. **D1 への一括投入と検証**  
   - 種別ごとに `node scripts/migrateMastersToD1.mjs --dataset <backup> --db MASTERS_D1 --truncate` を実行し、SQL ログは `tmp/migrations/<type>-YYYYMMDD.sql` としてアーカイブ。  
   - 実行後は `wrangler d1 execute MASTERS_D1 --command "SELECT type, COUNT(*) ..."` で件数を再確認し、差分がゼロであることをレポート化。  
   - テナント（`organizationId`）を持つデータは別ジョブに切り分け、投入順・依存関係を checklist 化して `docs/d1-master-migration.md` に記録。

3. **Workers/API の D1 専用化**  
   - `functions/lib/masterStore.js` から KV フォールバックを削除し、D1 バインド未設定時は即 500 を返すガードを追加。  
   - キャッシュ更新ロジックは D1 からのみ読み書きするよう整理し、`mastercache:*` の TTL・再生成フロー（`/api/listMaster?force=1`）を Runbook に明文化。  
   - 旧 KV 更新系スクリプトやメンテナンス API（`maintenance/masterCleanup` など）は D1 用に書き直すか廃止。使用停止に伴い README を更新。

4. **UI / テスト更新**  
   - Playwright、Vitest、スモークテストで D1 モックを利用するよう修正し、`wrangler dev` でもローカル SQLite バッキングを必須化。  
   - 管理 UI のマスター編集系画面は「D1 を正本」とする注意書きに変更し、反映待ちステータスやエラーメッセージを D1 応答に合わせて見直す。  
   - e2e 実行前に `npm run seed:masters:d1`（新規タスク）で D1 を初期化するスクリプトを追加し、CI でも共通利用できるようにする。

5. **レガシーデータ破棄と監査対応**  
   - KV 上の `master:*` キーを段階的に削除し、`wrangler kv:key list` の結果と削除ログを保管。  
   - 移行完了後 1 週間は D1 / KV の diff を監視する簡易ジョブを動かし、異常が無ければ KV の master namespace を完全停止。  
   - 変更履歴・ロールバック手順・チェックリストを `docs/d1-master-migration.md` に統合し、agent.md にも「マスター編集は D1 経由のみ」と追記する。

**成果物**  
- 最新バックアップ JSON / 実行 SQL / 差分レポート  
- 更新された Runbook (`docs/d1-master-migration.md`) と 運用ルール (`agent.md`)  
- KV 削除完了ログとロールバック用アーカイブ

### 7.8 Cloudflare 完全移行計画（2025-11-08）

**前提**  
- 現行の本番サイトは さくら VPS（Windows 2025 + IIS）上で動いているが、ユーザーはテスト利用のみ。短時間の停止や大幅な構成変更が許容される。
- 目標はフロントエンド・API・データストアを Cloudflare（Workers/Pages/KV/D1/R2）へ集約し、`wrangler` ベースで統一運用すること。

**タスク概要**
1. **棚卸しとマッピング（2025-11 中旬）**  
   - Windows サーバー上のコンポーネント（IIS サイト、バッチ、スケジューラ、ファイル共有）を一覧化し、Cloudflare 上の置き換え先を決定。  
   - DNS / SSL 証明書 / Secrets 管理の現状をまとめ、Cloudflare へ移管する際の手順を記録。
2. **ステージングを Cloudflare 化（2025-11 下旬）**  
   - Cloudflare Pages に `web/` 静的ファイルをデプロイして `*.pages.dev` で検証（手順は `docs/cloudflare-pages-staging.md` を参照）。  
   - Workers（API）と D1/KV/R2 のバインドを `wrangler.toml` 上で本番と同じ構成に揃え、ステージング用の環境変数（Secrets）は `docs/cloudflare-secrets.md` に沿って登録。  
   - GitHub Actions or CLI で `wrangler deploy --env staging` を実行できるよう設定。
3. **本番 DNS 切替準備（2025-12 上旬）**  
   - Cloudflare 側でカスタムドメイン（`ncd-app.altry.workers.dev` など）を登録し、SSL/TLS 設定を確認（詳細は `docs/cloudflare-dns-cutover.md` を参照）。  
   - さくら VPS 側の DNS TTL を 300 秒程度に下げ、切り替え当日の反映を早める。  
   - Windows サーバー上の最新バックアップ（ファイル + DB）を取得して保管。
4. **本番切替（2025-12 中旬）**  
   - DNS を Cloudflare へ向ける or ネームサーバーを変更し、Cloudflare Pages/Workers を正面に据える。  
   - 切替直後は `wrangler tail`・Cloudflare Analytics でエラー/リクエスト状況を監視し、必要に応じてロールバック。  
   - 旧サーバーを「読み取り専用 + リダイレクト」に設定し、1〜2 週間後に停止する。
5. **運用 Runbook 更新（2026-01）**  
   - 新しいデプロイ手順、Secrets 管理、監視/アラート、障害時ロールバック方法を `docs/system-runbook.md`（新規）にまとめる。  
   - GitHub / Cloudflare アカウント権限や CI/CD フローを定義し、開発者全員が同じ手順で運用できるようにする。

**期待効果**
- サーバー保守（OSアップデート、IIS設定、証明書更新）から解放され、アプリ開発に集中できる。  
- CDN 配信によりレイテンシを均一化し、SkilBank / Medical Orchestra / MedicalDraft も同一基盤で展開できる。  
- `wrangler deploy` / `wrangler rollback` により、バグ修正やロールバックが数秒で可能になるため、テスト中の大胆な実装変更がしやすくなる。

---

## 7. 現状の不具合・対応状況（2025-10-21）

- **systemRoot ログイン不可（解消済み）**  
  - 原因: PBKDF2 の iteration `150000` が Workers Runtime で許容されず `NotSupportedError` が発生。  
  - 対応: `functions/lib/auth/password.js` の既定/最大 iteration を `100000` に引き下げ、`system-root.json` の `passwordHash` を再生成して Cloudflare KV（本番/プレビュー）へ再投入。  
  - 結果: `wakui@altry-med.or.jp` / `keishinyuusaku@1043` でログイン成功を確認済み。
- **JWT_SECRET 未設定（解消済み）**  
  - ログイン後のトークン発行が `JWT secret is not configured` で失敗。  
  - 対応: Cloudflare シークレットに 64 文字のランダム文字列を `JWT_SECRET` として設定。  
  - 結果: アクセストークン／リフレッシュトークン発行が正常化。
- **パスワード再設定メール未送信（継続課題）**  
  - 現状 `mailProvider: "log"` でダミー送信。今後 SendGrid 等の本番設定が必要。
- **ログ監視**  
  - Workers Logs を有効化し、`wrangler tail` で現象切り分け可能な状態に更新。
- **施設ホームの権限制御改善中**  
  - systemRoot 用のログアウトボタンおよび施設管理者向けインラインログインフォームを追加。  
  - ログアウト時に `localStorage` に `ncdAuth` が残っていると編集リンクが有効化されたままになるため、今後はサーバー応答に基づく権限制御へ寄せる必要がある。  
  - 管理者未設定の施設は従来通り編集可・管理者設定済み施設のみログイン必須という仕様を継続しつつ、UI/UX とデータ整合性の最終調整を進める。
- **systemRoot 資格情報管理**  
  - `system-root.json` はテンプレート化し、実際のソルト/ハッシュは Cloudflare KV (`SETTINGS`) で管理する運用に変更。  
  - 詳細手順は `docs/system-root-credentials.md` を参照し、Git への機微情報コミットを防ぐ。

本ロードマップは定期的にアップデートする。新しい要件が出た場合は、本ドキュメントを更新しつつ、詳細設計書や運用 Runbook を別途切り出していく。次回の見直しタイミングでは、各フェーズの進捗／リソースへの影響／ドメイン運用状況をレビューする。
