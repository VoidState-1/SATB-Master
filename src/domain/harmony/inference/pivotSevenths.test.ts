import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../scoreText";
import { inferChords } from "./inferChords";

const toD = `satb 1
key C minor
meter 3/4
bars 1..3 {
  S: | Eb5/2 Db5/4 | C#5/4 C#5/2 | D5/2. |
  A: | G4/2 G4/4 | G4/4 G4/2 | F#4/2. |
  T: | C4/2 E4/4 | E4/4 E4/2 | A3/2. |
  B: | C3/2 Bb2/4 | Bb2/4 A2/2 | D3/2. |
}`;

const toEb = `satb 1
key G minor
meter 3/4
bars 1..3 {
  S: | Bb4/2 B4/4 | Cb5/4 Bb4/2 | Bb4/2. |
  A: | G4/2 D4/4 | D4/4 D4/2 | Eb4/2. |
  T: | D4/2 F3/4 | F3/4 F3/2 | Eb3/2. |
  B: | G2/2 Ab2/4 | Ab2/4 Ab2/2 | G2/2. |
}`;

const destinationCases = [
  {
    name: "D 大调，七音在低音",
    score: toD,
    tonic: { step: "D", alter: 0 },
    leadingTone: { step: "C", alter: 1 },
    bass: { step: "B", alter: -1 },
    sameSpelling: toD.replace("Db5/4", "C#5/4"),
    naturalSeventh: toD.replace("Bb2/4 A2/2", "B2/4 A2/2"),
    exchangedDominant: toD.replace("Bb2/4 A2/2", "Bb2/4 E2/2").replace("E4/4 E4/2", "E4/4 A3/2"),
  },
  {
    name: "降 E 大调，七音在女高音",
    score: toEb,
    tonic: { step: "E", alter: -1 },
    leadingTone: { step: "D", alter: 0 },
    bass: { step: "A", alter: -1 },
    sameSpelling: toEb.replace("B4/4", "Cb5/4"),
    naturalSeventh: toEb.replace("Cb5/4", "C5/4"),
    exchangedDominant: toEb.replace("Cb5/4 Bb4/2", "Cb5/4 F4/2").replace("F3/4 F3/2", "F3/4 Bb3/2"),
  },
];

function progression(score: string) {
  const { project } = compileScoreText(score);
  const { regions } = inferChords(project);
  const [pivot, dominant, tonic] = [3, 4, 6].map(beat =>
    regions.find(region => region.fromTick <= beat * project.ppq && beat * project.ppq < region.toTick),
  );
  expect(dominant?.selected).toMatchObject({
    functionalBaseId: "D", identity: { structure: { quality: "dominant7" } },
  });
  expect(tonic?.selected).toMatchObject({
    functionalBaseId: "T", identity: { structure: { quality: "major" } },
  });
  return pivot!;
}

describe.each(destinationCases)("等音改写后的减导七和弦（$name）", fixture => {
  it("按实写根音和低音识别减导七，确认减七经属七解决到主和弦", () => {
    expect(progression(fixture.score)).toMatchObject({
      status: "resolved",
      selected: {
        functionalBaseId: "DVII",
        confidence: "high",
        identity: {
          root: fixture.leadingTone, bass: fixture.bass, structure: { quality: "diminished7" },
        },
        semantics: { interpretations: [{ localKey: { tonic: fixture.tonic, mode: "major" } }] },
        evidence: expect.arrayContaining([
          expect.objectContaining({ code: "written-pivot-leading-seventh" }),
        ]),
      },
    });
  });

  it("自然六级构成半减导七", () => {
    expect(progression(fixture.naturalSeventh).selected).toMatchObject({
      functionalBaseId: "DVII", identity: { structure: { quality: "halfDiminished7" } },
    });
  });

  it.each([
    ["前一片采用相同拼写", fixture.sameSpelling],
    ["属七保持原音级集合但七音未在原声部下行", fixture.exchangedDominant],
  ])("%s 时不生成等音改写候选", (_description, score) => {
    const { selected, alternatives } = progression(score);
    expect([selected, ...alternatives].some(candidate =>
      candidate?.evidence.some(evidence => evidence.code === "written-pivot-leading-seventh"),
    )).toBe(false);
  });
});

it("允许缺音和和弦外音时，局部首选与全谱一致，减七与半减七使用不同 ID", () => {
  const score = toEb
    .replace("key G minor", "key C minor")
    .replace("Bb4/2 B4/4", "C5/2 B4/4")
    .replace("G4/2 D4/4", "Eb4/2 D4/4")
    .replace("D4/2 F3/4", "G3/2 F3/4")
    .replace("G2/2 Ab2/4", "C3/2 Ab2/4");
  const { project } = compileScoreText(score);
  const options = { allowIncompleteVoicing: true, allowNonChordToneCandidates: true };
  const fromTick = 3.5 * project.ppq;
  const toTick = 4 * project.ppq;
  const fullRegion = inferChords(project, options).regions.find(region =>
    region.fromTick <= fromTick && fromTick < region.toTick,
  );
  expect(fullRegion?.selected).toBeDefined();
  const { regions } = inferChords(project, { ...options, fromTick, toTick });
  expect(regions).toHaveLength(1);
  const [region] = regions;
  expect(region).toMatchObject({
    fromTick, toTick, observationIndices: [0],
    selected: {
      observationIndex: 0, id: fullRegion?.selected?.id, identity: fullRegion?.selected?.identity,
    },
  });
  const leadingSevenths = [region.selected, ...region.alternatives].filter(candidate =>
    candidate?.functionalBaseId === "DVII" && candidate.identity.structure.kind === "tertian" &&
    (candidate.identity.structure.quality === "diminished7" ||
      candidate.identity.structure.quality === "halfDiminished7"),
  );
  expect(leadingSevenths.map(candidate => candidate?.identity.structure)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ quality: "diminished7" }),
      expect.objectContaining({ quality: "halfDiminished7" }),
    ]),
  );
  expect(new Set(leadingSevenths.map(candidate => candidate?.id)).size).toBe(leadingSevenths.length);
});
