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
  // **元素不在就当没这回事。**拆栏（2026-09-02）之后闸栏与脉栏搬去了独立页，
  // 主壳里这些 id 全是 null；不挡这一下，一个 null.innerHTML 会把整轮取数打断，
  // 而表现是「顶条永远停在 —，且不报错」。
  if (!元) return false;
  if (签[键] === html) return false;
  签[键] = html; 元.innerHTML = html; return true;
}

const 时长文 = (小时) => {
  const h = Number(小时) || 0;
  if (h < 1) return Math.round(h * 60) + ' 分';
  if (h < 48) return h.toFixed(0) + ' 小时';
  return (h / 24).toFixed(1) + ' 天';
};
// 跑龄的写法（跑了）随脉栏一起搬走了：现在 public/顶况.js 的 龄文 是唯一那把尺，
// 顶条的产线格与监视页的产线段都用它。留一份不用的在这里，就是留了第二把尺。

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
// 分堆规则在 public/闸分组.js（判据要 require 它，所以它不能长在这个文件里）。
// **折叠态与筛选态跟着栏一起搬走了**（现在归 public/人闸.js），
// 这里只剩顶条那一格要用的：分堆 + 久档。
const { 久档, 分闸组 } = self.闸分组;
const 顶况文 = self.顶况;          // 顶栏读数的写法，见 public/顶况.js

async function 拉人闸() {
  const [g, a] = await Promise.all([
    fetch('/api/gates').then((x) => x.json()).catch(() => ({ 读不到: true, 因: '坐席后端不通' })),
    fetch('/api/agenda').then((x) => x.json()).catch(() => ({ 读不到: true, 因: '坐席后端不通' })),
  ]);
  const 单 = g.读不到 ? [] : (g.债 || []);
  const 机 = a.读不到 ? [] : (a.事 || []);
  闸表 = [...单.map((d) => ({ ...d, 类: '单' })), ...机.map((d) => ({ ...d, 类: '机' }))];
  const 阈 = g.逾期阈值小时 || 24;
  if (!g.读不到) 取数时.gates = Date.now();      // 陈旧哨的打点：只在真取到时盖章

  // **顶条先写，页面后画。**这两件事必须分开，理由是拆栏（2026-09-02）：
  // 那一栏搬去独立页之后，`$('闸列')` 在主壳里是 null；
  // 而原来这两件事挤在同一个函数里，取到 null 的那一行会抛，
  // 于是**顶条永远停在 `—`，而且不报错**——「静止的活人」的教科书写法。
  // 现在顶条这一路不碰任何栏内元素，画栏那一路自己判在不在。
  写顶闸(g, 单, 阈);
  // 画栏那一路已经删了（2026-09-02 拆栏）：那一栏现在是 /gate，由 public/人闸.js 画。
  // 取数这一路留在这里，是因为顶条的人闸格与产线格都要它。
}

/** 顶条人闸格。只碰 #顶闸，与栏在不在无关。 */
function 写顶闸(g, 单, 阈) {
  const 元 = $('顶闸'); if (!元) return;
  let 词元 = 元.querySelector('.闸词');
  if (!词元) { 词元 = document.createElement('b'); 词元.className = '闸词'; 元.appendChild(词元); }
  const 旧章 = 元.querySelector('.闸章'); if (旧章) 旧章.remove();

  if (g.读不到) {
    词元.className = '闸词 读不到';
    词元.textContent = '人闸 读不到';
    元.title = `读不到监制台（${g.因 || ''}）—— 这一格现在不可信，别拿它当"没事"`;
    return;
  }
  // 批们走**同一个 分闸组**，与页面上那一栏共用一把尺；两边各分各的必然分家。
  // 议程（机制）那一批**不进顶条**：它读自 待办-制作人议程.md，实测 mtime 停在 08-28，
  // 文件里写死的小时数是错的（写 TK-180 停 192h，实际 337h）——没有活时钟的东西
  // 不能参加年龄排序，它进「等你拍板」页的第二段。
  const 批们 = 分闸组(单, [], 阈, '全')
    .filter((z) => z.类 === '单')
    // **取 动键（短）不取 动（长）。** 动 是指引「通过归档／打回」，
    // 顶条那 232px 的轨装不下它——实测溢出并把年龄章挤出可视区。
    .map((z) => ({ 动作键: z.动键, 闸名: z.名, n: z.计, 最久小时: (z.形 && z.形.最久) || 0 }));
  const r = 顶况文.人闸文(批们, 阈, 久档);

  词元.className = '闸词';
  词元.innerHTML = r.词组.map((x) => `<b>${x.n}</b><i>${esc(x.词)}</i>`).join('<s> · </s>')
    + (r.余 ? `<s> </s><b>+${r.余}</b>` : '');
  if (r.章) {
    const 章 = document.createElement('i');
    章.className = `闸章 久${r.档}`;
    章.textContent = r.章;
    元.appendChild(章);
  }
  元.title = r.文 + (r.章 ? ` · 最久 ${时长文(r.最久小时)}` : '');
}


// ---- 右栏：脉搏 ----
async function 拉脉搏() {
  let r;
  try { r = await fetch('/api/pulse').then((x) => x.json()); } catch { r = { 读不到: true, 因: '坐席后端不通' }; }
  if (!r.读不到) 取数时.pulse = Date.now();      // 陈旧哨的打点：只在真取到时盖章
  写顶产(r);                     // 顶条那一格。脉栏本身已并进监视页，这里不再画栏。
}

/** 顶条的脉点与产线格。只碰 #脉点 / #顶产。 */
function 写顶产(r) {
  const 点 = $('脉点');
  if (点) {
    // 绿只表示 board **与** runner 都通。原来的「监制台在线」绿得不诚实：
    // server.js 的 Promise.all 只对 board.读不到 短路，runner 单独挂掉照样绿。
    点.className = r.读不到 ? '脉 断' : (r.双通 === false ? '脉 断' : '脉 活');
    点.title = r.读不到 ? `读不到监制台（${r.因 || ''}）`
      : (r.双通 === false ? '监制台通，但派单器读不到' : '监制台与派单器都通');
  }
  const 元 = $('顶产'); if (!元) return;
  const c = r.计数 || {};
  const s = 顶况文.产线文({
    读不到: !!r.读不到,
    在跑: r.读不到 ? null : (r.在跑 || []).map((x) => ({ 单号: x.单, 起时: x.起时 })),
    待派: (c['待派'] || 0) + (c['待重派'] || 0) + (c['已排期'] || 0),
    在途: (c['在途'] || 0) + (c['初检'] || 0) + (c['核查'] || 0) + (c['仲裁'] || 0),
    闸数: 闸表.length,
  });
  元.textContent = s.文;
  元.className = '顶产' + (s.级 === '警' ? ' 警' : s.级 === '弱' ? ' 弱' : '');
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

function 收带() { 带的单 = null; $('带').classList.remove('显'); }

// ---- 接线 ----
//
// **顶层的 addEventListener 必须挡一道。**这一行原来是裸的 `$('闸列').addEventListener`，
// 而闸栏拆成独立页之后主壳里没有 #闸列——顶层一句 `null.addEventListener` 会让
// **这一行往后的整份 app.js 停止执行**：顶条不刷新、在座条不画、说框发不出去，
// 而控制台之外没有任何迹象。这是本项目命名过的那类故障（「静止的活人」）里最贵的一种，
// 因为它看起来像"这一版什么都没做"。
// 统一用它绑，别再写裸的 `$('x').addEventListener`——下一次搬走某个元素时，
// 差别就是「那一格不刷新」和「整个前端停在这一行」。
const 绑 = (id, 事, 手) => { const el = $(id); if (el) el.addEventListener(事, 手); return !!el; };

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
  // 数字键 1–9「选左栏第 N 条」**随左栏一起删了**（2026-09-02 拆栏）。
  // 那一栏现在是 /gate 独立页，而在那一页上「第 N 条」这个说法不成立：
  // 页面一屏能装几十条，1–9 覆盖不到，留着就是一条只在前九条上生效的快捷键——
  // **半个能用的快捷键比没有坏**：它让人以为按 5 一定选到第五条。
});

// ---- 凭据与额度 ----
// 凭据过期时坐席开口就是 401。与其让人对着看不懂的报错猜，不如把还剩几分钟和那条命令摆在屏上。
async function 拉凭据() {
  let c;
  try { c = await fetch('/api/cred').then((x) => x.json()); } catch { return; }
  const 幅 = $('凭幅'); if (!幅) return;
  // **顶条那格登录读数删了**（2026-09-02 评审）：16 条 OAuth 事件里 11 条正文
  // 自己写着「通常不需要动手」，9 次自续日志逐条写「未惊动制作人」——
  // 一个常年不需要动作的读数占着 59px 的常驻宽。
  // **但凭幅这条保险一个字不改**：它直读 expiresAt，60 秒内出横幅并给出那条命令。
  // 删的是常驻读数，不是那道闸。文案仍在 public/顶况.js（判据要 require 它）。
  if (c.态 === '有效') { 幅.hidden = true; return; }
  $('凭文').textContent = c.态 === '过期'
    ? `登录已过期 ${Math.abs(c.剩余分)} 分钟——坐席说不了话，产线也不会派单。重登即恢复：`
    : c.态 === '临期'
      ? `登录还剩 ${c.剩余分} 分钟就到期（${c.到期}）。现在重登，省得半路断：`
      : `本机未登录（${c.因 || ''}）。跑这条：`;
  $('凭令').textContent = c.命令 || '';
  幅.hidden = false;
}

// 额度：**顶条那格删了，改成过线才长出一条横幅。**
//
// 理由不是"省宽度"，是**这块表量的不是把闸的那个量**：
// 2026-08-26 00:06 真 hit limit 的那一分钟，5h 窗读数是 7%。改阈值救不了它。
// 而实测 9.8 天 10342 行里 max 只有 79/84，`.紧` 在 public/*.css 零命中——
// 过线时屏上根本不变色。一个常年在 20% 徘徊、过线时又不吭声的读数，
// 占着 127px 的常驻宽，促成的动作是零。
//
// 触发线是**任一池 ≥85%**，不是"两池同时"：codex 侧实测 9.8 天零读数，
// 「两池同时」在这份数据上是恒假合取（miss M5）。两池都取，不再只取 claude。
const 额度线 = 85;
async function 拉额度() {
  let q;
  try { q = await fetch('/api/quota').then((x) => x.json()); } catch { return; }
  const 幅 = $('额幅'); if (!幅) return;
  if (q.读不到) { 幅.hidden = true; return; }
  const 池们 = [['claude', q.claude], ['codex', q.codex]].filter(([, v]) => v && Array.isArray(v.windows));
  let 最 = null;
  for (const [名, v] of 池们) {
    // **整份窗口原样交出去**，这里不挑不筛——挑哪个、怎么写是 顶况.js 一处的决定。
    const r = 顶况文.额度文(v.windows, 额度线);
    if (!r.紧) continue;
    const 高 = Math.max(...v.windows.map((w) => Number(w.pct) || 0));
    if (!最 || 高 > 最.高) 最 = { 池: 名, r, 高 };
  }
  if (!最) { 幅.hidden = true; return; }
  const 文 = $('额文');
  if (文) 文.textContent = `${最.池} 额度 ${最.r.紧} 窗口过 ${额度线}%：${最.r.详}`;
  幅.hidden = false;
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
  // 塔态钉在「等你拍板」页，回全屏恢复上次那一页（2026-09-02 拆栏）。
  //
  // **不这么做塔就是空的。** 拆栏之前塔＝只留闸栏、藏掉对话；闸栏搬走之后
  // 塔如果还停在对话页，屏上就是一条 360px 宽的空对话——而 localStorage 里的
  // 形态是会记住的，于是开机直接进那个空屏。
  // 由 视图.js 接这个事件（它才知道当前是哪一页、怎么换）。
  document.dispatchEvent(new CustomEvent('形态换', { detail: { 塔: !!要塔 } }));
  // 在壳里才改窗形；浏览器里只换版式，不折腾窗口
  if (window.壳 && window.壳.半屏) window.壳.半屏(要塔);
}
$('形态钮').addEventListener('click', () => 换形态(!document.querySelector('.台').classList.contains('塔')));
try { if (localStorage.getItem(塔键) === '塔') 换形态(true, false); } catch { /* 读不到就用默认全屏 */ }

// ---- 陈旧哨：钟的替代品（2026-09-02 评审）----
//
// **钟删了**：只有 HH:MM 没有日期、是本机钟不与监制台对表、
// 而 `catch{return}` 那三处让它在取数全断的时候照常跳——把死屏渲染成活屏。
//
// **但没有换成常驻的「新鲜度」读数**，尽管三版提案都想换。三条理由：
//   ① 砍钟的理由是「顶条唯一持续运动的元素」，而新鲜格要 5 秒一跳——同一条理由，它犯得更重。
//   ② 它与「连喂两轮相同数据、DOM 写入计数为 0」那条判据逻辑互斥，二者必死一个。
//   ③ 它冻住时的字面是 `8″前`——**伪装成最健康**。钟冻住至少还能跟任务栏的钟比对
//      （main.js 用的是 maximize 不是 kiosk，任务栏就在同一块屏上）。
// 所以做成**陈旧才出现**：平时零像素、零 DOM 写入。
const 取数时 = { gates: 0, pulse: 0 };
const 周期 = { gates: 20000, pulse: 10000 };
function 查陈旧() {
  const 幅 = $('陈幅'); if (!幅) return;
  const 现 = Date.now();
  const 坏 = Object.keys(周期)
    .filter((k) => 取数时[k] && 现 - 取数时[k] > 周期[k] * 3)
    .map((k) => `${k} 停 ${Math.round((现 - 取数时[k]) / 60000)} 分`);
  if (!坏.length) { 幅.hidden = true; return; }
  const 文 = $('陈文');
  if (文) 文.textContent = `数据不再更新：${坏.join(' · ')}。屏上这些数是旧的。`;
  幅.hidden = false;
}
setInterval(查陈旧, 15000);

// ---- 在座条（2026-08-29：主页面即群聊，私聊从群里分出去）----
// 名单只有一处事实源：server/lib/坐席.js，经 /api/seats 下发。
// 前端**不许自己写死一份**——那正是坐席.js 头注要避免的三处各存一份。
let 私聊席 = null;
let 席况 = new Map();   // 名 → 接模型，点击时要用它判断这一位说不说得了话

const 群说注 = 'Enter 发送 · Shift+Enter 换行 · @ 点名 · / 聚焦 · F9 半屏塔';

async function 拉在座() {
  const 组 = $('座组');
  if (!组) return;
  let r;
  try { r = await fetch('/api/seats').then((x) => x.json()); }
  catch { 若变('座', 组, '<div class="座读不到">坐席名单读不到</div>'); return; }   // 说读不到，不编
  const 席 = (r && r.席) || [];
  if (!席.length) { 若变('座', 组, '<div class="座读不到">名单为空 —— 不是零席，是没配</div>'); return; }
  席况 = new Map(席.map((x) => [x.名, !!x.接模型]));

  // 一席一行：头像 + 名 + **人设一句话** + 状态点。
  //
  // 人设那句是 /api/seats 的真字段（「从项目全局给出判断与建议，但不直接改台账」）。
  // **Figma 稿上那行「正在答话 / 起草 TK-234」没有实现**：按席的实时活动
  // 现在没有任何数据源，画上去就是编一个数——PRODUCT 原则五要挡的正是这一步。
  //
  // 头像：**形状与字分人，颜色只管状态。** 八个人八种颜色会把 tokens.css
  // 那条「唯一强调色只出现在人闸」的纪律冲垮，而那是这块屏唯一不能失守的信号。
  // 个体感靠四档中性底色轮换（.调0–3），不引入色相。
  const 全 = ['制作人'].concat(席.map((x) => x.名));
  const 在岗 = 席.filter((x) => x.接模型).length + 1;      // +1＝制作人
  const 在答数 = 席.filter((x) => x.在答).length;
  const 数元 = $('座数');
  if (数元) {
    数元.textContent = 在答数
      ? `${在答数} 在答 · ${在岗} 在岗`
      : `${在岗} 在岗 · ${席.length + 1 - 在岗} 未接`;
  }

  const 前 = (t) => {
    if (!t) return '';
    const m = Math.floor((Date.now() - Date.parse(t)) / 60000);
    if (!Number.isFinite(m) || m < 0) return '';
    if (m < 1) return '刚说完';
    if (m < 60) return m + ' 分钟前说过';
    if (m < 2880) return Math.floor(m / 60) + ' 小时前说过';
    return Math.floor(m / 1440) + ' 天前说过';
  };

  const html = 全.map((名, i) => {
    const s = 席.find((x) => x.名 === 名);
    const 未接 = !!(s && !s.接模型);
    const 选 = 私聊席 === 名;
    // 制作人不给说明句。**他不在 /api/seats 里**，写一句就只能是我编的，
    // 而这一栏的全部可信度正在于"每一句都是那一席协议里的原话"。
    // 名字后面那个「你」已经说清他是谁了。
    const 设 = 名 === '制作人' ? '' : ((s && s.人设) || '');
    // 在答时第二行换成**它此刻在做什么**——那句话来自坐席自己报的 tool_use，
    // 与屏上转圈处显示的是同一句（server.js 那边一个值发两处）。
    // 它还没动手时只说「正在答话」，**不编一个具体的动作**。
    const 在答 = !!(s && s.在答);
    const 做 = 在答 ? ((s && s.做) || '正在答话…') : '';
    // 未接的席位不 disabled：**disabled 的按钮点了完全没有反应**，
    // 而"点了没反应"正是这轮巡礼在到处抓的那种病。它照常接点击，
    // 只是回答"我还没接模型"——名单里有它是事实，它说不了话也是事实，两句都要说出口。
    const 提示 = 未接 ? `${名}已登记但还没接模型，开不了私聊`
      : (s && s.末话 ? 前(s.末话) : '');
    return `<button class="座${选 ? ' 选' : ''}${未接 ? ' 未接' : ''}${在答 ? ' 在答' : ''}" data-seat="${esc(名)}"`
      + (名 === '制作人' ? ' disabled' : '')
      + (提示 ? ` title="${esc(提示)}"` : '')
      + `>`
      + `<span class="座头 调${i % 4}">${esc(名.slice(0, 1))}<i class="座灯"></i></span>`
      + `<span class="座文">`
      + `<span class="座名">${esc(名)}${名 === '制作人' ? '<em>你</em>' : ''}${未接 ? '<em>未接模型</em>' : ''}</span>`
      + (在答 ? `<span class="座做">${esc(做)}</span>`
        : (设 ? `<span class="座设">${esc(设)}</span>` : ''))
      + `</span></button>`;
  }).join('');
  // 走 若变：这一栏 5 秒一拍，内容没变就一个字节都不碰 DOM（原则④「安静是默认」）。
  // 直接 innerHTML= 的话，每 5 秒整栏重建一次——选区没了、hover 态断了、白耗电。
  若变('座', 组, html);
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

// 拉近事 随事件流一起并进监视页（2026-09-02 拆栏批三）：
// 它与监视页的 wev **本来就在渲染同一批事件**，同一个 事流.事条() 在两处各画一份。
拉人闸(); 拉脉搏(); 拉凭据(); 拉额度(); 拉在座();
setInterval(拉人闸, 20000);
setInterval(拉脉搏, 10000);
// 在座栏 5 秒一拍：它现在报的是「谁在答话、在做什么」，那是会在几十秒里变完的事。
// 内容没变时 若变 一个字节都不碰 DOM，所以这个频率不违「安静是默认」。
setInterval(拉在座, 5000);
setInterval(拉凭据, 60000);
setInterval(拉额度, 300000);
