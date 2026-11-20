import {
  chordIdentityEquals,
  chordIdentityInversion,
  chordIdentityToneSpellings,
} from "../../../chordModel";
import { keyEquals, leadingTonePitchClass, pitchClassEquals, pitchClassValue, spelledPitchEquals, toMidi, writtenInterval } from "../../../pitch";
import { VOICE_ORDER } from "../../../project/voice";
import { hasCompleteWrittenTertianVoicing } from "../../writtenTertian";
import type { VoiceId } from "../../../project";
import type { AnalysisChord, AnalysisNote, AnalysisSlice } from "../../analysis";
import { sameFunctionalReading } from "../../functionalReading";
import { returnsByWrittenStep, writtenNeighborsOverHeldBass } from "../../writtenNeighbors";
import { soundsCompleteWrittenChord } from "../../writtenVoicing";
import type { HarmonyRuleContext } from "../context/createRuleContext";
import { crossesManualPhraseBoundary } from "../helpers/phraseBoundary";
import { leadingToneResolutionKey } from "./leadingToneTarget";

function endTick(note: AnalysisNote) {
  return note.startTick + note.durationTicks;
}

export function leadingNeighborFrame(rules: HarmonyRuleContext, voice: VoiceId, note: AnalysisNote) {
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
  return a.semantics?.cadenceRole === b.semantics?.cadenceRole &&
    a.semantics?.mixture === b.semantics?.mixture &&
    sameFunctionalReading(before.value, after.value, before.value.localKey ?? left.key, after.value.localKey ?? right.key);
}

function writtenDominantThirdTarget(rules: HarmonyRuleContext, slice: AnalysisSlice, note: AnalysisNote) {
  const chord = slice.chord;
  if (!chord || !hasPlainTertianIdentity(chord) || chord.identity.structure.kind !== "tertian" ||
      chord.identity.structure.quality === "minor" || chord.semantics?.mixture || chord.semantics?.cadenceRole ||
      chord.semantics?.pedalContext || chord.semantics?.alternatives?.length) return;
  const reading = rules.harmony.primaryInterpretation(chord);
  if (reading.status === "ambiguous") return;
  const target = leadingToneResolutionKey(slice, rules.harmony);
  if (pitchClassEquals(note.pitch, leadingTonePitchClass(target)) &&
    pitchClassEquals(note.pitch, chordIdentityToneSpellings(chord.identity)[1]) &&
    soundsCompleteWrittenChord(chord.identity, Object.values(slice.notes), slice.notes.bass!)) return target;
}

function surfaceAllowsNeighbor(rules: HarmonyRuleContext, { before, middle, after, voice }: Frame) {
  if (hasCompleteWrittenTertianVoicing(Object.values(middle.notes).map(note => note.pitch))) return false;
  const chord = middle.chord;
  if (!chord || sameDeclaredHarmony(rules, before, middle) || sameDeclaredHarmony(rules, after, middle)) return true;

  // A sounding-only fit at the neighbor (e.g. D# over C-G) is weak evidence for
  // a new chord. All its other members must agree in writing. Respect a manual
  // or locked reading even when an enharmonic respelling would fit better.
  const reading = rules.harmony.primaryInterpretation(chord);
  if (chord.locked || reading.status !== "resolved" || reading.value.source !== "inferred" ||
      chord.semantics?.interpretations.length !== 1 || chord.semantics.alternatives?.length ||
      chord.semantics.pedalContext || chord.semantics.cadenceRole || chord.semantics.mixture ||
      !hasPlainTertianIdentity(chord) || !pitchClassEquals(chord.identity.root, before.chord!.identity.root) ||
      !pitchClassEquals(chord.identity.bass, middle.notes.bass!.pitch)) return false;
  const tones = chordIdentityToneSpellings(chord.identity);
  const neighbor = middle.notes[voice]!;
  return !tones.some(tone => pitchClassEquals(tone, neighbor.pitch)) &&
    tones.some(tone => pitchClassValue(tone) === pitchClassValue(neighbor.pitch)) &&
    VOICE_ORDER.every(part => part === voice || tones.some(tone => pitchClassEquals(tone, middle.notes[part]!.pitch))) &&
    tones.every(tone => Object.values(middle.notes).some(note => pitchClassValue(tone) === pitchClassValue(note.pitch)));
}

/** A dominant third keeps its owner through a neighbor while the other voices
 * introduce the seventh or revoice the same dominant (§40.1, §15.3). */
function ornamentsRevoicedDominantThird(rules: HarmonyRuleContext, frame: Frame) {
  const { before, middle, after, preparation, voice } = frame;
  const start = writtenDominantThirdTarget(rules, before, preparation);
  const end = writtenDominantThirdTarget(rules, after, preparation);
  if (!start || !end || !keyEquals(start, end) ||
      !surfaceAllowsNeighbor(rules, frame)) return false;

  const tones = chordIdentityToneSpellings(after.chord!.identity);
  let stationary = 0;
  let revoiced = false;
  for (const other of VOICE_ORDER) {
    if (other === voice) continue;
    const first = before.notes[other]!, mid = middle.notes[other]!, last = after.notes[other]!;
    if (!spelledPitchEquals(first.pitch, last.pitch)) revoiced = true;
    if (spelledPitchEquals(first.pitch, mid.pitch) && !mid.nonChordToneRole) {
      stationary++;
      continue;
    }
    // A doubled root can move directly to the seventh or fill in the whole tone chromatically.
    const descent = writtenInterval(first.pitch, last.pitch);
    if (!tones[3] || !pitchClassEquals(first.pitch, tones[0]) || !pitchClassEquals(last.pitch, tones[3]) ||
        descent.diatonicSteps !== -1 || descent.semitones !== -2) return false;
    if (spelledPitchEquals(mid.pitch, last.pitch) && !mid.nonChordToneRole) continue;
    const step = writtenInterval(first.pitch, mid.pitch);
    if (step.semitones !== -1 || (step.diatonicSteps !== 0 && step.diatonicSteps !== -1) ||
        (mid.nonChordToneRole && mid.nonChordToneRole !== "passing")) return false;
  }
  return stationary >= 2 && revoiced;
}

/** A weak neighbor may accompany revoicing, or decorate an otherwise held harmony (§40.1, 4–5). */
export function ornamentsSameLeadingHarmony(
  rules: HarmonyRuleContext, frame: Frame,
) {
  const { before, middle, after, level } = frame;
  if (level >= 2) return false;
  if (ornamentsRevoicedDominantThird(rules, frame)) return true;
  const chord = before.chord;
  if (!chord || !hasPlainTertianIdentity(chord) ||
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
