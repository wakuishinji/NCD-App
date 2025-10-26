# 医療オープンデータの取得手順

公開元: 厚生労働省「医療情報ネット」統一公開データセット。

## 1. ダウンロード
以下の URL から最新アーカイブを取得します。
- 施設基本情報 ZIP: https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/0000183310.html
- 診療科・時間 CSV: 同ページに掲載

## 2. 配置場所
ダウンロードした ZIP を `data/medical-open-data/` に置き、解凍してから使用してください。

```bash
mkdir -p data/medical-open-data
cp ~/Downloads/01-1_hospital_facility_info_*.zip data/medical-open-data/
cp ~/Downloads/02-1_clinic_facility_info_*.zip data/medical-open-data/
cp ~/Downloads/01-2_hospital_speciality_hours_*.zip data/medical-open-data/
cp ~/Downloads/02-2_clinic_speciality_hours_*.zip data/medical-open-data/

# 解凍
unzip -d data/medical-open-data data/medical-open-data/01-1_hospital_facility_info_*.zip
unzip -d data/medical-open-data data/medical-open-data/02-1_clinic_facility_info_*.zip
unzip -d data/medical-open-data data/medical-open-data/01-2_hospital_speciality_hours_*.zip
unzip -d data/medical-open-data data/medical-open-data/02-2_clinic_speciality_hours_*.zip
```

## 3. Git へのコミット禁止
`.gitignore` で `data/medical-open-data/*` を除外しています。誤ってコミットしないように `git status` で確認してください。

## 4. 更新タイミング
厚労省の公開ペース（概ね半年ごと）に合わせ、最新データをダウンロードして差し替えます。差分取り込み手順は `scripts/` フォルダのマイグレーションスクリプトに従ってください。
