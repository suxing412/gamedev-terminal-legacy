// 群聊.js — 服务端渲染群聊页与唯一的终端侧发言入口。
const express = require('express');
const 线程 = require('../lib/线程');
const 路由 = require('../lib/路由');
const 坐席 = require('../lib/坐席');
const { 壳, 头 } = require('../render/页');
const { 转义 } = require('../render/md');

const 无模型 = async () => '';
const 正文 = (条) => String((条 && (条.text ?? 条.文 ?? 条.content)) || '');
const 时刻 = (条) => String((条 && (条.t ?? 条.时间 ?? '')) || '');
const 回文 = (值) => typeof 值 === 'string' ? 值.trim() : String((值 && (值.文 ?? 值.text)) || '').trim();

function 渲染({ 消息 = [], 读不到 = false }) {
  const 席位 = 坐席.全部.map((席) => `<li class="chat-seat" data-seat="${转义(席.名)}">
  <strong>${转义(席.名)}</strong>${席.接模型 ? '' : '<span class="phase">第二期</span>'}
  <span>${转义(席.人设)}</span>
</li>`).join('');
  const 记录 = 消息.map((条) => `<li class="chat-message">
  <div class="chat-message-meta"><strong>${转义(线程.发言人(条))}</strong><time>${转义(时刻(条))}</time></div>
  <p>${转义(正文(条))}</p>
</li>`).join('');
  const 空 = 读不到
    ? '<section class="empty"><h1>读不到监制台</h1><p class="hint">线程暂时不可读；页面仍可打开，未把它伪装成 0 条。</p></section>'
    : (记录 || '<section class="empty"><h1>群聊还没有发言</h1><p class="hint">监制台线程为空，不是页面出错。</p></section>');
  return `<section class="chat-layout">
  <aside class="chat-roster"><h1>坐席</h1><ul>${席位}</ul></aside>
  <section class="chat-main">
    <div class="chat-note">群聊发言是意见，不会调用 /api/act/* 改台账。</div>
    <ul class="chat-messages">${空}</ul>
    <form id="chat-form" class="chat-form">
      <label for="chat-text">以制作人身份发言（@职能 或 @全体）</label>
      <textarea id="chat-text" name="文" rows="3" required></textarea>
      <div><button type="submit">发送意见</button><output id="chat-result" aria-live="polite"></output></div>
    </form>
  </section>
</section>`;
}

function 挂(app, 选项 = {}) {
  const r = express.Router();
  const origin = 选项.origin;
  const 调用模型 = 选项.调用模型 || 无模型;

  r.get('/chat', async (req, res) => {
    const 读 = await 线程.读全量({ origin });
    res.status(200).type('html').send(壳({
      题: '群聊',
      头部: 头({ 当前: 'chat', 标题: '群聊' }),
      body: 渲染(读.读不到 ? { 读不到: true } : 读),
      脚本: '<script src="/群聊.js"></script>',
    }));
  });

  r.post('/api/chat', async (req, res) => {
    const 发言人 = String((req.body || {}).发言人 || '制作人').trim();
    const 文 = String((req.body || {}).文 || '').trim();
    if (!文) return res.status(400).json({ ok: false, 因: '正文不能为空' });

    const 计划 = 路由.规划({ 发言人, 文 });
    if (!计划.ok) return res.status(400).json({ ok: false, 拒绝: true, 因: 计划.因 });
    const 写入 = await 线程.追加({ 发言人, 文 }, { origin });
    if (!写入.ok) return res.status(502).json({ ok: false, 因: 写入.因 || '写入监制台失败' });

    let 本轮;
    try { 本轮 = await 路由.调用一轮({ 发言人, 文, 调用: 调用模型, 计划 }); }
    catch (e) { return res.status(502).json({ ok: false, 因: e.message || '模型调用失败' }); }
    if (!本轮.ok) return res.status(502).json({ ok: false, 因: 本轮.因 || '模型调用失败' });

    const 应答 = [];
    for (const 一项 of 本轮.结果.filter((x) => x.坐席 !== '助理')) {
      const 答 = 回文(一项.返回);
      if (!答) continue;
      const 追加 = await 线程.追加({ 发言人: 一项.坐席, 文: 答 }, { origin });
      if (!追加.ok) return res.status(502).json({ ok: false, 因: 追加.因 || '应答写入监制台失败' });
      应答.push({ 发言人: 一项.坐席, 文: 答 });
    }
    res.json({ ok: true, 调用名单: 本轮.唤起.map((x) => x.名), 应答 });
  });

  app.use(r);
  return r;
}

module.exports = { 挂, 渲染 };
