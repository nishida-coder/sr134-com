#!/usr/bin/env node
/**
 * 楽天由来の画像のうち、左上に「MEN」「定番」「SALE」「PICK UP」などの
 * 帯が焼き込まれているものを探す。
 *
 *   SHOPIFY_TOKEN=xxx node tools/detect-badge-images.js            全商品を検査
 *   SHOPIFY_TOKEN=xxx node tools/detect-badge-images.js --handle x 1商品だけ
 *
 * 判定はヘッドレスブラウザで画素を見る。
 * 帯は必ず左上に寄っており、右上の同じ範囲には無い。
 * そこで上端の帯を左右で比べ、左だけに濃い画素が偏っているものを候補とする。
 * 最後は目視で確認する前提なので、拾いすぎる側に倒してある。
 *
 * 結果は tools/out/badge-candidates.json に書き出す。
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const SHOP = process.env.SHOPIFY_SHOP || 'gp9g0i-sk.myshopify.com';
const API_VERSION = process.env.SHOPIFY_API_VERSION || '2026-10';
const TOKEN = process.env.SHOPIFY_TOKEN;
const ENDPOINT = `https://${SHOP}/admin/api/${API_VERSION}/graphql.json`;

const CHROME = [
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].find(p => fs.existsSync(p));

const BATCH = 60;

const PRODUCTS = `
  query($cursor: String) {
    products(first: 40, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes {
        handle
        media(first: 20) { nodes { ... on MediaImage { id image { url } } } }
      }
    }
  }`;

const ONE = `
  query($handle: String!) {
    productByIdentifier(identifier: { handle: $handle }) {
      handle
      media(first: 20) { nodes { ... on MediaImage { id image { url } } } }
    }
  }`;

async function gql(query, variables) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': TOKEN },
      body: JSON.stringify({ query, variables }),
    });
    const json = await res.json();
    if (json.errors && json.errors.some(e => (e.extensions || {}).code === 'THROTTLED')) {
      await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
      continue;
    }
    if (json.errors) throw new Error(json.errors.map(e => e.message).join(' / '));
    return json.data;
  }
  throw new Error('レート制限が解除されませんでした');
}

/** ブラウザ側で走らせる検査。左上と右上の濃さを比べる。 */
const PAGE = urls => `<!doctype html><meta charset="utf-8"><body><pre id="out"></pre><script>
const URLS = ${JSON.stringify(urls)};
const W = 400;              // 検査用に縮める幅
const STRIP = 0.075;        // 上端から何割を見るか
const SIDE = 0.42;          // 左右それぞれ何割を見るか

function score(img) {
  const h = Math.max(1, Math.round(W * img.naturalHeight / img.naturalWidth));
  const c = document.createElement('canvas');
  c.width = W; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, W, h);
  const sh = Math.max(4, Math.round(h * STRIP));
  const sw = Math.round(W * SIDE);
  const left = ctx.getImageData(0, 0, sw, sh).data;
  const right = ctx.getImageData(W - sw, 0, sw, sh).data;
  const ink = d => {
    let n = 0;
    for (let i = 0; i < d.length; i += 4) {
      const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      if (lum < 150) n++;
    }
    return n / (d.length / 4);
  };
  // 帯のすぐ下は背景に戻る。写真が暗いだけの場合は下も暗いままになる。
  const below = ctx.getImageData(0, sh + Math.round(sh * 0.3), sw, sh).data;
  const l = ink(left), r = ink(right), b = ink(below);
  return {
    left: +l.toFixed(4),
    right: +r.toFixed(4),
    below: +b.toFixed(4),
    diff: +(l - r).toFixed(4),
    drop: +(l - b).toFixed(4),
  };
}

(async () => {
  const out = [];
  for (const url of URLS) {
    try {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      await new Promise((res, rej) => {
        img.onload = res; img.onerror = rej;
        img.src = url.indexOf('?') > -1 ? url + '&width=600' : url + '?width=600';
      });
      out.push(Object.assign({ url }, score(img)));
    } catch (e) {
      out.push({ url, error: String(e && e.message || e) });
    }
  }
  document.getElementById('out').textContent = JSON.stringify(out);
})();
</script></body>`;

function analyse(urls) {
  const tmp = path.join(os.tmpdir(), `sr134-badge-${Date.now()}.html`);
  fs.writeFileSync(tmp, PAGE(urls), 'utf8');
  const dom = execFileSync(
    CHROME,
    [
      '--headless=new',
      '--disable-gpu',
      '--allow-file-access-from-files',
      '--dump-dom',
      '--virtual-time-budget=45000',
      'file:///' + tmp.replace(/\\/g, '/'),
    ],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
  );
  fs.unlinkSync(tmp);
  const m = dom.match(/<pre id="out">([\s\S]*?)<\/pre>/);
  if (!m) return [];
  try {
    return JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
  } catch (e) {
    return [];
  }
}

async function collect(handle) {
  if (handle) {
    const d = await gql(ONE, { handle });
    return d.productByIdentifier ? [d.productByIdentifier] : [];
  }
  const all = [];
  let cursor = null;
  for (;;) {
    const d = await gql(PRODUCTS, { cursor });
    all.push(...d.products.nodes);
    if (!d.products.pageInfo.hasNextPage) break;
    cursor = d.products.pageInfo.endCursor;
  }
  return all;
}

async function main() {
  if (!TOKEN) {
    console.error('SHOPIFY_TOKEN が未設定です。');
    process.exit(1);
  }
  if (!CHROME) {
    console.error('Chrome が見つかりません。');
    process.exit(1);
  }
  const hArg = process.argv.indexOf('--handle');
  const products = await collect(hArg > -1 ? process.argv[hArg + 1] : null);

  const entries = [];
  for (const p of products) {
    for (const m of p.media.nodes) {
      if (m && m.image) entries.push({ handle: p.handle, mediaId: m.id, url: m.image.url });
    }
  }
  console.log(`商品 ${products.length}件 / 画像 ${entries.length}枚を検査します`);

  const byUrl = new Map(entries.map(e => [e.url, e]));
  const results = [];
  for (let i = 0; i < entries.length; i += BATCH) {
    const chunk = entries.slice(i, i + BATCH);
    const scored = analyse(chunk.map(e => e.url));
    for (const s of scored) {
      const e = byUrl.get(s.url);
      if (e) results.push(Object.assign({}, e, s));
    }
    console.log(`  ${Math.min(i + BATCH, entries.length)} / ${entries.length}`);
  }

  // 左上だけに濃い画素が偏っているものを候補とする
  // 左上だけが濃く、右上は薄く、帯の下は背景に戻っているものを候補とする
  const candidates = results
    .filter(r => !r.error && r.left > 0.05 && r.diff > 0.045 && r.drop > 0.03 && r.below < 0.06)
    .sort((a, b) => b.diff - a.diff);

  const outDir = path.join(__dirname, 'out');
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, 'badge-candidates.json');
  fs.writeFileSync(file, JSON.stringify(candidates, null, 2) + '\n', 'utf8');

  console.log(`\n検査 ${results.length}枚 / 候補 ${candidates.length}枚`);
  console.log(`保存先 ${file}`);
}

main().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
