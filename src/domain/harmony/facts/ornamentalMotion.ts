import { chordIdentityEquals, chordIdentityToneSpellings, type ChordIdentity } from "../../chordModel";
import {
  isWrittenStep, keyDeclarationEquals, keyEquals, leadingTonePitchClass, pitchClassEquals,
  scaleDegreePitchClass, spelledPitchEquals, writtenInterval,
} from "../../pitch";
import type { KeyReference } from "../../chordModel";
import type { NonChordToneRole, VoiceId } from "../../project/types";
import { VOICE_ORDER } from "../../project/voice";
import type { MetricPosition } from "../../rhythm/metric";
import type { AnalysisNote, AnalysisSlice } from "../analysis";

export interface OrnamentalFrame extends Pick<AnalysisSlice, "tick" | "endTick" | "notes" | "key" | "completeSatb"> {
  readonly identities: readonly ChordIdentity[];
  readonly metric?: MetricPosition;
  readonly harmonyRegionId?: string;
  readonly harmonicKey?: KeyReference;
}

export interface OrnamentalPoint {
  readonly tick: number;
  readonly note: AnalysisNote;
  readonly confirmedAtTick?: number;
}

export interface WrittenOrnament {
  readonly voice: VoiceId;
  readonly role: Extract<NonChordToneRole, "passing" | "neighbor" | "suspension" | "retardation">;
  readonly departure: OrnamentalPoint;
  readonly ornaments: readonly AnalysisNote[];
  readonly arrival: OrnamentalPoint;
  readonly entryTick: number;
  readonly crossedSliceTicks: readonly number[];
}

export const endOfWrittenNote = (note: AnalysisNote) => note.startTick + note.durationTicks;

export function writtenStepDirection(
  from: AnalysisNote, to: AnalysisNote, chromatic = true,
): -1 | 0 | 1 {
  if (endOfWrittenNote(from) !== to.startTick) return 0;
  const interval = writtenInterval(from.pitch, to.pitch);
  const direction = interval.semitones > 0 ? 1 : -1;
  if (interval.diatonicSteps === 0 && chromatic && Math.abs(interval.semitones) === 1) return direction;
  return interval.diatonicSteps === direction && isWrittenStep(interval) ? direction : 0;
}

export interface WrittenPassingLine {
  readonly direction: -1 | 1;
  readonly leftAnchor: AnalysisNote;
  readonly rightAnchor: AnalysisNote;
  readonly chainNotes: readonly AnalysisNote[];
  readonly fromTick: number;
  readonly toTick: number;
}

/** Walk actual attacks, not vertical slices. The caller supplies the
 * harmonic meaning of an endpoint at the edge of its written event. */
export function readWrittenPassingLine(
  note: AnalysisNote,
  previous: (note: AnalysisNote) => AnalysisNote | undefined,
  next: (note: AnalysisNote) => AnalysisNote | undefined,
  anchor: (note: AnalysisNote, side: "left" | "right") => boolean,
  intermediate: (note: AnalysisNote) => boolean,
  continuous: (left: AnalysisNote, right: AnalysisNote) => boolean,
): WrittenPassingLine | undefined {
  const before = previous(note), after = next(note);
  if (!before || !after || !intermediate(note)) return;
  const direction = writtenStepDirection(before, note);
  if (!direction || writtenStepDirection(note, after) !== direction) return;
  const chainNotes = [note];
  let left = before, right = after;
  while (!anchor(left, "left")) {
    if (chainNotes.length === 4 || !intermediate(left)) return;
    const earlier = previous(left);
    if (!earlier || writtenStepDirection(earlier, left) !== direction) return;
    chainNotes.unshift(left);
    left = earlier;
  }
  while (!anchor(right, "right")) {
    if (chainNotes.length === 4 || !intermediate(right)) return;
    const later = next(right);
    if (!later || writtenStepDirection(right, later) !== direction) return;
    chainNotes.push(right);
    right = later;
  }
  if (!continuous(left, right)) return;
  return { direction, leftAnchor: left, rightAnchor: right, chainNotes,
    fromTick: chainNotes[0].startTick, toTick: right.startTick };
}

export function belongsToWrittenHarmony(
  identity: ChordIdentity, voice: VoiceId, note: AnalysisNote,
) {
  return voice === "bass" ? pitchClassEquals(identity.bass, note.pitch) :
    chordIdentityToneSpellings(identity).some(tone => pitchClassEquals(tone, note.pitch));
}

type IndexedPoint = OrnamentalPoint & { readonly index: number };
type MotionKind = WrittenOrnament["role"];
const allows = (note: AnalysisNote, role: MotionKind) => !note.nonChordToneRole || note.nonChordToneRole === role;

/**
 * Trace note events rather than slice counts. Multiple slice boundaries can
 * pass through one written event without creating a second melodic attack.
 */
export function createWrittenOrnamentReader(
  frames: readonly OrnamentalFrame[], boundaries: readonly number[], maxMotionTicks: number,
) {
  const cuts = [...new Set(boundaries)].sort((a, b) => a - b);
  const byTick = new Map(frames.map((frame, index) => [frame.tick, index]));
  const declaredContinuity = (left: number, right: number) => {
    for (let i = left + 1; i <= right; i++) {
      if (frames[i - 1].endTick !== frames[i].tick ||
          frames[i - 1].key.tick !== frames[i].key.tick ||
          !keyDeclarationEquals(frames[i - 1].key, frames[i].key) ||
          !keyEquals(frames[i - 1].harmonicKey ?? frames[i - 1].key, frames[i].harmonicKey ?? frames[i].key)) return false;
    }
    return !cuts.some(tick => frames[left].tick < tick && tick <= frames[right].tick);
  };
  const at = (index: number | undefined, voice: VoiceId): IndexedPoint | undefined => {
    if (index === undefined) return;
    const frame = frames[index];
    const note = frame?.notes[voice];
    return note && { index, tick: frame.tick, note };
  };
  const before = (note: AnalysisNote, voice: VoiceId) => {
    const index = byTick.get(note.startTick);
    return index === undefined ? undefined : at(index - 1, voice);
  };
  const after = (note: AnalysisNote, voice: VoiceId) => at(byTick.get(endOfWrittenNote(note)), voice);
  const isSupport = ({ index, note }: IndexedPoint, voice: VoiceId, except?: ChordIdentity) =>
    frames[index].identities.some(identity =>
      (!except || !chordIdentityEquals(identity, except)) && belongsToWrittenHarmony(identity, voice, note));
  const canAnchor = (point: IndexedPoint, voice: VoiceId) => {
    const role = point.note.nonChordToneRole;
    if (!role || role === "suspension" || role === "retardation") return true;
    if (role !== "passing") return false;
    // A role can start at a later harmonic entry of the same written event.
    // Verify the later dissonance before using its initial consonance.
    for (let i = point.index + 1; frames[i]?.tick < endOfWrittenNote(point.note); i++) {
      const next = at(i, voice);
      if (!next || next.note.id !== point.note.id || !declaredContinuity(point.index, i)) return false;
      if (frames[i].identities.length && !isSupport(next, voice)) return true;
    }
    return false;
  };
  const supportedThroughHold = (point: IndexedPoint, voice: VoiceId) => {
    if (!canAnchor(point, voice)) return;
    if (isSupport(point, voice)) return point;
    if (frames[point.index].identities.length) return;
    // Later upper attacks can confirm an already sounding arrival, but
    // never override a conflicting explicit chord at that note's attack.
    for (let i = point.index + 1; frames[i]?.tick < endOfWrittenNote(point.note); i++) {
      const later = at(i, voice);
      if (!later || later.note.id !== point.note.id || later.tick - point.tick > maxMotionTicks ||
          !declaredContinuity(point.index, i)) return;
      if (frames[i].identities.length) {
        return isSupport(later, voice) ? { ...point, confirmedAtTick: later.tick } : undefined;
      }
    }
  };
  const endpoint = (point: IndexedPoint, voice: VoiceId, target: ChordIdentity) =>
    supportedThroughHold(point, voice) ??
    // Upper-voice settling members can also precede a complete vertical
    // reading when the candidate's other voices have independent evidence.
    (voice !== "bass" && !point.note.nonChordToneRole && belongsToWrittenHarmony(target, voice, point.note) &&
      frames[point.index].identities.length === 0 ? point : undefined);

  function proof(
    voice: VoiceId, role: MotionKind, departure: IndexedPoint, ornaments: readonly AnalysisNote[],
    arrival: IndexedPoint, entryTick: number, index: number,
  ): WrittenOrnament | undefined {
    // Start at the departure's attack, not just its last held slice. A
    // manual cut through a held preparation must not re-use that attack.
    const origin = byTick.get(departure.note.startTick) ?? departure.index;
    if (arrival.tick - entryTick > maxMotionTicks || departure.index > index || index >= arrival.index ||
        !declaredContinuity(origin, arrival.index)) return;
    return {
      voice, role, departure: { tick: departure.tick, note: departure.note }, ornaments,
      arrival: { tick: arrival.tick, note: arrival.note, confirmedAtTick: arrival.confirmedAtTick }, entryTick,
      crossedSliceTicks: frames.slice(origin + 1,
        (arrival.confirmedAtTick === undefined ? arrival.index : byTick.get(arrival.confirmedAtTick)!) + 1).map(frame => frame.tick),
    };
  }

  function prepared(
    index: number, voice: VoiceId, note: AnalysisNote, target: ChordIdentity,
  ): WrittenOrnament | undefined {
    let arrival = after(note, voice);
    if (!arrival) return;
    const ornaments = [note];
    // A prepared dissonance may resolve through an intervening written
    // chromatic passing step before reaching the target member.
    if (note.nonChordToneRole && arrival.note.nonChordToneRole === "passing" &&
        !belongsToWrittenHarmony(target, voice, arrival.note)) {
      const passing = arrival.note;
      const settled = after(passing, voice);
      const into = writtenStepDirection(note, passing);
      if (!settled || !into || writtenStepDirection(passing, settled.note) !== into) return;
      ornaments.push(passing);
      arrival = settled;
    }
    if (!canAnchor(arrival, voice) || !belongsToWrittenHarmony(target, voice, arrival.note)) return;
    const region = frames[index].harmonyRegionId;
    if (voice === "bass" && region && frames[arrival.index].harmonyRegionId !== region) return;
    const step = writtenInterval(note.pitch, arrival.note.pitch);
    const direction = step.semitones > 0 ? 1 : -1;
    if (!isWrittenStep(step) || step.diatonicSteps !== direction) return;
    const role = direction < 0 ? "suspension" : "retardation";
    if (!allows(note, role)) return;
    const attack = byTick.get(note.startTick);
    if (attack === undefined) return;
    // The preparation can be held across multiple dissonant slices. The
    // last consonant frame supplies the harmonic entry, independently per voice.
    for (let i = index - 1; i >= attack; i--) {
      const departure = at(i, voice);
      if (!departure || departure.note.id !== note.id) return;
      if (isSupport(departure, voice, target)) {
        return proof(voice, role, departure, ornaments, arrival, frames[i + 1].tick, index);
      }
    }
    const departure = before(note, voice);
    if (!departure || endOfWrittenNote(departure.note) !== note.startTick ||
        !spelledPitchEquals(departure.note.pitch, note.pitch) || !isSupport(departure, voice, target)) return;
    // Rearticulation is weaker than a tie. Without a label require an
    // independently audible harmonic entry in two other written voices.
    if (!note.nonChordToneRole) {
      const metric = frames[attack].metric;
      if (metric?.confidence !== "certain" || metric.level < 2 || VOICE_ORDER.filter(part => {
        const old = frames[departure.index].notes[part], next = frames[attack].notes[part];
        return part !== voice && old && next && next.startTick === note.startTick &&
          !spelledPitchEquals(old.pitch, next.pitch) && belongsToWrittenHarmony(target, part, next);
      }).length < 2) return;
    }
    return proof(voice, role, departure, ornaments, arrival, note.startTick, index);
  }

  function weakBassEntry(first: AnalysisNote, last: AnalysisNote, explicit: boolean) {
    const entry = byTick.get(first.startTick);
    const end = byTick.get(endOfWrittenNote(last));
    if (entry === undefined || end === undefined) return false;
    const metric = frames[entry].metric;
    return metric?.confidence === "certain" && metric.role !== "downbeat" &&
      metric.measureNumber === frames[end - 1].metric?.measureNumber &&
      (explicit || metric.role === "subdivision" || end - entry > 1);
  }

  function horizontal(
    index: number, voice: VoiceId, note: AnalysisNote, target: ChordIdentity,
  ): WrittenOrnament | undefined {
    let departure = before(note, voice);
    let arrival = after(note, voice);
    if (!departure || !arrival) return;
    const direction = writtenStepDirection(departure.note, note);
    const exit = writtenStepDirection(note, arrival.note);
    if (!direction || !exit) return;
    const first = byTick.get(note.startTick);
    if (first === undefined) return;
    if (!note.nonChordToneRole &&
        (((voice !== "bass" || direction !== exit) && frames[arrival.index].identities.length &&
          !frames[arrival.index].identities.some(id => direction === exit
            ? pitchClassEquals(id.root, target.root) : chordIdentityEquals(id, target))) ||
        [first, arrival.index].some(i => Object.entries(frames[i].notes).some(([part, next]) => {
          const old = frames[i - 1]?.notes[part as VoiceId];
          return part !== voice && old && old.id !== next.id && spelledPitchEquals(old.pitch, next.pitch);
        })))) return;
    const firstAnchor = endpoint(departure, voice, target);
    const lastAnchor = endpoint(arrival, voice, target);
    if (direction === -exit && allows(note, "neighbor") && spelledPitchEquals(departure.note.pitch, arrival.note.pitch) &&
        (note.nonChordToneRole || writtenStepDirection(departure.note, note, false)) &&
        belongsToWrittenHarmony(target, voice, departure.note) && firstAnchor &&
        lastAnchor &&
        (voice !== "bass" || (weakBassEntry(note, note, Boolean(note.nonChordToneRole)) &&
          note.durationTicks <= Math.max(departure.note.durationTicks, arrival.note.durationTicks)))) {
      return proof(voice, "neighbor", firstAnchor, [note], lastAnchor, note.startTick, index);
    }
    if (direction !== exit || !allows(note, "passing")) return;

    const ornaments = [note];
    // At most four notes interpolate a chromatic perfect fourth. A second
    // voice's note/chord attack does not end the line; a structural event does.
    let start = firstAnchor;
    while (!start) {
      if (ornaments.length === 4 || !allows(departure.note, "passing") ||
          belongsToWrittenHarmony(target, voice, departure.note)) return;
      const preceding = before(departure.note, voice);
      if (!preceding || writtenStepDirection(preceding.note, departure.note) !== direction) return;
      ornaments.unshift(departure.note);
      departure = preceding;
      start = endpoint(departure, voice, target);
    }
    let finish = lastAnchor;
    while (!finish) {
      if (ornaments.length === 4 || !allows(arrival.note, "passing") ||
          belongsToWrittenHarmony(target, voice, arrival.note)) return;
      const following = after(arrival.note, voice);
      if (!following || writtenStepDirection(arrival.note, following.note) !== direction) return;
      ornaments.push(arrival.note);
      arrival = following;
      finish = endpoint(arrival, voice, target);
    }
    if (writtenInterval(departure.note.pitch, arrival.note.pitch).diatonicSteps === 0) return;
    const key = frames[index].key;
    // An ascending melodic-minor dominant bass into the leading tone needs
    // the separate full dominant-to-tonic resolution proof, not a two-step shortcut.
    if (voice === "bass" && key.mode === "minor" && direction === 1 &&
        pitchClassEquals(target.root, scaleDegreePitchClass(key, 5)) &&
        pitchClassEquals(departure.note.pitch, target.root) &&
        ornaments.some(part => pitchClassEquals(part.pitch, scaleDegreePitchClass(key, 6, 1))) &&
        (pitchClassEquals(arrival.note.pitch, leadingTonePitchClass(key)) ||
          ornaments.some(part => pitchClassEquals(part.pitch, leadingTonePitchClass(key))))) return;
    if (voice === "bass" && (!weakBassEntry(ornaments[0], ornaments.at(-1)!, Boolean(note.nonChordToneRole)) ||
        ornaments.some(part => part.durationTicks > departure.note.durationTicks))) return;
    return proof(voice, "passing", start, ornaments, finish, ornaments[0].startTick, index);
  }

  return (index: number, voice: VoiceId, target: ChordIdentity) => {
    const frame = frames[index];
    const note = frame?.notes[voice];
    if (!note || chordIdentityToneSpellings(target).some(tone => pitchClassEquals(tone, note.pitch))) return;
    return prepared(index, voice, note, target) ?? horizontal(index, voice, note, target);
  };
}
