# SATB Master

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Electron](https://img.shields.io/badge/Electron-Desktop-47848F.svg)](https://www.electronjs.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB.svg)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-Strict-3178C6.svg)](https://www.typescriptlang.org/)

**离线优先的 SATB 四部和声学习、自动推导、辅助写作与规则批改桌面应用。**

围绕传统四部和声（斯波索宾体系）写作与学习场景打造，集**钢琴卷帘编辑、实时 VexFlow 五线谱预览、SoundFont 实时回放、70 条内置和声规则引擎、自动和声与半自动和声连接、QuickJS 外置规则沙箱**于一体，完全本地离线运行。

---

## 核心特性

### 1. 四部和声编辑与实时记谱
- **SATB 钢琴卷帘与和弦轨**：支持 Soprano / Alto / Tenor / Bass 四声部独立编辑、变拍/变速/变调、声部与和弦区段锁定、同音异名精确拼写，以及完整原子撤销/重做栈。
- **实时五线谱预览**：基于 VexFlow 渲染高音/低音大谱表、罗马数字/斯波索宾功能标记与当前光标联动。
- **离线音频回放与导出**：内置默认 SF2 音色并支持加载本地自定义 SoundFont、硬件/虚拟 MIDI 输出，支持导出标准 **MIDI (`.mid`)** 与 **MusicXML (`.musicxml`)**。

### 2. 70 条内置斯波索宾和声规则引擎 + 外置沙箱
- 覆盖声部音域与交叉、平行/反向/隐伏五八度、和弦构成与转位低音、导音与七音跨切片解决、经过/辅助/延留/先现/持续音等非和弦音核实、功能进行、节拍切分、终止式与调性转换。
- 支持规则级别自定义、规则配置方案导入/导出，以及**单规则金样本测试工作台**（`RuleCases/`）。
- **外置规则插件沙箱**：通过 QuickJS Wasm 沙箱安全加载与执行第三方自定义规则，带超时与内存上限保护。

### 3. 自动和声分析（和弦 · 乐句 · 终止式）
- **纯盲推和弦识别**：六阶段上下文候选流水线 + Viterbi 路径求解，支持调内正副三/七和弦、规范四六和弦（`K46` / 经过 / 辅助）、重属与副属、增六与那不勒斯和弦、一级关系转调局部调追踪，以及通用上下文和弦外音恢复（含链式外音与弱拍假和弦竞争）。
- **事件打分 + 全局 DP 乐句切分与终止式检测**：扫描全曲小节线与弱起对齐点，识别规整/扩充/多乐句结构，以及正格、变格、半终止、阻碍与补充终止。

### 4. 自动和声与半自动和声连接
- **自动和声（高音题 / 低音题）**：基于「和弦 × 四声部排列 × 倾向音解决义务」联合 Beam Search 毫秒级离线求解，支持三种风格预设（平稳保守 / 标准教材 / 丰富色彩）、弱拍经过/辅助音识别、锁定锚点开关、多方案真实 `checkHarmony` 诊断对比、独立试听与一键原子写入。
- **半自动和声连接（底部「和声连接」工作台）**：自动定位播放光标向右最近一处空位（通吃全空位自由续写、半空位高/低音逐拍配声、中间填空双向桥接），提供**单和弦（含排列变体）**与**2–4 步短连接**双模式、Web Worker 异步搜索、**钢琴卷帘半透明幽灵音符预览**、带前一拍的衔接试听，以及采纳后自动推进光标的流畅写作体验。

### 5. 工程持久化与排错可观测性
- **安全持久化与崩溃恢复**：支持 `.satb` 工程格式（含旧版 schema 自动迁移与备份）、自动保存恢复，以及根级 `AppErrorBoundary` 崩溃恢复与紧急工程快照导出。
- **双进程结构化日志与排错包**：Electron 主进程 JSONL 滚动落盘（`userData/logs/`）、IPC 异常与慢调用自动埋点、底部「日志」工作台（开发者模式常驻，普通模式仅出错显现）及一键导出脱敏排错包。

---

## 快速开始

### 环境要求
- Node.js `>= 20`（推荐 22+）
- npm `>= 10`
- Windows 10/11 x64（桌面端打包目标）

### 安装与启动开发模式

```powershell
git clone https://github.com/VoidState-1/SATB-Master.git
cd SATB-Master
npm install
npm run generate:assets
npm run dev
```

带 DevTools 启动开发模式：

```powershell
npm run dev:tools
```

### 测试、构建与 Windows 打包

```powershell
# 类型检查（Renderer + Electron 主进程）
npm run typecheck

# 运行自动化测试套件
npm test

# 生产构建（Web + Electron 主进程 + Preload）
npm run build

# 桌面端 E2E 冒烟验证（含会话零错误日志门禁）
npm run e2e:desktop:local

# 打包 Windows 免安装目录 / NSIS x64 安装程序
npm run pack:win
npm run dist:win
```

> `npm run pack:win` 输出免安装目录至 `release/`；`npm run dist:win` 输出 Windows x64 安装程序至 `release-installer/`。

---

## 项目结构

```text
SATB-Master/
├── electron/               # Electron 主进程、IPC、安全边界、滚动日志与原生对话框
├── shared/                 # 跨进程共享契约（Desktop IPC、日志模型、外置规则协议）
├── src/
│   ├── domain/             # 纯领域核心（零 React / Electron 依赖）
│   │   ├── pitch.ts        # 书写音高、音程与同音异名拼写
│   │   ├── chordModel.ts   # 和弦模型、转位与功能语义
│   │   └── harmony/        # rules / inference / phrase / cadence / harmonization / external
│   ├── features/           # 前端功能模块（钢琴卷帘、五线谱、自动和声、半自动连接、诊断与日志等）
│   ├── audio/              # SoundFont 音频引擎与 MIDI 输出
│   ├── services/           # 桌面桥接、外置规则运行时、渲染层日志总线
│   └── app/                # 应用外壳、控制器与撤销栈
├── RuleCases/              # 单规则金样本测试用例库
├── Docs/                   # 完整开发者架构与子系统文档
└── scripts/                # 构建资源、桌面 E2E 与评测工具脚本
```

更多架构细节与子系统规范请参阅 [开发者文档索引](./Docs/README.md) 与 [项目开发主线](./DesignDocs/project-mainlines.md)。

---

## 致谢与第三方许可

本项目的构建离不开以下优秀开源项目（均采用 MIT / ISC / Apache-2.0 许可）：
- [Electron](https://www.electronjs.org/) · [React](https://react.dev/) · [Vite](https://vitejs.dev/) · [TypeScript](https://www.typescriptlang.org/)
- [VexFlow](https://www.vexflow.com/)（五线谱排版渲染）
- [SpessaSynth](https://github.com/spessasus/SpessaSynth)（SF2 SoundFont 音频合成引擎）
- [quickjs-emscripten](https://github.com/justjake/quickjs-emscripten)（外置规则安全沙箱）
- [midi-file](https://github.com/carter-thaxton/midi-file) · [Lucide Icons](https://lucide.dev/)

默认内置音色 `public/soundfonts/default.sf2` 的来源、再生成脚本与许可声明见 [public/soundfonts/LICENSE-default-soundfont.txt](./public/soundfonts/LICENSE-default-soundfont.txt)。

---

## 赞助支持

如果 **SATB Master** 帮助到了你的和声学习或教学工作，欢迎通过软件内侧栏的「赞助作者」入口请作者喝杯咖啡，感谢支持！

---

## 开源协议

本项目基于 [MIT License](./LICENSE) 开源。
