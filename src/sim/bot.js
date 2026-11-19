// 机器人玩家：照一套规则当神，拿来测「机器人能不能活过两年」，也当游戏里的「托管」。
// 它和玩家受一样的限制：写符要过真的识别器（合成笔迹 + 手抖），拿不准就从候选里挑、
// 认错了就撤回重写；图纸照淡影加手抖一步步画；墨、木头、石头、人手都和玩家一样紧。
import { DAY } from './config.js';
import { dist, known, mainFire, FOG } from './util.js';
import { command, targetAt, unlockedCands, verbOf, placeDesign, placeFenceLine, scoutRoute } from './commands.js';
import { RIVER_HALF } from './mapgen.js';
import { BlueprintSession } from '../recog/blueprint.js';
import { symbolById } from '../recog/symbols.js';
import { augment } from '../recog/synth.js';
import { makeRng, hashSeed } from '../recog/rng.js';

const RESERVE = 4; // 留着救急（驱兽、传火）的墨

export function createBot(sim, opts = {}) {
  return {
    sim, rec: opts.recognizer || null, noise: opts.noise ?? 0.8, every: opts.every ?? 30,
    rng: makeRng(hashSeed('bot', sim.seed, opts.salt || 0)), last: -Infinity, fence: null, scoutAt: -Infinity,
    stats: { writes: 0, accept: 0, pick: 0, reject: 0, elsewhere: 0, wrong: 0, gaveUp: 0, cmds: {}, cmdFail: 0, designs: {}, steps: 0, stepFails: 0, scouts: 0 },
  };
}

// 每隔 every 分钟（游戏时间）看一眼局面
export function botTick(bot) {
  const sim = bot.sim;
  if (!sim.alive.length || sim.t - bot.last < bot.every) return;
  bot.last = sim.t;
  danger(bot);
  fireAndSky(bot);
  build(bot);
  economy(bot);
  scout(bot);
}

// 跑一段：模拟和机器人交替
export function runWithBot(sim, bot, minutes, advance) {
  const end = sim.t + minutes;
  while (sim.t < end && sim.alive.length) {
    advance(sim, Math.min(bot.every, end - sim.t));
    botTick(bot);
  }
}

// ---------------- 写符：过识别器 ----------------
// 想写 sym，落在 tgt 上（targetAt 的结果，或天上的 {ctx:'sky', x, y}）。办成了返回 command 的结果
// 界面上「托管」时，bot.onWrite 把每一笔符画出来给人看
function write(bot, tgt, sym) {
  const sim = bot.sim, v = verbOf(tgt.ctx, sym);
  if (!v || sim.ink < v.ink) return null;
  const a = { ctx: tgt.ctx, sym, ref: tgt.ref ?? null, x: tgt.x, y: tgt.y };
  if (!bot.rec) { const r = issue(bot, a); bot.onWrite?.({ tgt, sym, strokes: null, decision: 'direct', ok: !!r, r }); return r; }
  const cands = unlockedCands(tgt.ctx), S = bot.stats;
  for (let tries = 0; tries < 3; tries++) {
    const strokes = augment(symbolById(sym).make(bot.rng), bot.rng, bot.noise);
    const res = bot.rec.recognize(strokes, { cands });
    S.writes++;
    const shown = (ok, r = null) => bot.onWrite?.({ tgt, sym, strokes, decision: res.decision, top: res.top, choices: res.choices, ok, r });
    if (res.decision === 'accept') {
      if (res.top === sym) { S.accept++; bot.rec.addPersonal(sym, strokes); const r = issue(bot, a); shown(!!r, r); return r; }
      shown(false);
      // 认错了：要确认的（雷火、烧荒）在确认框里就取消了；别的生效了再撤回
      S.wrong++;
      if (!verbOf(tgt.ctx, res.top)?.confirm) { const r = command(sim, { ...a, sym: res.top }); if (r.ok && r.undo) r.undo(); }
      continue;
    }
    if (res.decision === 'pick' && res.choices.includes(sym)) { S.pick++; bot.rec.addPersonal(sym, strokes); const r = issue(bot, a); shown(!!r, r); return r; }
    shown(false);
    if (res.decision === 'elsewhere') S.elsewhere++; else S.reject++;
  }
  S.gaveUp++;
  return null;
}
function issue(bot, a) {
  const r = command(bot.sim, a);
  if (r.ok) bot.stats.cmds[r.key] = (bot.stats.cmds[r.key] || 0) + 1;
  else bot.stats.cmdFail++;
  return r.ok ? r : null;
}
const spare = (bot, ink) => bot.sim.ink >= ink + RESERVE;

// ---------------- 救急 ----------------
function danger(bot) {
  const sim = bot.sim;
  for (const b of sim.beasts) {
    if (b.dead || b.gone || b.state !== 'stalk' || !known(sim, b.x, b.y)) continue;
    const prey = sim.idx[b.target];
    if (!prey || !prey.name || !prey.alive) continue;
    // 虎吃过人、或在营地附近转：有墨就劈死它（旁边没人才劈）
    const nearCamp = dist(b, sim.camp) < 700;
    if (b.kind === 'tiger' && sim.ink >= 6 + 2 && (nearCamp || sim.stats.deaths.some(d => d.cause === '虎')) && !sim.alive.some(p => dist(p, b) < 60)) {
      if (write(bot, { ctx: 'sky', x: b.x, y: b.y }, 'huo')) continue;
    }
    const t = targetAt(sim, b.x, b.y);
    if (t.ctx === 'beast') write(bot, t, 'huo');
  }
}

function fireAndSky(bot) {
  const sim = bot.sim, N = sim.now;
  // 营火灭了一个钟头还没人点着，天黑或冷了就传火
  const f = sim.fires.find(x => x.kind !== 'field' && dist(x, sim.camp) < sim.camp.r + 80);
  if (f && !f.lit && sim.t - f.outSince > 60 && (N.dark || N.temp < 10)) write(bot, targetAt(sim, sim.camp.x, sim.camp.y), 'huo');
  if (!f && (N.dark || N.temp < 10)) write(bot, targetAt(sim, sim.camp.x, sim.camp.y), 'huo');
  // 旱了就降雨
  if (sim.weather.drought && !sim.weather.wet) write(bot, { ctx: 'sky' }, 'yu');
  // 人心散了、病倒一片：圣光
  const avg = sim.alive.reduce((s, p) => s + p.morale, 0) / sim.alive.length, sick = sim.alive.filter(p => p.sick > 0).length;
  if (sim.buffs.light < sim.t && (avg < 0.36 || sick >= 3) && spare(bot, 5)) write(bot, targetAt(sim, sim.camp.x, sim.camp.y), 'guang');
}

// ---------------- 图纸 ----------------
function draw(bot, id) {
  const s = new BlueprintSession(id);
  let fails = 0;
  while (!s.done) {
    const res = s.submit(augment(s.step.ghost, bot.rng, bot.noise));
    bot.stats.steps++;
    if (!res.ok) { bot.stats.stepFails++; if (++fails > 8) return null; }
  }
  return { params: s.params(), strokes: s.strokes };
}
const RING = { hearth: [46, 60], shack: [70, 135], rack: [60, 150] };
function placePoint(bot, id, d) {
  const sim = bot.sim, c = mainFire(sim) || sim.camp, [r0, r1] = RING[id];
  const a0 = bot.rng() * Math.PI * 2;
  for (let r = r0; r <= r1; r += 14) for (let k = 0; k < 12; k++) {
    const a = a0 + k / 12 * Math.PI * 2;
    const res = placeDesign(sim, id, d.params, c.x + Math.cos(a) * r, c.y + Math.sin(a) * r, d.strokes);
    if (res.ok) return res;
  }
  return null;
}
function placeRing(bot, d) {
  const sim = bot.sim, c = mainFire(sim) || sim.camp, pts = [];
  for (let k = 0; k <= 20; k++) {
    const a = (k % 20) / 20 * Math.PI * 2;
    let r = sim.camp.r + 40;
    while (r > 90 && sim.map.riverDist(c.x + Math.cos(a) * r, c.y + Math.sin(a) * r) < RIVER_HALF + 14) r -= 10;
    pts.push({ x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r });
  }
  return placeFenceLine(sim, d.params, pts, d.strokes);
}
function build(bot) {
  const sim = bot.sim, P = sim.plan;
  const has = t => sim.buildings.filter(b => b.type === t).length + sim.sites.filter(s => s.type === t).length;
  const open = sim.sites.filter(s => s.type !== 'fenceSeg').length;
  if (open >= 2) return;
  const cap = list => list.filter(s => s.type === 'shack').reduce((s, x) => s + (x.cap ?? x.params.cap), 0);
  const housing = cap(sim.buildings) + cap(sim.sites);
  let want = null;
  if (!has('hearth')) want = 'hearth';
  else if (housing < sim.alive.length + 1 && has('shack') < 6) want = 'shack';
  else if (has('rack') < 1 && sim.day >= 3) want = 'rack';
  else if (has('rack') < 2 && sim.day >= 9) want = 'rack';
  else if (!bot.fence && sim.day >= 12 && sim.stock.wood >= 25) want = 'fence';
  else if (has('rack') < 3 && sim.alive.length >= 13 && sim.day >= 30) want = 'rack';
  if (!want) return;
  const d = draw(bot, want);
  if (!d) return;
  const res = want === 'fence' ? placeRing(bot, d) : placePoint(bot, want, d);
  if (res && res.ok) {
    bot.stats.designs[want] = (bot.stats.designs[want] || 0) + 1;
    if (want === 'fence') bot.fence = res.fence;
    bot.onDesign?.({ id: want, params: d.params, strokes: d.strokes, res });
  }
}

// ---------------- 吃的、柴、石头 ----------------
const ordered = (sim, job) => sim.orders.some(o => o.job === job && !o.done);
function nearestKnown(sim, list, ok = () => true) {
  let best = null, bd = Infinity;
  for (const x of list) {
    if (!ok(x) || !known(sim, x.x, x.y)) continue;
    const d = dist(x, sim.camp);
    if (d < bd) { bd = d; best = x; }
  }
  return best;
}
function riverSpot(sim) {
  const pts = sim.map.river;
  let best = null, bd = Infinity;
  for (let i = 0; i < pts.length; i += 3) { const d = dist(pts[i], sim.camp); if (d < bd && known(sim, pts[i].x, pts[i].y)) { bd = d; best = pts[i]; } }
  return best;
}
function economy(bot) {
  const sim = bot.sim, P = sim.plan, season = sim.now.season, N = sim.now;
  if (N.dark || N.bed) return; // 夜里不派活
  const racks = sim.buildings.filter(b => b.type === 'rack');
  // 打猎：架子空着就去打，晾成干肉过冬；冬天缺吃的也去打（鹿跑远了）
  const herdOk = h => h.n >= (season === 3 ? 2 : 4) && dist(h, sim.camp) < 1400;
  if (!ordered(sim, 'hunt') && ((racks.length && P.rackFree >= 8 && season !== 3) || (season === 3 && P.foodDays < 3) || P.foodDays < 1)) {
    const h = nearestKnown(sim, sim.herds, herdOk);
    if (h) {
      const t = targetAt(sim, h.x, h.y);
      if (t.ctx === 'beast' && t.kind === 'herd') {
        if (!(season >= 1 && racks.length && spare(bot, 3) && write(bot, t, 'qi'))) if (spare(bot, 2)) write(bot, t, 'jian');
      }
    }
  }
  // 秋天拾坚果（能放二十天）
  if (season === 2 && !ordered(sim, 'gather') && spare(bot, 1)) {
    const f = nearestKnown(sim, sim.map.forests, f => f.nuts >= 3);
    if (f) { const t = targetAt(sim, f.x, f.y); if (t.ctx === 'wood') write(bot, t, 'shu'); }
  }
  // 冬天、或吃的见底：叉鱼
  if ((season === 3 ? P.foodDays < 3 : P.foodDays < 1.2) && !ordered(sim, 'fish') && spare(bot, 1)) {
    const r = riverSpot(sim);
    if (r) { const t = targetAt(sim, r.x, r.y); if (t.ctx === 'river') write(bot, t, 'jian'); }
  }
  // 吃的见底、不是冬天：近处采集
  if (season !== 3 && P.foodDays < 1.2 && !ordered(sim, 'gather') && spare(bot, 1)) write(bot, targetAt(sim, sim.camp.x, sim.camp.y), 'shu');
  // 柴：工地缺木头、或入冬前柴不够
  const woodWant = Math.min(60, (P.siteNeed?.wood || 0)) + (season >= 2 ? 30 : 12);
  if (sim.stock.wood < woodWant && !ordered(sim, 'chop') && spare(bot, 1)) {
    const f = nearestKnown(sim, sim.map.forests, f => f.trees.some(t => t.alive) && !sim.bans.some(b => b.ref === f.id));
    if (f) { const t = targetAt(sim, f.x, f.y); if (t.ctx === 'wood') write(bot, t, 'jian'); }
  }
  // 石头：工地缺石头
  if (P.stoneNeed > 0 && !ordered(sim, 'quarry') && spare(bot, 1)) {
    const r = nearestKnown(sim, sim.map.rocks, r => r.stone >= 1);
    if (r) { const t = targetAt(sim, r.x, r.y); if (t.ctx === 'rock') write(bot, t, 'jian'); }
  }
}

// ---------------- 探路（铅笔，不费墨） ----------------
function unknownAlong(sim, a, d0, d1) {
  let n = 0, m = 0;
  for (let d = d0; d <= d1; d += 50) {
    const x = sim.camp.x + Math.cos(a) * d, y = sim.camp.y + Math.sin(a) * d;
    if (x < 0 || y < 0 || x > sim.map.w || y > sim.map.h) continue;
    m++;
    if (!known(sim, x, y)) n++;
  }
  return m ? n / m : 0;
}
function scout(bot) {
  const sim = bot.sim;
  if (sim.now.dark || sim.now.bed || ordered(sim, 'scout')) return;
  const every = sim.day < 6 ? DAY * 0.8 : 6 * DAY;
  if (sim.t - bot.scoutAt < every || sim.revealed / (FOG.cols * FOG.rows) > 0.8) return;
  let best = null, bs = 0.25;
  for (let k = 0; k < 16; k++) {
    const a = k / 16 * Math.PI * 2, s = unknownAlong(sim, a, 400, 1100);
    if (s > bs) { bs = s; best = a; }
  }
  if (best == null) return;
  const c = sim.camp, at = (a, d) => ({ x: Math.max(30, Math.min(sim.map.w - 30, c.x + Math.cos(a) * d)), y: Math.max(30, Math.min(sim.map.h - 30, c.y + Math.sin(a) * d)) });
  const res = scoutRoute(sim, [at(best - 0.25, 300), at(best - 0.2, 750), at(best + 0.15, 1050), at(best + 0.35, 700), at(best + 0.3, 300)]);
  bot.scoutAt = sim.t;
  if (res.ok) bot.stats.scouts++;
}
