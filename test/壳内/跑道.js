// 跑道.js — 最小 Electron 判据跑道（在真壳里量 DOM 与窗口行为）。
//
// 为什么要有它（2026-08-31 内部评审 S19）：
// 上一份验收单里写着一条「明写的盲区」——
//   「无头 Electron 窗口 visibilityState 恒为 hidden、不派发 rAF，
//     验了就是常态假绿 + 随机假红」。
// 评审拿六个探针在 Electron 30.5.1 / Chromium 124 上逐句证伪：
// visibilityState 是 visible、rAF 照常派发、布局是真的、pagehide 也触发。
//
// 后果是：本轮 DOM 最复杂的两块（记号栏的 sticky 表头 + 三档 @container 重排、
// 编辑器的锁/令牌/续租/冲突三路）**在一条 60 行探针就能推翻的技术判断上，
// 被免除了 DOM 级判据**。而项目自己的口径是 H104「落地只认机器判据跑绿」。
// **这块盲区不是环境给的，是那句话给的。**
//
// 这个文件是那句话的替代品：它在真壳里跑，能量 DOM、能量窗口尺寸、
// 能验 will-prevent-unload 这类"只在壳里才有"的行为。
//
// 用法：`node test/壳内/跑道.js`（它自己会拉起 electron，跑完退出，
// 结果按 TAP 风味打到 stdout，非零退出码即失败）。
// npm test 不带它——它要拉 GUI 进程，比纯 Node 判据慢一个量级；
// 换装仪式与手动复核时跑。
'use strict';
const { app, BrowserWindow } = require('electron');
const path = require('path');

// 被测窗口的最小尺寸常量必须与 main.js 同源，不许在这里再抄一个数
const 窗最小 = (() => {
  const fs = require('fs');
  const s = fs.readFileSync(path.join(__dirname, '..', '..', 'main.js'), 'utf8');
  const m = s.match(/const 窗最小 = \[(\d+), (\d+)\]/);
  if (!m) throw new Error('main.js 里找不到 窗最小 —— 这条跑道与它必须同源');
  return [Number(m[1]), Number(m[2])];
})();

const 结 = [];
const 记 = (名, 行, 说) => { 结.push({ 名, 行: !!行, 说: 说 || '' }); };

const 等 = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 改窗宽，**并等到渲染进程真的看见它**。
 *
 * setBounds 是异步的：主进程立刻返回，渲染进程要过一帧才拿到新的 innerWidth。
 * 第一版没等，于是量到的是上一次的宽度——S18③ 因此**假绿**：
 * 它「通过」不是因为按钮落在窗内，而是因为那一刻窗还是宽的。
 * 这正是今晚一直在抓的那种判据。
 */
async function 调宽(win, w) {
  const b = win.getBounds();
  win.setBounds({ x: b.x, y: b.y, width: w, height: b.height });
  for (let i = 0; i < 40; i++) {
    const 见 = await win.webContents.executeJavaScript('window.innerWidth');
    if (Math.abs(见 - w) <= 24) return 见;        // 减去边框，容 24px
    await 等(50);
  }
  return await win.webContents.executeJavaScript('window.innerWidth');
}

async function 跑() {
  process.env.NO_INTEL = '1';
  process.env.TERMINAL_SHIFT_DRY = '1';
  const { port } = await require('../../server').start();

  const win = new BrowserWindow({
    width: 1600, height: 1000,
    minWidth: 窗最小[0], minHeight: 窗最小[1],
    show: false,                       // 不亮屏：这是判据不是演示
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });

  // ── 一、先把「盲区声明」本身验掉 ──────────────────────────
  // 若这几条不成立，下面所有 DOM 判据都不可信 —— 所以它们排在最前面。
  await win.loadURL(`http://127.0.0.1:${port}/`);
  const 环境 = await win.webContents.executeJavaScript(`(async () => {
    const rAF = await new Promise((r) => {
      const t = setTimeout(() => r(false), 500);
      requestAnimationFrame(() => { clearTimeout(t); r(true); });
    });
    return {
      可见态: document.visibilityState,
      rAF,
      体宽: document.body.getBoundingClientRect().width,
      有布局: document.querySelector('.台') ? getComputedStyle(document.querySelector('.台')).display : null,
    };
  })()`);
  记('环境① show:false 的窗口 visibilityState 仍是 visible',
    环境.可见态 === 'visible', '实得 ' + 环境.可见态);
  记('环境② rAF 照常派发', 环境.rAF === true);
  记('环境③ 布局是真的（body 宽 > 0）', 环境.体宽 > 0, '实得 ' + 环境.体宽);
  记('环境④ 三栏骨架是 grid', 环境.有布局 === 'grid', '实得 ' + 环境.有布局);

  // ── 二、S18：半屏塔真的窄得下来 ───────────────────────────
  // minWidth 会**静默钳位** setBounds。这条在浏览器里复现不了（浏览器没有 minWidth），
  // 而它的后果是形态钮落在屏外、点不着、回不去全屏。
  win.setBounds({ x: 100, y: 100, width: 1200, height: 800 });
  win.setMinimumSize(360, 200);                 // main.js 进塔前做的正是这一步
  await 调宽(win, 460);
  const 塔宽 = win.getBounds().width;
  记('S18① 松开 minWidth 之后，setBounds(460) 真的生效', 塔宽 === 460, '实得 ' + 塔宽);

  win.setMinimumSize(窗最小[0], 窗最小[1]);      // 回全屏时装回去
  await 调宽(win, 460);
  const 夹后 = win.getBounds().width;
  记('S18② 装回 minWidth 之后它确实还在夹（证明上一条不是白测）',
    夹后 === 窗最小[0], '实得 ' + 夹后 + '，应为 ' + 窗最小[0]);

  // 塔态下形态钮要落在窗内 —— 那是唯一的回程
  win.setMinimumSize(360, 200);
  await win.webContents.executeJavaScript(`document.querySelector('.台').classList.add('塔'); true`);
  const 真宽 = await 调宽(win, 460);
  const 钮 = await win.webContents.executeJavaScript(`(() => {
    const b = document.getElementById('形态钮');
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { 右: Math.round(r.right), 窗宽: window.innerWidth };
  })()`);
  // **先证明窗真的窄下来了**，否则「按钮在窗内」这句话是在宽窗上说的，等于没说
  记('S18③a 渲染进程真的看见了窄下来的窗（不然下一条是在宽窗上测的）',
    真宽 <= 470, '渲染进程量到 innerWidth=' + 真宽);
  记('S18③b 塔态下形态钮落在窗内（它是唯一的回程）',
    !!(钮 && 钮.右 <= 钮.窗宽), 钮 ? `右缘 ${钮.右} / 窗宽 ${钮.窗宽}` : '找不到形态钮');
  await win.webContents.executeJavaScript(`document.querySelector('.台').classList.remove('塔'); true`);
  win.setMinimumSize(窗最小[0], 窗最小[1]);
  await 调宽(win, 1400);

  // ── 三、S17：一脏之后 Ctrl+R 与关窗还走不走得动 ──────────
  // beforeunload 命中后 Electron 问主进程 will-prevent-unload，没人接就默认拒绝：
  // 不弹框、不报错、页面连闪都不闪。这条在浏览器里也复现不了（Chrome 会弹原生确认）。
  let 接住了 = false;
  const 接 = (e) => { 接住了 = true; e.preventDefault(); };
  win.webContents.on('will-prevent-unload', 接);
  await win.webContents.executeJavaScript(
    `window.addEventListener('beforeunload', (e) => { e.preventDefault(); e.returnValue = ''; }); true`,
  );
  // **先给一次真实的用户交互。**Chromium 的规矩：没有 sticky activation 时
  // beforeunload 一律被忽略——不制造这一下的话，will-prevent-unload 根本不会触发，
  // 而判据会「通过」，因为重载本来就没被拦。第一版就是这么假绿的。
  win.webContents.sendInputEvent({ type: 'mouseDown', x: 40, y: 300, button: 'left', clickCount: 1 });
  win.webContents.sendInputEvent({ type: 'mouseUp', x: 40, y: 300, button: 'left', clickCount: 1 });
  await 等(200);
  const 重载完 = await new Promise((res) => {
    const t = setTimeout(() => res(false), 8000);
    win.webContents.once('did-finish-load', () => { clearTimeout(t); res(true); });
    win.webContents.reload();
  });
  记('S17① 页面挂了 beforeunload 之后，重载仍然走得通', 重载完,
    重载完 ? '' : '**重载被静默吞掉了**——不弹框、不报错、页面连闪都不闪');
  // **这一条是上一条的前提**：拦截若根本没触发，上一条的「通过」就什么都没证明。
  记('S17② will-prevent-unload 确实触发了（否则上一条是在验空气）', 接住了,
    接住了 ? '（拦截触发了，而重载仍然完成 —— 两件事都成立才算数）'
      : '没触发 —— 多半是没造出 sticky activation，这一轮的 S17① 不算数');
  win.webContents.off('will-prevent-unload', 接);

  // ── 四、DOM 级：记号栏在窄容器里的重排 ────────────────────
  // 这一块与编辑器是本轮 DOM 最复杂的两处，此前因为那句「盲区」而完全没有判据。
  const 稿 = await win.webContents.executeJavaScript(`(async () => {
    const r = await fetch('/doc?frag=1').then((x) => x.text());
    const d = document.createElement('div');
    d.innerHTML = r;
    document.body.appendChild(d);
    const 容 = d.querySelector('.稿容');
    const 台 = d.querySelector('.稿台');
    if (!容 || !台) return { 有: false };
    const 宽 = (w) => { 容.style.width = w + 'px'; return getComputedStyle(台).gridTemplateColumns; };
    const 宽屏 = 宽(1400);
    const 窄屏 = 宽(600);
    const 类筛 = d.querySelector('.类筛');
    const 溢 = 类筛 ? 类筛.scrollWidth - 类筛.clientWidth : -1;
    d.remove();
    return { 有: true, 宽屏, 窄屏, 类筛溢: 溢 };
  })()`);
  记('DOM① 文稿台片段在真壳里装得起来', 稿.有);
  if (稿.有) {
    记('DOM② 容器查询真的在重排（宽窄两态的列模板不一样）',
      稿.宽屏 !== 稿.窄屏, `宽 ${稿.宽屏} / 窄 ${稿.窄屏}`);
    记('DOM③ 类筛不再横向溢出（七颗钮里三颗曾经在栏外，且滚不动）',
      稿.类筛溢 <= 0, '溢出 ' + 稿.类筛溢 + 'px');
  }

  // ── 四·五、J3：顶条三格在真壳里量（2026-09-02 拆栏评审）─────────
  //
  // **这条是整套顶条规格唯一的保险，所以它先于版面落地。**
  // 评审那 462px 的宽度算术全部出自 Chrome；而本仓记着壳内 Chromium 124
  // 算错嵌套 flex 宽——exe 独有，浏览器与 devtools 都复现不了。
  // 顶条为此从 flex 改成了 grid 定轨，但「定轨就不会错」是个判断不是事实。
  // 无论 124 怎么算，只要有一格被挤出去，scrollWidth > clientWidth 就会红。
  //
  // 拆栏之后这条 44px 扛着 PRODUCT 原则一的三问，所以逐档还要验
  // 「三问各有一个真可见的元素」——按 data-问 认人，不按 id 猜：
  // 改 id 不会让判据静默失效，删掉 data-问 才会，那是有意的。
  const 量顶条 = () => win.webContents.executeJavaScript(`(() => {
    const q = (s) => document.querySelector(s);
    const 顶 = q('.顶'); const 况 = q('.顶况'); const 钮 = q('#形态钮');
    if (!顶 || !况) return { 有: false };
    const 可见 = (el) => {
      if (!el) return null;
      const cs = getComputedStyle(el); const r = el.getBoundingClientRect();
      return { 显: cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0,
               宽: Math.round(r.width), 右: Math.round(r.right) };
    };
    const 三问 = {};
    for (const k of ['活', '跑', '等']) 三问[k] = 可见(q('[data-问="' + k + '"]'));
    return {
      有: true, 窗: window.innerWidth,
      顶溢: 顶.scrollWidth - 顶.clientWidth,
      况溢: 况.scrollWidth - 况.clientWidth,
      三问, 钮: 可见(钮),
      // 年龄章绝不许被截掉：它是原则三「逾期会变重」的唯一载体
      章: (() => { const c = q('.闸章'); if (!c) return null;
        const r = c.getBoundingClientRect(); return { 宽: Math.round(r.width), 右: Math.round(r.right) }; })(),
    };
  })()`);

  for (const 目标 of [1600, 1280, 1100, 820, 460, 360]) {
    if (目标 < 窗最小[0]) win.setMinimumSize(360, 200);
    else win.setMinimumSize(窗最小[0], 窗最小[1]);
    const 真宽 = await 调宽(win, 目标);
    // **到不了的档要明说**，不许当成过了——静默跳过正是本仓反复吃亏的那件事
    if (Math.abs(真宽 - 目标) > 40) {
      记(`J3@${目标} 这一档达不到（屏宽不够，实得 ${真宽}）——本档未验`, true, '未验，非通过');
      continue;
    }
    const m = await 量顶条();
    记(`J3@${目标} 顶条不横向溢出`, m.有 && m.顶溢 <= 0, m.有 ? `溢出 ${m.顶溢}px` : '找不到 .顶');
    记(`J3@${目标} 读数区不横向溢出`, m.有 && m.况溢 <= 0, m.有 ? `溢出 ${m.况溢}px` : '');
    for (const [k, 名] of [['活', '活着没有'], ['跑', '在跑什么'], ['等', '谁在等我']]) {
      const v = m.有 && m.三问[k];
      记(`J3@${目标} 三问·${名} 有一个真可见的元素且落在窗内`,
        !!(v && v.显 && v.右 <= m.窗 + 1), v ? `宽 ${v.宽} 右缘 ${v.右} / 窗 ${m.窗}` : '找不到 [data-问]');
    }
    记(`J3@${目标} 形态钮落在窗内（塔态下它是唯一的回程）`,
      !!(m.有 && m.钮 && m.钮.显 && m.钮.右 <= m.窗 + 1),
      m.钮 ? `右缘 ${m.钮.右} / 窗 ${m.窗}` : '找不到形态钮');
    if (m.有 && m.章) {
      记(`J3@${目标} 年龄章没被截掉（它是"逾期会变重"的唯一载体）`,
        m.章.宽 > 0 && m.章.右 <= m.窗 + 1, `宽 ${m.章.宽} 右缘 ${m.章.右} / 窗 ${m.窗}`);
    }
  }

  // 塔态单独量一遍：main.js 把塔宽钳在 360–460，而**塔态永远 ≤820**，
  // 原来那两条 :not() 白名单求交只剩一个钟——三问一条都答不了，且那是常态不是边角。
  win.setMinimumSize(360, 200);
  await win.webContents.executeJavaScript(`document.querySelector('.台').classList.add('塔'); true`);
  const 塔宽实 = await 调宽(win, 420);
  const 塔 = await 量顶条();
  记('J3·塔 渲染进程真的看见了塔宽（不然下面几条是在宽窗上测的）', 塔宽实 <= 470, '实得 ' + 塔宽实);
  记('J3·塔 顶条不横向溢出', 塔.有 && 塔.顶溢 <= 0, 塔.有 ? `溢出 ${塔.顶溢}px` : '');
  for (const [k, 名] of [['活', '活着没有'], ['跑', '在跑什么'], ['等', '谁在等我']]) {
    const v = 塔.有 && 塔.三问[k];
    记(`J3·塔 三问·${名} 在塔态仍然可见`, !!(v && v.显 && v.右 <= 塔.窗 + 1),
      v ? `宽 ${v.宽} 右缘 ${v.右} / 窗 ${塔.窗}` : '找不到 [data-问]');
  }
  记('J3·塔 形态钮仍在窗内', !!(塔.钮 && 塔.钮.显 && 塔.钮.右 <= 塔.窗 + 1),
    塔.钮 ? `右缘 ${塔.钮.右} / 窗 ${塔.窗}` : '');
  await win.webContents.executeJavaScript(`document.querySelector('.台').classList.remove('塔'); true`);
  win.setMinimumSize(窗最小[0], 窗最小[1]);
  await 调宽(win, 1400);

  // ── 四·六、J4：**提前验拆栏那一天** ──────────────────────────
  //
  // 闸栏与脉栏要搬去独立页。搬走之后主壳里 `$('闸列')`、`$('计格')`、`$('塔况')`
  // 全是 null，而原来取数与画栏挤在同一个函数里——一句 `null.innerHTML` 就会让
  // **那一轮往后的整份 app.js 停止执行**：顶条永远停在 `—`，而且不报错、不白屏。
  // 这是本仓命名过的那类故障里最贵的一种，因为它看起来像"这一版什么都没做"。
  //
  // 所以在版面真拆之前，先在壳里把两栏摘掉，看顶条还刷不刷新。
  // 这条红了就说明拆栏那天会当场踩雷——而那天再发现，代价是一个晚上。
  const 摘 = await win.webContents.executeJavaScript(`(() => {
    for (const s of ['.闸栏', '.脉栏']) { const el = document.querySelector(s); if (el) el.remove(); }
    const 产 = document.getElementById('顶产');
    const 闸 = document.getElementById('顶闸');
    // 先擦掉，这样"还在原地"和"被重新写过"分得开
    if (产) 产.textContent = '__擦__';
    if (闸) 闸.innerHTML = '<b class="闸词">__擦__</b>';
    return { 摘掉了: !document.querySelector('.闸栏') && !document.querySelector('.脉栏') };
  })()`);
  记('J4① 两栏真的从 DOM 里摘掉了（不然下面几条是在完整壳上测的）', 摘.摘掉了);

  // 脉搏 10s 一拍、人闸 20s 一拍：等够一轮人闸，两格都会被重写
  await 等(23000);
  const 拆后 = await win.webContents.executeJavaScript(`(() => {
    const 产 = document.getElementById('顶产');
    const 闸 = document.getElementById('顶闸');
    return {
      产: 产 ? 产.textContent : null,
      闸: 闸 ? 闸.textContent : null,
      // 顶层脚本若在中途抛掉，后面这些接线就没绑上——用它当"整份脚本跑完了"的凭据
      有形态钮接线: !!document.getElementById('形态钮'),
      座位画了: !!document.querySelector('.座'),
    };
  })()`);
  记('J4② 两栏摘掉之后，顶条产线格仍在刷新（不是停在擦掉的那个值）',
    拆后.产 && 拆后.产 !== '__擦__', '实得「' + 拆后.产 + '」');
  记('J4③ 两栏摘掉之后，顶条人闸格仍在刷新',
    拆后.闸 && !/__擦__/.test(拆后.闸), '实得「' + 拆后.闸 + '」');
  记('J4④ 顶层接线没被中途抛掉的异常吃掉（在座条画出来了）',
    拆后.座位画了, '在座条 ' + (拆后.座位画了 ? '有席位' : '为空 —— app.js 多半停在某个 null 上'));

  await win.loadURL(`http://127.0.0.1:${port}/`);      // 摘过 DOM，后面的判据要干净的一份
  await 等(400);

  // ── 四·七、J5：「等你拍板」页的批量钮真的带走了自己那一组 ──────────
  //
  // 这一页相对那条 340px 的栏，多出来的唯一一件真东西就是「一次处置 N 单」。
  // **它上线当天就是个坏掉的按钮**：主壳里旧的左栏还在，而两处渲染的是
  // 同一份 闸分组.js 分出来的同一批组，组身 id 一模一样；
  // `getElementById` 拿到的是文档里第一个——栏里那个，折叠着、行数为 0。
  // 于是点下去不报错、不动、说框里什么都没有。
  //
  // 改法是组件找自己的子元素一律相对导航（closest → querySelector），
  // 不经过全文档 id 空间。这条判据钉的是**行为**：点完之后说框里的行数
  // 必须等于那一组的单数，所以拆栏之后（栏没了、撞车消失）它照样有意义。
  await win.loadURL(`http://127.0.0.1:${port}/?v=gate`);
  await 等(3000);
  const 批 = await win.webContents.executeJavaScript(`(async () => {
    const q = (s) => document.querySelector(s);
    const 页 = q('#闸页');
    if (!页) return { 有页: false };
    const b = 页.querySelector('.组批');
    if (!b) return { 有页: true, 有钮: false };
    const 组 = b.closest('.闸组');
    const 应有 = 组 ? 组.querySelectorAll('.闸行[data-号]').length : -1;
    const 框 = q('#说框'); if (框) 框.value = '';
    b.click();
    await new Promise((r) => setTimeout(r, 250));
    const v = 框 ? 框.value : '';
    return {
      有页: true, 有钮: true, 应有,
      条数: v.split('\\n').filter((x) => x.trim().startsWith('TK-') || /^\\s+\\S/.test(x)).length,
      非空: !!v.trim(),
      栏还在: !!q('.闸栏'),
      撞车: document.querySelectorAll('[id^="组身-"]').length > 0
         && document.querySelectorAll('[id^="闸页身-"]').length > 0,
    };
  })()`);
  记('J5① 「等你拍板」页在壳里装得起来', 批.有页);
  记('J5② 壳里有说框，所以批量钮要出（独立页没说框时它该藏起来）', 批.有页 && 批.有钮);
  记('J5③ 点批量钮之后说框**真的被填了**（这条红＝按钮是坏的）', !!批.非空);
  记('J5④ 带走的条数等于那一组的单数（拿错组会少或多）',
    批.有钮 && 批.条数 === 批.应有, `实得 ${批.条数} / 应有 ${批.应有}`);
  记('J5⑤ 页面的组身 id 与旧栏不撞名（aria-controls 指错元素是无声的）',
    !批.撞车 || 批.条数 === 批.应有,
    批.栏还在 ? '旧栏仍在场（拆栏是批三），靠相对导航避开' : '旧栏已拆，撞车不复存在');
  await win.loadURL(`http://127.0.0.1:${port}/`);
  await 等(400);

  // ── 四·八、J6：产线段并进监视页，两条路都真的画出来了 ──────────
  //
  // 主壳右边那条 300px 并到监视页。并过来之后要验的不是"有个框"，
  // 是**它真的取到数并画了**——首屏骨架由服务端出，数据由 public/监视.js 填，
  // 中间任何一环断掉，屏上就是一个空框配一句「读取中…」，而那是这一页最难查的样子。
  //
  // 两条路都要验：独立整页 /watch 与壳内片段 /?v=watch。**只验一条等于另一条是死的**。
  const 量产线 = () => win.webContents.executeJavaScript(`(() => {
    const q = (s) => document.querySelector(s);
    if (!q('#wpulse')) return { 有: false };
    const 数 = [...document.querySelectorAll('.wnum')].map((n) =>
      (n.querySelector('.k') || {}).textContent + '=' + (n.querySelector('.v') || {}).textContent);
    return {
      有: true, 抬头: (q('#wpulse-n') || {}).textContent || '',
      数, 事件流份数: document.querySelectorAll('.wev').length,
      // 跑龄那把尺必须来自 顶况.js，不能是本页自己再写一份
      同尺: !!(self.顶况 && typeof self.顶况.龄文 === 'function'),
    };
  })()`);

  for (const [名, 址] of [['独立整页', `http://127.0.0.1:${port}/watch`],
    ['壳内片段', `http://127.0.0.1:${port}/?v=watch`]]) {
    await win.loadURL(址);
    await 等(4500);
    const p = await 量产线();
    记(`J6·${名} 产线段在`, p.有);
    记(`J6·${名} 四数真的取到了（不是停在"读取中…"）`,
      p.有 && p.数.length === 4 && p.数.every((s) => /=\d+$/.test(s)), p.有 ? p.数.join(' · ') : '');
    记(`J6·${名} 抬头说得出在跑几个`, p.有 && /在跑|读不到/.test(p.抬头), p.有 ? p.抬头 : '');
    记(`J6·${名} 跑龄用的是 顶况.js 那把尺（不是本页另写一份）`, p.有 && p.同尺);
  }
  await win.loadURL(`http://127.0.0.1:${port}/`);
  await 等(400);

  // ── 五、滚动条：S16 那条 `*` 的真凶验证 ────────────────────
  const 滚 = await win.webContents.executeJavaScript(`(() => {
    const cs = getComputedStyle(document.documentElement);
    return { 宽: cs.scrollbarWidth || '(未设)' };
  })()`);
  记('S16① 全局没有把 scrollbar-width 设成 thin（那会关掉整族 ::-webkit-scrollbar）',
    滚.宽 !== 'thin', '实得 ' + 滚.宽);

  win.destroy();
  return 结;
}

app.whenReady().then(async () => {
  let 码 = 0;
  try {
    const 出 = await 跑();
    console.log('1..' + 出.length);
    出.forEach((x, i) => {
      console.log(`${x.行 ? 'ok' : 'not ok'} ${i + 1} - ${x.名}${x.说 ? '   # ' + x.说 : ''}`);
      if (!x.行) 码 = 1;
    });
    const 过 = 出.filter((x) => x.行).length;
    console.log(`# 壳内判据 ${过}/${出.length} 通过`);
  } catch (e) {
    console.log('not ok 1 - 跑道自己炸了：' + (e && e.stack ? e.stack : e));
    码 = 1;
  }
  app.exit(码);
});
