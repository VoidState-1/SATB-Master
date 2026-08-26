# 斯波索宾功能和弦体系

本文说明 SATB Master 当前已经实现的功能和弦数据、注册表、编辑和显示流程。理论范围仅采用斯波索宾体系；多教材 profile、自由名称和 D11/D13 等扩展不属于当前实现。

## 1. 核心原则

和弦实体与和声解释必须分离：

```text
ChordRegion
  identity    实际根音、结构、构成音和低音
  semantics   一个或两个调性解释、功能标记和上下文
```

同一个 C 大三和弦第二转位可以解释为 `T46` 或 `K46`。两者的 `ChordIdentity` 相同，但 `FunctionalDesignation` 和 `cadenceRole` 不同。代码不得通过显示名称反推实体，也不得因为实体相同而覆盖人工确认的语义。

主要文件：

- [`chordModel.ts`](../src/domain/chordModel.ts)：实体、解释、草稿、拼写和配器策略。
- [`functionalHarmonyCatalog.ts`](../src/domain/functionalHarmonyCatalog.ts)：A/B/C 范围唯一词汇注册表与组合操作。
- [`chords.ts`](../src/domain/chords.ts)：功能、罗马和绝对名称 formatter。
- [`ChordPalette.tsx`](../src/features/editor/layers/ChordPalette.tsx)：组合式浮动调色盘。

## 2. 实体结构

`ChordIdentity.structure` 是判别联合：

```ts
type ChordStructure =
  | {
      kind: "tertian";
      quality: ChordQuality;
      extensions: readonly ChordExtension[];
      alterations: readonly ChordToneAlteration[];
    }
  | {
      kind: "augmented-sixth";
      variant: "italian" | "french" | "german";
    };
```

增六和弦不能伪装为普通七和弦。其实际书写由变体直接生成，例如 C 大调中的德国增六保存为 A♭、C、E♭、F♯。

`D9` 的理论构成仍包含根、三、五、七、九音；四声部“省略五音”保存在 `ChordVoicingPolicy`：

```text
required    1, 3, 7, 9
permitted   1, 3, 7, 9
forbidden   5
```

不要为了四声部配置删除理论构成音，否则绝对名称、MIDI/谱面投影和未来规则会失去事实。

## 3. 和声解释

`HarmonySemantics` 保存：

- `interpretations`：一个或两个确认解释。
- `primaryInterpretationId`：当前主要解释。
- `alternatives`：未确认候选，不参与主要显示。
- `mixture`：同主大小调或调式借用。
- `cadenceRole`：终止四六、经过四六、辅助四六或人工确认的阻碍进行起点。
- `pedalContext`：持续低音音高及 start/continue/end 位置。

每个 `HarmonyInterpretation` 保存局部调性、级数、变化、结构化离调目标、`FunctionalDesignation`、来源和置信度。`FunctionalDesignation` 采用 `notationSystem: "spasobin"`，主要/次要功能顺序不能交换，例如：

```text
DTIII  primary=dominant, secondary=tonic
TSVI   primary=tonic, secondary=subdominant
```

工程 validator 和编辑命令会验证每个确认解释都能重新解析为同一 `ChordIdentity`。仅 ID 不同、其余事实完全相同的重复解释也会被拒绝。

## 4. 注册表范围

当前注册表支持：

- A：`T/t/S/s/D`、`SII`、`DTIII`、`TSVI`、`DVII`、`K46`、`DD`、`DDVII` 及已审定七和弦/转位。
- B：`D` 或 `DVII` 指向 `SII/DTIII/S/TSVI`，formatter 输出 `D7->SII` 等名称。
- C：`S7` 系列、大小调借用、`N6`、原位 `D9`、变化 D/DD、`It+6/Fr+6/Ger+6`、持续低音和共同和弦。

原位三和弦省略数字；转位采用 `K46`、`D56`、`D34`、`D2`。裸 `DD` 仅表示重属三和弦原位。未注册 `D11`、`D13` 或任意自由功能名称。

同一基础定义的不同形态可以属于不同范围，例如 `S` 三和弦属于 A，而 `S7` 属于 C。读取范围时使用 `functionalScopeForForm`，不要只读基础项的 `scope`。

## 5. 草稿与提交

`ChordDraft` 是组合编辑配方，不是持久化名称。典型流程：

```text
选择注册表基础项
-> 选择 triad/seventh/ninth
-> 选择合法转位
-> 可选离调目标、构成音变化和上下文
-> resolveChordIdentity
-> semanticsFromChordDraft
-> editing 命令校验并提交
```

固定组合由 UI 和命令层同时执行：

- `K46` 固定第二转位。
- `N6` 固定第一转位。
- `D9` 和三种增六和弦固定原位。

修改主要功能、形态、转位、目标或构成音时会清除已有第二解释，因为实体或主要解释可能已经变化。借用和持续低音不改变实体，可以保留第二解释。

## 6. 共同和弦

共同和弦不能通过复制主解释生成。`compatibleFunctionalInterpretations(identity)` 会枚举当前支持调性和注册表定义，只返回能够解析为同一实体、同一低音/转位的组合。

调色盘和 Inspector 的“第二调性/第二功能”选项来自该候选集。没有其他合法解释时，共同和弦开关禁用。该约束同时在 validator 和编辑命令层执行，防止通过旧工程、快捷键或未来 API 写入互相矛盾的解释。

formatter 使用等号显示两个确认解释，例如：

```text
functional: T = S
roman:      I = IV
absolute:   C
```

绝对实体只显示一次。

## 7. 显示模式

和弦轨支持五种显示模式：

```text
functional
roman
absolute
functional-absolute
roman-absolute
```

三种名称始终由 `formatChordIdentity` 计算。tooltip 同时显示功能、罗马和绝对名称。旧 v2 工程的 `displayMode: "both"` 在 v2 -> v3 迁移时转换为 `roman-absolute`。

## 8. 与规则引擎和外置 API 的边界

当前规则引擎和外置 API v3 都原生读取完整实体与语义，不再经过 `FunctionalClass`、旧结构 projection 或 `chordProgressions`。连续同和弦区域先聚合为 `HarmonySpan`，相邻跨度再由精确连接器读取主要解释、功能标记、离调目标、终止角色和持续低音上下文。

规则必须按自身所需处理 `D9`、方向性变音、增六和弦、阻碍进行、双解释与持续低音：能够可靠判断时读取结构化字段；语义歧义或上下文不足时返回保守结果、特例 context 或 skip，不能把新结构伪装成普通三和弦。变化音的 `tendency` 和阻碍进行的 `cadenceRole` 都是人工可编辑证据，规则不能从 accidental 或普通 `D -> VI` 连接反向猜写这些字段。

外置 API v3 暴露裁剪后的完整 `ChordRegion`、`HarmonySpan` 和 `connections`，并保留一个或两个 `HarmonyInterpretation`。脚本不能读取辅助轨明细，也不能修改宿主语义。完整契约见 [external-rules.md](./external-rules.md)。

终止式不再由单个和弦的 `cadenceRole` 承担“乐句末端整体类型”语义：完全/半/补充/阻碍终止属于工程级 `chordTrack.cadenceAnnotations`，由终止式检测产生候选、用户确认后写回（见 [analysis-inference.md](./analysis-inference.md)）。`cadenceRole` 仅保留终止四六、经过四六、辅助四六与阻碍进行起点等局部角色。

## 9. 扩展步骤

增加一个功能标记时至少需要：

1. 在注册表加入定义、合法形态、范围、固定转位和 designation。
2. 确认 `resolveChordIdentity` 生成真实书写拼写。
3. 确认功能、罗马和绝对 formatter 输出。
4. 决定是否有专用 `ChordVoicingPolicy`。
5. 更新调色盘可选项和开发者检查字段。
6. 添加正例、冲突反例、保存重开和固定转位测试。
7. 为内置连接器、规则适用性与外置 API v3 添加相应上下文测试。

领域金样本位于 [`functionalHarmonyCatalog.test.ts`](../src/domain/functionalHarmonyCatalog.test.ts)。
