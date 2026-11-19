// M1 部落白盒的数值都在这里：时间、需求、产出、建筑、神格。调平衡只改这一个文件。
// 时间单位是「游戏分钟」：一天 1440 分钟，1 倍速下约 1 分钟（每秒 24 游戏分钟）。距离单位是纸面单位。

export const DAY = 1440;
export const SEASON_DAYS = 7, YEAR_DAYS = 28;
export const SEASONS = ['春', '夏', '秋', '冬'];
export const MAP = { w: 2400, h: 1600, cell: 50 };
export const STEP = 2;                 // 模拟步长（游戏分钟）
export const GAME_MIN_PER_SEC = 24;    // 1 倍速

export const K = {
  // 走路（单位 / 游戏分钟）
  walk: 5, run: 7.5, laden: 4, riverSlow: 0.45, roadFast: 1.4,
  reveal: 100,          // 人走过时看清的半径
  campReveal: 400,      // 开局营地周围已画出的半径
  campR: 120,           // 营地（族人身上）的半径

  // 需求：每天涨多少（0 = 满足，1 = 撑不住）
  hunger: { adult: 0.8, child: 0.45 }, meal: 0.4, cooked: 0.5,
  thirst: 1.0,
  fatigueAwake: 1.4, fatigueSleep: 3.2,
  // 冷：体感温度低于 12° 开始积冷；高于 15° 散冷
  coldBelow: 12, warmAbove: 15, coldShed: 2.5,
  // 伤血（每天）：饿、渴、冻、病；需求都还好时回血
  dmg: { hunger: 0.3, thirst: 0.5, cold: 0.5, sick: 0.07 }, heal: 0.14,

  // 产出（每小时；技能 0.5、士气 0.6 时大约这么多）
  rate: { gather: 3, grass: 3, chop: 2.5, quarry: 2, fish: [0.7, 1.0, 0.8, 0.12], water: 10, build: 1 },
  carry: 6, meatCarry: 10,
  spoil: { berry: 6, meat: 3, fish: 2, dried: 40 },   // 几天后坏
  bush: { max: 8, regrow: [0.6, 1.0, 0.8, 0] },          // 每丛浆果每天长多少（春夏秋冬）
  tree: { wood: 8 }, rock: { stone: 25 },
  deer: { meat: 10, hide: 1, flee: 110, speed: 7.5, kill: 0.25, killSkill: 0.35 },

  // 火：燃料以「小时」计；一根柴添 3 小时
  fire: { maxFuel: 30, burnDay: 0.6, burnNight: 1.0, winterMul: 1.3, perWood: 3, heat: 18, radius: 90 },
  shelterHeat: { base: 10, warmth: 8 },

  // 野兽
  tiger: { speed: 5.5, dash: 8, hungerDay: 0.16, attack: 0.42, fearFire: 120, territory: 520 },
  wolf: { speed: 6, attack: 0.32, pack: 4, hungerDay: 0.35 },

  // 墨与信仰
  ink: { max: 30, start: 20, perDevotionDay: 3 },
  baseLove: 0.3, baseFear: 0.22,

  // 生老病死
  birthChance: 0.025, pregnantDays: 10, oldAge: 52, sickChance: 0.008,
};

// 建筑：要多少料、多少工时（小时）。图纸画出来的数值会改这些（见 build.js）
export const BUILD = {
  shack: { name: '窝棚', work: 6 },
  hearth: { name: '火塘', work: 3 },
  rack: { name: '晾肉架', work: 4 },
  fence: { name: '篱笆', work: 10 },
  fenceSeg: { name: '篱笆', work: 1 },
  well: { name: '井', need: { stone: 6, wood: 2 }, work: 5 },
  cairn: { name: '石垛', need: { stone: 6 }, work: 1.5 },
  sapling: { name: '树苗', need: {}, work: 0.5 },
  outpost: { name: '营旗', need: { wood: 4 }, work: 1 },
  fire: { name: '篝火', need: { wood: 3 }, work: 0.5 },
};
export const DESIGNS = ['shack', 'hearth', 'rack', 'fence']; // 第一代要画的四张图纸

// 墨笔号令：「语境:符」→ 做什么。动词名和墨价取自 symbols.js 的 CONTEXTS，这里只管 M1 解锁了哪些、落到模拟里是什么
export const ACTIONS = {
  'sky:yu': { kind: 'rain' },
  'sky:huo': { kind: 'bolt' },
  'folk:qi': { kind: 'rally' },
  'folk:guang': { kind: 'light' },
  'folk:huo': { kind: 'kindle' },
  'folk:jian': { kind: 'train' },
  'folk:shu': { kind: 'order', job: 'gather', near: true },
  'wood:jian': { kind: 'order', job: 'chop' },
  'wood:shu': { kind: 'order', job: 'gather' },
  'wood:huo': { kind: 'burn' },
  'wood:qi': { kind: 'rally' },
  'rock:jian': { kind: 'order', job: 'quarry' },
  'rock:shan': { kind: 'site', build: 'cairn' },
  'rock:qi': { kind: 'rally' },
  'beast:jian': { kind: 'hunt' },
  'beast:huo': { kind: 'scare' },
  'beast:qi': { kind: 'huntAll' },
  'river:shui': { kind: 'order', job: 'water' },
  'river:jian': { kind: 'order', job: 'fish' },
  'river:qi': { kind: 'rally' },
  'land:shu': { kind: 'site', build: 'sapling' },
  'land:qi': { kind: 'site', build: 'outpost' },
  'land:shui': { kind: 'site', build: 'well' },
  'land:shan': { kind: 'site', build: 'cairn' },
  'land:huo': { kind: 'site', build: 'fire' },
};
// 这一代还没学会的（写对了也只提示「还没学会」）
export const LOCKED = { 'sky:ri': '放晴', 'sky:yue': '入夜', 'folk:yue': '歇息', 'river:shan': '筑堤' };

// 名字：开局十人，之后生的孩子从池子里取
export const NAMES = {
  m: ['石头', '阿木', '阿岩', '老柯', '阿松', '山子', '阿栗', '青石', '阿杉', '阿桐', '小橡', '阿蒿', '小鹿', '阿樟', '小枫', '阿竹'],
  f: ['阿禾', '小杏', '青禾', '小满', '阿苗', '小溪', '小葵', '小荷', '阿梅', '小苇', '小芽', '阿柳', '小雀', '阿桑', '小蒲', '阿莲'],
};
