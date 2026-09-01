// 监视.js — 监视页的差量刷新与清账。
//
// 只轮询状态接口，不整页重载：常驻屏上整页闪是打扰（PRODUCT.md 原则 4「安静是默认，动是信号」）。
// 每轮只改真的变了的那一格；状态翻转时轻闪一次，动一次就停。
//
// 渲染逻辑与服务端 routes/监视.js 必须一致——首屏由服务端画、之后由这里画，
// 两处画得不一样，人会看到页面在刷新的瞬间跳一下。
(() => {
  'use strict';
  const 事流 = self.事流;      // 折叠口径与服务端共用，见 public/事流.js
  // **每轮重新取，不缓存。** 这一页会被抠成片段塞进主页视图区，
  // 换片时 innerHTML 把旧节点整批丢掉——缓存下来的引用会变成游离节点，
  // 于是定时器照跑、请求照发，更新的却是没挂在文档上的 DOM：
  // **界面看着在跑，其实一个字都不会变**。这类故障不报错，只能靠想到它。
  const 取网 = () => document.getElementById('wgrid');
  const 取带 = () => document.getElementById('wbar');
  const 取脚 = () => document.getElementById('wfoot');
  // 这里原来还留着一行 `if (!网) return;`——上一版 `网` 是个 const，改成惰性取函数时
  // 守卫行忘了跟着删。IIFE 顶上是 'use strict'，于是**模块一加载就 ReferenceError**，
  // 这一行之后的全部注册都没发生：3 秒轮询、清账点击委托、visibilitychange、片段重挂，一个都没有。
  // 页面照常渲染（首屏是服务端出的），钟停在服务端写下的那一刻，点清账不变灰、不发请求、不报错。
  // **一次没跟着删的守卫，把整页变成一张会骗人的快照。**
  // 真正的守卫在 一轮() 里（取到 null 就返回），那一处才知道此刻这一页在不在文档上。

  const 态类 = { 在岗: 'ok', 卡住: 'warn', 超限: 'warn', 阵亡: 'bad', 读不到: 'unk' };
  const 坏态 = (t) => t !== '在岗';
  const 上轮 = new Map();
  let 停 = false;

  const 转义 = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  function 画体(g) {
    const 型 = (g.呈现 || {}).型 || '灯';
    const 读不到 = '<p class="unk">读不到 —— 不是零，是没读着</p>';

    if (型 === '源表') {
      if (!Array.isArray(g.组)) return 读不到;
      return '<ul class="wsrc">' + g.组.map((x) => {
        const 坏 = !!x.最近失败;
        return '<li class="wsrc-i ' + (坏 ? 'bad' : '') + '"><span class="n">' + 转义(x.名称 || x.源 || '')
          + '</span><span class="t">' + 转义(x.档位 || '')
          + '</span><span class="c">' + (x.当日条数 === undefined ? '—' : 转义(String(x.当日条数))) + ' 条'
          + '</span><span class="e">' + (坏 ? 转义(String((x.最近失败 || {}).因 || '失败').slice(0, 26)) : '')
          + '</span></li>';
      }).join('') + '</ul>';
    }

    if (型 === '事件流') {
      if (!(g.数 && g.数.读到)) return 读不到;
      const n = Number((g.呈现 || {}).条数) || 12;
      // 拆、折、画三步都走 public/事流.js —— **与服务端首屏同一份代码**。
      // 这一页的头注自己写着「两处画得不一样，人会看到页面在刷新的瞬间跳一下」；
      // 那句话是对的，但靠两边各抄一份来保证，从来没保证住过。
      const 组 = 事流.折叠(事流.拆事(g.数.行 || []).reverse(), { 上限: n });
      if (!组.length) return '<p class="unk">滤掉例行事件后，没有真事件 —— 产线可能在空转</p>';
      return '<ul class="wev">' + 组.map(事流.事条).join('') + '</ul>'
        + (g.数.滤掉 ? '<p class="wnote">另滤掉 ' + g.数.滤掉 + ' 条例行（心跳/存档/回灌）</p>' : '');
    }

    if (型 === '计数与清单') {
      if (!(g.数 && g.数.读到)) return 读不到;
      const n = g.数.积压;
      if (n === null || n === undefined) return '<p class="unk">积压算不出 —— 水位读不到</p>';
      const 出 = Number((g.呈现 || {}).出条目) || 8;
      const 水 = String(g.数.水位 || '');
  // **样 而不是 条。**`条` 是本轮增量（第一轮 2000、之后每轮 0），
  // 而 `积压` 是跨轮累计。两个放一起渲染，屏上就是「63 条在等你」配一个空 <ul>——
  // 而这台机器开机自启整天不关，所以他看到的永远是空那一版。
  // `样` 由取数层跨轮保住（见 监视取数.js 的样本环）。
      const 新 = (g.数.样 || g.数.条 || []).filter((e) => e && String(e.t || '') > 水).slice(-出).reverse();
      const 清 = (g.呈现 || {}).可清账 ? '<button class="wbtn" data-ack="1">清账</button>' : '';
      if (!n) return '<p class="wok">都看过了 · 没有在等你的</p>' + 清;
      return '<div class="wcount"><b>' + 转义(String(n)) + '</b><span>条在等你</span></div>'
        + (新.length ? '<ul class="wlist">' + 新.map(事流.等条).join('') + '</ul>'
          : '<p class="unk">清单这一轮没取到 —— 数字是跨轮累计的，不是它凭空来的</p>')
        + (g.数.坏行 ? '<p class="wbad">坏行 ' + g.数.坏行 + ' 条 —— 已计数未吞</p>' : '')
        + 清;
    }
    return '';
  }

  function 画格(g) {
    const el = document.createElement('article');
    el.className = 'wcell ' + (态类[g.态] || 'unk');
    el.dataset.k = g.键;
    const 坏 = 坏态(g.态);
    el.innerHTML = '<header class="wcell-h"><span class="wdot"></span><h2>' + 转义(g.名 || g.键)
      + '</h2><span class="wstate">' + 转义(g.态) + '</span></header>'
      + (g.问 ? '<p class="wq">' + 转义(g.问) + '</p>' : '')
      + '<p class="wwhy">' + 转义(String(g.因 || '').slice(0, 160)) + '</p>'
      + (坏 && g.坏了做什么 ? '<p class="wdo"><b>怎么办</b>' + 转义(g.坏了做什么) + '</p>' : '')
      + 画体(g);
    return el;
  }

  function 画带(格们) {
    const 带 = 取带();
    if (!带) return;
    if (!带) return;
    带.innerHTML = 格们.map((g) => {
      const 坏 = 坏态(g.态);
      return '<span class="wbar-i ' + (态类[g.态] || 'unk') + '" title="' + 转义(g.问 || '') + '">'
        + '<i class="wdot"></i><b>' + 转义(g.名) + '</b><span class="s">' + 转义(g.态) + '</span>'
        + (坏 ? '<span class="why">' + 转义(String(g.因 || '').slice(0, 60)) + '</span>' : '')
        + '</span>';
    }).join('');
  }

  // ── 产线段（2026-09-02 拆栏 · 批三）──────────────────────────
  //
  // 主壳右边那条 300px 的「产线脉搏」并到这一页。并过来的正当性不只是腾地方：
  // **两处本来就在渲染同一批事件**——app.js 的 事列 与本页的 wev 都调 事流.事条()，
  // 同一个渲染函数、两个地方各画一份、各自定时刷新。合并之后只剩一处。
  //
  // 措辞与顶条那一格共用 顶况.js 的 龄文（同一把尺）；取不到时说取不到，不摆零。
  // 跑龄只有一把尺：顶况.js 的 龄文。**不写回落实现**——一个回落就是第二把尺，
  // 它平时不生效，等哪天 顶况.js 漏挂了就悄悄接管，两边的写法从此各走各的，
  // 而没有任何东西会报错。
  //
  // 但也**不在顶层解引用**。首版写的是 `const 龄文 = self.顶况.龄文;`，
  // 顶况.js 漏挂时整个模块加载即抛，于是 3 秒轮询、清账委托、片段重挂一个都没注册，
  // 而首屏是服务端渲染的——**页面看上去完全正常，只是永远不再更新**。
  // 前端起手.test.js 的「守② 单独加载不抛」当场把这一版拦了下来。
  // 取尺放到用的时候，取不到就不显示龄（少一个数），而不是显示一个另算出来的数。
  const 跑了 = (起) => {
    const t = Date.parse(起 || '');
    if (Number.isNaN(t)) return '';
    const 尺 = self.顶况 && self.顶况.龄文;
    return 尺 ? 尺(Math.floor((Date.now() - t) / 60000)) : '';
  };
  async function 画产线() {
    const 段 = document.getElementById('wpulse'); if (!段) return;
    const 数元 = document.getElementById('wpulse-n');
    const 格元 = document.getElementById('wnums');
    const 跑元 = document.getElementById('wruns');
    let r;
    try { r = await fetch('/api/pulse').then((x) => x.json()); } catch { r = { 读不到: true, 因: '终端后端不通' }; }
    if (r.读不到) {
      if (数元) { 数元.textContent = '读不到监制台（' + (r.因 || '') + '）'; 数元.className = 'wpulse-n unk'; }
      if (格元) 格元.innerHTML = '';
      if (跑元) 跑元.innerHTML = '<p class="unk">读不到 —— 不是零，是没读着</p>';
      return;
    }
    const c = r.计数 || {};
    const 跑 = r.在跑 || [];
    if (数元) { 数元.className = 'wpulse-n'; 数元.textContent = 跑.length ? '在跑 ' + 跑.length : '零在跑'; }
    if (格元) {
      格元.innerHTML = [
        ['在途', (c['在途'] || 0) + (c['初检'] || 0) + (c['核查'] || 0) + (c['仲裁'] || 0)],
        ['待派', (c['待派'] || 0) + (c['待重派'] || 0) + (c['已排期'] || 0)],
        ['候验收', c['完成'] || 0],
        ['已落袋', c['归档'] || 0],
      ].map(([标, 值]) => '<div class="wnum"><span class="k">' + 标 + '</span><b class="v'
        + (值 ? '' : ' 零') + '">' + 值 + '</b></div>').join('');
    }
    if (跑元) {
      跑元.innerHTML = 跑.length
        ? 跑.map((x) => '<div class="wrun"><i class="wdot"></i><span class="n">' + 转义(x.单)
          + '</span><span class="e">' + 转义(x.环节) + '</span><span class="t">' + 跑了(x.起时) + '</span></div>').join('')
        : '<p class="unk">无在跑会话</p>';
    }
  }

  async function 一轮() {
    if (停) return;
    const 网 = 取网(); const 脚 = 取脚();
    if (!网) return;            // 不在监视视图上，空跑
    画产线();                    // 与状态格各走各的请求：一边取不到不该把另一边也拖黑
    let s;
    try { s = await fetch('/api/watch').then((x) => x.json()); }
    catch { if (脚) 脚.textContent = '取不到状态 —— 终端后端不通'; return; }
    if (s.配置错) { if (脚) 脚.textContent = '配置读不出：' + s.配置错; return; }

    const 全 = s.格 || [];
    画带(全.filter((g) => g.位 === '带'));

    const 主 = 全.filter((g) => g.位 !== '带');
    const 在册 = new Set();
    for (const g of 主) {
      在册.add(g.键);
      // 指纹要盖住所有会上屏的东西。漏一样，那一样变了界面就不刷新——
      // 「界面看着没变」与「真的没变」在值班屏上是绝不能混的两件事。
      const 印 = JSON.stringify([g.态, g.因, g.数 && g.数.有效行数, g.数 && g.数.积压,
        g.数 && g.数.坏行, g.数 && g.数.滤掉, g.数 && g.数.水位, g.组,
        g.数 && g.数.行 && g.数.行.slice(-3)]);
      if (上轮.get(g.键) === 印) continue;
      const 旧 = 网.querySelector('[data-k="' + CSS.escape(g.键) + '"]');
      const 新 = 画格(g);
      const 翻 = 旧 && !旧.classList.contains(态类[g.态] || 'unk');
      if (旧) 旧.replaceWith(新); else 网.appendChild(新);
      if (翻) { 新.classList.add('flip'); setTimeout(() => 新.classList.remove('flip'), 1000); }
      上轮.set(g.键, 印);
    }
    for (const el of [...网.querySelectorAll('.wcell')]) {
      if (!在册.has(el.dataset.k)) { el.remove(); 上轮.delete(el.dataset.k); }
    }
    // 用服务端算好的本地钟面。对 ISO 切 slice(11,19) 切出来的是 UTC——
    // 本地 23:52 会显示成 15:50，比屏上别的钟早八小时。
    if (脚) 脚.textContent = '取于 ' + (s.于本地 || '—') + ' · 塔根 ' + (s.塔根 || '');
  }

  // 委托到 document：挂在 网 上的话，换一次片这个监听就跟着旧节点消失了
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-ack]');
    if (!b) return;
    b.disabled = true; const 原 = b.textContent; b.textContent = '清账中…';
    try {
      const r = await fetch('/api/watch/ack', { method: 'POST' }).then((x) => x.json());
      b.textContent = r.ok ? '已清账' : ('失败：' + String(r.因 || r.退出码));
      if (r.ok) 上轮.clear();
    } catch { b.textContent = '清账没打通'; }
    setTimeout(() => { b.textContent = 原; b.disabled = false; }, 2500);
  });

  document.addEventListener('visibilitychange', () => { 停 = document.hidden; if (!停) 一轮(); });
  一轮();
  setInterval(一轮, 3000);
  // 换片后立刻补一轮，不用等下一个 3 秒——刚点进来看见空格子会以为它坏了
  document.addEventListener('视图装好', () => { 上轮.clear(); 一轮(); });
})();
