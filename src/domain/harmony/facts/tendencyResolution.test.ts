import { describe, expect, it } from "vitest";
import { pitchClassEquals } from "../../pitch";
import { metricPositionAt } from "../../rhythm/metric";
import { compileScoreText } from "../../scoreText";
import { buildHarmonyAnalysis } from "../analysis";
import { verifyPreparedSuspensionVoicing } from "./tendencyResolution";
import { hasCompleteWrittenTertianVoicing } from "./writtenVoicing";

function verify(
  harmony: string,
  {
    soprano = "D5/2. | C5/2.",
    alto = "B4/2. | G4/2.",
    tenor = "F4/2.~ | F4/4 E4/2",
  } = {},
) {
  const { project } = compileScoreText(`satb 1
key C major
meter 3/4
bars 1..2 {
  S: | ${soprano} |
  A: | ${alto} |
  T: | ${tenor} |
  B: | G2/2. | C3/2. |
  H: | ${harmony} |
}`);
  const analysis = buildHarmonyAnalysis(project);
  const slices = analysis.slices.map(({ tick, endTick, notes }) => ({ fromTick: tick, toTick: endTick, notes }));
  const onsetIndex = slices.findIndex(slice => slice.fromTick === 2880);
  const voicing = verifyPreparedSuspensionVoicing({
    slices, onsetIndex, key: project.keyEvents[0], beatTicks: project.ppq,
    metricAt: tick => metricPositionAt(analysis.metricTimeline, tick),
    preparationAt: index => {
      const { chord, notes } = analysis.slices[index];
      if (!chord) return "surface";
      if (!pitchClassEquals(chord.identity.root, { step: "G", alter: 0 })) return "blocked";
      return hasCompleteWrittenTertianVoicing(Object.values(notes).flatMap(note => note ? [note.pitch] : []))
        ? "confirmed" : "surface";
    },
  });
  return { slices, voicing };
}

describe("已准备延留的谱面核验", () => {
  it("同一和弦的标签切分不缩短实际准备或延留时长", () => {
    const plain = verify("V7/2. | I/2.");
    const split = verify("V7/2 V7/8 V7/8 | I/8 I/8 I/2");
    expect(split.slices.some(slice => slice.fromTick === 2400)).toBe(true);
    expect(split.slices.some(slice => slice.fromTick === 3360)).toBe(true);
    for (const { voicing } of [plain, split]) {
      expect(voicing).toMatchObject({
        fromTick: 2880, toTick: 3840,
        motions: [{ voiceId: "tenor", figure: "4-3" }],
        heldVoiceIds: ["soprano", "alto", "bass"],
        rearticulatedVoiceIds: [],
      });
    }
  });

  it("实际延留超过一拍时，切短主和弦标签仍不能通过", () => {
    const tenor = "F4/2.~ | F4/4. E4/4.";
    expect(verify("V7/2. | I/2.", { tenor }).voicing).toBeUndefined();
    expect(verify("V7/2. | I/8 I/4 I/4.", { tenor }).voicing).toBeUndefined();
  });

  it("同音重新起奏与同一音符保持分别统计", () => {
    expect(verify("V7/2. | I/2.", { alto: "B4/2. | G4/4 G4/2" }).voicing).toMatchObject({
      heldVoiceIds: ["soprano", "bass"],
      rearticulatedVoiceIds: ["alto"],
    });
  });

  it("只给准备计入有实音支持的和声区间", () => {
    const soprano = "D5/2 D5/8 Eb5/8 | C5/2.";
    expect(verify("V7/2. | I/2.", { soprano }).voicing?.preparationSurfaceTicks).toBe(480);
    expect(verify("V7/2 V7/8 V7/16 V7/16 | I/2.", { soprano }).voicing?.preparationSurfaceTicks).toBe(480);
    // The same F is tied throughout, but only the last eighth is confirmed as V7.
    expect(verify("IV/2 IV/8 V7/8 | I/2.").voicing).toBeUndefined();
    // The held bass and F alone do not establish preparation after two voices leave V7.
    const alto = "B4/2 B4/8 Db5/8 | G4/2.";
    expect(verify("V7/2. | I/2.", { soprano, alto }).voicing).toBeUndefined();
  });
});
