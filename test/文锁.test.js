// 文锁.test.js — 文件锁 / 草稿 / 版本环（2026-08-31 批三）
//
// 这一组守的是**并发写**，评审对它打出的是 serious 级击杀，时刻表如下：
//   21:04 制作人打开文档，标了 3 个【删】、写了 40 行，一次都还没按存盘
//   21:26 他在 §4.10 标了个【问】，点「转交」；坐席读档、答问，
//         **顺手把那行【问】替换成「（已答：…）」并 Edit 落盘**
//   21:27 制作人手上是 V1（25 分钟手工标注），盘上是 V2。
//         三个按钮里「保留我的」需要三路合并，**而三路合并要 base 的字节，
//         方案只存了哈希**——那个按钮在数据模型里根本不存在。
// 守⑫ 直接钉这一条。
//
// 时间一律注入，不用真等——判据不许靠 sleep（慢，且在慢机器上会随机红）。
'use strict';
const assert = require('node:assert');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const 锁lib = require('../server/lib/文锁.js');

const 新台 = () => 锁lib.开台(fs.mkdtempSync(path.join(os.tmpdir(), '文锁测-')));
const 秒 = (n) => n * 1000;
const 分 = (n) => n * 60 * 1000;
const T0 = 1756600000000;      // 固定基准时刻，不用 Date.now()——判据不许跟着挂钟走

// ── 一、租约：管崩溃 ───────────────────────────────────────────────

test('守① 取锁给令牌；同一份文件不许被第二个人抢走', () => {
  const 台 = 新台();
  const a = 台.取('jia', 'a.md', '制作人', T0);
  assert.ok(a.行 && a.令牌, JSON.stringify(a));
  const b = 台.取('jia', 'a.md', '别人', T0 + 秒(1));
  assert.ok(!b.行, '锁被抢走了：' + JSON.stringify(b));
  assert.ok(/正在编辑/.test(b.因), b.因);
});

test('守② **停止续租 45 秒后锁自动失效**（不靠"记得解锁"）', () => {
  // 这是全组最重要的一条。「点编辑上锁、改完自己解锁」里那个「自己解锁」
  // 一定会有人做不到：互保环重启、换装杀进程、浏览器崩了。
  // 锁留在盘上没有持有者 → 谁也解不开，而这块屏开机自启，它会带着死锁自己回来。
  const 台 = 新台();
  台.取('jia', 'a.md', '制作人', T0);
  assert.strictEqual(台.况('jia', 'a.md', T0 + 秒(44)).态, '持有');
  assert.strictEqual(台.况('jia', 'a.md', T0 + 秒(46)).态, '过期');
  // 过期之后别人能接管
  const b = 台.取('jia', 'a.md', '别人', T0 + 秒(46));
  assert.ok(b.行, '过期后仍抢不到：' + JSON.stringify(b));
});

test('守③ 续租把租约推回去；令牌不对的续租一律拒', () => {
  const 台 = 新台();
  const a = 台.取('jia', 'a.md', '制作人', T0);
  assert.ok(台.续('jia', 'a.md', a.令牌, T0 + 秒(30)).行);
  assert.strictEqual(台.况('jia', 'a.md', T0 + 秒(70)).态, '持有', '续租没生效');
  assert.ok(!台.续('jia', 'a.md', '假令牌', T0 + 秒(80)).行, '假令牌续租成功了');
});

// ── 二、闲置：管「人走了但页面还开着」──────────────────────────────

test('守④ **30 分钟没按键 → 降级为可抢**（页面还开着也一样）', () => {
  // 没有这一条：制作人点了编辑就去睡，浏览器整夜续租，锁永不过期，
  // 02:00 的夜间巡检和整个白天我都动不了那份文件。
  // 在系统看来「正在编辑」和「人走了」一模一样。
  const 台 = 新台();
  const a = 台.取('jia', 'a.md', '制作人', T0);
  // 一直在续租（页面开着），但从不按键
  let t = T0;
  for (let i = 0; i < 200; i++) { t += 秒(15); 台.续('jia', 'a.md', a.令牌, t, false); }
  assert.ok(t - T0 > 分(30), '测试没跑够 30 分钟');
  assert.strictEqual(台.况('jia', 'a.md', t).态, '可抢', '闲置了半小时还是持有态');
  assert.ok(台.取('jia', 'a.md', '总监', t).行, '可抢态下仍抢不到');
});

test('守⑤ 有按键的续租不算闲置', () => {
  const 台 = 新台();
  const a = 台.取('jia', 'a.md', '制作人', T0);
  let t = T0;
  for (let i = 0; i < 200; i++) { t += 秒(15); 台.续('jia', 'a.md', a.令牌, t, true); }
  assert.strictEqual(台.况('jia', 'a.md', t).态, '持有', '一直在打字却被判成闲置');
});

test('守⑥ 可抢**不是对持有者放宽**——他自己的令牌照样能写', () => {
  const 台 = 新台();
  const a = 台.取('jia', 'a.md', '制作人', T0);
  const t = T0 + 分(40);
  台.续('jia', 'a.md', a.令牌, t, false);
  assert.strictEqual(锁lib.可写(台.条('jia', 'a.md'), a.令牌, t).行, true, '持有者被自己的闲置挡住了');
  assert.strictEqual(锁lib.可写(台.条('jia', 'a.md'), '别的令牌', t).行, false);
});

// ── 三、写权判定 ───────────────────────────────────────────────────

test('守⑦ 没锁不许写；令牌不对不许写，且理由要说得出是谁锁着', () => {
  const 台 = 新台();
  assert.strictEqual(锁lib.可写(null, 'x', T0).行, false);
  const a = 台.取('jia', 'a.md', '制作人', T0);
  const r = 锁lib.可写(台.条('jia', 'a.md'), '别人的令牌', T0 + 秒(1));
  assert.strictEqual(r.行, false);
  assert.ok(/制作人/.test(r.因), '拒绝理由没说是谁锁着：' + r.因);
  assert.strictEqual(锁lib.可写(台.条('jia', 'a.md'), a.令牌, T0 + 秒(1)).行, true);
});

test('守⑧ 放锁要令牌；放完别人能取', () => {
  const 台 = 新台();
  const a = 台.取('jia', 'a.md', '制作人', T0);
  assert.ok(!台.放('jia', 'a.md', '假的').行, '假令牌把锁放掉了');
  assert.ok(台.放('jia', 'a.md', a.令牌).行);
  assert.ok(台.取('jia', 'a.md', '别人', T0 + 秒(1)).行);
});

// ── 四、外部进程能看见这把锁（这是它落盘的全部理由）────────────────

test('守⑨ **外部可写()** 认得出被锁的绝对路径——坐席与 hook 靠它', () => {
  // 锁要挡住的三个写手里有两个不在终端进程内（坐席子进程、无人值守班次）。
  // 内存里的锁它们看不见，所以这条是「锁落盘」这个设计的唯一验收点。
  const 台 = 新台();
  const 根表 = [{ 键: 'jia', 名: '甲', 路: 'D:/仓/甲' }];
  assert.strictEqual(台.外部可写('D:/仓/甲/a.md', 根表, T0).行, true, '没锁却说不能写');
  台.取('jia', 'a.md', '制作人', T0);
  const r = 台.外部可写('D:\\仓\\甲\\a.md', 根表, T0 + 秒(1));   // 反斜杠也要认
  assert.strictEqual(r.行, false, '锁着却说能写——这条一破，锁就等于没有');
  assert.ok(/制作人/.test(r.因), r.因);
  // 别的文件不受影响
  assert.strictEqual(台.外部可写('D:/仓/甲/b.md', 根表, T0 + 秒(1)).行, true);
  // 过期之后放行
  assert.strictEqual(台.外部可写('D:/仓/甲/a.md', 根表, T0 + 秒(60)).行, true);
});

test('守⑩ 解锁请求记得下、等了多久看得出、重复请求不刷新起点', () => {
  const 台 = 新台();
  台.取('jia', 'a.md', '制作人', T0);
  台.请求解锁('jia', 'a.md', '总监', '夜间巡检要改这份', T0 + 分(1));
  台.请求解锁('jia', 'a.md', '总监', '又要了一次', T0 + 分(20));
  const q = 台.况('jia', 'a.md', T0 + 分(20)).请求;
  assert.ok(q, '请求没记下');
  assert.strictEqual(q.次数, 2);
  assert.strictEqual(q.起于, T0 + 分(1), '起点被刷新了——那就看不出等了多久');
});

test('守⑪ 锁易手时旧的解锁请求要清掉', () => {
  const 台 = 新台();
  const a = 台.取('jia', 'a.md', '制作人', T0);
  台.请求解锁('jia', 'a.md', '总监', '要改', T0 + 分(1));
  台.放('jia', 'a.md', a.令牌);
  台.取('jia', 'a.md', '别人', T0 + 分(2));
  assert.strictEqual(台.况('jia', 'a.md', T0 + 分(2)).请求, null, '易手后旧请求还挂着');
});

// ── 四点五、给坐席的占用告示 ───────────────────────────────────────

test('守⑪b 有人锁着时告示说得出是哪份、谁锁的；没人锁着时是空串', () => {
  // 这一条是击杀逼出来的：原方案只把告示接进了班次，而击杀构造的场景是
  // **人对话那条路**——制作人点「转交」，坐席读档答问，顺手把那行【问】改掉并落盘。
  const 台 = 新台();
  assert.strictEqual(锁lib.告示(台.表(), T0), '', '没人锁着却发了告示——那会变成每条对话都带的噪声');
  台.取('jia', '设计文档.md', '制作人', T0);
  const g = 锁lib.告示(台.表(), T0 + 秒(5));
  assert.ok(g.includes('jia/设计文档.md'), '告示没说是哪一份：' + g);
  assert.ok(g.includes('制作人'), '告示没说是谁锁的：' + g);
  assert.ok(/不要写|不许写/.test(g), '告示没说清"读可以、写不行"：' + g);
  // **不许再声称有硬闸。**首版最后一行写着「硬拦在 server 侧，写了也会被拒」，
  // 而 外部可写() 在生产代码里零调用点——那是一句说给坐席听的谎。
  // 判据全绿是因为判据自己直接调那个函数（H104 要防的正是这种）。
  // 断言要卡在**肯定式**上：实话里那句是「你写了**不会**被拒」，正好含「会被拒」三字，
  // 首版这条断言写成 /会被拒/ 就把实话也一起拒了——判据自己也会说糊涂话。
  assert.ok(!/硬拦/.test(g), '告示又声称有硬闸了，而那道闸并不存在：' + g);
  assert.ok(!/写了也会被拒/.test(g), '告示又声称写会被拒了：' + g);
  assert.ok(/不是机器闸|不会被拒/.test(g), '告示没说清这只是约定、写了不会被拒：' + g);
  // 过期的锁不该还在告示里
  assert.strictEqual(锁lib.告示(台.表(), T0 + 秒(90)), '', '过期的锁还挂在告示上');
});

// ── 五、草稿与 base（可行性卷的主击杀）─────────────────────────────

test('守⑫ **base 的字节要落盘，不只落哈希**——否则「保留我的」不存在', () => {
  const 台 = 新台();
  台.存草('jia', 'a.md', '我改了一半的内容', '打开时盘上的原文', 锁lib.指纹('打开时盘上的原文'));
  const c = 台.取草('jia', 'a.md');
  assert.ok(c.有, '草稿没存上');
  assert.strictEqual(c.文, '我改了一半的内容');
  assert.strictEqual(c.基文, '打开时盘上的原文', 'base 的字节没落盘——三路合并做不了');
  assert.strictEqual(c.基指纹, 锁lib.指纹('打开时盘上的原文'));
});

test('守⑬ 反复存草不许把 base 覆盖成新的（base 是"打开那一刻"的，不是最近一次的）', () => {
  const 台 = 新台();
  台.存草('jia', 'a.md', '第一次', '原文', 锁lib.指纹('原文'));
  台.存草('jia', 'a.md', '第二次', '被别人改过的新内容', 锁lib.指纹('原文'));
  assert.strictEqual(台.取草('jia', 'a.md').基文, '原文', 'base 被后来的写覆盖了，合并基准就丢了');
});

test('守⑭ 清草把三份都清掉（草稿/base/元），不留半截', () => {
  const 台 = 新台();
  台.存草('jia', 'a.md', 'x', 'y', 'z');
  台.清草('jia', 'a.md');
  assert.strictEqual(台.取草('jia', 'a.md').有, false);
});

test('守⑭b **存盘后要重置 base，不能清掉**（清掉的话下一次冲突就没有比较基准）', () => {
  // 实测踩到：第一版存盘成功后调的是 清草()，把 base 一起删了。
  // 于是第二次冲突时三路差异是空的——「保留我的」当场退化成盲覆盖，
  // 而界面上看不出这个区别（按钮还在，点了照样能覆盖）。
  const 台 = 新台();
  台.存草('jia', 'a.md', '改了一半', '打开时的原文', 'h0');
  台.重置基('jia', 'a.md', '刚存进去的这一版', 'h1');
  const c = 台.取草('jia', 'a.md');
  assert.strictEqual(c.有, true, 'base 被一起清掉了');
  assert.strictEqual(c.文, null, '草稿该清掉（已经存进盘了）');
  assert.strictEqual(c.基文, '刚存进去的这一版', '**存盘之后的 base 就是刚存的这一版**');
  assert.strictEqual(c.基指纹, 'h1');
});

// ── 五点五、兜底件自己不能变成损坏源（2026-08-31 验收复核确证）──────

test('守⑭c **截半的草稿不许被当成完整的**（换装杀进程时的实况）', () => {
  // 复核实测：进程死在写 .draft.md 中途，盘上留一份被截到 9406/130902 字节的稿，
  // 而 .json 还是上一轮那份（能解析）——于是重开时服务端答「有草稿、同源」，
  // 界面照常弹「要接着改吗」，点是再存盘，**半截文档被当成完整的写进真文件**。
  // 更狠的一档停在 0 字节（'w' 先 O_TRUNC），文案照旧。
  // 「半个 markdown 看起来仍然像一份 markdown」——这句是 落盘() 的注释自己写的。
  const 台 = 新台();
  const 全文 = '第一段完整内容\n\n第二段完整内容\n\n第三段完整内容\n';
  台.存草('jia', 'a.md', 全文, '原文', 'h0');
  assert.strictEqual(台.取草('jia', 'a.md').文, 全文, '正常草稿都读不回来，判据前提不成立');

  // 把 .draft.md 截半（模拟写到一半被杀）
  const 底 = path.join(台.草目, fs.readdirSync(台.草目).find((f) => f.endsWith('.draft.md')));
  fs.writeFileSync(底, 全文.slice(0, 12), 'utf8');
  const c = 台.取草('jia', 'a.md');
  assert.strictEqual(c.文, null, '半截草稿被当成完整的交出去了：' + JSON.stringify(c.文));
  assert.strictEqual(c.损, true, '没标出「这份坏了」——调用方分不清「没有」和「坏了」');

  // 0 字节那一档也要认出来
  fs.writeFileSync(底, '', 'utf8');
  assert.strictEqual(台.取草('jia', 'a.md').文, null, '0 字节草稿被当成完整的');
});

test('守⑭d **元信息坏了要留住草稿，不是删掉它**', () => {
  // 反向失败路径：进程死在写 .json 中途 → 元信息坏了 → 下一次取锁走 重置基()
  // → 首版那行 unlinkSync 把**完整的** 13 万字节草稿静默删掉。
  // 元信息坏了说明「不知道这份草稿是什么状态」，那更该留着它，不是更该删。
  const 台 = 新台();
  台.存草('jia', 'a.md', '十三万字节的完整草稿', '原文', 'h0');
  const 元档 = path.join(台.草目, fs.readdirSync(台.草目).find((f) => f.endsWith('.json')));
  fs.writeFileSync(元档, '{ 这不是 JSON', 'utf8');
  assert.strictEqual(台.取草('jia', 'a.md').有, false, '坏元信息该当作没有');

  台.重置基('jia', 'a.md', '盘上新版', 'h1');
  const 孤 = fs.readdirSync(台.草目).filter((f) => f.includes('.orphan-'));
  assert.strictEqual(孤.length, 1, '那份完整草稿被删了，没留孤儿副本：' + fs.readdirSync(台.草目).join(','));
  assert.strictEqual(fs.readFileSync(path.join(台.草目, 孤[0]), 'utf8'), '十三万字节的完整草稿');
});

test('守⑭e 草稿三个文件全部原子写（不留 .tmp）', () => {
  const 台 = 新台();
  台.存草('jia', 'a.md', 'x', 'y', 'h');
  台.重置基('jia', 'a.md', 'z', 'h2');
  const 剩 = fs.readdirSync(台.草目).filter((f) => f.includes('.tmp'));
  assert.deepStrictEqual(剩, [], '留下了临时文件：' + 剩.join(','));
});

test('守⑬b **基准换了就要重写 base**（首版的 existsSync 守卫让它永不更新）', () => {
  // 守⑬ 验的是「同一个基准反复存草不许覆盖 base」，那条仍然对。
  // 但首版的条件是「文件不存在才写」，于是 base 从第一次 lock 起就再也不动，
  // 而同一函数里 基指纹 是**无条件覆盖**的——两者一叠，
  // 服务端 base 停在两代之前，冲突面板却照标 能三路=true，
  // 并且**精准绕开了系统为它准备的提示牌**（「取不到 base 是盲覆盖」那条警告被抑制）。
  const 台 = 新台();
  台.存草('jia', 'a.md', '改了一半', 'V1', 'h1');
  assert.strictEqual(台.取草('jia', 'a.md').基文, 'V1');
  // 同一基准再存：base 不许动（守⑬ 的口径）
  台.存草('jia', 'a.md', '又改了点', 'V1别的写法', 'h1');
  assert.strictEqual(台.取草('jia', 'a.md').基文, 'V1', '同一基准下 base 被覆盖了');
  // **基准换了：base 必须跟着换**
  台.存草('jia', 'a.md', '在新基准上改', 'V2', 'h2');
  assert.strictEqual(台.取草('jia', 'a.md').基文, 'V2', 'base 停在旧基准上——冲突面板会拿两代前的版本画差异');
  assert.strictEqual(台.取草('jia', 'a.md').基指纹, 'h2');
});

test('守㉔ **锁键折叠大小写**（同一份文件不许有第二把「独占」锁）', () => {
  // 复核实测：README.md 与 readme.md 两把锁同时判「持有」，两边 可写() 都为真、
  // 两边 save 都过闸、lockstate 互相看不见、版本环裂成两个目录——
  // 被覆盖之后去 /api/doc/versions 找「谁盖的我」，一版都看不到。
  const 台 = 新台();
  const a = 台.取('jia', 'README.md', '制作人', T0);
  assert.ok(a.行);
  const b = 台.取('jia', 'readme.md', '另一个窗口', T0 + 秒(1));
  assert.ok(!b.行, '大小写变体拿到了第二把锁：' + JSON.stringify(b));
  assert.strictEqual(台.况('jia', 'readme.MD', T0 + 秒(1)).态, '持有', '换个大小写就看不见那把锁了');
  // 草稿与版本环也要落在同一处
  台.存草('jia', 'README.md', '甲写的', 'base', 'h');
  assert.strictEqual(台.取草('jia', 'readme.md').文, '甲写的', '大小写变体的草稿存到了另一个地方');
});

test('守⑮ 不同文件的草稿互不串（键要真的区分开）', () => {
  const 台 = 新台();
  台.存草('jia', 'a.md', 'A的', 'A基', 'h1');
  台.存草('yi', 'a.md', 'B的', 'B基', 'h2');       // 同名不同根
  台.存草('jia', '子/a.md', 'C的', 'C基', 'h3');   // 同根不同路
  assert.strictEqual(台.取草('jia', 'a.md').文, 'A的');
  assert.strictEqual(台.取草('yi', 'a.md').文, 'B的');
  assert.strictEqual(台.取草('jia', '子/a.md').文, 'C的');
});

// ── 六、版本环 ─────────────────────────────────────────────────────

test('守⑯ **每次写入都产生一版，且记得住是谁写的**', () => {
  // 只记制作人的编辑不行：那样历史里坐席的改动是隐形的，
  // 而**假历史比没历史坏**——你会照着一份不完整的历史做判断。
  const 台 = 新台();
  台.存版('jia', 'a.md', 'v1', '制作人', T0);
  台.存版('jia', 'a.md', 'v2', '总监', T0 + 秒(10));
  台.存版('jia', 'a.md', 'v3', '班次:夜间巡检', T0 + 秒(20));
  const 历 = 台.历版('jia', 'a.md');
  assert.strictEqual(历.length, 3);
  // **「谁写的」必须原样留住，不许被文件名规则改掉。**
  // Windows 文件名不收 `:`，所以档名里 `班次:夜间巡检` 会变成 `班次_夜间巡检`——
  // 从文件名回读就是有损的，而且 `班次:晨报` 与 `班次_晨报` 会撞成同一个。
  // 班次系统踩过同一条（`今日跑过` 按文件名判，改个班次名就重复跑了一次 20k）。
  assert.deepStrictEqual(历.map((x) => x.谁), ['班次:夜间巡检', '总监', '制作人'],
    '新的应在前，且「谁写的」要原样留住（不能从净化过的文件名回读）');
});

test('守⑯b 索引丢了也不至于全瞎——回落到文件名，并标出这一条没索引', () => {
  const 台 = 新台();
  台.存版('jia', 'a.md', 'v1', '制作人', T0);
  const 目 = path.dirname(path.join(台.版目, ''));
  // 把索引删掉，模拟「索引写失败」或人手误删
  const 版目录 = path.join(台.版目, fs.readdirSync(台.版目)[0]);
  fs.unlinkSync(path.join(版目录, '索引.jsonl'));
  const 历 = 台.历版('jia', 'a.md');
  assert.strictEqual(历.length, 1, '索引一没就一版都读不到了');
  assert.strictEqual(历[0].谁, '制作人');
  assert.strictEqual(历[0].无索引, true, '回落读出来的没有标记——那就分不清哪些是可信的');
  assert.ok(目);   // 只是别让 lint 说这个变量没用
});

test('守⑰ 版本环有上界，超了删最旧的（不许无界增长）', () => {
  const 台 = 新台();
  for (let i = 0; i < 锁lib.版本上限 + 12; i++) 台.存版('jia', 'a.md', 'v' + i, '制作人', T0 + i * 1000);
  const 历 = 台.历版('jia', 'a.md');
  assert.ok(历.length <= 锁lib.版本上限, `留了 ${历.length} 版，超过上限 ${锁lib.版本上限}`);
  // 留下来的必须是**最新的那批**，不能是最旧的
  assert.strictEqual(台.读版('jia', 'a.md', 历[0].档).文, 'v' + (锁lib.版本上限 + 11));
});

test('守⑱ 读版的档名要校形状（又一个"松一点就是任意文件读取"的口）', () => {
  const 台 = 新台();
  台.存版('jia', 'a.md', 'v1', '制作人', T0);
  for (const 坏 of ['../../../etc/passwd', '..\\..\\x.md', '/abs/x.md', 'x.md', '1-a.txt']) {
    assert.ok(!台.读版('jia', 'a.md', 坏).行, `坏档名被放行了：${坏}`);
  }
  assert.ok(台.读版('jia', 'a.md', 台.历版('jia', 'a.md')[0].档).行, '正常档名反而读不到');
});

// ── 七、坏掉的锁文件不许把整页打死 ─────────────────────────────────

test('守⑲ 锁文件被手改坏时当成空表，不抛异常', () => {
  const 台 = 新台();
  fs.mkdirSync(path.dirname(台.锁档), { recursive: true });
  fs.writeFileSync(台.锁档, '{ 这不是 JSON', 'utf8');
  assert.doesNotThrow(() => 台.况('jia', 'a.md', T0));
  assert.strictEqual(台.况('jia', 'a.md', T0).态, '无');
  assert.ok(台.取('jia', 'a.md', '制作人', T0).行, '坏锁文件让编辑按钮永远点不动');
});

test('守⑳ 写锁表是原子的（不留半截 JSON）', () => {
  const 台 = 新台();
  台.取('jia', 'a.md', '制作人', T0);
  // 写完之后目录里不该有 .tmp 残留
  const 剩 = fs.readdirSync(path.dirname(台.锁档)).filter((f) => f.includes('.tmp'));
  assert.deepStrictEqual(剩, [], '留下了临时文件：' + 剩.join(','));
  assert.doesNotThrow(() => JSON.parse(fs.readFileSync(台.锁档, 'utf8')), '锁文件不是完整 JSON');
});
