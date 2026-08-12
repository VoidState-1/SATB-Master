import type { ScaleDegree } from "../../../chordModel";
import type { AnalysisNote, AnalysisKey } from "../../analysis";
import {
  pitchClassEquals,
  scaleDegreePitchClass,
  stepIndex,
  toMidi,
  writtenInterval,
  type SpelledPitch,
} from "../../../pitch";

export interface PitchAnalysisService {
  writtenIntervalBetween(
    left: SpelledPitch | AnalysisNote,
    right: SpelledPitch | AnalysisNote,
  ): ReturnType<typeof writtenInterval>;
  sameWrittenPitch(
    left: SpelledPitch | AnalysisNote,
    right: SpelledPitch | AnalysisNote,
  ): boolean;
  sameSoundingPitch(
    left: SpelledPitch | AnalysisNote,
    right: SpelledPitch | AnalysisNote,
  ): boolean;
  isStep(left: AnalysisNote, right: AnalysisNote): boolean;
  scaleDegreeOf(
    pitch: SpelledPitch | AnalysisNote,
    key: AnalysisKey,
  ): ScaleDegree;
  scaleDegreePitch(
    key: AnalysisKey,
    degree: ScaleDegree,
    alteration?: number,
  ): ReturnType<typeof scaleDegreePitchClass>;
}

function pitchOf(value: SpelledPitch | AnalysisNote) {
  return "pitch" in value ? value.pitch : value;
}

export function createPitchAnalysisService(): PitchAnalysisService {
  const service: PitchAnalysisService = {
    writtenIntervalBetween(left, right) {
      return writtenInterval(pitchOf(left), pitchOf(right));
    },
    sameWrittenPitch(left, right) {
      const leftPitch = pitchOf(left);
      const rightPitch = pitchOf(right);
      return (
        leftPitch.octave === rightPitch.octave &&
        pitchClassEquals(leftPitch, rightPitch)
      );
    },
    sameSoundingPitch(left, right) {
      return toMidi(pitchOf(left)) === toMidi(pitchOf(right));
    },
    isStep(left, right) {
      const interval = writtenInterval(left.pitch, right.pitch);
      return (
        Math.abs(interval.diatonicSteps) === 1 &&
        Math.abs(interval.semitones) >= 1 &&
        Math.abs(interval.semitones) <= 2
      );
    },
    scaleDegreeOf(value, key) {
      const pitch = pitchOf(value);
      const distance =
        (stepIndex(pitch.step) - stepIndex(key.tonic.step) + 7) % 7;
      return (distance + 1) as ScaleDegree;
    },
    scaleDegreePitch(key, degree, alteration = 0) {
      return scaleDegreePitchClass(key, degree, alteration);
    },
  };
  return Object.freeze(service);
}
