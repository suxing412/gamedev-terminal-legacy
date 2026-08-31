// dedupe.js — 规范化 URL → dedupe_key（施工令 P5）
//
// 去重键就是条目 id（§3.2）：同一篇文章从两个源、或同一源两次抓取进来，必须收敛到同一个键。
// 跨源跨日去重，seen 台账载入当月+上月。
//
// 规范化要削掉的东西，一条条都是实际会变的：
//   · 追踪参数（utm_* / fbclid / gclid / ref / source）——同一篇文章从不同渠道进来只差这个
//   · 锚点（#section）——同页不同位置不是不同文章
//   · 尾斜杠、默认端口、协议大小写、host 大小写
//   · 协议 http↔https——同一站升级 https 后旧链接还在流通
// **不削 query 里的非追踪参数**：`?id=123` 那种是真的定位信息，削了会把不同文章合成一条。
const crypto = require('crypto');

const 追踪参数 = /^(utm_|fbclid$|gclid$|mc_cid$|mc_eid$|ref$|ref_src$|source$|spm$|from$)/i;

function 规范化(u) {
  let x;
  try { x = new URL(String(u).trim()); } catch { return String(u || '').trim().toLowerCase(); }

  x.protocol = 'https:';                       // 协议归一：http/https 视为同一篇
  x.hash = '';                                 // 锚点不是身份
  x.hostname = x.hostname.toLowerCase().replace(/^www\./, '');
  if ((x.port === '80') || (x.port === '443')) x.port = '';

  // 只删追踪参数，其余留着——`?id=123` 是真定位信息
  const keep = [];
  for (const [k, v] of x.searchParams) if (!追踪参数.test(k)) keep.push([k, v]);
  keep.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));   // 参数顺序不同不算不同 URL
  x.search = keep.length ? '?' + keep.map(([k, v]) => `${k}=${v}`).join('&') : '';

  // 尾斜杠：/a/ 与 /a 同一页；但根路径 "/" 保留
  if (x.pathname.length > 1) x.pathname = x.pathname.replace(/\/+$/, '');

  return x.toString();
}

const 键 = (u) => crypto.createHash('sha1').update(规范化(u), 'utf8').digest('hex');

// seen 台账：一行一个键的纯文本。载入当月+上月两份——
// 跨月那几天不该因为换了文件就把去重记忆清零。
function 载入seen(读, 月份们) {
  const s = new Set();
  for (const m of 月份们) {
    let 文 = null;
    try { 文 = 读(m); } catch { 文 = null; }
    if (!文) continue;
    for (const l of String(文).split(/\r?\n/)) { const t = l.trim(); if (t) s.add(t); }
  }
  return s;
}

const 当月上月 = (d) => {
  const y = d.getFullYear(); const m = d.getMonth();
  const f = (yy, mm) => `${yy}-${String(mm + 1).padStart(2, '0')}`;
  return [f(y, m), m === 0 ? f(y - 1, 11) : f(y, m - 1)];
};

module.exports = { 规范化, 键, 载入seen, 当月上月, 追踪参数 };
