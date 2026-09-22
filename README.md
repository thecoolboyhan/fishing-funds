<p align="center">
<img src="https://github.com/thecoolboyhan/fishing-funds/blob/maintain-8.7.1/build/icon.png?raw=true" width="128">
</p>

# Fishing Funds（独立维护版）

![GitHub license](https://img.shields.io/github/license/thecoolboyhan/fishing-funds?color=blue)
![Windows](https://img.shields.io/badge/-Windows-blue?logo=windows&logoColor=white)
![MacOS](https://img.shields.io/badge/-macOS-black?&logo=apple&logoColor=white)
![Linux](https://img.shields.io/badge/-Linux-yellow?logo=linux&logoColor=white)

> 基金、大盘、股票、虚拟货币状态栏显示小应用，基于 Electron 开发，支持 macOS / Windows / Linux 客户端。数据源来自天天基金、蚂蚁基金、同花顺-爱基金、腾讯证券等。

## 关于本仓库

- 本项目代码**派生自 [`1zilc/fishing-funds`](https://github.com/1zilc/fishing-funds) v8.7.1**（GPL-3.0），现由本仓库**独立维护，与上游不再同步**。
- 选择 v8.7.1 作为基线：官方 8.8.0 把数据层核心（东方财富反爬绕过逻辑）抽成了闭源子模块，公开源码无法独立编译。v8.7.1 数据层完整开源，**可自行构建、自行修复**，适合长期自维护。
- 官方自动更新已关闭，构建产物只来自本仓库代码。

## 功能特性

- 采用天天基金等数据源接口，实时显示基金涨跌、估算收益，以及大盘实时数据、板块行情、股票走势、加密虚拟货币行情
- 软件中所有数据仅供参考，收益或亏损以当天实际为准；走势、排行数据均来自第三方网站，不代表作者观点
- 支持 OpenAI 兼容接口用于基金一键录入等 AI 功能，不收集、不上传用户的 API Key
- 纯个人自用状态栏小插件，完全开源免费，仅供学习交流

## 数据源

> 注意 ⚠️：不同数据源可能有反爬机制，刷新时的请求速度会有差异。
> 强烈建议使用天天基金的数据源，最快且估值最准确。

- [东方财富-天天基金](https://fund.eastmoney.com/) ★★★★★（推荐）
- [支付宝-蚂蚁基金](https://www.fund123.cn/) ★★★☆☆
- [同花顺-爱基金](http://fund.10jqka.com.cn/) ★★★☆☆
- [腾讯证券](https://stockapp.finance.qq.com/mstats/) ★★★☆☆

## 下载与构建

> 注意 ⚠️：macOS 不允许打开未签名程序，若无法打开请执行下方命令，或参考 [Apple 官方说明](https://support.apple.com/zh-cn/guide/mac-help/mh40616/mac)。

```bash
# 终端执行，解除 quarantine 后即可打开
sudo xattr -d com.apple.quarantine "/Applications/Fishing Funds.app"
```

```bash
# 安全设置
进入「系统设置」-「隐私与安全性」-「仍要打开」
```

- **官方网站**：<https://thecoolboyhan.github.io/p/fishing-funds/>
- **本地构建**（需 Node ≥ 22.8）：

```bash
npm install --ignore-scripts                                  # 跳过 phantomjs 等会下载二进制的 postinstall
node node_modules/electron/install.js                          # 单独下载 Electron 运行时
npm run build                                                  # 产出 release/app/dist
npm run package-mac                                            # 打包 macOS dmg（未签名）
```

> 说明：开发热更新（`npm run dev`）依赖 bun；`build` / `package-*` 仅需 electron-vite + electron-builder，无需 bun。

## 系统代理

- 由于网络原因，部分货币接口可能无法直接访问，本应用已适配系统代理访问
- 支持 HTTP 代理、SOCKS 代理
- 将以下货币接口加入你的代理软件规则并重启应用即可：

```
api.coingecko.com
api.coincap.io
```

## AI 识别录入

支持 AI 识别截图导入基金数据，需使用具备视觉能力的大模型（推荐 gpt-4o、grok、gemini-2.5-pro、qwen2.5vl:32b 及以上）。

> 注意 ⚠️：请确保接口地址安全，应用不保证识别过程中的数据不会泄露至第三方，使用前请完全了解该功能。

- 使用 OpenAI 兼容接口，在「设置 - AI」中配置请求地址与 API Key
- 进入某宝 - 理财 - 总资产 - 我的资产 - 全部持有
- 长截图，保证暴露基金名称、持有收益、累计收益三项数据

## 导入导出

右键菜单支持导入 / 导出基金 JSON 配置，便于备份。

```typescript
// 字段说明
interface FundSetting {
  code: string; // 基金代码（必填）
  name?: string; // 基金名称
  cyfe?: number; // 持有份额
  cbj?: number; // 持仓成本价
}
```

示例：

```json
[
  { "code": "320007", "name": "诺安成长混合", "cyfe": 1000.0, "cbj": 1.6988 },
  { "code": "161725", "name": "招商中证白酒指数(LOF)", "cyfe": 1000.0, "cbj": 1.4896 }
]
```

## 配置同步

- 在设置中开启后，自动将配置文件存储至指定路径，启动时优先读取该路径配置
- 通过 iCloud、OneDrive 等方式同步该文件至云端，实现多设备配置同步
- 支持钱包、基金、指数、板块、股票、货币、H5 配置同步

## 问题反馈

- 有问题或建议请在本仓库提交 **Issue**：<https://github.com/thecoolboyhan/fishing-funds/issues>
- 如果本项目对你有帮助，欢迎点个 Star ⭐

## 致谢（上游依赖）

本项目的 UI 与数据层代码派生自 [`1zilc/fishing-funds`](https://github.com/1zilc/fishing-funds) v8.7.1，并在此基础上独立维护。同时感谢以下开源项目：

- [electron-vite](https://github.com/alex8088/electron-vite)
- [menubar](https://github.com/maxogden/menubar)
- [Ant Design](https://github.com/ant-design/ant-design/)
- [ahooks](https://github.com/alibaba/hooks)
- [echarts](https://github.com/apache/echarts)
- [Remix Icon](https://github.com/Remix-Design/RemixIcon)

## 许可证

本项目基于 GPL-3.0 开源。原项目及本派生版本均遵循 GPL-3.0：个人自用 / 自构建零义务；若对外发布，须保持 GPL-3.0 并公开你的修改源码。

- [LICENSE](https://github.com/thecoolboyhan/fishing-funds/blob/maintain-8.7.1/LICENSE)
