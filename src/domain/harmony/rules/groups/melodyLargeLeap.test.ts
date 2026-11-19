import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../../scoreText";
import { checkHarmony } from "../../registry";

function diagnosticsFor(bass: string, soprano = "E5/2 | D5/2", labels = "") {
  const { project } = compileScoreText(`satb 1
key C major
meter 2/4
bars 1..2 {
  S: | ${soprano} |
  A: | C5/2 | B4/2 |
  T: | E4/2 | G4/2 |
  B: | ${bass} |
  ${labels}
}`);
  return checkHarmony(project).diagnostics;
}

describe("较大旋律跳进的低音八度", () => {
  it.each([
    ["下行", "G3/2 | G2/2"],
    ["上行", "G2/2 | G3/2"],
  ])("%s书写纯八度在和弦转换处不报 B.2", (_direction, bass) => {
    for (const labels of ["", "H: | I64/2 | V/2 |"]) {
      expect(diagnosticsFor(bass, undefined, labels)).not.toContainEqual(expect.objectContaining({
        ruleId: "melody.large-leap", voiceIds: ["bass"], tick: 1920,
      }));
    }
  });

  it.each([
    ["低音大六度", "C3/2 | A3/2", "E5/2 | D5/2", "bass", 9],
    ["低音等音减九度", "C#3/2 | Db4/2", "E5/2 | D5/2", "bass", 12],
    ["高音纯八度", "C3/2 | G2/2", "E4/2 | E5/2", "soprano", 12],
  ])("%s 仍报 B.2", (_name, bass, soprano, voice, semitones) => {
    expect(diagnosticsFor(bass, soprano)).toContainEqual(expect.objectContaining({
      ruleId: "melody.large-leap", voiceIds: [voice], tick: 1920, params: { semitones },
    }));
  });

  it("低音越过纯八度仍报 B.1", () => {
    expect(diagnosticsFor("C3/2 | D4/2")).toContainEqual(expect.objectContaining({
      ruleId: "melody.leap-over-octave", voiceIds: ["bass"], tick: 1920, params: { semitones: 14 },
    }));
  });

  it("低音与高音同向形成连续八度仍报声部进行错误", () => {
    expect(diagnosticsFor("G2/2 | G3/2", "G4/2 | G5/2")).toContainEqual(expect.objectContaining({
      ruleId: "voice-leading.parallel-octaves", voiceIds: ["bass", "soprano"], tick: 1920,
    }));
  });
});
