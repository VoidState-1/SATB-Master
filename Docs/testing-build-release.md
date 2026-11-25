# 测试、构建与发布

本文说明 SATB Master 的验证层级、构建脚本、桌面 E2E（含日志门禁）、CLI 工具脚本、Windows 打包和发布检查。架构边界见 [architecture.md](./architecture.md)，桌面持久化见 [desktop-and-persistence.md](./desktop-and-persistence.md)，日志与排错体系见 [logging-and-observability.md](./logging-and-observability.md)。命令以 [`package.json`](../package.json) 为准。

## 1. 验证原则

测试范围按改动风险决定，但正式发布需要完整矩阵。项目跨越纯领域逻辑、React、VexFlow、AudioWorklet、Web MIDI、Web Worker、QuickJS、Electron 主进程和 Windows 安装包，单一测试类型无法覆盖全部风险。

验证结果应明确分为：

- **已验证：** 本次实际执行并通过的命令或手工流程。
- **未验证：** 因环境、权限、时间或硬件未执行的项目。
- **环境失败：** 应用/测试基础设施没有启动成功，尚未运行断言。
- **断言失败：** 流程已运行，实际行为与预期不符。

不能把“历史上曾通过”写成本次通过，也不能把 Electron GPU 子进程崩溃等环境启动失败描述成产品断言失败。

## 2. 日常验证命令

```powershell
npm test
npm run typecheck
npm run build
```

### 2.1 `npm test`

实际执行：

```text
vitest run --exclude "StandardCase/Pilot/**"
```

排除试点目录 `StandardCase/Pilot/**`，运行其余全量 Vitest 测试。测试文件与源码相邻，覆盖重点包括：

- **工程模型与编辑：** 工程 schema v3、validator/normalizer、v2 -> v3 迁移、编辑命令、锁定区、批量原子性与辅助轨重叠例外。
- **音乐基础与记谱导出：** 书写音高、音程、和弦解析（含 `doubleAugmented43`）、变速/变拍号时间换算、MIDI Type 1 结构、MusicXML 导出序列化与 VexFlow 记谱转换模型。
- **和声规则与引擎：** 目录修订 3 的 70 条内置规则、共享事实（`facts/`）、同和弦跨度、规则私有状态、revision 竞争和诊断仲裁。
- **分析推导与辅助写作：** 节拍层级、乐句边界、终止式候选、自动和弦推导、自动配和声（高音题/低音题）与半自动和声连接搜索。
- **规则测试与外置沙箱：** `.satb-rule-case.json` 格式、隔离运行器与比较器、外置规则 API v3 manifest 协议、QuickJS 超时/内存/非法引用。
- **音频与外设：** SoundFont 容量策略、身份标识、排他加载生命周期与 Web MIDI 输出管理。
- **日志、可观测性与错误恢复：** `shared/logging.ts` 脱敏/截断/序列化、`MainLogger` 轮转与裁剪、`RendererLogger` 缓冲/flush/span/排错包、`AppErrorBoundary`、`AppNoticeStack`、`LogsPanel` 与控制器错误日志埋点。
- **静态架构边界（6 项门禁）：** [`electron/architecture-boundaries.test.ts`](../electron/architecture-boundaries.test.ts)（`src/domain` 零运行时/日志依赖、生产代码禁止裸 `console.warn`/`console.error`、旧入口黑名单、公共入口约束、`src/components` 隔离、跨 feature 白名单）。
- **文本谱、审计与 Electron 策略：** `scoreText` 解析编译渲染、`audit` 审计包解析校验、快捷键、面板布局、窗口状态多屏校验、DevTools 扩展探测与桌面路径策略。

不要在文档或发布说明中写死测试总数；新增/拆分测试会使数字很快过期。

教材测试用例见 `StandardCase/`。Git 仅接收放入 `StandardCase/Verified/` 的已核准、已验证最终教材用例；原 PDF、候选谱例、分析报告和运行产物留在本地忽略目录。最终测试不应依赖本地 PDF 或中间产物，也不将程序通过率当作识谱正确率。

### 2.2 `npm run typecheck`

依次检查：

```text
tsc --noEmit
tsc -p tsconfig.electron.json --noEmit
```

renderer 与 Electron 使用不同 TS 配置。只检查其中一套可能漏掉 `shared/` 跨进程契约、preload、Node 类型或 DOM/Worker 边界错误。

### 2.3 `npm run build` 与 `npm run build:electron`

构建顺序：

```text
npm run build:
  npm run typecheck
  -> vite build                              # renderer 与 Worker 生产包
  -> npm run build:electron:
       node scripts/clean-electron-output.mjs
       -> tsc -p tsconfig.electron.json      # 主进程与 shared 编译
       -> vite build --config vite.preload.config.ts  # preload.cjs 独立打包
```

`preload` 需经 `vite.preload.config.ts` 将 `electron/preload.cts` 与其引用的 `shared/desktop.ts` 打包为单个 CommonJS 文件 `dist-electron/electron/preload.cjs`，以适配 `sandbox: true` 环境。开发模式（`npm run dev` / `npm run dev:tools`）也会先自动执行 `npm run build:electron`。

构建通过只证明资源可编译，不证明 Electron 能启动、默认音色能加载或原生对话框可用。

## 3. 按改动选择验证

| 改动 | 最低验证 | 额外验证 |
| --- | --- | --- |
| 纯 Markdown 文档 | 相对链接检查、`git diff --check` | 无需代码构建 |
| 领域纯函数 | 相关 Vitest、typecheck | 全量 `npm test` |
| 工程 schema/迁移 | 模型、迁移、保存恢复测试 | 桌面打开 v2/保存 v3 |
| 编辑交互/快捷键 | 领域与 hook 测试、typecheck | Electron 手工或 `e2e:desktop:local` |
| Canvas 性能/布局/五线谱 | build、相关测试 | 长工程高缩放实测、截图 |
| 和声规则 | 正反例、特例、状态/revision 测试 | 设置严重程度、UI 归属与 `RuleCases/` |
| 自动配和声/半自动连接 | `harmonization` 与面板测试、typecheck | `e2e:desktop:local`（含 Worker 搜索与幽灵预览） |
| 外置规则 API/沙箱 | QuickJS 限制与运行时测试 | 导入/缺包/移除 E2E |
| 音频/SoundFont/Web MIDI | 生命周期、策略与 midiOutput 测试、build | Electron 实际听音、外设与大文件 |
| 日志/错误处理/IPC | `logging`、`architecture-boundaries` 测试、build | `e2e:desktop:local` 与 `e2e:audit` 日志门禁 |
| 教材审计工作区 | `domain/audit` 与审计组件测试、build | `npm run e2e:audit` |
| Electron IPC/路径/窗口 | 策略测试、typecheck、build | `e2e:desktop:local` + `pack:win` 产物 |
| 发布版本 | 完整测试矩阵（含两套 E2E） | 安装后手工冒烟 |

“用户要求小修改不用测试”可以省略与风险不匹配的打包，但不应省略明显相关的快速静态检查，除非用户明确要求完全不运行。

## 4. 桌面 E2E 与会话零错误日志门禁

仓库通过 Electron remote debugging/CDP 驱动桌面 E2E，不依赖 Playwright。两套桌面 E2E 都在结束时接入统一的会话日志门禁。

### 4.1 通用会话日志门禁（`scripts/e2e-session-logs.mjs`）

[`scripts/e2e-session-logs.mjs`](../scripts/e2e-session-logs.mjs) 导出两个守卫函数，被 `e2e-desktop.mjs` 与 `e2e-audit.mjs` 共同调用：

- `waitForElectronExit(child, { requireSuccess = true })`：等待应用正常关闭退出（12 秒超时），要求退出码为 `0`。
- `assertCleanSessionLogs(userDataDirectory, { expectedErrorCodes = [] })`：检查隔离目录 `<userData>/logs/` 下确实生成了非空 `.jsonl` 日志文件、每行均为合法 UTF-8 JSON 且字段完整，并断言**不存在任何 `fatal` 或未列入 `expectedErrorCodes` 白名单的 `error` 日志**。

任何隐藏的 IPC 报错、渲染未捕获异常、主进程异常或落盘失败都会被门禁拦下。

### 4.2 主应用桌面 E2E（`scripts/e2e-desktop.mjs`）

运行本机仓库内 Electron：

```powershell
npm run e2e:desktop:local
```

该命令先执行 `npm run build`，再以 `node scripts/e2e-desktop.mjs node_modules/electron/dist/electron.exe .` 启动。直接运行 `npm run e2e:desktop`（无额外参数）时，脚本默认指向打包产物 `release-installer/win-unpacked/SATB Master.exe`（也可手动传入任意打包可执行路径）。

隔离目录位于 `node_modules/.satb-master-e2e/run-*`（通过 `SATB_MASTER_E2E_DIRECTORY` 注入 Electron），运行结束时自动清理，隔离内容包括：

- Electron `userData`（含 `recovery.json`、`logs/`、`rule-library/`、`window-state.json`）。
- 临时工程（`project.satb`）与 v2 迁移备份文件。
- MIDI / MusicXML 导出目标与 SoundFont/规则测试材料。

覆盖的代表流程包括：

- 启动时存在 v2 恢复数据的“恢复 / 放弃”（可通过 `SATB_MASTER_E2E_RECOVERY_CHOICE=discard` 切换路径）与无边框窗口原生 `<select>` 焦点验证。
- 首次以 v3 覆盖 v2 原工程时的 `.schema-v2-backup.satb` 备份验证。
- 启动默认 SoundFont 预加载、用户 SoundFont 按路径与哈希加载、播放、真正暂停静音校验（输出音量计归零与未来调度静音）和编辑预听。
- 音符/和弦调色板编辑、吸附模式、实时擦除预览、选区快捷键、中键平移、MIDI 0-127 音域、视口受界 Canvas、面板拖拽调整与重置。
- 快捷键重映射与冲突检测、和声规则严重程度/禁用/音域校验持久化、规则测试工作台往返尺寸保持、赞助对话框焦点与关闭。
- **半自动和声连接助手**（Worker 异步搜索、幽灵预览、试听、采纳写入及撤销/重做）。
- 外置规则私有库导入、QuickJS 沙箱限制、执行、挂载与移除。
- 导出对话框（MIDI Type 1 往返结构验证）与自动恢复写入/保存后清理。
- 正常关闭退出后的 `assertCleanSessionLogs` 零未预期错误门禁。

### 4.3 教材审计工作区桌面 E2E（`scripts/e2e-audit.mjs`）

运行：

```powershell
npm run e2e:audit
```

隔离目录位于 `node_modules/.satb-audit-e2e/run-*`（保留用于事后复核截图与产物）。支持两种模式：

1. **默认合成样本模式：** 自动编译手工 `.satbt` 样例与合成原图打包为 `.satb-audit.json`，验证工程附件、原谱/转写谱/钢琴卷帘三视图双向拍点联动、稀疏原图标定、单选/多选/文本题与自填答案、显式采用建议、独立编辑与撤销、审批隔离、自动保存、工程/意见导出、宽窄窗口布局、重载恢复、旧意见版本失效及 `assertCleanSessionLogs` 日志门禁。
2. **启动包直达回归模式：**

```powershell
node scripts/e2e-audit.mjs --startup-package <package.satb-audit.json> [--exe <packaged executable>]
```

使用 `--audit-package` 启动应用（默认用本地 Electron，也可通过 `--exe` 指定已打包可执行文件），验证命令行直达审计包、三视图拍点、独立 userData 草稿自动保存、关窗重开恢复及 `assertCleanSessionLogs` 日志门禁。详见 [audit-workspace.md](./audit-workspace.md)。

### 4.4 环境失败诊断

Windows/Electron E2E 可能在断言前因 GPU、驱动、安全软件、端口或进程残留失败。报告时保留：

- Electron 是否创建主窗口。
- remote debugging 端口是否可连接。
- stderr 中是否为 GPU 子进程或 sandbox 错误。
- 是否进入过任何应用断言。

确认是环境启动失败后，可在同一机器尝试与发布配置一致的 GPU 参数或清理隔离目录，但不要修改产品代码来“通过”一个未确认的环境问题。

## 5. CLI 与评测工具脚本

除构建与 E2E 外，`scripts/` 提供以下命令行工具：

| 命令 / 脚本 | 用途 |
| --- | --- |
| `npm run score -- <compile\|render\|validate> ...`（[`scripts/score.mjs`](../scripts/score.mjs)） | 编译分块文本谱 `.satbt` 为 `.satb`（可分离参考答案 JSON 与映射表）、将 `.satb`/`.satbt` 渲染为可读文本谱或校验语法；详见 [score-text.md](./score-text.md) |
| `npm run benchmark -- --manifest <file> --out <dir> [--engine-root <dir>]`（[`scripts/benchmark.mjs`](../scripts/benchmark.mjs)） | 在指定清单上运行盲推/条件和弦、终止式与可选规则断言基准，输出不可变元数据、逐题产物与 `summary.json`（含 `src/domain` 指纹） |
| `npm run audit -- <pack\|validate\|feedback> ...`（[`scripts/audit.mjs`](../scripts/audit.mjs)） | 打包 `satb-audit-manifest` v2 为 `.satb-audit.json`、校验审计包或汇总人工意见文件；不触发推导或规则检查，详见 [audit-workspace.md](./audit-workspace.md) |
| `node scripts/validate-written-case.mjs ...`（[`scripts/validate-written-case.mjs`](../scripts/validate-written-case.mjs)） | 校验书面和声教材样例元数据、覆盖率、参考标注与条件规则检查统计 |

## 6. 手工场景

自动化之外，以下行为值得按风险手工验证。

### 6.1 编辑、记谱与性能

- 创建较长工程（至少几十小节），提高横向缩放使视野很窄。
- 中键持续拖动画布、Ctrl+滚轮缩放、拖动音符和选择框。
- 检查标尺、和弦轨、播放头没有错位或断层。
- 检查完整 MIDI 0-127 音域可滚动，键盘移动不会进入不可见区域。
- 切换底部「五线谱」标签与独立大窗口预览，核对高/低音大谱表、临时记号、和弦标记、高亮模式与缩放；导出 MusicXML 并在常见打谱软件中打开核验。

### 6.2 音频与实时 MIDI 输出

- 冷启动后不先播放，直接绘制音符，应有预听。
- 播放后暂停，确认声音与动画都停止；暂停后继续绘制/移动单音符，应仍有预听。
- 加载本地 SoundFont 后播放，确认不回退默认音色；连续选择两个音色，确认较晚选择生效。
- 打开引用本地音源的工程但不播放，确认音源已开始加载；切换到引用同一音源的工程，确认不会重复加载。
- 连接虚拟/硬件 MIDI 输出端口，在「MIDI 输出」对话框验证设备枚举、分声部/单通道模式、播放与预听输出以及静音内置合成器开关。

### 6.3 持久化和焦点

- 保存包含循环的工程，重开后检查端点。
- 制造 recovery，分别选择恢复和放弃；不切出应用，立即操作所有下拉菜单。
- 打开工程、SoundFont、规则包、规则档案、规则用例，以及导出 MIDI 和 MusicXML，检查 7 类对话框各自记住最近目录。
- 调整窗口大小/位置（含最大化）后关闭重开，确认窗口状态正确恢复且不超出屏幕可见区。
- 用 v2 fixture 打开并覆盖，确认备份只创建一次且内容仍为 v2。

### 6.4 和声、自动配和声与半自动连接

- 连续同和弦转换后再解决导音/七音，不应在中间误报；休止中断后远处音符不应被当成解决。
- 和弦完整性错误只附着和弦，悬停显示聚合诊断；调整规则严重程度为 `off`，确认规则不再调度。
- 移除已引用外置包，工程显示未挂载但内置规则继续。
- 在规则测试工作台打开用例目录、编辑并运行单条规则，确认通过/失败/错误状态与用例文件保存正确。
- 分别用高音题与低音题运行「自动和声」对话框，对比三种风格预设、多方案诊断统计、试听与一键写入撤销。
- 在底部「和声连接」工作台验证单和弦排列变体与 2–4 步短连接搜索、钢琴卷帘半透明幽灵音符预览、衔接试听及采纳后光标自动推进。

### 6.5 日志与崩溃恢复

- 普通模式下底部默认不显示「日志」标签；触发可预期错误（如打开损坏 `.satb` 文件）后，通知栈显示带「查看日志」按钮的错误提示，点击后自动展开并聚焦到对应日志条目，「日志」标签出现未读角标。
- 开启开发者模式后，「日志」标签常驻，问题列表出现“复制此问题的调试信息”按钮。
- 导出脱敏排错包（默认勾选「脱敏路径」、未勾选「附带当前工程与和声诊断」），核对 JSON 中无本机用户名路径且 `schemaVersion === 1`；点击「打开日志目录」确认可打开 `userData/logs/`。

## 7. 生成资源

```powershell
npm run generate:soundfont
npm run generate:icon
npm run generate:installer-assets
npm run generate:assets
```

资源生成必须可重复。默认 SoundFont 改动需要核对：

- `default.sf2`、`default.sf2.sha256`、许可证和 README。
- 所需 GM programs。
- 开发与 production `extraResources` 路径。

检查 `build/icon.ico` 在资源管理器、窗口和快捷方式中的显示。`generate:installer-assets` 在 `build/` 中生成安装和卸载各自的 24 位 BMP 侧栏（164 × 314）和页眉（150 × 57），以及控制面板使用的 `uninstaller-icon.ico`（256 × 256 PNG-in-ICO）。脚本会校验文件头、BMP 行对齐与 ICO 内嵌 PNG。

## 8. Windows 打包

### 8.1 免安装目录

```powershell
npm run pack:win
```

脚本执行资源生成、生产构建和 electron-builder `--win dir --x64`。输出目录来自 `package.json` 的 builder 配置，通常位于 `release`。

免安装目录适合检查：

- ASAR 中 renderer、Worker、主进程与 `dist-electron/electron/preload.cjs` 是否齐全。
- `extraResources/soundfonts` 是否存在及默认 SoundFont 生产路径。
- 主进程、preload、滚动日志与自定义协议是否可启动。

### 8.2 NSIS 安装包

```powershell
npm run dist:win
```

该命令在 `release-installer` 中生成 `SATB-Master-Setup-${version}-${arch}.${ext}` 和 `win-unpacked`。构建使用 Unicode NSIS，并以 `warningsAsErrors: true` 编译安装器和内嵌卸载器。构建脚本在临时目录中本地化 electron-builder 模板的回退提示，结束时清理临时副本。`build/installer.nsh` 使用 UTF-8 BOM 编码。

- 安装和卸载向导均使用简体中文及各自的品牌图形。安装可选择仅当前用户或所有用户，并自定义安装目录。
- 「安装选项」默认勾选桌面快捷方式、开始菜单快捷方式和 `.satb` 工程文件关联。选项按安装范围保存，静默安装和覆盖升级沿用已记录的偏好。完成页默认按普通用户权限启动应用。
- 文件关联允许从资源管理器双击打开 `.satb` 工程。取消关联或卸载时，清理 SATB Master 自己注册的关联。冷启动和单实例转发详见 [桌面端与持久化](./desktop-and-persistence.md#42-双击打开-satb-工程)。
- 卸载默认保留当前用户的设置、外置规则库、自动恢复记录及日志。可选「同时彻底清除」，清理应用数据目录，保存在其他文件夹中的 `.satb` 工程可继续使用。静默卸载仅在显式传入 `--delete-app-data` 时清理，内部升级卸载始终保留。

发布前在隔离的 Windows 环境中从实际安装路径启动。检查三项安装选项的开关与覆盖升级、双击工程的冷启动和热转发、卸载时保留和清除数据两条路径。

## 9. 版本发布矩阵

正式版本至少执行并记录：

```powershell
npm test                   # 含 6 项静态架构边界门禁
npm run typecheck
npm run build
npm run e2e:desktop:local  # 含会话零错误日志门禁
npm run e2e:audit          # 含会话零错误日志门禁
npm run pack:win           # 或 dist:win；正式安装版通常两者都检查
```

然后在干净或隔离的 Windows 10/11 x64 环境安装并手工冒烟：

1. 启动、窗口尺寸记忆与自定义窗口按钮。
2. 新建、编辑、撤销/重做、保存、关闭和重新打开。
3. recovery 两条路径和下拉菜单焦点。
4. 默认音色、本地音色、预听、播放、暂停、循环、节拍器与实时 Web MIDI 输出。
5. 和弦、70 条内置规则严重程度、内置/外置诊断、五线谱预览、自动配和声与半自动和声连接。
6. MIDI 与 MusicXML 导出文件能被常见 DAW/打谱软件打开。
7. 日志目录生成有效 JSONL、脱敏排错包导出正常。
8. 卸载后 `userData` 的保留行为符合说明。

Windows 10 与 11 至少各验证一个受支持版本。大 SoundFont 测试记录文件大小、进程位数和机器内存，避免将单机成功泛化为所有 2 GiB 文件都可用。

## 10. 版本号与契约

发布前分别评估：

- `package.json` 产品版本（当前为 `3.0.0`）。
- `PROJECT_SCHEMA_VERSION`（当前为 `3`）。
- `HARMONY_RULE_CATALOG_REVISION`（当前为 `3`）。
- `EXTERNAL_RULE_API_VERSION`（当前为 `3`）。
- `DiagnosticBundle.schemaVersion`（当前为 `1`）。

UI 功能升级通常只改产品版本；持久化破坏性变化需要新 schema 和迁移；外置脚本破坏性变化需要新 API 版本。版本号变更后重新生成安装包，确保文件名、应用元数据和关于信息一致。

## 11. 提交与产物管理

- 提交信息遵循仓库根目录 [`AGENTS.md`](../AGENTS.md) 中的 Conventional Commits 约定。
- 构建目录、安装包和临时 E2E 目录（`node_modules/.satb-master-e2e`、`node_modules/.satb-audit-e2e`）不应误加入 Git。
- 默认 SoundFont、哈希、许可证和图标属于受控源资源，需要按 `.gitignore` 现状确认是否应提交。
- 提交前运行 `git diff --check`，检查行尾、尾随空格和冲突标记。

文档-only 改动无需运行代码测试，但应检查相对链接和 Markdown 结构，并在交付说明中明确未运行构建。

## 12. 发布记录模板

```text
版本：
提交/标签：
构建机器与 Windows 版本：
Node/npm 版本：

已验证：
- npm test（含架构边界门禁）
- npm run typecheck
- npm run build
- npm run e2e:desktop:local（含会话零错误日志门禁）
- npm run e2e:audit（含会话零错误日志门禁）
- pack/installer
- 安装后手工冒烟

未验证：
- ...

已知限制：
- ...

产物：
- 文件名
- SHA-256
```

哈希应从最终分发文件计算，不要复用中间 pack 目录内容的哈希。

## 13. 发布阻断条件

以下任一项应阻止正式发布：

- 静态架构边界测试（`electron/architecture-boundaries.test.ts`）未通过（如 `src/domain` 引入运行时/日志依赖或生产代码出现裸 `console.warn`/`console.error`）。
- `e2e:desktop:local` 或 `e2e:audit` 触发会话零错误日志门禁失败（存在 `fatal` 或未预期 `error` 日志）。
- schema 变化没有明确迁移/拒绝策略和 fixture 测试。
- 默认 SoundFont 来源或许可证不清楚，或 production 路径无法加载。
- 暂停仍发声、用户 SoundFont 被覆盖、恢复后下拉菜单失焦等核心回归。
- 长工程高缩放下编辑明显不可用。
- 外置规则能访问宿主能力或绕过时间/内存限制。
- 安装包未在安装后路径启动验证。
- 测试环境失败被误报为完整通过，导致关键流程实际未执行。
