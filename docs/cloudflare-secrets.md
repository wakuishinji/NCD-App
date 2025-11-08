# Cloudflare Secrets 管理メモ

Workers / Pages を本番運用するにあたり、環境別（staging / production）のシークレットを整理する。ここでいう「シークレット」は `wrangler secret put` で設定する値を指し、Git には含めない。

---

## 1. 必要なシークレット一覧（初期想定）

| キー名 | 用途 / 参照箇所 | 備考 |
| --- | --- | --- |
| `JWT_SECRET` | Workers 認証トークン（`functions/lib/auth/jwt.js`） | 64 文字以上のランダム文字列。staging と production で別値にする。 |
| `ADMIN_NOTIFY_EMAILS` | 管理申請通知の宛先（`/api/auth/requestAdminAccess` など） | カンマ区切りメールアドレス。staging はテスト用アドレスに。 |
| `MAIL_PROVIDER` | メール送信先の種別（`log` / `sendgrid` など） | staging: `log`、production: `sendgrid` を予定。 |
| `SENDGRID_API_KEY` | SendGrid の API Key | staging では未設定 or テスト用キーで良い。 |
| `OPENAI_API_KEY` | LLM 機能が必要な場合（未定） | 現状は未使用。使用時に staging / production で分ける。 |
| `API_BASE_URL`（Pages 用） | フロントが参照する API のベース URL | Pages プロジェクト側の環境変数として設定する（Workers の secret ではなく Pages Variables）。 |
| その他（任意） | 例: `SENTRY_DSN`, `SLACK_WEBHOOK` 等 | 今後のモニタリング構成に応じて追加。 |

---

## 2. 追加コマンド例

### Staging
```bash
wrangler secret put --env staging JWT_SECRET
wrangler secret put --env staging ADMIN_NOTIFY_EMAILS
wrangler secret put --env staging MAIL_PROVIDER
wrangler secret put --env staging SENDGRID_API_KEY   # 必要な場合のみ
```

### Production
```bash
wrangler secret put --env production JWT_SECRET
wrangler secret put --env production ADMIN_NOTIFY_EMAILS
wrangler secret put --env production MAIL_PROVIDER
wrangler secret put --env production SENDGRID_API_KEY
```

> `wrangler secret put KEY_NAME` 実行後に表示されるプロンプトへ値を貼り付ける。CLI から直接値を渡す場合は `echo "value" | wrangler secret put KEY_NAME --env staging` のように記述する。

---

## 3. Pages（フロント）側の Variables

Cloudflare Pages では Worker シークレットとは別に、環境変数（Variables）を設定できる。API ベース URL を自動切り替えるため、以下のように登録する。

| Variable | Staging | Production |
| --- | --- | --- |
| `NCD_API_BASE` | `https://ncd-app-staging.<account>.workers.dev` | `https://ncd-app.altry.workers.dev` |
| `ENV_LABEL` | `staging` | `production` |
| その他 | 例: `SENTRY_DSN`, `GA_MEASUREMENT_ID` | 任意 |

フロント JS からは `window.__CF_PAGES_ENV.NCD_API_BASE` のように参照できるため、`localStorage` に頼らない自動切替が可能になる。

---

## 4. 運用ルール

1. **キーファイルに書かない**  
   - シークレット値は Git にコミットしない。常に `wrangler secret put` / Cloudflare ダッシュボードで管理。
2. **変更ログを残す**  
   - 重要なシークレットを更新した場合は、`docs/cloudflare-secrets.md` に日時・理由・実施者をメモ（値そのものは記載しない）。  
   - 例: `2025-11-09 staging MAIL_PROVIDER を log -> sendgrid に変更 (理由: メール実送信テスト)`
3. **アクセス権限**  
   - `wrangler secret` を実行できるのは必要最小限の Cloudflare アカウント（今回は和久井さん）に限定。  
   - CLI で実行した PC は不要な `.wrangler` キャッシュを残さないよう注意。

---

## 5. 今後の追加候補

- **Sentry/Datadog など監視ツール** のキー  
- **Slack 通知** 用 Webhook  
- **外部 API**（MHLW, geocoding など）で認証が必要な場合のトークン  
- **Pages Functions を利用する際の Secrets/Bindings** の整理

必要になったタイミングでこのドキュメントを更新し、`wrangler secret put` 手順も追記していく。
