// 模拟里到处要用的小工具：距离、日志、迷雾、库存、火。
import { MAP, K, DAY } from './config.js';
import { seasonOf } from './calendar.js';

export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));

// ---------------- 日志 ----------------
// kind：birth 生 / death 死 / god 神迹号令 / build 建造 / danger 险情 / season 时令 / work 劳作 / refuse 不从 / waste 浪费
export function log(sim, text, kind = 'info', extra = {}) {
  const e = { t: sim.t, text, kind, ...extra };
  sim.log.push(e);
  if (sim.log.length > 600) sim.log.splice(0, sim.log.length - 600);
  sim.onLog?.(e);
  return e;
}

// ---------------- 迷雾（白纸） ----------------
export const FOG = { cols: Math.ceil(MAP.w / MAP.cell), rows: Math.ceil(MAP.h / MAP.cell) };
export function reveal(sim, x, y, r) {
  const c = MAP.cell, i0 = Math.max(0, Math.floor((x - r) / c)), i1 = Math.min(FOG.cols - 1, Math.floor((x + r) / c));
  const j0 = Math.max(0, Math.floor((y - r) / c)), j1 = Math.min(FOG.rows - 1, Math.floor((y + r) / c));
  let n = 0;
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const k = j * FOG.cols + i;
    if (sim.fog[k]) continue;
    const cx = (i + 0.5) * c, cy = (j + 0.5) * c;
    if ((cx - x) ** 2 + (cy - y) ** 2 <= r * r) { sim.fog[k] = 1; n++; }
  }
  if (n) { sim.revealed += n; sim.dirty.fog = true; }
  return n;
}
export function known(sim, x, y) {
  const i = Math.floor(x / MAP.cell), j = Math.floor(y / MAP.cell);
  if (i < 0 || j < 0 || i >= FOG.cols || j >= FOG.rows) return false;
  return sim.fog[j * FOG.cols + i] === 1;
}

// ---------------- 食物 ----------------
export const FOOD = {
  berry: { name: '浆果', val: 0.34, keep: 4 },
  nut: { name: '坚果', val: 0.42, keep: 20 },
  meat: { name: '鲜肉', val: 0.4, cooked: 0.55, keep: 3 },
  fish: { name: '鱼', val: 0.36, cooked: 0.5, keep: 2 },
  dried: { name: '干肉', val: 0.5, keep: 40 },
};
export function addFood(sim, kind, n) {
  if (n <= 0) return;
  const exp = sim.t + FOOD[kind].keep * DAY;
  const last = sim.stock.food.find(b => b.kind === kind && Math.abs(b.exp - exp) < 240);
  if (last) last.n += n;
  else sim.stock.food.push({ kind, n, exp });
  sim.stats.food[kind] = (sim.stats.food[kind] || 0) + n;
}
export const foodTotal = sim => sim.stock.food.reduce((s, b) => s + b.n, 0) + rackLoad(sim);
export const rackLoad = sim => sim.buildings.reduce((s, b) => s + (b.type === 'rack' ? b.load.reduce((a, x) => a + x.n, 0) : 0), 0);
// 吃一份：先吃最快坏的；库里没了才去架子上取
export function takeFood(sim, cookedOk) {
  let best = null;
  for (const b of sim.stock.food) if (b.n > 0 && (!best || b.exp < best.exp)) best = b;
  let kind;
  if (best) {
    kind = best.kind;
    best.n -= 1;
    if (best.n <= 0.001) sim.stock.food.splice(sim.stock.food.indexOf(best), 1);
  } else {
    const rack = sim.buildings.find(b => b.type === 'rack' && b.load.length);
    if (!rack) return null;
    const it = rack.load[0];
    kind = it.kind;
    it.n -= 1;
    if (it.n <= 0.001) rack.load.shift();
  }
  const F = FOOD[kind];
  sim.stats.eaten += 1;
  return { kind, val: cookedOk && F.cooked ? F.cooked : F.val, cooked: !!(cookedOk && F.cooked) };
}

// ---------------- 火 ----------------
export const litFires = sim => sim.fires.filter(f => f.lit);
export function nearestFire(sim, p, litOnly = true) {
  let best = null, bd = Infinity;
  for (const f of sim.fires) {
    if (litOnly && !f.lit) continue;
    const d = dist(f, p);
    if (d < bd) { bd = d; best = f; }
  }
  return best ? { fire: best, d: bd } : null;
}
// 营地的主火：离营地中心最近的那一堆（灭了的也算）
export function mainFire(sim) {
  let best = null, bd = Infinity;
  for (const f of sim.fires) { const d = dist(f, sim.camp); if (d < bd) { bd = d; best = f; } }
  return best && bd < sim.camp.r + 60 ? best : null;
}
export function fireHeatAt(sim, p) {
  let heat = 0;
  for (const f of sim.fires) {
    if (!f.lit) continue;
    const d = dist(f, p);
    if (d < f.radius) heat = Math.max(heat, f.heat * (1 - 0.5 * d / f.radius));
  }
  return heat;
}
export const burnRate = (sim, f, dark) => (dark ? K.fire.burnNight : K.fire.burnDay) * (seasonOf(sim.t) === 3 ? K.fire.winterMul : 1) * f.burnMul * (sim.weather.wet && !f.roof ? 1.5 : 1);

// 放下东西的地方：营地或最近的营旗
export function dropPoint(sim, p) {
  let best = sim.camp, bd = dist(p, sim.camp);
  for (const b of sim.buildings) if (b.type === 'outpost') { const d = dist(p, b); if (d < bd) { bd = d; best = b; } }
  return best;
}

export const adults = sim => sim.alive.filter(p => p.age >= 14);
export const isAdult = p => p.age >= 14;
export const isElder = p => p.age >= 50;
