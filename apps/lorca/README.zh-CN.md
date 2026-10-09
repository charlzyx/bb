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
