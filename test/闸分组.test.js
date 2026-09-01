// 闸分组.test.js — 左栏「等你拍板」分堆。
//
// 案发 2026-08-31：制作人指着文稿台那张"文档堆积不给我分类"的截图说"类似的情况
// 要求你在优化过程中去进行寻找和改进"。左栏是同一种病，而且更硬：
//   · 实测在架 36 单 + 25 机制 = 61 个按钮摊在一个 340px 宽的常驻栏里，
//     一屏放得下 6 个，要滚将近四千像素才看得完。
//   · 36 单里 36 单都逾期（阈 24h，中位 129h）。三档染色全落在最深那档，
//     **全红等于没红**——染色表达的信息量正好是零。
//   · 同一闸位的 24 单动作键完全相同（G3 全是"验收：通过归档／打回"）。
//     摊成 24 条，等于把一次批量处置误报成 24 个待决定。
'use strict';
const assert = require('node:assert');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const { 久档, 组形, 分闸组, 该收 } = require('../public/闸分组.js');

// 照 2026-08-31 19:00 /api/gates 的真实形状造样本：
// G3×24（最久 311h=13天，其余 140h 上下）、G26×11、G2×1，阈 24h。
function 造单() {
  const 出 = [{ id: 'TK-180', title: '手修工具交互层重构·调研需求单', 闸号: 'G3', 闸名: '保留单/散单终审', 动作键: '验收', 指引: '通过归档／打回', 停摆小时: 311.1 }];
  for (let i = 0; i < 23; i++) 出.push({ id: 'TK-2' + (10 + i), title: '单 ' + i, 闸号: 'G3', 闸名: '保留单/散单终审', 动作键: '验收', 指引: '通过归档／打回', 停摆小时: 147 - i });
  for (let i = 0; i < 11; i++) 出.push({ id: 'TK-3' + (10 + i), title: '停靠 ' + i, 闸号: 'G26', 闸名: '停靠单候裁', 动作键: '解除停靠', 指引: '解除停靠／废弃', 停摆小时: 120 - i });
  出.push({ id: 'TK-400', title: '待处理', 闸号: 'G2', 闸名: '待处理拍板', 动作键: '定夺', 指引: '接受／给方向／打回', 停摆小时: 90 });
  return 出;
}
function 造机() {
  const 节们 = ['界面重构（当前主线，环环相扣）', '协议与提案', '7.1 卡着产线的（有直接产出代价）', '7.2 机制缺口（不改则同类事故复发）'];
  const 出 = [];
  for (let i = 0; i < 10; i++) 出.push({ 号: i + 1, 题: '需讨论 ' + i, 型名: '需讨论', 节: 节们[i % 4], 说明: 'x' });
  for (let i = 0; i < 15; i++) 出.push({ 号: 20 + i, 题: '一句话 ' + i, 型名: '一句话', 节: 节们[i % 4], 说明: 'y' });
  return 出;
}

// ── 一、久档：四档，且第四档真的把离群那条挑得出来 ───────────────

test('守① **四档不是凑数**：真实数据下，13 天那条必须与 5 天那堆分开', () => {
  const 单 = 造单();
  const 档们 = 单.filter((d) => d.闸号 === 'G3').map((d) => 久档(d.停摆小时, 24));
  assert.strictEqual(档们[0], 3, 'TK-180（311h = 12.9 天 ≥ 7×24）应落最高档');
  const 其余 = new Set(档们.slice(1));
  assert.deepStrictEqual([...其余], [2], '其余 23 单（140h 上下）应落第三档');
  assert.ok(!其余.has(3), '**离群那条必须与大部队分档**——分不开的话染色就白染了');
});

test('守①b 档界就在 阈 / 3阈 / 7阈 上（差一小时就该换档）', () => {
  assert.strictEqual(久档(23.9, 24), 0);
  assert.strictEqual(久档(24, 24), 1);
  assert.strictEqual(久档(71.9, 24), 1);
  assert.strictEqual(久档(72, 24), 2);
  assert.strictEqual(久档(167.9, 24), 2);
  assert.strictEqual(久档(168, 24), 3);
  // 阈跟着服务端走，不能写死 24
  assert.strictEqual(久档(24, 8), 2, '阈=8 时 24h 恰是 3×阈 ⇒ 第三档');
  assert.strictEqual(久档(56, 8), 3, '阈=8 时 56h 是 7×阈 ⇒ 第四档');
});

// ── 二、组形：全组同档时要说得出"这时候底色没用" ────────────────

test('守② **全组同档就把底色收掉**（36 单全红等于没红，这是本次返工的起因）', () => {
  const 齐 = 组形([{ 停摆小时: 100 }, { 停摆小时: 110 }, { 停摆小时: 140 }], 24);
  assert.strictEqual(齐.齐, true, '三条都在第三档，底色区分不了任何东西，应报 齐');
  const 不齐 = 组形([{ 停摆小时: 100 }, { 停摆小时: 311 }], 24);
  assert.strictEqual(不齐.齐, false, '一条第三档一条第四档，底色仍在干活，不能收');
  const 轻 = 组形([{ 停摆小时: 30 }, { 停摆小时: 40 }], 24);
  assert.strictEqual(轻.齐, false, '**只在重档上收底色**——都才刚过阈的时候，底色本来就是浅的，收了反而看不出逾期');
  assert.strictEqual(组形([{ 停摆小时: 300 }], 24).齐, false, '只有一条时无所谓齐不齐，别把独苗的底色也收了');
});

test('守②b 组形报的是形状不是感觉：最久/中位/逾期数三个都得对', () => {
  const s = 组形([{ 停摆小时: 10 }, { 停摆小时: 50 }, { 停摆小时: 300 }, { 停摆小时: 100 }], 24);
  assert.strictEqual(s.总, 4);
  assert.strictEqual(s.最久, 300);
  assert.strictEqual(s.逾期, 3, '10h 没到阈，不算逾期');
  assert.ok(s.中位 === 100, '排序后取中位，实得 ' + s.中位);
});

// ── 三、分闸组：下标不能乱，这是"带错单"的产地 ────────────────

test('守③ **分堆后每条的 i 仍指向扁平 闸表 里的它自己**（带单/数字键都按这个取）', () => {
  const 单 = 造单(); const 机 = 造机();
  const 闸表 = [...单.map((d) => ({ ...d, 类: '单' })), ...机.map((d) => ({ ...d, 类: '机' }))];
  const 组们 = 分闸组(单, 机, 24, '全');
  let 数 = 0;
  for (const z of 组们) {
    for (const { d, i } of z.项) {
      数++;
      const 应 = 闸表[i];
      assert.ok(应, `下标 ${i} 越界`);
      if (z.类 === '单') assert.strictEqual(应.id, d.id, `第 ${i} 项对不上：闸表是 ${应.id}，组里是 ${d.id}`);
      else assert.strictEqual(应.号, d.号, `第 ${i} 项对不上：闸表是第 ${应.号} 条，组里是第 ${d.号} 条`);
    }
  }
  assert.strictEqual(数, 61, '61 件事一件都不能在分堆时丢掉');
  const 见过 = new Set(组们.flatMap((z) => z.项.map((p) => p.i)));
  assert.strictEqual(见过.size, 61, '**下标不许重复**——重复意味着有两条按钮点下去带的是同一张单');
});

test('守③b 机制的下标要偏过单据的长度（两类共用一张扁平表）', () => {
  const 组们 = 分闸组(造单(), 造机(), 24, '全');
  const 机组 = 组们.filter((z) => z.类 === '机');
  const 最小 = Math.min(...机组.flatMap((z) => z.项.map((p) => p.i)));
  assert.strictEqual(最小, 36, '36 张单在前，机制第一条的下标应是 36，实得 ' + 最小);
});

// ── 四、分堆本身：分出来的堆要能真的减少"看完要多久" ──────────

test('守④ **61 件事收进 5 个组头**（这一栏的价值就在这个数上）', () => {
  const 组们 = 分闸组(造单(), 造机(), 24, '全');
  assert.strictEqual(组们.length, 5, '3 个闸位 + 2 个型 = 5，实得 ' + 组们.map((z) => z.名).join(' / '));
  const 总 = 组们.reduce((n, z) => n + z.计, 0);
  assert.strictEqual(总, 61);
});

test('守④b 单据按闸位分，且组头拿得到这一闸的动作（24 单同一个动作 = 一次批量）', () => {
  const 组们 = 分闸组(造单(), [], 24, '全');
  const g3 = 组们.find((z) => z.键 === '单.G3');
  assert.ok(g3, '没有按闸号分出 G3 组');
  assert.strictEqual(g3.计, 24);
  assert.strictEqual(g3.动, '通过归档／打回', '**组头必须说得出这一组要做什么**——它现在只藏在 title 里，壳内没人会去悬停');
  assert.strictEqual(组们.find((z) => z.键 === '单.G26').动, '解除停靠／废弃');
  assert.strictEqual(组们.find((z) => z.键 === '单.G2').动, '接受／给方向／打回');
});

test('守④c 大组在前；同样大时按闸号排（每轮轮询顺序不许自己变）', () => {
  const 组们 = 分闸组(造单(), [], 24, '全').filter((z) => z.类 === '单');
  assert.deepStrictEqual(组们.map((z) => z.键), ['单.G3', '单.G26', '单.G2']);
  // 同样大：两个各 2 单的闸位，顺序只能由闸号定，不能由 Map 插入序定
  const 同 = [
    { id: 'a', 闸号: 'GB', 停摆小时: 1 }, { id: 'b', 闸号: 'GA', 停摆小时: 1 },
    { id: 'c', 闸号: 'GB', 停摆小时: 1 }, { id: 'd', 闸号: 'GA', 停摆小时: 1 },
  ];
  assert.deepStrictEqual(分闸组(同, [], 24, '全').map((z) => z.键), ['单.GA', '单.GB'],
    '**同样大的组顺序必须稳定**——不稳的话这一栏每 5 秒自己重排一次，眼睛没法跟');
});

test('守④d 机制按型分，组内按节聚拢（同一话题挨在一起才想得完）', () => {
  const 组们 = 分闸组([], 造机(), 24, '全');
  assert.deepStrictEqual(组们.map((z) => z.名).sort(), ['一句话', '需讨论']);
  const 讨 = 组们.find((z) => z.名 === '需讨论');
  assert.strictEqual(讨.计, 10);
  assert.strictEqual(讨.节数, 4, '组头要报跨几节');
  const 节序 = 讨.项.map((p) => p.d.节);
  // 同一节的必须连续出现
  const 见 = new Map();
  节序.forEach((n, i) => { if (!见.has(n)) 见.set(n, [i, i]); else 见.get(n)[1] = i; });
  for (const [n, [起, 止]] of 见) {
    const 段内 = 节序.slice(起, 止 + 1);
    assert.ok(段内.every((x) => x === n), `节「${n}」被打散了：${节序.join(' | ')}`);
  }
});

// ── 五、筛选 ────────────────────────────────────────────────────

test('守⑤ 筛「单」只出单据、筛「机」只出机制，且下标不跟着筛法漂移', () => {
  const 单 = 造单(); const 机 = 造机();
  const 只单 = 分闸组(单, 机, 24, '单');
  assert.ok(只单.every((z) => z.类 === '单'));
  assert.strictEqual(只单.reduce((n, z) => n + z.计, 0), 36);

  const 只机 = 分闸组(单, 机, 24, '机');
  assert.ok(只机.every((z) => z.类 === '机'));
  assert.strictEqual(只机.reduce((n, z) => n + z.计, 0), 25);
  // **筛完的下标要和全量时一样**：筛只是不画，不是重新编号。
  const 全 = 分闸组(单, 机, 24, '全');
  const 位 = new Map(全.flatMap((z) => z.项.map((p) => [p.d.id || ('机' + p.d.号), p.i])));
  for (const z of 只机) for (const p of z.项) {
    assert.strictEqual(p.i, 位.get('机' + p.d.号), `筛后第 ${p.d.号} 条的下标漂了`);
  }
});


// ── 五点五、折叠默认：一栏之内"看完要多久" ────────────────────

test('守⑤b **大堆默认收起，小堆默认摊开**（全展开实测 4542px，五屏半的墙）', () => {
  assert.strictEqual(该收(new Map(), '单.G3', 24, '全'), true, '24 单的堆默认摊开 = 把墙原样还回去');
  assert.strictEqual(该收(new Map(), '单.G2', 1, '全'), false, '只有 1 条还收起来，是拿一次点击换零');
  assert.strictEqual(该收(new Map(), 'x', 8, '全'), false, '刚好 8 条：一屏放得下，摊开');
  assert.strictEqual(该收(new Map(), 'x', 9, '全'), true);
});

test('守⑤c **他自己翻过的永远压过默认**（不然每轮轮询都把他展开的又收回去）', () => {
  const 记 = new Map([['单.G3', false], ['单.G2', true]]);
  assert.strictEqual(该收(记, '单.G3', 24, '全'), false, '记着展开的 24 单堆，不许因为大又收回去');
  assert.strictEqual(该收(记, '单.G2', 1, '全'), true, '记着收起的 1 条堆，也不许因为小又摊开');
});

test('守⑤d 筛窄之后不再替他收起（他刚亲手筛完，再收就是让他点两次）', () => {
  assert.strictEqual(该收(new Map(), '机.一句话', 15, '机'), false);
  assert.strictEqual(该收(new Map(), '机.一句话', 15, '全'), true, '不筛时 15 条仍按大小收起');
  // 但记过的仍然压过筛选态
  assert.strictEqual(该收(new Map([['机.一句话', true]]), '机.一句话', 15, '机'), true);
});

test('守⑤e 记态用普通对象也认（localStorage 存的是 JSON 对象，不是 Map）', () => {
  assert.strictEqual(该收({ 'x': false }, 'x', 99, '全'), false);
  assert.strictEqual(该收({ 'x': true }, 'x', 1, '全'), true);
  assert.strictEqual(该收({}, 'x', 99, '全'), true);
});

// ── 六、接线：前端与判据用的必须是同一份 ────────────────────────

test('守⑥ **app.js 不许自己再写一份分堆**（两处各写一份，两边口径迟早分家）', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  assert.match(src, /self\.闸分组/, 'app.js 应当用 public/闸分组.js，而不是自己实现');
  assert.ok(!/function\s+久档\s*\(/.test(src), 'app.js 里又定义了一份 久档');
  assert.ok(!/function\s+组形\s*\(/.test(src), 'app.js 里又定义了一份 组形');
  assert.ok(!/function\s+该收\s*\(/.test(src), 'app.js 里又定义了一份 该收');
});

test('守⑥b 闸分组.js 在 index.html 里排在 app.js 之前（app.js 顶层就解构它）', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const a = html.indexOf('闸分组.js'); const b = html.indexOf('src="app.js"');
  assert.ok(a >= 0, 'index.html 没引 闸分组.js —— 前端会在 self.闸分组 上炸，整个左栏一片空白');
  assert.ok(a < b, '闸分组.js 必须排在 app.js 之前，实得 ' + a + ' vs ' + b);
});

test('守⑥c 数字键 1–9 已随左栏删除，且没有留下半个能用的版本', () => {
  // 这条判据原来盯的是「数字键选的是看得见的第 N 条，不是闸表的第 N 项」——
  // 折叠之后两者会分家，按 2 带上一条屏幕上没有的单，比没反应更难查。
  //
  // 2026-09-02 拆栏：那一栏成了 /gate 独立页，而在那一页上「第 N 条」这个说法
  // 本身就不成立（一屏几十条，1–9 覆盖不到）。**功能删了，判据跟着改口径**：
  // 现在要挡的是「删了一半」——键还绑着、只对前九条生效，
  // 那种半个能用的快捷键让人以为按 5 一定选到第五条，比没有坏。
  //
  // 行级「点哪条带哪条」这条性质没有消失，它在 跑道.js 的 J5 里由行为判据盯着。
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  assert.ok(!/e\.key >= '1' && e\.key <= '9'/.test(src),
    '数字键分支还在 app.js 里 —— 左栏已经不在了，它选不到任何东西');
  assert.ok(!/上带/.test(src), '上带 还在 —— 它带的是 闸表 的下标，而那一栏已经拆走');
  const gate = fs.readFileSync(path.join(__dirname, '..', 'public', '人闸.js'), 'utf8');
  assert.ok(!/e\.key >= '1'/.test(gate),
    '数字键在 /gate 上复活了 —— 一屏几十条，1–9 只覆盖前九条，那是半个能用的快捷键');
});

// ── 五、动 与 动键：长短两份，一次分堆产出 ──────────────────
//
// 案由（2026-09-02 拆栏当天）：顶条那 232px 的轨取了 `z.动`，
// 而 `动` 是**指引**「通过归档／打回」不是**动作键**「验收」。
// 屏上当场写出「24通过归档／打回 · 1接受／给方向／打回 · 11解除停靠／废弃」，
// 溢出并把年龄章（原则三"逾期会变重"的唯一载体）挤出可视区。
// 两处要的长短不同是事实，**但必须出自同一次分堆**——各自 slice 才是真的会分家。

test('守⑦ 分闸组 同时给出 动（指引，长）与 动键（动作键，短）', () => {
  const g3 = 分闸组(造单(), [], 24, '全').find((z) => z.键 === '单.G3');
  assert.ok(g3, '没有 G3 组');
  assert.strictEqual(g3.动, '通过归档／打回', '动 应当是指引（组注要说清"要你做什么"）');
  assert.strictEqual(g3.动键, '验收', '动键 应当是动作键（顶条那条轨只装得下短的）');
  assert.notStrictEqual(g3.动, g3.动键, '两者相同就说明其中一个取错了源');
});

test('守⑦b 三个闸位的动键拼起来要落在顶条那 232px 的轨里', () => {
  // 这条是"宽度"这件事在纯 Node 侧唯一验得动的部分：**字数**。
  // 真实布局要壳内那条（Chromium 124 算嵌套宽与 Chrome 不一样），
  // 但字数这一关如果就过不了，壳内那条根本没必要跑。
  const 组们 = 分闸组(造单(), [], 24, '全').filter((z) => z.类 === '单');
  const 串 = 组们.slice(0, 3).map((z) => z.计 + z.动键).join(' · ');
  // 12px Cascadia Mono：ASCII 7.03 / CJK 12.00；轨 232 减去年龄章 38 与间隙 12 ＝ 182
  const 宽 = [...串].reduce((w, c) => w + (c.charCodeAt(0) > 255 ? 12 : 7.03), 0);
  assert.ok(宽 <= 182, `实得「${串}」估宽 ${Math.round(宽)}px，超过 182px 可用宽`);
});

test('守⑦c 动作键缺了就回落到指引，回落不到就回落到闸名（不许出 null）', () => {
  const 无键 = [{ id: 'X', title: 't', 闸号: 'G9', 闸名: '某闸', 指引: '给个方向', 停摆小时: 5 }];
  const z = 分闸组(无键, [], 24, '全').find((x) => x.键 === '单.G9');
  assert.ok(!/null|undefined/.test(String(z.动键) + String(z.动)),
    `实得 动=${z.动} 动键=${z.动键} —— 屏上出现 null 就是把 bug 印给人看`);
});
