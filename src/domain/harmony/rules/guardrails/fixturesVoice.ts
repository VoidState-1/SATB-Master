import { blind, voices, type RuleGuardrail } from "./fixtureContract";

export const voiceGuardrails: readonly RuleGuardrail[] = [
  {
    ruleId: "voice-leading.parallel-fifths",
    entryPoints: blind,
    pairs: [
      {
        name: "I 到 IV6，两内声部从纯五度移开",
        control: { voices: {
          S: "E5/2 F5/2", A: "G4/2 A4/2", T: "C4/2 F4/2", B: "C3/2 A2/2", H: "I/2 IV6/2",
        } },
        counterexamples: [{
          name: "女低改唱 C5，与男高同向保持纯五度",
          edits: [["A", 1, "A4/2", "C5/2"]],
          expected: [voices(2, "alto", "tenor")],
        }],
      },
      {
        name: "同一主和弦内的外声部下辅助音",
        control: { voices: {
          S: "G4/2 F#4/4@upper G4/4", A: "E4/1", T: "C4/1",
          B: "C3/2 Bb2/4@lower C3/4", H: "I/1",
        }, annotations: ["note upper role=neighbor", "note lower role=neighbor"] },
        counterexamples: [{
          name: "标注为辅助音的 F 与降 B 仍构成去回两处平行五度",
          edits: [["S", 1, "F#4/4@upper", "F4/4@upper"]],
          expected: [voices(2, "bass", "soprano"), voices(3, "bass", "soprano")],
        }],
      },
    ],
  },
  {
    ruleId: "voice-leading.parallel-octaves",
    entryPoints: blind,
    pairs: [
      {
        name: "I 到 ii6，外声部从纯八度移开",
        control: { voices: {
          S: "C4/2 A4/2", A: "G3/2 D4/2", T: "E3/2 A3/2", B: "C3/2 F3/2", H: "I/2 ii6/2",
        } },
        counterexamples: [{
          name: "外声部从 C 到 F 保持纯八度",
          edits: [["S", 1, "A4/2", "F4/2"]],
          expected: [voices(2, "bass", "soprano")],
        }],
      },
      {
        name: "I6 到 ii 的内声部从同度分离",
        control: { voices: {
          S: "G4/2 A4/2", A: "C4/2 F4/2", T: "C4/2 D4/2", B: "E3/2 D3/2", H: "I6/2 ii/2",
        } },
        counterexamples: [{
          name: "两内声部从 C4 一起移到 D4，形成平行同度",
          edits: [["A", 1, "F4/2", "D4/2"]],
          expected: [voices(2, "alto", "tenor")],
        }],
      },
    ],
  },
  {
    ruleId: "voice.crossing",
    entryPoints: blind,
    pairs: [
      {
        name: "换和弦时上下声部各守其位",
        control: { voices: {
          S: "E4/2 G4/2", A: "C4/2 D4/2", T: "G3/2 B3/2", B: "C3/2 G2/2", H: "I/2 V/2",
        } },
        counterexamples: [{
          name: "换和弦时女高落到女低下方",
          edits: [["S", 1, "G4/2", "B3/2"]],
          expected: [voices(2, "alto", "soprano")],
        }],
      },
      {
        name: "同一个主和弦重排",
        control: { voices: {
          S: "G4/1", A: "E4/2 C4/2", T: "C4/2 E3/2", B: "C3/1", H: "I/1",
        } },
        counterexamples: [{
          name: "男高的 E3 提高八度后越过女低",
          edits: [["T", 1, "E3/2", "E4/2"]],
          expected: [voices(2, "alto", "tenor")],
        }],
      },
    ],
  },
  {
    ruleId: "voice-leading.hidden-fifth",
    entryPoints: blind,
    pairs: [{
      name: "I 到 V，外声部同向但女高以全音进入纯五度",
      control: { voices: {
        S: "C5/2 D5/2", A: "G3/2 B3/2", T: "E3/2 G3/2", B: "C3/2 G3/2", H: "I/2 V/2",
      } },
      counterexamples: [
        {
          name: "女高从 E4 跳进 D5",
          edits: [["S", 0, "C5/2", "E4/2"]],
          expected: [voices(2, "bass", "soprano")],
        },
        {
          name: "起点降八度到 C4，女高跳进同一个纯五度",
          edits: [["S", 0, "C5/2", "C4/2"]],
          expected: [voices(2, "bass", "soprano")],
        },
      ],
    }],
  },
  {
    ruleId: "voice-leading.hidden-octave",
    entryPoints: blind,
    pairs: [{
      name: "IV 到 I，女高保持 C5，斜向进入复八度",
      control: { voices: {
        S: "C5/2 C5/2", A: "A3/2 G3/2", T: "F3/2 E3/2", B: "F3/2 C3/2", H: "IV/2 I/2",
      } },
      counterexamples: [
        {
          name: "女高从 A5 下跳到 C5，与低音同向",
          edits: [["S", 0, "C5/2", "A5/2"]],
          expected: [voices(2, "bass", "soprano")],
        },
        {
          name: "女高由 C5 下跳到 C4，与低音同向进入纯八度",
          edits: [["S", 1, "C5/2", "C4/2"]],
          expected: [voices(2, "bass", "soprano")],
        },
      ],
    }],
  },
  {
    ruleId: "voice.range",
    entryPoints: blind,
    pairs: [
      {
        name: "a 小三和弦的女高 A5 落在音域上界",
        control: { voices: { S: "A5/1", A: "C5/1", T: "E4/1", B: "A2/1", H: "vi/1" } },
        counterexamples: [{
          name: "女高再升半音", edits: [["S", 0, "A5/1", "Bb5/1"]], expected: [voices(0, "soprano")],
        }],
      },
      {
        name: "e 小三和弦的男低 E2 落在音域下界",
        control: { voices: { S: "E4/1", A: "B3/1", T: "G3/1", B: "E2/1", H: "iii/1" } },
        counterexamples: [{
          name: "男低再降半音", edits: [["B", 0, "E2/1", "Eb2/1"]], expected: [voices(0, "bass")],
        }],
      },
    ],
  },
  {
    ruleId: "voice.upper-spacing",
    entryPoints: blind,
    pairs: [{
      name: "两女声相距整八度，两内声部相距大六度",
      control: { voices: { S: "E5/1", A: "E4/1", T: "G3/1", B: "C3/1", H: "I/1" } },
      counterexamples: [
        { name: "女高升至 G5，拉开女声间距", edits: [["S", 0, "E5/1", "G5/1"]], expected: [voices(0, "alto", "soprano")] },
        { name: "男高降至 C3，拉开内声部间距", edits: [["T", 0, "G3/1", "C3/1"]], expected: [voices(0, "alto", "tenor")] },
      ],
    }],
  },
  {
    ruleId: "voice-leading.overlap",
    entryPoints: blind,
    pairs: [{
      name: "I 到 V，两个内声部停在相邻高声部的前一音以下",
      control: { voices: {
        S: "C5/2 D5/2", A: "G4/2 B4/2", T: "E4/2 D4/2", B: "C3/2 G2/2", H: "I/2 V/2",
      } },
      counterexamples: [
        { name: "女低到 D5，高过女高原唱的 C5", edits: [["A", 1, "B4/2", "D5/2"]], expected: [voices(2, "alto", "soprano")] },
        { name: "男高到 B4，高过女低原唱的 G4", edits: [["T", 1, "D4/2", "B4/2"]], expected: [voices(2, "alto", "tenor")] },
      ],
    }],
  },
  {
    ruleId: "voice-leading.all-voices-similar",
    entryPoints: blind,
    pairs: [{
      name: "I 到 IV，三部上行，男高重奏共同音 C4",
      control: { voices: {
        S: "E5/2 F5/2", A: "G4/2 A4/2", T: "C4/2 C4/2", B: "C3/2 F3/2", H: "I/2 IV/2",
      } },
      counterexamples: [
        { name: "男高终点改为 F4", edits: [["T", 1, "C4/2", "F4/2"]], expected: [voices(2, "alto", "bass", "soprano", "tenor")] },
        { name: "男高改由 G3 上行到 C4", edits: [["T", 0, "C4/2", "G3/2"]], expected: [voices(2, "alto", "bass", "soprano", "tenor")] },
      ],
    }],
  },
];
