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
