#!/usr/bin/env node
/**
 * 取得済みの商品データについて、ブランドと品目だけを判定し直す。
 * 楽天へのアクセスは発生しない。
 *
 *   node tools/redetect-items.js tools/out/items-fw2627.json
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// 判定表は取得スクリプトと共用したいが、簡潔さを優先して読み込みで取り出す
const src = fs.readFileSync(path.join(__dirname, 'fetch-rakuten-items.js'), 'utf8');
const pick = name => {
  const start = src.indexOf(`const ${name} = [`);
  const end = src.indexOf('];', start) + 2;
  return eval(src.slice(start + `const ${name} = `.length, end));
};
const BRANDS = pick('BRANDS');
const CATEGORIES = pick('CATEGORIES');

function decodeEntities(s) {
  return String(s)
    .replace(/&amp;/g, '&')
    .replace(/&times;/g, '×')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function detect(title, table, fallback) {
  const upper = decodeEntities(title).toUpperCase();
  for (const [needle, value] of table) {
    if (upper.includes(needle)) return value;
  }
  return fallback;
}

function main() {
  const file = path.resolve(process.argv[2]);
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  let changed = 0;
  for (const row of Object.values(data)) {
    row.title = decodeEntities(row.title);
    const brand = detect(row.title, BRANDS, '');
    const category = detect(row.title, CATEGORIES, 'Item');
    if (row.brand !== brand || row.category !== category) changed++;
    row.brand = brand;
    row.category = category;
  }
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8');

  const rows = Object.values(data);
  const brands = {};
  rows.forEach(r => (brands[r.brand || '(不明)'] = (brands[r.brand || '(不明)'] || 0) + 1));
  console.log(`${rows.length}件のうち ${changed}件を更新`);
  console.log(`ブランド不明 ${rows.filter(r => !r.brand).length}件 / 品目不明 ${rows.filter(r => r.category === 'Item').length}件`);
  console.log('--- ブランド別 ---');
  Object.entries(brands)
    .sort((a, b) => b[1] - a[1])
    .forEach(([k, v]) => console.log(`  ${String(v).padStart(4)} ${k}`));
}

main();
