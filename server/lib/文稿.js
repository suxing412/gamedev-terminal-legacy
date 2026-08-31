// 文稿.js — 文稿台的根表、路径校验、列举、搜索、记号扫描。
//
// **全是纯函数**：不读环境变量、不碰 process、不自己决定根在哪。
// 根表由调用方喂进来——因为「根在哪」在源码态与 portable exe 态是两个不同的东西，
// 而那正是 2026-08-28 把 202 条数据写进 %TEMP% 的那个坑。
// 把它留在 server.js 一处解决，这里只管规则。
//
// ── 安全口径（本文件第一职责）─────────────────────────────────────
// 终端**无鉴权**（本机 127.0.0.1，任何网页都能对它发请求）。原 校档名() 的注释写着
// 「松一点就是任意文件读取」——文稿台加了写口之后，同一个洞变成**任意文件覆盖**。
// 所以 校路径() 四道，缺一不可，且**不许照抄 校档名()**：
// 它的第②③道靠 realpathSync(已存在的文件)，而新建文件时那两道天然失效（直接 throw）。
// 这里改成**先 realpath 父目录再拼**，新建与已存在走同一条路。
'use strict';

const fs = require('fs');
const path = require('path');

// ── 根表 ──────────────────────────────────────────────────────────
//
// 写 = true 可写 / false 只读 / '分区' 按 禁写 前缀逐条判。
// 「分区」这条规矩不是这里发明的，是 studio.config.json 的项目注册表自己写的：
//   「静态区可写；工单目录/journal/台账等活存储禁写——runner 每拍读写它们，
//     并发写产生的状态错乱 git 也还原不回。」
const 默认根表 = [
  { 键: 'terminal', 名: '终端仓', 路: 'D:/GitHub/gamedev-terminal', 写: true },
  { 键: 'ticketflow', 名: 'Ticketflow', 路: 'D:/GitHub/Ticketflow', 写: true },
  { 键: 'tk', 名: '三国SLG', 路: 'D:/GitHub/TK', 写: true },
  {
    键: 'studio', 名: '工作室', 路: 'D:/GitHub/AI-GameStudio', 写: '分区',
    禁写: [
      '监制台/回执', '监制台/完成', '监制台/归档', '监制台/在途', '监制台/初检',
      '监制台/呼叫', '监制台/仲裁', '监制台/待处理', '监制台/待重派', '监制台/执行失败',
      '监制台/待定夺', '监制台/草稿', '监制台/journal', '监制台/项管台账',
      '监制台/事件流存档', '终端/班次',
    ],
  },
  { 键: 'memory', 名: '记忆库', 路: '', 写: false },   // 路由调用方填（含用户名，不写死）
];

// 目录级剪枝。**必须在目录层剪，不能列完再滤**：
// TK 的 1460 个 md 里 1323 个在 Library/PackageCache（Unity 第三方包的 README），
// 那个目录还极大——列完再滤等于每次请求都把 Unity 的缓存走一遍。
const 默认剪枝 = [
  'node_modules', '.git', 'Library', 'PackageCache', 'obj', 'bin',
  'Temp', 'Logs', 'dist', 'build', '.next', '.cache', 'coverage',
];

const 斜 = (p) => String(p || '').replace(/\\/g, '/');
// Windows 大小写不敏感。两边都降一次，比较的是同一个口径。
const 归一 = (p) => 斜(p).replace(/\/+$/, '').toLowerCase();

function 取根(根表, 键) {
  return (Array.isArray(根表) ? 根表 : []).find((r) => r && r.键 === 键) || null;
}

/**
 * 在根内吗(真根, 某路) —— 落点判定，大小写与斜杠都归一后比。
 * 抽出来是为了**能上判据**：文件软链那条路在本机造不出实物
 * （建符号链接要管理员或开发者模式），只能把判断逻辑单独验。
 * 验不了的那一半（lstat 认不认得出软链）是 Node 的事，明写为盲区。
 */
function 在根内(真根, 某路) {
  if (!某路) return false;
  const a = 归一(真根);
  const b = 归一(某路);
  return b === a || b.startsWith(a + '/');
}

/**
 * 软链判(真根, 是软链, 解到) → { 行, 因 }
 * 异厂评审 2026-08-31 打穿的那一条：只解父目录不解文件本身。
 * `<根>/docs/release.md` 若是指向 `C:/Users/Public/secret.md` 的**文件**符号链接，
 * 父目录 realpath 仍在根内、statSync 跟随链接返回 isFile()=true —— 四道全过，读写落在根外。
 * 原判据用的是**目录** junction，父目录那道正好能拦住，所以这个洞一直没被照到：
 * **判据挡住了自己的视线。**
 */
function 软链判(真根, 是软链, 解到) {
  if (!是软链) return { 行: true, 因: '不是软链' };
  if (!解到) return { 行: false, 因: '软链解不开' };
  if (!在根内(真根, 解到)) return { 行: false, 因: '这是一条指向根外的软链' };
  return { 行: true, 因: '软链指向根内' };
}

// ── 路径校验 ───────────────────────────────────────────────────────

/**
 * 校路径(根表, 键, 相对路, opts) → { 行, 因, 绝对路?, 根? }
 * 四道：① 根键认识 ② 相对路形状 ③ realpath 落在根内 ④ 存在性
 */
function 校路径(根表, 键, 相对路, opts = {}) {
  const 须存在 = opts.须存在 !== false;

  // ① 根键
  const 根 = 取根(根表, 键);
  if (!根) return { 行: false, 因: `不认识的根：${String(键).slice(0, 40)}` };
  if (!根.路) return { 行: false, 因: `根「${根.名 || 键}」没有配置路径` };

  // ② 形状。**先看字符串本身**，不先落地——落地之后再判就晚了。
  const s = 斜(相对路);
  if (!s) return { 行: false, 因: '路径为空' };
  if (s.length > 400) return { 行: false, 因: '路径过长' };
  if (/^[a-zA-Z]:/.test(s) || s.startsWith('/')) return { 行: false, 因: '不收绝对路径' };
  if (/\u0000/.test(s)) return { 行: false, 因: '路径含空字符' };
  // 逐段判 ..，不是 includes('..')——那样会误杀 `版本..md` 这种正常文件名
  if (s.split('/').some((seg) => seg === '..')) return { 行: false, 因: '路径含上跳段' };
  if (!/\.md$/i.test(s)) return { 行: false, 因: '只收 .md' };
  // Windows 保留字符（: * ? " < > |）在文件名里非法，出现即是构造出来的
  if (/[:*?"<>|]/.test(s)) return { 行: false, 因: '路径含非法字符' };

  // ③ realpath 落在根内。
  //    **取父目录的 realpath 再拼**——新建文件时 realpathSync(文件) 直接 throw，
  //    照抄 校档名() 的写法会让「新建」这条路天然失效（而且是 throw，不是拒绝）。
  const 拼 = path.resolve(根.路, s);
  let 真父; let 真根;
  // **用 realpathSync.native，不是 realpathSync。**
  // 非 native 那版在 Windows 上**不规范化路径各段的大小写**——于是同一份
  // `docs/Guide.md` 能被 `Docs/guide.MD` 之类的写法解析成一堆不同的字符串，
  // 而锁键、草稿目录、版本环全按这个串走：一份文件裂成 2ⁿ 把「独占」锁，
  // 两边都判持有、两边都能存盘、恢复通道也裂成两半。
  // native 走的是操作系统的规范化，拿回来的是盘上真实大小写。
  const 真解 = fs.realpathSync.native || fs.realpathSync;
  try {
    真根 = 真解(根.路);
  } catch (e) {
    return { 行: false, 因: `根不存在或读不到：${根.路}` };
  }
  try {
    真父 = 真解(path.dirname(拼));
  } catch (e) {
    return { 行: false, 因: '上级目录不存在' };
  }
  const 真档 = path.join(真父, path.basename(拼));
  if (!在根内(真根, 真档)) return { 行: false, 因: '解析后落在根之外（软链或上跳）' };

  // ④ 存在性 + **文件自身也要解一次 realpath**
  //
  // 只解父目录是不够的——异厂评审 2026-08-31 打穿的正是这一条：
  // `<根>/docs/release.md` 若本身是指向 `C:/Users/Public/secret.md` 的**文件**符号链接，
  // 父目录 realpath 仍在根内、`statSync()` 跟随链接返回 isFile()=true，于是四道全过，
  // 而读写都落在根外。（我原来的判据用的是**目录** junction，父目录那道正好能拦住，
  // 所以这个洞一直没被照到——**判据挡住了自己的视线**。）
  //
  // 用 lstat 判是不是链接、再 realpath 确认落点，两者都要：
  // lstat 认得出链接，realpath 才说得清它指向哪。
  if (须存在) {
    let ls;
    try { ls = fs.lstatSync(真档); } catch (e) { return { 行: false, 因: '文件不存在' }; }
    if (ls.isSymbolicLink()) {
      let 解 = null;
      try { 解 = fs.realpathSync(真档); } catch (e) { 解 = null; }
      const 判 = 软链判(真根, true, 解);
      if (!判.行) return { 行: false, 因: 判.因 };
    }
    let st;
    try { st = fs.statSync(真档); } catch (e) { return { 行: false, 因: '文件不存在' }; }
    if (!st.isFile()) return { 行: false, 因: '不是普通文件' };
    // 文件存在时再 native 一次，把 basename 的大小写也校准到盘上真名——
    // 上面那次只解到父目录，basename 用的仍是调用方的拼写。
    try {
      const 真名 = 真解(真档);
      if (在根内(真根, 真名)) {
        return { 行: true, 因: '通过', 绝对路: 斜(真名), 根, 相对: 斜(path.relative(真根, 真名)) };
      }
      return { 行: false, 因: '解析后落在根之外（软链或上跳）' };
    } catch (e) { /* 解不动就用下面那条回落 */ }
  } else {
    // 新建路：目标可能还不存在，但**同名的链接可能已经在了**（先埋一条链接再诱使写入）
    let ls = null;
    try { ls = fs.lstatSync(真档); } catch (e) { ls = null; }
    if (ls && ls.isSymbolicLink()) {
      let 解 = null;
      try { 解 = fs.realpathSync(真档); } catch (e) { 解 = null; }
      const 判 = 软链判(真根, true, 解);
      if (!判.行) return { 行: false, 因: 判.因 };
    }
  }

  return { 行: true, 因: '通过', 绝对路: 斜(真档), 根, 相对: 斜(path.relative(真根, 真档)) };
}

/**
 * 可写(根表, 键, 相对路) → { 行, 因 }
 * 只判策略，不判路径合法性——调用方先过 校路径。
 */
function 可写(根表, 键, 相对路) {
  const 根 = 取根(根表, 键);
  if (!根) return { 行: false, 因: '不认识的根' };
  if (根.写 === true) return { 行: true, 因: '可写' };
  if (根.写 === false || 根.写 == null) return { 行: false, 因: `「${根.名 || 键}」是只读的` };

  // 分区：禁写前缀命中即拒
  const s = 归一(相对路);
  for (const 禁 of (根.禁写 || [])) {
    const p = 归一(禁);
    if (s === p || s.startsWith(p + '/')) {
      return {
        行: false,
        // 把理由写全——「为什么不给写」比「不给写」有用得多
        因: `活存储禁写（${禁}）：runner 每拍读写它们，并发写产生的状态错乱 git 也还原不回`,
      };
    }
  }
  return { 行: true, 因: '静态区可写' };
}

// ── 分类 ──────────────────────────────────────────────────────────
//
// **主轴是「这份东西是干什么的」，不是「它在哪个仓」。**
//
// 这条是 2026-08-31 晚制作人指着截图定的：「这种文档堆积不给我分类的情况不要出现」。
// 按仓分组只回答了「它属于哪个项目」，而那个问题他基本不问；
// 他真正要的是「哪些是我要批注的」「哪些是机器拉的屎」。
//
// 实测语料 951 份的形状（这套类别是从它推出来的，不是拍脑袋）：
//   · 工单留痕（回执/归档/完成…）  375 份 = 39%  —— 机器一次性产出，只读，他基本不会打开
//   · 项目文档（Docs/SLG、wiki…）  ~130 份
//   · 规章（协议库/岗位协议/施工令）~90 份
//   · 记忆库                        ~56 份
//   · **在办文稿（方案/评审/验收/设计文档）~40 份 —— 他真正要来回改的就是这些**
// 按仓分组时，那 40 份散在三个仓里，而 39% 的屎排在同一条按时间倒序的流里跟它们抢位置。
//
// 顺序即优先级：越靠前越可能是他此刻要找的。
const 类别表 = [
  {
    键: 'zaiban', 名: '方案与评审', 释: '你我来回改的：方案、评审、验收、设计文档',
    // **按文件名的词匹，不按路径段开头。**首版写的是 `(^|\/)(方案|评审|…)`，
    // 要求关键词落在路径段的开头；而 TK 那边的命名法是 `A1二维位移场-方案.md`、
    // `色带备选方案.md`——词在段中。实测 73 份靶文档里只捞到 33 份，漏了 40 份，
    // 而屏上那句释文写着「你我来回改的：方案、评审」，等于对着一半的东西撒谎。
    //
    // 名字也从「在办文稿」改成「方案与评审」：这条规则认得出的是**文档的体裁**，
    // 认不出「在不在办」——TK 那 33 份技术方案里有不少早就定案了。
    // **一个类别的名字不该承诺它的规则做不到的事。**
    名词: ['方案', '评审', '外审', '验收', '需求定案', '设计文档', '想法', '调研'],
    配: [/设计文档\.md$/i],
  },
  {
    键: 'guizhang', 名: '规章', 释: '协议、岗位、章程、施工令——改它要走决议',
    配: [/(^|\/)(协议库|岗位协议|历史库)\//, /(^|\/)(施工令|工程队)/, /章程|决议/],
  },
  {
    键: 'xiangmu', 名: '项目文档', 释: '游戏与工具自己的文档',
    配: [/(^|\/)Docs?\//i, /(^|\/)docs\//, /(^|\/)packages\//, /(^|\/)apps\//, /技术方案|竞品分析/],
  },
  {
    键: 'banbao', 名: '班报与情报', 释: '按日成串的机器产出：班次报告、日报、白夜馆',
    配: [/(^|\/)(班次|digests|白夜馆|事件流存档)(\/|$)/, /^\d{4}-\d{2}-\d{2}/],
  },
  {
    键: 'gongdan', 名: '工单留痕', 释: '机器一次性产出，只读；占全部的四成',
    配: [/(^|\/)(回执|归档|完成|待派|待处理|待重派|执行失败|待定夺|特性|专项|管线|初检|在途|仲裁|呼叫|废弃|项管台账|草稿)(\/|$)/],
  },
  { 键: 'jiyi', 名: '记忆库', 释: '我在维护的，只读', 配: [/(^|\/)memory(\/|$)/i] },
];

// 文件名切成词。这些文档的命名法是 `<主题>-<体裁>-<日期>.md`，
// 体裁那一截几乎总是独立的一个词。
const 名词们 = (相对) => 斜(相对).split('/').pop().replace(/\.md$/i, '').split(/[-_ .]+/).filter(Boolean);

/**
 * 一个词算不算"讲的就是这个体裁"。
 *
 * 三条，缺一不可：
 *   · 整词相等          `方案`
 *   · 以它结尾          `色带备选方案`、`地理地图管线方案`
 *   · 以它开头且只多两个字  `评审意见`、`评审合集`
 * 第三条的长度限制是必须的：没有它，`施工令-019-评审台红队化` 里那个
 * `评审台红队化` 会被判成评审文档，把施工令从「规章」里偷走。
 * 而 `异厂评审台` 三条都不沾——关键词在词中间，那多半只是名字里提到了它。
 */
const 词命 = (词们, 键词们) => 词们.some((t) => 键词们.some(
  (k) => t === k || t.endsWith(k) || (t.startsWith(k) && t.length <= k.length + 2)));

/** 归类(根键, 相对) → 类别键。**首个命中即停**，所以表序就是优先级。 */
function 归类(根键, 相对) {
  const s = 斜(相对);
  if (根键 === 'memory') return 'jiyi';
  const 词 = 名词们(相对);
  for (const c of 类别表) {
    if ((c.配 || []).some((re) => re.test(s))) return c.键;
    if (c.名词 && 词命(词, c.名词)) return c.键;
  }
  return 'qita';
}

const 类别名 = (键) => (类别表.find((c) => c.键 === 键) || { 名: '其它' }).名;

// 文件名里那截日期是**每一行都重复的噪声**：`方案-文稿台-2026-08-31.md`。
// 抽出来单独放一列，剩下的名字才认得出彼此的差别。
function 拆名(相对) {
  const 全名 = 斜(相对).split('/').pop().replace(/\.md$/i, '');
  const m = 全名.match(/^(.*?)[-_ ]?(\d{4}-\d{2}-\d{2})(?:[-_ ](\d{6}))?$/);
  const 目 = 斜(相对).split('/').slice(0, -1).join('/');
  if (m && m[1]) return { 名: m[1], 日: m[2], 目 };
  if (m && !m[1]) return { 名: m[2], 日: '', 目 };      // 整个文件名就是一个日期
  return { 名: 全名, 日: '', 目 };
}

// ── 列举 ──────────────────────────────────────────────────────────

/**
 * 列举(根表, opts) → [{ 根, 根名, 相对, 名, 字节, 改于, 可写 }]
 * 目录级剪枝；单根条数有上限，防某个仓炸掉整页。
 */
function 列举(根表, opts = {}) {
  const 剪 = new Set((opts.剪枝 || 默认剪枝).map((x) => String(x).toLowerCase()));
  const 单根上限 = opts.单根上限 || 800;
  // 按**绝对路径**排除的目录。剪枝表是按目录名剪的，这里剪的是特定的那一个——
  // 文稿台自己的工作目录（草稿 / 版本环 / 锁）就落在某个根里面，
  // 不排掉的话它会**把自己的版本历史当成文档列出来**：
  // 存一次盘多一条 `1788171558379-制作人.md`，五十版之后文件库里全是它自己的影子。
  const 排 = (opts.排除目录 || []).map((p) => 归一(p)).filter(Boolean);
  const 出 = [];

  for (const 根 of (Array.isArray(根表) ? 根表 : [])) {
    if (!根 || !根.路) continue;
    let 真根;
    try { 真根 = fs.realpathSync(根.路); } catch (e) { continue; }   // 根不在就跳过，不是错
    let 计 = 0;
    const 走 = (目录) => {
      if (计 >= 单根上限) return;
      let 项;
      try { 项 = fs.readdirSync(目录, { withFileTypes: true }); } catch (e) { return; }
      for (const it of 项) {
        if (计 >= 单根上限) return;
        const 全 = path.join(目录, it.name);
        if (it.isDirectory()) {
          if (剪.has(it.name.toLowerCase())) continue;
          if (it.name.startsWith('.')) continue;
          const g = 归一(全);
          if (排.some((p) => g === p || g.startsWith(p + '/'))) continue;
          走(全);
        } else if (it.isFile() && /\.md$/i.test(it.name)) {
          let st;
          try { st = fs.statSync(全); } catch (e) { continue; }
          const 相对 = 斜(path.relative(真根, 全));
          const 拆 = 拆名(相对);
          出.push({
            根: 根.键,
            根名: 根.名 || 根.键,
            相对,
            名: it.name,
            短名: 拆.名,          // 剥掉日期后缀的名字——日期单独一列，不在每行重复
            日: 拆.日,
            目: 拆.目,
            类: 归类(根.键, 相对),
            字节: st.size,
            改于: st.mtimeMs,
            可写: 可写(根表, 根.键, 相对).行,
          });
          计++;
        }
      }
    };
    走(真根);
  }
  return 出;
}

// ── 记号扫描 ───────────────────────────────────────────────────────

const 记号们 = ['改', '加', '删', '问'];
const 记号正 = /【(改|加|删|问)】/g;

/**
 * 扫记号(文) → [{ 记号, 行号, 行文 }]
 *
 * **反引号里的不算。**这条不是洁癖：设计文档第一页有一张说明表，
 * 四行写着 `【改】` `【加】` `【删】` `【问】` 各是什么意思——那是**在谈论记号**，不是记号。
 * 2026-08-31 的评审就是拿那张表数出「6 个记号」，据此论证了一整套界面，
 * 而正文里当时**一个记号都没有**。分不清「用记号」和「说记号」，
 * 记号栏就会把说明书本身标成一堆待办。
 * 围栏（```）里的同理。
 */
function 扫记号(文) {
  const 行 = String(文 == null ? '' : 文).split(/\r?\n/);
  const 出 = [];
  let 在围栏 = false;
  for (let i = 0; i < 行.length; i++) {
    const l = 行[i];
    if (/^\s{0,3}(```|~~~)/.test(l)) { 在围栏 = !在围栏; continue; }
    if (在围栏) continue;
    // 先把行内代码段挖空（长度不变，位置不移），再扫记号
    const 净 = l.replace(/`[^`]*`/g, (m) => ' '.repeat(m.length));
    净.replace(记号正, (m, k, 位) => {
      出.push({ 记号: k, 行号: i + 1, 列: 位 + 1, 行文: l.trim().slice(0, 160) });
      return m;
    });
  }
  return 出;
}

const 记号计 = (条们) => {
  const c = { 改: 0, 加: 0, 删: 0, 问: 0 };
  for (const x of (条们 || [])) if (c[x.记号] != null) c[x.记号]++;
  return c;
};

/**
 * 记号统计(列表, 根路, 缓) —— 就地给每条填上 记（四种记号各几个）。
 *
 * **这是文稿台最该有的那个筛选：「哪些文档在等我」。**
 * 记号系统本来就是为这件事设的，可如果不能一眼筛出「有记号的」，
 * 那它就只在你已经打开那一份的时候才有用——等于没解决「找得到」这一半。
 *
 * 代价是要读盘。所以两条省法：
 *   ① **只扫可写的**（453/951）——只读的那些他不会去标记号
 *   ② 按 mtime 缓存——没动过的文件不重读。整轮扫完约几 MB，之后基本零开销。
 */
function 记号统计(列表, 根路, 缓 = new Map()) {
  for (const it of (列表 || [])) {
    // **全扫，不只扫可写的。**首版只扫可写（理由是「只读的他不会去标记号」）——
    // 而异厂评审 2026-08-31 打的正是这一条：一份文档可以**先被标了记号、后来才变成只读**
    // （发布流程改 ACL、或者它被挪进了活存储区）。那时它的记号还在文件里，
    // 却从「有记号」的结果里凭空消失，而屏上那句「1 份有记号」是对全部 951 份说的。
    // **一个只对其中一半成立的计数，比没有这个计数坏。**
    // 代价是扫 951 而不是 453——实测从 46ms 涨到约 100ms，一次而已，之后走 mtime 缓存。
    const 根 = 根路[it.根];
    if (!根) { it.记 = null; continue; }
    const 全 = path.join(根, it.相对);
    const 旧 = 缓.get(全);
    if (旧 && 旧.改于 === it.改于) { it.记 = 旧.记; continue; }
    let 文;
    try { 文 = fs.readFileSync(全, 'utf8'); } catch (e) { it.记 = null; continue; }
    const 计 = 记号计(扫记号(文));
    it.记 = 计;
    缓.set(全, { 改于: it.改于, 记: 计 });
  }
  // 缓存有上界：这块屏整天开着，无上界的 Map 就是一处慢性泄漏
  if (缓.size > 2000) {
    const 留 = [...缓.entries()].slice(-1200);
    缓.clear();
    for (const [k, v] of 留) 缓.set(k, v);
  }
  return 缓;
}

const 有记号 = (it) => !!(it && it.记 && (it.记.改 + it.记.加 + it.记.删 + it.记.问) > 0);

// ── 搜索 ──────────────────────────────────────────────────────────

/**
 * 搜(列表, 词, opts) → 命中的条目（带 命中处）
 * 文件名先筛（便宜），正文后筛（要读盘，所以有条数上限）。
 */
function 搜(列表, 词, opts = {}) {
  const q = String(词 || '').trim().toLowerCase();
  if (!q) return (列表 || []).map((x) => ({ ...x, 命中: '' }));
  const 读上限 = opts.读上限 || 400;
  const 根路 = opts.根路 || {};
  const 出 = [];
  let 读了 = 0;

  for (const it of (列表 || [])) {
    const 名中 = (it.相对 || '').toLowerCase().includes(q);
    if (名中) { 出.push({ ...it, 命中: '文件名' }); continue; }
    if (q.length < 2 || 读了 >= 读上限) continue;
    const 根 = 根路[it.根];
    if (!根) continue;
    let 文;
    try { 文 = fs.readFileSync(path.join(根, it.相对), 'utf8'); } catch (e) { continue; }
    读了++;
    const 低 = 文.toLowerCase();
    const 位 = 低.indexOf(q);
    if (位 < 0) continue;
    const 前 = Math.max(0, 位 - 30);
    出.push({ ...it, 命中: 文.slice(前, 位 + q.length + 50).replace(/\s+/g, ' ').trim() });
  }
  return 出;
}

// ── 读盘（读侧唯一入口）─────────────────────────────────────────────

/**
 * 读(绝对路) → { 行, 文, 字节, 换行, 有BOM, 因? }
 * 记下换行风格与 BOM——**写回时要照原样还原**。
 * 不还原的后果：一次保存把 547 行全变成改动行，「这轮标了哪几处」这条信息被淹掉。
 */
function 读(绝对路) {
  let 原;
  try { 原 = fs.readFileSync(绝对路); } catch (e) { return { 行: false, 因: '读不到：' + (e && e.code) }; }
  let s = 原.toString('utf8');
  const 有BOM = s.charCodeAt(0) === 0xFEFF;
  if (有BOM) s = s.slice(1);
  const crlf = (s.match(/\r\n/g) || []).length;
  const lf = (s.match(/\n/g) || []).length;
  return {
    行: true,
    文: s.replace(/\r\n/g, '\n'),
    字节: 原.length,
    换行: crlf > 0 && crlf === lf ? 'crlf' : 'lf',
    有BOM,
  };
}

module.exports = {
  默认根表, 默认剪枝, 记号们,
  取根, 校路径, 可写, 列举, 扫记号, 记号计, 搜, 读, 在根内, 软链判,
  类别表, 归类, 类别名, 拆名, 记号统计, 有记号,
  斜, 归一,
};
