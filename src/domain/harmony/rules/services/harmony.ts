import {
  chordIdentityToneSpellings,
  harmonySemanticsConfidence,
  primaryHarmonyInterpretation,
  type HarmonyInterpretation,
} from "../../../chordModel";
import { pitchClassEquals } from "../../../pitch";
import type {
  AnalysisChord,
  AnalysisNote,
  AnalysisSlice,
  HarmonySpan,
} from "../../analysis";
import { chordMemberFacts } from "../sharedFacts";

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
  isChordTone(
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

export function createHarmonyAnalysisService(): HarmonyAnalysisService {
  const service: HarmonyAnalysisService = {
    isChordTone(note, chord) {
      return Boolean(
        chord &&
          chordIdentityToneSpellings(chord.identity).some((tone) =>
            pitchClassEquals(note.pitch, tone),
          ),
      );
    },
    chordMembersAt(slice) {
      return slice.chord ? chordMemberFacts(slice, slice.chord) : [];
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
