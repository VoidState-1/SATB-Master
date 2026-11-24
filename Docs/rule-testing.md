# 规则测试工作台与用例格式

本文说明内置规则的三层回归测试体系：Vitest 单元测试、核心规则双入口反例护栏、可持久化金样本格式、隔离运行器、用例库与工作台 UI。它面向需要为规则补充教材金样本、修正误判或验证配置行为的开发者。规则实现本身见 [harmony-engine.md](./harmony-engine.md)，桌面端用例文件持久化见 [desktop-and-persistence.md](./desktop-and-persistence.md)。

## 1. 三层回归体系

SATB Master 的内置规则质量保障由三层互补的测试能力构成：

1. **Vitest 单元测试：** 覆盖各规则组 evaluator、跨规则事实模块、查询上下文、状态机转移、适用性与仲裁算法边界。
2. **21 条核心规则双入口反例护栏（[`src/domain/harmony/rules/guardrails/`](../src/domain/harmony/rules/guardrails)）：** 通过 `.satbt` 简写构造“合法正例对照 + 最小反例变异”，验证核心 `error`/`warning` 规则在人工条件输入与盲推输入下均无漏报/误报。
3. **可持久化金样本与工作台（[`RuleCases/`](../RuleCases) + [`ruleCases.test.ts`](../src/domain/harmony/testing/ruleCases.test.ts) + `RuleTestWorkbench`）：** 在应用内提供“单条规则 + 最小工程 + 期望结果”的隔离回归环境，支持可视化编辑、对比、批量运行并接入自动化回归。

用例文件扩展名为 `.satb-rule-case.json`，单文件上限 20 MiB，内容为 UTF-8 JSON。

## 2. 核心规则双入口反例护栏套件

护栏套件位于 [`counterexampleGuardrail.test.ts`](../src/domain/harmony/rules/guardrails/counterexampleGuardrail.test.ts) 与 [`fixtures.ts`](../src/domain/harmony/rules/guardrails/fixtures.ts)，覆盖 **21 条**核心内置规则：

- **10 条 `error` 规则：** `voice-leading.parallel-fifths`、`voice-leading.parallel-octaves`、`voice.crossing`、`chord.inversion-bass`、`chord.doubled-leading-tone`、`chord.doubled-seventh`、`function.cadential64-target`、`melody.leap-over-octave`、`chord.augmented-sixth-voicing`、`resolution.augmented-sixth`。
- **11 条 `warning` 规则：** `resolution.leading-tone`、`resolution.chord-seventh`、`chord.incomplete-members`、`nonchord.passing-tone`、`nonchord.suspension-preparation`、`nonchord.suspension-resolution`、`nonchord.neighbor-tone`、`nonchord.anticipation`、`voice-leading.hidden-fifth`、`voice-leading.hidden-octave`、`function.retrogression`。

设计约束与执行机制：

- **正例对照 + 最小反例：** 每条规则至少维护 1 组基于 [SATB 简写工具](./score-text.md)（`.satbt`）的合法正例 `control`（要求在目标规则下 0 诊断），以及至少 2 个针对正例施加 1–2 处音符最小变异的 `counterexamples`（要求精确命中目标规则、严重程度、tick、声部/和弦引用与参数）。
- **`conditioned` 与 `blind` 双入口：**
  - `conditioned`：直接对编译后的完整工程（含和弦、外音角色、句界与终止式标注）运行 `checkHarmony`。
  - `blind`：通过 `stripToBlindProject` 清空和弦区段、外音角色、人工句界与终止式标注后，调用 `inferHarmony` + `applyHarmonyInference` 盲推和声，再运行 `checkHarmony`，确保实际用户未手工标和弦时规则仍能成立。
- **`blindSkipReason` 约束：** 仅依赖人工和弦/外音标注的 7 条规则（`chord.inversion-bass`、`function.cadential64-target` 以及 5 条 `nonchord.*` 规则）声明 `entryPoints: { blind: false, blindSkipReason }`，其余 14 条规则必须同时在 `conditioned` 和 `blind` 下拥有至少 2 个有效反例；单个反例若需跳过 `blind` 也必须填写非空 `blindSkipReason`。

## 3. 用例格式

格式标识与版本：

```ts
export const RULE_TEST_CASE_FORMAT = "satb-rule-test-case";
export const RULE_TEST_CASE_FORMAT_VERSION = 1;
```

顶层结构 [`HarmonyRuleTestCaseV1`](../src/domain/harmony/testing/model.ts)：

```text
format / formatVersion
id / title / description / tags
target        { source: "builtin", ruleId }
execution     { mode: "isolated", severity, config, exceptions }
project       RuleTestProjectFixture
expected      { diagnostics[], allowUnexpectedDiagnostics, skips[] }
```

- `target.ruleId` 使用目录稳定 ID，例如 `resolution.leading-tone`；当前只支持 `builtin`。
- `execution` 固定 `mode: "isolated"`：只调度目标规则，注入该用例自己的严重程度、配置与特例策略。
- `project` 是裁剪后的工程夹具，包含 `schemaVersion`、`ppq`、`lengthTicks`、tempo/meter/key 事件、`satbTracks`、`auxiliaryTracks` 与 `chordTrack`。
- `project.structure` 可选，用于保留已知乐句边界；旧用例未提供时按空边界恢复。新建或重新保存的用例会保留该字段。
- `expected.diagnostics` 描述期望诊断；`allowUnexpectedDiagnostics` 控制是否允许超出期望的诊断；`skips` 描述期望的结构化跳过。

`ExpectedDiagnostic` 字段中，仅 **`id`、`ruleId`、`messageKey`、`tick`** 为必填字段；**`rootCauseKey`、`endTick`、`voiceIds`、`noteIds`、`chordIds`、`params`** 均为可选字段。比较按 `ruleId` + `messageKey` + `rootCauseKey` 做语义匹配，再对比 tick/endTick、对象引用与参数；越具体的期望优先匹配，避免宽泛期望吞掉具体差异。

`ExpectedRuleSkip` 使用 `reason`（`no-chords` / `missing-semantics` / `ambiguous-semantics` / `insufficient-context` / `rule-error`）与 `partial` 布尔值。

仓库根目录的 [`RuleCases/`](../RuleCases) 存放随代码维护的回归金样本，按 `<group>.<ruleId>/<name>.satb-rule-case.json` 组织。[`ruleCases.test.ts`](../src/domain/harmony/testing/ruleCases.test.ts) 通过 `import.meta.glob` 自动发现 `RuleCases/**/*.satb-rule-case.json`，解析后逐一隔离运行并用自定义 Vitest matcher `toPassRuleTestCase` 断言通过。

测试领域辅助模块位于 [`src/domain/harmony/testing/`](../src/domain/harmony/testing)：

- [`projectFixture.ts`](../src/domain/harmony/testing/projectFixture.ts)：`materializeRuleTestProject` / `materializeUnknownRuleTestProject`（兼容旧 schema v2 夹具迁移）与 `dematerializeRuleTestProject`。
- [`factory.ts`](../src/domain/harmony/testing/factory.ts)：`createRuleTestCase` 从现有工程与规则默认配置初始化用例。
- [`clone.ts`](../src/domain/harmony/testing/clone.ts)：`cloneRuleTestCase` 深度克隆用例并同步重映射音符、和弦、语义解释与期望诊断中的全部 ID。
- [`canonicalize.ts`](../src/domain/harmony/testing/canonicalize.ts)：`canonicalizeRuleTestCase` / `serializeRuleTestCase` 对标签、配置键、事件顺序、对象引用与期望列表执行稳定规范化排序，减少保存 diff 噪声。

可使用独立的 [SATB 简写工具](./score-text.md) 编写工程及标注，再交给用例工厂；该工具的参考标注与工程输入隔离，不会自动充当规则 expected 或写入待测输入。

## 4. 解析与校验

[`parseRuleTestCase`](../src/domain/harmony/testing/validation.ts) 对不可信 JSON 做运行时解析，返回 `{ testCase?, issues[] }`。issue `code` 包括 `format`、`version`、`type`、`value`、`duplicate`、`unknown-rule`、`invalid-project`、`invalid-config`、`unsupported-exception` 与 `missing-reference`。夹具工程通过 `materializeRuleTestProject` 重建为完整 `ProjectDocument`，未知规则 ID 直接报告而不是静默忽略。

用例内容不包含脚本正文，也不影响当前打开的工程或全局规则配置。

## 5. 隔离运行器与用例库

[`RuleTestRunner`](../src/domain/harmony/testing/runner.ts) 为每条目标规则维护独立 `RuleScheduler`，`run(testCase, { signal, project })` 返回 `RuleTestRunResult`：

```ts
status: "passed" | "failed" | "error"
comparison: { matches, missing, unexpected, mismatched, skipMismatches }
durationMs
error?: { code: "unknown-rule" | "invalid-project" | "rule-error" | "aborted" }
```

运行器支持 `AbortSignal` 取消；单条规则执行失败、工程无效或取消都会归入 `error` 状态，而不是伪装成 `passed`。比较逻辑位于 [`comparator.ts`](../src/domain/harmony/testing/comparator.ts)，规范化并排序对象引用后再对比，避免数组顺序噪声。

[`services/ruleTestCases/`](../src/services/ruleTestCases) 提供桌面与浏览器两套 store：

- 桌面端通过 preload 的 `ruleTestCases` 分组读写 `.satb-rule-case.json` 与用例目录（见 [desktop-and-persistence.md](./desktop-and-persistence.md)）。
- 浏览器端通过文件选择读取用例，并使用 Blob 下载保存；删除操作不修改本地文件系统。它不能验证桌面端目录扫描、IPC 和原子写盘。

[`library.ts`](../src/services/ruleTestCases/library.ts) 把目录条目解析为 `RuleTestCaseLibraryItem`，支持按查询、标签和状态过滤、收集标签、批量运行（`runRuleTestLibraryBatch`）与“最近用例”列表。批量运行可取消，返回通过/失败计数。

## 6. 工作台 UI

[`RuleTestWorkbench`](../src/features/ruleTesting/RuleTestWorkbench.tsx) 提供独立工作区，由 [`useRuleTestWorkspace`](../src/app/controllers/useRuleTestWorkspace.ts) 编排：

- **顶部工具栏（[`RuleTestToolbar.tsx`](../src/features/ruleTesting/RuleTestToolbar.tsx)）：** 提供运行、目录批量运行/取消、**`autoRun` 自动重跑开关**（默认开启，编辑用例后防抖自动重新运行）、一键采纳实际诊断、规范化、克隆、播放/节拍器/循环与编辑工具控制。
- **左侧面板（`cases` / `voices` 双标签）：** `cases` 标签以文件夹列表展示用例库、最近用例、解析问题与运行状态，并可唤起 [`CreateTestCaseDialog`](../src/features/ruleTesting/CreateTestCaseDialog.tsx) 新建用例；`voices` 标签内嵌 `TrackSidebar` 控制 SATB 声部可见性、独奏、静音与音源设置。
- **中央编辑区：** 内嵌完整 [`PianoRoll`](../src/features/editor/PianoRoll.tsx)，直接编辑夹具音符与和弦，并在画布上以 `missingReferences` 高亮漏报的期望音符与和弦引用；下方展示 [`RuleTestResultsPanel`](../src/features/ruleTesting/RuleTestResultsPanel.tsx)（含 [`RuleTestDiagnosticRow`](../src/features/ruleTesting/RuleTestDiagnosticRow.tsx)）。
- **右侧面板（`case` / `selection` 双标签）：** `case` 标签提供 [`RuleTestInspector`](../src/features/ruleTesting/RuleTestInspector.tsx)（用例元数据、目标规则搜索、严重程度、配置、特例策略与期望管理）；`selection` 标签内嵌 `SelectionInspector` 编辑选中音符或和弦语义。
- **快捷键与隔离状态：** 编辑与播放快捷键复用主编辑器的 `useKeyboardController`，工作台专用命令（如 `runRuleTest`、`saveProject`、`saveProjectAs`、`cancelOrClear`）见 [`useRuleTestKeyboard.ts`](../src/features/ruleTesting/useRuleTestKeyboard.ts)。音源设置持久化在独立键 `satb_rule_test_soundfont`，进入和退出工作台会隔离面板尺寸偏好（`usePanelLayout("rule-test")`），编辑与运行不会改动当前工程的历史或规则 profile。

## 7. 扩展与检查表

- 新字段是否需要进入用例文件，还是属于运行态 UI 状态？
- 用例 schema、默认值、损坏输入修复与未知规则是否都有测试？
- 比较器是否稳定排序对象引用，并区分 missing / unexpected / mismatched？
- 运行器是否隔离单规则、支持取消，并把执行失败归入 error？
- 核心 `error`/`warning` 规则变动是否同步校验 21 条双入口反例护栏与 `RuleCases/` 金样本？
- 桌面目录扫描、原子写盘、删除与最近目录记忆是否在 E2E 中覆盖？
- 新增规则金样本时是否同时提交用例文件与对应修复？
