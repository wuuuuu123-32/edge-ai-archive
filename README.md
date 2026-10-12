# AI 回答存档

把网页上的一整条 AI 回答**一键截成长图**并存到本地文件夹 —— **字不会变小**，同时留下 Markdown 和一份能直接阅读的 HTML。

> Edge / Chrome 扩展 + 一个本机 Node 服务。截图和存储全在本机完成，**不联网、不上传**。
>
> ⚠️ 这是个实验性项目：核心链路（DeepSeek）实测可用，其他站点的「提问自动识别」可能不准，欢迎反馈。

## 它解决什么问题

网页截图工具（QQ / 微信 / 系统自带）通常只能截当前可见区域。想把一条长回答存下来，只能缩小页面 —— 字跟着变小，没法看。

这个扩展用**滚动拼接**：保持 100% 缩放，一屏一屏截下来拼成一张长图，字多大还是多大。

顺带解决两件事：

- 截图时**自动隐藏固定定位的元素**（输入框、悬浮导航栏）—— 否则它们会在每一屏重复出现，还会挡住正文（这是滚动截图最常见的坑）
- 内容在滚动中变长（懒加载图片）时**自动接长画布** —— 否则底部会被切掉

## 功能

- 点选一条回答 → 自动滚屏拼接成长图（PNG，保持原始字号和清晰度）
- 同时保存 **Markdown**（导进 Obsidian / Notion）和 **HTML**（双击用浏览器打开就是排好版的，公式用 MathJax 渲染）
- **提问一起存**：自动猜最近的一条；猜不到就点「从页面选取」手动点一下
- 按 **类型 / 子分类** 归档：已有分类可点选，新分类自动建文件夹
- 长图超过画布上限自动分片；面板上可调整截取范围（扩大 / 缩小）

## 环境要求

- **Windows**（启动脚本是 `.cmd`；核心代码跨平台，macOS/Linux 需自己写启动脚本）
- **Node.js 18+** → https://nodejs.org/ （装 LTS 版）
- **Edge 或 Chrome**

## 安装

### 1. 拿到代码

```bat
git clone https://github.com/wuuuuu123-32/edge-ai-archive.git
```

或者下载 ZIP 解压。**路径别带中文和空格**，省得踩坑。

### 2. 加载扩展

1. 打开 `edge://extensions`（Chrome 用 `chrome://extensions`）
2. 打开 **开发人员模式**
3. 点 **加载解压缩的扩展**，选中仓库里的 `extension` 文件夹
4. 建议固定到工具栏（地址栏右边的拼图图标 → 图钉）

### 3. 启动服务

双击 `server\start-server.cmd`，看到「服务已启动」就行。**这个窗口要一直开着。**

> 嫌麻烦？见下面「让服务一键启动」。

## 使用

打开任意 AI 网页（DeepSeek / ChatGPT / Claude / Kimi…）→ 点扩展图标 → **选择要存档的回答** → 鼠标移到回答上单击选中 → 填好信息 → 保存。

快捷键 `Alt+Shift+S`（可在 `edge://extensions/shortcuts` 改）。

**注意**：截图过程中页面会自己滚动，**不要切换标签页**，否则会截到别的页面。结束后页面会滚回原位。

## 文件存在哪

```
<仓库目录>\data\
  离散数学\                        ← 面板第一步填的「类型」
    2026-10-12\                    ← 第二步填的「子分类」，默认今天日期
      全称蕴含_存在合取_183412.png    ← 长图
      全称蕴含_存在合取_183412.md     ← Markdown 源文件
      全称蕴含_存在合取_183412.html   ← 双击就能读
```

平时回看**直接双击 `.html`**。

换存档位置：改 `server\config.json`

```json
{ "root": "D:\\我的资料\\AI存档", "port": 8765 }
```

改完重启服务窗口。

## 让服务一键启动（可选）

浏览器扩展不能直接启动本地程序，需要注册一个 Native Messaging host：

1. 双击 `server\install-native-host.cmd`
   —— 它会在当前目录生成 `native-host.json`，并写入**当前用户**的注册表（Edge + Chrome），**不需要管理员**
2. **完全退出浏览器**（所有窗口关掉，不是只关标签页）再打开
3. 以后服务没开时，点扩展图标 → **启动本机服务** 就能拉起来

连按钮都不想点：按 `Win+R` 输入 `shell:startup`，把 `server\start-server-hidden.vbs` 的快捷方式拖进去。

> 卸载：删掉注册表项 `HKCU\Software\Microsoft\Edge\NativeMessagingHosts\com.dsh.ai_archive`
> 和 `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.dsh.ai_archive`。

## 常见问题

**弹窗说「本机服务没在运行」**
双击 `server\start-server.cmd`。窗口一闪就没的话，说明 Node 没装好 —— 命令行跑 `node -v` 确认。

**弹窗说「正在运行的服务是旧版」**
服务是常驻进程，代码更新后不会自动换新。点弹窗里的 **重启服务** 按钮即可。

**注册完 native host，点按钮还是报 `Specified native messaging host not found`**
必须**完全退出**浏览器再打开（不是只关标签页）。注册表只在浏览器启动时读取。

**截图底部缺一段**
保存后面板会提示。通常是回答在滚动中变长了，重截一次一般就好。

**截图里出现重复的悬浮栏**
说明那个元素不是 `position: fixed/sticky`（隐藏逻辑只处理这两种）。提个 issue 说明是哪个站点。

**支持哪些网站？**
原理是通用的，任何网页都能截。实测过 DeepSeek。其他站点的「提问自动识别」可能不准 —— 用面板里的 **从页面选取** 手动点一下就行，这一步是 100% 可靠的。

## 已知限制

- 仅 Windows 启动脚本
- 需要「开发人员模式」加载，没上扩展商店
- 截图期间不能切标签页
- 每屏约 600ms（浏览器截图接口限速 ~2 次/秒），10 屏约 7 秒
- 单张长图超过 30000 像素会拆成 `_1.png`、`_2.png`

## 目录结构

```
extension\                浏览器扩展（Manifest V3）
  manifest.json
  background.js           截图中继 / 本机服务中继 / 工具栏进度角标
  content.js              元素选择、滚动拼接、HTML→Markdown、操作面板
  popup.html / popup.js   弹窗：服务状态、启动按钮、设置
  icons\
server\                   本机服务（Node，零依赖）
  server.mjs              建目录、写文件、Markdown→HTML、类型/子分类接口
  native-host.mjs         Native Messaging host（一键启动服务）
  install-native-host.cmd 注册 host（生成 manifest + 写注册表）
  start-server.cmd        前台启动
  start-server-hidden.vbs 静默启动
  config.json             存档路径 / 端口
test-page.html            本地测试页（长文 + 表格 + 公式 + 代码块 + sticky 顶栏）
```

## 工作原理

1. 扩展找到你点选的元素，向上查找最近的滚动容器
2. 先「预热」把整段快速滚一遍 —— 触发懒加载图片，同时摸清真实高度
3. 逐屏调用 `chrome.tabs.captureVisibleTab`，按元素坐标绘制到 canvas；元素变高就接长画布
4. 截图期间隐藏所有 `fixed/sticky` 元素，结束后恢复
5. canvas 导出 PNG，与 Markdown、HTML 一起 POST 给本机服务（`127.0.0.1:8765`）落盘
6. 服务端把 Markdown 转成 HTML（公式交给 MathJax CDN），按「类型/子分类」建文件夹写入

## 许可

MIT
