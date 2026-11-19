// 神的三支笔落到模拟里：墨笔号令（要墨）、朱笔（线、禁区、✕ 禁、○ 护）、铅笔（探路、修路、迁徙、图纸落地）。
// 每个号令先查办不办得成，办成了才扣墨；能撤回的返回 undo（界面上 3 秒内可撤）。
import { K, ACTIONS, LOCKED, DAY } from './config.js';
import { contextById, symbolById } from '../recog/symbols.js';
import { endurance } from '../recog/redpen.js';
import { length as plen } from '../recog/geom.js';
import { dist, clamp, log, known, reveal } from './util.js';
import { setJob, orderOf } from './people.js';
import { scareBeast, killBeast, addBarrier, removeBarrier, placeName } from './beasts.js';
import { addSite, removeSite, addFire, placeFence, addRoad } from './build.js';
import { RIVER_HALF } from './mapgen.js';

export const verbOf = (ctx, sym) => contextById(ctx).verbs?.[sym] || null;
export const isLocked = (ctx, sym) => !!LOCKED[`${ctx}:${sym}`];
// 这个语境里这一代能写的符（识别时只比这几个）
export const unlockedCands = ctx => Object.keys(contextById(ctx).verbs || {}).filter(s => !isLocked(ctx, s) && ACTIONS[`${ctx}:${s}`]);

// ---------------- 画在什么上面 ----------------
export function targetAt(sim, x, y) {
  if (x < 0 || y < 0 || x > sim.map.w || y > sim.map.h) return { ctx: null, why: '纸外头' };
  if (!known(sim, x, y)) return { ctx: null, why: '那边还是白纸，先派人去探路' };
  const p = { x, y };
  let best = null, bd = 70;
  for (const b of sim.beasts) if (!b.dead && !b.gone && known(sim, b.x, b.y)) { const d = dist(b, p); if (d < bd) { bd = d; best = b; } }
  for (const h of sim.herds) if (h.n > 0 && known(sim, h.x, h.y)) { const d = dist(h, p) - 12; if (d < bd) { bd = d; best = h; } }
  if (best) return { ctx: 'beast', ref: best.id, x: best.x, y: best.y, name: best.kind === 'herd' ? `鹿群（${best.n} 头）` : best.name, kind: best.kind };
  if (dist(p, sim.camp) < sim.camp.r) return { ctx: 'folk', ref: 'camp', x: sim.camp.x, y: sim.camp.y, name: '营地' };
  for (const q of sim.alive) if (dist(q, p) < 24) return { ctx: 'folk', ref: q.id, x: q.x, y: q.y, name: q.name };
  for (const f of sim.map.forests) if (dist(f, p) < f.r + 18 && known(sim, f.x, f.y)) return { ctx: 'wood', ref: f.id, x: f.x, y: f.y, name: f.planted ? '新栽的林子' : '树林' };
  for (const pt of sim.map.patches) if (dist(pt, p) < pt.r + 16) return { ctx: 'wood', ref: pt.id, x: pt.x, y: pt.y, name: '浆果丛', patch: true };
  for (const r of sim.map.rocks) if (dist(r, p) < r.r + 26) return { ctx: 'rock', ref: r.id, x: r.x, y: r.y, name: '石堆' };
  if (sim.map.riverDist(x, y) < RIVER_HALF + 22) return { ctx: 'river', ref: 'river', x, y, name: '河' };
  return { ctx: 'land', ref: null, x, y, name: '空地' };
}

// ---------------- 号令 ----------------
const OBEY = { 勤: 0.1, 懒: -0.05, 勇: 0, 怯: 0.05, 和: 0.05, 倔: -0.18 };
export const obeyOf = (p, rally = false) => clamp(0.55 + 0.45 * p.love + 0.3 * p.fear + (OBEY[p.temper] || 0) - (p.fatigue > 0.85 ? 0.25 : 0) + (rally ? 0.3 : 0), 0.05, 0.98);

export function issueOrder(sim, o) {
  const n = sim.nextId++;
  const ord = { id: `o${n}`, n, members: [], done: false, t: sim.t, until: sim.t + o.hours * 60, ...o };
  const rally = o.job === 'rally' || o.job === 'migrate';
  const ok = p => (rally ? p.age >= 5 : p.age >= 14) && !(p.sick > 0) && p.health > 0.35 && !((o.job === 'hunt' || o.job === 'fight') && p.age >= 50);
  const at = { x: o.x ?? sim.camp.x, y: o.y ?? sim.camp.y };
  const skill = { chop: 'chop', gather: 'gather', quarry: 'quarry', fish: 'fish', hunt: 'hunt', fight: 'hunt', build: 'build', road: 'build' }[o.job];
  const pool = sim.alive.filter(ok).sort((a, b) => score(a) - score(b));
  function score(p) { return dist(p, at) + (orderOf(sim, p) ? 900 : 0) - (skill ? p.skills[skill] * 500 : 0) + (p.asleep ? 300 : 0); }
  const refused = [];
  for (const p of pool) {
    if (ord.members.length >= o.n) break;
    if (sim.rng() < obeyOf(p, rally)) { ord.members.push(p.id); p.order = ord.id; setJob(sim, p, null); }
    else refused.push(p);
  }
  if (refused.length && !rally) {
    const why = p => (p.fatigue > 0.85 ? '累坏了' : p.temper === '倔' ? '嘟囔着不肯去' : '装没看见');
    log(sim, refused.slice(0, 3).map(p => `${p.name}${why(p)}`).join('；'), 'refuse');
    sim.stats.refused += refused.length;
  }
  if (!ord.members.length) return null;
  sim.orders.push(ord);
  return ord;
}
function cancelOrder(sim, ord) {
  sim.orders = sim.orders.filter(o => o !== ord);
  for (const id of ord.members) { const p = sim.idx[id]; if (p && p.order === ord.id) { p.order = null; if (p.alive) setJob(sim, p, null); } }
}

const fail = (msg, extra = {}) => ({ ok: false, msg, ...extra });
const done = (msg, undo = null, extra = {}) => ({ ok: true, msg, undo, ...extra });
function bump(sim, field, d, near = null, r = 0) {
  const prev = sim.alive.map(p => [p, p[field]]);
  for (const p of sim.alive) if (!near || dist(p, near) < r) p[field] = clamp(p[field] + d);
  return () => { for (const [p, v] of prev) p[field] = v; };
}
const orderUndo = (sim, ord) => () => cancelOrder(sim, ord);
function orderDone(sim, o, verb) {
  const ord = issueOrder(sim, o);
  if (!ord) return fail('没人肯去');
  const names = ord.members.map(id => sim.idx[id].name);
  return done(`${names.slice(0, 4).join('、')}${names.length > 4 ? ` 等 ${names.length} 人` : ''}去${verb}`, orderUndo(sim, ord), { order: ord });
}

const H = {
  rain(sim) {
    const w = sim.weather;
    if (w.wet) return fail('已经在下了');
    const prev = { ...w }, wasDrought = w.drought, dry = w.dry;
    startRain(sim, 6 * 60);
    const undoLove = bump(sim, 'love', wasDrought ? 0.08 : 0.01);
    if (wasDrought) sim.stats.droughtRain++;
    return done(wasDrought ? `旱了 ${dry} 天的地终于湿了，族人跪在雨里` : '下雨了', () => { Object.assign(w, prev); undoLove(); });
  },
  bolt(sim, a) {
    if (a.x == null) return fail('点地图上要劈的地方', { needTarget: true });
    if (!known(sim, a.x, a.y)) return fail('那边还是白纸');
    const p = { x: a.x, y: a.y }, hit = [];
    for (const b of sim.beasts) if (!b.dead && !b.gone && dist(b, p) < 80) { killBeast(sim, b, `雷火劈死了${b.name}`); hit.push(b.name); }
    for (const f of sim.map.forests) for (const t of f.trees) if (t.alive && dist(t, p) < 45) { t.alive = false; t.wood = 0; t.burnt = true; t.regrow = sim.t + 40 * DAY; sim.dirty.trees = true; hit.push('树'); }
    for (const q of [...sim.alive]) if (dist(q, p) < 34) { (sim.die)(q, '雷'); hit.push(q.name); }
    for (const h of sim.herds) if (h.n > 0 && dist(h, p) < 200) { h.flee = sim.t + 60; h.fx = h.x + (h.x - p.x); h.fy = h.y + (h.y - p.y); }
    for (const q of sim.alive) { q.fear = clamp(q.fear + (dist(q, p) < 900 ? 0.12 : 0.05)); q.love = clamp(q.love - 0.01); q.morale = clamp(q.morale - 0.04); }
    sim.effects.push({ kind: 'bolt', x: p.x, y: p.y, t: sim.t });
    sim.stats.bolts++;
    return done(hit.length ? `劈中了${[...new Set(hit)].join('、')}` : '劈在空地上，族人吓得趴在地上');
  },
  rally(sim, a) {
    const at = a.ref && a.ref !== 'camp' && sim.idx[a.ref] && sim.idx[a.ref].name && sim.idx[a.ref].alive !== undefined ? sim.idx[a.ref] : a;
    return orderDone(sim, { job: 'rally', x: at.x, y: at.y, n: 99, hours: 2.5, label: '集结' }, '集结');
  },
  light(sim) {
    const prev = sim.buffs.light;
    const u1 = bump(sim, 'love', 0.05), prevFear = sim.alive.map(p => [p, p.fear]);
    sim.buffs.light = sim.t + DAY;
    for (const p of sim.alive) p.fear *= 0.5;
    sim.effects.push({ kind: 'light', x: sim.camp.x, y: sim.camp.y, t: sim.t });
    sim.stats.lights++;
    return done('一天之内：士气 +20%、劳作 +15%、恐惧减半、病好得快', () => { sim.buffs.light = prev; u1(); for (const [p, v] of prevFear) p.fear = v; });
  },
  kindle(sim) {
    let fs = sim.fires.filter(f => dist(f, sim.camp) < sim.camp.r + 80);
    let made = null;
    if (!fs.length) { made = addFire(sim, sim.camp.x, sim.camp.y, { fuel: 0, lit: false }); fs = [made]; }
    const out = fs.filter(f => !f.lit), prev = fs.map(f => [f, f.lit, f.fuel]);
    for (const f of fs) { f.lit = true; f.fuel = Math.min(K.fire.maxFuel, f.fuel + 8); f.outSince = 0; }
    const u = bump(sim, 'love', out.length ? 0.06 : 0.01);
    if (out.length) sim.stats.relit++;
    return done(out.length ? '灭了的火又着了' : '火更旺了（添了 8 个时辰的柴）', () => { for (const [f, l, fu] of prev) { f.lit = l; f.fuel = fu; } u(); });
  },
  train(sim) { return orderDone(sim, { job: 'train', x: sim.camp.x, y: sim.camp.y, n: 4, hours: 4 }, '操练'); },
  order(sim, a, act) {
    const t = a.ref && sim.idx[a.ref];
    switch (act.job) {
      case 'chop':
        if (!t || !t.trees) return fail('这里没有能砍的树');
        if (sim.bans.some(b => b.ref === t.id)) return fail('这片林子下了禁令（✕）');
        if (!t.trees.some(x => x.alive)) return fail('树都砍光了');
        return orderDone(sim, { job: 'chop', ref: t.id, x: t.x, y: t.y, n: 3, hours: 10 }, '砍柴');
      case 'gather': {
        if (act.near) return orderDone(sim, { job: 'gather', x: sim.camp.x, y: sim.camp.y, r: 700, n: 3, hours: 8 }, '采集');
        if (t && t.trees) return orderDone(sim, { job: 'gather', x: t.x, y: t.y, r: t.r + 160, forest: t.id, n: 3, hours: 8 }, '采集');
        const pt = sim.map.patches.find(p => p.id === a.ref);
        if (pt) return orderDone(sim, { job: 'gather', x: pt.x, y: pt.y, r: pt.r + 30, n: 3, hours: 8 }, '采浆果');
        return fail('这里没有能采的');
      }
      case 'quarry':
        if (!t || t.stone === undefined) return fail('这里没有石头');
        if (t.stone < 1) return fail('石头采光了');
        return orderDone(sim, { job: 'quarry', ref: t.id, x: t.x, y: t.y, n: 3, hours: 10 }, '采石');
      case 'fish': return orderDone(sim, { job: 'fish', x: a.x, y: a.y, n: 3, hours: 8 }, '叉鱼');
      case 'water': return orderDone(sim, { job: 'water', x: a.x, y: a.y, n: 2, hours: 4 }, '挑水');
    }
    return fail('这里用不上');
  },
  burn(sim, a) {
    const f = a.ref && sim.idx[a.ref];
    if (!f || !f.trees) return fail('这里没有林子');
    let n = 0;
    for (const t of f.trees) if (t.alive) { t.alive = false; t.wood = 0; t.burnt = true; t.regrow = sim.t + 40 * DAY; n++; }
    f.burnt = sim.t; f.nuts = 0;
    sim.dirty.trees = true;
    sim.later.push({ t: sim.t + 7 * DAY, kind: 'sprout', ref: f.id });
    for (const b of sim.beasts) if (!b.dead && !b.gone && dist(b, f) < 600) scareBeast(sim, b, 2);
    for (const q of sim.alive) { q.fear = clamp(q.fear + 0.08); q.love = clamp(q.love - 0.02); if (dist(q, f) < f.r + 40) setJob(sim, q, null); }
    sim.effects.push({ kind: 'burn', x: f.x, y: f.y, r: f.r, t: sim.t });
    return done(`烧了 ${n} 棵树。七天后灰里会冒出浆果苗`);
  },
  hunt(sim, a) {
    const t = a.ref && sim.idx[a.ref];
    if (!t) return fail('没看见兽');
    if (t.kind === 'herd') {
      if (sim.bans.some(b => b.ref === t.id)) return fail('这群鹿下了禁令（✕）');
      return orderDone(sim, { job: 'hunt', ref: t.id, x: t.x, y: t.y, n: 3, hours: 9 }, '打猎');
    }
    return orderDone(sim, { job: 'fight', ref: t.id, x: t.x, y: t.y, n: 3, hours: 6 }, `打${t.name}`);
  },
  huntAll(sim, a) {
    const t = a.ref && sim.idx[a.ref];
    if (!t) return fail('没看见兽');
    if (t.kind === 'herd') {
      if (sim.bans.some(b => b.ref === t.id)) return fail('这群鹿下了禁令（✕）');
      return orderDone(sim, { job: 'hunt', ref: t.id, x: t.x, y: t.y, n: 6, hours: 9, big: true }, '围猎');
    }
    return orderDone(sim, { job: 'fight', ref: t.id, x: t.x, y: t.y, n: 6, hours: 6 }, `围打${t.name}`);
  },
  scare(sim, a) {
    const t = a.ref && sim.idx[a.ref];
    if (!t) return fail('没看见兽');
    if (t.kind === 'herd') {
      const prev = { hx: t.hx, hy: t.hy, x: t.x, y: t.y };
      const ang = Math.atan2(t.y - sim.camp.y, t.x - sim.camp.x);
      t.hx = clamp(t.hx + Math.cos(ang) * 400, 60, sim.map.w - 60); t.hy = clamp(t.hy + Math.sin(ang) * 400, 60, sim.map.h - 60);
      t.flee = sim.t + 90; t.fx = t.hx; t.fy = t.hy;
      return done('鹿群跑远了', () => Object.assign(t, prev, { flee: 0 }));
    }
    const pack = t.kind === 'wolf' ? sim.beasts.filter(b => b.kind === 'wolf' && !b.dead && !b.gone) : [t];
    const saved = pack.some(b => b.state === 'stalk' && sim.idx[b.target]?.name);
    const prev = pack.map(b => [b, { ...b }]);
    for (const b of pack) scareBeast(sim, b, t.kind === 'wolf' ? 2 : 3);
    const u = bump(sim, 'love', saved ? 0.05 : 0.01);
    if (saved) sim.stats.saves++;
    return done(saved ? `${t.name}正扑向族人，被神火赶跑了` : `${t.name}被赶远了`, () => { for (const [b, s] of prev) Object.assign(b, s); u(); });
  },
  site(sim, a, act) {
    const why = siteCheck(sim, a, act.build);
    if (why) return fail(why);
    const extra = {};
    let params = {};
    if (act.build === 'cairn') {
      const ang = Math.atan2(a.y - sim.camp.y, a.x - sim.camp.x) + Math.PI / 2, L = 55;
      extra.wall = [{ x: a.x - Math.cos(ang) * L, y: a.y - Math.sin(ang) * L }, { x: a.x + Math.cos(ang) * L, y: a.y + Math.sin(ang) * L }];
      if (a.ctx === 'rock') params = { need: {}, work: 2 };
    }
    if (act.build === 'sapling') {
      const n = sim.nextId++, g = { id: `f${n}`, x: a.x, y: a.y, r: 46, trees: [], nuts: 0, burnt: 0, planted: true };
      for (let i = 0; i < 5; i++) {
        const ang = i / 5 * 6.28 + sim.rng.range(-0.3, 0.3), rr = i ? sim.rng.range(18, 34) : 0;
        g.trees.push({ id: `t${sim.nextId++}`, x: a.x + Math.cos(ang) * rr, y: a.y + Math.sin(ang) * rr, wood: K.tree.wood, alive: false, regrow: Infinity, size: sim.rng.range(24, 32), seed: sim.rng.int(1e9), forest: g.id, young: true });
      }
      extra.grove = g;
    }
    const s = addSite(sim, act.build, params, a.x, a.y, extra);
    return done(`${s.name}开工了${Object.keys(s.need).length ? `（要${Object.entries(s.need).map(([k, n]) => `${NAME[k]} ${n}`).join('、')}）` : ''}`, () => removeSite(sim, s), { site: s });
  },
};
const NAME = { wood: '木', stone: '石', grass: '草', hide: '皮' };

function siteCheck(sim, a, type) {
  if (!known(sim, a.x, a.y)) return '那边还是白纸';
  if (a.ctx === 'rock' && type === 'cairn') return null;
  if (sim.map.riverDist(a.x, a.y) < RIVER_HALF + 18) return '离河太近';
  for (const b of [...sim.buildings, ...sim.sites]) if (b.type !== 'fenceSeg' && b.type !== 'cairn' && dist(b, a) < 46) return '和别的房子挤在一起了';
  for (const f of sim.map.forests) if (dist(f, a) < f.r - 8 && type !== 'sapling') return '这里是树林';
  for (const r of sim.map.rocks) if (dist(r, a) < r.r) return '这里是石堆';
  for (const f of sim.fires) if (dist(f, a) < 40) return '离火太近';
  return null;
}
export function startRain(sim, mins) {
  const w = sim.weather;
  w.wet = true; w.kind = sim.now.season === 3 ? 'snow' : 'rain'; w.until = sim.t + mins; w.dry = 0;
  if (w.drought) { w.drought = false; log(sim, '下雨了，旱情解了', 'season'); }
}

// 墨笔号令。a = { ctx, sym, ref, x, y }。返回 { ok, msg, verb, cost, undo }
export function command(sim, a) {
  const v = verbOf(a.ctx, a.sym), key = `${a.ctx}:${a.sym}`, name = symbolById(a.sym)?.name || a.sym;
  if (!v) return fail(`「${name}」在这里用不上`);
  if (LOCKED[key]) return fail(`「${name}·${v.verb}」还没学会（下一代）`, { locked: true });
  const act = ACTIONS[key];
  if (!act) return fail(`「${name}」在这里用不上`);
  if (sim.ink < v.ink) return fail(`墨不够（「${v.verb}」要 ${v.ink} 墨）`, { noInk: true });
  const res = H[act.kind](sim, a, act, v);
  if (!res.ok) { sim.stats.cmdFail++; return { ...res, verb: v.verb }; }
  sim.ink -= v.ink;
  sim.stats.cmds[key] = (sim.stats.cmds[key] || 0) + 1;
  sim.stats.inkSpent += v.ink;
  log(sim, `${name}·${v.verb}（${v.ink} 墨）：${res.msg}`, 'god');
  const undo = res.undo ? () => {
    res.undo();
    sim.ink = Math.min(sim.inkMax, sim.ink + v.ink);
    sim.stats.inkSpent -= v.ink; sim.stats.undone++;
    log(sim, `撤回「${v.verb}」，墨退回`, 'god');
  } : null;
  return { ok: true, msg: res.msg, verb: v.verb, cost: v.ink, undo, key, order: res.order, site: res.site };
}

// ---------------- 朱笔 ----------------
export function redLine(sim, pts, { closed = false } = {}) {
  const len = plen(pts) + (closed ? dist(pts[0], pts[pts.length - 1]) : 0);
  const cost = Math.max(1, Math.ceil(len / 260)) + (closed ? 1 : 0);
  if (sim.ink < cost) return fail(`墨不够（这条线要 ${cost} 墨）`);
  sim.ink -= cost; sim.stats.inkSpent += cost;
  const hp = endurance(len) * (closed ? 1.2 : 1);
  const w = addBarrier(sim, { kind: closed ? 'zone' : 'red', pts: pts.map(p => ({ x: p.x, y: p.y })), closed, hp: Math.round(hp) });
  sim.dirty.barriers = true;
  log(sim, closed ? `朱笔圈出禁区（${cost} 墨，承受 ${w.hp}）` : `朱笔画下封锁线（${cost} 墨，承受 ${w.hp}）`, 'god');
  return done('', () => { removeBarrier(sim, w); sim.ink += cost; sim.stats.inkSpent -= cost; }, { barrier: w, cost });
}
export function redGuard(sim, x, y, r) {
  if (sim.ink < 1) return fail('墨不够');
  sim.ink -= 1; sim.stats.inkSpent += 1;
  const w = addBarrier(sim, { kind: 'guard', x, y, r: clamp(r, 40, 260), hp: 60 });
  sim.dirty.barriers = true;
  log(sim, `朱笔画○：护住这一圈，野兽进不来（承受 60）`, 'god');
  return done('', () => { removeBarrier(sim, w); sim.ink += 1; sim.stats.inkSpent -= 1; }, { barrier: w });
}
export function redBan(sim, t) {
  if (!t || !t.ctx || !['wood', 'rock', 'beast', 'river'].includes(t.ctx) || t.kind === 'tiger' || t.kind === 'wolf') return fail('✕ 要画在林子、浆果丛、石堆或鹿群上');
  if (sim.bans.some(b => b.ref === t.ref)) return fail('这里已经禁了');
  if (sim.ink < 1) return fail('墨不够');
  sim.ink -= 1; sim.stats.inkSpent += 1;
  const ban = { id: `n${sim.nextId++}`, ref: t.ref, ctx: t.ctx, name: t.name, x: t.x, y: t.y, t: sim.t };
  sim.bans.push(ban);
  for (const p of sim.alive) p.love = clamp(p.love - 0.004);
  for (const p of sim.alive) if (p.job && p.job.ref && (p.job.ref === t.ref || sim.idx[p.job.ref]?.forest === t.ref)) setJob(sim, p, null);
  log(sim, `朱笔 ✕：${t.name}禁了`, 'god');
  return done('', () => { sim.bans = sim.bans.filter(b => b !== ban); sim.ink += 1; sim.stats.inkSpent -= 1; }, { ban });
}
export function unseal(sim, id) {
  const w = sim.idx[id];
  if (w && sim.barriers.includes(w)) { removeBarrier(sim, w); sim.dirty.barriers = true; log(sim, '朱笔一刀，启封', 'god'); return true; }
  const ban = sim.bans.find(b => b.id === id);
  if (ban) { sim.bans = sim.bans.filter(b => b !== ban); log(sim, `朱笔一刀：${ban.name}解禁`, 'god'); return true; }
  return false;
}

// ---------------- 铅笔 ----------------
export function scoutRoute(sim, pts) {
  const route = pts.map(p => ({ x: p.x, y: p.y }));
  const ord = issueOrder(sim, { job: 'scout', route, x: route[0].x, y: route[0].y, n: 2, hours: 16 });
  if (!ord) return fail('没人肯去');
  sim.stats.scouts++;
  log(sim, `铅笔画了一条探路的线：${ord.members.map(id => sim.idx[id].name).join('、')}沿着走一趟`, 'god');
  return done('', () => cancelOrder(sim, ord), { order: ord });
}
export function buildRoad(sim, pts) {
  const road = addRoad(sim, pts.map(p => ({ x: p.x, y: p.y })));
  const ord = issueOrder(sim, { job: 'road', ref: road.id, x: pts[0].x, y: pts[0].y, n: 3, hours: 12 });
  log(sim, `铅笔画了一条路：${road.segs.length} 段，修好了走得快`, 'god');
  return done('', () => { if (ord) cancelOrder(sim, ord); sim.roads = sim.roads.filter(r => r !== road); }, { road, order: ord });
}
export function migrate(sim, x, y) {
  if (!known(sim, x, y) || sim.map.riverDist(x, y) < RIVER_HALF + 60) return fail('那里扎不了营');
  const old = { x: sim.camp.x, y: sim.camp.y };
  sim.camp.x = x; sim.camp.y = y;
  const fire = addFire(sim, x, y, { fuel: 6 });
  reveal(sim, x, y, 300);
  const ord = issueOrder(sim, { job: 'migrate', x, y, n: 99, hours: 12 });
  log(sim, '全族迁往新营地，带着火种上路', 'god');
  sim.assignBeds();
  return done('', null, { from: old, fire, order: ord });
}
// 图纸落地：params 来自 blueprint.js 量出的数值
export function placeDesign(sim, type, params, x, y, strokes) {
  const why = siteCheck(sim, { x, y }, type);
  if (why) return fail(why);
  const s = addSite(sim, type, params, x, y, { strokes });
  log(sim, `照图纸${placeName(sim, { x, y })}开工：${s.name}（要${Object.entries(s.need).map(([k, n]) => `${NAME[k]} ${n}`).join('、') || '人手'}）`, 'god');
  return done('', () => removeSite(sim, s), { site: s });
}
export function placeFenceLine(sim, params, pts, strokes) {
  if (pts.length < 2 || plen(pts) < 60) return fail('篱笆太短了');
  if (pts.some(p => !known(sim, p.x, p.y))) return fail('篱笆不能修到白纸上');
  const fence = placeFence(sim, params, pts.map(p => ({ x: p.x, y: p.y })), strokes);
  log(sim, `照图纸修篱笆：${fence.segs.length} 段，每段要木 ${Math.max(1, Math.round(params.woodPer40))}`, 'god');
  return done('', () => { for (const s of sim.sites.filter(s => s.fence === fence.id)) removeSite(sim, s); sim.fences = sim.fences.filter(f => f !== fence); }, { fence });
}
