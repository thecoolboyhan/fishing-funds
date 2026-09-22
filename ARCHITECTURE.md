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
  - `electronStore` → 用 3 个 `SharedPreferences`（文件名 `config`/`cache`/`state`，key 同名），JSON 序列化；`cover` = 整体替换该命名空间。
  - `io` → 写入应用外部存储 `Downloads`（`getExternalFilesDir`），返回真实路径。
  - `electron.shell.openExternal` → `Intent.ACTION_VIEW` 打开浏览器。
  - `electron.clipboard` → `ClipboardManager`。
  - `electron.ipcRenderer/dialog/app` → 安卓无对应物，提供**安全 no-op**（不抛错、不崩溃），避免桌面专属功能在移动端炸。

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
- 移动端"全屏可用"已满足（Capacitor 默认全屏 WebView）；但**移动端专属 UX（底部 Tab 导航、响应式面板、触摸手势）是下一轮迭代**，当前靠 `mobile.css` 的 `platform-android` 媒体查询做最小适配，不破坏桌面。
- `io` 的导出类功能（导出 CSV/图片）在安卓端映射到了应用外部存储，路径与桌面不同属预期。

---

_最后更新：2026-09-22（android-capacitor 分支：Capacitor 双壳方案落地，铁律固化）。_
