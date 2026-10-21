#!/usr/bin/env node
/**
 * 全商品画像の「左上の角」だけを並べた一覧を作る。
 * 焼き込まれた帯（MEN / SALE / 定番 / PICK UP など）は必ず左上にあるため、
 * 角だけを見れば短時間で全数確認できる。
 *
 *   SHOPIFY_TOKEN=xxx node tools/corner-sheet.js
 *
 * tools/out/corner-NN.html を出力し、通し番号を tools/out/corner-index.json に残す。
 * 帯があったものの番号を tools/out/corner-bad.json に並べて
 * tools/delete-corner-images.js で削除する。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const SHOP = process.env.SHOPIFY_SHOP || 'gp9g0i-sk.myshopify.com';
const API_VERSION = process.env.SHOPIFY_API_VERSION || '2026-10';
const TOKEN = process.env.SHOPIFY_TOKEN;
const ENDPOINT = `https://${SHOP}/admin/api/${API_VERSION}/graphql.json`;
const OUT = path.join(__dirname, 'out');
const PER_SHEET = 210;

// 表示する角の大きさ。元画像を 560px 幅で読み、その左上だけを切り出す
const SCALE = 560;
const CELL_W = 150;
const CELL_H = 42;

const LIST = `
  query($cursor: String) {
    products(first: 100, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes {
        handle
        media(first: 20) { nodes { ... on MediaImage { id image { url } } } }
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
  const products = [];
  let cursor = null;
  for (;;) {
    const d = await gql(LIST, { cursor });
    products.push(...d.products.nodes);
    if (!d.products.pageInfo.hasNextPage) break;
    cursor = d.products.pageInfo.endCursor;
  }

  const rows = [];
  for (const p of products) {
    for (const m of p.media.nodes) {
      if (m && m.image) rows.push({ no: rows.length + 1, handle: p.handle, mediaId: m.id, url: m.image.url });
    }
  }
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'corner-index.json'), JSON.stringify(rows, null, 2) + '\n', 'utf8');

  const css = `<!doctype html><meta charset="utf-8"><style>
body{margin:0;background:#9aa;font:9px system-ui;padding:3px}
.g{display:grid;grid-template-columns:repeat(7,1fr);gap:3px}
.c{position:relative;height:${CELL_H}px;background:#fff no-repeat 0 0;background-size:${SCALE}px auto;}
.n{position:absolute;right:1px;bottom:0;font-size:8px;color:#06c;background:rgba(255,255,255,.75);padding:0 2px}
</style>`;
  const sheets = [];
  for (let i = 0; i < rows.length; i += PER_SHEET) {
    const part = rows.slice(i, i + PER_SHEET);
    const cells = part
      .map(r => `<div class="c" style="background-image:url('${r.url}&width=${SCALE}')"><span class="n">${r.no}</span></div>`)
      .join('');
    const n = String(sheets.length + 1).padStart(2, '0');
    const file = path.join(OUT, `corner-${n}.html`);
    fs.writeFileSync(file, css + '<div class="g">' + cells + '</div>', 'utf8');
    sheets.push(file);
  }

  console.log(`画像 ${rows.length}枚 / 一覧 ${sheets.length}枚（1枚あたり ${PER_SHEET}）`);
  sheets.forEach(f => console.log(`  ${f}`));
}

main().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
