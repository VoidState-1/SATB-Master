# SATB Master 规则引擎审计修正计划

> 状态：F0-F7 实现完成；本地桌面验收通过，安装后 E2E 待后续发布阶段执行。
>
> 审计日期：2026-08-09。本文以 `codex/src-architecture-refactor` 分支的
> `f7f277b` 为当前架构基线，以 `harmony-rule-engine-rewrite-plan.md` 和
> `harmony-rule-catalog.md` 为音乐学与产品契约基线。
>
> 本文不是第三套规则设计，而是对上一份重写方案的执行修正。原方案中的规则
> ID、斯波索宾口径、P0-P3 分级和规则私有状态信封继续有效；本文只修正已经
> 发生的架构迁移影响、实现偏离和验收顺序。

## 1. 修正结论

上一轮 `src` 架构重构没有破坏规则引擎的领域边界，反而已经形成了可以继续
使用的稳定入口：

```text
src/domain/project/index.ts       工程模型、校验、规范化、V2 -> V3 迁移
src/domain/harmony/index.ts       和声分析、规则注册表、调度器、外置 API
src/domain/harmony/rules/          规则目录、分组、共享事实、连接器、适用性、仲裁
src/domain/ruleProfile.ts          工程规则配置命令和便携档案
src/features/settings/             双栏设置页和 schema 控件
src/app/controllers/              和声检查、工程历史和异步 revision 编排
src/services/externalRuleRuntime.ts  外置规则 Worker 调度
src/workers/externalRule.worker.ts  QuickJS Worker 入口
```

因此不应回退到旧的 `src/domain/model.ts`、`src/domain/harmony.ts`、
`src/domain/harmonyRules.ts`、`src/components/ShortcutSettings.tsx` 或
`src/domain/rules/` 路径。原重写方案中的这些路径只作为历史名称保留，后续实现
全部按本文的当前路径执行。

审计确认的主要修正面：

1. 工程 `RuleProfile` 必须成为完整、可版本化的规则快照，不能继续使用稀疏覆盖。
2. `RuleApplicabilityPlanner` 必须消费分析层产生的上下文事实，不能只过滤规则
   自己填写的标签。
3. `HarmonySpan`、连接器、目标链和规则私有解决状态必须在调性边界、局部主化与
   连续链上保持一致；宿主不重新解释具体解决义务。
4. 诊断仲裁必须支持一个专用规则覆盖多个通用规则，并采用稳定根因而不是完全相同
   的对象 ID 集合来判断覆盖关系。
5. 已启用规则要先修正明确的误判/漏判，再继续实现 H.1-H.8 等依赖新仲裁的规则。
6. 外置 API v3、设置页和开发者文档必须与当前领域公共入口同步。

## 2. 与原方案的关系

### 2.1 保留的决定

- 规则目录仍以 `DesignDocs/harmony-rule-catalog.md` 为音乐学单一来源。
- 规则 ID、默认严重性、P0/P1/P2/P3 和实施状态继续由注册表派生。
- 和弦实体、和声语义、功能标记、连接关系和证据是不同字段，不能互相覆盖。
- 连续同和弦区域聚合为 `HarmonySpan`。
- 跨切片信息通过规则私有 `RuleStateEnvelope` 传递；宿主只校验所有权、引用、
  时间和 JSON 大小，不解释 `leading-tone`、`suspension` 等音乐学义务。
- 外置规则继续运行在 Web Worker + QuickJS 沙箱，不能读取 DOM、Electron、文件
  路径、网络或其他规则状态。

### 2.2 需要修订的决定

| 原方案问题 | 当前修正决定 |
| --- | --- |
| 计划路径仍指向 `src/domain/rules/` | 统一使用 `src/domain/harmony/rules/`，由 `harmony/index.ts` 公开导出 |
| `builtin` 只存偏离默认值 | 工程保存所有已知内置规则的完整实例；缺失项不能静默采用新默认严重性 |
| Planner 只处理诊断附带标签 | 分析层先产生不可变上下文事实，Planner 根据对象引用和事实计算策略 |
| 单个 `parentRuleId` | 改为可声明多个被覆盖规则，并用稳定根因/连接键仲裁 |
| `familyOf` 可按级数回退 T/S/D | 没有确定 `FunctionalDesignation` 时连接关系为 `unknown`，不再按级数猜测功能族 |
| D9、局部主化由尚未启用的 H.2 兜底 | E.1/E.2 先支持 D9 的通用解决事实；H.2 再做联合诊断覆盖 |
| 规则上下文可任意写入 `exceptionContexts` | 内置规则不得自行声明公共上下文；外置规则读取宿主提供的事实并由宿主判定策略 |
| 未实现规则设置控件全部禁用 | 81 条目录都可配置和保存；未实现规则不进入执行队列，默认保存为 `off` |

V3 工程格式和外置 API v3 仍未正式发布。允许直接修改当前 V3 类型和 API，不
增加 V3 -> V3 运行时兼容层；V2 -> V3 迁移器随当前契约一起更新。

## 3. 当前架构适配原则

### 3.1 领域边界

- `src/domain/project` 只负责工程数据、校验、规范化和迁移，不导入规则 UI。
- `src/domain/harmony/analysis.ts` 只建立不可变切片、声部转换、span、连接和共享
  事实，不决定严重性。
- `src/domain/harmony/runtime.ts` 负责规则执行、状态信封校验、适用性和结果汇总。
- `src/domain/harmony/registry.ts` 是唯一内置规则执行注册点。
- `src/domain/harmony/rules/catalog.ts` 负责目录元数据；规则实现按
  `rules/groups/*.ts` 分组。
- `src/domain/ruleProfile.ts` 是工程配置的唯一写入入口；React 设置页只提交命令。
- `src/app/controllers/useHarmonyController.ts` 负责 revision、取消和内外置结果合并，
  不承载具体规则判断。

### 3.2 不重新建立 facade

迁移后的调用方只能从以下入口导入：

```text
domain/project/index.ts
domain/harmony/index.ts
features/settings/index.ts
```

新增功能不得创建同名兼容文件，也不得从 `features` 反向导入另一个 feature 的
内部文件。若需要跨模块共享事实，应下沉到 `domain/harmony` 或上移到 `app`。

### 3.3 版本和提交策略

- 当前分支继续作为架构基线；实际开发应从该基线创建独立修正分支，不能重新从
  `codex/v2-major-version` 分叉。
- 每个修正阶段使用小提交，提交信息标明 `rule-profile`、`applicability`、
  `arbiter` 或具体规则组。
- 阶段性改动只运行匹配的领域测试和类型检查；F2、F4、F6 等里程碑再运行全量
  测试和生产构建。
- 不在每个小提交生成安装包；所有规则修正和文档同步完成后才生成正式安装包。

## 4. 修正阶段

### F0：契约冻结与回归基线

**目标：** 在修改行为前把审计发现变成可复现的测试和迁移清单。

**工作内容：**

- 建立 `rule-engine-correction` 测试夹具目录，所有样本通过
  `src/domain/project` 和 `src/domain/harmony` 公共入口创建。
- 固定 81 条目录项、44 条当前实现项、37 条明确延期项的注册表断言。
- 为每条当前启用规则建立最小违规、相邻合法、同和弦转换、大小调、书写等音和
  上下文不足样本；尚未实现的设计项不进入内置规则集合。
- 增加架构边界测试，禁止重新出现旧根级入口和旧目录导入。
- 将以下审计样本先写成失败测试：D9 导音/七音、局部主化导音、休止后旋律、
  变化和弦对斜、跨调号 span、It/Fr/Ger+6 差异、G.2 插入 K46、多父覆盖。

**验收：** 基线测试通过；新增样本明确记录当前失败原因；不改变生产代码。

### F1：完整 RuleProfile 与设置契约

**目标：** 消除稀疏配置造成的默认值漂移，并让工程配置与当前规则目录保持独立。

**实现位置：**

- `src/domain/project/types.ts`
- `src/domain/project/defaults.ts`
- `src/domain/project/validation.ts`
- `src/domain/project/normalize.ts`
- `src/domain/project/migrations/v2ToV3.ts`
- `src/domain/ruleProfile.ts`
- `src/features/settings/RuleSettingsPane.tsx`
- `src/features/settings/BuiltinRuleDetails.tsx`

**工作内容：**

1. 将 `RuleProfile.profileVersion` 提升为当前开发期版本，并增加
   `catalogRevision`。`PROJECT_SCHEMA_VERSION` 仍为 3，不增加 V3 -> V3 兼容层。
2. `createDefaultRuleProfile()` 为 81 条已知规则建立完整实例。已实现规则使用目录
   默认严重性；未实现规则默认使用 `off`，但仍保存完整 config/schema 和特例策略。
3. 校验器区分三类数据：已知内置规则、未挂载外置引用和未来未知内置 ID。未知 ID
   不进入执行队列，但必须出现在导入/升级报告中。
4. `resolveBuiltinRuleProfile()` 不再用当前应用默认值填补缺失规则。缺失规则先以
   `off` 形成不可执行快照，并返回 `addedRuleIds`/`profileUpgradeRequired`。
5. 打开旧的开发期 V3 工程时，由文件工作流显示“规则目录更新”提示；用户确认后
   通过一次工程历史提交补齐完整快照。未确认前不能静默启用新规则。
6. `resetBuiltinRule` 和 `resetAllBuiltinRules` 写入目录默认实例，而不是通过删除
   条目恢复默认；音域仍写入 `shared.voiceRanges`。
7. 设置页允许查看、配置和恢复全部 81 条规则。未实现规则显示“不会执行”，但严重
   程度和已声明配置可以保存，以便用户提前建立 profile。

**验收：** 新建、打开、保存、重开、撤销/重做、损坏值恢复、目录更新确认和配置
档案导入导出均保持完整快照；同一工程不因应用默认模板变化而改变结果。

### F2：分析事实、HarmonySpan 与适用性

**目标：** 让所有规则共享同一条时间链和上下文事实，修复跨调性 span 和无效特例
开关。

**实现位置：**

- `src/domain/harmony/analysis.ts`
- `src/domain/harmony/rules/sharedFacts.ts`
- `src/domain/harmony/rules/applicability.ts`
- `src/domain/harmony/runtime.ts`
- `src/domain/harmony/external/api.ts`

**工作内容：**

1. 以切片边界为基础建立 span 分段：连续、相同局部调性、相同实体（允许低音/转位
   变化）和相同语义才可聚合。单个和弦区域内部的调号事件必须切断 span。
2. 将 `chordSpanIds` 从“一个 chord ID 对应一个 span ID”改为可返回多个 span ID，
   或提供等价的 `spanIdsForChord()` 查询；同步更新外置上下文和开发者检查器。
3. 在 analysis 中生成不可变 `HarmonyContextFacts`：

   ```ts
   interface HarmonyContextFacts {
     sameHarmonyTransitionIds: readonly string[];
     arpeggiationTransitionIds: readonly string[];
     voiceExchangeTransitionIds: readonly string[];
     innerVoiceTransitionIds: readonly string[];
     bassStepUpTransitionIds: readonly string[];
     nonchordToneNoteIds: readonly string[];
     pedalSpanIds: readonly string[];
     cadenceSpanIds: readonly string[];
     modulationConnectionIds: readonly string[];
   }
   ```

   `sequence` 只有在建立明确的序进标注/分析事实后才能进入规则设置；没有事实
   生产者时不得显示一个看似可用但永远不命中的开关。
4. `voicePairTransitionFacts`、`chordMemberFacts` 和低音运动事实成为生产规则的
   唯一来源；规则组不得重新计算相同的声部对和书写音程。
5. Planner 改为根据规则定义、诊断对象引用、时间范围和 `HarmonyContextFacts`
   计算 `strict/deferred/downgraded/skip`。内置规则不再直接返回公共
   `exceptionContexts`；诊断只返回规则特有证据和稳定 subject/cause 引用。
6. 上下文不足、歧义、调性变化、休止、持续音和非和弦音必须有明确的 skip/deferred
   结果，不得用普通和声错误代替。

**验收：** 同和弦 1/2/N 个区域、内部调号切分、休止、持续音、声部交换、变化和弦、
共同和弦和歧义语义测试通过；相同规则在改变注册顺序后结果一致。

### F3：精确连接器与目标链

**目标：** 彻底移除规则路径中的粗粒度功能回退，并让 G.2/G.3/G.4 使用同一连接
事实。

**实现位置：**

- `src/domain/harmony/rules/connector.ts`
- `src/domain/chordModel.ts`
- `src/domain/functionalHarmonyCatalog.ts`
- `src/domain/harmony/rules/groups/function.ts`
- `src/domain/harmony/rules/groups/stateful.ts`

**工作内容：**

1. `familyOf()` 只读取确认的 `FunctionalDesignation.primaryFunction`；没有确认
   designation 时返回 `unknown`，不再使用级数数组回退 T/S/D。
2. `targetMatched` 同时比较目标级数、主/次功能、局部调性和目标实体允许的结构；
   不能仅因两个解释具有相同 degree 就通过。
3. 连接器继续只输出关系事实，不输出错误文字；连接事实增加稳定
   `connectionKey`，供规则和仲裁共同引用。
4. 副属目标状态改为沿连接图查询，而不是只检查下一个 span：
   - 同一 span 内转换继续保留；
   - `K46 -> D` 作为显式允许的中介路径；
   - 阻碍进行、转调、共同和弦重解释必须由人工语义或目标策略确认；
   - 休止、无目标或歧义时结束为 `deferred`，不强行报错。
5. 所有局部主化的倾向音状态使用目标实体的书写拼写建立预期音，而不是读取主调
   的第七级。

**验收：** D->T、D->S 逆功能、DD->D、DD->K46->D、副属目标、阻碍、共同和弦和
转调边界具有明确的连接关系、目标匹配和置信度；无 designation 的纯罗马/绝对和弦
不会被猜成 T/S/D。

### F4：诊断归属与多父仲裁

**目标：** 在实现 H.1/H.2 之前先修好专用/通用规则的覆盖机制。

**实现位置：**

- `src/domain/harmony/rules/types.ts`
- `src/domain/harmony/runtime.ts`
- `src/domain/harmony/rules/diagnosticArbiter.ts`
- `src/domain/harmony/rules/catalog.ts`
- `src/domain/harmony/rules/helpers/core.ts`

**工作内容：**

1. 将 `parentRuleId?: string` 改为 `coveredRuleIds: readonly HarmonyRuleId[]` 或
   等价的多父声明。覆盖关系只能由目录声明，外置规则不能覆盖内置规则。
2. 诊断增加结构化 `causeRefs`/`coverageRefs`。参考格式：

   ```text
   resolution.leading-tone|connection:span-a->span-b|voice:alto
   resolution.chord-seventh|connection:span-a->span-b|voice:alto
   resolution.dominant-ninth|connection:span-a->span-b|voice:alto
   ```

   仲裁依据稳定根因、连接键、声部/音符 subject 和时间重叠判断覆盖，不再要求所有
   noteIds/chordIds/voiceIds 完全相同。
3. 归属元数据由规则定义声明：和弦完整性/配置只归属和弦，连接规则归属连接区域，
   单声部规则归属对应音符；证据音符可以存在于 evidence 而不成为 UI 错误标记对象。
4. 删除 `melody.tritone` 的硬编码父规则特判，改为目录覆盖声明。
5. 增加执行顺序置换、同根因合并、D7 多父覆盖、D9 多父覆盖、增六专用覆盖和外置
   不得覆盖内置的测试。

**验收：** 同一连接上的通用导音/七音/九音诊断最多显示一次；和弦配置错误不会被
连接错误吞掉；规则注册顺序不影响最终结果和对象归属。

### F5：已启用规则修正

**目标：** 先修当前 44 条规则中已经能明确判定的错误，再扩展未实现规则。

**工作内容：**

- **A.1/A.2：** 音域提示使用实际 profile 上下界；同声部重叠使用区间扫描或活动
  集合，不能只依赖相邻数组项。
- **B.1-B.4：** 仅检查 `contiguous` 的连续旋律；休止和项目边界产生结构化上下文
  不足。大跳仍按实际音程，增减音程按书写音程。
- **B.5：** 只命中书写上的增四/减五，并由仲裁覆盖 B.3/B.4 的同源诊断。
- **C.1-C.8：** 使用 `voicePairTransitionFacts`；对斜先判断和弦 identity、
  变化和弦、半音化、共同和弦和调性边界，再由 Planner 应用特例。
- **D.8/D.9：** 稳定 span 出口再检查重复导音/七音；D9 的七音按 degree 7 识别，
  不再因 tone 数量为 5 而跳过。
- **E.1：** 支持主调和局部主化导音，保存预期目标书写音；同和弦 span 延迟，离开
  span 后沿同一声部检查。
- **E.2/E.3：** 目标音必须属于目标和弦，且使用书写级进判断；D9 的七音和九音
  共享状态证据，之后由 H.2 专用规则覆盖。
- **E.4/E.5：** 方向来自结构化 alteration/增六语义，不从 accidental 字符猜测；
  增六两端和目标属功能使用同一连接事实。
- **G.1-G.4：** 只消费精确 connector；G.2 使用 F3 的目标链，G.3/G.4 保留
  调性、K46 和歧义边界。

每条修正必须有最小违规、相邻合法、同和弦、大小调、书写等音和上下文不足测试；
没有对应样本的规则不能进入内置规则集合。

### F6：Phase E 规则和 API v3 收敛

**目标：** 在 F2-F4 稳定后，补齐当前已声明启用但实现过粗的功能和弦规则，并使
外置规则真正读取同一上下文契约。

**工作内容：**

1. D9 根音/九音间距同时验证实际半音、书写复九度和当前支持的 `1/3/7/9` 配置；
   缺失成员由配置规则单独归属。
2. It+6、Fr+6、Ger+6 使用三个独立连接策略：It+6 中间构成音/目标配置、Fr+6
   特有音、Ger+6 直入 D 的平行风险和经 K46 的允许路径分别测试。
3. H.1-H.8 只有在多父仲裁、目标策略和各转位金样本完成后才启用；不得为了增加
   实现数量而把单一通用检查器改名注册成专用规则。
4. 外置 API v3 直接更新 `src/domain/harmony/external/api.ts`、`protocol.ts`、
   `sandbox.ts`、`src/workers/externalRule.worker.ts` 和
   `src/services/externalRuleRuntime.ts`：
   - 上下文增加裁剪后的 `HarmonyContextFacts`、`connectionKey` 和目标链事实；
   - 外置诊断引用稳定 subject/cause，不自行伪造最终严重程度；
   - 宿主在 Worker 外统一执行 schema、适用性、归属和严重程度；
   - 因 API v3 尚未正式发布，不提供 v2/v3 双执行器。
5. 更新 `Docs/harmony-engine.md` 和 `Docs/external-rules.md`，只记录实际已经验收
   的字段，不能把“目录存在”写成“规则完成”。

**验收：** 外置规则能读取与内置规则相同的裁剪事实；非法 context、非法引用、
   超时、内存、异常和旧 revision 仍被隔离；内置规则结果不受外置失败影响。

### F7：性能、设置页和桌面收敛

**目标：** 在语义正确后完成原方案中明确延期的性能和交付工作。

**工作内容：**

- 将工程 revision、profile revision、分析 revision 分离；配置变化复用已有
  `HarmonyAnalysis`，只重跑受影响规则及仲裁关联规则。
- 为 `useHarmonyController` 提供共享 analysis 快照，避免内置调度和外置运行时各自
  完整构建一次分析。
- 对 `RuleSettingsPane` 的 81 条内置规则和外置目录做列表虚拟化；过滤和键盘导航
  不能丢失选择状态。
- 使用 `src/domain/time.ts` 处理 duration 的 tick/beat/measure 转换，变拍号不能
  继续使用固定 `ppq * 4`。
- 运行 5,000 音符、长 span、大量和弦区域、配置连续编辑和外置规则取消基准。
- 在 Electron 开发模式和安装后隔离 userData 中验证打开、恢复、规则设置、播放、
  SoundFont、保存和外置包缺失流程。

**验收：** 达到原方案的 100 ms 目标和可取消要求；浏览器降级、Electron 开发模式、
免安装目录和 NSIS 安装包分别完成适用范围内的验证。

## 5. 文件迁移对照表

| 原重写方案名称 | 当前实现入口 | 修正计划使用方式 |
| --- | --- | --- |
| `src/domain/model.ts` | `src/domain/project/types.ts`、`defaults.ts`、`validation.ts`、`normalize.ts`、`migrations/v2ToV3.ts` | F1 |
| `src/domain/harmonyAnalysis.ts` | `src/domain/harmony/analysis.ts` | F2 |
| `src/domain/harmonyRuntime.ts` | `src/domain/harmony/runtime.ts`、`registry.ts` | F2/F4 |
| `src/domain/harmonyRules.ts` | `src/domain/harmony/rules/groups/*`、`catalog.ts`、`registry.ts` | F3-F6 |
| `src/domain/externalRules.ts` | `src/domain/harmony/external/api.ts`、`protocol.ts`、`sandbox.ts` | F6 |
| `src/domain/externalRuleWorkerProtocol.ts` | `src/domain/harmony/external/protocol.ts` + `src/workers/externalRule.worker.ts` | F6 |
| `src/services/externalRuleRuntime.ts` | 保持现路径 | F6/F7 |
| `src/hooks/useHarmonyRuleSettings.ts` | `src/domain/ruleProfile.ts` + `src/app/controllers/useHarmonyController.ts` | F1/F7 |
| `src/components/ShortcutSettings.tsx` | `src/features/settings/SettingsDialog.tsx` 和各 Pane | F1/F6/F7 |

本表是后续修改的路径真相源。若原重写方案中的其他文件表与本表冲突，以本表和
`Docs/architecture.md` 为准。

## 6. 验证与提交门槛

### 每个修正阶段

- 运行匹配模块的 Vitest 测试和 `npm run typecheck`。
- 不生成安装包，不修改 SoundFont、Electron 资源或无关 UI。
- 提交信息包含阶段编号和行为范围；不得把规则语义修正与目录搬迁混在同一提交。

### 里程碑

| 里程碑 | 必须通过 |
| --- | --- |
| F1 完成 | profile/schema/迁移/设置命令测试、规则配置档案测试、类型检查 |
| F2-F4 完成 | 全量领域测试、上下文事实测试、连接器测试、仲裁测试、架构边界测试、类型检查、生产构建 |
| F5-F6 完成 | 全量测试、规则矩阵、外置 API v3 沙箱测试、生产构建 |
| F7 发布候选 | 全量测试、类型检查、生产构建、性能基准、Electron 桌面 E2E、安装后 E2E |

### 完成标准

只有同时满足以下条件才视为“规则引擎修正完成”：

1. 当前工程保存完整内置规则快照，目录默认或实现状态变化不会静默改变旧工程。
2. Planner 使用分析层上下文事实；设置页没有不会命中的特例开关。
3. span 在内部调性边界切分，连接器不再按级数猜测 T/S/D。
4. 多父专用规则仲裁、和弦/连接对象归属和稳定根因测试通过。
5. 已启用规则的 D9、局部主化、增六、对斜、休止和书写音程边界都有正反例。
6. 外置 API v3、`Docs`、`DesignDocs` 和当前源码路径一致。
7. 性能、构建和桌面验收通过后，才更新产品版本并统一打包。

## 7. 风险控制

- **规则结果大面积变化：** F0 先固定差分样本；F5 每个规则组独立提交，诊断变化
  必须说明是修复还是口径变化。
- **配置格式破坏：** 当前 V3 未发布，允许直接升级 profileVersion；V2 -> V3 只保留
  一条明确迁移路径，并为损坏配置提供报告，不做隐式猜测。
- **上下文过度推断：** 没有结构化事实时返回 `unknown/deferred`，不从 MIDI 半音或
  单个级数猜测功能与特例。
- **仲裁吞掉真实错误：** 覆盖必须带稳定 cause/connection key；和弦配置与连接解决
  永远视为不同根因。
- **重构再次漂移：** 每个新增领域能力必须同时更新 `Docs/architecture.md`、
  本文文件对照表、对应公共入口和架构边界测试。

## 8. 实施记录

2026-08-09 已按当前重构架构完成 F0-F7：

- 工程保存 81 条内置规则的完整 profile 快照，未实现项保持 `off`；目录升级必须经用户确认。
- `HarmonySpan`、共享上下文事实、精确连接、目标链、适用性 Planner 和多父诊断仲裁已接入统一分析流水线。
- 已修正当前启用规则中的音域、重叠、旋律连续性、书写五度/三全音、局部主化、D9、增六和弦与对斜边界。
- 外置规则已升级到 API v3；renderer、Worker、QuickJS、Electron 规则库策略和开发者文档使用同一契约。脚本不能声明最终严重程度、公共特例或内置覆盖关系。
- profile-only 修改复用音乐分析与未变化规则结果；5,000 音符单规则配置修改基准低于 100 ms。
- duration 配置按变化拍号换算；规则目录使用浏览器原生渲染 containment，并补齐设置控件的稳定无障碍名称。

已验证：26 个 Vitest 文件、219 项测试、TypeScript 检查、Vite/Electron 生产构建和本地 Electron E2E。桌面 E2E 覆盖恢复提示、81 条规则设置、API v3 外置包安装/启停/移除/重挂载、V3 和弦往返、播放、SoundFont、保存和 MIDI。

未验证：NSIS 安装包及安装后隔离 `userData` 的 E2E。本阶段按约定未生成安装包，也未提升产品版本。H.1-H.8 等依赖专用金样本的规则仍保持未实现。
