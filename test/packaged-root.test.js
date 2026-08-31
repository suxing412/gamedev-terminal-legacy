// packaged-root.test.js — 打包形态下的数据根与配置回落（2026-08-28 换装实测案）
//
// 两条都是**只在 exe 里犯、源码态永远复现不了**的病，所以判据不能靠「起服务看看」，
// 得直接验解析规则本身：把 server.js 里那段 终端根 的取法抄成同构的纯函数来验，
// 并对 读数.配置件 做真实文件系统的回落断言。
//
// 案发经过（值得留）：
//   · 首版 终端根 取 `process.cwd()`，以为它等于启动器传的 WorkingDirectory。**不等于。**
//     portable exe 先把自己解到 `%TEMP%\<随机>\` 再从那里起进程，cwd 就是解压目录——
//     只读、易失、每次换名。换装后情报数据全写进 `%TEMP%\3IWyiPuE…\data`，
//     仓里 202 条真数据一条没读到。而那一版的注释**已经写明**「解压目录只读且易失」：
//     识别了危险，却选了个照样落进去的取法。
//   · 配置回落只加在 intel/run.js，没加到 server/lib/读数.js，于是管道用包内配置真抓了 100 条，
//     而 /health 报「源数 0」——同一个问题的两个读口给出互相打架的答案。
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const 读 = require('../server/lib/读数');

let passed = 0;
const t = (n, f) => { f(); passed++; console.log('  ✓ ' + n); };
console.log('packaged-root 打包形态数据根与配置回落');

// 与 server.js 的 终端根 同构：**改那边就要改这里**，两处分叉时下面的「同构守卫」会红。
const 解根 = (env, 打包了, execPath, dirname, 存在) => {
  if (env.TERMINAL_ROOT && 存在(env.TERMINAL_ROOT)) return env.TERMINAL_ROOT;
  if (env.PORTABLE_EXECUTABLE_DIR && 存在(env.PORTABLE_EXECUTABLE_DIR)) return env.PORTABLE_EXECUTABLE_DIR;
  if (打包了) return path.dirname(execPath);
  return dirname;
};
const 全在 = () => true;

t('portable exe：取 exe 所在目录，**不取 cwd**（cwd 是易失的解压目录）', () => {
  const r = 解根({ PORTABLE_EXECUTABLE_DIR: 'D:/GitHub/gamedev-terminal' },
    true, 'C:/Users/x/AppData/Local/Temp/3IWyiPuE/游戏开发者终端.exe',
    'C:/Users/x/AppData/Local/Temp/3IWyiPuE/resources/app.asar', 全在);
  assert.equal(r, 'D:/GitHub/gamedev-terminal',
    '落回解压目录就是本案的原病——数据写进去下次就没了');
  assert.ok(!/Temp/i.test(r), '数据根一个字都不许落在 %TEMP% 下');
});

t('显式 TERMINAL_ROOT 压过一切', () => {
  const r = 解根({ TERMINAL_ROOT: 'D:/别处', PORTABLE_EXECUTABLE_DIR: 'D:/GitHub/gamedev-terminal' },
    true, 'C:/tmp/a.exe', 'C:/tmp/resources/app.asar', 全在);
  assert.equal(r, 'D:/别处');
});

t('非 portable 的打包形态：退到 execPath 的目录，仍然不是 asar 里', () => {
  const r = 解根({}, true, 'D:/装机位/游戏开发者终端.exe', 'D:/装机位/resources/app.asar', 全在);
  assert.equal(r, 'D:/装机位');
});

t('源码态：就是仓根（行为一字不变）', () => {
  const r = 解根({}, false, process.execPath, 'D:/GitHub/gamedev-terminal', 全在);
  assert.equal(r, 'D:/GitHub/gamedev-terminal');
});

t('同构守卫：server.js 里的取法必须与本文件这份保持同一形状', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const seg = src.slice(src.indexOf('const 终端根'), src.indexOf('const 会话档'));
  assert.ok(seg.includes('PORTABLE_EXECUTABLE_DIR'), 'server.js 必须优先认 PORTABLE_EXECUTABLE_DIR');
  assert.ok(seg.includes('path.dirname(process.execPath)'), '打包形态必须落到 execPath 的目录');
  assert.ok(!/return\s+打包了\s*\?\s*process\.cwd\(\)/.test(seg), '不许退回「打包就取 cwd」的原病写法');
});

t('配置回落：数据根有就用数据根的', () => {
  const 根 = fs.mkdtempSync(path.join(os.tmpdir(), 'pkgroot-'));
  fs.mkdirSync(path.join(根, 'config'));
  fs.writeFileSync(path.join(根, 'config', 'sources.json'),
    JSON.stringify([{ id: '就近源', 名称: '就近', 类型: 'rss', 档位: 'A' }]), 'utf8');
  const s = 读.源表(根);
  assert.equal(s.length, 1);
  assert.equal(s[0].id, '就近源', '数据根自带配置时必须用它——否则人改了配置不生效');
  fs.rmSync(根, { recursive: true, force: true });
});

t('配置回落：数据根没有就用随包那份，**不许回空**', () => {
  const 空根 = fs.mkdtempSync(path.join(os.tmpdir(), 'pkgroot-空-'));
  const s = 读.源表(空根);
  assert.ok(s.length > 0,
    '回落失效就是本案第二病：管道用包内配置真抓了数据，而 /health 报「源数 0」，两个读口打架');
  assert.ok(读.评分权重(空根), '权重同样要回落——缺它日报算不出分');
  fs.rmSync(空根, { recursive: true, force: true });
});

t('两个读口同一条规则：run.js 与 读数.js 都得有回落', () => {
  const a = fs.readFileSync(path.join(__dirname, '..', 'intel', 'run.js'), 'utf8');
  const b = fs.readFileSync(path.join(__dirname, '..', 'server', 'lib', '读数.js'), 'utf8');
  for (const [名, s] of [['intel/run.js', a], ['server/lib/读数.js', b]]) {
    assert.ok(/function 配置件/.test(s), `${名} 缺 配置件() 回落——一份配置两个读法，早晚各读各的`);
  }
  // 只准 配置件() 自己碰 `根/config`；别处再出现就是绕过解析器的直读——本案分叉的来路。
  // 故把解析器函数体挖掉再查，而不是全文一刀切（解析器内部那行是正当的）。
  const 挖掉解析器 = (s) => {
    const i = s.indexOf('function 配置件');
    if (i < 0) return s;
    const j = s.indexOf('\n}', i);
    return s.slice(0, i) + s.slice(j);
  };
  assert.ok(!/path\.join\(根, 'config'/.test(挖掉解析器(b)),
    '读数.js 里不许再有绕过 配置件() 的直读——那正是本案分叉的来路');
  assert.ok(!/path\.join\(base, 'config'/.test(挖掉解析器(a)),
    'run.js 同理');
});


console.log('packaged-root 全部通过：' + passed + ' 项');
