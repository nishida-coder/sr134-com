# SR134.com — Claude 作業指示プロンプト集

しもん様が席を外している間に Claude で並行進行できる作業と、それぞれの実行プロンプトです。
Claudeに投げるだけで進む粒度に調整済み。

---

## 1. 各商品ページの説明文リライト（62点）

**目的**：現在プレースホルダーの説明文（「Studio Route 134 の目利きで〜」の定型）を、各商品ごとに固有の文へ差替え。

**プロンプト**：
```
C:\libunworks\projects\sr134-com\products.json を読み込み、各商品の
description フィールドを、以下の条件で 60〜120 字の日本語で書き直してください：

- 商品のブランド／カテゴリ／素材（あれば）／生産国（あれば）を踏まえた具体的な一文
- Studio Route 134 の一流セレクトショップとしての目線を含める
- マーケティング誇張（「究極」「至極」「必見」など）を使わない
- 楽天ページの本文をコピーしない。ゼロベースで書く
- 「詳しい仕様やサイズ・カラー在庫はお問い合わせください」で締める

修正後、products.json を上書き保存してください。
```

---

## 2. Shopify 商品インポート用 CSV 生成

**目的**：Shopify Starter 開設後、products.json → Shopify CSV でワンショット投入。

**プロンプト**：
```
C:\libunworks\projects\sr134-com\products.json を、
Shopify Products CSV 形式（Handle, Title, Body (HTML), Vendor, Type, Tags,
Published, Option1 Name, Option1 Value, ..., Variant Price, Variant SKU,
Image Src, Image Position）に変換してください：

- Handle = 商品 slug
- Title = "{brand} {name}"
- Body (HTML) = description をパラグラフで
- Vendor = brand
- Type = category
- Tags = brand, category, origin (あれば)
- Option1 Name = "Size"、Option1 Value = sizes 配列を分解
- Option2 Name = "Color"（colors が空でなければ）、Option2 Value = colors 分解
- Variant Price = price
- Image Src = images 配列を Image Position 昇順で複数行に

出力先：C:\libunworks\projects\sr134-com\shopify-products.csv
```

---

## 3. Journal 記事の中身作成（現状はタイトル+日付のみ）

**目的**：NEWS / Journal カードクリック時に読める記事本文を作成。

**候補：**
- "LEON Shoot at the Store" — 過去のLEON撮影エピソード
- "Alberto Bressi Visits" — HYDROGEN創業者来店エピソード
- "Skate Wall, One-Off Editions" — 江ノ島店のスケボー壁面ストーリー
- "New Store, Opening Soon" — 江ノ島店 開店経緯
- "Season by the Sea" — 湘南の夏の空気感

**プロンプト**：
```
Studio Route 134 の Journal 記事を 5本、各 400〜600 字の日本語で執筆してください。
以下のタイトルに沿って書きます：

1. "LEON誌 撮影の日、青山店にて。" — 誌面撮影の裏側、モデル・スタイリング視点
2. "Alberto Bressi、青山店を訪う。" — HYDROGEN創業者との交流エピソード
3. "スケートボード壁面 — 江ノ島店の一角。" — 1952/Supreme/Lucien Pellat-Finet/Dsquared2の一点物ボード
4. "新店、江ノ島にて。" — 江ノ島店 オープン準備の記録
5. "海のそばで、装う。" — 湘南の夏のライフスタイル

文体：
- 一流セレクトショップの視点、しずかな余白のある文章
- 誇張・宣伝感を出さない
- 装いと風景を並べる書き方

出力先：C:\libunworks\projects\sr134-com\journal/{slug}.md
（ファイル 5本を作成）
```

---

## 4. 特商法 / プライバシー / 送料返品 ページ作成

**目的**：Shopify 移行前に法的必須ページを揃える。

**プロンプト**：
```
Studio Route 134（運営：株式会社オフィスティースリー、代表 辻俊介、
〒107-0062 東京都港区南青山6-6-20）のECサイト用に、以下 4ページの
静的HTMLを作成してください：

- law.html（特定商取引法に基づく表記）
- privacy.html（プライバシーポリシー）
- shipping.html（配送・返品ポリシー）
- terms.html（利用規約）

各ページは既存の stores.html を参考にした最小デザインで統一。
連絡先メール：info@sr134.com（仮）
返品：商品到着後7日以内、未使用に限る、送料お客様負担、セール品不可

出力先：C:\libunworks\projects\sr134-com\ 直下
```

---

## 5. サイズガイド画像 or 表の作成

**目的**：product.html の Size チップ横に「サイズガイドを見る」リンクを設置、開くとサイズ実寸表が出るモーダル or 別ページ。

**プロンプト**：
```
Studio Route 134 用のサイズガイドページ size-guide.html を作成：

- カテゴリ別（Tops / Denim / Shoes / Outer）に実寸表を4テーブル
- Tops：Chest / Length / Shoulder / Sleeve（EU 44,46,48,50,52 → cm）
- Denim：Waist / Inseam（EU 44,46,48,50,52）
- Shoes：JP → EU → US → UK 対応表（24〜29）
- Outer：Tops と同じ寸法軸

デザインは stores.html を参照。テーブルは monospace lnum で整列。

出力先：C:\libunworks\projects\sr134-com\size-guide.html
product.html の Size ブロック直下に "Size Guide →" リンクを追加。
```

---

## 6. NEWS 記事の追加（現在 6枚固定）

**目的**：時期に応じた新着ニュースをストックし、順次追加。

**プロンプト**：
```
Studio Route 134 の NEWS カード用テキスト（date + 一行タイトル）を、
以下のシチュエーションで 8本、日本語で作成してください：

- 新ブランド入荷 / セール告知 / 店内イベント / スタッフ日記 / 撮影裏話
- date は「2026.07.NN — {場所または brand}」形式
- title は 12〜22 字、キャッチ寄りだが装飾過多にしない

出力形式：JSONで [{date, title, hint_image_topic}, ...]
```

---

## 7. 動画（葉山店入口）の Hero 差替え検証

**素材**：`photos/hayama-entrance.mp4`

**プロンプト**：
```
sr134-com/index.html の Hero を、以下いずれかに差替え：

A. カルーセル 4スライド化：現在の3画像＋動画をローテーション
B. Hero 全体を動画背景、既存3画像はサブ表示

- 動画は muted / autoplay / loop / playsinline
- モバイル対応：viewport <= 720px では静止画にフォールバック
- 動画 poster に hayama-store.jpg を使用

まず A を実装し、動作を確認してから B の是非を判定。
```

---

## 実行順推奨

1. `1. 商品説明リライト` — 即効性 高（詳細ページの見栄え改善）
2. `4. 特商法他 4ページ` — Shopify 移行前必須
3. `5. サイズガイド` — 購買コンバージョン寄与
4. `3. Journal 記事` — サイト骨格の完成度
5. `2. Shopify CSV` — Shopify Starter 開設後
6. `6. NEWS 追加` — 運用フェーズ
7. `7. 動画 Hero` — 磨き込みフェーズ

---

**現在のサイト構造**：
- index.html — TOP（Hero / Press / NEWS / Pick Up 12 / Lookbook / Resort Edit / Brands / Journal / Stores teaser / Newsletter）
- shop.html — 全 62 商品カタログ + ブランドフィルタ
- product.html — 商品詳細（?id={slug} で動的）
- stores.html — 3店舗詳細
- products.json — 商品マスタ（62 items, sizes/colors/material/origin/gender）
- photos/ — 実店舗写真 15点＋動画1
