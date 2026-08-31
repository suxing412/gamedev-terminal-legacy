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

// **本地时刻，不是 UTC。**
// 原来是对 ISO 串直接切片（`replace('T',' ').slice(5,16)`）——那切出来的是 UTC：
// 真实 18:12 显示成 10:12，整页偏八小时，而它就并排在顶栏那个本地钟旁边。
// 同一族的病这一夜修了四处：/api/events 的月、事件行的日期、监视页的「取于」、这里。
// 它们都是「拿一个 ISO 串当人看的钟面用」。
const p2 = (n) => String(n).padStart(2, '0');
const 时刻 = (t) => {
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return String(t || '').slice(0, 16);   // 解不开就照原样，不编
  return `${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
};

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
    s.静默 = 存照.静默多久((s.条 || [])[(s.条 || []).length - 1], 现在);
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
      // **「末条写了一半」与「末条写完了但已经三天没人说话」是两件事。**
      // 原来只报前者（JSON 未闭合），于是线程静默三天时这一页看起来一切正常：
      // 有内容、有计数、没有警告。而「这条线还活着没有」正是打开这一页要问的。
      if (s.静默) 警.push(`最后一条是 ${s.静默.说}前的 —— 这条线可能已经停了`);
      body = `<div class="cz-wrap">
        <aside class="cz-side">
          <h2>说过话的</h2>
          <!-- **这三个数原来点不动**（cursor:auto，前端只绑了 .cz-i .more）。
               一份「谁说了多少条」的清单摆在旁边，而点它没有任何反应——
               那是这一夜反复在抓的那种「静止的活人」。改成按钮做前端过滤。 -->
          <ul class="cz-seats">${(s.发言人 || []).map((v) => `<li>
            <button type="button" class="cz-seat" data-who="${转义(v.名)}" aria-pressed="false">
              <i></i><span class="n">${转义(v.名)}</span>
              <span class="c">${v.条} 条${v.播报 ? ' · 播报 ' + v.播报 : ''}</span>
            </button></li>`).join('')}</ul>
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
          <ul class="cz-list" id="czList">${s.条.map((x) => 渲染条(x, { 展开播报: 展开 })).join('')}</ul>
          <!-- **开屏落在最旧那条上**是这一页原来的样子：第一条是六天前的，
               最新那条在 14000px 之下，而没有任何一条路直接过去。
               这一页的默认问题是「最近说了什么」，不是「六天前说了什么」。 -->
          <button type="button" class="cz-new" id="czNew" hidden>↓ 跳到最新</button>
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
