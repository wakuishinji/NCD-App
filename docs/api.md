# API仕様書（NCD-App）

NCD-App で利用する主要な HTTP API をまとめる。パスはすべて `/api/` 配下で提供され、`/api/v1/` でも同一処理にフォールバックする。特別な認証ヘッダーは現状不要だが、管理画面からの操作を前提としている。

---

## 共通仕様
- **ホスト**: 本番は `https://ncd-app.altry.workers.dev`。ローカル検証時は `window.NCD_API_BASE` または `localStorage.ncdApiBase` で上書きできる。
- **ヘッダー**: JSON ボディを送信する場合は `Content-Type: application/json` を付与する。
- **CORS**: すべてのレスポンスに `Access-Control-Allow-Origin: *` が付与される。
- **レスポンス形式**: 基本は JSON。エクスポート系のみ CSV を返す。

---

## Clinics（診療所）

### `POST /api/registerClinic`
- **概要**: 診療所名のみで仮登録し、KV に ID を払い出す。
- **Request Body**
  ```json
  { "name": "のがたクリニック" }
  ```
- **Response (200)**
  ```json
  {
    "ok": true,
    "clinic": {
      "id": "b5c9f5ac-...",
      "schemaVersion": 2,
      "basic": {
        "name": "のがたクリニック",
        "address": "東京都中野区野方1-2-3",
        "postalCode": "1650027",
        "phone": "",
        "fax": "",
        "website": "",
        "email": ""
      },
      "location": null,
      "clinicType": "clinic",
      "services": [],
      "tests": [],
      "qualifications": [],
      "managerAccounts": [],
      "staffMemberships": [],
      "status": "active",
      "metadata": {
        "createdAt": "2025-10-29T00:00:00.000Z",
        "updatedAt": "2025-10-29T00:00:00.000Z"
      }
    }
  }
  ```
- 既存データが旧形式（`clinic:{name}`）で保存されている場合は、その場で新形式へ移行して返す。

### `GET /api/listClinics`
- **概要**: すべての診療所を配列で返す。D1 `facilities` テーブルが利用可能な場合は D1 から、未移行環境では KV から取得する。最大 2000 件まで返却。
- **Response (200)**
  ```json
  { "ok": true, "clinics": [ { "id": "...", "name": "...", ... } ] }
  ```

### `GET /api/clinicDetail?id=<uuid>&name=<name>`
- **概要**: ID または名称で診療所詳細を取得。ID が優先される。
- **Response (200)**: `{"ok": true, "clinic": { ... }}`
- **Response (404)**: `{"ok": false, "error": "clinic not found"}`

### `POST /api/updateClinic`
- **概要**: 任意プロパティをマージして保存。`id` を含むリクエストで名称変更した場合は、旧 `clinic:name:*` インデックスが削除される。
- **Request Body**（例）
  ```json
  { "id": "b5c9f5ac-...", "name": "新名称クリニック", "address": "..." }
  ```

### `POST /api/deleteClinic`
- **概要**: ID または名称で診療所を削除。
- **Response (200)**: `{"ok": true}`。削除対象が見つからない場合は 404。

### `GET /api/exportClinics?format=json|csv`
- **概要**: 一覧を JSON 又は CSV でダウンロード。オフセット・リミット指定も可能。

---

## Media（診療所メディア）

| メソッド/パス | 概要 |
|---------------|------|
| `POST /api/media/upload-url` | R2 向け署名付き URL を生成。`clinicId` と `slot`（`logoSmall`/`logoLarge`/`facade`）を指定。 |
| `POST /api/media/upload` | 直接アップロードする場合の multipart 受け口。 |
| `POST /api/media/commit` | 署名付きアップロード完了後にメタデータを保存。 |
| `POST /api/media/delete` | 既存メディアを削除し、R2 からの削除も試みる。 |

---

## Masters（検査・診療・資格など）

| メソッド/パス | 説明 |
|---------------|------|
| `POST /api/addMasterItem` | マスター項目を追加。`type`（`test` / `service` / `qual` / `facility` / `symptom` / `bodySite` 等）を指定。 |
| `GET /api/listMaster?type=<type>&status=<status>` | 指定種別のマスター一覧を取得。ステータスフィルタ（`approved` 等）対応。 |
| `POST /api/updateMasterItem` | 既存項目を更新。 |
| `POST /api/master/addExplanation` | 説明文候補を追加。 |
| `POST /api/deleteMasterItem` | 項目削除。 |
| `GET /api/exportMaster?type=<type>&format=json|csv` | マスターの CSV / JSON エクスポート。 |
| `POST /api/maintenance/masterCleanup` | 旧 ID 体系や不要フィールドの整理用メンテナンスエンドポイント。 |

---

## Categories（分類ラベル）

| メソッド/パス | 概要 |
|---------------|------|
| `GET /api/listCategories?type=<type>` | タイプ別分類一覧。`type` は `department` / `service` / `test` / `qual` / `facility` など。 |
| `POST /api/addCategory` | 新規分類追加。空文字や重複は 400。 |
| `POST /api/renameCategory` | 既存分類をリネーム。 |
| `POST /api/deleteCategory` | 分類削除。 |

---

## Modes（診療形態タグ）

| メソッド/パス | 概要 |
|---------------|------|
| `GET /api/modes` | 登録済み診療形態一覧（`online` / `night` 等）。 |
| `POST /api/modes/add` | 新規形態を追加。slug が重複しないよう `ensureUniqueId` を利用。 |
| `POST /api/modes/update` | 既存形態を更新。ID（slug）の変更はサポートしない。 |
| `POST /api/modes/delete` | 指定 slug を削除。 |

---

## Settings & AI

| メソッド/パス | 概要 |
|---------------|------|
| `GET /api/settings` | `model`, `prompt`, `prompt_exam`, `prompt_diagnosis` を取得。 |
| `POST /api/settings` | 上記設定を更新。 |
| `POST /api/generate` | OpenAI Chat Completions をラップ。`messages` を渡す。 |
| `GET /api/client-config` | フロントが利用する Google Maps API Key を返す。 |

---

## ToDo（運用タスク）

- **GET /api/todo/list**: `{"ok": true, "updatedAt": 1707..., "todos": [...]}` を返す。
- **POST /api/todo/save**: `{"todos": [...]}` を保存し、保存後の一覧と更新日時を返す。

Todo オブジェクトは以下のフィールドを持つ。
```json
{
  "category": "フロントエンド",
  "title": "フォームバリデーション実装",
  "status": "open" | "done",
  "priority": "P1" | "P2" | "P3",
  "createdAt": "2025-01-01T09:00:00+09:00"
}
```

---

## 辞書・検索補助

| メソッド/パス | 概要 |
|---------------|------|
| `GET /api/thesaurus?normalized=<key>` | シソーラスのエントリを取得。 |
| `POST /api/thesaurus` | シソーラスを追加／更新。 |
| `GET /api/searchClinicsBySymptom?key=<symptomKey>` | 症状キーから関連診療所を検索（暫定実装）。 |

---

## ステータスコードまとめ
- **200**: 正常終了。
- **201**: 現状未使用（将来対応予定）。
- **400**: バリデーションエラー、必須パラメータ不足、サポート外の操作。
- **404**: 対象が存在しない。
- **500**: 予期しないエラー。ワーカーのログを確認する。

---

## 今後の拡張予定
- 認証トークンの導入と、管理者専用エンドポイントの保護。
- `PUT /api/clinicDetail` など RESTful 形式への整理。
- バルク登録用エンドポイント（`scripts/bulkUpsertMaster.js`）の新設。
