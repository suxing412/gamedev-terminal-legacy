// 闸分组.js — 左栏「等你拍板」怎么分堆。
//
// 单独一个文件，是为了它能被判据 require。前端里它是 self.闸分组，
// 测试里它是 module.exports——同一份代码，不是"照着又写了一遍"。
// （事件折叠那条判据当初就是两处各写一份，结果两边口径分了家。）
//
// 为什么要分堆：2026-08-31 实测，这一栏摊着 61 个按钮（36 单 + 25 机制）。
//   ① 36 单里 36 单都逾期（阈 24h，中位 129h、最久 311h）。原三档染色
//      （≥阈 / ≥3阈）把 36 单全塞进最深那档——**全红等于没红**。
//   ② 同一闸位的 24 单动作键完全相同（G3 全是"验收：通过归档／打回"）。
//      摊成 24 条，是把一次批量处置误报成了 24 个待决定。
// 所以：单据按闸位分，机制按型分，组头讲这一组的动作和形状。

(function (根) {
  'use strict';

  // 四档。第四档（≥7×阈）不是为了好看：没有它，5 天的那一堆和 13 天的那一条
  // 会落在同一档里，而后者正是这一栏唯一真正的离群值。
  function 久档(h, 阈) {
    const x = Number(h) || 0; const t = Number(阈) || 24;
    return x >= t * 7 ? 3 : x >= t * 3 ? 2 : x >= t ? 1 : 0;
  }

  // 一组条目的停摆形状。齐=全组同一档且已过 3×阈——这时底色不再区分任何东西，
  // 由调用方把底色收掉，改在组头说一次。
  function 组形(单们, 阈) {
    const h = (单们 || []).map((d) => Number(d.停摆小时) || 0).sort((a, b) => a - b);
    const t = Number(阈) || 24;
    const 档 = new Set(h.map((x) => 久档(x, t)));
    return {
      最久: h.length ? h[h.length - 1] : 0,
      中位: h.length ? h[h.length >> 1] : 0,
      逾期: h.filter((x) => x >= t).length,
      总: h.length,
      齐: h.length > 1 && 档.size === 1 && [...档][0] >= 2,
    };
  }

  // 分堆。i 是条目在**扁平 闸表**里的下标——带单、数字键都按这个下标取，
  // 所以分堆不能重排它，只能重新摆放。
  function 分闸组(单, 机, 阈, 筛) {
    const 单们 = 单 || []; const 机们 = 机 || [];
    const t = Number(阈) || 24;
    const 出 = [];

    if (筛 !== '机') {
      const 闸位 = new Map();
      单们.forEach((d, i) => {
        const k = d.闸号 || '其它';
        // 两个都留着，因为两处要的长短不一样，而**它们必须出自同一次分堆**：
        //   动  ＝ 指引「通过归档／打回」——栏里的组注要说清"这一组要你做什么"
        //   动键 ＝ 动作键「验收」——顶条那 232px 的轨只装得下短的
        // 顶条曾经取了 动（长串），实测写出「24通过归档／打回 · 1接受／给方向／打回 …」，
        // 当场溢出并把年龄章挤出可视区。分开两个字段，比在调用处各自 slice 安全。
        if (!闸位.has(k)) 闸位.set(k, { 号: k, 名: d.闸名 || '', 动: d.指引 || d.动作键 || '', 动键: d.动作键 || '', 项: [] });
        闸位.get(k).项.push({ d, i });
      });
      // 大组在前：批量能一次清掉最多东西的那一堆，值得先看见。
      // 同样大的按闸号排，免得每轮轮询顺序自己在变。
      const 排 = [...闸位.values()].sort((x, y) => (y.项.length - x.项.length) || String(x.号).localeCompare(String(y.号)));
      for (const z of 排) {
        const s = 组形(z.项.map((p) => p.d), t);
        out(出, {
          类: '单', 键: '单.' + z.号, 名: (z.号 + ' ' + z.名).trim(), 动: z.动, 动键: z.动键,
          项: z.项, 形: s, 齐: s.齐,
        });
      }
    }

    if (筛 !== '单') {
      const 型表 = new Map();
      机们.forEach((d, i) => {
        const k = d.型名 || '待归类';
        if (!型表.has(k)) 型表.set(k, []);
        型表.get(k).push({ d, i: 单们.length + i });
      });
      for (const [型名, 项] of 型表) {
        // 组内按节聚拢：同一节的挨在一起，一次能顺着一个话题想完。
        项.sort((x, y) => String(x.d.节 || '').localeCompare(String(y.d.节 || ''), 'zh'));
        const 节数 = new Set(项.map((p) => p.d.节 || '')).size;
        out(出, { 类: '机', 键: '机.' + 型名, 名: 型名, 节数, 项, 形: null, 齐: false });
      }
    }
    return 出;
  }

  function out(arr, g) { g.计 = g.项.length; arr.push(g); return g; }

  // 折叠态是三态，不是两态：**记过的** / **没记过的**。
  //   · 记过的永远压过默认——他把 24 单的 G3 展开了，就不该因为它还是 24 单又给他收回去。
  //   · 没记过、又在筛选态下：一律摊开。他刚刚才亲手把范围筛窄，
  //     这时还替他收起来，是让他点两次才看得见自己要的东西。
  //   · 其余按组的大小定：大堆默认收起（实测全展开 4542px，五屏半的墙），
  //     小堆默认摊开（收起一个只有 1 条的组，是拿一次点击换零）。
  const 默认收阈 = 8;
  function 该收(记态, 键, 计, 筛) {
    const 记 = 记态 && (typeof 记态.get === 'function' ? 记态.get(键) : 记态[键]);
    const 有记 = 记态 && (typeof 记态.has === 'function' ? 记态.has(键) : Object.prototype.hasOwnProperty.call(记态, 键));
    if (有记) return 记 === true;
    if (筛 && 筛 !== '全') return false;
    return Number(计) > 默认收阈;
  }

  const api = { 久档, 组形, 分闸组, 该收, 默认收阈 };
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  else 根.闸分组 = api;
}(typeof self !== 'undefined' ? self : this));
