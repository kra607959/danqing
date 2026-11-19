// 合成样本总览图：每行一个符（行首是标准写法），最后两行是乱画（训练族、评测族）。
//   node tools/sheet.mjs [--out 文件.png] [--level 1] [--size 48] [--cols 14] [--cnn]
// --cnn 用模型实际看到的 32×32 画。
import fs from 'node:fs';
import path from 'node:path';
import { SYMBOLS, canonical } from '../src/recog/symbols.js';
import { positive, scribbleSample } from '../src/recog/synth.js';
import { rasterize, SIZE } from '../src/recog/raster.js';
import { makeRng, hashSeed } from '../src/recog/rng.js';
import { sheet } from './png.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const cnn = args.includes('--cnn');
const size = cnn ? SIZE : Number(opt('--size', 48));
const cols = Number(opt('--cols', 14));
const L = Number(opt('--level', 1));
const out = path.resolve(opt('--out', 'sheet.png'));
const ras = S => rasterize(S, size, cnn ? {} : { margin: 3, width: size / 32 });

const tiles = [];
SYMBOLS.forEach((s, c) => {
  tiles.push(ras(canonical(s.id)));
  for (let i = 1; i < cols; i++) tiles.push(ras(positive(makeRng(hashSeed('sheet', c, i, L)), c, L)));
});
for (const fam of ['train', 'held']) for (let i = 0; i < cols; i++) tiles.push(ras(scribbleSample(makeRng(hashSeed('sheet-neg', fam, i)), fam, L)));
fs.writeFileSync(out, sheet(tiles, cols, size));
console.log(`${SYMBOLS.map(s => s.name).join(' ')} 乱(训练) 乱(评测) → ${out}`);
