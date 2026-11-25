import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../scoreText";
import { buildHarmonyAnalysis } from "../analysis";
import { checkHarmony, inferChords } from "../index";
import { inferLocalKeys } from "../inference/localKeys";
import { buildChordInferenceObservations } from "../inference/observations";

const home = "E4 C4 G3 C3";
const g = "G4 B3 D3 G2";
const d7 = "F#4 C4 A3 D3";
const am = "E4 C4 A3 A2";
const g7 = "F4 B3 D3 G2";
const gDominant = "F#4 A3 D3 D2";
const gKey = { tonic: { step: "G", alter: 0 }, mode: "major" } as const;

function projectFor(cells: readonly string[], labels = "") {
  const tracks = ["S", "A", "T", "B"].map((voice, part) => {
    const pitches = cells.map(cell => cell.split(" ")[part] + "/4");
    const bars = Array.from({ length: cells.length / 4 }, (_, i) => pitches.slice(i * 4, i * 4 + 4).join(" "));
    return voice + ": | " + bars.join(" | ") + " |";
  });
  return compileScoreText(`satb 1
key C major
meter 4/4
bars 1..${cells.length / 4} {
${tracks.join("\n")}
}
${labels}`).project;
}

const modulating = [home, home, home, home, d7, g, am, d7, g, g, g, g];

describe("bounded local tonal windows", () => {
  it("distinguishes a single applied dominant from a repeated destination cadence", () => {
    const applied = projectFor([home, home, home, home, d7, g, g7, home]);
    const local = projectFor(modulating);
    const result = (project: typeof local, beat: number) => inferChords(project).regions
      .find(r => r.fromTick <= beat * project.ppq && beat * project.ppq < r.toTick)?.selected?.semantics?.interpretations[0];
    expect(result(applied, 4)).toMatchObject({ appliedTarget: { degree: 5 } });
    expect(result(applied, 5)?.localKey).toBeUndefined();
    expect(result(local, 3)?.localKey).toBeUndefined();
    expect(result(local, 4)).toMatchObject({ degree: 5, localKey: gKey });
    expect(result(local, 8)).toMatchObject({ degree: 1, localKey: gKey });
  });

  it.each(["manual", "manual inside the dominant", "written key"] as const)(
    "%s prevents the second landing from confirming the first", boundary => {
      const p = projectFor(modulating);
      const tick = (boundary === "manual inside the dominant" ? 7.5 : 7) * p.ppq;
      if (boundary === "written key") p.keyEvents.push({ id: "new-key", tick, ...gKey });
      else p.structure.phraseBoundaries.push({ id: "cut", tick, source: "manual", confidence: "certain" });
      const frames = buildChordInferenceObservations(p);
      const local = inferLocalKeys(frames, new Set([p.lengthTicks]),
        p.structure.phraseBoundaries.map(b => b.tick), p.ppq);
      expect(local.get(frames.findIndex(frame => frame.fromTick === 4 * p.ppq))).toBeUndefined();
    },
  );
});

describe("shared tonal evidence in functional rules", () => {
  const pivotLabels = `annotations {
 chord old range=[1:1,1:2) symbol=viio7
 chord pivot range=[1:2,1:3) symbol=viio7 localKey="Eb major"
 chord arrival range=[1:3,2:1) symbol=I localKey="Eb major"
}`;
  const old = "D5 F4 Ab3 B2";
  const pivot = "D5 F4 Ab3 Cb3";
  const resolution = "Eb5 G4 Eb4 Bb2";
  function pivotProject(arrival: string) {
    return projectFor([old, pivot, arrival, arrival], pivotLabels);
  }

  it("uses the respelled seventh only when it actually descends into the new tonic", () => {
    const good = pivotProject(resolution);
    // The same pitch classes and labels are not enough. The seventh misses its written register.
    const bad = pivotProject("Eb5 G4 Eb4 Bb1");
    expect(buildHarmonyAnalysis(good).connections[0]).toMatchObject({ diminishedPivot: true });
    expect(buildHarmonyAnalysis(bad).connections[0]).toMatchObject({ diminishedPivot: false });
    const oldLeadingWarning = (p: typeof good) => checkHarmony(p).diagnostics.some(d =>
      d.ruleId === "resolution.leading-tone" && d.voiceIds.includes("bass"));
    expect(oldLeadingWarning(good)).toBe(false);
    expect(oldLeadingWarning(bad)).toBe(true);
  });

  it.each(["manual", "key"] as const)("%s blocks cross-boundary pivot evidence", barrier => {
    const p = pivotProject(resolution);
    if (barrier === "manual") p.structure.phraseBoundaries.push({
      id: "cut", tick: p.ppq, source: "manual", confidence: "certain",
    });
    else p.keyEvents.push({ ...p.keyEvents[0], id: "new", tick: p.ppq, ...gKey });
    expect(buildHarmonyAnalysis(p).connections[0]).toMatchObject({ tonalBoundary: true, diminishedPivot: false });
    if (barrier === "manual") expect(checkHarmony(p).diagnostics.some(d =>
      d.ruleId === "resolution.leading-tone" && d.voiceIds.includes("bass"))).toBe(true);
  });

  it("matches an actual applied target relabelled as tonic, but keeps a same-key miss", () => {
    const labels = `annotations {
 chord source range=[1:1,1:2) symbol=V7/V
 chord target range=[1:2,2:1) symbol=I localKey="G major"
}`;
    const landing = projectFor([d7, g, g, g], labels);
    expect(buildHarmonyAnalysis(landing).targetChains[0]).toMatchObject({ status: "matched" });
    const miss = projectFor([d7, home, home, home], labels.replace(' localKey="G major"', ""));
    expect(checkHarmony(miss).diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({
      ruleId: "function.applied-dominant-target",
    })]));
  });
});

describe("cadences within an established local center", () => {
  it("accepts a local half cadence with independent preparation", () => {
    const p = projectFor([g, "G4 C4 E3 C3", gDominant, gDominant], `annotations {
 chord tonic range=[1:1,1:2) symbol=I localKey="G major"
 chord prep range=[1:2,1:3) symbol=IV localKey="G major"
 chord dominant range=[1:3,2:1) symbol=V localKey="G major"
 phrase end range=[1:1,2:1)
}`);
    expect(buildHarmonyAnalysis(p).cadenceCandidates).toContainEqual(expect.objectContaining({
      kind: "half", toTick: p.lengthTicks,
    }));
  });

  it("accepts a supplementary plagal closure after a local authentic arrival", () => {
    const p = projectFor([home, home, home, d7, g, g, g, g, "G4 C4 E3 C3", g, g, g], `annotations {
 chord dominant range=[1:4,2:1) symbol=V7 localKey="G major"
 chord first-tonic range=[2:1,3:1) symbol=I localKey="G major"
 chord plagal range=[3:1,3:2) symbol=IV localKey="G major"
 chord tonic range=[3:2,4:1) symbol=I localKey="G major"
 phrase end range=[1:1,4:1)
}`);
    const cadence = (project: typeof p) => buildHarmonyAnalysis(project).cadenceCandidates;
    expect(cadence(p)).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "full", form: "authentic", toTick: 8 * p.ppq }),
      expect.objectContaining({ kind: "supplementary", form: "plagal", toTick: p.lengthTicks }),
    ]));
    p.structure.phraseBoundaries.push({ id: "cut", tick: 8 * p.ppq, source: "manual", confidence: "certain" });
    expect(cadence(p).some(c => c.kind === "supplementary")).toBe(false);
  });
});

