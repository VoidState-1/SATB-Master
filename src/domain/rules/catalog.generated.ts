// 此文件由 scripts/generate-rule-catalog.mjs 从 DesignDocs/harmony-rule-catalog.md 生成。
// 请修改设计清单后重新运行生成器，不要直接编辑本文件。

export const GENERATED_RULE_CATALOG = [
  {
    "catalogNumber": "A.1",
    "label": "超出建议音域",
    "id": "voice.range",
    "defaultSeverity": "warning",
    "description": "SATB 音符低于或高于对应声部 profile 的建议音域时触发；按实际 MIDI 音高判断，书写等音不改变结果。",
    "rationale": "辅助轨不参与；完整钢琴卷帘音域不等于各声部建议音域。"
  },
  {
    "catalogNumber": "A.2",
    "label": "同声部音符重叠",
    "id": "voice.polyphonic-overlap",
    "defaultSeverity": "error",
    "description": "同一声部两个不同音符的半开时间区间相交，且不是同一音高的合法连音表达时触发。",
    "rationale": "辅助轨允许复调；相邻音符 `endTick === startTick` 不算重叠。"
  },
  {
    "catalogNumber": "A.3",
    "label": "声部交叉",
    "id": "voice.crossing",
    "defaultSeverity": "error",
    "description": "同一有效切片中，较高声部低于相邻的较低声部时触发；分别检查 S/A、A/T、T/B。",
    "rationale": "相邻声部同音不算交叉；同和弦转换不豁免。"
  },
  {
    "catalogNumber": "A.4",
    "label": "上三声部间距过宽",
    "id": "voice.upper-spacing",
    "defaultSeverity": "warning",
    "description": "同一切片中 S-A 或 A-T 的实际音高距离大于 12 半音时触发。",
    "rationale": "T-B 不设八度上限；同和弦转换不豁免。"
  },
  {
    "catalogNumber": "A.5",
    "label": "四声部不完整",
    "id": "voice.incomplete-satb",
    "defaultSeverity": "suggestion",
    "description": "在启用“严格四声部习题”profile 且和弦区间要求完整配置时，任一 SATB 声部没有有效音符即触发。",
    "rationale": "弱起、分句休止、导入后的未完成片段和自由写作 profile 默认不检查。"
  },
  {
    "catalogNumber": "B.1",
    "label": "超过八度的跳进",
    "id": "melody.leap-over-octave",
    "defaultSeverity": "error",
    "description": "同一声部的连续起奏音相差大于 12 半音时触发。",
    "rationale": "休止会切断连续旋律；同和弦分解也不豁免超过八度的跳进。"
  },
  {
    "catalogNumber": "B.2",
    "label": "较大旋律跳进",
    "id": "melody.large-leap",
    "defaultSeverity": "warning",
    "description": "不同和声之间，同一声部连续起奏音的简单音程大于纯五度并且不超过纯八度时触发。",
    "rationale": "同和弦转换中的分解和弦跳进放宽；六度和八度是否允许由教学 profile 细分。"
  },
  {
    "catalogNumber": "B.3",
    "label": "旋律增音程",
    "id": "melody.augmented-interval",
    "defaultSeverity": "warning",
    "description": "使用字母级数和升降号计算书写音程，连续起奏音形成增一度、增二度、增四度等增音程时触发。",
    "rationale": "同和弦内合法分解和弦、旋律小调特定进行和变化和弦的规范解决由专用规则决定；不能只按半音数判断。"
  },
  {
    "catalogNumber": "B.4",
    "label": "旋律减音程",
    "id": "melody.diminished-interval",
    "defaultSeverity": "warning",
    "description": "连续起奏音形成减音程时触发，并记录后继音以判断是否按规范反向解决。",
    "rationale": "允许的减七度、减四度等解决模式需要按和弦功能建立金样本；待审定前不升级为错误。"
  },
  {
    "catalogNumber": "B.5",
    "label": "三全音旋律进行",
    "id": "melody.tritone",
    "defaultSeverity": "warning",
    "description": "这是 B.3/B.4 的专门显示子类；当书写音程为增四度或减五度时提供更具体诊断。",
    "rationale": "与 B.3/B.4 共用证据时只显示本条；同和弦转换中的和弦音跳进按适用性计划放宽。"
  },
  {
    "catalogNumber": "B.6",
    "label": "大跳后的反向补偿",
    "id": "melody.leap-recovery",
    "defaultSeverity": "suggestion",
    "description": "大于三度的跳进后，后继起奏音继续同向跳进，或没有在合理窗口内反向级进时触发。",
    "rationale": "同和弦分解、序进、经过性低音和明确的旋律轮廓可豁免；“合理窗口”需金样本校准。"
  },
  {
    "catalogNumber": "B.7",
    "label": "同向连续跳进",
    "id": "melody.consecutive-leaps",
    "defaultSeverity": "suggestion",
    "description": "至少三次连续起奏形成两个同向跳进，并且总轮廓构成七度、九度或其他不协和音程时触发。",
    "rationale": "同和弦分解、明确序进或总轮廓为和弦协和音程时放宽。"
  },
  {
    "catalogNumber": "C.1",
    "label": "声部超越",
    "id": "voice-leading.overlap",
    "defaultSeverity": "warning",
    "description": "较低声部的新音高于较高相邻声部的前一音，或较高声部的新音低于较低相邻声部的前一音时触发。",
    "rationale": "同和弦转换和明确声部交换允许；不得与同一时刻的声部交叉混淆。"
  },
  {
    "catalogNumber": "C.2",
    "label": "平行纯五度",
    "id": "voice-leading.parallel-fifths",
    "defaultSeverity": "error",
    "description": "同一对声部在连续有效起奏关系上均形成纯五度类音程，两个声部同向运动且均实际改变音高时触发；复合十二度按五度类处理。",
    "rationale": "同和弦转换、声部交换和非和弦音都不能自动豁免；装饰音造成的表面平行需按结构音层级校准。"
  },
  {
    "catalogNumber": "C.3",
    "label": "平行八度或同度",
    "id": "voice-leading.parallel-octaves",
    "defaultSeverity": "error",
    "description": "同一对声部连续形成同度/八度类音程，并且两个声部同向实际运动时触发；跨越多个八度仍按八度类处理。",
    "rationale": "同和弦转换不豁免；同音保持且只有一个声部运动不是平行。"
  },
  {
    "catalogNumber": "C.4.1",
    "label": "纯五度到减五度",
    "id": "voice-leading.unequal-fifths-perfect-to-diminished",
    "defaultSeverity": "off",
    "description": "连续结构切片中，同一对声部同向实际运动，前一书写音程为纯五度类、后一书写音程为减五度类时命中本规则。",
    "rationale": "按斯波索宾口径通常允许，尤其是包含内声部或低音级进时；保留为可选规则只为支持更严格的院校 profile。"
  },
  {
    "catalogNumber": "C.4.2",
    "label": "外声部减五度到纯五度",
    "id": "voice-leading.unequal-fifths-outer-diminished-to-perfect",
    "defaultSeverity": "error",
    "description": "声部对必须恰好为 B-S，连续结构切片中两声部同向实际运动，前一书写音程为减五度类、后一书写音程为纯五度类时触发。",
    "rationale": "斯波索宾口径严格禁止；不能因同和弦转换或低音级进而自动豁免。用户仍可在规则 profile 中降为警告或关闭。"
  },
  {
    "catalogNumber": "C.4.3",
    "label": "涉及内声部的减五度到纯五度",
    "id": "voice-leading.unequal-fifths-inner-diminished-to-perfect",
    "defaultSeverity": "warning",
    "description": "同一对声部包含 A 或 T，连续结构切片中由减五度同向进入纯五度；若全局低音同时按书写音级上行二度，则按斯波索宾口径允许，否则触发。",
    "rationale": "“低音上行级进”必须按相邻字母音级和实际方向共同判断，不能只检查 1 或 2 个半音；严格 profile 可以选择无视该允许条件继续报告。"
  },
  {
    "catalogNumber": "C.5",
    "label": "外声部隐伏五度",
    "id": "voice-leading.hidden-fifth",
    "defaultSeverity": "warning",
    "description": "男低音与女高音同向运动到纯五度类音程，且女高音以跳进到达时触发。",
    "rationale": "女高音级进时通常允许；同和弦转换放宽；必须与真正平行五度去重。"
  },
  {
    "catalogNumber": "C.6",
    "label": "外声部隐伏八度",
    "id": "voice-leading.hidden-octave",
    "defaultSeverity": "warning",
    "description": "男低音与女高音同向运动到八度/同度类音程，且女高音以跳进到达时触发。",
    "rationale": "女高音级进和同和弦转换按教学口径放宽；与平行八度去重。"
  },
  {
    "catalogNumber": "C.7",
    "label": "同时对斜",
    "id": "voice-leading.cross-relation-simultaneous",
    "defaultSeverity": "warning",
    "description": "同一切片中不同声部出现相同字母名但不同 accidental 的书写音高，并且不是已确认的特殊变化和弦构成时触发。",
    "rationale": "增六和弦等合法构成按和弦 identity 豁免；只比较 MIDI pitch class 会产生误判，必须使用 `SpelledPitch`。"
  },
  {
    "catalogNumber": "C.8",
    "label": "先后对斜",
    "id": "voice-leading.cross-relation-successive",
    "defaultSeverity": "suggestion",
    "description": "一个声部的音结束或延续后，在限定窗口内由另一声部出现同字母异 accidental，且没有合法半音化、转调或和弦解释时触发。",
    "rationale": "窗口应按起奏链和和声边界定义，不按固定毫秒；变化和弦、共同和弦转调和半音进行需要专用例外。"
  },
  {
    "catalogNumber": "C.9",
    "label": "四声部同向进行",
    "id": "voice-leading.all-voices-similar",
    "defaultSeverity": "suggestion",
    "description": "相邻结构切片中四个 SATB 声部全部实际起奏并向同一方向移动时提示。",
    "rationale": "本条只评价织体独立性；若同时产生平行五八度，只显示更具体的平行诊断为主。"
  },
  {
    "catalogNumber": "D.1",
    "label": "未标注的和弦外音",
    "id": "chord.unclassified-nonchord-tone",
    "defaultSeverity": "warning",
    "description": "按实际书写音高与当前 `ChordIdentity` 比较；音符不属于构成音集合且没有人工确认角色时触发。",
    "rationale": "持续低音、经过音等只有在角色得到确认后豁免；和弦区域没有可靠 identity 时跳过。"
  },
  {
    "catalogNumber": "D.2",
    "label": "和弦构成音不完整",
    "id": "chord.incomplete-members",
    "defaultSeverity": "warning",
    "description": "在同和弦 span 的最后一个完整有效切片，对照 `ChordVoicingPolicy.requiredDegrees` 检查缺失成员。",
    "rationale": "允许省略的和弦音不触发；span 中间转换暂不检查；诊断只归属和弦轨。"
  },
  {
    "catalogNumber": "D.3",
    "label": "低音与转位不一致",
    "id": "chord.inversion-bass",
    "defaultSeverity": "error",
    "description": "在每个有完整低音的切片中，将男低音书写音高映射到 identity degree，并与和弦转位比较。",
    "rationale": "已确认的持续低音语境由踏板规则接管；无法映射为和弦音时同时属于 D.1，但只保留更具体根因。"
  },
  {
    "catalogNumber": "D.4",
    "label": "功能标记与和弦实体冲突",
    "id": "chord.interpretation-identity-conflict",
    "defaultSeverity": "error",
    "description": "用局部调性和 `FunctionalDesignation` 重新生成规范 identity，与持久化 identity 的书写构成、低音约束和结构类别比较。",
    "rationale": "正常编辑命令应提前阻止该状态；本规则用于导入、迁移、外置工具或损坏数据后的防御诊断。"
  },
  {
    "catalogNumber": "D.5",
    "label": "原位三和弦重复音",
    "id": "chord.triad-root-position-doubling",
    "defaultSeverity": "suggestion",
    "description": "完整四声部原位三和弦通常应重复根音；重复三音或省略必要构成音时根据和弦级数、调式和连接语境提示。",
    "rationale": "不得与“重复导音”等硬限制重复报警；具体副三和弦允许的重复方式需由 voicing profile 给出。"
  },
  {
    "catalogNumber": "D.6",
    "label": "六和弦重复音",
    "id": "chord.first-inversion-doubling",
    "defaultSeverity": "suggestion",
    "description": "根据具体功能和级数选择允许/优先的重复音；导音、变化音和不稳定三音不得因一般“自由重复”而被重复。",
    "rationale": "`SII6`、减三和弦、经过六和弦等必须使用各自 profile，不能用一条“所有六和弦都重复低音”的简化规则。"
  },
  {
    "catalogNumber": "D.7",
    "label": "四六和弦配置",
    "id": "chord.second-inversion-voicing",
    "defaultSeverity": "warning",
    "description": "检查低音是否为五音、通常是否重复低音，以及该四六和弦是否具有终止、经过、辅助或持续低音等可解释语境。",
    "rationale": "`K46` 使用专用规则；没有角色标注时只提示，不凭单个切片武断判断用途。"
  },
  {
    "catalogNumber": "D.8",
    "label": "重复导音",
    "id": "chord.doubled-leading-tone",
    "defaultSeverity": "error",
    "description": "在 span 出口或独立和弦的最后有效配置中，按 `SpelledPitch` 和局部调性识别导音并计数。",
    "rationale": "span 中间的暂时重复延迟判断；共同和弦歧义时只使用已确认局部调性。"
  },
  {
    "catalogNumber": "D.9",
    "label": "重复和弦七音",
    "id": "chord.doubled-seventh",
    "defaultSeverity": "error",
    "description": "在稳定配置中按 identity degree 识别七音，出现两个或更多时触发。",
    "rationale": "同和弦转换中间切片延迟判断；人工装饰音不能被误算为第二个和弦七音。"
  },
  {
    "catalogNumber": "D.10",
    "label": "重复变化倾向音",
    "id": "chord.doubled-altered-tendency-tone",
    "defaultSeverity": "error",
    "description": "根据和弦 identity 和功能目标识别带方向性的变化构成音，稳定配置中重复该音时触发。",
    "rationale": "必须读取结构化 alteration，不能把所有调外音都当作倾向音；具体和弦可覆盖默认策略。"
  },
  {
    "catalogNumber": "D.11",
    "label": "D9 四声部配置",
    "id": "chord.dominant-ninth-voicing",
    "defaultSeverity": "error",
    "description": "四声部 `D9` 必须恰好实现项目已审定的 `1/3/7/9` 配置；缺少必需音或出现五音时触发。",
    "rationale": "仅适用于本项目支持的原位 `D9`；未来扩展五声部或其他九和弦时不得复用该固定策略。"
  },
  {
    "catalogNumber": "D.12",
    "label": "D9 根音与九音间距",
    "id": "chord.dominant-ninth-root-spacing",
    "defaultSeverity": "error",
    "description": "在当前支持的原位四声部 `D9` 中，定位唯一根音与九音；九音实际音高必须高于根音 12 个半音以上，并在书写上形成复九度而不是同一八度内的二度。",
    "rationale": "当前 `D9` 固定根音位于男低音且配置为 `1/3/7/9`；如果未来支持省略根音、多个根音、转位九和弦或五声部配置，必须为新结构单独定义策略。"
  },
  {
    "catalogNumber": "D.13",
    "label": "增六和弦配置",
    "id": "chord.augmented-sixth-voicing",
    "defaultSeverity": "error",
    "description": "分别按 It+6、Fr+6、Ger+6 的规范书写构成检查，确保增六两端音存在且不重复具有强烈解决方向的变化音。",
    "rationale": "三种结构不能只按 pitch class 合并；具体允许重复成员需建立调性金样本。"
  },
  {
    "catalogNumber": "E.1",
    "label": "导音未解决",
    "id": "resolution.leading-tone",
    "defaultSeverity": "warning",
    "description": "规则在导音起奏时创建私有状态，越过同和弦 span 跟踪同一声部的下一有效起奏；未按目标调性上行小二度到主音时触发。",
    "rationale": "内声部在特定不完全属和弦连接中的自由进行、阻碍进行及声部交换需专门金样本；休止中断状态。"
  },
  {
    "catalogNumber": "E.2",
    "label": "和弦七音未解决",
    "id": "resolution.chord-seventh",
    "defaultSeverity": "warning",
    "description": "七音状态可在同和弦转换内延续；离开 span 后检查同一声部是否下行半音或全音到目标和弦允许音。",
    "rationale": "同和弦内声部交换不能由另一声部替代解决；特殊延迟解决由专用和弦规则声明。"
  },
  {
    "catalogNumber": "E.3",
    "label": "属九音未解决",
    "id": "resolution.dominant-ninth",
    "defaultSeverity": "warning",
    "description": "识别 `D9` 的九音并跟踪同一声部，在离开属九 span 时要求级进下行到目标和弦允许音。",
    "rationale": "与通用七音、变化音规则共享证据时使用本条专用诊断；具体转位不在当前产品范围。"
  },
  {
    "catalogNumber": "E.4",
    "label": "变化音方向性解决",
    "id": "resolution.altered-tone",
    "defaultSeverity": "warning",
    "description": "只对和弦模型明确标记为 directional alteration 的构成音建状态；通常升高音向上、降低音向下解决到目标和弦音。",
    "rationale": "不能从 accidental 字符机械推出方向；增六、导音和特定重属音由更具体规则覆盖。"
  },
  {
    "catalogNumber": "E.5",
    "label": "增六音程未反向解决",
    "id": "resolution.augmented-sixth",
    "defaultSeverity": "error",
    "description": "跟踪增六两端的书写音高，要求低端下行半音、高端上行半音，形成目标属音的八度或进入已确认的 `K46` 过渡。",
    "rationale": "Ger+6 为避免平行五度可能经过 `K46`；具体目标以功能标注为准。"
  },
  {
    "catalogNumber": "F.1",
    "label": "经过音角色不成立",
    "id": "nonchord.passing-tone",
    "defaultSeverity": "warning",
    "description": "同一声部前后结构音存在，经过音以级进进入并以同方向级进离开，连接三度范围内的两个结构音；节拍类型按角色子类判断。",
    "rationale": "半音经过音允许不同 accidental；缺少任一侧上下文时返回上下文不足。"
  },
  {
    "catalogNumber": "F.2",
    "label": "辅助音角色不成立",
    "id": "nonchord.neighbor-tone",
    "defaultSeverity": "warning",
    "description": "要求级进进入、反向级进离开，并回到相同书写音级或确认的等音目标。",
    "rationale": "双辅助音和变音辅助音应作为后续子类型，不由首版规则猜测。"
  },
  {
    "catalogNumber": "F.3",
    "label": "挂留音准备不正确",
    "id": "nonchord.suspension-preparation",
    "defaultSeverity": "warning",
    "description": "同一声部前一结构音必须与当前挂留音同高并跨越和声边界保持或合法重奏，且在准备和弦中属于协和构成。",
    "rationale": "无准备的不协和音应标为倚音而非挂留音；是否允许重奏需教学 profile 审定。"
  },
  {
    "catalogNumber": "F.4",
    "label": "挂留音未解决",
    "id": "nonchord.suspension-resolution",
    "defaultSeverity": "warning",
    "description": "挂留状态跨切片传递，要求在截止点前通常下行级进到当前和弦音；`4-3`、`7-6`、`9-8` 等由结构化角色参数给出目标。",
    "rationale": "转位挂留、装饰性延迟解决和链式挂留由角色配置决定，不能使用固定“下一音”窗口。"
  },
  {
    "catalogNumber": "F.5",
    "label": "延宕音角色不成立",
    "id": "nonchord.retardation",
    "defaultSeverity": "warning",
    "description": "与挂留音相同地检查准备和保持，但解决方向为上行级进。",
    "rationale": "术语和允许类型需与最终教材用语统一。"
  },
  {
    "catalogNumber": "F.6",
    "label": "倚音角色不成立",
    "id": "nonchord.appoggiatura",
    "defaultSeverity": "warning",
    "description": "倚音通常位于相对强位，以跳进或非准备方式进入，并以级进解决到和弦音；方向由角色参数或上下文确定。",
    "rationale": "教材对自由倚音范围有差异，首版只验证人工标注，不自动判定所有强拍外音。"
  },
  {
    "catalogNumber": "F.7",
    "label": "先现音角色不成立",
    "id": "nonchord.anticipation",
    "defaultSeverity": "warning",
    "description": "当前音在当前和弦中为外音，但在紧邻后继和弦中属于构成音，并由同一声部保持或重复。",
    "rationale": "跨休止或跨越无关和弦不能认作先现。"
  },
  {
    "catalogNumber": "F.8",
    "label": "持续音语境不成立",
    "id": "nonchord.pedal-point",
    "defaultSeverity": "warning",
    "description": "持续音应在 span 起点属于和弦构成，期间可成为和弦外音，并在结束处重新获得明确和声归属；上方声部独立形成可分析和声。",
    "rationale": "主持续音、属持续音和内部持续音可使用不同 profile；持续音期间不以 D.1 重复报警。"
  },
  {
    "catalogNumber": "G.1",
    "label": "逆功能进行",
    "id": "function.retrogression",
    "defaultSeverity": "warning",
    "description": "专用和弦连接器确认前一 span 为 D 类、后一 span 为 S 类，并且不存在序进、共同和弦重解释、转调、持续低音或其他已确认例外时触发。",
    "rationale": "不再使用粗粒度 `FunctionalClass` 字符比较；`D -> S` 只是连接图中的一种违规结果。"
  },
  {
    "catalogNumber": "G.2",
    "label": "离调属功能未进入目标",
    "id": "function.applied-dominant-target",
    "defaultSeverity": "warning",
    "description": "从 interpretation 的 `FunctionalTarget` 建立目标义务，允许同一离调属 span 内转换；离开后首个结构和弦不是目标实体或合法替代时触发。",
    "rationale": "阻碍式解决、插入 `K46` 或延迟解决必须由目标策略显式允许；没有确认 target 时跳过。"
  },
  {
    "catalogNumber": "G.3",
    "label": "重属功能未进入属功能",
    "id": "function.double-dominant-target",
    "defaultSeverity": "warning",
    "description": "重属 span 结束后应进入 `D`、其合法转位/扩展，或作为中介进入 `K46 -> D`；其他目标触发。",
    "rationale": "转调后 `DD` 被共同和弦重新解释时由转调语境接管。"
  },
  {
    "catalogNumber": "G.4",
    "label": "终止四六未进入属功能",
    "id": "function.cadential64-target",
    "defaultSeverity": "error",
    "description": "`K46` 后继结构和弦必须为 D 类，通常保持属音低音，并实现 6-5、4-3 的声部解决关系。",
    "rationale": "中间允许由同一 `K46` span 的转换构成，不能跨休止或无关和弦追认。"
  },
  {
    "catalogNumber": "G.5",
    "label": "阻碍进行目标",
    "id": "function.deceptive-cadence-target",
    "defaultSeverity": "warning",
    "description": "仅在人工确认 `cadenceRole: deceptive` 时，验证后继功能、低音和倾向音处理是否符合阻碍进行 profile。",
    "rationale": "普通 `D -> TSVI` 可以是非终止性连接；没有终止角色时不自动称为阻碍终止。"
  },
  {
    "catalogNumber": "G.6",
    "label": "功能连接语义不足",
    "id": "function.ambiguous-connection",
    "defaultSeverity": "suggestion",
    "description": "和弦实体有效，但前后 interpretation 候选导致不同的合法性结论，且没有人工确认主解释时给出提示。",
    "rationale": "这是需要用户确认的语义提示，不得同时产生任何基于任意候选的功能违规。"
  },
  {
    "catalogNumber": "H.1",
    "label": "D7 解决配置",
    "id": "connection.dominant-seventh",
    "defaultSeverity": "warning",
    "description": "综合检查导音上行、七音下行、共同音保持和目标主和弦的完整/不完整配置；根据 `D7/D56/D34/D2` 分别验证低音走向。",
    "rationale": "本条覆盖同一连接上的通用 E.1/E.2 诊断；阻碍解决和转调使用独立 profile。"
  },
  {
    "catalogNumber": "H.2",
    "label": "D9 解决配置",
    "id": "connection.dominant-ninth",
    "defaultSeverity": "warning",
    "description": "在 `D9 -> T` 或确认目标连接中联合验证九音下行、七音下行、导音上行和目标和弦配置。",
    "rationale": "只处理当前支持的原位 `D9`；覆盖 E.1、E.2、E.3 的同源诊断。"
  },
  {
    "catalogNumber": "H.3",
    "label": "DVII7 解决配置",
    "id": "connection.leading-tone-seventh",
    "defaultSeverity": "warning",
    "description": "依据 `DVII7` 种类、转位和目标调性，逐声部检查倾向音级进与目标和弦允许重复音。",
    "rationale": "减七和弦的等音转调必须先确认新解释，不能沿旧调性误判。"
  },
  {
    "catalogNumber": "H.4",
    "label": "SII7 进入属功能",
    "id": "connection.supertonic-seventh",
    "defaultSeverity": "warning",
    "description": "根据转位和目标类型检查七音下行、共同音与低音走向，并验证后继属于允许的属功能集合。",
    "rationale": "序进中的 `SII7` 可能采用不同解决；由序进语境豁免。"
  },
  {
    "catalogNumber": "H.5",
    "label": "S7 进入属功能",
    "id": "connection.subdominant-seventh",
    "defaultSeverity": "warning",
    "description": "依据 IV 级七和弦的具体转位检查进入 D 类或其他已允许目标时的声部进行。",
    "rationale": "`S7` 不能机械复用 `SII7` 的所有低音与重复规则；需要独立金样本。"
  },
  {
    "catalogNumber": "H.6",
    "label": "DD7 解决配置",
    "id": "connection.double-dominant-seventh",
    "defaultSeverity": "warning",
    "description": "在 G.3 已确认目标成立后，按 D 调性化语境检查变化导音、七音和各转位低音的进行。",
    "rationale": "目标调性改变时重新建立局部调性，不能沿主调拼写判断。"
  },
  {
    "catalogNumber": "H.7",
    "label": "DDVII7 解决配置",
    "id": "connection.double-dominant-leading-tone",
    "defaultSeverity": "warning",
    "description": "按属调的导七和弦解释检查四个倾向音及后继目标配置。",
    "rationale": "等音转调语境优先；与 H.3 共用算法但使用不同局部目标。"
  },
  {
    "catalogNumber": "H.8",
    "label": "N6 连接",
    "id": "connection.neapolitan-sixth",
    "defaultSeverity": "warning",
    "description": "检查第一转位、通常重复低音所代表的调内 IV 级音，并验证降 II 级音按书写方向进入 D 或经 `K46` 进入 D。",
    "rationale": "调式、旋律位置和是否经过 `K46` 会影响声部走向；具体例外待金样本校准。"
  },
  {
    "catalogNumber": "H.9",
    "label": "It+6 连接",
    "id": "connection.italian-augmented-sixth",
    "defaultSeverity": "warning",
    "description": "验证增六两端的反向半音解决，并检查第三个构成音的重复和目标和弦配置。",
    "rationale": "E.5 作为通用父规则，在同一证据上由本条覆盖。"
  },
  {
    "catalogNumber": "H.10",
    "label": "Fr+6 连接",
    "id": "connection.french-augmented-sixth",
    "defaultSeverity": "warning",
    "description": "除增六两端外，检查其特有构成音在目标连接中的保持或级进，防止错误拼写造成假平行。",
    "rationale": "必须按书写音程而非 pitch-class 集合识别。"
  },
  {
    "catalogNumber": "H.11",
    "label": "Ger+6 连接",
    "id": "connection.german-augmented-sixth",
    "defaultSeverity": "warning",
    "description": "检查增六两端解决，并识别直接进入 D 可能形成的平行五度；优先验证经 `K46` 或教材允许的规避进行。",
    "rationale": "真实平行五度仍由 C.2 报错，本条只解释该和弦特有的解决路径，不重复生成同一根因。"
  },
  {
    "catalogNumber": "H.12",
    "label": "阻碍进行的声部配置",
    "id": "connection.deceptive-voice-leading",
    "defaultSeverity": "warning",
    "description": "在 G.5 确认阻碍语境后，验证低音进行、导音解决和目标 `TSVI` 的重复策略。",
    "rationale": "大调、小调和不同 D 形态需要独立样本；本条覆盖通用倾向音诊断的同一证据。"
  },
  {
    "catalogNumber": "H.13",
    "label": "六四和弦进入与离开",
    "id": "connection.second-inversion-context",
    "defaultSeverity": "warning",
    "description": "结合前后 span、低音方向和拍位，验证人工标注的四六类型；经过四六要求低音级进贯穿，辅助四六要求低音保持并回到原和弦。",
    "rationale": "首版只验证人工确认类型，不自动给所有 `T46/S46/D46` 指派用途。"
  },
  {
    "catalogNumber": "I.1",
    "label": "四五度关系共同音保持",
    "id": "connection.common-tone-fourth-fifth",
    "defaultSeverity": "suggestion",
    "description": "两个原位三和弦根音为四度或五度关系，且不存在旋律或功能例外时，检查上方声部是否保持共同音，其余声部是否采用最近进行。",
    "rationale": "这是初级连接法，不得因为未保持共同音而掩盖一个实际合法连接。"
  },
  {
    "catalogNumber": "I.2",
    "label": "二度关系反向进行",
    "id": "connection.second-relation-contrary-motion",
    "defaultSeverity": "suggestion",
    "description": "两原位三和弦根音相差二度且没有共同音时，检查上三声部整体是否采用与低音相反的最近进行。",
    "rationale": "平行五八度由 C.2/C.3 独立判断；旋律给定题可能采用其他合法配置。"
  },
  {
    "catalogNumber": "I.3",
    "label": "三度关系共同音保持",
    "id": "connection.common-tone-third",
    "defaultSeverity": "suggestion",
    "description": "两个三和弦根音为三度关系时，提示保留共同音并使其余声部最近进行。",
    "rationale": "属于基础连接方法而非绝对禁令；不得与声部交换或旋律目标冲突。"
  },
  {
    "catalogNumber": "I.4",
    "label": "不必要的声部大幅移动",
    "id": "connection.nonparsimonious-motion",
    "defaultSeverity": "suggestion",
    "description": "连接器比较满足硬约束的候选配置；当前配置总移动代价显著高于最近进行候选时提示。",
    "rationale": "旋律线、音域调整、同和弦转换、声部交换和后继准备均可构成合理原因；首版不应自动启用。"
  },
  {
    "catalogNumber": "J.1",
    "label": "和声切分",
    "id": "rhythm.harmonic-syncopation",
    "defaultSeverity": "warning",
    "description": "沿 `HarmonySpan` 链比较拍位：一个新和声在弱拍/弱位置进入，延续覆盖下一强拍或相对强位置，随后在弱位置离开时触发。",
    "rationale": "持续音、延留音、同一功能内装饰转换、序进和人工确认的切分节奏可豁免；必须按变拍号的实际重音层级计算。"
  },
  {
    "catalogNumber": "J.2",
    "label": "K46 拍位不当",
    "id": "cadence.cadential64-metric-position",
    "defaultSeverity": "warning",
    "description": "根据当前拍号和小节内重音层级，`K46` 应处于强拍或相对强位置，后继 D 处于相对较弱位置。",
    "rationale": "不同拍号、复拍子和乐句尺度需要节拍 profile；没有可靠节拍信息时跳过。"
  },
  {
    "catalogNumber": "J.3",
    "label": "终止低音不成立",
    "id": "cadence.bass-formula",
    "defaultSeverity": "warning",
    "description": "对已确认的完全、半终止、变格或阻碍终止，检查末端功能和低音级数是否符合该终止类型。",
    "rationale": "只有人工标注或高置信度终止候选才检查；未标注乐句不能仅凭最后两个和弦武断报错。"
  },
  {
    "catalogNumber": "J.4",
    "label": "完全终止的旋律位置",
    "id": "cadence.perfect-authentic-soprano",
    "defaultSeverity": "warning",
    "description": "`cadenceRole` 明确为完全终止时，验证 D-T 均为规定转位，最终 T 为原位且女高音为主音。",
    "rationale": "不完全终止不适用；名称和具体分类需与中文教材术语最终统一。"
  },
  {
    "catalogNumber": "J.5",
    "label": "结束和弦不稳定",
    "id": "cadence.unstable-ending",
    "defaultSeverity": "warning",
    "description": "在闭合终止的 phrase end 联合检查最终功能、转位和所有仍存的规则私有解决状态。",
    "rationale": "半终止、开放终止和未完成练习不适用；具体倾向音仍由其专用规则生成诊断。"
  },
  {
    "catalogNumber": "K.1",
    "label": "调性变化未标注",
    "id": "tonality.unmarked-key-change",
    "defaultSeverity": "suggestion",
    "description": "多个连续 span 的高置信度解释共同指向新调性，且不是短暂离调属或借用和弦时提示用户确认转调。",
    "rationale": "自动分析只能产生候选，绝不写回调号或覆盖人工解释。"
  },
  {
    "catalogNumber": "K.2",
    "label": "共同和弦重解释不一致",
    "id": "tonality.pivot-reinterpretation",
    "defaultSeverity": "error",
    "description": "验证共同和弦 interpretations 映射到相同 identity 和转位，并检查进入侧使用旧调解释、离开侧使用新调解释。",
    "rationale": "实体一致性通常应由模型 validator 阻止；连接方向只在已确认转调时检查。"
  },
  {
    "catalogNumber": "K.3",
    "label": "离调与转调语境冲突",
    "id": "tonality.tonicization-modulation-conflict",
    "defaultSeverity": "warning",
    "description": "局部调性 span、目标功能义务和人工 modulation 标记给出互斥结论时触发语义冲突。",
    "rationale": "不自动选择其中一个解释；依赖该结论的功能规则暂停。"
  },
  {
    "catalogNumber": "K.4",
    "label": "借用和弦来源不一致",
    "id": "tonality.mixture-source",
    "defaultSeverity": "error",
    "description": "依据 `mixture` 来源调式生成规范构成，与 identity 和 designation 比较。",
    "rationale": "变化和弦与借用和弦必须先由结构化语义区分，不能按调外音数量猜测。"
  }
] as const;
