// 构建.js — 把 web/ 下的模块打成 public/ 下的普通脚本。
//
// 引入 CodeMirror 的真代价不是那几百 KB，是**从此这个项目多了一个构建步骤**，
// 而「改了源码忘了重新构建」的症状是：**界面还是旧的，且看不出任何异常。**
// 终端 0.17.2 踩过同族的坑（asar mtime 恒定 + Chromium 磁盘缓存跨重启持久，
// 换了新版还是旧 UI，devtools 里也看不出）。
//
// 所以配一条判据 test/构建.test.js：跑一次构建，比对产物；有差异即红。
// 这样「记得重新构建」就从纪律变成了机器挡着的事。
'use strict';
const esbuild = require('esbuild');
const path = require('path');

const 仓 = path.join(__dirname, '..');

const 活 = [
  { 入: 'web/编辑器.js', 出: 'public/编辑器.js', 全局: '文稿编辑' },
];

async function build({ 写 = true } = {}) {
  const 果 = [];
  for (const a of 活) {
    const r = await esbuild.build({
      entryPoints: [path.join(仓, a.入)],
      outfile: path.join(仓, a.出),
      bundle: true,
      format: 'iife',
      platform: 'browser',
      target: ['chrome110'],          // Electron 30 带的是 Chromium 124，留点余量
      minify: true,
      sourcemap: false,               // 产物要进 git，sourcemap 会让 diff 噪声压过真改动
      legalComments: 'none',
      charset: 'utf8',                // 不加这条中文会被转成 \uXXXX，产物 diff 完全没法读
      write: 写,
      // md.js 是 CommonJS，esbuild 直接吃；它是纯函数、没有 node 内建依赖
      define: { 'process.env.NODE_ENV': '"production"' },
      banner: { js: `// 自动生成，不要手改。源码在 ${a.入}，改完跑 npm run build:web` },
    });
    果.push({ ...a, 文: 写 ? null : (r.outputFiles && r.outputFiles[0] && r.outputFiles[0].text) });
  }
  return 果;
}

module.exports = { build, 活 };

if (require.main === module) {
  build().then((果) => {
    const fs = require('fs');
    for (const a of 果) {
      const 字 = fs.statSync(path.join(仓, a.出)).size;
      console.log(`  ${a.入} → ${a.出}  ${(字 / 1024).toFixed(0)} KB`);
    }
  }).catch((e) => { console.error('构建失败：', e.message); process.exit(1); });
}
