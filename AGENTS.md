# AGENTS.md — 给接手 AI 的维护手册

> 本文件面向**后续接手本项目维护的其他 AI（或人类）**。读完后应能独立完成构建、定位改动点、并知道哪些是红线。
> 配套文档：`FORK_README.md`（面向人类维护者的踩坑与操作清单）、`ARCHITECTURE.md`（**多端架构契约与桥定义，改代码前必读**）。三文件互补：本文件偏"操作与红线速查"，ARCHITECTURE 偏"为什么这样设计"，FORK_README 偏"操作步骤"。

---

## 0. 架构铁律（最高优先级，先看；破坏即视为回归）

> 本项目已从"Electron 单端"演化为 **mac/win/linux 状态栏小应用 + Android 全屏应用 四端共用一份 `src/renderer`** 的架构（分支 `android-capacitor`）。下面 5 条是**不可破坏的不变式**，详见 `ARCHITECTURE.md` §1。改任何代码前先默念一遍。

1. **`src/renderer` 必须平台无关、单份源码**：四端共用同一份 renderer，**禁止为某端另起 renderer 副本**（否则开始"漂移"，再也合不回）。
2. **所有平台差异只走 `window.contextModules` 桥**：请求→`contextModules.request`、配置→`contextModules.electronStore`、外链→`contextModules.electron.shell.openExternal`、剪贴板→`contextModules.electron.clipboard`、文件→`contextModules.io`、平台识别→`contextModules.process.platform`。**禁止**在 renderer 里直接 `fetch` 第三方/`localStorage`/`window.open`/`navigator.clipboard`/读 `navigator.userAgent`。
3. **禁止把桌面假设写进 renderer**：窗口/Tray/菜单栏/开机启动等桌面概念不得硬编码进组件；确需按端区分 UI，用 `if (process.platform === 'android')` 条件渲染。
4. **桥契约两端同步**：动 `contextModules` 成员签名，必须同时改 `src/preload/index.ts`（Electron）+ `android/.../ContextModulesPlugin.java`（安卓）+ `src/renderer/typings/preload.d.ts`（类型）。返回 `{ body, headers }` 形状、Promise 语义须一致。
5. **安卓壳是"壳"不是"fork"**：`android/` 只包 WebView、提供桥，**业务逻辑全在 renderer**，不得搬进 Kotlin 层。

> `src/renderer/index.html` 的 **inline 桥引导脚本是铁律 2/4 的运行时保障，禁止删除或改成外部文件**（Electron 端它直接 `return` 跳过，安卓端惰性委托 Capacitor 插件并带 ready 重试）。

---

## 1. 项目介绍（这是啥 / 为何 fork）

**fishing-funds** 是一个基于 Electron 的**状态栏小应用**，可在 macOS / Windows / Linux 的菜单栏（或托盘）常驻显示：

- 自选基金实时估值与涨跌
- A 股 / 大盘指数 / 港股 / 美股行情
- 虚拟货币行情
- 新闻、汇率等辅助信息

官方仓库 `https://github.com/1zilc/fishing-funds` 已**停止维护**。本仓库是其 **fork**，由用户本地自行长期维护。

### 为什么以 v8.7.1 为基线（关键决策）

| 版本 | 数据层状态 | 能否自构建 | 结论 |
|---|---|---|---|
| **v8.7.1**（本基线） | 完整开源，无子模块 | ✅ 可独立编译打包 | **采用** |
| v8.8.0（官方末版） | 反爬绕过逻辑（`src/lib/enh`）被抽成**私有 git 子模块** `fishing-funds-enh`，作者声明"请求及部分绕过机制暂时闭源" | ❌ 公开源码缺子模块，编译不出可运行 App | 拒绝 |

**结论：v8.7.1 是最后一个"数据层完整开源、可自构建、可自维护"的版本。** 本 fork 只维护这条线，不引入 8.8.0 的任何闭源改动。

### 许可证

GPL-3.0。个人自构建零义务；若对外发布（含 dmg / exe），必须保持 GPL-3.0 并公开对应源码。

---

## 2. 环境与技术栈

| 项 | 值 |
|---|---|
| 运行时 | Node **>=22.8.0**（已在 `package.json` 的 `devEngines.runtime` 声明，onFail: error） |
| 包管理器 | **npm**（本机实测）。仓库虽带 `pnpm-lock.yaml`，但 pnpm 在受限沙箱环境下会因临时目录 `unlink` 被 EPERM 拦截；**推荐直接用 npm**，避免踩坑 |
| 主框架 | Electron + React 19 + Redux (Toolkit) + Ant Design + ECharts |
| 语言 | TypeScript |
| 构建 | `electron-vite`（dev/build），`electron-builder`（打包） |
| 关键钉死依赖 | `@nivalis/string-similarity@5.0.0`（必须是 5.0.0，见 §4 红线） |

### 依赖安装要点（已踩坑，照做即可）

```bash
cd /Users/admin/ai/fishing-funds
PHANTOMJS_SKIP_DOWNLOAD=true npm install --ignore-scripts   # 跳过 phantomjs-prebuilt 等会下载二进制的 postinstall
node node_modules/electron/install.js                        # 单独拉 Electron 运行时二进制
```

- **必须 `--ignore-scripts`**：传递依赖 `phantomjs-prebuilt` 的 postinstall 会尝试下载 PhantomJS（App 用不到，且下载源常不可达，会卡死安装）。
- 装完需手动跑 `electron/install.js` 把 Electron 二进制补回来（`--ignore-scripts` 会跳过它）。

---

## 3. 目录与结构分析（改哪里 / 看哪里）

```
fishing-funds/
├── src/
│   ├── main/                # Electron 主进程（核心维护入口）
│   │   ├── index.ts         # 启动入口（创建窗口/tray/menubar）
│   │   ├── autoUpdater.ts   # ⚠️ 已改：AUTO_UPDATE_ENABLED=false（见 §4）
│   │   ├── tray.ts          # 状态栏图标/菜单
│   │   ├── menubar.ts       # macOS 菜单栏窗口
│   │   ├── proxy.ts         # 系统代理读取
│   │   ├── hotkey.ts        # 全局快捷键
│   │   ├── store.ts         # 主进程配置存储
│   │   └── ...
│   ├── preload/             # 预加载脚本（主/渲染进程桥）
│   └── renderer/            # React 渲染进程（604 个文件）
│       ├── services/        # ★ 数据抓取层（最频繁的维护点）
│       │   ├── fund.ts       # 基金估值/净值
│       │   ├── stock.ts      # A股/港股/美股
│       │   ├── coin.ts       # 虚拟货币
│       │   ├── quotation.ts  # 实时报价
│       │   ├── zindex.ts     # 指数
│       │   ├── exchange.ts   # 汇率
│       │   ├── news.ts       # 新闻
│       │   └── index.ts      # service 聚合导出
│       ├── store/           # Redux store（features/ + listeners/）
│       ├── components/      # UI 组件
│       ├── containers/      # 容器组件
│       ├── workers/         # Web Workers（计算/抓取）
│       ├── constants/ helpers/ utils/ styles/ typings/ static/ public/
├── build/                   # electron-builder 打包资源（图标/yml）
├── assets/ screenshots/ templates/
├── electron.vite.config.ts # electron-vite 配置（main/preload/renderer 三入口）
├── package.json            # ★ 已改（见 §4）
├── pnpm-lock.yaml          # 锁文件（npm 安装时参考，不必强求一致）
├── FORK_README.md          # 人类维护者文档
└── AGENTS.md               # 本文件
```

### 维护时最常碰的三个位置

1. **`src/renderer/services/*`** — 所有行情/基金数据都从这里抓取。东方财富等数据源一旦改接口或加反爬，这里最先坏，是 fork 维护的核心工作量来源。
2. **`src/main/autoUpdater.ts`** — 自动更新开关，fork 后默认关闭。
3. **`package.json`** — 版本钉死、打包配置、发布目标。

> 关于 8.8.0 的闭源子模块：本基线**不存在** `src/lib/enh`，且**无** `.gitmodules`。不要尝试 `git submodule update`，会失败。所有数据逻辑都在 `src/renderer/services/` 内，已完整开源。

---

## 4. 已执行的变更（维护化改造，均已提交）

**分支**：`maintain-8.7.1`（维护主分支）
**基线标签**：`fork-base-8.7.1` → 官方 v8.7.1（commit `191305f`，PR #742）

提交历史（从新到旧）：

| commit | 说明 |
|---|---|
| `a1ad1e4` | fix: 本地可构建化改造（fork 维护基线） |
| `73c95b7` | chore(fork): 锚定 v8.7.1 自维护基线（远端/分支/标签/关闭更新/FORK_README） |
| `191305f` | 官方 8.7.1 原始提交（tag: v8.7.1, fork-base-8.7.1） |

具体改造清单：

1. **`package.json` → `build.publish: []`**
   切断 electron-builder 向官方 `1zilc/fishing-funds` 源发布/更新配置。
2. **`src/main/autoUpdater.ts` → `const AUTO_UPDATE_ENABLED = false`**
   模块级常量（注意：必须在 class 体外、文件作用域）。App 启动不再向官方源 `checkForUpdates()`。若要启用自更新，需先把 `build.publish` 换成你自己的仓库，再把该常量改 `true`。
3. **`package.json` → `@nivalis/string-similarity` 钉死 `"5.0.0"`**
   原为 `"^5.0.0"`，npm 会解析到 ESM-only 的 `5.2.0`，导致 vite 解析入口失败（"Failed to resolve entry"）。必须保持精确 `5.0.0`（与 `pnpm-lock.yaml` 一致，CJS 可构建）。
4. **`package.json` → 删除非法的 `devEngines.packageManager`**
   原为 `"name":"npm","version":">=10.9.x"`：既声明错误（实际用 pnpm）又非合法 semver，导致安装直接报错。仅保留 `devEngines.runtime` 的 Node 检查。
5. **新增 `FORK_README.md`** — 人类向操作/踩坑文档。

### 构建验证结果（已实测）

- `npm run build` → **exit 0**，产出 `release/app/dist/{main,preload,renderer}` 完整。
- Electron 二进制就位：`node_modules/electron/dist/Electron.app/Contents/MacOS/Electron`。
- 当前工作树 `git status` 干净（无未提交文件）。

---

## 5. 当前状态与待办

### 已完成 ✅

- 本地 fork 仓库、git 远端（`upstream` 指向官方）、分支、基线标签齐全。
- 维护化改造全部提交。
- 依赖安装 + 构建验证通过。
- 工作树干净。
- **安卓端跑通并修掉 6 个桥 bug**（2026-09-23，`android-capacitor` 分支，**改动尚未提交**）：
  二进制响应 base64 信封、`dialog.*` 安全默认值、`storeCover` 参数名、4xx 响应体丢失 + 异常日志、
  **`electronStore` 双重编码**（`JSONObject`/`JSONArray` 基类判断）、**持久化监听器启动竞态**（初始化写入全丢）。
- **首次启动种子自选数据**：`defaultWallet`（4 基金 + 4 股票，其中基金 `000001` 与股票 `600519` 带示意持仓）
  仅在本地无 `WALLET_SETTING` 时生效，绝不覆盖既有配置。已实测落盘。
- **移动端适配**：`mobile.css` 去掉裸 `@media (max-width:600px)`（曾误伤 325px 桌面小窗、把 antd Switch 撑成灰色块）；
  `baseFontSizeSetting` 12→13，字号滑杆上限 14→16。

### 待办（多为需人类动手 / 外部操作）

- [x] **GitHub 远端已发布**（2026-09-22 完成）：仓库 `https://github.com/thecoolboyhan/fishing-funds.git`（公开，默认分支 `maintain-8.7.1`），已 push 分支 + `fork-base-8.7.1` 锚点标签。**未推官方 v1~v8.8.0 标签**（避免闭源 8.8.0）。
  - ⚠️ **推送网络坑**：本机 Clash TUN 代理下 git HTTPS push 会被返回 `HTTP 408`（smart-HTTP receive-pack 被拦截），**推送前先关 Clash 或让 github 走直连**；或改用 SSH（`git@github.com:thecoolboyhan/fishing-funds.git`）。详见 `FORK_README.md`。
- [ ] **（建议）让「已配置但暂无行情」的条目仍然显示**：`Utils.MergeStateWithResponse` 现在是
  `if (stateItem || responseItem) map[index] = …`，即**配置项在既无缓存 state、又无行情响应时会被整行丢弃**。
  后果：新装/行情接口挂掉时，用户刚添加的基金或股票会**整行消失**（连删除入口都没有），
  `defaultWallet` 种子数据在网络不通时也看不见。改法：reduce 里改为无条件写入，
  并给 fund 传 `configToState: (c) => ({ ...c, fundcode: c.code })`（股票配置本身已有 `secid`，可直接 spread）。
  **注意**：这是四处 UI 共用的合并逻辑，改动会影响桌面端，需先确认行组件对 `dwjz/gsz` 缺失的渲染是否优雅。
- [ ] （可选）自签名 / Apple 公证打包：当前 `npm run package-mac` 产未签名 dmg，macOS 首次运行需 `sudo xattr -d com.apple.quarantine /Applications/fishing-funds.app`。
- [ ] **安卓端原生弹窗 + 文件选择器**：`AlertDialog` + SAF 实现 `showMessageBox` / `showSaveDialog` / `showOpenDialog`。现状是安全默认值（一律按「取消」），所以**删除自选、导出 CSV/JSON、备份导入导出在安卓端静默不执行**（不再抛错，但也没功能）。见 `ARCHITECTURE.md` §5。
- [ ] **安卓端网页查看器**：`WebViewer` 依赖桌面 `<webview>` 与 `open-child-window`，安卓端不可用（新闻「查看原文」无反应）；应改走 `shell.openExternal` 外链或原生 WebView Activity。
- [ ] 安卓端发布化：当前只有 debug APK（无 signingConfig）；要发布需 keystore，并考虑 `versionCode/versionName`（现为写死的 `1`/`1.0`）与品牌图标/启动图（现为 Capacitor 默认）。
- [ ] （可选）维护工作流文档化：如何在保持 8.7.1 基线的前提下，把 upstream 的安全/数据修复 cherry-pick 进来，同时排除 8.8.0 闭源改动。

---

## 6. 下一步规划（建议路线）

1. **建立远端 + 保护分支**：先完成 §5 的 GitHub fork，把 `maintain-8.7.1` 设为默认分支并保护。
2. **数据层加固（高优先级）**：`src/renderer/services/*` 是长期维护重心。每次数据源（东方财富等）接口变动或反爬升级，优先在此修复；可加一层请求缓存/失败兜底，避免单点数据源挂掉整个状态栏。
3. **依赖与安全更新**：在保持 `@nivalis/string-similarity@5.0.0` 的前提下，定期评估 `npm audit`，升级有 CVE 的传递依赖（用 `npm`，不要回退到 pnpm 以免沙箱 EPERM）。
4. **自更新（可选）**：若对外发布，部署自己的 GitHub Releases 作为 `build.publish` 目标，并把 `AUTO_UPDATE_ENABLED` 改 `true`；注意 GPL-3.0 须同步公开源码。
5. **跨平台**：当前重点 macOS；Windows/Linux 打包配置（`build.win` / `build.linux`）已存在，按需本地验证。
6. **多端共用一份 renderer（android-capacitor 分支，进行中）**：mac/win/linux 状态栏小应用 + Android 全屏应用四端共用 `src/renderer`。安卓壳用 Capacitor 6（`android/` 工程 + `ContextModulesPlugin.java` 原生桥）；`contextModules` 桥引导在 `src/renderer/index.html` 内联注入。**架构契约与桥定义见 `ARCHITECTURE.md`，改动前必读。**

---

## 7. 给接手 AI 的速查（红线 & 命令）

### 常用命令

```bash
npm run dev          # 开发预览（菜单栏小窗）
npm run build        # 构建到 release/app/dist（已验证通过）
npm run package-mac  # 打未签名 dmg
npm run preview      # 预览构建产物
git push origin maintain-8.7.1   # 推维护分支（⚠️ 见下方红线：代理下会 408）

# —— 安卓端（Capacitor，android-capacitor 分支）——
npm run build                 # 先产出 release/app/dist/renderer
npx cap sync android          # 把 web 资源同步进 android/ 工程
cd android && ./gradlew assembleDebug   # 产 app-debug.apk（需 JDK17 + ANDROID_HOME，首次会下 Gradle）
# 安卓桥实现：android/app/src/main/java/com/thecoolboyhan/fishingfunds/plugins/ContextModulesPlugin.java
```

> **推送 GitHub 的坑**：本机 Clash TUN 代理下 `git push`（HTTPS）必被返回 `HTTP 408`（smart-HTTP `git-receive-pack` 被拦截），与包大小无关。推送前先**关掉 Clash / 让 github 走直连**，或改用 SSH 远端 `git@github.com:thecoolboyhan/fishing-funds.git`。GET/API 小请求不受影响。

### 关键文件速记

| 文件 | 角色 |
|---|---|
| `src/renderer/services/*` | 数据抓取层，维护核心 |
| `src/main/autoUpdater.ts` | 更新开关（已关） |
| `package.json` | 版本钉死 + 打包/发布 |
| `FORK_README.md` | 人类操作手册 |
| `AGENTS.md` | 本文件 |

### 红线（不要做）

- ❌ **不要把 `@nivalis/string-similarity` 改回 `^5.0.0`** 或升级到 5.2.0+（ESM-only 会破坏 vite 构建）。
- ❌ **不要尝试引入 8.8.0 的 `src/lib/enh` 闭源子模块**（无法获取源码，且违背 fork 初衷）。
- ❌ **不要把 `build.publish` 指回官方 `1zilc` 源**，也不要在 `AUTO_UPDATE_ENABLED=false` 未评估的情况下开启自更新（会向官方拉更新）。
- ❌ **不要在 `devEngines` 里写非法 semver 或非 pnpm 的 packageManager 声明**（会导致安装报错）。
- ❌ **不要 `git merge upstream/main` 整个主干**（会带入 8.8.0 闭源改动）；如需上游修复，用 `git cherry-pick <commit>` 精选，并人工排除闭源部分。
- ❌ **不要破坏 `ARCHITECTURE.md` 里的 5 条架构铁律**（多端共用一份 renderer / 差异只走 `contextModules` 桥 / 桌面假设不进 renderer / 桥契约两端同步 / 安卓壳只是壳）。改代码前先读 `ARCHITECTURE.md`。
- ❌ **不要删除或外置 `src/renderer/index.html` 里的 inline 桥引导脚本**（它是铁律的运行时保障；Electron 端自动跳过，安卓端惰性委托 Capacitor 插件）。
- ❌ **不要把 `electron.dialog.*` 改回裸 `noop`**（返回 `undefined`）：渲染层 `const { filePaths } = await dialog.showOpenDialog()` 会直接抛 `TypeError`。也不要让 `showMessageBox` 默认 `response: 0`——`0` 是「确定」，会让「删除自选 / 恢复备份」被静默执行。默认必须 `response: 1`（取消）。
- ❌ **二进制响应（`responseType:'arraybuffer'`）不要直接 `result.put("body", byte[])`**：Capacitor 的 `JSObject.put` 会静默吞掉非法值，渲染端只拿到 `"[B@xxxx"` 字符串。必须走 `base64 + __binary` 信封（见 `ARCHITECTURE.md` §3），并在 inline 桥引导脚本里解码回 `ArrayBuffer`。
- ❌ **不要删掉安卓 `request` 的 catch 里那行 `Log.e(TAG, "request failed: " + url, e)`**：桌面端有 undici 堆栈，安卓端没了这行日志，数据层故障会 100% 静默（这次就是靠它定位到 `unexpected end of stream` 的）。
- ❌ **数据为空时不要先怀疑桥**：`push2.eastmoney.com/api/qt/*` 这类接口在代理出口下会被服务端掐连接（安卓 `unexpected end of stream` / 桌面 undici `other side closed`，两端一致）。先用 ARCHITECTURE.md §5 的对照法确认是否环境问题。
- ❌ **`ContextModulesPlugin` 里判断 JSON 结构必须用 `org.json` 基类 `JSONObject` / `JSONArray`，不要用 Capacitor 的 `JSObject` / `JSArray`**：`JSObject(String)` 解析出的嵌套值本体是 `org.json` 类型，只判子类会漏到 `String.valueOf` 兜底分支 → 双重编码（写 `"[{...}]"`、读回 `String`）→ `GetCodeMap(list)` 在 String 上 `reduce` 抛 `TypeError` → **钱包配置静默失效**。`toJson` / `storeCover` / `saveJsonToCsv` 三处都踩过，见 `ARCHITECTURE.md` §5「`electronStore` 的类型契约」。
- ❌ **不要在没有 `startListening()` 的情况下 dispatch 持久化 action**：`config/state.listener` 未注册时写入被静默丢弃。已改由 `InitPage.init()` 第一行提前注册（`startListening` 幂等）。新增任何「启动早期写配置」的逻辑前先确认监听器已就绪。
- ❌ **不要在 `mobile.css` 里写裸媒体查询（如 `@media (max-width:600px) { button {…} }`）**：桌面菜单栏小窗只有 325px 宽，裸媒体查询会连桌面端一起命中 —— 本次就是把 antd Switch 撑成灰色块的真凶。所有移动端规则一律挂在 `.platform-android` 下，且放大点击热区时必须 `:not(.ant-switch)` 排除开关类组件。
- ❌ **不要把 `mobile.css` 写成「给所有 button / a 加 min-height」**：本应用布局是紧凑型、容器高度写死
  （`SortBar` 的 `.content` 固定 `height:32px`），给子元素强加高度会让它比容器更高、**向上溢出**——
  表现为「管理 / 榜单 / 自定义」文字位置偏上（真踩过）。`mobile.css` 只做视口级适配，绝不碰组件尺寸；
  要放大点击热区请逐个组件做并同步调容器高度。
- ❌ **不要只保留安卓桥的单条网络栈**：`src/renderer/index.html` 的「原生优先 + `__failed` 时用
  WebView `fetch` 重试」是**必须**的（两栈能力互补，缺一会丢一半数据）。同时 `ContextModulesPlugin`
  的 catch 必须 resolve `{__failed:true, __error:…}`，否则渲染端无法区分「传输失败」与「空响应」。
  详见 `ARCHITECTURE.md` §3.5。
- ❌ **不要为了「列表不留空」把 `Utils.MergeStateWithResponse` 改成无条件保留配置项**：下游
  `CalcFund` / `CalcStock` 会拿到没有 `dwjz`/`gsz` 的项，`NP.minus(undefined, …)` 直接抛
  `TypeError` → 整个列表白屏（实测过）。要改必须同时给这两个 Calc 加缺值保护，并想清楚「无行情行」
  显示什么（显示 `0.00` 比不显示更糟）。
- ❌ **不要在 `src/renderer` 的组件 / services 里直接 `fetch` 第三方 / 用 `localStorage` 作主存储 /
  `window.open` 外链 / `navigator.clipboard` / 读 `navigator.userAgent` 判断平台**——违反铁律 2，必须走
  `contextModules` 桥。（唯一例外：`index.html` 的 inline 桥**自身**实现里可以用 `fetch`，
  因为那正是「平台差异层」，安卓的浏览器栈重试就靠它。）

### 数据源失效时的第一动作

1. 读 `src/renderer/services/index.ts` 找到对应 service。
2. 在浏览器/Postman 复现该 service 的请求，确认是接口变动还是反爬。
3. 在 service 内修请求参数/解析逻辑；必要时加 `src/main/proxy.ts` 已支持的代理或 UA 伪装。
4. `npm run build` 验证，再提交。

> **先分清是哪一层失效**（2026-09-23 的血泪分工）：
> · 只有安卓 native 栈挂、同一 URL 在 WebView `fetch` 能通 → **桥的传输问题**，见 `ARCHITECTURE.md` §3.5。
> · 两条栈 + 桌面 undici 全挂 → **出口 IP 被服务端拦**，改代码没用，换网络/节点，或换数据源。
> · 只有基金为空、且 `fundgz` 返回 `200 + HTML` → 默认基金源被 CDN 拦，**切「设置 → 基金接口」到同花顺**，
>   见 `ARCHITECTURE.md` §3.5 的基金源对照表。

---

_最后更新：2026-09-23（安卓联调第三轮：新增「原生优先 + 浏览器栈重试」双网络栈互补（`ContextModulesPlugin`
catch 回 `__failed` + `index.html` inline 桥 `webviewFetch`），修复股票/指数行情、分时、K线与详情页全空；
`mobile.css` 去掉给所有 button/a 的 min-height（它把固定 32px 的 SortBar 撑溢出，导致「管理」等文字偏上）。
改动集中在 `ContextModulesPlugin.java`、`src/renderer/index.html`、`public/mobile.css`、`utils/index.ts`（仅加注释），
**均未提交**。基金默认源 `fundgz` 被 CDN 拦已定性为环境问题，切「基金接口 → 同花顺」即恢复。）_
