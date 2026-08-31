// 写手闸.test.js — 坐席写「制作人正锁着的文件」时的 PreToolUse 判定（2026-08-31 晚）
//
// 案源：验收复核 grep 出来，lib/文锁.js 的 外部可写() **生产代码零调用点**——
// 函数写好了、判据齐了，而告示还在对坐席说「硬拦在 server 侧，写了也会被拒」。
// **判据全绿，因为判据自己直接调那个函数。**这正是 H104 要防的那种假判据。
// 制作人当晚裁「外部可写要加」，于是有了这道闸；这一组是它的判据。
'use strict';
const assert = require('node:assert');
const test = require('node:test');
const { 判写, 取路径 } = require('../server/lib/写手闸.js');

// 假的查锁：只有 D:/仓/锁着的.md 被锁
const 查 = (p) => (String(p).replace(/\\/g, '/').toLowerCase() === 'd:/仓/锁着的.md'
  ? { 行: false, 因: '制作人 正在文稿台里编辑这份文件', 键: 'terminal/锁着的.md' }
  : { 行: true, 因: '没有人锁着' });

test('守① 写锁着的文件要拒，且理由说得出下一步该干什么', () => {
  const r = 判写('Edit', { file_path: 'D:/仓/锁着的.md' }, 查);
  assert.strictEqual(r.决, 'deny');
  assert.ok(/正在文稿台里编辑|被拦下/.test(r.因), r.因);
  // 只说「不行」是不够的——坐席被挡之后要知道往哪走
  assert.ok(/回话里说|等他解锁/.test(r.因), '拒绝理由没给出路：' + r.因);
  assert.ok(/不要绕开/.test(r.因), '没有明说不许绕道（改用 Bash 写之类）：' + r.因);
});

test('守② 写没锁的文件照常放行', () => {
  assert.strictEqual(判写('Edit', { file_path: 'D:/仓/别的.md' }, 查).决, 'allow');
  assert.strictEqual(判写('Write', { file_path: 'D:/仓/新的.md' }, 查).决, 'allow');
});

test('守③ **只拦写，不拦读**（坐席得能读锁着的文件才答得了话）', () => {
  for (const t of ['Read', 'Grep', 'Glob', 'Bash', 'WebFetch', 'Task']) {
    assert.strictEqual(判写(t, { file_path: 'D:/仓/锁着的.md' }, 查).决, 'allow', `${t} 被误拦`);
  }
});

test('守④ 四种写工具都认（少认一个就等于漏一条路）', () => {
  for (const t of ['Edit', 'Write', 'NotebookEdit', 'MultiEdit']) {
    const 入 = t === 'NotebookEdit' ? { notebook_path: 'D:/仓/锁着的.md' } : { file_path: 'D:/仓/锁着的.md' };
    assert.strictEqual(判写(t, 入, 查).决, 'deny', `${t} 没被拦住`);
  }
});

test('守⑤ MultiEdit 风格的 edits[] 也要逐条查', () => {
  const r = 判写('MultiEdit', {
    edits: [{ file_path: 'D:/仓/别的.md' }, { file_path: 'D:/仓/锁着的.md' }],
  }, 查);
  assert.strictEqual(r.决, 'deny', '一批里混着一个锁着的，整批就该拒');
  assert.strictEqual(r.挡住的.length, 1);
});

test('守⑥ 反斜杠、大小写变体都要认出是同一个文件', () => {
  assert.strictEqual(判写('Edit', { file_path: 'D:\\仓\\锁着的.md' }, 查).决, 'deny', '反斜杠没认出来');
  assert.strictEqual(判写('Edit', { file_path: 'd:/CANG/../仓/锁着的.MD' }, (p) => 查(p)).决, 'allow',
    '这一条只验 取路径 不做规范化——规范化是 外部可写() 的职责，见 文锁.test.js 守⑨');
});

test('守⑦ **查锁自己坏掉时放行**，不把坐席的写操作整个瘫掉', () => {
  // 这道闸是防误伤，不是安全边界（安全边界在写口的四道）。
  // 它自己坏了就把坐席所有写变成不可用，是拿小概率的碰撞换大概率的瘫痪。
  const 炸 = () => { throw new Error('锁文件读不出来'); };
  assert.strictEqual(判写('Edit', { file_path: 'D:/仓/锁着的.md' }, 炸).决, 'allow');
});

test('守⑧ 取不到路径就放行（认不出的工具不该被当成写操作拦住）', () => {
  assert.strictEqual(判写('Edit', {}, 查).决, 'allow');
  assert.strictEqual(判写('Edit', null, 查).决, 'allow');
  assert.strictEqual(判写('Edit', { 别的字段: 'x' }, 查).决, 'allow');
});

test('守⑨ 取路径 认得出三种字段与 edits[]', () => {
  assert.deepStrictEqual(取路径('Write', { file_path: 'a' }), ['a']);
  assert.deepStrictEqual(取路径('NotebookEdit', { notebook_path: 'b' }), ['b']);
  assert.deepStrictEqual(取路径('MultiEdit', { edits: [{ file_path: 'c' }, { file_path: 'd' }] }), ['c', 'd']);
  assert.deepStrictEqual(取路径('Edit', { file_path: '  ' }), [], '空白路径不该被当成路径');
});
