# 自动分析：节拍、乐句、终止式与和弦推导

快照、候选、写回和缓存边界见 [analysis-lifecycle.md](./analysis-lifecycle.md)。普通实时分析默认关闭乐句候选扫描，因此 phraseBoundaryCandidates 可能为空；需要候选时进入专用推导流程。

本文说明和声分析之上新增的三组自动分析能力——节拍层级、乐句结构与终止式检测，以及面向空工程的自动和弦推导。它们都属于“从工程快照推导出的结构化事实”，与 [harmony-engine.md](./harmony-engine.md) 描述的规则诊断流程分属不同职责：这些模块产出候选与结构，规则引擎消费其结论进行诊断。

## 1. 定位与边界

三组能力的共同原则：

- 输入是同一份 `HarmonyAnalysis` 快照（或只读工程投影），不修改工程。
- 输出是带置信度和证据的候选结构，而不是最终“正确”标签。
- 只有用户确认或调用应用命令后，候选才写入工程（`structure.phraseBoundaries`、`chordTrack.regions`、`chordTrack.cadenceAnnotations`）。
- 置信度不足时返回 `ambiguous`/`unavailable` 或跳过，不用启发式猜测补齐。

主要源码入口：

- [`src/domain/rhythm/metric.ts`](../src/domain/rhythm/metric.ts)：节拍层级与强弱位置。
- [`src/domain/harmony/phrase/`](../src/domain/harmony/phrase)：乐句边界候选、结构模板与乐句分段。
- [`src/domain/harmony/cadence/`](../src/domain/harmony/cadence)：终止式候选与乐句末端识别。
- [`src/domain/harmony/inference/`](../src/domain/harmony/inference)：自动和弦推导、区域合并与写回。

设计文档见 `DesignDocs/automatic-chord-inference-design.md`、`DesignDocs/cadence-auto-detection-design.md` 与 `DesignDocs/phrase-cadence-regularity-improvement.md`；本文只记录当前实现。

## 2. 节拍层级

[`buildMetricTimeline`](../src/domain/rhythm/metric.ts) 在 [`time.ts`](../src/domain/time.ts) 的小节结构之上建立拍级强弱层级：

- `MetricMeasure`：小节号、起止、分子分母、拍长、拍 tick 列表和可选拍组。
- `MetricPosition`：某一 tick 的 `role`（`subdivision` / `weak-beat` / `secondary-accent` / `downbeat`）、层级 `level` 与 `confidence`。
- 拍组优先使用 `MeterEvent.beatGrouping` 显式声明；缺失时按分母为 8/16 且分子能被 3 整除推断三拍一组，分子为 4 推断 `[2, 2]`，其余标记为 `ambiguous`。

`compareMetricStrength` / `strongestMetricPositionBetween` 供乐句和终止式模块判断“更靠近小节线/次强拍”。节拍强弱只作为证据，不单独决定任何规则结论。

## 3. 乐句结构分析

乐句边界是工程级数据，保存于 `project.structure.phraseBoundaries`（见 [data-model.md](./data-model.md)）。分析入口：

- `analyzePhrases(project, options)`：结合已保存边界与可选候选扫描，返回 `PhraseAnalysis`。
- `inferPhrases(project)`：重建自动边界，保留人工边界，丢弃上一次推导生成的自动边界。
- `phraseAtTick(segments, tick)`：定位 tick 所在乐句。

`PhraseAnalysis` 包含：

- `boundaries`：工程起点/终点加上内部边界（人工或自动），按 tick 排序。
- `candidates`：按有效时长比例（1/2、1/3、2/3）搜索的自动边界候选。
- `segments`：相邻边界围成的 `PhraseSegment`，带 `source`（`manual` / `inferred` / `mixed`）与置信度。
- `template`：`single` / `duple` / `triple` 结构模板。

自动边界的证据来自 `boundaryFacts`：全部声部在此释放、释放后至少一拍实际静音、长音释放、小节线/次强拍、末端确定功能和声、和声收束（D -> T 或 S -> T）、边界后进入不同材料等。`REGULAR_PHRASE_POLICY` 限制自动乐句数量（最多 3 个）、搜索窗口、最短乐句长度与短乐句强分割条件。

推断出的边界带 `inferenceFingerprint`（所依据的和声输入指纹）与 `source: "inferred"`；工程输入变化后可据此判定边界是否 `stale`（过期），过期边界保留供用户核对但不再参与规则分析。`isCurrentPhraseBoundary` 用于判断旧边界是否仍与当前工程一致。

## 4. 终止式检测

终止式从“和弦级 `cadenceType`”迁移为工程级范围标注 `chordTrack.cadenceAnnotations`（见 [data-model.md](./data-model.md) 与 [functional-harmony.md](./functional-harmony.md)）。检测入口 [`detectCadences(analysis)`](../src/domain/harmony/cadence/detect.ts) 读取 `phraseSegments` 与 `harmonySpans`，对每个乐句末端产生 `CadenceCandidate`：

- `kind`：`full`（完全）、`half`（半）、`supplementary`（补充/变格）、`deceptive`（阻碍）。
- `form`：`authentic` / `plagal`；`completion`：`perfect` / `imperfect`（仅当两端和弦均为原位、低音为 5 -> 1、且女高音落在主音时为完全）。
- 证据包括 `phrase-boundary`、`dominant-to-tonic`、`predominant-to-tonic`、`dominant-to-alternative`、`ends-on-dominant`、`cadential64-chain`、`bass-formula` 等。
- 同一乐句存在竞争候选且分数接近时，降级为 `ambiguous` 并附带 `alternatives`。

候选不是标注。用户通过 `editing.ts` 的终止式命令（`add/update/removeCadenceAnnotation`）把候选或人工判断写为 `CadenceAnnotation`，并绑定 `phraseId` 与 `fromTick/toTick`。分析快照同时暴露 `cadenceCandidates`（未写回的候选）与 `cadenceAnnotations`（已写回的标注），并提供 `cadenceAtTick` 索引供规则与 UI 查询。

人工句界可以落在持续音内部。终止候选和已保存终止的规则视图都按实际半开区间裁剪；持续中的音不会因此重新起奏，全局规则切片也不被分割。

## 5. 自动和弦推导

[`inferChords(project, options)`](../src/domain/harmony/inference/inferChords.ts) 面向尚未标注和弦的 SATB 工程，输出 `ChordInferenceResult`。流程：

```text
buildChordInferenceObservations  -> 观测切片（活跃音、低音、调性、节拍位置、完整 SATB 状态）
buildChordInferenceCandidates    -> 每个观测的功能候选（identity + semantics + 适配评分）
analyzeChordInferencePaths       -> 跨观测的序列路径选择与全部保留候选的路径评分
buildChordInferenceRegions       -> 合并为 ChordInferenceRegion
```

关键类型（[`inference/types.ts`](../src/domain/harmony/inference/types.ts)）：

- `ChordInferenceObservation`：一个半开时间区间的活跃音、起奏声部、低音、调性与节拍位置。
- `ChordInferenceCandidate`：候选 `ChordIdentity`（可无功能语义的绝对回退）、适配评估 `ChordFitAssessment`、评分 `ChordInferenceScore`、置信度与证据。
- `ChordInferenceRegion`：合并后的区域，含 `status`（`resolved` / `ambiguous` / `unclassified` / `blocked`）、`selected` 与 `alternatives`。
- `ChordInferenceResult`：区域、未解析观测索引与 `ChordInferenceWarning`。

候选评分综合功能模板层级、音适配、低音适配、拼写一致性、节拍语境、序列语境、非和弦音惩罚与复杂度惩罚；人工已标注的非和弦音角色是硬证据，不会与之冲突。`ChordInferenceOptions` 控制是否允许绝对回退、不完整织体、非和弦音候选与最低置信度。

序列阶段对每个连续的有候选区间执行前向与后向动态规划，`pathScore` 表示“经过该候选的最佳完整路径分数”。主候选与备选均按这个口径比较，分差不足 12 时保留歧义；重复起奏带来的延续奖励同样计入竞争路径。路径搜索和歧义比较使用同一批每切片最多 32 个候选。

合并区段汇总所有切片的局部评分、音符引用、非和弦音角色与证据，并采用其中最低置信度。任一切片存在接近的竞争路径，整个区段均保留歧义。`score` 是局部评分的汇总；`pathScore` 包含整个连续区间的上下文，不能跨切片相加，也不能在不同连续区间之间比较。

意大利、法国、德国增六候选必须覆盖各自全部构成音；缺少增六音程的任一端或其他必要音时直接拒绝。该要求不受“允许有限缺音”影响，三度叠置和弦原有的省略音策略保持不变。

### 5.1 应用写回

[`applyChordInference`](../src/domain/harmony/inference/apply.ts) 把选中区域写回工程，模式：

- `fill-gaps`：只填充尚无和弦的空白，已有和弦区域跳过。
- `replace-unlocked`：替换重叠的未锁定和弦，锁定和弦跳过。

写回遵守锁定（和弦轨、单音符、练习不可编辑区间）、重叠、调号边界与 `editing.ts` 的和弦约束；`writeNonChordToneRoles` 可将适配出的非和弦音角色写回对应音符（锁定音符跳过）。返回 `appliedRegionCount`、`writtenNonChordToneRoleCount` 与 `skipped` 警告。

### 5.2 完整和声推导

写回检查以 apply.ts 和 editing.ts 的实际路径为准：非和弦音角色写回会检查锁定音符与不可编辑区间，和弦区域写回的约束路径不同。不要将两者概括为完全相同的 editable-range 保证。

[`inferHarmony` / `applyHarmonyInference`](../src/domain/harmony/inference/harmonyInference.ts) 组合和弦推导与乐句推导：和弦是第一阶段的输入，乐句结构在应用后重新生成（`appliedPhraseBoundaryCount` / `appliedPhraseTemplate`）。UI 入口是 [`ChordInferenceDialog`](../src/features/chordInference/ChordInferenceDialog.tsx)，支持按全工程、选区或乐句范围推导，并在应用前预览候选。

## 6. 与规则引擎及外置 API 的边界

候选不是工程标注：phraseBoundaryCandidates / cadenceCandidates 仅表示本次分析的只读候选，不能替代 phraseBoundaries / cadenceAnnotations。

`HarmonyAnalysis` 新增 `metricTimeline`、`phraseBoundaries`、`phraseBoundaryCandidates`、`phraseSegments`、`cadenceCandidates`、`cadenceAnnotations` 与 `cadenceAtTick`。内置规则通过 [`HarmonyRuleContext`](../src/domain/harmony/rules/context/createRuleContext.ts) 的乐句导航读取这些事实，但不会反向修改边界或标注。

外置 API v3 暴露 `phraseSegments`、`phraseBoundaryCandidates` 与 `cadenceCandidates` 供脚本只读消费（见 [external-rules.md](./external-rules.md)）。辅助轨明细仍然不公开。

## 7. 扩展与检查表

- 新自动分析是否返回候选 + 置信度 + 证据，而不是直接写回工程？
- 语义歧义、休止、转调或上下文不足时是否保守返回 `ambiguous`/跳过？
- 写回是否经过 `editing.ts` 命令并遵守锁定、重叠与调号边界？
- 推断指纹是否让过期边界/标注可被识别并保留供用户核对？
- 新证据是否只读取快照事实，不泄露辅助轨明细或系统对象？
- 内置规则、外置上下文与 UI 是否同步新结构，且测试覆盖候选、冲突与退化场景？
