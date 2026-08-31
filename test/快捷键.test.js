// 快捷键.test.js — 终端不许从整台机器上抢键。
//
// 案源 2026-08-30 23:05：制作人报「ESC 失灵，重启过、换过键盘，都不行」。
// 是这块屏干的。main.js 原来写的是
//   globalShortcut.register('Escape', () => { if (win && win.isFocused()) … })
// 而它上面那行注释写着「注册成局部快捷键（窗口聚焦时才生效），不抢全局」。
// **注释说的是意图，代码干的是另一件事**：globalShortcut 是系统级独占注册，
// isFocused() 只挡住了「动作」，挡不住「按键被吞」。
// 于是只要终端在跑，Esc / F11 / Ctrl+R 在所有程序里都是死的。
//
// 为什么拖了一天才发现：08-29 之前终端要手动开，失灵只在那段时间；
// 08-29 挂上开机自启之后它一直在跑，于是「重启没用、换键盘没用」两条同时成立，
// 把人引向硬件方向——**这是最坏的一类缺陷：它伪装成别人的问题。**
//
// 这一组是**源码守卫**不是行为判据（H104 口径：grep 源码不算判据）。
// 这里用守卫是对的：要守的不变量是「一个函数一次都不许被调用」，
// 而它的坏结果发生在被测进程之外（整台机器的其它程序），行为判据够不着。
'use strict';
const assert = require('node:assert');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const 主 = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
// 只看代码，不看注释——注释里写着这段案情，正当地提到了 globalShortcut
const 去注释 = 主
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

test('守① 不许从 electron 导入 globalShortcut（想用得先加回来，那时先问值不值得）', () => {
  const 导入行 = (去注释.match(/require\('electron'\)/) ? 去注释.split('\n').find((l) => l.includes("require('electron')")) : '') || '';
  assert.ok(!/globalShortcut/.test(导入行),
    'main.js 又导入了 globalShortcut：' + 导入行.trim());
});

test('守② 全文不许出现 globalShortcut 的调用', () => {
  assert.ok(!/globalShortcut\s*\./.test(去注释),
    '出现了 globalShortcut 调用——它会把键从整台机器上抢走，而这块屏是开机自启整天在跑的');
});

test('守③ 三个键要走 before-input-event（不然等于没有快捷键）', () => {
  assert.ok(/before-input-event/.test(去注释), '快捷键没有落点');
  for (const k of ['F11', 'Escape']) {
    assert.ok(去注释.includes(`'${k}'`), `${k} 没接上`);
  }
});

test('守④ **非全屏时的 Esc 必须放行**，不许无条件吃掉', () => {
  // 无条件 preventDefault 的话，页面里的 Esc（关面板、取消输入）就永远收不到，
  // 那是把「抢全机的键」缩小成了「抢本窗口的键」，病没好，只是变小了。
  const 段 = 去注释.slice(去注释.indexOf('before-input-event'));
  const esc = 段.slice(段.indexOf("k === 'Escape'"), 段.indexOf("k === 'Escape'") + 240);
  assert.ok(/isFullScreen\(\)/.test(esc),
    'Esc 分支没有 isFullScreen 判断——非全屏时也会被吃掉：' + esc.slice(0, 120));
});
