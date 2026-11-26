import { blind, chords, voices, type RuleGuardrail } from "./fixtureContract";

export const functionRhythmGuardrails: readonly RuleGuardrail[] = [
  {
    ruleId: "function.cadential64-target",
    entryPoints: {
      blind: false,
      blindSkipReason: "纯盲推依赖后继属功能来确认终止四六（K46），破坏后继属和弦后盲推不再将其判作 K46。",
    },
    pairs: [
      {
        name: "K46 的 C 与 E 分别下行到 V 的 B 与 D",
        control: { voices: {
          S: "E5/2 D5/4 E5/4", A: "C5/2 B4/4 C5/4",
          T: "G3/1", B: "G2/2 G2/4 C3/4", H: "K46/2 V/4 I/4",
        } },
        counterexamples: [{
          name: "两个上声部回到 C 与 E，K46 转入普通主四六",
          edits: [["S", 1, "D5/4", "E5/4"], ["A", 1, "B4/4", "C5/4"], ["H", 1, "V/4", "I64/4"]],
          expected: [chords(2, 0, 2)],
        }],
      },
      {
        name: "K46 在持续属低音上进入 V7",
        control: { voices: {
          S: "E5/2 D5/4 E5/4", A: "C5/2 B4/4 C5/4",
          T: "G4/2 F4/4 G4/4", B: "G2/2 G2/4 C3/4", H: "K46/2 V7/4 I/4",
        } },
        counterexamples: [{
          name: "上三声部构成 IV，原属低音仍持续",
          edits: [["S", 1, "D5/4", "C5/4"], ["A", 1, "B4/4", "A4/4"], ["H", 1, "V7/4", "IV/4"]],
          expected: [chords(2, 0, 2)],
        }],
      },
    ],
  },
  {
    ruleId: "function.retrogression",
    entryPoints: blind,
    pairs: [{
      name: "I–V–vi6–I，属功能回到主功能族",
      control: { voices: {
        S: "E5/4 D5/4 A4/4 E5/4", A: "C5/4 B4/4 E4/4 C5/4",
        T: "G3/4 G3/4 A3/4 G3/4", B: "C3/4 G2/4 C3/4 C3/4", H: "I/4 V/4 vi6/4 I/4",
      } },
      counterexamples: [
        {
          name: "改变两个音，V 转入原位 IV",
          edits: [["A", 2, "E4/4", "C4/4"], ["B", 2, "C3/4", "F3/4"], ["H", 2, "vi6/4", "IV/4"]],
          expected: [chords(2, 1, 2)],
        },
        {
          name: "改变两个音，V 转入原位 ii",
          edits: [["A", 2, "E4/4", "F4/4"], ["B", 2, "C3/4", "D3/4"], ["H", 2, "vi6/4", "ii/4"]],
          expected: [chords(2, 1, 2)],
        },
      ],
    }],
  },
  {
    ruleId: "function.applied-dominant-target",
    entryPoints: blind,
    pairs: [{
      name: "副属七 V7/V 进入其目标 G 大三和弦",
      control: { voices: {
        S: "C5/2 B4/2", A: "A4/2 G4/2", T: "F#3/2 D4/2", B: "D3/2 G2/2", H: "V7/V/2 V/2",
      } },
      counterexamples: [
        { name: "保留 B、G，改入 iii", edits: [
          ["T", 1, "D4/2", "E4/2"], ["B", 1, "G2/2", "E3/2"], ["H", 1, "V/2", "iii/2"],
        ], expected: [chords(2, 0, 2)] },
        { name: "保留 B、D，改入导三和弦", edits: [
          ["A", 1, "G4/2", "F4/2"], ["B", 1, "G2/2", "B2/2"], ["H", 1, "V/2", "vii°/2"],
        ], expected: [chords(2, 0, 2)] },
      ],
    }],
  },
  {
    ruleId: "connection.second-inversion-context",
    entryPoints: {
      blind: false,
      blindSkipReason: "经过四六的用途来自题给标注。低音破坏经过线后，盲推缺少继续赋予该用途的依据。",
    },
    pairs: [{
      name: "I–V64–I6 以低音 C–D–E 贯穿经过四六",
      control: {
        voices: {
          S: "E5/4 D5/4 C5/2", A: "G4/4 G4/4 G4/2", T: "C4/4 B3/4 C4/2",
          B: "C3/4 D3/4 E3/2", H: "I/4 V64/4@passing I6/2",
        },
        annotations: ["chord passing role=passing64"],
      },
      counterexamples: [
        { name: "起点低八度，从 C2 跳入 D3", edits: [["B", 0, "C3/4", "C2/4"]], expected: [voices(1, "bass")] },
        { name: "终点低八度，从 D3 跳离至 E2", edits: [["B", 2, "E3/2", "E2/2"]], expected: [voices(1, "bass")] },
      ],
    }],
  },
  {
    ruleId: "rhythm.harmonic-syncopation",
    entryPoints: blind,
    pairs: [
      {
        name: "I–vi–I，vi 从第三拍进入",
        control: { voices: {
          S: "E5/1", A: "G4/4 G4/4 A4/4 G4/4", T: "C4/1",
          B: "C3/4 C3/4 A2/4 C3/4", H: "I/2 vi/4 I/4",
        } },
        counterexamples: [{
          name: "第二拍提前奏 vi，延续过第三拍",
          edits: [
            ["B", 1, "C3/4", "A2/4"], ["A", 1, "G4/4", "A4/4"],
            ["H", 0, "I/2", "I/4"], ["H", 1, "vi/4", "vi/2"],
          ],
          expected: [chords(1, 1)],
        }],
      },
      {
        name: "IV–ii–IV–V，弱拍上的 ii 在第三拍结束",
        control: { voices: {
          S: "F5/2. D5/4", A: "C5/4 D5/4 C5/4 B4/4", T: "A3/2. G3/4",
          B: "F2/4 D3/4 F2/4 G2/4", H: "IV/4 ii/4 IV/4 V/4",
        } },
        counterexamples: [{
          name: "第三拍继续 ii，直至第四拍才换属和弦",
          edits: [
            ["B", 2, "F2/4", "D3/4"], ["A", 2, "C5/4", "D5/4"],
            ["H", 1, "ii/4", "ii/2"], ["H", 2, "IV/4", ""],
          ],
          expected: [chords(1, 1)],
        }],
      },
    ],
  },
  {
    ruleId: "cadence.cadential64-metric-position",
    entryPoints: blind,
    pairs: [{
      name: "低音于第三拍落到 G，终止四六在第四拍解决到属和弦",
      control: { voices: {
        S: "E5/2. D5/4", A: "C5/2. B4/4", T: "G3/1",
        B: "C3/2 G2/4 G2/4", H: "I/2 K46/4 V/4",
      } },
      counterexamples: [
        { name: "低音提前到第二拍，K46 与属和弦同为弱拍", edits: [
          ["B", 0, "C3/2", "C3/4"], ["B", 1, "G2/4", "G2/2"],
          ["H", 0, "I/2", "I/4"], ["H", 1, "K46/4", "K46/2"],
        ], expected: [chords(1, 1, 3)] },
      ],
    }, {
      name: "K46 在第一拍进入，比第三拍的属和弦强",
      control: { voices: {
        S: "E5/2 D5/2", A: "C5/2 B4/2", T: "G3/1",
        B: "G2/4 G2/4 G2/2", H: "K46/2 V/2",
      } },
      counterexamples: [{
        name: "首拍低音改为主音，K46 推迟到第二拍才出现",
        edits: [["B", 0, "G2/4", "C3/4"], ["H", 0, "K46/2", "I/4 K46/4"]],
        expected: [chords(1, 1, 2)],
      }],
    }],
  },
];
