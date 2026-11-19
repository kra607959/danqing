import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InkGrouper } from '../src/recog/group.js';

// 按给定时间画一笔：pts 为 [[x,y],...]，每点间隔 dt 毫秒
function stroke(g, pts, t, dt = 16) {
  const closed = g.down({ x: pts[0][0], y: pts[0][1] }, t);
  for (let i = 1; i < pts.length; i++) g.move({ x: pts[i][0], y: pts[i][1] }, t + i * dt);
  const up = g.up(t + pts.length * dt);
  return { closed, up, end: t + pts.length * dt };
}
const seg = (x0, y0, x1, y1, n = 8) => Array.from({ length: n }, (_, i) => [x0 + (x1 - x0) * i / (n - 1), y0 + (y1 - y0) * i / (n - 1)]);

test('雨：一道弧加三点，停笔 0.45 秒后成一个符', () => {
  const g = new InkGrouper();
  let t = 0;
  t = stroke(g, seg(100, 120, 220, 120, 12), t).end + 200;
  for (const x of [120, 160, 200]) t = stroke(g, seg(x, 140, x, 170), t).end + 180;
  assert.equal(g.tick(t), null, '还没停够');
  const done = g.tick(t + 450);
  assert.ok(done);
  assert.equal(done.strokes.length, 4);
});

test('树：先写树干、紧接着写树冠（停顿不到 0.45 秒），不会被切成两个符', () => {
  const g = new InkGrouper();
  let r = stroke(g, seg(200, 260, 200, 380, 12), 0);
  const crown = Array.from({ length: 30 }, (_, i) => [200 - 60 * Math.cos(i / 29 * 6.3), 220 - 60 * Math.sin(i / 29 * 6.3)]);
  r = stroke(g, crown, r.end + 200);
  assert.equal(r.closed, null, '树冠起笔还在圈里');
  assert.equal(g.group.strokes.length, 2);
});

test('在圈外起笔：旧圈立刻收笔，新笔开新圈', () => {
  const g = new InkGrouper();
  let r = stroke(g, seg(100, 100, 100, 180), 0);
  r = stroke(g, seg(400, 100, 400, 180), r.end + 100);
  assert.ok(r.closed, '旧圈收了');
  assert.equal(r.closed.strokes.length, 1);
  assert.equal(g.group.strokes.length, 1);
});

test('圈里点一下是「点」，圈外点一下只为收笔', () => {
  const g = new InkGrouper();
  // 日：先画圆，再在圆心点一下
  const circle = Array.from({ length: 30 }, (_, i) => [200 + 50 * Math.cos(i / 29 * 6.4), 200 + 50 * Math.sin(i / 29 * 6.4)]);
  let r = stroke(g, circle, 0);
  r = stroke(g, [[201, 199]], r.end + 150);
  assert.equal(g.group.strokes.length, 2, '圆心的点算进符里');
  // 圈外点一下：收笔
  r = stroke(g, [[400, 400]], r.end + 150);
  assert.ok(r.closed, '点圈外收笔');
  assert.equal(r.closed.strokes.length, 2);
  assert.ok(r.up.tapped);
  assert.equal(g.group, null, '这一点丢掉了');
});

test('按落笔节奏放宽停笔时间，最多 0.9 秒', () => {
  const g = new InkGrouper();
  let t = 0;
  for (let k = 0; k < 6; k++) {
    t = stroke(g, seg(100 + k * 4, 100, 104 + k * 4, 160), t).end + 400; // 每笔之间停 0.4 秒
  }
  assert.ok(g.pause > 800 && g.pause <= 900, `pause=${g.pause}`);
});
