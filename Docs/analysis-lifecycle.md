# 和声分析生命周期与缓存边界

本文补充 [analysis-inference.md](./analysis-inference.md)，专门说明分析快照、候选、工程事实和缓存的生命周期。

## 1. HarmonyAnalysis 是只读快照

buildHarmonyAnalysis(project, revision) 在一个 revision 上构造深度只读快照，包含：

- metricTimeline、slices、harmonySpans；
- melody/slice transitions、connections、target chains、context facts；
- phraseBoundaries、phraseSegments、cadenceAnnotations；
- 可选的 phraseBoundaryCandidates 与 cadenceCandidates；
- invalidationRanges 和按 ID 建立的索引。

规则只能读取快照。任何写回都必须经过 editing.ts 命令并产生新的工程 revision。

## 2. 候选与工程事实

`text
分析器输出候选       -> 带证据/置信度的临时结果
推断流程选择并应用   -> 工程结构或和弦区域
人工编辑命令         -> 锁定、修改或删除工程事实
下一 revision        -> 重新构造快照
`

乐句推导使用 inferPhrases；普通实时分析默认只读取已保存边界，不开启候选扫描。完整和声推导才会在和弦推导后重新生成乐句结构。终止式检测消费最终 PhraseSegment[]，不能自行创建乐句边界。

候选不是标注：phraseBoundaryCandidates / cadenceCandidates 不等于 phraseBoundaries / cadenceAnnotations。过期的自动边界可保留供核对，但不能继续参与规则分析。

## 3. 调度器缓存

RuleScheduler.prepareAnalysis 的音乐签名不包含规则 profile：

- 只修改严重程度、规则配置或特例时，可以复用同一分析快照，只重跑受影响规则；
- 修改音符、和弦、调号、时间或结构时，必须依据 AnalysisInvalidationRange 重建受影响分析，不能复用旧规则结果；
- 外置规则请求和内置规则请求都携带 revision，过期响应标记为 superseded，不得覆盖新结果。

分析缓存与规则结果缓存是两层不同缓存，不能因为规则结果未变化而跳过音乐事实重建。

## 4. 当前实现边界

- buildHarmonyAnalysis 当前调用 analyzePhrases(..., { generateCandidates: false })；需要候选时必须显式进入推导流程。
- REGULAR_PHRASE_POLICY 中的 maxAutomaticPhrases 只有在分析器实际读取后才能称为生效约束；文档不得把未执行的配置描述为运行时保证。
- ChordInferenceRegionStatus.blocked 是类型层预留状态；在实现产生该状态前，应按未实现能力处理。

源码入口：`analysis.ts`、`phrase/analyze.ts`、`cadence/detect.ts`、`inference/`。
