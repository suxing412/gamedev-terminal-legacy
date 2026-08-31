// assemble.js — 日报装配（施工令 P8）
//
// **纯函数**：候选集 + 精编产物 → { md, 入选清单 }。不读盘不写盘，落盘由 run.js 做。
// 版式定死一组，不做配置——这是内部工具，给自己一个人看，可配置只会变成没人调的旋钮。
//
// 五区（施工令原话）：头条 ≤3 → SLG 垂直区 → 主流广览区 → 论文与工具角 → 尾注源健康
//
// 两条不许违反的：
//   · 每条必带原文直达链接（定案 Q2：原文直达）
//   · 中文源出重点标注、**绝不做摘要替代**（定案 Q2 原话纪律）
// 降级：AI 通道失败时出「本条未精编」标注的日报，**绝不出空报、绝不静默吞报**（P8）。

const 区归属 = (条) => {
  if (条.tier === 'S' || 条.类 === 'SLG垂直') return 'slg';
  if (条.类 === '论文' || 条.类 === '工具') return '角';
  return '广';
};

const 链 = (条) => `[${条.title.replace(/[[\]]/g, '')}](${条.url})`;

function 一条(条) {
  const 行 = [`- ${链(条)} — \`${条.source}\``];
  const 分 = 条.score ? `（${条.score.总分} 分：源 ${条.score.源基础分} + 词 ${条.score.关键词分} + 鲜 ${条.score.新鲜度分}）` : '';
  if (分) 行[0] += ' ' + 分;
  if (条.lang === 'zh') {
    // 中文源：重点标注，不摘要
    if (条.zh_highlights && 条.zh_highlights.length) {
      for (const h of 条.zh_highlights) 行.push(`  - 重点：${h}`);
    } else if (条.raw_excerpt) {
      行.push(`  - ${条.raw_excerpt.slice(0, 160)}`);
    }
  } else if (条.zh_digest) {
    行.push(`  - ${条.zh_digest}`);
  } else {
    // 降级标注：写出来，不静默
    行.push('  - *（本条未精编）*');
  }
  return 行.join('\n');
}

function 装配({ 入选, 日期, 健康 = [], 上限 = 18, 精编果 = null }) {
  const 条 = 入选.slice(0, 上限);
  const 头条 = 条.slice(0, 3);
  const 余 = 条.slice(3);
  const 分区 = { slg: [], 广: [], 角: [] };
  for (const c of 余) 分区[区归属(c)].push(c);

  const md = [];
  md.push(`# 情报日报 · ${日期}`);
  md.push('');
  md.push(`> 共 ${条.length} 条 · 五分钟读完 · 每条可点原文直达`);
  md.push('');

  md.push('## 头条');
  md.push('');
  md.push(头条.length ? 头条.map(一条).join('\n') : '_今日无够格头条_');
  md.push('');

  md.push('## SLG 垂直');
  md.push('');
  md.push(分区.slg.length ? 分区.slg.map(一条).join('\n') : '_本区今日无新条目_');
  md.push('');

  md.push('## 主流广览');
  md.push('');
  md.push(分区.广.length ? 分区.广.map(一条).join('\n') : '_本区今日无新条目_');
  md.push('');

  md.push('## 论文与工具角');
  md.push('');
  md.push(分区.角.length ? 分区.角.map(一条).join('\n') : '_本区今日无新条目_');
  md.push('');

  md.push('## 源健康');
  md.push('');
  if (!健康.length) md.push('_无抓取记录_');
  else {
    for (const h of 健康) {
      md.push(`- \`${h.source}\` ${h.ok ? '✓' : '✗'} ${h.ok ? `${h.新增} 新 / ${h.重复} 重` : String(h.因 || '失败').slice(0, 80)}`);
    }
  }
  // 精编成败也进尾注：**AI 挂了要看得见**。不写的话，读者只会觉得「今天怎么好多条没精编」，
  // 而看不出是通道出了问题——那正是 P8「绝不静默吞报」要防的另一半。
  if (精编果 && (精编果.成 || 精编果.败)) {
    md.push(`- \`精编\` ${精编果.败 ? '✗' : '✓'} 成 ${精编果.成} / 败 ${精编果.败}`
      + (精编果.败 ? `　（${(精编果.失败因 || []).slice(0, 2).map((x) => String(x.因).slice(0, 60)).join('；')}）` : ''));
  }
  md.push('');

  const 清单 = {
    日期,
    生成于: null,          // 由 run.js 落盘时补——纯函数不看时钟
    入选: 条.map((c) => ({ id: c.id, source: c.source, title: c.title, url: c.url, 总分: c.score ? c.score.总分 : null })),
    区: { 头条: 头条.map((c) => c.id), slg: 分区.slg.map((c) => c.id), 广: 分区.广.map((c) => c.id), 角: 分区.角.map((c) => c.id) },
  };

  return { md: md.join('\n'), 清单 };
}

module.exports = { 装配, 一条, 区归属 };
