// 文锁.js — 文稿台的文件锁 / 草稿 / 版本环（批三）
//
// ── 为什么锁要落盘，不能只在内存里 ──────────────────────────────
// 这把锁要挡住的写手有三个，**其中两个不在终端进程里**：
//   ① 制作人在文稿台里编辑          —— 在终端进程内
//   ② 坐席在 /api/say 里 Edit/Write —— 另一个进程（claude CLI 子进程）
//   ③ 无人值守班次 02:00 改文件      —— 同上
// 内存里的锁，②③ 看不见。所以锁状态必须写在盘上，让别的进程能读。
//
// ── 为什么是租约，不是开关 ──────────────────────────────────────
// 「点编辑上锁、改完自己解锁」这个说法里，**「自己解锁」那一步一定会有人做不到**：
// 终端被互保环重启、换装杀进程、浏览器崩了。锁留在盘上，没有持有者，谁也解不开——
// 而这块屏是开机自启的，它会自己回来，带着一把死锁。
// 所以：页面每 15 秒续租一次，**停止续租 45 秒即失效**。失效方向朝松，不朝死。
//
// ── 为什么还要第二个超时 ────────────────────────────────────────
// 只有租约还不够：制作人点了编辑然后去睡了，浏览器开着、页面在续租，
// 锁**永远不过期**。在系统看来「正在编辑」和「人走了」一模一样。
// 所以再加**闲置超时**：30 分钟没有按键 → 降级为「可抢占」（不是直接解锁，
// 而是别人来要就给，并留一条记录）。
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const 租约毫秒 = 45 * 1000;          // 停止续租多久算失效（页面每 15 秒续一次，三次容错）
const 闲置毫秒 = 30 * 60 * 1000;     // 多久没按键算「人走了」
const 版本上限 = 50;                 // 版本环留几版（欠账表第 10 条已有一处无界增长，不再添）

const 令牌 = () => crypto.randomBytes(16).toString('hex');
// 锁键。**折叠大小写**——Windows 上 README.md 与 readme.md 是同一个文件，
// 而首版的键不折叠，于是同一份文档能造出多把「独占」锁：两边都判持有、
// 两边 可写() 都为真、两边 save 都过闸、lockstate 互相看不见、版本环裂成两个目录。
// （复核实测：realpathSync 非 .native 时整条路径每一段都不规范化大小写，
//   n 段路径就是 2ⁿ 个键。主修在 文稿.js 的 realpathSync.native，这里是腰带。）
// 归一()/外部可写() 本来就是这个口径，这里对齐。
const 键 = (根键, 相对) => `${根键}/${String(相对).replace(/\\/g, '/')}`.toLowerCase();
// 版本目录名：可读前缀 + 哈希。纯哈希查不出是哪份文件，纯路径又会撞非法字符与长度限。
const 档名 = (k) => String(k).replace(/[^\w.-]+/g, '_').slice(-40)
  + '-' + crypto.createHash('sha1').update(k).digest('hex').slice(0, 10);

// ── 纯函数：状态判定 ───────────────────────────────────────────────

/**
 * 判态(条, 现在) → { 态, 剩余毫秒, 闲置毫秒 }
 * 态：无 / 持有 / 可抢 / 过期
 *   持有 —— 正常握着
 *   可抢 —— 还在续租，但很久没按键了（人多半走了）：别人来要就给
 *   过期 —— 停止续租超过租约：等于没锁
 */
function 判态(条, 现在 = Date.now()) {
  if (!条 || !条.令牌) return { 态: '无', 剩余毫秒: 0, 闲置毫秒: 0 };
  const 续 = Number(条.末续 || 条.起于 || 0);
  const 键时 = Number(条.末键 || 条.起于 || 0);
  const 剩 = 租约毫秒 - (现在 - 续);
  if (剩 <= 0) return { 态: '过期', 剩余毫秒: 0, 闲置毫秒: 现在 - 键时 };
  if (现在 - 键时 >= 闲置毫秒) return { 态: '可抢', 剩余毫秒: 剩, 闲置毫秒: 现在 - 键时 };
  return { 态: '持有', 剩余毫秒: 剩, 闲置毫秒: 现在 - 键时 };
}

/** 能不能写：给写口用。令牌对不上就是不行，哪怕锁已经可抢——可抢是给**别人**的，不是给持有者放宽。 */
function 可写(条, 令, 现在 = Date.now()) {
  const t = 判态(条, 现在);
  if (t.态 === '无' || t.态 === '过期') return { 行: false, 因: '没有有效的锁，先取锁再写', 态: t.态 };
  if (!令 || 令 !== 条.令牌) return { 行: false, 因: `文件被 ${条.持有者 || '别人'} 锁着`, 态: t.态 };
  return { 行: true, 因: '持有锁', 态: t.态 };
}

/** 能不能取：无锁 / 过期 / 可抢 都能取；正被人握着不能抢。 */
function 可取(条, 现在 = Date.now()) {
  const t = 判态(条, 现在);
  if (t.态 === '持有') {
    return {
      行: false,
      因: `${条.持有者 || '别人'} 正在编辑（${Math.round(t.剩余毫秒 / 1000)} 秒内仍有效）`,
      态: t.态,
    };
  }
  return { 行: true, 因: t.态 === '可抢' ? '原持有者已闲置 30 分钟以上，接管' : '空闲', 态: t.态 };
}

// ── 盘上状态 ──────────────────────────────────────────────────────

function 读表(档) {
  try {
    const j = JSON.parse(fs.readFileSync(档, 'utf8'));
    return (j && typeof j.锁 === 'object' && j.锁) ? j : { 锁: {}, 请求: {} };
  } catch (e) {
    // 文件不在、或被人手改坏了：当成空表。**不抛**——一个坏掉的锁文件
    // 不该让整个文稿台打不开，更不该让编辑按钮永远点不动。
    return { 锁: {}, 请求: {} };
  }
}

// 原子写：先写 tmp 再 rename。直接 writeFileSync 在写到一半被杀，
// 留下的是半个文件——而**半个 markdown 看起来仍然像一份 markdown**，
// 半个 JSON 则被下游 catch 掉当成「没有」，两种都不报错。
// 换装杀进程、互保环重启、掉电，在这块屏上都是固定动作不是异常。
function 原子写(档, 内容) {
  fs.mkdirSync(path.dirname(档), { recursive: true });
  const 临 = `${档}.tmp${process.pid}`;
  fs.writeFileSync(临, String(内容), 'utf8');
  fs.renameSync(临, 档);
}

function 写表(档, 表) {
  原子写(档, JSON.stringify(表, null, 2));
}

// 读草稿元信息。坏了就当没有——但**调用方要区分「没有」和「坏了」**，
// 所以 取草 会另外给一个 损 标记出来。
function 读元(底) {
  try {
    const o = JSON.parse(fs.readFileSync(底 + '.json', 'utf8'));
    return (o && typeof o === 'object') ? o : null;
  } catch (e) { return null; }
}

// ── 台：把盘上状态包起来的一组动作 ─────────────────────────────────

function 开台(根目录) {
  const 锁档 = path.join(根目录, '锁.json');
  const 草目 = path.join(根目录, '草');
  const 版目 = path.join(根目录, '版本');

  const 取条 = (k) => 读表(锁档).锁[k] || null;

  return {
    锁档,
    草目,
    版目,

    况(根键, 相对, 现在 = Date.now()) {
      const k = 键(根键, 相对);
      const 表 = 读表(锁档);
      const 条 = 表.锁[k] || null;
      const t = 判态(条, 现在);
      return {
        键: k,
        态: t.态,
        持有者: 条 ? 条.持有者 : null,
        起于: 条 ? 条.起于 : null,
        剩余秒: Math.max(0, Math.round(t.剩余毫秒 / 1000)),
        闲置秒: Math.round(t.闲置毫秒 / 1000),
        请求: (表.请求 && 表.请求[k]) || null,
      };
    },

    取(根键, 相对, 持有者, 现在 = Date.now()) {
      const k = 键(根键, 相对);
      const 表 = 读表(锁档);
      const 判 = 可取(表.锁[k], 现在);
      if (!判.行) return { 行: false, 因: 判.因, 态: 判.态 };
      const 令 = 令牌();
      表.锁[k] = { 令牌: 令, 持有者: String(持有者 || '制作人'), 起于: 现在, 末续: 现在, 末键: 现在 };
      // 取到锁就把这份文件的解锁请求清掉——它已经易手了，旧请求没有意义
      if (表.请求) delete 表.请求[k];
      写表(锁档, 表);
      return { 行: true, 令牌: 令, 因: 判.因, 键: k };
    },

    // 续租。有按键就把 末键 也推一下——「还在续租」与「人还在」是两件事。
    续(根键, 相对, 令, 现在 = Date.now(), 有按键 = false) {
      const k = 键(根键, 相对);
      const 表 = 读表(锁档);
      const 条 = 表.锁[k];
      if (!条 || 条.令牌 !== 令) return { 行: false, 因: '锁不在你手上（可能已过期或被接管）' };
      条.末续 = 现在;
      if (有按键) 条.末键 = 现在;
      写表(锁档, 表);
      const t = 判态(条, 现在);
      return { 行: true, 态: t.态, 剩余秒: Math.round(t.剩余毫秒 / 1000), 请求: (表.请求 || {})[k] || null };
    },

    放(根键, 相对, 令) {
      const k = 键(根键, 相对);
      const 表 = 读表(锁档);
      const 条 = 表.锁[k];
      if (!条) return { 行: true, 因: '本来就没锁' };
      if (条.令牌 !== 令) return { 行: false, 因: '锁不在你手上' };
      delete 表.锁[k];
      if (表.请求) delete 表.请求[k];
      写表(锁档, 表);
      return { 行: true, 因: '已解锁' };
    },

    // 别人（坐席/班次）想改被锁的文件：不干等，记一条请求。
    // 制作人在人闸队列与文件库角标上看得见。
    请求解锁(根键, 相对, 谁, 为何, 现在 = Date.now()) {
      const k = 键(根键, 相对);
      const 表 = 读表(锁档);
      if (!表.请求) 表.请求 = {};
      const 旧 = 表.请求[k];
      表.请求[k] = {
        谁: String(谁 || '总监'),
        为何: String(为何 || '').slice(0, 300),
        起于: 旧 ? 旧.起于 : 现在,      // 等了多久要能看出来，所以起点不刷新
        次数: (旧 ? 旧.次数 : 0) + 1,
      };
      写表(锁档, 表);
      return { 行: true, 请求: 表.请求[k] };
    },

    // 供外部进程（PreToolUse hook / 坐席）查：这份文件此刻能不能写
    外部可写(绝对路, 根表, 现在 = Date.now()) {
      const 表 = 读表(锁档);
      const 目 = String(绝对路).replace(/\\/g, '/').toLowerCase();
      for (const [k, 条] of Object.entries(表.锁 || {})) {
        const i = k.indexOf('/');
        if (i < 0) continue;
        const 根 = (根表 || []).find((r) => r.键 === k.slice(0, i));
        if (!根 || !根.路) continue;
        const 全 = (String(根.路).replace(/\\/g, '/') + '/' + k.slice(i + 1)).toLowerCase();
        if (全 !== 目) continue;
        const t = 判态(条, 现在);
        if (t.态 === '持有' || t.态 === '可抢') {
          return { 行: false, 因: `${条.持有者 || '制作人'} 正在文稿台里编辑这份文件`, 键: k, 态: t.态 };
        }
      }
      return { 行: true, 因: '没有人锁着' };
    },

    // ── 草稿 ──
    // **落服务端，不落 localStorage。**理由：4280 被占时 start() 会顺延到 4281，
    // origin 一变 localStorage 就找不着了——而那正是「进程刚被杀过、最需要草稿」的场景。
    存草(根键, 相对, 文, 基文, 基指纹) {
      const k = 键(根键, 相对);
      fs.mkdirSync(草目, { recursive: true });
      const 底 = path.join(草目, 档名(k));
      const 稿 = String(文);
      // **三个文件全部原子写。**首版是裸 writeFileSync——而这是**唯一指定的兜底件**，
      // 唯一指定的场景又是「换装/崩溃」（那是这块屏的固定动作，不是异常）。
      // 实测：进程死在写 .draft.md 中途，盘上留一份被截到 9406/130902 字节的稿，
      // 而 .json 还是上一轮那份（能解析）——于是重开时服务端答「有草稿、同源」，
      // 界面照常弹「要接着改吗」，点是再存盘，**半截文档被当成完整的写进真文件**。
      // 更狠的一档停在 0 字节（'w' 先 O_TRUNC），文案照旧。
      原子写(底 + '.draft.md', 稿);
      // base 只在**基准换了**的时候重写。
      // 首版条件是「文件不存在才写」，于是 base 从第一次 lock 起就永不更新，
      // 而同一函数里 基指纹 是无条件覆盖的——两者一叠，
      // 服务端 base 会停在两代之前，冲突面板却照标 能三路=true。
      // 最阴的是它**精准绕开了系统为它准备的提示牌**：
      // 前端那条「取不到 base，保留我的是盲覆盖」的警告正好被 能三路=true 抑制掉。
      const 旧元 = 读元(底);
      if (基文 != null && (!fs.existsSync(底 + '.base.md') || !旧元 || 旧元.基指纹 !== 基指纹)) {
        原子写(底 + '.base.md', String(基文));
      }
      // **.json 是提交点，最后写**：它里面记着草稿的字节数与指纹，
      // 取草 拿它校验——对不上就当作没有草稿，而不是当作一份好草稿。
      原子写(底 + '.json', JSON.stringify({
        键: k, 基指纹, 时: Date.now(),
        草字节: Buffer.byteLength(稿, 'utf8'),
        草纹: 指纹(稿),
      }, null, 2));
      return { 行: true };
    },

    取草(根键, 相对) {
      const 底 = path.join(草目, 档名(键(根键, 相对)));
      const 元 = 读元(底);
      if (!元) return { 有: false };
      let 稿 = null;
      let 损 = false;
      if (fs.existsSync(底 + '.draft.md')) {
        try { 稿 = fs.readFileSync(底 + '.draft.md', 'utf8'); } catch (e) { 稿 = null; 损 = true; }
        // **校验，不是读到就信。**半个 markdown 看起来仍然像一份 markdown——
        // 这句话是 落盘() 的注释自己写的，草稿这边同样成立。
        if (稿 != null && 元.草纹 && 指纹(稿) !== 元.草纹) { 稿 = null; 损 = true; }
      }
      let 基 = null;
      if (fs.existsSync(底 + '.base.md')) {
        try { 基 = fs.readFileSync(底 + '.base.md', 'utf8'); } catch (e) { 基 = null; }
      }
      return { 有: true, 文: 稿, 基文: 基, 基指纹: 元.基指纹, 时: 元.时, 损 };
    },

    // 存盘成功后调它，**不要调 清草**。
    // 清草会把 base 一起删掉，于是下一次冲突就没有比较基准——
    // 「保留我的」当场退化成盲覆盖，而界面上看不出这个区别。
    // （实测踩到：第一次存盘后再冲突，三路差异是空的。）
    // 存盘之后「打开时那一版」的正确取值就是**刚存进去的这一版**。
    重置基(根键, 相对, 文, 基指纹) {
      const k = 键(根键, 相对);
      fs.mkdirSync(草目, { recursive: true });
      const 底 = path.join(草目, 档名(k));
      // **不 unlink，改名成孤儿。**
      // 首版这里是 unlinkSync。反向失败路径：进程死在写 .json 中途 → 元信息坏了
      // → 下一次取锁走到这里 → 把那份**完整的** 13 万字节草稿静默删掉。
      // 元信息坏了说明「不知道这份草稿是什么状态」，那更该留着它，不是更该删。
      if (fs.existsSync(底 + '.draft.md')) {
        try {
          fs.renameSync(底 + '.draft.md', `${底}.orphan-${Date.now()}.md`);
        } catch (e) {
          try { fs.unlinkSync(底 + '.draft.md'); } catch (e2) { /* 改不了名也删不掉就留着 */ }
        }
      }
      原子写(底 + '.base.md', String(文));
      原子写(底 + '.json', JSON.stringify({ 键: k, 基指纹, 时: Date.now(), 仅基: true }, null, 2));
      return { 行: true };
    },

    清草(根键, 相对) {
      const 底 = path.join(草目, 档名(键(根键, 相对)));
      for (const 后 of ['.draft.md', '.base.md', '.json']) {
        try { fs.unlinkSync(底 + 后); } catch (e) { /* 不在就算了 */ }
      }
    },

    // ── 版本环 ──
    // **任何一次写入都产生一版，带「谁写的」。**只记制作人的编辑不行：
    // 那样历史里我的改动是隐形的，而**假历史比没历史坏**。
    存版(根键, 相对, 文, 谁, 现在 = Date.now()) {
      const k = 键(根键, 相对);
      const 目 = path.join(版目, 档名(k));
      fs.mkdirSync(目, { recursive: true });
      const 原谁 = String(谁 || '未知');
      // 文件名必须净化（Windows 不收 : * ? " < > |），所以 `班次:晨报` 会变成 `班次_晨报`。
      // **所以「谁写的」不能从文件名回读**——净化是有损的，且两个不同的 谁
      // （`班次:晨报` 与 `班次_晨报`）净化后会撞成同一个。
      // 班次系统踩过同一条：`今日跑过` 原先按文件名判，改班次名就重复跑了一次 20k。
      // 结论一样：**读索引，不读文件名。**
      const 名 = `${现在}-${原谁.replace(/[^\w一-龥]+/g, '_')}.md`;
      fs.writeFileSync(path.join(目, 名), String(文), 'utf8');
      try {
        fs.appendFileSync(path.join(目, '索引.jsonl'),
          JSON.stringify({ 时: 现在, 谁: 原谁, 档: 名 }) + '\n', 'utf8');
      } catch (e) { /* 索引写不下不该让这一版丢掉；历版 会回落到文件名 */ }

      // 修剪。**有上界**——欠账表第 10 条已经有一处无界增长了，不再添第二处。
      let 们 = [];
      try { 们 = fs.readdirSync(目).filter((f) => f.endsWith('.md')).sort(); } catch (e) { /* 读不到就不修剪 */ }
      const 删掉 = 们.slice(0, Math.max(0, 们.length - 版本上限));
      for (const f of 删掉) {
        try { fs.unlinkSync(path.join(目, f)); } catch (e) { /* 删不掉不影响写入 */ }
      }
      // 索引也跟着修剪，不然它会无界增长——修的是一处，漏的是另一处，等于没修
      if (删掉.length) {
        try {
          const 弃 = new Set(删掉);
          const 留 = fs.readFileSync(path.join(目, '索引.jsonl'), 'utf8').split('\n')
            .filter((l) => l.trim())
            .filter((l) => { try { return !弃.has(JSON.parse(l).档); } catch (e) { return false; } });
          fs.writeFileSync(path.join(目, '索引.jsonl'), 留.join('\n') + (留.length ? '\n' : ''), 'utf8');
        } catch (e) { /* 修不动就留着，不影响正确性 */ }
      }
      return { 行: true, 版: 名, 谁: 原谁, 留存: Math.min(们.length, 版本上限) };
    },

    历版(根键, 相对) {
      const 目 = path.join(版目, 档名(键(根键, 相对)));
      let 们 = [];
      try { 们 = new Set(fs.readdirSync(目).filter((f) => f.endsWith('.md'))); } catch (e) { return []; }
      // 先读索引（谁写的以它为准），再拿实际存在的文件对一遍——
      // 索引里有、盘上没有的（被修剪掉了）不列；盘上有、索引里没有的回落到文件名。
      const 由索引 = new Map();
      try {
        for (const l of fs.readFileSync(path.join(目, '索引.jsonl'), 'utf8').split('\n')) {
          if (!l.trim()) continue;
          try { const o = JSON.parse(l); if (o && o.档) 由索引.set(o.档, o); } catch (e) { /* 坏行跳过 */ }
        }
      } catch (e) { /* 没索引就全走回落 */ }

      return [...们].map((f) => {
        const o = 由索引.get(f);
        if (o) return { 档: f, 时: Number(o.时) || 0, 谁: String(o.谁 || '未知') };
        const m = f.match(/^(\d+)-(.+)\.md$/);
        return { 档: f, 时: m ? Number(m[1]) : 0, 谁: m ? m[2] : '未知', 无索引: true };
      }).sort((a, b) => b.时 - a.时);
    },

    读版(根键, 相对, 档) {
      // 档名来自前端，必须校形状——这是又一个「松一点就是任意文件读取」的口
      if (!/^\d+-[^\\/:*?"<>|]{1,60}\.md$/.test(String(档 || ''))) return { 行: false, 因: '版本名形状不对' };
      const 目 = path.join(版目, 档名(键(根键, 相对)));
      const 全 = path.join(目, 档);
      if (path.dirname(全) !== 目) return { 行: false, 因: '版本落在目录之外' };
      try { return { 行: true, 文: fs.readFileSync(全, 'utf8') }; } catch (e) { return { 行: false, 因: '读不到这一版' }; }
    },

    // 调试/判据用：直接看盘上表
    表() { return 读表(锁档); },
    条(根键, 相对) { return 取条(键(根键, 相对)); },
  };
}

const 指纹 = (文) => crypto.createHash('sha256').update(String(文), 'utf8').digest('hex').slice(0, 16);

/**
 * 告示(表, 现在) → 给坐席的占用前缀（没人锁着就回空串）
 *
 * **这一条是评审击杀逼出来的。**原方案只把告示接进了班次，而击杀的时刻表是：
 *   21:26 制作人点「转交」→ 坐席读档、答问，**顺手把那行【问】替换成「（已答：…）」并落盘**。
 *   这不是越权：文档第一页那张记号表就是给它的契约。
 * 所以人对话那条路（/api/say）也必须带告示。
 *
 * ── 这里只有约定，没有机器闸 ──────────────────────────────────
 * 首版这段文案的最后一行写的是「（硬拦在 server 侧，写了也会被拒。）」——**那是假的**。
 * 2026-08-31 验收复核 grep 出来：外部可写() 与 请求解锁() 在生产代码里**零调用点**，
 * 只有定义、两句声称它是硬闸的注释、和两个直接调它的判据。
 * 三处 hook 配置（~/.claude/settings.json、settings.local.json、Ticketflow 那份）
 * 都没有任何 PreToolUse；而坐席拿的是 Edit/Write/NotebookEdit + acceptEdits，
 * 那条路一个字节都不经过 4280。
 *
 * **判据全绿，因为判据自己直接调那个函数。**这正是 H104 要防的那种假判据。
 *
 * 所以现在这段话说的是实情：这是一条约定，不是一道闸。要变成闸，
 * 得把 外部可写() 接到 PreToolUse 上——那要改制作人的 settings.json，是人闸事项。
 */
function 告示(表, 现在 = Date.now()) {
  const 条们 = Object.entries((表 && 表.锁) || {})
    .filter(([, c]) => 判态(c, 现在).态 !== '过期')
    .map(([k, c]) => `  · ${k}（${(c && c.持有者) || '制作人'} 正在编辑）`);
  if (!条们.length) return '';
  return '【文稿台占用中】以下文件此刻正被人在终端里编辑，**你可以读，但不要写**；'
    + '要改就在回话里说改哪几行，由制作人落笔：\n' + 条们.join('\n')
    + '\n（这是约定，**不是机器闸**：你写了不会被拒，但会覆盖制作人正在改的东西，'
    + '而他那边未必立刻看得出来。）\n\n';
}

module.exports = {
  开台, 判态, 可写, 可取, 指纹, 告示, 键, 档名,
  租约毫秒, 闲置毫秒, 版本上限,
};
