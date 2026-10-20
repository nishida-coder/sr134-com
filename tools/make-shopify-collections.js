#!/usr/bin/env node
/**
 * brands.json から Shopify のブランドコレクション定義を書き出す。
 *
 * 出力は2系統。
 *   1. collections.json   Admin API で一括生成するときの入力
 *   2. Matrixify 用CSV     Dev Dashboard が使えない場合の代替ルート
 *      無料枠は1回10件までのため CHUNK 件ずつ分割する
 *
 * 画像は Shopify が取得できる公開URLで渡す必要があるため、
 * sr134.com の /photos/brands/ を参照する（工事中でもこの階層だけ通してある）。
 *
 *   node tools/make-shopify-collections.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'tools', 'out');
const PUBLIC_BASE = 'https://sr134.com';
const CHUNK = 10; // Matrixify 無料枠の1ジョブ上限

function loadBrands() {
  const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'brands.json'), 'utf8'));
  return Array.isArray(raw) ? raw : raw.brands || [];
}

function bodyHtml(brand) {
  const paragraphs = [brand.lead, ...(brand.body || [])]
    .map(t => (t || '').trim())
    .filter(Boolean)
    .map(t => `<p>${escapeHtml(t)}</p>`);
  return paragraphs.join('\n');
}

function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function imageUrl(brand) {
  if (!brand.hero) return '';
  return `${PUBLIC_BASE}/${brand.hero.replace(/^\//, '')}`;
}

/**
 * コレクションの抽出条件は「商品のベンダーがブランド名と一致」。
 * 商品投入時に vendor を brands.json の name に揃えることが前提になる。
 */
function toCollection(brand) {
  return {
    handle: brand.id,
    title: brand.name,
    descriptionHtml: bodyHtml(brand),
    imageSrc: imageUrl(brand),
    imageAlt: `${brand.name} ブランドイメージ`,
    vendor: brand.name,
    sortOrder: 'BEST_SELLING',
    published: true,
  };
}

const CSV_HEADER = [
  'Handle',
  'Title',
  'Body HTML',
  'Sort Order',
  'Published',
  'Published Scope',
  'Image Src',
  'Image Alt Text',
  'Must Match',
  'Rule: Product Column',
  'Rule: Relation',
  'Rule: Condition',
];

function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function csvRow(c) {
  return [
    c.handle,
    c.title,
    c.descriptionHtml,
    'best-selling',
    'TRUE',
    'global',
    c.imageSrc,
    c.imageSrc ? c.imageAlt : '',
    'all conditions',
    'Vendor',
    'Equals',
    c.vendor,
  ].map(csvCell).join(',');
}

function main() {
  const brands = loadBrands();
  const collections = brands.map(toCollection);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(OUT_DIR, 'collections.json'),
    JSON.stringify(collections, null, 2) + '\n',
    'utf8'
  );

  const files = [];
  for (let i = 0; i < collections.length; i += CHUNK) {
    const part = collections.slice(i, i + CHUNK);
    const no = String(i / CHUNK + 1).padStart(2, '0');
    const name = `Smart Collections ${no}.csv`;
    const body = [CSV_HEADER.join(','), ...part.map(csvRow)].join('\r\n') + '\r\n';
    // Excel と Matrixify の双方で文字化けしないよう BOM を付ける
    fs.writeFileSync(path.join(OUT_DIR, name), '﻿' + body, 'utf8');
    files.push(`${name}（${part.length}件）`);
  }

  const noImage = collections.filter(c => !c.imageSrc).map(c => c.title);
  console.log(`コレクション定義 ${collections.length} 件`);
  console.log(`出力先 ${OUT_DIR}`);
  files.forEach(f => console.log(`  ${f}`));
  if (noImage.length) {
    console.log(`画像未設定 ${noImage.length} 件  ${noImage.join(', ')}`);
  }
}

main();
