#!/usr/bin/env node
/**
 * いまサイトが持っている Pick Up と News を Shopify へ移す。
 *
 *   SHOPIFY_TOKEN=xxx node tools/migrate-content.js
 *
 * 写真は sr134.com の公開URLから Shopify のファイルへ取り込む。
 * ハンドルは元のidをそのまま使うため、再実行しても重複しない。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const SHOP = process.env.SHOPIFY_SHOP || 'gp9g0i-sk.myshopify.com';
const API_VERSION = process.env.SHOPIFY_API_VERSION || '2026-10';
const TOKEN = process.env.SHOPIFY_TOKEN;
const ENDPOINT = `https://${SHOP}/admin/api/${API_VERSION}/graphql.json`;
const PUBLIC_BASE = 'https://libun.co.jp/sr134-preview';

const FILE_CREATE = `
  mutation($files: [FileCreateInput!]!) {
    fileCreate(files: $files) {
      files { id fileStatus ... on MediaImage { image { url } } }
      userErrors { field message }
    }
  }`;

const FILE_FIND = `
  query($query: String!) {
    files(first: 5, query: $query) { nodes { id fileStatus alt ... on MediaImage { image { url } } } }
  }`;

const UPSERT = `
  mutation($handle: MetaobjectHandleInput!, $metaobject: MetaobjectUpsertInput!) {
    metaobjectUpsert(handle: $handle, metaobject: $metaobject) {
      metaobject { id handle type }
      userErrors { field message code }
    }
  }`;

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function gql(query, variables) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': TOKEN },
      body: JSON.stringify({ query, variables }),
    });
    const json = await res.json();
    if (json.errors && json.errors.some(e => (e.extensions || {}).code === 'THROTTLED')) {
      await sleep(2000 * (attempt + 1));
      continue;
    }
    if (json.errors) throw new Error(json.errors.map(e => e.message).join(' / '));
    return json.data;
  }
  throw new Error('レート制限が解除されませんでした');
}

/** 同じ名前の画像が既にあれば使い回す。無ければ公開URLから取り込む。 */
const fileCache = new Map();
async function uploadImage(relPath, alt) {
  if (fileCache.has(relPath)) return fileCache.get(relPath);
  const base = path.basename(relPath, path.extname(relPath));

  const found = await gql(FILE_FIND, { query: `filename:${base}*` });
  const hit = found.files.nodes.find(n => n.fileStatus === 'READY');
  if (hit) {
    fileCache.set(relPath, hit.id);
    return hit.id;
  }

  const data = await gql(FILE_CREATE, {
    files: [{ originalSource: `${PUBLIC_BASE}/${relPath}`, contentType: 'IMAGE', alt }],
  });
  const r = data.fileCreate;
  if (r.userErrors.length) throw new Error(`${relPath} ${JSON.stringify(r.userErrors)}`);
  const id = r.files[0].id;
  fileCache.set(relPath, id);
  return id;
}

async function upsertObject(type, handle, fields) {
  const data = await gql(UPSERT, {
    handle: { type, handle },
    metaobject: { fields: fields.filter(f => f.value != null && f.value !== '') },
  });
  const r = data.metaobjectUpsert;
  if (r.userErrors.length) throw new Error(`${type}/${handle} ${JSON.stringify(r.userErrors)}`);
  return r.metaobject.id;
}

/** ハンドルに使える文字へ整える。 */
const toHandle = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

async function migratePickups(root) {
  const items = JSON.parse(fs.readFileSync(path.join(root, 'pickup.json'), 'utf8'));
  console.log(`Pick Up ${items.length}件`);
  for (const p of items) {
    const itemIds = [];
    for (const [i, it] of (p.items || []).entries()) {
      const handle = `${toHandle(p.id)}-${i + 1}`;
      const note = [it.brand && it.brand !== '—' ? it.brand : null, it.name, it.note]
        .filter(Boolean)
        .join('\n');
      const id = await upsertObject('pickup_item', handle, [{ key: 'note', value: note }]);
      itemIds.push(id);
    }

    const hero = p.image ? await uploadImage(p.image, p.title) : null;
    await upsertObject('pickup', toHandle(p.id), [
      { key: 'title', value: p.title },
      { key: 'date', value: p.date },
      { key: 'lead', value: p.lead },
      { key: 'story', value: (p.story || []).join('\n\n') },
      { key: 'hero', value: hero },
      { key: 'items', value: JSON.stringify(itemIds) },
    ]);
    console.log(`  移行 ${p.id}（商品 ${itemIds.length}件）`);
  }
}

async function migrateNews(root) {
  const items = JSON.parse(fs.readFileSync(path.join(root, 'news.json'), 'utf8'));
  console.log(`News ${items.length}件`);
  for (const n of items) {
    const card = n.image ? await uploadImage(n.image, n.title) : null;
    const gallery = [];
    for (const src of n.images || []) gallery.push(await uploadImage(src, n.title));

    await upsertObject('news', toHandle(n.id), [
      { key: 'title', value: n.title },
      { key: 'date', value: n.date },
      { key: 'brand', value: n.brand },
      { key: 'lead', value: n.lead },
      { key: 'card_image', value: card },
      { key: 'images', value: JSON.stringify(gallery) },
      { key: 'link', value: n.link },
      { key: 'is_new', value: n.isNew ? 'true' : 'false' },
    ]);
    console.log(`  移行 ${n.id}（写真 ${gallery.length}枚）`);
  }
}

async function main() {
  if (!TOKEN) {
    console.error('SHOPIFY_TOKEN が未設定です。');
    process.exit(1);
  }
  const root = path.join(__dirname, '..');
  await migratePickups(root);
  await migrateNews(root);
  console.log('\n管理画面 https://admin.shopify.com/store/gp9g0i-sk/content/metaobjects');
}

main().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
