#!/usr/bin/env node
/**
 * 全商品のサムネイル（1枚目の画像）を一覧にして、目視で確認できるようにする。
 *
 *   SHOPIFY_TOKEN=xxx node tools/thumbnail-sheet.js
 *
 * tools/out/thumbs-NN.html を出力する。番号は商品に振った通し番号で、
 * 差し替えたいものを tools/out/thumb-fix.json に並べて
 * tools/fix-thumbnails.js で入れ替える。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const SHOP = process.env.SHOPIFY_SHOP || 'gp9g0i-sk.myshopify.com';
const API_VERSION = process.env.SHOPIFY_API_VERSION || '2026-10';
const TOKEN = process.env.SHOPIFY_TOKEN;
const ENDPOINT = `https://${SHOP}/admin/api/${API_VERSION}/graphql.json`;
const PER_SHEET = 120;

const LIST = `
  query($cursor: String) {
    products(first: 100, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes {
        handle
        vendor
        productType
        media(first: 1) { nodes { ... on MediaImage { id image { url } } } }
      }
    }
  }`;

async function gql(query, variables) {
  for (let i = 0; i < 5; i++) {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': TOKEN },
      body: JSON.stringify({ query, variables }),
    });
    const json = await res.json();
    if (json.errors && json.errors.some(e => (e.extensions || {}).code === 'THROTTLED')) {
      await new Promise(r => setTimeout(r, 2000 * (i + 1)));
      continue;
    }
    if (json.errors) throw new Error(json.errors.map(e => e.message).join(' / '));
    return json.data;
  }
  throw new Error('レート制限が解除されませんでした');
}

async function main() {
  if (!TOKEN) {
    console.error('SHOPIFY_TOKEN が未設定です。');
    process.exit(1);
  }
  const all = [];
  let cursor = null;
  for (;;) {
    const d = await gql(LIST, { cursor });
    all.push(...d.products.nodes);
    if (!d.products.pageInfo.hasNextPage) break;
    cursor = d.products.pageInfo.endCursor;
  }
  const rows = all
    .map((p, i) => ({
      no: i + 1,
      handle: p.handle,
      vendor: p.vendor,
      type: p.productType,
      url: p.media.nodes[0] && p.media.nodes[0].image ? p.media.nodes[0].image.url : '',
    }))
    .filter(r => r.url);

  const dir = path.join(__dirname, 'out');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'thumbs.json'), JSON.stringify(rows, null, 2) + '\n', 'utf8');

  const css = `<!doctype html><meta charset="utf-8"><style>
body{margin:0;background:#fff;font:10px system-ui;padding:4px}
.g{display:grid;grid-template-columns:repeat(12,1fr);gap:3px}
figure{margin:0}
img{width:100%;aspect-ratio:1/1;object-fit:cover;display:block;background:#eee}
figcaption{font-size:8px;color:#333;line-height:1.1}
</style>`;
  const sheets = [];
  for (let i = 0; i < rows.length; i += PER_SHEET) {
    const part = rows.slice(i, i + PER_SHEET);
    const cells = part
      .map(r => `<figure><img src="${r.url}&width=220" loading="eager"><figcaption>${r.no}</figcaption></figure>`)
      .join('');
    const n = String(sheets.length + 1).padStart(2, '0');
    const file = path.join(dir, `thumbs-${n}.html`);
    fs.writeFileSync(file, css + '<div class="g">' + cells + '</div>', 'utf8');
    sheets.push(file);
  }

  console.log(`商品 ${rows.length}件 / 一覧 ${sheets.length}枚`);
  sheets.forEach(f => console.log(`  ${f}`));
}

main().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
