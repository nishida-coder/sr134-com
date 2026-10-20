// ===== Shopify 連携設定 =====
// Storefront API は公開用のトークンを使うため、ここに書いて問題ない種類の値です。
// Admin API のキーやパスワードは絶対にここへ書かないこと。
//
// 取得手順（Shopify管理画面）
//   設定 → アプリと販売チャネル → アプリを開発 → アプリを作成
//   → Storefront API の権限で unauthenticated_read_product_listings を許可
//   → インストール → Storefront API アクセストークンをコピー
//
// domain は xxxx.myshopify.com の形式。独自ドメインではなく myshopify の方を入れる。
window.SR134_SHOPIFY = {
  domain: '',            // 例 'studio-route134.myshopify.com'
  storefrontToken: '',   // 例 'shpat_xxx' ではなく Storefront 用の公開トークン
  apiVersion: '2025-07',
};

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
