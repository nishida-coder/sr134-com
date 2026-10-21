#!/usr/bin/env node
/**
 * 楽天の店舗内検索から、特定キーワードを含む商品のIDを集める。
 *
 * products.json には楽天の商品タイトルが入っておらず、
 * 「26-27秋冬」のようなシーズン表記で絞り込めないため、店舗内検索を使う。
 *
 *   node tools/fetch-rakuten-season.js "26-27秋冬" fw2627
 *
 * 出力は tools/out/season-<slug>.json（商品IDの配列）。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const SHOP = 'studio-route134';
const SID = '262499';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';
const WAIT_MS = 1500;
const MAX_PAGES = 20;

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchPage(keyword, page) {
  const url =
    `https://search.rakuten.co.jp/search/inshop-mall/${encodeURIComponent(keyword)}/` +
    `?sid=${SID}${page > 1 ? `&p=${page}` : ''}`;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } });
      if (res.ok) return res.text();
    } catch (e) {
      /* 次の試行へ */
    }
    await sleep(3000 * (attempt + 1));
  }
  throw new Error(`ページ ${page} を取得できませんでした`);
}

function idsIn(html) {
  const re = new RegExp(`item\\.rakuten\\.co\\.jp/${SHOP}/([a-z0-9_-]+)/`, 'g');
  const out = [];
  for (const m of html.matchAll(re)) {
    if (!out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

async function main() {
  const keyword = process.argv[2];
  const slug = process.argv[3];
  if (!keyword || !slug) {
    console.error('使い方 node tools/fetch-rakuten-season.js "<キーワード>" <slug>');
    process.exit(1);
  }

  const all = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const html = await fetchPage(keyword, page);
    const ids = idsIn(html);
    const fresh = ids.filter(id => !all.includes(id));
    all.push(...fresh);
    console.log(`  ${page}ページ目 ${ids.length}件（新規 ${fresh.length}件）累計 ${all.length}件`);
    if (!fresh.length) break;
    await sleep(WAIT_MS);
  }

  const dir = path.join(__dirname, 'out');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `season-${slug}.json`);
  fs.writeFileSync(file, JSON.stringify(all, null, 2) + '\n', 'utf8');

  // products.json との突き合わせ
  const products = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'products.json'), 'utf8'));
  const known = new Set(products.map(p => p.id));
  const matched = all.filter(id => known.has(id));
  const brands = {};
  products
    .filter(p => matched.includes(p.id))
    .forEach(p => (brands[p.brand] = (brands[p.brand] || 0) + 1));

  console.log(`\n「${keyword}」 ${all.length}件`);
  console.log(`商品データと一致 ${matched.length}件 / 未収録 ${all.length - matched.length}件`);
  console.log('--- ブランド別 ---');
  Object.entries(brands)
    .sort((a, b) => b[1] - a[1])
    .forEach(([k, v]) => console.log(`  ${String(v).padStart(4)} ${k}`));
  console.log(`\n保存先 ${file}`);
}

main().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
