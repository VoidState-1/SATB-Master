import { blind, voices, type RuleGuardrail } from "./fixtureContract";

export const melodyGuardrails: readonly RuleGuardrail[] = [
  {
    ruleId: "melody.leap-over-octave",
    entryPoints: blind,
    pairs: [{
      name: "女高 E4–E5 与低音 C3–C2 恰好反向跳八度",
      control: { voices: {
        S: "E4/2 E5/2", A: "C4/1", T: "G3/1", B: "C3/2 C2/2", H: "I/1",
      } },
      counterexamples: [
        {
          name: "女高上行至 G5，超过八度",
          edits: [["S", 1, "E5/2", "G5/2"]],
          expected: [voices(2, "soprano")],
        },
        {
          name: "低音下行至 G1，超过八度",
          edits: [["B", 1, "C2/2", "G1/2"]],
          expected: [voices(2, "bass")],
        },
      ],
    }],
  },
  {
    ruleId: "melody.augmented-interval",
    entryPoints: blind,
    pairs: [{
      name: "女高从主和弦的 G 上行大二度到下属和弦的 A",
      control: { voices: {
        S: "G4/2 A4/2", A: "E4/2 F4/2", T: "C4/1", B: "C3/2 F2/2", H: "I/2 IV/2",
      } },
      counterexamples: [
        { name: "终点升为 A#，写成上行增二度", edits: [["S", 1, "A4/2", "A#4/2"]], expected: [voices(2, "soprano")] },
        { name: "起点降为 Gb，写成上行增二度", edits: [["S", 0, "G4/2", "Gb4/2"]], expected: [voices(2, "soprano")] },
      ],
    }],
  },
  {
    ruleId: "melody.leap-recovery",
    enableAt: "warning",
    entryPoints: blind,
    pairs: [{
      name: "女高 C5–G5 上跳后反向级进到 F5",
      control: { voices: {
        S: "C5/4 G5/4 F5/2", A: "E4/4 D4/4 C4/2", T: "G3/4 D4/4 C4/2",
        B: "C3/4 B2/4 A2/2", H: "I/4 V6/4 IV6/2",
      } },
      counterexamples: [
        { name: "继续同向级进到 A5", edits: [["S", 2, "F5/2", "A5/2"]], expected: [voices(2, "soprano")] },
        { name: "反向跳回 C5", edits: [["S", 2, "F5/2", "C5/2"]], expected: [voices(2, "soprano")] },
      ],
    }],
  },
  {
    ruleId: "melody.consecutive-leaps",
    entryPoints: blind,
    pairs: [{
      name: "女高由 C5 经 G4 连跳到 C4，形成八度轮廓",
      control: { voices: {
        S: "C5/4 G4/4 C4/2", A: "G3/4 D4/4 G3/2", T: "E3/4 B3/4 E3/2",
        B: "C3/4 G2/4 C3/2", H: "I/4 V/4 I/2",
      } },
      counterexamples: [
        { name: "落 D4，外框为小七度", edits: [["S", 2, "C4/2", "D4/2"]], expected: [voices(2, "soprano")] },
        { name: "落 Db4，外框为大七度", edits: [["S", 2, "C4/2", "Db4/2"]], expected: [voices(2, "soprano")] },
      ],
    }],
  },
];
