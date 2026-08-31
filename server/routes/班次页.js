// 班次页.js — /shift 页。四类班次（夜间巡检 / 晨报 / 夜报 / 周末巡检）的排期、闸况与历次报告。
//
// 设计与评审见 D:/GitHub/AI-GameStudio/监制台/方案-班次页-2026-08-30.md。
// 四条贯穿全文件的纪律：
//
// **一 · 不解析报告正文。** 屏上每一个数字、每一种状态的来源只能是机器写的结构化数据
//   （班次/索引.jsonl、用量.jsonl、闸）。报告正文是坐席写的散文，它换个措辞，
//   抠出来的数就悄悄变错——那比没有这个数坏得多（PRODUCT.md 原则五）。
//   正文原样渲染，一个字都不抠。
//
// **二 · 十种态两两不同，而且不靠颜色区分。** 早上看见一个灰点却不知道该查什么，
//   就是这一格失败的样子。所以每种态有自己画出来的形状（不是 emoji——
//   Unicode 字形冒充图标系统是明令禁的），颜色只是第二重编码。
//
// **三 · 按「看见它该干什么」分族，不按「好坏」分。** 四族：好 / 在动 / 不用管 / 要查。
//   「今天不跑」和「已跑」都属于不用管，虽然一个是绿一个是灰；
//   「被闸挡」和「断了」都属于要查，虽然一个是配置问题一个是进程问题。
//   人扫这块屏时问的是「有没有我要管的」，不是「有几个绿的」。
//
// **四 · 读不到不画成零。** 索引读不到时说读不到，不显示空列表。
'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const 班次lib = require('../lib/班次');
const { 壳, 头 } = require('../render/页');
const { 渲染, 转义 } = require('../render/md');

// ── 十种态：族 / 画法 / 说明 ──────────────────────────────
//
// 形状全部 12×12、stroke 1.5、currentColor，一套笔法。
// 族决定颜色与权重；形状决定「是哪一种」。两重编码缺一不可：
// 只靠颜色，色觉差异的人和扫一眼的人都分不出「断了」和「被闸挡」。
const 族色 = { 好: 'ok', 在动: 'run', 不用管: 'idle', 要查: 'bad' };

const 态谱 = {
  已跑: { 族: '好', 形: '<polyline points="2.5,6.5 5,9 9.5,3.5"/>' },
  运行中: { 族: '在动', 形: '<path class="spin" d="M6 1.5a4.5 4.5 0 1 1-4.5 4.5"/>' },
  补跑中: { 族: '在动', 形: '<circle cx="6" cy="6" r="4.5"/><path d="M6 1.5a4.5 4.5 0 0 1 0 9z" fill="currentColor" stroke="none"/>' },
  待跑: { 族: '不用管', 形: '<circle cx="6" cy="6" r="4.5"/>' },
  今天不跑: { 族: '不用管', 形: '<line x1="2" y1="6" x2="10" y2="6"/>' },
  停用: { 族: '不用管', 形: '<circle cx="6" cy="6" r="4.5"/><line x1="3" y1="9" x2="9" y2="3"/>' },
  未收尾: { 族: '要查', 形: '<circle cx="6" cy="6" r="4.5"/><line x1="6" y1="3.5" x2="6" y2="6.5"/><line x1="6" y1="8.5" x2="6" y2="8.6"/>' },
  断了: { 族: '要查', 形: '<line x1="1.5" y1="6" x2="4.5" y2="6"/><line x1="7.5" y1="6" x2="10.5" y2="6"/>' },
  错过: { 族: '要查', 形: '<line x1="2.5" y1="2.5" x2="9.5" y2="9.5"/><line x1="9.5" y1="2.5" x2="2.5" y2="9.5"/>' },
  // 双竖条＝被扣住了。首版画成竖线加横线，放大一看是个「†」——
  // 既不像闸，小尺寸下又跟「错过」的 ✕ 撞形。记号要在 12px 下一眼分得开，
  // 而不是在设计稿里说得通。
  被闸挡: { 族: '要查', 形: '<line x1="4" y1="2" x2="4" y2="10"/><line x1="8" y1="2" x2="8" y2="10"/>' },
  读不到: { 族: '要查', 形: '<circle cx="6" cy="6" r="4.5" stroke-dasharray="2 2"/>' },
};

function 记号(态) {
  const s = 态谱[态] || 态谱.读不到;
  return `<svg class="mk mk-${族色[s.族]}" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"
    fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${s.形}</svg>`;
}

const 星期名 = ['日', '一', '二', '三', '四', '五', '六'];

/**
 * 排期怎么说人话。天天跑就不啰嗦，只有收窄了才说。
 *
 * 星期按「一二三四五六日」的顺序念，不按 0–6 的数值序——
 * 数值序会把 [0,6] 念成「周日六」，读着别扭而且要停一下才反应过来。
 * 屏上的字是给一双扫过去的眼睛看的。
 */
const 周序 = (n) => (n === 0 ? 7 : n);
function 排期说(c) {
  const w = Array.isArray(c.仅星期) ? c.仅星期 : [];
  if (!w.length) return 转义(c.到点);
  const 排 = w.slice().sort((a, b) => 周序(a) - 周序(b));
  const 文 = (排.length === 2 && 排[0] === 6 && 排[1] === 0)
    ? '周末'                                   // [6,0] 就直说周末，比「周六日」更快读懂
    : `周${排.map((n) => 星期名[n]).join('')}`;
  return `${转义(c.到点)} <span class="only">${转义(文)}</span>`;
}

// 闸：两个数都要显示。它们是两道独立的闸，任一挡住都开不了班——
// 只显示一个会让人查错方向。阈值跟着显示，裸数字没有意义。
// 单拎出来是因为**空态那条路也要显示它**：一班都没有的时候，
// 「闸开着吗」这个问题一样要有答案。
function 渲染闸(闸) {
  const g = 闸 || {};
  const 闸态 = g.行 ? 'ok' : 'bad';
  const 用 = g.已耗 != null && g.上限 ? `${(g.已耗 / 1000).toFixed(1)}k / ${(g.上限 / 1000).toFixed(0)}k` : '读不到';
  const 水 = g.水位 != null ? `${g.水位}% / 70%` : '读不到';
  return `<div class="sgate g-${闸态}">
      <span class="gk">闸</span>
      <span class="gv">今日 <b>${转义(用)}</b></span>
      <span class="gv">5小时窗 <b>${转义(水)}</b></span>
      <span class="gw">${转义(g.因 || '')}</span>
    </div>`;
}

/**
 * 班次带：按**到点先后**排成一条，不是摆成卡片网格。
 *
 * 两个理由，都不是审美：
 *   ① 四个班次有天然的时间顺序（02:00 → 09:00 → 10:00 → 23:26）。按时间排，
 *      「今天走到哪儿了」自己就看出来了；摆成网格就把这个信息扔了。
 *   ② 同尺寸卡片网格（图标+标题+文字）是页面骨架里最偷懒的一种，
 *      它假装信息很多，实际每格只有三个字段。既有监视页的 .wbar 已经是
 *      「一排状态」的惯用法，这里继承它，不另发明。
 */
function 渲染带(今日, 闸, 无班因) {
  const 排好 = 今日.slice().sort((a, b) => String(a.到点).localeCompare(String(b.到点)));

  // **空态要在补钟之前判。**首版无条件先把「现在」这个钟塞进段里，
  // 于是下面那句 `格 || '<p class="hint">…一个班次都没有…</p>'` 的右半边永远不渲染——
  // 唯一那句解释是死代码。屏上只剩一个孤零零的钟，而 (a) 没配置 /
  // (b) 还没到点 / (c) 配置读坏了 三种情形长得一模一样。
  if (!排好.length) {
    const 因 = 无班因 || '今天没有任何班次';
    return `<section class="sbar">
    <div class="sline"><p class="hint">${转义(因)}</p></div>
    ${渲染闸(闸)}
  </section>`;
  }
  const 此刻 = (() => { const d = new Date(); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; })();
  let 插过 = false;
  const 段 = [];
  for (const s of 排好) {
    // 「现在」插在它该在的位置上——一眼看出哪些已经过去、哪些还在后头
    if (!插过 && String(s.到点) > 此刻) { 段.push(`<span class="now" aria-label="现在">${转义(此刻)}</span>`); 插过 = true; }
    const 族 = 族色[(态谱[s.态] || 态谱.读不到).族];
    const 链开 = s.档名 ? `<a class="si f-${族}" href="/shift?f=${encodeURIComponent(s.档名)}">` : `<span class="si f-${族}">`;
    const 链闭 = s.档名 ? '</a>' : '</span>';
    段.push(`${链开}
      <span class="si-t">${排期说(s)}</span>
      <span class="si-n">${记号(s.态)}${转义(s.班次)}</span>
      <span class="si-s">${转义(s.态)}</span>
      <span class="si-w">${转义(s.说 || '')}</span>
    ${链闭}`);
  }
  if (!插过) 段.push(`<span class="now" aria-label="现在">${转义(此刻)}</span>`);
  const 格 = 段.join('');

  return `<section class="sbar">
    <div class="sline">${格}</div>
    ${渲染闸(闸)}
  </section>`;
}

/**
 * 报告正文。**「第一眼」可以提出来，别的一律不抠。**
 * 那一节是坐席自己标的结构（提示词要求它写），不是我从散文里猜的——这条界线要守住：
 * 一旦开始按段落找「结论」「风险」，就等于在解析散文，下一次它换个写法就静默变错。
 */
function 拆第一眼(md) {
  const m = md.match(/^##\s*第一眼\s*$([\s\S]*?)(?=^#{1,2}\s|\Z)/m);
  if (!m) return { 眼: null, 余: md };
  return { 眼: m[1].trim(), 余: md.slice(0, m.index) + md.slice(m.index + m[0].length) };
}

/**
 * 剥掉报告开头那段机器写的头（`# 班次报告 · X` + 起于/用时/结果 + `---`）。
 *
 * **这是剥我自己写的格式，不是解析坐席的散文**——那三行是 跑班次() 拼的，形状恒定。
 * 剥它的理由：同样三个事实在班次带上已经显示过一遍了，正文里再来一遍是噪声，
 * 而且是那种「看两遍才确认它俩说的是一回事」的噪声。
 *
 * 剥不掉就原样返回——**宁可多显示一段，不可把正文吃掉**。
 */
function 剥机器头(md) {
  const m = md.match(/^#\s*班次报告[\s\S]*?\n---\s*\n/);
  return m ? md.slice(m[0].length).replace(/^\s+/, '') : md;
}

function 渲染报告(档名, 文) {
  if (文 == null) {
    return `<section class="srep empty"><h2>还没有报告</h2>
      <p class="hint">班次跑过之后这里就会有东西。上一班的产出落在 <code>终端根/班次/</code>。</p></section>`;
  }
  const { 眼, 余 } = 拆第一眼(剥机器头(文));
  return `<section class="srep">
    <div class="srep-h"><h2>${转义(档名)}</h2></div>
    ${眼 ? `<div class="eye"><span class="eye-k">第一眼</span><div class="eye-b">${渲染(眼)}</div></div>` : ''}
    <article class="prose">${渲染(余)}</article>
  </section>`;
}

/** 历次：只放机器指标。不放正文摘要——摘要要么是我编的，要么要解析坐席的散文。 */
function 渲染历次(历次, 读不到) {
  if (读不到) {
    return `<section class="shist"><h2>历次</h2>
      <p class="unk">索引读不到：${转义(读不到)}</p></section>`;
  }
  if (!历次 || !历次.length) {
    return `<section class="shist"><h2>历次</h2><p class="hint">还没有跑过任何一班。</p></section>`;
  }
  const 行 = 历次.map((h) => {
    const 坏 = h.结果 !== '正常收尾';
    const 量 = h.出 == null
      ? '<span class="unk">用量读不到</span>'                 // **不写 0**——把不知道画成一个数是最严重的错
      : `${(h.出 / 1000).toFixed(1)}k`;
    return `<tr class="${坏 ? 'bad' : ''}">
      <td class="c-t">${转义(String(h.t).slice(5, 16).replace('T', ' '))}</td>
      <td class="c-n">${转义(h.班次)}</td>
      <td class="c-d">${h.用时秒 != null ? 转义(h.用时秒 + 's') : '<span class="unk">—</span>'}</td>
      <td class="c-o">${量}</td>
      <td class="c-r">${记号(坏 ? '未收尾' : '已跑')}${转义(h.结果 || '')}${h.因 ? `<span class="why">${转义(h.因)}</span>` : ''}</td>
      <td class="c-a"><a href="/shift?f=${encodeURIComponent(h.档名)}">看</a></td>
    </tr>`;
  }).join('');
  return `<section class="shist">
    <h2>历次</h2>
    <table class="htab"><thead><tr>
      <th>时刻</th><th>班次</th><th>用时</th><th>output</th><th>结果</th><th></th>
    </tr></thead><tbody>${行}</tbody></table>
  </section>`;
}

function 挂(app, opts = {}) {
  const r = express.Router();
  const 取数 = opts.取数;          // () => { 今日, 闸, 历次, 索引读不到 }
  const 读报告 = opts.读报告;      // (档名) => { 行, 文?, 因? }

  r.get('/shift', (req, res) => {
    let d;
    try { d = 取数(); }
    catch (e) { d = { 今日: [], 闸: null, 历次: null, 索引读不到: '取数出错：' + (e && e.message) }; }

    // 要看哪一份：URL 指定的优先，否则最近一份
    const 想看 = req.query.f ? String(req.query.f) : ((d.历次 && d.历次[0] && d.历次[0].档名) || null);
    let 档名 = null; let 文 = null;
    if (想看) {
      const v = 读报告(想看);
      if (v.行) { 档名 = 想看; 文 = v.文; } else { 档名 = 想看; 文 = null; }
    }

    res.type('html').send(壳({
      题: '班次',
      样式: ['/prose.css', '/班次.css'],
      头部: 头({ 标题: '班次', 当前: 'shift', 日: '' }),
      body: 渲染带(d.今日 || [], d.闸, d.无班因) + 渲染报告(档名, 文) + 渲染历次(d.历次, d.索引读不到),
    }));
  });

  app.use(r);
}

module.exports = { 挂, 态谱, 拆第一眼, 渲染带, 渲染闸 };
