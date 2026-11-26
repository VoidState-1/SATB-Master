import { voices, type RuleGuardrail, type Score } from "./fixtureContract";

const annotatedOrnaments = {
  blind: false,
  blindSkipReason: "该反例要核对人工指定的外音角色。删去角色后，推导可将同一个音视为结构音或其他外音。",
} as const;

const suspension: Score = {
  voices: {
    S: "C5/2 C5/4@sus B4/4",
    A: "E4/2 D4/2",
    T: "G3/1",
    B: "C3/2 G2/2",
    H: "I/2 V/2",
  },
  annotations: ["note sus role=suspension"],
};

export const nonchordGuardrails: readonly RuleGuardrail[] = [
  {
    ruleId: "nonchord.passing-tone",
    entryPoints: annotatedOrnaments,
    pairs: [
      {
        name: "Cut 1，自然经过链 D–E–F–G",
        control: { voices: {
          S: "D5/2 E5/8@p F5/8@q G5/4", A: "B4/1", T: "G3/1", B: "G2/1", H: "V/1",
        }, annotations: ["note p role=passing", "note q role=passing"] },
        counterexamples: [
          {
            name: "从 B4 跳进链首 E5",
            edits: [["S", 0, "D5/2", "B4/2"]],
            expected: [voices(2, "soprano"), voices(2.5, "soprano")],
          },
          {
            name: "从链尾 F5 跳离到 D5",
            edits: [["S", 3, "G5/4", "D5/4"]],
            expected: [voices(2, "soprano"), voices(2.5, "soprano")],
          },
        ],
      },
      {
        name: "Cut 1，半音经过链 C–C#–D–D#–E",
        control: { voices: {
          S: "C5/2 C#5/8@p D5/8@q D#5/8@r E5/8", A: "G4/1", T: "C4/1", B: "C3/1", H: "I/1",
        }, annotations: ["note p role=passing", "note q role=passing", "note r role=passing"] },
        counterexamples: [
          {
            name: "由 G4 跳进半音经过链",
            edits: [["S", 0, "C5/2", "G4/2"]],
            expected: [voices(2, "soprano"), voices(2.5, "soprano"), voices(3, "soprano")],
          },
        ],
      },
      {
        name: "Cut 1，E–F#–G 的书写二度",
        control: { voices: {
          S: "E5/2 F#5/4@p G5/4", A: "G4/1", T: "C4/1", B: "C3/1", H: "I/1",
        }, annotations: ["note p role=passing"] },
        counterexamples: [{
          name: "F# 错拼成等音 G♭，从 E 到 G♭ 是减三度",
          edits: [["S", 1, "F#5/4@p", "Gb5/4@p"]],
          expected: [voices(2, "soprano")],
        }],
      },
    ],
  },
  {
    ruleId: "nonchord.suspension-preparation",
    entryPoints: annotatedOrnaments,
    pairs: [{
      name: "I 到 V，C5 同高准备成 4–3 延留",
      control: suspension,
      counterexamples: [
        {
          name: "从原和弦的 G4 跳进延留音",
          edits: [["S", 0, "C5/2", "G4/2"]],
          expected: [voices(2, "soprano")],
        },
        {
          name: "从原和弦的 E5 下行切入，缺少同高准备",
          edits: [["S", 0, "C5/2", "E5/2"]],
          expected: [voices(2, "soprano")],
        },
      ],
    }],
  },
  {
    ruleId: "nonchord.suspension-resolution",
    entryPoints: annotatedOrnaments,
    pairs: [{
      name: "C5 延留后下行级进到 V 的 B4",
      control: suspension,
      counterexamples: [
        {
          name: "延留改为上行级进到 D5",
          edits: [["S", 2, "B4/4", "D5/4"]],
          expected: [voices(2, "soprano")],
        },
        {
          name: "延留下跳到 G4",
          edits: [["S", 2, "B4/4", "G4/4"]],
          expected: [voices(2, "soprano")],
        },
      ],
    }],
  },
  {
    ruleId: "nonchord.neighbor-tone",
    entryPoints: annotatedOrnaments,
    pairs: [{
      name: "E–F–E 同高回归的上辅助音",
      control: { voices: {
        S: "E5/2 F5/4@n E5/4", A: "G4/1", T: "C4/1", B: "C3/1", H: "I/1",
      }, annotations: ["note n role=neighbor"] },
      counterexamples: [
        {
          name: "上辅助音跳到 C5，未回 E5",
          edits: [["S", 2, "E5/4", "C5/4"]],
          expected: [voices(2, "soprano")],
        },
        {
          name: "上辅助音同向级进到 G5，未回 E5",
          edits: [["S", 2, "E5/4", "G5/4"]],
          expected: [voices(2, "soprano")],
        },
      ],
    }],
  },
  {
    ruleId: "nonchord.anticipation",
    entryPoints: annotatedOrnaments,
    pairs: [{
      name: "V 的弱拍先现 C5，进入 I 时同音重奏",
      control: { voices: {
        S: "B4/1 | B4/4 C5/4@ant C5/2", A: "G4/1 | G4/1", T: "D4/1 | D4/2 E4/2",
        B: "G2/1 | G2/2 C3/2", H: "V/1 | V/2 I/2",
      }, annotations: ["note ant role=anticipation"] },
      counterexamples: [
        {
          name: "F5 不在目标主和弦中",
          edits: [["S", 2, "C5/4@ant", "F5/4@ant"]],
          expected: [voices(5, "soprano")],
        },
        {
          name: "到达主和弦时改唱 G5，先现音未延续",
          edits: [["S", 3, "C5/2", "G5/2"]],
          expected: [voices(5, "soprano")],
        },
        {
          name: "将先现 C5 提前到小节强拍，整整两个拍子后才换和弦",
          edits: [["S", 1, "B4/4", ""], ["S", 2, "C5/4@ant", "C5/2@ant"]],
          expected: [voices(4, "soprano")],
        },
      ],
    }],
  },
];
