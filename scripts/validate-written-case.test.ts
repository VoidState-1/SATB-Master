import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import * as harmony from "../src/domain/harmony";
import { PPQ } from "../src/domain/project";
import * as score from "../src/domain/scoreText";
import { validateWrittenCaseSource } from "./validate-written-case.mjs";

const requiredMeta = {
  tier: "L2", medium: "written", chapter: "5", exerciseType: "melody", book: "和声学教程", question: "1", page: "12",
};
const barTicks = 4 * PPQ;

function chord(name: string, from: string, to: string, symbol = "I") {
  return "chord " + name + " range=[" + from + "," + to + ") symbol=" + symbol;
}

function phrase(name: string, from: string, to: string) {
  return "phrase " + name + " range=[" + from + "," + to + ")";
}

function cadence(name: string, owner: string, from: string, to: string, fields = "kind=full form=authentic completion=perfect") {
  return "cadence " + name + " phrase=" + owner + " range=[" + from + "," + to + ") " + fields;
}

interface FixtureOptions {
  measures?: number;
  meta?: Record<string, string | undefined>;
  complete?: string;
  voiceBar?: (voice: string, pitch: string, bar: number) => string;
  chords?: string[];
  phrases?: string[];
  cadences?: string[];
  notes?: string[];
  annotations?: string[];
}

function fixture(options: FixtureOptions = {}) {
  const {
    measures = 6,
    meta = {},
    complete = "chord,phrase,cadence",
    voiceBar = (_voice, pitch) => pitch + "/1",
    chords = [
      chord("open", "1:1", (measures - 1) + ":1"),
      chord("dominant", (measures - 1) + ":1", measures + ":1", "V"),
      chord("tonic", measures + ":1", (measures + 1) + ":1"),
    ],
    phrases = [phrase("whole", "1:1", (measures + 1) + ":1")],
    cadences = [cadence("close", "whole", (measures - 1) + ":1", (measures + 1) + ":1")],
    notes = [],
    annotations = [],
  } = options;
  const voiceLines = [["S", "E5"], ["A", "C5"], ["T", "G3"], ["B", "C3"]].map(([voice, pitch]) =>
    voice + ": | " + Array.from({ length: measures }, (_, i) => voiceBar(voice, pitch, i + 1)).join(" | ") + " |");
  const fields = Object.entries({ ...requiredMeta, ...meta }).flatMap(([key, value]) =>
    value === undefined ? [] : ["meta " + key + " " + JSON.stringify(value)]);
  return [
    "satb 1", "meter 4/4", ...fields,
    "bars 1.." + measures + " {", ...voiceLines, "}",
    ...(annotations.length ? ["annotations {", ...annotations, "}"] : []),
    "reference" + (complete ? " complete=" + complete : "") + " {",
    ...chords, ...phrases, ...cadences, ...notes, "}",
  ].join("\n");
}

function validate(source: string, { allowLegacyMeta = false, engine = harmony, compiler = score } = {}) {
  return validateWrittenCaseSource(source, { score: compiler, harmony: engine, filePath: "fixture.satbt", allowLegacyMeta });
}

type Result = ReturnType<typeof validate>;
const errorCodes = (result: Result) => result.errors.map(({ code }: { code: string }) => code);
const warningCodes = (result: Result) => result.warnings.map(({ code }: { code: string }) => code);
const getError = (result: Result, code: string) => result.errors.find((issue: { code: string }) => issue.code === code);

const splitPhrases = [phrase("first", "1:1", "5:1"), phrase("last", "5:1", "9:1")];
const lastCadence = cadence("close", "last", "7:1", "9:1");
const half = "kind=half form=authentic";

function chordsPerBar(measures: number) {
  return Array.from({ length: measures }, (_, i) => chord("c" + (i + 1), (i + 1) + ":1", (i + 2) + ":1"));
}

describe("Written100 单题门禁", () => {
  it("验证合法六小节谱面并返回完整统计和原始元数据", () => {
    const result = validate(fixture());
    expect(result).toEqual({
      filePath: "fixture.satbt",
      ok: true,
      stats: {
        measures: 6, lengthTicks: 6 * barTicks, soundingSpanTicks: 6 * barTicks,
        chordCoverageRatio: 1, chordGapCount: 0, referenceChords: 3, referencePhrases: 1, referenceCadences: 1,
        fullCadences: 1, halfCadences: 0, deceptiveCadences: 0, supplementaryCadences: 0, referenceNoteRoles: 0,
        conditionedRuleErrors: expect.any(Number), conditionedRuleWarnings: expect.any(Number), conditionedRuleSkips: expect.any(Number),
      },
      metadata: requiredMeta, errors: [], warnings: [],
    });
  });

  it.each(["bad source", fixture().replace("E5/1", "E5/2")])("原始解析或编译失败即返回", (source) => {
    const compileScore = vi.fn(score.compileScore);
    const buildHarmonyAnalysis = vi.fn(harmony.buildHarmonyAnalysis);
    const result = validate(source, { compiler: { ...score, compileScore }, engine: { ...harmony, buildHarmonyAnalysis } });
    expect(result.ok).toBe(false);
    expect(errorCodes(result)).toEqual(["COMPILE_ERROR"]);
    expect(compileScore).toHaveBeenCalledTimes(source === "bad source" ? 0 : 1);
    expect(buildHarmonyAnalysis).not.toHaveBeenCalled();
    expect(result.stats.conditionedRuleErrors).toBeNull();
  });

  it.each([["S", "soprano"], ["A", "alto"], ["T", "tenor"], ["B", "bass"]])("识别空声部 %s", (short, voice) => {
    const result = validate(fixture({ voiceBar: (part, pitch) => part === short ? "r/1" : pitch + "/1" }));
    expect(result.ok).toBe(false);
    expect(errorCodes(result)).toEqual(["EMPTY_VOICE"]);
    expect(result.errors[0].detail).toEqual({ voice });
  });

  it.each([[4, "4"], [5, "4"], [6, "58"], [24, "5"]] as const)("允许 %i 小节、第 %s 章", (measures, chapter) => {
    expect(validate(fixture({ measures, meta: { chapter, singlePhraseConfirmed: "已阅谱" } })).ok).toBe(true);
  });

  it.each([
    [3, "4", "LENGTH_TOO_SHORT"], [4, "5", "LENGTH_TOO_SHORT"], [5, "5", "LENGTH_TOO_SHORT"],
    [4, undefined, "LENGTH_TOO_SHORT"], [25, "4", "LENGTH_TOO_LONG"],
  ] as const)("拒绝 %i 小节、第 %s 章", (measures, chapter, code) => {
    const source = fixture({ measures, meta: { chapter, singlePhraseConfirmed: "已阅谱" } });
    expect(errorCodes(validate(source, { allowLegacyMeta: true }))).toEqual([code]);
  });

  it.each(Object.keys(requiredMeta))("缺少 %s 时严格失败，旧题模式降为警告", (key) => {
    const source = fixture({ meta: { [key]: undefined } });
    const strict = validate(source);
    expect(strict.ok).toBe(false);
    expect(strict.errors).toMatchObject([{ code: "META_MISSING", detail: { key } }]);
    const legacy = validate(source, { allowLegacyMeta: true });
    expect(legacy.ok).toBe(true);
    expect(legacy.warnings).toMatchObject([{ code: "META_MISSING", detail: { key } }]);
  });

  it.each([
    ["tier", "L4"], ["medium", "keyboard"], ["chapter", "3"], ["chapter", "59"], ["chapter", "36.5"],
    ["chapter", "0x24"], ["exerciseType", "keyboard"], ["book", ""], ["question", " "], ["page", ""],
  ])("拒绝 %s 的非法值 %j，旧题模式降为警告", (key, value) => {
    const source = fixture({ meta: { [key]: value } });
    expect(validate(source).errors).toMatchObject([{ code: "META_INVALID", detail: { key, value } }]);
    const legacy = validate(source, { allowLegacyMeta: true });
    expect(legacy.ok).toBe(true);
    expect(legacy.warnings).toMatchObject([{ code: "META_INVALID", detail: { key, value } }]);
  });

  it.each(["L1", "L2", "L3"])("接受 %s 和低音题类型", (tier) => {
    expect(validate(fixture({ meta: { tier, exerciseType: "bass" } })).ok).toBe(true);
  });

  it("有全部标注仍须声明和弦与终止式完备", () => {
    expect(errorCodes(validate(fixture({ complete: "phrase" }), { allowLegacyMeta: true }))).toEqual([
      "MISSING_COMPLETE_CHORD", "MISSING_COMPLETE_CADENCE",
    ]);
  });
});

describe("Written100 区间与覆盖率", () => {
  const restingVoices = (_voice: string, pitch: string, bar: number) => {
    if (bar === 1) return "r/2 " + pitch + "/2";
    if (bar === 3) return "r/1";
    if (bar === 6) return pitch + "/2 r/2";
    return pitch + "/1";
  };
  const separatedChords = [chord("late", "5:1", "6:3"), chord("early", "1:3", "3:1"), chord("middle", "4:1", "5:1")];

  it.each(["1:1", "1:3"])("忽略前导、内部全体和结尾休止，首句可起于 %s", (entry) => {
    const result = validate(fixture({
      voiceBar: restingVoices,
      chords: separatedChords,
      phrases: [phrase("whole", entry, "7:1")],
      cadences: [cadence("close", "whole", "5:1", "6:3")],
    }));
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.stats).toMatchObject({ soundingSpanTicks: 5 * barTicks, chordCoverageRatio: 1, chordGapCount: 0 });
  });

  it("和弦跨越全休止时只计算发声 tick，并精确报告细分拍", () => {
    const result = validate(fixture({
      voiceBar: (voice, pitch, bar) => bar === 3 && voice === "B" ? "r/4 " + pitch + "/8 r/8 r/2" : restingVoices(voice, pitch, bar),
      chords: [
        chord("two", "3:2+1/2", "5:2"), chord("one", "1:3", "2:4"),
        chord("three", "5:3", "6:1"), chord("last", "6:1", "6:3"),
      ],
      cadences: [cadence("close", "whole", "6:1", "6:3")],
    }));
    const expectedRatio = 1 - (2.5 / 16.5);
    expect(result.stats.chordCoverageRatio).toBeCloseTo(expectedRatio, 10);
    expect(result.stats.chordGapCount).toBe(3);
    const issue = getError(result, "CHORD_COVERAGE_GAP");
    expect(issue.detail).toEqual({
      count: 3, coverageRatio: result.stats.chordCoverageRatio, coveragePercent: "84.85%",
      intervals: [
        { fromTick: 7 * PPQ, toTick: 8 * PPQ, text: "[2:4, 3:1)" },
        { fromTick: 9 * PPQ, toTick: 9.5 * PPQ, text: "[3:2, 3:2+1/2)" },
        { fromTick: 17 * PPQ, toTick: 18 * PPQ, text: "[5:2, 5:3)" },
      ],
    });
    expect(issue.message).toContain("3 处和弦空洞（覆盖率 84.85%）");
    expect(issue.message).toContain("[3:2, 3:2+1/2)");
  });

  it("全曲发声但无参考和弦时报告 0% 和整曲空洞", () => {
    const result = validate(fixture({ chords: [], cadences: [] }));
    expect(result.stats).toMatchObject({ chordCoverageRatio: 0, chordGapCount: 1 });
    expect(getError(result, "CHORD_COVERAGE_GAP").detail.intervals).toEqual([
      { fromTick: 0, toTick: 6 * barTicks, text: "[1:1, 7:1)" },
    ]);
  });

  it("跨拍号变化仍使用精确的小节和拍内偏移", () => {
    const source = fixture({
      voiceBar: (_voice, pitch, bar) => pitch + (bar === 2 || bar === 3 ? "/2" : "/1"),
      chords: [
        chord("one", "1:1", "2:2"), chord("two", "3:2+1/2", "5:1"),
        chord("dominant", "5:1", "6:1", "V"), chord("tonic", "6:1", "7:1"),
      ],
    }).replace("meter 4/4", "meter 4/4\nat 2:1 meter 2/4\nat 4:1 meter 4/4");
    const result = validate(source);
    expect(errorCodes(result)).toEqual(["CHORD_COVERAGE_GAP"]);
    expect(getError(result, "CHORD_COVERAGE_GAP").detail.intervals).toEqual([
      { fromTick: 5 * PPQ, toTick: 7.5 * PPQ, text: "[2:2, 3:2+1/2)" },
    ]);
  });

  it("全体无音符时四个声部均失败，发声覆盖率仍在范围内", () => {
    const result = validate(fixture({ voiceBar: () => "r/1" }));
    expect(errorCodes(result).filter((code) => code === "EMPTY_VOICE")).toHaveLength(4);
    expect(result.stats).toMatchObject({ soundingSpanTicks: 0, chordCoverageRatio: 0, chordGapCount: 0 });
  });

  it("原始编译拒绝参考和弦重叠并保留专用代码", () => {
    const result = validate(fixture({ chords: [chord("one", "1:1", "5:1"), chord("two", "4:1", "7:1")] }));
    expect(errorCodes(result)).toEqual(["COMPILE_ERROR", "CHORD_OVERLAP"]);
  });

  it("原始编译拒绝参考乐句重叠并保留专用代码", () => {
    const result = validate(fixture({ phrases: [phrase("one", "1:1", "4:1"), phrase("two", "3:1", "7:1")], cadences: [] }));
    expect(errorCodes(result)).toEqual(["COMPILE_ERROR", "PHRASE_OVERLAP"]);
  });

  it("在已编译区间中检查重叠，且重叠的和弦 tick 只计算一次", () => {
    const compileScore = (spec: score.ScoreSpec) => {
      const compiled = score.compileScore(spec);
      const [first] = compiled.reference.chords;
      compiled.reference.chords.push({ ...first, id: "chord-duplicate" });
      compiled.reference.phrases.push({ name: "nested", phraseId: "phrase-nested", fromTick: 0, toTick: 2 * barTicks });
      return compiled;
    };
    const result = validate(fixture(), { compiler: { ...score, compileScore } });
    expect(errorCodes(result)).toEqual(["CHORD_OVERLAP", "PHRASE_OVERLAP"]);
    expect(result.stats.chordCoverageRatio).toBe(1);
    expect(getError(result, "PHRASE_OVERLAP").detail.intervals[0].text).toBe("[1:1, 3:1)");
  });

  it("按时间检查乱序乐句的前缀、中间和尾部缺口", () => {
    const result = validate(fixture({
      voiceBar: restingVoices,
      phrases: [phrase("two", "4:1", "6:3"), phrase("one", "1:2", "3:1")],
      cadences: [cadence("close", "two", "5:1", "6:3")],
    }));
    expect(getError(result, "PHRASE_COVERAGE_GAP").detail.intervals.map(({ text }: { text: string }) => text)).toEqual([
      "[1:1, 1:2)", "[3:1, 4:1)", "[6:3, 7:1)",
    ]);
  });
});

describe("Written100 终止式与专题标注", () => {
  it("拒绝空的参考乐句与终止式", () => {
    const result = validate(fixture({ phrases: [], cadences: [] }));
    expect(errorCodes(result)).toEqual(["MISSING_PHRASES", "MISSING_CADENCES"]);
  });

  it("有乐句但无任何终止式时报告两项缺失", () => {
    expect(errorCodes(validate(fixture({ cadences: [] })))).toEqual(["MISSING_CADENCES", "MISSING_FINAL_CADENCE"]);
  });

  it("前一句结束于共享边界的终止式不计入末句", () => {
    const result = validate(fixture({
      measures: 8, chords: chordsPerBar(8), phrases: splitPhrases,
      cadences: [cadence("openEnd", "first", "4:1", "5:1", half)],
    }));
    expect(errorCodes(result)).toEqual(["MISSING_FINAL_CADENCE"]);
  });

  it("接受由给定乐句标注、落点进入末乐句的结尾终止", () => {
    const result = validate(fixture({
      annotations: [phrase("given", "1:1", "7:1")],
      phrases: [phrase("first", "1:1", "6:1"), phrase("last", "6:1", "7:1")],
      cadences: [cadence("close", "given", "5:1", "7:1")],
    }));
    expect(errorCodes(result)).toEqual(["CONDITIONED_COMPILE_FAILED"]);
  });

  it.each([
    [7, "8:1", false, undefined], [8, "9:1", true, undefined], [8, "9:1", true, " "], [8, "9:1", false, "已核对原谱"],
  ] as const)("逐句检查 %i 小节题的内部终止", (measures, end, fails, note) => {
    const result = validate(fixture({
      measures, meta: { internalCadenceChecked: note }, chords: chordsPerBar(measures),
      phrases: [phrase("last", "5:1", end), phrase("second", "3:1", "5:1"), phrase("first", "1:1", "3:1")],
      cadences: [cadence("close", "last", "6:1", end)],
    }));
    expect(errorCodes(result)).toEqual(fails ? ["MISSING_INTERNAL_CADENCE", "MISSING_INTERNAL_CADENCE"] : []);
    if (fails) expect(result.errors.map((issue: { message: string }) => issue.message)).toEqual([
      expect.stringContaining("first [1:1, 3:1)"), expect.stringContaining("second [3:1, 5:1)"),
    ]);
  });

  it("显式所属乐句匹配时接受提早落点，也接受后半段的同位落点", () => {
    const early = validate(fixture({
      measures: 8, chords: chordsPerBar(8), phrases: splitPhrases, cadences: [cadence("early", "first", "1:1", "2:1", half), lastCadence],
    }));
    expect(early.errors).toEqual([]);
    const compileScore = (spec: score.ScoreSpec) => {
      const compiled = score.compileScore(spec);
      if (spec.reference?.length) {
        const overlapping = { name: "given", phraseId: "given", fromTick: 0, toTick: 6 * barTicks };
        compiled.annotations.phrases.push(overlapping);
        compiled.reference.cadences[0].phraseId = overlapping.phraseId;
      }
      return compiled;
    };
    const result = validate(fixture({
      measures: 8, chords: chordsPerBar(8), phrases: splitPhrases, cadences: [cadence("nearEnd", "first", "3:1", "4:1", half), lastCadence],
    }), { compiler: { ...score, compileScore } });
    expect(result.errors).toEqual([]);
  });

  it.each(["half", "deceptive"])("长单句接受 %s 终止", (kind) => {
    const result = validate(fixture({
      measures: 8, chords: chordsPerBar(8), cadences: [
        cadence("inner", "whole", "3:1", "4:1", kind === "half" ? half : "kind=deceptive"),
        cadence("close", "whole", "7:1", "9:1"),
      ],
    }));
    expect(result.errors).toEqual([]);
    expect(result.stats[kind === "half" ? "halfCadences" : "deceptiveCadences"]).toBe(1);
  });

  it.each([[undefined, false], [" ", false], ["已核对为单一乐段", true]] as const)("长单句复核说明 %j", (note, ok) => {
    const result = validate(fixture({ measures: 8, meta: { singlePhraseConfirmed: note } }));
    expect(result.ok).toBe(ok);
    expect(errorCodes(result)).toEqual(ok ? [] : ["LONG_SINGLE_PHRASE_UNCONFIRMED"]);
  });

  it.each([
    ["kind=half", ["CADENCE_MISSING_FORM"]],
    ["kind=full completion=perfect", ["CADENCE_MISSING_FORM"]],
    ["kind=full form=authentic", ["CADENCE_MISSING_COMPLETION"]],
    ["kind=full", ["CADENCE_MISSING_FORM", "CADENCE_MISSING_COMPLETION"]],
    ["kind=supplementary", ["COMPILE_ERROR", "CADENCE_MISSING_FORM"]],
    ["kind=supplementary form=plagal", []],
    ["kind=full form=plagal completion=imperfect", []],
  ] as const)("按类别校验终止式字段 %s", (fields, codes) => {
    const result = validate(fixture({ cadences: [cadence("close", "whole", "5:1", "7:1", fields)] }));
    expect(errorCodes(result)).toEqual(codes);
    if (fields === "kind=supplementary form=plagal") expect(result.stats.supplementaryCadences).toBe(1);
  });

  it.each([
    cadence("bad", "whole", "6:1", "6:1"),
    cadence("bad", "whole", "6:1", "5:1"),
    cadence("bad", "one", "3:1", "7:1"),
    cadence("bad", "missing", "3:1", "4:1"),
  ])("拒绝无效终止式范围或所属乐句 %s", (label) => {
    const result = validate(fixture({ phrases: [phrase("one", "1:1", "4:1"), phrase("whole", "4:1", "7:1")], cadences: [label] }));
    expect(errorCodes(result)).toEqual(["COMPILE_ERROR", "CADENCE_INVALID_RANGE"]);
  });

  it.each(["35", "36", "45", "46"])("第 %s 章按专题范围要求音符角色", (chapter) => {
    const result = validate(fixture({ meta: { chapter, nctChecked: " " }, notes: ["note S@1:1 velocity=91"] }));
    expect(result.stats.referenceNoteRoles).toBe(0);
    expect(errorCodes(result)).toEqual(chapter === "36" || chapter === "45" ? ["MISSING_NCT_ROLES"] : []);
  });

  it("接受外音角色或明确复核说明，并仅统计带角色的标注", () => {
    const roles = validate(fixture({ meta: { chapter: "40" }, notes: ["note S@1:1 role=passing", "note B@1:1 locked=true"] }));
    expect(roles.errors).toEqual([]);
    expect(roles.stats.referenceNoteRoles).toBe(1);
    const checked = validate(fixture({ meta: { chapter: "40", nctChecked: "全曲已核对，无外音" } }));
    expect(checked.errors).toEqual([]);
    expect(checked.stats.referenceNoteRoles).toBe(0);
  });

  it("仅对缺少合格用途的第二转位三和弦发出警告", () => {
    const result = validate(fixture({
      chords: [
        chord("missing", "1:1", "2:1", "I64"),
        chord("passing", "2:1", "2:2", "I64") + " role=passing64",
        chord("pedal", "2:2", "2:3", "I64") + " role=pedal64",
        chord("cadential", "2:3", "3:1", "K46"),
        chord("wrongRole", "3:1", "4:1", "I64") + " role=deceptive",
        chord("seventh", "4:1", "5:1", "V43"),
        chord("firstInversion", "5:1", "6:1", "I6"),
        chord("tonic", "6:1", "7:1"),
      ],
    }));
    expect(result.ok).toBe(true);
    expect(warningCodes(result)).toEqual(["SIX_FOUR_MISSING_ROLE", "SIX_FOUR_MISSING_ROLE"]);
    expect(result.warnings.map(({ detail }: { detail: unknown }) => detail)).toMatchObject([
      { chordId: "chord-missing" }, { chordId: "chord-wrongRole" },
    ]);
  });
});

describe("Written100 给定标注工程", () => {
  it("只额外编译一次，将全部参考标注并入输入并统计检查结果", () => {
    const compileScore = vi.fn(score.compileScore);
    const buildHarmonyAnalysis = vi.fn(harmony.buildHarmonyAnalysis);
    const checkHarmony = vi.fn((project: Parameters<typeof harmony.checkHarmony>[0]) => {
      expect(project.chordTrack.cadenceAnnotations).toHaveLength(1);
      const output = harmony.checkHarmony(project);
      return {
        ...output,
        diagnostics: ["error", "warning", "suggestion", "error"].map(
          (severity) => ({ severity } as (typeof output.diagnostics)[number]),
        ),
        skippedRules: [{ ruleId: "skip", reason: "no-chords" as const, message: "test", partial: false }],
      };
    });
    const annotations = ["note A@1:1 velocity=95"];
    const notes = ["note S@1:1 role=passing"];
    const result = validate(fixture({ annotations, notes }), {
      compiler: { ...score, compileScore }, engine: { ...harmony, buildHarmonyAnalysis, checkHarmony },
    });
    expect(result.ok).toBe(true);
    expect(result.stats).toMatchObject({ conditionedRuleErrors: 2, conditionedRuleWarnings: 1, conditionedRuleSkips: 1 });
    expect(compileScore).toHaveBeenCalledTimes(2);
    const [[original], [conditioned]] = compileScore.mock.calls;
    expect(conditioned).toMatchObject({
      annotations: [...original.annotations!, ...original.reference!], reference: [], referenceComplete: [],
    });
    expect(buildHarmonyAnalysis).toHaveBeenCalledTimes(1);
    expect(checkHarmony).toHaveBeenCalledExactlyOnceWith(buildHarmonyAnalysis.mock.calls[0][0]);
  });

  it("终止式跨和弦空洞时拒绝给定标注工程，并保留原终止式", () => {
    const compileScore = vi.fn(score.compileScore);
    const result = validate(fixture({
      chords: [chord("open", "1:1", "5:2"), chord("late", "5:3", "7:1")],
    }), { compiler: { ...score, compileScore } });
    expect(errorCodes(result)).toEqual(["CHORD_COVERAGE_GAP", "CONDITIONED_COMPILE_FAILED"]);
    expect(getError(result, "CONDITIONED_COMPILE_FAILED").message).toContain("终止式范围必须覆盖连续的和弦区域");
    expect(result.stats.conditionedRuleSkips).toBeNull();
    expect(compileScore).toHaveBeenCalledTimes(2);
    expect(compileScore.mock.calls[1][0].annotations).toContainEqual(expect.objectContaining({ kind: "cadence" }));
  });

  it.each(["buildHarmonyAnalysis", "checkHarmony"] as const)("捕获 %s 异常且保留空统计", (method) => {
    const fail = vi.fn(() => { throw new Error("engine failure"); });
    const result = validate(fixture(), { engine: { ...harmony, [method]: fail } });
    expect(fail).toHaveBeenCalledTimes(1);
    expect(result.errors).toEqual([{ code: "CONDITIONED_ANALYSIS_FAILED", message: "engine failure" }]);
    expect(result.stats).toMatchObject({
      conditionedRuleErrors: null, conditionedRuleWarnings: null, conditionedRuleSkips: null,
    });
  });
});

function withFixtures(run: (directory: string) => void) {
  const directory = mkdtempSync(join(tmpdir(), "satb-written-case-"));
  try {
    run(directory);
  } finally {
    const target = resolve(directory);
    if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith("satb-written-case-")) {
      throw new Error("临时目录不在预期范围内：" + target);
    }
    rmSync(target, { recursive: true, force: true });
  }
}

function runCli(...args: string[]) {
  return spawnSync(process.execPath, [resolve("scripts/validate-written-case.mjs"), ...args], {
    encoding: "utf8", timeout: 20_000, windowsHide: true,
  });
}

describe("Written100 CLI", () => {
  it("遍历目录忽略 node_modules，允许指定文件并去重，输出 JSON 与失败状态", () => {
    withFixtures((dir) => {
      const input = join(dir, "谱例");
      const nested = join(input, "子目录");
      const ignored = join(input, "node_modules");
      mkdirSync(nested, { recursive: true });
      mkdirSync(ignored);
      const good = join(input, "合格.satbt");
      writeFileSync(good, fixture());
      writeFileSync(join(nested, "bad.SATBT"), "invalid SATB");
      writeFileSync(join(ignored, "ignored.satbt"), "invalid SATB");
      writeFileSync(join(input, "ignored.txt"), "invalid SATB");
      const out = join(dir, "报告", "report.json");
      const output = runCli(input, good, "--json", "--out", out);
      expect(output.stderr).toBe("");
      expect(output.status).toBe(1);
      expect(readFileSync(out, "utf8")).toBe(output.stdout);
      const report = JSON.parse(output.stdout);
      expect(report.summary).toEqual({ total: 2, passed: 1, failed: 1, errors: 1, warnings: 0 });
      expect(report.cases).toEqual(expect.arrayContaining([
        expect.objectContaining({ filePath: realpathSync(good), ok: true }),
        expect.objectContaining({ filePath: realpathSync(join(nested, "bad.SATBT")), ok: false }),
      ]));
    });
  }, 25_000);

  it.each(["cases", "records"])("读取 %s 清单并支持默认中文摘要与警告通过", (format) => {
    withFixtures((dir) => {
      const manifest = join(dir, "manifest.json");
      const names = format === "cases" ? ["file", "input", "sourceFile"] : ["input"];
      const rows = names.map((key) => {
        const file = key + ".satbt";
        writeFileSync(join(dir, file), fixture({ meta: { tier: "L4" } }));
        return { id: key, [key]: file };
      });
      writeFileSync(manifest, JSON.stringify({ [format]: rows }));
      const out = join(dir, "result.json");
      const output = runCli("--manifest", manifest, "--allow-legacy-meta", "--out", out);
      expect(output.stderr).toBe("");
      expect(output.status).toBe(0);
      expect(output.stdout).toContain("PASS " + names[0]);
      expect(output.stdout).toContain("和弦覆盖率 100.00%");
      expect(output.stdout).toContain("终止式 1 条（半 0、全 1、阻碍 0、补充 0）");
      expect(output.stdout).toContain("警告 [META_INVALID]");
      expect(output.stdout).toContain("共 " + names.length + " 题，" + names.length + " 通过，0 失败");
      const report = JSON.parse(readFileSync(out, "utf8"));
      expect(report.summary.warnings).toBe(names.length);
      expect(report.cases.map(({ id }: { id: string }) => id)).toEqual(names);
    });
  }, 25_000);

  it("单个文件读取失败时仍输出结构化报告", () => {
    withFixtures((dir) => {
      const output = runCli(join(dir, "missing.satbt"), "--json");
      expect(output.status).toBe(1);
      expect(output.stderr).toBe("");
      expect(JSON.parse(output.stdout).cases[0].errors).toMatchObject([{ code: "INPUT_READ_ERROR" }]);
    });
  }, 25_000);

  it("拒绝无输入、错误清单和覆盖谱面", () => {
    expect(runCli().stderr).toContain("用法");
    withFixtures((dir) => {
      const manifest = join(dir, "bad.json");
      writeFileSync(manifest, "{}");
      expect(runCli("--manifest", manifest).stderr).toContain("cases 或 records");
      const input = join(dir, "safe.satbt");
      writeFileSync(input, fixture());
      const output = runCli(input, "--out", input);
      expect(output.status).toBe(1);
      expect(output.stderr).toContain("报告输出路径与输入文件相同");
      expect(readFileSync(input, "utf8")).toBe(fixture());
    });
  }, 25_000);
});
