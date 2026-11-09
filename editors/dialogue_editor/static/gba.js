/* Graveblood — GBA screen preview.
 * Pixel-exact port of BubbleGum (bubble.cpp) text layout + PlayerDialogue::show*() bubble geometry
 * + PlayerDrawing::drawChar() portrait position. Screen is 240x160.
 */
'use strict';

const GBA = (() => {
  const W = 240, H = 160;
  let FONT = null;                       // font[] from sys8.font.h
  const enc = new TextEncoder();         // strings are UTF-8 in dialogues.cpp → that's what the GBA gets

  const DEFAULT_COLORS = {
    screen: '#20262b', bubbleBg: '#f2efe4', bubbleFg: '#1c1a24', border: '#2a2735',
    selBg: '#3d5f93', selFg: '#ffffff', overflow: '#ff3b3b',
  };
  let C = { ...DEFAULT_COLORS };

  function setFont(f) { FONT = f && f.length > 256 ? f : null; }
  function hasFont() { return !!FONT; }
  function setColors(c) { C = { ...DEFAULT_COLORS, ...(c || {}) }; }
  function colors() { return { ...C }; }

  const sgn = b => (b > 127 ? b - 256 : b);           // engine compares signed char
  const glyphLen = b => (FONT[b] & 0x7c00) >> 10;
  const glyphIdx = b => FONT[b] & 0x3ff;
  const glyphFn = b => (FONT[b] & 0x8000) !== 0;

  /** Lay out strings exactly as BubbleGum::writeStrA(s1); writeStrA(s2)…
   *  w, h — inner size in pixels (screen_w / screen_h).
   *  Returns { cols: [{line, col, word(u16 column bits)}], lines (used), maxLines, overflow } */
  function layout(strs, w, h) {
    const res = { cols: [], lines: 0, maxLines: Math.floor(h / 8), overflow: false };
    if (!FONT) return res;
    const ncols = w / 2;
    let x = 0, y = 0;
    const move = (dx, dy) => {
      x += dx; y += dy;
      if (x < 0) x = 0; else if (x >= ncols) { x = 0; y++; }
      if (y < 0) y = 0;
    };
    const writeChar = b => {
      if (glyphFn(b)) { move(-500, 1); return; }
      const idx = glyphIdx(b);
      let len = glyphLen(b);
      if (FONT[0] + idx + len > FONT.length) len = 0;
      if (len + x > ncols) move(-500, 1);
      for (let i = 0; i < len; i++) {
        res.cols.push({ line: y, col: x, word: FONT[FONT[0] + idx + i] });
        move(1, 0);
      }
    };
    for (const str of strs) {
      const s = Array.from(enc.encode(String(str))); s.push(0);
      for (let i = 0; s[i] !== 0; i++) {
        if (i === 0 || s[i] === 32) {
          let len = glyphLen(s[i]);
          for (let j = 1; sgn(s[i + j]) > 32; j++) len += glyphLen(s[i + j]);
          if (len + x > ncols && x !== 0) move(-500, 1);
        }
        if (!(x === 0 && s[i] === 32)) writeChar(s[i]);
      }
    }
    for (const c of res.cols) res.lines = Math.max(res.lines, c.line + 1);
    res.overflow = res.lines > res.maxLines;
    return res;
  }

  // ---------------------------------------------------------------- scenes
  // Geometry is copied from player_dialogue.cpp (drowBubble(x, y, w, h) in tiles; border eats 1 tile each side).
  function sceneFor(p, opts = {}) {
    const f = p.f, op = f[2];
    const sc = { bubbles: [], portrait: null, crop: [0, H] };
    const nameColon = ':                              ';
    if (op === -18) {
      // showChoice(0,64,1,2, 1,12,20,7)
      const vis = [f[1], f[6]];
      if (f[9] !== -2) vis.push(f[8]);
      if (f[13] !== -2 && f[9] !== -2) vis.push(f[12]);
      let buf = f[0] + ': \n' + f[1] + '\n' + f[6] + '\n';
      if (f[9] !== -2) buf += f[8] + '\n';
      if (f[13] !== -2 && f[9] !== -2) buf += f[12];
      sc.bubbles.push({ x:1, y:12, w:20, h:7, border:true, bg:C.bubbleBg, fg:C.bubbleFg, strs:[buf], main:true });
      const pick = Math.max(0, Math.min(vis.length - 1, opts.pick || 0));
      // bub1: BubbleGum(0, 64+96+14-7), colors 5/6, no border, drowBubble(2, 14+pick, 18, 1)
      sc.bubbles.push({ x:2, y:14 + pick, w:18, h:1, border:false, bg:C.selBg, fg:C.selFg, strs:['> ' + vis[pick]] });
      if (opts.portrait) sc.portrait = opts.portrait;
      sc.crop = [64, 160];
    } else if (op === -14) {
      // tip: showDialog(false, 0,72, 2,1, 2,1,26,7)  — colours swapped, no portrait
      sc.bubbles.push({ x:2, y:1, w:26, h:7, border:true, bg:C.bubbleFg, fg:C.bubbleBg, strs:[f[0], '--------------------------------', f[1]], main:true });
      sc.crop = [0, 72];
    } else if (op === -26) {
      // auto: showDialog(true, 0,64,1,2, 7, 14 - who*13, 16, 5, …, isSmall) — no portrait
      const y = 14 - (typeof f[4] === 'number' ? f[4] : 0) * 13;
      sc.bubbles.push({ x:7, y, w:16, h:5, border:true, bg:C.bubbleBg, fg:C.bubbleFg, strs:[f[0], nameColon, f[1]], main:true });
      sc.crop = [Math.max(0, y * 8 - 8), Math.min(H, (y + 5) * 8 + 8)];
    } else {
      // normal: showDialog(true, 0,64,1,2, 1,13,20,6) + portrait at 168,72
      sc.bubbles.push({ x:1, y:13, w:20, h:6, border:true, bg:C.bubbleBg, fg:C.bubbleFg, strs:[f[0], nameColon, f[1]], main:true });
      if (opts.portrait) sc.portrait = opts.portrait;
      sc.crop = [64, 160];
    }
    if (opts.full) sc.crop = [0, H];
    return sc;
  }

  /** Реакция NPC в колесе взаимодействий (player_interaction.cpp: executeInteractionEffect / showReaction):
   *  BubbleGum(0, startScreen) + drowBubble(5, 13, 20, 6), имя + ":   …" + реплика, без портрета. */
  function reactionScene(name, text) {
    const sc = { bubbles: [], portrait: null, crop: [96, 160], cropX: [32, 208] };
    sc.bubbles.push({ x:5, y:13, w:20, h:6, border:true, bg:C.bubbleBg, fg:C.bubbleFg,
      strs:[name || '', ':                              ', text || ''], main:true });
    return sc;
  }

  /** Overflow info for the main bubble of a phrase (null if it has no bubble). */
  function measure(p) {
    if (!FONT) return null;
    const sc = sceneFor(p, {});
    const b = sc.bubbles.find(x => x.main);
    if (!b) return null;
    const iw = (b.border ? b.w - 2 : b.w) * 8, ih = (b.border ? b.h - 2 : b.h) * 8;
    return layout(b.strs, iw, ih);
  }

  // ---------------------------------------------------------------- drawing
  const imgCache = new Map();
  function portraitImg(url, onload) {
    let e = imgCache.get(url);
    if (!e) {
      e = { img: new Image(), ok: false, bad: false, wait: [] };
      e.img.onload = () => { e.ok = true; e.wait.splice(0).forEach(fn => fn()); };
      e.img.onerror = () => { e.bad = true; e.wait.splice(0).forEach(fn => fn()); };
      e.img.src = url;
      imgCache.set(url, e);
    }
    if (!e.ok && !e.bad && onload) e.wait.push(onload);
    return e;
  }

  function drawBubble(ctx, b) {
    const X = b.x * 8, Y = b.y * 8, Wp = b.w * 8, Hp = b.h * 8;
    ctx.fillStyle = b.bg; ctx.fillRect(X, Y, Wp, Hp);
    if (b.border) {
      // generic 8px frame (the real border tiles 3/4/5 live in the level tileset)
      ctx.fillStyle = C.border;
      ctx.fillRect(X + 3, Y + 2, Wp - 6, 1); ctx.fillRect(X + 3, Y + Hp - 3, Wp - 6, 1);
      ctx.fillRect(X + 2, Y + 3, 1, Hp - 6); ctx.fillRect(X + Wp - 3, Y + 3, 1, Hp - 6);
    }
    const ix = b.border ? X + 8 : X, iy = b.border ? Y + 8 : Y;
    const iw = (b.border ? b.w - 2 : b.w) * 8, ih = (b.border ? b.h - 2 : b.h) * 8;
    const L = layout(b.strs, iw, ih);
    for (const c of L.cols) {
      const over = c.line >= L.maxLines;
      ctx.fillStyle = over ? C.overflow : b.fg;
      let w = c.word;
      for (let r = 0; r < 8; r++) {
        const px = ix + c.col * 2, py = iy + c.line * 8 + r;
        if (w & 1) ctx.fillRect(px, py, 1, 1);
        if (w & 2) ctx.fillRect(px + 1, py, 1, 1);
        w >>= 2;
      }
    }
    if (L.overflow) {
      ctx.strokeStyle = C.overflow; ctx.lineWidth = 1;
      ctx.strokeRect(ix - 0.5, iy + ih - 0.5, iw + 1, (L.lines - L.maxLines) * 8 + 1);
    }
    return L;
  }

  /** Draw a scene into canvas. scale = CSS pixel size per GBA pixel. */
  function draw(canvas, sc, scale = 2, redraw) {
    const [y0, y1] = sc.crop;
    const [x0, x1] = sc.cropX || [0, W];
    const ww = x1 - x0;
    const hh = y1 - y0;
    // overflowing text is drawn below the bubble: make room for it
    let extra = 0;
    for (const b of sc.bubbles) {
      const iw = (b.border ? b.w - 2 : b.w) * 8, ih = (b.border ? b.h - 2 : b.h) * 8;
      const L = layout(b.strs, iw, ih);
      if (L.overflow) extra = Math.max(extra, (b.y + (b.border ? 1 : 0)) * 8 + L.lines * 8 - y1 + 2);
    }
    const realH = hh + Math.max(0, extra);
    canvas.width = ww; canvas.height = realH;
    canvas.style.width = (ww * scale) + 'px'; canvas.style.height = (realH * scale) + 'px';
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = C.screen; ctx.fillRect(0, 0, ww, realH);
    if (extra > 0) { ctx.fillStyle = '#120808'; ctx.fillRect(0, hh, ww, realH - hh); }
    ctx.save(); ctx.translate(-x0, -y0);
    if (sc.portrait && sc.portrait.url) {
      const e = portraitImg(sc.portrait.url, redraw);
      if (e.ok) ctx.drawImage(e.img, 168, 72);
      else if (e.bad || !redraw) { ctx.fillStyle = 'rgba(255,255,255,.06)'; ctx.fillRect(176, 72, 56, 80); }
    } else if (sc.portrait && sc.portrait.placeholder) {
      ctx.fillStyle = 'rgba(255,255,255,.06)'; ctx.fillRect(176, 72, 56, 80);
      ctx.fillStyle = 'rgba(255,255,255,.25)'; ctx.font = '10px monospace'; ctx.textAlign = 'center';
      ctx.fillText(sc.portrait.placeholder, 204, 116);
    }
    const out = [];
    for (const b of sc.bubbles) out.push(drawBubble(ctx, b));
    ctx.restore();
    if (!FONT) {
      ctx.fillStyle = '#ff9c9c'; ctx.font = '9px monospace';
      ctx.fillText('sys8.font.h не найден', 8, 12);
    }
    return out;
  }

  return { W, H, setFont, hasFont, setColors, colors, DEFAULT_COLORS, layout, sceneFor, reactionScene, measure, draw };
})();
