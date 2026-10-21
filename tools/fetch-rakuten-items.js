#!/usr/bin/env node
/**
 * 楽天の商品ページから、Shopify 投入に必要な情報を取り直す。
 *
 *   node tools/fetch-rakuten-items.js tools/out/season-fw2627.json fw2627
 *   node tools/fetch-rakuten-items.js tools/out/season-fw2627.json fw2627 --limit 5
 *
 * 出力は tools/out/items-<slug>.json。
 * 途中で弾かれても、再実行すれば取得済みをとばして続きから取る。
 *
 * 取れるもの
 *   商品名（楽天のタイトル）、価格、サイズ、カラー、画像の登録順
 * ページは EUC-JP なので、必ずそれで復号する。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const SHOP = 'studio-route134';
const IMAGE_BASE = `https://tshop.r10s.jp/${SHOP}/cabinet`;
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';
const WAIT_MS = 1500;
const SAVE_EVERY = 10;

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** タイトルに出てくるブランド表記。長いものから順に照合する。 */
const BRANDS = [
  ['MAISON MIHARA YASUHIRO', 'Maison MIHARA YASUHIRO'],
  ['MM6 MAISON MARGIELA', 'MM6 Maison Margiela'],
  ['MAISON MARGIELA', 'Maison Margiela'],
  ['NINA RICCI DAYS', 'NINA RICCI DAYS'],
  ['LUCIEN PELLAT-FINET', 'lucien pellat-finet'],
  ['MIAMI BEACH HOTEL', 'MIAMI BEACH HOTEL 1955'],
  ['CIRCOLO 1901', 'CIRCOLO 1901'],
  ['CIRCOLO1901', 'CIRCOLO 1901'],
  ['SPORTY & RICH', 'SPORTY & RICH'],
  ['KO SAMUI TAILORS', 'KO SAMUI TAILORS'],
  ['DEVORE INCIPIT', 'DEVORE Incipit'],
  ['VOILE BLANCHE', 'VOILE BLANCHE'],
  ['STEFAN BRANDT', 'STEFAN BRANDT'],
  ['BERNA ITALIA', 'BERNA ITALIA'],
  ['CRIME LONDON', 'CRIME LONDON'],
  ['TRAMAROSSA', 'TRAMAROSSA'],
  ['BOB COMPANY', 'BOB COMPANY'],
  ['ALBERTO BRECI', 'Alberto Breci'],
  ['RAG & BONE', 'rag & bone'],
  ['BLANC VERT', 'BLANC VERT'],
  ['BLANCVERT', 'BLANC VERT'],
  ['DSQUARED2', 'DSQUARED2'],
  ['ELEVENTY', 'ELEVENTY'],
  ['SEAGREEN', 'SEAGREEN'],
  ['MONCLER', 'MONCLER'],
  ['P.M.D.S', 'P.M.D.S.'],
  ['PMDS', 'P.M.D.S.'],
  ['MAI MAI J', 'MAI MAI J'],
  ['MEIMEIJ', 'MAI MAI J'],
  ['ALANUI', 'ALANUI'],
  ['AMIRI', 'AMIRI'],
  ['MARNI', 'MARNI'],
  ['PATOU', 'PATOU'],
  ['PLAN C', 'PLAN C'],
  ['DESTIN', 'destin'],
  ['ALIITA', 'ALIITA'],
  ['BERNA', 'BERNA ITALIA'],
  ['N°21', 'N°21'],
  ['BARK', 'BARK'],
];

/** タイトルから品目を読み取る。先に並べたものが優先される。 */
const CATEGORIES = [
  // 複合語を取り違えないよう、下に着るものと小物を先に判定する。
  // 英語表記が無い商品もあるため、日本語表記も同じ優先度に並べる。
  ['DOWN', 'Outerwear'], ['ダウン', 'Outerwear'],
  ['BLOUSON', 'Blouson'], ['ブルゾン', 'Blouson'],
  ['JACKET', 'Jacket'], ['ジャケット', 'Jacket'],
  ['COAT', 'Coat'], ['コート', 'Coat'],
  ['SNEAKER', 'Sneakers'], ['スニーカー', 'Sneakers'],
  ['BOOTS', 'Boots'], ['ブーツ', 'Boots'],
  ['SANDAL', 'Sandals'], ['サンダル', 'Sandals'],
  ['SHOES', 'Shoes'], ['シューズ', 'Shoes'],
  ['WALLET', 'Wallet'], ['財布', 'Wallet'],
  ['BAG', 'Bag'], ['バッグ', 'Bag'],
  ['BELT', 'Belt'], ['ベルト', 'Belt'],
  ['DENIM', 'Denim'], ['デニム', 'Denim'],
  ['JEANS', 'Denim'], ['ジーンズ', 'Denim'],
  ['PANTS', 'Pants'], ['パンツ', 'Pants'], ['スラックス', 'Pants'],
  ['TROUSERS', 'Pants'],
  ['SKIRT', 'Skirt'], ['スカート', 'Skirt'],
  ['ONE PIECE', 'Dress'], ['ワンピース', 'Dress'],
  ['DRESS', 'Dress'],
  ['VEST', 'Vest'], ['ベスト', 'Vest'],
  ['CARDIGAN', 'Cardigan'], ['カーディガン', 'Cardigan'],
  ['HOODIE', 'Hoodie'], ['パーカ', 'Hoodie'], ['フーディ', 'Hoodie'],
  ['T-SHIRT', 'Tee'], ['Tシャツ', 'Tee'],
  ['TEE', 'Tee'], ['カットソー', 'Tee'],
  ['CUT&SEWN', 'Tee'],
  ['BLOUSE', 'Blouse'], ['ブラウス', 'Blouse'],
  ['SHIRT', 'Shirt'], ['シャツ', 'Shirt'],
  ['SWEAT', 'Sweat'], ['スウェット', 'Sweat'],
  ['PULLOVER', 'Knit'], ['プルオーバー', 'Knit'],
  ['SWEATER', 'Knit'], ['セーター', 'Knit'],
  ['KNIT', 'Knit'], ['ニット', 'Knit'],
  ['STOLE', 'Accessory'], ['ストール', 'Accessory'],
  ['MUFFLER', 'Accessory'], ['マフラー', 'Accessory'],
  ['SCARF', 'Accessory'], ['スカーフ', 'Accessory'],
  ['CAP', 'Accessory'], ['キャップ', 'Accessory'],
  ['HAT', 'Accessory'], ['ハット', 'Accessory'],
];

function detect(title, table, fallback) {
  const upper = title.toUpperCase();
  for (const [needle, value] of table) {
    if (upper.includes(needle)) return value;
  }
  return fallback;
}

async function fetchPage(url) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } });
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        return new TextDecoder('euc-jp').decode(buf);
      }
    } catch (e) {
      /* 次の試行へ */
    }
    await sleep(3000 * (attempt + 1));
  }
  throw new Error('取得できませんでした');
}

function parse(html, id) {
  const titleRaw = (html.match(/<title>(.*?)<\/title>/s) || [])[1] || '';
  const title = titleRaw
    .replace(/^【楽天市場】/, '')
    .replace(/：Studio Route134\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!title) throw new Error('商品名が読めません');

  const price = Number((html.match(/"taxIncludedPrice"\s*:\s*([\d.]+)/) || [])[1] || 0);

  const sizes = [];
  const colors = [];
  const selectors = html.match(/"variantSelectors"\s*:\s*(\[.*?\])\s*,\s*"inventoryType"/s);
  if (selectors) {
    try {
      for (const sel of JSON.parse(selectors[1])) {
        const values = (sel.values || []).map(v => String(v.label || v.value)).filter(Boolean);
        if (String(sel.label).includes('サイズ')) sizes.push(...values);
        else if (String(sel.label).includes('カラー')) colors.push(...values);
      }
    } catch (e) {
      /* 読めなければ空のまま */
    }
  }

  const block = html.match(/"images"\s*:\s*\[(.*?)\]/s);
  const seen = new Set();
  const images = block
    ? [...block[1].matchAll(/"location"\s*:\s*"([^"]+)"/g)]
        .map(m => IMAGE_BASE + m[1])
        .filter(u => !/evidence/i.test(u))
        .filter(u => (seen.has(u) ? false : (seen.add(u), true)))
    : [];

  return {
    id,
    title,
    brand: detect(title, BRANDS, ''),
    category: detect(title, CATEGORIES, 'Item'),
    price,
    sizes,
    colors,
    images,
    rakuten: `https://item.rakuten.co.jp/${SHOP}/${id}/`,
    // 画像が既に登録順であることを投入側へ伝える
    fromRakuten: true,
  };
}

async function main() {
  const listFile = process.argv[2];
  const slug = process.argv[3];
  if (!listFile || !slug) {
    console.error('使い方 node tools/fetch-rakuten-items.js <idの配列json> <slug>');
    process.exit(1);
  }
  const limitArg = process.argv.indexOf('--limit');
  const limit = limitArg > -1 ? Number(process.argv[limitArg + 1]) : Infinity;

  const ids = JSON.parse(fs.readFileSync(path.resolve(listFile), 'utf8')).slice(0, limit);
  const dir = path.join(__dirname, 'out');
  fs.mkdirSync(dir, { recursive: true });
  const outFile = path.join(dir, `items-${slug}.json`);
  const out = fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, 'utf8')) : {};

  const done = Object.keys(out).length;
  console.log(`${ids.length}件を処理します` + (done ? `（取得済み ${done}件はとばします）` : ''));

  const failed = [];
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    if (out[id]) continue;
    try {
      const html = await fetchPage(`https://item.rakuten.co.jp/${SHOP}/${id}/`);
      out[id] = parse(html, id);
    } catch (e) {
      failed.push(`${id} -> ${e.message}`);
    }
    if ((i + 1) % SAVE_EVERY === 0) {
      fs.writeFileSync(outFile, JSON.stringify(out, null, 2) + '\n', 'utf8');
      console.log(`  ${i + 1} / ${ids.length}`);
    }
    await sleep(WAIT_MS);
  }
  fs.writeFileSync(outFile, JSON.stringify(out, null, 2) + '\n', 'utf8');

  const rows = Object.values(out);
  const noBrand = rows.filter(r => !r.brand);
  const brands = {};
  rows.forEach(r => (brands[r.brand || '(不明)'] = (brands[r.brand || '(不明)'] || 0) + 1));

  console.log(`\n取得 ${rows.length}件 / 失敗 ${failed.length}件`);
  console.log('--- ブランド別 ---');
  Object.entries(brands)
    .sort((a, b) => b[1] - a[1])
    .forEach(([k, v]) => console.log(`  ${String(v).padStart(4)} ${k}`));
  if (noBrand.length) {
    console.log('--- ブランドを読めなかったもの ---');
    noBrand.slice(0, 10).forEach(r => console.log(`  ${r.id} ${r.title.slice(0, 60)}`));
  }
  failed.slice(0, 10).forEach(f => console.log(`  NG ${f}`));
  console.log(`\n保存先 ${outFile}`);
}

main().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
