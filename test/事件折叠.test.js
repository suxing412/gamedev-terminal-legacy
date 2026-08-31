// 事件折叠.test.js — 右栏事件流的重复折叠（2026-08-31 晚 · UI 巡礼）
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
// 折叠逻辑写在 public/app.js（浏览器脚本，无模块导出），这里把它按同一份源码
// 抠出来跑——**不是抄一份**：抠不出来（函数被改名或删掉）判据就红，
// 抄一份的话源码改了判据还是绿的，那就成了又一条假判据。
'use strict';
const assert = require('node:assert');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const 源 = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');

function 抠(名) {
  const i = 源.indexOf(`function ${名}(`);
  assert.ok(i >= 0, `app.js 里找不到 ${名}()——折叠逻辑被改名或删掉了`);
  // 从函数头一直取到下一个顶层 `\n}` 收尾
  const 尾 = 源.indexOf('\n}', i);
  assert.ok(尾 > i, `${名}() 的结尾找不到`);
  return 源.slice(i, 尾 + 2);
}

const 事种源 = (() => {
  const i = 源.indexOf('const 事种 =');
  assert.ok(i >= 0, 'app.js 里找不到 事种()');
  return 源.slice(i, 源.indexOf(';', 源.indexOf('.trim()', i)) + 1);
})();

// eslint-disable-next-line no-new-func
const 折叠 = new Function(`${事种源}\n${抠('折叠')}\nreturn 折叠;`)();

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

test('守③ 不同事件不许被折在一起（数字归一不能归过头）', () => {
  const 们 = [
    事('22:30', 'TK-207 执行完成'),
    事('22:29', 'TK-208 执行完成'),
  ];
  // 这两条**是**同种（单号是数字，归一后一样）——折起来是对的：
  // 「两张单执行完成」比两行更接近事实的形状。
  assert.strictEqual(折叠(们).length, 1);

  // 但动作不同就不是同种
  const 们2 = [事('22:30', 'TK-207 执行完成'), 事('22:29', 'TK-207 执行失败')];
  assert.strictEqual(折叠(们2).length, 2, '完成与失败被折在一起了');
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

test('守⑥ 渲染侧：×N 只在 次>1 时画，且空态说得清「不是读不到」', () => {
  // 这两条在 app.js 的渲染分支里，抠函数抠不到，改用源码断言——
  // 但断言的是**行为契约**而不是随便一段文本：
  // ① 计数必须挂在 次 > 1 上（否则每行都挂一个 ×1）
  // ② 空态必须与「读不到」分开（前者是好消息，后者是故障，值班屏上不能混）
  assert.ok(/e\.次\s*>\s*1/.test(源), '×N 没有挂在 次>1 的条件上');
  assert.ok(/事空/.test(源) && /不是读不到/.test(源),
    '空态没说清「不是读不到，是真的没动静」——这两件事在值班屏上混不得');
  assert.ok(/读不到/.test(源), '读不到那条分支不见了');
});
