// 建造：工地（要料、要工时）→ 建成后的房子、火塘、晾肉架、篱笆、井、石墙、树苗、营旗、篝火；还有路。
import { K, BUILD, DAY } from './config.js';
import { dist, log, reveal, addFood, FOOD } from './util.js';
import { addBarrier } from './beasts.js';
import { roadKey } from './people.js';

const RANK = { fire: 0, hearth: 0, shack: 1, rack: 2, well: 3, outpost: 3, cairn: 4, fenceSeg: 5, sapling: 6 };

export function addFire(sim, x, y, o = {}) {
  const n = sim.nextId++;
  const f = { id: `x${n}`, n, x, y, lit: true, fuel: 8, heat: K.fire.heat, radius: K.fire.radius, burnMul: 1, roof: false, kind: 'camp', name: '营火', cook: 0, outSince: 0, ...o };
  sim.fires.push(f); sim.idx[f.id] = f;
  return f;
}
export function removeFire(sim, f) { sim.fires = sim.fires.filter(x => x !== f); delete sim.idx[f.id]; }

export function addSite(sim, type, params = {}, x, y, extra = {}) {
  const n = sim.nextId++, B = BUILD[type];
  const s = {
    id: `s${n}`, n, type, name: B.name, x, y, params, need: { ...(params.need || B.need || {}) }, have: {}, progress: 0,
    work: params.work ?? B.work, built: false, queue: n, rank: (RANK[type] ?? 5) * 1e6 + n, created: sim.t, waiting: null, ...extra,
  };
  sim.sites.push(s); sim.idx[s.id] = s; sim.dirty.buildings = true;
  return s;
}
export function removeSite(sim, s) {
  sim.sites = sim.sites.filter(x => x !== s); delete sim.idx[s.id];
  for (const [k, n] of Object.entries(s.have)) sim.stock[k] = (sim.stock[k] || 0) + n; // 料退回去
  sim.dirty.buildings = true;
}

function addBuilding(sim, s, extra) {
  const b = { id: s.id, n: s.n, type: s.type, name: s.name, x: s.x, y: s.y, built: true, strokes: s.strokes || null, t: sim.t, ...extra };
  sim.buildings.push(b); sim.idx[b.id] = b;
  return b;
}

export function completeSite(sim, s, by) {
  s.built = true;
  sim.sites = sim.sites.filter(x => x !== s);
  sim.dirty.buildings = true;
  const who = by ? `${by.name}他们` : '族人';
  const P = s.params || {};
  sim.stats.built[s.type] = (sim.stats.built[s.type] || 0) + 1;
  switch (s.type) {
    case 'shack':
      addBuilding(sim, s, { cap: P.cap, warmth: P.warmth, rainproof: P.rainproof, sturdy: P.sturdy });
      log(sim, `${who}照神的图纸搭起一座窝棚，能住 ${P.cap} 人`, 'build');
      sim.assignBeds();
      break;
    case 'hearth': {
      addBuilding(sim, s, { heat: P.heat, radius: P.radius });
      const old = sim.fires.find(f => f.kind === 'camp' && dist(f, s) < sim.camp.r + 60);
      addFire(sim, s.x, s.y, { kind: 'hearth', name: '火塘', heat: P.heat, radius: P.radius, burnMul: P.burnMul, roof: P.roof, cook: P.cook, lit: old ? old.lit : true, fuel: old ? Math.max(old.fuel, 4) : 6, building: s.id });
      if (old) removeFire(sim, old);
      log(sim, `${who}照图垒好了火塘，营火挪进了火塘里（暖 ${P.heat}°，省柴 ${Math.round((1 - P.burnMul) * 100)}%）`, 'build');
      break;
    }
    case 'rack':
      addBuilding(sim, s, { cap: P.cap, dryH: P.dryH, sturdy: P.sturdy, load: [] });
      log(sim, `${who}立起晾肉架：一次晾 ${P.cap} 份肉，约 ${Math.round(P.dryH / 2)} 个时辰晾干`, 'build');
      break;
    case 'fenceSeg': {
      s.seg.built = true; s.seg.broken = false;
      addBarrier(sim, { kind: 'fence', pts: [s.seg.a, s.seg.b], hp: P.hp, height: P.height, sharp: P.sharp || 0, seg: s.seg, fence: s.fence });
      const fence = sim.idx[s.fence];
      if (fence && !fence.done && fence.segs.every(g => g.built)) { fence.done = true; log(sim, `篱笆合拢了：${fence.segs.length} 段，每段承受 ${P.hp}`, 'build'); }
      sim.dirty.barriers = true;
      break;
    }
    case 'well':
      addBuilding(sim, s, {});
      log(sim, `${who}挖出一口井`, 'build');
      break;
    case 'cairn':
      addBuilding(sim, s, { wall: s.wall });
      addBarrier(sim, { kind: 'wall', pts: s.wall, hp: 260, site: s.id });
      sim.dirty.barriers = true;
      log(sim, `${who}垒起一道石墙`, 'build');
      break;
    case 'sapling': {
      const g = s.grove;
      for (const t of g.trees) { t.regrow = sim.t + 14 * DAY; }
      sim.map.forests.push(g); sim.idx[g.id] = g;
      for (const t of g.trees) sim.idx[t.id] = t;
      sim.dirty.trees = true;
      log(sim, `${who}栽下一片树苗，半年后成林`, 'build');
      break;
    }
    case 'outpost':
      addBuilding(sim, s, {});
      reveal(sim, s.x, s.y, 240);
      log(sim, `${who}立起营旗，打的东西可以就近放下`, 'build');
      break;
    case 'fire':
      addFire(sim, s.x, s.y, { kind: 'field', name: '篝火', fuel: 9 });
      log(sim, `${who}在野地里生起一堆篝火`, 'build');
      break;
  }
}

// 篱笆：按图纸量出的数值，沿铅笔画的走向每 40 一段开工
export function placeFence(sim, params, pts, strokes) {
  const segs = [];
  let acc = 0, a = pts[0];
  for (let i = 1; i < pts.length; i++) {
    let p0 = pts[i - 1];
    const p1 = pts[i];
    let L = dist(p0, p1);
    while (acc + L >= 40) {
      const k = (40 - acc) / L, q = { x: p0.x + (p1.x - p0.x) * k, y: p0.y + (p1.y - p0.y) * k };
      segs.push({ a, b: q, built: false });
      a = q; p0 = q; L = dist(p0, p1); acc = 0;
    }
    acc += L;
  }
  if (acc > 12) segs.push({ a, b: pts[pts.length - 1], built: false });
  const n = sim.nextId++;
  const fence = { id: `F${n}`, n, segs, params, pts, strokes, done: false, t: sim.t };
  sim.fences.push(fence); sim.idx[fence.id] = fence;
  for (const seg of segs) {
    const len = dist(seg.a, seg.b) / 40;
    addSite(sim, 'fenceSeg', { need: { wood: Math.max(1, Math.round(params.woodPer40 * len)) }, work: params.workPer40 * len, hp: params.hp, height: params.height, sharp: params.sharp || 0 },
      (seg.a.x + seg.b.x) / 2, (seg.a.y + seg.b.y) / 2, { fence: fence.id, seg });
  }
  return fence;
}
// 撞破的一段：再开一个工地
export function repairFence(sim, w) {
  const fence = sim.idx[w.fence];
  if (!fence) return;
  w.seg.built = false; w.seg.broken = true;
  const P = fence.params;
  addSite(sim, 'fenceSeg', { need: { wood: Math.max(1, Math.round(P.woodPer40 * 0.6)) }, work: P.workPer40 * 0.6, hp: P.hp, height: P.height, sharp: P.sharp || 0 },
    (w.seg.a.x + w.seg.b.x) / 2, (w.seg.a.y + w.seg.b.y) / 2, { fence: fence.id, seg: w.seg, repair: true });
}

// 路：每 60 一段，一段约一个时辰
export function addRoad(sim, pts) {
  const segs = [];
  let a = pts[0], acc = 0;
  for (let i = 1; i < pts.length; i++) {
    acc += dist(pts[i - 1], pts[i]);
    if (acc >= 60 || i === pts.length - 1) {
      const b = pts[i];
      segs.push({ a, b, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, need: Math.max(0.4, acc / 60), work: 0, built: false });
      a = b; acc = 0;
    }
  }
  const n = sim.nextId++;
  const road = { id: `R${n}`, n, pts, segs, t: sim.t };
  sim.roads.push(road); sim.idx[road.id] = road;
  return road;
}
export function markRoad(sim, seg) {
  const L = dist(seg.a, seg.b), k = Math.max(1, Math.ceil(L / 8));
  for (let i = 0; i <= k; i++) {
    const x = seg.a.x + (seg.b.x - seg.a.x) * i / k, y = seg.a.y + (seg.b.y - seg.a.y) * i / k;
    for (const [ox, oy] of [[0, 0], [12, 0], [-12, 0], [0, 12], [0, -12]]) sim.roadCells.add(roadKey(x + ox, y + oy));
  }
  sim.dirty.roads = true;
}

// 每小时：晾肉架收鲜肉、晾干
export function racksHourly(sim) {
  for (const r of sim.buildings) {
    if (r.type !== 'rack') continue;
    let free = r.cap - r.load.reduce((s, x) => s + x.n, 0);
    if (free >= 1) {
      for (const b of [...sim.stock.food]) {
        if (free < 1) break;
        if (b.kind !== 'meat' && b.kind !== 'fish') continue;
        const n = Math.min(b.n, free);
        b.n -= n; free -= n;
        r.load.push({ kind: b.kind, n, h: 0 });
        if (b.n <= 0.001) sim.stock.food.splice(sim.stock.food.indexOf(b), 1);
      }
    }
    if (sim.weather.wet) {
      const load = r.load.reduce((s, x) => s + x.n, 0);
      if (load >= 2 && sim.rng() < Math.max(0, 0.55 - (r.sturdy ?? 1)) * 0.08) {
        let lost = 0;
        for (const it of r.load) { const k = Math.ceil(it.n * 0.5); it.n -= k; lost += k; }
        r.load = r.load.filter(it => it.n > 0);
        sim.stats.rackLost = (sim.stats.rackLost || 0) + lost;
        log(sim, `风雨把晾肉架刮歪了，掉进泥里 ${lost} 份肉`, 'waste');
      }
      continue;
    }
    for (const it of [...r.load]) {
      it.h += 1;
      if (it.h >= r.dryH) { addFood(sim, 'dried', it.n); sim.stats.dried += it.n; r.load.splice(r.load.indexOf(it), 1); }
    }
  }
}
export const FOOD_KINDS = Object.keys(FOOD);
