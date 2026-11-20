import { describe, expect, it } from "vitest";
import { validateProject } from "../../project";
import { compileScoreText } from "../../scoreText";
import { applyChordInference, inferChords } from "./index";

const shape = {
  root: { step: "A", alter: -1 },
  bass: { step: "G", alter: 0 },
  structure: { kind: "tertian", quality: "major7" },
};

function descendingBass(middle = "G3", landing = "F3", soprano = "C5/2") {
  return compileScoreText(`satb 1
key Ab major
meter 3/4
bars 1..1 {
  S: | ${soprano} Ab4/4 |
  A: | Ab4/2 F4/4 |
  T: | Eb4/2 C4/4 |
  B: | Ab3/4 ${middle}/4 ${landing}/4 |
}`).project;
}

function hasPassingSeventh(result: ReturnType<typeof inferChords>, tick: number) {
  const middle = result.regions.find(region => region.fromTick <= tick && tick < region.toTick);
  return [middle?.selected, ...middle?.alternatives ?? []].some(candidate =>
    candidate?.evidence.some(evidence => evidence.code === "passing-tonic-seventh"),
  );
}

describe("主三和弦经过七音的低音转位", () => {
  it("低音从降 A 经 G 下行至 F 时写入第三转位", () => {
    const project = descendingBass();
    const result = inferChords(project, { minConfidence: "high" });
    const middle = result.regions.find(region => region.fromTick === project.ppq);
    expect(middle).toMatchObject({
      toTick: 2 * project.ppq,
      status: "resolved",
      selected: {
        functionalBaseId: "T",
        identity: shape,
        fit: { nonChordToneNoteIds: [], omittedChordDegrees: [], spellingConsistent: true },
      },
    });
    expect(hasPassingSeventh(result, project.ppq)).toBe(true);

    const application = applyChordInference(project, result, { mode: "fill-gaps", writeNonChordToneRoles: true });
    expect(validateProject(JSON.parse(JSON.stringify(application.project)))).toBe(true);
    expect(application.project.chordTrack.regions.find(region => region.startTick === project.ppq))
      .toMatchObject({ identity: shape, durationTicks: project.ppq });
    expect(application.writtenNonChordToneRoleCount).toBe(0);
  });

  it.each([
    ["停在 G", "G3", "G3", "C5/2"],
    ["回到降 A", "G3", "Ab3", "C5/2"],
    ["等音写成重升 F", "F##3", "F3", "C5/2"],
    ["上声部换八度", "G3", "F3", "C5/4 C6/4"],
  ])("%s 不产生该经过七和弦候选", (_control, middle, landing, soprano) => {
    const project = descendingBass(middle, landing, soprano);
    expect(hasPassingSeventh(inferChords(project), project.ppq)).toBe(false);
  });

  it("上声部加倍根音而缺五音时保留原判", () => {
    const project = descendingBass();
    const tenor = project.satbTracks.find(track => track.voice === "tenor")!;
    tenor.notes[0].pitch = { step: "A", alter: -1, octave: 3 };
    expect(hasPassingSeventh(inferChords(project), project.ppq)).toBe(false);
  });

  it("不跨实际到达处已标的乐句边界或独立调号事件", () => {
    const project = descendingBass();
    const tick = 2 * project.ppq;
    project.structure.phraseBoundaries = [{ id: "phrase-cut", tick, source: "manual", confidence: "certain" }];
    expect(hasPassingSeventh(inferChords(project), project.ppq)).toBe(false);
    project.structure.phraseBoundaries = [];
    project.keyEvents.push({ ...project.keyEvents[0], id: "new-signature", tick, mode: "minor" });
    expect(hasPassingSeventh(inferChords(project), project.ppq)).toBe(false);
  });
});
