import { describe, expect, it } from "vitest";
import type { VoiceId } from "../../../project";
import { compileScoreText } from "../../../scoreText";
import { checkHarmony } from "../../registry";

type Mechanism = "leading" | "exit" | "entry";
const active = new Set<Mechanism>(["leading", "exit", "entry"]);

interface Example {
  key?: string;
  soprano?: string;
  alto?: string;
  tenor?: string;
  bass?: string;
  preparation?: string;
  source?: string;
  landing?: string;
  tonic?: string;
  manualBoundary?: number;
  keyBoundary?: number;
}

function example({
  key = "C major",
  soprano = "G4/4 F#4/4 F4/4 E4/4",
  alto = "C4/2 B3/4 C4/4",
  tenor = "G3/4 A3/4 G3/2",
  bass = "E3/4 Eb3/4 D3/4 C3/4",
  preparation = "I6",
  source = "viio42/V",
  landing = "V43",
  tonic = "I",
  manualBoundary,
  keyBoundary,
}: Example = {}) {
  const { project } = compileScoreText(`satb 1
key ${key}
meter 4/4
bars 1..1 {
 S: | ${soprano} |
 A: | ${alto} |
 T: | ${tenor} |
 B: | ${bass} |
 H: | ${preparation}/4 ${source}/4 ${landing}/4 ${tonic}/4 |
}`);
  if (manualBoundary !== undefined) project.structure.phraseBoundaries.push({
    id: "manual", source: "manual", confidence: "certain", tick: manualBoundary,
  });
  if (keyBoundary !== undefined) project.keyEvents.push({
    ...project.keyEvents[0], id: "next-signature", tick: keyBoundary,
  });
  return checkHarmony(project).diagnostics;
}

type Diagnostics = ReturnType<typeof example>;
function at(list: Diagnostics, type: "leading" | "augmented" | "seventh", tick: number, voice: VoiceId) {
  const id = {
    leading: "resolution.leading-tone",
    augmented: "melody.augmented-interval",
    seventh: "resolution.chord-seventh",
  }[type];
  return list.some(d => d.ruleId === id && d.tick === tick && d.voiceIds.includes(voice));
}

function threeWarnings(list: Diagnostics) {
  return {
    leading: at(list, "leading", 1920, "soprano"),
    exit: at(list, "augmented", 1920, "soprano"),
    entry: at(list, "augmented", 960, "bass"),
  };
}

describe("第29章完整重属导减七到属七", () => {
  it("大调例 29-440a 型分别放行导音交接、旋律增一度与低音准备", () => {
    const rules = example();
    expect(threeWarnings(rules)).toEqual({
      leading: !active.has("leading"), exit: false, entry: false,
    });
    expect(at(rules, "seventh", 2880, "soprano")).toBe(false);
  });

  it("小调导音可用同一交接，低音实为自然降三级的原音", () => {
    const rules = example({
      key: "C minor", preparation: "i6", tonic: "i", bass: "Eb3/4 Eb3/4 D3/4 C3/4",
      soprano: "G4/4 F#4/4 F4/4 Eb4/4",
    });
    expect(threeWarnings(rules)).toEqual({
      leading: !active.has("leading"), exit: false, entry: false,
    });
    expect(at(rules, "seventh", 2880, "soprano")).toBe(false);
  });

  it("未填重属标签时可凭完整实音与已辨明 D7 识别两个旋律事件", () => {
    expect(threeWarnings(example({ source: "r" }))).toEqual({
      leading: false, exit: false, entry: false,
    });
  });

  it("导音完成交接以后，属七音上行的独立 E.2 报警仍在", () => {
    const rules = example({ soprano: "G4/4 F#4/4 F4/4 G4/4", tenor: "G3/4 A3/4 G3/4 E3/4" });
    expect(threeWarnings(rules).leading).toBe(!active.has("leading"));
    expect(at(rules, "seventh", 2880, "soprano")).toBe(true);
  });

  it("向上半音进属根仍由普通导音路线处理", () => {
    const rules = example({
      soprano: "G4/4 F#4/4 G4/4 E4/4", tenor: "G3/4 A3/4 F3/4 E3/4",
    });
    expect(at(rules, "leading", 1920, "soprano")).toBe(false);
    expect(at(rules, "augmented", 960, "bass")).toBe(false);
  });

  it.each<[string, Example]>([
    ["目标只有属三和弦", { landing: "V64" }],
    ["标作属七却没有奏出目标三音", { alto: "C4/2 D4/4 C4/4" }],
    ["中间少奏一音", { tenor: "G3/4 C4/4 G3/2" }],
    ["重属七音跳到属根", {
      alto: "C4/2 D4/4 C4/4", tenor: "G3/4 A3/4 B3/4 G3/4",
      bass: "E3/4 Eb3/4 G2/4 C3/4", landing: "V7",
    }],
    ["调号事件隔断两个实际和弦", { keyBoundary: 1920 }],
    ["明确的句界切在重属内部", { manualBoundary: 1440 }],
  ])("%s 时导音义务仍报告", (_label, options) => {
    expect(threeWarnings(example(options))).toEqual({ leading: true, exit: false, entry: false });
  });

  it("有低声部休止时不能结算导音义务，旋律沿用既有休止情境的处理", () => {
    expect(threeWarnings(example({ bass: "E3/4 Eb3/8 r/8 D3/4 C3/4" }))).toEqual({
      leading: true, exit: false, entry: false,
    });
  });

  it("低音来自 Am/E 时不借通用 B.3 报准备错误", () => {
    expect(threeWarnings(example({
      preparation: "vi64", soprano: "A4/4 F#4/4 F4/4 E4/4", tenor: "A3/2 G3/2",
    }))).toEqual({ leading: !active.has("leading"), exit: false, entry: false });
  });

  it("半音拼写但属七落点换了八度时拒绝接续", () => {
    const rules = example({ soprano: "G4/4 F#4/4 F5/4 E5/4" });
    expect(at(rules, "leading", 1920, "soprano")).toBe(true);
    expect(at(rules, "augmented", 960, "bass")).toBe(false);
  });

  it("同一教材连接中，低音直接承担升四级到属七音", () => {
    const rules = example({
      preparation: "I", source: "viio7/V", landing: "V42", tonic: "I6",
      soprano: "G4/4 Eb5/4 D5/4 C5/4",
      alto: "C4/4 C5/4 B4/4 G4/4",
      tenor: "E3/4 A3/4 G3/2",
      bass: "C3/4 F#2/4 F2/4 E2/4",
    });
    expect(at(rules, "leading", 1920, "bass")).toBe(!active.has("leading"));
    expect(at(rules, "augmented", 1920, "bass")).toBe(false);
    expect(at(rules, "seventh", 2880, "bass")).toBe(false);
  });
});
