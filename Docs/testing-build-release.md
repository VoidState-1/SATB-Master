# 测试、构建与发布

本文说明 SATB Master 的验证层级、构建脚本、Windows 桌面流程和发布检查。架构边界见 [architecture.md](./architecture.md)，桌面持久化见 [desktop-and-persistence.md](./desktop-and-persistence.md)。命令以 [`package.json`](../package.json) 为准。

## 1. 验证原则

测试范围按改动风险决定，但正式发布需要完整矩阵。项目跨越纯领域逻辑、React、AudioWorklet、QuickJS、Electron 主进程和 Windows 安装包，单一测试类型无法覆盖全部风险。

验证结果应明确分为：

- **已验证：** 本次实际执行并通过的命令或手工流程。
- **未验证：** 因环境、权限、时间或硬件未执行的项目。
- **环境失败：** 应用/测试基础设施没有启动成功，尚未运行断言。
- **断言失败：** 流程已运行，实际行为与预期不符。

不能把“历史上曾通过”写成本次通过，也不能把 Electron GPU 子进程崩溃等环境启动失败描述成产品断言失败。

## 2. 日常验证命令

```powershell
npm test
npm run typecheck
npm run build
```

### 2.1 `npm test`

运行 Vitest。测试文件与源码相邻，覆盖重点包括：

- 工程模型、validator 和 v2 -> v3 迁移。
- 编辑命令、锁定区、批量原子性和辅助轨重叠例外。
- 书写音高、音程与和弦解析。
- 变速/变拍号时间换算和 MIDI 结构。
- 内置规则、同和弦跨度、规则私有状态、revision 和诊断合并。
- 乐句边界、终止式候选与自动和弦推导。
- 规则测试用例格式、隔离运行器与结果比较。
- 外置规则 manifest、QuickJS 超时/内存/非法引用。
- SoundFont 容量、资源读取和加载代际。
- 快捷键、面板布局和 Electron 路径策略。

不要在文档或发布说明中写死测试总数；新增/拆分测试会使数字很快过期。

### 2.2 `npm run typecheck`

依次检查：

```text
tsc --noEmit
tsc -p tsconfig.electron.json --noEmit
```

renderer 与 Electron 使用不同 TS 配置。只检查其中一套可能漏掉 preload、Node 类型或 DOM/Worker 边界错误。

### 2.3 `npm run build`

构建顺序：

```text
typecheck
-> Vite renderer build
-> clean dist-electron
-> tsc -p tsconfig.electron.json
```

因此 `build` 已包含类型检查，但在开发阶段单独运行 `typecheck` 通常反馈更快。构建通过只证明资源可编译，不证明 Electron 能启动、默认音色能加载或原生对话框可用。

## 3. 按改动选择验证

| 改动 | 最低验证 | 额外验证 |
| --- | --- | --- |
| 纯 Markdown 文档 | 链接检查、`git diff --check` | 无需代码构建 |
| 领域纯函数 | 相关 Vitest、typecheck | 全量 `npm test` |
| 工程 schema/迁移 | 模型、迁移、保存恢复测试 | 桌面打开 v2/保存 v3 |
| 编辑交互/快捷键 | 领域与 hook 测试、typecheck | Electron 手工或 E2E |
| Canvas 性能/布局 | build、相关测试 | 长工程高缩放实测、截图 |
| 和声规则 | 正反例、特例、状态/revision 测试 | 设置严重程度与 UI 归属 |
| 外置规则 API/沙箱 | QuickJS 限制与运行时测试 | 导入/缺包/移除 E2E |
| 音频/SoundFont | 生命周期与策略测试、build | Electron 实际听音和大文件 |
| Electron IPC/路径 | 策略测试、typecheck、build | desktop E2E + pack 产物 |
| 发布版本 | 完整测试矩阵 | 安装后手工冒烟 |

“用户要求小修改不用测试”可以省略与风险不匹配的打包，但不应省略明显相关的快速静态检查，除非用户明确要求完全不运行。

## 4. 桌面 E2E

运行：

```powershell
npm run e2e:desktop:local
```

该脚本先执行生产构建，再用仓库内 Electron 启动应用。实现位于 [`scripts/e2e-desktop.mjs`](../scripts/e2e-desktop.mjs)，通过 Electron remote debugging/CDP 驱动，不依赖 Playwright。

E2E 使用 `SATB_MASTER_E2E_DIRECTORY` 隔离：

- Electron userData。
- 临时工程和恢复文件。
- MIDI 导出目标。
- SoundFont/规则测试材料。

覆盖的代表流程包括：

- 有恢复数据启动后的“恢复/放弃”与下拉菜单焦点。
- 默认和用户 SoundFont、播放、真正暂停和编辑预听。
- 音符/和弦编辑、选择、快捷键和布局调整。
- 外置规则导入、执行和工程引用。
- MIDI 导出与自动恢复。

### 4.1 环境失败诊断

Windows/Electron E2E 可能在断言前因 GPU、驱动、安全软件、端口或进程残留失败。报告时保留：

- Electron 是否创建主窗口。
- remote debugging 端口是否可连接。
- stderr 中是否为 GPU 子进程或 sandbox 错误。
- 是否进入过任何应用断言。

确认是环境启动失败后，可在同一机器尝试与发布配置一致的 GPU 参数或清理隔离目录，但不要修改产品代码来“通过”一个未确认的环境问题。

## 5. 手工场景

自动化之外，以下行为值得按风险手工验证。

### 5.1 编辑与性能

- 创建较长工程（至少几十小节），提高横向缩放使视野很窄。
- 中键持续拖动画布、Ctrl+滚轮缩放、拖动音符和选择框。
- 检查标尺、和弦轨、播放头没有错位或断层。
- 检查完整 MIDI 0-127 音域可滚动，键盘移动不会进入不可见区域。

### 5.2 音频

- 冷启动后不先播放，直接绘制音符，应有预听。
- 播放后暂停，确认声音与动画都停止。
- 暂停后继续绘制/移动单音符，应仍有预听。
- 加载本地 SoundFont 后播放，确认不回退默认音色。
- 连续选择两个音色，确认较晚选择生效。
- 打开引用本地音源的工程但不播放，确认音源已开始加载；再切换到引用同一音源的工程，确认不会重复加载。

### 5.3 持久化和焦点

- 保存包含循环的工程，重开后检查端点。
- 制造 recovery，分别选择恢复和放弃；不切出应用，立即操作所有下拉菜单。
- 打开工程、SoundFont、规则和 MIDI 导出，检查各自记住最近目录。
- 用 v2 fixture 打开并覆盖，确认备份只创建一次且内容仍为 v2。

### 5.4 和声与规则

- 连续同和弦转换后再解决导音/七音，不应在中间误报。
- 休止中断后远处音符不应被当成解决。
- 和弦完整性错误只附着和弦，悬停显示聚合诊断。
- 调整规则严重程度为 off，确认规则不再调度。
- 移除已引用外置包，工程显示未挂载但内置规则继续。
- 在规则测试工作台打开用例目录、编辑并运行单条规则，确认通过/失败/错误状态与用例文件保存正确。

## 6. 生成资源

```powershell
npm run generate:soundfont
npm run generate:icon
npm run generate:assets
```

资源生成必须可重复。默认 SoundFont 改动需要核对：

- `default.sf2`。
- `default.sf2.sha256`。
- 许可证和 README。
- 所需 GM programs。
- 开发与 production extraResources 路径。

应用图标需要检查 `build/icon.ico` 在资源管理器、窗口、快捷方式和卸载项中的显示，而不只是源位图。

## 7. Windows 打包

### 7.1 免安装目录

```powershell
npm run pack:win
```

脚本执行资源生成、生产构建和 electron-builder `--win dir --x64`。输出目录来自 `package.json` 的 builder 配置，通常位于 `release`。

免安装目录适合检查：

- ASAR 中 renderer/Electron 文件是否齐全。
- `extraResources/soundfonts` 是否存在。
- 默认 SoundFont 生产路径。
- 主进程、preload 和自定义协议是否可启动。

### 7.2 NSIS 安装包

```powershell
npm run dist:win
```

生成 x64 NSIS 安装包到 `release-installer`，当前配置：

- 非 one-click，可选择安装目录。
- 创建桌面和开始菜单快捷方式。
- 卸载时保留 userData。
- 产物名 `SATB-Master-Setup-${version}-${arch}.${ext}`。

只生成安装包不等于完成发布。必须在安装后的路径运行，而不是继续测试仓库内 Electron。

## 8. 版本发布矩阵

正式版本至少执行并记录：

```powershell
npm test
npm run typecheck
npm run build
npm run e2e:desktop:local
npm run pack:win       # 或 dist:win；正式安装版通常两者都检查
```

然后在干净或隔离的 Windows 10/11 x64 环境安装并手工冒烟：

1. 启动与自定义窗口按钮。
2. 新建、编辑、撤销/重做、保存、关闭和重新打开。
3. recovery 两条路径和下拉菜单焦点。
4. 默认音色、本地音色、预听、播放、暂停、循环和节拍器。
5. 和弦、规则严重程度、内置/外置诊断。
6. MIDI 导出文件能被常见 DAW/解析器打开。
7. 卸载后 userData 的保留行为符合说明。

Windows 10 与 11 至少各验证一个受支持版本。大 SoundFont 测试记录文件大小、进程位数和机器内存，避免将单机成功泛化为所有 2 GiB 文件都可用。

## 9. 版本号与契约

发布前分别评估：

- `package.json` 产品版本。
- `PROJECT_SCHEMA_VERSION`。
- `EXTERNAL_RULE_API_VERSION`。

UI 功能升级通常只改产品版本；持久化破坏性变化需要新 schema 和迁移；外置脚本破坏性变化需要新 API 版本。三者可以在同一次大版本发布中变化，但原因和测试必须分别记录。

当前开发分支的产品版本仍可能显示 `1.1.0`，不要在准备下一正式版时遗漏更新。版本号变更后重新生成安装包，确保文件名、应用元数据和关于页面一致。

## 10. 提交与产物管理

- 小改动按用户约定集中到一次 Git 提交，不必每次创建安装包。
- 构建目录、安装包和临时 E2E userData 不应误加入 Git。
- 默认 SoundFont、哈希、许可证和图标属于受控源资源，需要按 `.gitignore` 现状确认是否应提交。
- 提交前运行 `git diff --check`，检查行尾、尾随空格和冲突标记。
- 提交信息应说明行为或契约，不使用“update files”一类无信息描述。

文档-only 改动无需运行代码测试，但应检查相对链接和 Markdown 结构，并在交付说明中明确未运行构建。

## 11. 发布记录模板

```text
版本：
提交/标签：
构建机器与 Windows 版本：
Node/npm 版本：

已验证：
- npm test
- npm run typecheck
- npm run build
- desktop E2E
- pack/installer
- 安装后手工冒烟

未验证：
- ...

已知限制：
- ...

产物：
- 文件名
- SHA-256
```

哈希应从最终分发文件计算，不要复用中间 pack 目录内容的哈希。

## 12. 发布阻断条件

以下任一项应阻止正式发布：

- schema 变化没有明确迁移/拒绝策略和 fixture 测试。
- 默认 SoundFont 来源或许可证不清楚，或 production 路径无法加载。
- 暂停仍发声、用户 SoundFont 被覆盖、恢复后下拉菜单失焦等核心回归。
- 长工程高缩放下编辑明显不可用。
- 外置规则能访问宿主能力或绕过时间/内存限制。
- 安装包未在安装后路径启动验证。
- 测试环境失败被误报为完整通过，导致关键流程实际未执行。
