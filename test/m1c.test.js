// m1c.test.js — 判据 C8（页面渲染）/ C9（空态），外加渲染器与评分时钟三条（M1c）
//
// 判据在**真起一个服务、真发 GET** 上跑，不是调函数看返回值：
// 页面这一层的病多半出在路由、编码、静态件路径这些「只有真跑一遍才会露头」的地方
// （本段落地时就撞到一个：Express 4 的路由参数名不认汉字，`:日` 被当字面量，六条路全 404）。
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const express = require('express');

const 仓 = path.join(__dirname, '..');
let passed = 0;
const t = async (n, f) => { await f(); passed++; console.log('  ✓ ' + n); };
console.log('m1c 情报三页（C8 页面渲染 / C9 空态）');

// ── 起一个只挂 views 的服务，端口交给系统分配（写死端口会跟并跑的套件抢） ──
function 起(根) {
  const app = express();
  app.use(express.static(path.join(仓, 'public')));
  require('../server/routes/views').挂(app, 根);
  return new Promise((res) => {
    const s = app.listen(0, '127.0.0.1', () => res({ s, 口: s.address().port }));
  });
}
const 取 = (口, p) => new Promise((res) => {
  http.get(`http://127.0.0.1:${口}${p}`, (x) => {
    let b = ''; x.on('data', (d) => { b += d; });
    x.on('end', () => res({ 码: x.statusCode, 文: b, 型: x.headers['content-type'] || '' }));
  }).on('error', (e) => res({ 码: 0, 文: String(e.message), 型: '' }));
});

// ── 受控夹具根：三条流 + 一份只选中其中一条的日报 ──
// 不拿仓里的真数据当判据底：真数据每天都在变，今天 12 条明天 30 条，
// 断言要么写成「大于零」（等于没断言），要么天天翻红。夹具是死的，断言才能是硬的。
function 造根() {
  const 根 = fs.mkdtempSync(path.join(os.tmpdir(), 'm1c-'));
  fs.mkdirSync(path.join(根, 'data', 'digests'), { recursive: true });
  fs.mkdirSync(path.join(根, 'data', 'stream', '2026-08'), { recursive: true });
  fs.mkdirSync(path.join(根, 'data', 'health'), { recursive: true });
  fs.mkdirSync(path.join(根, 'config'), { recursive: true });

  const 条 = [
    { id: 'aaa', source: 'src-a', tier: 'S', 类: '资讯', lang: 'en', url: 'https://a.example/1', title: 'Alpha 入报的那条', published_at: '2026-08-27T04:00:00.000Z', fetched_at: '2026-08-27T16:00:00.000Z', raw_excerpt: 'alpha excerpt' },
    { id: 'bbb', source: 'src-a', tier: 'B', 类: '资讯', lang: 'en', url: 'https://a.example/2', title: 'Beta 没入报', published_at: '2026-08-26T04:00:00.000Z', fetched_at: '2026-08-27T16:00:00.000Z', raw_excerpt: 'beta excerpt' },
    { id: 'ccc', source: 'src-b', tier: 'A', 类: '论文', lang: 'zh', url: 'javascript:alert(1)', title: '<img src=x onerror=alert(1)>', published_at: '2026-08-27T02:00:00.000Z', fetched_at: '2026-08-27T16:00:00.000Z', raw_excerpt: '带尖括号 <b> 的摘要' },
  ];
  fs.writeFileSync(path.join(根, 'data', 'stream', '2026-08', '2026-08-28.jsonl'),
    条.map((x) => JSON.stringify(x)).join('\n') + '\n{坏行不是 JSON}\n', 'utf8');
  fs.writeFileSync(path.join(根, 'data', 'digests', '2026-08-28.md'),
    '# 情报日报 · 2026-08-28\n\n> 共 1 条\n\n## 头条\n\n- [Alpha 入报的那条](https://a.example/1) — `src-a` （77 分）\n  - 精编正文一行\n', 'utf8');
  fs.writeFileSync(path.join(根, 'data', 'digests', '2026-08-28.json'), JSON.stringify({
    日期: '2026-08-28', 生成于: '2026-08-27T18:00:00.000Z',
    入选: [{ id: 'aaa', source: 'src-a', title: 'Alpha 入报的那条', url: 'https://a.example/1', 总分: 77 }],
    区: { 头条: ['aaa'], slg: [], 广: [] }, 精编: { 成: 1, 败: 0, 失败因: [] },
  }), 'utf8');
  fs.writeFileSync(path.join(根, 'data', 'health', 'fetch.jsonl'), [
    JSON.stringify({ t: '2026-08-27T16:00:00.000Z', 日: '2026-08-28', source: 'src-a', ok: true, 新增: 2 }),
    JSON.stringify({ t: '2026-08-27T16:00:01.000Z', 日: '2026-08-28', source: 'src-b', ok: false, 因: 'HTTP 403' }),
  ].join('\n') + '\n', 'utf8');
  fs.writeFileSync(path.join(根, 'config', 'sources.json'), JSON.stringify([
    { id: 'src-a', 名称: '甲源', 类型: 'rss', 档位: 'A' },
    { id: 'src-b', 名称: '乙源', 类型: 'rss', 档位: 'B' },
    { id: 'src-c', 名称: '丙源（从没跑过）', 类型: 'rss', 档位: 'B' },
  ]), 'utf8');
  fs.copyFileSync(path.join(仓, 'config', 'scoring.json'), path.join(根, 'config', 'scoring.json'));
  return 根;
}

(async () => {
  const 根 = 造根();
  const { s, 口 } = await 起(根);
  try {
    // ── C8 页面渲染 ─────────────────────────────────────────────
    await t('C8① 日报页 200，五区结构渲染出来（标题/引言/分区/条目/链接）', async () => {
      const r = await 取(口, '/digest/2026-08-28');
      assert.equal(r.码, 200);
      assert.match(r.型, /text\/html/);
      assert.match(r.文, /<h1>情报日报 · 2026-08-28<\/h1>/, 'H1 要渲染成标签而不是留着 #');
      assert.match(r.文, /<blockquote>共 1 条<\/blockquote>/, '引言行');
      assert.match(r.文, /<h2>头条<\/h2>/, '分区标题');
      assert.match(r.文, /<a href="https:\/\/a\.example\/1"[^>]*>Alpha 入报的那条<\/a>/, '条目标题即原文直达链接');
      assert.match(r.文, /<li>精编正文一行<\/li>/, '子项（精编）也要出来');
      assert.ok(!/^\s*$/.test(r.文), '非白屏');
    });

    await t('C8② 子列表嵌在父 li 内部，不是 ul 直接套 ul', async () => {
      const r = await 取(口, '/digest/2026-08-28');
      assert.ok(!/<ul>\s*<ul>/.test(r.文), 'ul 直接套 ul 是非法结构（缩进语义与无障碍树都错）');
      // 「<ul> 出现在一个尚未闭合的 <li> 里」＝从某个 <li> 走到 <ul>，中途不经过 </li>
      assert.match(r.文, /<li>(?:(?!<\/li>)[\s\S])*?<ul>/, '子列表应出现在父 li 之内');
    });

    await t('C8③ 原始流页 200，按源分组 + 每条带 源/时刻/评分', async () => {
      const r = await 取(口, '/stream/2026-08-28');
      assert.equal(r.码, 200);
      assert.match(r.文, /<h2>甲源 <span class="n">2<\/span><\/h2>/, '甲源两条，用的是 sources.json 里的名称');
      assert.match(r.文, /<h2>乙源 <span class="n">1<\/span><\/h2>/, '乙源一条');
      assert.match(r.文, /class="sc">77 分</, '入报条照抄日报记的分');
      assert.match(r.文, /class="ts">/, '每条要有时刻');
    });

    // 这条就是 C8 的变异靶心：删掉入选清单，徽章必须全灭。
    await t('C8④ 「已入报」徽章按入选清单联查——只标入选的那条', async () => {
      const r = await 取(口, '/stream/2026-08-28');
      const 徽 = (r.文.match(/<span class="badge">已入报<\/span>/g) || []).length;
      assert.equal(徽, 1, `入选清单只有 1 条，徽章却有 ${徽} 个`);
      // 位置也要对：徽章必须落在 aaa 那一条上，不能落在别人身上
      const 甲 = r.文.slice(r.文.indexOf('data-in="1"'), r.文.indexOf('data-in="1"') + 700);
      assert.match(甲, /Alpha 入报的那条/, '带 data-in=1 的应当是入选的那条');
      assert.match(r.文, /data-in="0"[\s\S]{0,700}Beta 没入报/, '没入选的条要标 data-in=0');
    });

    await t('C8⑤ 不可信输入被转义、非 http 链接不给可点的口', async () => {
      const r = await 取(口, '/stream/2026-08-28');
      assert.ok(!r.文.includes('<img src=x onerror='), '条目标题来自第三方 RSS，必须转义');
      assert.match(r.文, /&lt;img src=x onerror=alert\(1\)&gt;/, '转义后照常显示原文');
      assert.ok(!/href="javascript:/.test(r.文), 'javascript: 链接一律不许生成 href');
      assert.match(r.文, /<span class="t">&lt;img/, '降级成纯文本，不是丢掉');
    });

    await t('C8⑥ 坏行不吞整天：一行坏 JSON 跳过并如实报数', async () => {
      const r = await 取(口, '/stream/2026-08-28');
      assert.match(r.文, /1 行无法解析，已跳过/, '坏行要说出来，不许静默');
      assert.match(r.文, /<span class="count" id="f-count">3 条<\/span>/, '其余三条照常显示');
    });

    // 过滤本身是客户端 JS（public/stream.js），node 判据够不着 DOM 事件，
    // **这一层没有机器判据，只有浏览器实测**（2026-08-28 实测：202→50→11→12→152→202，
    // 空组自动收起、计数同步）。如实写在这里，别让人以为它被盯着。
    // 能机器化的是**它依赖的服务端契约**：少一个 data-* 或选项值对不上，过滤就静默失效——
    // 而那正是最可能坏、又最不容易被看出来的一环（页面照样渲染，只是筛不动）。
    await t('C8⑦ 过滤器契约：每条带齐 data-src/data-tier/data-in，选项值与条目对得上', async () => {
      const r = await 取(口, '/stream/2026-08-28');
      const 条 = r.文.match(/<li class="item"[^>]*>/g) || [];
      assert.equal(条.length, 3);
      for (const c of 条) {
        assert.match(c, /data-src="[^"]+"/, '缺 data-src，按源筛会全部落空：' + c);
        assert.match(c, /data-tier="[^"]+"/, '缺 data-tier，按档筛会全部落空：' + c);
        assert.match(c, /data-in="[01]"/, 'data-in 只能是 0/1：' + c);
      }
      const 源值 = [...r.文.matchAll(/<option value="([^"]*)">/g)].map((m) => m[1]).filter(Boolean);
      const 条源 = new Set(条.map((c) => c.match(/data-src="([^"]+)"/)[1]));
      for (const s2 of 条源) assert.ok(源值.includes(s2), `下拉里没有 ${s2} 这一项，选不到就等于筛不了`);
      assert.match(r.文, /<script src="\/stream\.js"><\/script>/, '过滤脚本要真的挂上');
      assert.match(r.文, /id="f-src"[\s\S]*id="f-tier"[\s\S]*id="f-in"[\s\S]*id="f-count"/, '四个控件 id 是脚本的接缝，改名就静默失效');
    });

    // ── C9 空态 ─────────────────────────────────────────────────
    await t('C9① 无当日报：200 非 404、有空态文案、有最近一期入口', async () => {
      const r = await 取(口, '/digest/2020-01-01');
      assert.equal(r.码, 200, '空态不是错误页——404 会让人以为程序坏了');
      assert.match(r.文, /2020-01-01 的日报未生成/, '空态文案要指名是哪一天');
      assert.match(r.文, /<a href="\/digest\/2026-08-28">2026-08-28<\/a>/, '要给得出最近一期的入口');
      assert.ok(r.文.length > 400, '非白屏');
    });

    await t('C9② 原始流同样有空态，且入口指向 stream 而不是 digest', async () => {
      const r = await 取(口, '/stream/2020-01-01');
      assert.equal(r.码, 200);
      assert.match(r.文, /2020-01-01 的原始流未生成/);
      assert.match(r.文, /<a href="\/stream\/2026-08-28">/, '流页的最近入口要落回流页');
    });

    await t('C9③ 一期都没有时也不白屏（新装的仓）', async () => {
      const 空根 = fs.mkdtempSync(path.join(os.tmpdir(), 'm1c-空-'));
      const { s: s2, 口: 口2 } = await 起(空根);
      try {
        const r = await 取(口2, '/digest');
        assert.equal(r.码, 200);
        assert.match(r.文, /一期都还没有/, '连最近一期都给不出时，要说清是「还没有」不是「坏了」');
      } finally { s2.close(); fs.rmSync(空根, { recursive: true, force: true }); }
    });

    // ── V3 健康读口 ──────────────────────────────────────────────
    await t('V3 健康读口：逐源给最近成功/最近失败/当日条数，没跑过的是 null 不是 0', async () => {
      const r = await 取(口, '/health?%E6%97%A5=2026-08-28');
      assert.equal(r.码, 200);
      const j = JSON.parse(r.文);
      assert.equal(j.源数, 3);
      assert.equal(j.当日总条数, 3);
      assert.equal(j.当日出报, true);
      const 甲 = j.每源.find((x) => x.源 === 'src-a');
      const 乙 = j.每源.find((x) => x.源 === 'src-b');
      const 丙 = j.每源.find((x) => x.源 === 'src-c');
      assert.equal(甲.最近成功, '2026-08-27T16:00:00.000Z');
      assert.equal(甲.当日条数, 2);
      assert.equal(乙.最近失败.因, 'HTTP 403');
      assert.equal(丙.最近成功, null, '从没跑过要给 null——「没数据」和「数是零」是两件事');
      assert.equal(丙.当日条数, 0);
    });

    // ── 坐席页到三张阅读页的路（2026-08-28）─────────────────────────
    // 案发当天：群聊上线、测试全绿、/chat 返 200，制作人打开窗口——**没有导航**。
    // 坐席页是 public/index.html，以静态件占着 `/`，Electron 窗口加载的就是它；
    // 而导航只长在 server/render/页.js 那套服务端渲染壳上（日报/原始流/群聊共用）。
    // 「东西在」和「过得去」是两件事，此前只有前者有判据。
    //
    // 判的是**从 `/` 拿到的那份 HTML 里有没有通向三张页的链接**，
    // 不是 grep 源码文件——静态件被 express.static 换掉、被打包漏收、被改了类名，
    // 任何一种都要在这里翻红。
    // 2026-08-30 改判法：导航不再手写在 index.html 里（两份手写列表分叉了三次，
    // 每次的表现都是「新页面从主屏看不见」）。现在它由 视图.js 从 /api/views 那一份表渲染。
    // **意图一字不变**——「东西在」和「过得去」是两件事；变的是过得去这件事靠什么保证：
    // 三样缺一不可：导航容器在、渲染它的脚本在、那份表里真有这几张页。
    await t('坐席页给得出各张页的路（否则东西在也过不去）', async () => {
      const r = await 取(口, '/');
      assert.equal(r.码, 200, '根路径要给出坐席页');
      assert.ok(/<nav class="去" id="去">/.test(r.文), '坐席页缺导航容器，页签无处可画');
      assert.ok(r.文.includes('视图.js'), '坐席页没加载 视图.js，导航永远是空的');
      // 这里读的是那份表本身，不是 /api/views——本套件起的是只挂 views 的最小服务，
      // 没有那个口。**判据不该依赖被测环境里没有的东西**；
      // 「表经 /api/views 原样下发」由 壳.test.js 端到端验。
      const 键们 = require('../server/render/页签').页签表.map((x) => x.键);
      for (const k of ['digest', 'stream', 'chat', 'watch', 'shift']) {
        assert.ok(键们.includes(k), `视图表里没有 ${k}——那张页从主屏就到不了，等于不存在`);
      }
    });

    // ── 版本口（2026-08-28）───────────────────────────────────────
    // 换装冒烟要能问出「现在跑的是哪一份」。此前终端根本没有这个口
    // （/version 与 /api/version 皆 404），于是验证只能退回「接口通不通」——
    // 而旧实例同样通，监制台 0.40.1 那次假换装就是这么过的关。
    await t('健康读口报版本，且与 package.json 逐字相同（换装冒烟靠它分辨新旧）', async () => {
      const r = await 取(口, '/health?%E6%97%A5=2026-08-28');
      const j = JSON.parse(r.文);
      const 真 = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')).version;
      assert.ok(真, '前提：package.json 里得真有 version');
      assert.equal(j.版本, 真, '报的版本必须就是 package.json 里那个——另立事实源等于没有事实源');
      assert.ok(/^\d+\.\d+\.\d+/.test(j.版本), '得是个像样的版本号，不是空串或 true');
    });

    // ── 评分时钟 ────────────────────────────────────────────────
    // 落地时实测：拿此刻当时钟，12 条入选只有 6 条算得出日报记着的那个分。
    // 页面上写一个和日报对不上的分，比不写分更坏——读的人会以为其中一个错了，却无从判断是哪个。
    await t('评分时钟：未入报条按日报的钟算分，不按此刻', async () => {
      const { 当日时钟 } = require('../server/routes/views');
      const 报 = { 清单: { 生成于: '2026-08-27T18:00:00.000Z' } };
      assert.equal(当日时钟(报, []), Date.parse('2026-08-27T18:00:00.000Z'), '有日报就用日报的生成时刻');
      const 无报 = 当日时钟(null, [{ fetched_at: '2026-08-27T16:00:00.000Z' }, { fetched_at: '2026-08-27T17:00:00.000Z' }]);
      assert.equal(无报, Date.parse('2026-08-27T17:00:00.000Z'), '没日报就退到当天最后一次抓取，仍是那一天的钟');
      assert.ok(当日时钟(null, []) > Date.now() - 5000, '两样都没有才回落此刻');
    });

    // 时钟只取一次：**生成于 必须就是算分那一刻**。
    //
    // 下面那条「真账回放」是读活体日报的——它能抓到这个病（今日实测抓到了：一条记 41 算 40），
    // 但**要等下一次出报才验得到**，而且它红的时候先看起来像判据抖动。
    // 这一条把不变式直接钉在代码上：注入一个固定时钟，断言产物里的 生成于 逐字等于它。
    // 原病：166 行 `Date.now()` 算分、211 行 `new Date()` 盖时间戳，中间隔着整个精编过程
    // （今日 2.5 分钟 / 12 条 Opus），新鲜度跨档就差 1 分——**日报印着的分数，
    // 拿它自称的生成时刻复现不出来**。
    await t('时钟只取一次：生成于 与算分同刻（注入钟逐字回读）', async () => {
      const 根 = 造根();
      try {
        const { 出报 } = require('../intel/run');
        const 钟 = Date.parse('2026-08-28T04:00:00.000Z');
        await 出报({ base: 根, date: '2026-08-28', 现在: 钟, 精编: false });
        const j = JSON.parse(fs.readFileSync(path.join(根, 'data', 'digests', '2026-08-28.json'), 'utf8'));
        assert.equal(j.生成于, new Date(钟).toISOString(),
          '生成于 必须就是算分那一刻——取第二次钟就等于给出一个复现不出自己分数的时间戳');
        // 反向闭环：拿这个 生成于 当钟，记下的分必须逐条复现
        const 权 = JSON.parse(fs.readFileSync(path.join(根, 'config', 'scoring.json'), 'utf8'));
        const 流 = fs.readFileSync(path.join(根, 'data', 'stream', '2026-08', '2026-08-28.jsonl'), 'utf8')
          .split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
        const 表 = new Map(流.map((x) => [x.id, x]));
        const { 打分 } = require('../intel/scoring');
        const 钟2 = Date.parse(j.生成于);
        for (const x of j.入选) {
          if (!表.has(x.id)) continue;
          assert.equal(打分(表.get(x.id), 权, 钟2).总分, x.总分,
            `条目 ${x.id} 用日报自己的生成时刻复现不出记下的分`);
        }
      } finally { fs.rmSync(根, { recursive: true, force: true }); }
    });

    await t('真账回放：仓里现存日报的记分，用「生成于」当钟能逐条复现', async () => {
      const d = JSON.parse(fs.readFileSync(path.join(仓, 'data', 'digests', '2026-08-28.json'), 'utf8'));
      const 权 = JSON.parse(fs.readFileSync(path.join(仓, 'config', 'scoring.json'), 'utf8'));
      const 流 = fs.readFileSync(path.join(仓, 'data', 'stream', '2026-08', '2026-08-28.jsonl'), 'utf8')
        .split('\n').filter(Boolean).map((l) => JSON.parse(l));
      const 表 = new Map(流.map((x) => [x.id, x]));
      const { 打分 } = require('../intel/scoring');
      const 钟 = Date.parse(d.生成于);
      const 不符 = d.入选.filter((x) => 表.has(x.id)).filter((x) => 打分(表.get(x.id), 权, 钟).总分 !== x.总分);
      assert.deepEqual(不符.map((x) => x.id), [], '用日报自己的钟应当逐条复现，差了说明两处口径已经分叉');
    });

  } finally {
    s.close();
    fs.rmSync(根, { recursive: true, force: true });
  }
  console.log('  ' + passed + ' 项通过');
})().catch((e) => { console.error('✗ ' + (e && e.stack || e)); process.exit(1); });
