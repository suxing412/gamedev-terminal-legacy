// 文稿筛.test.js — 文稿台的筛选状态机。
//
// 两条案（2026-08-31 内部评审 S3 / S6），都是**界面在撒谎**那一型：
//
// S3 · 回车搜正文静默丢弃已开的筛选，而钮还亮着。
//   `只留()` 完全不读 筛.记号 / 筛.可写 / 筛.类，也不走 说筛()。
//   实测：开「有记号 + 在办文稿」后回车搜「协议」→ 94 条结果里
//   93 条无记号、89 条不属在办，两颗钮仍是高亮开态，计数条写「94 份含『协议』」。
//   **数字是真的，口径是假的**——94 被摆在两颗亮钮下面，读作
//   「有记号 ∧ 在办 ∧ 协议 = 94」。
//
// S6 · 筛选钮一开一关之后，组展开态不复位，而界面此刻宣称「无筛选」。
//   `应用筛()` 只在有筛选时写 组.open，清空那一支整段跳过、没有 else。
//   实测 2560×1440：初始 2.0 屏 → 点「可写」15.8 屏 → 再点关掉 **30.3 屏**，
//   而计数条恢复成默认那句、清筛选钮 hidden——
//   **恢复的出口恰在最需要它的那一刻被藏起来。**
//
// 这个文件给 文稿.js 搭一个够用的小 DOM 真跑一遍，不靠读源码。
'use strict';
const assert = require('node:assert');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// ── 够用的小 DOM ──────────────────────────────────────────────────
function 造DOM(文档们, 默认开类) {
  const 听 = new Map();
  const 基 = () => ({
    hidden: false, open: false, textContent: '', value: '', _属: {}, _类: new Set(),
    classList: {
      add(c) { this._e._类.add(c); }, remove(c) { this._e._类.delete(c); },
      contains(c) { return this._e._类.has(c); },
      toggle(c, on) { const v = on === undefined ? !this._e._类.has(c) : !!on; if (v) this._e._类.add(c); else this._e._类.delete(c); return v; },
    },
    getAttribute(k) { return k in this._属 ? this._属[k] : null; },
    setAttribute(k, v) { this._属[k] = String(v); },
    focus() {}, blur() {},
    appendChild(c) { (this._子 = this._子 || []).push(c); },
    querySelector() { return null; },
    addEventListener(t, f) { 听.set(this, (听.get(this) || []).concat([[t, f]])); },
    派发(t, e) { for (const [tt, f] of (听.get(this) || [])) if (tt === t) f(e || { preventDefault() {}, target: this, key: '' }); },
  });
  const 元 = (属 = {}) => { const e = 基(); e.classList._e = e; Object.assign(e._属, 属); return e; };

  const 项 = 文档们.map((d) => 元({
    'data-路': d.路, 'data-记': d.记 ? '1' : '0', 'data-可写': d.可写 ? '1' : '0',
  }).__proto__ === undefined ? null : (() => {
    const e = 元({ 'data-路': d.路, 'data-记': d.记 ? '1' : '0', 'data-可写': d.可写 ? '1' : '0' });
    e._类文 = d.类; return e;
  })());

  const 类们 = [...new Set(文档们.map((d) => d.类))];
  const 组 = 类们.map((k) => {
    const g = 元({ 'data-类': k });
    g.open = 默认开类.includes(k);
    return g;
  });

  const 框 = 元(); const 计 = 元(); 计.textContent = '956 份 · 500 可写 · 3 份有记号';
  const 筛清 = 元(); 筛清.hidden = true;
  const 稿列 = 元();
  const 稿库 = 元();
  const 台 = 元();

  const 选 = (sel, 内) => {
    if (sel === '.稿组') return 组;
    if (sel === '.稿项') {
      if (内 && 内._属 && 内._属['data-类']) return 项.filter((x) => x._类文 === 内._属['data-类']);
      return 项;
    }
    if (sel === '.筛钮, .类筛钮') return [];
    if (sel === '.类筛钮') return [];
    return [];
  };
  const byId = { 稿搜框: 框, 稿计: 计, 筛清, 稿列, 筛记号: 元(), 筛可写: 元(), 稿库钮: null, 类筛: null };
  台.querySelector = (s) => (s === '.稿库' ? 稿库 : s === '.稿筛空' ? null : null);
  稿列.querySelector = () => null;

  const doc = {
    getElementById: (k) => byId[k] || null,
    querySelector: (s) => (s === '.稿台' ? 台 : s.startsWith('#') ? byId[s.slice(1)] || null : null),
    querySelectorAll: (s) => 选(s),
    createElement: () => 元(),
    addEventListener() {},
    body: 元(),
  };
  台.querySelectorAll = (s) => 选(s);
  for (const g of 组) g.querySelectorAll = (s) => 选(s, g);
  return { doc, 台, 框, 计, 筛清, 项, 组, byId };
}

function 跑(文档们, 默认开类 = ['zaiban'], 搜结果 = null) {
  const D = 造DOM(文档们, 默认开类);
  // querySelectorAll 在 文稿.js 里是 $$(sel, 根) —— 根缺省是 document
  const 请求 = [];
  const ctx = vm.createContext({
    document: D.doc,
    localStorage: { getItem: () => null, setItem() {} },
    fetch: (u) => { 请求.push(u); return Promise.resolve({ json: () => Promise.resolve(搜结果 || { 行: true, 命中: [], 总: 0, 余: 0 }) }); },
    console: { log() {}, warn() {}, error() {} },
    setTimeout: (f) => { void f; return 1; }, clearTimeout() {},
    CustomEvent: class { constructor(t) { this.type = t; } },
    Promise, JSON, Set, Map, String, Number, Array, Object, Math, Date, RegExp, Error,
  });
  ctx.addEventListener = () => {};
  ctx.removeEventListener = () => {};
  ctx.dispatchEvent = () => true;
  ctx.matchMedia = () => ({ matches: false, addEventListener() {}, addListener() {} });
  ctx.getComputedStyle = () => ({ getPropertyValue: () => '' });
  ctx.requestAnimationFrame = (f) => { void f; return 1; };
  ctx.window = ctx; ctx.self = ctx; ctx.globalThis = ctx;
  const 源 = fs.readFileSync(path.join(__dirname, '..', 'public', '文稿.js'), 'utf8');
  vm.runInContext(源, ctx, { filename: 'public/文稿.js' });
  return {
    ...D, 请求,
    见: () => D.项.filter((x) => !x.hidden).length,
    开组: () => D.组.filter((g) => g.open).map((g) => g._属['data-类']),
    输入: (v) => { D.框.value = v; D.框.派发('input'); },
    回车: async (v) => {
      D.框.value = v;
      D.框.派发('keydown', { key: 'Enter', preventDefault() {}, target: D.框 });
      await new Promise((r) => process.nextTick(r));
      await new Promise((r) => process.nextTick(r));
      await new Promise((r) => process.nextTick(r));
    },
    点记号: () => D.byId['筛记号'].派发('click', { target: D.byId['筛记号'], preventDefault() {} }),
  };
}

const 语料 = [
  { 路: 'terminal/docs/方案-甲.md', 类: 'zaiban', 记: true, 可写: true },
  { 路: 'terminal/docs/方案-乙.md', 类: 'zaiban', 记: false, 可写: true },
  { 路: 'studio/回执/tk-1.md', 类: 'gongdan', 记: false, 可写: false },
  { 路: 'studio/回执/tk-2.md', 类: 'gongdan', 记: false, 可写: false },
  { 路: 'ticketflow/协议库/章程.md', 类: 'guizhang', 记: true, 可写: true },
];

// ── 一、S6：筛一开一关，展开态要复位 ────────────────────────────

test('守① **筛选清空后，组展开态回到默认**（此前 2.0 屏 → 30.3 屏）', () => {
  const t = 跑(语料, ['zaiban']);
  assert.deepStrictEqual(t.开组(), ['zaiban'], '初始只该开在办那一组');

  t.输入('回执');                       // 开筛：命中在 gongdan
  assert.ok(t.开组().includes('gongdan'), '筛中的组该摊开');

  t.输入('');                           // 关筛
  assert.deepStrictEqual(t.开组(), ['zaiban'],
    '**清空筛选后每个组都还开着**，而界面此刻宣称「无筛选」——'
    + '实得 ' + JSON.stringify(t.开组()));
});

test('守①b 默认展开态取自服务端渲染的那一份，不写死 zaiban', () => {
  // 服务端哪天把默认改成「方案与评审 + 规章」，这里要跟着，不能各走各的
  const t = 跑(语料, ['zaiban', 'guizhang']);
  t.输入('回执');
  t.输入('');
  assert.deepStrictEqual(t.开组().sort(), ['guizhang', 'zaiban'],
    '默认展开态被写死成了 zaiban，服务端改了它不跟');
});

// ── 二、S3：正文搜索必须并进同一条筛 ────────────────────────────

test('守② **回车搜正文不许把已开的筛静默作废**', async () => {
  const t = 跑(语料, ['zaiban'], {
    行: true, 总: 3, 余: 0,
    命中: [
      { 根: 'studio', 相对: '回执/tk-1.md' },      // 无记号
      { 根: 'studio', 相对: '回执/tk-2.md' },      // 无记号
      { 根: 'ticketflow', 相对: '协议库/章程.md' }, // 有记号
    ],
  });
  t.点记号();                       // 只看有记号：应剩 2 份
  assert.strictEqual(t.见(), 2, '前提：记号筛先要生效');

  await t.回车('协议');
  assert.ok(t.请求.some((u) => String(u).includes('/api/doc/search')), '没去搜正文');
  // 三条正文命中里只有一条有记号 —— 记号筛必须仍然管用
  assert.strictEqual(t.见(), 1,
    '**正文搜索把记号筛作废了**：三条命中全放行，而那颗钮还亮着。实得 ' + t.见());
});

test('守②b 计数条要说清这一屏是按什么口径数出来的', async () => {
  const t = 跑(语料, ['zaiban'], {
    行: true, 总: 3, 余: 0,
    命中: [{ 根: 'ticketflow', 相对: '协议库/章程.md' }],
  });
  t.点记号();
  await t.回车('协议');
  const 文 = t.计.textContent;
  assert.match(文, /有记号/, '计数条没说这个数是在「有记号」这个筛下面数出来的：' + 文);
  assert.match(文, /协议/, '没说词是什么：' + 文);
  assert.match(文, /正文/, '没说这次连正文一起搜了：' + 文);
});

test('守②c 服务端只回前 N 条时，要说出总共几条', async () => {
  const t = 跑(语料, ['zaiban'], {
    行: true, 总: 207, 余: 147,
    命中: [{ 根: 'studio', 相对: '回执/tk-1.md' }],
  });
  await t.回车('协议');
  assert.match(t.计.textContent, /207/,
    '**只给 60 条而不说总共几条，读起来就是「只有这么多」**：' + t.计.textContent);
});

test('守②d 改一个字，上一次的正文命中就作废（不然它会继续放行那批文件）', async () => {
  // 词故意选一个**任何路径里都没有**的（'雷火'），这样命中只可能来自正文，
  // 不会混进文件名命中——那会让这条判据验的东西变模糊。
  const t = 跑(语料, ['zaiban'], {
    行: true, 总: 2, 余: 0,
    命中: [{ 根: 'studio', 相对: '回执/tk-1.md' }, { 根: 'studio', 相对: '回执/tk-2.md' }],
  });
  await t.回车('雷火');
  assert.strictEqual(t.见(), 2, '前提：正文命中两份（实得 ' + t.见() + '）');
  t.输入('雷火xyz');
  assert.strictEqual(t.见(), 0,
    '**改了词，上一次的正文命中还在放行那两份**——屏上会是「搜『雷火xyz』还是 2 条」');
});

// ── 三、只留() 不许再回来 ──────────────────────────────────────

test('守③ 全库不许再有第二条渲染路径（只留() 就是那条路）', () => {
  const 源 = fs.readFileSync(path.join(__dirname, '..', 'public', '文稿.js'), 'utf8');
  assert.ok(!/function\s+只留\s*\(/.test(源),
    '只留() 又回来了 —— 它不读记号/可写/类三个筛，把它们静默作废而钮还亮着');
  assert.match(源, /筛\.正文/, '正文命中没有并进筛的状态里');
});
