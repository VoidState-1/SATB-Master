# Electron 桌面端与持久化

本文说明 Electron 安全边界、IPC、工程文件、自动恢复、SoundFont 资源和本机规则库。整体分层见 [architecture.md](./architecture.md)，工程 schema 见 [data-model.md](./data-model.md)。

## 1. 桌面端是主要交付目标

浏览器模式适合快速开发，但 SATB Master 的完整产品能力依赖 Electron：

- 无边框自定义窗口与原生窗口控制。
- `.satb` 打开、保存和另存为。
- 自动恢复与 schema 备份。
- 本地 SoundFont 大文件安全读取。
- 本机外置规则库。
- MIDI 系统保存对话框。
- 安装包资源路径。

因此涉及文件、焦点、弹窗、窗口菜单或资源路径的修复不能只在 `vite` 浏览器页验证。

## 2. 进程安全模型

BrowserWindow 使用：

```text
contextIsolation: true
nodeIntegration: false
sandbox: true
```

应用使用 frameless 窗口，由 React 标题栏提供最小化、最大化/还原和关闭按钮。renderer 没有 Node 权限，所有桌面能力经 [`electron/preload.cts`](../electron/preload.cts) 的 `contextBridge` 暴露为 `window.desktop`。

基本原则：

- preload 只暴露语义化方法，不暴露 `ipcRenderer`。
- 每个主进程 handler 校验参数类型、大小、扩展名和允许路径来源。
- renderer 不传入任意 channel 名。
- 本地文件路径不是 URL 授权；大资源使用一次性/短时 token。
- QuickJS 外置规则不接触 preload API。

[`electron/main.ts`](../electron/main.ts) 还限制导航和新窗口：HTTP/HTTPS 外链交给系统浏览器，不能在拥有应用 preload 的窗口中任意导航。修改 CSP、导航或协议时要重新审查权限面。

## 3. `window.desktop` 分组

preload API 按能力分组：

| 分组 | 主要操作 |
| --- | --- |
| `window` | minimize、toggle maximize、查询聚焦/最大化、close |
| `project` | open、save、autosave、读取/丢弃 recovery |
| `midi` | export |
| `soundFont` | open、load path/default、hash、release |
| `ruleLibrary` | list、import、install、load source、remove |
| `ruleProfile` | open、save（便携规则配置档案） |
| `ruleTestCases` | open、save、openDirectory、delete（规则测试用例） |

renderer 通过 [`src/services/desktop.ts`](../src/services/desktop.ts) 和规则库 service 调用这些能力。组件不应直接散布 `window.desktop?.x` 分支；集中适配能保证浏览器降级和桌面错误语义一致。

新增 IPC 的建议流程：

1. 定义最小请求和响应数据，避免传递完整工程之外的多余对象。
2. 在主进程 handler 中运行时校验所有 `unknown` 输入。
3. 在 preload 增加固定方法。
4. 在 service 封装桌面与浏览器语义。
5. 添加策略单测和桌面流程。

## 4. 工程文件

工程扩展名为 `.satb`，内容是 UTF-8 JSON `ProjectDocument`。主进程限制单文件最大 20 MiB。

打开流程：

```text
系统打开对话框
-> 读取最多 20 MiB
-> JSON parse
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

### 4.1 schema v2 备份

当从 v2 打开的工程第一次以 v3 覆盖原路径时，主进程创建：

```text
<name>.schema-v2-backup.satb
```

若名称冲突则使用带时间戳的备份名。备份应发生在原文件仍是 v2 内容时，并只针对覆盖原路径；另存为新文件不需要伪装成原文件备份。

迁移逻辑本身位于领域层，文件副本位于主进程。详见 [data-model.md](./data-model.md)。

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
sourcePath? / migration context
```

应用启动时若发现有效恢复数据，显示是否恢复提示。无论用户选择恢复还是放弃，提示关闭后都必须把焦点正确还给主窗口；否则原生 `<select>` 等下拉菜单可能在第一次窗口会话内无法点击，直到切出再切回。

语义区别：

- **保存成功：** 更新 saved revision，并删除恢复文件。
- **恢复：** 加载内容但保持 dirty，用户仍需选择保存目标。
- **放弃恢复：** 删除恢复文件，不改变磁盘工程。
- **打开其他工程：** 应明确处理当前 dirty 内容，不能由恢复机制代替保存确认。

恢复文件也受 20 MiB 限制和工程 validator 约束。损坏恢复文件应报告并允许丢弃，不能阻止应用进入空白工程。

浏览器模式把同类 envelope 保存到 localStorage。它用于预览恢复逻辑，不验证主进程原子写入。

## 6. 对话框目录记忆

最近使用目录保存在：

```text
userData/dialog-directories.json
```

工程打开/保存、MIDI 导出、SoundFont 和规则包分别记录最近目录，避免每次回到系统默认位置。目录是本机偏好，不进入工程。

实现要求：

- 只在对话框成功选择/保存后更新。
- 目录不存在或无权限时回退到系统默认。
- 不把某类文件的完整文件名当成下一类对话框目录。
- JSON 损坏时使用空偏好，不阻止对话框。

## 7. SoundFont 资源协议

[`electron/soundfont-resource.ts`](../electron/soundfont-resource.ts) 注册：

```text
satb-soundfont://resource/<token>
```

token 对应主进程已验证的本地文件，生命周期 15 分钟。renderer 通过协议流式读取，主进程可同时计算 SHA-256 和报告进度。这样避免：

- 把任意绝对路径暴露给 renderer。
- 通过 IPC 一次复制数百 MiB/数 GiB ArrayBuffer。
- 放宽 `file://` 或通用自定义协议权限。

token 解析必须验证 host/path 形式和过期时间。加载成功、失败或取消后 renderer 调用 release；主进程也定期/按访问清理过期条目。

默认 SoundFont 在开发与生产的来源不同：

- 开发时来自 `public/soundfonts`/Vite URL。
- 打包时由 electron-builder `extraResources` 复制到应用 resources 下的 `soundfonts`。

修改路径时必须同时验证 Vite 开发、`npm run pack:win` 目录和安装版。不要依赖当前工作目录。

容量与音频生命周期见 [audio-midi-and-time.md](./audio-midi-and-time.md)。

## 8. 本机外置规则库

[`electron/rule-library.ts`](../electron/rule-library.ts) 管理：

```text
userData/rule-library/
  <sha256>.satb-rule.js
  <sha256>.json
```

源码按内容 hash 命名，metadata 保存 manifest、大小、来源和安装时间。安装前由 QuickJS inspect 解析注册内容，主进程不 `eval` 用户脚本。

安全约束：

- 只接受 `.satb-rule.js` 和 512 KiB 以内源码。
- hash 必须是 64 位小写十六进制 SHA-256。
- load/remove 只接受合法 hash，不能拼接任意路径。
- metadata 与源码 manifest 必须匹配。
- 删除只移除本机副本，不修改已打开工程的引用。

具体规则 API 见 [external-rules.md](./external-rules.md)。

## 9. 规则测试用例文件

规则测试工作台通过 preload 的 `ruleTestCases` 分组读写用例文件。实现位于 [`electron/rule-test-cases.ts`](../electron/rule-test-cases.ts) 与 [`electron/rule-test-case-file.ts`](../electron/rule-test-case-file.ts)：

- 文件扩展名 `.satb-rule-case.json`，单文件上限 20 MiB，UTF-8 JSON。
- 支持打开单文件、打开目录（递归扫描）与删除；目录扫描只接受扩展名匹配的文件。
- 写入使用同目录临时文件 + rename 原子替换，扩展名与绝对路径在主进程校验。
- 对话框目录记忆复用 `rule-test-case` 类别，与工程、SoundFont、规则包分开。

用例格式与运行器见 [rule-testing.md](./rule-testing.md)。用例文件不进入工程、不参与自动恢复，也不受工程 schema 迁移影响。

## 10. MIDI 导出

renderer 在领域层构建字节，主进程只负责系统保存对话框和写入。请求包含 `Uint8Array` 和建议文件名；主进程需要校验数据类型、文件名和选定路径。

MIDI 的音乐正确性由 [`src/domain/midi.ts`](../src/domain/midi.ts) 测试，文件对话框和写盘由桌面 E2E 覆盖。不要在主进程重新解释音符和 tempo 事件。

## 11. 自定义窗口与焦点

无边框窗口需要自行实现：

- 可拖拽标题栏区域和交互控件的 `no-drag` 区。
- 最小化、最大化/还原和关闭。
- 最大化状态同步和 Windows snap 行为可接受性。
- 恢复弹窗、文件对话框和应用切换后的焦点。

原生 `<select>` 首次不可点击通常不是 select 数据问题，而可能是窗口焦点或模态生命周期未正确结束。尤其要测试：

1. 有恢复数据时启动。
2. 选择“是”和“否”两条路径。
3. 不切出应用，立即操作所有下拉菜单。

不要用对 select 发送虚假 click/focus 的组件补丁掩盖主窗口焦点问题。

## 12. 浏览器 service 降级

无 `window.desktop` 时：

- 工程和 recovery 使用 localStorage。
- MIDI 使用浏览器下载。
- 外置规则库使用 localStorage。
- 默认 SoundFont 可从 Vite URL 加载。
- 本地 SoundFont 路径不能在刷新后重新读取。

service 应返回清楚的能力错误，例如“浏览器预览无法重新读取本地 SoundFont”，而不是假造一个成功路径。UI 可以降级，但不能让开发者误以为桌面安全边界已经测试。

## 13. 数据位置与卸载

用户数据位于 Electron `app.getPath('userData')`，包含恢复、对话框目录和规则库。NSIS 配置当前 `deleteAppDataOnUninstall: false`，卸载不会自动删除这些数据。

正式排查时应使用隔离的 userData，而不是让测试覆盖真实用户恢复和规则库。桌面 E2E 使用 `SATB_MASTER_E2E_DIRECTORY` 指向独立目录。

## 14. 桌面变更检查表

- renderer 是否仍保持 `nodeIntegration: false`、`contextIsolation: true`、`sandbox: true`？
- 新能力是否经过固定 preload 方法，而非通用 IPC？
- handler 是否校验所有输入、大小、扩展名和路径来源？
- 保存是否原子，失败时是否保留旧文件？
- recovery 的恢复/放弃路径是否都正确归还窗口焦点？
- 默认资源是否在开发、pack 和安装环境都能定位？
- 大文件是否流式读取，没有通过 IPC 整体复制？
- 对话框是否记忆对应类别目录，并能从无效目录回退？
- 测试是否使用隔离 userData，避免污染真实用户数据？
