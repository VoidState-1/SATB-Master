import { chordIdentityToneSpellings, chordToneSpellings } from "../../../chordModel";
import {
  keyEquals,
  pitchClassEquals, scaleDegreePitchClass, spelledPitchEquals, stepIndex, toMidi, writtenInterval,
  type SpelledPitchClass,
} from "../../../pitch";
import type { AnalysisSlice, SliceTransition } from "../../analysis";
import { soundsDeclaredChord } from "../../writtenVoicing";
import { hasCompleteWrittenTertianVoicing } from "../../writtenTertian";
import type { HarmonyRuleContext } from "../context/createRuleContext";
import type { VoicePairTransitionFact } from "../sharedFacts";
import { sameHarmonyOnTransition } from "./motionHarmony";

function contains(pitches: readonly SpelledPitchClass[], pitch: SpelledPitchClass) {
  return pitches.some(member => pitchClassEquals(member, pitch));
}

function writtenHarmony(slice: AnalysisSlice, context: HarmonyRuleContext) {
  const bass = slice.notes.bass;
  if (!slice.completeSatb || !bass) return;
  const notes = Object.values(slice.notes);
  if (notes.some(note => note.nonChordToneRole || toMidi(note.pitch) < toMidi(bass.pitch))) return;
  const pitches = notes.map(note => note.pitch);
  const complete = hasCompleteWrittenTertianVoicing(pitches);
  const { chord } = slice;
  let key = slice.key;
  let tones: readonly SpelledPitchClass[] | undefined;

  if (chord) {
    const { identity, semantics } = chord;
    if (identity.structure.kind !== "tertian" || !pitchClassEquals(identity.bass, bass.pitch) ||
        semantics?.cadenceRole || semantics?.pedalContext || semantics?.mixture) return;
    const reading = context.harmony.primaryInterpretation(chord);
    if (reading.status !== "resolved") return;
    const { degree, degreeAlteration, localKey, designation, appliedTarget } = reading.value;
    if (appliedTarget || (designation && designation.kind !== "primary" && designation.kind !== "side-degree")) return;
    if (localKey) key = { ...slice.key, ...localKey };
    if (!pitchClassEquals(identity.root, scaleDegreePitchClass(key, degree, degreeAlteration))) return;
    const labeledTones = chordIdentityToneSpellings(identity);
    if (!pitches.every(pitch => contains(labeledTones, pitch))) return;
    tones = labeledTones;
  }

  if (complete) {
    if (tones && !tones.every(tone => contains(pitches, tone))) return;
    return { pitches, tones: pitches, key, complete };
  }

  // Four sounding parts can still prove an ordinary root-position triad with its fifth omitted.
  if (pitches.filter(pitch => pitchClassEquals(pitch, bass.pitch)).length !== 3) return;
  const degree = (stepIndex(bass.pitch.step) - stepIndex(key.tonic.step) + 7) % 7 + 1;
  if (!chord && !pitchClassEquals(bass.pitch, scaleDegreePitchClass(key, degree))) return;
  const partialTriad = (["major", "minor"] as const)
    .map(quality => chordToneSpellings(bass.pitch, quality))
    .find(triad => contains(pitches, triad[1]) &&
      (!tones || (tones.length === triad.length && triad.every(member => contains(tones, member)))));
  if (partialTriad) return { pitches, tones: partialTriad, key, complete };
}

function overlapsByOctaveFromUnison(fact: VoicePairTransitionFact, tick: number) {
  const [oldUpper, oldLower] = fact.previousNotes;
  const [upper, lower] = fact.currentNotes;
  if (!spelledPitchEquals(oldUpper.pitch, oldLower.pitch) || !fact.sameDirection ||
      upper.startTick !== tick || lower.startTick !== tick || toMidi(upper.pitch) <= toMidi(lower.pitch)) return false;

  // Measure the crossing of the other part's previous pitch, not the larger leap.
  const overlap = fact.upperMotion === "up"
    ? writtenInterval(oldUpper.pitch, lower.pitch)
    : writtenInterval(upper.pitch, oldLower.pitch);
  return overlap.diatonicSteps >= 7 && overlap.semitones >= 12;
}

function hasExclusiveMembers(left: readonly SpelledPitchClass[], right: readonly SpelledPitchClass[]) {
  return left.some(pitch => !contains(right, pitch)) && right.some(pitch => !contains(left, pitch));
}

function declaredMembers(slice: AnalysisSlice, context: HarmonyRuleContext) {
  const chord = slice.chord;
  if (!chord || chord.semantics?.pedalContext || !soundsDeclaredChord(slice) ||
      context.harmony.primaryInterpretation(chord).status !== "resolved") return;
  return chordIdentityToneSpellings(chord.identity);
}

/** Check the two voicings that actually produced the overlap. */
export function overlapSameHarmony(
  context: HarmonyRuleContext, transition: SliceTransition, fact: VoicePairTransitionFact,
): boolean | undefined {
  if (sameHarmonyOnTransition(transition, context.harmony)) return true;
  const { previous, current } = transition;
  if (!transition.contiguous || !transition.sameKey || context.boundaryAt(current.tick)?.source === "manual") return;

  // For two separately voiced parts, a complete change at this attack rules
  // out a revoicing exemption inherited from an adjacent attack of a held note.
  if (fact.previousInterval.semitones > 0 && fact.currentInterval.semitones > 0) {
    const before = declaredMembers(previous, context);
    const after = declaredMembers(current, context);
    if (before && after && hasExclusiveMembers(before, after)) return false;
  }
  if (!overlapsByOctaveFromUnison(fact, current.tick)) return;
  const source = writtenHarmony(previous, context);
  const target = writtenHarmony(current, context);
  if (!source || !target || (!source.complete && !target.complete) ||
      !keyEquals(source.key, target.key)) return;
  if (source.pitches.some(pitch => !contains(target.tones, pitch)) &&
      target.pitches.some(pitch => !contains(source.tones, pitch))) return false;
}
