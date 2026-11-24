# 和声规则运行时与 Obligation 状态

本文说明规则调度、无状态 evaluator、自定义有状态规则与跨切片 obligation 规则的当前运行时契约。

## 1. 规则执行形态

内置规则在运行时分为三类实现方式（均共享同一个只读 `HarmonyRuleContext`，查询 API 不保存规则状态）：

- **无状态规则（`defineStatelessRule`）：** 一次读取同一 revision 的分析快照，返回自己的诊断列表与可选 skip。
- **低层有状态规则（`defineStatefulRule`）：** 直接实现 `process(context, incoming, config)` 与可选 `finalize(context, remaining, config)`，自主维护 `RuleStateEnvelope` 列表（例如 [`stateful.ts`](../src/domain/harmony/rules/groups/stateful.ts) 中的 `G.2` `function.applied-dominant-target`）。
- **义务规则（`defineObligationRule`）：** 建立在 `defineStatefulRule` 之上的托管状态机，在某个切片开启音乐义务，随后逐切片转移，直到解决、违反、取消或工程结束（当前用于 `E.1`–`E.4` 四条倾向音解决规则）。

## 2. RuleScheduler 运行时契约

[`RuleScheduler`](../src/domain/harmony/runtime.ts) 负责分析快照缓存、前置条件短路、增量复用与并发取消：

- **`prepareAnalysis(project, revision)` 签名缓存：** 仅使用音乐内容（`ppq`、`lengthTicks`、`tempoEvents`、`meterEvents`、`keyEvents`、`satbTracks`、`chordTrack`、`auxiliaryTracks`、`structure`）构造签名，排除规则 profile 与 UI 元数据。签名未变时直接复用既有 `HarmonyAnalysis`，仅更新 `revision` 并置空 `invalidationRanges`。
- **`canReuseRuleResults` 单规则缓存复用：** 当 `analysis.invalidationRanges` 为空且当前快照相对上次完成检查的快照（`completedRuleSnapshot`）无失效区间时，调度器按每条规则的 `{ severity, config, exceptions }` 签名判断是否复用上次的诊断与 skip 结果；只改某条规则的配置时不会重跑其余规则。
- **`requirementSkips` 前置跳过：** 在执行规则前根据 `definition.requires`（`chords`、`complete-satb`、`semantics`）检查快照上下文。全量条件不满足（`partial: false`）时直接跳过执行并记录结构化 skip（`no-chords` / `insufficient-context` / `missing-semantics` / `ambiguous-semantics`）；部分缺失（`partial: true`）时附带 skip 记录并继续运行规则。
- **`RuleStepContext`：** 有状态规则逐切片接收只读步骤上下文，包含：
  ```ts
  interface RuleStepContext {
    readonly analysis: HarmonyAnalysis;
    readonly rules: HarmonyRuleContext;
    readonly slice: AnalysisSlice;
    readonly sliceIndex: number;
    readonly previous?: AnalysisSlice;
    readonly transitionFromPrevious?: SliceTransition;
    readonly span?: HarmonySpan;
    readonly isSpanStart: boolean;
    readonly isSpanEnd: boolean;
  }
  ```
- **状态信封校验：** 每步返回的 `outgoing` 均经 [`policy/state.ts`](../src/domain/harmony/rules/policy/state.ts) 的 `validateRuleStates` 校验所有权（`ownerRuleId`）、ID 唯一性、`createdAt` 单调范围、对象引用存在性、纯 JSON 合法性、数量上限（512）与单条负载上限（16 KiB）。

## 3. Obligation 数据

底层运行时状态是 `RuleStateEnvelope`，所有权归创建它的规则：

```ts
{
  id,
  ownerRuleId,
  createdAt: { tick, sliceIndex },
  subjectRefs: { voiceIds, noteIds, chordIds, spanIds },
  payload
}
```

`payload` 必须是纯 JSON。宿主校验规则归属、引用、时间、数量和大小；规则不能读取或修改其他规则的状态。

`obligation-v2` 在信封 `payload` 内封装了 `engine: "obligation-v2"`、`partitionKey`、规则私有 `payload` 和最多保留 32 项的 `history`。历史记录包括 `tick`、`outcome` 和 `reason`，用于诊断 trace，不是新的决策输入。

定义期校验：`defineObligationRule` 注册时会执行 `assertRequirements(metadata.id, metadata.requires, source.requires)`，确保义务源声明的所有前置依赖都已在规则自身的 `requires` 中声明，否则立即抛出错误。

## 4. 逐切片流程

[`obligation.ts`](../src/domain/harmony/rules/state/obligation.ts) 对每个分析切片按需通过 [`tendencyContext.ts`](../src/domain/harmony/rules/state/tendencyContext.ts) 的 `analysisMoment(context)` 构造 `AnalysisMoment`，并严格按以下顺序处理：

```text
1. 遍历 incoming 中的既有义务
   -> 调用 transition({ context, moment, config, obligation })
   -> 根据 decision 更新 outgoing / 产生诊断 / 删除状态
2. 调用 source.collect({ context, moment, config }) 收集本切片新候选
   -> 按 partitionKey 与当前 outgoing 中的既有状态匹配
   -> 应用 retrigger 策略决定保留、刷新、分叉或抛错
   -> 为新开启的候选创建信封并写入 outgoing
3. 工程末尾由 finalize 处理剩余状态（默认 onEnd: "cancel"）
```

> 同切片刚刚由 `source.collect` 开启的义务只进入 `outgoing`，不会在同一切片立即运行 `transition`，而是从下一个切片起进入 `incoming` 接受转移检查。

职责边界：`source` 只负责发现候选；`transition` 只负责当前义务的音乐推理；`reportViolation` 只负责构造该规则的诊断，不应偷偷改变状态。

结果语义：

- `continue`：义务仍然有效，保留状态并追加到 `history`。
- `indeterminate`：证据不足；与 `continue` 一致，统一保留状态并记入 `history`，不会自动当作违规。
- `resolve`：义务已满足，记录 trace 后删除状态。
- `violate`：义务未满足，调用 `reportViolation` 生成诊断（附带义务调试快照）并删除状态。
- `cancel`：上下文表明义务不再适用，静默删除状态。

`transition` 返回 `undefined` 时遵循 `onNoDecision`（默认 `"continue"`，可选 `"cancel"`）；工程结束时由 `finalize` 遵循 `onEnd`（`"cancel"`），将剩余义务记为 `project-ended` 并清理。

## 5. 重触发与分区

同一 `partitionKey` 表示同一项音乐义务。本切片 `source.collect` 产生的新候选与当前 `outgoing` 中已有同分区义务冲突时，由 `retrigger` 明确决定：

- `retain-existing`：保留既有义务，忽略本次新触发；
- `refresh-source`：将同分区的既有义务以 `obligation-source-refreshed` 取消并移出 `outgoing`，再写入新候选；
- `fork`：保留既有义务，同时为新候选创建独立义务；
- `reject`：视为非法重复触发，直接抛出 `Error`。

分区键必须反映真实音乐身份，例如声部、来源 span、书写音高和固定解决目标。不能只使用当前切片或 MIDI 音高，以免 `V -> V7`、同音重复或跨声部轮转被错误结算。

## 6. 诊断与调试追踪

义务违反时，诊断应通过 `obligationDiagnosticContext` 引用：

- `subjects.origin`：义务的来源音符、和弦或 span；
- `subjects.failure`：实际导致违反的事件；
- `subjects.context`：判断所需的邻域或连接；
- `trace`：每次状态转移的结果和原因。

运行时同时维护两套基于 `WeakMap<HarmonyAnalysis, ...>` 的调试追踪能力：

- **`inspectTrace(analysis)`：** `defineObligationRule` 返回的规则对象附带 `inspectTrace(analysis)` 方法，用于测试和调试期读取该次分析中全部义务的转移轨迹；单次分析最多保留 **4096 条** `ObligationRuntimeTraceEntry`（超限时裁剪最早记录）。
- **`createObligationDebugSnapshot`：** 当 `transition` 返回 `violate` 并生成诊断时，运行时自动从按义务 ID 缓存的步骤记录（每项义务最多保留 **64 步** `DiagnosticDebugObligationStep`）调用 [`diagnosticDebug.ts`](../src/domain/harmony/debug/diagnosticDebug.ts) 的 `createObligationDebugSnapshot`，挂载 `kind: "stateful-obligation"` 的 `satb-diagnostic-debug/v1` 调试快照。

规则应在 `debugFacts` 或 `trace` 中记录影响结论的事实，不得把完整分析对象复制到状态 `payload`。详细格式见 [diagnostics-and-debugging.md](./diagnostics-and-debugging.md)。

主要源码入口：

- [`runtime.ts`](../src/domain/harmony/runtime.ts)
- [`obligation.ts`](../src/domain/harmony/rules/state/obligation.ts)
- [`tendencyContext.ts`](../src/domain/harmony/rules/state/tendencyContext.ts)
- [`policy/state.ts`](../src/domain/harmony/rules/policy/state.ts)
