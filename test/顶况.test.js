// 顶况.test.js — 顶栏读数的写法。
//
// 顶栏是这块屏上唯一一处**一直在视野里**的地方。它写错一个字，
// 人就会照着错的那个字安排接下来一小时。2026-08-31 巡礼实测抓到两条：
//   ① 登录还剩 40 分钟，屏上写「登录 0h」——`Math.floor(40/60)`。
//      小于一小时的整个区间（也正是唯一要紧的那个区间）被压成一个读着像零的数。
//      而横幅的临期线是 30 分：30–59 分之间，顶栏喊 0、横幅说没事，同一份数据两种说法。
//   ② 额度只报周窗口，还把「（09-04 19:00 重置）」整串摆出来——实测 197px，
//      占整条顶况的 31%；而当下真正会把人拦住的 5 小时窗口一个字都没有。
'use strict';
const assert = require('node:assert');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const { 登录文, 额度文, 报重置线 } = require('../public/顶况.js');

// ── 一、登录 ──────────────────────────────────────────────────

test('守① **40 分钟不许写成 0h**（案发现场原样：/api/cred 回 剩余分=40）', () => {
  const s = 登录文('有效', 40);
  assert.ok(!/\b0h/.test(s), `实得「${s}」—— 0h 读起来就是"已经没了"`);
  assert.match(s, /40/, '要把 40 这个数说出来');
  assert.match(s, /分/, '小于一小时就该用分钟这个刻度');
});

test('守①b 小于一小时的**整个区间**都要说得出话来', () => {
  for (const m of [1, 5, 29, 30, 31, 45, 59]) {
    const s = 登录文('有效', m);
    assert.ok(!/\b0h/.test(s), `${m} 分写成了「${s}」`);
    assert.ok(s.includes(String(m)), `${m} 分写成了「${s}」，看不出还剩多少`);
  }
});

test('守①c 与横幅的临期线不许各说各的（30 分是同一条线）', () => {
  // 横幅在 剩余分 < 30 时出现。顶栏在 30–59 分必须仍报得出真实分钟数，
  // 否则会出现「顶栏喊 0h、横幅说没事」这种同源两说。
  for (const m of [30, 40, 59]) {
    assert.match(登录文('有效', m), new RegExp(`${m} 分`), `${m} 分没如实报`);
  }
});

test('守①d 一个半小时以上才换成小时刻度，且不许丢精度到看不出差别', () => {
  assert.match(登录文('有效', 90), /1\.5h/);
  assert.match(登录文('有效', 200), /3\.3h/);
  assert.match(登录文('有效', 700), /12h/, '十小时以上就没必要报小数了');
  assert.notStrictEqual(登录文('有效', 90), 登录文('有效', 150), '1.5h 与 2.5h 不能写成同一串');
});

test('守①e 非有效态照实说，不拿分钟数糊弄', () => {
  assert.strictEqual(登录文('过期', -12), '登录过期');
  assert.strictEqual(登录文('临期', 12), '登录临期');
  assert.strictEqual(登录文('未登录', null), '登录未登录');
  assert.strictEqual(登录文('有效', null), '登录—', '态说有效但没有数字时，只能说不知道');
  assert.strictEqual(登录文('有效', 0), '登录已过期');
});

// ── 二、额度 ──────────────────────────────────────────────────

const 窗 = (l, p, r) => ({ label: l, pct: p, reset: r });
const 现场 = [窗('5小时', 15, '09-01 01:50'), 窗('周', 21, '09-04 19:00')];

test('守② **5 小时窗口必须出现**（它才是当下会把人拦住的那道）', () => {
  const r = 额度文(现场);
  assert.match(r.文, /5h 15%/, `实得「${r.文}」—— 只报周窗口等于把当下那道闸藏起来`);
  assert.match(r.文, /周 21%/);
});

test('守②b 低水位时不摆重置时刻（21% 的时候它是噪音，还占着顶栏三分之一）', () => {
  const r = 额度文(现场);
  assert.ok(!r.文.includes('重置'), `实得「${r.文}」`);
  assert.ok(!/09-04|01:50/.test(r.文), '重置时刻不该出现在正文里');
  assert.strictEqual(r.紧, null);
  // 但它不许消失——挪进 title，要的时候还够得着
  assert.match(r.详, /09-04 19:00/);
  assert.match(r.详, /01:50/);
});

test('守②c **快撞顶时重置时刻要摆出来**（这时"什么时候恢复"才是那个问题）', () => {
  const 高 = [窗('5小时', 92, '09-01 01:50'), 窗('周', 21, '09-04 19:00')];
  const r = 额度文(高);
  assert.match(r.文, /01:50 重置/, `实得「${r.文}」`);
  assert.strictEqual(r.紧, '5小时');
  assert.ok(!r.文.includes('09-04'), '只摆快撞顶那一个的重置时刻，两个都摆就回到原来的宽度问题上去了');
});

test('守②d 两个都过线时，摆水位最高那个的', () => {
  const r = 额度文([窗('5小时', 75, 'A'), 窗('周', 96, 'B')]);
  assert.strictEqual(r.紧, '周');
  assert.match(r.文, /B 重置/);
});

test('守②e 线就在 70 上（69 不摆、70 摆）', () => {
  assert.strictEqual(额度文([窗('周', 69, 'X')]).紧, null);
  assert.strictEqual(额度文([窗('周', 70, 'X')]).紧, '周');
  assert.strictEqual(报重置线, 70);
  // 线可传入覆盖
  assert.strictEqual(额度文([窗('周', 50, 'X')], 40).紧, '周');
});

test('守②f 没有窗口就说没有，不显示一个 0%', () => {
  assert.strictEqual(额度文([]).文, '额度—');
  assert.strictEqual(额度文(null).文, '额度—');
  assert.ok(!/0%/.test(额度文([]).文), 'PRODUCT 原则五：读不到就说读不到，绝不拿 0 冒充');
});

// ── 三、接线 ──────────────────────────────────────────────────

test('守③ app.js 用的是这一份，没有自己再写一份', () => {
  const s = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  assert.match(s, /self\.顶况/, 'app.js 没有引用 public/顶况.js');
  assert.ok(!/Math\.floor\(c\.剩余分 \/ 60\)/.test(s), '那行把 40 分钟写成 0h 的代码还在');
  assert.ok(!/周额度 \$\{周\.pct\}%/.test(s), '只报周窗口的旧写法还在');
});

test('守③c **整份窗口原样交出去**，调用处不许先挑一道', () => {
  // 挑哪个窗口、怎么写，是 顶况.js 一处的决定（守②系列在盯着它）。
  // 调用处再滤一次，等于把同一个决定放在两个地方，而其中一处没有任何判据看着——
  // 「只报周窗口」这个毛病就能原封不动地从这里回来。
  const s = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  const i = s.indexOf('顶况文.额度文(');
  assert.ok(i > 0, '找不到 额度文 的调用');
  const 实参 = s.slice(i + '顶况文.额度文('.length, s.indexOf(');', i));
  assert.ok(!/\.filter\(|\.find\(|label\s*===/.test(实参),
    `调用处挑了窗口：额度文(${实参}) —— 挑选只能发生在 顶况.js 里`);
});

test('守③b 顶况.js 在 index.html 里排在 app.js 之前', () => {
  const h = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const a = h.indexOf('顶况.js'); const b = h.indexOf('src="app.js"');
  assert.ok(a >= 0, 'index.html 没引 顶况.js —— app.js 顶层解构会炸，整个前端不跑');
  assert.ok(a < b, '顶况.js 必须排在 app.js 之前');
});
