import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../../scoreText";
import { applyHarmonyInference, checkHarmony, inferChords } from "../../index";

interface Example {
  source?: readonly string[];
  target?: readonly string[];
  sourceChord?: string;
  targetChord?: string;
  writtenKey?: string;
  localKey?: boolean;
  keyChange?: boolean;
  blind?: boolean;
}

function progression({
  source = ["E5", "G4", "B3", "G3"],
  target = ["F5", "A4", "D4", "F3"],
  sourceChord = "v6",
  targetChord = "iv6",
  writtenKey = "A minor",
  localKey = false,
  keyChange = false,
  blind = false,
}: Example = {}) {
  const voices = ["S", "A", "T", "B"];
  const opening = ["E5", "C5", "A3", "A2"];
  const closing = ["E5", "A4", "C4", "A2"];
  const cadence = ["E5/2 E5/2", "G#4/2 A4/2", "B3/2 A3/2", "E3/2 A2/2"];
  const lines = voices.map((voice, index) =>
    voice + ": | " + [opening[index], source[index], target[index], closing[index]]
      .map(pitch => pitch + "/4").join(" ") + " | " + cadence[index] + " |",
  );
  const localAnnotation = localKey ? ' localKey="A minor"' : "";
  const labels = [
    ["1:1", "1/4", "i"],
    ["1:2", "1/4", sourceChord],
    ["1:3", "1/4", targetChord],
    ["1:4", "1/4", "i"],
    ["2:1", "1/2", "V"],
    ["2:3", "1/2", "i"],
  ];
  const annotations = labels.map(([at, duration, chord], index) =>
    `chord chord-${index} at=${at} duration=${duration} symbol=${chord}${localAnnotation}`,
  );
  return compileScoreText([
    "satb 1",
    "key " + writtenKey,
    "meter 4/4",
    keyChange ? "at 1:3 key C major" : "",
    "bars 1..2 {", ...lines, "}",
    ...(blind ? [] : ["annotations {", ...annotations, "}"]),
  ].join("\n")).project;
}

function retrogressionAtThirdBeat(project: ReturnType<typeof progression>) {
  return checkHarmony(project).diagnostics.filter(diagnostic =>
    diagnostic.ruleId === "function.retrogression" &&
    diagnostic.tick === 2 * project.ppq,
  );
}

describe("自然小调的小属六到小下属六", () => {
  it("自然七级低音下行全音，两个小三和弦均完整", () => {
    expect(retrogressionAtThirdBeat(progression())).toEqual([]);
  });

  it("以两端共同的局部小调判断，允许它和书写调号不同", () => {
    const project = progression({ writtenKey: "F# minor", localKey: true });
    expect(retrogressionAtThirdBeat(project)).toEqual([]);
  });

  it("从未标和弦的同一四部谱盲推导，仍通过 checkHarmony", () => {
    const raw = progression({ blind: true });
    expect(raw.chordTrack.regions).toEqual([]);
    const { project } = applyHarmonyInference(raw, { chordInference: inferChords(raw) }, {
      mode: "replace-unlocked",
      writeNonChordToneRoles: true,
    });
    const pair = project.chordTrack.regions.filter(region =>
      region.startTick === raw.ppq || region.startTick === 2 * raw.ppq,
    );
    expect(pair.map(region => region.identity)).toEqual([
      expect.objectContaining({ root: { step: "E", alter: 0 }, bass: { step: "G", alter: 0 } }),
      expect.objectContaining({ root: { step: "D", alter: 0 }, bass: { step: "F", alter: 0 } }),
    ]);
    expect(retrogressionAtThirdBeat(project)).toEqual([]);
  });

  it.each<[string, Example]>([
    ["和声小调的升七级大属六", { source: ["E5", "G#4", "B3", "G#3"], sourceChord: "V6" }],
    ["大属实音被错标为小属六", { source: ["E5", "G#4", "B3", "G#3"] }],
    ["小属原位", { source: ["E5", "G4", "B3", "E3"], sourceChord: "v" }],
    ["小下属原位", { target: ["F5", "A4", "D4", "D3"], targetChord: "iv" }],
    ["构成音缺失", { target: ["F5", "D4", "D4", "F3"] }],
    ["有声部休止", { target: ["F5", "A4", "r", "F3"] }],
    ["目的低音是等音异名", { target: ["F5", "A4", "D4", "E#3"] }],
    ["目的低音错八度", { target: ["F5", "A4", "D4", "F2"] }],
    ["同局部标签跨过书写换调", { keyChange: true, localKey: true }],
  ])("%s，仍报告逆功能", (_label, example) => {
    expect(retrogressionAtThirdBeat(progression(example))).toEqual([
      expect.objectContaining({ severity: "warning" }),
    ]);
  });

  it("和弦构成音带有明确外音角色时保持警告", () => {
    const project = progression();
    project.satbTracks.find(track => track.id === "tenor")!.notes[1].nonChordToneRole = "passing";
    expect(retrogressionAtThirdBeat(project)).toHaveLength(1);
  });
});
