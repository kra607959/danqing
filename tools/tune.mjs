// 调拒识与生效的门槛：在「调参用」的合成集上（种子和 glyphcheck 的评测集不同）一次算好特征，
// 再在缓存的特征上试一大把门槛组合，挑出满足约束、乱画拒得最多的一组，写回 model/glyph.json 的 tune 字段。
//   node tools/tune.mjs [--n 150] [--write]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Recognizer, decide, TUNE } from '../src/recog/recognizer.js';
import { evalSet } from '../src/recog/synth.js';
import { SYMBOLS, NEG, CLASS_IDS, CONTEXTS, candidatesOf, classIndex } from '../src/recog/symbols.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const n = Number(opt('--n', 150));
const modelPath = path.resolve(root, opt('--model', 'model/glyph.json'));
const model = JSON.parse(fs.readFileSync(modelPath, 'utf8'));
delete model.tune; // 从默认门槛起调
const rec = new Recognizer(model);
const SEED = 4242;
const ALL = SYMBOLS.map((_, c) => c);

const sets = { std: evalSet('std', n, SEED), sloppy: evalSet('sloppy', n, SEED), neg: evalSet('neg', n * 4, SEED), negHeld: evalSet('negHeld', n * 4, SEED) };
const t0 = Date.now();
const F = {};
for (const [k, v] of Object.entries(sets)) F[k] = v.map(s => ({ cls: s.cls, f: rec.features(s.strokes, ALL) }));
console.log(`特征算好了：${Object.values(F).reduce((a, v) => a + v.length, 0)} 条，${((Date.now() - t0) / 1000).toFixed(1)} 秒`);

// 过关线按「第一代各语境平均」算，所以这里也按语境分别算、再平均（十符全开另算一份，只作约束）
const ctxs = CONTEXTS.map(c => ({ id: c.id, ci: candidatesOf(c).map(classIndex) }));
function scoreCtx(T, ci) {
  const m = { std: 0, stdN: 0, sloppy: 0, sloppyN: 0, bad: 0, posN: 0, neg: 0, negN: 0, held: 0, heldN: 0, acc: 0 };
  for (const k of ['std', 'sloppy']) for (const s of F[k]) {
    if (!ci.includes(s.cls)) continue;
    const d = decide(s.f, ci, T), ok = (d.decision === 'accept' || d.decision === 'pick') && d.top === CLASS_IDS[s.cls];
    m[k] += ok; m[k + 'N']++; m.posN++;
    if (d.decision === 'accept') { m.acc++; if (d.top !== CLASS_IDS[s.cls]) m.bad++; }
  }
  for (const [k, key] of [['neg', 'neg'], ['negHeld', 'held']]) for (const s of F[k]) {
    const d = decide(s.f, ci, T);
    m[key] += d.decision === 'reject'; m[key + 'N']++;
  }
  return { std: m.std / m.stdN, sloppy: m.sloppy / m.sloppyN, bad: m.bad / m.posN, acc: m.acc / m.posN, neg: m.neg / m.negN, held: m.held / m.heldN };
}
function score(T) {
  const era = ctxs.filter(c => c.id !== 'all').map(c => scoreCtx(T, c.ci));
  const avg = k => era.reduce((a, s) => a + s[k], 0) / era.length;
  const all = scoreCtx(T, ctxs[0].ci);
  return { std: Math.min(avg('std'), all.std), sloppy: avg('sloppy'), sloppyAll: all.sloppy, bad: Math.max(avg('bad'), all.bad), acc: avg('acc'), neg: avg('neg'), held: avg('held'), heldAll: all.held };
}

const show = (T, s) => `语境平均：标准 ${(s.std * 100).toFixed(2)}% 潦草 ${(s.sloppy * 100).toFixed(2)}%（十符全开 ${(s.sloppyAll * 100).toFixed(2)}%） 认错生效 ${(s.bad * 100).toFixed(3)}% 直接生效 ${(s.acc * 100).toFixed(1)}% | 乱画拒 ${(s.neg * 100).toFixed(2)}% 没见过的拒 ${(s.held * 100).toFixed(2)}%（十符全开 ${(s.heldAll * 100).toFixed(2)}%）`;
const base = { ...TUNE };
console.log('默认门槛：', show(base, score(base)));

// 先调拒识：约束「标准 ≥ 99.7%、潦草 ≥ 97%」，让两族乱画的拒识率之和最大
let best = null;
for (const rejectNeg of [0.3, 0.4, 0.5, 0.6, 0.7])
  for (const novelSim of [0, 0.6, 0.7, 0.75, 0.8, 0.85])
    for (const rejectLow of [0.15, 0.25, 0.4])
      for (const rejectSim of [0.75, 0.8, 0.85, 0.9])
        for (const rejectPc of [0.1, 0.12, 0.14, 0.16, 0.2]) {
          const T = { ...base, rejectNeg, novelSim, rejectLow, rejectSim, rejectPc };
          const s = score(T);
          if (s.std < 0.997 || s.sloppy < 0.97 || s.sloppyAll < 0.97) continue;
          const obj = s.neg + s.held;
          if (!best || obj > best.obj) best = { T, s, obj };
        }
if (!best) { console.log('没有满足约束的组合'); process.exit(1); }
console.log('拒识门槛：', JSON.stringify(Object.fromEntries(['rejectNeg', 'novelSim', 'rejectLow', 'rejectSim', 'rejectPc'].map(k => [k, best.T[k]]))));
console.log('  ', show(best.T, best.s));

// 再调生效：认错还生效 ≤ 0.05% 的前提下，直接生效越多越好（少让人点选）
let bestA = null;
for (const accept of [0.8, 0.85, 0.9, 0.95])
  for (const acceptCnn of [0.4, 0.5, 0.6, 0.7, 0.8])
    for (const acceptPc of [0.1, 0.12, 0.14, 0.16, 0.2])
      for (const acceptSim of [0, 0.7, 0.8, 0.85]) {
        const T = { ...best.T, accept, acceptCnn, acceptPc, acceptSim };
        const s = score(T);
        if (s.bad > 0.0005) continue;
        if (!bestA || s.acc > bestA.s.acc + 1e-9) bestA = { T, s };
      }
const T = bestA ? bestA.T : best.T;
console.log('生效门槛：', JSON.stringify(Object.fromEntries(['accept', 'acceptCnn', 'acceptPc', 'acceptSim'].map(k => [k, T[k]]))));
console.log('  ', show(T, score(T)));

if (args.includes('--write')) {
  const raw = JSON.parse(fs.readFileSync(modelPath, 'utf8'));
  raw.tune = Object.fromEntries(Object.entries(T).filter(([k, v]) => TUNE[k] !== v));
  fs.writeFileSync(modelPath, JSON.stringify(raw));
  console.log(`门槛写进 ${modelPath}：`, JSON.stringify(raw.tune));
}
