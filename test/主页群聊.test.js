// 主页群聊.test.js — 主页面即群聊（2026-08-29 制作人拍板）。
//
// 案发：制作人打开终端，「主页面没有群聊窗口」「点进任何一张阅读页就回不去主页」。
// 后一条尤其难看——那个缺陷是我自己查出来的、在设计稿里画了修法、**然后没写进代码**。
// 画了没做，欠了一天。本文件的第一条判据就是为那件事立的。
'use strict';
const assert = require('node:assert');
const test = require('node:test');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const 取 = (口, p) => new Promise((res) => {
  http.get(`http://127.0.0.1:${口}${p}`, (x) => {
    let b = ''; x.on('data', (d) => { b += d; });
    x.on('end', () => res({ 码: x.statusCode, 文: b }));
  }).on('error', (e) => res({ 码: 0, 文: String(e.message) }));
});

test('阅读页四张都给得出回主页的路（进得去出不来等于把人关在里面）', async () => {
  const { 头 } = require('../server/render/页');
  for (const 当前 of ['digest', 'stream', 'watch', 'chat']) {
    const h = 头({ 当前, 日: '2026-08-29', 标题: '情报' });
    assert.ok(h.includes('href="/"'), `${当前} 页缺回主页的链接`);
    assert.ok(h.includes('主页'), `${当前} 页的回程链接要有看得懂的名字`);
  }
});

test('回主页那颗不是第五个页签（是出口，不是切换）', () => {
  const { 头 } = require('../server/render/页');
  const h = 头({ 当前: 'digest', 日: '2026-08-29' });
  assert.match(h, /class="tab back"/, '要有独立的类，样式上才能与页签区分');
  assert.ok(h.indexOf('href="/"') < h.indexOf('日报'), '出口排在四个页签之前');
});

test('主页有在座的地方，且名单不写死在前端', () => {
  // 2026-09-02 批五：那条一行的「在座条」换成了对话页右边的「在座栏」——
  // 一行只装得下名字，一栏才装得下每一席管什么（人设那句是 /api/seats 的真字段）。
  // **这条判据盯的性质没变**：这屋里有谁得不用点就看得见，且名单只有一处事实源。
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  assert.match(html, /id="座栏"/, '主页要有在座栏——这屋里有谁得不用点就看得见');
  assert.match(html, /id="座组"/);
  // 八个席位名一个都不许出现在 HTML 里：名单归 server/lib/坐席.js，经 /api/seats 下发
  for (const 名 of ['助理', '终端项管', '情报主管', '财务', '市场', '营销']) {
    assert.ok(!html.includes('>' + 名 + '<'), `席位名「${名}」不许写死在 HTML——名单只有一处事实源`);
  }
});

test('说框口径是群聊不是 1:1', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  assert.match(html, /@ 点名/, '不点名则相关席应答，点名就只找那一位——这是群聊的口径');
});

test('前端不自带一份坐席名单（拉在座走 /api/seats）', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  assert.match(js, /\/api\/seats/, '名单从接口来');
  assert.match(js, /座读不到/, '拉不到名单要说读不到，不许显示成「零席」');
});

test('/api/seats 给出全部席位与接模型状态', async () => {
  const { start } = require('../server');
  const r = await start();
  try {
    const x = await 取(r.port, '/api/seats');
    assert.equal(x.码, 200);
    const j = JSON.parse(x.文);
    assert.ok(Array.isArray(j.席) && j.席.length >= 7, `应有七席，实得 ${j.席 && j.席.length}`);
    const 助 = j.席.find((s) => s.名 === '助理');
    assert.ok(助, '助理必须在册');
    assert.equal(typeof 助.接模型, 'boolean', '接没接模型要如实报——未接的席不许装作能说话');
    const 未接 = j.席.filter((s) => !s.接模型);
    assert.ok(未接.length >= 1, '当前确有未接模型的席，界面要标出来');
  } finally { if (r.server) r.server.close(); }
});
