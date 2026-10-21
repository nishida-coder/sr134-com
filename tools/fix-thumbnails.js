#!/usr/bin/env node
/**
 * サムネイル（1枚目の画像）が値札や告知パネルになっている商品について、
 * 別の画像を1枚目に入れ替える。
 *
 *   SHOPIFY_TOKEN=xxx node tools/fix-thumbnails.js --sheet   対象商品の全画像を一覧にする
 *   SHOPIFY_TOKEN=xxx node tools/fix-thumbnails.js --apply   tools/out/thumb-choice.json のとおりに入れ替える
 *
 * thumb-choice.json は { "<handle>": <1始まりの画像番号> } の形。
 * 一覧の番号を見て決める。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const SHOP = process.env.SHOPIFY_SHOP || 'gp9g0i-sk.myshopify.com';
const API_VERSION = process.env.SHOPIFY_API_VERSION || '2026-10';
const TOKEN = process.env.SHOPIFY_TOKEN;
const ENDPOINT = `https://${SHOP}/admin/api/${API_VERSION}/graphql.json`;
const OUT = path.join(__dirname, 'out');

const FIND = `
  query($handle: String!) {
    productByIdentifier(identifier: { handle: $handle }) {
      id
      media(first: 20) { nodes { ... on MediaImage { id image { url } } } }
    }
  }`;

const REORDER = `
  mutation($id: ID!, $moves: [MoveInput!]!) {
    productReorderMedia(id: $id, moves: $moves) {
      job { id }
      userErrors { field message }
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

async function load() {
  const targets = JSON.parse(fs.readFileSync(path.join(OUT, 'thumb-targets.json'), 'utf8'));
  const out = [];
  for (const t of targets) {
    const d = await gql(FIND, { handle: t.handle });
    const p = d.productByIdentifier;
    if (!p) continue;
    out.push({
      handle: t.handle,
      id: p.id,
      media: p.media.nodes.filter(n => n && n.image).map(n => ({ id: n.id, url: n.image.url })),
    });
  }
  return out;
}

async function sheet() {
  const items = await load();
  const css = `<!doctype html><meta charset="utf-8"><style>
body{margin:0;background:#fff;font:11px system-ui;padding:6px}
h3{font-size:12px;margin:10px 0 4px}
.g{display:grid;grid-template-columns:repeat(10,1fr);gap:4px}
figure{margin:0}
img{width:100%;aspect-ratio:1/1;object-fit:cover;display:block;background:#eee}
figcaption{font-size:9px;color:#333}
.first img{outline:2px solid #C2271F;outline-offset:-2px}
</style>`;
  const body = items
    .map(
      it =>
        `<h3>${it.handle}</h3><div class="g">` +
        it.media
          .map(
            (m, i) =>
              `<figure class="${i === 0 ? 'first' : ''}"><img src="${m.url}&width=220"><figcaption>${i + 1}</figcaption></figure>`
          )
          .join('') +
        '</div>'
    )
    .join('');
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'thumb-fix.html'), css + body, 'utf8');
  fs.writeFileSync(path.join(OUT, 'thumb-media.json'), JSON.stringify(items, null, 2) + '\n', 'utf8');
  console.log(`一覧 ${path.join(OUT, 'thumb-fix.html')}（赤枠が現在のサムネイル）`);
}

async function apply() {
  const items = JSON.parse(fs.readFileSync(path.join(OUT, 'thumb-media.json'), 'utf8'));
  const choice = JSON.parse(fs.readFileSync(path.join(OUT, 'thumb-choice.json'), 'utf8'));
  let ok = 0;
  for (const it of items) {
    const pick = choice[it.handle];
    if (!pick || pick === 1) continue;
    const target = it.media[pick - 1];
    if (!target) {
      console.log(`  NG ${it.handle} ${pick}枚目が無い`);
      continue;
    }
    const r = await gql(REORDER, {
      id: it.id,
      moves: [{ id: target.id, newPosition: '0' }],
    });
    const errs = r.productReorderMedia.userErrors || [];
    if (errs.length) {
      console.log(`  NG ${it.handle} ${JSON.stringify(errs)}`);
      continue;
    }
    ok++;
    console.log(`  ${it.handle} → ${pick}枚目をサムネイルに`);
  }
  console.log(`\n入れ替え ${ok}件`);
}

async function main() {
  if (!TOKEN) {
    console.error('SHOPIFY_TOKEN が未設定です。');
    process.exit(1);
  }
  if (process.argv.includes('--apply')) await apply();
  else await sheet();
}

main().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
