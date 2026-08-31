// 自启.test.js — 登录自启的判据。
//
// 评审 8-3 / 8-7 定的取向：**「任务在册」不是判据，只是前置条件。**
// 真判据是「触发一次，探 /health 读到的版本等于本次部署的版本」——
// 那一条要真机跑，不在单测里；这里守住能在单测里守的那几格：
//   · XML 的命令/工作目录逐字等于传入值（防「注册了但指向旧路径」）
//   · 含空格与中文的路径不被打断（本机用户名就是中文，不是边角情形）
//   · 查() 的返回里不许出现「健康」这类词——命名上就不让人拿它当判据
'use strict';
const assert = require('node:assert');
const test = require('node:test');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

const 自启 = require('../server/lib/自启');

test('XML 里的命令与工作目录逐字等于传入值（防指向旧路径）', () => {
  const exe = 'D:\\GitHub\\AI-GameStudio\\终端\\游戏开发者终端 0.4.0.exe';
  const 目录 = 'D:\\GitHub\\AI-GameStudio\\终端';
  const xml = 自启.造XML({ 命令: exe, 参数: '', 工作目录: 目录, 用户: 'PC\\suxin' });
  assert.ok(xml.includes('<Command>' + exe + '</Command>'), '命令必须逐字落进 XML');
  assert.ok(xml.includes('<WorkingDirectory>' + 目录 + '</WorkingDirectory>'));
});

test('含空格与中文的路径照样落对（本机用户名就是中文，不是边角情形）', () => {
  const exe = 'C:\\Users\\苏 省\\我的 程序\\游戏开发者终端.exe';
  const xml = 自启.造XML({ 命令: exe, 参数: '', 工作目录: path.dirname(exe), 用户: 'PC\\苏 省' });
  assert.ok(xml.includes(exe), '空格与中文都不许把命令打断');
  assert.ok(xml.includes('<UserId>PC\\苏 省</UserId>'));
});

test('XML 特殊字符被转义（& < > " 进了路径也不许把 XML 弄坏）', () => {
  const exe = 'D:\\a&b\\c<d>\\e"f\\终端.exe';
  const xml = 自启.造XML({ 命令: exe, 参数: '', 工作目录: 'D:\\a&b', 用户: 'PC\\u' });
  assert.ok(xml.includes('a&amp;b'), '& 要转义，否则 schtasks 报无效 XML');
  assert.ok(xml.includes('c&lt;d&gt;'));
  assert.ok(!xml.includes('c<d>'), '未转义的尖括号会把 XML 结构撕开');
});

test('触发器是登录，且不设执行时限（值班屏要一直开着）', () => {
  const xml = 自启.造XML({ 命令: 'x.exe', 参数: '', 工作目录: 'D:\\', 用户: 'PC\\u' });
  assert.match(xml, /<LogonTrigger>/, '要的是登录即起，不是定时');
  assert.match(xml, /<ExecutionTimeLimit>PT0S<\/ExecutionTimeLimit>/, '有时限的话跑够时长会被系统掐掉');
  assert.match(xml, /<DisallowStartIfOnBatteries>false</, '拔了电源也得在岗');
});

test('装() 找不到程序时明说，不假装注册成功', () => {
  const r = 自启.装({ exe: 'D:\\绝对不存在的目录\\不存在.exe', dry: true });
  assert.equal(r.ok, false);
  assert.match(r.error, /找不到/);
});

test('查() 只回答「在册」，不回答「好使」——命名上就不让人拿它当判据', () => {
  const r = 自启.查('这个任务名绝对不存在-' + Date.now());
  assert.equal(r.在册, false);
  assert.ok(!('健康' in r), '在册 ≠ 会起来。真判据是触发一次读版本，不是查存在');
  assert.ok(!('ok' in r), '别给一个看起来像总判的字段');
});

test('dry 跑不动手：返回计划而不注册', () => {
  const r = 自启.装({ exe: process.execPath, dry: true });
  assert.equal(r.ok, true);
  assert.equal(r.dry, true);
  assert.equal(r.命令.toLowerCase(), process.execPath.replace(/\//g, '\\').toLowerCase());
});

// ── portable 形态：本格从前是判据真空 ─────────────────────────────
//
// 上面 7 条一条都没碰 portable。而 portable 恰恰是本项目唯一的打包目标
// （package.json build.win.target = "portable"），也就是说：真机上会跑的那条路，
// 从来没有判据守着。08-29 调研翻出的账：
//   portable.nsi:33 解到 %TEMP%\ns<随机>.tmp\app\ → :85 从那里起进程 → :88 退出即 RMDir 删掉
// 拿 process.execPath 注册，注册的是一条关窗即消失的路径，而 existsSync 在注册当刻必然通过，
// 于是 ok:true、不报错、不告警——静默错。下面四条就是补这一格。
const 存env = (k) => {
  const 旧 = Object.prototype.hasOwnProperty.call(process.env, k) ? process.env[k] : undefined;
  return () => { if (旧 === undefined) delete process.env[k]; else process.env[k] = 旧; };
};

test('portable① 认 PORTABLE_EXECUTABLE_FILE/_DIR，而不是关窗即消失的 execPath', () => {
  const 还1 = 存env('PORTABLE_EXECUTABLE_FILE');
  const 还2 = 存env('PORTABLE_EXECUTABLE_DIR');
  try {
    // 用一个真实存在的文件当「被双击的那个 exe」，好让 existsSync 这一关放行——
    // 本条要验的是取路径的次序，不是文件存不存在。
    const 部署区 = fs.mkdtempSync(path.join(os.homedir(), '终端部署-'));
    const 假exe = path.join(部署区, '游戏开发者终端 9.9.9.exe');
    fs.writeFileSync(假exe, 'x');
    process.env.PORTABLE_EXECUTABLE_FILE = 假exe;
    process.env.PORTABLE_EXECUTABLE_DIR = 部署区;

    const r = 自启.装({ dry: true });   // 照 main.js 缺省那条路：不显式传 exe
    assert.equal(r.ok, true);
    assert.equal(r.命令.toLowerCase(), 假exe.replace(/\//g, '\\').toLowerCase(),
      '必须注册用户双击的那个 exe，不是临时解压出来的那个');
    assert.equal(r.工作目录.toLowerCase(), 部署区.replace(/\//g, '\\').toLowerCase());
    assert.ok(!/execPath/i.test(r.命令));
    fs.rmSync(部署区, { recursive: true, force: true });
  } finally { 还1(); 还2(); }
});

test('portable② 落在 %TEMP% 下就拒绝注册——existsSync 放行的那一刻正是病发的时候', () => {
  const 还1 = 存env('PORTABLE_EXECUTABLE_FILE');
  const 还2 = 存env('PORTABLE_EXECUTABLE_DIR');
  try {
    // 造一个**真实存在**的临时 exe，模拟 portable 解压现场。
    // 关键：它存在，所以 existsSync 这一关会放行；拦住它的必须是另一条独立的硬拦。
    // 若哪天有人把硬拦删了，本条会红——这就是它作为判据的价值。
    const 解压区 = fs.mkdtempSync(path.join(os.tmpdir(), 'ns'));
    const 临exe = path.join(解压区, '游戏开发者终端.exe');
    fs.writeFileSync(临exe, 'x');
    assert.ok(fs.existsSync(临exe), '前提：这个文件此刻真的在，existsSync 拦不住它');

    const r = 自启.装({ exe: 临exe, dry: true });
    assert.equal(r.ok, false, 'portable 退出即删，注册它等于注册一条死路径');
    assert.match(r.error, /临时/);
    fs.rmSync(解压区, { recursive: true, force: true });
  } finally { 还1(); 还2(); }
});

test('portable③ 取路径三优先级：opts.exe > PORTABLE_EXECUTABLE_FILE > execPath', () => {
  const 还1 = 存env('PORTABLE_EXECUTABLE_FILE');
  const 还2 = 存env('PORTABLE_EXECUTABLE_DIR');
  try {
    const 区 = fs.mkdtempSync(path.join(os.homedir(), '终端次序-'));
    const 甲 = path.join(区, '甲.exe'); fs.writeFileSync(甲, 'x');
    const 乙 = path.join(区, '乙.exe'); fs.writeFileSync(乙, 'x');

    process.env.PORTABLE_EXECUTABLE_FILE = 乙;
    process.env.PORTABLE_EXECUTABLE_DIR = 区;

    // 一档：显式传的赢
    assert.equal(自启.装({ exe: 甲, dry: true }).命令.toLowerCase(), 甲.toLowerCase());
    // 二档：不传就认 env
    assert.equal(自启.装({ dry: true }).命令.toLowerCase(), 乙.toLowerCase());
    // 三档：env 也没有才回落 execPath（源码态就是 node.exe）
    delete process.env.PORTABLE_EXECUTABLE_FILE;
    delete process.env.PORTABLE_EXECUTABLE_DIR;
    assert.equal(自启.装({ dry: true }).命令.toLowerCase(),
      process.execPath.replace(/\//g, '\\').toLowerCase());

    fs.rmSync(区, { recursive: true, force: true });
  } finally { 还1(); 还2(); }
});

// 同构守卫。**它不是判据**（H104：grep 源码文本不算判据），上面三条才是；
// 这条只防「改回原样」这一种特定退化——照 packaged-root.test.js 的成例。
test('portable④ 同构守卫：源码不许退回 opts.exe || process.execPath 的原病写法', () => {
  const 源 = fs.readFileSync(path.join(__dirname, '..', 'server', 'lib', '自启.js'), 'utf8');
  assert.ok(源.includes('PORTABLE_EXECUTABLE_FILE'), '取路径必须认 portable 启动器给的那个变量');
  assert.ok(!/opts\.exe\s*\|\|\s*process\.execPath/.test(源),
    '这是原病写法：中间少了 PORTABLE_EXECUTABLE_FILE 这一档');
  assert.ok(/os\.tmpdir\(\)/.test(源), '%TEMP% 硬拦不许删');
});

test('portable⑤ 真注册一次：中文任务名与中文部署路径必须原样落进任务计划（用完即删）', () => {
  // 08-29 04:05 真机：0.7.0 换装后 --install 死在 schtasks 上，回执里的错误原文是
  // 「����: �ļ�����Ŀ¼��������﷨����ȷ��」＝「文件名、目录名或卷标语法不正确」。
  // 病因是中文过 cmd 命令行被按 GBK 编码，schtasks 收到的 XML 路径本身就是坏的。
  //
  // **这一条必须真跑一次 schtasks**，不能用 dry。dry 只造 XML 不碰命令行，
  // 而病恰恰只在命令行那一段发作——dry 全绿、真机全红，正是 04:05 当时的情形。
  const 名 = '终端判据-用完即删-' + process.pid;
  let 区 = null;
  try {
    // 造一个中文目录 + 中文文件名的假部署区，把两处中文都摆到命令行上
    区 = fs.mkdtempSync(path.join(os.homedir(), '判据部署区-'));
    const 假exe = path.join(区, '游戏开发者终端 9.9.9.exe');
    fs.writeFileSync(假exe, 'x');

    const r = 自启.装({ exe: 假exe, 工作目录: 区, 任务名: 名 });
    assert.equal(r.ok, true, '注册失败：' + (r.error || '') + '（报错若是乱码，就是 GBK 化的指纹）');

    const q = 自启.查(名);
    assert.equal(q.在册, true, '查不到＝任务名被编码坏了，注册进了另一个乱码名字底下');
    assert.ok(q.命令 && q.命令.includes('游戏开发者终端 9.9.9.exe'),
      '命令必须逐字回来，实得：' + q.命令);
    assert.ok(!/�/.test(String(q.命令)), '出现替换字符 U+FFFD 就是 GBK 化的铁证');
  } finally {
    try { 自启.卸({ 任务名: 名 }); } catch { /* 没注册上就没得删 */ }
    if (区) { try { fs.rmSync(区, { recursive: true, force: true }); } catch { /* 留着无害 */ } }
  }
});

// 注：这里一度有一条「跑() 回显中文」的判据，已删。
// 它测的是 **cmd 的输出编码**（echo 写 stdout 用控制台输出代码页），
// 而病发在 **cmd 把 argv 转交给子进程 schtasks** 时——两条不同的路。
// 那条判据即使红了也不说明注册会失败，绿了更不说明注册会成功：**它量的不是这件事**。
// 一条量错东西的判据比没有判据更坏，因为它会被当成覆盖。⑤ 才是真判据。
