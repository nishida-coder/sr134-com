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

/** brand.html と同じ国旗。コレクション見出しの左に出すため data URI にする。 */
const FLAG_SVG = {
  IT: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 16"><rect width="8" height="16" fill="#009246"/><rect x="8" width="8" height="16" fill="#fff"/><rect x="16" width="8" height="16" fill="#ce2b37"/><rect width="24" height="16" fill="none" stroke="#DAD5C7" stroke-width="0.6"/></svg>',
  FR: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 16"><rect width="8" height="16" fill="#0055A4"/><rect x="8" width="8" height="16" fill="#fff"/><rect x="16" width="8" height="16" fill="#EF4135"/><rect width="24" height="16" fill="none" stroke="#DAD5C7" stroke-width="0.6"/></svg>',
  US: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 16"><rect fill="#B22234" width="24" height="16"/><g fill="#fff"><rect y="1.23" width="24" height="1.23"/><rect y="3.69" width="24" height="1.23"/><rect y="6.15" width="24" height="1.23"/><rect y="8.62" width="24" height="1.23"/><rect y="11.08" width="24" height="1.23"/><rect y="13.54" width="24" height="1.23"/></g><rect fill="#3C3B6E" width="10" height="8.62"/><rect width="24" height="16" fill="none" stroke="#DAD5C7" stroke-width="0.6"/></svg>',
  JP: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 16"><rect fill="#fff" width="24" height="16"/><circle cx="12" cy="8" r="4.8" fill="#BC002D"/><rect width="24" height="16" fill="none" stroke="#DAD5C7" stroke-width="0.6"/></svg>',
  DE: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 16"><rect width="24" height="5.33" fill="#000"/><rect y="5.33" width="24" height="5.33" fill="#DD0000"/><rect y="10.66" width="24" height="5.34" fill="#FFCE00"/><rect width="24" height="16" fill="none" stroke="#DAD5C7" stroke-width="0.6"/></svg>',
  GB: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 16"><rect fill="#012169" width="24" height="16"/><path stroke="#fff" stroke-width="2" d="M0,0 L24,16 M24,0 L0,16"/><path stroke="#C8102E" stroke-width="1" d="M0,0 L24,16 M24,0 L0,16"/><path stroke="#fff" stroke-width="4" d="M12,0 v16 M0,8 h24"/><path stroke="#C8102E" stroke-width="2" d="M12,0 v16 M0,8 h24"/><rect width="24" height="16" fill="none" stroke="#DAD5C7" stroke-width="0.6"/></svg>',
};

const FLAG_W = 24;
const FLAG_GAP = 6;

function dataUri(svg) {
  return `data:image/svg+xml,${encodeURIComponent(svg).replace(/'/g, '%27')}`;
}

/**
 * 見出しの左に国旗を置くCSS。テーマを編集できないため、
 * コレクション説明の中から見出し要素へ当てる。
 */
function flagCss(brand) {
  const codes = (brand.countries || []).filter(c => FLAG_SVG[c]);
  if (!codes.length) return '';
  const images = codes.map(c => `url("${dataUri(FLAG_SVG[c])}")`).join(',');
  const positions = codes.map((_, i) => `${i * (FLAG_W + FLAG_GAP)}px center`).join(',');
  const sizes = codes.map(() => `${FLAG_W}px 16px`).join(',');
  const total = codes.length * FLAG_W + (codes.length - 1) * FLAG_GAP;
  return [
    '.collection-hero__title{display:flex;align-items:center;gap:14px;justify-content:flex-start;}',
    '.collection-hero__title::before{',
    'content:"";',
    `flex:0 0 ${total}px;width:${total}px;height:16px;`,
    `background-image:${images};`,
    `background-position:${positions};`,
    `background-size:${sizes};`,
    'background-repeat:no-repeat;',
    '}',
  ].join('');
}

function bodyHtml(brand) {
  const paragraphs = [brand.lead, ...(brand.body || [])]
    .map(t => (t || '').trim())
    .filter(Boolean)
    .map(t => `<p>${escapeHtml(t)}</p>`)
    .join('\n');

  const hero = imageUrl(brand);
  const css = flagCss(brand);

  if (!hero) {
    return (css ? `<style>${css}</style>\n` : '') + paragraphs;
  }

  // テーマのコレクション画像設定が使えないあいだ、説明文の中で
  // 文章を左、ブランド写真を右に並べる。モバイルでも横並びを保つ。
  const layout = [
    '.sr-brand-hero{display:flex;gap:28px;align-items:flex-start;text-align:left;}',
    '.sr-brand-hero__text{flex:1 1 0;min-width:0;}',
    '.sr-brand-hero__fig{flex:0 0 34%;max-width:340px;}',
    '.sr-brand-hero__fig img{width:100%;height:auto;display:block;}',
    '@media (max-width:749px){.sr-brand-hero{gap:16px;}.sr-brand-hero__fig{flex:0 0 38%;}}',
  ].join('');

  return [
    `<style>${layout}${css}</style>`,
    '<div class="sr-brand-hero">',
    '<div class="sr-brand-hero__text">',
    paragraphs,
    '</div>',
    '<div class="sr-brand-hero__fig">',
    `<img src="${hero}" alt="${escapeHtml(brand.name)}">`,
    '</div>',
    '</div>',
  ].join('\n');
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
