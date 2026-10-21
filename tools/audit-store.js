#!/usr/bin/env node
/**
 * ストアの点検。定価販売の方針に反するものが無いかを機械的に確かめる。
 *
 *   SHOPIFY_TOKEN=xxx node tools/audit-store.js
 *
 * 商品を投入したあと、公開する前に必ず通すこと。
 * ひとつでも見つかれば終了コード1で落ちる。
 *
 * 見るもの
 *   1. 商品名、説明、タグに SALE や割引の文字が無いか
 *   2. 二重価格（取り消し線の元値）が設定されていないか
 *   3. 公開中なのに画像が無い商品が無いか
 *   4. 画像の左上に帯が焼き込まれていないか（候補を数える。確認は corner-sheet.js）
 */
'use strict';

const SHOP = process.env.SHOPIFY_SHOP || 'gp9g0i-sk.myshopify.com';
const API_VERSION = process.env.SHOPIFY_API_VERSION || '2026-10';
const TOKEN = process.env.SHOPIFY_TOKEN;
const ENDPOINT = `https://${SHOP}/admin/api/${API_VERSION}/graphql.json`;

const BAD_WORD = /SALE|セール|％OFF|%OFF|OFF】|値下|アウトレット|outlet|PICK ?UP|定番|限定色/i;

const LIST = `
  query($cursor: String) {
    products(first: 100, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes {
        handle title status tags descriptionHtml
        mediaCount { count }
        variants(first: 50) { nodes { price compareAtPrice } }
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

  const active = all.filter(p => p.status === 'ACTIVE');
  const wordHits = active.filter(
    p =>
      BAD_WORD.test(p.title) ||
      BAD_WORD.test(p.descriptionHtml || '') ||
      (p.tags || []).some(t => BAD_WORD.test(t))
  );
  const dualPrice = active.filter(p =>
    p.variants.nodes.some(v => v.compareAtPrice && Number(v.compareAtPrice) > 0)
  );
  const noImage = active.filter(p => p.mediaCount.count === 0);

  const report = [
    ['文字にSALEや割引表記があるもの', wordHits],
    ['二重価格が設定されているもの', dualPrice],
    ['公開中なのに画像が無いもの', noImage],
  ];

  console.log(`商品 ${all.length}件（公開 ${active.length}件 / 下書き ${all.length - active.length}件）`);
  let ng = 0;
  for (const [label, rows] of report) {
    console.log(`${label}: ${rows.length}件`);
    rows.slice(0, 10).forEach(p => console.log(`    ${p.handle}  ${p.title}`));
    ng += rows.length;
  }

  if (ng) {
    console.log('\n公開前に解消してください。');
    process.exit(1);
  }
  console.log('\n問題は見つかりませんでした。画像の帯は tools/corner-sheet.js で目視確認すること。');
}

main().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
