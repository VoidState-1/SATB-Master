
import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../scoreText";
import { applyHarmonyInference, buildHarmonyAnalysis, checkHarmony, inferChords } from "../index";

const ppq = 960;
const landingTick = 4 * ppq;

interface Fixture {
  target?: readonly string[];
  preparation?: readonly string[];
  source?: readonly string[];
  weakLanding?: boolean;
  annotations?: boolean;
  key?: "Eb major" | "Eb minor";
}

function score({
  target = ["Eb5/4 r/2.", "G4/4 r/2.", "r/1", "Eb3/4 r/2."],
  preparation = ["Eb5/4", "C5/4", "Ab3/4", "Ab2/4"],
  source = ["D5/4", "Ab4/4", "F4/4", "Bb2/4"],
  weakLanding = false, annotations = false, key = "Eb major",
}: Fixture = {}) {
  const lines = ["satb 1", "key " + key, weakLanding ? "meter 3/4" : "meter 4/4", "bars 1..2 {"];
  for (const [i, voice] of ["S", "A", "T", "B"].entries()) {
    if (weakLanding) {
      const attack = i === 2 ? "r/4" : target[i].split(" ")[0];
      lines.push(voice + ": | " + preparation[i] + " r/4 " + source[i] + " | r/4 " + attack + " r/4 |");
    } else {
      const gap = source[i].endsWith("/2") ? " | " : " r/4 | ";
      lines.push(voice + ": | " + preparation[i] + " r/4 " + source[i] + gap + target[i] + " |");
    }
  }
  if (annotations) lines.push("H: | IV/4 r/4 V7/4 r/4 | I/4 r/2. |");
  return compileScoreText([...lines, "}"].join("\n")).project;
}

function analyze(raw: ReturnType<typeof score>) {
  const chords = inferChords(raw);
  const { project } = applyHarmonyInference(raw, { chordInference: chords }, { mode: "replace-unlocked" });
  const analysis = buildHarmonyAnalysis(project);
  const recovered = analysis.cadenceCandidates.find(c => c.evidence.some(e => e.code === "detached-sparse-tonic"));
  return { project, analysis, chords, recovered };
}

describe("A sparse closing tonic after two detached harmonies", () => {
  it.each([
    ["G4/4 r/2.", "r/1"],
    ["r/1", "G3/4 r/2."],
  ])("recognizes the two roots and whichever inner track actually contains the third", (alto, tenor) => {
    const { project, analysis, chords, recovered } = analyze(score({
      target: ["Eb5/4 r/2.", alto, tenor, "Eb3/4 r/2."],
    }));
    expect(recovered).toMatchObject({
      kind: "full", form: "authentic", completion: "perfect", confidence: "probable",
      fromTick: 2 * ppq, unharmonizedLandingTick: landingTick, toTick: 5 * ppq,
    });
    expect(chords.regions.find(r => r.fromTick <= landingTick && landingTick < r.toTick)?.status).toBe("unclassified");
    const arrival = analysis.slices.find(slice => slice.tick === landingTick)!;
    expect(Object.keys(arrival.notes)).toHaveLength(3);
    expect(arrival.chord).toBeUndefined();
    expect(recovered?.chordIds).toEqual(project.chordTrack.regions
      .filter(c => c.startTick === 2 * ppq).map(c => c.id));
    expect(checkHarmony(project).diagnostics.filter(d => d.ruleId.startsWith("cadence."))).toEqual([]);
  });

  it("reads the actual minor third in the established minor key", () => {
    const { recovered, analysis } = analyze(score({
      key: "Eb minor", preparation: ["Eb5/4", "Cb5/4", "Ab3/4", "Ab2/4"],
      target: ["Eb5/4 r/2.", "Gb4/4 r/2.", "r/1", "Eb3/4 r/2."],
    }));
    expect(recovered?.unharmonizedLandingTick).toBe(landingTick);
    expect(analysis.slices.find(s => s.tick === landingTick)?.chord).toBeUndefined();
  });

  it.each<readonly [string, Fixture]>([
    ["root and third in only two written voices", { target: ["r/1", "G4/4 r/2.", "r/1", "Eb3/4 r/2."] }],
    ["missing the written third", { target: ["Eb5/4 r/2.", "Bb4/4 r/2.", "r/1", "Eb3/4 r/2."] }],
    ["the other mode's written third", { target: ["Eb5/4 r/2.", "Gb4/4 r/2.", "r/1", "Eb3/4 r/2."] }],
    ["competing bass instead of the root", { target: ["Eb5/4 r/2.", "G4/4 r/2.", "r/1", "C3/4 r/2."] }],
    ["a weak arrival in an otherwise identical rhythm", { weakLanding: true }],
    ["independent solo music after a complete rest", { target: ["Eb5/4 r/4 F5/2", "G4/4 r/2.", "r/1", "Eb3/4 r/2."] }],
    ["an early release of the third", { target: ["Eb5/4 r/2.", "G4/8 r/8 r/2.", "r/1", "Eb3/4 r/2."] }],
    ["a sounding note in the shared rest", { source: ["D5/2", "Ab4/4", "F4/4", "Bb2/4"] }],
    ["a dominant without its written seventh", { source: ["D5/4", "Bb4/4", "F4/4", "Bb2/4"] }],
  ])("preserves the undecided landing with %s", (_label, fixture) => {
    expect(analyze(score(fixture)).recovered).toBeUndefined();
  });

  it.each([ppq, 2 * ppq, 3 * ppq, landingTick])("honors a phrase boundary at %i", tick => {
    const project = score();
    project.structure.phraseBoundaries = [{ id: "cut", source: "manual", confidence: "certain", tick }];
    expect(analyze(project).recovered).toBeUndefined();
  });

  it("leaves the original given-chord route in charge when a terminal chord exists", () => {
    const given = buildHarmonyAnalysis(score({ annotations: true })).cadenceCandidates;
    expect(given).toHaveLength(1);
    expect(given[0]).toMatchObject({
      kind: "full", form: "authentic", completion: "perfect", fromTick: 2 * ppq, toTick: 5 * ppq,
    });
    expect(given[0].unharmonizedLandingTick).toBeUndefined();
    expect(given[0].evidence.some(e => e.code === "detached-dominant-to-tonic")).toBe(true);
  });

  it("rejects a same-tonic key event introduced during the shared rest", () => {
    const project = score();
    project.keyEvents.push({ ...project.keyEvents[0], id: "key-reset", tick: 7 * ppq / 2 });
    expect(analyze(project).recovered).toBeUndefined();
  });
});
