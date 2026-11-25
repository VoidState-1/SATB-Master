import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../scoreText";
import { buildHarmonyAnalysis } from "../analysis";
import { inferChords } from "../inference";
import { checkHarmony } from "../registry";
import { metricPositionAt } from "../../rhythm/metric";
import { createSliceStructuralVoicingReader } from "./writtenVoicing";

const bassPassing = `satb 1
key C major
meter 4/4
bars 1..1 {
 S: | E5/2 G5/2 |
 A: | G4/2 E4/2 |
 T: | C4/1 |
 B: | C3/4. D3/4 E3/4. |
 H: | I/2 I6/2 |
}`;

const delayedArrival = `satb 1
key C major
meter 4/4
bars 1..1 {
 S: | B4/2~ B4/4 C5/4 |
 A: | F4/2~ F4/8 E4/4. |
 T: | D4/2 G3/2 |
 B: | G2/2 C3/2 |
 H: | V7/2 I/2 |
}`;

function factsAt(project: ReturnType<typeof compileScoreText>["project"], beat: number) {
  const analysis = buildHarmonyAnalysis(project);
  const read = createSliceStructuralVoicingReader(analysis.slices, analysis.project,
    tick => metricPositionAt(analysis.metricTimeline, tick));
  const slice = analysis.slices.find(slice => slice.tick === beat * project.ppq)!;
  return read(slice.index, slice.chord!.identity);
}

function voicingDiagnostics(project: ReturnType<typeof compileScoreText>["project"], ruleId: string) {
  return checkHarmony(project).diagnostics.filter(item => item.ruleId === ruleId);
}

describe("shared written structural voicing", () => {
  it("follows a single passing bass through a revoicing and restores each written inversion", () => {
    const { project } = compileScoreText(bassPassing);
    for (const [beat, step] of [[1.5, "C"], [2, "E"]] as const) {
      const bass = factsAt(project, beat)?.bass;
      expect(bass?.structural.pitch).toMatchObject({ step, octave: 3 });
      expect(bass?.ornament).toMatchObject({
        voice: "bass", role: "passing",
        departure: { note: { pitch: { step: "C" } } },
        ornaments: [{ pitch: { step: "D" } }],
        arrival: { tick: 2.5 * project.ppq, note: { pitch: { step: "E" } } },
        crossedSliceTicks: [1.5, 2, 2.5].map(beat => beat * project.ppq),
      });
    }
    expect(voicingDiagnostics(project, "chord.inversion-bass")).toEqual([]);
  });

  it.each([
    ["a leap out of the passing pitch", bassPassing.replace("E3/4.", "F3/4.")],
    ["a different chord member wrongly written as the bass", bassPassing.replace("D3/4", "G3/4")],
    ["a purported passing note with a turn and a leap", bassPassing.replace("E3/4.", "B2/4.")],
  ])("keeps inversion errors for %s", (_label, text) => {
    const { project } = compileScoreText(text);
    expect(factsAt(project, 2)?.bass?.ornament).toBeUndefined();
    expect(voicingDiagnostics(project, "chord.inversion-bass")).toContainEqual(expect.objectContaining({
      tick: 2 * project.ppq, severity: "error",
    }));
  });

  it.each(["phrase", "key"] as const)("blocks the whole event chain at a written %s boundary", kind => {
    const { project } = compileScoreText(bassPassing);
    const tick = 2 * project.ppq;
    if (kind === "phrase") project.structure.phraseBoundaries.push({
      id: "manual-cut", tick, source: "manual", confidence: "certain",
    });
    else project.keyEvents.push({ ...project.keyEvents[0], id: "new-key", tick, mode: "minor" });
    expect(factsAt(project, 1.5)?.bass?.ornament).toBeUndefined();
    expect(factsAt(project, 2)?.bass?.ornament).toBeUndefined();
    expect(voicingDiagnostics(project, "chord.inversion-bass")).toHaveLength(2);
  });

  it("does not let the existing bass anticipation fallback cross a manual cut", () => {
    const { project } = compileScoreText(`satb 1
key C major
meter 4/4
bars 1..2 {
 S: | G4/1 | D5/1 |
 A: | E4/1 | G4/1 |
 T: | C4/1 | B3/1 |
 B: | C3/2. B2/4@early | B2/1 |
 H: | I/1 | V6/1 |
}
annotations {
 note early role=anticipation
}`);
    expect(voicingDiagnostics(project, "chord.inversion-bass")).toEqual([]);
    project.structure.phraseBoundaries.push({
      id: "manual-cut", tick: 4 * project.ppq, source: "manual", confidence: "certain",
    });
    expect(voicingDiagnostics(project, "chord.inversion-bass")).toContainEqual(expect.objectContaining({
      tick: 3 * project.ppq, severity: "error",
    }));
  });

  it("uses the held bass preparation and the written resolution past an upper-voice attack", () => {
    const { project } = compileScoreText(`satb 1
key C major
meter 4/4
bars 1..1 {
 S: | D5/2 C5/8 A4/4. |
 A: | B4/2 A4/2 |
 T: | G4/2 C4/2 |
 B: | G3/2~ G3/4 F3/4 |
 H: | V/2 IV/2 |
}`);
    for (const beat of [2, 2.5]) {
      expect(factsAt(project, beat)?.bass).toMatchObject({
        structural: { pitch: { step: "F", octave: 3 } },
        ornament: { role: "suspension", entryTick: 2 * project.ppq, arrival: { tick: 3 * project.ppq } },
      });
    }
    expect(voicingDiagnostics(project, "chord.inversion-bass")).toEqual([]);
    project.satbTracks[3].notes.at(-1)!.pitch.step = "E";
    expect(voicingDiagnostics(project, "chord.inversion-bass")).not.toEqual([]);
  });

  it("restores staggered upper voices for rules, blind inference and authentic cadence", () => {
    const { project } = compileScoreText(delayedArrival);
    expect(factsAt(project, 2)).toMatchObject({
      missing: [], unresolved: [],
      voices: expect.arrayContaining([
        { voice: "soprano", sounding: expect.anything(), structural: expect.objectContaining({ pitch: { step: "C", alter: 0, octave: 5 } }),
          ornament: expect.objectContaining({ role: "retardation", arrival: expect.objectContaining({ tick: 3 * project.ppq }) }) },
        { voice: "alto", sounding: expect.anything(), structural: expect.objectContaining({ pitch: { step: "E", alter: 0, octave: 4 } }),
          ornament: expect.objectContaining({ role: "suspension", arrival: expect.objectContaining({ tick: 2.5 * project.ppq }) }) },
      ]),
    });
    expect(voicingDiagnostics(project, "chord.incomplete-members")).toEqual([]);
    expect(buildHarmonyAnalysis(project).cadenceCandidates).toContainEqual(expect.objectContaining({
      kind: "full", completion: "perfect",
      evidence: expect.arrayContaining([expect.objectContaining({ code: "written-structural-arrival" })]),
    }));

    project.chordTrack.regions = [];
    const result = inferChords(project);
    expect(result.regions).toContainEqual(expect.objectContaining({
      fromTick: 2 * project.ppq, status: "resolved",
      selected: expect.objectContaining({
        functionalBaseId: "T",
        evidence: expect.arrayContaining([expect.objectContaining({ code: "written-structural-voicing" })]),
      }),
    }));
  });

  it("restores a passing note, a neighbor and a held suspension in one voicing", () => {
    const { project } = compileScoreText(`satb 1
key C major
meter 4/4
bars 1..1 {
 S: | C5/4 G5/8 F5/8 E5/2 |
 A: | A4/4 C5/8 D5/8 C5/2 |
 T: | F4/4~ F4/4~ F4/8 E4/8 G4/4 |
 B: | F3/4 C3/2. |
 H: | IV/4 I/2. |
}`);
    const voicing = factsAt(project, 1.5);
    expect(voicing?.voices.map(item => [item.voice, item.ornament?.role, item.structural.pitch.step])).toEqual([
      ["soprano", "passing", "G"], ["alto", "neighbor", "C"],
      ["tenor", "suspension", "E"], ["bass", undefined, "C"],
    ]);
    expect(voicing?.missing).toEqual([]);
  });

  it("does not invent a required third when the prepared voice leaves by leap", () => {
    const { project } = compileScoreText(delayedArrival.replace("E4/4.", "C4/4."));
    expect(factsAt(project, 2)?.missing).toContainEqual({ step: "E", alter: 0 });
    expect(voicingDiagnostics(project, "chord.incomplete-members")).toContainEqual(expect.objectContaining({
      severity: "warning", params: { missing: "E" },
    }));
  });

  it.each([
    ["fifths", "G5/4. A5/4 B5/4."],
    ["octaves", "C5/4. D5/4 E5/4."],
  ])("keeps sounding outer parallel %s in ornamental context", (kind, line) => {
    const { project } = compileScoreText(bassPassing.replace("E5/2 G5/2", line));
    expect(voicingDiagnostics(project, `voice-leading.parallel-${kind}`)).toContainEqual(
      expect.objectContaining({ voiceIds: expect.arrayContaining(["soprano", "bass"]), severity: "error" }),
    );
  });
});
