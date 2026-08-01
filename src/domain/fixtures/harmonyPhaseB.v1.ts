// Phase B 金样本使用显式书写音高，版本号变更意味着教材判断或诊断契约发生了有意调整。
export const HARMONY_PHASE_B_GOLDEN_VERSION = 1;

export const HARMONY_PHASE_B_GOLDEN = {
  writtenIntervals: [
    {
      id: "augmented-fourth",
      from: { step: "C", alter: 0, octave: 4 },
      to: { step: "F", alter: 1, octave: 4 },
      expectedLabel: "增4度",
    },
    {
      id: "diminished-fifth",
      from: { step: "C", alter: 0, octave: 4 },
      to: { step: "G", alter: -1, octave: 4 },
      expectedLabel: "减5度",
    },
  ],
  enharmonicChordTone: {
    chordRoot: { step: "F", alter: 1 },
    correctTone: { step: "F", alter: 1, octave: 4 },
    wrongEnharmonicTone: { step: "G", alter: -1, octave: 4 },
  },
} as const;
