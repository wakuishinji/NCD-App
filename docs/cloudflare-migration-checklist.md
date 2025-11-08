# Cloudflare 移行棚卸しメモ（2025-11-08）

本メモは「さくら VPS（Windows 2025 + IIS）」から Cloudflare（Workers / Pages / KV / D1 / R2）へ移行する際に、現行コンポーネントの棚卸しとターゲット構成を整理したもの。ユーザーは現状テスト利用のみのため、ダウンタイムを許容した大胆な移行手順を前提とする。

---

## 1. 現行構成（ざっくり）

| コンポーネント | 現在の配置・役割 | 備考 |
| --- | --- | --- |
| IIS サイト | `web/` 以下の静的 HTML/CSS/JS を配信 | `clinicHome.html` などを手動で配置、キャッシュ制御は IIS |
| API / Backend | Cloudflare Workers（`functions/`） | 既に KV / D1 / R2 を利用。IIS とは別経路で呼び出し |
| データ | Cloudflare KV (`SETTINGS`), D1 (`MASTERS_D1`), R2 (`ncd-clinic-media`) | 一部 Windows 側に旧 JSON やバックアップが残る |
| バッチ / スクリプト | `scripts/*.mjs` をローカル実行し、Workers API や D1 を操作 | さくら VPS で直接実行することもある |
| ログ / 監視 | Windows 側で `tail.log` などを一時保存 / Cloudflare `wrangler tail` | 一元化されていない |
| DNS / SSL | さくら VPS 側で管理（推定） | Cloudflare へ移すことで証明書自動化、CDN 利用が可能 |

---

## 2. Cloudflare でのターゲット構成

| 機能カテゴリ | 現在 | Cloudflare での置き換え | 具体的作業 |
| --- | --- | --- | --- |
| フロントエンド配信 | IIS + 手動配置 | **Cloudflare Pages**（`ncd-app` プロジェクト） | `web/` を Pages へデプロイ（GitHub or `wrangler pages deploy`）。カスタムドメイン `ncd-app.altry.workers.dev` を紐付ける。 |
| API / Backend | Cloudflare Workers（既存） | **Cloudflare Workers** を本番/ステージング環境で統一 | `wrangler.toml` の `env.staging` / `env.production` を整理し、Secrets（JWT, SendGrid 等）を投入。 |
| データベース | D1 + KV + R2 | 同じく D1 / KV / R2 を継続 | D1 スキーマと移行脚本 (`schema/d1/*.sql`, `scripts/*.mjs`) を本番向けに確定させる。 |
| ストレージ（静的アセット） | Windows 上のフォルダ | Pages（静的）＋ R2（大きいファイル） | 画像・添付ファイルは R2、HTML/JS/CSS は Pages。 |
| DNS / SSL | さくら VPS | **Cloudflare DNS + SSL/TLS** | ネームサーバーを Cloudflare に切り替え、証明書は自動発行。旧サーバーはリダイレクト用に一時保持。 |
| ログ / 監視 | tail.log / `wrangler tail` | Cloudflare Logs / `wrangler tail` / Analytics | ログ収集の標準手順を Runbook に記載。 |

---

## 3. 詳細タスク一覧

### 3.1 棚卸しドキュメント整備
- [x] `docs/cloudflare-migration-checklist.md`（本ファイル）で現行とターゲット構成を整理。
- [ ] Windows サーバー側の設定（IIS サイト、ファイアウォール、証明書、スケジューラ）の詳細を追記。
- [ ] DNS / メールドメインの管理情報を記録（Cloudflare での DNS レコード化に備える）。

### 3.2 Cloudflare Pages ステージング
1. GitHub リポジトリと Cloudflare Pages を接続し、`web/` をビルド不要でデプロイ。
2. `.pages.dev` ドメインで機能確認（API は staging Worker に向ける）。
3. 認証や API ベース URL を `localStorage` で切り替えられるよう `categoriesAdmin.html` 等を調整。

### 3.3 Workers 環境統合
1. `wrangler.toml` に `env.staging` / `env.production` を明示。
2. Secrets（JWT_SECRET, ADMIN_NOTIFY_EMAILS, MAIL_PROVIDER 等）を `wrangler secret put --env` で登録。
3. CI/CD（GitHub Actions）または手動で `wrangler deploy --env staging` → QA → `--env production` のフローを確立。

### 3.4 DNS 切り替え準備
1. さくら側の DNS TTL を 300s 程度まで下げておく。
2. Cloudflare 側で `ncd-app.altry.workers.dev` や将来ドメイン（`ncd.altry.net` 等）をセットアップ。
3. 切替当日のバッチ：  
   - DNS を Cloudflare に向ける  
   - 旧 Windows サーバーはリダイレクト or メンテナンス表示  
   - `wrangler tail` でログ監視

### 3.5 運用 Runbook
1. デプロイ／ロールバック手順（`wrangler deploy`, `wrangler rollback`）を `docs/system-runbook.md`（新規）にまとめる。  
2. バックアップ方針（D1 export、R2 バックアップ）、障害対応、アクセス権限管理を記載。  
3. Cloudflare Analytics / Logpush / alerting の設定方法を記載。

---

## 4. 既知の懸念・TODO
- **標榜診療科マスターの不安定動作**：キャッシュ刷新後も sporadic な挙動が報告されているため、Pages 切替後に E2E テストとログ診断を継続。  
- **SendGrid 等のメール基盤**：本番 Secrets 未設定のため、移行タイミングで `MAIL_PROVIDER=sendgrid` と API Key を投入する。  
- **旧サーバーのデータ廃棄**：切替後、Windows 側のデータ/ログに個人情報が残っていないか確認してから廃棄。

---

## 5. 次のステップ
1. さくら VPS の設定詳細を追記し、Cloudflare でのマッピングを確定。  
2. Cloudflare Pages でフロントエンドを動かすステージングを構築。  
3. `wrangler.toml` と Secrets を整理し、ステージング → 本番のデプロイフローを確立。  
4. DNS 切替とモニタリング手順を Runbook 化し、切替当日のチェックリストを準備。

これらを完了後、実際の DNS 切り替えと旧サーバーの段階的停止へ移行する。
