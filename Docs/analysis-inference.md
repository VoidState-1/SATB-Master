# 自动分析：节拍、乐句、终止式与和弦推导

快照、候选、写回和缓存边界见 [analysis-lifecycle.md](./analysis-lifecycle.md)。普通实时分析默认关闭乐句候选扫描，因此 `phraseBoundaryCandidates` 可能为空；需要候选时进入专用推导流程。

本文说明和声分析之上的自动分析能力——节拍层级、乐句结构、终止式检测，以及面向未标注工程的自动和弦推导。它们都属于“从工程快照推导出的结构化事实”，与 [harmony-engine.md](./harmony-engine.md) 描述的规则诊断流程分属不同职责：这些模块产出候选与结构，规则引擎消费其结论进行诊断。

## 1. 定位与边界

各组能力的共同原则：

- 输入是同一份 `HarmonyAnalysis` 快照（或只读工程投影），不修改源工程。
- 输出是带置信度和证据的候选结构，而不是最终“正确”标签。
- 只有用户确认或调用应用命令后，候选才写入工程（`structure.phraseBoundaries`、`chordTrack.regions`、`chordTrack.cadenceAnnotations`）。
- 置信度不足时保守返回 `ambiguous` / `unclassified` 或跳过，不用启发式猜测强行补齐。

主要源码入口：

- [`src/domain/rhythm/metric.ts`](../src/domain/rhythm/metric.ts)：节拍层级与强弱位置。
- [`src/domain/harmony/phrase/`](../src/domain/harmony/phrase)：乐句边界候选、结构模板与多乐句切分。
- [`src/domain/harmony/cadence/`](../src/domain/harmony/cadence)：终止式候选、过渡证据与冲突仲裁。
- [`src/domain/harmony/inference/`](../src/domain/harmony/inference)：自动和弦推导、外音恢复、区段合并与写回。

## 2. 节拍层级

[`buildMetricTimeline`](../src/domain/rhythm/metric.ts) 在 [`time.ts`](../src/domain/time.ts) 的小节结构之上建立拍级强弱层级：

- `MetricMeasure`：小节号、起止 tick、分子/分母、拍长 `beatLength`、拍 tick 列表 `beatTicks`、可选拍组 `beatGrouping` 与 `groupingConfidence`。
- `MetricPosition`：某一 tick 的 `role`（`downbeat` / `secondary-accent` / `weak-beat` / `subdivision`）、层级 `level`（`3` / `2` / `1` / `0`）与 `confidence`（`certain` / `ambiguous`）。细分拍（`subdivision`）与小节首拍（`downbeat`）始终为 `certain`，其余拍位继承所在小节的 `groupingConfidence`。
- **拍组与歧义规则**：
  1. 优先采用 `MeterEvent.beatGrouping` 的显式声明（需为正整数数组且总和等于 `numerator`）。
  2. 缺失显式声明时：当 `(denominator === 8 || denominator === 16) && numerator >= 6 && numerator % 3 === 0`（如 6/8、9/8、12/8）时推断三拍一组（`[3, 3, ...]`）；当 `numerator === 4` 时推断 `[2, 2]`。
  3. 仅当无可用分组且 `numerator >= 5`（如未声明分组的 5/4、7/8）时，才将 `groupingConfidence` 标为 `ambiguous`；2/4、3/4、3/8 等单拍子仍为 `certain`。

辅助查询函数包括 `metricPositionAt`、`metricPositionsBetween`（支持 `open` / `closed` / `left-closed` / `right-closed` 四种区间端点策略）、`compareMetricStrength` 与 `strongestMetricPositionBetween`。节拍强弱仅作为结构证据，不单独决定任何规则结论。

## 3. 乐句结构分析

乐句边界是工程级数据，保存于 `project.structure.phraseBoundaries`（见 [data-model.md](./data-model.md)）。核心入口位于 [`src/domain/harmony/phrase/analyze.ts`](../src/domain/harmony/phrase/analyze.ts)：

- `analyzePhrases(project, options)`：结合已保存的当前有效边界与可选候选扫描，返回 `PhraseAnalysis`（`boundaries`、`candidates`、`segments`、`template`）。
- `inferPhrases(project)`：以 `{ generateCandidates: true, includeInferredBoundaries: true, replaceInferredBoundaries: true }` 重建自动边界，保留人工和锁定边界，替换未锁定的旧自动边界。
- `phraseAtTick(segments, tick)`：定位 tick 所在的 `PhraseSegment`。

`PhraseAnalysis` 根据工程是否存在和弦区域，采用两套衔接策略：

### 3.1 无和弦时的规则比例模板

当输入工程没有和弦区域（例如空和弦轨或和弦推导前的预分析）时，分析器沿有效起止区间搜索 `PhraseTargetRatio` 中的三个比例目标：`half`（1/2）、`third`（1/3）与 `two-thirds`（2/3），产出 `single`、`duple` 或 `triple` 模板（受 `REGULAR_PHRASE_POLICY` 窗口比例 `0.08`、最短小节数与短乐句强休止约束控制）：

- **节奏与和声事实（`boundaryFacts`）**：汇集全部声部释放（`all-voices-end`）、至少一拍实际静音（`silence-after-target`）、长音释放（`long-note-release`）、强/次强拍支持（`metric-support`）、末端稳定功能和声/和声收束及边界后新材料对比，划分为 `strong` / `moderate` / `weak` 三级支持。
- **延长性四六保护（`isProlongingSixFour`）**：对标注为 `passing64` / `pedal64` 的第二转位和弦，核对同功能两端、同局部调性以及 `writtenBassPath` 实际书写低音（持续同音或同向级进），避免把经过/辅助四六的进出误当作边界后的“新材料”。
- **中点属功能保持（`hasMidpointDominantHold`）**：在对称中点处检查原位属持续两拍以上，或经下行级进低音连接至主和弦的 `V2` 属延续，为无休止的半终止呼吸提供 `moderate` 支持。
- **属后开头动机复现（`reprisedOpeningAfterDominant`）**：位于 [`phrase/reprisedOpening.ts`](../src/domain/harmony/phrase/reprisedOpening.ts)。当无人工/锁定边界且中点常规搜索未找到候选时，检测短时值属七弱部装饰后的四声部齐奏重起，若女高声部精确复现乐曲开头的旋律与节奏且两端均落实主和弦，则生成 `soprano-opening-reprise` 证据；其持久化指纹（[`phrase/fingerprint.ts`](../src/domain/harmony/phrase/fingerprint.ts)）带有 `"opening-reprise:"` 前缀，并额外纳入调号变化与已确认全终止，供 `isCurrentPhraseBoundary` 精确判定边界是否过期（`stale`）。

### 3.2 有和弦时的事件打分与全局 DP 多乐句切分

当输入工程已包含和弦区域时，分析器在规则模板候选之上运行事件打分与全局动态规划切分：

1. **事件候选生成（`eventCandidates`）**：收集小节起点、弱起对齐拍位（兼容不完整弱起小节）、规则模板边界，以及实际的多声部释放与休止后重起。休止中的小节线可以是下一句的起点，前句的收束证据仍取自早先的实际释放。
2. **多维事件打分**：收束后的齐休、协调的释放与重起（`coordinated-breath`）、开头动机复现及节拍位置都能支持候选。小节内不凭普通换和弦切分。同一属功能和延长性四六默认视作连续，除非存在独立的收束与重起证据。已确立的比例候选保留原证据和最低权重，与事件候选共同选优。
3. **全局 DP 多乐句切分（[`selectEventDivisions`](../src/domain/harmony/phrase/segmentation.ts)）**：
   - 将工程起止点与所有人工/锁定边界视为**固定锚点**（`anchors`），把目标函数分解为相互独立的锚点区间分别求解 `bestDivisions`。
   - DP 结合乐句小节数偏好（`lengthScore`：4 小节加分，`< 3` 或 `> 6` 小节减分）与边界事件得分，且总分须超过不分割基线至少 `minimumGain = 1`。
   - 常规最短自动乐句长度为 **2 小节**（`minimumMeasures = 2`）；若相邻边界属于非 `"event"` 的规则候选且具备 `silence-after-target`（整拍以上实际静音），放宽至 **1 小节**。
   - 最终由 `phraseTemplate` 映射为 `single`、`duple`、`triple` 或 **`multi`**（超过 2 个内部边界，支持 4 句及以上长练习）。

和声持续时长与女高、低音的节奏分别取证。`cadential-restart` 记录属和声释放后重起，或属至 I、I6、VI 后和声节奏放慢并重新起奏。内声可以跨线延续。根位 VI 经第一转位延长时，实写低音五升六和至少两个保持至释放点的上声部支持将切点放在换位之后。

周期从首个实音按小节位置计量，独立弱起小节折算成完整小节的分数。在属收束后的对应拍位，`periodic-opening-return` 比较女高开头三个音的前两个时值与两个有向音程，允许移调再现。候选取弱起进点。相邻小节的高、低音同时重复节奏与音程型时，连续的模进也可以解释规则周期，因而需要额外的呼吸或复现证据。

在有和弦的工程中，`analyzePhrases(project, { includeEventRejections: true })` 可追踪每个事件最先触发的拒绝条件。前置休止后的第一响记录为 `effective-opening`，表示有效音乐范围的起点。Written100 评分仍按工程首尾之间的参考边界计数，因此这类首响在诊断中单列，在评分分母中保留。

事件入口另行检查两种实写重起，并保留 `articulated-release` 证据。

- 长属三和弦释放时，四声齐奏带七音的属六五，随后落原位主。至少两个上声部释放两拍以上的音。重起须位于四小节强位，或位于下一强拍前且新旋律音持续过该强拍。
- K46 经属落原位六级时，低音五级上行至六级并保持。女高与内声部同时结束落点音，女高以短音启动后续旋律，切点取实际重起处。六级经换位延长时，协调释放也可落在从开头小节计量的四小节线上。

上述候选与原有候选共同进入全局切分。双外声模进仍受连续性检查，取证窗口须尊重调性变化及人工或锁定锚点。实现见 [articulatedRelease.ts](../src/domain/harmony/phrase/articulatedRelease.ts)。

### 3.3 自动边界写回与 `pedalContinuationMidpoint` 保护

完整和声推导在写回和弦后调用 [`applyInferredPhraseBoundaries`](../src/domain/harmony/inference/pipeline.ts) 落盘乐句边界：

- **`pedalContinuationMidpoint` 保护**：若 `inferPhrases` 产出无人工/锁定边界的 `duple` 中点（`targetRatio === "half"`、`distanceToTarget === 0`、`support === "moderate"` 且全声部释放），但该中点前存在跨小节低音持续音（且上方出现过对比和声）、女高下行级进，且在临时移除内部边界后 `detectCadences` 能独立证实 `closing-tonic-revoicing`（属七落主后外声持续、内声短下属重配至共同释放）且不与既有终止标注冲突，则撤销该中点分割并按 `single` 模板写回。
- **终止标注 `phraseId` 迁移**：当上述保护撤销了旧工程中原先保存的中点边界时，系统会把原归属旧分段的未过期 `CadenceAnnotation` 的 `phraseId` 迁移到合并后的新连续乐句 ID，再调用 `reconcileCadenceAnnotationStaleness` 同步过期状态。

## 4. 终止式检测

终止式以工程级范围标注形式存于 `chordTrack.cadenceAnnotations`（见 [data-model.md](./data-model.md) 与 [functional-harmony.md](./functional-harmony.md)）。

### 4.1 检测入口与只读上下文

- [`detectCadences(analysis: CadenceAnalysis)`](../src/domain/harmony/cadence/detect.ts)：只消费 `project`、`harmonySpans`、`chordById`、`slices` 与 `phraseSegments` 五项只读字段，跳过 `confidence === "ambiguous"` 的乐句。内部构造 `CadenceDetectionContext`，提供延迟求值的 `measureFor`、`writtenBeatAt`、`metricAt` 与属链间隙证据函数 `gapEvidence`（`dominantNeighborEvidence`）。
- [`cadence/projectEvidence.ts`](../src/domain/harmony/cadence/projectEvidence.ts)：提供 `cadenceInputs(project)`（构建不克隆、不触发推导、不跑规则的最小分析输入，被 `buildHarmonyAnalysis`、文本谱渲染及 `pedalContinuationMidpoint` 复用）与 `detectProjectCadences(project)` 便捷入口。
- 人工句界可以落在持续音内部；`spansForPhrase` 借助 `clipHarmonySpan` 将和声区段按乐句半开区间裁剪，而不改变全局规则切片。
- 候选用 `fromTick` 表示可证的终止准备起点、`landingTick` 表示结构到达、`toTick` 表示实际收束音响的排他性终点。触及人工裁剪时不超出该句。只有无法从常规范围恢复的落点仍使用可持久化的 `observedLandingTick`，不变更工程 schema。

### 4.2 四类终止式候选

`detectCadences` 将检测结果归类为三大候选桶（`ordinary`、`interior`、`tonicTails`）以及面向无和弦尾音的分离式结束处理：

1. **乐句末端常规终止（`detectStandardPhraseEnding` -> `ordinary`）**：
   - **正格全终止（`full` / `authentic`）**：匹配 `D -> T`，回溯连续属链与 `K46`，并按节拍与书写低音纳入独立的下属功能准备。终止引擎和 `cadence.bass-formula` 共用正格低音公式，区分原位 `5 -> 1` 和实写支持的合法转位（例如 `V7 -> I6`）。完满正格还要求女高落主音。
   - **变格全终止与补充终止（`full` / `plagal` 与 `supplementary` / `plagal`）**：区分句末独立变格（`dorianPlagalEnding` 多利亚 `IV–i` 或满足外声部起奏与不完满条件的 `isImperfectPlagalClosing`）与正格收束后的变格尾声（`hasAuthenticTailAnchor` 成立时归为 `supplementary`）。若正格落主后紧接句末补充变格，`authenticCadenceBeforePlagalTail` 会同步补充前置的正格全终止候选。
   - **阻碍终止（`deceptive`）**：匹配属功能到非 I 级主功能（如 `D -> VI`，支持连续 `VI` 延展回溯），必要时以 `observedLandingTick` 标出首个 `VI` 落点。
   - **半终止（`half`）**：支持变格半终止和属功能半终止。属式半终止可纳入同调下属准备、短主功能起势或实写属持续低音上的辅助四六。根位属已实际到达时，后续同属转位不改写该低音证据。
2. **乐句内部清晰收束（`articulatedInteriorCadences` -> `interior`）**：
   - 在乐句内部识别可独立验证的收束，包括整小节保持后重起、齐休隔开的属式半终止、强位实奏落主及有终止四六准备的阻碍进行。人工边界裁剪取证范围，但不阻止同一句内部报告独立收束。
   - 对乐句内部的原位 `D -> VI`，若满足 `K46` 准备后强/次强拍持续至少两拍，或乐句中后段原位属与原位六级各持续至少两拍且六级落强拍（`interiorDeceptiveEvidence`），生成 `probable` 级内部阻碍终止候选。
3. **落主尾部延展（`tonicTails`）**：
   - `detectClosingTonicPedal`：小调属七落主后，外声部持续同一主音，内声经 `V7/iv -> iv64 -> i` 延展至共同释放（`closing-tonic-pedal`）。
   - `detectClosingTonicRevoicing`：属七强拍落主后，外声部保持，内声经短下属四六重配回主至共同释放（`closing-tonic-revoicing`）。
   - `detectClosingTonicDecoration`：属七实奏落主后，主低音与一上声部保持，两声部在弱位级进装饰后回主（`closing-tonic-decoration`）。
   - 弱位同主转位重配也可延长收束范围。这些路径用 `observedLandingTick` 保留首次实际落主，区间覆盖至最终释放。
4. **无和弦落点 / 分离式主结束（`detectDetachedTonicEnding`）**：
   - 当末乐句最后和弦为五级属且早于工程结尾时，检测两种无和弦落点：
     - **顿奏全休后的稀疏三声部主收束**：与前段下属、属七保持相同顿奏与全休节奏，强拍由低音、女高主音与内声三音收束（`detached-sparse-tonic`）；若前段存在同素材重奏前的顿奏阻碍，通过 `sparseRepriseCandidate` 同步补充 `detached-deceptive-reprise`。
     - **四部八度齐奏主音收束**：原位属三和弦后四声部强拍落至至少三个不同八度位置的主音（`octave-tonic-ending`）。
   - 候选范围延伸至无和弦落点音符释放，记录 `unharmonizedLandingTick` 并同步暴露为 `observedLandingTick`。

句内阻碍另有一条实写路径。强拍上原位 V7 的低音五升六，女高二归一并延长至六级释放，导音上行、七音下行，形成三音重复的 VI。这组证据记为 `written-deceptive-clausula`。在副属语境中还须有同句内紧邻的目标调主和弦作支撑。

半终止向前追溯 V/V 时，检测器验证副属导音在原声部上行至属根，分别记录准备起点、属落点与释放点。局部调的原位属经过换位再落主，可由同一条属链及实写导音解决确认不完满全终止。完满性沿用结构到达声部，属或主转位、女高落三音或五音均支持不完满读法。

准备左界、结构到达和末音释放分别记录为 `fromTick`、`landingTick` 和 `toTick`。同调连续的属和弦转位后回到原位时，实写低音与前端 K46 可以把这段属延长连回 K46。已解决的 V/V 或 vii°/V 须有同声部导音解决，才能把起点前移到副属。全终止若从原位属起算，还须有较长前属缩短进入副属的准备。短主和弦后，实写 IV 与 V 等长占满落主前一小节时，左界也可取 IV。人工切点位于持续属内部时，两句各自只使用本句覆盖的时段。实现见 [approach.ts](../src/domain/harmony/cadence/approach.ts)。

六级上的弱位分句允许阻碍终止在上声部实际释放处结束，保留六级最初的到达时刻。局部调性的原位 V–I 已由低音和倾向音解决确立时，两个内声在主持续音上经 IV64 或 iv64 返回主和弦，可分别产生正格全终止和补充变格终止。前者止于初次主和弦的释放，后者从下属四六起算。

### 4.3 属到主间断过渡与过滤规则

- **属到主间断过渡（`tonicLandingGapEvidence`）**：当属与主和弦区段间存在单一无和弦切片或顿奏休止时，允许经 [`cadence/authenticEndings.ts`](../src/domain/harmony/cadence/authenticEndings.ts) 的四类实奏证据桥接：`dominant-before-tonic-gap`（属七低音与内声保持、女高弱位换音后落主）、`tonic-bass-suspension`（强拍低音先落主、上方三声部预备延留同声部解决）、`staged-tonic-arrival`（主低音先到、属趋向音在原声部解决）与 `detached-dominant-to-tonic`（同型顿奏全休后强拍落主）。属链内部则允许 `dominant-neighbor-prolongation`（持续属低音上双弱位上辅助折回）桥接。
- **关键过滤规则**（[`cadence/phraseEndings.ts`](../src/domain/harmony/cadence/phraseEndings.ts)）：
  - **多利亚变格（`dorianPlagalEnding`）**：要求原位大下属到原位小主、上声部共同主音与低音 `4 -> 1`；在父大调记谱下还须由 `hasWrittenModalCenter` 证明此前强拍存在独立的小属至小主（`v–i`）实奏中心。
  - **补充变格与辅助回归过滤**：存在 `hasAuthenticTailAnchor` 时不把 `S -> T` 升格为独立变格全终止；若乐句末无人工边界且无前置正格全终止，持续主低音上的弱位上辅助回归 `I–IV64–I`（`isWrittenAuxiliaryReturn`）会被过滤，不误报为补充终止。
  - **平行主和弦转调假半终止过滤（`halfEndingContinuesThroughPivot` / `continuesThroughParallelTonic`）**：在自动推导句界处，若短时值 `V–V2` 经低音下行级进与导音解决进入同主音异调式 `I6`，且该 `I6` 紧接着作为下一调的 `iii/III` 枢纽进入新调属七，则抑制该处的假半终止候选。

### 4.4 合并、冲突仲裁与证据码清单

`mergeCadenceCandidates` 以 `phraseId:toTick` 为落点键按优先级合并：保留全部 `ordinary`，加入不与其同落点的 `interior`，再加入不与前两者同落点的 `tonicTails`。随后 `resolveConflicts` 对同一落点内的竞争候选按分数降序（同分优先跨度更短者）排序；若最优候选与异类次优候选分差 `< 10`，则降级为 `confidence: "ambiguous"` 并附带 `alternatives`。

[`CadenceEvidence["code"]`](../src/domain/harmony/cadence/model.ts) 当前定义全部 **25 种**证据码：

| 分类 | 证据码 |
| --- | --- |
| 边界与基础进行（7） | `phrase-boundary`、`dominant-to-tonic`、`predominant-to-dominant`、`predominant-to-tonic`、`dorian-plagal-ending`、`dominant-to-alternative`、`ends-on-dominant` |
| 属链与间断过渡（5） | `cadential64-chain`、`dominant-neighbor-prolongation`、`dominant-before-tonic-gap`、`tonic-bass-suspension`、`staged-tonic-arrival` |
| 顿奏与无和弦收束（4） | `detached-dominant-to-tonic`、`detached-sparse-tonic`、`octave-tonic-ending`、`detached-deceptive-reprise` |
| 落主尾部延展与内部收束（4） | `closing-tonic-decoration`、`closing-tonic-pedal`、`closing-tonic-revoicing`、`articulated-interior-ending` |
| 完满性、节拍与置信度（5） | `bass-formula`、`metric-support`、`soprano-tonic`、`stable-ending`、`ambiguous-semantics` |

## 5. 自动和弦推导

[`inferChords(project, options)`](../src/domain/harmony/inference/pipeline.ts) 面向尚未标注和弦的 SATB 工程，输出 `ChordInferenceResult`。模块拆分为 **14 个职责单一的文件**：

| 文件 | 核心职责 |
| --- | --- |
| [`index.ts`](../src/domain/harmony/inference/index.ts) | 公共导出聚合入口 |
| [`types.ts`](../src/domain/harmony/inference/types.ts) | 观测、候选、适配评估、评分、区段、告警与选项类型 |
| [`observations.ts`](../src/domain/harmony/inference/observations.ts) | 将工程切片为 `ChordInferenceObservation`（活跃音、起奏声部、低音、调性、节拍与完整 SATB 状态） |
| [`passContext.ts`](../src/domain/harmony/inference/passContext.ts) | 多阶段共享只读上下文 `InferencePassContext` 与同调连续判定 `continuesInKey` |
| [`localKeys.ts`](../src/domain/harmony/inference/localKeys.ts) | 无调号变更下的局部调性识别（`inferLocalKeys`）与平行主和弦枢纽（`parallelTonicPivot`） |
| [`scoring.ts`](../src/domain/harmony/inference/scoring.ts) | 功能模板构建、单切片适配评估 `fitChordObservation`、规范主和弦五音省略与前向/后向路径 DP `analyzeChordInferencePaths` |
| [`candidates.ts`](../src/domain/harmony/inference/candidates.ts) | 上下文准备 `prepareInferenceContext`、基础候选构造与 6 阶段管线编排 `buildContextualChordCandidates` |
| [`diatonicAndPivots.ts`](../src/domain/harmony/inference/diatonicAndPivots.ts) | 自然七和弦、经过主七、三转位解决、导七进确认调、实写枢纽七和弦及那不勒斯枢纽（属/六和弦） |
| [`dominantFamily.ts`](../src/domain/harmony/inference/dominantFamily.ts) | 属七六音替代、属九及重起主九、副属与副属模进、重属倍增三四（`DD++43`）、阻碍属与和声大调准备 |
| [`sixFours.ts`](../src/domain/harmony/inference/sixFours.ts) | 经过/辅助/终止四六分类（`classifySixFours`）、单声部重配与非终止主四六裁决（`chooseNoncadentialTonicSixFours`） |
| [`respellings.ts`](../src/domain/harmony/inference/respellings.ts) | 上下文等音重写、整三和弦等音、意增六上实写七和弦与升五音解决 |
| [`ornaments.ts`](../src/domain/harmony/inference/ornaments.ts) | 先现、预备延留、同和声延长、双辅助音、上声部经过音、两轮链式外音恢复与弱拍假和弦竞争 |
| [`segmentation.ts`](../src/domain/harmony/inference/segmentation.ts) | 候选聚合、相邻同语义区段合并（`buildChordInferenceRegions`）与告警生成（`warningsForRegions`） |
| [`pipeline.ts`](../src/domain/harmony/inference/pipeline.ts) | `inferChords`、`applyChordInference`、`inferHarmony`、`applyHarmonyInference` 与乐句写回保护 |

### 5.1 上下文准备与局部调性（`prepareInferenceContext` & `localKeys.ts`）

在构造任何候选前，[`prepareInferenceContext`](../src/domain/harmony/inference/candidates.ts) 准备共享的 [`InferencePassContext`](../src/domain/harmony/inference/passContext.ts)：

1. 构建全曲观测切片 `buildChordInferenceObservations(project)`（即便请求为局部选区，求解阶段也使用完整上下文）。
2. 以 `chordRegions: []` 只读预跑 `inferPhrases`，得到不依赖现有和弦标注的 `terminalTicks`，用于解锁句末属后主和弦允许的五音省略。
3. 调用 [`inferLocalKeys`](../src/domain/harmony/inference/localKeys.ts) 在记谱调号与人工句界切出的窗口内枚举候选调心。先保留有独立准备与稳定落点的实写终止证据，再用共享的 `createStructuralVoicingReader` 复核被外音遮住的帧。结构复核要求唯一可行的书写配位、同声部外音路径和完整构成音，不把完整的竞争和弦随意改成外音。
4. 一次副属落点只支持主音化。持续调心要求独立准备与明确的落主，或在有限距离内出现两次相互独立的属–主到达，并排除已确立的竞争调心。扩展时以最初可验证的属功能或其独立准备为起点；不能仅凭之后的终止倒填共同和弦。短暂经过材料后的回归也需要再次出现实写属–主。共同和弦与减七改释保留各自的书写证据，不单独计作调心确立。
5. 将通过复核的 `localKey` 注入候选观测，仍保留原始音符和记谱调号事件。盲推保持和弦构成、转位和外音的独立验证。局部四六前的预备延留仅在独立属–主证据和原位外音路径同时成立时回写；副属序列和路径评分不会用后调的同级数充当前调的目标。

重复的 V–I 要由目标调中的前属，或有独立和声活动的持续段连接。同一 V 反复起奏只提供一份证据。回溯准备时，遇到已由导音解决确立、且不属于目标音阶的原位主和弦即停止；直接准备后调属和弦的那不勒斯和弦可以作枢纽。结构帧还可用完整的 ii7 或 iiø7、导音的同声部解决及稳定的原位主和弦确认新调。主持续音上的上三声部若再次完整奏出 V 并解决至 I，也能独立确认调心。切换窗只用于候选解释，工程记谱调号保留原值。

### 5.2 6 阶段候选管线（`buildContextualChordCandidates`）

```text
prepareInferenceContext（全曲观测 + 无和弦乐句预推导 + inferLocalKeys）
  │
  ▼ 阶段 1: initialCandidates
      按调性功能模板逐切片匹配；句末属后解锁主和弦五音省略；可选绝对回退；按 minConfidence 过滤
  │
  ▼ 阶段 2: expandCoreCandidates
      实写枢纽七 -> 自然七与同主音调式借用 -> 降二级及其大七 -> 副属模进 -> 副属及其导七准备 -> 重起主九
  │
  ▼ 阶段 3: classifyEarlyOrnamentsAndSixFours
      先现音 -> 预备延留(4-3/9-8) -> 单音延长 -> 同时双辅助 -> classifySixFours（经过/辅助/终止四六）
  │
  ▼ 阶段 4: expandDominantFamilyAndPivots
      阻碍属 -> 属七六音替代 -> 经过主七 -> 那不勒斯枢纽属 -> DD++43
      -> 单声部重配 -> 三转位解决 -> 导七进确认调 -> 整三和弦等音重写
  │
  ▼ 阶段 5: recoverLateOrnamentsAndRespellings
      下辅助对（产出 withheldStarts）-> 上声部经过音 -> 那不勒斯枢纽六
      -> 升五音解决 -> 意增六上实写七和弦 -> 上下文等音重写
  │
  ▼ 阶段 6: recoverNinthsAndContextualOrnaments
      属九（产出 ninthAlternatives）-> withContextualOrnaments（链式外音与结构配位）
      -> resolveFiguredPedals（在已证实的原位属落点前复核主四六）
```

候选评分综合功能模板层级、音适配、低音适配、拼写一致性、节拍语境、序列语境、非和弦音惩罚与复杂度惩罚；人工已标注的非和弦音角色是硬证据，不会与之冲突。其中：

- **原位属七六音替代五音**：核对新起奏的属低音、女高六音及内声三/七音，女高可下行二度回五音或下行三度到主音（导音与七音各自在原声部解决），以 `dominant-sixth-substitution` 证据保留属七实体。
- **增六和弦完整性**：意大利、法国、德国增六候选必须覆盖各自全部构成音，缺少增六音程任一端或其他必要音时直接硬拒绝，不受 `allowIncompleteVoicing` 放宽影响。

观测按音名字母和升降号保留不同拼写。一个和弦音同时写成 D♯ 和 E♭ 时，普通纵向模板不能用这两个音构成重复。完整 iiø7 和 vii°7 的拼写可确立和声大调的降六级。借用同主音小调的降 III、降 VI 等和弦，还需邻近的另一个借用和弦印证。副属可以等待同一低音上的上声部在一拍内落定；省五音的属三和弦则要求三根一三、实际目标和弦和同声部导音解决。副导七进入副属七时，降六级下行到属根，其余三声部须保持原拼写与音区。在同一属低音上，4–3、6–5 的同声部书写下行和节拍位置可以确认 K46。声部换位或外音打断直接解决时，末轮复核会查找一个小节内的原位属和弦，以及随后的属主闭合。它同时核对四六的起拍、低音进入方式和下属或重属准备。已经证明的经过、辅助四六以及人工句界会截断这条路径。

局部调的一个确认条件是连续的两次解决。目标调的属先由其副属七解决到原位，再转为第一转位、加入七音并落到目标主和弦。前一连接的导音和七音、后一连接的导音和七音都须在原声部按书写方向解决。新窗口从属和弦第一转位开始，原位枢纽保留原有归属。

### 5.3 两轮链式外音恢复与弱拍假和弦竞争（`ornaments.ts`）

管线末端的 [`withContextualOrnaments`](../src/domain/harmony/inference/ornaments.ts) 按以下步骤处理复杂外音：

1. **首轮空白恢复（`recoverOrnamentGaps(..., seedChains = true)`）**：
   - 仅以 `isStructuralAnchor`（具功能语义、三度结构、拼写一致、低音匹配且无外音）作为锚点，跳过 `withheldStarts` 保留边界。
   - 对单切片空白依次尝试延留/上行延留（`recoverContextualSuspensions`，支持跨相邻未解析切片核对准备或解决）与先现音（`recoverContextualAnticipations`）；对总时值不超过 4 个四分音符的连续空白尝试经过音、辅助音、弱位逸音（`recoverContextualPassingAndNeighbors`）及强拍经过音（`recoverAccentedPassing`）。
2. **次轮链式恢复（`recoverOrnamentGaps(..., seedChains = false)`）**：
   - 将首轮恢复出的高可信外音切片（`isVerifiedOrnamentAnchor`：`confidence !== "low"` 且所有外音均带 `inferred-nonchord-tone` 证据）提升为二级锚点，对仍空白的相邻切片再次执行恢复，从而解开连续交错的链式外音。
   - **平行五八度保护（`hasSafeOrnamentMotion`）**：次轮恢复与跨切片链式恢复均须通过 `hasParallelPerfects` 校验，确保外音切入/切出两侧不会制造涉及外音的平行五度或八度；水平外音分析同时经 `hasParallelNeighborFifths` 禁止平行辅助五度。
3. **弱拍假和弦竞争（`addOrnamentCompetition`）**：
   - 对原本已命中结构候选但位于弱位（`metric.level < 2`）、时值短于一拍（`< measureBeatTicks ?? ppq`）且不具独立强结构证据（如九和弦、变音、`K46`、副属或带常规解决的七和弦）的切片，以 `competition = true` 生成经过/辅助、延留与先现竞争候选。
   - 每个竞争候选须经 `verifyCompetingOrnament` 严格核验：最多 2 个外音、不含逸音、通过 `hasSafeOrnamentMotion`、低音外音仅允许双侧同转位回归辅助、至少一个上声部保持延续且还原外音后完整覆盖和弦音。
   - 通过核验的候选经 `scoreVerifiedOrnament` 依据还原后的和弦音覆盖率与双侧佐证计算 `contextFit`，与原纵向候选共同进入序列路径 DP 竞争；竞争胜者不会回流为新锚点去继续衍生空白恢复。

4. **共享结构配位回填（`recoverWrittenStructuralGaps`）**：对没有可用解释的非完整实写三度叠置，按声部追踪跨切片的书写外音链。既有纵向解与实写和声可提供出发或到达支持，但只用已有功能锚点或还原后能精确命中的功能模板产生候选。多声部错开解决、保留低音下上声部延留，以及同一和弦重配转位时，候选必须覆盖必要结构音、解释每个表层外音、落实结构低音，并为每条路径记录起止和音符引用。仍服从禁用外音、严格置信度、保留切片和边界限制。完整的表层三度叠置另有一项复核。低音换音时，至少两个上声部必须从实写完整的前一和弦持入，并在同一低音事件上各自级进，最终同时构成完整的到达和弦。任一声部重新起奏、落点缺音或越过句界，均不足以据此覆盖表层读法。实现见 [structuralOrnaments.ts](../src/domain/harmony/inference/structuralOrnaments.ts) 与 [writtenVoicing.ts](../src/domain/harmony/facts/writtenVoicing.ts)。

5. **多音经过链**沿实际音符事件检查端点。三个伴随声部持续时，弱位上同向经过的二至四个音可暂时形成另一个纵向实体。链末可回到原和弦，也可与其他声部同时进入一个独立、完整的新和弦。新和弦从落点起算，每个经过音保留自己的音符引用。

5. **持续和声上的书写经过链（`recoverHeldPassingLines`）**。两端为含相同转位的完整和弦，其余三个声部保持原来的音符事件时，按实际起奏追踪同一上声部一拍内的 2 至 4 个经过音。每一步都须连奏、同向且书写成立。中间音偶然拼成完整三和弦时，整条经过链提供水平证据。旋律折返、低音重奏、角色冲突或句界会切断这项证明。结构读谱也能识别同时装饰中的低音双重身份，例如男低音经过属七的另一构成音；两端实际转位、另一装饰声部及持续内声共同支持结构低音。

### 5.4 序列路径求解、后处理与区段合并

1. **前向/后向路径 DP（`analyzeChordInferencePaths`）**：对每个连续有候选区间（每切片最多保留 32 个候选）执行前向与后向 DP，`pathScore` 表示“经过该候选的最佳完整路径分数”，重起延续奖励同步计入竞争路径。主候选与备选按 `pathScore` 比较，分差 `< 12` 时保留歧义。
2. **非终止主四六与局部范围裁剪（`pipeline.ts`）**：路径选定后先由 `chooseNoncadentialTonicSixFours` 裁决非终止主四六；若调用方指定了局部 `[fromTick, toTick)`，再对观测、候选集与选定路径做半开区间裁剪，确保在完整音乐上下文中求解、仅聚合与写回请求区间。
3. **区段合并、属九复核备选与告警**：
   - [`buildChordInferenceRegions`](../src/domain/harmony/inference/segmentation.ts) 合并相邻同调、同语义区段，并在 `withheldStarts` 指定位置强制断开以保留独立边界；汇总局部 `score`、音符引用、非和弦音分配与证据，取最低置信度（`pathScore` 不可跨切片累加）。
   - `addDominantNinthAlternatives` 为带九音读法的单观测区段附加可供复核的备选（设置 `reviewCandidateIds`）。
   - `warningsForRegions` 对 `unclassified`、`ambiguous` 区段生成告警；对已确立谱面实写等音身份但功能解释仍缺失或歧义（含 `written-enharmonic-identity` 证据）的区段生成 `function-unresolved` 告警。

### 5.5 应用写回与交互入口

- **和弦写回（[`applyChordInference`](../src/domain/harmony/inference/pipeline.ts)）**：
  - 支持 `mode: "fill-gaps" | "replace-unlocked"`、`writeNonChordToneRoles`，以及 **`selection`**（仅应用指定区段 ID 集合）与 **`candidateChoices`**（按区段 ID 指定采用的候选 ID；单观测区段可切换至 `alternatives`）。
  - 在 `replace-unlocked` 且指定 `selection` 做单段/局部替换时，若目标区段与已有未锁定和弦部分重叠，`chordOverhangs` 会裁剪并保留原和弦在替换区间前后露出的悬垂部分，而不是整段删除。
  - 约束边界：和弦区域写回检查和弦轨锁定、锁定和弦重叠，并经 `addChordRegion` 校验调号边界与重叠；非和弦音角色写回经 `noteIsLockedForInference` 检查音符锁定、轨道锁定与 `exercise.editableRanges` 不可编辑区间，且仅写入起奏落在 `result.range` 内的音符。
- **完整和声推导（[`inferHarmony` / `applyHarmonyInference`](../src/domain/harmony/inference/pipeline.ts)）**：`inferHarmony` 先产出和弦推导结果，`applyHarmonyInference` 在写回和弦后调用 `applyInferredPhraseBoundaries` 更新自动乐句边界并返回 `appliedPhraseBoundaryCount` 与 `appliedPhraseTemplate`。
- **前端交互入口（[`ChordInferenceDialog`](../src/features/chordInference/ChordInferenceDialog.tsx) & [`ChordInferencePreview`](../src/features/chordInference/ChordInferencePreview.tsx)）**：
  - 对话框实际支持的推导范围（`ChordInferenceRangeMode`）为 **`selection`（当前选择）**、**`current-measure`（当前小节）** 与 **`project`（整个工程）**（不支持按乐句范围）。
  - `ChordInferencePreview` 展示带 `reviewCandidateIds` 的单观测区段候选读法，支持逐区段切换候选与点击“仅应用此段”。在 [`AppShell.tsx`](../src/app/AppShell.tsx) 中，单区段独立应用（携带 `options.selection`）走 **`applyChordInference`**，不改动全曲乐句边界；整体应用走 **`applyHarmonyInference`**，同步刷新乐句结构。

推导出的延留角色在和弦写回结束后核验。准备可以是跨和声持续的原音，也可以是同声部、同拼写、同八度的紧邻重奏。准备位置须有已应用的和弦且该音为其成员，延留位置须出现和弦外音，解决音须紧邻、下行级进并属于落点和弦。前置区段弃权、休止或解决音跳走时，候选仍可供预览，自动应用时保留音符的原角色。人工声明的角色继续交给规则检查。

## 6. 与规则引擎及外置 API 的边界

候选不是工程标注：`phraseBoundaryCandidates` / `cadenceCandidates` 仅表示本次分析的只读候选，不能替代 `phraseBoundaries` / `cadenceAnnotations`。

`HarmonyAnalysis` 暴露 `metricTimeline`、`phraseBoundaries`、`phraseBoundaryCandidates`、`phraseSegments`、`cadenceCandidates`、`cadenceAnnotations` 与 `cadenceAtTick`。内置规则通过 [`HarmonyRuleContext`](../src/domain/harmony/rules/context/createRuleContext.ts) 的乐句与终止查询读取这些事实，不会反向修改边界或标注。

默认应用只写入已解决区段。歧义区段保留空白，规则可从同一份乐谱重新读取有独立证据的音级义务。例如四部实写的 V7、V65 或 V43 接已证实的主和弦时，检查器可以从书写拼写、实际低音与导音进行确定七音声部。检查只引用实际音符和已有标签，重新打开工程也能重建证据。空五度无法提供属七的三音与七音。检查转位属七的七音时，还须验证实际最低声部如何进入目标和弦。

外置 API v3 暴露 `phraseSegments`、`phraseBoundaryCandidates` 与 `cadenceCandidates` 供脚本只读消费（见 [external-rules.md](./external-rules.md)），辅助轨明细仍然不公开。

## 7. 扩展与检查表

- 新自动分析是否返回候选 + 置信度 + 证据，而不是直接写回工程？
- 语义歧义、休止、转调或上下文不足时是否保守返回 `ambiguous` / 跳过？
- 写回是否遵守锁定、不可编辑区间、重叠与调号边界，并在局部替换时妥善处理悬垂和弦？
- 推断指纹与观测落点动态审查是否让过期边界/标注可被识别且不覆盖新实时候选？
- 新证据是否只读取快照事实，不泄露辅助轨明细或系统对象？
- 内置规则、外置上下文与 UI 是否同步新结构，且测试覆盖候选、链式外音、冲突与退化场景？
