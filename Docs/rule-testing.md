# 规则测试工作台与用例格式

本文说明内置规则的独立回归测试能力：用例文件格式、隔离运行器、结果比较、用例库和工作台 UI。它面向需要为规则补充教材金样本、修正误判或验证配置行为的开发者。规则实现本身见 [harmony-engine.md](./harmony-engine.md)，桌面端用例文件持久化见 [desktop-and-persistence.md](./desktop-and-persistence.md)。

## 1. 定位

规则测试工作台在应用内提供“单条规则 + 最小工程 + 期望结果”的隔离回归环境，不依赖完整 `.satb` 工程或手工听音。它与 Vitest 领域测试互补：

- Vitest 覆盖规则实现、跨规则事实和算法边界。
- 规则测试用例是可持久化、可分享、可在 UI 中编辑运行的教材金样本，用于校准规则口径和复现误判。

用例文件扩展名为 `.satb-rule-case.json`，单文件上限 20 MiB，内容为 UTF-8 JSON。

## 2. 用例格式

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
- `expected.diagnostics` 描述期望诊断；`allowUnexpectedDiagnostics` 控制是否允许超出期望的诊断；`skips` 描述期望的结构化跳过。

`ExpectedDiagnostic` 字段：`id`、`ruleId`、`messageKey`、可选 `rootCauseKey`、`tick`、可选 `endTick`、`voiceIds`、`noteIds`、`chordIds` 与 `params`。比较按 `ruleId` + `messageKey` + `rootCauseKey` 做语义匹配，再对比 tick/endTick、对象引用与参数；越具体的期望优先匹配，避免宽泛期望吞掉具体差异。

`ExpectedRuleSkip` 使用 `reason`（`no-chords` / `missing-semantics` / `ambiguous-semantics` / `insufficient-context` / `rule-error`）与 `partial` 布尔值。

仓库根目录的 [`RuleCases/`](../RuleCases) 存放随代码维护的回归金样本，按 `<group>.<ruleId>/<name>.satb-rule-case.json` 组织。

## 3. 解析与校验

[`parseRuleTestCase`](../src/domain/harmony/testing/validation.ts) 对不可信 JSON 做运行时解析，返回 `{ testCase?, issues[] }`。issue `code` 包括 `format`、`version`、`type`、`value`、`duplicate`、`unknown-rule`、`invalid-project`、`invalid-config`、`unsupported-exception` 与 `missing-reference`。夹具工程通过 `materializeRuleTestProject` 重建为完整 `ProjectDocument`，未知规则 ID 直接报告而不是静默忽略。

用例内容不包含脚本正文，也不影响当前打开的工程或全局规则配置。

## 4. 隔离运行器

[`RuleTestRunner`](../src/domain/harmony/testing/runner.ts) 为每条目标规则维护独立 `RuleScheduler`，`run(testCase, { signal, project })` 返回 `RuleTestRunResult`：

```ts
status: "passed" | "failed" | "error"
comparison: { matches, missing, unexpected, mismatched, skipMismatches }
durationMs
error?: { code: "unknown-rule" | "invalid-project" | "rule-error" | "aborted" }
```

运行器支持 `AbortSignal` 取消；单条规则执行失败、工程无效或取消都会归入 `error` 状态，而不是伪装成 `passed`。比较逻辑位于 [`comparator.ts`](../src/domain/harmony/testing/comparator.ts)，规范化并排序对象引用后再对比，避免数组顺序噪声。

## 5. 用例库

[`services/ruleTestCases/`](../src/services/ruleTestCases) 提供桌面与浏览器两套 store：

- 桌面端通过 preload 的 `ruleTestCases` 分组读写 `.satb-rule-case.json` 与用例目录（见 [desktop-and-persistence.md](./desktop-and-persistence.md)）。
- 浏览器端使用 localStorage 降级，仅用于预览，不能验证目录扫描与原子写盘。

[`library.ts`](../src/services/ruleTestCases/library.ts) 把目录条目解析为 `RuleTestCaseLibraryItem`，支持按查询、标签和状态过滤、收集标签、批量运行（`runRuleTestLibraryBatch`）与“最近用例”列表。批量运行可取消，返回通过/失败计数。

## 6. 工作台 UI

[`features/ruleTesting/RuleTestWorkbench`](../src/features/ruleTesting/RuleTestWorkbench.tsx) 提供独立工作区，由 [`useRuleTestWorkspace`](../src/app/controllers/useRuleTestWorkspace.ts) 编排：

- 左侧用例面板采用文件夹风格，列出目录条目、解析问题与运行状态。
- 右侧提供用例检查器、目标规则搜索、诊断结果行与运行工具栏。
- 音源设置与工作台绑定，而不是跟随当前打开的文件。

进入和退出工作台会隔离面板尺寸偏好，退出后恢复主工作区布局。工作台的编辑与运行不会改动当前工程的历史或规则 profile。

## 7. 扩展与检查表

- 新字段是否需要进入用例文件，还是属于运行态 UI 状态？
- 用例 schema、默认值、损坏输入修复与未知规则是否都有测试？
- 比较器是否稳定排序对象引用，并区分 missing / unexpected / mismatched？
- 运行器是否隔离单规则、支持取消，并把执行失败归入 error？
- 桌面目录扫描、原子写盘、删除与最近目录记忆是否在 E2E 中覆盖？
- 新增规则金样本时是否同时提交用例文件与对应修复？
