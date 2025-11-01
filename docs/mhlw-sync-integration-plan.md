# MHLW データ自動反映メモ

最終更新: 2025-10-31  
作成者: Codex

---

## 1. 背景と目的

- 厚生労働省が公開している医療機関 CSV から、施設基本情報・標榜診療科・診療時間などを NCD データベースへ取り込み済み（`mhlw_*` テーブル）。
- 現状の同期処理 (`applyMhlwDataToClinic`) は、所在地や電話番号など一部の基本項目のみ `clinic` レコードへ反映している。
- 管理 UI でユーザーが編集する既存の項目（標榜診療科、診療時間、施設属性など）へも厚労省データを自動反映させ、入力作業を最小化することが目的。
- 厚労省に存在しない項目については、従来どおり手入力または別ソースで補完する。

---

## 2. 厚労省データ構造の整理

Cloudflare D1 では以下のテーブルに格納されている。

| テーブル | 主な内容 | 備考 |
|----------|----------|------|
| `mhlw_facilities` | 施設基本情報（名称、住所、電話、URL、種別など） | `facility_id` が主キー |
| `mhlw_facility_departments` | 診療科（標榜科） | `department_code`、`name` |
| `mhlw_facility_schedules` | 診療日・診療時間・診療科ごとの受付時間 | `day_of_week`、`start_time` 等 |
| `mhlw_facility_beds` | 病床数（種別ごと） | 長期療養、精神等 |
| `mhlw_facility_modes` など | 将来的な拡張候補（現状未使用） | |

公開 CSV 由来のフィールド一覧は `schema/d1/schema.sql` と `scripts/importMhlwFacilities.mjs` を参照。

---

## 3. 既存 NCD フィールドとのマッピング案

| 厚労省データ項目 | 反映先 (NCD フィールド案) | 方針 |
|-------------------|----------------------------|------|
| 施設ID (`facility_id`) | `clinic.mhlwFacilityId` | 既存通り（必須） |
| 公式名称 (`officialName`) | `clinic.officialName`（新規） | 厚労省の公式名称をそのまま保持し、表示名と分離する |
| 略称 (`shortName`) | `clinic.name`, `clinic.shortName`, `clinic.displayName`（検討） | 表示名を略称で初期化し、UI 表示用に `displayName` を新設する案も検討 |
| 住所・郵便番号・電話 | `clinic.address` / `clinic.postalCode` / `clinic.phone` | 未入力時は自動補完。手入力値がある場合の上書き方針を決める（例: 初回のみ自動反映、以降は差分確認） |
| 種別 (`facility_type`) | `clinic.facilityType` | 診療所 / 病院などへ正規化 |
| 標榜診療科 (`mhlw_facility_departments`) | `clinic.departments`（構造を見直し） | マスター登録済み名称へマッピングし、自動追加（未登録はレビュー待ちリストへ） |
| 診療時間 (`mhlw_facility_schedules`) | 新 schedule モデル（例: `clinic.availability`） | 曜日・時間帯・診療科を保持できる構造へ更新し、既存 UI/編集機能も対応させる |
| 休診日 (`weeklyClosedDays` / `periodicClosedDays`) | `clinic.mhlwWeeklyClosedDays` / `clinic.mhlwPeriodicClosedDays`（新設） | UI でも表示・編集できるよう専用フィールドを追加 |
| 病床数 (`mhlw_facility_beds`) | `clinic.mhlwBedCounts`（新設） | 種別ごとの病床数を保持し、病院向けに表示 |
| 公式サイト URL | `clinic.links.homepage` | 未設定なら厚労省値で補完 |
| 緯度・経度 | `clinic.location.lat/lng` + `clinic.location.source` | `source = 'mhlw'` として保存。手動位置調整の余地を残す |
| 備考・メモ | `clinic.mhlwManualNote` | 未掲載判定や補足メモを保持し、UI 表示も継続 |

> **マッピング時の注意点**
> - 手動で修正済みのデータを再同期で上書きするかどうかを施設ごとに制御する必要がある（例: `overwrite` フラグ、または差分比較 UI）。
> - マスターに存在しない診療科名や診療時間書式に対応するため、正規化ルールとエラーログを用意する。

---

## 4. 実装方針（ドラフト）

1. **同期処理の拡張**
   - `applyMhlwDataToClinic` を拡張し、診療科・診療時間・病床などを変換するユーティリティを追加。
   - 診療科のマッピングでは、`mhlw_facility_departments.name` を既存マスターの `normalized_name` と突合し、未マッチは手動確認用に別リストへ出力。
   - 診療時間は曜日・診療科単位で集約し、`clinic.schedule` の構造（`dayOfWeek`, `startTime`, `endTime`, `department` 等）に合わせる。
   - 厚労省に由来する更新であることを `clinic.mhlwSyncStatus` や `clinic.sources` といったメタ情報に記録し、後から差分が把握できるようにする。

2. **同期モードの設計**
   - 初回同期：厚労省データを丸ごと取り込み、空欄を自動補完。
   - 再同期：手動で編集済みの項目は保持しつつ、厚労省データも閲覧できるよう差分を提示。
   - 自動上書きの判定には `clinic.mhlwSyncStatus`（`linked`, `manual`, `not_found` など）と `clinic.updated_at` を利用。

3. **UI 更新**
   - `clinicDetail.html` の「標榜診療科」「診療時間」セクションに厚労省からの自動反映結果が表示されるようにする（既存の編集 UI にも反映）。
   - 厚労省データの生見せカードは、差分確認・情報源の確認用として最小限に留めるか、必要に応じて折りたたみ表示に変更。

4. **データ整合性**
   - 既存施設で厚労省に存在しない診療科・診療時間は、上書きされないようガードする。
   - 厚労省に新設された診療科がマスターに無い場合の登録フロー（自動仮登録 or レビュー待ち）を決める。

5. **ログ・レポート**
   - 同期時にマッピングできなかった項目（例: 未知の診療科名）をレポートし、管理者が追従マスターを整備できるようにする。
   - `scripts/syncMhlwFacilities.mjs` で差分サマリを出力し、バッチ処理後に確認可能にする。

---

## 5. 次のステップ

1. **要件合意**
   - 上記マッピングと同期モードについて和久井さんと確認し、優先順位と上書きルールを決定。

2. **技術調査**
   - 既存 `clinic.schedule` のフォーマット、`clinic.services` / `clinic.departments` の構造を再確認し、厚労省データをどう正規化するか詳細設計。
   - マスター（診療科、診療メニュー）の正規化関数／マッピングテーブルの有無を調査。

3. **実装計画の策定**
   - `functions/index.js` の同期処理改修、`scripts` の差分出力追加、UI 連携の改修など作業単位に分割。
   - 必要であればマイグレーション（新フィールド追加）を `schema/d1` と KV に対して準備。

4. **段階的導入**
   - まずは自動補完のみ実装し、再同期や上書き条件はステップを分けて検証。
   - テスト用施設で同期 → UI 表示 → 差分確認 → 問題無ければ全体へ展開。

### 4.2 同期処理詳細設計（たたき台）

1. **データ取得**
   - `mhlw_facilities` / `mhlw_facility_departments` / `mhlw_facility_schedules` などを施設ID単位で読み取り、変換用 DTO（`mhlwProfile`）を生成。
   - 施設 ID が一致しない場合は `not_found` ログを出力し、既存データを保持する。

2. **フィールド変換**
   - **基本情報**: 公式名称・略称・住所・連絡先を `officialName` / `name` / `address` 等へマッピング。既存値がある場合は、厚労省値と異なる場合に差分を記録。
   - **診療科**: マスター名称へ正規化する `mapDepartments(mhlwDepartments)` を用意し、結果を `clinic.departments.master` へ格納。未マッチ名称は `clinic.pendingDepartments` に蓄積。
   - **診療時間**: `combineSchedules(mhlwSchedules)` で曜日×時間帯の配列を生成。診療科別の時間帯を保持できる新フォーマット `clinic.availability` を導入し、既存 `clinic.schedule` からは段階的に移行。
   - **休診日**: `weeklyClosedDays` / `periodicClosedDays` を `clinic.mhlwWeeklyClosedDays` / `clinic.mhlwPeriodicClosedDays` へ格納し、人間可読のフォーマットも併せて保存。
   - **病床数**: `facility_beds` の数値を `clinic.mhlwBedCounts`（ラベル付きオブジェクト）へ変換。
   - **位置情報**: 緯度経度を `clinic.location` に反映し、`source: 'mhlw'` と `syncedAt` を付与。既に手動調整済みの場合は上書き可否ルールを定義。

3. **差分と上書き方針**
   - 施設ごとに `overridePolicy` を保持（例: `auto`, `manual`, `locked`）。`auto` の場合のみ厚労省値で上書き。それ以外は差分を `clinic.mhlwDiff` として記録。
   - 差分は UI で確認できるようにし、必要なら個別に「厚労省の値を採用」ボタンを用意。

4. **トランザクション / 保存**
   - KV / D1 双方へ同一の正規化結果を保存。D1 では `facilities.metadata` を更新し、KV 側は `clinic:id:{uuid}` を上書き。
   - 同期後に `mhlwSyncStatus = 'linked'` に更新し、同期日時を `clinic.mhlwSnapshot.syncedAt` として記録。

5. **ログとレポート**
   - 未マッピング診療科、スケジュール変換に失敗したレコード、位置情報差異などを集計し、管理者が確認できるよう `scripts/syncMhlwFacilities.mjs` で JSON / CSV 出力する。
   - エラー時は `mhlwSyncStatus = 'manual'` に変更し、手動対応が必要であることを表示。

### 4.3 新規施設登録フローへの転用

1. **検索ステップの共通化**
   - 「施設名称検索」「地図から検索」の両方で厚労省データを引き当てるコンポーネントを用意し、既存施設同期と同じ DTO／正規化ロジックを再利用する。
   - 検索結果に厚労省施設が存在しない場合は「厚労省データに登録がありません」と明示し、手入力フォームへ遷移。

2. **新規登録時の自動反映フロー**
   - 施設選択 → 正規化 → `clinic` 草稿レコード生成 → 画面側で各項目を確認・編集 → 保存、というステップをワンフローで実現。
   - 保存後は既存と同じ `applyMhlwDataToClinic`（または共通モジュール）で厚労省データを反映し、`mhlwSyncStatus = 'linked'` で初期化。

3. **Google マップ連携の前提整備**
   - 厚労省データから緯度経度を取得できた施設は `clinic.location.source = 'mhlw'` として保持し、地図で「登録済み」「未登録」を色分け表示できるよう `clinic.mhlwSyncStatus` を利用する。
   - 管理画面の地図ビューでは自治体（例: 中野区）単位で施設を表示し、未登録スポットのピンから直接登録フローへ遷移できる UI を想定。

4. **公開検索への展開**
   - 管理用の地図検索ロジックを将来的な患者向け施設検索に流用できるよう、API レスポンス形式（施設座標・ステータス・基本情報）を共通化する。
   - 厚労省に存在しない施設も検索対象として登録されるよう、内部 ID を基準にして厚労省 ID は存在すれば追加情報として扱う。


### 4.1 スキーマ変更案（ドラフト）

| フィールド | KV (`clinic` JSON) | D1 (`facilities` テーブル) | 備考 |
|------------|--------------------|-----------------------------|------|
| `officialName` | 追加 (`clinic.officialName`) | `facilities.metadata`（JSON 内） | 厚労省の公式名称を保持。マスター表示では略称と切替可能にする |
| `displayName` | 追加（任意） | 同上 | UI 表示用の名称。未設定時は `name` を使用 |
| `name` / `shortName` | 既存 | `facilities.name` / `short_name` | 厚労省略称で初期化し、編集可 |
| `mhlwFacilityId` | 既存 | `facilities.external_id` | 変わらず |
| `mhlwWeeklyClosedDays` | 追加 | `facilities.metadata` | `weeklyClosedDays` を人間可読にするためのフィールド |
| `mhlwPeriodicClosedDays` | 追加 | `facilities.metadata` | 同上 |
| `mhlwBedCounts` | 追加 | `facilities.metadata` / `facility_beds` | 病床情報。必要に応じて UI 表示 |
| `mhlwSyncStatus` | 既存（`clinic.mhlwSyncStatus`） | `facilities.metadata` | `linked` / `pending` / `manual` / `not_found` を保持 |
| `mhlwSnapshot` | 既存 | `facilities.metadata` | 厚労省生データ（履歴・デバッグ用） |
| `schedule` | `clinic.schedule` | `facility_schedule` | 構造を `{"day": 0, "start": "09:00", "end": "12:00", "department": "内科" ...}` のように正規化 |
| `departments` | `clinic.departments.master` 等 | `facilities.metadata` | 厚労省標榜科をマスターへマッピング。未マッチは `pendingDepartments` などで保持 |
| `links.homepage` | 既存 | `facilities.metadata` | 未設定時は厚労省 URL を反映 |
| `location` | 既存 | `facilities.metadata` | `source: 'mhlw'` を追記し、手動更新との区別を明確にする |

- D1 `facilities` テーブルに直接カラムを増やす案もあるが、既存構造との互換を考慮して JSON (`metadata`) 側へ格納し、必要に応じて正規化テーブル（`facility_beds` など）を利用する。
- KV 側は `clinic:id:{uuid}` の JSON を更新。既存 15 件のテストデータはマイグレーションスクリプトで `officialName` などを補完する。

---

## 6. 参考リンク

- `schema/d1/schema.sql` … 厚労省データ関連テーブル定義。
- `scripts/importMhlwFacilities.mjs` … CSV から D1 へのデータ取り込みロジック。
- `functions/index.js` → `applyMhlwDataToClinic` … 現在の同期処理。
- `web/js/mhlwSync.js` / `web/admin/mhlw-sync.html` … 管理画面の厚労省同期 UI。

---

### メモ

- 厚労省に存在しない施設は `mhlwSyncStatus = not_found` として維持し、手動入力値を尊重する。
- 厚労省に存在するが NCD に無い診療科をどう扱うか（自動追加 or 管理者承認）を別途決める必要がある。
- 厚労省データのバージョン管理（年度や公開日）を記録し、再同期時の比較に利用できるとよい。

---

## 7. 実装タスク分解（初期案）

1. **データモデリング**
   - KV / D1 スキーマ更新（`officialName`、`displayName`、`mhlwWeeklyClosedDays` 等の追加、および schedule 正規化）。
   - 既存テストデータへのマイグレーションスクリプト作成（厚労省項目の初期化）。
   - `mhlwSyncStatus` / `location.source` など将来の地図表示で必要なメタ情報の整備。

2. **同期ロジック実装**
   - 厚労省データ → DTO → `clinic` 反映までの共通モジュール化（既存施設同期・新規登録で再利用）。
   - `applyMhlwDataToClinic` のリファクタリング：フィールドマッピング、override policy、差分計算、失敗時のフォールバック。
   - マスター突合用ユーティリティ（診療科・診療時間）と未マッチ項目のキューイング仕組み。

3. **スクリプト / バッチ**
   - `scripts/syncMhlwFacilities.mjs` の改修（新フィールド対応、差分レポート出力）。
   - 厚労省に未掲載の施設一覧、未マッピング診療科一覧などのレポート生成。

4. **UI/UX 改修**
   - 厚労省同期画面：検索コンポーネント共通化、差分表示、未掲載メッセージ表示。
   - 施設詳細画面：正式名称・休診日・病床数等の表示、差分の注記、厚労省データ由来かどうかの表示。
   - 新規施設登録ウィザード：名称検索＋地図検索の導線、厚労省データの自動反映、手入力フローとの切り替え。

5. **位置情報と地図**
   - 施設一覧 API に緯度経度と `mhlwSyncStatus` を含め、地図上で登録済／未登録を色分けできるようにする。
   - 管理画面地図ビューのプロトタイプ実装（自治体フィルター、未登録ピンから登録フローへ遷移）。

6. **テスト**
   - データマッピング単体テスト（診療科、診療時間、病床数、休診日）。
   - 厚労省同期→施設詳細→差分確認の統合テスト。
   - 新規施設登録フロー（検索〜保存）E2E テスト。

7. **リリース計画**
   - ステージングでの検証とフィードバック収集。
   - 部分ロールアウト（特定自治体のみ）→ 全体展開。
   - ロールバック手順と監視（同期エラー、マッピング失敗など）の整備。
