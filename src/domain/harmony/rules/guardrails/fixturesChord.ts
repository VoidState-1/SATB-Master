import { blind, chords, voices, type RuleGuardrail, type Score } from "./fixtureContract";

const italian: Score = {
  key: "C minor",
  voices: {
    S: "F#4/2 G4/4 G4/4",
    A: "C4/2 D4/4 Eb4/4",
    T: "C3/2 B3/4 C4/4",
    B: "Ab2/2 G2/4 C3/4",
    H: "It+6/2 V/4 i/4",
  },
};

export const chordGuardrails: readonly RuleGuardrail[] = [
  {
    ruleId: "chord.inversion-bass",
    entryPoints: {
      blind: false,
      blindSkipReason: "错例需要保留给定转位。盲推按实奏低音选转位，无法核对低音与原标签的冲突。",
    },
    pairs: [
      {
        name: "Cut 1，C–D–E 经过低音连接 I 与 I6",
        control: { voices: {
          S: "G4/1 | C5/1", A: "E4/1 | G4/1", T: "C4/1 | C4/1",
          B: "C3/2. D3/4@pass | E3/2. E3/4", H: "I/1 | I6/1",
        }, annotations: ["note pass role=passing"] },
        counterexamples: [
          {
            name: "F3 从 C3 跳进，经过标注不能豁免转位",
            edits: [["B", 1, "D3/4@pass", "F3/4@pass"]],
            expected: [voices(3, "bass")],
          },
          {
            name: "I6 末拍改奏五音 G3，实奏转位错误",
            edits: [["B", 3, "E3/4", "G3/4"]],
            expected: [voices(7, "bass")],
          },
        ],
      },
      {
        name: "Cut 1，C 跨和弦延留后下行到 V6 的正确低音 B",
        control: { voices: {
          S: "E5/1 | D5/1", A: "G4/1 | G4/1", T: "C4/1 | D4/1",
          B: "C3/1@sus~ | C3/4 B2/2.", H: "I/1 | V6/1",
        }, annotations: ["note sus role=suspension"] },
      },
    ],
  },
  {
    ruleId: "chord.doubled-leading-tone",
    entryPoints: blind,
    pairs: [
      {
        name: "V 中只出现一次导音 B",
        control: { voices: {
          S: "D5/1", A: "B4/1", T: "G3/1", B: "G2/1", H: "V/1",
        } },
        counterexamples: [{
          name: "男高重复属和弦的导音",
          edits: [["T", 0, "G3/1", "B3/1"]],
          expected: [voices(0, "alto", "tenor")],
        }],
      },
      {
        name: "导三和弦第一转位重复三音 D",
        control: { voices: {
          S: "F5/1", A: "D4/1", T: "B3/1", B: "D3/1", H: "vii°6/1",
        } },
        counterexamples: [{
          name: "女低改为重复导和弦的根音 B",
          edits: [["A", 0, "D4/1", "B4/1"]],
          expected: [voices(0, "alto", "tenor")],
        }],
      },
    ],
  },
  {
    ruleId: "chord.doubled-seventh",
    entryPoints: blind,
    pairs: [
      {
        name: "V7 到 I，七音 F 单写",
        control: { voices: {
          S: "F5/2 E5/2", A: "D4/2 G4/2", T: "B3/2 C4/2", B: "G2/2 C3/2", H: "V7/2 I/2",
        } },
        counterexamples: [{
          name: "女低以 F4 重复女高的属七七音",
          edits: [["A", 0, "D4/2", "F4/2"]],
          expected: [voices(0, "alto", "soprano")],
        }],
      },
      {
        name: "V7/V 到 V，副属七音 C 单写",
        control: { voices: {
          S: "C5/2 B4/2", A: "A4/2 G4/2", T: "F#3/2 D4/2", B: "D3/2 G2/2", H: "V7/V/2 V/2",
        } },
        counterexamples: [{
          name: "女低以 C4 重复女高的副属七音",
          edits: [["A", 0, "A4/2", "C4/2"]],
          expected: [voices(0, "alto", "soprano")],
        }],
      },
    ],
  },
  {
    ruleId: "chord.augmented-sixth-voicing",
    entryPoints: blind,
    pairs: [{
      name: "意式增六各写一次降六级与升四级，重复主音",
      control: italian,
      counterexamples: [
        {
          name: "重复增六的升四级 F#，只保留一个 C",
          edits: [["A", 0, "C4/2", "F#4/2"]],
          expected: [chords(0, 0)],
        },
        {
          name: "重复增六的降六级 Ab，仍保留完整音级集合",
          edits: [["T", 0, "C3/2", "Ab3/2"]],
          expected: [chords(0, 0)],
        },
        {
          name: "以 G 取代 F#，缺少书写增六框架的高端",
          edits: [["S", 0, "F#4/2", "G4/2"]],
          expected: [chords(0, 0)],
          blindSkipReason: "去掉 F# 后实奏不再含增六度，盲推不会无中生有将其判为意式增六和弦。",
        },
      ],
    }],
  },
  {
    ruleId: "chord.incomplete-members",
    entryPoints: blind,
    pairs: [
      {
        name: "Cut 1，主和弦先完整发声，尾部三音被合法经过音暂时替代",
        control: { voices: {
          S: "E4/2. F4/4@pass | G4/1", A: "C4/1 | D4/1", T: "G3/1 | B3/1",
          B: "C3/1 | G2/1", H: "I/1 | V/1",
        }, annotations: ["note pass role=passing"] },
        counterexamples: [{
          name: "开头改奏 G4，主和弦始终没有三音 E",
          edits: [["S", 0, "E4/2.", "G4/2."]],
          expected: [{ ...chords(3, 0), missing: "E" }],
          blindSkipReason: "整小节实奏仅剩 C–G 空五度，无给定和弦标注时盲推无法唯一确定大小三和弦身份。",
        }],
      },
      {
        name: "V7 到 I，完整属七",
        control: { voices: {
          S: "F5/2 E5/2", A: "D4/2 G4/2", T: "B3/2 C4/2", B: "G2/2 C3/2", H: "V7/2 I/2",
        } },
        counterexamples: [
          {
            name: "用 G 替换唯一的 F，给定属七确实缺七音",
            edits: [["S", 0, "F5/2", "G5/2"]],
            expected: [{ ...chords(0, 0), missing: "F" }],
            blindSkipReason: "删去给定 V7 标签后，实奏 G–B–D 为完整属三和弦 V，盲推读作合法 V→I 属正常行为。",
          },
          {
            name: "以等音 E# 冒充属七的书写七音 F",
            edits: [["S", 0, "F5/2", "E#5/2"]],
            expected: [{ ...chords(0, 0), missing: "F" }],
          },
        ],
      },
      {
        name: "主和弦的书写三音 E",
        control: { voices: {
          S: "G4/2 D5/2", A: "E4/2 B4/2", T: "C4/2 G3/2", B: "C3/2 G2/2", H: "I/2 V/2",
        } },
        counterexamples: [{
          name: "以等音 F♭ 冒充主和弦的书写三音 E",
          edits: [["A", 0, "E4/2", "Fb4/2"]],
          expected: [{ ...chords(0, 0), missing: "E" }],
        }],
      },
    ],
  },
  {
    ruleId: "chord.doubled-altered-tendency-tone",
    entryPoints: blind,
    pairs: [{
      name: "D 大三和弦进入 G，副导音 F# 只在女高出现",
      control: { voices: {
        S: "F#5/2 G5/2", A: "A4/2 B4/2", T: "A3/2 D4/2", B: "D3/2 G2/2", H: "V/V/2 V/2",
      } },
      counterexamples: [
        { name: "女低重复副导音", edits: [["A", 0, "A4/2", "F#4/2"]], expected: [{ ...chords(0, 0), noteEvidenceVoices: ["alto", "soprano"] }] },
        { name: "男高重复副导音", edits: [["T", 0, "A3/2", "F#3/2"]], expected: [{ ...chords(0, 0), noteEvidenceVoices: ["tenor", "soprano"] }] },
      ],
    }],
  },
  {
    ruleId: "chord.unclassified-nonchord-tone",
    entryPoints: blind,
    pairs: [{
      name: "同一主和弦中重奏原拼写的三音与五音",
      control: { voices: {
        S: "G4/2 G4/2", A: "E4/2 E4/2", T: "C4/1", B: "C3/1", H: "I/1",
      } },
      counterexamples: [
        { name: "女低以 Fb4 重奏 E4 的音高", edits: [["A", 1, "E4/2", "Fb4/2"]], expected: [voices(2, "alto")] },
        { name: "女高以 F##4 重奏 G4 的音高", edits: [["S", 1, "G4/2", "F##4/2"]], expected: [voices(2, "soprano")] },
      ],
    }],
  },
  {
    ruleId: "chord.second-inversion-voicing",
    entryPoints: blind,
    pairs: [{
      name: "终止四六重复低音 G，四度与六度分别下行解决",
      control: { voices: {
        S: "E5/2 D5/4 E5/4", A: "C5/2 B4/4 C5/4", T: "G3/2 G3/2",
        B: "G2/2 G2/4 C3/4", H: "K46/2 V/4 I/4",
      } },
      counterexamples: [
        { name: "男高改为重复根音 C", edits: [["T", 0, "G3/2", "C4/2"]], expected: [chords(0, 0)] },
        { name: "男高改为重复三音 E", edits: [["T", 0, "G3/2", "E4/2"]], expected: [chords(0, 0)] },
      ],
    }],
  },
];
