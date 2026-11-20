import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../scoreText";
import { inferChords } from "./index";

const score = `satb 1
key G major
meter 3/4
bars 1..6 {
  S: | B4/2 C5/4 | B4/2 B4/4 | C5/2 C5/4 | C5/2 C5/4 | C5/2 B4/4 | C5/2. |
  A: | G4/2 A4/4 | G4/2 F4/4 | Eb4/2 E4/4 | F4/2 F#4/4 | G4/2 G4/4 | G4/2. |
  T: | D4/2 D4/4 | D4/2 G3/4 | G3/2 G3/4 | F3/4 Eb3/4 D4/4 | Eb4/2 F4/4 | Eb4/2. |
  B: | G2/2 F#2/4 | G2/2 D3/4 | C3/2 Bb2/4 | Ab2/2 Ab2/4 | G2/2 G2/4 | C3/2. |
}`;

function atFourthBar(text: string, selection = false) {
  const { project } = compileScoreText(text);
  const beat = 9 * project.ppq;
  const result = inferChords(project, selection ? { fromTick: beat, toTick: beat + project.ppq } : {});
  return result.regions.find(r => r.fromTick <= beat && beat < r.toTick)?.selected;
}

const cMinor = { tonic: { step: "C", alter: 0 }, mode: "minor" };
const fMinor = { tonic: { step: "F", alter: 0 }, mode: "minor" };

describe("用低音持续时间判断局部调", () => {
  it.each([false, true])("四部已在同音低音上换和声，保留经确认的 c 小调（选区 %s）", selection => {
    const result = atFourthBar(score, selection);
    expect(result?.semantics?.interpretations[0]).toMatchObject({ degree: 4, localKey: cMinor });
    expect(result?.identity).toMatchObject({ root: { step: "F" }, bass: { step: "A", alter: -1 } });
  });

  it("主和弦已奏满一小节后才改变上声部时，仍能确立局部调", () => {
    const extended = score.replace("1..6", "1..7")
      .replace("C5/4 | C5/2 C5/4", "C5/4 | C5/2. | C5/2 C5/4")
      .replace("E4/4 | F4/2", "E4/4 | F4/2. | F4/2")
      .replace("G3/4 | F3/4", "G3/4 | F3/2. | F3/4")
      .replace("Bb2/4 | Ab2/2", "Bb2/4 | Ab2/2. | Ab2/2");
    expect(atFourthBar(extended)?.semantics?.interpretations[0].localKey).toEqual(fMinor);
  });

  it("尊重已标明的外音角色", () => {
    const { project } = compileScoreText(score);
    const lastBeat = 11 * project.ppq;
    project.satbTracks.find(track => track.id === "alto")!.notes.find(note => note.startTick === lastBeat)!.nonChordToneRole = "passing";
    const at = 9 * project.ppq;
    const region = inferChords(project).regions.find(r => r.fromTick <= at && at < r.toTick);
    expect(region?.selected?.semantics?.interpretations[0].localKey).toEqual(fMinor);
  });

  it.each([
    ["实际低音持续", score.replace("Ab2/2 Ab2/4", "Ab2/2.")],
    ["低音重奏、上方仍是完整主和弦", score.replace("F4/2 F#4/4", "F4/2 Ab4/4").replace("Eb3/4 D4/4", "Eb3/4 F3/4")],
    ["各部重奏、只有一个音在主三和弦之外", score.replace("F4/2 F#4/4", "F4/2 F4/4")],
    ["同一低音上双邻音在小节内已解决", score.replace("F4/2 F#4/4", "F4/4 G4/4 F4/4")
      .replace("F3/4 Eb3/4 D4/4", "F3/4 G3/4 F3/4").replace("C5/4 | C5/2 C5/4", "C5/4 | C5/4 Db5/4 C5/4")
      .replace("Ab2/2 Ab2/4", "Ab2/4 Ab2/4 Ab2/4")],
  ])("%s 时保留原有 f 小调证据", (_name, example) => {
    expect(atFourthBar(example)?.semantics?.interpretations[0]).toMatchObject({ degree: 1, localKey: fMinor });
  });
});
