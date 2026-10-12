/* AI 回答存档 —— 弹窗脚本 */

const $ = (id) => document.getElementById(id);
const NATIVE_HOST = 'com.dsh.ai_archive';
const EXPECTED_SERVER = '1.1.0';   // 必须和 server\server.mjs 里的 VERSION 一致

let rootPath = '';
let needRestart = false;
let everChecked = false;

function setStatus(text, cls) {
  const el = $('status');
  el.textContent = text;
  el.className = cls || '';
}

/* 通过 Native Messaging 拉起本机服务（扩展自己不能启动本地进程） */
function nativeStart() {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendNativeMessage(NATIVE_HOST, { cmd: 'start-server' }, (resp) => {
        const err = chrome.runtime.lastError;
        if (err) resolve({ ok: false, error: err.message });
        else resolve(resp || { ok: false, error: '无响应' });
      });
    } catch (e) {
      resolve({ ok: false, error: String((e && e.message) || e) });
    }
  });
}

async function refresh() {
  const r = await chrome.runtime.sendMessage({ type: 'ping' });
  const startBtn = $('startSrv');
  const ok = !!(r && r.ok);

  if (!ok) {
    rootPath = '';
    needRestart = false;
    setStatus(
      everChecked
        ? '本机服务没在运行 —— 点下面的按钮拉起来'
        : '本机服务没在运行 —— 可以点下面的按钮启动，或双击 ai-archive\\server\\start-server.cmd',
      'err'
    );
    startBtn.hidden = false;
    startBtn.textContent = '启动本机服务';
    $('pick').disabled = true;
    return false;
  }

  const ver = r.version || '未知';
  rootPath = r.root || '';
  needRestart = ver !== EXPECTED_SERVER;
  $('pick').disabled = false;

  if (needRestart) {
    setStatus(
      '正在运行的服务是旧版 v' + ver + '，新功能用不上。点下面的按钮更新到 v' + EXPECTED_SERVER,
      'err'
    );
    startBtn.hidden = false;
    startBtn.textContent = '重启服务（更新到 v' + EXPECTED_SERVER + '）';
  } else {
    setStatus('本机服务已连接（v' + ver + '）', 'ok');
    if (rootPath) {
      const p = document.createElement('span');
      p.id = 'root';
      p.textContent = '存档目录：' + rootPath;
      $('status').appendChild(p);
    }
    startBtn.hidden = true;
    startBtn.textContent = '启动本机服务';
  }
  return true;
}

/* 设置项 */
async function loadOpts() {
  const s = await chrome.storage.local.get({ saveMd: true, openAfter: false });
  $('saveMd').checked = !!s.saveMd;
  $('openAfter').checked = !!s.openAfter;
}

$('saveMd').addEventListener('change', (e) => chrome.storage.local.set({ saveMd: e.target.checked }));
$('openAfter').addEventListener('change', (e) => chrome.storage.local.set({ openAfter: e.target.checked }));

/* 启动 / 重启本机服务 */
$('startSrv').addEventListener('click', async () => {
  const btn = $('startSrv');
  btn.disabled = true;

  if (needRestart) {
    setStatus('正在停掉旧版服务…');
    await chrome.runtime.sendMessage({ type: 'shutdown' });
    await new Promise((res) => setTimeout(res, 800));
  }

  setStatus('正在启动本机服务…');
  const r = await nativeStart();
  btn.disabled = false;

  if (r && r.ok && r.running) {
    setStatus('已启动，正在连接…');
    await new Promise((res) => setTimeout(res, 500));
    everChecked = true;
    if (await refresh()) return;
    setStatus('服务起来了但连不上，等 2 秒再点一次按钮', 'err');
    return;
  }
  if (r && r.ok) {
    setStatus('进程起来了但端口没通：' + (r.error || '检查 start-server.cmd 里的 node 路径'), 'err');
    return;
  }
  setStatus(
    '启动失败：' + ((r && r.error) || '未知') +
    ' —— 需要先运行一次 ai-archive\\server\\install-native-host.cmd，然后完全退出 Edge 再打开', 'err');
});

/* 开始选择 */
$('pick').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) return;
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
    window.close();
  } catch (e) {
    setStatus('这个页面不能用（浏览器内置页 / 扩展商店页）：' + ((e && e.message) || e), 'err');
  }
});

/* 打开存档目录 */
$('openRoot').addEventListener('click', async () => {
  const r = await chrome.runtime.sendMessage({ type: 'open', path: rootPath || '' });
  if (!r || !r.ok) setStatus('打开失败：' + ((r && r.error) || '未知错误'), 'err');
});

refresh();
loadOpts();
