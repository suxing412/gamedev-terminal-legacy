// 写口.test.js — 文稿台写口的端到端判据（2026-08-31 批三）
//
// 文锁.test.js 与 写闸.test.js 验的是**纯函数**，这一份验的是**接线**：
// 起真服务、走真 HTTP、改真文件。两者都过才算数——
// 闸的逻辑对、但中间件没挂上去，前两份判据照样全绿。
//
// **终端无鉴权、开机自启、整天开着**，而文稿台是它第一个写口。
// 所以前四条是攻击路径，不是功能：任何一条破了，任何网页都能改这台机器上的文件。
'use strict';
const assert = require('node:assert');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const 锁lib = require('../server/lib/文锁.js');

// ── 现搭一个根，**绝不碰真目录** ──────────────────────────────────
// 08-30 班次判据踩过：测试里的服务继承了 PORTABLE_EXECUTABLE_DIR，
// 报告写进了部署区，而清理用的是仓里的路径。所以这里把 TERMINAL_ROOT 钉死。
const 台根 = fs.mkdtempSync(path.join(os.tmpdir(), '写口测-'));
const 仓 = path.join(台根, '仓');
fs.mkdirSync(仓, { recursive: true });
const 档 = path.join(仓, '试稿.md');
const 原文 = '# 原标题\n\n原正文\n';

process.env.TERMINAL_ROOT = 台根;
process.env.NO_INTEL = '1';          // 不设的话情报调度会去抓真源，判据从 0.2 秒变 277 秒（08-30 实测）
fs.writeFileSync(path.join(台根, '文稿根.json'), JSON.stringify({
  根表: [{ 键: 'shi', 名: '试仓', 路: 仓, 写: true }],
}), 'utf8');

let 基; let 令; let 服务;

test.before(async () => {
  fs.writeFileSync(档, 原文, 'utf8');
  const r = await require('../server.js').start(4507);
  服务 = r.server;
  基 = 'http://127.0.0.1:' + r.port;
  const 页 = await (await fetch(基 + '/doc?r=shi&p=' + encodeURIComponent('试稿.md'))).text();
  令 = (页.match(/data-令="([^"]+)"/) || [])[1];
});

test.after(() => {
  if (服务) 服务.close();
  try { fs.rmSync(台根, { recursive: true, force: true }); } catch (e) { /* 清不掉不影响结论 */ }
});

const 发 = (路, 体, 头 = {}) => fetch(基 + 路, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: 基, 'X-Doc-Token': 令, ...头 },
  body: JSON.stringify(体),
});
const 复位 = () => fs.writeFileSync(档, 原文, 'utf8');

// ── 一、四条攻击路径 ───────────────────────────────────────────────

test('守① 页面下发写令牌（跨站读不到这一页，就拿不到令牌）', () => {
  assert.ok(令 && 令.length >= 20, '页面里没有写令牌：' + 令);
});

test('守② **text/plain 打不进来**——这是那条 no-cors 攻击的入口', async () => {
  // fetch(…, {mode:'no-cors', headers:{'Content-Type':'text/plain'}}) 是"简单请求"，
  // 不触发 CORS 预检，跨站脚本能直接发出去。**响应读不到，但写会发生。**
  复位();
  const r = await fetch(基 + '/api/doc/save', {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain', Origin: 基, 'X-Doc-Token': 令 },
    body: JSON.stringify({ r: 'shi', p: '试稿.md', 文: '被打穿了' }),
  });
  assert.strictEqual(r.status, 415, 'text/plain 被放行了');
  assert.strictEqual(fs.readFileSync(档, 'utf8'), 原文, '文件被改了');
});

test('守③ 外站 Origin 打不进来', async () => {
  复位();
  const r = await 发('/api/doc/save', { r: 'shi', p: '试稿.md', 文: '被打穿了' },
    { Origin: 'http://evil.example' });
  assert.strictEqual(r.status, 403);
  assert.strictEqual(fs.readFileSync(档, 'utf8'), 原文);
});

test('守④ 没有 Origin 也打不进来（不许"判不出来就放行"）', async () => {
  复位();
  // undici 允许显式清掉 Origin
  const r = await fetch(基 + '/api/doc/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Doc-Token': 令 },
    body: JSON.stringify({ r: 'shi', p: '试稿.md', 文: '被打穿了' }),
  });
  assert.strictEqual(r.status, 403, '缺 Origin 被放行了');
  assert.strictEqual(fs.readFileSync(档, 'utf8'), 原文);
});

test('守⑤ 假令牌打不进来', async () => {
  复位();
  const r = await 发('/api/doc/save', { r: 'shi', p: '试稿.md', 文: '被打穿了' },
    { 'X-Doc-Token': 'deadbeef' });
  assert.strictEqual(r.status, 403);
  assert.strictEqual(fs.readFileSync(档, 'utf8'), 原文);
});

test('守⑥ 越界路径打不进来（写口上这个洞是任意文件覆盖，不只是任意读）', async () => {
  const 外 = path.join(台根, '不该被碰.md');
  fs.writeFileSync(外, '外面的文件\n', 'utf8');
  for (const p of ['../不该被碰.md', 'C:/Windows/x.md', '子/../../不该被碰.md']) {
    const r = await 发('/api/doc/lock', { r: 'shi', p });
    assert.strictEqual(r.status, 400, `${p} 没被拦住`);
  }
  assert.strictEqual(fs.readFileSync(外, 'utf8'), '外面的文件\n');
});

// ── 二、正常流程 ───────────────────────────────────────────────────

test('守⑦ 取锁 → 存盘 → 出版本，每一步都对', async () => {
  复位();
  const l = await (await 发('/api/doc/lock', { r: 'shi', p: '试稿.md' })).json();
  assert.ok(l.行 && l.令牌, JSON.stringify(l));
  assert.strictEqual(l.文, 原文, '取锁没带回原文');
  assert.ok(l.指纹, '没带回指纹');

  const s = await (await 发('/api/doc/save', {
    r: 'shi', p: '试稿.md', 令牌: l.令牌, 文: '# 新标题\n\n新正文\n', 基指纹: l.指纹, 谁: '制作人',
  })).json();
  assert.ok(s.行, JSON.stringify(s));
  assert.strictEqual(fs.readFileSync(档, 'utf8'), '# 新标题\n\n新正文\n', '盘上没变');

  const v = await (await fetch(基 + '/api/doc/versions?r=shi&p=' + encodeURIComponent('试稿.md'))).json();
  assert.ok(v.版们.length >= 1, '存盘没产生版本');
  assert.strictEqual(v.版们[0].谁, '制作人', '版本没记住是谁写的');

  await 发('/api/doc/unlock', { r: 'shi', p: '试稿.md', 令牌: l.令牌 });
});

test('守⑧ 锁着时别人取不到；没有锁不许写', async () => {
  复位();
  const l = await (await 发('/api/doc/lock', { r: 'shi', p: '试稿.md' })).json();
  assert.strictEqual((await 发('/api/doc/lock', { r: 'shi', p: '试稿.md' })).status, 409);
  assert.strictEqual((await 发('/api/doc/save',
    { r: 'shi', p: '试稿.md', 令牌: '别人的', 文: 'x' })).status, 409);
  assert.strictEqual(fs.readFileSync(档, 'utf8'), 原文, '无锁写居然改动了文件');
  await 发('/api/doc/unlock', { r: 'shi', p: '试稿.md', 令牌: l.令牌 });
});

// ── 三、冲突三路（可行性卷的主击杀）────────────────────────────────

test('守⑨ **编辑期间盘上被改 → 拒写，并回三路（含 base 字节）**', async () => {
  // 击杀原文：三路合并要 base 的**字节**，而方案只存了哈希——
  // 于是「保留我的」那个按钮在数据模型里根本不存在。
  复位();
  const l = await (await 发('/api/doc/lock', { r: 'shi', p: '试稿.md' })).json();
  await 发('/api/doc/draft', {
    r: 'shi', p: '试稿.md', 令牌: l.令牌, 文: '# 我改了一半\n', 基文: l.文, 基指纹: l.指纹,
  });

  // 别人（坐席）在这期间改了盘上的文件
  fs.writeFileSync(档, '# 别人改过的\n', 'utf8');

  const r = await 发('/api/doc/save', {
    r: 'shi', p: '试稿.md', 令牌: l.令牌, 文: '# 我的版本\n', 基指纹: l.指纹,
  });
  assert.strictEqual(r.status, 409, '冲突时没拒写——那就是静默覆盖');
  const j = await r.json();
  assert.strictEqual(j.冲突, true);
  assert.strictEqual(j.盘上, '# 别人改过的\n', '没给出盘上那一版');
  assert.strictEqual(j.我的, '# 我的版本\n', '没给出我的那一版');
  assert.strictEqual(j.基文, 原文, '**base 的字节没回来——三路合并做不了**');
  assert.strictEqual(j.能三路, true);
  assert.strictEqual(fs.readFileSync(档, 'utf8'), '# 别人改过的\n', '冲突了却还是写了');

  await 发('/api/doc/unlock', { r: 'shi', p: '试稿.md', 令牌: l.令牌 });
});

test('守⑨b **存过一次盘之后再冲突，三路仍然给得出**', async () => {
  // 实测踩到：存盘成功后清草把 base 一起删了，第二次冲突的三路差异是空的，
  // 「保留我的」当场退化成盲覆盖——**而界面上看不出这个区别**（按钮还在，点了照样覆盖）。
  复位();
  const l = await (await 发('/api/doc/lock', { r: 'shi', p: '试稿.md' })).json();
  // 先正常存一次
  const s1 = await (await 发('/api/doc/save', {
    r: 'shi', p: '试稿.md', 令牌: l.令牌, 文: '# 第一次\n', 基指纹: l.指纹,
  })).json();
  assert.ok(s1.行, JSON.stringify(s1));

  // 别人改了盘上
  fs.writeFileSync(档, '# 别人又改了\n', 'utf8');

  const r = await 发('/api/doc/save', {
    r: 'shi', p: '试稿.md', 令牌: l.令牌, 文: '# 第二次\n', 基指纹: s1.指纹,
  });
  assert.strictEqual(r.status, 409);
  const j = await r.json();
  assert.strictEqual(j.能三路, true, '第二次冲突拿不到 base——三路差异会是空的');
  assert.strictEqual(j.基文, '# 第一次\n', '**base 应当是上一次存进去的那一版**：' + JSON.stringify(j.基文));
  await 发('/api/doc/unlock', { r: 'shi', p: '试稿.md', 令牌: l.令牌 });
});

test('守⑨c 存盘后重新取锁，不许把一份空草稿弹给人', async () => {
  复位();
  const l = await (await 发('/api/doc/lock', { r: 'shi', p: '试稿.md' })).json();
  await 发('/api/doc/save', { r: 'shi', p: '试稿.md', 令牌: l.令牌, 文: '# 存过了\n', 基指纹: l.指纹 });
  await 发('/api/doc/unlock', { r: 'shi', p: '试稿.md', 令牌: l.令牌 });
  const l2 = await (await 发('/api/doc/lock', { r: 'shi', p: '试稿.md' })).json();
  assert.strictEqual(l2.草稿, null, '存盘后只剩 base，却被当成一份草稿报上来了');
  await 发('/api/doc/unlock', { r: 'shi', p: '试稿.md', 令牌: l2.令牌 });
});

test('守⑨d **过时草稿要带着自己的基准回来**（否则载入它再存盘会静默盖掉别人的改动）', async () => {
  // 实测踩到：载入一份基于旧版的草稿之后，客户端拿的是**盘上当前**那一版当基准，
  // 于是存盘一路绿灯，把坐席在这期间加的一节直接盖掉——**连冲突框都不弹**，
  // 只在版本环里留了个尸首。基准必须跟着草稿走。
  复位();
  const l = await (await 发('/api/doc/lock', { r: 'shi', p: '试稿.md' })).json();
  await 发('/api/doc/draft', {
    r: 'shi', p: '试稿.md', 令牌: l.令牌, 文: '# 我的草稿\n', 基文: l.文, 基指纹: l.指纹,
  });
  await 发('/api/doc/unlock', { r: 'shi', p: '试稿.md', 令牌: l.令牌 });

  // 别人在这期间改了盘上
  fs.writeFileSync(档, '# 别人改的\n', 'utf8');

  const l2 = await (await 发('/api/doc/lock', { r: 'shi', p: '试稿.md' })).json();
  assert.ok(l2.草稿, '草稿没交回来');
  assert.strictEqual(l2.草稿.同源, false, '盘上变了却说草稿同源');
  assert.strictEqual(l2.草稿.基指纹, l.指纹, '**草稿自己的基准指纹没交回来**——载入后存盘会盲覆盖');
  assert.strictEqual(l2.草稿.基文, 原文, '草稿自己的基准字节没交回来，冲突时给不出三路');
  await 发('/api/doc/unlock', { r: 'shi', p: '试稿.md', 令牌: l2.令牌 });
});

test('守⑤b 令牌被挤掉之后，片段里能取到新的一枚（前端据此自动重试）', async () => {
  // 异厂评审 2026-08-31 把它当成攻击路径提出来（本机脚本刷 200 次占满令牌池），
  // 但实测**正常动线就够得着**：令牌台上限 200，每打开一份文档发一枚，
  // 库里有 948 份——「开着编辑器又去翻了两百份文件」会把编辑器那枚挤掉，
  // 表现是**存盘按了没反应（403 令牌无效）**，谁也想不到是因为翻文件翻多了。
  //
  // 服务端这边只保证一件事：**随时能再取到一枚**。前端拿它做一次自动重试。
  const 片 = await (await fetch(基 + '/doc?frag=1')).text();
  const 新令 = (片.match(/data-令="([^"]+)"/) || [])[1];
  assert.ok(新令 && 新令.length >= 20, '片段里取不到写令牌，前端就没法自愈：' + 片.slice(0, 120));
  assert.notStrictEqual(新令, 令, '每次应当是新的一枚');

  // 新令牌能用
  复位();
  const l = await (await fetch(基 + '/api/doc/lock', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 基, 'X-Doc-Token': 新令 },
    body: JSON.stringify({ r: 'shi', p: '试稿.md' }),
  })).json();
  assert.ok(l.行, '新取的令牌不管用：' + JSON.stringify(l));
  await 发('/api/doc/unlock', { r: 'shi', p: '试稿.md', 令牌: l.令牌 });
});

test('守⑨e **冲突时先把盘上那版存进版本环**——不然「保留我的」的承诺每次都是假的', async () => {
  // 复核给出的推论比原指控更强：要走进 /api/doc/save 必须先过 可写() 令牌校验，
  // 制作人握锁期间别人拿不到第二枚令牌——**所以 409 被触发，等价于
  // 「盘上那次写入没走写口」，等价于「它必然不在版本环里」。**
  // 不是有时假，是每一次弹出那个框，「盘上那版仍会留在版本历史里」都是假的。
  复位();
  const l = await (await 发('/api/doc/lock', { r: 'shi', p: '试稿.md' })).json();
  fs.writeFileSync(档, '# 坐席直接改的\n', 'utf8');   // 不走写口的写入 = 冲突的唯一来源

  const r = await 发('/api/doc/save', {
    r: 'shi', p: '试稿.md', 令牌: l.令牌, 文: '# 我的\n', 基指纹: l.指纹,
  });
  assert.strictEqual(r.status, 409);
  const j = await r.json();
  assert.strictEqual(j.已存版, true, '冲突时没把盘上那版存进版本环——那句承诺就是假的');

  const v = await (await fetch(基 + '/api/doc/versions?r=shi&p=' + encodeURIComponent('试稿.md'))).json();
  const 那版 = (v.版们 || []).find((x) => /外部写入/.test(x.谁));
  assert.ok(那版, '版本环里找不到「盘上原版」：' + JSON.stringify(v.版们));
  const 文 = await (await fetch(基 + '/api/doc/version?r=shi&p=' + encodeURIComponent('试稿.md') + '&v=' + encodeURIComponent(那版.档))).json();
  assert.strictEqual(文.文, '# 坐席直接改的\n', '存进去的不是被覆盖的那一版');

  await 发('/api/doc/unlock', { r: 'shi', p: '试稿.md', 令牌: l.令牌 });
});

test('守⑨f 能三路 要**验过 base 确实是本次基准**，不是只判非空', async () => {
  // 首版 `能三路: !!(草.有 && 草.基文 != null)`。base 可能停在两代之前，
  // 于是前端那条「取不到 base，保留我的是盲覆盖，慎用」的警告
  // 被一个假的 true 抑制掉——**这个 bug 精准绕开了系统为它准备的提示牌**。
  复位();
  const l = await (await 发('/api/doc/lock', { r: 'shi', p: '试稿.md' })).json();
  await 发('/api/doc/draft', {
    r: 'shi', p: '试稿.md', 令牌: l.令牌, 文: '改了一半', 基文: l.文, 基指纹: l.指纹,
  });
  fs.writeFileSync(档, '# 别人改的\n', 'utf8');

  // 基准对得上 → 能三路 该为 true
  const a = await (await 发('/api/doc/save', {
    r: 'shi', p: '试稿.md', 令牌: l.令牌, 文: '# 我的\n', 基指纹: l.指纹,
  })).json();
  assert.strictEqual(a.能三路, true, '基准明明对得上却说给不出三路');
  assert.strictEqual(a.基文, 原文);

  // 基准对不上（谎报一个别的指纹）→ 能三路 必须为 false，base 也不许交出去
  const b = await (await 发('/api/doc/save', {
    r: 'shi', p: '试稿.md', 令牌: l.令牌, 文: '# 我的\n', 基指纹: '对不上的指纹',
  })).json();
  assert.strictEqual(b.能三路, false, 'base 与本次基准对不上，却仍标 能三路=true');
  assert.strictEqual(b.基文, null, '交出了一份对不上的 base，差异会指着错的地方');

  await 发('/api/doc/unlock', { r: 'shi', p: '试稿.md', 令牌: l.令牌 });
});

test('守⑨g **基指纹为空要更严，不是放行**', async () => {
  // 首版 `if (基纹 && 基纹 !== 盘纹)`——基指纹为空就整段跳过冲突比对，
  // 不经前端的调用方一次静默全覆盖。缺基准该是「更要拦」，不是「不用拦」。
  复位();
  const l = await (await 发('/api/doc/lock', { r: 'shi', p: '试稿.md' })).json();
  const r = await 发('/api/doc/save', { r: 'shi', p: '试稿.md', 令牌: l.令牌, 文: '# 无基准全覆盖\n' });
  assert.strictEqual(r.status, 409, '不带基指纹的写被放行了——那是一次静默全覆盖');
  assert.strictEqual(fs.readFileSync(档, 'utf8'), 原文, '文件被改了');
  await 发('/api/doc/unlock', { r: 'shi', p: '试稿.md', 令牌: l.令牌 });
});

test('守⑨h 「丢掉我的」之前能把我那版留成一条后路', async () => {
  复位();
  const l = await (await 发('/api/doc/lock', { r: 'shi', p: '试稿.md' })).json();
  const k = await (await 发('/api/doc/version-keep', {
    r: 'shi', p: '试稿.md', 令牌: l.令牌, 文: '# 我被丢掉的那版\n', 谁: '冲突时丢弃的我的版',
  })).json();
  assert.ok(k.行, JSON.stringify(k));
  const v = await (await fetch(基 + '/api/doc/versions?r=shi&p=' + encodeURIComponent('试稿.md'))).json();
  assert.ok((v.版们 || []).some((x) => /丢弃/.test(x.谁)), '丢掉的那版没进版本环：' + JSON.stringify(v.版们));
  // **这个口也要过锁**：没锁的人不能往版本环里塞东西
  await 发('/api/doc/unlock', { r: 'shi', p: '试稿.md', 令牌: l.令牌 });
  const 无锁 = await 发('/api/doc/version-keep', { r: 'shi', p: '试稿.md', 令牌: '假的', 文: 'x' });
  assert.strictEqual(无锁.status, 409, '没有锁也能往版本环里写');
});

// ── 四、锁要能被另一个进程看见（它落盘的全部理由）──────────────────

test('守⑩ 锁在盘上，坐席与 hook 读得到', async () => {
  复位();
  const l = await (await 发('/api/doc/lock', { r: 'shi', p: '试稿.md' })).json();
  // 另开一个台读同一个目录——模拟坐席子进程/PreToolUse hook
  const 外台 = 锁lib.开台(path.join(台根, '文稿'));
  const 外 = 外台.外部可写(档, [{ 键: 'shi', 路: 仓 }]);
  assert.strictEqual(外.行, false, '另一个进程看不见这把锁——那锁就等于没有');
  await 发('/api/doc/unlock', { r: 'shi', p: '试稿.md', 令牌: l.令牌 });
  assert.strictEqual(外台.外部可写(档, [{ 键: 'shi', 路: 仓 }]).行, true, '解锁后仍拦着');
});

test('守⑪ 解锁请求进人闸队列，并带等待时长', async () => {
  复位();
  const l = await (await 发('/api/doc/lock', { r: 'shi', p: '试稿.md' })).json();
  const 外台 = 锁lib.开台(path.join(台根, '文稿'));
  外台.请求解锁('shi', '试稿.md', '总监', '夜间巡检要改这份', Date.now() - 3600000);

  const g = await (await fetch(基 + '/api/gates')).json();
  const 我的 = (g.债 || []).find((d) => d.落点 === '文稿台');
  assert.ok(我的, '解锁请求没进人闸队列：' + JSON.stringify(g).slice(0, 200));
  assert.ok(/总监/.test(我的.摘要), 我的.摘要);
  assert.ok(我的.停摆小时 >= 0.9, '等待时长不对：' + 我的.停摆小时);

  await 发('/api/doc/unlock', { r: 'shi', p: '试稿.md', 令牌: l.令牌 });
  const g2 = await (await fetch(基 + '/api/gates')).json();
  assert.ok(!(g2.债 || []).some((d) => d.落点 === '文稿台'), '解锁后请求还挂在队列上');
});

// ── 四点五、**占用闸真的接上了没有** ──────────────────────────────
//
// 这是这次验收里唯一缺的那条判据。外部可写() 曾经写好了、判据齐了、
// 而生产代码**零调用点**——判据全绿是因为判据自己直接调那个函数。
// 所以这里不验那个函数，验的是**它有没有被挂到坐席身上**。

test('守⑯ 坐席的 PreToolUse 闸挂上了，且写锁着的文件会被拒', async () => {
  复位();
  const { 坐席选项 } = require('../server.js');
  const 选 = 坐席选项({});
  assert.ok(选.hooks && 选.hooks.PreToolUse && 选.hooks.PreToolUse[0]
    && typeof 选.hooks.PreToolUse[0].hooks[0] === 'function',
  '坐席选项 里没有 PreToolUse 闸——外部可写() 又变成零调用点了');
  const 闸 = 选.hooks.PreToolUse[0].hooks[0];

  // 没锁时放行
  const 前 = await 闸({ tool_name: 'Edit', tool_input: { file_path: 档 } }, 'x', {});
  assert.notStrictEqual((前.hookSpecificOutput || {}).permissionDecision, 'deny', '没锁却拦了');

  // 上锁之后必须拒
  const l = await (await 发('/api/doc/lock', { r: 'shi', p: '试稿.md' })).json();
  assert.ok(l.行, JSON.stringify(l));
  const 后 = await 闸({ tool_name: 'Edit', tool_input: { file_path: 档 } }, 'x', {});
  assert.strictEqual((后.hookSpecificOutput || {}).permissionDecision, 'deny',
    '锁着却放行了——那道「硬闸」又成了摆设');
  assert.ok(/文稿台|正在编辑|被拦下/.test((后.hookSpecificOutput || {}).permissionDecisionReason || ''),
    '拒绝理由没说清为什么：' + JSON.stringify(后));

  // 读不许被拦
  const 读 = await 闸({ tool_name: 'Read', tool_input: { file_path: 档 } }, 'x', {});
  assert.notStrictEqual((读.hookSpecificOutput || {}).permissionDecision, 'deny', 'Read 被误拦了');

  await 发('/api/doc/unlock', { r: 'shi', p: '试稿.md', 令牌: l.令牌 });
});

test('守⑰ 被闸拦下时**要在制作人屏上留痕**（进人闸队列，不是静默拒绝）', async () => {
  // 坐席被挡了而屏上没有任何痕迹的话，制作人永远不知道该去解那把锁——
  // 那等于把一次「等你一下」变成了一次「它自己不干活」。
  复位();
  const { 坐席选项 } = require('../server.js');
  const 闸 = 坐席选项({}).hooks.PreToolUse[0].hooks[0];
  const l = await (await 发('/api/doc/lock', { r: 'shi', p: '试稿.md' })).json();

  await 闸({ tool_name: 'Write', tool_input: { file_path: 档 } }, 'x', {});

  const g = await (await fetch(基 + '/api/gates')).json();
  const 我的 = (g.债 || []).find((d) => d.落点 === '文稿台');
  assert.ok(我的, '被闸拦下之后人闸队列里没有任何痕迹：' + JSON.stringify(g).slice(0, 200));
  assert.ok(/总监/.test(我的.摘要), 我的.摘要);

  await 发('/api/doc/unlock', { r: 'shi', p: '试稿.md', 令牌: l.令牌 });
});

// ── 五、写盘的三件事 ───────────────────────────────────────────────

test('守⑫ 换行风格照原样还原（写错会让 547 行全变改动行）', async () => {
  const crlf档 = path.join(仓, 'crlf.md');
  fs.writeFileSync(crlf档, '一\r\n二\r\n', 'utf8');
  const l = await (await 发('/api/doc/lock', { r: 'shi', p: 'crlf.md' })).json();
  assert.strictEqual(l.换行, 'crlf');
  assert.ok(!l.文.includes('\r'), '交给前端的文还带着 \\r');
  await 发('/api/doc/save', { r: 'shi', p: 'crlf.md', 令牌: l.令牌, 文: '一\n二\n三\n', 基指纹: l.指纹 });
  const 回 = fs.readFileSync(crlf档, 'utf8');
  assert.ok(回.includes('\r\n') && !/[^\r]\n/.test(回), 'CRLF 没还原：' + JSON.stringify(回));
  await 发('/api/doc/unlock', { r: 'shi', p: 'crlf.md', 令牌: l.令牌 });
});

test('守⑬ BOM 照原样还原', async () => {
  const bom档 = path.join(仓, 'bom.md');
  fs.writeFileSync(bom档, '\uFEFF# 题\n', 'utf8');
  const l = await (await 发('/api/doc/lock', { r: 'shi', p: 'bom.md' })).json();
  assert.strictEqual(l.有BOM, true);
  assert.ok(!l.文.startsWith('\uFEFF'), '交给前端的文还带着 BOM');
  await 发('/api/doc/save', { r: 'shi', p: 'bom.md', 令牌: l.令牌, 文: '# 新题\n', 基指纹: l.指纹 });
  assert.ok(fs.readFileSync(bom档, 'utf8').startsWith('\uFEFF'), 'BOM 丢了');
  await 发('/api/doc/unlock', { r: 'shi', p: 'bom.md', 令牌: l.令牌 });
});

test('守⑭ 写完不留 .tmp 残留（原子写）', async () => {
  复位();
  const l = await (await 发('/api/doc/lock', { r: 'shi', p: '试稿.md' })).json();
  await 发('/api/doc/save', { r: 'shi', p: '试稿.md', 令牌: l.令牌, 文: 'x\n', 基指纹: l.指纹 });
  const 剩 = fs.readdirSync(仓).filter((f) => f.includes('.tmp'));
  assert.deepStrictEqual(剩, [], '留下了临时文件：' + 剩.join(','));
  await 发('/api/doc/unlock', { r: 'shi', p: '试稿.md', 令牌: l.令牌 });
});

// ── 六、只读区一律不给写 ───────────────────────────────────────────

test('守⑮ 只读根 / 活存储区取不到锁（编辑按钮之前就该拦住）', async () => {
  // 活存储禁写不是我发明的规矩，是 studio.config.json 的注册表自己写的：
  // 「runner 每拍读写它们，并发写产生的状态错乱 git 也还原不回。」
  fs.writeFileSync(path.join(台根, '文稿根.json'), JSON.stringify({
    根表: [
      { 键: 'ro', 名: '只读仓', 路: 仓, 写: false },
      { 键: 'fen', 名: '分区仓', 路: 仓, 写: '分区', 禁写: ['活区'] },
    ],
  }), 'utf8');
  fs.mkdirSync(path.join(仓, '活区'), { recursive: true });
  fs.writeFileSync(path.join(仓, '活区', '别碰.md'), 'no\n', 'utf8');
  await new Promise((r) => setTimeout(r, 20));

  assert.strictEqual((await 发('/api/doc/lock', { r: 'ro', p: '试稿.md' })).status, 403, '只读根给写了');
  assert.strictEqual((await 发('/api/doc/lock', { r: 'fen', p: '活区/别碰.md' })).status, 403, '活存储给写了');
  assert.strictEqual((await 发('/api/doc/lock', { r: 'fen', p: '试稿.md' })).status, 200, '静态区反而不给写');
  assert.strictEqual(fs.readFileSync(path.join(仓, '活区', '别碰.md'), 'utf8'), 'no\n');
});
