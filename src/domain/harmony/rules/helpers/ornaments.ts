import {
  chordIdentityToneSpellings,
  chordIdentityEquals,
  primaryHarmonyInterpretation,
  chordToneSpellings,
} from "../../../chordModel";
import {
  isWrittenStep,
  pitchClassEquals,
  writtenInterval,
  scaleDegreePitchClass,
  stepIndex,
  toMidi,
  keyEquals,
  spelledPitchEquals,
  leadingTonePitchClass,
} from "../../../pitch";
import type { VoiceId } from "../../../project/types";
import { VOICE_ORDER } from "../../../project/voice";
import type { AnalysisNote, AnalysisSlice, AnalysisChord, MelodyTransition } from "../../analysis";
import { movesToWrittenTone } from "../../facts/dominantMotion";
import { writtenStepDirection } from "../../facts/ornamentalMotion";
import { sameFunctionalReading } from "../../facts/functionalContext";
import {
  writtenNeighborsOverHeldBass,
  returnsByWrittenStep,
  supportsPairedNeighborMotion,
  writtenLowerNeighborPair,
  type LowerNeighborFrame,
} from "../../facts/prolongation";
import { matchesWrittenChord, resolvesInVoice } from "../../facts/tendencyResolution";
import { soundsCompleteWrittenChord, hasCompleteWrittenTertianVoicing } from "../../facts/writtenVoicing";
import type { HarmonyRuleContext } from "../context/createRuleContext";
import type { NoteView } from "../context/views";
import { activeNotes, crossesManualPhraseBoundary } from "./core";

function noteEnd(note: AnalysisNote) {
  return note.startTick + note.durationTicks;
}

// Spasobin chs. 38–41: a written second or a chromatic semitone can
// connect adjacent notes in an uninterrupted passing or neighbor motion.
export const passingStepDirection = writtenStepDirection;

export function crossesOrnamentCut(context: HarmonyRuleContext, from: number, to: number) {
  return crossesManualPhraseBoundary(context, from, to) ||
    context.analysis.project.keyEvents.some(event => from < event.tick && event.tick <= to);
}

function isStructuralTone(context: HarmonyRuleContext, note: AnalysisNote, slice?: AnalysisSlice) {
  return !note.nonChordToneRole && context.harmony.isWrittenChordTone(note, slice?.chord);
}

function isDepartureTone(context: HarmonyRuleContext, note: AnalysisNote) {
  return isStructuralTone(context, note, context.sliceAt(noteEnd(note) - 1)) ||
    isStructuralTone(context, note, context.sliceAt(note.startTick));
}

function isOutsideChord(context: HarmonyRuleContext, note: AnalysisNote, chord?: AnalysisChord) {
  return Boolean(chord && !context.harmony.isWrittenChordTone(note, chord));
}

export function resolvePassingChain(context: HarmonyRuleContext, current: NoteView) {
  if (current.note.nonChordToneRole !== "passing") return;
  const neighborhood = context.noteNeighborhood(current);
  const previous = neighborhood?.previous;
  const next = neighborhood?.next;
  if (!neighborhood || !previous || !next ||
      !isOutsideChord(context, current.note, neighborhood.attackSlice.chord)) return;
  const direction = passingStepDirection(previous.note, current.note);
  if (!direction || passingStepDirection(current.note, next.note) !== direction) return;

  const chainNotes = [current.note];
  let left = previous;
  let right = next;
  // Up to four intervening notes suffice to fill a perfect fourth chromatically.
  while (left.note.nonChordToneRole === "passing") {
    if (chainNotes.length === 4) return;
    const entry = context.noteNeighborhood(left);
    if (!entry?.previous || !isOutsideChord(context, left.note, entry.attackSlice.chord) ||
        passingStepDirection(entry.previous.note, left.note) !== direction) return;
    chainNotes.unshift(left.note);
    left = entry.previous;
  }
  while (right.note.nonChordToneRole === "passing") {
    if (chainNotes.length === 4) return;
    const entry = context.noteNeighborhood(right);
    if (!entry?.next || !isOutsideChord(context, right.note, entry.attackSlice.chord) ||
        passingStepDirection(right.note, entry.next.note) !== direction) return;
    chainNotes.push(right.note);
    right = entry.next;
  }

  const leftAnchor = left.note;
  const rightAnchor = right.note;
  if (crossesOrnamentCut(context, leftAnchor.startTick, rightAnchor.startTick) ||
      !isDepartureTone(context, leftAnchor) ||
      !isStructuralTone(context, rightAnchor, context.sliceAt(rightAnchor.startTick))) return;
  return { direction, leftAnchor, rightAnchor, chainNotes };
}

// Chs. 36–37: the first dissonant slice identifies the harmonic entry even
// when the underlying note was attacked on the preparation chord.
export function suspensionEntry(context: HarmonyRuleContext, currentNote: NoteView) {
  const { voiceId, note } = currentNote;
  const outside = context.slices({ overlapping: { fromTick: note.startTick, toTick: noteEnd(note) } })
    .first(slice => slice.notes[voiceId]?.id === note.id && isOutsideChord(context, note, slice.chord));
  if (!outside) return;
  const previousSlice = context.sliceTransitions({ toSliceIndex: outside.index }).last()?.previous;
  const previousAttack = context.noteNeighborhood(currentNote)?.previous?.note;
  const preparedByHeldNote = Boolean(
    previousSlice?.chord && previousSlice.endTick === outside.tick &&
    previousSlice.notes[voiceId]?.id === note.id &&
    context.harmony.isWrittenChordTone(note, previousSlice.chord),
  );
  const preparedByReattack = Boolean(
    previousSlice?.chord && previousAttack && noteEnd(previousAttack) === note.startTick &&
    toMidi(previousAttack.pitch) === toMidi(note.pitch) &&
    context.harmony.isWrittenChordTone(previousAttack, previousSlice.chord),
  );
  return {
    current: outside,
    previousSlice,
    previousAttack,
    prepared: preparedByHeldNote || preparedByReattack,
  };
}

function preparedSuspension(context: HarmonyRuleContext, current: NoteView, chord: AnalysisChord) {
  const entry = suspensionEntry(context, current);
  const preparation = entry?.previousSlice;
  const preparedNote = preparation?.notes[current.voiceId];
  return Boolean(entry?.prepared && entry.current.chord?.id === chord.id &&
    preparation?.chord && preparation.chord.id !== chord.id && preparation.endTick === entry.current.tick &&
    preparedNote && context.pitch.sameWrittenPitch(preparedNote, current.note) &&
    !crossesOrnamentCut(context, preparedNote.startTick, noteEnd(current.note)));
}

function isLeap(from: AnalysisNote, to: AnalysisNote) {
  const interval = writtenInterval(from.pitch, to.pitch);
  return noteEnd(from) === to.startTick && Math.abs(interval.diatonicSteps) > 1 &&
    Math.abs(interval.semitones) > 2;
}

// Chs. 40 and 43 describe the return of a neighbor and the two directions of
// a leaping ornament. Share their motion evidence with the bass and voicing checks.
function resolveOrnamentMotion(context: HarmonyRuleContext, current: NoteView, chord: AnalysisChord) {
  const { note } = current;
  const neighborhood = context.noteNeighborhood(current);
  const previous = neighborhood?.previous?.note;
  const next = neighborhood?.next?.note;
  if (!neighborhood || !next || noteEnd(note) !== next.startTick) return;
  const arrival = context.sliceAt(next.startTick);
  const prepared = note.nonChordToneRole === "suspension" || note.nonChordToneRole === "retardation";
  const motionStart = prepared ? note.startTick : previous?.startTick ?? note.startTick;
  if (!arrival?.chord || !isStructuralTone(context, next, arrival) ||
      crossesOrnamentCut(context, motionStart, next.startTick)) return;

  const departure = context.sliceAt(note.startTick - 1);
  const exit = passingStepDirection(note, next);
  const jumpedIn = Boolean(previous && isLeap(previous, note));
  switch (note.nonChordToneRole) {
    case "neighbor":
      if (!previous || !exit || passingStepDirection(previous, note) !== -exit ||
          !context.pitch.sameWrittenPitch(previous, next) || !isDepartureTone(context, previous)) return;
      break;
    case "escape":
      if (!previous || !passingStepDirection(previous, note) ||
          !isStructuralTone(context, previous, departure) || !isLeap(note, next)) return;
      break;
    case "appoggiatura":
      if (!exit || (!jumpedIn && previous && context.metric.positionAt(note.startTick)?.role !== "downbeat")) return;
      break;
    case "suspension":
    case "retardation": {
      const direction = note.nonChordToneRole === "suspension" ? -1 : 1;
      if (exit !== direction || writtenInterval(note.pitch, next.pitch).diatonicSteps !== direction ||
          !preparedSuspension(context, current, chord)) return;
      break;
    }
    default:
      return;
  }
  return { previous, departure, next, arrival, target: arrival.chord, jumpedIn };
}

function anticipatesNextChord(context: HarmonyRuleContext, current: NoteView, chord: AnalysisChord) {
  const { note, voiceId } = current;
  const arrival = chord.startTick + chord.durationTicks;
  const target = context.sliceAt(arrival);
  const sounding = target?.notes[voiceId];
  if (!target?.chord || target.chord.startTick !== arrival || !sounding ||
      crossesOrnamentCut(context, note.startTick, arrival) ||
      !context.harmony.isWrittenChordTone(note, target.chord)) return false;
  // Ch. 42: the next chord takes up the same written pitch, held or reattacked.
  return sounding.id === note.id ||
    (noteEnd(note) === arrival && sounding.startTick === arrival &&
      !sounding.nonChordToneRole && context.pitch.sameWrittenPitch(note, sounding));
}

export function isVerifiedChordOrnament(
  context: HarmonyRuleContext, chord: AnalysisChord, { voiceId, note }: NoteView,
) {
  if (!note.nonChordToneRole || note.nonChordToneRole === "other" || note.nonChordToneRole === "pedal" ||
      !isOutsideChord(context, note, chord)) return false;
  const view = context.notes({ voiceId, startingAt: note.startTick }).first(item => item.note.id === note.id);
  if (!view) return false;
  // Suspensions may have attacked as a structural member of the previous chord.
  const role = note.nonChordToneRole;
  if (role !== "suspension" && role !== "retardation" &&
      context.sliceAt(note.startTick)?.chord?.id !== chord.id) return false;
  if (role === "passing") return Boolean(resolvePassingChain(context, view));
  // Bass anticipations affect both inversion and voicing. Their structural
  // replacement is already checked by notesWithAnticipationReplacements.
  if (role === "anticipation") return voiceId !== "bass" && anticipatesNextChord(context, view, chord);
  return Boolean(resolveOrnamentMotion(context, view, chord));
}

function isStructuralBass(context: HarmonyRuleContext, note: AnalysisNote, slice?: AnalysisSlice) {
  return Boolean(slice?.chord && pitchClassEquals(note.pitch, slice.chord.identity.bass) &&
    isStructuralTone(context, note, slice));
}

function hasStructuralBass(context: HarmonyRuleContext, chord: AnalysisChord) {
  return context.slices({ overlapping: { fromTick: chord.startTick, toTick: chord.startTick + chord.durationTicks } })
    .any(slice => slice.chord?.id === chord.id && Boolean(slice.notes.bass &&
      isStructuralBass(context, slice.notes.bass, slice)));
}

function continuesPedalBass(context: HarmonyRuleContext, chord: AnalysisChord, bass: AnalysisNote) {
  // Ch. 48: the bass pedal may sound independently of the moving harmony.
  const pedal = chord.semantics?.pedalContext;
  if (!pedal || !pitchClassEquals(pedal.pitch, bass.pitch)) return false;
  if (bass.nonChordToneRole === "pedal") return true;
  return [true, false].some(before => {
    const edge = before ? chord.startTick : chord.startTick + chord.durationTicks;
    const adjacent = context.sliceAt(before ? edge - 1 : edge);
    const otherBass = adjacent?.notes.bass;
    const otherPedal = adjacent?.chord?.semantics?.pedalContext;
    return Boolean(otherBass && otherPedal && pitchClassEquals(pedal.pitch, otherPedal.pitch) &&
      context.pitch.sameWrittenPitch(bass, otherBass) &&
      (bass.id === otherBass.id || (before
        ? noteEnd(otherBass) === edge && bass.startTick === edge
        : noteEnd(bass) === edge && otherBass.startTick === edge)));
  });
}

export function isVerifiedOrnamentalBass(
  context: HarmonyRuleContext, slice: AnalysisSlice, chord: AnalysisChord, bass: AnalysisNote,
) {
  if (continuesPedalBass(context, chord, bass)) return true;
  const role = bass.nonChordToneRole;
  if (!role || role === "other" || role === "pedal" || role === "anticipation" ||
      !isOutsideChord(context, bass, chord)) return false;
  const view = context.notes({ voiceId: "bass", startingAt: bass.startTick }).first(item => item.note.id === bass.id);
  if (!view) return false;
  const end = chord.startTick + chord.durationTicks;
  if (role === "suspension" || role === "retardation") {
    const motion = resolveOrnamentMotion(context, view, chord);
    return Boolean(motion && motion.target.id === chord.id && motion.arrival.tick >= slice.endTick &&
      isStructuralBass(context, motion.next, motion.arrival));
  }
  if (context.sliceAt(bass.startTick)?.chord?.id !== chord.id) return false;

  const position = context.metric.positionAt(bass.startTick);
  const offDownbeat = Boolean(position && position.role !== "downbeat");
  const withinMeasure = offDownbeat &&
    context.metric.positionAt(noteEnd(bass) - 1)?.measureNumber === position?.measureNumber;
  if (role === "passing") {
    const chain = resolvePassingChain(context, view);
    if (!withinMeasure || !chain || bass.durationTicks > chain.leftAnchor.durationTicks ||
        !hasStructuralBass(context, chord)) return false;
    const departure = context.sliceAt(noteEnd(chain.leftAnchor) - 1);
    const source = departure?.chord;
    if (!source || !isStructuralTone(context, chain.leftAnchor, departure) ||
        (!isStructuralBass(context, chain.leftAnchor, departure) &&
          !isStructuralBassAtStart(context, source))) return false;
    const arrival = context.sliceAt(chain.rightAnchor.startTick);
    const target = arrival?.chord;
    if (target?.id === chord.id) return true;
    if (target?.startTick !== end || target.startTick !== chain.rightAnchor.startTick ||
        !isStructuralBass(context, chain.rightAnchor, arrival)) return false;
    // Ascending melodic-minor V–V6/V65 uses the separate continuation
    // proof in beforeMelodicMinorPassingBass, including the resolution to i.
    const key = slice.key;
    const dominant = scaleDegreePitchClass(key, 5);
    return !(key.mode === "minor" && chain.chainNotes.length === 1 && source.id === chord.id &&
      pitchClassEquals(source.identity.root, dominant) && pitchClassEquals(target.identity.root, dominant) &&
      pitchClassEquals(chain.leftAnchor.pitch, dominant) &&
      pitchClassEquals(bass.pitch, scaleDegreePitchClass(key, 6, 1)) &&
      pitchClassEquals(chain.rightAnchor.pitch, leadingTonePitchClass(key)));
  }

  const motion = resolveOrnamentMotion(context, view, chord);
  if (!motion || !isStructuralBass(context, motion.next, motion.arrival)) return false;
  const { previous, departure, target, next } = motion;
  const entersNextChord = target.id !== chord.id && target.startTick === end && next.startTick === end;
  switch (role) {
    case "neighbor":
      return Boolean(withinMeasure && previous && isStructuralBass(context, previous, departure) &&
        (departure?.chord?.id === chord.id || target.id === chord.id) &&
        bass.durationTicks <= Math.max(previous.durationTicks, next.durationTicks));
    case "escape":
      return Boolean(offDownbeat && entersNextChord && previous && departure?.chord?.id === chord.id &&
        isStructuralBass(context, previous, departure));
    case "appoggiatura":
      return motion.jumpedIn && (target.id === chord.id || entersNextChord) && hasStructuralBass(context, chord);
    default:
      return false;
  }
}

function isStructuralBassAtStart(context: HarmonyRuleContext, chord: AnalysisChord) {
  const opening = context.sliceAt(chord.startTick);
  const bass = opening?.notes.bass;
  return Boolean(opening?.chord?.id === chord.id && bass && isStructuralBass(context, bass, opening));
}

/** Restore the previous structural note only in voices that demonstrably
 * anticipate the next chord (Spasobin, chapter 42, §§1–5). */
export function notesWithAnticipationReplacements(
  context: HarmonyRuleContext,
  slice: AnalysisSlice,
  active = activeNotes(slice),
) {
  const chord = slice.chord;
  if (!chord || !slice.completeSatb) return active;
  const ornaments = active.filter(
    ({ note }) =>
      note.nonChordToneRole === "anticipation" &&
      !context.harmony.isWrittenChordTone(note, chord),
  );
  if (ornaments.length === 0 || ornaments.length > 2) return active;

  const onset = ornaments[0].note.startTick;
  const arrival = chord.startTick + chord.durationTicks;
  const duration = arrival - onset;
  if (
    onset <= chord.startTick ||
    duration <= 0 ||
    duration > context.analysis.project.ppq / 2 ||
    ornaments.some(({ note }) => note.startTick !== onset || note.durationTicks !== duration)
  ) return active;

  const before = context.sliceAt(onset - 1);
  const after = context.sliceAt(arrival);
  const target = after?.chord;
  if (
    !before?.completeSatb ||
    before.chord?.id !== chord.id ||
    !after?.completeSatb ||
    !target ||
    target.startTick !== arrival ||
    !pitchClassEquals(before.notes.bass!.pitch, chord.identity.bass) ||
    !pitchClassEquals(after.notes.bass!.pitch, target.identity.bass)
  ) return active;

  const weak = context.metric.positionAt(onset);
  if (
    (weak?.role !== "weak-beat" && weak?.role !== "subdivision") ||
    context.metric.compare(weak, context.metric.positionAt(arrival)) !== "weaker"
  ) return active;

  const sourceNotes = activeNotes(before);
  if (
    sourceNotes.some(({ note }) => note.nonChordToneRole || !context.harmony.isWrittenChordTone(note, chord)) ||
    !chordIdentityToneSpellings(chord.identity).every(tone =>
      sourceNotes.some(({ note }) => pitchClassEquals(note.pitch, tone)),
    ) ||
    activeNotes(after).some(({ note }) => note.nonChordToneRole || !context.harmony.isWrittenChordTone(note, target))
  ) return active;

  const motions: Array<{
    ornament: (typeof ornaments)[number];
    previous: AnalysisNote;
    direction: number;
  }> = [];
  for (const ornament of ornaments) {
    const { voiceId, note } = ornament;
    const previous = before.notes[voiceId]!;
    const next = after.notes[voiceId]!;
    if (
      crossesOrnamentCut(context, previous.startTick, arrival) ||
      previous.startTick + previous.durationTicks !== onset ||
      next.startTick !== arrival ||
      duration > previous.durationTicks ||
      duration > next.durationTicks ||
      !context.pitch.sameWrittenPitch(note, next)
    ) return active;
    const entry = writtenInterval(previous.pitch, note.pitch);
    if (!isWrittenStep(entry) || Math.sign(entry.semitones) !== entry.diatonicSteps) return active;
    motions.push({ ornament, previous, direction: entry.diatonicSteps });
  }

  if (motions.length === 2 && motions[0].direction === motions[1].direction) {
    const [upper, lower] = motions;
    const sourceInterval = writtenInterval(lower.previous.pitch, upper.previous.pitch);
    const ornamentInterval = writtenInterval(lower.ornament.note.pitch, upper.ornament.note.pitch);
    const sourceClass = Math.abs(sourceInterval.diatonicSteps) % 7;
    const ornamentClass = Math.abs(ornamentInterval.diatonicSteps) % 7;
    if (sourceClass !== ornamentClass || (ornamentClass !== 2 && ornamentClass !== 5)) return active;
  }

  // Check the actual intervening voicing. Other voices can change chord tones,
  // but only the verified anticipations receive a replacement.
  for (const weakSlice of context.slices({ overlapping: { fromTick: onset, toTick: arrival } })) {
    if (
      !weakSlice.completeSatb ||
      weakSlice.chord?.id !== chord.id ||
      activeNotes(weakSlice).some(({ note }) =>
        !ornaments.some(ornament => ornament.note.id === note.id) &&
        (note.nonChordToneRole || !context.harmony.isWrittenChordTone(note, chord)),
      )
    ) return active;
  }

  return active.map(item => {
    const motion = motions.find(({ ornament }) => ornament.voiceId === item.voiceId);
    return motion ? { voiceId: item.voiceId, note: motion.previous } : item;
  });
}

function passingDirection(first: AnalysisNote, middle: AnalysisNote, last: AnalysisNote) {
  if ((middle.nonChordToneRole && middle.nonChordToneRole !== "passing") ||
      first.startTick + first.durationTicks !== middle.startTick ||
      middle.startTick + middle.durationTicks !== last.startTick ||
      middle.durationTicks > Math.min(first.durationTicks, last.durationTicks)) return undefined;
  const into = writtenInterval(first.pitch, middle.pitch);
  const out = writtenInterval(middle.pitch, last.pitch);
  if (!isWrittenStep(into) || !isWrittenStep(out) ||
      into.diatonicSteps !== out.diatonicSteps ||
      Math.sign(into.semitones) !== into.diatonicSteps ||
      Math.sign(out.semitones) !== out.diatonicSteps) return undefined;
  return into.diatonicSteps;
}

/** Match a complete triad immediately beyond the end of a label using the
 * sounding notes there. The recovered evidence is local to this ornamental slice. */
export function triadTailOrnaments(context: HarmonyRuleContext, middle: AnalysisSlice) {
  const chord = middle.chord;
  if (!chord || !middle.completeSatb || middle.endTick !== chord.startTick + chord.durationTicks ||
      middle.attackVoiceIds.length < 1 || middle.attackVoiceIds.length > 2 ||
      middle.attackVoiceIds.includes("bass")) return;
  const { identity } = chord;
  const structure = identity.structure;
  if (structure.kind !== "tertian" || (structure.quality !== "major" && structure.quality !== "minor") ||
      structure.extensions.length || structure.alterations.length) return;
  const before = context.sliceAt(middle.tick - 1);
  const after = context.sliceAt(middle.endTick);
  if (!before?.completeSatb || before.chord?.id !== chord.id || !after?.completeSatb || after.chord ||
      before.endTick !== middle.tick || after.tick !== middle.endTick ||
      before.key.id !== middle.key.id || after.key.id !== middle.key.id ||
      context.analysis.phraseBoundaries.some(b => !b.stale && before.tick < b.tick && b.tick <= after.tick)) return;
  const position = context.metric.positionAt(middle.tick);
  const arrival = context.metric.positionAt(after.tick);
  const duration = middle.endTick - middle.tick;
  if (!position || position.confidence !== "certain" || position.level >= 2 ||
      arrival?.confidence !== "certain" || duration > context.analysis.project.ppq || duration > before.endTick - before.tick ||
      context.metric.compare(context.metric.positionAt(before.tick), position) !== "stronger" ||
      context.metric.compare(arrival, position) === "weaker") return;
  if (![before, after].every(slice =>
    soundsCompleteWrittenChord(identity, Object.values(slice.notes), slice.notes.bass!),
  )) return;
  const tones = chordIdentityToneSpellings(identity);
  const moving = middle.attackVoiceIds;
  const notes = moving.map(voice => middle.notes[voice]!);
  if (notes.some(note => note.startTick !== middle.tick ||
      tones.some(tone => pitchClassEquals(tone, note.pitch)) ||
      toMidi(note.pitch) < toMidi(middle.notes.bass!.pitch)) ||
      VOICE_ORDER.some(voice => !moving.includes(voice) &&
        (before.notes[voice]?.id !== middle.notes[voice]?.id || after.notes[voice]?.id !== middle.notes[voice]?.id)) ||
      hasCompleteWrittenTertianVoicing(Object.values(middle.notes).map(note => note.pitch))) return;
  if (moving.length === 1) {
    const neighborIds = writtenNeighborsOverHeldBass(identity, before, middle, after);
    if (neighborIds?.length === 1 && neighborIds[0] === notes[0].id) {
      return { noteIds: neighborIds, departure: before };
    }
    return;
  }

  // Spasobin §39.2, example 39–591: two contrary passing voices can converge.
  if (!pitchClassEquals(notes[0].pitch, notes[1].pitch)) return;
  const reading = context.harmony.primaryInterpretation(chord);
  if (reading.status !== "resolved") return;
  const key = reading.value.localKey ?? middle.key;
  const degree = (stepIndex(notes[0].pitch.step) - stepIndex(key.tonic.step) + 7) % 7 + 1;
  if (!pitchClassEquals(notes[0].pitch, scaleDegreePitchClass(key, degree))) return;
  const directions = moving.map(voice => passingDirection(before.notes[voice]!, middle.notes[voice]!, after.notes[voice]!));
  if (directions[0] === undefined || directions[1] !== -directions[0]) return;
  return { noteIds: notes.map(note => note.id), departure: before };
}

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
  return left.mixture === right.mixture && sameFunctionalReading(a, b);
}

function orderedNotes(slice: AnalysisSlice) {
  if (!slice.completeSatb) return;
  const notes = VOICE_ORDER.map(voice => slice.notes[voice]!);
  if (notes.some((note, i) => i > 0 && toMidi(notes[i - 1].pitch) <= toMidi(note.pitch))) return;
  return notes;
}

/** Spasobin §40.5: on a held harmony the outer voices can decorate the
 * same inversion with synchronous, written neighbors. */
export function pairedOuterNeighbors(context: HarmonyRuleContext, slice: AnalysisSlice) {
  const bass = slice.notes.bass, soprano = slice.notes.soprano;
  const chord = slice.chord;
  if (!bass || !soprano || !chord || !simpleLabel(chord) ||
      chord.identity.structure.kind !== "tertian" ||
      chord.identity.structure.extensions.length || chord.identity.structure.alterations.length ||
      !["major", "minor"].includes(chord.identity.structure.quality)) return;

  const start = bass.startTick, end = start + bass.durationTicks;
  if (soprano.startTick !== start || soprano.durationTicks !== bass.durationTicks ||
      bass.durationTicks > context.analysis.project.ppq) return;
  const tones = chordIdentityToneSpellings(chord.identity);
  if (tones.some(tone => pitchClassEquals(tone, bass.pitch) || pitchClassEquals(tone, soprano.pitch))) return;
  const position = context.metric.positionAt(start);
  const strongest = context.metric.strongestBetween(start, end);
  if (position?.confidence !== "certain" ||
      (strongest && strongest.level > position.level) ||
      (position.role !== "weak-beat" && position.role !== "subdivision") ||
      context.metric.positionAt(end - 1)?.measureNumber !== position.measureNumber) return;

  const before = context.sliceAt(start - 1), after = context.sliceAt(end);
  if (!before || !after || !sameLabel(chord, before.chord) || !sameLabel(chord, after.chord) ||
      !keyEquals(after.key, before.key) || context.analysis.phraseBoundaries.some(
        boundary => before.tick < boundary.tick && boundary.tick <= end)) return;

  const first = orderedNotes(before), middle = orderedNotes(slice), last = orderedNotes(after);
  if (!first || !middle || !last ||
      !soundsCompleteWrittenChord(chord.identity, first, first[3]) ||
      !soundsCompleteWrittenChord(chord.identity, last, last[3]) ||
      !returnsByWrittenStep(first[3], bass, last[3]) ||
      !returnsByWrittenStep(first[0], soprano, last[0]) ||
      hasCompleteWrittenTertianVoicing(middle.map(note => note.pitch))) return;
  if (!supportsPairedNeighborMotion(first[3].pitch, first[0].pitch, bass.pitch, soprano.pitch)) return;
  if (![1, 2].every(i => spelledPitchEquals(first[i].pitch, last[i].pitch))) return;
  const completeWindow = context.slices({ overlapping: { fromTick: start, toTick: end } }).all(frame =>
    keyEquals(frame.key, before.key) && sameLabel(chord, frame.chord) &&
    frame.notes.bass?.id === bass.id && frame.notes.soprano?.id === soprano.id &&
    frame.notes.alto?.id === first[1].id && frame.notes.tenor?.id === first[2].id,
  );
  if (completeWindow) return { noteIds: [bass.id, soprano.id], departure: before };
}

const upperVoices = ["soprano", "alto", "tenor"] as const;

function labelSupports(slice: AnalysisSlice, support: readonly AnalysisNote[], bass: AnalysisNote) {
  const identity = slice.chord?.identity;
  if (!identity) return true;
  const tones = chordIdentityToneSpellings(identity);
  return identity.structure.kind === "tertian" && pitchClassEquals(bass.pitch, identity.bass) &&
    tones.every(tone => support.some(note => pitchClassEquals(note.pitch, tone))) &&
    support.every(note => tones.some(tone => pitchClassEquals(note.pitch, tone)));
}

/** Chapter 40 §§1–4: a weak lower semitone in the bass may decorate a sustained harmony. */
export function bassNeighborAgainstHeldUpper(
  context: HarmonyRuleContext,
  neighbor: AnalysisNote,
  heldVoice: VoiceId,
  held: AnalysisNote,
) {
  const start = neighbor.startTick;
  const end = start + neighbor.durationTicks;
  if (heldVoice === "bass" || held.startTick >= start || held.startTick + held.durationTicks <= end ||
      held.pitch.step !== neighbor.pitch.step || Math.abs(held.pitch.alter - neighbor.pitch.alter) !== 1 ||
      held.pitch.octave <= neighbor.pitch.octave) return false;

  const before = context.sliceAt(start - 1);
  const after = context.sliceAt(end);
  const first = before?.notes.bass;
  const last = after?.notes.bass;
  if (!before?.completeSatb || !after?.completeSatb || !first || !last ||
      before.notes[heldVoice]?.id !== held.id ||
      toMidi(first.pitch) - toMidi(neighbor.pitch) !== 1 ||
      !returnsByWrittenStep(first, neighbor, last) ||
      crossesManualPhraseBoundary(context, before.tick, end)) return false;

  const position = context.metric.positionAt(start);
  const accent = context.metric.strongestBetween(start, end);
  if (!position || position.level === 3 || accent?.level === 3) return false;

  const support = Object.values(before.notes);
  if (support.some(note => note.nonChordToneRole || (note.id !== first.id && toMidi(note.pitch) <= toMidi(first.pitch))) ||
      !hasCompleteWrittenTertianVoicing(support.map(note => note.pitch)) ||
      !labelSupports(before, support, first)) return false;

  const maintainsHarmony = (slice: AnalysisSlice) => slice.key.id === before.key.id &&
    upperVoices.every(voice => slice.notes[voice]?.id === before.notes[voice]?.id) &&
    labelSupports(slice, support, first);
  return maintainsHarmony(after) &&
    context.slices({ overlapping: { fromTick: start, toTick: end } })
      .all(slice => slice.notes.bass?.id === neighbor.id && maintainsHarmony(slice));
}

const upper = ["soprano", "alto", "tenor"] as const;

// In ascending melodic minor the bass may fill V–V6 (or V65) on its
// way to i. Locate the structural voicing from the held upper triad.
export function beforeMelodicMinorPassingBass(context: HarmonyRuleContext, middle: AnalysisSlice) {
  const bass = middle.notes.bass, key = middle.key;
  if (!bass || bass.nonChordToneRole !== "passing" || key.mode !== "minor" ||
      bass.startTick !== middle.tick || bass.startTick + bass.durationTicks !== middle.endTick ||
      !middle.chord || middle.chord.startTick + middle.chord.durationTicks !== middle.endTick) return;
  const metric = context.metric.positionAt(middle.tick);
  if (metric?.confidence !== "certain" || (metric.role !== "weak-beat" && metric.role !== "subdivision") ||
      bass.durationTicks > context.analysis.project.ppq) return;

  const before = context.sliceAt(middle.tick - 1), leading = context.sliceAt(middle.endTick);
  const tonic = leading && context.sliceAt(leading.endTick);
  const initialBass = before?.notes.bass, leadingBass = leading?.notes.bass;
  if (!before || !initialBass || before.chord?.id !== middle.chord.id || !leading?.chord || !tonic?.chord ||
      !leadingBass || leadingBass.startTick !== leading.tick ||
      leadingBass.startTick + leadingBass.durationTicks !== leading.endTick ||
      leading.chord.startTick !== leading.tick || tonic.chord.startTick !== tonic.tick ||
      initialBass.startTick < middle.chord.startTick || initialBass.durationTicks < bass.durationTicks ||
      context.analysis.phraseBoundaries.some(b => !b.stale && initialBass.startTick < b.tick && b.tick <= tonic.tick)) return;
  for (const [frame, degree] of [[before, 5], [leading, 5], [tonic, 1]] as const) {
    if (frame.key.id !== key.id) return;
    const reading = context.harmony.primaryInterpretation(frame.chord!);
    if (reading.status === "ambiguous" || (reading.status === "resolved" &&
        (reading.value.degree !== degree || reading.value.degreeAlteration !== 0 || reading.value.appliedTarget ||
         (reading.value.localKey && !keyEquals(reading.value.localKey, key))))) return;
  }

  const dominant = scaleDegreePitchClass(key, 5);
  if (!pitchClassEquals(initialBass.pitch, dominant) || !matchesWrittenChord(before, dominant, "major") ||
      !movesToWrittenTone(initialBass.pitch, bass.pitch, scaleDegreePitchClass(key, 6, 1), 1, 2) ||
      !movesToWrittenTone(bass.pitch, leadingBass.pitch, leadingTonePitchClass(key), 1, 2) ||
      !resolvesInVoice(leading, tonic, "bass", key.tonic, 1) || !matchesWrittenChord(tonic, key.tonic, "minor")) return;

  const dominantTones = chordToneSpellings(dominant, "major");
  if (!dominantTones.every(tone => upper.some(v => pitchClassEquals(before.notes[v]!.pitch, tone))) ||
      !upper.every(v => middle.notes[v]?.id === before.notes[v]!.id &&
        toMidi(before.notes[v]!.pitch) >= toMidi(bass.pitch))) return;
  if (matchesWrittenChord(leading, dominant, "major")) return before;
  if (!matchesWrittenChord(leading, dominant, "dominant7")) return;
  const seventh = chordToneSpellings(dominant, "dominant7")[3];
  const voice = upper.find(v => pitchClassEquals(leading.notes[v]!.pitch, seventh));
  if (voice && resolvesInVoice(leading, tonic, voice, scaleDegreePitchClass(key, 3), -1)) return before;
}

function agreeOnAnchorContext(context: HarmonyRuleContext, departure: AnalysisSlice, arrival: AnalysisSlice) {
  if (!departure.chord || !arrival.chord ||
      !chordIdentityEquals(departure.chord.identity, arrival.chord.identity)) return false;
  const left = context.harmony.primaryInterpretation(departure.chord);
  const right = context.harmony.primaryInterpretation(arrival.chord);
  if (left.status === "ambiguous" || right.status === "ambiguous") return false;
  const earlier = left.status === "resolved" ? left.value : undefined;
  const later = right.status === "resolved" ? right.value : undefined;
  const leftKey = earlier?.localKey ?? departure.key;
  const rightKey = later?.localKey ?? arrival.key;
  if (!keyEquals(leftKey, rightKey)) return false;
  if (!earlier || !later) return true;
  return earlier.degree === later.degree && earlier.degreeAlteration === later.degreeAlteration &&
    earlier.appliedTarget?.degree === later.appliedTarget?.degree &&
    earlier.appliedTarget?.primaryFunction === later.appliedTarget?.primaryFunction &&
    earlier.appliedTarget?.secondaryFunction === later.appliedTarget?.secondaryFunction;
}

export function isWrittenLowerNeighborMotion(context: HarmonyRuleContext, transition: MelodyTransition) {
  const lower = context.sliceAt(transition.current.startTick);
  if (!lower || lower.chord || lower.tick !== transition.current.startTick) return false;
  const upper = context.sliceAt(lower.tick - 1);
  if (!upper || upper.notes[transition.voiceId]?.id !== transition.previous.id) return false;
  const departure = context.sliceAt(upper.tick - 1);
  const preparation = departure && context.sliceAt(departure.tick - 1);
  const arrival = context.sliceAt(lower.endTick);
  if (!preparation?.chord || !departure?.chord || !arrival ||
      !agreeOnAnchorContext(context, departure, arrival)) return false;
  const frame = (slice: AnalysisSlice): LowerNeighborFrame =>
    ({ ...slice, metric: context.metric.positionAt(slice.tick) });
  const phraseEnd = context.phraseAt(preparation.tick)?.toTick;
  const pair = writtenLowerNeighborPair(preparation.chord.identity, departure.chord.identity,
    [frame(preparation), frame(departure), frame(upper), frame(lower), frame(arrival)],
    phraseEnd === undefined ? [] : [phraseEnd]);
  return pair?.includes(transition.current.id) ?? false;
}
