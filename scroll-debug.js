// ===== 縦揺れ診断オーバーレイ =====
// URL に ?sdbg=1 を付けたときだけ読み込まれる。通常の閲覧者には出ない。
//   例: https://sr134.com/preview/?sdbg=1
// 画面右上に小さな黒い箱が出て、スクロール中に
//   (1) スクロール位置が指の向きと逆に戻った回数と大きさ
//   (2) そのとき文書の高さが変わったか（上にある要素が伸び縮みした証拠）
//   (3) ブラウザが報告したレイアウトシフトの発生元の要素
//   (4) アドレスバー出入りによる画面高さの変化
// を記録する。「COPY」を押すと記録が JSON でクリップボードに入るので、
// そのまま貼り付けて共有できる。
(function () {
  'use strict';
  const log = [];
  const state = {
    reverseJumps: 0, maxJumpPx: 0, heightChanges: 0,
    layoutShifts: 0, shiftScore: 0, lastShift: '-', lastJump: '-',
  };
  let lastY = window.scrollY, lastDir = 0, lastH = document.documentElement.scrollHeight;
  let lastInner = window.innerHeight;
  let touching = false, touchStartY = 0, fingerDir = 0;
  const t0 = performance.now();
  const ms = () => Math.round(performance.now() - t0);

  const describe = (el) => {
    if (!el || !el.tagName) return String(el);
    const id = el.id ? '#' + el.id : '';
    const cls = el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
    return el.tagName.toLowerCase() + id + cls;
  };
  const elementAtTop = () => {
    const el = document.elementFromPoint(Math.round(window.innerWidth / 2), 120);
    const sec = el && el.closest ? el.closest('section, header, footer, .hero') : null;
    return describe(sec || el);
  };

  // --- 箱 ---
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;top:6px;right:6px;z-index:99999;background:rgba(0,0,0,.82);color:#fff;font:11px/1.45 monospace;padding:8px 10px;border-radius:6px;max-width:72vw;pointer-events:auto;white-space:pre;';
  const txt = document.createElement('div');
  const btn = document.createElement('button');
  btn.textContent = 'COPY';
  btn.style.cssText = 'margin-top:6px;font:11px monospace;padding:4px 10px;';
  btn.addEventListener('click', () => {
    const out = JSON.stringify({ ua: navigator.userAgent, summary: state, events: log.slice(-200) }, null, 1);
    const done = () => { btn.textContent = 'COPIED'; setTimeout(() => btn.textContent = 'COPY', 1500); };
    if (navigator.clipboard) navigator.clipboard.writeText(out).then(done, () => prompt('copy:', out));
    else prompt('copy:', out);
  });
  box.appendChild(txt); box.appendChild(btn);
  document.addEventListener('DOMContentLoaded', () => document.body.appendChild(box));
  if (document.body) document.body.appendChild(box);

  const paint = () => {
    txt.textContent =
      `y ${Math.round(window.scrollY)}  docH ${document.documentElement.scrollHeight}\n` +
      `innerH ${window.innerHeight}  vv ${window.visualViewport ? Math.round(window.visualViewport.height) : '-'}\n` +
      `逆戻り ${state.reverseJumps}回  最大 ${Math.round(state.maxJumpPx)}px\n` +
      `直近: ${state.lastJump}\n` +
      `文書高さ変化 ${state.heightChanges}回\n` +
      `layout-shift ${state.layoutShifts}回 score ${state.shiftScore.toFixed(3)}\n` +
      `発生元: ${state.lastShift}`;
  };

  // --- 指の向き ---
  window.addEventListener('touchstart', (e) => { touching = true; touchStartY = e.touches[0].clientY; fingerDir = 0; }, { passive: true });
  window.addEventListener('touchmove', (e) => {
    const dy = e.touches[0].clientY - touchStartY;
    if (Math.abs(dy) > 4) fingerDir = dy > 0 ? -1 : 1; // 指が下へ動く = 上へスクロール(-1)
  }, { passive: true });
  window.addEventListener('touchend', () => { touching = false; }, { passive: true });

  // --- スクロール位置の逆戻り検出 ---
  window.addEventListener('scroll', () => {
    const y = window.scrollY;
    const h = document.documentElement.scrollHeight;
    const d = y - lastY;
    const dir = d > 0 ? 1 : d < 0 ? -1 : 0;
    const expect = fingerDir || lastDir;
    if (dir !== 0 && expect !== 0 && dir !== expect && Math.abs(d) >= 2) {
      state.reverseJumps++;
      state.maxJumpPx = Math.max(state.maxJumpPx, Math.abs(d));
      const hd = h - lastH;
      state.lastJump = `${ms()}ms ${d > 0 ? '+' : ''}${Math.round(d)}px docH${hd >= 0 ? '+' : ''}${hd} @${elementAtTop()}`;
      log.push({ t: ms(), type: 'reverse-jump', dy: Math.round(d), y: Math.round(y), docHeightDelta: hd, nearTop: elementAtTop(), touching, fingerDir });
    } else if (dir !== 0) {
      lastDir = dir;
    }
    if (h !== lastH) {
      state.heightChanges++;
      log.push({ t: ms(), type: 'doc-height', from: lastH, to: h, y: Math.round(y) });
      lastH = h;
    }
    lastY = y;
    paint();
  }, { passive: true });

  // --- アドレスバーの出入り ---
  window.addEventListener('resize', () => {
    if (window.innerHeight !== lastInner) {
      log.push({ t: ms(), type: 'resize', innerH: lastInner + '->' + window.innerHeight, y: Math.round(window.scrollY) });
      lastInner = window.innerHeight;
    }
    paint();
  });

  // --- ブラウザが報告するレイアウトシフト ---
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (e.hadRecentInput) continue;
        state.layoutShifts++;
        state.shiftScore += e.value;
        const srcs = (e.sources || []).map(s => describe(s.node)).filter(Boolean);
        state.lastShift = srcs.slice(0, 3).join(', ') || '(不明)';
        log.push({ t: ms(), type: 'layout-shift', value: +e.value.toFixed(4), sources: srcs, y: Math.round(window.scrollY) });
      }
      paint();
    }).observe({ type: 'layout-shift', buffered: true });
  } catch (_) {}

  // --- 文書の高さの変化（スクロールしていなくても） ---
  try {
    new ResizeObserver(() => {
      const h = document.documentElement.scrollHeight;
      if (h !== lastH) {
        state.heightChanges++;
        log.push({ t: ms(), type: 'doc-height', from: lastH, to: h, y: Math.round(window.scrollY), nearTop: elementAtTop() });
        lastH = h;
        paint();
      }
    }).observe(document.body);
  } catch (_) {}

  paint();
})();
