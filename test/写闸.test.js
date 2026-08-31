// 写闸.test.js — 写口准入（2026-08-31 批三）
//
// 案源：文稿台是终端**第一个写口**。在它之前终端对外纯只读——
// 五个 POST 口没有一条把请求体落盘。而这块屏无鉴权、开机自启、整天开着。
//
// 评审构造出的攻击（可复现）：任何网页里一句
//   fetch('http://127.0.0.1:4280/api/doc/save', {method:'POST', mode:'no-cors',
//         headers:{'Content-Type':'text/plain'}, body: JSON.stringify({...})})
// **响应读不到，但写已经发生。**同源策略挡的是「读回响应」，挡不住「发出去的写」。
'use strict';
const assert = require('node:assert');
const test = require('node:test');
const { 准写, 新令牌台, 自家们, 令牌活毫秒 } = require('../server/lib/写闸.js');

const 台 = 新令牌台();
const 好令 = 台.发();
const 自家 = 自家们(4280);
const 认令 = (t) => 台.认(t);
const 好头 = { 类型: 'application/json', 来源: 'http://127.0.0.1:4280', 令: 好令 };

test('守① 正常请求放行', () => {
  const r = 准写(好头, { 自家, 认令 });
  assert.ok(r.行, JSON.stringify(r));
});

test('守② **text/plain 一律拒**——这是那条攻击的入口', () => {
  // text/plain 是"简单请求"，不触发 CORS 预检，所以跨站脚本能直接发出去。
  // 要求 application/json 就必须过预检，而我们不给 CORS 头，预检自然失败。
  for (const t of ['text/plain', 'text/plain;charset=UTF-8', 'application/x-www-form-urlencoded',
    'multipart/form-data', '', 'application/jsonx']) {
    const r = 准写({ ...好头, 类型: t }, { 自家, 认令 });
    assert.ok(!r.行, `${t} 被放行了`);
    assert.strictEqual(r.码, 415);
  }
  // 带 charset 的正经 JSON 要放行
  assert.ok(准写({ ...好头, 类型: 'application/json; charset=utf-8' }, { 自家, 认令 }).行);
});

test('守③ 外站 Origin 拒；**没有 Origin 也拒**', () => {
  for (const o of ['http://evil.example', 'http://127.0.0.1:9999', 'null',
    'http://127.0.0.1:4280.evil.com', 'https://127.0.0.1:4280']) {
    const r = 准写({ ...好头, 来源: o }, { 自家, 认令 });
    assert.ok(!r.行, `${o} 被放行了`);
    assert.strictEqual(r.码, 403);
  }
  // 缺 Origin：不许"判不出来就放行"——在无鉴权的写口上那等于没有闸
  assert.ok(!准写({ ...好头, 来源: '' }, { 自家, 认令 }).行, '缺 Origin 被放行了');
  assert.ok(!准写({ ...好头, 来源: undefined }, { 自家, 认令 }).行);
});

test('守④ localhost 与 127.0.0.1 都算自家（地址栏用哪个都行）', () => {
  for (const o of ['http://localhost:4280', 'http://127.0.0.1:4280', 'http://[::1]:4280',
    'http://127.0.0.1:4280/']) {
    assert.ok(准写({ ...好头, 来源: o }, { 自家, 认令 }).行, `${o} 被误拒`);
  }
});

test('守⑤ 假令牌 / 空令牌 / 别处发的令牌一律拒', () => {
  for (const t of ['', undefined, 'deadbeef', 好令 + 'x', 好令.slice(0, -1)]) {
    assert.ok(!准写({ ...好头, 令: t }, { 自家, 认令 }).行, `令牌 ${t} 被放行了`);
  }
});

test('守⑥ 令牌会过期', () => {
  const t2 = 新令牌台();
  const 现在 = 1756600000000;
  const 令 = t2.发(现在);
  assert.ok(t2.认(令, 现在 + 1000), '刚发的就不认了');
  assert.ok(!t2.认(令, 现在 + 令牌活毫秒 + 1000), '过期令牌还认');
});

test('守⑦ 令牌台有上限（常驻整天开着，不设上限就是内存泄漏）', () => {
  const t3 = 新令牌台();
  const 现在 = 1756600000000;
  for (let i = 0; i < 500; i++) t3.发(现在 + i);
  assert.ok(t3.数() <= 200, `令牌台涨到 ${t3.数()}，没有上限`);
  // 最新那枚必须还在——被上限挤掉的该是最旧的
  const 新 = t3.发(现在 + 999);
  assert.ok(t3.认(新, 现在 + 1000), '刚发的令牌被自己的上限挤掉了');
});

test('守⑧ 三道各自独立——挡住任何一道都算拒（不许"其中一道过了就放行"）', () => {
  // 逐道单独破坏，其余保持正确
  assert.ok(!准写({ ...好头, 类型: 'text/plain' }, { 自家, 认令 }).行);
  assert.ok(!准写({ ...好头, 来源: 'http://evil.example' }, { 自家, 认令 }).行);
  assert.ok(!准写({ ...好头, 令: 'x' }, { 自家, 认令 }).行);
  // 全对才过
  assert.ok(准写(好头, { 自家, 认令 }).行);
});

test('守⑨ 认令 没给时一律拒（缺省不许是"放行"）', () => {
  assert.ok(!准写(好头, { 自家 }).行, '没配认令却放行了');
  assert.ok(!准写(好头, {}).行, '什么都没配却放行了');
});
