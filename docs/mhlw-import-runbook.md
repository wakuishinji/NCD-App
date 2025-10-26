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

## 3. CSV から整形データ生成
`scripts/importMhlwFacilities.mjs` を実行し、施設辞書を作成。病院／診療所をまとめる場合は `--file` を複数指定します。
```bash
node scripts/importMhlwFacilities.mjs \
  --file clinic:data/medical-open-data/02-1_clinic_facility_info_20250601.csv.gz \
  --file hospital:data/medical-open-data/01-1_hospital_facility_info_20250601.csv.gz \
  --schedule clinic:data/medical-open-data/02-2_clinic_speciality_hours_20250601.csv.gz \
  --schedule hospital:data/medical-open-data/01-2_hospital_speciality_hours_20250601.csv.gz \
  --outfile tmp/mhlw-facilities.json
```
- 出力: `{ count, facilities[] }` 形式（各レコードに `facilityType` が含まれる）。
- `--jsonl` を付けると 1 行 1 レコードの JSON Lines に。

## 4. Workers への公開データアップロード
1. 厚労省サイトから取得した 4 つの CSV（病院/診療所の施設票・診療時間票）をそのまま管理画面の「CSV４種をアップロード」から選択し送信するか、従来どおり JSON を生成してアップロードする。
   - CSV をアップロードした場合はブラウザ内で JSON に整形された後、自動的に `/api/admin/mhlw/facilities` へアップロードされ、`mhlw/facilities.json` に保存されます。
2. CLI からアップロードする場合は以下のいずれかを利用。
   ```bash
   # 整形済み JSON をアップロードする例
   node scripts/publishMhlwFacilities.mjs \
     --token "$SYSTEM_ROOT_TOKEN" \
     --json tmp/mhlw-facilities.json \
     --api-base https://ncd-app.altry.workers.dev
   ```
   - `API_BASE` / `SYSTEM_ROOT_TOKEN` を環境変数で設定しておけばオプションは省略可能。
   - 成功すると R2 上に `mhlw/facilities.json` が保存され、`/api/mhlw/facilities` から常時参照できる。
   - 状態確認: `GET /api/mhlw/facilities/meta` を叩くか、管理ハブの厚労省ID同期画面のプレビューに更新時刻が反映されることを確認。

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

---
このRunbookはドラフトです。実際の運用手順が固まり次第、ステップの自動化・テスト整備を進める。
