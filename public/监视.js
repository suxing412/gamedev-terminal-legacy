// 监视.js — 监视页的差量刷新与清账。
//
// 只轮询状态接口，不整页重载：常驻屏上整页闪是打扰（PRODUCT.md 原则 4「安静是默认，动是信号」）。
// 每轮只改真的变了的那一格；状态翻转时轻闪一次，动一次就停。
//
// 渲染逻辑与服务端 routes/监视.js 必须一致——首屏由服务端画、之后由这里画，
// 两处画得不一样，人会看到页面在刷新的瞬间跳一下。
(() => {
  'use strict';
  // **每轮重新取，不缓存。** 这一页会被抠成片段塞进主页视图区，
  // 换片时 innerHTML 把旧节点整批丢掉——缓存下来的引用会变成游离节点，
  // 于是定时器照跑、请求照发，更新的却是没挂在文档上的 DOM：
  // **界面看着在跑，其实一个字都不会变**。这类故障不报错，只能靠想到它。
  const 取网 = () => document.getElementById('wgrid');
  const 取带 = () => document.getElementById('wbar');
  const 取脚 = () => document.getElementById('wfoot');
  if (!网) return;

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
      const 行 = (g.数.行 || []).slice(-n).reverse();
      if (!行.length) return '<p class="unk">滤掉例行事件后，没有真事件 —— 产线可能在空转</p>';
      return '<ul class="wev">' + 行.map((l) => {
        const m = String(l).match(/^\[([^\]]+)\]\s*\[([^\]]+)\]\s*(急|常|守望)?\s*([^|]*)\|?\s*(.*)$/);
        const 时 = m ? m[1].slice(11, 16) : '';
        const 级 = m ? (m[3] || '常') : '常';
        const 文 = m ? (m[5] || m[4] || '') : String(l);
        return '<li class="wev-i ' + (级 === '急' ? 'urg' : '') + '"><time>' + 转义(时)
          + '</time><span class="txt">' + 转义(String(文).slice(0, 110)) + '</span></li>';
      }).join('') + '</ul>'
        + (g.数.滤掉 ? '<p class="wnote">另滤掉 ' + g.数.滤掉 + ' 条例行（心跳/存档/回灌）</p>' : '');
    }

    if (型 === '计数与清单') {
      if (!(g.数 && g.数.读到)) return 读不到;
      const n = g.数.积压;
      if (n === null || n === undefined) return '<p class="unk">积压算不出 —— 水位读不到</p>';
      const 出 = Number((g.呈现 || {}).出条目) || 8;
      const 水 = String(g.数.水位 || '');
      const 新 = (g.数.条 || []).filter((e) => e && String(e.t || '') > 水).slice(-出).reverse();
      const 清 = (g.呈现 || {}).可清账 ? '<button class="wbtn" data-ack="1">清账</button>' : '';
      if (!n) return '<p class="wok">都看过了 · 没有在等你的</p>' + 清;
      return '<div class="wcount"><b>' + 转义(String(n)) + '</b><span>条在等你</span></div>'
        + '<ul class="wlist">' + 新.map((e) => {
          const 急 = String(e.级别 || '') === '急';
          return '<li class="wlist-i ' + (急 ? 'urg' : '') + '"><time>' + 转义(String(e.t || '').slice(11, 16))
            + '</time><span class="k">' + 转义(String(e.类型 || e.规则 || '').slice(0, 10))
            + '</span><span class="txt">' + 转义(String(e.摘要 || e.文本 || '').slice(0, 90)) + '</span></li>';
        }).join('') + '</ul>'
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

  async function 一轮() {
    if (停) return;
    const 网 = 取网(); const 脚 = 取脚();
    if (!网) return;            // 不在监视视图上，空跑
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
    if (脚) 脚.textContent = '取于 ' + String(s.于 || '').slice(11, 19) + ' · 塔根 ' + (s.塔根 || '');
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
