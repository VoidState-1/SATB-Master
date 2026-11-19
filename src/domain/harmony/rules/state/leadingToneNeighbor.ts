import {
  chordIdentityEquals,
  chordIdentityInversion,
  chordIdentityToneSpellings,
} from "../../../chordModel";
import { pitchClassEquals, spelledPitchEquals, toMidi } from "../../../pitch";
import type { VoiceId } from "../../../project";
import type { AnalysisChord, AnalysisNote, AnalysisSlice } from "../../analysis";
import { returnsByWrittenStep, soundsCompleteWrittenChord, writtenNeighborsOverHeldBass } from "../../writtenNeighbors";
import type { HarmonyRuleContext } from "../context/createRuleContext";
import { crossesManualPhraseBoundary } from "../groups/dominantSixthSubstitution";

function endTick(note: AnalysisNote) {
  return note.startTick + note.durationTicks;
}

export function leadingNeighborFrame(rules: HarmonyRuleContext, voice: VoiceId, note: AnalysisNote) {
  if (voice === "bass") return;
  const before = rules.sliceAt(note.startTick - 1);
  const middle = rules.sliceAt(note.startTick);
  const after = rules.sliceAt(endTick(note));
  if (!before?.completeSatb || !middle?.completeSatb || !after?.completeSatb ||
      before.endTick !== note.startTick || middle.tick !== note.startTick ||
      middle.endTick !== endTick(note) || after.tick !== endTick(note) ||
      before.key.id !== middle.key.id || after.key.id !== middle.key.id ||
      rules.phraseAt(before.tick)?.id !== rules.phraseAt(after.tick)?.id) return;
  const preparation = before.notes[voice]!;
  const arrival = after.notes[voice]!;
  if (rules.keyAt(preparation.startTick)?.id !== middle.key.id ||
      crossesManualPhraseBoundary(rules, preparation.startTick, after.tick) ||
      !returnsByWrittenStep(preparation, note, arrival)) return;
  const metric = rules.metric.positionAt(middle.tick);
  if (metric?.confidence !== "certain") return;
  return { voice, before, middle, after, preparation, arrival, level: metric.level };
}

type Frame = NonNullable<ReturnType<typeof leadingNeighborFrame>>;

function hasPlainTertianIdentity(chord: AnalysisChord) {
  const structure = chord.identity.structure;
  return structure.kind === "tertian" && structure.extensions.length === 0 &&
    structure.alterations.length === 0 &&
    (structure.quality === "major" || structure.quality === "minor" || structure.quality === "dominant7");
}

function sameDeclaredHarmony(rules: HarmonyRuleContext, left: AnalysisSlice, right: AnalysisSlice) {
  const a = left.chord, b = right.chord;
  if (!a || !b || !chordIdentityEquals(a.identity, b.identity) ||
      a.semantics?.pedalContext || b.semantics?.pedalContext) return false;
  const before = rules.harmony.primaryInterpretation(a);
  const after = rules.harmony.primaryInterpretation(b);
  if (before.status !== "resolved" || after.status !== "resolved") return false;
  const context = (slice: AnalysisSlice, value: typeof before.value) => {
    const key = value.localKey ?? slice.key;
    return JSON.stringify([
      key.tonic, key.mode, value.degree, value.degreeAlteration, value.appliedTarget,
      value.designation, slice.chord?.semantics?.cadenceRole, slice.chord?.semantics?.mixture,
    ]);
  };
  return context(left, before.value) === context(right, after.value);
}

/** §§40.1, 40.4–5: a written neighbor can decorate a held harmony in one or two upper voices. */
export function ornamentsSameLeadingHarmony(
  rules: HarmonyRuleContext, { before, middle, after, level }: Frame,
) {
  const chord = before.chord;
  if (level >= 2 || !chord || !hasPlainTertianIdentity(chord) ||
      !sameDeclaredHarmony(rules, before, after) ||
      (middle.chord && !sameDeclaredHarmony(rules, before, middle))) return false;
  const neighbors = writtenNeighborsOverHeldBass(chord.identity, before, middle, after);
  return neighbors !== undefined && neighbors.length <= 2;
}

/** At a new accent, require an independently sounding triad throughout the surface note and its return. */
export function accentedOrnamentOverWrittenTriad(
  rules: HarmonyRuleContext, { voice, middle, after, level, arrival }: Frame,
) {
  const chord = after.chord;
  if (voice !== "soprano" || level < 2 || middle.chord || !chord ||
      !hasPlainTertianIdentity(chord) || chord.identity.structure.kind !== "tertian" ||
      chord.identity.structure.quality !== "major" ||
      chordIdentityInversion(chord.identity) !== 1 || chord.semantics?.pedalContext ||
      rules.harmony.primaryInterpretation(chord).status !== "resolved") return false;
  const tones = chordIdentityToneSpellings(chord.identity);
  // The accented verticality may also spell a seventh chord. Require the
  // restored fifth to be rearticulated over that same independently complete triad.
  const repeated = rules.sliceAt(endTick(arrival));
  const repeatedSoprano = repeated?.notes.soprano;
  if (!repeated || !repeatedSoprano || repeatedSoprano.startTick !== endTick(arrival) ||
      repeated.key.id !== after.key.id ||
      !spelledPitchEquals(arrival.pitch, repeatedSoprano.pitch) || repeatedSoprano.nonChordToneRole ||
      !sameDeclaredHarmony(rules, after, repeated) ||
      crossesManualPhraseBoundary(rules, after.tick, repeated.tick) ||
      rules.phraseAt(after.tick)?.id !== rules.phraseAt(repeated.tick)?.id) return false;
  const ornament = middle.notes.soprano!;
  const accompaniment = [middle.notes.alto!, middle.notes.tenor!, middle.notes.bass!];
  return pitchClassEquals(arrival.pitch, tones[2]) &&
    !tones.some(tone => pitchClassEquals(tone, ornament.pitch)) &&
    soundsCompleteWrittenChord(chord.identity, accompaniment, middle.notes.bass!) &&
    toMidi(ornament.pitch) > Math.max(...accompaniment.map(note => toMidi(note.pitch))) &&
    accompaniment.every(note => note.startTick === middle.tick) &&
    (["alto", "tenor", "bass"] as const).every(part => middle.notes[part]!.id === after.notes[part]!.id &&
      after.notes[part]!.id === repeated.notes[part]?.id);
}
