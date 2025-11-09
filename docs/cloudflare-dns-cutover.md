# Cloudflare DNS / SSL 切替手順メモ

本メモは、さくら VPS（Windows + IIS）で運用しているドメインを Cloudflare の DNS / SSL へ切り替える際の詳細ステップをまとめたもの。テスト段階のため短時間の停止は許容される前提。

---

## 1. 現状把握

| 項目 | 内容 |
| --- | --- |
| ドメイン | `ncd-app.altry.workers.dev` ほか、`ncd.altry.net` 等の派生ドメイン |
| DNS 管理 | さくら側で A/CNAME 設定 |
| SSL 証明書 | IIS で手動更新（推定） |
| Web サーバー | Windows 2025 + IIS |

今後は Cloudflare DNS + Pages/Workers で完結させ、SSL は Cloudflare の Universal SSL（自動発行）に任せる。

---

## 2. 切替準備

1. **Cloudflare にゾーン追加**
   - `altry.net` 等対象ドメインを Cloudflare ダッシュボードへ登録。
   - Cloudflare のネームサーバーが発行されるのでメモしておく。
2. **DNS レコードの再現**
   - 現在さくら側にある A/CNAME/MX/TXT レコードを export し、Cloudflare 側にも同じ値を設定。
   - Web 用のレコードは以下のように設定予定:
     - `ncd-app.altry.workers.dev` → CNAME `ncd-app.pages.dev` など
     - API 用カスタムドメインを設定する場合は、Workers Routes を使用。
3. **TTL を下げる**
   - 切替前日に さくら側の DNS TTL を 300 秒程度に下げ、切替時の伝播を早める。
4. **旧サーバーの準備**
   - 切替当日は IIS を「メンテナンスモード（503 画面）」または Cloudflare へのリダイレクトに設定しておく。
   - 最新バックアップ（静的ファイル・設定・ログ）を取得。

---

## 3. 実際の切替手順（リハーサル推奨）

1. **Cloudflare ネームサーバーへ変更**
   - レジストラ（さくら）でネームサーバーを Cloudflare に更新。
   - 伝播には最大 24 時間かかるが、TTL を下げていれば数分〜1 時間程度。
2. **Pages/Workers 側のカスタムドメイン有効化**
   - Pages プロジェクトで `ncd-app.altry.net` などのカスタムドメインを追加すると、Cloudflare DNS に自動で CNAME が追加される。
   - Workers Route を設定する場合は `wrangler deploy` 時に `routes = [...]` を設定するか、ダッシュボードから設定。
3. **証明書の確認**
   - Cloudflare 側で Universal SSL が有効か確認（`SSL/TLS > Edge Certificates`）。
   - ブラウザで https://ncd-app.altry.net を開き、証明書が Cloudflare 発行になっているかチェック。
4. **動作確認**
   - Pages (静的) や Workers (API) にアクセスし、`wrangler tail` でエラーログが出ていないか確認。
   - 旧サーバー向きのアクセスが残っていないか、`ping` / `nslookup` で確認。

---

## 4. ロールバック方針

1. **DNS を元に戻す**  
   - さくらのネームサーバーへ戻す or Cloudflare で A/CNAME を旧サーバーへ向ける。
2. **旧サーバーを再度有効化**  
   - IIS のメンテナンスページを解除し、元のサイトを公開。
3. **Cloudflare 側のアセットを停止**  
   - 必要に応じて Pages / Workers のカスタムドメインを無効化。

ロールバック後は原因を特定し、再度切替を行う。テスト段階での切替なので、ログを十分に収集して手順をブラッシュアップする。

---

## 5. TODO / メモ

- [ ] さくら DNS のレコード一覧を Markdown or CSV で保存。  
- [ ] 切替前後でチェックするリスト（主要 URL、認証、API、メール動作など）を作成。  
- [ ] 切替当日、Slack などで「開始」「完了」通知を行えるよう連絡フローを決める。  
- [ ] 古い証明書・ログなど個人情報を含むものは切替完了後に安全に廃棄する。

このメモを基に `docs/cloudflare-migration-checklist.md` や Runbook を更新しつつ、切替スケジュールを決めていく。
