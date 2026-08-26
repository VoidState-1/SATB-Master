# 诊断与调试报告

和声诊断同时服务 UI 展示、仲裁、规则测试和误报排查。诊断必须能说明“哪个规则、基于哪些对象、在什么状态下得出结论”。

## 1. 诊断稳定字段

HarmonyDiagnostic 的核心字段包括：

- id、ruleId、source、severity；
- tick、endTick 与声部/音符/和弦 ID；
- messageKey、参数化 message 和 confidence；
- evidence：可读的音程、音高、功能或调性证据；
- rootCauseKey：同一音乐学根因跨多个切片时的稳定合并键；
- causeRefs / coverageRefs：根因来源与覆盖关系；
- subjects 和 trace：结构化调试信息；
- 可选 debug：复制报告使用的完整快照。

规则通过 DiagnosticFactory 创建诊断，宿主随后执行引用校验、适用性处理、严重程度折叠和 diagnosticArbiter 仲裁。规则不能直接伪造其他规则的覆盖关系。

## 2. Subjects 约定

`text
origin  触发规则义务或事实的来源对象
failure 实际违反条件的对象或事件
context 用于判断但不承担错误的邻域对象
`

例如七音未解决时，来源音符放在 origin，未按要求进行的目标音符放在 failure，中间重复音或相关 span 放在 context。诊断的时间范围应覆盖真正失败的事件，而不是默认使用前一个切片。

coverageRefs 表示本条诊断可以覆盖的通用根因；它不是“把附近所有音符都标红”的许可。UI 展示和仲裁都应以这些结构化引用为准。

## 3. Obligation Trace

状态规则的 trace 记录每次状态转移：

`ts
{ tick, outcome, reason }
`

调试快照还会记录 obligation ID、分区键、开启位置、每一步的切片、当前音符、被攻击声部和可序列化事实。trace 用于解释状态为何继续、跨声部轮转、被取消或最终违反；它不是新的规则输入。

## 4. 复制详细报告

用户可从诊断提示或诊断面板复制详细报告。报告 schema 为 satb-diagnostic-debug/v1，包含：

- runtime：revision、规则来源、严重程度、配置和外置包信息；
- diagnostic：消息、证据、根因和覆盖引用；
- location：tick、endTick、sliceIndex、spanId；
- subjects：origin、failure、context 对应的事件引用；
- relatedEvents：相关 notes、chords、spans、slices、transitions、connections；
- obligation：义务状态和步骤（仅状态规则）；
- notes：宿主或规则附加说明。

报告是只读诊断快照，不应被当作可重新导入的工程数据。复制失败不能影响诊断展示。

源码入口：`runtime.ts`、`diagnosticDebug.ts`、`factory.ts`。
