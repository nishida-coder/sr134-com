#!/usr/bin/env node
/**
 * Pick Up の各アイテムに、Shopify の商品を結びつける。
 *
 *   SHOPIFY_TOKEN=xxx node tools/link-pickup-products.js            候補を出すだけ
 *   SHOPIFY_TOKEN=xxx node tools/link-pickup-products.js --apply    一意に決まるものを結びつける
 *
 * ブランドと品目で絞り込み、候補が1件なら自動で結びつける。
 * 複数あるときは候補を並べる。商品を選べば、写真と価格とリンクは自動で入る。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const SHOP = process.env.SHOPIFY_SHOP || 'gp9g0i-sk.myshopify.com';
const API_VERSION = process.env.SHOPIFY_API_VERSION || '2026-10';
const TOKEN = process.env.SHOPIFY_TOKEN;
const ENDPOINT = `https://${SHOP}/admin/api/${API_VERSION}/graphql.json`;
const STORE = 'https://shop.sr134.com';

/** 表示名から Shopify の品目へ。複数の候補を順に試す。 */
const TYPES = [
  [/hood|parka|フーデ/i, ['Hoodie', 'Knit', 'Outerwear']],
  [/pullover|boa|knit|ニット/i, ['Knit', 'Outerwear', 'Hoodie']],
  [/denim|jeans/i, ['Denim', 'Pants']],
  [/pants|trouser/i, ['Pants', 'Denim']],
  [/bag|バッグ/i, ['Bag']],
  [/wallet/i, ['Wallet']],
  [/loafer|shoes|boots/i, ['Shoes', 'Boots', 'Sneakers', 'Sandals']],
  [/sneaker/i, ['Sneakers', 'Shoes']],
  [/cap|hat|beanie/i, ['Accessory']],
  [/shirt/i, ['Shirt', 'Blouse']],
  [/tee|t-shirt/i, ['Tee']],
];

const SEARCH = `
  query($q: String!) {
    products(first: 12, query: $q) {
      nodes { id handle title vendor productType featuredImage { url } }
    }
  }`;

const FIND_ITEM = `
  query($handle: String!) {
    metaobjectByHandle(handle: { type: "pickup_item", handle: $handle }) { id }
  }`;

const UPDATE_ITEM = `
  mutation($id: ID!, $fields: [MetaobjectFieldInput!]!) {
    metaobjectUpdate(id: $id, metaobject: { fields: $fields }) {
      userErrors { field message }
    }
  }`;

async function gql(query, variables) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': TOKEN },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(json.errors.map(e => e.message).join(' / '));
  return json.data;
}

function typesFor(name) {
  for (const [re, list] of TYPES) if (re.test(name)) return list;
  return [];
}

async function candidates(brand, name) {
  if (!brand) return [];
  for (const type of typesFor(name)) {
    const d = await gql(SEARCH, { q: `vendor:'${brand}' AND product_type:'${type}'` });
    if (d.products.nodes.length) return d.products.nodes;
  }
  const d = await gql(SEARCH, { q: `vendor:'${brand}'` });
  return d.products.nodes;
}

const toHandle = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

async function main() {
  if (!TOKEN) {
    console.error('SHOPIFY_TOKEN が未設定です。');
    process.exit(1);
  }
  const apply = process.argv.includes('--apply');
  const data = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'pickup.json'), 'utf8')
  );

  let linked = 0;
  const pending = [];
  for (const p of data) {
    console.log(`\n${p.title}`);
    for (const [i, it] of (p.items || []).entries()) {
      const list = await candidates(it.brand, it.name);
      const label = `${it.name} / ${it.brand || '(ブランド未設定)'}`;
      if (!list.length) {
        console.log(`  ${label}  候補なし`);
        pending.push({ article: p.id, label, candidates: [] });
        continue;
      }
      if (list.length === 1 && apply) {
        const handle = `${toHandle(p.id)}-${i + 1}`;
        const found = await gql(FIND_ITEM, { handle });
        if (found.metaobjectByHandle) {
          const r = await gql(UPDATE_ITEM, {
            id: found.metaobjectByHandle.id,
            fields: [{ key: 'product', value: list[0].id }],
          });
          const errs = r.metaobjectUpdate.userErrors || [];
          if (errs.length) {
            console.log(`  ${label}  結びつけ失敗 ${JSON.stringify(errs)}`);
            continue;
          }
          linked++;
          console.log(`  ${label}  → ${list[0].title}（${list[0].handle}）を結びつけ`);
          continue;
        }
      }
      console.log(`  ${label}  候補 ${list.length}件`);
      list.slice(0, 5).forEach(n =>
        console.log(`      ${n.productType.padEnd(10)} ${STORE}/products/${n.handle}`)
      );
      pending.push({
        article: p.id,
        label,
        candidates: list.map(n => ({ handle: n.handle, title: n.title, type: n.productType })),
      });
    }
  }

  fs.mkdirSync(path.join(__dirname, 'out'), { recursive: true });
  fs.writeFileSync(
    path.join(__dirname, 'out', 'pickup-candidates.json'),
    JSON.stringify(pending, null, 2) + '\n',
    'utf8'
  );
  console.log(`\n結びつけ ${linked}件 / 要選択 ${pending.length}件`);
}

main().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
