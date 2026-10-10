# 本地粘贴与拖放附件暂存

生产 `main.cjs` 与隔离 `preload.cjs` 已接入暂存 owner。模块、preload 和 IPC 的合成测试覆盖安全边界；真实 Electron File 来源与系统行为须通过下述独立 smoke 验证，不能仅用 VM 测试声称已验证。

## 原生接口

`new AttachmentImports(selections, { temporaryDirectory })` 复用已有 `AttachmentSelections`。临时目录只能由主进程选择，不能来自网页参数。

- `stage(input, guard)` 返回 `{ attachments, duplicates }`，不调用后端。主进程与隔离 preload 间每项包含 `id`、`name`、`size`、`mime`、`previewMime`、`sourceIndex`，有效位图还带最多 4 MiB 的私有 `previewBytes`。预览字节来自已验证暂存副本，不会二次读取可能变化的原始 File。普通 renderer 只收到名称、大小、类型、不透明 ID 和可选的本地 `previewUrl`。
- `release(ids)` 撤销选择；`clear()` 撤销本次草稿和所有共享选择，并清理自有暂存文件。发送中的文件保持到请求结算。
- `send(bridge, params, guard, completionGuard)` 通过现有 `chats.send` 校验和附件 grant 发送。发送前校验失败保留未撤销的选择；请求一旦发出，成功或结果未知都消费选择，绝不自动重发。草稿导航不能覆盖已经返回的成功 ACK；账号、连接和源文档变化仍检查完成 fence。
- `getCleanupWarning()` 单独报告脱敏清理警告。清理失败保留文件所有权和预算，以便下一次 `clear()` 重试；不能用清理错误覆盖已确认发送成功或原有未知结果。

`input.source` 为 `paste`、`drop` 或主进程选择器内部使用的 `picker`，`files` 中每项为以下私有形状之一：

- 磁盘 File：`{ kind: 'path', path, name, size, mime, lastModified }`
- 内存 File：`{ kind: 'bytes', bytes: Uint8Array, name, size, mime }`

这些是隔离 preload 到主进程的内部参数，绝不能作为普通 renderer 的公开路径读取 API。模块本身无法证明路径来自 File；该权限证明必须由接线层完成。

## 接线与 renderer 契约

1. 隔离 preload 仅捕获 composer 内 `isTrusted` 的 `paste`/`drop`，同步保存此次 File 和草稿代次，并使用 Electron 官方 `webUtils.getPathForFile` 私下映射磁盘路径。不可暴露通用 `File → path` 或 `stage(path)` 函数。
2. 主进程验证精确 WebContents、主 frame 和文档 URL。`AttachmentSession` 保存票据签发时的账号与连接 fence，并统一管理 picker、导入、释放、发送和退出清理。票据只返回隔离 preload 闭包；公开 `setAttachmentScope` 的结果为 `void`。真正换文档、reload、账号和连接变化会撤销票据；同文档 hash/history 导航保留附件。
3. 不读取或轮询系统剪贴板。没有 File 的普通文字粘贴保持浏览器默认行为；含 File 的粘贴在捕获 File 和草稿代次后，通过同步 `onAttachmentText` 插入一次纯文本，再异步暂存文件。加入附件不自动提交聊天。Finder 复制文件若只提供 URI-list 而没有 File，本版不会把 URI 路径转换成权限，不能宣称该分支已支持。
4. preload 使用主进程验证过的暂存位图字节生成 blob URL，并负责在撤销、切换草稿和销毁页面时释放。`mime` 是文件声明的类型，不能作为渲染信任依据；只有非空 `previewMime` 可启用位图预览。其他内容显示普通文件卡，不能加载 HTML/SVG。
5. 预览沿用现有位图头验证器：PNG/JPEG/WebP，最多 4 MiB、2048×2048。更大图片仍可作为附件暂存，但本批不给缩略图许可。
6. 暂存晚回时若草稿代次不同，释放 grant 并撤销 blob URL。正常切换聊天、账号、连接和退出调用原生清理；已接受发送期间的草稿 scope 保持至发送结算，避免导航在创建聊天或发送过程中提前销毁文件。退出的重复请求全部等待 owner 清理结算后才允许进程退出。

公开新增接口：

- `setAttachmentScope(scope: string | null): Promise<void>`，不返回票据。controller 使用不含账号标识与连接地址的 `gN:aN:nN` 草稿范围。
- `onAttachmentImport(listener)`，事件为 `{ scope, attachments, duplicates, error? }`，返回取消订阅函数。
- `onAttachmentText(listener)`，只同步发送本次含 File 的粘贴中的纯文本，返回取消订阅函数。

composer 使用 `data-attachment-composer` 标记，可接收范围关闭时设置 `data-attachment-disabled="true"`。全窗口文件 drop 阻止默认导航，只有该 composer 内真实事件能暂存。选择器仍使用 `pickAttachments()`；文件路径和字节提交接口不向普通 renderer 暴露。

## 文件与结果边界

每批最多十个文件，每文件最多 100 MiB。picker 和导入经过同一暂存流程，共享十个可选附件上限；发送中暂存、清理失败保留内容均计入 250 MiB 预算。新批次先检查预算，再复制内存字节；同一 owner 的 picker、暂存和发送互斥，旧选择器不再绕过配额。

新导入文件复制到随机私有目录，目录权限为 0700、独占创建文件为 0600。源文件只接受普通文件，拒绝最后一级符号链接；使用文件句柄限量读取，并在前后核对 inode、设备、大小和修改时间。主进程只返回脱敏错误，不返回原始路径。Windows 的 ACL 语义仍以系统临时目录权限为基础，不能把 POSIX mode 声称为 Windows ACL 隔离。

同一暂存作用域的 picker、粘贴和拖放按内容哈希统一去重，不共用可被另一 grant 撤销的文件。

后端成功响应代表其附件存储步骤已返回，可清理自有副本。超时或断线不证明后端停止；客户端消费该 grant 并在本地请求结算后清理副本，后端若晚读可能失败。因此结果未知时必须先核对对话，不能自动重放。此模块不提供崩溃后跨进程的临时目录回收；清理失败时保留本进程所有权和预算供再次清理。

## 独立真实 Electron drop smoke

先运行 `node apps/lorca/scripts/focused.mjs build`，再运行 `node apps/lorca/tests/electron-attachment-smoke.mjs`。可使用已有的 `ELECTRON_PATH` 和 `PLAYWRIGHT_MODULE` 指向正常安装的依赖，不提供关闭 sandbox 的选项。

脚本使用临时 HOME、随机 mock serve-token、loopback WebSocket 假服务和合成 PNG/文件。测试启动 wrapper 在加载生产 main 前把 Electron 的 userData、sessionData、logs 和 crashDumps 显式设置到此次临时目录，随后断言，避免仅依赖 HOME 对系统目录的影响。CDP `Input.dispatchDragEvent` 提供真实磁盘 File，并断言 DOM 事件 `isTrusted`；覆盖位图预览、SVG 普通文件卡、去重、移除、大小限制、窗外导航拦截、切换草稿清理和明确发送。不会启动 Lorca、调用模型、绑定账号或访问用户文件。

该脚本不读写系统剪贴板，输出明确 `clipboardTouched: false`、`pasteTested: false`。真实 paste 验证若需改写 Mac 全局剪贴板，应另行说明影响并取得许可，不能把 drop 成功当作 paste 或 Finder 文件复制已验证。

官方依据：[Electron webUtils](https://www.electronjs.org/docs/latest/api/web-utils)、[Electron sandbox](https://www.electronjs.org/docs/latest/tutorial/sandbox)、[Electron security](https://www.electronjs.org/docs/latest/tutorial/security)。
