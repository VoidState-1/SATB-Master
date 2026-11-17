# SATB Master Agent 协作规范

本文件记录面向 AI Agent 与项目协作者的仓库级执行约定。项目架构、数据模型与验证规范详见 [开发者文档](./Docs/README.md)。

---

## Git 提交信息约定

所有提交均须遵循基于 Conventional Commits 的双语规范格式，禁止使用中文全角标点或非标准类型。

### 1. 基本格式

```text
<type>(<scope>): <subject>

<body>

<footer>
```

#### 格式要求
1. **符号必须使用英文半角**：`<type>`、`<scope>` 之间的括号与冒号必须为半角，冒号后固定留 **1 个空格**（如 `fix(pitch): ...`，禁止 `fix：...`）。
2. **`<type>` 与 `<scope>` 全部小写**：多词作用域统一使用 `kebab-case`（如 `score-preview`、`voice-leading`）。
3. **原子化提交**：`<subject>` 只概括一件事，控制在 **50 个字符以内**，末尾**不加句号**；多项改动拆分为多次提交，或将细节放入 `<body>` 列表。
4. **语言约定**：`<type>` 与 `<scope>` 使用英文，`<subject>` 与 `<body>` 优先使用简体中文（专有术语如 `K46`、`VexFlow`、`schema v3`、`SATB` 保持英文）。

### 2. `<type>` 类型列表

| Type | 用途说明 |
| --- | --- |
| `feat` | 新增功能（新规则、推导能力、交互功能、导出格式等） |
| `fix` | 修复缺陷（和声误报/漏报、推导错误、UI 异常、持久化问题等） |
| `refactor` | 代码重构（不改变外部行为的结构或接口调整） |
| `perf` | 性能优化（画布渲染、分析缓存、长工程重检耗时等） |
| `test` | 测试相关（单元测试、`RuleCases` 金样本、`StandardCase` 基准、E2E） |
| `docs` | 文档变更（`Docs/`、`DesignDocs/`、`README.md`、`Agents.md`） |
| `style` | 纯样式或格式调整（CSS 视觉微调、排版整理，不影响业务逻辑） |
| `build` | 构建、打包与依赖变更（Vite、Electron Builder、安装包、`package.json` 依赖） |
| `chore` | 杂项维护（版本发布、脚手架、Git/工具配置等） |
| `revert` | 回滚既有提交（标题写 `revert: <原提交标题>`，正文注明原因与原 commit hash） |

### 3. `<scope>` 作用域列表

`<scope>` 为可选项；改动集中在单一模块时建议填写，跨多个模块时可省略。

| 分类 | 推荐 Scope | 对应目录 / 职责 |
| --- | --- | --- |
| **核心和声领域** | `pitch` | `src/domain/pitch`（音高、同音异名拼写） |
| | `chords` | `src/domain/chords`、`chordModel`、功能目录 |
| | `rules` | `src/domain/harmony/rules`（内置规则、Query API、`RuleProfile`） |
| | `voice-leading` | 声部进行、平行/反向五八度、解决类规则 |
| | `inference` | `src/domain/harmony/inference`（自动和弦推导） |
| | `cadence` | `src/domain/harmony/phrase`、`cadence`（乐句分割与终止式推断） |
| | `external-rules` | `src/domain/harmony/external`（外置规则 API、QuickJS 沙箱） |
| | `project` | `src/domain/project`（工程模型、校验、schema 迁移） |
| | `rhythm` / `musicxml` / `notation` | 节拍强弱、MusicXML 导出、记谱模型 |
| **前端界面** | `editor` | `src/features/editor`（钢琴卷帘、音符/和弦轨交互） |
| | `score-preview` | `src/features/scorePreview`（VexFlow 五线谱预览） |
| | `chord-inference` | `src/features/chordInference`（和弦推导引导界面） |
| | `rule-testing` | `src/features/ruleTesting`（规则测试工作台） |
| | `diagnostics` / `inspector` / `settings` / `ui` | 诊断面板、检查器、设置、通用 UI |
| **桌面与音频** | `audio` | `src/audio`、SoundFont、MIDI 输出与回放 |
| | `desktop` | `electron/`、IPC、窗口与原生文件对话框 |
| **测试与发布** | `rule-cases` | `RuleCases/`（单规则金样本） |
| | `standard-case` | `StandardCase/`（和弦与终止式基准测试集） |
| | `e2e` / `release` / `deps` | 桌面端 E2E、版本发布、依赖更新 |

### 4. 正文（Body）与页脚（Footer）

- **Body（复杂改动建议填写）**：说明**修改原因**（音乐学依据、Bug 根因）与**改动边界**（如保守降级策略、豁免条件），多项细节用 `- ` 分点列出，不把多句堆进标题。
- **Footer（按需填写）**：
  - **破坏性变更**：修改 `.satb` schema、外置规则 API 或用例格式时，在 `<type>` 或 `(<scope>)` 后加 `!`，并在 Footer 写明 `BREAKING CHANGE: ...`。
  - **关联追踪**：`Refs: #123` / `Closes: #45`。

### 5. 提交示例

```text
# 推荐写法
feat(cadence): 支持识别省略五音的完满全终止

fix(inference): 修正属七和弦与主和弦的省略音识别

- 允许属七和弦在标准四声部配置下省略五音
- 修复乐句末端 D -> T 连接中根音三重奏被误判的问题

test(standard-case): 补充斯波索宾上册 L1-L2 黄金评测样本

feat(project)!: 升级工程文件 schema 至 v4

BREAKING CHANGE: 新增 phraseBoundaries 必填版本号字段，需通过 v3ToV4 迁移器读取旧工程。

chore(release): 发布 v2.2.1 正式版
```

```text
# 禁止写法
fix：修复了无法识别七音延期解决的问题           # 禁止中文冒号，且缺少空格
feat(UI): 更新了规则面板的UI设计                 # scope 应小写（ui），避免重复表述
fix：修复属七省略五音的问题 修复终止处主和弦问题   # 禁止在标题中堆叠多项改动
release: V2.2.0正式版                           # 禁止非标准 type，应使用 chore(release)
```
