// 部落白盒的过关测试：同一批种子各跑两年，「不管」（没有神）对「机器人当神」（写符走真识别器、图纸手抖着画）。
// 用法：node tools/sim.mjs [--seeds 1-20] [--days 56] [--no-rec] [--out docs/sim.md | --no-write]
// 过关：机器人在 ≥ 90% 的种子上活过两年且剩 ≥ 8 人，平均人数比不管的多 3 人以上。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSim, advance, summary } from '../src/sim/sim.js';
import { DAY, YEAR_DAYS } from '../src/sim/config.js';
import { createBot, runWithBot } from '../src/sim/bot.js';
import { Recognizer } from '../src/recog/recognizer.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const range = s => { const [a, b] = s.split('-').map(Number); return Array.from({ length: (b || a) - a + 1 }, (_, i) => a + i); };
const seeds = range(arg('--seeds', '1-20'));
const days = Number(arg('--days', 2 * YEAR_DAYS));
const useRec = !process.argv.includes('--no-rec');
const out = arg('--out', process.argv.includes('--no-write') ? null : 'docs/sim.md');
const model = useRec ? JSON.parse(fs.readFileSync(path.join(root, 'model/glyph.json'), 'utf8')) : null;
const rec = useRec ? new Recognizer(model) : null;

function run(seed, withBot) {
  const t0 = Date.now();
  const sim = createSim(seed);
  let bot = null;
  if (withBot) { rec?.clearPersonal(); bot = createBot(sim, { recognizer: rec }); }
  let minPop = sim.alive.length, extinct = null;
  for (let d = 0; d < days; d++) {
    if (bot) runWithBot(sim, bot, DAY, advance); else advance(sim, DAY);
    minPop = Math.min(minPop, sim.alive.length);
    if (!sim.alive.length && extinct == null) extinct = d + 1;
  }
  const s = summary(sim);
  return { seed, s, bot: bot?.stats, minPop, extinct, ms: Date.now() - t0, sim };
}
const causeText = c => Object.entries(c).map(([k, n]) => `${k}${n}`).join(' ') || '—';
const pass = r => !r.extinct && r.s.pop >= 8;

const rows = [];
for (const seed of seeds) {
  const P = run(seed, false), B = run(seed, true);
  rows.push({ seed, P, B });
  console.log(`seed ${seed}: 不管 ${P.s.pop} 人（死 ${P.s.deaths}：${causeText(P.s.causes)}，生 ${P.s.births}）${P.extinct ? ` 第 ${P.extinct} 天灭族` : ''} | 机器人 ${B.s.pop} 人（死 ${B.s.deaths}：${causeText(B.s.causes)}，生 ${B.s.births}，墨 ${B.s.inkSpent}）${pass(B) ? '' : ' ✗'}  [${P.ms + B.ms} ms]`);
}

const mean = f => rows.reduce((s, r) => s + f(r), 0) / rows.length;
const nBot = rows.filter(r => pass(r.B)).length, nPas = rows.filter(r => pass(r.P)).length;
const meanB = mean(r => r.B.s.pop), meanP = mean(r => r.P.s.pop);
const extP = rows.filter(r => r.P.extinct).length, extB = rows.filter(r => r.B.extinct).length;
const ok = nBot >= Math.ceil(rows.length * 0.9) && meanB - meanP >= 3 && nPas < nBot;
const sum = k => rows.reduce((s, r) => s + (r.B.bot?.[k] || 0), 0);
const writes = sum('writes');
const pct = k => (writes ? `${(100 * sum(k) / writes).toFixed(1)}%` : '—');
const designs = {}, cmds = {};
for (const r of rows) {
  for (const [k, n] of Object.entries(r.B.bot.designs)) designs[k] = (designs[k] || 0) + n;
  for (const [k, n] of Object.entries(r.B.bot.cmds)) cmds[k] = (cmds[k] || 0) + n;
}
const CMD = { 'beast:qi': '围猎', 'beast:jian': '狩猎', 'beast:huo': '驱兽', 'wood:jian': '砍伐', 'wood:shu': '采集（林）', 'folk:shu': '近处采集', 'river:jian': '叉鱼', 'rock:jian': '采石', 'folk:huo': '传火', 'folk:guang': '圣光', 'sky:yu': '降雨', 'sky:huo': '雷火' };
const DES = { hearth: '火塘', shack: '窝棚', rack: '晾肉架', fence: '篱笆' };

const md = `# 部落白盒：机器人能不能活过两年

由 \`node tools/sim.mjs\` 生成（${new Date().toISOString().slice(0, 10)}）。每个种子从同一张地图、同样 10 个族人开局，跑 ${days} 天（${(days / YEAR_DAYS).toFixed(0)} 年）。

- **不管**：没有神。族人自己找吃的、砍柴、看火、躲野兽，没有图纸也没有号令。
- **机器人**：按一套规则当神（\`src/sim/bot.js\`）。${useRec ? '写符走真的识别器（合成笔迹加手抖，拿不准就从候选里挑，认错了撤回重写）' : '写符直接生效（--no-rec）'}；图纸照淡影加手抖一步步画；墨、木头、石头、人手和玩家一样受限。

## 结论：${ok ? '过关' : '没过关'}

| | 机器人 | 不管 |
|---|---|---|
| 活过两年且剩 ≥ 8 人 | **${nBot} / ${rows.length}** | ${nPas} / ${rows.length} |
| 两年后平均人数 | **${meanB.toFixed(1)}** | ${meanP.toFixed(1)} |
| 灭族 | ${extB} | ${extP} |
| 平均死亡 | ${mean(r => r.B.s.deaths).toFixed(1)} | ${mean(r => r.P.s.deaths).toFixed(1)} |
| 平均出生 | ${mean(r => r.B.s.births).toFixed(1)} | ${mean(r => r.P.s.births).toFixed(1)} |
| 晾成干肉（份） | ${mean(r => r.B.s.dried).toFixed(0)} | ${mean(r => r.P.s.dried).toFixed(0)} |
| 放坏的吃的（份） | ${mean(r => r.B.s.spoiled).toFixed(0)} | ${mean(r => r.P.s.spoiled).toFixed(0)} |

过关线：机器人 ≥ ${Math.ceil(rows.length * 0.9)}/${rows.length} 个种子剩 ≥ 8 人，且平均人数比不管的多 3 人以上。

## 逐个种子

| 种子 | 不管：人数 | 不管：死因 | 机器人：人数 | 机器人：死因 | 机器人：生 | 最少时 | 用墨 |
|---|---|---|---|---|---|---|---|
${rows.map(r => `| ${r.seed} | ${r.P.s.pop}${r.P.extinct ? `（第 ${r.P.extinct} 天灭族）` : ''} | ${causeText(r.P.s.causes)} | ${pass(r.B) ? '' : '✗ '}${r.B.s.pop} | ${causeText(r.B.s.causes)} | ${r.B.s.births} | ${r.B.minPop} | ${r.B.s.inkSpent} |`).join('\n')}

## 机器人做了什么（${rows.length} 个种子合计）

- 图纸：${Object.entries(designs).map(([k, n]) => `${DES[k] || k} ${n}`).join('、')}；画了 ${sum('steps')} 步，${sum('stepFails')} 步没量出来要重画。
- 号令：${Object.entries(cmds).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${CMD[k] || k} ${n}`).join('、')}。
- 探路（铅笔）：${sum('scouts')} 次。
${useRec ? `- 写符 ${writes} 次：直接生效 ${pct('accept')}，拿不准挑了 ${pct('pick')}，不认 ${pct('reject')}，「这里用不上」${pct('elsewhere')}，认错了撤回 ${pct('wrong')}；三回都没写成放弃 ${sum('gaveUp')} 次。` : ''}

## 读法

- 不管的部落熬得过春夏秋（吃的多到放坏），死在冬天：鲜肉三天、鱼两天、浆果四天就坏；入冬一场霜浆果全落，鹿跑远、鱼少，人又饿得快。挨饿时老人小孩先倒。
- 机器人赢在神给的东西：晾肉架（干肉能放 40 天）加秋天围猎，冬天有吃的；窝棚让人肯生养、夜里不冻；火塘省柴更暖；篱笆挡冬狼；虎、狼扑人时驱兽，虎在营地边转就劈。
- 这套规则只是「会玩的人」的下限，不代表平衡定了：墨在机器人手里常常是满的，真人会花得更多，等试玩数据再调。
`;
if (out) { fs.writeFileSync(path.join(root, out), md); console.log(`写入 ${out}`); }
console.log(`${ok ? '过关' : '没过关'}：机器人 ${nBot}/${rows.length}（平均 ${meanB.toFixed(1)} 人），不管 ${nPas}/${rows.length}（平均 ${meanP.toFixed(1)} 人，灭族 ${extP}）`);
process.exitCode = ok ? 0 : 1;
