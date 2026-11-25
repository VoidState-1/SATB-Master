import {
  chordToneSpellings,
  type ChordIdentity,
  chordIdentityEquals,
  chordIdentityInversion,
  chordIdentityToneSpellings,
  type ChordQuality,
} from "../../../chordModel";
import {
  keyEquals,
  leadingTonePitchClass,
  pitchClassEquals,
  scaleDegreePitchClass,
  stepIndex,
  writtenInterval,
  type KeyLike,
  type SpelledPitchClass,
  pitchClassValue,
  spelledPitchEquals,
  toMidi,
  type WrittenInterval,
} from "../../../pitch";
import type { VoiceId } from "../../../project/types";
import { VOICE_ORDER } from "../../../project/voice";
import type { AnalysisSlice, AnalysisChord, AnalysisNote } from "../../analysis";
import { readWrittenDominantSeventh, movesToWrittenTone } from "../../facts/dominantMotion";
import { tonalReading } from "../../facts/localTonality";
import { sameFunctionalReading } from "../../facts/functionalContext";
import { returnsByWrittenStep, writtenNeighborsOverHeldBass } from "../../facts/prolongation";
import {
  allowsWrittenTertianIdentity,
  hasWrittenVoicing,
  matchesWrittenChord,
  resolvesInVoice,
} from "../../facts/tendencyResolution";
import {
  readCompleteWrittenChord,
  readSoundingTertianIdentity,
  soundsCompleteWrittenMembers,
  soundsCompleteWrittenTones,
  hasCompleteWrittenTertianVoicing,
  soundsCompleteWrittenChord,
} from "../../facts/writtenVoicing";
import type { RuleStepContext } from "../../runtime";
import type { HarmonyRuleContext } from "../context/createRuleContext";
import { crossesManualPhraseBoundary, isPerfectFifth, pitchClass } from "../helpers/core";
import { nextWrittenVoicingChange } from "../helpers/motionHarmony";
import type { ObligationEnvironment } from "./obligation";
import type { LeadingTonePayload } from "./tendency";
import { leadingToneResolutionKey, allowsWrittenLocalRole } from "./tendencyContext";

function writtenDominant(slice: AnalysisSlice) {
  const identity = readCompleteWrittenChord(slice);
  const structure = identity?.structure;
  if (identity && structure?.kind === "tertian" && !structure.extensions.length && !structure.alterations.length &&
      (structure.quality === "major" || structure.quality === "dominant7")) {
    return { root: identity.root, quality: structure.quality };
  }

  // Root position with a doubled root can supply a written V7 without its fifth.
  const bass = slice.notes.bass;
  const seventhChord = readWrittenDominantSeventh(slice.notes);
  if (!slice.completeSatb || !bass || !seventhChord || seventhChord.inversion !== 0 ||
      !allowsWrittenTertianIdentity(slice, seventhChord.root, "dominant7") ||
      !soundsCompleteWrittenTones([seventhChord.root, seventhChord.third, seventhChord.seventh],
        Object.values(slice.notes), bass)) return;
  return { root: seventhChord.root, quality: "dominant7" as const };
}

function allowsObservedTarget(rules: HarmonyRuleContext, frame: AnalysisSlice, landedKey?: KeyLike) {
  const chord = frame.chord;
  const semantics = chord?.semantics;
  if (!chord || !semantics) return true;
  const reading = rules.harmony.primaryInterpretation(chord);
  if (reading.status !== "resolved" || semantics.pedalContext || semantics.cadenceRole || semantics.mixture ||
      semantics.interpretations.length !== 1 || semantics.alternatives?.length || reading.value.designation?.specialRole) return false;
  const { localKey, appliedTarget, source, designation, degree, degreeAlteration } = reading.value;
  const explicit = chord.locked || rules.analysis.project.chordTrack.locked || source !== "inferred";
  if (landedKey) return !explicit || (!appliedTarget && (!localKey || keyEquals(localKey, landedKey)));
  return !localKey && !appliedTarget && (!explicit || (!designation &&
    pitchClassEquals(chord.identity.root, scaleDegreePitchClass(frame.key, degree, degreeAlteration))));
}

function readsIncompleteRootTonic(slice: AnalysisSlice, root: SpelledPitchClass, mode: KeyLike["mode"]) {
  const bass = slice.notes.bass;
  if (!slice.completeSatb || !bass || !pitchClassEquals(bass.pitch, root)) return false;
  if (!allowsWrittenTertianIdentity(slice, root, mode)) return false;
  return soundsCompleteWrittenTones(chordToneSpellings(root, mode).slice(0, 2), Object.values(slice.notes), bass);
}

/** §§15.2, 32.2. Look for an actual local dominant–tonic connection.
 * A diatonic major triad alone does not establish a tonicization. */
export function writtenLocalLeadingToneKey(rules: HarmonyRuleContext, slice: AnalysisSlice): KeyLike | undefined {
  if (!slice.attackVoiceIds.length || !allowsObservedTarget(rules, slice)) return;
  const dominant = writtenDominant(slice);
  if (!dominant) return;
  const tonic = scaleDegreePitchClass({ tonic: dominant.root, mode: "major" }, 4);
  if (pitchClassEquals(tonic, slice.key.tonic)) return;

  const tones = chordToneSpellings(dominant.root, dominant.quality);
  const hasChromaticMember = tones.some(tone => {
    const degree = (stepIndex(tone.step) - stepIndex(slice.key.tonic.step) + 7) % 7 + 1;
    return !pitchClassEquals(tone, scaleDegreePitchClass(slice.key, degree));
  });
  if (!hasChromaticMember) return;
  const motion = nextWrittenVoicingChange(rules, slice, frame => {
    const continuing = writtenDominant(frame);
    return !!continuing && continuing.quality === dominant.quality && pitchClassEquals(continuing.root, dominant.root) &&
      allowsObservedTarget(rules, frame);
  });
  if (!motion) return;
  const { departure, landing } = motion;
  const bass = landing.notes.bass;
  if (!bass || pitchClassEquals(bass.pitch, dominant.root)) return;

  const [, third, , seventh] = tones;
  const fromBass = departure.notes.bass!;
  const bassMove = writtenInterval(fromBass.pitch, bass.pitch);
  const authenticBass = dominant.quality === "dominant7" && pitchClassEquals(fromBass.pitch, dominant.root) &&
    pitchClassEquals(bass.pitch, tonic) &&
    ((bassMove.diatonicSteps === 3 && bassMove.semitones === 5) ||
     (bassMove.diatonicSteps === -4 && bassMove.semitones === -7));
  const thirdVoice = VOICE_ORDER.find(voice => pitchClassEquals(departure.notes[voice]!.pitch, third) &&
    resolvesInVoice(departure, landing, voice, tonic, 1));
  for (const mode of ["major", "minor"] as const) {
    const key = { tonic, mode };
    if (!allowsObservedTarget(rules, landing, key)) continue;
    const tonicThird = chordToneSpellings(tonic, mode)[1];
    const seventhVoice = seventh && VOICE_ORDER.find(voice => pitchClassEquals(departure.notes[voice]!.pitch, seventh) &&
      resolvesInVoice(departure, landing, voice, tonicThird, -1));
    if ((thirdVoice || seventhVoice || authenticBass) && matchesWrittenChord(landing, tonic, mode)) return key;
    if (thirdVoice && seventhVoice && readsIncompleteRootTonic(landing, tonic, mode)) return key;
  }
}

/** E.1 belongs to the third of V or the root of vii°, relative to the
 * actual tonic. VII can also be a stable fifth or a seventh governed by E.2. */
function hasHarmonicLeadingTone(identity: ChordIdentity, key: KeyLike) {
  const { root, structure } = identity;
  if (structure.kind !== "tertian") return false;
  const quality = structure.quality;
  if (pitchClassEquals(root, scaleDegreePitchClass(key, 5)))
    return quality === "major" || quality === "dominant7" || quality === "augmented";
  return pitchClassEquals(root, leadingTonePitchClass(key)) &&
    (quality === "diminished" || quality === "diminished7" || quality === "halfDiminished7");
}

function writtenLeadingHarmony(slice: AnalysisSlice, key: KeyLike) {
  const notes = Object.values(slice.notes).filter(note => !note.nonChordToneRole);
  const leading = leadingTonePitchClass(key);
  if (notes.length < 3 || !notes.some(note => pitchClassEquals(note.pitch, leading))) return false;
  const dominant = scaleDegreePitchClass(key, 5);
  const dominantSeventh = chordToneSpellings(dominant, "dominant7");
  const [root, third, , seventh] = dominantSeventh;
  // A chordal fifth can be omitted. Only the structural notes supply
  // evidence; a marked ornament may coexist with a complete harmony.
  return [
    dominantSeventh, [root, third, seventh], dominantSeventh.slice(0, 3), chordToneSpellings(dominant, "augmented"),
    chordToneSpellings(leading, "diminished"), chordToneSpellings(leading, "diminished7"),
    chordToneSpellings(leading, "halfDiminished7"),
  ].some(tones => soundsCompleteWrittenMembers(tones, notes));
}

function isUnlockedInferredChord(rules: HarmonyRuleContext, chord: NonNullable<AnalysisSlice["chord"]>) {
  if (chord.locked || rules.analysis.project.chordTrack.locked) return false;
  const reading = rules.harmony.primaryInterpretation(chord);
  return reading.status === "resolved" && reading.value.source === "inferred";
}

function writtenDiminishedSeventhTarget(
  rules: HarmonyRuleContext, slice: AnalysisSlice, root: SpelledPitchClass,
): KeyLike | undefined {
  const tones = chordToneSpellings(root, "diminished7");
  const motion = nextWrittenVoicingChange(rules, slice, frame =>
    (!frame.chord || isUnlockedInferredChord(rules, frame.chord)) && hasWrittenVoicing(frame, tones));
  if (!motion) return;

  const { landing } = motion;
  const identity = readCompleteWrittenChord(landing);
  const structure = identity?.structure;
  if (!identity || structure?.kind !== "tertian" ||
      (structure.quality !== "major" && structure.quality !== "minor") ||
      structure.extensions.length || structure.alterations.length) return;
  const target = { tonic: identity.root, mode: structure.quality };
  if (pitchClassEquals(root, leadingTonePitchClass(target)) && allowsObservedTarget(rules, landing, target)) return target;
}

export function leadingToneSourceKey(rules: HarmonyRuleContext, slice: AnalysisSlice): KeyLike | undefined {
  const reading = tonalReading(slice.chord?.semantics, slice.key);
  // A confirmed center controls E.1. An observed tonicization is only a
  // fallback where the source does not already identify its center/target.
  const observed = reading.local || reading.interpretation?.appliedTarget
    ? undefined : writtenLocalLeadingToneKey(rules, slice);
  if (observed) return observed;
  const key = leadingToneResolutionKey(slice, rules.harmony);
  const chord = slice.chord;
  if (chord) {
    const { identity } = chord;
    if (identity.structure.kind === "tertian" && identity.structure.quality === "diminished7" &&
        isUnlockedInferredChord(rules, chord)) {
      const written = readSoundingTertianIdentity(slice);
      if (written?.structure.kind === "tertian" && written.structure.quality === "diminished7" &&
          !pitchClassEquals(written.root, identity.root)) {
        // The spellings of a complete diminished seventh distinguish its root
        // from an enharmonically equivalent inferred rotation.
        if (hasHarmonicLeadingTone(written, key)) return key;
        const writtenTarget = writtenDiminishedSeventhTarget(rules, slice, written.root);
        if (writtenTarget) return writtenTarget;
        // A merely respelled annotation does not supersede the real written
        // leading tone, but do not fall back to the written signature once
        // the same destination is confirmed by the following tonal reading.
        const next = nextWrittenVoicingChange(rules, slice, frame => hasWrittenVoicing(frame,
          chordToneSpellings(written.root, "diminished7")));
        if (reading.local && next && keyEquals(tonalReading(next.landing.chord?.semantics, next.landing.key).key, reading.key))
          return hasHarmonicLeadingTone(identity, reading.key) ? reading.key : undefined;
        if (hasHarmonicLeadingTone(written, slice.key)) return slice.key;
        return undefined;
      }
    }
    return hasHarmonicLeadingTone(identity, key) ? key : undefined;
  }

  // In a melody-only exercise the key signature supplies the teaching target.
  // A rest in one or more parts of a harmonized exercise is a different case.
  if (rules.analysis.project.satbTracks.filter(track => track.notes.length > 0).length === 1) return key;
  if (writtenLeadingHarmony(slice, key)) return key;
}

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

const degrees = [1, 2, 3, 4, 5, 6, 7] as const;

function writtenSlot(context: HarmonyRuleContext, key: AnalysisSlice["key"], start: number, end: number) {
  const first = context.sliceAt(start);
  const chord = first?.chord;
  if (!first?.completeSatb || first.tick !== start || !first.notes.bass || !chord || chord.startTick !== start ||
      chord.startTick + chord.durationTicks !== end) return undefined;
  const meaning = context.harmony.primaryInterpretation(chord);
  if (meaning.status !== "resolved" || meaning.value.appliedTarget ||
      chord.semantics?.cadenceRole || chord.semantics?.pedalContext ||
      (meaning.value.localKey && !keyEquals(meaning.value.localKey, key))) return undefined;

  const { structure, bass } = chord.identity;
  if (structure.kind !== "tertian" || structure.extensions.length || structure.alterations.length) return undefined;
  const tones = chordIdentityToneSpellings(chord.identity);
  const scale = degrees.map(degree => scaleDegreePitchClass(key, degree));
  if (tones.length < 3 || tones.length > 4 ||
      !tones.every(tone => scale.some(pitch => pitchClassEquals(tone, pitch))) ||
      !tones.every(tone => Object.values(first.notes).some(note => pitchClassEquals(note.pitch, tone)))) return undefined;

  const frames = [...context.slices({ overlapping: { fromTick: start, toTick: end } })];
  if (frames.at(-1)?.endTick !== end || frames.some(frame => {
    const bassNote = frame.notes.bass;
    if (frame.chord?.id !== chord.id || frame.key.id !== key.id || !frame.completeSatb ||
        !bassNote || !pitchClassEquals(bassNote.pitch, bass)) return true;
    const lowest = toMidi(bassNote.pitch);
    return Object.values(frame.notes).some(note => note.nonChordToneRole || toMidi(note.pitch) < lowest ||
      !tones.some(tone => pitchClassEquals(tone, note.pitch)));
  })) return undefined;
  return {
    frames, root: chord.identity.root, firstBass: first.notes.bass.pitch,
    inversion: chordIdentityInversion(chord.identity), size: tones.length,
  };
}

function copiedFrames(left: readonly AnalysisSlice[], right: readonly AnalysisSlice[], steps: number) {
  return left.length === right.length && left.every((frame, index) => {
    const shifted = right[index];
    return frame.endTick - frame.tick === shifted.endTick - shifted.tick && VOICE_ORDER.every(voice => {
      const before = frame.notes[voice];
      const after = shifted.notes[voice];
      return before && after &&
        frame.attackVoiceIds.includes(voice) === shifted.attackVoiceIds.includes(voice) &&
        writtenInterval(before.pitch, after.pitch).diatonicSteps === steps;
    });
  });
}

function shiftsBy(left: NonNullable<ReturnType<typeof writtenSlot>>, right: NonNullable<ReturnType<typeof writtenSlot>>, steps: number) {
  return left.size === right.size && left.inversion === right.inversion && copiedFrames(left.frames, right.frames, steps);
}

/**
 * Chapter 26 §3: a motif transfers its internal harmonic relation; the
 * seam between motifs does not inherit that relation. Check the narrower
 * case where the middle motif lands on a triad rooted on the ambient VII.
 */
export function diatonicSequenceAtMiddleArrival(source: AnalysisSlice, context: HarmonyRuleContext, departureTick?: number) {
  const { key, chord: middleArrival } = source;
  const middleHead = context.sliceAt(source.tick - 1)?.chord;
  if (!middleArrival || !middleHead || source.tick !== middleArrival.startTick ||
      !pitchClassEquals(middleArrival.identity.root, leadingTonePitchClass(key))) return undefined;

  const arrivalOffset = source.tick - middleHead.startTick;
  const nextStart = source.tick + middleArrival.durationTicks;
  const nextArrival = nextStart + arrivalOffset;
  if (arrivalOffset <= 0 || (departureTick !== undefined && departureTick !== nextStart && departureTick !== nextArrival))
    return undefined;

  const period = nextStart - middleHead.startTick;
  const firstStart = middleHead.startTick - period;
  const end = nextStart + period;
  if (firstStart < 0 || crossesManualPhraseBoundary(context, firstStart, end - 1)) return undefined;

  const firstHead = writtenSlot(context, key, firstStart, firstStart + arrivalOffset);
  const firstArrival = writtenSlot(context, key, firstStart + arrivalOffset, middleHead.startTick);
  const midHead = writtenSlot(context, key, middleHead.startTick, source.tick);
  const midArrival = writtenSlot(context, key, source.tick, nextStart);
  const lastHead = writtenSlot(context, key, nextStart, nextArrival);
  const lastArrival = writtenSlot(context, key, nextArrival, end);
  if (!firstHead || !firstArrival || !midHead || !midArrival || !lastHead || !lastArrival ||
      midArrival.size !== 3 || pitchClassEquals(lastHead.root, key.tonic) ||
      pitchClassEquals(lastArrival.root, key.tonic)) return undefined;

  // A seventh/triad (or triad/triad) model with an ascending written
  // fourth between roots. A diatonic copy may make that fourth augmented.
  const rootMotion = writtenInterval({ ...firstHead.root, octave: 4 }, { ...firstArrival.root, octave: 4 });
  if ((rootMotion.diatonicSteps + 7) % 7 !== 3) return undefined;
  const steps = writtenInterval(firstHead.firstBass, midHead.firstBass).diatonicSteps;
  if (Math.abs(steps) !== 1 || !shiftsBy(firstHead, midHead, steps) || !shiftsBy(midHead, lastHead, steps) ||
      !shiftsBy(firstArrival, midArrival, steps) || !shiftsBy(midArrival, lastArrival, steps)) return undefined;

  return { nextStart, lastHead, lastArrival };
}

export function leavesDiatonicSequenceLeadingTone(environment: ObligationEnvironment<LeadingTonePayload>) {
  const { context, obligation } = environment;
  const { slice, rules } = context;
  const { payload, openedAt } = obligation;
  const { voiceId, targetStep, targetAlter, targetMode } = payload;
  const key = slice.key;
  if (!keyEquals(key, { tonic: { step: targetStep, alter: targetAlter }, mode: targetMode })) return false;

  const source = rules.sliceAt(openedAt.tick);
  const leading = source?.notes[voiceId];
  if (source?.tick !== openedAt.tick || !leading ||
      !pitchClassEquals(leading.pitch, leadingTonePitchClass(key))) return false;

  const sequence = diatonicSequenceAtMiddleArrival(source, rules, slice.tick);
  if (!sequence) return false;
  const { nextStart, lastHead, lastArrival } = sequence;

  if (slice.tick === nextStart) return true;

  // The same written pitch may be rearticulated at the seam, then move
  // as a different chord member inside the new motif.
  const nextHeadNote = lastHead.frames[0].notes[voiceId];
  const lastHeadNote = lastHead.frames.at(-1)?.notes[voiceId];
  return Boolean(nextHeadNote && lastHeadNote && spelledPitchEquals(nextHeadNote.pitch, leading.pitch) &&
    spelledPitchEquals(lastHeadNote.pitch, leading.pitch) &&
    !pitchClassEquals(lastHead.root, scaleDegreePitchClass(key, 5)) &&
    !pitchClassEquals(leading.pitch, leadingTonePitchClass({ tonic: lastArrival.root, mode: "major" })));
}

function writtenTriad(
  rules: HarmonyRuleContext,
  slice: AnalysisSlice,
  degree: 5 | 6,
  quality: ChordQuality,
) {
  const { chord, key } = slice;
  if (!chord || !slice.completeSatb) return undefined;
  const { identity, semantics } = chord;
  const structure = identity.structure;
  if (structure.kind !== "tertian" || structure.quality !== quality ||
      structure.extensions.length || structure.alterations.length ||
      !pitchClassEquals(identity.root, scaleDegreePitchClass(key, degree)) ||
      semantics?.interpretations.length !== 1 || semantics.mixture || semantics.pedalContext) return undefined;

  const reading = rules.harmony.primaryInterpretation(chord);
  if (reading.status !== "resolved") return undefined;
  const { localKey, appliedTarget, designation, degreeAlteration } = reading.value;
  if (reading.value.degree !== degree || degreeAlteration !== 0 || appliedTarget ||
      (localKey && !keyEquals(localKey, key)) ||
      (designation && (degree === 5
        ? designation.kind !== "primary" || designation.primaryFunction !== "dominant"
        : designation.kind !== "side-degree" || designation.primaryFunction !== "tonic"))) return undefined;

  const members = rules.harmony.chordMembersAt(slice);
  const counts = [0, 0, 0];
  let upperMidi = Infinity;
  for (const { note, voiceId, chordToneIndex } of members) {
    const midi = toMidi(note.pitch);
    if (chordToneIndex === undefined || note.nonChordToneRole || midi > upperMidi ||
        (voiceId === "bass" && !pitchClassEquals(note.pitch, identity.bass))) return undefined;
    counts[chordToneIndex]++;
    upperMidi = midi;
  }
  return counts.every(count => count > 0) ? { counts, members, bass: identity.bass } : undefined;
}

function isOctaveClass(interval: WrittenInterval) {
  return Math.abs(interval.diatonicSteps) % 7 === 0 && pitchClass(interval.semitones) === 0;
}

/** Spasobin §20.5, exs. 20-273a(3) and 20-274: an actual major V–vi pair. */
export function hasMajorDeceptiveLeadingToneMotion(context: RuleStepContext, voice: VoiceId) {
  const { rules, previous, slice, transitionFromPrevious: transition } = context;
  const leading = previous?.notes[voice];
  const landing = slice.notes[voice];
  if (!previous || !transition?.contiguous || !transition.sameKey ||
      slice.key.mode !== "major" || voice === "soprano" || !leading || !landing) return false;
  const leadingTone = scaleDegreePitchClass(slice.key, 7);
  const sixth = scaleDegreePitchClass(slice.key, 6);
  if (!pitchClassEquals(leading.pitch, leadingTone) || !movesToWrittenTone(leading.pitch, landing.pitch, sixth, -1, -2)) return false;

  const from = writtenTriad(rules, previous, 5, "major");
  const to = writtenTriad(rules, slice, 6, "minor");
  if (!from || !to || from.counts[1] !== 1 || !pitchClassEquals(to.bass, sixth)) return false;
  const sourceAttack = Math.max(...from.members.map(({ note }) => note.startTick));
  const sourceBeat = rules.metric.positionAt(sourceAttack);
  const arrivalBeat = rules.metric.positionAt(slice.tick);
  if (!sourceBeat || sourceBeat.role === "subdivision" || !arrivalBeat || arrivalBeat.role === "subdivision" ||
      to.members.some(({ note }) => note.startTick !== slice.tick)) return false;

  if (voice === "bass") {
    // D6 → vi, with the sixth-degree triad's third doubled.
    if (!pitchClassEquals(from.bass, leadingTone) || to.counts[1] !== 2) return false;
  } else {
    // Root-position D → vi. The inner leading tone and the ascending bass double the new root.
    const bass = previous.notes.bass;
    const nextBass = slice.notes.bass;
    if (!bass || !nextBass || !pitchClassEquals(from.bass, scaleDegreePitchClass(slice.key, 5)) ||
        from.counts[0] !== 2 || to.counts[0] !== 2 ||
        !movesToWrittenTone(bass.pitch, nextBass.pitch, sixth, 1, 2)) return false;
  }

  return !rules.voiceLeading.voicePairs(transition).some(pair =>
    pair.upperMotion !== "stationary" && pair.lowerMotion !== "stationary" &&
    ((isPerfectFifth(pair.previousInterval) && isPerfectFifth(pair.currentInterval)) ||
      (isOctaveClass(pair.previousInterval) && isOctaveClass(pair.currentInterval))));
}

/** Spasobin §§36.3, 44.4–7 and Huang II, p. 299: a dominant member in
 * another part can prepare the accented upper neighbor of the tonic. */
export function leadingToneReachesTonicThroughNinth(environment: ObligationEnvironment<LeadingTonePayload>) {
  const { context: { previous, slice, rules, transitionFromPrevious }, obligation: { payload, openedAt } } = environment;
  if (payload.voiceId !== "soprano" || !previous?.completeSatb || !slice.completeSatb ||
      !transitionFromPrevious?.contiguous || !transitionFromPrevious.sameKey) return;
  const lead = previous.notes.soprano!, ninth = slice.notes.soprano!, bass = slice.notes.bass!;
  const { targetStep, targetAlter, targetMode } = payload;
  const tonic = { step: targetStep, alter: targetAlter };
  const target = { tonic, mode: targetMode };
  const dominant = scaleDegreePitchClass(target, 5);
  const leading = { step: payload.leadingStep, alter: payload.leadingAlter };
  const ascent = writtenInterval(lead.pitch, ninth.pitch);
  if (!pitchClassEquals(lead.pitch, leading) || toMidi(lead.pitch) !== payload.leadingMidi ||
      lead.startTick + lead.durationTicks !== slice.tick || ninth.startTick !== slice.tick ||
      (ninth.nonChordToneRole && ninth.nonChordToneRole !== "appoggiatura" && ninth.nonChordToneRole !== "suspension") ||
      ascent.diatonicSteps !== 2 || ascent.semitones !== 3 ||
      !matchesWrittenChord(previous, dominant, "dominant7") || !allowsWrittenLocalRole(rules, previous, target, 5)) return;
  const [root, , preparedNinth, seventh] = chordToneSpellings(dominant, "dominant7");
  if (!pitchClassEquals(ninth.pitch, preparedNinth) || !pitchClassEquals(bass.pitch, tonic) ||
      bass.startTick !== slice.tick || writtenInterval(bass.pitch, ninth.pitch).diatonicSteps < 8) return;

  const resolutionTick = ninth.startTick + ninth.durationTicks;
  const settled = rules.sliceAt(resolutionTick);
  if (!settled || settled.tick !== resolutionTick || !keyEquals(settled.key, slice.key) ||
      crossesManualPhraseBoundary(rules, openedAt.tick, settled.tick) ||
      !matchesWrittenChord(settled, tonic, targetMode) || !allowsWrittenLocalRole(rules, settled, target, 1) ||
      !spelledPitchEquals(bass.pitch, settled.notes.bass!.pitch) ||
      !resolvesInVoice(slice, settled, "soprano", tonic, -1)) return;
  const accent = rules.metric.positionAt(slice.tick), release = rules.metric.positionAt(settled.tick);
  if (accent?.confidence !== "certain" || release?.confidence !== "certain" ||
      accent.level < 2 || release.level >= accent.level) return;

  // V7 is complete, so its fifth (the coming ninth) already sounds in another
  // part. On I, its bass and fifth anchor the harmony while the soprano resolves.
  const fifthVoice = pitchClassEquals(slice.notes.alto!.pitch, root) ? "alto" : "tenor";
  const fifth = slice.notes[fifthVoice]!;
  if (!pitchClassEquals(fifth.pitch, root) || !spelledPitchEquals(fifth.pitch, settled.notes[fifthVoice]!.pitch)) return;
  const thirdVoice = fifthVoice === "alto" ? "tenor" : "alto";
  const before = previous.notes[thirdVoice]!, overTonic = slice.notes[thirdVoice]!;
  const [, tonicThird] = chordToneSpellings(tonic, targetMode);
  if (!pitchClassEquals(before.pitch, seventh)) return;

  // The seventh can resolve at the bass arrival or participate in a separate 4–3.
  const directThird = spelledPitchEquals(overTonic.pitch, settled.notes[thirdVoice]!.pitch) &&
    resolvesInVoice(previous, slice, thirdVoice, tonicThird, -1);
  const departure = rules.sliceAt(settled.tick - 1)!;
  const delayedThird = spelledPitchEquals(before.pitch, overTonic.pitch) &&
    resolvesInVoice(departure, settled, thirdVoice, tonicThird, -1);
  if (!directThird && !delayedThird) return;

  const underNinth = rules.slices({ overlapping: { fromTick: slice.tick, toTick: settled.tick } });
  if (!underNinth.all(frame => {
    if (!frame.completeSatb || !keyEquals(frame.key, slice.key) || frame.notes.soprano!.id !== ninth.id ||
        !allowsWrittenTertianIdentity(frame, tonic, targetMode) || !allowsWrittenLocalRole(rules, frame, target, 1)) return false;
    const thirdRole = frame.notes[thirdVoice]!.nonChordToneRole;
    return !frame.notes.bass!.nonChordToneRole && !frame.notes[fifthVoice]!.nonChordToneRole &&
      (!thirdRole || (delayedThird && thirdRole === "suspension")) &&
      VOICE_ORDER.every(voice => spelledPitchEquals(frame.notes[voice]!.pitch, slice.notes[voice]!.pitch));
  })) return;
  return settled.notes.soprano;
}
