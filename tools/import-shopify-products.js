#!/usr/bin/env node
/**
 * products.json から1ブランド分を Shopify へ投入する。
 *
 *   SHOPIFY_TOKEN=xxx node tools/import-shopify-products.js "Maison Margiela"
 *   SHOPIFY_TOKEN=xxx node tools/import-shopify-products.js "Maison Margiela" --dry-run
 *   SHOPIFY_TOKEN=xxx node tools/import-shopify-products.js "Maison Margiela" --limit 3
 *
 * ハンドルは products.json の id を使うため、再実行しても重複せず上書きになる。
 *
 * 元データの既知の不備への対応
 *   1. name が品番（T8013 など）になっているため、商品名には category を使う
 *   2. category の Selection は実体が Accessories なので Accessory に寄せる
 *   3. material が "▼-->" のようにスクレイプで壊れているため、説明文には使わない
 *   4. images の1枚目は採用せず2枚目から使う（しもんさん指示）
 *   5. images に evidence という作業用ファイルが混ざっているため除外する
 */
'use strict';

const fs = require('fs');
const path = require('path');

const SHOP = process.env.SHOPIFY_SHOP || 'gp9g0i-sk.myshopify.com';
const API_VERSION = process.env.SHOPIFY_API_VERSION || '2026-10';
const TOKEN = process.env.SHOPIFY_TOKEN;
const ENDPOINT = `https://${SHOP}/admin/api/${API_VERSION}/graphql.json`;

const MAX_IMAGES = 10;

/** Selection は実体が小物なので Accessory に寄せる。 */
const CATEGORY_ALIAS = { Selection: 'Accessory' };

const CATEGORY_JA = {
  Bag: 'バッグ',
  Accessory: 'アクセサリー',
  Denim: 'デニム',
  Knit: 'ニット',
  Tee: 'Tシャツ',
  Shirt: 'シャツ',
  Coat: 'コート',
  Jacket: 'ジャケット',
  Sneakers: 'スニーカー',
  Boots: 'ブーツ',
};

const PRODUCT_SET = `
  mutation($input: ProductSetInput!) {
    productSet(synchronous: true, input: $input) {
      product { id handle title status variantsCount { count } media(first: 1) { edges { node { id } } } }
      userErrors { field message }
    }
  }`;

const PUBLICATIONS = `query { publications(first: 20) { edges { node { id name } } } }`;

/** productSet は handle だけでは既存を拾わないため、先に id を引いて渡す。 */
const FIND = `
  query($handle: String!) {
    productByIdentifier(identifier: { handle: $handle }) { id }
  }`;

const PUBLISH = `
  mutation($id: ID!, $input: [PublicationInput!]!) {
    publishablePublish(id: $id, input: $input) { userErrors { field message } }
  }`;

async function gql(query, variables) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': TOKEN,
      },
      body: JSON.stringify({ query, variables }),
    });
    const json = await res.json();
    const throttled =
      json.errors && json.errors.some(e => (e.extensions || {}).code === 'THROTTLED');
    if (throttled) {
      await sleep(2000 * (attempt + 1));
      continue;
    }
    if (json.errors) throw new Error(json.errors.map(e => e.message).join(' / '));
    return json.data;
  }
  throw new Error('レート制限が解除されませんでした');
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

function categoryOf(p) {
  const raw = (p.category || '').trim();
  return CATEGORY_ALIAS[raw] || raw || 'Item';
}

/** 壊れた material は使わず、確かな項目だけで短い説明をつくる。 */
function descriptionOf(p, category) {
  const ja = CATEGORY_JA[category] || category;
  const lines = [`${p.brand} の${ja}です。`];
  if (p.origin) lines[0] += `${p.origin}。`;
  lines.push('サイズとカラーの在庫状況はお問い合わせください。');
  return lines.map(t => `<p>${t}</p>`).join('\n');
}

/**
 * 楽天の登録順（tools/fetch-rakuten-image-order.js で取得）があればそれを使う。
 * products.json の images はスクレイプ順で、接写や書類の写真が先頭に来てしまうため。
 */
let ORDER_MAP = null;
function loadOrderMap(brand) {
  const file = path.join(
    __dirname,
    'out',
    `rakuten-images-${brand.replace(/\s+/g, '-').toLowerCase()}.json`
  );
  ORDER_MAP = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  return Object.keys(ORDER_MAP).length;
}

function imagesOf(p) {
  // 楽天から取り直したデータは images が既に登録順
  const ordered = (ORDER_MAP && ORDER_MAP[p.id]) || (p.fromRakuten ? p.images : null);
  const raw = ordered && ordered.length ? ordered : Array.isArray(p.images) ? p.images : [];
  const seen = new Set();
  return raw
    .slice(1) // 1枚目は採用しない。2枚目をメインにする（しもんさん指示）
    .filter(u => u && !/evidence/i.test(u))
    .filter(u => (seen.has(u) ? false : (seen.add(u), true)))
    .slice(0, MAX_IMAGES);
}

function buildInput(p) {
  const category = categoryOf(p);
  const sizes = (p.sizes || []).filter(Boolean);
  const colors = (p.colors || []).filter(Boolean);

  const options = [];
  if (sizes.length) options.push({ name: 'サイズ', values: sizes.map(name => ({ name })) });
  if (colors.length) options.push({ name: 'カラー', values: colors.map(name => ({ name })) });
  if (!options.length) {
    options.push({ name: 'タイプ', values: [{ name: 'Standard' }] });
  }

  // すべての組み合わせを展開する
  let combos = [[]];
  for (const opt of options) {
    const next = [];
    for (const base of combos) {
      for (const v of opt.values) {
        next.push([...base, { optionName: opt.name, name: v.name }]);
      }
    }
    combos = next;
  }

  const variants = combos.map(optionValues => ({
    optionValues,
    price: String(p.price),
    sku: [p.id, ...optionValues.map(o => o.name)].join('-').replace(/\s+/g, ''),
    inventoryPolicy: 'CONTINUE',
    inventoryItem: { tracked: false },
  }));

  const extra = (process.env.SHOPIFY_EXTRA_TAGS || '').split(',').map(t => t.trim()).filter(Boolean);
  const tags = [p.brand, p.gender, p.group, category, ...extra].filter(Boolean);

  return {
    handle: p.id,
    title: category,
    vendor: p.brand,
    productType: category,
    status: 'ACTIVE',
    descriptionHtml: descriptionOf(p, category),
    tags,
    productOptions: options,
    variants,
    files: imagesOf(p).map(src => ({
      originalSource: src,
      contentType: 'IMAGE',
      alt: `${p.brand} ${category}`,
    })),
  };
}

async function onlineStorePublicationId() {
  const data = await gql(PUBLICATIONS, {});
  const node = data.publications.edges.map(e => e.node).find(n => n.name === 'Online Store');
  return node ? node.id : null;
}

async function main() {
  const brand = process.argv[2];
  if (!TOKEN || !brand) {
    console.error('使い方 SHOPIFY_TOKEN=xxx node tools/import-shopify-products.js "<ブランド名>"');
    process.exit(1);
  }
  const dryRun = process.argv.includes('--dry-run');
  const limitArg = process.argv.indexOf('--limit');
  const limit = limitArg > -1 ? Number(process.argv[limitArg + 1]) : Infinity;

  // --from で楽天から取り直したデータを使う。省略時は products.json。
  const fromArg = process.argv.indexOf('--from');
  let targets;
  if (fromArg > -1) {
    const src = JSON.parse(fs.readFileSync(path.resolve(process.argv[fromArg + 1]), 'utf8'));
    const rows = Array.isArray(src) ? src : Object.values(src);
    targets = (brand === 'ALL' ? rows : rows.filter(p => p.brand === brand)).slice(0, limit);
  } else {
    const all = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'products.json'), 'utf8'));
    targets = all.filter(p => p.brand === brand).slice(0, limit);
  }
  if (!targets.length) {
    console.error(`${brand} の商品が見つかりません`);
    process.exit(1);
  }

  // このサイトは定価販売のみ。楽天の割引品は入れない。
  const DISCOUNT = /％OFF|%OFF|SALE|セール|OFF】/i;
  const discounted = targets.filter(p => DISCOUNT.test(p.title || ''));
  if (discounted.length) {
    targets = targets.filter(p => !DISCOUNT.test(p.title || ''));
    console.log(`割引表記のある ${discounted.length}件は除外しました（定価販売の方針）`);
  }
  const ordered = loadOrderMap(brand);
  console.log(
    `${brand} ${targets.length} 件を処理します` +
      (ordered ? `（うち ${ordered} 件は楽天の登録順を使用）` : '（楽天の登録順は未取得）')
  );

  if (dryRun) {
    const sample = buildInput(targets[0]);
    console.log(JSON.stringify(sample, null, 2));
    const variants = targets.reduce((s, p) => s + buildInput(p).variants.length, 0);
    const images = targets.reduce((s, p) => s + imagesOf(p).length, 0);
    console.log(`\n合計 バリエーション ${variants} / 画像 ${images}`);
    return;
  }

  const pubId = await onlineStorePublicationId();
  if (!pubId) throw new Error('オンラインストアの販売チャネルが見つかりません');

  let ok = 0;
  const failed = [];
  for (const p of targets) {
    try {
      const input = buildInput(p);
      const found = await gql(FIND, { handle: input.handle });
      if (found.productByIdentifier) input.id = found.productByIdentifier.id;
      const data = await gql(PRODUCT_SET, { input });
      const r = data.productSet;
      if (r.userErrors && r.userErrors.length) {
        failed.push(`${p.id} -> ${r.userErrors.map(e => `${e.field} ${e.message}`).join(', ')}`);
        continue;
      }
      const pubErrors = await gql(PUBLISH, { id: r.product.id, input: [{ publicationId: pubId }] });
      const pe = pubErrors.publishablePublish.userErrors || [];
      if (pe.length) {
        failed.push(`${p.id} 公開 -> ${pe.map(e => e.message).join(', ')}`);
        continue;
      }
      ok++;
      console.log(
        `${String(ok).padStart(3)} ${r.product.handle} ${r.product.title} ` +
          `バリエーション${r.product.variantsCount.count} 画像${imagesOf(p).length}`
      );
    } catch (e) {
      failed.push(`${p.id} -> ${e.message}`);
    }
  }

  console.log(`\n成功 ${ok} 件 / 失敗 ${failed.length} 件`);
  failed.forEach(f => console.log(`  NG ${f}`));
  if (failed.length) process.exit(1);
}

main().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
