import { describe, expect, it } from "vitest";
import type { ProjectDocument } from "../../../project";
import { compileScoreText } from "../../../scoreText";
import { checkHarmony } from "../../registry";

const fMinor = [
  "E4/2 | G4/4 F4/4",
  "C4/2 | C4/2",
  "Bb3/2 | Bb3/4 Ab3/4",
  "G2/2 | F2/2",
];
const eMajor = [
  "D#4/2 | F#4/4 E4/4",
  "B3/2 | B3/2",
  "A3/2 | G#3/2",
  "F#2/2 | E2/2",
];

function score(parts: readonly string[], key: string, labels?: string, annotations?: string) {
  return compileScoreText(`satb 1
key ${key}
meter 2/4
bars 1..2 {
${parts.map((part, index) => ` ${"SATB"[index]}: | ${part} |`).join("\n")}
${labels ? ` H: | ${labels} |` : ""}
}
${annotations ?? ""}`).project;
}

function sopranoWarnings(project: ProjectDocument) {
  const warnings = checkHarmony(project).diagnostics.filter(d =>
    d.ruleId === "resolution.leading-tone" && d.voiceIds.includes("soprano"));
  return warnings.map(({ tick, severity, params }) => ({ tick, severity, params }));
}

function changePart(parts: readonly string[], voice: number, part: string) {
  return parts.map((written, index) => index === voice ? part : written);
}

describe("E.1 over a harmonically prepared tonic 9–8", () => {
  it.each([
    ["F minor", fMinor, "V43/2 | i/2", "E4/2 | G4/4 Ab4/4"],
    ["E major", eMajor, "V43/2 | I/2", "D#4/2 | F#4/4 G#4/4"],
  ] as const)("the written 7–2–1 resolves in %s", (key, parts, labels, wrongSoprano) => {
    expect(sopranoWarnings(score(parts, key))).toEqual([]);
    expect(sopranoWarnings(score(parts, key, labels))).toEqual([]);
    expect(sopranoWarnings(score(changePart(parts, 0, wrongSoprano), key, labels))).toMatchObject([{
      tick: 1920, severity: "warning",
    }]);
  });

  it("recognizes a single 9–8 in the same score when the seventh resolves with the bass", () => {
    expect(sopranoWarnings(score(changePart(fMinor, 2, "Bb3/2 | Ab3/2"), "F minor"))).toEqual([]);
  });

  it("follows the actual ninth across a key reminder, label subdivisions and accompaniment reattacks", () => {
    const project = score([
      fMinor[0], "C4/2 | C4/8 C4/8 C4/4", "Bb3/2 | Bb3/8 Bb3/8 Ab3/4", "G2/2 | F2/8 F2/8 F2/4",
    ], "F minor", "V43/2 | i/16 i/16 i/8 i/4");
    project.keyEvents.push({ ...project.keyEvents[0], id: "reminder", tick: 1920 + 720 });
    expect(sopranoWarnings(project)).toEqual([]);
  });

  it("rejects a real change of key even when the original key returns before the resolution", () => {
    const project = score(fMinor, "F minor");
    const openingKey = project.keyEvents[0];
    project.keyEvents.push(
      { ...openingKey, id: "actual-change", tick: 2400, mode: "major" },
      { ...openingKey, id: "return", tick: 2640 },
    );
    expect(sopranoWarnings(project)).toMatchObject([{ tick: 1920, severity: "warning" }]);
  });

  it("rejects a manual phrase boundary under the ninth", () => {
    const project = score(fMinor, "F minor");
    project.structure.phraseBoundaries.push({ id: "phrase-cut", tick: 2400, source: "manual", confidence: "certain" });
    expect(sopranoWarnings(project)).toMatchObject([{ tick: 1920, severity: "warning" }]);
  });

  it.each([
    ["a direct leap to a tonic member", 0, "E4/2 | C5/4 F4/4"],
    ["the ninth leaves without resolving", 0, "E4/2 | G4/4 Ab4/4"],
    ["the ninth has no fifth in the previous dominant for preparation", 3, "C3/2 | F2/2"],
    ["the bass changes before the ninth resolves", 3, "G2/2 | F2/4 C3/4"],
    ["the bass detours before returning for the resolution", 3, "G2/2 | F2/8 C3/8 F2/4"],
    ["the accompanying fourth never resolves to the tonic third", 2, "Bb3/2 | Bb3/4 C4/4"],
    ["another upper voice already has the tonic", 1, "C4/2 | F4/4 C4/4"],
    ["the apparent ninth is a second immediately above the bass", 3, "G2/2 | F4/2"],
  ] as const)("keeps the soprano warning for %s", (_name, voice, part) => {
    expect(sopranoWarnings(score(changePart(fMinor, voice, part), "F minor"))).toMatchObject([{
      tick: 1920, severity: "warning", params: { leadingTone: "E", targetTonic: "F" },
    }]);
  });

  it("rejects a conflicting label in a subdivision under the held ninth", () => {
    expect(sopranoWarnings(score(fMinor, "F minor", "V43/2 | i/8 iv/8 i/4"))).toMatchObject([{
      tick: 1920, severity: "warning", params: { targetTonic: "F" },
    }]);
  });

  it("respects the declared function of the same absolute tonic at the resolution", () => {
    const opening = 'chord source range=[1:1,2:1) symbol=V43 localKey="E major"';
    const landing = "chord landing range=[2:2,3:1)";
    const withLanding = (reading: string) => score(eMajor, "A major", undefined, `annotations {
 ${opening}
 ${landing} ${reading}
}`);
    expect(sopranoWarnings(withLanding('symbol=I localKey="E major"'))).toEqual([]);
    const conflicting = withLanding("symbol=V");
    const warning = [{
      tick: 1920, severity: "warning", params: { key: "E major", targetTonic: "E" },
    }];
    expect(sopranoWarnings(conflicting)).toMatchObject(warning);

    conflicting.chordTrack.regions[1].semantics!.interpretations[0].source = "inferred";
    expect(sopranoWarnings(conflicting)).toEqual([]);
    conflicting.chordTrack.locked = true;
    expect(sopranoWarnings(conflicting)).toMatchObject(warning);
  });
});
