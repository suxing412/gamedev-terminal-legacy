// preload.js — 只开一扇窗：让页面能请壳改窗形。
//
// 暴露面刻意收到最小：一个方法、参数只有一个布尔。渲染层拿不到 require、拿不到 ipcRenderer 本体，
// 也就没法从页面里做别的事。这块屏将来会显示外部抓来的情报（M1 情报雷达），
// 那时页面上会有不受我控制的文本——**暴露面是现在定的，不是那时候再收**。
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('壳', {
  // true = 半屏塔（贴右侧竖条），false = 全屏工作台
  半屏: (开) => ipcRenderer.send('形态:半屏', !!开),
  在壳里: true,
});
