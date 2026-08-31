// 读数.js — 三张页共用的读盘层（M1c）
//
// 「文件即正本、服务只是视图」（施工令 §4 数据形态那一行）——所以这里只读，一个写口都不开。
// 页面渲染坏了不会弄脏数据，这是把读写分在两个模块的实际收益，不是洁癖。
const fs = require('fs');
const path = require('path');

// 配置件：先看数据根，取不到回落随包那份。**与 intel/run.js 的 配置件() 同一条规则**。
//
// 2026-08-28 教训：那边加了回落、这边没加，于是装成 exe 之后
// 管道找得到源（用了包内配置、真去抓了 100 条），而网页层 `/health` 报「源数 0」——
// **同一个问题的两个读口给出互相打架的答案**，排查时先怀疑的是数据根，绕了一圈才发现是配置口径分叉。
// 一份配置有两个读法，就一定会在某一天各读各的。
function 配置件(根, 名) {
  const 近 = path.join(根, 'config', 名);
  if (fs.existsSync(近)) return 近;
  return path.join(__dirname, '..', '..', 'config', 名);
}

const 日形 = /^\d{4}-\d{2}-\d{2}$/;
const 是日 = (s) => 日形.test(String(s || ''));

const 目 = {
  日报: (根) => path.join(根, 'data', 'digests'),
  流: (根) => path.join(根, 'data', 'stream'),
  健康: (根) => path.join(根, 'data', 'health', 'fetch.jsonl'),
};

// 本地日。**不能用 toISOString().slice(0,10)**——那是 UTC 日。
// UTC+8 下每天 00:00–08:00 会算成前一天，而日报恰恰是早上看的（server.js 同一处已踩过）。
const 本地日 = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// 本地月。同一条尺，同一个理由，只是错得更隐蔽也更毒：
//
// journal 的写侧（Ticketflow/apps/studio/lib/journal.js:16）按 `d.getMonth()+1` 分档，
// 而 /api/events 原本用 `toISOString().slice(0,7)` 拼档名。UTC+8 下，
// **每月 1 号本地 00:00–07:59 对应 UTC 上个月最后一天**，于是它去读上个月那份 log——
// 文件存在、读得通、行数正常，**根本不进「读不到」分支**。
// 屏上是一栏照常滚动的事件和一个正在跳的刷新钟，而这八小时里的任何告警一条都不会出现；
// 08:00 自己好了，不留痕，事后复现不了。
// 日错一天还能从「今天怎么这么静」察觉；月错八小时，正好压在夜班上。
const 本地月 = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

/** 有日报的日期，降序。读不到目录回空数组——一份都没有是合法状态（新装的仓）。 */
function 日报日期(根) {
  try {
    return fs.readdirSync(目.日报(根))
      .filter((f) => f.endsWith('.md') && 是日(f.slice(0, -3)))
      .map((f) => f.slice(0, -3)).sort().reverse();
  } catch { return []; }
}

/** 有原始流的日期，降序。流按月分目录，要下探一层。 */
function 流日期(根) {
  const 出 = [];
  try {
    for (const 月 of fs.readdirSync(目.流(根))) {
      if (!/^\d{4}-\d{2}$/.test(月)) continue;
      try {
        for (const f of fs.readdirSync(path.join(目.流(根), 月))) {
          if (f.endsWith('.jsonl') && 是日(f.slice(0, -6))) 出.push(f.slice(0, -6));
        }
      } catch { /* 单月读不动不该让整张清单空掉 */ }
    }
  } catch { return []; }
  return 出.sort().reverse();
}

/** 某日日报：{ md, 清单 }；没有则 null。清单读不到不影响 md（徽章降级，正文照给）。 */
function 日报(根, 日) {
  if (!是日(日)) return null;
  let md = null;
  try { md = fs.readFileSync(path.join(目.日报(根), `${日}.md`), 'utf8'); } catch { return null; }
  let 清单 = null;
  try { 清单 = JSON.parse(fs.readFileSync(path.join(目.日报(根), `${日}.json`), 'utf8')); } catch { 清单 = null; }
  return { 日, md, 清单 };
}

/** 某日原始流条目数组。坏行逐行跳过并计数——一行坏 JSON 不该把一天的流全吞掉。 */
function 流(根, 日) {
  if (!是日(日)) return { 条目: [], 坏行: 0 };
  const f = path.join(目.流(根), 日.slice(0, 7), `${日}.jsonl`);
  let 文;
  try { 文 = fs.readFileSync(f, 'utf8'); } catch { return null; }
  const 条目 = []; let 坏行 = 0;
  for (const l of 文.split('\n')) {
    if (!l.trim()) continue;
    try { 条目.push(JSON.parse(l)); } catch { 坏行++; }
  }
  return { 条目, 坏行 };
}

/** 抓取健康流水（全量，调用方自己按日筛）。 */
function 健康流水(根) {
  let 文;
  try { 文 = fs.readFileSync(目.健康(根), 'utf8'); } catch { return []; }
  const 出 = [];
  for (const l of 文.split('\n')) {
    if (!l.trim()) continue;
    try { 出.push(JSON.parse(l)); } catch { /* 坏行跳过 */ }
  }
  return 出;
}

function 源表(根) {
  try {
    const j = JSON.parse(fs.readFileSync(配置件(根, 'sources.json'), 'utf8'));
    const a = Array.isArray(j) ? j : (j.源 || j.sources || []);
    return Array.isArray(a) ? a : [];
  } catch { return []; }
}

function 评分权重(根) {
  try { return JSON.parse(fs.readFileSync(配置件(根, 'scoring.json'), 'utf8')); }
  catch { return null; }
}

/** 在一串降序日期里找 日 的邻居。日不在列内时仍给出前后位（翻页不该因为落在空日就断掉）。 */
function 邻日(降序日期, 日) {
  const a = [...降序日期].sort();               // 升序好判前后
  const 前 = a.filter((d) => d < 日).pop() || null;
  const 后 = a.filter((d) => d > 日).shift() || null;
  return { 上一日: 前, 下一日: 后 };
}

module.exports = { 是日, 本地日, 本地月, 日报日期, 流日期, 日报, 流, 健康流水, 源表, 评分权重, 邻日, 目 };
