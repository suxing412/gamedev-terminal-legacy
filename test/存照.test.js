// 存照.test.js — 席间存照读取与分型层的判据。
//
// 每条判据对着一次异厂击杀（五轮累计 52 条）。方案见 docs/方案-席间存照-2026-08-29.md。
// 判据面：一条不藏 / 行序 ID / 游标 / 形状坏行 / 计数扫全量 / 逻辑行 / 末行半行。
'use strict';
const assert = require('node:assert');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const 存照 = require('../server/lib/存照');

const 造 = (条) => {
  const 根 = fs.mkdtempSync(path.join(os.tmpdir(), 'cz-'));
  const p = path.join(根, 'thread.jsonl');
  fs.writeFileSync(p, 条.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join('\n') + '\n', 'utf8');
  return p;
};
const 说 = (from, text, t) => ({ t: t || '2026-08-29T02:00:00.000Z', from, text });

// ── 一条不藏（前两稿的核心病：分堆会藏内容）────────────────────
test('一条不藏：播报也在条目里，只是带 播报 标记', () => {
  const p = 造([说('项管', '排期复判：维持'), 说('总监', '收到')]);
  const r = 存照.读(p);
  assert.equal(r.条.length, 2, '播报不许被排除——排除的代价是静默藏掉真对话');
  assert.equal(r.条[0].播报, true);
  assert.equal(r.条[1].播报, false);
});

test('播报判别只作折叠用：项管的「排期复判…请总监签字」仍在流里', () => {
  const p = 造([说('项管', '排期复判：TK-312 的回执请总监今天签字')]);
  const r = 存照.读(p);
  assert.equal(r.条.length, 1, '这是明确指向总监的对话，绝不许消失');
  assert.equal(r.条[0].播报, true, '它确实命中判别——所以判别只能用来折叠，不能用来排除');
});

test('非项管说的话，命中前缀也不算播报（四评击杀③）', () => {
  const p = 造([说('制作人', '排期复判：TK-312 应回滚，先不要合并')]);
  assert.equal(存照.读(p).条[0].播报, false, '只看前缀不看发言人，会把制作人的话当播报');
});

// ── 行序 ID（三评击杀①：重试写入会三者全同）──────────────────
test('ID 用行序：t/from/text 三者全同的两条也能区分', () => {
  const 同 = 说('项管', '收到');
  const p = 造([同, 同]);
  const r = 存照.读(p);
  assert.equal(r.条.length, 2);
  assert.notEqual(r.条[0].id, r.条[1].id, '重试写入的两条必须可区分，否则分页锚点会撞');
  assert.equal(r.条[0].行序, 1);
  assert.equal(r.条[1].行序, 2);
});

test('同一条重算两次 ID 相同（append-only 下行序不变）', () => {
  const p = 造([说('总监', '甲'), 说('项管', '乙')]);
  const a = 存照.读(p).条.map((x) => x.id);
  const b = 存照.读(p).条.map((x) => x.id);
  assert.deepEqual(a, b);
});

// ── 游标是行序不是 offset（三评击杀②）──────────────────────────
test('向上加载用行序游标：读到一半有人追加，也不会重复取', () => {
  const 根 = fs.mkdtempSync(path.join(os.tmpdir(), 'cz2-'));
  const p = path.join(根, 't.jsonl');
  const 造行 = (i) => JSON.stringify(说('项管', '第' + i + '条'));
  fs.writeFileSync(p, Array.from({ length: 200 }, (_, i) => 造行(i + 1)).join('\n') + '\n', 'utf8');

  const 一 = 存照.读(p, { 取数: 60 });
  assert.equal(一.条.length, 60);
  assert.equal(一.条[59].行序, 200, '首屏取最后 60 条');
  const 游标 = 一.条[0].行序;                       // 141

  // 追加 60 条——用 offset 的话第二页会重新取回 141~200
  fs.appendFileSync(p, Array.from({ length: 60 }, (_, i) => 造行(201 + i)).join('\n') + '\n', 'utf8');

  const 二 = 存照.读(p, { 起行: 游标, 取数: 60 });
  assert.ok(二.条.every((x) => x.行序 < 游标), '第二页必须全在游标之前——行序是绝对位置，追加不影响它');
  assert.equal(二.条[59].行序, 游标 - 1);
});

// ── 形状坏行（五评击杀④：合法 JSON 但 text:null 会让整页 500）──
test('text 为 null 计入结构坏行，不让它把整页带崩', () => {
  const p = 造([说('总监', '正常'), { t: '2026-08-29T02:14:00Z', from: '项管', text: null }, 说('助理', '也正常')]);
  const r = 存照.读(p);
  assert.equal(r.ok, true, '一条形状坏行不许让整页失败');
  assert.equal(r.结构坏行, 1);
  assert.equal(r.坏行, 0, '它是合法 JSON——与解析坏行分开计数，成因不同');
  assert.equal(r.条.length, 2, '好的两条照常收');
});

test('解析坏行与结构坏行分开计数', () => {
  const p = 造([说('总监', 'a'), '{这不是 JSON', { t: 'x', from: '项管', text: 'b' }]);
  const r = 存照.读(p);
  assert.equal(r.坏行, 1, '解析失败＝写坏了');
  assert.equal(r.结构坏行, 1, 't 不可解析＝形状不对');
});

// ── 计数扫全量，不扫当前页（五评击杀⑥）────────────────────────
test('附件索引扫全文件：唯一那份在第 1 条、首屏只有最后 60 条时也找得到', () => {
  const 根 = fs.mkdtempSync(path.join(os.tmpdir(), 'cz3-'));
  const p = path.join(根, 't.jsonl');
  const 行 = [JSON.stringify(说('项管', '收口报告 TK-146\n正文……'))];
  for (let i = 0; i < 100; i++) 行.push(JSON.stringify(说('总监', '闲话 ' + i)));
  fs.writeFileSync(p, 行.join('\n') + '\n', 'utf8');

  const r = 存照.读(p, { 取数: 60 });
  assert.equal(r.条.length, 60);
  assert.ok(!r.条.some((x) => x.行序 === 1), '前提：那份附件不在首屏');
  assert.equal(r.附件数, 1, '附件索引必须扫全量，否则「只看有附件」返回空，要人工翻页才发现');
  assert.equal(r.附件[0].行序, 1);
  assert.match(r.附件[0].题, /收口报告 TK-146/);
});

test('播报计数也扫全量，与分页无关', () => {
  const 根 = fs.mkdtempSync(path.join(os.tmpdir(), 'cz4-'));
  const p = path.join(根, 't.jsonl');
  const 行 = [];
  for (let i = 0; i < 30; i++) 行.push(JSON.stringify(说('项管', '排期复判：维持 ' + i)));
  for (let i = 0; i < 80; i++) 行.push(JSON.stringify(说('总监', '话 ' + i)));
  fs.writeFileSync(p, 行.join('\n') + '\n', 'utf8');
  const r = 存照.读(p, { 取数: 60 });
  assert.equal(r.播报数, 30, '首屏 60 条里一条播报都没有，但总数必须是 30');
});

// ── 分页名额只给对话（实跑才发现：首屏 60 条里 53 条是折叠播报）────
test('名额只给对话：播报顺带捎上，不占名额', () => {
  const 根 = fs.mkdtempSync(path.join(os.tmpdir(), 'cz6-'));
  const p = path.join(根, 't.jsonl');
  const 行 = [];
  // 造一段真实比例：每 1 条对话夹 8 条播报
  for (let i = 0; i < 30; i++) {
    行.push(JSON.stringify(说('总监', '真话 ' + i)));
    for (let k = 0; k < 8; k++) 行.push(JSON.stringify(说('项管', '排期复判：维持 ' + i + '-' + k)));
  }
  fs.writeFileSync(p, 行.join('\n') + '\n', 'utf8');

  const r = 存照.读(p, { 取数: 10 });
  const 对话 = r.条.filter((x) => !x.播报).length;
  assert.equal(对话, 10, '要 10 条对话就得给够 10 条对话，不能让播报把名额吃光');
  assert.ok(r.条.length > 10, '播报顺带捎上，所以总条数会多于名额');
});

test('全是播报时有兜底，不至于把整个文件拉进来', () => {
  const 根 = fs.mkdtempSync(path.join(os.tmpdir(), 'cz7-'));
  const p = path.join(根, 't.jsonl');
  fs.writeFileSync(p, Array.from({ length: 5000 }, (_, i) => JSON.stringify(说('项管', '排期复判：维持 ' + i))).join('\n') + '\n', 'utf8');
  const r = 存照.读(p, { 取数: 10 });
  assert.ok(r.条.length <= 120, '一条对话都没有时也要收手，实得 ' + r.条.length);
  assert.equal(r.条.filter((x) => !x.播报).length, 0);
});

// ── 产出物判别（宁可少折，不可错折）──────────────────────────
test('首行像标题且含产出词 → 产出物；有句末标点的不是', () => {
  const p = 造([
    说('项管', '收口报告 TK-146\n正文……'),
    说('项管', '我把收口报告写完了。\n后面是闲话'),
    说('总监', '验收报告 TK-312\n结论：通过'),
  ]);
  const r = 存照.读(p);
  assert.equal(r.条[0].产出物, true);
  assert.equal(r.条[1].产出物, false, '首行有句末标点＝在说话，不是标题');
  assert.equal(r.条[2].产出物, true, '「验收报告」不在旧词表里也要认——判别看形态不看写死的词');
});

test('判错只是少个标记，东西仍在流里', () => {
  const p = 造([说('项管', '这是一份没写标题的长报告，' + 'x'.repeat(2000))]);
  const r = 存照.读(p);
  assert.equal(r.条.length, 1, '判不出产出物也绝不许它消失');
  assert.equal(r.条[0].产出物, false);
});

// ── 逻辑行不是视觉行（四评击杀⑥）──────────────────────────────
test('行数按 \\n 算，不按视觉换行：3000 字无换行只有 1 行', () => {
  assert.equal(存照.逻辑行数('甲'.repeat(3000)), 1, '视觉行依赖字体视口浏览器，机器判不了');
  assert.equal(存照.逻辑行数('a\nb\nc'), 3);
});

// ── 末行半行与陈旧（四评击杀④）────────────────────────────────
test('末行没有换行结尾 → 判为未闭合，不计坏行', () => {
  const 根 = fs.mkdtempSync(path.join(os.tmpdir(), 'cz5-'));
  const p = path.join(根, 't.jsonl');
  fs.writeFileSync(p, JSON.stringify(说('总监', '完整')) + '\n{"t":"2026-08-29T02:1', 'utf8');
  const r = 存照.读(p);
  assert.equal(r.末行未闭合, true);
  assert.equal(r.坏行, 0, '写方正在追加，半行不是坏行');
  assert.equal(r.条.length, 1);
});

test('末行长期不闭合要报，不许永远等下轮', () => {
  const 首见 = Date.parse('2026-08-29T02:00:00Z');
  assert.equal(存照.末行陈旧({ 首见 }, 首见 + 60000), null, '一分钟内还在等，正常');
  const r = 存照.末行陈旧({ 首见 }, 首见 + 400000);
  assert.ok(r && r.陈旧, '超阈值必须报——写方崩了就永远等下去，那一条就永久不可查');
  assert.equal(r.分钟, 7);
});

test('陈旧判定不看 mtime（写方每 4 分 59 秒补一字节的话 mtime 永远新鲜）', () => {
  const 首见 = Date.parse('2026-08-29T02:00:00Z');
  // 只给首见时刻，不给 mtime——判定完全基于首见，与文件是否被触碰无关
  assert.ok(存照.末行陈旧({ 首见 }, 首见 + 300000).陈旧);
});

// ── 读不到 ≠ 零条 ────────────────────────────────────────────
test('文件不存在 → ok:false 带因，不返回空数组冒充「查过了没有」', () => {
  const r = 存照.读(path.join(os.tmpdir(), '绝不存在-' + Date.now() + '.jsonl'));
  assert.equal(r.ok, false);
  assert.match(r.因, /读不到/);
  assert.ok(!r.条, '不许给一个空数组');
});

// ── 真数据回归 ──────────────────────────────────────────────
test('真数据：325 条读全、零坏行、ID 零碰撞', () => {
  const p = 'D:/GitHub/AI-GameStudio/监制台/遥控/thread.jsonl';
  if (!fs.existsSync(p)) return;                    // 别处跑就跳过
  const r = 存照.读(p, { 取数: 100000 });
  assert.equal(r.ok, true);
  assert.ok(r.总条数 >= 325, '实测 325 条，只增不减');
  assert.equal(r.坏行, 0);
  assert.equal(r.结构坏行, 0);
  const ids = new Set(r.条.map((x) => x.id));
  assert.equal(ids.size, r.条.length, 'ID 全量零碰撞');
  assert.ok(r.播报数 > 100 && r.播报数 < 130, '实测 115 条播报，量级对得上：' + r.播报数);
});
