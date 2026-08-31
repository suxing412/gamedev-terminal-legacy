// 存照.js — 席间存照页的前端：坐席名单 + 展开全文。
//
// 这一页是查档不是值班屏，**不轮询**：内容是历史，历史不会在你看的时候变。
// 名单从 /api/seats 拿——前端不许自带一份，那正是 server/lib/坐席.js 头注要避免的
// 「界面、@ 路由与调用层各存一份名单」。
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const 转义 = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  // ── 坐席名单 ──
  // 抽成具名函数并在「视图装好」时重跑：这一页会被抠成片段塞进主页视图区，
  // 只在加载时跑一次的话，换片后 #czSeats 是一个新的空节点，**名单永远不出现**。
  const 上名单 = (async () => {
    const ul = $('czSeats');
    if (!ul) return;
    let r;
    try { r = await fetch('/api/seats').then((x) => x.json()); }
    catch { ul.innerHTML = '<li class="hint">坐席名单读不到 —— 不是零席，是没读着</li>'; return; }
    const 席 = (r && r.席) || [];
    if (!席.length) { ul.innerHTML = '<li class="hint">名单为空 —— 不是零席，是没配</li>'; return; }
    // 每席说过多少条：从页面已渲染的条目里数（不另发请求）
    const 计 = {};
    for (const el of document.querySelectorAll('.cz-i .who')) {
      const n = el.textContent.trim();
      计[n] = (计[n] || 0) + 1;
    }
    ul.innerHTML = 席.map((s) => {
      const c = 计[s.名] || 0;
      return '<li class="cz-seat' + (s.接模型 ? '' : ' off') + '" title="' + 转义(s.人设 || '') + '">'
        + '<i></i><span class="n">' + 转义(s.名) + '</span>'
        + '<span class="c">' + (s.接模型 ? (c ? c + ' 条' : '—') : '未接') + '</span></li>';
    }).join('');
  });
  上名单();
  document.addEventListener('视图装好', 上名单);

  // ── 展开全文：折叠只管视觉高度，判不判折是服务端按逻辑行定的 ──
  document.addEventListener('click', (e) => {
    const b = e.target.closest('.cz-i .more');
    if (!b) return;
    const bd = b.parentElement.querySelector('.bd');
    if (!bd) return;
    const 开 = bd.classList.toggle('open');
    b.textContent = 开 ? '收起' : '展开全文';
  });
})();
