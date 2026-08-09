import { describe, expect, it } from "vitest";
import {
  resolveChordIdentity,
  semanticsFromChordDraft,
  type ChordDraft,
} from "../chordModel";
import {
  createEmptyProject,
  PPQ,
  type ChordRegion,
  type NoteEvent,
  type ProjectDocument,
  type VoiceId,
} from "../project";
import type { SpelledPitch } from "../pitch";
import {
  checkHarmony,
  HARMONY_RULE_DEFINITIONS,
  HARMONY_RULE_IDS_IMPLEMENTED_IN_REVISION_2,
} from "./index";

const C_MAJOR = {
  tonic: { step: "C", alter: 0 },
  mode: "major",
} as const;

function pitch(
  step: SpelledPitch["step"],
  alter: SpelledPitch["alter"],
  octave: number,
): SpelledPitch {
  return { step, alter, octave };
}

function note(
  id: string,
  startTick: number,
  value: SpelledPitch,
  durationTicks = PPQ,
  nonChordToneRole?: NoteEvent["nonChordToneRole"],
): NoteEvent {
  return {
    id,
    startTick,
    durationTicks,
    pitch: value,
    velocity: 88,
    locked: false,
    spellingSource: "manual",
    nonChordToneRole,
  };
}

function setVoice(
  project: ProjectDocument,
  voiceId: VoiceId,
  notes: readonly NoteEvent[],
) {
  project.satbTracks.find((track) => track.id === voiceId)!.notes = [...notes];
}

function functionalChord(
  id: string,
  startTick: number,
  draft: ChordDraft,
  durationTicks = PPQ,
): ChordRegion {
  const localKey = draft.localKey ?? C_MAJOR;
  return {
    id,
    startTick,
    durationTicks,
    identity: resolveChordIdentity(draft, localKey),
    semantics: semanticsFromChordDraft(draft),
    locked: false,
  };
}

function draft(
  degree: ChordDraft["degree"],
  quality: ChordDraft["quality"],
  primaryFunction: "tonic" | "subdominant" | "dominant",
  options: Partial<ChordDraft> = {},
): ChordDraft {
  return {
    degree,
    degreeAlteration: 0,
    quality,
    extensions: [],
    alterations: [],
    inversion: 0,
    designation: {
      notationSystem: "spasobin",
      kind: degree === 1 || degree === 4 || degree === 5 ? "primary" : "side-degree",
      primaryFunction,
    },
    source: "manual",
    confidence: "certain",
    ...options,
  };
}

function hasRule(project: ProjectDocument, ruleId: string) {
  return checkHarmony(project).diagnostics.some(
    (diagnostic) => diagnostic.ruleId === ruleId,
  );
}

describe("完整规则目录首版实现", () => {
  it("81 条目录规则均有可执行实现", () => {
    expect(HARMONY_RULE_DEFINITIONS).toHaveLength(81);
    expect(HARMONY_RULE_DEFINITIONS.every((item) => item.implemented)).toBe(true);
    expect(HARMONY_RULE_IDS_IMPLEMENTED_IN_REVISION_2).toHaveLength(37);
    expect(new Set(HARMONY_RULE_IDS_IMPLEMENTED_IN_REVISION_2).size).toBe(37);
  });

  it("严格四声部、同向进行和原位三和弦重复音均能诊断", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 2;
    project.ruleProfile.shared.strictFourPartTexture = true;
    project.chordTrack.regions = [
      functionalChord("tonic", 0, draft(1, "major", "tonic"), PPQ * 2),
    ];
    setVoice(project, "soprano", [
      note("s1", 0, pitch("E", 0, 4)),
      note("s2", PPQ, pitch("F", 0, 4)),
    ]);
    setVoice(project, "alto", [
      note("a1", 0, pitch("C", 0, 4)),
      note("a2", PPQ, pitch("D", 0, 4)),
    ]);
    setVoice(project, "tenor", [
      note("t1", 0, pitch("G", 0, 3)),
      note("t2", PPQ, pitch("A", 0, 3)),
    ]);

    expect(hasRule(project, "voice.incomplete-satb")).toBe(true);

    setVoice(project, "bass", [
      note("b1", 0, pitch("C", 0, 3)),
      note("b2", PPQ, pitch("D", 0, 3)),
    ]);
    expect(hasRule(project, "voice-leading.all-voices-similar")).toBe(true);

    const voicing = createEmptyProject();
    voicing.lengthTicks = PPQ;
    voicing.chordTrack.regions = [
      functionalChord("root-triad", 0, draft(1, "major", "tonic")),
    ];
    setVoice(voicing, "soprano", [note("vs", 0, pitch("E", 0, 5))]);
    setVoice(voicing, "alto", [note("va", 0, pitch("G", 0, 4))]);
    setVoice(voicing, "tenor", [note("vt", 0, pitch("E", 0, 4))]);
    setVoice(voicing, "bass", [note("vb", 0, pitch("C", 0, 3))]);
    expect(hasRule(voicing, "chord.triad-root-position-doubling")).toBe(true);
  });

  it("只验证人工标注的非和弦音角色", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 3;
    project.chordTrack.regions = [
      functionalChord("tonic", 0, draft(1, "major", "tonic"), PPQ * 3),
    ];
    setVoice(project, "soprano", [
      note("p1", 0, pitch("C", 0, 5)),
      note("passing", PPQ, pitch("D", 0, 5), PPQ, "passing"),
      note("p3", PPQ * 2, pitch("G", 0, 5)),
    ]);
    setVoice(project, "alto", [note("pa", 0, pitch("E", 0, 4), PPQ * 3)]);
    setVoice(project, "tenor", [note("pt", 0, pitch("G", 0, 3), PPQ * 3)]);
    setVoice(project, "bass", [note("pb", 0, pitch("C", 0, 3), PPQ * 3)]);

    expect(hasRule(project, "nonchord.passing-tone")).toBe(true);
    project.satbTracks.find((track) => track.id === "soprano")!.notes[1]
      .nonChordToneRole = undefined;
    expect(hasRule(project, "nonchord.passing-tone")).toBe(false);
  });

  it("D7 专用连接联合报告并覆盖通用导音诊断", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 2;
    project.chordTrack.regions = [
      functionalChord(
        "dominant7",
        0,
        draft(5, "dominant7", "dominant"),
      ),
      functionalChord("tonic", PPQ, draft(1, "major", "tonic")),
    ];
    setVoice(project, "soprano", [
      note("ds1", 0, pitch("B", 0, 4)),
      note("ds2", PPQ, pitch("B", 0, 4)),
    ]);
    setVoice(project, "alto", [
      note("da1", 0, pitch("F", 0, 4)),
      note("da2", PPQ, pitch("E", 0, 4)),
    ]);
    setVoice(project, "tenor", [
      note("dt1", 0, pitch("D", 0, 4)),
      note("dt2", PPQ, pitch("G", 0, 3)),
    ]);
    setVoice(project, "bass", [
      note("db1", 0, pitch("G", 0, 2)),
      note("db2", PPQ, pitch("C", 0, 3)),
    ]);

    const result = checkHarmony(project).diagnostics;
    expect(result.some((item) => item.ruleId === "connection.dominant-seventh")).toBe(true);
    expect(result.some((item) => item.ruleId === "resolution.leading-tone")).toBe(false);
  });

  it("显式完全终止标记驱动终止规则，不猜测未标注乐句", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 2;
    project.chordTrack.regions = [
      functionalChord("cad-d", 0, draft(5, "major", "dominant")),
      functionalChord(
        "cad-t",
        PPQ,
        draft(1, "major", "tonic", { cadenceType: "perfect-authentic" }),
      ),
    ];
    setVoice(project, "soprano", [
      note("cs1", 0, pitch("D", 0, 5)),
      note("cs2", PPQ, pitch("E", 0, 5)),
    ]);
    setVoice(project, "alto", [
      note("ca1", 0, pitch("B", 0, 4)),
      note("ca2", PPQ, pitch("C", 0, 5)),
    ]);
    setVoice(project, "tenor", [
      note("ct1", 0, pitch("G", 0, 3)),
      note("ct2", PPQ, pitch("G", 0, 3)),
    ]);
    setVoice(project, "bass", [
      note("cb1", 0, pitch("G", 0, 2)),
      note("cb2", PPQ, pitch("C", 0, 3)),
    ]);
    expect(hasRule(project, "cadence.perfect-authentic-soprano")).toBe(true);

    project.chordTrack.regions[1].semantics!.cadenceType = undefined;
    expect(hasRule(project, "cadence.perfect-authentic-soprano")).toBe(false);
  });

  it("连续局部调性与互斥解释分别产生调性和语意提示", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 3;
    const G_MAJOR = {
      tonic: { step: "G", alter: 0 },
      mode: "major",
    } as const;
    project.chordTrack.regions = [
      functionalChord("g-t", 0, draft(1, "major", "tonic", { localKey: G_MAJOR })),
      functionalChord("g-s", PPQ, draft(4, "major", "subdominant", { localKey: G_MAJOR })),
      functionalChord("g-d", PPQ * 2, draft(5, "major", "dominant", { localKey: G_MAJOR })),
    ];
    expect(hasRule(project, "tonality.unmarked-key-change")).toBe(true);

    const ambiguous = createEmptyProject();
    ambiguous.lengthTicks = PPQ * 2;
    const first = functionalChord("ambiguous", 0, draft(1, "major", "tonic"));
    first.semantics = {
      interpretations: [
        {
          id: "c-tonic",
          degree: 1,
          degreeAlteration: 0,
          designation: {
            notationSystem: "spasobin",
            kind: "primary",
            primaryFunction: "tonic",
          },
          source: "inferred",
          confidence: "ambiguous",
        },
        {
          id: "f-dominant",
          localKey: { tonic: { step: "F", alter: 0 }, mode: "major" },
          degree: 5,
          degreeAlteration: 0,
          designation: {
            notationSystem: "spasobin",
            kind: "primary",
            primaryFunction: "dominant",
          },
          source: "inferred",
          confidence: "probable",
        },
      ],
      primaryInterpretationId: "c-tonic",
    };
    ambiguous.chordTrack.regions = [
      first,
      functionalChord("next", PPQ, draft(5, "major", "dominant")),
    ];
    expect(hasRule(ambiguous, "function.ambiguous-connection")).toBe(true);
  });
});
