# HarmonyQuery 与规则查询上下文

本文记录当前内置规则使用的领域查询 API。它是函数内部的 LINQ 风格工具，不是独立的规则 DSL，也不替代普通 TypeScript 控制流。

## 1. 分层职责

```text
HarmonyRuleContext  -> 领域对象视图与定位
HarmonyQuery        -> 集合检索、投影和组合
普通 TypeScript     -> 局部变量、分支、提前退出和状态转移
领域服务/共享事实   -> 可复用的音乐学计算
evaluator/state     -> 单条规则的教材口径
DiagnosticFactory   -> 稳定诊断引用
```

基础对象的属性直接通过点语法读取，例如 `note.note.startTick`、`span.chords`、`slice.key`。只有检索、筛选和集合组合才使用 `HarmonyQuery`。

## 2. 上下文入口

`createHarmonyRuleContext(analysis)` 为同一 `HarmonyAnalysis.revision` 创建冻结的只读上下文。8 个集合查询入口及完整 `QueryOptions` 字段如下：

| 入口方法 | 返回视图 | 支持的 `QueryOptions` 字段 |
| --- | --- | --- |
| `ctx.notes(options?)` | `HarmonyQuery<NoteView>` | `voiceId`、`role`（`NonChordToneRole`）、`startingAt`、`startingAfter` |
| `ctx.slices(options?)` | `HarmonyQuery<AnalysisSlice>` | `containingTick`、`overlapping`（`{ fromTick, toTick }`） |
| `ctx.spans(options?)` | `HarmonyQuery<SpanView>` | `id`、`containingTick` |
| `ctx.connections(options?)` | `HarmonyQuery<ConnectionView>` | `sourceSpanId`、`targetSpanId` |
| `ctx.phrases(options?)` | `HarmonyQuery<PhraseSegment>` | `id`、`containingTick` |
| `ctx.cadences(options?)` | `HarmonyQuery<CadenceView>` | `id`、`phraseId`、`kind`、`containingTick`、`source`（`"candidate" \| "manual" \| "accepted-candidate"`） |
| `ctx.melodyTransitions(options?)` | `HarmonyQuery<MelodyTransition>` | `voiceId` |
| `ctx.sliceTransitions(options?)` | `HarmonyQuery<SliceTransition>` | `fromSliceIndex`、`toSliceIndex` |

```ts
ctx.notes({ voiceId: "soprano", role: "passing", startingAfter: tick })
ctx.slices({ containingTick: tick })
ctx.slices({ overlapping: { fromTick, toTick } })
ctx.spans({ id: spanId, containingTick: tick })
ctx.connections({ sourceSpanId, targetSpanId })
ctx.phrases({ id: phraseId, containingTick: tick })
ctx.cadences({ phraseId, kind: "half", source: "manual" })
ctx.melodyTransitions({ voiceId })
ctx.sliceTransitions({ fromSliceIndex, toSliceIndex })
```

定位方法包括 `sliceAt`、`spanAt`、`keyAt`、`phraseAt`、`boundaryAt`、`cadenceAt`；邻域方法包括 `noteNeighborhood` 和 `spanNeighborhood`。传入邻域方法的视图对象必须来自当前 revision 的上下文，两者的跨 revision 行为有明确区分：

- `noteNeighborhood(note)`：校验 `note` 与当前索引中的规范 `NoteView` 引用一致；若来自其他 revision（或缺失），返回 `undefined`。
- `spanNeighborhood(span)`：校验 `span` 与当前索引中的规范 `SpanView` 引用一致；若来自其他 revision，直接抛出 `Error`。

入口 options 只执行可由索引支持的粗筛选。复杂条件应在返回的查询上使用 `where`，不要继续向 context 增加规则专用参数。

## 3. 核心视图类型

上下文基于 revision 级索引（[`indexes.ts`](../src/domain/harmony/rules/context/indexes.ts)）构建冻结视图（[`views.ts`](../src/domain/harmony/rules/context/views.ts)）：

- `NoteView`：`{ note, voiceId }`；`NoteNeighborhood` 提供同声部 `previous`/`next`、起奏切片 `attackSlice` 与所在 `span`。
- `SpanView`：`{ span, slices, firstSlice, lastSlice, chords }`；`SpanNeighborhood` 提供前后 `previous`/`next` 及 `incoming`/`outgoing` 连接视图。
- `ConnectionView`：`{ connection, source, target, sourceBoundary, targetBoundary }`。
- `CadenceView`：统一合并工程级 `cadenceAnnotations` 与检测候选 `cadenceCandidates`，除基础区间与分类字段（`id`、`fromTick`、`toTick`、`phraseId`、`kind`、`form`、`completion`、`confidence`、`spans`、`chords`、`evidence`）外，还提供：
  - `source`：`"candidate" | "manual" | "accepted-candidate"`，区分候选与人工/已接受标注；
  - `observedLandingTick`：仅靠区间边界不足以定位落点时记录的实际落点 tick；
  - `landingSpan` / `precedingSpan`：终止落点所在 span 与其前一个不同 span（允许跨越受支持的休止）。

关于 `CadenceView` 的 stale 标注过滤与 `SpanView` 裁剪语义：

- **区间裁剪：** 构造终止式覆盖的 `spans` 以及基于 `observedLandingTick` 定位 `landingSpan` 时，若底层 `HarmonySpan` 超出 `[fromTick, toTick)` 或 `[observedLandingTick, toTick)`，索引会通过 `clipHarmonySpan` / `sliceWithinSpan` 对 `SpanView` 进行区间裁剪，确保其 `slices`、`firstSlice`、`lastSlice` 与 `chords` 严格落在终止式窗口内。
- **stale 标注处理：** 对于标记为 `annotation.stale === true` 的旧标注，视图不会绑定匹配的 `candidate`，也不会计算 `landingSpan`/`precedingSpan`；若该 stale 标注带 `observedLandingTick`，不会遮蔽同一区间的新候选，且 `cadenceAt(tick)` 会优先返回非 stale 的有效终止式视图，仅在不存在有效视图时才回退到旧标注。

## 4. 领域服务与诊断工厂

`HarmonyRuleContext` 同时挂载 5 个冻结只读服务，避免规则重复拼接底层算法或手动拼装不稳定引用：

| 属性 | 源码 | 能力说明 |
| --- | --- | --- |
| `ctx.pitch` | [`services/pitch.ts`](../src/domain/harmony/rules/services/pitch.ts) | 书写音程 `writtenIntervalBetween`、书写/发声同音判定 `sameWrittenPitch`/`sameSoundingPitch`、级进 `isStep`、音级与调内音高 `scaleDegreeOf`/`scaleDegreePitch`。 |
| `ctx.metric` | [`services/metric.ts`](../src/domain/harmony/rules/services/metric.ts) | 节拍强弱定位 `positionAt`、区间查询 `positionsBetween`、区间最强拍 `strongestBetween` 与强弱比较 `compare`。 |
| `ctx.harmony` | [`services/harmony.ts`](../src/domain/harmony/rules/services/harmony.ts) | `isWrittenChordTone` / `isSoundingChordTone`、`primaryInterpretation(subject)` 返回三态 `Resolution<HarmonyInterpretation>`（`resolved` / `ambiguous` / `unavailable`），以及 `chordMembersAt(slice)`（切片无显式和弦标记时自动回退至 `analysis.writtenProlongations.get(slice.tick)` 的 `surfaceIdentity` 计算构成音事实）。 |
| `ctx.voiceLeading` | [`services/voiceLeading.ts`](../src/domain/harmony/rules/services/voiceLeading.ts) | `voicePairs(transition)` 暴露六组声部对的书写音程、方向与低音运动事实。 |
| `ctx.diagnostics` | [`diagnostics/factory.ts`](../src/domain/harmony/rules/diagnostics/factory.ts) | `forNotes`、`forSpan`、`forConnection` 三个诊断工厂方法：自动校验视图是否属于当前 revision、验证 tick 范围与对象引用、补齐 `evidence` 与 `subjects.origin/failure` 并执行 `validateDiagnosticShape` / `validateDiagnosticReferences`。 |

## 5. 算子契约

`HarmonyQuery<T>` 实现标准 `Iterable<T>`（支持 `for...of` 与展开语法），并提供静态工厂 `HarmonyQuery.from(items)` 与 `HarmonyQuery.empty()`。当前完整算子集如下：

| 类别 | 算子 |
| --- | --- |
| 构造 | `HarmonyQuery.from`、`HarmonyQuery.empty` |
| 变换 | `select`、`selectMany` |
| 筛选 | `where`、`skipWhile`、`takeWhile` |
| 邻接 | `pairwise`、`window` |
| 去重与排序 | `distinctBy`、`orderBy` |
| 分组 | `groupBy` |
| 量词与定位 | `first`、`last`、`any`、`all`、`count` |
| 迭代与物化 | `[Symbol.iterator]`、`toArray` |

所有中间算子都返回新的 `HarmonyQuery`。查询基于冻结数组即时执行，不是惰性迭代器：创建查询或调用算子时就完成当前集合的计算，之后不会读取变化中的工程对象。

实现语义：

- 默认保留输入顺序；`selectMany` 保留外层和内层顺序。
- `distinctBy` 保留每个键第一次出现的元素。
- `orderBy` 对相同键保持输入顺序；支持 `asc` / `desc`。
- `pairwise` 返回相邻二元组；元素少于两个时为空。
- `window(size)` 返回连续窗口；`size` 必须为正整数，窗口大于集合长度时为空。
- `first`、`last` 找不到元素时返回 `undefined`。
- 空集合上的 `any` 为 `false`，`all` 为 `true`，`count` 为 `0`。
- `groupBy` 返回只读分组视图，分组键按首次出现顺序迭代。
- `toArray` 返回当前只读数组；规则不得修改其中对象或数组。

## 6. 使用原则

推荐把查询结果保存为有意义的局部变量，再用普通控制流表达规则：

```ts
const transitions = ctx.melodyTransitions({ voiceId })
  .where((item) => item.contiguous)
  .toArray();

for (const transition of transitions) {
  const current = ctx.notes({ voiceId }).first((item) => item.note.id === transition.current.id);
  const neighborhood = current ? ctx.noteNeighborhood(current) : undefined;
  if (!neighborhood) continue;
  // 局部教材判断和提前退出留在这里
}
```

领域判断应放在命名服务或规则 evaluator 中，不应增加 `HarmonyQuery` 子类，也不应把 `ruleId` 分支塞入通用算子。算子保留完整集合是为了未来组合查询；是否当前被调用不能作为删除依据。

## 7. 与外置 API 的关系

外置规则运行在隔离环境，读取宿主提供的序列化投影，不直接取得内部 `HarmonyQuery` 实例或工程对象。内部查询 API 与外置 API 的字段投影可以保持概念对应，但两者是不同的安全边界。

主要源码入口：

- [`HarmonyQuery.ts`](../src/domain/harmony/rules/query/HarmonyQuery.ts)（测试：[`HarmonyQuery.test.ts`](../src/domain/harmony/rules/query/HarmonyQuery.test.ts)）
- [`createRuleContext.ts`](../src/domain/harmony/rules/context/createRuleContext.ts)（测试：[`createRuleContext.test.ts`](../src/domain/harmony/rules/context/createRuleContext.test.ts)）
- [`indexes.ts`](../src/domain/harmony/rules/context/indexes.ts)、[`views.ts`](../src/domain/harmony/rules/context/views.ts)
- [`services/pitch.ts`](../src/domain/harmony/rules/services/pitch.ts)、[`services/metric.ts`](../src/domain/harmony/rules/services/metric.ts)、[`services/harmony.ts`](../src/domain/harmony/rules/services/harmony.ts)、[`services/voiceLeading.ts`](../src/domain/harmony/rules/services/voiceLeading.ts)
- [`diagnostics/factory.ts`](../src/domain/harmony/rules/diagnostics/factory.ts)
