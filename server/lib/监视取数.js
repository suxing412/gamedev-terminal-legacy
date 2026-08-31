// 监视取数.js — 按 监视器/监视器.json 逐格取数，产一份归一后的状态。
//
// 设计与评审见 docs/方案-监视器归一与可视化-2026-08-29.md。这里只重申三条贯穿全文件的纪律：
//
// **一 · 读不到 ≠ 不健康 ≠ 0。** 三者在返回值里是三个不同的东西，界面上也必须长得不一样。
//   把「不知道」显示成一个具体的数，是这块屏能犯的最严重的错（PRODUCT.md 原则 5）。
//
// **二 · 坏行要计数，不许静默跳过。** 案源：事件.jsonl 第 2728 行 133 个前导 NUL，
//   JSON 本体完好却被读侧 .filter(Boolean) 静默吞掉，账少算一笔而无人知（监制台 G17 立闸成因）。
//   但**最后一行**是例外——写方可能正在追加，半行不算坏行（评审 8-2）。
//
// **三 · 只读，不写瞭望塔的地盘。** 本模块对 瞭望塔/ 只有读权限；
//   自己的 offset 状态写在终端自己的目录下。
'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

// ── 状态常量：这五个值是本模块对外的全部健康词汇 ─────────────────
// 「读不到」独立成一档而不是并进「不健康」：取不到数与取到了坏数，
// 处置方式完全不同（前者查通道，后者查被监对象）。
const 态 = Object.freeze({ 在岗: '在岗', 卡住: '卡住', 阵亡: '阵亡', 读不到: '读不到', 超限: '超限' });

/** 从流水行首的 `[2026-08-29 01:35:39]` 取毫秒。取不出返 null（不猜）。 */
function 取行时(行) {
  const m = String(行).match(/^\[(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  const t = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
  return Number.isFinite(t) ? t : null;
}

/** UTF-8 读文本。剥 BOM；读不到返 null（不是空串——空文件与不存在是两回事）。 */
function 读文本(p) {
  try {
    let s = fs.readFileSync(p, 'utf8');
    if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);   // BOM 剥掉，不报错（评审 8-2）
    return s;
  } catch { return null; }
}

/** 从某个字节偏移起读。返回 { 文, 新offset, 重建 }；文件变小＝源被重建，从头读。 */
function 读增量(p, offset) {
  let st;
  try { st = fs.statSync(p); } catch { return null; }
  let 起 = Number(offset) || 0;
  let 重建 = false;
  if (起 > st.size) { 起 = 0; 重建 = true; }          // 只兜得住变小；等长重写兜不住（不变量甲）
  let fd;
  try {
    fd = fs.openSync(p, 'r');
    const 长 = st.size - 起;
    if (长 <= 0) return { 文: '', 新offset: st.size, 重建: 重建 };
    const buf = Buffer.allocUnsafe(长);
    fs.readSync(fd, buf, 0, 长, 起);
    let s = buf.toString('utf8');
    if (起 === 0 && s.charCodeAt(0) === 0xfeff) s = s.slice(1);
    return { 文: s, 新offset: st.size, 重建: 重建 };
  } catch { return null; }
  finally { if (fd !== undefined) { try { fs.closeSync(fd); } catch { /* 关不上不影响取数 */ } } }
}

// ── 源型注册表：加一种型才动这里；加一个格不动 ────────────────────
const 源型 = {
  /** 时刻文件：整份内容就是一个 ISO 时刻。用于心跳一类。 */
  时刻文件(格源, ctx) {
    const p = ctx.解路径(格源.路径);
    const s = 读文本(p);
    if (s === null) return { 读到: false, 因: '文件读不到' };
    const t = Date.parse(String(s).trim());
    if (!Number.isFinite(t)) return { 读到: false, 因: '内容不是时刻：' + String(s).trim().slice(0, 40) };
    return { 读到: true, 时刻: new Date(t).toISOString(), 龄毫秒: Math.max(0, ctx.现在 - t) };
  },

  /**
   * 行文件：取尾 N 行 + 最后修改时刻。用于流水一类。
   *
   * **噪声必须在这里滤掉，不能端到屏上让人自己跳过。** 实测：瞭望塔流水近 400 行里
   * 71% 是值守心跳与在位回执——把它原样摆进最大的格子，等于用整块屏幕显示「系统还在跳」，
   * 而那件事「瞭望塔」那一格用一颗灯就说完了。
   * 噪声行仍然计数（报「另滤掉 N 条例行」），不假装它们不存在——静默丢弃是另一种病。
   */
  行文件(格源, ctx) {
    const p = ctx.解路径(格源.路径);
    let st;
    try { st = fs.statSync(p); } catch { return { 读到: false, 因: '文件读不到' }; }
    const s = 读文本(p);
    if (s === null) return { 读到: false, 因: '文件读不到' };
    const 全 = s.split(/\r?\n/).filter((l) => l.length);

    let 噪 = null;
    if (格源.滤噪) { try { 噪 = new RegExp(格源.滤噪, 'i'); } catch { 噪 = null; } }
    const 留 = 噪 ? 全.filter((l) => !噪.test(l)) : 全;
    const 滤掉 = 全.length - 留.length;

    // 「最近有没有事件」也要按滤过的算：心跳每 5 分钟一条，不滤的话这一格永远绿，
    // 而它本来要答的是「产线在不在动」，不是「时钟在不在走」。
    const 末真 = 留.length ? 取行时(留[留.length - 1]) : null;
    const n = Number(格源.尾行) || 200;
    return {
      读到: true,
      行: 留.slice(-n),
      总行数: 全.length,
      有效行数: 留.length,
      滤掉: 滤掉,
      龄毫秒: 末真 != null ? Math.max(0, ctx.现在 - 末真) : Math.max(0, ctx.现在 - st.mtimeMs),
      按真事件计龄: 末真 != null,
      末改: new Date(st.mtimeMs).toISOString(),
    };
  },

  /**
   * jsonl：按 offset 增量读；坏行计数不吞；末行半行不算坏。
   *
   * **积压必须算全量，不能算这一轮的增量。** 实测踩过：第一轮报积压 7，第二轮增量读到 0 行，
   * 于是报积压 0——屏上显示 0 而真相是 7，正是「读不到折叠成零」那条不变量的新变种。
   * 治法：积压跨轮累计；而水位一旦前移（只在清账时发生，很少），重扫一次全量重算。
   * 水位不动时走增量，水位动了才付一次全扫——两头的代价都躲开。
   */
  jsonl(格源, ctx) {
    const p = ctx.解路径(格源.路径);
    const 键 = 'jsonl:' + p;

    // 先读水位：它变了就作废本文件的增量状态
    let 水位 = null;
    if (格源.水位) {
      const w = 读文本(ctx.解路径(格源.水位));
      if (w !== null) { try { 水位 = JSON.parse(w).至 || null; } catch { 水位 = null; } }
    }
    const 水键 = 'water:' + p;
    const 累键 = 'tally:' + p;
    const 上次水位 = ctx.取offset(水键);
    const 水位变了 = String(上次水位 || '') !== String(水位 || '');
    if (水位变了) { ctx.存offset(键, 0); ctx.存offset(累键, 0); ctx.存offset(水键, 水位); }

    const r = 读增量(p, 水位变了 ? 0 : ctx.取offset(键));
    if (r === null) return { 读到: false, 因: '文件读不到' };
    const 行 = r.文.split('\n');
    // 末尾若无换行结尾，最后一段可能是半行——留到下轮，offset 回退到它之前
    let 尾半 = '';
    if (r.文.length && !r.文.endsWith('\n')) 尾半 = 行.pop() || '';
    ctx.存offset(键, r.新offset - Buffer.byteLength(尾半, 'utf8'));

    const 条 = []; let 坏行 = 0;
    for (const l of 行) {
      const t = l.trim();
      if (!t) continue;
      try { 条.push(JSON.parse(t)); }
      catch { 坏行 += 1; }                             // 计数，不静默吞（G17 的教训）
    }
    const 上限 = Number(格源.行上限) || 2000;
    const 截 = 条.length > 上限;

    // 积压跨轮累计：本轮新增里超过水位的加进去；源被重建时从头重数
    let 积压 = null;
    if (水位) {
      const 本轮超水位 = 条.filter((e) => e && String(e.t || '') > String(水位)).length;
      const 旧累 = r.重建 ? 0 : (Number(ctx.取offset(累键)) || 0);
      积压 = 旧累 + 本轮超水位;
      ctx.存offset(累键, 积压);
    }
    return {
      读到: true,
      条: 截 ? 条.slice(-上限) : 条,
      本轮新增: 条.length,
      坏行: 坏行,
      截断: 截,
      水位: 水位,
      积压: 积压,          // 全量累计，不是本轮的
      源已重建: !!r.重建,
    };
  },

  /** 进程：读 pid 文件，探那个 pid 是否还活着。与文件新鲜度互为第二路证据（评审 8-1）。 */
  进程(格源, ctx) {
    const p = ctx.解路径(格源.路径);
    const s = 读文本(p);
    if (s === null) return { 读到: false, 因: 'pid 文件读不到' };
    let pid = null;
    try { pid = JSON.parse(s)[格源.取 || 'pid']; } catch { pid = Number(String(s).trim()); }
    if (!Number.isFinite(Number(pid))) return { 读到: false, 因: 'pid 不是数字' };
    let 活 = false;
    // signal 0 = 只探不发信号。EPERM 意味着进程在但不归我管——那也是「活着」
    try { process.kill(Number(pid), 0); 活 = true; }
    catch (e) { 活 = (e && e.code === 'EPERM'); }
    let 记根 = null;
    try { 记根 = JSON.parse(s).根 || null; } catch { /* 老格式没有根，不算错 */ }
    return { 读到: true, pid: Number(pid), 活: 活, 记根: 记根 };
  },

  /** HTTP：取状态码与响应体。通不等于是它——身份由 健康.型=HTTP身份 另判（评审 8-4）。 */
  async HTTP(格源, ctx) {
    const 地址 = String(格源.地址 || '');
    const 超 = Number(格源.超时毫秒) || 4000;
    return await new Promise((res) => {
      let 收 = '';
      const mod = 地址.startsWith('https:') ? https : http;
      let 完 = false;
      const 收摊 = (v) => { if (!完) { 完 = true; res(v); } };
      let req;
      try {
        req = mod.get(地址, (up) => {
          up.setEncoding('utf8');
          up.on('data', (d) => { if (收.length < 65536) 收 += d; });
          up.on('end', () => 收摊({ 读到: true, 码: up.statusCode, 体: 收 }));
        });
      } catch (e) { return 收摊({ 读到: false, 因: String((e && e.message) || e).slice(0, 80) }); }
      req.setTimeout(超, () => { try { req.destroy(); } catch { /* 已断 */ } 收摊({ 读到: false, 因: '超时 ' + 超 + 'ms' }); });
      req.on('error', (e) => 收摊({ 读到: false, 因: (e && e.code) || String(e && e.message).slice(0, 60) }));
      void ctx;
    });
  },

  /** 复合：多路并取，各路结果按键归位。任一路读不到不影响其余路。 */
  async 复合(格源, ctx) {
    const 出 = { 读到: true, 路: {} };
    for (const 子 of (格源.路 || [])) {
      const f = 源型[子.型];
      出.路[子.键] = f ? await f(子, ctx) : { 读到: false, 因: '未知源型 ' + 子.型 };
    }
    return 出;
  },
};

// ── 健康型注册表 ────────────────────────────────────────────────
const 健康型 = {
  新鲜度(数, 格健康) {
    if (!数.读到) return { 态: 态.读不到, 因: 数.因 };
    const 阈 = Number(格健康.阈值毫秒) || 90000;
    return 数.龄毫秒 <= 阈
      ? { 态: 态.在岗, 因: '龄 ' + Math.round(数.龄毫秒 / 1000) + 's' }
      : { 态: 态.卡住, 因: '龄 ' + Math.round(数.龄毫秒 / 1000) + 's 超阈 ' + Math.round(阈 / 1000) + 's' };
  },

  有新行(数, 格健康) {
    if (!数.读到) return { 态: 态.读不到, 因: 数.因 };
    const 阈 = Number(格健康.阈值毫秒) || 1800000;
    return 数.龄毫秒 <= 阈
      ? { 态: 态.在岗, 因: '最近 ' + Math.round(数.龄毫秒 / 60000) + ' 分钟内有事件' }
      : { 态: 态.卡住, 因: Math.round(数.龄毫秒 / 60000) + ' 分钟无新事件' };
  },

  积压上限(数, 格健康) {
    if (!数.读到) return { 态: 态.读不到, 因: 数.因 };
    if (数.积压 === null) return { 态: 态.读不到, 因: '水位读不到，积压算不出' };
    const 阈 = Number(格健康.阈值) || 50;
    return 数.积压 <= 阈
      ? { 态: 态.在岗, 因: '积压 ' + 数.积压 }
      : { 态: 态.超限, 因: '积压 ' + 数.积压 + ' 超阈 ' + 阈 };
  },

  /** 通不等于是它：状态码 200 之外，还须在响应体里认出约定字段。 */
  HTTP身份(数, 格健康) {
    if (!数.读到) return { 态: 态.阵亡, 因: 数.因 };
    if (数.码 !== 200) return { 态: 态.阵亡, 因: 'HTTP ' + 数.码 };
    let j = null;
    try { j = JSON.parse(数.体); } catch { return { 态: 态.阵亡, 因: '返回不是 JSON——端口被别的东西占了' }; }
    const 缺 = (格健康.须含 || []).filter((k) => j[k] === undefined || j[k] === null);
    if (缺.length) return { 态: 态.阵亡, 因: '认不出身份，缺字段 ' + 缺.join('/') };
    return { 态: 态.在岗, 因: (格健康.须含 || []).map((k) => k + '=' + j[k]).join(' · '), 体: j };
  },

  进程活(数) {
    if (!数.读到) return { 态: 态.读不到, 因: 数.因 };
    return 数.活 ? { 态: 态.在岗, 因: 'pid ' + 数.pid } : { 态: 态.阵亡, 因: 'pid ' + 数.pid + ' 不在' };
  },

  /**
   * 互保战果：今天有谁被扶起来过。
   *
   * **这一格的存在本身就是互保的主要价值。** 自动重启而不报告，比手动重启加告警更坏——
   * 一个「一直好好的」和一个「死了十次又被扶了十次」在屏上长得一模一样，
   * 人会以为很稳，其实每小时崩一次。所以「今天扶过几次」必须上屏。
   *
   * 零次＝在岗（没人需要扶）；扶过＝卡住（有东西在反复死）；停手＝阵亡（扶不动了，等人）。
   */
  互保(数, 格健康) {
    if (!数.读到) return { 态: 态.读不到, 因: 数.因 };
    let j = null;
    try { j = JSON.parse(数.体); } catch { return { 态: 态.读不到, 因: '返回不是 JSON' }; }
    const 战 = (j && j.战果) || {};
    if (!战.读到) return { 态: 态.在岗, 因: '今天没有人需要扶' + (战.因 ? '（' + 战.因 + '）' : ''), 组: [] };
    const 各 = 战.各目标 || [];
    if (!各.length) return { 态: 态.在岗, 因: '今天没有人需要扶', 组: [] };
    const 停 = 各.filter((x) => x.停手);
    const 总 = 各.reduce((s, x) => s + (x.拉起 || 0), 0);
    if (停.length) {
      return { 态: 态.阵亡, 因: 停.map((x) => x.目标 + ' 连拉几次都没起来，已停手等人看').join('；'), 组: 各 };
    }
    const 阈 = Number(格健康.阈值) || 0;
    return 总 > 阈
      ? { 态: 态.卡住, 因: '今天扶起 ' + 总 + ' 次：' + 各.map((x) => x.目标 + ' ' + x.拉起 + ' 次' + (x.失败 ? '（失败 ' + x.失败 + '）' : '')).join('、'), 组: 各 }
      : { 态: 态.在岗, 因: '今天没有人需要扶', 组: 各 };
  },

  /**
   * 子项健康：响应体里有一组子项（如逐个情报源），按「有几个是坏的」判整格。
   * 用于源健康这一类——整格绿不代表每一项都绿，所以 因 里要报出坏的那几个的名字。
   */
  子项(数, 格健康) {
    if (!数.读到) return { 态: 态.读不到, 因: 数.因 };
    if (数.码 !== undefined && 数.码 !== 200) return { 态: 态.阵亡, 因: 'HTTP ' + 数.码 };
    let j = null;
    try { j = JSON.parse(数.体); } catch { return { 态: 态.阵亡, 因: '返回不是 JSON' }; }
    const 组 = j[格健康.取 || '每源'];
    if (!Array.isArray(组)) return { 态: 态.读不到, 因: '响应里没有 ' + (格健康.取 || '每源') + ' 数组' };
    if (!组.length) return { 态: 态.读不到, 因: '一个子项都没有——不是零，是没配' };
    const 坏字段 = 格健康.坏当有 || '最近失败';
    const 坏 = 组.filter((x) => x && x[坏字段]);
    return 坏.length
      ? { 态: 态.卡住, 因: 组.length + ' 项中 ' + 坏.length + ' 项有失败：' + 坏.map((x) => x.名称 || x.源).join('、'), 组: 组 }
      : { 态: 态.在岗, 因: 组.length + ' 项全通', 组: 组 };
  },

  /**
   * 复合：按 判[] 顺序求值，首个命中即停。
   * 表达式受限——只认 `路键.字段`、`!路键.字段`、数字比较与 &&，不做通用求值。
   * 故意不下 eval：配置文件是可以被人随手改的，给它一个能跑任意代码的口子不值当。
   */
  复合(数, 格健康) {
    for (const 条 of (格健康.判 || [])) {
      if (判表达式(String(条.当 || ''), 数.路 || {})) {
        // **因 只用 说，绝不回落成表达式。** 原样写 `条.说 || 条.当`，
        // 结果是 `心跳.龄毫秒 <= 90000` 直接漏到屏上——那是配置的内部形式，
        // 对着屏的人看了不知道心跳几秒前、进程在不在。没写 说 就报「命中第 N 条」，
        // 难看但至少诚实地指向配置，不冒充人话。
        return { 态: 条.则, 因: 条.说 || ('命中判条件第 ' + ((格健康.判 || []).indexOf(条) + 1) + ' 条（该条没写「说」）') };
      }
    }
    return { 态: 态.读不到, 因: '所有判条件都不命中——配置没覆盖当前情形' };
  },
};

/** 取一路的字段值。`心跳.龄毫秒` → 数.路.心跳.龄毫秒；`心跳.读不到` 取 !读到。 */
function 取值(串, 路) {
  const [k, f] = String(串).split('.');
  const r = 路[k];
  if (!r) return undefined;
  if (f === '读不到') return !r.读到;
  return r[f];
}

function 判一(片, 路) {
  const s = String(片).trim();
  const m = s.match(/^([^\s!<>=]+(?:\.[^\s!<>=]+)?)\s*(>|<|>=|<=|==)\s*(-?\d+)$/);
  if (m) {
    const v = Number(取值(m[1], 路));
    if (!Number.isFinite(v)) return false;
    const n = Number(m[3]);
    switch (m[2]) {
      case '>': return v > n;
      case '<': return v < n;
      case '>=': return v >= n;
      case '<=': return v <= n;
      default: return v === n;
    }
  }
  if (s.startsWith('!')) return !取值(s.slice(1), 路);
  return !!取值(s, 路);
}

function 判表达式(表达式, 路) {
  const 片 = String(表达式).split('&&').map((x) => x.trim()).filter(Boolean);
  if (!片.length) return false;
  return 片.every((x) => 判一(x, 路));
}

// ── 取一整轮 ────────────────────────────────────────────────────
/**
 * 取数(配置, opts) → { 版本, 于, 格: [...], 配置错? }
 * opts: { 塔根, 现在, offset存储 }
 * 任何一格自己炸掉都不许拖垮整轮——那正是「一切东西都会报错」的观感来源。
 */
async function 取数(配置, opts = {}) {
  const 现在 = opts.现在 != null ? opts.现在 : Date.now();
  const 塔根 = String(opts.塔根 || 配置.瞭望塔根 || '');
  const 存 = opts.offset存储 || { get: () => 0, set: () => {} };
  const ctx = {
    现在: 现在,
    解路径: (p) => (path.isAbsolute(String(p)) ? String(p) : path.join(塔根, String(p))),
    取offset: (k) => 存.get(k),
    存offset: (k, v) => 存.set(k, v),
  };

  const 出 = [];
  for (const 格 of (配置.格 || [])) {
    try {
      const f = 源型[(格.源 || {}).型];
      const 数 = f ? await f(格.源, ctx) : { 读到: false, 因: '未知源型 ' + (格.源 || {}).型 };
      const h = 健康型[(格.健康 || {}).型];
      const 健 = h ? h(数, 格.健康) : { 态: 态.读不到, 因: '未知健康型 ' + (格.健康 || {}).型 };
      // 健.组 是健康型算出来的子项明细（如逐源状态）——随格下发给呈现层。
      // 不把它塞回 数：数 是「源给了什么」，组 是「健康型从中解读出什么」，两者别混。
      出.push({
        键: 格.键, 名: 格.名, 说: 格.说 || null,
        位: 格.位 || '主',
        问: 格.问 || null,
        坏了做什么: 格.坏了做什么 || null,
        态: 健.态, 因: 健.因, 组: 健.组 || null,
        呈现: 格.呈现 || { 型: '灯' }, 数: 数,
      });
    } catch (e) {
      // 单格异常隔离：本格报「读不到」并带上错因，其余格照常
      出.push({ 键: 格.键, 名: 格.名, 态: 态.读不到, 因: '取数异常：' + String((e && e.message) || e).slice(0, 120), 呈现: 格.呈现 || { 型: '灯' }, 数: null });
    }
  }
  return { 版本: 配置.版本 || 1, 于: new Date(现在).toISOString(), 塔根: 塔根, 格: 出 };
}

/** 读配置。坏 JSON / 缺 格 键都不许崩，返回可呈现的错（评审：配置坏了不崩）。 */
function 读配置(p) {
  const s = 读文本(p);
  if (s === null) return { ok: false, 因: '配置文件读不到：' + p };
  let j;
  try { j = JSON.parse(s); } catch (e) { return { ok: false, 因: '配置不是合法 JSON：' + String(e.message).slice(0, 100) }; }
  if (!Array.isArray(j.格)) return { ok: false, 因: '配置缺 格[] 或它不是数组' };
  return { ok: true, 配置: j };
}

module.exports = { 取数, 读配置, 态, 源型, 健康型, 判表达式, 读增量 };
