#!/usr/bin/env node
/**
 * Dev Dashboard アプリの client_credentials から Admin API トークンを取得して標準出力へ出す。
 * Dev Dashboard のアプリは静的トークンを持たず、約24時間で失効するため都度取得する。
 *
 * 資格情報はリポジトリに置かない。C:\libunworks\data\credentials.md から環境変数で渡す。
 *
 *   SHOPIFY_CLIENT_ID=xxx SHOPIFY_CLIENT_SECRET=yyy node tools/get-token.js
 */
'use strict';

const SHOP = process.env.SHOPIFY_SHOP || 'gp9g0i-sk.myshopify.com';
const clientId = process.env.SHOPIFY_CLIENT_ID;
const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;

async function main() {
  if (!clientId || !clientSecret) {
    console.error('SHOPIFY_CLIENT_ID と SHOPIFY_CLIENT_SECRET が必要です。');
    process.exit(1);
  }
  const res = await fetch(`https://${SHOP}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'client_credentials',
    }),
  });
  if (!res.ok) {
    console.error(`トークン取得に失敗しました HTTP ${res.status}`);
    const text = await res.text();
    const m = text.match(/Oauth error ([a-z_]+)/);
    if (m) console.error(`理由 ${m[1]}`);
    process.exit(1);
  }
  const json = await res.json();
  process.stdout.write(json.access_token);
}

main().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
