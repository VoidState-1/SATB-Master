import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../../scoreText";
import { checkHarmony } from "../../registry";

interface Example {
  key?: string;
  keyEvents?: string;
  soprano?: string;
  alto?: string;
  tenor?: string;
  bass?: string;
  before?: string;
  middle?: string;
  landing?: string;
  landingStart?: string;
  annotations?: string;
  boundary?: number;
}

function exampleProject({
  key = "D minor", keyEvents = "",
  soprano = "E5/4 D5/4 C#5/2",
  alto = "G4/4 G#4/4 A4/2",
  tenor = "C4/4 D4/4 E4/2",
  bass = "C3/4 Bb2/4 A2/2",
  before = "", middle = "", landing = "V", landingStart = "1:3",
  annotations = "", boundary,
}: Example = {}) {
  const { project } = compileScoreText(`satb 1
key ${key}
meter 4/4
${keyEvents}
bars 1..1 {
 S: | ${soprano} |
 A: | ${alto} |
 T: | ${tenor} |
 B: | ${bass} |
}
annotations {
 ${before ? "chord before range=[1:1,1:2) symbol=" + before : ""}
 ${middle ? "chord middle range=[1:2,1:3) symbol=" + middle : ""}
 ${landing ? "chord landing range=[" + landingStart + ",2:1) symbol=" + landing : ""}
 ${annotations}
}`);
  if (boundary !== undefined) {
    project.structure.phraseBoundaries.push({
      id: "boundary", tick: project.ppq * boundary, source: "manual", confidence: "certain",
    });
  }
  return project;
}

describe("从实音识别无标注的意大利增六", () => {
  it.each([
    ["两端均在原声部半音解决", "A4"],
    ["低端正确而高端改落属和弦五音", "E4"],
  ] as const)("checkHarmony 在%s时均不在女低入音处报 B.3", (_label, upperArrival) => {
    const project = exampleProject({ before: "V7/V confidence=probable", alto: `G4/4 G#4/4 ${upperArrival}/2` });
    const warnings = checkHarmony(project).diagnostics.filter(item =>
      item.ruleId === "melody.augmented-interval" &&
      item.tick === project.ppq &&
      item.voiceIds.includes("alto"),
    );
    expect(warnings).toEqual([]);
  });

});
