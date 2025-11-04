# マスターデータ消失に関する現状整理 (2025-11-04)

## 0. 更新メモ（2025-11-04 09:35 JST）

- `tmp/masters-export.json` に残っていたバックアップを利用し、`master_items` / `master_categories` / `master_item_aliases` を Cloudflare D1 へ再投入した。手順は [5. 復旧結果](#5-復旧結果-2025-11-04) を参照。
- 現在は全マスター種別が復旧済み。管理画面の一覧表示や API レスポンスでも項目が戻っていることを確認した。

## 1. 症状

- （復旧前の状態）予防接種・健診を含む `master_items` のうち、`type='department'` 以外が空になっている。  
  - D1 確認結果 → `SELECT type, COUNT(*) FROM master_items GROUP BY type;`  
    - department: 33 件  
    - vaccination: 0 件（2025-11-03 23:30 JST 時点。テスト投入済み行は削除済）
- 管理画面（例: 予防接種マスター管理）で CSV を取り込んでも一覧に表示されない。
- 削除操作を行うと 404 (`対象が見つかりません`) が返却されるケースがある。

## 2. 原因（現時点の推測）

1. **D1 移行後に他のマスターを投入しないままになっていた**
   - 過去に `scripts/migrateMastersToD1.mjs` を実行したのは診療科マスターのみで、予防接種・健診等が D1 に存在しない状態だった可能性が高い。
2. **KV 側にもバックアップが残っていない**
   - `wrangler kv key list --binding SETTINGS --prefix master:vaccination` などを実行したが該当キーなし。  
   - 旧構成で利用していた KV のデータが消えているため、Workers 側のフォールバックも機能しない。
3. **UI からの削除が失敗した理由**
   - テストで D1 に直接挿入したレコード（KV 未登録）を UI 経由で削除しようとすると、`getMasterRecordByLegacy` がレコードを見つけられず 404 を返す。

## 3. 復旧に向けた方針

1. **ソースデータの調達**
   - 既存のバックアップ（`masters-export.json` など）があれば、`scripts/migrateMastersToD1.mjs` を使って再投入する。
   - バックアップが無い場合は、管理画面から CSV を出力して再投入する（環境が残っている場合はプレビュー／別環境で CSV を生成）。
2. **投入手順例**
   ```bash
   # 予防接種マスターの例 (dataset JSON から一括投入)
   node scripts/migrateMastersToD1.mjs \
     --dataset tmp/vaccination-master.json \
     --db MASTERS_D1 \
     --chunk-size 200 \
     --truncate \
     --remote
   ```
   - CSV しかない場合は管理画面の「CSV取込」機能から登録する。
   - D1 に直接 SQL を流す場合は、Workers 側で KV を参照できなくなるので避ける。
3. **再発防止策**
   - D1 を初期化する操作を実施する際は、対象 `type` を明示する。  
     例: `DELETE FROM master_items WHERE type='department';` のように対象を限定する。
   - 作業前後で `wrangler d1 backup` または `scripts/exportMastersFromApi.mjs` によるバックアップを取得する。
   - 本番／プレビューのバインドが期待どおりか再確認する（`wrangler.toml`）。

## 4. 今後のタスク

1. バックアップソースの有無を確認し、予防接種・健診など全マスターを再投入する。
2. 作業後に `SELECT type, COUNT(*) FROM master_items GROUP BY type;` を実行し、件数を記録する。
3. 必要に応じて `master_categories` も再作成する（例: `vaccinationType` が空の場合）。
4. 復旧完了後、本ドキュメントを更新して最終状態を残す。

## 5. 復旧結果 (2025-11-04)

1. バックアップ JSON から SQL を生成
   ```bash
   node scripts/migrateMastersToD1.mjs \
     --dataset tmp/masters-export.json \
     --truncate \
     --dry-run \
     --output tmp/master-restore.sql
   ```
2. 生成した SQL を D1 へ反映
   ```bash
   wrangler d1 execute MASTERS_D1 \
     --remote \
     --yes \
     --file tmp/master-restore.sql
   ```
3. D1 件数確認（2025-11-04 09:35 JST）
   ```text
   SELECT type, COUNT(*) FROM master_items GROUP BY type ORDER BY type;
   ```
   | type         | count |
   |--------------|-------|
   | bodySite     | 32    |
   | checkup      | 21    |
   | department   | 52    |
   | facility     | 6     |
   | qual         | 44    |
   | service      | 33    |
   | society      | 85    |
   | symptom      | 25    |
   | test         | 96    |
   | vaccination  | 40    |

   ```text
   SELECT type, COUNT(*) FROM master_categories GROUP BY type ORDER BY type;
   ```
   | type             | count |
   |------------------|-------|
   | bodySite         | 10    |
   | checkupType      | 4     |
   | department       | 12    |
   | facility         | 3     |
   | qual             | 28    |
   | service          | 20    |
   | symptom          | 13    |
   | test             | 17    |
   | vaccinationType  | 25    |

4. `tmp/master-restore.sql` を残しているため、再投入が必要になった場合は同ファイルを `wrangler d1 execute --file` で実行すれば再現できる。
