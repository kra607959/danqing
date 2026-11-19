// 模拟总调度：建世界、每步推进（2 游戏分钟）、每小时（天气、火、晾架、腐坏、草木）、每天（生老病死、时令、野兽）。
// 纯逻辑，不碰画面：浏览器和 Node（tools/sim.mjs、测试）用同一份。
import { K, DAY, STEP, YEAR_DAYS, SEASONS } from './config.js';
import { dayOf, hourOf, seasonOf, isDark, isBedtime, sunset, airTemp, light, yearOf, dayInSeason } from './calendar.js';
import { genMap } from './mapgen.js';
import { makeRng, hashSeed } from '../recog/rng.js';
import { dist, clamp, log, reveal, FOG, FOOD, addFood, foodTotal, mainFire, burnRate, rackLoad } from './util.js';
import { foundTribe, personTick, dailyPeople, die, missing, siteCanProgress } from './people.js';
import { beastsTick, dailyBeasts, makeBeast } from './beasts.js';
import { addFire, completeSite, racksHourly, markRoad, repairFence } from './build.js';
import { startRain } from './commands.js';

export function createSim(seed = 1, opts = {}) {
  const map = genMap(seed);
  const sim = {
    seed, t: 6 * 60, steps: 0, day: 0, rng: makeRng(hashSeed('sim', seed)), nextId: 1, map, idx: {},
    camp: { ...map.camp }, fog: new Uint8Array(FOG.cols * FOG.rows), revealed: 0,
    people: [], alive: [], fires: [], buildings: [], sites: [], fences: [], roads: [], roadCells: new Set(),
    herds: map.herds, beasts: [], barriers: [], bans: [], orders: [], later: [], effects: [],
    stock: { food: [], wood: 14, stone: 0, grass: 0, hide: 0, water: 0 },
    ink: K.ink.start, inkMax: K.ink.max, devotion: 0, buffs: { light: 0 }, comfort: 0,
    weather: { kind: 'clear', wet: false, until: 0, dry: 0, drought: false, dryYear: false, next: null },
    now: {}, plan: { count: {} }, anyLit: true, anyLitCamp: true, tigerBack: 0,
    dirty: { trees: true, fog: true, buildings: true, barriers: true, roads: true },
    log: [], history: [],
    stats: {
      births: 0, deaths: [], food: {}, got: {}, eaten: 0, spoiled: 0, dried: 0, deer: 0, deerByBeast: 0, trees: 0, woodBurnt: 0, coats: 0,
      fled: 0, beastKills: 0, refused: 0, cmds: {}, cmdFail: 0, inkSpent: 0, undone: 0, built: {}, bolts: 0, lights: 0, relit: 0, saves: 0,
      droughtRain: 0, droughts: 0, fireOut: 0, scouts: 0,
    },
    ...opts,
  };
  for (const f of map.forests) { sim.idx[f.id] = f; for (const t of f.trees) sim.idx[t.id] = t; }
  for (const b of map.bushes) sim.idx[b.id] = b;
  for (const r of map.rocks) sim.idx[r.id] = r;
  for (const h of map.herds) sim.idx[h.id] = h;
  for (const p of map.patches) sim.idx[p.id] = p;
  sim.idx.camp = sim.camp;
  sim.die = (p, cause, where) => die(sim, p, cause, where);
  sim.completeSite = (s, by) => completeSite(sim, s, by);
  sim.roadBuilt = seg => markRoad(sim, seg);
  sim.repairFence = w => repairFence(sim, w);
  sim.assignBeds = () => assignBeds(sim);

  reveal(sim, sim.camp.x, sim.camp.y, K.campReveal);
  addFire(sim, sim.camp.x, sim.camp.y, { fuel: 10 });
  addFood(sim, 'berry', 22);
  foundTribe(sim);
  makeBeast(sim, 'tiger', map.lair.x, map.lair.y, { home: { x: map.lair.x, y: map.lair.y } });
  computeNow(sim);
  sim.plan = makePlan(sim);
  log(sim, `${sim.alive.length} 个族人在河边落脚，围着一堆营火。四下还是一张白纸`, 'season');
  return sim;
}

function computeNow(sim) {
  const t = sim.t;
  sim.now = { temp: airTemp(t) - (sim.weather.wet ? 2 : 0), dark: isDark(t), bed: isBedtime(t), light: light(t), season: seasonOf(t), hour: hourOf(t), day: dayOf(t) };
  let lit = false, litCamp = false;
  for (const f of sim.fires) if (f.lit) { lit = true; if (dist(f, sim.camp) < sim.camp.r + 60) litCamp = true; }
  sim.anyLit = lit; sim.anyLitCamp = litCamp;
}

// 推进若干游戏分钟
export function advance(sim, minutes) {
  const n = Math.max(1, Math.round(minutes / STEP));
  for (let i = 0; i < n; i++) tick(sim);
}

export function tick(sim) {
  const dt = STEP, h0 = Math.floor(sim.t / 60), d0 = dayOf(sim.t), s0 = seasonOf(sim.t);
  sim.t += dt; sim.steps++;
  computeNow(sim);
  if (Math.floor(sim.t / 60) !== h0) hourly(sim);
  if (dayOf(sim.t) !== d0) daily(sim, seasonOf(sim.t) !== s0);
  beastsTick(sim, dt);
  sim.stalking = sim.beasts.some(b => b.state === 'stalk' && !b.dead && !b.gone);
  for (const p of sim.alive.slice()) if (p.alive) personTick(sim, p, dt);
  faithTick(sim, dt);
  if (sim.steps % 5 === 0) {
    for (const p of sim.alive) if (p.age >= 5) reveal(sim, p.x, p.y, K.reveal);
  }
  if (sim.effects.length && sim.t - sim.effects[0].t > 240) sim.effects = sim.effects.filter(e => sim.t - e.t <= 240);
}

// ---------------- 每小时 ----------------
function hourly(sim) {
  const N = sim.now, w = sim.weather;
  // 天气
  if (w.wet && sim.t >= w.until) { w.wet = false; w.kind = 'clear'; w.dry = 0; }
  if (w.next && sim.t >= w.next.t) { startRain(sim, w.next.dur); w.next = null; }
  // 火
  for (const f of sim.fires) {
    if (!f.lit) continue;
    f.fuel -= burnRate(sim, f, N.dark);
    if (w.wet && w.kind === 'rain' && !f.roof && f.fuel > 0 && sim.rng() < 0.025 + (f.fuel < 6 ? 0.05 : 0)) {
      f.fuel = 0; f.lit = false; f.outSince = sim.t;
      if (f.kind !== 'field') { sim.stats.fireOut++; sim.stats.doused = (sim.stats.doused || 0) + 1; log(sim, `大雨把${f.name}浇灭了`, 'danger'); }
      continue;
    }
    if (f.fuel <= 0) {
      f.fuel = 0; f.lit = false; f.outSince = sim.t;
      if (f.kind !== 'field') { sim.stats.fireOut++; log(sim, `${f.name}灭了${sim.stock.wood < 1 ? '：没柴了' : ''}`, 'danger'); }
    }
  }
  // 晾肉架、腐坏
  racksHourly(sim);
  for (const b of [...sim.stock.food]) {
    if (sim.t < b.exp) continue;
    sim.stock.food.splice(sim.stock.food.indexOf(b), 1);
    sim.stats.spoiled += b.n;
    if (b.n >= 3) log(sim, `${Math.round(b.n)} 份${FOOD[b.kind].name}坏了`, 'waste');
  }
  // 草木
  const g = K.bush.regrow[N.season] / 24 * (w.drought ? 0.35 : 1);
  for (const b of sim.map.bushes) {
    b.food = Math.min(b.max, b.food + g);
    if (w.drought) b.food *= 0.996;
  }
  for (const f of sim.map.forests) for (const t of f.trees) if (!t.alive && t.regrow && sim.t >= t.regrow) { t.alive = true; t.wood = K.tree.wood; t.burnt = false; t.young = false; t.regrow = 0; sim.dirty.trees = true; }
  // 定时的事
  for (const e of [...sim.later]) {
    if (sim.t < e.t) continue;
    sim.later.splice(sim.later.indexOf(e), 1);
    if (e.kind === 'sprout') sprout(sim, sim.idx[e.ref]);
  }
  // 号令到期
  for (const o of [...sim.orders]) if (o.done || sim.t >= o.until) {
    sim.orders.splice(sim.orders.indexOf(o), 1);
    for (const id of o.members) { const p = sim.idx[id]; if (p && p.order === o.id) p.order = null; }
  }
  if (sim.buffs.light && sim.t > sim.buffs.light) sim.buffs.light = 0;
  // 傍晚分床
  if (Math.floor(N.hour) === sunset(sim.t)) assignBeds(sim);
  sim.comfort = sim.fires.some(f => f.kind === 'hearth' && f.lit) ? 0.03 : 0;
  sim.plan = makePlan(sim);
}

function sprout(sim, f) {
  if (!f) return;
  const n0 = sim.map.bushes.length;
  const pt = { id: `bp${sim.nextId++}`, x: f.x, y: f.y, r: f.r * 0.8 };
  for (let i = 0; i < 6; i++) {
    const a = sim.rng.range(0, 6.28), r = Math.sqrt(sim.rng()) * f.r * 0.8;
    const b = { id: `b${n0 + i}x${sim.nextId++}`, x: f.x + Math.cos(a) * r, y: f.y + Math.sin(a) * r, food: 2, max: K.bush.max * 1.3, seed: sim.rng.int(1e9), patch: pt.id };
    sim.map.bushes.push(b); sim.idx[b.id] = b;
  }
  sim.map.patches.push(pt); sim.idx[pt.id] = pt;
  sim.dirty.trees = true;
  log(sim, '烧过的林子里冒出了一片浆果苗', 'season');
}

// ---------------- 每天 ----------------
function daily(sim, newSeason) {
  sim.day = dayOf(sim.t);
  const N = sim.now, w = sim.weather, s = N.season;
  if (newSeason) {
    const y = yearOf(sim.t);
    log(sim, `${s === 0 ? `第 ${y} 年开春` : `入${SEASONS[s]}`}`, 'season');
    if (s === 1) w.dryYear = sim.rng() < 0.5;
    if (s === 2) for (const f of sim.map.forests) { const live = f.trees.filter(t => t.alive).length; f.nuts = Math.min(10, live * 0.4); }
    if (s === 3) {
      for (const f of sim.map.forests) f.nuts = 0;
      for (const b of sim.map.bushes) b.food = 0;        // 一场霜，枝上的浆果全落了
      log(sim, '下霜了，浆果都落了', 'season');
    }
  }
  // 今天下不下雨
  if (!w.wet) w.dry++;
  const pr = [0.3, 0.2, 0.22, 0.25][s] * (s === 1 && w.dryYear ? 0.15 : 1);
  if (sim.rng() < pr) w.next = { t: sim.t + sim.rng.range(4, 15) * 60, dur: sim.rng.range(3, 9) * 60 };
  if (s < 3 && w.dry >= 6 && !w.drought) { w.drought = true; sim.stats.droughts++; log(sim, `旱了 ${w.dry} 天：浆果蔫了，河水也浅了`, 'danger'); }
  dailyPeople(sim);
  dailyBeasts(sim, newSeason);
  const P = sim.plan;
  sim.history.push({
    day: sim.day, pop: sim.alive.length, adults: sim.alive.filter(p => p.age >= 14).length, food: Math.round(foodTotal(sim)), foodDays: +P.foodDays.toFixed(1),
    wood: Math.round(sim.stock.wood), stone: Math.round(sim.stock.stone), ink: Math.round(sim.ink),
    love: +avg(sim, 'love').toFixed(2), fear: +avg(sim, 'fear').toFixed(2), morale: +avg(sim, 'morale').toFixed(2), health: +avg(sim, 'health').toFixed(2),
    housing: P.housing, deaths: sim.stats.deaths.length, births: sim.stats.births,
  });
}
const avg = (sim, k) => sim.alive.reduce((s, p) => s + p[k], 0) / Math.max(1, sim.alive.length);

// ---------------- 神格：墨从信仰来 ----------------
function faithTick(sim, dt) {
  const dd = dt / DAY;
  let dev = 0;
  for (const p of sim.alive) {
    p.love += (K.baseLove - p.love) * 0.03 * dd;
    p.fear += (K.baseFear - p.fear) * 0.08 * dd;
    if (p.hunger > 0.85 || p.cold > 0.8) p.love = Math.max(0, p.love - 0.02 * dd);
    dev += (p.age < 14 ? 0.5 : 1) * (0.15 + 0.6 * p.love + 0.35 * p.fear);
  }
  sim.devotion = dev;
  sim.ink = Math.min(sim.inkMax, sim.ink + K.ink.perDevotionDay * dev * dd);
}

// ---------------- 族里缺什么 ----------------
export function makePlan(sim) {
  const eaters = sim.alive.reduce((s, p) => s + (p.age >= 14 ? 1 : p.age >= 2 ? 0.6 : 0.4), 0);
  const daily = Math.max(1, eaters * 1.9);
  const food = foodTotal(sim);
  const mf = mainFire(sim);
  const winter = sim.now.season === 3;
  const need = { wood: 0, stone: 0, grass: 0 };
  let buildable = 0;
  for (const s of sim.sites) {
    const m = missing(s);
    for (const k in need) need[k] += m[k] || 0;
    if (siteCanProgress(sim, s)) buildable++;
  }
  const burn = mf ? (K.fire.burnDay * 12 + K.fire.burnNight * 12) * mf.burnMul * (winter ? K.fire.winterMul : 1) : 14;
  const woodTarget = 8 + Math.ceil(burn * 2 / K.fire.perWood) + Math.min(30, need.wood);
  const count = {};
  for (const p of sim.alive) if (p.job) count[p.job.kind] = (count[p.job.kind] || 0) + 1;
  const housing = sim.buildings.reduce((s, b) => s + (b.type === 'shack' ? b.cap : 0), 0);
  const knownRes = sim.map.forests.filter(f => sim.fog[(Math.floor(f.y / 50)) * FOG.cols + Math.floor(f.x / 50)]).length;
  return {
    eaters, daily, food, foodDays: food / daily, foodUrg: clamp(1 - food / (daily * 3)),
    woodTarget, woodUrg: clamp((woodTarget - sim.stock.wood) / woodTarget),
    stoneNeed: Math.max(0, need.stone - sim.stock.stone), grassNeed: Math.max(0, need.grass - sim.stock.grass), siteNeed: need,
    buildable, rackFree: sim.buildings.reduce((s, b) => s + (b.type === 'rack' ? b.cap - b.load.reduce((a, x) => a + x.n, 0) : 0), 0),
    hides: sim.stock.hide, naked: sim.alive.filter(p => !p.clothes).length, housing, count,
    nutsKnown: sim.now.season === 2 && sim.map.forests.some(f => f.nuts >= 1 && sim.fog[(Math.floor(f.y / 50)) * FOG.cols + Math.floor(f.x / 50)]),
    scarce: knownRes < 3, fire: mf,
  };
}

// 分床：窝棚按离火远近排，一家人挨着，小孩老人先
export function assignBeds(sim) {
  const shacks = sim.buildings.filter(b => b.type === 'shack').sort((a, b) => dist(a, sim.camp) - dist(b, sim.camp));
  for (const p of sim.alive) p.bed = null;
  const house = p => {
    if (p.age < 14) { const m = p.parents.map(id => sim.idx[id]).find(q => q && q.alive); return m ? house(m) : p.n; }
    return Math.min(p.n, sim.idx[p.partner]?.n ?? p.n);
  };
  const order = [...sim.alive].sort((a, b) => house(a) - house(b) || a.n - b.n);
  let i = 0;
  for (const s of shacks) for (let c = 0; c < s.cap && i < order.length; c++) order[i++].bed = s.id;
}

// ---------------- 给报告、测试用的摘要 ----------------
export function summary(sim) {
  const causes = {};
  for (const d of sim.stats.deaths) causes[d.cause] = (causes[d.cause] || 0) + 1;
  return {
    seed: sim.seed, day: sim.day, years: +(sim.day / YEAR_DAYS).toFixed(2), pop: sim.alive.length, adults: sim.alive.filter(p => p.age >= 14).length,
    births: sim.stats.births, deaths: sim.stats.deaths.length, causes, built: { ...sim.stats.built },
    food: Math.round(foodTotal(sim)), wood: Math.round(sim.stock.wood), ink: Math.round(sim.ink),
    love: +avg(sim, 'love').toFixed(2), fear: +avg(sim, 'fear').toFixed(2), morale: +avg(sim, 'morale').toFixed(2),
    revealed: +(sim.revealed / sim.fog.length).toFixed(2), spoiled: Math.round(sim.stats.spoiled), dried: Math.round(sim.stats.dried), deer: sim.stats.deer,
    fireOut: sim.stats.fireOut, cmds: Object.values(sim.stats.cmds).reduce((a, b) => a + b, 0), inkSpent: Math.round(sim.stats.inkSpent),
  };
}
// 状态指纹：确定性测试用
export function fingerprint(sim) {
  const r = v => Math.round(v * 1000);
  return JSON.stringify([sim.t, sim.alive.map(p => [p.id, r(p.x), r(p.y), r(p.hunger), r(p.health)]), r(sim.ink), r(sim.stock.wood), sim.beasts.map(b => [r(b.x), r(b.y)]), sim.log.length]);
}
