# Fishing Funds — 自维护 Fork（基线 v8.7.1）

本仓库是从官方 [`1zilc/fishing-funds`](https://github.com/1zilc/fishing-funds) fork 出来的**自维护版本**，锚定官方 **v8.7.1**。

## 为什么是 8.7.1 而不是最新的 8.8.0

- 官方 8.8.0（2026-01）把数据获取的核心——东方财富反爬绕过逻辑（`enhInterceptors`）、`services` 业务层——抽成了**私有子模块 `src/lib/enh`**（`.gitmodules` 指向 `git@github.com:1zilc/fishing-funds-enh.git`，作者声明"请求及部分绕过机制暂时闭源"）。
- 因此 **8.8.0 的公开源码无法独立编译出能跑的 App**（缺核心数据层）。
- 而 **v8.7.1 没有任何子模块**（`git submodule status` 为空），数据接口逻辑完整写在仓库内，**可以自构建、自修复**——这正是fork自维护的前提。
- 结论：用"可维护性"换"新特性（antd v6 / Electron v40）"。后续从 8.7.1 自己维护。

## 已做的维护化改造（本分支 `maintain-8.7.1`）

1. **远端**：官方仓库已重命名为 `upstream`（`git remote -v` 查看）。当你在 GitHub 上建好自己的 fork 后：
   ```bash
   git remote add origin https://github.com/<你的用户名>/fishing-funds.git
   # 之后推送到你自己的 fork：git push -u origin maintain-8.7.1
   ```
2. **基线标签**：`fork-base-8.7.1` 固定在官方 v8.7.1 提交（191305f），随时可回滚对照。
3. **自动更新已关闭**：`src/main/autoUpdater.ts` 中 `AUTO_UPDATE_ENABLED = false`，默认不再向官方源 `1zilc/fishing-funds` 拉更新（避免被官方 8.8.0 覆盖、也避免无数据层的版本污染）。
4. **`package.json` 的 `build.publish` 置空 `[]`**：electron-builder 不再生成官方更新源。

## 本地运行 / 构建

环境要求（与官方一致）：**Node ≥ 22.8**、**pnpm**（锁文件为 `pnpm-lock.yaml`）、macOS 需 Xcode Command Line Tools。

```bash
pnpm install            # 安装依赖（会下载 Electron 二进制，较慢）
pnpm dev               # 开发模式（需 bun，见下）
npm run build          # 产出 release/app/dist
npm run package-mac    # 打包 macOS dmg（arm64 + x64）
```

> 说明：`package.json` 的 `dev` 脚本用 `bunx --bun`，开发热更新需装 [bun](https://bun.sh)；但 `build` / `package-*` 仅用 electron-vite + electron-builder，无需 bun。

### 安装注意事项（踩坑记录）

- **依赖管理用 pnpm（首选）**：仓库带 `pnpm-lock.yaml`，`pnpm install` 会按锁文件精确安装（例如 `@nivalis/string-similarity` 锁定 `5.0.0`）。
- **`@nivalis/string-similarity` 已钉死为精确 `5.0.0`**：原 `package.json` 写的是 `^5.0.0`，用 npm 会解析到 `5.2.0`（ESM-only），导致 `electron-vite build` 报 *Failed to resolve entry*。已改为精确 `5.0.0`（与锁文件一致、CJS 可构建）。
- **`phantomjs-prebuilt` 的 postinstall 会去下载 PhantomJS 二进制，该依赖 App 用不到且下载源常不可达**：若 `pnpm install` / `npm install` 卡在 phantomjs 下载，改用：
  ```bash
  npm install --ignore-scripts --os=darwin --cpu=arm64   # 跳过所有 postinstall
  node node_modules/electron/install.js                   # 单独下载 Electron 二进制
  ```
- **macOS 上 `devEngines.packageManager` 已移除**：原仓库声明 `npm` 但 `pnpm-lock.yaml` 证明实际用 pnpm，且该字段写的 `>=10.9.x` 非法 semver，会导致 pnpm/npm 安装直接报错。已删掉，仅保留 Node 运行时版本检查。

### macOS 未签名运行

官方与 fork 默认都未签名。本地构建后若无法打开：

```bash
sudo xattr -d com.apple.quarantine "/Applications/Fishing Funds.app"
```

如需分发给他人，需要 **$99/年的 Apple Developer 证书**做公证（notarization）。

## 后续维护要点

- **数据接口会持续变**（股吧/板块/东方财富/天天基金常改），这是主要维护量。接口代码在本仓库内，**可自行修复**（这正是锚定 8.7.1 的意义）。
- **依赖大版本**：Electron 几乎每个 release 都升主版本；antd 也已跨 v5→v6。升级时注意 breaking changes。
- **版本号**：发布自己版本前，改 `package.json` 的 `version` 字段（建议用 `8.7.1-fork.x` 之类，避免和官方混淆）。
- **启用自己的自动更新**（可选）：在 `package.json` 的 `build.publish` 填你的 GitHub owner/repo，并把 `autoUpdater.ts` 的 `AUTO_UPDATE_ENABLED` 改回 `true`。
- **避免与官方冲突**（可选）：若想和官方版共存，改 `build.appId`（当前 `com.electron.1zilc.fishing-funds`）。

## 许可证

官方与本项目均为 **GPL-3.0**。个人自用/自构建零义务；若对外发布你的 fork，须保持 GPL-3.0 并公开你的修改源码。
