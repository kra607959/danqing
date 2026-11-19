// 把部落画到纸上。没探过的地方是白纸（边缘淡淡化开）；景物用神符同一套笔法：
// 林子里每棵树是一个手写的「树」，营火是一个「火」，房子就是你照着画的那张图纸。
import { symbolById } from '../recog/symbols.js';
import { makeRng, hashSeed } from '../recog/rng.js';
import { augment } from '../recog/synth.js';
import { bbox } from '../recog/geom.js';
import { inkStroke, polyline, COLORS } from '../ui/ink.js';
import { FOG, known } from '../sim/util.js';
import { RIVER_HALF } from '../sim/mapgen.js';
import { MAP } from '../sim/config.js';

// ---------------- 相机 ----------------
// x、y 是屏幕中心对着的纸面坐标；z 是 1 纸面单位合多少屏幕像素
export function createCamera() { return { x: 0, y: 0, z: 0.6, vw: 1, vh: 1 }; }
export const toScreen = (c, p) => ({ x: (p.x - c.x) * c.z + c.vw / 2, y: (p.y - c.y) * c.z + c.vh / 2 });
export const toWorld = (c, p) => ({ x: (p.x - c.vw / 2) / c.z + c.x, y: (p.y - c.vh / 2) / c.z + c.y });
export function clampCamera(c) {
  c.z = Math.max(0.22, Math.min(2.6, c.z));
  const hw = c.vw / 2 / c.z, hh = c.vh / 2 / c.z, m = 200;
  c.x = MAP.w < 2 * hw - 2 * m ? MAP.w / 2 : Math.max(hw - m, Math.min(MAP.w - hw + m, c.x));
  c.y = MAP.h < 2 * hh - 2 * m ? MAP.h / 2 : Math.max(hh - m, Math.min(MAP.h - hh + m, c.y));
}
export function zoomAt(c, sp, k) {
  const before = toWorld(c, sp);
  c.z *= k;
  clampCamera(c);
  const after = toWorld(c, sp);
  c.x += before.x - after.x; c.y += before.y - after.y;
  clampCamera(c);
}

// ---------------- 笔画素材（算一次存起来） ----------------
export function place(strokes, x, y, size) {
  const b = bbox(strokes), span = Math.max(b.w, b.h) || 1;
  return strokes.map(s => s.map(p => ({ x: x + (p.x - b.cx) / span * size, y: y + (p.y - b.cy) / span * size })));
}
// 点太密的笔画抽稀（地图上一个符几十个单位大，合成时的点距是按边长 1 定的）
function thin(strokes, d = 1.6) {
  return strokes.map(s => {
    const out = [s[0]];
    for (const p of s) { const q = out[out.length - 1]; if (Math.hypot(p.x - q.x, p.y - q.y) >= d) out.push(p); }
    if (out[out.length - 1] !== s[s.length - 1]) out.push(s[s.length - 1]);
    return out;
  });
}
const cache = new Map();
export function glyph(id, seed, x, y, size, L = 0.4) {
  const key = `${id}|${seed}|${x | 0}|${y | 0}|${size | 0}`;
  let g = cache.get(key);
  if (!g) {
    const r = makeRng(hashSeed('art', id, seed));
    g = thin(place(augment(symbolById(id).make(r), r, L), x, y, size), Math.max(1, size / 40));
    cache.set(key, g);
  }
  return g;
}
// 图纸（宽 1、高 0.7 的纸）上的笔画 → 地图上：按种类定大小和落地点
const SHEET = { shack: [84, 0.5, 0.6], rack: [70, 0.5, 0.62], hearth: [62, 0.5, 0.53] };
export function sheetToMap(type, strokes, x, y, id = null) {
  const key = id && `sheet|${id}|${x | 0}|${y | 0}`;
  if (key && cache.has(key)) return cache.get(key);
  const [k, ax, ay] = SHEET[type] || [70, 0.5, 0.6];
  const out = thin(Object.values(strokes).flat().filter(s => s.length > 1).map(s => s.map(p => ({ x: x + (p.x - ax) * k, y: y + (p.y - ay) * k }))), 1.2);
  if (key) cache.set(key, out);
  return out;
}
function rockShape(rk) {
  const key = `rock|${rk.id}`;
  let g = cache.get(key);
  if (!g) {
    const r = makeRng(hashSeed('rock', rk.id)), out = [];
    const n = 4 + r.int(3);
    for (let i = 0; i < n; i++) {
      const a = r.range(0, Math.PI * 2), d = i ? r.range(rk.r * 0.25, rk.r * 0.7) : 0, k = r.range(10, 18) * (i ? 0.8 : 1.2);
      const cx = rk.x + Math.cos(a) * d, cy = rk.y + Math.sin(a) * d * 0.7, P = [];
      for (let j = 0; j <= 7; j++) { const t = j / 7 * Math.PI * 2; P.push({ x: cx + Math.cos(t) * k * r.range(0.75, 1.15), y: cy + Math.sin(t) * k * 0.68 * r.range(0.75, 1.15) }); }
      P[P.length - 1] = P[0];
      out.push(P);
    }
    cache.set(key, (g = out));
  }
  return g;
}
function riverBanks(river) {
  const key = 'banks';
  let g = cache.get(key);
  if (g && g.river === river) return g;
  const L = [], R = [];
  for (let i = 0; i < river.length; i += 2) {
    const a = river[Math.max(0, i - 2)], b = river[Math.min(river.length - 1, i + 2)], p = river[i];
    const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1, nx = -dy / d, ny = dx / d, w = RIVER_HALF * (0.9 + 0.2 * Math.sin(i * 0.07));
    L.push({ x: p.x + nx * w, y: p.y + ny * w }); R.push({ x: p.x - nx * w, y: p.y - ny * w });
  }
  g = { river, L, R };
  cache.set(key, g);
  return g;
}

// ---------------- 迷雾：没探过的地方盖一层纸 ----------------
let fogMask = null, fogStamp = -1;
function fogCanvas(sim) {
  if (!fogMask) { fogMask = document.createElement('canvas'); fogMask.width = FOG.cols; fogMask.height = FOG.rows; }
  if (fogStamp !== sim.revealed) {
    fogStamp = sim.revealed;
    const g = fogMask.getContext('2d'), img = g.createImageData(FOG.cols, FOG.rows);
    for (let i = 0; i < sim.fog.length; i++) { img.data[i * 4 + 3] = sim.fog[i] ? 0 : 255; }
    g.putImageData(img, 0, 0);
  }
  return fogMask;
}
let layer = null, layer2 = null;
function scratch(w, h, dpr, which = 1) {
  let c = which === 1 ? layer : layer2;
  if (!c) { c = document.createElement('canvas'); if (which === 1) layer = c; else layer2 = c; }
  const W = Math.round(w * dpr), H = Math.round(h * dpr);
  if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
  const g = c.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.globalCompositeOperation = 'source-over';
  g.clearRect(0, 0, w, h);
  return { c, g };
}
export function drawFog(ctx, sim, cam, paperCanvas, w, h, dpr) {
  const { c, g } = scratch(w, h, dpr);
  g.fillStyle = '#000';
  // 纸外头也盖上
  const o = toScreen(cam, { x: 0, y: 0 }), W = MAP.w * cam.z, H = MAP.h * cam.z;
  g.fillRect(0, 0, w, Math.max(0, o.y)); g.fillRect(0, o.y + H, w, h); g.fillRect(0, 0, Math.max(0, o.x), h); g.fillRect(o.x + W, 0, w, h);
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  // 一格 50 单位：放大时双线性插值，边缘自然化开半格
  g.drawImage(fogCanvas(sim), o.x - cam.z * MAP.cell * 0.5, o.y - cam.z * MAP.cell * 0.5, W + cam.z * MAP.cell, H + cam.z * MAP.cell);
  g.globalCompositeOperation = 'source-in';
  g.drawImage(paperCanvas, 0, 0, w, h);
  ctx.drawImage(c, 0, 0, w, h);
}

// 夜：整张纸暗下来，火堆周围亮着
export function drawNight(ctx, sim, cam, w, h, dpr) {
  const L = sim.now.light ?? 1;
  const a = 0.5 * Math.max(0, Math.min(1, (1 - L) / 0.7));
  if (a < 0.01) return;
  const { c, g } = scratch(w, h, dpr, 2);
  g.fillStyle = `rgba(16,20,38,${a})`;
  g.fillRect(0, 0, w, h);
  g.globalCompositeOperation = 'destination-out';
  for (const f of sim.fires) {
    if (!f.lit) continue;
    const s = toScreen(cam, f), r = (f.radius || 90) * 1.5 * cam.z * (0.9 + 0.1 * Math.min(1, f.fuel / 6));
    if (s.x < -r || s.y < -r || s.x > w + r || s.y > h + r) continue;
    const gr = g.createRadialGradient(s.x, s.y, 0, s.x, s.y, r);
    gr.addColorStop(0, 'rgba(0,0,0,0.95)'); gr.addColorStop(0.5, 'rgba(0,0,0,0.55)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr;
    g.fillRect(s.x - r, s.y - r, 2 * r, 2 * r);
  }
  ctx.drawImage(c, 0, 0, w, h);
}

// ---------------- 景物 ----------------
function batch(ctx, strokes, { width = 1.6, color = COLORS.ink, alpha = 1, dash = null } = {}) {
  ctx.save();
  ctx.globalAlpha = alpha; ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  if (dash) ctx.setLineDash(dash);
  ctx.beginPath();
  for (const s of strokes) { if (s.length < 2) continue; ctx.moveTo(s[0].x, s[0].y); for (let i = 1; i < s.length; i++) ctx.lineTo(s[i].x, s[i].y); }
  ctx.stroke();
  ctx.restore();
}
const inView = (v, x, y, m = 80) => x > v.x0 - m && x < v.x1 + m && y > v.y0 - m && y < v.y1 + m;

export function drawWorld(ctx, sim, cam, ui) {
  const tl = toWorld(cam, { x: 0, y: 0 }), br = toWorld(cam, { x: cam.vw, y: cam.vh });
  const v = { x0: tl.x, y0: tl.y, x1: br.x, y1: br.y };
  const z = cam.z, px = 1 / z; // 一个屏幕像素合多少纸面单位
  const M = sim.map;
  // 远山
  const hills = [];
  for (const h of M.hills || []) if (inView(v, h.x, h.y, 200) && known(sim, h.x, h.y)) hills.push(...glyph('shan', h.seed, h.x, h.y, h.size, 0.3));
  batch(ctx, hills, { width: 1.3, color: COLORS.pencil, alpha: 0.45 });
  // 河：一道淡水痕 + 两岸
  const B = riverBanks(M.river);
  ctx.save();
  ctx.globalAlpha = 0.22; ctx.strokeStyle = '#6f8aa6'; ctx.lineWidth = RIVER_HALF * 2; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath(); M.river.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.stroke();
  ctx.restore();
  batch(ctx, [B.L, B.R], { width: 1.8, color: '#3c4f63', alpha: 0.7 });
  // 路
  for (const r of sim.roads) for (const s of r.segs) polyline(ctx, [s.a, s.b], { width: s.built ? 5 : 2, color: s.built ? '#8a7f6c' : COLORS.pencil, alpha: s.built ? 0.45 : 0.5, dash: s.built ? null : [3, 6] });
  // 浆果丛
  ctx.save();
  for (const b of M.bushes) {
    if (!inView(v, b.x, b.y) || !known(sim, b.x, b.y)) continue;
    ctx.globalAlpha = 0.75; ctx.strokeStyle = '#3f5a32'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(b.x, b.y, 9, 0, Math.PI * 2); ctx.stroke();
    const n = Math.round(b.food);
    ctx.fillStyle = COLORS.red; ctx.globalAlpha = 0.85;
    for (let i = 0; i < n; i++) { const a = i * 2.4; ctx.beginPath(); ctx.arc(b.x + Math.cos(a) * 5, b.y + Math.sin(a) * 5, 1.6, 0, Math.PI * 2); ctx.fill(); }
  }
  ctx.restore();
  // 石堆
  const rocks = [];
  for (const r of M.rocks) if (inView(v, r.x, r.y) && known(sim, r.x, r.y) && r.stone > 0) rocks.push(...rockShape(r));
  batch(ctx, rocks, { width: 1.6, color: '#4a443c', alpha: 0.85 });
  // 树：活的墨色，烧过的焦，砍了的剩桩，树苗小
  const live = [], burnt = [], stumps = [];
  for (const f of M.forests) {
    if (!inView(v, f.x, f.y, f.r + 60)) continue;
    for (const t of f.trees) {
      if (!known(sim, t.x, t.y)) continue;
      if (t.alive) live.push(...glyph('shu', t.seed, t.x, t.y, t.size));
      else if (t.burnt) burnt.push(...glyph('shu', t.seed, t.x, t.y, t.size * 0.8, 0.6));
      else if (t.young && t.regrow !== Infinity) stumps.push(...glyph('shu', t.seed, t.x, t.y + 6, t.size * 0.4));
      else stumps.push([{ x: t.x - 3, y: t.y + 8 }, { x: t.x - 2, y: t.y + 2 }, { x: t.x + 3, y: t.y + 2 }, { x: t.x + 3, y: t.y + 8 }]);
    }
    if (f.nuts >= 1 && known(sim, f.x, f.y) && z > 0.45) ui.labels.push({ x: f.x, y: f.y + f.r * 0.7, text: `坚果 ${Math.floor(f.nuts)}`, color: '#7a5a20' });
  }
  batch(ctx, live, { width: Math.max(1.4, 1.1 * px), color: '#2c3a26', alpha: 0.9 });
  batch(ctx, burnt, { width: 1.4, color: '#6b4a32', alpha: 0.55 });
  batch(ctx, stumps, { width: 1.5, color: '#6b5a44', alpha: 0.75 });
  // 朱笔：禁区、封锁线、护圈；石墙；篱笆
  for (const w of sim.barriers) {
    const k = w.max ? 0.35 + 0.65 * Math.max(0, w.hp) / w.max : 1;
    if (w.kind === 'zone') {
      ctx.save(); ctx.globalAlpha = 0.07; ctx.fillStyle = COLORS.red; ctx.beginPath(); w.pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath(); ctx.fill(); ctx.restore();
      polyline(ctx, w.pts, { width: 3, color: COLORS.red, alpha: 0.85 * k, dash: [10, 6], close: true });
    } else if (w.kind === 'red') polyline(ctx, w.pts, { width: 4, color: COLORS.red, alpha: 0.9 * k });
    else if (w.kind === 'guard') { ctx.save(); ctx.globalAlpha = 0.7 * k; ctx.strokeStyle = COLORS.red; ctx.lineWidth = 2.5; ctx.setLineDash([6, 6]); ctx.beginPath(); ctx.arc(w.x, w.y, w.r, 0, Math.PI * 2); ctx.stroke(); ctx.restore(); }
    else if (w.kind === 'wall') polyline(ctx, w.pts, { width: 9, color: '#6f6658', alpha: 0.75 * k });
    if (w.max && (w.kind === 'red' || w.kind === 'zone') && z > 0.4) { const m = w.pts[w.pts.length >> 1]; ui.labels.push({ x: m.x, y: m.y - 14, text: `承受 ${Math.ceil(Math.max(0, w.hp))}/${w.max}`, color: COLORS.red }); }
  }
  for (const b of sim.bans) {
    ctx.save(); ctx.strokeStyle = COLORS.red; ctx.lineWidth = 3.4; ctx.globalAlpha = 0.85;
    ctx.beginPath(); ctx.moveTo(b.x - 14, b.y - 14); ctx.lineTo(b.x + 14, b.y + 14); ctx.moveTo(b.x + 14, b.y - 14); ctx.lineTo(b.x - 14, b.y + 14); ctx.stroke(); ctx.restore();
  }
  for (const F of sim.fences) for (const s of F.segs) {
    if (!inView(v, s.a.x, s.a.y)) continue;
    if (!s.built) { polyline(ctx, [s.a, s.b], { width: 1.4, color: s.broken ? COLORS.red : COLORS.pencil, alpha: 0.6, dash: [4, 5] }); continue; }
    const st = [], L = Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y), n = Math.max(2, Math.round(L / 9)), hgt = 8 + 8 * (F.params.height || 0.6);
    for (let i = 0; i <= n; i++) { const x = s.a.x + (s.b.x - s.a.x) * i / n, y = s.a.y + (s.b.y - s.a.y) * i / n; st.push([{ x, y }, { x, y: y - hgt }]); }
    st.push([{ x: s.a.x, y: s.a.y - hgt * 0.45 }, { x: s.b.x, y: s.b.y - hgt * 0.45 }], [{ x: s.a.x, y: s.a.y - hgt * 0.8 }, { x: s.b.x, y: s.b.y - hgt * 0.8 }]);
    batch(ctx, st, { width: 1.5, color: '#4b3a26', alpha: 0.85 });
  }
  // 工地：铅笔虚线 + 进度
  for (const s of sim.sites) {
    if (s.type === 'fenceSeg' || !inView(v, s.x, s.y)) continue;
    if (s.strokes) batch(ctx, sheetToMap(s.type, s.strokes, s.x, s.y, s.id), { width: 1.3, color: COLORS.pencil, alpha: 0.6, dash: [3, 4] });
    else batch(ctx, siteGlyph(s), { width: 1.3, color: COLORS.pencil, alpha: 0.6, dash: [3, 4] });
    const k = Math.min(1, s.progress / (s.work || 1));
    ctx.save(); ctx.fillStyle = 'rgba(31,27,23,0.15)'; ctx.fillRect(s.x - 18, s.y + 10, 36, 4); ctx.fillStyle = COLORS.ink; ctx.fillRect(s.x - 18, s.y + 10, 36 * k, 4); ctx.restore();
    if (z > 0.5) {
      const miss = Object.entries(s.need).map(([m, n]) => [m, n - (s.have[m] || 0)]).filter(([, n]) => n > 0.01);
      ui.labels.push({ x: s.x, y: s.y + 26, text: miss.length ? `${s.name} · 缺${miss.map(([m, n]) => `${{ wood: '木', stone: '石', grass: '草', hide: '皮' }[m]}${Math.ceil(n)}`).join(' ')}` : `${s.name} · 在盖`, color: COLORS.pencil });
    }
  }
  // 房子：就是你画的那张图纸
  for (const b of sim.buildings) {
    if (!inView(v, b.x, b.y)) continue;
    if (b.strokes) batch(ctx, sheetToMap(b.type, b.strokes, b.x, b.y, b.id), { width: 2.1, color: COLORS.ink, alpha: 0.9 });
    else batch(ctx, siteGlyph(b), { width: 2, color: COLORS.ink, alpha: 0.85 });
    if (b.type === 'rack' && b.load?.length) {
      const n = Math.min(8, Math.ceil(b.load.reduce((s, x) => s + x.n, 0) / 4));
      ctx.save(); ctx.strokeStyle = '#8a3a22'; ctx.lineWidth = 2.2; ctx.globalAlpha = 0.85;
      for (let i = 0; i < n; i++) { const x = b.x - 14 + i * 4; ctx.beginPath(); ctx.moveTo(x, b.y - 26); ctx.lineTo(x + 1, b.y - 16); ctx.stroke(); }
      ctx.restore();
    }
    if (z > 0.75) ui.labels.push({ x: b.x, y: b.y + 18, text: b.type === 'shack' ? `窝棚 · ${b.cap} 人` : b.type === 'rack' ? `晾肉架 ${Math.round(b.load.reduce((s, x) => s + x.n, 0))}/${b.cap}` : b.name, color: COLORS.ink3 || '#7c7468' });
  }
  // 火
  for (const f of sim.fires) {
    if (!inView(v, f.x, f.y)) continue;
    if (f.lit) {
      const r = 34 + 10 * Math.min(1, f.fuel / 10), g = ctx.createRadialGradient(f.x, f.y - 6, 0, f.x, f.y - 6, r);
      g.addColorStop(0, 'rgba(230,120,40,0.45)'); g.addColorStop(1, 'rgba(230,120,40,0)');
      ctx.fillStyle = g; ctx.fillRect(f.x - r, f.y - 6 - r, 2 * r, 2 * r);
    }
    const flicker = f.lit ? Math.floor(ui.t / 260) % 3 : 0;
    batch(ctx, glyph('huo', f.id.length * 7 + flicker, f.x, f.y - 8, f.kind === 'hearth' ? 22 : 24, 0.35), { width: 2.2, color: f.lit ? '#b3401f' : '#8a8378', alpha: f.lit ? 0.95 : 0.6 });
    if (z > 0.6) ui.labels.push({ x: f.x, y: f.y + 16, text: f.lit ? `${f.name} · 柴 ${f.fuel.toFixed(0)}` : `${f.name}（灭了）`, color: f.lit ? '#9a3a1a' : COLORS.pencil });
  }
  // 鹿群、野兽：在白纸上的看不见
  ctx.save();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const h of sim.herds) {
    if (h.n <= 0 || !inView(v, h.x, h.y) || !known(sim, h.x, h.y)) continue;
    ctx.fillStyle = '#6b4f2a'; ctx.globalAlpha = 0.8;
    for (let i = 0; i < h.n; i++) { const a = i * 2.39996, d = 6 + 5 * Math.sqrt(i); ctx.beginPath(); ctx.ellipse(h.x + Math.cos(a) * d, h.y + Math.sin(a) * d * 0.6, 4.2, 2.6, 0, 0, Math.PI * 2); ctx.fill(); }
    ctx.globalAlpha = 0.9; ctx.font = `600 16px ${SERIF}`; ctx.fillText('鹿', h.x, h.y - 22);
    if (z > 0.55) ui.labels.push({ x: h.x, y: h.y + 20, text: `鹿群 ${h.n}`, color: '#6b4f2a' });
  }
  for (const b of sim.beasts) {
    if (b.dead || b.gone || !inView(v, b.x, b.y) || !known(sim, b.x, b.y)) continue;
    const tiger = b.kind === 'tiger', size = tiger ? 34 : 24;
    if (b.state === 'stalk' && sim.idx[b.target]?.name) {
      const t = sim.idx[b.target];
      polyline(ctx, [b, t], { width: 1.6, color: COLORS.red, alpha: 0.6, dash: [4, 6] });
    }
    ctx.font = `700 ${size}px ${SERIF}`;
    ctx.globalAlpha = b.state === 'rest' ? 0.6 : 0.95;
    ctx.fillStyle = tiger ? '#9b4a12' : '#4d4a44';
    ctx.fillText(tiger ? '虎' : '狼', b.x, b.y);
    if (b.state === 'stalk' && z > 0.3) ui.labels.push({ x: b.x, y: b.y + size * 0.8, text: tiger ? '虎在潜近' : '狼在潜近', color: COLORS.red });
  }
  ctx.restore();
  drawPeople(ctx, sim, cam, ui);
}
const SERIF = '"Noto Serif SC", "Source Han Serif SC", "Songti SC", STSong, SimSun, serif';
function siteGlyph(s) {
  const seed = s.n || 1;
  if (s.type === 'well') return glyph('shui', seed, s.x, s.y - 10, 26);
  if (s.type === 'outpost') return glyph('qi', seed, s.x, s.y - 16, 34);
  if (s.type === 'cairn') return glyph('shan', seed, s.x, s.y - 10, 30);
  if (s.type === 'sapling') return glyph('shu', seed, s.x, s.y - 8, 22);
  if (s.type === 'fire') return glyph('huo', seed, s.x, s.y - 8, 22);
  return glyph('shan', seed, s.x, s.y - 10, 26);
}

// ---------------- 人 ----------------
const JOB = {
  eat: '吃饭', drink: '喝水', warm: '烤火', sleep: '睡觉', rest: '歇着', idle: '闲着', play: '玩耍', flee: '逃命', gather: '采浆果', nuts: '拾坚果',
  chop: '砍柴', quarry: '采石', grass: '割草', fish: '叉鱼', water: '挑水', hunt: '打猎', fight: '打兽', build: '盖房', tend: '添柴', kindle: '生火',
  sew: '缝皮衣', explore: '探路', scout: '探路', road: '修路', rally: '集结', train: '操练', migrate: '迁徙',
};
export const jobName = p => (p.job ? JOB[p.job.kind] || p.job.kind : '发呆');
const last = new Map();
function drawPeople(ctx, sim, cam, ui) {
  const z = cam.z;
  for (const p of sim.alive) {
    if (p.inside) continue; // 在窝棚里
    const prev = last.get(p.id), moving = prev && Math.hypot(prev.x - p.x, prev.y - p.y) > 0.05;
    last.set(p.id, { x: p.x, y: p.y });
    const s = p.age < 14 ? 0.55 + p.age / 30 : 1;
    const sel = ui.selected === p.id;
    ctx.save();
    ctx.strokeStyle = p.health < 0.4 || p.sick > 0 ? '#6a3a2a' : COLORS.ink; ctx.lineWidth = 1.8; ctx.lineCap = 'round';
    if (sel) { ctx.save(); ctx.strokeStyle = COLORS.gold; ctx.lineWidth = 2; ctx.globalAlpha = 0.9; ctx.beginPath(); ctx.ellipse(p.x, p.y + 2, 16, 7, 0, 0, Math.PI * 2); ctx.stroke(); ctx.restore(); }
    if (p.asleep) {
      ctx.beginPath(); ctx.arc(p.x - 14 * s, p.y - 3, 4.5 * s, 0, Math.PI * 2); ctx.moveTo(p.x - 9 * s, p.y - 3); ctx.lineTo(p.x + 10 * s, p.y - 2); ctx.stroke();
      if (z > 0.5) { ctx.fillStyle = COLORS.pencil; ctx.font = `${10}px sans-serif`; ctx.fillText('z', p.x + 8, p.y - 12 - (ui.t / 400 % 4)); }
    } else {
      const k = moving ? Math.sin(ui.t / 110 + p.n) * 5 : 0;
      ctx.beginPath();
      ctx.arc(p.x, p.y - 30 * s, 5.5 * s, 0, Math.PI * 2);
      ctx.moveTo(p.x, p.y - 24.5 * s); ctx.lineTo(p.x, p.y - 9 * s);
      ctx.moveTo(p.x, p.y - 20 * s); ctx.lineTo(p.x - 8 * s, p.y - 13 * s - k * 0.3);
      ctx.moveTo(p.x, p.y - 20 * s); ctx.lineTo(p.x + 8 * s, p.y - 13 * s + k * 0.3);
      ctx.moveTo(p.x, p.y - 9 * s); ctx.lineTo(p.x - 5 * s - k * 0.4 * s, p.y);
      ctx.moveTo(p.x, p.y - 9 * s); ctx.lineTo(p.x + 5 * s + k * 0.4 * s, p.y);
      ctx.stroke();
      if (p.carry) { ctx.fillStyle = p.carry.kind === 'meat' ? '#8a3a22' : p.carry.kind === 'wood' ? '#6b4f2a' : '#4a6a3a'; ctx.beginPath(); ctx.arc(p.x + 8 * s, p.y - 16 * s, 3, 0, Math.PI * 2); ctx.fill(); }
      if (p.clothes) { ctx.strokeStyle = '#7a5a30'; ctx.lineWidth = 2.6; ctx.globalAlpha = 0.6; ctx.beginPath(); ctx.moveTo(p.x, p.y - 22 * s); ctx.lineTo(p.x, p.y - 11 * s); ctx.stroke(); }
    }
    ctx.restore();
    if (z > 0.7 || sel) ui.labels.push({ x: p.x, y: p.y - 44 * s, text: z > 1.05 || sel ? `${p.name} · ${jobName(p)}` : p.name, color: sel ? '#8a5a10' : COLORS.ink, strong: sel });
  }
}

// ---------------- 小字（按屏幕像素画，缩小了也看得清） ----------------
export function drawLabels(ctx, cam, labels) {
  ctx.save();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const seen = [];
  for (const L of labels) {
    const s = toScreen(cam, L);
    if (s.x < -60 || s.y < -20 || s.x > cam.vw + 60 || s.y > cam.vh + 20) continue;
    if (!L.strong && seen.some(q => Math.abs(q.x - s.x) < 46 && Math.abs(q.y - s.y) < 12)) continue; // 挤在一起的只留一个
    seen.push(s);
    ctx.font = `${L.strong ? '600 ' : ''}12px system-ui, "Microsoft YaHei", sans-serif`;
    const w = ctx.measureText(L.text).width;
    ctx.fillStyle = 'rgba(243,235,216,0.78)'; ctx.fillRect(s.x - w / 2 - 3, s.y - 8, w + 6, 16);
    ctx.fillStyle = L.color || COLORS.ink;
    ctx.fillText(L.text, s.x, s.y);
  }
  ctx.restore();
}

// ---------------- 天：屏幕顶上一条，写「雨」「火」的地方 ----------------
export function drawSky(ctx, sim, w, top, h, t) {
  const L = sim.now.light ?? 1, hour = sim.now.hour ?? 12, wet = sim.weather.wet;
  ctx.save();
  const g = ctx.createLinearGradient(0, top, 0, top + h);
  const day = wet ? [150, 158, 165] : [176, 196, 214], night = [36, 42, 70];
  const mix = (a, b, k) => a.map((x, i) => Math.round(x * k + b[i] * (1 - k)));
  const kL = Math.max(0, Math.min(1, (L - 0.3) / 0.7));
  const c = mix(day, night, kL);
  g.addColorStop(0, `rgba(${c},0.55)`); g.addColorStop(1, `rgba(${c},0)`);
  ctx.fillStyle = g; ctx.fillRect(0, top, w, h);
  // 日、月按时辰走
  const isDay = hour >= 5 && hour < 19, f = isDay ? (hour - 5) / 14 : ((hour + 24 - 19) % 24) / 10;
  const x = w * (0.08 + 0.84 * f), y = top + h * 0.45 - Math.sin(f * Math.PI) * h * 0.25;
  if (!wet) {
    ctx.globalAlpha = 0.75; ctx.fillStyle = isDay ? '#d9a03a' : '#e8e4d0';
    ctx.beginPath(); ctx.arc(x, y, isDay ? 11 : 8, 0, Math.PI * 2); ctx.fill();
  } else {
    ctx.globalAlpha = 0.5; ctx.fillStyle = '#7d8590';
    for (let i = 0; i < 5; i++) { const cx = ((i * 0.23 + t / 90000) % 1) * w; ctx.beginPath(); ctx.ellipse(cx, top + h * 0.35, 46, 12, 0, 0, Math.PI * 2); ctx.fill(); }
  }
  ctx.globalAlpha = 0.5; ctx.fillStyle = kL < 0.4 ? '#e8e4d0' : COLORS.ink;
  ctx.font = `600 15px ${SERIF}`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText('天', 12, top + h * 0.45);
  ctx.font = '11px system-ui, "Microsoft YaHei", sans-serif'; ctx.globalAlpha = 0.45;
  ctx.fillText('在这一条上写「雨」降雨、「火」降雷火', 34, top + h * 0.45);
  ctx.restore();
}

// 雨、雪：屏幕上一层
export function drawWeather(ctx, sim, w, h, t) {
  if (!sim.weather.wet) return;
  ctx.save();
  if (sim.weather.kind === 'snow') {
    // 宣纸是浅色的，白雪看不见：用淡墨点，外加一圈白边
    for (let i = 0; i < 170; i++) {
      const x = ((i * 97.3 + Math.sin(t / 900 + i) * 20) % w + w) % w, y = (i * 211 + t * 0.04) % h, r = 1.4 + (i % 3) * 0.5;
      ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.beginPath(); ctx.arc(x, y, r + 0.9, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(96,110,135,0.55)'; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
  } else {
    ctx.strokeStyle = 'rgba(60,80,110,0.3)'; ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (let i = 0; i < 180; i++) { const x = (i * 97.3 + t * 0.05) % w, y = (i * 211 + t * 0.6) % h; ctx.moveTo(x, y); ctx.lineTo(x - 5, y + 15); }
    ctx.stroke();
  }
  ctx.restore();
}

// 雷火、圣光、烧荒：按真实时间放一小会儿
export function drawEffects(ctx, fx, now) {
  for (let i = fx.length - 1; i >= 0; i--) {
    const f = fx[i], k = (now - f.t0) / f.dur;
    if (k >= 1) { fx.splice(i, 1); continue; }
    ctx.save();
    if (f.kind === 'bolt') {
      polyline(ctx, [{ x: f.x + 40, y: f.y - 600 }, { x: f.x - 14, y: f.y - 260 }, { x: f.x + 24, y: f.y - 140 }, { x: f.x, y: f.y }], { width: 5, color: '#c99a2e', alpha: 1 - k });
      const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, 140);
      g.addColorStop(0, `rgba(255,240,200,${0.6 * (1 - k)})`); g.addColorStop(1, 'rgba(255,240,200,0)');
      ctx.fillStyle = g; ctx.fillRect(f.x - 140, f.y - 140, 280, 280);
    } else if (f.kind === 'light') {
      for (let j = 0; j < 14; j++) {
        const a = j / 14 * Math.PI * 2 + now / 2000;
        polyline(ctx, [{ x: f.x + Math.cos(a) * 50, y: f.y + Math.sin(a) * 32 }, { x: f.x + Math.cos(a) * 230, y: f.y + Math.sin(a) * 150 }], { width: 3, color: COLORS.gold, alpha: 0.55 * (1 - k) });
      }
    } else if (f.kind === 'burn' || f.kind === 'flare') {
      const r = f.r ? f.r + 60 : 70, g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, r);
      g.addColorStop(0, `rgba(200,90,40,${0.5 * (1 - k)})`); g.addColorStop(1, 'rgba(200,90,40,0)');
      ctx.fillStyle = g; ctx.fillRect(f.x - r, f.y - r, 2 * r, 2 * r);
    }
    ctx.restore();
  }
}
