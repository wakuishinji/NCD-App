# 画面遷移マップ（NCD-App）

NCD-App の主要画面同士の遷移関係を整理する。

---

## シンプルな表形式

| 出発画面 | 遷移先 | 条件／操作 |
|----------|--------|------------|
| トップページ（index.html） | 新規登録画面（register.html） | 「新規登録」ボタン |
| トップページ（index.html） | 施設一覧画面（clinicList.html） | 「施設一覧」ボタン |
| トップページ（index.html） | 管理画面（admin.html） | 「管理画面」ボタン |
| 施設一覧画面（clinicList.html） | 施設詳細画面（clinicDetail.html） | 任意の施設を選択 |
| 施設詳細画面（clinicDetail.html） | 資格情報画面（clinicQualifications.html） | 「資格」リンク |
| 施設詳細画面（clinicDetail.html） | サービス画面（clinicServices.html） | 「サービス」リンク |
| 施設詳細画面（clinicDetail.html） | 検査画面（clinicTests.html） | 「検査」リンク |
| 管理画面（admin.html） | 分類管理画面（categoriesAdmin.html） | 「分類管理」リンク |
| 管理画面（admin.html） | 各種 JSON/CSV エクスポート | 「エクスポート」ボタン |
| 管理画面（admin.html） | AI 設定画面（同一ページ内） | 「AI設定」入力欄 |

---

## 簡易フローチャート（Mermaid記法）

```mermaid
flowchart TD

  A[トップページ] --> B[新規登録]
  A --> C[施設一覧]
  A --> D[管理画面]

  C --> E[施設詳細]
  E --> F[資格情報]
  E --> G[サービス情報]
  E --> H[検査情報]

  D --> I[分類管理]
  D --> J[エクスポート処理]
  D --> K[AI設定]
