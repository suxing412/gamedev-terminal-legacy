// 游戏开发者终端 · 坐席前端
//
// 纪律（PRODUCT.md 设计原则）：
//   ② 对话是主干道：说话区永远可用，取数失败不阻断它
//   ③ 等待中的事有固定住址：人闸栏不参与信息流，逾期变重但不闪
//   ④ 安静是默认：只有真变化才动 DOM（签名比对），不做无谓重绘
//   ⑤ 数字必须是真的：读不到就说读不到，绝不显示 0 冒充

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// 签名比对（原则④）：内容没变就一个字节都不碰 DOM——常驻整天，无谓重绘是打扰也是耗电
const 签 = {};
function 若变(键, 元, html) {
  if (签[键] === html) return false;
  签[键] = html; 元.innerHTML = html; return true;
}

const 时长文 = (小时) => {
  const h = Number(小时) || 0;
  if (h < 1) return Math.round(h * 60) + ' 分';
  if (h < 48) return h.toFixed(0) + ' 小时';
  return (h / 24).toFixed(1) + ' 天';
};
const 跑了 = (起) => {
  const t = Date.parse(起 || '');
  if (Number.isNaN(t)) return '';
  const m = Math.floor((Date.now() - t) / 60000);
  return m < 60 ? m + '′' : Math.floor(m / 60) + '° ' + (m % 60) + '′';
};

let 闸表 = [];

// ---- 左栏：人闸（单据级 + 机制级两组）----
// 两组都是「等你拍板」，但性质不同：单据级有单号有停摆时长，机制级是政策决定，没有单也没有钟。
// 分组不分栏——它们竞争的是同一件东西：你的一次判断。
//
// 2026-08-31 重做。实测这一栏摊着 61 个按钮（36 单 + 25 机制），一个 340px 宽的
// 常驻栏要滚将近四千像素才能看完——**它已经不是队列，是一堵墙**。两处实测：
//   ① 36 单里 36 单都逾期（阈 24h，中位 129h）。三档染色全落在最深那档，
//      于是"染色"表达的信息量正好是零：全红等于没红。
//   ② 同一闸位的 24 单，动作键完全相同（G3 全是"验收：通过归档／打回"）。
//      把它们摊成 24 个独立条目，是把**一次批量处置**误报成了 24 个待决定。
// 所以按闸位分组（单据）、按型分组（机制），组头讲这一组的动作与形状，
// 组可折叠且记住折叠态。数据没变，改的是它自称有多少件事。
// 分堆与折叠规则都在 public/闸分组.js（判据要 require 它，所以它们不能长在这个文件里）
const { 久档, 分闸组, 该收 } = self.闸分组;
const 顶况文 = self.顶况;          // 顶栏读数的写法，见 public/顶况.js
const 闸折键 = 'gt.闸折态';
function 读折() { try { const o = JSON.parse(localStorage.getItem(闸折键) || '{}'); return new Map(Object.entries(o)); } catch { return new Map(); } }
function 写折(m) { try { localStorage.setItem(闸折键, JSON.stringify(Object.fromEntries(m))); } catch { /* 隐私模式写不进，不值得为它报错 */ } }
let 折态 = 读折();
let 闸筛 = '全';

async function 拉人闸() {
  const [g, a] = await Promise.all([
    fetch('/api/gates').then((x) => x.json()).catch(() => ({ 读不到: true, 因: '坐席后端不通' })),
    fetch('/api/agenda').then((x) => x.json()).catch(() => ({ 读不到: true, 因: '坐席后端不通' })),
  ]);
  const 列 = $('闸列');

  const 单 = g.读不到 ? [] : (g.债 || []);
  const 机 = a.读不到 ? [] : (a.事 || []);
  闸表 = [...单.map((d) => ({ ...d, 类: '单' })), ...机.map((d) => ({ ...d, 类: '机' }))];

  const 总 = g.读不到 ? '读不到' : String(单.length + 机.length);
  $('闸数').textContent = g.读不到 ? '读不到' : `${单.length} 单 · ${机.length} 机制`;
  $('顶闸').textContent = 总;

  const 阈 = g.逾期阈值小时 || 24;
  const 段 = [];

  // 概览兼筛选。既然要在栏头说"多少件"，就让这句话同时能点——
  // 多一行 chip 换掉一个独立筛选面板，340px 宽的栏付得起这个价。
  if (!g.读不到 && (单.length + 机.length) > 8) {
    const chip = (k, 名, n) => `<button class="闸筛钮${闸筛 === k ? ' 选中' : ''}" data-筛="${k}"${n ? '' : ' disabled'} aria-pressed="${闸筛 === k}">${名}<b>${n}</b></button>`;
    段.push(`<div class="闸筛" role="group" aria-label="按类型筛选">
      ${chip('全', '全部', 单.length + 机.length)}${chip('单', '单据', 单.length)}${chip('机', '机制', 机.length)}
    </div>`);
  }

  // 一组的壳：组头（可折叠、报动作与形状）+ 组身。
  // 组头两行：第一行是身份（名 + 计数），第二行是**这一组要你做什么、烂到什么程度**。
  // 挤成一行量过——300px 宽的栏里名被截 46px、注被截 74px，
  // 而注那句正是这次分堆新增的全部价值，截掉了等于没做。
  const 画组 = (键, 名, 计, 注, 项们, 齐) => {
    const 收 = 该收(折态, 键, 计, 闸筛);
    return `<div class="闸组${齐 ? ' 齐久' : ''}">
      <button class="组头 可折" data-组="${esc(键)}" aria-expanded="${!收}" aria-controls="组身-${esc(键)}">
        <span class="头1">
          <span class="折箭" aria-hidden="true">${收 ? '▸' : '▾'}</span>
          <span class="组名">${esc(名)}</span><b>${计}</b>
        </span>
        <span class="组注">${注}</span>
      </button>
      <div class="组身" id="组身-${esc(键)}"${收 ? ' hidden' : ''}>${项们.join('')}</div>
    </div>`;
  };

  const 画单 = (d, i) => {
    const h = Number(d.停摆小时) || 0;
    const 档 = 久档(h, 阈);
    return `<button class="闸${档 ? ' 久' + 档 : ''}" data-i="${i}" title="${esc(d.闸名 + ' · ' + (d.指引 || d.按钮 || ''))}">
      <span class="行1"><span class="号">${esc(d.id)}</span><span class="久">${时长文(h)}</span></span>
      <span class="题">${esc(d.title || '')}</span>
    </button>`;
  };

  if (g.读不到) {
    段.push(`<div class="读不到">读不到监制台（${esc(g.因)}）<br>这一栏现在不可信，别拿它当"没事"。</div>`);
  } else if (!单.length) {
    段.push('<div class="组头 静">单据</div><div class="空态"><b>没有等你签的单</b>单据级人闸清空。</div>');
  }

  // 单据按闸位分（同闸位动作键相同 ⇒ 一次批量处置），机制按型分（型 = 这个决定要花多少脑子）。
  // 一次调用同时分两类，下标就只有一套——两次调用各算各的偏移量，
  // 是"带单带错一条"这类错的经典产地。
  if (!g.读不到 && (单.length || 机.length)) {
    for (const z of 分闸组(单, a.读不到 ? [] : 机, 阈, 闸筛)) {
      if (z.类 === '单') {
        const s = z.形;
        const 注 = `${z.动 ? esc(z.动) + ' · ' : ''}${s.逾期 === s.总 ? '全部逾期' : `${s.逾期} 逾期`}，最久 ${时长文(s.最久)}`;
        段.push(画组(z.键, z.名, z.计, 注, z.项.map((p) => 画单(p.d, p.i)), z.齐));
      } else {
        段.push(画组(z.键, z.名, z.计, `跨 ${z.节数} 节 · 读自议程档`, z.项.map(({ d, i }) => `<button class="闸 机" data-i="${i}" title="${esc(d.说明).slice(0, 300)}">
          <span class="行1"><span class="号">第 ${d.号} 条</span></span>
          <span class="题">${esc(d.题)}</span>
          <span class="谁">${esc(d.节)}</span>
        </button>`), false));
      }
    }
  }

  if (a.读不到) 段.push(`<div class="组头 静">机制</div><div class="读不到">读不到议程档（${esc(a.因)}）</div>`);
  若变('闸', 列, 段.join(''));
}

// ---- 右栏：脉搏 ----
async function 拉脉搏() {
  let r;
  try { r = await fetch('/api/pulse').then((x) => x.json()); } catch { r = { 读不到: true, 因: '坐席后端不通' }; }
  const 灯 = $('脉灯'); const 文 = $('脉文');
  if (r.读不到) {
    灯.className = '脉 断'; 文.textContent = '读不到 :4270';
    $('顶跑').textContent = '—';
    若变('计', $('计格'), '');
    若变('跑', $('跑列'), `<div class="读不到">读不到监制台（${esc(r.因)}）</div>`);
    return;
  }
  灯.className = '脉 活'; 文.textContent = '监制台在线';
  const c = r.计数 || {};
  const 跑 = r.在跑 || [];
  $('顶跑').textContent = 跑.length;

  const 格 = [
    ['在途', (c['在途'] || 0) + (c['初检'] || 0) + (c['核查'] || 0) + (c['仲裁'] || 0), 跑.length > 0],
    ['待派', (c['待派'] || 0) + (c['待重派'] || 0) + (c['已排期'] || 0), false],
    ['候验收', c['完成'] || 0, false],
    ['已落袋', c['归档'] || 0, false],
  ].map(([标, 值, 活]) =>
    `<div class="计"><div class="标">${标}</div><div class="值${值 ? (活 ? ' 活' : '') : ' 零'}">${值}</div></div>`).join('');
  若变('计', $('计格'), 格);

  const 跑html = 跑.length
    ? 跑.map((x) => `<div class="跑"><span class="号">${esc(x.单)}</span><span class="环">${esc(x.环节)}</span><span class="久">${跑了(x.起时)}</span></div>`).join('')
    : `<div class="跑"><span class="环">无在跑会话</span></div>`;
  const 拒 = (r.拒因 || []).length
    ? `<div class="跑"><span class="环" style="color:var(--warn)">上轮拒因 ${r.拒因.length} 项</span></div>` : '';
  若变('跑', $('跑列'), 跑html + 拒);

  // 塔形态的一行摘要：脉栏收了，但「产线活着没有」不能跟着丢
  const 在途 = (c['在途'] || 0) + (c['初检'] || 0) + (c['核查'] || 0) + (c['仲裁'] || 0);
  $('塔况').innerHTML = `在途 <b>${在途}</b> · 在跑 <b>${跑.length}</b> · 待派 <b>${(c['待派'] || 0) + (c['已排期'] || 0)}</b>`;
}

// ---- 右栏：事件流 ----
const 重词 = /失败|急件|滞留|上呈|三振|不过|裁决|落袋|归档|废弃/;

// 事种 与 折叠 都在 public/事流.js —— **四处共用同一份**：
// server.js 的 /api/events、这里、server/routes/监视.js、public/监视.js。
// 2026-08-31 当晚的教训：这套逻辑原本存了四份，那天治好了两份，
// 另外两份原封不动地继续刷屏。一个概念存四份，就一定会有一天只改了其中两份。
const 事流 = self.事流;
const { 事种, 折叠 } = 事流;

async function 拉近事() {
  let r;
  try { r = await fetch('/api/events').then((x) => x.json()); } catch { return; }
  const 列 = $('事列');
  if (r.读不到) { 若变('事', 列, `<div class="读不到">读不到流水（${esc(r.因)}）</div>`); return; }

  const 条 = 折叠(r.事 || []);
  // 今天的只写 HH:MM，别的日子带上 MM-DD。窗口是 600 行 ≈ 58 小时，
  // 而首版每行只有 HH:MM——实测一屏 51 组里 30 组不是当天，时刻局部递减而屏上毫无提示，
  // 跨午夜的折叠行还会显示成「23:03→02:13」，起点看着比终点晚。规则在 事流.刻()。
  const 今日 = r.今日 || '';
  let 上日 = null;
  const html = 条.length ? 条.map((e) => {
    const 重 = 重词.test(e.文) ? ' 重' : '';
    // 折起来的那些：一行讲清「同一件事、多少次、从什么时候到什么时候」
    const 计 = e.次 > 1
      ? `<b class="事计">×${e.次}</b><span class="事跨">${esc(事流.刻(e.起日, e.起时, 今日))}→${esc(事流.刻(e.日, e.时, 今日))}</span>`
      : '';
    // 日期一变插一条分隔——**每行都写日期太吵，一天写一次刚好**
    let 隔 = '';
    if (e.日 && e.日 !== 上日) {
      if (上日 !== null) 隔 = `<div class="日隔">${esc(e.日 === 今日 ? '今天' : e.日.slice(5))}</div>`;
      上日 = e.日;
    }
    return 隔 + `<div class="事${重}${e.次 > 1 ? ' 折' : ''}">`
      + `<time>${esc(事流.刻(e.日, e.时, 今日))}</time>`
      + `<span title="${esc(e.文)}">${esc(e.文)}</span>${计}</div>`;
  }).join('')
    // 空态要说清**是真的没事，不是读不到**——这两件事在值班屏上绝不能混
    : '<div class="事空">最近没有产线事件。<span>不是读不到，是真的没动静。</span></div>';
  若变('事', 列, html);
  $('脉时').textContent = new Date().toTimeString().slice(0, 5);
}

// ---- 中栏：对话 ----
let 带的单 = null;
function 加话(谁, 文, 类) {
  const d = document.createElement('div');
  d.className = '话' + (类 ? ' ' + 类 : '');
  d.innerHTML = `<div class="谁">${esc(谁)}</div><div class="文"></div>`;
  d.querySelector('.文').textContent = 文;
  $('话流').appendChild(d);
  $('话流').scrollTop = $('话流').scrollHeight;
  return d.querySelector('.文');
}

async function 说(话) {
  const 全 = 带的单 ? `关于 ${带的单}：${话}` : 话;
  加话('你', 全, '我');
  收带();
  // 私聊时答话的是那一席，不是总监。原来无论点了谁，回答都顶着「总监」的名字——
  // 而屏上同时亮着「私聊 情报主管」，两句话互相打脸。
  const 格 = 加话(私聊席 || '总监', '');
  const 忙 = (文) => { 格.innerHTML = ''; const s = document.createElement('span'); s.className = '在跑'; s.innerHTML = '<i></i>'; s.append(文); 格.append(s); };
  忙('思考中…');

  let 文 = '';
  try {
    const res = await fetch('/api/say', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      // 席 必须发出去。**不发就只是换了个皮**：2026-08-31 巡礼查出，
      // 私聊席 从头到尾只活在前端，服务端收到的每一条都走同一个会话、同一个人设，
      // 而说区底下那句「这条线有自己的记忆」是照设计稿写的，一个字都没兑现。
      body: JSON.stringify(私聊席 ? { 话: 全, 席: 私聊席 } : { 话: 全 }),
    });
    // 服务端把「参数不对」答成 400+JSON，不是 SSE。不先拦一道的话，
    // 下面那个 SSE 解析器会把整段 JSON 当成认不出的流块丢掉，
    // 屏上只剩一句「（无输出）」——**报错被解析器吃掉，是最难查的那一类**。
    if (!res.ok) {
      let 因 = `HTTP ${res.status}`;
      try { const j = await res.json(); if (j && j.error) 因 = j.error; } catch { /* 不是 JSON 就用状态码 */ }
      格.textContent = '（' + 因 + '）';
      return;
    }
    const rd = res.body.getReader(); const 解 = new TextDecoder();
    let 残 = '';
    for (;;) {
      const { done, value } = await rd.read();
      if (done) break;
      残 += 解.decode(value, { stream: true });
      const 块 = 残.split('\n\n'); 残 = 块.pop();
      for (const b of 块) {
        // 事件名是汉字（片/毕/活/崩），**不能用 \w 匹配**——\w 只认 ASCII，
        // 于是每一个事件都会被判为无名而丢掉，前端表现是永远停在「思考中」。
        const 类 = (b.match(/^event:\s*(\S+)/m) || [])[1];
        const 数 = (b.match(/^data: (.*)$/m) || [])[1];
        if (!类 || !数) { if (b.trim()) console.warn('坐席：认不出的流块，丢了', b.slice(0, 120)); continue; }
        let d; try { d = JSON.parse(数); } catch { console.warn('坐席：流块 JSON 解不开', 数.slice(0, 120)); continue; }
        if (类 === '活') { if (!文) 忙(d.做); }
        else if (类 === '片') { 文 += d.文; 格.textContent = 文; $('话流').scrollTop = $('话流').scrollHeight; }
        else if (类 === '毕') { if (d.全文 && d.全文.length > 文.length) 格.textContent = d.全文; }
        else if (类 === '崩') { 格.textContent = '（说不出话：' + d.因 + '）'; }
      }
    }
    if (!文 && !格.textContent.trim()) 格.textContent = '（无输出）';
  } catch (e) {
    格.textContent = '（连不上坐席后端：' + e.message + '）';
  }
  拉人闸(); 拉脉搏(); // 说完可能有写动作，立刻对账
}

function 上带(i) {
  const d = 闸表[i]; if (!d) return;
  带的单 = d.类 === '机' ? `议程第 ${d.号} 条` : d.id;
  $('带号').textContent = 带的单 + ' · ' + (d.类 === '机' ? d.题 : (d.title || ''));
  $('带').classList.add('显');
  $('说框').focus();
}
function 收带() { 带的单 = null; $('带').classList.remove('显'); }

// ---- 接线 ----
$('闸列').addEventListener('click', (e) => {
  const 头 = e.target.closest('.组头.可折');
  if (头) {
    // 当场翻，不等下一轮轮询——折叠是"我现在不想看这一堆"，
    // 让它等两秒才收起来，就等于每次都要怀疑自己有没有点上。
    const 键 = 头.dataset.组;
    const 收 = 头.getAttribute('aria-expanded') === 'true';   // 翻的是屏上此刻的样子，不是默认值
    折态.set(键, 收);
    写折(折态);
    头.setAttribute('aria-expanded', String(!收));
    头.querySelector('.折箭').textContent = 收 ? '▸' : '▾';
    const 身 = 头.parentElement.querySelector('.组身'); if (身) 身.hidden = 收;
    return;
  }
  const 筛钮 = e.target.closest('.闸筛钮');
  if (筛钮) { 闸筛 = 筛钮.dataset.筛; 拉人闸(); return; }
  const b = e.target.closest('.闸'); if (b) 上带(Number(b.dataset.i));
});
$('带撤').addEventListener('click', 收带);

const 框 = $('说框');
框.addEventListener('input', () => { 框.style.height = 'auto'; 框.style.height = Math.min(框.scrollHeight, 180) + 'px'; });
框.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    const v = 框.value.trim(); if (!v) return;
    框.value = ''; 框.style.height = 'auto';
    说(v);
  }
});
document.addEventListener('keydown', (e) => {
  if (e.target === 框) { if (e.key === 'Escape') { 框.value = ''; 框.blur(); } return; }
  if (e.key === '/') { e.preventDefault(); 框.focus(); }
  else if (e.key === 'F9') { e.preventDefault(); 换形态(!document.querySelector('.台').classList.contains('塔')); }
  // 数字键选的是**看得见的**第 N 条，不是 闸表 的第 N 项。
  // 分组折叠之后这两者会分家：折起来的那些还在 闸表 里，按 2 却带上一条屏幕上根本没有的单，
  // 就成了"点了有反应、但反应的不是你指的那个"——比没反应更难查。
  else if (e.key >= '1' && e.key <= '9') {
    const 见 = [...$('闸列').querySelectorAll('.闸')].filter((x) => x.offsetParent !== null);
    const 目 = 见[Number(e.key) - 1];
    if (目) 上带(Number(目.dataset.i));
  }
});

// ---- 凭据与额度 ----
// 凭据过期时坐席开口就是 401。与其让人对着看不懂的报错猜，不如把还剩几分钟和那条命令摆在屏上。
async function 拉凭据() {
  let c;
  try { c = await fetch('/api/cred').then((x) => x.json()); } catch { return; }
  const 幅 = $('凭幅');
  // 文案在 public/顶况.js（判据要 require 它）。
  // 原来这里是 `登录 ${Math.floor(c.剩余分/60)}h`——40 分钟写成「登录 0h」，
  // 而横幅的临期线是 30 分，于是 30–59 分之间顶栏喊 0、横幅说没事，同一份数据两种说法。
  $('顶凭').textContent = 顶况文.登录文(c.态, c.剩余分);
  $('顶凭').title = c.到期 ? `到期 ${c.到期}` : '';
  if (c.态 === '有效') { 幅.hidden = true; return; }
  $('凭文').textContent = c.态 === '过期'
    ? `登录已过期 ${Math.abs(c.剩余分)} 分钟——坐席说不了话，产线也不会派单。重登即恢复：`
    : c.态 === '临期'
      ? `登录还剩 ${c.剩余分} 分钟就到期（${c.到期}）。现在重登，省得半路断：`
      : `本机未登录（${c.因 || ''}）。跑这条：`;
  $('凭令').textContent = c.命令 || '';
  幅.hidden = false;
}

async function 拉额度() {
  let q;
  try { q = await fetch('/api/quota').then((x) => x.json()); } catch { return; }
  if (q.读不到) { $('顶额').textContent = '额度读不到'; $('顶额').title = ''; return; }
  // 两个窗口都报：5 小时那个决定「这一小时还干不干得动」，周那个决定「这周还能开几张单」。
  // 原来只报周窗口，还把整串重置时刻摆出来（实测 197px，占顶况的 31%），
  // 而真正会当场把人拦住的 5 小时窗口一个字都没有。
  // **整份窗口原样交出去**，这里不挑不筛——挑哪个、怎么写是 顶况.js 的事，
  // 在这里先滤一道就等于把同一个决定放在两处，而其中一处没有判据看着。
  const r = 顶况文.额度文((q.claude || {}).windows);
  $('顶额').textContent = r.文;
  $('顶额').title = r.详;
  $('顶额').classList.toggle('紧', !!r.紧);
}

$('凭抄').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('凭令').textContent); $('凭抄').textContent = '已复制'; }
  catch { $('凭抄').textContent = '手动选'; }
  setTimeout(() => { $('凭抄').textContent = '复制'; }, 2000);
});

// ---- 形态：半屏塔 ⟷ 全屏工作台（需求定案 Q4/Q8）----
// 选择记在 localStorage：值班屏重开一次就得重新摆一次形态，是很烦的那种烦。
const 塔键 = '终端.形态';
function 换形态(要塔, 记 = true) {
  document.querySelector('.台').classList.toggle('塔', 要塔);
  $('形态钮').textContent = 要塔 ? '全屏' : '半屏';
  if (记) { try { localStorage.setItem(塔键, 要塔 ? '塔' : '台'); } catch { /* 无痕模式就不记 */ } }
  // 在壳里才改窗形；浏览器里只换版式，不折腾窗口
  if (window.壳 && window.壳.半屏) window.壳.半屏(要塔);
}
$('形态钮').addEventListener('click', () => 换形态(!document.querySelector('.台').classList.contains('塔')));
try { if (localStorage.getItem(塔键) === '塔') 换形态(true, false); } catch { /* 读不到就用默认全屏 */ }

const 走钟 = () => { $('顶钟').textContent = new Date().toTimeString().slice(0, 5); };
走钟(); setInterval(走钟, 20000);

// ---- 在座条（2026-08-29：主页面即群聊，私聊从群里分出去）----
// 名单只有一处事实源：server/lib/坐席.js，经 /api/seats 下发。
// 前端**不许自己写死一份**——那正是坐席.js 头注要避免的三处各存一份。
let 私聊席 = null;
let 席况 = new Map();   // 名 → 接模型，点击时要用它判断这一位说不说得了话

const 群说注 = 'Enter 发送 · Shift+Enter 换行 · @ 点名 · 数字键 1-9 选左栏';

async function 拉在座() {
  const 组 = $('座组');
  if (!组) return;
  let r;
  try { r = await fetch('/api/seats').then((x) => x.json()); }
  catch { 组.innerHTML = '<span class="座读不到">坐席名单读不到</span>'; return; }   // 说读不到，不编
  const 席 = (r && r.席) || [];
  if (!席.length) { 组.innerHTML = '<span class="座读不到">名单为空 —— 不是零席，是没配</span>'; return; }
  席况 = new Map(席.map((x) => [x.名, !!x.接模型]));
  组.innerHTML = ['制作人'].concat(席.map((x) => x.名)).map((名) => {
    const s = 席.find((x) => x.名 === 名);
    const 未接 = s && !s.接模型;
    const 选 = 私聊席 === 名;
    // 未接的席位不 disabled：**disabled 的按钮点了完全没有反应**，
    // 而"点了没反应"正是这轮巡礼在到处抓的那种病。它照常接点击，
    // 只是回答"我还没接模型"——名单里有它是事实，它说不了话也是事实，两句都要说出口。
    return `<button class="座${选 ? ' 选' : ''}${未接 ? ' 未接' : ''}" data-seat="${esc(名)}"`
      + (名 === '制作人' ? ' disabled' : '')
      + (未接 ? ` title="${esc(名)}已登记但还没接模型，开不了私聊"` : '')
      + `>`
      + `<i class="座灯"></i>${esc(名)}${未接 ? '<em>未接</em>' : ''}</button>`;
  }).join('');
}

function 换私聊(名) {
  私聊席 = 名;
  document.querySelector('.台').classList.toggle('私聊中', !!私聊席);
  const 框 = $('说框');
  框.placeholder = 私聊席
    ? `只有${私聊席}看得见…（再点一次名字回群）`
    : '说点什么…（@ 点名某席，不点名则相关席应答）';
  $('说注').textContent = 私聊席
    ? `私聊 ${私聊席} · 这条线有自己的记忆，与群里那条各记各的`
    : 群说注;
  拉在座();
  框.focus();
}

$('座组') && $('座组').addEventListener('click', (e) => {
  const b = e.target.closest('.座');
  if (!b || b.disabled) return;
  const 名 = b.dataset.seat;
  // 未接模型的席位：**回答，而不是照常切进去**。
  // 原来点它一样进私聊态——顶边亮起、占位符改成「只有情报主管看得见」、
  // 底下写着「这条线有自己的记忆」，然后说一句话，答的还是总监。
  // 三句话里没有一句是真的。
  if (席况.has(名) && !席况.get(名)) {
    if (私聊席) 换私聊(null);            // 从别人的私聊里点过来，先老实回群
    $('说注').textContent = `${名} 还没接模型 —— 名单里有它，但它说不了话。私聊只对已接模型的席开着。`;
    b.classList.add('拒'); setTimeout(() => b.classList.remove('拒'), 900);
    return;
  }
  换私聊(私聊席 === 名 ? null : 名);      // 再点一次＝回群
});

拉人闸(); 拉脉搏(); 拉近事(); 拉凭据(); 拉额度(); 拉在座();
setInterval(拉人闸, 20000);
setInterval(拉脉搏, 10000);
setInterval(拉近事, 15000);
setInterval(拉凭据, 60000);
setInterval(拉额度, 300000);
