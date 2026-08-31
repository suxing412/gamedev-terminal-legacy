// 互保.test.js — 三方互保的判据。
//
// 这套东西装错了会自己把系统搞坏（无限重启、端口撞车、静默崩十次），
// 所以三条闸每条都要有判据顶着：
//   闸一 · 先确认真死了再扶 —— 端口有人听就绝不动手，哪怕它不应答
//   闸二 · 退避 + 上限 —— 连三次不成就停手
//   闸三 · 每次扶都留痕 —— 自动重启而不报告，比手动重启加告警更坏
'use strict';
const assert = require('node:assert');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const 互保 = require('../server/lib/互保');

const 记盒 = () => { const a = []; return { 记: (e) => a.push(e), 事: a }; };
const 假目标 = (o = {}) => Object.assign({
  键: 'X',
  命令: process.execPath,
  参数: ['-e', 'setTimeout(()=>{},50)'],
  工作目录: os.tmpdir(),
}, o);

// ── 闸一 · 先确认真死了再扶 ─────────────────────────────────────
test('闸一① 端口有人听且应答 → 判活着，不动手', async () => {
  const s = http.createServer((q, r) => { r.writeHead(200); r.end('{}'); });
  await new Promise((k) => s.listen(0, '127.0.0.1', k));
  const 口 = s.address().port;
  try {
    const 盒 = 记盒();
    const r = await 互保.扶(假目标({ 端口: 口, 探址: 'http://127.0.0.1:' + 口 + '/' }), { 记: 盒.记 });
    assert.equal(r.动手, false);
    assert.equal(盒.事.length, 0, '没死就不该留痕');
  } finally { s.close(); }
});

test('闸一② 端口有人听但不应答 → **仍然不动手**（卡住不等于死，起第二个会撞端口）', async () => {
  // 一个只监听不回应的 socket：连得上，但永远不给响应
  const s = http.createServer(() => { /* 故意不响应 */ });
  await new Promise((k) => s.listen(0, '127.0.0.1', k));
  const 口 = s.address().port;
  try {
    const 盒 = 记盒();
    const r = await 互保.扶(假目标({ 端口: 口, 探址: 'http://127.0.0.1:' + 口 + '/', 超时毫秒: 600 }), { 记: 盒.记 });
    assert.equal(r.动手, false, '端口撞车会让两个实例都废——宁可不扶');
    assert.match(r.因, /卡住|不应答/);
  } finally { s.close(); }
});

test('闸一③ pid 文件里的进程还活着 → 不动手', async () => {
  const 根 = fs.mkdtempSync(path.join(os.tmpdir(), 'hb-'));
  const p = path.join(根, 'x.pid');
  fs.writeFileSync(p, JSON.stringify({ pid: process.pid }), 'utf8');
  const r = await 互保.扶(假目标({ 键: 'P1', pid文件: p }), {});
  assert.equal(r.动手, false);
  assert.match(r.因, /还在/);
});

test('闸一④ 端口空 + pid 不在 → 判死，动手', async () => {
  const 根 = fs.mkdtempSync(path.join(os.tmpdir(), 'hb2-'));
  const p = path.join(根, 'x.pid');
  fs.writeFileSync(p, JSON.stringify({ pid: 999999 }), 'utf8');
  const 盒 = 记盒();
  const r = await 互保.扶(假目标({ 键: 'D1', 端口: 59999, pid文件: p }), { 记: 盒.记 });
  assert.equal(r.动手, true);
  assert.ok(盒.事.some((e) => e.型 === '拉起'), '动了手就必须留痕');
});

// ── 计划任务这条绳 ────────────────────────────────────────────
//
// 08-29 04:5x 的账：互保原先靠 __dirname/../Ticketflow/... 拼塔的脚本路径。
// 源码态对，装成 portable exe 后 __dirname 在 asar 里、路径不存在，
// 于是 互保目标() 的 existsSync 判否，**塔这个目标被静默丢掉**——
// 环上少了一整条边，/api/mutual 与屏上都毫无异样。实测杀塔五分钟无人来扶。
// 改走计划任务后不再有任何相对路径。下面两条盯住「真的走了这条绳」。
test('绳① 有 任务名 就走计划任务；任务不在册要报错留痕，不许静默', async () => {
  互保.态.delete('T1');
  const 盒 = 记盒();
  const 目 = 假目标({ 键: 'T1', 端口: 59994, 任务名: '互保判据-绝不存在的任务-' + process.pid });
  const r = await 互保.扶(目, { 记: 盒.记 });
  assert.equal(r.动手, false, '任务不在册就该判失败');
  assert.match(String(r.错 || r.因), /schtasks/, '走的必须是 schtasks 那条路');
  assert.ok(盒.事.some((e) => e.型 === '拉起'), '动了手就要留痕');
  assert.ok(盒.事.some((e) => e.型 === '拉起失败'), '拉不起来不许静默——静默正是本次要修的病');
});

test('绳② 任务名 压过 命令——不许因为 命令 恰好能跑就报成功', async () => {
  互保.态.delete('T2');
  // 假目标 的 命令 是 process.execPath，spawn 必定成功。
  // 实现若走错分支去 spawn，动手就会是 true——这条判据正是要抓这个。
  const 目 = 假目标({ 键: 'T2', 端口: 59993, 任务名: '互保判据-绝不存在-' + process.pid });
  const r = await 互保.扶(目, {});
  assert.equal(r.动手, false, '走了 命令 分支就说明 任务名 没被优先');
});

test('绳④ /api/mutual 必须**无条件**列出塔与监制台——探不到就不列是最坏的处理', async () => {
  // 这一条盯的正是 08-29 那个病本身：首版 互保目标() 用 existsSync 决定要不要把目标摆出来，
  // 于是 exe 里塔那条路径不存在 → 目标消失 → 环上少一条边，而屏上一切正常。
  // 现在两个目标恒在；任务没注册就让 扶() 去撞 schtasks 的错并留痕，**错要看得见，不能没有**。
  const { start } = require('../server');
  const r = await start();
  try {
    const x = await new Promise((res, rej) => {
      http.get({ host: '127.0.0.1', port: r.port, path: '/api/mutual' }, (up) => {
        let s = ''; up.setEncoding('utf8');
        up.on('data', (d) => { s += d; });
        up.on('end', () => res({ 码: up.statusCode, 文: s }));
      }).on('error', rej);
    });
    assert.equal(x.码, 200);
    const j = JSON.parse(x.文);
    const 键们 = (j.目标 || []).map((t) => t.键).sort();
    assert.deepEqual(键们, ['塔', '监制台'].sort(), `两个目标必须都在，实得 ${JSON.stringify(键们)}`);
  } finally { if (r.server) r.server.close(); }
});

test('绳③ 中文任务名过 cmd 不许被 GBK 化（同 自启.js 那条坑）', () => {
  const r = 互保.跑('schtasks /Query /TN "瞭望塔" /FO LIST');
  // 塔的任务本机确实注册着；名字要是被编码坏了，schtasks 会说找不到
  assert.equal(r.码, 0, '查不到「瞭望塔」任务：' + String(r.出).slice(0, 160));
  assert.ok(!/�/.test(r.出), '出现替换字符 U+FFFD 就是 GBK 化的铁证');
});

// ── 闸二 · 退避 + 上限 ─────────────────────────────────────────
test('闸二① 退避：刚拉过就再判死，不许立刻再拉', async () => {
  互保.态.delete('B1');
  const 目 = 假目标({ 键: 'B1', 端口: 59998 });
  const t0 = 1000000;
  const a = await 互保.扶(目, { 现在: t0 });
  assert.equal(a.动手, true);
  const b = await 互保.扶(目, { 现在: t0 + 5000 });     // 5 秒后
  assert.equal(b.动手, false);
  assert.match(b.因, /退避中/);
  const c = await 互保.扶(目, { 现在: t0 + 31000 });    // 过了 30 秒
  assert.equal(c.动手, true, '退避到点应当再拉一次');
});

test('闸二② 上限：连三次不成就停手，并把末错留下', async () => {
  互保.态.delete('B2');
  const 目 = 假目标({ 键: 'B2', 端口: 59997, 命令: 'D:\\绝对不存在\\没有这个.exe' });
  const 盒 = 记盒();
  let t = 2000000;
  for (const 等 of [0, 31000, 121000]) {
    t += 等;
    await 互保.扶(目, { 现在: t, 记: 盒.记 });
  }
  const 后 = await 互保.扶(目, { 现在: t + 999999, 记: 盒.记 });
  assert.equal(后.动手, false);
  assert.equal(后.停手, true, '第四次必须停手——起不来的东西会被无限重启');
  assert.ok(盒.事.some((e) => e.型 === '停手'));
  assert.ok(盒.事.some((e) => e.型 === '拉起失败'), '拉不起来要记错，不许静默');
});

test('闸二③ 目标活过来了 → 计数清零，下次死了重新从第一次算', async () => {
  互保.态.delete('B3');
  const s = http.createServer((q, r) => { r.writeHead(200); r.end('{}'); });
  await new Promise((k) => s.listen(0, '127.0.0.1', k));
  const 口 = s.address().port;
  try {
    await 互保.扶(假目标({ 键: 'B3', 端口: 59996 }), { 现在: 3000000 });
    assert.equal(互保.态.get('B3').次数, 1);
    const 盒 = 记盒();
    await 互保.扶(假目标({ 键: 'B3', 端口: 口, 探址: 'http://127.0.0.1:' + 口 + '/' }), { 现在: 3000001, 记: 盒.记 });
    assert.equal(互保.态.get('B3').次数, 0, '活过来就清零');
    assert.ok(盒.事.some((e) => e.型 === '复活'), '复活也要留痕——不然只看得见死不看得见活');
  } finally { s.close(); }
});

// ── 闸三 · 留痕与上屏 ─────────────────────────────────────────
test('闸三① 今日战果按目标归集，供上屏', () => {
  const 根 = fs.mkdtempSync(path.join(os.tmpdir(), 'hb3-'));
  const p = path.join(根, '互保.jsonl');
  const 今 = Date.now();
  const 昨 = 今 - 26 * 3600 * 1000;
  fs.writeFileSync(p, [
    JSON.stringify({ 型: '拉起', 目标: '塔', t: 今 }),
    JSON.stringify({ 型: '拉起', 目标: '塔', t: 今 }),
    JSON.stringify({ 型: '拉起失败', 目标: '塔', t: 今 }),
    JSON.stringify({ 型: '拉起', 目标: '监制台', t: 今 }),
    JSON.stringify({ 型: '拉起', 目标: '塔', t: 昨 }),      // 昨天的不算
  ].join('\n') + '\n', 'utf8');
  const r = 互保.今日战果(p, 今);
  assert.equal(r.读到, true);
  const 塔 = r.各目标.find((x) => x.目标 === '塔');
  assert.equal(塔.拉起, 2, '昨天那次不该算进今日');
  assert.equal(塔.失败, 1);
  assert.equal(r.各目标.find((x) => x.目标 === '监制台').拉起, 1);
});

test('闸三② 没有留痕文件 → 说读不到，不报「今日 0 次」', () => {
  const r = 互保.今日战果(path.join(os.tmpdir(), '绝不存在-' + Date.now() + '.jsonl'));
  assert.equal(r.读到, false);
  assert.ok(!r.各目标, '「没记录」与「今天没崩过」是两回事，不许混');
});

test('闸三③ 留痕坏行要计数不吞', () => {
  const 根 = fs.mkdtempSync(path.join(os.tmpdir(), 'hb4-'));
  const p = path.join(根, '互保.jsonl');
  fs.writeFileSync(p, JSON.stringify({ 型: '拉起', 目标: '塔', t: Date.now() }) + '\n{坏行\n', 'utf8');
  const r = 互保.今日战果(p);
  assert.equal(r.坏行, 1);
  assert.equal(r.各目标[0].拉起, 1, '坏行不影响好行');
});

// ── 探测基元 ────────────────────────────────────────────────
test('端口占用判得准', async () => {
  const s = http.createServer(() => {});
  await new Promise((k) => s.listen(0, '127.0.0.1', k));
  const 口 = s.address().port;
  try {
    // **端口占用 现在是异步的**（试绑，不再起 cmd.exe 跑 netstat）。
    assert.equal(await 互保.端口占用(口), true);
    assert.equal(await 互保.端口占用(59995), false);
    // 非法值不许当成「占着」——那会让互保永远不敢扶
    assert.equal(await 互保.端口占用(0), false);
    assert.equal(await 互保.端口占用('不是数'), false);
  } finally { s.close(); }
});

test('进程在：自己在、假 pid 不在、非法值不在', () => {
  assert.equal(互保.进程在(process.pid), true);
  assert.equal(互保.进程在(999999), false);
  assert.equal(互保.进程在(null), false);
  assert.equal(互保.进程在('abc'), false);
  assert.equal(互保.进程在(-1), false);
});
