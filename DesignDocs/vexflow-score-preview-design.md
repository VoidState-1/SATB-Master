# 基于 VexFlow 的五线谱预览设计

状态：第一阶段实现依据（VexFlow SVG 只读预览已接入）

目标版本：P1，第一阶段提供只读的 SATB 钢琴大谱表预览

关联文档：[architecture.md](../Docs/architecture.md)、[data-model.md](../Docs/data-model.md)、[editor-and-state.md](../Docs/editor-and-state.md)、[audio-midi-and-time.md](../Docs/audio-midi-and-time.md)

## 1. 背景与定位

SATB Master 当前以钢琴卷帘作为主要编辑界面。工程已经保存了书写音高、音符时值、调号、拍号和四个固定 SATB 声部，这些数据足以生成基础五线谱，但工程模型没有也不应增加一套“乐谱专用音符”。

本功能从当前 ProjectDocument 和 revision 生成一个只读的五线谱投影，使用 VexFlow 绘制固定的钢琴大谱表，帮助用户查看和核对四部和声的传统记谱形态。

钢琴卷帘仍然是唯一编辑入口和事实源。五线谱中的音符只是投影，不反向写入工程，也不承担和弦、规则或编辑命令的实现职责。

## 2. 目标与非目标

### 2.1 第一阶段目标

1. 显示一个高音谱表和一个低音谱表组成的钢琴大谱表。
2. 高音谱表固定承载女高音和女低音，低音谱表固定承载男高音和低音。
3. 声部分配只依据 VoiceId，绝不根据当前 MIDI 音高动态换谱表。
4. 保留 SpelledPitch 的字母、升降号和八度信息；超出常规音域时使用加线，不自动移调或改写八度。
5. 使用 buildMeasures、keyAtTick、pitch.ts 等现有领域能力解释小节、拍号、调号和书写音高。
6. 支持声部空拍、跨小节持续音、常见二进制和附点时值，并为跨小节音符生成展示层延音线。
7. 预览打开、滚动、缩放和重绘不改变 ProjectDocument、历史、dirty 状态或 revision。
8. 在节奏无法精确转换、数据异常或存在未显示轨道时向用户给出明确提示，而不是静默修正工程。

### 2.2 第一阶段不做

- 不在五线谱上新增、删除、拖动、切分、改音高或改时值。
- 不把五线谱作为第二编辑器，不复制一套可写的 NoteEvent 或 ScoreDocument。
- 不按音高在高、低音谱表之间重新分配声部，不自动八度移位、不自动重配和弦。
- 不把辅助轨绘制到钢琴大谱表；辅助轨仍由钢琴卷帘、播放和 MIDI 导出处理。
- 不在首版把和弦标签、终止式、诊断颜色或规则结论直接画进五线谱；首版保留 ID 和 tick 映射，为后续只读叠加层留接口。
- 不实现谱面编辑、打印排版、MusicXML 导出、分谱生成、连音三连音等完整制谱功能。

## 3. 用户流程与只读边界

### 3.1 入口

主工作区工具栏增加“打开五线谱预览”命令。第一阶段采用独立的 ScorePreviewDialog（或等价的只读覆盖工作区），不替换 PianoRoll，也不改变左右面板的编辑布局。预览关闭后回到原来的编辑状态。

预览窗口只提供关闭、垂直/水平滚动、明确的谱面缩放控制，以及可选的“跟随播放头”开关。窗口不显示铅笔、擦除、切分等编辑工具，不注册会改变工程的鼠标或键盘命令，不提供右键编辑菜单。

可以允许用户点击谱面音符进行定位，但该操作只能产生会话级导航：

    谱面音符 -> sourceNoteId / voiceId / tick
              -> 选择 PianoRoll 中的对应音符并移动播放头

导航不得调用 addNote、updateNote、moveNotes 等领域编辑命令。双击、拖拽和按住修饰键均不改变音符；首版也可以直接禁用这些事件。

### 3.2 Revision 与生命周期

预览打开期间如果当前工程 revision 变化，旧谱面立即视为过期，使用新的 ProjectDocument 重新生成派生模型。异步加载 VexFlow 或渲染完成的旧结果不能覆盖新 revision。关闭预览时释放 SVG、事件监听器和临时索引。

## 4. 总体架构

    ProjectDocument + revision
            |
            v
    buildScorePreviewModel()       // 纯函数，只读投影
            |
            v
    GrandStaffScoreModel            // 小节、谱表、四个声部、节奏片段、告警
            |
            v
    VexFlow renderer adapter        // 仅位于 renderer/feature 层
            |
            v
    ScorePreviewDialog -> SVG

VexFlow 不得进入 src/domain。领域层只负责把工程事实转换为与具体制谱库无关的记谱模型；React feature 负责生命周期、视口和 VexFlow API 适配。工程 schema 不增加 score、staves 或 VexFlow 对象字段。

建议的文件边界：

    src/domain/notation/types.ts
    src/domain/notation/buildScorePreviewModel.ts
    src/domain/notation/rhythm.ts
    src/domain/notation/index.ts
    src/features/scorePreview/ScorePreviewDialog.tsx
    src/features/scorePreview/vexflowRenderer.ts
    src/features/scorePreview/scorePreview.css
    src/features/scorePreview/index.ts

VexFlow 作为 renderer 依赖加入并锁定具体版本。因为预览不是启动必需功能，建议在打开预览时动态加载 VexFlow；加载失败只显示预览错误，不得影响钢琴卷帘、音频或规则检查。

## 5. 记谱投影模型

投影模型必须保留源对象引用和 tick，便于定位与测试，但不提供写回方法：

    type ScoreStaff = "treble" | "bass";

    interface ScoreVoiceLayout {
      voiceId: VoiceId;
      staff: ScoreStaff;
      stemDirection: "up" | "down";
    }

    interface ScorePreviewModel {
      revision: number;
      measures: readonly ScoreMeasure[];
      warnings: readonly ScorePreviewWarning[];
      omittedAuxiliaryTrackCount: number;
      omittedAuxiliaryNoteCount: number;
    }

    interface ScoreMeasure {
      number: number;
      fromTick: number;
      toTick: number;
      numerator: number;
      denominator: number;
      key: KeyEvent;
      voices: Readonly<Record<VoiceId, ScoreVoice>>;
    }

    interface ScoreVoice {
      voiceId: VoiceId;
      events: readonly ScoreEvent[];
      totalTicks: number;
    }

    type ScoreEvent = ScoreNoteEvent | ScoreRestEvent;

    interface ScoreNoteEvent {
      kind: "note";
      sourceNoteId: string;
      fromTick: number;
      toTick: number;
      pitch: SpelledPitch;
      tieFromPrevious: boolean;
      tieToNext: boolean;
      duration: NotationDuration;
    }

    interface ScoreRestEvent {
      kind: "rest";
      fromTick: number;
      toTick: number;
      duration: NotationDuration;
    }

ScoreMeasure 由 buildMeasures(project) 得到的工程小节构成，不重新计算固定的 4/4 网格。ScoreVoice.events 只包含该声部在本小节内的音符片段和填充休止；事件总时值必须等于小节时值，供 VexFlow 的严格 Voice 对齐。

ScorePreviewWarning 至少包括 unsupported-rhythm、invalid-overlap、unsupported-key、omitted-auxiliary 和 render-error，并携带 tick、声部、源音符 ID（如果有）以及可展示的中文说明。

## 6. 固定钢琴大谱表分配

固定映射是首版核心契约：

| VoiceId | 谱表 | 默认符干 | 说明 |
| --- | --- | --- | --- |
| soprano | 高音谱表 treble | 向上 | 始终作为高音谱表第一声部 |
| alto | 高音谱表 treble | 向下 | 始终作为高音谱表第二声部 |
| tenor | 低音谱表 bass | 向上 | 始终作为低音谱表第一声部 |
| bass | 低音谱表 bass | 向下 | 始终作为低音谱表第二声部 |

实现中使用一个不可变的 SCORE_VOICE_LAYOUT 常量，所有模型、渲染和测试都从它读取。不得写成“按照音符 MIDI 值选择谱表”的辅助函数。

音符即使落在另一谱表更自然的音域内，也留在其所属声部的固定谱表中。只使用加线表达极高或极低音；不添加八度记号，不把男高音移到高音谱表，也不把女低音移到低音谱表。这样用户看到的谱面与四部声部身份一致，规则和编辑器也不需要处理动态换谱表造成的歧义。

每个谱表包含两个独立的 VexFlow Voice。高音谱表和低音谱表各自使用同一小节的拍号和 tick 总量，四个声部在同一个 system 中保持垂直对齐。符干方向固定为上表策略；首版不引入根据碰撞动态翻转符干的规则。

## 7. 时间、节奏和调号转换

### 7.1 小节与拍号

1. 调用 buildMeasures(project) 获取小节号、起止 tick、分子、分母和拍点。
2. 调用 keyAtTick(project.keyEvents, measure.startTick) 获取小节初始调号。
3. 不使用 tick / (PPQ * 4) 推导小节，也不在预览层复制变拍号算法。
4. 变拍号事件导致 buildMeasures 切出新的小节；每个 VexFlow 小节使用该小节自己的 num_beats / beat_value。

如果调号事件位于小节内部，投影层在该 tick 建立 notation segment，并在 segment 起点插入调号变化；若当前 VexFlow 版本无法稳定绘制小节内调号，则使用显式临时记号并产生 unsupported-key 警告。不能移动调号事件或修改工程来迎合渲染器。

### 7.2 音符片段、休止与跨小节音

对每个固定声部单独处理：

1. 找到与当前小节相交的 NoteEvent。
2. 将跨越小节线的音符切成小节范围内的片段。
3. 片段保留同一个 sourceNoteId；前后片段分别设置 tieFromPrevious / tieToNext，由 renderer 创建展示层 StaveTie。
4. 相邻音符之间的空白用休止补齐；小节完全无音符时生成完整小节休止。
5. SATB 工程正常情况下同一声部不会重叠。若防御性检查发现重叠，保留源工程不变，标记 invalid-overlap，该声部的冲突片段不进入可编辑或可写回的谱面对象。

投影产生的切片和延音线是临时记谱事实，不写回 NoteEvent，也不伪装成工程中的 tie 字段。当前 NoteEvent 没有显式连音线字段，因此跨小节 tie 只表示“同一个源音符被分段绘制”。

### 7.3 可表示时值

VexFlow 的 Voice 需要离散的记谱时值。第一阶段采用保守的精确策略：

- 支持二进制音符时值和附点时值，最小单位为 64 分音符，即 ppq / 16 tick；当前 PPQ=960 时为 60 tick。
- 一个片段可以拆解为多个相邻的合法时值，必要时使用同源 tie 连接。
- 不支持三连音、复杂连音和不能被 64 分音符单位精确表示的余数。
- 不使用最近网格或四舍五入替换实际时值。

无法精确表达的片段返回 unsupported-rhythm。首版默认不绘制一个错误时值的音符；预览顶部显示数量、声部、tick 和源音符 ID，用户可回到钢琴卷帘查看原始事件。未来如增加 tuplets 或近似显示，必须作为显式选项并在谱面上标记“近似”，不能改变默认语义。

### 7.4 书写音高与临时记号

音符 key 由 SpelledPitch.step 和 SpelledPitch.octave 直接生成，音高显示不从 MIDI 数字反推。alter=-2/-1/0/1/2 映射为重降、降、自然、升、重升等 VexFlow accidental。

调号使用 pitch.ts 的 keySignatureFifths 计算，临时记号状态按“声部 + 小节/notation segment”维护：

- 与当前调号一致的升降号不重复绘制，除非同一小节内发生需要取消或改变的记号。
- 发生自然还原、升降号改变或双升/双降时绘制明确的临时记号。
- 等音拼写只由工程已有的 SpelledPitch 决定；C# 与 Db 不得在渲染阶段合并。

如果调号不受 pitch.ts 支持，保留音符书写信息，使用无调号加显式临时记号的防御性渲染并记录警告；不得静默改成另一个调号。

## 8. VexFlow 渲染策略

### 8.1 后端与布局

首选 VexFlow SVG backend：缩放时保持矢量清晰；可以为音符元素附加 data-source-note-id、data-voice-id 和 tick，支持只读定位；不把一个无限宽 Canvas 位图塞进 DOM。

一个 system 包含大括号、一个高音谱表、一个低音谱表、两条谱表的拍号/调号和共享小节线。每个 system 按固定最小宽度和可计算的节奏密度排版，必要时在小节边界换行。小节宽度必须由实际 tick/记谱事件数量决定，并设置最小值，不能因标签或告警导致布局跳动。

推荐渲染顺序：

    构造当前 revision 的 ScorePreviewModel
    -> 按 system 切分可见小节
    -> 为每个 system 创建 treble/bass Stave
    -> 创建 soprano/alto/tenor/bass 四个 Voice
    -> 生成 StaveNote、Rest、Accidental、Beam、StaveTie
    -> Formatter 对齐同一 system 的四个声部
    -> 写入 SVG 并绑定只读导航

VexFlow 对象属于 renderer 临时资源，不能放进 React state 或 ProjectDocument。effect 清理时销毁或移除对应 SVG 节点，避免 revision 多次更新后重复叠加。

### 8.2 播放头与 system 定位

预览不建立第二套播放时钟。若实现播放头显示，使用现有 playheadTick，通过 buildMeasures 和 system 索引定位到当前小节；动画时间仍由音频层和 time.ts 提供。预览关闭、暂停或切换 revision 时应停止其跟随动画。

PianoRoll 与五线谱可以各自滚动，但 tick 到小节/system 的映射必须来自同一套 buildMeasures 结果。首版不要求两个视图共享 scrollLeft，避免引入第二套滚动状态；点击定位或播放头跟随属于单向会话同步。

## 9. 错误、降级与可观测性

预览是可选的 UI 适配器，任何渲染失败都不能破坏编辑或和声检查：

- VexFlow 动态加载失败：显示“乐谱预览不可用”和错误详情，保留主工作区。
- 空工程或空声部：正常显示大谱表和休止，不视为错误。
- 辅助轨存在：不绘制，显示省略的轨道数/音符数；不把辅助音符混入四部声部。
- 非法重叠或越界数据：生成结构化 warning，并跳过无法安全记谱的片段；不修改工程。
- 不可精确表达的节奏：显示 unsupported-rhythm 数量和源定位，不使用无提示的近似时值。
- 调号/拍号异常：优先使用领域层已经验证的值，渲染器无法处理时返回明确警告。

必要时在开发者模式中显示当前 preview revision、已绘制小节、跳过片段、VexFlow 版本和渲染耗时。该信息是只读观测，不成为工程字段。

## 10. 性能与缓存

长工程的逻辑小节数量可以很大，但不应一次创建一个巨大 SVG 或为每个滚动像素重建全部 VexFlow 对象：

1. buildScorePreviewModel 以 project/revision 为输入，用 useMemo 或等价缓存复用未变化的派生模型。
2. 按 system 组织 DOM，视口只渲染当前可见 system 加少量 overscan；布局索引仍覆盖全工程，保证滚动位置稳定。
3. 滚动和缩放是预览会话状态，不提交工程历史；滚动事件使用 requestAnimationFrame 合并。
4. 不在 pointermove 中重建 ProjectDocument、HarmonyAnalysis 或全部 SVG。
5. VexFlow 加载、模型构造和渲染均带当前 revision；旧任务完成后必须丢弃。

首版可以先实现完整 system 渲染，再根据长工程基准切换为可见 system 渲染，但接口不能假设只有一个 SVG 或一次性布局所有像素。预览缩放使用显式离散档位，不用 viewport 宽度连续缩放字体。

## 11. 实施步骤

1. 引入并锁定 VexFlow 依赖，验证 Vite 和 Electron renderer 均可动态加载 SVG backend。
2. 建立 src/domain/notation 的纯类型、固定声部分配、时值分解、休止填充、跨小节切片和调号/临时记号策略。
3. 为纯投影添加单元测试，确保输入工程深度不变、输出确定且保留源 ID。
4. 实现 vexflowRenderer，先支持单个 system，再加入多 system 排版、清理和 warning 汇总。
5. 实现 ScorePreviewDialog 和 AppShell 工具栏入口；只接收 project、revision、playheadTick 与可选导航回调。
6. 接入只读导航和播放头定位；不把任何谱面事件接入编辑命令。
7. 增加桌面开发模式、浏览器预览和生产构建验证，确认预览失败不会影响主编辑器。
8. 根据长工程和复杂拍号 fixture 决定是否在第一版启用 system 虚拟化；不为性能问题修改工程坐标模型。

## 12. 测试与验收

### 12.1 领域模型测试

- 固定映射：S/A 永远属于 treble，T/B 永远属于 bass；人为设置极端 MIDI 音高也不能换谱表。
- 符干策略：S/T 向上，A/B 向下，输出稳定。
- 4/4、3/4、6/8 和变拍号工程按 buildMeasures 生成正确小节和拍号。
- 休止填充后每个声部每小节的总 tick 等于小节长度。
- 跨小节音符被正确分段，保留同一 sourceNoteId 并设置 tie 标志。
- C#、Db、重升、重降和调号变化保留书写拼写，不通过 MIDI 反推。
- 可精确表示的二进制/附点时值正确转换；不可表示的时值返回 warning，不发生静默四舍五入。
- 输入 ProjectDocument、历史帧和音符对象没有被修改；相同 revision 重复生成结果一致。

### 12.2 Renderer/UI 测试

- 每个 system 生成一对 treble/bass stave 和四个独立声部，SVG 非空且小节线对齐。
- 打开、关闭、revision 更新、滚动和缩放不会重复挂载 SVG 或泄漏事件。
- 预览中没有新增/移动/删除/切分回调；点击音符最多触发选择/定位，不产生历史 revision。
- VexFlow 加载失败、异常节奏和辅助轨省略时，PianoRoll、规则诊断和音频仍可继续工作。
- 桌面 Electron 与浏览器 Vite 预览均通过 typecheck/build；桌面流程补充打开预览、编辑后刷新、播放头跟随和关闭恢复焦点的手工或 E2E 检查。

### 12.3 验收标准

1. 用户可以从主工作区打开只读钢琴大谱表。
2. 高音谱表始终显示女高音和女低音，低音谱表始终显示男高音和低音，任何音高都不会触发动态换谱表。
3. 五线谱上的任何操作都不会改变工程内容；编辑仍只能在钢琴卷帘/Inspector 中完成。
4. 变拍号、调号、书写升降号、休止和跨小节音符的显示与工程时间轴一致。
5. 无法精确记谱的事件不会被无提示地改写，用户能看到 warning 并返回原编辑位置。
6. 预览异常不会清空或覆盖内置和声诊断，也不会中断播放和保存流程。

## 13. 后续扩展边界

后续可以在不改变本设计核心契约的前提下增加和弦标签、终止式和诊断证据的只读叠加；选择音符后在谱面和钢琴卷帘之间双向定位；tuplets、复杂附点、连音和更完整的节奏分解；打印/导出图片或 MusicXML；以及独奏声部、隐藏声部和谱面专用显示偏好。

这些扩展都不能改变“ProjectDocument 是唯一事实源”和“VoiceId 固定决定谱表”的约束。若将来真的需要跨谱表记谱，应另起设计评审，不在本功能中悄然引入按音高动态分配。
