// 文稿.js — 文稿台的前端（批二：只读）
//
// 三件事：文件名过滤（本地）、正文搜索（走服务端）、记号栏跳转与转交。
//
// ── 为什么整个是一个可重复调用的 装() ──────────────────────────
// 这一页有两种活法：独立打开（脚本随页面加载跑一次），
// 和被抠成片段塞进主页视图区（**同一份 DOM 会被反复换掉**）。
// 换片时 innerHTML 把旧节点连同事件监听一起丢了，所以每换一次都要重新绑。
// 视图.js 换完片会广播 `视图装好`，这里接住它再装一遍。
//
// 装() 必须**幂等且能空跑**：换到别的视图时它也会被调用，那时页面上没有 .稿台，直接返回。
//
// **不整页 reload、不改地址栏**：那会把壳一起冲掉（群聊.js 今天就有这个 bug）。
// 文件切换走 <a>，由 视图.js 的片段拦截器接管。
(function () {
  'use strict';

  const $ = (s, 根) => (根 || document).querySelector(s);
  const $$ = (s, 根) => Array.prototype.slice.call((根 || document).querySelectorAll(s));

  const 记 = {
    读(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    写(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* 隐私窗、禁站点数据都可能抛 */ } },
  };

  function 装() {
    const 台 = $('.稿台');
    if (!台) return;              // 不在文稿视图上，空跑

    // ── 一、文件名过滤 ────────────────────────────────────
    const 框 = $('#稿搜框');
    const 计 = $('#稿计');
    const 原计文 = 计 ? 计.textContent : '';

    // ── 筛选状态 ──
    // 三条互相叠加：词 / 只看有记号 / 只看可写 / 只看某几类。
    // **叠加而不是互斥**——「在办文稿里有记号的」是最常问的那一句，
    // 而它需要两条同时成立。
    // 正文：回车搜正文得到的命中路径集（null = 没搜过正文）。
    // **它是筛的一个字段，不是另一条渲染路径**——那正是 S3 那个洞：
    // 正文搜索另走一条 只留()，把记号/可写/类三个筛静默作废，而钮还亮着。
    const 筛 = { 词: '', 记号: false, 可写: false, 类: new Set(), 正文: null };

    function 应用筛() {
      const q = 筛.词;
      let 见 = 0;
      $$('.稿组', 台).forEach((组) => {
        const 组类 = 组.getAttribute('data-类');
        const 类过 = !筛.类.size || 筛.类.has(组类);
        let 组见 = 0;
        $$('.稿项', 组).forEach((a) => {
          const 路 = (a.getAttribute('data-路') || '');
          // 正文命中并进同一条链路。**它此前是另走一条路的**（只留()），
          // 那条路完全不读 筛.记号/筛.可写/筛.类，于是回车搜一次正文，
          // 两颗亮着的筛选钮就静默作废了，而计数条还写着「94 份含『协议』」——
          // 摆在两颗亮钮下面，读作「有记号 ∧ 方案与评审 ∧ 协议 = 94」。
          // 数字是真的，口径是假的。
          const 词中 = !q || 路.indexOf(q) >= 0 || (筛.正文 && 筛.正文.has(路));
          const 中 = 类过 && 词中
            && (!筛.记号 || a.getAttribute('data-记') === '1')
            && (!筛.可写 || a.getAttribute('data-可写') === '1');
          a.hidden = !中;
          if (中) { 见++; 组见++; }
        });
        组.classList.toggle('空', 组见 === 0);
        // 有筛选时摊开命中的组；**筛选全清了要回到默认展开态**——
        // 首版这里没有 else 支，于是一开一关之后每个组都还开着（实测 2.0 屏 → 30.3 屏），
        // 而界面此刻宣称「无筛选」、清筛选钮也正好被藏了起来：
        // **恢复的出口恰在最需要它的那一刻消失。**
        if (q || 筛.记号 || 筛.可写 || 筛.类.size) 组.open = 组见 > 0;
        else 组.open = 默认开.has(组类);
      });
      const 清 = document.getElementById('筛清');
      const 有筛 = !!(q || 筛.记号 || 筛.可写 || 筛.类.size);
      if (清) 清.hidden = !有筛;
      if (计) {
        计.textContent = 有筛 ? `${见} 份命中${说筛()}` : 原计文;
      }
      // **筛完为空要有话说。**只把组藏起来的话，屏上是一片空白——
      // 而空白在值班屏上永远读作「它坏了」，不是「没有命中」。
      // （这一条是自己刚做出来的洞：加了筛选却没加筛空的出口。）
      const 列 = document.getElementById('稿列');
      let 空条 = 列 && 列.querySelector('.稿筛空');
      if (见 === 0 && 有筛) {
        if (!空条 && 列) {
          空条 = document.createElement('div');
          空条.className = '稿筛空';
          列.appendChild(空条);
        }
        if (空条) {
          空条.innerHTML = `<b>没有文档命中这组筛选</b>`
            + `<p>当前条件${说筛().replace(/^：/, '：')}</p>`
            + `<button type="button" class="筛钮 清" data-清>清掉筛选</button>`;
          空条.hidden = false;
        }
      } else if (空条) {
        空条.hidden = true;
      }
      return 见;
    }

    function 说筛() {
      const 条 = [];
      if (筛.词) 条.push(筛.正文 ? `「${筛.词}」(含正文)` : `「${筛.词}」`);
      if (筛.记号) 条.push('有记号');
      if (筛.可写) 条.push('可写');
      if (筛.类.size) 条.push(`${筛.类.size} 类`);
      return 条.length ? '：' + 条.join(' · ') : '';
    }

    const 过滤 = (词) => { 筛.词 = String(词 || '').trim().toLowerCase(); return 应用筛(); };

    // 三个开关钮
    const 挂钮 = (id, 键) => {
      const b = document.getElementById(id);
      if (!b || b.disabled) return;
      b.addEventListener('click', () => {
        筛[键] = !筛[键];
        b.classList.toggle('开', 筛[键]);
        应用筛();
      });
    };
    挂钮('筛记号', '记号');
    挂钮('筛可写', '可写');

    const 类栏 = document.getElementById('类筛');
    if (类栏) {
      类栏.addEventListener('click', (e) => {
        const b = e.target.closest('.类筛钮');
        if (!b) return;
        const k = b.getAttribute('data-类');
        if (筛.类.has(k)) 筛.类.delete(k); else 筛.类.add(k);
        b.classList.toggle('开', 筛.类.has(k));
        应用筛();
      });
    }

    // 服务端渲染时哪几组是开的，就是默认展开态。**不写死 'zaiban'**：
    // 那样服务端一改默认，这里就悄悄跟它分了家。
    const 默认开 = new Set(
      $$('.稿组', 台).filter((g) => g.open).map((g) => g.getAttribute('data-类')),
    );

    function 清筛() {
      筛.词 = ''; 筛.记号 = false; 筛.可写 = false; 筛.类.clear(); 筛.正文 = null;
      if (框) 框.value = '';
      $$('.筛钮, .类筛钮', 台).forEach((b) => b.classList.remove('开'));
      $$('.稿项', 台).forEach((a) => { a.hidden = false; });
      $$('.稿组', 台).forEach((g) => {
        g.classList.remove('空');
        g.open = 默认开.has(g.getAttribute('data-类'));   // 与 应用筛 用同一份默认
      });
      if (计) 计.textContent = 原计文;
      const c = document.getElementById('筛清'); if (c) c.hidden = true;
      const e = 台.querySelector('.稿筛空'); if (e) e.hidden = true;
    }
    // 两个入口共用一条出路：筛选栏上那个「清筛选」，与筛空态里那个「清掉筛选」。
    // 委托到 .稿库 上，因为筛空态那个按钮是后来才插进 DOM 的。
    const 库 = 台.querySelector('.稿库');
    if (库) {
      库.addEventListener('click', (e) => {
        if (e.target.closest('#筛清') || e.target.closest('[data-清]')) 清筛();
      });
    }

    if (框) {
      // 改一个字，上一次的正文命中就过期了。**不清掉的话它会继续放行那批文件**，
      // 屏上就成了「搜『协议x』还是 94 条」——那 94 条里 93 条不含这个词。
      框.addEventListener('input', () => { 筛.正文 = null; 过滤(框.value); });
      框.addEventListener('keydown', async (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const q = 框.value.trim();
        if (q.length < 2) return;
        // ── 二、正文搜索：要读盘，走服务端 ──
        if (计) 计.textContent = '搜正文…';
        try {
          const r = await fetch('/api/doc/search?q=' + encodeURIComponent(q));
          const j = await r.json();
          if (!j.行) { if (计) 计.textContent = j.因 || '搜不动'; return; }
          // **写进筛，然后走同一条 应用筛()。**另走一条路正是 S3 那个洞：
          // 那条路不读记号/可写/类三个筛，把它们静默作废，而钮还亮着。
          筛.正文 = new Set(j.命中.map((x) => (x.根 + '/' + x.相对).toLowerCase()));
          筛.词 = q.toLowerCase();
          const 见 = 应用筛();
          // 服务端只回前 60 条，但它同时告诉我们总共几条 —— **不说的话，
          // 「只有这么多」和「只给你看这么多」在屏上是同一句话**。
          if (计 && j.余 > 0) 计.textContent += `（正文命中 ${j.总} 份，这里只列前 ${j.总 - j.余} 份）`;
          if (!见 && 计) 计.textContent = `没有文档含「${q}」${说筛().replace(/^：[^·]*/, '')}`;
        } catch (err) {
          if (计) 计.textContent = '搜不动：' + (err && err.message ? err.message : err);
        }
      });
    }

    // ── 三、收起文件库 ────────────────────────────────────
    //
    // 壳里中栏只有 ~720px，库占 300 之后正文剩 420px ≈ 27 个汉字一行——太窄。
    // 所以**窄容器下打开文档时默认收起**；宽的时候不动它。
    // 这一步只能靠 JS：容器查询管不了容器自己，改不了 稿台 的列模板。
    const 库钮 = $('#稿库钮');
    if (库钮) {
      const 选 = 记.读('稿库');
      if (选 === '收') 台.classList.add('收库');
      else if (选 !== '展' && 台.classList.contains('有档')
        && 台.getBoundingClientRect().width < 1040) 台.classList.add('收库');
      库钮.addEventListener('click', () => {
        记.写('稿库', 台.classList.toggle('收库') ? '收' : '展');
      });
    }

    // ── 三点二、用途覆写 ──────────────────────────────────
    //
    // 分类是按文件名猜的（实测 68/73）。**猜不中的那几份此前没有任何办法纠正**——
    // 制作人 2026-09-01 拍板要能手工覆写。
    //
    // 覆写写进文档头的 frontmatter（`用途: 规章`），不写进某处数据库：
    // 这样它跟着文档走，换台机器、拷给别人、用别的编辑器打开，那一行都还在。
    // 但**他不会去记 frontmatter 的语法**，所以这里给一颗钮。
    const 类钮 = $('#稿类');
    if (类钮 && !类钮.disabled) {
      类钮.addEventListener('click', async () => {
        const 位 = (() => {
          const 在 = document.querySelector('.稿项.在');
          if (在) { const u = new URL(在.href, location.origin); return { r: u.searchParams.get('r'), p: u.searchParams.get('p') }; }
          const q = new URLSearchParams(location.search);
          return { r: q.get('r'), p: q.get('p') };
        })();
        if (!位.r || !位.p) return;

        // 选项从**页面上真实存在的那几组**取，不在前端另写一份类别表——
        // 服务端加一类而前端不知道，是「两份名单必然分叉」那一族。
        const 类们 = [...document.querySelectorAll('.稿组[data-类]')]
          .map((g) => ({ 键: g.getAttribute('data-类'), 名: (g.querySelector('.组名') || g.querySelector('summary') || {}).textContent || '' }))
          .filter((x) => x.键 && x.键 !== 'qita');
        if (!类们.length) { 告('读不到类别表——左边的文件库还没装好。'); return; }

        const 今 = 类钮.getAttribute('data-类');
        const 定 = 类钮.getAttribute('data-定') === '1';
        const 钮们 = 类们
          .filter((x) => x.键 !== 今)
          .map((x) => ({ 名: (x.名 || x.键).replace(/\s*\d+\s*$/, '').trim(), 值: x.键 }));
        // 「跟着猜」只在他已经定过的时候给——没定过的时候它就是当前状态，摆出来是噪声
        if (定) 钮们.push({ 名: '跟着猜', 值: '' });
        钮们.push({ 名: '算了', 值: null, 退: true });

        const 选 = await 幕('这份文档是什么用途',
          定 ? `现在是「${类钮.textContent.trim()}」，是你定的。\n改一个，或者交还给规则去猜。`
            : `现在是「${类钮.textContent.trim()}」，是按文件名猜的。\n猜得不对就改一个——会写进文档头的「用途」那一行。`,
          钮们);
        if (选 === null || 选 === undefined) return;

        try {
          // 路径是 ASCII 的。写中文路径会 404 —— 浏览器把它百分号编码，
          // 而 Express 拿未解码的 req.path 匹配路由表，永远对不上（见服务端那段注释）。
          const r = await 发('/api/doc/purpose', { r: 位.r, p: 位.p, 用途: 选 });
          const j = await r.json().catch(() => ({}));
          if (!r.ok || !j.行) { 告(j.因 || `改不动（HTTP ${r.status}）`); return; }
          // 重取片段：类别变了，左边的分组、右边的钮、组的展开态都要跟着动。
          // **不自己改 DOM**——那会和服务端的判断分家，而分家的那一刻没人看得出来。
          location.assign(`/doc?r=${encodeURIComponent(位.r)}&p=${encodeURIComponent(位.p)}`);
        } catch (e) {
          告('改不动：' + (e && e.message ? e.message : e));
        }
      });
    }

    // ── 三点五、版本历史 ──────────────────────────────────
    //
    // **后端存着 50 版，而在这之前前端一个入口都没有。**
    // 「存了但看不到」跟没存的区别，只在你肯去翻磁盘时才成立——而人不会去翻磁盘。
    // 冲突框里那句「盘上那版已经存进版本历史，可以找回」原本是句空话：
    // 承诺了一条路，路口却没有门。**2026-09-01 补上了那扇门**——
    // 每一版可以「和当前比」（复用冲突框那个 画差异）与「用这一版覆盖编辑器」。
    const 史钮 = $('#稿史钮');
    const 史盒 = $('#稿史');
    if (史钮 && 史盒) {
      const 位 = () => {
        const 在 = document.querySelector('.稿项.在');
        if (在) {
          const u = new URL(在.href, location.origin);
          return { r: u.searchParams.get('r'), p: u.searchParams.get('p') };
        }
        const q = new URLSearchParams(location.search);
        return { r: q.get('r'), p: q.get('p') };
      };
      史钮.addEventListener('click', async () => {
        if (!史盒.hidden) { 史盒.hidden = true; 史钮.classList.remove('开'); return; }
        const { r, p } = 位();
        if (!r || !p) return;
        史盒.hidden = false; 史钮.classList.add('开');
        史盒.innerHTML = '<div class="史载">取历史…</div>';
        try {
          const j = await (await fetch(`/api/doc/versions?r=${encodeURIComponent(r)}&p=${encodeURIComponent(p)}`)).json();
          const 版 = (j.版们 || []);
          if (!版.length) { 史盒.innerHTML = '<div class="史空">这份还没有版本历史——存过一次盘之后就有了。</div>'; return; }
          史盒.innerHTML = '<div class="史头">历次版本 <b>' + 版.length + '</b>'
            + '<span>每一次写入都留一版，带「谁写的」；上限 50 版</span></div>'
            + '<div class="史条们">' + 版.map((v) => {
              const t = new Date(v.时);
              const 时文 = Number.isFinite(v.时) && v.时 > 0
                ? `${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')} ${t.toTimeString().slice(0, 5)}`
                : '时刻不明';
              return `<button type="button" class="史条" data-档="${encodeURIComponent(v.档)}">`
                + `<span class="史时">${时文}</span>`
                + `<span class="史谁">${(v.谁 || '未知').replace(/[&<>]/g, '')}</span>`
                + (v.无索引 ? '<span class="史疑" title="这一版的元信息缺失，「谁写的」是从文件名回读的">存疑</span>' : '')
                + '</button>';
            }).join('') + '</div><div class="史文" id="史文" hidden></div>';
        } catch (e) {
          史盒.innerHTML = '<div class="史空 坏">取不到历史：' + (e && e.message ? e.message : e) + '</div>';
        }
      });
      // 当前选中的那一版。**放在闭包里而不是 DOM 上**：切换「全文/和当前比」
      // 只是换一种画法，不该再去服务端取一次。
      let 史文 = null;

      // 「当前」是谁：**只有在编辑模式下前端手上才有源码**。
      // 不在编辑时，页面上是渲染好的 HTML，不是 markdown——
      // 拿它去比会得出一堆假差异，那比不给对比更坏。所以那时把这个钮禁掉并说明原因。
      const 当前文 = () => {
        if (编 && 编.编器) return { 文: 编.编器.取文(), 说: '编辑器里这份（含未存的改动）' };
        return null;
      };

      function 画史文(模式) {
        const 格 = document.getElementById('史文');
        if (!格 || !史文) return;
        格.hidden = false;
        const 当 = 当前文();
        const 可比 = !!(当 && window.文稿编辑 && window.文稿编辑.画差异);
        const 条 = '<div class="史条栏">'
          + `<button type="button" class="史模" data-模="全"${模式 === '全' ? ' class="在"' : ''}>全文</button>`
          + `<button type="button" class="史模" data-模="比"${可比 ? '' : ' disabled title="要先进编辑模式：不在编辑时页面上是渲染好的 HTML，不是源码，拿它去比会得出一堆假差异"'}>和当前比</button>`
          + `<button type="button" class="史用" data-用="1"${编 && 编.编器 ? '' : ' disabled title="要先进编辑模式，才有地方放"'}>用这一版覆盖编辑器</button>`
          + `<span class="史注">${模式 === '比' && 当 ? '左＝这一版　右＝' + 当.说 : ''}</span>`
          + '</div>';
        if (模式 === '比' && 可比) {
          格.innerHTML = 条 + '<div class="史差">' + window.文稿编辑.画差异(史文.文, 当.文) + '</div>';
        } else {
          格.innerHTML = 条 + '<pre class="史全"></pre>';
          格.querySelector('.史全').textContent = 史文.文;
        }
        for (const x of $$('.史模', 格)) x.classList.toggle('在', x.getAttribute('data-模') === 模式);
      }

      史盒.addEventListener('click', async (e) => {
        const 模 = e.target.closest('.史模');
        if (模) { 画史文(模.getAttribute('data-模')); return; }
        const 用 = e.target.closest('.史用');
        if (用) {
          if (!编 || !编.编器 || !史文) return;
          // **只灌进编辑器，不落盘。**落盘仍走存盘闸（锁、基指纹、三路合并全都还在）——
          // 「恢复」在这里的意思是「把这一版摆到你面前」，不是「替你决定了」。
          const 答 = await 问(`把 ${史文.时} 那一版覆盖进编辑器？\n\n当前未保存的改动会被顶掉（它还在草稿里）。\n覆盖之后要按存盘才真的写回盘上。`,
            '用这一版', '覆盖', '算了');
          if (!答) return;
          编.编器.设文(史文.文);
          编.脏 = true;
          态文(`已换成 ${史文.时} 那一版 · 未保存`, '警');
          排草稿();
          return;
        }
        const b = e.target.closest('.史条');
        if (!b) return;
        const { r, p } = 位();
        $$('.史条', 史盒).forEach((x) => x.classList.remove('在'));
        b.classList.add('在');
        const 文格 = document.getElementById('史文');
        if (!文格) return;
        文格.hidden = false;
        文格.textContent = '取…';
        try {
          const j = await (await fetch(`/api/doc/version?r=${encodeURIComponent(r)}&p=${encodeURIComponent(p)}&v=${b.getAttribute('data-档')}`)).json();
          if (!j.行) { 文格.textContent = '读不到这一版：' + (j.因 || ''); return; }
          // **看得到，还要拿得回来。**
          //
          // 在这之前这里只把全文塞进一个 26vh 高的滚动 div——没有恢复、没有对比、
          // 没有复制。而冲突框那句「盘上那版已经存进版本历史，可以找回」
          // 就成了一句空话：**承诺了一条路，路口却没有门**。
          // 画差异 就在手边（冲突框正在用它），/api/doc/version 也已经把全文回给前端了。
          史文 = { 档: b.getAttribute('data-档'), 文: j.文, 时: b.querySelector('.史时').textContent };
          画史文('全');
        } catch (err) { 文格.textContent = '读不到这一版：' + (err && err.message ? err.message : err); }
      });
    }

    // ── 四、记号栏：跳转 ──────────────────────────────────
    const 正文 = $('#稿正文');

    function 跳(行号) {
      if (!正文) return;
      // 精确命中优先；没有就找**不大于它的最近一个块**——
      // 记号可能落在多行块（表格、围栏）的中间行上，那一行本身没有锚点。
      let 的 = 正文.querySelector('[data-行="' + 行号 + '"]');
      if (!的) {
        let 最好 = null;
        $$('[data-行]', 正文).forEach((el) => {
          const n = Number(el.getAttribute('data-行'));
          if (Number.isFinite(n) && n <= 行号 && (!最好 || n > 最好.n)) 最好 = { el, n };
        });
        的 = 最好 && 最好.el;
      }
      if (!的) return;
      的.scrollIntoView({ block: 'center', behavior: 'smooth' });
      $$('.跳', 正文).forEach((el) => el.classList.remove('跳'));
      的.classList.add('跳');
    }

    $$('.记条', 台).forEach((a) => {
      a.addEventListener('click', (e) => {
        e.preventDefault();
        $$('.记条', 台).forEach((x) => x.classList.remove('在'));
        a.classList.add('在');
        跳(Number(a.getAttribute('data-行')));
      });
    });

    // ── 五、转交给坐席 ────────────────────────────────────
    //
    // **这是文稿台唯一一件外部编辑器给不了的事**：VS Code 改得比这里好，
    // 但它没法把「§4.10 那条【问】连同上下文」递到坐席手上。
    //
    // 说框在 视图区**外面**（index.html 的布局），所以片段模式下它一直在屏上，白拿。
    // 独立打开这一页时没有说框——那时按钮藏起来，不做成点了没反应。
    const 全交 = $('#记全交');
    if (全交) {
      if (!document.getElementById('说框')) {
        全交.hidden = true;
      } else {
        全交.addEventListener('click', () => {
          const 路 = ($('.稿路', 台) || {}).textContent || '';
          const 条 = $$('.记条', 台).map((a) => {
            const 标 = ($('.记标', a) || {}).textContent || '';
            const 文 = ($('.记文', a) || {}).textContent || '';
            const 行 = ($('.记行', a) || {}).textContent || '';
            return `  ${行}行 【${标.trim()}】 ${文.trim()}`;
          });
          if (!条.length) return;
          投(`${路.trim()} 里有 ${条.length} 处记号，逐条看一下：\n${条.join('\n')}`);
        });
      }
    }
  }

  function 投(文) {
    const 框 = document.getElementById('说框');
    if (!框) return;
    框.value = 文;
    框.dispatchEvent(new Event('input', { bubbles: true }));   // 说框高度自适应要这一下
    框.focus();
    try { 框.setSelectionRange(框.value.length, 框.value.length); } catch (e) { /* 不支持就算了 */ }
  }

  // ══════════════════════════════════════════════════════════════
  // 编辑态（批四）
  // ══════════════════════════════════════════════════════════════
  //
  // 这一段的每一处防丢都对着一条**实测存在过的**丢法：
  //   · 切页签   —— 视图.js 的 innerHTML 会把 textarea 连同内容一起删掉，成本一次点击
  //   · Ctrl+R   —— main.js 把它绑成了无确认重载，而这是你肌肉记忆最强的键
  //   · 换装/崩溃 —— 换装是固定仪式不是异常，且恰好发生在「改完准备让我落地」那一刻
  //   · 端口顺延 —— 4280 被占时服务顺延到 4281，localStorage 按 origin 隔离就找不着了
  // 所以草稿**落服务端**（最后一条决定的），另外三条各有各的拦法。

  // ── 自绘问答（**绝不用 alert/confirm/prompt**）──────────────────
  //
  // 换装仪式第⑨条：Electron 壳内原生对话框**静默哑弹**，
  // 而这块屏的生产形态就是 Electron 壳。这个项目已经为它中招两次
  // （confirm 十连哑弹、prompt 四连哑弹），两次都是浏览器预览里一切正常。
  //
  // 哑弹的后果在这里尤其毒：`confirm()` 若恒返回假，
  // 「切页签确认」会变成**永远切不走**，「退出编辑」会变成**永远退不出**；
  // 若恒返回真，那几道确认就等于不存在。两边都坏，而且都不报错。
  //
  // 所以这一族返回 Promise，调用点相应改成 await。
  function 幕(题, 文, 钮们) {
    return new Promise((收) => {
      const 罩 = document.createElement('div');
      罩.className = '稿问罩';
      罩.innerHTML = `<div class="稿问" role="dialog" aria-modal="true">
        <div class="稿问题">${转义(题)}</div>
        <div class="稿问文">${转义(文).replace(/\n/g, '<br>')}</div>
        <div class="稿问钮">${钮们.map((b, i) =>
    `<button type="button" data-i="${i}" class="${b.重 ? '重' : ''}">${转义(b.名)}</button>`).join('')}</div>
      </div>`;
      const 收工 = (v) => {
        document.removeEventListener('keydown', 键, true);
        罩.remove();
        收(v);
      };
      const 键 = (e) => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); 收工(钮们.findIndex((b) => b.退) >= 0 ? 钮们[钮们.findIndex((b) => b.退)].值 : false); }
        if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); 收工(钮们[0].值); }
      };
      罩.addEventListener('click', (e) => {
        const b = e.target.closest('button[data-i]');
        if (b) { 收工(钮们[Number(b.getAttribute('data-i'))].值); return; }
        if (e.target === 罩) 收工(钮们.find((x) => x.退) ? 钮们.find((x) => x.退).值 : false);   // 点罩子＝取消
      });
      document.addEventListener('keydown', 键, true);
      document.body.appendChild(罩);
      const 首 = 罩.querySelector('button');
      if (首) 首.focus();
    });
  }

  const 转义 = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  // 两个常用形：问（是/否）与 告（只有一个"知道了"）
  const 问 = (文, 题 = '确认', 是 = '继续', 否 = '取消') =>
    幕(题, 文, [{ 名: 是, 值: true, 重: true }, { 名: 否, 值: false, 退: true }]);
  const 告 = (文, 题 = '这一步没走通') =>
    幕(题, 文, [{ 名: '知道了', 值: true, 退: true }]);

  let 编 = null;      // { 令牌, 根, 相对, 基指纹, 编器, 脏 }

  // **定时器句柄挂模块级，不挂在 编 上。**
  // 首版是 编.计时.续，而 停计时() 从全局 编 取句柄、开编() 又是「先换 编 再起续租」——
  // 于是旧的 interval 永远清不掉。后果实测：在文件库里点另一份文档换了片之后，
  // 幽灵每 15 秒续租成功一次（新片段带着一枚有效的新令牌），
  // 「制作人 正在编辑（34 秒内仍有效）」**每 15 秒被幽灵自己刷新，永远为真**，
  // 制作人被自己的影子锁在自己文档外面，要等 30 分钟闲置降级；
  // 对坐席与班次则是**无限期**硬拒。
  let 续表 = null;
  let 草表 = null;

  function 令() {
    const 容 = document.querySelector('.稿容');
    return 容 ? 容.getAttribute('data-令') : null;
  }

  // 写请求。403「令牌无效」时**自动换一枚再试一次**。
  //
  // 为什么需要这一手：令牌台上限 200，每次打开一份文档就发一枚，超了淘汰最旧的。
  // 于是「开着编辑器、又去翻了两百份文件」这个完全正常的动线，
  // 会把编辑器那一页的令牌挤掉——表现是**存盘按了没反应（403）**，
  // 而 403 的理由是「令牌过期」，谁也想不到是因为翻文件翻多了。
  // （异厂评审把它当成攻击路径提出来，但它在正常使用里也够得着。）
  async function 发(路, 体) {
    const 打 = (t) => fetch(路, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Doc-Token': t || '' },
      body: JSON.stringify(体),
    });
    let r = await 打(令());
    if (r.status === 403) {
      const 新 = await 换令();
      if (新) r = await 打(新);
    }
    return r;
  }

  // 重新取一枚写令牌：拉一次文稿页的片段，从里面把 data-令 取出来写回当前页。
  // 跨站脚本读不到这一页的响应体（没有 CORS 头），所以这条路不给攻击面加分。
  async function 换令() {
    try {
      const r = await fetch('/doc?frag=1');
      if (!r.ok) return null;
      const t = ((await r.text()).match(/data-令="([^"]+)"/) || [])[1];
      const 容 = document.querySelector('.稿容');
      if (t && 容) { 容.setAttribute('data-令', t); return t; }
    } catch (e) { /* 换不到就让原来那次 403 照常回去，界面会说存不下 */ }
    return null;
  }

  function 态文(s, 色) {
    const el = document.getElementById('编态');
    if (!el) return;
    el.textContent = s;
    el.className = '编态' + (色 ? ' ' + 色 : '');
  }

  async function 开编(根, 相对) {
    if (!window.文稿编辑) { await 告('编辑器没装上（public/编辑器.js）——跑一次 npm run build:web'); return; }
    let j;
    try {
      const r = await 发('/api/doc/lock', { r: 根, p: 相对 });
      try { j = await r.json(); } catch (e) { j = { 行: false, 因: `服务端回了非 JSON（HTTP ${r.status}）` }; }
    } catch (e) {
      // 首版这里也是裸奔：连不上时点「编辑」**完全没反应**，
      // 没有 alert、没有状态、没有任何痕迹，再点还是没反应。
      await 告('打不开编辑（连不上服务端）：' + (e && e.message ? e.message : e));
      return;
    }
    if (!j.行) { await 告('打不开编辑：' + (j.因 || '')); return; }

    let 初文 = j.文;
    let 基指纹 = j.指纹;
    let 基文 = j.文;
    // 上次没存完就断了的草稿：**问一声，不自动套用**。
    // 悄悄把一份三天前的草稿铺在屏上，比丢掉它更坏。
    if (j.草稿 && j.草稿.文 !== j.文) {
      const 时 = new Date(j.草稿.时).toLocaleString('zh-CN');
      const 提 = j.草稿.同源
        ? `有一份 ${时} 的草稿没存盘（基于当前这版），要接着改吗？\n点取消＝丢掉草稿，用盘上的。`
        : `有一份 ${时} 的草稿，但它基于的是另一个版本——盘上后来被别人改过。\n`
          + `载入它之后第一次存盘会走冲突比对，让你看清两边各改了什么。\n要载入吗？点取消＝用盘上的。`;
      if (await 问(提, '有一份没存完的草稿', '载入草稿', '用盘上的')) {
        初文 = j.草稿.文;
        // **基准要跟着草稿走，不是跟着盘上走。**
        // 用盘上当前那一版当基准的话，存盘会直接盖过去、连冲突框都不弹——
        // 实测踩到：坐席加的一节就这么没了，只在版本环里留了个尸首。
        if (!j.草稿.同源 && j.草稿.基指纹) { 基指纹 = j.草稿.基指纹; 基文 = j.草稿.基文 != null ? j.草稿.基文 : j.文; }
      }
    }

    停计时();     // **进入前无条件清一次**——上一次的幽灵可能还在跑
    编 = { 令牌: j.令牌, 根, 相对, 基指纹, 基文, 脏: false, 编器: null };
    画编辑态(初文, 初文 !== j.文);
    起续租();
  }

  function 画编辑态(初文, 一开始就脏) {
    const 面 = document.querySelector('.稿面');
    const 体 = document.querySelector('.稿体');
    if (!面 || !体) return;
    面.classList.add('在编');

    const 区 = document.createElement('div');
    区.className = '编区';
    区.innerHTML = `
      <div class="编条">
        <span class="编态" id="编态">已就绪</span>
        <span class="编记">给光标所在段落标：${window.文稿编辑.记号们
    .map((k) => `<button type="button" class="编记钮 记${k}" data-记="${k}">${k}</button>`).join('')}</span>
        <span class="编右钮">
          <button type="button" class="编存" id="编存">存盘</button>
          <button type="button" class="编退" id="编退">退出编辑</button>
        </span>
      </div>
      <div class="编格">
        <div class="编左" id="编左"></div>
        <div class="编右 prose" id="编右"></div>
      </div>
      <div class="冲突" id="冲突" hidden></div>`;
    体.replaceWith(区);

    编.编器 = window.文稿编辑.装({
      编辑格: document.getElementById('编左'),
      预览格: document.getElementById('编右'),
      初文,
      变了: () => { 编.脏 = true; 态文('未保存…'); 排草稿(); 编.有按键 = true; },
    });
    if (一开始就脏) { 编.脏 = true; 态文('已载入草稿 · 未保存', '警'); }

    // 预览里每段旁边的四个记号钮——**这是制作人点名要的那件事**
    document.getElementById('编右').addEventListener('click', (e) => {
      const b = e.target.closest('.预记');
      if (!b) return;
      const r = 编.编器.插记号(b.getAttribute('data-记'), Number(b.getAttribute('data-行')));
      if (!r.变) 态文(r.因, '警');
    });
    // 工具条上的四个钮走光标位置
    区.querySelector('.编记').addEventListener('click', (e) => {
      const b = e.target.closest('.编记钮');
      if (!b) return;
      const r = 编.编器.插记号(b.getAttribute('data-记'));
      if (!r.变) 态文(r.因, '警');
    });
    document.getElementById('编存').addEventListener('click', 存盘);
    document.getElementById('编退').addEventListener('click', () => 退出编辑(true));
  }

  // ── 续租与草稿 ──
  function 起续租() {
    停计时();
    续表 = setInterval(async () => {
      if (!编) { 停计时(); return; }
      // **自检：编辑器 DOM 还在不在。**换片是同步 innerHTML，编辑区会连同工具条一起消失，
      // 而 编 与定时器都还活着。这一句让幽灵自己把锁还回去，不等人来收尸。
      if (!document.getElementById('编左')) { 松手(); return; }
      const 有按键 = !!编.有按键; 编.有按键 = false;
      try {
        const j = await (await 发('/api/doc/renew', {
          r: 编.根, p: 编.相对, 令牌: 编.令牌, 有按键,
        })).json();
        if (!j.行) { 态文('锁没了：' + j.因, '坏'); return; }
        if (j.态 === '可抢') 态文('闲置超过 30 分钟，锁已可被接管——动一下键盘就收回来', '警');
        else if (j.请求) 态文(`${j.请求.谁} 在等你解锁（${j.请求.次数} 次）`, '警');
        else if (!编.脏) 态文(`已保存 · 锁 ${j.剩余秒}s`);
      } catch (e) { 态文('续租失败：' + (e.message || e), '坏'); }
    }, 15000);
  }

  function 排草稿() {
    clearTimeout(草表);
    草表 = setTimeout(async () => {
      if (!编) return;
      try {
        const r = await 发('/api/doc/draft', {
          r: 编.根, p: 编.相对, 令牌: 编.令牌,
          文: 编.编器.取文(), 基文: 编.基文, 基指纹: 编.基指纹,
        });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        let j = null;
        try { j = await r.json(); } catch (e) { j = null; }
        if (j && j.行 === false) throw new Error(j.因 || '服务端说没存下');
        编.草连败 = 0;
        编.末草 = Date.now();          // 记时刻，退出时的文案要用它说实话
        态文('草稿已存 · 未存盘');
      } catch (e) {
        // **不许静默。**首版这里是 `catch {}`，注释还写着「草稿存不上不该打断打字」——
        // 那是错的。异厂评审 2026-08-31 打的正是这一条：
        //   服务进程被杀、因 4280 被占改起 4281，旧页面继续输入十分钟，
        //   每一次草稿请求都失败、每一次都被这个 catch 吃掉，
        //   然后 Ctrl+R 一按，十分钟没有任何持久副本。
        // 打字确实不该被打断，但**「你的兜底已经没了」这件事必须写在屏上**。
        编.草连败 = (编.草连败 || 0) + 1;
        if (编.草连败 >= 2) {
          态文(`草稿存不上（连续 ${编.草连败} 次）—— 现在没有兜底，先按存盘`, '坏');
        }
        // 退避重试：连败时不要每 800ms 砸一次，但也别放弃
        clearTimeout(草表);
        草表 = setTimeout(() => { if (编) 排草稿(); }, Math.min(8000, 800 * 编.草连败));
      }
    }, 800);
  }

  // **不看 编，直接清句柄。**首版是 `if (!编) return` 打头——
  // 而需要它的场合恰恰是 编 已经被换掉、旧定时器还在跑的那一刻。
  function 停计时() {
    if (续表) { clearInterval(续表); 续表 = null; }
    if (草表) { clearTimeout(草表); 草表 = null; }
  }

  // ── 存盘与冲突 ──
  // **通则：任何把状态栏设成进行时的函数，都要保证它离开进行时。**
  // 首版 存盘() 全程裸奔——换装窗口期（旧进程已退、新进程未起）按一次 Ctrl+S，
  // fetch 在网络层 reject，函数就此终止，屏上永远停在「存盘中…」。
  // 「存盘中…」是进行时，人的默认解读是「它正在做、马上会变」，
  // 扫一眼看到这四个字比看到红字更不容易起疑。
  async function 存盘() {
    if (!编) return;
    态文('存盘中…');
    const 文 = 编.编器.取文();
    try {
      const r = await 发('/api/doc/save', {
        r: 编.根, p: 编.相对, 令牌: 编.令牌, 文, 基指纹: 编.基指纹, 谁: '制作人',
      });
      let j;
      // 413 之类会回 HTML 错误页，r.json() 会抛——那时要说人话，不是把状态钉死
      try { j = await r.json(); } catch (e) { j = { 行: false, 因: `服务端回了非 JSON（HTTP ${r.status}）` }; }
      if (j.行) {
        编.基指纹 = j.指纹; 编.基文 = 文; 编.脏 = false; 编.草连败 = 0;
        编.末存 = Date.now();
        态文('已保存 · ' + new Date().toLocaleTimeString('zh-CN'));
        return;
      }
      if (j.冲突) { 画冲突(j, 文); return; }
      态文('存不下：' + (j.因 || r.status), '坏');
    } catch (e) {
      态文('存不下（连不上服务端）：' + (e && e.message ? e.message : e), '坏');
    }
  }

  function 画冲突(j, 我的) {
    const 盒 = document.getElementById('冲突');
    if (!盒) return;
    停计时();   // 冲突未决时不要再往草稿里写，免得把 base 搅了
    起续租();   // 但锁还得续着——正在决定的时候被人抢走更糟
    盒.hidden = false;
    盒.innerHTML = `
      <div class="冲头">
        <b>这份文件在你编辑期间被改过了</b>
        <span>不给「是否覆盖」那个框——那个框所有人都点确定。先看清两边动了什么。</span>
      </div>
      <div class="冲钮">
        <button type="button" data-选="看我的">我改了什么（相对打开时）</button>
        <button type="button" data-选="看盘上">别人改了什么（相对打开时）</button>
        <button type="button" data-选="保留我的">保留我的，覆盖盘上</button>
        <button type="button" data-选="用盘上的">丢掉我的，用盘上的</button>
        <button type="button" data-选="关">再想想</button>
      </div>
      <div class="冲差" id="冲差"></div>`;
    const 差 = document.getElementById('冲差');
    const 能三路 = j.能三路 && j.基文 != null;
    if (!能三路) {
      差.innerHTML = '<div class="冲注">取不到打开时那一版（base），所以只能给出两边的全文，'
        + '给不出「各自改了哪里」。<b>「保留我的」在这种情况下是盲覆盖，慎用。</b></div>';
    }
    盒.querySelector('.冲钮').addEventListener('click', async (e) => {
      const b = e.target.closest('[data-选]'); if (!b) return;
      const 选 = b.getAttribute('data-选');
      if (选 === '关') { 盒.hidden = true; return; }
      if (选 === '看我的') {
        差.innerHTML = 能三路 ? window.文稿编辑.画差异(j.基文, 我的) : '<div class="冲注">没有 base，给不出</div>';
        return;
      }
      if (选 === '看盘上') {
        差.innerHTML = 能三路 ? window.文稿编辑.画差异(j.基文, j.盘上) : '<div class="冲注">没有 base，给不出</div>';
        return;
      }
      if (选 === '用盘上的') {
        // **先把「我的」那一版留一条后路，再丢。**
        // 首版直接 设文(j.盘上)——而「我的」那版此刻的全部去处是：
        // 盘上没有（冲突把它挡回来了）、版本环没有（存版 只在写盘成功后跑）、
        // 服务端草稿即将被 800ms 后那个幽灵定时器覆盖成盘上内容
        // （设文 会触发 CM6 的 updateListener → 变了() → 排草稿()）。
        // 于是只剩 CM6 的 undo 栈，而它随「退出编辑」一起消失。
        // 界面把「保留我的 / 丢掉我的」暗示成对称的两个方向，实际一个可逆一个不可逆。
        try {
          await 发('/api/doc/version-keep', {
            r: 编.根, p: 编.相对, 令牌: 编.令牌, 文: 我的, 谁: '冲突时丢弃的我的版',
          });
        } catch (e) { /* 存不下也要让人能往下走，只是提示要改口 */ }
        编.编器.设文(j.盘上);
        编.基指纹 = j.盘纹; 编.基文 = j.盘上;
        clearTimeout(草表); 草表 = null;     // 掐掉 设文 刚排下的那个幽灵草稿
        编.脏 = false;
        盒.hidden = true; 态文('已换成盘上那一版（你那版已存进版本历史）');
        return;
      }
      if (选 === '保留我的') {
        // **文案按回执分支说话，不写死。**
        // 首版无条件写着「盘上那版仍会留在版本历史里，可以找回」——
        // 而触发 409 等价于「盘上那次写入没走写口」，等价于「它不在版本环里」，
        // 所以那句话在这个框唯一会出现的场景里**每一次都是假的**。
        // 现在服务端会在回 409 之前先把盘上那版存进版本环，兑现了才敢这么说。
        const 后路 = j.已存版
          ? '盘上那版已经存进版本历史，可以找回（顶栏那颗「历史」→ 选那一版 → 用这一版覆盖编辑器）。'
          : '**盘上那版没能存进版本历史——这一步覆盖之后它就没了。**';
        if (!await 问(`这会用你手上这版覆盖盘上那版。\n${后路}`, '覆盖盘上那版', '覆盖', '再想想')) return;
        编.基指纹 = j.盘纹;           // 认下盘上现状，再存一次就不会再冲突
        盒.hidden = true;
        await 存盘();
      }
    });
  }

  // 草稿此刻到底存住没有——**用记录说话，不用承诺说话**。
  const 时刻 = (t) => new Date(t).toLocaleTimeString('zh-CN');
  function 草况() {
    if (!编) return '';
    if (编.草连败 >= 1) {
      return 编.末草
        ? `**草稿最后一次存住是 ${时刻(编.末草)}，此后连续 ${编.草连败} 次失败——那之后的改动没有服务端副本。**`
        : '**草稿一次都没存住——这些改动没有任何服务端副本。**';
    }
    if (编.末草) return `草稿最后存于 ${时刻(编.末草)}，下次打开会问你要不要接着改。`;
    return '（还没来得及存草稿——最后这几秒的输入可能没有副本。）';
  }

  // 松手：只把锁还回去、停掉计时器、清状态，**不碰 DOM**。
  // 给「正在换页」这种场合用——那时 视图.js 已经在改 视图区 了，两边同时改会打架。
  function 松手() {
    if (!编) return;
    const { 根, 相对, 令牌 } = 编;
    停计时();
    编 = null;
    try { 发('/api/doc/unlock', { r: 根, p: 相对, 令牌 }); } catch (e) { /* 送不出去也会自己过期 */ }
  }

  // ── 退出 ──
  async function 退出编辑(要问) {
    if (!编) return true;
    // **文案说实话，不写死承诺。**
    // 首版无条件写着「草稿已存在服务端」——那是一句断言不是事实：
    // 草稿可能连败几十分钟（状态条早就红了，但人做决定的那一秒读的是模态框），
    // 也可能最后 800ms 的输入还没落盘就被 停计时() 取消掉。
    if (要问 && 编.脏 && !await 问('还有没存盘的改动。\n' + 草况(), '退出编辑', '退出', '继续改')) return false;
    // 先把要用的都取下来，再置空——置空之后再引用 编 是我第一版写的错
    const { 根, 相对, 令牌 } = 编;
    停计时();
    编 = null;
    try { await 发('/api/doc/unlock', { r: 根, p: 相对, 令牌 }); } catch (e) { /* 解不掉也会自己过期 */ }

    // 回只读态。**重取片段，不整页 reload**——reload 会把壳一起冲掉，
    // 那正是 群聊.js 今天的毛病，不该在这里再犯一次。
    const 址 = `/doc?r=${encodeURIComponent(根)}&p=${encodeURIComponent(相对)}`;
    const 区 = document.getElementById('视图区');
    if (区 && !区.hidden) {
      try {
        const r = await fetch(址 + '&frag=1');
        if (!r.ok) throw new Error('HTTP ' + r.status);
        区.innerHTML = await r.text();
        document.dispatchEvent(new CustomEvent('视图装好', { detail: { 视图区: 区 } }));
        return true;
      } catch (e) { /* 取不到就退回整页——宁可冲掉壳，也不能停在一个半死的编辑器上 */ }
    }
    location.href = 址;
    return true;
  }

  // ── 三条防丢 ──
  function 挂防丢() {
    // ① 切页签
    document.addEventListener('视图将换', (e) => {
      if (!编) return;
      if (!编.脏) {
        // 没有未存改动：直接把锁还回去放行。
        // 用 松手() 不用 退出编辑()——后者还会重取片段重绘，
        // 而此刻视图.js 正要换页，两边同时改 视图区 会打架。
        松手();
        return;
      }
      // **有未存改动：先拦住，再异步问。**
      // 自绘的确认框是 Promise，答不出同步结果——所以这里一律先 preventDefault，
      // 人点了「切走」再用事件带来的 继续() 把这次换页走完。
      e.preventDefault();
      问('文稿还有没存盘的改动，切走会离开编辑器。\n' + 草况(), '离开编辑器', '切走', '留下')
        .then((好) => {
          if (!好) return;
          松手();
          const 继续 = e.detail && e.detail.继续;
          if (typeof 继续 === 'function') 继续();
        });
    });
    // ② 关窗 / Ctrl+R 重载。**只是尽力**——真正的兜底是 800ms 一次的服务端草稿，
    //    因为 main.js 的 Ctrl+R 走的是 reloadIgnoringCache()，不保证走这条路。
    window.addEventListener('beforeunload', (e) => {
      if (编 && 编.脏) { e.preventDefault(); e.returnValue = ''; }
    });

    // ③ **离场就把锁还回去。**
    //    实测踩到：在编辑器里点了别的页签走掉、再回来，被自己刚才那把锁挡在门外
    //    （「制作人 正在编辑（23 秒内仍有效）」）。切页签走人是常态动作，
    //    45 秒的租约本来是给崩溃兜底的，不该让正常离场也吃这个等待。
    //
    //    用 keepalive 而不是普通 fetch：页面正在卸载，普通请求会被浏览器掐掉。
    //    （sendBeacon 也能活过卸载，但它设不了 X-Doc-Token 请求头，过不了写闸第三道。）
    window.addEventListener('pagehide', () => {
      if (!编) return;
      const { 根, 相对, 令牌 } = 编;
      try {
        fetch('/api/doc/unlock', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Doc-Token': 令() || '' },
          body: JSON.stringify({ r: 根, p: 相对, 令牌 }),
          keepalive: true,
        });
      } catch (e) { /* 送不出去也无妨：45 秒后租约自己过期 */ }
    });
    // ③ Ctrl+S 存盘：编辑器开着时它该是存盘，不是浏览器的"保存网页"
    document.addEventListener('keydown', (e) => {
      if (编 && (e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault(); 存盘();
      }
    });
  }
  挂防丢();

  // 编辑按钮（每次装片后重新绑，所以放在 装() 里调用）
  function 绑编辑钮() {
    const 钮 = document.getElementById('稿编');
    if (!钮 || 钮.dataset.绑过 === '1') return;
    const 路 = document.querySelector('.稿路');
    if (!路) return;
    钮.disabled = false;
    钮.removeAttribute('title');
    钮.dataset.绑过 = '1';
    钮.addEventListener('click', () => {
      const q = new URLSearchParams(location.search);
      // 壳里地址栏是 /?v=doc，参数在 <a> 上；所以从当前高亮的那一项取
      const 在 = document.querySelector('.稿项.在');
      const 根 = 在 ? new URL(在.href, location.origin).searchParams.get('r') : q.get('r');
      const 相 = 在 ? new URL(在.href, location.origin).searchParams.get('p') : q.get('p');
      if (!根 || !相) { 告('取不到当前文档的位置'); return; }
      开编(根, 相);
    });
  }

  装();
  绑编辑钮();
  document.addEventListener('视图装好', () => { 装(); 绑编辑钮(); });
})();
