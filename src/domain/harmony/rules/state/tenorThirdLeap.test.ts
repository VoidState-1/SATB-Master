import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../../scoreText";
import { applyHarmonyInference, checkHarmony, inferChords } from "../../index";

const score = `satb 1
key A major
meter 4/4
bars 1..1 {
 S: | A4/4 B4/8 B4/4. A4/4 |
 A: | E4/1 |
 T: | C#4/4 G#3/2 C#4/4 |
 B: | A2/4 E3/2 A3/4 |
}`;

function throughEntry(material: string, mode: "blind" | "given", harmony = "I/4 V/2 I/4") {
  const input = compileScoreText(mode === "given"
    ? material.replace("}", ` H: | ${harmony} |\n}`)
    : material).project;
  if (mode === "given") return input;
  return applyHarmonyInference(input, { chordInference: inferChords(input) }, {
    mode: "replace-unlocked", writeNonChordToneRoles: true,
  }).project;
}

function tenorWarnings(project: ReturnType<typeof throughEntry>) {
  return checkHarmony(project).diagnostics.filter(diagnostic =>
    diagnostic.ruleId === "resolution.leading-tone" && diagnostic.voiceIds.includes("tenor"));
}

describe.each(["blind", "given"] as const)("§7.2 tenor third leap through the %s entry", mode => {
  it("allows the upward fourth into close spacing with a held common tone", () => {
    const project = throughEntry(score, mode);
    expect(project.chordTrack.regions.find(region => region.startTick === project.ppq)?.identity)
      .toMatchObject({ root: { step: "E", alter: 0 }, structure: { quality: "major" } });
    expect(tenorWarnings(project)).toHaveLength(0);
  });

  it("allows same-register reattacks and a descending fifth in the bass", () => {
    const material = score.replace("E4/1", "E4/4 E4/2 E4/4")
      .replace("G#3/2", "G#3/4 G#3/4").replace("A3/4", "A2/4");
    expect(tenorWarnings(throughEntry(material, mode))).toHaveLength(0);
  });

  it.each([
    ["the tonic third is an octave away", score.replace("G#3/2 C#4/4", "G#3/2 C#5/4"), "I/4 V/2 I/4"],
    ["the common tone changes register", score.replace("E4/1", "E4/2. E5/4"), "I/4 V/2 I/4"],
    ["the common tone moves to another voice", score.replace("B4/4. A4/4", "B4/4. E5/4")
      .replace("E4/1", "E4/2. A4/4"), "I/4 V/2 I/4"],
    ["the soprano rises and the arrival stays open", score.replace("B4/4. A4/4", "B4/4. A5/4"), "I/4 V/2 I/4"],
    ["the tonic is inverted", score.replace("E3/2 A3/4", "E3/2 C#3/4"), "I/4 V/2 I6/4"],
    ["the dominant is a seventh chord", score.replace("E4/1", "E4/4 D4/2 E4/4"), "I/4 V7/2 I/4"],
  ])("keeps the tenor warning when %s", (_description, material, harmony) => {
    const project = throughEntry(material, mode, harmony);
    expect(tenorWarnings(project)).toMatchObject([{
      tick: 3 * project.ppq, severity: "warning", voiceIds: ["tenor"],
    }]);
  });

  it("keeps the warning when a manual phrase boundary separates the chords", () => {
    const project = throughEntry(score, mode);
    const tick = 3 * project.ppq;
    project.structure.phraseBoundaries.push({ id: "cut", tick, source: "manual", confidence: "certain" });
    expect(tenorWarnings(project)).toMatchObject([{ tick, severity: "warning", voiceIds: ["tenor"] }]);
  });
});

const localScore = `satb 1
key F major
meter 4/4
bars 1..1 {
 S: | A4/4 D5/2 C5/4 |
 A: | F4/4 G4/2. |
 T: | C4/4 B3/2 E4/4 |
 B: | F3/4 G2/2 C3/4 |
}`;

function withLocalChords(material: string) {
  return compileScoreText(`${material}
annotations {
 chord v at=1:2 duration=1/2 symbol=V localKey="C major"
 chord i at=1:4 duration=1/4 symbol=I localKey="C major"
}`).project;
}

describe("§7.2 in an independently established local major key", () => {
  it.each([
    ["blind writeback", (material: string) => throughEntry(material, "blind")],
    ["authored local tonic and dominant", withLocalChords],
    ["authored local major in a minor-key score", (material: string) =>
      withLocalChords(material.replace("key F major", "key F minor").replace("A4/4", "Ab4/4"))],
    ["an established applied dominant before a gap in the labels", (material: string) =>
      throughEntry(material, "given", "r/4 V/V/4 r/2")],
  ] as const)("uses the local C-major obligation with %s", (_description, prepare) => {
    expect(tenorWarnings(prepare(localScore))).toHaveLength(0);

    const wrongOctave = prepare(localScore.replace("B3/2 E4/4", "B3/2 E5/4"));
    expect(tenorWarnings(wrongOctave)).toMatchObject([{
      tick: 3 * wrongOctave.ppq, severity: "warning", params: { key: "C major", targetTonic: "C" },
    }]);
  });

  it.each([
    ["the sounding tonic is declared the dominant of F", 'chord i at=1:4 duration=1/4 symbol=V localKey="F major"'],
    ["the held source is reinterpreted as the tonic of G", 'chord g at=1:3 duration=1/4 symbol=I localKey="G major"'],
  ])("keeps the C-major warning when %s", (_description, competingReading) => {
    const project = compileScoreText(`${localScore}
annotations {
 chord v at=1:2 duration=1/4 symbol=V localKey="C major"
 ${competingReading}
}`).project;
    expect(tenorWarnings(project)).toMatchObject([{
      tick: 3 * project.ppq, severity: "warning", params: { key: "C major", targetTonic: "C" },
    }]);
  });

  it.each([
    ["F major", 1],
    ["C major", 0],
  ])("preserves score-key continuity for a wrong-octave arrival after a declaration of %s", (key, count) => {
    const material = localScore.replace("meter 4/4", `meter 4/4\nat 1:4 key ${key}`)
      .replace("B3/2 E4/4", "B3/2 E5/4");
    expect(tenorWarnings(withLocalChords(material))).toHaveLength(count);
  });
});
