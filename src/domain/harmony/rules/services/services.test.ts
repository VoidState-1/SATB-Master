import { describe, expect, it } from "vitest";
import { createEmptyProject, PPQ } from "../../../project";
import { spellMidi } from "../../../pitch";
import { buildHarmonyAnalysis } from "../../analysis";
import {
  correctionChord,
  correctionNote,
  setCorrectionVoice,
} from "../../testing/fixtures/harmonyProject";
import { createHarmonyAnalysisService } from "./harmony";
import { createMetricAnalysisService } from "./metric";
import { createPitchAnalysisService } from "./pitch";
import { createVoiceLeadingService } from "./voiceLeading";

describe("规则领域 services", () => {
  it("pitch 保留书写音程、等音与转调音级语义", () => {
    const service = createPitchAnalysisService();
    const cSharp = { step: "C", alter: 1, octave: 4 } as const;
    const dFlat = { step: "D", alter: -1, octave: 4 } as const;

    expect(service.sameWrittenPitch(cSharp, dFlat)).toBe(false);
    expect(service.sameSoundingPitch(cSharp, dFlat)).toBe(true);
    expect(
      service.writtenIntervalBetween(
        { step: "B", alter: 0, octave: 4 },
        { step: "C", alter: 0, octave: 5 },
      ),
    ).toEqual({ diatonicSteps: 1, semitones: 1 });
    expect(
      service.scaleDegreePitch(
        {
          id: "eb-major",
          tick: 0,
          tonic: { step: "E", alter: -1 },
          mode: "major",
        },
        7,
      ),
    ).toEqual({ step: "D", alter: 0 });
    expect(
      service.scaleDegreeOf(
        { step: "D", alter: 0, octave: 5 },
        {
          id: "eb-major",
          tick: 0,
          tonic: { step: "E", alter: -1 },
          mode: "major",
        },
      ),
    ).toBe(7);
  });

  it("metric 装配复合拍与歧义拍组，不另造 Resolution 包装", () => {
    const compound = createEmptyProject();
    compound.lengthTicks = PPQ * 3;
    compound.meterEvents = [
      { id: "six-eight", tick: 0, numerator: 6, denominator: 8 },
    ];
    const compoundService = createMetricAnalysisService(
      buildHarmonyAnalysis(compound).metricTimeline,
    );
    expect(compoundService.positionAt((PPQ / 2) * 3)).toMatchObject({
      role: "secondary-accent",
      confidence: "certain",
    });

    const ambiguous = createEmptyProject();
    ambiguous.lengthTicks = (PPQ / 2) * 5;
    ambiguous.meterEvents = [
      { id: "five-eight", tick: 0, numerator: 5, denominator: 8 },
    ];
    const ambiguousService = createMetricAnalysisService(
      buildHarmonyAnalysis(ambiguous).metricTimeline,
    );
    const position = ambiguousService.positionAt(PPQ / 2);
    expect(position).toMatchObject({ confidence: "ambiguous" });
    expect(
      ambiguousService.compare(position, ambiguousService.positionAt(0)),
    ).toBe("unknown");
  });

  it("harmony 区分确定解释、歧义解释和缺失语义", () => {
    const service = createHarmonyAnalysisService();
    const chord = correctionChord("tonic", 0, PPQ);
    const project = createEmptyProject();
    project.lengthTicks = PPQ;
    project.chordTrack.regions = [chord];
    setCorrectionVoice(project, "alto", [
      correctionNote("c", 0, spellMidi(60), PPQ),
    ]);
    const analysis = buildHarmonyAnalysis(project);
    const slice = analysis.slices[0];

    expect(service.isWrittenChordTone(slice.notes.alto!, slice.chord)).toBe(true);
    expect(service.isSoundingChordTone(slice.notes.alto!, slice.chord)).toBe(true);
    expect(service.chordMembersAt(slice)).not.toHaveLength(0);
    expect(service.primaryInterpretation(slice.chord!)).toMatchObject({
      status: "resolved",
      confidence: 1,
    });

    const ambiguous = structuredClone(chord);
    ambiguous.semantics = {
      ...ambiguous.semantics!,
      interpretations: [
        ...ambiguous.semantics!.interpretations,
        {
          ...ambiguous.semantics!.interpretations[0],
          id: "alternative",
          confidence: "ambiguous",
        },
      ],
      primaryInterpretationId: "alternative",
    };
    expect(service.primaryInterpretation(ambiguous)).toMatchObject({
      status: "ambiguous",
      reason: "ambiguous-semantics",
    });

    const withAlternative = structuredClone(chord);
    withAlternative.semantics = {
      ...withAlternative.semantics!,
      alternatives: [
        {
          ...withAlternative.semantics!.interpretations[0],
          id: "unresolved-alternative",
          confidence: "probable",
        },
      ],
    };
    expect(service.primaryInterpretation(withAlternative)).toMatchObject({
      status: "ambiguous",
      reason: "ambiguous-semantics",
      candidates: expect.arrayContaining([
        expect.objectContaining({ id: "unresolved-alternative" }),
      ]),
    });

    const unavailable = structuredClone(chord);
    delete unavailable.semantics;
    expect(service.primaryInterpretation(unavailable)).toEqual({
      status: "unavailable",
      reason: "missing-semantics",
    });
  });

  it("voiceLeading 对完整和不完整 SATB 都返回稳定声部对集合", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 2;
    project.chordTrack.regions = [correctionChord("c", 0, PPQ * 2)];
    const pitches = {
      soprano: [72, 74],
      alto: [67, 69],
      tenor: [60, 62],
      bass: [48, 50],
    } as const;
    for (const [voiceId, midi] of Object.entries(pitches)) {
      setCorrectionVoice(
        project,
        voiceId as keyof typeof pitches,
        midi.map((value, index) =>
          correctionNote(`${voiceId}-${index}`, index * PPQ, spellMidi(value)),
        ),
      );
    }
    const analysis = buildHarmonyAnalysis(project);
    const service = createVoiceLeadingService();
    expect(service.voicePairs(analysis.sliceTransitions[0])).toHaveLength(6);

    setCorrectionVoice(project, "tenor", []);
    const incomplete = buildHarmonyAnalysis(project);
    expect(service.voicePairs(incomplete.sliceTransitions[0])).toHaveLength(3);
  });
});
