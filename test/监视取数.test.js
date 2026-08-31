// 监视取数.test.js — 监视器取数层判据（方案第六节 1~15 条中落在本层的部分）
//
// 判据面直接对着 codex 那八条击杀：
//   8-1 塔三态可分（在岗/卡住/读不到）——两路取证，缺一路就分不清塔死与盘死
//   8-2 坏行计数不吞、末行半行不误报、BOM 剥掉不报错
//   8-4 通不等于是它：返 200 而认不出身份要判阵亡
//   8-5 offset 增量读；文件变小即重置
//   8-6 不写瞭望塔的地盘——**对冻结夹具判**，不对活体判（原判据写成对活体判，必然跑不绿）
// 外加自行补位的不变量丙：读不到永不折叠成 0 或空。
'use strict';
const assert = require('node:assert');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const M = require('../server/lib/监视取数');

const 现在 = Date.parse('2026-08-29T01:00:00.000Z');
const 前 = (秒) => new Date(现在 - 秒 * 1000).toISOString();

function 造塔(件 = {}) {
  const 根 = fs.mkdtempSync(path.join(os.tmpdir(), 'watch-'));
  for (const [名, 内容] of Object.entries(件)) {
    fs.writeFileSync(path.join(根, 名), 内容, 'utf8');
  }
  return 根;
}
const 存 = () => { const m = new Map(); return { get: (k) => m.get(k) || 0, set: (k, v) => m.set(k, v) }; };
const 跑 = (配置, 根, o = {}) => M.取数(配置, { 塔根: 根, 现在: 现在, offset存储: o.存 || 存() });
const 格 = (r, 键) => r.格.find((x) => x.键 === 键);

// ── 8-1 · 塔三态可分 ────────────────────────────────────────────
const 塔格 = {
  键: '塔', 名: '瞭望塔',
  源: { 型: '复合', 路: [
    { 键: '心跳', 型: '时刻文件', 路径: '心跳.txt' },
    { 键: '进程', 型: '进程', 路径: 'watchtower.pid', 取: 'pid' },
  ] },
  健康: { 型: '复合', 判: [
    { 当: '心跳.读不到 && 进程.活', 则: '读不到', 说: '进程活而文件读不到' },
    { 当: '心跳.龄毫秒 > 90000 && 进程.活', 则: '卡住' },
    { 当: '!进程.活', 则: '阵亡' },
    { 当: '心跳.龄毫秒 <= 90000', 则: '在岗' },
  ] },
  呈现: { 型: '灯' },
};
const 塔配 = { 版本: 1, 格: [塔格] };
const 我pid = JSON.stringify({ pid: process.pid, 根: 'X' });

test('8-1① 心跳新鲜 + 进程活 → 在岗', async () => {
  const 根 = 造塔({ '心跳.txt': 前(10), 'watchtower.pid': 我pid });
  assert.equal(格(await 跑(塔配, 根), '塔').态, '在岗');
});

test('8-1② 心跳陈旧 + 进程活 → 卡住（不是阵亡：进程还在，是它不写了）', async () => {
  const 根 = 造塔({ '心跳.txt': 前(600), 'watchtower.pid': 我pid });
  assert.equal(格(await 跑(塔配, 根), '塔').态, '卡住');
});

test('8-1③ 心跳文件读不到 + 进程活 → 读不到（盘或权限出事，不许判成塔死）', async () => {
  const 根 = 造塔({ 'watchtower.pid': 我pid });   // 故意不造心跳文件
  const g = 格(await 跑(塔配, 根), '塔');
  assert.equal(g.态, '读不到');
  assert.notEqual(g.态, '阵亡', '把盘故障判成塔死，会让人去重挂一个根本没死的塔');
});

test('8-1④ 进程不在 → 阵亡', async () => {
  const 根 = 造塔({ '心跳.txt': 前(10), 'watchtower.pid': JSON.stringify({ pid: 999999 }) });
  assert.equal(格(await 跑(塔配, 根), '塔').态, '阵亡');
});

// ── 8-2 · 坏行 / 半行 / BOM ─────────────────────────────────────
const 账配 = { 版本: 1, 格: [{
  键: '未读', 名: '未读账本',
  源: { 型: 'jsonl', 路径: '未读账本.jsonl', 水位: '账本水位.json' },
  健康: { 型: '积压上限', 阈值: 50 },
  呈现: { 型: '计数与清单' },
}] };
const 水位档 = JSON.stringify({ 至: '2026-08-29T00:00:00.000Z' });

test('8-2① 非末行坏 JSON → 计数并呈现，好行照常收（静默吞掉正是 G17 那笔账的死法）', async () => {
  const 根 = 造塔({
    '未读账本.jsonl': '{"t":"2026-08-29T00:30:00.000Z","a":1}\n{坏的不是JSON\n{"t":"2026-08-29T00:31:00.000Z","a":2}\n',
    '账本水位.json': 水位档,
  });
  const g = 格(await 跑(账配, 根), '未读');
  assert.equal(g.数.坏行, 1, '坏行必须被数出来');
  assert.equal(g.数.条.length, 2, '好行照常收');
});

test('8-2② 末行是半行 → 不算坏行，且下一轮能把它读全', async () => {
  const p = path.join(造塔({ '账本水位.json': 水位档 }), '未读账本.jsonl');
  const 根 = path.dirname(p);
  fs.writeFileSync(p, '{"t":"2026-08-29T00:30:00.000Z","a":1}\n{"t":"2026-08-2', 'utf8');
  const s = 存();
  const 一 = 格(await 跑(账配, 根, { 存: s }), '未读');
  assert.equal(一.数.坏行, 0, '写方正在追加，半行不是坏行');
  assert.equal(一.数.条.length, 1);
  fs.appendFileSync(p, '9T00:31:00.000Z","a":2}\n', 'utf8');   // 把那半行补全
  const 二 = 格(await 跑(账配, 根, { 存: s }), '未读');
  assert.equal(二.数.坏行, 0);
  assert.equal(二.数.条.length, 1, '下一轮增量读到刚补全的那条');
  assert.equal(二.数.条[0].a, 2);
});

test('8-2③ 带 BOM 的文件照读不报错', async () => {
  const 根 = 造塔({ '心跳.txt': '﻿' + 前(10), 'watchtower.pid': 我pid });
  assert.equal(格(await 跑(塔配, 根), '塔').态, '在岗');
});

// ── 8-5 · offset 增量与重建 ─────────────────────────────────────
test('8-5① 增量读：第二轮只拿新增的，不重复全扫', async () => {
  const 根 = 造塔({ '未读账本.jsonl': '{"t":"2026-08-29T00:30:00.000Z"}\n', '账本水位.json': 水位档 });
  const s = 存();
  assert.equal(格(await 跑(账配, 根, { 存: s }), '未读').数.本轮新增, 1);
  fs.appendFileSync(path.join(根, '未读账本.jsonl'), '{"t":"2026-08-29T00:31:00.000Z"}\n', 'utf8');
  const 二 = 格(await 跑(账配, 根, { 存: s }), '未读');
  assert.equal(二.数.本轮新增, 1, '第二轮只应看到新增那一条');
});

test('8-5② 文件变小 → 判源已重建并从头读', async () => {
  const p0 = 造塔({ '账本水位.json': 水位档 });
  const p = path.join(p0, '未读账本.jsonl');
  fs.writeFileSync(p, '{"t":"2026-08-29T00:30:00.000Z"}\n{"t":"2026-08-29T00:31:00.000Z"}\n', 'utf8');
  const s = 存();
  await 跑(账配, p0, { 存: s });
  fs.writeFileSync(p, '{"t":"2026-08-29T00:40:00.000Z"}\n', 'utf8');   // 截短＝重建
  const 二 = 格(await 跑(账配, p0, { 存: s }), '未读');
  assert.equal(二.数.源已重建, true, '不报重建的话，offset 会读到错位的字节');
  assert.equal(二.数.本轮新增, 1);
});

// ── 积压跨轮累计（真机实测抓出的 bug，夹具全绿也没抓住）────────
// 第一轮报积压 7，第二轮增量读到 0 行 → 报积压 0。
// 屏上显示 0 而真相是 7 —— 这是「读不到折叠成零」那条不变量的新变种。
test('积压① 第二轮没有新增，积压仍报全量而不是 0', async () => {
  const 根 = 造塔({
    '未读账本.jsonl': '{"t":"2026-08-29T00:30:00.000Z"}\n{"t":"2026-08-29T00:31:00.000Z"}\n{"t":"2026-08-29T00:32:00.000Z"}\n',
    '账本水位.json': 水位档,
  });
  const s = 存();
  const 一 = 格(await 跑(账配, 根, { 存: s }), '未读');
  assert.equal(一.数.积压, 3);
  const 二 = 格(await 跑(账配, 根, { 存: s }), '未读');
  assert.equal(二.数.本轮新增, 0, '前提：第二轮确实没有新增');
  assert.equal(二.数.积压, 3, '没新增不等于积压归零——屏上显示 0 而真相是 3，是这块屏最严重的错');
});

test('积压② 新增继续累加', async () => {
  const 根 = 造塔({ '未读账本.jsonl': '{"t":"2026-08-29T00:30:00.000Z"}\n', '账本水位.json': 水位档 });
  const s = 存();
  assert.equal(格(await 跑(账配, 根, { 存: s }), '未读').数.积压, 1);
  fs.appendFileSync(path.join(根, '未读账本.jsonl'), '{"t":"2026-08-29T00:31:00.000Z"}\n', 'utf8');
  assert.equal(格(await 跑(账配, 根, { 存: s }), '未读').数.积压, 2);
});

test('积压③ 水位前移（清账）→ 重扫全量重算，不留旧累计', async () => {
  const 根 = 造塔({
    '未读账本.jsonl': '{"t":"2026-08-29T00:30:00.000Z"}\n{"t":"2026-08-29T00:31:00.000Z"}\n',
    '账本水位.json': 水位档,
  });
  const s = 存();
  assert.equal(格(await 跑(账配, 根, { 存: s }), '未读').数.积压, 2);
  // 清账：水位推到最后一条之后
  fs.writeFileSync(path.join(根, '账本水位.json'), JSON.stringify({ 至: '2026-08-29T00:31:00.000Z' }), 'utf8');
  const 后 = 格(await 跑(账配, 根, { 存: s }), '未读');
  assert.equal(后.数.积压, 0, '清完账积压必须真的归零，不能留着旧累计');
});

// ── 样本环：跨轮保住清单（2026-08-31 评审 S8）────────────────────
//
// 案发：`条` 是本轮增量、`积压` 是跨轮累计，两个放在同一格里渲染，
// 屏上就成了「63 条在等你」+ 一个空 <ul>。第一轮读到 2000 条、之后每轮 0 条，
// 而这台机器开机自启整天不关，**所以他看到的永远是空那一版**。
// 数字是真的，清单是空的，两句话互相打脸。
test('样① **第二轮起清单还在**（此前第二轮就空了，而屏上仍写着「N 条在等你」）', async () => {
  const 根 = 造塔({
    '未读账本.jsonl': '{"t":"2026-08-29T00:30:00.000Z","摘要":"甲"}\n{"t":"2026-08-29T00:31:00.000Z","摘要":"乙"}\n',
    '账本水位.json': 水位档,
  });
  const s = 存();
  const 一 = 格(await 跑(账配, 根, { 存: s }), '未读');
  assert.equal(一.数.积压, 2);
  assert.equal((一.数.样 || []).length, 2);

  const 二 = 格(await 跑(账配, 根, { 存: s }), '未读');
  assert.equal(二.数.本轮新增, 0, '前提：第二轮确实没有新增');
  assert.equal(二.数.积压, 2);
  assert.equal((二.数.样 || []).length, 2,
    '**积压说 2、清单给 0**——这正是屏上「63 条在等你」配一个空列表的来源');
  assert.equal(二.数.样[1].摘要, '乙');
});

test('样② 新增追加进环，顺序是旧在前新在后', async () => {
  const 根 = 造塔({ '未读账本.jsonl': '{"t":"2026-08-29T00:30:00.000Z","摘要":"甲"}\n', '账本水位.json': 水位档 });
  const s = 存();
  await 跑(账配, 根, { 存: s });
  fs.appendFileSync(path.join(根, '未读账本.jsonl'), '{"t":"2026-08-29T00:31:00.000Z","摘要":"乙"}\n', 'utf8');
  const 二 = 格(await 跑(账配, 根, { 存: s }), '未读');
  assert.deepEqual((二.数.样 || []).map((e) => e.摘要), ['甲', '乙']);
});

test('样③ 清账（水位前移）把环也清掉，不留已经看过的', async () => {
  const 根 = 造塔({
    '未读账本.jsonl': '{"t":"2026-08-29T00:30:00.000Z","摘要":"甲"}\n{"t":"2026-08-29T00:31:00.000Z","摘要":"乙"}\n',
    '账本水位.json': 水位档,
  });
  const s = 存();
  assert.equal((格(await 跑(账配, 根, { 存: s }), '未读').数.样 || []).length, 2);
  fs.writeFileSync(path.join(根, '账本水位.json'), JSON.stringify({ 至: '2026-08-29T00:31:00.000Z' }), 'utf8');
  const 后 = 格(await 跑(账配, 根, { 存: s }), '未读');
  assert.equal(后.数.积压, 0);
  assert.deepEqual(后.数.样 || [], [], '清完账清单还留着旧的，等于说「都看过了」的同时又列出来给你看');
});

test('样④ **环空而积压非零时，回捞文件尾部**（不许留一个空清单）', async () => {
  const 根 = 造塔({
    '未读账本.jsonl': '{"t":"2026-08-29T00:30:00.000Z","摘要":"甲"}\n{"t":"2026-08-29T00:31:00.000Z","摘要":"乙"}\n',
    '账本水位.json': 水位档,
  });
  const s = 存();
  await 跑(账配, 根, { 存: s });
  // 伪造那种最难查的时刻：累计还在、环被抹了（进程状态半丢）
  s.set('sample:' + path.join(根, '未读账本.jsonl'), []);
  const 后 = 格(await 跑(账配, 根, { 存: s }), '未读');
  assert.equal(后.数.积压, 2);
  assert.ok((后.数.样 || []).length > 0,
    '积压说 2 而清单是空的——数字对、清单空、不报错，是最难查的那一种');
  assert.equal(后.数.样[后.数.样.length - 1].摘要, '乙');
});

test('样⑤ **渲染侧真的用 样**（取数层修好了、渲染侧还读 条，等于没修）', () => {
  const { 渲染格 } = require('../server/routes/监视');
  const 格子 = {
    键: '未读', 名: '等着你看的', 态: '要查',
    呈现: { 型: '计数与清单', 出条目: 8, 可清账: true },
    数: {
      读到: true, 积压: 63, 水位: '2026-08-29T00:00:00.000Z',
      条: [],                                              // 本轮增量为空（第二轮起的常态）
      样: [{ t: '2026-08-29T00:30:00.000Z', 类型: 'OAuth', 摘要: '这一条必须画出来' }],
    },
  };
  const h = 渲染格(格子);
  assert.ok(h.includes('63'), '数字没画出来');
  assert.ok(h.includes('这一条必须画出来'),
    '**「63 条在等你」配一个空清单**——取数层给了 样，渲染侧还在读 条');
  assert.ok(h.includes('<ul'), '没有列表');
});

test('样⑥ 真拿不到清单时，宁可说拿不到，也不出一个空 <ul>', () => {
  const { 渲染格 } = require('../server/routes/监视');
  const h = 渲染格({
    键: '未读', 名: '等着你看的', 态: '要查',
    呈现: { 型: '计数与清单', 出条目: 8 },
    数: { 读到: true, 积压: 63, 水位: '2026-08-29T00:00:00.000Z', 条: [], 样: [] },
  });
  assert.ok(h.includes('63'), '数字仍要报——它是真的');
  assert.ok(!/<ul[^>]*>\s*<\/ul>/.test(h), '画了一个空 <ul>：' + h.slice(0, 300));
  assert.ok(/清单|没取到/.test(h), '空清单时要说一句为什么，不能只剩一个大数字杵在那儿');
});

// ── 页脚那个钟（2026-08-31 评审顺带抓出）──────────────────────────
test('钟 · 于本地 是本地时，不是 UTC（本地 23:52 显示 15:50 早八小时）', async () => {
  const 根 = 造塔({ '心跳.txt': 前(10) });
  const 出 = await 跑({ 版本: 1, 格: [] }, 根);
  const d = new Date(现在);
  const p2 = (n) => String(n).padStart(2, '0');
  assert.equal(出.于本地, `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`);
  // 时区不为零时，它必须与 ISO 那截切出来的不一样
  if (new Date().getTimezoneOffset() !== 0) {
    assert.notEqual(出.于本地, String(出.于).slice(11, 19),
      '于本地 切的还是 UTC —— 这一行字唯一的用处是回答「这页有多新」');
  }
  assert.match(出.于, /^\d{4}-\d{2}-\d{2}T/, '于 仍要是 ISO（那是数据该有的样子）');
});

// ── 不变量丙 · 读不到永不折叠成 0 或空 ──────────────────────────
test('丙 · 源不存在 → 态=读不到，而不是 0 或空清单', async () => {
  const 根 = 造塔({});
  const g = 格(await 跑(账配, 根), '未读');
  assert.equal(g.态, '读不到');
  assert.equal(g.数.读到, false);
  assert.ok(!g.数.条, '不许给一个空数组冒充「查过了，没有」');
});

// ── 8-4 · 通不等于是它 ──────────────────────────────────────────
test('8-4 返 200 但认不出身份 → 阵亡（端口被别的东西占了）', async () => {
  const 假 = http.createServer((q, s) => { s.writeHead(200, { 'Content-Type': 'application/json' }); s.end('{"hello":"world"}'); });
  await new Promise((r) => 假.listen(0, '127.0.0.1', r));
  const 口 = 假.address().port;
  try {
    const 配 = { 版本: 1, 格: [{
      键: '监制台', 名: '监制台',
      源: { 型: 'HTTP', 地址: 'http://127.0.0.1:' + 口 + '/api/version', 超时毫秒: 3000 },
      健康: { 型: 'HTTP身份', 须含: ['版本', '码印'] },
      呈现: { 型: '灯' },
    }] };
    const g = 格(await 跑(配, 造塔({})), '监制台');
    assert.equal(g.态, '阵亡', '通了就判健康，等于让任何占了这个端口的东西冒名顶替');
    assert.match(g.因, /认不出身份/);
  } finally { 假.close(); }
});

test('8-4b 返 200 且身份齐 → 在岗', async () => {
  const 假 = http.createServer((q, s) => { s.writeHead(200, { 'Content-Type': 'application/json' }); s.end('{"版本":"0.40.4","码印":"d46089afdd08"}'); });
  await new Promise((r) => 假.listen(0, '127.0.0.1', r));
  const 口 = 假.address().port;
  try {
    const 配 = { 版本: 1, 格: [{
      键: '监制台', 名: '监制台',
      源: { 型: 'HTTP', 地址: 'http://127.0.0.1:' + 口 + '/api/version', 超时毫秒: 3000 },
      健康: { 型: 'HTTP身份', 须含: ['版本', '码印'] },
      呈现: { 型: '灯' },
    }] };
    const g = 格(await 跑(配, 造塔({})), '监制台');
    assert.equal(g.态, '在岗');
    assert.match(g.因, /0\.40\.4/);
  } finally { 假.close(); }
});

// ── 8-6 · 只读：对冻结夹具判，不对活体判 ────────────────────────
test('8-6 取数不写瞭望塔的地盘（对冻结夹具判 mtime 与字节数）', async () => {
  const 根 = 造塔({
    '心跳.txt': 前(10), 'watchtower.pid': 我pid,
    '未读账本.jsonl': '{"t":"2026-08-29T00:30:00.000Z"}\n', '账本水位.json': 水位档,
    '瞭望塔流水.log': '[2026-08-29 00:30:00] [流水] 常 兜底 | x\n',
  });
  const 快照 = () => Object.fromEntries(fs.readdirSync(根).map((f) => {
    const st = fs.statSync(path.join(根, f)); return [f, st.mtimeMs + ':' + st.size];
  }));
  const 前照 = 快照();
  const 全 = { 版本: 1, 格: [塔格, 账配.格[0], {
    键: '流水', 名: '产线流水',
    源: { 型: '行文件', 路径: '瞭望塔流水.log', 尾行: 50 },
    健康: { 型: '有新行', 阈值毫秒: 1800000 }, 呈现: { 型: '事件流' },
  }] };
  await 跑(全, 根);
  assert.deepEqual(快照(), 前照, '本模块对瞭望塔只有读权限');
});

// ── 配置健壮性 ──────────────────────────────────────────────────
test('配置坏了不崩：语法错 / 缺 格 键 都返可呈现的错', () => {
  const 根 = 造塔({ 'a.json': '{ 这不是 json', 'b.json': '{"版本":1}' });
  const a = M.读配置(path.join(根, 'a.json'));
  assert.equal(a.ok, false); assert.match(a.因, /不是合法 JSON/);
  const b = M.读配置(path.join(根, 'b.json'));
  assert.equal(b.ok, false); assert.match(b.因, /缺 格/);
  const c = M.读配置(path.join(根, '不存在.json'));
  assert.equal(c.ok, false); assert.match(c.因, /读不到/);
});

test('单格炸掉不拖垮整轮（未知源型只让那一格红）', async () => {
  const 根 = 造塔({ '心跳.txt': 前(10), 'watchtower.pid': 我pid });
  const 配 = { 版本: 1, 格: [{ 键: '怪', 名: '怪格', 源: { 型: '没这个型' }, 健康: { 型: '新鲜度' }, 呈现: { 型: '灯' } }, 塔格] };
  const r = await 跑(配, 根);
  assert.equal(r.格.length, 2);
  assert.equal(格(r, '怪').态, '读不到');
  assert.equal(格(r, '塔').态, '在岗', '一格坏不许影响另一格——那正是「一切都会报错」的观感来源');
});

// ── 子项健康（源健康那一格）────────────────────────────────────
// 整格绿不代表每一项都绿。坏的是哪几个必须报出名字，否则「有失败」等于没说。
function 起假源(体) {
  return new Promise((res) => {
    const s = http.createServer((q, r) => { r.writeHead(200, { 'Content-Type': 'application/json' }); r.end(JSON.stringify(体)); });
    s.listen(0, '127.0.0.1', () => res({ s: s, 口: s.address().port }));
  });
}
const 源配 = (口) => ({ 版本: 1, 格: [{
  键: '源健康', 名: '情报源',
  源: { 型: 'HTTP', 地址: 'http://127.0.0.1:' + 口 + '/health', 超时毫秒: 3000 },
  健康: { 型: '子项', 取: '每源', 坏当有: '最近失败' },
  呈现: { 型: '源表' },
}] });

test('子项① 全通 → 在岗，且把子项明细带下来给呈现层', async () => {
  const { s, 口 } = await 起假源({ 每源: [{ 源: 'a', 名称: 'A', 当日条数: 3 }, { 源: 'b', 名称: 'B', 当日条数: 5 }] });
  try {
    const g = 格(await 跑(源配(口), 造塔({})), '源健康');
    assert.equal(g.态, '在岗');
    assert.match(g.因, /2 项全通/);
    assert.equal((g.组 || []).length, 2, '明细要随格下发，否则源表画不出来');
  } finally { s.close(); }
});

test('子项② 有一项失败 → 卡住，且因里点名是哪一项（不点名等于没说）', async () => {
  const { s, 口 } = await 起假源({ 每源: [
    { 源: 'a', 名称: 'Game Developer', 当日条数: 3 },
    { 源: 'b', 名称: 'GDC Vault', 最近失败: { 因: 'HTTP 403' } },
  ] });
  try {
    const g = 格(await 跑(源配(口), 造塔({})), '源健康');
    assert.equal(g.态, '卡住');
    assert.match(g.因, /GDC Vault/, '坏的是哪一项必须报出名字');
    assert.doesNotMatch(g.因, /Game Developer/, '好的那项不该混进失败清单');
  } finally { s.close(); }
});

test('子项③ 一个子项都没有 → 读不到，不是「全通」', async () => {
  const { s, 口 } = await 起假源({ 每源: [] });
  try {
    const g = 格(await 跑(源配(口), 造塔({})), '源健康');
    assert.equal(g.态, '读不到', '零个源不叫全通，叫没配——两者处置完全不同');
  } finally { s.close(); }
});

// ── 配置驱动：加一格不改代码 ────────────────────────────────────
test('验收① 加一格已有型的格，不改任何 .js，格数跟着变', async () => {
  const 根 = 造塔({ '心跳.txt': 前(10), 'watchtower.pid': 我pid, '瞭望塔流水.log': 'x\n' });
  const 四 = { 版本: 1, 格: [塔格] };
  assert.equal((await 跑(四, 根)).格.length, 1);
  const 五 = { 版本: 1, 格: [塔格, {
    键: '新', 名: '新加的格',
    源: { 型: '行文件', 路径: '瞭望塔流水.log', 尾行: 10 },
    健康: { 型: '有新行', 阈值毫秒: 1800000 }, 呈现: { 型: '事件流' },
  }] };
  assert.equal((await 跑(五, 根)).格.length, 2);
});
