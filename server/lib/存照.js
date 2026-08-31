// 存照.js — 席间存照的读取与分型层。
//
// 设计与五轮异厂评审（累计 52 条击杀）见 docs/方案-席间存照-2026-08-29.md。
// 三条贯穿全文件的取向，每条都是被击杀换来的：
//
// **一 · 判不准的分类，不许用来决定「显示或不显示」。**
//   前两稿试图把消息分成「对话流／附件」两堆，于是每次分错都藏掉东西。
//   改成：一条不移一条不藏，判别只决定「带不带标记」「先展开还是先折叠」。
//   误判的代价从「藏住内容」降到「少个标记」或「多折一行」。
//
// **二 · 行序是唯一的稳定标识。**
//   历史 325 条没有 id 字段（实测），而 t+from+text 在重试写入时会三者全同。
//   行序（文件里第几行）对 append-only 的文件是天然不可变序号，
//   既是 ID 的一部分，也是分页游标——用 offset 做游标的话，边读边追加会重复取。
//
// **三 · 形状坏了要计数，不许让它把整页带崩。**
//   一条合法 JSON 但 text:null 不会命中「解析失败」，却会让 sha1/首行判别全抛错。
//   解析坏行与结构坏行分开计数：一个是写坏了，一个是写了个合法但不该有的形状。
'use strict';

const fs = require('fs');
const crypto = require('crypto');

// 播报判别：发言人 + 前缀双条件。**但它只用于折叠，不用于排除**——
// 实测「排期复判：TK-312 的回执请总监签字」同样命中，而那是真对话。
// 数据里只有 t/from/text，没有收件人也没有类型，这件事在数据层就是不可判的；
// 承认边界，用折叠而不是排除（方案 §2.5.1）。
const 播报席 = '项管';
const 播报前缀 = /^(排期复判|产线空转|到点无单|零派发)/;

// 产出物判别：首行像标题 + 命中产出词或工单号。
// 判错只是少个标记（东西仍在流里），故取宽不取严——宁可少折，不可错折。
const 产出词 = /(报告|清单|回执|纪要|复盘|方案)/;
const 工单号 = /\b[A-Z]{2,3}-\d+\b/;

/** 一条的形状校验。返回 null 表示形状没问题，否则返回不合格的理由。 */
function 形状不合(o) {
  if (!o || typeof o !== 'object') return '不是对象';
  if (typeof o.from !== 'string' || !o.from.trim()) return 'from 不是非空字符串';
  if (typeof o.text !== 'string') return 'text 不是字符串（' + (o.text === null ? 'null' : typeof o.text) + '）';
  if (!Number.isFinite(Date.parse(String(o.t)))) return 't 不是可解析时刻';
  return null;
}

/** 条目 ID = 行序 + 时刻 + 正文哈希。行序对 append-only 文件是不可变序号。 */
function 算ID(行序, o) {
  const h = crypto.createHash('sha1').update(String(o.text || '')).digest('hex').slice(0, 8);
  return 行序 + '|' + String(o.t) + '|' + h;
}

function 是播报(o) {
  return o.from === 播报席 && 播报前缀.test(o.text || '');
}

/** 产出物 = 首行像标题（≤30 字、无句末标点）且命中产出词或工单号。 */
function 是产出物(o) {
  const 首 = String(o.text || '').split('\n')[0].trim();
  if (!首 || 首.length > 30) return false;
  if (/[。！？!?]$/.test(首)) return false;          // 有句末标点＝在说话，不是标题
  return 产出词.test(首) || 工单号.test(首);
}

/** 逻辑行数：按 \n 切。**不按视觉行**——视觉行依赖字体/视口/浏览器，机器判不了。 */
const 逻辑行数 = (s) => String(s || '').split('\n').length;

/**
 * 读(路径, opts) → { ok, 条[], 总行数, 坏行, 结构坏行, 末行未闭合, 播报数, 附件数, 因? }
 *
 * opts: { 起行, 取数, 现在 }
 *   起行 —— 从第几行开始要（1 起）。不给则取最后 取数 条。
 *   取数 —— 要几条（默认 60）。
 *
 * **全文件扫一遍**：包络内 325 条 / 150 KB，一遍是毫秒级。
 * 附件索引与播报计数都必须扫全量——只扫当前页的话，唯一那份附件在第 1 条
 * 而首屏只有最近 60 条时，「只看有附件」会返回空（五评击杀⑥）。
 */
function 读(路径, opts = {}) {
  let 原;
  try { 原 = fs.readFileSync(路径, 'utf8'); }
  catch (e) { return { ok: false, 因: '读不到：' + (e.code || e.message) }; }
  if (原.charCodeAt(0) === 0xfeff) 原 = 原.slice(1);

  const 行 = 原.split('\n');
  // 末尾若无换行结尾，最后一段可能是写方正在追加的半行
  let 末半 = '';
  if (原.length && !原.endsWith('\n')) 末半 = 行.pop() || '';

  const 全 = [];
  let 坏行 = 0, 结构坏行 = 0;
  for (let i = 0; i < 行.length; i++) {
    const t = 行[i].trim();
    if (!t) continue;
    let o;
    try { o = JSON.parse(t); }
    catch { 坏行 += 1; continue; }                   // 写坏了
    const 不合 = 形状不合(o);
    if (不合) { 结构坏行 += 1; continue; }            // 合法 JSON 但形状不对（五评击杀④）
    全.push({
      行序: i + 1,
      id: 算ID(i + 1, o),
      t: o.t,
      from: o.from,
      text: o.text,
      播报: 是播报(o),
      产出物: 是产出物(o),
      行数: 逻辑行数(o.text),
    });
  }

  // 播报数与附件数扫全量，与分页无关
  const 播报数 = 全.filter((x) => x.播报).length;
  const 附件 = 全.filter((x) => x.产出物);

  // 谁真的说过话（扫全量）。**这一格是实测出来的，不是名单抄来的。**
  // 实测发现两套名字空间对不上：线程里说话的是 制作人／Claude／项管，
  // 而 坐席.js 的名单是 助理／总监／终端项管／情报主管／财务／市场／营销——**交集为空**。
  // 左栏若只照名单画，就会显示七个从没说过话的名字，看着像参与者其实是另一个系统的花名册。
  // 这是「黑箱」的同一个病换了张脸：界面说的和实际发生的不是一回事。
  const 发言人 = new Map();
  for (const x of 全) {
    const v = 发言人.get(x.from) || { 名: x.from, 条: 0, 播报: 0, 最近: null };
    v.条 += 1;
    if (x.播报) v.播报 += 1;
    if (!v.最近 || String(x.t) > String(v.最近)) v.最近 = x.t;
    发言人.set(x.from, v);
  }

  // 分页：游标是行序不是 offset——追加不影响已取区间的编号。
  //
  // **名额只给对话，播报顺带捎上。** 实测：最近 60 条里 53 条是播报（88%），
  // 按条数取的话首屏就是一屏灰色折行，只剩 7 条真内容——
  // 而播报恰恰是我们判定「不值得读所以折起来」的那一类。
  // 让不值得读的东西占满名额，等于把分页的预算花在噪声上。
  const n = Number(opts.取数) || 60;
  const 候 = opts.起行 != null ? 全.filter((x) => x.行序 < Number(opts.起行)) : 全;
  let 片 = [];
  let 对话数 = 0;
  for (let i = 候.length - 1; i >= 0; i--) {
    片.unshift(候[i]);
    if (!候[i].播报) 对话数 += 1;
    if (对话数 >= n) break;
    if (片.length >= n * 12) break;   // 兜底：全是播报时不至于把整个文件拉进来
  }

  return {
    ok: true,
    条: 片,
    总条数: 全.length,
    总行数: 行.length,
    最早行序: 全.length ? 全[0].行序 : null,
    还有更早: !!(片.length && 全.length && 片[0].行序 > 全[0].行序),
    坏行: 坏行,
    结构坏行: 结构坏行,
    播报数: 播报数,
    发言人: [...发言人.values()].sort((a, b) => b.条 - a.条),
    附件: 附件.map((x) => ({ id: x.id, 行序: x.行序, from: x.from, t: x.t, 题: String(x.text).split('\n')[0].trim(), 字数: String(x.text).length })),
    附件数: 附件.length,
    末行未闭合: !!末半,
    末半字节: Buffer.byteLength(末半, 'utf8'),
  };
}

/**
 * 末行长期不闭合的判定（四评击杀④）。
 * 原样写「等下轮」，在写方崩溃或磁盘满时会**永远等下去**——页面既不报坏行也不提示缺失，
 * 那一条就永久不可查了。而这一页的立身之本恰恰是可查。**等待要有上限。**
 *
 * 记忆存在调用方（进程内），首见时刻由调用方给——不靠 mtime：
 * 五评指出写方每 4 分 59 秒补一个字节的话，mtime 永远不足阈值。
 */
function 末行陈旧(状态, 现在, 阈值毫秒 = 300000) {
  if (!状态 || !状态.首见) return null;
  const 龄 = 现在 - 状态.首见;
  return 龄 >= 阈值毫秒 ? { 陈旧: true, 分钟: Math.round(龄 / 60000) } : null;
}

module.exports = { 读, 算ID, 是播报, 是产出物, 逻辑行数, 形状不合, 末行陈旧, 播报前缀, 产出词 };
