// 归类.test.js — 文稿台的分类规则。
//
// 案发（2026-08-31 内部评审）：**这块此前零判据覆盖。**
// 把 `归类()` 整个掏空成永远返回 'qita'（分类功能彻底拆掉），
// 跑全量 `node --test "test/*.test.js"` → 308/308 全绿。
// 而那一轮改动的主轴就是「分类与筛选」，验收单以「273 全绿 / 83 变异全红」为落地依据。
// **判据数字的大小，与它照没照到这次改的东西，是两回事。**
//
// 同一轮还量出规则本身的毛病：
//   · 「在办文稿」对它释文所列的文档只有 33/73 召回。首版要求关键词落在
//     **路径段开头**（`(^|\/)(方案|评审|…)`），而 TK 的命名法是
//     `A1二维位移场-方案.md`、`色带备选方案.md`——词在段中。
//     漏掉的 40 份里包括他 08-25 那对正在改的技术方案。
//   · 反向：14 份 `项管台账/收口报告-*`（机器产出、只读）被收进「在办文稿」。
'use strict';
const assert = require('node:assert');
const test = require('node:test');

const 文稿 = require('../server/lib/文稿.js');
const { 归类, 类别表 } = 文稿;

const 类 = (p, 根 = 'tk') => 归类(根, p);

// ── 一、召回：释文答应的东西必须真的在里面 ──────────────────────

test('守① **词在段中也要认**（这一条是 33/73 召回的直接原因）', () => {
  // 全部取自真语料
  const 靶 = [
    'Docs/SLG/技术方案/A1二维位移场-方案.md',
    'Docs/SLG/技术方案/A1二维位移场-方案-评审意见.md',
    'Docs/SLG/技术方案/A1位移场二维化-方案.md',
    'Docs/SLG/技术方案/二维跟手位移场-方案-评审意见.md',
    'Docs/SLG/技术方案/Assets目录治理-调研-评审意见.md',
    'Docs/SLG/地图/地理地图管线方案.md',
    'Docs/SLG/地图/色带备选方案.md',
    'docs/SLG/技术方案/面板重绘收敛-2026-08-26.评审合集.md',
  ];
  const 漏 = 靶.filter((p) => 类(p) !== 'zaiban');
  assert.deepStrictEqual(漏, [], '这些方案/评审没被归进「方案与评审」：\n  ' + 漏.join('\n  '));
});

test('守①b 段首那种命名法照旧认（别为了修新的把旧的弄坏）', () => {
  for (const p of [
    'docs/方案-文稿台-2026-08-31.md',
    'docs/评审-席间存照-三评-2026-08-29.md',
    'docs/需求定案-2026-08-25.md',
    'docs/验收-UI巡礼-2026-08-31.md',
    'docs/外审-明箱-2026-08-29.md',
    'docs/想法-随手记.md',
    '设计文档.md',
  ]) {
    assert.strictEqual(类(p, 'terminal'), 'zaiban', p + ' 掉出了「方案与评审」');
  }
});

// ── 二、精度：不许把别人的东西偷过来 ────────────────────────────

test('守② **施工令不许被「评审」两个字偷走**（词在中间不算）', () => {
  // 这四份是真的：名字里有「评审台」，但它们是施工令，改它要走决议。
  for (const p of [
    '工程队/施工令-013-异厂评审台.md',
    '工程队/施工令-016-H90异厂评审接线.md',
    '工程队/施工令-019-评审台红队化.md',
    '工程队/施工令-030-评审台托管消费与巡礼小修.md',
  ]) {
    assert.strictEqual(类(p, 'ticketflow'), 'guizhang',
      p + ' 被归进了「方案与评审」—— 施工令不是方案，改它要走决议');
  }
});

test('守②b 词命中的三条边界（等于 / 结尾 / 开头且只多两个字）', () => {
  // 结尾：色带备选「方案」
  assert.strictEqual(类('Docs/x/色带备选方案.md'), 'zaiban');
  // 开头 + 只多两个字：「评审」意见 / 「评审」合集
  assert.strictEqual(类('Docs/x/某某-评审意见.md'), 'zaiban');
  assert.strictEqual(类('Docs/x/某某-评审合集.md'), 'zaiban');
  // 开头但多太多：「评审」台托管消费与巡礼小修 —— 不算
  assert.notStrictEqual(类('随便/某某-评审台托管消费与巡礼小修.md'), 'zaiban');
  // 词中间：异厂「评审」台 —— 不算
  assert.notStrictEqual(类('随便/异厂评审台.md'), 'zaiban');
});

test('守②c **机器产出的只读留痕不许混进来**（首版把 14 份收口报告收了进去）', () => {
  for (const p of ['项管台账/收口报告-TK-207.md', '项管台账/拆单简报-TK-208.md']) {
    assert.strictEqual(类(p, 'studio'), 'gongdan',
      p + ' 被归进了「方案与评审」—— 它是机器一次性产出的只读留痕');
  }
});

// ── 三、其余类别 ────────────────────────────────────────────────

test('守③ 各类别各归各的', () => {
  const 例 = [
    ['协议库/总监职位章程.md', 'ticketflow', 'guizhang'],
    ['历史库/H108-状态机十二细分.md', 'ticketflow', 'guizhang'],
    ['工程队/施工令-031-甘特岛.md', 'ticketflow', 'guizhang'],
    ['Docs/SLG/架构/项目架构总图.md', 'tk', 'xiangmu'],
    ['packages/watchtower/README.md', 'ticketflow', 'xiangmu'],
    ['班次/2026-08-31-夜.md', 'terminal', 'banbao'],
    ['data/digests/2026-08-31.md', 'terminal', 'banbao'],
    ['白夜馆/2026-08-30-夜班.md', 'studio', 'banbao'],
    ['回执/TK-207.md', 'studio', 'gongdan'],
    ['归档/TK-180.md', 'studio', 'gongdan'],
    ['待重派/TK-999.md', 'studio', 'gongdan'],
  ];
  for (const [p, 根, 期] of 例) {
    assert.strictEqual(类(p, 根), 期, `${根}/${p} 期望 ${期}，实得 ${类(p, 根)}`);
  }
});

test('守③b memory 根整根归记忆库，不看文件名', () => {
  assert.strictEqual(归类('memory', 'MEMORY.md'), 'jiyi');
  // **哪怕名字里带「方案」也一样**——它是我在维护的，不是他要来回改的
  assert.strictEqual(归类('memory', 'C--x/memory/某某方案.md'), 'jiyi');
});

test('守③c 认不出来就说「其它」，不硬塞进某一类', () => {
  assert.strictEqual(类('随便/毫不相干.md'), 'qita');
  assert.strictEqual(类('README.md', 'terminal'), 'qita');
});

// ── 四、表本身 ──────────────────────────────────────────────────

test('守④ 每个类别键都有名字与释文（屏上要说得出这一堆是什么）', () => {
  for (const c of 类别表) {
    assert.ok(c.键 && /^[a-z]+$/.test(c.键), '类别键要是纯小写 ASCII：' + c.键);
    assert.ok(c.名 && c.名.length <= 8, `${c.键} 的名字要短：${c.名}`);
    assert.ok(c.释 && c.释.length >= 6, `${c.键} 没有释文——屏上那一组就成了一个没头没脑的标题`);
    assert.ok((c.配 && c.配.length) || (c.名词 && c.名词.length), `${c.键} 没有任何匹配规则`);
  }
});

test('守④b **类别名不许承诺规则做不到的事**', () => {
  // 首版叫「在办文稿」，而这条规则认得出的是文档的**体裁**，认不出「在不在办」——
  // TK 那 33 份技术方案里有不少早就定案了。名字改成「方案与评审」是为了这个。
  const z = 类别表.find((c) => c.键 === 'zaiban');
  assert.ok(z, '没有 zaiban 这一类');
  assert.ok(!/在办|待办|进行中/.test(z.名),
    `「${z.名}」承诺了时效性，而规则只看文件名的体裁词，判不出在不在办`);
});

test('守⑤ **自证：分类真的在做事**（掏空它，上面那些必须全红）', () => {
  // 这条不是重复——它证的是"分类这件事有没有发生"，而不是某一条分得对不对。
  // 评审当晚的实证是：把 归类() 掏空成永远返回 'qita'，全量 308 条判据仍然全绿。
  const 样 = [
    ['docs/方案-文稿台.md', 'terminal'],
    ['协议库/章程.md', 'ticketflow'],
    ['回执/TK-1.md', 'studio'],
    ['班次/2026-08-31-夜.md', 'terminal'],
    ['Docs/SLG/x.md', 'tk'],
  ];
  const 出 = new Set(样.map(([p, r]) => 归类(r, p)));
  assert.ok(出.size >= 4,
    `五份形态完全不同的文档只分出了 ${出.size} 类（${[...出].join(',')}）—— 分类塌成了单桶`);
  assert.ok(!出.has('qita') || 出.size > 1, '全掉进「其它」等于没分类');
});
