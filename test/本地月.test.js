// 本地月.test.js — journal 档名的日期尺。
//
// 案发（2026-08-31 内部评审，距起火 15 分钟被查出）：
// `/api/events` 用 `new Date().toISOString().slice(0,7)` 拼 journal 档名，
// 而写侧 `Ticketflow/apps/studio/lib/journal.js:16` 用 `d.getMonth()+1` —— **本地月**。
// UTC+8 下，每月 1 号本地 00:00–07:59 对应 UTC 上个月最后一天，
// 于是读口去开上个月那份 log。
//
// **它不进「读不到」分支**：文件存在、读得通、行数正常。屏上是一栏照常滚动的事件
// 加一个正在跳的刷新钟，而这八小时里的任何告警一条都不会出现。08:00 自愈、不留痕、
// 事后复现不了。日错一天还能从「今天怎么这么静」察觉；月错八小时，正好压在夜班上。
'use strict';
const assert = require('node:assert');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const 读数 = require('../server/lib/读数');

// 写侧那把尺，原样抄一份在这里当对照物。抄是故意的：
// 判据要拿一个**独立写下的**期望去对，而不是把被测代码再调一次。
const 写侧月 = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

test('守① 本地月 与写侧那把尺逐日对齐（跨月两端各取一批时刻）', () => {
  const 样 = [];
  for (const [y, m] of [[2026, 0], [2026, 7], [2026, 8], [2026, 11], [2027, 0]]) {
    for (const [d, h] of [[1, 0], [1, 7], [1, 8], [1, 23], [15, 12], [28, 23]]) {
      样.push(new Date(y, m, d, h, 30));
    }
    样.push(new Date(y, m + 1, 0, 23, 30));   // 该月最后一天 23:30
  }
  for (const d of 样) {
    assert.strictEqual(读数.本地月(d), 写侧月(d), `${d.toString()} 两把尺不一样`);
  }
});

test('守② **在本机时区里真的构造出一个"UTC 月 ≠ 本地月"的时刻，并证明旧写法在那一刻错**', () => {
  const 偏 = new Date().getTimezoneOffset();   // 分钟，UTC 以西为正
  if (偏 === 0) {
    // UTC 本地就是 UTC，这个分歧在本机无从构造。**说出来，不要假装通过。**
    assert.ok(true, '本机在 UTC，构造不出分歧时刻；守① 已逐日比过两把尺');
    return;
  }
  // 东区（偏<0）：本地某月 1 号 00:30 落在 UTC 上个月
  // 西区（偏>0）：本地某月最后一天 23:30 落在 UTC 下个月
  const d = 偏 < 0 ? new Date(2026, 8, 1, 0, 30) : new Date(2026, 7, 31, 23, 30);
  const 本 = 读数.本地月(d);
  const U = d.toISOString().slice(0, 7);
  assert.strictEqual(本, 写侧月(d));
  assert.notStrictEqual(U, 本,
    `没构造出分歧（偏移 ${偏} 分）：UTC 月 ${U}、本地月 ${本}`);
  assert.strictEqual(本, 偏 < 0 ? '2026-09' : '2026-08');
});

test('守③ 本地月 只吃日期，不吃"现在"——不传参用现在，传参用那一刻', () => {
  assert.strictEqual(读数.本地月(new Date(2026, 0, 5)), '2026-01');
  assert.strictEqual(读数.本地月(), 写侧月(new Date()));
  assert.match(读数.本地月(), /^\d{4}-\d{2}$/);
});

// ── 端到端：/api/events 到底开了哪个文件 ────────────────────────

const 取 = (口, p) => new Promise((res, rej) => {
  http.get({ host: '127.0.0.1', port: 口, path: p }, (x) => {
    let b = ''; x.on('data', (d) => { b += d; });
    x.on('end', () => res({ 码: x.statusCode, 文: b }));
  }).on('error', rej);
});

test('守④ **/api/events 读的是本地月那一份**（造两份 log，看它开了哪个）', async (t) => {
  const 根 = fs.mkdtempSync(path.join(os.tmpdir(), 'ev-'));
  fs.mkdirSync(path.join(根, 'journal'), { recursive: true });
  const 行 = (日, 文) => `[${日} 03:49] ${文}\n`;

  // 造一个"本地月 ≠ UTC 月"的时刻；UTC 本机构造不出，那就退回验读的是本地月这一份
  const 偏 = new Date().getTimezoneOffset();
  const 此刻 = 偏 < 0 ? new Date(2026, 8, 1, 0, 30)
    : 偏 > 0 ? new Date(2026, 7, 31, 23, 30)
      : new Date(2026, 8, 1, 12, 0);
  const 本地 = 读数.本地月(此刻);
  const UTC = 此刻.toISOString().slice(0, 7);

  fs.writeFileSync(path.join(根, 'journal', `${本地}.log`),
    行(本地 + '-01', '这是本地月那一份 · 值守塔阵亡：连续 290 拍无在位回执'), 'utf8');
  if (UTC !== 本地) {
    fs.writeFileSync(path.join(根, 'journal', `${UTC}.log`),
      行(UTC + '-15', '这是 UTC 月那一份 · 上个月的旧事件'), 'utf8');
  }

  const 旧根 = process.env.STUDIO_ROOT;
  process.env.STUDIO_ROOT = 根;
  // Date 换成假钟：/api/events 在请求那一刻才取月份，所以这里换得掉
  t.mock.timers.enable({ apis: ['Date'], now: 此刻.getTime() });

  const { app } = require('../server.js');
  const s = await new Promise((r) => { const x = app.listen(0, '127.0.0.1', () => r(x)); });
  try {
    const 出 = await 取(s.address().port, '/api/events');
    assert.strictEqual(出.码, 200);
    const j = JSON.parse(出.文);
    const 全文 = JSON.stringify(j);
    assert.ok(全文.includes('本地月那一份'),
      `没读到本地月（${本地}）那一份。实得：${全文.slice(0, 300)}`);
    // **日期要真的发下来**（前端编不出「今天是哪天」，也编不出每一行是哪天的）。
    // 窗口是 600 行 ≈ 58 小时，只发 HH:MM 的话时刻在屏上会局部递减。
    assert.strictEqual(j.今日, 读数.本地日(此刻), '/api/events 没告诉前端今天是哪天');
    assert.ok(Array.isArray(j.事) && j.事.length, '没有事件');
    assert.match(String(j.事[0].日 || ''), /^\d{4}-\d{2}-\d{2}$/, '事件行没带日期：' + JSON.stringify(j.事[0]));
    assert.match(String(j.事[0].时 || ''), /^\d{2}:\d{2}$/);
    if (UTC !== 本地) {
      assert.ok(!全文.includes('UTC 月那一份'),
        `**读成了 UTC 月（${UTC}）那一份**——正是那八小时里屏上会显示的东西`);
    }
  } finally {
    t.mock.timers.reset();
    s.close();
    if (旧根 === undefined) delete process.env.STUDIO_ROOT; else process.env.STUDIO_ROOT = 旧根;
    fs.rmSync(根, { recursive: true, force: true });
  }
});

test('守⑤ 全库不许再出现拿 UTC 切片当本地日期用的读盘点', () => {
  // 这是**补充性的源码守卫**，不是主判据（主判据是守②与守④）。
  // 留它是因为下一次犯这个错的地方多半不在 /api/events —— 而那时守④照样绿。
  const 查 = [path.join(__dirname, '..', 'server.js')];
  const 目 = path.join(__dirname, '..', 'server');
  const 走 = (d) => {
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, f.name);
      if (f.isDirectory()) 走(p); else if (f.name.endsWith('.js')) 查.push(p);
    }
  };
  走(目);
  const 犯 = [];
  for (const p of 查) {
    const 文 = fs.readFileSync(p, 'utf8');
    文.split(/\r?\n/).forEach((l, i) => {
      if (l.trim().startsWith('//') || l.trim().startsWith('*')) return;   // 注释里在讲这件事，不算
      if (/toISOString\(\)\s*\.slice\(\s*0\s*,\s*(7|10)\s*\)/.test(l)) {
        犯.push(`${path.relative(path.join(__dirname, '..'), p)}:${i + 1}  ${l.trim()}`);
      }
    });
  }
  assert.deepStrictEqual(犯, [],
    '这些地方在拿 UTC 切片当本地日期：\n  ' + 犯.join('\n  ')
    + '\n（本地日/本地月 在 server/lib/读数.js）');
});
