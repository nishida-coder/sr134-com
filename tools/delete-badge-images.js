#!/usr/bin/env node
/**
 * detect-badge-images.js が拾った画像を商品から外す。
 *
 *   SHOPIFY_TOKEN=xxx node tools/delete-badge-images.js --dry-run   対象を数えるだけ
 *   SHOPIFY_TOKEN=xxx node tools/delete-badge-images.js             実行
 *
 * 商品の画像が1枚だけになる場合は外さない（商品が無画像になるのを防ぐ）。
 * 外した記録は tools/out/badge-removed.json に残す。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const SHOP = process.env.SHOPIFY_SHOP || 'gp9g0i-sk.myshopify.com';
const API_VERSION = process.env.SHOPIFY_API_VERSION || '2026-10';
const TOKEN = process.env.SHOPIFY_TOKEN;
const ENDPOINT = `https://${SHOP}/admin/api/${API_VERSION}/graphql.json`;

const COUNT = `
  query($handle: String!) {
    productByIdentifier(identifier: { handle: $handle }) {
      id
      status
      media(first: 30) { nodes { ... on MediaImage { id } } }
    }
  }`;

const DRAFT = `
  mutation($input: ProductUpdateInput!) {
    productUpdate(product: $input) { product { status } userErrors { message } }
  }`;

const DELETE = `
  mutation($productId: ID!, $mediaIds: [ID!]!) {
    productDeleteMedia(productId: $productId, mediaIds: $mediaIds) {
      deletedMediaIds
      mediaUserErrors { field message }
    }
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
  if (!TOKEN) {
    console.error('SHOPIFY_TOKEN が未設定です。');
    process.exit(1);
  }
  const dryRun = process.argv.includes('--dry-run');
  const file = path.join(__dirname, 'out', 'badge-candidates.json');
  const candidates = JSON.parse(fs.readFileSync(file, 'utf8'));

  const byHandle = new Map();
  for (const c of candidates) {
    if (!byHandle.has(c.handle)) byHandle.set(c.handle, []);
    byHandle.get(c.handle).push(c);
  }
  console.log(`対象 ${candidates.length}枚 / ${byHandle.size}商品` + (dryRun ? '（確認のみ）' : ''));

  const removed = [];
  const skipped = [];
  for (const [handle, list] of byHandle) {
    const data = await gql(COUNT, { handle });
    const p = data.productByIdentifier;
    if (!p) {
      skipped.push(`${handle} 商品が見つからない`);
      continue;
    }
    const total = p.media.nodes.filter(Boolean).length;
    const ids = list.map(c => c.mediaId);
    // 画像が無くなっても削除は必ず行う。SALE等の表示を残すほうが重大なため。
    // そのかわり、無画像のまま公開しないよう下書きへ落とす。
    const willBeEmpty = total - ids.length < 1;
    if (dryRun) {
      removed.push({ handle, count: ids.length, remain: total - ids.length, willBeEmpty });
      continue;
    }
    const r = await gql(DELETE, { productId: p.id, mediaIds: ids });
    const errs = r.productDeleteMedia.mediaUserErrors || [];
    if (errs.length) {
      skipped.push(`${handle} ${errs.map(e => e.message).join(', ')}`);
      continue;
    }
    removed.push({ handle, count: r.productDeleteMedia.deletedMediaIds.length, remain: total - ids.length });
    if (willBeEmpty && p.status === 'ACTIVE') {
      const u = await gql(DRAFT, { input: { id: p.id, status: 'DRAFT' } });
      const ue = u.productUpdate.userErrors || [];
      skipped.push(
        ue.length
          ? `${handle} 下書き化に失敗 ${ue.map(e => e.message).join(', ')}`
          : `${handle} 画像が無くなったため下書きにした`
      );
    }
  }

  if (!dryRun) {
    fs.writeFileSync(
      path.join(__dirname, 'out', 'badge-removed.json'),
      JSON.stringify(removed, null, 2) + '\n',
      'utf8'
    );
  }
  const totalRemoved = removed.reduce((s, r) => s + r.count, 0);
  console.log(`${dryRun ? '削除予定' : '削除'} ${totalRemoved}枚 / ${removed.length}商品`);
  if (skipped.length) {
    console.log(`見送り ${skipped.length}件`);
    skipped.slice(0, 10).forEach(s => console.log(`  ${s}`));
  }
}

main().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
