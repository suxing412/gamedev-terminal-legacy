// 前端起手.test.js — 每个前端脚本都要能在最小 DOM 桩里跑完加载，不抛。
//
// 案发 2026-08-31：`public/监视.js` 把 `const 网 = document.getElementById('wgrid')`
// 改成惰性取函数，**守卫行 `if (!网) return;` 忘了跟着删**。IIFE 顶上是 'use strict'，
// 于是模块一加载就 ReferenceError，那一行之后的注册一个都没发生：
// 3 秒轮询、清账点击委托、visibilitychange、片段重挂，全没有。
//
// 而这一页看上去完全正常——首屏是服务端渲染的，钟停在服务端写下的那一刻，
// 点清账不变灰、不发请求、也不报错。**一次没跟着删的守卫，把整页变成一张会骗人的快照。**
// 308 条判据全绿，没有一条够得着它：它们全都测服务端。
//
// 这个文件是那一整类的探针。它不测任何业务，只问一句：
// **把这个脚本按真实顺序加载一遍，它会不会当场炸。**
'use strict';
const assert = require('node:assert');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const 公 = path.join(__dirname, '..', 'public');

// 最小 DOM 桩。够不够真不重要——**炸在加载期的错误不需要真 DOM 才炸得出来**。
// 元素一律给得出（真实页面上这些 id 都在），够让顶层代码走完。
function 造桩() {
  const 元 = () => {
    const e = {
      textContent: '', innerHTML: '', value: '', placeholder: '', title: '', hidden: false,
      style: {}, dataset: {}, children: [], scrollTop: 0, scrollHeight: 0, clientHeight: 0,
      classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
      addEventListener() {}, removeEventListener() {}, appendChild() {}, append() {},
      setAttribute() {}, getAttribute: () => null, removeAttribute() {}, focus() {}, blur() {},
      closest: () => null, querySelector: () => 元(), querySelectorAll: () => [],
      insertAdjacentHTML() {}, remove() {}, scrollIntoView() {}, click() {},
      getBoundingClientRect: () => ({ x: 0, y: 0, width: 0, height: 0, top: 0, left: 0 }),
    };
    return e;
  };
  const doc = {
    readyState: 'complete',
    documentElement: 元(), body: 元(), head: 元(),
    getElementById: () => 元(),
    querySelector: () => 元(),
    querySelectorAll: () => [],
    createElement: () => 元(),
    createTextNode: () => 元(),
    addEventListener() {}, removeEventListener() {},
    visibilityState: 'visible',
    cookie: '',
  };
  const 存 = new Map();
  const 桩 = {
    document: doc,
    location: { href: 'http://127.0.0.1/', pathname: '/', search: '', hash: '', reload() {}, assign() {} },
    history: { pushState() {}, replaceState() {}, back() {} },
    localStorage: {
      getItem: (k) => (存.has(k) ? 存.get(k) : null),
      setItem: (k, v) => 存.set(k, String(v)),
      removeItem: (k) => 存.delete(k),
    },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    navigator: { clipboard: { writeText: () => Promise.resolve() }, userAgent: 'stub' },
    // 请求一律吊着不 resolve：这条判据只管加载期，不该被异步分支带着跑
    fetch: () => new Promise(() => {}),
    // 定时器不真跑，但要给得出句柄（有代码会存下来后面 clear）
    setInterval: () => 1, clearInterval() {}, setTimeout: () => 1, clearTimeout() {},
    requestAnimationFrame: () => 1, cancelAnimationFrame() {},
    addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true,
    CustomEvent: class { constructor(t, o) { this.type = t; Object.assign(this, o || {}); } },
    Event: class { constructor(t) { this.type = t; } },
    MutationObserver: class { observe() {} disconnect() {} },
    IntersectionObserver: class { observe() {} disconnect() {} unobserve() {} },
    TextDecoder: global.TextDecoder, TextEncoder: global.TextEncoder,
    console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    alert: undefined, confirm: undefined, prompt: undefined,   // 壳内是哑弹，桩里也不给
    JSON, Math, Date, Promise, Map, Set, WeakMap, Array, Object, String, Number, Boolean,
    RegExp, Error, TypeError, Intl, URL, URLSearchParams, AbortController,
    isNaN, parseInt, parseFloat, encodeURIComponent, decodeURIComponent, structuredClone,
  };
  桩.window = 桩; 桩.self = 桩; 桩.globalThis = 桩; 桩.top = 桩; 桩.parent = 桩;
  return 桩;
}

function 跑(脚本们) {
  const ctx = vm.createContext(造桩());
  for (const 名 of 脚本们) {
    const 源 = fs.readFileSync(path.join(公, 名), 'utf8');
    vm.runInContext(源, ctx, { filename: 'public/' + 名 });
  }
  return ctx;
}

// index.html 的加载顺序不写死在这儿——**从 HTML 里读**，
// 这样"忘了在 HTML 里挂上新脚本"也会被同一条判据抓到。
function 主页脚本序() {
  const html = fs.readFileSync(path.join(公, 'index.html'), 'utf8');
  const 出 = [];
  const re = /<script\s+src="([^"]+)"/g;
  let m;
  while ((m = re.exec(html))) 出.push(m[1].replace(/^\//, ''));
  return 出;
}

test('守① **主页按 index.html 的真实顺序加载，不许抛**', () => {
  const 序 = 主页脚本序();
  assert.ok(序.length >= 3, 'index.html 里没读出脚本序，实得 ' + JSON.stringify(序));
  assert.doesNotThrow(() => 跑(序), '主页脚本加载期就炸了 —— 屏上会是一张不会更新的静止快照');
});

test('守①b 主页脚本序里每一个都真的存在（挂了个不存在的文件 = 静默少跑一段）', () => {
  for (const 名 of 主页脚本序()) {
    assert.ok(fs.existsSync(path.join(公, 名)), `index.html 挂着 ${名}，但 public/ 下没有这个文件`);
  }
});

// 各视图页的脚本各自独立加载（服务端片段里是单挂的）
const 视图脚本 = ['stream.js', '存照.js', '文稿.js', '监视.js', '编辑器.js', '群聊.js', '视图.js'];

for (const 名 of 视图脚本) {
  test(`守② ${名} 单独加载不抛`, () => {
    assert.doesNotThrow(() => 跑([名]),
      `${名} 在加载期就抛了 —— 这一页之后的定时器、点击委托、片段重挂一个都不会注册，`
      + '而页面首屏是服务端渲染的，看上去完全正常');
  });
}

test('守③ **本判据自己要能红**：往任一脚本里塞一个未声明标识符，它必须炸', () => {
  // 监视.js 那次就是这个形状：`if (!网) return;`，而 网 从来没声明过。
  // 这条自证放在判据里而不是只放在 自证能红.js 上——它证的是**桩本身够不够严**：
  // 桩若给了个宽松的 global 代理，未声明标识符会变成 undefined 而不抛，整条判据就成了摆设。
  const ctx = vm.createContext(造桩());
  assert.throws(() => vm.runInContext("'use strict';\n(function(){ if (!没声明过的东西) return; })();", ctx),
    /ReferenceError/, '桩太松了：未声明标识符没有抛 ReferenceError，这条判据抓不到那一类错');
});

test('守③b 桩不许给 alert/confirm/prompt（壳内它们是哑弹，判据里也不能让它跑通）', () => {
  const ctx = vm.createContext(造桩());
  for (const f of ['alert', 'confirm', 'prompt']) {
    assert.strictEqual(vm.runInContext(`typeof ${f}`, ctx), 'undefined',
      `桩给了 ${f} —— 生产代码里用了原生对话框会在这里蒙混过关，而 Electron 壳内它静默哑弹`);
  }
});

test('守④ 闸分组/顶况 必须在 app.js 之前（app.js 顶层就解构它们）', () => {
  const 序 = 主页脚本序();
  const i闸 = 序.indexOf('闸分组.js'); const i顶 = 序.indexOf('顶况.js'); const iApp = 序.indexOf('app.js');
  assert.ok(i闸 >= 0 && i顶 >= 0 && iApp >= 0, '三个脚本没都挂上：' + JSON.stringify(序));
  assert.ok(i闸 < iApp && i顶 < iApp, '顺序不对：' + JSON.stringify(序));
  // 顺序错了要真的炸，不能只是名字排得不好看
  assert.throws(() => 跑(['app.js']), /闸分组|顶况|undefined/,
    'app.js 单独加载居然没炸 —— 那说明它并没有真的依赖那两个模块，判据在测一件不存在的事');
});
