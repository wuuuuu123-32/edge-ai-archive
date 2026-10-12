/* AI 回答存档 —— 后台脚本
 * 职责：
 *   1. 中转 chrome.tabs.captureVisibleTab（页面脚本不能直接调）
 *   2. 中转本机存档服务 http://127.0.0.1:8765
 *   3. 响应快捷键命令
 */

const SERVER = 'http://127.0.0.1:8765';

/* ------------------------- 本机服务调用 ------------------------- */

async function callServer(pathname, init) {
  let res;
  try {
    res = await fetch(SERVER + pathname, init);
  } catch (e) {
    return { ok: false, error: '连不上本机存档服务（' + SERVER + '）：' + (e && e.message ? e.message : e) };
  }
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { ok: false, error: '服务返回了非 JSON 内容：' + text.slice(0, 200) };
  }
}

function postJSON(pathname, body) {
  return callServer(pathname, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

/* ------------------------- 截图中继 ------------------------- */

// captureVisibleTab 有速率限制（约 2 次/秒），失败时退避重试
async function captureTab(windowId, retries = 3) {
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try {
      return await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 700));
    }
  }
  throw lastErr;
}

/* ------------------------- 消息处理 ------------------------- */

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      switch (msg && msg.type) {
        case 'capture': {
          const windowId = sender.tab ? sender.tab.windowId : undefined;
          const dataUrl = await captureTab(windowId);
          sendResponse({ ok: true, dataUrl });
          break;
        }
        case 'ping':
          sendResponse(await callServer('/ping'));
          break;
        case 'types':
          sendResponse(await callServer('/types'));
          break;
        case 'subs':
          sendResponse(await callServer('/subs?type=' + encodeURIComponent(msg.type || '')));
          break;
        case 'save':
          sendResponse(await postJSON('/save', msg.payload));
          break;
        case 'shutdown':
          sendResponse(await postJSON('/shutdown', {}));
          break;
        case 'open':
          sendResponse(await postJSON('/open', { path: msg.path }));
          break;
        case 'badge': {
          // 截图期间页面上的 UI 必须全部隐藏，进度只能靠工具栏角标显示
          const text = msg.text || '';
          await chrome.action.setBadgeBackgroundColor({ color: '#2f6fed' });
          await chrome.action.setBadgeText({ text: text.slice(0, 8) });
          sendResponse({ ok: true });
          break;
        }
        default:
          sendResponse({ ok: false, error: '未知消息：' + (msg && msg.type) });
      }
    } catch (e) {
      sendResponse({ ok: false, error: String((e && e.message) || e) });
    }
  })();
  return true; // 异步响应
});

/* ------------------------- 快捷键 ------------------------- */

async function startPickOnActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) return;
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
  } catch (e) {
    console.warn('注入失败：', e);
  }
}

if (chrome.commands && chrome.commands.onCommand) {
  chrome.commands.onCommand.addListener((cmd) => {
    if (cmd === 'start-pick') startPickOnActiveTab();
  });
}
