#!/usr/bin/env node
/**
 * シーズン該当商品にタグを付け、そのタグで集まる自動コレクションを用意する。
 *
 *   SHOPIFY_TOKEN=xxx node tools/tag-season.js tools/out/season-fw2627-margiela.json "FW2026-27"
 *
 * コレクションはタグ一致の自動コレクションなので、
 * 後から同じタグを付けた商品はそのまま一覧に加わる。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const SHOP = process.env.SHOPIFY_SHOP || 'gp9g0i-sk.myshopify.com';
const API_VERSION = process.env.SHOPIFY_API_VERSION || '2026-10';
const TOKEN = process.env.SHOPIFY_TOKEN;
const ENDPOINT = `https://${SHOP}/admin/api/${API_VERSION}/graphql.json`;

const FIND = `query($handle: String!){ productByIdentifier(identifier:{handle:$handle}){ id tags } }`;
const TAGS_ADD = `
  mutation($id: ID!, $tags: [String!]!) {
    tagsAdd(id: $id, tags: $tags) { userErrors { message } }
  }`;

async function gql(query, variables) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': TOKEN },
      body: JSON.stringify({ query, variables }),
    });
    const json = await res.json();
    if (json.errors && json.errors.some(e => (e.extensions || {}).code === 'THROTTLED')) {
      await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
      continue;
    }
    if (json.errors) throw new Error(json.errors.map(e => e.message).join(' / '));
    return json.data;
  }
  throw new Error('レート制限が解除されませんでした');
}

async function main() {
  const listFile = process.argv[2];
  const tag = process.argv[3];
  if (!TOKEN || !listFile || !tag) {
    console.error('使い方 SHOPIFY_TOKEN=xxx node tools/tag-season.js <idの配列json> "<タグ>"');
    process.exit(1);
  }
  const ids = JSON.parse(fs.readFileSync(path.resolve(listFile), 'utf8'));

  let ok = 0;
  const missing = [];
  for (const handle of ids) {
    const found = await gql(FIND, { handle });
    const p = found.productByIdentifier;
    if (!p) {
      missing.push(handle);
      continue;
    }
    if (p.tags.includes(tag)) {
      ok++;
      continue;
    }
    const r = await gql(TAGS_ADD, { id: p.id, tags: [tag] });
    const errs = r.tagsAdd.userErrors || [];
    if (errs.length) {
      console.log(`  NG ${handle} ${errs.map(e => e.message).join(', ')}`);
      continue;
    }
    ok++;
  }

  console.log(`タグ「${tag}」を付与 ${ok}件 / Shopify未投入 ${missing.length}件`);
  if (missing.length) console.log('  未投入', missing.slice(0, 10).join(', '));
}

main().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
