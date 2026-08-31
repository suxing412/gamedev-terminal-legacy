// 编辑器.js — 文稿台编辑态（批四）。**这份是源码，打包产物在 public/编辑器.js。**
//
// 改了这里必须重新 `npm run build:web`，否则界面上跑的还是旧的——
// 而那**看不出任何异常**（终端 0.17.2 踩过同族：asar mtime 恒定 + Chromium 磁盘缓存持久，
// 换了新版还是旧 UI）。所以有一条判据 `test/构建.test.js` 专盯产物与源码是否一致。
//
// ── 为什么把 md.js 也打进来 ────────────────────────────────────────
// 预览要跟着打字实时更新。走服务端渲染就是每次按键一个来回；
// md.js 是纯函数、没有 node 依赖，直接打进包，预览在本地渲染。
// **同一份渲染器**——预览和存盘后的阅读态不会长得不一样。
import { EditorState, Compartment } from '@codemirror/state';
import {
  EditorView, keymap, lineNumbers, highlightActiveLine,
  highlightActiveLineGutter, drawSelection, dropCursor,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { syntaxHighlighting, HighlightStyle, bracketMatching } from '@codemirror/language';
import { search, searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { tags as t } from '@lezer/highlight';
import * as Diff from 'diff';
import md from '../server/render/md.js';

// ── 主题 ───────────────────────────────────────────────────────────
// 颜色全走 tokens.css 的变量，不在这里另立一套——
// 编辑器和它周围那块屏必须是同一个色域，否则它看着像嵌进来的别人家的控件。
const 主题 = EditorView.theme({
  '&': { color: 'var(--ink)', backgroundColor: 'var(--ground)', height: '100%', fontSize: '13.5px' },
  '.cm-content': {
    fontFamily: 'var(--mono)',
    caretColor: 'var(--gate)',
    padding: '16px 0 40vh',
    lineHeight: '1.75',
  },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--gate)', borderLeftWidth: '2px' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
    backgroundColor: 'color-mix(in oklch, var(--gate) 22%, transparent)',
  },
  '.cm-gutters': {
    backgroundColor: 'var(--panel)', color: 'var(--ink-3)',
    border: 'none', borderRight: '1px solid var(--line-soft)', fontFamily: 'var(--mono)', fontSize: '11px',
  },
  '.cm-activeLine': { backgroundColor: 'color-mix(in oklch, var(--raised) 55%, transparent)' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--ink-2)' },
  '.cm-panels': { backgroundColor: 'var(--panel)', color: 'var(--ink-2)', borderColor: 'var(--line)' },
  '.cm-panel input, .cm-panel button': {
    background: 'var(--ground)', color: 'var(--ink)', border: '1px solid var(--line)',
    borderRadius: '4px', font: 'inherit', fontSize: '12px', padding: '3px 7px',
  },
  '.cm-searchMatch': { backgroundColor: 'color-mix(in oklch, var(--warn) 28%, transparent)' },
  '.cm-searchMatch-selected': { backgroundColor: 'color-mix(in oklch, var(--gate) 40%, transparent)' },
  '.cm-scroller': { overflow: 'auto' },
}, { dark: true });

// 语法高亮。**三级以下不再缩小字号**——再小就不是层级是噪声了，用颜色与字重拉开
// （与 prose.css 的 h4-h6 同口径）。
const 高亮 = HighlightStyle.define([
  { tag: t.heading1, color: 'var(--ink)', fontWeight: '600', fontSize: '1.25em' },
  { tag: t.heading2, color: 'var(--ink)', fontWeight: '600', fontSize: '1.12em' },
  { tag: t.heading3, color: 'var(--ink)', fontWeight: '600' },
  { tag: [t.heading4, t.heading5, t.heading6], color: 'var(--ink-2)', fontWeight: '600' },
  { tag: t.strong, color: 'var(--ink)', fontWeight: '700' },
  { tag: t.emphasis, color: 'var(--ink)', fontStyle: 'italic' },
  { tag: t.link, color: 'var(--gate)' },
  { tag: t.url, color: 'var(--ink-3)' },
  { tag: [t.monospace, t.content], color: 'var(--live)' },
  { tag: t.quote, color: 'var(--ink-2)', fontStyle: 'italic' },
  { tag: [t.list, t.processingInstruction], color: 'var(--gate)' },
  { tag: t.contentSeparator, color: 'var(--ink-3)' },
  { tag: t.comment, color: 'var(--ink-3)' },
]);

const 记号们 = ['改', '加', '删', '问'];

// ── 段落定位 ───────────────────────────────────────────────────────
// 「这一段」的边界＝前后的空行。围栏与表格是整块，不该被从中间切开。
function 段边界(文行, 行号) {
  const i = Math.max(0, Math.min(文行.length - 1, 行号 - 1));
  const 空 = (n) => n < 0 || n >= 文行.length || !文行[n].trim();
  if (空(i)) return { 起: i + 1, 止: i + 1 };
  let a = i; let b = i;
  while (!空(a - 1)) a--;
  while (!空(b + 1)) b++;
  return { 起: a + 1, 止: b + 1 };
}

/**
 * 往某一段插记号。落点是**该段最后一行的行尾**——
 * 「这一段要改【改】」读起来是顺的，插在段首会把标题之类的开头切断。
 * 已经有同样的记号就不重复插（点两次不该出现【改】【改】）。
 */
function 插记号(view, 记号, 行号) {
  const 文 = view.state.doc.toString();
  const 行们 = 文.split('\n');
  const 目标行 = 行号 || view.state.doc.lineAt(view.state.selection.main.head).number;
  const { 止 } = 段边界(行们, 目标行);
  const L = view.state.doc.line(Math.min(止, view.state.doc.lines));
  const 记 = `【${记号}】`;
  if (L.text.includes(记)) return { 变: false, 因: '这一段已经有' + 记 };
  view.dispatch({
    changes: { from: L.to, insert: (L.text.endsWith(' ') ? '' : ' ') + 记 },
    selection: { anchor: L.to + 1 + 记.length },
    scrollIntoView: true,
  });
  return { 变: true, 行: L.number };
}

// ── 预览 ───────────────────────────────────────────────────────────
// 每块旁边挂四个按钮。**这是制作人点名要的那件事**：
// 「文稿某一段一键标改，某一段一键标加」。
function 画预览(容器, 文) {
  const html = md.渲染(文, { 行号: true });
  容器.innerHTML = html;
  for (const el of 容器.querySelectorAll('[data-行]')) {
    const n = el.getAttribute('data-行');
    const 组 = document.createElement('span');
    组.className = '预记组';
    组.setAttribute('contenteditable', 'false');
    组.innerHTML = 记号们.map((k) =>
      `<button type="button" class="预记 记${k}" data-记="${k}" data-行="${n}" title="给这一段标【${k}】">${k}</button>`).join('');
    el.appendChild(组);
  }
}

// ── 三路差异 ───────────────────────────────────────────────────────
// 冲突时不弹「文件已变更，是否覆盖」——**那个框所有人都点确定**。
// 给的是三块：盘上是什么、我改的是什么、以及两边各自相对 base 动了哪里。
function 画差异(旧, 新) {
  const 块 = Diff.diffLines(String(旧 || ''), String(新 || ''));
  const 行 = [];
  for (const b of 块) {
    const 类 = b.added ? '增' : b.removed ? '删' : '同';
    const 记 = b.added ? '+' : b.removed ? '-' : ' ';
    for (const l of b.value.replace(/\n$/, '').split('\n')) {
      行.push(`<div class="差行 差${类}"><i>${记}</i><span></span></div>`
        .replace('<span></span>', `<span>${l.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))}</span>`));
    }
  }
  return 行.join('');
}

// ── 装 ─────────────────────────────────────────────────────────────
function 装({ 编辑格, 预览格, 初文, 变了 }) {
  const 换行 = new Compartment();
  const view = new EditorView({
    parent: 编辑格,
    state: EditorState.create({
      doc: String(初文 == null ? '' : 初文),
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        drawSelection(),
        dropCursor(),
        history(),
        bracketMatching(),
        search({ top: true }),
        highlightSelectionMatches(),
        markdown(),
        syntaxHighlighting(高亮),
        主题,
        // **软换行是刚需，不是偏好。**实测协议库里最长的单元格 1207 字节
        // （≈400 汉字一行）；没有软换行就得横着拖，那份文档等于读不了。
        换行.of(EditorView.lineWrapping),
        keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
        EditorView.updateListener.of((u) => { if (u.docChanged) 变了(view.state.doc.toString()); }),
      ],
    }),
  });

  let 预防抖 = null;
  const 刷预览 = (立刻) => {
    if (!预览格) return;
    clearTimeout(预防抖);
    const 干 = () => 画预览(预览格, view.state.doc.toString());
    if (立刻) 干(); else 预防抖 = setTimeout(干, 160);
  };
  刷预览(true);

  return {
    view,
    取文: () => view.state.doc.toString(),
    设文(文) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: String(文) } });
      刷预览(true);
    },
    插记号: (记号, 行) => { const r = 插记号(view, 记号, 行); 刷预览(true); return r; },
    刷预览,
    跳到(行号) {
      const n = Math.max(1, Math.min(view.state.doc.lines, Number(行号) || 1));
      const L = view.state.doc.line(n);
      view.dispatch({ selection: { anchor: L.from }, scrollIntoView: true });
      view.focus();
    },
    销毁() { clearTimeout(预防抖); view.destroy(); },
  };
}

// 打成 IIFE，挂在 window 上给 public/文稿.js 用（那份是普通脚本，不是模块）
window.文稿编辑 = { 装, 画差异, 记号们, 段边界 };
