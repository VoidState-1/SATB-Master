import {
  chordIdentityInversion, chordIdentityToneSpellings, chordStructureQuality,
  harmonySemanticsConfidence, primaryHarmonyInterpretation, type ScaleDegree,
} from "../../chordModel";
import { isWrittenStep, pitchClassEquals, scaleDegreePitchClass, spelledPitchEquals, writtenInterval, type KeyLike, type SpelledPitch } from "../../pitch";
import type { ChordRegion } from "../../project/types";
import { VOICE_ORDER } from "../../project/voice";
import { metricPositionAt, type MetricTimeline } from "../../rhythm/metric";
import { eventAtTick, orderedEvents } from "../../time";
import { soundsCompleteWrittenChord } from "../facts/writtenVoicing";
import {
  confirmedFullCadences, followingRegion, measureAt, previousRegion, sameKey,
  terminalRegionAt, voicesEndingAt, voicesStartingAt,
} from "./timelineEvidence";
import type { PhraseAnalysisInput, PhraseEvidence } from "./types";

type Track = NonNullable<PhraseAnalysisInput["satbTracks"]>[number];
type Note = Track["notes"][number];
type WrittenNote = Note & { readonly pitch: SpelledPitch };
type Window = { fromTick: number; toTick: number };

type Context = {
  readonly project: PhraseAnalysisInput;
  readonly timeline: MetricTimeline;
  readonly regions: readonly ChordRegion[];
  readonly scoreStart: number;
};

function noteEnd(note: Note) {
  return note.startTick + note.durationTicks;
}

function writtenNotesAt(tracks: readonly Track[], tick: number) {
  const notes = VOICE_ORDER.map(voice => tracks.find(track => track.id === voice)?.notes.find(
    note => note.startTick <= tick && tick < noteEnd(note),
  ));
  return notes.every((note): note is WrittenNote => !!note?.pitch) ? notes : undefined;
}

function literalVoicing(chord: ChordRegion, notes: readonly WrittenNote[] | undefined) {
  const structure = chord.identity.structure;
  return notes && structure.kind === "tertian" && !structure.extensions.length && !structure.alterations.length &&
    soundsCompleteWrittenChord(chord.identity, notes, notes[VOICE_ORDER.indexOf("bass")]);
}

function agreesWithKey(chord: ChordRegion, key: KeyLike) {
  return !chord.semantics?.interpretations.some(meaning => meaning.localKey && !sameKey(meaning.localKey, key));
}

function hasLocalDegree(chord: ChordRegion, degree: ScaleDegree, key: KeyLike) {
  const semantics = chord.semantics;
  if (!semantics || semantics.mixture || semantics.pedalContext || semantics.cadenceRole ||
      !["certain", "probable"].includes(harmonySemanticsConfidence(semantics))) return false;
  const meaning = primaryHarmonyInterpretation(semantics);
  return !meaning.degreeAlteration && !meaning.appliedTarget && meaning.degree === degree &&
    agreesWithKey(chord, key) && pitchClassEquals(chord.identity.root, scaleDegreePitchClass(key, degree));
}

function writtenDominantTail(
  { timeline, regions }: Context, tracks: readonly Track[], tick: number, key: KeyLike,
) {
  const measure = measureAt(timeline, tick - 1);
  const ending = terminalRegionAt(regions, tick);
  if (!measure || !ending || !hasLocalDegree(ending, 5, key) ||
      chordStructureQuality(ending.identity) !== "dominant7" || chordIdentityInversion(ending.identity) === 0 ||
      ending.durationTicks <= 0 || ending.durationTicks > measure.beatLength / 2 ||
      metricPositionAt(timeline, ending.startTick)?.role !== "subdivision") return;

  const ordinaryDominant = (part: ChordRegion | undefined): part is ChordRegion =>
    !!part && part.durationTicks > 0 && part.startTick >= measure.startTick && hasLocalDegree(part, 5, key) &&
    chordStructureQuality(part.identity) === "major";
  const before = previousRegion(regions, ending);
  const beforeNotes = writtenNotesAt(tracks, ending.startTick - 1);
  if (!ordinaryDominant(before) || !beforeNotes || !literalVoicing(before, beforeNotes)) return;

  let anchor = before;
  while (chordIdentityInversion(anchor.identity) !== 0) {
    const preceding = previousRegion(regions, anchor);
    if (!ordinaryDominant(preceding)) return;
    anchor = preceding;
  }
  if (!literalVoicing(anchor, writtenNotesAt(tracks, anchor.startTick))) return;

  const notes = writtenNotesAt(tracks, ending.startTick);
  if (!notes || !literalVoicing(ending, notes) || notes.some(note => noteEnd(note) !== tick)) return;
  const changes = notes.flatMap((note, index) => note.startTick === ending.startTick ? [index] : []);
  if (changes.length !== 1) return;
  const [voice] = changes;
  const left = beforeNotes[voice];
  const right = notes[voice];
  if (noteEnd(left) !== ending.startTick || !pitchClassEquals(left.pitch, ending.identity.root) ||
      !pitchClassEquals(right.pitch, chordIdentityToneSpellings(ending.identity)[3])) return;
  const motion = writtenInterval(left.pitch, right.pitch);
  if (isWrittenStep(motion) && motion.diatonicSteps === -1) return anchor.startTick;
}

function sameMotif(left: readonly Note[], first: number, right: readonly Note[], repeat: number) {
  return left.length > 0 && left.length === right.length && left.every((note, index) => {
    const other = right[index];
    return !!note.pitch && !!other.pitch && spelledPitchEquals(note.pitch, other.pitch) &&
      note.startTick - first === other.startTick - repeat && note.durationTicks === other.durationTicks;
  });
}

function startingPair(notes: readonly Note[], tick: number) {
  const [first, next] = notes.filter(note => note.startTick >= tick).slice(0, 2);
  if (first?.pitch && next?.pitch && first.startTick === tick && noteEnd(first) === next.startTick &&
      !spelledPitchEquals(first.pitch, next.pitch)) return [first, next] as const;
}

/** Compare the written rhythm and directed intervals. A transposed consequent
 * can restore the opening even when its first chord is a dominant pickup. */
export function melodicFigureMatcher(track: Track | undefined) {
  const notes = [...(track?.notes ?? [])].sort((a, b) => a.startTick - b.startTick);
  const byStart = new Map(notes.map((note, index) => [note.startTick, index]));
  return (tick: number, model = notes[0]?.startTick) => {
    const first = byStart.get(model);
    const index = byStart.get(tick);
    if (first === undefined || index === undefined || index - first < 3) return false;
    let moves = false;
    for (let offset = 0; offset < 2; offset++) {
      const a = notes[first + offset], b = notes[first + offset + 1];
      const c = notes[index + offset], d = notes[index + offset + 1];
      if (!a?.pitch || !b?.pitch || !c?.pitch || !d?.pitch ||
          noteEnd(a) !== b.startTick || noteEnd(c) !== d.startTick || a.durationTicks !== c.durationTicks) return false;
      const interval = writtenInterval(a.pitch, b.pitch).diatonicSteps;
      if (writtenInterval(c.pitch, d.pitch).diatonicSteps !== interval) return false;
      moves ||= interval !== 0;
    }
    return moves;
  };
}

function pickUpNotes(notes: readonly Note[], from: number, to: number) {
  const sounding = notes.filter(note => note.startTick < to && noteEnd(note) > from);
  if (sounding.every(note => note.startTick >= from && noteEnd(note) <= to)) return sounding;
}

function openingMotif({ scoreStart, timeline }: Context, soprano: Track, tick: number) {
  const first = measureAt(timeline, scoreStart);
  if (!first) return;
  const second = measureAt(timeline, first.endTick);
  const pickupLength = second && first.endTick - scoreStart < second.endTick - second.startTick
    ? first.endTick - scoreStart : 0;
  const openingTick = scoreStart + pickupLength;
  const notes = [...soprano.notes].sort((a, b) => a.startTick - b.startTick);
  const opening = startingPair(notes, openingTick);
  const restart = startingPair(notes, tick);
  if (!opening || !restart || !sameMotif(opening, openingTick, restart, tick)) return;

  if (pickupLength > 0) {
    const earlier = pickUpNotes(notes, scoreStart, openingTick);
    const later = pickUpNotes(notes, tick - pickupLength, tick);
    if (!earlier || !later || !sameMotif(earlier, scoreStart, later, tick - pickupLength)) return;
  }
  return { openingTick, opening, restart, restartStart: tick - pickupLength };
}

function sameContext({ project, regions }: Context, key: KeyLike, window: Window) {
  const keys = orderedEvents(project.keyEvents ?? []);
  return keys.length > 0 && keys[0].tick <= window.fromTick &&
    sameKey(eventAtTick(keys, window.fromTick), key) &&
    !keys.some(event => window.fromTick < event.tick && event.tick < window.toTick && !sameKey(event, key)) &&
    !regions.some(chord => chord.startTick < window.toTick && chord.startTick + chord.durationTicks > window.fromTick &&
      !agreesWithKey(chord, key));
}

/** After a short written dominant decoration, recognize a restarted opening
 * only with both the melodic reprise and a separately attacked tonic. */
export function reprisedOpeningAfterDominant(context: Context, tick: number): PhraseEvidence | undefined {
  const { project, timeline, regions } = context;
  const tracks = project.satbTracks;
  const soprano = tracks?.find(track => track.id === "soprano");
  const keys = orderedEvents(project.keyEvents ?? []);
  if (tracks?.length !== VOICE_ORDER.length || !soprano || !keys.length || keys[0].tick >= tick ||
      metricPositionAt(timeline, tick)?.role !== "downbeat" ||
      voicesEndingAt(project, tick) !== VOICE_ORDER.length ||
      voicesStartingAt(project, tick) !== VOICE_ORDER.length ||
      confirmedFullCadences(project).some(cadence => cadence.fromTick < tick && tick < cadence.toTick)) return;

  const key = eventAtTick(keys, tick - 1);
  const motif = openingMotif(context, soprano, tick);
  if (!motif) return;
  const tonicAt = (at: number) => {
    const chord = followingRegion(regions, at);
    return chord && hasLocalDegree(chord, 1, key) && chordStructureQuality(chord.identity) === key.mode &&
      literalVoicing(chord, writtenNotesAt(tracks, at));
  };
  if (!tonicAt(tick) || !tonicAt(motif.openingTick)) return;
  const anchor = writtenDominantTail(context, tracks, tick, key);
  if (anchor === undefined ||
      !sameContext(context, key, { fromTick: context.scoreStart, toTick: noteEnd(motif.opening[1]) }) ||
      !sameContext(context, key, { fromTick: Math.min(anchor, motif.restartStart), toTick: noteEnd(motif.restart[1]) })) return;
  return {
    code: "soprano-opening-reprise",
    value: "属七弱部装饰后齐奏起句，女高复现前句开头的写法与节奏",
    refs: [...motif.opening, ...motif.restart].flatMap(note => note.id ? [note.id] : []),
  };
}
