# SATB Master 开发者文档

本目录是 SATB Master 的开发者入口，描述当前代码已经实现的结构、稳定约束、调试方式与交付流程。它面向接手项目、实现功能、维护规则或排查桌面端问题的开发者。

> `Docs` 与 `DesignDocs` 的职责不同：`Docs` 记录当前实现和长期维护约定，随代码一起更新并纳入 Git；`DesignDocs` 保存开发过程中的方案讨论、阶段设计和未定结论。若设计文档与代码不一致，以代码和本目录中经过同步的说明为准。

当前已确认的四条开发主线及建议验收方向见 [项目开发主线](../DesignDocs/project-mainlines.md)：完善推导系统以实现自动解题、完善日志系统以追踪报错原因、补充规则测试用例、开发供 AI 使用的 MCP 创作与调试工具。该记录用于后续规划，具体实现能力仍以本目录各专题与代码为准。

## 1. 项目定位

SATB Master 是一款离线优先的四部和声学习与编辑软件。主要交互是钢琴卷帘式 SATB 编辑器，并在同一个工程中维护和弦区域、调号、拍号、速度、循环和规则配置。桌面版本使用 Electron，浏览器模式主要承担开发预览和有限降级。

当前主技术栈：

| 层级 | 技术 | 用途 |
| --- | --- | --- |
| 界面 | React 19、TypeScript、Vite | 编辑器、设置、诊断和属性检查器 |
| 桌面壳 | Electron | 文件、窗口、安装包和本地资源访问 |
| 音频 | SpessaSynth Worklet、Web Audio | SF2/SF3 合成、预听、播放和回退音色 |
| MIDI | `midi-file` | MIDI Type 1 导出 |
| 规则沙箱 | QuickJS WASM、Web Worker | 隔离执行外置和声规则 |
| 测试 | Vitest、自有 Electron CDP 脚本 | 领域测试、策略测试和桌面端流程 |

桌面端以 Windows 10/11 x64 为主要目标。工程不依赖后端服务，作品、恢复数据、规则包和用户 SoundFont 都保存在本地。

## 2. 当前能力

已经实现：

- 四个固定 SATB 声部的钢琴卷帘编辑、批量选择、拖绘、擦除、切分、移动、时值修改和预听。
- 允许重叠且不参与和声检查的辅助轨数据模型，以及辅助轨播放和 MIDI 导出。
- 范围型和弦轨、功能/级数/绝对三体系调色板、斯波索宾 A/B/C 功能标记、调号/拍号/速度事件、标尺和循环区域。
- 工程撤销/重做、练习可编辑区间、事件锁定、可调整工作区和键盘快捷键。
- 基于书写音高、连续 `HarmonySpan` 和精确连接的内置和声检查，包含规则私有状态、适用性特例、诊断仲裁和悬停证据。
- 工程级完整 `RuleProfile`、双栏规则设置、81 条可检索目录、便携配置档案和新建工程默认模板。
- QuickJS 隔离的外置规则 API v3、声明式配置/特例、本机规则库和工程级内容寻址引用。
- 默认及本地 SF2/SF3、播放/暂停/循环/节拍器、MIDI Type 1 导出。
- `.satb` 工程文件、自动恢复、v2 到 v3 迁移、最近对话框目录和开发者属性检查器。
- 目录修订 2 的 81 条内置规则均有首版实现并进入调度；规则配置变更可复用既有分析，5,000 音符单规则重检已有性能回归测试。
- 节拍强弱层级、乐句边界推导、终止式检测，以及工程级乐句边界与终止式标注。
- 面向空工程的自动和弦推导，包含候选预览、空白填充/替换未锁定写回与乐句结构联动。
- 规则测试工作台与 `.satb-rule-case.json` 用例格式，支持单规则隔离运行、用例目录与批量运行。

尚未实现或仍需完善：

- MIDI 导入及“解析为四声部/全部放入辅助轨”两种导入模式。
- VexFlow 五线谱实时预览。
- 辅助轨的完整编辑 UI；现阶段模型、播放和导出能力先于交互界面。
- 每次发布前的 Windows 安装后端到端验证；该结果依赖具体机器环境，不能由一次历史通过长期替代。
- 81 条规则的首版实现仍需持续用斯波索宾教材例题和院校口径校准；缺少人工语义或上下文时，部分规则会保守跳过，这不同于“尚未实现”。
- 自动和弦推导、乐句边界与终止式检测的首版实现同样需要教材例题校准；歧义时保守跳过或降级为 `ambiguous`，不会伪造确定结论。
- 音乐事件变化后的局部分析重建、设置列表虚拟化和覆盖更多编辑场景的完整性能基准。

当前需要区分三个版本号：

| 项目 | 当前值 | 说明 |
| --- | --- | --- |
| 产品版本 | `1.1.0` | 来自 [`package.json`](../package.json)，大版本开发分支上可能暂未更新 |
| 工程 schema | `3` | 来自 [`src/domain/project/types.ts`](../src/domain/project/types.ts)，决定 `.satb` 兼容性 |
| 外置规则 API | `3` | 来自 [`src/domain/harmony/external/api.ts`](../src/domain/harmony/external/api.ts)，决定规则脚本兼容性 |

工程 schema 和外置规则 API 是数据契约，不能用产品版本号替代。

## 3. 快速开始

准备与仓库锁文件匹配的 Node.js/npm 环境，然后在仓库根目录执行：

```powershell
npm install
npm run dev
```

常用命令：

```powershell
npm run dev:tools          # 启动 Electron 并打开开发者工具
npm test                   # 运行 Vitest 测试
npm run typecheck          # 检查 renderer 和 Electron 两套 TS 配置
npm run build              # 类型检查、Vite 构建、Electron 编译
npm run e2e:desktop:local  # 构建后运行本机 Electron 桌面流程
npm run pack:win           # 生成 Windows 免安装目录
npm run dist:win           # 生成 Windows NSIS 安装包
```

`npm run dev` 会同时启动 Vite 与 Electron。只打开 Vite 页面时可以使用浏览器降级实现，但它不能完整验证本地路径、原子保存、资源协议、窗口焦点和安装后行为。

默认 SoundFont 与应用图标由脚本生成。发布脚本会先运行 `generate:assets`；单独更新资源时执行：

```powershell
npm run generate:assets
```

## 4. 推荐阅读顺序

1. [architecture.md](./architecture.md)：运行时分层、目录职责和依赖方向。
2. [data-model.md](./data-model.md)：工程 schema、音高、轨道、和弦与迁移约束。
3. [editor-and-state.md](./editor-and-state.md)：编辑命令、历史记录、交互与 Canvas 性能模型。
4. [functional-harmony.md](./functional-harmony.md)：斯波索宾功能和弦模型、注册表、调色盘与兼容边界。
5. [harmony-engine.md](./harmony-engine.md)：切片、跨度、连接、适用性、规则状态和诊断仲裁。
6. [harmony-query.md](./harmony-query.md)：HarmonyRuleContext、HarmonyQuery 算子和查询边界。
7. [harmony-rule-runtime.md](./harmony-rule-runtime.md)：无状态规则、obligation 状态和跨切片运行时。
8. [diagnostics-and-debugging.md](./diagnostics-and-debugging.md)：诊断字段、根因仲裁和详细调试报告。
9. [analysis-inference.md](./analysis-inference.md)：节拍层级、乐句边界、终止式检测与自动和弦推导。
10. [analysis-lifecycle.md](./analysis-lifecycle.md)：分析快照、候选、写回和缓存失效边界。
11. [rule-testing.md](./rule-testing.md)：规则测试用例格式、隔离运行器与工作台。
12. [external-rules.md](./external-rules.md)：规则包契约、QuickJS 沙箱与本机规则库。
13. [audio-midi-and-time.md](./audio-midi-and-time.md)：统一时间轴、播放、SoundFont 和 MIDI。
14. [desktop-and-persistence.md](./desktop-and-persistence.md)：Electron 安全边界、IPC、工程保存和恢复。
15. [testing-build-release.md](./testing-build-release.md)：验证矩阵、桌面 E2E、打包和发布检查。
16. [score-text.md](./score-text.md)：面向脚本和 AI 的分块 SATB 简写、语义标注、独立参考答案及文本谱。
17. [textbook-case-workflow.md](./textbook-case-workflow.md)：教材转写、自检比对、诊断记录与人工审计分阶段执行，方案通过后修复。

按任务也可以直接定位：

| 要做的工作 | 先读 |
| --- | --- |
| 修改音符、和弦、锁定或撤销 | [data-model.md](./data-model.md)、[editor-and-state.md](./editor-and-state.md) |
| 新增或修正规则 | [harmony-engine.md](./harmony-engine.md) |
| 维护规则查询、领域视图或算子 | [harmony-query.md](./harmony-query.md)、[harmony-engine.md](./harmony-engine.md) |
| 维护规则状态或跨切片义务 | [harmony-rule-runtime.md](./harmony-rule-runtime.md) |
| 排查误报、诊断覆盖或复制报告 | [diagnostics-and-debugging.md](./diagnostics-and-debugging.md) |
| 维护和弦推导、乐句或终止式 | [analysis-inference.md](./analysis-inference.md) |
| 维护规则金样本或测试工作台 | [rule-testing.md](./rule-testing.md) |
| 用脚本编写 SATB 或查看文本谱 | [score-text.md](./score-text.md) |
| 开发外置规则 | [external-rules.md](./external-rules.md) |
| 排查播放、循环、节拍器或 MIDI | [audio-midi-and-time.md](./audio-midi-and-time.md) |
| 修改文件对话框、恢复、窗口或本地资源 | [desktop-and-persistence.md](./desktop-and-persistence.md) |
| 打包正式版本 | [testing-build-release.md](./testing-build-release.md) |

## 5. 源码入口

```text
src/
  App.tsx                  稳定入口，仅转出 app/AppShell
  app/                     应用壳、会话编排与工作流控制器
  features/                编辑器、设置、属性、诊断、轨道、和弦推导与规则测试功能模块
  components/              跨 feature 复用的通用 UI 原语
  domain/                  纯数据模型、编辑命令、时间、节拍、MIDI、和声分析与规则目录
  domain/harmony/          切片、跨度、规则、乐句、终止式、和弦推导与规则测试
  domain/project/          工程 schema、验证、规范化与迁移
  hooks/                   React 状态适配、历史、快捷键和布局
  services/                Electron/浏览器服务适配、外置规则运行时与规则用例库
  audio/                   合成器、SoundFont 生命周期和播放辅助
  workers/                 外置规则 QuickJS Worker
  shortcuts/               快捷键注册表
electron/                  主进程、preload、安全策略和 IPC
scripts/                   资源生成、清理、桌面 E2E
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
- **规则失败不能破坏编辑。** 缺少上下文应形成结构化 skip；外置规则异常应隔离并保留内置结果。
- **性能以视口为边界。** 长工程的逻辑坐标可以很大，但 Canvas 位图、绘制和命中候选应限制在可见区域附近。
- **区分候选与自动应用。** 终止式检测和和弦推导先产出带证据的候选；自动乐句推导可在专用推导流程中直接应用选定结构。所有写回仍必须经过编辑命令与锁定判断。
- **文档随契约更新。** schema、外置 API、IPC、规则清单、脚本或发布流程变化时，同一提交更新 `Docs`。

## 7. 文档维护规则

- 本目录描述“现在是什么”；未确定的方案留在 `DesignDocs`，稳定落地后再同步到这里。
- 文档链接优先指向源码入口，而不是复制整段实现。短小接口示例用于解释契约，不构成第二份类型定义。
- 不写死测试数量、构建产物哈希或包体大小等频繁变化的数据。
- 新增跨模块能力时，先更新对应专题文档，再检查本入口的能力清单和阅读索引。
- 删除或重命名源码入口时，运行本地 Markdown 链接检查，避免留下失效链接。
