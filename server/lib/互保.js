// 互保.js — 三方互保：看得见的那个去扶。
//
// 制作人 2026-08-29 03:29 拍板：塔／监制台／终端三方互保，一个环 + 三个外部起点（开机自启）。
// 环管热故障（跑着跑着死一个），自启管冷启动（全灭后重来）——**环里没有活的就谁也起不来**，
// 所以自启不是可选项。
//
// 本文件只做终端这一侧的两条边：终端 → 塔、终端 → 监制台。
// 另一条边（塔 → 终端）在 packages/watchtower，另一处改。
//
// 三条闸，缺一条这套东西就从帮手变成祸害：
//
// **一 · 先确认真死了再扶。** HTTP 超时不等于死——监制台卡一下就去拉第二个实例，
//   端口一撞两个都废。必须端口空了 + 进程没了，才动手。
//
// **二 · 退避 + 上限。** 起不来的东西会被无限重启。1 次立刻、2 次 30 秒、3 次 2 分钟，
//   连三次不成就停手，把 stderr 亮出来等人看。
//
// **三 · 每次扶都留痕并且要看得见。** 这条最要紧：
//   **自动重启而不报告，比手动重启加告警更坏**——一个「一直好好的」和一个
//   「死了十次又被扶了十次」在屏上长得一模一样，人会以为很稳，其实每小时崩一次。
//   所以互保的价值不在自动重启，在「有人知道它死了」。重启只是顺手。
'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn, spawnSync } = require('child_process');

const 退避表 = [0, 30000, 120000];   // 第 1/2/3 次之间等多久
const 上限 = 退避表.length;

/**
 * 跑一条 cmd 并把输出收回来。
 * **中文任务名必须走 chcp 65001**：Windows 按当前代码页（本机 936）编码 argv，
 * 「瞭望塔」「监制台」这种任务名直接过 cmd 命令行会变乱码，schtasks 找不着。
 * 与 自启.js 的 跑() 同一条坑、同一个修法（08-29 04:05 真机实测过）。
 */
function 跑(cmd) {
  const r = spawnSync('chcp 65001 >nul & ' + cmd, { shell: true, encoding: 'utf8', windowsHide: true });
  return { 码: r.status, 出: String((r.stdout || '') + (r.stderr || '')).trim() };
}

/** 端口有没有人在听。用 netstat 而不是试连——试连拿不到「端口空着」与「连上了但不应答」的区别。 */
function 端口占用(口) {
  try {
    const r = spawnSync('cmd.exe', ['/d', '/s', '/c', `netstat -ano -p tcp | findstr LISTENING | findstr :${口}`],
      { encoding: 'utf8', windowsHide: true });
    return String(r.stdout || '').trim().length > 0;
  } catch { return false; }   // 探不动就当没占——宁可多探一次，不可误判成活着
}

/** pid 还在不在。EPERM = 进程在但不归我管，也算活着。 */
function 进程在(pid) {
  const n = Number(pid);
  if (!Number.isFinite(n) || n <= 0) return false;
  try { process.kill(n, 0); return true; }
  catch (e) { return !!(e && e.code === 'EPERM'); }
}

/** 探一个 HTTP 端点，返回 { 通, 码?, 体? }。只回答「通不通」，身份另判。 */
function 探HTTP(地址, 超时 = 3000) {
  return new Promise((res) => {
    let 完 = false;
    const 收 = (v) => { if (!完) { 完 = true; res(v); } };
    let req;
    try {
      req = http.get(地址, (up) => {
        let s = '';
        up.setEncoding('utf8');
        up.on('data', (d) => { if (s.length < 8192) s += d; });
        up.on('end', () => 收({ 通: true, 码: up.statusCode, 体: s }));
      });
    } catch (e) { return 收({ 通: false, 因: String((e && e.message) || e).slice(0, 60) }); }
    req.setTimeout(超时, () => { try { req.destroy(); } catch { /* 已断 */ } 收({ 通: false, 因: '超时' }); });
    req.on('error', (e) => 收({ 通: false, 因: (e && e.code) || '连不上' }));
  });
}

/**
 * 判定一个目标是不是**真的死了**（闸一）。
 * 三级证据，全部指向死才判死——任何一级说它还活着就不动手。
 */
async function 真死了(目标) {
  const 证 = { 端口: null, 进程: null, HTTP: null };

  if (目标.端口) {
    证.端口 = 端口占用(目标.端口);
    if (证.端口) {
      // 端口有人听 → 再探一次 HTTP。通了当然活着；不通也**不判死**——
      // 可能只是卡住，这时起第二个实例会撞端口，两个都废。
      if (目标.探址) {
        const h = await 探HTTP(目标.探址, 目标.超时毫秒 || 3000);
        证.HTTP = h.通;
      }
      return { 死: false, 因: 证.HTTP ? '在岗' : '端口有人听但不应答——可能卡住，不许起第二个实例', 证 };
    }
  }

  if (目标.pid文件) {
    let pid = null;
    try {
      const s = fs.readFileSync(目标.pid文件, 'utf8');
      try { pid = JSON.parse(s).pid; } catch { pid = Number(String(s).trim()); }
    } catch { pid = null; }
    证.进程 = pid ? 进程在(pid) : false;
    if (证.进程) return { 死: false, 因: 'pid ' + pid + ' 还在', 证 };
  }

  return { 死: true, 因: '端口没人听' + (目标.pid文件 ? '、pid 也不在' : ''), 证 };
}

/** 互保状态：每个目标记 { 次数, 上次, 停手 }。进程内，重启即清。 */
const 态 = new Map();

function 取态(键) {
  if (!态.has(键)) 态.set(键, { 次数: 0, 上次: 0, 停手: false, 末错: null });
  return 态.get(键);
}

/**
 * 扶(目标, opts) → { 动手, 因, 次数? }
 * opts: { 现在, 记 }  记 = (事件) => void，调用方负责落盘（闸三）
 */
async function 扶(目标, opts = {}) {
  const 现在 = opts.现在 != null ? opts.现在 : Date.now();
  const 记 = opts.记 || (() => {});
  const st = 取态(目标.键);

  const 判 = await 真死了(目标);
  if (!判.死) {
    if (st.次数) { st.次数 = 0; st.停手 = false; st.末错 = null; 记({ 型: '复活', 目标: 目标.键, 因: 判.因, t: 现在 }); }
    return { 动手: false, 因: 判.因 };
  }

  if (st.停手) return { 动手: false, 因: `已连拉 ${上限} 次都没起来，停手等人看`, 停手: true, 末错: st.末错 };

  const 等 = 退避表[Math.min(st.次数, 上限 - 1)];
  if (st.上次 && 现在 - st.上次 < 等) {
    return { 动手: false, 因: `退避中，还差 ${Math.ceil((等 - (现在 - st.上次)) / 1000)} 秒` };
  }

  st.次数 += 1;
  st.上次 = 现在;
  记({ 型: '拉起', 目标: 目标.键, 第几次: st.次数, 因: 判.因, t: 现在 });

  // **命令不存在时 spawn 不会同步抛错**——它异步发 error 事件，try/catch 捕不到。
  // 判据抓到过一次：拉不起来却当成拉起了，静默失败。所以先自己查一遍文件在不在，
  // 再挂 error 监听兜住异步那一路。
  let 错 = null;
  if (目标.任务名) {
    // **优先走计划任务这条「已经拉好的绳」**，不自己拼路径去 spawn。
    //
    // 08-29 04:5x 的教训：本函数原先靠调用方传 命令＝__dirname/../Ticketflow/...watchtower.js。
    // 源码态对；装成 portable exe 后 __dirname 落在 asar 里，那条路径不存在，
    // 于是 互保目标() 的 existsSync 判否，**塔这个目标被静默丢掉**——
    // 环上少了一整条边，而 /api/mutual 与屏上都毫无异样。实测：杀塔五分钟无人来扶。
    //
    // 任务名不依赖任何相对路径，也不会因换装而失效，且启动细节（哪个 exe、
    // 工作目录、portable 注入的 env）只在计划任务里存一份正本。
    // 塔那侧的「塔 → 终端」用的也是这条绳，两边形制一致。
    const r = 跑(`schtasks /Run /TN "${目标.任务名}"`);
    if (r.码 !== 0) 错 = `schtasks /Run 退出码 ${r.码}：${String(r.出).slice(0, 160)}`;
  } else if (!fs.existsSync(目标.命令)) {
    错 = '要拉的程序不存在：' + 目标.命令;
  } else {
    try {
      const c = spawn(目标.命令, 目标.参数 || [], {
        cwd: 目标.工作目录 || path.dirname(目标.命令),
        detached: true,        // 断开父子关系：终端后来被杀，被扶起来的照样活着
        stdio: 'ignore',
        windowsHide: true,
      });
      // 异步失败也要留痕。此时本轮已经返回，所以直接记一条，不改返回值。
      c.on('error', (e) => {
        const 因 = String((e && e.message) || e).slice(0, 200);
        st.末错 = 因;
        记({ 型: '拉起失败', 目标: 目标.键, 第几次: st.次数, 错: 因, t: Date.now() });
      });
      c.unref();
    } catch (e) { 错 = String((e && e.message) || e).slice(0, 200); }
  }

  if (错) {
    st.末错 = 错;
    记({ 型: '拉起失败', 目标: 目标.键, 第几次: st.次数, 错: 错, t: 现在 });
  }
  if (st.次数 >= 上限) {
    st.停手 = true;
    记({ 型: '停手', 目标: 目标.键, 因: `连拉 ${上限} 次`, 末错: st.末错, t: 现在 });
  }
  return { 动手: !错, 因: 错 || `已拉起（第 ${st.次数} 次）`, 次数: st.次数, 错: 错 };
}

/** 今日被扶次数（供上屏，闸三）。读互保留痕文件。 */
function 今日战果(留痕文件, 现在 = Date.now()) {
  const 日 = new Date(现在);
  const 今 = `${日.getFullYear()}-${String(日.getMonth() + 1).padStart(2, '0')}-${String(日.getDate()).padStart(2, '0')}`;
  let 行 = [];
  try { 行 = fs.readFileSync(留痕文件, 'utf8').trim().split(/\r?\n/).filter(Boolean); }
  catch { return { 读到: false, 因: '还没有互保留痕' }; }
  const 出 = {};
  let 坏 = 0;
  for (const l of 行) {
    let o; try { o = JSON.parse(l); } catch { 坏 += 1; continue; }
    const d = new Date(Number(o.t) || 0);
    const 那日 = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (那日 !== 今) continue;
    const k = o.目标 || '?';
    出[k] = 出[k] || { 目标: k, 拉起: 0, 失败: 0, 停手: false, 末次: null };
    if (o.型 === '拉起') { 出[k].拉起 += 1; 出[k].末次 = o.t; }
    if (o.型 === '拉起失败') 出[k].失败 += 1;
    if (o.型 === '停手') 出[k].停手 = true;
  }
  return { 读到: true, 日: 今, 各目标: Object.values(出), 坏行: 坏 };
}

module.exports = { 扶, 真死了, 端口占用, 进程在, 探HTTP, 今日战果, 跑, 退避表, 上限, 态 };
