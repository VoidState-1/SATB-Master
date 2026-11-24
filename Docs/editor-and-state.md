# 编辑器与应用状态

本文说明 React 工作区、领域编辑命令、撤销历史、快捷键和钢琴卷帘性能模型。工程字段见 [data-model.md](./data-model.md)，统一时间换算见 [audio-midi-and-time.md](./audio-midi-and-time.md)。

## 1. 状态分层

编辑器同时存在三类状态，维护时必须先区分归属：

| 类别 | 示例 | 生命周期 |
| --- | --- | --- |
| 工程状态 | 音符、和弦、调号、循环、规则配置 | 保存到 `.satb`，进入撤销历史 |
| 会话状态 | 当前声部、工具、选择、播放头、打开的弹窗 | 当前应用会话，不随工程持久化或按需本地保存 |
| 运行时资源 | AudioContext、合成器、Worker、文件 token | 由 service 管理，不可序列化 |

[`src/App.tsx`](../src/App.tsx) 只是稳定转出入口，实际由 [`src/app/AppShell.tsx`](../src/app/AppShell.tsx) 组合这些状态。`AppShell` 是编排层，不是领域模型的替代品。判断一个值是否应写入 `ProjectDocument` 的简单标准是：关闭并重新打开工程后，它是否仍是作品本身的一部分。

## 2. 工作区结构

主工作区布局为：

```text
TrackSidebar | PianoRoll + BottomPanel | Inspector
```

- 左侧 [`TrackSidebar`](../src/features/tracks/TrackSidebar.tsx) 选择 SATB 声部、轨道静音/独奏/音色与工具相关上下文。
- 中央 [`PianoRoll`](../src/features/editor/PianoRoll.tsx) 同时绘制标尺、和弦轨、音符、诊断、幽灵预览与播放头。
- 下方 [`BottomPanel`](../src/features/bottomPanel/BottomPanel.tsx) 集成 4 个页签：
  - **问题 (`diagnostics`)**：[`DiagnosticsPanel`](../src/features/diagnostics/DiagnosticsPanel.tsx) 展示规则诊断列表与忽略控制。
  - **五线谱 (`score`)**：[`ScorePreviewPane`](../src/features/scorePreview/ScorePreviewPane.tsx) 与 [`ScorePreviewToolbar`](../src/features/scorePreview/ScorePreviewToolbar.tsx) 提供常驻只读大谱表预览，并支持一键弹出独立大窗。
  - **和声连接 (`progression`)**：[`ProgressionAssistantPanel`](../src/features/progressionAssistant/ProgressionAssistantPanel.tsx) 提供半自动和声连接候选。
  - **日志 (`logs`)**：[`LogsPanel`](../src/features/diagnostics/LogsPanel.tsx) 仅在开启开发者模式、本会话出现错误日志或主动点击「查看日志」时按需显示。
  - 非日志页签（`diagnostics` / `score` / `progression`）的当前选择持久化于 `localStorage` 的 `satb-master-bottom-panel-tab`。
- 右侧 [`Inspector`](../src/features/inspector/Inspector.tsx) 包含 3 个页签：**属性**（[`SelectionInspector`](../src/features/inspector/SelectionInspector.tsx)）、**工程**（[`ProjectInspector`](../src/features/inspector/ProjectInspector.tsx)）与**音源**（[`SoundInspector`](../src/features/inspector/SoundInspector.tsx)）；开发者模式下「属性」页签会展开所选事件模型的全部只读字段。

除主工作区外，应用提供以下弹窗与独立工作区入口：

- **和弦推导弹窗**：[`ChordInferenceDialog`](../src/features/chordInference/ChordInferenceDialog.tsx) 按全工程、选区或乐句范围推导候选并在应用前预览（见 [analysis-inference.md](./analysis-inference.md)）。
- **自动和声弹窗**：[`AutoHarmonizationDialog`](../src/features/autoHarmonization/AutoHarmonizationDialog.tsx) 为给定高音或低音生成完整四部和声候选、支持试听并一次提交（见 [harmonization.md](./harmonization.md)）。
- **独立五线谱大窗**：[`ScorePreviewDialog`](../src/features/scorePreview/ScorePreviewDialog.tsx) 以模态大窗口展示完整只读五线谱。
- **统一导出弹窗**：[`ExportDialog`](../src/features/export/ExportDialog.tsx) 集中提供 MusicXML（`.musicxml`）与 MIDI（`.mid`）导出选项。
- **实时 MIDI 输出弹窗**：[`MidiOutDialog`](../src/features/midiOut/MidiOutDialog.tsx) 配置 Web MIDI 端口、通道路由与内置合成器静音联动（见 [audio-midi-and-time.md](./audio-midi-and-time.md)）。
- **设置弹窗**：[`SettingsDialog`](../src/features/settings/SettingsDialog.tsx) 管理快捷键、规则配置、外置规则包、编辑器偏好与开发者选项。
- **规则测试工作台**：[`RuleTestWorkbench`](../src/features/ruleTesting/RuleTestWorkbench.tsx) 提供独立的用例编辑与运行区，进入/退出时隔离面板布局偏好（见 [rule-testing.md](./rule-testing.md)）。
- **教材审计工作台**：[`AuditWorkbench`](../src/features/audit/AuditWorkbench.tsx) 提供独立的原图/转写谱/钢琴卷帘三视图对照与意见往返工作区（见 [audit-workspace.md](./audit-workspace.md)）。

左右分栏和下方面板支持拖动调整与独立折叠显隐。[`usePanelLayout.ts`](../src/hooks/usePanelLayout.ts) 按作用域（`project` / `rule-test`）同时管理尺寸与显隐持久化：尺寸存于 `satb-master-panel-layout-v2:<scope>`，左/右/下三面板显隐存于 `satb-master-panel-visibility-v1:<scope>`；两者均为用户界面偏好，不进入工程历史。分隔命中区可以比视觉线更宽，视觉上不应额外出现粗重边框。

## 3. AppShell 控制器分层

[`src/app/AppShell.tsx`](../src/app/AppShell.tsx) 通过 [`src/app/controllers/`](../src/app/controllers/) 下的专用控制器拆分状态与副作用，避免单文件堆积业务逻辑：

| 模块 | 职责 |
| --- | --- |
| [`useProjectController.ts`](../src/app/controllers/useProjectController.ts) | 组合 `useProjectHistory` 与 `useEditorState`；为 `undo`/`redo` 附加 `editor` 面包屑记录，并提供工程切换时的 `resetWorkspace` |
| [`useEditorState.ts`](../src/app/controllers/useEditorState.ts) | 维护当前声部、工具与修饰键临时覆盖、编辑域、网格、缩放与选中集合等会话状态 |
| [`useEditorCommands.ts`](../src/app/controllers/useEditorCommands.ts) | 统一校验并提交领域编辑结果，并聚合 [`editorCommands/`](../src/app/controllers/editorCommands/) 下 6 个子 Hook：`useNoteCommands`、`useChordCommands`、`useProjectCommands`、`useTimingCommands`、`useSelectionCommands`、`useViewCommands` |
| [`useFileWorkflow.ts`](../src/app/controllers/useFileWorkflow.ts) | 新建/打开/保存、自动恢复、MIDI/MusicXML 导出与脏状态确认流 |
| [`useHarmonyController.ts`](../src/app/controllers/useHarmonyController.ts) | 内置与外置规则配置、防抖和声检查、规则包挂载与规则档导入/导出 |
| [`usePlaybackController.ts`](../src/app/controllers/usePlaybackController.ts) | SoundFont 生命周期、主播放/循环、候选试听与电平表轮询 |
| [`useProgressionAssistant.ts`](../src/app/controllers/useProgressionAssistant.ts) | 半自动和声连接 Worker 检索、钢琴卷帘幽灵预览、候选试听与撤销光标同步 |
| [`useKeyboardController.ts`](../src/app/controllers/useKeyboardController.ts) | 全局键盘快捷键分发与作用域/弹窗门控 |
| [`useConfirmationController.ts`](../src/app/controllers/useConfirmationController.ts) | 异步 Promise 化的通用确认弹窗队列 |
| [`useWindowController.ts`](../src/app/controllers/useWindowController.ts) | Electron 窗口最大化/关闭拦截与未保存修改确认 |
| [`useRuleTestWorkspace.ts`](../src/app/controllers/useRuleTestWorkspace.ts) | 规则测试工作台独立文档历史、用例库与执行器状态 |
| [`singleFlight.ts`](../src/app/controllers/singleFlight.ts) | `createSingleFlight()` 异步单飞锁，防止起播等异步入口在完成前被并发重入 |

撤销/重做底层由泛型 Hook [`useDocumentHistory.ts`](../src/hooks/useDocumentHistory.ts) 实现；[`useProjectHistory.ts`](../src/hooks/useProjectHistory.ts) 仅是将其 `document` 别名为 `project` 的薄封装。该历史引擎同时复用于主工程（`useProjectController`）、规则测试工作台（`useRuleTestWorkspace`）以及教材审计条目副本编辑器（[`AuditProjectEditor.tsx`](../src/features/audit/AuditProjectEditor.tsx)）。

## 4. 领域命令是编辑入口

[`src/domain/editing.ts`](../src/domain/editing.ts) 中的编辑函数接收当前工程和操作参数，并返回：

```ts
interface EditResult {
  project: ProjectDocument;
  error?: string;
}
```

约定：

- 成功时返回新的工程对象，不修改传入对象。
- 失败时返回可展示错误，并保持当前工程不变。
- UI 的 hover/drag preview 不代表操作已经合法；提交时仍由命令复核。
- 组件不得通过直接 `map`/`splice` 工程数组来绕过命令。

命令层负责的约束包括：

- SATB 同一声部音符不能重叠，辅助轨可以重叠。
- 音符必须位于工程范围和 MIDI 0-127 内。
- 音符锁定、和弦锁定和练习可编辑区间必须生效。
- 和弦区域不能重叠，也不能跨越调号事件。
- 调号变化、和弦移动或草稿提交后重新解析和弦。
- 删除、剪切、粘贴、量化和多选移动遵守相同约束。

### 4.1 锁定判断

锁定不是一个按钮禁用规则，而是领域权限：

```text
操作原范围是否可编辑
  + 操作后范围是否可编辑
  + 事件自身是否锁定
  + 相关轨道/和弦约束
  = 命令是否允许
```

移动一个未锁定音符进入锁定区也应被拒绝。批量选择同时包含可编辑与不可编辑事件时，不应只修改其中一部分而让用户误以为整批成功。

### 4.2 批量原子性

多选操作应在内存中完成整批计划和验证，再一次返回新工程。这样可以保证：

- 只产生一个撤销帧。
- 不会因中途失败留下部分移动/删除。
- 和声检查只接收一次最终 revision。
- 自动恢复不会捕获半完成工程。

新增批量命令时优先实现单个领域函数，而不是在组件中循环调用单音符命令并连续提交历史。

## 5. 历史、dirty 与 revision

[`src/hooks/useDocumentHistory.ts`](../src/hooks/useDocumentHistory.ts)（及其工程别名 [`src/hooks/useProjectHistory.ts`](../src/hooks/useProjectHistory.ts)）管理当前帧、过去帧、未来帧和保存基线。

核心语义：

- 新编辑清空 redo 栈并增加 revision。
- 历史最多保留 100 个过去帧容量（实现当前帧之外最多保留 99 个旧帧）。
- `dirty` 由 `present.revision !== savedRevision` 决定，不通过深比较整个工程计算。
- `markSaved` 只更新保存基线，不创建新历史。
- `load` 用磁盘工程建立新的历史起点和文件语境。
- `recover` 恢复未保存内容，仍应保持 dirty，不能伪装为已保存。

Ctrl+Z 和重做快捷键允许按键重复，连续撤销由快捷键定义中的 `allowRepeat` 控制。不要通过计时器自行重复调用，以免与系统 key repeat 和输入框焦点冲突。

revision 还用于异步规则竞争：分析开始时记录 revision，返回结果必须与当前 revision 对比。撤销后内容可能与旧帧相似，但 revision 语义仍不同，不能只比较对象 ID 或 JSON。

## 6. 选择、剪贴板与工具

选择集合属于会话状态。一般约定：

- `Ctrl+A` 全选当前编辑域中的音乐事件，不能落入浏览器“全选文本”。
- `Ctrl+Shift+A` 清除选择，`Escape` 取消当前操作或清除选择。
- 复制只写内部音乐事件剪贴板；剪切在复制成功后执行一次批量删除。
- 粘贴和重复需要生成新事件 ID，并通过批量重叠/锁定检查。
- 单选事件移动时允许音频预听，多选不预听，避免同时触发大量声音。
- 双击非当前声部音符会先切换到该声部，再进入对应操作。

默认工具是选择工具。选择工具下按住 Ctrl 临时使用画笔，按住 Alt 临时使用擦除，松开恢复；这个临时覆盖不修改用户选定的基础工具。Ctrl 按住期间，Tab/Shift+Tab 仍应切换声部，因此快捷键匹配支持在特定上下文忽略 Ctrl 修饰符。

中键不选择工具，用于拖动画布。右键在标尺/和弦等上下文中打开菜单，需阻止浏览器默认菜单但不能破坏输入框的正常行为。

## 7. 钢琴卷帘坐标模型

[`src/features/editor/PianoRoll.tsx`](../src/features/editor/PianoRoll.tsx) 组合钢琴卷帘，纯坐标换算集中在 [`src/features/editor/viewport.ts`](../src/features/editor/viewport.ts)。音乐逻辑坐标和视口位图坐标必须明确区分并通过同一组函数转换。

### 7.1 时间轴

横向位置统一由 `tickToX` 与 `xToTick`（以 `pixelsPerBeat` 为缩放参数，且已包含左侧琴键区宽度 `PIANO_WIDTH = 58`）产生：

```text
logicalX = PIANO_WIDTH + (tick / ppq) * pixelsPerBeat   // PIANO_WIDTH = 58
screenX  = logicalX - scrollLeft
```

标尺、和弦轨、音符、循环范围和播放头必须共享同一 `scrollLeft`、`pixelsPerBeat` 与 `PIANO_WIDTH` 原点。分别计算或对某一轨额外取整会造成播放红线在轨道交界处断层。

Ctrl+滚轮横向缩放调用 `scrollLeftForZoom` 以鼠标所指 tick 为锚点：缩放前后该 tick 应尽量保持在同一屏幕位置。不要叠加浏览器/组件自带缩放和手工滚动补偿，否则会产生跳跃。

### 7.2 播放头跟随、调内音阶参考与离散定位

- **播放头边缘推拉跟随**：由 [`viewport.ts`](../src/features/editor/viewport.ts) 中的 `calculateFollowPlayheadScrollLeft` 与 [`useFollowPlayhead.ts`](../src/hooks/useFollowPlayhead.ts)（持久化于 `satb-master-follow-playhead-v1`，默认开启）驱动。播放期间允许红线在视口左侧与中央自由推进，触及右侧安全阈值（默认 `thresholdRatio = 0.6`，即视口 60% 处）时推动画布前进；循环回绕或光标回退至 `PIANO_WIDTH + 10` 左侧时将其拉回视口。用户在播放中手动滚轮、中键平移或拖动滚动条会通过 `onDisengageFollow` 临时脱离跟随（程序自身滚动经 `isProgrammaticScrollRef` 隔离，不误触脱离）；再次启动播放时，`AppShell` 通过 `readStoredFollowPlayhead()` 自动恢复持久化偏好。
- **调内音阶底色参考**：由 [`useScaleGuide.ts`](../src/hooks/useScaleGuide.ts)（持久化于 `satb-master-scale-guide-v1`）控制；开启后，[`NoteLayer.tsx`](../src/features/editor/layers/NoteLayer.tsx) 根据当前小节/位置的 `keyAtTick` 与 `isDiatonicPitch` 绘制调内音阶底色参考，不改变音符拼写或编辑约束。
- **离散范围聚焦与点击定位**：`PianoRoll` 接受可选的 `focusRange`（一次性将水平视口对齐至目标 `fromTick` 并将垂直视口居中到目标区间或指定 `noteIds` 的音域中点，用于教材审计等工作台定位）与 `seekOnClick`（允许单击标尺/空白处移动播放头，并在非播放状态下自动将视口滚回可见区域）。

### 7.3 纵向音域

卷帘逻辑音域覆盖 MIDI 0-127。声部建议音域只影响底色或规则诊断，不裁剪画布，也不能允许键盘移动后生成不可见音符。

纵向滚动、键盘标签和音符 y 坐标必须使用相同的 MIDI 行高（`ROW_HEIGHT = 22`、`HEADER_HEIGHT = RULER_HEIGHT + 42`）。音高拼写显示在音符上，声部身份由颜色和轨道语境表达。

### 7.4 吸附

开始位置和结束边界使用不同方向：

- 新建/移动的起点调用向前取整，即 `snapTickBackward`。
- 拖出时值的结束边界调用向后取整，即 `snapTickForward`。

这使用户选择八分音符网格时，从一个网格内开始并拖过下一个边界能够得到预期的完整时值。用“距离最近网格”的四舍五入会让点击后半格时意外跳到下一格，也会令时值延长需要拖到不自然的位置。

### 7.5 命中与预览

拖拽过程保持 UI 预览状态，提交时转换回 tick/音高并调用领域命令。常见操作：

- 画笔拖出范围时显示尚未提交的音符。
- 选择移动时保留原事件引用，松开后一次提交。
- 擦除拖过事件时先在画布中实时隐藏候选，松开后一次批量删除。
- 切分点向适用的网格方向吸附，并保证两侧时值均大于零。

实时隐藏与领域提交需要分开：若命令最终拒绝，隐藏集合要清空并恢复原画面。

## 8. 长工程性能模型

逻辑画布宽度可以随工程长度和缩放变得很大，但实际 Canvas 位图只覆盖当前视口。当前优化的核心不是减少工程坐标，而是避免：

- 创建“总工程宽度 x 总音域高度”的巨大像素缓冲区。
- 每次鼠标移动重绘所有小节、所有网格和所有事件。
- 为不可见事件反复测量文本或构建复杂路径。
- 将 scroll 位置同时写入多个互相触发的 React state/effect。

推荐绘制流程：

```text
读取视口尺寸与 scroll
-> 求可见 tick/MIDI 范围并增加少量 overscan
-> 过滤可见事件和诊断
-> 在视口大小 Canvas 中按 screen 坐标绘制
-> DOM 覆盖层使用同一坐标转换
```

长工程下新增图层时，必须验证“总小节多 + 横向缩放大 + 视野窄”的组合。只测试整段缩到一屏会掩盖位图和循环遍历问题。

应避免把高频 `pointermove` 直接变成完整工程 React state。可用 ref 保存手势中间值，以 `requestAnimationFrame` 合并绘制；只有松手后的合法结果进入工程历史。

## 9. 标尺、和弦轨与播放头

顶部区域虽然视觉上分成标尺和和弦轨，但共享中央画布时间轴：

- 小节线同时贯穿标尺、和弦轨和卷帘。
- 播放头红线从标尺顶部贯穿到卷帘底部。
- 循环起止用方向三角和范围线表达，避免文字遮挡小节号。
- 速度、拍号、调号在同一变化标签中只显示实际变化项。
- 双击变化标签打开编辑浮窗；右键标尺可添加变化或设置循环端点。

标尺刻度与时间变化标签的纯计算位于 [`src/domain/timelineRuler.ts`](../src/domain/timelineRuler.ts)（`buildTimelineRulerTicks`、`buildTimingMarkerGroups`），图层位于 [`TimelineRuler.tsx`](../src/features/editor/layers/TimelineRuler.tsx) 与 [`TimingMarkerPopover.tsx`](../src/features/editor/layers/TimingMarkerPopover.tsx)。同一 tick 的速度、拍号、调号合并为单个标签，避免重复渲染。

修复对齐问题时应查共同的坐标原点和裁剪边界，而不是对单个图层添加 1px 偏移补丁。

### 9.1 和弦调色盘

和弦浮窗使用“功能 / 级数 / 绝对”分段视图。功能视图直接读取领域注册表，组合选择基础功能、三/七/九和弦形态、合法转位、离调目标和构成音变化；级数与绝对视图继续使用结构化选项，不提供自由名称输入。草稿的修正逻辑集中在 [`src/domain/chordEditorModel.ts`](../src/domain/chordEditorModel.ts) 的 `applyChordEditorAction`，调色盘与 Inspector 只选择 action，不各自决定如何清除第二解释等副作用。

借用、持续低音和共同和弦属于语义上下文，放在调色盘底部及 Inspector。共同和弦选项必须来自 `compatibleFunctionalInterpretations`，没有同实体候选时禁用，不能让 UI 临时制造两个互相矛盾的解释。

和弦轨显示模式为 `functional`、`roman`、`absolute`、`functional-absolute`、`roman-absolute`。标签只显示当前模式，悬停提示同时显示三种投影。

## 10. 自动和声与半自动和声连接（含幽灵预览）

自动配和声与半自动和声连接的领域算法见 [harmonization.md](./harmonization.md)；编辑器层负责交互编排、候选试听与幽灵预览，所有写入均通过原子提交进入工程历史：

- **自动和声弹窗（[`AutoHarmonizationDialog.tsx`](../src/features/autoHarmonization/AutoHarmonizationDialog.tsx)）**：使用原生 `<dialog>` 并通过 `showModal()` 挂载于顶层（Top Layer）。支持选择给定声部（高音题 `soprano` / 低音题 `bass`）、作用范围（全曲 `project` / 选中区域 `selection` / 当前小节 `current-measure`）、风格预设（`classic-basic` / `textbook-standard` / `expressive-secondary`）以及锁定约束开关（`respectLockedConstraints`）与经过音/辅助音开关（`allowPassingAndNeighborMelodies`）。生成结果在 [`AutoHarmonizationPreview.tsx`](../src/features/autoHarmonization/AutoHarmonizationPreview.tsx) 中对比诊断计数与方案详情，支持基于 `AbortController` 的候选试听（调用 `handleAuditionProject`），确认后通过 `applyAutoHarmonization` 与 `history.commit` 一次性写入四声部、和弦轨与乐句/终止式结构。
- **半自动和声连接与幽灵预览**：由 [`BottomPanel`](../src/features/bottomPanel/BottomPanel.tsx) 的「和声连接」页签（[`ProgressionAssistantPanel.tsx`](../src/features/progressionAssistant/ProgressionAssistantPanel.tsx)）、控制器 [`useProgressionAssistant.ts`](../src/app/controllers/useProgressionAssistant.ts) 与后台 [`progressionSearch.worker.ts`](../src/workers/progressionSearch.worker.ts) 协作驱动。
  - 当页签激活且未处于主播放状态时，控制器以当前播放头为起点经防抖（`60ms`）在 Worker 中检索单步或短进行候选；悬浮或键盘聚焦候选卡片及其排列变体时，生成 `ProgressionPreview` 传入 `PianoRoll`。
  - [`NoteLayer.tsx`](../src/features/editor/layers/NoteLayer.tsx) 通过 `.roll-progression-preview` 渲染待填槽位高亮（`.roll-progression-slot`）与只读幽灵音符（`.roll-progression-note`）；开启写入和弦时，[`ChordTrack.tsx`](../src/features/editor/layers/ChordTrack.tsx) 同步通过 `.chord-progression-preview` 渲染幽灵和弦区段。
  - 采纳候选后单次提交历史并将播放头推进到 `nextCursorTick`。控制器通过 `WeakMap<ProjectDocument, { before: WeakRef<ProjectDocument>; fromTick: number; toTick: number }>` 将游标迁移绑定到本次提交前后的精确工程快照上，使撤销/重做能同步还原或重放推进位置，同时不干扰普通编辑与手动导航。

## 11. 全局通知栈、日志页签与崩溃恢复

跨进程日志架构与排错包规范详见 [logging-and-observability.md](./logging-and-observability.md)；界面侧由三组组件承接反馈、诊断观测与崩溃兜底：

- **全局通知栈（[`AppNoticeStack.tsx`](../src/components/AppNoticeStack.tsx)）**：`useAppNotices` 维护最多 3 条同时显示的通知，按级别优先级（`error` 8s > `warn` 5s > `info`/`success` 3.5s）与新旧顺序排序；为避免原生 `<dialog showModal()>` 顶层遮挡通知，`AppShell` 在打开 `ChordInferenceDialog` 或 `AutoHarmonizationDialog` 时将 `noticeStack` 透传到弹窗内部渲染。`warn` 与 `error` 级别通知附带「查看日志」按钮，点击后自动展开底部面板切换到 `logs` 页签，并按 `logEntryId` 定位高亮对应条目。
- **日志页签与标题栏错误入口**：[`LogsPanel.tsx`](../src/features/diagnostics/LogsPanel.tsx) 汇总渲染进程与主进程近期日志、支持按级别/进程/模块筛选与导出排错包；[`useSessionLogErrors.ts`](../src/features/diagnostics/useSessionLogErrors.ts) 订阅会话错误并计算未读错误数。当会话已产生错误且底部面板处于折叠状态时，`AppShell` 标题栏自动出现「查看日志」快捷按钮（`.titlebar-log-link`）提示未读错误数。
- **崩溃边界与紧急备份（[`AppErrorBoundary.tsx`](../src/components/AppErrorBoundary.tsx)）**：捕获 React 渲染崩溃并写入 `RENDER_CRASH` fatal 日志；`AppShell` 在 `useLayoutEffect` 中通过 `registerEmergencyProjectProvider` 持续注册最新已提交工程快照，即使崩溃卸载主界面，恢复页仍可提供「重新加载界面」「复制错误信息」「导出当前工程备份（.satb）」与「导出排错包」操作。

## 12. 快捷键注册表

[`src/shortcuts/shortcutRegistry.ts`](../src/shortcuts/shortcutRegistry.ts) 是命令 ID、默认绑定、分组和是否允许重复的唯一来源。设置页和执行逻辑应从注册表生成，文档不维护一份容易漂移的完整副本。

常用默认值：

| 类别 | 默认绑定 |
| --- | --- |
| 工程 | Ctrl+N、Ctrl+O、Ctrl+S、Ctrl+Shift+S、`F5`（`runRuleTest`） |
| 历史 | Ctrl+Z、Ctrl+Shift+Z 或 Ctrl+Y |
| 剪贴板 | Ctrl+A/C/X/V/D，Delete/Backspace |
| 变换 | Q，方向键，Shift+上/下 |
| 工具 | 1/2/3/4，Tab、Shift+Tab |
| 播放 | Space、Home、End、PageUp、PageDown |
| 视图 | `[`、`]`、Ctrl+-、Ctrl+=，以及 Ctrl+滚轮 |

事件匹配使用物理 `KeyboardEvent.code`，使字母快捷键不受输入法字符影响。[`useKeyboardController.ts`](../src/app/controllers/useKeyboardController.ts) 通过两层门控防止快捷键误触发：

- **作用域 `enabled` 门控**：在主工作区中，`AppShell` 传入 `enabled: !ruleTestMode && !auditOpen && !autoHarmonizationOpen`，进入规则测试工作台、教材审计工作台或打开自动和声弹窗时自动禁用主编辑器快捷键（工作台或弹窗各自管理局部快捷键）。
- **焦点与弹窗过滤**：当确认框/设置弹窗打开、处于输入法组合态（`event.isComposing`），或事件目标位于 `input, textarea, select, [contenteditable="true"]` 及 `[role="dialog"]` 内部时直接放行；全局 `preventDefault()` 前先确认命令实际匹配。

新增快捷键时：

1. 在联合类型中新增稳定命令 ID。
2. 在 `SHORTCUT_DEFINITIONS` 中添加分组、标签、默认绑定和 repeat 策略。
3. 在 hook/App 命令分发中接入行为。
4. 处理输入控件焦点、修饰键临时工具和浏览器默认动作。
5. 添加注册表/行为测试并检查设置页展示。

## 13. 开发者模式

设置中可启用开发者模式。右侧 Inspector 会为当前选中的音符或和弦事件展示数据模型已有的全部属性，用于检查：

- 书写音高是否保留。
- identity 与 semantics 是否按预期解析。
- `identity.structure`、全部 interpretations、designation、目标、pedal 和 voicing policy 是否完整。
- MIDI 导入来源、非和弦音角色和锁定字段。
- 拖拽/迁移后 tick、duration 和 ID 是否稳定。

开发者模式是只读观测工具，不应提供绕过 validator 的通用 JSON 编辑器。新增模型字段时，优先让通用属性遍历自然显示；特殊格式化不能隐藏原始值。

## 14. 编辑功能变更检查表

- 操作是否由领域命令验证，而不只是 UI 限制？
- 单项和批量是否共享相同不变量，批量是否只有一次历史提交？
- 锁定区、工程边界、SATB 重叠和辅助轨例外是否覆盖？
- 拖拽预览失败时能否完整回滚视觉状态？
- 是否使用统一的 tick/像素和 MIDI/y 坐标转换？
- 长工程高缩放下是否只处理可见范围？
- 快捷键是否避开输入控件并正确处理 key repeat？
- 成功编辑后 revision、dirty、自动恢复和规则检查是否只更新一次？
