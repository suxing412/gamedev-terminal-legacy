// 原始流筛.test.js — 原始流页的筛选与空态。
//
// 案发（2026-08-31 内部评审 S11）：`public/stream.js` 只做到「整组被筛空就收起组标题」，
// **全部组都空的时候这一层没人接住**。实测选「Game Developer + B 档」→
// 可见条目 0、`main.wrap` 里除筛选栏外一片空白，唯一的信号是右端 11px 的「0 条（共 33）」。
//
// 而文稿台同一夜刚为同一件事补过 `.稿筛空` + 「清掉筛选」，注释写着
// 「空白在值班屏上永远读作『它坏了』」——**那条结论没传到隔壁这一页**。
//
// 这个文件给 stream.js 搭一个够用的小 DOM 真跑一遍，不靠读源码。
'use strict';
const assert = require('node:assert');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// ── 够用的小 DOM ──────────────────────────────────────────────────
// 只实现 stream.js 真用到的那几样：id 取元素、类选择、dataset、hidden、
// value/checked、addEventListener + 手动派发。**不追求像浏览器，追求能验出行为。**
function 造DOM(条目) {
  const 听 = new Map();
  const 元 = (标, 属 = {}) => ({
    tagName: 标, hidden: false, textContent: '', dataset: {}, value: '', checked: false,
    _类: new Set(), ...属,
    focus() {}, blur() {},
    addEventListener(t, f) { 听.set(this, (听.get(this) || []).concat([[t, f]])); },
    派发(t) { for (const [tt, f] of (听.get(this) || [])) if (tt === t) f(); },
  });

  const 项 = 条目.map((c) => {
    const e = 元('li'); e.dataset = { src: c.src, tier: c.tier, in: c.in }; e._组 = c.grp; return e;
  });
  const 组名 = [...new Set(条目.map((c) => c.grp))];
  const 组 = 组名.map((g) => {
    const e = 元('section'); e._名 = g;
    e.querySelector = (sel) => {
      if (sel === '.item:not([hidden])') return 项.find((x) => x._组 === g && !x.hidden) || null;
      return null;
    };
    return e;
  });

  const id = {
    'f-src': 元('select'), 'f-tier': 元('select'), 'f-in': 元('input'),
    'f-count': 元('span'), 'f-clr': 元('button'), 'f-empty': 元('p'),
  };
  id['f-clr'].hidden = true;
  id['f-empty'].hidden = true;

  const doc = {
    getElementById: (k) => id[k] || null,
    querySelectorAll: (s) => (s === '.item' ? 项 : s === '.grp' ? 组 : []),
    addEventListener() {},
  };
  return { doc, id, 项, 组 };
}

function 跑(条目) {
  const { doc, id, 项, 组 } = 造DOM(条目);
  const ctx = vm.createContext({ document: doc, console: { log() {}, warn() {} } });
  const 源 = fs.readFileSync(path.join(__dirname, '..', 'public', 'stream.js'), 'utf8');
  vm.runInContext(源, ctx, { filename: 'public/stream.js' });
  const 改 = (k, v) => {
    if (k === 'f-in') id[k].checked = v; else id[k].value = v;
    id[k].派发('change');
  };
  return {
    id, 项, 组, 改,
    见: () => 项.filter((x) => !x.hidden).length,
    见组: () => 组.filter((x) => !x.hidden).length,
    点清: () => id['f-clr'].派发('click'),
  };
}

const 语料 = [
  { src: 'gd', tier: 'A', in: '1', grp: 'g1' },
  { src: 'gd', tier: 'A', in: '0', grp: 'g1' },
  { src: 'itch', tier: 'B', in: '0', grp: 'g2' },
  { src: 'itch', tier: 'C', in: '1', grp: 'g2' },
];

// ── 一、筛选本身还得好使 ────────────────────────────────────────

test('守① 不筛时全都在，组也都在', () => {
  const t = 跑(语料);
  assert.strictEqual(t.见(), 4);
  assert.strictEqual(t.见组(), 2);
  assert.strictEqual(t.id['f-count'].textContent, '4 条');
});

test('守②按源筛、按档筛、只看已入报，三个都生效且叠加', () => {
  const t = 跑(语料);
  t.改('f-src', 'gd');
  assert.strictEqual(t.见(), 2);
  t.改('f-tier', 'A');
  assert.strictEqual(t.见(), 2);
  t.改('f-in', true);
  assert.strictEqual(t.见(), 1);
  assert.match(t.id['f-count'].textContent, /1 条（共 4）/);
});

test('守③ 整组被筛空，组标题跟着收起（只剩标题的空组会让人以为筛坏了）', () => {
  const t = 跑(语料);
  t.改('f-src', 'gd');
  assert.strictEqual(t.见组(), 1, 'g2 该被收起来');
});

// ── 二、全部筛空：这次要治的那一条 ──────────────────────────────

test('守④ **一条不剩时要说话，不许留一整片空白**', () => {
  const t = 跑(语料);
  t.改('f-src', 'gd');
  t.改('f-tier', 'B');            // gd 里没有 B 档
  assert.strictEqual(t.见(), 0, '前提：这组筛选确实一条都不剩');
  assert.strictEqual(t.id['f-empty'].hidden, false,
    '**筛完一条不剩，页面上除了筛选栏什么都没有**——空白在值班屏上永远读作「它坏了」');
  assert.ok(t.id['f-empty'].textContent.length > 10, '空态说了句什么，但太短：' + t.id['f-empty'].textContent);
});

test('守④b 空态要说清「数据是有的，是筛选把它们挡住了」，并报出用了哪几条筛', () => {
  const t = 跑(语料);
  t.改('f-src', 'gd');
  t.改('f-tier', 'B');
  t.改('f-in', true);
  const 话 = t.id['f-empty'].textContent;
  assert.match(话, /4/, '没说总共有多少条');
  assert.match(话, /gd/, '没说是哪个源');
  assert.match(话, /B/, '没说是哪个档位');
  assert.match(话, /已入报/, '没说勾了只看已入报');
  assert.match(话, /挡住/, '没说清是筛选挡住的，而不是没有数据');
});

test('守④c 一条不剩之外的情形不许喊空（平时不出现）', () => {
  const t = 跑(语料);
  assert.strictEqual(t.id['f-empty'].hidden, true, '不筛的时候就喊空');
  t.改('f-src', 'gd');
  assert.strictEqual(t.id['f-empty'].hidden, true, '还剩 2 条却喊空');
});

test('守④d 本来就一条数据都没有的日子，不喊「筛选挡住了」', () => {
  // 那是另一件事：**没有数据** ≠ **被筛掉了**。这两句在值班屏上不能混。
  const t = 跑([]);
  assert.strictEqual(t.见(), 0);
  assert.strictEqual(t.id['f-empty'].hidden, true,
    '一条数据都没有的日子，喊「是筛选把它们挡住了」是撒谎');
});

// ── 三、出口 ────────────────────────────────────────────────────

test('守⑤ **清掉筛选**只在筛着东西时出现，点了真的全清', () => {
  const t = 跑(语料);
  assert.strictEqual(t.id['f-clr'].hidden, true, '没筛东西却常驻一个灰按钮 —— 那是背景噪音');
  t.改('f-src', 'gd');
  assert.strictEqual(t.id['f-clr'].hidden, false, '筛着东西却没给出口');
  t.改('f-tier', 'B');
  assert.strictEqual(t.见(), 0);
  t.点清();
  assert.strictEqual(t.见(), 4, '点了清筛选没恢复');
  assert.strictEqual(t.id['f-clr'].hidden, true);
  assert.strictEqual(t.id['f-empty'].hidden, true);
});

test('守⑤b 恢复钮不许在最需要它的那一刻被藏起来', () => {
  // 文稿台犯过这个（评审 S6）：清筛的两个入口在无筛时都被 hidden 掉，
  // 而那正是组展开态错乱、最需要它的时刻。这里反过来钉住：**一条不剩时它必须在**。
  const t = 跑(语料);
  t.改('f-src', 'gd');
  t.改('f-tier', 'B');
  assert.strictEqual(t.见(), 0);
  assert.strictEqual(t.id['f-clr'].hidden, false, '筛到一条不剩，而清筛选钮是藏着的');
});

// ── 四、页面上要有这两个位置 ────────────────────────────────────

test('守⑥ 服务端渲染的筛选栏里有空态位与清筛钮（没有的话前端拿不到它们）', () => {
  const 源 = fs.readFileSync(path.join(__dirname, '..', 'server', 'routes', 'views.js'), 'utf8');
  assert.match(源, /id="f-clr"/, 'views.js 没渲染清筛钮');
  assert.match(源, /id="f-empty"/, 'views.js 没渲染空态位');
  assert.match(源, /id="f-clr"[^>]*hidden/, '清筛钮默认要是隐藏的');
});
