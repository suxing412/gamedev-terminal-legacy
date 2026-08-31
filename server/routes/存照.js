// 存照.js — 席间存照页（路径仍是 /chat，只改显示名）。
//
// 方案与五轮评审见 docs/方案-席间存照-2026-08-29.md。
// 路径不改是刻意的（四评击杀②）：二稿写「/chat 保留 302 到新路径」，
// 同时又把 /chat 定义为本页——一个响应不能既是本页 200 又是 302。
// **名字是给人看的，路径是给机器用的，两者不必同步。**
'use strict';

const express = require('express');
const path = require('path');
const 存照 = require('../lib/存照');
const { 壳, 头 } = require('../render/页');
const { 转义 } = require('../render/md');

// 末行首见时刻（进程内）。不靠 mtime——写方每 4 分 59 秒补一字节的话 mtime 永远新鲜（五评击杀③）
let 末行首见 = null;
let 末行印 = null;

function 线程路径(数据根) {
  return path.join(数据根, '遥控', 'thread.jsonl');
}

const 时刻 = (t) => String(t || '').replace('T', ' ').slice(5, 16);

function 渲染条(x, o = {}) {
  const 折 = x.播报 && !o.展开播报;
  if (折) {
    const 首 = String(x.text).split('\n')[0].trim();
    return `<li class="cz-i fold" data-id="${转义(x.id)}"><span class="who">${转义(x.from)}</span>`
      + `<time>${转义(时刻(x.t))}</time><span class="txt">${转义(首.slice(0, 60))}</span></li>`;
  }
  const 长 = x.行数 > 6 || String(x.text).length > 600;
  return `<li class="cz-i${x.产出物 ? ' art' : ''}" data-id="${转义(x.id)}">
    <div class="hd"><span class="who">${转义(x.from)}</span><time>${转义(时刻(x.t))}</time>
      ${x.播报 ? '<span class="tag">例行</span>' : ''}</div>
    ${x.产出物 ? `<div class="art-b">${转义(String(x.text).split('\n')[0].trim())} · ${String(x.text).length} 字</div>` : ''}
    <div class="bd${长 ? ' clip' : ''}">${转义(x.text)}</div>
    ${长 ? '<button class="more">展开全文</button>' : ''}
  </li>`;
}

function 挂(app, opts = {}) {
  const r = express.Router();
  const 数据根 = opts.数据根 || opts.根 || process.cwd();

  const 取 = (q) => {
    const p = 线程路径(数据根);
    const 现在 = Date.now();
    const s = 存照.读(p, { 起行: q && q.beforeLine ? Number(q.beforeLine) : undefined, 取数: 60 });
    if (!s.ok) return s;
    // 末行未闭合的首见时刻：印变了就重新计时（说明是新的一条在写）
    if (s.末行未闭合) {
      const 印 = s.总行数 + ':' + s.末半字节;
      if (末行印 !== 印) { 末行印 = 印; 末行首见 = 现在; }
    } else { 末行印 = null; 末行首见 = null; }
    s.末行陈旧 = 存照.末行陈旧(末行首见 ? { 首见: 末行首见 } : null, 现在);
    return s;
  };

  r.get('/api/chat/thread', (req, res) => {
    const s = 取(req.query);
    if (!s.ok) return res.status(200).json(s);   // 读不到也是一种状态，不是服务错误
    res.json(s);
  });

  // 路径不变，仍是 /chat（四评击杀②）
  r.get('/chat', (req, res) => {
    const s = 取(req.query);
    const 展开 = req.query.播报 === '1';
    let body;
    if (!s.ok) {
      body = `<div class="cz-err"><h1>读不到线程</h1><p>${转义(s.因)}</p>
        <p class="hint">这不是「零条发言」——是没读着。线程在 <code>遥控/thread.jsonl</code>。</p></div>`;
    } else {
      const 警 = [];
      if (s.坏行) 警.push(`坏行 ${s.坏行} 条（写坏了，已计数未吞）`);
      if (s.结构坏行) 警.push(`结构坏行 ${s.结构坏行} 条（合法 JSON 但形状不对）`);
      if (s.末行陈旧) 警.push(`末条记录未写完（已 ${s.末行陈旧.分钟} 分钟）—— 写方可能崩了`);
      body = `<div class="cz-wrap">
        <aside class="cz-side">
          <h2>说过话的</h2>
          <ul class="cz-seats">${(s.发言人 || []).map((v) => `<li class="cz-seat">
            <i></i><span class="n">${转义(v.名)}</span>
            <span class="c">${v.条} 条${v.播报 ? ' · 播报 ' + v.播报 : ''}</span></li>`).join('')}</ul>
          <h2 class="cz-h2b">名单上的坐席</h2>
          <ul class="cz-seats" id="czSeats"><li class="hint">读取中…</li></ul>
          <p class="cz-note">名单与实际说话的人**是两套名字空间**：线程里说话的是上面那几位，
          名单是 <code>坐席.js</code> 登记的职能。两边对不上不是显示错误，是实况——
          写在这里而不是抹平，因为抹平就又变成一个黑箱。</p>
        </aside>
        <section class="cz-main">
          <div class="cz-bar">
            <span class="n">${s.总条数} 条 · 附件 ${s.附件数} · 例行播报 ${s.播报数} 条 ${展开 ? '已展开' : '已折叠'}</span>
            <a class="cz-tog" href="/chat${展开 ? '' : '?播报=1'}">${展开 ? '折起例行播报' : '展开例行播报'}</a>
          </div>
          ${警.length ? `<p class="cz-warn">${警.map(转义).join(' · ')}</p>` : ''}
          ${s.还有更早 ? `<a class="cz-more" href="/chat?beforeLine=${s.条[0].行序}${展开 ? '&播报=1' : ''}">向上加载更早（还有 ${s.条[0].行序 - 1} 行）</a>` : ''}
          <ul class="cz-list">${s.条.map((x) => 渲染条(x, { 展开播报: 展开 })).join('')}</ul>
        </section>
      </div>`;
    }
    res.type('html').send(壳({
      题: '席间存照 · 游戏开发者终端',
      头部: 头({ 当前: 'chat', 标题: '席间存照' }),
      样式: '/存照.css',
      body: body,
      脚本: '<script src="/存照.js" defer></script>',
    }));
  });

  app.use(r);
  return r;
}

module.exports = { 挂, 渲染条 };
