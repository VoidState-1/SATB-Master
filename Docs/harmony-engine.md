# 和声语义与规则引擎

本文说明内置和声检查从工程快照到最终诊断的标准处理流程，以及切片、`HarmonySpan`、精确连接、规则私有状态、适用性和诊断仲裁的职责边界。音高与和弦持久化模型见 [data-model.md](./data-model.md)，外置脚本契约见 [external-rules.md](./external-rules.md)。

## 1. 术语边界

传统和声中的“功能”特指 T/S/D 功能体系。代码中不再用“功能分析”泛指和弦用途，也不保留粗粒度 `FunctionalClass` 兼容层：

- **和弦实体（identity）：** 根音、结构、构成音、低音与转位。
- **和声语义（semantics）：** 局部调性、级数、离调目标、混合、终止角色、持续低音和一个或两个解释。
- **功能标记（functional designation）：** 斯波索宾 T/S/D 体系的结构化标记。
- **跨度（span）：** 连续且实体、调性和语义相同的一段和声。
- **连接（connection）：** 相邻 span 之间基于精确解释得到的关系和证据。
- **适用性（applicability）：** 某条规则面对本次上下文时应严格执行、降级、豁免或延后。

语义字段是证据，不是互相覆盖的单一最终标签。规则必须声明依赖，面对缺失或歧义时保守处理。

## 2. 总体流水线

```mermaid
flowchart LR
  P["ProjectDocument"] --> F["冻结 ProjectSnapshot"]
  F --> S["AnalysisSlice"]
  S --> T["旋律与切片转换"]
  S --> H["HarmonySpan"]
  H --> C["HarmonyConnectionAssessment"]
  T --> X["共享事实"]
  C --> R["规则运行时"]
  X --> R
  R --> A["RuleApplicabilityPlanner"]
  A --> V["校验与严重程度"]
  V --> D["DiagnosticArbiter"]
  D --> O["HarmonyDiagnostic + SkippedRule"]
```

主要源码入口：

- [`harmonyAnalysis.ts`](../src/domain/harmonyAnalysis.ts)：冻结快照、切片、转换、span、索引和失效范围。
- [`rules/sharedFacts.ts`](../src/domain/rules/sharedFacts.ts)：书写音程、声部对、低音运动和和弦成员事实。
- [`rules/connector.ts`](../src/domain/rules/connector.ts)：精确 span 连接。
- [`harmonyRuntime.ts`](../src/domain/harmonyRuntime.ts)：无状态/有状态规则调度与结果收敛。
- [`rules/applicability.ts`](../src/domain/rules/applicability.ts)：特例上下文折叠。
- [`rules/diagnosticArbiter.ts`](../src/domain/rules/diagnosticArbiter.ts)：稳定根因键、合并与父子覆盖。
- [`harmonyRules.ts`](../src/domain/harmonyRules.ts)：当前规则实现入口。
- [`rules/catalog.ts`](../src/domain/rules/catalog.ts)：81 条规则目录、配置声明和实现状态。

分析输入是指定 revision 的不可变快照。规则不得修改工程，只能返回原始诊断或结构化 skip。

## 3. 时间切片

`AnalysisSlice` 是一段 SATB 活跃音符、调号和和弦上下文均不变化的半开时间区间：

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
  continuity: "continuous" | "project-start";
}
```

边界来自 SATB 音符起止、和弦区域起止、调号变化和工程起止。切片反映持续状态，`attackVoiceIds` 区分本 tick 新起奏与延音；规则不能把每个切片都当成新音。

`MelodyTransition` 连接同一声部的连续起奏音，包含休止连续性、调性/和声是否相同及书写音程。`SliceTransition` 连接相邻切片，记录变化声部、连续性和上下文关系。

## 4. HarmonySpan

多个相邻和弦区域满足以下条件时聚合为一个 span：

- 时间首尾相接；
- 局部调性相同；
- 忽略低音后仍为同一和弦实体；
- 和声语义上下文一致。

```ts
interface HarmonySpan {
  id: string;
  fromTick: number;
  toTick: number;
  regionIds: readonly string[];
  sliceIndices: readonly number[];
  identityKey: string;
  semantics?: HarmonySemantics;
  status: "complete" | "ambiguous";
  entryTransitionIndex?: number;
  exitTransitionIndex?: number;
}
```

这使一个、两个或任意多个连续同和弦转换拥有同一处理方式。休止、时间缺口、调性变化、实体变化或语义解释变化都会断开 span。`sliceSpanIds` 和 `chordSpanIds` 提供稳定查询，规则不应自行按显示名称重新聚合。

span 只表达区段事实，不承担“导音必须上行”等规则结论。解决要求属于具体规则的私有状态。

## 5. 精确和弦连接

`buildHarmonyConnections` 只连接时间顺序相邻的 span，并产生：

```ts
interface HarmonyConnectionAssessment {
  previousSpanId: string;
  currentSpanId: string;
  previousInterpretationId?: string;
  currentInterpretationId?: string;
  relation:
    | "same-harmony"
    | "tonic-departure"
    | "predominant-to-dominant"
    | "dominant-to-tonic"
    | "deceptive"
    | "applied-target"
    | "double-dominant-target"
    | "cadential64-target"
    | "retrogression"
    | "pivot-reinterpretation"
    | "unknown";
  contiguous: boolean;
  sameKey: boolean;
  targetMatched?: boolean;
  exceptionTags: readonly RuleExceptionContext[];
  evidence: readonly ConnectionEvidence[];
  confidence: "certain" | "probable" | "ambiguous" | "unknown";
}
```

连接器读取主要 `HarmonyInterpretation`、`FunctionalDesignation`、离调目标、终止角色和持续低音上下文。它可以判断 D 到 T、S 到 D、离调属目标、重属目标、K46 目标、阻碍进行、逆功能进行和共同和弦重新解释。

连接器提供“发生了什么”的结构化事实，不决定某一规则是否报警。不同教材口径通过规则严重程度、配置和特例策略表达，不能重新引入一个粗粒度枚举替代精确解释。

## 6. 共享事实

跨规则重复使用的低层事实集中计算：

- `voicePairTransitionFacts`：六组声部对的前后书写音程、上下运动、同向性、外/内声部身份和低音运动。
- `bassMotionFact`：按字母级数与实际方向区分上行级进、下行级进、保持和其他运动。
- `chordMemberFacts`：每个活跃音符是否属于当前 `ChordIdentity`，以及对应构成音索引。

平行五八度、不等五度、隐伏进行和对斜等规则必须共享书写音高口径，避免各自按 MIDI 半音重新推导而产生互相矛盾的结果。

## 7. 规则目录与实现

设计清单由 [`harmony-rule-catalog.md`](../DesignDocs/harmony-rule-catalog.md) 维护，并通过 [`generate-rule-catalog.mjs`](../scripts/generate-rule-catalog.mjs) 生成静态目录。`HarmonyRuleDefinition` 包含稳定 ID、目录号、说明、理由、分组、默认严重程度、依赖、配置版本、声明式 options、特例 context、父规则和 `implemented` 状态。

目录条目不等于可执行实现。设置页会显示所有 81 条规则，但 `implemented: false` 的条目明确标记“尚未实现”并禁用执行配置。只有同时存在规则定义和实现的条目进入调度。

## 8. 规则私有状态

跨切片规则使用通用 `RuleStateEnvelope`：

```ts
interface RuleStateEnvelope<T extends JsonValue = JsonValue> {
  id: string;
  ownerRuleId: string;
  createdAt: { tick: number; sliceIndex: number; spanId?: string };
  subjectRefs: {
    voiceIds: readonly VoiceId[];
    noteIds: readonly string[];
    chordIds: readonly string[];
    spanIds: readonly string[];
  };
  payload: T;
}
```

每条规则只能读取并返回自己的状态。`payload` 是规则私有 JSON；宿主只校验所有权、引用、时间、数量和大小，不解释“导音”“七音”“挂留”等类型，也不决定何时满足。典型流程是：

```text
process 当前 step
-> 检查 incoming
-> 满足、保留或报告后删除
-> 根据当前证据创建 outgoing
-> 工程末尾由 finalize 处理剩余状态
```

这种“包裹盒”允许导音、七音、延迟解决、和声切分等规则各自定义结束条件，同时共享相同横向传递协议。

## 9. 适用性计划

规则在原始诊断上附加自己支持的 `exceptionContexts`。`planRuleApplicability` 将目录默认策略、工程覆盖和本次 context 折叠为：

- `strict`：正常报告；
- `downgraded`：严重程度降低一级；
- `skip`：按明确豁免不报告；
- `deferred`：上下文不足或歧义无法形成可靠结论。

未在规则定义中声明支持的 context 会被过滤。`same-harmony`、`voice-exchange`、`bass-step-up`、`pedal-point` 或 `modulation` 不会成为全局万能豁免，只有具体规则选择支持后才生效。

## 10. 校验与诊断仲裁

原始诊断先验证范围、对象引用、消息、置信度和证据，再由宿主注入工程严重程度并生成稳定根因键。最终仲裁包含：

1. 同规则、同根因、同对象且时间相接的诊断合并为范围。
2. 子规则与父规则命中同对象、同时间时只保留更具体的子规则。
3. 结果按时间、严重程度和稳定 ID 排序，规则注册顺序不影响输出。

稳定根因键由规则 ID、规范对象范围、时间、证据 ID 与 `rootCauseKey/messageKey` 组成。自然语言消息不应承担去重身份。

和弦整体问题必须归属 `chordIds`，避免在四个音符上重复显示；旋律和声部进行问题才归属对应音符。UI 根据对象引用显示悬停诊断与证据。

## 11. 工程 RuleProfile

规则设置是工程数据，而不是应用 localStorage 中的运行时真相源：

```ts
interface RuleProfile {
  profileVersion: 1;
  title: string;
  shared: SharedHarmonySettings;
  builtin: Record<string, RuleInstanceSettings>;
  external: ExternalRuleReferenceV3[];
}
```

每个规则实例保存 `severity`、`configVersion`、规范化配置和特例覆盖。`shared` 当前包含四声部建议音域及严格四声部织体开关。工程历史提交负责撤销/重做，保存与恢复直接持久化完整 profile。

应用级 localStorage 只保存“新建工程默认模板”，不会静默覆盖当前工程。`.satb-rule-profile.json` 用于便携导入导出：导出展开所有已知内置规则；导入报告新增、变化、移除、未知规则、缺失外置包和修复键，并通过一次历史提交应用。

## 12. 运行与并发

内置分析与外置规则请求都携带 revision。旧请求晚返回时标记为 superseded，不能覆盖新工程结果。外置脚本在 Worker + QuickJS 中隔离；其失败记录在独立 failure 列表，不能清空内置诊断。

`AnalysisInvalidationRange` 已记录受影响 tick 与依赖 scope，为后续增量失效和缓存提供契约。当前不要假设完整的 5,000 音符性能目标已经完成，性能基准和桌面 E2E 仍属于收敛阶段。

## 13. 新增规则流程

1. 在设计清单中确定稳定目录号、ID、默认严重程度、规则口径和反例。
2. 重新运行目录生成器，不手改 `catalog.generated.ts`。
3. 在 `catalog.ts` 声明 options、依赖、父规则和支持的特例 context。
4. 使用共享 facts、span 和 connection 实现规则；跨时间结论使用私有状态。
5. 让诊断引用正确对象，提供稳定 messageKey/rootCauseKey 和结构化证据。
6. 加入最小违规、合法邻例、同和弦、大小调、书写等音、歧义和配置测试。
7. 只有实现与金样本完成后才把条目标记为 `implemented`。

## 14. 当前完成边界

规则目录、工程 profile、共享事实、span、连接器、适用性、仲裁、设置页和外置 API v3 已落地。Phase E 当前已启用 D.10-D.13、E.3-E.5、G.5、H.9-H.12 与 K.4：包括 D9/增六配置、属九/方向性变音/增六解决、人工阻碍进行、三种增六连接和同主大小调借用来源。

G.6、H.1-H.8、J.1-J.2、K.2-K.3 仍保持 `implemented: false`。它们分别缺少“所有解释候选的合法性比较”、按转位校准的功能和弦连接金样本、变拍号重音层级，以及人工转调/进入侧/离开侧标记。不得用当前主要解释、`beatIndex === 0` 或局部调外音数量代替这些前置事实。

目录中的其余条目仍以“尚未实现”状态展示。开发者必须以 `HARMONY_RULE_DEFINITIONS[].implemented` 和对应测试为准，不能把“目录中存在”解释为“规则已完成”。
