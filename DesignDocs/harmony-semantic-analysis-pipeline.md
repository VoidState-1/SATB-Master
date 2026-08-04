# SATB Master V2 和声语义分析与上下文规则流水线

> 状态：核心流水线已实现，规则适用性计划、诊断仲裁和更完整的语义推断仍属于后续工作。
>
> 本文同时记录已落地结构与后续目标。V3 工程格式和外置规则 API 尚未正式发布，本轮允许直接破坏性更新，不保留旧类型或 API 兼容层。

## 1. 背景与目标

传统四部和声的规则很少能只看一个音符或一对相邻音符得出可靠结论。导音、七音、挂留音、和声切分、同和弦转换、对斜以及逆功能进行，都需要同时知道：

- 当前实际发声的音符与书写拼写；
- 当前和弦的构成音、转位和局部调性；
- 前后音符是否连续、前后和弦是否连续；
- 当前事件是否仍处于同一和声的展开过程中；
- 某条规则是否允许延迟判断或例外放宽。

因此 V2 的检查流程应从“每条规则自己查数组”升级为：

```text
工程事实
  -> 时间切片
  -> 切片之间的链式关系
  -> 和声语义与和声范围聚合
  -> 规则状态包裹的跨切片传递
  -> 规则适用性计划
  -> 规则评估
  -> 诊断仲裁、合并与归属
```

目标不是让分析器替用户猜测所有音乐语意，而是让不确定性显式存在，并让规则在证据不足时跳过、降级或请求人工确认。

## 2. 术语统一

### 2.1 “功能分析”改名为“和声语义分析”

当前代码中的 `FunctionalAnalysis` / “功能分析”同时承担了两个不同概念：

1. 和声学中的功能体系：主功能 T、下属功能 S、属功能 D；
2. 某个和弦在当前调性和上下文中的解释：例如 `V65/V`、借用和弦、终止四六、同主调关系。

这会导致“功能”字段既像分类，又像完整解释。建议采用以下命名：

| 概念 | 推荐代码名 | 说明 |
| --- | --- | --- |
| 实际和弦 | `ChordIdentity` | 根音、书写构成音、性质、扩展、变化音和低音，不描述用途 |
| 和声功能类别 | `FunctionalClass` | `tonic`、`predominant`、`dominant` 等，中文显示为 T/S/D 体系 |
| 和声语义解释 | `HarmonySemantics` | 调性、级数、副属目标、混合、终止角色、来源和置信度的组合 |
| 上下文 | `HarmonicContext` | 在某个时间范围内可用于解释的调号、拍位、前后和弦和乐句信息 |

旧的 `FunctionalAnalysis` 已直接移除，不保留迁移期类型别名。显示文字统一使用“和声语义”或“功能类别”，不再使用含义不明确的“功能分析”。

### 2.2 推荐的语义结构

```ts
interface HarmonySemantics {
  localKey?: KeyReference;
  degree?: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  degreeAlteration: Alteration;
  functionalClass: FunctionalClass;
  appliedTarget?: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  mixture?: "parallel-major" | "parallel-minor" | "modal";
  cadenceRole?: "cadential64" | "passing64" | "pedal64";
  source: "manual" | "inferred" | "confirmed";
  confidence: "certain" | "probable" | "ambiguous" | "unknown";
  alternatives?: readonly HarmonySemanticCandidate[];
}
```

`functionalClass` 只回答“属于哪类功能”，不承担和弦名称、构成音或解决义务。完整的显示名称由 `ChordIdentity + HarmonySemantics + HarmonicContext` 派生，不能反向解析 UI 文案。

## 3. 当前实现的真实流程

当前实现的主要入口是 `buildHarmonyAnalysis` 和 `RuleScheduler`，流程如下：

1. 复制并深度冻结工程，生成当前 revision 的只读快照。
2. 以音符起止、和弦区域起止、调号事件和工程首尾建立有序边界。
3. 相邻边界之间建立 `AnalysisSlice`，每个切片包含 SATB 当前发声音符、起音声部、调号、覆盖中的和弦和 `completeSatb`。
4. 对同一声部的相邻音符生成 `MelodyTransition`；对相邻切片生成 `SliceTransition`；对相邻和弦区域生成 `ChordProgression`。
5. 将连续、同调、同构成身份且语义一致的区域聚合为 `HarmonySpan`，转位和声部交换不会拆分 span。
6. `RuleScheduler` 按规则依赖和严重程度运行无状态 `evaluate` 或有状态 `process`；有状态规则的私有信封逐切片传递并在每一步校验。
7. 导音、和弦七音、副属目标已迁移到有状态接口；外置规则 API v2 也能读取 span 并使用同样的逐切片模型。
8. 所有外置脚本仍在独立 QuickJS 沙箱中运行，诊断最后与内置结果合并。

尚未完成的主要部分是统一的 `RuleApplicability` 计划、更丰富的语义候选推断，以及跨规则诊断仲裁。现有无状态规则中仍有一部分直接消费 transition，需要在相关规则扩展时逐步迁移。

## 4. 标准化处理流水线

### 4.1 阶段 A：规范化工程事实

输入只允许来自 `ProjectDocument`，输出是不可变的 `ProjectSnapshot`。这一层只做数据合法性和索引准备，不进行音乐判断。

必须保证：

- 音符保存书写音高，MIDI 音高由 `toMidi(pitch)` 派生；
- 时间为非负整数 tick，结束位置为 `startTick + durationTicks`；
- SATB 与辅助轨分离，辅助轨不进入和声规则；
- 和弦区域不重叠，和弦身份与语义字段分开；
- 人工确认的字段不能被后续推断静默覆盖。

### 4.2 阶段 B：建立时间切片

在所有会改变“当前事实”的位置建立边界：音符起止、和弦区域起止、调号、拍号、速度、循环边界以及后续需要的节拍位置。边界去重后按 tick 排序，区间 `[tick, endTick)` 形成一个切片。

每个切片提供：

```ts
interface AnalysisSlice {
  index: number;
  tick: number;
  endTick: number;
  notes: Partial<Record<VoiceId, AnalysisNote>>;
  attackVoiceIds: readonly VoiceId[];
  key: AnalysisKey;
  chord?: AnalysisChord;
  completeSatb: boolean;
  continuity: "continuous" | "gap" | "project-start";
}
```

切片是最小事实单位，不等同于“小节”或“和弦”。一个和弦区域可以包含许多切片，一个切片也可能没有和弦。

### 4.3 阶段 C：建立链式关系

切片关系是有序链，而不是只有独立的前后查询：

```text
S0 -> S1 -> S2 -> S3 -> ... -> Sn
```

每条边保存明确的关系：

```ts
interface SliceTransition {
  previousIndex: number;
  currentIndex: number;
  fromTick: number;
  toTick: number;
  contiguous: boolean;
  sameKey: boolean;
  sameHarmony: boolean;
  changedVoices: readonly VoiceId[];
}
```

规则不应自行通过 `index - 1` 猜测“前一个事件”，而应使用统一查询：

```ts
analysis.previousSlice(index, { contiguous: true });
analysis.nextSlice(index, { contiguous: true });
analysis.walkSlices(index, direction, { until: predicate });
analysis.previousAttack(voiceId, tick);
analysis.nextAttack(voiceId, tick);
```

其中 `contiguous: true` 表示中间不能有时间空洞、声部断裂或不允许跨越的调性边界。查询返回“没有结果”而不是伪造一个相邻事件。

### 4.4 阶段 D：解释和声语义

先从 `ChordIdentity` 取得实际构成音，再结合调号、人工语义、局部调性和前后候选生成 `HarmonySemantics`。推断结果必须保留候选集和置信度：

- `certain`：人工确认或仅有一个通过约束的候选；
- `probable`：有明显首选，但仍有合理替代解释；
- `ambiguous`：多个解释无法区分；
- `unknown`：缺少和弦、调号或书写拼写等必要事实。

`ambiguous` 和 `unknown` 不是违规。依赖语义的规则应返回结构化跳过原因，或者降低诊断置信度，而不是把推断结果当成确定事实。

### 4.5 阶段 E：聚合 `HarmonySpan`

连续同和弦转换不能只依赖相邻布尔值。应将连续的、具有同一和声身份和语义上下文的区域聚合为一个 `HarmonySpan`：

```ts
interface HarmonySpan {
  id: string;
  fromTick: number;
  toTick: number;
  regionIds: readonly string[];
  sliceIndices: readonly number[];
  identityKey: string;
  semantics?: HarmonySemantics;
  functionalClass: FunctionalClass;
  status: "complete" | "ambiguous";
  entryTransitionIndex?: number;
  exitTransitionIndex?: number;
}
```

两个相邻区域只有同时满足以下条件时才属于同一 `HarmonySpan`：

1. 前一区域结束 tick 等于后一区域开始 tick；
2. 调性没有变化；
3. `ChordIdentity` 的根音、书写构成音、性质和变化音相同；
4. 局部调性、副属目标、混合、终止角色和语义置信度相同；
5. 没有人工标记的“语义断开”或不可跨越边界。

转位、排列法和声部交换可以在同一 `HarmonySpan` 内变化。改变和弦性质、根音、和声语义、调性、副属目标或语义置信度会结束当前 span。未填写语义的连续同身份和弦仍可聚合，但 span 状态为 `ambiguous`，依赖语义的规则不能把它当作确定结论。

因此，连续 `I -> I6 -> I64 -> I` 会形成一个 span；规则看到的是一个入口、一个内部转换链和一个出口，而不是三次互相孤立的“和弦变化”。

### 4.6 阶段 F：传递 `RuleStateEnvelope`

需要后文才能判断的规则不能在触发位置立即报错，但核心分析器也不应预先枚举“导音、七音、挂留音”等全部音乐学义务。否则每增加一种规则，都要修改核心联合类型、结束时机和外置规则 API。

核心层只提供一个沿时间链传递的通用状态包裹：

```ts
type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

interface RuleStateEnvelope<T extends JsonValue = JsonValue> {
  id: string;
  ownerRuleId: string;
  createdAt: {
    tick: number;
    sliceIndex: number;
  };
  subjectRefs?: {
    voiceIds?: readonly VoiceId[];
    noteIds?: readonly string[];
    chordIds?: readonly string[];
    spanIds?: readonly string[];
  };
  payload: T;
}
```

核心层只理解 `id`、所有者、创建位置、关联对象和可序列化约束，不解释 `payload`。处于传递队列中的包裹天然表示“这条规则还有尚未完成的判断”，因此不设置统一的 `kind`、`deadline`、`expected` 或 `status`。

具体规则通过有状态接口消费和产生自己的包裹：

```ts
interface StatefulRule<T extends JsonValue> {
  id: string;
  process(
    context: RuleStepContext,
    incoming: readonly RuleStateEnvelope<T>[],
  ): RuleStepResult<T>;
  finalize?(
    context: RuleStepContext | undefined,
    remaining: readonly RuleStateEnvelope<T>[],
  ): RuleEvaluation;
}

interface RuleStepResult<T extends JsonValue> {
  outgoing: readonly RuleStateEnvelope<T>[];
  diagnostics: readonly RuleDiagnostic[];
}
```

处理过程如下：

```text
上一步中属于本规则的包裹
  -> 规则结合当前 slice/span/transition 判断
  -> 继续传递、更新或拆分包裹
  -> 或停止传递，并按需要产生诊断
```

规则没有继续返回某个包裹，即表示该状态已经完成、失效或被消费。究竟是正确解决、违规、证据不足还是无需继续，由规则自己的逻辑和诊断结果表达，核心层不替规则解释。

例如导音规则的 payload 可以保存原声部、来源音符、目标主音和来源 span。它可以在同和弦 span 内继续传递，在正确解决后静默消费，在离开 span 仍未解决时消费并生成诊断。和声切分规则则可以保存持续音、起始拍位和前一 span，并采用完全不同的结束条件；两者不需要共享核心枚举。

包裹是沿时间轴传递的规则私有状态，不是全局消息总线：

- 默认只有 `ownerRuleId` 对应的规则可以读取和更新该包裹；
- 一条规则不能依赖另一条规则的 payload 或执行顺序；
- 被多条规则稳定需要的信息应提升为 `AnalysisSlice`、`HarmonySpan` 等共享分析事实；
- 包裹仅存在于当前分析 revision，不写入工程文件；
- 调度器限制单条规则的包裹数量、单项大小和创建位置，并校验所有实体引用；
- 新 revision 或取消信号到来时，旧包裹和旧诊断一起丢弃。

这样核心层提供稳定的横向传递能力，音乐学规则仍保留对触发条件、状态内容和结束判定的完整控制权。

### 4.7 阶段 G：规则适用性计划

规则运行前先生成适用性计划，避免每条规则重复实现例外：

```ts
interface RuleApplicability {
  ruleId: string;
  scope: "note" | "transition" | "slice" | "span" | "phrase" | "project";
  targetIds: readonly string[];
  policy: "strict" | "deferred" | "relaxed" | "skip";
  reason?: string;
  confidence: "certain" | "probable" | "ambiguous" | "unknown";
}
```

同和弦 span 的默认政策：

| 规则类别 | 同和弦内部 | span 出口 |
| --- | --- | --- |
| 大跳、连续跳进 | 放宽 | 按普通连接检查 |
| 隐伏五度/八度 | 放宽 | 按普通连接检查 |
| 声部超越 | 放宽 | 按普通连接检查 |
| 临时缺少构成音、暂时重复三音/五音 | 延迟 | 检查最后一个有效切片 |
| 导音、七音解决 | 由各规则创建并携带私有状态包裹 | 由具体规则决定何时消费和诊断 |
| 平行五度、平行八度 | 永不豁免 | 永不豁免 |
| 声部交叉 | 永不豁免 | 永不豁免 |
| 超出音域、上三声部间距 | 永不豁免 | 永不豁免 |

规则只消费 `RuleApplicability` 和统一分析 API，不再自行判断“是否同和弦”。

### 4.8 阶段 H：评估与诊断仲裁

每条规则返回结构化诊断事实，不直接拼接最终 UI 文案。诊断至少包含：规则 ID、严重程度、时间范围、归属对象、证据、适用上下文、置信度和稳定去重键。

诊断归属原则：

- 音符旋律问题附着音符或声部；
- 连接问题附着前后两个切片或对应音符；
- 和弦构成、完整性、功能和进行问题附着和弦区域或 `HarmonySpan`；
- “和弦构成音不完整”只在和弦上显示，不把同一问题复制到和弦内所有音符；
- 鼠标悬停对象时，可聚合显示该对象关联的全部诊断，但不改变诊断本身的归属。

仲裁阶段使用以下键合并重复问题：

```text
ruleId + canonicalScope + sortedEvidenceIds + normalizedRange
```

同一事实同时触发父级和子级规则时，保留更具体的诊断，并把父级诊断作为关联信息；不同事实不能仅因消息相似而合并。规则失败、证据不完整和语义歧义分别使用不同状态，不能混写成“违规”。

## 5. 链式关系的使用方式

### 5.1 连续同和弦转换

分析器先建立切片链，再建立 span 链。连续同和弦转换的内部关系可表示为：

```text
HarmonySpan H0
  S0(I) -> S1(I6) -> S2(I64) -> S3(I)
  entry: 前一个不同和弦
  exit: 后一个不同和弦
```

规则可以选择：

- 只检查 `entry`；
- 只检查 `exit`；
- 遍历 span 内部所有 `SliceTransition`；
- 在 span 结束时处理属于本规则的 `RuleStateEnvelope`。

这样“导音在第一片未解决”不会在每个中间切片重复报警，但如果离开 span 时仍未解决，仍会在出口产生一次有完整证据的诊断。

### 5.2 和声切分与其他长程规则

和声切分不应只访问一个 `previous` 和 `current`。它应沿切片链寻找：

1. 发生重音或节拍边界的位置；
2. 仍在发声的持续音；
3. 下一次改变和弦身份的边界；
4. 对应的 `HarmonySpan` 入口和出口。

规则通过 `walkSlices`、`walkSpans` 和 `nextAttack` 查询，因此可以连续查找任意长度的前后上下文，并统一处理空拍、休止、调号变化和辅助轨隔离。

## 6. 歧义字段、误判与互相覆盖控制

### 6.1 可能产生歧义的字段

以下字段不应被视为同一层面的“真值”：

| 字段 | 歧义来源 | 处理方式 |
| --- | --- | --- |
| `ChordIdentity.root/tones` | 等音拼写、缺少构成音 | 以书写拼写为事实，缺失时标记不完整 |
| `HarmonySemantics.localKey` | 局部转调、同主调、借用 | 保存候选和来源，不覆盖人工确认 |
| `functionalClass` | 同一和弦可承担多种上下文作用 | 允许 `ambiguous`，降低依赖功能规则置信度 |
| `appliedTarget` | 副属目标可能不唯一 | 只有目标证据充分时才让相关规则创建待处理状态 |
| `nonChordToneRole` | 一个音可能是经过、挂留或倚音 | 人工标注优先，自动推断保留候选 |
| `sameHarmony` | 相同构成音但语义或调性不同 | 只由 `HarmonySpan` 构建，不作为持久字段 |
| `completeSatb` | 切片缺音、休止或数据非法 | 明确区分“无声部”和“数据错误” |
| `RuleStateEnvelope.payload` | 每条规则的数据结构和含义不同 | payload 仅由所属规则解释，不提升为共享事实 |
| `source` | 手动、迁移、推断、确认混用 | 来源不可变，确认动作显式记录 |

### 6.2 单一事实来源

- 音高事实只有 `NoteEvent.pitch`；MIDI 数值是派生缓存。
- 和弦实际构成只有 `ChordIdentity`；罗马数字和显示名称是派生结果。
- T/S/D 只有 `functionalClass`；副属、借用和终止角色属于语义上下文。
- 是否同和弦只存在于分析结果的 `HarmonySpan` / transition，不写回工程。
- 跨切片状态只保存在所属规则的 `RuleStateEnvelope` 中；核心层不再维护一份中央义务表。

禁止添加“同义重复字段”来掩盖不确定性，例如同时保存 `isLeadingTone`、`leadingToneResolved` 和 `leadingToneError`。规则只在 payload 中保存完成后文判断所需的最小状态，最终错误仍由诊断派生。

### 6.3 防止互相覆盖

采用以下优先级：

```text
人工确认 > 人工标注 > 迁移后的明确拼写 > 自动推断 > UI 默认值
```

自动推断只能生成候选，不得静默覆盖高优先级字段。若两个高优先级来源冲突，应生成“语义冲突”状态，暂停依赖该字段的规则，而不是任意选择一个继续报错。

## 7. 外置规则接口

Phase C 的外置规则沙箱使用只读、序列化上下文。API v2 已增加：

- `harmonySpans`：范围、构成身份、语义摘要和入口/出口；
- 带索引和连续性的 `slices` 与预计算 transition；
- `process/finalize` 以及规则私有的 JSON 状态信封。

需要跨切片保存状态的外置规则返回标准 `RuleStateEnvelope`，宿主校验其所有者、创建位置、实体引用和 JSON payload，并在下一步只把该规则自己的信封重新传入。脚本不能指定其他 `ownerRuleId`、读取其他规则的包裹，或在 payload 中保存函数、宿主对象和不可序列化数据。

外置脚本不能修改工程、语义、其他规则状态或规则配置。由于 v1 从未正式发布，API v2 直接替换 v1，只接受 `apiVersion: 2`，不提供旧字段映射或兼容适配。

## 8. 迁移与实现顺序

### 第 1 步：术语与类型拆分（已完成）

- 新增 `HarmonySemantics`、`FunctionalClass` 的明确类型；
- 直接移除 `FunctionalAnalysis`；
- 将持久化和弦拆为 `ChordIdentity + HarmonySemantics`，编辑器使用临时 `ChordDraft`。

### 第 2 步：链式索引与 span（已完成）

- 保留现有 `AnalysisSlice`；
- 新增稳定的 slice index、continuity 和查询 API；
- 实现 `HarmonySpan` 聚合及同和弦 golden tests；
- 将现有 `sameHarmony` 布尔判断改为读取 span 关系。

### 第 3 步：规则状态包裹（核心已完成）

- 实现 `RuleStateEnvelope` 调度、所有权隔离、序列化校验和资源限制；
- 为规则运行时增加 `process/finalize` 有状态接口，同时保留无状态规则接口；
- 迁移导音、七音和副属目标规则，各自维护私有 payload；
- 增加同和弦链长度为 1、2、N，提前解决、延迟解决、无后继和有休止的测试。

### 第 4 步：规则计划与诊断仲裁

- 把同和弦豁免移入 `RuleApplicability`；
- 统一诊断归属、去重和关联对象；
- 修复和弦级问题重复附着音符的问题。

### 第 5 步：外置规则 API 升级（v2 已完成）

- 暴露 span、ambiguity 和规则私有状态通道；
- 更新规则 API 文档和示例包；
- 直接拒绝未发布的 v1 API，不保留兼容适配。

## 9. 验收标准与测试矩阵

至少覆盖以下场景：

| 场景 | 预期 |
| --- | --- |
| 单个和弦区域 | 形成一个 span，入口/出口按边界处理 |
| 连续 `I -> I6 -> I64 -> I` | 一个 span，不重复触发内部“未解决”诊断 |
| 同构成音但改变调性 | 分成两个 span |
| 同根但改变性质或副属目标 | 分成两个 span |
| span 内导音暂不解决，出口后解决 | 导音规则消费状态包裹且不产生诊断 |
| span 结束仍未解决 | 只生成一次带完整证据的诊断 |
| span 内临时缺少构成音，出口补齐 | 不报完整性错误 |
| span 内真实平行五度/八度 | 即使其他规则放宽也必须报错 |
| 声部交叉、音域越界、上三声部超八度 | 永不因同和弦而豁免 |
| 无和弦或语义歧义 | 依赖和弦语义的规则跳过或降级，不误报 |
| 和弦构成不完整 | 诊断只归属和弦，悬停时才显示关联音符 |
| 长链和声切分 | 可沿链查找前后所有需要的事件，无数组边界错误 |
| 两条有状态规则同时运行 | 各自只能读取自己的包裹，结果不受执行顺序影响 |
| 工程产生新 revision | 旧 revision 的包裹和诊断不能覆盖新结果 |
| 外置规则 | 只能读取统一快照，无法改变内置结果或覆盖新 revision |

## 10. 结论

“切片 + 相邻关系”是基础，但不能单独承载传统和声的上下文语意。最终应以三类对象协同工作：

1. `AnalysisSlice`：某一时刻发生了什么；
2. `HarmonySpan`：连续一段时间仍在解释同一个和声；
3. `RuleStateEnvelope`：把某条规则尚未完成的最小私有状态传递给后续上下文。

分析器统一定义事实链和传递机制，具体规则定义 payload 与生命周期。这样既能让连续同和弦转换和和声切分跨越多个事件，又不会把未来所有特例固化进核心类型；在语义不确定时，规则仍可选择继续携带、静默结束或暂不判断，而不是制造大量互相矛盾的错误。
