# `src` 架构重构状态

本文是 `DesignDocs/src-architecture-refactoring-plan.md` 的执行验收表。阶段只有在目录边界、内部依赖和行为验证同时满足时才算完成。

| 阶段 | 当前状态 | 已完成 | 尚未完成的验收条件 |
| --- | --- | --- | --- |
| R1 和声规则 | 基本完成 | analysis、runtime、registry、规则组、共享事实、连接器、适用性与仲裁已收敛到 `domain/harmony`；根级旧 facade 已删除 | 规则实现仍按后续规则重写计划逐批替换，目录中未实现条目不代表规则已完成 |
| R2 工程模型 | 基本完成 | schema、默认值、选择器、规范化、校验、V2 -> V3 迁移已进入 `domain/project`；内部调用已迁移到 project 入口，旧 facade 已删除 | 后续新增领域模块必须直接使用 `domain/project` 公共入口 |
| R3 设置与属性面板 | 基本完成 | `features/settings`、`features/inspector`、诊断和开发者面板已建立并有公共入口 | 后续可继续细分组合文件，但不再把它们放回 `components` |
| R4 App 编排 | 基本完成 | 文件、播放、和声、编辑和确认控制器已提取，AppShell 通过 feature 入口组合 | `useEditorCommands` 仍是多个命令 Hook 的组合层；完整桌面流程需 E2E 验证 |
| R5 钢琴卷帘 | 基本完成 | 统一视口几何、交互 Hook、轨道层、播放头层和 feature 样式已建立 | `useCanvasPan` 独立 Hook 尚未建立；长工程性能与播放头需桌面手工回归 |
| R6 样式与边界 | 基本完成 | 根样式为聚合入口；feature 公共入口、domain facade 边界和依赖架构测试已建立 | 后续新增 feature 必须继续从公共入口导出，完整桌面 E2E 仍按发布阶段执行 |

## 本轮收尾顺序

1. 已迁移 feature 专属组件并建立公开 feature 入口。
2. 设置、属性面板和钢琴卷帘的内部职责拆分已由既有提交完成。
3. 已将内部领域导入迁移到 `project` 与 `harmony` 公共入口，并删除没有调用方的根级 facade。
4. 已将边界检查扩展为依赖规则检查；后续以测试、构建和桌面 E2E 作为收尾验证。

文件规模只是提示信号，不作为机械拆分标准；每次拆分必须对应独立职责、变更原因或测试边界。
