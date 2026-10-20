// ===== Shopify 連携設定 =====
// Storefront API は公開用のトークンを使うため、ここに書いて問題ない種類の値です。
// Admin API のキーやパスワードは絶対にここへ書かないこと。
//
// 取得手順（2026-10 現在。旧「アプリを開発」は Dev Dashboard に移行済み）
//   A案 Headless チャネルを入れると管理画面上で公開トークンが発行される（推奨）
//   B案 https://dev.shopify.com でアプリ作成 → Storefront API の
//        unauthenticated_read_product_listings を許可 → ストアにインストール
//
// domain は xxxx.myshopify.com の形式。独自ドメインではなく myshopify の方を入れる。
// ストアがパスワード保護中は公開トークンでも取得できない場合があるため、
// 公開後に改めて疎通を確認する。取れないときは null が返り従来表示に戻る。
window.SR134_SHOPIFY = {
  domain: 'gp9g0i-sk.myshopify.com',
  // ブランドページと商品ページの公開先。shop.sr134.com のDNSが通ったらここを差し替える。
  shopBase: 'https://gp9g0i-sk.myshopify.com',
  storefrontToken: '',   // 例 'shpat_xxx' ではなく Storefront 用の公開トークン
  apiVersion: '2026-10',
};

// ブランドページのURL。Shopifyの自動コレクションを handle = brands.json の id で作ってある。
// 未設定なら従来の自サイト内ページへ落とす。
window.sr134BrandUrl = function (id) {
  const base = (window.SR134_SHOPIFY || {}).shopBase;
  return base ? `${base}/collections/${id}` : `brand.html?id=${encodeURIComponent(id)}`;
};

// 静的に書かれた brand.html?id=... のリンクも Shopify 側へ送る。
// ブランド一覧（idなしの brand.html）は自サイトのままにしておく。
document.addEventListener('DOMContentLoaded', function () {
  if (!(window.SR134_SHOPIFY || {}).shopBase) return;
  document.querySelectorAll('a[href^="brand.html?id="]').forEach(a => {
    const id = new URLSearchParams(a.getAttribute('href').split('?')[1]).get('id');
    if (id) a.setAttribute('href', window.sr134BrandUrl(id));
  });
});

// 直近で更新された商品のブランド（vendor）を新しい順に返す。
// 設定が空のときは null を返し、呼び出し側は従来どおりの表示に戻る。
window.sr134RecentVendors = async function (limit = 50) {
  const cfg = window.SR134_SHOPIFY || {};
  if (!cfg.domain || !cfg.storefrontToken) return null;
  const query = `{
    products(first: ${limit}, sortKey: UPDATED_AT, reverse: true) {
      edges { node { vendor updatedAt } }
    }
  }`;
  try {
    const res = await fetch(`https://${cfg.domain}/api/${cfg.apiVersion}/graphql.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Storefront-Access-Token': cfg.storefrontToken,
      },
      body: JSON.stringify({ query }),
    });
    if (!res.ok) return null;
    const json = await res.json();
    const edges = (json.data && json.data.products && json.data.products.edges) || [];
    const seen = [];
    for (const e of edges) {
      const v = (e.node.vendor || '').trim();
      if (v && !seen.includes(v)) seen.push(v);
    }
    return seen;
  } catch (e) {
    return null;
  }
};
