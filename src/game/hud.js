// 顶栏（日子、天气、速度、墨与家当）、编年（日志）、族人小传。都是 DOM，按需刷新。
import { dateText, shichen } from '../sim/calendar.js';
import { foodTotal } from '../sim/util.js';
import { jobName } from './render.js';

const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const avg = (sim, k) => (sim.alive.length ? sim.alive.reduce((s, p) => s + p[k], 0) / sim.alive.length : 0);
const WEATHER = { clear: '晴', rain: '雨', snow: '雪' };

let topKey = '';
export function renderTop(sim, st) {
  const P = sim.plan, w = sim.weather;
  const weather = `${WEATHER[w.kind] || '晴'}${w.drought ? ' · 旱' : ''}`;
  const food = foodTotal(sim), days = P.daily ? food / P.daily : 0;
  const html = `<span class="date"><b>${dateText(sim.t)}</b> ${shichen(sim.t)}</span><span>${weather} ${Math.round(sim.now.temp)}°</span>`;
  const stats = `<span title="墨：写号令要墨；族人越爱戴、越敬畏，墨回得越快">墨 <b>${Math.floor(sim.ink)}</b>/${sim.inkMax}<span class="inkbar"><i style="width:${sim.ink / sim.inkMax * 100}%"></i></span></span>` +
    `<span title="族人（大人 / 全部）">人 <b>${sim.alive.length}</b></span>` +
    `<span title="吃的：够吃几天（干肉、坚果能久放）" class="${days < 1.5 ? 'bad' : ''}">食 <b>${Math.round(food)}</b><small>${days.toFixed(1)} 天</small></span>` +
    `<span>木 <b>${Math.floor(sim.stock.wood)}</b></span><span>石 <b>${Math.floor(sim.stock.stone)}</b></span><span>草 <b>${Math.floor(sim.stock.grass)}</b></span><span>皮 <b>${Math.floor(sim.stock.hide)}</b></span>` +
    `<span title="爱戴：神做的好事；敬畏：神发的威。两样都让人听号令、让墨回得快">爱戴 <b>${Math.round(avg(sim, 'love') * 100)}</b> 敬畏 <b>${Math.round(avg(sim, 'fear') * 100)}</b></span>`;
  const key = html + stats + st.speed + st.bot;
  if (key === topKey) return;
  topKey = key;
  $('#clock').innerHTML = html;
  $('#stats').innerHTML = stats;
  for (const b of document.querySelectorAll('[data-speed]')) b.classList.toggle('on', Number(b.dataset.speed) === st.speed);
  $('#botBtn').classList.toggle('on', !!st.bot);
  $('#botBtn').textContent = st.bot ? '托管中' : '托管';
  $('#botBtn').title = st.bot ? '机器人在替你当神；点一下收回' : '让机器人替你当神：它写的符照样过识别器';
}

// ---------------- 编年 ----------------
const BIG = new Set(['birth', 'death', 'build', 'danger', 'season', 'god']);
let filter = 'big';
const FILTERS = { all: () => true, big: e => BIG.has(e.kind), god: e => e.kind === 'god' };
function li(e) {
  const el = document.createElement('li');
  el.className = e.kind;
  el.innerHTML = `<span class="when">${esc(shortTime(e.t))}</span>${esc(e.text)}`;
  if (e.who) { el.dataset.who = e.who; el.classList.add('who'); }
  return el;
}
const shortTime = t => { const d = Math.floor(t / 1440); return `${Math.floor(d / 28) + 1}年${'春夏秋冬'[Math.floor((d % 28) / 7)]}${(d % 7) + 1}日`; };
export function pushLog(e) {
  if (!FILTERS[filter](e)) return;
  const ol = $('#log');
  ol.prepend(li(e));
  while (ol.children.length > 120) ol.lastChild.remove();
}
export function renderLog(sim) {
  const ol = $('#log');
  ol.innerHTML = '';
  for (const e of sim.log.filter(FILTERS[filter]).slice(-120)) ol.prepend(li(e));
  for (const b of document.querySelectorAll('[data-filter]')) b.classList.toggle('on', b.dataset.filter === filter);
}
export function setFilter(sim, f) { filter = f; renderLog(sim); }

// ---------------- 族人小传 ----------------
const bar = (k, v, bad = false, title = '') => `<span title="${title}">${k}</span><div class="meter ${bad ? 'bad' : ''}"><i style="width:${Math.round(Math.max(0, Math.min(1, v)) * 100)}%"></i></div>`;
const SK = { gather: '采集', chop: '砍柴', quarry: '采石', hunt: '打猎', fish: '叉鱼', build: '盖房', fire: '看火' };
let whoKey = '';
export function renderWho(sim, id) {
  const el = $('#who');
  const p = id && sim.idx[id];
  if (!p) { el.hidden = true; whoKey = ''; return; }
  el.hidden = false;
  const name = q => (q ? `<a data-sel="${q.id}">${esc(q.name)}${q.alive ? '' : '（故）'}</a>` : '');
  const partner = p.partner && sim.idx[p.partner], parents = p.parents.map(i => sim.idx[i]).filter(Boolean), kids = (p.kids || []).map(i => sim.idx[i]).filter(Boolean);
  const bed = p.bed && sim.idx[p.bed];
  const status = !p.alive ? `${p.cause ? `${p.cause}` : ''}，已故` : [jobName(p), p.asleep ? '睡着' : '', p.sick > 0 ? '病着' : '', p.pregnant ? '有孕' : '', p.order ? '奉命' : ''].filter(Boolean).join(' · ');
  const html = `<div class="row"><b class="nm">${esc(p.name)}</b><span class="muted">${p.sex === 'm' ? '男' : '女'} · ${Math.floor(p.age)} 岁 · ${esc(p.temper)}</span><button id="whoClose" class="x" aria-label="关上">×</button></div>
    <div class="small">${esc(status)}</div>
    ${p.alive ? `<div class="statbar">${bar('饿', p.hunger, p.hunger > 0.8)}${''}<span>${Math.round(p.hunger * 100)}</span>${bar('渴', p.thirst, p.thirst > 0.8)}<span>${Math.round(p.thirst * 100)}</span>${bar('累', p.fatigue, p.fatigue > 0.85)}<span>${Math.round(p.fatigue * 100)}</span>${bar('冷', p.cold, p.cold > 0.6)}<span>${Math.round(p.felt)}°</span>${bar('康', p.health, p.health < 0.4)}<span>${Math.round(p.health * 100)}</span>${bar('心', p.morale, p.morale < 0.35)}<span>${Math.round(p.morale * 100)}</span>${bar('爱', p.love, false, '爱戴神')}<span>${Math.round(p.love * 100)}</span>${bar('畏', p.fear, false, '敬畏神')}<span>${Math.round(p.fear * 100)}</span></div>` : ''}
    <div class="small muted">本事：${Object.entries(p.skills).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${SK[k]} ${Math.round(v * 100)}`).join('，')}</div>
    <div class="small">${partner ? `伴：${name(partner)}　` : ''}${parents.length ? `爹娘：${parents.map(name).join('、')}　` : ''}${kids.length ? `孩子：${kids.map(name).join('、')}` : ''}</div>
    <div class="small muted">${p.clothes ? '穿着皮衣' : '没有皮衣'} · ${bed ? '住窝棚' : '睡露天'}</div>`;
  if (html === whoKey) return;
  whoKey = html;
  el.innerHTML = html;
}
