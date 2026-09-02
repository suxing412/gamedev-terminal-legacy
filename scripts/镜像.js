// 镜像.js — 把公开仓的当前状态镜像到私有仓（2026-09-02 制作人拍板的双仓设计）。
//
// 形制照抄监制台那一对：**公开仓是产品本身、迭代发生在那里；私有仓是拿来用的那一份。**
//   Ticketflow（公开，引擎）  ↔  AI-GameStudio（私有，跑它的工作室）
//   gamedev-terminal（公开）  ↔  gamedev-terminal-private（私有镜像）
//
// **做成一条命令，不做成一件要记住的事。**
// 「记得推一下私有仓」这种规矩，漏掉的时候不会报错——两边就这么慢慢分了家，
// 而分家的表现是「我在公开仓修好的那个 bug，用的那份还在犯」。
//
// 跑法：`npm run 镜像`
'use strict';
const { spawnSync } = require('child_process');

const 跑 = (...args) => {
  const r = spawnSync('git', args, { encoding: 'utf8', cwd: process.cwd() });
  return { 码: r.status, 出: String((r.stdout || '') + (r.stderr || '')).trim() };
};

const 说 = (...a) => console.log(...a);

// ① 两个远端都得在。缺一个就明说缺哪个，别让人对着一句 git 的报错猜。
const 远 = 跑('remote').出.split(/\r?\n/).filter(Boolean);
for (const 名 of ['origin', 'private']) {
  if (!远.includes(名)) {
    console.error(`没有 ${名} 远端。双仓设计要两个：`);
    console.error('  git remote add origin  https://github.com/<你>/gamedev-terminal.git');
    console.error('  git remote add private https://github.com/<你>/gamedev-terminal-private.git');
    process.exit(1);
  }
}

// ② **本地有没有没提交的改动。** 镜像的是提交，不是工作树；
//    有脏改动时镜像过去的和你眼前看到的不是同一份，而这件事不说出来就没人知道。
const 脏 = 跑('status', '--porcelain').出;
if (脏) {
  说('注意：工作区有未提交的改动，它们**不会**被镜像过去——');
  说(脏.split(/\r?\n/).slice(0, 8).map((l) => '  ' + l).join('\n'));
  说('');
}

// ③ 先确认公开仓是最新的。私有仓是镜像，镜像先于本体更新是没有意义的。
const 支 = 跑('rev-parse', '--abbrev-ref', 'HEAD').出 || 'master';
const 落后 = 跑('rev-list', '--count', `origin/${支}..HEAD`).出;
if (落后 && 落后 !== '0') {
  说(`本地比公开仓多 ${落后} 个提交 —— 先推公开仓（迭代在那边）：`);
  const p = 跑('push', 'origin', 支);
  说(p.出 || '（无输出）');
  if (p.码 !== 0) process.exit(p.码);
}

// ④ 镜像。用 --force：私有仓是**跟随**公开仓的那一份，
//    它自己不该有独立提交；真有的话那是分家了，应当当场发现而不是自动合并掉。
const 私前 = 跑('ls-remote', 'private', `refs/heads/${支}`).出.split(/\s/)[0] || '(空)';
const m = 跑('push', '--force', 'private', 支);
说(m.出 || '（无输出）');
if (m.码 !== 0) process.exit(m.码);
const 私后 = 跑('ls-remote', 'private', `refs/heads/${支}`).出.split(/\s/)[0] || '(空)';
const 本 = 跑('rev-parse', 'HEAD').出;

说('');
说('  公开仓 origin  :', 跑('ls-remote', 'origin', `refs/heads/${支}`).出.split(/\s/)[0] || '(空)');
说('  私有仓 private :', 私后, 私前 === 私后 ? '（本来就是这个，没变）' : `（原 ${私前.slice(0, 7)}）`);
说('  本地 HEAD      :', 本);
// **判据是三个哈希相等，不是「push 没报错」。**
// 这条与换装仪式第 7 条同一个道理：命令跑通不等于那件事发生了。
const 对上了 = 私后 === 本;
说('');
说(对上了 ? '镜像完成：私有仓与本地 HEAD 是同一个提交。'
  : `**镜像没对上**：私有仓在 ${私后}，本地在 ${本}。`);
process.exit(对上了 ? 0 : 1);
