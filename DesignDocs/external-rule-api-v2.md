# SATB Master 外置规则 API v2

> 对应 V2 开发计划 Phase C 与和声语义流水线。API v2 直接替代未发布的 v1，不提供兼容层。规则只能读取只读上下文、传递自己的 JSON 状态并返回诊断，不提供自动修复、第三方界面、模块加载或宿主 API。

## 1. 文件与注册格式

规则包是单个 UTF-8 文本文件，扩展名必须为 `.satb-rule.js`，大小不超过 `512 KiB`。文件不能使用 `import`、`require` 或动态依赖，通过唯一的受控全局完成注册：

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
        description: "规则用途与适用范围。",
        group: "custom",
        defaultSeverity: "suggestion",
        dependencyScope: "project",
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

`manifest.rules` 与可执行 `rules` 必须按相同顺序一一对应。每个文件只能调用一次 `SATB_RULE.register`。

可用分组：`voice`、`melody`、`voiceLeading`、`chord`、`custom`。

可用依赖范围：`note`、`slice`、`chord`、`phrase`、`project`。

## 2. 导入与工程引用

导入分为两个安全步骤：

1. 主进程只读取用户选择的文件，检查扩展名与大小，并计算 SHA-256。
2. manifest 在 QuickJS 中求值并完成结构校验；通过后，源码才会复制到应用私有规则库。

工程文件不保存脚本，只保存：

```ts
{
  ruleId: string;
  packageId: string;
  version: string;
  contentHash: string;
  severity: "error" | "warning" | "suggestion" | "off";
  enabled: boolean;
  config: Record<string, string | number | boolean>;
}
```

重新打开工程时必须同时匹配 `packageId + version + contentHash + ruleId`。缺失或摘要不同的包显示为“未挂载”，不会执行。移除本机私有副本不会删除工程引用。

## 3. 只读上下文

`context` 是可序列化并深度冻结的 plain data，主要字段如下：

```ts
interface ExternalRuleContext {
  apiVersion: 2;
  revision: number;
  project: ReadonlyMusicalProjectSnapshot;
  slices: AnalysisSlice[];
  harmonySpans: HarmonySpan[];
  melodyTransitions: MelodyTransition[];
  sliceTransitions: SliceTransition[];
  chordProgressions: ChordProgression[];
  auxiliarySummary: { trackCount: number; noteCount: number };
}
```

其中 `project` 只包含记谱所需的工程标识、PPQ、总时长、速度/拍号/调号、SATB 轨和和弦轨；作者备注、音频设置、规则配置及辅助轨明细不会进入沙箱。辅助轨只通过 `auxiliarySummary` 暴露轨道数和音符数。`slices` 带稳定索引、`spanId` 和连续性，`harmonySpans` 聚合连续同和弦转换。外置规则不能修改编辑器工程；对沙箱内副本的修改也不会返回宿主。

## 4. 无状态规则

无状态规则使用 `evaluate(context, config)`，必须同步返回诊断数组：

```ts
interface ExternalDiagnostic {
  ruleId?: string; // 若提供，必须等于当前规则 ID
  tick: number;
  endTick?: number;
  title: string;
  message: string;
  messageKey?: string;
  voiceIds?: Array<"soprano" | "alto" | "tenor" | "bass">;
  noteIds?: string[];
  chordIds?: string[];
  params?: Record<string, string | number | boolean>;
  evidence?: Array<{
    kind: "note" | "chord" | "interval" | "key" | "function";
    id?: string;
    label: string;
    value: string;
  }>;
  confidence?: number; // 0..1
}
```

限制：单条规则最多返回 512 项诊断，消息最长 600 字符，证据最多 16 项。所有音符、和弦、声部 ID 和 tick 范围必须存在于当前工程，否则整条规则的本次结果作废。

## 5. 有状态规则

需要横跨多个切片判断的规则使用 `process`，不能同时依赖其他规则的状态：

```js
{
  id: "example-stateful-rule",
  process(step, incoming, config) {
    const outgoing = [...incoming];
    // 规则自行决定创建、延续、消费状态，以及何时返回诊断。
    return { outgoing, diagnostics: [] };
  },
  finalize(_step, remaining, config) {
    return { diagnostics: [] };
  },
}
```

`step` 包含当前 `slice`、索引、前一切片、前一条 transition、当前 `HarmonySpan` 以及 `isSpanStart/isSpanEnd`。`incoming` 只包含当前规则上一步返回的状态。状态结构为：

```ts
interface RuleStateEnvelope<T extends JsonValue = JsonValue> {
  id: string;
  ownerRuleId: string; // 必须等于当前规则 ID
  createdAt: { tick: number; sliceIndex: number };
  subjectRefs?: {
    voiceIds?: string[];
    noteIds?: string[];
    chordIds?: string[];
    spanIds?: string[];
  };
  payload: T; // 仅由当前规则解释
}
```

规则不再返回某个信封即表示消费该状态。宿主不理解 `payload` 的音乐学意义，只校验所有权、创建位置、实体引用和 JSON 限制。每条规则最多保留 512 个信封，单个 payload 不超过 16 KiB。`process` 与 `finalize` 都必须同步执行。

## 6. 沙箱边界

每条规则在独立 QuickJS runtime 中运行：

- CPU 预算：`100 ms`；
- 堆上限：`32 MiB`；
- 栈上限：`512 KiB`；
- 无 Node.js、Electron、DOM、文件系统、网络、`fetch`、计时器和模块加载器；
- 新工程 revision 会终止旧 Worker，旧结果不能覆盖新诊断；
- 超时、内存超限、异常、manifest 漂移和非法返回只停用本次规则，内置规则继续工作。

## 7. 版本策略与示例

V3 工程格式和外置规则 API 均未正式发布，因此本阶段采用直接破坏性更新：只接受 `apiVersion: 2`，不会加载或适配 v1 包。后续正式发布后再建立稳定的兼容和弃用策略。

仓库提供可直接导入的无害示例：[phase-c-example.satb-rule.js](../Examples/phase-c-example.satb-rule.js)。它只检查女高音超长持续音，用于验证规则包导入、配置、沙箱执行和诊断显示链路。
