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

  const 段 = [];
  if (g.读不到) {
    段.push(`<div class="读不到">读不到监制台（${esc(g.因)}）<br>这一栏现在不可信，别拿它当"没事"。</div>`);
  } else if (!单.length) {
    段.push('<div class="组头">单据</div><div class="空态"><b>没有等你签的单</b>单据级人闸清空。</div>');
  } else {
    const 阈 = g.逾期阈值小时 || 24;
    段.push(`<div class="组头">单据 <b>${单.length}</b></div>`);
    段.push(单.map((d, i) => {
      const h = Number(d.停摆小时) || 0;
      const 级 = h >= 阈 * 3 ? ' 久2' : h >= 阈 ? ' 久1' : '';
      return `<button class="闸${级}" data-i="${i}" title="${esc(d.闸名 + ' · ' + (d.按钮 || ''))}">
        <span class="行1"><span class="号">${esc(d.id)}</span><span class="久">${时长文(h)}</span></span>
        <span class="题">${esc(d.title || '')}</span>
        <span class="谁">${esc(d.闸号)} ${esc(d.闸名)}</span>
      </button>`;
    }).join(''));
  }

  if (a.读不到) {
    段.push(`<div class="组头">机制</div><div class="读不到">读不到议程档（${esc(a.因)}）</div>`);
  } else if (机.length) {
    段.push(`<div class="组头">机制 <b>${机.length}</b><span>政策决定 · 读自议程档</span></div>`);
    段.push(机.map((d, i) => `<button class="闸 机" data-i="${单.length + i}" title="${esc(d.说明).slice(0, 300)}">
      <span class="行1"><span class="号">第 ${d.号} 条</span><span class="久">${esc(d.型名)}</span></span>
      <span class="题">${esc(d.题)}</span>
      <span class="谁">${esc(d.节)}</span>
    </button>`).join(''));
  }
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

// 事件的「种」。
//
// **只抹计数器，不抹别的数字。**首版是 `replace(/\d[\d.,:]*/g,'#')`——把所有数字都归一，
// 于是 `额度余额=10000` 与 `额度余额=10` 会被判成同一种、折成一行 `×2`：
// 用户既看不到余额跌到了 10，也不知道那一行显示的是哪一次的值。
// 那直接违反 PRODUCT.md 原则五「数字必须是真的」——
// **一个会因为折叠而悄悄变错的数字，比没有这个数字坏得多。**
// （异厂评审 2026-08-31 的击杀原文；同一条也解释了为什么
//   `部署 job=7411 重试=2` 与 `job=7412` 不该被合并。）
//
// 所以只归一**形状明确是计数器**的那几个键：seq / 序号 / no / id。
// 归一得少 = 折得少 = 屏上多几行；归一得多 = 悄悄吃掉真值。这两种错的代价不对称。
const 计数器键 = /\b(seq|序号|次序|no|id)(\s*[=:]\s*)\d+/gi;
const 事种 = (文) => String(文 || '')
  .replace(计数器键, '$1$2#')
  .replace(/\s+/g, ' ')
  .trim();

/**
 * 折叠(事们) → [{ 时, 文, 次, 起时 }]
 *
 * **连着的同种事件合成一行。**这一条是 2026-08-31 实测逼出来的：
 * 那一刻 /api/events 回 40 条，**去重后只有一种**——
 * 常驻可见的那一整栏在用 40 行说同一句「还活着」。
 *
 * 而 PRODUCT.md 第一条原则是「状态先于叙述：活着 / 在跑什么 / 谁等我
 * 三问必须不用滚动、不用点击就能回答」。四十条心跳把「产线刚发生了什么」
 * 这一问的答案埋掉了——**它不是没答，是答案被同一句话刷屏刷没了**。
 *
 * 只折叠**相邻**的同种，不跨越中间插进来的别的事件：
 * 「心跳×20 → 一次失败 → 心跳×20」要看得出那次失败夹在中间，
 * 全局归并会把时序抹平，而时序正是事件流的全部价值。
 */
function 折叠(事们) {
  const 出 = [];
  for (const e of (事们 || [])) {
    const 种 = 事种(e.文);
    // 服务端可能已经折过一轮（它在更大的窗口上折，见 /api/events）。
    // 那边给的 次 要认下来，不能从 1 重新数——不然服务端折掉的那些就凭空少了。
    const 本次 = Number.isFinite(e.次) && e.次 > 0 ? e.次 : 1;
    const 尾 = 出[出.length - 1];
    if (尾 && 尾.种 === 种) {
      尾.次 += 本次;
      尾.起时 = e.起时 || e.时;        // 列表是新在前，所以后来的是更早的
      continue;
    }
    出.push({ 种, 时: e.时, 起时: e.起时 || e.时, 文: e.文, 次: 本次 });
  }
  return 出;
}

async function 拉近事() {
  let r;
  try { r = await fetch('/api/events').then((x) => x.json()); } catch { return; }
  const 列 = $('事列');
  if (r.读不到) { 若变('事', 列, `<div class="读不到">读不到流水（${esc(r.因)}）</div>`); return; }

  const 条 = 折叠(r.事 || []);
  const html = 条.length ? 条.map((e) => {
    const 重 = 重词.test(e.文) ? ' 重' : '';
    // 折起来的那些：一行讲清「同一件事、多少次、从什么时候到什么时候」
    const 计 = e.次 > 1
      ? `<b class="事计">×${e.次}</b><span class="事跨">${esc(e.起时)}→${esc(e.时)}</span>`
      : '';
    return `<div class="事${重}${e.次 > 1 ? ' 折' : ''}">`
      + `<time>${esc(e.时)}</time>`
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
  const 格 = 加话('总监', '');
  const 忙 = (文) => { 格.innerHTML = ''; const s = document.createElement('span'); s.className = '在跑'; s.innerHTML = '<i></i>'; s.append(文); 格.append(s); };
  忙('思考中…');

  let 文 = '';
  try {
    const res = await fetch('/api/say', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 话: 全 }),
    });
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
  else if (e.key >= '1' && e.key <= '9') 上带(Number(e.key) - 1);
});

// ---- 凭据与额度 ----
// 凭据过期时坐席开口就是 401。与其让人对着看不懂的报错猜，不如把还剩几分钟和那条命令摆在屏上。
async function 拉凭据() {
  let c;
  try { c = await fetch('/api/cred').then((x) => x.json()); } catch { return; }
  const 幅 = $('凭幅');
  $('顶凭').textContent = c.态 === '有效' ? `登录 ${Math.floor(c.剩余分 / 60)}h` : `登录${c.态}`;
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
  if (q.读不到) { $('顶额').textContent = '额度读不到'; return; }
  const 周 = ((q.claude || {}).windows || []).find((w) => w.label === '周');
  $('顶额').textContent = 周 ? `周额度 ${周.pct}%（${周.reset} 重置）` : '额度—';
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

async function 拉在座() {
  const 组 = $('座组');
  if (!组) return;
  let r;
  try { r = await fetch('/api/seats').then((x) => x.json()); }
  catch { 组.innerHTML = '<span class="座读不到">坐席名单读不到</span>'; return; }   // 说读不到，不编
  const 席 = (r && r.席) || [];
  if (!席.length) { 组.innerHTML = '<span class="座读不到">名单为空 —— 不是零席，是没配</span>'; return; }
  组.innerHTML = ['制作人'].concat(席.map((x) => x.名)).map((名) => {
    const s = 席.find((x) => x.名 === 名);
    const 未接 = s && !s.接模型;
    const 选 = 私聊席 === 名;
    return `<button class="座${选 ? ' 选' : ''}${未接 ? ' 未接' : ''}" data-seat="${名}"`
      + (名 === '制作人' ? ' disabled' : '') + `>`
      + `<i class="座灯"></i>${名}${未接 ? '<em>未接</em>' : ''}</button>`;
  }).join('');
}

$('座组') && $('座组').addEventListener('click', (e) => {
  const b = e.target.closest('.座');
  if (!b || b.disabled) return;
  const 名 = b.dataset.seat;
  私聊席 = (私聊席 === 名) ? null : 名;          // 再点一次＝回群
  document.querySelector('.台').classList.toggle('私聊中', !!私聊席);
  const 框 = $('说框');
  框.placeholder = 私聊席
    ? `只有${私聊席}看得见…（再点一次名字回群）`
    : '说点什么…（@ 点名某席，不点名则相关席应答）';
  $('说注').textContent = 私聊席
    ? `私聊 ${私聊席} · 这条线有自己的记忆，与群里那条各记各的`
    : 'Enter 发送 · Shift+Enter 换行 · @ 点名 · 数字键 1-9 选左栏';
  拉在座();
  框.focus();
});

拉人闸(); 拉脉搏(); 拉近事(); 拉凭据(); 拉额度(); 拉在座();
setInterval(拉人闸, 20000);
setInterval(拉脉搏, 10000);
setInterval(拉近事, 15000);
setInterval(拉凭据, 60000);
setInterval(拉额度, 300000);
