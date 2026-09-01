// 用途.test.js — frontmatter 与「用途」手工覆写。
//
// 案由（制作人 2026-09-01 拍板）：分类是按文件名猜的，实测召回 68/73——
// **猜不中的那几份此前没有任何办法纠正**。他要能手工覆写。
//
// 动手时先量了一下，撞出一件既存的错：
// **全库 959 份 md 里 339 份以 `---` 开头，而渲染器不认识 frontmatter**——
// 那 339 份在文稿台上，开头几行 YAML 是被当**正文**画出来的：
// 一条 `<hr>` + 若干 `<p>name: …</p>` + 又一条 `<hr>`。三分之一的文档顶着一坨元数据。
// 所以这件事是两半：先让渲染器认得头，再把「用途」这一行接进归类。
'use strict';
const assert = require('node:assert');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { 渲染, 拆头 } = require('../server/render/md');
const 文稿 = require('../server/lib/文稿');
const { 写用途, 渲染面, 判类 } = require('../server/routes/文稿页');

// ── 一、拆头 ────────────────────────────────────────────────────

test('头① **开头的 frontmatter 要剥掉，不能当正文画**（339/959 份受影响）', () => {
  const 样 = '---\nname: 甲\ndescription: 一句话\n---\n\n# 真标题\n\n正文。\n';
  const h = 渲染(样);
  assert.ok(!h.includes('name: 甲'), '元数据被当正文画出来了：' + h.slice(0, 160));
  assert.ok(!/<hr>/.test(h), 'frontmatter 的 --- 被当成分隔线了');
  assert.match(h, /<h1>真标题<\/h1>/);
  assert.match(h, /<p>正文。<\/p>/);
});

test('头② **文中间的 `---` 仍是分隔线**（只有第一行那个才是头）', () => {
  // **语料要有两个 `---`**：只有一个的话，把正则的 `^` 锚定去掉也照样匹配不上，
  // 这条判据就分辨不出「有没有锚定在第一行」——而那正是它要守的东西。
  const 样 = '# 甲\n\n---\n\n乙\n\n---\n\n丙\n';
  const h = 渲染(样);
  assert.strictEqual((h.match(/<hr>/g) || []).length, 2, '正文里的分隔线被当成 frontmatter 吃掉了：' + h);
  assert.match(h, /<p>乙<\/p>/, '两条分隔线之间的正文被吃了');
  assert.strictEqual(拆头(样).头, null, '文中间的 --- 被当成了 frontmatter');
});

test('头③ **行号要补回去**——不补的话记号栏跳转稳定偏 N 行，且不报错', () => {
  // 记号栏靠 data-行 跳；编辑态的段落按钮靠它把「点了预览这一段」翻译成「往源码第几行插」。
  const 样 = '---\nname: 甲\n用途: 规章\n---\n\n# 标题\n\n正文。\n';
  const h = 渲染(样, { 行号: true });
  // 头占 1..4 行，第 5 行空，第 6 行是标题，第 7 行空，第 8 行是正文
  assert.match(h, /<h1 data-行="6">/, '标题的行号不对：' + h.slice(0, 200));
  assert.match(h, /<p data-行="8">/, '正文的行号不对：' + h.slice(0, 240));

  // 没有 frontmatter 时不许平白多出偏移
  const g = 渲染('# 甲\n\n乙\n', { 行号: true });
  assert.match(g, /<h1 data-行="1">/);
  assert.match(g, /<p data-行="3">/);
});

test('头③b **扫记号 与 渲染 用的是同一把行号尺**（两把尺就是跳错行）', () => {
  const 样 = '---\nname: 甲\n---\n\n# 标题\n\n这段要改【改】\n';
  const 记 = 文稿.扫记号(样);
  assert.strictEqual(记.length, 1);
  const h = 渲染(样, { 行号: true });
  // 记号在第 7 行；渲染出来那一段的 data-行 必须也是 7
  assert.strictEqual(记[0].行号, 7, '扫记号 的行号变了：' + JSON.stringify(记[0]));
  assert.match(h, /data-行="7"/, '渲染的行号对不上扫记号：' + h);
});

test('头④ 只认最简的 键: 值，认不出的原样收着不丢', () => {
  const r = 拆头('---\nname: 甲\nmetadata:\n  type: project\n乱七八糟的一行\n---\n\n正文\n');
  assert.strictEqual(r.头.name, '甲');
  assert.strictEqual(r.头.metadata, '');
  assert.deepStrictEqual(r.头.其余, ['  type: project', '乱七八糟的一行']);
  assert.strictEqual(r.正文, '\n正文\n');
});

test('头⑤ 没有头、空文件、null 都不许抛', () => {
  for (const x of ['', null, undefined, '# 只有标题', '---\n没收口']) {
    const r = 拆头(x);
    assert.strictEqual(r.头, null, JSON.stringify(x));
    assert.strictEqual(r.头行数, 0);
  }
});

// ── 二、认用途 ──────────────────────────────────────────────────

test('认① 名与键都收，大小写与空白都洗（他会写「规章」，不会写 guizhang）', () => {
  assert.strictEqual(文稿.认用途('规章'), 'guizhang');
  assert.strictEqual(文稿.认用途('guizhang'), 'guizhang');
  assert.strictEqual(文稿.认用途('GUIZHANG'), 'guizhang');
  assert.strictEqual(文稿.认用途(' 方案与评审 '), 'zaiban');
  assert.strictEqual(文稿.认用途('工单留痕'), 'gongdan');
  assert.strictEqual(文稿.认用途('其它'), 'qita');
  assert.strictEqual(文稿.认用途('其他'), 'qita');
});

test('认① b **认不出就回落到猜，不许丢进「其它」**', () => {
  // 写错一个字就把文档扔进「其它」，比不给覆写更坏——他改了一行，文档反而找不着了。
  assert.strictEqual(文稿.认用途('我瞎写的'), null);
  assert.strictEqual(文稿.认用途(''), null);
  assert.strictEqual(文稿.认用途(null), null);
  assert.strictEqual(文稿.认用途(undefined), null);
});

// ── 三、覆写真的压过猜 ──────────────────────────────────────────

function 造(件) {
  const 目 = fs.mkdtempSync(path.join(os.tmpdir(), '用途-'));
  for (const [名, 文] of Object.entries(件)) fs.writeFileSync(path.join(目, 名), 文, 'utf8');
  return 目;
}
const 扫 = (目) => {
  const 根 = [{ 键: 'du', 名: '独', 路: 目, 写: true }];
  const L = 文稿.列举(根);
  文稿.记号统计(L, { du: 目 });
  return L;
};

test('覆① **用途 压过猜的结果**，并留下原来猜的是什么', () => {
  // **语料要造出真的分歧**：文件名本身会被猜成什么，得和覆写成的不一样，
  // 否则「猜类」自然为空，这条判据就在验空气。第一版挑的名字里带「方案」，
  // 而规则本来就猜中 zaiban，覆写前后一模一样。
  const 目 = 造({
    '毫不相干的名字.md': '---\n用途: 方案与评审\n---\n\n# 甲\n',
    '协议库归它.md': '# 乙\n',
  });
  assert.strictEqual(文稿.归类('du', '毫不相干的名字.md'), 'qita', '前提：这个名字该被猜成「其它」');
  const L = 扫(目);
  const a = L.find((x) => x.名.startsWith('毫不相干'));
  assert.strictEqual(a.类, 'zaiban', '覆写没生效');
  assert.strictEqual(a.定类, true, '没标出「这是你定的」——他分不清是规则错了还是自己写错了');
  assert.strictEqual(a.猜类, 'qita', '没留下原来猜的是什么：' + JSON.stringify(a.猜类));

  const b = L.find((x) => x.名 === '协议库归它.md');
  assert.ok(!b.定类, '没写用途的被标成「你定的」了');
  fs.rmSync(目, { recursive: true, force: true });
});

test('覆② 写错的用途回落到猜，**文档不许因此失踪**', () => {
  const 目 = 造({ '甲.md': '---\n用途: 我瞎写的\n---\n\n# 甲\n' });
  const L = 扫(目);
  assert.ok(!L[0].定类, '认不出的用途被当成定过了');
  assert.strictEqual(L[0].类, 文稿.归类('du', '甲.md'), '没回落到猜');
  fs.rmSync(目, { recursive: true, force: true });
});

test('覆③ 覆写成和猜的一样时，仍要标「你定的」（他明确表过态）', () => {
  const 目 = 造({ '协议库-章程.md': '---\n用途: 规章\n---\n\n# 甲\n' });
  const 根 = [{ 键: 'ticketflow', 名: 'T', 路: 目, 写: true }];
  const L = 文稿.列举(根);
  文稿.记号统计(L, { ticketflow: 目 });
  assert.strictEqual(L[0].类, 'guizhang');
  assert.strictEqual(L[0].定类, true, '猜的和定的一样时就不标了 —— 那他下次看不出这是他定过的');
  fs.rmSync(目, { recursive: true, force: true });
});

// ── 四、写用途：改文件头这件事要干净 ────────────────────────────

test('写① 三种情形：没有头 / 有头没用途 / 有头有用途', () => {
  assert.strictEqual(写用途('# 甲\n\n正文。\n', '规章'),
    '---\n用途: 规章\n---\n\n# 甲\n\n正文。\n');
  assert.strictEqual(写用途('---\nname: 甲\n---\n\n# 乙\n', '规章'),
    '---\nname: 甲\n用途: 规章\n---\n\n# 乙\n');
  assert.strictEqual(写用途('---\nname: 甲\n用途: 项目文档\n---\n\n# 乙\n', '规章'),
    '---\nname: 甲\n用途: 规章\n---\n\n# 乙\n');
});

test('写② **幂等**——改十次和改一次的结果必须一模一样', () => {
  // 不幂等的话每存一次文件头就变一次形，改十次这份文档的头就跟别人不一样了。
  for (const 原 of [
    '# 甲\n\n正文。\n',
    '---\nname: 甲\n---\n\n# 乙\n',
    '---\nname: 甲\n用途: 项目文档\n---\n\n# 乙\n',
  ]) {
    const 一 = 写用途(原, '规章');
    assert.strictEqual(写用途(一, '规章'), 一, '不幂等：' + JSON.stringify(原));
    assert.strictEqual(写用途(写用途(一, '规章'), '规章'), 一);
  }
});

test('写③ **往返**——加了再撤，回得到原样（连空行都要对上）', () => {
  for (const 原 of ['# 甲\n\n正文。\n', '---\nname: 甲\n---\n\n# 乙\n']) {
    assert.strictEqual(写用途(写用途(原, '规章'), null), 原,
      '往返回不到原样：' + JSON.stringify(原) + ' → ' + JSON.stringify(写用途(写用途(原, '规章'), null)));
  }
});

test('写④ 撤销时头里只剩它，整个头连同后面那个空行一起收走', () => {
  assert.strictEqual(写用途('---\n用途: 规章\n---\n\n# 甲\n', null), '# 甲\n');
  // 头里还有别的就只删那一行
  assert.strictEqual(写用途('---\nname: 甲\n用途: 规章\n---\n\n# 乙\n', null),
    '---\nname: 甲\n---\n\n# 乙\n');
  // 本来就没有，撤销即无事发生
  assert.strictEqual(写用途('# 甲\n', null), '# 甲\n');
});

test('写⑤ 写完的结果，拆头 要读得回来（自己写的自己认得）', () => {
  const 新 = 写用途('# 甲\n\n正文。\n', '规章');
  assert.strictEqual(拆头(新).头.用途, '规章');
  assert.strictEqual(文稿.认用途(拆头(新).头.用途), 'guizhang');
  // 而且写完之后那一行不许被渲染成正文
  assert.ok(!渲染(新).includes('用途'), '写进去的那一行被画到正文里了');
});

// ── 四点五、阅读态判类（它和文件库那份必须给出同一个答案）────────

test('判① 阅读态也认 frontmatter（否则同一份文档在同一屏上两个分类）', () => {
  const 没 = 判类('du', '毫不相干.md', null);
  assert.strictEqual(没.类, 'qita');
  assert.strictEqual(没.定类, false);

  const 定 = 判类('du', '毫不相干.md', '---\n用途: 规章\n---\n\n# 甲\n');
  assert.strictEqual(定.类, 'guizhang', '阅读态没认 frontmatter —— 左边文件库认了，两边会各说各的');
  assert.strictEqual(定.定类, true);
  assert.strictEqual(定.猜类, 'qita', '没留下原来猜的是什么');
});

test('判①b 写错的用途在阅读态也回落到猜', () => {
  const r = 判类('du', '毫不相干.md', '---\n用途: 瞎写的\n---\n\n# 甲\n');
  assert.strictEqual(r.类, 'qita');
  assert.strictEqual(r.定类, false);
});

test('判①c **两处必须给出同一个答案**（文件库那条路 vs 阅读态这条路）', () => {
  // 这是这一改的全部意义：不一致的话，他在左边看到「规章」、点进去看到「其它」。
  const 目 = 造({ '毫不相干的名字.md': '---\n用途: 方案与评审\n---\n\n# 甲\n' });
  const 库 = 扫(目)[0];
  const 面 = 判类('du', '毫不相干的名字.md', fs.readFileSync(path.join(目, '毫不相干的名字.md'), 'utf8'));
  assert.strictEqual(面.类, 库.类, `阅读态判 ${面.类}，文件库判 ${库.类}`);
  assert.strictEqual(面.定类, 库.定类);
  assert.strictEqual(面.猜类, 库.猜类);
  fs.rmSync(目, { recursive: true, force: true });
});

// ── 五、界面：类别钮 ────────────────────────────────────────────

const 假读 = { 行: true, 文: '# 甲\n', 字节: 6, 换行: 'lf', 有BOM: false };
const 钮 = (当前) => (渲染面(当前, 假读, []).match(/<button class="稿类[^>]*>[^<]*<\/button>/) || [''])[0];

test('钮① 猜的和定的**看得出区别**（否则他分不清是规则错了还是自己写错了）', () => {
  const 猜 = 钮({ 根: 't', 根名: 'T', 相对: 'a.md', 可写: true, 类: 'zaiban', 定类: false, 版数: 0 });
  const 定 = 钮({ 根: 't', 根名: 'T', 相对: 'a.md', 可写: true, 类: 'guizhang', 定类: true, 版数: 0 });
  assert.ok(猜.includes('方案与评审'), 猜);
  assert.ok(!/class="稿类 定"/.test(猜), '猜的被标成定的了');
  assert.ok(/class="稿类 定"/.test(定), '定的没标出来：' + 定);
  assert.ok(/你定的/.test(定) && /猜的/.test(猜), 'title 没说清是哪一种');
});

test('钮② 只读的文档禁掉，并说清为什么', () => {
  const h = 钮({ 根: 'memory', 根名: '记忆库', 相对: 'a.md', 可写: false, 只读因: 'x', 类: 'jiyi', 版数: 0 });
  assert.match(h, /disabled/);
  assert.match(h, /只读/);
});

test('钮③ 没有类的时候不画钮（不摆一颗空的）', () => {
  assert.strictEqual(钮({ 根: 't', 根名: 'T', 相对: 'a.md', 可写: true, 版数: 0 }), '');
});

test('钮④ 前端不许自己写一份类别表（服务端加一类它就分家了）', () => {
  const s = fs.readFileSync(path.join(__dirname, '..', 'public', '文稿.js'), 'utf8');
  const i = s.indexOf("const 类钮 = $('#稿类')");
  assert.ok(i > 0, '前端没接类别钮');
  const 段 = s.slice(i, i + 2200);
  assert.match(段, /querySelectorAll\('\.稿组\[data-类\]'\)/,
    '类别选项不是从页面上真实存在的那几组取的 —— 那就是第二份名单');
  for (const c of 文稿.类别表) {
    assert.ok(!段.includes(`'${c.键}'`), `前端里写死了类别键「${c.键}」`);
  }
});
