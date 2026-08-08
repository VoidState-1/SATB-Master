# 工程数据模型

本文描述 `.satb` 工程的持久化模型、音乐实体和必须维护的不变量。编辑行为见 [editor-and-state.md](./editor-and-state.md)，和声解释见 [harmony-engine.md](./harmony-engine.md)。类型定义和运行时验证以 [`src/domain/project/`](../src/domain/project) 为准；`model.ts` 仅为兼容转发。

## 1. 版本与时间基准

当前核心常量：

```ts
export const PROJECT_SCHEMA_VERSION = 3;
export const PPQ = 960;
```

- `schemaVersion` 决定持久化结构兼容性。
- `ppq` 固定为每四分音符 960 tick，当前 validator 不接受其他值。
- 所有事件位置和时值都以整数 tick 保存。
- UI 可以按小节、拍或音符时值显示，但不能把显示单位直接写回为另一套时间基准。

产品版本、schema 版本和外置规则 API 版本彼此独立。修改数据结构时只提升产品版本是不够的。

## 2. `ProjectDocument` 总览

`ProjectDocument` 是工程保存、历史记录、恢复和分析的共同根对象。可按以下结构理解：

```text
ProjectDocument
  schemaVersion / id / title / author / notes
  createdAt / updatedAt / ppq / lengthTicks
  tempoEvents[] / meterEvents[] / keyEvents[]
  satbTracks[4]
    notes[]
  auxiliaryTracks[]
    notes[]
  chordTrack
    regions[]
  loop
  ruleProfile
  exercise.editableRanges[]
  audio.soundFont
```

完整字段见 [`ProjectDocument`](../src/domain/project/types.ts)。新增持久字段时必须同步：

1. TypeScript 类型。
2. 默认工程创建。
3. 运行时 validator/normalizer。
4. schema 迁移或明确拒绝旧数据。
5. 工程保存/恢复测试。
6. 开发者属性检查器，如该字段需要可见。

不要把 AudioNode、DOM 对象、函数、Worker、文件句柄或其他不可 JSON 序列化对象放入工程。

## 3. 音高表示

V3 使用书写音高，而不是只保存 MIDI 数字：

```ts
interface SpelledPitch {
  step: "C" | "D" | "E" | "F" | "G" | "A" | "B";
  alter: -2 | -1 | 0 | 1 | 2;
  octave: number;
}
```

三个字段分别表示字母音名、重降到重升的变化记号、科学音高记谱的八度。MIDI 音高可由它们计算，但反向转换不是唯一的：`C#4` 和 `Db4` 在十二平均律中同音，却有不同的调性与音程含义。

保留拼写是以下规则成立的前提：

- 对斜需要比较“同字母、不同升降号”。
- 增减音程需要同时使用字母距离和半音距离。
- 导音、和弦构成音与调内音级依赖调号语境。
- 自动和声或谱面显示需要知道实际记谱，而不只是琴键位置。

维护原则：

- 音频和钢琴卷帘纵坐标可以使用计算后的 MIDI 值。
- 规则和谱面不得只凭 MIDI 值重建拼写。
- 移调操作必须明确是半音移调、按音级移调还是保留字母的升降号修改。
- 无法唯一推导时应保留已有拼写或标记歧义，不应静默改为偏好的升号/降号。

音高转换和音程辅助函数集中在 [`src/domain/pitch.ts`](../src/domain/pitch.ts)。

## 4. 音符与轨道

`NoteEvent` 除 ID、位置、时值和书写音高外，还可以包含锁定、人工非和弦音角色与 MIDI 导入来源等属性。以后添加奏法、力度或声部来源时，应先判断它是音符事实、分析结果还是临时 UI 状态。

### 4.1 SATB 轨

`satbTracks` 固定包含：

```text
soprano -> alto -> tenor -> bass
```

每条 `SatbTrack`：

- 对应一个固定 `VoiceId`。
- `monophonic` 为真，同一时刻不能出现重叠音符。
- 参与内置和外置和声分析。
- 具有建议音域，但完整钢琴卷帘仍显示 MIDI 0-127，超出建议音域由规则报告。

数组顺序和 `VOICE_ORDER` 同时影响显示、相邻声部判断和规则输出。不要通过随意排序来改变界面顺序。

### 4.2 辅助轨

`auxiliaryTracks` 面向 MIDI 导入失败音符和非 SATB 素材：

- 可以有任意字符串 ID。
- 允许同一范围内多个音符重叠。
- 不参与 SATB 和声规则判断。
- 可以参与播放和 MIDI 导出。
- 外置规则只得到受限的 `auxiliarySummary`，而不是完整辅助音符明细。

“不参与和声判断”是模型边界，不只是 UI 默认。若未来规则需要读取辅助材料，应新增经过审查的摘要字段，不要直接把完整辅助轨注入外置沙箱。

### 4.3 音符范围

所有音符必须满足：

- `startTick >= 0`。
- `durationTicks > 0`。
- `startTick + durationTicks <= project.lengthTicks`。
- 书写音高可转换到 MIDI 0-127。
- 所属轨存在，ID 在工程内满足预期唯一性。
- SATB 同轨不重叠；辅助轨可以重叠。

当缩短工程总长度时，不能让现有事件静默落在工程之外。调整长度的命令需要明确拒绝、裁剪或迁移策略。

## 5. 全局时间事件

工程包含三类有序事件：

| 类型 | 核心字段 | 影响 |
| --- | --- | --- |
| `TempoEvent` | tick、BPM | tick 与秒的换算、播放、MIDI tempo |
| `MeterEvent` | tick、分子、分母 | 小节边界、刻度、节拍器、工程“小节数”显示 |
| `KeyEvent` | tick、主音、调式 | 拼写、和弦解析、规则语境、MIDI key signature |

事件列表需要按 tick 排序，同一类型在同一 tick 不应存在互相竞争的多个值。工程起点需要有可解释的初始事件；默认工程创建和 validator 负责提供或拒绝缺失状态。

变拍号意味着“总小节数”不是简单的 `lengthTicks / 固定每小节 tick`。任何小节计算都必须调用 [`src/domain/time.ts`](../src/domain/time.ts) 的 `buildMeasures`、`ticksForMeasures` 等函数。

## 6. 和弦区域

`ChordTrack` 保存范围型 `ChordRegion`，不是零长度位置标记。每个区域有开始 tick 和持续时间，并将持久信息拆成两个层次：

```text
ChordRegion
  identity   和弦客观构成
  semantics  语境、功能用途和人工解释
```

### 6.1 `ChordIdentity`

`ChordIdentity` 表示可由根音、结构和低音推导的和弦实体。`structure` 是 `tertian | augmented-sixth` 判别联合：普通三度叠置结构保存性质、扩展与构成音变化；意/法/德增六保存独立 variant。它回答“由哪些音构成”和“低音应是什么”，而不是“在当前语句里扮演什么角色”。

构成音变化可以显式声明横向解决方向：

```ts
interface ChordToneAlteration {
  degree: 5 | 9 | 11 | 13;
  alter: -2 | -1 | 0 | 1 | 2;
  tendency?: "up" | "down";
}
```

`alter` 决定实体拼写，`tendency` 是人工确认的语义证据。两者不能互相替代：旧 V3 数据可以没有 `tendency`，此时方向性规则必须跳过，不能仅凭升降号猜测。调色盘创建 `♭5/♯5/♭9/♯9` 时会写入默认方向，Inspector 允许明确修改或清除。

### 6.2 `HarmonySemantics`

`HarmonySemantics` 保存一个或两个 `HarmonyInterpretation`，并用 `primaryInterpretationId` 指定主要解释。单项解释包含局部调性、级数、变化音、结构化目标、斯波索宾 `FunctionalDesignation`、来源和置信度；外层保存借用、终止/四六角色和持续低音上下文。`cadenceRole: deceptive` 表示人工确认当前和弦是阻碍进行起点；普通 `D -> VI` 不会仅凭局部连接自动获得该角色。共同和弦的两个确认解释必须都能解析为同一实体，不能只复制不同 ID。

代码中避免再使用宽泛的 `FunctionalAnalysis` 名称：中文“功能”既可能指 T/S/D，又可能泛指用途。当前约定是：

- `identity`：和弦实体。
- `semantics`：和声语义。
- `FunctionalDesignation`：斯波索宾 T/S/D 功能标记及主次亲缘。

规则引擎直接读取精确解释、功能标记和结构化目标，不再保存或计算 `FunctionalClass` 粗粒度兼容分类。需要判断 T/S/D 家族时，应从当前 `HarmonyInterpretation` 的 designation 或级数证据得出，并保留歧义状态。

### 6.3 `ChordDraft`

和弦调色板编辑期间使用 `ChordDraft`。草稿可以暂时不完整，但只有成功解析和验证后才能变成持久化区域。不要把输入框文案或当前选项卡状态直接保存为和弦事实。

### 6.4 和弦区域不变量

- 区域持续时间必须大于零并位于工程内。
- 和弦区域之间不能重叠。
- 区域不能跨越调号事件；调性变化点必须切分区域。
- 区域移动、调号改变或草稿提交后要重新解析 identity/semantics。
- 每个确认解释都必须与同一 identity、低音和转位一致；重复事实或冲突解释会被拒绝。
- `K46` 固定第二转位，`N6` 固定第一转位，`D9` 与增六和弦固定原位。
- 显示名称由模型推导；除专门的人工语义字段外，不保存可与模型矛盾的自由文本名称。

和弦类型和推导逻辑位于 [`src/domain/chordModel.ts`](../src/domain/chordModel.ts)，功能词汇位于 [`src/domain/functionalHarmonyCatalog.ts`](../src/domain/functionalHarmonyCatalog.ts)，命令约束位于 [`src/domain/editing.ts`](../src/domain/editing.ts)。完整说明见 [functional-harmony.md](./functional-harmony.md)。

## 7. 循环、练习锁定和规则配置

### 7.1 循环

`loop` 保存启用状态、起点和终点，属于工程内容，因此随 `.satb` 保存和恢复。循环必须满足：

```text
0 <= startTick < endTick <= lengthTicks
```

播放状态中的临时 playhead 不属于工程；循环范围属于工程。不要把两者混入同一会话对象。

### 7.2 练习可编辑范围

`exercise.editableRanges` 定义允许编辑的时间区间。音符或和弦自身也可以锁定。锁定的最终判断在命令层执行，必须覆盖：

- 新增、删除、移动和调整时值。
- 批量剪切、粘贴、移调和删除。
- 操作前后范围是否穿越锁定边界。

仅禁用按钮或命中测试不能保护来自快捷键、粘贴或未来 API 的编辑。

### 7.3 `ruleProfile`

规则配置是完整工程数据：

```ts
interface RuleProfile {
  profileVersion: 1;
  title: string;
  shared: SharedHarmonySettings;
  builtin: Record<string, RuleInstanceSettings>;
  external: ExternalRuleReferenceV3[];
}
```

`shared` 保存四声部建议音域和严格四声部织体开关。每个内置规则实例保存严重程度、`configVersion`、声明式配置和特例策略。严重程度为：

```text
error | warning | suggestion | off
```

`off` 表示不调度该规则，而不是产生一个隐藏诊断。外置规则引用只保存包 ID、版本、内容哈希、规则 ID、启用状态、严重程度和 JSON 配置；脚本正文保存在本机规则库。

外置 v3 引用还保存 `configVersion` 和特例策略。运行时同时尊重旧字段 `enabled` 与严重程度；便携 `.satb-rule-profile.json` 不重复保存 `enabled`，而用 `severity: "off"` 表达禁用。缺失的外置包引用必须保留，以便安装相同 hash 后恢复。

设置修改通过工程历史命令提交，因此随 `.satb` 保存、可撤销/重做，也不会被另一台机器的应用偏好静默覆盖。localStorage 只可保存“新建工程默认模板”。配置档案导入会规范化已知 schema、报告修复与未知 ID，并以一次历史提交替换当前 profile。

## 8. 音频引用

工程的 `audio.soundFont` 保存可持久化的音色选择。运行时加载状态、AudioContext、合成器实例和临时资源 token 不属于工程。

本地 SoundFont 可能在另一台机器不存在。打开工程时应保留用户选择的引用和明确的缺失状态，不能因为播放按钮初始化音频而静默回退并覆盖工程选择。默认音色是可用性回退，不是用户引用的替代值。

## 9. 验证、规范化与迁移

不可信 JSON 不能通过 TypeScript 类型断言直接成为工程。打开、恢复和 IPC 边界必须调用 [`project/validation.ts`](../src/domain/project/validation.ts) 与 [`project/normalize.ts`](../src/domain/project/normalize.ts) 中的运行时解析/规范化逻辑。

当前迁移策略：

```text
schema v2 --支持迁移--> schema v3
schema v1 --明确拒绝-->
schema v3 --直接验证-->
```

原因是 v1 从未形成需要保留的公开工程文件，而 v3 尚处于大版本开发阶段。不要凭空添加“尽量兼容”的猜测性迁移；错误迁移比明确拒绝更容易损坏音乐语义。

桌面端第一次用 v3 覆盖 v2 原文件前，会创建 `.schema-v2-backup.satb` 备份。迁移函数应保持纯粹，文件备份属于主进程持久化职责。

升级 schema 时：

1. 记录旧结构与新结构的准确差异。
2. 对每个字段给出确定的转换或拒绝条件。
3. 保留事件 ID、时间和可恢复的书写信息。
4. 为正常、边界和畸形输入添加测试。
5. 更新工程备份命名和桌面提示（如需要）。
6. 更新本文及 [desktop-and-persistence.md](./desktop-and-persistence.md)。

## 10. 模型变更反例

以下做法会破坏现有边界：

- 只保存 MIDI 数字并在规则运行时猜测升降号。
- 在和弦区域保存 UI 已渲染的罗马数字字符串作为唯一事实。
- 为解决拖拽预览而直接修改历史帧中的音符对象。
- 把外置规则源码嵌入每个工程，绕过内容哈希和本机安装状态。
- 将临时 playhead 或打开的弹窗写入 `ProjectDocument`。
- 把 SATB 与辅助轨统一设为“允许重叠”，再依赖检查器报错。
- 变拍号工程中用固定 `PPQ * 4` 推导所有小节。

## 11. 数据模型变更检查表

- 字段是音乐事实、用户配置、分析缓存还是 UI 临时状态？
- 是否可 JSON 序列化，是否有确定默认值？
- validator 是否拒绝 NaN、越界、重复 ID、未排序和非法引用？
- 旧 schema 如何迁移，无法确定时是否明确拒绝？
- 编辑命令是否维护新不变量？
- 和声快照、外置规则上下文、MIDI 和音频是否需要该字段？
- 保存、恢复、撤销、开发者检查器和测试是否同步？
- `Docs` 中的数据契约是否同一提交更新？
