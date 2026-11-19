import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layout, createNet, initParams, forward, backward, xentGrad, packParams, unpackParams, ARCH } from '../src/recog/cnn.js';
import { makeRng } from '../src/recog/rng.js';

const TINY = { size: 8, conv: [2, 3], embed: 5, classes: 4 };

function lossAt(net, x, label) {
  forward(net, x);
  return xentGrad(net.probs, label, new Float64Array(TINY.classes), 0);
}

test('反向传播与有限差分一致', () => {
  const r = makeRng(7);
  const L = layout(TINY);
  const P = initParams(new Float64Array(L.total), r, TINY);
  for (let i = 0; i < P.length; i++) P[i] += r.normal() * 0.05; // 偏置也给点值，避开 ReLU 恰好为 0
  const net = createNet(P, TINY);
  const x = Float64Array.from({ length: 64 }, () => r());
  const label = 2;
  forward(net, x);
  const dl = new Float64Array(TINY.classes);
  xentGrad(net.probs, label, dl, 0);
  const G = new Float64Array(L.total);
  backward(net, dl, G);
  const eps = 1e-6;
  let worst = 0;
  for (let k = 0; k < 120; k++) {
    const i = r.int(L.total);
    const keep = P[i];
    P[i] = keep + eps; const lp = lossAt(net, x, label);
    P[i] = keep - eps; const lm = lossAt(net, x, label);
    P[i] = keep;
    const num = (lp - lm) / (2 * eps);
    const err = Math.abs(num - G[i]) / Math.max(1e-6, Math.abs(num) + Math.abs(G[i]));
    if (Math.abs(num - G[i]) > 1e-7) worst = Math.max(worst, err);
  }
  assert.ok(worst < 1e-4, `最大相对误差 ${worst}`);
});

test('int8 打包后权重误差在一个量化步以内', () => {
  const L = layout(ARCH);
  const P = initParams(new Float32Array(L.total), makeRng(3));
  const { P: Q } = unpackParams(JSON.parse(JSON.stringify(packParams(P))));
  for (const t of L.tensors) {
    let mx = 0, err = 0;
    for (let i = t.off; i < t.off + t.n; i++) { mx = Math.max(mx, Math.abs(P[i])); err = Math.max(err, Math.abs(P[i] - Q[i])); }
    assert.ok(err <= mx / 127 + 1e-6, `${t.name} 误差 ${err}`);
  }
});

test('同一输入前向结果确定', () => {
  const L = layout(ARCH);
  const P = initParams(new Float32Array(L.total), makeRng(5));
  const a = createNet(P), b = createNet(P);
  const x = Float32Array.from({ length: 1024 }, (_, i) => (i * 37 % 11) / 10);
  forward(a, x); forward(b, x);
  assert.deepEqual(Array.from(a.probs), Array.from(b.probs));
});
