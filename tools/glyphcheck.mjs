// 识别体检：合成评测集（常态、潦草、两族乱画）、第一代各语境、两两混淆、耗时、个人原型的效果；
// 有真人样本（符号实验室导出的 JSON）时一并评测。结果写成 Markdown。
//   node tools/glyphcheck.mjs [--model model/glyph.json] [--n 300] [--human 样本.json ...] [--out docs/glyphcheck.md]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Recognizer } from '../src/recog/recognizer.js';
import { evalSet, writer } from '../src/recog/synth.js';
import { SYMBOLS, NEG, CLASS_IDS, CLASS_NAMES, CONTEXTS, candidatesOf, classIndex } from '../src/recog/symbols.js';
import { layout } from '../src/recog/cnn.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const optAll = k => args.flatMap((a, i) => (a === k ? [args[i + 1]] : []));
const modelPath = path.resolve(root, opt('--model', 'model/glyph.json'));
const n = Number(opt('--n', 300));
const outPath = path.resolve(root, opt('--out', 'docs/glyphcheck.md'));
const model = JSON.parse(fs.readFileSync(modelPath, 'utf8'));
const rec = new Recognizer(model);
const pct = x => (x * 100).toFixed(1) + '%';
const quiet = args.includes('--quiet');
const nameOf0 = id => (id === 'neg' ? '乱' : CLASS_NAMES[classIndex(id)] || id);
const FAMILY = {
  scribble: '乱涂', zigzag: '竖折线', saw: '锯齿', spiral: '螺旋', hatch: '排线', square: '方框', triangle: '三角', circle: '空圆', rings: '同心圆',
  house: '房子', heart: '心', arrow: '箭头', plus: '十字', cross: '叉', check: '勾', line: '单线', arc: '单弧', scurve: 'S 线', glyph: '字母数字',
  stickman: '火柴人', bolt: '闪电', star: '五角星', smiley: '笑脸', polygon: '乱折线框', grid: '井字', composite: '杂笔',
  hanzi: '像字的笔画', latin: '拉丁字母', fish: '鱼', boat: '帆船', key: '钥匙', cup: '杯子', bird: '飞鸟', umbrella: '伞', scratch: '急折线', eye: '眼睛',
};

// ---- 评测一组样本 ----
function evaluate(samples, ctxId = 'all', r = rec) {
  const cands = candidatesOf(CONTEXTS.find(c => c.id === ctxId));
  const pos = { n: 0, first: 0, accOk: 0, accBad: 0, pick: 0, pickHas: 0, rej: 0, else: 0, cnnOnly: 0, pcOnly: 0 };
  const neg = { n: 0, rej: 0, acc: 0, pick: 0, else: 0 };
  const conf = {}; // 真值 → 第一猜/拒/别处 → 次数
  const ms = [];
  for (const s of samples) {
    const truth = s.cls === NEG ? 'neg' : CLASS_IDS[s.cls];
    if (truth !== 'neg' && !cands.includes(truth)) continue;
    const res = r.recognize(s.strokes, { context: ctxId });
    ms.push(res.ms);
    const guess = res.decision === 'reject' ? '拒' : res.decision === 'elsewhere' ? '别处' : res.top;
    conf[truth] ??= {};
    conf[truth][guess] = (conf[truth][guess] || 0) + 1;
    if (truth === 'neg') {
      neg.n++;
      if (res.decision === 'reject') neg.rej++; else if (res.decision === 'accept') neg.acc++; else if (res.decision === 'pick') neg.pick++; else neg.else++;
      continue;
    }
    pos.n++;
    const rows = res.ranked || [];
    if (rows.length) {
      const byP = rows.reduce((a, b) => (b.p > a.p ? b : a)), byD = rows.reduce((a, b) => (b.d < a.d ? b : a));
      pos.cnnOnly += byP.id === truth; pos.pcOnly += byD.id === truth;
    }
    if (res.decision === 'accept') { if (res.top === truth) { pos.accOk++; pos.first++; } else pos.accBad++; }
    else if (res.decision === 'pick') { pos.pick++; if (res.top === truth) pos.first++; if (res.choices.includes(truth)) pos.pickHas++; }
    else if (res.decision === 'reject') pos.rej++;
    else pos.else++;
  }
  ms.sort((a, b) => a - b);
  return { pos, neg, conf, ms: { mean: ms.reduce((a, b) => a + b, 0) / (ms.length || 1), p95: ms[Math.floor(ms.length * 0.95)] || 0, max: ms[ms.length - 1] || 0 } };
}

const lines = [];
const say = s => { lines.push(s); if (!quiet) console.log(s); };

const L = layout(model.weights.arch);
const kb = (fs.statSync(modelPath).size / 1024).toFixed(1);
say(`# 识别体检（M0）\n`);
say(`> 由 \`node tools/glyphcheck.mjs\` 生成，${new Date().toISOString().slice(0, 16).replace('T', ' ')}。模型 \`${path.relative(root, modelPath).replace(/\\/g, '/')}\`：${L.total} 个参数，int8 存储，文件 ${kb} KB；训练 ${model.train?.steps} 步、${(model.train?.samples / 1e6).toFixed(2)}M 条合成样本、${model.train?.seconds} 秒。\n`);
say(`口径：**第一猜就对** = 生效或请选时排第一的就是对的；**认错还生效** = 不经确认就执行了错的符（虚影和撤回之前）；**乱画被拒** = 判为「神意不明」。\n`);

// ---- 合成：不限语境（十符全开） ----
const sets = {
  std: evalSet('std', n), sloppy: evalSet('sloppy', n),
  neg: evalSet('neg', n * 4), negHeld: evalSet('negHeld', n * 4),
};
rec.recognize(sets.std[0].strokes); // 预热
const R = {};
for (const [k, v] of Object.entries(sets)) R[k] = evaluate(v, 'all');

say(`## 一、合成样本，十符全开（最难的情形）\n`);
say(`| 评测集 | 条数 | 第一猜就对 | 直接生效 | 认错还生效 | 请选 | 误拒 | 只用 CNN | 只用点云 |`);
say(`|---|---|---|---|---|---|---|---|---|`);
for (const [k, name] of [['std', '常态（训练同分布，新种子）'], ['sloppy', '潦草（变形超出训练范围）']]) {
  const p = R[k].pos;
  say(`| ${name} | ${p.n} | **${pct(p.first / p.n)}** | ${pct(p.accOk / p.n)} | ${pct(p.accBad / p.n)} | ${pct(p.pick / p.n)} | ${pct((p.rej + p.else) / p.n)} | ${pct(p.cnnOnly / p.n)} | ${pct(p.pcOnly / p.n)} |`);
}
say(``);
say(`| 乱画 | 条数 | 被拒 | 进了请选 | 当成别处的符 | 被直接生效 |`);
say(`|---|---|---|---|---|---|`);
for (const [k, name] of [['neg', '训练见过的种类（新种子）'], ['negHeld', '没见过的种类（像字的笔画、字母、鱼、船、伞……）']]) {
  const q = R[k].neg;
  say(`| ${name} | ${q.n} | **${pct(q.rej / q.n)}** | ${pct(q.pick / q.n)} | ${pct(q.else / q.n)} | ${pct(q.acc / q.n)} |`);
}
say(``);
// 乱画按种类：哪些东西容易被当成符
for (const [k, title] of [['negHeld', '没见过的种类，逐类（十符全开）'], ['neg', '训练见过的种类，逐类（十符全开）']]) {
  const fam = {};
  for (const s of sets[k]) {
    const res = rec.recognize(s.strokes);
    const f = (fam[s.family] ??= { n: 0, rej: 0, as: {} });
    f.n++;
    if (res.decision === 'reject') f.rej++;
    else { const g = res.decision === 'elsewhere' ? '别处' : `${res.decision === 'accept' ? '生效' : '请选'}${nameOf0(res.top)}`; f.as[g] = (f.as[g] || 0) + 1; }
  }
  const rows = Object.entries(fam).sort((a, b) => a[1].rej / a[1].n - b[1].rej / b[1].n);
  say(`**${title}**：${rows.map(([name, f]) => `${FAMILY[name] || name} ${pct(f.rej / f.n)}${Object.keys(f.as).length ? `（${Object.entries(f.as).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([g, c]) => `${g}×${c}`).join('，')}）` : ''}`).join('；')}。\n`);
}

// ---- 混淆表 ----
const confAll = {};
for (const k of ['std', 'sloppy', 'neg', 'negHeld']) for (const [t, row] of Object.entries(R[k].conf)) {
  confAll[t] ??= {};
  for (const [g, c] of Object.entries(row)) confAll[t][g] = (confAll[t][g] || 0) + c;
}
const cols = [...SYMBOLS.map(s => s.id), '拒', '别处'];
const nameOf = id => (id === 'neg' ? '乱' : CLASS_NAMES[classIndex(id)] || id);
say(`### 混淆表（常态 + 潦草 + 两族乱画；行为真值，列为第一猜，单位：条）\n`);
say(`| 真值 \\ 第一猜 | ${cols.map(c => (c === '拒' || c === '别处' ? c : nameOf(c))).join(' | ')} |`);
say(`|---|${cols.map(() => '---').join('|')}|`);
for (const t of [...SYMBOLS.map(s => s.id), 'neg']) {
  const row = confAll[t] || {};
  say(`| ${nameOf(t)} | ${cols.map(c => (row[c] ? (c === t ? `**${row[c]}**` : row[c]) : '·')).join(' | ')} |`);
}
say(``);
const pairs = [];
for (const k of ['std', 'sloppy']) for (const [t, row] of Object.entries(R[k].conf)) {
  const tot = Object.values(row).reduce((a, b) => a + b, 0);
  for (const [g, c] of Object.entries(row)) if (g !== t && SYMBOLS.some(s => s.id === g) && c / tot > 0.01) pairs.push(`${k === 'std' ? '常态' : '潦草'}：${nameOf(t)} → ${nameOf(g)} ${pct(c / tot)}`);
}
say(pairs.length ? `**超过 1% 的两两混淆**：${pairs.join('；')}。\n` : `**没有超过 1% 的两两混淆。**\n`);

// ---- 按语境 ----
say(`## 二、第一代各语境（画在什么上面，就只比那几个符）\n`);
say(`| 语境 | 候选 | 第一猜就对（常态） | 第一猜就对（潦草） | 认错还生效 | 乱画被拒（见过 / 没见过） | 耗时 均值 / p95 |`);
say(`|---|---|---|---|---|---|---|`);
const ctxRows = [];
for (const ctx of CONTEXTS.filter(c => c.verbs)) {
  const a = evaluate(sets.std, ctx.id), b = evaluate(sets.sloppy, ctx.id), c = evaluate(sets.neg, ctx.id), d = evaluate(sets.negHeld, ctx.id);
  ctxRows.push({ a, b, c, d });
  const cand = Object.entries(ctx.verbs).map(([id, v]) => `${nameOf(id)}·${v.verb}`).join(' ');
  say(`| ${ctx.name} | ${cand} | ${pct(a.pos.first / a.pos.n)} | ${pct(b.pos.first / b.pos.n)} | ${pct((a.pos.accBad + b.pos.accBad) / (a.pos.n + b.pos.n))} | ${pct(c.neg.rej / c.neg.n)} / ${pct(d.neg.rej / d.neg.n)} | ${a.ms.mean.toFixed(2)} / ${a.ms.p95.toFixed(2)} ms |`);
}
const avg = f => ctxRows.reduce((s, r) => s + f(r), 0) / ctxRows.length;
say(`| **平均** | | **${pct(avg(r => r.a.pos.first / r.a.pos.n))}** | **${pct(avg(r => r.b.pos.first / r.b.pos.n))}** | ${pct(avg(r => (r.a.pos.accBad + r.b.pos.accBad) / (r.a.pos.n + r.b.pos.n)))} | **${pct(avg(r => r.c.neg.rej / r.c.neg.n))} / ${pct(avg(r => r.d.neg.rej / r.d.neg.n))}** | |`);
say(``);
say(`十符全开时的耗时：均值 ${R.std.ms.mean.toFixed(2)} ms，p95 ${R.std.ms.p95.toFixed(2)} ms，最长 ${R.std.ms.max.toFixed(2)} ms（Node ${process.version}，含栅格化、CNN、点云）。\n`);

// ---- 个人原型：怪笔迹的人示范三遍 ----
say(`## 三、怪笔迹的人：示范三遍前后\n`);
say(`每人对每个符有自己固定的写法，外加固定的斜、扁、错切。先不示范，各写 20 遍；再每符示范 3 遍（加进个人原型和点云模板），另写 20 遍。十符全开。\n`);
say(`| 写字的人 | 习惯 | 示范前 第一猜就对 | 示范后 第一猜就对 | 示范后 直接生效 | 示范后 认错还生效 |`);
say(`|---|---|---|---|---|---|`);
let before = 0, after = 0, tot = 0;
for (let w = 1; w <= 8; w++) {
  const W = writer(w);
  const r2 = new Recognizer(model);
  const test = [];
  for (let c = 0; c < SYMBOLS.length; c++) for (let i = 3; i < 23; i++) test.push({ cls: c, strokes: W.sample(c, i) });
  const e0 = evaluate(test, 'all', r2);
  for (let c = 0; c < SYMBOLS.length; c++) for (let i = 0; i < 3; i++) r2.addPersonal(SYMBOLS[c].id, W.sample(c, i));
  const e1 = evaluate(test, 'all', r2);
  before += e0.pos.first; after += e1.pos.first; tot += e0.pos.n;
  const h = W.habits;
  say(`| ${w} 号 | 斜 ${(h.rot * 57.3).toFixed(0)}°，错切 ${h.sh.toFixed(2)}，宽高比 ${h.ax.toFixed(2)} | ${pct(e0.pos.first / e0.pos.n)} | ${pct(e1.pos.first / e1.pos.n)} | ${pct(e1.pos.accOk / e1.pos.n)} | ${pct(e1.pos.accBad / e1.pos.n)} |`);
}
say(`| **合计** | | **${pct(before / tot)}** | **${pct(after / tot)}** | | |\n`);

// ---- 真人样本 ----
const humanFiles = optAll('--human');
if (humanFiles.length) {
  say(`## 四、真人样本\n`);
  for (const f of humanFiles) {
    const data = JSON.parse(fs.readFileSync(path.resolve(f), 'utf8'));
    const samples = (data.samples || []).map(s => ({ cls: s.label === 'neg' ? NEG : classIndex(s.label), strokes: s.strokes.map(st => st.map(p => (Array.isArray(p) ? { x: p[0], y: p[1] } : p))), who: s.who || '' }))
      .filter(s => s.cls >= 0);
    const all = evaluate(samples, 'all');
    say(`**${path.basename(f)}**：${samples.length} 条（符 ${all.pos.n}，乱画 ${all.neg.n}）。\n`);
    say(`| 语境 | 第一猜就对 | 认错还生效 | 请选 | 误拒 | 乱画被拒 |`);
    say(`|---|---|---|---|---|---|`);
    const hrows = [];
    for (const ctx of CONTEXTS) {
      const e = evaluate(samples, ctx.id);
      if (!e.pos.n && !e.neg.n) continue;
      if (ctx.verbs) hrows.push(e);
      say(`| ${ctx.name} | ${e.pos.n ? pct(e.pos.first / e.pos.n) : '—'} | ${e.pos.n ? pct(e.pos.accBad / e.pos.n) : '—'} | ${e.pos.n ? pct(e.pos.pick / e.pos.n) : '—'} | ${e.pos.n ? pct((e.pos.rej + e.pos.else) / e.pos.n) : '—'} | ${e.neg.n ? pct(e.neg.rej / e.neg.n) : '—'} |`);
    }
    if (hrows.length) {
      const hp = hrows.filter(e => e.pos.n), hn = hrows.filter(e => e.neg.n);
      const fp = hp.reduce((s, e) => s + e.pos.first / e.pos.n, 0) / (hp.length || 1);
      const fn = hn.reduce((s, e) => s + e.neg.rej / e.neg.n, 0) / (hn.length || 1);
      say(`\n第一代各语境平均：第一猜就对 **${pct(fp)}**（过关线 97%），乱画被拒 **${pct(fn)}**（过关线 95%）。\n`);
    }
    const row = {};
    for (const [t, r] of Object.entries(all.conf)) for (const [g, c] of Object.entries(r)) if (g !== t && !(t === 'neg' && g === '拒')) (row[`${nameOf(t)} → ${g === '拒' || g === '别处' ? g : nameOf(g)}`] = c);
    const top = Object.entries(row).sort((a, b) => b[1] - a[1]).slice(0, 12);
    if (top.length) say(`十符全开时最常见的错：${top.map(([k, v]) => `${k} ×${v}`).join('，')}。\n`);
  }
} else {
  say(`## 四、真人样本\n\n还没有。在符号实验室里「采样」，导出 JSON 后运行 \`node tools/glyphcheck.mjs --human 文件.json\`。过关线按真人样本算：第一代各语境平均第一猜就对 ≥ 97%，乱画被拒 ≥ 95%。\n`);
}

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, lines.join('\n') + '\n');
if (quiet) console.log(lines.slice(0, 40).join('\n'));
console.log(`\n→ ${outPath}`);
