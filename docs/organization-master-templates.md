# 組織タイプ別マスターテンプレート（ドラフト）

## 目的
- 診療所・病院・医師会それぞれで頻出する部署／委員会／グループ／役職の候補を事前に整備し、メンバーシップ管理や Medical Orchestra での自動割り当てに活用する。
- `scripts/seedOrganizationMasters.mjs` 経由で Cloudflare Workers API (`/api/addMasterItem`) に投入できるよう、テンプレートを JSON (`data/organization-masters.json`) で管理する。

## テンプレート構成
| orgType | sections | 説明 |
|---------|----------|------|
| `clinic` | departments / committees / groups / positions | クリニック規模の部署・委員会・チーム。例: 在宅診療チーム、感染対策委員会、院長・事務長など |
| `hospital` | 同上 | 病院向けのより大きな編成。例: 周術期支援チーム、災害対策委員会、病院長 等 |
| `medicalAssociation` | 同上 | 医師会特有の部会や委員会。例: 地域医療委員会、学術部、会長/理事 等 |

各セクションは `data/organization-masters.json` で配列として定義し、スクリプトが `type` / `category` を以下のように組み立てる。

| セクション | master `type` | `category` 例 |
|------------|---------------|---------------|
| departments | `department` | `clinic:departments` |
| committees  | `committee`  | `hospital:committees` |
| groups      | `group`      | `medicalAssociation:groups` |
| positions   | `position`   | `<orgType>:positions` |

## スクリプトの使い方
```
npm run seed:org-masters -- --apply --base https://ncd-app.altry.workers.dev
```

- `--apply` を付けない場合はドライランで対象がログ出力されるだけ。
- 認証が必要な環境では `--token <JWT>` または `AUTH_TOKEN=<JWT>` を付与すると Bearer トークンをヘッダーへ付加する。
- 新しいテンプレートを追加する際は `data/organization-masters.json` に追記 → 上記コマンドを再実行する。

## 今後の展開
1. `department` 以外の master type（`committee` / `group` / `position`）を UI から管理できるページを追加する。
2. メンバーシップ API で `departments` / `committees` / `groups` を更新できるようにし、Medical Orchestra のチャット自動参加条件へ接続する。
3. 組織種別ごとのテンプレートをローカライズできるよう、`data/organization-masters.json` を地域別ファイルへ分割する。
