// 顶况.js — 顶栏那几个读数怎么写成字。
//
// 单独一个文件，是为了它能被判据 require。顶栏是这块屏上**唯一一处一直在视野里**的
// 地方，它写错一个字，人就会照着错的那个字安排接下来一小时。
//
// 2026-08-31 巡礼实测抓到两条：
//   ① 登录还剩 40 分钟，屏上写「登录 0h」——`Math.floor(40/60)`。
//      整个小于一小时的区间（**也正是唯一要紧的那个区间**）全被压成一个读着像零的数。
//      更难看的是它和横幅对不上：横幅的临期线是 30 分，于是 30–59 分之间，
//      顶栏说「0h」、横幅说「没事」，两个都出自同一份数据。
//   ② 额度只显示周窗口，且把「（09-04 19:00 重置）」整串摆出来——
//      197px，占了整条顶况的 31%，而**当下真正会把你拦住的是 5 小时窗口**，
//      它一个字都没显示。重置时刻只在快撞顶时才是个问题，21% 的时候它是噪音。

(function (根) {
  'use strict';

  // 登录还剩多久。小时是个太粗的刻度：这块屏关心的是「够不够撑完手上这件事」，
  // 而那个尺度以分钟计。所以 90 分钟以下一律说分钟。
  function 登录文(态, 剩余分) {
    if (态 !== '有效') return '登录' + (态 || '读不到');
    // **先判"有没有这个数"，再判它是多少。**
    // Number(null) 是 0、Number('') 也是 0，直接算的话
    // 「没读到剩余分钟」会被写成「登录已过期」——把一个不知道，说成了一个确定的坏消息。
    // PRODUCT 原则五要挡的正是这一步。
    if (剩余分 === null || 剩余分 === undefined || 剩余分 === '') return '登录—';
    const m = Number(剩余分);
    if (!Number.isFinite(m)) return '登录—';
    if (m <= 0) return '登录已过期';
    if (m < 90) return `登录 ${Math.round(m)} 分`;
    const h = m / 60;
    return `登录 ${h < 10 ? h.toFixed(1) : Math.round(h)}h`;
  }

  // 额度。两个窗口都要出现：5 小时窗口决定「这一小时还能不能干活」，
  // 周窗口决定「这一周还能开几张单」——只报后者等于把当下那道闸藏起来。
  //
  // 重置时刻只在**快撞顶时**才是问题。低水位时它是一串没人会用的数字，
  // 却占着顶栏三分之一的宽度。所以给它一条线：任一窗口过线才把重置时刻摆出来。
  const 报重置线 = 70;
  function 额度文(窗们, 线) {
    const 表 = Array.isArray(窗们) ? 窗们 : [];
    if (!表.length) return { 文: '额度—', 详: '' };
    const 阈 = Number.isFinite(线) ? 线 : 报重置线;
    const 短名 = (l) => String(l || '').replace('小时', 'h').replace(/^周$/, '周');
    const 段 = 表.map((w) => `${短名(w.label)} ${w.pct}%`);
    const 详 = 表.map((w) => `${w.label} ${w.pct}%，${w.reset} 重置`).join(' · ');
    const 紧 = 表.filter((w) => Number(w.pct) >= 阈);
    if (紧.length) {
      // 快撞顶的那个（不是两个都摆）——摆两串重置时刻回到原来的宽度问题上去了
      const 最 = 紧.reduce((a, b) => (Number(b.pct) > Number(a.pct) ? b : a));
      return { 文: `额度 ${段.join(' · ')}（${短名(最.label)} ${最.reset} 重置）`, 详, 紧: 最.label };
    }
    return { 文: `额度 ${段.join(' · ')}`, 详, 紧: null };
  }

  const api = { 登录文, 额度文, 报重置线 };
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  else 根.顶况 = api;
}(typeof self !== 'undefined' ? self : this));
