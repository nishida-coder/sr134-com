#!/usr/bin/env node
/**
 * Pick Up と News を Shopify の管理画面から更新できるようにする。
 *
 *   SHOPIFY_TOKEN=xxx node tools/setup-metaobjects.js
 *
 * 作る定義は3つ。いずれもストア所有なので、このアプリを外しても残る。
 *   pickup_item  コーディネートの1点。商品を選び、一言を添える
 *   pickup       コーディネート記事。写真と本文と、上の明細の並び
 *   news         お知らせ。写真複数と本文
 *
 * 何度実行しても同じ結果になる（既にあれば項目の追加だけ行う）。
 */
'use strict';

const SHOP = process.env.SHOPIFY_SHOP || 'gp9g0i-sk.myshopify.com';
const API_VERSION = process.env.SHOPIFY_API_VERSION || '2026-10';
const TOKEN = process.env.SHOPIFY_TOKEN;
const ENDPOINT = `https://${SHOP}/admin/api/${API_VERSION}/graphql.json`;

const LIST = `
  query {
    metaobjectDefinitions(first: 50) {
      nodes { id type name fieldDefinitions { key } }
    }
  }`;

const CREATE = `
  mutation($definition: MetaobjectDefinitionCreateInput!) {
    metaobjectDefinitionCreate(definition: $definition) {
      metaobjectDefinition { id type }
      userErrors { field message code }
    }
  }`;

const UPDATE = `
  mutation($id: ID!, $definition: MetaobjectDefinitionUpdateInput!) {
    metaobjectDefinitionUpdate(id: $id, definition: $definition) {
      metaobjectDefinition { id type }
      userErrors { field message code }
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

const text = (key, name, description) => ({
  key,
  name,
  description,
  type: 'single_line_text_field',
});
const multiline = (key, name, description) => ({
  key,
  name,
  description,
  type: 'multi_line_text_field',
});
const image = (key, name, description) => ({
  key,
  name,
  description,
  type: 'file_reference',
  validations: [{ name: 'file_type_options', value: JSON.stringify(['Image']) }],
});

function definitions(pickupItemId) {
  return [
    {
      type: 'pickup_item',
      name: 'Pick Up の商品',
      description: 'コーディネートに含まれる1点。商品を選ぶと写真と価格とリンクが自動で入ります。',
      displayNameKey: 'note',
      access: { storefront: 'PUBLIC_READ' },
      fieldDefinitions: [
        {
          key: 'product',
          name: '商品',
          description: 'ストアの商品から選びます',
          type: 'product_reference',
        },
        multiline('note', '一言', 'この商品についての短い説明'),
      ],
    },
    {
      type: 'pickup',
      name: 'Pick Up',
      description: '週ごとのコーディネート特集。サイトのPick Upに出ます。',
      displayNameKey: 'title',
      access: { storefront: 'PUBLIC_READ' },
      fieldDefinitions: [
        text('title', 'タイトル', '例 白いニットに、濃いデニム。'),
        text('date', '日付', '例 2026.10'),
        multiline('lead', 'リード文', '一覧とページ上部に出る短い導入'),
        multiline('story', '本文', '段落ごとに空行で区切ってください'),
        image('hero', 'メイン写真', '一覧とページ上部に出る写真'),
        {
          key: 'items',
          name: 'この組み合わせ',
          description: '紹介する商品を並べます',
          type: 'list.metaobject_reference',
          validations: pickupItemId
            ? [{ name: 'metaobject_definition_id', value: pickupItemId }]
            : [],
        },
      ],
    },
    {
      type: 'news',
      name: 'News',
      description: 'お知らせ。サイトのNEWSに出ます。',
      displayNameKey: 'title',
      access: { storefront: 'PUBLIC_READ' },
      fieldDefinitions: [
        text('title', 'タイトル', ''),
        text('date', '日付', '例 2026.09'),
        text('brand', 'ブランド名', 'カードの日付の横に出ます。空でも構いません'),
        multiline('lead', '本文', '段落ごとに空行で区切ってください'),
        image('card_image', 'カード写真', 'TOPのカードに出る1枚'),
        {
          key: 'images',
          name: '記事の写真',
          description: '記事ページに横並びで出ます',
          type: 'list.file_reference',
          validations: [{ name: 'file_type_options', value: JSON.stringify(['Image']) }],
        },
        { key: 'link', name: 'リンク先', description: '記事の下のボタンの飛び先', type: 'url' },
      ],
    },
  ];
}

async function upsert(def, existingByType) {
  const found = existingByType.get(def.type);
  if (!found) {
    const data = await gql(CREATE, { definition: def });
    const r = data.metaobjectDefinitionCreate;
    if (r.userErrors.length) throw new Error(`${def.type} ${JSON.stringify(r.userErrors)}`);
    console.log(`  作成 ${def.type}`);
    return r.metaobjectDefinition.id;
  }

  const have = new Set(found.fieldDefinitions.map(f => f.key));
  const missing = def.fieldDefinitions.filter(f => !have.has(f.key));
  if (!missing.length) {
    console.log(`  既存 ${def.type}（変更なし）`);
    return found.id;
  }
  const data = await gql(UPDATE, {
    id: found.id,
    definition: { fieldDefinitions: missing.map(create => ({ create })) },
  });
  const r = data.metaobjectDefinitionUpdate;
  if (r.userErrors.length) throw new Error(`${def.type} ${JSON.stringify(r.userErrors)}`);
  console.log(`  更新 ${def.type}（項目を${missing.length}件追加）`);
  return found.id;
}

async function main() {
  if (!TOKEN) {
    console.error('SHOPIFY_TOKEN が未設定です。');
    process.exit(1);
  }
  const list = await gql(LIST, {});
  const byType = new Map(list.metaobjectDefinitions.nodes.map(n => [n.type, n]));

  // pickup_item を先に作り、そのIDを pickup の参照先に渡す
  const defs = definitions(byType.get('pickup_item') ? byType.get('pickup_item').id : null);
  const itemId = await upsert(defs[0], byType);

  const rest = definitions(itemId).slice(1);
  for (const def of rest) await upsert(def, byType);

  console.log('\n管理画面 https://admin.shopify.com/store/gp9g0i-sk/content/metaobjects');
}

main().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
