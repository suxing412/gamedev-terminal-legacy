// views.js — V1 日报页 / V2 原始流页 / V3 健康读口（M1c）
//
// 挂在既有 express app 上。**这是与施工令 A3（零框架 node:http）的一处已知偏离**：
// 终端在建坐席时已经引入 express 且跑在同一个进程里，此刻另起一个 node:http 服务
// 等于同仓两个 HTTP 栈、两套中间件语义、两个端口——为守一条选型条文而制造的复杂度
// 比条文本身要治的复杂度更大。偏离记在这里，改不改是制作人的事，不是悄悄绕过去。
const express = require('express');
const nodeFs = require('fs');
const nodePath = require('path');
const 读 = require('../lib/读数');
const md渲染 = require('../render/md');
const { 壳, 头, 空态 } = require('../render/页');
const { 转义 } = md渲染;

// 版本号：唯一事实源是 package.json，本函数只是把它读出来。
//
// 用 fs 现读而不用 `require('../../package.json')`：require 自带模块缓存，
// 首次之后永远返回那一份。/health 不是热路径，一次文件读的代价可以忽略，
// 而「问版本却拿到缓存里的旧值」恰恰是本函数要防的那件事的变种。
//
// 读不到返 null 而不是编一个：**不知道**要和**是某个值**长得不一样。
// 冒烟若拿到一个假版本号照样判过，这个字段就白加了。
function 版本号() {
  try {
    return JSON.parse(nodeFs.readFileSync(nodePath.join(__dirname, '..', '..', 'package.json'), 'utf8')).version || null;
  } catch { return null; }
}

// 评分要跟日报**同一把时钟**。
// 新鲜度分按「发布距今」衰减，拿此刻当今就会算出另一个数：实测 12 条入选里
// 用 生成于 当时钟 12 条全对，用 此刻 只对 6 条。流页上写着一个和日报对不上的分，
// 比不写分更坏——读的人会以为其中一个错了，却无从判断是哪个。
function 当日时钟(日报, 条目) {
  if (日报 && 日报.清单 && 日报.清单.生成于) {
    const t = Date.parse(日报.清单.生成于);
    if (Number.isFinite(t)) return t;
  }
  // 没有日报（流有、报没出）：退到当天最后一次抓取时刻，仍是「那一天的钟」，不是此刻。
  const ts = 条目.map((e) => Date.parse(e.fetched_at)).filter(Number.isFinite);
  return ts.length ? Math.max(...ts) : Date.now();
}

function 挂(app, 根) {
  const r = express.Router();

  // ---- V1 日报页 ----
  const 出日报 = (res, 日) => {
    const 全 = 读.日报日期(根);
    const d = 读.日报(根, 日);
    const { 上一日, 下一日 } = 读.邻日(全, 日);
    const 头部 = 头({ 日, 当前: 'digest', 上一日, 下一日, 标题: '情报日报' });
    if (!d) {
      return res.status(200).type('html').send(壳({
        题: `${日} · 日报未生成`, 头部,
        body: 空态({ 日, 最近: 全.slice(0, 7), 当前: 'digest' }),
      }));
    }
    const 条数 = d.清单 && Array.isArray(d.清单.入选) ? d.清单.入选.length : null;
    const 副 = 条数 == null ? '' : `<p class="meta">${条数} 条入报 · <a href="/stream/${转义(日)}">看当日原始流</a></p>`;
    res.status(200).type('html').send(壳({
      题: `${日} · 情报日报`, 头部,
      body: `<article class="digest">${副}${md渲染.渲染(d.md)}</article>`,
    }));
  };

  // **与施工令 V1 的一处路径偏离**：V1 写「默认路由 `/` 落最新日报」，但 `/` 已经是坐席
  // （常驻值班屏，M3 的正主）。把日报挂到 `/` 等于用一张阅读页顶掉值班屏，那是本末倒置。
  // 行为一字不改，只换锚点：`/digest` 不带日期＝最新一期。
  r.get('/digest/:d?', (req, res) => {
    const 全 = 读.日报日期(根);
    if (req.params.d && !读.是日(req.params.d)) return res.redirect(302, '/digest');
    // 默认落**最新一期**而不是「今天」：早上八点前今天还没出报，落今天等于天天开屏见空态。
    出日报(res, req.params.d || 全[0] || 读.本地日());
  });

  // ---- V2 原始流页 ----
  r.get('/stream/:d?', (req, res) => {
    const 全 = 读.流日期(根);
    const 日 = 读.是日(req.params.d) ? req.params.d : (全[0] || 读.本地日());
    const s = 读.流(根, 日);
    const { 上一日, 下一日 } = 读.邻日(全, 日);
    const 头部 = 头({ 日, 当前: 'stream', 上一日, 下一日, 标题: '原始流' });
    if (!s || !s.条目.length) {
      return res.status(200).type('html').send(壳({
        题: `${日} · 原始流为空`, 头部,
        body: 空态({ 日, 最近: 全.slice(0, 7), 当前: 'stream' }),
      }));
    }

    const 报 = 读.日报(根, 日);
    const 权 = 读.评分权重(根);
    const 钟 = 当日时钟(报, s.条目);
    const 记分 = new Map();          // 日报记过的分：优先照抄，不重算
    const 精编 = new Map();
    if (报 && 报.清单) {
      for (const x of (报.清单.入选 || [])) 记分.set(x.id, x.总分);
      const p = 报.清单.精编;
      if (p && typeof p === 'object') for (const [k, v] of Object.entries(p)) if (typeof v === 'string') 精编.set(k, v);
    }
    // 按相对路径 require，不用 path.join(根,…)：根是**数据根**，代码位置与它无关。
    // 用 根 拼代码路径时，根一旦是相对路径就会被 require 当成包名去 node_modules 里找（实测炸过）。
    const { 打分 } = require('../../intel/scoring');
    const 源名 = new Map(读.源表(根).map((x) => [x.id, x.名称 || x.id]));

    const 带分 = s.条目.map((e) => {
      const 记 = 记分.get(e.id);
      const 分 = 记 != null ? 记 : (权 ? 打分(e, 权, 钟).总分 : null);
      return { ...e, 分, 入报: 记分.has(e.id) };
    }).sort((a, b) => (b.分 || 0) - (a.分 || 0));

    const 组 = new Map();
    for (const e of 带分) { if (!组.has(e.source)) 组.set(e.source, []); 组.get(e.source).push(e); }

    const 时 = (s2) => { const t = Date.parse(s2); return Number.isFinite(t) ? new Date(t).toLocaleString('zh-CN', { hour12: false }).slice(5) : '时刻不详'; };
    const 条HTML = (e) => {
      const 链 = md渲染.安全链(e.url);
      const 题 = 链
        ? `<a class="t" href="${转义(链)}" rel="noopener noreferrer" target="_blank">${转义(e.title || '(无标题)')}</a>`
        : `<span class="t">${转义(e.title || '(无标题)')}</span>`;
      const 注 = 精编.get(e.id) || e.raw_excerpt || '';
      return `<li class="item" data-src="${转义(e.source)}" data-tier="${转义(e.tier || '')}" data-in="${e.入报 ? '1' : '0'}">
  <div class="row">${题}</div>
  <div class="sub"><span class="tier t${转义(e.tier || '')}">${转义(e.tier || '?')}</span>
    <span class="src">${转义(源名.get(e.source) || e.source)}</span>
    <span class="ts">${转义(时(e.published_at || e.fetched_at))}</span>
    <span class="sc">${e.分 == null ? '—' : 转义(String(e.分)) + ' 分'}</span>
    ${e.入报 ? '<span class="badge">已入报</span>' : ''}</div>
  ${注 ? `<details><summary>${e.lang === 'zh' ? '重点标注' : '中文精编'}</summary><p>${转义(注).slice(0, 4000)}</p></details>` : ''}
</li>`;
    };

    const 分组HTML = [...组.entries()].map(([src, 组条]) => `<section class="grp">
  <h2>${转义(源名.get(src) || src)} <span class="n">${组条.length}</span></h2>
  <ul class="items">${组条.map(条HTML).join('')}</ul>
</section>`).join('');

    // 源下拉列**全部配置过的源**，不是「数据里出现过的」。
    //
    // 首版是 `[...组.keys()]`——于是一个当天颗粒无收的源在这一页**完全不存在**：
    // 你看不出「四个源里三个没出货」，只会以为这台机器本来就只订了一个源。
    // 而这四个源的实况是 Game Developer 403、itch.io 连接超时、explorminate 从未被调度
    // ——那正是这一页最该告诉人的事，它却把这件事藏起来了。
    // （PRODUCT.md 原则五：宁可显示「读不到」，绝不显示占位数。零也是数，不能不显示。）
    const 全部源 = 读.源表(根);
    const 组计 = new Map([...组.entries()].map(([k, v]) => [k, v.length]));
    const 无货 = 全部源.filter((x) => !组计.get(x.id));
    const 源项 = 全部源.map((x) => {
      const n = 组计.get(x.id) || 0;
      return `<option value="${转义(x.id)}"${n ? '' : ' disabled'}>`
        + `${转义(x.名称 || x.id)}（${n} 条）</option>`;
    }).join('');

    // 档位同理：配置里有 S/A/B 三档，只列数据里出现过的会让「S 档今天一条没有」看不见
    const 全部档 = [...new Set([...全部源.map((x) => x.档位).filter(Boolean),
      ...带分.map((e) => e.tier).filter(Boolean)])].sort();
    const 档计 = new Map();
    for (const e of 带分) if (e.tier) 档计.set(e.tier, (档计.get(e.tier) || 0) + 1);
    const 档项 = 全部档.map((t) => {
      const n = 档计.get(t) || 0;
      return `<option value="${转义(t)}"${n ? '' : ' disabled'}>${转义(t)}（${n} 条）</option>`;
    }).join('');

    const 滤 = `<div class="filters">
  <label>源 <select id="f-src"><option value="">全部（${带分.length} 条）</option>${源项}</select></label>
  <label>档位 <select id="f-tier"><option value="">全部</option>${档项}</select></label>
  <label class="ck"><input type="checkbox" id="f-in"><span>只看已入报</span></label>
  <span class="count" id="f-count">${带分.length} 条</span>
  <button type="button" class="f-clr" id="f-clr" hidden>清掉筛选</button>
</div>
<p class="f-empty" id="f-empty" hidden></p>`
      // 没出货的源单列一行。**这是这一页最该说的话**：不是「今天只有这些」，
      // 是「今天有几个源什么都没给你」——两句话在值班屏上完全不同。
      + (无货.length ? `<p class="noyield">今天有 ${无货.length} 个源颗粒无收：`
        + 无货.map((x) => 转义(x.名称 || x.id)).join('、')
        + `　<a href="/watch">去监视页看为什么</a></p>` : '');

    res.status(200).type('html').send(壳({
      题: `${日} · 原始流`, 头部,
      body: `${滤}${s.坏行 ? `<p class="warn">${s.坏行} 行无法解析，已跳过（其余照常显示）</p>` : ''}${分组HTML}`,
      脚本: '<script src="/stream.js"></script>',
    }));
  });

  // ---- V3 健康读口（JSON，机器口径）----
  r.get('/health', (req, res) => {
    const 日 = 读.是日(req.query.日) ? String(req.query.日) : 读.本地日();
    const 全 = 读.健康流水(根);
    const 源 = 读.源表(根);
    const s = 读.流(根, 日);
    const 当日条数 = new Map();
    for (const e of (s ? s.条目 : [])) 当日条数.set(e.source, (当日条数.get(e.source) || 0) + 1);

    const 每源 = 源.map((x) => {
      const 我 = 全.filter((h) => h.source === x.id);
      const 成 = 我.filter((h) => h.ok === true);
      const 败 = 我.filter((h) => h.ok === false);
      const 末 = (a) => (a.length ? a[a.length - 1] : null);
      const 末成 = 末(成); const 末败 = 末(败);
      return {
        源: x.id, 名称: x.名称 || x.id, 档位: x.档位 || null,
        // 从没跑过就是 null，**不拿 0 或此刻冒充**——「没数据」和「数是零」是两件事，
        // 前者要去查调度，后者要去查源。混成一个值，两种病都看不出来。
        最近成功: 末成 ? 末成.t : null,
        最近失败: 末败 ? { t: 末败.t, 因: 末败.因 || null } : null,
        当日条数: 当日条数.get(x.id) || 0,
        累计成功: 成.length, 累计失败: 败.length,
      };
    });
    res.json({
      日,
      // 版本（2026-08-28）：换装冒烟**必须能问出「现在跑的是哪一份」**，否则验证只能靠
      // 「接口通不通」，而旧实例同样通——监制台 0.40.1 那次假换装正是这么过的关：
      // 报了「已换装」，其实老进程还在跑，直到 G15 码印闸把它抓出来。
      // 终端这侧此前连一个报版本的口都没有（/version 与 /api/version 皆 404），
      // 结构上无法按同一条纪律验证。这一格补上，读 package.json，不另立事实源。
      版本: 版本号(),
      源数: 源.length,
      当日总条数: s ? s.条目.length : 0,
      当日出报: !!读.日报(根, 日),
      每源,
    });
  });

  app.use(r);
  return r;
}

module.exports = { 挂, 当日时钟 };
