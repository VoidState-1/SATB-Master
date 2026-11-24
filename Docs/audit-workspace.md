# 可视化教材审计区

工具栏的 **教材审计** 打开内置的独立审计工作区（自 3.0.0 系列起已作为标准内置功能提供）。模型提交原图、生成的工程、分析和预审问题，人工对照查看、试改工程并填写意见。返回普通工程后，原编辑会话保留。

桌面端支持从快捷方式或命令行直接打开审计包，例如 `"SATB Master.exe" --audit-package "<path-to-batch>.satb-audit.json"`。再次用同一入口打开时会恢复已保存的意见。

本功能不运行推导/规则检查、不自动执行修复、不自动将用例入库，专注承担人工审阅、意见往返与整谱核准工作。

## 左侧目录、筛选与快捷键

左侧「审计目录」按谱例分组列出条目，顶部显示总体进度条与各结论计数（已作答、已认可、补证、未认可、待审）：

- **搜索与 4 维筛选**：支持按条目标题、谱例标题或 `ruleId` 实时搜索，并可展开 4 维筛选（谱例、层级 `severity`、状态、类型 `category`）与一键清除。
- **按谱例折叠与窄屏抽屉**：每个谱例分组可折叠/展开（显示该谱例的转写复核状态与完成计数；变更搜索或筛选条件时自动展开匹配项）；窄屏下目录收起为侧滑抽屉，通过标题栏「审计目录」按钮或 `Escape` 开关。
- **工作台快捷键**（标题栏键盘图标可随时查看）：
  - `Alt+↑` / `Alt+↓`：切换筛选列表中的上一条 / 下一条。
  - `1` / `2` / `3`：切换「原谱 / 转写谱 / 钢琴卷帘」（焦点位于输入控件或钢琴卷帘编辑器内时不拦截）。
  - `C`：有原图时切换并排对照视图。
  - `Space`：试听 / 暂停当前视图的谱面播放。
  - `Ctrl+Enter`（审阅面板内）：提交当前答案并跳至下一条待审条目。

## 中间的谱面与依据

打开条目时，光标位于争议范围的起点。[`AuditEvidenceWorkspace.tsx`](../src/features/audit/AuditEvidenceWorkspace.tsx) 的 `initialAuditView` 按条目性质自动选择初始视图：

- `category === "transcription"` 且存在原图 -> **原谱 (`source`)**；
- `category === "diagnostic"` 且 `program.ruleId` 匹配声部进行类规则（`/parallel|contrary|crossing|overlap|voice-leading/i`） -> **钢琴卷帘 (`roll`)**；
- 其余条目（如和弦、终止式、策略、方案或无原图识谱） -> **转写谱 (`score`)**。

可随时切换视图，或勾选对照在同一拍并排查看两份谱面：

- **原谱（[`AuditSource.tsx`](../src/features/audit/AuditSource.tsx)）**：支持 **60%–200%**（步进 10%）缩放与范围框聚焦；当开启范围聚焦且当前活跃拍/谱行落在 `sourceRegion` 之外时，自动将裁剪视窗切换至当前活跃谱行，避免跨行跳拍时丢失定位。带拍点坐标的谱图可以直接点击跳拍；旧包只有范围框时按框定位。
- **转写谱（[`AuditScore.tsx`](../src/features/audit/AuditScore.tsx)）**：默认采用**局部小节窗口**（围绕条目范围前后各留上下文，最多显示 8 小节；光标移出局部窗口时自动切换至光标附近 3 小节），并通过工具栏按钮在「查看全谱 / 问题附近」间切换。点音符触发单音预听（`audioEngine.previewNote`）并移动共享光标，点拍位标记或空白处同步跳拍，支持针对条目争议范围的循环试听。
- **钢琴卷帘（[`AuditProjectEditor.tsx`](../src/features/audit/AuditProjectEditor.tsx)）**：显示音高、时值和重叠关系，每个条目拥有独立的工程快照与撤销历史（基于 `useProjectHistory`），可编辑、撤销、重做、还原和单独导出 `.satb`。
- **试听联动（[`useAuditPlayback.ts`](../src/features/audit/useAuditPlayback.ts)）**：封装主播放控制器；在任意视图或拍位控制栏手动跳拍时，自动停止当前试听（详见 [audio-midi-and-time.md](./audio-midi-and-time.md)）。
- **逐拍检视与转写复核**：谱面下方列出当前发声的四个音（含延续音），分别标明工程和弦、随包模型标注与程序推导来源，可点标注范围跳至起拍或展开教材依据与运行说明。「转写复核」用于查看只读基准、核准整个谱例；条目答案与整谱核准分别保存。

## 右侧的备选意见、自填答案与底栏状态

每个疑点通常设一道单选题，每个选项说清一种音乐判断。旧包中的多选题、文字题与已存回答仍可使用。模型可标出建议，人工作答前保持未选。

选择备选意见，或在「自填答案」写下自己的判断，然后提交（或按 `Ctrl+Enter`）。自填可以替代预设答案。普通回答记为 `answered`；非 `proposal` 条目额外提供「**请模型补证**」快捷按钮直接记为 `needs-evidence`；无预设问题的 `proposal` 修复方案提供批准、拒绝和补证三个明确选项，只有显式批准才记为 `accept`。提交后跳至当前筛选下的下一条待审意见，可返回撤回或改答。

切换谱面保留拍点和草稿。问答、已提交意见和条目副本自动保存到本机 IndexedDB；底栏实时显示自动保存状态（正在保存 / 已自动保存 / 保存失败提示）、已审与转写核准计数以及「审计人」输入框。点击「导出意见」生成 `.audit-feedback.json` 供模型读取，若仍存在待审条目、未核准谱例或未填写审计人，会在导出提示中一并提醒；重导同版本可恢复。

## 模型提交: v2 清单与工程附件

新提交使用 `satb-audit-manifest` v2，**必须附生成的 `.satb` 工程文件**。可先用 [简写接口](./score-text.md) 编写并编译，再填写 `projectFile`。清单、当前 schema v3 工程和裁图都放在本地忽略目录，如 `StandardCase/Pilot/<批次>/`。

以下仅为协议示例，路径对应文件由提交者提供，不代表核准教材用例：

```json
{
  "format": "satb-audit-manifest",
  "formatVersion": 2,
  "id": "batch-example",
  "title": "教材待审批次",
  "cases": [
    {
      "id": "example-a",
      "title": "谱例 A",
      "projectFile": "input.satb",
      "source": {
        "title": "教材名称及版本",
        "locator": "PDF页码 / 书内页码 / 题号",
        "imageFile": "source.png",
        "beatAnchors": [
          { "position": "7:2", "x": 0.42, "top": 0.14, "bottom": 0.40 },
          { "position": "7:3", "x": 0.58, "top": 0.14, "bottom": 0.40 }
        ]
      },
      "items": [
        {
          "id": "issue-1",
          "title": "此连接是否符合内声部例外？",
          "category": "diagnostic",
          "severity": "warning",
          "range": [
            "7:2",
            "9:1"
          ],
          "voices": [
            "alto"
          ],
          "model": {
            "conclusion": "可能属于允许的写法，待人工核对",
            "reason": "列出实际音高、和弦及适用条件。"
          },
          "program": {
            "conclusion": "实际诊断消息或执行阻塞情况",
            "ruleId": "resolution.leading-tone",
            "run": "程序版本/提交、规则档、运行标签和日期"
          },
          "questions": [
            {
              "id": "spelling",
              "type": "single",
              "label": "原谱与工程的音符是否一致？",
              "required": true,
              "options": [
                {
                  "id": "yes",
                  "label": "一致"
                },
                {
                  "id": "uncertain",
                  "label": "仍需核对"
                }
              ],
              "suggested": "yes"
            },
            {
              "id": "conditions",
              "type": "multiple",
              "label": "符合哪些条件？",
              "options": [
                {
                  "id": "inner",
                  "label": "内声部"
                },
                {
                  "id": "complete",
                  "label": "完整主和弦"
                }
              ],
              "suggested": [
                "inner",
                "complete"
              ]
            },
            {
              "id": "followup",
              "type": "text",
              "label": "需要模型跟进什么？",
              "placeholder": "补证或适用边界",
              "suggested": "补充该结尾位置是否适用的教材依据"
            }
          ],
          "evidence": [
            {
              "title": "斯波索宾教材具体版本",
              "locator": "章节、书内页、PDF页与例号",
              "content": "依据要点、适用边界与未证明之处。"
            }
          ],
          "question": "请裁定该例外是否在当前严格档适用。"
        }
      ]
    }
  ]
}
```

谱例的 `projectFile` 是基准工程。条目可以另设 `projectFile`，附一个不同的模型工程；省略时，打包器从基准展开独立副本。可为不同疑点提供不同标注或候选写法。

```powershell
npm run score -- compile input.satbt --out input.satb
npm run audit -- pack manifest.json --out batch.satb-audit.json
npm run audit -- validate batch.satb-audit.json
npm run audit -- feedback batch.satb-audit.json opinions.audit-feedback.json
```

相对路径以清单目录为基准。`pack` 不覆盖已有输出，旧版本应保留。审计命令不运行推导/规则检查。编译或标注被阻塞时，记录阻塞与未执行的检查，不修改规则绕过。

## 审计包 v2 字段

打包格式为 `satb-audit-package` / `formatVersion: 2`，包含 `id`、`title`、`cases`。每例必须有完整 `project`，每条 `item` 也必须有自己的完整 `project`；打包器读取附件并内嵌，模型无需手写工程 JSON。

`source.imageFile` 读取为内嵌 `source.image` data URL，仅支持 PNG/JPEG/WebP。可省略图片，但界面会说明不能仅凭重绘谱面核准识谱；不接受远程图片、文件 URL 或 SVG。

`source.beatAnchors` 可省略。`position` 使用工程的小节:拍，`x` 是音符列的横坐标，`top`、`bottom` 是所属谱行的上下边界。坐标均以整张图归一化到 0..1。只标能从原图核实的位置。同行两个锚点之间只定位至谱行。

| 条目字段 | 约定 |
| --- | --- |
| `id`, `title` | 同例内 ID 唯一且稳定，标题直接陈述问题 |
| `project` | 本条完整 schema v3 工程，由打包器填入 |
| `category` | `transcription` / `chord` / `cadence` / `diagnostic` / `policy` / `proposal` |
| `severity` | `error` / `warning` / `suggestion` / `info`，不与人工归因混用 |
| `range` | `[开始,结束]`，左闭右开，按本条工程定位；拍点语法同 `.satbt`，最后小节后的 `N+1:1` 可作终点 |
| `voices` | 可选 `soprano`、`alto`、`tenor`、`bass` 数组，省略或空数组为全部 |
| `model` | 必需 `conclusion` 和 `reason`，对应简短判断与理由 |
| `program` | 可选实际 `conclusion`、`ruleId` 与运行来源 `run`，失败或未运行明确记录 |
| `questions` | 预审数组，每题有唯一 `id`、`label`、`type`，可加 `required`、`placeholder`、`suggested` |
| `annotations` | 可选随包标注数组，每项有 `source`（`model` / `program`）、`kind`（`chord` / `cadence`）、`range` 和简短 `label`。可用 `context` 注明推导输入，如“给定和弦与乐句” |
| `evidence` | 可选数组，每项有 `title`，可加 `locator`、`content`、http/https `url` |
| `question` | 保留原有的待裁定说明，可与表单同时使用 |
| `sourceRegion` | 可选 `{x,y,width,height}`，为裁图宽高的 0..1 比例，用于框选和聚焦，不代替音乐位置 |

单选/多选题须有 `options: [{id,label}]`，选项 ID 唯一。单选建议为选项 ID，多选建议为 ID 数组，输入题建议为字符串。每条最多 100 题，每题最多 50 选项。可提供“不确定/需补证”，避免将理论争议强迫成错误二选一。

文件上限 32 MB，最多 200 例、5000 条目，每例最多 1000 条。附件使包变大，应按题目拆批。无条目的谱例仍可看基准工程，但编辑只归属于具体条目。

## 人工反馈 v2

反馈为 `satb-audit-feedback` / `formatVersion: 2`，有 `packageId`、`reviewer`、`cases`。每例有 `id`、内容 `fingerprint`、基准转写记录 `source` 和条目 `items`。条目记录示例：

```json
{
  "id": "issue-1",
  "fingerprint": "64位SHA256内容指纹",
  "decision": "needs-evidence",
  "attribution": "policy",
  "comment": "请核对结尾位置是否适用",
  "answers": [
    {
      "id": "spelling",
      "value": "yes"
    },
    {
      "id": "conditions",
      "value": [
        "inner",
        "complete"
      ]
    },
    {
      "id": "followup",
      "value": "补充具体教材例号"
    }
  ],
  "updatedAt": "2026-11-17T12:00:00.000Z"
}
```

人工编辑后，记录另含完整 `project` 快照。未修改的工程取审计包对应附件。模型同时读取包与反馈，即可取得原提交、问答、人工判断及修改工程；当前副本也能单独导出 `.satb`，再用 `npm run score -- render` 显示对齐文本谱。

- `decision` 支持 `pending`、`answered`、`accept`、`reject`、`needs-evidence`。`answered` 表示人工已作答，与模型是否正确、方案是否获批各自独立。读取这种反馈需使用支持 `answered` 的版本。
- `attribution`：`uncertain`、`program`、`transcription`、`reference`、`policy`、`context`、`none`。
- `answers[].value`：单选 ID、多选 ID 数组或输入字符串。无效选项、重复回答、必填未答的批准记录不能恢复为有效审批。
- 基准工程或来源变更使对应核准和意见失效；单条工程、分析、问题、建议或依据变更仅使本条失效。
- 修改人工回答或工程副本使本条退回待审，内容仍保留。原转写核准及其他条目不受影响。
- 本机按包版本保存，新版不覆盖旧版记录。其他批次反馈被拒绝；过期记录不套用到新内容，并报告未采用数。

审计文件与工程副本留在本地忽略目录，最终核准并验证的用例才进入 `StandardCase/Verified/`。

## v1 兼容与实现入口

旧 v1 包仍可导入，由 `score` 编译临时工程并为各条克隆副本，新提交应使用含附件的 v2。旧 v1 清单的 `scoreFile` 可过渡打包为 v2，自动生成快照；v2 清单必须用 `projectFile`。v1 意见仍按原指纹读取，换成新工程附件后需重新核准。

- [`src/domain/audit/`](../src/domain/audit/index.ts)：格式校验、逐条工程隔离、定位、问答、指纹及意见恢复。
- [`src/services/audit.ts`](../src/services/audit.ts)：文件往返、SHA256、IndexedDB 存储。
- [`src/features/audit/`](../src/features/audit/index.ts)：选项卡、卷帘、试听封装（`useAuditPlayback.ts`）、预审与审计；复用 editor、inspector、scorePreview 公共入口。
- [`scripts/audit.mjs`](../scripts/audit.mjs)：附件打包、校验和反馈读取。
- [`scripts/e2e-audit.mjs`](../scripts/e2e-audit.mjs)（`npm run e2e:audit`）：
  - 默认模式使用合成工程在隔离 `userData` 验证附件、三视图拍点、问答、独立编辑、导出恢复、宽窄布局及版本失效，不依赖外部教材；也可附加一个本地审计包路径作为可选参数检查真实布局，产物输出到忽略目录 `node_modules/.satb-audit-e2e/`。
  - 启动回归模式支持 `node scripts/e2e-audit.mjs --startup-package <pkg> [--exe <exe>]`，验证通过 `--audit-package` 命令行直达审计工作台、自动保存草稿与重启恢复。
  - 两种模式末尾均执行 [`scripts/e2e-session-logs.mjs`](../scripts/e2e-session-logs.mjs) 的 `assertCleanSessionLogs`，作为 JSONL 会话日志的零未预期错误门禁（见 [logging-and-observability.md](./logging-and-observability.md)）。

本地试运行审计包与中间草稿（如 `<batch-dir>/<batch>.satb-audit.json`）均留在忽略目录中，不直接作为核准用例入库。图片批量导出与外部协议集成仍为后续工作。
