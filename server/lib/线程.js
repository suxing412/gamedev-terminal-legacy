// 线程.js — 只经监制台 relay HTTP 口读写线程；此模块绝不碰 thread.jsonl 或本地回落文件。
const http = require('http');

const 默认监制台 = 'http://127.0.0.1:4270';
const 读路径 = '/api/relay?limit=10000';
const 写路径 = '/api/relay';

// 第二期监制台写口会接收发言人字段；名单现在先集中在这里，读侧与 @ 路由共用。
const 白名单 = Object.freeze(['制作人', 'Claude', '项管', '助理', '总监']);
const 是白名单 = (发言人) => 白名单.includes(String(发言人 || ''));
const 监制台源 = (指定) => String(指定 || process.env.STUDIO_ORIGIN || 默认监制台).replace(/\/$/, '');

function 请求JSON({ 方法, 路径, 体 = null, origin, 超时 = 6000 }) {
  return new Promise((完成) => {
    let 已完成 = false;
    const 收 = (值) => { if (!已完成) { 已完成 = true; 完成(值); } };
    let u;
    try { u = new URL(路径, 监制台源(origin)); }
    catch (e) { return 收({ 读不到: true, 因: e.message }); }
    const body = 体 == null ? '' : String(体);
    const req = http.request(u, {
      method: 方法,
      timeout: 超时,
      headers: body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {},
    }, (res) => {
      let raw = '';
      res.on('data', (d) => { raw += d; });
      res.on('end', () => {
        if ((res.statusCode || 500) < 200 || (res.statusCode || 500) >= 300) return 收({ 读不到: true, 因: `HTTP ${res.statusCode}` });
        try { 收(JSON.parse(raw)); }
        catch { 收({ 读不到: true, 因: '监制台返回非 JSON' }); }
      });
    });
    req.on('error', (e) => 收({ 读不到: true, 因: e.code || e.message }));
    req.on('timeout', () => { req.destroy(); 收({ 读不到: true, 因: '超时' }); });
    if (body) req.write(body);
    req.end();
  });
}

/** 读出原样历史条目；发言人映射另由 发言人() 派生，绝不回填或改写历史对象。 */
async function 读全量(选项 = {}) {
  const r = await 请求JSON({ 方法: 'GET', 路径: 读路径, origin: 选项.origin, 超时: 选项.超时 });
  if (r.读不到) return r;
  if (!Array.isArray(r.消息)) return { 读不到: true, 因: '监制台 relay 未返回消息数组' };
  return { 消息: r.消息 };
}

/** 当前 relay 只接受 {text}，会将来源记为制作人；多方发言人写入由监制台第二期接口承接。 */
async function 追加({ 发言人, 文 }, 选项 = {}) {
  if (!String(发言人 || '').trim() || !String(文 || '').trim()) return { 拒绝: true, 因: '发言人和正文均不能为空' };
  // 这里刻意只发 text：现有监制台写口尚未接收发言人字段，不能在终端伪造第二本账。
  const 写体 = JSON.stringify({ text: String(文) });
  const r = await 请求JSON({ 方法: 'POST', 路径: 写路径, 体: 写体, origin: 选项.origin, 超时: 选项.超时 });
  if (r.读不到) return r;
  return { ok: true, 结果: r };
}

/** 兼容旧 t/from/text 记录与后续带 发言人 的记录，不修改传入条目。 */
function 发言人(条目) {
  if (!条目 || typeof 条目 !== 'object') return '未知';
  const 原 = 条目.发言人 == null ? 条目.from : 条目.发言人;
  const 名 = String(原 || '').trim();
  if (!名) return '未知';
  return 是白名单(名) ? 名 : `未知坐席：${名}`;
}

module.exports = { 默认监制台, 读路径, 写路径, 白名单, 是白名单, 发言人, 读全量, 追加 };
