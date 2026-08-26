# 终止式自动判别设计

状态：基础模型参考；自动乐句推断部分已被 [乐句与终止式自动判别简化改进方案](./phrase-cadence-regularity-improvement.md) 取代

本文仍保留终止式类型、范围对象、人工确认和终止式检测职责等基础设计。关于自动乐句边界候选、评分和结构选择，不再采用本文早期的开放式方案。

适用范围：当前调性内的四部和声工程、和弦轨、终止式相关规则与和弦属性面板

## 1. 目标

本功能用于从当前工程的和弦事件、和声功能、节拍位置和 SATB 收束状态中识别终止式候选，并允许用户确认、编辑和管理终止式范围。

用户可见的一级终止类型固定为四种：

| ID | 中文 | 基本结束状态 |
| --- | --- | --- |
| `full` | 全终止 | 以主功能和弦结束，并形成闭合感 |
| `half` | 半终止 | 以属功能和弦结束，暂不回到主功能 |
| `supplementary` | 补充终止 | 以补充性的下属到主功能进行结束，通常表现为变格补充 |
| `deceptive` | 阻碍终止 | 属功能没有进入主功能，而进入替代目标 |

正格/变格、完满/不完满等区分是终止式的附加限定，不再增加新的一级类型。

本功能还需要：

1. 为终止式覆盖的全部和弦事件提供统一颜色和可识别标记；
2. 只在和弦满足对应条件时显示属性编辑控件；
3. 修改终止式类型时修改整个终止式范围，而不是逐个修改和弦；
4. 保留自动判别的证据、置信度和歧义信息，避免把猜测伪装成用户确认。

## 2. 当前问题

当前 `HarmonySemantics` 同时承担和弦的局部解释和终止式结论，包含：

- `cadenceRole`：终止四六、经过四六、辅助四六、阻碍进行起点等和弦级角色；
- `cadenceType`：完全、半、变格、阻碍等终止式级结论。

这会造成三个问题：

1. 一个终止式涉及多个和弦，但类型必须重复写入每个和弦；
2. 同一终止式中的和弦可能出现互相矛盾的类型；
3. 自动检测结果、人工确认结果和规则验证结果没有清晰的所有权。

因此不能继续在 `ChordSemanticsEditor` 中简单增加更多下拉选项。终止式应成为独立的范围级领域对象。

此外，当前代码虽然在分析失效范围中使用了 `phrase` 依赖标签，但这只是缓存失效分类，不代表系统已经拥有乐句模型。现有 `MetricTimeline` 只能回答拍位强弱，`HarmonySpan` 只能回答和声区段连续性；两者都不能回答“这里是否是乐句结束”。终止式检测必须先消费独立的乐句分析结果。

## 3. 核心模型

### 3.1 终止式限定

```ts
export type CadenceKind =
  | "full"
  | "half"
  | "supplementary"
  | "deceptive";

export type CadenceForm = "authentic" | "plagal";
export type CadenceCompletion = "perfect" | "imperfect";
```

`form` 和 `completion` 都是可选限定。它们的合法组合由领域策略表统一判断，不由 UI 自由拼接。

第一阶段的组合约束：

| 一级类型 | `form` | `completion` | 说明 |
| --- | --- | --- | --- |
| `full` | `authentic` | `perfect` 或 `imperfect` | 属到主的闭合终止；完满性由声部与转位决定 |
| `half` | `authentic` 或未指定 | 不适用 | 终止于属功能 |
| `supplementary` | `plagal` | 可不指定 | 下属到主的补充性终止 |
| `deceptive` | 未指定 | 不适用 | 属到非主的替代目标 |

如果教材约定需要将某种变格闭合也称为“全终止”，只需调整策略表，不改变存储模型和检测管线。

### 3.2 自动候选

自动判别不直接修改工程，输出只读候选：

```ts
export interface CadenceCandidate {
  readonly id: string;
  readonly phraseId: string;
  readonly fromTick: number;
  readonly toTick: number;
  readonly kind: CadenceKind;
  readonly form?: CadenceForm;
  readonly completion?: CadenceCompletion;
  readonly confidence: "certain" | "probable" | "ambiguous";
  readonly score: number;
  readonly spanIds: readonly string[];
  readonly chordIds: readonly string[];
  readonly evidence: readonly CadenceEvidence[];
  readonly alternatives?: readonly CadenceCandidate[];
}

export interface CadenceEvidence {
  readonly code:
    | "phrase-boundary"
    | "dominant-to-tonic"
    | "predominant-to-tonic"
    | "dominant-to-alternative"
    | "ends-on-dominant"
    | "cadential64-chain"
    | "bass-formula"
    | "metric-support"
    | "soprano-tonic"
    | "stable-ending"
    | "ambiguous-semantics";
  readonly value: string;
  readonly refs?: readonly string[];
}
```

候选结果属于 `HarmonyAnalysis` 的派生数据，刷新分析即可重新计算，不写入 `ProjectDocument`。

### 3.3 用户确认的范围标注

```ts
export interface CadenceAnnotation {
  readonly id: string;
  readonly phraseId: string;
  readonly fromTick: number;
  readonly toTick: number;
  readonly kind: CadenceKind;
  readonly form?: CadenceForm;
  readonly completion?: CadenceCompletion;
  readonly source: "manual" | "accepted-candidate";
  readonly confidence: "certain" | "probable";
  readonly locked: boolean;
}
```

建议将 `cadenceAnnotations` 放在 `ChordTrack` 中，因为它描述和弦时间轴上的范围，而不是某个单独和弦的语义。

建议在 `ProjectDocument` 增加独立的结构数据：

```ts
interface ProjectStructure {
  readonly phraseBoundaries: readonly PhraseBoundary[];
}

interface ProjectDocument {
  // ...已有工程字段
  structure: ProjectStructure;
}
```

自动推测的 `PhraseBoundaryCandidate` 不写入 `structure`；只有用户确认后才转化为 `PhraseBoundary`。

范围必须满足：

- `fromTick < toTick`；
- 两端对齐和弦区域边界；
- 覆盖的和弦事件按时间连续；
- 不跨越调号变化；
- 不与另一个已确认标注产生部分重叠。

范围内的成员通过时间范围派生，不保存重复的 `chordIds`。这样和弦切分、合并和重排时不会留下过期成员列表。

### 3.4 与现有和弦语义的关系

保留 `HarmonySemantics.cadenceRole`，用于以下局部角色：

- `cadential64`；
- `passing64`；
- `pedal64`；
- 阻碍进行起点。

删除 `HarmonySemantics.cadenceType`。终止式类型迁移到 `CadenceAnnotation`，规则通过终止式上下文读取，不再从单个和弦读取。

旧 `cadenceType` 不再作为兼容字段保留。该字段从 `HarmonySemantics`、编辑 action、规则上下文和调试快照中删除；工程规范化时会丢弃残留的旧属性，终止类型只能来自 `CadenceAnnotation` 或分析候选。由于旧版本未公开发布，本次不维护按和弦逐项推断范围的兼容迁移。

### 3.5 乐句结构模型

终止式以乐句为单位判断，因此乐句不能由终止检测器临时猜测，也不能由
`HarmonySpan` 或节拍位置代替。当前工程没有独立的乐句概念，需要先增加结构分析层。

用户确认的乐句边界建议作为项目结构数据保存：

```ts
interface PhraseBoundary {
  readonly id: string;
  readonly tick: number;
  readonly source: "manual" | "inferred";
  readonly confidence: "certain" | "probable" | "ambiguous";
  readonly locked?: boolean;
}

interface PhraseSegment {
  readonly id: string;
  readonly fromTick: number;
  readonly toTick: number;
  readonly startBoundary?: PhraseBoundary;
  readonly endBoundary?: PhraseBoundary;
  readonly source: "manual" | "inferred" | "mixed";
  readonly confidence: "certain" | "probable" | "ambiguous";
  readonly evidence: readonly PhraseEvidence[];
}

interface PhraseBoundaryCandidate {
  readonly tick: number;
  readonly score: number;
  readonly confidence: "probable" | "ambiguous";
  readonly evidence: readonly PhraseEvidence[];
}

interface PhraseEvidence {
  readonly code:
    | "manual-boundary"
    | "project-start"
    | "project-end"
    | "all-voices-end"
    | "silence-after-target"
    | "long-note-release"
    | "stable-harmony"
    | "cadential-connection"
    | "metric-support"
    | "new-material"
    | "continuous-following-harmony"
    | "semantic-ambiguity";
  readonly value: string;
  readonly refs?: readonly string[];
}
```

`PhraseBoundary` 是可编辑的结构事件，`PhraseSegment` 和候选边界是分析结果。
工程起点和工程终点始终作为确定边界；其余边界必须区分人工确认和自动推测。

乐句分段必须满足：

- 边界按 tick 升序且不重复；
- 相邻乐句只共享边界，不重叠、不留隐含空洞；
- 不跨越调号变化、明确休止断点或分析不可用区间；
- 终止式候选必须完整落在一个 `PhraseSegment` 内，并以该乐句的 `toTick` 为结束边界；
- 自动推测的乐句边界不能产生高于自身置信度的终止式置信度。

以下概念必须保持独立：

| 概念 | 作用 |
| --- | --- |
| `MetricPosition` | 当前时间点的节拍强弱 |
| `HarmonySpan` | 连续的和声实体或语义区段 |
| `PhraseSegment` | 乐句结构范围 |

强拍不是乐句边界，`HarmonySpan` 结束不是乐句结束，`D -> T` 也不自动等于全终止。

### 3.6 与现有代码的落地边界

乐句层是新增的结构分析层，不应通过给现有对象增加一个临时字段来“模拟”乐句。具体边界如下：

| 现有对象或模块 | 继续负责 | 不应承担 |
| --- | --- | --- |
| `MetricTimeline` | 查询任意 tick 的拍位、拍点和节拍强度 | 推断乐句结束 |
| `HarmonySpan` | 表示连续和声实体及其功能语义 | 表示乐句范围或终止式范围 |
| `HarmonyAnalysis` | 汇总并缓存乐句与终止检测的派生结果 | 持久化用户确认的结构边界 |
| `ProjectDocument.structure` | 保存人工确认的乐句边界 | 保存每次分析产生的候选分段 |
| `CadenceDetector` | 消费 `PhraseSegment` 并判断终止候选 | 在内部重新猜测乐句边界 |

因此，当前代码的改造顺序应为：

1. 在工程持久化模型中增加 `structure.phraseBoundaries`，并更新默认值、规范化、校验和序列化入口；
2. 新增 `PhraseAnalyzer`，以工程边界和人工边界生成 `PhraseSegment[]`，同时输出不落盘的 `PhraseBoundaryCandidate[]`；
3. 将 `PhraseSegment[]` 挂入 `HarmonyAnalysis`，提供 `phrases()`、`phraseAt()` 等只读查询；
4. 新增 `CadenceDetector(PhraseSegment[])`，所有终止候选都必须绑定 `phraseId`，且结束 tick 必须等于所属乐句的 `toTick`；
5. UI 和规则只读取分析层输出，不从和弦事件或节拍位置自行拼接乐句。

第一阶段允许只有工程起点、工程终点和人工边界参与确定性分析。自动边界只作为带证据的候选展示；在没有用户确认之前，不改变工程结构，也不允许生成 `certain` 终止式。这样可以先建立稳定的乐句数据契约，再逐步增加自动推断策略。

## 4. 检测管线

检测器放在 `src/domain/harmony/cadence/`，不放入规则组。终止检测是分析结论，不是“发现错误”的规则。

```text
HarmonyAnalysis
  -> 乐句边界与乐句分段
  -> 终止乐句端点提取
  -> 和声连接归一化
  -> 终止候选窗口生成
  -> 四类终止分类
  -> 子类型判定
  -> 评分与歧义处理
  -> CadenceCandidate[]
```

检测器只使用当前调性内的主要解释。语义为 `ambiguous`、`unknown` 或未能解析主要功能时，不得直接形成 `certain` 候选。

终止检测只能消费 `PhraseSegment`，不能自己重新计算乐句边界。乐句分析和终止分析的职责必须分离：

```text
PhraseAnalyzer -> PhraseSegment[]
CadenceDetector(PhraseSegment[]) -> CadenceCandidate[]
```

### 4.1 乐句分析流程

乐句分析分为“明确边界”和“推测边界”两个阶段。

明确边界按以下优先级建立：

1. 工程起点；
2. 工程终点；
3. 用户确认的边界；
4. 未来支持的显式乐句/段落事件。

在没有用户边界时，分析器可以生成候选边界，但不能直接把普通强拍当作确定边界。候选证据至少包括：

| 证据 | 分值 |
| --- | ---: |
| 工程起点或终点 | 3 |
| 全部 SATB 声部在此处结束 | 3 |
| 目标和弦后至少一拍全声部空白 | 2 |
| 长时值终止音在此处释放 | 1 |
| 强拍上的稳定和弦 | 1 |
| `D -> T`、`S -> T` 或 `D -> VI` | 2 |
| 新材料或新和声在此处进入 | 1 |
| 后续立即出现连续和声 | -3 |
| 调性变化、休止断点或语义歧义 | -3 |

候选边界的建议阈值：

- 总分小于 3：不生成边界候选；
- 总分 3 至 4：`ambiguous`；
- 总分 5 以上：`probable`，仍需用户确认后才成为确定结构边界。

边界候选应在整个时间轴上选择，而不是逐点独立接受。实现时至少需要最小乐句长度和相邻边界去重，避免连续多个强拍被误切成大量短乐句。

第一阶段可以只持久化人工边界，并将自动候选显示为建议；待边界编辑流程稳定后，再将高置信度候选纳入自动分析。

## 5. 基础事实

检测逻辑统一使用以下领域事实。每个事实都应保留 `true`、`false` 或 `unknown`，不得把缺失资料直接当作 `false`。

### 5.1 功能事实

对每个 `HarmonySpan` 计算：

```ts
interface CadenceSpanFacts {
  span: HarmonySpan;
  interpretationStatus: "resolved" | "ambiguous" | "unavailable";
  degree?: ScaleDegree;
  family?: "tonic" | "subdominant" | "dominant";
  isTonic: boolean | undefined;
  isDominant: boolean | undefined;
  isSubdominant: boolean | undefined;
  isCadential64: boolean;
  isStable: boolean | undefined;
}
```

判定规则：

- `isTonic`：主要解释的 `primaryFunction === "tonic"`，且目标不是未完成的应用目标；
- `isDominant`：主要解释的 `primaryFunction === "dominant"`；
- `isSubdominant`：主要解释的 `primaryFunction === "subdominant"`；
- `isCadential64`：主要解释的 designation 为 `cadential64`，或 `cadenceRole === "cadential64"`；
- `isStable`：和弦为确定的三和弦或允许的目标和弦，且没有未解决的七音、九音或显式持续低音上下文。

应用属、重属和有明确目标链的和弦必须先沿 `targetChains` 解析。不能把一个尚未完成的应用属和弦直接当作当前调性的属终止。

### 5.2 连接事实

连接必须同时满足：

- `contiguous === true`；
- `sameKey === true`；
- `confidence !== "ambiguous"` 且不为 `unknown`；
- 前后 Span 没有休止或分析断点。

允许跳过的中介：

- 终止四六可作为 `cadential64 -> dominant` 的中介；
- 同一功能内的转位或同实体转换可合并；
- 其他中介默认切断终止链，避免扩大范围。

### 5.3 乐句端点

终止候选必须绑定到一个 `PhraseSegment`。检测器不再用工程结尾、空白或强拍直接替代乐句边界；这些信息只由 `PhraseAnalyzer` 作为边界证据使用。

对每个乐句，只检查其 `toTick` 之前的最后一个有效和声事件。下列条件是终止候选的必要过滤：

- `phrase.confidence === "certain"` 时，候选最多可达 `certain`；
- `phrase.confidence === "probable"` 时，候选最多为 `probable`；
- `phrase.confidence === "ambiguous"` 时，候选必须为 `ambiguous` 或直接跳过；
- 终止连接不能跨越乐句边界、调性变化、休止断点或歧义重解释；
- 乐句末端和弦必须覆盖到 `phrase.toTick`，只在乐句中间出现的 `D -> T`、`S -> T` 或 `D -> VI` 只能作为普通连接。

工程起点和终点以及人工确认的边界属于确定边界。自动推测的“全声部结束、和弦后空白、强拍稳定和声”等证据必须先进入 `PhraseBoundaryCandidate`，不能在终止检测器内部再次计算。

## 6. 候选窗口生成

终止式范围采用“最小充分窗口”，不得把整个乐段都染成同一种颜色。

### 6.1 起点扩展

从结束目标向前扫描，只允许加入直接参与终止的和弦：

1. 若目标前是属功能，加入该属 Span；
2. 若属功能前紧接终止四六，加入终止四六 Span；
3. 若属功能前紧接下属功能，只有当其位于强拍、连接连续且目标链没有插入其他和弦时才加入；
4. 其他和弦不加入范围。

因此典型范围为：

```text
K46 -> D -> T
S   -> D -> T
D   -> T
```

半终止、阻碍终止和补充终止只从其自身的最小连接开始，不追溯更早的非必要和弦。

### 6.2 终止式候选必须覆盖完整连接

如果 `K46` 已加入范围，必须同时存在连续的 `K46 -> D`；否则 K46 只保留为普通和弦级角色，不成为终止式的一部分。

如果目标连接存在歧义，则候选保留 `ambiguous`，但不自动应用颜色或写入工程。

## 7. 四类终止的明确判定逻辑

以下伪代码中的 `previous`、`current` 指相邻或经允许中介归一化后的 Span。

### 7.1 全终止 `full`

必要条件：

```text
phrase.toTick === terminal.toTick
phrase.confidence !== "ambiguous"
sameKey === true
current.isTonic === true
current.isStable !== false
```

并且必须满足以下任一连接：

```text
previous.isDominant === true -> current.isTonic === true
```

或：

```text
K46 -> D -> T
```

其中 K46 必须是明确 `cadential64`，D 必须是当前调性的属功能，T 必须是主功能。 `S -> T` 不归入 `full`，归入补充终止。

#### 正格与完满性

只有 `D -> T` 的全终止计算以下附加属性：

```text
form = "authentic"
```

`completion = "perfect"` 的必要条件：

1. D 和 T 均为原位；
2. 低音为当前调性属音到主音；
3. 终止目标 T 为原位主和弦；
4. 女高音在目标 T 落在主音；
5. 目标之后没有未解决的规则义务。

若满足前 1 至 3 条但不满足女高音主音条件，结果为：

```text
full + authentic + imperfect
```

如果 D/T 转位、目标不稳定、声部资料不完整或有未解决义务，则 `completion` 为 `undefined`，候选最高为 `probable`，不能自动标为完满。

### 7.2 半终止 `half`

必要条件：

```text
phrase.toTick === terminal.toTick
phrase.confidence !== "ambiguous"
current.isDominant === true
current.isStable !== false
```

并且：

- 当前属和弦是范围末端；
- 当前之后没有紧接的主功能和弦；
- 当前和弦不是另一个更高置信度全终止或阻碍终止的中间节点；
- 当前结束位置确实具有停顿或结构边界。

典型形式：

```text
S -> D
K46 -> D
D
```

半终止不设置 `completion`。 `form` 只有在存在明确的正格属终止语境时才设置为 `authentic`，否则保持未指定。

### 7.3 补充终止 `supplementary`

必要条件：

```text
phrase.toTick === terminal.toTick
phrase.confidence !== "ambiguous"
previous.isSubdominant === true
current.isTonic === true
sameKey === true
```

并且不能存在同一范围内更近的 `D -> T` 连接将其解释为全终止的延长。

结果固定为：

```text
kind = "supplementary"
form = "plagal"
```

以下情况优先判定为补充终止：

1. `S -> T` 直接结束于强拍；
2. 前面已经完成一个 `full`，随后出现 `S -> T` 并形成补充性收束；
3. 目标 T 稳定，且没有 D 到 T 的直接终止连接。

单独的 `IV -> I` 若位于乐句中间、没有边界分值，不生成补充终止候选。

### 7.4 阻碍终止 `deceptive`

必要条件：

```text
phrase.toTick === terminal.toTick
phrase.confidence !== "ambiguous"
previous.isDominant === true
sameKey === true
current.isTonic === true
current.degree !== 1
```

典型目标为 VI 级和弦：

```text
D -> VI
```

也允许当前调性中明确属于主功能族但不是 I 级的替代目标。应用属目标、转调和歧义解释必须排除，否则不生成确定候选。

如果 D 后进入 VI 但没有结构边界，只保留为普通“阻碍进行”连接，不自动标记为阻碍终止。

### 7.5 分类器伪代码

实现时每个结构边界只执行一次分类。分类器不得在多个规则函数中分别猜测终止类型：

```ts
function classifyAtBoundary(input: CadenceBoundaryInput) {
  if (
    input.keyChanged ||
    input.hasBreak ||
    input.semanticAmbiguity ||
    input.phrase.confidence === "ambiguous" ||
    input.terminal.toTick !== input.phrase.toTick
  )
    return [];

  const candidates: CadenceCandidate[] = [];
  const terminal = input.terminal;
  const previous = input.previous;

  if (!terminal.isStable) return [];

  if (previous?.isDominant && terminal.isTonic && terminal.degree === 1) {
    const path = input.pathThroughCadential64
      ? [input.cadential64, previous, terminal]
      : [previous, terminal];
    candidates.push(fullCandidate(path, input));
  }

  if (previous?.isSubdominant && terminal.isTonic) {
    candidates.push(supplementaryCandidate([previous, terminal], input));
  }

  if (previous?.isDominant && terminal.isTonic && terminal.degree !== 1) {
    candidates.push(deceptiveCandidate([previous, terminal], input));
  }

  if (terminal.isDominant && !input.hasFollowingTonic) {
    candidates.push(halfCandidate(input.windowEndingAt(terminal), input));
  }

  return resolveCadenceConflicts(candidates);
}
```

实际代码中 `isDominant`、`isTonic` 和 `isSubdominant` 允许为 `undefined`。只有明确为 `true` 时才能进入对应分支；`undefined` 应转化为歧义候选或跳过，而不是进入否定分支。

## 8. 分类优先级与冲突处理

检测器不能为同一范围同时输出多个颜色。候选按以下顺序裁决：

1. 人工确认的 `CadenceAnnotation`；
2. `full`；
3. `deceptive`；
4. `supplementary`；
5. `half`；
6. 置信度更高者；
7. 分数相同则范围更短者；
8. 仍无法区分则输出一个 `ambiguous` 候选，不染色、不自动应用。

`half` 只应在范围末端没有闭合目标时成立，因此通常不会与 `full` 同时成立。优先级主要用于处理边界不完整和多个候选窗口重叠的情况。

候选分数建议按 100 分制计算：

| 维度 | 分值 |
| --- | ---: |
| 核心功能连接完全匹配 | 50 |
| 乐句端点与边界证据 | 25 |
| 低音公式与转位 | 10 |
| 节拍支持 | 5 |
| 声部闭合与女高音证据 | 5 |
| 语义置信度 | 5 |

置信度映射：

- `85-100`：`certain`；
- `65-84`：`probable`；
- `40-64`：`ambiguous`；
- 低于 `40`：不输出候选。

若两个不同类型候选的分数差小于 10，最高结果降级为 `ambiguous`，并将另一个候选放入 `alternatives`。最终候选置信度还必须受所属乐句限制：

```text
cadence.confidence = min(cadenceEvidenceConfidence, phrase.confidence)
```

其中 `certain > probable > ambiguous`。因此 `probable` 乐句不能产生 `certain` 终止，`ambiguous` 乐句不能驱动自动染色或高确定性规则。

## 9. 分析层与规则 API

`HarmonyAnalysis` 增加：

```ts
readonly phraseBoundaries: readonly PhraseBoundary[];
readonly phraseBoundaryCandidates: readonly PhraseBoundaryCandidate[];
readonly phraseSegments: readonly PhraseSegment[];
readonly cadenceCandidates: readonly CadenceCandidate[];
readonly cadenceAtTick: ReadonlyMap<number, CadenceCandidate | CadenceAnnotation>;
```

规则上下文增加：

```ts
phrases(options?: PhraseQueryOptions): HarmonyQuery<PhraseView>;
phraseAt(tick: number): PhraseView | undefined;
boundaryAt(tick: number): PhraseBoundary | undefined;
cadences(options?: CadenceQueryOptions): HarmonyQuery<CadenceView>;
cadenceAt(tick: number): CadenceView | undefined;
```

`CadenceView` 提供：

- 范围对象；
- 范围内的 Span 与和弦；
- 当前类型与限定；
- 来源与置信度；
- 检测证据；
- 是否为人工确认、是否过期。

终止式规则只读取 `CadenceView` 和普通 HarmonyQuery，不直接扫描 `ChordRegion[]`。

## 10. 人工确认与工程修改

自动检测和人工确认严格分离：

```text
CadenceCandidate  --确认-->  CadenceAnnotation
```

确认操作：

1. 将候选范围加入 `chordTrack.cadenceAnnotations`；
2. 保留候选计算出的类型和限定；
3. `source` 改为 `accepted-candidate`；
4. 允许用户修改一级类型和适用限定；
5. 不修改范围内每个和弦的 `HarmonySemantics`。

编辑终止类型时只更新一个 `CadenceAnnotation`。规则、染色和检查结果通过分析重新读取该范围，因此不会产生部分和弦更新。

当和弦事件被移动、切分、删除或功能语义改变时：

- 自动候选重新计算；
- 人工范围重新校验；
- 若范围不再覆盖连续和弦或类型不再满足策略，标记为 `stale`；
- 不静默改写人工类型；
- UI 显示“范围需要复核”，允许用户重新识别或删除标注。

## 11. UI 设计

### 11.1 和弦轨染色

`ChordTrack` 根据“人工标注优先、自动候选其次”的映射为每个和弦事件添加：

```text
data-cadence-kind="full|half|supplementary|deceptive"
```

使用浅色背景或顶部色带，不覆盖诊断错误边框。颜色之外还应提供：

- 悬停标题中的终止类型；
- 范围起点和终点标记；
- 可选的终止式图例；
- 候选与人工确认的不同边框样式。

歧义候选只使用虚线或低对比度边界，不使用实色填充。

### 11.2 和弦属性面板

`ChordSemanticsEditor` 只显示和弦级属性。终止式编辑拆为 `CadenceEditor`：

- 当前和弦属于确认范围或候选范围时显示；
- 展示终止范围的起止位置和包含的和弦数量；
- 一级类型使用四项选择；
- 只有 `full` 才显示正格/变格和完满/不完满限定；
- 只有第二转位或明确四六语义时显示四六角色；
- 没有候选或确认范围时隐藏终止类型字段；
- 对自动候选提供“确认”按钮；
- 对失效人工标注显示复核状态。

如果用户需要手动创建检测器没有发现的终止式，应通过“创建终止范围”命令选择起止和弦，再进入 `CadenceEditor`，而不是让普通和弦面板始终显示终止类型。

## 12. 规则迁移

现有规则迁移方向：

| 现有规则 | 新读取方式 |
| --- | --- |
| `cadence.bass-formula` | 从 `CadenceView` 获取范围首尾和弦、低音与类型 |
| `cadence.perfect-authentic-soprano` | 仅对 `full + authentic + perfect` 检查 |
| `cadence.unstable-ending` | 对 `full` 或 `supplementary` 的稳定结束检查 |
| `function.cadential64-target` | 继续读取和弦的 `cadenceRole` |
| `function.deceptive-cadence-target` | 读取 `CadenceView.kind === "deceptive"`，同时保留局部 `cadenceRole` 检查 |
| `cadence.cadential64-metric-position` | 继续读取 K46 的 `cadenceRole` 和连接节拍 |

没有人工标注时，规则可以选择使用 `certain` 自动候选；`probable` 和 `ambiguous` 默认只用于 UI，不驱动高确定性规则诊断。

## 13. 测试计划

### 13.1 乐句分析测试

至少覆盖：

1. 工程起点和终点自动形成确定边界；
2. 人工边界形成不重叠的相邻 `PhraseSegment`；
3. 边界按 tick 排序且重复边界被合并；
4. 调性变化、休止断点和分析不可用区间不会被错误跨越；
5. 普通强拍不会单独形成确定乐句边界；
6. 全声部结束、空白和稳定和声可以生成带证据的边界候选；
7. 相邻强拍不会被切成连续短乐句；
8. 自动边界候选不会修改工程；
9. `ambiguous` 乐句不会产生 `certain` 边界。

### 13.2 检测单元测试

至少覆盖：

1. 在确定乐句末端的 `D -> T` 识别为 `full + authentic`；
2. 原位 D、原位 T、女高音主音识别为 `perfect`；
3. D/T 转位或女高音非主音识别为 `imperfect`；
4. 确定乐句末端的 `S -> T` 识别为 `supplementary + plagal`；
5. 确定乐句以 D 结束识别为 `half`；
6. 确定乐句末端的 `D -> VI` 识别为 `deceptive`；
7. `K46 -> D -> T` 范围包含三个和弦；
8. K46 没有连续进入 D 时不加入终止范围；
9. 连续和声中的 `D -> T` 不自动识别为终止；
10. 乐句中间的 `D -> T`、`S -> T` 和 `D -> VI` 不识别为终止；
11. 调性变化、歧义语义、休止断点和歧义乐句不生成 `certain`；
12. 同分候选降级为 `ambiguous`；
13. 自动候选不修改工程对象；
14. 终止候选置信度不超过所属乐句置信度。

### 13.3 编辑与持久化测试

1. 修改一个终止标注的类型只产生一次 `CadenceAnnotation` 更新；
2. 范围内所有和弦读取相同的终止类型；
3. 移动或删除范围内和弦后标注进入 `stale`；
4. 锁定和弦或锁定和弦轨时不能修改终止标注；
5. 旧 `cadenceType` 不参与新模型；规范化时仅清理残留字段；
6. 终止标注不复制到和弦 `HarmonySemantics`。

### 13.4 UI 测试

1. 四种终止使用稳定、可区分的颜色；
2. 诊断错误样式与终止色带同时存在时不互相覆盖；
3. 无终止候选的普通和弦不显示终止类型控件；
4. K46 显示四六角色，普通原位和弦不显示四六角色；
5. 修改终止类型后整个范围同步更新；
6. 歧义候选不显示为已确认终止；
7. 自动候选确认后才进入持久化状态。

## 14. 实施顺序

### 阶段一：领域模型与检测器

- 新增 `PhraseBoundary`、`PhraseBoundaryCandidate`、`PhraseSegment`；
- 增加工程结构中的人工乐句边界和编辑命令；
- 在 `HarmonyAnalysis` 生成乐句分段与乐句查询 API；
- 新增 `CadenceKind`、`CadenceCandidate`、`CadenceAnnotation`；
- 新增连接、分类和评分函数；边界评分只属于乐句分析器；
- 将终止检测挂入 `HarmonyAnalysis`；
- 完成检测器单元测试。

### 阶段二：持久化与上下文 API

- 更新结构数据的校验、规范化、序列化和增量失效范围；
- 在 `ChordTrack` 增加终止标注集合；
- 更新默认工程、校验、规范化和编辑命令；
- 第一阶段只允许人工乐句边界驱动确定性终止；
- 第二阶段加入自动乐句边界候选和置信度传播；
- 增加 `phrases()`、`phraseAt()`、`boundaryAt()` 查询；
- 增加 `cadences()`、`cadenceAt()` 查询；
- 迁移现有终止规则。

### 阶段三：编辑器与视觉标识

- 增加 `CadenceEditor`；
- 调整 `ChordSemanticsEditor` 的属性可见性；
- 增加终止范围染色、图例、悬停信息和确认操作；
- 完成 UI 回归测试。

### 阶段四：清理旧模型（已完成）

- 删除 `HarmonySemantics.cadenceType`；
- 删除按单个和弦编辑终止类型的 action；
- 删除规则中直接读取 `semantics.cadenceType` 的路径；
- 更新开发者检查器、调试报告和测试夹具。

当前实现还提供了工程面板中的人工乐句边界编辑、选中和弦后的终止候选确认、范围级终止类型编辑，以及和弦轨的候选/人工标注染色。移动、切分或删除和弦导致范围无法覆盖连续事件时，规范化会把人工标注标记为 `stale`，不会静默改变用户选择的类型。

## 15. 非目标与风险

第一阶段不自动推断：

- 没有明确结构边界的中间 D-T；
- 复杂转调或共同和弦重解释中的终止；
- 仅凭旋律或节拍、没有可靠和声功能的终止；
- 教材之间定义不一致的特殊终止名称。

最重要的风险是把“功能连接”误当成“终止式”。因此检测器必须把结构边界作为必要条件，并将低置信度结果作为候选而非直接标注。终止颜色也必须来自统一的范围映射，不能在每个和弦组件内分别根据局部字段猜测。
