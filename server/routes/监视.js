// 监视.js — /watch 页与 /api/watch 状态口。
//
// 设计与评审见 docs/方案-监视器归一与可视化-2026-08-29.md。三条贯穿全文件的纪律：
//
// **一 · 每一格必须答得出「你据此做什么」。** 答不出的格不该占一格。
//   坏了做什么写在配置里，随格下发，变红时显示在卡上——不让人对着一个红灯发呆。
//
// **二 · 读不到 ≠ 不健康 ≠ 0。** 三者在屏上必须长得不一样。
//   把「不知道」画成一个具体的数，是这块屏能犯的最严重的错（PRODUCT.md 原则 5）。
//
// **三 · 平时永远绿的东西不占大面积。** 瞭望塔与监制台是管子状态，收成顶上一条细带；
//   主区只留「今天真要看的」。首版把两张永远绿的大卡摆在第一屏，是把版面给了不需要看的东西。
'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const 取 = require('../lib/监视取数');
const 事流 = require('../../public/事流.js');   // 与右栏、与前端共用同一份折叠口径
const { 壳, 头 } = require('../render/页');
const { 转义 } = require('../render/md');

// offset 存在终端自己的进程内存里——不写瞭望塔的地盘（评审 8-6 判据盯这条）
const _offset = new Map();
const 存储 = { get: (k) => _offset.get(k) || 0, set: (k, v) => _offset.set(k, v) };

let 清账中 = null;   // 清账单飞（评审 8-8）

function 配置路径(根) {
  const 近 = path.join(根, '监视器', '监视器.json');
  if (fs.existsSync(近)) return 近;
  return path.join(__dirname, '..', '..', '监视器', '监视器.json');
}

const 态类 = { 在岗: 'ok', 卡住: 'warn', 超限: 'warn', 阵亡: 'bad', 读不到: 'unk' };
const 坏态 = (t) => t !== '在岗';

/** 顶上的细状态带：管子。平时全绿，一眼扫过；坏了才展开说该干什么。 */
function 渲染带(格们) {
  if (!格们.length) return '';
  return `<div class="wbar" id="wbar">${格们.map((g) => {
    const 坏 = 坏态(g.态);
    return `<span class="wbar-i ${态类[g.态] || 'unk'}" title="${转义(g.问 || '')}">`
      + `<i class="wdot"></i><b>${转义(g.名)}</b>`
      + `<span class="s">${转义(g.态)}</span>`
      + (坏 ? `<span class="why">${转义(String(g.因 || '').slice(0, 60))}</span>` : '')
      + `</span>`;
  }).join('')}</div>`;
}

function 渲染体(g) {
  const 型 = (g.呈现 || {}).型 || '灯';
  const 读不到 = `<p class="unk">读不到 —— 不是零，是没读着</p>`;

  if (型 === '源表') {
    if (!Array.isArray(g.组)) return 读不到;
    return `<ul class="wsrc">${g.组.map((x) => {
      const 坏 = !!x.最近失败;
      return `<li class="wsrc-i ${坏 ? 'bad' : ''}"><span class="n">${转义(x.名称 || x.源 || '')}</span>`
        + `<span class="t">${转义(x.档位 || '')}</span>`
        + `<span class="c">${x.当日条数 === undefined ? '—' : 转义(String(x.当日条数))} 条</span>`
        + `<span class="e">${坏 ? 转义(String((x.最近失败 || {}).因 || '失败').slice(0, 26)) : ''}</span></li>`;
    }).join('')}</ul>`;
  }

  if (型 === '事件流') {
    if (!(g.数 && g.数.读到)) return 读不到;
    const n = Number((g.呈现 || {}).条数) || 12;
    // **先在大窗口上折，再取前 N 组。**右栏 2026-08-31 晚治的就是这个病，
    // 这一页当时没跟着治：实测 12 行去重后只有 5 种，8 行是同一句互保重启对账，
    // 而唯一那条急件（OAuth 自续连败）只占一行，还被重复渲染了两遍。
    const 组 = 事流.折叠(事流.拆事(g.数.行 || []).reverse(), { 上限: n });
    if (!组.length) {
      return `<p class="unk">滤掉例行事件后，没有真事件 —— 产线可能在空转</p>`;
    }
    return `<ul class="wev">${组.map(事流.事条).join('')}</ul>`
      + (g.数.滤掉 ? `<p class="wnote">另滤掉 ${g.数.滤掉} 条例行（心跳/存档/回灌）</p>` : '');
  }

  if (型 === '计数与清单') {
    if (!(g.数 && g.数.读到)) return 读不到;
    const n = g.数.积压;
    if (n === null || n === undefined) return `<p class="unk">积压算不出 —— 水位读不到</p>`;
    const 出 = Number((g.呈现 || {}).出条目) || 8;
    const 水 = String(g.数.水位 || '');
    // **样 而不是 条。**`条` 是本轮增量（第一轮 2000、之后每轮 0），
    // 而 `积压` 是跨轮累计。两个放一起渲染，屏上就是「63 条在等你」配一个空 <ul>——
    // 而这台机器开机自启整天不关，所以他看到的永远是空那一版。
    // `样` 由取数层跨轮保住（见 监视取数.js 的样本环）。
    const 新 = (g.数.样 || g.数.条 || []).filter((e) => e && String(e.t || '') > 水).slice(-出).reverse();
    const 清 = (g.呈现 || {}).可清账 ? `<button class="wbtn" data-ack="1">清账</button>` : '';
    if (!n) return `<p class="wok">都看过了 · 没有在等你的</p>` + 清;
    return `<div class="wcount"><b>${转义(String(n))}</b><span>条在等你</span></div>`
      // **一个数字配一个空清单，是这一格能出的最坏的样子。**宁可说清单取不到。
      + (新.length ? `<ul class="wlist">${新.map(事流.等条).join('')}</ul>`
        : `<p class="unk">清单这一轮没取到 —— 数字是跨轮累计的，不是它凭空来的</p>`)
      + (g.数.坏行 ? `<p class="wbad">坏行 ${g.数.坏行} 条 —— 已计数未吞</p>` : '')
      + 清;
  }
  return '';
}

function 渲染格(g) {
  const 坏 = 坏态(g.态);
  return `<article class="wcell ${态类[g.态] || 'unk'}" data-k="${转义(g.键)}">
  <header class="wcell-h">
    <span class="wdot"></span>
    <h2>${转义(g.名 || g.键)}</h2>
    <span class="wstate">${转义(g.态)}</span>
  </header>
  ${g.问 ? `<p class="wq">${转义(g.问)}</p>` : ''}
  <p class="wwhy">${转义(String(g.因 || '').slice(0, 160))}</p>
  ${坏 && g.坏了做什么 ? `<p class="wdo"><b>怎么办</b>${转义(g.坏了做什么)}</p>` : ''}
  ${渲染体(g)}
</article>`;
}

function 挂(app, opts = {}) {
  const r = express.Router();
  const 根 = opts.根 || process.cwd();
  const 塔根 = opts.塔根 || path.join(opts.数据根 || 根, '瞭望塔');

  const 一轮 = async () => {
    const c = 取.读配置(配置路径(根));
    if (!c.ok) return { 配置错: c.因, 格: [] };
    return await 取.取数(c.配置, { 塔根: 塔根, offset存储: 存储 });
  };

  r.get('/api/watch', async (req, res) => {
    try { res.json(await 一轮()); }
    catch (e) { res.status(500).json({ 配置错: '取数异常：' + String(e.message).slice(0, 120), 格: [] }); }
  });

  r.post('/api/watch/ack', (req, res) => {
    if (清账中) return res.status(409).json({ ok: false, 因: '清账进行中' });
    const 塔js = opts.塔脚本 || path.join(根, '..', 'Ticketflow', 'packages', 'watchtower', 'watchtower.js');
    if (!fs.existsSync(塔js)) return res.status(400).json({ ok: false, 因: '找不到瞭望塔脚本：' + 塔js });
    清账中 = true;
    let 出 = '';
    const c = spawn(process.execPath, [塔js, '--ack', 'latest'], { windowsHide: true });
    c.stdout.on('data', (d) => { if (出.length < 4000) 出 += d; });
    c.stderr.on('data', (d) => { if (出.length < 4000) 出 += d; });
    c.on('close', (码) => { 清账中 = null; res.json({ ok: 码 === 0, 退出码: 码, 出: 出.slice(-1500) }); });
    c.on('error', (e) => { 清账中 = null; res.status(500).json({ ok: false, 因: String(e.message).slice(0, 120) }); });
  });

  r.get('/watch', async (req, res) => {
    const s = await 一轮();
    let body;
    if (s.配置错) {
      body = `<div class="werr"><h1>监视配置读不出</h1><p>${转义(s.配置错)}</p>
        <p class="hint">改 <code>监视器/监视器.json</code>，存盘后刷新即可——不用重启终端。</p></div>`;
    } else {
      const 带 = s.格.filter((g) => g.位 === '带');
      const 主 = s.格.filter((g) => g.位 !== '带');
      // 产线段（2026-09-02 拆栏 · 批三）：主壳右边那条 300px 的「产线脉搏」并到这里。
      // 并过来的正当性不只是"腾地方"——**两处本来就在渲染同一批事件**：
      // app.js 的 事列 与本页的 wev 都调 事流.事条()，同一个渲染函数、两个地方各画一份、
      // 各自定时刷新。合并之后这一份就只剩一处。
      // 骨架由服务端出（首屏不留白），数据由 public/监视.js 取 /api/pulse 填。
      body = 渲染带(带)
        + `<section class="wpulse" id="wpulse">
  <header class="wpulse-h"><h2>产线</h2><span class="wpulse-n" id="wpulse-n">读取中…</span></header>
  <div class="wpulse-b"><div class="wnums" id="wnums"></div><div class="wruns" id="wruns"></div></div>
</section>`
        + `<section class="wgrid" id="wgrid">${主.map(渲染格).join('')}</section>`
        + `<p class="wfoot" id="wfoot">取于 ${转义(s.于本地 || '—')} · 塔根 ${转义(s.塔根 || '')}</p>`;
    }
    res.type('html').send(壳({
      题: '监视 · 游戏开发者终端',
      头部: 头({ 当前: 'watch', 标题: '监视' }),
      样式: '/watch.css',
      body: body,
      // 事流.js 与 顶况.js 都必须排在前面：监视.js 顶层就取 self.事流 / self.顶况。
      // 顶况.js 是 2026-09-02 并入产线段时加的——跑龄的写法（龄文）要与顶条同一把尺，
      // 否则这一页说「4° 12′」而顶条说别的，同一份数据两种说法。
      脚本: '<script src="/事流.js" defer></script><script src="/顶况.js" defer></script><script src="/监视.js" defer></script>',
    }));
  });

  app.use(r);
  return r;
}

module.exports = { 挂, 渲染格, 渲染带, 渲染体 };
