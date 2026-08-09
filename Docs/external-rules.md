# 外置规则开发与沙箱

本文是 `.satb-rule.js` 规则包的开发者契约，说明 API v3 的 manifest、配置、特例、运行上下文、诊断输出和安全边界。内置分析结构见 [harmony-engine.md](./harmony-engine.md)，本机规则库存储见 [desktop-and-persistence.md](./desktop-and-persistence.md)。实现以 [`harmony/external/api.ts`](../src/domain/harmony/external/api.ts)、[`harmony/external/sandbox.ts`](../src/domain/harmony/external/sandbox.ts) 和 [`externalRuleRuntime.ts`](../src/services/externalRuleRuntime.ts) 为准。

## 1. 能力边界

外置规则用于在不重建主程序的情况下增加检查逻辑。它只能读取宿主生成的不可变音乐快照并返回诊断，不能添加 React 界面、读取任意文件、联网、控制播放、修改工程或调用 Electron。

当前契约版本：

```ts
EXTERNAL_RULE_API_VERSION = 3;
```

API v2 文件会被明确拒绝。产品版本、工程 schema 和外置规则 API 是三个独立契约，不能相互替代。

## 2. 文件与注册

规则包扩展名为 `.satb-rule.js`，单文件最大 512 KiB。脚本必须且只能调用一次 `SATB_RULE.register`：

```js
SATB_RULE.register({
  manifest: {
    apiVersion: 3,
    packageId: "org.example.rules",
    version: "1.0.0",
    rules: [
      {
        id: "long-soprano-note",
        label: "女高音持续过长",
        description: "检查超过指定拍数的女高音音符。",
        group: "melody",
        defaultSeverity: "suggestion",
        dependencyScope: "note",
        configVersion: 1,
        options: [
          {
            key: "threshold",
            label: "最长持续时间",
            description: "超过该时值时报告。",
            type: "duration",
            section: "threshold",
            required: true,
            defaultValue: { value: 4, unit: "beats" },
            min: 1,
            max: 32,
            step: 1,
          },
        ],
        supportedExceptionContexts: ["insufficient-context"],
        defaultExceptionPolicies: {
          "insufficient-context": "exempt",
        },
      },
    ],
  },
  rules: [
    {
      id: "long-soprano-note",
      evaluate(context, config) {
        const beats = config.threshold.value;
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
            evidence: [
              {
                kind: "note",
                id: note.id,
                label: "持续 tick",
                value: String(note.durationTicks),
              },
            ],
            confidence: 1,
          }));
      },
    },
  ],
});
```

`manifest.rules` 是安装、设置页和工程配置使用的静态目录，`rules` 是可执行实现；两侧 ID 必须一一对应。

### 2.1 manifest 字段

| 字段 | 约束 | 说明 |
| --- | --- | --- |
| `apiVersion` | 必须为 `3` | 外置规则契约版本 |
| `packageId` | 小写字母、数字及 `._-`，最长 128 | 全局稳定包 ID |
| `version` | 受限版本字符串，最长 64 | 包作者声明的版本 |
| `rules[].id` | 包内唯一稳定 ID | 与实现匹配 |
| `label` / `description` | 最长 120 / 400 | 设置页名称与说明 |
| `group` | 内置 11 个分组或 `custom` | 设置页分类 |
| `defaultSeverity` | `error` / `warning` / `suggestion` | 首次挂载默认值 |
| `dependencyScope` | `note` / `slice` / `chord` / `phrase` / `project` | 依赖范围 |
| `configVersion` | 1 到 1,000,000 的整数 | 配置结构版本，不是包版本 |
| `options` | 最多 32 项封闭 schema | 自动生成设置控件 |
| `supportedExceptionContexts` | 已知 context 列表 | 规则承认的特例证据 |
| `defaultExceptionPolicies` | context 到策略的映射 | 默认豁免、降级或严格处理 |

`packageId + version` 不足以证明源码相同；安装记录与工程引用还包含 SHA-256 `contentHash`。

## 3. 声明式配置

外置规则不能注入组件或 HTML。设置页只根据 `options` 生成受控输入，允许类型为：

- `boolean`
- `integer`
- `number`
- `pitch`
- `enum`
- `pitch-range`
- `duration`

数值项可声明 `min`、`max`、`step`；枚举必须声明 `values`；`duration` 的单位只能是 `ticks`、`beats` 或 `measures`。默认值必须满足自身 schema。

宿主在安装、工程读取、配置档案导入和运行前都会规范化配置。缺失键恢复默认，未知键移除，越界或类型错误值被修复。提升 `configVersion` 表示旧配置结构需要重新规范化；当前不提供脚本自定义迁移回调。

## 4. 特例策略

可声明的 context 由 [`harmony/rules/types.ts`](../src/domain/harmony/rules/types.ts) 的 `RULE_EXCEPTION_CONTEXTS` 定义，例如：

```text
same-harmony / arpeggiation / voice-exchange / inner-voices
bass-step-up / sequence / pedal-point / nonchord-tone
cadence / modulation / ambiguous-semantics / insufficient-context
```

每个 context 的策略为：

| 策略 | 结果 |
| --- | --- |
| `strict` | 保持工程严重程度 |
| `downgrade` | 由宿主把诊断降低一级 |
| `exempt` | 由宿主丢弃该诊断 |

脚本不能在诊断中返回 `exceptionContexts`。宿主根据诊断的时间范围、音符、和弦、声部及结构化根因引用，从 `HarmonyContextFacts` 计算实际 context，再合并 manifest 默认策略与工程覆盖，最后执行豁免或降级。因此脚本不能伪造特例来隐藏结果，也不能提升自身严重程度。

## 5. 无状态与有状态规则

无状态规则实现同步 `evaluate(context, config)` 并返回诊断数组。需要沿时间链等待后续事件时，实现同步 `process`，可选 `finalize`：

```js
{
  id: "stateful-example",
  process(step, incoming, config) {
    const outgoing = [...incoming];
    return { diagnostics: [], outgoing };
  },
  finalize(lastStep, remaining, config) {
    return { diagnostics: [] };
  },
}
```

每个 step 包含完整 `analysis`、当前 `slice`、前一切片、相邻转换、当前 `span` 及 span 起止标记。规则私有状态使用通用信封：

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

宿主不解释 `payload`，也不提供中央“解决义务”枚举。创建、保留、满足和删除状态均由所属规则决定。单规则最多 512 个状态；单个 payload 序列化后最大 16 KiB；`ownerRuleId`、时间和对象引用会由宿主校验。

## 6. 可见上下文

API v3 直接公开裁剪后的完整 V3 和声语义，不再生成旧 `FunctionalClass`、单解释 projection 或 `chordProgressions`：

```text
apiVersion / revision
project
  schemaVersion / id / title / ppq / lengthTicks
  tempoEvents / meterEvents / keyEvents
  satbTracks
  chordTrack { visible, locked, displayMode, regions }
sharedSettings
slices
harmonySpans
chordSpanIds
contextFacts
melodyTransitions
sliceTransitions
connections
targetChains
auxiliarySummary { trackCount, noteCount }
```

`ChordRegion` 保留完整 `ChordIdentity`、一个或两个 `HarmonyInterpretation`、`FunctionalDesignation`、离调目标、混合、终止角色和持续低音上下文。`HarmonySpan` 聚合同一调性、相同实体和相同语义的连续和弦区域；`connections` 提供稳定 `connectionKey`、精确 span 间关系、目标是否匹配、证据与置信度；`targetChains` 展开允许经过 `K46` 的副属/重属目标路径。

边界约束：

- SATB 音符和和弦完整可见，用于精确判断与对象引用。
- 辅助轨只公开数量摘要，不参与规则分析。
- 作者说明、SoundFont 路径、恢复文件路径和窗口状态不公开。
- 上下文是当前 revision 的深冻结 plain data；不可借对象修改跨规则传递信息。
- 规则应复用 slices、transitions、spans 和 connections，避免重新扫描原始事件建立另一套时间模型。

## 7. 诊断输出

原始诊断必须提供有效的 `tick` / `endTick`、对象引用、`title`、`message`、稳定 `messageKey`、原始参数、证据和 0 到 1 的 `confidence`。可选 `causeRefs` 使用结构化对象：

```js
causeRefs: [
  { kind: "connection", id: connection.connectionKey },
  { kind: "voice", id: "alto" },
  { kind: "local", id: "my-stable-cause" },
]
```

`kind` 仅允许 `note`、`chord`、`voice`、`span`、`connection`、`melody-transition`、`slice-transition` 和 `local`。除 `local` 外，ID 必须存在于当前分析快照；宿主会为所有引用添加包 hash 与规则 ID 命名空间。

规则不返回 `severity`、稳定诊断 ID、`exceptionContexts` 或 `coverageRefs`。宿主从工程 `RuleProfile` 注入严重程度、计算适用性并生成根因键。单规则最多返回 512 项，message 最长 600 字，evidence 最多 16 项；未知引用、越界范围、非法字段或 Promise 返回值会使该规则本次结果成为 `invalid-result`。

对象归属遵循：和弦整体问题只填 `chordIds`，单声部旋律问题填对应 `voiceIds/noteIds`，两声部进行同时引用两组声部和音符。外置诊断会与内置诊断一起进入最终排序，但不能参与或改变内置父子覆盖声明。

## 8. 沙箱与同步限制

`evaluate`、`process` 和 `finalize` 必须同步返回。每条规则在独立 QuickJS runtime 中执行，外层还有 Web Worker 隔离：

| 资源 | 限制 |
| --- | --- |
| CPU 时间 | 100 ms |
| QuickJS 堆 | 32 MiB |
| QuickJS 栈 | 512 KiB |
| 源文件 | 512 KiB |

Node.js、Electron、DOM、网络、文件、进程、计时器、Web Audio 和异步 I/O 均不可用。Web Worker 防止阻塞 renderer，QuickJS 限制脚本能力和资源消耗，两层不能互相替代。

## 9. 安装与工程引用

桌面端规则库按内容寻址：

```text
userData/rule-library/
  <sha256>.satb-rule.js
  <sha256>.json
```

导入时依次检查扩展名和大小、在 QuickJS 中读取注册信息、校验 manifest 与实现 ID、计算 SHA-256，再写入规则库。renderer 的 API parser 与 Electron 主进程的 `rule-library-policy` 都只接受 API v3；主进程存储元数据时保留 `configVersion`、配置 schema、特例上下文和默认策略。工程保存每条规则的包标识、版本、hash、规则 ID、严重程度、`configVersion`、配置和特例覆盖；脚本正文不进入 `.satb` 文件。

本机缺少匹配 hash 时，引用保留并显示“未挂载”，内置规则继续运行。重新安装相同内容后可恢复匹配。浏览器预览使用 localStorage 降级存储，不能代替桌面内容寻址行为验证。

规则配置还可通过 `.satb-rule-profile.json` 导入导出。配置档案保留缺失外置包引用，安装状态不参与便携格式；禁用的外置规则以 `severity: "off"` 表示。

## 10. 失败模型

失败代码包括 `missing-package`、`source-error`、`manifest-mismatch`、`timeout`、`memory-limit`、`exception` 和 `invalid-result`。失败按 package/rule 记录；单规则失败不能丢弃其他外置结果或清空内置诊断。较旧 revision 的整批结果标记 `superseded`，不会覆盖当前界面。

## 11. 维护检查表

- 新字段是否确实是音乐规则所需，且不泄露本地路径或辅助素材？
- 数据是否可 JSON 序列化、深冻结并受大小限制？
- manifest parser、inspect、worker protocol、runner、工程引用和设置页是否同步？
- schema、默认值、损坏配置修复和 `configVersion` 是否有测试？
- 无状态、有状态、特例降级/豁免和非法 context 是否有测试？
- 超时、内存、非法引用、Promise、旧 revision 和缺包是否仍然隔离？
- 若契约不兼容，是否提升 `EXTERNAL_RULE_API_VERSION` 并同步本文？
