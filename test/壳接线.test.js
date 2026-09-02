// 壳接线.test.js — main.js 有没有把那几件事接上。
//
// **这个文件是源码守卫，不是行为判据**，而且是故意的。诚实地讲清分工：
//
//   · 「机制成不成立」由 `test/壳内/跑道.js` 在真 Electron 里验
//     （setMinimumSize 之后 setBounds 生不生效、will-prevent-unload 拦不拦得住
//      而重载仍然完成）。那条跑道自证过能红：把「松开 minWidth」去掉，
//      S18① 当场变 not ok、退出码 1。
//
//   · 接① / 接①b（半屏塔进出时松开与装回 minWidth）**已随半屏一起撤销**
//     ——2026-09-02 制作人拍板删除半屏。它们守的那段 IPC 不再存在，
//     再留着就是两条恒真的守卫。接①c 与接④ 没跟着撤：窗最小 这个常量还在，
//     而 S18①② 仍然要靠它量窄档。
//   · 「main.js 有没有用上那个机制」由这里守。要在真壳里验这一半，
//     得把整个 app 拉起来再驱动 IPC——那比它守住的东西贵得多。
//
// 分开写而不是含混地说「验过了」：H104 的口径是判据要验行为，
// 而**一条源码守卫冒充行为判据，比没有判据更坏**——它会让人以为这块有人看着。
'use strict';
const assert = require('node:assert');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const 源 = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

test('接①c 最小尺寸只此一处（两处各写一个数，就一定会有一天只改了一个）', () => {
  assert.match(源, /const 窗最小 = \[\d+, \d+\]/, 'main.js 里没有 窗最小 这个常量');
  // 除了常量定义那一行，不许再出现裸的 1100
  const 犯 = 源.split(/\r?\n/)
    .map((l, i) => [i + 1, l])
    .filter(([, l]) => /\b1100\b/.test(l) && !/const 窗最小/.test(l) && !l.trim().startsWith('//'));
  assert.deepStrictEqual(犯.map(([n, l]) => n + ': ' + l.trim()), [],
    '这些地方又写死了一个 1100');
});

test('接② **接住 will-prevent-unload**（不接：Ctrl+R 与关窗按钮双双静默失灵）', () => {
  // 编辑器一脏就挂 beforeunload。浏览器里会弹原生确认框；Electron 是问主进程，
  // 没人接就默认拒绝卸载——不弹框、不报错、页面连闪都不闪。
  // 这台机器 08-30 刚发生过「ESC 失灵、重启换键盘都没用」的同族事故。
  // **按语法定位，不用 indexOf 找字面量。**这个词在文件里出现三次，
  // 前两次都在注释里（讲不接会怎样），而注释里没有 preventDefault ——
  // 用 indexOf 会读到注释那一段然后判红。同一个坑当晚在 文稿筛.test.js 的 史④ 上犯过一次。
  const m = 源.match(/webContents\.on\('will-prevent-unload',\s*\(([^)]*)\)\s*=>\s*\{([^}]*)\}/);
  assert.ok(m, 'main.js 没接 will-prevent-unload');
  assert.match(m[2], /preventDefault\(\)/, '接了但没 preventDefault —— 那等于没接');
});

test('接③ 那句已被证伪的 Fluent 解释不许再回来', () => {
  // 「Fluent 滚条不吃 ::-webkit-scrollbar，所以关掉该特性」——实测那开关无效，
  // 真凶是 班次.css 里的一行 `* { scrollbar-width: thin }`。
  // **一个已经被证伪的解释，比没有解释贵得多**：它会让下一个人不去看真凶。
  const 犯 = 源.split(/\r?\n/)
    .filter((l) => /FluentScrollbar|FluentOverlayScrollbar/.test(l) && !l.trim().startsWith('//'));
  assert.deepStrictEqual(犯, [],
    '那个已被证伪的开关又回来了：\n  ' + 犯.join('\n  ')
    + '\n（真凶在 tokens.css 那段注释里写着）');
});

test('接④ 跑道与 main.js 同源取 窗最小（跑道里不许再抄一个数）', () => {
  const 跑 = fs.readFileSync(path.join(__dirname, '壳内', '跑道.js'), 'utf8');
  assert.match(跑, /main\.js[\s\S]{0,200}const 窗最小 = \\\[\(\\d\+\), \(\\d\+\)\\\]/,
    '跑道没有从 main.js 读 窗最小');
});

// ── 接①d：半屏塔那条 IPC 通道真的断了（2026-09-02）─────────────────
//
// 这一条**只能在这里**：跑道.js 自己起主进程、自己建窗，从不加载 main.js，
// 所以「按 F9 窗宽没被钳走」在那边是恒真的（写过一版，装回半屏之后照样 ok）。
// 通道在不在，是 main.js 的源码事实——正是本文件抬头声明的那一半。
test('接①d main.js 不再监听 形态:半屏（半屏 2026-09-02 删除，通道要一起断）', () => {
  assert.ok(!/ipcMain\.on\(['"]形态:半屏['"]/.test(源),
    'main.js 仍在监听 形态:半屏 —— 前端入口删了，这条能把窗口钳到 360 的通道还开着');
  assert.ok(!/setMinimumSize\(360/.test(源),
    'main.js 里还有 setMinimumSize(360…) —— 窗口最小尺寸只该由 窗最小 那一处定');
});
