import { chordToneSpellings } from "../../../chordModel";
import { keyEquals, leadingTonePitchClass, pitchClassEquals, spelledPitchEquals, stepIndex, toMidi, writtenInterval, type KeyLike } from "../../../pitch";
import type { VoiceId } from "../../../project/types";
import type { AnalysisSlice } from "../../analysis";
import type { HarmonyRuleContext } from "../context/createRuleContext";
import { activeNotes } from "../helpers/core";
import { crossesManualPhraseBoundary } from "../helpers/phraseBoundary";

function readHalfDiminishedSlot(slice: AnalysisSlice) {
  if (!slice.completeSatb || !slice.notes.bass) return;
  const notes = activeNotes(slice).map(({ note }) => note);
  const duration = slice.endTick - slice.tick;
  const bass = slice.notes.bass.pitch;
  if (notes.some(note => note.startTick !== slice.tick || note.durationTicks !== duration ||
      note.nonChordToneRole || toMidi(note.pitch) < toMidi(bass))) return;

  const { chord } = slice;
  if (chord) {
    const { structure } = chord.identity;
    if (structure.kind !== "tertian" || structure.quality !== "halfDiminished7" ||
        structure.extensions.length || structure.alterations.length || !pitchClassEquals(chord.identity.bass, bass) ||
        chord.semantics?.cadenceRole || chord.semantics?.pedalContext || chord.semantics?.mixture) return;
  }

  for (const { pitch: root } of notes) {
    if (chord && !pitchClassEquals(chord.identity.root, root)) continue;
    const tones = chordToneSpellings(root, "halfDiminished7");
    const voices = notes.map(note => ({
      note,
      member: tones.findIndex((tone, index) => pitchClassEquals(tone, note.pitch) &&
        (stepIndex(tone.step) - stepIndex(root.step) + 7) % 7 === 2 * index),
    }));
    if (voices.every(voice => voice.member >= 0) && new Set(voices.map(v => v.member)).size === 4)
      return { slice, duration, root, voices };
  }
}

type Slot = NonNullable<ReturnType<typeof readHalfDiminishedSlot>>;

// As the root rises a fourth, 1/3/5/7 go to 5/7/1/3. Checking all four
// signed distances also proves that each two-slot copy lies a whole tone lower.
const semitonesByMember = [-1, 0, -1, -2] as const;

function continuesModel(previous: Slot, current: Slot) {
  return previous.slice.endTick === current.slice.tick && previous.duration === current.duration &&
    previous.slice.key.id === current.slice.key.id && previous.voices.every(({ member, note }, i) => {
      const arrival = current.voices[i];
      return arrival.member === (member + 2) % 4 &&
        toMidi(arrival.note.pitch) - toMidi(note.pitch) === semitonesByMember[member];
    });
}

function writtenRootFourth(before: Slot, after: Slot) {
  return (stepIndex(after.root.step) - stepIndex(before.root.step) + 7) % 7 === 3;
}

// Without respelling, root and third keep their letter; fifth and seventh
// descend one letter. At a flat-to-sharp change every arrival shifts one
// further letter down, at exactly the sounding pitch proved by continuesModel.
function wholeChordRespelt(before: Slot, after: Slot) {
  return before.voices.every(({ member, note }, i) =>
    writtenInterval(note.pitch, after.voices[i].note.pitch).diatonicSteps === (member < 2 ? -1 : -2));
}

/** In a chain of dominant-function sevenths, the next seventh replaces
 * the expected tonic (Spasobin ch. 56, ex. 817). Verify the actual root
 * entering the fifth of that next chord in the same part. */
export function leadingRootContinuesInHalfDiminishedChain(
  context: HarmonyRuleContext, openedAt: number, arrival: AnalysisSlice, voice: VoiceId, targetKey: KeyLike,
) {
  const first = context.sliceAt(arrival.tick - 1);
  const source = first?.notes[voice];
  if (!first || first.tick !== openedAt || !source || targetKey.mode !== "major" || !keyEquals(first.key, targetKey) ||
      !pitchClassEquals(source.pitch, leadingTonePitchClass(targetKey))) return false;
  const head = readHalfDiminishedSlot(first);
  if (!head || !pitchClassEquals(head.root, source.pitch)) return false;
  // Three statements of the two-chord model distinguish a sequence
  // from an unresolved leading seventh followed by a single similar chord.
  const tail = [...context.slices({
    overlapping: { fromTick: arrival.tick, toTick: arrival.tick + 5 * head.duration },
  })];
  if (tail.length !== 5 || crossesManualPhraseBoundary(context, first.tick, tail[4].endTick - 1)) return false;
  let previous = head;
  for (const frame of [first, ...tail]) {
    if (frame.chord?.semantics) {
      const reading = context.harmony.primaryInterpretation(frame.chord);
      if (reading.status !== "resolved" || reading.value.appliedTarget) return false;
      if (frame === first && (reading.value.degree !== 7 || reading.value.degreeAlteration !== 0 ||
          (reading.value.designation && reading.value.designation.primaryFunction !== "dominant"))) return false;
      const key = reading.value.localKey ?? frame.key;
      if (!keyEquals(key, targetKey)) return false;
    }
    if (frame === first) continue;
    const next = readHalfDiminishedSlot(frame);
    if (!next || !continuesModel(previous, next) || !writtenRootFourth(previous, next)) return false;
    previous = next;
  }
  return true;
}

/**
 * A reattack in the same part can change from the written third to the
 * seventh of the next chord. Confirm the seventh actually resolves within
 * three statements of the model before dropping the stale leading obligation.
 */
export function reattackedLeadingToneResolvesAsChainSeventh(
  context: HarmonyRuleContext, openedAt: number, arrival: AnalysisSlice, voice: VoiceId,
) {
  const fromTick = arrival.tick - 5 * (arrival.endTick - arrival.tick);
  if (fromTick < 0) return false;
  const frames = [...context.slices({ overlapping: { fromTick, toTick: arrival.endTick } })];
  if (frames.length !== 6) return false;
  const origin = frames[3];
  const repeated = frames[4];
  const firstNote = origin.notes[voice];
  const seventh = repeated.notes[voice];
  const landing = arrival.notes[voice];
  if (origin.tick !== openedAt || !firstNote || !seventh || !landing ||
      !spelledPitchEquals(firstNote.pitch, seventh.pitch)) return false;
  const motion = writtenInterval(seventh.pitch, landing.pitch);
  if (motion.diatonicSteps !== -1 || motion.semitones !== -2 ||
      crossesManualPhraseBoundary(context, frames[0].tick, arrival.endTick - 1)) return false;

  const slots = frames.map(readHalfDiminishedSlot);
  if (!slots.every((slot): slot is Slot => slot !== undefined) ||
      !slots[3].voices.some(({ note, member }) => note.id === firstNote.id && member === 1) ||
      !slots[4].voices.some(({ note, member }) => note.id === seventh.id && member === 3)) return false;

  let respelt = false;
  for (let i = 1; i < slots.length; i++) {
    const before = slots[i - 1], after = slots[i];
    if (!continuesModel(before, after)) return false;
    if (writtenRootFourth(before, after)) continue;
    // One full enharmonic respelling may corroborate the earlier model.
    if (respelt || i > 3 || !wholeChordRespelt(before, after)) return false;
    respelt = true;
  }
  return true;
}

// Spasobin, ch. 56, example 817 and keyboard exercises. Require three
// two-chord statements and a continuing link beyond every exempt arrival.
export function halfDiminishedChainArrivals(context: HarmonyRuleContext) {
  const arrivals = new Set<string>();
  for (const slots of context.slices().select(readHalfDiminishedSlot).window(6)) {
    if (!slots.every((slot): slot is Slot => slot !== undefined)) continue;
    if (!slots.every((slot, i) => i === 0 || continuesModel(slots[i - 1], slot)) ||
        crossesManualPhraseBoundary(context, slots[0].slice.tick, slots[5].slice.endTick - 1)) continue;
    for (let i = 1; i < slots.length - 1; i++) {
      const before = slots[i - 1], after = slots[i];
      if (i > 1 && wholeChordRespelt(before, after) &&
          slots.every((slot, j) => j === 0 || j === i || writtenRootFourth(slots[j - 1], slot))) {
        before.voices.forEach(({ member }, v) => {
          if (member >= 2) arrivals.add(after.voices[v].note.id);
        });
      }
    }
  }
  return arrivals;
}
