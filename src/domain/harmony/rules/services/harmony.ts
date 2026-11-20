import {
  harmonySemanticsConfidence,
  identityContainsPitchClass,
  identityContainsWrittenPitchClass,
  primaryHarmonyInterpretation,
  type HarmonyInterpretation,
} from "../../../chordModel";
import type {
  AnalysisChord,
  AnalysisNote,
  AnalysisSlice,
  HarmonySpan,
  HarmonyAnalysis,
} from "../../analysis";
import { leadingTonePitchClass, scaleDegreePitchClass, type KeyLike } from "../../../pitch";
import { chordMemberFacts } from "../sharedFacts";

export function leadingTargetDegree(interpretation?: HarmonyInterpretation) {
  const designation = interpretation?.designation?.kind;
  return interpretation?.appliedTarget?.degree ?? (
    designation === "double-dominant" || designation === "double-dominant-leading-tone" ? 5 : undefined
  );
}

export function leadingToneForFunction(baseKey: KeyLike, interpretation?: HarmonyInterpretation) {
  const key = interpretation?.localKey ?? baseKey;
  const targetDegree = leadingTargetDegree(interpretation);
  if (!targetDegree) return { tone: leadingTonePitchClass(key), applied: false };
  return {
    tone: leadingTonePitchClass({ tonic: scaleDegreePitchClass(key, targetDegree), mode: "major" }),
    applied: true,
  };
}

export type Resolution<T> =
  | {
      readonly status: "resolved";
      readonly value: T;
      readonly confidence: number;
    }
  | {
      readonly status: "ambiguous";
      readonly candidates: readonly T[];
      readonly reason: string;
    }
  | { readonly status: "unavailable"; readonly reason: string };

export interface HarmonyAnalysisService {
  isWrittenChordTone(
    note: AnalysisNote,
    chord: AnalysisChord | undefined,
  ): boolean;
  isSoundingChordTone(
    note: AnalysisNote,
    chord: AnalysisChord | undefined,
  ): boolean;
  chordMembersAt(
    slice: AnalysisSlice,
  ): ReturnType<typeof chordMemberFacts>;
  primaryInterpretation(
    subject: HarmonySpan | AnalysisChord,
  ): Resolution<HarmonyInterpretation>;
}

function semanticsOf(subject: HarmonySpan | AnalysisChord) {
  return subject.semantics;
}

export function createHarmonyAnalysisService(analysis?: Pick<HarmonyAnalysis, "writtenProlongations">): HarmonyAnalysisService {
  const service: HarmonyAnalysisService = {
    isWrittenChordTone(note, chord) {
      return Boolean(chord && identityContainsWrittenPitchClass(chord.identity, note.pitch));
    },
    isSoundingChordTone(note, chord) {
      return Boolean(chord && identityContainsPitchClass(chord.identity, note.pitch));
    },
    chordMembersAt(slice) {
      if (slice.chord) return chordMemberFacts(slice, slice.chord);
      const fact = analysis?.writtenProlongations.get(slice.tick);
      return fact ? chordMemberFacts(slice, { identity: fact.surfaceIdentity }) : [];
    },
    primaryInterpretation(subject) {
      const semantics = semanticsOf(subject);
      if (!semantics || semantics.interpretations.length === 0)
        return { status: "unavailable", reason: "missing-semantics" };
      const primary = primaryHarmonyInterpretation(semantics);
      const confidence = harmonySemanticsConfidence(semantics);
      if (confidence === "ambiguous" || confidence === "unknown")
        return {
          status: "ambiguous",
          candidates: Object.freeze([
            ...semantics.interpretations,
            ...(semantics.alternatives ?? []),
          ]),
          reason: "ambiguous-semantics",
        };
      return {
        status: "resolved",
        value: primary,
        confidence: confidence === "certain" ? 1 : 0.8,
      };
    },
  };
  return Object.freeze(service);
}
