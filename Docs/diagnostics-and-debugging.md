# 和声诊断与调试报告

本文说明**和声规则诊断**的数据字段、根因仲裁、用户忽略及规则调试报告格式（`satb-diagnostic-debug/v1`）。

> **边界区分：** 本文面向音乐学规则检查产出的 `HarmonyDiagnostic` 与单条问题的复现调试报告；应用运行时结构化日志、主进程/渲染进程错误上报、崩溃恢复界面及脱敏排错包（`DiagnosticBundle` / `schemaVersion: 1`）见 [logging-and-observability.md](./logging-and-observability.md)。

和声诊断同时服务 UI 展示、仲裁、规则测试和误报排查。诊断必须能说明“哪个规则、基于哪些对象、在什么状态下得出结论”。

## 1. 诊断稳定字段

[`HarmonyDiagnostic`](../src/domain/harmony/runtime.ts) 的核心字段包括：

- `id`、`ruleId`、`source`（`"builtin" | "external"`）、`severity`（`"error" | "warning" | "suggestion"`）；
- `tick`、`endTick` 与受影响的 `voiceIds`、`noteIds`、`chordIds`；
- `title`（简短标题）、`message`（面向用户的详细说明）、`messageKey`（稳定消息键）、`params`（供测试与调试检查的扁平参数表）与 `confidence`；
- `evidence`：可读的音程、音高、功能或调性证据（`note | chord | interval | key | function`）；
- `rootCauseKey`：同一音乐学根因跨多个切片时的稳定合并键（省略时退回 `messageKey`）；
- `causeRefs` / `coverageRefs`：稳定根因引用与专用规则对通用根因的覆盖声明；
- `exceptionContexts`：命中并参与严重程度计算的特例上下文列表；
- `subjects` 和 `trace`：结构化事件主体引用与状态转移轨迹；
- 可选 `debug`：复制规则调试报告使用的完整只读快照（`DiagnosticDebugSnapshot`）。

规则通过 [`DiagnosticFactory`](../src/domain/harmony/rules/diagnostics/factory.ts) 创建 `RuleDiagnostic`，宿主随后执行引用校验、适用性处理、严重程度折叠和 `diagnosticArbiter` 仲裁。规则不能直接伪造其他规则的覆盖关系。

## 2. Subjects 约定

```text
origin  触发规则义务或事实的来源对象
failure 实际违反条件的对象或事件
context 用于判断但不承担错误的邻域对象
```

例如七音未解决时，来源音符放在 `origin`，未按要求进行的目标音符放在 `failure`，中间重复音或相关 span 放在 `context`。诊断的时间范围应覆盖真正失败的事件，而不是默认使用前一个切片。

`coverageRefs` 表示本条诊断可以覆盖的通用根因；它不是“把附近所有音符都标红”的许可。UI 展示和仲裁都应以这些结构化引用为准。

## 3. Obligation Trace

状态规则的 `trace` 记录每次状态转移：

```ts
{ tick, outcome, reason }
```

其中 `outcome` 取值为 `"continue" | "resolve" | "violate" | "cancel" | "indeterminate"`。调试快照还会记录 obligation ID、分区键（`partitionKey`）、开启位置（`openedAt` / `openedBy`）、每一步的切片、当前音符、被攻击声部和可序列化事实（`facts`）。`trace` 用于解释状态为何继续、跨声部轮转、被取消或最终违反；它不是新的规则输入。

## 4. 用户忽略

用户可以将单条诊断标记为忽略。忽略记录使用宿主生成的稳定 `HarmonyDiagnostic.id` 保存到工程的 `diagnosticPreferences.ignoredDiagnosticIds` 中，因此不会删除诊断、改变规则结果或影响规则命中统计；它只从编辑器的音符和和弦高亮输入中滤除该项。问题列表（[`DiagnosticsPanel.tsx`](../src/features/diagnostics/DiagnosticsPanel.tsx)）保留该行并明确显示“已忽略”，并允许随时取消忽略。

## 5. 复制详细报告

在开启设置中的 **开发者模式（`developerMode`）** 后，[`DiagnosticsPanel.tsx`](../src/features/diagnostics/DiagnosticsPanel.tsx) 会在每条诊断右侧显示“复制此问题的调试信息”按钮，点击后调用 [`formatDiagnosticDebugReport`](../src/domain/harmony/debug/diagnosticDebug.ts) 生成可读摘要与 JSON 快照并复制到剪贴板。普通模式下隐藏该按钮以保持日常学习界面简洁。

报告内嵌快照 schema 为 `satb-diagnostic-debug/v1`，包含：

- `kind`：规则运行形态，取值为 `"stateful-obligation" | "stateless-rule" | "external-rule"`；
- `runtime`：`revision`、`ruleId`、`source`、`severity`、当前规则 `config`、`exceptionPolicy` 和外置包元信息；
- `diagnostic`：`title`、`message`、`messageKey`、`params`、`evidence`、`confidence`、`causeRefs`、`coverageRefs` 和 `trace`；
- `location`：`tick`、`endTick`、`sliceIndex`、`spanId`；
- `subjects`：`origin`、`failure`、`context` 对应的事件引用；
- `relatedEvents`：邻域内的相关 `notes`、`chords`、`spans`、`slices`、`transitions`、`connections`；
- `obligation`：义务状态和每一步记录（仅 `"stateful-obligation"` 状态规则存在）；
- `notes`：宿主或规则附加说明（若诊断缺少完整分析快照，会附注回退说明）。

报告是只读诊断快照，不应被当作可重新导入的工程数据。复制失败只触发操作提示，不能影响诊断展示。

源码入口：[`src/domain/harmony/runtime.ts`](../src/domain/harmony/runtime.ts)、[`src/domain/harmony/debug/diagnosticDebug.ts`](../src/domain/harmony/debug/diagnosticDebug.ts)、[`src/domain/harmony/rules/diagnostics/factory.ts`](../src/domain/harmony/rules/diagnostics/factory.ts)、[`src/features/diagnostics/DiagnosticsPanel.tsx`](../src/features/diagnostics/DiagnosticsPanel.tsx)。
