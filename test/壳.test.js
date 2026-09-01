// 壳.test.js — 主页与标签页共用一个壳的判据。
//
// 病灶（2026-08-30 制作人指出「主页和标签页割裂」）：主页与标签页是两套壳，
// 两份**手写**导航必然分叉——而分叉的表现是「新做的页面看不见」，不报错，没人会发现。
// 实际发生了三次：08-28 群聊、08-29 监视、08-30 班次，每次都是漏改了另一份。
//
// 所以这一组的重心不是「页面能打开」，是**两处渲染同源**与**降级路不断**。
'use strict';
const assert = require('node:assert');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const { 页签表 } = require('../server/render/页签');
const { 头 } = require('../server/render/页');

const 请求 = (port, 路径) => new Promise((res, rej) => {
  http.get({ host: '127.0.0.1', port, path: 路径 }, (up) => {
    let s = ''; up.setEncoding('utf8');
    up.on('data', (d) => { s += d; });
    up.on('end', () => res({ 码: up.statusCode, 文: s }));
  }).on('error', rej);
});

let _服务 = null;
const 取服务 = async () => {
  if (!_服务) {
    process.env.NO_INTEL = '1';
    process.env.TERMINAL_SHIFT_DRY = '1';
    _服务 = await require('../server').start();
  }
  return _服务;
};
test.after(() => { try { if (_服务 && _服务.server) _服务.server.close(); } catch { /* 已关 */ } });

// ── 单一事实源 ────────────────────────────────────────────
test('源① 服务端顶栏的页签集合 === 页签表（不许手写第二份）', () => {
  const h = 头({ 标题: '测', 当前: 'shift', 日: '' });
  for (const t of 页签表.filter((x) => !x.主页)) {
    assert.ok(h.includes('>' + t.名 + '<'),
      `顶栏漏了「${t.名}」——这正是三次「新页面看不见」的形状`);
  }
  // 主页那一项在独立页面上是「离开这一页回到壳」，不是页签，所以只验它在、不验它叫什么：
  // 同一项在壳里叫「对话」、在独立页上叫「主页」，两种称呼各自是对的。
  assert.ok(/class="tab back" href="\/"/.test(h), '独立页面缺回主页的路——进得去出不来');
});

test('源② /api/views 下发的就是那份表', async () => {
  const r = await 取服务();
  const x = await 请求(r.port, '/api/views');
  assert.equal(x.码, 200);
  const j = JSON.parse(x.文);
  assert.deepEqual(j.视图.map((v) => v.键), 页签表.map((v) => v.键));
  assert.deepEqual(j.视图.map((v) => v.名), 页签表.map((v) => v.名));
});

test('源③ 主页不许再手写导航项（写死一个就会再分叉一次）', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const 导航段 = html.slice(html.indexOf('<nav class="去"'), html.indexOf('</nav>') + 6);
  assert.ok(!/<a\s/.test(导航段),
    '导航里出现了手写 <a>：' + 导航段.slice(0, 200)
    + '\n两份手写列表必然分叉，而分叉的表现是「新页面看不见」，不报错。');
});

test('源④ 表里每一项的路都真的能打开（表和路由不许脱节）', async () => {
  const r = await 取服务();
  for (const t of 页签表) {
    const x = await 请求(r.port, t.路);
    assert.ok(x.码 === 200, `${t.名}（${t.路}）返回 ${x.码}——表里有它，路由没有它`);
  }
});

// ── 片段模式与降级路 ──────────────────────────────────────
test('片① 每个非主页视图都给得出片段，且被 .视图 包着', async () => {
  const r = await 取服务();
  for (const t of 页签表.filter((x) => !x.主页)) {
    const x = await 请求(r.port, t.路 + '?frag=1');
    assert.equal(x.码, 200, t.名);
    assert.ok(/^<div class="视图"[ >]/.test(x.文), `${t.名} 的片段没被抽出来：` + x.文.slice(0, 80));
    assert.ok(!/<!doctype/i.test(x.文), `${t.名} 的片段里还带着整页外壳`);
  }
});

test('片④ 整页带 <script> 的视图，片段必须把 src 带出来（否则脚本在壳里永远不跑）', async () => {
  // 案源 2026-08-31：页面的 <script> 在 </main> 之外，而片段中间件只抠 <main>，
  // innerHTML 又不执行 <script>——于是 **原始流 / 监视 / 席间存照 / 文稿 四页的前端脚本，
  // 在主页壳里从来没跑过一次**：监视页不刷新、存照页没有坐席名单、文稿台搜不了也跳不了。
  // 四页看着都在，只是不动。「静止的活人」不报任何错，所以一直没人发现。
  const r = await 取服务();
  let 查过 = 0;
  for (const t of 页签表.filter((x) => !x.主页)) {
    const 整 = await 请求(r.port, t.路);
    const 脚 = [...整.文.matchAll(/<script[^>]+src="([^"]+)"[^>]*><\/script>/g)].map((m) => m[1]);
    if (!脚.length) continue;
    查过++;
    const 片 = await 请求(r.port, t.路 + '?frag=1');
    const 头 = 片.文.slice(0, 300);
    for (const s of 脚) {
      assert.ok(头.includes(s),
        `${t.名} 的整页有 ${s}，片段却没带上——它在壳里永远不会执行：` + 头.slice(0, 160));
    }
  }
  // 一个带脚本的视图都没查到，说明这条判据在验空气
  assert.ok(查过 >= 3, `只查到 ${查过} 个带脚本的视图，判据可能已被架空`);
});

test('片② **整页一字未动**——降级路不许断', async () => {
  const r = await 取服务();
  for (const t of 页签表.filter((x) => !x.主页)) {
    const x = await 请求(r.port, t.路);
    assert.ok(/^<!doctype/i.test(x.文), `${t.名} 的整页坏了`);
    assert.ok(x.文.includes('<main class="wrap">'), `${t.名} 整页缺主体`);
    assert.ok(x.文.includes('class="top"'), `${t.名} 整页缺顶栏——单独打开时它是唯一的导航`);
  }
});

test('片③ frag=1 不许改变非 HTML 的响应（JSON 照旧）', async () => {
  const r = await 取服务();
  const x = await 请求(r.port, '/api/views?frag=1');
  assert.equal(x.码, 200);
  assert.ok(x.文.startsWith('{'), 'JSON 被片段模式改坏了：' + x.文.slice(0, 60));
  JSON.parse(x.文);
});

// ── 同构守卫（不是判据，是防特定退化，照 packaged-root 的成例）──
test('守① 谁样式了 body/wrap，谁就必须同时挂 .视图（否则片段在主页里没排版）', () => {
  // 这一条原先是**硬编码的三项名单** ['read.css','watch.css','班次.css']。
  // 硬编码名单的毛病和它要防的病是同一个：加了第四张表，没人会记得来改这里，
  // 于是新页在主页里排版塌掉，而判据一片绿——**两份手工维护的列表必然分叉**。
  //
  // 改成自动发现，并且把不变量写准一点：
  // 不是"每张视图样式表都要有那两条"（存照.css 全走自己的 cz-* 类，没有 body/wrap 规则，
  // 强加那两条只是噪声），而是**「样式了 body 或 .wrap 的，必须也覆盖 .视图」**。
  // style.css 与 tokens.css 是壳自己的表，body 归它们管，不在此列。
  const 目 = path.join(__dirname, '..', 'public');
  const 壳自己的 = new Set(['style.css', 'tokens.css']);
  const 表们 = fs.readdirSync(目).filter((f) => f.endsWith('.css') && !壳自己的.has(f));
  assert.ok(表们.length >= 3, '一张视图样式表都没找到，这条守卫在验空气');

  const 查过 = [];
  for (const f of 表们) {
    const s = fs.readFileSync(path.join(目, f), 'utf8');
    if (/^body\s*\{/m.test(s)) assert.fail(`${f} 有裸 body 规则，没挂 .视图——片段在主页里会失去排版`);
    if (/^\.wrap\s*\{/m.test(s)) assert.fail(`${f} 有裸 .wrap 规则，没挂 .视图`);
    if (/^body, \.视图 \{/m.test(s) || /^\.wrap, \.视图 \{/m.test(s)) 查过.push(f);
  }
  // 至少三张表确实走了这个写法——全被改成"不写 body 规则"也能满足上面的断言，
  // 那时这条守卫就变成了永远绿的摆设。
  assert.ok(查过.length >= 3, '走 body,.视图 写法的表少于三张，守卫可能已被架空：' + 查过.join(','));
});

test('守①c **`.视图` 是所有视图共用的壳，谁都不许往它身上写布局**', () => {
  // 案源就在 2026-08-31 当晚，是我自己犯的：
  // 文稿.css 里写了 `body.页, .视图 { display:flex; height:100%; overflow:hidden }`，
  // 而**每一张视图样式表都会被 index.html 预载**——于是那条 overflow:hidden
  // 跟着漏给了日报 / 原始流 / 监视 / 班次 / 席间存照：
  // 席间存照 15487px 高的内容被裁在 491px 的框里，**五页在壳里全都滚不动了**。
  // 症状照例是不报错、不白屏，只是滚轮没反应。
  //
  // 当时我还专门写了注释「用 body.页 而不是裸 body，免得影响主页三栏」——
  // **守住了 body，漏了 .视图**。两者是同一类东西：都是别人也会用到的壳。
  //
  // 口径：`.视图` 上只许写「长相」（颜色、字体、背景），
  // 不许写「布局与滚动」（display / overflow / height / position / flex）。
  // 要写就得把选择器缩到自己那一页（本表用的是 `.视图:has(.稿容)`）。
  const 目 = path.join(__dirname, '..', 'public');
  const 壳自己的 = new Set(['style.css', 'tokens.css']);
  // **只卡真会伤到别人的那几个。**
  // `min-height: 100%` 不在其列：三张表都写了它，它让短片段撑满一格，谁也不碍着。
  // 真正会漏出去伤人的是「把别人的滚动关掉 / 把别人变成 flex / 给别人钉死高度」
  // ——那正是本案里 overflow:hidden + height:100% 干的事。
  // 判据的范围要卡在**伤害**上，不是卡在「像不像布局属性」上；
  // 卡宽了会把三张无辜的表也判红，而一条老是误报的判据最后一定会被人关掉。
  const 布局属性 = /(^|[;{\s])(display|overflow(-[xy])?|height|position|flex)\s*:/;
  const 犯 = [];
  for (const f of fs.readdirSync(目).filter((x) => x.endsWith('.css') && !壳自己的.has(x))) {
    // **先整体去注释再切规则。**首版是切完规则再去注释——
    // 而本条判据自己的那段注释里正好抄了一份带花括号的 CSS 示例，
    // 于是规则解析器被那对括号带偏，整条被守的规则**根本没进到循环里**：
    // 自证能红台一变异就把这个洞照出来了（判据不红）。
    const s = fs.readFileSync(path.join(目, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    // 逐条规则看：选择器里出现**没有再缩小范围的** .视图。
    //
    // 按 `}` 切块，不用 matchAll 配 `(^|})…{…}`——后者会把**上一条规则的收尾 `}`
    // 当成自己的起始分隔符吃掉**，于是隔一条漏一条：
    // 本条判据第一版就是这么写的，结果被守的那条规则正好落在被漏掉的位置，
    // 判据一直是绿的。自证能红台连着两次把这个洞照出来。
    for (const 块 of s.split('}')) {
      const i = 块.indexOf('{');
      if (i < 0) continue;
      const 选 = 块.slice(0, i).trim();
      const 体 = 块.slice(i + 1);
      if (!/\.视图/.test(选)) continue;
      // 缩过范围的放行：.视图:has(…) / .视图 后面还跟着后代选择器
      const 裸 = 选.split(',').map((x) => x.trim())
        .filter((x) => /(^|\s)\.视图$/.test(x));
      if (!裸.length) continue;
      if (布局属性.test(体)) 犯.push(`${f}: ${选.slice(0, 60)} → ${体.trim().slice(0, 50)}`);
    }
  }
  assert.deepStrictEqual(犯, [],
    '有样式表往裸 .视图 上写了布局/滚动属性。**.视图 是所有视图共用的壳，'
    + '而每张表都会被 index.html 预载**——写上去就是漏给别人：\n  ' + 犯.join('\n  ')
    + '\n把选择器缩到自己那一页（例：`.视图:has(.你的根类)`）。');
});

test('守①d **单页样式表里不许出现全局选择器**（`*` / `:root` / 裸伪元素）', () => {
  // 守①c 只扫「含 .视图 的选择器」，于是 2026-08-31 的这一条整个逃逸了：
  // `班次.css` 里一行 `* { scrollbar-width: thin }`。
  // Chromium 的规矩是 scrollbar-width 一旦不是 auto，该元素的 `::-webkit-scrollbar`
  // 伪元素整族被忽略——那一行杀掉了它自己下面四行，也杀掉了 style.css 里那四行，
  // 而 index.html 预载它：**主壳三栏、五张视图页、编辑器内部无一幸免**。
  // 更贵的是它旁边那句已被证伪的解释（main.js 里的 Fluent 开关）：它让人不去看真凶。
  //
  // 口径：`*` / `:root` / `html` / `body` 裸写，以及裸的 `::selection`、
  // `::-webkit-scrollbar*`、`:focus-visible` —— 这些全局表面只许写在 tokens.css 一处。
  const 目 = path.join(__dirname, '..', 'public');
  const 允许 = new Set(['tokens.css']);
  const 主壳 = new Set(['style.css']);      // 主壳自己那份 `* { box-sizing }` 重置留给它
  const 全局选 = /^(\*|:root|html|body)$/;
  const 全局伪 = /^(::selection|::-webkit-scrollbar[a-z-]*(:hover)?|:focus-visible)$/;
  // **卡在伤害上，不卡在「像不像全局选择器」上。**
  // `* { box-sizing: border-box; margin: 0; padding: 0 }` 四张表各写了一遍——
  // 那是幂等的重置，重复但不伤人；`@media (prefers-reduced-motion) * { transition: none }` 同理。
  // 真会漏出去伤人的是两类：
  //   ① 滚动条：写在 `*` 上会把全项目的 ::-webkit-scrollbar 整族关掉（本案）；
  //   ② 布局与滚动：给别人的 html/body 钉高度、关滚动、变 flex（与守①c 同一条口径）。
  // 判据卡宽了会把三张无辜的表判红，而一条老是误报的判据最后一定会被人关掉。
  const 伤人属性 = /(^|[;{\s])(scrollbar-(width|color)|overflow(-[xy])?|height|display|position)\s*:/;
  const 犯2 = [];
  for (const f of fs.readdirSync(目).filter((x) => x.endsWith('.css') && !允许.has(x))) {
    const s2 = fs.readFileSync(path.join(目, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const 块 of s2.split('}')) {
      const i = 块.indexOf('{');
      if (i < 0) continue;
      const 选 = 块.slice(0, i).replace(/^[\s\S]*\{/, '').trim();   // 落在 @media 里的取内层
      const 体 = 块.slice(i + 1);
      if (!选 || 选.startsWith('@')) continue;
      for (const 一 of 选.split(',').map((x) => x.trim())) {
        // 裸的全局表面伪元素：一律只许在 tokens.css（重复定义早晚会各画各的）
        if (全局伪.test(一)) { 犯2.push(`${f}: ${一}  →  全局表面只写在 tokens.css`); continue; }
        if (主壳.has(f)) continue;                      // 主壳自己的重置留给它
        if (全局选.test(一) && 伤人属性.test(体)) {
          犯2.push(`${f}: ${一}  →  ${体.trim().slice(0, 48)}`);
        }
      }
    }
  }
  assert.deepStrictEqual(犯2, [],
    '这些单页样式表里写了全局选择器，而每张表都会被 index.html 预载——\n'
    + '**它们在整个项目上生效**：\n  ' + 犯2.join('\n  ')
    + '\n全局表面（选区/光标/滚动条/焦点圈）只写在 public/tokens.css 一处。');
});

test('守①e 滚动条只在 tokens.css 定义一次，且不在 Chromium 上设 scrollbar-width', () => {
  const 目 = path.join(__dirname, '..', 'public');
  const t = fs.readFileSync(path.join(目, 'tokens.css'), 'utf8');
  assert.match(t, /::-webkit-scrollbar \{/, 'tokens.css 里没有滚动条定义');
  const 去注 = t.replace(/\/\*[\s\S]*?\*\//g, '');
  const i = 去注.indexOf('scrollbar-width');
  if (i >= 0) {
    // scrollbar-width 只许活在 @supports not selector(::-webkit-scrollbar) 里面：
    // 它一旦无条件生效，就会把上面那族 ::-webkit-scrollbar 全部关掉（Chromium 的规矩）。
    const 前 = 去注.slice(0, i);
    const 支 = 前.lastIndexOf('@supports not selector(::-webkit-scrollbar)');
    assert.ok(支 >= 0, '**tokens.css 里的 scrollbar-width 不在 @supports 保护之下**');
    assert.ok(!前.slice(支).includes('}'), 'scrollbar-width 落在 @supports 块之外了');
  }
});

test('守①b **生产前端不许用 alert/confirm/prompt**（Electron 壳内静默哑弹）', () => {
  // 换装仪式第⑨条。这个项目为它中招过两次（confirm 十连哑弹、prompt 四连哑弹），
  // 两次都是**浏览器预览里一切正常**——所以这条只能靠守卫，测不出来。
  //
  // 哑弹在文稿台尤其毒：confirm 若恒返回假，「切页签确认」变成永远切不走、
  // 「退出编辑」变成永远退不出；恒返回真，那几道确认等于不存在。两边都坏，都不报错。
  //
  // 这是**源码守卫**不是行为判据（H104 口径：grep 源码不算判据）。
  // 这里用守卫是对的：坏结果发生在被测进程之外（Electron 壳），行为判据够不着
  // ——与 test/快捷键.test.js 同一条理由。
  const 目 = path.join(__dirname, '..', 'public');
  const 打包产物 = new Set(['编辑器.js']);      // esbuild 产物里第三方库可能自带这些字样
  const 犯 = [];
  for (const f of fs.readdirSync(目).filter((x) => x.endsWith('.js') && !打包产物.has(x))) {
    const 源 = fs.readFileSync(path.join(目, f), 'utf8');
    // 去注释再看——本条案情就写在注释里，正当地提到了这三个名字
    const 净 = 源.replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n');
    for (const m of 净.matchAll(/(?:^|[^.\w])(alert|confirm|prompt)\s*\(/g)) {
      犯.push(`${f}: ${m[1]}(`);
    }
  }
  assert.deepStrictEqual(犯, [],
    '生产前端又用上原生对话框了，它在 Electron 壳里静默哑弹：' + 犯.join('、')
    + '\n用 文稿.js 里的自绘 问()/告() 那一族（返回 Promise）。');
});

test('守② 话流与视图区要有显式的 [hidden] 规则', () => {
  // hidden 属性对设了 display 的元素不生效（类选择器盖过浏览器默认表），
  // 于是切视图时话流仍然画在屏上，两块内容叠着——JS 报 hidden=true，眼睛看见两份。
  // 这类「属性设了但没生效」的错不报任何异常，只能靠看出来；这条守卫防它悄悄回来。
  const s = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');
  assert.ok(/\.话流\[hidden\]/.test(s) && /\.视图区\[hidden\]/.test(s),
    'style.css 缺 [hidden] 显式规则');
});
// ── 版本口（2026-09-01）────────────────────────────────────────────
//
// 换装仪式第 7 条写死：「换装成功必须用 /api/version 的版本号确认，
// 禁止拿『API 有响应』当数」。那条是 08-28 一次假换装之后立的——
// 那次打完包、起完进程、探到 /api/attn 有响应就报告「0.40.1 活体已起」，
// 而应答的是**没被杀掉的 0.40.0**。旧实例与新实例长得一模一样，只有版本号分得开。
//
// 而终端一直没有这个口：2026-09-01 实测活体 `/api/version` 回 404。
// **这条仪式在终端上从来执行不了，而每次换装的记录都写着「已确认」。**
// 一条做不到的规矩，比没有这条规矩坏：它让人以为验过了。
test('版本口 · 回得出版本号，且与 package.json 同源', async () => {
  const r = await 取服务();
  const x = await 请求(r.port, '/api/version');
  assert.equal(x.码, 200, '/api/version 不通 —— 换装仪式第 7 条就没法执行');
  const j = JSON.parse(x.文);
  const 包 = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.equal(j.版本, 包.version, '版本号与 package.json 分了家 —— 那比没有这个口更坏');
  assert.match(String(j.起于), /^\d{4}-\d{2}-\d{2}T/, '没给起于 —— 版本号相同但起于是旧时刻，说明杀旧那步没干净');
  assert.ok(['exe', '源码'].includes(j.形态), '没分得清打包态与源码态：' + j.形态);
});

test('版本口 · 版本号不许写死在代码里（写死的数迟早和真的分家）', () => {
  const s = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const i = s.indexOf("app.get('/api/version'");
  assert.ok(i > 0, '找不到版本口');
  const 段 = s.slice(i, s.indexOf('});', i));
  assert.match(段, /require\('\.\/package\.json'\)\.version/, '版本号不是从 package.json 读的');
  assert.ok(!/['"]\d+\.\d+\.\d+['"]/.test(段), '段里出现了写死的版本号：' + 段.slice(0, 200));
});

test('守路① **路由路径一律 ASCII**（中文路径永远匹配不上，且表现是「点了没反应」）', () => {
  // 案发 2026-09-01：我给用途覆写写了一条 `r.post('/api/doc/用途', …)`。
  // 浏览器发出去的是 `%E7%94%A8%E9%80%94`，而 Express 拿**未解码的** req.path
  // 去匹配路由表——那个中文字面量永远对不上，**404**。
  // 而它在屏上的表现是「点了没反应」：控制台里一条 404，页面什么都不说。
  //
  // 这跟本仓记着的「中文指令不能走 argv」是同一族：
  // **中文每过一道边界（shell / argv / URL / 文件名），都要问一句它会不会被改写。**
  // 全项目 31 条路由本来都是 ASCII，破例的只有那一条。
  const 根 = path.join(__dirname, '..');
  const 查 = [path.join(根, 'server.js')];
  const 走 = (d) => {
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, f.name);
      if (f.isDirectory()) 走(p); else if (f.name.endsWith('.js')) 查.push(p);
    }
  };
  走(path.join(根, 'server'));
  const 犯 = [];
  for (const p of 查) {
    const 文 = fs.readFileSync(p, 'utf8');
    文.split(/\r?\n/).forEach((l, i) => {
      if (l.trim().startsWith('//') || l.trim().startsWith('*')) return;
      const m = /\b(?:r|app|router)\.(?:get|post|put|delete|all|use)\(\s*'([^']*)'/.exec(l);
      // eslint-disable-next-line no-control-regex
      if (m && /[^\x00-\x7F]/.test(m[1])) {
        犯.push(`${path.relative(根, p)}:${i + 1}  ${m[1]}`);
      }
    });
  }
  assert.deepStrictEqual(犯, [],
    '这些路由路径里有非 ASCII 字符，浏览器会把它们百分号编码，而 Express 拿未解码的\n'
    + 'req.path 匹配——**永远 404，且屏上只表现为「点了没反应」**：\n  ' + 犯.join('\n  '));
});

test('守路①b 前端调的路径与服务端注册的对得上（改了一头没改另一头也是 404）', () => {
  const 根 = path.join(__dirname, '..');
  const 服 = fs.readFileSync(path.join(根, 'server', 'routes', '文稿页.js'), 'utf8');
  const 前 = fs.readFileSync(path.join(根, 'public', '文稿.js'), 'utf8');
  // 服务端注册的 /api/doc/* 全集
  const 注 = new Set([...服.matchAll(/\br\.(?:get|post)\(\s*'(\/api\/doc\/[^']*)'/g)].map((m) => m[1]));
  assert.ok(注.size >= 8, '只找到 ' + 注.size + ' 条 /api/doc 路由，这条判据可能在验空气');
  // 前端调的（含模板串里带查询参数的，只取路径那一截）。
  // **路径段要连非 ASCII 一起收**：第一版写的是 `[a-zA-Z-]+`，
  // 于是前端那条 `/api/doc/用途` 根本没被这条判据看见——
  // 而它正是这条判据要抓的东西。**一条只认合格写法的判据，抓不到不合格的写法。**
  const 调 = new Set([...前.matchAll(/['"`](\/api\/doc\/[^'"`?\s)]+)/g)].map((m) => m[1]));
  const 缺 = [...调].filter((x) => !注.has(x));
  assert.deepStrictEqual(缺, [], '前端在调这些服务端没注册的路径（404，且屏上不说话）：\n  ' + 缺.join('\n  '));
});
