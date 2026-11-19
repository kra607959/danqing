// 铅笔图纸：目标先选好，再照提示一部分一部分画。不做分类，只量这部分画得多高、多直、接没接上。
// 数值跟着画走，但上下都有限：画歪了不会废掉，画得好有奖励。
// 坐标：图纸宽 1、高 0.7，y 向下。

import { length, bbox, pca, straightness, flat, distToPolyline, crossings, line, poly, curve, arc } from './geom.js';

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const deg = r => r * 180 / Math.PI;
const longest = (S, k) => [...S].sort((a, b) => length(b) - length(a)).slice(0, k);
const ends = s => { // 上端、下端
  const a = s[0], b = s[s.length - 1];
  return a.y <= b.y ? { top: a, bot: b } : { top: b, bot: a };
};
// 两条无限长直线的交点
function meet(p1, p2, p3, p4) {
  const d = (p1.x - p2.x) * (p3.y - p4.y) - (p1.y - p2.y) * (p3.x - p4.x);
  if (Math.abs(d) < 1e-9) return null;
  const a = p1.x * p2.y - p1.y * p2.x, b = p3.x * p4.y - p3.y * p4.x;
  return { x: (a * (p3.x - p4.x) - (p1.x - p2.x) * b) / d, y: (a * (p3.y - p4.y) - (p1.y - p2.y) * b) / d };
}
// 横不横：与水平线的夹角（度）
const tilt = s => { const e = s[s.length - 1], o = s[0]; return Math.abs(deg(Math.atan2(e.y - o.y, Math.abs(e.x - o.x) || 1e-9))); };
// 与竖直方向的夹角（度）
const lean = s => { const { top, bot } = ends(s); return deg(Math.atan2(Math.abs(top.x - bot.x), Math.abs(bot.y - top.y) || 1e-9)); };
const overlap = (a0, a1, b0, b1) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
const avg = A => A.reduce((s, x) => s + x, 0) / (A.length || 1);
const sdev = A => { const m = avg(A); return Math.sqrt(avg(A.map(x => (x - m) ** 2))); };
const bar = (x, lo = 0.35) => clamp(lo + (1 - lo) * x, lo, 1);
// 竖着的笔画按横向位置归堆：断成两截的一根柱子还算一根
function columns(S, maxLean = 22, minLen = 0.05) {
  const v = S.filter(s => length(s) > minLen * 0.5 && lean(s) < maxLean).map(s => ({ s, b: bbox([s]) })).sort((a, b) => a.b.cx - b.b.cx);
  const out = [];
  for (const it of v) {
    const g = out.at(-1);
    if (g && Math.abs(it.b.cx - g.cx) < 0.03) { g.lines.push(it.s); g.b = bbox(g.lines); g.cx = g.b.cx; }
    else out.push({ lines: [it.s], b: it.b, cx: it.b.cx });
  }
  return out.filter(g => g.b.h > minLen);
}

// ---------------- 窝棚（第一代） ----------------

function fitFrame(S) {
  S = S.filter(s => length(s) > 0.04);
  let A, B;
  if (S.length >= 2) [A, B] = longest(S, 2);
  else if (S.length === 1) { // 一笔「人」字：在最高点劈开
    const s = S[0];
    let k = 0;
    s.forEach((p, i) => { if (p.y < s[k].y) k = i; });
    if (k < 3 || k > s.length - 4) return { ok: false, msg: '画两根斜木，在顶上交成「人」字' };
    A = s.slice(0, k + 1); B = s.slice(k);
  } else return { ok: false, msg: '画两根斜木，在顶上交成「人」字' };
  const ea = ends(A), eb = ends(B);
  const [L, R] = ea.bot.x <= eb.bot.x ? [{ s: A, ...ea }, { s: B, ...eb }] : [{ s: B, ...eb }, { s: A, ...ea }];
  const la = lean(L.s), lb = lean(R.s);
  const inward = L.top.x > L.bot.x && R.top.x < R.bot.x;
  if (!inward || la < 6 || lb < 6 || la > 78 || lb > 78) return { ok: false, msg: '两根木头要斜着往中间靠，顶上交在一起' };
  const apex = meet(L.top, L.bot, R.top, R.bot) || { x: (L.top.x + R.top.x) / 2, y: Math.min(L.top.y, R.top.y) };
  const gap = Math.hypot(L.top.x - R.top.x, L.top.y - R.top.y);
  const width = R.bot.x - L.bot.x, footY = (L.bot.y + R.bot.y) / 2, height = footY - apex.y;
  if (width < 0.08 || height < 0.06) return { ok: false, msg: '窝棚太小了，画大一点' };
  return {
    ok: true, msg: gap < 0.04 ? '斜木交上了' : '顶上没交上，会漏风',
    v: { width, height, apex, footL: L.bot, footR: R.bot, footY, gap, joined: gap < 0.04, straight: (straightness(L.s) + straightness(R.s)) / 2, sym: Math.abs(la - lb), lines: [L.s, R.s] },
  };
}

function fitGround(S, parts) {
  const f = parts.frame.v;
  const s = longest(S.filter(x => length(x) > 0.04), 1)[0];
  if (!s) return { ok: false, msg: '在两根斜木底下画一道地面' };
  const b = bbox([s]);
  if (tilt(s) > 18) return { ok: false, msg: '地面要横着画' };
  if (Math.abs(b.cy - f.footY) > 0.09) return { ok: false, msg: '地面要画在斜木脚下' };
  const cover = overlap(b.x0, b.x1, f.footL.x, f.footR.x) / f.width;
  const off = (distToPolyline(f.footL, s) + distToPolyline(f.footR, s)) / 2;
  return { ok: true, msg: cover > 0.9 ? '地面托住了两根木头' : '地面没铺满两脚之间', v: { cover, off, flat: 1 - tilt(s) / 18, y: b.cy, s } };
}

function fitDoor(S, parts) {
  const f = parts.frame.v, g = parts.ground.v;
  S = S.filter(x => length(x) > 0.015);
  if (!S.length) return { ok: false, msg: '在中间开一扇门' };
  const b = bbox(S);
  if (b.cx < f.footL.x || b.cx > f.footR.x) return { ok: false, msg: '门要开在两根斜木之间' };
  if (Math.abs(b.y1 - g.y) > 0.07) return { ok: false, msg: '门要落在地面上' };
  const wr = b.w / f.width, hr = b.h / f.height;
  if (hr > 0.95) return { ok: false, msg: '门比窝棚还高了' };
  return { ok: true, msg: wr < 0.45 ? '门不大，挡风' : '门开得大，进出方便但漏风', v: { wr, hr, center: Math.abs(b.cx - (f.footL.x + f.footR.x) / 2) / f.width } };
}

function fitThatch(S, parts) {
  const [L, R] = parts.frame.v.lines;
  const n = S.filter(s => length(s) > 0.025 && length(s) < 0.4).filter(s => {
    const m = s[s.length >> 1];
    return Math.min(distToPolyline(m, L), distToPolyline(m, R)) < 0.07;
  }).length;
  return { ok: true, msg: n ? `铺了 ${n} 道草` : '没铺草：冬天冷', v: { n } };
}

// 量出来的东西 → 模拟用的数值。数值有上下限：画歪了不会废掉，画得好有奖励
function shackParams(P) {
  const f = P.frame.v, g = P.ground?.v, d = P.door?.v, t = P.thatch?.v || { n: 0 };
  const pitch = deg(Math.atan2(f.height, f.width / 2));
  const q = {
    rain: clamp((pitch - 35) / 30, 0, 1),
    sturdy: f.straight * (f.joined ? 1 : 0.6) * (g ? clamp(g.cover, 0, 1) : 0.5) * clamp(1 - f.sym / 40, 0.5, 1),
    warm: clamp(0.45 + Math.min(t.n, 4) * 0.12 - (d ? Math.max(0, d.wr - 0.3) : 0.3), 0, 1),
  };
  return {
    cap: clamp(Math.round(f.width / 0.09), 2, 6),
    rainproof: +bar(q.rain).toFixed(2), sturdy: +bar(q.sturdy).toFixed(2), warmth: +bar(q.warm).toFixed(2),
    need: { wood: 2 + Math.round((length(f.lines[0]) + length(f.lines[1])) / 0.12), grass: Math.min(t.n, 6) * 2 },
    pitch, q,
  };
}
function shackStats(P) {
  const p = shackParams(P), f = P.frame.v;
  return [
    { k: '容纳', v: `${p.cap} 人`, x: clamp(f.width / 0.54, 0.2, 1), why: '地基越宽住得越多（2–6 人）' },
    { k: '防雨', v: `${Math.round(p.pitch)}°`, x: p.rainproof, why: '屋顶越陡越不漏雨（40° 以上下雨不湿）' },
    { k: '稳固', v: '', x: p.sturdy, why: '木头直、顶上交上、地面托住、两边对称；不稳的棚子饿狼扒得开' },
    { k: '保暖', v: '', x: p.warmth, why: '门小、草铺得多更暖' },
    { k: '用料', v: `木 ${p.need.wood} · 草 ${p.need.grass}`, x: null, why: '木头越长越费，铺一道草要 2 份草' },
  ];
}

// ---------------- 火塘（第一代） ----------------
// 石圈：一圈（几笔凑成一圈也行）。量围得全不全、圆不圆、多大
function fitRing(S) {
  S = S.filter(s => length(s) > 0.03);
  if (!S.length) return { ok: false, msg: '先用石头围一个圈' };
  const P = flat(S), b = bbox(S);
  if (b.w < 0.12 || b.h < 0.03) return { ok: false, msg: '石圈太小了，画大一点' };
  const rx = b.w / 2, ry = b.h / 2, hit = new Array(24).fill(false), R = [];
  for (const p of P) {
    const dx = (p.x - b.cx) / rx, dy = (p.y - b.cy) / ry;
    hit[Math.floor((Math.atan2(dy, dx) + Math.PI) / (2 * Math.PI) * 24) % 24] = true;
    R.push(Math.hypot(dx, dy));
  }
  // 缺口：各笔的端点两两就近接上，最大的那个口子占一圈多少
  const E = S.flatMap((s, i) => [{ p: s[0], i }, { p: s[s.length - 1], i }]), pairs = [];
  for (let i = 0; i < E.length; i++) for (let j = i + 1; j < E.length; j++) pairs.push([i, j, Math.hypot(E[i].p.x - E[j].p.x, E[i].p.y - E[j].p.y)]);
  pairs.sort((a, b) => a[2] - b[2]);
  const used = new Set();
  let gap = 0;
  for (const [i, j, d] of pairs) if (!used.has(i) && !used.has(j)) { used.add(i); used.add(j); gap = Math.max(gap, d); }
  const gapFrac = gap / (S.reduce((s, x) => s + length(x), 0) || 1);
  const around = hit.filter(Boolean).length / 24;
  if (around < 0.75 || gapFrac > 0.22) return { ok: false, msg: '石圈要围成一圈，别只画半边' };
  const cover = clamp(1 - gapFrac * 4, 0, 1);
  const even = clamp(1 - sdev(R) / (avg(R) || 1) * 3, 0, 1);
  return { ok: true, msg: cover > 0.9 ? '石圈围严了' : '石圈有缺口：漏风费柴', v: { cx: b.cx, cy: b.cy, w: b.w, h: b.h, x0: b.x0, x1: b.x1, top: b.y0, bottom: b.y1, cover, even } };
}
// 柴：几根架在石圈上，交叉着或顶上碰头，堆得高抽风好
function fitWood(S, parts) {
  const g = parts.ring.v;
  const sticks = S.filter(s => length(s) > 0.05).filter(s => {
    const m = s[s.length >> 1];
    return m.x > g.x0 - 0.04 && m.x < g.x1 + 0.04 && m.y < g.bottom + 0.04 && m.y > g.top - 0.3;
  });
  if (!sticks.length) return { ok: false, msg: '在石圈里架几根柴' };
  const tips = s => [s[0], s[s.length - 1]];
  let cross = 0;
  for (let i = 0; i < sticks.length; i++) for (let j = i + 1; j < sticks.length; j++) {
    const A = sticks[i], B = sticks[j];
    const touch = tips(A).some(a => tips(B).some(c => Math.hypot(a.x - c.x, a.y - c.y) < 0.04));
    if (touch || crossings(A, B).length) cross++;
  }
  const b = bbox(sticks), n = Math.min(4, sticks.length);
  const tall = clamp((g.cy - b.y0) / 0.25, 0, 1);
  return { ok: true, msg: n >= 3 && cross >= 2 ? '柴架起来了，烧得旺' : n < 3 ? '柴少了，火不旺' : '柴没交叉，烧不透', v: { n, cross: Math.min(3, cross), tall, top: b.y0 } };
}
// 棚顶（可跳过）：火上方罩个顶
function fitCover(S, parts) {
  const g = parts.ring.v, w = parts.wood.v;
  S = S.filter(s => length(s) > 0.05);
  if (!S.length) return { ok: true, msg: '露天：下雨费柴，大雨会浇灭', v: { roof: 0 } };
  const b = bbox(S);
  if (b.y1 > w.top + 0.04) return { ok: false, msg: '棚顶要画在柴堆上方' };
  const cover = overlap(b.x0, b.x1, g.x0, g.x1) / g.w;
  if (cover < 0.4) return { ok: false, msg: '棚顶要罩住火塘' };
  return { ok: true, msg: cover > 0.8 ? '棚顶罩住了火塘' : '棚顶小了点', v: { roof: clamp(cover / 0.8, 0, 1) } };
}
function hearthParams(P) {
  const g = P.ring.v, w = P.wood?.v || { n: 0, cross: 0, tall: 0 }, c = P.cover?.v || { roof: 0 };
  const q = {
    heat: 0.5 * clamp(w.n / 3, 0, 1) + 0.3 * clamp(w.cross / 2, 0, 1) + 0.2 * w.tall,
    size: clamp((g.w - 0.15) / 0.35, 0, 1),
    seal: g.cover * (0.5 + 0.5 * g.even),
    roof: c.roof,
  };
  return {
    heat: Math.round(14 + 10 * q.heat), radius: Math.round(70 + 70 * q.size),
    burnMul: +clamp(1.05 - 0.45 * q.seal + 0.15 * q.size, 0.5, 1.2).toFixed(2),
    roof: q.roof >= 0.5, cook: 1,
    need: { stone: clamp(Math.round(g.w / 0.05), 4, 10), wood: 1 + w.n },
    q,
  };
}
function hearthStats(P) {
  const p = hearthParams(P), q = p.q, save = Math.round((1 - p.burnMul) * 100);
  return [
    { k: '火力', v: `${p.heat}°`, x: bar(q.heat), why: '柴多、交叉着架、堆得高，烧得旺（营火是 18°）' },
    { k: '暖到', v: `${p.radius} 步`, x: clamp(p.radius / 140, 0.2, 1), why: '石圈越大暖得越远，也越费柴（营火是 90 步）' },
    { k: '省柴', v: save >= 0 ? `${save}%` : `多费 ${-save}%`, x: bar(q.seal), why: '石圈围严、围圆，风吹不进' },
    { k: '挡雨', v: p.roof ? '有棚' : '露天', x: bar(q.roof), why: '有棚顶：下雨不多费柴，也不会被浇灭' },
    { k: '用料', v: `石 ${p.need.stone} · 木 ${p.need.wood}`, x: null, why: '石圈越大越费石头' },
  ];
}

// ---------------- 晾肉架（第一代） ----------------
function fitPosts(S) {
  const cols = columns(S, 20, 0.1).sort((a, b) => b.b.h - a.b.h).slice(0, 2).sort((a, b) => a.cx - b.cx);
  if (cols.length < 2) return { ok: false, msg: '画两根竖着的立柱' };
  const [A, B] = cols, span = B.cx - A.cx;
  if (span < 0.12) return { ok: false, msg: '两根立柱离远一点' };
  const level = Math.abs(A.b.y1 - B.b.y1);
  const st = g => avg(g.lines.map(straightness)), ln = g => avg(g.lines.map(lean));
  return {
    ok: true, msg: level < 0.05 ? '立柱站稳了' : '两根柱子一高一低',
    v: { x0: A.cx, x1: B.cx, span, h: (A.b.h + B.b.h) / 2, top: Math.min(A.b.y0, B.b.y0), bottom: Math.max(A.b.y1, B.b.y1), lean: (ln(A) + ln(B)) / 2, straight: (st(A) + st(B)) / 2, level },
  };
}
function fitBar(S, parts) {
  const p = parts.posts.v;
  const s = longest(S.filter(x => length(x) > 0.08), 1)[0];
  if (!s) return { ok: false, msg: '在两根立柱顶上横搭一根杆子' };
  if (tilt(s) > 15) return { ok: false, msg: '横杆要横着' };
  const b = bbox([s]);
  if (b.cy > p.top + p.h * 0.4 || b.cy < p.top - 0.08) return { ok: false, msg: '横杆要架在立柱顶上' };
  const cover = overlap(b.x0, b.x1, p.x0, p.x1) / p.span;
  if (cover < 0.6) return { ok: false, msg: '横杆要两头都搭在柱子上' };
  return { ok: true, msg: cover > 0.97 ? '横杆搭稳了' : '横杆短了，一头悬着', v: { cover: clamp(cover, 0, 1), y: b.cy, rest: Math.abs(b.cy - p.top) } };
}
function fitStrips(S, parts) {
  const p = parts.posts.v, br = parts.bar.v;
  const n = S.filter(s => length(s) > 0.025 && length(s) < 0.3).filter(s => {
    const b = bbox([s]);
    return b.cx > p.x0 && b.cx < p.x1 && Math.abs(b.y0 - br.y) < 0.06;
  }).length;
  return { ok: true, msg: n ? `挂上了 ${n} 条肉` : '没挂肉：空架子也行', v: { n } };
}
function rackParams(P) {
  const p = P.posts.v, b = P.bar?.v, st = P.strips?.v || { n: 0 };
  const q = {
    span: clamp((p.span - 0.12) / 0.4, 0, 1),
    high: clamp((p.h - 0.15) / 0.3, 0, 1),
    sturdy: p.straight * clamp(1 - p.lean / 20, 0, 1) * (b ? b.cover * clamp(1 - b.rest / 0.1, 0.3, 1) : 0.4) * clamp(1 - p.level / 0.1, 0.5, 1),
  };
  return {
    cap: clamp(Math.round(10 + 22 * q.span + 2 * Math.min(st.n, 4)), 10, 40),
    dryH: Math.round(30 - 12 * q.high),
    sturdy: +bar(q.sturdy, 0.3).toFixed(2),
    need: { wood: 1 + Math.round((2 * p.h + p.span) / 0.2) },
    q,
  };
}
function rackStats(P) {
  const p = rackParams(P), q = p.q;
  return [
    { k: '容量', v: `${p.cap} 份`, x: clamp(p.cap / 40, 0.2, 1), why: '两根柱子离得越开、挂得越多，一次晾得越多（10–40 份）' },
    { k: '晾干', v: `${Math.round(p.dryH / 2)} 个时辰`, x: bar(q.high), why: '架子越高越通风，干得越快；下雨天晾不干' },
    { k: '稳固', v: '', x: bar(q.sturdy, 0.3), why: '柱子直、立得正、横杆搭在顶上；不稳的架子遇上风雨会塌' },
    { k: '用料', v: `木 ${p.need.wood}`, x: null, why: '架子越大越费木头' },
  ];
}

// ---------------- 篱笆（第一代） ----------------
// 图纸上画一小截篱笆的样子；修在哪儿，回到地图上用铅笔画走向
function fitStakes(S) {
  const cols = columns(S, 25, 0.06);
  if (cols.length < 3) return { ok: false, msg: '画一排竖着的木桩（至少三根）' };
  const h = avg(cols.map(g => g.b.h));
  if (h < 0.08) return { ok: false, msg: '木桩太矮了' };
  const gaps = cols.slice(1).map((g, i) => g.cx - cols[i].cx), mg = avg(gaps);
  const even = clamp(1 - sdev(gaps) / mg * 2, 0, 1), level = clamp(1 - sdev(cols.map(g => g.b.y1)) / 0.04, 0, 1);
  return {
    ok: true, msg: even > 0.6 ? `${cols.length} 根桩排得匀` : '桩子疏密不匀',
    v: { n: cols.length, h, gap: mg, even, level, x0: cols[0].cx, x1: cols.at(-1).cx, tops: cols.map(g => ({ x: g.cx, y: g.b.y0 })), cols: cols.map(g => g.lines) },
  };
}
function fitRails(S, parts) {
  const k = parts.stakes.v, need = Math.max(2, Math.ceil(k.n * 0.6));
  const rails = S.filter(s => length(s) > 0.1 && tilt(s) < 20).filter(s => k.cols.filter(c => c.some(L => crossings(s, L).length)).length >= need);
  if (!rails.length) return { ok: false, msg: '横着画一两道横档，把木桩连起来' };
  return { ok: true, msg: rails.length >= 2 ? `${rails.length} 道横档，钉牢了` : '只一道横档，不太牢', v: { n: Math.min(3, rails.length) } };
}
function fitTips(S, parts) {
  const k = parts.stakes.v;
  const T = S.filter(s => length(s) > 0.015).map(s => bbox([s]));
  const n = k.tops.filter(t => T.some(b => Math.abs(b.cx - t.x) < 0.04 && Math.abs(b.cy - t.y) < 0.05)).length;
  return { ok: true, msg: n ? `削尖了 ${n} 根` : '桩头没削尖', v: { sharp: n / k.n } };
}
const HEIGHT_WORD = h => (h < 0.45 ? '齐膝' : h < 0.6 ? '齐腰' : h < 0.8 ? '齐胸' : '过头');
function fenceParams(P) {
  const k = P.stakes.v, r = P.rails?.v || { n: 0 }, t = P.tips?.v || { sharp: 0 };
  const dens = clamp(0.12 / k.gap, 0.4, 1.6);
  const q = {
    high: clamp((k.h - 0.1) / 0.3, 0, 1),
    strong: clamp(0.4 * clamp(r.n / 2, 0, 1) + 0.3 * k.even * Math.min(1, dens) + 0.15 * k.level + 0.15 * t.sharp, 0, 1),
    sharp: t.sharp,
  };
  return {
    height: +clamp(0.3 + 0.7 * q.high, 0.3, 1).toFixed(2),
    hp: Math.round(80 + 160 * q.strong),
    sharp: +t.sharp.toFixed(2),
    woodPer40: +clamp(0.8 + 1.4 * dens * (0.6 + 0.4 * q.high) + 0.3 * r.n, 1, 4).toFixed(1),
    workPer40: +clamp(0.5 + 0.4 * dens + 0.15 * r.n, 0.5, 1.6).toFixed(2),
    q,
  };
}
function fenceStats(P) {
  const p = fenceParams(P), q = p.q;
  return [
    { k: '高度', v: HEIGHT_WORD(p.height), x: bar(q.high), why: '木桩越高越难翻；齐胸以上虎也跳不过' },
    { k: '结实', v: `${p.hp}`, x: bar(q.strong), why: '横档多、桩排得匀、桩脚齐、削了尖，撞不开（80–240）' },
    { k: '削尖', v: p.sharp > 0 ? `${Math.round(p.sharp * 100)}%` : '没削', x: bar(q.sharp), why: '削尖的桩，野兽撞上去会掉头' },
    { k: '用料', v: `每段木 ${p.woodPer40}`, x: null, why: `桩越密越高越费木头；每段约 ${p.workPer40} 个钟头的活` },
  ];
}

// ---------------- 发射台（第八代） ----------------

function fitRocket(S) {
  S = S.filter(s => length(s) > 0.02);
  if (!S.length) return { ok: false, msg: '画直立的箭塔：两条竖边，顶上收尖' };
  const P = flat(S), b = bbox(S), axis = pca(P);
  const vert = Math.abs(90 - Math.abs(deg(axis.angle)));
  if (b.h < 0.15 || b.h / (b.w || 1e-6) < 2) return { ok: false, msg: '箭塔要又高又细' };
  if (vert > 20) return { ok: false, msg: '箭塔要立直' };
  // 鼻锥：顶部 15% 的宽度比身子窄多少
  const topBand = P.filter(p => p.y < b.y0 + b.h * 0.15), midBand = P.filter(p => p.y > b.y0 + b.h * 0.4 && p.y < b.y0 + b.h * 0.8);
  const wOf = A => (A.length ? Math.max(...A.map(p => p.x)) - Math.min(...A.map(p => p.x)) : 0);
  const nose = 1 - wOf(topBand) / (wOf(midBand) || b.w);
  return { ok: true, msg: nose > 0.35 ? '箭塔立住了，顶上收了尖' : '顶上没收尖，风阻大', v: { h: b.h, w: b.w, vert, nose, x0: b.x0, x1: b.x1, bottom: b.y1, top: b.y0 } };
}

function fitTower(S, parts) {
  const r = parts.rocket.v;
  S = S.filter(s => length(s) > 0.02);
  const verts = longest(S.filter(s => length(s) > 0.1 && lean(s) < 15), 2);
  if (verts.length < 2) return { ok: false, msg: '勤务塔要两条竖线' };
  const bx = bbox(verts);
  if (overlap(bx.x0, bx.x1, r.x0, r.x1) > 0.3 * (bx.x1 - bx.x0)) return { ok: false, msg: '勤务塔画在箭塔旁边，别叠在一起' };
  const bars = S.filter(s => !verts.includes(s)).filter(s => { const b = bbox([s]); return overlap(b.x0, b.x1, bx.x0, bx.x1) > 0.6 * bx.w; }).length;
  const gapX = Math.max(0, Math.max(bx.x0 - r.x1, r.x0 - bx.x1));
  return { ok: true, msg: bars >= 2 ? `塔身 ${bars} 道横撑` : '横撑太少，塔会晃', v: { h: bx.h, ratio: bx.h / r.h, bars, gapX, x0: bx.x0, x1: bx.x1, bottom: bx.y1, lean: (lean(verts[0]) + lean(verts[1])) / 2 } };
}

function fitDeck(S, parts) {
  const r = parts.rocket.v, t = parts.tower.v;
  const s = longest(S.filter(x => length(x) > 0.05), 1)[0];
  if (!s) return { ok: false, msg: '在底部画一条横向平台' };
  const b = bbox([s]);
  if (tilt(s) > 12) return { ok: false, msg: '平台要水平' };
  const baseY = Math.max(r.bottom, t.bottom);
  if (b.cy < baseY - 0.05 || b.cy > baseY + 0.09) return { ok: false, msg: '平台要托在两座塔的脚下' };
  const x0 = Math.min(r.x0, t.x0), x1 = Math.max(r.x1, t.x1);
  const cover = overlap(b.x0, b.x1, x0, x1) / (x1 - x0);
  return { ok: true, msg: cover > 0.95 ? '平台托住了两座塔' : '平台没托全', v: { cover, flat: 1 - tilt(s) / 12, straight: straightness(s), off: Math.abs(b.cy - baseY) } };
}

function padStats(P) {
  const r = P.rocket.v, t = P.tower?.v, d = P.deck?.v;
  const bar = (x, lo = 0.35) => clamp(lo + (1 - lo) * x, lo, 1);
  const payload = clamp(Math.round(r.h / 0.45 * 20), 6, 30);
  return [
    { k: '载荷', v: `${payload} 吨`, x: clamp(r.h / 0.5, 0.2, 1), why: '箭塔画得越高，装得越多（6–30 吨）' },
    { k: '稳定', v: `偏 ${r.vert.toFixed(1)}°`, x: bar(clamp(1 - r.vert / 15, 0, 1) * (d ? clamp(d.cover, 0, 1) : 0.5) * (0.6 + 0.4 * clamp(r.nose / 0.6, 0, 1))), why: '立得直、顶上收尖、平台托全' },
    { k: '加注', v: t ? `塔高 ${Math.round(t.ratio * 100)}%` : '—', x: t ? bar(clamp((t.ratio - 0.5) / 0.4, 0, 1)) : 0.35, why: '勤务塔够得着箭塔顶部（≥ 90%）才能加满' },
    { k: '承重', v: d ? `平台 ${Math.round(d.cover * 100)}%` : '—', x: d ? bar(d.flat * d.straight * clamp(d.cover, 0, 1) * (t ? clamp(t.bars / 3, 0.4, 1) : 0.4)) : 0.35, why: '平台平直托全，塔有横撑' },
  ];
}

// 提示淡影（图纸坐标）
const GHOST = {
  frame: [line(0.3, 0.6, 0.515, 0.165), line(0.7, 0.6, 0.485, 0.165)],
  ground: [line(0.24, 0.605, 0.76, 0.605)],
  door: [curve([[0.45, 0.6], [0.455, 0.5], [0.5, 0.46], [0.545, 0.5], [0.55, 0.6]])],
  thatch: [line(0.37, 0.36, 0.43, 0.42), line(0.42, 0.27, 0.48, 0.33), line(0.63, 0.36, 0.57, 0.42), line(0.58, 0.27, 0.52, 0.33)],
  rocket: [poly([[0.37, 0.62], [0.37, 0.24], [0.4, 0.1], [0.43, 0.24], [0.43, 0.62]])],
  tower: [line(0.52, 0.62, 0.52, 0.18), line(0.58, 0.62, 0.58, 0.18), line(0.52, 0.28, 0.58, 0.28), line(0.52, 0.4, 0.58, 0.4), line(0.52, 0.52, 0.58, 0.52)],
  deck: [line(0.28, 0.635, 0.68, 0.635)],
  ring: [arc(0.5, 0.53, 0.2, 0.075, 0, Math.PI * 2)],
  wood: [line(0.38, 0.55, 0.56, 0.34), line(0.62, 0.55, 0.44, 0.34), line(0.5, 0.57, 0.5, 0.31)],
  cover: [poly([[0.28, 0.27], [0.5, 0.14], [0.72, 0.27]])],
  posts: [line(0.32, 0.62, 0.32, 0.2), line(0.68, 0.62, 0.68, 0.2)],
  bar: [line(0.27, 0.22, 0.73, 0.22)],
  strips: [0.4, 0.47, 0.54, 0.61].map((x, i) => curve([[x, 0.235], [x + 0.012, 0.3], [x - 0.006, 0.36 + 0.02 * (i % 2)]])),
  stakes: [0.26, 0.38, 0.5, 0.62, 0.74].map(x => line(x, 0.6, x, 0.25)),
  rails: [line(0.2, 0.34, 0.8, 0.34), line(0.2, 0.5, 0.8, 0.5)],
  tips: [0.26, 0.38, 0.5, 0.62, 0.74].map(x => poly([[x - 0.022, 0.27], [x, 0.215], [x + 0.022, 0.27]])),
};

export const BLUEPRINTS = {
  shack: {
    id: 'shack', name: '窝棚', era: '第一代', cost: '木、草', place: 'point', blurb: '住人：挡风挡雨，夜里暖和，有了家才肯生养',
    steps: [
      { id: 'frame', prompt: '先画两根斜木，在顶上交成「人」字', fit: fitFrame, ghost: GHOST.frame },
      { id: 'ground', prompt: '在斜木脚下画一道地面', fit: fitGround, ghost: GHOST.ground },
      { id: 'door', prompt: '在中间开一扇门', fit: fitDoor, ghost: GHOST.door },
      { id: 'thatch', prompt: '在斜木上铺几道草（可跳过）', fit: fitThatch, ghost: GHOST.thatch, optional: true },
    ],
    stats: shackStats, params: shackParams,
  },
  hearth: {
    id: 'hearth', name: '火塘', era: '第一代', cost: '石、木', place: 'point', blurb: '把营火围起来：更暖、更省柴，有棚顶不怕雨',
    steps: [
      { id: 'ring', prompt: '先用石头围一个圈', fit: fitRing, ghost: GHOST.ring },
      { id: 'wood', prompt: '在圈里架几根柴，交叉着架', fit: fitWood, ghost: GHOST.wood },
      { id: 'cover', prompt: '在火上方罩个棚顶（可跳过）', fit: fitCover, ghost: GHOST.cover, optional: true },
    ],
    stats: hearthStats, params: hearthParams,
  },
  rack: {
    id: 'rack', name: '晾肉架', era: '第一代', cost: '木', place: 'point', blurb: '鲜肉鲜鱼两三天就坏，晾成干肉能放一个多月：过冬靠它',
    steps: [
      { id: 'posts', prompt: '先画两根竖着的立柱', fit: fitPosts, ghost: GHOST.posts },
      { id: 'bar', prompt: '在柱子顶上横搭一根杆子', fit: fitBar, ghost: GHOST.bar },
      { id: 'strips', prompt: '在横杆下挂几条肉（可跳过）', fit: fitStrips, ghost: GHOST.strips, optional: true },
    ],
    stats: rackStats, params: rackParams,
  },
  fence: {
    id: 'fence', name: '篱笆', era: '第一代', cost: '木', place: 'line', blurb: '挡野兽：画好样子，再回地图上用铅笔画出走向',
    steps: [
      { id: 'stakes', prompt: '先画一排竖着的木桩（至少三根）', fit: fitStakes, ghost: GHOST.stakes },
      { id: 'rails', prompt: '横着画一两道横档，把木桩连起来', fit: fitRails, ghost: GHOST.rails },
      { id: 'tips', prompt: '把桩头削尖（可跳过）', fit: fitTips, ghost: GHOST.tips, optional: true },
    ],
    stats: fenceStats, params: fenceParams,
  },
  pad: {
    id: 'pad', name: '发射台', era: '第八代', cost: '木、石、墨', place: 'point', demo: true, blurb: '远期样张：看图纸怎么随时代变复杂',
    steps: [
      { id: 'rocket', prompt: '先画直立的箭塔：两条竖边，顶上收尖', fit: fitRocket, ghost: GHOST.rocket },
      { id: 'tower', prompt: '在旁边画勤务塔：两条竖线，加几道横撑', fit: fitTower, ghost: GHOST.tower },
      { id: 'deck', prompt: '最后在底部画一条横向平台，托住两座塔', fit: fitDeck, ghost: GHOST.deck },
    ],
    stats: padStats,
  },
};

// 一张图纸的进度：按步骤喂笔画，量这一步；ok 才进下一步
export class BlueprintSession {
  constructor(id) {
    this.bp = BLUEPRINTS[id];
    this.i = 0;
    this.parts = {};
    this.strokes = {};
    this.last = null;
  }
  get step() { return this.bp.steps[this.i] || null; }
  get done() { return this.i >= this.bp.steps.length; }
  // 这一步的笔画（可多笔）。返回量的结果；ok 就记下并进下一步
  submit(strokes) {
    const st = this.step;
    if (!st) return null;
    const res = st.fit(strokes, this.parts);
    this.last = res;
    if (res.ok) { this.parts[st.id] = res; this.strokes[st.id] = strokes; this.i++; }
    return res;
  }
  skip() {
    const st = this.step;
    if (st?.optional) { this.parts[st.id] = st.fit([], this.parts); this.strokes[st.id] = []; this.i++; }
  }
  stats() { return this.parts[this.bp.steps[0].id] ? this.bp.stats(this.parts) : []; }
  // 交给模拟的数值（不带 q 这些中间量）
  params() {
    if (!this.bp.params || !this.parts[this.bp.steps[0].id]) return null;
    const { q, pitch, ...p } = this.bp.params(this.parts);
    return p;
  }
}
