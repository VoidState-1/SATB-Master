import { describe, expect, it } from "vitest";
import { createEmptyProject, PPQ } from "../../../project";
import { spellMidi } from "../../../pitch";
import { buildHarmonyAnalysis } from "../../analysis";
import {
  correctionChord,
  correctionNote,
  setCorrectionVoice,
} from "../../rule-engine-correction/fixtures";
import { createHarmonyRuleContext } from "../context/createRuleContext";

function diagnosticContext() {
  const project = createEmptyProject();
  project.lengthTicks = PPQ * 2;
  const first = correctionChord("first", 0, PPQ);
  const second = correctionChord("second", PPQ, PPQ);
  second.identity.root = { step: "G", alter: 0 };
  second.identity.bass = { step: "G", alter: 0 };
  project.chordTrack.regions = [first, second];
  setCorrectionVoice(project, "alto", [
    correctionNote("alto-0", 0, spellMidi(60), PPQ),
    correctionNote("alto-1", PPQ, spellMidi(62), PPQ),
  ]);
  return createHarmonyRuleContext(buildHarmonyAnalysis(project));
}

describe("DiagnosticFactory", () => {
  it("从 note、span 与 connection 视图生成稳定范围、证据和 subjects", () => {
    const context = diagnosticContext();
    const notes = context.notes({ voiceId: "alto" }).toArray();
    const spans = context.spans().toArray();
    const connection = context.connections().first()!;

    const noteDiagnostic = context.diagnostics.forNotes({
      ruleId: "test.note",
      notes,
      title: "音符测试",
      message: "音符诊断",
      subjects: { origin: { spanIds: [spans[0].span.id] } },
    });
    expect(noteDiagnostic).toMatchObject({
      tick: 0,
      endTick: PPQ * 2,
      voiceIds: ["alto"],
      noteIds: ["alto-0", "alto-1"],
      subjects: {
        origin: {
          voiceIds: ["alto"],
          noteIds: ["alto-0", "alto-1"],
          spanIds: [spans[0].span.id],
        },
      },
    });

    const spanDiagnostic = context.diagnostics.forSpan({
      ruleId: "test.span",
      span: spans[0],
      title: "Span 测试",
      message: "Span 诊断",
    });
    expect(spanDiagnostic.chordIds).toEqual(["first"]);
    expect(spanDiagnostic.subjects?.origin?.spanIds).toEqual([
      spans[0].span.id,
    ]);

    const connectionDiagnostic = context.diagnostics.forConnection({
      ruleId: "test.connection",
      connection,
      title: "连接测试",
      message: "连接诊断",
      causeRefs: ["test.connection|cause"],
      coverageRefs: ["test.parent|cause"],
    });
    expect(connectionDiagnostic.chordIds).toEqual(["first", "second"]);
    expect(connectionDiagnostic.subjects).toMatchObject({
      origin: { spanIds: [connection.source.span.id] },
      failure: { spanIds: [connection.target.span.id] },
    });
  });

  it("拒绝非法 ruleId、范围、引用与非当前 revision 视图", () => {
    const context = diagnosticContext();
    const note = context.notes().first()!;
    const otherContext = diagnosticContext();
    const other = otherContext.notes().first()!;

    expect(() =>
      context.diagnostics.forNotes({
        ruleId: " ",
        notes: [note],
        title: "测试",
        message: "测试",
      }),
    ).toThrow(/ruleId/);
    expect(() =>
      context.diagnostics.forNotes({
        ruleId: "test.range",
        notes: [note],
        tick: -1,
        title: "测试",
        message: "测试",
      }),
    ).toThrow(/范围/);
    expect(() =>
      context.diagnostics.forNotes({
        ruleId: "test.reference",
        notes: [note],
        title: "测试",
        message: "测试",
        subjects: { context: { noteIds: ["missing"] } },
      }),
    ).toThrow(/不存在的音符/);
    expect(() =>
      context.diagnostics.forNotes({
        ruleId: "test.revision",
        notes: [other],
        title: "测试",
        message: "测试",
      }),
    ).toThrow(/非当前 revision/);
    expect(() =>
      context.diagnostics.forSpan({
        ruleId: "test.span-revision",
        span: otherContext.spans().first()!,
        title: "测试",
        message: "测试",
      }),
    ).toThrow(/非当前 revision/);
    expect(() =>
      context.diagnostics.forConnection({
        ruleId: "test.connection-revision",
        connection: otherContext.connections().first()!,
        title: "测试",
        message: "测试",
      }),
    ).toThrow(/非当前 revision/);
  });

  it("拒绝重复、空白和自覆盖的结构化根因引用", () => {
    const context = diagnosticContext();
    const span = context.spans().first()!;
    const base = {
      ruleId: "test.references",
      span,
      title: "测试",
      message: "测试",
    } as const;

    expect(() =>
      context.diagnostics.forSpan({
        ...base,
        causeRefs: ["same", "same"],
      }),
    ).toThrow(/重复引用/);
    expect(() =>
      context.diagnostics.forSpan({
        ...base,
        coverageRefs: [" "],
      }),
    ).toThrow(/空白/);
    expect(() =>
      context.diagnostics.forSpan({
        ...base,
        causeRefs: ["same"],
        coverageRefs: ["same"],
      }),
    ).toThrow(/覆盖自身根因/);
  });
});
