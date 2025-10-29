# KV バックアップと整理運用ポリシー

2025-10-xx 版（ドラフト）。Cloudflare Workers 環境で KV を正しく保守するためのルールをまとめる。

## 1. 目的とスコープ
- D1 移行後のマスターデータ運用では D1 を正本とし、KV は設定値やキャッシュなど補助用途に限定する。
- 本書は `SETTINGS` バインディングおよび従来の `master:*` / `mastercache:*` など、既存 KV キーの取り扱いを定義する。
- KV の整理・削除は必ず QA → 本番 の順に実施し、Runbook に従ってログを残す。

## 2. カテゴリ分類
| 種別 | 例 | 方針 |
|------|----|------|
| **設定・機微情報** | `SETTINGS system-root`, API キー、メール送信設定 | 引き続き KV に保存。Git へは持ち出さず、`wrangler kv:key put/get` の操作履歴を Runbook に記録する。 |
| **キャッシュ／派生データ** | `mastercache:*`, `clinic:summary:*`, 施設スキル集計等 | TTL を設定するか、再生成フラグを持たせて自動失効させる。移行後に不要と判断したキーはバックアップ後に削除。 |
| **レガシー正本データ** | `master:*`, 旧 `clinic:*` | D1 へ移行済み。削除前に JSON ダンプを R2 へ保存し、整合性チェックを完了させてから削除する。 |

## 3. バックアップ手順
1. **マスター系エクスポート**  
   - `scripts/exportMastersFromApi.mjs` で D1 と同内容の JSON を生成し、`tmp/masters-export.json` を確認する。  
   - 同ファイルを `wrangler r2 object put` で R2（例: `ncd-clinic-media/backups/masters/YYYYMMDD.json`）へアップロード。  
   - R2 側では最低 14 日分は保持し、削除時は監査ログへ記録する。
2. **設定系バックアップ**  
   - 対象キーをリストアップ (`wrangler kv:key list --binding SETTINGS --prefix ...`) し、`wrangler kv:key get` で JSON を取得。  
   - 出力は暗号化ストレージまたは 1Password などに保存し、復旧手順 (import コマンド) を併記する。  
   - 機微情報を含むため Git には保存しない。
3. **キャッシュ系バックアップ（任意）**  
   - 原則バックアップ不要。調査目的で一時的に保存する場合は TTL 付きで R2 へアップロードし、調査完了後に削除する。
4. **クリニック KV のバックアップ**  
   - `node scripts/exportLegacyClinicsKv.mjs --binding SETTINGS --prefix clinic:id: --output tmp/clinic-kv-backup.json` を実行し、旧 KV レコードを一括取得する。  
   - `--dry-run` で対象数を把握し、`--delete` オプションは QA 環境で挙動を確認してから本番で利用する。  
   - 生成された JSON は暗号化ストレージまたは R2 (`backups/kv/clinics/`) に保存し、格納先・実行者・実行日時をログに残す。

## 4. 整合性チェック
- `node scripts/verifyMastersInD1.mjs --dataset tmp/masters-export.json --db MASTERS_D1` を実行し、D1 と JSON の件数差分がないことを確認する。
- 差分が出た場合は KV 側の値を直接削除せず、原因調査を行ってから再エクスポート・再投入を実施する。
- 施設・スタッフ等、マスター以外のデータも整合性チェック用スクリプトを整備し、削除前に実行する。

## 5. クリーンアップ手順
1. **対象キーの洗い出し**  
   - `rg "mastercache"` や `rg "master:" functions/` で Workers コード内の参照を確認し、削除後に影響がないかを洗う。  
   - `wrangler kv:key list --prefix master:` などで実際のキー一覧を取得し、対象リストを作成する。
2. **R2 への退避**  
   - 削除対象を `wrangler kv:key get` でまとめて取得し、`backups/kv/<prefix>/<timestamp>.json` として R2 へアップロード。  
   - 退避操作は日時／担当者を Slack などへ共有し、ログを残す。
3. **削除実行（QA → 本番）**  
   - QA 環境で `wrangler kv:key delete` を実行し、アプリケーションが問題なく動作するか確認する。  
   - 問題なければ本番でも同手順を実施し、削除完了後に `wrangler kv:key list` で空になったことを確認する。  
   - 必要に応じて `wrangler kv:namespace delete` ではなくキー単位の削除を行う（`SETTINGS` は共有用途のため）。
4. **コード整備**  
   - KV を参照していた箇所は D1 へ完全切り替え、またはキャッシュ再生成フローへ統一する。  
   - 削除後に不要になったフラグやフォールバック処理は順次リファクタリングする。

## 6. 運用ルール
- クリーニング実施後は `verifyMastersInD1.mjs` 等の整合性チェックを再度実行し、結果を運用ノートへ記録する。
- 重要キーハンドリングは 4 眼原則を採用し、削除・更新時は別担当が確認する。
- 新規機能で KV を追加利用する場合は、本ポリシーに沿ったカテゴリとエクスパイア設計を必ず定義した上で設計レビューを受ける。

## 7. 今後の改善メモ
- `scripts/kvDump.mjs`（仮称）を作成し、指定プレフィックスをまとめて JSON に出力できるようにする。
- Cron / Durable Object を用いたキャッシュ自動クリア機構を導入し、手動削除の頻度を減らす。
- R2 バックアップ一覧を Dashboards 側で可視化し、世代管理や削除期限を自動通知できるよう検討する。
