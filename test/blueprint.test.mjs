import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BLUEPRINTS, BlueprintSession } from '../src/recog/blueprint.js';
import { augment } from '../src/recog/synth.js';
import { line, arc } from '../src/recog/geom.js';
import { makeRng, hashSeed } from '../src/recog/rng.js';

// 按提示淡影画（可加手抖）
function drawAll(id, level = 0, seed = 1) {
  const s = new BlueprintSession(id);
  const r = makeRng(hashSeed('bp', id, seed));
  const log = [];
  while (!s.done) {
    const g = s.step.ghost;
    const res = s.submit(level ? augment(g, r, level).map(st => st) : g);
    log.push([s.step?.id, res.ok, res.msg]);
    if (!res.ok) return { s, ok: false, log };
  }
  return { s, ok: true, log };
}

for (const id of Object.keys(BLUEPRINTS)) {
  test(`${BLUEPRINTS[id].name}：照淡影画，每一步都量得出来，数值接近满`, () => {
    const { s, ok, log } = drawAll(id);
    assert.ok(ok, JSON.stringify(log));
    const st = s.stats();
    assert.ok(st.length >= 4);
    for (const x of st) if (x.x != null) assert.ok(x.x >= 0.6, `${x.k} = ${x.x}`);
  });

  test(`${BLUEPRINTS[id].name}：手抖着画也能过（20 次里至少 18 次），数值不低于下限`, () => {
    let pass = 0;
    for (let i = 0; i < 20; i++) {
      const { s, ok } = drawAll(id, 0.6, i);
      if (!ok) continue;
      pass++;
      for (const x of s.stats()) if (x.x != null) assert.ok(x.x >= 0.2 && x.x <= 1, `${x.k} = ${x.x}`);
    }
    assert.ok(pass >= 18, `${pass}/20`);
  });
}

test('画错了给提示、不前进', () => {
  const s = new BlueprintSession('shack');
  const res = s.submit([line(0.2, 0.4, 0.8, 0.4)]);
  assert.equal(res.ok, false);
  assert.match(res.msg, /斜木|斜着/);
  assert.equal(s.step.id, 'frame');
  const p = new BlueprintSession('pad');
  assert.equal(p.submit([line(0.2, 0.5, 0.7, 0.5)]).ok, false);
});

test('窝棚：屋顶越陡防雨越好', () => {
  const steep = new BlueprintSession('shack'), flat = new BlueprintSession('shack');
  steep.submit([line(0.35, 0.6, 0.505, 0.1), line(0.65, 0.6, 0.495, 0.1)]);
  flat.submit([line(0.2, 0.6, 0.51, 0.42), line(0.8, 0.6, 0.49, 0.42)]);
  const rain = s => s.stats().find(x => x.k === '防雨').x;
  assert.ok(rain(steep) > rain(flat));
});

test('火塘：只画半圈不算；石圈越大暖得越远，也越费柴', () => {
  const h = new BlueprintSession('hearth');
  const half = h.submit([arc(0.5, 0.5, 0.2, 0.08, 0, Math.PI)]);
  assert.equal(half.ok, false);
  assert.match(half.msg, /一圈/);
  const small = new BlueprintSession('hearth'), big = new BlueprintSession('hearth');
  assert.ok(small.submit([arc(0.5, 0.5, 0.09, 0.04, 0, Math.PI * 2)]).ok);
  assert.ok(big.submit([arc(0.5, 0.5, 0.26, 0.09, 0, Math.PI * 2)]).ok);
  assert.ok(big.params().radius > small.params().radius);
  assert.ok(big.params().burnMul > small.params().burnMul);
});

test('晾肉架：横杆没搭上柱子要提示；柱子越高晾得越快', () => {
  const r = new BlueprintSession('rack');
  assert.ok(r.submit([line(0.3, 0.62, 0.3, 0.2), line(0.7, 0.62, 0.7, 0.2)]).ok);
  const res = r.submit([line(0.1, 0.22, 0.32, 0.22)]);
  assert.equal(res.ok, false);
  assert.match(res.msg, /两头/);
  const tall = new BlueprintSession('rack'), low = new BlueprintSession('rack');
  tall.submit([line(0.3, 0.64, 0.3, 0.12), line(0.7, 0.64, 0.7, 0.12)]);
  low.submit([line(0.3, 0.64, 0.3, 0.44), line(0.7, 0.64, 0.7, 0.44)]);
  assert.ok(tall.params().dryH < low.params().dryH);
});

test('篱笆：少于三根桩要提示；桩越高越难翻，横档越多越结实', () => {
  const f = new BlueprintSession('fence');
  const res = f.submit([line(0.3, 0.6, 0.3, 0.3), line(0.5, 0.6, 0.5, 0.3)]);
  assert.equal(res.ok, false);
  assert.match(res.msg, /三根/);
  const stakes = h => [0.3, 0.42, 0.54, 0.66].map(x => line(x, 0.62, x, 0.62 - h));
  const hi = new BlueprintSession('fence'), lo = new BlueprintSession('fence');
  hi.submit(stakes(0.4)); lo.submit(stakes(0.12));
  assert.ok(hi.params().height > lo.params().height);
  const one = new BlueprintSession('fence'), two = new BlueprintSession('fence');
  one.submit(stakes(0.3)); two.submit(stakes(0.3));
  one.submit([line(0.25, 0.45, 0.72, 0.45)]);
  two.submit([line(0.25, 0.4, 0.72, 0.4), line(0.25, 0.55, 0.72, 0.55)]);
  assert.ok(two.params().hp > one.params().hp);
});

test('第一代图纸交给模拟的数值都在范围里（照影画、手抖着画都一样）', () => {
  const R = {
    shack: { cap: [2, 6], rainproof: [0.35, 1], sturdy: [0.35, 1], warmth: [0.35, 1] },
    hearth: { heat: [14, 24], radius: [70, 140], burnMul: [0.5, 1.2] },
    rack: { cap: [10, 40], dryH: [18, 30], sturdy: [0.3, 1] },
    fence: { height: [0.3, 1], hp: [80, 240], sharp: [0, 1], woodPer40: [1, 4], workPer40: [0.5, 1.6] },
  };
  for (const [id, keys] of Object.entries(R)) {
    for (let i = 0; i < 12; i++) {
      const { s, ok } = drawAll(id, i ? 0.8 : 0, i);
      if (!ok) continue;
      const p = s.params();
      for (const [k, [a, b]] of Object.entries(keys)) assert.ok(p[k] >= a && p[k] <= b, `${id}.${k} = ${p[k]}`);
      if (p.need) for (const n of Object.values(p.need)) assert.ok(Number.isInteger(n) && n >= 0);
      assert.equal(p.q, undefined);
    }
  }
});
