# SATB Master 开发者文档

本目录是 SATB Master 的开发者入口，描述当前代码已经实现的结构、稳定约束、调试方式与交付流程。它面向接手项目、实现功能、维护规则或排查桌面端问题的开发者。

> `Docs` 与 `DesignDocs` 的职责不同：`Docs` 记录当前实现和长期维护约定，随代码一起更新并纳入 Git；`DesignDocs` 保存开发过程中的方案讨论、阶段设计和未定结论。若设计文档与代码不一致，以代码和本目录中经过同步的说明为准。

当前已确认的四条开发主线及建议验收方向见 [项目开发主线](../DesignDocs/project-mainlines.md)：完善推导系统以实现自动解题、完善日志系统以追踪报错原因、补充规则测试用例、开发供 AI 使用的 MCP 创作与调试工具。该记录用于后续规划，具体实现能力仍以本目录各专题与代码为准。

## 1. 项目定位

SATB Master 是一款离线优先的四部和声学习与编辑软件。主要交互是钢琴卷帘式 SATB 编辑器，并在同一个工程中维护和弦区域、调号、拍号、速度、循环和规则配置，同时提供实时五线谱预览、自动和声分析与辅助写作能力。桌面版本使用 Electron，浏览器模式主要承担开发预览和有限降级。

当前主技术栈：

| 层级 | 技术 | 用途 |
| --- | --- | --- |
| 界面 | React 19、TypeScript、Vite | 编辑器、设置、底部工作台、属性检查器与审计工作区 |
| 桌面壳 | Electron | 文件、无边框窗口、滚动日志、安装包和本地资源访问 |
| 跨进程契约 | `shared/` | Desktop IPC 通道与类型、双进程结构化日志契约、外置规则协议 |
| 音频与外设 | SpessaSynth Worklet、Web Audio、Web MIDI | SF2/SF3 合成、预听、播放、回退音色与实时外部 MIDI 输出 |
| 记谱与导入导出 | VexFlow 5、`midi-file`、自研 MusicXML/文本谱 | 五线谱实时预览、MIDI 导入与 Type 1 导出、MusicXML 导出与 `scoreText` 分块文本谱 |
| 规则沙箱与异步搜索 | QuickJS WASM、Web Worker | 隔离执行外置和声规则（`externalRule.worker.ts`）与半自动和声连接搜索（`progressionSearch.worker.ts`） |
| 测试与验证 | Vitest、自有 Electron CDP 脚本 | 领域测试、架构边界门禁、规则基准与桌面端 E2E（含会话零错误日志门禁） |

桌面端以 Windows 10/11 x64 为主要目标。工程不依赖后端服务，作品、恢复数据、会话日志、规则包和用户 SoundFont 都保存在本地。

## 2. 当前能力

已经实现：

- 四个固定 SATB 声部的钢琴卷帘编辑、批量选择、拖绘、擦除、切分、移动、时值修改和预听。
- 自动笔刷（`5`）按 SATB 音域就近分配并保序重排，拖绘时预览目标声部，写入遵守题干锁定和跨拍保护。
- 支持多条自由复音的额外声部，可自定义名称与颜色，编辑时阻止同音高、同起止的完全重叠。额外声部可预听和播放，五线谱预览、MIDI 和 MusicXML 导出均可逐轨配置，和声检查仍以 SATB 声部为范围。
- 范围型和弦轨、功能/级数/绝对三体系调色板、斯波索宾 A/B/C 功能标记、调号/拍号/速度事件、标尺和循环区域。
- 工程撤销/重做、练习可编辑区间、事件锁定、可调整工作区和键盘快捷键。
- 基于书写音高、连续 `HarmonySpan` 和精确连接的内置和声检查，包含规则私有状态、适用性特例、诊断仲裁、悬停证据和开发者模式调试报告。
- 工程级完整 `RuleProfile`、双栏规则设置、目录修订 3（`HARMONY_RULE_CATALOG_REVISION = 3`）的 70 条可检索内置规则（目录号 `A.1`–`K.4`）、便携配置档案和新建工程默认模板；规则配置变更可复用既有分析，长工程单规则重检已有性能回归测试。
- QuickJS 隔离的外置规则 API v3、声明式配置/特例、本机规则库和工程级内容寻址引用。
- 节拍强弱层级、乐句边界推导、终止式检测，以及工程级乐句边界与终止式标注。
- 自动和声分析与和弦推导，包含候选预览、空白填充/替换未锁定写回与乐句结构联动。
- 自动配和声（高音题/低音题）与半自动和声连接助手（底部面板 + Web Worker 异步搜索 + 钢琴卷帘幽灵音符预览 + 衔接试听）。
- 底部四标签工作台：问题（和声诊断）、五线谱（基于 VexFlow 的实时大谱表预览与独立大窗口预览）、和声连接、日志（开发者模式常驻，普通模式仅出错显现）。
- 支持将标准 MIDI 文件中选中的轨道直接导入为自由复音的额外声部，可选用文件中的速度、拍号和调号。
- 默认及本地 SF2/SF3、播放/暂停/循环/节拍器、实时 Web MIDI 输出、MIDI Type 1 导出与 MusicXML（`.musicxml`）导出。
- `.satb` 工程文件、自动恢复、v2 到 v3 迁移与原文件备份、分类型最近对话框目录、无边框窗口尺寸记忆和开发者属性检查器。
- 主进程 JSONL 滚动日志、渲染进程日志总线与面包屑、IPC 异常与慢调用埋点、根级崩溃恢复边界（紧急备份 `.satb` + 脱敏排错包导出）以及操作通知栈。
- 规则测试工作台与 `.satb-rule-case.json` 用例格式，支持单规则隔离运行、用例目录与批量运行。
- 可视化教材审计工作区（`.satb-audit.json`），支持原谱/转写谱/钢琴卷帘三视图拍点联动、独立编辑副本、预审问答与人工意见往返。
- 面向脚本与自动化工具的 `scoreText` 分块文本谱（`.satbt`）编译、校验与渲染。

尚未实现或仍需完善：

- 将 MIDI 自动拆分为 SATB 四声部导入模式。
- 每次发布前的 Windows 安装后端到端验证；该结果依赖具体机器环境，不能由一次历史通过长期替代。
- 70 条内置规则的教材例题与院校口径持续校准；缺少人工语义或上下文时，部分规则会保守跳过，这不同于“尚未实现”。
- 自动和弦推导、自动配和声、乐句边界与终止式检测的持续校准；歧义时保守跳过或降级为 `ambiguous`，不会伪造确定结论。
- 音乐事件变化后的局部分析重建、设置列表虚拟化和覆盖更多编辑场景的完整性能基准。

当前需要区分三个版本号：

| 项目 | 当前值 | 说明 |
| --- | --- | --- |
| 产品版本 | `3.0.0` | 来自 [`package.json`](../package.json) |
| 工程 schema | `3` | 来自 [`src/domain/project/types.ts`](../src/domain/project/types.ts)，决定 `.satb` 兼容性 |
| 外置规则 API | `3` | 来自 [`shared/external-rules.ts`](../shared/external-rules.ts)（经 [`src/domain/harmony/external/api.ts`](../src/domain/harmony/external/api.ts) 复用），决定规则脚本兼容性 |

工程 schema、规则目录修订号（`HARMONY_RULE_CATALOG_REVISION = 3`）和外置规则 API 都是数据契约，不能用产品版本号替代。

## 3. 快速开始

准备与仓库锁文件匹配的 Node.js/npm 环境，然后在仓库根目录执行：

```powershell
npm install
npm run dev
```

常用命令：

```powershell
npm run dev:tools          # 启动 Electron 并打开开发者工具
npm test                   # 运行 Vitest 测试（自动排除 StandardCase/Pilot/**）
npm run typecheck          # 检查 renderer 和 Electron 两套 TS 配置
npm run build              # 类型检查、Vite renderer 构建、build:electron（含 preload 打包）
npm run build:electron     # 清理 dist-electron、编译主进程 TS、vite.preload.config.ts 打包 preload
npm run e2e:desktop:local  # 构建后运行本机 Electron 桌面 E2E（含会话零错误日志门禁）
npm run e2e:audit          # 构建后运行教材审计工作区桌面 E2E（含会话零错误日志门禁）
npm run score -- --help    # scoreText (.satbt) 编译、渲染文本谱与校验 CLI
npm run benchmark -- --help # 盲推/条件和弦、终止式与规则断言基准评测 CLI
npm run audit -- --help    # 审计包 (.satb-audit.json) 打包、校验与意见汇总 CLI
npm run pack:win           # 生成 Windows 免安装目录（release/）
npm run dist:win           # 生成 Windows NSIS 安装包（release-installer/）
npm run pack:mac           # 生成当前架构的 macOS .app（release/）
npm run dist:mac           # 生成 Apple Silicon / Intel 通用 DMG（release/）
```

`npm run dev` 会先执行 `build:electron`，再同时启动 Vite 与 Electron。只打开 Vite 页面时可以使用浏览器降级实现，但它不能完整验证本地路径、原子保存、资源协议、滚动日志落盘、窗口焦点和安装后行为。

默认 SoundFont 与应用图标由脚本生成。发布脚本会先运行 `generate:assets`；单独更新资源时执行：

```powershell
npm run generate:assets
```

## 4. 推荐阅读顺序

1. [architecture.md](./architecture.md)：运行时分层、跨进程契约、目录职责、依赖方向与静态架构门禁。
2. [data-model.md](./data-model.md)：工程 schema、音高、轨道、和弦、校验规范化与迁移约束。
3. [editor-and-state.md](./editor-and-state.md)：编辑命令、历史记录、交互与 Canvas 性能模型。
4. [functional-harmony.md](./functional-harmony.md)：斯波索宾功能和弦模型、注册表、调色盘与兼容边界。
5. [harmony-engine.md](./harmony-engine.md)：切片、跨度、连接、适用性、规则状态和诊断仲裁。
6. [harmony-query.md](./harmony-query.md)：`HarmonyRuleContext`、`HarmonyQuery` 算子和查询边界。
7. [harmony-rule-runtime.md](./harmony-rule-runtime.md)：无状态规则、obligation 状态和跨切片运行时。
8. [diagnostics-and-debugging.md](./diagnostics-and-debugging.md)：和声诊断字段、根因仲裁与规则调试报告。
9. [logging-and-observability.md](./logging-and-observability.md)：双进程结构化日志、崩溃恢复、通知联动、日志工作台与排错包。
10. [analysis-inference.md](./analysis-inference.md)：节拍层级、乐句边界、终止式检测与自动和弦推导。
11. [analysis-lifecycle.md](./analysis-lifecycle.md)：分析快照、候选、写回和缓存失效边界。
12. [harmonization.md](./harmonization.md)：自动配和声（高音题/低音题）与半自动和声连接助手。
13. [rule-testing.md](./rule-testing.md)：规则测试用例格式、隔离运行器与工作台。
14. [external-rules.md](./external-rules.md)：规则包契约、QuickJS 沙箱与本机规则库。
15. [audio-midi-and-time.md](./audio-midi-and-time.md)：统一时间轴、播放、SoundFont、MIDI 与 MusicXML。
16. [desktop-and-persistence.md](./desktop-and-persistence.md)：Electron 安全边界、IPC 契约、工程保存、窗口状态和恢复。
17. [testing-build-release.md](./testing-build-release.md)：验证矩阵、桌面 E2E、日志门禁、CLI 工具、打包和发布检查。
18. [score-text.md](./score-text.md)：面向脚本和工具的分块 SATB 简写、语义标注、独立参考答案及文本谱。
19. [audit-workspace.md](./audit-workspace.md)：可视化教材审计区、打包接口、原图/转写谱/卷帘对照、人工意见往返与版本失效。

按任务也可以直接定位：

| 要做的工作 | 先读 |
| --- | --- |
| 修改音符、和弦、锁定或撤销 | [data-model.md](./data-model.md)、[editor-and-state.md](./editor-and-state.md) |
| 新增或修正规则 | [harmony-engine.md](./harmony-engine.md) |
| 维护规则查询、领域视图或算子 | [harmony-query.md](./harmony-query.md)、[harmony-engine.md](./harmony-engine.md) |
| 维护规则状态或跨切片义务 | [harmony-rule-runtime.md](./harmony-rule-runtime.md) |
| 排查和声误报、诊断覆盖或复制规则调试报告 | [diagnostics-and-debugging.md](./diagnostics-and-debugging.md) |
| 排查应用报错、崩溃恢复、日志落盘或排错包 | [logging-and-observability.md](./logging-and-observability.md) |
| 维护和弦推导、乐句或终止式 | [analysis-inference.md](./analysis-inference.md) |
| 维护自动配和声或半自动和声连接 | [harmonization.md](./harmonization.md) |
| 维护规则金样本或测试工作台 | [rule-testing.md](./rule-testing.md) |
| 用脚本编写 SATB 或查看文本谱 | [score-text.md](./score-text.md) |
| 使用或维护教材审计工作区与审计包 | [audit-workspace.md](./audit-workspace.md) |
| 开发外置规则 | [external-rules.md](./external-rules.md) |
| 排查播放、循环、节拍器、Web MIDI 或导出 | [audio-midi-and-time.md](./audio-midi-and-time.md) |
| 修改文件对话框、恢复、窗口或本地资源 | [desktop-and-persistence.md](./desktop-and-persistence.md) |
| 打包正式版本或排查 E2E | [testing-build-release.md](./testing-build-release.md) |

## 5. 源码入口

```text
shared/                    跨进程共享契约（Desktop IPC、结构化日志、外置规则协议）
src/
  App.tsx                  稳定入口，仅转出 app/AppShell
  main.tsx                 渲染进程入口，挂载全局错误捕获与 AppErrorBoundary
  app/                     应用壳、会话编排与工作流控制器（含 editorCommands/ 六子模块）
  features/                功能工作区：
    audit/                   教材审计工作区
    autoHarmonization/       自动配和声对话框与候选预览
    bottomPanel/             底部四标签工作台（问题/五线谱/和声连接/日志）
    chordInference/          自动和弦推导引导与写回界面
    diagnostics/             和声问题面板与会话日志工作台
    editor/                  钢琴卷帘编辑器与视口坐标系统
    export/                  MIDI / MusicXML 统一导出对话框
    inspector/               属性检查器、和弦语义、终止式与开发者事件视图
    midiImport/              MIDI 导入确认对话框
    midiOut/                 实时 Web MIDI 输出配置对话框
    progressionAssistant/    半自动和声连接面板
    ruleTesting/             规则测试工作台
    scorePreview/            VexFlow 五线谱预览（内嵌与独立大窗口）
    settings/                设置窗口、规则配置、快捷键与开发者模式
    tracks/                  声部/轨道侧栏与赞助对话框
  components/              跨 feature 复用的通用 UI 原语（含 AppErrorBoundary、AppNoticeStack）
  domain/                  纯领域核心（零 React / Electron / DOM / logging 依赖）：
    audit/                   审计包解析、校验、问题模型与原图锚点
    harmony/                 切片、跨度、规则、共享事实（facts/）、乐句、终止式、和弦推导、自动配和声（harmonization/）、调试快照与规则测试
    musicxml/                MusicXML 3.1/4.0 导出模型与序列化
    notation/                VexFlow 记谱中间模型、声部拆分与连音线转换
    project/                 工程 schema、验证、规范化与 v2 -> v3 迁移
    rhythm/                  节拍层级与强弱位置
    scoreText/               分块 SATB 文本谱（.satbt）解析、编译与渲染
  hooks/                   React 状态适配、历史、快捷键、布局与偏好开关
  services/                环境适配层（desktop 桥接、clipboard、audit 存储、外置规则运行时、规则用例库）
    logging/                 渲染进程结构化日志总线、面包屑与紧急工程快照提供者
  audio/                   SpessaSynth 合成器、SoundFont 生命周期、Web MIDI 输出与播放辅助
  workers/                 Web Worker：externalRule.worker.ts（QuickJS 沙箱）与 progressionSearch.worker.ts（半自动连接搜索）
  shortcuts/               快捷键注册表
  styles/                  4 个全局基线样式（tokens、window、layout、dialogs）；其余样式就近位于各 feature
electron/                  主进程、preload、typed-ipc、滚动日志、窗口状态、互斥对话框、安全策略与 IPC
scripts/                   资源生成、清理、桌面/审计 E2E（含日志门禁）、score/benchmark/audit/written-case CLI
public/soundfonts/         默认 SoundFont、哈希、许可证和来源说明
RuleCases/                 随代码维护的规则测试金样本
```

领域层是维护项目正确性的核心。UI 可以表达意图，但不能成为音符不重叠、锁定区间、和弦范围或时间换算的唯一实现位置。

## 6. 开发原则

- **先维护领域不变量。** 用户编辑必须调用 [`src/domain/editing.ts`](../src/domain/editing.ts) 的纯命令，而不是在组件内直接拼装工程对象。
- **统一时间来源。** tick、秒、小节、吸附、循环和变速转换统一使用 [`src/domain/time.ts`](../src/domain/time.ts)。
- **保留书写音高。** MIDI 音高相同不代表和声含义相同；不要丢弃 `step/alter/octave`。
- **批量动作只提交一次历史。** 多选移动、删除、粘贴等必须先完整验证，再一次产生新工程。
- **主进程只暴露窄接口。** renderer 不应直接获得 Node、任意文件路径或通用 IPC 能力。
- **异常与告警走统一日志通道。** 生产代码禁止裸 `console.warn` / `console.error`，应通过主进程 `logMain` 或渲染进程 `logger` 落盘与归集。
- **规则失败不能破坏编辑。** 缺少上下文应形成结构化 skip；外置规则异常应隔离并保留内置结果。
- **性能以视口为边界。** 长工程的逻辑坐标可以很大，但 Canvas 位图、绘制和命中候选应限制在可见区域附近。
- **区分候选与自动应用。** 终止式检测、和弦推导、自动配和声和半自动连接先产出带证据的候选；所有写回仍必须经过编辑命令与锁定判断。
- **文档随契约更新。** schema、外置 API、IPC、日志契约、规则清单、脚本或发布流程变化时，同一提交更新 `Docs`。

## 7. 文档维护规则

- 本目录描述“现在是什么”；未确定的方案留在 `DesignDocs`，稳定落地后再同步到这里。
- 文档链接优先指向源码入口，而不是复制整段实现。短小接口示例用于解释契约，不构成第二份类型定义。
- 不写死测试数量、构建产物哈希或包体大小等频繁变化的数据。
- 新增跨模块能力时，先更新对应专题文档，再检查本入口的能力清单和阅读索引。
- 删除或重命名源码入口时，运行本地 Markdown 链接检查，避免留下失效链接。
