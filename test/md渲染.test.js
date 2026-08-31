// md渲染.test.js — 渲染器扩写后的行为判据（2026-08-31 批一）
//
// 案源：拿扩写前的 md.js 渲染 设计文档.md（547 行）实测——
//   <pre> 0 · <table> 0 · <hr> 0 · <h4> 0 · <ol> 0
//   残留 <p>|表格行 83 · <p>#### 18 · <p>``` 20 · <p>--- 20 · <p>1. 9
// **150/547 行渲染错，约 27%。** 而班次报告与日报都走这个渲染器，
// 所以这是今天就在坏的东西，不是为编辑器新加的需求。
//
// 最坏的一条不是"少了表格"，是**代码围栏里的 `-` 和 `#` 被当成列表和标题吃掉**——
// 结构被搅乱，而不是少一个样式。守①③ 专守这一条。
//
// 全部是行为判据（给输入、验输出），不 grep 源码。
'use strict';
const assert = require('node:assert');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { 渲染, 内联, 转义 } = require('../server/render/md.js');

const 仓 = path.join(__dirname, '..');

// ── 一、代码围栏：里面的东西一律不解析 ──────────────────────────────

test('守① 围栏内的 # 和 - 是内容，不是标题和列表', () => {
  const 出 = 渲染('```\n# 不是标题\n- 不是列表\n| 不是 | 表格 |\n```');
  assert.ok(/<pre><code>/.test(出), '没生成 pre/code：' + 出);
  assert.ok(!/<h1>/.test(出), '围栏里的 # 变成了标题：' + 出);
  assert.ok(!/<li>/.test(出), '围栏里的 - 变成了列表：' + 出);
  assert.ok(!/<table>/.test(出), '围栏里的 | 变成了表格：' + 出);
  assert.ok(出.includes('# 不是标题'), '围栏内容丢了：' + 出);
});

test('守② 围栏语言标记进 class，且被转义', () => {
  assert.ok(/<code class="lang-js">/.test(渲染('```js\nlet a=1\n```')));
  const 恶 = 渲染('```a"onload="x\ncode\n```');
  assert.ok(!/onload="x"/.test(恶), '语言标记没转义，属性被拆开了：' + 恶);
});

test('守③ 围栏里的 HTML 被转义，不是原样输出', () => {
  const 出 = 渲染('```\n<script>alert(1)</script>\n```');
  assert.ok(!/<script>/.test(出), '围栏里的 script 原样输出了：' + 出);
  assert.ok(/&lt;script&gt;/.test(出));
});

test('守④ 围栏没收口也不丢内容', () => {
  const 出 = 渲染('```\n第一行\n第二行');
  assert.ok(出.includes('第一行') && 出.includes('第二行'), '未收口围栏把内容吞了：' + 出);
});

// ── 二、表格 ────────────────────────────────────────────────────

test('守⑤ 表格出 table/thead/tbody，不是一堆 <p>|', () => {
  const 出 = 渲染('| 甲 | 乙 |\n|---|---|\n| 1 | 2 |');
  assert.ok(/<table>/.test(出) && /<th>甲<\/th>/.test(出) && /<td>1<\/td>/.test(出), 出);
  assert.ok(!/<p>\|/.test(出), '还有表格行掉进段落：' + 出);
});

test('守⑥ :---: 三种对齐都生效', () => {
  const 出 = 渲染('| 左 | 中 | 右 |\n|:---|:---:|---:|\n| a | b | c |');
  assert.ok(/text-align:left/.test(出), 出);
  assert.ok(/text-align:center/.test(出), 出);
  assert.ok(/text-align:right/.test(出), 出);
});

test('守⑦ 单独一行 | a | b | 不是表格（没有分隔行）', () => {
  const 出 = 渲染('| 这不是 | 表格 |\n就是一行普通文字');
  assert.ok(!/<table>/.test(出), '没有分隔行却当成了表格：' + 出);
});

test('守⑧ 表格行格数不齐也不丢内容', () => {
  const 出 = 渲染('| 甲 | 乙 | 丙 |\n|---|---|---|\n| 只有一格 |\n| 1 | 2 | 3 | 4 |');
  assert.ok(出.includes('只有一格'), '少格的行被丢了：' + 出);
  assert.ok(出.includes('4'), '多格的行被截了：' + 出);
});

// ── 三、标题 / 分隔线 / 有序列表 ───────────────────────────────────

test('守⑨ h1 到 h6 都认（旧版只到 h3）', () => {
  for (let n = 1; n <= 6; n++) {
    const 出 = 渲染('#'.repeat(n) + ' 题');
    assert.ok(出.includes(`<h${n}>题</h${n}>`), `h${n} 没出来：` + 出);
  }
});

test('守⑩ --- 出 hr，不是段落', () => {
  const 出 = 渲染('上\n\n---\n\n下');
  assert.ok(/<hr>/.test(出) && !/<p>---<\/p>/.test(出), 出);
});

test('守⑪ 有序列表出 ol，且 - 与 1. 混排不会串进同一个表', () => {
  const 出 = 渲染('1. 甲\n2. 乙');
  assert.ok(/<ol>/.test(出) && !/<ul>/.test(出), 出);
  const 混 = 渲染('- 无序\n\n1. 有序');
  assert.ok(/<ul>/.test(混) && /<ol>/.test(混), 混);
  // ul 必须在 ol 开始前就闭合，不能出现 <ul> 里套 <li> 属于 ol 的情况
  assert.ok(混.indexOf('</ul>') < 混.indexOf('<ol>'), 'ul 没闭合就开了 ol：' + 混);
});

// ── 四、BOM 与占位符（两个"静默改错"的坑）────────────────────────────

test('守⑫ BOM 开头的文件，一级标题仍是标题', () => {
  const 出 = 渲染('\uFEFF# 标题\n\n正文');
  assert.ok(/<h1>标题<\/h1>/.test(出), 'BOM 把一级标题降级成了段落：' + 出);
});

test('守⑫b BOM 不泄漏进正文（守⑫ 证明不了这件事）', () => {
  // **剥 BOM 真正承重的地方在这里，不在守⑫。**
  // 守⑫ 用的是标题位，而 JS 的 \s 匹配 U+FEFF（实测 /^\s$/.test(BOM) === true），
  // 标题正则的 ^\s{0,3} 前缀会顺手把 BOM 吸收掉——**不剥也照样出 h1**。
  // 拿它当剥 BOM 的判据，是一条看着绿其实没在验的假判据（自证能红台当场把它抓出来了）。
  //
  // 段落走兜底分支，没有那个前缀：BOM 原样进正文，成为一个**看不见的字符**——
  // 搜不到、对不齐、复制出去还带着，而屏幕上完全正常。
  const 段 = 渲染(String.fromCharCode(0xFEFF) + '正文');
  assert.ok(!段.includes(String.fromCharCode(0xFEFF)), 'BOM 泄漏进了正文：' + JSON.stringify(段));
  assert.ok(段.includes('正文'), 段);
});

test('守⑬ 正文里的「 C3 」不会被当成代码占位符吃掉', () => {
  // 旧版占位符是 ` C${i} `，于是「维生素 C3 含量」会被换成第 4 个代码段——吃字且不报错
  const 出 = 渲染('维生素 C3 含量与 `x` `y` `z` `w` 并存');
  assert.ok(出.includes('维生素 C3 含量'), '「 C3 」被当成占位符吃了：' + 出);
  assert.ok((出.match(/<code>/g) || []).length === 4, '代码段数量不对：' + 出);
});

test('守⑭ 输入里混进裸 NUL 不影响输出', () => {
  const 出 = 渲染('前\u0000后 `码`');
  assert.ok(出.includes('前后'), 出);
  assert.ok(/<code>码<\/code>/.test(出), 出);
});

// ── 五、安全（扩写不许把这几条弄丢）──────────────────────────────────

test('守⑮ javascript: 链接降级成纯文本，不留可点的口', () => {
  const 出 = 渲染('[点我](javascript:alert(1))');
  assert.ok(!/<a /.test(出), '生成了可点链接：' + 出);
  assert.ok(出.includes('点我'), '文字也丢了：' + 出);
});

test('守⑯ 表格单元格里的 HTML 被转义', () => {
  const 出 = 渲染('| 甲 |\n|---|\n| <img src=x onerror=alert(1)> |');
  assert.ok(!/<img/.test(出), '单元格里的标签原样输出了：' + 出);
  assert.ok(/&lt;img/.test(出));
});

test('守⑰ 标题里的 HTML 被转义', () => {
  assert.ok(!/<b>/.test(渲染('### <b>粗</b>')));
});

// ── 六、真文档端到端 ───────────────────────────────────────────────

test('守⑱ 渲染真实文档：五类残留全为 0，且五类产出都不为 0', () => {
  const 档 = path.join(仓, '设计文档.md');
  if (!fs.existsSync(档)) {
    // 文档不在就用方案文件顶上——两份都没有才算环境不对
    const 备 = path.join(仓, 'docs', '方案-文稿台-2026-08-31.md');
    assert.ok(fs.existsSync(备), '找不到可用于端到端的真实文档');
    return 端到端(备, { 要h456: false });
  }
  端到端(档, { 要h456: true });
});

function 端到端(档, { 要h456 }) {
  const 出 = 渲染(fs.readFileSync(档, 'utf8'));
  const n = (re) => (出.match(re) || []).length;

  // 残留：这五类是扩写前的错法，一个都不许有
  assert.strictEqual(n(/<p>\|/g), 0, '有表格行掉进段落');
  assert.strictEqual(n(/<p>#{1,6} /g), 0, '有标题掉进段落');
  assert.strictEqual(n(/<p>`{3}/g), 0, '有围栏标记掉进段落');
  assert.strictEqual(n(/<p>-{3,}<\/p>/g), 0, '有分隔线掉进段落');
  assert.strictEqual(n(/<p>\d+\. /g), 0, '有有序列表项掉进段落');

  // 产出：光"没残留"不够——把渲染器改成全丢弃也能满足残留为 0
  assert.ok(n(/<pre>/g) > 0, '一个代码块都没出');
  assert.ok(n(/<table>/g) > 0, '一张表都没出');
  assert.ok(n(/<hr>/g) > 0, '一条分隔线都没出');
  assert.ok(n(/<th/g) > 0, '表头没出');
  if (要h456) assert.ok(n(/<h[456]>/g) > 0, 'h4-h6 没出');

  // 不丢内容：正文里的可见字数不该比源文少太多
  const 源字 = fs.readFileSync(档, 'utf8').replace(/[\s#|*`_>-]/g, '').length;
  const 出字 = 出.replace(/<[^>]+>/g, '').replace(/&[a-z#0-9]+;/g, 'x').replace(/[\s#|*`_>-]/g, '').length;
  assert.ok(出字 >= 源字 * 0.9, `渲染后可见字数掉了太多：源 ${源字} → 出 ${出字}`);
}

// ── 七、旧行为不许回归 ─────────────────────────────────────────────

test('守⑲ 转义在内联之前（先生成标签再转义会把自己的标签也转掉）', () => {
  const 出 = 渲染('**粗** 与 <b>假粗</b>');
  assert.ok(/<strong>粗<\/strong>/.test(出), '自己的标签被转义了：' + 出);
  assert.ok(/&lt;b&gt;/.test(出), '别人的标签放过去了：' + 出);
});

test('守⑳ 两级无序列表仍嵌在父 li 内部（不是 ul 直接套 ul）', () => {
  const 出 = 渲染('- 父\n  - 子');
  assert.ok(!/<ul>\s*<ul>/.test(出), 'ul 直接套了 ul：' + 出);
  assert.ok(/<li>父\s*<ul>/.test(出), '子列表没嵌进父 li：' + 出);
});

test('守㉑ 认不出的行按段落走，不静默丢弃', () => {
  const 出 = 渲染('~~~~~ 这不是任何已知语法 ~~~~~');
  assert.ok(出.includes('这不是任何已知语法'), '内容被静默丢了：' + 出);
});
