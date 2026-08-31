// run.js — 情报官 CLI（施工令 M1a：独立可跑，不 import server）
//   node intel/run.js fetch  [--source=<id>] [--date=<YYYY-MM-DD>] [--base=<目录>]
//   node intel/run.js digest [--date=<YYYY-MM-DD>] [--base=<目录>]
//
// --base 是给判据用的：把整棵数据树指到临时目录，测试就能真跑全链而不脏真实台账。
const fs = require('fs');
const path = require('path');
const { 解析 } = require('./adapters/rss');
const dedupe = require('./dedupe');
const scoring = require('./scoring');
const { 装配 } = require('./assemble');

const 参 = (k, d = null) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3) : d;
};
const 今日 = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// 数据一律落 base（数据根）；**配置先看数据根，取不到回落随包那份**。
//
// 两者取向不同，所以不能共用一条规则：
//   · 数据是运行期产出，装成 exe 后 base 是用户放 exe 的目录——写得进、留得住。
//   · 配置是随代码走的正本，但又得让人能就地改（换源、调权重）而不必重新打包。
// 故配置走「就近覆盖」：数据根有就用数据根的，没有就用包里的。
// 不做回落的话，装好的 exe 第一次启动就因为「读不到 config/sources.json」直接抛。
function 配置件(base, 名) {
  const 近 = path.join(base, 'config', 名);
  if (fs.existsSync(近)) return 近;
  return path.join(__dirname, '..', 'config', 名);
}

function 布局(base) {
  const p = (...a) => path.join(base, ...a);
  return {
    源配置: 配置件(base, 'sources.json'),
    权重: 配置件(base, 'scoring.json'),
    流: (日) => p('data', 'stream', 日.slice(0, 7), `${日}.jsonl`),
    seen: (月) => p('data', 'state', `seen-${月}.txt`),
    游标: p('data', 'state', 'cursors.json'),
    健康: p('data', 'health', 'fetch.jsonl'),
    报md: (日) => p('data', 'digests', `${日}.md`),
    报json: (日) => p('data', 'digests', `${日}.json`),
  };
}

// fetch 的错误对象把真因塞在 .cause 里，外层只留一句「fetch failed」——
// 那句话对排查毫无用处（2026-08-28 实测：三源同挂而看不出是 UND_ERR_INVALID_ARG）。
// 健康台账要留的是真因，不是壳。
function 真因(e) {
  const c = e && e.cause;
  if (!c) return e;
  const 码 = c.code || c.errno || '';
  const 文 = c.message || String(c);
  return new Error(`${e.message}（${码 ? 码 + ': ' : ''}${文}`.slice(0, 180) + '）');
}

const 确保目录 = (f) => fs.mkdirSync(path.dirname(f), { recursive: true });
const 读JSON = (f, d = null) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const 追加 = (f, s) => { 确保目录(f); fs.appendFileSync(f, s, 'utf8'); };

// ---- fetch ----
// 单源失败不阻塞全班次（P3/判据 C6）：每源各自 try，坏源入 health，好源照常落盘。
async function 抓(opts = {}) {
  const base = opts.base || path.join(__dirname, '..');
  const L = 布局(base);
  const 日 = opts.date || 今日();
  const 只要 = opts.source || null;
  const cfg = 读JSON(L.源配置);
  if (!cfg) throw new Error('读不到 config/sources.json');

  const 月们 = dedupe.当月上月(new Date(日 + 'T00:00:00'));
  const seen = dedupe.载入seen((m) => fs.readFileSync(L.seen(m), 'utf8'), 月们);
  const 本月 = 月们[0];

  // 走代理必须显式给 dispatcher。
  // **Node 的内置 fetch 不认 HTTPS_PROXY 环境变量**——这跟 curl/axios 的习惯相反，
  // 也是 2026-08-28 首跑真源时的现场：itch.io 在 curl --proxy 下 200，我的代码 fetch failed。
  // 施工令 P3 原本就写着「Node 内置 fetch(undici)+ProxyAgent」，是我写成了裸 fetch。
  // 源配置里的 走代理 字段这才真的起作用（此前它只是个没人读的字段——比没有更坏）。
  const 代理地址 = opts.代理 || process.env.HTTPS_PROXY || process.env.HTTP_PROXY || null;

  // **fetch 与 dispatcher 必须来自同一个 undici 实例**。
  // 2026-08-28 现场：我把 npm undici 的 ProxyAgent 传给 Node 全局 fetch（用的是内置 undici），
  // 报 UND_ERR_INVALID_ARG，且被 `fetch failed` 这层壳盖住看不出真因——
  // 三个源同时挂，比改之前更糟。跨实例传 dispatcher 是个安静的错，值得记在这儿。
  let U = null;
  try { U = require('undici'); } catch { U = null; }
  const 取 = U ? U.fetch : fetch;
  const 代理器 = (U && 代理地址) ? new U.ProxyAgent(代理地址) : null;

  const 头 = {
    // 默认 UA 会被一部分源当爬虫挡（gamedeveloper 实测 403）。装成常见浏览器，
    // 这是读自己订阅的公开 feed，不是绕付费墙。
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.8',
  };

  // 先直连，失败再走代理。**不是「配了走代理就只走代理」**——
  // 实测 arxiv 直连 200，而代理链路一出问题就把本来能抓的源一起带走。
  // 顺序反过来（代理优先）会让整条管道的可用性挂在 Clash 开没开上。
  const 取文 = opts.取文 || (async (源) => {
    const 试 = async (用代理) => {
      const o = { headers: 头, signal: AbortSignal.timeout(30000) };   // P3：单源超时 30s
      if (用代理 && 代理器) o.dispatcher = 代理器;
      const r = await 取(源.地址, o);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.text();
    };
    try { return await 试(false); } catch (e1) {
      if (!代理器) throw 真因(e1);
      try { return await 试(true); } catch (e2) { throw new Error(`直连 ${真因(e1).message} ／ 代理 ${真因(e2).message}`); }
    }
  });

  const 健康 = [];
  let 落盘 = 0;
  for (const 源 of cfg.源) {
    if (只要 && 源.id !== 只要) continue;
    // 停用源跳过但**留在配置里**：删掉就没人记得它为什么不在了（explorminate 410 案）
    if (源.停用) continue;
    const t0 = Date.now();
    try {
      const xml = await 取文(源);
      const { 条目, 丢弃 } = 解析(xml);
      let 新增 = 0; let 重复 = 0; let 滤掉 = 0;
      for (const c of 条目) {
        // 必须关键词过滤（arXiv 那种裸订日 50+ 条读不完的源）
        if (Array.isArray(源.必须关键词) && 源.必须关键词.length) {
          const t = `${c.title} ${c.raw_excerpt}`.toLowerCase();
          if (!源.必须关键词.some((w) => t.includes(String(w).toLowerCase()))) { 滤掉++; continue; }
        }
        const id = dedupe.键(c.url);
        if (seen.has(id)) { 重复++; continue; }
        seen.add(id);
        追加(L.seen(本月), id + '\n');
        追加(L.流(日), JSON.stringify({
          id, source: 源.id, tier: 源.档位, 类: 源.类, lang: 源.语种,
          url: c.url, title: c.title,
          published_at: c.published_at, fetched_at: new Date().toISOString(),
          raw_excerpt: c.raw_excerpt,
        }) + '\n');
        新增++; 落盘++;
      }
      健康.push({ source: 源.id, ok: true, 新增, 重复, 滤掉, 丢弃, 耗时ms: Date.now() - t0 });
    } catch (e) {
      // 坏源不带走好源
      健康.push({ source: 源.id, ok: false, 因: String((e && e.message) || e).slice(0, 200), 耗时ms: Date.now() - t0 });
    }
  }
  for (const h of 健康) 追加(L.健康, JSON.stringify({ t: new Date().toISOString(), 日, ...h }) + '\n');
  return { 日, 落盘, 健康 };
}

// ---- digest ----
async function 出报(opts = {}) {
  const base = opts.base || path.join(__dirname, '..');
  const L = 布局(base);
  const 日 = opts.date || 今日();
  const 权重 = 读JSON(L.权重);
  if (!权重) throw new Error('读不到 config/scoring.json');

  let 行 = [];
  try { 行 = fs.readFileSync(L.流(日), 'utf8').split(/\r?\n/).filter(Boolean); } catch { 行 = []; }
  const 条目 = 行.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

  // 时钟只取一次（2026-08-28 实测案）。
  //
  // 原样是 166 行 `Date.now()` 算分、211 行 `new Date()` 盖 生成于——**两次取钟**，
  // 中间隔着整个精编过程（今日实测 2.5 分钟，12 条 Opus）。新鲜度分按「发布距今」分档衰减，
  // 于是 生成于 比算分时刻晚两分多钟，条目一旦落在档位边界上就差 1 分。
  // 后果不只是判据红：日报正文里印着「49 分：源 30 + 词 0 + 鲜 19」，
  // 而拿它自称的生成时刻**复现不出那个数**——**账面自己对不上自己**。
  // 昨夜 12 条恰好都不在边界上，今日第 8 条跨了，判据「真账回放」当场抓出。
  const 此刻 = opts.现在 || Date.now();
  const { 入选 } = scoring.选(条目, 权重, 此刻);

  // 精编（P7）：**只精编入报候选**，不全量代读——一天几百条全喂进去额度撑不住，
  // 且落选条目的精编产物没人会读。
  // opts.精编 可注入桩（判据 C5 用它测降级路径）；不传则走真通道 reader.js。
  // **绝不吞报**：精编整体失败也照常出报，装配器对没有 zh_digest 的条目打「本条未精编」。
  // 环境闸：NO_INTEL / STUDIO_STUB 下一律不走真通道。
  // **默认走真通道是对的（那是生产），但默认必须对测试无害**——
  // 2026-08-28 实测：接通真精编后 m1a 的端到端立刻开始打真实 API，
  // 判据本该零额度。忘了传 精编:false 的调用点会静默烧钱，这道闸兜住它。
  const 禁真通道 = process.env.NO_INTEL === '1' || process.env.STUDIO_STUB === '1';
  let 精编果 = { 成: 0, 败: 0, 失败因: [] };
  if (opts.精编 !== false && !(禁真通道 && typeof opts.精编 !== 'function')) {
    try {
      if (typeof opts.精编 === 'function') {
        for (const c of 入选) {
          if (c.lang === 'zh') continue;
          try { c.zh_digest = await opts.精编(c); 精编果.成++; }
          catch (e) { 精编果.败++; 精编果.失败因.push({ id: c.id, 因: String((e && e.message) || e).slice(0, 120) }); }
        }
      } else {
        精编果 = await require('./reader').精编批(入选, opts);
      }
    } catch (e) {
      // 整个精编环节炸了（比如 SDK 都加载不起来）——记下来，照常出报
      精编果 = { 成: 0, 败: 入选.length, 失败因: [{ id: '*', 因: String((e && e.message) || e).slice(0, 160) }] };
    }
  }

  // 当日健康（只取本日行）
  let 健康 = [];
  try {
    健康 = fs.readFileSync(L.健康, 'utf8').split(/\r?\n/).filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter((x) => x && x.日 === 日);
  } catch { 健康 = []; }
  // 同源多班次只留最后一次
  const 末 = new Map();
  for (const h of 健康) 末.set(h.source, h);
  // 停用源不进源健康：它今天早些时候的失败记录是历史，标停用之后再显示成 ✗ 会让人
  // 每天都以为有个源坏着（explorminate 410 案）。**停用是已处置，不是待处置。**
  const 停用集 = new Set(((读JSON(L.源配置) || {}).源 || []).filter((s) => s.停用).map((s) => s.id));
  for (const id of 停用集) 末.delete(id);

  const { md, 清单 } = 装配({ 入选, 日期: 日, 健康: [...末.values()], 上限: 权重.入选.日报条数上限, 精编果 });
  // **与算分同一把钟**（见上方 此刻 处的案由）：这个字段是日报里那些分数的复现依据，
  // 取第二次钟就等于给出一个复现不出自己分数的时间戳。
  清单.生成于 = new Date(此刻).toISOString();
  清单.精编 = { 成: 精编果.成, 败: 精编果.败, 失败因: (精编果.失败因 || []).slice(0, 10) };
  确保目录(L.报md(日));
  fs.writeFileSync(L.报md(日), md, 'utf8');
  fs.writeFileSync(L.报json(日), JSON.stringify(清单, null, 1), 'utf8');
  // 精编失败也进健康台账：**AI 挂了要看得见**，不能只表现为「日报里好多条没精编」
  if (精编果.败) {
    追加(L.健康, JSON.stringify({ t: new Date().toISOString(), 日, source: '__精编', ok: false,
      因: `精编 ${精编果.败} 条失败：${(精编果.失败因 || []).slice(0, 3).map((x) => x.因).join(' / ')}`.slice(0, 200) }) + '\n');
  }
  return { 日, 条数: 清单.入选.length, md路径: L.报md(日), 精编: { 成: 精编果.成, 败: 精编果.败 } };
}

module.exports = { 抓, 出报, 布局 };

if (require.main === module) {
  const 动作 = process.argv[2];
  const o = { base: 参('base'), date: 参('date'), source: 参('source') };
  const 跑 = 动作 === 'fetch' ? 抓 : 动作 === 'digest' ? 出报 : null;
  if (!跑) { console.error('用法：node intel/run.js fetch|digest [--source=id] [--date=YYYY-MM-DD] [--base=目录]'); process.exit(1); }
  跑(o).then((r) => { console.log(JSON.stringify(r, null, 1)); })
    .catch((e) => { console.error('失败：', (e && e.message) || e); process.exit(1); });
}
