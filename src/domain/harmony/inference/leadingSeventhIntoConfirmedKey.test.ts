import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../scoreText";
import { checkHarmony } from "../registry";
import { applyHarmonyInference, inferHarmony } from "./index";
import { inferLocalKeys } from "./localKeys";
import { buildChordInferenceObservations } from "./observations";

const evidenceCode = "written-leading-seventh-into-confirmed-key";

function projectFor(leading = "A#4", altoArrival = "B4", tenorArrival = "F#4", firstSurfaceNote = "F#5") {
  return compileScoreText(`satb 1
key Ab major
meter 4/4
bars 1..4 {
  S: | Ab5/2 Eb5/4 G5/4 | r/4 ${firstSurfaceNote}/8 E5/8 D5/4 B5/4 | F#5/2 A#5/4 F#5/4 | B5/2 F#5/2 |
  A: | C5/2. ${leading}/4 | ${altoArrival}/1 | A#4/2 C#5/4 A#4/4 | B4/1 |
  T: | Eb4/2. C#4/4 | ${tenorArrival}/1 | C#4/2 F#4/2 | F#4/1 |
  B: | Ab2/2. E3/4 | D3/1 | F#3/2 E3/2 | D3/1 |
}`).project;
}

function run(project: ReturnType<typeof projectFor>) {
  const pivotTick = 3 * project.ppq;
  const arrivalTick = 4 * project.ppq;
  const inferred = inferHarmony(project);
  const pivot = inferred.chordInference.regions.find(region => region.fromTick === pivotTick);
  const written = applyHarmonyInference(project, inferred, { mode: "fill-gaps", writeNonChordToneRoles: true });
  const accepted = pivot?.selected?.evidence.some(item => item.code === evidenceCode) === true;
  return { pivot, written, accepted, pivotTick, arrivalTick };
}

describe("完整实写导减七直接进入已确认新调", () => {
  it("低三声部在女高休止时写全 b 小调 t6，后续属主确认 A♯°7/E", () => {
    const { pivot, written, accepted, pivotTick, arrivalTick } = run(projectFor());
    expect(accepted).toBe(true);
    expect(pivot).toMatchObject({
      status: "resolved",
      selected: {
        identity: {
          root: { step: "A", alter: 1 },
          bass: { step: "E", alter: 0 },
          structure: { kind: "tertian", quality: "diminished7" },
        },
        semantics: {
          interpretations: [expect.objectContaining({
            localKey: { tonic: { step: "B", alter: 0 }, mode: "minor" },
          })],
        },
      },
    });
    expect(written.project.chordTrack.regions.find(region => region.startTick === pivotTick)?.identity.root)
      .toEqual({ step: "A", alter: 1 });
    const focus = new Set(["chord.incomplete-members", "chord.unclassified-nonchord-tone", "resolution.leading-tone"]);
    expect(checkHarmony(written.project).diagnostics.filter(item =>
      (item.tick === pivotTick || item.tick === arrivalTick) && focus.has(item.ruleId),
    )).toEqual([]);
  });

  it.each([
    ["等音写成 B♭", "Bb4", "B4", "F#4"],
    ["导音跳至属音", "A#4", "F#5", "B4"],
  ])("%s 时不回溯后调导减七", (_label, leading, alto, tenor) => {
    expect(run(projectFor(leading, alto, tenor)).accepted).toBe(false);
  });

  it("女低在落点休止，导音在女高解决时也能核对新调主和弦", () => {
    const { project } = compileScoreText(`satb 1
key Ab major
meter 4/4
bars 1..4 {
 S: | C5/2. A#4/4 | B4/1 | F#5/2 A#5/4 F#5/4 | B5/2 F#5/2 |
 A: | Ab4/2 Eb4/4 G4/4 | r/4 F#4/8 E4/8 D4/4 B4/4 | A#4/2 C#5/4 A#4/4 | B4/1 |
 T: | Eb4/2. C#4/4 | F#4/1 | C#4/2 F#4/2 | F#4/1 |
 B: | Ab2/2. E3/4 | D3/1 | F#3/2 E3/2 | D3/1 |
}`);
    expect(run(project).accepted).toBe(true);
  });

  it("目的小三和弦缺少后调属主证据时不回溯", () => {
    const project = projectFor();
    project.lengthTicks = 8 * project.ppq;
    for (const track of project.satbTracks) {
      track.notes = track.notes.filter(note => note.startTick < project.lengthTicks);
    }
    expect(run(project).accepted).toBe(false);
  });

  it("人工句界阻断后调属主的回溯", () => {
    const project = projectFor();
    project.structure.phraseBoundaries = [{
      id: "phrase-cut", tick: 4 * project.ppq, source: "manual", confidence: "certain",
    }];
    expect(run(project).accepted).toBe(false);
  });

  it("降 A 大调中途改为 E 大调再返回，原调相同也不跨两个调号事件", () => {
    const project = projectFor();
    const initial = project.keyEvents[0];
    project.keyEvents.push(
      { ...initial, id: "changed-signature", tonic: { step: "E", alter: 0 }, tick: 5 * project.ppq },
      { ...initial, id: "restored-signature", tick: 6 * project.ppq },
    );
    const proof = inferLocalKeys(buildChordInferenceObservations(project), new Set([project.lengthTicks]));
    expect([...proof.values()].some(({ key }) =>
      key.tonic.step === "B" && key.tonic.alter === 0 && key.mode === "minor",
    )).toBe(true);
    expect(run(project).accepted).toBe(false);
  });

  it("到达后的女高和弦音低过持续的实际低音 D3 时拒绝回溯", () => {
    const project = projectFor("A#4", "B4", "F#4", "B2");
    const { accepted, written, arrivalTick } = run(project);
    expect(accepted).toBe(false);
    expect(checkHarmony(written.project).diagnostics.some(item =>
      item.tick === arrivalTick + project.ppq && item.ruleId === "voice.crossing",
    )).toBe(true);
  });
});
