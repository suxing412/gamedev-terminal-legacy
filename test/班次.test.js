// 班次.test.js — 无人值守班次的额度闸判据。
//
// 这道闸失效的代价不是「多花了钱」，是**制作人早上打开终端没得用**——
// claude 订阅是 5h/周 窗口制，夜里烧穿了白天补不回来。它偷的是人的工作时间。
// 所以三条纪律每条都要有判据顶着：
//   一 · 闸开在开班之前
//   二 · 读不到用量记录时拒绝开班（读不到 ≠ 没烧过）
//   三 · 拒绝要说得出还差多少
'use strict';
const assert = require('node:assert');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const 班次 = require('../server/lib/班次');

const 造 = (行) => {
  const 根 = fs.mkdtempSync(path.join(os.tmpdir(), 'shift-'));
  const p = path.join(根, '用量.jsonl');
  fs.writeFileSync(p, 行.map((o) => JSON.stringify(o)).join('\n') + (行.length ? '\n' : ''), 'utf8');
  return p;
};
const 今 = Date.now();
const 昨 = 今 - 26 * 3600 * 1000;

test('闸一 · 今日班次耗量累加，人在场的交互不占班次预算', () => {
  const p = 造([
    { t: new Date(今).toISOString(), 来路: '班次:自检', 出: 5000 },
    { t: new Date(今).toISOString(), 来路: '班次:自检', 出: 3000 },
    { t: new Date(今).toISOString(), 来路: '人', 出: 99999 },      // 人的交互不算
    { t: new Date(昨).toISOString(), 来路: '班次:自检', 出: 50000 }, // 昨天的不算
  ]);
  const r = 班次.今日已耗(p, 今);
  assert.equal(r.读到, true);
  assert.equal(r.出, 8000, '只该算今天的班次');
  assert.equal(r.条数, 2);
});

test('闸一 · 未达上限放行，并说得出还剩多少', () => {
  const p = 造([{ t: new Date(今).toISOString(), 来路: '班次:自检', 出: 10000 }]);
  const r = 班次.可否开班(p, 60000, 今);
  assert.equal(r.行, true);
  assert.equal(r.余, 50000);
  assert.match(r.因, /10000 \/ 60000/);
});

test('闸一 · 达到上限即拒绝——闸开在开班之前，不是事后统计', () => {
  const p = 造([{ t: new Date(今).toISOString(), 来路: '班次:自检', 出: 60000 }]);
  const r = 班次.可否开班(p, 60000, 今);
  assert.equal(r.行, false);
  assert.equal(r.余, 0);
  assert.match(r.因, /上限/);
});

test('闸二 · **读不到用量记录时拒绝开班**，不是放行（读不到 ≠ 没烧过）', () => {
  // 造一个存在但读不动的路径：拿目录当文件读，必抛 EISDIR
  const 根 = fs.mkdtempSync(path.join(os.tmpdir(), 'shift2-'));
  const r = 班次.可否开班(根, 60000, 今);
  assert.equal(r.行, false, '一个坏掉的用量文件就能让闸失效——那闸等于没有');
  assert.match(r.因, /读不到/);
});

test('闸二 · 文件不存在 = 一次都没跑过，这个可以放行（与读不动区分开）', () => {
  const 根 = fs.mkdtempSync(path.join(os.tmpdir(), 'shift3-'));
  const r = 班次.可否开班(path.join(根, '还没有.jsonl'), 60000, 今);
  assert.equal(r.行, true, '不存在与读不动是两回事，混为一谈会让首班永远开不了');
  assert.equal(r.已耗, 0);
});

test('闸三 · 拒绝的理由要带得出已耗与上限两个数', () => {
  const p = 造([{ t: new Date(今).toISOString(), 来路: '班次:夜班', 出: 75000 }]);
  const r = 班次.可否开班(p, 60000, 今);
  assert.equal(r.行, false);
  assert.match(r.因, /75000/);
  assert.match(r.因, /60000/);
});

test('坏行计数不吞，且不影响好行', () => {
  const 根 = fs.mkdtempSync(path.join(os.tmpdir(), 'shift4-'));
  const p = path.join(根, '用量.jsonl');
  fs.writeFileSync(p, JSON.stringify({ t: new Date(今).toISOString(), 来路: '班次:x', 出: 1000 }) + '\n{坏行\n', 'utf8');
  const r = 班次.今日已耗(p, 今);
  assert.equal(r.坏行, 1);
  assert.equal(r.出, 1000);
});

// ── 窗口水位闸（首班坐席自己找出来的洞）───────────────────────
// 原话：「无人值守的额度闸是空转的……闸门把『文件不存在』判为『今日已耗 0』并放行——
//        今天账户 5 小时窗口实际已烧到 33%，闸对此一无所知。钱在烧，闸看到的是 0。」
const 造额度 = (条) => {
  const 根 = fs.mkdtempSync(path.join(os.tmpdir(), 'quota-'));
  const p = path.join(根, '额度读数.jsonl');
  fs.writeFileSync(p, 条.map((o) => JSON.stringify(o)).join('\n') + '\n', 'utf8');
  return p;
};

test('窗口① 取的是最近一条该窗读数，不是第一条', () => {
  const p = 造额度([
    { t: '2026-08-29T00:00:00Z', 窗: '5小时', utilization: 5 },
    { t: '2026-08-29T03:00:00Z', 窗: '周', utilization: 9 },
    { t: '2026-08-29T07:00:00Z', 窗: '5小时', utilization: 34 },
  ]);
  const w = 班次.窗口水位(p, '5小时');
  assert.equal(w.读到, true);
  assert.equal(w.水位, 34, '取最近的那条，不是最早的');
});

test('窗口② 水位过线就拒绝——一班烧得不多，不等于烧得起', () => {
  // 时刻要用「现在」：读数陈旧会先一步拦下（窗口⑦ 专管那条），
  // 用固定旧时刻的话这条测的就不是水位线了。
  const p = 造额度([{ t: new Date(今).toISOString(), 窗: '5小时', utilization: 85 }]);
  const r = 班次.窗口可否(p, 70, '5小时', 今);
  assert.equal(r.行, false);
  assert.ok(!r.陈旧, '这条要测的是水位线，不是新鲜度');
  assert.match(r.因, /85%/);
  assert.match(r.因, /70%/);
});

test('窗口③ 水位没过线且读数新鲜就放行', () => {
  const p = 造额度([{ t: new Date(今).toISOString(), 窗: '5小时', utilization: 34 }]);
  const r = 班次.窗口可否(p, 70, '5小时', 今);
  assert.equal(r.行, true, r.因);
  assert.ok(r.龄秒 <= 5);
});

test('窗口⑦ **陈旧读数不许当成现状**——塔阵亡后最后那条会一直躺着', () => {
  // 实测：塔每 2 分钟写一条；同一份数据里最大间隔 48740 秒（13.5 小时）＝塔死掉那一段。
  // 拿死人的旧值过闸，屏上画出来的「2% / 70%」跟新鲜读数长得一模一样——
  // 比空白更坏，因为它取消了人的怀疑。
  const p = 造额度([{ t: new Date(今 - 3600 * 1000).toISOString(), 窗: '5小时', utilization: 2 }]);
  const r = 班次.窗口可否(p, 70, '5小时', 今);
  assert.equal(r.行, false, '一小时前的读数不能代表现状');
  assert.equal(r.陈旧, true);
  assert.match(r.因, /没更新|陈旧/);
  assert.match(r.因, /瞭望塔/, '要说清楚多半是谁不在写了，否则人不知道去查什么');
});

test('窗口⑧ 陈旧判定不吃掉水位本身（两条信息都要给得出）', () => {
  const p = 造额度([{ t: new Date(今 - 3600 * 1000).toISOString(), 窗: '5小时', utilization: 88 }]);
  const r = 班次.窗口可否(p, 70, '5小时', 今);
  assert.equal(r.水位, 88, '陈旧归陈旧，读到的那个数还是要报出来');
  assert.ok(r.龄秒 >= 3500);
});

test('窗口⑨ 时刻坏了当成陈旧（不许因为解析不出时刻就放行）', () => {
  const p = 造额度([{ t: '不是时刻', 窗: '5小时', utilization: 3 }]);
  const r = 班次.窗口可否(p, 70, '5小时', 今);
  assert.equal(r.行, false);
});

test('窗口④ **读不到真实水位一律不开班**（误拒可恢复，误放烧的是制作人早上要用的额度）', () => {
  const 根 = fs.mkdtempSync(path.join(os.tmpdir(), 'quota2-'));
  const r = 班次.窗口可否(path.join(根, '没有这个.jsonl'), 70);
  assert.equal(r.行, false, '读不到就放行的话，额度文件一没了闸就等于不存在');
  assert.match(r.因, /读不到|读不动/);
});

test('窗口⑤ 文件在但没有该窗的读数，也算读不到', () => {
  const p = 造额度([{ t: '2026-08-29T07:00:00Z', 窗: '周', utilization: 9 }]);
  const r = 班次.窗口可否(p, 70, '5小时');
  assert.equal(r.行, false);
  assert.match(r.因, /没有/);
});

test('窗口⑥ 坏行跳过不影响后面的好行', () => {
  const 根 = fs.mkdtempSync(path.join(os.tmpdir(), 'quota3-'));
  const p = path.join(根, '额度读数.jsonl');
  fs.writeFileSync(p, '{坏行\n' + JSON.stringify({ t: 'x', 窗: '5小时', utilization: 12 }) + '\n{又一个坏行\n', 'utf8');
  const w = 班次.窗口水位(p, '5小时');
  assert.equal(w.读到, true);
  assert.equal(w.水位, 12);
});

// ── 定点：到点了吗（纯函数）─────────────────────────────────
const 时刻 = (h, m) => { const d = new Date(); d.setHours(h, m, 0, 0); return d.getTime(); };
const 配 = (o) => Object.assign({ 启用: true, 到点: '02:00', 补跑窗口分: 120, 班次: '夜间自检', 话: '干活' }, o);

test('定点① 没到点不开班', () => {
  assert.equal(班次.到点了吗(配(), 时刻(1, 59)).到, false);
});

test('定点② 到点开班', () => {
  const r = 班次.到点了吗(配(), 时刻(2, 0));
  assert.equal(r.到, true, r.因);
});

test('定点③ 补跑窗口内仍开（兜「到点那刻机器没在」）', () => {
  assert.equal(班次.到点了吗(配(), 时刻(3, 59)).到, true);
});

test('定点④ **过点太久就不开**——补跑无上界的话下午开机会莫名跑一班夜班', () => {
  const r = 班次.到点了吗(配(), 时刻(4, 1));
  assert.equal(r.到, false);
  assert.match(r.因, /补跑窗口/);
});

test('定点⑤ 缺省关不缺省开：没配置 / 停用 / 没写活，一律不开', () => {
  assert.equal(班次.到点了吗(null, 时刻(2, 0)).到, false);
  assert.equal(班次.到点了吗(配({ 启用: false }), 时刻(2, 0)).到, false);
  assert.equal(班次.到点了吗(配({ 话: '   ' }), 时刻(2, 0)).到, false);
});

test('定点⑥ 到点写坏了不开班，并说清坏在哪（不许当成 00:00 就开）', () => {
  const r = 班次.到点了吗(配({ 到点: '两点' }), 时刻(2, 0));
  assert.equal(r.到, false);
  assert.match(r.因, /到点写坏了/);
  assert.equal(班次.到点了吗(配({ 到点: '25:00' }), 时刻(2, 0)).到, false);
});

// ── 仅星期（周末巡检）─────────────────────────────────────
// 不补这一条，周末巡检会天天跑——而天天跑的周末巡检就不是周末巡检了。
const 某日时刻 = (星期几, h, m) => {
  const d = new Date();
  d.setHours(h, m, 0, 0);
  // 挪到本周的目标星期
  d.setDate(d.getDate() + ((星期几 - d.getDay() + 7) % 7));
  return d.getTime();
};
const 周末配 = { 启用: true, 到点: '10:00', 仅星期: [0, 6], 补跑窗口分: 240, 班次: '周末巡检', 话: '干活' };

test('星期① 周六到点开班', () => {
  const r = 班次.到点了吗(周末配, 某日时刻(6, 10, 30));
  assert.equal(r.到, true, r.因);
});

test('星期② 周日到点开班', () => {
  assert.equal(班次.到点了吗(周末配, 某日时刻(0, 10, 30)).到, true);
});

test('星期③ 工作日不开班（周三）', () => {
  const r = 班次.到点了吗(周末配, 某日时刻(3, 10, 30));
  assert.equal(r.到, false);
  assert.match(r.因, /不是它该跑的日子/);
});

test('星期④ **「今天不跑」与「还没到点」的因由必须不同**——屏上要画成两样东西', () => {
  const 不该跑 = 班次.到点了吗(周末配, 某日时刻(3, 10, 30));   // 周三，到点了但不该跑
  const 没到点 = 班次.到点了吗(周末配, 某日时刻(6, 9, 30));    // 周六，还没到点
  assert.equal(不该跑.到, false);
  assert.equal(没到点.到, false);
  assert.notEqual(不该跑.因, 没到点.因, '两者用同一句话的话，屏上就分不开——周末巡检在周三没跑是正常，在周日没跑是故障');
  assert.equal(不该跑.不该跑, true, '要给上屏一个明确的标记，不能让前端去正则匹配中文因由');
  assert.ok(!没到点.不该跑);
});

test('星期⑤ 没写 仅星期 = 天天跑（缺省不收窄）', () => {
  assert.equal(班次.到点了吗({ ...周末配, 仅星期: null }, 某日时刻(3, 10, 30)).到, true);
  assert.equal(班次.到点了吗({ ...周末配, 仅星期: [] }, 某日时刻(3, 10, 30)).到, true);
});

// ── 多班：挑班次 ───────────────────────────────────────────
const 夜 = { 启用: true, 到点: '02:00', 补跑窗口分: 120, 班次: '夜间自检', 话: '干活' };
const 晨 = { 启用: true, 到点: '09:00', 补跑窗口分: 120, 班次: '晨报', 话: '干活' };

test('挑① 到点的那个被挑中', () => {
  assert.equal(班次.挑班次([夜, 晨], 时刻(2, 5)).班次, '夜间自检');
  assert.equal(班次.挑班次([夜, 晨], 时刻(9, 5)).班次, '晨报');
});

test('挑② **今天跑过的先剔掉**，否则前一班的补跑窗口会把后一班一直挡住', () => {
  // 09:05：夜班（02:00，窗口 120 分）早已过窗，本来就不该被选；
  // 但若把「跑过」判在后面，任何窗口重叠的排法都会踩这个坑。造一个真重叠的：
  const 早 = { ...夜, 到点: '08:30', 补跑窗口分: 120, 班次: '早班' };
  assert.equal(班次.挑班次([早, 晨], 时刻(9, 5)).班次, '早班', '都在窗口内时先到先得');
  assert.equal(班次.挑班次([早, 晨], 时刻(9, 5), (n) => n === '早班').班次, '晨报',
    '早班已跑过就该轮到晨报——不剔掉的话晨报永远轮不上');
});

test('挑③ 停用的、没写活的一概不看', () => {
  assert.equal(班次.挑班次([{ ...夜, 启用: false }], 时刻(2, 5)), null);
  assert.equal(班次.挑班次([{ ...夜, 话: '  ' }], 时刻(2, 5)), null);
});

test('挑④ 没到点就没有人被挑中', () => {
  assert.equal(班次.挑班次([夜, 晨], 时刻(12, 0)), null);
});

test('挑⑤ 空表 / 非数组不炸', () => {
  assert.equal(班次.挑班次([], 时刻(2, 5)), null);
  assert.equal(班次.挑班次(null, 时刻(2, 5)), null);
});

// ── 班况：八种态两两必须不同 ──────────────────────────────
// 不变量二的落点。早上看见一个灰点却不知道该查什么，就是这一格失败的样子。
test('班况① 十种态各有各的值，且两两不同', () => {
  const 日 = { 启用: true, 到点: '10:00', 补跑窗口分: 120, 班次: 'X', 话: '干活' };
  const 周末 = { ...日, 仅星期: [0, 6] };
  const 开 = { 起于: new Date(时刻(10, 1)).toISOString(), 档名: 'c.md' };
  const 态 = {
    停用: 班次.班况({ ...日, 启用: false }, 时刻(10, 30)).态,
    已跑: 班次.班况(日, 时刻(10, 30), { 收班条: { 结果: '正常收尾', 用时秒: 300, 出: 19431, 档名: 'a.md' } }).态,
    未收尾: 班次.班况(日, 时刻(10, 30), { 收班条: { 结果: '未正常收尾', 因: '超过墙钟上限被掐', 档名: 'b.md' } }).态,
    运行中: 班次.班况(日, 时刻(10, 30), { 开班条: 开, 在跑: true }).态,
    断了: 班次.班况(日, 时刻(10, 30), { 开班条: 开, 在跑: false }).态,
    被闸挡: 班次.班况(日, 时刻(10, 30), { 未开班: true }).态,
    今天不跑: 班次.班况(周末, 某日时刻(3, 10, 30)).态,
    待跑: 班次.班况(日, 时刻(9, 0)).态,
    补跑中: 班次.班况(日, 时刻(10, 30)).态,
    错过: 班次.班况(日, 时刻(23, 0)).态,
  };
  for (const [名, v] of Object.entries(态)) assert.equal(v, 名, `${名} 判成了 ${v}`);
  assert.equal(new Set(Object.values(态)).size, 10, '十种态必须两两不同：' + JSON.stringify(态));
});

test('班况④ **「断了」与「错过」必须分开**——异厂评审打的就是这一条', () => {
  // 「开了班没收尾」与「压根没开过」在只记收班的实现里长得一模一样，
  // 而它们要查的东西完全不同：一个查进程为什么被杀，一个查调度器为什么没触发。
  const 日 = { 启用: true, 到点: '10:00', 补跑窗口分: 120, 班次: 'X', 话: '干活' };
  const 断 = 班次.班况(日, 时刻(23, 0), { 开班条: { 起于: new Date(时刻(10, 1)).toISOString(), 档名: 'c.md' }, 在跑: false });
  const 过 = 班次.班况(日, 时刻(23, 0), {});
  assert.equal(断.态, '断了');
  assert.equal(过.态, '错过');
  assert.notEqual(断.说, 过.说);
  assert.match(断.说, /被杀|断电/, '要说清楚该去查什么');
  assert.ok(断.档名, '断了也要给得出档名——那份半截报告是查因的现场');
});

test('班况⑤ 运行中要报得出跑了多久，不能只说「在跑」', () => {
  const 日 = { 启用: true, 到点: '10:00', 班次: 'X', 话: '干活' };
  const r = 班次.班况(日, 时刻(10, 5), { 开班条: { 起于: new Date(时刻(10, 0)).toISOString(), 档名: 'c.md' }, 在跑: true });
  assert.equal(r.态, '运行中');
  assert.match(r.说, /300 秒/, '一班要 5–7 分钟，不给时长人就不知道该等还是该查');
});

test('班况② **错过 与 待跑 绝不能混**——一个是还没轮到，一个是这辈子没了', () => {
  const 日 = { 启用: true, 到点: '10:00', 补跑窗口分: 120, 班次: 'X', 话: '干活' };
  const 待 = 班次.班况(日, 时刻(9, 0));
  const 过 = 班次.班况(日, 时刻(23, 0));
  assert.equal(待.态, '待跑');
  assert.equal(过.态, '错过');
  assert.match(过.说, /不会再跑/, '错过要说清楚这一班今天没了，否则人会一直等');
});

test('班况③ 已跑要带得出用时与用量；用量缺失说读不到，不说 0', () => {
  const 日 = { 启用: true, 到点: '10:00', 班次: 'X', 话: '干活' };
  const 有 = 班次.班况(日, 时刻(11, 0), { 收班条: { 结果: '正常收尾', 用时秒: 309, 出: 19431, 档名: 'a.md' } });
  assert.match(有.说, /309/);
  assert.match(有.说, /19431/);
  const 无 = 班次.班况(日, 时刻(11, 0), { 收班条: { 结果: "正常收尾", 用时秒: 309, 出: null, 档名: "a.md" } });
  assert.match(无.说, /读不到/, '用量读不到时不许显示 0——把不知道画成一个具体的数是这块屏能犯的最严重的错');
  assert.ok(!/\b0 token/.test(无.说));
});

// ── 今日跑过：靠索引，不靠文件名 ────────────────────────────
// 这一条差点让 08-30 多烧一班：首版按报告文件名前缀判，给班次改个名字
// （夜间自检 → 夜间巡检）旧报告就匹配不上，同一天会再跑一班而没人发现。
test('跑过① 今天有记录就算跑过', () => {
  const 条 = [{ t: new Date(今).toISOString(), 型: '收班', 班次: '夜间巡检' }];
  assert.equal(班次.今日跑过(条, '夜间巡检', 今), true);
});

test('跑过② **开班也算跑过**——跑崩了不该被自动重跑一遍', () => {
  const 条 = [{ t: new Date(今).toISOString(), 型: '开班', 班次: '夜间巡检' }];
  assert.equal(班次.今日跑过(条, '夜间巡检', 今), true,
    '只认收班的话，一班崩一次就会被重跑一次，崩三次烧三遍');
});

test('跑过③ 昨天的不算', () => {
  const 条 = [{ t: new Date(昨).toISOString(), 型: '收班', 班次: '夜间巡检' }];
  assert.equal(班次.今日跑过(条, '夜间巡检', 今), false);
});

test('跑过④ 别的班次不算', () => {
  const 条 = [{ t: new Date(今).toISOString(), 型: '收班', 班次: '晨报' }];
  assert.equal(班次.今日跑过(条, '夜间巡检', 今), false);
});

test('跑过⑤ 空索引 / 非数组不炸，且判为没跑过', () => {
  assert.equal(班次.今日跑过([], 'X', 今), false);
  assert.equal(班次.今日跑过(null, 'X', 今), false);
});

// ── 接线（起真服务，走 HTTP；干跑档不调模型）─────────────────
// 只验 lib 不验接线，正是今晚反复吃亏的地方：08-29 一夜里三次静默失效
// 全都是「逻辑对、接线没接上」。所以这一组必须走真的 HTTP。
const http = require('node:http');
const 请求 = (port, 方法, 路径, 体) => new Promise((res, rej) => {
  const b = 体 ? Buffer.from(JSON.stringify(体), 'utf8') : null;
  const q = http.request({ host: '127.0.0.1', port, path: 路径, method: 方法,
    headers: b ? { 'Content-Type': 'application/json', 'Content-Length': b.length } : {} }, (up) => {
    let s = ''; up.setEncoding('utf8');
    up.on('data', (d) => { s += d; });
    up.on('end', () => { let j = null; try { j = JSON.parse(s); } catch { /* 非 JSON */ }
      res({ 码: up.statusCode, 体: j, 文: s }); });
  });
  q.on('error', rej);
  if (b) q.write(b);
  q.end();
});

// 一个服务给三条用例共用。**不要每条各起各关**——起关太密时端口来不及释放，
// 会得到 ECONNRESET，看起来像端点坏了，其实是判据自己的毛病（实测踩过）。
// **终端根必须显式钉死，不能靠环境。**
// 2026-08-29 15:09 实测：夜班坐席按提示词跑了这个判据文件，而**坐席继承了终端 exe 的
// PORTABLE_EXECUTABLE_DIR**，于是判据起的服务把 终端根 解析到了部署区，
// 班次报告写进了 D:/GitHub/AI-GameStudio/终端/班次/，而清理用的是仓里的路径——清了个空，
// 三份判据垃圾留在了生产目录里。
// 判据的落点取决于谁来跑它，那就不叫判据了。这里钉一个临时目录，与环境无关。
const 判据根 = fs.mkdtempSync(path.join(os.tmpdir(), 'shift-root-'));
let _服务 = null;
const 取服务 = async () => {
  if (!_服务) {
    process.env.TERMINAL_SHIFT_DRY = '1';
    process.env.TERMINAL_ROOT = 判据根;
    // 终端根 一换成空目录，情报调度就会去真抓网——实测把这个判据从 0.2 秒拖到 277 秒。
    // 判据不许依赖网络，也不许因为换了个根就顺手去抓一遍真源。
    process.env.NO_INTEL = '1';
    // 额度文件也钉死：不钉的话判据会依赖「真实 5 小时窗此刻恰好低于 70%」，
    // 水位一涨就红，而红的原因跟被测的东西毫无关系。
    // 时刻要用「现在」：新鲜度闸会把旧读数拦下（那是对的，见 窗口⑦），
    // 夹具写个假字符串的话，接线判据会红在一件跟它无关的事上。
    process.env.TERMINAL_QUOTA_FILE = 造额度([{ t: new Date().toISOString(), 窗: '5小时', utilization: 1 }]);
    _服务 = await require('../server').start();
  }
  return _服务;
};
test.after(() => {
  try { if (_服务 && _服务.server) _服务.server.close(); } catch { /* 已关 */ }
  // 判据自己的落点自己收干净——留在临时目录里也算，但别留在任何人的工作目录里
  try { fs.rmSync(判据根, { recursive: true, force: true }); } catch { /* 无害 */ }
});

// 部署区的班次目录，只用来做「判据没写进这里」的反证
const 生产班次目 = 'D:/GitHub/AI-GameStudio/终端/班次';
const 数生产 = () => { try { return fs.readdirSync(生产班次目).length; } catch { return -1; } };

test('接线① 没给活干 → 400，不开班', async () => {
  const r = await 取服务();
  const x = await 请求(r.port, 'POST', '/api/shift', { 班次: '判据' });
  assert.equal(x.码, 400);
  assert.equal(x.体.受理, false);
});

test('接线② GET 报得出闸的现状（上限与已耗），不然没人知道昨晚为什么没干活', async () => {
  const r = await 取服务();
  const x = await 请求(r.port, 'GET', '/api/shift');
  assert.equal(x.码, 200);
  assert.equal(typeof x.体.闸, 'object');
  assert.ok(Number(x.体.闸.上限) > 0, '上限要报得出来：' + JSON.stringify(x.体.闸));
  assert.ok(Array.isArray(x.体.近报));
});

test('接线③ 干跑：202 受理 → 报告落盘 → 单飞标志复位', async () => {
  const r = await 取服务();
  const 生产前 = 数生产();
  {
    const x = await 请求(r.port, 'POST', '/api/shift', { 班次: '判据干跑', 话: '这是判据，不该真调模型' });
    assert.equal(x.码, 202, JSON.stringify(x.体));
    assert.equal(x.体.受理, true);

    // 等报告落盘。落点用 判据根 算，不用 __dirname 猜——
    // 猜错的后果不是判据红，是判据绿而垃圾留在别人家里（实测发生过）。
    const 目 = path.join(判据根, '班次');
    let 档 = null;
    for (let i = 0; i < 40 && !档; i += 1) {
      await new Promise((k) => setTimeout(k, 100));
      try { 档 = (fs.readdirSync(目).filter((f) => f.includes('判据干跑')).sort().pop()) || null; } catch { /* 还没建 */ }
    }
    assert.ok(档, '干跑也必须落盘——不落的话「没有报告」既可能是没跑也可能是跑崩了，两者在盘上一样');
    const 文 = fs.readFileSync(path.join(目, 档), 'utf8');
    assert.match(文, /班次报告/);
    assert.match(文, /干跑/);
    assert.match(文, /正常收尾/, '干跑不该被当成异常');

    // 单飞标志必须复位，否则下一班永远开不了
    const g = await 请求(r.port, 'GET', '/api/shift');
    assert.equal(g.体.在跑, null, '跑完没复位的话，第二天那一班会被 409 挡住而没人知道');

    // **反证：判据不许把东西写进部署区。**
    // 08-29 15:09 实测发生过——夜班坐席跑这个判据文件时继承了终端 exe 的
    // PORTABLE_EXECUTABLE_DIR，报告写进了 D:/GitHub/AI-GameStudio/终端/班次/，
    // 而清理用的是仓里的路径，清了个空，三份垃圾留在生产目录里。
    // 判据的落点取决于谁来跑它，那就不叫判据了。
    assert.equal(数生产(), 生产前, '判据往部署区写东西了——落点必须与环境无关');

    fs.rmSync(path.join(目, 档), { force: true });
  }
});

test('报告落点带日期与班次名，且非法字符被换掉', () => {
  const p = 班次.报告路径('D:/根', '自检/夜班:一', 今);
  assert.ok(p.includes(班次.日串(今)));
  assert.ok(!/[\\/:*?"<>|]/.test(path.basename(p)), '文件名里不许留非法字符：' + path.basename(p));
  assert.ok(p.endsWith('.md'));
});

// ── 空态：一班都没有的时候，屏上说的是哪一种「没有」 ──────────────
//
// 案发（2026-08-31 内部评审 S12）：`渲染带()` 无条件先把「现在」这个钟塞进段里，
// 于是 `格 || '<p class="hint">…一个班次都没有…</p>'` 的右半边**永远不渲染**——
// 唯一那句解释是死代码。屏上只剩一个孤零零的钟，而
// (a) 没有配置文件 / (b) 配置里表是空的 / (c) 文件读坏了
// 三种情形完全同态，可它们要做的事正相反。
const { 渲染带, 渲染闸 } = require('../server/routes/班次页');

test('空态① **一班都没有时，那句解释必须真的画出来**（此前是死代码）', () => {
  const h = 渲染带([], { 行: true, 已耗: 1000, 上限: 20000, 水位: 12 });
  assert.ok(/class="hint"/.test(h), '空态那句 hint 没渲染：' + h.slice(0, 200));
  assert.ok(!/class="now"/.test(h), '一班都没有却还画了「现在」那个钟——它是插在班次之间的，没有班次就没有它的位置');
});

test('空态② 三种「没有」要说得不一样', () => {
  const 闸 = { 行: true, 已耗: 0, 上限: 20000, 水位: 5 };
  const 没配 = 渲染带([], 闸, '没有 班次.json —— 定点上工是关着的');
  const 空表 = 渲染带([], 闸, '班次.json 里的 班次表 是空的 —— 定点上工没有任何一班');
  const 坏档 = 渲染带([], 闸, '班次.json 解不开：Unexpected token —— 今晚一班都不会跑');
  assert.ok(/没有 班次.json/.test(没配));
  assert.ok(/班次表 是空的/.test(空表));
  assert.ok(/解不开/.test(坏档));
  assert.notStrictEqual(没配, 空表);
  assert.notStrictEqual(空表, 坏档);
});

test('空态③ **一班都没有时，闸位仍要显示**（「闸开着吗」照样要有答案）', () => {
  const h = 渲染带([], { 行: false, 已耗: 25000, 上限: 20000, 水位: 88, 因: '今日额度已用满' });
  assert.ok(/class="sgate/.test(h), '空态那条路把闸位整个丢了');
  assert.ok(/25\.0k/.test(h) && /88%/.test(h), '两个数都要在：' + h);
  assert.ok(/g-bad/.test(h), '闸挡着却画成了 ok');
});

test('空态④ 有班次时照旧插「现在」那个钟', () => {
  const h = 渲染带([{ 班次: '夜班', 到点: '02:00', 态: '好' }], { 行: true, 已耗: 0, 上限: 20000, 水位: 1 });
  assert.ok(/class="now"/.test(h), '有班次却没插「现在」——那条时间轴就读不出走到哪儿了');
  assert.ok(!/class="hint"/.test(h), '有班次却画了空态');
});

test('空态⑤ **读班次配 要分得出三种「没有」**（它们在屏上曾经完全同态）', () => {
  const { 读班次配 } = require('../server.js');
  const 目 = fs.mkdtempSync(path.join(os.tmpdir(), '班配-'));
  const 档 = path.join(目, '班次.json');

  // ① 文件不存在
  let r = 读班次配(档);
  assert.deepStrictEqual(r, []);
  assert.match(r.因, /没有/, '「没配」这一种没说清：' + r.因);

  // ② 文件在、格式对、表是空的
  fs.writeFileSync(档, JSON.stringify({ 班次表: [] }), 'utf8');
  r = 读班次配(档);
  assert.deepStrictEqual(r, []);
  assert.match(r.因, /空的/, '「配空了」这一种没说清：' + r.因);

  // ③ 文件在、但 JSON 坏了
  fs.writeFileSync(档, '{ 这不是 json', 'utf8');
  r = 读班次配(档);
  assert.deepStrictEqual(r, []);
  assert.match(r.因, /解不开/, '「读坏了」这一种没说清：' + r.因);

  // ④ 正常时不带因（别让空态话在有班次的时候冒出来）
  fs.writeFileSync(档, JSON.stringify({ 班次表: [{ 到点: '02:00', 班次: '夜班' }] }), 'utf8');
  r = 读班次配(档);
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r.因, undefined);

  // ⑤ 因 不可枚举——否则每条 deepStrictEqual([]) 都会莫名其妙地红
  fs.writeFileSync(档, JSON.stringify({ 班次表: [] }), 'utf8');
  assert.ok(!Object.keys(读班次配(档)).includes('因'));

  fs.rmSync(目, { recursive: true, force: true });
});
