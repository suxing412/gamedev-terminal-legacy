// 页.js — 两张阅读页共用的外壳（M1c · A4/A5）
//
// 服务端渲染，页面各自独立：**不带 morph、不带全页 diff**（施工令 §4 明列的选型，
// 对账的是监制台 app.js 那条长期税）。所以这里就是拼字符串——没有虚拟 DOM，没有 hydration，
// 翻一页就是一次整页 GET。阅读型页面本来也不需要更多。
//
// A5 布局纪律先立（M1 走浏览器，M3 才装壳）：**关键宽度用 grid + 定宽，禁嵌套 flex 撑宽**。
// 案源在 ai-vault 坑档案：壳内 Chromium 124 算错嵌套 flex 的宽，且**只在 exe 里复现**，
// 浏览器和 devtools 都看不出来。等 M3 装壳时再返工，就是在最难调的环境里调最难的问题。
const { 转义 } = require('./md');

// 头部导航。日期用等宽数字（tnum）——翻页时数字不许抖动布局。
function 头(o = {}) {
  const { 日, 当前, 上一日, 下一日, 标题 } = o;
  const 页签 = (路, 名, 键) => `<a class="tab${当前 === 键 ? ' on' : ''}" href="${转义(路)}">${转义(名)}</a>`;
  const 翻 = (路, 名, 有) => (有
    ? `<a class="nav" href="${转义(路)}" rel="${名 === '上一日' ? 'prev' : 'next'}">${转义(名)}</a>`
    : `<span class="nav off" aria-disabled="true">${转义(名)}</span>`);
  // 页签从唯一事实源渲染。**手工维护第二份列表就是下一次「东西看不见」的种子**——
  // 08-28 群聊、08-29 监视、08-30 班次，同一个错犯了三次，每次都是漏改了另一份。
  const { 页签表 } = require('./页签');
  return `<header class="top">
  <div class="brand">${转义(标题 || '情报')}<span class="d">${转义(日 || '')}</span></div>
  <nav class="tabs">
    ${页签表.map((t) => (t.主页
    // 独立页面上这一条不是「对话视图」，是**离开这一页回到壳**——写「主页」才说得准。
    // 在壳里它是页签之一，那时才叫「对话」。同一项，两个位置，两种称呼是对的。
    ? '<a class="tab back" href="/">← 主页</a>'
    : 页签(t.带日 ? `${t.路}/${日 || ''}` : t.路, t.名, t.键))).join('\n    ')}
  </nav>
  <div class="pager">
    ${当前 === 'chat' ? '' : `${翻(`/${当前 === 'stream' ? 'stream' : 'digest'}/${上一日 || ''}`, '上一日', !!上一日)}
    ${翻(`/${当前 === 'stream' ? 'stream' : 'digest'}/${下一日 || ''}`, '下一日', !!下一日)}`}
  </div>
</header>`;
}

/** 整页外壳。body 传已渲染好的 HTML 片段（调用方负责它已被转义）。 */
function 壳({ 题, body, 头部 = '', 脚本 = '', 样式 = '' }) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${转义(题 || '情报')}</title>
<link rel="stylesheet" href="/read.css">
${(Array.isArray(样式) ? 样式 : (样式 ? [样式] : []))
  .map((h) => `<link rel="stylesheet" href="${转义(h)}">`).join('\n')}
</head>
<body class="页">
${头部}
<main class="wrap">
${body}
</main>
${脚本}
</body>
</html>`;
}

// 空态（V1 明写：不留白屏）。**空态不是错误页**：没有当日报是常态
// （抓取班次还没到、或那天真没出报），所以给的是「最近几期」这个能往下走的口，
// 不是一句「404」。一个读的人打开页面看见空白，会以为是程序坏了。
function 空态({ 日, 最近 = [], 当前 = 'digest' }) {
  const 项 = 最近.length
    ? `<ul class="recent">${最近.map((d) => `<li><a href="/${当前}/${转义(d)}">${转义(d)}</a></li>`).join('')}</ul>`
    : '<p class="hint">一期都还没有——情报班次跑过之后这里就会有东西。</p>';
  return `<section class="empty">
  <h1>${转义(日)} 的${当前 === 'stream' ? '原始流' : '日报'}未生成</h1>
  <p class="hint">这一天没有产出，不是页面出错。可以翻到最近几期：</p>
  ${项}
</section>`;
}

module.exports = { 壳, 头, 空态 };
