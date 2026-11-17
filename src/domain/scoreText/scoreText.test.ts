import { describe, expect, it } from "vitest";
import sample from "../../../StandardCase/Samples/annotated-cadence.satbt?raw";
import rolesSource from "../../../StandardCase/Samples/annotated-roles.satbt?raw";
import { buildHarmonyAnalysis } from "../harmony/analysis";
import { createRuleTestCase } from "../harmony/testing/factory";
import { materializeRuleTestProject } from "../harmony/testing/projectFixture";
import { validateProject } from "../project";
import { buildMeasures } from "../time";
import { compileScore, compileScoreText, durationTicks, parseScoreText, positionTick, readPitch, replaceScoreBlock, ScoreTextError, type ScoreBlock } from "./index";

function block(from: number, to = from, soprano = "C4/1") {
  const bar = `| ${soprano} |`;
  return `bars ${from}..${to} {\nS: ${bar}${` ${soprano} |`.repeat(to - from)}\nA: empty\nT: empty\nB: empty\n}`;
}
const score = (body: string, header = "") => `satb 1\n${header}\n${body}`;

describe("SATB 简写编译", () => {
  it("生成可保存工程，并在不写入答案的情况下实际检测终止式", () => {
    const compiled = compileScoreText(sample);
    expect(validateProject(compiled.project)).toBe(true);
    expect(compiled.project.chordTrack.cadenceAnnotations).toEqual([]);
    expect(compiled.reference.complete).toEqual(["cadence"]);
    expect(compiled.reference.cadences).toHaveLength(1);
    const expected = compiled.reference.cadences[0];
    const actual = buildHarmonyAnalysis(compiled.project).cadenceCandidates;
    expect(actual).toContainEqual(expect.objectContaining({
      kind: expected.kind, form: expected.form, completion: expected.completion,
      fromTick: expected.fromTick, toTick: expected.toTick,
    }));
    expect(compiled.project.chordTrack.cadenceAnnotations).toEqual([]);
  });

  it("函数接口与文本接口使用相同编译路径", () => {
    const spec = parseScoreText(sample);
    const fromApi = compileScore(spec);
    const fromText = compileScoreText(sample);
    expect(fromApi.project.satbTracks).toEqual(fromText.project.satbTracks);
    expect(fromApi.project.chordTrack).toEqual(fromText.project.chordTrack);
    expect(spec.blocks[0].voices.S).toBe("| E4/2 D4/2 |");
  });

  it("16 小节分块不制造乐句边界，声部可以在块内换行", () => {
    const source = score([block(1, 4), block(5, 8), block(9, 12), block(13, 16)].join("\n"));
    const project = compileScoreText(source.replace("| C4/1 | C4/1", "| C4/1 |\n C4/1")).project;
    expect(project.lengthTicks).toBe(16 * 3840);
    expect(project.structure.phraseBoundaries).toEqual([]);
    expect(buildHarmonyAnalysis(project).phraseSegments).toHaveLength(1);
    expect(project.satbTracks[0].notes).toHaveLength(16);
  });

  it("跨块延音合并为同一次起奏，同音重奏保留独立事件", () => {
    const project = compileScoreText(score([
      block(1, 1, "E#4/1@held~"), block(2, 2, "E#4/2 E#4/4 r/4"),
    ].join("\n"), "key F# minor")).project;
    expect(project.satbTracks[0].notes).toMatchObject([
      { startTick: 0, durationTicks: 5760, pitch: { step: "E", alter: 1, octave: 4 } },
      { startTick: 5760, durationTicks: 960 },
    ]);
    expect(project.structure.phraseBoundaries).toEqual([]);
  });

  it("准确保留同音异名、重升音、三连音、附点与显式还原音", () => {
    const compiled = compileScoreText(score(block(1, 1, "E#4/8*2/3 F4/8*2/3 F##4/8*2/3 r/2."), "key F# minor"));
    expect(compiled.project.satbTracks[0].notes.map((note) => note.pitch)).toEqual([
      { step: "E", alter: 1, octave: 4 }, { step: "F", alter: 0, octave: 4 }, { step: "F", alter: 2, octave: 4 },
    ]);
    expect(compiled.project.satbTracks[0].notes.map((note) => note.durationTicks)).toEqual([320, 320, 320]);
    expect(durationTicks("1/4")).toBe(960);
    expect(durationTicks("t17")).toBe(17);
    expect(() => durationTicks("7")).toThrow(/精确/);
    expect(() => readPitch("C-2")).toThrow(/MIDI/);
  });

  it("拍的位置按分母单位计，变拍号和拍内分数精确定位", () => {
    const compiled = compileScoreText(score(`${block(1, 1, "C4/2.")}\n${block(2, 2, "D4/2.")}`, "meter 6/8\nat 2:1 meter 3/4\nat 1:2+1/2 tempo 90\nat 2:1 key G major"));
    expect(compiled.project.lengthTicks).toBe(5760);
    expect(compiled.project.tempoEvents[1]).toMatchObject({ tick: 720, bpm: 90 });
    expect(compiled.project.meterEvents[1]).toMatchObject({ tick: 2880, numerator: 3, denominator: 4 });
    expect(positionTick("3:1", buildMeasures(compiled.project))).toBe(5760);
  });

  it("应用经过四六、和弦外音、乐句和范围终止式标注", () => {
    const source = score(block(1, 2), `title "标注 // 保留引号内注释符"`);
    const compiled = compileScoreText(`${source}\nannotations {\nchord c1 at=1:1 duration=1 symbol=I64 role=passing64\nchord c2 at=2:1 duration=1 symbol=T\nnote S@1:1 role=passing velocity=75\nphrase p1 range=[1:1,3:1)\ncadence k1 phrase=p1 range=[1:1,3:1)\n kind=full form=authentic completion=perfect\n}`);
    expect(compiled.project.chordTrack.regions[0].semantics?.cadenceRole).toBe("passing64");
    expect(compiled.project.satbTracks[0].notes[0]).toMatchObject({ nonChordToneRole: "passing", velocity: 75 });
    expect(compiled.project.chordTrack.cadenceAnnotations[0]).toMatchObject({ fromTick: 0, toTick: 7680, phraseId: "phrase-0-7680" });
  });

  it("参考和弦、音符角色、乐句、终止式完全隔离，允许复用标注短名", () => {
    const source = `${score(block(1, 2, "C4/1@n1"))}\nannotations {\nnote n1 locked=true\n}\nreference complete=chord,note,phrase,cadence {\nchord c1 range=[1:1,3:1) symbol=I64 role=passing64\nnote n1 role=passing\nphrase p1 range=[1:1,2:1)\nphrase p2 range=[2:1,3:1)\ncadence k1 phrase=p2 range=[2:1,3:1) kind=half\n}`;
    // Give the second bar a distinct alias while leaving the same pitches.
    const compiled = compileScoreText(source.replace("C4/1@n1 | C4/1@n1", "C4/1@n1 | C4/1"));
    expect(compiled.project.chordTrack.regions).toEqual([]);
    expect(compiled.project.structure.phraseBoundaries).toEqual([]);
    expect(compiled.project.satbTracks[0].notes[0].nonChordToneRole).toBeUndefined();
    expect(compiled.reference.notes[0].role).toBe("passing");
    expect(compiled.reference.cadences[0].kind).toBe("half");
    expect(compiled.reference.phrases).toHaveLength(2);
  });

  it("参考标注空集只有显式 complete 才表达完整性", () => {
    expect(compileScoreText(score(block(1))).reference.complete).toEqual([]);
    expect(compileScoreText(`${score(block(1))}\nreference complete=cadence {\n}`).reference.complete).toEqual(["cadence"]);
  });

  it("H 行短别名可附加角色，并可独立保存待识别角色", () => {
    const given = compileScoreText(rolesSource);
    const passing = given.project.chordTrack.regions.find((chord) => chord.id === given.aliases.passing_chord)!;
    expect(passing.semantics?.cadenceRole).toBe("passing64");
    expect(passing.identity.bass).toEqual({ step: "D", alter: 0 });
    expect(given.project.satbTracks[0].notes.find((note) => note.id === given.aliases.passing_note)?.nonChordToneRole).toBe("passing");
    const reference = compileScoreText(rolesSource.replace("annotations {", "reference {"));
    expect(reference.project.chordTrack.regions.find((chord) => chord.id === reference.aliases.passing_chord)?.semantics?.cadenceRole).toBeUndefined();
    expect(reference.reference.chords[0].semantics?.cadenceRole).toBe("passing64");
    expect(reference.project.structure.phraseBoundaries).toEqual([]);
  });

  it("音符别名与源码位置可用于诊断映射", () => {
    const compiled = compileScoreText(score(block(1, 1, "D4/1@melody")));
    const id = compiled.aliases.melody;
    expect(compiled.aliases["S@1:1"]).toBe(id);
    expect(compiled.sourceMap[id]).toMatchObject({ line: 4, voice: "S", measure: 1 });
  });

  it("规则用例投影保留由简写生成的乐句边界", () => {
    const compiled = compileScoreText(`${score(block(1, 2))}\nannotations {\nphrase p1 range=[1:1,2:1)\nphrase p2 range=[2:1,3:1)\n}`);
    const fixture = createRuleTestCase({ project: compiled.project }).project;
    const restored = materializeRuleTestProject(fixture, "还原");
    expect(restored.structure).toEqual(compiled.project.structure);
    expect(buildHarmonyAnalysis(restored).phraseSegments).toHaveLength(2);
  });

  it.each(["T", "t", "D7", "D6/5", "I64", "ii6", "viio7", "V7/II", "K46", "Fr+6"])("支持和弦记法 %s", (symbol) => {
    const compiled = compileScoreText(`${score(block(1))}\nannotations {\nchord c at=1:1 duration=1 symbol=${symbol}\n}`);
    expect(validateProject(compiled.project)).toBe(true);
    expect(compiled.project.chordTrack.regions).toHaveLength(1);
  });

  it.each([
    ["不完整时值", score(block(1, 1, "C4/2")), /时值不完整/],
    ["溢出时值", score(block(1, 1, "C4/1 C4/4")), /超出当前小节/],
    ["重复块", score(`${block(1)}\n${block(1)}`), /连续排列/],
    ["缺失块", score(`${block(1)}\n${block(3)}`), /连续排列/],
    ["缺失声部", score(block(1).replace("A: empty\n", "")), /缺少 A/],
    ["未关闭块", score(block(1).slice(0, -1)), /未关闭/],
    ["重复声明", score(block(1), "meter 4/4\nmeter 3/4"), /重复声明/],
    ["重复声部", score(block(1).replace("A: empty", "S: | D4/1 |\nA: empty")), /重复声部/],
    ["多余小节线", score(block(1).replace("C4/1 |", "C4/1 ||")), /超出块范围/],
    ["未结束延音", score(block(1, 1, "C4/1~")), /延音/],
    ["异音延音", score(`${block(1, 1, "C4/1~")}\n${block(2, 2, "D4/1")}`), /音高相同/],
    ["未知音符", `${score(block(1))}\nannotations {\nnote S@1:2 role=passing\n}`, /起奏音符/],
    ["未知字段", `${score(block(1))}\nannotations {\nnote S@1:1 roel=passing\n}`, /不支持属性/],
    ["重复属性", `${score(block(1))}\nannotations {\nnote S@1:1 role=passing role=neighbor\n}`, /重复属性/],
    ["未知乐句", `${score(block(1))}\nreference {\ncadence c phrase=p1 range=[1:1,2:1) kind=half\n}`, /未声明的乐句/],
    ["不精确位置", `${score(block(1))}\nat 1:1+1/7 tempo 90`, /精确/],
    ["重复事件", score(block(1), "at 1:2 tempo 90\nat 1:2 tempo 100"), /重复设置速度/],
  ])("拒绝 %s", (_name, source, pattern) => {
    expect(() => compileScoreText(source)).toThrow(pattern);
  });

  it("错误带行、列、声部和全局小节位置", () => {
    try { compileScoreText(score(`${block(1)}\n${block(2, 2, "C4/2")}`)); }
    catch (error) {
      expect(error).toBeInstanceOf(ScoreTextError);
      expect((error as ScoreTextError).location).toMatchObject({ measure: 2, voice: "S" });
      expect((error as Error).message).toMatch(/第 \d+ 行，第 \d+ 列/);
      return;
    }
    throw new Error("错误用例意外通过");
  });
});

describe("局部替换", () => {
  const replacement: ScoreBlock = { from: 2, to: 2, voices: { S: "| D4/1 |", A: "empty", T: "empty", B: "empty" } };
  it("只替换指定小节并保留工程配置，原工程可直接用于撤销", () => {
    const original = compileScoreText(score(block(1, 3))).project;
    original.author = "作者";
    original.audio.masterVolume = 0.2;
    original.ruleProfile.builtin["voice.range"].severity = "off";
    const before = structuredClone(original);
    const next = replaceScoreBlock(original, replacement).project;
    expect(original).toEqual(before);
    expect(next.satbTracks[0].notes.map((note) => note.pitch.step)).toEqual(["C", "D", "C"]);
    expect(next.audio).toEqual(original.audio);
    expect(next.ruleProfile).toEqual(original.ruleProfile);
    expect(next.author).toBe("作者");
    expect(next.satbTracks[0].notes[0]).toEqual(original.satbTracks[0].notes[0]);
  });

  it.each(["note", "track", "range"])("尊重 %s 锁定，失败时不修改原工程", (kind) => {
    const original = compileScoreText(score(block(1, 3))).project;
    if (kind === "note") original.satbTracks[0].notes[1].locked = true;
    if (kind === "track") original.satbTracks[0].locked = true;
    if (kind === "range") original.exercise.editableRanges.push({ id: "locked", voiceIds: ["soprano"], fromTick: 3840, toTick: 7680, editable: false });
    const before = structuredClone(original);
    expect(() => replaceScoreBlock(original, replacement)).toThrow(/锁定/);
    expect(original).toEqual(before);
  });

  it("跨替换边界的长音不会被隐式截断", () => {
    const original = compileScoreText(score(`${block(1, 1, "C4/1~")}\n${block(2)}`)).project;
    expect(() => replaceScoreBlock(original, replacement)).toThrow(/完整延音/);
    expect(original.satbTracks[0].notes[0].durationTicks).toBe(7680);
  });
});
