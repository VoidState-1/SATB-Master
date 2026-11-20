import { chordIdentityToneSpellings } from "../../../chordModel";
import type { AnalysisChord, AnalysisSlice } from "../../analysis";
import type { HarmonyRuleContext } from "../context/createRuleContext";
import { activeNotes } from "./core";

export interface ChordSliceFact {
  readonly slice: AnalysisSlice;
  readonly chord: AnalysisChord;
  readonly active: ReturnType<typeof activeNotes>;
  readonly tones: ReturnType<typeof chordIdentityToneSpellings>;
  readonly stableComplete: boolean;
}

interface ChordSliceFacts {
  readonly all: readonly ChordSliceFact[];
  readonly standard: readonly ChordSliceFact[];
}

// Each check owns its rule context, including incremental and concurrent checks.
const byContext = new WeakMap<HarmonyRuleContext, ChordSliceFacts>();

export function chordSliceFacts(context: HarmonyRuleContext): ChordSliceFacts {
  const cached = byContext.get(context);
  if (cached) return cached;

  const all: ChordSliceFact[] = [];
  const standard: ChordSliceFact[] = [];
  for (const slice of context.slices()) {
    const chord = slice.chord;
    if (!chord) continue;
    const fact = {
      slice, chord, active: activeNotes(slice), tones: chordIdentityToneSpellings(chord.identity),
      stableComplete: slice.completeSatb && !context.sliceTransitions({ fromSliceIndex: slice.index }).first()?.sameHarmony,
    };
    all.push(fact);
    const { structure } = chord.identity;
    if (structure.kind === "tertian" && !structure.extensions.some(degree => degree >= 9)) standard.push(fact);
  }
  const facts = { all, standard };
  byContext.set(context, facts);
  return facts;
}
