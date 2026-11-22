import {
  chordToneSpellings,
  primaryHarmonyInterpretation,
  type ChordIdentity,
  type HarmonySemantics,
  chordIdentityToneSpellingForDegree,
  identityContainsWrittenPitchClass,
} from "../../chordModel";
import {
  pitchClassEquals,
  scaleDegreePitchClass,
  spelledPitchEquals,
  toMidi,
  writtenInterval,
  type KeyLike,
  type SpelledPitch,
  type SpelledPitchClass,
} from "../../pitch";
import type { VoiceId } from "../../project/types";
import type { AnalysisNote, AnalysisSlice } from "../analysis";
import { VOICE_ORDER } from "../../project/voice";
import { hasWrittenVoicing, resolvesInVoice } from "./tendencyResolution";
import { soundsCompleteWrittenMembers, soundsCompleteWrittenTones } from "./writtenVoicing";
import { compareMetricStrength, type MetricPosition } from "../../rhythm/metric";

export const dominantSixthInnerVoices = ["alto", "tenor"] as const;
export const dominantSixthLowerVoices = ["alto", "tenor", "bass"] as const;

type Voicing = Readonly<Partial<Record<VoiceId, AnalysisNote>>>;

export function continuesWrittenDominantSeventh(previous: Voicing, source: Voicing, root: SpelledPitchClass) {
  const { soprano, alto, tenor, bass } = previous;
  if (!soprano || !alto || !tenor || !bass || bass.id !== source.bass?.id ||
      [soprano, alto, tenor, bass].some(note => note.nonChordToneRole) ||
      !pitchClassEquals(bass.pitch, root)) return false;
  const [, third, fifth, seventh] = chordToneSpellings(root, "dominant7");
  return (pitchClassEquals(soprano.pitch, root) || pitchClassEquals(soprano.pitch, fifth)) &&
    ((pitchClassEquals(alto.pitch, third) && pitchClassEquals(tenor.pitch, seventh)) ||
     (pitchClassEquals(alto.pitch, seventh) && pitchClassEquals(tenor.pitch, third))) &&
    Boolean(source.alto && source.tenor &&
      spelledPitchEquals(alto.pitch, source.alto.pitch) && spelledPitchEquals(tenor.pitch, source.tenor.pitch));
}

export function movesToWrittenTone(
  from: SpelledPitch,
  to: SpelledPitch,
  target: SpelledPitchClass,
  diatonicSteps: number,
  semitones?: number,
) {
  if (!pitchClassEquals(to, target)) return false;
  const motion = writtenInterval(from, to);
  return motion.diatonicSteps === diatonicSteps && (semitones === undefined || motion.semitones === semitones);
}

export function resolvesDominantInnerVoice(
  from: SpelledPitch | undefined,
  to: SpelledPitch | undefined,
  leadingTone: SpelledPitchClass,
  seventh: SpelledPitchClass,
  tonic: SpelledPitchClass,
  third: SpelledPitchClass,
  tonicFifth?: SpelledPitchClass,
) {
  if (!from || !to) return false;
  if (pitchClassEquals(from, leadingTone)) {
    return movesToWrittenTone(from, to, tonic, 1, 1) ||
      leadingToneDescendsToTonicFifth(from, to, leadingTone, tonicFifth);
  }
  return pitchClassEquals(from, seventh) && movesToWrittenTone(from, to, third, -1);
}

export function leadingToneDescendsToTonicFifth(
  from: SpelledPitch | undefined,
  to: SpelledPitch | undefined,
  leadingTone: SpelledPitchClass,
  tonicFifth: SpelledPitchClass | undefined,
) {
  return Boolean(from && to && tonicFifth && pitchClassEquals(from, leadingTone) &&
    movesToWrittenTone(from, to, tonicFifth, -2, -4));
}

type ContextualDominant = { identity: ChordIdentity; semantics?: HarmonySemantics };

export function contextualMinorDominantTonic(chord: ContextualDominant, key: KeyLike) {
  const { identity, semantics } = chord;
  const { root, bass, structure } = identity;
  if (structure.kind !== "tertian" || structure.quality !== "dominant7" || structure.extensions.length ||
      structure.alterations.length || !pitchClassEquals(root, bass) || !semantics ||
      semantics.interpretations.length !== 1 || semantics.alternatives?.length || semantics.cadenceRole ||
      semantics.mixture || semantics.pedalContext) return;
  const meaning = primaryHarmonyInterpretation(semantics);
  if (meaning.degree !== 5 || meaning.degreeAlteration !== 0 ||
      meaning.confidence === "ambiguous" || meaning.confidence === "unknown") return;
  const target = meaning.appliedTarget;
  const local = meaning.localKey;
  // Retain the anchor's interpretation. A brief applied V7/vi does not establish a local cadence.
  const applied = key.mode === "major" && target?.degree === 6 && !local &&
    meaning.designation?.kind === "applied-dominant";
  const tonic = applied ? scaleDegreePitchClass(key, 6)
    : !target && local?.mode === "minor" && meaning.designation?.kind === "primary" &&
      meaning.designation.primaryFunction === "dominant" ? local.tonic : undefined;
  if (!tonic || !pitchClassEquals(root, scaleDegreePitchClass({ tonic, mode: "minor" }, 5))) return;
  return { tonic, applied };
}

type WrittenFrame = { tick: number; notes: Voicing };

function orderedActualVoicing({ notes }: WrittenFrame) {
  const { bass, soprano } = notes;
  return bass && soprano && VOICE_ORDER.every(voice => {
    const note = notes[voice];
    return note && !note.nonChordToneRole &&
      toMidi(note.pitch) >= toMidi(bass.pitch) && toMidi(note.pitch) <= toMidi(soprano.pitch);
  });
}

/** A new minor-key dominant bass, soprano 6–5, and the same written inner
 * leading tone and seventh through the complete V7 (Spasobin §24.7). */
export function contextualMinorSixthResolvesToFifth(
  onset: WrittenFrame,
  fifth: WrittenFrame,
  landing: WrittenFrame,
  tonic: SpelledPitchClass,
  applied: boolean,
) {
  if (![onset, fifth, landing].every(orderedActualVoicing)) return false;
  const { soprano, bass } = onset.notes;
  const resolved = fifth.notes.soprano!, finalSoprano = landing.notes.soprano!;
  const finalBass = landing.notes.bass!;
  const key = { tonic, mode: "minor" } as const;
  const [root, leading, chordFifth, seventh] = chordToneSpellings(scaleDegreePitchClass(key, 5), "dominant7");
  const third = scaleDegreePitchClass(key, 3);
  if (!bass || !soprano || bass.startTick !== onset.tick || soprano.startTick !== onset.tick ||
      soprano.startTick + soprano.durationTicks !== fifth.tick || resolved.startTick !== fifth.tick ||
      resolved.startTick + resolved.durationTicks !== landing.tick ||
      !pitchClassEquals(bass.pitch, root) || !pitchClassEquals(soprano.pitch, third) ||
      !movesToWrittenTone(soprano.pitch, resolved.pitch, chordFifth, -1, -1) ||
      !dominantSixthLowerVoices.every(voice => onset.notes[voice]!.id === fifth.notes[voice]!.id) ||
      !VOICE_ORDER.every(voice => landing.notes[voice]!.startTick === landing.tick) ||
      !movesToWrittenTone(resolved.pitch, finalSoprano.pitch, tonic, -1, -2)) return false;

  const tones = chordToneSpellings(applied ? scaleDegreePitchClass(key, 6) : tonic, applied ? "major" : "minor");
  const pitches = VOICE_ORDER.map(voice => landing.notes[voice]!.pitch);
  if (!pitchClassEquals(finalBass.pitch, tones[0]) ||
      !pitches.every(note => tones.some(tone => pitchClassEquals(note, tone)))) return false;
  const bassMotion = writtenInterval(bass.pitch, finalBass.pitch);
  if (applied
    ? bassMotion.diatonicSteps !== 1 || bassMotion.semitones !== 1 ||
      pitches.filter(note => pitchClassEquals(note, tones[1])).length !== 2 ||
      !tones.every(tone => pitches.some(note => pitchClassEquals(note, tone)))
    : !((bassMotion.diatonicSteps === -4 && bassMotion.semitones === -7) ||
        (bassMotion.diatonicSteps === 3 && bassMotion.semitones === 5)) ||
      !pitches.some(note => pitchClassEquals(note, tones[2])) &&
        pitches.filter(note => pitchClassEquals(note, tonic)).length !== 3) return false;

  return dominantSixthInnerVoices.some(leadingVoice => {
    const seventhVoice = leadingVoice === "alto" ? "tenor" : "alto";
    const lead = onset.notes[leadingVoice]!.pitch, seventhNote = onset.notes[seventhVoice]!.pitch;
    return pitchClassEquals(lead, leading) && pitchClassEquals(seventhNote, seventh) &&
      movesToWrittenTone(lead, landing.notes[leadingVoice]!.pitch, tonic, 1, 1) &&
      movesToWrittenTone(seventhNote, landing.notes[seventhVoice]!.pitch, third, -1, -2);
  });
}

type DominantSeventhFrame = Pick<AnalysisSlice, "tick" | "notes" | "completeSatb">;
const endOf = (note: { startTick: number; durationTicks: number }) => note.startTick + note.durationTicks;

function hasSoundingBass(frame: DominantSeventhFrame) {
  const bass = frame.notes.bass;
  return !!bass && frame.completeSatb && VOICE_ORDER.every(voice => toMidi(frame.notes[voice]!.pitch) >= toMidi(bass.pitch));
}

function dominantSource(departure: DominantSeventhFrame, onset: DominantSeventhFrame) {
  if (!hasSoundingBass(departure) || !hasSoundingBass(onset) || departure.tick >= onset.tick) return;
  const notes = VOICE_ORDER.map(voice => departure.notes[voice]!);
  if (notes.some(note => note.nonChordToneRole || endOf(note) < onset.tick)) return;
  const chord = readWrittenDominantSeventh(departure.notes);
  if (!chord) return;
  const [, , fifth] = chordToneSpellings(chord.root, "dominant7");
  const voiceOf = (tone: typeof fifth) => VOICE_ORDER.find(voice => pitchClassEquals(departure.notes[voice]!.pitch, tone));
  return {
    ...chord,
    leadingVoice: voiceOf(chord.third)!,
    fifthVoice: voiceOf(fifth),
    seventhVoice: voiceOf(chord.seventh)!,
  };
}

function invertedDominantSource(departure: DominantSeventhFrame, onset: DominantSeventhFrame) {
  const source = dominantSource(departure, onset);
  if (!source || source.inversion === 0 || !source.fifthVoice) return;
  return { ...source, fifthVoice: source.fifthVoice };
}

function settleSingleVoice(onset: DominantSeventhFrame, voice: VoiceId, settled: DominantSeventhFrame | undefined) {
  if (!settled || settled.tick !== endOf(onset.notes[voice]!) || !hasSoundingBass(settled)) return;
  const landing = settled.notes[voice]!;
  if (landing.startTick !== settled.tick || VOICE_ORDER.some(voice => settled.notes[voice]!.nonChordToneRole)) return;
  if (VOICE_ORDER.some(other => other !== voice && onset.notes[other]!.id !== settled.notes[other]!.id)) return;
  return { settled, landing };
}

function reattackResolution(
  departure: DominantSeventhFrame,
  onset: DominantSeventhFrame,
  voice: VoiceId,
  frameAt: (tick: number) => DominantSeventhFrame | undefined,
) {
  const before = departure.notes[voice]!, repeated = onset.notes[voice]!;
  if (endOf(before) !== onset.tick || repeated.startTick !== onset.tick ||
      repeated.id === before.id || !spelledPitchEquals(before.pitch, repeated.pitch) ||
      (repeated.nonChordToneRole && repeated.nonChordToneRole !== "suspension")) return;
  const resolution = settleSingleVoice(onset, voice, frameAt(endOf(repeated)));
  return resolution && { repeated, ...resolution };
}

function retainsDominantRoot(departure: DominantSeventhFrame, onset: DominantSeventhFrame, voice: VoiceId) {
  const before = departure.notes[voice]!, current = onset.notes[voice]!;
  return spelledPitchEquals(before.pitch, current.pitch) &&
    (before.id === current.id || current.startTick === onset.tick && endOf(before) === onset.tick);
}

/** A V65 can resolve its leading tone and seventh while the written fifth
 * reattacks as a ninth. Confirm the tonic when that voice reaches the octave. */
export function readReattackedTonicNinth(
  departure: DominantSeventhFrame,
  onset: DominantSeventhFrame,
  frameAt: (tick: number) => DominantSeventhFrame | undefined,
) {
  const source = invertedDominantSource(departure, onset);
  if (source?.inversion !== 1) return;
  const { root, target: tonic, leadingVoice, fifthVoice, seventhVoice } = source;
  const delay = reattackResolution(departure, onset, fifthVoice, frameAt);
  if (!delay) return;
  const { repeated, settled, landing } = delay;
  const bass = onset.notes.bass!;
  const ninth = writtenInterval(bass.pitch, repeated.pitch).diatonicSteps;
  if (ninth < 8 || ninth % 7 !== 1 ||
      !movesToWrittenTone(repeated.pitch, landing.pitch, tonic, -1, -2) ||
      !resolvesInVoice(departure, onset, leadingVoice, tonic, 1) ||
      VOICE_ORDER.some(voice => voice !== fifthVoice && onset.notes[voice]!.nonChordToneRole)) return;

  const rootVoice = VOICE_ORDER.find(voice => pitchClassEquals(departure.notes[voice]!.pitch, root))!;
  if (!retainsDominantRoot(departure, onset, rootVoice)) return;
  const mode = (["major", "minor"] as const).find(quality => {
    const tones = chordToneSpellings(tonic, quality);
    return hasWrittenVoicing(settled, tones) && resolvesInVoice(departure, onset, seventhVoice, tones[1], -1);
  });
  if (!mode) return;

  return { root, key: { tonic, mode }, repeated, settledTick: settled.tick };
}

/** A written dominant seventh can omit its fifth in root position when
 * the root is doubled and the third and seventh both sound. */
export function readWrittenDominantSeventh(voicing: AnalysisSlice["notes"]) {
  const bass = voicing.bass;
  const notes = Object.values(voicing).filter(note => note !== undefined);
  if (!bass || notes.length !== 4) return;

  for (const { pitch: { step, alter } } of notes) {
    const root = { step, alter };
    const tones = chordToneSpellings(root, "dominant7");
    const [, third, , seventh] = tones;
    const inversion = ([0, 1, 2, 3] as const).find(index => pitchClassEquals(tones[index], bass.pitch));
    if (inversion === undefined) continue;
    const complete = soundsCompleteWrittenMembers(tones, notes);
    const omitsOnlyFifth = canOmitDominantFifth(root, bass.pitch, notes.map(note => note.pitch)) &&
      soundsCompleteWrittenMembers([root, third, seventh], notes);
    if (complete || omitsOnlyFifth) {
      return { root, inversion, third, seventh, target: scaleDegreePitchClass({ tonic: root, mode: "major" }, 4) };
    }
  }
}

/** In a four-part root-position V7 the doubled root can replace the fifth.
 * Callers still have to establish the third and the seventh. */
export function canOmitDominantFifth(root: SpelledPitchClass, bass: SpelledPitchClass, pitches: readonly SpelledPitchClass[]) {
  return pitches.length === 4 && pitchClassEquals(root, bass) &&
    pitches.filter(pitch => pitchClassEquals(pitch, root)).length === 2;
}

/** In a sequence of dominant sevenths, the old seventh descends to the third of the next chord.
 * This is independent evidence for the other voice changing from third to seventh. */
export function readDominantSeventhExchange(
  before: DominantSeventhFrame, after: DominantSeventhFrame, inspectedVoice: VoiceId, root: SpelledPitchClass,
) {
  const [, third, , seventh] = chordToneSpellings(root, "dominant7");
  const nextRoot = scaleDegreePitchClass({ tonic: root, mode: "major" }, 4);
  const [, nextThird, , nextSeventh] = chordToneSpellings(nextRoot, "dominant7");
  for (const voice of VOICE_ORDER) {
    const departure = before.notes[voice], arrival = after.notes[voice];
    if (voice !== inspectedVoice && departure && arrival && pitchClassEquals(departure.pitch, seventh) &&
        resolvesInVoice(before, after, voice, nextThird, -1)) {
      return { third, nextRoot, nextSeventh, resolvingSeventh: departure, resolvedThird: arrival };
    }
  }
}

/** Confirm both written semitone lines at the same attack. */
export function readWrittenDominantSeventhHandoff(
  before: DominantSeventhFrame, after: DominantSeventhFrame, voice: VoiceId, root: SpelledPitchClass,
) {
  const departure = before.notes[voice], arrival = after.notes[voice];
  if (!departure || !arrival || endOf(departure) !== after.tick || arrival.startTick !== after.tick) return;
  const motion = writtenInterval(departure.pitch, arrival.pitch);
  if (motion.semitones !== -1 || motion.diatonicSteps !== 0) return;
  const exchange = readDominantSeventhExchange(before, after, voice, root);
  if (exchange && pitchClassEquals(departure.pitch, exchange.third) &&
      pitchClassEquals(arrival.pitch, exchange.nextSeventh)) return exchange;
}

/** The doubled-root V7 can omit its fifth. Confirm its actual root-position
 * destination and the separate third, seventh and retained root lines.
 * A tied leading tone may settle one written frame after the bass. */
export function readResolvedRootSeventhWithoutFifth(
  source: DominantSeventhFrame,
  arrival: DominantSeventhFrame,
  later?: DominantSeventhFrame,
) {
  const chord = dominantSource(source, arrival);
  if (chord?.inversion !== 0 || chord.fifthVoice) return;
  const { root, target, leadingVoice, seventhVoice } = chord;
  const sourceBass = source.notes.bass!, arrivalBass = arrival.notes.bass!;
  const bassMotion = writtenInterval(sourceBass.pitch, arrivalBass.pitch);
  if (!pitchClassEquals(arrivalBass.pitch, target) || endOf(sourceBass) !== arrival.tick || arrivalBass.startTick !== arrival.tick ||
      !((bassMotion.diatonicSteps === 3 && bassMotion.semitones === 5) ||
        (bassMotion.diatonicSteps === -4 && bassMotion.semitones === -7))) return;

  const rootVoice = VOICE_ORDER.find(voice =>
    voice !== "bass" && pitchClassEquals(source.notes[voice]!.pitch, root),
  )!;
  if (!retainsDominantRoot(source, arrival, rootVoice)) return;

  const held = arrival.notes[leadingVoice]?.id === source.notes[leadingVoice]!.id;
  const settled = held ? settleSingleVoice(arrival, leadingVoice, later)?.settled : arrival;
  if (!settled || !resolvesInVoice(source, settled, leadingVoice, target, 1)) return;

  const mode = (["major", "minor"] as const).find(quality => {
    const tones = chordToneSpellings(target, quality);
    return hasWrittenVoicing(settled, tones) && resolvesInVoice(source, arrival, seventhVoice, tones[1], -1);
  });
  if (!mode) return;
  const noteIds = [source, arrival, settled].flatMap(frame =>
    VOICE_ORDER.map(voice => frame.notes[voice]!.id),
  );
  return {
    root, target, mode, settledTick: settled.tick,
    noteIds: [...new Set(noteIds)],
  };
}

export function dominantNinthTone(identity: ChordIdentity) {
  const structure = identity.structure;
  return structure.kind === "tertian" && structure.quality === "dominant7" && structure.extensions.includes(9)
    ? chordIdentityToneSpellingForDegree(identity, 9) : undefined;
}

/** The ninth is an absolute chord member. Use its written motion and the
 * actual landing identity, including the two textbook same-root V7 exits. */
export function writtenDominantNinthResolves(
  source: ChordIdentity, target: ChordIdentity, from: SpelledPitch, to: SpelledPitch,
) {
  const ninth = dominantNinthTone(source);
  if (!ninth || !pitchClassEquals(from, ninth) || !identityContainsWrittenPitchClass(target, to)) return false;
  const motion = writtenInterval(from, to);
  const step = motion.diatonicSteps === -1 && (motion.semitones === -1 || motion.semitones === -2);
  const structure = target.structure;
  if (structure.kind === "tertian" && !structure.extensions.length) {
    const tonic = scaleDegreePitchClass({ tonic: source.root, mode: "major" }, 4);
    if ((structure.quality === "major" || structure.quality === "minor") && pitchClassEquals(target.root, tonic)) {
      const fifth = chordIdentityToneSpellingForDegree(target, 5);
      return !!fifth && step && pitchClassEquals(to, fifth);
    }
    if (structure.quality === "dominant7" && pitchClassEquals(source.root, target.root)) {
      if (step && pitchClassEquals(to, target.root)) return true;
      const seventh = chordIdentityToneSpellingForDegree(target, 7);
      return !!seventh && pitchClassEquals(to, seventh) && motion.diatonicSteps === -2 &&
        (motion.semitones === -3 || motion.semitones === -4);
    }
  }
  return step;
}

/** The caller establishes the exact preparation chord and the continuity of
 * the two target slices. Return only the held note in the proved 9–8 window. */
export function preparedNinthOverDominantSeventh(
  target: ChordIdentity,
  before: AnalysisSlice["notes"], source: AnalysisSlice["notes"], landing: AnalysisSlice["notes"],
  onsetTick: number, resolutionTick: number,
  onsetMetric: MetricPosition | undefined, resolutionMetric: MetricPosition | undefined,
) {
  const { root, structure } = target;
  const bass = source.bass, landingBass = landing.bass;
  if (structure.kind !== "tertian" || structure.quality !== "dominant7" ||
      structure.extensions.length || structure.alterations.length ||
      !bass || bass.nonChordToneRole || bass.startTick !== onsetTick || !landingBass ||
      !pitchClassEquals(target.bass, root) || !pitchClassEquals(bass.pitch, root) ||
      !pitchClassEquals(landingBass.pitch, root) ||
      compareMetricStrength(onsetMetric, resolutionMetric) !== "stronger") return;
  const required = [chordIdentityToneSpellingForDegree(target, 3), chordIdentityToneSpellingForDegree(target, 7)];
  const exitNotes = Object.values(landing).filter(note => note !== undefined);
  if (!required[0] || !required[1] || exitNotes.length !== VOICE_ORDER.length ||
      !soundsCompleteWrittenTones([root, required[0], required[1]], exitNotes, landingBass)) return;

  for (const voice of VOICE_ORDER) {
    const note = source[voice], arrival = landing[voice];
    if (voice === "bass" || !note || note.nonChordToneRole || before[voice]?.id !== note.id ||
        note.startTick >= onsetTick || note.startTick + note.durationTicks !== resolutionTick ||
        !arrival || arrival.startTick !== resolutionTick || !pitchClassEquals(arrival.pitch, root)) continue;
    const interval = writtenInterval(bass.pitch, note.pitch);
    const motion = writtenInterval(note.pitch, arrival.pitch);
    if (interval.diatonicSteps < 8 || interval.semitones <= 12 || motion.diatonicSteps !== -1 ||
        (motion.semitones !== -1 && motion.semitones !== -2)) continue;
    if (VOICE_ORDER.every(other => {
      if (other === voice || other === "bass") return true;
      const held = source[other], next = landing[other];
      return !!held && !held.nonChordToneRole && !!next &&
        toMidi(held.pitch) >= toMidi(bass.pitch) && spelledPitchEquals(held.pitch, next.pitch);
    })) return note.id;
  }
}

type DoubleAugmentedVoicing = Readonly<Partial<Record<VoiceId, AnalysisNote>>>;

export function isMajorTonicSixFour(identity: ChordIdentity, key: KeyLike) {
  const { structure } = identity;
  return key.mode === "major" && structure.kind === "tertian" && structure.quality === "major" &&
    structure.extensions.length === 0 && structure.alterations.length === 0 &&
    pitchClassEquals(identity.root, key.tonic) &&
    pitchClassEquals(identity.bass, scaleDegreePitchClass(key, 5));
}

/** Spasobin examples 28-423, 30-451 and 30-456. Require the written ♯2, not ♭3. */
export function resolvesDoubleAugmentedFourThree(source: DoubleAugmentedVoicing, target: DoubleAugmentedVoicing, key: KeyLike) {
  const bass = source.bass;
  const targetBass = target.bass;
  if (key.mode !== "major" || !bass || !targetBass ||
      !pitchClassEquals(bass.pitch, scaleDegreePitchClass(key, 6, -1))) return false;
  const raisedSecond = scaleDegreePitchClass(key, 2, 1);
  const raisedFourth = scaleDegreePitchClass(key, 4, 1);
  const majorThird = scaleDegreePitchClass(key, 3);
  const dominant = scaleDegreePitchClass(key, 5);
  const upperNotes = [source.soprano, source.alto, source.tenor];
  if (![key.tonic, raisedSecond, raisedFourth].every(tone =>
    upperNotes.some(note => note && pitchClassEquals(note.pitch, tone)))) return false;

  return VOICE_ORDER.every(voice => {
    const before = source[voice];
    const after = target[voice];
    if (!before || !after || before.nonChordToneRole || after.nonChordToneRole) return false;
    if (toMidi(before.pitch) < toMidi(bass.pitch) || toMidi(after.pitch) < toMidi(targetBass.pitch)) return false;
    if (voice === "bass") return movesToWrittenTone(before.pitch, after.pitch, dominant, -1, -1);
    if (pitchClassEquals(before.pitch, key.tonic)) return spelledPitchEquals(before.pitch, after.pitch);
    if (pitchClassEquals(before.pitch, raisedSecond)) return movesToWrittenTone(before.pitch, after.pitch, majorThird, 1, 1);
    return movesToWrittenTone(before.pitch, after.pitch, dominant, 1, 1);
  });
}
