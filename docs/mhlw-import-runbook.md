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

## 3. 管理画面からの CSV → JSON → R2 アップロード（推奨）
1. systemRoot で `/admin/mhlw-sync.html` を開き、「厚労省データアップロード」セクションを表示する。
2. 病院・診療所それぞれの施設票 / 診療時間票（計4ファイル、`.csv` / `.csv.gz` 可）を指定欄へドラッグ＆ドロップ、またはファイル選択する。
3. 「CSV４種からJSONを生成してR2へアップロード」をクリックすると、ブラウザ内で CSV を整形し JSON を生成。Shift_JIS 圧縮ファイルは `DecompressionStream` または `fflate` フォールバックで自動解凍する（未対応ブラウザでは「CSV を解凍してください」というエラーを表示）。
4. 変換された JSON はマルチパートで R2 (`mhlw/facilities.json`) に直接アップロードされ、完了時に Workers 側 `completeUpload` がメタ情報 (`/api/mhlw/facilities/meta`) を更新する。
5. 完了後はアップロードステータスが成功表示に変わり、プレビューと最新更新日時が自動でリロードされる。必要に応じて「情報更新」ボタンで再取得可能。

- アップロード中は進捗メッセージ（施設票／診療時間票の処理行数、チャンク番号）が表示される。
- ブラウザが gzip 解凍に対応していない場合はエラーメッセージを表示し、事前解凍または別ブラウザでの操作を案内する。

## 4. CLI フォールバック（手動で JSON を生成する場合）
グラフィカルなアップロードが難しい場合は、従来通り CLI で JSON を生成 → R2 へ配置する。

```bash
node scripts/importMhlwFacilities.mjs \
  --file clinic:data/medical-open-data/02-1_clinic_facility_info_20250601.csv.gz \
  --file hospital:data/medical-open-data/01-1_hospital_facility_info_20250601.csv.gz \
  --schedule clinic:data/medical-open-data/02-2_clinic_speciality_hours_20250601.csv.gz \
  --schedule hospital:data/medical-open-data/01-2_hospital_speciality_hours_20250601.csv.gz \
  --outfile tmp/mhlw-facilities.json

export SYSTEM_ROOT_TOKEN="{systemRoot の Bearer トークン}" # または --token で指定

node scripts/uploadMhlwToR2.mjs \
  --json tmp/mhlw-facilities.json \
  --api-base https://ncd-app.altry.workers.dev
```
- 出力される JSON は `{ count, facilities[] }` 形式（各レコードに `facilityType` / `scheduleEntries` を含む）。
- `--jsonl` オプションで JSON Lines にも対応。
- `--gzip` を付けると JSON を圧縮してからアップロード（`Content-Encoding: gzip`）。
- スクリプトはアップロード完了後に `POST /api/admin/mhlw/refreshMeta` を実行し、メタ情報を即時更新する。

## 5. 既存施設との照合
1. 厚労省ID同期画面（`/admin/mhlw-sync.html`、systemRoot 専用）を開き、診療所を検索。
2. 候補一覧から厚労省データを選び「このIDをセット」を押して登録、必要に応じて「公開データから同期」で住所等を上書き。
   - バッチで処理したい場合は `scripts/syncMhlwFacilities.mjs` を用いて ID 登録＋同期を実行する（`--dry-run` で事前確認可能）。

## 6. 新規登録フロー
- `POST /api/registerClinic` は `mhlwFacilityId` を必須に変更済み。
- 施設登録画面では厚労省データを検索→選択→登録する導線を用意する（今後実装）。
- 厚労省ID登録後は「厚労省ID同期」画面の「公開データから同期」ボタンで住所・電話等を上書き更新できる。
- 厚労省データ未掲載の新設施設は一時的に `pending` 状態で登録し、次回公開データ更新時にIDを確定。
- スクリプト例：
  ```bash
  node scripts/syncMhlwFacilities.mjs \
    --token "$SYSTEM_ROOT_TOKEN" \
    --json tmp/mhlw-facilities.json \
    --outfile tmp/mhlw-sync-report.json
  ```

## 7. 更新サイクル
- 公開データは概ね半年ごとに更新。
- 更新のたびに `importMhlwFacilities.mjs` を再実行し差分を抽出。
- 新規施設や削除施設をレポート化し、管理者に通知。
- 将来的にSkilBank/Medical Orchestraと同じ施設IDで連携するため、常に最新データを保つ。

## 8. 未対応事項
- 住所マッチングの自動化（類似度計算など）は今後の課題。
- 既存施設との紐付け自動化スクリプト。
- マスター更新ジョブ（Cron等）での定期取り込み。

## 9. 現状メモ（2025-10-26）
- `scripts/importMhlwFacilities.mjs --jsonl` で診療所・病院の施設票/診療時間票を統合し `tmp/mhlw-facilities.json` を生成済み（R2 へ upload 済み）。
- `scripts/syncMhlwFacilities.mjs` を `--token` 付きで実行したが、中野区の既存17件はすべて `noMatch`。名称・住所の揺らぎが大きく、自動マッチングが成立していない。
- 厚労省IDの入力は GUI `/admin/mhlw-sync.html` で実施する想定。ただし本番デプロイ前のためローカル/Preview での確認が必要。
- 今後は GUI 上で厚労省データの候補を提示できるよう改修し、手動コピペの負担を減らす。
- 未一致施設は当面手動でID付与（Runbookの「厚労省ID同期」画面を利用）し、公開データ更新時に再同期する運用。

### 作業ログ（2025-10-26）
- 厚労省同期画面の「CSV４種からJSONを生成してR2へアップロード」フローが完成。browser-side で CSV を正規化 → JSON 生成 → R2 multipart upload → メタ更新まで通しで確認。
- `.csv.gz` は `DecompressionStream`（Chromium）と `fflate` フォールバック（Safari/Firefox 向け）で解凍。非対応ブラウザはエラーメッセージで事前解凍を促す。
- CLI フォールバック (`scripts/importMhlwFacilities.mjs` + `scripts/uploadMhlwToR2.mjs`) は引き続き利用可能。アップロード後に `refreshMeta` を呼ぶため、UI 側の最新情報表示とも整合。

---
このRunbookはドラフトです。実際の運用手順が固まり次第、ステップの自動化・テスト整備を進める。
