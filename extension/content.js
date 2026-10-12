/* AI 回答存档 —— 页面脚本
 * 1. 点选页面上的“一条回答”
 * 2. 面板里填 类型 / 子分类 / 文件名
 * 3. 自动滚动拼接成长图（保持 100% 缩放，字不变小）+ 提取 Markdown
 * 4. 交给本机服务落盘
 */
(() => {
  'use strict';

  const CTRL = '__AI_ARCHIVE_CTRL__';
  if (window[CTRL]) { window[CTRL].start(); return; }

  const Z = 2147483647;
  const CAPTURE_GAP_MS = 600;     // captureVisibleTab 限速约 2 次/秒
  const MAX_CANVAS_H = 30000;     // 单张图高度上限，超过就分段

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const clamp = (v, a, b) => Math.min(Math.max(v, a), b);

  function send(type, extra) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(Object.assign({ type }, extra || {}), (resp) => {
          const err = chrome.runtime.lastError;
          if (err) resolve({ ok: false, error: err.message });
          else resolve(resp || { ok: false, error: '扩展后台无响应' });
        });
      } catch (e) {
        resolve({ ok: false, error: String((e && e.message) || e) });
      }
    });
  }

  function loadImage(src) {
    return new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = () => rej(new Error('截图解码失败'));
      img.src = src;
    });
  }

  function describeEl(el) {
    const tag = el.tagName ? el.tagName.toLowerCase() : '?';
    let cls = '';
    if (typeof el.className === 'string' && el.className.trim()) {
      cls = '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.');
    }
    const r = el.getBoundingClientRect();
    return '<' + tag + cls + '>  ' + Math.round(r.width) + '×' + Math.round(r.height);
  }

  function toast(text, ms) {
    const t = document.createElement('div');
    t.style.cssText = [
      'position:fixed', 'z-index:' + Z, 'left:50%', 'bottom:36px', 'transform:translateX(-50%)',
      'background:rgba(20,22,28,.94)', 'color:#fff', 'padding:10px 18px', 'border-radius:22px',
      'font:13px/1.5 "Microsoft YaHei",system-ui,sans-serif', 'pointer-events:none',
      'box-shadow:0 6px 24px rgba(0,0,0,.35)', 'max-width:80vw'
    ].join(';');
    t.textContent = text;
    document.documentElement.appendChild(t);
    setTimeout(() => t.remove(), ms || 2200);
  }

  /* ===================== 选择模式 ===================== */

  let pick = null;

  function enterPickMode(opts) {
    if (pick) return;
    const hint = (opts && opts.hint) || '把鼠标移到要存档的回答上，单击选中 · Esc 取消';
    const shortHint = (opts && opts.shortHint) || '单击选中 · Esc 取消';
    const onPicked = (opts && opts.onPicked) || null;
    const onCancel = (opts && opts.onCancel) || null;

    const box = document.createElement('div');
    box.style.cssText = [
      'position:fixed', 'z-index:' + Z, 'pointer-events:none', 'display:none',
      'border:2px solid #2f6fed', 'background:rgba(47,111,237,.14)', 'border-radius:3px',
      'box-shadow:inset 0 0 0 1px rgba(255,255,255,.55)'
    ].join(';');

    const bar = document.createElement('div');
    bar.style.cssText = [
      'position:fixed', 'z-index:' + Z, 'left:50%', 'top:14px', 'transform:translateX(-50%)',
      'pointer-events:none', 'background:rgba(20,22,28,.92)', 'color:#fff', 'padding:8px 16px',
      'border-radius:20px', 'font:13px/1.5 "Microsoft YaHei",system-ui,sans-serif',
      'box-shadow:0 4px 18px rgba(0,0,0,.32)', 'white-space:nowrap'
    ].join(';');
    bar.textContent = hint;

    document.documentElement.appendChild(box);
    document.documentElement.appendChild(bar);

    let cur = null;

    const onMove = (e) => {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      if (!el || el === cur || el === box || el === bar) return;
      if (el === document.documentElement) return;
      cur = el;
      const r = el.getBoundingClientRect();
      box.style.display = 'block';
      box.style.left = r.left + 'px';
      box.style.top = r.top + 'px';
      box.style.width = r.width + 'px';
      box.style.height = r.height + 'px';
      bar.textContent = describeEl(el) + ' · ' + shortHint;
    };
    const swallow = (e) => { e.preventDefault(); e.stopPropagation(); };
    const onClick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const el = document.elementFromPoint(e.clientX, e.clientY);
      exitPickMode();
      if (!el) return;
      if (onPicked) { onPicked(el); return; }
      const chain = [];
      let p = el;
      while (p && p !== document.documentElement) { chain.push(p); p = p.parentElement; }
      chain.push(document.documentElement);
      openPanel(chain, guessIndex(chain));
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        exitPickMode();
        if (onCancel) onCancel();
        else toast('已取消');
      }
    };

    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('mousedown', swallow, true);
    document.addEventListener('mouseup', swallow, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKey, true);

    pick = {
      cleanup() {
        document.removeEventListener('mousemove', onMove, true);
        document.removeEventListener('mousedown', swallow, true);
        document.removeEventListener('mouseup', swallow, true);
        document.removeEventListener('click', onClick, true);
        document.removeEventListener('keydown', onKey, true);
        box.remove();
        bar.remove();
      }
    };
  }

  function exitPickMode() {
    if (!pick) return;
    pick.cleanup();
    pick = null;
  }

  // 从最内层往外找第一个“像一条回答”的元素
  function guessIndex(chain) {
    for (let i = 0; i < chain.length; i++) {
      const el = chain[i];
      const r = el.getBoundingClientRect();
      const txt = (el.innerText || '').trim();
      if (r.height >= 60 && txt.length >= 150) return i;
    }
    return 0;
  }

  // 这些行是纯操作按钮的文字，不算提问内容
  const UI_LINE = /^(复制|编辑|删除|重新生成|分享|点赞|点踩|赞|踩|收起|展开|深度思考|智能搜索|联网搜索|Copy|Edit|Retry|Regenerate|Regenerate response)$/i;

  function stripUiLines(t) {
    return String(t).split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !UI_LINE.test(l))
      .join('\n')
      .trim();
  }

  // 猜一下这条回答对应的提问（从回答块往前找最近的、像是提问的兄弟块）
  function guessQuestion(target) {
    let node = target;
    for (let d = 0; d < 6 && node && node !== document.body; d++) {
      let sib = node.previousElementSibling;
      let guard = 0;
      while (sib && guard++ < 5) {
        const txt = stripUiLines(sib.innerText || '');
        const r = sib.getBoundingClientRect();
        // 只看文字：带按钮不算错（气泡旁边常有复制/编辑图标），纯 UI 词的行已经被滤掉了
        if (txt.length >= 4 && txt.length <= 2500 && r.height >= 16) return txt;
        sib = sib.previousElementSibling;
      }
      node = node.parentElement;
    }
    return '';
  }

  // 把面板临时藏起来，让用户点一下页面上的「提问」
  function pickQuestionInto() {
    if (!panel) return;
    const p = panel;
    const restore = () => { if (panel === p) p.host.style.display = ''; };
    p.host.style.display = 'none';
    enterPickMode({
      hint: '点一下你要保存的那条「提问」 · Esc 取消',
      shortHint: '单击选中 · Esc 取消',
      onPicked: (el) => {
        restore();
        const t = (el.innerText || '').trim();
        p.elQ.value = t.length > 4000 ? t.slice(0, 4000) : t;
      },
      onCancel: () => { restore(); toast('已取消'); }
    });
  }

  /* ===================== 面板 ===================== */

  let panel = null;   // { host, shadow, hl, chain, idx, els... }

  const PANEL_CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .box {
      position: fixed; right: 16px; bottom: 16px; width: 330px; z-index: ${Z};
      background: #ffffff; color: #1b1d22; border-radius: 12px;
      box-shadow: 0 10px 40px rgba(0,0,0,.28), 0 0 0 1px rgba(0,0,0,.07);
      font: 13px/1.6 "Microsoft YaHei", system-ui, sans-serif; overflow: hidden;
    }
    .hd {
      padding: 11px 14px; font-weight: 600; font-size: 13.5px;
      background: #f5f6f8; border-bottom: 1px solid #e6e8ec;
      display: flex; justify-content: space-between; align-items: center;
    }
    .hd .x { cursor: pointer; opacity: .5; font-weight: 400; padding: 0 2px; }
    .hd .x:hover { opacity: 1; }
    .bd { padding: 12px 14px 14px; }
    .range { display: flex; align-items: center; gap: 6px; margin-bottom: 7px; }
    .range .lbl { opacity: .65; font-size: 12px; }
    .range button {
      border: 1px solid #d4d8de; background: #fff; color: #1b1d22; cursor: pointer;
      border-radius: 5px; padding: 2px 8px; font: 12px/1.4 inherit;
    }
    .range button:hover { background: #eef2fb; border-color: #2f6fed; }
    .range .lv { font-variant-numeric: tabular-nums; opacity: .8; min-width: 34px; text-align: center; }
    .target {
      font: 11.5px/1.5 ui-monospace, Consolas, monospace; color: #5b6270;
      background: #f5f6f8; border-radius: 5px; padding: 5px 8px; margin-bottom: 10px;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .f { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
    .f label { width: 52px; text-align: right; opacity: .7; font-size: 12px; flex: none; }
    .f input {
      flex: 1; min-width: 0; border: 1px solid #d4d8de; border-radius: 6px;
      padding: 6px 9px; font: 13px/1.4 inherit; color: #1b1d22; background: #fff;
    }
    .f input:focus { outline: none; border-color: #2f6fed; box-shadow: 0 0 0 3px rgba(47,111,237,.14); }
    .qrow { margin: 0 0 10px; }
    .qlbl { display: flex; justify-content: space-between; align-items: baseline;
            font-size: 12px; opacity: .75; margin-bottom: 3px; }
    .qlbl a { color: #2f6fed; cursor: pointer; }
    .qrow textarea {
      width: 100%; min-height: 42px; resize: vertical;
      border: 1px solid #d4d8de; border-radius: 6px; padding: 6px 9px;
      font: 12.5px/1.55 "Microsoft YaHei", system-ui, sans-serif; color: #1b1d22; background: #fff;
    }
    .qrow textarea:focus { outline: none; border-color: #2f6fed; box-shadow: 0 0 0 3px rgba(47,111,237,.14); }
    .chk { margin: 2px 0 10px 60px; font-size: 12.5px; }
    .chk label { display: flex; align-items: center; gap: 6px; cursor: pointer; }
    .barwrap { height: 5px; background: #e9ebef; border-radius: 3px; overflow: hidden; display: none; margin-bottom: 6px; }
    .barwrap.on { display: block; }
    .bar { height: 100%; width: 0; background: #2f6fed; transition: width .2s linear; }
    .ptxt { font-size: 11.5px; color: #5b6270; margin-bottom: 8px; min-height: 16px; }
    .act { display: flex; gap: 8px; }
    .act button {
      flex: 1; padding: 8px; border-radius: 7px; cursor: pointer;
      font: 13px/1.4 inherit; border: 1px solid #d4d8de; background: #fff; color: #1b1d22;
    }
    .act button.ghost:hover { background: #f2f3f5; }
    .act button.ok { background: #2f6fed; border-color: #2f6fed; color: #fff; font-weight: 600; }
    .act button.ok:hover { background: #265ecb; }
    .act button:disabled { opacity: .55; cursor: default; }
    .res { display: none; margin-top: 10px; font-size: 12px; line-height: 1.7; }
    .res.on { display: block; }
    .res .p { font: 11.5px/1.5 ui-monospace, Consolas, monospace; color: #3a6b2f; word-break: break-all; }
    .res a { color: #2f6fed; cursor: pointer; }
    .err { color: #c0392b; }
    .warn { color: #b26a00; }
    .chips { display: flex; flex-wrap: wrap; gap: 5px; margin: -2px 0 9px 60px; }
    .chips:empty { display: none; }
    .chip {
      border: 1px solid #d4d8de; background: #f7f8fa; color: #333a46; cursor: pointer;
      border-radius: 12px; padding: 1px 9px; font: 12px/1.6 inherit; max-width: 190px;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .chip:hover { background: #e9f0ff; border-color: #2f6fed; color: #2f6fed; }
    .chips .none { font-size: 11.5px; opacity: .55; padding: 1px 0; }
    .hl {
      position: fixed; z-index: ${Z - 1}; pointer-events: none; display: none;
      border: 2px dashed #2f6fed; background: rgba(47,111,237,.10); border-radius: 3px;
    }
  `;

  function openPanel(chain, idx) {
    closePanel();

    const host = document.createElement('div');
    host.style.cssText = 'all:initial; display:block; width:0; height:0;';
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML =
      '<style>' + PANEL_CSS + '</style>' +
      '<div class="hl"></div>' +
      '<div class="box">' +
        '<div class="hd">AI 回答存档<span class="x" data-act="cancel">✕</span></div>' +
        '<div class="bd">' +
          '<div class="range">' +
            '<span class="lbl">截取范围</span>' +
            '<button data-act="in">扩大</button>' +
            '<span class="lv"></span>' +
            '<button data-act="out">缩小</button>' +
          '</div>' +
          '<div class="target"></div>' +
          '<div class="qrow">' +
            '<div class="qlbl"><span>我的提问</span><a data-act="pickq">从页面选取</a></div>' +
            '<textarea id="q" placeholder="这次问的是什么？可以留空，也可以点右边「从页面选取」"></textarea>' +
          '</div>' +
          '<div class="f"><label>类型</label><input id="type" list="tlist" placeholder="如 离散数学"><datalist id="tlist"></datalist></div>' +
          '<div class="chips" id="typeChips"></div>' +
          '<div class="f"><label>子分类</label><input id="sub" placeholder="留空 = 今天日期"></div>' +
          '<div class="chips" id="subChips"></div>' +
          '<div class="f"><label>文件名</label><input id="title"></div>' +
          '<div class="chk"><label><input type="checkbox" id="md"> 同时保存 Markdown 文字版</label></div>' +
          '<div class="barwrap"><div class="bar"></div></div>' +
          '<div class="ptxt"></div>' +
          '<div class="act">' +
            '<button class="ghost" data-act="cancel">取消</button>' +
            '<button class="ok" data-act="save">保存</button>' +
          '</div>' +
          '<div class="res"></div>' +
        '</div>' +
      '</div>';

    document.documentElement.appendChild(host);

    const $ = (sel) => shadow.querySelector(sel);
    panel = {
      host, shadow, chain, idx,
      hl: $('.hl'),
      elType: $('#type'), elSub: $('#sub'), elTitle: $('#title'), elMd: $('#md'), elQ: $('#q'),
      elLv: $('.lv'), elTarget: $('.target'),
      elBarWrap: $('.barwrap'), elBar: $('.bar'), elPtxt: $('.ptxt'),
      elRes: $('.res'),
      btnSave: $('button.ok'), btnCancel: $('button.ghost'),
      busy: false
    };

    // 默认值
    const today = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const dstr = today.getFullYear() + '-' + pad(today.getMonth() + 1) + '-' + pad(today.getDate());

    chrome.storage.local.get({ saveMd: true, lastType: '' }, (s) => {
      if (panel !== null) {
        panel.elMd.checked = !!s.saveMd;
        panel.elType.value = s.lastType || '';
        if (s.lastType) loadSubs();
      }
    });
    panel.elSub.value = dstr;
    panel.elTitle.value = defaultTitle();
    const guessed = guessQuestion(chain[idx]);
    panel.elQ.value = guessed;
    if (!guessed) {
      panel.elQ.placeholder = '没自动找到 —— 点右上角「从页面选取」，再点一下你那条提问';
    }

    // 已有分类 -> 小标签 + datalist，点一下直接填
    send('types').then((r) => {
      if (!panel || !r || !r.ok || !Array.isArray(r.types)) return;
      const list = r.types.filter((t) => t && t !== '未分类');
      $('#tlist').innerHTML = list
        .map((t) => '<option value="' + String(t).replace(/"/g, '&quot;') + '"></option>')
        .join('');
      fillChips($('#typeChips'), list, (v) => {
        panel.elType.value = v;
        loadSubs();
      }, '还没有分类，保存第一个之后就会出现在这里');
    });

    panel.elType.addEventListener('change', loadSubs);
    panel.elType.addEventListener('blur', loadSubs);

    refreshRange();

    shadow.addEventListener('click', (e) => {
      const act = e.target && e.target.getAttribute && e.target.getAttribute('data-act');
      if (!act) return;
      if (act === 'cancel') { closePanel(); return; }
      if (act === 'in') { setIdx(panel.idx + 1); return; }
      if (act === 'out') { setIdx(panel.idx - 1); return; }
      if (act === 'pickq') { pickQuestionInto(); return; }
      if (act === 'save') { doSave(); }
    });

    window.addEventListener('scroll', onPanelScroll, true);
    window.addEventListener('resize', onPanelScroll, true);
  }

  // 把字符串数组渲染成一排可点的小标签
  function fillChips(box, items, onPick, emptyText) {
    if (!box) return;
    box.innerHTML = '';
    if (!items || !items.length) {
      if (emptyText) {
        const s = document.createElement('span');
        s.className = 'none';
        s.textContent = emptyText;
        box.appendChild(s);
      }
      return;
    }
    items.forEach((t) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.textContent = t;
      b.title = t;
      b.addEventListener('click', () => onPick(t));
      box.appendChild(b);
    });
  }

  // 拉取当前分类下已有的子分类
  function loadSubs() {
    if (!panel) return;
    const t = panel.elType.value.trim();
    const box = panel.shadow.querySelector('#subChips');
    if (!t) { fillChips(box, [], null, ''); return; }
    send('subs', { type: t }).then((r) => {
      if (!panel) return;
      const subs = (r && r.ok && Array.isArray(r.subs)) ? r.subs : [];
      fillChips(box, subs, (v) => { panel.elSub.value = v; }, '');
    });
  }

  function onPanelScroll() { if (panel) refreshRange(); }

  function closePanel() {
    if (!panel) return;
    window.removeEventListener('scroll', onPanelScroll, true);
    window.removeEventListener('resize', onPanelScroll, true);
    panel.host.remove();
    panel = null;
  }

  function setIdx(i) {
    if (!panel) return;
    panel.idx = clamp(i, 0, panel.chain.length - 1);
    refreshRange();
  }

  function refreshRange() {
    if (!panel) return;
    const el = panel.chain[panel.idx];
    panel.elLv.textContent = (panel.idx + 1) + '/' + panel.chain.length;
    panel.elTarget.textContent = describeEl(el);
    const r = el.getBoundingClientRect();
    const hl = panel.hl;
    hl.style.display = 'block';
    hl.style.left = r.left + 'px';
    hl.style.top = r.top + 'px';
    hl.style.width = r.width + 'px';
    hl.style.height = r.height + 'px';
  }

  function defaultTitle() {
    let t = (document.title || '').trim();
    t = t.replace(/\s*[-|·—]\s*(ChatGPT|DeepSeek|Claude|Kimi|豆包|通义|文心|Gemini).*$/i, '').trim();
    if (!t) t = 'AI回答';
    return t.slice(0, 40);
  }

  /* ===================== HTML → Markdown ===================== */

  function extractMarkdown(root) {
    const md = nodeToMd(root, false);
    return md
      .replace(/\r/g, '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function nodeToMd(node, inPre) {
    if (node.nodeType === 3) {                       // 文本
      const s = node.nodeValue || '';
      return inPre ? s : s.replace(/\s+/g, ' ');
    }
    if (node.nodeType !== 1) return '';

    const tag = node.tagName.toLowerCase();
    if (node.hasAttribute('hidden')) return '';
    if (node.getAttribute('aria-hidden') === 'true') return '';
    if (tag === 'script' || tag === 'style' || tag === 'noscript' || tag === 'svg' ||
        tag === 'button' || tag === 'select' || tag === 'textarea' || tag === 'input') return '';

    // 公式（KaTeX / MathJax）
    if (node.classList && node.classList.contains('katex')) {
      const a = node.querySelector('annotation[encoding="application/x-tex"]');
      if (a && a.textContent.trim()) return ' $' + a.textContent.trim() + '$ ';
      return ' ' + (node.innerText || '').replace(/\s+/g, ' ') + ' ';
    }
    if (tag === 'mjx-container' || (node.classList && node.classList.contains('MathJax'))) {
      const a = node.querySelector('annotation[encoding="application/x-tex"]') ||
                node.querySelector('script[type="math/tex"]');
      if (a && a.textContent.trim()) return ' $' + a.textContent.trim() + '$ ';
      return ' ' + (node.innerText || '').replace(/\s+/g, ' ') + ' ';
    }

    const kids = () => Array.from(node.childNodes).map((n) => nodeToMd(n, inPre)).join('');

    switch (tag) {
      case 'br': return '\n';
      case 'hr': return '\n\n---\n\n';
      case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': {
        const lv = Number(tag[1]);
        const t = kids().trim().replace(/\n+/g, ' ');
        return t ? '\n\n' + '#'.repeat(lv) + ' ' + t + '\n\n' : '';
      }
      case 'p': {
        const t = kids().replace(/[ \t]+/g, ' ').trim();
        return t ? '\n\n' + t + '\n\n' : '';
      }
      case 'strong': case 'b': {
        const t = kids().trim();
        return t ? '**' + t + '**' : '';
      }
      case 'em': case 'i': {
        const t = kids().trim();
        return t ? '*' + t + '*' : '';
      }
      case 'del': case 's': case 'strike': {
        const t = kids().trim();
        return t ? '~~' + t + '~~' : '';
      }
      case 'code': {
        if (inPre) return node.textContent || '';
        const t = (node.textContent || '').replace(/`/g, '\\`');
        return t ? '`' + t + '`' : '';
      }
      case 'pre': {
        const codeEl = node.querySelector('code');
        let lang = '';
        const cls = (codeEl && codeEl.className) || node.className || '';
        const m = /(?:language|lang)-([a-z0-9+#]+)/i.exec(String(cls));
        if (m) lang = m[1].toLowerCase();
        const raw = ((codeEl || node).innerText || node.textContent || '').replace(/\n+$/, '');
        return '\n\n```' + lang + '\n' + raw + '\n```\n\n';
      }
      case 'blockquote': {
        const t = kids().trim();
        if (!t) return '';
        return '\n\n' + t.split('\n').map((l) => '> ' + l).join('\n') + '\n\n';
      }
      case 'ul': case 'ol': return listToMd(node, tag === 'ol', inPre);
      case 'li': return kids();
      case 'a': {
        const href = node.getAttribute('href') || '';
        const t = kids().trim() || href;
        if (!href || /^javascript:/i.test(href)) return t;
        return '[' + t + '](' + href + ')';
      }
      case 'img': {
        const alt = node.getAttribute('alt') || '';
        const src = node.currentSrc || node.getAttribute('src') || '';
        if (!src || /^data:/i.test(src)) return '';
        return '![' + alt + '](' + src + ')';
      }
      case 'table': return tableToMd(node, inPre);
      case 'tr': case 'td': case 'th': case 'tbody': case 'thead': return kids();
      case 'div': case 'section': case 'article': case 'main': case 'span':
      case 'figure': case 'figcaption': case 'details': case 'summary': case 'dl': case 'dt': case 'dd':
      default: {
        const inner = kids();
        // 块级容器：内容里没有空行时补一层，避免段落粘连
        if (/^(div|section|article|main|figure|figcaption|dd)$/.test(tag) && inner.trim()) {
          return '\n' + inner + '\n';
        }
        return inner;
      }
    }
  }

  function listToMd(node, ordered, inPre) {
    const items = Array.from(node.children).filter((c) => c.tagName && c.tagName.toLowerCase() === 'li');
    if (!items.length) return '\n' + nodeToMd(node, inPre) + '\n';
    const start = parseInt(node.getAttribute('start') || '1', 10) || 1;
    const out = items.map((li, i) => {
      const marker = ordered ? (start + i) + '. ' : '- ';
      const body = nodeToMd(li, inPre).trim().replace(/\n{2,}/g, '\n');
      return marker + body.replace(/\n/g, '\n' + ' '.repeat(marker.length));
    });
    return '\n\n' + out.join('\n') + '\n\n';
  }

  function tableToMd(node, inPre) {
    const rows = Array.from(node.querySelectorAll('tr'));
    if (!rows.length) return '\n' + nodeToMd(node, inPre) + '\n';
    const lines = [];
    rows.forEach((tr, i) => {
      const cells = Array.from(tr.children).map((td) =>
        nodeToMd(td, inPre).trim().replace(/\n+/g, ' ').replace(/\|/g, '\\|') || ' '
      );
      if (!cells.length) return;
      lines.push('| ' + cells.join(' | ') + ' |');
      if (i === 0) lines.push('| ' + cells.map(() => '---').join(' | ') + ' |');
    });
    return '\n\n' + lines.join('\n') + '\n\n';
  }

  /* ===================== 滚动拼接截图 ===================== */

  function findScroller(el) {
    let cur = el.parentElement;
    while (cur && cur !== document.documentElement) {
      const cs = getComputedStyle(cur);
      const oy = cs.overflowY;
      if ((oy === 'auto' || oy === 'scroll' || oy === 'overlay') &&
          cur.scrollHeight > cur.clientHeight + 4) {
        return { el: cur, isDoc: false };
      }
      cur = cur.parentElement;
    }
    return { el: document.scrollingElement || document.documentElement, isDoc: true };
  }

  // 截图前把页面上的 fixed / sticky 元素藏起来（输入框、悬浮顶栏、回到顶部按钮）。
  // 不藏的话：它们位置固定不动，会在拼接图的每一屏里重复出现，还会挡住正文。
  function hideFloating(target) {
    const changed = [];
    const nodes = document.body ? document.body.querySelectorAll('*') : [];
    for (const el of nodes) {
      if (el === target || el.contains(target)) continue;   // 目标自身和它的祖先不能藏
      let cs;
      try { cs = getComputedStyle(el); } catch { continue; }
      if (cs.position !== 'fixed' && cs.position !== 'sticky') continue;
      if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) continue;
      changed.push([el, el.style.getPropertyValue('visibility'), el.style.getPropertyPriority('visibility')]);
      el.style.setProperty('visibility', 'hidden', 'important');
    }
    return () => {
      for (const [el, v, p] of changed) {
        if (v) el.style.setProperty('visibility', v, p || '');
        else el.style.removeProperty('visibility');
      }
    };
  }

  async function settle(ms) {
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    await sleep(ms);
  }

  async function captureElement(target, onProgress) {
    if (document.visibilityState === 'hidden') throw new Error('页面不在前台，请保持在当前标签页再保存');

    const sc = findScroller(target);
    const scroller = sc.el;
    const isDoc = sc.isDoc;
    const startTop = scroller.scrollTop;
    const startLeft = scroller.scrollLeft;

    const vw = window.innerWidth;
    const vh = isDoc ? window.innerHeight : scroller.clientHeight;
    const viewportOf = () => (isDoc ? 0 : scroller.getBoundingClientRect().top);

    const r0 = target.getBoundingClientRect();
    const elW = Math.max(1, Math.ceil(r0.width));
    let elH = Math.max(1, Math.ceil(r0.height));
    const offsetTop = isDoc
      ? r0.top + scroller.scrollTop
      : r0.top - scroller.getBoundingClientRect().top + scroller.scrollTop;

    const maxScrollOf = () => Math.max(0, scroller.scrollHeight - vh);
    let maxScroll = maxScrollOf();

    let canvas = null, cx = null, scale = window.devicePixelRatio || 1;
    const totalW = Math.min(elW, vw);
    let covered = 0;
    let sliceNo = 0;

    // 元素在截图过程中变高时（懒加载图片、展开折叠块）把画布接长，否则底部会被切掉
    const extendCanvas = (newH) => {
      const c2 = document.createElement('canvas');
      c2.width = canvas.width;
      c2.height = Math.max(1, Math.round(newH * scale));
      const x2 = c2.getContext('2d');
      x2.fillStyle = '#ffffff';
      x2.fillRect(0, 0, c2.width, c2.height);
      x2.drawImage(canvas, 0, 0);
      canvas = c2;
      cx = x2;
    };

    let restoreFloating = () => {};
    try {
      restoreFloating = hideFloating(target);

      // ① 预热：先把整段快速滚一遍，触发懒加载，顺便摸清真实高度
      let pos = 0;
      let guard0 = 0;
      const warmStep = Math.max(160, Math.floor(vh * 0.9));
      while (guard0++ < 200) {
        scroller.scrollTop = clamp(offsetTop + pos, 0, maxScroll);
        await sleep(110);
        const h = Math.ceil(target.getBoundingClientRect().height);
        if (h > elH + 1) elH = h;
        pos += warmStep;
        if (pos > elH + vh) break;
        if (scroller.scrollTop >= maxScroll - 0.5) break;
      }
      scroller.scrollTop = clamp(offsetTop, 0, maxScroll);
      await settle(280);
      maxScroll = maxScrollOf();

      // ② 逐屏截图
      let scrollTop = clamp(offsetTop, 0, maxScroll);
      let guard = 0;
      while (guard++ < 150) {
        scroller.scrollTop = scrollTop;
        await settle(sliceNo === 0 ? 260 : CAPTURE_GAP_MS);
        sliceNo++;

        const r = target.getBoundingClientRect();
        const vt = viewportOf();

        const hNow = Math.ceil(r.height);
        if (hNow > elH + 1) { elH = hNow; maxScroll = maxScrollOf(); }

        const visTop = Math.max(r.top, vt);
        const visBot = Math.min(r.bottom, vt + vh);

        if (visBot - visTop >= 1) {
          if (document.visibilityState === 'hidden') throw new Error('页面被切到后台了，截图中断，请重试');

          const cap = await send('capture');
          if (!cap.ok) throw new Error('截图失败：' + cap.error);
          const img = await loadImage(cap.dataUrl);

          if (!canvas) {
            scale = img.naturalWidth / window.innerWidth;
            canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(totalW * scale));
            canvas.height = Math.max(1, Math.round(elH * scale));
            cx = canvas.getContext('2d');
            cx.fillStyle = '#ffffff';
            cx.fillRect(0, 0, canvas.width, canvas.height);
          } else if (canvas.height < Math.round(elH * scale)) {
            extendCanvas(elH);
          }

          const x0 = Math.max(0, r.left);
          const sw = (Math.min(vw, r.right) - x0) * scale;
          const sh = (visBot - visTop) * scale;
          if (sw > 0.5 && sh > 0.5) {
            cx.drawImage(
              img,
              x0 * scale, visTop * scale, sw, sh,
              Math.max(0, -r.left) * scale, (visTop - r.top) * scale, sw, sh
            );
          }
          covered = Math.max(covered, visBot - r.top);
        }

        if (onProgress) onProgress(clamp(covered / elH, 0, 1), sliceNo, Math.max(1, Math.ceil(elH / vh)));
        if (covered >= elH - 1) break;

        // ③ 下一屏要把“已覆盖到的底部”推到视口顶部，推进量按实际位置算
        const visTopEl = Math.max(r.top, vt) - r.top;
        let delta = covered - visTopEl;
        if (!(delta > 10)) delta = vh * 0.92;
        const prev = scrollTop;
        scrollTop = clamp(prev + delta, 0, maxScroll);
        if (Math.abs(scrollTop - prev) < 0.5) break;   // 滚不动了
      }
    } finally {
      restoreFloating();
      scroller.scrollTo({ top: startTop, left: startLeft, behavior: 'auto' });
    }

    if (!canvas || covered < 1) throw new Error('没有截到内容');
    return { images: splitCanvas(canvas), complete: covered >= elH - 3, elH: Math.round(elH), covered: Math.round(covered) };
  }

  function splitCanvas(canvas) {
    const out = [];
    const png = (c) => c.toDataURL('image/png').split(',')[1];
    if (canvas.height <= MAX_CANVAS_H) {
      out.push({ base64: png(canvas) });
      return out;
    }
    const parts = Math.ceil(canvas.height / MAX_CANVAS_H);
    for (let i = 0; i < parts; i++) {
      const y = i * MAX_CANVAS_H;
      const h = Math.min(MAX_CANVAS_H, canvas.height - y);
      const c = document.createElement('canvas');
      c.width = canvas.width;
      c.height = h;
      const cc = c.getContext('2d');
      cc.fillStyle = '#ffffff';
      cc.fillRect(0, 0, c.width, c.height);
      cc.drawImage(canvas, 0, y, canvas.width, h, 0, 0, canvas.width, h);
      out.push({ base64: png(c) });
    }
    return out;
  }

  /* ===================== 保存 ===================== */

  async function doSave() {
    if (!panel || panel.busy) return;
    const p = panel;
    const target = p.chain[p.idx];

    const type = p.elType.value.trim();
    if (!type) { p.elType.focus(); toast('请先填“类型”，比如：离散数学'); return; }

    p.busy = true;
    p.btnSave.disabled = true;
    p.btnCancel.disabled = true;
    p.elRes.className = 'res';
    p.elBarWrap.classList.add('on');
    setProgress(0.02, '正在提取文字…');

    try {
      const markdown = p.elMd.checked ? extractMarkdown(target) : '';
      setProgress(0.06, '准备截图，页面会自己滚动，请不要切换标签页…');
      await sleep(400);

      // 面板是 fixed 元素，每一屏都会被截进去 —— 截图期间必须藏起来，进度改用工具栏角标
      p.host.style.display = 'none';
      send('badge', { text: '准备' });
      let images, incomplete = false;
      try {
        const shot = await captureElement(target, (ratio, i, n) => {
          setProgress(0.06 + ratio * 0.86, '正在截图 ' + i + '/' + n + ' …');
          send('badge', { text: i + '/' + n });
        });
        images = shot.images;
        incomplete = !shot.complete;
      } finally {
        p.host.style.display = '';
        send('badge', { text: '' });
      }

      setProgress(0.95, '正在写入文件…');
      const payload = {
        type,
        sub: p.elSub.value.trim(),
        title: p.elTitle.value.trim(),
        question: p.elQ.value.trim(),
        url: location.href,
        site: location.hostname,
        markdown,
        images
      };
      const r = await send('save', { payload });
      if (!r || !r.ok) throw new Error((r && r.error) || '保存失败');

      setProgress(1, '');
      p.elBarWrap.classList.remove('on');
      p.elRes.className = 'res on';
      p.elRes.innerHTML =
        '<div>已保存 ' + (r.files ? r.files.length : 0) + ' 个文件到：</div>' +
        '<div class="p">' + escapeHtml(r.dir || '') + '</div>' +
        (incomplete ? '<div class="warn">⚠ 底部可能没截全（内容在滚动中变长了）。可以再存一次，或用「扩大/缩小」调整范围。</div>' : '') +
        '<div><a data-act="open">打开文件夹</a> &nbsp; ' +
        '<a data-act="done">完成</a></div>';
      p.elRes.querySelector('[data-act="open"]').addEventListener('click', () => {
        send('open', { path: r.dir });
      });
      p.elRes.querySelector('[data-act="done"]').addEventListener('click', closePanel);

      chrome.storage.local.set({ lastType: type });

      const opts = await chrome.storage.local.get({ openAfter: false });
      if (opts.openAfter) send('open', { path: r.dir });
    } catch (e) {
      p.elBarWrap.classList.remove('on');
      p.elRes.className = 'res on';
      p.elRes.innerHTML = '<div class="err">失败：' + escapeHtml(String((e && e.message) || e)) + '</div>';
    } finally {
      if (panel === p) {
        p.busy = false;
        p.btnSave.disabled = false;
        p.btnCancel.disabled = false;
      }
    }
  }

  function setProgress(ratio, text) {
    if (!panel) return;
    panel.elBar.style.width = Math.round(clamp(ratio, 0, 1) * 100) + '%';
    if (text !== undefined) panel.elPtxt.textContent = text;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* ===================== 入口 ===================== */

  function start() {
    closePanel();
    enterPickMode();
  }

  window[CTRL] = { start };
  start();
})();
