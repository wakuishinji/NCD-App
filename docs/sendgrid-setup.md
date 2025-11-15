# SendGrid 運用メモ（2025-xx-xx）

## 1. ドメイン認証
- `altry.net` を Cloudflare で DNS 管理しているため、SendGrid の Domain Authentication で `altry.net` を認証済み。
  - DNS host: Cloudflare、Branded Links: No（既定）。
  - 追加したレコード（すべて `DNS only` / Proxy OFF）:
    | Type | Name | Value |
    |------|------|-------|
    | CNAME | `em2575.altry.net` | `u57011372.wl123.sendgrid.net` |
    | CNAME | `s1._domainkey.altry.net` | `s1.domainkey.u57011372.wl123.sendgrid.net` |
    | CNAME | `s2._domainkey.altry.net` | `s2.domainkey.u57011372.wl123.sendgrid.net` |
    | TXT | `_dmarc.altry.net` | `v=DMARC1; p=quarantine; rua=mailto:postmaster@altry.net; ruf=mailto:postmaster@altry.net; fo=1` |

## 2. Dynamic Templates
- 自治体招待用テンプレート
  - タイトル例: `{{organization.name}} 施設管理者アカウントのご案内`
  - 変数: `organization.*`, `clinic.name`, `recipient.*`, `acceptUrl` など（本文は HTML テンプレートに記載済み）。
- 施設スタッフ招待用テンプレート
  - タイトル例: `{{clinic.name}} スタッフアカウント招待`
  - 変数: `organization.name`, `clinic.*`, `recipient.*`, `invitedBy.*`, `acceptUrl`, `invite.expiresAt`。

## 3. Cloudflare Workers 環境変数
```
MAIL_PROVIDER=sendgrid
SENDGRID_API_KEY=SG.xxxxxx（SendGrid で発行した Mail Send 権限付き API キー）
MAIL_DEFAULT_FROM="NCD Notifications <noreply@altry.net>"
MAIL_DEFAULT_REPLY_TO="office@nakano-med.or.jp" （必要に応じて）
```

- `wrangler secret put SENDGRID_API_KEY --env staging` などで登録。
- 送信者情報やテンプレ ID は `organizationSettings.mail` に保持して、自治体／施設ごとに切り替える方針。

## 4. 今後の運用
- 他自治体で独自ドメインを使う場合は、同じ手順で Domain Authentication を追加する。
- 送信文面変更は SendGrid テンプレート、または `organizationSettings.mail.templateId` の差し替えで対応。
