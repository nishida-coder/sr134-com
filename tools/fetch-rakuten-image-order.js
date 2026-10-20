#!/usr/bin/env node
/**
 * 楽天の商品ページから、画像の「登録順」を取り直す。
 *
 * products.json の images はスクレイプ時の並びで、店舗が登録した順序とは一致しない。
 * 楽天の商品ページには images:[{type,location,alt}] が登録順のまま埋まっているため、
 * そこから正しい並びを取得して tools/out/rakuten-images-<brand>.json に保存する。
 *
 *   node tools/fetch-rakuten-image-order.js "Maison Margiela"
 *   node tools/fetch-rakuten-image-order.js "Maison Margiela" --limit 5
 */
'use strict';

const fs = require('fs');
const path = require('path');

const BASE = 'https://tshop.r10s.jp/studio-route134/cabinet';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';
const WAIT_MS = 400; // 相手先に負荷をかけない

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchOrder(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  const block = html.match(/"images"\s*:\s*\[(.*?)\]/s);
  if (!block) return [];
  const locations = [...block[1].matchAll(/"location"\s*:\s*"([^"]+)"/g)].map(m => m[1]);
  const seen = new Set();
  return locations
    .map(loc => BASE + loc)
    .filter(u => !/evidence/i.test(u))
    .filter(u => (seen.has(u) ? false : (seen.add(u), true)));
}

async function main() {
  const brand = process.argv[2];
  if (!brand) {
    console.error('使い方 node tools/fetch-rakuten-image-order.js "<ブランド名>"');
    process.exit(1);
  }
  const limitArg = process.argv.indexOf('--limit');
  const limit = limitArg > -1 ? Number(process.argv[limitArg + 1]) : Infinity;

  const all = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'products.json'), 'utf8'));
  const targets = all.filter(p => p.brand === brand && p.rakuten).slice(0, limit);
  console.log(`${brand} ${targets.length} 件の画像順を取得します`);

  const out = {};
  const failed = [];
  for (let i = 0; i < targets.length; i++) {
    const p = targets[i];
    try {
      const order = await fetchOrder(p.rakuten);
      if (!order.length) throw new Error('画像リストが見つからない');
      out[p.id] = order;
      if ((i + 1) % 20 === 0) console.log(`  ${i + 1} / ${targets.length}`);
    } catch (e) {
      failed.push(`${p.id} -> ${e.message}`);
    }
    await sleep(WAIT_MS);
  }

  const dir = path.join(__dirname, 'out');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `rakuten-images-${brand.replace(/\s+/g, '-').toLowerCase()}.json`);
  fs.writeFileSync(file, JSON.stringify(out, null, 2) + '\n', 'utf8');

  const counts = Object.values(out).map(a => a.length);
  console.log(`\n取得 ${Object.keys(out).length} 件 / 失敗 ${failed.length} 件`);
  if (counts.length) {
    console.log(`1商品あたりの枚数 最小${Math.min(...counts)} 最大${Math.max(...counts)}`);
  }
  console.log(`保存先 ${file}`);
  failed.slice(0, 10).forEach(f => console.log(`  NG ${f}`));
}

main().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
