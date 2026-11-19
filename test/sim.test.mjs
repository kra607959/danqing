import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createSim, advance, fingerprint } from '../src/sim/sim.js';
import { DAY } from '../src/sim/config.js';
import { command, targetAt, placeDesign } from '../src/sim/commands.js';
import { createBot, runWithBot } from '../src/sim/bot.js';
import { BlueprintSession } from '../src/recog/blueprint.js';
import { Recognizer } from '../src/recog/recognizer.js';
import { mainFire } from '../src/sim/util.js';

const runBot = (seed, days, rec = null) => {
  const sim = createSim(seed), bot = createBot(sim, { recognizer: rec });
  runWithBot(sim, bot, days * DAY, advance);
  return { sim, bot };
};

test('同一个种子跑出来一模一样（不管、机器人都是）', () => {
  const a = createSim(7), b = createSim(7);
  advance(a, 2 * DAY); advance(b, 2 * DAY);
  assert.equal(fingerprint(a), fingerprint(b));
  assert.equal(fingerprint(runBot(7, 2).sim), fingerprint(runBot(7, 2).sim));
  const c = createSim(8);
  advance(c, 2 * DAY);
  assert.notEqual(fingerprint(a), fingerprint(c));
});

test('头一天：人都活着，营火着着，没人饿坏', () => {
  const sim = createSim(1);
  advance(sim, DAY);
  assert.equal(sim.alive.length, 10);
  assert.ok(sim.fires.some(f => f.lit));
  for (const p of sim.alive) assert.ok(p.hunger < 1 && p.thirst < 1 && p.health > 0.8, `${p.name} ${p.hunger} ${p.thirst} ${p.health}`);
});

test('号令：墨不够不扣墨；撤回把墨退回', () => {
  const sim = createSim(2);
  advance(sim, 60);
  const camp = targetAt(sim, sim.camp.x, sim.camp.y);
  assert.equal(camp.ctx, 'folk');
  sim.ink = 3;
  const no = command(sim, { ...camp, sym: 'guang' });
  assert.equal(no.ok, false);
  assert.equal(sim.ink, 3);
  const r = command(sim, { ...camp, sym: 'qi' });
  assert.ok(r.ok && r.undo);
  assert.equal(sim.ink, 2);
  r.undo();
  assert.equal(sim.ink, 3);
});

test('图纸量出的数值落到模拟里：照图修好的晾肉架就是那个容量', () => {
  const sim = createSim(4);
  const s = new BlueprintSession('rack');
  while (!s.done) s.submit(s.step.ghost);
  const p = s.params(), f = mainFire(sim);
  let res = null;
  for (let a = 0; a < 12 && !res?.ok; a++) res = placeDesign(sim, 'rack', p, f.x + Math.cos(a) * 90, f.y + Math.sin(a) * 90, s.strokes);
  assert.ok(res.ok, res.msg);
  sim.stock.wood += 20;
  advance(sim, 3 * DAY);
  const rack = sim.buildings.find(b => b.type === 'rack');
  assert.ok(rack, '三天里应该修好了');
  assert.equal(rack.cap, p.cap);
  assert.equal(rack.dryH, p.dryH);
});

test('机器人当神：两个冬天过后还剩 8 人以上（不管的在这几个种子上都灭族或剩不了几个）', () => {
  for (const seed of [3, 10, 11]) {
    const { sim } = runBot(seed, 56);
    assert.ok(sim.alive.length >= 8, `种子 ${seed}：剩 ${sim.alive.length} 人`);
    const lazy = createSim(seed);
    advance(lazy, 56 * DAY);
    assert.ok(lazy.alive.length <= sim.alive.length - 4, `种子 ${seed}：不管的剩 ${lazy.alive.length} 人`);
  }
});

test('机器人写符走真识别器：大多直接认出，认不出的会重写，最后照样活下来', () => {
  const rec = new Recognizer(JSON.parse(fs.readFileSync(new URL('../model/glyph.json', import.meta.url), 'utf8')));
  const { sim, bot } = runBot(5, 56, rec);
  const S = bot.stats;
  assert.ok(S.writes > 30, `只写了 ${S.writes} 次`);
  assert.ok((S.accept + S.pick) / S.writes > 0.9, JSON.stringify(S));
  assert.ok(sim.alive.length >= 8);
  for (const k of ['hearth', 'shack', 'rack', 'fence']) assert.ok(S.designs[k] >= 1, `没画${k}`);
});
