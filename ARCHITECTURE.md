# ARCHITECTURE.md — 多端共用一份 renderer 的架构契约

> 本文件是**架构权威文档**，与 `AGENTS.md` 互补：`AGENTS.md` 偏"操作与红线速查"，本文档偏"为什么这样设计、各端如何拼装、桥契约是什么"。
> **接手 AI 必须先读本文档再改代码。** 任何破坏"铁律"的改动都视为回归。

---

## 0. 一句话架构

```
            ┌──────────────────────── 同一份 src/renderer（平台无关） ────────────────────────┐
            │  React 19 + Redux + AntD + ECharts  │  所有数据走 window.contextModules 桥       │
            └───────────────┬───────────────────────────────────────┬────────────────────────┘
                            │ 消费同一份 renderer                     │ 消费同一份 renderer
              ┌─────────────┴──────────────┐            ┌─────────────┴──────────────┐
        桌面壳（Electron）              桌面壳（Electron）            安卓壳（Capacitor）
        macOS / Windows / Linux          macOS / Windows / Linux         Android 全屏 WebView
        状态栏 / 托盘小窗口               状态栏 / 托盘小窗                 MainActivity + Bridge
              │                                  │                            │
    src/preload/index.ts 提供            src/preload/index.ts 提供      android/.../ContextModulesPlugin.java 提供
    window.contextModules（ipcRenderer   window.contextModules           window.contextModules（Capacitor 插件）
    → 主进程 undici / electron-store）    （同上）                       → HttpURLConnection / SharedPreferences
```

**四端（mac/win/linux 状态栏小应用 + Android 全屏应用）共用同一份 `src/renderer` 源码。** 新增行情源、改 UI、加筛选 → 改 renderer 一次，四端同步。

---

## 1. 架构铁律（不可破坏的不变式）

> 这些规则是 fork 多端化的根基。**任何一端的"方便"都不允许破坏它们。**

### 铁律 1 — `src/renderer` 必须是平台无关的单份源码
- 四端共用**同一份** `src/renderer`，**不允许为某个端另起一份 renderer 副本**（例如 `src/renderer-android`）。
- 一旦有人在某端副本里直接改 UI 而不走 renderer，就开始**漂移（drift）**：四端行为逐渐不一致，再也合不回来。这是本架构最大的风险。

### 铁律 2 — 所有平台差异只能通过 `window.contextModules` 桥解决
渲染进程**不得**直接依赖 Electron / Node / 桌面环境 API。具体映射：

| 能力 | 只走 | ❌ 禁止 |
|---|---|---|
| 网络请求 | `contextModules.request(url, config)` | renderer 里直接 `fetch` 第三方站点（CORS 会被拦）；引入 axios/undici 等 Node/浏览器端 HTTP 库 |
| 配置持久化 | `contextModules.electronStore` | `localStorage`/`indexedDB` 作为主存储（桌面端用 electron-store，移动端须与之隔离又等价）|
| 打开外部链接 | `contextModules.electron.shell.openExternal(url)` | `window.open` 第三方（安卓 WebView 默认无外部浏览器跳转）|
| 剪贴板 | `contextModules.electron.clipboard` | `navigator.clipboard`（部分 WebView 受限）|
| 文件导出 | `contextModules.io` | 直接用 File System Access API |
| 平台识别 | `contextModules.process.platform`（`darwin`/`win32`/`linux`/`android`）| renderer 里 `import 'process'` 或读 `navigator.userAgent` 判断平台 |

> 为什么 request 必须走桥：桌面端 CORS 由主进程（undici）统一解决；移动端 WebView 若直接 `fetch` 东方财富等会撞 CORS。**桥让 services 在四端零改动。**

### 铁律 3 — 禁止把桌面假设写进 renderer
- 窗口尺寸、托盘（Tray）、菜单栏、开机启动、代理设置面板等桌面专属概念**不得硬编码**进 renderer 组件。
- 如确需按端隐藏/调整 UI，用条件渲染：`if (window.contextModules.process.platform === 'android') { ... }`（参考 `src/renderer/components/Toolbar/SettingContent/More/index.tsx` 已有的 `process.platform` 用法）。
- 当前 renderer 仅有 **1 处**触碰 `process.platform`（`More/index.tsx` 显示环境信息），这是 OK 的范本。

### 铁律 4 — 桥契约两端必须同步实现
`contextModules` 暴露的成员是四端共同契约：
```
request / process / electron{shell, ipcRenderer, dialog, app, clipboard} / io{saveImage, saveJsonToCsv, saveString, readStringFile, readFile} / electronStore{get, set, delete, cover, all}
```
- 任意一端**新增桥能力**，必须**同时**在以下三处实现/更新：
  1. Electron 预加载：`src/preload/index.ts`
  2. Android 插件：`android/app/src/main/java/.../ContextModulesPlugin.java`
  3. 类型定义：`src/renderer/typings/preload.d.ts`
- 成员签名（参数顺序、返回 `{ body, headers }` 形状、Promise 语义）必须一致，否则会出现"桌面正常、安卓挂"的隐性 bug。

### 铁律 5 — 安卓壳是"壳"不是"fork"
- `android/` 工程（Capacitor）只是把 renderer 包成原生 WebView，**不得把业务/UI 逻辑搬进 Kotlin 层**。
- 业务逻辑、行情解析、状态管理全部留在 `src/renderer`。原生层只做：提供桥、处理 WebView 生命周期、全屏沉浸。

---

## 2. 桥的运行时注入机制（为什么不会有时序问题）

渲染进程入口 `src/renderer/index.html` 的 `<head>` 里有一段 **inline 引导脚本**（架构铁律的一部分，务必保留）：

```js
(function () {
  if (window.contextModules) return;        // Electron 预加载已暴露，直接跳过
  var cap = () => window.Capacitor?.Plugins?.ContextModules;
  var whenReady = (invoke) => new Promise((resolve, reject) => { /* 每 30ms 重试直到插件就绪，最多 ~6s */ });
  window.contextModules = {
    request: (url, config) => whenReady(p => p.request({ url, config })),
    process: { production: true, platform: 'android', electron:'-', node:'-', v8:'-', chrome:'-', arch:'arm64', buildDate: String(Date.now()), sandboxed: false },
    electron: { /* shell/ipcRenderer(全 no-op)/dialog/app/clipboard 惰性委托 cap() */ },
    io: { /* saveImage/saveString/saveJsonToCsv/readStringFile/readFile 惰性委托 cap() */ },
    electronStore: { /* get/set/delete/cover/all 惰性委托 cap() */ },
  };
  if (!window.process) window.process = window.contextModules.process; // WebView 无 Node 全局 process
  document.documentElement.classList.add('platform-android');          // 供响应式 CSS 使用
})();
```

- **Electron 端**：`src/preload/index.ts` 通过 `contextBridge.exposeInMainWorld('contextModules', ...)` 在渲染脚本前已设好 `window.contextModules`，引导脚本 `if (window.contextModules) return` 直接跳过 → 桌面行为完全不变。
- **Android 端**：引导脚本同步定义 `window.contextModules`（方法函数是稳定引用），真正调用时才惰性读 `window.Capacitor.Plugins.ContextModules`，并用 `whenReady` 重试直到插件就绪 → **无时序问题**。
- `request.ts` 在模块加载时执行 `export default window.contextModules.request`，捕获的是稳定函数引用，因此无论哪个端都能正常 import。

> ⚠️ 不要删这段 inline 脚本，也不要把它改成依赖某个外部文件（会引入路径/时序脆弱性）。它是铁律 2/4 的运行时保障。

---

## 3. 各端拼装指南

### 桌面三端（Electron，已有）
- 入口：`src/main/index.ts`（窗口/tray/menubar）、`src/preload/index.ts`（桥）。
- 桥后端：主进程 `src/main/httpClient.ts`（`request` → undici）、`src/main/store.ts`（`electronStore` → electron-store，3 个命名空间 `config`/`cache`/`state`）。
- 打包：`npm run package-mac` / `package`(win) / `package-all`。

### 安卓端（Capacitor，本分支新增）
- 工程：`android/`（由 `npx cap add android` 生成，勿手改其 Gradle 模板之外的结构）。
- 桥后端：`android/app/src/main/java/com/thecoolboyhan/fishingfunds/plugins/ContextModulesPlugin.java`。
- 配置：`capacitor.config.ts` → `webDir: 'release/app/dist/renderer'`（即 `npm run build` 的 renderer 产物）。
- 构建流程：
  1. `npm run build`（产出 `release/app/dist/renderer`）
  2. `npx cap sync android`（把 web 资源拷进 `android/app/src/main/assets/public`）
  3. `cd android && ./gradlew assembleDebug`（产 `app-debug.apk`）
- 原生桥语义须与 Electron 对齐：
  - `request(url, config)` → 返回 `{ body, headers }`；对 `eastmoney.com` 复刻 `nid` cookie 逻辑（见 `httpClient.ts`）。
    - **响应码不设限**：4xx/5xx 与桌面端（undici 不因 4xx 抛错）一样返回响应体；响应体为空时返回空串，**不得**整包返回 `{}`（否则渲染端 `body.xxx` 会静默炸在 service 的 try/catch 里）。
    - **二进制（`responseType: 'arraybuffer'`）走 base64 信封**：Capacitor 无法序列化 `byte[]`（会被 `JSONObject` 当非法值静默吞掉，退化成 `"[B@xxxx"` 字符串），故原生返回 `{ body: <base64>, __binary: true }`，由 `src/renderer/index.html` 的桥引导脚本解码回 `ArrayBuffer`。**新增二进制接口必须沿用这个约定**。
    - 请求抛异常时记 `Log.e("ContextModules", ...)`（`adb logcat -s ContextModules` 可查）——桌面端有 undici 堆栈，安卓端不能没有，否则数据层故障完全静默。
  - `electronStore` → 用 3 个 `SharedPreferences`（文件名 `config`/`cache`/`state`，key 同名），JSON 序列化；`cover` = 整体替换该命名空间（**参数名是 `value`**，与 Electron 的 `cover(type, value)` 一致）。
  - `io` → 写入应用外部存储 `Downloads`（`getExternalFilesDir`），返回真实路径。
  - `electron.shell.openExternal` → `Intent.ACTION_VIEW` 打开浏览器。
  - `electron.clipboard` → `ClipboardManager`。
  - `electron.ipcRenderer/dialog/app` → 安卓无对应物，提供**安全默认值（不是裸 no-op）**，否则渲染层 `const { filePaths } = await dialog.showOpenDialog()` 解构 `undefined` 会直接抛 `TypeError`：
    - `showMessageBox` → `{ response: 1, checkboxChecked: false }`。**`response` 语义是 0=确定、1=取消，默认必须取 1**，否则「删除自选 / 恢复备份」会被静默执行。
    - `showSaveDialog` → `{ canceled: true, filePath: undefined }`；`showOpenDialog` → `{ canceled: true, filePaths: [] }`。
    - `ipcRenderer.invoke/on`、`app.quit/relaunch` 等无副作用者为 no-op；`app.getVersion`、`clipboard.readText` 已真实实现。

---

## 4. 漂移警戒（接手 AI 自查清单）

改动前自问：
- [ ] 我改的是 `src/renderer` 吗？→ 若是，四端会同步受益，符合铁律 1。
- [ ] 我有没有在 renderer 里直接 `fetch` / `localStorage` / `window.open` / `navigator.clipboard`？→ 有则违反铁律 2，改走桥。
- [ ] 我有没有新增桌面专属 UI 且不隐藏于安卓？→ 用 `process.platform === 'android'` 条件渲染（铁律 3）。
- [ ] 我动了 `contextModules` 的成员签名吗？→ 必须三处（preload / Kotlin 插件 / preload.d.ts）同步改（铁律 4）。
- [ ] 我把业务逻辑写进 `android/` 的 Kotlin 了吗？→ 违反铁律 5，搬回 renderer。

---

## 5. 已知边界 / 后续迭代

- 安卓端 `electronStore` 未加密（Electron 端用了 `encryptionKey: '1zilc'`）；如需等价可加同等密钥加密，属可选增强。
- **安卓端没有真正的原生弹窗**：`dialog.*` 目前是安全默认值（一律按「取消」处理），因此「删除自选」「导出 CSV/JSON」「备份导入导出」在安卓端是**静默不执行**而不是报错。要真正可用需用 `AlertDialog` / SAF 文件选择器实现 `showMessageBox` / `showSaveDialog` / `showOpenDialog` —— 属下一轮迭代（AGENTS.md §6）。
- **网页查看器（`WebViewer`）依赖桌面 `<webview>` 标签与 `open-child-window`，安卓端不可用**：`ipcRenderer.invoke('open-child-window')` 为 no-op，`useFakeUA` 的 `get-fakeUA` 亦无实现。若要在安卓看新闻原文，应改为 `shell.openExternal` 外链或原生 WebView Activity。
- 移动端「全屏可用」已满足（Capacitor 默认全屏 WebView）；移动端专属 UX（触摸手势、面板改版）是下一轮迭代，`mobile.css` 的 `platform-android` 规则只做最小适配，不破坏桌面。
- `io` 的导出类功能（导出 CSV/图片）在安卓端映射到了应用外部存储，路径与桌面不同属预期。

### `electronStore` 的类型契约（2026-09-23 补齐，极易回归）

桥的 `electronStore` 必须与 Electron `electron-store` 语义一致：**写进去什么类型，读出来就是什么类型**
（对象/数组必须原样回来，不能退化成字符串）。安卓侧有三个坑，均已修复，改这里务必回归测试：

1. **`toJson` 必须用 `org.json` 的基类 `JSONObject` / `JSONArray` 判断，不能只判 Capacitor 的 `JSObject` / `JSArray`。**
   `JSObject(String)` 解析出来的嵌套值，`opt()` 返回的是 `org.json.JSONObject` / `JSONArray` 本体（不是 Capacitor 子类），
   只判子类会漏到 `String.valueOf(o)` 兜底分支 → 文本再被 `JSONObject.quote()` 一次 → **双重编码**：
   - 写：存储成 `"[{\"a\":1}]"`（外层多一层引号）
   - 读：`parseJson` 剥掉外层引号 → 拿到的却是 `String` 而不是数组/对象
   - 后果：`all('config')` 里的 `WALLET_SETTING` 变字符串，而 `Utils.GetCodeMap(list)` 内部是
     `list.reduce(...)`，在 String 上直接抛 `TypeError` → **钱包配置解析静默失效（新增基金/股票重启后丢失）**
2. **`storeCover` 同理**：`opt("value")` 拿到的是 `JSONObject` 本体，只判 `JSObject` 会得到 `null`，
   于是 `clear()` 之后什么都没写 → **整个命名空间被静默清空**（恢复备份时损失全部配置）。
3. **`saveJsonToCsv` 同理**：`json.get(i)` 的元素是 `JSONObject` 本体，只判 `JSObject` 会漏掉表头与所有数据行
   → 导出出一个只有 BOM 的空 CSV。

自查命令（CDP 注入，跑在 /json 的 webSocketDebuggerUrl 上）：

```js
// 类型回环：必须得到 [object Array] / [object Object]，得到 [object String] 就是双重编码复发
await window.contextModules.electronStore.set('config','__t',[{a:1}]);
Object.prototype.toString.call(await window.contextModules.electronStore.get('config','__t',null));
```

### 持久化监听器的启动时机（2026-09-23 修复的静默丢写）

`config.listener.ts` / `state.listener.ts` 的落盘依赖 `listenerMiddleware` 已注册。原实现只在
`useShareStoreState()` 里调 `startListening()`，而该 hook 只被 **HomePage / DetailPage** 使用 ——
于是 **InitPage.init() 里的全部配置 dispatch 都发生在监听器注册之前，写入被静默丢弃**：

- 症状：首次启动后 `config.xml` / 对应 SharedPreferences 里**只有 `cache` 有数据**（缓存要等网络回来才写，所以反而正常），
  `WALLET_SETTING` / `SYSTEM_SETTING` / `CURRENT_WALLET_CODE` 等一律为空。
- 修复：`startListening()` 已做幂等保护，并在 `InitPage.init()` 的**第一行**提前调用。
- **铁律**：任何「启动早期就 dispatch 持久化 action」的新代码，都必须保证 `startListening()` 已在它之前执行。

## 3.5 安卓请求要走「双网络栈互补」（2026-09-23 定案）

安卓端有**两套完全独立的网络实现**，实测能力互补——同一出口 IP、同一时刻、同一 URL：

| 接口 | 原生栈（OkHttp/HttpURLConnection） | WebView 浏览器栈（`fetch`） |
|---|---|---|
| `push2/api/qt/stock/get`（逐只行情：股票/指数/详情） | ❌ 连接被对端掐断 | ✅ 200 |
| `push2/api/qt/stock/trends2/get`（分时）、`kline/get`（K 线） | ❌ | ✅ 200 |
| `push2/api/qt/ulist.np/get`、`qt.gtimg.cn`、`datacenter-web` | ✅ | ✅ |
| `fund.eastmoney.com/*.js`、`fundgz.1234567.com.cn`（静态 js） | ✅ | ❌ 无 CORS 头，读不到 |

**因此 `request` 是「原生优先 + 传输层失败时用浏览器栈重试一次」，不是单一栈。**
实现跨两处，改动必须成对：

1. `ContextModulesPlugin.java` 的 catch 分支在 `Log.e` 之外，额外 resolve `{__failed:true, __error:"…"}`。
   用它与「真的拿到空响应体」区分开；**旧调用方读 body/headers 仍然拿到空对象，外部语义不变**。
2. `src/renderer/index.html` 的 inline 桥在 `res.__failed` 时调用 `webviewFetch(url, config)` 重试；
   两次都失败才回落到 `{}`（与旧行为完全一致）。**两条栈的尝试与失败原因都会打 console 日志**，
   绝不静默。

⚠️ 注意事项：
- `webviewFetch` 必须**跳过 fetch 禁用头**（`Host`/`Referer`/`Cookie`/`Origin`/`User-Agent`/
  `Accept-Encoding`/`Connection`/`Content-Length`），浏览器会静默忽略它们，显式跳过免得误判。
- 浏览器栈受 CORS 约束（依赖对方返回 `Access-Control-Allow-Origin`），所以**不能**把它当唯一栈。
- 返回形状必须与桌面 undici 对齐：`{body, headers}`；`json` 解析失败给 `{}` 而不抛错
  （对应 `httpClient.ts` 的 `catch { return {} }`）。

**为什么不能用单一栈"保持一致"**：只用浏览器栈会丢 `fund.eastmoney.com` 的静态数据（无 CORS）；
只用原生栈会丢 `push2` 的全部行情。桌面端之所以没这问题，是 undici 的 TLS/HTTP 指纹恰好不被拦。

### 基金数据源：默认的「天天基金」在部分出口会被 CDN 拦

实测 `fundgz.1234567.com.cn/js/<code>.js` 返回 **200 + HTML「页面未找到」**（响应头 `Last-Modified`
是 2025-09-03、`X-Cache-Lookup: Cache Refresh Hit` = CDN 缓存的旧 404），**桌面端同样拿不到**，
属出口 IP 被 CDN/WAF 判定异常，非端侧 bug。此时「设置 → 基金接口」切到别的源即可：

| `fundApiTypeSetting` | 源 | 端点 | 实测（2026-09-23） |
|---|---|---|---|
| 0 | 东方财富-天天基金 | `fundgz.1234567.com.cn/js/<code>.js` | ❌ 被 CDN 拦 |
| 1 | 腾讯证券 | `web.ifzq.gtimg.cn/.../getSsgz` | ❌ 上游返回 `interface offline`（接口已下线） |
| 2 | 支付宝-蚂蚁 | `www.fund123.cn/matiaria` | ⚠️ 页面可用但解析依赖内嵌 script，未验证 |
| 3 | 同花顺-爱基金 | `fund.10jqka.com.cn/data/client/myfund/<code>` + `gz-fund.10jqka.com.cn/` | ✅ 净值与分时估值均正常 |

### 排查数据为空时的第一动作（血泪经验）

数据空洞**绝大多数是网络出口问题，不是桥的 bug**。先用两端的「同一接口」做对照，再怀疑代码：

| 症状 | 结论 |
|---|---|
| 安卓 `Log.e("ContextModules")` 出现 `unexpected end of stream on okhttp.Address`（连接被对端掐断，响应头都没到） | **出口/代理问题**。桌面端同接口会报 undici `SocketError: other side closed` |
| 同一 hostname 下 `/robots.txt` 通、`/api/qt/*` 挂 | 同上：服务端 WAF 按路径/出口 IP 处置，与桥无关 |
| 桌面端同样为空 | 铁证：非安卓移植问题 |
| 返回 200 但**内容是 HTML**（如 `<title>页面未找到 - 东方财富网</title>`），响应头 `Last-Modified` 是去年、`X-Cache-Lookup: Cache Refresh Hit` | **CDN 缓存的旧 404 页**，同样是出口 IP 被 CDN 判为异常源所致；加 `?rt=` cache-buster / `Referer` 都绕不过 |

复现命令（本次验证用）：`curl` 直连该接口；或 `node -e` 走 `src/main/httpClient.ts` 的同款 undici 请求做对照。**两端同挂 = 环境问题；只有安卓挂 = 桥的 bug。**

**注意「同源不同命」**：同一个 `push2.eastmoney.com`，`/api/qt/ulist.np/get` 通、`/api/qt/stock/get` 挂是常态——
eastmoney 的不同路径落在不同后端/WAF 策略上，**不能用「某个 push2 接口通了」推断整站通**。
另：代理节点池会让出口 IP 逐请求轮换（本次实测同机出现 `61.8.209.79` 与 `114.251.133.230` 两个出口），
所以「同一请求时通时不通」也应先怀疑出口，而不是代码。

**当前实测（2026-09-23，出口 `61.8.209.79`）**：❌ `push2/api/qt/stock/get`（逐只行情，基金/股票列表依赖）
❌ `push2/api/qt/clist/get`（榜单/板块）❌ `push2his/.../trends2|kline`（走势/K线）❌ `fundgz.1234567.com.cn`（基金估值）
❌ `api.coingecko.com`（货币）；✅ `push2/api/qt/ulist.np/get`（批量行情）✅ `qt.gtimg.cn` ✅ `fund.eastmoney.com/pingzhongdata`
✅ `fund.eastmoney.com/robots.txt`。**关掉代理 / 换国内节点后列表即可正常出数。**

---

_最后更新：2026-09-23（安卓联调第二轮：修 `electronStore` 双重编码（`JSONObject`/`JSONArray` 基类判断）、
`storeCover` 静默清空、`saveJsonToCsv` 空文件、持久化监听器启动竞态；新增 `defaultWallet` 首次启动种子数据；
`mobile.css` 去掉裸 `@media (max-width:600px)`（会误伤 325px 宽的桌面菜单栏小窗，把 antd Switch 撑成灰色块）；
`baseFontSizeSetting` 12→13。数据为空已定位为出口 IP 被 WAF/CDN 拦截，非移植问题。）_
