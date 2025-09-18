

# 機能仕様書（NCD-App）

NCD-App の画面ごとの機能・入力項目・ボタン・遷移・API 呼び出しを整理する。

---

## 🏠 トップページ（index.html）
- **役割**: アプリの入口
- **主な要素**
  - ボタン: 「新規登録」→ `register.html`
  - ボタン: 「施設一覧」→ `clinicList.html`
  - ボタン: 「管理画面」→ `admin.html`
- **API 呼び出し**: なし（ナビゲーションのみ）

---

## 📝 新規登録画面（register.html）
- **役割**: 新しい診療所を登録
- **入力項目**
  - 診療所名
- **ボタン**
  - 「登録」→ サーバーへ送信
- **API 呼び出し**
  - `POST /clinics` （名称重複チェック → 登録）

---

## 📋 施設一覧画面（clinicList.html）
- **役割**: 既存施設を選択して詳細へ
- **要素**
  - 診療所の一覧（サーバーから取得）
  - 各行クリックで `clinicDetail.html` へ
- **API 呼び出し**
  - `GET /clinics`

---

## 🏥 施設詳細画面（clinicDetail.html）
- **役割**: 個別診療所の詳細情報を表示
- **入力/表示項目**
  - 基本情報（名称・住所など）
  - 資格 / サービス / 検査 へのリンク
- **API 呼び出し**
  - `GET /clinics/:id`

---

## 🏥 施設ホーム画面（clinicHome.html）
- **役割**: 診療所ごとのトップページ
- **要素**
  - 診療所概要
  - 資格・サービス・検査ページへのリンク
- **API 呼び出し**
  - `GET /clinics/:id`

---

## 🎓 施設資格情報画面（clinicQualifications.html）
- **役割**: 資格情報の一覧・追加
- **入力項目**
  - 資格名
  - 説明（任意）
- **ボタン**
  - 「追加」
- **API 呼び出し**
  - `GET /masters/qual`
  - `POST /masters/qual`

---

## 🩺 施設サービス画面（clinicServices.html）
- **役割**: 提供サービスの管理
- **入力項目**
  - サービス名
  - 説明（任意）
- **API 呼び出し**
  - `GET /masters/service`
  - `POST /masters/service`

---

## 🔬 施設検査情報画面（clinicTests.html）
- **役割**: 実施可能な検査の管理
- **入力項目**
  - 検査名
  - 説明（任意）
- **API 呼び出し**
  - `GET /masters/test`
  - `POST /masters/test`

---

## ⚙️ 管理画面（admin.html）
- **役割**: 全データとマスター管理
- **主な機能**
  - 診療所リスト管理
    - ソート（更新日順、名前順）
    - JSON / CSV 出力
  - マスター管理（資格・検査・診療）
    - ステータス: 候補 / 承認 / 廃止
    - JSON / CSV 出力
  - 分類管理（categoriesAdmin.htmlへリンク）
  - AI 設定
    - モデル名（例: gpt-4o-mini）
    - system プロンプト入力
- **API 呼び出し**
  - `GET /clinics`
  - `GET /masters/:type`
  - `PATCH /masters/:type/:id`
  - `GET /export/:format`
  - `POST /api/generate`

---

## 🗂 分類管理画面（categoriesAdmin.html）
- **役割**: 資格/検査/診療の分類を管理
- **入力項目**
  - 分類名
- **ボタン**
  - 「追加」
- **API 呼び出し**
  - `GET /categories/:type`
  - `POST /categories/:type`

---

## 📑 補助ファイル
- **style.css**: デザイン定義
- **scripts.js**: 各画面の fetch 処理や DOM 操作
- **web.config**: IIS 設定ファイル

---

## 🔮 今後の拡張 TODO
- DB（外部DB連携、FileMaker/Claris統合）
- ユーザー認証（管理画面アクセス制御）
- 承認フローのログ記録
- AI生成結果の保存・活用


## 📝 新規登録画面（register.html）
- **役割**: 新しい診療所を登録

- **入力項目**
  - 診療所名（必須, 50文字以内, 全角/半角可）
  - 住所（任意, 100文字以内）
  - 電話番号（任意, 数字・ハイフン, 15桁以内）
  - メールアドレス（任意, メール形式）

- **ボタン**
  - 「登録」 → サーバーへ送信

- **バリデーション**
  - 診療所名が空欄の場合はエラー
  - 電話番号が数値・ハイフン以外を含む場合はエラー
  - メール形式チェック（@とドメイン必須）

- **API 呼び出し**
  - `POST /clinics` （名称重複チェック → 登録）
