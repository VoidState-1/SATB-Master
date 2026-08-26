# 和声规则运行时与 Obligation 状态

本文说明规则调度、无状态 evaluator 和跨切片 obligation 规则的当前运行时契约。

## 1. 两类规则

- 无状态规则：一次读取同一 revision 的分析快照，返回自己的诊断列表。
- 义务规则：在某个切片开启音乐义务，随后逐切片转移，直到解决、违反、取消或因信息不足而暂缓。

两类规则都使用同一个 HarmonyRuleContext。查询 API 只提供只读事实，不保存规则状态。

## 2. Obligation 数据

运行时状态是 RuleStateEnvelope，所有权归创建它的规则：

`ts
{
  id,
  ownerRuleId,
  createdAt: { tick, sliceIndex },
  subjectRefs: { voiceIds, noteIds, chordIds, spanIds },
  payload
}
`

payload 必须是纯 JSON。宿主校验规则归属、引用、时间、数量和大小；规则不能读取或修改其他规则的状态。

obligation-v2 的 payload 还包含 partitionKey 和最多保留 32 项的 history。历史记录包括 tick、结果和原因，用于诊断 trace，不是新的决策输入。

## 3. 逐切片流程

每个分析切片按以下顺序处理：

`text
source.collect 当前切片的开启候选
-> 按 partitionKey 与已有状态匹配
-> 应用 retrigger 策略
-> transition 读取当前义务和上下文
-> continue / resolve / violate / cancel / indeterminate
-> 必要时创建 outgoing 状态或诊断
`

source 只负责发现候选；transition 只负责当前义务的音乐推理；reportViolation 只负责构造该规则的诊断，不应偷偷改变状态。

结果语义：

- continue：义务仍然有效，保留状态。
- resolve：义务已满足，删除状态。
- violate：义务未满足，产生诊断并删除状态。
- cancel：上下文表明义务不再适用，静默删除状态。
- indeterminate：证据不足，按规则策略保留或取消，但不得自动当作违规。

未返回 decision 时使用 onNoDecision，工程结束时使用 onEnd。默认策略是继续和结束时取消。

## 4. 重触发与分区

同一 partitionKey 表示同一项音乐义务。重复触发由 retrigger 明确决定：

- retain-existing：保留原义务；
- refresh-source：更新来源引用；
- fork：创建独立义务；
- reject：忽略新的触发。

分区键必须反映真实音乐身份，例如声部、来源 span、书写音高和固定解决目标。不能只使用当前切片或 MIDI 音高，以免 V -> V7、同音重复或跨声部轮转被错误结算。

## 5. 诊断与调试

义务违反时，诊断应引用：

- subjects.origin：义务的来源音符、和弦或 span；
- subjects.failure：实际导致违反的事件；
- subjects.context：判断所需的邻域或连接；
- trace：每次状态转移的结果和原因。

规则应在 debugFacts 或 trace 中记录影响结论的事实，但不得把完整分析对象复制到状态 payload。详细格式见 [diagnostics-and-debugging.md](./diagnostics-and-debugging.md)。

源码入口：`obligation.ts`、`moment.ts`、`runtime.ts`。
