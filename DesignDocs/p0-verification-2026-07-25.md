# SATB Master P0 阶段验证记录

> 验证日期：2026-07-25
> 验证系统：Windows 10 22H2 x64（10.0.19045）
> 应用版本：0.1.0

## 本阶段完成内容

- 使用项目自有的确定性加法合成波形生成默认 SF2，不包含第三方录音采样。
- 默认 SF2 由 Electron Main 从开发目录或安装包 `resources/soundfonts` 读取并校验 SHA-256。
- 修复沙箱化 Electron 生产环境 preload 格式，使用 `preload.cts -> preload.cjs` 提供真实 IPC。
- 配置 electron-builder 26.15.3 与 NSIS，生成 Windows x64 安装程序和免安装目录。
- 增加专用应用图标及可复现 PNG/ICO 生成脚本。
- 增加启动恢复信封、恢复提示、来源路径、显式保存后清理和浏览器预览回退。
- 增加打包桌面端自动回归，覆盖卷帘输入、规则检查、撤销/重做、播放、工程和 MIDI 往返。
- 增加同声部音符重叠、换调边界导音解决和七和弦七音下行解决规则，并补充最小正反例。

## 产物

| 产物 | 结果 |
| --- | --- |
| 安装程序 | `release-installer/SATB-Master-Setup-0.1.0-x64.exe` |
| 安装程序大小 | 102,555,756 bytes |
| 安装程序 SHA-256 | `32C61F924733FAD3C7E30B4CDAFA91342B1E868B4D256836FA47A497CC6C0ED9` |
| 默认 SF2 | `public/soundfonts/default.sf2` |
| 默认 SF2 SHA-256 | `7651CA32165018099EEBF4C2B3BABDD5893D2797B6AD9F328E01B7071D5D1E1C` |

安装目录已核对包含 `default.sf2`、摘要、来源说明和许可证。ASAR 中仅使用
`dist-electron/preload.cjs`，构建前会清理旧 Electron 输出，避免本地残留进入安装包。

## 已验证

- `npm test -- --run`：4 个测试文件、16 项领域测试通过。
- `npm run typecheck`：Renderer 与 Electron 严格类型检查通过。
- `npm run dist:win`：资源生成、生产构建、x64 NSIS 安装包生成通过。
- 免安装目录端到端回归通过。
- 最终安装程序已静默安装到隔离目录，安装后端到端回归通过，并完成卸载清理。
- 端到端流程创建 8 个四声部音符并识别平行五度与平行八度；撤销、重做、默认 SF2
  加载、播放、工程保存/重新打开、MIDI Type 1 五轨导出均通过。
- 自动恢复写入、preload 读取、9 音符快照校验和显式保存后清理通过。
- `npm audit --omit=dev`：生产依赖 0 项已知漏洞。

## 尚未验证或未完成

- 安装程序与主程序未配置 Authenticode 证书，当前状态为 `NotSigned`。
- Windows 11 尚未进行实机验证；当前只在 Windows 10 22H2 完成安装后回归。
- electron-builder 工具链的开发依赖审计仍报告 16 项高危传递依赖告警；当前稳定最新版
  26.15.3 没有可直接应用的修复。它们不进入 Renderer/Main 生产依赖，生产审计为 0。
- 斯波索宾规则校对使用的具体中文版本、出版社和版次仍未选定。
- 当前规则检查器覆盖基础音域、旋律、声部间进行与部分和弦构成规则，但尚未达到设计文档
  7.3 节全部规则、例外条件和人工金样本要求。
- 未配置自动更新；设计文档允许首发不包含自动更新。

## 复验命令

```powershell
npm install
npm run generate:assets
npm test -- --run
npm run typecheck
npm run dist:win
npm run e2e:desktop
```
