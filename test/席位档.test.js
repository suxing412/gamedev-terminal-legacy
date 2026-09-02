// 席位档.test.js — 一席＝一份协议文档（2026-09-02 批六）。
//
// 制作人：「智能体协议就按照文档库里的，可以直接在自定义中跳转到文档库中开编辑器进行编辑」。
// 所以这一组盯的是：协议档是不是真的成了唯一事实源，以及它有没有把今夜反复咬人的
// 那几族坑一并挡住（中文过边界、路径拼接、默认值把"不知道"说成"是"）。
'use strict';
const assert = require('node:assert');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const 席位档 = require('../server/lib/席位档.js');
const 坐席 = require('../server/lib/坐席.js');

const 造台 = () => fs.mkdtempSync(path.join(os.tmpdir(), '席位测-'));
const 写 = (目, 名, 文) => fs.writeFileSync(path.join(目, 名), 文, 'utf8');

// ── 一、读：frontmatter 用的是文稿台那把尺 ──────────────────────

test('守① 读得出名、接模型、模型、一句话', () => {
  const 目 = 造台();
  写(目, '美术顾问.md', ['---', '名: 美术顾问', '接模型: 是', '模型: claude-opus-5',
    '一句话: 看美术方向与风格一致性。', '---', '', '## 本席', '', '- 职责 —— 只出过/不过。', ''].join('\n'));
  const s = 席位档.读(目, '美术顾问.md');
  assert.strictEqual(s.名, '美术顾问');
  assert.strictEqual(s.接模型, true);
  assert.strictEqual(s.模型, 'claude-opus-5');
  assert.strictEqual(s.人设, '看美术方向与风格一致性。');
  assert.strictEqual(s.自建, true);
  assert.match(s.协议, /## 本席/, '正文整段就是协议');
  assert.ok(!/^---/.test(s.协议), 'frontmatter 不该留在协议正文里');
  fs.rmSync(目, { recursive: true, force: true });
});

test('守①b **接模型默认是否**（一个自称接了却答不出的席位会让屏上永远转圈）', () => {
  const 目 = 造台();
  写(目, '甲.md', '---\n名: 甲\n---\n\n正文\n');
  assert.strictEqual(席位档.读(目, '甲.md').接模型, false, '没写就该是"没接"');
  写(目, '乙.md', '---\n名: 乙\n接模型: 大概吧\n---\n\n正文\n');
  assert.strictEqual(席位档.读(目, '乙.md').接模型, false, '认不出的值不许当成"是"');
  for (const v of ['是', '真', 'true', 'yes', '1', '接']) {
    写(目, '丙.md', `---\n名: 丙\n接模型: ${v}\n---\n\n正文\n`);
    assert.strictEqual(席位档.读(目, '丙.md').接模型, true, `「${v}」应当算接了`);
  }
  fs.rmSync(目, { recursive: true, force: true });
});

test('守①c 没写「一句话」就取正文第一句，**仍然是文档里的原话**，不是编的', () => {
  const 目 = 造台();
  写(目, '甲.md', '---\n名: 甲\n---\n\n# 标题不算\n\n> 引用不算\n\n这一句才算。\n');
  assert.strictEqual(席位档.读(目, '甲.md').人设, '这一句才算。');
  // 正文里一句能用的都没有时回空串——**不编一句**
  写(目, '乙.md', '---\n名: 乙\n---\n\n# 只有标题\n');
  assert.strictEqual(席位档.读(目, '乙.md').人设, '');
  fs.rmSync(目, { recursive: true, force: true });
});

test('守①d 没有 frontmatter 时用文件名当席名（不是丢掉这一席）', () => {
  const 目 = 造台();
  写(目, '临时工.md', '就是一段正文，没有头。\n');
  const s = 席位档.读(目, '临时工.md');
    assert.strictEqual(s.名, '临时工');
  fs.rmSync(目, { recursive: true, force: true });
});

// ── 二、目录：不在 / 坏一份 / 共守 ─────────────────────────────

test('守② 目录不在就当没有自定义席位，**不抛**', () => {
  assert.deepStrictEqual(席位档.全部(path.join(os.tmpdir(), '绝不存在的目录-' + process.pid)), []);
  assert.strictEqual(席位档.共守(path.join(os.tmpdir(), '绝不存在的目录-' + process.pid)), null);
});

test('守②b 共守档不算一席（它是九席同一份的底线，不是谁）', () => {
  const 目 = 造台();
  写(目, 席位档.共守档名, '---\n名: 共守\n---\n\n# 共守\n\n同事不是助手。\n');
  写(目, '甲.md', '---\n名: 甲\n---\n\n正文\n');
  const 表 = 席位档.全部(目);
  assert.strictEqual(表.length, 1, '共守被当成一席了');
  assert.strictEqual(表[0].名, '甲');
  assert.match(席位档.共守(目), /同事不是助手/);
  fs.rmSync(目, { recursive: true, force: true });
});

// ── 三、路径：席名会进文件名 ──────────────────────────────────

test('守③ 席名要洗（"现在不是用户输入"从来不是路径安全的理由）', () => {
  assert.strictEqual(席位档.档名('../../etc/passwd'), 'etcpasswd.md', '上跳段与斜杠都要削');
  assert.strictEqual(席位档.档名('a:b*c?d"e<f>g|h'), 'abcdefgh.md');
  assert.strictEqual(席位档.档名('...'), null, '洗完是空的就该回 null，不许拼出一个 ".md"');
  assert.strictEqual(席位档.档名(''), null);
  assert.strictEqual(席位档.档名('  美术顾问  '), '美术顾问.md');
});

// ── 四、建：只建骨架，且不覆盖 ────────────────────────────────

test('守④ 建出来的是一张填空表，**不是一份写好的人设**', () => {
  const 目 = 造台();
  const r = 席位档.建(目, '美术顾问');
  assert.strictEqual(r.行, true);
  const 文 = fs.readFileSync(path.join(目, r.档), 'utf8');
  for (const k of ['职责', '人格特征', '语言风格', '招牌动作', '失手时', '边界']) {
    assert.ok(文.includes(k), `骨架里少了「${k}」这一栏`);
  }
  assert.match(文, /试音/, '少了试音那一段——人格只有能当场核对才不是四个形容词');
  assert.match(文, /_共守\.md/, '骨架要指明共守在哪，否则每一席都会把底线再抄一遍');
  // **填的内容必须是空的**：设计内容由制作人主导，这里不替他写
  assert.match(文, /- \*\*职责\*\* —— *\n/, '职责那一栏被预填了内容');
  fs.rmSync(目, { recursive: true, force: true });
});

test('守④b **已存在就不覆盖**（覆盖一份协议＝无声地换掉一整席）', () => {
  const 目 = 造台();
  席位档.建(目, '甲');
  const 原 = fs.readFileSync(path.join(目, '甲.md'), 'utf8');
  fs.writeFileSync(path.join(目, '甲.md'), 原 + '\n人格特征 —— 挑剔但不刻薄\n', 'utf8');
  const r = 席位档.建(目, '甲');
  assert.strictEqual(r.行, false);
  assert.strictEqual(r.已在, true);
  assert.match(fs.readFileSync(path.join(目, '甲.md'), 'utf8'), /挑剔但不刻薄/, '手写的内容被覆盖了');
  fs.rmSync(目, { recursive: true, force: true });
});

// ── 五、名单：内建 + 自建，一个出口 ────────────────────────────

test('守⑤ 名单 ＝ 内建 + 自建；全部 仍是内建那七席（两个名字不许混）', () => {
  const 目 = 造台();
  席位档.建(目, '美术顾问');
  坐席.挂目录(目);
  const 名单 = 坐席.名单();
  assert.strictEqual(坐席.全部.length, 7, '全部 的语义变了，老调用方会跟着错');
  assert.strictEqual(名单.length, 8);
  assert.ok(名单.some((x) => x.名 === '美术顾问' && x.自建));
  assert.ok(坐席.按名('美术顾问'), '按名 查不到自建席位');
  assert.ok(坐席.是已知('美术顾问'));
  坐席.挂目录(null);
  fs.rmSync(目, { recursive: true, force: true });
});

test('守⑤b **重名时内建的赢**（一份放错名字的协议档不该悄悄顶掉总监）', () => {
  const 目 = 造台();
  写(目, '总监.md', '---\n名: 总监\n接模型: 是\n一句话: 冒牌的\n---\n\n正文\n');
  坐席.挂目录(目);
  const 总 = 坐席.按名('总监');
  assert.notStrictEqual(总.人设, '冒牌的', '自建档顶掉了内建的总监');
  assert.strictEqual(坐席.名单().filter((x) => x.名 === '总监').length, 1, '出现了两个总监');
  坐席.挂目录(null);
  fs.rmSync(目, { recursive: true, force: true });
});

// ── 六、中文过边界：今夜咬过四次的那一族 ──────────────────────

test('守⑥ 表单字段名必须是 ASCII（键裸着中文过 body 会静默丢）', () => {
  // 案发本批：首版写 `name="名"`。浏览器提交时会自己编码键，所以点按钮能用；
  // 但任何不编码键的调用方（curl、判据、脚本）发过去就是丢，
  // 而丢法是静默的——路由回「席名不能为空」，看着像"你没填"。
  const s = fs.readFileSync(path.join(__dirname, '..', 'server', 'routes', '席位页.js'), 'utf8');
  const m = s.match(/<input[^>]*name="([^"]+)"/);
  assert.ok(m, '找不到那个输入框');
  assert.ok(/^[\x21-\x7e]+$/.test(m[1]), `表单字段名「${m[1]}」不是 ASCII`);
  assert.match(s, /req\.body && req\.body\.name/, '读的键与表单里那个对不上');
});

test('守⑥b 路由路径必须是 ASCII（Express 匹配的是未解码的 req.path）', () => {
  const s = fs.readFileSync(path.join(__dirname, '..', 'server', 'routes', '席位页.js'), 'utf8');
  for (const m of s.matchAll(/r\.(get|post|put|delete)\('([^']+)'/g)) {
    assert.ok(/^[\x21-\x7e]+$/.test(m[2]), `路由路径「${m[2]}」不是 ASCII —— 它会 404，症状是"点了没反应"`);
  }
});
