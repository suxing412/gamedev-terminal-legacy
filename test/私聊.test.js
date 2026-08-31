// 私聊.test.js — 座条点名开 1:1（2026-08-29 制作人拍板）。
//
// 案发 2026-08-31 巡礼：这个功能**整条都是皮**。
//   · 前端有 私聊席 变量、有高亮、有顶边、有占位符「只有 X 看得见」，
//     说区底下还写着「私聊 X · 这条线有自己的记忆，与群里那条各记各的」；
//   · 而 /api/say 的 body 是 `{话}`，**席 从来没发出去过**；
//   · 服务端只有一个 .session.json，一个人设，一份记忆；
//   · 无论点谁，答话都顶着「总监」的名字——跟顶上那行「私聊 情报主管」互相打脸。
//   · 六个未接模型的席位照样点得进去，进去之后一样有「思考中…」。
// 屏上一次说了四件没发生的事。这个文件把那四件逐条钉住。
'use strict';
const assert = require('node:assert');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const 坐席 = require('../server/lib/坐席');
const 源 = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

// ── 一、前端真的把席发出去 ────────────────────────────────────

test('守① **/api/say 的 body 必须带席**（不带就只是换了个皮）', () => {
  const s = 源('public/app.js');
  const i = s.indexOf("fetch('/api/say'");
  assert.ok(i > 0, '找不到 /api/say 的调用');
  const 段 = s.slice(i, i + 700);
  assert.match(段, /body:\s*JSON\.stringify\([^)]*私聊席/,
    'body 里没有 私聊席 —— 服务端收到的每一条都会走同一个会话、同一个人设');
});

test('守①b 答话顶的是那一席的名字，不是永远的「总监」', () => {
  const s = 源('public/app.js');
  assert.match(s, /加话\(私聊席 \|\| '总监', ''\)/,
    '私聊时答话仍署名总监，与屏幕顶上那行「私聊 X」直接冲突');
});

test('守①c 非 SSE 的错误响应不许被流解析器吃掉', () => {
  // 服务端把「这一席没接模型」答成 400+JSON。不先拦一道，
  // 下面那个 SSE 解析器会把整段 JSON 当认不出的块丢掉，屏上只剩「（无输出）」。
  const s = 源('public/app.js');
  const i = s.indexOf("fetch('/api/say'");
  const j = s.indexOf('res.body.getReader()', i);
  assert.ok(j > i, '找不到流读取');
  const 之间 = s.slice(i, j);
  assert.match(之间, /!res\.ok/, '拿到响应后没有先判 res.ok');
  assert.match(之间, /j\.error/, '400 的 JSON 里那句人话没被读出来');
});

// ── 二、未接模型的席位 ────────────────────────────────────────

test('守② 未接模型的席位不许 disabled（disabled 的按钮点了完全没反应）', () => {
  const s = 源('public/app.js');
  const i = s.indexOf('async function 拉在座');
  const 段 = s.slice(i, s.indexOf('function 换私聊'));
  // 只有制作人那一格是 disabled；未接的仍要接得住点击
  assert.match(段, /名 === '制作人' \? ' disabled' : ''/);
  assert.ok(!/未接 \? ' disabled'/.test(段), '把未接的席位 disabled 了——点了没反应正是这轮在抓的病');
  assert.match(段, /未接 \?[^:]*title=/, '未接的席位要有 title 说清为什么开不了私聊');
});

test('守②b **点未接的席位要有回答**，且不许切进私聊态', () => {
  const s = 源('public/app.js');
  const i = s.indexOf("$('座组') && $('座组').addEventListener");
  assert.ok(i > 0);
  const 段 = s.slice(i, i + 1200);
  assert.match(段, /席况\.has\(名\) && !席况\.get\(名\)/, '点击处没有判这一席接没接模型');
  const 拒处 = 段.indexOf('席况.has(名)');
  const 切处 = 段.indexOf('换私聊(私聊席 === 名');
  assert.ok(拒处 < 切处, '判断必须在切换之前，否则先切进去再说没接等于白判');
  assert.match(段.slice(拒处, 切处), /return/, '未接分支要 return，不能落到切换那一行');
  assert.match(段.slice(拒处, 切处), /说注/, '要在屏上说一句为什么开不了');
});

// ── 三、服务端：席要被验、会话要分家、人设要接上 ────────────────

test('守③ **未接模型的席位在服务端也要被拒**（前端那道闸不是唯一的闸）', () => {
  const s = 源('server.js');
  const i = s.indexOf("app.post('/api/say'");
  const j = s.indexOf('res.writeHead(200', i);
  assert.ok(i > 0 && j > i);
  const 头前 = s.slice(i, j);
  assert.match(头前, /坐席\.按名/, '没有拿名单核对席名');
  assert.match(头前, /!s\.接模型/, '没有拦未接模型的席位');
  assert.match(头前, /res\.status\(400\)/, '要用 400 答，不要开了 SSE 再用事件报错');
});

test('守③b 席名不认识就 400，不许当成群聊悄悄放过去', () => {
  const s = 源('server.js');
  const i = s.indexOf("app.post('/api/say'");
  const 段 = s.slice(i, s.indexOf('res.writeHead(200', i));
  assert.match(段, /if \(!s\) return res\.status\(400\)/,
    '名单里没有的席名被静默忽略 —— 那会变成"点了个不存在的人，聊得很开心"');
});

test('守③c **会话按席分家**（「这条线有自己的记忆」这句话兑现在这里）', () => {
  const s = 源('server.js');
  assert.match(s, /const 会话档于 = \(席\)/, '没有按席取会话档的函数');
  assert.match(s, /读会话\(席 && 席\.名\)/, '续会话时没带席 —— 私聊会接上群里那条线');
  assert.match(s, /写会话\(m\.session_id, 席 && 席\.名\)/, '落会话时没带席 —— 私聊会把群里那条线覆盖掉');
});

test('守③d 席名进文件名前要洗（"现在不是用户输入"不是路径安全的理由）', () => {
  const { 席档名 } = require('../server.js');
  assert.strictEqual(typeof 席档名, 'function', 'server.js 要导出 席档名，否则这条判据够不着它');
  assert.strictEqual(席档名('情报主管'), '情报主管', '正常中文席名要原样留下');
  assert.strictEqual(席档名('../../etc/passwd'), 'etcpasswd');
  assert.strictEqual(席档名('a/b\\c'), 'abc');
  assert.strictEqual(席档名('..'), '');
  assert.strictEqual(席档名(''), '');
  assert.strictEqual(席档名(null), '');
  assert.ok(席档名('好'.repeat(50)).length <= 24, '席名要截断，不能让文件名无限长');
});

test('守③e **洗完为空要回落到群会话档**，不能拼出一个 ".session-.json"', () => {
  const { 会话档于, 会话档 } = require('../server.js');
  assert.strictEqual(会话档于(''), 会话档);
  assert.strictEqual(会话档于(null), 会话档);
  assert.strictEqual(会话档于('..'), 会话档, '全被洗掉时必须回落到群档，不许生成半截文件名');
  assert.notStrictEqual(会话档于('总监'), 会话档);
  assert.ok(会话档于('总监').endsWith('.session-总监.json'), '实得 ' + 会话档于('总监'));
});

test('守④ 人设接进系统提示，且只在私聊时接', () => {
  const { 坐席选项 } = require('../server.js');
  const 群 = 坐席选项({});
  assert.ok(!群.systemPrompt, '群聊不该带某一席的人设 —— 那会让群里的回答变成某一个人的口径');

  const s = 坐席.按名('总监');
  const 私 = 坐席选项({ 席: s.名, 人设: s.人设 });
  assert.ok(私.systemPrompt, '私聊没有接人设 —— 那八条私线会长得一模一样');
  assert.strictEqual(私.systemPrompt.type, 'preset');
  assert.strictEqual(私.systemPrompt.preset, 'claude_code', '要在 claude_code 预设之后追加，不是整个换掉');
  assert.match(私.systemPrompt.append, /总监/);
  assert.match(私.systemPrompt.append, new RegExp(s.人设.slice(0, 8)), '人设正文没进去');
});

test('守④b 私聊的用量要单独记（八条私线和群烧的是同一份额度）', () => {
  const s = 源('server.js');
  assert.match(s, /记用量\(席 \? `\$\{来路\}·\$\{席\.名\}` : 来路, m\)/,
    '私聊没有单独归集用量 —— 混着记就看不出是哪条线在烧');
});

// ── 四、名单仍然只有一处事实源 ────────────────────────────────

test('守⑤ 席位名单不许在前端再写一份（坐席.js 头注开宗明义的那一条）', () => {
  const s = 源('public/app.js');
  for (const x of 坐席.全部) {
    assert.ok(!s.includes(`'${x.名}'`) || x.名 === '总监',
      `前端里写死了席位名「${x.名}」—— 名单只有 server/lib/坐席.js 一处`);
  }
});
