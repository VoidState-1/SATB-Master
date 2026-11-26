import { describe, expect, it } from "vitest";
import { PPQ, type ProjectDocument } from "../../../project";
import { compileScoreText } from "../../../scoreText";
import { applyHarmonyInference, inferHarmony } from "../../inference";
import { checkHarmony } from "../../registry";

function assignedRoles(project: ProjectDocument) {
  return project.satbTracks.flatMap(track => track.notes
    .filter(note => note.nonChordToneRole !== undefined)
    .map(note => ({ voiceId: track.id, tick: note.startTick, role: note.nonChordToneRole })));
}

function findings(project: ProjectDocument) {
  const { diagnostics, skippedRules } = checkHarmony(project);
  expect(skippedRules.filter(skip => skip.reason === "rule-error")).toEqual([]);
  return diagnostics
    .filter(({ ruleId }) => ["chord.unclassified-nonchord-tone", "nonchord.neighbor-tone", "voice.range"].includes(ruleId))
    .map(({ ruleId, severity, tick, voiceIds }) => ({ ruleId, severity, tick, voiceIds }));
}

describe("纯音符作业的外音角色回写", () => {
  const range = { ruleId: "voice.range", severity: "warning", tick: 2 * PPQ, voiceIds: ["alto"] };
  const spelling = { ruleId: "chord.unclassified-nonchord-tone", severity: "warning", tick: 2 * PPQ, voiceIds: ["alto"] };

  it.each([
    { name: "E–D–E 是合法下辅助", alto: "G4", rawExpected: [], inferredExpected: [] },
    { name: "女低 G5 超出音域", alto: "G5", rawExpected: [range], inferredExpected: [range] },
    { name: "女低把 G4 错拼成 F##4", alto: "F##4", rawExpected: [], inferredExpected: [spelling] },
  ])("$name", ({ alto, rawExpected, inferredExpected }) => {
    const { project } = compileScoreText(`satb 1
key C major
meter 4/4
bars 1..1 {
  S: | E5/4 D5/8 E5/8 E5/2 |
  A: | G4/2 ${alto}/2 |
  T: | C4/1 |
  B: | C3/1 |
}`);
    expect(project.chordTrack.regions).toEqual([]);
    expect(assignedRoles(project)).toEqual([]);
    expect(findings(project)).toEqual(rawExpected);

    const inference = inferHarmony(project);
    for (const writeNonChordToneRoles of [false, true]) {
      const applied = applyHarmonyInference(project, inference, { mode: "replace-unlocked", writeNonChordToneRoles }).project;
      expect(applied.chordTrack.regions.length).toBeGreaterThan(0);
      expect(assignedRoles(applied)).toEqual(writeNonChordToneRoles
        ? [{ voiceId: "soprano", tick: PPQ, role: "neighbor" }]
        : []);
      expect(findings(applied), `writeNonChordToneRoles=${writeNonChordToneRoles}`).toEqual(inferredExpected);
    }
  });
});
