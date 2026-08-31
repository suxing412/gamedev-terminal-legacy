// 文稿页.js — 文稿台（批二：只读）
//
// 左边文件库（五个根、约 650 份 md），右边阅读面，阅读面左侧一条记号栏。
//
// ── 为什么不是卡片网格 ────────────────────────────────────────────
// 647 份文档，等大卡片网格在这个量级下是**最糟**的排法：每份都占同样的视觉重量，
// 而它们的重要性差着两个数量级（一份你要逐行批注的设计文档，和一份机器产出的回执）。
// 用的是按根分组的**列表**：可写的与只读的在同一列里，靠标记区分，不靠位置。
//
// ── 记号栏 ────────────────────────────────────────────────────────
// 它是这个页面唯一一件外部编辑器给不了的东西：把散在几百行里的【改】【加】【删】【问】
// 收成一条可点的带子，并且**能一键连上下文交给坐席**。
// 扫描规则见 lib/文稿.js 的 扫记号()：反引号与围栏里的不算——那是在谈论记号，不是记号。
'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const 文稿lib = require('../lib/文稿');
const 锁lib = require('../lib/文锁');
const { 准写 } = require('../lib/写闸');
const { 壳, 头 } = require('../render/页');
const { 渲染, 转义 } = require('../render/md');

/**
 * 落盘。三件事一起做，缺一件都会静默写坏：
 *   ① 换行照原样还原 —— 原文是 LF 却写成 CRLF，一次保存 547 行全变改动行，
 *      「这轮标了哪几处」这条信息被淹掉（HTML 表单提交就会这么干，所以前端只走 fetch+JSON）
 *   ② BOM 照原样还原 —— 有 BOM 的文件写回时丢了它，下游按 BOM 判编码的工具会换一种读法
 *   ③ 原子写 —— 直接 writeFileSync 写到一半被杀（换装、互保重启都会杀进程），
 *      留下的是半个文件，而**半个 markdown 看起来仍然像一份 markdown**
 */
function 落盘(绝对路, 文, 原) {
  try {
    let s = String(文).replace(/\r\n/g, '\n');
    if (原 && 原.换行 === 'crlf') s = s.replace(/\n/g, '\r\n');
    if (原 && 原.有BOM) s = '\uFEFF' + s;
    const 临 = 绝对路 + '.tmp' + process.pid;
    fs.writeFileSync(临, s, 'utf8');
    fs.renameSync(临, 绝对路);
    return { 行: true };
  } catch (e) {
    return { 行: false, 因: '写不下：' + ((e && e.message) || e) };
  }
}

const 记号色 = { 改: 'gai', 加: 'jia', 删: 'shan', 问: 'wen' };

const 字节文 = (n) => (n < 1024 ? `${n}B`
  : n < 1024 * 1024 ? `${(n / 1024).toFixed(0)}KB` : `${(n / 1048576).toFixed(1)}MB`);

// ── 左栏：文件库 ───────────────────────────────────────────────────
//
// **按「这份东西是干什么的」分组，不按仓。**
// 2026-08-31 晚制作人指着截图定的：「这种文档堆积不给我分类的情况不要出现」。
// 按仓分只回答了「它属于哪个项目」——而那个问题他基本不问；
// 实测语料里 454/951（48%）是工单留痕（机器一次性产出、只读、他不会打开），
// 而他真正要来回改的那 50 份散在三个仓里，跟那 48% 排在同一条按时间倒序的流里抢位置。
//
// 分组之外还要**筛**：记号系统本来就是为「哪些文档在等我」设的，
// 可如果不能一眼筛出有记号的，它就只在你已经打开那一份时才有用
// ——等于只解决了一半。
function 渲染库(列表, 当前) {
  const 有记数 = 列表.filter(文稿lib.有记号).length;
  const 可写数 = 列表.filter((x) => x.可写).length;

  // 按类别分桶，桶序即 类别表 的序（越靠前越可能是他此刻要找的）
  const 桶 = new Map();
  for (const c of 文稿lib.类别表) 桶.set(c.键, { ...c, 项: [] });
  桶.set('qita', { 键: 'qita', 名: '其它', 释: '', 项: [] });
  for (const it of 列表) (桶.get(it.类) || 桶.get('qita')).项.push(it);

  const 记号色 = { 改: 'gai', 加: 'jia', 删: 'shan', 问: 'wen' };
  const 条 = (it) => {
    const 在 = 当前 && 当前.根 === it.根 && 当前.相对 === it.相对;
    const 记 = it.记 && (it.记.改 + it.记.加 + it.记.删 + it.记.问) > 0
      ? '<span class="稿记">' + 文稿lib.记号们.filter((k) => it.记[k])
        .map((k) => `<i class="${记号色[k]}">${k}${it.记[k]}</i>`).join('') + '</span>'
      : '';
    // 目录只在**能区分**时才显示：同名文件靠它认，其余情况它是每行重复的噪声
    const 处 = [it.根名, it.目].filter(Boolean).join(' · ');
    return `<a class="稿项${在 ? ' 在' : ''}${it.可写 ? '' : ' 只读'}"`
      + ` href="/doc?r=${encodeURIComponent(it.根)}&p=${encodeURIComponent(it.相对)}"`
      + ` data-路="${转义((it.根 + '/' + it.相对).toLowerCase())}"`
      + ` data-类="${转义(it.类)}" data-根="${转义(it.根)}"`
      + ` data-可写="${it.可写 ? '1' : '0'}" data-记="${记 ? '1' : '0'}">`
      + `<span class="稿行1"><span class="稿名">${转义(it.短名)}</span>`
      + `<span class="稿日">${转义(it.日 || '')}</span></span>`
      + `<span class="稿行2"><span class="稿处">${转义(处)}</span>${记}`
      + `<span class="稿注">${字节文(it.字节)}</span></span></a>`;
  };

  const 组 = [...桶.values()].filter((g) => g.项.length).map((g) => {
    // 组内按改动时间倒序——你最近碰过的最可能是你要找的
    const 项 = g.项.slice().sort((a, b) => b.改于 - a.改于).map(条).join('\n');
    // **默认只摊开「在办文稿」**，以及当前打开那份所在的组。
    // 一进来就把 454 份工单留痕摊在面前，等于什么都没分。
    const 开 = (g.键 === 'zaiban' && !当前) || (当前 && 当前.类 === g.键) ? ' open' : '';
    const 记数 = g.项.filter(文稿lib.有记号).length;
    return `<details class="稿组" data-类="${转义(g.键)}"${开}>
<summary><span class="组名">${转义(g.名)}</span>`
      + (记数 ? `<span class="组记">${记数} 待办</span>` : '')
      + `<span class="稿数">${g.项.length}</span></summary>
<div class="稿释">${转义(g.释 || '')}</div>
<div class="稿项们">${项}</div></details>`;
  }).join('\n');

  const 类筛 = [...桶.values()].filter((g) => g.项.length).map((g) =>
    `<button type="button" class="类筛钮" data-类="${转义(g.键)}">${转义(g.名)}<b>${g.项.length}</b></button>`).join('');

  return `<aside class="稿库">
  <div class="稿搜">
    <input id="稿搜框" type="search" placeholder="搜文件名（回车再搜正文）" autocomplete="off" spellcheck="false">
  </div>
  <div class="稿筛" id="稿筛">
    <button type="button" class="筛钮 要紧" id="筛记号"${有记数 ? '' : ' disabled'}>
      有记号<b>${有记数}</b></button>
    <button type="button" class="筛钮" id="筛可写">可写<b>${可写数}</b></button>
    <button type="button" class="筛钮 清" id="筛清" hidden>清筛选</button>
  </div>
  <div class="类筛" id="类筛">${类筛}</div>
  <div class="稿计" id="稿计">${列表.length} 份 · ${可写数} 可写 · ${有记数} 份有记号</div>
  <div class="稿列" id="稿列">
${组}
  </div>
</aside>`;
}

// ── 记号栏 ─────────────────────────────────────────────────────────
function 渲染记号栏(条们) {
  // 0 个记号时**不占一列**。原先空态是一整栏 232px 的说明文字——
  // 而这块屏在壳里只分到中间那一格，再切一列出去，正文就剩两百来像素。
  // 空态该说的话搬到标题行那句 记注 里（一行），列不留。
  if (!条们.length) return '';
  const 计 = 文稿lib.记号计(条们);
  const 头行 = 文稿lib.记号们.filter((k) => 计[k]).map((k) =>
    `<span class="记计 ${记号色[k]}">${k} ${计[k]}</span>`).join('');
  const 条 = 条们.map((x, i) => `<a class="记条 ${记号色[x.记号]}" href="#" data-行="${x.行号}" data-序="${i}">
  <span class="记标">${x.记号}</span>
  <span class="记文">${转义(x.行文)}</span>
  <span class="记行">${x.行号}</span>
</a>`).join('\n');
  return `<nav class="记号栏">
  <div class="记头">${头行}<button class="记交" id="记全交" type="button">全部交给坐席</button></div>
  <div class="记条们">${条}</div>
</nav>`;
}

// ── 阅读面 ─────────────────────────────────────────────────────────
function 渲染面(当前, 读, 条们) {
  if (!当前) {
    return `<article class="稿面 稿空">
  <div class="稿空心">
    <h1>文稿台</h1>
    <p>左边挑一份文档。可写的能编辑，只读的只能看。</p>
    <p class="稿细">机器产出的（班次报告、回执、归档）与我在维护的（记忆库）是只读的：
    改了下次就被覆盖，或者我根本不会读到。工单目录与 journal 是<b>活存储</b>——
    runner 每拍都在读写它们，并发写产生的状态错乱 git 也还原不回。</p>
  </div>
</article>`;
  }
  if (!读.行) {
    return `<article class="稿面"><div class="稿错">这份读不到：${转义(读.因 || '')}</div></article>`;
  }
  const 可编 = 当前.可写;
  const 钮 = 可编
    ? '<button class="稿编" id="稿编" type="button" disabled title="编辑态在批四落地">编辑</button>'
    : `<span class="稿只读大" title="${转义(当前.只读因 || '')}">只读</span>`;
  const 有记 = 条们.length > 0;
  // 空态只占一行，不占一列。这句话要说清**为什么是空的**——
  // 否则人会以为扫描坏了。（案：2026-08-31 的评审把说明表里那四行加了反引号的
  // 记号数成了「6 个待办」，正文里其实一个都没有。）
  const 记注 = 有记 ? ''
    : '<div class="记注">正文里没有记号。写 【改】【加】【删】【问】 就会在这里列出来并能跳过去；'
      + '<span class="记注细">加了反引号的不算——那是在谈论记号，不是记号，所以说明表不会被当成待办。</span></div>';
  return `<article class="稿面">
  <header class="稿头">
    <div class="稿题">
      <h1>${转义(path.basename(当前.相对))}</h1>
      <span class="稿路">${转义(当前.根名)} / ${转义(当前.相对)}</span>
    </div>
    <div class="稿钮">
      <span class="稿量">${读.文.split('\n').length} 行 · ${字节文(读.字节)} · ${读.换行.toUpperCase()}${读.有BOM ? ' · BOM' : ''}</span>
      <button class="稿库钮" id="稿库钮" type="button" title="收起/展开文件库">文件库</button>
      ${钮}
    </div>
  </header>
  ${记注}
  <div class="稿体${有记 ? '' : ' 无记'}">
${渲染记号栏(条们)}
    <div class="prose 稿正文" id="稿正文">
${渲染(读.文, { 行号: true })}
    </div>
  </div>
</article>`;
}

// ── 挂 ────────────────────────────────────────────────────────────
function 挂(app, opts = {}) {
  const r = express.Router();
  const 根表 = () => opts.根表();
  const 列举 = () => opts.列举();

  r.get('/doc', (req, res) => {
    const 表 = 根表();
    const 列表 = 列举();
    const 键 = String(req.query.r || '');
    const 路 = String(req.query.p || '');

    let 当前 = null; let 读 = { 行: false }; let 条们 = [];
    if (键 && 路) {
      const 校 = 文稿lib.校路径(表, 键, 路);
      if (!校.行) {
        读 = { 行: false, 因: 校.因 };
        当前 = { 根: 键, 根名: 键, 相对: 路, 可写: false };
      } else {
        读 = 文稿lib.读(校.绝对路);
        const 写 = 文稿lib.可写(表, 键, 校.相对);
        当前 = {
          根: 键, 根名: 校.根.名 || 键, 相对: 校.相对,
          可写: 写.行, 只读因: 写.因,
          类: 文稿lib.归类(键, 校.相对),   // 组要据此决定摊不摊开
        };
        if (读.行) 条们 = 文稿lib.扫记号(读.文);
      }
    }

    res.type('html').send(壳({
      题: 当前 ? `${path.basename(当前.相对)} · 文稿` : '文稿台',
      样式: ['/prose.css', '/文稿.css'],
      头部: 头({ 标题: '文稿', 当前: 'doc' }),
      // **外面这一层 稿容 是刻意的**：容器查询不能给容器自己上样式，
      // 只能管它的后代。首版把 container-type 挂在 稿台 上，然后在 @container 里改
      // 稿台 的 grid-template-columns——**那三条是死代码**，实测列模板纹丝不动（300px）。
      // 同一块 CSS 里 .稿量{display:none} 却生效了，因为它是后代。
      // 这种「一半生效一半不生效」最难看出来，所以量了才知道。
      // 写令牌随页面下发。跨站脚本读不到这一页，也就拿不到令牌——
      // 这是写闸第三道。前两道（JSON / Origin）已经够挡住那条 no-cors 攻击，
      // 这一道是纵深：「哪一道其实是多余的」这个判断，等到出事那天再做就晚了。
      body: `<div class="稿容" data-令="${转义(令牌台.发())}"><section class="稿台${当前 && 读.行 ? ' 有档' : ''}">
${渲染库(列表, 当前)}
${渲染面(当前, 读, 条们)}
</section></div>`,
      // 编辑器包在前，文稿.js 在后——后者启动时要 window.文稿编辑 已经在了。
      // 543 KB 走本机 http，没有网络往返，值班屏上感知不到。
      脚本: '<script src="/编辑器.js"></script>\n<script src="/文稿.js"></script>',
    }));
  });

  // ── 写侧 ────────────────────────────────────────────────────────
  //
  // 这是终端**第一个写口**。此前它对外纯只读（五个 POST 口没有一条把请求体落盘）。
  // 所以每一条写请求都要过四道：写闸三道（JSON / Origin / 令牌）+ 路径与写权。
  const 锁台 = opts.锁台;
  const 令牌台 = opts.令牌台;
  const 自家 = opts.自家 || [];

  // 写闸中间件。**只挂在写口上**——读口不该被令牌卡住（页面第一次打开时还没有令牌）。
  const 闸 = (req, res, next) => {
    const 判 = 准写({
      类型: req.headers['content-type'],
      来源: req.headers.origin,
      令: req.headers['x-doc-token'],
    }, { 自家: 自家(), 认令: (t) => 令牌台.认(t) });
    if (!判.行) return res.status(判.码).json({ 行: false, 因: 判.因 });
    return next();
  };

  // 解出 {根, 相对}，顺带把路径与写权一起判掉。任何一步不过都直接回。
  function 定位(req, res, { 要写 = true } = {}) {
    const 表 = 根表();
    const 校 = 文稿lib.校路径(表, String(req.body.r || ''), String(req.body.p || ''));
    if (!校.行) { res.status(400).json({ 行: false, 因: 校.因 }); return null; }
    if (要写) {
      const 写 = 文稿lib.可写(表, 校.根.键, 校.相对);
      if (!写.行) { res.status(403).json({ 行: false, 因: 写.因 }); return null; }
    }
    return { 根键: 校.根.键, 相对: 校.相对, 绝对路: 校.绝对路 };
  }

  r.post('/api/doc/lock', 闸, (req, res) => {
    const 位 = 定位(req, res); if (!位) return;
    const 读 = 文稿lib.读(位.绝对路);
    if (!读.行) return res.status(404).json({ 行: false, 因: 读.因 });
    const 取 = 锁台.取(位.根键, 位.相对, String(req.body.谁 || '制作人'));
    if (!取.行) return res.status(409).json({ 行: false, 因: 取.因, 态: 取.态 });
    const 纹 = 锁lib.指纹(读.文);
    // 上次没存完就断了的草稿：交回去让人自己选，**不自动套用**——
    // 悄悄把一份三天前的草稿铺在屏上，比丢掉它更坏。
    const 草 = 锁台.取草(位.根键, 位.相对);
    // **重开就要重设 base。**base 的语义是「我打开它那一刻盘上是什么」，
    // 不是「上一次存盘时是什么」。不重设的话，第二次打开同一份文档时
    // 冲突比对拿的是一份过期的基准，三路差异会指着错的地方
    // ——而且它**看着仍然像一份正常的差异**，比报错难发现得多。
    // 例外：手上还压着一份没存完的草稿时不动它，那份 base 是属于那份草稿的。
    if (!草.有 || 草.文 == null) 锁台.重置基(位.根键, 位.相对, 读.文, 纹);
    return res.json({
      行: true, 令牌: 取.令牌, 文: 读.文, 指纹: 纹,
      换行: 读.换行, 有BOM: 读.有BOM, 因: 取.因,
      // 存盘之后草稿被清掉、只留 base（见 重置基），那时 草.文 是 null——
      // **不能把 null 当成一份草稿弹给人**，那会变成一个「要不要载入空白」的框
      // 把草稿**自己的**基准指纹一起交回去。载入一份过时草稿之后，
      // 该拿它的基准去比对，而不是拿盘上当前那一版——
      // 否则下一次存盘会静默盖掉别人在这期间写的东西，**连冲突框都不弹**
      // （实测踩到：坐席加的一节就这么没了，只在版本环里留了个尸首）。
      草稿: (草.有 && 草.文 != null)
        ? { 文: 草.文, 时: 草.时, 同源: 草.基指纹 === 纹, 基指纹: 草.基指纹, 基文: 草.基文 }
        : null,
    });
  });

  r.post('/api/doc/renew', 闸, (req, res) => {
    const 位 = 定位(req, res); if (!位) return;
    const y = 锁台.续(位.根键, 位.相对, String(req.body.令牌 || ''), Date.now(), !!req.body.有按键);
    return res.status(y.行 ? 200 : 409).json(y);
  });

  r.post('/api/doc/unlock', 闸, (req, res) => {
    const 位 = 定位(req, res); if (!位) return;
    return res.json(锁台.放(位.根键, 位.相对, String(req.body.令牌 || '')));
  });

  r.post('/api/doc/draft', 闸, (req, res) => {
    const 位 = 定位(req, res); if (!位) return;
    const 判 = 锁lib.可写(锁台.条(位.根键, 位.相对), String(req.body.令牌 || ''));
    if (!判.行) return res.status(409).json({ 行: false, 因: 判.因 });
    // 草稿落**服务端**，不落 localStorage：4280 被占时 start() 会顺延到 4281，
    // origin 一变 localStorage 就找不着了——而那正是「进程刚被杀过、最需要草稿」的场景。
    锁台.存草(位.根键, 位.相对, String(req.body.文 || ''), req.body.基文, String(req.body.基指纹 || ''));
    return res.json({ 行: true, 时: Date.now() });
  });

  r.post('/api/doc/save', 闸, (req, res) => {
    const 位 = 定位(req, res); if (!位) return;
    const 判 = 锁lib.可写(锁台.条(位.根键, 位.相对), String(req.body.令牌 || ''));
    if (!判.行) return res.status(409).json({ 行: false, 因: 判.因 });

    const 现 = 文稿lib.读(位.绝对路);
    if (!现.行) return res.status(404).json({ 行: false, 因: 现.因 });
    const 盘纹 = 锁lib.指纹(现.文);
    const 基纹 = String(req.body.基指纹 || '');

    // 冲突：打开之后盘上被人动过。**拒写并给出三路**——
    // 不弹「文件已变更，是否覆盖」，那个框所有人都点确定。
    //
    // 条件写成 `!基纹 ||`：首版是 `if (基纹 && …)`，于是**基指纹为空就整段跳过比对**，
    // 不经前端的调用方一次静默全覆盖。缺基准该是「更要拦」，不是「不用拦」。
    if (!基纹 || 基纹 !== 盘纹) {
      const 草 = 锁台.取草(位.根键, 位.相对);
      // **先把盘上这一版存进版本环，再回 409。**
      // 触发 409 等价于「盘上那次写入没走写口」（走写口的会先被锁挡下），
      // 而 存版() 只在 save 的成功分支里跑——所以在这个框唯一会出现的场景里，
      // 被覆盖的那一版**必然不在版本环里**。前端那句「盘上那版仍会留在版本历史里」
      // 因此**每一次都是假的**。要么兑现它，要么删掉它；这里选兑现。
      let 已存版 = false;
      try {
        锁台.存版(位.根键, 位.相对, 现.文, '盘上原版·外部写入');
        已存版 = true;
      } catch (e) { /* 存不下也要把冲突回给人，只是那句承诺要改口 */ }
      // 能三路 不能只判「base 非空」——base 可能停在两代之前（存草 的 existsSync 守卫
      // 曾让它永不更新）。**要验它确实就是本次比对的基准**，
      // 否则前端那条「取不到 base，保留我的是盲覆盖」的警告会被假的 true 抑制掉。
      const 基对 = !!(草.有 && 草.基文 != null && 锁lib.指纹(草.基文) === 基纹);
      return res.status(409).json({
        行: false, 冲突: true, 因: '这份文件在你编辑期间被改过了',
        盘上: 现.文, 盘纹, 我的: String(req.body.文 || ''),
        // base 的**字节**，不是哈希——没有它，「保留我的」在数据模型里根本不存在
        基文: 基对 ? 草.基文 : null,
        能三路: 基对,
        已存版,
        草损: !!草.损,
      });
    }

    const 文 = String(req.body.文 || '');
    const 出 = 落盘(位.绝对路, 文, 现);
    if (!出.行) return res.status(500).json(出);
    // **任何一次写入都产生一版，带「谁写的」。**只记制作人那侧的话，
    // 坐席的改动在历史里是隐形的——而假历史比没历史坏。
    const 版 = 锁台.存版(位.根键, 位.相对, 文, String(req.body.谁 || '制作人'));
    // **不是 清草**——清掉 base 之后下一次冲突就没有比较基准了（实测踩过）
    锁台.重置基(位.根键, 位.相对, 文, 锁lib.指纹(文));
    return res.json({ 行: true, 指纹: 锁lib.指纹(文), 版: 版.版, 字节: Buffer.byteLength(文, 'utf8') });
  });

  // 把一份**没写进盘**的文本存成一版。
  // 用处只有一个：冲突框里点「丢掉我的，用盘上的」时，先给那一版留条后路——
  // 否则它在盘上、版本环、草稿三处同时不存在，只剩编辑器的 undo 栈，
  // 而那随「退出编辑」一起消失。界面把「保留 / 丢掉」画成对称的两个方向，
  // 不给这条路的话它们其实一个可逆一个不可逆。
  r.post('/api/doc/version-keep', 闸, (req, res) => {
    const 位 = 定位(req, res); if (!位) return;
    const 判 = 锁lib.可写(锁台.条(位.根键, 位.相对), String(req.body.令牌 || ''));
    if (!判.行) return res.status(409).json({ 行: false, 因: 判.因 });
    const v = 锁台.存版(位.根键, 位.相对, String(req.body.文 || ''), String(req.body.谁 || '未命名'));
    return res.json({ 行: true, 版: v.版 });
  });

  r.get('/api/doc/versions', (req, res) => {
    const 校 = 文稿lib.校路径(根表(), String(req.query.r || ''), String(req.query.p || ''));
    if (!校.行) return res.status(400).json({ 行: false, 因: 校.因 });
    return res.json({ 行: true, 版们: 锁台.历版(校.根.键, 校.相对) });
  });

  r.get('/api/doc/version', (req, res) => {
    const 校 = 文稿lib.校路径(根表(), String(req.query.r || ''), String(req.query.p || ''));
    if (!校.行) return res.status(400).json({ 行: false, 因: 校.因 });
    const v = 锁台.读版(校.根.键, 校.相对, String(req.query.v || ''));
    return res.status(v.行 ? 200 : 400).json(v);
  });

  // 锁况（读口，不过写闸）：文件库角标与编辑按钮要按它决定长什么样
  r.get('/api/doc/lockstate', (req, res) => {
    const 校 = 文稿lib.校路径(根表(), String(req.query.r || ''), String(req.query.p || ''));
    if (!校.行) return res.status(400).json({ 行: false, 因: 校.因 });
    return res.json({ 行: true, ...锁台.况(校.根.键, 校.相对) });
  });

  // 正文搜索。文件名搜索在前端做（列表已经在页面上了，没必要来回一趟）；
  // 正文搜索要读盘，所以只在这里做，且有条数上限。
  r.get('/api/doc/search', (req, res) => {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return res.json({ 行: false, 因: '至少两个字', 命中: [] });
    const 表 = 根表();
    const 根路 = {};
    for (const x of 表) if (x.路) 根路[x.键] = x.路;
    const 命中 = 文稿lib.搜(列举(), q, { 根路, 读上限: 400 })
      .filter((x) => x.命中 && x.命中 !== '文件名');
    res.json({ 行: true, 词: q, 命中: 命中.slice(0, 60).map((x) => ({ 根: x.根, 相对: x.相对, 命中: x.命中 })) });
  });

  app.use(r);
}

module.exports = { 挂, 渲染库, 渲染记号栏, 渲染面 };
