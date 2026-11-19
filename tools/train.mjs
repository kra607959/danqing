// 训练第一代十符的小卷积网。每一步现合成一批新样本（旧图不重复用），多线程算梯度，主线程 AdamW 更新。
// 结束时量化成 int8、算出厂原型（每符 4 个特征中心），写进 model/glyph.json。
//   node tools/train.mjs [--steps 3000] [--batch 256] [--lr 0.003] [--workers 14] [--seed 1] [--out model/glyph.json]
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { layout, createNet, initParams, forward, backward, xentGrad, createAdam, adamStep, packParams, unpackParams, ARCH } from '../src/recog/cnn.js';
import { trainSample, evalSet, positive } from '../src/recog/synth.js';
import { rasterize } from '../src/recog/raster.js';
import { makeRng, hashSeed } from '../src/recog/rng.js';
import { SYMBOLS, NEG, CLASS_IDS, CLASS_NAMES } from '../src/recog/symbols.js';

const LEVEL = [0.35, 1.3]; // 每条样本的潦草程度在此区间里随机；评测的「潦草」档 1.6 不在训练范围内

if (!isMainThread) {
  const P = new Float32Array(workerData.paramsBuf), G = new Float32Array(workerData.gradBuf);
  const net = createNet(P);
  const img = new Float32Array(ARCH.size * ARCH.size), dl = new Float32Array(ARCH.classes);
  parentPort.on('message', ({ seed, count, negWeight }) => {
    G.fill(0);
    let loss = 0, correct = 0;
    for (let i = 0; i < count; i++) {
      const r = makeRng(hashSeed(seed, i));
      const { cls, strokes } = trainSample(r, r.range(LEVEL[0], LEVEL[1]));
      rasterize(strokes, ARCH.size, { out: img, width: r.range(0.85, 1.25) });
      forward(net, img);
      let best = 0;
      for (let k = 1; k < ARCH.classes; k++) if (net.probs[k] > net.probs[best]) best = k;
      if (best === cls) correct++;
      loss += xentGrad(net.probs, cls, dl, 0.05, cls === NEG ? negWeight : 1);
      backward(net, dl, G);
    }
    parentPort.postMessage({ loss, correct });
  });
} else {
  await main();
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
  const steps = Number(opt('--steps', 3000)), batch = Number(opt('--batch', 256)), lr0 = Number(opt('--lr', 0.003));
  const nW = Number(opt('--workers', Math.max(1, os.availableParallelism() - 2))), seed = Number(opt('--seed', 1));
  const negWeight = Number(opt('--neg-weight', 1.5));
  const out = path.resolve(fileURLToPath(new URL('..', import.meta.url)), opt('--out', 'model/glyph.json'));
  const L = layout();
  const paramsBuf = new SharedArrayBuffer(L.total * 4), P = new Float32Array(paramsBuf);
  initParams(P, makeRng(hashSeed('init', seed)));
  const grads = [], workers = [];
  for (let w = 0; w < nW; w++) {
    const gradBuf = new SharedArrayBuffer(L.total * 4);
    grads.push(new Float32Array(gradBuf));
    workers.push(new Worker(new URL(import.meta.url), { workerData: { paramsBuf, gradBuf } }));
  }
  const adam = createAdam(P), G = new Float32Array(L.total);
  const per = Math.ceil(batch / nW), realBatch = per * nW;
  console.log(`参数 ${L.total}，${nW} 线程，每步 ${realBatch} 条，共 ${steps} 步（约 ${(steps * realBatch / 1e6).toFixed(2)}M 条合成样本）`);

  // 固定验证集：每符 40 条常态 + 200 条乱画
  const val = [...evalSet('std', 40, 777), ...evalSet('neg', 200, 777)].map(s => ({ cls: s.cls, x: rasterize(s.strokes) }));
  const evalNet = (params) => {
    const net = createNet(params);
    let ok = 0, okPos = 0, nPos = 0, okNeg = 0, nNeg = 0;
    for (const v of val) {
      forward(net, v.x);
      let best = 0;
      for (let k = 1; k < ARCH.classes; k++) if (net.probs[k] > net.probs[best]) best = k;
      const hit = best === v.cls;
      ok += hit;
      if (v.cls === NEG) { nNeg++; okNeg += hit; } else { nPos++; okPos += hit; }
    }
    return { acc: ok / val.length, pos: okPos / nPos, neg: okNeg / nNeg };
  };

  const warm = Math.min(150, steps / 10);
  const lrAt = s => (s <= warm ? lr0 * s / warm : lr0 * (0.03 + 0.97 * 0.5 * (1 + Math.cos(Math.PI * (s - warm) / (steps - warm)))));
  const t0 = Date.now();
  let lossAcc = 0, okAcc = 0, nAcc = 0;
  const history = [];
  for (let step = 1; step <= steps; step++) {
    const res = await Promise.all(workers.map((wk, i) => new Promise(resolve => {
      wk.once('message', resolve);
      wk.postMessage({ seed: hashSeed('step', seed, step, i), count: per, negWeight });
    })));
    G.fill(0);
    for (const g of grads) for (let i = 0; i < G.length; i++) G[i] += g[i];
    let norm = 0;
    for (let i = 0; i < G.length; i++) { G[i] /= realBatch; norm += G[i] * G[i]; }
    norm = Math.sqrt(norm);
    if (norm > 5) for (let i = 0; i < G.length; i++) G[i] *= 5 / norm;
    adamStep(P, G, adam, lrAt(step));
    for (const r of res) { lossAcc += r.loss; okAcc += r.correct; }
    nAcc += realBatch;
    if (step % 100 === 0 || step === steps) {
      const line = { step, loss: +(lossAcc / nAcc).toFixed(4), acc: +(okAcc / nAcc).toFixed(4), lr: +lrAt(step).toExponential(2), sec: Math.round((Date.now() - t0) / 1000) };
      if (step % 500 === 0 || step === steps) Object.assign(line, { val: evalNet(P) });
      history.push(line);
      console.log(JSON.stringify(line));
      lossAcc = okAcc = nAcc = 0;
    }
  }
  for (const w of workers) await w.terminate();

  // 量化后的模型再验一遍（游戏里用的就是它）
  const packed = packParams(P);
  const { P: Q } = unpackParams(JSON.parse(JSON.stringify(packed)));
  const valFloat = evalNet(P), valInt8 = evalNet(Q);
  console.log('验证（float32）', valFloat, '（int8）', valInt8);

  // 出厂原型：每符 160 条常态样本的特征，k-means 聚成 4 个中心
  const net = createNet(Q);
  const protos = {};
  SYMBOLS.forEach((s, c) => {
    const E = [];
    for (let i = 0; i < 160; i++) {
      const r = makeRng(hashSeed('proto', s.id, i));
      forward(net, rasterize(positive(r, c, 1)));
      E.push(unit(net.e));
    }
    protos[s.id] = kmeans(E, 4, makeRng(hashSeed('km', s.id))).map(v => Array.from(v, x => +x.toFixed(4)));
  });

  const model = {
    format: 'danqing-glyph', version: 1, created: new Date().toISOString(),
    classes: CLASS_IDS, names: CLASS_NAMES, weights: packed, protos,
    train: { steps, batch: realBatch, samples: steps * realBatch, lr: lr0, negWeight, level: LEVEL, seconds: Math.round((Date.now() - t0) / 1000), val: { float32: valFloat, int8: valInt8 }, history },
  };
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(model));
  console.log(`写入 ${out}（${(fs.statSync(out).size / 1024).toFixed(1)} KB）`);
}

function unit(v) {
  let s = 0;
  for (const x of v) s += x * x;
  s = Math.sqrt(s) || 1;
  return Float32Array.from(v, x => x / s);
}

// 余弦 k-means（k-means++ 起点，固定随机源）
function kmeans(E, k, r) {
  const d = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return 1 - s; };
  const C = [E[r.int(E.length)]];
  while (C.length < k) {
    const w = E.map(e => Math.min(...C.map(c => d(e, c))) ** 2);
    const tot = w.reduce((a, b) => a + b, 0);
    let x = r() * tot, pick = 0;
    for (; pick < E.length - 1 && (x -= w[pick]) > 0; pick++);
    C.push(E[pick]);
  }
  let cent = C.map(c => Float32Array.from(c));
  for (let it = 0; it < 20; it++) {
    const sums = cent.map(c => new Float32Array(c.length)), counts = new Array(k).fill(0);
    for (const e of E) {
      let bi = 0, bd = Infinity;
      cent.forEach((c, i) => { const dd = d(e, c); if (dd < bd) { bd = dd; bi = i; } });
      counts[bi]++;
      for (let i = 0; i < e.length; i++) sums[bi][i] += e[i];
    }
    cent = sums.map((s, i) => (counts[i] ? unit(s) : cent[i]));
  }
  return cent;
}
