// 文稿.test.js — 文稿台的根表 / 路径校验 / 写权 / 记号扫描（2026-08-31 批二）
//
// **为什么这一组特别重**：终端无鉴权（本机 127.0.0.1，任何网页都能对它发请求），
// 而文稿台是终端**第一个写口**——在它之前，5 个 POST 口没有一条把请求体落盘。
// 原 校档名() 的注释自己写着「松一点就是任意文件读取」；加了写口，
// 同一个洞变成**任意文件覆盖**。而 `grep -rn "校档名" test/` 今天零命中。
//
// 另一半是记号扫描的「用记号 vs 说记号」。这条有案：2026-08-31 的评审
// 拿设计文档第一页那张**记号说明表**数出「6 个记号」，据此论证了一整套界面，
// 而正文里当时一个记号都没有。分不清这两件事，记号栏会把说明书本身标成一堆待办。
'use strict';
const assert = require('node:assert');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const 文稿 = require('../server/lib/文稿.js');

// ── 现搭一个根，不碰真目录 ──────────────────────────────────────────
const 台 = fs.mkdtempSync(path.join(os.tmpdir(), '文稿测-'));
const 甲 = path.join(台, '甲仓');
const 乙 = path.join(台, '乙仓');
const 外 = path.join(台, '外面');
fs.mkdirSync(path.join(甲, '子'), { recursive: true });
fs.mkdirSync(path.join(甲, 'node_modules', '包'), { recursive: true });
fs.mkdirSync(path.join(甲, 'Library', 'PackageCache', 'x'), { recursive: true });
fs.mkdirSync(path.join(乙, '静区'), { recursive: true });
fs.mkdirSync(path.join(乙, '活区'), { recursive: true });
fs.mkdirSync(外, { recursive: true });
fs.writeFileSync(path.join(甲, '正常.md'), '# 标题\n\n正文\n', 'utf8');
fs.writeFileSync(path.join(甲, '子', '深.md'), '深处\n', 'utf8');
fs.writeFileSync(path.join(甲, '不是md.txt'), 'x', 'utf8');
fs.writeFileSync(path.join(甲, 'node_modules', '包', 'README.md'), '不该被列\n', 'utf8');
fs.writeFileSync(path.join(甲, 'Library', 'PackageCache', 'x', 'R.md'), '不该被列\n', 'utf8');
fs.writeFileSync(path.join(乙, '静区', '可改.md'), 'ok\n', 'utf8');
fs.writeFileSync(path.join(乙, '活区', '别碰.md'), 'no\n', 'utf8');
fs.writeFileSync(path.join(乙, '活区补', '同前缀.md').replace(/活区补.*/, '') + '同前缀占位.md', 'x', 'utf8');
fs.mkdirSync(path.join(乙, '活区补'), { recursive: true });
fs.writeFileSync(path.join(乙, '活区补', '同前缀.md'), '这个可以改\n', 'utf8');
fs.writeFileSync(path.join(外, '机密.md'), '不该够得着\n', 'utf8');

const 根表 = [
  { 键: 'jia', 名: '甲仓', 路: 甲, 写: true },
  { 键: 'yi', 名: '乙仓', 路: 乙, 写: '分区', 禁写: ['活区'] },
  { 键: 'ro', 名: '只读仓', 路: 甲, 写: false },
];

process.on('exit', () => { try { fs.rmSync(台, { recursive: true, force: true }); } catch (e) { /* 清不掉不影响判据 */ } });

// ── 一、路径校验：四道 ─────────────────────────────────────────────

test('守① 正常路径通过，并回真实绝对路', () => {
  const r = 文稿.校路径(根表, 'jia', '正常.md');
  assert.ok(r.行, r.因);
  assert.ok(文稿.归一(r.绝对路).endsWith('/甲仓/正常.md'), r.绝对路);
});

test('守② 上跳段一律拒（这是无鉴权下最直接的那条攻击）', () => {
  for (const 坏 of ['../外面/机密.md', '子/../../外面/机密.md', '../../Windows/x.md', '子/../../../x.md']) {
    const r = 文稿.校路径(根表, 'jia', 坏, { 须存在: false });
    assert.ok(!r.行, `上跳没被拦住：${坏} → ${JSON.stringify(r)}`);
  }
});

test('守②b 落在根内但绕了一圈的路径也要拒（一个文件两个名字，锁会被拿两次）', () => {
  // `子/../正常.md` 解析后确实落在根内，第③道 realpath 检查放行它。
  // 但它和 `正常.md` **是同一个文件**——如果两个路径串都能过，
  // 批三的文件锁就会被同一份文件拿两次：两个人各拿一把锁，各自以为独占。
  // 所以第②道那句逐段判 `..` 不是第③道的重复，它守的是**路径的唯一性**。
  // （这一条是自证能红台逼出来的：去掉 ② 之后判据没红，说明当时没人在验它守的东西。）
  const 绕 = 文稿.校路径(根表, 'jia', '子/../正常.md');
  assert.ok(!绕.行, '绕了一圈指回根内的路径被放行了，同一文件会有两个名字：' + JSON.stringify(绕));

  const 直 = 文稿.校路径(根表, 'jia', '正常.md');
  assert.ok(直.行, '正路反而不通：' + 直.因);
});

test('守③ 绝对路径不收（Windows 盘符与 POSIX 根都算）', () => {
  for (const 坏 of ['C:/Windows/x.md', 'D:/x.md', '/etc/passwd.md', '//主机/共享/x.md']) {
    const r = 文稿.校路径(根表, 'jia', 坏, { 须存在: false });
    assert.ok(!r.行, `绝对路径没被拦住：${坏}`);
  }
});

test('守④ 只收 .md；非法字符与空字符拒', () => {
  assert.ok(!文稿.校路径(根表, 'jia', '不是md.txt').行, '.txt 被放行了');
  assert.ok(!文稿.校路径(根表, 'jia', '正常.md\u0000.txt', { 须存在: false }).行, '空字符没被拦住');
  assert.ok(!文稿.校路径(根表, 'jia', '子/a:b.md', { 须存在: false }).行, '非法字符没被拦住');
});

test('守⑤ 不认识的根拒', () => {
  assert.ok(!文稿.校路径(根表, '不存在的根', '正常.md').行);
  assert.ok(!文稿.校路径(根表, '', '正常.md').行);
});

test('守⑥ **新建文件走同一条路**（校档名 照抄过来会在这里 throw）', () => {
  // 原 校档名() 的第②③道靠 realpathSync(已存在的文件)，新文件直接抛异常。
  // 这里改成先 realpath 父目录再拼，所以新建与已存在同一条路。
  const r = 文稿.校路径(根表, 'jia', '子/还没有这个.md', { 须存在: false });
  assert.ok(r.行, '新建被拒了：' + r.因);
  const r2 = 文稿.校路径(根表, 'jia', '子/还没有这个.md', { 须存在: true });
  assert.ok(!r2.行, '须存在时不该放行不存在的文件');
  // 而且**父目录不存在时也要拒**，不能因为"反正是新建"就放过
  const r3 = 文稿.校路径(根表, 'jia', '没有这个目录/x.md', { 须存在: false });
  assert.ok(!r3.行, '父目录不存在却放行了');
});

test('守⑦ 软链指向根外要拒（realpath 之后才判，不是看字符串）', () => {
  const 链 = path.join(甲, '外链');
  try {
    fs.symlinkSync(外, 链, 'junction');   // junction 在 Windows 上不需要管理员
  } catch (e) {
    // 造不出链就明说跳过，不假装验过——假装验过比没验更坏
    console.log('  （本机造不出软链，守⑦ 跳过：' + (e && e.code) + '）');
    return;
  }
  const r = 文稿.校路径(根表, 'jia', '外链/机密.md');
  assert.ok(!r.行, '软链跳出根没被拦住：' + JSON.stringify(r));

  // **在越界目录里「新建」文件**——这一条才是第③道（父目录 realpath 落根内）
  // 独当一面的场合：文件不存在，所以走不到 须存在 分支里那次 native 复核。
  // 自证能红台把这个缺口照出来了：拆掉第③道，判据居然还是绿的，
  // 因为我原来只测了「已存在的文件」那条路。
  const r2 = 文稿.校路径(根表, 'jia', '外链/还没有的.md', { 须存在: false });
  assert.ok(!r2.行, '往越界目录里新建文件没被拦住——写口上这就是任意文件覆盖：' + JSON.stringify(r2));
  assert.ok(/根之外/.test(r2.因), '拒绝理由没点出落在根外：' + r2.因);
});

test('守⑦b **文件本身是软链**也要拒（异厂 2026-08-31 打穿的就是这一条）', () => {
  // 守⑦ 用的是**目录** junction，父目录那道 realpath 正好能拦住——
  // 于是「只解父目录不解文件」这个洞一直没被照到。**判据挡住了自己的视线。**
  // 异厂打的是文件符号链接：父目录仍在根内、statSync 跟随链接返回 isFile()=true，
  // 四道全过，而读写都落在根外。
  const 链 = path.join(甲, '看着像自家的.md');
  const 靶 = path.join(外, '机密.md');
  try {
    fs.symlinkSync(靶, 链, 'file');
  } catch (e) {
    // Windows 上建文件符号链接要开发者模式或管理员。造不出就明说跳过，**不假装验过**。
    console.log('  （本机建不了文件软链，守⑦b 跳过：' + (e && e.code) + '）');
    return;
  }
  const r = 文稿.校路径(根表, 'jia', '看着像自家的.md');
  assert.ok(!r.行, '指向根外的文件软链被放行了：' + JSON.stringify(r));
  assert.ok(/软链/.test(r.因), '拒绝理由没点出是软链：' + r.因);

  // **新建路也要挡**：先埋一条链接、再诱使别人往这个名字写
  const 链2 = path.join(甲, '还没有的.md');
  try { fs.symlinkSync(靶, 链2, 'file'); } catch (e) { return; }
  const r2 = 文稿.校路径(根表, 'jia', '还没有的.md', { 须存在: false });
  assert.ok(!r2.行, '新建路上的根外软链被放行了：' + JSON.stringify(r2));

  // **别误伤**：指向根内的软链要放行
  const 内靶 = path.join(甲, '正常.md');
  const 链3 = path.join(甲, '指向自家的.md');
  try { fs.symlinkSync(内靶, 链3, 'file'); } catch (e) { return; }
  assert.ok(文稿.校路径(根表, 'jia', '指向自家的.md').行, '指向根内的软链被误拒');
});

test('守⑦c 软链判定逻辑本身（本机造不出实物，只能单验这一半）', () => {
  // **诚实的分割**：守⑦b 在本机会跳过——Windows 建文件符号链接要管理员或开发者模式
  // （实测 `New-Item -ItemType SymbolicLink` 报 "Administrator privilege required"）。
  // 所以那条修法端到端**没被验证过**。这一条把能验的那一半单独验掉：
  // 「给定 lstat 说它是软链、realpath 说它指向 X，该不该放行」。
  // 验不了的另一半是「lstat 认不认得出软链」——那是 Node 的事，**明写为盲区**。
  //
  // 顺带一提：埋那条恶意软链所需的权限，跟直接改文件是同一级——
  // 所以这个洞在本机的可利用性其实很低。但开发者模式一旦为别的事打开，它就活了。
  const 根 = 'D:/仓/甲';
  assert.strictEqual(文稿.软链判(根, false, null).行, true, '不是软链却被拦');
  assert.strictEqual(文稿.软链判(根, true, 'D:/仓/甲/子/真身.md').行, true, '指向根内被误拒');
  assert.strictEqual(文稿.软链判(根, true, 'D:\\仓\\甲\\子\\真身.md').行, true, '反斜杠形式被误拒');
  assert.strictEqual(文稿.软链判(根, true, 'D:/仓/甲').行, true, '指向根本身被误拒');

  assert.strictEqual(文稿.软链判(根, true, 'C:/Users/Public/secret.md').行, false, '指向根外被放行');
  assert.strictEqual(文稿.软链判(根, true, 'D:/仓/乙/x.md').行, false, '指向隔壁根被放行');
  assert.strictEqual(文稿.软链判(根, true, null).行, false, '解不开的软链被放行');
  // **前缀不许误判**：D:/仓/甲附近 不是 D:/仓/甲 的子路径
  assert.strictEqual(文稿.软链判(根, true, 'D:/仓/甲附近/x.md').行, false, '同前缀的隔壁目录被当成根内');
});

// ── 二、写权分区 ───────────────────────────────────────────────────

test('守⑧ 只读根不给写', () => {
  const r = 文稿.可写(根表, 'ro', '正常.md');
  assert.ok(!r.行, '只读根被判成可写');
  assert.ok(/只读/.test(r.因), r.因);
});

test('守⑨ 分区根：静区可写、活区禁写，且理由说得出为什么', () => {
  assert.ok(文稿.可写(根表, 'yi', '静区/可改.md').行);
  const r = 文稿.可写(根表, 'yi', '活区/别碰.md');
  assert.ok(!r.行, '活存储被判成可写');
  // 「为什么不给写」比「不给写」有用——理由里要有并发写那句
  assert.ok(/并发写|还原不回/.test(r.因), '拒绝理由没说清为什么：' + r.因);
});

test('守⑩ 前缀不许误伤：活区 禁写不该连坐 活区补', () => {
  const r = 文稿.可写(根表, 'yi', '活区补/同前缀.md');
  assert.ok(r.行, '同前缀的另一个目录被误禁了：' + r.因);
});

test('守⑪ 列举出来的 可写 标记与 可写() 一致（界面按它决定给不给编辑按钮）', () => {
  const 表 = 文稿.列举(根表);
  for (const it of 表) {
    assert.strictEqual(it.可写, 文稿.可写(根表, it.根, it.相对).行,
      `${it.根}/${it.相对} 的可写标记与策略不一致`);
  }
});

// ── 三、列举与剪枝 ─────────────────────────────────────────────────

test('守⑫ 目录级剪枝：node_modules 与 Library/PackageCache 一条都不许进来', () => {
  const 表 = 文稿.列举(根表);
  const 路们 = 表.map((x) => x.相对);
  assert.ok(!路们.some((p) => /node_modules/i.test(p)), 'node_modules 被列进来了：' + 路们.join(','));
  assert.ok(!路们.some((p) => /PackageCache/i.test(p)), 'PackageCache 被列进来了');
  // 正常的要在
  assert.ok(路们.includes('正常.md'), '正常文件没列出来');
  assert.ok(路们.includes('子/深.md'), '子目录没走到');
});

test('守⑫b 按绝对路径排掉的目录不列（文稿台不许把自己的版本历史当文档）', () => {
  // 实测踩到：文稿台的工作目录（草稿/版本环/锁）就落在终端仓这个根里面，
  // 于是**存一次盘，文件库里就多一条 `1788171558379-制作人.md`**——
  // 五十版之后整个左栏全是它自己的影子。
  // 剪枝表是按目录名剪的（node_modules 那种），这一条剪的是特定的那一个绝对路径。
  const 自家 = path.join(甲, '文稿');
  fs.mkdirSync(path.join(自家, '版本', 'x'), { recursive: true });
  fs.writeFileSync(path.join(自家, '版本', 'x', '1788171558379-制作人.md'), 'v1\n', 'utf8');
  fs.writeFileSync(path.join(甲, '文稿别人的.md'), '这个要列出来\n', 'utf8');

  const 全 = 文稿.列举(根表).map((x) => x.相对);
  assert.ok(全.some((p) => /1788171558379/.test(p)), '不排的时候本该列出来，判据前提不成立');

  const 排 = 文稿.列举(根表, { 排除目录: [自家] }).map((x) => x.相对);
  assert.ok(!排.some((p) => /1788171558379/.test(p)), '版本历史还在文件库里：' + 排.filter((p) => /版本/.test(p)));
  // **别误伤**：名字里带「文稿」的正常文件要留着
  assert.ok(排.includes('文稿别人的.md'), '误伤了同名前缀的正常文件');
});

test('守⑬ 只列 .md', () => {
  assert.ok(文稿.列举(根表).every((x) => /\.md$/i.test(x.名)));
});

test('守⑭ 单根上限生效（一个仓炸了不该拖垮整页）', () => {
  const 表 = 文稿.列举(根表, { 单根上限: 1 });
  const 按根 = {};
  for (const x of 表) 按根[x.根] = (按根[x.根] || 0) + 1;
  for (const k of Object.keys(按根)) assert.ok(按根[k] <= 1, `${k} 超了上限：${按根[k]}`);
});

test('守⑮ 根不存在只是跳过，不是抛异常', () => {
  const r = 文稿.列举([{ 键: 'x', 名: '没有', 路: path.join(台, '压根没有这个目录'), 写: true }]);
  assert.deepStrictEqual(r, []);
});

// ── 四、记号扫描：用记号 vs 说记号 ──────────────────────────────────

test('守⑯ 裸记号算，反引号里的不算', () => {
  const 条 = 文稿.扫记号('这一段要改【改】\n说明：`【改】` 表示要改\n');
  assert.strictEqual(条.length, 1, '数错了：' + JSON.stringify(条));
  assert.strictEqual(条[0].记号, '改');
  assert.strictEqual(条[0].行号, 1);
});

test('守⑰ 代码围栏里的记号不算', () => {
  const 条 = 文稿.扫记号('```\n【改】这在围栏里\n```\n【加】这在外面\n');
  assert.strictEqual(条.length, 1, JSON.stringify(条));
  assert.strictEqual(条[0].记号, '加');
});

test('守⑱ 四种记号都认，计数分得开', () => {
  const c = 文稿.记号计(文稿.扫记号('【改】\n【加】\n【删】\n【删】\n【问】\n'));
  assert.deepStrictEqual(c, { 改: 1, 加: 1, 删: 2, 问: 1 });
});

test('守⑲ **真设计文档里的记号数**——说明表那几行不许算成待办', () => {
  const 档 = path.join(__dirname, '..', '设计文档.md');
  if (!fs.existsSync(档)) return;   // 文档不在就不验，但不假装验过
  const 全 = fs.readFileSync(档, 'utf8');
  // 文件里确实出现了这些字样（否则这条判据在验空气）
  assert.ok(/【改】/.test(全), '设计文档里没有【改】字样，这条判据失去意义');
  const 条 = 文稿.扫记号(全);
  // 那几处全在反引号里（说明表 + 用法说明），所以扫出来应当是 0。
  // 若将来制作人真在正文里标了记号，这条会红——**那时该改的是这个数字，不是扫描规则**。
  assert.strictEqual(条.length, 0,
    '把「说记号」当成了「用记号」，会把说明书本身标成待办：' + JSON.stringify(条.slice(0, 4)));
});

// ── 四点二、静默截断（2026-08-31 评审 S4/S5）────────────────────

test('守㉔ **单根上限按最近改动裁，不按遍历序裁**（切掉的必须是最旧的）', () => {
  // 首版是「走到 800 就 return」，而遍历序是 readdir 的名序。
  // 实测 studio 走序尾部 24 条正好是全库最新的那批：
  // 收口报告×8、拆单简报×6、digests/2026-08-{29,30,31}、班次×6。
  // 本仓自己的 test/写闸.test.js 早就写着「最新那枚必须还在——被上限挤掉的该是最旧的」。
  // 单独一个根：甲/乙 是全文件共用的夹具，别的判据往里写过东西，
  // 拿它来验「留下的是不是最新三份」会被那些文件干扰。
  const 独 = fs.mkdtempSync(path.join(os.tmpdir(), '裁-'));
  // 名序与时间序**故意反着来**：名字越靠后的越新
  for (let i = 0; i < 10; i++) {
    const f = path.join(独, `a${String(i).padStart(2, '0')}.md`);
    fs.writeFileSync(f, '# ' + i, 'utf8');
    const t = new Date(Date.now() - (10 - i) * 3600 * 1000);
    fs.utimesSync(f, t, t);
  }
  const 出 = 文稿.列举([{ 键: 'du', 名: '独', 路: 独, 写: true }], { 单根上限: 3 });
  const 名们 = 出.map((x) => x.名).sort();
  assert.strictEqual(出.length, 3);
  assert.deepStrictEqual(名们, ['a07.md', 'a08.md', 'a09.md'],
    '留下的不是最新的三份，实得 ' + 名们.join(','));
});

test('守㉔b **裁掉了要说出来**（一个悄悄变小的真数读起来就是「就这么多」）', () => {
  const 独 = fs.mkdtempSync(path.join(os.tmpdir(), '裁2-'));
  for (let i = 0; i < 7; i++) fs.writeFileSync(path.join(独, `b${i}.md`), 'x', 'utf8');
  const 出 = 文稿.列举([{ 键: 'du', 名: '独仓', 路: 独, 写: true }], { 单根上限: 4 });
  assert.strictEqual(出.length, 4);
  assert.ok(Array.isArray(出.截断) && 出.截断.length === 1, '没有截断报告：' + JSON.stringify(出.截断));
  const t = 出.截断[0];
  assert.strictEqual(t.根, 'du');
  assert.strictEqual(t.根名, '独仓');
  assert.strictEqual(t.留, 4);
  assert.ok(t.丢 >= 3, '丢了几份没报对：' + JSON.stringify(t));
});

test('守㉔c 没超上限时截断报告是空的（平时不许无端喊「没给全」）', () => {
  fs.writeFileSync(path.join(甲, '就一份.md'), 'x', 'utf8');
  const 出 = 文稿.列举([{ 键: 'jia', 名: '甲', 路: 甲, 写: true }], { 单根上限: 800 });
  assert.deepStrictEqual(出.截断, []);
});

test('守㉔d 截断/未读 这些附带属性不可枚举（否则每条 deepEqual 判据都会莫名其妙地红）', () => {
  const 出 = 文稿.列举([{ 键: 'jia', 名: '甲', 路: 甲, 写: true }]);
  assert.ok(!Object.keys(出).includes('截断'));
  assert.ok(!JSON.stringify(出).includes('截断'));
  assert.ok(Array.isArray(出.截断), '不可枚举但要取得到');
});

test('守㉕ **正文搜索没有读预算**（预算按根表序耗尽，记忆库永远搜不到）', () => {
  // 案发：读上限 400 按列表序消耗，而根表序把 memory 排在最后（实测第 885 位起）。
  // 「雷火」真值 3 份全在 memory 正文，搜索返回 0。
  // 拆掉它不是因为"代价可接受"，是因为它没省下东西：全量读 956 份 9.3MB 实测 48ms，
  // 而同一个文件里的 记号统计 早就在对全部文件读全文了。
  fs.mkdirSync(path.join(甲, '深'), { recursive: true });
  for (let i = 0; i < 30; i++) fs.writeFileSync(path.join(甲, '深', `p${i}.md`), '无关内容', 'utf8');
  // 排在最后的那一份才有关键词
  fs.writeFileSync(path.join(乙, '压轴.md'), '这里写着雷火两个字', 'utf8');

  const 表 = 文稿.列举(根表);
  const 命 = 文稿.搜(表, '雷火', { 根路: { jia: 甲, yi: 乙, ro: 甲 } })
    .filter((x) => x.命中 && x.命中 !== '文件名');
  assert.ok(命.length >= 1, '排在最后那一份的正文没被搜到 —— 预算又回来了');
  assert.match(命[0].命中, /雷火/);
});

test('守㉕b 搜索缓存按 mtime 命中，文件改了要重读', () => {
  const f = path.join(甲, '会改的搜.md');
  fs.writeFileSync(f, '起初没有那个词', 'utf8');
  const 缓 = new Map();
  const 根路 = { jia: 甲, yi: 乙, ro: 甲 };
  let 表 = 文稿.列举(根表);
  assert.strictEqual(文稿.搜(表, '暗号', { 根路, 缓 }).filter((x) => x.命中 && x.命中 !== '文件名').length, 0);

  fs.writeFileSync(f, '现在有暗号了', 'utf8');
  const later = new Date(Date.now() + 4000);
  fs.utimesSync(f, later, later);
  表 = 文稿.列举(根表);
  const 命 = 文稿.搜(表, '暗号', { 根路, 缓 }).filter((x) => x.命中 && x.命中 !== '文件名');
  // **不断言恰好一条**：这份夹具里 ro 根与 jia 根指向同一个目录，
  // 同一个文件会被列两次，命中自然是两条。要验的是「重读了没有」。
  assert.ok(命.length >= 1, '文件改了但缓存没失效 —— 搜索会一直说它不含那个词');
  assert.match(命[0].命中, /暗号/);
});

test('守㉕c 读不动的要计数报出去，不许当成「它不匹配」', () => {
  const 表 = 文稿.列举(根表);
  // 故意给一个缺了根路的表：那些文件读不动
  const 出 = 文稿.搜(表, '随便', { 根路: {} });
  assert.ok(出.未读 > 0, '读不动的份数没报出来 —— 屏上会以为搜过了、没有');
});

// ── 四点五、记号统计 ───────────────────────────────────────────────

test('守⑲b **只读文件的记号也要数**（先标了记号、后来才变只读的那些）', () => {
  // 首版只扫可写的，理由是「只读的他不会去标记号」。
  // 异厂评审 2026-08-31 打的正是这一条：一份文档可以**先被标了记号、后来才变只读**
  // （发布流程改 ACL、或被挪进活存储区）。那时记号还在文件里，
  // 却从「有记号」的结果里凭空消失——而屏上那句「N 份有记号」是对**全部**说的。
  // **一个只对其中一半成立的计数，比没有这个计数坏。**
  fs.writeFileSync(path.join(甲, '可写的带记号.md'), '这段要改【改】\n', 'utf8');
  fs.mkdirSync(path.join(乙, '活区'), { recursive: true });
  fs.writeFileSync(path.join(乙, '活区', '只读的也带记号.md'), '这段也要改【改】\n和这段【问】\n', 'utf8');

  const 表 = 文稿.列举(根表);
  文稿.记号统计(表, { jia: 甲, yi: 乙, ro: 甲 });

  const 可 = 表.find((x) => x.相对 === '可写的带记号.md' && x.根 === 'jia');
  const 只 = 表.find((x) => x.相对 === '活区/只读的也带记号.md');
  assert.ok(可 && 可.记 && 可.记.改 === 1, '可写文件的记号没数出来：' + JSON.stringify(可 && 可.记));
  assert.ok(只, '只读文件没被列出来');
  assert.ok(只.记, '**只读文件的记号被跳过了**——它可能是先标后变只读的');
  assert.strictEqual(只.记.改, 1);
  assert.strictEqual(只.记.问, 1);
  assert.strictEqual(文稿.有记号(只), true);
});

test('守⑲c 记号缓存按 mtime 命中，文件变了要重数', () => {
  const p = path.join(甲, '会变的.md');
  fs.writeFileSync(p, '还没有记号\n', 'utf8');
  const 缓 = new Map();
  let 表 = 文稿.列举(根表);
  文稿.记号统计(表, { jia: 甲, yi: 乙, ro: 甲 }, 缓);
  assert.strictEqual(文稿.有记号(表.find((x) => x.相对 === '会变的.md' && x.根 === 'jia')), false);

  // 改内容并把 mtime 推后（同一毫秒内写两次的话 mtime 可能不变）
  fs.writeFileSync(p, '现在有了【加】\n', 'utf8');
  const later = new Date(Date.now() + 4000);
  fs.utimesSync(p, later, later);

  表 = 文稿.列举(根表);
  文稿.记号统计(表, { jia: 甲, yi: 乙, ro: 甲 }, 缓);
  assert.strictEqual(文稿.有记号(表.find((x) => x.相对 === '会变的.md' && x.根 === 'jia')), true,
    '文件改了但缓存没失效——屏上会一直说它没记号');
});

test('守⑲d **淘汰的是「本轮没见到的」，不是「插得早的」**（FIFO 会在 2000 上撞断崖）', () => {
  // 原来是「超过 2000 就只留最后 1200 条」。那是 FIFO 不是 LRU——
  // 命中缓存时不重新 set，插入序就是列举序，于是文件数一过 2000：
  // 每轮淘汰掉固定的那 800 条 → 下一轮把它们重读一遍重新插到末尾 → 再淘汰另外 800 条。
  // **每次列举从「读 0 个文件」跳成「读 800 个」，而且永远回不去。**
  const 目 = fs.mkdtempSync(path.join(os.tmpdir(), '淘-'));
  for (let i = 0; i < 6; i++) fs.writeFileSync(path.join(目, `n${i}.md`), '这段要改【改】\n', 'utf8');
  const 根 = [{ 键: 'du', 名: '独', 路: 目, 写: true }];
  const 缓 = new Map();

  let 表 = 文稿.列举(根);
  文稿.记号统计(表, { du: 目 }, 缓);
  assert.strictEqual(缓.size, 6);

  // 删掉两份 —— 它们的缓存条目必须跟着走，不能一直躺在 Map 里
  fs.rmSync(path.join(目, 'n0.md'));
  fs.rmSync(path.join(目, 'n1.md'));
  表 = 文稿.列举(根);
  文稿.记号统计(表, { du: 目 }, 缓);
  assert.strictEqual(缓.size, 4, '删掉的文件还留在缓存里 —— 这块屏整天开着，那就是一处慢性泄漏');
  assert.ok(![...缓.keys()].some((k) => k.endsWith('n0.md')), 'n0 的缓存条目没被清掉');

  // 而**没删的那些一条都不许被淘汰**（否则下一轮要重读，就是那个断崖）
  for (let i = 2; i < 6; i++) {
    assert.ok([...缓.keys()].some((k) => k.endsWith(`n${i}.md`)), `n${i} 被误淘汰了`);
  }
  // 再跑一轮：全部命中，一次读盘都不该发生
  const 快照 = new Map([...缓.entries()].map(([k, v]) => [k, v.记]));
  文稿.记号统计(文稿.列举(根), { du: 目 }, 缓);
  assert.strictEqual(缓.size, 4);
  for (const [k, v] of 缓) assert.strictEqual(v.记, 快照.get(k), k + ' 被重算了（缓存没命中）');

  fs.rmSync(目, { recursive: true, force: true });
});

// ── 五、读盘：换行与 BOM ───────────────────────────────────────────

test('守⑳ 读盘认出 CRLF 与 LF（写回要照原样还原，否则一次保存全文件变改动行）', () => {
  const a = path.join(甲, '_crlf.md'); fs.writeFileSync(a, '一\r\n二\r\n', 'utf8');
  const b = path.join(甲, '_lf.md'); fs.writeFileSync(b, '一\n二\n', 'utf8');
  assert.strictEqual(文稿.读(a).换行, 'crlf');
  assert.strictEqual(文稿.读(b).换行, 'lf');
  // 读出来的文一律归一成 LF，前端不该看见 \r
  assert.ok(!文稿.读(a).文.includes('\r'), '读出来还带 \\r');
});

test('守㉑ 读盘剥 BOM 并记下它（写回要还原，不然每存一次 BOM 就搬一次家）', () => {
  const p = path.join(甲, '_bom.md');
  fs.writeFileSync(p, '\uFEFF# 题\n', 'utf8');
  const r = 文稿.读(p);
  assert.strictEqual(r.有BOM, true, '没认出 BOM');
  assert.ok(r.文.startsWith('# 题'), 'BOM 没剥掉：' + JSON.stringify(r.文.slice(0, 5)));
});

test('守㉒ 读不到的文件是拒绝，不是抛异常', () => {
  const r = 文稿.读(path.join(甲, '压根没有.md'));
  assert.strictEqual(r.行, false);
  assert.ok(r.因);
});

// ── 六、搜索 ──────────────────────────────────────────────────────

test('守㉓ 文件名与正文都能搜到，空词返回全量', () => {
  const 表 = 文稿.列举(根表);
  const 根路 = { jia: 甲, yi: 乙, ro: 甲 };
  assert.strictEqual(文稿.搜(表, '').length, 表.length, '空词该返回全量');
  assert.ok(文稿.搜(表, '正常').some((x) => x.相对 === '正常.md'), '文件名没搜到');
  const 正文命中 = 文稿.搜(表, '深处', { 根路 });
  assert.ok(正文命中.some((x) => x.相对 === '子/深.md'), '正文没搜到');
  assert.ok(正文命中.find((x) => x.相对 === '子/深.md').命中.includes('深处'), '没给出命中片段');
});
