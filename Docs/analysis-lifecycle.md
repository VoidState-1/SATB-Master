# 和声分析生命周期与缓存边界

本文补充 [analysis-inference.md](./analysis-inference.md) 与 [harmonization.md](./harmonization.md)，专门说明和声分析快照、候选与工程事实、只读预推导、写回路径以及调度器与 Worker 缓存的生命周期边界。

## 1. HarmonyAnalysis 是只读快照

[`buildHarmonyAnalysis(project, revision = 0, previousSnapshot?: ProjectSnapshot)`](../src/domain/harmony/analysis.ts) 会先对工程文档执行 `deepFreeze(structuredClone(project))`，在给定 `revision` 上构造深度只读的 `HarmonyAnalysis` 快照，包含：

- **基础时间与结构事实**：`revision`、`project`（`ProjectSnapshot`）、`metricTimeline`、`phraseBoundaries`、`phraseBoundaryCandidates`、`phraseSegments`；
- **终止式与实时观测视图**：`cadenceCandidates`、`cadenceAnnotations`、`cadenceAtTick`；
- **离散切片与和声区段**：`slices`、`harmonySpans`、`sliceSpanIds`、`chordSpanIds`；
- **过渡、延展与共享事实**：`melodyTransitions`、`sliceTransitions`、`connections`、`writtenProlongations`（`ReadonlyMap<number, WrittenProlongation>`，来自 `src/domain/harmony/facts/prolongation.ts`）、`targetChains`、`contextFacts`；
- **按声部与 ID 建立的只读索引**：`notesByVoice`、`noteById`、`noteVoiceById`、`chordById`；
- **失效范围与辅助轨摘要**：`invalidationRanges`（对比 `previousSnapshot` 计算）与 `auxiliarySummary`（`{ trackCount, noteCount }`，不暴露辅助轨明细）。

规则只能读取快照，不得直接突变任何工程对象。

### 1.1 终止式观测标注的动态过期审查

部分已保存的终止式标注来源于采纳的实时候选，带有 `observedLandingTick` 与 `source: "accepted-candidate"`。在 `buildHarmonyAnalysis` 构造快照时：

1. 若 `project.chordTrack.cadenceAnnotations` 中存在带 `observedLandingTick` 的标注，会对每条标注调用 [`reviewObservedCadenceAnnotation(annotation, cadenceCandidates)`](../src/domain/harmony/cadence/model.ts)，核对本次实时检测到的 `cadenceCandidates` 中是否存在非歧义且 `observedLandingTick`、`fromTick`/`toTick`、`phraseId`、`kind`/`form`/`completion` 完全匹配的候选；若无法匹配，则在快照视图中动态标为 `stale: true`。
2. 构造 `cadenceAtTick` 索引时，先写入所有实时 `cadenceCandidates`（以 `fromTick` 为键），再合入 `cadenceAnnotations`。若某条标注带 `observedLandingTick` 且已动态判定为 `stale`，而同一 `fromTick` 已存在实时候选，则该过期标注**不会**覆盖实时候选，保证规则与 UI 看到最新谱面的有效终止。

## 2. 候选、只读预推导与工程写回边界

```text
只读分析 / 预推导    -> 产出带证据/置信度的候选或方案（不修改输入工程）
用户确认 / 应用流程  -> 领域层校验并生成新工程文档
历史提交             -> 单步 editing.ts 或 replaceProject 原子提交
下一 revision        -> 调度器重建分析快照并刷新诊断
```

### 2.1 只读推导边界

- **普通实时分析**：`buildHarmonyAnalysis` 通过 [`cadenceInputs`](../src/domain/harmony/cadence/projectEvidence.ts) 统一调用 `analyzePhrases(project, { generateCandidates: false })`，只消费已保存且未过期的乐句边界，不扫描新的乐句候选；终止式检测消费最终 `PhraseSegment[]`，不自行创建乐句边界。
- **和弦推导只读预推导**：[`prepareInferenceContext`](../src/domain/harmony/inference/candidates.ts) 在执行和弦推导前，会显式传入 `chordRegions: []` 只读预跑 `inferPhrases`，提取基于音符/节奏的 `terminalTicks`（用于解锁乐句末主和弦省略五音及辅助 `inferLocalKeys` 识别局部调性），不污染当前工程的已有标注。
- **自动配和声只读预推导**：[`buildMelodyGrid`](../src/domain/harmony/harmonization/melodyGrid.ts) 在构造给定声部时间网格时，会围绕该单声部音符只读调用 `inferPhrases`（结合人工边界与四小节规整节奏）规划乐句边界与终止区，同样不改动源工程。
- **候选不是标注**：`phraseBoundaryCandidates` 与 `cadenceCandidates` 仅为当次只读结果，不等同于已持久化的 `phraseBoundaries` / `cadenceAnnotations`。过期的自动边界或观测终止标注可保留供人工核对，但不应覆盖或参与有效规则分析。

### 2.2 工程写回的两类路径

所有变更都必须产生新的工程实例与新 `revision`，分为两类写回路径：

1. **单步编辑命令**：常规音符、和弦、调号/拍号、乐句边界与终止式标注的增删改经 [`src/domain/editing.ts`](../src/domain/editing.ts) 的命令函数完成，并由控制器提交历史栈。
2. **批量方案写回**：自动配和声（`applyAutoHarmonization`）、半自动和声连接助手（`applyProgressionCandidate`）以及自动和弦/完整和声推导（`applyChordInference` / `applyHarmonyInference`）在领域层基于克隆副本构造新工程并执行结构校验（如 `validateProject` 守门，或通过 `addChordRegion` 逐区段校验锁定与调号边界），随后由应用层经 `replaceProject` 与 `history.commit` 一次性原子提交历史，支持单步撤销/重做。

## 3. 并发调度、缓存与 Worker 生命周期

### 3.1 RuleScheduler 两层缓存与取消隔离

[`RuleScheduler`](../src/domain/harmony/runtime.ts) 将**音乐分析快照缓存**与**规则结果缓存**严格分层：

- **`prepareAnalysis(project, revision)`**：仅对音乐相关字段（`ppq`、`lengthTicks`、`tempoEvents`、`meterEvents`、`keyEvents`、`satbTracks`、`chordTrack`、`auxiliaryTracks`、`structure`）生成签名，不包含规则 profile 或 UI 元数据。
  - 只修改规则严重程度、参数配置或特例策略时，签名不变，直接复用 `cachedAnalysis`（仅更新 `revision` 并将 `invalidationRanges` 置空），仅重跑配置发生变化的规则。
  - 修改音符、和弦、调号、拍号、长度或结构时，签名变化，重新调用 `buildHarmonyAnalysis(project, revision, this.cachedAnalysis?.project)` **整份重建**快照并计算 `AnalysisInvalidationRange[]`；`AnalysisInvalidationRange` 当前用于“是否允许复用上轮规则结果（`invalidationRanges.length === 0`）”的判定，而非对既有快照做切片级局部修补。
- **`run(request)` 区分 `cachedAnalysis` 与 `completedRuleSnapshot`**：`cachedAnalysis` 在 `prepareAnalysis` 时即已更新，但若该轮 `run` 在执行途中被新请求抢占（`token !== this.runToken`）或经 `AbortSignal` 取消，将直接返回 `superseded: true` 且**不会**更新 `completedRuleSnapshot` 与规则结果缓存。下一轮运行在决定 `canReuseRuleResults` 时，除要求 `analysis.invalidationRanges.length === 0` 外，还会核对 `this.completedRuleSnapshot === analysis.project`（或两者间的 `computeAnalysisInvalidationRanges` 为空），防止取消后把旧快照的规则结果误复用到新音乐快照上。

### 3.2 内置与外置规则共享快照调度

[`useHarmonyController.ts`](../src/app/controllers/useHarmonyController.ts) 负责驱动实时检查：

- 每次 `project`、`resolvedRuleProfile` 或外置规则包列表变化时，递增 `harmonyRevisionRef` 并创建新的 `AbortController`。
- 先由 `harmonySchedulerRef.current.prepareAnalysis(project, revision)` 准备**同一份**只读 `HarmonyAnalysis` 快照，再并发派发内置规则（`scheduler.run`）与外置规则（`externalRuleRuntimeRef.current.run`）。
- 为降低首屏/编辑延迟，内置规则完成后即先更新诊断状态；外置规则随后完成且未被取消或标记 `superseded` 时，再经 `mergeHarmonyWithExternalRules` 合并诊断并上报错误或慢检查（`>= 200ms`，日志约定见 [logging-and-observability.md](./logging-and-observability.md)）。
- Effect 清理时同步执行 `controller.abort()` 与 `externalRuleRuntimeRef.current.cancel()`，保证过期异步响应不会覆盖最新结果。

### 3.3 和声连接助手的 Worker 生命周期

半自动和声连接助手的后台搜索由 [`useProgressionAssistant.ts`](../src/app/controllers/useProgressionAssistant.ts) 与 [`src/workers/progressionSearch.worker.ts`](../src/workers/progressionSearch.worker.ts) 协同完成（算法与数据模型详见 [harmonization.md](./harmonization.md)）：

- 仅在面板开启且未处于播放状态时构造查询；光标、工程或参数变化后经过 **60ms 防抖**（`SEARCH_DELAY_MS = 60`）才启动搜索。
- 每次搜索创建**一次性模块 Worker**（`new Worker(..., { type: "module" })`），发送 `{ project, options }` 请求。
- 收到响应、发生 `error`/`messageerror`，或在新查询到来/组件卸载触发 effect 清理取消时，立即调用 `worker.terminate()` 释放线程，避免旧查询滞留阻塞或覆盖当前光标的候选结果；慢搜索（`>= 150ms`）与失败按 5 秒节流写入日志（见 [logging-and-observability.md](./logging-and-observability.md)）。

## 4. 当前实现边界

- `buildHarmonyAnalysis` 通过 `cadenceInputs` 固定以 `analyzePhrases(project, { generateCandidates: false })` 运行；需要生成乐句边界候选时，必须显式进入 `inferPhrases` 或完整和声推导流程。
- 有和弦区域时，`inferPhrases` 已通过 [`phrase/segmentation.ts`](../src/domain/harmony/phrase/segmentation.ts) 的全局动态规划（`selectEventDivisions`）支持任意多乐句（`template.kind === "multi"`）；`REGULAR_PHRASE_POLICY.maxAutomaticPhrases`（3）仅作用于无和弦输入时的规则比例模板回退，不再代表主路径上限。
- `ChordInferenceRegionStatus.blocked` 仍是类型层预留状态，当前推导流程尚不产出该状态。

## 5. 源码入口

- [`src/domain/harmony/analysis.ts`](../src/domain/harmony/analysis.ts)：`buildHarmonyAnalysis`、`computeAnalysisInvalidationRanges` 与只读快照类型定义。
- [`src/domain/harmony/runtime.ts`](../src/domain/harmony/runtime.ts)：`RuleScheduler`、同步/异步规则运行器与两层缓存边界。
- [`src/domain/harmony/cadence/projectEvidence.ts`](../src/domain/harmony/cadence/projectEvidence.ts)：`cadenceInputs` 与 `detectProjectCadences` 统一只读入口。
- [`src/domain/harmony/cadence/model.ts`](../src/domain/harmony/cadence/model.ts)：`reviewObservedCadenceAnnotation`、`annotationFromCadenceCandidate` 与终止式数据模型。
- [`src/domain/harmony/cadence/detect.ts`](../src/domain/harmony/cadence/detect.ts)：`detectCadences` 检测实现。
- [`src/domain/harmony/phrase/analyze.ts`](../src/domain/harmony/phrase/analyze.ts) 与 [`src/domain/harmony/phrase/segmentation.ts`](../src/domain/harmony/phrase/segmentation.ts)：乐句边界分析与多乐句切分。
- [`src/domain/harmony/inference/candidates.ts`](../src/domain/harmony/inference/candidates.ts) 与 [`src/domain/harmony/inference/pipeline.ts`](../src/domain/harmony/inference/pipeline.ts)：只读预推导上下文与和弦/乐句批量写回。
- [`src/domain/harmony/harmonization/melodyGrid.ts`](../src/domain/harmony/harmonization/melodyGrid.ts)：自动配和声的只读网格与乐句规划。
- [`src/app/controllers/useHarmonyController.ts`](../src/app/controllers/useHarmonyController.ts)：内置与外置规则的共享快照并发调度。
- [`src/app/controllers/useProgressionAssistant.ts`](../src/app/controllers/useProgressionAssistant.ts) 与 [`src/workers/progressionSearch.worker.ts`](../src/workers/progressionSearch.worker.ts)：和声连接助手防抖与一次性 Worker 调度。
