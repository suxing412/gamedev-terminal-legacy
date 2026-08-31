// reader.js — 英文代读 + 中文精编（施工令 P7）
//
// 定案 Q10 已拍板：吃 Claude 额度、模型档 Opus high。
// 通道用 **Agent SDK**（不是施工令原写的 claude CLI 无头）——待拍板⑥「精编通道追认」的实际取向：
// 坐席已于 2026-08-27 换到 SDK 并实证过三件（走 claude.ai OAuth 订阅额度、逐字流式、会话可续），
// 同一进程里再起一套 CLI 无头是重复造轮子，且 CLI 那条路的三个坑（代理注入/中文走 stdin/
// PS5.1 数组解包）在 SDK 上本就不存在。
//
// 两条纪律，都来自定案 Q2 原话：
//   · **英文源**＝AI 代读 + 中文精编 + 原文直达
//   · **中文源**＝原文必读，AI 只做重点标注、**不做摘要替代**
// 所以本模块对中文条目走的是「标重点」而非「写摘要」——两个不同的提示词，不是一个函数换参数。
//
// 额度纪律（P7）：**只精编入报候选**，不全量代读。一天几百条全喂进去，额度撑不住，
// 而且落选条目的精编产物没人会读。

const 默认模型 = 'opus';

let _query = null;
async function 取query() {
  // SDK 是 ESM：必须动态 import（Electron 30 内置 Node 20 的 require 认不了）
  if (!_query) ({ query: _query } = await import('@anthropic-ai/claude-agent-sdk'));
  return _query;
}

const 英文提示 = (c) => [
  '你在给一个中文读者做英文技术情报的「代读+精编」。读者是独立游戏开发者，垂直方向 SLG/4X。',
  '输出规矩：',
  '· **只输出中文精编正文**，不要标题、不要前后缀、不要「以下是」这类话',
  '· 两到三句，60–120 字。第一句说这条讲了什么，第二句说对 SLG/系统设计有什么用（没用就直说没直接关系）',
  '· **不许夸大、不许替原文下它没下的结论**；原文只是新闻就说是新闻，别包装成洞见',
  '· 拿不准的地方宁可略过，不要编',
  '',
  `标题：${c.title}`,
  `摘要：${(c.raw_excerpt || '').slice(0, 800)}`,
].join('\n');

const 中文提示 = (c) => [
  '你在给一篇中文文章做「重点标注」。读者是独立游戏开发者，垂直方向 SLG/4X。',
  '**这不是摘要任务**：读者会自己读原文，你的活是把值得停下来细看的点指出来。',
  '你只拿得到标题与摘要，这是正常的——**就基于它们标**，不必说明这件事。',
  '输出规矩：',
  '· 输出 1–3 行，每行以「- 」开头，各是一个值得注意的点',
  '· 每行 ≤ 40 字，**用原文里的说法**，不要换成你的概括',
  '· **不许出现任何关于你自己的话**（「我只拿到…」「基于摘要…」「以下是…」这类一律不要）——',
  '  这些行会原样印进日报，读者要的是标注不是你的工作说明',
  '· 没有值得标的就只输出一行「- （无特别可标）」——**宁可说没有，也不要凑**',
  '',
  `标题：${c.title}`,
  `摘要：${(c.raw_excerpt || '').slice(0, 800)}`,
].join('\n');

// 元话语过滤：提示词已经写明不要，但模型偶尔仍会加一句自述（2026-08-28 实测中文条第一行
// 就是「只拿到标题和摘要，没有正文，所以…」）。**提示词是建议、代码才是闸**——
// 这条纪律在监制台 poolbalance.js 里写过一次，这里同理：能在代码里兜的别只靠提示词。
const 元话语 = /^(只?拿到|基于(摘要|标题)|以下是|由于|根据(提供的)?(摘要|标题|信息)|注：|说明：|没有正文)/;

// 精编一条。返回 { zh_digest } 或 { zh_highlights: [...] }；失败抛错（由调用方降级）。
async function 精编一条(c, opts = {}) {
  const query = await 取query();
  const 中文源 = c.lang === 'zh';
  const 代理 = opts.代理 || process.env.HTTPS_PROXY || 'http://127.0.0.1:7890';

  const q = query({
    prompt: 中文源 ? 中文提示(c) : 英文提示(c),
    options: {
      model: opts.模型 || 默认模型,
      env: { ...process.env, HTTPS_PROXY: 代理, HTTP_PROXY: 代理 },
      // 精编不需要工具：给了反而会让它去翻网页，既慢又可能把原文之外的东西写进来
      allowedTools: [],
      maxTurns: 1,
      ...(opts.CLI ? { pathToClaudeCodeExecutable: opts.CLI } : {}),
    },
  });

  let 文 = '';
  for await (const m of q) {
    if (m.type === 'assistant' && m.message && Array.isArray(m.message.content)) {
      for (const b of m.message.content) if (b.type === 'text' && b.text) 文 += b.text;
    } else if (m.type === 'result' && m.is_error) {
      throw new Error(String(m.result || m.subtype || '精编失败'));
    }
  }
  文 = 文.trim();
  if (!文) throw new Error('精编返回空');

  if (中文源) {
    const 行 = 文.split(/\r?\n/)
      .map((l) => l.replace(/^[-·•\s]+/, '').trim())
      .filter(Boolean)
      .filter((l) => !元话语.test(l))          // 代码兜底，不只靠提示词
      .slice(0, 3);
    if (!行.length) throw new Error('中文标注全是元话语或空——按失败处置，让装配器打「本条未精编」');
    return { zh_highlights: 行 };
  }
  const 净 = 文.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !元话语.test(l)).join(' ');
  if (!净) throw new Error('英文精编全是元话语或空');
  return { zh_digest: 净.replace(/\s+/g, ' ').slice(0, 300) };
}

// 批量：只精编传进来的这些（调用方已筛过入报候选）。
// **逐条独立 try**：一条失败不带走其余——降级路径的第一道（P8「绝不出空报」）。
async function 精编批(条目们, opts = {}) {
  const 出 = { 成: 0, 败: 0, 失败因: [] };
  for (const c of 条目们) {
    try {
      const r = await 精编一条(c, opts);
      Object.assign(c, r);
      出.成++;
    } catch (e) {
      出.败++;
      出.失败因.push({ id: c.id, 因: String((e && e.message) || e).slice(0, 120) });
      // 不写 zh_digest —— 装配器见空就打「本条未精编」，那正是要的：**显式留痕而非静默留白**
    }
  }
  return 出;
}

module.exports = { 精编一条, 精编批, 英文提示, 中文提示, 默认模型 };
