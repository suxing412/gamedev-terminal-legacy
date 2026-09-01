// 人闸页.js — 「等你拍板」独立成页（2026-09-02 拆栏 · 批二）
//
// 它原来是主壳左边那条 340px 的常驻栏。搬出来的理由不是腾地方，
// 是**那一栏里放不下它真正需要的东西**：
//
//   闸分组.js 的注释早就量过病灶——同一闸位的 24 单动作键完全相同
//   （G3 全是「验收：通过归档／打回」），摊成 24 个按钮，是把一次批量处置
//   误报成 24 个待决定。修法是给这一组一个「一次处置 24 单」的钮，
//   而那个钮在 340px 的栏里排不下。给它一整页就排得下。
//
// **服务端只出骨架，数据由客户端填。**理由是这一页与主壳共用 闸分组.js 那一份
// 分堆规则（前端 self.闸分组 / 判据 module.exports 同一份代码），
// 而那份规则跑在浏览器里。服务端再实现一遍分堆，就是同一个概念存两份——
// 本仓已经为「一个概念存四份」付过一次学费（事件折叠，2026-08-31 治好两份、
// 另外两份原封不动继续刷屏）。
//
// 片段模式不用管：server.js 那道中间件会把整页自动改写成片段并把 <script src>
// 挂成 data-脚本。**整页这条路必须留着**（视图.js 的「降级路不许断」）：
// 直接访问 /gate 要能单独打开，前端 JS 出问题时它还是能看。
'use strict';
const express = require('express');
const { 壳, 头 } = require('../render/页');

function 骨架() {
  // 三段：页头（计数与筛选）/ 单据组 / 议程段。
  // **议程单独一段，不跟单据混排**：它读自 待办-制作人议程.md，实测 mtime 停在 08-28，
  // 文件里写死的小时数是错的（写 TK-180 停 192h，实际 337h）——没有活时钟的东西
  // 不能跟有停摆时刻的单据一起参加年龄排序，混排会让整页的时间轴变得不可信。
  // 顶条那一格同理，它压根不进（见 public/app.js 的 写顶闸）。
  return `<section class="闸页" id="闸页">
  <header class="闸页头">
    <div class="闸页题">
      <h1>等你拍板</h1>
      <span class="闸页数" id="闸页数">读取中…</span>
    </div>
    <div class="闸页筛" id="闸页筛" role="group" aria-label="按类型筛选"></div>
  </header>
  <div class="闸页体" id="闸页体">
    <div class="闸页载">读取中…</div>
  </div>
  <section class="议程段" id="议程段" hidden></section>
</section>`;
}

function 挂(app) {
  const r = express.Router();

  r.get('/gate', (req, res) => {
    res.type('html').send(壳({
      题: '等你拍板 · 游戏开发者终端',
      头部: 头({ 当前: 'gate', 标题: '等你拍板' }),
      样式: '/人闸.css',
      body: 骨架(),
      // 闸分组.js 必须排在前面：人闸.js 顶层就取 self.闸分组（与主壳同一条纪律）
      脚本: '<script src="/闸分组.js" defer></script><script src="/人闸.js" defer></script>',
    }));
  });

  app.use(r);
  return r;
}

module.exports = { 挂, 骨架 };
