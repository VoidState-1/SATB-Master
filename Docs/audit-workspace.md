# 可视化教材审计区

工具栏的 **教材审计** 打开独立工作区。模型提交原图、生成的工程、分析和预审问题，人工对照查看、试改工程并填写意见。返回普通工程后，原编辑会话保留。

本功能不运行推导/规则检查、不自动执行修复、不自动将用例入库。识读与分析仍按 [两阶段工作流](./textbook-case-workflow.md) 完成，审计区负责人工审阅和意见往返。

## 中间的两个选项卡

- **谱面对照**将教材原图与模型判断放在一起，将转写五线谱与程序结果放在一起。先读条目标题和待裁定问题，再核对相应的谱段和参考依据。原图支持缩放和按橙框聚焦，转写的相关音符标绿，支持单音或循环试听。编辑过副本时，五线谱显示当前副本。
- **钢琴卷帘**可查看和编辑本条工程，支持声部切换、网格、缩放、撤销重做与播放。分析依据随当前条目显示。可导出当前副本为 `.satb`，或恢复本条提交的工程。

每条审计条目有独立工程快照，即使多条意见引用同一个文件，也不共享编辑状态。修改只保存到当前条目的反馈副本，不覆盖模型提交、其他条目或普通编辑工作区。撤销/重做覆盖本次进入工程页后的编辑会话；切换条目后仍恢复已保存内容。

从谱面视图旁的 **谱例转写复核** 打开基准工程与核准表单。核准针对整个谱例，单独保存。修改条目副本不会自动修改这项核准。改变工程或预审回答会使本条已有决定退回待审，需重新确认；文字备注可以继续补充。审计范围按本条原提交定位。

## 右侧预审与人工意见

右侧直接显示当前条目的预审题和人工结论。可以一边查看中间的谱面与依据，一边作答。顶部箭头按当前筛选顺序切换条目。

模型可设置 **单选、多选、输入题**，标记必填并给出建议答案。

1. 模型建议单独显示，初始不计为人工回答。可逐题采用，或点击 **填入未作答项**；后者保留已填写的人工回答。
2. 问答与最终结论分开。必填题未完成时不能认可判断或批准方案，但仍可选“需要补证”或不认可。
3. 普通条目记录判断、归因和意见；仅 `proposal` 显示“批准此修复方案”。认可模型判断、核准转写、批准方案互不自动联动。
4. 问答、意见和工程副本自动保存到本机 IndexedDB。**导出意见** 生成 `.audit-feedback.json` 供模型读取；**导入意见** 恢复同版本的明确记录，保留未涉及条目的判断。同条目导入的明确记录替换当前值，包括有更新时间的显式清空。

审计目录按谱例分组，窄窗口可从标题栏打开。展开搜索框旁的筛选按钮，可按谱例、原始严重程度、类型、待审/需补证/已认可等状态筛选。原始层级与人工归因分开记录。缺少原图或适用依据时，应要求补证。

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
        "imageFile": "source.png"
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

- `decision`：`pending`、`accept`、`reject`、`needs-evidence`。
- `attribution`：`uncertain`、`program`、`transcription`、`reference`、`policy`、`context`、`none`。
- `answers[].value`：单选 ID、多选 ID 数组或输入字符串。无效选项、重复回答、必填未答的批准记录不能恢复为有效审批。
- 基准工程或来源变更使对应核准和意见失效；单条工程、分析、问题、建议或依据变更仅使本条失效。
- 修改人工回答或工程副本使本条退回待审，内容仍保留。原转写核准及其他条目不受影响。
- 本机按包版本保存，新版不覆盖旧版记录。其他批次反馈被拒绝；过期记录不套用到新内容，并报告未采用数。

审计文件与工程副本留在本地忽略目录，最终核准并验证的用例才进入 `StandardCase/Verified/`。

## v1 兼容与实现入口

旧 v1 包仍可导入，由 `score` 编译临时工程并为各条克隆副本，新提交应使用含附件的 v2。旧 v1 清单的 `scoreFile` 可过渡打包为 v2，自动生成快照；v2 清单必须用 `projectFile`。v1 意见仍按原指纹读取，换成新工程附件后需重新核准。

- `src/domain/audit/`：格式校验、逐条工程隔离、定位、问答、指纹及意见恢复。
- `src/services/audit.ts`：文件往返、SHA256、IndexedDB 存储。
- `src/features/audit/`：选项卡、卷帘、预审与审计；复用 editor、inspector、scorePreview 公共入口。
- `scripts/audit.mjs`：附件打包、校验和反馈读取。
- `npm run e2e:audit`：使用合成工程在隔离 userData 验证附件、问答、独立编辑、导出恢复及版本失效，不依赖教材。真实包可作可选参数检查布局，产物在忽略的 `node_modules/.satb-audit-e2e/`。

首批本地 v2 包为 `StandardCase/Pilot/2026-11-17/pilot-v2.satb-audit.json`，有三例、14 条待审意见及工程附件。旧包与中间资料保留，均未成为最终核准用例。图片批量导出和 MCP 服务仍为后续工作。
