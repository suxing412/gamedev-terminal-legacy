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

  // ── 按发言人筛 ────────────────────────────────────────────
  //
  // 左栏那份「谁说了多少条」原来是 `<li>`，`cursor:auto`，前端只绑了 `.cz-i .more`
  // ——**摆在旁边的一份清单，点它没有任何反应**。那是这一夜反复在抓的那种
  // 「静止的活人」：看着能点，其实什么都没接。
  //
  // 只在前端筛（条目已经在页面上了，没必要来回一趟），再点一次取消。
  let 筛谁 = null;
  function 应用谁() {
    const 条 = [...document.querySelectorAll('.cz-i')];
    let 见 = 0;
    for (const li of 条) {
      const who = (li.querySelector('.who') || {}).textContent;
      const 中 = !筛谁 || String(who || '').trim() === 筛谁;
      li.hidden = !中;
      if (中) 见++;
    }
    for (const b of document.querySelectorAll('.cz-seat[data-who]')) {
      const 开 = b.dataset.who === 筛谁;
      b.setAttribute('aria-pressed', String(开));
      b.classList.toggle('开', 开);
    }
    const 条栏 = document.querySelector('.cz-bar .n');
    if (条栏) {
      if (!条栏.dataset.原) 条栏.dataset.原 = 条栏.textContent;
      // **说清这一屏是按谁筛出来的**，也说清这只是本页已加载的那些——
      // 「向上加载更早」还没点过时，筛出来的数小于那个人的总条数。
      条栏.textContent = 筛谁
        ? `只看 ${筛谁}：本页 ${见} 条（点一下取消）`
        : 条栏.dataset.原;
    }
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest('.cz-seat[data-who]');
    if (!b) return;
    筛谁 = (筛谁 === b.dataset.who) ? null : b.dataset.who;
    应用谁();
  });

  // ── 跳到最新 ──────────────────────────────────────────────
  //
  // 开屏 scrollY=0，而第一条是六天前的、最新那条在一万四千像素之下，
  // 且没有任何一条路直接过去。**这一页的默认问题是「最近说了什么」。**
  // 不自动滚（那会把「向上加载更早」的位置也搅乱），给一颗钮。
  function 挂跳新() {
    const 钮 = $('czNew');
    const 列 = $('czList');
    if (!钮 || !列) return;
    // 滚的是**离它最近的那个能滚的祖先**：独立打开时是页面，
    // 被抠成片段塞进主页时是 .视图区。写死 window 的话在壳里一动不动。
    const 找滚 = (el) => {
      for (let n = el.parentElement; n; n = n.parentElement) {
        const st = getComputedStyle(n).overflowY;
        if ((st === 'auto' || st === 'scroll') && n.scrollHeight > n.clientHeight + 4) return n;
      }
      return null;
    };
    const 到底 = () => {
      const 容 = 找滚(列);
      if (容) 容.scrollTop = 容.scrollHeight;
      else window.scrollTo({ top: document.body.scrollHeight });
    };
    钮.hidden = false;
    钮.onclick = 到底;
  }
  挂跳新();
  document.addEventListener('视图装好', 挂跳新);

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
