import { describe, expect, it } from "vitest";
import { createEmptyProject, PPQ, type NoteEvent, type VoiceId } from "../../project";
import { spellMidi } from "../../pitch";
import { buildChordInferenceObservations } from "./observations";
import { buildChordInferenceCandidates } from "./candidates";

function note(id: string, midiNote: number): NoteEvent {
  return {
    id,
    startTick: 0,
    durationTicks: PPQ,
    pitch: spellMidi(midiNote),
    velocity: 88,
    locked: false,
    spellingSource: "manual",
  };
}

function addChord(
  project: ReturnType<typeof createEmptyProject>,
  pitches: Record<VoiceId, number>,
) {
  for (const [voiceId, midiNote] of Object.entries(pitches) as [VoiceId, number][]) {
    project.satbTracks.find((track) => track.id === voiceId)!.notes = [
      note(`${voiceId}-0`, midiNote),
    ];
  }
}

function candidatesFor(project: ReturnType<typeof createEmptyProject>) {
  const observation = buildChordInferenceObservations(project)[0];
  return buildChordInferenceCandidates(observation);
}

describe("当前调性的功能和弦候选", () => {
  it("优先识别 C 大调主和弦", () => {
    const project = createEmptyProject();
    addChord(project, { soprano: 72, alto: 67, tenor: 64, bass: 48 });

    const candidates = candidatesFor(project);

    expect(candidates[0].functionalBaseId).toBe("T");
    expect(candidates[0].confidence).toBe("high");
    expect(candidates[0].fit.nonChordToneNoteIds).toHaveLength(0);
  });

  it("直接识别根音三次加三音的省五音主和弦", () => {
    const project = createEmptyProject();
    addChord(project, { soprano: 76, alto: 60, tenor: 60, bass: 48 });

    const candidates = candidatesFor(project);

    expect(candidates).toHaveLength(1);
    expect(candidates[0].functionalBaseId).toBe("T");
    expect(candidates[0].fit.omittedChordDegrees).toEqual([5]);
  });

  it("识别 D7，并按低音选择根位", () => {
    const project = createEmptyProject();
    addChord(project, { soprano: 65, alto: 62, tenor: 59, bass: 55 });

    const candidates = candidatesFor(project);
    const dominant = candidates.find((candidate) => candidate.functionalBaseId === "D");

    expect(dominant?.identity.root).toMatchObject({ step: "G", alter: 0 });
    expect(dominant?.identity.structure).toMatchObject({
      kind: "tertian",
      quality: "dominant7",
    });
    expect(dominant?.fit.bassMatchesInversion).toBe(true);
  });

  it("识别六和弦时拒绝不匹配的转位候选", () => {
    const project = createEmptyProject();
    addChord(project, { soprano: 72, alto: 67, tenor: 64, bass: 52 });

    const candidates = candidatesFor(project);

    expect(candidates.some((candidate) =>
      candidate.functionalBaseId === "T" && candidate.identity.bass.step === "E",
    )).toBe(true);
    expect(candidates.some((candidate) =>
      candidate.functionalBaseId === "T" && candidate.identity.bass.step === "C",
    )).toBe(false);
  });

  it("额外音没有非和弦音依据时不生成候选", () => {
    const project = createEmptyProject();
    addChord(project, { soprano: 74, alto: 67, tenor: 64, bass: 48 });

    const candidates = candidatesFor(project);

    expect(candidates).toHaveLength(0);
  });

  it("即使开启有限缺音，也拒绝缺少两个以上和弦音的解释", () => {
    const project = createEmptyProject();
    addChord(project, {
      soprano: 60,
      alto: 60,
      tenor: 48,
      bass: 48,
    });

    const observation = buildChordInferenceObservations(project)[0];
    const candidates = buildChordInferenceCandidates(observation, {
      allowIncompleteVoicing: true,
    });

    expect(candidates).toHaveLength(0);
  });

  it("绝对和弦回退始终是低置信度候选", () => {
    const project = createEmptyProject();
    addChord(project, { soprano: 72, alto: 69, tenor: 66, bass: 54 });

    const observation = buildChordInferenceObservations(project)[0];
    const candidates = buildChordInferenceCandidates(observation, {
      allowAbsoluteFallback: true,
    });
    const fallback = candidates.find((candidate) => !candidate.functionalBaseId);

    expect(fallback).toBeDefined();
    expect(fallback?.confidence).toBe("low");
    expect(fallback?.semantics).toBeUndefined();
  });

  describe.each([
    { baseId: "It+6", innerPitch: { step: "C", alter: 0, octave: 4 } },
    { baseId: "Fr+6", innerPitch: { step: "D", alter: 0, octave: 4 } },
    { baseId: "Ger+6", innerPitch: { step: "E", alter: -1, octave: 4 } },
  ] as const)("$baseId 必要构成音", ({ baseId, innerPitch }) => {
    function augmentedSixthProject() {
      const project = createEmptyProject();
      project.lengthTicks = PPQ;
      addChord(project, { soprano: 78, alto: 60, tenor: 60, bass: 56 });
      project.satbTracks.find((track) => track.voice === "alto")!.notes[0].pitch = innerPitch;
      project.satbTracks.find((track) => track.voice === "bass")!.notes[0].pitch = {
        step: "A", alter: -1, octave: 2,
      };
      return project;
    }

    it("完整结构仍生成高置信度候选", () => {
      const candidates = candidatesFor(augmentedSixthProject());
      const candidate = candidates.find((item) => item.functionalBaseId === baseId);
      expect(candidate?.confidence).toBe("high");
      expect(candidate?.score.toneFit).toBe(1);
    });

    it.each([false, true])("缺少任意构成音均拒绝（有限缺音 %s）", (allowIncompleteVoicing) => {
      const original = augmentedSixthProject();
      const pitches = [...new Set(original.satbTracks.flatMap((track) =>
        track.notes.map((item) => `${item.pitch.step}:${item.pitch.alter}`),
      ))];
      for (const removedPitch of pitches) {
        const project = structuredClone(original);
        for (const track of project.satbTracks) {
          track.notes = track.notes.filter((item) =>
            `${item.pitch.step}:${item.pitch.alter}` !== removedPitch,
          );
        }
        const observation = buildChordInferenceObservations(project)[0];
        const candidates = buildChordInferenceCandidates(observation, {
          allowIncompleteVoicing,
          allowNonChordToneCandidates: true,
        });
        expect(candidates.some((item) => item.functionalBaseId === baseId), removedPitch).toBe(false);
      }
    });
  });
});
