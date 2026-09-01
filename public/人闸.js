// 人闸.js — 「等你拍板」独立页（2026-09-02 拆栏 · 批二）
//
// 从 app.js 的左栏搬出来。分堆规则**没有搬**：它仍在 public/闸分组.js 那一份，
// 前端读 self.闸分组、判据读 module.exports，同一份代码两个入口。
// 搬的时候顺手实现第二遍分堆，就是本仓付过学费的那件事（事件折叠曾经存四份，
// 治好两份、另外两份原封不动继续刷屏）。
//
// 这一页相对那条 340px 的栏，多出来的**唯一一件真东西**是组头右边那个
// 「一次处置 N 单」——同一闸位的 N 单动作键完全相同，它们竞争的是你的一次判断，
// 不是 N 次。那个钮在 340px 里排不下，这也正是拆栏的理由。
'use strict';
(() => {
  const { 久档, 分闸组, 该收 } = self.闸分组;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const 时长文 = (小时) => {
    const h = Number(小时) || 0;
    if (h < 1) return Math.round(h * 60) + ' 分';
    if (h < 48) return h.toFixed(0) + ' 小时';
    return (h / 24).toFixed(1) + ' 天';
  };

  // 折叠态与主壳那条栏**共用一个键**：同一堆东西换个地方看，不该重新折一遍。
  const 折键 = 'gt.闸折态';
  const 读折 = () => { try { return new Map(Object.entries(JSON.parse(localStorage.getItem(折键) || '{}'))); } catch { return new Map(); } };
  const 写折 = (m) => { try { localStorage.setItem(折键, JSON.stringify(Object.fromEntries(m))); } catch { /* 无痕模式写不进，不值得为它报错 */ } };
  let 折态 = 读折();
  let 筛 = '全';
  let 单表 = [];

  // 说框在主壳里（片段模式下这一页长在 .话栏 那一格里，说框就在下面）。
  // 独立打开 /gate 时没有说框——那时批量钮**藏起来**，不做成点了没反应。
  // 这条是照文稿台「全部交给坐席」的成例来的，不是新发明。
  const 有说框 = () => !!document.getElementById('说框');
  function 投(文) {
    const 框 = document.getElementById('说框');
    if (!框) return;
    框.value = 文;
    框.dispatchEvent(new Event('input', { bubbles: true }));   // 说框高度自适应要这一下
    框.focus();
    try { 框.setSelectionRange(框.value.length, 框.value.length); } catch (e) { /* 不支持就算了 */ }
  }

  function 画筛(单n, 机n) {
    const 元 = $('闸页筛'); if (!元) return;
    const chip = (k, 名, n) => `<button class="闸页筛钮${筛 === k ? ' 选中' : ''}" data-筛="${k}"${n ? '' : ' disabled'} aria-pressed="${筛 === k}">${名}<b>${n}</b></button>`;
    元.innerHTML = chip('全', '全部', 单n + 机n) + chip('单', '单据', 单n) + chip('机', '机制', 机n);
  }

  function 画组(z) {
    const 收 = 该收(折态, z.键, z.计, 筛);
    const s = z.形 || {};
    const 注 = z.类 === '单'
      ? `${z.动 ? esc(z.动) + ' · ' : ''}${s.逾期 === s.总 ? '全部逾期' : `${s.逾期} 逾期`}`
      : `跨 ${z.节数} 节 · 读自议程档`;
    const 量 = z.类 === '单'
      ? `<span class="组量">中位 ${时长文(s.中位)} · 最久 ${时长文(s.最久)}</span>` : '';
    // 批量钮：这一组动作键相同，所以它们是**一件事**不是 N 件。
    // 只对单据组出，且只在有说框时出（独立页没有说框）。
    const 批 = (z.类 === '单' && z.计 > 1 && 有说框())
      ? `<button class="组批" data-批="${esc(z.键)}">一次处置 ${z.计} 单</button>` : '';
    return `<div class="闸组${z.齐 ? ' 齐久' : ''}">
      <div class="闸组头">
        <button class="组开" data-组="${esc(z.键)}" aria-expanded="${!收}" aria-controls="闸页身-${esc(z.键)}">
          <span class="折箭" aria-hidden="true">${收 ? '▸' : '▾'}</span>
          <span class="组名">${esc(z.名)}</span>
          <span class="组注">${注}</span>
        </button>
        <span class="组计">${z.计} ${z.类 === '单' ? '单' : '条'}</span>
        ${量}
        ${批}
      </div>
      <div class="闸组身" id="闸页身-${esc(z.键)}"${收 ? ' hidden' : ''}>${z.项.map((p) => 画行(p.d, z.类)).join('')}</div>
    </div>`;
  }

  function 画行(d, 类) {
    if (类 !== '单') {
      return `<div class="闸行 机">
        <span class="闸号">第 ${esc(d.号)} 条</span>
        <span class="闸题">${esc(d.题)}</span>
        <span class="闸谁">议程</span>
        <span class="闸位">${esc(d.节)}</span>
        <span class="闸久">—</span>
      </div>`;
    }
    const h = Number(d.停摆小时) || 0;
    const 档 = 久档(h, 阈当前);
    return `<div class="闸行${档 ? ' 久' + 档 : ''}" data-号="${esc(d.id)}" data-题="${esc(d.title || '')}" tabindex="0" role="button">
      <span class="闸号">${esc(d.id)}</span>
      <span class="闸题">${esc(d.title || '')}</span>
      <span class="闸谁">${esc(d.归属 || '')}</span>
      <span class="闸位">${esc(d.闸号 || '')} ${esc(d.闸名 || '')}</span>
      <span class="闸久">${时长文(h)}</span>
    </div>`;
  }

  let 阈当前 = 24;

  async function 拉() {
    const [g, a] = await Promise.all([
      fetch('/api/gates').then((x) => x.json()).catch(() => ({ 读不到: true, 因: '坐席后端不通' })),
      fetch('/api/agenda').then((x) => x.json()).catch(() => ({ 读不到: true, 因: '坐席后端不通' })),
    ]);
    const 体 = $('闸页体'); if (!体) return;
    const 单 = g.读不到 ? [] : (g.债 || []);
    const 机 = a.读不到 ? [] : (a.事 || []);
    单表 = 单;
    阈当前 = g.逾期阈值小时 || 24;

    // 页头那句话要说三个量：多少件、最久多久、中位多久。
    // **只说"61 条"是不够的**——它昨天是 61、上周也是 61，对"要不要现在动手"没有分辨力。
    const 数元 = $('闸页数');
    if (数元) {
      if (g.读不到) {
        数元.textContent = `读不到监制台（${g.因 || ''}）`;
        数元.className = '闸页数 读不到';
      } else {
        const 久们 = 单.map((d) => Number(d.停摆小时) || 0).sort((x, y) => x - y);
        const 中 = 久们.length ? 久们[Math.floor(久们.length / 2)] : 0;
        数元.className = '闸页数';
        数元.textContent = 单.length + 机.length === 0 ? '没有等你的'
          : `${单.length + 机.length} 条 · 最久 ${时长文(久们[久们.length - 1] || 0)} · 中位 ${时长文(中)}`;
      }
    }
    画筛(单.length, 机.length);

    if (g.读不到) {
      体.innerHTML = `<div class="闸页错">读不到监制台（${esc(g.因)}）<br>这一页现在不可信，别拿它当「没事」。</div>`;
      return;
    }
    if (!单.length && !机.length) {
      体.innerHTML = '<div class="闸页空"><b>没有等你拍板的事</b>单据与机制两条队列都清空了。</div>';
      return;
    }
    const 组们 = 分闸组(单, 机, 阈当前, 筛);
    体.innerHTML = 组们.filter((z) => z.类 === '单').map(画组).join('')
      || '<div class="闸页空"><b>这一档没有</b>换个筛选看看。</div>';

    const 议 = $('议程段');
    const 机组 = 组们.filter((z) => z.类 === '机');
    if (议) {
      议.hidden = !机组.length;
      议.innerHTML = 机组.length
        ? `<h2 class="议程题">机制类 <span>读自议程档，没有活时钟——不参加上面的年龄排序</span></h2>${机组.map(画组).join('')}`
        : '';
    }
    if (a.读不到 && 议) {
      议.hidden = false;
      议.innerHTML = `<div class="闸页错">读不到议程档（${esc(a.因)}）</div>`;
    }
  }

  function 接线(根) {
    根.addEventListener('click', (e) => {
      // **找自己那一组，一律相对导航，不走 getElementById。**
      //
      // 案发 2026-09-02 批二当天：主壳里旧的左栏还在，它渲染的组身 id
      // 与这一页**一模一样**（同一份 闸分组.js 分出来的同一批组）。
      // getElementById 返回文档里第一个，也就是栏里那个——而栏在片段模式下
      // 是折叠的，行数为 0。于是「一次处置 24 单」点下去：不报错、不动、
      // 说框里什么都没有。典型的坏掉的按钮。
      //
      // 拆栏（批三）之后这个撞车会自己消失，但**不能靠那个消失**：
      // 组件找自己的子元素本来就不该经过全文档 id 空间。
      const 开 = e.target.closest('.组开');
      if (开) {
        const 组 = 开.closest('.闸组');
        const 身 = 组 && 组.querySelector('.闸组身');
        const k = 开.getAttribute('data-组');
        const 收 = 开.getAttribute('aria-expanded') === 'true';
        开.setAttribute('aria-expanded', String(!收));
        const 箭 = 开.querySelector('.折箭'); if (箭) 箭.textContent = 收 ? '▸' : '▾';
        if (身) 身.hidden = 收;
        折态.set(k, 收 ? '收' : '开'); 写折(折态);
        return;
      }
      const 批 = e.target.closest('.组批');
      if (批) {
        const 组 = 批.closest('.闸组');
        const 行们 = 组 ? [...组.querySelectorAll('.闸行[data-号]')] : [];
        if (!行们.length) return;
        投(`${行们.length} 单同一个动作，一起处置：\n`
          + 行们.map((r) => `  ${r.getAttribute('data-号')} ${r.getAttribute('data-题')}`).join('\n'));
        return;
      }
      const 行 = e.target.closest('.闸行[data-号]');
      if (行) 投(`${行.getAttribute('data-号')} ${行.getAttribute('data-题')}\n`);
    });
    根.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const 行 = e.target.closest && e.target.closest('.闸行[data-号]');
      if (行) { e.preventDefault(); 行.click(); }
    });
    const 筛元 = $('闸页筛');
    if (筛元) 筛元.addEventListener('click', (e) => {
      const b = e.target.closest('.闸页筛钮'); if (!b || b.disabled) return;
      筛 = b.getAttribute('data-筛'); 拉();
    });
  }

  function 起() {
    const 根 = $('闸页');
    if (!根) return;                        // 不在这一页就整个不接管
    // **绑在 #闸页 上，不绑 document。**主壳里旧的左栏还在（拆栏是批三），
    // 两处渲染的是同一批组、同样的类名——绑 document 就会互相接对方的点击：
    // 点栏里的组头，这一页跟着折；点这一页的行，栏那边也响应。
    // 绑在自己的根上，两边各管各的。
    if (!根.__接过) { 根.__接过 = true; 接线(根); }
    拉();
    if (!self.__人闸拍) self.__人闸拍 = setInterval(拉, 20000);
  }

  // 两条路都要能起：独立整页（DOMContentLoaded）与主壳里的片段（视图装好）。
  // **只绑一条就等于另一条是死的**，而那正是「点得动、不报错、没反应」的产地。
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', 起);
  else 起();
  document.addEventListener('视图装好', 起);
})();
