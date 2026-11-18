# SATB 简写与文本谱工具

本工具用于以简洁文本或 TypeScript 接口创建 `.satb` 工程，并将现有工程显示为带精确时间轴的文本谱。它独立于规则测试工作台，可供教材转写、批量生成、调试脚本及后续 MCP 复用。

入口为 [`src/domain/scoreText/index.ts`](../src/domain/scoreText/index.ts)。领域模块不读写文件，也不修改调用者传入的工程；命令行负责文件访问。产品版本和工程 schema 不变，简写采用独立的 `satb 1` 版本。

## 快速使用

在仓库根目录安装依赖后运行：

```powershell
npm run score -- compile StandardCase/Samples/annotated-cadence.satbt --out example.satb --reference-out example.reference.json
npm run score -- render example.satb
npm run score -- render example.satb --from 2 --to 2 --reference-file example.reference.json
npm run score -- validate example.satb
```

也可以直接渲染简写文件：

```powershell
npm run score -- render StandardCase/Samples/annotated-roles.satbt
npm run score -- render StandardCase/Samples/annotated-cadence.satbt --reference
```

`compile` 和 `render` 不指定 `--out` 时输出到标准输出。已有输出文件需要显式 `--force` 才可覆盖，输入文件始终受到保护。`--map-out mapping.json` 导出作者别名、内部 ID 与源码位置的映射。`render --ids` 按需显示真实对象 ID。

需要将 JSON 通过管道交给其他程序时，使用 `node scripts/score.mjs` 或 `npm run --silent score`，避免 npm 自身的命令提示进入标准输出。

CLI 使用仓库现有 Vite SSR 模块加载器运行 TypeScript，不启动应用界面或监听 HTTP 端口，需要开发依赖；当前未封装为安装版应用菜单或 MCP 服务。

## 工程头与小节块

```text
satb 1
title "终止练习"
key C major
meter 4/4
tempo 72
meta source "教材或手工样例来源"
meta page "52"

bars 1..2 {
  S: | E4/2 D4/2 | C4/1 |
  A: | C4/2 B3/2 | G3/1 |
  T: | G3/2 G3/2 | E3/1 |
  B: | C3/2 G2/2 | C3/1 |
  H: | T/2 D/2 | T/1 |
}
```

首个声明必须为 `satb 1`，文件建议使用 `.satbt` 扩展名。默认值为 C 大调、4/4、80 BPM。音符默认力度 88、未锁定。`meta` 是伴随元信息，保存在编译结果的参考文件中，不会写入原生工程的音乐标注。

- `bars 1..4` 包括第 1 至第 4 小节，后续块必须连续且不重复。单块可以包含一个或多个小节，支持每个声部在块内换行；建议长工程每块四小节。
- 每块必须声明 S、A、T、B 四个声部；缺失声部会报错。有意让该块某声部无音符时写 `A: empty`。它表示空轨上的静音，不表示尚未识别的未知音符。
- 每个普通声部行以 `|` 开始并结束，每小节时值必须完整。块和换行只组织书写，不创建乐句边界、终止式或额外休止，也不重置跨块延音。
- `H` 是可选的和弦行；`r/4` 表示该段没有给定和弦。未提供和弦不会自动触发推导。
- 注释使用 `//`，双引号字符串中的 `//` 保留。字符串使用 JSON 双引号转义规则。

`compile` 编译完整工程，当前限制最多一万小节。局部替换使用后述函数接口。

## 音高与时值

音高使用绝对书写音高，例如 `C4`、`F#4`、`E#4`、`Bbb3`，C4 对应 MIDI 60。未标升降号即为还原音，不从调号补升降号；E#4 与 F4 保持不同拼写。支持重升重降，结果必须位于 MIDI 0–127。

| 写法 | 含义 |
| --- | --- |
| `C4/4` | 四分音符 |
| `C4/2`、`C4/1` | 二分音符、全音符 |
| `C4/4.` | 附点四分音符；最多三个附点 |
| `C4/8*2/3` | 三连音八分音符，即四分之一全音符的三分之一 |
| `C4/t320` | 精确 320 tick，适合不常见时值 |
| `r/4` | 四分休止 |
| `C4/2@melody` | 为起奏音符指定作者短别名 |
| `C4/1~` | 与下一事件连接为同一次起奏 |

时值必须能精确表示为 PPQ=960 的整数 tick，工具不会舍入。每个小节独立校验时值，跨小节的长音需拆写并用 `~` 连接：

```text
S: | E#4/1~ | E#4/2 E#4/2 |
```

前两个片段合并为一个持续六个四分音符拍的 NoteEvent，最后一个 E#4 是新的起奏。延音可跨 `bars` 块，必须连续且两端书写音高相同，不能与休止连接。音符 ID 由工具生成，作者别名只用于定位。

## 时间位置与时间事件

位置使用全工程编号 `小节:拍`，拍单位为当前拍号的分母。例如 6/8 中 `1:2` 是第二个八分音符拍。拍内偏移写为 `1:2+1/2`，同样必须落在整数 tick。

范围统一使用左闭右开形式 `[1:1,5:1)`。工程最后一小节之后的 `N+1:1` 仅作为结束边界。

```text
at 3:1 meter 3/4
at 3:1 key F# minor
at 3:2+1/2 tempo 90
```

变拍号必须在内部小节起点；起始值使用工程头。调号、速度可以在工程内部的精确位置变化。同种事件在同一 tick 重复声明会报错。和弦区域遵守原有编辑约束，不能跨越调号变化。

## 已知标注

`annotations` 中的标注会应用到工程，实际影响规则与推导。语法支持属性续行，未知属性、重复属性和失效引用均报错。

```text
annotations {
  chord c1 at=1:1 duration=1/4 symbol=T
  chord c2 at=1:2 duration=1/4 symbol=V64 role=passing64
  chord c3 range=[1:3,2:1) symbol=T6

  note S@1:2 role=passing
  phrase p1 range=[1:1,5:1)
  cadence k1 phrase=p1 range=[4:1,5:1)
    kind=full form=authentic completion=perfect
}
```

上述片段仅展示语法，所在工程需要包含对应音符、范围及完整和弦上下文。

### 和弦标注

和弦使用 `at` 加 `duration`，或者 `range`。`duration=4` 和 `duration=1/4` 均表示四分音符；范围可跨小节。

支持功能记法 T、t、S、s、D、d、SII、DTIII、TSVI、DVII、DD、DDVII、K46、N6、It+6、Fr+6、Ger+6，以及 I、ii6、V7、I64、viio7、V7/II 等级数记法。转位可使用 `64` 或 `6/4`、`65` 或 `6/5` 等。功能记法沿用目录的大小调含义与可用结构，T 与 t 分别表示大、小主和弦。

和弦用途 `role` 可为 `passing64`、`pedal64`、`cadential64`、`deceptive`。局部调性写为 `localKey="G major"`；`confidence` 支持 `certain`、`probable`、`ambiguous`、`unknown`，默认 `certain`，表示调用者明确声明的输入。

H 行也可指定短别名，然后独立补充角色：

```text
H: | T/4 V64/4@passing_chord T6/4 S/4 |

annotations {
  chord passing_chord role=passing64
}
```

重复声明同一属性会报错。H 行已声明的区间无需再次创建重叠和弦。

复杂的变音、持续低音、借用或共同和弦解释可通过 `draft` 传入现有 ChordDraft 的 JSON 字符串，取代 `symbol`；文本中的双引号需转义。函数接口可用 `JSON.stringify(draft)` 构造该字段。该方式复用现有和弦校验，不构建第二套实体模型。

### 音符角色

音符可用作者别名或 `S@3:2` 定位，坐标必须指向起奏，不会把持续中的音符误当成新事件。`role` 支持 passing、neighbor、suspension、retardation、appoggiatura、anticipation、escape、pedal、other，分别对应现有非和弦音角色。还可设置 `velocity=75` 和 `locked=true`。

缺少角色表示未提供该判断，不等同于确认其为和弦音。锁定字段只接受 true/false。

### 乐句与终止式

乐句声明生成实际边界，短名映射到引擎生成的 phraseId。同一标注集中的乐句不能重叠，已知乐句内部不能再包含其他已知边界。

终止式独立携带范围、所属乐句和类型：

- `kind`：full、half、supplementary、deceptive。
- `form`：authentic、plagal。
- `completion`：perfect、imperfect，只用于 full。
- `confidence`：certain 或 probable，默认 certain。
- `locked`：默认 false。

已知终止式必须位于所属乐句内，覆盖连续的完整和弦区域，遵守范围不重叠及调号边界等编辑约束。参考终止式只验证自身范围与语义，可在尚无已知和弦时独立记录答案。

## 独立参考标注

`reference` 复用同一种标注语法，但其数据只进入编译结果的 `reference`，不会写入 `project`：

```text
annotations {
  phrase p1 range=[1:1,3:1)
}

reference complete=cadence {
  cadence k1 phrase=p1 range=[1:3,3:1)
    kind=full form=authentic completion=perfect
}
```

测终止式检测时，乐句和和弦可作为已知条件，终止式放在参考层。测完整结构推导时，待测乐句也放入参考层。工具不自动调用推导，不将参考标注提升为已知事实。

参考层中的和弦短名可以引用已知 H 行和弦，仅在参考结果中补充预期角色。参考中的乐句、和弦、音符角色均在独立副本上解析，不改变输入。

`complete=cadence` 表示作者声明已提供该工程范围内完整的终止式答案集；空块此时可表达“应无终止式”。这不是人工审计批准状态，后者独立记录。未声明 complete 的空集只表示没有提供答案。完整性类型使用单数 chord、note、phrase、cadence，可逗号分隔。工具记录这些声明，具体匹配策略由调用者决定。

参考文件格式为 `satb-score-reference` v1，包含工程 ID、时间范围、完整性声明、伴随元信息及解析后的标注。CLI 将其单独输出；渲染原生工程时核对工程 ID 和时间范围。每次重新编译会生成新工程 ID，应保存同一次编译产生的工程和参考文件配对使用。参考文件不包含测试目标规则或测试断言。

## 文本谱

文本谱包含绝对位置、四声部和 H 行。音名带时值表示起奏，`~E#4` 表示原音保持，`r` 表示静音，H 行的 `?` 表示没有给定和弦。

列包括各拍、音符起止和和弦边界，复杂节奏以精确分数位置显示，不会量化到四分拍。默认每组四小节，每行最多十六个时间列，长行继续分页并写明结束位置。`fromBar`/`toBar` 仅限制视图，不裁剪源工程；跨视图的标注仍显示完整范围。

网格后输出和弦用途、非和弦音、已保存乐句边界及终止式范围。只有显式提供参考对象或 CLI 使用 `--reference`/`--reference-file` 才显示 REFERENCE 区域。辅助轨只报告存在及音符数量，不并入 SATB 网格。

这是只读检查视图，不是可重新导入的完整工程格式，不承诺还原教材排版或证明原始识谱正确。

## TypeScript 接口与局部修改

```ts
import { compileScore, compileScoreText, renderScoreText, replaceScoreBlock } from "./src/domain/scoreText";

const result = compileScore({
  version: 1,
  title: "脚本生成",
  key: "F# minor",
  blocks: [{
    from: 1,
    to: 1,
    voices: { S: "| E#4/1 |", A: "empty", T: "empty", B: "empty" },
  }],
  annotations: [{ kind: "note", name: "S@1:1", fields: { role: "passing" } }],
});

const project = result.project;
const text = renderScoreText(project, { fromBar: 1, toBar: 1 });
const next = replaceScoreBlock(project, {
  from: 1,
  to: 1,
  voices: { S: "| F#4/1 |", A: "empty", T: "empty", B: "empty" },
}).project;
```

`compileScoreText` 从字符串编译，`parseScoreText` 可只解析语法并查看源码位置。编译结果还包含已知标注集、作者短名映射和音符源码位置。

`replaceScoreBlock` 在副本中替换指定小节的四个声部，保留标题、音频、规则配置及其他区间。尊重轨道、音符和练习范围锁定，跨替换边界的长音需扩大范围后再改。省略 H 时保留原和弦；提供 H 时替换区间和弦，拒绝锁定或跨界和弦，并将相交的原终止标注标为过期。函数返回新工程，调用方负责一次性提交历史和更新 revision，旧工程可用于撤销。

## 与规则测试的连接

使用工具生成普通 ProjectDocument 后，可另行传给现有规则用例工厂或推导函数。工具层不依赖 harmony/testing。规则用例工程投影现在保留 `structure`，旧用例缺少该可选字段时恢复为空边界，避免丢失影响判断的已知乐句。

示例 [annotated-cadence.satbt](../StandardCase/Samples/annotated-cadence.satbt) 用独立参考层保存终止式答案；[annotated-roles.satbt](../StandardCase/Samples/annotated-roles.satbt) 展示经过四六与经过音的已知标注。二者为手工工具示例，不是教材识谱结果。
