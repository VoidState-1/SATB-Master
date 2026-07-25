# SATB Master

用于四部和声写作、回放、规则检查与 MIDI 导出的离线桌面应用。

## 开发

```powershell
npm install
npm run generate:assets
npm test
npm run build
npm run e2e:desktop:local
npm run dev
```

## Windows 打包

```powershell
npm run pack:win
npm run dist:win
```

`pack:win` 生成免安装目录，`dist:win` 生成 Windows 10/11 x64 NSIS 安装程序。
默认 SF2 的来源、再生成方式和许可证位于 `public/soundfonts`。

当前 P0 阶段的已验证与未验证事项记录在
`DesignDocs/p0-verification-2026-07-25.md`。
