# Electron 桌面端与持久化

本文说明 Electron 安全边界、类型化 IPC 契约、工程文件、自动恢复、窗口状态记忆、SoundFont 资源、本机规则库与滚动日志落盘。整体分层见 [architecture.md](./architecture.md)，工程 schema 见 [data-model.md](./data-model.md)，日志与排错包细节见 [logging-and-observability.md](./logging-and-observability.md)。

## 1. 桌面端是主要交付目标

浏览器模式适合快速开发，但 SATB Master 的完整产品能力依赖 Electron：

- Windows 自定义无边框窗口、macOS 原生窗口按钮与应用菜单，以及多屏尺寸记忆。
- `.satb` 双击打开、原子保存、另存为与紧急备份导出。
- 自动恢复与 schema v2 原文件备份。
- 本地 SoundFont 大文件安全流式读取。
- 本机外置规则库与规则测试用例目录读写。
- MIDI 系统打开对话框，以及 MIDI 与 MusicXML 系统保存对话框。
- 主进程 JSONL 滚动日志、崩溃同步落盘与排错包导出。
- 启动命令行直达教材审计包（`--audit-package`）与安装包资源路径。

因此涉及文件、焦点、弹窗、窗口菜单、日志落盘或资源路径的修复不能只在 `vite` 浏览器页验证。

## 2. 进程安全模型

BrowserWindow 使用：

```text
contextIsolation: true
nodeIntegration: false
sandbox: true
```

Windows 使用自定义窗口按钮。macOS 隐藏系统标题文字并保留原生窗口按钮和可拖拽标题栏，将文件路径和编辑状态同步到原生窗口。系统关窗或退出由主进程转发给渲染层，等待未保存提示以及审计意见落盘。renderer 没有 Node 权限，所有桌面能力经 [`electron/preload.cts`](../electron/preload.cts) 的 `contextBridge` 暴露为 `window.desktop`。

基本原则：

- preload 只暴露语义化方法，不暴露 `ipcRenderer`。
- 每个主进程 handler 校验参数类型、大小、扩展名和允许路径来源。
- renderer 不传入任意 channel 名。
- 本地文件路径不是 URL 授权；大资源使用一次性/短时 token。
- QuickJS 外置规则不接触 preload API。

[`electron/main.ts`](../electron/main.ts) 还限制导航和新窗口：HTTP/HTTPS 外链交给系统浏览器，不能在拥有应用 preload 的窗口中任意导航。修改 CSP、导航或协议时要重新审查权限面。

## 3. 类型化 IPC 契约与埋点

### 3.1 `shared/desktop.ts` 与 `electron/typed-ipc.ts`

所有桌面 IPC 通道名与请求/响应类型统一维护在 [`shared/desktop.ts`](../shared/desktop.ts)：

- `DESKTOP_CHANNELS`：冻结的通道常量映射（invoke 与 event 通道）。
- `DesktopInvokeMap`：请求-响应双向类型映射。
- `DesktopEventMap`：主进程主动推送事件（`log:error-entry`、`window:maximized-changed`、`soundfont:hash-progress`）。
- `DesktopApi`：`window.desktop` 的完整编译期接口。

主进程统一通过 [`electron/typed-ipc.ts`](../electron/typed-ipc.ts) 的 `handleDesktop(channel, handler)` 注册所有 invoke handler，并通过 `setDesktopIpcReporter` 接入统一可观测性：

- 除 `log:append-batch`（防止递归埋点）外，所有 handler 自动计时；耗时 **`>= 500ms`** 时上报 `warn` 级别慢调用日志。
- handler 抛出异常时，根据 [`electron/main.ts`](../electron/main.ts) 中的 `ipcFailures` 映射归类到对应 `LogScope` 与 `AppErrorCode`（默认 `ipc` / `IPC_FAILED`），上报 `error` 日志后再原样抛出给调用方。

### 3.2 `window.desktop` 分组

preload API 公开只读的 `platform` 属性，并按能力分组。

| 分组 | 方法 / 属性 |
| --- | --- |
| `windowControls` | `minimize`、`toggleMaximize`、`isMaximized`、`isFocused`、`close`、`onMaximizedChange`、`setDocument`、`onCloseRequest` |
| `menu` | `onCommand`、`editText` |
| `versions` | 只读版本信息对象：`electron`、`chrome`、`node` |
| `project` | `open`、`consumePendingOpen`、`onOpenExternal`、`save`、`exportBackup`、`autosave`、`recovery`、`discardRecovery` |
| `midi` | `import()`、`export(bytes, defaultName)` |
| `musicXml` | `export(xml, defaultName)` |
| `soundFont` | `open`、`loadPath`、`loadDefault`、`hash`（带进度订阅）、`release` |
| `ruleLibrary` | `list`、`importFile`、`install`、`loadSource`、`remove` |
| `ruleProfile` | `open`、`save`（便携规则配置档案） |
| `ruleTestCases` | `open`、`save`、`openDirectory`、`delete`（规则测试用例） |
| `log` | `sessionId`、`onErrorEntry`、`appendBatch`、`getRecent`、`openDirectory`、`exportBundle` |
| `audit` | `hasStartupPackage`（只读布尔标记）、`readStartupPackage()` |

其中 `audit.readStartupPackage()` 供启动参数 `--audit-package <abs-path>` 使用（preload 通过 `additionalArguments` 中的 `--satb-open-startup-audit` 暴露 `hasStartupPackage`），主进程强制校验：**必须为绝对路径、扩展名为 `.satb-audit.json`、普通文件、体积不超过 `32 MiB`（`MAX_AUDIT_FILE_BYTES`）且为合法 UTF-8（`fatal: true`）**。

renderer 通过 [`src/services/desktop.ts`](../src/services/desktop.ts) 及专用 service 调用这些能力。组件不应直接散布 `window.desktop?.x` 分支；集中适配能保证浏览器降级和桌面错误语义一致。

新增 IPC 的建议流程：

1. 在 [`shared/desktop.ts`](../shared/desktop.ts) 定义最小请求/响应类型、`DESKTOP_CHANNELS` 和 `DesktopApi` 成员。
2. 在主进程使用 `handleDesktop` 注册，运行时校验所有 `unknown` 输入，并按需补充 `ipcFailures` 错误码映射。
3. 在 [`electron/preload.cts`](../electron/preload.cts) 增加对应固定方法。
4. 在 `src/services/` 封装桌面与浏览器降级语义。
5. 添加策略单测和桌面 E2E 流程。

## 4. 工程文件与紧急备份

工程扩展名为 `.satb`，内容是 UTF-8 JSON `ProjectDocument`。主进程限制单文件最大 20 MiB。

打开流程：

```text
互斥系统打开对话框
-> 读取最多 20 MiB
-> JSON parse 与 envelope 检查
-> renderer/domain 验证或 v2 -> v3 迁移
-> 建立新的历史和文件路径
```

保存流程：

```text
renderer 序列化当前工程
-> 主进程再次检查大小和目标
-> 同目录写临时文件
-> rename 原子替换目标
-> 成功后清理 recovery
-> renderer markSaved
```

临时文件与目标在同一目录，避免跨卷 rename 失去原子性。写入失败时保留原文件；不要先删除目标再写。

`project.exportBackup` 供根级错误边界 [`AppErrorBoundary`](../src/components/AppErrorBoundary.tsx) 在渲染崩溃时单独弹出互斥保存对话框导出 `.satb` 紧急备份，不修改原路径，也不清除自动恢复文件。

### 4.1 schema v2 备份

当从 v2 打开的工程第一次以 v3 覆盖原路径时，主进程创建：

```text
<name>.schema-v2-backup.satb
```

若名称冲突则使用带时间戳的备份名。备份应发生在原文件仍是 v2 内容时，并只针对覆盖原路径；另存为新文件不需要伪装成原文件备份。

迁移逻辑本身位于领域层，文件副本位于主进程。详见 [data-model.md](./data-model.md)。

### 4.2 双击打开 `.satb` 工程

勾选安装向导的文件关联后，Windows 将 `.satb` 注册为 `SATBMaster.Project`，通过 `"SATB Master.exe" "%1"` 传入工程路径。Windows 的「默认应用」设置可以覆盖安装时登记的默认关联。

- **冷启动。** 主进程解析 `process.argv` 并暂存工程路径。渲染进程订阅 `project:open-external` 后，通过 `project:consume-pending-open` 拉取首个请求。冷启动工程请求优先于自动恢复提示。
- **热转发。** `app.requestSingleInstanceLock()` 让后续进程退出。已有实例收到 `second-instance` 后恢复、显示并聚焦主窗口，按队列转发工程。当前工程有未保存改动时，用户确认后才会切换。桌面 E2E 可通过隔离目录单独启动实例。
- **命令行解析。** 首个非选项、扩展名为 `.satb` 的参数生效，匹配不区分大小写，可去掉成对外层引号。相对路径以调用进程的工作目录解析，热转发使用 Electron 传递的 `workingDirectory`。冷启动携带 `--audit-package` 时进入审计包流程。
- **读取与校验。** 主进程只接受指向普通文件的绝对 `.satb` 路径，限制为 1 字节至 20 MiB，按 UTF-8 严格解码并校验 JSON 与 v2/v3 四声部结构。渲染进程沿用领域层校验和 v2 到 v3 迁移。失败时显示对应的工程打开错误。

解析入口见 [startup-project.ts](../electron/startup-project.ts)，队列和读文件入口见 [main.ts](../electron/main.ts) 与 [project-ipc.ts](../electron/project-ipc.ts)。

## 5. 自动恢复

dirty 工程经过约 5 秒防抖后写入：

```text
userData/recovery.json
```

恢复文件使用 envelope：

```text
format: satb-master-recovery-v1
savedAt
project
sourcePath? / migrationBackupSourcePath?
```

应用启动时若发现有效恢复数据，显示是否恢复提示。无论用户选择恢复还是放弃，提示关闭后都必须把焦点正确还给主窗口；否则原生 `<select>` 等下拉菜单可能在第一次窗口会话内无法点击，直到切出再切回。

语义区别：

- **保存成功：** 更新 saved revision，并删除恢复文件。
- **恢复：** 加载内容但保持 dirty，用户仍需选择保存目标。
- **放弃恢复：** 删除恢复文件，不改变磁盘工程。
- **打开其他工程：** 应明确处理当前 dirty 内容，不能由恢复机制代替保存确认。

恢复文件也受 20 MiB 限制和工程 validator 约束。损坏恢复文件应报告并允许丢弃，不能阻止应用进入空白工程。

浏览器模式把同类 envelope 保存到 localStorage。它用于预览恢复逻辑，不验证主进程原子写入。

## 6. 互斥对话框与目录记忆

### 6.1 互斥对话框协调器（`electron/dialog-coordinator.ts`）

所有系统打开/保存弹窗必须通过 [`electron/dialog-coordinator.ts`](../electron/dialog-coordinator.ts) 的 `showExclusiveOpenDialog` / `showExclusiveSaveDialog` 调用。模块维护进程级互斥锁 `isFileDialogOpen`：若已有原生文件对话框处于打开状态，并发请求会立即返回 `{ canceled: true }`，避免双击快捷键或快速点击触发多个叠加系统弹窗。

### 6.2 7 类对话框目录记忆

最近使用目录保存在：

```text
userData/dialog-directories.json
```

[`electron/project-ipc.ts`](../electron/project-ipc.ts) 中的 `DialogDirectoryKind` 独立记忆 **7 类**操作目录：

```text
project | midi | musicxml | soundfont | rule | profile | rule-test-case
```

实现要求：

- 只在对话框成功选择/保存后串行原子写入（避免并发覆盖）；**E2E 模式下（`SATB_MASTER_E2E_DIRECTORY` 已设置）不落盘**。
- 目录不存在或无权限时回退到系统默认。
- 不把某类文件的完整文件名当成下一类对话框目录。
- JSON 损坏时记录 `warn` 日志并回退空偏好，不阻止对话框打开。

## 7. SoundFont 资源协议

[`electron/soundfont-resource.ts`](../electron/soundfont-resource.ts) 注册：

```text
satb-soundfont://resource/<token>
```

token 对应主进程已验证的本地文件（先由 [`electron/soundfont-policy.ts`](../electron/soundfont-policy.ts) 校验 2 GiB 文件上限与本机剩余内存余量），生命周期 15 分钟。renderer 通过协议流式读取，主进程可同时计算 SHA-256 并通过 `soundfont:hash-progress` 报告进度。这样避免：

- 把任意绝对路径暴露给 renderer。
- 通过 IPC 一次复制数百 MiB/数 GiB ArrayBuffer。
- 放宽 `file://` 或通用自定义协议权限。

token 解析必须验证 host/path 形式和过期时间。加载成功、失败或取消后 renderer 调用 `release`；主进程也定期/按访问清理过期条目。

默认 SoundFont 在开发与生产的来源不同：

- 开发时来自 `public/soundfonts`/Vite URL。
- 打包时由 electron-builder `extraResources` 复制到应用 resources 下的 `soundfonts`。

修改路径时必须同时验证 Vite 开发、`npm run pack:win` 目录和安装版。不要依赖当前工作目录。容量与音频生命周期见 [audio-midi-and-time.md](./audio-midi-and-time.md)。

## 8. 本机外置规则库

[`electron/rule-library.ts`](../electron/rule-library.ts) 管理：

```text
userData/rule-library/
  <sha256>.satb-rule.js
  <sha256>.json
```

源码按内容 hash 命名，metadata 保存 manifest、大小、来源和安装时间。安装前由 QuickJS inspect 解析注册内容，主进程不 `eval` 用户脚本。

安全约束（由 [`electron/rule-library-policy.ts`](../electron/rule-library-policy.ts) 与 [`shared/external-rules.ts`](../shared/external-rules.ts) 强制）：

- 只接受 `.satb-rule.js` 和 512 KiB 以内源码。
- hash 必须是 64 位小写十六进制 SHA-256。
- `loadSource`/`remove` 只接受合法 hash，不能拼接任意路径。
- metadata 与源码 manifest 必须匹配。
- 删除只移除本机副本，不修改已打开工程的引用。

具体规则 API 见 [external-rules.md](./external-rules.md)。

## 9. 规则测试用例文件

规则测试工作台通过 preload 的 `ruleTestCases` 分组读写用例文件。实现位于 [`electron/rule-test-cases.ts`](../electron/rule-test-cases.ts) 与 [`electron/rule-test-case-file.ts`](../electron/rule-test-case-file.ts)：

- 文件扩展名 `.satb-rule-case.json`，单文件上限 20 MiB（`MAX_RULE_TEST_CASE_BYTES`），UTF-8 JSON。
- 支持打开单文件、打开目录（递归扫描）与删除；目录扫描只接受扩展名匹配的文件。
- 写入使用同目录临时文件 + rename 原子替换，扩展名与绝对路径在主进程校验。
- 对话框目录记忆复用 `rule-test-case` 类别，与工程、SoundFont、规则包分开。

用例格式与运行器见 [rule-testing.md](./rule-testing.md)。用例文件不进入工程、不参与自动恢复，也不受工程 schema 迁移影响。

## 10. MIDI 导入与 MIDI / MusicXML 导出

- **MIDI 导入（`midi:import`）** 由主进程用互斥打开对话框选择 `.mid` 或 `.midi` 文件。通道无请求参数，仅返回取消状态，或所选文件的文件名、路径和 `Uint8Array`。主进程拒绝空文件并限制实际读取量，允许的文件大小上限为 10 MB（`MAX_MIDI_IMPORT_BYTES`）。renderer 使用返回的字节解析。导入与导出共用 `midi` 最近目录。E2E 模式读取固定的 `<e2e>/import.mid`。
- **MIDI 导出（`midi:export`）：** renderer 在 [`src/domain/midi.ts`](../src/domain/midi.ts) 构建字节流，主进程只负责互斥保存对话框、`midi` 目录记忆与写盘（E2E 模式下写入 `<e2e>/export.mid`）。
- **MusicXML 导出（`musicxml:export`）：** renderer 在 [`src/domain/musicxml/`](../src/domain/musicxml) 生成 UTF-8 XML 字符串，主进程负责互斥保存对话框、`musicxml` 目录记忆与写盘（E2E 模式下写入 `<e2e>/export.musicxml`）。

主进程不重新解释音符、和弦或拍号事件。

## 11. 主进程滚动日志（`electron/logger.ts`）

应用运行日志按会话写入：

```text
userData/logs/session-YYYYMMDD-HHMMSS-<pid>[-N].jsonl
```

由 [`electron/logger.ts`](../electron/logger.ts) 的 `MainLogger` 维护 5 MiB 单文件轮转、15 个历史文件上限、20 MiB 目录总上限与 1000 条内存环形缓冲。主进程未捕获异常和进程异常退出时采用 `appendSync` 同步落盘。完整机制、排错包（20 MiB 上限）与 E2E 日志门禁见 [logging-and-observability.md](./logging-and-observability.md)。

## 12. 自定义窗口、状态记忆、焦点与开发扩展

### 12.1 窗口尺寸与位置记忆（`electron/window-state.ts`）

[`electron/window-state.ts`](../electron/window-state.ts) 将窗口尺寸、位置与最大化状态持久化至 `userData/window-state.json`：

- 默认尺寸 `1180×760`，最小尺寸 `760×520`。
- `resize`/`move`/`maximize`/`unmaximize` 经 300ms 防抖落盘，窗口 `close` 时立即落盘。
- 启动读取时调用 `sanitizeWindowState` 对照当前所有显示器工作区（`screen.getAllDisplays()`），确保窗口至少有 `100×40` 像素落在可见屏内，防止拔掉外接显示器后窗口悬空不可见。

### 12.2 无边框窗口焦点修复机制

Windows 无边框窗口（`frame: false`）在 `show()` 的同一调用栈内立即调用 `webContents.focus()` 会导致 Chromium 原生 `<select>` 吞掉首次点击。[`electron/main.ts`](../electron/main.ts) 在 `ready-to-show` 中采用两阶段交接：

1. 注册 `window.once('focus', () => setImmediate(() => { if (!window.isDestroyed() && window.isFocused()) window.webContents.focus() }))`。
2. 再调用 `window.show()`，等待 Windows 完成原生窗口激活后再把输入焦点交给网页。

尤其要测试有恢复数据启动时，选择“恢复”和“放弃”两条路径后不切出应用立即操作所有下拉菜单。不要用对 `<select>` 发送虚假 click/focus 的组件补丁掩盖主窗口焦点问题。

### 12.3 开发模式 React DevTools 自动装载（`electron/dev-extensions.ts`）

仅在携带 `--dev` 或 `--devtools` 启动参数时，[`electron/dev-extensions.ts`](../electron/dev-extensions.ts) 会扫描本机 Chrome / Edge / Brave 浏览器用户目录中的 React DevTools 扩展（ID `fmkadmapgofadopljbjfkapdkoienihi`），按最高版本号经 `session.defaultSession.loadExtension` 载入；未安装或加载失败时仅记录 `info`/`warn` 日志，不影响应用启动。生产环境不会执行该逻辑。

## 13. 浏览器 service 降级

无 `window.desktop` 时：

- **工程与恢复：** 使用 `localStorage`（`satb-master-browser-project` / `satb-master-browser-project-recovery`）。
- **MIDI 导入** 使用浏览器文件选择器与 `File.arrayBuffer()`，同样拒绝空文件并限制 10 MB。
- **MIDI、MusicXML、规则档案、紧急 `.satb` 备份与排错包导出** 使用浏览器 `Blob` + 临时对象 URL 触发下载（排错包仍检查 20 MiB 上限）。
- **教材审计会话：** 使用浏览器 `IndexedDB`（`satb-master-audit` 数据库）按内容指纹独立持久化（无命令行 `--audit-package` 启动直达）。
- **外置规则库与规则测试用例：** 使用 `localStorage` / 浏览器文件选择。
- **运行时日志：** 保留渲染进程 1000 条内存缓冲与 100 条面包屑，可查看和下载排错包，但无磁盘 JSONL 落盘、无主进程日志拉取、无「打开日志目录」按钮。
- **SoundFont：** 默认 SoundFont 可从 Vite URL 加载；本地 SoundFont 路径不能在刷新后重新读取。

service 应返回清楚的能力错误（例如“浏览器预览无法重新读取本地 SoundFont”），而不是假造成功路径。UI 可以降级，但不能让开发者误以为桌面安全边界已经测试。

## 14. 数据位置与卸载

用户数据位于 Electron `app.getPath('userData')`，包含：

- `recovery.json`（自动恢复）
- `dialog-directories.json`（7 类对话框目录记忆）
- `window-state.json`（窗口尺寸与位置记忆）
- `logs/`（会话 JSONL 滚动日志）
- `rule-library/`（本机外置规则包）

NSIS 卸载默认保留这些数据。主动选择彻底清除，或静默卸载显式传入 `--delete-app-data` 时，卸载程序只处理当前用户的应用数据目录（`%APPDATA%\SATB Master`、`%APPDATA%\satb-master`）。内部升级卸载始终保留数据。保存在其他文件夹中的 `.satb` 工程可继续使用。自动化桌面测试通过 `SATB_MASTER_E2E_DIRECTORY` 使用隔离的 `userData`。

## 15. 桌面变更检查表

- renderer 是否仍保持 `nodeIntegration: false`、`contextIsolation: true`、`sandbox: true`？
- 新能力是否先在 `shared/desktop.ts` 声明，经 `handleDesktop` 与固定 preload 方法暴露？
- handler 是否校验所有输入、大小、扩展名和路径来源，并配置 `ipcFailures` 错误码映射？
- 原生文件对话框是否全部经 `electron/dialog-coordinator.ts` 互斥弹出？
- 保存是否原子，失败时是否保留旧文件？
- recovery 的恢复/放弃路径及无边框窗口启动是否都正确归还窗口焦点？
- 默认资源是否在开发、pack 和安装环境都能定位？
- 大文件是否流式读取，没有通过 IPC 整体复制？
- 对话框是否记忆对应类别目录（E2E 不落盘），并能从无效目录回退？
- 测试是否使用隔离 userData，并通过 E2E 会话零错误日志门禁？
