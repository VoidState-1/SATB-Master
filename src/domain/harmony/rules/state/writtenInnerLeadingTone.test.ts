import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../../scoreText";
import type { ProjectDocument } from "../../../project/types";
import { checkHarmony } from "../../index";

function score(parts: readonly string[], harmony?: string, key = "D major") {
  return compileScoreText(`satb 1
key ${key}
meter 3/4
bars 1..1 {
${[..."SATB"].map((voice, index) => ` ${voice}: | ${parts[index]} |`).join("\n")}
${harmony ? ` H: | ${harmony} |` : ""}
}`).project;
}

const soprano = "B4/8 B4/8 A4/2";
const alto = "G#4/4 E4/2";
const tenor = "D4/4 C#4/2";
const bass = "E3/4 A2/2";
const cadence = [soprano, alto, tenor, bass];
const applied = "V7/V/4 V/2";
const warnings = (project: ProjectDocument) =>
  checkHarmony(project).diagnostics.filter(diagnostic => diagnostic.ruleId === "resolution.leading-tone");

describe("an inner leading tone falling to the fifth of a written root-position tonic", () => {
  it.each([undefined, applied])("accepts E7–A with harmony %s when the fifth and seventh step down", harmony => {
    expect(warnings(score(cadence, harmony))).toHaveLength(0);
    const displacedSeventh = score([soprano, alto, "D4/4 C#3/2", bass], harmony);
    expect(warnings(displacedSeventh)).toMatchObject([{
      tick: displacedSeventh.ppq, voiceIds: ["alto"], params: { targetTonic: "A" },
    }]);
  });

  it("requires the fifth's step for the new applied-chord proof and retains the labelled V7–I result", () => {
    const displacedFifth = ["B4/8 B4/8 A5/2", alto, tenor, bass];
    const project = score(displacedFifth, applied);
    expect(warnings(project)).toMatchObject([{ tick: project.ppq, voiceIds: ["alto"], params: { targetTonic: "A" } }]);
    expect(warnings(score(displacedFifth, "V7/4 I/2", "A major"))).toHaveLength(0);
  });

  it("does not use the written resolution across a manual phrase boundary", () => {
    const project = score(cadence, applied);
    project.structure.phraseBoundaries.push({
      id: "cut", tick: project.ppq, source: "manual", confidence: "certain",
    });
    expect(warnings(project)).toMatchObject([{ tick: project.ppq, voiceIds: ["alto"] }]);
  });

  it.each([undefined, "V42/V/4 V6/2"])("keeps E.1 over E7/D–A/C# with harmony %s", harmony => {
    const project = score([soprano, alto, "E3/2.", "D3/4 C#3/2"], harmony);
    expect(warnings(project)).toMatchObject([{ tick: project.ppq, voiceIds: ["alto"], params: { targetTonic: "A" } }]);
  });
});
