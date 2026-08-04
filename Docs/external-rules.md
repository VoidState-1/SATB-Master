# 外置规则开发与沙箱

本文是 `.satb-rule.js` 规则包的开发者契约，说明 API v2、可见上下文、状态规则、安装方式和安全限制。内置分析结构见 [harmony-engine.md](./harmony-engine.md)，桌面规则库存储见 [desktop-and-persistence.md](./desktop-and-persistence.md)。实现以 [`src/domain/externalRules.ts`](../src/domain/externalRules.ts) 和 [`src/domain/externalRuleSandbox.ts`](../src/domain/externalRuleSandbox.ts) 为准。

## 1. 目标与非目标

外置规则用于在不重新构建主程序的情况下增加检查逻辑，同时保证：

- 规则只能读取经过裁剪的音乐快照。
- 单条规则崩溃、超时或越界不能阻塞内置规则和编辑器。
- 工程只引用确定内容哈希的本机规则包。
- 规则结果必须通过与内置诊断相同的对象引用和范围校验。

它不是通用插件系统。外置规则不能添加 React 界面、读取磁盘、联网、控制播放、修改工程或调用 Electron。

当前契约版本：

```ts
EXTERNAL_RULE_API_VERSION = 2
```

V3 和 API v2 尚未正式对外发布，当前大版本开发可以直接修改契约而不兼容 API v1；一旦公开发布，破坏性变更必须提升 API 版本。

## 2. 文件与注册

规则包扩展名为：

```text
.satb-rule.js
```

单文件最大 512 KiB。脚本必须且只能调用一次：

```js
SATB_RULE.register({
  manifest: {
    apiVersion: 2,
    packageId: "org.example.rules",
    version: "1.0.0",
    rules: [
      {
        id: "example-rule",
        label: "示例规则",
        description: "说明该规则判断什么。",
        group: "custom",
        defaultSeverity: "suggestion",
        dependencyScope: "note",
      },
    ],
  },
  rules: [
    {
      id: "example-rule",
      evaluate(context, config) {
        return [];
      },
    },
  ],
});
```

`manifest.rules` 是安装和设置页读取的静态目录，`rules` 是可执行实现。两边 ID 必须一一对应。

### 2.1 manifest 字段

| 字段 | 约束 | 说明 |
| --- | --- | --- |
| `apiVersion` | 必须等于 2 | 规则 API 契约 |
| `packageId` | 小写字母/数字及 `._-`，最长 128 | 全局稳定包标识，不使用文件名 |
| `version` | 受限版本字符串，最长 64 | 包作者声明的版本 |
| `rules[].id` | 包内唯一稳定 ID | 与可执行规则匹配 |
| `label` | 简短可读文本 | 设置页和诊断来源展示 |
| `description` | 规则适用范围 | 不应只重复 label |
| `group` | voice/melody/voiceLeading/chord/custom | 设置页分组 |
| `defaultSeverity` | error/warning/suggestion | 首次启用默认值 |
| `dependencyScope` | note/slice/chord/phrase/project | 依赖范围和未来增量失效 |

`packageId + version` 不足以证明源码相同；安装和工程引用还包含 SHA-256 `contentHash`。

## 3. 无状态规则

无状态规则实现同步 `evaluate(context, config)`，返回诊断数组。下面示例检查过长的女高音音符：

```js
{
  id: "long-soprano-note",
  evaluate(context, config) {
    const beats = typeof config.thresholdBeats === "number"
      ? Math.max(1, config.thresholdBeats)
      : 4;
    const threshold = context.project.ppq * beats;
    const soprano = context.project.satbTracks.find(
      (track) => track.id === "soprano",
    );
    if (!soprano) return [];

    return soprano.notes
      .filter((note) => note.durationTicks > threshold)
      .map((note) => ({
        tick: note.startTick,
        endTick: note.startTick + note.durationTicks,
        voiceIds: ["soprano"],
        noteIds: [note.id],
        chordIds: [],
        title: "女高音持续时间较长",
        message: `该音符持续超过 ${beats} 拍。`,
        messageKey: "long-soprano-note",
        params: { thresholdBeats: beats },
        evidence: [{
          kind: "note",
          id: note.id,
          label: "持续 tick",
          value: String(note.durationTicks),
        }],
        confidence: 1,
      }));
  },
}
```

规则不返回 `severity` 和稳定诊断 ID。宿主从工程配置注入严重程度，并在验证后生成 ID。

## 4. 有状态规则

需要沿时间链等待后续事件时，实现同步 `process`，可选 `finalize`：

```js
{
  id: "stateful-example",
  process(step, incoming, config) {
    const diagnostics = [];
    const outgoing = [...incoming];

    // 根据 step.slice、step.span 等创建、满足或删除自己的状态。
    // outgoing 中每个对象都必须是 ownerRuleId === 本规则 ID 的合法信封。

    return { diagnostics, outgoing };
  },
  finalize(lastStep, remaining, config) {
    return { diagnostics: [] };
  },
}
```

每个 step 包含：

- `analysis`：外置规则上下文。
- `slice` / `sliceIndex`：当前切片。
- `previous`：前一切片（若存在）。
- `transitionFromPrevious`：相邻切片转换。
- `span`：当前 `HarmonySpan`（若存在）。
- `isSpanStart` / `isSpanEnd`：当前跨度边界。

状态信封结构与内置规则一致：

```js
{
  id: "state-id",
  ownerRuleId: "stateful-example",
  createdAt: { tick: step.slice.tick, sliceIndex: step.sliceIndex },
  subjectRefs: {
    voiceIds: ["soprano"],
    noteIds: ["existing-note-id"],
    chordIds: [],
    spanIds: [],
  },
  payload: { anyRulePrivateJson: true },
}
```

限制：

- 每条规则最多 512 个状态。
- 状态 ID 在本步输出中唯一，最长 128。
- `ownerRuleId` 必须等于当前规则 ID。
- `createdAt` 不能位于当前 step 的未来。
- subject refs 必须引用上下文中存在的声部、音符、和弦或 span。
- 每个 payload JSON 序列化后最多 16 KiB。

宿主不会解释 payload 或代替规则判断何时解决。规则必须在 `process` 中显式保留/删除状态，在工程结尾使用 `finalize` 决定剩余状态的结果。

## 5. 可见上下文

`context` 被深度冻结，结构大致为：

```text
apiVersion / revision
project
  schemaVersion / id / title / ppq / lengthTicks
  tempoEvents / meterEvents / keyEvents
  satbTracks / chordTrack
slices
harmonySpans
melodyTransitions
sliceTransitions
chordProgressions
auxiliarySummary { trackCount, noteCount }
```

注意边界：

- SATB 音符可见，因为规则需要精确引用和判断。
- 辅助轨只公开数量摘要，避免非检查材料扩大上下文和隐私面。
- 工程作者说明、音频路径、恢复文件路径、窗口状态等不公开。
- 数据是本次 revision 的快照；保存对象引用到下次运行没有意义。
- 深度冻结意味着不能通过修改数组或对象在规则间传递信息。

规则应优先使用预计算 `slices`、transitions 和 spans，而不是在每次调用内从原始音符重建一套不同的切片算法。

## 6. 诊断输出

每个原始诊断需要提供：

| 字段 | 说明 |
| --- | --- |
| `tick`, `endTick` | 工程内有效范围，`endTick >= tick` |
| `voiceIds` | 涉及的 SATB 声部 |
| `noteIds` | 必须存在的 SATB 音符 ID |
| `chordIds` | 必须存在的和弦区域 ID |
| `title`, `message` | 面向用户的简短标题和具体说明 |
| `messageKey` | 与自然语言分离的稳定根因键 |
| `params` | 字符串/数字/布尔参数，用于聚合和未来本地化 |
| `evidence` | 最多 16 项结构化证据 |
| `confidence` | 0 到 1 的判断置信度 |

单规则最多返回 512 项，消息最多 600 字。无效范围、未知引用、畸形 evidence 或超限结果会使该规则返回 `invalid-result`，不会部分采纳。

对象归属原则：

- 和弦整体问题只填 `chordIds`。
- 单个旋律问题填相应 `voiceIds/noteIds`。
- 两声部进行同时引用两组声部和音符。
- 没有具体对象的 project 级诊断可以使用空引用，但范围和证据仍要清楚。

## 7. 同步执行与能力限制

`evaluate`、`process` 和 `finalize` 必须同步返回。返回 Promise 会被拒绝。沙箱没有事件循环和异步 I/O，因此不要声明 `async`。

每条规则在独立 QuickJS runtime 中执行，当前限制：

| 资源 | 限制 |
| --- | --- |
| CPU 时间 | 100 ms |
| QuickJS 堆 | 32 MiB |
| QuickJS 栈 | 512 KiB |
| 源文件 | 512 KiB |

不可用能力：

- Node.js、Electron 和 CommonJS/ES module 加载。
- DOM、`window.desktop`、Web Audio。
- `fetch`、网络、文件和进程。
- `setTimeout` 等计时器。
- 宿主对象引用或跨规则共享可变状态。

Web Worker 防止运行阻塞 renderer；QuickJS runtime 限制脚本能看到什么以及消耗多少资源。两层都不能移除。

## 8. 导入、安装与工程引用

桌面端规则库使用内容寻址：

```text
userData/rule-library/
  <sha256>.satb-rule.js
  <sha256>.json
```

导入流程：

```text
选择文件
-> 检查扩展名和大小
-> QuickJS inspect 注册信息
-> 校验 manifest 与可执行规则 ID
-> 计算 SHA-256
-> 复制源码和元数据到规则库
-> 在设置中启用规则
```

工程只保存引用：

```text
packageId + version + contentHash + ruleId
+ enabled + severity + config
```

这样工程不会静默执行随路径变化的脚本。若本机缺少对应 hash，引用保留并显示“未挂载”；内置规则继续运行。移除规则库副本也不删除工程配置，重新安装相同内容后可恢复。

浏览器模式用 localStorage 保存规则源码和元数据，仅用于预览，不代表桌面内容寻址文件行为已经验证。

## 9. 失败模型

外置运行报告以下失败代码：

| code | 含义 |
| --- | --- |
| `missing-package` | 工程引用的 hash 未安装 |
| `source-error` | 本机源码无法读取 |
| `manifest-mismatch` | 安装元数据、注册 manifest 或工程引用不一致 |
| `timeout` | 超过 CPU 限制 |
| `memory-limit` | 超过 QuickJS 堆限制 |
| `exception` | 脚本同步抛错 |
| `invalid-result` | 诊断、状态或引用不满足契约 |

失败按 package/rule 记录。一个外置规则失败不能丢弃其他外置规则结果，更不能清空内置诊断。较旧 revision 的整批结果标记 `superseded`，不进入当前 UI。

## 10. 规则开发建议

- 使用稳定、命名空间清晰的 package/rule ID；发布后不要复用 ID 表示完全不同语义。
- 把可调阈值放入 `config`，对类型错误提供保守默认值。
- 先过滤相关切片/音符，避免 O(切片 x 全音符) 的重复扫描。
- 对语义缺失和歧义保持保守；API 当前不允许外置规则返回宿主 `SkippedRule`，可选择不报并在消息设计中避免伪确定性。
- 使用 `messageKey + params` 表达根因，不要把每个音符值拼进 messageKey。
- `confidence` 表示判断依据的确定程度，不是严重程度。
- 有状态规则显式处理休止、换调、span 退出和工程结尾。

## 11. 宿主 API 变更检查表

- 新上下文是否确实是音乐规则所需，是否会泄露辅助素材或本地路径？
- 数据是否可 JSON 序列化、深度冻结并受大小限制？
- 是向后兼容字段增加，还是需要提升 `EXTERNAL_RULE_API_VERSION`？
- inspect、执行、结果验证、Worker protocol 和规则库 UI 是否同步？
- 无状态和有状态脚本是否都有测试？
- 超时、内存、非法引用、Promise、旧 revision 和缺包是否仍隔离？
- 本文示例和契约是否同一提交更新？
