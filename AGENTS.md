# AGENTS.md — 给接手 AI 的维护手册

> 本文件面向**后续接手本项目维护的其他 AI（或人类）**。读完后应能独立完成构建、定位改动点、并知道哪些是红线。
> 配套文档：`FORK_README.md`（面向人类维护者的踩坑与操作清单）。两文件互补，本文件更偏向"结构与决策"，FORK_README 更偏向"操作步骤"。

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

### 待办（多为需人类动手 / 外部操作）

- [ ] **GitHub 远端 fork（需人类手动）**：本机无 `gh` CLI、且无法在沙箱网页操作。步骤见 `FORK_README.md`：
  ```bash
  git remote add origin https://github.com/<你的用户名>/fishing-funds.git
  git push -u origin maintain-8.7.1 --tags
  ```
- [ ] （可选）自签名 / Apple 公证打包：当前 `npm run package-mac` 产未签名 dmg，macOS 首次运行需 `sudo xattr -d com.apple.quarantine /Applications/fishing-funds.app`。
- [ ] （可选）维护工作流文档化：如何在保持 8.7.1 基线的前提下，把 upstream 的安全/数据修复 cherry-pick 进来，同时排除 8.8.0 闭源改动。

---

## 6. 下一步规划（建议路线）

1. **建立远端 + 保护分支**：先完成 §5 的 GitHub fork，把 `maintain-8.7.1` 设为默认分支并保护。
2. **数据层加固（高优先级）**：`src/renderer/services/*` 是长期维护重心。每次数据源（东方财富等）接口变动或反爬升级，优先在此修复；可加一层请求缓存/失败兜底，避免单点数据源挂掉整个状态栏。
3. **依赖与安全更新**：在保持 `@nivalis/string-similarity@5.0.0` 的前提下，定期评估 `npm audit`，升级有 CVE 的传递依赖（用 `npm`，不要回退到 pnpm 以免沙箱 EPERM）。
4. **自更新（可选）**：若对外发布，部署自己的 GitHub Releases 作为 `build.publish` 目标，并把 `AUTO_UPDATE_ENABLED` 改 `true`；注意 GPL-3.0 须同步公开源码。
5. **跨平台**：当前重点 macOS；Windows/Linux 打包配置（`build.win` / `build.linux`）已存在，按需本地验证。

---

## 7. 给接手 AI 的速查（红线 & 命令）

### 常用命令

```bash
npm run dev          # 开发预览（菜单栏小窗）
npm run build        # 构建到 release/app/dist（已验证通过）
npm run package-mac  # 打未签名 dmg
npm run preview      # 预览构建产物
```

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

### 数据源失效时的第一动作

1. 读 `src/renderer/services/index.ts` 找到对应 service。
2. 在浏览器/Postman 复现该 service 的请求，确认是接口变动还是反爬。
3. 在 service 内修请求参数/解析逻辑；必要时加 `src/main/proxy.ts` 已支持的代理或 UA 伪装。
4. `npm run build` 验证，再提交。

---

_最后更新：2026-09-22（fork 创建 + 维护化改造完成，构建已验证通过）。_
