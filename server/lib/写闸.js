// 写闸.js — 写口的准入判定（批三）
//
// ── 为什么写口要单独一道闸 ──────────────────────────────────────
// 在文稿台之前，**终端对外是纯只读的**：五个 POST 口没有一条把请求体落盘
// （落盘只发生在服务端内部，路径全部由服务端自算）。文稿台是第一个写口，
// 而这块屏**无鉴权、开机自启、整天开着**，监听 127.0.0.1。
//
// 评审构造出的攻击，可复现：
//
//   // 任何网页里执行——你在 Unity 里点开一份文档、或浏览器里开任何一个页面就够
//   fetch('http://127.0.0.1:4280/api/doc/save', {
//     method: 'POST', mode: 'no-cors',
//     headers: {'Content-Type': 'text/plain'},   // 简单请求，不触发预检
//     body: JSON.stringify({路径: '...', 文: '...'})
//   })
//   // **响应读不到，但写已经发生。**
//
// 同源策略挡的是「读回响应」，挡不住「发出去的写」。所以四道：
//   ① 只收 application/json —— text/plain 是简单请求，不触发预检；
//      要求 JSON 就必须过 CORS 预检，而我们不给 CORS 头，预检自然失败
//   ② Origin 必须是自家 —— 跨站脚本发的请求带着它自己的 Origin，对不上
//   ③ 一次性写令牌 —— 页面加载时下发；跨站读不到页面，就拿不到令牌
//   ④ 路径校验与写权（在 lib/文稿.js，不在这里）
//
// ①② 已经够挡住上面那条攻击，③ 是纵深。**三道都留着**：
// 「哪一道其实是多余的」这个判断，等到出事那天再做就晚了。
'use strict';

const crypto = require('crypto');

const 令牌活毫秒 = 12 * 60 * 60 * 1000;   // 一次页面加载发一枚，12 小时后作废
const 令牌上限 = 200;                      // 常驻整天开着，不设上限就是一处内存泄漏

function 新令牌台() {
  const 们 = new Map();     // 令牌 → 发出时刻
  return {
    发(现在 = Date.now()) {
      const t = crypto.randomBytes(18).toString('hex');
      们.set(t, 现在);
      // 顺手扫掉过期的与超量的最旧那批
      for (const [k, v] of 们) if (现在 - v > 令牌活毫秒) 们.delete(k);
      while (们.size > 令牌上限) 们.delete(们.keys().next().value);
      return t;
    },
    认(t, 现在 = Date.now()) {
      if (!t || !们.has(t)) return false;
      if (现在 - 们.get(t) > 令牌活毫秒) { 们.delete(t); return false; }
      return true;
    },
    数() { return 们.size; },
  };
}

/**
 * 准写({ 方法, 类型, 来源, 令 }, { 自家, 认令 }) → { 行, 码, 因 }
 *
 * 自家 = 允许的 origin 列表（本机各端口）。认令 = (t) => boolean。
 * **全部是拒绝优先**：任何一项判不出来就拒。
 * 「判不出来就放行」在无鉴权的写口上等于没有闸。
 */
function 准写(头 = {}, opts = {}) {
  const 类型 = String(头.类型 || '').toLowerCase();
  const 来源 = String(头.来源 || '');
  const 自家 = (opts.自家 || []).map((x) => String(x).toLowerCase().replace(/\/+$/, ''));
  const 认令 = typeof opts.认令 === 'function' ? opts.认令 : () => false;

  // ① 内容类型。必须是 application/json（允许带 charset）。
  if (!/^application\/json\b/.test(类型)) {
    return { 行: false, 码: 415, 因: '写口只收 application/json（text/plain 是简单请求，不触发预检）' };
  }

  // ② Origin。**没有 Origin 也拒。**
  //    浏览器对跨站 fetch 一定会带 Origin；同站 fetch 现代浏览器也带。
  //    没带的多半是脚本/工具直连——那种情况该走命令行，不该走这个口。
  if (!来源) return { 行: false, 码: 403, 因: '缺 Origin' };
  if (!自家.includes(来源.toLowerCase().replace(/\/+$/, ''))) {
    return { 行: false, 码: 403, 因: `Origin 不是自家的：${来源.slice(0, 80)}` };
  }

  // ③ 写令牌
  if (!认令(头.令)) return { 行: false, 码: 403, 因: '写令牌无效或已过期，刷新页面重取' };

  return { 行: true, 码: 200, 因: '通过' };
}

/** 本机自家 origin：同一个端口的 localhost 与 127.0.0.1 都算（浏览器地址栏用哪个都行） */
const 自家们 = (端口) => [
  `http://127.0.0.1:${端口}`,
  `http://localhost:${端口}`,
  `http://[::1]:${端口}`,
];

module.exports = { 准写, 新令牌台, 自家们, 令牌活毫秒, 令牌上限 };
