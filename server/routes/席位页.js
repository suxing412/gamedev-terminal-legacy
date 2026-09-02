// 席位页.js — 自定义席位（2026-09-02 批六，制作人拍板）。
//
// 制作人原话：「智能体协议就按照文档库里的，可以直接在自定义中跳转到文档库中开编辑器进行编辑」，
// 以及「把常驻坐席人格化一些…我希望他们保持专业性，但带有一定人格特征」。
//
// ── 这一页故意没有表单 ────────────────────────────────────────
// 改名、改人设、改人格、改边界，一律去文稿台改那份 .md。
// **协议档是这一席的唯一事实源**，页面只做两件事：把它摆出来、给一个「去改它」的按钮。
// 一个字段两个改法（这里一个输入框、文档里一份正文）就是两本账，
// 而两本账迟早会有一天只改了其中一本，且没有任何东西会报错。
//
// 唯一的写动作是「新建」，而它写的也只是一张**填空骨架**——
// 不替制作人写人设（设计内容由他主导，这是常设口径）。
'use strict';
const express = require('express');
const path = require('path');
const { 壳, 头 } = require('../render/页');
const { 转义, 渲染 } = require('../render/md');

/** 席名 → 文稿台的地址。协议档落在 terminal 根的 席位/ 下。 */
const 稿址 = (档) => `/doc?r=terminal&p=${encodeURIComponent('席位/' + 档)}`;

function 渲染表(名单, 选中) {
  return `<nav class="席表" aria-label="席位">
${名单.map((s) => {
    const 在 = s.名 === 选中;
    return `  <a class="席项${在 ? ' 在' : ''}" href="/seats?s=${encodeURIComponent(s.名)}"${在 ? ' aria-current="true"' : ''}>
    <span class="席头">${转义(s.名.slice(0, 1))}</span>
    <span class="席文">
      <span class="席名">${转义(s.名)}${s.自建 ? '<em class="席自建">自建</em>' : ''}</span>
      <span class="席态">${s.接模型 ? 转义(s.模型 || '已接模型') : '未接模型'}</span>
    </span>
  </a>`;
  }).join('\n')}
</nav>`;
}

/**
 * 共守段。**页级，不属于任何一席。**
 *
 * 首版把它渲染在 渲染详() 里，于是没选人的时候整段消失——而它恰恰是
 * 「这屋里所有人共同守的那条线」，没选人时更该看得见。J9④ 当场抓到。
 * 顺带也把语义摆正了：它跟左边选了谁没有关系。
 */
function 渲染共守(共守) {
  if (!共守) {
    return `<section class="席共守 未立">
  <div class="席段头"><h2>共守</h2><span>九席同一份 · 还没立</span></div>
  <p class="席注">全屋的底线（同事不是助手、会说「这条我判错了」、不谄媚不惊叫…）
  应当写在 <code>席位/_共守.md</code> 里。现在还没有那份文件。</p>
</section>`;
  }
  return `<section class="席共守">
  <div class="席段头"><h2>共守</h2><span>九席同一份 · 改这段等于改全屋</span>
    <a class="席共改" href="${转义(稿址('_共守.md'))}">去改 →</a></div>
  <div class="prose">${渲染(共守)}</div>
</section>`;
}

function 渲染详(s) {
  if (!s) {
    return `<div class="席空"><b>左边挑一席</b>看它自己的那一段。自建的席位可以直接去文稿台改；
      内建那七席的人设暂时写在 <code>server/lib/坐席.js</code> 里，还没搬进文档。</div>`;
  }
  const 头部 = `<header class="席详头">
  <div class="席详题">
    <span class="席头 大">${转义(s.名.slice(0, 1))}</span>
    <div>
      <h1>${转义(s.名)}${s.自建 ? '<em class="席自建">自建</em>' : '<em class="席内建">内建</em>'}</h1>
      <p class="席详设">${转义(s.人设 || '（协议里还没写那一句）')}</p>
    </div>
  </div>
  ${s.自建 && s.档
    ? `<a class="席改" href="${转义(稿址(s.档))}">在文稿台编辑 →</a>`
    : '<span class="席改 灰" title="内建席位的人设写在 server/lib/坐席.js 里，不从文档读">内建 · 不从文档读</span>'}
</header>`;

  const 接 = `<dl class="席事实">
  <div><dt>接模型</dt><dd>${s.接模型 ? '是' : '否'}</dd></div>
  <div><dt>模型</dt><dd>${转义(s.模型 || '—')}</dd></div>
  <div><dt>协议档</dt><dd>${s.档 ? `<code>席位/${转义(s.档)}</code>` : '<span class="灰">内建，无协议档</span>'}</dd></div>
</dl>`;

  const 本 = s.协议
    ? `<section class="席本席">
  <div class="席段头"><h2>本席</h2><span>只写这一席与别人不同的地方</span></div>
  <div class="prose">${渲染(s.协议)}</div>
</section>`
    : `<section class="席本席 无">
  <p class="席注">这一席是内建的，协议还没搬进文档。它此刻的人设写在
  <code>server/lib/坐席.js</code>：「${转义(s.人设 || '')}」</p>
</section>`;

  return `<article class="席详">${头部}${接}${本}</article>`;
}

function 挂(app, opts = {}) {
  const r = express.Router();
  const 坐席 = require('../lib/坐席');
  const 席位档 = require('../lib/席位档');
  const 目录 = () => (typeof opts.目录 === 'function' ? opts.目录() : opts.目录);

  r.get('/seats', (req, res) => {
    const 名单 = 坐席.名单();
    const 选 = String((req.query && req.query.s) || '').trim();
    const s = 名单.find((x) => x.名 === 选) || null;
    const 自建数 = 名单.filter((x) => x.自建).length;
    const body = `<section class="席页">
  <header class="席页头">
    <div class="席页题">
      <h1>席位</h1>
      <span class="席页数">${名单.length} 席 · ${名单.filter((x) => x.接模型).length} 接了模型 · ${自建数} 自建</span>
    </div>
    <form class="席建" method="post" action="/api/seat/new">
      <input class="席建名" name="name" maxlength="16" placeholder="新席叫什么" required>
      <button class="席建钮" type="submit">＋ 新建席位</button>
    </form>
  </header>
  <div class="席体">
${渲染表(名单, 选)}
${渲染详(s)}
  </div>
${渲染共守(席位档.共守(目录()))}
</section>`;
    res.type('html').send(壳({
      题: '席位 · 游戏开发者终端',
      头部: 头({ 当前: 'seats', 标题: '席位' }),
      样式: ['/prose.css', '/席位.css'],
      body,
    }));
  });

  // **路径与表单字段名都用 ASCII。**
  //
  // 路径：中文路径浏览器会发成 %E5%B8%AD…，而 Express 匹配的是未解码的 req.path ——
  // 2026-09-01 那条 `/api/doc/用途` 就是这么 404 的，症状是「点了没反应」。
  //
  // 字段名：首版写的是 `name="名"`，浏览器提交时会自己把键编码，所以点按钮能用；
  // **但任何不编码键的调用方（curl、判据、脚本）发过去就是丢**，
  // 而丢法是静默的：解析器给出一个没有那个键的对象，路由回「席名不能为空」，
  // 看着像"你没填"。同一族的坑今夜已经在路由路径、schema 键名、argv、shell 上各咬过一次。
  r.post('/api/seat/new', express.urlencoded({ extended: false }), (req, res) => {
    const 名 = String((req.body && req.body.name) || '').trim().slice(0, 16);
    if (!名) return res.status(400).send('席名不能为空');
    if (坐席.按名(名)) return res.status(409).send(`已经有一席叫「${名}」了`);
    const 出 = 席位档.建(目录(), 名);
    if (!出.行) return res.status(出.已在 ? 409 : 500).send(出.因);
    坐席.挂目录(目录());            // 清缓，让新席当场出现在名单里
    // 建完直接送去文稿台改它——**建一份空骨架然后把人留在原地，等于没建完**。
    res.redirect(302, 稿址(出.档));
  });

  app.use(r);
  return r;
}

module.exports = { 挂, 渲染表, 渲染详, 渲染共守, 稿址 };
