import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../../scoreText";
import type { VoiceId } from "../../../project/types";
import { buildHarmonyAnalysis } from "../../analysis";
import { checkHarmony } from "../../registry";
import { createHarmonyRuleContext } from "../context/createRuleContext";
import { isRespeltDoubleDominantSeventh } from "./chromaticDoubleDominant";

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

function matches(example: Example = {}) {
  const project = compileExample(example);
  const context = createHarmonyRuleContext(buildHarmonyAnalysis(project));
  return context.melodyTransitions({ voiceId: example.voiceId ?? "soprano" })
    .where(transition => isRespeltDoubleDominantSeventh(context, transition))
    .select(transition => transition.current.startTick / project.ppq)
    .toArray();
}

describe("第28章重属导减七音改记", () => {
  it("只放行上行进入升II的增一度", () => {
    expect(matches()).toEqual([1]);
  });

  it("默认规则放行解决到 K46 三音的升II，仍报告解决到五音的同一增一度", () => {
    const legal = compileExample();
    const wrongResolution = compileExample({ soprano: "D5/4 D#5/4 G5/2" });
    const respellingWarnings = (project: ReturnType<typeof compileExample>) =>
      checkHarmony(project).diagnostics.filter(diagnostic =>
        diagnostic.ruleId === "melody.augmented-interval" &&
        diagnostic.tick === project.ppq &&
        diagnostic.voiceIds.includes("soprano"),
      );

    expect(respellingWarnings(legal)).toEqual([]);
    expect(respellingWarnings(wrongResolution)).toMatchObject([{
      severity: "warning",
      endTick: 2 * wrongResolution.ppq,
      voiceIds: ["soprano"],
      params: { intervalNumber: 1, semitones: 1 },
    }]);
  });

  it("兼容功能记法及第一转位中的内声部实音", () => {
    expect(matches({
      voiceId: "tenor",
      soprano: "A4/4 F#5/4 G5/2",
      alto: "F4/4 C4/4 C5/2",
      tenor: "D4/4 D#4/4 E4/2",
      bass: "F3/4 A3/4 G3/2",
      middle: "DDVII65",
    })).toEqual([1]);
  });

  it("使用连续的局部大调而非谱面总调", () => {
    expect(matches({
      key: "A minor",
      departure: 'ii6 localKey="C major"',
      middle: 'viio7/V localKey="C major"',
      landing: 'K46 localKey="C major"',
    })).toEqual([1]);
  });

  it.each<[string, Example]>([
    ["降III拼写", { soprano: "D5/4 Eb5/4 E5/2" }],
    ["同音异名出发", { soprano: "C##5/4 D#5/4 E5/2" }],
    ["重属半减七", { middle: "viiø7/V" }],
    ["非重属减七", { middle: "viio7/III" }],
    ["重属导减七第二转位", { middle: "viio43/V", tenor: "F4/4 F#4/4 G4/2", bass: "F3/4 C3/4 G3/2" }],
    ["原位标注与实音低音不一致", { bass: "F3/4 A3/4 G3/2" }],
    ["重属纵切缺少五音", { tenor: "F4/4 A3/4 G4/2" }],
    ["中间非和弦音已明示", { noteRole: "note S@1:2 role=passing" }],
    ["同主音小调", { key: "C minor" }],
    ["到达普通主四六", { landing: "I64" }],
    ["到达经过四六", { landing: "I64 role=passing64" }],
    ["到达原位主和弦", { landing: "I", bass: "F3/4 F#3/4 C3/2" }],
    ["K46标注与实音低音不一致", { bass: "F3/4 F#3/4 C3/2" }],
    ["K46只标了标签，未奏出主音", { alto: "A4/4 A4/4 G4/2" }],
    ["落点在另一声部", { soprano: "D5/4 D#5/4 G5/2", alto: "A4/4 A4/4 E5/2" }],
    ["落点音高等音改写", { soprano: "D5/4 D#5/4 Fb5/2" }],
    ["跨八度落在三音", { soprano: "D5/4 D#5/4 E4/2" }],
    ["未紧接进入K46", { landingStart: "1:4", soprano: "D5/4 D#5/2 E5/4" }],
    ["休止后才到达三音", { soprano: "D5/4 D#5/4 r/4 E5/4" }],
    ["先重复升II再到达三音", { soprano: "D5/4 D#5/4 D#5/4 E5/4" }],
    ["书写调号在落点改变", { keyEvent: "at 1:3 key G major", landing: 'K46 localKey="C major"' }],
    ["出发与重属的局部调不同", { departure: 'ii6 localKey="G major"' }],
    ["落点局部调不同", { landing: 'K46 localKey="G major"' }],
    ["重属解释有歧义", { middle: "viio7/V confidence=ambiguous" }],
  ])("%s 时不放行", (_name, example) => {
    expect(matches(example)).toEqual([]);
  });
});
