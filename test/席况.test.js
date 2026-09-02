// 席况.test.js — 每一席此刻在做什么（2026-09-02 批六）。
//
// 这一组盯的是一条线：**这一栏不许编，也不许留幽灵。**
//
// 案由：批五做在座栏时，设计稿上画着「正在答话 / 起草 TK-234 / 回灌 4 源」，
// 而按席的活动当时没有任何数据源。当时的处置是**不画**（PRODUCT 原则五），
// 并把「要真做得先有来源」列进待办。这个文件是那个来源的判据。
//
// 它报的每一个数都必须能被钉住，所以时钟一律从外面传——
// 席况.js 里没有一处 Date.now()。
'use strict';
const assert = require('node:assert');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const 席况 = require('../server/lib/席况.js');

const T0 = Date.parse('2026-09-02T08:00:00Z');

// ── 一、在飞与不在飞，分得开 ──────────────────────────────────

test('守① 没在飞就是 null，**不是一个「空的在飞」**', () => {
  const 台 = 席况.开台();
  assert.strictEqual(台.况('总监', T0), null);
  // 回 { 在答: false } 之类也不行：调用方一见对象就容易当成"有状态"，
  // 而这一栏最不能有的就是"看着有东西、其实没有"。
  assert.strictEqual(台.况(null, T0), null, '群那条线同理');
});

test('守② 开始之后报得出跑了多久（时钟从外面传，判据才钉得住）', () => {
  const 台 = 席况.开台();
  台.开始('总监', T0, '人');
  const a = 台.况('总监', T0 + 42_000);
  assert.strictEqual(a.在答, true);
  assert.strictEqual(a.秒, 42, '实得 ' + a.秒);
  assert.strictEqual(a.来路, '人');
  // 同一份状态换个时刻问，答案必须跟着变——不变就说明它在内部自己读钟
  assert.strictEqual(台.况('总监', T0 + 100_000).秒, 100);
});

test('守②b 席况.js 里不许出现 Date.now（有它判据就钉不住）', () => {
  const 源 = fs.readFileSync(path.join(__dirname, '..', 'server', 'lib', '席况.js'), 'utf8');
  const 净 = 源.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  assert.ok(!/Date\.now\(\)/.test(净), '席况.js 里有 Date.now —— 时钟必须从外面传');
});

// ── 二、幽灵：这一组是这个文件存在的主要理由 ────────────────────

test('守③ **结束之后立刻不在飞**（漏调 结束 就留一个永远在答话的幽灵）', () => {
  const 台 = 席况.开台();
  台.开始('总监', T0);
  assert.ok(台.况('总监', T0));
  台.结束('总监');
  assert.strictEqual(台.况('总监', T0 + 1), null,
    '结束之后还报在答 —— 屏上会有一个看着在动、其实早就没人的席位');
});

test('守③b 结束别人不影响这一席（键不能串）', () => {
  const 台 = 席况.开台();
  台.开始('总监', T0); 台.开始('助理', T0);
  台.结束('助理');
  assert.ok(台.况('总监', T0), '结束助理把总监也清掉了');
  assert.strictEqual(台.况('助理', T0), null);
});

test('守③c 群那条线与任何一席都不是同一个键', () => {
  const 台 = 席况.开台();
  台.开始(null, T0);                    // 群
  assert.ok(台.况(null, T0));
  assert.strictEqual(台.况('总监', T0), null, '群在飞被当成了总监在飞');
  台.结束(null);
  assert.strictEqual(台.况(null, T0), null);
  // 群键不许与任何真席名重名
  const 坐席 = require('../server/lib/坐席.js');
  for (const s of 坐席.全部) assert.notStrictEqual(s.名, 席况.群键);
});

test('守③d 同一席重复开始＝同一条线在续，不叠罗汉', () => {
  const 台 = 席况.开台();
  台.开始('总监', T0);
  台.开始('总监', T0 + 5_000);
  assert.strictEqual(台.况('总监', T0 + 5_000).秒, 0, '起时没跟着更新');
  台.结束('总监');
  assert.strictEqual(台.况('总监', T0), null, '一次结束要清干净，不该留下另一份');
});

// ── 三、在做什么：坐席自己报的那句，不加工 ──────────────────────

test('守④ 「在做什么」原样收下（它是坐席自己说的，改写它就是替它编）', () => {
  const 台 = 席况.开台();
  台.开始('总监', T0);
  台.在做('总监', '正在读 TK-207 的回执');
  assert.strictEqual(台.况('总监', T0).做, '正在读 TK-207 的回执');
});

test('守④b 没在飞时报「在做什么」不许凭空造出一条在飞', () => {
  const 台 = 席况.开台();
  assert.strictEqual(台.在做('总监', '正在读什么'), false);
  assert.strictEqual(台.况('总监', T0), null,
    '一句 在做 就把一个没在跑的席位点亮了 —— 那正是"看着在动其实没人"');
});

test('守④c 空的「在做什么」回落成 null，不留一个空字符串', () => {
  const 台 = 席况.开台();
  台.开始('总监', T0);
  台.在做('总监', '   ');
  assert.strictEqual(台.况('总监', T0).做, null, '空串会在屏上渲染成一行空白，看着像坏了');
});

// ── 四、末话：读不到就是读不到 ──────────────────────────────────

test('守⑤ 会话档不在就回 null，**不回 0**', () => {
  const 台根 = fs.mkdtempSync(path.join(os.tmpdir(), '席况测-'));
  assert.strictEqual(席况.末话(台根, '从来没说过话的席'), null,
    '回 0 会被当成 1970 年，算出来是"五十六年前说的" —— 一个确定的假消息');
  fs.rmSync(台根, { recursive: true, force: true });
});

test('守⑤b 有会话档就回它的 mtime（每答一句写一次，所以它就是"上次说话"）', () => {
  const 台根 = fs.mkdtempSync(path.join(os.tmpdir(), '席况测-'));
  const 档 = path.join(台根, '.session-总监.json');
  fs.writeFileSync(档, '{}', 'utf8');
  const t = 席况.末话(台根, '总监');
  assert.ok(Number.isFinite(t) && Math.abs(t - fs.statSync(档).mtimeMs) < 2);
  // 群那条线用不带席名的那一份
  fs.writeFileSync(path.join(台根, '.session.json'), '{}', 'utf8');
  assert.ok(Number.isFinite(席况.末话(台根, null)));
  fs.rmSync(台根, { recursive: true, force: true });
});

// ── 五、接线：三条出路都要清 ────────────────────────────────────

test('守⑥ /api/say 的三条出路（跑完 / 断线 / 抛异常）都调了 结束', () => {
  // 这一条是源码守卫，**不是唯一那道**（守③ 才是验行为的那条）。
  // 留它的理由：漏掉某一条出路的后果是幽灵，而幽灵在纯 Node 判据里造不出来
  // ——要造得起一条真的 SDK 流并在中途掐断它。
  const s = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const i = s.indexOf("app.post('/api/say'");
  assert.ok(i > 0, '找不到 /api/say');
  const 段 = s.slice(i, s.indexOf("\napp.", i + 10));
  assert.match(段, /席况台\.开始\(/, '没开始');
  // 断线那条路：取 res.on('close' 之后那一小段来看。
  // **不要写成一条跨括号的正则**——首版用 `res\.on\('close'[^)]*\)`，
  // 而 `[^)]*` 跨不过箭头函数体里的括号，于是判据红了而代码是对的。
  // 一条会误报的判据和一条漏报的判据一样坏：两次之后就没人信它了。
  const c = 段.indexOf("res.on('close'");
  assert.ok(c > 0, '找不到断线处理');
  assert.match(段.slice(c, c + 160), /席况台\.结束/, '断线那条路没清');
  assert.match(段, /finally\s*\{[\s\S]*席况台\.结束/, 'finally 那条路没清（跑完与抛异常都走它）');
  assert.match(段, /席况台\.在做\(/, '没把坐席报的"在做什么"接进来');
});

test('守⑥b 「在做什么」与屏上转圈处那句是**同一句**', () => {
  // 各自另写一句就会有一天只改其中一句，而两句都自称是"它此刻在做什么"。
  const s = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const i = s.indexOf("b.type === 'tool_use'");
  assert.ok(i > 0, '找不到 tool_use 分支');
  const 段 = s.slice(i, i + 400);
  assert.match(段, /const 做 = 干什么\(b\)/, '没有把那句话抽成一个值');
  assert.match(段, /发\('活', \{ 做 \}\)/, '转圈处用的不是那个值');
  assert.match(段, /席况台\.在做\(席键, 做\)/, '在座栏用的不是那个值');
});
