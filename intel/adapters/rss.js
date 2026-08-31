// rss.js — RSS/Atom 通用适配器（施工令 P4：一个模块吃所有 RSS 源）
//
// 输出统一条目形状（§3.2）。RSS 与 Atom 字段名不同但语义一一对应，这里做一次归一：
//   RSS:  <item>  <title> <link> <description> <pubDate>
//   Atom: <entry> <title> <link href=> <summary>|<content> <published>|<updated>
//
// 解析交给 fast-xml-parser 而不是手写正则——这两天我在解析器上栽了四次
// （围栏、章节被注释腰斩、应答表读假编号、CRLF 锚点），共同点都是「手写解析遇到没预料的形状就静默出错」。
// XML 尤其如此：CDATA、实体、命名空间、自闭合，随便一个都够写出一个看着能跑的错解析器。
const { XMLParser } = require('fast-xml-parser');

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  // CDATA 与实体交给解析器，别自己拆
  processEntities: true,
  trimValues: true,
});

// 取值：XML 节点可能是字符串、也可能是 { '#text': ... } 或数组
function 文(v) {
  if (v == null) return '';
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (Array.isArray(v)) return 文(v[0]);
  if (typeof v === 'object') return 文(v['#text'] != null ? v['#text'] : '');
  return '';
}

// Atom 的 link 是属性形；可能有多条（rel=alternate 才是正文链接）
function 取链接(item) {
  const l = item.link;
  if (typeof l === 'string') return l.trim();
  if (Array.isArray(l)) {
    const alt = l.find((x) => x && x['@rel'] === 'alternate' && x['@href']);
    if (alt) return String(alt['@href']).trim();
    const 有href = l.find((x) => x && x['@href']);
    if (有href) return String(有href['@href']).trim();
    return 文(l).trim();
  }
  if (l && typeof l === 'object' && l['@href']) return String(l['@href']).trim();
  // 有些 RSS 把正文链接放 guid（isPermaLink=true）
  const g = item.guid;
  if (g && (typeof g === 'string' || g['#text'])) {
    const s = 文(g).trim();
    if (/^https?:\/\//i.test(s)) return s;
  }
  return '';
}

// 时刻归一成 ISO 8601；解析不出来回 null（**不拿抓取时刻冒充发布时刻**——
// 那会让所有无日期条目都拿满新鲜度分，等于凭空造数）
function 时刻(s) {
  const raw = 文(s).trim();
  if (!raw) return null;
  const t = Date.parse(raw);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

// 摘要限长：原始流台账要能长期留存，单条不该塞进整篇正文
const 限长 = (s, n = 600) => {
  const t = 文(s).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n) + '…' : t;
};

// 解析(xml) → [{ title, url, raw_excerpt, published_at }]，不含源信息（由调用方补）
function 解析(xml) {
  let doc;
  try { doc = parser.parse(String(xml)); } catch (e) { throw new Error('XML 解不开：' + e.message); }

  // RSS 2.0 / RDF / Atom 三种根形
  const rss = doc.rss && doc.rss.channel;
  const rdf = doc['rdf:RDF'];
  const atom = doc.feed;

  let 原始 = [];
  if (rss) 原始 = [].concat(rss.item || []);
  else if (rdf) 原始 = [].concat(rdf.item || []);
  else if (atom) 原始 = [].concat(atom.entry || []);
  else throw new Error('认不出的 feed 根节点（既非 rss/rdf 也非 atom）');

  const 出 = [];
  for (const it of 原始) {
    if (!it || typeof it !== 'object') continue;
    const url = 取链接(it);
    const title = 限长(it.title, 300);
    // 没有链接就没有身份（dedupe_key 靠 URL），没有标题就没法读——两者缺一即丢弃并计数
    if (!url || !title) continue;
    出.push({
      title,
      url,
      raw_excerpt: 限长(it.description != null ? it.description
        : (it.summary != null ? it.summary : it.content)),
      published_at: 时刻(it.pubDate != null ? it.pubDate
        : (it.published != null ? it.published
          : (it.updated != null ? it.updated : it['dc:date']))),
    });
  }
  return { 条目: 出, 原始条数: 原始.length, 丢弃: 原始.length - 出.length };
}

module.exports = { 解析, 规范时刻: 时刻, 取链接, 限长 };
