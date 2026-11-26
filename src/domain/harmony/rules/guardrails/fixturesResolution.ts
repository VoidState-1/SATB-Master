import { blind, voices, type RuleGuardrail } from "./fixtureContract";

export const resolutionGuardrails: readonly RuleGuardrail[] = [
  {
    ruleId: "resolution.augmented-sixth",
    entryPoints: blind,
    pairs: [{
      name: "法式增六的 Ab 与 F# 反向半音解决到两个 G",
      control: {
        key: "C minor",
        voices: {
          S: "F#4/2 G4/4 G4/4", A: "D4/2 D4/4 Eb4/4",
          T: "C4/2 B3/4 C4/4", B: "Ab2/2 G2/4 C3/4", H: "Fr+6/2 V/4 i/4",
        },
      },
      counterexamples: [
        {
          name: "增六高端从 F# 上跳到属和弦的 B",
          edits: [["S", 1, "G4/4", "B4/4"]],
          expected: [voices(2, "alto", "bass", "soprano", "tenor")],
        },
        {
          name: "低端跳至高八度的 G，音级一致但没有下行半音",
          edits: [["B", 1, "G2/4", "G3/4"]],
          expected: [voices(2, "alto", "bass", "soprano", "tenor")],
        },
      ],
    }],
  },
  {
    ruleId: "resolution.leading-tone",
    entryPoints: blind,
    pairs: [{
      name: "V 到 I，外声部导音 B 上行半音到 C",
      control: { voices: {
        S: "B4/2 C5/2", A: "D4/2 E4/2", T: "G3/1", B: "G2/2 C3/2", H: "V/2 I/2",
      } },
      counterexamples: [
        {
          name: "女高导音下跳到主和弦五音 G",
          edits: [["S", 1, "C5/2", "G4/2"]],
          expected: [voices(2, "soprano")],
        },
        {
          name: "女高导音上跳到三音 E，跨过主音",
          edits: [["S", 1, "C5/2", "E5/2"]],
          expected: [voices(2, "soprano")],
        },
      ],
    }],
  },
  {
    ruleId: "resolution.chord-seventh",
    entryPoints: blind,
    pairs: [
      {
        name: "V7 到 I，女高七音 F 下行半音到 E",
        control: { voices: {
          S: "F5/2 E5/2", A: "D4/2 G4/2", T: "B3/2 C4/2", B: "G2/2 C3/2", H: "V7/2 I/2",
        } },
        counterexamples: [{
          name: "女高 F 上行全音到 G，女低接替主和弦的 E",
          edits: [["S", 1, "E5/2", "G5/2"], ["A", 1, "G4/2", "E4/2"]],
          expected: [voices(2, "soprano")],
        }],
      },
      {
        name: "V7/V 到 V，女高副属七音 C 下行半音到 B",
        control: { voices: {
          S: "C5/2 B4/2", A: "A4/2 G4/2", T: "F#4/2 D4/2", B: "D3/2 G2/2", H: "V7/V/2 V/2",
        } },
        counterexamples: [{
          name: "女高 C 上行到 D，男高接替属和弦的 B",
          edits: [["S", 1, "B4/2", "D5/2"], ["T", 1, "D4/2", "B3/2"]],
          expected: [voices(2, "soprano")],
        }],
      },
    ],
  },
];
