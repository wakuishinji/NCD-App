# 厚労省医療施設データ 取り込み手順（ドラフト）

## 1. 前提
- 公開データ: 厚生労働省「医療情報ネット」統一公開データセット（CSV / Gzip）。
- 施設ID（医療機関コード）をNCDの `clinic.mhlwFacilityId` として利用。
- ダウンロード先: https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/0000183310.html

## 2. データ取得
1. 最新の ZIP / CSV をダウンロード。
2. リポジトリ直下で以下を実行（例: 病院/診療所の施設票・診療時間票）。
   ```bash
   mkdir -p data/medical-open-data
   cp ~/Downloads/01-1_hospital_facility_info_20250601.csv.gz data/medical-open-data/
   cp ~/Downloads/02-1_clinic_facility_info_20250601.csv.gz data/medical-open-data/
   cp ~/Downloads/01-2_hospital_speciality_hours_20250601.csv.gz data/medical-open-data/
   cp ~/Downloads/02-2_clinic_speciality_hours_20250601.csv.gz data/medical-open-data/
   ```

## 3. CSV → D1 取り込み（推奨ルート）
厚労省データの正本は Cloudflare D1 上の `mhlw_*` テーブルに保管する。`schema/d1/migrations/006_mhlw_reference_tables.sql` を本番・プレビューの両環境に適用済みであることを確認し、以下のスクリプトで取り込む。

```bash
# 本番 DB に全件投入する例（おおよそ 10〜15 分）
node scripts/importMhlwToD1.mjs \
  --db MASTERS_D1 \
  --truncate \
  --execute \
  --batch-size 400 \
  --chunk-size 150

# プレビュー DB で件数を絞り検証する例
node scripts/importMhlwToD1.mjs \
  --db MASTERS_D1 \
  --limit 2000 \
  --execute \
  --batch-size 200
```

- 4種類の CSV（診療所/病院の施設票・診療時間票）を `data/medical-open-data/` に配置しておけば自動検出される。個別に指定したい場合は `--clinic-info` などでパスを上書きする。
- `--batch-size` は1回の `wrangler d1 execute` で扱う施設件数。デフォルト 500。`--chunk-size` は SQL を分割する件数で、バッチ内で 150〜200 程度にしておくと安全。
- `--truncate` を付けると `mhlw_*` テーブルを先に空にしてから upsert を実行する。CSV 全差し替え時は付与、差分更新だけを狙う場合は省略する。
- 失敗したバッチは再実行するだけで良い（`INSERT ... ON CONFLICT` を利用）。ログには実行済みチャンク番号が出るため、必要なら `--limit` / `--skip-clinic` などで切り出してリトライできる。
- 実行後は件数チェックを行う。
  ```bash
  wrangler d1 execute MASTERS_D1 --remote \
    --command "SELECT COUNT(*) AS facilities FROM mhlw_facilities;\n               SELECT COUNT(*) AS schedules FROM mhlw_facility_schedules;"
  ```

## 4. R2 アップロード（旧方式 / バックアップ用途）
管理画面には従来の「CSV → JSON → R2」機能が残っており、バックアップや緊急時に利用できる。通常運用では D1 への直接取り込みを優先する。

1. systemRoot で `/admin/mhlw-sync.html` を開き、「厚労省データアップロード（旧方式）」セクションを表示する。
2. 4種類の CSV を選択してアップロードすると、ブラウザ内で JSON を生成し R2 (`mhlw/facilities.json`) に保存する。完了後はメタ情報が `/api/mhlw/facilities/meta` に反映される。
3. CLI から実行したい場合は `scripts/importMhlwFacilities.mjs` → `scripts/uploadMhlwToR2.mjs` を使用する（従来手順）。

- アップロードが成功しても D1 は更新されないため、最新データを利用するには別途 `scripts/importMhlwToD1.mjs --execute` を実施すること。
- UI のボタンラベルは「CSV４種からJSONを生成してR2へアップロード（旧方式）」としている（バックアップ用である旨を表示）。

## 5. D1 参照テーブルの活用
CLI で取り込んだデータは `mhlw_facilities` および関連テーブルから検索できる。Workers 側の `/api/mhlw/search` エンドポイントは D1 を参照するため、管理画面で候補検索を行うと D1 の値が即時反映される。検索は「都道府県を選択 → 施設名（任意で市区町村）」の順で利用する。

## 6. 既存施設との照合
1. 厚労省ID同期画面（`/admin/mhlw-sync.html`、systemRoot 専用）を開き、診療所を検索。
2. 候補一覧から厚労省データを選び「このIDをセット」を押して登録、必要に応じて「公開データから同期」で住所等を上書き。
   - バッチで処理したい場合は `scripts/syncMhlwFacilities.mjs` を用いて ID 登録＋同期を実行する（`--dry-run` で事前確認可能）。
   - 候補が見つからない場合はカード内の「未掲載として記録」ボタンで `not_found` ステータスと補足メモを保存し、次回データ更新時の見直しリストに移動できる。

## 7. 新規登録フロー
- `POST /api/registerClinic` は `mhlwFacilityId` を必須に変更済み。
- 施設登録画面では厚労省データを検索→選択→登録する導線を用意する（今後実装）。
- 厚労省ID登録後は「厚労省ID同期」画面の「公開データから同期」ボタンで住所・電話等を上書き更新できる。
- 厚労省データ未掲載の新設施設は `not_found` ステータスで登録し、メモに連絡先などの補足を残す。公的データに反映された時点で通常どおり ID を設定する。
- スクリプト例：
  ```bash
  node scripts/syncMhlwFacilities.mjs \
    --token "$SYSTEM_ROOT_TOKEN" \
    --json tmp/mhlw-facilities.json \
    --outfile tmp/mhlw-sync-report.json
  ```

## 8. 更新サイクル
- 公開データは概ね半年ごとに更新。
- 更新のたびに `importMhlwToD1.mjs --truncate --execute` を再実行し、D1 のデータを最新化する（完了後に件数チェック）。
- 新規施設や削除施設をレポート化し、管理者に通知。
- 将来的にSkilBank/Medical Orchestraと同じ施設IDで連携するため、常に最新データを保つ。

## 9. 未対応事項
- 住所マッチングの自動化（類似度計算など）は今後の課題。
- 既存施設との紐付け自動化スクリプト。
- マスター更新ジョブ（Cron等）での定期取り込み。

# 10. 現状メモ（2025-10-31 更新）
- `scripts/importMhlwToD1.mjs --truncate --execute --batch-size 400` で約 8.3 万施設を D1 に投入済み（`mhlw_facilities` 82,840 件、`mhlw_facility_schedules` 約 2,175,000 件）。
- `/api/mhlw/search` は D1 参照に切り替え、管理画面の候補検索は「都道府県必須＋施設名」のフローに更新。未設定と設定済みの診療所を別リストで表示し、設定済みカードには「公開データから同期」「診療所詳細を開く」を常時表示する。
- 厚労省ID登録直後はフロント側でリストを即時更新しており、再読込前でも設定済みリストに移動する。同期ボタン実行後はローカルキャッシュも更新する。
- 厚労省データ未掲載と判断した施設は `not_found` として登録でき、管理画面では「未掲載扱い」リストに集約される。メモ欄は手動登録理由や進捗を共有する用途で利用。
- 厚労省 CSV に含まれるカラムのみ同期しているため、電話番号・FAX などが欠落している施設はそのままになる。国データに無い項目は別ソース（R2 旧JSONや医療機関入力値）と突き合わせる仕組みを後日検討する。
- GUI の旧方式（CSV→R2 アップロード）はバックアップ用途として残しつつ、通常運用は D1 直取り込みを前提とする。
- 住所・名称ゆらぎの自動解決は未着手。`scripts/syncMhlwFacilities.mjs` の改修と併せて検討する。

### 作業ログ（2025-10-26）
- 厚労省同期画面の「CSV４種からJSONを生成してR2へアップロード」フローが完成。browser-side で CSV を正規化 → JSON 生成 → R2 multipart upload → メタ更新まで通しで確認。
- `.csv.gz` は `DecompressionStream`（Chromium）と `fflate` フォールバック（Safari/Firefox 向け）で解凍。非対応ブラウザはエラーメッセージで事前解凍を促す。
- CLI フォールバック (`scripts/importMhlwFacilities.mjs` + `scripts/uploadMhlwToR2.mjs`) は引き続き利用可能。アップロード後に `refreshMeta` を呼ぶため、UI 側の最新情報表示とも整合。
- Workers 側が multipart 非対応の場合は、ブラウザ内で生成した JSON を gzip 圧縮して単一 PUT するフォールバックを実装。`Content-Encoding: gzip` を許可する CORS 設定も追加済み。
- R2 から取得する公開 JSON も gzip で配信されるようになったため、管理画面では自動伸長→プレビュー表示まで対応。初回ロードで 404（未アップロード）時のみ従来メッセージを表示する。
- 現状の課題：API 経由で取得した gzip JSON のプレビューが環境によって表示されないケースがある（ブラウザ側での伸長は成功ログまで出力される）。リロード時に `console` へ伸長結果と件数は出力されるため、データ取得自体は完了している。描画ロジックの改善とメモリ消費の検証が次ステップ。

---
このRunbookはドラフトです。実際の運用手順が固まり次第、ステップの自動化・テスト整備を進める。
