// 视图.js — 主页是唯一的壳；页签换的是主内容区，不是整页跳转。
//
// 病灶（2026-08-30 03:05 制作人指出「主页和标签页割裂」，量下来是四处）：
//   ① 两套顶栏（主页 顶/徽/去 vs 标签页 top/brand/tabs），各写各的
//   ② 两份**手写**导航且不一致——主页那份漏了监视与班次，刚上线的班次页从主屏点不到
//   ③ 同一个 /chat 两个名字（主页叫「群聊」，标签页叫「席间存照」）
//   ④ **状态区只有主页有**（脉搏/凭据/闸数/塔况；标签页 0 处）
//
// ④ 是实质伤：读一份班次报告＝离开人闸队列与产线状态，而 PRODUCT.md 原则一要求
// 「活着/在跑什么/谁等我 三问不用滚动不用点击就能回答」——在标签页上三问一条都答不了。
//
// 修法不是给标签页也补一套状态（那是把两套壳养成两套），是让主页成为唯一的壳：
// 页签换**主内容区**（话栏那一格），闸栏、脉栏、顶况、座条、输入框全部不动。
// 实测那一格大多数时候是空的——屏上最大的版面在等东西显示。
//
// 座条与输入框不参与切换：一边看班次报告一边说话是常态。
// 把输入框也换走，等于「读东西时不能说话」，那就把对话从主干道降成了抽屉。
//
// **整页仍然可用**：直接访问 /shift 返回完整页面。降级路不许断——
// 这段 JS 一旦出问题，那些页面还得能单独打开。
'use strict';
(() => {
  const 取 = (id) => document.getElementById(id);
  const 视图区 = 取('视图区');
  const 话流元 = 取('话流');
  const 去 = 取('去');
  if (!视图区 || !话流元 || !去) return;      // 结构不对就整个不接管，别把主页搞坏

  let 视图表 = [];
  let 当前 = 'talk';

  const 转义 = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  function 画导航() {
    去.innerHTML = 视图表.map((v) => {
      const 在 = v.键 === 当前 ? ' class="在"' : '';
      return '<a href="' + 转义(v.路) + '" data-jian="' + 转义(v.键) + '"' + 在 + '>' + 转义(v.名) + '</a>';
    }).join('');
  }

  // 片段地址：给原地址挂上 frag=1。**参数名是 ASCII**——中文参数名要 URL 编码才发得出去，
  // 今晚已经在 schema 键名、argv、shell 上各栽过一次同族的坑。
  const 片址 = (u) => u + (u.includes('?') ? '&' : '?') + 'frag=1';

  /**
   * 壳里的地址：`/?v=<键>`，**不动路径**。
   *
   * 首版把 pushState 写成了 `/shift`，看着漂亮，但**按一下 F5 就跳出壳**——
   * 因为 /shift 是服务端的独立整页路由，刷新拿到的是那一份，闸栏与脉栏又没了。
   * 用户不会知道「这个地址刷新会变成另一个东西」，他只会觉得刷一下就乱了。
   *
   * 现在两条路各自干净：`/` 永远是壳，`/shift` 永远是独立整页（分享/降级用）。
   */
  const 壳址 = (键, 额外) => {
    const q = new URLSearchParams(额外 || '');
    q.delete('frag');
    q.set('v', 键);
    return '/?' + q.toString();
  };

  // 视图脚本。**每个只加载一次**——监视.js 顶上有 setInterval(一轮, 3000)，
  // 反复 append 会让定时器叠罗汉，切五次页就每 3 秒发五次请求。
  // 加载完（以及此后每次换片）广播一条「视图装好」，让各页自己重新绑当前这批 DOM。
  const 已上的脚本 = new Set();
  function 上脚本(节点) {
    const 串 = 节点 && 节点.getAttribute && 节点.getAttribute('data-脚本');
    if (!串) return Promise.resolve();
    return Promise.all(串.split(/\s+/).filter(Boolean).map((src) => {
      if (已上的脚本.has(src)) return Promise.resolve();
      已上的脚本.add(src);
      return new Promise((好) => {
        const s = document.createElement('script');
        s.src = src;
        // 加载失败也放行：一个视图的脚本挂了不该把切页卡死在半路
        s.onload = 好;
        s.onerror = 好;
        document.head.appendChild(s);
      });
    }));
  }

  async function 装片(地址) {
    视图区.innerHTML = '<div class="视载">取…</div>';
    try {
      const r = await fetch(片址(地址));
      if (!r.ok) throw new Error('HTTP ' + r.status);
      视图区.innerHTML = await r.text();
      视图区.scrollTop = 0;
      // 先把脚本上齐，再广播——不然首次进这一页时脚本还没定义监听器，那一发就丢了
      await 上脚本(视图区.firstElementChild);
      document.dispatchEvent(new CustomEvent('视图装好', { detail: { 视图区 } }));
    } catch (e) {
      // 取不到就说取不到，并给一条能自己走通的路。**不留白**：
      // 值班屏上一块空白等于「程序坏了」，而它其实只是这一次没取到。
      视图区.innerHTML = '<div class="视错">这一页取不到：' + 转义(e && e.message ? e.message : e)
        + ' <a href="' + 转义(地址) + '">整页打开</a></div>';
    }
  }

  // 换页前先问一声。**没有这一声，切一下页签就把没存的编辑 innerHTML 掉了**——
  // 触发成本一次点击，且没有确认、没有提示、没有任何痕迹。
  // 谁想拦就监听 `视图将换` 并 preventDefault（文稿台的编辑态在拦）。
  // 事件带一个 继续()：拦的人问完人之后可以自己把这次换页走完。
  // **不这么做，拦截方就只能同步回答**——而自绘的确认框是异步的
  // （原生 confirm 才是同步的，但它在 Electron 壳里静默哑弹，不能用）。
  function 准换(键, 继续) {
    const e = new CustomEvent('视图将换', {
      detail: { 去: 键, 来: 当前, 继续: typeof 继续 === 'function' ? 继续 : null },
      cancelable: true,
    });
    return document.dispatchEvent(e);      // 被 preventDefault 就返回 false
  }

  async function 换视图(键, 推历史, 地址) {
    const v = 视图表.find((x) => x.键 === 键) || 视图表[0];
    if (!v) return;
    if (v.键 !== 当前 && !准换(v.键, () => 换视图(键, 推历史, 地址))) return;
    当前 = v.键;
    画导航();
    const 目标 = 地址 || v.路;

    if (v.主页) {
      视图区.hidden = true;
      视图区.innerHTML = '';
      话流元.hidden = false;
      if (推历史) history.pushState({ 视图: v.键 }, '', '/');
      return;
    }
    话流元.hidden = true;
    视图区.hidden = false;
    if (推历史) {
      const q = 目标.includes('?') ? 目标.slice(目标.indexOf('?') + 1) : '';
      history.pushState({ 视图: v.键 }, '', 壳址(v.键, q));
    }
    await 装片(目标);
  }

  /** 按路径认出是哪个视图。主页那条不参与匹配（它的路是 `/`，会匹配一切）。 */
  const 认视图 = (路径) => 视图表.find((x) => !x.主页 && 路径.startsWith(x.路)) || null;

  /** 从壳地址（`/?v=班次&f=…`）还原：要看哪个视图、以及带给它的参数。 */
  function 读壳址() {
    const q = new URLSearchParams(location.search);
    const 键 = q.get('v');
    if (!键) return null;
    const v = 视图表.find((x) => x.键 === 键 && !x.主页);
    if (!v) return null;
    q.delete('v');
    const 余 = q.toString();
    return { v, 目标: v.路 + (余 ? '?' + 余 : '') };
  }

  // 修饰键与中键照旧放行——用户想在新标签页打开是他的事，不该被拦
  const 该拦 = (e) => !(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0);

  去.addEventListener('click', (e) => {
    const a = e.target.closest('a[data-jian]');
    if (!a || !该拦(e)) return;
    e.preventDefault();
    换视图(a.dataset.jian, true);
  });

  // 视图**内部**的链接也要拦：班次页的「看报告」、日报的翻页都在片段里。
  // 不拦的话点一下就整页跳走，人闸队列与脉搏又没了——那正是这次要治的病。
  视图区.addEventListener('click', (e) => {
    const a = e.target.closest('a[href]');
    if (!a || !该拦(e)) return;
    let u;
    try { u = new URL(a.getAttribute('href'), location.origin); } catch { return; }
    if (u.origin !== location.origin) return;          // 外链放行
    const v = 认视图(u.pathname);
    if (!v) return;                                     // 不认得就照常跳，别把人卡在这一格里
    e.preventDefault();
    // **这条路也要过 准换()。**首版直接 装片()，于是「在文件库里点另一份文档」
    // 整条路不发 `视图将换` 事件——文稿台那道「有未存改动，确认切走？」一次都不触发，
    // 编辑器连同未存内容在同一帧被 innerHTML 掉，零对话框零痕迹。
    // 两条换页路径，一条有闸一条没有，而没闸的那条恰是编辑态下最常点的。
    const 走 = () => {
      当前 = v.键;
      画导航();
      const 目标 = u.pathname + u.search;
      history.pushState({ 视图: v.键 }, '', 壳址(v.键, u.search.replace(/^\?/, '')));
      装片(目标);
    };
    if (!准换(v.键, 走)) return;
    走();
  });

  // 前进/后退要能复原——否则「回上一页」会把整个壳换掉，回到割裂的老样子
  addEventListener('popstate', () => {
    const s = 读壳址();
    if (s) 换视图(s.v.键, false, s.目标); else 换视图('talk', false);
  });

  // ── 塔态钉在「等你拍板」页（2026-09-02 拆栏）────────────────────
  //
  // 拆栏之前塔＝只留闸栏、藏掉对话与流水。闸栏搬走之后，塔如果还停在对话页，
  // 屏上就是一条 360px 宽的空对话——而形态是记在 localStorage 里的，
  // 于是**开机直接进那个空屏**。塔的取向是「余光扫一眼谁在等我」，
  // 那件事现在住在 /gate，所以塔进去就钉在那儿。
  //
  // 回全屏时还原进塔之前那一页：塔是临时形态，不该改变你本来在看什么。
  let 进塔前 = null;
  document.addEventListener('形态换', (e) => {
    const 要塔 = !!(e.detail && e.detail.塔);
    if (要塔) {
      if (当前 === 'gate') { 进塔前 = null; return; }   // 本来就在这一页，没什么可还原的
      进塔前 = 当前;
      if (视图表.some((v) => v.键 === 'gate')) 换视图('gate', true);
      return;
    }
    if (进塔前 && 进塔前 !== 当前) { 换视图(进塔前, true); }
    进塔前 = null;
  });

  fetch('/api/views')
    .then((r) => r.json())
    .then((j) => { 视图表 = (j && j.视图) || []; })
    .catch(() => {
      // 取不到就退成只有对话。**不在这里编一份列表**——编的那份迟早跟服务端那份分叉，
      // 而分叉的表现正是这次要治的病（新页面看不见）。
      视图表 = [{ 键: 'talk', 路: '/', 名: '对话', 主页: true }];
    })
    .then(() => {
      画导航();
      // 刷新 / 从 `/?v=班次` 这样的地址打开时，把视图还原出来。
      // **这一条是「刷新不跳出壳」的落点**——首版用路径 pushState，F5 就回到独立整页了。
      const s = 读壳址();
      if (s) 换视图(s.v.键, false, s.目标);
      // 开机就是塔态时补钉一次。
      // **这一发不能靠事件**：index.html 里 app.js 排在 视图.js 之前，
      // app.js 从 localStorage 恢复形态时这个监听还没注册，那一发直接丢掉——
      // 表现是「重启之后塔里是一条空对话」，而手动按 F9 又一切正常，最难对上号的一种。
      if (document.querySelector('.台.塔') && 当前 !== 'gate'
          && 视图表.some((v) => v.键 === 'gate')) {
        进塔前 = 当前;
        换视图('gate', false);
      }
    });
})();
