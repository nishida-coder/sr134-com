#!/usr/bin/env node
/**
 * tools/out/collections.json を Shopify の自動コレクションとして作成または更新する。
 *
 * 事前に tools/make-shopify-collections.js を実行して定義を出しておくこと。
 * 認証は Dev Dashboard アプリの client_credentials 交換で得たトークンを使う。
 * トークンは約24時間で失効するため、毎回 get-token.js で取り直す。
 *
 *   SHOPIFY_TOKEN=xxx node tools/create-shopify-collections.js            全件
 *   SHOPIFY_TOKEN=xxx node tools/create-shopify-collections.js marni      1件だけ
 */
'use strict';

const fs = require('fs');
const path = require('path');

const SHOP = process.env.SHOPIFY_SHOP || 'gp9g0i-sk.myshopify.com';
const API_VERSION = process.env.SHOPIFY_API_VERSION || '2026-10';
const TOKEN = process.env.SHOPIFY_TOKEN;

const ENDPOINT = `https://${SHOP}/admin/api/${API_VERSION}/graphql.json`;

const FIND = `
  query($handle: String!) {
    collectionByIdentifier(identifier: { handle: $handle }) { id handle }
  }`;

const CREATE = `
  mutation($input: CollectionInput!) {
    collectionCreate(input: $input) {
      collection { id handle title image { url } ruleSet { rules { column relation condition } } }
      userErrors { field message }
    }
  }`;

const UPDATE = `
  mutation($input: CollectionInput!) {
    collectionUpdate(input: $input) {
      collection { id handle title image { url } ruleSet { rules { column relation condition } } }
      userErrors { field message }
    }
  }`;

const PUBLICATIONS = `
  query { publications(first: 20) { edges { node { id name } } } }`;

const PUBLISH = `
  mutation($id: ID!, $input: [PublicationInput!]!) {
    publishablePublish(id: $id, input: $input) {
      userErrors { field message }
    }
  }`;

async function gql(query, variables) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': TOKEN,
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) {
    throw new Error(json.errors.map(e => e.message).join(' / '));
  }
  return json.data;
}

function toInput(c) {
  const input = {
    title: c.title,
    handle: c.handle,
    descriptionHtml: c.descriptionHtml,
    sortOrder: c.sortOrder,
    ruleSet: {
      appliedDisjunctively: false,
      rules: [{ column: 'VENDOR', relation: 'EQUALS', condition: c.vendor }],
    },
  };
  if (c.imageSrc) {
    input.image = { src: c.imageSrc, altText: c.imageAlt };
  }
  return input;
}

async function upsert(c) {
  const found = await gql(FIND, { handle: c.handle });
  const existing = found.collectionByIdentifier;
  const input = toInput(c);
  if (existing) {
    input.id = existing.id;
    const data = await gql(UPDATE, { input });
    return { action: '更新', ...data.collectionUpdate };
  }
  const data = await gql(CREATE, { input });
  return { action: '作成', ...data.collectionCreate };
}

/** 作成直後のコレクションはどのチャネルにも載らないため、オンラインストアへ公開する。 */
async function publish(collectionId, publicationId) {
  const data = await gql(PUBLISH, {
    id: collectionId,
    input: [{ publicationId }],
  });
  return data.publishablePublish.userErrors || [];
}

async function onlineStorePublicationId() {
  const data = await gql(PUBLICATIONS, {});
  const node = data.publications.edges
    .map(e => e.node)
    .find(n => n.name === 'Online Store');
  return node ? node.id : null;
}

async function main() {
  if (!TOKEN) {
    console.error('SHOPIFY_TOKEN が未設定です。tools/get-token.js で取得してください。');
    process.exit(1);
  }
  const all = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'out', 'collections.json'), 'utf8')
  );
  const only = process.argv[2];
  const targets = only ? all.filter(c => c.handle === only) : all;
  if (!targets.length) {
    console.error(`対象が見つかりません: ${only}`);
    process.exit(1);
  }

  const pubId = await onlineStorePublicationId();
  if (!pubId) {
    console.error('オンラインストアの販売チャネルが見つかりません。');
    process.exit(1);
  }

  let ok = 0;
  const failed = [];
  for (const c of targets) {
    try {
      const r = await upsert(c);
      if (r.userErrors && r.userErrors.length) {
        failed.push(`${c.title} -> ${r.userErrors.map(e => `${e.field} ${e.message}`).join(', ')}`);
        continue;
      }
      const pubErrors = await publish(r.collection.id, pubId);
      if (pubErrors.length) {
        failed.push(`${c.title} 公開 -> ${pubErrors.map(e => e.message).join(', ')}`);
        continue;
      }
      ok++;
      const img = r.collection.image ? '画像あり' : '画像なし';
      console.log(`${r.action} ${r.collection.handle} (${r.collection.title}) ${img} 公開済`);
    } catch (e) {
      failed.push(`${c.title} -> ${e.message}`);
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
