// m1a.test.js — M1a 判据 C1/C2/C3/C6（施工令 §6）
//
// 判据基座＝合成源：本地起 mock http 服务供适配器真抓（含正常 RSS、坏 XML、重复 URL、
// 无日期条目、中英混合）。不打真实网络、不打真实额度。
// H104：验行为，不 grep 源码；每条判据都要能红（自证在 test/自证能红.js）。
const assert = require('node:assert');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { 抓, 出报 } = require('../intel/run');
const dedupe = require('../intel/dedupe');
const scoring = require('../intel/scoring');
const rss = require('../intel/adapters/rss');

let passed = 0;
const t = async (n, f) => { await f(); passed++; console.log('  ✓ ' + n); };
console.log('M1a 情报官判据');

// ---- 合成源 ----
const 好feed = (items) => `<?xml version="1.0"?><rss version="2.0"><channel><title>合成源</title>
${items.map((i) => `<item><title><![CDATA[${i.t}]]></title><link>${i.u}</link>
<description><![CDATA[${i.d || ''}]]></description>${i.p ? `<pubDate>${i.p}</pubDate>` : ''}</item>`).join('\n')}
</channel></rss>`;

const 样本 = [
  { t: '4X grand strategy 深度复盘：经济系统怎么塌的', u: 'https://ex.test/a?utm_source=x', d: 'postmortem of an SLG economy', p: new Date().toUTCString() },
  { t: 'Unity 2026 LTS 发布', u: 'https://ex.test/b/', d: 'unity engine release', p: new Date(Date.now() - 5 * 3600e3).toUTCString() },
  { t: '一条没有日期的条目', u: 'https://ex.test/c', d: 'no date here' },
  // 这条要带日期：样本里**只留一条**无日期条目（上面那条），无日期路径才验得干净。
  // 上一版这里漏了 p，于是无日期条目实为两条，新加的「有日期必须真拿到日期」当场把它照出来。
  { t: '完全无关的烹饪教程', u: 'https://ex.test/d', d: 'how to bake bread', p: new Date(Date.now() - 2 * 3600e3).toUTCString() },
];

function 起服务(路由) {
  return new Promise((res) => {
    const s = http.createServer((req, r) => {
      const h = 路由[req.url];
      if (!h) { r.writeHead(404); return r.end('no'); }
      r.writeHead(h.code || 200, { 'content-type': 'application/xml' });
      r.end(h.body);
    });
    s.listen(0, '127.0.0.1', () => res({ s, port: s.address().port }));
  });
}

const 临时仓 = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'intel-'));
  fs.mkdirSync(path.join(d, 'config'), { recursive: true });
  fs.copyFileSync(path.join(__dirname, '..', 'config', 'scoring.json'), path.join(d, 'config', 'scoring.json'));
  return d;
};
const 写源配置 = (base, 源) => fs.writeFileSync(path.join(base, 'config', 'sources.json'), JSON.stringify({ 源 }), 'utf8');
const 读流 = (base, 日) => {
  const p = path.join(base, 'data', 'stream', 日.slice(0, 7), `${日}.jsonl`);
  try { return fs.readFileSync(p, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; }
};

(async () => {
  const 日 = '2026-08-27';

  // ── C1 抓取落盘形状 ──
  await t('C1 抓取落盘形状：全字段齐、时刻 ISO 8601、无链接无标题的条目丢弃', async () => {
    const { s, port } = await 起服务({ '/f.xml': { body: 好feed(样本) } });
    const base = 临时仓();
    写源配置(base, [{ id: 'syn', 名称: '合成', 类型: 'rss', 地址: `http://127.0.0.1:${port}/f.xml`, 语种: 'en', 档位: 'A', 类: '技术报道' }]);
    const r = await 抓({ base, date: 日 });
    s.close();

    const 行 = 读流(base, 日);
    assert.equal(行.length, 4, '四条样本应全部落盘，实得 ' + 行.length);
    for (const c of 行) {
      for (const k of ['id', 'source', 'tier', 'lang', 'url', 'title', 'published_at', 'fetched_at', 'raw_excerpt']) {
        assert.ok(k in c, `条目缺字段 ${k}`);
      }
      assert.match(c.fetched_at, /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/, 'fetched_at 必须 ISO 8601');
      assert.equal(c.id, dedupe.键(c.url), 'id 必须等于规范化 URL 的 sha1');
    }

    // 有日期的必须真拿到日期。
    // **这一格是补的**：上一版写成 `if (published_at !== null) assert.match(...)`——条件式断言，
    // 把字段映射整个抽掉（全 null）时它一条都不执行，变异证明当场抓出「C1 没在验这件事」。
    // 条件式断言是判据里最容易骗过自己的形状：看着在验，实际只在「本来就对」的时候验。
    const 有日期 = 行.filter((c) => !/没有日期/.test(c.title));
    assert.equal(有日期.length, 3, '样本里有三条带 pubDate');
    for (const c of 有日期) {
      assert.ok(c.published_at, `「${c.title.slice(0, 12)}」带了 pubDate 却没解析出 published_at`);
      assert.match(c.published_at, /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/, 'published_at 必须 ISO 8601');
      const 差 = Math.abs(Date.parse(c.published_at) - Date.parse(c.fetched_at));
      assert.ok(差 < 30 * 3600e3, 'published_at 应接近样本给的时刻，不该是别处来的数');
    }

    const 无日期 = 行.find((c) => /没有日期/.test(c.title));
    assert.equal(无日期.published_at, null, '解析不出发布时刻要落 null，不许拿抓取时刻冒充');
    assert.equal(r.健康[0].ok, true);
  });

  // ── C2 去重 ──
  await t('C2 去重：同源抓两轮不增行、重复计数、utm 与尾斜杠不算不同文章', async () => {
    const { s, port } = await 起服务({ '/f.xml': { body: 好feed(样本) } });
    const base = 临时仓();
    写源配置(base, [{ id: 'syn', 名称: '合成', 类型: 'rss', 地址: `http://127.0.0.1:${port}/f.xml`, 语种: 'en', 档位: 'A', 类: '技术报道' }]);
    await 抓({ base, date: 日 });
    const 一轮 = 读流(base, 日).length;
    const r2 = await 抓({ base, date: 日 });
    s.close();
    const 二轮 = 读流(base, 日).length;

    assert.equal(二轮, 一轮, `第二轮不该增行（一轮 ${一轮} → 二轮 ${二轮}）`);
    assert.equal(r2.健康[0].重复, 一轮, '重复条数应等于全量');

    // 规范化本身：这四个必须收敛成同一个键
    const 同 = ['https://ex.test/a?utm_source=x', 'https://ex.test/a', 'http://ex.test/a/', 'https://www.ex.test/a#top'];
    const 键们 = new Set(同.map(dedupe.键));
    assert.equal(键们.size, 1, 'utm/尾斜杠/协议/www/锚点 都不该造出新身份，实得 ' + 键们.size + ' 个键');
    // 反面：真定位参数不许被削
    assert.notEqual(dedupe.键('https://ex.test/p?id=1'), dedupe.键('https://ex.test/p?id=2'), '?id= 是真定位信息，削了会把不同文章合成一条');
  });

  // ── C3 评分与入选 ──
  await t('C3 评分与入选：S 档降门槛全入、A/B 取 topN、**调权重则入选集合随之变化**', () => {
    const 权重 = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'scoring.json'), 'utf8'));
    const 现在 = Date.parse('2026-08-27T12:00:00Z');
    const 集 = [
      { id: 's1', tier: 'S', 类: 'SLG垂直', lang: 'en', title: '冷门 4X 小品', raw_excerpt: '', published_at: '2026-08-01T00:00:00Z' },
      { id: 'a1', tier: 'A', 类: '技术报道', lang: 'en', title: 'grand strategy 经济系统 postmortem', raw_excerpt: 'strategy balance', published_at: '2026-08-27T11:00:00Z' },
      { id: 'b1', tier: 'B', 类: '广覆盖', lang: 'en', title: '烹饪教程', raw_excerpt: 'bread', published_at: '2026-08-27T11:00:00Z' },
    ];
    const r1 = scoring.选(集, 权重, 现在);
    assert.ok(r1.入选.some((x) => x.id === 's1'), 'S 档必须降门槛入选——哪怕分低（垂直深挖靠身份不靠竞争）');
    assert.ok(r1.入选.some((x) => x.id === 'a1'), '高分 A 档应入选');
    assert.equal(r1.入选[0].id, 'a1', '入选按总分降序，a1 关键词密集应居首');

    // 关键一格：改配置 → 集合必须跟着变。不变就是引擎没接配置
    const 改 = JSON.parse(JSON.stringify(权重));
    改.入选.AB档topN = 0;                     // A/B 一个不取
    const r2 = scoring.选(集, 改, 现在);
    assert.ok(!r2.入选.some((x) => x.id === 'a1'), 'topN=0 后 A 档不该还在入选里——集合不随配置变＝规则没接配置');
    assert.ok(r2.入选.some((x) => x.id === 's1'), 'S 档不受 topN 约束');

    const 改2 = JSON.parse(JSON.stringify(权重));
    改2.关键词分.表 = { bread: 999 };          // 把烹饪捧成第一
    const r3 = scoring.选(集, 改2, 现在);
    assert.equal(r3.入选[0].id, 'b1', '权重表换掉后排序必须跟着换');
  });

  // ── C6 单源故障隔离 ──
  await t('C6 单源故障隔离：一坏一好 → 好源照常落盘、坏源入 health、班次整体不塌', async () => {
    const { s, port } = await 起服务({
      '/good.xml': { body: 好feed(样本.slice(0, 2)) },
      '/bad.xml': { body: '<rss><channel><item><title>没闭合' },   // 坏 XML
      '/500.xml': { code: 500, body: 'boom' },
    });
    const base = 临时仓();
    写源配置(base, [
      { id: 'bad', 名称: '坏源', 类型: 'rss', 地址: `http://127.0.0.1:${port}/bad.xml`, 语种: 'en', 档位: 'B', 类: '广覆盖' },
      { id: 'err', 名称: '五百', 类型: 'rss', 地址: `http://127.0.0.1:${port}/500.xml`, 语种: 'en', 档位: 'B', 类: '广覆盖' },
      { id: 'good', 名称: '好源', 类型: 'rss', 地址: `http://127.0.0.1:${port}/good.xml`, 语种: 'en', 档位: 'A', 类: '技术报道' },
    ]);
    const r = await 抓({ base, date: 日 });
    s.close();

    const 行 = 读流(base, 日);
    assert.equal(行.length, 2, '好源两条必须照常落盘，不被坏源带走');
    assert.ok(行.every((c) => c.source === 'good'));
    const h = Object.fromEntries(r.健康.map((x) => [x.source, x]));
    assert.equal(h.good.ok, true, '好源应成功');
    assert.equal(h.err.ok, false, 'HTTP 500 应记失败');
    assert.match(h.err.因, /500/, '失败原因要说得出是什么');
    assert.equal(r.健康.length, 3, '三个源都要有健康记录——失败的也要留痕，不许静默跳过');
  });

  // ── 端到端：真出一份报（M1a 收口物①的机器化版本）──
  await t('端到端：fetch → digest 出真日报，五区齐全、每条带原文链接、未精编有标注', async () => {
    const { s, port } = await 起服务({ '/f.xml': { body: 好feed(样本) } });
    const base = 临时仓();
    写源配置(base, [{ id: 'syn', 名称: '合成', 类型: 'rss', 地址: `http://127.0.0.1:${port}/f.xml`, 语种: 'en', 档位: 'S', 类: 'SLG垂直' }]);
    await 抓({ base, date: 日 });
    s.close();
    // 精编:false 显式关掉真通道。M1a 的契约就是「无 UI、无调度、**无真实 AI 调用**」——
    // M1b 接通真精编后，不写这个参数就会去打真实 API（2026-08-28 实测当场炸出来）。
    // 判据零额度是硬要求：用真调用测，既贵又不可复现。
    const r = await 出报({ base, date: 日, 现在: Date.parse('2026-08-27T12:00:00Z'), 精编: false });

    const md = fs.readFileSync(r.md路径, 'utf8');
    for (const 区 of ['## 头条', '## SLG 垂直', '## 主流广览', '## 论文与工具角', '## 源健康']) {
      assert.ok(md.includes(区), '日报缺区：' + 区);
    }
    assert.ok(/\[.+\]\(https?:\/\//.test(md), '每条必须带原文直达链接');
    assert.ok(md.includes('（本条未精编）'), 'M1a 无真精编，必须显式标注而不是静默留白');
    const 清单 = JSON.parse(fs.readFileSync(path.join(base, 'data', 'digests', `${日}.json`), 'utf8'));
    assert.ok(清单.入选.length > 0, '入选清单不能空');
    assert.equal(清单.区.头条.length <= 3, true, '头条 ≤3');
  });

  // ── 适配器边角 ──
  await t('适配器：Atom 与 RSS 同等对待；无链接/无标题条目丢弃并计数', () => {
    const atom = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">
<entry><title>Atom 一条</title><link rel="alternate" href="https://a.test/1"/><summary>s</summary><published>2026-08-27T00:00:00Z</published></entry>
<entry><title>没有链接的</title><summary>s</summary></entry></feed>`;
    const r = rss.解析(atom);
    assert.equal(r.条目.length, 1, 'Atom 应解析出一条有效条目');
    assert.equal(r.条目[0].url, 'https://a.test/1', 'Atom 的 link 是属性形，要取 href');
    assert.equal(r.丢弃, 1, '无链接条目应被丢弃并计数（没有链接就没有身份）');
    assert.throws(() => rss.解析('这不是 XML <<<'), /XML 解不开|认不出/, '坏输入要抛，不许静默返回空集');
  });

  console.log('  ' + passed + ' 项通过');
})().catch((e) => { console.error('✗ ' + e.message); process.exit(1); });
