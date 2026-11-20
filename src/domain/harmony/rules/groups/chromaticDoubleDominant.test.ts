import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../../scoreText";
import type { VoiceId } from "../../../project/types";
import { checkHarmony } from "../../registry";

interface Example {
  key?: string;
  keyEvent?: string;
  voiceId?: VoiceId;
  soprano?: string;
  alto?: string;
  tenor?: string;
  bass?: string;
  departure?: string;
  middle?: string;
  landing?: string;
  landingStart?: string;
  noteRole?: string;
}

function compileExample({
  key = "C major", keyEvent = "",
  soprano = "D5/4 D#5/4 E5/2", alto = "A4/4 A4/4 C5/2",
  tenor = "F4/4 C4/4 G4/2", bass = "F3/4 F#3/4 G3/2",
  departure = "ii6", middle = "viio7/V", landing = "K46",
  landingStart = "1:3", noteRole = "",
}: Example = {}) {
  return compileScoreText(`satb 1
key ${key}
meter 4/4
${keyEvent}
bars 1..1 {
  S: | ${soprano} |
  A: | ${alto} |
  T: | ${tenor} |
  B: | ${bass} |
}
annotations {
  chord departure range=[1:1,1:2) symbol=${departure}
  chord middle range=[1:2,1:3) symbol=${middle}
  chord landing range=[${landingStart},2:1) symbol=${landing}
  ${noteRole}
}`).project;
}

describe("第28章重属导减七音改记", () => {
  it("升 II 的入音在两种解决走向中均无 B.3", () => {
    const legal = compileExample();
    const wrongResolution = compileExample({ soprano: "D5/4 D#5/4 G5/2" });
    const respellingWarnings = (project: ReturnType<typeof compileExample>) =>
      checkHarmony(project).diagnostics.filter(diagnostic =>
        diagnostic.ruleId === "melody.augmented-interval" &&
        diagnostic.tick === project.ppq &&
        diagnostic.voiceIds.includes("soprano"),
      );

    expect(respellingWarnings(legal)).toEqual([]);
    expect(respellingWarnings(wrongResolution)).toEqual([]);
  });

});
