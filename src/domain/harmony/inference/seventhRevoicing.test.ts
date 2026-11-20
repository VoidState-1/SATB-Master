import { describe, expect, it } from "vitest";
import { PPQ } from "../../project";
import { compileScoreText } from "../../scoreText";
import { checkHarmony } from "../registry";
import { applyHarmonyInference, inferHarmony } from "./harmonyInference";
import type { ChordInferenceOptions } from "./types";

const example = {
  key: "Bb major", soprano: "A4/2 Bb4/4", alto: "F4/2 F4/4",
  tenor: "C4/4 F3/4 F3/4", bass: "Eb3/2 D3/4",
};
function project(parts: Partial<typeof example> = {}) {
  const { key, soprano, alto, tenor, bass } = { ...example, ...parts };
  return compileScoreText(`satb 1
key ${key}
meter 3/4
bars 1..1 {
 S: | ${soprano} |
 A: | ${alto} |
 T: | ${tenor} |
 B: | ${bass} |
}`).project;
}
function region(score: ReturnType<typeof project>, tick = PPQ, options?: ChordInferenceOptions) {
  return inferHarmony(score, options).chordInference.regions.find(r => r.fromTick <= tick && tick < r.toTick);
}
const code = "single-voice-seventh-revoicing";

describe("完整七和弦陈述后的弱位换音", () => {
  it("男高五音下跳到根音，固定七音低音随后解决；保持实际缺五与原始角色", () => {
    const score = project();
    const inference = inferHarmony(score);
    expect(region(score)).toMatchObject({
      status: "resolved", selected: {
        functionalBaseId: "D", confidence: "medium",
        identity: { root: { step: "F", alter: 0 }, bass: { step: "E", alter: -1 } },
        fit: { omittedChordDegrees: [5], nonChordToneNoteIds: [], nonChordToneAssignments: {} },
        evidence: expect.arrayContaining([{ kind: "sequence-context", code, noteIds: ["note-T-0", "note-T-960"] }]),
      },
    });
    const applied = applyHarmonyInference(score, inference, { mode: "fill-gaps", writeNonChordToneRoles: true });
    expect(applied.writtenNonChordToneRoleCount).toBe(0);
    expect(applied.project.satbTracks).toEqual(score.satbTracks);
    expect(checkHarmony(applied.project).diagnostics).toContainEqual(expect.objectContaining({
      ruleId: "chord.incomplete-members", tick: PPQ, severity: "warning", params: { missing: "C" },
    }));
    expect(region(score, 2 * PPQ)?.selected?.identity).toMatchObject({ root: { step: "B", alter: -1 }, bass: { step: "D" } });
    expect(region(score, PPQ, { minConfidence: "high" })?.status).toBe("unclassified");
  });

  it.each([
    ["五音改重三音", { tenor: "C4/4 A3/4 F3/4" }],
    ["低音原音重新起奏", { bass: "Eb3/4 Eb3/4 D3/4" }],
    ["另一上声部原音重奏", { soprano: "A4/4 A4/4 Bb4/4" }],
    ["五音异名", { tenor: "B#3/4 F3/4 F3/4" }],
    ["省五延续两拍", { soprano: "A4/2.", alto: "F4/2.", tenor: "C4/4 F3/2", bass: "Eb3/2." }],
  ] satisfies [string, Partial<typeof example>][])("%s 保留推导缺口", (_label, parts) => {
    expect(region(project(parts))?.status).toBe("unclassified");
  });

  it.each([
    ["major7", { soprano: "D5/2 A4/4", alto: "Bb4/2 F4/4", tenor: "F4/4 Bb3/4 D4/4", bass: "A3/2 Bb2/4" }],
    ["minor7", { soprano: "Eb5/2 Bb4/4", alto: "C5/2 G4/4", tenor: "G4/4 C4/4 Eb4/4", bass: "Bb3/2 C3/4" }],
  ] satisfies [string, Partial<typeof example>][])("%s 延续同一拼写和转位", (quality, parts) => {
    const selected = region(project(parts))?.selected;
    expect(selected?.identity.structure).toMatchObject({ quality });
    expect(selected?.evidence.some(e => e.code === code)).toBe(true);
  });

  it("半减七、重属和已记外音保留各自推导入口", () => {
    const halfDiminished = project({ soprano: "C5/2 Bb4/4", alto: "A4/2 F4/4", tenor: "Eb4/4 A3/4 F3/4", bass: "G3/2 D3/4" });
    const applied = project({ key: "C major", soprano: "F#4/2 G4/4", alto: "D4/2 D4/4", tenor: "A3/4 D3/4 D3/4", bass: "C3/2 B2/4" });
    const decorated = project();
    decorated.satbTracks.find(t => t.id === "tenor")!.notes[1].nonChordToneRole = "anticipation";
    for (const score of [halfDiminished, applied, decorated]) {
      expect(region(score)?.selected?.evidence.some(e => e.code === code)).not.toBe(true);
    }
  });

  it("先不完整后出现五音，保留此前的缺口", () => {
    const score = project({ tenor: "F3/4 C4/4 F3/4" });
    expect(region(score, 0)?.status).toBe("unclassified");
    expect(region(score)?.selected?.identity.structure).toMatchObject({ quality: "dominant7" });
  });

  it("失去根音后保留实际完整的减三和弦", () => {
    const score = project({ alto: "F4/4 C4/4 F4/4", tenor: "C4/2 F3/4" });
    expect(region(score)?.selected?.identity).toMatchObject({
      root: { step: "A", alter: 0 }, bass: { step: "E", alter: -1 }, structure: { quality: "diminished" },
    });
  });

  it("同级弱拍不能证明前一陈述更强", () => {
    const score = project({ soprano: "r/4 A4/2", alto: "r/4 F4/2", tenor: "r/4 C4/4 F3/4", bass: "r/4 Eb3/2" });
    expect(region(score, 2 * PPQ)?.status).toBe("unclassified");
  });

  it("句界或新调号事件切断借用", () => {
    const phrase = project();
    phrase.structure.phraseBoundaries = [{ id: "cut", tick: PPQ, source: "manual", confidence: "certain" }];
    expect(region(phrase)?.status).toBe("unclassified");
    const key = project();
    key.keyEvents.push({ ...key.keyEvents[0], id: "new-key", tick: PPQ });
    expect(region(key)?.status).toBe("unclassified");
  });
});
