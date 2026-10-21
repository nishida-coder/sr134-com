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
  // API用の恒久ドメイン。表に出る主ドメインを変えてもこちらは変わらない。
  domain: 'gp9g0i-sk.myshopify.com',
  // ブランドページと商品ページの公開先。shop.sr134.com の接続が済んだらここを差し替える。
  shopBase: 'https://shop.sr134.com',
  // Headless チャネルが発行した公開トークン。サイトに埋め込む前提の値。
  // shpat_ で始まる非公開トークンは絶対にここへ書かない（credentials.md のみ）。
  storefrontToken: 'c4aa07c6725484170c0609df2fc4818c',
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

// ===== Shopify を記事の保管先として読む =====
// Pick Up と News は Shopify の管理画面で編集する。
// 取得できないときは null を返し、呼び出し側が従来のJSONへ落とす。
(function () {
  const GQL = `
    query($type: String!) {
      metaobjects(type: $type, first: 30) {
        nodes {
          handle
          updatedAt
          fields {
            key
            value
            reference {
              ... on MediaImage { image { url } }
            }
            references(first: 20) {
              nodes {
                ... on MediaImage { image { url } }
                ... on Metaobject {
                  handle
                  fields {
                    key
                    value
                    reference {
                      ... on Product {
                        title
                        handle
                        vendor
                        featuredImage { url }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }`;

  const byKey = fields => Object.fromEntries(fields.map(f => [f.key, f]));
  const val = (f, k) => (f[k] ? f[k].value : '');
  const imageUrl = (f, k) => (f[k] && f[k].reference && f[k].reference.image ? f[k].reference.image.url : '');
  const imageList = (f, k) =>
    f[k] && f[k].references
      ? f[k].references.nodes.filter(n => n.image).map(n => n.image.url)
      : [];
  // 空行で区切られた本文を段落の配列にする
  const paragraphs = t => String(t || '').split(/\n\s*\n/).map(s => s.trim()).filter(Boolean);

  async function fetchType(type) {
    const cfg = window.SR134_SHOPIFY || {};
    if (!cfg.domain || !cfg.storefrontToken) return null;
    try {
      const res = await fetch(`https://${cfg.domain}/api/${cfg.apiVersion}/graphql.json`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Storefront-Access-Token': cfg.storefrontToken,
        },
        body: JSON.stringify({ query: GQL, variables: { type } }),
      });
      if (!res.ok) return null;
      const json = await res.json();
      if (json.errors) return null;
      return json.data.metaobjects.nodes;
    } catch (e) {
      return null;
    }
  }

  function toPickup(node) {
    const f = byKey(node.fields);
    const items = (f.items && f.items.references ? f.items.references.nodes : [])
      .filter(n => n.fields)
      .map(n => {
        const g = byKey(n.fields);
        const lines = String(val(g, 'note') || '').split('\n').map(s => s.trim()).filter(Boolean);
        const product = g.product && g.product.reference ? g.product.reference : null;
        return {
          brand: product ? product.vendor : lines[0] || '—',
          name: product ? product.title : lines[1] || '',
          note: product ? lines.join(' ') : lines.slice(2).join(' '),
          image: product && product.featuredImage ? product.featuredImage.url : '',
          url: product ? `${(window.SR134_SHOPIFY || {}).shopBase}/products/${product.handle}` : '',
        };
      });
    return {
      id: node.handle,
      title: val(f, 'title'),
      date: val(f, 'date'),
      lead: val(f, 'lead'),
      story: paragraphs(val(f, 'story')),
      image: imageUrl(f, 'hero'),
      items,
    };
  }

  function toNews(node) {
    const f = byKey(node.fields);
    return {
      id: node.handle,
      title: val(f, 'title'),
      date: val(f, 'date'),
      brand: val(f, 'brand'),
      lead: val(f, 'lead'),
      body: paragraphs(val(f, 'lead')),
      image: imageUrl(f, 'card_image'),
      images: imageList(f, 'images'),
      link: val(f, 'link'),
      isNew: String(val(f, 'is_new')) === 'true',
    };
  }

  const SHAPERS = { pickup: toPickup, news: toNews };

  /**
   * Shopify から記事を取得する。取れないときは null。
   * 呼び出し側は null のとき従来のJSONを読む。
   */
  window.sr134Content = async function (type) {
    const nodes = await fetchType(type);
    if (!nodes || !nodes.length) return null;
    const shape = SHAPERS[type];
    if (!shape) return null;
    // 日付の新しい順。左ほど最近、右へ行くほど過去になる
    return nodes
      .map(shape)
      .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  };
})();
