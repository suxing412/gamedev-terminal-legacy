// 审屏：在坐席页面里跑的自检。对比度 / 几何 / 溢出 / 层次，一次跑完给红项。
// 用法（浏览器控制台或 javascript_tool）：await (await import('/_审屏.js')).审()
//
// 为什么自己算 oklch → sRGB：canvas 的 fillStyle 在本环境解析不了 oklch，赋值失败会
// 静默保留上一个值（黑），于是任何量法都会得出"黑对黑 = 1.00"的假数。踩过一次，记在这里。

const D65 = null; // 占位：本文件只做 sRGB，不做色域外裁剪

export function oklch2rgb(L, C, H) {
  const h = (H * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
  const R = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const G = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const B = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s;
  const f = (x) => {
    const v = x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(Math.max(x, 0), 1 / 2.4) - 0.055;
    return Math.min(255, Math.max(0, Math.round(v * 255)));
  };
  return [f(R), f(G), f(B)];
}

const 解色 = (v) => {
  let m = v.match(/oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)/i);
  if (m) return oklch2rgb(+m[1], +m[2], +m[3]);
  m = v.match(/rgba?\(([^)]+)\)/);
  if (m) return m[1].split(/[,\s/]+/).filter(Boolean).map(Number).slice(0, 3);
  return null;
};
const 解透 = (v) => {
  let m = v.match(/oklch\([^)]*\/\s*([\d.]+)\s*\)/);
  if (m) return +m[1];
  m = v.match(/rgba?\(([^)]+)\)/);
  if (m) { const p = m[1].split(/[,\s/]+/).filter(Boolean); return p.length > 3 ? +p[3] : 1; }
  return 1;
};
const 叠 = (fg, bg, a) => fg.map((c, i) => Math.round(c * a + bg[i] * (1 - a)));
const 亮 = (c) => {
  const f = c.map((x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2];
};
export const 对比 = (a, b) => {
  const [x, y] = [亮(a), 亮(b)];
  return +(((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)).toFixed(2));
};
// 逐层往上叠真实底色：元素自己透明就借父级的，一路叠到黑
export const 底色 = (el) => {
  const 栈 = [];
  for (let n = el; n; n = n.parentElement) {
    const v = getComputedStyle(n).backgroundColor;
    const a = 解透(v);
    if (a > 0) 栈.push([解色(v), a]);
  }
  let cur = [0, 0, 0];
  for (let i = 栈.length - 1; i >= 0; i--) cur = 叠(栈[i][0], cur, 栈[i][1]);
  return cur;
};

// 一项 / 底色 / 全测 都导出（2026-08-28）：M1c 的阅读页也要量对比度，
// 而原样只导出 对比()——它收的是 RGB 数组不是 CSS 串，在页面里直接调必抛。
// 于是当时在浏览器里现写了一版土解析，把 `oklch(0.93 0.004 255)` 当 RGB 读，
// 量出来每一项都是 1.00「全不过」——**测错了却看着像测过了**，比不测更危险。
// 一件工具做不到复用，下一个用它的人就会现写一个坏的。
export const 一项 = (sel, 名) => {
  const e = document.querySelector(sel);
  if (!e) return { 名, 缺: true };
  const cs = getComputedStyle(e);
  const bg = 底色(e);
  const 比 = 对比(叠(解色(cs.color), bg, 解透(cs.color)), bg);
  const px = parseFloat(cs.fontSize);
  const 大字 = px >= 18 || (px >= 14 && +cs.fontWeight >= 700);
  const 需 = 大字 ? 3 : 4.5;
  return { 名, 比, 字: px + 'px/' + cs.fontWeight, 需, 过: 比 >= 需 };
};

const 文项 = [
  ['.话 .文', '对话正文'], ['.话.我 .文', '我说的话'], ['.话 .谁', '说话人'],
  ['.闸 .题', '闸·标题'], ['.闸 .号', '闸·单号'], ['.闸 .久', '闸·时长'], ['.闸 .谁', '闸·出处'],
  ['.闸.久2 .谁', '闸·出处(高亮行)'], ['.空态', '闸·空态'],
  ['.事 span', '流水正文'], ['.事 time', '流水时刻'],
  ['.计 .值', '计数值'], ['.计 .标', '计数标'], ['.跑 .环', '在跑环节'], ['.跑 .号', '在跑单号'],
  // `.徽` 已删（2026-09-02 拆栏评审）：JS 从没写过它，而它常年宣称「总监在岗」，
  // 同刻值守心跳是 阵亡:true——屏上唯一一处无条件常亮的假断言。
  ['.说注', '说话提示'], ['.顶况', '顶条况'], ['.栏头 h2', '栏头'], ['.读不到', '读不到'],
];

export function 审() {
  const 框 = (s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; };
  const 色 = 文项.map(([s, n]) => 一项(s, n));

  // 占位符也是正文（skill：placeholder 同样要 4.5，不能用默认灰）
  const 框元 = document.querySelector('.说框');
  let 占位 = null;
  if (框元) {
    const p = getComputedStyle(框元, '::placeholder');
    const bg = 底色(框元);
    占位 = { 名: '输入占位', 比: 对比(叠(解色(p.color), bg, 解透(p.color)), bg), 需: 4.5 };
    占位.过 = 占位.比 >= 占位.需;
    色.push(占位);
  }

  const 话 = document.querySelector('.话');
  const 中 = document.querySelector('.话栏');
  const 报 = {
    视口: [innerWidth, innerHeight],
    横溢: document.documentElement.scrollWidth > innerWidth,
    页面纵滚: document.documentElement.scrollHeight > innerHeight,
    栏: { 左: 框('.闸栏'), 中: 框('.话栏'), 右: 框('.脉栏'), 顶: 框('.顶') },
    阅读列: 话 ? { 宽: Math.round(话.getBoundingClientRect().width), 居中偏差: Math.abs(Math.round(话.getBoundingClientRect().left - 中.getBoundingClientRect().left) - Math.round(中.getBoundingClientRect().right - 话.getBoundingClientRect().right)) } : null,
    栏内滚动: {
      闸列: (() => { const e = document.querySelector('.闸列'); return e && e.scrollHeight > e.clientHeight; })(),
      事列: (() => { const e = document.querySelector('.事列'); return e && e.scrollHeight > e.clientHeight; })(),
    },
    逾期分档: {
      久2: document.querySelectorAll('.闸.久2').length,
      久1: document.querySelectorAll('.闸.久1').length,
      常: document.querySelectorAll('.闸:not(.久1):not(.久2)').length,
    },
    // 强调色纪律：琥珀只准出现在人闸相关处
    强调色越界: [...document.querySelectorAll('.话栏 *, .脉栏 *')].filter((e) => {
      const c = getComputedStyle(e).color;
      if (!/oklch\(\s*0\.(78|66)\s+0\.1/.test(c)) return false;
      return !e.closest('.带') && !e.classList.contains('在跑') && !e.closest('.在跑') && !e.closest('.读不到');
    }).map((e) => e.className || e.tagName),
  };
  报.对比红 = 色.filter((x) => !x.缺 && !x.过);
  报.对比全过 = 报.对比红.length === 0;
  报.未测 = 色.filter((x) => x.缺).map((x) => x.名);
  报.色 = 色;
  return 报;
}

/** 全测(项表) —— 按 [[选择器, 名], …] 量一组文本的对比度。阅读页与坐席共用同一把尺。 */
export const 全测 = (项表) => {
  const 色 = 项表.map(([s, n]) => 一项(s, n));
  return { 色, 红: 色.filter((x) => !x.缺 && !x.过), 未测: 色.filter((x) => x.缺).map((x) => x.名) };
};

/** 阅读页（日报/原始流/空态）的取样点。与坐席那张表并列，各测各的。 */
export const 阅读页项 = [
  ['.digest p', '日报段落'], ['.digest > ul > li', '日报条目'], ['.digest > ul > li > ul > li', '日报精编'],
  ['.digest blockquote', '日报引言'], ['.digest code', '日报源名'], ['.digest em', '日报空区'],
  ['.digest a', '日报链接'], ['.meta', '日报副行'],
  ['.brand', '页头品牌'], ['.brand .d', '页头日期'], ['.tab', '页签'], ['.tab.on', '当前页签'],
  ['.nav', '翻页'], ['.nav.off', '翻页禁用'],
  ['.item .t', '流条标题'], ['.sub .src', '流条源'], ['.sub .ts', '流条时刻'], ['.sub .sc', '流条评分'],
  ['.badge', '已入报徽章'], ['.item summary', '展开钮'], ['.item details p', '展开正文'],
  ['.filters label', '过滤标'], ['.filters .count', '过滤计数'],
  ['.empty h1', '空态标题'], ['.hint', '空态说明'], ['.recent a', '空态入口'],
];

export default { 审, 对比, oklch2rgb, 一项, 底色, 全测, 阅读页项 };
