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

## 4. 既存施設との照合
1. `tmp/mhlw-facilities.json` を読み込み、`clinic.mhlwFacilityId` が未設定の施設を名称・住所でマッチング。
2. 管理ハブ → 「厚労省ID同期」画面（systemRoot専用）で診療所を検索し、厚労省IDを貼り付けて登録。
   - 旧来のAPI操作でも `POST /api/updateClinic` に `mhlwFacilityId` を指定すれば同等の更新が可能。
   - まとめて処理する場合は `scripts/syncMhlwFacilities.mjs` を実行すると自動でID登録＋同期が行えます（`--dry-run` オプションで事前確認）。

## 5. 新規登録フロー
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

## 6. 更新サイクル
- 公開データは概ね半年ごとに更新。
- 更新のたびに `importMhlwFacilities.mjs` を再実行し差分を抽出。
- 新規施設や削除施設をレポート化し、管理者に通知。
- 将来的にSkilBank/Medical Orchestraと同じ施設IDで連携するため、常に最新データを保つ。

## 7. 未対応事項
- 住所マッチングの自動化（類似度計算など）は今後の課題。
- 既存施設との紐付け自動化スクリプト。
- マスター更新ジョブ（Cron等）での定期取り込み。

---
このRunbookはドラフトです。実際の運用手順が固まり次第、ステップの自動化・テスト整備を進める。
