#!/usr/bin/env node
/**
 * Shopify テーマ（Spotlight）の見た目を sr134.com のトーンへ寄せる。
 *
 *   SHOPIFY_TOKEN=xxx node tools/apply-theme-settings.js            適用
 *   SHOPIFY_TOKEN=xxx node tools/apply-theme-settings.js --dry-run  差分だけ表示
 *
 * 元の設定は tools/out/theme-settings-backup.json に退避してから書き換える。
 * settings_data.json の current が文字列（プリセット名）のままの場合は、
 * プリセットを展開したうえで上書きする。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const SHOP = process.env.SHOPIFY_SHOP || 'gp9g0i-sk.myshopify.com';
const API_VERSION = process.env.SHOPIFY_API_VERSION || '2026-10';
const TOKEN = process.env.SHOPIFY_TOKEN;
const THEME_ID = process.env.SHOPIFY_THEME_ID || 'gid://shopify/OnlineStoreTheme/189726884205';
const ENDPOINT = `https://${SHOP}/admin/api/${API_VERSION}/graphql.json`;
const FILE = 'config/settings_data.json';

// sr134.com の配色
const INK = '#15233F';
const IVORY = '#F7F5EF';
const WHITE = '#FFFFFF';
const NAVY = '#1B2F52';
const GOLD = '#B89A5C';

const COLOR_SCHEMES = {
  'scheme-1': { background: WHITE, text: INK, button: INK, button_label: WHITE, secondary_button_label: INK, shadow: INK },
  'scheme-2': { background: IVORY, text: INK, button: INK, button_label: IVORY, secondary_button_label: INK, shadow: INK },
  'scheme-3': { background: NAVY, text: IVORY, button: GOLD, button_label: INK, secondary_button_label: IVORY, shadow: INK },
  'scheme-4': { background: INK, text: IVORY, button: GOLD, button_label: INK, secondary_button_label: IVORY, shadow: INK },
  'scheme-5': { background: GOLD, text: INK, button: INK, button_label: GOLD, secondary_button_label: INK, shadow: INK },
};

// 角を立てて余白を広く取り、装飾を抑える
const OVERRIDES = {
  logo: 'shopify://shop_images/sr134_logo.png',
  logo_width: 150,
  // 見出しと本文は同じ書体に揃える。装飾的なセリフ体は数字が崩れるため使わない。
  type_header_font: 'inter_n4',
  type_body_font: 'inter_n4',
  heading_scale: 100,
  body_scale: 100,
  page_width: 1400,
  spacing_sections: 24,
  buttons_radius: 0,
  buttons_border_thickness: 1,
  buttons_shadow_opacity: 0,
  inputs_radius: 0,
  inputs_shadow_opacity: 0,
  variant_pills_radius: 0,
  variant_pills_shadow_opacity: 0,
  card_style: 'standard',
  card_corner_radius: 0,
  card_shadow_opacity: 0,
  card_text_alignment: 'left',
  collection_card_corner_radius: 0,
  collection_card_shadow_opacity: 0,
  collection_card_text_alignment: 'left',
  blog_card_corner_radius: 0,
  blog_card_shadow_opacity: 0,
  media_radius: 0,
  media_shadow_opacity: 0,
  text_boxes_radius: 0,
  text_boxes_shadow_opacity: 0,
  popup_corner_radius: 0,
  popup_shadow_opacity: 0,
  badge_corner_radius: 0,
  social_instagram_link: 'https://www.instagram.com/studio_route134_official/',
  show_vendor: true,
};

const READ = `
  query($id: ID!, $filenames: [String!]!) {
    theme(id: $id) {
      name
      files(filenames: $filenames, first: 1) {
        nodes { filename body { ... on OnlineStoreThemeFileBodyText { content } } }
      }
    }
  }`;

const WRITE = `
  mutation($themeId: ID!, $files: [OnlineStoreThemeFilesUpsertFileInput!]!) {
    themeFilesUpsert(themeId: $themeId, files: $files) {
      upsertedThemeFiles { filename }
      userErrors { filename message }
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

/** settings_data.json は先頭にコメントが入るため、最初の { から読む。 */
function parseSettings(raw) {
  return JSON.parse(raw.slice(raw.indexOf('{')));
}

function buildCurrent(settings) {
  const base =
    typeof settings.current === 'string'
      ? JSON.parse(JSON.stringify(settings.presets[settings.current]))
      : JSON.parse(JSON.stringify(settings.current));

  base.color_schemes = base.color_schemes || {};
  for (const [name, colors] of Object.entries(COLOR_SCHEMES)) {
    const existing = (base.color_schemes[name] && base.color_schemes[name].settings) || {};
    base.color_schemes[name] = { settings: { ...existing, ...colors, background_gradient: '' } };
  }
  Object.assign(base, OVERRIDES);
  return base;
}

async function main() {
  if (!TOKEN) {
    console.error('SHOPIFY_TOKEN が未設定です。');
    process.exit(1);
  }
  const dryRun = process.argv.includes('--dry-run');

  const data = await gql(READ, { id: THEME_ID, filenames: [FILE] });
  const node = data.theme.files.nodes[0];
  if (!node) throw new Error(`${FILE} が見つかりません`);
  const raw = node.body.content;

  const outDir = path.join(__dirname, 'out');
  fs.mkdirSync(outDir, { recursive: true });
  const backup = path.join(outDir, 'theme-settings-backup.json');
  if (!fs.existsSync(backup)) {
    fs.writeFileSync(backup, raw, 'utf8');
    console.log(`元の設定を退避 ${backup}`);
  }

  const settings = parseSettings(raw);
  const before = typeof settings.current === 'string' ? settings.presets[settings.current] : settings.current;
  settings.current = buildCurrent(settings);

  console.log(`テーマ ${data.theme.name}`);
  console.log('--- 変更内容 ---');
  for (const [k, v] of Object.entries(OVERRIDES)) {
    const old = before[k];
    if (JSON.stringify(old) !== JSON.stringify(v)) {
      console.log(`  ${k}  ${JSON.stringify(old)} -> ${JSON.stringify(v)}`);
    }
  }
  console.log('  color_schemes  5件を sr134 の配色へ');

  if (dryRun) {
    console.log('\n--dry-run のため書き込みはしていません');
    return;
  }

  const body = JSON.stringify(settings, null, 2);
  const result = await gql(WRITE, {
    themeId: THEME_ID,
    files: [{ filename: FILE, body: { type: 'TEXT', value: body } }],
  });
  const errs = result.themeFilesUpsert.userErrors || [];
  if (errs.length) {
    console.error('書き込み失敗', JSON.stringify(errs));
    process.exit(1);
  }
  console.log('\n書き込み完了', result.themeFilesUpsert.upsertedThemeFiles.map(f => f.filename).join(', '));
}

main().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
