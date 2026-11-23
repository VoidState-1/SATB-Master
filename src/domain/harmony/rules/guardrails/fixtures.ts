
import { PPQ, type VoiceId } from "../../../project";
import type { HarmonyRuleId } from "../catalog";

type Part = "S" | "A" | "T" | "B" | "H";

interface Score {
  readonly voices: Readonly<Record<Part, string>>;
  readonly key?: string;
  readonly annotations?: readonly string[];
}

// Indices count score tokens in the named part, starting at zero and ignoring barlines.
type Edit = readonly [part: Part, index: number, original: string, replacement: string];

export type ExpectedFinding = {
  readonly tick: number;
  readonly missing?: string;
} & (
  { readonly voiceIds: readonly [VoiceId, ...VoiceId[]]; readonly chordTicks?: never }
  | { readonly voiceIds: readonly []; readonly chordTicks: readonly [number, ...number[]] }
);

interface Counterexample {
  readonly name: string;
  readonly edits: readonly Edit[];
  readonly expected: readonly ExpectedFinding[];
  readonly blindSkipReason?: string;
  readonly knownGapReason?: string;
}

interface Pair {
  readonly name: string;
  readonly control: Score;
  readonly counterexamples?: readonly Counterexample[];
}

type EntryPoints = { readonly blind: true } | {
  readonly blind: false;
  readonly blindSkipReason: string;
};

interface RuleGuardrail {
  readonly ruleId: HarmonyRuleId;
  readonly entryPoints: EntryPoints;
  readonly pairs: readonly Pair[];
}

export function scoreText(score: Score, edits: readonly Edit[] = []): string {
  const rows = (["S", "A", "T", "B", "H"] as const).map(part => {
    const replacements = edits.filter(edit => edit[0] === part);
    let index = 0;
    const line = score.voices[part].replace(/[^\s|]+/g, token => {
      const tokenIndex = index++;
      const edit = replacements.find(([, position]) => position === tokenIndex);
      if (!edit) return token;
      const [, , before, after] = edit;
      if (before !== token || before === after) {
        throw new Error(`Invalid edit for ${part} token ${tokenIndex}: ${before} → ${after}`);
      }
      return after;
    });
    if (replacements.some(([, position]) => position < 0 || position >= index)) {
      throw new Error(`Invalid edit position for ${part}`);
    }
    return `  ${part}: | ${line} |`;
  });
  const lastBar = score.voices.H.split("|").length;
  const annotations = score.annotations?.length
    ? `\nannotations {\n  ${score.annotations.join("\n  ")}\n}`
    : "";
  return `satb 1\nkey ${score.key ?? "C major"}\nmeter 4/4\nbars 1..${lastBar} {\n${rows.join("\n")}\n}${annotations}`;
}

const beat = (fromStart: number) => fromStart * PPQ;
const voices = (fromStart: number, ...voiceIds: [VoiceId, ...VoiceId[]]): ExpectedFinding =>
  ({ tick: beat(fromStart), voiceIds });
const chords = (fromStart: number, firstChordBeat: number, ...otherChordBeats: number[]): ExpectedFinding =>
  ({ tick: beat(fromStart), voiceIds: [], chordTicks: [beat(firstChordBeat), ...otherChordBeats.map(beat)] });
const blind = { blind: true } as const;
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

export const counterexampleGuardrails: readonly RuleGuardrail[] = [
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
          knownGapReason: "已知待修：nonchord.anticipation 目前仅校验目标音与延续，尚未校验弱拍进入与提前时值。",
        },
      ],
    }],
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
];
