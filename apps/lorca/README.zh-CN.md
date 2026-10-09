# dots 简体中文桌面客户端

实验性源代码版本，复用 BB 的界面与控件，由 Lorca 负责身份、加密、同步、模型、权限和运行端。当前界面默认使用简体中文；对话内容、工具输出、机器人/供应商名称、协议字段和命令保持原文。

## 启动

需要 Node 22.19 或更新版本。请使用独立的新目录：

```sh
git clone --branch feat/lorca-desktop https://github.com/charlzyx/bb.git
cd bb
node apps/lorca/scripts/focused.mjs install
node apps/lorca/scripts/focused.mjs check
node apps/lorca/scripts/focused.mjs desktop
```

首次启动桌面应用时，脚本可能下载官方 Electron 运行时。请另行启动你要连接的 Lorca CLI。

默认连接 `ws://127.0.0.1:4862/ws`。新版 Lorca 的现有 `serve-token` 只在主进程读取，不进入界面。应用不会创建、恢复或复制身份，不会自动更改中继配置或启动运行端。

如已有隔离的开发服务，请使用与该服务对应的数据目录和端口：

```sh
LORCA_HOME="$HOME/.lorca-dev" LORCA_PORT=4863 node apps/lorca/scripts/focused.mjs desktop
```

仅旧版无认证 Lorca 服务需要手动开启兼容模式：

```sh
LORCA_ALLOW_LEGACY=1 node apps/lorca/scripts/focused.mjs desktop
```

兼容模式只允许回环地址，并明确显示警告。认证失败时不会自动降级。

## 目前可用

- 聊天、附件选择、发送/停止、排队消息、审批、历史分页和重连保护
- 完整桌面设置页：连接、偏好设置、运行端和 MCP
- 当前应用会话内更改连接地址和明暗外观
- 只读查看运行端、供应商配置、机器人分配和脱敏 MCP 状态
- 中文按钮、菜单、说明、错误、日期与无障碍标签

运行端和供应商状态是 Lorca 上报的信息，不代表客户端进行了实时连通性或凭据测试。未上报的工具数量显示为未知。

## 边界

密钥录入、OAuth 登录、访问授权、自动审批规则、运行端分配及 MCP 配置编辑仍需在 Lorca 完成。后续接入凭据配置需要独立的原生安全界面和凭据存储，不能放入网页表单。外观和连接地址目前不承诺跨应用重启持久保存。

云端验证使用确定性数据和本机模拟服务，不访问真实账号、中继或模型。macOS 源码运行实测另行进行；尚未提供签名、安装包或正式发布版本。详见[验证记录](../../docs/lorca-verification.md)与[设置能力对照](../../docs/lorca-settings.md)。

## macOS 独立本地开发包

源码启动仍使用依赖里的 `Electron.app`。`app.setName` 不能改变该宿主的系统菜单名称；macOS About 图标也来自 bundle，而不是仅支持 Linux/Windows 的 `iconPath`。源码模式已显式显示 dots 产品版本 `0.1.0`，但不能据此宣称系统原生品牌全部替换。

已安装依赖和 Electron 的 Mac，可在仓库根目录执行：

```sh
node apps/lorca/scripts/focused.mjs check
node apps/lorca/scripts/package-macos.cjs
```

脚本输出一个全新的 `apps/lorca/dots-macos-dev-随机字符/dots.app` 路径，拒绝覆盖已有目标。它只复制本项目依赖中的 Electron.app，加入构建页面、原生桥、图标、MIT 许可和 ws 运行依赖；不会复制 `.env`、身份、令牌或开发工作区。新副本有独立 bundle 标识、dots 系统名称、四点 ICNS 和 `0.1.0` 产品版本。辅助进程暂保留 Electron Helper 名称。

脚本仅对新副本运行系统 `plutil` 和 `codesign --sign -`，这是无需证书的本地 ad-hoc 校验签名，不是 Developer ID 签名或 Apple 公证，不能当作正式安装包分发。不修改全局 Electron、Lorca.app、Gatekeeper、钥匙串或权限；失败会保留生成目录供检查，不尝试关闭安全限制。

完全退出先前的源码 dots 窗口，再使用脚本打印的实际路径启动；旧协议示例：

```sh
LORCA_ALLOW_LEGACY=1 "实际输出路径/dots.app/Contents/MacOS/dots"
```

新版协议不要设置 legacy 开关。认证仍由原生桥从原先的 Lorca 数据目录读取，打包不会迁移或修改该目录。新 bundle 的客户端偏好目录可能与源码宿主不同，主题等当前会话设置需要重新选择。

云端仅验证了副本组装、图标格式、隔离输入与命令边界；真正的 macOS bundle 签名、启动、顶部菜单和 About 图标仍须在 Mac 复验。不要在遇到系统安全警告时绕过。

参考：[Electron About 选项](https://www.electronjs.org/docs/latest/api/app#appsetaboutpaneloptionsoptions)、[手动打包](https://www.electronjs.org/docs/latest/tutorial/application-distribution#manual-packaging)。
