// 群聊页只用原生 DOM：提交后刷新读取监制台的追加结果，不维护本地线程副本。
//
// **发完不整页 reload**（2026-08-31 改）。原来那行 `window.location.reload()` 有两个毛病：
//   ① 这一页会被抠成片段塞进主页视图区，整页 reload 会把**整个壳**一起冲掉——
//      人闸队列、产线脉搏、正在编辑的文稿，全部重来
//   ② 文稿台上线后更要命：在编辑器里打了半天字，随口在群里说一句，编辑器就没了
// 改成只重取这一页的片段。独立打开时没有视图区，那时才回落到 reload。
(() => {
  function 装() {
    const form = document.getElementById('chat-form');
    const text = document.getElementById('chat-text');
    const result = document.getElementById('chat-result');
    if (!form || !text || !result) return;
    if (form.dataset.绑过 === '1') return;      // 换片会重新执行，别绑第二遍
    form.dataset.绑过 = '1';

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const 文 = text.value.trim();
      if (!文) return;
      result.textContent = '发送中…';
      try {
        const r = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 文 }),
        });
        const body = await r.json();
        if (!r.ok || !body.ok) throw new Error(body.因 || '发送失败');
        text.value = '';
        result.textContent = '已发出';
        await 只刷这一页();
      } catch (e) {
        result.textContent = e && e.message ? e.message : '发送失败';
      }
    });
  }

  // 只换视图区里这一页的内容。取不到就退回整页 reload——
  // **宁可冲掉壳，也不能让人以为发出去了却看不到自己那条。**
  async function 只刷这一页() {
    const 区 = document.getElementById('视图区');
    if (!区 || 区.hidden) { window.location.reload(); return; }
    try {
      const 路 = (location.search.match(/[?&]v=([^&]+)/) ? '/chat' : location.pathname) || '/chat';
      const r = await fetch(路 + (路.includes('?') ? '&' : '?') + 'frag=1');
      if (!r.ok) throw new Error('HTTP ' + r.status);
      区.innerHTML = await r.text();
      document.dispatchEvent(new CustomEvent('视图装好', { detail: { 视图区: 区 } }));
    } catch (e) {
      window.location.reload();
    }
  }

  装();
  document.addEventListener('视图装好', 装);
})();
