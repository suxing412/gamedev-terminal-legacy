// 路由.js — 群聊 @ 规则与可替换模型调用边界。
const 坐席 = require('./坐席');
const { 是白名单 } = require('./线程');

function 提及(文) {
  const 名单 = [];
  const re = /@([^\s@，。！？、,.!?;；:：()（）]+)/g;
  for (const m of String(文 || '').matchAll(re)) 名单.push(m[1]);
  const 全体 = 名单.includes('全体');
  const 未知 = 名单.filter((名) => 名 !== '全体' && !坐席.是已知(名));
  return { 名单, 全体, 未知 };
}

/** 给定一条发言，算出本轮实际调用的坐席；占位席永远不会进入 唤起。 */
function 规划({ 发言人 = '制作人', 文 }) {
  if (!是白名单(发言人)) return { ok: false, 拒绝: true, 因: `不在群聊白名单内：${发言人}`, 唤起: [], 应答: [] };
  const 提及结果 = 提及(文);
  if (提及结果.未知.length) return { ok: false, 拒绝: true, 因: `未知职能：${提及结果.未知.join('、')}`, 唤起: [], 应答: [] };

  let 唤起;
  if (提及结果.全体) {
    唤起 = 坐席.已接模型();
  } else if (!提及结果.名单.length) {
    唤起 = [坐席.按名('助理')];
  } else {
    const 被点 = 提及结果.名单.map(坐席.按名).filter((x) => x && x.接模型);
    唤起 = [坐席.按名('助理'), ...被点];
  }
  const 去重 = [...new Map(唤起.map((x) => [x.名, x])).values()];
  return { ok: true, 拒绝: false, 唤起: 去重, 应答: 去重.filter((x) => x.名 !== '助理'), 提及: 提及结果 };
}

/**
 * 调用接口由外层注入：生产环境接既有 Claude Agent SDK，判据只注入计数桩。
 * 助理本轮仍会读，但它不是默认应答者；无 @ 时因此不会产生应答落线程。
 */
async function 调用一轮({ 发言人 = '制作人', 文, 调用, 计划 = null }) {
  const p = 计划 || 规划({ 发言人, 文 });
  if (!p.ok) return p;
  if (typeof 调用 !== 'function') return { ...p, ok: false, 因: '未配置模型调用接口', 结果: [] };
  const 结果 = [];
  for (const 席 of p.唤起) {
    const 返回 = await 调用({ 坐席: 席, 文: String(文 || '') });
    结果.push({ 坐席: 席.名, 返回 });
  }
  return { ...p, 结果 };
}

module.exports = { 提及, 规划, 调用一轮 };
