import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyRedStroke, classifyRedSymbol } from '../src/recog/redpen.js';
import { augment } from '../src/recog/synth.js';
import { NEG_TRAIN, NEG_HELD } from '../src/recog/negatives.js';
import { line, arc, mapStrokes, fit } from '../src/recog/geom.js';
import { makeRng, hashSeed } from '../src/recog/rng.js';

const px = (S, k = 60, ox = 300, oy = 300) => mapStrokes(S, p => ({ x: p.x * k + ox, y: p.y * k + oy }));
const X = () => [line(0.1, 0.1, 0.9, 0.9), line(0.9, 0.1, 0.1, 0.9)];
const O = r => { const a = r.range(0, 6.3); return [arc(0.5, 0.5, 0.45, 0.45 * r.range(0.85, 1.15), a, a + 2 * Math.PI * r.range(0.97, 1.04))]; };

test('小 ✕ 认成「禁」、小 ○ 认成「护」（各 300 条手写变体，≥ 97%）', () => {
  let x = 0, o = 0;
  for (let i = 0; i < 300; i++) {
    const r = makeRng(hashSeed('red', i));
    if (classifyRedSymbol(px(augment(X(), r, 1))).kind === 'forbid') x++;
    if (classifyRedSymbol(px(augment(O(r), r, 1))).kind === 'guard') o++;
  }
  assert.ok(x >= 291, `✕ ${x}/300`);
  assert.ok(o >= 291, `○ ${o}/300`);
});

// 本来就是 ✕ 或「一笔圈起来」的形状不算误认：圆、方、三角、心形、多边形、十字、叉
const LEGIT = new Set(['circle', 'square', 'triangle', 'heart', 'polygon', 'plus', 'cross']);
test('别的红色小涂画不当成 ✕ 或 ○（36 类乱画里除去本来就是圈和叉的，≥ 97% 认不出）', () => {
  let unknown = 0, n = 0;
  for (const [name, , make] of [...NEG_TRAIN, ...NEG_HELD]) {
    if (LEGIT.has(name)) continue;
    for (let i = 0; i < 60; i++) {
      const r = makeRng(hashSeed('red-neg', name, i));
      const S = px(augment(fit(make(r).filter(s => s.length), 0, 0, 1, 1), r, 1));
      unknown += classifyRedSymbol(S).kind === 'unknown';
      n++;
    }
  }
  assert.ok(unknown / n >= 0.97, `${unknown}/${n}`);
});

test('长线是封锁线，圈起来是禁区，短刀划破自己的线是启封', () => {
  const wall = line(100, 300, 600, 320, 4);
  assert.equal(classifyRedStroke(wall).kind, 'line');
  const loop = arc(400, 400, 120, 90, 0, 2 * Math.PI * 0.99);
  assert.equal(classifyRedStroke(loop).kind, 'zone');
  const slash = line(340, 260, 360, 360, 4);
  const r = classifyRedStroke(slash, [{ points: wall }]);
  assert.equal(r.kind, 'unseal');
  assert.equal(r.line, 0);
  assert.equal(classifyRedStroke(line(100, 100, 130, 130, 4)).kind, 'symbol-part');
});

test('缩放：纸面坐标按「1 像素合几个纸面单位」换算，手底下一样大的 ✕ 结论一样', () => {
  const r = makeRng(hashSeed('red-scale'));
  const S = px(augment(X(), r, 1));
  const k = 4; // 手机上地图缩到 1/4：手底下 48 像素的 ✕，纸面上有 192 单位
  const big = mapStrokes(S, p => ({ x: p.x * k, y: p.y * k }));
  assert.equal(classifyRedSymbol(S).kind, 'forbid');
  assert.equal(classifyRedSymbol(big, k).kind, 'forbid');
  assert.equal(classifyRedSymbol(big).kind, 'unknown'); // 不换算就嫌太大
});
