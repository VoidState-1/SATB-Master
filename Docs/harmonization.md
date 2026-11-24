# 自动配和声与半自动和声连接助手

本文档说明 SATB Master 中两套共享同一套声部进行内核的和声生成能力：**整段/选区自动配和声 v1** 与 **光标处半自动和声连接助手**。它们与只读的自动分析能力（见 [analysis-inference.md](./analysis-inference.md)）和规则诊断引擎（见 [harmony-engine.md](./harmony-engine.md)）保持清晰边界：生成模块在领域层构造候选并经规则引擎闭环验证，最终由用户确认后原子提交至工程历史（生命周期见 [analysis-lifecycle.md](./analysis-lifecycle.md)）。

## 1. 产品形态对比与源码地图

### 1.1 两种产品形态

| 维度 | 自动配和声 v1（Auto Harmonization） | 半自动和声连接助手（Progression Assistant） |
| --- | --- | --- |
| 适用场景 | 给定高音题（Soprano）或低音题（Bass），一次为全曲、选区或当前小节配出完整四声部 | 在创作或解题过程中，围绕光标右侧最近的全空/半空槽位交互式推进和声 |
| 输入约束 | 单一给定外声部 + 可选锁定和弦/锁定内声部音符 | 0–3 个任意固定声部 + 左右上下文锚点 + 锁定和弦 |
| 生成粒度 | 连续多小节整段方案（默认最多 3 套，接口上限 8 套），含音符、和弦轨、乐句与终止式 | 单和弦（含密集/开放等排列变体）或 2 / 3 / 4 拍 / 双向桥接短连接 |
| 搜索与执行 | 同步领域求解（`BEAM_WIDTH = 56`），弹窗中按需生成并试听 | 一次性 Web Worker 异步后台搜索（60ms 防抖，`BEAM_WIDTH = 48`） |
| 交互预览 | 弹窗卡片展示诊断计数、和弦进行、终止式摘要与试听 | 编辑器实时叠加槽位高亮与幽灵音符/和弦预览、带上下文试听、采纳自动推进光标 |
| 撤销/重做 | 单次原子历史提交 | 单次原子历史提交，并附带撤销/重做光标自动回跳 |

### 1.2 源码地图与上下游边界

- **领域核心（[`src/domain/harmony/harmonization/`](../src/domain/harmony/harmonization)）**：
  - [`types.ts`](../src/domain/harmony/harmonization/types.ts)：风格预设、放宽级别、方案与选项类型。
  - [`vocabulary.ts`](../src/domain/harmony/harmonization/vocabulary.ts)：和声词表构建、四声部排列枚举、位掩码预计算与外音延续。
  - [`transitionCost.ts`](../src/domain/harmony/harmonization/transitionCost.ts)：单切片打分、声部进行硬拒绝/软惩罚与跨步 `Obligations` 模型。
  - [`melodyGrid.ts`](../src/domain/harmony/harmonization/melodyGrid.ts)：高音/低音题切片、锁定提取、只读乐句/终止规划与弱拍经过/辅助音识别。
  - [`solver.ts`](../src/domain/harmony/harmonization/solver.ts)：整段 Beam Search 求解与多样性重排。
  - [`verifyAndApply.ts`](../src/domain/harmony/harmonization/verifyAndApply.ts)：路径落盘、`validateProject` + `checkHarmony` 闭环验证与 `applyAutoHarmonization` 原子写回。
  - [`index.ts`](../src/domain/harmony/harmonization/index.ts)：`autoHarmonize` 放宽升级编排与公共导出。
  - [`progressionSearch.ts`](../src/domain/harmony/harmonization/progressionSearch.ts)：`findNextOpenSlot`、`searchProgressionCandidates`、`applyProgressionCandidate`。
- **异步执行与控制器**：
  - [`src/workers/progressionSearch.worker.ts`](../src/workers/progressionSearch.worker.ts)：连接助手一次性模块 Worker 入口。
  - [`src/app/controllers/useProgressionAssistant.ts`](../src/app/controllers/useProgressionAssistant.ts)：防抖调度、Worker 生命周期、幽灵预览、试听与撤销光标回跳。
- **前端界面**：
  - [`src/features/autoHarmonization/AutoHarmonizationDialog.tsx`](../src/features/autoHarmonization/AutoHarmonizationDialog.tsx) 与 [`AutoHarmonizationPreview.tsx`](../src/features/autoHarmonization/AutoHarmonizationPreview.tsx)。
  - [`src/features/progressionAssistant/ProgressionAssistantPanel.tsx`](../src/features/progressionAssistant/ProgressionAssistantPanel.tsx)。

上下游协作边界：上游只读复用 `functionalHarmonyCatalog`、`chordModel`、`rhythm/metric`、`phrase`（`inferPhrases`）、`cadence`（`detectCadences`）以及 `inference`（连接助手在锚点缺和弦时局部调用 `inferChords`）；验证阶段闭环调用 `validateProject` 与 `checkHarmony`；领域层全部函数均基于克隆副本返回新 `ProjectDocument`，不突变原工程。

## 2. 共享和声词表与声部进行代价模型

### 2.1 三种风格预设与词表构成（`vocabulary.ts`）

`buildVocabulary(key, style, melody)` 基于功能目录按当前调式（大调/小调）构造 `HarmonizationChord[]`：

- **`classic-basic`（平稳保守）**：仅包含核心基础和弦——主（`T`/`t` 原位与六和弦）、下属（`S`/`s` 原位与六和弦）、属（`D` 原位与六和弦）、`SII6`、`TSVI` 原位、`K46` 与原位 `D7`。
- **`textbook-standard`（标准教材）**：补齐全部副三和弦（`SII`、`TSVI`、`DTIII`/`dtIII`、`DVII` 原位与六和弦）、经过/辅助四六（`passing64`/`pedal64`）、各转位七和弦（`D`、`SII`、`DVII`）及小调自然属/导（`d`、`dVII`）；仅当给定声部含对应调外变音（`matchesMelody`）时才按需加入副属/副导七（基础权重偏低，避免无故离调）。
- **`expressive-secondary`（丰富色彩）**：全量开放常用目标调（大调 `5/2/6/4` 级、小调 `5/4/3/6` 级）的副属三/七和弦与大调导/重属减七和弦，同时提高转位属七、副属推进与阻碍进行的权重。
- **特殊词表**：`lockedVocabulary` 将工程中已锁定的 `ChordRegion` 直接包装为强制和弦；`chromaticVocabulary` 在应急级别（`level = 2`）且无自然和弦覆盖某音时提供大三和弦兜底。

### 2.2 四声部排列枚举、位掩码加速与三级放宽

`enumerateVoicings` 按 `bass -> tenor -> alto -> soprano` 嵌套枚举所有合法四声部排列，并受 `HarmonizationRelaxedLevel`（`0 | 1 | 2`）控制：

| 放宽级别 | 上声部间距上限 | 给定外声部音域余量 | 排列与声部约束 |
| --- | --- | --- | --- |
| `0`（严格） | `12` 半音（八度） | `0` | 禁止交叉、缺必要音、错低音、导音/七音重复、不规范三和弦重复音 |
| `1`（适度放宽） | `16` 半音 | `±3` 半音 | 允许非关键重复音（转为软罚）并放宽部分声部超越/七音解决硬拒绝 |
| `2`（应急兜底） | 无硬截断（超限软罚） | 允许冲突保原音高 | 声部交叉、错低音、缺音、平行五八度转为高额惩罚（`-140`/`-180`）以保留最优可用解；启用 `chromaticVocabulary` |

每个 `Voicing` 预计算三组位掩码加速搜索：

- `present`：4 位和弦音出现掩码（位 0/1/2/3 对应根/三/五/七音），与 `chord.requiredMask` 和 `doublingMask` 在 `O(1)` 内检查缺音、重复音及允许的终止主和弦省略五音（`~4`）。
- `perfectMask`：基于 6 组声部对 `VOICE_PAIRS`（S-A、S-T、S-B、A-T、A-B、T-B），低 6 位标记纯一度/纯八度，高 6 位标记纯五度。
- `diminishedFifthMask`：低 6 位标记减五度。

`continueOrnament` 用于弱拍外音延续：保持其余三声部原音高不变，仅替换给定外声部为弱拍经过/辅助音，同时核对不与锁定音符冲突、不交错、满足间距与音域边界，且不对带 `role` 或副属导音/七音触发。

### 2.3 `Obligations` 与声部进行代价（`transitionCost.ts`）

跨切片状态由 `Obligations` 携带：

- 搜索期间跟踪：`heldMetricLevel`（同和弦延长达到的最高节拍强弱）、`bassDirection`（进入 `passing64` 时的低音步进方向）、`pedalOrigin`（进入 `pedal64` 前的来源和弦签名）、`sopranoHeldTicks`（低音题中女高同音保持累计时长）。
- 向连接助手槽位上下文额外暴露：`cadential64`、`seventhVoices`、`leadingToneVoices`。

`scoreTransition` 与 `scoreChoice` 结合硬拒绝（返回 `-Infinity`）与软奖惩评估相邻切片衔接：

- **硬拒绝项（按 `level` 分级）**：
  - 非连续切片（间隔休止）处的经过/辅助/终止四六或外音延续；
  - 副属和弦未按 `validAppliedContinuation` 延续或解决至目标调根音（含导音上行半音、七音下行级进）；
  - 经 `perfectMask` + `movingPairs` 位运算检出的平行/反向纯五八度（`level < 2`），以及外声部（`OUTER_PAIR`）同向减五到纯五（`level < 2`）；
  - 相邻切片声部超越（`level === 0` 且异和弦）；
  - 单声部超八度跳进，或增二度、减四度、增四/减五度等非规范旋律音程（`level < 2` 且非给定声部）；
  - `K46` 未强拍转弱拍同低音解决至原位属、`passing64` 低音未同向级进进出、`pedal64` 未同低音回原和弦（`level < 2`）；
  - 七和弦七音未下行级进解决（`level === 0` 且非固定声部）、外声部导音在 `D->T` / `D->VI` 未上行半音解决（`level < 2` 且非固定声部）；
  - 非原位属后无故使用省略五音的原位主和弦（`level < 2`）。
- **软惩罚与音乐奖励**：弱位起奏跨向强拍延音的切分和声惩罚；内声部导音在满足条件时下行至主五音仅轻微扣分（`-2`）；外声部隐伏五八度与四部同向惩罚；共同音保持、级进优先与大跳反向级进回收；低音题中鼓励女高旋律流动并抑制超过两拍的同音停滞；功能语法奖惩（`T->S->D->T` 与 `K46->D` 加分，非句首 `D->S` 重罚 `-13`）以及终止区各阶段（`approach`/`dominant`/`landing`/`hold`）加权。

## 3. 自动配和声 v1

```text
buildMelodyGrid（给定声部切片 + 锁定提取 + 乐句/终止规划 + 弱拍外音识别）
  │
  ▼ solveHarmonization（Beam Search: BEAM_WIDTH = 56, 放宽级 0 -> 1 -> 2, 多样性重排）
  │
  ▼ verifyPath（addPath 合并写回 + detectCadences + validateProject + checkHarmony 闭环评分）
  │
  ▼ autoHarmonize（0 错早停 / 逐级放宽重试 / 按错误->警告->建议->得分排序）
  │
  ▼ applyAutoHarmonization（按写回选项与锁定保护生成新工程 -> 上层 replaceProject 提交历史）
```

### 3.1 网格构建与规划（`melodyGrid.ts`）

- **切片与锁定提取**：`buildMelodyGrid` 默认优先选非空的高音轨，否则选低音轨；收集给定声部音符、调号、拍位、乐句边界以及开启 `respectLockedConstraints` 时的锁定和弦（`lockedChord`）与其余三声部锁定音符（`lockedPitches`），切分为半开时间切片 `MelodySlice[]`。
- **乐句与终止规划**：`planBoundaries` 优先沿用区间内的人工边界；无人工边界时以单声部只读调用 `inferPhrases`，再结合每 4 小节节拍网格吸附长音释放边界。`markCadences` 标记各乐句首切片 `phraseStart`，并为句末切片标注 `zone`（`final-authentic` / `medial-authentic` / `medial-cadence`）与 `stage`（`approach` / `dominant` / `landing` / `hold`）。
- **弱拍经过/辅助音识别**：开启 `allowPassingAndNeighborMelodies` 时，对弱位（`metricLevel < 2`）、完整单音符切片、同调、不跨句界且前后均级进的给定音符识别 `passing`（同向级进）或 `neighbor`（折回原音高）；低音题额外要求外音不长于邻近锚点且不跨小节。

### 3.2 Beam Search 与多样性重排（`solver.ts`）

- 逐切片缓存 `enumerateVoicings` 结果，每个和弦最多保留 `VOICINGS_PER_CHORD = 14` 个最低罚分排列；若切片标记了 `ornament`，则从当前束内状态通过 `continueOrnament` 衍生保持原和弦的外音延续候选。
- 每步转移按 `Obligations` 状态键（`heldMetricLevel`、`bassDirection`、`pedalOrigin`；末 3 切片附加 `harmonyHash` 以保留不同终止方案）合并剪枝，束宽 **`BEAM_WIDTH = 56`**。
- 求解完成后回溯最多 32 条和声签名互异的路径，利用贪心多样性重排（按与已选路径的最小逐切片签名汉明距离加权 `Math.min(distance, 5) * 1.6`）选出 `limit`（`min(8, maxSolutions + 2)`）条路径送入闭环验证。

### 3.3 闭环验证、放宽升级与原子写回（`verifyAndApply.ts` & `index.ts`）

- **落盘与终止生成（`addPath`）**：将非给定声部连续同音高且不跨 `phraseStart` 的音符合并，将同调同签名且不跨 `phraseStart` 的和弦合并；按 `replaceRange` 裁剪并保留锁定音符与锁定和弦；将弱拍外音角色写回给定声部未锁定音符；写入带 `phraseInferenceFingerprint` 的乐句边界，随后调用 `detectCadences(cadenceInputs(output))` 生成终止标注。
- **规则闭环与放宽升级**：`verifyPath` 必须先通过 `validateProject(project)`，再调用 `checkHarmony(project)` 统计 `errorCount`/`warningCount`/`suggestionCount` 并生成可读标签与描述（如 `重属推进`、`副属离调`、`阻碍进行`、`减七色彩`、`七和弦转位`、`弱拍装饰`、`四六延展`、`终止四六`、`正格收束`、`平稳连接`）。`autoHarmonize` 从 `level = 0` 开始，只要尚未出现 0 错误方案就自动升级至 `level = 1`、直至 `level = 2`，最终按错误数、警告数、建议数升序与搜索得分降序排序（`expressive-secondary` 下同错误/警告级别优先展现不同标签方案）。
- **原子写回与前端入口**：`applyAutoHarmonization` 依据 `writeChords`、`writePhrasesAndCadences`、`respectLockedConstraints` 合并音符、和弦、乐句与终止式（并经 `reconcileCadences` 核对原终止标注是否过期）。前端入口 [`AutoHarmonizationDialog`](../src/features/autoHarmonization/AutoHarmonizationDialog.tsx) 支持给定声部、作用范围（全曲/选中区域/当前小节）、风格预设、锁定与外音选项、写回开关以及在 [`AutoHarmonizationPreview`](../src/features/autoHarmonization/AutoHarmonizationPreview.tsx) 中对比诊断与试听；确认后由 `AppShell.tsx` 经 `replaceProject` 与 `history.commit` 一次性提交历史。

## 4. 半自动和声连接助手

核心实现位于 [`src/domain/harmony/harmonization/progressionSearch.ts`](../src/domain/harmony/harmonization/progressionSearch.ts)。

### 4.1 空位定位与左右锚点提取（`findNextOpenSlot`）

1. **槽位分类**：从光标 `fromTick` 起向后查找首个活跃音符少于 4 个声部的切片：
   - **`empty`（全空）**：0 个活跃声部，步长取 `stepTicks` 或 `beatAt(tick) * stepBeats`，并在遇到下一个音符起止事件、调号变更或锁定和弦边界时截断。
   - **`partial`（半空）**：1–3 个活跃声部，跨度延至下一个音符变化/调号/锁定边界，已有声部作为 `fixedVoices` 强制固定。
2. **左右锚点与缺失和弦恢复**：
   - `leftAnchorFor` / `rightAnchorFor` 提取紧邻槽位前后的声部状态。
   - 当锚点处具备完整四声部音符但工程未标注和弦时，`inferAnchorRegions` 对锚点前后各扩展一拍裁剪并局部调用 **`inferChords(project, { allowCadentialTonicOmission: true })`**，将推导出的和弦语义注入锚点，从而准确恢复左锚点的 `Obligations`（如延长最高强拍、经过/辅助四六来源、`cadential64`、七音与导音所在声部）；若仍无法归类，则以 `unclassifiedAnchor` 保留四声部实写音高参与衔接。

### 4.2 模式、步长与 Beam Search

- **模式与步长**：
  - `mode: "single"`（单和弦，默认最多返回 8 张卡片）或 `mode: "short"`（短连接，默认最多返回 6 张卡片）；
  - `shortLength: 2 | 3 | 4 | "bridge"`：`"bridge"` 模式下若当前为全空槽位且距右侧下一个发音点不超过 4 步，自动将区间规划为 2–4 步双向桥接（当间距 `<= 1` 步时拆分为 2 步）直连右侧锚点；
  - UI `stepPreset` 映射为 `"beat"`（1 拍）、`"half-bar"`（2 拍，`stepBeats = 2`）与 `"grid"`（跟随编辑网格 `stepTicks = gridTicks`）。
- **搜索与分组（`searchPaths`）**：
  - 束宽 **`BEAM_WIDTH = 48`**，多步搜索经 `bestVoicings` 每和弦保留最多 `VOICINGS_PER_CHORD = 16` 个外声部多样排列；`connectionScore` 额外强化 `K46` 与属七解决并对同和弦原地重复施加惩罚；若存在右锚点，末步必须通过到右锚点的衔接校验（不完整的部分右锚点则转为声部就近软奖惩）。
  - 路径按和声序列键 `pathKey` 分组：
    - 短连接模式先按 `pathTag` 音乐标签（`双向桥接`、`经过四六`、`辅助延长`、`副属推进`、`正格收束`、`阻碍进行`、`半终止`、`平稳连接`）执行一轮去重排座，优先呈现不同音乐走向；
    - 单和弦模式在同一和弦卡片下保留最多 3 个不同排列变体（按高音-次中音音程区分 `密集排列` / `开放排列`，同类重复时标记 `高音 <音高>`），并用 `alternateChecks = 3` 控制额外变体的规则检查预算。

### 4.3 按小节线裁剪验证与安全写回

- **小节线对齐裁剪（`cropProject`）**：为降低全曲规则重检开销并保持规则依赖的节拍强弱不失真，`cropProject` 取上下文窗口起点所在小节的**小节线**（`measureAtTick(...).startTick`）作为 `origin` 重置时间零点，复制窗口内音符、和弦、调号/拍号/速度与乐句边界，经 `addAnchorChord` 补齐左右锚点和弦，并对被裁剪跨越调号的和弦经 `chordWithOriginalKey` 保留局部调性语义。
- **闭环校验（`previewFor`）**：写入候选步骤后执行 `validateProject(preview)` 与 `checkHarmony(preview)`，仅统计与生成区间及衔接缝相交的诊断；若 `level = 0` 无 0 错误卡片则依次升级至 `level = 1` / `level = 2`，全部含错时返回错误数最少的兜底候选并附警告。
- **二次核验写回（`applyProgressionCandidate`）**：写回前再次逐拍验证：区间未越界、待填声部未锁定且不在不可编辑区间内、目标槽位未被并发写入新音符、固定声部未发生变化；随后经 `writeSteps` 写入音符与（可选）和弦（调用 `reconcileCadences` 刷新终止过期状态），最终通过 `validateProject(output)` 守门并返回 `{ project, nextCursorTick, addedNoteCount, addedChordCount }`。

## 5. Worker 通信与主线程控制器

### 5.1 Worker 契约与一次性生命周期

[`src/workers/progressionSearch.worker.ts`](../src/workers/progressionSearch.worker.ts) 定义极简通信契约：

```ts
export interface ProgressionSearchRequest {
  project: ProjectDocument;
  options: ProgressionSearchOptions;
}

export type ProgressionSearchResponse =
  | { result: ProgressionSearchResult }
  | { error: string };
```

[`src/app/controllers/useProgressionAssistant.ts`](../src/app/controllers/useProgressionAssistant.ts) 管理完整调度周期：

1. **触发与防抖**：仅当助手面板开启且当前未播放（`enabled && !isPlaying`）时构造 `query`；经过 **`SEARCH_DELAY_MS = 60` ms** 防抖后才启动后台线程。
2. **一次性模块 Worker**：`searchInWorker` 每次查询新建 `new Worker(..., { type: "module" })`；在收到 `onmessage`、`onerror`、`onmessageerror`，或新查询到来 / 组件卸载触发 effect 清理函数时，立即调用 `worker.terminate()` 释放线程，杜绝陈旧搜索结果覆盖最新光标。
3. **观测日志**：搜索失败或耗时 `>= 150ms`（`SLOW_SEARCH_MS = 150`）按 5 秒节流（`LOG_INTERVAL_MS = 5000`）写入日志，详见 [logging-and-observability.md](./logging-and-observability.md)。

### 5.2 幽灵预览、上下文试听与撤销光标回跳

- **幽灵预览（`ProgressionPreview`）**：面板（[`ProgressionAssistantPanel.tsx`](../src/features/progressionAssistant/ProgressionAssistantPanel.tsx)）悬停或聚焦卡片、切换排列变体时更新 `hovered`，控制器派生 `slotRange`、`ghostNotes`（仅包含待生成声部）与 `ghostChords`（开启同步写和弦轨时）供钢琴卷帘与和弦轨叠加显示。
- **上下文试听**：点击试听时先中止既有试听与主回放，新建 `AbortController` 并调用 `auditionProject(variant.previewProject, candidate.previewRange, request.signal, onEnded)` 播放带前后锚点上下文的预览片段；在查询变化、切换卡片、采纳或面板卸载时经 `stopAudition` 立即中止。
- **撤销/重做光标回跳**：控制器维护 `WeakMap<ProjectDocument, { before: WeakRef<ProjectDocument>; fromTick: number; toTick: number }>`（`cursorByCommit`）。每次采纳通过 `replaceProject` 构造新快照提交历史并把光标推进至 `applied.nextCursorTick` 时，记录新旧快照对与起止光标；此后在 `useLayoutEffect` 中监听工程快照切换：
  - 若从提交快照切回其 `before.deref()`（撤销），自动将播放头回跳至 `fromTick`；
  - 若从 `before` 切往提交快照（重做），自动将播放头前进至 `toTick`；
  - 使用 `WeakMap` + `WeakRef` 避免阻止历史栈旧快照被垃圾回收，且不影响普通编辑与手动移动播放头。

## 6. 核心不变量与扩展检查表

扩展新风格、词表和弦、外音类型或搜索策略时，须守住以下不变量：

1. **锁定与题面原音高保护**：给定声部音高、锁定音符、锁定和弦、锁定轨道及 `exercise.editableRanges` 中的不可编辑区间不得被越权改写或覆盖；`applyProgressionCandidate` 写回前必须复核槽位未被并发改动。
2. **`validateProject` 与规则引擎闭环**：任何候选在返回前与写回后都必须通过 `validateProject`；排序必须以真实 `checkHarmony` 诊断错误数优先于启发式搜索分。
3. **只读边界与原子历史**：`autoHarmonize` 与 `searchProgressionCandidates` 不得修改输入 `project`；所有前端采纳入口须通过 `replaceProject` + `history.commit` 一次性提交，确保单步撤销完整还原音符、和弦与结构。
4. **节拍强弱保真**：局部裁剪验证（如 `cropProject`）必须对齐至小节线重设起点，防止强弱拍偏移导致规则误报或漏报。
5. **回归测试入口**：
   - [`src/domain/harmony/harmonization/__tests__/harmonization.test.ts`](../src/domain/harmony/harmonization/__tests__/harmonization.test.ts)（自动配和声求解、锁定、外音、放宽与写回）
   - [`src/domain/harmony/harmonization/__tests__/progressionSearch.test.ts`](../src/domain/harmony/harmonization/__tests__/progressionSearch.test.ts)（槽位定位、锚点推导、单步/短连接/桥接、排列变体与安全写回）
   - [`src/features/autoHarmonization/AutoHarmonizationDialog.test.tsx`](../src/features/autoHarmonization/AutoHarmonizationDialog.test.tsx)
   - [`src/features/progressionAssistant/ProgressionAssistantPanel.test.tsx`](../src/features/progressionAssistant/ProgressionAssistantPanel.test.tsx)
