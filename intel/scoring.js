// scoring.js — 评分与入选规则引擎（施工令 P6）
//
// **纯函数**：条目 + 配置 → 分数 / 入选集合。不读盘、不看时钟（现在时刻从参数进来）。
// 这么写是为了判据 C3 能做到：调 scoring.json 的权重 → 断言入选集合随之变化。
// 集合不变就说明规则没接配置，必红。
//
// 两条入选规则把「垂直深挖 + 主流广覆盖」落成可测的东西：
//   · S 档（SLG 垂直）降门槛全入候选——深挖不靠分数竞争，靠身份
//   · A/B 档按总分取 topN——广覆盖靠择优
// 分数构成整个落盘（§3.2 的 score 字段），日报因此能解释「为什么选它」。

// 词边界匹配：'strategy' 不该命中 'strategically'。
// 关键词含空格（'grand strategy'）时也要整体匹配，所以逐词转义后按边界拼。
function 建正则(词) {
  const 转 = String(词).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // \b 对 CJK 不起作用，但本期关键词表全是英文；将来加中文词要换判法，这行注释是路标
  return new RegExp(`(^|[^a-z0-9])${转}([^a-z0-9]|$)`, 'i');
}

function 关键词命中(文本, 表) {
  const t = String(文本 || '').toLowerCase();
  const 中 = [];
  for (const 词 of Object.keys(表)) if (建正则(词).test(t)) 中.push(词);
  return 中;
}

function 新鲜度(发布时刻, 现在, cfg) {
  const t = Date.parse(发布时刻 || '');
  // 无日期不该冒充最新，也不该被当成最旧——给一个中间的固定分
  if (Number.isNaN(t)) return cfg.无日期分;
  const 小时 = Math.max(0, (现在 - t) / 3600000);
  // 指数半衰：满分 × 0.5^(小时/半衰)
  return Math.round(cfg.满分 * Math.pow(0.5, 小时 / cfg.半衰小时));
}

// 打分：单条目 → { 总分, 源基础分, 关键词分, 新鲜度分, tags }
function 打分(条, cfg, 现在 = Date.now()) {
  const 基 = cfg.源基础分[条.tier] != null ? cfg.源基础分[条.tier] : 0;
  const tags = 关键词命中(`${条.title || ''} ${条.raw_excerpt || ''}`, cfg.关键词分.表);
  const 词分 = tags.reduce((s, w) => s + (cfg.关键词分.表[w] || 0), 0);
  const 鲜 = 新鲜度(条.published_at, 现在, cfg.新鲜度分);
  return { 总分: 基 + 词分 + 鲜, 源基础分: 基, 关键词分: 词分, 新鲜度分: 鲜, tags };
}

// 入选：候选集 → { 入选, 落选 }，入选按总分降序
function 选(条目们, cfg, 现在 = Date.now()) {
  const 打过 = 条目们.map((条) => ({ ...条, score: 打分(条, cfg, 现在), tags: 打分(条, cfg, 现在).tags }));
  const 降序 = (a, b) => b.score.总分 - a.score.总分;

  // 规则一：S 档降门槛全入（门槛可配，默认 0）
  const S入 = 打过.filter((x) => x.tier === 'S' && x.score.总分 >= cfg.入选.S档门槛).sort(降序);
  // 规则二：A/B 档按总分取 topN
  const AB = 打过.filter((x) => x.tier !== 'S').sort(降序);
  const AB入 = AB.slice(0, cfg.入选.AB档topN);

  // 合并后再受日报条数上限约束（S 档优先占位——垂直深挖是本终端的主张）
  const 合 = [...S入, ...AB入].slice(0, cfg.入选.日报条数上限);
  const 入选ID = new Set(合.map((x) => x.id));
  return {
    入选: 合.sort(降序),
    落选: 打过.filter((x) => !入选ID.has(x.id)).sort(降序),
  };
}

module.exports = { 打分, 选, 关键词命中, 新鲜度, 建正则 };
