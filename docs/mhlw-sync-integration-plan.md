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
| 略称 (`shortName`) | `clinic.name` / `clinic.shortName` | 既存の `clinic.name` を表示名（略称）として利用し、厚労省の略称で初期化する |
| 住所・郵便番号・電話 | `clinic.address` / `clinic.postalCode` / `clinic.phone` | 未入力時は自動補完。手入力値がある場合の上書き方針を決める（例: 初回のみ自動反映、以降は差分確認） |
| 種別 (`facility_type`) | `clinic.facilityType` | 診療所 / 病院などへ正規化 |
| 標榜診療科 (`mhlw_facility_departments`) | `clinic.departments`（構造を見直し） | マスター登録済み名称へマッピングし、自動追加（未登録はレビュー待ちリストへ） |
| 診療時間 (`mhlw_facility_schedules`) | `clinic.schedule` | 曜日ごと＋診療科ごとに集約し、既存 schedule 形式へ変換（構造変更も検討） |
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
