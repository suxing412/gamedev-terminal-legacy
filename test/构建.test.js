// 构建.test.js — 产物必须与源码一致（2026-08-31 批四）
//
// ── 这条判据在防什么 ──────────────────────────────────────────────
// 引入 CodeMirror 的真代价不是那 543 KB，是**从此这个项目多了一个构建步骤**。
// 而「改了 web/ 下的源码、忘了重新构建」的症状是：
//   **界面上跑的还是旧的，且看不出任何异常。**
// 没有报错、没有白屏、devtools 里也正常——只是你刚写的那段代码不在。
//
// 终端 0.17.2 踩过同族的坑：asar 文件 mtime 恒定 + Chromium 磁盘缓存跨重启持久，
// 换了新版还是旧 UI。当时的修法是「换版必清缓存」写进 main.js。
// 这里同理：**能靠机器挡的不要靠记得。**
//
// 自证能红：改一行 web/编辑器.js 不重新构建 → 这条必红。
'use strict';
const assert = require('node:assert');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { build, 活 } = require('../scripts/构建.js');

const 仓 = path.join(__dirname, '..');

test('守① 每个产物都存在，且带着"不要手改"的抬头', () => {
  for (const a of 活) {
    const p = path.join(仓, a.出);
    assert.ok(fs.existsSync(p), `${a.出} 不在——跑一次 npm run build:web`);
    const 头 = fs.readFileSync(p, 'utf8').slice(0, 200);
    assert.ok(/自动生成，不要手改/.test(头),
      `${a.出} 没有抬头——有人手改了产物，下次构建会把他的改动抹掉：` + 头.slice(0, 80));
    assert.ok(头.includes(a.入), `${a.出} 的抬头没写清源码在哪`);
  }
});

test('守② **产物与源码一致**（改了源码没重新构建就红）', async () => {
  const 果 = await build({ 写: false });
  for (const a of 果) {
    const 盘 = fs.readFileSync(path.join(仓, a.出), 'utf8');
    if (盘 === a.文) continue;
    // 差在哪要说得出来，不然只能盯着两个 500KB 的字符串发呆
    let i = 0;
    while (i < Math.min(盘.length, a.文.length) && 盘[i] === a.文[i]) i++;
    assert.fail(
      `${a.出} 与 ${a.入} 不一致——**界面上跑的是旧代码，而这不会报任何错**。\n`
      + `  跑一次：npm run build:web\n`
      + `  盘上 ${盘.length} 字，重新构建 ${a.文.length} 字，第一处差异在第 ${i} 字：\n`
      + `  盘上：…${盘.slice(Math.max(0, i - 40), i + 40)}\n`
      + `  应为：…${a.文.slice(Math.max(0, i - 40), i + 40)}`);
  }
});

test('守③ 产物里的中文是原样的，不是 \\uXXXX（否则 diff 完全没法读）', () => {
  for (const a of 活) {
    const s = fs.readFileSync(path.join(仓, a.出), 'utf8');
    assert.ok(/[一-龥]/.test(s), `${a.出} 里一个汉字都没有——charset:utf8 掉了？`);
  }
});

test('守④ 打包脚本一定要挂进 dist（不然换装出去的 exe 里是旧产物）', () => {
  const p = JSON.parse(fs.readFileSync(path.join(仓, 'package.json'), 'utf8'));
  assert.ok(p.scripts['build:web'], 'package.json 缺 build:web');
  assert.ok(/build:web/.test(p.scripts.dist || ''),
    'dist 没有前置 build:web——打包时不会重新构建，exe 里装的会是仓里那份旧产物');
  assert.ok((p.build.files || []).some((f) => /^public/.test(f)), 'public 没进打包清单');
});
