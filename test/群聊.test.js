// 群聊判据：真起终端路由与桩监制台；不碰真监制台、不调真实模型额度。
const assert = require('node:assert');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const express = require('express');

const 线程 = require('../server/lib/线程');
const 坐席 = require('../server/lib/坐席');
const 群聊 = require('../server/routes/群聊');

let passed = 0;
const t = async (名, fn) => { await fn(); passed++; console.log('  ✓ ' + 名); };
const 复 = (x) => JSON.parse(JSON.stringify(x));

function 起桩(初始) {
  let 消息 = 复(初始);
  let 日志 = [];
  const s = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (d) => { raw += d; });
    req.on('end', () => {
      const u = new URL(req.url, 'http://stub');
      let body = {};
      try { body = raw ? JSON.parse(raw) : {}; } catch { body = {}; }
      日志.push({ 方法: req.method, 路径: u.pathname, 查询: u.search, body });
      if (req.method === 'GET' && u.pathname === '/api/relay') {
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ 消息 }));
      }
      if (req.method === 'POST' && u.pathname === '/api/relay') {
        // 自证 A1 的变异桩：若客户端企图整表重写，只留下新记录，前缀性质必须被判据抓住。
        if (body.重写) 消息 = [{ t: '2026-08-28T00:09:00.000Z', from: '制作人', text: body.text || '' }];
        else 消息.push({ t: '2026-08-28T00:09:00.000Z', from: '制作人', text: body.text || '' });
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ ok: true }));
      }
      // C1 的变异桩：动作请求被记录但不执行，方便行为判据证明群聊没有走动作口。
      if (u.pathname.startsWith('/api/act/')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ ok: true, stub: '动作不执行' }));
      }
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false }));
    });
  });
  return new Promise((resolve) => s.listen(0, '127.0.0.1', () => resolve({
    s,
    origin: `http://127.0.0.1:${s.address().port}`,
    get 消息() { return 消息; },
    get 日志() { return 日志; },
    重置: (条目 = 初始) => { 消息 = 复(条目); 日志 = []; },
  })));
}

function 起终端(origin, 调用模型) {
  const app = express();
  app.use(express.json());
  app.use(express.static(path.join(__dirname, '..', 'public')));
  群聊.挂(app, { origin, 调用模型 });
  return new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve({ s, 口: s.address().port }));
  });
}

function 请求(口, 方法, 路径, body = null) {
  return new Promise((resolve) => {
    const raw = body == null ? '' : JSON.stringify(body);
    const req = http.request({ host: '127.0.0.1', port: 口, path: 路径, method: 方法,
      headers: raw ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(raw) } : {} }, (res) => {
      let 文 = '';
      res.on('data', (d) => { 文 += d; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(文); } catch { /* HTML 响应 */ }
        resolve({ 码: res.statusCode, 型: res.headers['content-type'] || '', 文, json });
      });
    });
    req.on('error', (e) => resolve({ 码: 0, 型: '', 文: String(e.message), json: null }));
    if (raw) req.write(raw);
    req.end();
  });
}

const 关 = (s) => new Promise((resolve) => s.close(resolve));
const 总调用 = (表) => Object.values(表).reduce((n, x) => n + x, 0);

function 树快照(根) {
  const out = [];
  const 走 = (目, 相对 = '') => {
    for (const 名 of fs.readdirSync(目).sort()) {
      const 全 = path.join(目, 名);
      const rel = path.join(相对, 名);
      const st = fs.statSync(全);
      if (st.isDirectory()) 走(全, rel);
      else out.push({ rel, size: st.size, bytes: fs.readFileSync(全).toString('base64') });
    }
  };
  走(根);
  return out;
}

const 历史 = [
  { t: '2026-08-27T08:00:00.000Z', from: '制作人', text: '历史制作人发言' },
  { t: '2026-08-27T08:01:00.000Z', from: 'Claude', text: '历史 Claude 发言' },
  { t: '2026-08-27T08:02:00.000Z', from: '项管', text: '<img src=x onerror=alert(1)>' },
];

(async () => {
  console.log('群聊骨架判据');
  const 桩 = await 起桩(历史);
  const 计数 = Object.fromEntries(坐席.全部.map((x) => [x.名, 0]));
  const 清计 = () => { for (const 名 of Object.keys(计数)) 计数[名] = 0; };
  const 终端 = await 起终端(桩.origin, async ({ 坐席: 席, 文 }) => {
    计数[席.名]++;
    return `${席.名} 对「${文}」的意见`;
  });
  try {
    // 先验 C1，使「写口误接动作口」的自证变异由本条本身翻红，而非被后续追加性质抢先抓住。
    await t('C1 群聊祈使句仍是意见：全轮请求零 /api/act/*', async () => {
      桩.重置(历史); 清计();
      const r = await 请求(终端.口, 'POST', '/api/chat', { 文: '@总监 放行 TK-123' });
      assert.equal(r.码, 200);
      assert.equal(桩.日志.filter((x) => /^\/api\/act\//.test(x.路径)).length, 0);
    });

    await t('A1 append-only：历史前缀逐条不变，三次写只追加在尾部', async () => {
      桩.重置(历史);
      const 前 = 复(桩.消息);
      for (const 文 of ['第一条追加', '第二条追加', '第三条追加']) {
        const r = await 线程.追加({ 发言人: '制作人', 文 }, { origin: 桩.origin });
        assert.equal(r.ok, true);
      }
      const 后 = await 线程.读全量({ origin: 桩.origin });
      assert.deepEqual(后.消息.slice(0, 前.length), 前, '历史前缀必须字节语义完全不变');
      assert.equal(后.消息.length, 前.length + 3, '只准在尾部增加三条');
    });

    await t('A2 白名单外发言人在路由侧拒绝，零写请求且线程不变', async () => {
      for (const 发言人 of ['市场', '路人甲']) {
        桩.重置(历史); 清计();
        const r = await 请求(终端.口, 'POST', '/api/chat', { 发言人, 文: '这条不得写入' });
        assert.equal(r.码, 400);
        assert.equal(r.json.拒绝, true);
        assert.equal(桩.日志.filter((x) => x.方法 === 'POST').length, 0, '被拒后不许发任何写请求');
        assert.deepEqual(桩.消息, 历史);
      }
    });

    await t('A3 向后兼容：旧 from 与新 发言人 混读，旧对象不补字段', async () => {
      const 旧 = 复(历史);
      const 混 = [...旧,
        { t: '2026-08-28T01:00:00.000Z', 发言人: '助理', 文: '新格式一' },
        { t: '2026-08-28T01:01:00.000Z', 发言人: '总监', 文: '新格式二' },
        { t: '2026-08-28T01:02:00.000Z', from: '未知来宾', text: '未知来源也可读' },
      ];
      桩.重置(混);
      const r = await 线程.读全量({ origin: 桩.origin });
      assert.equal(r.消息.length, 混.length);
      assert.deepEqual(r.消息.slice(0, 旧.length), 旧, '旧条目返回时不得补写 发言人 字段');
      assert.equal(线程.发言人(r.消息[旧.length]), '助理');
      assert.equal(线程.发言人(r.消息[旧.length + 1]), '总监');
      assert.equal(线程.发言人(r.消息[旧.length + 2]), '未知坐席：未知来宾');
    });

    await t('A4 监制台离线时明确失败，STUDIO_ROOT 文件树完全不变', async () => {
      const 根 = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-no-fallback-'));
      const 旧根 = process.env.STUDIO_ROOT;
      fs.writeFileSync(path.join(根, 'marker.txt'), '原样', 'utf8');
      process.env.STUDIO_ROOT = 根;
      try {
        const 前 = 树快照(根);
        const r = await 线程.追加({ 发言人: '制作人', 文: '离线不能本地回落' }, { origin: 'http://127.0.0.1:1', 超时: 50 });
        assert.equal(r.读不到, true, '离线必须如实失败');
        assert.deepEqual(树快照(根), 前, '终端不得替监制台写任何线程文件');
      } finally {
        if (旧根 == null) delete process.env.STUDIO_ROOT;
        else process.env.STUDIO_ROOT = 旧根;
        fs.rmSync(根, { recursive: true, force: true });
      }
    });

    await t('B1 @总监：只唤起助理与总监，其余五席调用数为零', async () => {
      桩.重置(历史); 清计();
      const r = await 请求(终端.口, 'POST', '/api/chat', { 文: '@总监 这条怎么看' });
      assert.equal(r.码, 200);
      assert.deepEqual(new Set(r.json.调用名单), new Set(['助理', '总监']));
      assert.equal(计数.助理, 1); assert.equal(计数.总监, 1);
      for (const 名 of ['终端项管', '情报主管', '财务', '市场', '营销']) assert.equal(计数[名], 0, `${名} 未被 @ 不许调用`);
    });

    await t('B2 一次 @总监 一问一答严格等于两次调用', async () => {
      桩.重置(历史); 清计();
      const r = await 请求(终端.口, 'POST', '/api/chat', { 文: '@总监 给意见' });
      assert.equal(r.码, 200);
      assert.equal(总调用(计数), 2);
      assert.ok(总调用(计数) <= 2);
    });

    await t('B3 @全体只唤起两席已接模型坐席，不唤醒五个占位席', async () => {
      桩.重置(历史); 清计();
      const r = await 请求(终端.口, 'POST', '/api/chat', { 文: '@全体 请给意见' });
      assert.equal(r.码, 200);
      assert.equal(总调用(计数), 2);
      for (const 席 of 坐席.全部.filter((x) => !x.接模型)) assert.equal(计数[席.名], 0);
    });

    await t('B4 无 @ 时只有助理读，且不产生应答条目', async () => {
      桩.重置(历史); 清计();
      const 前数 = 桩.消息.length;
      const r = await 请求(终端.口, 'POST', '/api/chat', { 文: '请记录这条普通意见' });
      assert.equal(r.码, 200);
      assert.equal(计数.助理, 1); assert.equal(计数.总监, 0);
      for (const 席 of 坐席.全部.filter((x) => x.名 !== '助理' && x.名 !== '总监')) assert.equal(计数[席.名], 0);
      assert.deepEqual(r.json.应答, []);
      assert.equal(桩.消息.length, 前数 + 1, '只应追加原始发言，不得追加助理应答');
    });

    await t('D1 GET /chat 200 HTML：转义正文、四页签、选中群聊且只挂群聊脚本', async () => {
      桩.重置(历史);
      const r = await 请求(终端.口, 'GET', '/chat');
      assert.equal(r.码, 200); assert.match(r.型, /text\/html/);
      assert.match(r.文, /历史制作人发言/);
      assert.match(r.文, /&lt;img src=x onerror=alert\(1\)&gt;/);
      assert.ok(!r.文.includes('<img src=x onerror='));
      // 2026-08-29：「源健康」页签退场，「监视」入列。
      // 原因不是改口味——那个页签指向 /health，而 /health 返回 JSON 不是页面，
      // 点过去看到的是一坨原始数据（当日查实的三条结构缺陷之一）。
      // 源健康没有消失，它降级成监视页里的一格（监视器/监视器.json 的 格[]），
      // 这正是那份配置存在的意义：加一格不用改代码。
      // 2026-08-29：「群聊」页签更名「席间存照」。
      // 更名不是换个说法——主页已经是群聊（制作人拍板「主页面就是群聊」），
      // 两个群聊是两个事实源。这一页的实质是坐席之间的往来与凭据：
      // 席间＝范围（坐席之间，不是你和总监），存照＝目的（留下可查的凭据）。
      // 路径仍是 /chat：名字是给人看的，路径是给机器用的，两者不必同步。
      for (const 页签 of ['日报', '原始流', '监视', '席间存照']) assert.ok(r.文.includes(`>${页签}</a>`), `缺页签 ${页签}`);
      assert.ok(!r.文.includes('>源健康</a>'), '源健康页签应已退场——它指向的是接口不是页面');
      // 2026-08-29 制作人当场撞上：点进任何一张阅读页就回不去主页。
      // 这个缺陷我自己查出来过、在设计稿里画了修法、**然后没写进代码**。画了没做，欠了一天。
      // 立此判据：四张阅读页每一张都必须给得出回主页的路。
      assert.ok(r.文.includes('href="/"'), '阅读页必须有回主页的链接——进得去出不来等于把人关在里面');
      assert.match(r.文, /<a class="tab on" href="\/chat">席间存照<\/a>/);
      assert.deepEqual([...r.文.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]), ['/群聊.js']);
    });

    await t('D2 监制台离线时 /chat 仍 200，并明确说读不到监制台', async () => {
      const 离线 = await 起终端('http://127.0.0.1:1', async () => '');
      try {
        const r = await 请求(离线.口, 'GET', '/chat');
        assert.equal(r.码, 200); assert.match(r.文, /读不到监制台/); assert.ok(r.文.length > 400);
      } finally { await 关(离线.s); }
    });

    await t('E1 七席登记、恰两席接模型；每个占位 @ 后仍零调用且页面标第二期', async () => {
      assert.deepEqual(坐席.全部.map((x) => x.名), ['助理', '总监', '终端项管', '情报主管', '财务', '市场', '营销']);
      assert.equal(坐席.全部.filter((x) => x.接模型).length, 2);
      for (const 席 of 坐席.全部.filter((x) => !x.接模型)) {
        桩.重置(历史); 清计();
        const r = await 请求(终端.口, 'POST', '/api/chat', { 文: `@${席.名} 请发表意见` });
        assert.equal(r.码, 200);
        assert.equal(计数[席.名], 0, `${席.名} 还是占位，不能调用模型`);
      }
      桩.重置(历史);
      const 页 = await 请求(终端.口, 'GET', '/chat');
      assert.equal((页.文.match(/第二期/g) || []).length, 5);
    });
  } finally {
    await 关(终端.s);
    await 关(桩.s);
  }
  console.log('  ' + passed + ' 项通过');
})().catch((e) => { console.error('✗ ' + (e && e.stack || e)); process.exit(1); });
