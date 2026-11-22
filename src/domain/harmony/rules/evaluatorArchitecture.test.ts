import { describe, expect, it } from "vitest";

const sources = import.meta.glob(["./groups/*.ts", "./groups/support/*.ts"], {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

const stateSources = import.meta.glob("./state/*.ts", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

const currentDocumentation = import.meta.glob("/Docs/*.md", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

const applicationSources = import.meta.glob("/src/**/*.{ts,tsx}", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

const electronSources = import.meta.glob("/electron/*.{ts,cts}", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

function groupSources() {
  return Object.entries(sources)
    .filter(
      ([filename]) =>
        !filename.endsWith("/index.ts") && !filename.endsWith(".test.ts"),
    )
    .map(([filename, source]) => ({ filename, source }));
}

function ruleImplementationSources() {
  return [
    ...groupSources(),
    ...Object.entries(stateSources)
      .filter(([filename]) => !filename.endsWith(".test.ts"))
      .map(([filename, source]) => ({ filename, source })),
  ];
}

describe("规则 evaluator 架构", () => {
  it("规则对象直接引用具名 evaluator", () => {
    for (const { filename, source } of groupSources()) {
      expect(source, filename).not.toMatch(/evaluate:\s*\(/);
    }
  });

  it("规则算法不按 ruleId 选择行为", () => {
    for (const { filename, source } of groupSources()) {
      expect(source, filename).not.toMatch(/\bruleId\s*(?:===|!==)/);
      expect(source, filename).not.toMatch(/switch\s*\(\s*ruleId\s*\)/);
    }
  });

  it("四条倾向音规则由义务运行时管理状态，并使用普通转移函数", () => {
    const stateful = sources["./groups/stateful.ts"];
    expect(stateful).toBeDefined();
    expect(stateful.match(/defineObligationRule\s*\(/g)).toHaveLength(4);
    expect(stateful).toContain("function leadingToneTransition(");
    expect(stateful).toContain("function seventhTransition(");
    expect(stateful).toContain("function dominantNinthTransition(");
    expect(stateful).toContain("function alteredToneTransition(");
  });

  it("规则组不再依赖旧声明式 AST 或兼容定义器", () => {
    for (const { filename, source } of groupSources()) {
      expect(source, filename).not.toMatch(/from\s+["']\.\.\/declarative/);
      expect(source, filename).not.toMatch(/defineLegacyStatelessRule/);
      expect(source, filename).not.toMatch(/defineConstraintRule/);
      expect(source, filename).not.toMatch(/defineAlgorithmicRule/);
      expect(source, filename).not.toMatch(/\b(?:PredicateNode|FactStore)\b/);
      expect(source, filename).not.toMatch(/decisionTable\s*\(/);
    }
  });

  it("规则与状态层只通过领域上下文导航共享关系", () => {
    const directCollections =
      /\banalysis\.(?:slices|harmonySpans|connections|sliceTransitions|melodyTransitions|notesByVoice|noteById|chordById|sliceSpanIds)\b/;
    for (const { filename, source } of ruleImplementationSources()) {
      expect(source, filename).not.toMatch(directCollections);
      expect(source, filename).not.toMatch(/\.chords\[0\]/);
      expect(source, filename).not.toMatch(/regionIds(?:\[0\]|\.map\s*\()/);
    }
  });

  it("规则组不再导入旧 analysis 导航入口", () => {
    for (const { filename, source } of groupSources()) {
      const analysisImports = [...source.matchAll(
        /import\s+(?:type\s+)?{([^}]*?)}\s+from\s+["'](?:\.\.\/){2,3}analysis["']/g,
      )].map((match) => match[1]).join("\n");
      expect(analysisImports, filename).not.toMatch(
        /\b(?:analysisKeyAtTick|harmonySpanAtTick|harmonySpanAtSlice|previousSlice|nextSlice|walkSlices|walkSpans|previousAttack|nextAttack)\b/,
      );
    }
  });

  it("语义规则通过 Resolution 读取主要解释", () => {
    for (const { filename, source } of ruleImplementationSources()) {
      expect(source, filename).not.toMatch(/primaryHarmonyInterpretation\s*\(/);
    }
  });

  it("当前架构文档不再引用已删除的声明式源码目录", () => {
    expect(currentDocumentation).toHaveProperty(["/Docs/harmony-engine.md"]);
    for (const [filename, source] of Object.entries(currentDocumentation)) {
      expect(source, filename).not.toMatch(
        /src\/domain\/harmony\/rules\/(?:declarative|facts)/,
      );
    }
  });

  it("编辑器消费者不重新定义网格和缩放政策", () => {
    for (const [filename, source] of Object.entries(applicationSources)) {
      if (filename.endsWith("/features/editor/policy.ts")) continue;
      expect(source, filename).not.toMatch(/const\s+GRID_OPTIONS\b/);
      expect(source, filename).not.toMatch(/Math\.max\(42|Math\.min\(140/);
    }
  });

  it("桌面 IPC 只通过共享 typed wrapper 注册和调用通道", () => {
    expect(electronSources).toHaveProperty(["/electron/main.ts"]);
    expect(electronSources).toHaveProperty(["/electron/preload.cts"]);
    for (const [filename, source] of Object.entries(electronSources)) {
      if (filename.endsWith("/typed-ipc.ts")) continue;
      expect(source, filename).not.toMatch(/ipcMain\.handle\s*\(/);
      expect(source, filename).not.toMatch(/ipcRenderer\.invoke\s*\(\s*["']/);
      expect(source, filename).not.toMatch(/webContents\.send\s*\(\s*["']/);
    }
  });

  it("两个和弦编辑器只通过共享领域模型处理功能与共同和弦行为", () => {
    const editors = Object.entries(applicationSources).filter(([filename]) =>
      /(?:ChordPalette|ChordSemanticsEditor)\.tsx$/.test(filename),
    );
    expect(editors).toHaveLength(2);
    for (const [filename, source] of editors) {
      expect(source, filename).toMatch(/from\s+["'][^"']*chordEditorModel["']/);
      expect(source, filename).not.toMatch(/compatibleFunctionalInterpretations\s*\(/);
      expect(source, filename).not.toMatch(/function\s+(?:sameInterpretation|interpretationMatches)\s*\(/);
      expect(source, filename).not.toMatch(/onChange\s*\(\s*\{/);
      expect(source, filename).not.toMatch(/applyCadenceRole\s*\(/);
      expect(source, filename).not.toMatch(/maximumInversionForDraft\s*\(/);
    }
  });

  it("外置规则库通过统一端口隔离浏览器与 Electron 存储", () => {
    const library = Object.entries(applicationSources).find(([filename]) =>
      filename.endsWith("/services/externalRuleLibrary.ts"),
    )?.[1];
    expect(library).toContain("interface RuleLibraryPort");
    expect(library).toContain("createBrowserRuleLibraryPort");
    expect(library).toContain("createDesktopRuleLibraryPort");
  });

  it("全局快捷键通过穷尽 command handler map 分派", () => {
    const keyboard = Object.entries(applicationSources).find(([filename]) =>
      filename.endsWith("/app/controllers/useKeyboardController.ts"),
    )?.[1];
    expect(keyboard).toContain("Record<ShortcutCommandId, () => void>");
    expect(keyboard).toContain("commandHandlers[command.id]()");
    expect(keyboard).not.toMatch(/switch\s*\(\s*command\.id\s*\)/);
  });
});
