// 纸上文明 · 第一代：部落。纸面地图上，十个有名有姓的族人自己过日子；你是神，用三支笔管他们。
//   看：拖动看地图，点一下看族人。滚轮 / 两指缩放；右键、中键拖也能挪。
//   墨笔：在目标上写符 → 号令（要墨）。天上那一条写「雨」「火」。
//   铅笔：画线 → 探路 / 修路 / 迁徙；从图纸照着修的篱笆也用铅笔画走向。
//   朱笔：长线封锁、圈起来禁区、✕ 禁、○ 护、一刀划破启封。
//   图纸：火塘、窝棚、晾肉架、篱笆——照淡影一步步画，量出的数值就是房子的本事。
import { createSim, tick, summary } from '../sim/sim.js';
import { GAME_MIN_PER_SEC, STEP, DAY, YEAR_DAYS, DESIGNS } from '../sim/config.js';
import { command, targetAt, unlockedCands, verbOf, isLocked, redLine, redGuard, redBan, unseal, scoutRoute, buildRoad, migrate, placeDesign, placeFenceLine } from '../sim/commands.js';
import { createBot, botTick } from '../sim/bot.js';
import { known, mainFire } from '../sim/util.js';
import { symbolById, classIndex } from '../recog/symbols.js';
import { InkGrouper } from '../recog/group.js';
import { tooSmall } from '../recog/recognizer.js';
import { classifyRedStroke, classifyRedSymbol } from '../recog/redpen.js';
import { length, bbox } from '../recog/geom.js';
import { BLUEPRINTS } from '../recog/blueprint.js';
import { fitCanvas, paper, inkStroke, pencilStroke, ring, ghostText, polyline, COLORS } from '../ui/ink.js';
import { attachPen } from '../ui/pointer.js';
import { loadRecognizer, savePersonal } from '../ui/store.js';
import { openSheet } from '../sandbox/sheet.js';
import { createCamera, toScreen, toWorld, clampCamera, zoomAt, drawWorld, drawFog, drawNight, drawSky, drawWeather, drawEffects, drawLabels, sheetToMap, place } from './render.js';
import { renderTop, pushLog, renderLog, setFilter, renderWho } from './hud.js';

const $ = s => document.querySelector(s);
const canvas = $('#map');
const NOW = () => performance.now();
const nameOf = id => symbolById(id)?.name || id;
const SKY_H = 58;

let sim, bot = null, rec = null, seed = 0;
let speed = 1, lastSpeed = 1, sheetOpen = false, pen = 'look', selected = null, over = false, milestone = false;
const cam = createCamera();
const stamps = [], fx = [];
let fxSeen = 0, ghost = null, aim = null, placing = null, hover = null, skyTop = 60;

// ---------------- 开局 ----------------
function newGame(s) {
  seed = s;
  sim = createSim(seed);
  sim.onLog = e => { pushLog(e); if (e.kind === 'death' || (e.kind === 'danger' && /虎|狼/.test(e.text))) toast(e.text, 'warn'); else if (e.kind === 'birth' || e.kind === 'build') toast(e.text, 'good'); };
  bot = null; selected = null; over = false; milestone = false; aim = null; placing = null;
  stamps.length = 0; fx.length = 0; fxSeen = 0;
  cam.x = sim.camp.x; cam.y = sim.camp.y + 40;
  cam.z = Math.max(0.45, Math.min(1.1, (innerWidth || 1200) / 1100));
  $('#over').hidden = true;
  renderLog(sim);
  try { history.replaceState(null, '', `?seed=${seed}`); } catch {}
  say(`第 ${seed} 号纸：十个族人在河边落脚，四下还是白纸。先拖动看看营地，点一个族人看看在想什么。`);
}

// ---------------- 提示、吐司、弹框 ----------------
function say(html, cls = '') { const h = $('#hint'); h.innerHTML = html; h.className = `hud plate hint ${cls}`; }
let toastTimer = 0;
function toast(text, cls = '') {
  const el = document.createElement('div');
  el.className = `t ${cls}`;
  el.textContent = text;
  const box = $('#toast');
  box.prepend(el);
  while (box.children.length > 4) box.lastChild.remove();
  setTimeout(() => el.remove(), 5200);
}
let pop = null;
function closePop() { if (pop) { pop.el.remove(); clearInterval(pop.timer); pop = null; } }
function showPop(at, html, kind, wire) {
  closePop();
  const el = document.createElement('div');
  el.className = 'pop plate';
  el.innerHTML = html;
  $('#pops').appendChild(el);
  const s = toScreen(cam, at), r = el.getBoundingClientRect();
  el.style.left = `${Math.max(8, Math.min(innerWidth - r.width - 8, s.x - r.width / 2))}px`;
  el.style.top = `${Math.max(8, Math.min(innerHeight - r.height - 8, s.y + 34))}px`;
  pop = { el, kind };
  wire?.(el);
  return pop;
}

// ---------------- 笔 ----------------
const HINTS = {
  look: '<b>看</b>：拖动挪地图，滚轮或两指缩放；点一个族人看小传。<kbd>Q</kbd>',
  ink: '<b>墨笔</b>：在目标上写符，停笔一会儿就认。写在<b>天</b>（顶上一条）：雨、火（雷）；<b>营地 / 族人</b>：旗光火剑树；<b>树林</b>：剑树火旗；<b>石堆</b>：剑山旗；<b>兽</b>：剑火旗；<b>河</b>：水剑旗；<b>空地</b>：树旗水山火。<kbd>2</kbd>',
  pencil: '<b>铅笔</b>：画一条线，选<b>探路</b>（两个人沿线走一趟，白纸变成地图）、<b>修路</b>或<b>迁徙</b>。<kbd>1</kbd>',
  red: '<b>朱笔</b>：长线是<b>封锁线</b>、首尾相接是<b>禁区</b>（野兽进不来，顶久了会破）；小 ✕ 是<b>禁</b>（禁伐、禁猎）；小 ○ 是<b>护</b>；一刀划破自己的线是<b>启封</b>。<kbd>3</kbd>',
};
const inkG = new InkGrouper(), redG = new InkGrouper({ pad: 18, minRadius: 30 });
let pencilCur = null, redCur = null, drag = null;
function setPen(p) {
  pen = p;
  inkG.cancel(); redG.cancel(); pencilCur = redCur = null;
  for (const b of document.querySelectorAll('[data-pen]')) b.classList.toggle('on', b.dataset.pen === p);
  if (!placing && !aim) say(HINTS[p]);
  canvas.style.cursor = p === 'look' ? 'grab' : 'crosshair';
}
for (const b of document.querySelectorAll('[data-pen]')) b.onclick = () => setPen(b.dataset.pen);
$('#bpBtn').onclick = () => openBlueprint();
const setSpeed = v => { speed = v; if (v > 0) lastSpeed = v; };
for (const b of document.querySelectorAll('[data-speed]')) b.onclick = () => setSpeed(Number(b.dataset.speed));
for (const b of document.querySelectorAll('[data-filter]')) b.onclick = () => setFilter(sim, b.dataset.filter);
$('#homeBtn').onclick = () => { const f = mainFire(sim) || sim.camp; cam.x = f.x; cam.y = f.y + 40; clampCamera(cam); };
$('#newBtn').onclick = () => newGame(Math.floor(Math.random() * 99999) + 1);
$('#botBtn').onclick = () => toggleBot();
// 编年：点标题收起 / 展开（窄屏默认只露最新一条）
const chron = $('#chron');
if (innerWidth < 760) chron.classList.add('collapsed');
chron.querySelector('h3').onclick = () => chron.classList.toggle('collapsed');
$('#log').addEventListener('click', e => { const li = e.target.closest('[data-who]'); if (li) select(li.dataset.who, true); });
$('#who').addEventListener('click', e => {
  if (e.target.id === 'whoClose') select(null);
  const a = e.target.closest('[data-sel]');
  if (a) select(a.dataset.sel, true);
});

function select(id, center = false) {
  selected = id;
  const p = id && sim.idx[id];
  if (p && center && p.alive) { cam.x = p.x; cam.y = p.y; clampCamera(cam); }
  renderWho(sim, selected);
}
// 点一下：族人（或附近的人）
function tapAt(w) {
  let best = null, bd = 28 / Math.min(1, cam.z);
  for (const p of sim.alive) { const d = Math.hypot(p.x - w.x, p.y - 15 - w.y); if (d < bd) { bd = d; best = p; } }
  select(best ? best.id : null);
}

// ---------------- 托管：机器人替你当神 ----------------
function toggleBot() {
  if (bot) { bot = null; toast('收回了：你来当神'); return; }
  if (!rec) { toast('识别模型还在载入', 'warn'); return; }
  bot = createBot(sim, { recognizer: rec });
  bot.onWrite = ({ tgt, sym, strokes, decision, ok }) => {
    if (!strokes) return;
    const at = tgt.ctx === 'sky' ? toWorld(cam, { x: cam.vw * 0.5, y: skyTop + SKY_H * 0.5 }) : { x: tgt.x, y: tgt.y - 30 };
    stamps.push({ strokes: place(strokes, at.x, at.y, 46 / Math.max(0.5, cam.z) * 0.9), color: ok ? COLORS.ink : COLORS.red, t0: NOW(), life: 1800 });
    ghost = { text: ok ? `${nameOf(sym)}·${verbOf(tgt.ctx, sym)?.verb || ''}` : decision === 'pick' ? '？' : '✗', x: at.x, y: at.y, t0: NOW(), color: ok ? COLORS.ink : COLORS.red };
  };
  bot.onDesign = ({ id }) => toast(`托管：照图纸开工 ${BLUEPRINTS[id].name}`, 'good');
  toast('托管：机器人替你当神（写符照样过识别器）。再点一下收回。', 'good');
}

// ---------------- 墨笔：写符 ----------------
function ringOf(strokes) {
  const b = bbox(strokes);
  return { cx: b.cx, cy: b.cy, r: Math.max(42 / cam.z, Math.hypot(b.w, b.h) / 2 + 26 / cam.z) };
}
function targetFor(c) {
  const s = toScreen(cam, c);
  if (s.y < skyTop + SKY_H) return { ctx: 'sky', name: '天' };
  return targetAt(sim, c.x, c.y);
}
const CTX_NAME = { sky: '天', folk: '族人', wood: '树林', rock: '石堆', beast: '兽', river: '河', land: '空地' };
const verbsText = ctx => unlockedCands(ctx).map(id => `${nameOf(id)}${verbOf(ctx, id).verb}`).join(' ');

function handleInk(group) {
  const strokes = group.strokes;
  if (tooSmall(strokes.map(s => s.map(p => toScreen(cam, p))))) { if (strokes.length === 1) tapAt(strokes[0][0]); return; }
  if (!rec) { say('识别模型还在载入，稍等一下', 'warn'); return; }
  const rg = ringOf(strokes), c = { x: rg.cx, y: rg.cy };
  const tgt = targetFor(c);
  const stamp = { strokes, color: COLORS.ink, t0: NOW(), life: 2500 };
  stamps.push(stamp);
  if (!tgt.ctx) { stamp.color = COLORS.red; ghost = { text: '？', x: c.x, y: c.y, t0: NOW(), color: COLORS.red }; say(`参谋：${tgt.why}`, 'warn'); return; }
  const res = rec.recognize(strokes, { cands: unlockedCands(tgt.ctx) });
  if (res.decision === 'reject') {
    stamp.color = COLORS.red;
    ghost = { text: '？', x: c.x, y: c.y, t0: NOW(), color: COLORS.red };
    say(`参谋：神意不明（${tgt.name || CTX_NAME[tgt.ctx]}上只认 ${verbsText(tgt.ctx)}；不扣墨）`, 'warn');
    return;
  }
  if (res.decision === 'elsewhere') {
    stamp.color = COLORS.red;
    ghost = { text: nameOf(res.global), x: c.x, y: c.y, t0: NOW(), color: COLORS.red };
    say(isLocked(tgt.ctx, res.global) ? `参谋：「${nameOf(res.global)}·${verbOf(tgt.ctx, res.global).verb}」还没学会（下一代）` : `参谋：认出是「${nameOf(res.global)}」，但${tgt.name || CTX_NAME[tgt.ctx]}上用不上（不扣墨）`, 'warn');
    return;
  }
  if (res.decision === 'pick') {
    stamp.life = 1e9;
    showPop(c, `<span class="lab">拿不准，是哪个？</span>${res.choices.map(id => `<button data-id="${id}">${nameOf(id)} · ${verbOf(tgt.ctx, id).verb}</button>`).join('')}<button data-id="">都不是</button>`, 'pick', el => {
      el.querySelectorAll('button').forEach(b => (b.onclick = () => {
        closePop();
        stamp.life = 0;
        if (b.dataset.id) intend(b.dataset.id, tgt, strokes, c);
        else say('参谋：那就当没写（不扣墨）');
      }));
    });
    return;
  }
  intend(res.top, tgt, strokes, c);
}
// 认定了：先显虚影；收不回来的要确认；雷火还要点在哪儿劈
function intend(sym, tgt, strokes, c) {
  const v = verbOf(tgt.ctx, sym);
  ghost = { text: `${nameOf(sym)}·${v.verb}`, x: c.x, y: c.y, t0: NOW(), color: COLORS.ink };
  if (sim.ink < v.ink) { say(`参谋：墨不够（「${v.verb}」要 ${v.ink} 墨，现有 ${Math.floor(sim.ink)}）`, 'warn'); return; }
  if (tgt.ctx === 'sky' && sym === 'huo') {
    aim = { sym, strokes };
    say('<b>雷火</b>：点地图上要劈的地方（收不回来；八十步内的野兽、四十五步内的树、三十步内的人都会被劈）。<kbd>Esc</kbd> 取消', 'warn');
    return;
  }
  if (v.confirm) {
    showPop(c, `<span class="lab">「${v.verb}」收不回来，确定？</span><button class="red" data-ok="1">${v.verb}（${v.ink} 墨）</button><button>算了</button>`, 'confirm', el => {
      el.querySelectorAll('button').forEach(b => (b.onclick = () => { closePop(); if (b.dataset.ok) execute(sym, tgt, strokes, c, false); else say(`参谋：收回了「${v.verb}」`); }));
    });
    return;
  }
  setTimeout(() => execute(sym, tgt, strokes, c, true), 380);
}
function execute(sym, tgt, strokes, c, undoable, at = null) {
  const a = { ctx: tgt.ctx, sym, ref: tgt.ref ?? null, x: at ? at.x : tgt.x ?? c.x, y: at ? at.y : tgt.y ?? c.y };
  const r = command(sim, a);
  if (!r.ok) { say(`参谋：${r.msg}`, 'warn'); return; }
  rec.addPersonal(sym, strokes); // 生效的符记进个人原型：越写越认得你的笔迹
  savePersonal(rec);
  say(`${nameOf(sym)}·${r.verb}（${r.cost} 墨）：${r.msg}`, 'good');
  if (!undoable || !r.undo) return;
  let left = 3;
  const p = showPop(c, `<button data-u="1">撤回 <span>${left}</span></button>`, 'undo', el => {
    el.querySelector('button').onclick = () => {
      closePop();
      r.undo();
      const i = rec.personal[classIndex(sym)].findIndex(it => it.strokes === strokes);
      if (i >= 0) { rec.removePersonal(sym, i); savePersonal(rec); }
      say(`撤回了「${r.verb}」，墨退回`);
    };
  });
  p.timer = setInterval(() => { left--; if (left <= 0) closePop(); else p.el.querySelector('span').textContent = left; }, 1000);
}

// ---------------- 朱笔 ----------------
const walls = () => sim.barriers.filter(b => b.kind === 'red' || b.kind === 'zone');
function handleRedStroke(s) {
  const W = walls();
  const k = classifyRedStroke(s, W.map(b => ({ points: b.closed ? [...b.pts, b.pts[0]] : b.pts })), 1 / cam.z);
  if (k.kind === 'unseal') { unseal(sim, W[k.line].id); say('朱笔一刀：启封'); return true; }
  if (k.kind === 'line' || k.kind === 'zone') {
    const r = redLine(sim, s, { closed: k.kind === 'zone' });
    if (!r.ok) say(`参谋：${r.msg}`, 'warn');
    else say(k.kind === 'zone' ? `朱笔圈出禁区（${r.cost} 墨，承受 ${r.barrier.hp}）：野兽进不来，顶久了会破` : `朱笔封锁线（${r.cost} 墨，承受 ${r.barrier.hp}）：野兽过不去，顶久了会破`, r.ok ? 'good' : 'warn');
    return true;
  }
  return false;
}
function handleRedSymbol(group) {
  const strokes = group.strokes, b = bbox(strokes), c = { x: b.cx, y: b.cy };
  const k = classifyRedSymbol(strokes, 1 / cam.z);
  stamps.push({ strokes, color: COLORS.red, t0: NOW(), life: k.kind === 'unknown' ? 1500 : 900 });
  if (k.kind === 'unknown') { say(`参谋：${k.why}`, 'warn'); return; }
  const t = targetAt(sim, c.x, c.y);
  let r;
  if (k.kind === 'forbid') r = redBan(sim, t);
  else r = t.ctx === 'folk' && t.ref === 'camp' ? redGuard(sim, sim.camp.x, sim.camp.y, sim.camp.r + 40) : redGuard(sim, c.x, c.y, Math.max(70, Math.max(b.w, b.h) * 1.2));
  if (!r.ok) say(`参谋：${r.msg}`, 'warn');
  else say(k.kind === 'forbid' ? `朱笔 ✕：${t.name}禁了` : '朱笔 ○：护住这一圈，野兽进不来（承受 60）', 'good');
}

// ---------------- 铅笔 ----------------
const simplify = (s, d = 18) => { const out = [s[0]]; for (const p of s) if (Math.hypot(p.x - out[out.length - 1].x, p.y - out[out.length - 1].y) >= d) out.push(p); if (out.length < 2 || out[out.length - 1] !== s[s.length - 1]) out.push(s[s.length - 1]); return out.map(p => ({ x: p.x, y: p.y })); };
function handlePencil(s) {
  const L = length(s);
  if (L < 10 / cam.z) { tapAt(s[0]); return; }
  if (placing?.line) { placeFence(s); return; }
  if (L < 60) { say('参谋：线太短了', 'warn'); return; }
  const pts = simplify(s), z = pts[pts.length - 1];
  const intoFog = pts.some(p => !known(sim, p.x, p.y));
  stamps.push({ strokes: [s], color: COLORS.pencil, t0: NOW(), life: 1e9, pencil: true, id: 'route' });
  const drop = () => { const i = stamps.findIndex(x => x.id === 'route'); if (i >= 0) stamps.splice(i, 1); };
  showPop(z, `<span class="lab">这条线是？</span><button data-k="scout" class="${intoFog ? 'primary' : ''}">探路（两人走一趟）</button><button data-k="road" class="${intoFog ? '' : 'primary'}">修路（走得快）</button><button data-k="migrate">迁徙到终点</button><button data-k="">算了</button>`, 'confirm', el => {
    el.querySelectorAll('button').forEach(b => (b.onclick = () => {
      closePop(); drop();
      const k = b.dataset.k;
      if (k === 'scout') { const r = scoutRoute(sim, pts); say(r.ok ? '铅笔：探路的人上路了，走过的白纸会变成地图' : `参谋：${r.msg}`, r.ok ? 'good' : 'warn'); }
      else if (k === 'road') { const r = buildRoad(sim, pts); say(r.ok ? `铅笔：修路，${r.road.segs.length} 段` : `参谋：${r.msg}`, r.ok ? 'good' : 'warn'); }
      else if (k === 'migrate') {
        showPop(z, '<span class="lab">全族带着火种搬过去，营地、房子都留在原地。确定？</span><button class="red" data-ok="1">迁徙</button><button>算了</button>', 'confirm', el2 => {
          el2.querySelectorAll('button').forEach(b2 => (b2.onclick = () => { closePop(); if (b2.dataset.ok) { const r = migrate(sim, z.x, z.y); say(r.ok ? '全族迁往新营地' : `参谋：${r.msg}`, r.ok ? 'good' : 'warn'); } }));
        });
      }
    }));
  });
}

// ---------------- 图纸 ----------------
function openBlueprint(start = placing?.id || 'hearth') {
  if (sheetOpen || over) return;
  sheetOpen = true;
  closePop();
  openSheet($('#sheet'), {
    ids: DESIGNS, start, buildLabel: '照图建造：回地图点个地方',
    onClose: () => { sheetOpen = false; },
    onBuilt(S) {
      const bp = S.bp;
      placing = { id: bp.id, params: S.params(), strokes: S.strokes, line: bp.place === 'line', name: bp.name };
      setPen(placing.line ? 'pencil' : 'look');
      say(placing.line ? `<b>${bp.name}</b>：用铅笔在地图上画出篱笆的走向（每 40 步一段，每段约 ${placing.params.woodPer40} 木）。<kbd>Esc</kbd> 取消` : `<b>${bp.name}</b>：点地图上要盖的地方（营地附近、别挨着别的房子和火）。<kbd>Esc</kbd> 取消`, 'good');
    },
  });
}
function placePoint(w) {
  const r = placeDesign(sim, placing.id, placing.params, w.x, w.y, placing.strokes);
  if (!r.ok) { say(`参谋：${r.msg}——换个地方点`, 'warn'); return; }
  const name = placing.name;
  placing = null;
  setPen('look');
  say(`照图纸开工：${name}（要${Object.entries(r.site.need).map(([k, n]) => `${{ wood: '木', stone: '石', grass: '草' }[k]} ${n}`).join('、') || '人手'}）。族人会自己去备料、动工`, 'good');
}
function placeFence(s) {
  const pts = simplify(s, 12);
  const r = placeFenceLine(sim, placing.params, pts, placing.strokes);
  if (!r.ok) { say(`参谋：${r.msg}`, 'warn'); return; }
  placing = null;
  setPen('look');
  say(`照图纸修篱笆：${r.fence.segs.length} 段，族人会一段段备料、立桩`, 'good');
}

// ---------------- 输入 ----------------
let pinch = null;
const touches = new Map();
attachPen(canvas, {
  toWorld: p => toWorld(cam, p),
  onDown(p, t, e) {
    if (pinch) return;
    if (pop && pop.kind !== 'undo') { closePop(); for (const s of stamps) if (s.life > 1e8) s.life = 0; }
    if (aim) {
      const at = p;
      if (!known(sim, at.x, at.y)) { say('参谋：那边还是白纸，劈不着', 'warn'); return; }
      const a = aim; aim = null;
      setPen(pen);
      fx.push({ kind: 'flare', x: at.x, y: at.y, t0: NOW(), dur: 400 });
      execute(a.sym, { ctx: 'sky' }, a.strokes, at, false, at);
      return;
    }
    if (placing && !placing.line) { placePoint(p); return; }
    if (pen === 'look') { drag = { sx: e.clientX, sy: e.clientY, x: cam.x, y: cam.y, moved: false, w: p }; canvas.style.cursor = 'grabbing'; }
    else if (pen === 'ink') { const closed = inkG.down(p, t); if (closed) handleInk(closed); }
    else if (pen === 'red') { redCur = [{ ...p, t }]; const closed = redG.down(p, t); if (closed) handleRedSymbol(closed); }
    else pencilCur = [{ ...p, t }];
  },
  onMove(p, t, e) {
    if (pinch) return;
    if (drag) {
      const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
      if (Math.hypot(dx, dy) > 5) drag.moved = true;
      cam.x = drag.x - dx / cam.z; cam.y = drag.y - dy / cam.z; clampCamera(cam);
    } else if (pen === 'ink') inkG.move(p, t);
    else if (pen === 'red') { redCur?.push({ ...p, t }); redG.move(p, t); }
    else pencilCur?.push({ ...p, t });
  },
  onUp(p, t) {
    if (drag) { if (!drag.moved) tapAt(drag.w); drag = null; canvas.style.cursor = 'grab'; return; }
    if (pinch) return;
    if (pen === 'ink') inkG.up(t);
    else if (pen === 'red' && redCur) {
      const s = redCur;
      redCur = null;
      redG.up(t);
      if (handleRedStroke(s)) { const g = redG.group; if (g) { g.strokes.pop(); if (!g.strokes.length) redG.cancel(); } }
    } else if (pencilCur) { const s = pencilCur; pencilCur = null; handlePencil(s); }
  },
  onHover(p) { hover = p; },
});
// 右键、中键拖：挪地图；滚轮：缩放
let rdrag = null;
canvas.addEventListener('pointerdown', e => {
  if (e.pointerType === 'touch') {
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.size === 2) {
      inkG.cancel(); redG.cancel(); pencilCur = redCur = null; drag = null;
      const [a, b] = [...touches.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
    }
    return;
  }
  if (e.button === 1 || e.button === 2) { rdrag = { sx: e.clientX, sy: e.clientY, x: cam.x, y: cam.y }; e.preventDefault(); }
});
addEventListener('pointermove', e => {
  if (rdrag) { cam.x = rdrag.x - (e.clientX - rdrag.sx) / cam.z; cam.y = rdrag.y - (e.clientY - rdrag.sy) / cam.z; clampCamera(cam); }
  if (touches.has(e.pointerId)) {
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && touches.size >= 2) {
      const [a, b] = [...touches.values()], d = Math.hypot(a.x - b.x, a.y - b.y), cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
      cam.x -= (cx - pinch.cx) / cam.z; cam.y -= (cy - pinch.cy) / cam.z;
      const r = canvas.getBoundingClientRect();
      zoomAt(cam, { x: cx - r.left, y: cy - r.top }, d / (pinch.d || d));
      pinch = { d, cx, cy };
    }
  }
});
const endTouch = e => { touches.delete(e.pointerId); if (touches.size === 0) pinch = null; };
addEventListener('pointerup', e => { rdrag = null; endTouch(e); });
addEventListener('pointercancel', e => { rdrag = null; endTouch(e); });
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  const r = canvas.getBoundingClientRect();
  zoomAt(cam, { x: e.clientX - r.left, y: e.clientY - r.top }, Math.exp(-e.deltaY * 0.0015));
}, { passive: false });
addEventListener('keydown', e => {
  if (sheetOpen || e.target?.matches?.('input, select, textarea')) return;
  const k = e.key;
  if (k === '1') setPen('pencil');
  else if (k === '2') setPen('ink');
  else if (k === '3') setPen('red');
  else if (k === '4') openBlueprint();
  else if (k === 'q' || k === 'Q') setPen('look');
  else if (k === ' ') { e.preventDefault(); setSpeed(speed ? 0 : lastSpeed); }
  else if (k === 'Escape') { inkG.cancel(); redG.cancel(); closePop(); if (aim || placing) { aim = null; placing = null; setPen(pen); say('取消了'); } }
  else if (k === 'Enter') { const g = inkG.close(); if (g) handleInk(g); }
  else if (k === '+' || k === '=') zoomAt(cam, { x: cam.vw / 2, y: cam.vh / 2 }, 1.2);
  else if (k === '-') zoomAt(cam, { x: cam.vw / 2, y: cam.vh / 2 }, 1 / 1.2);
  else if (/^Arrow|^[wasdWASD]$/.test(k)) {
    const d = 120 / cam.z, m = { ArrowLeft: [-d, 0], a: [-d, 0], A: [-d, 0], ArrowRight: [d, 0], d: [d, 0], D: [d, 0], ArrowUp: [0, -d], w: [0, -d], W: [0, -d], ArrowDown: [0, d], s: [0, d], S: [0, d] }[k];
    if (m) { cam.x += m[0]; cam.y += m[1]; clampCamera(cam); e.preventDefault(); }
  } else if (k === 'h' || k === 'H') $('#homeBtn').click();
});

// ---------------- 主循环：真实时钟，一倍速一天约一分钟 ----------------
let lastT = NOW(), acc = 0, hudAt = 0;
function frame(now) {
  const dt = Math.min(0.25, (now - lastT) / 1000);
  lastT = now;
  if (!sheetOpen && speed > 0 && !over && sim.alive.length) {
    acc += dt * speed * GAME_MIN_PER_SEC;
    let n = 0;
    while (acc >= STEP && n < 600) { tick(sim); acc -= STEP; n++; if (bot) botTick(bot); }
    if (acc > STEP * 30) acc = 0;
  }
  for (; fxSeen < sim.effects.length; fxSeen++) { const f = sim.effects[fxSeen]; fx.push({ ...f, t0: now, dur: f.kind === 'bolt' ? 900 : f.kind === 'light' ? 3200 : 2600 }); }
  if (!over && !sim.alive.length) gameOver();
  if (!milestone && sim.day >= 2 * YEAR_DAYS && sim.alive.length) { milestone = true; toast(`两年了，部落还在：${sim.alive.length} 人。这就是第一代的过关线`, 'good'); }
  draw(now);
  if (now - hudAt > 180) { hudAt = now; renderTop(sim, { speed, bot: !!bot }); renderWho(sim, selected); }
  requestAnimationFrame(frame);
}
function gameOver() {
  over = true;
  const s = summary(sim);
  $('#over').hidden = false;
  $('#over').innerHTML = `<div class="plate box"><h2>部落没了</h2><p>第 ${seed} 号纸，撑了 ${s.day} 天（${(s.day / YEAR_DAYS).toFixed(1)} 年）。死因：${Object.entries(s.causes).map(([k, n]) => `${k} ${n}`).join('、')}。</p><p class="small muted">冬天最难：鲜肉三天就坏，入冬浆果全落、鹿跑远。晾肉架、秋天围猎、窝棚和火塘，是过冬的本钱。</p><div class="row"><button class="primary" id="againBtn">再开一张纸</button><button id="sameBtn">同一张纸重来</button></div></div>`;
  $('#againBtn').onclick = () => newGame(Math.floor(Math.random() * 99999) + 1);
  $('#sameBtn').onclick = () => newGame(seed);
}

// ---------------- 画 ----------------
let paperCache = null, paperKey = '';
function draw(now) {
  const { ctx, w, h, dpr } = fitCanvas(canvas);
  cam.vw = w; cam.vh = h;
  const st = Math.round($('.hud-top').getBoundingClientRect().bottom + 6);
  if (st !== skyTop) { skyTop = st; document.body.style.setProperty('--below-sky', `${skyTop + SKY_H + 8}px`); }
  const key = `${canvas.width}x${canvas.height}`;
  if (paperKey !== key) {
    paperKey = key;
    paperCache = document.createElement('canvas');
    paperCache.width = canvas.width; paperCache.height = canvas.height;
    const pc = paperCache.getContext('2d');
    pc.scale(canvas.width / w, canvas.height / h);
    paper(pc, w, h, 5);
    clampCamera(cam);
  }
  ctx.drawImage(paperCache, 0, 0, w, h);
  const closedInk = inkG.tick(now);
  if (closedInk) handleInk(closedInk);
  const closedRed = redG.tick(now);
  if (closedRed) handleRedSymbol(closedRed);

  const world = () => { ctx.save(); ctx.translate(w / 2, h / 2); ctx.scale(cam.z, cam.z); ctx.translate(-cam.x, -cam.y); };
  const ui = { labels: [], t: now, selected };
  world();
  drawWorld(ctx, sim, cam, ui);
  drawEffects(ctx, fx, now);
  ctx.restore();
  drawFog(ctx, sim, cam, paperCache, w, h, dpr);
  drawNight(ctx, sim, cam, w, h, dpr);
  drawWeather(ctx, sim, w, h, now);
  // 正在写的、刚写过的：盖在白纸和夜色上面
  world();
  for (const st of stamps) {
    const age = now - st.t0, a = st.life > 1e8 ? 0.9 : Math.max(0, 1 - age / st.life);
    for (const x of st.strokes) (st.pencil ? pencilStroke(ctx, x, { width: 2 / cam.z }) : inkStroke(ctx, x, { width: 4 / cam.z, color: st.color, alpha: a }));
  }
  for (let i = stamps.length - 1; i >= 0; i--) if (stamps[i].life < 1e8 && now - stamps[i].t0 > stamps[i].life) stamps.splice(i, 1);
  if (inkG.group) for (const x of inkG.group.strokes) inkStroke(ctx, x, { width: 4 / cam.z });
  if (redG.group) for (const x of redG.group.strokes) inkStroke(ctx, x, { width: 3.4 / cam.z, color: COLORS.red });
  if (redCur) inkStroke(ctx, redCur, { width: 3.4 / cam.z, color: COLORS.red });
  if (pencilCur) pencilStroke(ctx, pencilCur, { width: 2 / cam.z });
  if (placing && !placing.line && hover) {
    const ok = known(sim, hover.x, hover.y);
    for (const s of sheetToMap(placing.id, placing.strokes, hover.x, hover.y)) pencilStroke(ctx, s, { width: 1.6 / cam.z, color: ok ? COLORS.blue : COLORS.red, alpha: 0.75 });
  }
  if (aim && hover) polyline(ctx, [{ x: hover.x - 20, y: hover.y }, { x: hover.x + 20, y: hover.y }], { width: 2 / cam.z, color: COLORS.red }), polyline(ctx, [{ x: hover.x, y: hover.y - 20 }, { x: hover.x, y: hover.y + 20 }], { width: 2 / cam.z, color: COLORS.red });
  ctx.restore();
  drawSky(ctx, sim, w, skyTop, SKY_H, now);
  drawLabels(ctx, cam, ui.labels);
  // 符圈、虚影：按屏幕像素画
  const scr = rg => { const s = toScreen(cam, { x: rg.cx, y: rg.cy }); return { cx: s.x, cy: s.y, r: rg.r * cam.z }; };
  inkG.pad = 26 / cam.z; inkG.minRadius = 42 / cam.z; inkG.tapLen = 7 / cam.z;
  redG.pad = 18 / cam.z; redG.minRadius = 30 / cam.z; redG.tapLen = 7 / cam.z;
  if (inkG.group) {
    const rg = inkG.ring(), t = targetFor({ x: rg.cx, y: rg.cy });
    ring(ctx, scr(rg), { progress: inkG.progress(now), label: t.ctx ? `${t.name || CTX_NAME[t.ctx]}：${verbsText(t.ctx)}` : t.why, color: t.ctx ? COLORS.ink : COLORS.red });
  }
  if (redG.group && !redG.drawing) ring(ctx, scr(redG.ring()), { progress: redG.progress(now), color: COLORS.red, label: '✕ 禁 · ○ 护' });
  if (ghost) {
    const age = now - ghost.t0, g = toScreen(cam, ghost);
    if (age > 1500) ghost = null;
    else ghostText(ctx, ghost.text, g.x, g.y, { size: 32, alpha: 0.5 * (1 - age / 1500) + 0.08, color: ghost.color });
  }
}

// ---------------- 起 ----------------
newGame(Number(new URLSearchParams(location.search).get('seed')) || Math.floor(Math.random() * 99999) + 1);
setPen('look');
requestAnimationFrame(t => { lastT = t; frame(t); });
loadRecognizer().then(r => {
  rec = r.rec;
  document.documentElement.dataset.ready = '1';
}).catch(err => say(`模型载入失败：${err.message}。请用 node serve.mjs 打开。`, 'warn'));
// 调试、截图、自动验证用
window.__game = {
  get sim() { return sim; }, cam, get rec() { return rec; }, get bot() { return bot; },
  setSpeed, toggleBot, newGame, select, setPen,
  handleInk: strokes => handleInk({ strokes }),
  openBlueprint, get placing() { return placing; }, placePoint: (x, y) => placing && placePoint({ x, y }),
};
