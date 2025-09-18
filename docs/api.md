# API仕様書（NCD-App）

フロントエンド（web/）とバックエンド（functions/）で利用する API の一覧。

---

## 📋 Clinics（診療所関連）

### GET /clinics
- **説明**: 登録済み診療所の一覧を取得
- **レスポンス例**
```json
[
  {
    "id": "c001",
    "name": "のがたクリニック",
    "address": "東京都中野区...",
    "phone": "03-xxxx-xxxx",
    "updatedAt": "2025-09-01T10:00:00Z"
  }
]
