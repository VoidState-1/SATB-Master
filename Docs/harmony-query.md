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

`createHarmonyRuleContext(analysis)` 为同一 `HarmonyAnalysis.revision` 创建只读上下文：

```ts
ctx.notes({ voiceId: "soprano" })
ctx.slices({ overlapping: { fromTick, toTick } })
ctx.spans({ containingTick: tick })
ctx.connections({ sourceSpanId })
ctx.melodyTransitions({ voiceId })
ctx.sliceTransitions({ fromSliceIndex, toSliceIndex })
ctx.phrases({ containingTick: tick })
ctx.cadences({ phraseId, kind: "half" })
```

定位方法包括 `sliceAt`、`spanAt`、`keyAt`、`phraseAt`、`boundaryAt`、`cadenceAt`；邻域方法包括 `noteNeighborhood` 和 `spanNeighborhood`。传入邻域方法的对象必须来自当前 revision 的上下文，否则返回 `undefined` 或抛出错误。

入口 options 只执行可由索引支持的粗筛选。复杂条件应在返回的查询上使用 `where`，不要继续向 context 增加规则专用参数。

## 3. 算子契约

当前完整算子集如下：

| 类别 | 算子 |
| --- | --- |
| 变换 | `select`、`selectMany` |
| 筛选 | `where`、`skipWhile`、`takeWhile` |
| 邻接 | `pairwise`、`window` |
| 去重与排序 | `distinctBy`、`orderBy` |
| 分组 | `groupBy` |
| 量词与定位 | `first`、`last`、`any`、`all`、`count` |
| 物化 | `toArray` |

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

## 4. 使用原则

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

## 5. 与外置 API 的关系

外置规则运行在隔离环境，读取宿主提供的序列化投影，不直接取得内部 `HarmonyQuery` 实例或工程对象。内部查询 API 与外置 API 的字段投影可以保持概念对应，但两者是不同的安全边界。

源码入口：`HarmonyQuery.ts`、`createRuleContext.ts`。算子边界由 `HarmonyQuery.test.ts` 和 context 测试维护。
