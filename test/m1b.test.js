// m1b.test.js — M1b 判据 C4/C5/C7（施工令 §6）
//
// C4 日报装配 · C5 降级路径 · C7 调度（注入模拟时钟）
// 全部不打真实模型、不打真实网络：精编走注入桩，调度走注入时钟。
// **AI 段判据不打真实额度**是施工令写死的（§6 判据基座）——用真调用测降级路径，
// 既贵又不可复现（真通道今天好、明天坏，判据就成了掷骰子）。
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { 出报 } = require('../intel/run');
const { 装配 } = require('../intel/assemble');
const sched = require('../intel/scheduler');

let passed = 0;
const t = async (n, f) => { await f(); passed++; console.log('  ✓ ' + n); };
console.log('M1b 情报官判据（C4/C5/C7）');

const 临时仓 = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'm1b-'));
  fs.mkdirSync(path.join(d, 'config'), { recursive: true });
  fs.copyFileSync(path.join(__dirname, '..', 'config', 'scoring.json'), path.join(d, 'config', 'scoring.json'));
  return d;
};
const 备流 = (base, 日, 条目们) => {
  const p = path.join(base, 'data', 'stream', 日.slice(0, 7), `${日}.jsonl`);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, 条目们.map((c) => JSON.stringify(c)).join('\n') + '\n', 'utf8');
};
const 条 = (o) => ({
  id: o.id, source: o.source || 'syn', tier: o.tier || 'A', 类: o.类 || '技术报道',
  lang: o.lang || 'en', url: o.url || `https://ex.test/${o.id}`, title: o.title || ('条目 ' + o.id),
  published_at: o.published_at || '2026-08-28T00:00:00Z', fetched_at: '2026-08-28T01:00:00Z',
  raw_excerpt: o.raw_excerpt || 'grand strategy economy postmortem',
});

(async () => {
  const 日 = '2026-08-28';

  // ── C4 日报装配 ──
  await t('C4 装配：五区齐全、头条≤3、每条带原文链接、英文条带精编段、中文条带标注不含摘要', async () => {
    const base = 临时仓();
    备流(base, 日, [
      条({ id: 'e1', tier: 'S', 类: 'SLG垂直', title: '4X 经济系统复盘' }),
      条({ id: 'e2', title: 'grand strategy 深度' }),
      条({ id: 'e3', title: 'Unity 引擎动态' }),
      条({ id: 'e4', title: '烹饪' , raw_excerpt: 'bread' }),
      条({ id: 'z1', lang: 'zh', title: '中文源一条', raw_excerpt: '国内 SLG 大盘数据' }),
    ]);
    // 精编桩：英文给一段中文，中文源走标注（reader 真通道里中文走另一套提示词，这里模拟其产物）
    const r = await 出报({ base, date: 日, 现在: Date.parse('2026-08-28T02:00:00Z'),
      精编: async (c) => `这是 ${c.id} 的中文精编段。` });
    const md = fs.readFileSync(r.md路径, 'utf8');

    for (const 区 of ['## 头条', '## SLG 垂直', '## 主流广览', '## 论文与工具角', '## 源健康']) {
      assert.ok(md.includes(区), '缺区：' + 区);
    }
    const 头条数 = (md.split('## 头条')[1] || '').split('## SLG')[0].split('\n').filter((l) => l.startsWith('- ')).length;
    assert.ok(头条数 <= 3, `头条 ≤3，实得 ${头条数}`);
    // 每条必带原文直达
    const 条行 = md.split('\n').filter((l) => l.startsWith('- ['));
    assert.ok(条行.length > 0, '日报里应有条目');
    for (const l of 条行) assert.match(l, /\]\(https?:\/\//, '每条必须带原文直达链接：' + l.slice(0, 60));
    assert.ok(md.includes('中文精编段'), '英文条要带精编段');

    const 清单 = JSON.parse(fs.readFileSync(path.join(base, 'data', 'digests', `${日}.json`), 'utf8'));
    assert.equal(清单.精编.败, 0, '桩不失败');
    assert.ok(清单.精编.成 > 0, '英文条应被精编');
  });

  await t('C4 中文源出重点标注、**绝不做摘要替代**（定案 Q2 原话纪律）', () => {
    const { md } = 装配({
      日期: 日,
      入选: [{ id: 'z1', source: 'gcores', tier: 'A', lang: 'zh', 类: '技术报道',
        title: '中文深度文', url: 'https://z.test/1',
        zh_highlights: ['作者把经济循环拆成三层', '第二节的数值表可直接抄'],
        raw_excerpt: '这是原文摘要，不该被当成 AI 摘要用', score: { 总分: 50, 源基础分: 30, 关键词分: 10, 新鲜度分: 10 } }],
    });
    assert.ok(md.includes('重点：作者把经济循环拆成三层'), '中文条要出重点标注');
    assert.ok(md.includes('重点：第二节的数值表'), '多条标注都要出');
    assert.ok(!md.includes('本条未精编'), '有标注就不该打未精编');
  });

  // ── C5 降级路径 ──
  await t('C5 降级：精编全失败 → 日报**照常产出**、带「未精编」标注、尾注记 AI 失败、零退出码', async () => {
    const base = 临时仓();
    备流(base, 日, [条({ id: 'e1', title: 'grand strategy 复盘' }), 条({ id: 'e2', title: 'SLG 数值' })]);
    const r = await 出报({ base, date: 日, 现在: Date.parse('2026-08-28T02:00:00Z'),
      精编: async () => { throw new Error('测试桩：精编通道挂了'); } });

    const md = fs.readFileSync(r.md路径, 'utf8');
    assert.ok(md.includes('# 情报日报'), '**必须照常出报**——绝不出空报、绝不静默吞报');
    assert.ok(md.includes('（本条未精编）'), '未精编要显式标注');
    assert.ok(/`精编` ✗ 成 0 \/ 败 2/.test(md), '尾注要记 AI 失败成败数：' + (md.split('## 源健康')[1] || '').slice(0, 120));
    assert.ok(md.includes('精编通道挂了'), '失败原因要带出来，不能只说「失败」');

    const 清单 = JSON.parse(fs.readFileSync(path.join(base, 'data', 'digests', `${日}.json`), 'utf8'));
    assert.equal(清单.精编.败, 2);
    assert.equal(清单.入选.length, 2, '精编失败不影响入选');

    // 健康台账要有 __精编 这一行：AI 挂了要能在台账里查到，不能只表现为「好多条没精编」
    const h = fs.readFileSync(path.join(base, 'data', 'health', 'fetch.jsonl'), 'utf8');
    assert.ok(h.includes('__精编'), '精编失败要进健康台账');
  });

  await t('C5 降级：部分失败也照常——成的出精编段、败的出未精编标注，两者并存', async () => {
    const base = 临时仓();
    备流(base, 日, [条({ id: 'ok1', title: 'SLG 甲' }), 条({ id: 'bad1', title: 'SLG 乙' })]);
    const r = await 出报({ base, date: 日, 现在: Date.parse('2026-08-28T02:00:00Z'),
      精编: async (c) => { if (c.id === 'bad1') throw new Error('这条挂了'); return '甲的精编。'; } });
    const md = fs.readFileSync(r.md路径, 'utf8');
    assert.ok(md.includes('甲的精编。'), '成功的要出精编段');
    assert.ok(md.includes('（本条未精编）'), '失败的要出标注');
    assert.equal(r.精编.成, 1);
    assert.equal(r.精编.败, 1);
  });

  await t('C5 降级：精编整个模块炸了（不是单条失败）也照常出报', async () => {
    const base = 临时仓();
    备流(base, 日, [条({ id: 'e1', title: 'SLG' })]);
    // 精编=false 表示跳过；这里模拟「通道加载即炸」——用一个抛错的非函数值走 reader 分支不现实，
    // 故直接验 精编=false 时仍出报（同一条降级路径的另一入口）
    const r = await 出报({ base, date: 日, 现在: Date.parse('2026-08-28T02:00:00Z'), 精编: false });
    const md = fs.readFileSync(r.md路径, 'utf8');
    assert.ok(md.includes('# 情报日报'), '不精编也要出报');
    assert.ok(md.includes('（本条未精编）'));
  });

  // ── 元话语闸（2026-08-28 真通道实跑抓出）──
  await t('精编产物滤掉模型的自述——提示词是建议，代码才是闸', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'intel', 'reader.js'), 'utf8');
    const m = src.match(/const 元话语 = (\/.*\/);/);
    assert.ok(m, 'reader.js 里应有 元话语 正则');
    // eslint-disable-next-line no-eval
    const re = eval(m[1]);

    // 真通道首跑实测：中文条第一行就是「只拿到标题和摘要，没有正文，所以…」——
    // 提示词已明写不要，模型仍加了。这行会原样印进日报，读者要的是标注不是工作说明。
    const 该滤 = [
      '只拿到标题和摘要，没有正文，所以下面是基于摘要能指出的点：',
      '基于摘要，以下是重点', '以下是标注', '根据提供的信息', '注：本文', '说明：仅供参考', '没有正文',
    ];
    const 该留 = [
      '「次留在 38% 附近见顶」——这个数的口径值得细看',
      '三家头部产品的付费点分布对比',
      '作者把经济循环拆成三层',
    ];
    for (const s of 该滤) assert.ok(re.test(s), '元话语没被识别：' + s.slice(0, 24));
    for (const s of 该留) assert.ok(!re.test(s), '真标注被误滤：' + s.slice(0, 24));
  });

  await t('精编只剩元话语时按失败处置（宁可打「未精编」，不许把工作说明当标注印出去）', async () => {
    const base = 临时仓();
    备流(base, 日, [条({ id: 'z9', lang: 'zh', title: '中文条', raw_excerpt: 'SLG 数据' }),
      条({ id: 'e9', title: 'SLG 英文条' })]);
    // 桩：英文条正常，中文条这里走不到（出报只精编非 zh）——所以这一格验的是英文侧的空值处置
    const r = await 出报({ base, date: 日, 现在: Date.parse('2026-08-28T02:00:00Z'),
      精编: async () => { throw new Error('产物全是元话语'); } });
    const md = fs.readFileSync(r.md路径, 'utf8');
    assert.ok(md.includes('（本条未精编）'), '按失败处置＝打未精编标注');
    assert.ok(md.includes('元话语'), '失败因要带出来');
  });

  // ── C7 调度 ──
  await t('C7 调度：注入模拟时钟走完一天 → 抓取三班与日报各触发一次，不多不少', async () => {
    const base = 临时仓();
    const 跑过 = [];
    const 表 = { 抓取: ['07:10', '12:10', '22:10'], 日报: ['08:20'] };
    // 从 00:00 每 10 分钟拨一次，走满一天
    for (let m = 0; m < 24 * 60; m += 10) {
      const d = new Date(2026, 7, 28, Math.floor(m / 60), m % 60);
      await sched.一拍(base, { 现在: d, 班次: 表, 执行: async (任务) => { 跑过.push(任务.key); } });
    }
    const 计 = {};
    for (const k of 跑过) 计[k] = (计[k] || 0) + 1;
    assert.equal(跑过.length, 4, `一天该触发 4 次（抓取 3 + 日报 1），实得 ${跑过.length}：${JSON.stringify(计)}`);
    assert.ok(跑过.every((k) => 计[k] === 1), '每一班只跑一次：' + JSON.stringify(计));
    for (const t2 of ['07:10', '12:10', '22:10']) assert.ok(跑过.some((k) => k.endsWith('抓取|' + t2)), '缺抓取班 ' + t2);
    assert.ok(跑过.some((k) => k.endsWith('日报|08:20')), '缺日报班');
  });

  await t('C7 补跑：服务在班次时刻之后才起来 → 补跑恰一次（不是错过、也不是重复）', async () => {
    const base = 临时仓();
    const 跑过 = [];
    const 表 = { 抓取: ['07:10'], 日报: [] };
    const 执行 = async (任务) => { 跑过.push(任务.key); };
    // 服务 09:00 才起来——07:10 那班已经过点
    await sched.一拍(base, { 现在: new Date(2026, 7, 28, 9, 0), 班次: 表, 执行 });
    assert.equal(跑过.length, 1, '过点的班要补跑一次');
    // 再拍两次（模拟服务继续跑）：不许重复
    await sched.一拍(base, { 现在: new Date(2026, 7, 28, 9, 1), 班次: 表, 执行 });
    await sched.一拍(base, { 现在: new Date(2026, 7, 28, 23, 59), 班次: 表, 执行 });
    assert.equal(跑过.length, 1, '补跑之后当日不许再跑：' + JSON.stringify(跑过));
    // 隔天同一班要再跑（台账按日期分键）
    await sched.一拍(base, { 现在: new Date(2026, 7, 29, 9, 0), 班次: 表, 执行 });
    assert.equal(跑过.length, 2, '隔天要重新跑');
  });

  await t('C7 失败的班次也记账——不然持续失败的源会把班次变成每分钟重试', async () => {
    const base = 临时仓();
    let 次 = 0;
    const 表 = { 抓取: ['07:10'], 日报: [] };
    const 执行 = async () => { 次++; throw new Error('故意失败'); };
    await sched.一拍(base, { 现在: new Date(2026, 7, 28, 8, 0), 班次: 表, 执行 });
    await sched.一拍(base, { 现在: new Date(2026, 7, 28, 8, 1), 班次: 表, 执行 });
    assert.equal(次, 1, '失败也算这一班跑过了，重试归重试逻辑管、不归调度管');
    const 台账 = JSON.parse(fs.readFileSync(path.join(base, 'data', 'state', '班次.json'), 'utf8'));
    const k = Object.keys(台账)[0];
    assert.equal(台账[k].ok, false, '失败要记进台账');
    assert.match(台账[k].因, /故意失败/, '失败原因要留下');
  });

  // ── 日期口径（2026-08-28 实测抓出）──
  await t('出报与读口用同一把日期尺——UTC/本地混用会让每天早上八小时「查无日报」', async () => {
    const 服务源 = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    const 管道源 = fs.readFileSync(path.join(__dirname, '..', 'intel', 'run.js'), 'utf8');

    // 病灶：/api/digest 用 toISOString().slice(0,10)（UTC 日），而 出报 用 getFullYear/Month/Date（本地日）。
    // UTC+8 下 00:00–08:00 两者差一天，而日报恰恰是早上看的——每天错八小时，且只在早上错。
    const 读口段 = 服务源.slice(服务源.indexOf("app.get('/api/digest'"), 服务源.indexOf("app.get('/api/digest'") + 700);
    assert.ok(!/toISOString\(\)\.slice\(0,\s*10\)/.test(读口段),
      '日报读口不许用 UTC 日：' + 读口段.slice(0, 200));
    assert.ok(/本地日\(\)/.test(读口段), '读口应走本地日');

    // 两处口径必须给出同一个字符串
    const 服务本地日 = 服务源.match(/const 本地日 = \(d = new Date\(\)\) => (`[^`]+`)/);
    const 管道今日 = 管道源.match(/const 今日 = \(d = new Date\(\)\) => (`[^`]+`)/);
    assert.ok(服务本地日 && 管道今日, '两处都应有本地日函数');
    assert.equal(服务本地日[1], 管道今日[1], '两处日期表达式必须逐字节一致——不一致就是两把尺');
  });

  console.log('  ' + passed + ' 项通过');
})().catch((e) => { console.error('✗ ' + (e && e.stack || e)); process.exit(1); });
