#!/usr/bin/env node
/**
 * photos/ の写真を web 用に軽くする。
 *
 *   node tools/optimize-photos.js --dry-run
 *   node tools/optimize-photos.js
 *
 * 長辺を 1600px に収め、画質を落としすぎない範囲で再圧縮する。
 * 元のファイルは photos/_original/ へ退避するので、やり直しができる。
 *
 * 重い写真はモバイルで読み込みが遅れ、描画の確定が後ろにずれる。
 * それがスクロール中の跳ねにつながるため、表示の問題としても効く。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, 'photos');
const BACKUP = path.join(DIR, '_original');
const MAX_EDGE = 1600;
const QUALITY = 4; // ffmpeg の mjpeg は 2 が最高品質。4 で見た目はほぼ変わらない
const THRESHOLD = 400 * 1024; // これより大きいものだけ処理する

const FFMPEG = [
  path.join(
    process.env.LOCALAPPDATA || '',
    'Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-9.0.1-full_build/bin/ffmpeg.exe'
  ),
  'ffmpeg',
].find(p => {
  try {
    execFileSync(p, ['-version'], { stdio: 'ignore' });
    return true;
  } catch (e) {
    return false;
  }
});

function main() {
  if (!FFMPEG) {
    console.error('ffmpeg が見つかりません。');
    process.exit(1);
  }
  const dryRun = process.argv.includes('--dry-run');
  fs.mkdirSync(BACKUP, { recursive: true });

  const files = fs
    .readdirSync(DIR)
    .filter(f => /\.(jpe?g|png)$/i.test(f))
    .map(f => ({ name: f, full: path.join(DIR, f), size: fs.statSync(path.join(DIR, f)).size }))
    .filter(f => f.size > THRESHOLD)
    .sort((a, b) => b.size - a.size);

  console.log(`対象 ${files.length}件（${(files.reduce((s, f) => s + f.size, 0) / 1048576).toFixed(1)}MB）`);
  if (dryRun) {
    files.slice(0, 20).forEach(f => console.log(`  ${(f.size / 1024).toFixed(0)}KB  ${f.name}`));
    return;
  }

  let before = 0;
  let after = 0;
  for (const f of files) {
    const keep = path.join(BACKUP, f.name);
    if (!fs.existsSync(keep)) fs.copyFileSync(f.full, keep);
    const tmp = path.join(DIR, `__tmp_${f.name.replace(/\.[^.]+$/, '')}.jpg`);
    try {
      execFileSync(
        FFMPEG,
        [
          '-hide_banner', '-loglevel', 'error', '-y',
          '-i', keep,
          '-vf', `scale='min(${MAX_EDGE},iw)':'min(${MAX_EDGE},ih)':force_original_aspect_ratio=decrease`,
          '-q:v', String(QUALITY),
          tmp,
        ],
        { stdio: 'ignore' }
      );
      const size = fs.statSync(tmp).size;
      if (size >= f.size) {
        fs.unlinkSync(tmp);
        console.log(`  そのまま ${f.name}`);
        before += f.size;
        after += f.size;
        continue;
      }
      fs.renameSync(tmp, f.full);
      before += f.size;
      after += size;
      console.log(`  ${(f.size / 1024).toFixed(0)}KB → ${(size / 1024).toFixed(0)}KB  ${f.name}`);
    } catch (e) {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
      console.log(`  NG ${f.name} ${e.message.slice(0, 60)}`);
    }
  }
  console.log(
    `\n合計 ${(before / 1048576).toFixed(1)}MB → ${(after / 1048576).toFixed(1)}MB ` +
      `（${Math.round((1 - after / before) * 100)}％削減）`
  );
  console.log(`元のファイルは ${BACKUP}`);
}

main();
