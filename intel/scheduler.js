// scheduler.js — 班次调度（施工令 P2）
//
// 每分钟一拍对时刻表；**时钟可注入**——判据 C7 要「注入模拟时钟走完一天」，
// 真钟的调度器是测不动的（等一天才知道对不对，那不叫判据）。
//
// 两条来自施工令的硬要求：
//   · 服务重启后本班次未跑的任务**补跑一次**（游标判断，不重复）
//   · 抓取班次与日报时点进配置（待拍板①，现取建议值）
//
// 补跑的判据形状：**同一 (日期, 班次key) 只跑一次**。落盘在 state/班次.json。
// 不用「上次运行时刻 + 间隔」那种算法——重启会把间隔重新开始算，那正是漏跑的来源。
const fs = require('fs');
const path = require('path');

const 默认班次 = {
  抓取: ['07:10', '12:10', '22:10'],   // 待拍板①建议值：午间窗与晚间各覆盖一班
  日报: ['08:20'],                      // 08:30 可读——09-01 之后通勤/晨间
};

const 读 = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const 写 = (f, o) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(o, null, 1), 'utf8'); };

const 日串 = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const 分串 = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

// 到点判定：**已过点且当日未跑** → 该跑。
// 用「已过点」而不是「正好等于」，重启落在时刻之后的那一分钟才补得回来——
// 只认相等的话，服务在 07:11 起来，07:10 那班就永远错过了。
function 该跑的(表, 现在, 台账) {
  const 日 = 日串(现在);
  const 此刻 = 分串(现在);
  const 出 = [];
  for (const [类, 时刻们] of Object.entries(表)) {
    for (const t of 时刻们) {
      if (t > 此刻) continue;                       // 还没到点
      const key = `${日}|${类}|${t}`;
      if (台账[key]) continue;                      // 当日这一班已跑过
      出.push({ 类, 时刻: t, key });
    }
  }
  return 出;
}

// 跑一拍。任务实际怎么执行由 opts.执行 注入（判据用桩，生产传真的 抓/出报）。
async function 一拍(base, opts = {}) {
  const 现在 = opts.现在 ? new Date(opts.现在) : new Date();
  const 表 = opts.班次 || 读(path.join(base, 'config', 'terminal.json'), {}).班次 || 默认班次;
  const 台账档 = path.join(base, 'data', 'state', '班次.json');
  const 台账 = 读(台账档, {});
  const 待 = 该跑的(表, 现在, 台账);
  const 跑了 = [];
  for (const 任务 of 待) {
    let ok = true; let 因= null;
    try {
      if (opts.执行) await opts.执行(任务, 现在);
    } catch (e) { ok = false; 因 = String((e && e.message) || e).slice(0, 200); }
    // **无论成败都记账**：失败也算这一班跑过了，不然下一拍会立刻重跑，
    // 一个持续失败的源会把整个班次变成每分钟重试一次。重试归重试逻辑管，不归调度管。
    台账[任务.key] = { 跑于: 现在.toISOString(), ok, 因 };
    跑了.push({ ...任务, ok, 因 });
  }
  if (跑了.length) {
    // 只留最近 400 条：班次台账是给「跑没跑过」判断用的，不是历史档案
    const 键们 = Object.keys(台账).sort();
    if (键们.length > 400) for (const k of 键们.slice(0, 键们.length - 400)) delete 台账[k];
    写(台账档, 台账);
  }
  return { 现在: 现在.toISOString(), 跑了, 待数: 待.length };
}

// 常驻：每分钟一拍。返回 stop()。
function 起(base, opts = {}) {
  const 间隔 = opts.间隔毫秒 || 60000;
  let 停 = false;
  const 拍 = async () => {
    if (停) return;
    try { await 一拍(base, opts); } catch (e) { console.error('[intel调度] 一拍出错：', e.message); }
  };
  拍();                                   // 起服务立刻对一次表——这就是「重启补跑」那一下
  const t = setInterval(拍, 间隔);
  if (t.unref) t.unref();
  return () => { 停 = true; clearInterval(t); };
}

module.exports = { 一拍, 起, 该跑的, 默认班次, 日串, 分串 };
