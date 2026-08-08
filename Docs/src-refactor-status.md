# `src` 架构重构状态

本文是 `DesignDocs/src-architecture-refactoring-plan.md` 的执行验收表。阶段只有在目录边界、内部依赖和行为验证同时满足时才算完成。

| 阶段 | 当前状态 | 已完成 | 尚未完成的验收条件 |
| --- | --- | --- | --- |
| R1 和声规则 | 部分完成 | 内置规则已按组拆分，`harmony.ts` 不再承载单条规则实现 | analysis、runtime、diagnostics、external 仍未收敛到 `domain/harmony`；旧领域文件仍被内部直接依赖 |
| R2 工程模型 | 基本完成 | schema、默认值、选择器、规范化、校验、V2 -> V3 迁移已进入 `domain/project` | 内部调用仍大量从 `domain/model.ts` facade 导入，尚未完成正式入口迁移 |
| R3 设置与属性面板 | 部分完成 | feature 目录和少数子编辑器已建立 | `SettingsDialog`、`Inspector` 仍是大型组合文件；诊断、外置规则和开发者面板仍位于 `components` |
| R4 App 编排 | 部分完成 | 文件、播放、和声、编辑和确认控制器已提取 | `AppShell` 仍混合界面、领域查询和工作流组装；`useEditorCommands` 混合多个编辑域；缺少正式 project controller |
| R5 钢琴卷帘 | 部分完成 | 统一视口几何和回归测试已建立 | 交互 Hook、轨道渲染层、播放头层和 feature 样式仍集中在 `PianoRoll` |
| R6 样式与边界 | 部分完成 | 根样式已变为聚合入口，架构测试和架构文档已建立 | 样式仍按旧文件连续切分；内部仍使用旧 facade；架构测试尚未覆盖 feature、components 和 facade 依赖规则 |

## 本轮收尾顺序

1. 迁移 feature 专属组件并建立公开 feature 入口。
2. 拆分设置、属性面板和钢琴卷帘的内部职责。
3. 迁移内部领域导入，最后删除没有调用方的 facade。
4. 将边界检查扩展为依赖规则检查，再运行完整验证。

文件规模只是提示信号，不作为机械拆分标准；每次拆分必须对应独立职责、变更原因或测试边界。
