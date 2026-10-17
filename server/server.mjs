/* AI 回答存档 —— 本机服务
 * 只监听 127.0.0.1，负责把扩展传来的图片 / Markdown 写成文件。
 *
 * 启动：双击 start-server.cmd（或 node server.mjs）
 * 配置：同目录 config.json，可选 {"root": "D:\\我的资料\\AI存档", "port": 8765}
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const VERSION = '1.1.0';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(HERE, 'config.json');

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    return {};
  }
}

const cfg = loadConfig();

function resolveRoot(p) {
  if (!p) return path.join(HERE, '..', 'data');
  return path.isAbsolute(p) ? path.normalize(p) : path.resolve(HERE, p);
}

const ROOT = resolveRoot(cfg.root);
const PORT = Number(cfg.port) || 8765;
const MAX_BODY = 120 * 1024 * 1024;

fs.mkdirSync(ROOT, { recursive: true });

/* ------------------------------ 工具 ------------------------------ */

function json(res, obj, code = 200) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// Windows 文件名安全化
function safeName(s, max = 60) {
  let t = String(s == null ? '' : s)
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  t = t.replace(/^\.+/, '').replace(/[. ]+$/, '');
  if (t.length > max) t = t.slice(0, max).trim();
  return t;
}

const pad = (n) => String(n).padStart(2, '0');

function dayStr(d = new Date()) {
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

function stamp(d = new Date()) {
  return pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
}

function fullTime(d = new Date()) {
  return dayStr(d) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
}

function uniquePath(dir, base, ext) {
  let p = path.join(dir, base + ext);
  let i = 2;
  while (fs.existsSync(p)) {
    p = path.join(dir, base + '-' + i + ext);
    i++;
  }
  return p;
}

function listTypes() {
  try {
    return fs.readdirSync(ROOT, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
      .map((d) => d.name)
      .sort((a, b) => a.localeCompare(b, 'zh'));
  } catch {
    return [];
  }
}

// 某个分类下已经存在的子分类（新的排前面）
function listSubs(type) {
  const t = safeName(type, 40);
  if (!t) return [];
  const dir = path.join(ROOT, t);
  if (!insideRoot(dir)) return [];
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
      .map((d) => d.name)
      .sort((a, b) => b.localeCompare(a, 'zh'));
  } catch {
    return [];
  }
}

function insideRoot(p) {
  const a = path.resolve(p).toLowerCase();
  const b = path.resolve(ROOT).toLowerCase();
  return a === b || a.startsWith(b + path.sep);
}

/* --------------------------- Markdown → HTML --------------------------- */

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function mdToHtml(md) {
  const codeBlocks = [];
  const src = md.replace(/```([^\n`]*)\r?\n([\s\S]*?)```/g, (m, lang, code) => {
    codeBlocks.push({ lang: String(lang).trim(), code });
    return '\n\n@@CB' + (codeBlocks.length - 1) + '@@\n\n';
  });

  // 行内元素：先把公式抽成占位符，避免 * 和 _ 被当成强调符
  const inline = (s) => {
    const maths = [];
    let t = s
      .replace(/\$\$([\s\S]+?)\$\$/g, (m, x) => { maths.push('$$' + x + '$$'); return '@@M' + (maths.length - 1) + '@@'; })
      .replace(/\$([^$\n]+?)\$/g, (m, x) => { maths.push('$' + x + '$'); return '@@M' + (maths.length - 1) + '@@'; });

    t = esc(t);
    t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
    t = t.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, '<img src="$2" alt="$1">');
    t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
    t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    t = t.replace(/(^|[^*\w])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    t = t.replace(/~~([^~]+)~~/g, '<del>$1</del>');
    t = t.replace(/@@M(\d+)@@/g, (m, i) => esc(maths[Number(i)]));
    return t;
  };

  const out = [];
  for (const raw of src.split(/\n{2,}/)) {
    const t = raw.trim();
    if (!t) continue;

    const cb = /^@@CB(\d+)@@$/.exec(t);
    if (cb) {
      const b = codeBlocks[Number(cb[1])];
      const cls = b.lang ? ' class="language-' + esc(b.lang) + '"' : '';
      out.push('<pre><code' + cls + '>' + esc(b.code.replace(/\n$/, '')) + '</code></pre>');
      continue;
    }

    if (/^([-*_])\1{2,}$/.test(t)) { out.push('<hr>'); continue; }

    const h = /^(#{1,6})\s+([\s\S]*)$/.exec(t);
    if (h && t.indexOf('\n') === -1) {
      const lv = h[1].length;
      out.push('<h' + lv + '>' + inline(h[2]) + '</h' + lv + '>');
      continue;
    }

    if (t.startsWith('>')) {
      const inner = t.split('\n').map((l) => l.replace(/^>\s?/, '')).join(' ');
      out.push('<blockquote>' + inline(inner) + '</blockquote>');
      continue;
    }

    const lines = t.split('\n').filter((l) => l.trim());

    if (lines.length >= 2 && lines[0].indexOf('|') !== -1 && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[1])) {
      const cells = (l) => l.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim());
      const head = cells(lines[0]);
      const body = lines.slice(2).map(cells);
      out.push(
        '<table><thead><tr>' + head.map((c) => '<th>' + inline(c) + '</th>').join('') + '</tr></thead><tbody>' +
        body.map((r) => '<tr>' + r.map((c) => '<td>' + inline(c) + '</td>').join('') + '</tr>').join('') +
        '</tbody></table>'
      );
      continue;
    }

    if (/^\s*(?:[-*+]|\d+\.)\s/.test(lines[0])) {
      const ordered = /^\s*\d+\./.test(lines[0]);
      const tag = ordered ? 'ol' : 'ul';
      const items = lines.map((l) => '<li>' + inline(l.replace(/^\s*(?:[-*+]|\d+\.)\s+/, '')) + '</li>');
      out.push('<' + tag + '>' + items.join('') + '</' + tag + '>');
      continue;
    }

    out.push('<p>' + inline(t.replace(/\n/g, ' ')) + '</p>');
  }

  return out.join('\n');
}

function renderHtml(title, meta, question, body) {
  const metaHtml = meta.trim().split('\n').map((l) => esc(l.replace(/^-\s*/, ''))).join('<br>');
  const qHtml = question
    ? '<div class="q"><div class="lbl">我的提问</div>' + esc(question).replace(/\n/g, '<br>') + '</div>'
    : '';
  return '<!doctype html>\n<html lang="zh-CN">\n<head>\n<meta charset="utf-8">\n' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">\n' +
    '<title>' + esc(title) + '</title>\n<style>\n' +
    '  :root { color-scheme: light dark; }\n' +
    '  body { max-width: 820px; margin: 0 auto; padding: 34px 20px 90px;\n' +
    '    font: 16px/1.85 "Microsoft YaHei", system-ui, -apple-system, sans-serif; }\n' +
    '  .meta { color: #6b7280; font-size: 13px; line-height: 1.9;\n' +
    '    border-bottom: 1px solid #e5e7eb; padding-bottom: 12px; margin-bottom: 26px; }\n' +
    '  .q { background: #eef4ff; border-left: 4px solid #2f6fed; border-radius: 6px;\n' +
    '    padding: 12px 18px; margin: 0 0 28px; white-space: pre-wrap; }\n' +
    '  .q .lbl { font-size: 12px; color: #2f6fed; font-weight: 600; margin-bottom: 4px; }\n' +
    '  h1 { font-size: 26px; } h2 { font-size: 21px; margin-top: 34px; }\n' +
    '  h3 { font-size: 18px; margin-top: 28px; } h4 { font-size: 16px; margin-top: 24px; }\n' +
    '  code { background: #f3f4f6; padding: 2px 6px; border-radius: 4px;\n' +
    '    font: 14px/1.6 ui-monospace, Consolas, monospace; }\n' +
    '  pre { background: #1e2229; color: #e6e8ec; padding: 15px 18px; border-radius: 8px;\n' +
    '    overflow-x: auto; line-height: 1.65; }\n' +
    '  pre code { background: none; color: inherit; padding: 0; }\n' +
    '  blockquote { margin: 16px 0; padding: 10px 18px; border-left: 3px solid #2f6fed;\n' +
    '    background: #f7f9fd; color: #3a4050; }\n' +
    '  table { border-collapse: collapse; width: 100%; margin: 18px 0; font-size: 15px; }\n' +
    '  th, td { border: 1px solid #dfe2e7; padding: 8px 11px; text-align: left; }\n' +
    '  th { background: #f6f7f9; }\n' +
    '  img { max-width: 100%; }\n' +
    '  hr { border: 0; border-top: 1px solid #e5e7eb; margin: 28px 0; }\n' +
    '</style>\n' +
    '<script>window.MathJax={tex:{inlineMath:[["$","$"]],displayMath:[["$$","$$"]]}};</script>\n' +
    '<script async src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js"></script>\n' +
    '</head>\n<body>\n' +
    '<div class="meta">' + metaHtml + '</div>\n' +
    qHtml + '\n<article>\n' + body + '\n</article>\n</body>\n</html>\n';
}

/* ------------------------------ 保存 ------------------------------ */

function handleSave(payload) {
  const type = safeName(payload.type, 40) || '未分类';
  const sub = safeName(payload.sub, 40) || dayStr();
  const title = safeName(payload.title, 50) || 'AI回答';

  const dir = path.join(ROOT, type, sub);
  fs.mkdirSync(dir, { recursive: true });

  const base = title + '_' + stamp();
  const files = [];
  const images = Array.isArray(payload.images) ? payload.images : [];

  images.forEach((img, i) => {
    if (!img || !img.base64) return;
    const suffix = images.length > 1 ? '_' + (i + 1) : '';
    const p = uniquePath(dir, base + suffix, '.png');
    fs.writeFileSync(p, Buffer.from(img.base64, 'base64'));
    files.push(path.basename(p));
  });

  const question = String(payload.question || '').trim();
  const md = String(payload.markdown || '').trim();
  const meta =
    '- 来源：' + (payload.url || '未知') + '\n' +
    '- 站点：' + (payload.site || '未知') + '\n' +
    '- 保存时间：' + fullTime();

  if (md) {
    // .md —— 给笔记软件（Obsidian / Notion 等）用的源文件
    const qPart = question ? '\n## ❓ 我的提问\n\n' + question + '\n\n---\n' : '';
    const p = uniquePath(dir, base, '.md');
    fs.writeFileSync(p, '# ' + title + '\n\n' + meta + '\n\n---\n' + qPart + '\n' + md + '\n', 'utf8');
    files.push(path.basename(p));

    // .html —— 双击用浏览器打开就是排好版的，不用装任何东西
    const p2 = uniquePath(dir, base, '.html');
    fs.writeFileSync(p2, renderHtml(title, meta, question, mdToHtml(md)), 'utf8');
    files.push(path.basename(p2));
  }

  const bytes = files.reduce((n, f) => {
    try { return n + fs.statSync(path.join(dir, f)).size; } catch { return n; }
  }, 0);

  console.log('[' + fullTime() + '] 已保存 ' + files.length + ' 个文件 → ' + dir);
  return { ok: true, dir, files, bytes };
}

/* ------------------------------ 服务 ------------------------------ */

function isExtensionOrigin(origin) {
  return origin.startsWith('chrome-extension://');
}

function isAllowedOrigin(origin) {
  return isExtensionOrigin(origin) || /^http:\/\/localhost(?::\d+)?$/.test(origin);
}

const server = http.createServer(async (req, res) => {
  const origin = String(req.headers.origin || '');
  if (isAllowedOrigin(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');

  if (req.method === 'OPTIONS') {
    if (origin && !isAllowedOrigin(origin)) {
      json(res, { ok: false, error: 'forbidden' }, 403);
      return;
    }
    res.writeHead(204);
    res.end();
    return;
  }

  let url;
  try {
    url = new URL(req.url, 'http://127.0.0.1');
  } catch {
    json(res, { ok: false, error: '非法 URL' }, 400);
    return;
  }

  try {
    if (req.method === 'GET' && url.pathname === '/ping') {
      json(res, { ok: true, root: ROOT, port: PORT, version: VERSION });
      return;
    }

    // 让扩展在服务版本过旧时把它换掉（不然新代码永远不生效）
    if (req.method === 'POST' && url.pathname === '/shutdown') {
      if (!isExtensionOrigin(origin)) {
        json(res, { ok: false, error: 'forbidden' }, 403);
        return;
      }
      json(res, { ok: true, version: VERSION });
      console.log('[' + fullTime() + '] 收到 shutdown，进程退出');
      setTimeout(() => process.exit(0), 150);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/types') {
      json(res, { ok: true, types: listTypes() });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/subs') {
      json(res, { ok: true, subs: listSubs(url.searchParams.get('type') || '') });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/save') {
      if (!isExtensionOrigin(origin)) {
        json(res, { ok: false, error: 'forbidden' }, 403);
        return;
      }
      const raw = await readBody(req);
      let payload;
      try {
        payload = JSON.parse(raw);
      } catch {
        json(res, { ok: false, error: '请求体不是合法 JSON' }, 400);
        return;
      }
      json(res, handleSave(payload));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/open') {
      if (!isExtensionOrigin(origin)) {
        json(res, { ok: false, error: 'forbidden' }, 403);
        return;
      }
      const raw = await readBody(req);
      let body = {};
      try { body = JSON.parse(raw || '{}'); } catch { /* 忽略 */ }
      let dir;
      if (!body.path) {
        dir = ROOT;
      } else if (insideRoot(body.path)) {
        dir = path.normalize(body.path);
      } else {
        json(res, { ok: false, error: '路径不在存档目录内' }, 403);
        return;
      }
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      spawn('explorer.exe', [dir], { detached: true, stdio: 'ignore' }).unref();
      json(res, { ok: true, dir });
      return;
    }

    json(res, { ok: false, error: '未知接口 ' + url.pathname }, 404);
  } catch (e) {
    json(res, { ok: false, error: String((e && e.message) || e) }, 500);
  }
});

server.on('error', (e) => {
  if (e && e.code === 'EADDRINUSE') {
    console.error('端口 ' + PORT + ' 已被占用。可能服务已经在跑了，或者改一下 config.json 里的 port。');
  } else {
    console.error('服务出错：', e);
  }
  process.exitCode = 1;
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('========================================');
  console.log('  AI 回答存档服务已启动');
  console.log('  监听：http://127.0.0.1:' + PORT);
  console.log('  存档目录：' + ROOT);
  console.log('  关闭这个窗口即停止服务。');
  console.log('========================================');
});
