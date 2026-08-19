import { describe, expect, it } from "vitest";
import { createEmptyProject, PPQ } from "../../project";
import { createChordRegion, defaultChordDraftAtTick } from "../../chords";
import type { HarmonyDiagnostic } from "../runtime";
import { cloneRuleTestCase } from "./clone";
import { expectedDiagnosticFromActual } from "./comparator";
import { createRuleTestCase } from "./factory";

describe("规则用例复制", () => {
  it("为工程对象和预期引用建立全新的 ID 映射", () => {
    const project = createEmptyProject("原始用例");
    const noteId = "source-note";
    project.satbTracks[0].notes.push({
      id: noteId,
      startTick: 0,
      durationTicks: PPQ,
      pitch: { step: "C", alter: 0, octave: 5 },
      velocity: 88,
      locked: false,
      spellingSource: "manual",
    });
    const chord = createChordRegion(
      project,
      0,
      PPQ,
      defaultChordDraftAtTick(project, 0),
      "source-chord",
    );
    project.chordTrack.regions.push(chord);
    const testCase = createRuleTestCase({ project, ruleId: "voice.range" });
    const actual: HarmonyDiagnostic = {
      id: "diagnostic-1",
      ruleId: "voice.range",
      source: "builtin",
      severity: "error",
      messageKey: "voice.range",
      title: "超出音域",
      message: "超出音域",
      tick: 0,
      endTick: 0,
      noteIds: [noteId],
      chordIds: [chord.id],
      voiceIds: ["soprano"],
      evidence: [],
      params: {},
      confidence: 1,
    };
    testCase.expected.diagnostics = [
      expectedDiagnosticFromActual(actual, "expected-1"),
    ];

    const copy = cloneRuleTestCase(testCase);
    const copiedNoteId = copy.project.satbTracks[0].notes[0].id;
    const copiedChordId = copy.project.chordTrack.regions[0].id;
    expect(copy.id).not.toBe(testCase.id);
    expect(copy.title).toContain("副本");
    expect(copiedNoteId).not.toBe(noteId);
    expect(copiedChordId).not.toBe(chord.id);
    expect(copy.expected.diagnostics[0].id).not.toBe("expected-1");
    expect(copy.expected.diagnostics[0].noteIds).toEqual([copiedNoteId]);
    expect(copy.expected.diagnostics[0].chordIds).toEqual([copiedChordId]);
  });

  it("同步复制时间事件和和弦语义引用", () => {
    const project = createEmptyProject("含语义的用例");
    const chord = createChordRegion(
      project,
      0,
      PPQ,
      defaultChordDraftAtTick(project, 0),
      "semantic-chord",
    );
    project.chordTrack.regions.push(chord);
    const testCase = createRuleTestCase({ project });
    const copy = cloneRuleTestCase(testCase);
    const originalInterpretationId =
      chord.semantics?.interpretations[0]?.id;
    const copiedInterpretationId =
      copy.project.chordTrack.regions[0].semantics?.interpretations[0]?.id;

    expect(copy.project.tempoEvents[0].id).not.toBe(
      project.tempoEvents[0].id,
    );
    expect(copy.project.meterEvents[0].id).not.toBe(
      project.meterEvents[0].id,
    );
    expect(copy.project.keyEvents[0].id).not.toBe(project.keyEvents[0].id);
    expect(copiedInterpretationId).toBeDefined();
    expect(copiedInterpretationId).not.toBe(originalInterpretationId);
    expect(
      copy.project.chordTrack.regions[0].semantics?.primaryInterpretationId,
    ).toBe(copiedInterpretationId);
  });
});
