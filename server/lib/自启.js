// 自启.js — 终端的登录自启（制作人令：「终端默认进程永远跟着主机进程走，只要不关机永远存在」）。
//
// 形制照抄 packages/watchtower 的 --install：schtasks /Create /XML + VBS 无窗壳。
// **不发明第二套**——两个自启各写各的，就是两处各自会坏、坏法还不一样。
//
// 评审 8-3 / 8-7 定的两条纪律，本文件是它们的落点：
//   ① 遇同名任务**先删后建**，不做增量修补——部署目录换了而任务还指旧路径，
//      是「任务存在」这个判据通过、启动的却是旧 exe 的成因（与当日假换装同族）。
//   ② 验收走**行为判据**：注册 → 触发 → 探 /health 读到的版本必须等于本次部署的版本。
//      「任务存在」降级为前置条件，不再是判据本身。
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const 任务名缺省 = '游戏开发者终端';
const win = (p) => String(p).replace(/\//g, '\\');
const xml转义 = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function 跑(cmd) {
  // **中文不能就这么走 cmd 的命令行。** Windows 按当前控制台代码页（本机 936/GBK）编码 argv，
  // 中文任务名与中文 XML 路径到 schtasks 手里就成了乱码，报「文件名、目录名或卷标语法不正确」。
  //
  // 08-29 04:05 真机实测：0.7.0 换装后跑 --install 当场死在这里，回执里连错误原文都是乱码
  // （����: �ļ�����Ŀ¼��������﷨����ȷ��）。**乱码的报错本身就是病因的指纹**——
  // 看到报错是乱码，就该先怀疑编码而不是去查路径对不对。
  //
  // 修法照抄 watchtower.js:570 的成例：先 chcp 65001 把这一条命令切到 UTF-8 代码页。
  // 塔的中文任务名「瞭望塔」能注册成功，靠的就是这一句。
  const r = spawnSync('chcp 65001 >nul & ' + cmd, { shell: true, encoding: 'utf8', windowsHide: true });
  return { 码: r.status, 出: String((r.stdout || '') + (r.stderr || '')).trim() };
}

/** 任务 XML。触发器＝登录；不设执行时限（值班屏要一直开着）；电池上也跑。 */
function 造XML({ 命令, 参数, 工作目录, 用户 }) {
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>游戏开发者终端 · 登录自启（值班屏常驻）</Description>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger><Enabled>true</Enabled><UserId>${xml转义(用户)}</UserId></LogonTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>${xml转义(用户)}</UserId>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RestartOnFailure><Interval>PT1M</Interval><Count>3</Count></RestartOnFailure>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>${xml转义(命令)}</Command>
      <Arguments>${xml转义(参数 || '')}</Arguments>
      <WorkingDirectory>${xml转义(工作目录)}</WorkingDirectory>
    </Exec>
  </Actions>
</Task>`;
}

/**
 * 装(opts) → { ok, 任务名, 命令, 工作目录, ... }
 * opts: { exe, 工作目录, 任务名, dry }
 * exe 取路径的次序：opts.exe（显式）> PORTABLE_EXECUTABLE_FILE（portable 启动器注入）> process.execPath。
 *
 * **不能直接用 process.execPath——这是 08-28 数据根翻车案的同一个陷阱。**
 * portable 目标的 NSIS 壳（node_modules/app-builder-lib/templates/nsis/portable.nsi）：
 *   :33  StrCpy $INSTDIR "$PLUGINSDIR\app"      ← 解到 %TEMP%\ns<随机>.tmp\app\
 *   :85  ExecWait "$INSTDIR\<productName>.exe"  ← 子进程的 execPath 就是这个临时路径
 *   :88  RMDir /r $INSTDIR                      ← **应用一退出，这个目录连同 exe 被删掉**
 * 所以拿 execPath 去注册，注册的是一条「关掉窗口那一刻就消失」的路径，下次登录必然起不来。
 * 而 :77-78 启动器已经把正确答案递到手里：PORTABLE_EXECUTABLE_FILE（＝用户双击的那个 exe 全路径）
 * 与 PORTABLE_EXECUTABLE_DIR（＝它所在目录）。次序与 server.js 的 终端根 同构：显式 > portable env > 回落。
 *
 * 塔为什么没踩：塔是 node 脚本，它的 execPath 是装机位的 node.exe（固定），
 * 易变的脚本路径与数据根由 --root 显式传。**塔的 execPath 从来不是产物本身**，前提不同。
 * 本文件头注写着「形制照抄 watchtower 的 --install」——照抄了形制，没照抄前提。
 */
function 装(opts = {}) {
  const 任务名 = opts.任务名 || 任务名缺省;
  const exe = win(opts.exe || process.env.PORTABLE_EXECUTABLE_FILE || process.execPath);
  const 目录 = win(opts.工作目录 || process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(exe));
  if (!fs.existsSync(exe)) return { ok: false, error: '找不到要自启的程序：' + exe };

  // **existsSync 拦不住本病，它给的是假保证**：注册那一刻临时 exe 确实存在，
  // 应用退出后才被 RMDir 删掉。于是注册返回 ok:true、不报错、不告警——
  // 与 08-28 那次「/health 报源数 0 却照常在跑」同一种失败姿态：静默错。
  // 所以要一条独立于 existsSync 的硬拦：落在临时目录下就拒绝注册。
  // 这是 packaged-root.test.js「数据根一个字都不许落在 %TEMP% 下」在自启这一格的落点。
  const 临 = path.resolve(os.tmpdir()).toLowerCase();
  for (const [名, 值] of [['程序', exe], ['工作目录', 目录]]) {
    const v = path.resolve(值).toLowerCase();
    if (v === 临 || v.startsWith(临 + path.sep)) {
      return { ok: false, error: '拒绝把自启注册到临时解压目录（portable exe 退出即删）：' + 名 + '=' + 值 };
    }
  }

  const 用户 = (process.env.USERDOMAIN ? process.env.USERDOMAIN + '\\' : '') + (process.env.USERNAME || os.userInfo().username);
  const xml = 造XML({ 命令: exe, 参数: '', 工作目录: 目录, 用户: 用户 });

  // UTF-16LE + BOM：schtasks /XML 只认这个编码，写成 UTF-8 会报 "无效的 XML"
  // 文件名用 ASCII：中文任务名躲不掉（它是给人看的），但这个临时文件名没有任何理由带中文。
  // 少一处中文过命令行，就少一处 GBK 化的机会——纵深防御，不指望 chcp 一条包打天下。
  // **但要说清楚：这一层没有判据在背。** 08-29 实测把它改回中文，判据⑤照样绿——
  // 有 chcp 在，文件名带不带中文都注册得成。所以它是偏好不是不变量，别当成被保护的东西。
  const 存 = path.join(os.tmpdir(), 'gamedev-terminal-autostart-' + process.pid + '.xml');
  fs.writeFileSync(存, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(xml, 'utf16le')]));

  if (opts.dry) return { ok: true, dry: true, 任务名, 命令: exe, 工作目录: 目录, 用户, XML留档: 存 };

  // 先删后建（评审 8-3）：改路径后做增量修补，正是「任务在、指的却是旧 exe」的成因
  跑(`schtasks /Delete /TN "${任务名}" /F`);
  const r = 跑(`schtasks /Create /TN "${任务名}" /XML "${win(存)}" /F`);
  try { fs.unlinkSync(存); } catch { /* 留着也无害 */ }
  if (r.码 !== 0) return { ok: false, error: `schtasks 注册失败（退出码 ${r.码}）：${r.出}` };
  return { ok: true, 任务名, 命令: exe, 工作目录: 目录, 用户, schtasks: r.出 };
}

function 卸(opts = {}) {
  const 任务名 = opts.任务名 || 任务名缺省;
  const r = 跑(`schtasks /Delete /TN "${任务名}" /F`);
  return r.码 === 0 ? { ok: true, 任务名 } : { ok: false, error: r.出 };
}

/**
 * 查(任务名) → { 在册, 命令?, 上次结果? }
 * **注意：在册 ≠ 会起来。** 这个函数只回答前置条件，不回答「自启好使吗」——
 * 后者只有「触发一次，探 /health 读版本」能回答（评审 8-7）。
 * 命名上不叫「健康」就是为了不让人拿它当判据。
 */
function 查(任务名) {
  const n = 任务名 || 任务名缺省;
  const r = 跑(`schtasks /Query /TN "${n}" /FO LIST /V`);
  if (r.码 !== 0) return { 在册: false };
  const 取 = (键) => { const m = r.出.split(/\r?\n/).find((l) => l.indexOf(键) === 0); return m ? m.split(':').slice(1).join(':').trim() : null; };
  return {
    在册: true,
    命令: 取('要运行的任务') || 取('Task To Run'),
    上次结果: 取('上次运行结果') || 取('Last Result'),
    状态: 取('状态') || 取('Status'),
  };
}

// 跑 也导出：它是「中文过命令行」这条坑的唯一落点，判据要能直接打到它身上。
module.exports = { 装, 卸, 查, 造XML, 跑, 任务名缺省 };
