// server.js — 游戏开发者终端 · 坐席后端
//
// 三件事，只做这三件：
//   ① 取数：HTTP 调监制台（:4270）的现成 API，自己不碰它的文件。读不到就如实回报，绝不造零。
//   ② 说话：Claude Agent SDK（query()）——08-25 需求定案指定的正统路。走订阅额度与既有 OAuth
//      SSE 流回前端。session_id 落盘续接，让对话跨请求连续。
//   ③ 写口：放行/审单/裁决转发到监制台的 /api/act/*，由它去落账留痕——写权在监制台，
//      终端只是遥控器。这条边界是故意的：两处都能写就会有两本账。
//
// 坑（全部踩过，见 ~/.claude 记忆与监制台 runner）：
//   · 必须注入代理 env（Clash 127.0.0.1:7890），裸环境连不上 api.anthropic.com。
//     SDK 把 options.env 透给它拉起的子进程，所以这条照旧要给。
//   · 中文走 argv 会被 Windows GBK 化成乱码——**改用 SDK 后这条自动绕开了**：
//     话直接进 options.prompt，不经命令行也不经 shell。旧的 stdin 变通不再需要。
//
// 为什么是 SDK 不是 spawn CLI（2026-08-27 换底）：08-25《需求定案》第 5 条明定
// 「AI 总监席用 Claude Agent SDK 嵌入（Model+Harness=Agent，SDK 是「我坐进终端」的正统路）」。
// 换底前实证过三件事，缺一不换：① apiKeySource==='none' ⇒ 走 claude.ai OAuth 订阅额度、
// 不是 API key，计费模型不变 ② includePartialMessages 给得出逐字 text_delta
// ③ 给得出 session_id，续接照旧。
const express = require('express');
// SDK 是 ES Module，**必须动态 import 不能 require**：
// 本机 Node 24 的 require() 认 ESM，所以 `node server.js` 一直好好的；
// 而 Electron 30 内置的是 Node 20，一 require 就 ERR_REQUIRE_ESM，整个服务起不来。
// 这是只在 exe 里犯、在开发态复现不了的那一类——2026-08-27 打包前撞上，记在这里。
// 惰性加载：首次说话时才解析，起服务不为它等。
let _query = null;
async function 取query() {
  if (!_query) ({ query: _query } = await import('@anthropic-ai/claude-agent-sdk'));
  return _query;
}

const fs = require('fs');
const path = require('path');
const http = require('http');

// 指到**本机那份已登录的 claude.exe**，不用 SDK 自带的 vendored 版。
//
// 案源 2026-08-27 14:41（制作人第一次用 exe 就撞上）：打包后坐席开口即
// 「x64\claude.exe exists but failed to launch … Specify a matching binary with
// options.pathToClaudeCodeExecutable」。根因是 **asar 包里的二进制没法执行**——
// electron-builder 把 node_modules 整个塞进 app.asar，vendored CLI 跟着进去，
// 于是它在开发态好好的、一打包就死。这是 exe 独有的第二例（第一例是 ERR_REQUIRE_ESM）。
//
// 修法选「指向本机 CLI」而不是「asarUnpack 解包 vendored」，两个理由：
//   ① 本机这份已经走过 OAuth，vendored 那份是另一个可执行体、认证状态未必共享
//   ② 少打 100MB+ 进包
// 探不到就回 null——SDK 会退回它自己的默认路径，让它自己报错，比我瞎猜一个路径强。
const CLI路径 = (() => {
  for (const p of [process.env.CLAUDE_CLI,
    'C:\\Users\\suxin\\.local\\bin\\claude.exe',
    'C:\\ProgramData\\ClaudeCode\\claude.exe']) {
    // 只吞 existsSync 自己的 IO 异常。**别用裸 catch**——
    // 这一段第一版就栽在这上面：IIFE 当时写在 `const fs = require('fs')` 之前，
    // fs 在暂时性死区，existsSync 抛的是 ReferenceError，被裸 catch 连同注释「探不动就试下一个」
    // 一起吞掉，于是路径永远探不到、而错误现场一个字都没留。
    // 一个带着安心注释的 catch，比没有 catch 更能掩盖真缺陷。
    try {
      if (p && fs.existsSync(p)) return p;
    } catch (e) {
      if (e instanceof ReferenceError || e instanceof TypeError) throw e;  // 代码错误照抛，不许静默
      console.warn('探 CLI 路径失败：', p, e && e.message);
    }
  }
  console.warn('未探到本机 claude CLI，将回落 SDK 自带版（打包后大概率拉不起来）');
  return null;
})();

const 监制台 = process.env.STUDIO_ORIGIN || 'http://127.0.0.1:4270';
const 端口 = Number(process.env.PORT || 4280);
// 真正监听到的那个端口（4280 被占会顺延）。写闸按它算「自家 origin」。
let 实际端口 = 端口;
const 台根 = process.env.STUDIO_ROOT || 'D:/GitHub/AI-GameStudio/监制台';

// 终端数据根 ≠ 代码根（2026-08-28）。**名字带「终端」前缀**：本文件 246 行另有一个 数据根，
// 指的是监制台那侧的数据根（台根 的上一级），两者毫无关系。首版重名，真起服务时当场 SyntaxError——
// 判据没抓到，因为判据不加载 server.js；**起一次真服务才现形**。
//
// 源码跑的时候两者恰好同一个目录，于是全仓一路 `__dirname` 用下来都对。
// **打成 portable exe 就全错**：Electron 把代码解到 `%TEMP%\3IU…\resources\app.asar`，
// 那里既是只读（asar）又是易失（下次启动换一个目录）——情报数据写不进去，
// 就算写进去了下次也找不着。这个错在源码环境里**永远复现不出来**，
// 只有装成 exe 才现形（ai-vault 坑档案里同族的三个坑都是这个形状）。
//
// 取法与监制台的 resolveRoot 同一路：显式环境变量优先，其次进程工作目录，
// 源码环境下这两者天然落回仓根，行为一字不变。
const 终端根 = (() => {
  // ① 显式指定优先
  const e = process.env.TERMINAL_ROOT;
  if (e && fs.existsSync(e)) return e;
  // ② portable exe：**取 exe 自己所在的目录**，不是 cwd。
  //    electron-builder 的 portable 目标会设 PORTABLE_EXECUTABLE_DIR（值＝被双击的那个 exe 所在目录）。
  //    2026-08-28 实测教训：首版取 process.cwd()，以为它等于启动器传的 WorkingDirectory——**不等于**。
  //    portable exe 先把自己解到 `%TEMP%\<随机>\` 再从那里起进程，cwd 就是那个解压目录：
  //    只读、易失、每次换名。当天换装后情报数据全写进了 `%TEMP%\3IWyiPuE…\data`，
  //    仓里 202 条真数据一条没读到，/health 报「源数 0 · 当日总条数 100」（100 是它在临时目录里现抓的）。
  //    讽刺处：本函数上一版的注释已写明「解压目录只读且易失」——**识别了危险，却选了个照样落进去的取法**。
  const pe = process.env.PORTABLE_EXECUTABLE_DIR;
  if (pe && fs.existsSync(pe)) return pe;
  // ③ 其他打包形态（dir/nsis）：exe 旁边就是资源根，用 execPath 的目录
  const 打包了 = /[\\/]app\.asar([\\/]|$)/.test(__dirname)
    || (!!process.versions.electron && !fs.existsSync(path.join(__dirname, 'package.json')));
  if (打包了) return path.dirname(process.execPath);
  // ④ 源码态：仓根
  return __dirname;
})();
const 会话档 = path.join(终端根, '.session.json');


const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ---- 片段模式：把标签页的主体交给主页当「视图」用 ----
//
// 病灶（2026-08-30 03:05 制作人指出「主页和标签页割裂」，量下来是四处）：
//   ① 两套顶栏（主页 顶/徽/去 vs 标签页 top/brand/tabs），各写各的
//   ② 两份导航且不一致——**主页那份漏了监视与班次**，我刚上线的班次页从主屏点不到
//   ③ 同一个 /chat 两个名字（主页叫「群聊」，标签页叫「席间存照」）
//   ④ **状态区只有主页有**（脉搏/凭据/闸数/塔况；标签页 0 处）
//
// ④ 是实质伤：读一份班次报告＝离开人闸队列与产线状态，而 PRODUCT.md 原则一要求
// 「活着/在跑什么/谁等我 三问不用滚动不用点击就能回答」——在标签页上三问一条都答不了。
//
// 修法不是给标签页也补一套状态（那是把两套壳养成两套），是**让主页成为唯一的壳**：
// 标签页的主体作为视图落进主页最大的那一栏。实测那一栏（话栏）大多数时候是空的，
// 而闸栏与脉栏得以留在屏上。
//
// 为什么用中间件而不是逐个路由加参数：壳() 有 8 处调用点分散在 5 个文件里，
// 逐个改是 8 次机会犯同一个错。这里抽的是 壳() 自己写的 `<main class="wrap">`，
// 形状由它保证，一处改动覆盖全部。
//
// **整页模式一字未动**：直接访问 /shift 仍返回完整页面。降级路不许断——
// 主页的 JS 一旦出问题，这些页面还得能单独打开。
// 参数名用 ASCII（frag，不是「片」）：它是给机器用的。中文参数名要 URL 编码才发得出去，
// 而今晚已经在 schema 键名、argv、shell 上各栽过一次同一族的坑——名字给人看，参数给机器用。
app.use((req, res, next) => {
  if (!req.query || req.query.frag !== '1') return next();
  const 原send = res.send.bind(res);
  res.send = (b) => {
    if (typeof b === 'string' && /^<!doctype/i.test(b)) {
      const m = b.match(/<main class="wrap">([\s\S]*?)<\/main>/);
      if (m) {
        // **页面的 <script> 在 </main> 之外，而 innerHTML 不执行 script**——
        // 于是 监视 / 存照 / 文稿 三页的前端脚本，在主页壳里**从来没跑过**：
        // 监视页不刷新、存照页没有坐席名单、文稿台搜不了也跳不了。
        // 三页看着都在，只是不动——这类「静止的活人」不报任何错。
        // 把 src 带出来挂在片段上，由 视图.js 负责按需加载并广播「装好了」。
        const 脚 = [...b.matchAll(/<script[^>]+src="([^"]+)"[^>]*><\/script>/g)].map((x) => x[1]);
        const 属 = 脚.length ? ` data-脚本="${脚.join(' ')}"` : '';
        return 原send(`<div class="视图"${属}>${m[1]}</div>`);
      }
    }
    return 原send(b);      // 不是整页（JSON、纯文本）就原样过——片段模式不该改变它们
  };
  next();
});

// 视图清单：主页顶栏据此渲染导航。**与服务端 头() 同一份表**——
// 两份手工维护的列表必然分叉，而分叉的表现是「新做的页面看不见」，不报错，没人会发现。
app.get('/api/views', (req, res) => res.json({ 视图: require('./server/render/页签').页签表 }));

// 情报三页（M1c · V1/V2/V3）：/digest[/日]、/stream[/日]、/health。
// 挂在 static 之后：坐席（public/index.html）继续占着 `/`，这三条各走各的路径，互不遮挡。
require('./server/routes/views').挂(app, 终端根);

// ---- 取数：监制台代理 ----
// 读不到时回 { 读不到: true, 因 }，前端据此显示「读不到」而不是 0（设计原则五）。
function 取(路径) {
  return new Promise((res) => {
    const req = http.get(监制台 + 路径, { timeout: 6000 }, (r) => {
      let s = '';
      r.on('data', (d) => { s += d; });
      r.on('end', () => {
        try { res(JSON.parse(s)); } catch (e) { res({ 读不到: true, 因: '返回非 JSON' }); }
      });
    });
    req.on('error', (e) => res({ 读不到: true, 因: e.code || e.message }));
    req.on('timeout', () => { req.destroy(); res({ 读不到: true, 因: '超时' }); });
  });
}

// 人闸队列：只要「等制作人」的那些（归属 制作人 或 双），按停摆时长降序——等得久的在上面。
// 文稿的解锁请求也是「等你动手的事」，所以进同一条队列。
// **落点选人闸队列不选弹窗**：解锁请求不紧急到要打断你，而你大概率正在改那份文档——
// 弹通知打断你改文档是蠢的。人闸栏常驻可见、带等待时长、不打断，正是它该待的地方。
function 文稿闸债(现在 = Date.now()) {
  let 表;
  try { 表 = 文稿台.表(); } catch (e) { return []; }
  const 出 = [];
  for (const [k, q] of Object.entries((表 && 表.请求) || {})) {
    const 条 = (表.锁 || {})[k];
    // 锁已经没了（过期或已解）就不再挂着——那条请求已经自然满足了
    if (!条 || 文锁lib.判态(条, 现在).态 === '过期') continue;
    出.push({
      单号: '文稿',
      摘要: `${q.谁 || '总监'} 请求解锁 ${k}${q.次数 > 1 ? `（第 ${q.次数} 次）` : ''}`,
      为何: q.为何 || '',
      归属: '制作人',
      落点: '文稿台',
      停摆小时: Math.max(0, (现在 - (q.起于 || 现在)) / 3600000),
      文稿键: k,
    });
  }
  return 出;
}

app.get('/api/gates', async (req, res) => {
  const 本地 = 文稿闸债();
  const a = await 取('/api/attn');
  // 监制台读不到时**本地这几条仍要给出去**——读不到远端不等于本地没有等你的事
  if (a.读不到) return res.json({ ...a, 债: 本地, 本地债: 本地.length });
  const 债 = (a.债 || [])
    .filter((d) => ['制作人', '双'].includes(d.归属))
    .concat(本地)
    .sort((x, y) => (y.停摆小时 || 0) - (x.停摆小时 || 0));
  res.json({
    债, 逾期阈值小时: a.逾期阈值小时 || 24,
    总债数: (a.债 || []).length + 本地.length, 本地债: 本地.length,
  });
});

// 议程债：机制/政策类待裁事项。
//
// 为什么要单开这一路：/api/attn 只登记**单据级**闸（G1/G2/G3…），机制与政策类决定不进任何队列，
// 只落 journal 散文。08-27 00:25 实测的代价——堵住整夜排程的那个决定（注册监制台为项目）
// 在值班屏上查无此项。议程档是它们的指定住址，先读起来。
//
// 这是桥不是定论：机制项该登记成闸债还是由屏幕读议程档，是议程第 36 条，候制作人裁。
const 议程档 = () => path.join(台根, '待办-制作人议程.md');
const 型名 = { '💬': '需讨论', '✍': '一句话', '🔧': '我来干' };

function 读议程() {
  let 文;
  try { 文 = fs.readFileSync(议程档(), 'utf8'); } catch (e) { return { 读不到: true, 因: e.code || e.message }; }
  const 事 = [];
  let 节 = '';
  for (const l of 文.split(/\r?\n/)) {
    const h = l.match(/^#{2,3}\s+(.+)$/);
    if (h) { 节 = h[1].trim(); continue; }
    // 只认「| 数字 | 事项 | 类型 | 说明 |」这一种行；6a/6b 这类字母子行与表头分隔行都不算
    const m = l.match(/^\|\s*(\d+)\s*\|(.+?)\|\s*(💬|✍|🔧)\s*\|(.*)\|\s*$/);
    if (!m) continue;
    const 说明 = m[4].trim();
    // ✅ 开头 = 已定/已落，不再等人。**只看开头**——说明里引用别处的 ✅ 不算这条已结
    if (/^✅/.test(说明)) continue;
    事.push({
      号: +m[1],
      题: m[2].trim().replace(/\*\*/g, ''),
      型: m[3],
      型名: 型名[m[3]] || '',
      节: 节.replace(/^[一二三四五六七]、/, ''),
      说明: 说明.replace(/\*\*/g, ''),
    });
  }
  // 🔧 是「我干活你不用管」——不该占你的队列。留 💬 与 ✍
  return { 事: 事.filter((x) => x.型 !== '🔧'), 全量: 事.length };
}

app.get('/api/agenda', (req, res) => res.json(读议程()));

// 凭据寿命：OAuth 还剩多久。
//
// 只读 claudeAiOauth.expiresAt 这一个数字，**绝不读、不回、不记 token 本身**——
// 这块屏是常驻全屏的，任何时候都可能有人从旁边走过。
//
// 为什么值得单开一路：token 过期后坐席开口就是 401，而 401 的 stderr 是一团鬼话。
// 08-27 02:19 实测到期前 18 分钟才有告警，且自续探针「跑通了但 expiresAt 没动」。
// 与其让人对着看不懂的报错猜，不如把「还剩几分钟 + 那条重登命令」直接摆在屏上。
const 凭据路径 = () => path.join(process.env.USERPROFILE || process.env.HOME || '', '.claude', '.credentials.json');
const 重登命令 = '"C:\\Users\\suxin\\.local\\bin\\claude.exe" auth login';

function 凭据况() {
  let raw;
  try { raw = fs.readFileSync(凭据路径(), 'utf8'); }
  catch (e) {
    return { 态: '未登录', 剩余分: null, 因: e.code === 'ENOENT' ? '本机没有凭据文件' : '凭据文件读不动', 命令: 重登命令 };
  }
  let exp;
  try { exp = ((JSON.parse(raw) || {}).claudeAiOauth || {}).expiresAt; }
  catch { return { 态: '未登录', 剩余分: null, 因: '凭据文件解不开', 命令: 重登命令 }; }
  if (typeof exp !== 'number') return { 态: '未登录', 剩余分: null, 因: '凭据里没有 expiresAt', 命令: 重登命令 };
  const 剩 = Math.round((exp - Date.now()) / 60000);
  const 态 = 剩 <= 0 ? '过期' : (剩 < 30 ? '临期' : '有效');
  return {
    态,
    剩余分: 剩,
    到期: new Date(exp).toTimeString().slice(0, 5),
    命令: 态 === '有效' ? null : 重登命令,   // 只在真该重登时才把命令摆出来
  };
}

app.get('/api/cred', (req, res) => res.json(凭据况()));

// 额度：直接透传监制台的窗口读数（5小时窗 / 周窗）
app.get('/api/quota', async (req, res) => res.json(await 取('/api/quota')));

// 产线脉搏：各态计数 + 在跑会话 + 今日落袋
app.get('/api/pulse', async (req, res) => {
  const [b, r] = await Promise.all([取('/api/board'), 取('/api/runner')]);
  if (b.读不到) return res.json({ 读不到: true, 因: b.因 });
  const 计 = {};
  for (const s of (b.states || [])) 计[s] = (b.board[s] || []).length;
  res.json({
    计数: 计,
    大态: b.大态 || {},
    在跑: r.读不到 ? null : (r.执行中 || []).map((x) => ({ 单: x.id, 环节: x.kind, 起时: x.startedAt, 池: x.池 })),
    拒因: r.读不到 ? [] : ((r.上轮 && r.上轮.拒因) || []),
  });
});

// 事件流：journal 尾部（监制台没开这一口，直接读盘——只读，不写）
// 事种 与 折叠 在 public/事流.js —— **四处共用同一份**（见该文件头注）：
// 这里、public/app.js 的右栏、server/routes/监视.js、public/监视.js。
// 服务端 require 一个 public/ 下的文件看着别扭，但比
// 「服务端与浏览器各写一份、靠判据比对源码文本」诚实得多——
// 那种比对会因为无关的排版差异而红，而那种判据最后一定会被人关掉。
const 事流 = require('./public/事流.js');

app.get('/api/events', (req, res) => {
  // **本地月，不是 UTC 月。**写侧（studio/lib/journal.js）按 d.getMonth()+1 分档；
  // 这里原来写的是 toISOString().slice(0,7)。UTC+8 下每月 1 号本地 00:00–07:59
  // 对应 UTC 上个月最后一天，于是去读上个月那份 log——**文件存在、读得通、不进读不到分支**，
  // 屏上照常滚动，而这八小时的告警一条都不出现，08:00 自愈、不留痕。
  const 月 = require('./server/lib/读数').本地月();
  const p = path.join(process.env.STUDIO_ROOT || 'D:/GitHub/AI-GameStudio/监制台', 'journal', 月 + '.log');
  try {
    const 全 = fs.readFileSync(p, 'utf8');
    // **在大窗口上折，再取前 N 组**——首版是 `.slice(-40)` 直接给前端。
    // 异厂评审 2026-08-31 的击杀：08:00 出现 `同步失败 code=401`，
    // 随后每 5 分钟一条心跳、连着 41 条——那条失败**根本不在返回的 40 条里**，
    // 前端再怎么「只折相邻、不跨过中间的事」也救不回来，屏上只会是心跳×40。
    // 折叠若发生在窗口之后，它保住的只是版面，保不住信息。
    const 行 = 全.split(/\r?\n/)
      .filter((l) => /^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}\]/.test(l))
      .slice(-600)       // 先取一大段（600 行 ≈ 心跳满打满算两天，够任何一次故障活下来）
      .reverse();        // 新在前
    // 行首固定 19 字符：[YYYY-MM-DD HH:MM] + 一个空格。切 20 会啃掉正文第一个字
    const 条 = 行.map((l) => ({ 时: l.slice(12, 17), 文: l.slice(19) }));
    const 组 = 事流.折叠(条, { 上限: 60 });   // 折完 60 组就足够填满那一栏
    res.json({ 事: 事流.脱种(组), 原始行数: 条.length });
  } catch (e) {
    res.json({ 读不到: true, 因: e.code || e.message });
  }
});

// ---- 坐席的权界（2026-08-27 15:41，制作人第一次用 exe 时坐席自己报出来的两个卡点）----
//
// 卡点一·够不着：cwd 原本设的是 `监制台`，而 `白夜馆/`（晨晚报归档）、`协议库/`、`历史库/`
// 都在**上一层** AI-GameStudio 下。坐席开口就说「白夜馆在监制台下没找到……如果它确实该在这儿，
// 那是个漏洞」——是漏洞，是我设的。cwd 保持 监制台（它惯用的相对路径都以此为准），
// 上一层与源码仓走 additionalDirectories 补进来。
//
// 卡点二·动不了手：无头会话没有人能点「批准」，需审批的工具调用只会失败。
// 所以权界必须**事先写死**，不能指望运行时问人。
//
// 给到什么程度是职权判断不是配置细节：坐席拿到 Write+Bash，就等于能做总监在会话里能做的一切。
// 取向定为**读得宽、写得准、Bash 走白名单**：
//   · 读：整个数据根 + 源码仓，全开——读不到就只能猜，猜出来的结论比不回答更坏
//   · 写：开。总监的本职就包含手写 journal 留痕与议程补录，这条路整夜都在走
//   · Bash：白名单。不给 rm/del/format/reg 这类，也不给 git push——
//     销毁性与外发性动作属人，坐席要做得先跟人说（A-治理 二·人本化）
const 数据根 = path.resolve(台根, '..');
const 源码仓 = process.env.TICKETFLOW_ROOT || 'D:/GitHub/Ticketflow';

const 放行工具 = [
  'Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch', 'TodoWrite', 'Task',
  'Edit', 'Write', 'NotebookEdit',
  // Bash 白名单：查得动、跑得了自己的脚本，但碰不到销毁性与外发性动作
  'Bash(node:*)', 'Bash(npm test:*)', 'Bash(npm run:*)',
  'Bash(git status:*)', 'Bash(git log:*)', 'Bash(git diff:*)', 'Bash(git show:*)',
  'Bash(curl:*)', 'Bash(dir:*)', 'Bash(type:*)', 'Bash(findstr:*)',
];
// 明令禁的：白名单之外本就进不来，这一列是**双保险 + 意图留痕**——
// 让「为什么不给」写在代码里，而不是靠白名单恰好没列到。
const 禁用工具 = [
  'Bash(rm:*)', 'Bash(del:*)', 'Bash(rmdir:*)', 'Bash(format:*)', 'Bash(reg:*)',
  'Bash(git push:*)', 'Bash(git reset --hard:*)', 'Bash(shutdown:*)', 'Bash(taskkill:*)',
];

// 代理：裸环境连不上 api.anthropic.com（记忆坑）。SDK 把 env 透给它拉起的子进程。
const 代理 = process.env.HTTPS_PROXY || 'http://127.0.0.1:7890';

const 班次lib = require('./server/lib/班次');
const 用量档 = () => path.join(终端根, '用量.jsonl');
// 真实订阅窗口的水位，由瞭望塔写
// 可显式覆盖：判据不许依赖「真实水位此刻恰好低于线」这种环境条件——
// 那样水位一涨判据就红，而红的原因跟被测的东西无关。
const 额度档 = () => process.env.TERMINAL_QUOTA_FILE || path.join(台根, '瞭望塔', '额度读数.jsonl');
const 开班水位线 = Number(process.env.TERMINAL_SHIFT_QUOTA_CEILING) > 0
  ? Number(process.env.TERMINAL_SHIFT_QUOTA_CEILING) : 70;

/**
 * 开班闸 = 自己那本账 ∧ 真实窗口水位。**两道都要过。**
 *
 * 分成两个函数而不是给 可否开班 加一个默认关的参数——
 * 「默认关的安全检查」等于没有检查（08-29 异厂评审 K1 打的就是这种反向默认）。
 * 组合放在这里一处，本身也有判据盯着。
 */
function 开班闸() {
  const 账 = 班次lib.可否开班(用量档(), 班次上限);
  if (!账.行) return 账;
  const 窗 = 班次lib.窗口可否(额度档(), 开班水位线);
  if (!窗.行) return { ...窗, 已耗: 账.已耗, 上限: 账.上限 };
  return { ...账, 因: 账.因 + '；' + 窗.因, 水位: 窗.水位 };
}
// 一班的 output token 上限。可用 TERMINAL_SHIFT_BUDGET 覆盖。
const 班次上限 = Number(process.env.TERMINAL_SHIFT_BUDGET) > 0
  ? Number(process.env.TERMINAL_SHIFT_BUDGET) : 班次lib.缺省上限;

/**
 * 用量落盘。**不记就没法给夜班定额度闸**——2026-08-29 异厂评审「成本红队」点名：
 * 「真正缺的基线只有一条口子能开——server.js 把 m.usage 落盘，现在这行没写」。
 * 一班烧多少、烧穿了没有，只能靠真实读数说话，不能靠估。
 * 落在终端根（数据根，非 %TEMP%），append-only，写不动只记不炸。
 */
function 记用量(来路, m) {
  try {
    const u = (m && m.usage) || {};
    fs.appendFileSync(用量档(), JSON.stringify({
      t: new Date().toISOString(),
      来路,                                        // 人在输入框 / 班次唤起
      入: u.input_tokens ?? null,
      出: u.output_tokens ?? null,
      缓存读: u.cache_read_input_tokens ?? null,
      缓存写: u.cache_creation_input_tokens ?? null,
      轮次: (m && m.num_turns) ?? null,
      毫秒: (m && m.duration_ms) ?? null,
      出错: !!(m && m.is_error),
    }) + '\n', 'utf8');
  } catch (e) { console.warn('用量落盘失败：', e && e.message); }
}

/**
 * 坐席的 SDK 选项。**只此一处。**
 *
 * 2026-08-29 加 NO_PROXY 时的教训：选项原本在两个地方各写了一份，
 * 用「全部替换」去改，只命中了缩进相同的那一处，另一处静默漏改而工具报告「全部替换成功」。
 * 同一份配置存两份，就一定会有一天只改了一份——而且那一天你不会知道。
 *
 * opt.续：接着上一次会话（人在输入框那条路要）。班次不传——班次该开新会话，
 * 不该继承人当时聊到哪儿了。
 */
function 坐席选项(opt = {}) {
  return {
    // cwd 落在监制台：坐席要能直接读台账与工单目录，跑在终端自己的目录里等于把眼睛蒙上
    cwd: 台根,
    // 少了它回答会整段憋到最后一起蹦出来，中间是一段无声的长等待——对坐席等于「没反应」
    includePartialMessages: true,
    // NO_PROXY 是必须的：代理是为了连 api.anthropic.com 才注的，
    // 但它会把**本机请求也代理走**——坐席 curl 127.0.0.1:4270 会拿到 Clash 的 502，
    // 而不是监制台的回答。2026-08-29 13:2x 第一次无人值守唤醒实测撞到：
    // 坐席拿一个空端口（4271）当对照组，发现它同样回 502，于是判定
    // 「502 是代理的统一回复，不是应用的回答」，并明写「用这个数据说 4270 在不在岗都是编的」。
    // 判断没错，但它的眼睛被我们蒙住了一半——这一行是给它摘掉眼罩。
    env: { ...process.env, HTTPS_PROXY: 代理, HTTP_PROXY: 代理, NO_PROXY: '127.0.0.1,localhost,::1' },
    // 上一层（白夜馆/协议库/历史库）与源码仓补进可达范围
    additionalDirectories: [数据根, 源码仓],
    allowedTools: 放行工具,
    disallowedTools: 禁用工具,
    // 无头会话没人能点批准：文件编辑自动接受，Bash 仍受上面两张表约束。
    // 不用 bypassPermissions——那是把闸整个拆掉，与「白名单」的意思正相反。
    permissionMode: 'acceptEdits',
    // ---- 文稿台占用闸（2026-08-31 验收复核补上）----
    //
    // 在这之前，文锁.js 的 外部可写() **生产代码零调用点**：函数写好了、判据齐了，
    // 而告示还在对坐席说「硬拦在 server 侧，写了也会被拒」——那是一句没兑现的话。
    // 判据全绿，因为判据自己直接调那个函数。
    //
    // 接在 SDK 的 options.hooks 上而不是制作人的 settings.json 上：
    // 只作用于终端拉起的坐席，随进程生死，不给全局配置留残留。
    hooks: {
      PreToolUse: [{
        hooks: [async (入) => {
          const 判 = 写手闸.判写(入 && 入.tool_name, 入 && 入.tool_input,
            (p) => 文稿台.外部可写(p, 文稿根表()));
          if (判.决 !== 'deny') return { continue: true };
          // **拦下来还要让制作人看见有人在等**——不然坐席被挡了，而屏上没有任何痕迹，
          // 他永远不知道该去解那把锁。请求进人闸队列（带等待时长，起点不刷新）。
          for (const x of 判.挡住的) {
            const i = String(x.键 || '').indexOf('/');
            if (i > 0) {
              try {
                文稿台.请求解锁(x.键.slice(0, i), x.键.slice(i + 1), '总监',
                  `坐席要改这份文件（${入.tool_name}），被文稿台的锁拦下了`);
              } catch (e) { /* 记不下也别把拦截本身弄失败 */ }
            }
          }
          return {
            hookSpecificOutput: {
              hookEventName: 'PreToolUse',
              permissionDecision: 'deny',
              permissionDecisionReason: 判.因,
            },
          };
        }],
      }],
    },
    ...(CLI路径 ? { pathToClaudeCodeExecutable: CLI路径 } : {}),
    ...(opt.续 ? { resume: opt.续 } : {}),
    // 私聊：把这一席的人设接到系统提示后面。
    //
    // 在这之前，座条上点谁都只是**换个皮**：私聊席 存在前端、从没发给服务端，
    // 而说区底下那句「私聊 X · 这条线有自己的记忆，与群里那条各记各的」
    // 是照着设计稿写的、一个字都没兑现——同一个会话、同一个人设、同一份记忆。
    // 屏上讲了一件没发生的事，比屏上什么都不讲坏得多。
    ...(opt.席 && opt.人设 ? {
      systemPrompt: {
        type: 'preset', preset: 'claude_code',
        append: `此刻你是这间工作室的「${opt.席}」，与制作人单线说话（群里其余席位看不见这条线）。`
          + `你的职责：${opt.人设}`
          + '\n越出这份职责的问题，说清楚它该找哪一席，不要替那一席回答。',
      },
    } : {}),
  };
}

// ---- 说话：Agent SDK query()，SSE 流回 ----

// 把一次工具调用讲成一句人话。只取够用的那点信息：动作 + 对象，不倒工具参数。
const 动词 = {
  Read: '读', Glob: '翻', Grep: '搜', Bash: '跑', Edit: '改', Write: '写',
  WebFetch: '取', WebSearch: '搜网', Task: '派手下查',
};
// 占用告示：把此刻锁着的文件告诉坐席。
//
// **这一条是评审击杀逼出来的。**原方案只把告示接进了 跑班次，而击杀构造的时刻表是：
//   21:26 制作人在 §4.10 标了个【问】，点「转交」→ 坐席读档、答问，
//         **顺手把那行【问】替换成「（已答：…）」并 Edit 落盘**。
//         这不是越权——文档第一页那张记号表就是给它的契约（【问】＝你不确定，要我先答）。
//   21:27 制作人手上是 25 分钟的手工标注，盘上已经是另一版。
// 所以 /api/say 这条路也必须带告示，不能只给班次。
//
// **告示只是「说一声」，此刻没有配套的机器闸。**
// lib/文锁.js 的 外部可写() 写好了、有判据、但**生产代码零调用点**
// ——2026-08-31 验收复核 grep 出来的，而判据全绿是因为判据自己直接调它。
// 要让它变成真闸，得接到 PreToolUse hook 上，那要改制作人的 settings.json，
// 是人闸事项，不擅自做。在接上之前告示文案已改成实话：说这是约定不是闸。
// **宁可承认没有闸，也不要让人以为有。**
//
// 文本在 lib/文锁.js 的 告示()——放在 lib 里是为了**能上判据**：
// 留在这里的话它是个不导出的局部函数，没有任何判据够得着它，
// 而 H104 的口径是「判据必须验行为」，不是「看着像对的就行」。
function 占用告示() {
  try { return 文锁lib.告示(文稿台.表()); } catch (e) { return ''; }
}

function 干什么(b) {
  const i = b.input || {};
  const 名 = (p) => String(p || '').split(/[\\/]/).pop().slice(0, 40);
  const 动 = 动词[b.name] || b.name;
  if (i.file_path) return `${动} ${名(i.file_path)}`;
  if (i.pattern) return `${动} “${String(i.pattern).slice(0, 28)}”`;
  if (i.command) return `${动} ${String(i.command).slice(0, 40)}`;
  if (i.url) return `${动} ${String(i.url).slice(0, 40)}`;
  if (i.description) return `${动}：${String(i.description).slice(0, 32)}`;
  return 动;
}

// 报错要说人话。认证失败的原文是一团鬼话，而这块屏前坐的人只需要知道两件事：
// 是登录过期了，以及那条重登命令。凭据况() 复核一次，免得把别的错误误报成过期。
function 说人话(原) {
  const 疑认证 = /401|unauthor|authentic|expired|oauth|credential|not logged|invalid.*key/i.test(原);
  const c = 凭据况();
  if (疑认证 || c.态 !== '有效') {
    if (c.态 === '过期') return `登录已过期 ${Math.abs(c.剩余分)} 分钟，坐席说不了话。重登一下就恢复：\n${重登命令}`;
    if (c.态 === '未登录') return `本机没登录（${c.因}）。跑这条：\n${重登命令}`;
    return `拉起失败，疑似认证问题（登录还剩 ${c.剩余分} 分钟）。若反复失败就重登：\n${重登命令}`;
  }
  // 额度打满是另一件事，别混进认证里说——重登解决不了它
  if (/usage limit|rate.?limit|quota/i.test(原)) return `额度到顶了：${原.slice(0, 160)}`;
  // CLI 拉不起来：2026-08-27 打包首用即撞。原文讲的是 libc/musl，跟真因（asar 里的二进制不可执行）
  // 差着十万八千里，照抄给人看等于没说。
  if (/failed to launch|pathToClaudeCodeExecutable|ENOENT.*claude/i.test(原)) {
    return `拉不起 claude CLI。当前指向：${CLI路径 || '（没探到，用的 SDK 自带版）'}\n`
      + '若这条反复出现，多半是 CLI 路径变了——设环境变量 CLAUDE_CLI 指到真路径再重开。';
  }
  return 原.slice(-300);
}

// 会话档：群一份，每个私聊席各一份。
//
// 「这条线有自己的记忆」这句话，兑现在这里——不是在前端那个 class 上。
// 席名进文件名前必须洗：名单虽然来自 坐席.js（不是用户输入），
// 但**"它现在不是用户输入"不是路径安全的理由**，那种理由只要有人往名单里加一条就失效了。
const 席档名 = (席) => String(席 || '').replace(/[^一-龥A-Za-z0-9_-]/g, '').slice(0, 24);
const 会话档于 = (席) => {
  const s = 席档名(席);
  return s ? path.join(终端根, `.session-${s}.json`) : 会话档;
};
const 读会话 = (席) => { try { return JSON.parse(fs.readFileSync(会话档于(席), 'utf8')).id || null; } catch { return null; } };
const 写会话 = (id, 席) => { try { fs.writeFileSync(会话档于(席), JSON.stringify({ id, at: new Date().toISOString() })); } catch { /* 记不住就每次新开，不阻断 */ } };

app.post('/api/say', async (req, res) => {
  const 话 = String((req.body || {}).话 || '').trim();
  if (!话) return res.status(400).json({ error: '空话' });
  // 来路：谁在说话。缺省「人」＝输入框；班次唤起会带自己的名字。
  // 记它是为了让用量分得开——人在场的交互和无人值守的班次是两种负载，混在一起算额度没有意义。
  const 来路 = String((req.body || {}).来路 || '人').slice(0, 32);

  // 私聊席。**在写响应头之前查完**——一旦开了 SSE 流就只能用事件报错，
  // 而"参数不对"应当是一个 400，不该伪装成一次失败的对话。
  const 坐席 = require('./server/lib/坐席');
  const 席名 = String((req.body || {}).席 || '').trim();
  let 席 = null;
  if (席名) {
    const s = 坐席.按名(席名);
    if (!s) return res.status(400).json({ error: `名单里没有「${席名}」这一席` });
    // 未接模型的席位不许开私聊：它答不出，而屏上会显示一条"正在思考"，
    // 那正是 2026-08-31 巡礼里反复出现的那一种——看着在动，其实没有人在。
    if (!s.接模型) return res.status(400).json({ error: `${席名} 还没接模型，说了没人应` });
    席 = s;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  const 发 = (类, 数据) => { try { res.write(`event: ${类}\ndata: ${JSON.stringify(数据)}\n\n`); } catch { /* 已断 */ } };

  const 续 = 读会话(席 && 席.名);
  // 代理注入（记忆坑）：裸环境连不上 api.anthropic.com。SDK 把 env 透给它拉起的子进程。
  // 代理用模块级那一份（本文件顶部），不在这里再声明一次——同一个值存两份就会有一天只改一份

  let 报告 = '';
  let 完 = false;
  let 断 = false;
  res.on('close', () => { 断 = true; });   // 客户端断线：下一拍就收摊，别继续烧额度

  try {
    const query = await 取query();
    const q = query({
      prompt: 占用告示() + 话,                // 中文直接进 SDK，不经 argv/shell——那条坑绕开了
      options: 坐席选项({ 续, 席: 席 && 席.名, 人设: 席 && 席.人设 }),
    });
    for await (const m of q) {
      if (断) break;
      if (m.session_id) 写会话(m.session_id, 席 && 席.名);

      if (m.type === 'stream_event') {
        const d = m.event && m.event.delta;
        if (d && d.type === 'text_delta' && d.text) 发('片', { 文: d.text });
      } else if (m.type === 'assistant' && m.message && Array.isArray(m.message.content)) {
        for (const b of m.message.content) {
          if (b.type === 'text' && b.text) 报告 += b.text;
          // 一个问题常要查两分钟工单。干等一个不动的「思考中」等于没反应，
          // 所以把正在动的手报出来——不是进度条，是它此刻在翻哪一份东西。
          else if (b.type === 'tool_use') 发('活', { 做: 干什么(b) });
        }
      } else if (m.type === 'result') {
        完 = true;
        // 用量落盘。**不记就没法给夜班定额度闸**——08-29 评审「成本红队」点名：
        // 「真正缺的基线只有一条口子能开——server.js 把 m.usage 落盘，现在这行没写」。
        // 一班烧多少、烧穿了没有，只能靠真实读数说话，不能靠估。
        // 落在终端根（数据根，非 %TEMP%），append-only，写不动只记不炸。
        // 私聊单独计：群里那条线和八条私线烧的是同一份额度，混着记就看不出是谁在烧
        记用量(席 ? `${来路}·${席.名}` : 来路, m);
        if (m.is_error && !报告) {
          发('崩', { 因: 说人话(String(m.result || m.subtype || '未知错误')) });
        } else {
          发('毕', { 全文: 报告 || String(m.result || '') });
        }
      }
    }
    // SDK 流自然结束却没给 result：不当成成功，也不假装有答案
    if (!完 && !断) {
      if (报告) 发('毕', { 全文: 报告 });
      else 发('崩', { 因: 说人话('会话结束但没有产出（无 result 事件）') });
    }
  } catch (e) {
    发('崩', { 因: 说人话(String((e && e.message) || e)) });
  }
  try { res.end(); } catch { /* 已断 */ }
});

// ---- 班次口：无人值守的上工 ----
//
// 制作人 2026-08-29 交办。缺的从来不是「坐席干不干得动」——13:2x 手工唤醒实测证明它干得动，
// 而且守得住边界（拒绝跑会真注册计划任务的判据、拿空端口当对照组识破代理的 502）。
// 缺的是**有东西去敲门，并且愿意守着那条流直到干完**。
//
// **守流的责任放在终端自己这里，不在敲门的那一方。** 这是本设计的全部要点：
// /api/say 是 SSE，客户端一断线 res.on('close') 就把坐席掐掉（那是故意的，防没人看还在烧额度）。
// 于是任何「发一条 curl 就走」的唤醒者都会当场把活掐死。这里反过来——
// 敲门的拿到 202 就可以走，终端在进程内把流跑完、把报告落盘。
//
// **不进群聊、不碰 /api/relay。** 异厂评审对事件触发方案打出的致命击杀是自激成环：
// /api/relay 会往 journal 追一行并拉起项管会话，而塔 tail 的正是 journal。
// 班次是时钟触发的，本来就不会自激；但产出若进群聊仍会灌 journal 并触发塔的规则。
// 首版一律落盘，不发群聊——绕开整条链路，等真需要再谈。
let 班次在跑 = null;
const 班次墙钟上限毫秒 = 30 * 60 * 1000;   // 跑飞了也得停：半小时硬顶

// 班次索引：一班两条记录（开班 / 收班）。**页面只读这一份，不解析报告正文。**
//
// 为什么开班也要记——异厂评审 2026-08-30 可行性红队的击杀：
//   「10:00:02 进程在写出报告前被杀死，与调度器根本未启动时同样是『无报告、当前闸正常』，
//     方案没有持久化的启动/崩溃事件，二者必然同态。」
// 它是对的。只记收班的话，「开过但没收」（跑到一半被杀 / 断电）与「压根没开」
// 在盘上长得一模一样，而这两件事要查的东西完全不同。
function 记班次(条) {
  try {
    fs.mkdirSync(path.join(终端根, '班次'), { recursive: true });
    fs.appendFileSync(path.join(终端根, '班次', '索引.jsonl'),
      JSON.stringify({ t: new Date().toISOString(), ...条 }) + '\n', 'utf8');
  } catch (e) { console.warn('班次索引落盘失败：', e && e.message); }
}

async function 跑班次(班次名, 话) {
  const 起 = Date.now();
  const 档 = 班次lib.报告路径(终端根, 班次名, 起);
  记班次({ 型: '开班', 班次: 班次名, 档名: path.basename(档), 起于: new Date(起).toISOString() });
  let 报告 = '';
  let 收 = null;
  let 用量 = { 出: null, 轮次: null };
  try {
    fs.mkdirSync(path.dirname(档), { recursive: true });
    // 干跑：只验接线（202 → 落盘 → 单飞标志复位），不真调模型。
    // **它验的是接线，不是坐席**——坐席那条路由真机冒烟验（一次真班次）。
    // 分开是因为：只验 lib 不验接线，正是今晚反复吃亏的地方；
    // 而每次跑判据都真调一次模型，判据就会贵到没人肯跑。
    if (process.env.TERMINAL_SHIFT_DRY === '1') {
      报告 = '（干跑：TERMINAL_SHIFT_DRY=1，未调用模型）';
      throw { 干跑: true };
    }
    const query = await 取query();
    // 占用告示也要给班次。**02:00 那一班是最危险的一个**：制作人睡了、页面可能还开着，
    // 而坐席有 Edit/Write 且 permissionMode 是 acceptEdits——没有任何一步会问人。
    const q = query({ prompt: 占用告示() + 话, options: 坐席选项({}) });   // 不续人的会话：班次开新的
    for await (const m of q) {
      if (Date.now() - 起 > 班次墙钟上限毫秒) { 收 = '超过墙钟上限被掐'; break; }
      if (m.type === 'assistant' && m.message && Array.isArray(m.message.content)) {
        for (const b of m.message.content) if (b.type === 'text' && b.text) 报告 += b.text;
      } else if (m.type === 'result') {
        记用量('班次:' + 班次名, m);
        用量 = { 出: (m.usage && m.usage.output_tokens) ?? null, 轮次: m.num_turns ?? null, 出错: !!m.is_error };
        // **不能写成 `m.is_error && !报告`。** 那个 `!报告` 是短路，而坐席从第一轮就在流式吐字
        // （两份真报告第 9 行起就是长段叙述），所以 报告 早已非空；跑到第 20 轮撞额度窗被打断时
        // 收 会保持 null，报告头于是写下「正常收尾」——而同一次 result 的 记用量 落的是 出错:true。
        // 两个都被我划进「结构化可信」的源，对同一次班次给出相反结论，屏上是绿勾配一份半截报告。
        // 08-30 异厂+红队评审的第一条重级击杀打的就是这里。
        if (m.is_error) {
          收 = '坐席报错：' + String(m.result || m.subtype || '未知')
            + (报告 ? `（已产出 ${报告.length} 字，报告不完整）` : '');
        } else if (!报告) 报告 = String(m.result || '');
      }
    }
  } catch (e) {
    if (!(e && e.干跑)) 收 = '班次异常：' + String((e && e.message) || e);
  }
  const 秒 = Math.round((Date.now() - 起) / 1000);
  // **失败也要落盘。** 不落的话，第二天早上「没有报告」既可能是没跑，也可能是跑崩了，
  // 两者在盘上长得一样——今晚一整夜都在治这种病。
  try {
    fs.writeFileSync(档, [
      `# 班次报告 · ${班次名}`, '',
      `- 起于：${new Date(起).toISOString()}`,
      `- 用时：${秒} 秒`,
      `- 结果：${收 ? '未正常收尾（' + 收 + '）' : '正常收尾'}`,
      '', '---', '', 报告 || '（坐席没有产出任何文本）', '',
    ].join('\n'), 'utf8');
  } catch (e) { console.warn('班次报告落盘失败：', e && e.message); }

  // **索引：页面只读这一份，不去解析报告正文。**
  //
  // 报告是坐席写的散文（措辞不定），而页面上的每一个数字、每一种状态都必须是真的
  // （设计原则五）。从散文里抠出来的东西会因为下一次换个说法而悄悄变错——
  // 那比没有这个数字坏得多。所以机器写的事实单独落一份结构化的账。
  //
  // 它同时解决另一件事：报告是 .md、用量在 用量.jsonl，两份记录互不引用，
  // 页面要显示「这一班花了多少」只能靠时刻去猜。索引里两样都有，不用猜。
  记班次({
    型: '收班',
    班次: 班次名,
    档名: path.basename(档),
    起于: new Date(起).toISOString(),
    用时秒: 秒,
    结果: 收 ? '未正常收尾' : '正常收尾',
    因: 收 || null,
    出: 用量.出,
    轮次: 用量.轮次,
    出错: !!用量.出错,          // 与 结果 同源同判；两者不一致本身就是要查的事
  });

  console.log(`[班次] ${班次名} ${收 ? '异常收尾' : '完成'}，${秒} 秒，报告 ${档}`);
  班次在跑 = null;
  return { 档, 秒, 收 };
}

app.post('/api/shift', (req, res) => {
  const 班次名 = String((req.body || {}).班次 || '自检').slice(0, 40);
  const 话 = String((req.body || {}).话 || '').trim();
  if (!话) return res.status(400).json({ 受理: false, 因: '没给活干（话为空）' });

  // 单飞：两个班次同时跑会互相抢额度，也会让报告互相盖
  if (班次在跑) return res.status(409).json({ 受理: false, 因: `已有班次在跑：${班次在跑}` });

  // 额度闸开在**开班之前**。事后统计拦不住已经烧掉的。
  const 闸 = 开班闸();
  if (!闸.行) {
    console.log('[班次] 拒绝开班：' + 闸.因);
    return res.status(429).json({ 受理: false, 因: 闸.因, 上限: 闸.上限 });
  }

  班次在跑 = 班次名;
  res.status(202).json({ 受理: true, 班次: 班次名, 今日已耗: 闸.已耗, 上限: 闸.上限, 余: 闸.余 });
  // 敲门的已经拿到回执可以走了；流由本进程守着跑完
  跑班次(班次名, 话).catch((e) => { console.warn('[班次] 未捕获：', e); 班次在跑 = null; });
});

// ---- 班次页取数 ----
const 班次目 = () => path.join(终端根, '班次');
const 索引档 = () => path.join(班次目(), '索引.jsonl');

/** 读索引，回 { 读到, 条[], 坏行, 因? }。**读不到与读到空是两回事**，必须分得开。 */
function 读索引() {
  let 行;
  try { 行 = fs.readFileSync(索引档(), 'utf8').trim().split(/\r?\n/).filter(Boolean); }
  catch (e) {
    if (e && e.code === 'ENOENT') return { 读到: true, 条: [], 坏行: 0, 说: '还没有任何班次记录' };
    return { 读到: false, 因: '班次索引读不动：' + (e.code || e.message) };
  }
  const 条 = []; let 坏行 = 0;
  for (const l of 行) { let o; try { o = JSON.parse(l); } catch { 坏行 += 1; continue; } if (o) 条.push(o); }
  return { 读到: true, 条, 坏行 };
}

/**
 * 档名校验。**这个口没有鉴权（终端全部口都没有），松一点就是任意文件读取。**
 * 三道一起上，任何一道不过就拒：
 *   ① 形状：只认 `YYYY-MM-DD-<名>.md`，不含任何路径分隔符与盘符
 *   ② 归一后必须仍在 班次目录**之下**（挡住 %2e%2e、`..\`、绝对路径、8.3 短名——
 *      realpath 会把短名展开，所以拿 realpath 比，不拿字符串比）
 *   ③ 必须是一个真实存在的普通文件（挡住目录与符号链接指向别处）
 */
function 校档名(名) {
  const s = String(名 || '');
  if (!/^\d{4}-\d{2}-\d{2}-[^\\/:*?"<>|]{1,80}\.md$/.test(s)) return { 行: false, 因: '档名形状不对' };
  const 目 = 班次目();
  let 真目; let 真档;
  try { 真目 = fs.realpathSync(目); } catch { return { 行: false, 因: '班次目录读不到' }; }
  try { 真档 = fs.realpathSync(path.join(目, s)); } catch { return { 行: false, 因: '没有这份报告' }; }
  if (path.dirname(真档) !== 真目) return { 行: false, 因: '不在班次目录里' };
  try { if (!fs.statSync(真档).isFile()) return { 行: false, 因: '不是一个文件' }; }
  catch { return { 行: false, 因: '读不到' }; }
  return { 行: true, 路径: 真档 };
}

/** 班次页与 /api/shifts 共用的取数。**一处算，两处用**——两边各算一遍就是两把尺。 */
function 班次取数() {
  const 现 = Date.now();
  const 今 = 班次lib.日串(现);
  const 索 = 读索引();
  const 配表 = 读班次配();

  // 今天的开班/收班条，按班次归集。收班以最后一条为准（同一天同一班理论上只跑一次，
  // 但补跑/手动各跑一次是可能的，取最后一条才反映现状）。
  const 今条 = 索.读到 ? 索.条.filter((c) => 班次lib.日串(new Date(c.t).getTime()) === 今) : [];
  const 未开班档 = (() => {
    try { return fs.readdirSync(班次目()).filter((f) => f.startsWith(今) && f.includes('-未开班-')); }
    catch { return []; }
  })();

  const 今日 = 配表.map((c) => {
    const 我的 = 今条.filter((x) => x.班次 === c.班次);
    const 收 = [...我的].reverse().find((x) => x.型 === '收班') || null;
    const 开 = [...我的].reverse().find((x) => x.型 === '开班') || null;
    const 挡 = 未开班档.some((f) => f.includes(c.班次));
    const 况 = 班次lib.班况(c, 现, {
      收班条: 收, 开班条: 开, 未开班: 挡, 在跑: 班次在跑 === c.班次,
    });
    return { 班次: c.班次, 到点: c.到点, 仅星期: c.仅星期, 补跑窗口分: c.补跑窗口分, ...况 };
  });

  // 历次只给收班条（开班条是给状态判定用的，不是给人看的），最近 30 条
  const 历次 = 索.读到
    ? 索.条.filter((c) => c.型 === '收班').slice(-30).reverse()
      .map((c) => ({ t: c.t, 班次: c.班次, 用时秒: c.用时秒, 出: c.出, 轮次: c.轮次, 结果: c.结果, 因: c.因, 档名: c.档名 }))
    : null;

  return {
    今日,
    闸: 开班闸(),
    历次,
    索引读不到: 索.读到 ? null : 索.因,     // **读不到不画成空**（设计原则五）
    坏行: 索.坏行 || 0,
  };
}

app.get('/api/shifts', (req, res) => res.json(班次取数()));

/** 读一份报告。档名过 校档名 的三道，任何一道不过都不给。 */
function 读班次报告(档名) {
  const v = 校档名(档名);
  if (!v.行) return { 行: false, 因: v.因 };
  try { return { 行: true, 文: fs.readFileSync(v.路径, 'utf8') }; }
  catch (e) { return { 行: false, 因: '读不动：' + (e.code || e.message) }; }
}

app.get('/api/shifts/report', (req, res) => {
  const v = 读班次报告(req.query.f);
  if (!v.行) return res.status(400).json({ error: v.因 });
  res.type('text/plain; charset=utf-8').send(v.文);
});

require('./server/routes/班次页').挂(app, { 取数: 班次取数, 读报告: 读班次报告 });

app.get('/api/shift', (req, res) => {
  const 闸 = 开班闸();
  let 近报 = [];
  try {
    近报 = fs.readdirSync(path.join(终端根, '班次')).filter((f) => f.endsWith('.md')).sort().reverse().slice(0, 5);
  } catch {近报 = []; }
  res.json({ 在跑: 班次在跑, 闸, 近报 });
});

// ---- 定点上工 ----
//
// 触发放在终端进程内，不另起计划任务。理由：
//   ① 终端已经登录自启、且有塔的守护兜底，常驻这件事已经解决了，不必再加一个会各自坏的部件
//   ② 少一个「中文过命令行」的环节——今晚已经在 schtasks 上栽过一次（GBK 化）
//   ③ 时刻与提示词从 <终端根>/班次.json 读，**改时刻不用重新打包**
// 代价：机器关机就不跑。补跑窗口（到点后两小时内仍会跑）能兜住「早上才开机」那一类，
// 兜不住整夜关机——那种情形本来也没有夜班可言。
const 班次配档 = () => path.join(终端根, '班次.json');
/**
 * 读班次配 → 班次数组（可能为空）。
 *
 * 两种写法都认：
 *   · 单班（旧）：{ 启用, 到点, 班次, 话 }
 *   · 多班（新）：{ 班次表: [ {…}, {…} ] }
 * 兼容旧写法不是为了「以防万一」——盘上那份现在就是旧写法，而 02:00 那班马上要跑，
 * 换个读法就把它读没了。**改格式时先让旧格式继续能跑，再迁移。**
 */
function 读班次配() {
  let j;
  try { j = JSON.parse(fs.readFileSync(班次配档(), 'utf8')); }
  catch { return []; }              // 没有配置文件 = 不定点上工。**缺省关，不缺省开。**
  const 一条 = (o) => ({
    启用: o.启用 !== false,
    到点: String(o.到点 || ''),
    补跑窗口分: Number(o.补跑窗口分) > 0 ? Number(o.补跑窗口分) : 120,
    // 仅星期：0=周日…6=周六。缺省 null＝天天跑。非法值直接滤掉而不是当成 0，
    // 否则写错一个数会把「仅周末」悄悄变成「仅周日」。
    仅星期: Array.isArray(o.仅星期)
      ? o.仅星期.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6)
      : null,
    班次: String(o.班次 || '班次'),
    话: String(o.话 || ''),
  });
  if (Array.isArray(j && j.班次表)) return j.班次表.filter(Boolean).map(一条);
  return [一条(j)];
}

// 今天这个班次跑过没有——**看盘上有没有今天的报告**，不看内存标志。
// 内存标志重启就没了，于是终端一重启就会再跑一班；而报告是落在盘上的，重启也认得。
function 今日跑过(班次名) {
  // **看索引，不看文件名。**
  // 首版按报告文件名前缀判，结果是：给班次改个名字（夜间自检 → 夜间巡检），
  // 旧名字的报告就匹配不上，同一天会再跑一班——20k token 白烧，而且没人会发现，
  // 因为两份报告看起来都很正常。08-30 02:32 换四班配置时当场撞到。
  //
  // **开班也算跑过**：一班跑到一半崩了，不该被自动重跑一遍。
  // 崩了要人去看（页面上是「断了」那一态），不是让它自己再撞一次。
  const 索 = 读索引();
  if (!索.读到) {
    // 读不动索引时**当成跑过**——宁可今天不跑，不可因为读不到而反复重跑烧额度
    console.warn('[班次] 索引读不动，本日按已跑过处理：' + 索.因);
    return true;
  }
  return 班次lib.今日跑过(索.条, 班次名);
}

setInterval(() => {
  try {
    if (班次在跑) return;            // 单飞：两班同时跑会互抢额度、互盖报告
    const 现 = new Date();
    // 逐班看谁到点了。**先过滤掉今天已经跑过的**，否则一个班的补跑窗口内
    // 会把后面那个班一直挡在后面（先到先得，但已完成的不该再占位置）。
    const 配 = 班次lib.挑班次(读班次配(), 现.getTime(), 今日跑过);
    if (!配) return;

    const 闸 = 开班闸();
    if (!闸.行) {
      // **拒绝也要留痕。** 不留的话第二天早上「没有报告」既可能是没到点、
      // 也可能是被额度闸挡了，两者在盘上长得一样。
      //
      // 但**一天只留一份**。定时器每分钟进来一次，而补跑窗口最长 240 分钟——
      // 每次都写一份的话，一次持续的闸拒会在 班次/ 里堆出两百多个文件，
      // 把真报告淹掉，页面的「近报」也全是垃圾。后续的拒绝只进控制台。
      // （不改成「拒过就不再试」是有意的：闸可能在窗口内自己放开，该继续试。）
      try {
        const 目 = path.join(终端根, '班次');
        fs.mkdirSync(目, { recursive: true });
        const 今 = 班次lib.日串(现.getTime());
        const 已有 = fs.readdirSync(目).some((f) => f.startsWith(今) && f.includes(配.班次) && f.includes('-未开班-'));
        if (!已有) {
          fs.writeFileSync(班次lib.报告路径(终端根, 配.班次 + '-未开班', 现.getTime()),
            `# 班次未开 · ${配.班次}\n\n- 首次拒绝：${现.toISOString()}\n- 原因：${闸.因}\n\n`
            + '（补跑窗口内每分钟都会再试一次；这份只记第一次，后续拒绝只进控制台。）\n', 'utf8');
        }
      } catch { /* 留不下也别炸掉定时器 */ }
      console.log('[班次] 定点到了但没开班：' + 闸.因);
      return;
    }
    班次在跑 = 配.班次;
    console.log(`[班次] 定点上工：${配.班次}（${配.到点}，今日已耗 ${闸.已耗}/${闸.上限}）`);
    跑班次(配.班次, 配.话).catch((e) => { console.warn('[班次] 未捕获：', e); 班次在跑 = null; });
  } catch (e) { console.warn('[班次] 定点检查异常：', e && e.message); }
}, 60000).unref();

// ---- 群聊模型调用适配器 ----
// 路由只认识这个可替换接口；判据注入计数桩，生产态才沿用既有 Claude Agent SDK 路径。
// 群聊发言是意见而非动作，故不给模型工具口，也没有任何 /api/act/* 转发。
async function 调用群聊模型({ 坐席, 文 }) {
  const query = await 取query();
  // 代理用模块级那一份（本文件顶部），不在这里再声明一次——同一个值存两份就会有一天只改一份
  const q = query({
    prompt: `你是工作室${坐席.名}。以下是群聊中的一条意见：\n${文}\n\n只给出简洁意见；不要执行动作、不要改账、不要调用工具。`,
    options: {
      cwd: 台根,
      allowedTools: [],
      // 与坐席那处同口径（群聊席现在没有工具口，用不着 curl，但不留分叉：
      // 两处 env 一旦不一致，将来给群聊加工具时就会重犯一次同样的坑）
      env: { ...process.env, HTTPS_PROXY: 代理, HTTP_PROXY: 代理, NO_PROXY: '127.0.0.1,localhost,::1' },
      ...(CLI路径 ? { pathToClaudeCodeExecutable: CLI路径 } : {}),
    },
  });
  let 回答 = '';
  for await (const m of q) {
    if (m.type === 'assistant' && m.message && Array.isArray(m.message.content)) {
      for (const b of m.message.content) if (b.type === 'text' && b.text) 回答 += b.text;
    }
  }
  return 回答;
}

// ---- 席间存照（方案-席间存照-2026-08-29，五轮异厂评审 52 条击杀）----
// 路径仍是 /chat，只改显示名——名字是给人看的，路径是给机器用的，两者不必同步。
// 必须挂在旧群聊路由之前：express 先注册者胜，后面那条 /chat 就成了死路由。
// 传 台根 不是 数据根：线程在 监制台/遥控/thread.jsonl，而 数据根 是监制台的上一层
require('./server/routes/存照').挂(app, { 数据根: 台根 });

// 旧群聊页的 POST /api/chat 写口仍在（发言仍走它），但 GET /chat 已被上面顶掉。
require('./server/routes/群聊').挂(app, { origin: 监制台, 调用模型: 调用群聊模型 });

// ---- 文稿台（方案-文稿台-2026-08-31 · 批二：只读）----
//
// **根表在这里落地，不在 lib 里。**理由同 终端根 那段：「根在哪」在源码态与 portable exe 态
// 是两个不同的东西，而那正是 08-28 把 202 条数据写进 %TEMP% 的坑。lib 只管规则，
// 「哪些目录」这件事集中在本文件一处解决，改一处就够。
//
// 五个根由制作人 08-31 拍板：终端仓 / Ticketflow / TK / 工作室 / 记忆库。
// 工作室是**分区**的——这条规矩不是我发明的，是 studio.config.json 的项目注册表自己写的：
// 「静态区可写；工单目录/journal/台账等活存储禁写——runner 每拍读写它们，
//   并发写产生的状态错乱 git 也还原不回。」班次报告落在 终端/班次 下，一并进禁写。
const 文稿lib = require('./server/lib/文稿');
function 文稿根表() {
  // 深拷一份再改：默认表是模块级常量，直接改会跨请求污染
  const 表 = JSON.parse(JSON.stringify(文稿lib.默认根表));
  for (const r of 表) {
    // 记忆库路径含用户名，**不写死**——从 homedir 推
    if (r.键 === 'memory' && !r.路) r.路 = path.join(require('os').homedir(), '.claude', 'projects');
  }
  // <终端根>/文稿根.json 可整表覆盖（改文件热生效，照 班次.json 的成例）
  try {
    const 档 = path.join(终端根, '文稿根.json');
    if (fs.existsSync(档)) {
      const 覆 = JSON.parse(fs.readFileSync(档, 'utf8'));
      if (Array.isArray(覆.根表) && 覆.根表.length) return 覆.根表;
    }
  } catch (e) { /* 覆盖档坏了就用默认表，不让一个手改坏的 JSON 把整页打掉 */ }
  return 表;
}

// 列举要走 ~650 个文件的目录树。每次请求都走一遍在本机是可接受的（有目录级剪枝，
// TK 的 Library/PackageCache 根本不进），但翻文件时是连续几次请求，缓一下省得反复走盘。
// **只缓 8 秒**：你在 VS Code 里改完切回来，不该看见一份过期的列表。
let 文稿缓 = { 时: 0, 表: null };
const 记号缓 = new Map();     // 绝对路 → { 改于, 记 }，按 mtime 命中，没动过的文件不重读
function 文稿列举() {
  const 现在 = Date.now();
  if (文稿缓.表 && 现在 - 文稿缓.时 < 8000) return 文稿缓.表;
  // 排掉文稿台自己的工作目录——它就落在某个根里面，不排会把自己的版本历史当文档列出来
  const 根 = 文稿根表();
  const 表 = 文稿lib.列举(根, { 排除目录: [path.join(终端根, '文稿')] });
  // 顺便数一遍记号——「哪些文档在等我」是文件库最该有的那个筛选，
  // 而它只能靠读盘知道。实测 951 份里只扫可写的 453 份，约 46ms，之后走 mtime 缓存。
  try {
    const 根路 = {};
    for (const x of 根) if (x.路) 根路[x.键] = x.路;
    文稿lib.记号统计(表, 根路, 记号缓);
  } catch (e) { /* 数不出来不该让整个文件库打不开 */ }
  文稿缓 = { 时: 现在, 表 };
  return 表;
}
// 锁台落在 <终端根>/文稿/ 下。**锁必须在盘上**，不能只在内存里：
// 要挡住的三个写手里有两个不在这个进程内（坐席子进程、无人值守班次），
// 内存里的锁它们看不见。
const 文锁lib = require('./server/lib/文锁');
const 写手闸 = require('./server/lib/写手闸');
const 写闸lib = require('./server/lib/写闸');
const 文稿台 = 文锁lib.开台(path.join(终端根, '文稿'));
const 文稿令牌台 = 写闸lib.新令牌台();
require('./server/routes/文稿页').挂(app, {
  根表: 文稿根表,
  列举: 文稿列举,
  锁台: 文稿台,
  令牌台: 文稿令牌台,
  // 端口是 start() 之后才定的（4280 被占会顺延），所以这里传函数不传值——
  // 传值的话顺延一次 Origin 就再也对不上，写口从此全拒且看不出为什么
  自家: () => 写闸lib.自家们(实际端口 || 端口),
});

// ---- 三方互保（制作人 2026-08-29 03:29 拍板）----
// 环：塔 → 终端 → 监制台 → 塔。本进程负责其中两条边（终端 → 塔、终端 → 监制台）。
// 「看得见的那个去扶」——终端的监视页本来就在探这两个，能看见就该能扶。
//
// 三条闸在 lib/互保.js 里（先确认真死、退避上限、每次留痕），12 条判据顶着。
// 这里只管接线：多久探一次、扶谁、痕写哪。
const 互保 = require('./server/lib/互保');
const 互保痕 = path.join(台根, '瞭望塔', '互保.jsonl');
const 记互保 = (e) => {
  try {
    fs.mkdirSync(path.dirname(互保痕), { recursive: true });
    fs.appendFileSync(互保痕, JSON.stringify({ ...e, t: e.t || Date.now() }) + '\n', 'utf8');
  } catch { /* 记不下也不能拖垮互保本身 */ }
};

// 互保的两个目标：塔与监制台。
//
// **一律走各自的计划任务，不自己拼路径。** 首版两条都靠拼：
//   塔  ＝ __dirname/../Ticketflow/packages/watchtower/watchtower.js
//   监制台 ＝ 扫 台根 找「监制台 *.exe」再 .sort().reverse() 取第一个
// 两条都坏，坏法还不一样：
//   · 塔那条在 portable exe 里 __dirname 落进 asar，路径不存在 → existsSync 判否 →
//     **整个目标被静默丢掉**。08-29 实测：杀塔五分钟无人来扶，而 /api/mutual 只列得出监制台。
//   · 监制台那条用字符串排序取「最新」，一旦出现 0.9.x 就会排在 0.40.x 前面（同快捷方式脚本的坑）。
// 换成任务名以后：不依赖相对路径、不随换装失效、启动细节只在计划任务里存一份正本。
// 塔那侧的「塔 → 终端」用的也是这条绳（watchtower.js 的 巡守护），两边形制一致。
//
// 任务没注册怎么办？**照样把目标摆出来**，让 扶() 去撞 schtasks 的错并留痕。
// 首版那种「探不到就不列」是最坏的处理：屏上看不出少了一条边。
const 互保目标 = () => ([
  {
    键: '塔', 名: '瞭望塔',
    任务名: '瞭望塔',
    // 塔没有端口，只能靠 pid 文件判死
    pid文件: path.join(台根, '瞭望塔', 'watchtower.pid'),
  },
  {
    键: '监制台', 名: '监制台',
    任务名: '监制台',
    // 有端口，且必须认出身份（通不等于是它）
    端口: 4270, 探址: 'http://127.0.0.1:4270/api/version', 超时毫秒: 3000,
  },
]);

// 每 60 秒一轮。比心跳（30s）慢一倍——探得太勤只会在对方正常重启时误判。
setInterval(async () => {
  for (const 目 of 互保目标()) {
    try { await 互保.扶(目, { 记: 记互保 }); }
    catch (e) { 记互保({ 型: '互保异常', 目标: 目.键, 错: String((e && e.message) || e).slice(0, 160) }); }
  }
}, 60000).unref();

app.get('/api/mutual', (req, res) => {
  res.json({ 战果: 互保.今日战果(互保痕), 目标: 互保目标().map((x) => ({ 键: x.键, 名: x.名 })) });
});

// ---- 坐席名单（主页在座条要用）----
// 单一事实源是 server/lib/坐席.js。前端不许自己维护一份名单——
// 界面、@ 路由与调用层各存一份，正是那个文件头注开宗明义要避免的。
app.get('/api/seats', (req, res) => {
  const 坐席 = require('./server/lib/坐席');
  res.json({ 席: 坐席.全部.map((x) => ({ 名: x.名, 接模型: !!x.接模型, 人设: x.人设 || '' })) });
});

// ---- 监视页（方案-监视器归一与可视化-2026-08-29）----
// 采集不在这儿：瞭望塔独立进程收五路信源，终端只装窗户。
// 这条分工是方案第一节推出来的硬约束——采集要比任何会话活得久，呈现可以随会话来去。
// 塔根不是「终端根/瞭望塔」——瞭望塔的出口在**监制台部署区**下，与终端各自独立部署。
// 写这行时我第一版就写成了 终端根/瞭望塔，当场撞上评审那条「不变量乙：两处解析出的根必须一致」。
// 故：显式 env 优先 → 缺省指监制台部署区 → 两者都取不到时留空，界面会照实说「读不到」。
const 塔根 = process.env.WATCHTOWER_DIR
  || path.join(path.dirname(终端根), 'AI-GameStudio', '监制台', '瞭望塔');
require('./server/routes/监视').挂(app, {
  根: __dirname,
  塔根: fs.existsSync(塔根) ? 塔根 : path.join('D:', 'GitHub', 'AI-GameStudio', '监制台', '瞭望塔'),
  塔脚本: path.join(__dirname, '..', 'Ticketflow', 'packages', 'watchtower', 'watchtower.js'),
});

// ---- 写口：转发监制台动作 ----
// 终端不自己落账：写权在监制台，它有状态机与判据。这里只是遥控器。
app.post('/api/act/:name', (req, res) => {
  const 体 = JSON.stringify(req.body || {});
  const 路径 = '/api/act/' + encodeURIComponent(req.params.name);
  const r = http.request(监制台 + 路径, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(体) },
    timeout: 15000,
  }, (up) => {
    let s = '';
    up.on('data', (d) => { s += d; });
    up.on('end', () => {
      res.status(up.statusCode || 200);
      try { res.json(JSON.parse(s)); } catch { res.json({ ok: false, error: '监制台返回非 JSON' }); }
    });
  });
  r.on('error', (e) => res.status(502).json({ ok: false, error: '连不上监制台：' + (e.code || e.message) }));
  r.on('timeout', () => { r.destroy(); res.status(504).json({ ok: false, error: '监制台超时' }); });
  r.end(体);
});

// ---- 情报日报读口（M1b）----
// 终端读自己产的日报。**只读不算**：日报由 intel 管道产出并落盘，这里只呈现——
// 两处都能生成就会有两份不一样的日报。
// 本地日，**不能用 toISOString().slice(0,10)**——那是 UTC 日。
// 2026-08-28 02:2x 实测：日报文件是 2026-08-28.md，而读口按 UTC 算成 08-27，
// 回「今日无日报」。UTC+8 下每天 00:00–08:00 这八小时都会这样，而日报恰恰是早上看的。
// 出报侧（intel/run.js 的 今日()）用的就是本地日，两处必须同一把尺。
const 本地日 = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

app.get('/api/digest', (req, res) => {
  const 日 = String(req.query.日 || '').match(/^\d{4}-\d{2}-\d{2}$/)
    ? String(req.query.日) : 本地日();
  const 目 = path.join(终端根, 'data', 'digests');
  try {
    const md = fs.readFileSync(path.join(目, `${日}.md`), 'utf8');
    let 清单 = null;
    try { 清单 = JSON.parse(fs.readFileSync(path.join(目, `${日}.json`), 'utf8')); } catch { 清单 = null; }
    res.json({ 日, md, 清单 });
  } catch {
    // 没有当日报不是错误——列出最近几期让人跳过去，别给个空白（施工令 V1 空态纪律）
    let 近 = [];
    try {
      近 = fs.readdirSync(目).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3)).sort().reverse().slice(0, 7);
    } catch { 近 = []; }
    res.json({ 日, md: null, 无当日: true, 最近: 近 });
  }
});

// ---- 情报调度（M1b · P2）----
// 起服务即对一次班次表——**这就是「重启补跑」那一下**（过点未跑的班次补跑恰一次）。
// 用 STUDIO_NO_INTEL=1 关掉：判据起服务时不该顺手去抓真源。
function 起情报调度() {
  if (process.env.NO_INTEL === '1' || process.env.STUDIO_STUB === '1') return () => {};
  const { 起 } = require('./intel/scheduler');
  const { 抓, 出报 } = require('./intel/run');
  return 起(终端根, {
    执行: async (任务) => {
      const t0 = Date.now();
      if (任务.类 === '抓取') {
        const r = await 抓({ base: 终端根 });
        console.log(`[情报] ${任务.时刻} 抓取：落盘 ${r.落盘} 条 · ${((Date.now() - t0) / 1000).toFixed(0)}s`);
      } else if (任务.类 === '日报') {
        const r = await 出报({ base: 终端根, CLI: CLI路径, 模型: 'opus' });
        console.log(`[情报] ${任务.时刻} 日报：${r.条数} 条 · 精编 ${r.精编.成}/${r.精编.成 + r.精编.败} · ${((Date.now() - t0) / 1000).toFixed(0)}s`);
      }
    },
  });
}

// 起服务。返回真实端口——**不假设 4280 一定拿得到**：
// 端口被占时不该整个应用起不来（用户双击 exe 只会看到一个不开的窗，猜不出为什么）。
// 占用就顺延试下一个，把真端口回给壳去 loadURL。
function start(首选 = 端口) {
  return new Promise((resolve, reject) => {
    let 试 = 首选;
    const 挂 = () => {
      const srv = app.listen(试, '127.0.0.1', () => {
        // **写闸的 Origin 白名单要认这个真实端口。**4280 被占时下面那行会顺延，
        // 而写闸若按 端口 常量算自家 origin，顺延一次之后所有写请求都被判成外站——
        // 表现是「保存按钮点了没反应」，且理由是 403 Origin 不对，谁也想不到是端口顺延。
        实际端口 = 试;
        console.log(`坐席在 http://127.0.0.1:${试} · 监制台 ${监制台}`);
        // 情报调度随服务起。**不阻塞 resolve**——调度起不来不该让整个终端开不了窗
        try { 起情报调度(); } catch (e) { console.warn('[情报] 调度起不来：', e.message); }
        resolve({ port: 试, server: srv });
      });
      srv.on('error', (e) => {
        if (e.code === 'EADDRINUSE' && 试 < 首选 + 10) { 试 += 1; 挂(); }
        else reject(e);
      });
    };
    挂();
  });
}

// 坐席选项 也导出：文稿台占用闸挂在它的 hooks 上，而「闸有没有真的接上」
// 是这次验收里唯一缺的那条判据——外部可写() 曾经写好了、判据齐了、**零调用点**。
// 不导出的话这条判据就只能 grep 源码，那不算判据（H104）。
// 席档名/会话档于 导出是为了**够得着判据**：它们决定私聊的记忆落在哪个文件上，
// 而 H104 的口径是判据要验行为——不导出的话只能 grep 源码文本，那不算判据。
module.exports = { start, app, 坐席选项, 席档名, 会话档于, 会话档 };

// 直接 node server.js 跑时照常起（壳里走 start()，不重复挂）
if (require.main === module) start().catch((e) => { console.error('起不来：', e.message); process.exit(1); });
