import { describe, expect, it } from "vitest";
import { primaryHarmonyInterpretation } from "../../chordModel";
import { compileScoreText } from "../../scoreText";
import { inferPhrases, phraseInferenceFingerprint } from "../phrase";
import { inferChords } from "./inferChords";

const code = "dominant-to-neapolitan-pivot";
const rootPivot = [
  "D5/4 D5/4 | D5/4 E#5/4 | F#5/2",
  "A4/4 C5/4 | B4/4 B4/4 | A4/2",
  "F4/4 F#4/4 | G4/4 G#4/4 | C#4/2",
  "D3/4 A3/4 | G3/4 C#3/4 | F#2/2",
];
const sixthPivot = [
  "D5/4 F#5/4 | G5/4 E#5/4 | F#5/2",
  "A4/4 D5/4 | D5/4 B4/4 | A4/2",
  "F4/4 A4/4 | G4/4 G#4/4 | C#4/2",
  "D3/4 C3/4 | B2/4 C#3/4 | F#2/2",
];
const articulated = [
  "D5/2 | D5/2~ | D5/4 E#5/4 | F#5/2",
  "A4/2 | C5/2 | B4/4 B4/4 | A4/2",
  "F4/2 | F#4/2 | G4/4 G#4/4 | C#4/2",
  "D3/2 | A3/2 | G3/4 C#3/4 | F#2/2",
];

function edit(changes: Partial<Record<number, string>>) {
  return rootPivot.map((part, index) => changes[index] ?? part);
}

function projectFor(parts = rootPivot, events = "") {
  const measures = parts[0].split("|").length;
  const voices = parts.map((part, index) => `${"SATB"[index]}: | ${part} |`).join("\n");
  return compileScoreText(`satb 1
key D minor
meter 2/4
${events}
bars 1..${measures} {
${voices}
}`).project;
}

function sourceRegion(project: ReturnType<typeof projectFor>, beat = 1) {
  const tick = project.ppq * beat;
  return inferChords(project).regions.find(region => region.fromTick <= tick && tick < region.toTick)!;
}

function pivotEvidence(region: ReturnType<typeof sourceRegion>) {
  return [region.selected, ...region.alternatives].flatMap(candidate => candidate?.evidence ?? [])
    .find(item => item.code === code);
}

describe("经实写转位属七引入后调降 II", () => {
  it.each([[rootPivot, "A"], [sixthPivot, "C"]] as const)(
    "在同句下识别完全解决的属七，保留可回放证据和双解", (parts, bass) => {
      const project = projectFor(parts);
      const source = sourceRegion(project);
      expect(source.selected?.identity).toMatchObject({
        root: { step: "D", alter: 0 }, bass: { step: bass, alter: 0 }, structure: { quality: "dominant7" },
      });
      const semantics = source.selected!.semantics!;
      expect(primaryHarmonyInterpretation(semantics)).toMatchObject({ appliedTarget: { degree: 4 } });
      expect(primaryHarmonyInterpretation(semantics).localKey).toBeUndefined();
      expect(semantics.alternatives).toMatchObject([{
        localKey: { tonic: { step: "G", alter: 0 }, mode: "major" },
        designation: { kind: "primary", primaryFunction: "dominant" }, confidence: "ambiguous",
      }]);
      expect(pivotEvidence(source)).toMatchObject({
        details: { pivotTick: 1920, destinationDominantTick: 2880, destinationTonicTick: 3840,
          destinationTonicEndTick: 5760 },
        noteIds: expect.arrayContaining(["note-S-2880", "note-S-3840"]),
      });
    },
  );

  it.each([1440, 1920, 2400, 2880, 3840, 4320])(
    "拒绝源到主和弦证据末端之间的人工句界 %i", tick => {
      const project = projectFor();
      project.structure.phraseBoundaries = [{ id: "cut", source: "manual", confidence: "certain", tick }];
      expect(pivotEvidence(sourceRegion(project))).toBeUndefined();
    },
  );

  it("拒绝本次新推导的句界，保存这条边界后同样拒绝", () => {
    const project = projectFor(articulated);
    const boundary = inferPhrases(project).boundaries.find(item => item.tick === 3840);
    expect(boundary).toMatchObject({ source: "inferred", confidence: "probable" });
    expect(pivotEvidence(sourceRegion(project, 2))).toBeUndefined();
    project.structure.phraseBoundaries = [boundary!];
    expect(pivotEvidence(sourceRegion(project, 2))).toBeUndefined();
  });

  it("保留当前有效的已保存句界，忽略同位置的失效推导旧界", () => {
    const project = projectFor();
    expect(inferPhrases(project).boundaries.some(item => item.tick === 2880)).toBe(false);
    const boundary = { id: "cut", source: "inferred", confidence: "probable", tick: 2880,
      inferenceFingerprint: phraseInferenceFingerprint(project) } as const;
    project.structure.phraseBoundaries = [boundary];
    expect(pivotEvidence(sourceRegion(project))).toBeUndefined();
    project.structure.phraseBoundaries = [{ ...boundary, stale: true }];
    expect(pivotEvidence(sourceRegion(project))).toBeDefined();
  });

  it.each([
    ["七音错声部", edit({ 0: "D5/4 D5/4 | B4/4 E#5/4 | F#5/2", 1: "A4/4 C5/4 | D5/4 B4/4 | A4/2" })],
    ["根音跳八度", edit({ 0: "D5/4 D5/4 | D6/4 E#5/4 | F#5/2" })],
    ["五音上行且属三四落六和弦", edit({ 3: "D3/4 A3/4 | B3/4 C#3/4 | F#2/2" })],
    ["属二的五音跳进而落点仍完整", sixthPivot.map((part, index) =>
      index === 2 ? "F4/4 A4/4 | G3/4 G#4/4 | C#4/2" : part)],
    ["实际最低音落到男高轨", edit({ 2: "F4/4 F#3/4 | G3/4 G#4/4 | C#4/2" })],
    ["导音同音异名", edit({ 2: "F4/4 Gb4/4 | G4/4 G#4/4 | C#4/2" })],
    ["根音同音异名", edit({ 0: "D5/4 C##5/4 | D5/4 E#5/4 | F#5/2" })],
    ["源省根", edit({ 0: "D5/4 C5/4 | D5/4 E#5/4 | F#5/2" })],
    ["中隔低音休止", edit({ 3: "D3/4 A3/8 r/8 | G3/4 C#3/4 | F#2/2" })],
    ["后调属导音跳到另一八度的主音", edit({ 0: "D5/4 D5/4 | D5/4 E#5/4 | F#6/2" })],
    ["末尾回 d 小调", [
      "D5/4 D5/4 | D5/4 E5/4 | F5/2", "A4/4 C5/4 | B4/4 C#5/4 | A4/2",
      "F4/4 F#4/4 | G4/4 E4/4 | D4/2", "D3/4 A3/4 | G3/4 A3/4 | D3/2",
    ]],
  ] as const)("拒绝 %s", (_name, parts) => {
    expect(pivotEvidence(sourceRegion(projectFor([...parts])))).toBeUndefined();
  });

  it("拒绝落点处另写的新调号", () => {
    expect(pivotEvidence(sourceRegion(projectFor(rootPivot, "at 2:1 key F# minor")))).toBeUndefined();
  });
});
