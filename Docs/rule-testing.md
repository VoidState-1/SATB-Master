# 规则测试工作台与用例格式

本文说明内置规则的三层回归测试体系：Vitest 单元测试、核心规则双入口反例护栏、可持久化金样本格式、隔离运行器、用例库与工作台 UI。它面向需要为规则补充教材金样本、修正误判或验证配置行为的开发者。规则实现本身见 [harmony-engine.md](./harmony-engine.md)，桌面端用例文件持久化见 [desktop-and-persistence.md](./desktop-and-persistence.md)。

## 1. 三层回归体系

SATB Master 的内置规则质量保障由三层互补的测试能力构成：

1. **Vitest 单元测试：** 覆盖各规则组 evaluator、跨规则事实模块、查询上下文、状态机转移、适用性与仲裁算法边界。
2. **核心规则成对反例护栏**覆盖 70 条内置规则中的 35 条，其中 27 条同时运行条件与盲推入口。每条规则比较合法对照与一至两音变异。[护栏目录](../src/domain/harmony/rules/guardrails/)
3. **可持久化金样本与工作台（[`RuleCases/`](../RuleCases) + [`ruleCases.test.ts`](../src/domain/harmony/testing/ruleCases.test.ts) + `RuleTestWorkbench`）：** 在应用内提供“单条规则 + 最小工程 + 期望结果”的隔离回归环境，支持可视化编辑、对比、批量运行并接入自动化回归。

用例文件扩展名为 `.satb-rule-case.json`，单文件上限 20 MiB，内容为 UTF-8 JSON。

## 2. 核心规则成对反例护栏

[教学档位对照测试](../src/domain/harmony/rules/teachingPresets.test.ts) 在同一份谱例上切换严格作业与教材分析，按目标规则比对全部命中的拍点、严重度与责任声部。覆盖 K46 强位等强和弱位等强、完整句尾和空白尾段、恰在强拍结束、音域上界与越界半音、两个内声部导音的自由解决、内声部错落及外声部错跳。[档案测试](../src/domain/ruleProfile.test.ts) 经真实迁移与便携导入入口验证缺字段的旧档案，以及切换、保存与回读。

Written100 开发验证只使用 dev。冻结后一次遍历全集，同时评估起点、冻结严格档及冻结教材档，只按 dev / val 汇总。条件规则使用全标注，条件终止推断剥离终止标签；盲推从纯音符生成和弦并回写外音。主列表 E/W 与同位置多报均排除建议和折叠后果；同题同 tick 至少两条 E/W 计一个多报位置。延留项分别计盲推准备和解决诊断。句界排除工程首尾，终止主分核对类别与终点，严格分另核对起点和已标注的形式、完满性；和弦实体与严格分均按标注时值加权。

正式矩阵覆盖 **35/70 条规则**。每条规则至少有 1 个合法对照和 2 个反例，每个反例只改变 1–2 个音符。和声或拍位随之改变时，条件入口的 H 行同步反映实奏。运行器逐项比对目标规则的全部诊断，包括严重度、tick 和责任声部。和弦级诊断要求空 `voiceIds` 及精确的和弦引用。重复变化倾向音另核对参与重复的音符证据。

| 夹具模块 | 正式规则数 | 内容 |
| --- | ---: | --- |
| `fixturesVoice.ts` | 9 | 音域、间距、交叉、超越、四部同向、平行与隐伏五八度 |
| `fixturesMelody.ts` | 4 | 超八度跳进、增音程、大跳补偿、同向连续跳进 |
| `fixturesChord.ts` | 8 | 转位低音、三类重复倾向音、构成音、增六与四六配置、未分类外音 |
| `fixturesResolution.ts` | 3 | 导音、七音、增六解决 |
| `fixturesNonchord.ts` | 5 | 经过、延留准备与解决、辅助、先现 |
| `fixturesFunctionRhythm.ts` | 6 | 功能倒退、终止四六与副属目标、四六连接、和声切分与终止四六拍位 |

夹具共用 `fixtureContract.ts` 的谱例和编辑契约，由 [fixtures.ts](../src/domain/harmony/rules/guardrails/fixtures.ts) 聚合。[矩阵运行器](../src/domain/harmony/rules/guardrails/counterexampleGuardrail.test.ts) 核对正式规则清单与入口覆盖。大跳补偿规则 `melody.leap-recovery` 默认关闭，仅在自己的夹具中按 `warning` 开启。

- **条件入口**直接检查带和弦与人工标注的工程。
- **盲推入口**清空和弦、外音角色、句界和终止式，对纯音符工程调用 `inferHarmony`。同一份推导结果分别关闭和开启 `writeNonChordToneRoles` 后接受检查。27 条双入口规则各有至少 2 个有效盲推反例。
- **仅条件入口的 8 条规则**包括 `chord.inversion-bass`、`function.cadential64-target`、`connection.second-inversion-context` 及表中的 5 条外音规则。它们核对题给的转位、用途或外音角色。规则或个别反例跳过盲推时须注明 `blindSkipReason`。
- **纯音符作业对照**从只有 SATB 音符的谱例直接运行检查，再分别检查回写关、开的推导工程。断言覆盖 E–D–E 辅助音的实际角色、直接可见的女低音域错误，以及建立和弦身份后才能定位的等音错拼。[角色回写测试](../src/domain/harmony/rules/guardrails/notesOnlyRoleWriteback.test.ts)

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
- 核心规则变动是否同步校验正式成对反例矩阵与 `RuleCases/` 金样本？
- 桌面目录扫描、原子写盘、删除与最近目录记忆是否在 E2E 中覆盖？
- 新增规则金样本时是否同时提交用例文件与对应修复？
