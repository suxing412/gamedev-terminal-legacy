// 事件折叠.test.js — 产线事件流的重复折叠（2026-08-31 晚 · UI 巡礼）
//
// 案源：制作人指着截图说「这种文档堆积不给我分类的情况不要出现」。
// 同一夜实测 /api/events：**40 条事件，去重后只有一种**
// （`值守心跳 seq=1456 应有=7 周期=5m`，seq 每次 +1）。
// 也就是说常驻可见的那一整栏，在用 40 行说同一句「还活着」。
//
// 这违反的是 PRODUCT.md 第一条原则：「状态先于叙述——活着 / 在跑什么 / 谁等我
// 三问必须不用滚动、不用点击就能回答」。四十条心跳把「产线刚发生了什么」
// 这一问的答案埋掉了：**不是没答，是答案被同一句话刷屏刷没了。**
//
// —— 这个文件本身改过一次口径，值得记下来 ——
// 首版里这套逻辑存了两份（服务端一份、前端一份），于是判据的主要工作变成了
// 「把两份都抠出来，证明它们口径一致」。当晚内部评审指出还有**第三、第四份**
// （监视页的服务端渲染与前端重渲染），而且那两份从来没被治过：
// 12 行事件去重只有 5 种，8 行是同一句互保重启对账，
// 唯一那条急件（OAuth 自续连败）只占一行、还被重复渲染了两遍。
//
// 一个概念存四份，就一定会有一天只改了其中两份——同一天、同一个人、同一个晚上。
// 所以现在只有一份：public/事流.js。判据直接 require 它，
// 另有一条判据（守⑦）盯着「不许再冒出第二份」。
'use strict';
const assert = require('node:assert');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const { 事种, 折叠, 拆事, 事条 } = require('../public/事流.js');

const 事 = (时, 文) => ({ 时, 文 });

test('守① **四十条心跳折成一行**（案发时的原始数据）', () => {
  const 们 = [];
  for (let i = 0; i < 40; i++) 们.push(事(`22:${String(59 - i).padStart(2, '0')}`, `值守心跳 seq=${1456 - i} 应有=7 周期=5m`));
  const 出 = 折叠(们);
  assert.strictEqual(出.length, 1, `四十条同种事件折成了 ${出.length} 行`);
  assert.strictEqual(出[0].次, 40);
  assert.strictEqual(出[0].时, '22:59', '折起来那行的时刻该是最近一次');
  assert.strictEqual(出[0].起时, '22:20', '没记住这一串是从什么时候开始的');
});

test('守② **只折相邻的，不跨过中间插进来的别的事**', () => {
  // 「心跳×3 → 一次失败 → 心跳×3」要看得出那次失败夹在中间。
  // 全局归并会把时序抹平，而时序正是事件流的全部价值。
  const 们 = [
    事('22:30', '值守心跳 seq=10 应有=7 周期=5m'),
    事('22:25', '值守心跳 seq=9 应有=7 周期=5m'),
    事('22:20', '值守心跳 seq=8 应有=7 周期=5m'),
    事('22:15', 'TK-207 执行失败：退出码 1'),
    事('22:10', '值守心跳 seq=7 应有=7 周期=5m'),
    事('22:05', '值守心跳 seq=6 应有=7 周期=5m'),
  ];
  const 出 = 折叠(们);
  assert.strictEqual(出.length, 3, '折过头了，把失败两边的心跳并成了一堆：' + JSON.stringify(出.map((x) => x.次)));
  assert.deepStrictEqual(出.map((x) => x.次), [3, 1, 2]);
  assert.ok(/执行失败/.test(出[1].文), '中间那条失败被吃掉了');
});

test('守③ **只抹计数器，不抹别的数字**——不然折叠会悄悄吃掉真值', () => {
  // 首版把**所有**数字归一，于是这两条被判成同一种、折成一行 ×2：
  const 额度 = [事('12:05', '额度余额=10'), 事('12:00', '额度余额=10000')];
  assert.strictEqual(折叠(额度).length, 2,
    '余额从 10000 跌到 10 被折成了一行——用户既看不到跌了，也不知道那行显示的是哪一次');

  // 单号也一样：两张不同的单完成了，是两件事
  const 单 = [事('22:30', 'TK-207 执行完成'), 事('22:29', 'TK-208 执行完成')];
  assert.strictEqual(折叠(单).length, 2, '两张不同的单被折成一行，屏上就看不出是哪几张');

  // job 号不同的部署同理
  const 部署 = [事('22:30', '部署 job=7411 重试=2'), 事('22:29', '部署 job=7412 重试=2')];
  assert.strictEqual(折叠(部署).length, 2);

  // 而形状明确是计数器的那几个键**要**抹——心跳靠它折
  const 心 = [事('22:30', '值守心跳 seq=1461 应有=7 周期=5m'), 事('22:25', '值守心跳 seq=1460 应有=7 周期=5m')];
  assert.strictEqual(折叠(心).length, 1, 'seq= 是计数器，该折');

  // 动作不同就不是同种
  assert.strictEqual(折叠([事('22:30', 'TK-207 执行完成'), 事('22:29', 'TK-207 执行失败')]).length, 2);
});

test('守③b 服务端已经折过的 次 要认下来，不能从 1 重新数', () => {
  // /api/events 现在在 600 行的大窗口上先折一轮再返回（不然故障会被心跳挤出窗口）。
  // 前端若无视那个 次，服务端折掉的那些就凭空少了——**屏上的数字会小于事实**。
  const 出 = 折叠([
    { 时: '22:30', 起时: '20:00', 文: '值守心跳 seq=100 周期=5m', 次: 30 },
    { 时: '19:55', 起时: '18:00', 文: '值守心跳 seq=70 周期=5m', 次: 24 },
  ]);
  assert.strictEqual(出.length, 1, '两段同种没合起来');
  assert.strictEqual(出[0].次, 54, `次 应当是 30+24=54，实得 ${出[0].次}`);
  assert.strictEqual(出[0].起时, '18:00', '起时 该取更早那一段的起点');
});

test('守③c **全库只许有一份 事种/折叠**（这个错犯过一次：四份里只治了两份）', () => {
  // 首版判据的工作是"证明两份口径一致"。评审指出还有第三第四份，而那两份从没被治过。
  // 与其比对 N 份，不如让 N=1，再用一条判据钉住它别再长出来。
  const 根 = path.join(__dirname, '..');
  const 犯 = [];
  const 走 = (d) => {
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      if (f.name === 'node_modules' || f.name === '.git' || f.name === 'test') continue;
      const p2 = path.join(d, f.name);
      if (f.isDirectory()) { 走(p2); continue; }
      if (!f.name.endsWith('.js')) continue;
      if (p2.endsWith(path.join('public', '事流.js'))) continue;
      const 文 = fs.readFileSync(p2, 'utf8');
      文.split(/\r?\n/).forEach((l, i) => {
        if (l.trim().startsWith('//') || l.trim().startsWith('*')) return;
        // 又写了一份「事种」的定义，或又手搓了一遍计数器归一
        const 又定义 = /(const|function)\s+事种\s*[=(]/.test(l);
        const 又手搓 = /replace\([^)]*(seq|序号|次序)/.test(l);
        if (又定义 || 又手搓) 犯.push(path.relative(根, p2) + ':' + (i + 1) + '  ' + l.trim().slice(0, 90));
      });
    }
  };
  走(根);
  assert.deepStrictEqual(犯, [],
    '这些地方又长出了一份事种/归一实现：\n  ' + 犯.join('\n  ')
    + '\n（唯一那一份在 public/事流.js）');
});

test('守③d 四处用的都是那一份（少接一处，那一处就会继续刷屏）', () => {
  const 根 = path.join(__dirname, '..');
  const 用 = [
    ['server.js', /require\(['"]\.\/public\/事流\.js['"]\)/],
    [path.join('public', 'app.js'), /self\.事流/],
    [path.join('server', 'routes', '监视.js'), /require\([^)]*事流\.js[^)]*\)/],
    [path.join('public', '监视.js'), /self\.事流/],
  ];
  for (const [f, re] of 用) {
    const 文 = fs.readFileSync(path.join(根, f), 'utf8');
    assert.match(文, re, `${f} 没接上共用的 事流.js`);
  }
  // 监视页的两处渲染要同源：拆 → 折 → 画三步都走同一份
  for (const f of [path.join('server', 'routes', '监视.js'), path.join('public', '监视.js')]) {
    const 文 = fs.readFileSync(path.join(根, f), 'utf8');
    assert.match(文, /事流\.折叠\(事流\.拆事\(/, `${f} 的事件流没有折叠`);
    assert.match(文, /事流\.事条/, `${f} 没用共用的渲染，两处画得会不一样`);
  }
});

test('守④ 空输入回空数组，不抛', () => {
  assert.deepStrictEqual(折叠([]), []);
  assert.deepStrictEqual(折叠(null), []);
  assert.deepStrictEqual(折叠(undefined), []);
});

test('守⑤ 单条不加计数（×1 是噪声）', () => {
  const 出 = 折叠([事('22:30', '只有这一条')]);
  assert.strictEqual(出.length, 1);
  assert.strictEqual(出[0].次, 1, '单条的次数该是 1，渲染时据此不画 ×N');
});

test('守⑥ 渲染：×N 只在 次>1 时画（每行挂个 ×1 是纯噪声）', () => {
  // 共用的那份渲染（事条）可以直接调，比读源码强
  const 单 = 事条({ 时: '22:30', 起时: '22:30', 文: '只有这一条', 次: 1 });
  assert.ok(!/×/.test(单), '单条也画了 ×N：' + 单);
  assert.ok(!/fold/.test(单), '单条不该带折叠样式');

  const 多 = 事条({ 时: '22:30', 起时: '21:00', 文: '值守心跳', 次: 17 });
  assert.match(多, /×17/, '折起来的没画次数');
  assert.match(多, /21:00.*22:30/, '折起来的要讲清从什么时候到什么时候');
  assert.match(多, /fold/);

  const 急 = 事条({ 时: '22:30', 起时: '22:30', 文: 'OAuth 已过期', 次: 1, 级: '急' });
  assert.match(急, /urg/, '急件没标出来');
});

test('守⑥b 渲染要转义（事件正文来自 journal，不是可信输入）', () => {
  const h = 事条({ 时: '00:00', 起时: '00:00', 文: '<img src=x onerror=alert(1)>', 次: 1 });
  assert.ok(!h.includes('<img'), '正文没转义：' + h);
  assert.match(h, /&lt;img/);
});

test('守⑥c 拆事：认得出监视页那种行格式，认不出也不许丢掉整行', () => {
  const [a] = 拆事(['[2026-08-31 03:49] [瞭望塔] 急 值守 | 塔阵亡：连续 290 拍无在位回执']);
  assert.strictEqual(a.时, '03:49');
  assert.strictEqual(a.级, '急');
  assert.match(a.文, /塔阵亡/);
  // 格式不对的行：**原样留着**，不能因为正则没匹配上就把这一行吞掉
  const [b] = 拆事(['这一行完全不合格式']);
  assert.strictEqual(b.文, '这一行完全不合格式');
  assert.strictEqual(b.级, '常');
});

test('守⑥d 右栏空态与「读不到」分得开（前者是好消息，后者是故障）', () => {
  const 源 = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  assert.ok(/事空/.test(源) && /不是读不到/.test(源),
    '空态没说清「不是读不到，是真的没动静」——这两件事在值班屏上混不得');
  assert.ok(/读不到/.test(源), '读不到那条分支不见了');
});
