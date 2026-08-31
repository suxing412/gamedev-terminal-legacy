// main.js — 游戏开发者终端 · Electron 桌面壳
//
// 这块屏要常驻全屏挂在显示器上，所以壳的取向和普通应用不同：
//   · 开窗即最大化，菜单栏自动隐藏——值班屏上一条永远用不到的菜单栏就是噪声
//   · F11 全屏 / Esc 退全屏 / Ctrl+R 重载，三个键就够，不做完整菜单
//   · 单实例：双击第二次不再起第二个服务，而是把已开的窗拉到前面
//   · 底色写死成样式表的 --ground，暗色下启动不闪白（监制台 0.30.x 踩过）
const path = require('path');
// **globalShortcut 不在这份导入里，是刻意的。**
// 它是系统级独占注册：注册了 Esc，整台机器的 Esc 就都归这个进程，
// 而这块屏是开机自启、整天在跑的——等于把那个键从所有程序手里拿走。
// 08-30 就这么把制作人的 Esc 吞了一整天（详见 createWindow 里那段）。
// 要局部快捷键走 webContents 的 before-input-event；想用 globalShortcut 得先把它加回这一行，
// 那时请先回答：这个键值得从整台机器上抢走吗？
const { app, BrowserWindow, shell, ipcMain, screen } = require('electron');

// ---- 登录自启的命令行口（--install / --uninstall / --autostart-status）----
// 在 Electron 起窗之前处理：这三个是一次性命令，不该顺带开一个窗。
// 制作人令「终端默认进程永远跟着主机进程走，只要不关机永远存在」的落点。
{
  const 参 = process.argv.slice(1);
  const 有 = (k) => 参.includes(k);
  if (有('--install') || 有('--uninstall') || 有('--autostart-status')) {
    const 自启 = require('./server/lib/自启');
    let r;
    // 显式把 portable 启动器注入的两个变量传下去（缺省时 lib 内还会再回落一次，双保险）。
    // 为什么显式传：让「自启注册的是哪个 exe」这件事在调用点就看得见，
    // 而不是藏在 lib 里一个 `||` 链的第二项。
    if (有('--install')) {
      r = 自启.装({
        exe: process.env.PORTABLE_EXECUTABLE_FILE,
        工作目录: process.env.PORTABLE_EXECUTABLE_DIR,
        dry: 有('--dry'),
      });
    } else if (有('--uninstall')) r = 自启.卸({});
    else r = 自启.查();

    const 文 = JSON.stringify(r, null, 2);
    process.stdout.write(文 + '\n');

    // **portable 的 NSIS 壳是 GUI 子系统（portable.nsi:12 SetSilent silent），没有控制台附着**——
    // 上面这行 stdout 在 exe 形态下没有出口，人看不到注册结果，验收就无从做起。
    // 所以回执必须落一份到盘上。落点跟数据根同一处，理由同 server.js 的 终端根：
    // 显式 TERMINAL_ROOT > portable 的 exe 所在目录 > execPath 目录。
    // **绝不能落进 %TEMP%**——那正是本次要修的病，回执跟着一起消失就白写了。
    try {
      const fs = require('fs');
      const 根 = process.env.TERMINAL_ROOT
        || process.env.PORTABLE_EXECUTABLE_DIR
        || path.dirname(process.execPath);
      fs.writeFileSync(path.join(根, '自启-回执.json'),
        JSON.stringify({ 时刻: new Date().toISOString(), 命令行: 参, 结果: r }, null, 2), 'utf8');
    } catch (e) {
      // 回执写不下也不该让注册本身失败——注册结果以 r 为准。
      process.stdout.write('（回执落盘失败：' + ((e && e.message) || e) + '）\n');
    }
    // app 可能还没 ready，直接退进程比 app.quit() 稳
    process.exit(r && r.ok === false ? 1 : 0);
  }
}

// server 延迟 require（照监制台 2026-08-22 体检 #63 的成例）：
// 抢不到单实例锁、马上要退出的那一份，不该先把端口占了。
const start = (...a) => require('./server').start(...a);

// Win11 Fluent 滚条不吃 ::-webkit-scrollbar 自定义（监制台 0.30.6 案：
// 细滚条样式在壳里从未生效过，页面上永远是带箭头的原生粗条）——关掉该特性。
if (app && app.commandLine) app.commandLine.appendSwitch('disable-features', 'FluentScrollbar,FluentOverlayScrollbar');

let win = null;
let 端口 = null;

async function createWindow() {
  const r = await start();
  端口 = r.port;

  win = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1100,          // 三栏在这个宽度以下会挤，低于它不如让人拖大
    title: '游戏开发者终端',
    autoHideMenuBar: true,
    backgroundColor: '#181a1d',   // ≈ style.css 的 --ground，暗色启动不闪白
    show: false,                  // 等 ready-to-show 再显，避免先白后暗那一下
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),  // 只暴露一个「改窗形」的方法
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // ── 三个键：F11 全屏 / Esc 退全屏 / Ctrl+R 重载 ──
  //
  // **走 before-input-event，绝不用 globalShortcut。**
  //
  // 2026-08-30 23:05 制作人报「ESC 失灵，重启和换键盘都没用」。是这里。
  // 原实现是 `globalShortcut.register('Escape', () => { if (win.isFocused()) … })`，
  // 注释还写着「注册成局部快捷键（窗口聚焦时才生效），不抢全局」——
  // **注释说的是意图，代码干的是另一件事**：globalShortcut 是系统级独占注册，
  // 那个 isFocused() 只挡住了「动作」，挡不住「按键被吞」。
  // 于是只要终端在跑，Esc / F11 / Ctrl+R 在**所有程序**里都是死的：Unity、浏览器、编辑器。
  //
  // 它之所以现在才发作：08-29 之前终端要手动打开，失灵只在那段时间；
  // 08-29 把它挂上开机自启之后，它一直在跑——于是「重启没用（自启回来了）、
  // 换键盘没用（根本不是键盘）」两条现象同时成立，把人引向硬件方向。
  //
  // before-input-event 只在本窗口聚焦时收到按键，从不向系统申领任何键。
  // 而且**不该拦的不拦**：非全屏态下的 Esc 不 preventDefault，页面里该收到它照样收到。
  win.webContents.on('before-input-event', (e, input) => {
    if (!win || input.type !== 'keyDown') return;
    const k = input.key;
    if (k === 'F11') {
      win.setFullScreen(!win.isFullScreen());
      e.preventDefault();
    } else if (k === 'Escape') {
      // 只有真在全屏时才吃掉它；否则放行给页面
      if (win.isFullScreen()) { win.setFullScreen(false); e.preventDefault(); }
    } else if ((input.control || input.meta) && (k === 'r' || k === 'R')) {
      win.webContents.reloadIgnoringCache();
      e.preventDefault();
    }
  });

  // 形态切换（需求定案 Q4/Q8：半屏情报塔 ⟷ 全屏工作台，与 Unity/浏览器共存）。
  // 半屏不是「窗口变窄」而是**贴屏右缘的一根竖条**：它要能和 Unity 并排而不互相盖，
  // 所以走 workArea 定位（避开任务栏），并置顶——不置顶的话点一下 Unity 它就沉下去，
  // 那就不叫常驻了。全屏态不置顶，免得挡住别的窗。
  ipcMain.removeAllListeners('形态:半屏');
  ipcMain.on('形态:半屏', (e, 开) => {
    if (!win) return;
    const wa = screen.getPrimaryDisplay().workArea;
    if (开) {
      if (win.isFullScreen()) win.setFullScreen(false);
      if (win.isMaximized()) win.unmaximize();
      const w = Math.max(360, Math.min(460, Math.round(wa.width * 0.22)));
      win.setBounds({ x: wa.x + wa.width - w, y: wa.y, width: w, height: wa.height });
      win.setAlwaysOnTop(true, 'normal');
    } else {
      win.setAlwaysOnTop(false);
      win.maximize();
    }
  });

  // 换版必清缓存（监制台 0.17.2 实测）：asar 文件 mtime 恒定 + Chromium 磁盘缓存跨重启持久
  // → 换了新版却还是旧 UI，且看不出任何异常。
  try { await win.webContents.session.clearCache(); } catch { /* 清不掉也照常启动 */ }

  win.once('ready-to-show', () => { win.maximize(); win.show(); });
  win.loadURL(`http://127.0.0.1:${端口}`);

  // 外部链接交给系统浏览器，别在值班屏里开出一个没有地址栏的网页
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  win.on('closed', () => { win = null; });
}

// 单实例：第二次双击把已开的窗拉到前面，不起第二个服务
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });

  app.whenReady().then(() => { createWindow(); });

  app.on('window-all-closed', () => { app.quit(); });
}
