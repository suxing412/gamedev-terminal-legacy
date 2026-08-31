// stream.js — 原始流页的过滤（M1c · V2）
//
// 原生 JS，无框架（施工令 A4）。整页是服务端渲染好的，这里只做**显示与否**——
// 不重建 DOM、不请求数据。所以关掉 JS 这一页照样能读全，只是筛不了；
// 渐进增强的意思就是这个：**JS 是加分项，不是页面能不能读的前提**。
//
// **整个是一个可重复调用的 装()**：这一页有两种活法——独立打开（脚本随页面跑一次），
// 和被抠成片段塞进主页视图区（同一份 DOM 会被反复换掉）。
// 换片时 innerHTML 把旧节点连同监听一起丢了，缓存下来的 条/组 也成了游离节点。
// 视图.js 换完片会广播 `视图装好`，这里接住它重装一遍。空跑是正常的（不在本视图时）。
(function () {
function 装() {
  var 源 = document.getElementById('f-src');
  var 档 = document.getElementById('f-tier');
  var 入 = document.getElementById('f-in');
  var 数 = document.getElementById('f-count');
  if (!源 || !档 || !入) return;

  var 清 = document.getElementById('f-clr');
  var 空 = document.getElementById('f-empty');

  var 条 = Array.prototype.slice.call(document.querySelectorAll('.item'));
  var 组 = Array.prototype.slice.call(document.querySelectorAll('.grp'));

  function 刷() {
    var s = 源.value, t = 档.value, i = 入.checked;
    var 留 = 0;
    条.forEach(function (e) {
      var 中 = (!s || e.dataset.src === s)
        && (!t || e.dataset.tier === t)
        && (!i || e.dataset.in === '1');
      e.hidden = !中;
      if (中) 留++;
    });
    // 整组被筛空就把组标题一起收起来——留一个只剩标题的空组，会让人以为筛坏了
    组.forEach(function (g) {
      var 有 = g.querySelector('.item:not([hidden])');
      g.hidden = !有;
    });
    if (数) 数.textContent = 留 + ' 条' + (留 === 条.length ? '' : '（共 ' + 条.length + '）');

    // **全部筛空 ≠ 收起最后一个组。**上一版只做到了「组空就收起组标题」，
    // 全部组都空的时候这一层没人接住：整页除了筛选栏是一片空白，
    // 唯一的信号是右端 11px 的「0 条（共 33）」。
    // 隔壁文稿台为同一件事写过一句注释：「空白在值班屏上永远读作『它坏了』」——
    // 那条结论当时没传到这一页。
    var 有筛 = !!(s || t || i);
    if (清) 清.hidden = !有筛;
    if (空) {
      if (留 === 0 && 条.length > 0) {
        var 说 = [];
        if (s) 说.push('源＝' + s);
        if (t) 说.push('档位＝' + t);
        if (i) 说.push('只看已入报');
        空.textContent = '这 ' + 条.length + ' 条里，没有一条同时满足：' + 说.join(' · ')
          + '。数据是有的，是这组筛选把它们全挡住了。';
        空.hidden = false;
      } else {
        空.hidden = true;
      }
    }
  }

  function 清筛() {
    源.value = ''; 档.value = ''; 入.checked = false;
    刷();
    源.focus();
  }

  源.addEventListener('change', 刷);
  档.addEventListener('change', 刷);
  入.addEventListener('change', 刷);
  if (清) 清.addEventListener('click', 清筛);
  刷();
}

  装();
  document.addEventListener('视图装好', 装);
})();
