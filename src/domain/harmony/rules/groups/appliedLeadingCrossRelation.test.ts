import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../../scoreText";
import { applyHarmonyInference, inferChords } from "../../inference";
import { checkHarmony } from "../../registry";

const rule = "voice-leading.cross-relation-successive";

function parts(soprano: string, alto: string, tenor: string, bass: string, symbols = "") {
  return compileScoreText(`satb 1
key C major
meter 3/4
bars 1..1 {
 S: | ${soprano} |
 A: | ${alto} |
 T: | ${tenor} |
 B: | ${bass} |
 ${symbols && "H: | " + symbols + " |"}
}`).project;
}

function applied(transfer: boolean, blind: boolean) {
  const project = parts(
    (transfer ? "E5" : "G4") + "/4 G#4/4 A4/4",
    (transfer ? "G4" : "E4") + "/4 E4/4 E4/4",
    "C4/4 D4/4 C4/4", "C3/4 B2/4 A2/4",
    blind ? "" : "I/4 V43/VI/4 vi/4",
  );
  return blind ? applyHarmonyInference(project, { chordInference: inferChords(project) },
    { mode: "replace-unlocked", writeNonChordToneRoles: true }).project : project;
}

function relations(p: ReturnType<typeof parts>) {
  return checkHarmony(p).diagnostics.filter(d => d.ruleId === rule && d.tick === p.ppq);
}

describe("副属导音的半音引入", () => {
  it.each([false, true])("保持和弦与解决不变，仅在 G 转交另一声部时提示（盲推 %s）", blind => {
    const good = applied(false, blind);
    const bad = applied(true, blind);
    expect(relations(good)).toEqual([]);
    expect(relations(bad)).toContainEqual(expect.objectContaining({
      severity: "suggestion", voiceIds: ["alto", "soprano"], endTick: 2 * bad.ppq,
      noteIds: expect.arrayContaining(["note-A-0", "note-S-" + bad.ppq]),
    }));
  });

  it("重复音的一份原声部半音上行，另一份下行，保持合法", () => {
    const p = parts("F4/4 Eb4/4 D4/4", "C4/4 C4/4 B3/4",
      "A3/4 A3/4 G3/4", "F3/4 F#3/4 G2/4", "IV/4 viio7/V/4 V/4");
    expect(relations(p)).toEqual([]);
  });

  it("前一个自然音与目标相隔休止时不恢复该提示", () => {
    const p = applied(true, false);
    p.satbTracks.find(t => t.id === "alto")!.notes[0].durationTicks = p.ppq / 2;
    expect(relations(p)).toEqual([]);
  });

  it("写作 Ab 的音与 G 不构成同字母半音移交", () => {
    const p = applied(true, false);
    p.satbTracks.find(t => t.id === "soprano")!.notes[1].pitch = { step: "A", alter: -1, octave: 4 };
    expect(relations(p)).toEqual([]);
  });

  it("后续转入局部小调时仍定位到先前的移交", () => {
    const p = applied(true, false);
    const landing = p.chordTrack.regions[2].semantics!.interpretations[0];
    landing.localKey = { tonic: { step: "A", alter: 0 }, mode: "minor" };
    landing.degree = 1;
    expect(relations(p)).toContainEqual(expect.objectContaining({
      voiceIds: ["alto", "soprano"],
      causeRefs: [expect.stringContaining("connection:")],
    }));
  });

  it("当前连接本身更换局部调时保留豁免", () => {
    const p = applied(true, false);
    const previous = p.chordTrack.regions[0].semantics!.interpretations[0];
    previous.localKey = { tonic: { step: "F", alter: 0 }, mode: "major" };
    previous.degree = 5;
    expect(relations(p)).toEqual([]);
  });

  it("手动句界两侧的副属引入保持原有豁免", () => {
    const p = applied(true, false);
    p.structure.phraseBoundaries.push({ id: "split", tick: p.ppq, source: "manual", confidence: "certain" });
    expect(relations(p)).toEqual([]);
  });
});
