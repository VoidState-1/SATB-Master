import { chordIdentityEquals, chordIdentityToneSpellings, primaryHarmonyInterpretation } from "../../../chordModel";
import { pitchClassEquals, spelledPitchEquals, toMidi, writtenInterval } from "../../../pitch";
import { VOICE_ORDER } from "../../../project/voice";
import type { AnalysisChord, AnalysisSlice } from "../../analysis";
import { returnsByWrittenStep, soundsCompleteWrittenChord } from "../../writtenNeighbors";
import { hasCompleteWrittenTertianVoicing } from "../../writtenTertian";
import type { HarmonyRuleContext } from "../context/createRuleContext";

function simpleLabel(chord: AnalysisChord) {
  const semantics = chord.semantics;
  if (!semantics) return true;
  return semantics.interpretations.length === 1 && !semantics.alternatives?.length &&
    !semantics.cadenceRole && !semantics.pedalContext;
}

function sameLabel(anchor: AnalysisChord, candidate: AnalysisChord | undefined) {
  if (!candidate || !simpleLabel(candidate) || !chordIdentityEquals(anchor.identity, candidate.identity))
    return false;
  if (anchor.id === candidate.id) return true;
  const left = anchor.semantics, right = candidate.semantics;
  if (!left || !right) return left === right;
  const a = primaryHarmonyInterpretation(left), b = primaryHarmonyInterpretation(right);
  return a.degree === b.degree && a.degreeAlteration === b.degreeAlteration &&
    left.mixture === right.mixture &&
    JSON.stringify(a.localKey) === JSON.stringify(b.localKey) &&
    JSON.stringify(a.appliedTarget) === JSON.stringify(b.appliedTarget) &&
    JSON.stringify(a.designation) === JSON.stringify(b.designation);
}

function orderedNotes(slice: AnalysisSlice) {
  if (!slice.completeSatb) return;
  const notes = VOICE_ORDER.map(voice => slice.notes[voice]!);
  if (notes.some((note, i) => i > 0 && toMidi(notes[i - 1].pitch) <= toMidi(note.pitch))) return;
  return notes;
}

function outerThirdOrSixth(notes: NonNullable<ReturnType<typeof orderedNotes>>) {
  const interval = writtenInterval(notes[3].pitch, notes[0].pitch);
  const steps = interval.diatonicSteps % 7;
  const semitones = interval.semitones % 12;
  return (steps === 2 && (semitones === 3 || semitones === 4)) ||
    (steps === 5 && (semitones === 8 || semitones === 9));
}

/** Spasobin §40.5: on a held harmony the outer voices can decorate the
 * same inversion with synchronous, written neighbors. */
export function hasPairedOuterNeighborBass(context: HarmonyRuleContext, slice: AnalysisSlice) {
  const bass = slice.notes.bass, soprano = slice.notes.soprano;
  const chord = slice.chord;
  if (!bass || !soprano || !chord || !simpleLabel(chord) ||
      chord.identity.structure.kind !== "tertian" ||
      chord.identity.structure.extensions.length || chord.identity.structure.alterations.length ||
      !["major", "minor"].includes(chord.identity.structure.quality)) return false;

  const start = bass.startTick, end = start + bass.durationTicks;
  if (soprano.startTick !== start || soprano.durationTicks !== bass.durationTicks ||
      bass.durationTicks > context.analysis.project.ppq) return false;
  const tones = chordIdentityToneSpellings(chord.identity);
  if (tones.some(tone => pitchClassEquals(tone, bass.pitch) || pitchClassEquals(tone, soprano.pitch))) return false;
  const position = context.metric.positionAt(start);
  const strongest = context.metric.strongestBetween(start, end);
  if (position?.confidence !== "certain" ||
      (strongest && strongest.level > position.level) ||
      (position.role !== "weak-beat" && position.role !== "subdivision") ||
      context.metric.positionAt(end - 1)?.measureNumber !== position.measureNumber) return false;

  const before = context.sliceAt(start - 1), after = context.sliceAt(end);
  if (!before || !after || !sameLabel(chord, before.chord) || !sameLabel(chord, after.chord) ||
      after.key.id !== before.key.id || context.analysis.phraseBoundaries.some(
        boundary => before.tick < boundary.tick && boundary.tick <= end)) return false;

  const first = orderedNotes(before), middle = orderedNotes(slice), last = orderedNotes(after);
  if (!first || !middle || !last ||
      !soundsCompleteWrittenChord(chord.identity, first, first[3]) ||
      !soundsCompleteWrittenChord(chord.identity, last, last[3]) ||
      !returnsByWrittenStep(first[3], bass, last[3]) ||
      !returnsByWrittenStep(first[0], soprano, last[0]) ||
      hasCompleteWrittenTertianVoicing(middle.map(note => note.pitch))) return false;
  const upperMotion = writtenInterval(first[0].pitch, soprano.pitch);
  const lowerMotion = writtenInterval(first[3].pitch, bass.pitch);
  if (upperMotion.diatonicSteps === lowerMotion.diatonicSteps &&
      (!outerThirdOrSixth(first) || !outerThirdOrSixth(middle))) return false;
  if (![1, 2].every(i => spelledPitchEquals(first[i].pitch, last[i].pitch))) return false;
  return context.slices({ overlapping: { fromTick: start, toTick: end } }).all(frame =>
    frame.key.id === before.key.id && sameLabel(chord, frame.chord) &&
    frame.notes.bass?.id === bass.id && frame.notes.soprano?.id === soprano.id &&
    frame.notes.alto?.id === first[1].id && frame.notes.tenor?.id === first[2].id,
  );
}
